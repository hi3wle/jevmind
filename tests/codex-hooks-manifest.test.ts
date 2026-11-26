import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

// Codex 0.171.0 leaves ${CLAUDE_PLUGIN_ROOT} unexpanded, so its hooks call `jevmind` from PATH.
test('the Codex plugin hooks run `jevmind hook` from PATH for every Claude hook event', () => {
  const read = (rel: string) => JSON.parse(fs.readFileSync(new URL(`../plugin/${rel}`, import.meta.url), 'utf8'));
  const manifest = read('.codex-plugin/plugin.json');
  const file = new URL(`../plugin/${manifest.hooks}`, import.meta.url);
  assert.ok(fs.existsSync(file), manifest.hooks);
  const codex = JSON.parse(fs.readFileSync(file, 'utf8')).hooks;
  const commands = Object.values(codex).flatMap((groups: any) => groups.flatMap((g: any) => g.hooks.map((h: any) => h.command)));
  assert.ok(commands.length);
  for (const c of commands) assert.equal(c, 'jevmind hook');
  assert.equal(JSON.stringify(codex).includes('${'), false);
  assert.deepEqual(Object.keys(codex).sort(), Object.keys(read('hooks/hooks.json').hooks).sort());
});
