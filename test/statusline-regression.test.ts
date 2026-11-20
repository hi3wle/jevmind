import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderStatusline } from '../src/statusline.ts';
import { createRun, saveRun } from '../src/run.ts';
import { tempRepo, writeConfig } from './helpers.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const state = (root: string, id: string, model = 'Sonnet') => ({ cwd: root, session_id: id, model: { display_name: model } });
const filesHash = (root: string) => {
  const hash = crypto.createHash('sha256');
  const visit = (p: string) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(p, entry.name);
      if (entry.isDirectory()) visit(file);
      else hash.update(file).update(fs.readFileSync(file));
    }
  };
  visit(path.join(root, '.jodex'));
  return hash.digest('hex');
};

test('status footer uses only the displayed project and session and does not mutate state', () => {
  const root = tempRepo();
  const otherRoot = tempRepo();
  writeConfig(root, {}); writeConfig(otherRoot, {});
  const a = createRun(root, 'A', 'SECRET-REQUEST', 'claude-code', 'model-A');
  a.mode = 'review'; a.awaiting = { role: 'reviewer', since: new Date(Date.now() - 31 * 60_000).toISOString() };
  a.reviews = [{ round: 'R0', snapshotId: 's', snapshotDir: '', startedAt: a.awaiting.since, at: null, status: null, findings: [], reviewedPaths: [], limitations: [], agentType: null, reviewer: { host: 'codex', mode: 'cross', launchedAt: a.awaiting.since } }];
  saveRun(root, a);
  const b = createRun(root, 'B', 'OTHER-SECRET', 'codex', 'model-B');
  b.mode = 'collaborative'; saveRun(root, b);
  createRun(otherRoot, 'A', 'OTHER-PROJECT', 'codex', 'other-project-model');
  const before = filesHash(root);
  const output = renderStatusline(state(root, 'A', '\u001b[31mSonnet\u001b[0m\nTOKEN=super-secret-value'), 'claude-code');
  assert.match(output, /Waiting: reviewer\/Codex \(launch recorded/);
  assert.match(output, /overdue, liveness unknown/);
  assert.match(output, /Mode: review/);
  assert.doesNotMatch(output, /SECRET-REQUEST|OTHER-SECRET|model-B|other-project-model|super-secret-value|\x1b|\n/);
  assert.equal(filesHash(root), before, 'status display must not expire or save an overdue wait');
  assert.match(renderStatusline(state(otherRoot, 'A'), 'claude-code'), /Implementor: Codex/);
  assert.match(renderStatusline(state(root, 'missing'), 'claude-code'), /Stage: idle/);
  assert.equal(renderStatusline({ cwd: root }, 'claude-code'), 'JODEX · session unknown');
  assert.equal(renderStatusline({ cwd: os.tmpdir(), session_id: 'A' }, 'claude-code'), '');
});

test('decision footer distinguishes Jev, fallback, disabled and lack of consent', () => {
  const root = tempRepo(); writeConfig(root, {});
  const conf = path.join(root, '.jodex', 'config.toml');
  const base = fs.readFileSync(conf, 'utf8');
  const log = path.join(root, '.jodex', 'decisions.jsonl');
  const set = (mode: string, consent: boolean) => fs.writeFileSync(conf, `${base}\n[jev]\nmode = "${mode}"\nconsent = ${consent}\n`);
  const entry = (source: string, actedOn = true) => fs.writeFileSync(log, JSON.stringify({ point: 'D1', source, sessionId: 'S', actedOn, latencyMs: 241 }) + '\n');
  assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /Rules \(Jev off\)/);
  set('enforce', false); assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /no Jev consent/);
  set('enforce', true); assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /Jev not observed/);
  entry('fallback'); assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /Jev fallback/);
  entry('jev'); assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /Jev \(last D1, enforced, 241ms\)/);
  entry('jev', false); assert.match(renderStatusline(state(root, 'S'), 'claude-code'), /Jev \(last D1, advisory, 241ms\)/);
  assert.match(renderStatusline(state(root, 'other-session'), 'claude-code'), /Jev not observed/);
});

test('isolated Claude settings retain edits, file modes and a private backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-footer-cfg-'));
  const settings = path.join(dir, 'settings.json');
  const invoke = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' });
  fs.writeFileSync(settings, '{"theme":"dark","other":{"value":12}}\n', { mode: 0o640 });
  assert.equal(invoke('setup', '--statusline').status, 0);
  const backup = fs.readdirSync(dir).find((name) => name.endsWith('.bak'))!;
  assert.equal(fs.statSync(path.join(dir, backup)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(settings).mode & 0o777, 0o640);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backup), 'utf8')), { theme: 'dark', other: { value: 12 } });
  const edited = JSON.parse(fs.readFileSync(settings, 'utf8'));
  edited.statusLine.command = 'my-new-footer'; edited.other.value = 13;
  fs.writeFileSync(settings, JSON.stringify(edited));
  assert.equal(invoke('uninstall', '--statusline').status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), edited);
  fs.writeFileSync(settings, '{malformed');
  assert.equal(invoke('setup', '--statusline').status, 1);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{malformed');
});

test('MCP responds after errors, routes each thread, and does not emit notification replies', () => {
  const root = tempRepo(); writeConfig(root, {});
  createRun(root, 'A', '', 'codex', '');
  const second = createRun(root, 'B', '', 'codex', '');
  second.mode = 'collaborative'; saveRun(root, second);
  const read = (id: number, session: string) => ({ jsonrpc: '2.0', id, method: 'resources/read', params: { uri: 'ui://jodex/footer', _meta: { 'com.openai/codex-statusline-state': { thread: { id: session, workspace: { cwd: root }, agent: { state: 'thinking' } } } } } });
  const messages = ['{broken', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://wrong' } }), JSON.stringify(read(2, 'A')), JSON.stringify(read(3, 'B')), JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'ping' })].join('\n') + '\n';
  const before = filesHash(root);
  const proc = spawnSync(process.execPath, [cli, 'statusline', '--mcp'], { input: messages, encoding: 'utf8' });
  assert.equal(proc.status, 0);
  const replies = proc.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replies.length, 5);
  assert.equal(replies[0].error.code, -32700);
  assert.equal(replies[1].error.code, -32602);
  assert.match(replies[2].result.contents[0].text, /Mode: solo/);
  assert.match(replies[3].result.contents[0].text, /Mode: collaborative/);
  assert.match(replies[3].result.contents[0].text, /Activity: thinking/);
  assert.deepEqual(replies[4].result, {});
  assert.equal(filesHash(root), before);
});
