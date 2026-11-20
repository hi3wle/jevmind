import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decideIntake, readDecisions } from '../src/decisions.ts';
import { claudeModel, handleHook } from '../src/hooks.ts';
import { type IntakeAnswers, jev, redact } from '../src/jev.ts';
import { listRuns } from '../src/run.ts';
import { tempRepo } from './helpers.ts';

const answers = (over: Partial<IntakeAnswers> = {}): IntakeAnswers => ({
  model: 'jev-test',
  usage: { input_tokens: 1, output_tokens: 1 },
  isChange: 0.9,
  mode: { value: 'solo', probabilities: { solo: 0.9, review: 0.05, collaborative: 0.03, clarify: 0.02 } },
  risk: { value: 'low', probabilities: { low: 0.9, elevated: 0.08, critical: 0.02 }, confidence: 0.8 },
  missingRule: 0.1,
  ...over,
});

test('D1 policy: thresholds, and Jev can only tighten', () => {
  assert.deepEqual(decideIntake(answers()), { clarify: false, riskFloor: null, recommendedMode: 'solo' });
  const crit = answers({ risk: { value: 'critical', probabilities: { low: 0, elevated: 0.1, critical: 0.9 }, confidence: 0.9 } });
  assert.equal(decideIntake(crit).riskFloor, 'critical');
  assert.equal(decideIntake(answers({ missingRule: 0.75 })).clarify, true);
  const clar = answers({ mode: { value: 'clarify', probabilities: { solo: 0.4, review: 0, collaborative: 0, clarify: 0.55 } } });
  assert.equal(decideIntake(clar).clarify, false, 'below the clarify threshold');
  assert.equal(decideIntake(clar).recommendedMode, null);
});

test('redaction removes common secrets', () => {
  const out = redact('curl -H "Authorization: Bearer sk-live-abcdefghijklmnop" postgres://u:pw@db API_KEY=abc123 token ghp_abcdefghijklmnopqrstuv');
  for (const leak of ['sk-live-abcdefghijklmnop', 'pw@db', 'abc123', 'ghp_abcdefghijklmnopqrstuv']) assert.equal(out.includes(leak), false, leak);
});

function jevRepo(mode: string) {
  const root = tempRepo();
  fs.mkdirSync(path.join(root, '.jodex'));
  fs.writeFileSync(path.join(root, '.jodex/config.toml'), `[risk]\ncritical = []\n[checks]\ntest = "true"\n[review]\ncross_provider = false\n[jev]\nmode = "${mode}"\nconsent = true\n`);
  return root;
}
const ev = (root: string, name: string, extra: object = {}) => ({ hook_event_name: name, session_id: 'S', cwd: root, ...extra });

test('enforce: Jev raises risk and asks to clarify; decision is logged and linked to the run', async () => {
  const root = jevRepo('enforce');
  const seen: any[] = [];
  jev.askIntake = async (state) => {
    seen.push(state);
    return answers({ missingRule: 0.8, risk: { value: 'critical', probabilities: { low: 0, elevated: 0.1, critical: 0.9 }, confidence: 0.9 } });
  };
  const out: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'change refund rules API_KEY=xyz' }));
  assert.match(out.hookSpecificOutput.additionalContext, /Ask the developer/);
  assert.equal(seen[0].request.includes('xyz'), false, 'prompt is redacted before sending');
  await handleHook(ev(root, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'README.md') } }));
  const [run] = listRuns(root);
  assert.equal(run.riskFloor, 'critical', 'README is low by rule; Jev raised it');
  const [d] = readDecisions(root);
  assert.deepEqual(run.decisionIds, [d.id]);
  assert.equal(d.actedOn, true);
  assert.equal(d.answers!.risk.value, 'critical');
});

test('shadow logs without acting; failures fall back to rules', async () => {
  const root = jevRepo('shadow');
  jev.askIntake = async () => answers({ missingRule: 0.9 });
  const out: any = await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'x' }));
  assert.equal(/Ask the developer/.test(out.hookSpecificOutput.additionalContext), false);
  jev.askIntake = async () => {
    throw new Error('Request timed out after 1500ms.');
  };
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'y' }));
  const [shadow, fallback] = readDecisions(root);
  assert.equal(shadow.actedOn, false);
  assert.equal(fallback.source, 'fallback');
  assert.match(fallback.error!, /timed out/);
});

test('session file is removed once the turn ends', async () => {
  const root = jevRepo('off');
  await handleHook(ev(root, 'UserPromptSubmit', { prompt: 'q' }));
  assert.equal(fs.readdirSync(path.join(root, '.jodex/sessions')).length, 1);
  await handleHook(ev(root, 'Stop', { last_assistant_message: 'answer' }));
  assert.equal(fs.readdirSync(path.join(root, '.jodex/sessions')).length, 0);
});

test('Claude model is read from the last assistant transcript entry', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tr-')), 't.jsonl');
  fs.writeFileSync(
    f,
    [
      { type: 'assistant', message: { model: 'claude-haiku-5-5' } },
      { type: 'user', message: { content: [{ type: 'tool_use', input: { model: 'opus' } }] } },
      { type: 'assistant', message: { model: 'claude-sonnet-5-5' } },
      { type: 'user', message: { content: 'x', model: 'not-this' } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  );
  assert.equal(claudeModel(f), 'claude-sonnet-5-5');
  assert.equal(claudeModel(null), null);
});
