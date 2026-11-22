import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep the board and project registry out of the real ~/.jodex during tests.
process.env.JODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-home-'));

export function tempRepo(files: Record<string, string> = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jodex-test-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  for (const [name, content] of Object.entries({ 'README.md': 'hello\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

export function writeConfig(root: string, checks: Record<string, string>, critical = ['**/auth/**']) {
  fs.mkdirSync(path.join(root, '.jodex'), { recursive: true });
  const lines = Object.entries(checks).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  fs.writeFileSync(
    path.join(root, '.jodex', 'config.toml'),
    `[risk]\ncritical = ${JSON.stringify(critical)}\nelevated = []\n\n[checks]\n${lines.join('\n')}\n\n[review]\ncross_provider = false\n`,
  );
}
