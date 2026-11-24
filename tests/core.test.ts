import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runChecks } from '../src/checks.ts';
import { type Config, loadConfig } from '../src/config.ts';
import { sourceIdentity } from '../src/project.ts';
import { patchPaths, riskFloor, writePaths } from '../src/rules.ts';
import { createRun, evaluate, type Run } from '../src/run.ts';
import { tempRepo, writeConfig } from './helpers.ts';

const cfg = (checks: Record<string, string>, critical: string[] = []) => ({
  risk: { critical, elevated: ['package.json'], humanReviewRequired: ['critical' as const] },
  checks,
  jev: { mode: 'off' as const, consent: false, dataLevel: 2 as const, thresholds: { raiseRisk: 0.5 } },
  agents: ['claude-code', 'codex'] as Config['agents'],
  review: { crossProvider: false, claudeModel: 'sonnet' },
  models: { mode: 'off' as const, routes: {} as Config['models']['routes'] }, // off: routes are never read
});
const run = (over: Partial<Run> = {}): Run => ({
  runId: 'r', sessionId: 's', host: null, model: null, request: '', mode: 'solo', riskFloor: 'low', touched: [], checks: {},
  stopBlocks: 0, open: true, createdAt: '', updatedAt: '', ...over,
});
const result = (exitCode: number, identity = 'T1') => ({ command: 'x', exitCode, identity, at: '', outputTail: '' });

test('completion precedence', () => {
  assert.equal(evaluate(run(), cfg({}), 'T1').status, 'review_required', 'no checks configured');
  assert.equal(evaluate(run(), cfg({ test: 'x' }), 'T1').status, 'review_required', 'check not run');
  assert.equal(evaluate(run({ checks: { test: result(0) } }), cfg({ test: 'x' }), 'T1').status, 'verified');
  assert.equal(evaluate(run({ checks: { test: result(0) } }), cfg({ test: 'x' }), 'T2').status, 'review_required', 'stale');
  assert.equal(evaluate(run({ checks: { test: result(1) } }), cfg({ test: 'x' }), 'T1').status, 'failed_verification');
  assert.equal(
    evaluate(run({ checks: { test: result(1), lint: result(0, 'T0') } }), cfg({ test: 'x', lint: 'y' }), 'T1').status,
    'failed_verification',
    'a failure wins over a pending gate',
  );
  const critical = run({ riskFloor: 'critical', touched: ['src/auth/x.ts'], checks: { test: result(0) } });
  assert.equal(evaluate(critical, cfg({ test: 'x' }), 'T1').status, 'review_required', 'critical needs review');
  const elevated = run({ riskFloor: 'elevated', touched: ['package.json'], checks: { test: result(0) } });
  assert.equal(evaluate(elevated, cfg({ test: 'x' }), 'T1').status, 'verified', 'elevated review is optional');
});

test('risk floor from globs', () => {
  const c = cfg({}, ['**/auth/**', '**/*payment*', '**/*payment*/**']);
  assert.equal(riskFloor(['src/auth/login.ts'], c), 'critical');
  assert.equal(riskFloor(['src/payment_service.ts'], c), 'critical');
  assert.equal(riskFloor(['src/payments/fees.ts'], c), 'critical');
  assert.equal(riskFloor(['package.json'], c), 'elevated');
  assert.equal(riskFloor(['README.md'], c), 'low');
});

test('write paths from Claude tools and Codex patches', () => {
  const root = '/repo';
  assert.deepEqual(writePaths('Write', { file_path: '/repo/src/a.ts' }, root, root), ['src/a.ts']);
  assert.deepEqual(writePaths('Edit', { file_path: 'b.ts' }, root, '/repo/src'), ['src/b.ts']);
  assert.equal(writePaths('Read', { file_path: '/repo/a' }, root, root), null);
  const patch = '*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: src/b.ts\n*** Move to: src/c.ts\n*** Delete File: d.txt\n*** End Patch';
  assert.deepEqual(patchPaths(patch), ['a.txt', 'src/b.ts', 'src/c.ts', 'd.txt']);
  assert.deepEqual(writePaths('apply_patch', { command: patch }, root, root), ['a.txt', 'src/b.ts', 'src/c.ts', 'd.txt']);
});

test('identity covers untracked files and ignores .jodex', () => {
  const root = tempRepo();
  const t0 = sourceIdentity(root);
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex', 'x.json'), '{}');
  assert.equal(sourceIdentity(root), t0);
  fs.writeFileSync(path.join(root, 'new.txt'), 'n');
  const t1 = sourceIdentity(root);
  assert.notEqual(t1, t0);
  fs.chmodSync(path.join(root, 'new.txt'), 0o755);
  assert.notEqual(sourceIdentity(root), t1, 'executable bit counts');
  fs.rmSync(path.join(root, 'README.md'));
  assert.notEqual(sourceIdentity(root), t1, 'deleting a tracked file counts');
});

test('identity works when .git is read-only (Codex workspace-write sandbox)', () => {
  const root = tempRepo();
  const t0 = sourceIdentity(root);
  execFileSync('chmod', ['-R', 'a-w', path.join(root, '.git')]);
  try {
    fs.writeFileSync(path.join(root, 'README.md'), 'changed\n');
    assert.notEqual(sourceIdentity(root), t0);
  } finally {
    execFileSync('chmod', ['-R', 'u+w', path.join(root, '.git')]);
  }
});

test('checks bind to the source they ran on', () => {
  const root = tempRepo();
  writeConfig(root, { pass: 'true', touchy: 'echo x > generated.txt' });
  const c = loadConfig(root);
  const r = createRun(root, null, '');
  runChecks(root, c, r, () => {});
  const now = sourceIdentity(root);
  assert.equal(r.checks.pass.exitCode, 0);
  assert.notEqual(r.checks.touchy.identity, now, 'a check that writes files leaves itself stale');
  assert.equal(evaluate(r, c, now).status, 'review_required');
});
