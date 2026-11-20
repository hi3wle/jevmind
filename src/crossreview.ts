import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshBoard } from './board.ts';
import { loadConfig } from './config.ts';
import { latestReview, listRuns, type Run, saveRun } from './run.ts';
import { hasCli } from './setup.ts';
import { mergeRoleResult } from './hooks.ts';
import { recordSubagent } from './team.ts';

export type Host = 'claude-code' | 'codex';
const CLI: Record<Host, string> = { 'claude-code': 'claude', codex: 'codex' };
const REVIEW_TIMEOUT_MS = 15 * 60 * 1000;

// The other provider reviews: Claude's work goes to Codex and Codex's work to Claude.
// Null when cross review is off or the other CLI is not installed (same-host subagent then).
export function crossHost(run: Run, enabled: boolean): Host | null {
  if (!enabled) return null;
  const other: Host = run.host === 'codex' ? 'claude-code' : 'codex';
  return hasCli(CLI[other]) ? other : null;
}

// Read-only reviewer profiles. Claude: read tools only, no MCP, no settings, hooks or session
// (the profile tested in v3.2). Codex: read-only sandbox, no MCP, plugins or apps, ephemeral.
function command(host: Host, brief: string, root: string, outFile: string, claudeModel: string): { cmd: string; args: string[] } {
  if (host === 'claude-code')
    return {
      cmd: 'claude',
      args: ['-p', brief, '--model', claudeModel, '--permission-mode', 'dontAsk', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read', 'Glob', 'Grep',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}',
        '--no-session-persistence', '--output-format', 'json'],
    };
  return {
    cmd: 'codex',
    args: ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '-c', 'mcp_servers={}', '--disable', 'plugins', '--disable', 'apps',
      '-C', root, '-o', outFile, brief],
  };
}

// Starts the reviewer as a detached process. Called from a hook (outside any sandbox: Codex's
// workspace-write sandbox has no network) or from `jodex review wait` as a fallback.
export function launchReviewer(root: string, run: Run, script: string): boolean {
  const review = latestReview(run);
  if (!review?.reviewer || review.reviewer.mode !== 'cross' || review.reviewer.launchedAt || review.at) return false;
  review.reviewer.launchedAt = new Date().toISOString();
  saveRun(root, run);
  const child = spawn(process.execPath, [script, 'review', 'run', run.runId], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, JODEX_DISABLE: '1' } });
  child.unref();
  return true;
}

// Body of the detached process: run the other CLI on the saved brief, record its ReviewResult.
export async function runReviewer(root: string, runId: string) {
  const find = () => listRuns(root).find((r) => r.runId === runId);
  const run = find();
  const review = run && latestReview(run);
  if (!run || !review?.reviewer || review.at) return;
  const cfg = loadConfig(root);
  const brief = fs.readFileSync(path.join(root, review.briefFile!), 'utf8');
  const outFile = path.join(os.tmpdir(), `jodex-review-${runId}-${review.round}.txt`);
  const { cmd, args } = command(review.reviewer.host, brief, root, outFile, cfg.review.claudeModel);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: REVIEW_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, JODEX_DISABLE: '1' } });
  let message = '';
  let cost: number | null = null;
  let model: string | null = null;
  if (review.reviewer.host === 'claude-code') {
    try {
      const out = JSON.parse(r.stdout);
      message = String(out.result ?? '');
      cost = out.total_cost_usd ?? null;
      model = Object.keys(out.modelUsage ?? {})[0] ?? null;
    } catch {}
  } else {
    try {
      message = fs.readFileSync(outFile, 'utf8');
    } catch {}
    fs.rmSync(outFile, { force: true });
  }
  // Re-read: the worker's hooks may have saved the run while the reviewer worked.
  const fresh = find();
  const target = fresh && latestReview(fresh);
  if (!fresh || !target || target.round !== review.round || target.at || !fresh.awaiting) return;
  const token = fresh.awaiting.since;
  target.reviewer = { ...target.reviewer!, model, costUsd: cost, elapsedMs: Date.now() - t0 };
  if (!message.trim()) {
    Object.assign(target, { at: new Date().toISOString(), status: 'invalid', error: `${cmd} exited ${r.status ?? r.signal}: ${(r.stderr || '').trim().split('\n').slice(-2).join(' ').slice(0, 300)}` });
    fresh.awaiting = null;
  } else await recordSubagent(root, fresh, cfg, message, `${review.reviewer.host} (cross)`, true, true);
  // D4 above awaited the network: merge only this review into the latest copy of the run.
  mergeRoleResult(root, fresh, 'reviewer', token);
  refreshBoard();
}

// Blocks until the latest review has a result, the timeout passes, or nothing is awaited.
export async function waitReview(root: string, runId: string, script: string, timeoutMs: number): Promise<Run | null> {
  const t0 = Date.now();
  for (;;) {
    const run = listRuns(root).find((r) => r.runId === runId) ?? null;
    const review = run && latestReview(run);
    if (!run || !review || review.at || !run.awaiting) return run;
    // Fallback when no hook launched it (for example, untrusted Codex hooks).
    if (Date.now() - t0 > 10_000) launchReviewer(root, run, script);
    if (Date.now() - t0 > timeoutMs) return run;
    await new Promise((res) => setTimeout(res, 3000));
  }
}
