// Approval through the Claude Code AskUserQuestion dialog instead of typing the CLI accept command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { handleHook } from '../src/hooks.ts';
import { sourceIdentity } from '../src/project.ts';
import { acceptQuestion, evaluate, listRuns, saveRun } from '../src/run.ts';
import { tempRepo, writeConfig } from './helpers.ts';

const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S1', cwd: root, ...extra });
const denied = (o: any) => o?.hookSpecificOutput?.permissionDecision === 'deny';

// A critical change with passing checks: only the human review is pending.
async function pending(host?: 'codex') {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  const extra = host ? { turn_id: 't1' } : {};
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change auth', ...extra }));
  await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/auth/a.ts') }, ...extra }));
  fs.mkdirSync(path.join(root, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/auth/a.ts'), 'x');
  const run = listRuns(root)[0];
  run.mode = 'solo'; // no AI review gate: only the human review is left
  runChecks(root, loadConfig(root), run, () => {});
  saveRun(root, run);
  return { root, run, question: acceptQuestion(run, sourceIdentity(root)) };
}
const answer = (root: string, question: string, pick: string, extra: object = {}) =>
  ev(root, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_response: { questions: [{ question, header: 'Jevmind', options: [], multiSelect: false }], answers: { [question]: pick }, annotations: {} }, ...extra });
const reload = (root: string) => listRuns(root)[0];

test('next step: Claude Code asks with AskUserQuestion, Codex keeps the CLI accept text', async () => {
  const c = await pending();
  const next = evaluate(reload(c.root), loadConfig(c.root), sourceIdentity(c.root)).next!;
  assert.ok(next.includes('AskUserQuestion') && next.includes(c.question), next);
  assert.match(c.question, new RegExp(`Jevmind run ${c.run.runId} @${sourceIdentity(c.root).slice(0, 8)}`));
  const x = await pending('codex');
  const old = evaluate(reload(x.root), loadConfig(x.root), sourceIdentity(x.root)).next!;
  assert.equal(old, 'report the status; the developer reviews and runs `jevmind accept`');
});

test('dialog Accept / Reject record the decision; other picks record nothing', async () => {
  const a = await pending();
  assert.equal(evaluate(reload(a.root), loadConfig(a.root), sourceIdentity(a.root)).status, 'review_required');
  await handleHook(answer(a.root, a.question, 'Review the diff first'));
  assert.equal(reload(a.root).acceptance, undefined);
  const out: any = await handleHook(answer(a.root, a.question, 'Accept'));
  assert.match(out.hookSpecificOutput.additionalContext, /accepted/);
  const r = reload(a.root);
  assert.equal(r.acceptance?.decision, 'accepted');
  assert.equal(r.open, false);
  assert.equal(r.completion?.status, 'verified');
  const b = await pending();
  await handleHook(answer(b.root, b.question, 'Reject'));
  assert.equal(reload(b.root).acceptance?.decision, 'rejected');
});

test('only the exact labels count as a decision', async () => {
  const { root, question } = await pending();
  for (const pick of ['accept', 'Accept, Review the diff first', 'Reject, Accept', 'reject']) await handleHook(answer(root, question, pick));
  assert.equal(reload(root).acceptance, undefined);
});

test('Stop after a dialog Accept opens no new run for the same files', async () => {
  const { root, question } = await pending();
  await handleHook(answer(root, question, 'Accept'));
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'Done.\nJevmind status: verified' }));
  const runs = listRuns(root);
  assert.equal(runs.length, 1);
  assert.equal(runs.filter((r) => r.open).length, 0);
  assert.equal(runs[0].acceptance?.decision, 'accepted');
});

test('dialog answer is ignored for a stale source, a decided run and a subagent', async () => {
  const s = await pending();
  fs.writeFileSync(path.join(s.root, 'src/auth/a.ts'), 'changed');
  await handleHook(answer(s.root, s.question, 'Accept'));
  assert.equal(reload(s.root).acceptance, undefined, 'source changed after the question');

  const d = await pending();
  await handleHook(answer(d.root, d.question, 'Reject'));
  await handleHook(answer(d.root, d.question, 'Accept'));
  assert.equal(reload(d.root).acceptance?.decision, 'rejected', 'an already decided run is not overwritten');

  const g = await pending();
  await handleHook(answer(g.root, g.question, 'Accept', { agent_id: 'sub1' }));
  assert.equal(reload(g.root).acceptance, undefined, 'a subagent event is ignored');
});

test('PreToolUse denies a pre-answered Jevmind approval question only', async () => {
  const { root, question } = await pending();
  const ask = (q: string, answers?: object) => ev(root, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: q }], ...(answers ? { answers } : {}) } });
  assert.ok(denied(await handleHook(ask(question, { [question]: 'Accept' }))));
  assert.ok(!denied(await handleHook(ask(question))));
  assert.ok(!denied(await handleHook(ask('Which color?', { 'Which color?': 'red' }))));
});

test('task notification restores a missing session file without Jev or prompt memory', async () => {
  const root = tempRepo();
  writeConfig(root, { test: 'true' });
  const file = path.join(root, '.jevmind/sessions/S1.json');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'add greeting' }));
  const before = fs.readFileSync(file, 'utf8');
  const decisions = () => fs.readdirSync(path.join(root, '.jevmind'), { recursive: true }).filter((f) => /decision/i.test(String(f))).length;
  const n = decisions();
  const note = ev(root, 'UserPromptSubmit', { prompt: '<task-notification>\n<task-id>x</task-id>' });
  assert.deepEqual(await handleHook(note), {});
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'an existing session file is unchanged');
  fs.rmSync(file);
  assert.deepEqual(await handleHook(note), {});
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.lastPrompt, 'add greeting');
  assert.ok(s.baseline && s.promptAt);
  assert.equal(decisions(), n, 'no Jev decision appended');
});
