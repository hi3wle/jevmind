import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

test('failed PATH link stops setup before host registration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, 'plugin/dist/jodex.mjs');
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))], outfile: cli, bundle: true, platform: 'node', format: 'esm' });
  fs.writeFileSync(path.join(root, 'npm'), '#!/bin/sh\necho "no links added" >&2\nexit 1\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, 'setup'], { env: { PATH: root, HOME: root }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL.*npm link/);
  assert.doesNotMatch(result.stdout, /Next:|trust the Jodex hooks/);
});
