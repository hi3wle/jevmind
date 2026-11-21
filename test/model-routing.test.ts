// Model routing P0+P1 (plan .jodex/runs/20261121-4a4019/plan-1.md with the MR amendments).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pipeline } from '../src/board.ts';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { readDecisions } from '../src/decisions.ts';
import { claudeUsage, handleHook } from '../src/hooks.ts';
import { type IntakeAnswers, jev } from '../src/jev.ts';
import { type Attempt, createRun, listRuns, mismatchOf, type Run, saveRun } from '../src/run.ts';
import { activeSessionId, propose, startPlan, startReview, startTests } from '../src/team.ts';
import { tempRepo } from './helpers.ts';

// jevMode enforce: D1 (stubbed below) recommends collaborative for every prompt.
function repo(extra = '', jevMode = 'off') {
  const root = tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), `[risk]\ncritical = ["**/auth/**"]\n[checks]\ntest = "true"\n[review]\ncross_provider = false\n[jev]\nmode = "${jevMode}"\nconsent = true\n${extra}`);
  return root;
}
const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra });
const bash = (root: string, command: string, extra: object = {}) => ev(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, ...extra });
const write = (root: string, file: string, extra: object = {}) => ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.isAbsolute(file) ? file : path.join(root, file) }, ...extra });
const denied = (o: any) => o?.hookSpecificOutput?.permissionDecision === 'deny';
const run0 = (root: string) => listRuns(root).find((r) => r.open)!;
const PLAN_LOCK = /collaborative mode: get the plan accepted first/;

// D1 recommends collaborative; D2 is offline (fails open to the rules).
const collaborative = (): IntakeAnswers => ({
  model: 'jev-test',
  usage: { input_tokens: 1, output_tokens: 1 },
  isChange: 0.9,
  mode: { value: 'collaborative', probabilities: { solo: 0.1, review: 0.1, collaborative: 0.8, clarify: 0 } },
  risk: { value: 'low', probabilities: { low: 0.9, elevated: 0.08, critical: 0.02 }, confidence: 0.8 },
  missingRule: 0.1,
});
jev.askIntake = async () => collaborative();
jev.askCommand = async () => {
  throw new Error('offline');
};

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const jodex = (root: string, ...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, JODEX_DISABLE: '' } });

test('P0-pre: an agent message is not a new task and asks Jev nothing', async () => {
  const root = repo('', 'enforce');
  assert.deepEqual(await handleHook(ev(root, 'UserPromptSubmit', { prompt: '<agent-message from="x">\nresult' })), {});
  assert.equal(readDecisions(root).length, 0);
});

test('P0a: a Jev-recommended collaborative question opens no run; reads, tests and jodex stay free', async () => {
  const root = repo('', 'enforce');
  const out: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'how does a work?' }));
  assert.match(out.hookSpecificOutput.additionalContext, /Jev recommends collaborative/);
  assert.equal(listRuns(root).length, 0, 'no run at prompt time');
  for (const c of ['ls', 'npm test', 'jodex status']) assert.deepEqual(await handleHook(bash(root, c)), {}, c);
  assert.equal(listRuns(root).length, 0);
  assert.deepEqual(await handleHook(ev(root, 'Stop', { last_assistant_message: 'a is a constant.' })), {});
});

test('P0a: a command that may change files opens the collaborative run and is denied', async () => {
  for (const c of ['touch x', 'python3 s.py', 'git log']) {
    const root = repo('', 'enforce');
    await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change a' }));
    const out: any = await handleHook(bash(root, c));
    assert.ok(denied(out), c);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, PLAN_LOCK, c);
    assert.equal(run0(root).mode, 'collaborative', c);
  }
  const root = repo('', 'enforce');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: change a' }));
  assert.equal(run0(root)?.mode, 'collaborative', 'the collab: override still opens the run at prompt time');
});

test('R0 blocker: a lone `&` does not smuggle a write past the free set or the lock', async () => {
  const root = repo('', 'enforce');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'how does a work?' }));
  const out: any = await handleHook(bash(root, 'npm test & touch src/x.ts'));
  assert.ok(denied(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, PLAN_LOCK);
  assert.equal(run0(root).mode, 'collaborative', 'the run opened');
  const root2 = repo();
  await pendingPlan(root2);
  assert.ok(denied(await handleHook(bash(root2, 'jodex status & touch x'))));
});

test('R1 blocker: source-rewriting lint and build flags are not free before a plan', async () => {
  const quoted = ['npx tsc "--outDir" src', "npx tsc --noEmit '--outDir' src", 'npm test -- "--write"'];
  for (const c of ['npx eslint --fix src', 'npm run lint -- --fix', 'cargo clippy --fix', 'npx tsc --outDir src', ...quoted]) {
    const root = repo('', 'enforce');
    await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'how does a work?' }));
    for (const free of ['npm test', 'npx tsc --noEmit -p .']) assert.deepEqual(await handleHook(bash(root, free)), {}, free);
    assert.equal(listRuns(root).length, 0);
    const out: any = await handleHook(bash(root, c));
    assert.ok(denied(out), c);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, PLAN_LOCK, c);
    assert.equal(run0(root).mode, 'collaborative', c);
  }
});

test('R1: a planner restarted after cancel gets a new attempt key', async () => {
  const { expireAwaiting } = await import('../src/run.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: x' }));
  const r = run0(root);
  assert.equal(startPlan(root, r, loadConfig(root)).ok, true);
  expireAwaiting(r, 'cancelled by `jodex cancel`');
  assert.equal(startPlan(root, r, loadConfig(root)).ok, true);
  assert.deepEqual(r.attempts!.map((a) => a.key), ['planner-0', 'planner-1']);
});

test('R3.1: a denied first Write saves the raised mode, so the next shell command is still locked', async () => {
  const root = repo('', 'enforce');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change a' }));
  assert.ok(denied(await handleHook(write(root, 'src/a.js'))));
  assert.equal(run0(root).mode, 'collaborative');
  assert.ok(denied(await handleHook(bash(root, 'touch x'))));
});

test('P0b: temp writes outside the repo open no run and are allowed while a role is awaited', async () => {
  const root = repo();
  const tmp = path.join(os.tmpdir(), `jodex-scratch-${process.pid}.md`);
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: x' }));
  assert.deepEqual(await handleHook(write(root, tmp)), {});
  assert.deepEqual(await handleHook(write(root, '/tmp/jodex-scratch.md')), {}, '/tmp counts as temp (B)');
  assert.equal(listRuns(root).length, 0);
  await handleHook(write(root, 'src/a.js'));
  const helper = { agent_id: 'H', agent_type: 'general-purpose' };
  assert.deepEqual(await handleHook(write(root, tmp, helper)), {}, 'helpers may write temp in a team run (C)');
  assert.ok(denied(await handleHook(write(root, 'src/a.js', helper))), 'but not the repo');
  const r = run0(root);
  r.awaiting = { role: 'tester', since: new Date().toISOString() };
  saveRun(root, r);
  assert.deepEqual(await handleHook(write(root, tmp)), {}, 'the worker may use scratch space while waiting');
  assert.ok(denied(await handleHook(write(root, tmp, { agent_id: 'T', agent_type: 'jodex:tester' }))), 'the tester writes test files only');
  assert.ok(denied(await handleHook(write(root, tmp, { agent_id: 'R', agent_type: 'jodex:reviewer' }))), 'the reviewer is read-only');
  assert.deepEqual(run0(root).touched, ['src/a.js']);
});

test('P0b: a non-temp path outside the repo is never touched, and is denied while waiting or before a plan', async () => {
  // Not under any temp dir (JODEX_HOME from the helpers is): nothing is written there by the hook.
  const outside = path.join(os.homedir(), `.jodex-nontemp-${process.pid}`, 'notes.md');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'solo: x' }));
  assert.deepEqual(await handleHook(write(root, outside)), {});
  assert.equal(listRuns(root).length, 0, 'an outside path is not a touched file');
  await handleHook(write(root, 'src/a.js'));
  const r = run0(root);
  r.awaiting = { role: 'tester', since: new Date().toISOString() };
  saveRun(root, r);
  assert.ok(denied(await handleHook(write(root, outside))), 'role awaited');
  const root2 = repo();
  await handleHook(ev(root2, 'UserPromptSubmit', { prompt: 'collab: x' }));
  assert.ok(denied(await handleHook(write(root2, outside))), 'plan pending');
  assert.deepEqual(run0(root2).touched, []);
  assert.equal(fs.existsSync(path.dirname(outside)), false);
});

test('P0b, R3.6: a symlinked alias of the repo and an in-repo link into /tmp are in-repo paths', async () => {
  const root = repo();
  const alias = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'alias-')), 'repo');
  fs.symlinkSync(root, alias);
  fs.symlinkSync('/tmp/jodex-link-target.md', path.join(root, 'link.md'));
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'solo: x' }));
  assert.deepEqual(await handleHook(write(root, path.join(alias, 'src/a.js'))), {});
  assert.deepEqual(await handleHook(write(root, 'link.md')), {});
  assert.deepEqual(run0(root).touched, ['src/a.js', 'link.md']);
});

async function pendingPlan(root: string) {
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: redesign a' }));
  const r = run0(root);
  startPlan(root, r, loadConfig(root));
  saveRun(root, r);
  await handleHook(ev(root, 'SubagentStop', { agent_id: 'P', agent_type: 'jodex:planner', last_assistant_message: '# Plan v1\n- change a' }));
  assert.equal(run0(root).plans![0].decision, null);
}

test('P0c: `jodex review plan` is allowed for the worker while a plan is pending, not for a helper', async () => {
  const root = repo();
  await pendingPlan(root);
  assert.deepEqual(await handleHook(bash(root, 'jodex review plan')), {});
  assert.deepEqual(await handleHook(bash(root, 'jodex review plan 2>&1')), {});
  assert.ok(denied(await handleHook(bash(root, 'jodex review plan > out.txt'))), 'not a file write');
  assert.ok(denied(await handleHook(bash(root, 'jodex review plan', { agent_id: 'H', agent_type: 'general-purpose' }))));
});

const transcript = (...entries: object[]) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 'agent.jsonl');
  fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return f;
};
const handbackEntry = (message: string) => ({ type: 'assistant', message: { model: 'claude-opus-fake', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }] } });
const textEntry = (text: string) => ({ type: 'assistant', message: { model: 'claude-opus-fake', content: [{ type: 'text', text }] } });
// One assistant transcript line with usage; every message reads 3 and writes 2 cache tokens.
const usageEntry = (id: string, input: number, output: number, extra: object = {}) => ({
  type: 'assistant',
  timestamp: '2026-01-01T00:02:00Z',
  ...extra,
  message: { id, model: 'claude-sonnet-fake', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } },
});
async function planning(root: string) {
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'collab: x' }));
  const r = run0(root);
  startPlan(root, r, loadConfig(root));
  saveRun(root, r);
}
const plannerStop = (root: string, extra: object) => ev(root, 'SubagentStop', { agent_id: 'P', agent_type: 'jodex:planner', last_assistant_message: '', ...extra });

test('E: a plan delivered through SubagentHandback is recorded on the first stop', async () => {
  const root = repo();
  await planning(root);
  assert.deepEqual(await handleHook(plannerStop(root, { agent_transcript_path: transcript(handbackEntry('# Plan via handback\n- x')) })), {});
  const r = run0(root);
  assert.equal(r.awaiting, null);
  assert.equal(fs.readFileSync(path.join(root, r.plans![0].file), 'utf8'), '# Plan via handback\n- x');
  assert.equal(r.attempts![0].observed.model, 'claude-opus-fake');
});

test('E: an empty retry keeps the planner awaited; a text reply after a handback uses the text', async () => {
  const root = repo();
  await planning(root);
  const first: any = await handleHook(plannerStop(root, {}));
  assert.equal(first.decision, 'block');
  assert.deepEqual(await handleHook(plannerStop(root, { stop_hook_active: true })), {});
  assert.equal(run0(root).awaiting?.role, 'planner', 'still waiting for a plan');
  assert.equal(run0(root).plans, undefined);
  await handleHook(plannerStop(root, { last_assistant_message: '# Plan newer', agent_transcript_path: transcript(handbackEntry('# Plan older'), textEntry('# Plan newer')) }));
  const r = run0(root);
  assert.equal(fs.readFileSync(path.join(root, r.plans![0].file), 'utf8'), '# Plan newer');
});

test('P1: attempts per role with keys; no proposal without [models]', async () => {
  const root = repo();
  await planning(root);
  let r = run0(root);
  assert.deepEqual(r.attempts!.map((a) => [a.role, a.key, a.launch, a.host, a.since === r.awaiting!.since]), [['planner', 'planner-0', 'subagent', 'claude-code', true]]);
  assert.deepEqual([r.attempts![0].proposed, r.attempts![0].policy, r.attempts![0].requested, r.attempts![0].mismatch], [null, null, { model: null, effort: null }, 'unknown']);
  const root2 = repo();
  await handleHook(ev(root2, 'UserPromptSubmit', { prompt: 'solo: x' }));
  await handleHook(write(root2, 'src/a.js'));
  fs.writeFileSync(path.join(root2, 'src/a.js'), 'export const a = 2;\n');
  r = run0(root2);
  runChecks(root2, loadConfig(root2), r, () => {});
  assert.equal(startTests(root2, r, loadConfig(root2)).ok, true);
  r.awaiting = null;
  assert.equal(startReview(root2, r, loadConfig(root2)).ok, true);
  assert.deepEqual(r.attempts!.map((a) => [a.role, a.key, a.launch]), [['tester', 'tester-0', 'subagent'], ['reviewer', 'R0', 'subagent']]);
});

test('P1: proposals: critical floor is L2, L0 is for the tester only, apply runs as shadow', () => {
  const run = (riskFloor: 'low' | 'critical') => ({ riskFloor }) as Run;
  const shadow = loadConfig(repo('[models]\nmode = "shadow"\nroles = { reviewer = "L0", tester = "L0" }\n'));
  assert.deepEqual(propose('planner', 'claude-code', run('critical'), shadow).proposed, { model: 'opus', effort: 'high' });
  assert.deepEqual(propose('planner', 'codex', run('low'), shadow).proposed, shadow.models.levels.codex.L1);
  const reviewer = propose('reviewer', 'claude-code', run('low'), shadow);
  assert.deepEqual(reviewer.proposed, { model: 'sonnet', effort: 'high' });
  assert.match(reviewer.reason!, /L0 is for the tester only/);
  assert.deepEqual(propose('tester', 'claude-code', run('low'), shadow).proposed, { model: 'haiku', effort: 'high' });
  const apply = loadConfig(repo('[models]\nmode = "apply"\n'));
  const p = propose('planner', 'claude-code', run('low'), apply);
  assert.deepEqual(p.proposed, { model: 'sonnet', effort: 'high' });
  assert.match(p.reason!, /apply not implemented/);
});

test('P1: `jodex status` and `jodex check` warn that apply is not supported yet', () => {
  const root = repo('[models]\nmode = "apply"\n');
  for (const cmd of ['status', 'check']) assert.match(jodex(root, cmd).stdout, /\[models\] mode = apply is not supported yet; running shadow/, cmd);
  assert.equal(/apply is not supported/.test(jodex(repo('[models]\nmode = "shadow"\n'), 'check').stdout), false);
});

test('P1: mismatchOf compares only what can be compared', () => {
  const pair = (model: string | null, effort: string | null = null) => ({ model, effort });
  assert.equal(mismatchOf(pair('sonnet'), pair('claude-sonnet-5-5')), 'unknown', 'alias vs full id');
  assert.equal(mismatchOf(pair(null), pair('claude-sonnet-5-5')), 'unknown', 'nothing requested');
  assert.equal(mismatchOf(pair('claude-sonnet-5-5'), pair(null)), 'unknown', 'nothing observed');
  assert.equal(mismatchOf(pair('gpt-6.2-sol', 'high'), pair('gpt-6.2-sol', 'high')), false);
  assert.equal(mismatchOf(pair('claude-sonnet-5-5'), pair('claude-opus-5-5')), true);
});

test('P1: a typed child other than the bound one leaves the observation unknown; Codex children stay unknown', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'solo: x' }));
  await handleHook(write(root, 'src/a.js'));
  let r = run0(root);
  startTests(root, r, loadConfig(root));
  saveRun(root, r);
  await handleHook(write(root, 'test/a.test.js', { agent_id: 'T1', agent_type: 'jodex:tester' })); // binds T1
  const tr = transcript(usageEntry('m1', 10, 5));
  await handleHook(ev(root, 'SubagentStop', { agent_id: 'T2', agent_type: 'jodex:tester', agent_transcript_path: tr, last_assistant_message: 'tests added' }));
  r = run0(root);
  assert.ok(r.testerDoneAt, 'the role result is still recorded');
  const a = r.attempts![0];
  assert.deepEqual([a.agentId, a.observed.model, a.mismatch, a.usage], ['T1', null, 'unknown', undefined]);
  assert.match(a.reason!, /not bound/);

  const root2 = repo();
  const codex = { turn_id: 't' };
  await handleHook(ev(root2, 'UserPromptSubmit', { prompt: 'solo: x', ...codex }));
  await handleHook(write(root2, 'src/a.js', codex));
  r = run0(root2);
  startTests(root2, r, loadConfig(root2));
  saveRun(root2, r);
  await handleHook(write(root2, 'test/a.test.js', { ...codex, agent_id: 'H', agent_type: 'default', model: 'gpt-helper' })); // untyped helper first
  await handleHook(ev(root2, 'SubagentStop', { ...codex, agent_id: 'C', agent_type: 'default', model: 'gpt-child', agent_transcript_path: transcript(usageEntry('m1', 10, 5)), last_assistant_message: 'tests added' }));
  const c = run0(root2).attempts![0];
  assert.deepEqual([c.agentId, c.observed.model, c.observed.source, c.usage], [undefined, null, null, undefined]);
});

test('usage: claudeUsage dedupes message ids, applies since, skips sidechains, null when nothing', () => {
  const f = transcript(
    usageEntry('m0', 1000, 1000, { timestamp: '2026-01-01T00:00:00Z' }), // before since
    usageEntry('m1', 10, 5, { timestamp: '2026-01-01T00:02:00Z' }),
    usageEntry('m1', 10, 5, { timestamp: '2026-01-01T00:02:00Z' }), // same message, another content block
    usageEntry('m2', 1, 2, { timestamp: '2026-01-01T00:03:00Z' }),
    usageEntry('s1', 100, 100, { timestamp: '2026-01-01T00:03:00Z', isSidechain: true }),
    textEntry('no usage'),
  );
  const since = '2026-01-01T00:01:00Z';
  assert.deepEqual(claudeUsage(f, since, true), { input: 11, output: 7, cacheRead: 6, cacheWrite: 4, source: 'claude-transcript' });
  assert.equal(claudeUsage(f, since, false)!.input, 111, 'sidechains count unless mainOnly');
  assert.equal(claudeUsage(f)!.input, 1111, 'no since: everything');
  assert.equal(claudeUsage(path.join(os.tmpdir(), 'missing-transcript.jsonl')), null);
  assert.equal(claudeUsage(transcript(textEntry('x'))), null);
  assert.equal(claudeUsage(null), null);
});

test('usage: a bound typed child records attempt usage', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'solo: x' }));
  await handleHook(write(root, 'src/a.js'));
  const r = run0(root);
  startTests(root, r, loadConfig(root));
  saveRun(root, r);
  await handleHook(ev(root, 'SubagentStop', { agent_id: 'T', agent_type: 'jodex:tester', agent_transcript_path: transcript(usageEntry('m1', 10, 5), usageEntry('m1', 10, 5)), last_assistant_message: 'tests added' }));
  assert.deepEqual(run0(root).attempts![0].usage, { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, source: 'claude-transcript' });
});

test('usage: Stop records the Claude worker tokens since the prompt; Codex stays unknown', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'solo: x' }));
  await handleHook(write(root, 'src/a.js'));
  const r = run0(root);
  assert.ok(r.promptAt, 'the run keeps its prompt time');
  const t = transcript(usageEntry('old', 1000, 1000, { timestamp: '2000-01-01T00:00:00Z' }), usageEntry('new', 10, 5, { timestamp: '2999-01-01T00:00:00Z' }), usageEntry('side', 50, 50, { timestamp: '2999-01-01T00:00:00Z', isSidechain: true }));
  await handleHook(ev(root, 'Stop', { transcript_path: t, last_assistant_message: 'done' }));
  assert.deepEqual(run0(root).workerUsage, { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, source: 'claude-transcript' });

  const root2 = repo();
  const codex = { turn_id: 't' };
  await handleHook(ev(root2, 'UserPromptSubmit', { prompt: 'solo: x', ...codex }));
  await handleHook(write(root2, 'src/a.js', codex));
  await handleHook(ev(root2, 'Stop', { ...codex, transcript_path: t, last_assistant_message: 'done' }));
  assert.equal(run0(root2).workerUsage, undefined);
});

test('R3.4: `plan start` with no open run claims the invoking session', async () => {
  const root = repo();
  jev.askIntake = async () => {
    throw new Error('offline');
  };
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'add the live map', turn_id: 't' }));
  jev.askIntake = async () => collaborative();
  assert.equal(listRuns(root).length, 0);
  const out = jodex(root, 'plan', 'start');
  assert.equal(out.status, 0, out.stderr);
  const r = run0(root);
  assert.deepEqual([r.request, r.host, r.sessionId, r.awaiting?.role, r.attempts![0].host], ['add the live map', 'codex', 'S', 'planner', 'codex']);
});

test('R4: a run created by `plan start` keeps the first prompt time through Stops and later prompts', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'redesign a' }));
  const first = JSON.parse(fs.readFileSync(path.join(root, '.jodex/sessions/S.json'), 'utf8')).promptAt;
  assert.ok(first);
  assert.equal(jodex(root, 'plan', 'start').status, 0);
  assert.equal(run0(root).promptAt, first, 'copied from the session');
  await new Promise((r) => setTimeout(r, 20));
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'any news?' }));
  const t = transcript(usageEntry('old', 1000, 1000, { timestamp: '2000-01-01T00:00:00Z' }), usageEntry('first', 10, 5, { timestamp: first }));
  assert.deepEqual(await handleHook(ev(root, 'Stop', { transcript_path: t, last_assistant_message: 'Waiting for the planner.' })), {});
  const r = run0(root);
  assert.equal(r.awaiting?.role, 'planner');
  assert.equal(r.promptAt, first, 'a later prompt does not reset it');
  assert.equal(r.workerUsage?.input, 10, 'tokens count from the first prompt');
});

test('CLI run choice: the active session never takes another session\'s open run', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'task A', session_id: 'A' }));
  await handleHook(write(root, 'src/a.js', { session_id: 'A' }));
  const a = run0(root);
  await new Promise((r) => setTimeout(r, 20)); // B's session file is the newest
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'task B', session_id: 'B', turn_id: 't' }));
  const out = jodex(root, 'check');
  assert.equal(out.status, 0, out.stderr);
  const runs = listRuns(root);
  assert.equal(runs.length, 2, 'a new run for B');
  const b = runs.find((r) => r.runId !== a.runId)!;
  assert.deepEqual([b.sessionId, b.request, b.host, Object.keys(b.checks)], ['B', 'task B', 'codex', ['test']]);
  assert.deepEqual(runs.find((r) => r.runId === a.runId)!.checks, {}, "A's run is untouched");
});

test('CLI run choice: with no session file, `jodex status` shows the latest open run', () => {
  const root = repo();
  const r = createRun(root, 'A', 'from a terminal');
  saveRun(root, r);
  assert.match(jodex(root, 'status').stdout, new RegExp(`Jodex run ${r.runId}`));
});

test('CLI run choice: a session file older than 30 minutes is not the active session', () => {
  const root = repo();
  const dir = path.join(root, '.jodex/sessions');
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, 'OLD.json');
  fs.writeFileSync(old, JSON.stringify({ lastPrompt: 'probe', baseline: null }));
  const stale = new Date(Date.now() - 31 * 60e3);
  fs.utimesSync(old, stale, stale); // a session that died without a Stop
  assert.equal(activeSessionId(root), null);
  const r = createRun(root, 'A', 'from a terminal');
  saveRun(root, r);
  assert.match(jodex(root, 'status').stdout, new RegExp(`Jodex run ${r.runId}`), 'falls back to the latest open run');
  fs.writeFileSync(path.join(dir, 'NEW.json'), JSON.stringify({ lastPrompt: 'x', baseline: null }));
  assert.equal(activeSessionId(root), 'NEW');
});

test('CLI run choice: an unclaimed run is picked up by the active session', async () => {
  const root = repo();
  const r = createRun(root, null, ''); // opened by an earlier `jodex check`
  saveRun(root, r);
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'task B', session_id: 'B' }));
  assert.equal(jodex(root, 'check').status, 0);
  const runs = listRuns(root);
  assert.deepEqual([runs.length, runs[0].runId, runs[0].sessionId, runs[0].request], [1, r.runId, 'B', 'task B']);
});

test('board: stage models from attempts, legacy roleModels fallback', () => {
  const attempt = (over: Partial<Attempt>): Attempt => ({ role: 'tester', key: 'tester-0', since: 's', host: 'claude-code', launch: 'subagent', proposed: { model: 'sonnet', effort: 'high' }, requested: { model: null, effort: null }, observed: { model: 'claude-sonnet-5-5', effort: null, source: 'claude-subagent-transcript' }, mismatch: 'unknown', policy: 'levels-v1', reason: null, ...over });
  const base = { runId: 'r', sessionId: 'S', host: 'claude-code', model: 'm', request: '', mode: 'review' as const, riskFloor: 'low' as const, touched: ['a.js'], checks: {}, stopBlocks: 0, open: true, createdAt: '', updatedAt: '', agentRoles: { t: 'tester' as const }, testerStartedAt: '2026-01-01T00:00:00Z', testerDoneAt: '2026-01-01T00:01:00Z' };
  const reviewer = attempt({ role: 'reviewer', key: 'R0', launch: 'detached', requested: { model: 'sonnet', effort: null }, observed: { model: null, effort: null, source: null } });
  const review = { round: 'R0', scope: [], snapshotId: '', snapshotDir: '', startedAt: 's', at: null, status: null, findings: [], reviewedPaths: [], limitations: [], agentType: null, reviewer: { host: 'claude-code' as const, mode: 'cross' as const, model: null } };
  const by = (r: Run) => Object.fromEntries(pipeline(r, null).map((p) => [p.stage, p]));
  let p = by({ ...base, attempts: [attempt({}), reviewer], reviews: [review], awaiting: { role: 'reviewer', since: 's' } } as Run);
  assert.equal(p.tester.model, 'claude-sonnet-5-5');
  assert.deepEqual(p.tester.models, { proposed: 'sonnet · high', requested: null, observed: 'claude-sonnet-5-5', mismatch: 'unknown' });
  assert.deepEqual([p.reviewer.models?.requested, p.reviewer.models?.observed], ['sonnet', null]);
  p = by({ ...base, roleModels: { tester: 'legacy-model' } } as Run);
  assert.deepEqual([p.tester.model, p.tester.models], ['legacy-model', undefined]);
});
