import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { readCalibrations } from './calibrate.ts';
import { type Decision, readDecisions } from './decisions.ts';
import { readJson, writeJson } from './project.ts';
import { riskFloor } from './rules.ts';
import { listRuns } from './run.ts';

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
};

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
          reviewer: v.reviewer ? `${v.reviewer.host}${v.reviewer.mode === 'cross' ? ' (cross)' : ''}` : null,
          costUsd: v.reviewer?.costUsd ?? null,
        })),
        plans: (r.plans ?? []).length,
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

export function writeBoard(): string {
  // `<` is escaped so no request text can close the data <script> element.
  const data = JSON.stringify(collect()).replaceAll('<', '\\u003c');
  fs.mkdirSync(path.dirname(boardFile()), { recursive: true });
  fs.writeFileSync(boardFile(), template().replace('/*__DATA__*/null', () => data));
  return boardFile();
}

// Best-effort refresh after each run update; a board failure never affects the task.
export function refreshBoard() {
  try {
    writeBoard();
  } catch {
    /* ignored on purpose */
  }
}
