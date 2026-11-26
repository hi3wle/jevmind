import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function gitRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export const jevmindDir = (root: string) => path.join(root, '.jevmind');
export const configPath = (root: string) => path.join(jevmindDir(root), 'config.toml');
export const isInitialized = (root: string) => fs.existsSync(configPath(root));

export type Manifest = Record<string, string>; // repo-relative path -> content hash

// Content of the working tree (tracked + untracked, honoring .gitignore), hashed in-process.
// Read-only on purpose: Codex's workspace-write sandbox forbids writes under .git (M1 live run).
export function manifest(root: string): Manifest {
  const listed = execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--deduplicate'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const out: Manifest = {};
  for (const rel of listed.split('\0')) {
    if (!rel || rel === '.jevmind' || rel.startsWith('.jevmind/')) continue;
    const file = path.join(root, rel);
    try {
      const st = fs.lstatSync(file);
      const body = st.isSymbolicLink() ? fs.readlinkSync(file) : st.isFile() ? fs.readFileSync(file) : null;
      if (body === null) continue;
      out[rel] = crypto.createHash('sha256').update(st.isSymbolicLink() ? 'l' : 'f').update(st.mode & 0o111 ? 'x' : '-').update(body).digest('hex');
    } catch {
      // tracked but deleted in the working tree: absent from the manifest
    }
  }
  return out;
}

export const identityOf = (m: Manifest) =>
  crypto.createHash('sha256').update(JSON.stringify(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)))).digest('hex');

export const sourceIdentity = (root: string) => identityOf(manifest(root));

export const changedPaths = (a: Manifest, b: Manifest) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
