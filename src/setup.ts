import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRoot, isInitialized } from './project.ts';

// The repository root: the bundle lives at plugin/dist/jodex.mjs.
export const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Step = { label: string; cmd: string; args: string[]; ok?: RegExp };

function run(step: Step, log: (s: string) => void): boolean {
  const r = spawnSync(step.cmd, step.args, { encoding: 'utf8', cwd: repoRoot() });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const ok = r.status === 0 || (step.ok?.test(out) ?? false);
  log(`${ok ? 'ok  ' : 'FAIL'} ${step.label}${ok ? '' : `\n     ${out.split('\n').slice(-3).join('\n     ')}`}`);
  return ok;
}

export const hasCli = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;

const claudeSettings = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const footerSetting = () => ({ type: 'command', command: `${quote(process.execPath)} ${quote(import.meta.url.endsWith('.ts') ? fileURLToPath(new URL('./cli.ts', import.meta.url)) : fileURLToPath(import.meta.url))} statusline` });

// Explicit opt-in: never replace a developer's statusline or execute its command here.
export function setupStatusline(log: (s: string) => void, remove = false): boolean {
  const file = claudeSettings();
  try {
    const exists = fs.existsSync(file);
    if (exists && !fs.lstatSync(file).isFile()) throw new Error('settings must be a regular file');
    const original = exists ? fs.readFileSync(file, 'utf8') : null;
    const settings = original === null ? {} : JSON.parse(original);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings must be a JSON object');
    const owns = JSON.stringify(settings.statusLine) === JSON.stringify(footerSetting());
    if (remove) {
      if (!owns) { log('Claude statusline unchanged: no matching Jodex-owned footer.'); return true; }
      delete settings.statusLine;
    } else if (Object.hasOwn(settings, 'statusLine')) {
      log(owns ? 'Claude statusline is already installed.' : 'Claude statusline preserved. Append `jodex statusline` in your existing statusline script; see README Inline status.');
      return true;
    } else settings.statusLine = footerSetting();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (original !== null) {
      fs.writeFileSync(`${file}.jodex-statusline-${Date.now()}-${process.pid}.bak`, original, { mode: 0o600, flag: 'wx' });
      if (fs.readFileSync(file, 'utf8') !== original) throw new Error('settings changed during setup');
    }
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, { mode: exists ? fs.statSync(file).mode & 0o777 : 0o600, flag: 'wx' });
      if (exists) fs.chmodSync(temp, fs.statSync(file).mode & 0o777);
      fs.renameSync(temp, file);
    } finally { fs.rmSync(temp, { force: true }); }
    log(`Claude statusline ${remove ? 'removed' : 'installed'}. Other settings preserved.`);
    return true;
  } catch {
    log('Could not update Claude statusline; settings were left unchanged. Check settings.json and directory permissions.');
    return false;
  }
}

// Installs Jodex through each host's own plugin marketplace, so the host owns
// install, update and removal; nothing edits host config files directly.
export function setup(log: (s: string) => void): boolean {
  const root = repoRoot();
  if (!fs.existsSync(path.join(root, 'plugin', 'dist', 'jodex.mjs'))) {
    log('plugin/dist/jodex.mjs is missing: run `npm install && npm run build` in the Jodex checkout first.');
    return false;
  }
  const steps: Step[] = [{ label: 'link `jodex` onto PATH (npm link)', cmd: 'npm', args: ['link', '--no-audit', '--no-fund'], ok: /up to date|added/ }];
  if (hasCli('claude')) {
    steps.push(
      { label: 'Claude Code: add marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'add', root], ok: /already/i },
      { label: 'Claude Code: refresh marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'update', 'jodex'] },
      { label: 'Claude Code: install plugin', cmd: 'claude', args: ['plugin', 'install', 'jodex@jodex'], ok: /already/i },
    );
  } else log('skip Claude Code: `claude` not found');
  if (hasCli('codex')) {
    steps.push(
      { label: 'Codex: add marketplace', cmd: 'codex', args: ['plugin', 'marketplace', 'add', root], ok: /already/i },
      { label: 'Codex: install plugin', cmd: 'codex', args: ['plugin', 'add', 'jodex@jodex'], ok: /already/i },
    );
  } else log('skip Codex: `codex` not found');
  const ok = steps.map((s) => run(s, log)).every(Boolean);
  if (hasCli('codex')) log('Codex: open `codex`, run /hooks, review and trust the Jodex hooks, then start a new thread.');
  log('Inline footer: `jodex setup --statusline` for Claude; Codex: enable Custom status line in /experimental, restart, then select Jodex in /statusline. Existing footers are not replaced.');
  log('Next: cd into a project and run `jodex init`.');
  return ok;
}

export function uninstallGlobal(log: (s: string) => void): boolean {
  const footerOk = setupStatusline(log, true);
  const steps: Step[] = [];
  if (hasCli('claude'))
    steps.push(
      { label: 'Claude Code: uninstall plugin', cmd: 'claude', args: ['plugin', 'uninstall', 'jodex@jodex'], ok: /not (found|installed)/i },
      { label: 'Claude Code: remove marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'remove', 'jodex'], ok: /not found/i },
    );
  if (hasCli('codex'))
    steps.push(
      { label: 'Codex: remove plugin', cmd: 'codex', args: ['plugin', 'remove', 'jodex@jodex'], ok: /not (found|installed)/i },
      { label: 'Codex: remove marketplace', cmd: 'codex', args: ['plugin', 'marketplace', 'remove', 'jodex'], ok: /not found/i },
    );
  steps.push({ label: 'unlink `jodex` from PATH', cmd: 'npm', args: ['unlink', '-g', 'jodex'] });
  return steps.map((s) => run(s, log)).every(Boolean) && footerOk;
}

export function doctor(cwd: string, log: (s: string) => void) {
  const out = (cmd: string, args: string[]) => {
    // `codex plugin list` prints the whole remote catalog (14k lines on M1's machine).
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? `${r.stdout}`.trim() : null;
  };
  log(`node            ${process.version}`);
  for (const [host, cli, listArgs] of [
    ['Claude Code', 'claude', ['plugin', 'list']],
    ['Codex', 'codex', ['plugin', 'list']],
  ] as const) {
    const version = out(cli, ['--version']);
    if (!version) {
      log(`${host.padEnd(15)} not installed`);
      continue;
    }
    const plugins = out(cli, [...listArgs]) ?? '';
    log(`${host.padEnd(15)} ${version.split('\n')[0]}; jodex plugin ${/jodex@jodex\s+installed/.test(plugins) || /❯ jodex@jodex/.test(plugins) ? 'installed' : 'NOT installed (run jodex setup)'}`);
  }
  log('Codex hooks     need trust: open codex, run /hooks (not checkable from here)');
  log('Inline footer   Claude: jodex setup --statusline; Codex: Custom status line in /experimental, restart, select Jodex in /statusline (selection not checkable here)');
  log('Roles           planner/reviewer read-only and tester test-only, enforced by hooks (not an OS sandbox)');
  log('Review          cross-provider by default: Claude Code work reviewed by Codex and the reverse');
  const root = gitRoot(cwd);
  log(`project         ${root ? `${root}; ${isInitialized(root) ? 'initialized' : 'not initialized (run jodex init)'}` : 'not a git repository'}`);
}
