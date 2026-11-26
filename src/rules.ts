import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, RiskFloor } from './config.ts';

const ORDER: RiskFloor[] = ['low', 'elevated', 'critical'];
export const maxFloor = (a: RiskFloor, b: RiskFloor) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

export function riskFloor(paths: string[], cfg: Config): RiskFloor {
  const hit = (globs: string[]) => paths.some((p) => globs.some((g) => path.matchesGlob(p, g)));
  if (hit(cfg.risk.critical)) return 'critical';
  if (hit(cfg.risk.elevated)) return 'elevated';
  return 'low';
}

// Background subagent results and agent messages re-enter Claude Code as a prompt; they are not new tasks.
export const isTaskNotification = (prompt: string) => /^<(task-notification|agent-message)\b/.test(prompt.trimStart());

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Repository-relative paths a tool call will write, or null when the call is not a file write.
// Shell commands are not parsed; their writes are caught by the identity check at Stop.
export function writePaths(toolName: string, input: any, root: string, cwd: string): string[] | null {
  let raw: string[] = [];
  if (WRITE_TOOLS.has(toolName)) raw = [input?.file_path ?? input?.notebook_path].filter(Boolean);
  else if (toolName === 'apply_patch') raw = patchPaths(String(input?.command ?? input?.patch ?? ''));
  else return null;
  return raw.map((p) => path.relative(root, realParent(path.resolve(cwd, p))).split(path.sep).join('/'));
}

// Resolve symlinks in the parent directories only (a symlinked cwd such as /var -> /private/var must
// still land inside the repo); the entry itself stays as named, so an in-repo symlink is an in-repo path.
function realParent(abs: string): string {
  let dir = path.dirname(abs);
  const rest = [path.basename(abs)];
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {
    rest.push(path.basename(dir));
    dir = path.dirname(dir);
  }
  try {
    return path.join(fs.realpathSync(dir), ...rest.reverse());
  } catch {
    return abs;
  }
}

export const isOutsideRoot = (rel: string) => rel === '..' || rel.startsWith('../') || path.isAbsolute(rel);

// Scratch space outside the repository (OS temp dir, $TMPDIR, /tmp): Jevmind ignores writes there.
let tempRoots: string[] | null = null;
export function isTempPath(root: string, rel: string): boolean {
  tempRoots ??= [os.tmpdir(), process.env.TMPDIR, process.platform === 'win32' ? undefined : '/tmp'].flatMap((d) => {
    try {
      return d ? [fs.realpathSync(d)] : [];
    } catch {
      return [];
    }
  });
  const abs = path.resolve(root, rel);
  return isOutsideRoot(rel) && tempRoots.some((t) => abs === t || abs.startsWith(t + path.sep));
}

export function patchPaths(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) out.push(m[1].trim());
  return out;
}

export const isJevmindPath = (rel: string) => rel === '.jevmind' || rel.startsWith('.jevmind/');
