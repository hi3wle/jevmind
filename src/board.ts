import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { readCalibrations } from './calibrate.ts';
import { type Decision, readDecisions } from './decisions.ts';
import { readJson, writeJson } from './project.ts';
import { riskFloor } from './rules.ts';
import { listRuns, type Run } from './run.ts';

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
  reviews: { round: string; status: string | null; blockers: number; disputed: number; reviewer: string | null; costUsd: number | null }[];
  plans: number;
  // Live map: where the run is now, as last recorded by the hooks (not proof a process is running).
  sessionId: string | null;
  updatedAt: string;
  modeSource: string | null;
  stage: Stage;
  seen: Stage[]; // stages with recorded evidence; skipped ones are not shown as done
  awaiting: { role: string; since: string; reviewer: string | null } | null;
  paths: string[];
};

const reviewerLabel = (v?: { host: string; mode: string }) => (v ? `${v.host}${v.mode === 'cross' ? ' (cross)' : ''}` : null);

export const STAGES = ['intake', 'plan', 'implement', 'test', 'check', 'review', 'fix', 'done'] as const;
export type Stage = (typeof STAGES)[number];
const ROLE_STAGE: Record<string, Stage> = { planner: 'plan', tester: 'test', reviewer: 'review' };

export function stageOf(r: Run): Stage {
  if (!r.open) return 'done';
  if (r.awaiting) return ROLE_STAGE[r.awaiting.role] ?? 'implement';
  if (r.correctingAfter && r.reviews?.at(-1)?.round === r.correctingAfter) return 'fix';
  if ((r.reviews ?? []).length) return 'review';
  if (Object.keys(r.checks).length) return 'check';
  return r.touched.length ? 'implement' : 'intake';
}

export function stagesSeen(r: Run): Stage[] {
  const has: Record<Stage, boolean> = {
    intake: true,
    plan: !!r.plans?.length,
    implement: r.touched.length > 0,
    test: Object.values(r.agentRoles ?? {}).includes('tester'),
    check: Object.keys(r.checks).length > 0,
    review: !!r.reviews?.length,
    fix: !!r.corrections,
    done: !r.open,
  };
  return STAGES.filter((s) => has[s]);
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
        })),
        plans: (r.plans ?? []).length,
        sessionId: r.sessionId,
        updatedAt: r.updatedAt,
        modeSource: r.modeSource ?? null,
        stage: stageOf(r),
        seen: stagesSeen(r),
        awaiting: r.awaiting ? { role: r.awaiting.role, since: r.awaiting.since, reviewer: r.awaiting.role === 'reviewer' ? reviewerLabel((r.reviews ?? []).at(-1)?.reviewer) : null } : null,
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

// `jodex board --live`: the same page on localhost; it polls /data for the live map.
export function serveBoard(port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    // Only local names: a DNS-rebound page on another origin must not read the board.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) return res.writeHead(403).end();
    const data = req.url === '/data';
    if (!data && req.url !== '/') return res.writeHead(404).end();
    try {
      res.writeHead(200, { 'content-type': data ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data ? JSON.stringify(collect()) : page());
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
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
