import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { handleHook } from '../src/hooks.ts';
import { jev } from '../src/jev.ts';
import { sourceIdentity } from '../src/project.ts';
import { createRun, evaluate, listRuns, saveRun } from '../src/run.ts';
import { checkEvidence, decidePlan, lastJson, reconcileSession, startPlan, startReview, validateReview } from '../src/team.ts';
import { tempRepo } from './helpers.ts';

function repo(jevMode = 'off') {
  const root = tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), `[risk]\ncritical = ["**/auth/**"]\nhuman_review_required = ["critical"]\n[checks]\ntest = "true"\n[review]\ncross_provider = false\n[jev]\nmode = "${jevMode}"\nconsent = true\n`);
  return root;
}
const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra });
const write = (root: string, rel: string, agent?: object) => ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, rel) }, ...agent });
const run0 = (root: string) => listRuns(root).find((r) => r.open)!;
const check = (root: string) => {
  const r = run0(root);
  runChecks(root, loadConfig(root), r, () => {});
  saveRun(root, r);
};
const review = (root: string, body: object) => ev(root, 'SubagentStop', { agent_id: 'A1', agent_type: 'jodex:reviewer', last_assistant_message: 'Done.\n```json\n' + JSON.stringify(body) + '\n```' });
const denied = (out: any) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('ReviewResult parsing and invariants', () => {
  assert.deepEqual(lastJson('text\n```json\n{"a":1}\n```\nmore'), { a: 1 });
  assert.deepEqual(lastJson('final: {"status":"x"}'), { status: 'x' });
  const ok = { snapshotId: 'S1', status: 'no_blocking_findings', findings: [] };
  assert.equal(validateReview(ok, 'S1'), null);
  assert.match(validateReview(ok, 'S2')!, /snapshotId/);
  assert.match(validateReview({ ...ok, status: 'changes_required' }, 'S1')!, /at least one blocking/);
  const blocker = { severity: 'blocking', location: 'a.js:1', issue: 'x', evidence: 'y', expectedBehavior: 'z' };
  assert.match(validateReview({ ...ok, findings: [blocker] }, 'S1')!, /requires status changes_required/);
  assert.equal(validateReview({ ...ok, status: 'changes_required', findings: [blocker] }, 'S1'), null);
});

test('review mode: R0 blocks, one correction, fresh R1 verifies', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: change a' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  assert.equal(run0(root).mode, 'review');
  check(root);
  let r = run0(root);
  const s0 = startReview(root, r, loadConfig(root));
  assert.equal(s0.ok, true);
  assert.match(s0.text, /subagent_type "jodex:reviewer"/);
  saveRun(root, r);
  const snap = r.reviews![0].snapshotId;
  assert.ok(fs.existsSync(path.join(root, r.reviews![0].snapshotDir, 'diff.patch')));

  // While the reviewer runs: the worker cannot edit, the reviewer cannot write, the worker may stop.
  assert.ok(denied(await handleHook(write(root, 'src/a.js'))));
  const sub = { agent_id: 'A1', agent_type: 'jodex:reviewer' };
  assert.ok(denied(await handleHook(write(root, 'src/a.js', sub))));
  assert.ok(denied(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf src' }, ...sub }))));
  assert.ok(denied(await handleHook(ev(root, 'PreToolUse', { tool_name: 'mcp__repl__eval', tool_input: {}, ...sub }))));
  assert.deepEqual(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' }, ...sub })), {});
  assert.deepEqual(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(root, 'src/a.js') }, ...sub })), {});
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'Waiting for the reviewer.' })), {});

  // Claude's internal agents are ignored; a malformed result is sent back once.
  assert.deepEqual(await handleHook(ev(root, 'SubagentStop', { agent_id: 'X', agent_type: '', last_assistant_message: '{}' })), {});
  const bad: any = await handleHook(ev(root, 'SubagentStop', { ...sub, last_assistant_message: 'looks fine' }));
  assert.equal(bad.decision, 'block');
  const blocker = { severity: 'blocking', location: 'src/a.js:1', issue: 'wrong constant', evidence: 'a = 2', expectedBehavior: 'a = 3' };
  await handleHook(review(root, { snapshotId: snap, status: 'changes_required', findings: [blocker] }));
  r = run0(root);
  assert.equal(r.awaiting, null);
  assert.equal(r.reviews![0].findings[0].confirmed, true);
  assert.match(evaluate(r, loadConfig(root), sourceIdentity(root)).next!, /fix the confirmed blockers/);

  // F1: the correction budget is consumed when the fix starts.
  assert.deepEqual(await handleHook(write(root, 'src/a.js')), {});
  assert.equal(run0(root).corrections, 1);
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 3;\n');
  check(root);
  r = run0(root);
  assert.equal(startReview(root, r, loadConfig(root)).ok, true);
  saveRun(root, r);
  await handleHook(review(root, { snapshotId: r.reviews![1].snapshotId, status: 'no_blocking_findings', findings: [] }));
  r = run0(root);
  assert.equal(r.reviews![1].round, 'R1');
  assert.equal(evaluate(r, loadConfig(root), sourceIdentity(root)).status, 'verified');

  // Editing after the review makes it stale.
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 4;\n');
  check(root);
  assert.equal(evaluate(run0(root), loadConfig(root), sourceIdentity(root)).status, 'review_required');
});

test('correction budget: a second blocking round stops further edits', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: x' }));
  await handleHook(write(root, 'src/a.js'));
  const blocker = { severity: 'blocking', location: 'a', issue: 'i', evidence: 'e', expectedBehavior: 'x' };
  for (const round of [0, 1]) {
    fs.writeFileSync(path.join(root, 'src/a.js'), `export const a = ${10 + round};\n`);
    check(root);
    const r = run0(root);
    assert.equal(startReview(root, r, loadConfig(root)).ok, true, `R${round}`);
    saveRun(root, r);
    await handleHook(review(root, { snapshotId: r.reviews![round].snapshotId, status: 'changes_required', findings: [blocker] }));
    if (round === 0) await handleHook(write(root, 'src/a.js'));
  }
  assert.ok(denied(await handleHook(write(root, 'src/a.js'))));
  assert.equal(startReview(root, run0(root), loadConfig(root)).ok, false);
  assert.match(evaluate(run0(root), loadConfig(root), sourceIdentity(root)).next!, /budget is used up/);
});

test('D4: a blocker Jev does not confirm goes to the developer', async () => {
  const root = repo('enforce');
  jev.askIntake = async () => {
    throw new Error('offline');
  };
  jev.askFinding = async () => ({ model: 'jev-test', usage: { input_tokens: 1, output_tokens: 1 }, label: 'question', probabilities: { blocker: 0.2, nonblocker: 0.1, question: 0.7 } });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: y' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 5;\n');
  check(root);
  const r = run0(root);
  startReview(root, r, loadConfig(root));
  saveRun(root, r);
  await handleHook(review(root, { snapshotId: r.reviews![0].snapshotId, status: 'changes_required', findings: [{ severity: 'blocking', location: 'a', issue: 'maybe', evidence: 'e', expectedBehavior: 'x' }] }));
  const f = run0(root).reviews![0].findings[0];
  assert.equal(f.confirmed, false);
  assert.equal(f.jev!.label, 'question');
  assert.match(evaluate(run0(root), loadConfig(root), sourceIdentity(root)).next!, /developer, who decides/);
});

test('collaborative: plan first, same worker challenges, one revision', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: redesign a' }));
  assert.equal(run0(root).mode, 'collaborative');
  assert.ok(denied(await handleHook(write(root, 'src/a.js'))), 'no edits before an accepted plan');
  let r = run0(root);
  assert.equal(startPlan(root, r, loadConfig(root)).ok, true);
  saveRun(root, r);
  const planner = { agent_id: 'P', agent_type: 'jodex:planner' };
  assert.ok(denied(await handleHook(write(root, 'src/a.js', planner))), 'planner is read-only');
  await handleHook(ev(root, 'SubagentStop', { ...planner, last_assistant_message: '# Plan v1\n- change a' }));
  r = run0(root);
  assert.equal(r.plans!.length, 1);
  assert.match(decidePlan(r, 'revise', 'wrong symbol: a is a const'), /Revision requested/);
  assert.equal(startPlan(root, r, loadConfig(root)).ok, true);
  saveRun(root, r);
  await handleHook(ev(root, 'SubagentStop', { ...planner, last_assistant_message: '# Plan v2\n- export a new const' }));
  r = run0(root);
  assert.match(decidePlan(r, 'revise', 'again'), /budget is used up/);
  assert.match(decidePlan(r, 'accept', ''), /accepted/);
  saveRun(root, r);
  assert.deepEqual(await handleHook(write(root, 'src/a.js')), {});
  assert.equal(fs.readFileSync(path.join(root, r.plans![1].file), 'utf8'), '# Plan v2\n- export a new const');
});

test('tester may write only test files', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' }));
  await handleHook(write(root, 'src/a.js'));
  const r = run0(root);
  r.awaiting = { role: 'tester', since: '' };
  saveRun(root, r);
  const t = { agent_id: 'T', agent_type: 'jodex:tester' };
  assert.ok(denied(await handleHook(write(root, 'src/a.js', t))));
  assert.deepEqual(await handleHook(write(root, 'test/a.test.js', t)), {});
});

test('review packet covers only this run; other uncommitted work is context', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'README.md'), 'someone else\'s edit\n');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: change a' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 9;\n');
  check(root);
  const r = run0(root);
  startReview(root, r, loadConfig(root));
  const dir = path.join(root, r.reviews![0].snapshotDir);
  const diff = fs.readFileSync(path.join(dir, 'diff.patch'), 'utf8');
  assert.match(diff, /src\/a\.js/);
  assert.equal(diff.includes('README.md'), false);
  assert.match(fs.readFileSync(path.join(dir, 'other-changes.txt'), 'utf8'), /README\.md/);
});

test('review diff shows only this run\'s edits to a file that already had uncommitted changes', async () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 1;\nexport const earlier = true;\n');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: add b' }));
  await handleHook(write(root, 'src/a.js'));
  fs.appendFileSync(path.join(root, 'src/a.js'), 'export const b = 2;\n');
  check(root);
  const r = run0(root);
  startReview(root, r, loadConfig(root));
  const diff = fs.readFileSync(path.join(root, r.reviews![0].snapshotDir, 'diff.patch'), 'utf8');
  assert.match(diff, /\+export const b = 2;/);
  assert.equal(diff.includes('+export const earlier'), false);
});

test('a reported status keeps the run open while the agent still has a step', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: z' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 7;\n');
  check(root);
  // Next step is `jodex review start` (the agent's), so reporting review_required keeps the run.
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'Jodex status: review_required' }));
  assert.equal(listRuns(root)[0].open, true);
});

test('read-only roles: shell bypasses are denied', async () => {
  const { isReadOnlyCommand } = await import('../src/team.ts');
  for (const c of ['cat a\nrm -rf src', 'find src -exec rm {} +', 'find . -delete', 'git diff --output=src/a.js', 'sed -n "w src/x" a', 'rg --pre ./x.sh y', 'cat a > b', 'ls; rm x'])
    assert.equal(isReadOnlyCommand(c), false, c);
  for (const c of ['git status', 'rg -n foo src', 'cat src/a.js', 'git ls-files']) assert.equal(isReadOnlyCommand(c), true, c);
  // diff drivers and textconv can run programs: reviewers read the packet's diff.patch instead
  for (const c of ['git diff HEAD', 'git show HEAD:src/a.js', 'git log -p']) assert.equal(isReadOnlyCommand(c), false, c);
});

test('Codex: a helper subagent finishing first is ignored, the real reviewer is recorded', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: q', turn_id: 't' }));
  await handleHook({ ...write(root, 'src/a.js'), turn_id: 't' });
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 3;\n');
  check(root);
  const r = run0(root);
  startReview(root, r, loadConfig(root));
  saveRun(root, r);
  const codexStop = (msg: string) => ev(root, 'SubagentStop', { turn_id: 't', agent_id: 'X', agent_type: 'default', last_assistant_message: msg });
  assert.deepEqual(await handleHook(codexStop('Found the callers in src/.')), {});
  assert.notEqual(run0(root).awaiting, null, 'still waiting for the reviewer');
  await handleHook(codexStop('```json\n' + JSON.stringify({ snapshotId: r.reviews![0].snapshotId, status: 'no_blocking_findings', findings: [] }) + '\n```'));
  assert.equal(run0(root).reviews![0].status, 'no_blocking_findings');
});

test('a subagent that never reports stops blocking after the timeout or `cancel`', async () => {
  const { expireAwaiting } = await import('../src/run.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: w' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 4;\n');
  check(root);
  const r = run0(root);
  startReview(root, r, loadConfig(root));
  r.awaiting!.since = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  saveRun(root, r);
  assert.deepEqual(await handleHook(write(root, 'src/a.js')), {}, 'expired: the worker may edit again');
  const after = run0(root);
  assert.equal(after.awaiting, null);
  assert.equal(after.reviews![0].status, 'invalid');
  assert.equal(expireAwaiting(after), false);
});

test('a blocker fixed through the shell still opens R1, and counts the correction', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: s' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 20;\n');
  check(root);
  let r = run0(root);
  startReview(root, r, loadConfig(root));
  saveRun(root, r);
  await handleHook(review(root, { snapshotId: r.reviews![0].snapshotId, status: 'changes_required', findings: [{ severity: 'blocking', location: 'a', issue: 'i', evidence: 'e', expectedBehavior: 'x' }] }));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 21;\n'); // shell edit: no PreToolUse
  check(root);
  r = run0(root);
  assert.equal(startReview(root, r, loadConfig(root)).ok, true);
  assert.equal(r.corrections, 1);
});

test('tester shell edits to production files are caught when it stops', async () => {
  const { startTests } = await import('../src/team.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' }));
  await handleHook(write(root, 'src/a.js'));
  let r = run0(root);
  startTests(root, r, loadConfig(root));
  saveRun(root, r);
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 99;\n'); // sed -i by the tester
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test/a.test.js'), '// ok\n');
  const transcript = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 'agent-T.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5-5' } }) + '\n');
  await handleHook(ev(root, 'SubagentStop', { agent_id: 'T', agent_type: 'jodex:tester', agent_transcript_path: transcript, last_assistant_message: 'tests added' }));
  r = run0(root);
  const attempt = r.attempts!.find((a) => a.role === 'tester')!;
  assert.deepEqual([attempt.observed.model, attempt.observed.source, attempt.agentId], ['claude-sonnet-5-5', 'claude-subagent-transcript', 'T'], "the typed child's own transcript names its model");
  assert.equal(r.roleModels, undefined, 'roleModels is legacy and no longer written');
  assert.deepEqual(r.testerOutOfScope, ['src/a.js']);
  assert.ok(r.testerDoneAt, 'a reported tester result is recorded for the board');
  check(root);
  assert.equal(evaluate(run0(root), loadConfig(root), sourceIdentity(root)).gates.find((g) => g.gate === 'tester_scope')?.state, 'pending');
});

test('a run opened by jodex check after shell-only edits takes the session prompt', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'add the live map' }));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  const run = createRun(root, null, '');
  reconcileSession(root, run, loadConfig(root));
  assert.equal(run.request, 'add the live map');
  assert.equal(run.sessionId, 'S', 'the run is claimed by the active session');
  assert.equal(run.host, 'claude-code');
  assert.deepEqual(run.touched, ['src/a.js']);
});

test('the review packet carries recent prompts and attached evidence', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'add a session filter to the board' }));
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'Shall I do it?' }));
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'agreed' }));
  await handleHook(write(root, 'src/a.js'));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(root, 'shot.png'), 'png');
  check(root);
  const r = run0(root);
  assert.equal(startReview(root, r, loadConfig(root), false, ['shot.png']).ok, true);
  const dir = path.join(root, r.reviews![0].snapshotDir);
  const request = fs.readFileSync(path.join(dir, 'request.md'), 'utf8');
  assert.match(request, /^agreed\n/);
  assert.match(request, /- add a session filter to the board/);
  assert.equal(fs.readFileSync(path.join(dir, 'evidence/1-shot.png'), 'utf8'), 'png');
  assert.match(fs.readFileSync(path.join(root, r.reviews![0].briefFile!), 'utf8'), /evidence\/1-shot\.png/);
});

test('evidence outside the project or temp dirs, or secret-looking, is refused', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, '.env.local'), 'K=1');
  assert.match(checkEvidence(root, ['/etc/hosts'])!, /inside the project/);
  assert.match(checkEvidence(root, ['.env.local'])!, /secret/);
  assert.match(checkEvidence(root, ['missing.png'])!, /not found/);
  assert.equal(checkEvidence(root, ['src/a.js']), null);
});

test('a new planner or tester attempt drops the previous attempt\'s model', async () => {
  const { startTests } = await import('../src/team.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: x' }));
  const r = run0(root);
  r.roleModels = { planner: 'old-planner', tester: 'old-tester' };
  assert.equal(startPlan(root, r, loadConfig(root)).ok, true);
  assert.equal(r.roleModels.planner, undefined);
  assert.deepEqual(r.attempts!.map((a) => [a.key, a.observed.model, a.since === r.awaiting!.since]), [['planner-0', null, true]], 'the attempt starts unknown');
  const root2 = repo();
  await handleHook(ev(root2, 'UserPromptSubmit', { prompt: 'x' }));
  await handleHook(write(root2, 'src/a.js'));
  const t = run0(root2);
  t.roleModels = { tester: 'old-tester' };
  assert.equal(startTests(root2, t, loadConfig(root2)).ok, true);
  assert.equal(t.roleModels.tester, undefined);
  t.attempts![0].observed.model = 'claude-sonnet-5-5';
  t.awaiting = null;
  assert.equal(startTests(root2, t, loadConfig(root2)).ok, true);
  assert.deepEqual(t.attempts!.map((a) => [a.key, a.observed.model]), [['tester-0', 'claude-sonnet-5-5'], ['tester-1', null]], 'a new attempt does not inherit the previous model');
});
