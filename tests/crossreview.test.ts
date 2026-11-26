import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { launchReviewer, planReviewFile, runPlanReview, runReviewer } from '../src/crossreview.ts';
import { handleHook } from '../src/hooks.ts';
import { createRun, listRuns, type Run, saveRun } from '../src/run.ts';
import { runDir, startReview } from '../src/team.ts';
import { tempRepo } from './helpers.ts';

// Fake provider CLIs: each answers --version and returns a ReviewResult for the snapshot in the brief.
// Claude reports the model it was asked for (--model) unless FAKE_CLAUDE_USAGE sets modelUsage;
// Codex prints its settings banner unless FAKE_CODEX_NO_BANNER is set.
const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-'));
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome-'));
fs.writeFileSync(path.join(process.env.CODEX_HOME, 'config.toml'), 'model = "gpt-config"\n');
const result = (status: string) => `const brief = process.argv.find((a) => a.includes('Snapshot ID')) || '';
const id = (brief.match(/"snapshotId": "([0-9a-f]+)"/) || [])[1];
const r = '\`\`\`json\\n' + JSON.stringify({ snapshotId: id, status: '${status}', findings: [] }) + '\\n\`\`\`';`;
fs.writeFileSync(path.join(bin, 'codex'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('codex-cli fake'); process.exit(0); }
if (process.env.FAKE_ARGV_LOG) require('fs').appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(process.argv.slice(2).filter((a) => !a.includes('Snapshot ID'))) + '\\n');
if (process.argv.includes('read-only') === false) process.exit(3);
${result('no_blocking_findings')}
if (!process.env.FAKE_CODEX_NO_BANNER) console.error('model: gpt-fake\\nreasoning effort: high');
require('fs').writeFileSync(process.argv[process.argv.indexOf('-o') + 1], 'Reviewed.\\n' + r);
`);
fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('claude fake'); process.exit(0); }
if (process.env.FAKE_ARGV_LOG) require('fs').appendFileSync(process.env.FAKE_ARGV_LOG, JSON.stringify(process.argv.slice(2).filter((a) => !a.includes('Snapshot ID'))) + '\\n');
if (!process.argv.includes('Read,Glob,Grep')) process.exit(3);
${result('no_blocking_findings')}
const model = process.argv[process.argv.indexOf('--model') + 1];
const usage = process.env.FAKE_CLAUDE_USAGE ? JSON.parse(process.env.FAKE_CLAUDE_USAGE) : { ['claude-' + model + '-fake']: {} };
console.log(JSON.stringify({ result: 'Reviewed.\\n' + r, total_cost_usd: 0.01, modelUsage: usage }));
`);
for (const f of ['codex', 'claude']) fs.chmodSync(path.join(bin, f), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
delete process.env.CODEX_SESSION_ID; // spawned CLIs must pick the fixture's run, not the invoking Codex session's

type Worker = 'claude-code' | 'codex';
function repo(review = '') {
  const root = tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  fs.mkdirSync(path.join(root, '.jevmind'));
  fs.writeFileSync(path.join(root, '.jevmind/config.toml'), `[risk]\ncritical = []\n[checks]\ntest = "true"\n[review]\n${review}\n`);
  return root;
}
const find = (root: string, runId: string) => listRuns(root).find((r) => r.runId === runId)!;
const reviewerAttempt = (r: Run, round = 'R0') => r.attempts!.find((a) => a.role === 'reviewer' && a.key === round)!;

// A cross review started by `worker`, saved and not yet run.
async function reviewing(root: string, worker: Worker, cross = true): Promise<Run> {
  const extra = worker === 'codex' ? { turn_id: 't' } : {};
  const ev = (name: string, more: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra, ...more });
  await handleHook(ev('UserPromptSubmit', { prompt: 'review: change a' }));
  await handleHook(ev('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') } }));
  fs.writeFileSync(path.join(root, 'src/a.js'), `export const a = ${Math.random()};\n`);
  const run = listRuns(root)[0];
  runChecks(root, loadConfig(root), run, () => {});
  const text = startReview(root, run, loadConfig(root)).text;
  if (cross) assert.match(text, /cross-provider review/);
  else assert.doesNotMatch(text, /cross-provider review/);
  saveRun(root, run);
  return run;
}

test('apply requests the routed reviewer pair for same-host and detached reviews', () => {
  for (const sameHost of [true, false]) {
    const root = repo('claude_model = "haiku"');
    fs.appendFileSync(path.join(root, '.jevmind/config.toml'), '\n[models]\nmode = "apply"\n');
    const cfg = loadConfig(root);
    const run = createRun(root, null, 'review changed source');
    run.host = 'codex';
    run.mode = 'review';
    run.touched = ['src/a.js'];
    fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
    runChecks(root, cfg, run, () => {});
    const out = startReview(root, run, cfg, sameHost);
    assert.equal(out.ok, true, out.text);
    const attempt = reviewerAttempt(run);
    // Codex worker: the same-host reviewer is Codex; the cross reviewer is Claude, whose table pair beats claude_model.
    assert.deepEqual(attempt.requested, sameHost ? { model: 'gpt-6.2-sol', effort: 'medium' } : { model: 'sonnet', effort: 'medium' });
    assert.equal(attempt.launch, sameHost ? 'subagent' : 'detached');
    assert.equal(attempt.observed.model, null);
    if (sameHost) {
      assert.match(out.text, /"model":"gpt-6.2-sol"/);
      assert.match(out.text, /"reasoning_effort":"medium"/);
    }
  }
});

test('same-host Claude reviewer under apply: launch text carries model and effort', () => {
  const root = repo();
  fs.appendFileSync(path.join(root, '.jevmind/config.toml'), '\n[models]\nmode = "apply"\n');
  const cfg = loadConfig(root);
  const run = createRun(root, null, 'review changed source');
  run.host = 'claude-code';
  run.mode = 'review';
  run.touched = ['src/a.js'];
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  runChecks(root, cfg, run, () => {});
  const out = startReview(root, run, cfg, true);
  assert.equal(out.ok, true, out.text);
  assert.deepEqual(reviewerAttempt(run).requested, { model: 'sonnet', effort: 'medium' });
  assert.match(out.text, /"subagent_type":"jevmind:reviewer"/);
  assert.match(out.text, /"model":"sonnet"/);
  assert.match(out.text, /"effort":"medium"/);
});

// argv of each fake CLI call, minus the brief.
async function argvOf(worker: Worker, mode: 'off' | 'apply'): Promise<string[][]> {
  const root = repo();
  if (mode === 'apply') fs.appendFileSync(path.join(root, '.jevmind/config.toml'), '\n[models]\nmode = "apply"\n');
  const run = await reviewing(root, worker);
  const log = path.join(root, 'argv.log');
  process.env.FAKE_ARGV_LOG = log;
  try {
    await runReviewer(root, run.runId, 'R0');
  } finally {
    delete process.env.FAKE_ARGV_LOG;
  }
  return fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a[0] !== '--version');
}
const after = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

test('apply: the Codex cross reviewer gets --model and the reasoning effort config', async () => {
  const [argv] = await argvOf('claude-code', 'apply');
  assert.equal(after(argv, '--model'), 'gpt-6.2-sol');
  assert.ok(argv.includes('model_reasoning_effort="medium"'), argv.join(' '));
  assert.equal(argv[argv.indexOf('model_reasoning_effort="medium"') - 1], '-c');
});

test('apply: the Claude cross reviewer gets --model and --effort', async () => {
  const [argv] = await argvOf('codex', 'apply');
  assert.equal(after(argv, '--model'), 'sonnet');
  assert.equal(after(argv, '--effort'), 'medium');
});

test('off: the Codex cross reviewer is launched without --model or an effort; Claude keeps its alias and no --effort', async () => {
  const [codex] = await argvOf('claude-code', 'off');
  assert.equal(codex.includes('--model'), false);
  assert.equal(codex.some((a) => a.includes('model_reasoning_effort')), false);
  const [claude] = await argvOf('codex', 'off');
  assert.equal(after(claude, '--model'), 'sonnet');
  assert.equal(claude.includes('--effort'), false);
});

for (const [worker, reviewer] of [['claude-code', 'codex'], ['codex', 'claude-code']] as const) {
  test(`${worker} work is reviewed by ${reviewer}`, async () => {
    const root = repo();
    let run = await reviewing(root, worker);
    assert.equal(run.reviews![0].reviewer!.host, reviewer);
    assert.equal(run.reviews![0].reviewer!.model, null, 'no model is claimed before the reviewer reports');
    const a = reviewerAttempt(run);
    assert.deepEqual([a.launch, a.since, a.requested.model], ['detached', run.reviews![0].startedAt, reviewer === 'claude-code' ? 'sonnet' : null]);
    await runReviewer(root, run.runId, 'R0');
    run = find(root, run.runId);
    assert.equal(run.reviews![0].status, 'no_blocking_findings');
    assert.equal(run.awaiting, null);
    const observed = reviewer === 'codex' ? { model: 'gpt-fake', effort: 'high', source: 'codex-banner' } : { model: 'claude-sonnet-fake', effort: null, source: 'claude-json' };
    assert.equal(run.reviews![0].reviewer!.model, observed.model, 'the CLI reports the model');
    const o = reviewerAttempt(run).observed;
    assert.deepEqual([o.model, o.effort, o.source], [observed.model, observed.effort, observed.source]);
    assert.equal(reviewerAttempt(run).mismatch, 'unknown', 'alias or nothing requested: not comparable');
    assert.equal(reviewerAttempt(run).usage, null, 'Codex reports no tokens; Claude without counts is unknown');
  });
}

test('R3.7: a roundless or late reviewer worker does not touch the current round', async () => {
  const root = repo();
  const run = await reviewing(root, 'claude-code');
  Object.assign(run.reviews![0], { at: new Date().toISOString(), status: 'invalid' });
  run.awaiting = null;
  assert.equal(startReview(root, run, loadConfig(root)).ok, true);
  saveRun(root, run);
  await runReviewer(root, run.runId, undefined);
  await runReviewer(root, run.runId, 'R0');
  const r = find(root, run.runId);
  assert.deepEqual([r.reviews![1].round, r.reviews![1].at, r.awaiting?.role], ['R1', null, 'reviewer']);
  assert.equal(reviewerAttempt(r, 'R1').observed.model, null);
});

test('launchReviewer spawns one reviewer per round across processes', async () => {
  const root = repo();
  const run = await reviewing(root, 'claude-code');
  const stale = structuredClone(run); // another process's copy, read before the launch
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-'));
  const log = path.join(dir, 'spawned.log');
  const script = path.join(dir, 'fake-jevmind.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');\n`);
  assert.equal(launchReviewer(root, run, script), true);
  assert.equal(launchReviewer(root, stale, script), false);
  for (let i = 0; i < 50 && !fs.existsSync(log); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [`review run ${run.runId} R0`]);
  assert.ok(find(root, run.runId).reviews![0].reviewer!.launchedAt);
});

test('R4: the detached `review run` worker runs its named run even when another session is newest', async () => {
  const root = repo();
  const run = await reviewing(root, 'claude-code');
  await new Promise((r) => setTimeout(r, 20));
  await handleHook({ hook_event_name: 'UserPromptSubmit', session_id: 'OTHER', cwd: root, turn_id: 'o', prompt: 'unrelated' });
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const out = spawnSync(process.execPath, [cli, 'review', 'run', run.runId, 'R0'], { cwd: root, encoding: 'utf8', env: { ...process.env, JEVMIND_DISABLE: '1' } });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(/No open Jevmind run/.test(out.stdout + out.stderr), false);
  assert.equal(find(root, run.runId).reviews![0].status, 'no_blocking_findings');
});

test('A#7: `review wait` inside the Codex sandbox does not launch an unlaunched cross reviewer', async () => {
  const root = repo();
  const run = await reviewing(root, 'claude-code');
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const out = spawnSync(process.execPath, [cli, 'review', 'wait'], { cwd: root, encoding: 'utf8', env: { ...process.env, JEVMIND_DISABLE: '1', CODEX_SANDBOX: 'seatbelt' } });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /The reviewer was not started: the Jevmind hook did not launch it/);
  assert.equal(fs.existsSync(path.join(runDir(root, run), 'R0.launch')), false, 'no launch marker');
  const r = find(root, run.runId).reviews![0];
  assert.deepEqual([r.status, r.at, r.reviewer!.launchedAt ?? null], [null, null, null], 'the review is still pending, not invalid');
});

test('R1: `review plan` inside the Codex sandbox reports an unlaunched plan review at once', () => {
  const root = repo();
  const run = createRun(root, 'S', 'redesign a', 'claude-code');
  const plan = path.join(runDir(root, run), 'plan-0.md');
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, '# Plan\n- change a\n');
  run.plans = [{ revision: 'x', file: path.relative(root, plan), at: '', decision: null }];
  saveRun(root, run);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const t0 = Date.now();
  const out = spawnSync(process.execPath, [cli, 'review', 'plan'], { cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, JEVMIND_DISABLE: '1', CODEX_SANDBOX: 'seatbelt' } });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /The plan review was not started: the Jevmind hook did not launch it/);
  assert.ok(Date.now() - t0 < 10_000, 'no wait for the 100 s poll');
  const file = planReviewFile(root, run, 0);
  assert.equal(fs.existsSync(file), false, 'no plan review');
  assert.equal(fs.existsSync(file.replace(/\.md$/, '.launch')), false, 'no launch marker');
});

test('the Claude reviewer runs with the model frozen at review start', async () => {
  const root = repo('claude_model = "frozen-model"');
  const run = await reviewing(root, 'codex');
  fs.writeFileSync(path.join(root, '.jevmind/config.toml'), '[risk]\ncritical = []\n[checks]\ntest = "true"\n[review]\nclaude_model = "changed-model"\n');
  await runReviewer(root, run.runId, 'R0');
  const a = reviewerAttempt(find(root, run.runId));
  assert.deepEqual([a.requested.model, a.observed.model], ['frozen-model', 'claude-frozen-model-fake']);
  assert.equal(a.mismatch, true, 'a non-alias request differs from the reported full id');
});

test('several Claude models in one review: no reviewer model, the usage leader is kept', async () => {
  const root = repo();
  const run = await reviewing(root, 'codex');
  process.env.FAKE_CLAUDE_USAGE = JSON.stringify({ 'claude-haiku-x': { outputTokens: 5 }, 'claude-sonnet-x': { outputTokens: 50 } });
  try {
    await runReviewer(root, run.runId, 'R0');
  } finally {
    delete process.env.FAKE_CLAUDE_USAGE;
  }
  const r = find(root, run.runId);
  const o = reviewerAttempt(r).observed;
  assert.deepEqual([o.model, o.models, o.usageLeader], [null, ['claude-haiku-x', 'claude-sonnet-x'], 'claude-sonnet-x']);
  assert.equal(r.reviews![0].reviewer!.model, null);
  assert.equal(r.reviews![0].status, 'no_blocking_findings');
  assert.equal(reviewerAttempt(r).usage, null, 'counts missing: unknown, not 0');
});

test('Claude cross reviewer tokens are summed over modelUsage when every count is reported', async () => {
  const root = repo();
  const run = await reviewing(root, 'codex');
  const counts = (i: number, o: number) => ({ inputTokens: i, outputTokens: o, cacheReadInputTokens: 100, cacheCreationInputTokens: 7 });
  process.env.FAKE_CLAUDE_USAGE = JSON.stringify({ 'claude-haiku-x': counts(1, 2), 'claude-sonnet-x': counts(10, 20) });
  try {
    await runReviewer(root, run.runId, 'R0');
  } finally {
    delete process.env.FAKE_CLAUDE_USAGE;
  }
  assert.deepEqual(reviewerAttempt(find(root, run.runId)).usage, { input: 11, output: 22, cacheRead: 200, cacheWrite: 14, source: 'claude-json' });
});

test('a Codex banner without a model leaves the model unknown', async () => {
  const root = repo();
  const run = await reviewing(root, 'claude-code');
  process.env.FAKE_CODEX_NO_BANNER = '1';
  try {
    await runReviewer(root, run.runId, 'R0');
  } finally {
    delete process.env.FAKE_CODEX_NO_BANNER;
  }
  const r = find(root, run.runId);
  assert.deepEqual([reviewerAttempt(r).observed.model, r.reviews![0].reviewer!.model], [null, null]);
});

for (const [worker, by] of [['claude-code', 'Codex \\(gpt-fake\\)'], ['codex', 'Claude Code \\(claude-sonnet-fake\\)']] as const) {
  test(`P0c: a ${worker} plan is reviewed by the other provider as advice only`, () => {
    const root = repo();
    const run = createRun(root, 'S', 'redesign a', worker);
    const plan = path.join(runDir(root, run), 'plan-0.md'); // where recordSubagent stores plans
    fs.mkdirSync(path.dirname(plan), { recursive: true });
    fs.writeFileSync(plan, '# Plan\n- change a\n');
    run.plans = [{ revision: 'x', file: path.relative(root, plan), at: '', decision: null }];
    saveRun(root, run);
    runPlanReview(root, run.runId, 0);
    assert.match(fs.readFileSync(planReviewFile(root, run, 0), 'utf8'), new RegExp(`^# Plan review by ${by}\\n\\nReviewed\\.`));
    const r = find(root, run.runId);
    assert.deepEqual([r.plans![0].decision, r.reviews, r.attempts], [null, undefined, undefined], 'no plan decision, review round or attempt');
  });
}

// Top-level keys must come before the first table.
const setAgents = (root: string, agents: string[]) => {
  const file = path.join(root, '.jevmind/config.toml');
  fs.writeFileSync(file, `agents = ${JSON.stringify(agents)}\n${fs.readFileSync(file, 'utf8')}`);
};

test('a project with only Codex reviews Codex work with a same-host subagent, even with Claude installed', async () => {
  const root = repo();
  setAgents(root, ['codex']);
  assert.equal(loadConfig(root).review.crossProvider, false);
  const run = await reviewing(root, 'codex', false);
  const r = find(root, run.runId).reviews![0];
  assert.deepEqual([r.reviewer!.host, r.reviewer!.mode], ['codex', 'subagent']);
  assert.equal(reviewerAttempt(find(root, run.runId)).launch, 'subagent');
});

test('a global single agent turns cross review off for projects without their own agents', async () => {
  const globalHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jevmind-global-'));
  const previous = process.env.JEVMIND_HOME;
  process.env.JEVMIND_HOME = globalHome;
  fs.writeFileSync(path.join(globalHome, 'config.toml'), 'agents = ["codex"]\n');
  try {
    const root = repo();
    const run = await reviewing(root, 'codex', false);
    assert.equal(reviewerAttempt(find(root, run.runId)).launch, 'subagent');
  } finally {
    process.env.JEVMIND_HOME = previous;
    fs.rmSync(globalHome, { recursive: true, force: true });
  }
});

test('P0c: with cross_provider = false the plan review does nothing', () => {
  const root = repo('cross_provider = false');
  const run = createRun(root, 'S', 'x', 'claude-code');
  run.plans = [{ revision: 'x', file: 'plan.md', at: '', decision: null }];
  saveRun(root, run);
  runPlanReview(root, run.runId, 0);
  assert.equal(fs.existsSync(planReviewFile(root, run, 0)), false);
});
