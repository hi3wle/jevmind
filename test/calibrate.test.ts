import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { calibrate, maybeAutoCalibrate, proposeCut, readCalibrations } from '../src/calibrate.ts';
import { loadConfig } from '../src/config.ts';
import { appendDecision } from '../src/decisions.ts';
import { createRun, saveRun } from '../src/run.ts';
import { tempRepo } from './helpers.ts';

test('cut proposal needs enough labels of both kinds, then maximizes balanced accuracy', () => {
  assert.equal(proposeCut([{ p: 0.9, y: 1 }], 0.5).proposed, null);
  // Risky runs score 0.70-0.92, routine ones 0.20-0.585: cuts 0.6-0.7 all separate them; the tie goes
  // to the cut nearest the current 0.5, so thresholds do not drift on noise.
  const pts = [...Array.from({ length: 12 }, (_, i) => ({ p: 0.7 + i * 0.02, y: 1 as const })), ...Array.from({ length: 12 }, (_, i) => ({ p: 0.2 + i * 0.035, y: 0 as const }))];
  const r = proposeCut(pts, 0.5);
  assert.equal(r.proposed, 0.6);
  assert.equal(r.balancedAccuracy, 1);
});

function lab() {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), '[risk]\ncritical = ["**/auth/**"]\n[checks]\ntest = "true"\n[jev]\nmode = "enforce"\nconsent = true\n');
  // 24 closed runs: auth edits are risky by rule; Jev's risk probability separates them at ~0.65.
  for (let i = 0; i < 24; i++) {
    const risky = i % 2 === 0;
    const id = `d${i}`;
    appendDecision(root, { id, ts: new Date(Date.now() - (24 - i) * 1000).toISOString(), point: 'D1', sessionId: `s${i}`, runId: null, source: 'jev', model: 'jev', latencyMs: 1, answers: { isChange: 0.9, mode: { value: 'solo', probabilities: { solo: 1 } }, risk: { value: risky ? 'critical' : 'low', probabilities: { low: 0, elevated: risky ? 0.4 : 0.3, critical: risky ? 0.45 : 0.25 }, confidence: 0.5 }, missingRule: 0 }, thresholds: { clarify: 0.6, missingRule: 0.7, raiseRisk: 0.5, recommendMode: 0.5 }, action: null, actedOn: true, request: '' });
    const run = createRun(root, `s${i}`, 'x');
    Object.assign(run, { touched: [risky ? 'src/auth/a.js' : 'README.md'], decisionIds: [id], open: false });
    saveRun(root, run);
  }
  return root;
}

test('calibrate --apply moves the risk cut, logs it, and the config clamps it', () => {
  const root = lab();
  const r = calibrate(root, true);
  assert.equal(r.applied, true);
  assert.ok(r.raiseRisk.proposed! > 0.55 && r.raiseRisk.proposed! <= 0.85, String(r.raiseRisk.proposed));
  assert.equal(loadConfig(root).jev.thresholds.raiseRisk, r.raiseRisk.proposed);
  assert.match(fs.readFileSync(path.join(root, '.jodex/config.toml'), 'utf8'), /\[jev\.thresholds\]\n# Written by `jodex calibrate`\.\nraise_risk = /);
  assert.equal(readCalibrations(root).length, 1);
  fs.appendFileSync(path.join(root, '.jodex/config.toml'), ''); // second apply keeps one line
  calibrate(root, true);
  assert.equal((fs.readFileSync(path.join(root, '.jodex/config.toml'), 'utf8').match(/raise_risk/g) ?? []).length, 1);
});

test('automatic calibration runs once per 10 closed runs', () => {
  const root = lab();
  maybeAutoCalibrate(root);
  maybeAutoCalibrate(root);
  const autos = readCalibrations(root).filter((c) => c.auto);
  assert.equal(autos.length, 1);
  assert.equal(autos[0].closedRuns, 24);
});

test('discarded runs and their decisions are left out of calibration', () => {
  const root = lab();
  const before = calibrate(root, false).signals.find((s) => s.signal === 'D1 risk')!.n;
  const run = createRun(root, 'sx', 'x');
  appendDecision(root, { id: 'dx', ts: new Date().toISOString(), point: 'D1', sessionId: 'sx', runId: null, source: 'jev', model: 'jev', latencyMs: 1, answers: { isChange: 0.9, mode: { value: 'solo', probabilities: { solo: 1 } }, risk: { value: 'low', probabilities: { low: 1, elevated: 0, critical: 0 }, confidence: 1 }, missingRule: 0 }, thresholds: { clarify: 0.6, missingRule: 0.7, raiseRisk: 0.5, recommendMode: 0.5 }, action: null, actedOn: true, request: '' });
  Object.assign(run, { touched: ['src/auth/a.js'], decisionIds: ['dx'], open: false, acceptance: { decision: 'discarded', at: '' } });
  saveRun(root, run);
  const after = calibrate(root, false).signals;
  assert.equal(after.find((s) => s.signal === 'D1 risk')!.n, before);
  assert.equal(after.find((s) => s.signal === 'D1 change')!.n, 24);
});
