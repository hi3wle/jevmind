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

test('live map: stage of a run, and the live server serves the page and data', async () => {
  const { serveBoard, stageOf, stagesSeen } = await import('../src/board.ts');
  const base = { runId: 'r', sessionId: 'S', host: 'codex', model: null, request: '', mode: 'review' as const, riskFloor: 'low' as const, touched: [], checks: {}, stopBlocks: 0, open: true, createdAt: '', updatedAt: '' };
  assert.equal(stageOf(base), 'intake');
  assert.equal(stageOf({ ...base, touched: ['a'] }), 'implement');
  assert.equal(stageOf({ ...base, touched: ['a'], awaiting: { role: 'reviewer', since: '' } }), 'review');
  const round = (id: string) => ({ round: id, findings: [] }) as any;
  assert.equal(stageOf({ ...base, correctingAfter: 'R0', reviews: [round('R0')] }), 'fix');
  assert.equal(stageOf({ ...base, correctingAfter: 'R0', reviews: [round('R0'), round('R1')] }), 'review', 'fix ends when the next round starts');
  assert.equal(stageOf({ ...base, open: false }), 'done');
  assert.deepEqual(stagesSeen({ ...base, touched: ['a'], checks: { test: { command: 'x', exitCode: 0, identity: '', at: '', outputTail: '' } } }), ['intake', 'implement', 'check'], 'plan and test were skipped, not done');
  const server = await serveBoard(0);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.ok(Array.isArray((await (await fetch(`${url}/data`)).json()).runs));
    assert.match(await (await fetch(`${url}/`)).text(), /Live map/);
    assert.equal((await fetch(`${url}/other`)).status, 404);
    const rebound = await new Promise<number>((ok) => http.get(`${url}/data`, { headers: { host: 'evil.example:80' } }, (r) => ok(r.statusCode!)));
    assert.equal(rebound, 403, 'foreign Host header is refused');
  } finally {
    server.close();
  }
});
