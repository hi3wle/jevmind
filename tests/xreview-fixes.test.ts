// Regressions for the findings of Codex's cross review of the harness (2026-11-21).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../src/checks.ts';
import { loadConfig } from '../src/config.ts';
import { decideIntake } from '../src/decisions.ts';
import { handleHook } from '../src/hooks.ts';
import { redact } from '../src/jev.ts';
import { sourceIdentity } from '../src/project.ts';
import { evaluate, expireAwaiting, listRuns, saveRun } from '../src/run.ts';
import { isReadOnlyCommand, startReview } from '../src/team.ts';
import { tempRepo } from './helpers.ts';

function repo(checks = 'test = "true"') {
  const root = tempRepo({ 'src/a.js': 'export const a = 1;\n' });
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), `[risk]\ncritical = []\n[checks]\n${checks}\n[review]\ncross_provider = false\n`);
  return root;
}
const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra });
const bash = (root: string, command: string, extra: object = {}) => ev(root, 'PreToolUse', { tool_name: 'Bash', tool_input: { command }, ...extra });
const denied = (o: any) => o?.hookSpecificOutput?.permissionDecision === 'deny';
const run0 = (root: string) => listRuns(root).find((r) => r.open)!;
async function reviewing(root: string) {
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: x' }));
  await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') } }));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 2;\n');
  const r = run0(root);
  runChecks(root, loadConfig(root), r, () => {});
  startReview(root, r, loadConfig(root));
  saveRun(root, r);
  return r;
}

test('1: quoted or abbreviated write flags are not read-only', () => {
  for (const c of ["git diff '--output=src/a.ts'", "rg '--pre=./x.sh' p src", 'git diff --outp=f', 'git diff "--ext-diff"']) assert.equal(isReadOnlyCommand(c), false, c);
});

test('2: a reviewer stays read-only after it is no longer awaited', async () => {
  const root = repo();
  await reviewing(root);
  const sub = { agent_id: 'R1', agent_type: 'jodex:reviewer' };
  await handleHook(bash(root, 'git status', sub)); // first sighting registers it
  const r = run0(root);
  expireAwaiting(r, 'cancelled');
  saveRun(root, r);
  assert.ok(denied(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') }, ...sub }))));
});

test('3, 4: the worker shell cannot write while locked, and no agent can accept', async () => {
  const root = repo();
  await reviewing(root);
  assert.ok(denied(await handleHook(bash(root, 'echo overwritten > src/a.js'))));
  assert.deepEqual(await handleHook(bash(root, 'jodex status')), {});
  assert.deepEqual(await handleHook(bash(root, 'git status')), {});
  assert.ok(denied(await handleHook(bash(root, 'jodex accept'))));
  assert.ok(denied(await handleHook(bash(root, 'bash -c "jodex accept"'))), 'quoting does not hide a developer-only command');
});

test('5: a shell edit made before `review start` is in the review scope; a later one makes it stale', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: y' }));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 3;\n'); // shell edit
  const r = (await (async () => { const { createRun } = await import('../src/run.ts'); return createRun(root, 'S', 'y'); })());
  runChecks(root, loadConfig(root), r, () => {});
  startReview(root, r, loadConfig(root));
  assert.deepEqual(r.reviews![0].scope, ['src/a.js']);
  assert.match(fs.readFileSync(path.join(root, r.reviews![0].snapshotDir, 'diff.patch'), 'utf8'), /a = 3/);
  r.reviews![0].at = new Date().toISOString();
  r.reviews![0].status = 'no_blocking_findings';
  r.awaiting = null;
  r.touched.push('src/b.js');
  assert.match(evaluate(r, loadConfig(root), sourceIdentity(root)).gates.find((g) => g.gate === 'review')!.detail, /did not cover src\/b\.js/);
});

test('7, 8: secrets in check commands and Basic auth are not sent', () => {
  assert.equal(redact('Authorization: Basic dXNlcjpzZWNyZXQ=').includes('dXNlcjpzZWNyZXQ'), false);
  assert.equal(redact('DB_PASSWORD=secret npm test').includes('secret'), false);
});

test('9: changing a check command makes its evidence stale', () => {
  const root = repo();
  const r = { runId: 'r', sessionId: null, host: null, model: null, request: '', mode: 'solo' as const, riskFloor: 'low' as const, touched: [], checks: { test: { command: 'true', exitCode: 0, identity: 'I', at: '', outputTail: '' } }, stopBlocks: 0, open: true, createdAt: '', updatedAt: '' };
  const cfg = { ...loadConfig(root), checks: { test: 'npm run integration' } };
  assert.equal(evaluate(r, cfg, 'I').status, 'review_required');
});

test('11: disputed blockers are not washed away by another review on unchanged source', async () => {
  const root = repo();
  const r = await reviewing(root);
  Object.assign(r.reviews![0], { at: new Date().toISOString(), status: 'changes_required', findings: [{ severity: 'blocking', location: 'a', issue: 'i', evidence: 'e', expectedBehavior: 'x', confirmed: false }] });
  r.awaiting = null;
  assert.equal(startReview(root, r, loadConfig(root)).ok, false);
});

test('12, 14: acceptance clears tester scope; a failing check outranks a blocked plan', () => {
  const root = repo();
  const base = { runId: 'r', sessionId: null, host: null, model: null, request: '', riskFloor: 'low' as const, touched: [], stopBlocks: 0, open: true, createdAt: '', updatedAt: '' };
  const cfg = loadConfig(root);
  const accepted = { ...base, mode: 'solo' as const, checks: { test: { command: 'true', exitCode: 0, identity: 'I', at: '', outputTail: '' } }, testerOutOfScope: ['src/a.js'], acceptance: { decision: 'accepted' as const, at: '', identity: 'I' } };
  assert.equal(evaluate(accepted, cfg, 'I').status, 'verified');
  const blocked = { ...base, mode: 'collaborative' as const, checks: { test: { command: 'true', exitCode: 1, identity: 'I', at: '', outputTail: '' } }, plans: [{ revision: 'x', file: 'p', at: '', decision: 'blocked' as const }] };
  assert.equal(evaluate(blocked, cfg, 'I').status, 'failed_verification');
});

test('13: the risk raise uses P(elevated)+P(critical), the quantity calibration tunes', () => {
  const a = (elevated: number, critical: number) => ({ model: '', usage: { input_tokens: 0, output_tokens: 0 }, isChange: 1, mode: { value: 'solo', probabilities: { solo: 1 } }, risk: { value: 'low' as const, probabilities: { low: 1 - elevated - critical, elevated, critical }, confidence: 0 }, missingRule: 0 });
  assert.equal(decideIntake(a(0.35, 0.25)).riskFloor, 'elevated');
  assert.equal(decideIntake(a(0.3, 0.3)).riskFloor, 'critical', 'a tie raises to the stricter level');
  assert.equal(decideIntake(a(0.2, 0.55)).riskFloor, 'critical');
  assert.equal(decideIntake(a(0.2, 0.2)).riskFloor, null);
});

// R1 (Codex re-review) regressions.
test('R1: brace expansion and textconv are not read-only', () => {
  for (const c of ['git diff --{output,src-prefix}=src/a.ts', 'git diff --textconv HEAD']) assert.equal(isReadOnlyCommand(c), false, c);
});

test('R1: agents cannot uninstall or accept, even quoted', async () => {
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' }));
  for (const c of ["jodex 'accept'", 'jodex discard', 'jodex uninstall --project', 'node plugin/dist/jodex.mjs accept']) assert.ok(denied(await handleHook(bash(root, c))), c);
});

test('R1: helper subagents and the tester shell cannot write in team mode', async () => {
  const { startTests } = await import('../src/team.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: z' }));
  await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') } }));
  const helper = { agent_id: 'H', agent_type: 'general-purpose' };
  assert.ok(denied(await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src/a.js') }, ...helper }))));
  const r = run0(root);
  startTests(root, r, loadConfig(root));
  saveRun(root, r);
  const tester = { agent_id: 'T', agent_type: 'jodex:tester' };
  assert.ok(denied(await handleHook(bash(root, 'echo overwritten > src/a.js', tester))));
  assert.deepEqual(await handleHook(bash(root, 'npm test', tester)), {});
});

test('R1: a run opened by `jodex check` reviews the newest session\'s shell edits', async () => {
  const { createRun } = await import('../src/run.ts');
  const root = repo();
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'review: w' }));
  fs.writeFileSync(path.join(root, 'src/a.js'), 'export const a = 5;\n');
  const r = createRun(root, null, '');
  runChecks(root, loadConfig(root), r, () => {});
  assert.equal(startReview(root, r, loadConfig(root)).ok, true);
  assert.deepEqual(r.touched, ['src/a.js']);
});

test('R1: disputed blockers persist across rounds until the developer accepts this source', async () => {
  const root = repo();
  const r = await reviewing(root);
  Object.assign(r.reviews![0], { at: new Date().toISOString(), status: 'changes_required', findings: [{ severity: 'blocking', location: 'a', issue: 'i', evidence: 'e', expectedBehavior: 'x', confirmed: false }] });
  r.awaiting = null;
  fs.writeFileSync(path.join(root, 'README.md'), 'unrelated\n');
  assert.equal(startReview(root, r, loadConfig(root)).ok, false);
  r.acceptance = { decision: 'accepted', at: '', identity: 'OLD' };
  assert.equal(evaluate(r, loadConfig(root), sourceIdentity(root)).gates.find((g) => g.gate === 'disputed_findings')!.state, 'pending', 'acceptance of another source does not count');
});

test('R1: a check named "plan" still outranks a blocked plan', () => {
  const root = repo('plan = "true"');
  const r = { runId: 'r', sessionId: null, host: null, model: null, request: '', mode: 'collaborative' as const, riskFloor: 'low' as const, touched: [], stopBlocks: 0, open: true, createdAt: '', updatedAt: '', checks: { plan: { command: 'true', exitCode: 1, identity: 'I', at: '', outputTail: '' } }, plans: [{ revision: 'x', file: 'p', at: '', decision: 'blocked' as const }] };
  assert.equal(evaluate(r, loadConfig(root), 'I').status, 'failed_verification');
});

test('R1: quoted Authorization and secret env values are redacted', () => {
  process.env.TEST_DB_PASSWORD = 'synthetic-only-bluebird-secret';
  const out = redact('{"Authorization":"Basic dXNlcjpzZWNyZXQ="} the password is synthetic-only-bluebird-secret');
  assert.equal(out.includes('dXNlcjpzZWNyZXQ'), false);
  assert.equal(out.includes('bluebird'), false);
  delete process.env.TEST_DB_PASSWORD;
});

test('locked worker: decorated workflow commands pass, file writes do not', async () => {
  const { allowedWhileLocked } = await import('../src/hooks.ts');
  for (const c of ['jodex review wait 2>&1; echo "exit=$?"', 'jodex check 2>&1 | tail -6', 'jodex review wait 2>&1 | head -30', 'git status | head'])
    assert.equal(allowedWhileLocked(c), true, c);
  // Observed denies from the MR retrospective: quoted operators and /dev/null are not writes.
  for (const c of ['cat x 2>/dev/null | head', 'jodex status | grep -E "plan|Next"', 'sed -n 1,60p file', 'jodex plan revise "reason with ; or /tmp"', 'jodex review wait 2>/dev/null'])
    assert.equal(allowedWhileLocked(c), true, c);
  for (const c of ['jodex check > out.txt', 'jodex status; echo x > src/a.js', 'jodex check && $(rm -rf src)', 'npm test', 'jodex accept'])
    assert.equal(allowedWhileLocked(c), false, c);
  const quotedOrSed = ['jodex status | grep "$(rm x)"', "echo 'a' > f", 'grep "unterminated', 'jodex status & touch x', 'jodex status | grep "`rm x`"'];
  for (const c of [...quotedOrSed, 'sed -n -i 1,60p f', "sed -n '1w o' f", 'sed -n 1,60p -i f']) assert.equal(allowedWhileLocked(c), false, c);
});

test('read-only: quoted alternation and line-range sed print are read-only', () => {
  for (const c of ['grep -E "a|b" src', 'sed -n 1,60p src/a.js', "sed -n '5p' src/a.js"]) assert.equal(isReadOnlyCommand(c), true, c);
  for (const c of ['sed -n -i 1,60p f', "sed -n '1w o' f", 'sed -n 1,60p -i f', 'sed -n 1,60p', 'grep "a" src > out', 'grep "$(rm x)" src']) assert.equal(isReadOnlyCommand(c), false, c);
});

test('R0 blocker: an escaped quote outside quotes opens no quote, so the `;` still chains', async () => {
  const { allowedWhileLocked } = await import('../src/hooks.ts');
  const c = "cat \\'x; touch y\\'"; // the shell runs `cat 'x` then `touch y'`
  assert.equal(allowedWhileLocked(c), false, c);
  assert.equal(isReadOnlyCommand(c), false, c);
});

test('R1 blocker: ANSI-C and locale quoting outside quotes are denied; a quoted `$` is not', async () => {
  const { allowedWhileLocked } = await import('../src/hooks.ts');
  for (const c of ["jodex status $'\\''; touch src/x # '", 'jodex status $"x"; touch y']) {
    assert.equal(allowedWhileLocked(c), false, c);
    assert.equal(isReadOnlyCommand(c), false, c);
  }
  assert.equal(isReadOnlyCommand("grep '$x' src"), true);
  assert.equal(allowedWhileLocked("grep '$x' src"), true);
});

test('doctor: Codex hooks cache and trust state are read from CODEX_HOME', async () => {
  const { codexHooksState } = await import('../src/setup.ts');
  const plugin = fileURLToPath(new URL('../plugin', import.meta.url));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome-'));
  const saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  try {
    assert.equal(codexHooksState(), 'plugin not cached (run jodex setup)');
    const cache = path.join(home, 'plugins/cache/jodex/jodex/0.1.0');
    for (const f of ['.codex-plugin/plugin.json', 'hooks/codex-hooks.json']) {
      fs.mkdirSync(path.dirname(path.join(cache, f)), { recursive: true });
      fs.copyFileSync(path.join(plugin, f), path.join(cache, f));
    }
    const key = (e: string) => `"jodex@jodex:hooks/codex-hooks.json:${e}:0:0" = { trusted_hash = "sha256:x" }`;
    const toml = (events: string[]) => fs.writeFileSync(path.join(home, 'config.toml'), `model = "x"\n[hooks.state]\n${events.map(key).join('\n')}\n`);
    toml(['user_prompt_submit', 'pre_tool_use', 'stop']);
    assert.equal(codexHooksState(), 'not trusted: subagent_stop; open codex, run /hooks and trust Jodex');
    toml(['user_prompt_submit', 'pre_tool_use', 'subagent_stop', 'stop']);
    assert.equal(codexHooksState(), 'trusted 4/4 (hooks/codex-hooks.json)');
    fs.appendFileSync(path.join(cache, 'hooks/codex-hooks.json'), '\n');
    assert.match(codexHooksState(), /^cached hooks\/codex-hooks\.json differs from source/);
  } finally {
    if (saved === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = saved;
  }
});

test('reviewer brief: live acceptance and developer-only evidence are not insufficient_evidence', async () => {
  const root = repo();
  const r = await reviewing(root);
  assert.match(fs.readFileSync(path.join(root, r.reviews!.at(-1)!.briefFile!), 'utf8'), /Live host\/provider acceptance checks and developer-only evidence .* do not return insufficient_evidence for them/);
});

test('R2: --textc, symlink vs file identity, legacy acceptance', () => {
  assert.equal(isReadOnlyCommand('git diff --textc HEAD'), false);
  const root = repo();
  fs.writeFileSync(path.join(root, 'real.js'), 'x');
  fs.symlinkSync('real.js', path.join(root, 'link.js'));
  const a = sourceIdentity(root);
  fs.rmSync(path.join(root, 'link.js'));
  fs.writeFileSync(path.join(root, 'link.js'), 'real.js');
  assert.notEqual(sourceIdentity(root), a, 'a file holding the link text is not the link');
  const r = { runId: 'r', sessionId: null, host: null, model: null, request: '', mode: 'solo' as const, riskFloor: 'low' as const, touched: [], stopBlocks: 0, open: true, createdAt: '', updatedAt: '', checks: { test: { command: 'true', exitCode: 0, identity: 'I', at: '', outputTail: '' } }, testerOutOfScope: ['x'], acceptance: { decision: 'accepted' as const, at: '' } };
  assert.equal(evaluate(r, loadConfig(root), 'I').status, 'review_required', 'an acceptance without identity does not count');
});

test('R3: a cancelled reviewer stays a reviewer when a tester stage starts; late D4 results are dropped', async () => {
  const { startTests } = await import('../src/team.ts');
  const { mergeRoleResult } = await import('../src/hooks.ts');
  const root = repo();
  const r = await reviewing(root);
  expireAwaiting(r, 'cancelled');
  saveRun(root, r);
  startTests(root, r, loadConfig(root));
  saveRun(root, r);
  const stale = run0(root);
  const reviewerWrite = ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'test/a.test.js') }, agent_id: 'R', agent_type: 'jodex:reviewer' });
  assert.ok(denied(await handleHook(reviewerWrite)), 'typed reviewer is not the tester');
  // A result tied to an older wait is discarded.
  mergeRoleResult(root, stale, 'tester', 'not-the-current-token');
  assert.notEqual(run0(root).awaiting, null);
});
