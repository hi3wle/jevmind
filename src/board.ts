import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { readCalibrations } from './calibrate.ts';
import { type Decision, readDecisions } from './decisions.ts';
import { jevmindDir, readJson, writeJson } from './project.ts';
import { riskFloor } from './rules.ts';
import { type Attempt, AWAIT_TTL_MS, listRuns, type ModelPair, type Role, type Run, type Usage } from './run.ts';

export const jevmindHome = () => process.env.JEVMIND_HOME ?? path.join(os.homedir(), '.jevmind');
const registryFile = () => path.join(jevmindHome(), 'projects.json');
export const boardFile = () => path.join(jevmindHome(), 'board', 'board.html');

// Projects that ran `jevmind init`, so the board can find their runs.
export function registerProject(root: string, add: boolean) {
  const roots = new Set(readJson<string[]>(registryFile(), []));
  if (add) roots.add(root);
  else roots.delete(root);
  writeJson(registryFile(), [...roots].sort());
}

export type BoardRun = {
  project: string;
  runId: string;
  request: string;
  host: string | null;
  model: string | null;
  risk: string;
  files: number;
  checks: { name: string; exitCode: number | null }[];
  status: string; // completion status, or in_progress
  open: boolean;
  createdAt: string;
  finishedAt: string | null;
  stopBlocks: number;
  decision: string | null;
  jevModel: string | null; // Jev model of the intake decision, when there was one
  jevRaised: boolean; // Jev raised the risk floor above what the files alone imply
  mode: string;
  reviews: {
    round: string;
    status: string | null;
    blockers: number;
    disputed: number;
    reviewer: string | null;
    costUsd: number | null;
    host: string | null;
    model: string | null;
    cross: boolean;
    startedAt: string;
    at: string | null;
  }[];
  plans: number;
  // Live view: where the run is now, as last recorded by the hooks (not proof a process is running).
  sessionId: string | null;
  updatedAt: string;
  modeSource: string | null;
  awaiting: { role: string; since: string; overdue: boolean } | null;
  pipeline: StageView[];
  activity: string;
  paths: string[];
  corrections: number;
  usage: RunUsage;
};

// Harness evaluation. Tokens compared = input + output + cache writes; cache reads are cheap and
// dwarf the rest, so they are shown apart. Only host-reported counts: unknown is null, never 0.
type RoleTokens = number | null | 'n/a'; // n/a: the role did not run
export type RunUsage = { worker: RoleTokens; planner: RoleTokens; tester: RoleTokens; reviewer: RoleTokens; total: number | null; partial: boolean; cacheRead: number; jev: number | null };
const counted = (u: Usage) => u.input + u.output + u.cacheWrite;

export function runUsage(r: Run, jevDecisions: Decision[]): RunUsage {
  let total = 0;
  let known = false;
  let partial = false;
  let cacheRead = 0;
  const add = (u: Usage | null | undefined): number | null => {
    if (!u) {
      partial = true;
      return null;
    }
    known = true;
    total += counted(u);
    cacheRead += u.cacheRead;
    return counted(u);
  };
  const role = (name: Role): RoleTokens => {
    const list = (r.attempts ?? []).filter((a) => a.role === name);
    if (!list.length) return 'n/a';
    const vals = list.map((a) => add(a.usage));
    return vals.some((v) => v === null) ? null : vals.reduce((s, v) => s! + v!, 0);
  };
  const worker = add(r.workerUsage);
  const [planner, tester, reviewer] = [role('planner'), role('tester'), role('reviewer')];
  const jev = jevDecisions.filter((d) => d.usage?.input_tokens != null && d.usage.output_tokens != null);
  return { worker, planner, tester, reviewer, total: known ? total : null, partial, cacheRead, jev: jev.length ? jev.reduce((s, d) => s + d.usage!.input_tokens! + d.usage!.output_tokens!, 0) : null };
}

// One session against the same project's session before it, quality first, tokens second:
// share of finished runs verified or accepted, blockers and corrections per run (fewer is better),
// then tokens and minutes per prompt. `n` is the sample behind each mean.
export type SessionMetrics = { sessionId: string; runs: number; finished: number; goodShare: number | null; blockersPerRun: number; correctionsPerRun: number; tokensPerPrompt: number | null; tokensN: number; minutesPerPrompt: number | null };
export type SessionComparison = { current: SessionMetrics; previous: SessionMetrics | null; verdict: string | null };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sessionMetrics(sessionId: string, runs: BoardRun[]): SessionMetrics {
  const finished = runs.filter((r) => r.status !== 'in_progress');
  const good = finished.filter((r) => r.status === 'verified' || r.decision === 'accepted').length;
  const tokens = runs.filter((r) => r.usage.total !== null && !r.usage.partial).map((r) => r.usage.total!);
  return {
    sessionId,
    runs: runs.length,
    finished: finished.length,
    goodShare: finished.length ? good / finished.length : null,
    blockersPerRun: runs.reduce((s, r) => s + r.reviews.reduce((b, v) => b + v.blockers, 0), 0) / runs.length,
    correctionsPerRun: runs.reduce((s, r) => s + r.corrections, 0) / runs.length,
    tokensPerPrompt: mean(tokens),
    tokensN: tokens.length,
    minutesPerPrompt: mean(finished.filter((r) => r.finishedAt).map((r) => (Date.parse(r.finishedAt!) - Date.parse(r.createdAt)) / 60e3)),
  };
}

export function compareSessions(runs: BoardRun[], sessionId: string): SessionComparison | null {
  const mine = runs.filter((r) => r.sessionId === sessionId);
  if (!mine.length) return null;
  const start = mine.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), mine[0].createdAt);
  const before = runs.filter((r) => r.project === mine[0].project && r.sessionId && r.sessionId !== sessionId && r.createdAt < start).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const prevId = before.at(-1)?.sessionId;
  const current = sessionMetrics(sessionId, mine);
  const previous = prevId ? sessionMetrics(prevId, runs.filter((r) => r.sessionId === prevId)) : null;
  if (!previous) return { current, previous, verdict: null };
  // The first metric both sessions know and differ on decides; higher is better only for the share.
  const order: [keyof SessionMetrics, string, boolean][] = [
    ['goodShare', 'share of runs verified or accepted', true],
    ['blockersPerRun', 'review blockers per run', false],
    ['correctionsPerRun', 'correction rounds per run', false],
    ['tokensPerPrompt', 'tokens per prompt', false],
    ['minutesPerPrompt', 'minutes per prompt', false],
  ];
  for (const [key, label, higher] of order) {
    const [a, b] = [current[key] as number | null, previous[key] as number | null];
    if (a === null || b === null || Math.abs(a - b) < 1e-9) continue;
    return { current, previous, verdict: `${(a > b) === higher ? 'Better' : 'Worse'} than the previous session: ${label} ${fmt(a, key)} vs ${fmt(b, key)}.` };
  }
  return { current, previous, verdict: 'No difference on the metrics both sessions report.' };
}
const fmt = (v: number, key: string) => (key === 'goodShare' ? `${Math.round(v * 100)}%` : key === 'tokensPerPrompt' ? String(Math.round(v)) : v.toFixed(1));

// The harness flow of one run, stage by stage, with the model behind each and its status.
export type StageStatus = 'done' | 'running' | 'waiting' | 'idle' | 'pending' | 'skipped' | 'warn' | 'failed' | 'overdue';
export type StageView = { stage: string; status: StageStatus; model: string | null; provider: string | null; detail: string; since?: string; models?: StageModels };
// Model attribution of the stage's attempt (pairs shown as "model · effort"; null: none or unknown).
type StageModels = { proposed: string | null; requested: string | null; observed: string | null; mismatch: boolean | 'unknown' };
const pair = (p: ModelPair | null) => (p && (p.model || p.effort) ? [p.model ?? '?', p.effort].filter(Boolean).join(' · ') : null);
const stageModels = (a: Attempt | null | undefined): StageModels | undefined =>
  a ? { proposed: pair(a.proposed), requested: pair(a.requested), observed: pair(a.observed), mismatch: a.mismatch } : undefined;
type Intake = Pick<Decision, 'source' | 'model' | 'latencyMs'> | null;

const reviewerLabel = (v?: { host: string; mode: string }) => (v ? `${v.host}${v.mode === 'cross' ? ' (cross)' : ''}` : null);
const ACTIVE_MS = 120e3;
const overdue = (since: string, now: number) => now - Date.parse(since) >= AWAIT_TTL_MS;
const REVIEW_STATUS: Record<string, StageStatus> = { no_blocking_findings: 'done', changes_required: 'failed', insufficient_evidence: 'warn', invalid: 'failed' };
const OUTCOME: Record<string, StageStatus> = { verified: 'done', review_required: 'warn', failed_verification: 'failed', blocked: 'failed' };

export function workflowActivity(r: Run): string {
  if (!r.open) return `Closed · ${r.completion?.status?.replace(/_/g, ' ') ?? 'outcome not recorded'}`;
  if (r.awaiting) return `Waiting for ${r.awaiting.role} result`;
  const plan = r.plans?.at(-1);
  if (plan?.decision === 'blocked') return 'Plan blocked · developer action required';
  if (plan && !plan.decision) return 'Waiting for implementor to challenge the plan';
  if (r.reviews?.at(-1)?.status === 'changes_required') return 'Correction required · reviewer found blockers';
  if (Object.values(r.checks).some((c) => c.exitCode !== 0)) return 'Checks failed · last recorded results';
  if (r.reviews?.at(-1)?.status === 'no_blocking_findings') return 'Review complete · waiting for completion gate';
  return 'Implementation / checks · last recorded activity';
}

export function pipeline(r: Run, intake: Intake, now = Date.now()): StageView[] {
  const host = r.host ?? 'cli';
  const waitingFor = (role: string) => (r.open && r.awaiting?.role === role ? r.awaiting.since : null);
  const lastAttempt = (role: Role) => r.attempts?.findLast((a) => a.role === role);
  const roleStage = (role: Role, done: boolean, applies: boolean, detail: string, lost = false): StageView => {
    const since = waitingFor(role);
    const a = lastAttempt(role);
    const models = stageModels(a);
    // Observed only; old runs recorded roleModels before attempts existed.
    const model = a?.observed.model ?? r.roleModels?.[role] ?? 'not reported';
    if (since) return { stage: role, status: overdue(since, now) ? 'overdue' : 'running', model, provider: host, detail, since, models };
    if (lost && !done) return { stage: role, status: 'warn', model, provider: host, detail: 'no result: cancelled or expired', models };
    return { stage: role, status: done ? 'done' : applies ? 'pending' : 'skipped', model: done ? model : null, provider: done ? host : null, detail: done || applies ? detail : 'not used in this mode', models: done ? models : undefined };
  };
  const lastPlan = r.plans?.at(-1);
  const checks = Object.entries(r.checks);
  const failedChecks = checks.filter(([, c]) => c.exitCode !== 0);
  const review = r.reviews?.at(-1);
  const out: StageView[] = [
    {
      stage: 'decision',
      status: intake?.source === 'fallback' ? 'warn' : 'done',
      model: intake?.source === 'jev' ? intake.model : 'file rules',
      provider: intake?.source === 'jev' ? 'typesafe' : 'jevmind',
      detail: `${r.mode} · risk ${r.riskFloor} · by ${r.modeSource ?? 'rule'}${intake?.source === 'jev' ? ` · ${intake.latencyMs} ms` : intake ? ' · Jev failed, rules used' : ''}`,
    },
    roleStage('planner', !!lastPlan, r.mode === 'collaborative', lastPlan ? `plan ${r.plans!.length} · ${lastPlan.decision ?? 'awaiting your challenge'}` : 'plan before code'),
    {
      stage: 'implementor',
      status: !r.open ? 'done' : r.awaiting ? 'waiting' : now - Date.parse(r.updatedAt) < ACTIVE_MS ? 'running' : 'idle',
      model: r.model,
      provider: host,
      detail: `${r.touched.length} file${r.touched.length === 1 ? '' : 's'}${r.correctingAfter ? ` · fixing ${r.correctingAfter}` : ''}${r.awaiting ? ` · locked while the ${r.awaiting.role} works` : ''}`,
    },
    roleStage('tester', !!r.testerDoneAt && (!r.testerStartedAt || r.testerDoneAt >= r.testerStartedAt), false, 'tests written by the tester', Object.values(r.agentRoles ?? {}).includes('tester')),
    {
      stage: 'checks',
      status: !checks.length ? 'pending' : failedChecks.length ? 'failed' : 'done',
      model: null,
      provider: 'jevmind',
      detail: checks.length ? checks.map(([n, c]) => `${c.exitCode === 0 ? '✓' : '✗'}${n}`).join(' ') : 'not run yet',
    },
    !review
      ? { stage: 'reviewer', status: r.mode === 'solo' ? 'skipped' : 'pending', model: null, provider: null, detail: r.mode === 'solo' ? 'not required (solo)' : 'required, not started' }
      : {
          stage: 'reviewer',
          status: review.at ? (REVIEW_STATUS[review.status ?? ''] ?? 'warn') : !r.open ? 'warn' : overdue(review.startedAt, now) ? 'overdue' : 'running',
          model: review.reviewer?.model ?? null,
          provider: review.reviewer?.host ?? null,
          detail: `${review.round} · ${review.reviewer?.mode === 'cross' ? 'cross-provider' : 'subagent'}${review.at ? ` · ${review.status?.replace(/_/g, ' ')}` : ''}${review.findings.some((f) => f.confirmed) ? ` · ${review.findings.filter((f) => f.confirmed).length} blocker(s)` : ''}`,
          since: review.at || !r.open ? undefined : review.startedAt,
          models: stageModels(r.attempts?.find((a) => a.role === 'reviewer' && a.key === review.round)),
        },
    {
      stage: 'outcome',
      status: r.open ? 'pending' : (OUTCOME[r.completion?.status ?? ''] ?? 'warn'),
      model: null,
      provider: null,
      detail: r.open ? 'in progress' : `${r.completion?.status?.replace(/_/g, ' ') ?? 'closed'}${r.acceptance ? ` · ${r.acceptance.decision}` : ''}`,
    },
  ];
  return out;
}

// A Jev decision joined with what happened afterwards, so the board can show calibration.
export type BoardDecision = Decision & {
  project: string;
  outcome: { changed: boolean; runStatus: string | null; ruleRisk: string | null } | null; // null while unknown
};

export function collect(): { generatedAt: string; projects: { name: string; root: string }[]; runs: BoardRun[]; decisions: BoardDecision[]; calibrations: any[]; sessions: Record<string, SessionComparison> } {
  const projects = readJson<string[]>(registryFile(), [])
    .filter((root) => fs.existsSync(root))
    .map((root) => ({ name: path.basename(root), root }));
  const decisions: BoardDecision[] = [];
  const calibrations: any[] = [];
  const runs = projects.flatMap(({ name, root }) => {
    const all = listRuns(root);
    const decs = readDecisions(root);
    const last = readCalibrations(root).at(-1);
    if (last) {
      let raiseRisk = 0.5;
      try {
        raiseRisk = loadConfig(root).jev.thresholds.raiseRisk;
      } catch {}
      calibrations.push({ project: name, raiseRiskInUse: raiseRisk, ...last });
    }
    const byId = new Map(decs.map((d) => [d.id, d]));
    let cfg: ReturnType<typeof loadConfig> | null = null;
    try {
      cfg = loadConfig(root);
    } catch {}
    for (const d of decs) {
      const run = all.find((r) => r.decisionIds?.includes(d.id));
      // Outcome is known once edits happened, a later prompt in the session arrived, or an hour passed.
      const settled = d.point !== 'D1' ? false : run !== undefined || decs.some((o) => o.sessionId === d.sessionId && o.ts > d.ts) || Date.now() - Date.parse(d.ts) > 3600e3;
      decisions.push({
        ...d,
        project: name,
        outcome: settled
          ? { changed: run !== undefined, runStatus: run?.completion?.status ?? (run ? 'in_progress' : null), ruleRisk: run && cfg ? riskFloor(run.touched, cfg) : null }
          : null,
      });
    }
    return all.map(
      (r): BoardRun => ({
        project: name,
        runId: r.runId,
        request: r.request.slice(0, 300),
        host: r.host ?? null,
        model: r.model ?? null,
        risk: r.riskFloor,
        files: r.touched.length,
        checks: Object.entries(r.checks).map(([n, c]) => ({ name: n, exitCode: c.exitCode })),
        status: r.completion?.status ?? 'in_progress',
        open: r.open,
        createdAt: r.createdAt,
        finishedAt: r.completion?.at ?? null,
        stopBlocks: r.stopBlocks ?? 0,
        decision: r.acceptance?.decision ?? null,
        jevModel: (r.decisionIds ?? []).map((id) => byId.get(id)?.model).find(Boolean) ?? null,
        jevRaised: !!r.jevRiskFloor && cfg !== null && riskFloor(r.touched, cfg) !== r.riskFloor,
        mode: r.mode ?? 'solo',
        reviews: (r.reviews ?? []).map((v) => ({
          round: v.round,
          status: v.status,
          blockers: v.findings.filter((f) => f.confirmed).length,
          disputed: v.findings.filter((f) => f.severity === 'blocking' && !f.confirmed).length,
          reviewer: reviewerLabel(v.reviewer),
          costUsd: v.reviewer?.costUsd ?? null,
          host: v.reviewer?.host ?? null,
          model: v.reviewer?.model ?? null,
          cross: v.reviewer?.mode === 'cross',
          startedAt: v.startedAt,
          at: v.at,
        })),
        plans: (r.plans ?? []).length,
        sessionId: r.sessionId,
        updatedAt: r.updatedAt,
        modeSource: r.modeSource ?? null,
        awaiting: r.awaiting ? { role: r.awaiting.role, since: r.awaiting.since, overdue: overdue(r.awaiting.since, Date.now()) } : null,
        pipeline: pipeline(r, (r.decisionIds ?? []).map((id) => byId.get(id)).find((d) => d?.point === 'D1') ?? null),
        activity: workflowActivity(r),
        paths: r.touched.slice(0, 20),
        corrections: r.corrections ?? 0,
        usage: runUsage(r, decs.filter((d) => d.runId === r.runId || r.decisionIds?.includes(d.id))),
      }),
    );
  });
  const sessions: Record<string, SessionComparison> = {};
  for (const id of new Set(runs.map((r) => r.sessionId).filter((s): s is string => !!s))) sessions[id] = compareSessions(runs, id)!;
  return { generatedAt: new Date().toISOString(), projects, runs, decisions, calibrations, sessions };
}

// The template ships in the plugin: plugin/board.html, next to plugin/dist/ in the bundle.
function template(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = [path.join(here, '..', 'board.html'), path.join(here, '..', 'plugin', 'board.html')].find((f) => fs.existsSync(f));
  if (!file) throw new Error('board.html template not found');
  return fs.readFileSync(file, 'utf8');
}

// `<` is escaped so no request text can close the data <script> element.
const page = () => template().replace('/*__DATA__*/null', () => JSON.stringify(collect()).replaceAll('<', '\\u003c'));

export function writeBoard(): string {
  fs.mkdirSync(path.dirname(boardFile()), { recursive: true });
  fs.writeFileSync(boardFile(), page());
  return boardFile();
}

// `jevmind board --live`: the same page on localhost. /events pushes a message whenever a project's
// .jevmind/ changes (hooks write runs and decisions there), and the page then reloads /data.
export function serveBoard(port: number): Promise<http.Server> {
  const clients = new Set<http.ServerResponse>();
  let pending: NodeJS.Timeout | null = null;
  const notify = () => {
    pending ??= setTimeout(() => {
      pending = null;
      for (const c of clients) c.write('data: changed\n\n');
    }, 150);
  };
  // shortcut: projects registered after the server started are not watched; the page's 5 s poll covers them.
  const watchers = readJson<string[]>(registryFile(), []).flatMap((root) => {
    try {
      return [fs.watch(jevmindDir(root), { recursive: true }, notify)];
    } catch {
      return [];
    }
  });
  const server = http.createServer((req, res) => {
    // Only local names: a DNS-rebound page on another origin must not read the board.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return res.writeHead(403).end();
    const route = new URL(req.url ?? '/', 'http://localhost').pathname; // the page takes ?theme= and ?range=
    if (route === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }).write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const data = route === '/data';
    if (!data && route !== '/') return res.writeHead(404).end();
    try {
      res.writeHead(200, { 'content-type': data ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data ? JSON.stringify(collect()) : page());
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  server.on('close', () => watchers.forEach((w) => w.close()));
  return new Promise((ok, fail) => server.once('error', fail).listen(port, '127.0.0.1', () => ok(server)));
}

// Best-effort refresh after each run update; a board failure never affects the task.
export function refreshBoard() {
  try {
    writeBoard();
  } catch {
    /* ignored on purpose */
  }
}
