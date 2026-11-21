import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { collect, registerProject, writeBoard } from '../src/board.ts';
import { handleHook } from '../src/hooks.ts';
import { tempRepo, writeConfig } from './helpers.ts';

test('board lists registered projects and escapes request text', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  registerProject(root, true);
  const ev = (name: string, extra: object) => ({ hook_event_name: name, session_id: 'S', cwd: root, turn_id: 't1', model: 'gpt-x', ...extra });
  await handleHook(ev('UserPromptSubmit', { prompt: 'fix </script><script>alert(1)</script>' }));
  await handleHook(ev('PreToolUse', { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch' } }));
  const [run] = collect().runs.filter((r) => r.project === path.basename(root));
  assert.equal(run.host, 'codex');
  assert.equal(run.model, 'gpt-x');
  assert.equal(run.status, 'in_progress');
  const html = fs.readFileSync(writeBoard(), 'utf8');
  assert.equal(html.includes('</script><script>alert'), false, 'request cannot break out of the data script');
  assert.match(html, /\\u003c\/script>/);
  registerProject(root, false);
  assert.equal(collect().projects.some((p) => p.root === root), false);
});

test('live pipeline: each stage with its model and status; abandoned roles become overdue', async () => {
  const { pipeline } = await import('../src/board.ts');
  const now = Date.parse('2026-11-21T10:00:00Z');
  const ago = (min: number) => new Date(now - min * 60e3).toISOString();
  const base = { runId: 'r', sessionId: 'S', host: 'claude-code', model: 'claude-opus-5-5', request: '', mode: 'review' as const, riskFloor: 'elevated' as const, touched: ['a.js'], checks: { test: { command: 'x', exitCode: 0, identity: '', at: '', outputTail: '' } }, stopBlocks: 0, open: true, createdAt: '', updatedAt: ago(1) };
  const review = (startedAt: string, at: string | null, status: string | null) => ({ round: 'R0', scope: [], snapshotId: '', snapshotDir: '', startedAt, at, status, findings: [], reviewedPaths: [], limitations: [], agentType: null, reviewer: { host: 'codex' as const, mode: 'cross' as const, model: 'gpt-6.1-sol' } }) as any;
  const by = (r: any) => Object.fromEntries(pipeline(r, { source: 'jev', model: 'jev-1.14.0', latencyMs: 300 }, now).map((p) => [p.stage, p]));
  let p = by({ ...base, awaiting: { role: 'reviewer', since: ago(2) }, reviews: [review(ago(2), null, null)] });
  assert.deepEqual([p.decision.model, p.decision.status], ['jev-1.14.0', 'done']);
  assert.deepEqual([p.implementor.model, p.implementor.status], ['claude-opus-5-5', 'waiting'], 'the worker is locked while the reviewer runs');
  assert.deepEqual([p.reviewer.model, p.reviewer.status], ['gpt-6.1-sol', 'running']);
  assert.equal(p.checks.status, 'done');
  assert.deepEqual([p.planner.status, p.tester.status], ['skipped', 'skipped']);
  p = by({ ...base, updatedAt: ago(40), awaiting: { role: 'reviewer', since: ago(40) }, reviews: [review(ago(40), null, null)] });
  assert.equal(p.reviewer.status, 'overdue', 'a reviewer silent for 30+ minutes is not in flight');
  p = by({ ...base, open: false, reviews: [review(ago(5), ago(3), 'changes_required')], completion: { status: 'review_required', identity: '', at: '' } });
  assert.deepEqual([p.reviewer.status, p.outcome.status], ['failed', 'warn']);
  assert.equal(by({ ...base, mode: 'solo' }).reviewer.status, 'skipped');
  assert.equal(by({ ...base, agentRoles: { t1: 'tester' } }).tester.status, 'warn', 'a tester that never reported is not done');
  p = by({ ...base, agentRoles: { t1: 'tester' }, testerStartedAt: ago(3), testerDoneAt: ago(1), roleModels: { tester: 'claude-sonnet-5-5' } });
  assert.deepEqual([p.tester.status, p.tester.model], ['done', 'claude-sonnet-5-5']);
  p = by({ ...base, agentRoles: { t1: 'tester' }, testerStartedAt: ago(1), testerDoneAt: ago(3) });
  assert.equal(p.tester.status, 'warn', 'a later attempt without a result is not done by the earlier one');
});

test('live server: page, data, change events, and Host check', async () => {
  const { serveBoard } = await import('../src/board.ts');
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  registerProject(root, true);
  const server = await serveBoard(0);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.ok(Array.isArray((await (await fetch(`${url}/data`)).json()).runs));
    assert.match(await (await fetch(`${url}/?range=15m`)).text(), /Run<\/span><span>Decision/);
    assert.equal((await fetch(`${url}/other`)).status, 404);
    const rebound = await new Promise<number>((ok) => http.get(`${url}/data`, { headers: { host: 'evil.example:80' } }, (r) => ok(r.statusCode!)));
    assert.equal(rebound, 403, 'foreign Host header is refused');
    const event = await new Promise<string>((ok) => {
      http.get(`${url}/events`, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes(': connected')) fs.writeFileSync(path.join(root, '.jodex', 'touch.json'), '{}');
          if (buf.includes('data: changed')) { res.destroy(); ok(buf); }
        });
      });
    });
    assert.match(event, /data: changed/, 'a write under .jodex/ is pushed to the page');
  } finally {
    server.closeAllConnections();
    server.close();
    registerProject(root, false);
  }
});
