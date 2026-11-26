import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { handleHook } from '../src/hooks.ts';
import { createRun, listRuns, saveRun } from '../src/run.ts';
import { startReview } from '../src/team.ts';
import { tempRepo, writeConfig } from './helpers.ts';

const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S1', cwd: root, ...extra });
const write = (root: string, rel: string) => ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, rel) } });

test('uninitialized project: every hook is a no-op', async () => {
  const root = tempRepo();
  assert.deepEqual(await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' })), {});
  assert.deepEqual(await handleHook(write(root, 'a.ts')), {});
  assert.deepEqual(await handleHook(ev(root, 'Stop', { stop_hook_active: false })), {});
});

test('question-only prompt: context injected, no run, stop allowed', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  const out: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'what does clamp do?' }));
  assert.match(out.hookSpecificOutput.additionalContext, /jevmind check/);
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'It clamps.' })), {});
  assert.equal(listRuns(root).length, 0);
});

test('task notification prompt is ignored', async () => {
  const root = tempRepo();
  writeConfig(root, {});
  assert.deepEqual(await handleHook(ev(root, 'UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' })), {});
});

test('write creates a run; .jevmind writes are denied', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'add greeting' }));
  assert.deepEqual(await handleHook(write(root, 'src/a.ts')), {});
  const [run] = listRuns(root);
  assert.equal(run.request, 'add greeting');
  assert.deepEqual(run.touched, ['src/a.ts']);
  const denied: any = await handleHook(write(root, '.jevmind/config.toml'));
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
});

test('stop gate: blocks once, never loops, closes a reported verified run', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'exit 1' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'fix bug' }));
  await handleHook(write(root, 'src/a.ts'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'x');

  const blocked: any = await handleHook(ev(root, 'Stop', { last_assistant_message: 'Done!' }));
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /review_required/);
  // The agent stops again without fixing anything: allowed, status recorded.
  assert.deepEqual(await handleHook(ev(root, 'Stop', { stop_hook_active: true, last_assistant_message: 'Done!' })), {});
  let [run] = listRuns(root);
  assert.equal(run.completion?.status, 'review_required');
  assert.equal(run.open, true);

  runChecks(root, loadConfig(root), run, () => {});
  saveRun(root, run);
  assert.match(((await handleHook(ev(root, 'Stop', { last_assistant_message: 'ok' }))) as any).reason, /failed_verification/);

  writeConfig(root, { test: 'true' });
  [run] = listRuns(root);
  runChecks(root, loadConfig(root), run, () => {});
  saveRun(root, run);
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'Fixed.\nJevmind status: verified' })), {});
  [run] = listRuns(root);
  assert.equal(run.open, false);
});

test('shell-only edits are caught at stop through the prompt baseline', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'tweak readme' }));
  execFileSync('sh', ['-c', 'echo changed >> README.md'], { cwd: root });
  const out: any = await handleHook(ev(root, 'Stop', { last_assistant_message: 'done' }));
  assert.equal(out.decision, 'block');
  assert.deepEqual(listRuns(root)[0].touched, ['README.md']);
});

test('critical path keeps the run at review_required', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change login' }));
  await handleHook(write(root, 'src/auth/login.ts'));
  const out: any = await handleHook(ev(root, 'Stop', { last_assistant_message: 'x' }));
  assert.match(out.reason, /risk critical/);
});

test('invalid config fails closed for Claude and Codex hooks while preserving read-only access', async () => {
  const invalidConfigs = [
    '[risk\n',
    '[risk]\ncritical = "src/auth/**"\n',
    '[risk]\nhuman_review_required = ["urgent"]\n',
    '[checks]\ntest = 42\n',
  ];

  for (const config of invalidConfigs) for (const host of [{}, { turn_id: 'T1', model: 'gpt-test' }]) {
    const root = tempRepo();
    writeConfig(root, { test: 'true' });
    fs.writeFileSync(path.join(root, '.jevmind/config.toml'), config);

    const prompt: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'please inspect this', ...host }));
    assert.match(prompt.hookSpecificOutput.additionalContext, /configuration cannot be read or is invalid/);
    assert.deepEqual(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(root, 'README.md') }, ...host })), {});
    assert.deepEqual(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git status' }, ...host })), {});

    const denied: any = await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'README.md') }, ...host }));
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(denied.hookSpecificOutput.permissionDecisionReason, /configuration cannot be read or is invalid/);
    assert.equal((await handleHook(ev(root, 'Stop', { last_assistant_message: 'Done', ...host })) as any).decision, 'block');
  }
});

test('shell edit to a critical path after `jevmind check` still counts as critical', async () => {
  const root = tempRepo({ 'src/auth/session.js': 'export const ttl = 60;\n' });
  writeConfig(root, { test: 'true' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'shorten the session ttl' }));
  execFileSync('sh', ['-c', "sed -i.bak 's/60/30/' src/auth/session.js && rm src/auth/session.js.bak"], { cwd: root });
  // `jevmind check` with no open run opens an unclaimed run with no touched files.
  const cfg = loadConfig(root);
  const run = createRun(root, null, '');
  runChecks(root, cfg, run, () => {});
  saveRun(root, run);
  const out: any = await handleHook(ev(root, 'Stop', { last_assistant_message: 'Done.\nJevmind status: verified' }));
  assert.equal(out.decision, 'block', 'verified is not the true status');
  assert.match(out.reason, /risk critical/);
  assert.deepEqual(listRuns(root)[0].touched, ['src/auth/session.js']);
});

test('a reported status closes the run once only the developer can act; the next task starts fresh', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change login' }));
  await handleHook(write(root, 'src/auth/login.ts'));
  fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/auth/login.ts'), 'x');
  let run = listRuns(root)[0];
  runChecks(root, loadConfig(root), run, () => {});
  saveRun(root, run);
  // Critical forces a review: reporting before it keeps the run open, and the next prompt is reminded.
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'Jevmind status: review_required' }));
  assert.equal(listRuns(root)[0].open, true);
  const reminder: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'anything else?' }));
  assert.match(reminder.hookSpecificOutput.additionalContext, /still open.*jevmind review start/s);
  run = listRuns(root)[0];
  startReview(root, run, loadConfig(root));
  saveRun(root, run);
  await handleHook(ev(root, 'SubagentStop', { agent_id: 'R', agent_type: 'jevmind:reviewer', last_assistant_message: JSON.stringify({ snapshotId: run.reviews![0].snapshotId, status: 'no_blocking_findings', findings: [] }) }));
  // Only human review is left: the developer's step, so reporting closes the run.
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'Jevmind status: review_required' }));
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'fix readme typo' }));
  await handleHook(write(root, 'README.md'));
  fs.writeFileSync(path.join(root, 'README.md'), 'fixed\n');
  const second = listRuns(root).find((r) => r.open)!;
  assert.equal(second.request, 'fix readme typo');
  assert.equal(second.riskFloor, 'low');
  runChecks(root, loadConfig(root), second, () => {});
  saveRun(root, second);
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'Jevmind status: verified' })), {});
  assert.deepEqual(listRuns(root).map((r) => [r.request, r.completion?.status, r.open]), [
    ['change login', 'review_required', false],
    ['fix readme typo', 'verified', false],
  ]);
});

test('the status must be the last line: an earlier quoted status does not count', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'exit 1' });
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' }));
  await handleHook(write(root, 'a.txt'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'x');
  const run = listRuns(root)[0];
  runChecks(root, loadConfig(root), run, () => {});
  saveRun(root, run);
  const sneaky: any = await handleHook(ev(root, 'Stop', { last_assistant_message: 'Before: Jevmind status: failed_verification\nJevmind status: verified' }));
  assert.equal(sneaky.decision, 'block');
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'Tests fail.\n**Jevmind status: failed_verification**' })), {});
});
