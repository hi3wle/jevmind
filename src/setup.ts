import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { type Agent, AGENTS, applyAllow, DEFAULT_ROUTES, globalAgents, globalAllow, loadConfig } from './config.ts';
import { routeTable } from './models.ts';
import { gitRoot, isInitialized } from './project.ts';

// The repository root: the bundle lives at plugin/dist/jevmind.mjs.
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
      if (!owns) { log('Claude statusline unchanged: no matching Jevmind-owned footer.'); return true; }
      delete settings.statusLine;
    } else if (Object.hasOwn(settings, 'statusLine')) {
      log(owns ? 'Claude statusline is already installed.' : `Claude statusline preserved. Add this to your existing statusline script (same stdin): ${footerSetting().command}`);
      return true;
    } else settings.statusLine = footerSetting();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (original !== null) {
      fs.writeFileSync(`${file}.jevmind-statusline-${Date.now()}-${process.pid}.bak`, original, { mode: 0o600, flag: 'wx' });
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

// Installs Jevmind through each host's own plugin marketplace, so the host owns
// install, update and removal; nothing edits host config files directly.
export function setup(log: (s: string) => void, agents: Agent[] = AGENTS): boolean {
  let root = repoRoot();
  if (!fs.existsSync(path.join(root, 'plugin', 'dist', 'jevmind.mjs'))) {
    log('plugin/dist/jevmind.mjs is missing: run `npm install && npm run build` in the Jevmind checkout first.');
    return false;
  }
  if (fs.existsSync(path.join(root, '.git'))) {
    if (!run({ label: 'link `jevmind` onto PATH (npm link)', cmd: 'npm', args: ['link', '--no-audit', '--no-fund'] }, log)) return false;
  } else {
    // A packaged copy (npx cache): install this exact version globally, so hooks keep calling the
    // installed `jevmind` and the hosts register the global copy, not a cache that npm may clear.
    const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (!run({ label: `install ${name}@${version} globally`, cmd: 'npm', args: ['install', '-g', '--no-audit', '--no-fund', `${name}@${version}`] }, log)) return false;
    root = path.join(spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout.trim(), name);
    if (!fs.existsSync(path.join(root, 'plugin', 'dist', 'jevmind.mjs'))) {
      log(`The global install was not found at ${root}.`);
      return false;
    }
  }
  const steps: Step[] = [];
  if (!agents.includes('claude-code')) log('skip Claude Code: not selected');
  else if (hasCli('claude')) {
    steps.push(
      { label: 'Claude Code: add marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'add', root], ok: /already/i },
      { label: 'Claude Code: refresh marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'update', 'jevmind'] },
      { label: 'Claude Code: install plugin', cmd: 'claude', args: ['plugin', 'install', 'jevmind@jevmind'], ok: /already/i },
    );
  } else log('skip Claude Code: `claude` not found');
  if (!agents.includes('codex')) log('skip Codex: not selected');
  else if (hasCli('codex')) {
    steps.push(
      { label: 'Codex: add marketplace', cmd: 'codex', args: ['plugin', 'marketplace', 'add', root], ok: /already/i },
      { label: 'Codex: install plugin', cmd: 'codex', args: ['plugin', 'add', 'jevmind@jevmind'], ok: /already/i },
    );
  } else log('skip Codex: `codex` not found');
  if (!steps.every((s) => run(s, log))) return false;
  if (steps.some((s) => s.cmd === 'codex')) log('Codex: open `codex`, run /hooks, review and trust the Jevmind hooks, then start a new thread.');
  log('Inline footer: `jevmind setup --statusline` for Claude; Codex: enable Custom status line in /experimental, restart, then select Jevmind in /statusline. Existing footers are not replaced.');
  log('Next: cd into a project and run `jevmind init`.');
  return true;
}

export function uninstallGlobal(log: (s: string) => void): boolean {
  const footerOk = setupStatusline(log, true);
  const steps: Step[] = [];
  if (hasCli('claude'))
    steps.push(
      { label: 'Claude Code: uninstall plugin', cmd: 'claude', args: ['plugin', 'uninstall', 'jevmind@jevmind'], ok: /not (found|installed)/i },
      { label: 'Claude Code: remove marketplace', cmd: 'claude', args: ['plugin', 'marketplace', 'remove', 'jevmind'], ok: /not found/i },
    );
  if (hasCli('codex'))
    steps.push(
      { label: 'Codex: remove plugin', cmd: 'codex', args: ['plugin', 'remove', 'jevmind@jevmind'], ok: /not (found|installed)/i },
      { label: 'Codex: remove marketplace', cmd: 'codex', args: ['plugin', 'marketplace', 'remove', 'jevmind'], ok: /not found/i },
    );
  steps.push({ label: 'unlink `jevmind` from PATH', cmd: 'npm', args: ['unlink', '-g', 'jevmind'] });
  return steps.map((s) => run(s, log)).every(Boolean) && footerOk;
}

// Codex runs the plugin from its own cache and runs a hook only once it is trusted: after a
// refresh the cache can be stale, and changed hooks need trust again (they show as "Failed").
export function codexHooksState(): string {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  // The plugin folder: next to dist/ in the bundle, or <repo>/plugin when run from src/.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const plugin = [path.join(here, '..'), path.join(here, '..', 'plugin')].find((d) => fs.existsSync(path.join(d, '.codex-plugin/plugin.json')))!;
  const version = JSON.parse(fs.readFileSync(path.join(plugin, '.codex-plugin/plugin.json'), 'utf8')).version;
  const cache = path.join(home, 'plugins/cache/jevmind/jevmind', version);
  if (!fs.existsSync(cache)) return 'plugin not cached (run jevmind setup)';
  try {
    const file = String(JSON.parse(fs.readFileSync(path.join(cache, '.codex-plugin/plugin.json'), 'utf8')).hooks).replace(/^\.\//, '');
    const cached = fs.readFileSync(path.join(cache, file), 'utf8');
    if (cached !== fs.readFileSync(path.join(plugin, file), 'utf8')) return `cached ${file} differs from source (run jevmind setup, then trust in /hooks)`;
    let state: Record<string, unknown> = {};
    try {
      state = (parse(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')) as any).hooks?.state ?? {};
    } catch {}
    const events = Object.keys(JSON.parse(cached).hooks).map((e) => e.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()));
    const missing = events.filter((e) => !(`jevmind@jevmind:${file}:${e}:0:0` in state));
    return missing.length ? `not trusted: ${missing.join(', ')}; open codex, run /hooks and trust Jevmind` : `trusted ${events.length}/${events.length} (${file})`;
  } catch (e) {
    return `cannot read the cached plugin (${(e as Error).message.slice(0, 80)})`;
  }
}

export function doctor(cwd: string, log: (s: string) => void) {
  const out = (cmd: string, args: string[]) => {
    // `codex plugin list` prints the whole remote catalog (14k lines on M1's machine).
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15_000, killSignal: 'SIGKILL' });
    return r.status === 0 ? `${r.stdout}`.trim() : null;
  };
  log(`node            ${process.version}`);
  for (const [host, cli, listArgs] of [
    ['Claude Code', 'claude', ['plugin', 'list']],
    ['Codex', 'codex', ['plugin', 'list']],
  ] as const) {
    const version = out(cli, ['--version']);
    if (!version) {
      log(`${host.padEnd(15)} unavailable (could not read CLI version)`);
      continue;
    }
    const plugins = out(cli, [...listArgs]);
    if (plugins === null) {
      log(`${host.padEnd(15)} ${version.split('\n')[0]}; plugin list unavailable`);
      continue;
    }
    log(`${host.padEnd(15)} ${version.split('\n')[0]}; jevmind plugin ${/jevmind@jevmind\s+installed/.test(plugins) || /❯ jevmind@jevmind/.test(plugins) ? 'installed' : 'NOT installed (run jevmind setup)'}`);
  }
  log(`Codex hooks     ${codexHooksState()}`);
  log('Inline footer   Claude: jevmind setup --statusline; Codex: Custom status line in /experimental, restart, select Jevmind in /statusline (selection not checkable here)');
  log('Roles           planner/reviewer read-only and tester test-only, enforced by hooks (not an OS sandbox)');
  const root = gitRoot(cwd);
  try {
    const cfg = root && isInitialized(root) ? loadConfig(root) : null;
    const agents = cfg?.agents ?? globalAgents() ?? AGENTS;
    log(`Agents          ${agents.join(', ')}; review ${agents.length > 1 ? 'cross-provider (Claude Code work reviewed by Codex and the reverse)' : 'by a same-host reviewer'}`);
    const routes = cfg && cfg.models.mode !== 'off' ? cfg.models.routes : applyAllow(DEFAULT_ROUTES, globalAllow());
    if (cfg?.models.mode === 'off') log('Models          [models] mode = off in this project: host defaults');
    else for (const host of agents) log(`Models (${host})\n  ${routeTable(host, routes).join('\n  ')}\n  * = differs from the recommendation; change with: jevmind models`);
  } catch (e) {
    log(`Config          cannot be read: ${(e as Error).message.split('\n')[0]}`);
  }
  log(`project         ${root ? `${root}; ${isInitialized(root) ? 'initialized' : 'not initialized (run jevmind init)'}` : 'not a git repository'}`);
}
