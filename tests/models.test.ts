import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyAllow, DEFAULT_ROUTES, MODEL_ORDER, pickAllowed, type Routes } from '../src/config.ts';
import { pickLine, routeTable } from '../src/models.ts';

const CLAUDE = MODEL_ORDER['claude-code'];

test('pickAllowed: the recommendation, the nearest allowed value, or a free-text fallback', () => {
  // [name, recommendation, allowed, tier, expected, unknownAt]
  const rows: [string, string | null, string[] | undefined, 'normal' | 'critical', string | null, number?][] = [
    ['no limit', 'sonnet', undefined, 'normal', 'sonnet'],
    ['empty limit is no limit', 'sonnet', [], 'normal', 'sonnet'],
    ['recommendation allowed', 'sonnet', ['haiku', 'sonnet'], 'normal', 'sonnet'],
    ['nearest above', 'sonnet', ['opus', 'fable'], 'normal', 'opus'],
    ['nearest below', 'opus', ['haiku', 'sonnet'], 'critical', 'sonnet'],
    ['equal distance, normal takes the cheaper', 'sonnet', ['haiku', 'opus'], 'normal', 'haiku'],
    ['equal distance, critical takes the stronger', 'sonnet', ['haiku', 'opus'], 'critical', 'opus'],
    ['a single allowed value wins', 'fable', ['haiku'], 'critical', 'haiku'],
    ['a single free-text value wins', 'sonnet', ['my-model'], 'normal', 'my-model'],
    ['free text next to a known model: the known one wins', 'sonnet', ['my-model', 'opus'], 'normal', 'opus'],
    ['no recommendation, equal distance, normal', null, ['haiku', 'opus'], 'normal', 'haiku'],
    ['no recommendation, equal distance, critical', null, ['haiku', 'opus'], 'critical', 'opus'],
    ['no recommendation and no limit', null, undefined, 'normal', null],
    ['unknown recommendation, nothing known allowed: first allowed', 'custom', ['x', 'y'], 'normal', 'x'],
    ['unknown recommendation counts from the given index', 'custom', ['haiku', 'sonnet', 'opus'], 'critical', 'opus', 3],
  ];
  for (const [name, rec, allowed, tier, want, unknownAt] of rows) assert.equal(pickAllowed(rec, allowed, CLAUDE, tier, unknownAt), want, name);
  // Codex order and effort order use the same rule: sol is nearer to astra than to luna.
  assert.equal(pickAllowed('gpt-6.2-sol', ['gpt-6-luna', 'gpt-6.2-astra'], MODEL_ORDER.codex, 'normal'), 'gpt-6.2-astra');
  // An unset effort is measured from medium.
  assert.equal(pickAllowed('medium', ['high', 'xhigh'], ['low', 'medium', 'high', 'xhigh'], 'normal'), 'high');
});

test('applyAllow: an empty map gives the recommended routes, and the input is never changed', () => {
  assert.deepEqual(applyAllow(DEFAULT_ROUTES, {}), DEFAULT_ROUTES);
  assert.deepEqual(applyAllow(DEFAULT_ROUTES, {}).codex.tester.normal, { model: 'gpt-6-luna', effort: 'high' });
  const before = structuredClone(DEFAULT_ROUTES);
  const out = applyAllow(DEFAULT_ROUTES, { 'claude-code': { tester: { models: ['opus'] } } });
  assert.notEqual(out, DEFAULT_ROUTES);
  assert.deepEqual(DEFAULT_ROUTES, before);
});

test('applyAllow keeps a developer-allowed high effort', () => {
  const out = applyAllow(DEFAULT_ROUTES, { codex: { tester: { efforts: ['high', 'xhigh'] } } });
  assert.deepEqual(out.codex.tester.normal, { model: 'gpt-6-luna', effort: 'high' });
  // The critical tier's medium is not allowed: the nearest allowed effort is high.
  assert.equal(out.codex.tester.critical.effort, 'high');
});

test('applyAllow without efforts keeps each effort, including an unset one', () => {
  const routes = structuredClone(DEFAULT_ROUTES);
  routes['claude-code'].tester.normal.effort = null;
  const out = applyAllow(routes, { 'claude-code': { tester: { models: ['opus'] } } });
  assert.deepEqual(out['claude-code'].tester.normal, { model: 'opus', effort: null });
  assert.equal(out['claude-code'].tester.critical.effort, 'medium');
});

test('applyAllow measures an unset effort from medium: a tie goes low on normal, high on critical', () => {
  const routes = structuredClone(DEFAULT_ROUTES);
  routes.codex.tester.normal.effort = null;
  routes.codex.tester.critical.effort = null;
  const out = applyAllow(routes, { codex: { tester: { efforts: ['low', 'high'] } } });
  assert.deepEqual([out.codex.tester.normal.effort, out.codex.tester.critical.effort], ['low', 'high']);
});

test('applyAllow: a free-text recommendation goes to the weakest allowed model on normal, the strongest on critical', () => {
  const routes: Routes = structuredClone(DEFAULT_ROUTES);
  routes.codex.implementor.normal.model = 'my-codex';
  routes.codex.implementor.critical.model = 'my-codex';
  const out = applyAllow(routes, { codex: { implementor: { models: ['gpt-6-luna', 'gpt-6.2-astra'] } } });
  assert.deepEqual([out.codex.implementor.normal.model, out.codex.implementor.critical.model], ['gpt-6-luna', 'gpt-6.2-astra']);
});

test('routeTable: default routes have the header, one row per step, and no marks', () => {
  const lines = routeTable('claude-code', DEFAULT_ROUTES);
  assert.equal(lines.length, 5);
  assert.equal(lines[0].replace(/ +/g, ' '), 'Step Normal task Critical task Why');
  assert.match(lines[1], /^Planner\s+Opus · medium\s+Opus · high\s+Plans need/);
  assert.match(lines[3], /^Tester\s+Haiku · medium\s+Sonnet · medium\s+Scoped tests/);
  assert.ok(!lines.some((l) => l.includes('*')));
  const codex = routeTable('codex', DEFAULT_ROUTES);
  assert.match(codex.find((l) => l.startsWith('Tester'))!, /gpt-6-luna · high\s+gpt-6\.2-sol · medium/);
});

test('routeTable: a narrow width drops the Why column and lists the reasons below, within the width', () => {
  for (const host of ['claude-code', 'codex'] as const) {
    const lines = routeTable(host, DEFAULT_ROUTES, DEFAULT_ROUTES, 74);
    assert.ok(lines.every((l) => l.length <= 74), `${host}: ${Math.max(...lines.map((l) => l.length))} columns`);
    assert.doesNotMatch(lines[0], /Why/, host);
    assert.match(lines[0], /^Step\s+Normal task\s+Critical task$/, host);
    for (const reason of ['Planner: Plans need the strongest model; runs rarely', 'Implementor: Suggestion only: this is your own session', 'Tester: Scoped tests, verified by jodex check', 'Reviewer: Reads and verifies; no edits']) {
      assert.ok(lines.includes(reason), `${host}: missing "${reason}"`);
    }
  }
});

test('routeTable: a cell that differs from the recommendation gets a star, and only that cell', () => {
  const eff = applyAllow(DEFAULT_ROUTES, { 'claude-code': { tester: { models: ['opus'] } } });
  const lines = routeTable('claude-code', eff);
  assert.match(lines.find((l) => l.startsWith('Tester'))!, /Opus · medium \*\s+Opus · medium \*/);
  assert.doesNotMatch(lines.find((l) => l.startsWith('Planner'))!, /\*/);
  assert.equal(lines.filter((l) => l.includes('*')).length, 1);
  // The recommended routes are an explicit argument: the same effective routes differ from them.
  const against = routeTable('claude-code', DEFAULT_ROUTES, eff);
  assert.equal(against.filter((l) => l.includes('*')).length, 1, 'stars come from the recommended argument');
});

test('routeTable: an unset model and effort are shown as host default', () => {
  const routes = structuredClone(DEFAULT_ROUTES);
  routes.codex.planner.normal = { model: null, effort: null };
  const lines = routeTable('codex', routes);
  assert.match(lines.find((l) => l.startsWith('Planner'))!, /host default · default \*/);
});

test('pickLine names the step and both tiers', () => {
  assert.equal(pickLine('tester', { normal: { model: 'haiku', effort: 'medium' }, critical: { model: 'sonnet', effort: 'medium' } }), '→ Tester will run: Haiku · medium (normal), Sonnet · medium (critical)');
  assert.equal(pickLine('planner', { normal: { model: 'gpt-6.2-astra', effort: 'high' }, critical: { model: null, effort: null } }), '→ Planner will run: gpt-6.2-astra · high (normal), host default · default (critical)');
});

// `jodex models` with no TTY: prints the tables, writes nothing. HOME and JODEX_HOME are temp dirs.
function modelsCli(t: TestContext, globalText?: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-models-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  if (globalText !== undefined) fs.writeFileSync(path.join(home, 'config.toml'), globalText);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'models'], { cwd: home, encoding: 'utf8', env: { ...process.env, HOME: home, JODEX_HOME: home, CODEX_SESSION_ID: '' } });
  return { result, file: path.join(home, 'config.toml'), home };
}

test('jodex models without a TTY prints both tables and the config path, exits 0 and writes no file', (t) => {
  const { result, file } = modelsCli(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Claude Code model routing:/);
  assert.match(result.stdout, /Codex model routing:/);
  assert.match(result.stdout, /Step\s+Normal task\s+Critical task\s+Why/);
  assert.match(result.stdout, /gpt-6-luna · high/);
  assert.ok(result.stdout.includes(file), result.stdout);
  assert.equal(fs.existsSync(file), false, 'nothing is written without a TTY');
});

test('jodex models without a TTY shows only the agents chosen globally', (t) => {
  const { result } = modelsCli(t, 'agents = ["codex"]\n');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Claude Code model routing/);
  assert.match(result.stdout, /Codex model routing:/);
});
