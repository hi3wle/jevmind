import fs from 'node:fs';
import path from 'node:path';
import { type Config, loadConfig } from './config.ts';
import { configPath, jodexDir } from './project.ts';
import { readDecisions } from './decisions.ts';
import { riskFloor } from './rules.ts';
import { listRuns } from './run.ts';

// Thresholds are only moved with enough labeled outcomes of both kinds (spec §6.7).
export const MIN_LABELED = 20;
export const MIN_PER_CLASS = 5;
export const AUTO_EVERY = 10; // closed runs between automatic calibrations
const CUTS = Array.from({ length: 13 }, (_, i) => +(0.3 + i * 0.05).toFixed(2));

type Point = { p: number; y: 0 | 1 };
export type Reliability = { band: string; n: number; predicted: number; observed: number }[];
export type SignalReport = { signal: string; n: number; positives: number; brier: number | null; reliability: Reliability; label: string };
export type CalibrationReport = {
  ts: string;
  signals: SignalReport[];
  raiseRisk: { current: number; proposed: number | null; reason: string; balancedAccuracy?: number };
  applied: boolean;
  closedRuns?: number; // set by automatic runs
  auto?: boolean;
};

const logFile = (root: string) => path.join(jodexDir(root), 'calibration.jsonl');

function reliability(points: Point[]): Reliability {
  const bands = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  return bands.slice(0, -1).flatMap((lo, i) => {
    const inBand = points.filter((x) => x.p >= lo && x.p < bands[i + 1]);
    if (!inBand.length) return [];
    const mean = (f: (x: Point) => number) => +(inBand.reduce((s, x) => s + f(x), 0) / inBand.length).toFixed(3);
    return [{ band: `${lo.toFixed(1)}-${Math.min(1, bands[i + 1]).toFixed(1)}`, n: inBand.length, predicted: mean((x) => x.p), observed: mean((x) => x.y) }];
  });
}

const report = (signal: string, label: string, points: Point[]): SignalReport => ({
  signal,
  label,
  n: points.length,
  positives: points.filter((x) => x.y).length,
  brier: points.length ? +(points.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / points.length).toFixed(4) : null,
  reliability: reliability(points),
});

// Builds labeled points from logged Jev decisions joined with what the runs showed.
export function collectPoints(root: string, cfg: Config) {
  const all = listRuns(root);
  const runs = all.filter((r) => r.acceptance?.decision !== 'discarded');
  // Decisions of discarded runs are no evidence either way, not even "no edits".
  const dropped = new Set(all.filter((r) => !runs.includes(r)).flatMap((r) => [r.runId, ...(r.decisionIds ?? [])]));
  const decisions = readDecisions(root).filter((d) => d.source === 'jev' && !dropped.has(d.id) && !(d.runId && dropped.has(d.runId)));
  const change: Point[] = [];
  const risk: Point[] = [];
  const blocker: Point[] = [];
  for (const d of decisions) {
    if (d.point === 'D1' && d.answers) {
      const run = runs.find((r) => r.decisionIds?.includes(d.id));
      const later = decisions.some((o) => o.point === 'D1' && o.sessionId === d.sessionId && o.ts > d.ts);
      // Settled once edits happened, a later prompt came, or an hour passed (same rule as the board).
      if (run || later || Date.now() - Date.parse(d.ts) > 3600e3) change.push({ p: d.answers.isChange, y: run && run.touched.length ? 1 : 0 });
      // Risk label: the files hit a protected path, a review confirmed a blocker, or the developer rejected the run.
      if (run?.touched.length && !run.open) {
        const y = riskFloor(run.touched, cfg) !== 'low' || (run.reviews ?? []).some((v) => v.findings.some((f) => f.confirmed)) || run.acceptance?.decision === 'rejected';
        risk.push({ p: (d.answers.risk.probabilities.elevated ?? 0) + (d.answers.risk.probabilities.critical ?? 0), y: y ? 1 : 0 });
      }
    }
    // D4 label: a later round of the same run no longer reports the finding's location as blocking
    // after a fix (the blocker was real and got fixed) versus it being disputed and left alone.
    if (d.point === 'D4' && d.d4 && d.finding && d.runId) {
      const run = runs.find((r) => r.runId === d.runId);
      const rounds = run?.reviews ?? [];
      const i = rounds.findIndex((v) => v.round === d.finding!.round);
      const next = rounds[i + 1];
      if (next?.at && next.status !== 'invalid') blocker.push({ p: d.d4.probabilities.blocker ?? 0, y: run!.correctingAfter === d.finding.round ? 1 : 0 });
    }
  }
  return { change, risk, blocker };
}

// Chooses the raise-risk cut that best separates risky from routine runs (balanced accuracy).
export function proposeCut(points: Point[], current: number): CalibrationReport['raiseRisk'] {
  const pos = points.filter((x) => x.y).length;
  const neg = points.length - pos;
  if (points.length < MIN_LABELED || pos < MIN_PER_CLASS || neg < MIN_PER_CLASS)
    return { current, proposed: null, reason: `needs ${MIN_LABELED} labeled runs with ${MIN_PER_CLASS}+ of each kind (have ${points.length}: ${pos} risky, ${neg} routine)` };
  const score = (t: number) => {
    const tpr = points.filter((x) => x.y && x.p >= t).length / pos;
    const tnr = points.filter((x) => !x.y && x.p < t).length / neg;
    return (tpr + tnr) / 2;
  };
  // Ties prefer the cut closest to the current one, so thresholds do not drift on noise.
  const best = CUTS.reduce((a, t) => (score(t) > score(a) + 1e-9 || (Math.abs(score(t) - score(a)) < 1e-9 && Math.abs(t - current) < Math.abs(a - current)) ? t : a), current);
  return { current, proposed: best, reason: `best balanced accuracy over ${points.length} runs`, balancedAccuracy: +score(best).toFixed(3) };
}

export function calibrate(root: string, apply: boolean, meta: { closedRuns?: number; auto?: boolean } = {}): CalibrationReport {
  const cfg = loadConfig(root);
  const { change, risk, blocker } = collectPoints(root, cfg);
  const raiseRisk = proposeCut(risk, cfg.jev.thresholds.raiseRisk);
  const applied = apply && raiseRisk.proposed !== null && raiseRisk.proposed !== raiseRisk.current;
  if (applied) writeThreshold(root, 'raise_risk', raiseRisk.proposed!);
  const out: CalibrationReport = {
    ts: new Date().toISOString(),
    signals: [
      report('D1 change', 'prompt led to file edits', change),
      report('D1 risk', 'protected path, confirmed blocker or rejected run', risk),
      report('D4 blocker', 'a correction followed the finding', blocker),
    ],
    raiseRisk,
    applied,
    ...meta,
  };
  fs.mkdirSync(jodexDir(root), { recursive: true });
  fs.appendFileSync(logFile(root), JSON.stringify(out) + '\n');
  return out;
}

// Writes `[jev.thresholds] <key> = <value>` into the project config, keeping everything else.
function writeThreshold(root: string, key: string, value: number) {
  const file = configPath(root);
  let text = fs.readFileSync(file, 'utf8');
  if (!/^\[jev\.thresholds\]/m.test(text)) text = `${text.replace(/\n*$/, '\n')}\n[jev.thresholds]\n# Written by \`jodex calibrate\`.\n`;
  const line = `${key} = ${value}`;
  const re = new RegExp(`^${key}\\s*=.*$`, 'm');
  const section = text.indexOf('[jev.thresholds]');
  const after = text.slice(section);
  text = re.test(after) ? text.slice(0, section) + after.replace(re, line) : `${text.replace(/\n*$/, '\n')}${line}\n`;
  fs.writeFileSync(file, text);
}

// Runs calibration after every AUTO_EVERY closed runs; never throws into a hook.
export function maybeAutoCalibrate(root: string) {
  try {
    const cfg = loadConfig(root);
    if (cfg.jev.mode === 'off') return;
    const closed = listRuns(root).filter((r) => !r.open).length;
    const last = readLastCalibration(root);
    const lastClosed = last?.closedRuns ?? 0;
    if (closed - lastClosed < AUTO_EVERY) return;
    calibrate(root, true, { closedRuns: closed, auto: true });
  } catch {
    /* calibration is best-effort */
  }
}

export function readCalibrations(root: string): any[] {
  try {
    return fs.readFileSync(logFile(root), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
const readLastCalibration = (root: string) => readCalibrations(root).findLast((c) => c.closedRuns !== undefined);
