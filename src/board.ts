import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { readCalibrations } from './calibrate.ts';
import { type Decision, readDecisions } from './decisions.ts';
import { jodexDir, readJson, writeJson } from './project.ts';
import { riskFloor } from './rules.ts';
import { AWAIT_TTL_MS, listRuns, type Role, type Run } from './run.ts';

export const jodexHome = () => process.env.JODEX_HOME ?? path.join(os.homedir(), '.jodex');
const registryFile = () => path.join(jodexHome(), 'projects.json');
export const boardFile = () => path.join(jodexHome(), 'board', 'board.html');

// Projects that ran `jodex init`, so the board can find their runs.
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
  paths: string[];
};

// The harness flow of one run, stage by stage, with the model behind each and its status.
export type StageStatus = 'done' | 'running' | 'waiting' | 'idle' | 'pending' | 'skipped' | 'warn' | 'failed' | 'overdue';
export type StageView = { stage: string; status: StageStatus; model: string | null; provider: string | null; detail: string; since?: string };
type Intake = Pick<Decision, 'source' | 'model' | 'latencyMs'> | null;

const reviewerLabel = (v?: { host: string; mode: string }) => (v ? `${v.host}${v.mode === 'cross' ? ' (cross)' : ''}` : null);
const ACTIVE_MS = 120e3;
const overdue = (since: string, now: number) => now - Date.parse(since) >= AWAIT_TTL_MS;
const REVIEW_STATUS: Record<string, StageStatus> = { no_blocking_findings: 'done', changes_required: 'failed', insufficient_evidence: 'warn', invalid: 'failed' };
const OUTCOME: Record<string, StageStatus> = { verified: 'done', review_required: 'warn', failed_verification: 'failed', blocked: 'failed' };

export function pipeline(r: Run, intake: Intake, now = Date.now()): StageView[] {
  const host = r.host ?? 'cli';
  const waitingFor = (role: string) => (r.awaiting?.role === role ? r.awaiting.since : null);
  const roleStage = (role: string, done: boolean, applies: boolean, detail: string, lost = false): StageView => {
    const since = waitingFor(role);
    const model = r.roleModels?.[role as Role] ?? `${host} subagent (model not reported yet)`;
    if (since) return { stage: role, status: overdue(since, now) ? 'overdue' : 'running', model, provider: host, detail, since };
    if (lost && !done) return { stage: role, status: 'warn', model, provider: host, detail: 'no result: cancelled or expired' };
    return { stage: role, status: done ? 'done' : applies ? 'pending' : 'skipped', model: done ? model : null, provider: done ? host : null, detail: done || applies ? detail : 'not used in this mode' };
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
      provider: intake?.source === 'jev' ? 'typesafe' : 'jodex',
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
      provider: 'jodex',
      detail: checks.length ? checks.map(([n, c]) => `${c.exitCode === 0 ? '✓' : '✗'}${n}`).join(' ') : 'not run yet',
    },
    !review
      ? { stage: 'reviewer', status: r.mode === 'solo' ? 'skipped' : 'pending', model: null, provider: null, detail: r.mode === 'solo' ? 'not required (solo)' : 'required, not started' }
      : {
          stage: 'reviewer',
          status: review.at ? (REVIEW_STATUS[review.status ?? ''] ?? 'warn') : overdue(review.startedAt, now) ? 'overdue' : 'running',
          model: review.reviewer?.model ?? null,
          provider: review.reviewer?.host ?? null,
          detail: `${review.round} · ${review.reviewer?.mode === 'cross' ? 'cross-provider' : 'subagent'}${review.at ? ` · ${review.status?.replace(/_/g, ' ')}` : ''}${review.findings.some((f) => f.confirmed) ? ` · ${review.findings.filter((f) => f.confirmed).length} blocker(s)` : ''}`,
          since: review.at ? undefined : review.startedAt,
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

export function collect(): { generatedAt: string; projects: { name: string; root: string }[]; runs: BoardRun[]; decisions: BoardDecision[]; calibrations: any[] } {
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
        paths: r.touched.slice(0, 20),
      }),
    );
  });
  return { generatedAt: new Date().toISOString(), projects, runs, decisions, calibrations };
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

// `jodex board --live`: the same page on localhost. /events pushes a message whenever a project's
// .jodex/ changes (hooks write runs and decisions there), and the page then reloads /data.
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
      return [fs.watch(jodexDir(root), { recursive: true }, notify)];
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
