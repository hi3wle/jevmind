import fs from 'node:fs';
import path from 'node:path';
import { refreshBoard } from './board.ts';
import { type Config, loadConfig, type RiskFloor } from './config.ts';
import { appendDecision, D1_THRESHOLDS, type Decision, decideIntake, newDecisionId } from './decisions.ts';
import { jev, redact } from './jev.ts';
import { changedPaths, gitRoot, identityOf, isInitialized, jodexDir, type Manifest, manifest, readJson, writeJson } from './project.ts';
import { isJodexPath, isTaskNotification, maxFloor, riskFloor, writePaths } from './rules.ts';
import { createRun, evaluate, type Role, findOpenRun, formatStatus, latestReview, type Mode, raiseMode, type Run, saveRun, touch, updateRun, writeLock } from './run.ts';
import { maybeAutoCalibrate } from './calibrate.ts';
import { gateCommand } from './commands.ts';
import { launchReviewer } from './crossreview.ts';
import { isReadOnlyCommand, isTestPath, READ_TOOLS, recordBase, recordSubagent, SHELL_WRITES } from './team.ts';

// Hook input shared by Claude Code and Codex (verified in M0).
export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: any;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
  transcript_path?: string | null;
  turn_id?: string; // Codex only
  model?: string; // Codex only
  agent_id?: string; // present when the event comes from a subagent
  agent_type?: string;
};

const hostOf = (ev: HookEvent) => (ev.turn_id ? 'codex' : 'claude-code');

type Session = { lastPrompt: string; baseline: Manifest | null; decisionId?: string | null; jevRiskFloor?: RiskFloor | null; mode?: Mode; modeSource?: string };
const sessionsDir = (root: string) => path.join(jodexDir(root), 'sessions');
const sessionFile = (root: string, id: string) => path.join(sessionsDir(root), `${id.replace(/[^\w-]/g, '_')}.json`);
const readSession = (root: string, id: string) => readJson<Session | null>(sessionFile(root, id), null);
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const D1_TIMEOUT_MS = 2500; // each hook is a fresh process: Jev cold start ~1.05 s, spikes past 1.5 s seen live

export const STATUS_LINE = 'Jodex status:';

const CONTEXT = `Jodex harness is active in this project. If you change files: run \`jodex check\` before you finish and follow the "Next:" line it prints (it may ask for a planner, tester or reviewer subagent). End your final reply with the line "${STATUS_LINE} <status>", using the status that \`jodex check\` prints. Never claim success that status does not support. Files under .jodex/ are managed by Jodex; do not edit them.`;

// "review: ..." or "collab: ..." at the start of a prompt asks for that mode explicitly.
// Jodex commands the worker may run while it is locked out of editing.
const WORKFLOW = /^jodex\s+(status|resume|check|cancel|review\s+(start|wait)|plan\s+(start|accept|revise|block)|test\s+start)\b/;
// Agents decorate commands (`jodex review wait 2>&1; echo "exit=$?"`): every chained part must be a
// workflow command, a read-only command or an echo, and nothing may redirect into a file.
export function allowedWhileLocked(cmd: string): boolean {
  const c = cmd.replace(/\d?>&\d/g, '');
  if (/[<>`\n]|\$\(/.test(c)) return false;
  return c
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => WORKFLOW.test(s) || isReadOnlyCommand(s) || /^echo\b/.test(s));
}

const OVERRIDE = /^\s*(solo|review|collab(?:orative)?)\s*:/i;

export async function handleHook(ev: HookEvent): Promise<object> {
  if (process.env.JODEX_DISABLE) return {}; // inside a Jodex reviewer process
  const root = gitRoot(ev.cwd);
  if (!root || !isInitialized(root)) return {};
  switch (ev.hook_event_name) {
    case 'UserPromptSubmit':
      return onPrompt(root, ev);
    case 'PreToolUse':
      return onPreToolUse(root, ev);
    case 'Stop':
      return onStop(root, ev);
    case 'SubagentStop':
      return onSubagentStop(root, ev);
    default:
      return {};
  }
}

async function onPrompt(root: string, ev: HookEvent) {
  const prompt = ev.prompt ?? '';
  if (isTaskNotification(prompt)) return {};
  pruneSessions(root);
  const cfg = loadConfig(root);
  // Baseline for every prompt: shell edits never reach PreToolUse, so Stop diffs against it.
  const session: Session = { lastPrompt: prompt, baseline: manifest(root) };
  let context = CONTEXT;
  const override = prompt.match(OVERRIDE)?.[1].toLowerCase();
  if (override && override !== 'solo') [session.mode, session.modeSource] = [override.startsWith('collab') ? 'collaborative' : 'review', 'override'];
  if (cfg.jev.mode !== 'off' && cfg.jev.consent) {
    const d = await intakeDecision(ev, cfg, prompt);
    appendDecision(root, d);
    session.decisionId = d.id;
    if (d.actedOn && d.action) {
      session.jevRiskFloor = d.action.riskFloor;
      if (d.action.clarify)
        context += `\nJodex (Jev decision ${d.id}): a material requirement or business rule looks missing (p=${d.answers!.missingRule.toFixed(2)}). Ask the developer before changing files; do not invent the rule.`;
      if (d.action.riskFloor) context += `\nJodex (Jev decision ${d.id}): this task is treated as ${d.action.riskFloor} risk.`;
      if (!session.mode && (d.action.recommendedMode === 'review' || d.action.recommendedMode === 'collaborative'))
        [session.mode, session.modeSource] = [d.action.recommendedMode, 'jev'];
    }
  }
  if (session.mode === 'collaborative') {
    // Plan before code: open the run now so `jodex plan start` has one.
    writeJson(sessionFile(root, ev.session_id), session);
    const run = findOpenRun(root, ev.session_id) ?? createRun(root, ev.session_id, prompt);
    attach(run, root, ev);
    saveRun(root, run);
    context += '\nJodex: collaborative mode. Before editing files, run `jodex plan start` and launch the planner subagent it describes.';
  } else if (session.mode === 'review') context += '\nJodex: review mode. After implementing and `jodex check`, run `jodex review start` for an independent reviewer.';
  const open = findOpenRun(root, ev.session_id);
  if (open && !open.awaiting) {
    const left = evaluate(open, cfg, identityOf(session.baseline!));
    if (left.agentNext) context += `\nJodex: run ${open.runId} ("${open.request.slice(0, 80)}") is still open. Next: ${left.next}. Finish it, or tell the developer why not, before starting other work.`;
  }
  writeJson(sessionFile(root, ev.session_id), session);
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context } };
}

async function intakeDecision(ev: HookEvent, cfg: Config, prompt: string): Promise<Decision> {
  const request = cfg.jev.dataLevel === 2 ? redact(prompt).slice(0, 4000) : '';
  const mentioned = prompt.match(/[\w./-]+\.[A-Za-z0-9]+|[\w-]+\/[\w./-]+/g) ?? [];
  const state = {
    request,
    repo: { languages: [], hasTests: Object.keys(cfg.checks).length > 0, testCommands: cfg.jev.dataLevel === 2 ? Object.values(cfg.checks).map(redact) : [] },
    protectedMatches: mentioned.filter((p) => riskFloor([p], cfg) !== 'low'),
  };
  const base = {
    id: newDecisionId(),
    ts: new Date().toISOString(),
    point: 'D1' as const,
    sessionId: ev.session_id,
    runId: null,
    thresholds: D1_THRESHOLDS,
    request: request.slice(0, 300),
  };
  const t0 = performance.now();
  try {
    const answers = await jev.askIntake(state, D1_TIMEOUT_MS);
    const { model, usage, ...rest } = answers;
    const thresholds = { ...D1_THRESHOLDS, raiseRisk: cfg.jev.thresholds.raiseRisk };
    return { ...base, thresholds, source: 'jev', model, usage, answers: rest, latencyMs: Math.round(performance.now() - t0), action: decideIntake(answers, thresholds), actedOn: cfg.jev.mode === 'enforce' };
  } catch (e) {
    // Timeout, network or auth failure: rules decide alone (conservative fallback).
    return { ...base, source: 'fallback', error: String((e as Error).message).slice(0, 200), model: null, latencyMs: Math.round(performance.now() - t0), action: null, actedOn: false };
  }
}

function attach(run: Run, root: string, ev: HookEvent) {
  const s = readSession(root, ev.session_id);
  run.sessionId ??= ev.session_id;
  run.host ??= hostOf(ev);
  run.model ??= ev.model ?? claudeModel(ev.transcript_path);
  if (s?.decisionId && !(run.decisionIds ?? []).includes(s.decisionId)) run.decisionIds = [...(run.decisionIds ?? []), s.decisionId];
  if (s?.mode) raiseMode(run, s.mode, s.modeSource ?? 'override');
  if (s?.jevRiskFloor) {
    run.jevRiskFloor = maxFloor(run.jevRiskFloor ?? 'low', s.jevRiskFloor);
    run.riskFloor = maxFloor(run.riskFloor, s.jevRiskFloor);
  }
}

const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Jodex: ${reason}` } });

async function onPreToolUse(root: string, ev: HookEvent) {
  const tool = ev.tool_name ?? '';
  const paths = writePaths(tool, ev.tool_input, root, ev.cwd);
  const existing = findOpenRun(root, ev.session_id);
  // Hooks run outside the host sandbox, so the cross-provider reviewer is started from here.
  if (existing && /\bjodex\s+review\s+wait\b/.test(String(ev.tool_input?.command ?? ''))) launchReviewer(root, existing, process.argv[1]);
  const cmd = String(ev.tool_input?.command ?? '');
  const isShell = tool === 'Bash' || tool === 'shell' || tool === 'exec_command';
  // Acceptance is the developer's decision; agents may not record it.
  // Command-text matching is a guardrail, not authentication: see spec §17 (limits).
  const plain = cmd.replace(/["'\\]/g, '');
  if (isShell && /\bjodex(\.mjs)?\s+(accept|reject|discard|uninstall|init|key|setup)\b/.test(plain)) return deny('only the developer runs `jodex accept`, `reject`, `discard`, `uninstall`, `init`, `key` or `setup`.');
  // Subagents of a run get only what their role allows (enforced here, not by the prompt).
  // A reviewer or planner stays read-only after it stops being awaited (cancelled, expired).
  // A subagent's role is fixed when first seen: Claude's `jodex:<role>` type when present, else the
  // awaited role. (Codex subagents are untyped: one first seen during a tester stage counts as tester.)
  const known = ev.agent_id ? existing?.agentRoles?.[ev.agent_id] : undefined;
  const typed = ev.agent_type?.startsWith('jodex:') ? (ev.agent_type.slice(6) as Role) : undefined;
  const agentRole = ev.agent_id && existing ? (known ?? typed ?? existing.awaiting?.role) : undefined;
  if (ev.agent_id && existing && agentRole && !known) {
    existing.agentRoles = { ...(existing.agentRoles ?? {}), [ev.agent_id]: agentRole };
    saveRun(root, existing);
  }
  if (ev.agent_id && existing && agentRole) {
    const role = agentRole;
    if (role === 'tester') {
      if (paths && !paths.every(isTestPath)) return deny(`the tester may only write test files (${paths.join(', ')})`);
      if (isShell && SHELL_WRITES.test(cmd)) return deny('the tester writes files through the edit tools, not the shell.');
    } else if (isShell) {
      if (!isReadOnlyCommand(cmd)) return deny(`the ${role} is read-only; this command is not on the read-only list`);
      return {};
    } else if (!READ_TOOLS.has(tool)) return deny(`the ${role} is read-only and may not use ${tool}`);
  }
  if (!paths) {
    if (!isShell) return {};
    // Helper subagents of a team run (not the awaited tester) may read and run workflow commands only.
    if (ev.agent_id && existing && existing.mode !== 'solo' && !(agentRole === 'tester' && existing.awaiting?.role === 'tester') && !allowedWhileLocked(cmd))
      return deny('in team modes only the worker and the tester change files.');
    // While the worker may not change files, its shell may only read or drive Jodex.
    const lock = !ev.agent_id && existing ? writeLock(existing) : null;
    if (lock && !allowedWhileLocked(cmd)) return deny(lock);
    const cached = Object.keys(existing?.commandDecisions ?? {}).length;
    const reason = await gateCommand(root, existing, loadConfig(root), tool, String(ev.tool_input?.command ?? ''), ev.session_id);
    if (existing && Object.keys(existing.commandDecisions ?? {}).length !== cached) saveRun(root, existing);
    return reason ? deny(reason) : {};
  }
  if (paths.some(isJodexPath)) return deny('files under .jodex/ are managed by Jodex; ask the developer to change them.');
  const cfg = loadConfig(root);
  const run = existing ?? createRun(root, ev.session_id, readSession(root, ev.session_id)?.lastPrompt ?? '');
  attach(run, root, ev);
  // In team modes only the awaited tester may write besides the worker; helper subagents may not.
  if (ev.agent_id && run.mode !== 'solo' && !(agentRole === 'tester' && run.awaiting?.role === 'tester')) return deny('in team modes only the worker and the tester change files.');
  if (!ev.agent_id) {
    const lock = writeLock(run);
    if (lock) return deny(lock);
    const review = latestReview(run);
    if (review?.status === 'changes_required' && review.at && run.correctingAfter !== review.round) {
      run.corrections = (run.corrections ?? 0) + 1; // consumed when the correction starts (spec §8.3)
      run.correctingAfter = review.round;
    }
  }
  recordBase(root, run, paths);
  touch(run, paths, cfg);
  saveRun(root, run);
  return {};
}

function onStop(root: string, ev: HookEvent) {
  const cfg = loadConfig(root);
  const current = manifest(root);
  const identity = identityOf(current);
  const session = readSession(root, ev.session_id);
  // Shell writes bypass PreToolUse, so every Stop folds in what changed since the prompt,
  // including into a run that `jodex check` opened with no touched files.
  const changed = session?.baseline ? changedPaths(session.baseline, current) : [];
  let run = findOpenRun(root, ev.session_id);
  if (!run) {
    if (!changed.length) {
      dropSession(root, ev.session_id);
      return {};
    }
    run = createRun(root, ev.session_id, session?.lastPrompt ?? '');
  }
  attach(run, root, ev);
  touch(run, changed, cfg);
  if (run.awaiting) {
    // The worker ended its turn to wait for a background subagent: never block that (D5 skip).
    // Merge into the latest copy: a detached reviewer may have saved its result meanwhile.
    updateRun(root, run.runId, (fresh) => touch(fresh, run.touched, cfg));
    return {};
  }
  const result = evaluate(run, cfg, identity);
  // The status must be the reply's last non-empty line, so an earlier quoted status cannot count.
  const last = (ev.last_assistant_message ?? '').trim().split('\n').at(-1) ?? '';
  const reported = last.replace(/^[\s*`>]+|[\s*`]+$/g, '') === `${STATUS_LINE} ${result.status}`; // tolerate **bold** or `code`
  if (!reported && !ev.stop_hook_active) {
    run.stopBlocks = (run.stopBlocks ?? 0) + 1;
    saveRun(root, run);
    return {
      decision: 'block',
      reason: `${formatStatus(run, result)}\n\nBefore finishing: run \`jodex check\` if a check is pending, fix failures you can fix, then end your reply with "${STATUS_LINE} ${result.status}" (or the new status \`jodex check\` prints).`,
    };
  }
  // Blocked at most once per stop attempt (stop_hook_active), so the agent can never loop here.
  // A reported status ends the run unless the agent still has a step (a review round, a fix);
  // a later task in the same session then starts fresh instead of inheriting files or risk.
  run.completion = { status: result.status, identity, at: new Date().toISOString() };
  if (reported && !result.agentNext) run.open = false;
  saveRun(root, run);
  if (!run.open) maybeAutoCalibrate(root);
  dropSession(root, ev.session_id);
  refreshBoard();
  return {};
}

async function onSubagentStop(root: string, ev: HookEvent) {
  const run = findOpenRun(root, ev.session_id);
  if (!run?.awaiting) return {};
  // Claude Code also stops internal agents (prompt suggestions, /btw); accept only the Jodex role.
  // Codex spawns generic subagents, so any subagent of this session counts there.
  if (!ev.turn_id && ev.agent_type !== `jodex:${run.awaiting.role}`) return {};
  const token = run.awaiting.since;
  const role = run.awaiting.role;
  const retry = await recordSubagent(root, run, loadConfig(root), ev.last_assistant_message ?? '', ev.agent_type ?? null, !!ev.stop_hook_active, !ev.turn_id);
  if (retry === 'ignored') return {};
  if (!retry) mergeRoleResult(root, run, role, token);
  if (retry) return { decision: 'block', reason: retry };
  refreshBoard();
  return {};
}

// D4 may have awaited the network meanwhile: merge only this role's result into the latest copy,
// and drop it if that wait was cancelled or replaced (the awaiting token changed).
export function mergeRoleResult(root: string, run: Run, role: Role, token: string) {
  updateRun(root, run.runId, (latest) => {
    if (latest.awaiting?.since !== token) return;
    if (role === 'reviewer') {
      const done = latestReview(run)!;
      const i = (latest.reviews ?? []).findIndex((v) => v.round === done.round);
      if (i >= 0) latest.reviews![i] = done;
    } else if (role === 'planner') latest.plans = [...(latest.plans ?? []), ...(run.plans ?? []).slice((latest.plans ?? []).length)];
    else latest.testerOutOfScope = run.testerOutOfScope;
    latest.awaiting = null;
  });
}

// The session file holds a per-file hash of the whole repo; keep it only while a turn is live.
const dropSession = (root: string, id: string) => fs.rmSync(sessionFile(root, id), { force: true });

function pruneSessions(root: string) {
  const dir = sessionsDir(root);
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const f of fs.readdirSync(dir)) {
    const file = path.join(dir, f);
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  }
}

// Claude Code's hook input has no model field; its transcript records the model per message.
export function claudeModel(transcript: string | null | undefined): string | null {
  if (!transcript) return null;
  try {
    const fd = fs.openSync(transcript, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    // The first line may be cut by the 512 KB window; JSON.parse skips it.
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'assistant' && typeof e.message?.model === 'string') return e.message.model;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}
