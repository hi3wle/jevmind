import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { parse } from 'smol-toml';

test('failed PATH link stops setup before host registration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jevmind-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, 'plugin/dist/jevmind.mjs');
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))], outfile: cli, bundle: true, platform: 'node', format: 'esm' });
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'npm'), '#!/bin/sh\necho "no links added" >&2\nexit 1\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, 'setup'], { env: { PATH: root, HOME: root }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL.*npm link/);
  assert.doesNotMatch(result.stdout, /Next:|trust the Jevmind hooks/);
});

// Non-interactive `setup --agent`: a git checkout links with npm, registers only the chosen host, and stores the choice.
function agentSetup(t: import('node:test').TestContext, args: string[], storedGlobal?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jevmind-agent-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.join(root, 'plugin/dist/jevmind.mjs');
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))], outfile: cli, bundle: true, platform: 'node', format: 'esm' });
  fs.mkdirSync(path.join(root, '.git'));
  const bin = path.join(root, 'bin');
  const jevmindHome = path.join(root, 'jevmind-home');
  fs.mkdirSync(bin);
  if (storedGlobal !== undefined) {
    fs.mkdirSync(jevmindHome);
    fs.writeFileSync(path.join(jevmindHome, 'config.toml'), storedGlobal);
  }
  const log = path.join(root, 'calls.log');
  for (const name of ['npm', 'claude', 'codex']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  // HOME and JEVMIND_HOME are temp dirs, so the real ~/.jevmind and host settings are never touched.
  const result = spawnSync(process.execPath, [cli, 'setup', ...args], { env: { PATH: bin, HOME: root, JEVMIND_HOME: jevmindHome }, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { result, calls, jevmindHome };
}

test('setup --agent codex registers only Codex and stores the choice', (t) => {
  const { result, calls, jevmindHome } = agentSetup(t, ['--agent', 'codex']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(calls.includes('npm link --no-audit --no-fund'), calls.join('\n'));
  assert.ok(calls.includes('codex plugin add jevmind@jevmind'), calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('claude plugin')), calls.join('\n'));
  assert.deepEqual((parse(fs.readFileSync(path.join(jevmindHome, 'config.toml'), 'utf8')) as { agents: unknown }).agents, ['codex']);
});

test('non-interactive setup without --agent keeps the stored global choice', (t) => {
  const { result, calls, jevmindHome } = agentSetup(t, [], 'agents = ["codex"]\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(calls.includes('codex plugin add jevmind@jevmind'), calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('claude plugin')), calls.join('\n'));
  assert.deepEqual((parse(fs.readFileSync(path.join(jevmindHome, 'config.toml'), 'utf8')) as { agents: unknown }).agents, ['codex']);
});

test('setup --agent with an unknown name fails before anything is installed or stored', (t) => {
  const { result, calls, jevmindHome } = agentSetup(t, ['--agent', 'foo']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--agent takes claude, codex or claude,codex/);
  // Host CLI probes (--version) may run for detection; no npm link or plugin command may.
  assert.ok(!calls.some((c) => /^(npm|claude plugin|codex plugin)/.test(c)), calls.join('\n'));
  assert.equal(fs.existsSync(path.join(jevmindHome, 'config.toml')), false);
});

// A packaged copy (no .git): setup installs the exact version globally and registers that copy.
function packaged(t: import('node:test').TestContext, failInstall: boolean) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jevmind-pkg-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'cache');
  const bin = path.join(base, 'bin');
  const global = path.join(base, 'global');
  const name = '@hi3wle/jevmind';
  const cli = path.join(root, 'plugin/dist/jevmind.mjs');
  buildSync({ entryPoints: [fileURLToPath(new URL('../src/cli.ts', import.meta.url))], outfile: cli, bundle: true, platform: 'node', format: 'esm' });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.2.3' }));
  fs.mkdirSync(path.join(global, name, 'plugin/dist'), { recursive: true });
  fs.writeFileSync(path.join(global, name, 'plugin/dist/jevmind.mjs'), '');
  fs.mkdirSync(bin);
  const log = path.join(base, 'calls.log');
  const npm = `#!/bin/sh\necho "npm $*" >> '${log}'\n[ "$1" = root ] && echo '${global}'\n${failInstall ? '[ "$1" = install ] && { echo boom >&2; exit 1; }\n' : ''}exit 0\n`;
  fs.writeFileSync(path.join(bin, 'npm'), npm, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\necho "claude $*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, 'setup'], { env: { PATH: bin, HOME: base }, encoding: 'utf8' });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { result, calls, global, name };
}

test('packaged setup installs the pinned version globally and registers the global copy', (t) => {
  const { result, calls, global, name } = packaged(t, false);
  assert.equal(result.status, 0, result.stdout);
  assert.ok(calls.includes(`npm install -g --no-audit --no-fund ${name}@1.2.3`), calls.join('\n'));
  assert.ok(!calls.some((c) => c.startsWith('npm link')));
  assert.ok(calls.includes(`claude plugin marketplace add ${path.join(global, name)}`), calls.join('\n'));
});

test('packaged setup stops before host registration when the global install fails', (t) => {
  const { result, calls } = packaged(t, true);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL.*install .*globally/);
  assert.ok(!calls.some((c) => c.startsWith('claude plugin')), calls.join('\n'));
});
