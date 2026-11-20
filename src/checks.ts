import { spawnSync } from 'node:child_process';
import type { Config } from './config.ts';
import { sourceIdentity } from './project.ts';
import type { Run } from './run.ts';

// Runs every configured check and binds each result to the source it ran on.
// A check that changes the source (formatter, generated file not in .gitignore)
// leaves its result bound to the pre-run identity, so it reads as stale.
export function runChecks(root: string, cfg: Config, run: Run, log: (s: string) => void) {
  for (const [name, command] of Object.entries(cfg.checks)) {
    const before = sourceIdentity(root);
    log(`$ ${command}`);
    const r = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const after = sourceIdentity(root);
    log(output.slice(-4000));
    if (before !== after) log(`warning: "${name}" changed files in the working tree; commit, revert or .gitignore them and run \`jodex check\` again.`);
    run.checks[name] = {
      command,
      exitCode: r.status,
      identity: before,
      at: new Date().toISOString(),
      outputTail: output.slice(-2000),
    };
  }
}
