import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { detectChecks, planInit, uninstallProject, withBlock, withoutBlock } from '../src/init.ts';
import { loadConfig } from '../src/config.ts';
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
  assert.deepEqual(changes.map((c) => c.file), ['.jodex/config.toml', 'AGENTS.md', 'CLAUDE.md', '.gitignore']);
  changes.forEach((c) => c.apply());
  assert.deepEqual(loadConfig(root).checks, { test: 'npm test', lint: 'npm run lint' });
  assert.match(read(root, 'AGENTS.md')!, /^# Team rules\n[\s\S]*jodex:begin/);
  assert.equal(planInit(root).length, 0, 'second init changes nothing');
  uninstallProject(root, true);
  for (const [f, content] of Object.entries(files)) assert.equal(read(root, f), content, f);
  assert.equal(fs.existsSync(path.join(root, '.jodex')), false);
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

test('check detection', () => {
  assert.deepEqual(detectChecks(tempRepo({ 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), {});
  assert.deepEqual(detectChecks(tempRepo({ 'go.mod': 'module x' })), { test: 'go test ./...' });
});
