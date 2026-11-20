import assert from 'node:assert/strict';
import fs from 'node:fs';
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
