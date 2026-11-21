import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config, RiskFloor } from './config.ts';
import { jodexDir, readJson, writeJson } from './project.ts';
import { maxFloor, riskFloor } from './rules.ts';

export type CompletionStatus = 'verified' | 'review_required' | 'failed_verification' | 'blocked';
export type GateState = 'satisfied' | 'pending' | 'failed' | 'unavailable';
export type Gate = { gate: string; required: boolean; state: GateState; detail: string; check?: boolean }; // check: a configured check, not a workflow gate
export type Mode = 'solo' | 'review' | 'collaborative';
export type Role = 'planner' | 'tester' | 'reviewer';

export type CheckResult = { command: string; exitCode: number | null; identity: string; at: string; outputTail: string };

export type Finding = {
  severity: 'blocking' | 'nonblocking' | 'question';
  location: string;
  issue: string;
  evidence: string;
  expectedBehavior: string;
  jev?: { decisionId: string; label: string; p: number } | null; // D4 classification of a blocking finding
  confirmed?: boolean; // blocking and not disputed by D4
};

export type Review = {
  round: string; // R0, R1, ...
  snapshotId: string;
  snapshotDir: string;
  startedAt: string;
  at: string | null; // null while the reviewer runs
  status: 'no_blocking_findings' | 'changes_required' | 'insufficient_evidence' | 'invalid' | null;
  findings: Finding[];
  reviewedPaths: string[];
  limitations: string[];
  agentType: string | null;
  error?: string;
  briefFile?: string;
  scope?: string[]; // files the review covered; files touched later make it stale
  reviewer?: { host: 'claude-code' | 'codex'; mode: 'cross' | 'subagent'; launchedAt?: string; model?: string | null; costUsd?: number | null; elapsedMs?: number };
};

// Model attribution per role attempt: what the policy proposed, what Jodex asked the host for, and
// what the host reported. A null field is unknown (observed) or not requested (host default).
export type ModelPair = { model: string | null; effort: string | null };
// Tokens a host reported for one role attempt or the worker; never estimated (null/absent: unknown).
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; source: string };
export type Attempt = {
  role: Role;
  key: string; // reviewer: its review round (R0...); planner/tester: `${role}-${n}`
  since: string; // the awaiting token of this attempt
  host: string | null;
  launch: 'detached' | 'subagent';
  proposed: ModelPair | null; // null when [models] mode is off
  requested: ModelPair;
  observed: ModelPair & { source: string | null; models?: string[]; usageLeader?: string | null };
  mismatch: boolean | 'unknown';
  policy: string | null;
  reason: string | null;
  agentId?: string | null; // the same-host child bound to this attempt
  usage?: Usage | null;
};

export type Plan = {
  revision: string; // sha256 of the plan text
  file: string;
  at: string;
  decision: 'accept' | 'revise' | 'blocked' | null; // the worker's challenge result
  reason?: string;
};

export type Run = {
  runId: string;
  sessionId: string | null;
  host: string | null; // 'claude-code' | 'codex' | null when opened by `jodex check`
  model: string | null;
  request: string;
  mode: Mode;
  modeSource?: string; // rule | jev | override
  riskFloor: RiskFloor;
  touched: string[];
  baseFiles?: Record<string, 'copied' | 'absent'>; // pre-edit state of files written through tools
  jevRiskFloor?: RiskFloor | null; // floor raised by Jev at intake (never lowered)
  decisionIds?: string[];
  checks: Record<string, CheckResult>;
  commandDecisions?: Record<string, boolean>; // D2 cache: normalized command -> denied
  testerOutOfScope?: string[];
  testerStartedAt?: string; // the latest `jodex test start`
  testerDoneAt?: string; // the tester reported a result (not set when it was cancelled or expired)
  roleModels?: Partial<Record<Role, string>>; // legacy (before attempts): read only, for old runs
  attempts?: Attempt[];
  promptAt?: string; // the prompt that started this run: the worker's token window begins here
  workerUsage?: Usage | null; // the worker host session's tokens since promptAt (Claude only)
  readOnlyAgents?: string[];
  agentRoles?: Record<string, Role>; // role of each subagent, fixed when first seen // reviewer/planner subagent IDs: read-only for good, even after they stop being awaited // non-test files changed while the tester ran
  awaiting?: { role: Role; since: string } | null; // a subagent the worker is waiting for
  plans?: Plan[];
  reviews?: Review[];
  corrections?: number; // correction rounds started after changes_required (budget: 1)
  correctingAfter?: string | null; // round whose blockers the current correction addresses
  stopBlocks: number; // times the Stop gate sent an unsupported finish back
  open: boolean;
  createdAt: string;
  updatedAt: string;
  completion?: { status: CompletionStatus; identity: string; at: string; reason?: string };
  acceptance?: { decision: 'accepted' | 'rejected' | 'discarded'; at: string; identity?: string }; // identity: the source the developer accepted
};

export const CORRECTION_BUDGET = 1;
export const PLAN_REVISION_BUDGET = 1;

const runsDir = (root: string) => path.join(jodexDir(root), 'runs');
const runFile = (root: string, id: string) => path.join(runsDir(root), `${id}.json`);

export function saveRun(root: string, run: Run) {
  run.updatedAt = new Date().toISOString();
  writeJson(runFile(root, run.runId), run);
}

// recentDays: only runs saved within that many days (hooks call this on every tool use, and
// run files are never deleted, so scanning all of them would slow every call down over time).
export function listRuns(root: string, recentDays?: number): Run[] {
  if (!fs.existsSync(runsDir(root))) return [];
  const since = recentDays ? Date.now() - recentDays * 864e5 : 0;
  return fs
    .readdirSync(runsDir(root))
    .filter((f) => f.endsWith('.json') && (!since || fs.statSync(path.join(runsDir(root), f)).mtimeMs >= since))
    .map((f) => readJson<Run | null>(path.join(runsDir(root), f), null))
    .filter((r): r is Run => r !== null)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

// The open run a session works on: its own, else an unclaimed one (created by `jodex check`).
// shortcut: one developer per project; parallel sessions in one checkout share unclaimed runs.
export function findOpenRun(root: string, sessionId: string | null): Run | null {
  const open = listRuns(root, 14).filter((r) => r.open);
  const run = open.findLast((r) => r.sessionId === sessionId) ?? open.findLast((r) => r.sessionId === null) ?? null;
  if (run && expireAwaiting(run)) saveRun(root, run);
  return run;
}

export const AWAIT_TTL_MS = 30 * 60 * 1000;

// A subagent that never reports (launched with the wrong type, or never launched) must not
// lock the worker out or switch off the Stop gate forever. Returns true when it changed the run.
export function expireAwaiting(run: Run, reason?: string): boolean {
  if (!run.awaiting) return false;
  if (!reason && !(Date.now() - Date.parse(run.awaiting.since) >= AWAIT_TTL_MS)) return false; // unparsable: keep waiting
  const why = reason ?? `no ${run.awaiting.role} result within ${AWAIT_TTL_MS / 60000} minutes`;
  const review = latestReview(run);
  if (run.awaiting.role === 'reviewer' && review && !review.at) Object.assign(review, { at: new Date().toISOString(), status: 'invalid', error: why });
  run.awaiting = null;
  return true;
}

// Load the latest copy, apply a change, save. Writers that hold a run while slow work happens
// (checks, a detached reviewer) use this so they do not overwrite each other's results.
export function updateRun(root: string, runId: string, fn: (run: Run) => void): Run | null {
  const run = readJson<Run | null>(runFile(root, runId), null);
  if (!run) return null;
  fn(run);
  saveRun(root, run);
  return run;
}

export function createRun(root: string, sessionId: string | null, request: string, host: string | null = null, model: string | null = null): Run {
  const now = new Date().toISOString();
  const run: Run = {
    runId: `${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(3).toString('hex')}`,
    sessionId,
    host,
    model,
    request,
    mode: 'solo',
    riskFloor: 'low',
    touched: [],
    checks: {},
    stopBlocks: 0,
    open: true,
    createdAt: now,
    updatedAt: now,
  };
  saveRun(root, run);
  return run;
}

const MODES: Mode[] = ['solo', 'review', 'collaborative'];
export const maxMode = (a: Mode, b: Mode) => (MODES.indexOf(a) >= MODES.indexOf(b) ? a : b);

// Raise the mode, never lower it. A critical floor needs at least an independent review (spec §3.1).
// A later prompt's Jev recommendation does not raise a run that already has changes (it belongs to
// an earlier task); the developer's explicit `review:`/`collab:` always does.
export const canRaise = (run: Run, source?: string) => source === 'override' || !run.touched.length;

export function raiseMode(run: Run, mode: Mode, source: string) {
  if (MODES.indexOf(mode) > MODES.indexOf(run.mode)) {
    run.mode = mode;
    run.modeSource = source;
  }
}

export function touch(run: Run, paths: string[], cfg: Config) {
  for (const p of paths) if (!run.touched.includes(p)) run.touched.push(p);
  run.riskFloor = maxFloor(run.riskFloor, riskFloor(run.touched, cfg));
  if (run.riskFloor === 'critical') raiseMode(run, 'review', 'rule');
}

export const latestReview = (run: Run) => (run.reviews ?? []).at(-1) ?? null;
export const attemptFor = (run: Run, role: Role, since: string) => (run.attempts ?? []).find((a) => a.role === role && a.since === since) ?? null;

// An alias (`sonnet`) cannot be compared with the full ID the host reports, so that stays unknown.
const ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable', 'best', 'default', 'inherit']);
export function mismatchOf(requested: ModelPair, observed: ModelPair): boolean | 'unknown' {
  const same = (['model', 'effort'] as const)
    .filter((k) => requested[k] !== null)
    .map((k) => (observed[k] === null || (k === 'model' && observed[k] !== requested[k] && ALIASES.has(requested[k]!)) ? null : observed[k] === requested[k]));
  return same.includes(false) ? true : !same.length || same.includes(null) ? 'unknown' : false;
}

// Why the worker may not change files right now, or null.
export function writeLock(run: Run): string | null {
  if (run.awaiting) return `wait for the ${run.awaiting.role} subagent before changing files.`;
  if (run.mode === 'collaborative' && (run.plans ?? []).at(-1)?.decision !== 'accept') return 'collaborative mode: get the plan accepted first (`jodex plan start`, then `jodex plan accept`).';
  const review = latestReview(run);
  if (review?.status === 'changes_required' && review.at && run.correctingAfter !== review.round && (run.corrections ?? 0) >= CORRECTION_BUDGET)
    return 'the correction budget is used up; report the open blockers to the developer.';
  return null;
}
export const latestPlan = (run: Run) => (run.plans ?? []).at(-1) ?? null;

// Gate evaluation and completion precedence (spec §7.2).
export const hasDisputed = (run: Run) => (run.reviews ?? []).some((v) => v.findings.some((f) => f.severity === 'blocking' && f.confirmed === false));

export function evaluate(run: Run, cfg: Config, identity: string): { status: CompletionStatus; gates: Gate[]; next: string | null; agentNext: boolean } {
  const gates: Gate[] = [];
  // Developer acceptance counts only for the source that was accepted.
  const accepted = run.acceptance?.decision === 'accepted' && run.acceptance.identity === identity;
  const names = Object.keys(cfg.checks);
  if (names.length === 0) gates.push({ gate: 'checks', required: true, state: 'unavailable', detail: 'no checks configured in .jodex/config.toml' });
  for (const name of names) {
    const r = run.checks[name];
    if (!r) gates.push({ gate: name, required: true, check: true, state: 'pending', detail: 'not run; run `jodex check`' });
    else if (r.identity !== identity) gates.push({ gate: name, required: true, check: true, state: 'pending', detail: 'source changed since last run; run `jodex check`' });
    else if (r.command !== cfg.checks[name]) gates.push({ gate: name, required: true, check: true, state: 'pending', detail: 'the configured command changed since last run; run `jodex check`' });
    else if (r.exitCode === 0) gates.push({ gate: name, required: true, check: true, state: 'satisfied', detail: `exit 0 on current source` });
    else gates.push({ gate: name, required: true, check: true, state: 'failed', detail: `exit ${r.exitCode} on current source` });
  }

  const plan = latestPlan(run);
  if (run.mode === 'collaborative') {
    if (plan?.decision === 'blocked') gates.push({ gate: 'plan', required: true, state: 'failed', detail: `plan blocked: ${plan.reason ?? ''}` });
    else gates.push({ gate: 'plan', required: true, state: plan?.decision === 'accept' ? 'satisfied' : 'pending', detail: plan ? `revision ${plan.revision.slice(0, 8)}: ${plan.decision ?? 'awaiting your challenge'}` : 'no plan yet' });
  }

  const review = latestReview(run);
  const why = riskFloor(run.touched, cfg) === run.riskFloor ? run.touched.join(', ') || 'no files' : 'raised by Jev';
  if (run.mode !== 'solo') {
    let state: GateState = 'pending';
    let detail = 'no review yet';
    if (review && !review.at) detail = `${review.round} running`;
    else if (review && review.snapshotId !== identity) detail = `${review.round} reviewed an older snapshot; review the current source`;
    else if (review?.scope && run.touched.some((f) => !review.scope!.includes(f)))
      detail = `${review.round} did not cover ${run.touched.filter((f) => !review.scope!.includes(f)).join(', ')}; review again`;
    else if (review?.status === 'no_blocking_findings') [state, detail] = ['satisfied', `${review.round}: no blocking findings`];
    else if (review?.status === 'changes_required') {
      const disputed = review.findings.filter((f) => f.severity === 'blocking' && !f.confirmed).length;
      detail = `${review.round}: ${review.findings.filter((f) => f.confirmed).length} confirmed blocker(s)${disputed ? `, ${disputed} disputed by Jev (developer decides)` : ''}`;
    } else if (review) detail = `${review.round}: ${review.status}${review.error ? ` (${review.error})` : ''}`;
    gates.push({ gate: 'review', required: true, state, detail: `${run.mode} mode, ${run.riskFloor} risk (${why}); ${detail}` });
  } else if (run.riskFloor !== 'low') {
    gates.push({ gate: 'review', required: false, state: 'pending', detail: `${run.riskFloor} risk (${why}); prefix a prompt with "review:" to require one` });
  }
  if (run.testerOutOfScope?.length)
    gates.push({ gate: 'tester_scope', required: true, state: accepted ? 'satisfied' : 'pending', detail: `the tester changed non-test files (${run.testerOutOfScope.join(', ')}); the developer reviews them and runs \`jodex accept\`` });
  if (cfg.risk.humanReviewRequired.includes(run.riskFloor)) {
    const ok = accepted;
    gates.push({ gate: 'human_review', required: true, state: ok ? 'satisfied' : 'pending', detail: ok ? 'accepted by the developer' : `${run.riskFloor} risk requires the developer: \`jodex accept\` after reviewing` });
  }

  if (hasDisputed(run))
    gates.push({ gate: 'disputed_findings', required: true, state: accepted ? 'satisfied' : 'pending', detail: 'blocking findings disputed by Jev: the developer decides (`jodex accept` or `jodex reject`)' });
  const required = gates.filter((g) => g.required);
  // An executed failing check outranks a blocked plan (spec §7.2).
  const checkFailed = required.some((g) => g.state === 'failed' && g.check);
  const status: CompletionStatus = checkFailed
    ? 'failed_verification'
    : plan?.decision === 'blocked'
      ? 'blocked'
      : required.some((g) => g.state === 'failed')
        ? 'failed_verification'
        : required.every((g) => g.state === 'satisfied')
          ? 'verified'
          : 'review_required';
  const next = nextStep(run, gates);
  // Whether the next step is the agent's (the run stays open) or the developer's.
  return { status, gates, next, agentNext: next !== null && !/developer/.test(next) };
}

// The one thing the worker should do next; null when nothing is left for the agent.
function nextStep(run: Run, gates: Gate[]): string | null {
  const pending = (g: string) => gates.some((x) => x.gate === g && x.required && x.state !== 'satisfied');
  if (run.awaiting) return `wait for the ${run.awaiting.role} subagent to finish`;
  const plan = latestPlan(run);
  if (run.mode === 'collaborative' && !plan) return 'run `jodex plan start` and launch the planner it describes, before editing files';
  if (run.mode === 'collaborative' && plan && !plan.decision)
    return `challenge the plan in ${plan.file}: \`jodex plan accept\`, \`jodex plan revise "<reason>"\` or \`jodex plan block "<reason>"\``;
  if (gates.some((g) => g.check && g.state === 'failed')) return 'fix the failing check, then run `jodex check`';
  if (gates.some((g) => (g.check || g.gate === 'checks') && g.state !== 'satisfied')) return 'run `jodex check`';
  const review = latestReview(run);
  if (pending('review')) {
    if (review?.status === 'changes_required' && review.at) {
      if (!review.findings.some((f) => f.confirmed)) return 'report the disputed blockers to the developer, who decides';
      if ((run.corrections ?? 0) >= CORRECTION_BUDGET && run.correctingAfter !== review.round)
        return 'the correction budget is used up: report the open blockers to the developer';
      return 'fix the confirmed blockers, run `jodex check`, then `jodex review start` for a fresh review';
    }
    if (review?.status === 'invalid' && review.reviewer?.mode === 'cross')
      return `the cross-provider reviewer failed (${(review.error ?? '').slice(0, 120)}): run \`jodex review start\` to retry, or \`jodex review start --same-host\` for a same-host reviewer subagent`;
    return 'run `jodex review start` and follow what it prints';
  }
  if (pending('human_review')) return 'report the status; the developer reviews and runs `jodex accept`';
  return null;
}

export function formatStatus(run: Run, result: { status: CompletionStatus; gates: Gate[]; next?: string | null }): string {
  const lines = [`Jodex run ${run.runId} (${run.mode}, risk ${run.riskFloor})`, `Status: ${result.status}`];
  for (const g of result.gates) lines.push(`  ${g.state.padEnd(11)} ${g.gate}${g.required ? '' : ' (optional)'}: ${g.detail}`);
  if (result.next) lines.push(`Next: ${result.next}`);
  return lines.join('\n');
}
