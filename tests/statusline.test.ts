import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRun, saveRun } from '../src/run.ts';
import { tempRepo, writeConfig } from './helpers.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const call = (args: string[], input: string) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

test('Claude footer binds the displayed session, reports waiting honestly and never leaks request text', () => {
  const root = tempRepo();
  writeConfig(root, {});
  const run = createRun(root, 'S1', 'SECRET REQUEST', 'codex', 'gpt-example');
  run.mode = 'review';
  run.modeSource = 'rule';
  run.riskFloor = 'critical';
  run.awaiting = { role: 'reviewer', since: new Date().toISOString() };
  saveRun(root, run);
  const other = createRun(root, 'S2', 'OTHER SECRET', 'claude-code', 'OTHER_MODEL');
  other.mode = 'collaborative';
  saveRun(root, other);
  const result = call(['statusline'], JSON.stringify({ cwd: root, session_id: 'S1', model: { display_name: 'gpt-example' } }));
  assert.match(result.stdout, /Decision: Rules/);
  assert.match(result.stdout, /Implementor: Codex/);
  assert.match(result.stdout, /Waiting: reviewer/);
  assert.match(result.stdout, /Mode: review \(rules\)/);
  assert.match(result.stdout, /Risk: critical/);
  assert.doesNotMatch(result.stdout, /SECRET|OTHER_MODEL|running/);
  assert.equal(result.status, 0);
});

test('MCP footer advertises the native entrypoint and renders the displayed thread', () => {
  const root = tempRepo();
  writeConfig(root, {});
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://jodex/footer', _meta: { 'com.openai/codex-statusline-state': { thread: { id: 'S', workspace: { cwd: root }, model: { display_name: 'Sol' }, agent: { state: 'working' } } } } } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const result = call(['statusline', '--mcp'], input);
  assert.match(result.stdout, /protocolVersion/);
  const out = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(out.length, 3, 'notifications get no response');
  assert.equal(out[1].result.tools[0]._meta['openai/ui'].entrypoints[0].resourceUri, 'ui://jodex/footer');
  assert.match(out[2].result.contents[0].text, /Implementor: Codex/);
  assert.match(out[2].result.contents[0].text, /idle/);
  assert.equal(result.status, 0);
});

test('explicit footer setup preserves developer settings and removes only its own footer', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-statusline-settings-'));
  const settings = path.join(home, 'settings.json');
  const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: home }, encoding: 'utf8',
  });
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'my-footer' } }));
  const before = fs.readFileSync(settings, 'utf8');
  invoke('setup', '--statusline');
  assert.equal(fs.readFileSync(settings, 'utf8'), before, 'existing footer is untouched');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark' }));
  const result = invoke('setup', '--statusline');
  assert.match(result.stdout, /statusline.*installed/i);
  const installed = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(installed.theme, 'dark');
  assert.match(installed.statusLine.command, /statusline/);
  invoke('uninstall', '--statusline');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { theme: 'dark' });
});

test('footer setup refuses a linked settings file instead of replacing the developer link', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-statusline-linked-'));
  const target = path.join(home, 'shared.json');
  fs.writeFileSync(target, '{}\n');
  fs.symlinkSync(target, path.join(home, 'settings.json'));
  const result = spawnSync(process.execPath, [cli, 'setup', '--statusline'], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: home }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(fs.lstatSync(path.join(home, 'settings.json')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{}\n');
});
