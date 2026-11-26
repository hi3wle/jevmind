import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { detectChecks, planInit, planMigration, uninstallProject, withBlock, withoutBlock } from '../src/init.ts';
import { loadConfig, renderConfig } from '../src/config.ts';
import { tempRepo } from './helpers.ts';

const read = (root: string, f: string) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null);

test('managed block round-trips and replaces in place', () => {
  const original = '# Rules\n\nBe nice.\n';
  const once = withBlock(original);
  assert.equal(withBlock(once), once, 'idempotent');
  assert.equal(withoutBlock(once), original);
});

test('init then uninstall restores existing files exactly', () => {
  const files = { 'AGENTS.md': '# Team rules\n', 'CLAUDE.md': '# Claude notes\n', '.gitignore': 'node_modules/\n', 'package.json': '{"scripts":{"test":"node --test","lint":"eslint ."}}' };
  const root = tempRepo(files);
  const changes = planInit(root);
  assert.deepEqual(changes.map((c) => c.file), ['.jevmind/config.toml', 'AGENTS.md', 'CLAUDE.md', '.gitignore']);
  assert.match(changes[0].summary, /planner and tester models.*mode = "off".*\[models\]/);
  changes.forEach((c) => c.apply());
  assert.ok(read(root, '.gitignore')!.split('\n').includes('.jevmind/calibration.jsonl'));
  assert.deepEqual(loadConfig(root).checks, { test: 'npm test', lint: 'npm run lint' });
  assert.match(read(root, 'AGENTS.md')!, /^# Team rules\n[\s\S]*jevmind:begin/);
  assert.equal(planInit(root).length, 0, 'second init changes nothing');
  uninstallProject(root, true);
  for (const [f, content] of Object.entries(files)) assert.equal(read(root, f), content, f);
  assert.equal(fs.existsSync(path.join(root, '.jevmind')), false);
});

test('init in an empty project creates files that uninstall removes', () => {
  const root = tempRepo();
  planInit(root).forEach((c) => c.apply());
  assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
  uninstallProject(root, false);
  assert.equal(read(root, 'AGENTS.md'), null);
  assert.equal(read(root, 'CLAUDE.md'), null);
  assert.equal(read(root, '.gitignore'), '');
});

test('init preserves existing model settings, including legacy configs', () => {
  for (const config of ['[models]\nmode = "off"\n', '[models]\nmode = "shadow"\n', '[checks]\n']) {
    const root = tempRepo({ '.jevmind/config.toml': config });
    const changes = planInit(root);
    assert.ok(changes.every((change) => change.file !== '.jevmind/config.toml'));
    changes.forEach((change) => change.apply());
    assert.equal(read(root, '.jevmind/config.toml'), config);
  }
});

test('agents key is written only when the project chooses agents', () => {
  const withAgents = parse(renderConfig({ test: 'npm test' }, false, ['codex'])) as Record<string, unknown>;
  assert.deepEqual(withAgents.agents, ['codex']);
  assert.equal('agents' in (parse(renderConfig({ test: 'npm test' })) as object), false);
  const root = tempRepo();
  const [config] = planInit(root, false, ['codex']);
  assert.match(config.summary, /agents codex/);
  config.apply();
  assert.deepEqual(loadConfig(root).agents, ['codex']);
  assert.equal(loadConfig(root).review.crossProvider, false);
  const plain = tempRepo();
  planInit(plain).forEach((c) => c.apply());
  assert.equal('agents' in (parse(read(plain, '.jevmind/config.toml')!) as object), false);
});

test('check detection', () => {
  assert.deepEqual(detectChecks(tempRepo({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), {});
  assert.deepEqual(detectChecks(tempRepo({ 'go.mod': 'module x' })), { test: 'go test ./...' });
});

const LEGACY_BLOCK = '<!-- jodex:begin (managed by jodex init; edit .jodex/config.toml instead) -->\nold rules\n<!-- jodex:end -->';
const legacyRepo = () =>
  tempRepo({
    '.jodex/config.toml': '[checks]\ntest = "npm test"\n',
    '.jodex/state.json': JSON.stringify({ createdAgents: false, createdClaude: false, addedImport: false, addedIgnore: ['.jodex/calibration.jsonl', '.jodex/runs/'] }),
    'AGENTS.md': `# Mine\n\n${LEGACY_BLOCK}\n\nAfter text\n`,
    '.gitignore': 'node_modules/\n.jodex/calibration.jsonl\n.jodex/runs/\n',
  });

test('planMigration: null without .jodex, throws and moves nothing when both folders exist', () => {
  assert.equal(planMigration(tempRepo()), null);
  const root = tempRepo({ '.jodex/config.toml': 'a', '.jevmind/config.toml': 'b' });
  assert.throws(() => planMigration(root), /merge them by hand/);
  assert.equal(read(root, '.jodex/config.toml'), 'a');
  assert.equal(read(root, '.jevmind/config.toml'), 'b');
});

test('planMigration apply renames, rewrites block, gitignore and state; uninstall still cleans up', () => {
  const root = legacyRepo();
  const change = planMigration(root)!;
  assert.equal(change.file, '.jodex/');
  change.apply();
  assert.equal(fs.existsSync(path.join(root, '.jodex')), false);
  assert.equal(read(root, '.jevmind/config.toml'), '[checks]\ntest = "npm test"\n');
  const agents = read(root, 'AGENTS.md')!;
  assert.equal(agents.split('jevmind:begin').length - 1, 1);
  assert.equal(agents.includes('jodex'), false);
  assert.match(agents, /^# Mine\n[\s\S]*\nAfter text\n$/);
  assert.equal(read(root, '.gitignore'), 'node_modules/\n.jevmind/calibration.jsonl\n.jevmind/runs/\n');
  assert.deepEqual(JSON.parse(read(root, '.jevmind/state.json')!).addedIgnore, ['.jevmind/calibration.jsonl', '.jevmind/runs/']);
  uninstallProject(root, false);
  assert.equal(read(root, '.gitignore'), 'node_modules/\n');
});

test('cli migrates a legacy project on --yes, keeps its config, then reports already enabled', () => {
  const root = legacyRepo();
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const run = () => spawnSync(process.execPath, [cli, 'init', '--yes'], { cwd: root, encoding: 'utf8', env: { ...process.env, JEVMIND_DISABLE: '' } });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(read(root, '.jevmind/config.toml'), '[checks]\ntest = "npm test"\n');
  assert.equal(fs.existsSync(path.join(root, '.jodex')), false);
  // Migration applied alone; the next init adds only what the legacy project lacked (CLAUDE.md, ignore lines).
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(read(root, '.jevmind/config.toml'), '[checks]\ntest = "npm test"\n');
  const third = run();
  assert.equal(third.status, 0, third.stderr);
  assert.match(third.stdout, /already enabled/);
});
