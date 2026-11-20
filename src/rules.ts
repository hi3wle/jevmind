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

// Background subagent results re-enter Claude Code as a prompt; they are not new tasks.
export const isTaskNotification = (prompt: string) => prompt.trimStart().startsWith('<task-notification>');

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Repository-relative paths a tool call will write, or null when the call is not a file write.
// Shell commands are not parsed; their writes are caught by the identity check at Stop.
export function writePaths(toolName: string, input: any, root: string, cwd: string): string[] | null {
  let raw: string[] = [];
  if (WRITE_TOOLS.has(toolName)) raw = [input?.file_path ?? input?.notebook_path].filter(Boolean);
  else if (toolName === 'apply_patch') raw = patchPaths(String(input?.command ?? input?.patch ?? ''));
  else return null;
  return raw.map((p) => path.relative(root, path.resolve(cwd, p)).split(path.sep).join('/'));
}

export function patchPaths(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) out.push(m[1].trim());
  return out;
}

export const isJodexPath = (rel: string) => rel === '.jodex' || rel.startsWith('.jodex/');
