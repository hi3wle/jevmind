import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { parse } from 'smol-toml';
import { AGENTS, DEFAULT_ROUTES, globalAgents, globalAllow, loadConfig, saveGlobalAgents, saveGlobalAllow } from '../src/config.ts';
import { handleHook } from '../src/hooks.ts';
import { tempRepo } from './helpers.ts';

// Each test gets its own machine-wide Jodex home, so a global config.toml cannot leak between tests.
function home(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-agents-home-'));
  const previous = process.env.JODEX_HOME;
  process.env.JODEX_HOME = dir;
  t.after(() => {
    process.env.JODEX_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Top-level keys (agents) must come before the first table, so they go on top.
function project(top = ''): string {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), `${top}[risk]\ncritical = []\n[checks]\ntest = "true"\n`);
  return root;
}

test('a global single agent limits the project to it and turns cross review off', (t) => {
  fs.writeFileSync(path.join(home(t), 'config.toml'), 'agents = ["claude-code"]\n');
  const cfg = loadConfig(project());
  assert.deepEqual(cfg.agents, ['claude-code']);
  assert.equal(cfg.review.crossProvider, false);
});

test('a project agents list overrides the global choice', (t) => {
  fs.writeFileSync(path.join(home(t), 'config.toml'), 'agents = ["claude-code"]\n');
  const cfg = loadConfig(project('agents = ["claude-code", "codex"]\n'));
  assert.deepEqual(cfg.agents, ['claude-code', 'codex']);
  assert.equal(cfg.review.crossProvider, true);
});

test('no global file and no project key means both agents with cross review', (t) => {
  home(t);
  assert.equal(globalAgents(), undefined);
  const cfg = loadConfig(project());
  assert.deepEqual(cfg.agents, AGENTS);
  assert.equal(cfg.review.crossProvider, true);
});

test('cross_provider = false keeps both agents but turns cross review off', (t) => {
  home(t);
  const root = project();
  fs.appendFileSync(path.join(root, '.jodex/config.toml'), '[review]\ncross_provider = false\n');
  const cfg = loadConfig(root);
  assert.deepEqual(cfg.agents, AGENTS);
  assert.equal(cfg.review.crossProvider, false);
});

test('an invalid agent name throws, in the project and in the global file', (t) => {
  home(t);
  assert.throws(() => loadConfig(project('agents = ["gemini"]\n')), /agents in .*config\.toml must be a non-empty list/);
  assert.throws(() => loadConfig(project('agents = []\n')), /must be a non-empty list/);
  fs.writeFileSync(path.join(process.env.JODEX_HOME!, 'config.toml'), 'agents = "codex"\n');
  assert.throws(() => loadConfig(project()), /agents in .*config\.toml must be a non-empty list/);
});

test('saveGlobalAgents keeps other keys and round-trips', (t) => {
  const dir = home(t);
  fs.writeFileSync(path.join(dir, 'config.toml'), 'keep = "yes"\n\n[jev]\nmode = "off"\n');
  saveGlobalAgents(['codex']);
  const saved = parse(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual([saved.keep, saved.agents, (saved.jev as { mode: string }).mode], ['yes', ['codex'], 'off']);
  assert.deepEqual(globalAgents(), ['codex']);
  saveGlobalAgents(AGENTS);
  assert.deepEqual(globalAgents(), AGENTS);
});

test('saveGlobalAgents on a malformed global file throws the clear message and leaves the file alone', (t) => {
  const file = path.join(home(t), 'config.toml');
  fs.writeFileSync(file, 'agents = [');
  assert.throws(
    () => saveGlobalAgents(['codex']),
    (e: Error) => e.message.includes(file) && /is not valid TOML \(.*\); repair or delete it$/.test(e.message) && !e.message.includes('\n'),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), 'agents = [');
});

test('hooks fail closed and name the global file when it is malformed or invalid', async (t) => {
  const file = path.join(home(t), 'config.toml');
  const root = project();
  const pre = (tool: string, input: object) => handleHook({ hook_event_name: 'PreToolUse', session_id: 'S1', cwd: root, tool_name: tool, tool_input: input } as never) as Promise<any>;
  for (const [content, what] of [
    ['agents = [', /not valid TOML/],
    ['agents = ["foo"]\n', /must be a non-empty list/],
  ] as const) {
    fs.writeFileSync(file, content);
    const denied = await pre('Write', { file_path: path.join(root, 'a.ts') });
    const reason: string = denied.hookSpecificOutput.permissionDecisionReason;
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(reason.includes(file), reason);
    assert.match(reason, what);
    assert.doesNotMatch(reason, /\.jodex\/config\.toml/);
    assert.deepEqual(await pre('Read', { file_path: path.join(root, 'README.md') }), {});
  }
});

test('a project agents key means a malformed global file is never read', (t) => {
  fs.writeFileSync(path.join(home(t), 'config.toml'), 'agents = [');
  assert.deepEqual(loadConfig(project('agents = ["claude-code", "codex"]\n')).agents, AGENTS);
  assert.throws(() => loadConfig(project()), /is not valid TOML/);
});

// Appends [models] (and any allow tables) to the project config; models are read only when mode is not off.
function routing(root: string, text: string) {
  fs.appendFileSync(path.join(root, '.jodex/config.toml'), `[models]\nmode = "apply"\n${text}`);
  return loadConfig(root).models.routes;
}

test('a project limit beats the global limit for the same step', (t) => {
  home(t);
  saveGlobalAllow('codex', { tester: { models: ['gpt-6.2-sol'] } });
  const routes = routing(project(), '[models.codex.allow.tester]\nmodels = ["gpt-6-luna"]\n');
  assert.equal(routes.codex.tester.normal.model, 'gpt-6-luna');
});

test('a project limit on one step leaves the global limit on the other steps', (t) => {
  home(t);
  saveGlobalAllow('codex', { tester: { models: ['gpt-6.2-sol'] } });
  const routes = routing(project(), '[models.codex.allow.planner]\nmodels = ["gpt-6-luna"]\n');
  assert.equal(routes.codex.planner.normal.model, 'gpt-6-luna');
  assert.equal(routes.codex.tester.normal.model, 'gpt-6.2-sol');
});

test('the global limit applies when the project has none, and keeps the effort', (t) => {
  home(t);
  saveGlobalAllow('claude-code', { tester: { models: ['opus'] } });
  const routes = routing(project(), '');
  assert.deepEqual([routes['claude-code'].tester.normal, routes['claude-code'].tester.critical], [{ model: 'opus', effort: 'medium' }, { model: 'opus', effort: 'medium' }]);
});

test('mode off uses the host defaults and never reads a malformed global file', (t) => {
  fs.writeFileSync(path.join(home(t), 'config.toml'), 'agents = [');
  const root = project('agents = ["claude-code", "codex"]\n');
  const cfg = loadConfig(root);
  assert.equal(cfg.models.mode, 'off');
  assert.deepEqual(cfg.models.routes, DEFAULT_ROUTES);
  // The same malformed file is read once the models are on.
  fs.appendFileSync(path.join(root, '.jodex/config.toml'), '[models]\nmode = "apply"\n');
  assert.throws(() => loadConfig(root), /is not valid TOML/);
});

test('an invalid allow entry throws and names the file it is in', (t) => {
  home(t);
  const bad: [string, RegExp][] = [
    ['[models.codex.allow.nope]\nmodels = ["gpt-6-luna"]\n', /unknown step/],
    ['[models.codex.allow.tester]\nmodels = []\n', /models must be a non-empty list of model names/],
    ['[models.codex.allow.tester]\nmodels = [""]\n', /models must be a non-empty list of model names/],
    ['[models.codex.allow.tester]\nefforts = ["ultra"]\n', /efforts must be a non-empty list of low, medium, high, xhigh/],
  ];
  for (const [text, what] of bad) {
    assert.throws(
      () => routing(project(), text),
      (e: Error) => e.message.includes('models.codex.allow.') && e.message.includes('.jodex/config.toml') && what.test(e.message),
      text,
    );
  }
});

test('an invalid allow entry in the global file names the global file', (t) => {
  const file = path.join(home(t), 'config.toml');
  fs.writeFileSync(file, '[models.claude.allow.tester]\nefforts = ["ultra"]\n');
  assert.throws(() => routing(project(), ''), (e: Error) => e.message.includes(file) && /models\.claude\.allow\.tester in /.test(e.message));
});

test('saveGlobalAllow keeps the agents and the other host; null removes only its own host', (t) => {
  const file = path.join(home(t), 'config.toml');
  saveGlobalAgents(AGENTS);
  saveGlobalAllow('claude-code', { tester: { models: ['haiku'] } });
  saveGlobalAllow('codex', { planner: { efforts: ['low'] } });
  assert.deepEqual(globalAgents(), AGENTS);
  assert.deepEqual(globalAllow()['claude-code']!.tester!.models, ['haiku']);
  assert.deepEqual(globalAllow().codex!.planner!.efforts, ['low']);

  saveGlobalAllow('codex', null);
  assert.equal(globalAllow().codex, undefined);
  assert.deepEqual(globalAgents(), AGENTS);
  const raw = parse(fs.readFileSync(file, 'utf8')) as { models: Record<string, unknown> };
  assert.equal(raw.models.codex, undefined, 'the empty host table is removed');
  assert.deepEqual((raw.models.claude as { allow: { tester: { models: string[] } } }).allow.tester.models, ['haiku']);
});
