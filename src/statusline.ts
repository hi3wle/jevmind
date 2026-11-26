import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from './config.ts';
import type { Decision } from './decisions.ts';
import { redact } from './jev.ts';
import { gitRoot, isInitialized, jevmindDir } from './project.ts';
import { AWAIT_TTL_MS, listRuns, type Run } from './run.ts';

const URI = 'ui://jevmind/footer';
const TOOL = {
  name: 'jevmind_statusline', title: 'Jevmind', description: 'Display this thread’s local Jevmind workflow status. Read-only; no agent or model calls.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { 'openai/ui': { entrypoints: [{ type: 'statusline', resourceUri: URI }] } },
};
const object = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const str = (v: unknown) => typeof v === 'string' ? v : '';
const clean = (v: unknown, max = 40) => redact(str(v))
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
  .replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
const hostName = (v: unknown) => v === 'codex' ? 'Codex' : v === 'claude-code' ? 'Claude' : 'unknown';
const roles = new Set(['planner', 'tester', 'reviewer']);

// Footer reads are frequent. Bound the decision tail instead of replaying the whole log.
function lastDecision(root: string, session: string): Decision | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path.join(jevmindDir(root), 'decisions.jsonl'), 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 128 * 1024);
    const bytes = Buffer.alloc(length);
    fs.readSync(fd, bytes, 0, length, size - length);
    return bytes.toString('utf8').split('\n').reverse().flatMap((line) => {
      try {
        const d = JSON.parse(line);
        return d?.sessionId === session && d.point === 'D1' ? [d as Decision] : [];
      } catch { return []; }
    })[0];
  } catch { return undefined; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function decisionText(root: string, session: string): string {
  const cfg = loadConfig(root);
  if (cfg.jev.mode === 'off') return 'Rules (Jev off)';
  if (!cfg.jev.consent) return 'Rules (no Jev consent)';
  const d = lastDecision(root, session);
  if (!d) return 'Rules (Jev not observed)';
  if (d.source === 'fallback') return 'Rules (Jev fallback, last D1)';
  if (d.source !== 'jev') return 'unknown';
  const latency = Number.isFinite(d.latencyMs) && d.latencyMs >= 0 ? `, ${Math.round(d.latencyMs)}ms` : '';
  return `Jev (last D1${d.actedOn === true ? ', enforced' : ', advisory'}${latency})`;
}

function workflow(run: Run | undefined, now: number): string[] {
  if (!run) return ['Stage: idle'];
  const mode = ['solo', 'review', 'collaborative'].includes(run.mode) ? run.mode : 'unknown';
  const source = run.modeSource === 'jev' ? 'Jev' : run.modeSource === 'override' ? 'user' : run.modeSource === 'rule' ? 'rules' : '';
  const parts = [`Mode: ${mode}${source ? ` (${source})` : ''}`, `Risk: ${['low', 'elevated', 'critical'].includes(run.riskFloor) ? run.riskFloor : 'unknown'}`];
  if (!run.open) return [...parts, 'Stage: ended', `Outcome: ${['verified', 'review_required', 'failed_verification', 'blocked'].includes(run.completion?.status ?? '') ? run.completion!.status : 'unknown'} (last recorded)`];
  const review = Array.isArray(run.reviews) ? run.reviews.at(-1) : undefined;
  if (run.awaiting) {
    const role = roles.has(run.awaiting.role) ? run.awaiting.role : 'unknown';
    const elapsed = now - Date.parse(run.awaiting.since);
    const age = Number.isFinite(elapsed) && elapsed >= 0 ? `${Math.floor(elapsed / 1000)}s` : 'age unknown';
    const overdue = elapsed >= AWAIT_TTL_MS ? '; overdue, liveness unknown' : '';
    const launched = role === 'reviewer' && review?.reviewer?.launchedAt;
    const who = role === 'reviewer' && review?.reviewer ? `/${hostName(review.reviewer.host)}` : '';
    parts.push(`Stage: ${role === 'planner' ? 'plan' : role === 'tester' ? 'test' : 'review'}`);
    parts.push(`Waiting: ${role}${who} (${launched ? 'launch recorded' : 'requested'}, waiting ${age}${overdue})`);
  } else {
    const plan = Array.isArray(run.plans) ? run.plans.at(-1) : undefined;
    const stage = run.mode === 'collaborative' && plan?.decision !== 'accept'
      ? plan ? 'challenge plan' : 'plan needed'
      : run.correctingAfter ? 'correction / checks'
      : review?.at ? 'verify / next action' : 'implementation / checks';
    parts.push(`Stage: ${stage} (workflow)`);
  }
  return parts;
}

// A run records workflow, not process liveness. Only native thread state is live activity.
export function renderStatusline(input: unknown, host: 'claude-code' | 'codex', now = Date.now()): string {
  try {
    const state = object(input);
    const thread = object(state.thread);
    const cwd = host === 'codex' ? object(thread.workspace).cwd : state.cwd ?? object(state.workspace).current_dir;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return '';
    const root = gitRoot(cwd);
    if (!root || !isInitialized(root)) return '';
    const session = str(host === 'codex' ? thread.id : state.session_id);
    if (!session) return 'JEVMIND · session unknown';
    const run = listRuns(root, 14).findLast((r) => r.sessionId === session);
    const nativeModel = object(host === 'codex' ? thread.model : state.model);
    const model = clean(nativeModel.display_name || nativeModel.id || run?.model);
    const implementor = hostName(run?.host ?? host);
    const parts = ['JEVMIND', `Decision: ${decisionText(root, session)}`, `Implementor: ${implementor}${model ? ` (${model})` : ''}`];
    parts.push(...workflow(run, now));
    if (host === 'codex') {
      const activity = object(thread.agent).state;
      parts.push(`Activity: ${['starting', 'ready', 'working', 'waiting', 'thinking'].includes(activity) ? activity : 'unknown'}`);
    }
    return parts.join(' · ');
  } catch { return 'JEVMIND · status unavailable'; }
}

class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

function respond(method: string, params: Record<string, any>): unknown {
  switch (method) {
    case 'initialize': return { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'jevmind-statusline', version: '0.1.0' } };
    case 'ping': return {};
    case 'tools/list': return { tools: [TOOL] };
    case 'tools/call':
      if (params.name !== TOOL.name) throw new RpcError(-32602, 'Unknown tool');
      return { content: [{ type: 'text', text: `Read-only footer: ${URI}` }] };
    case 'resources/list': return { resources: [{ name: 'Jevmind footer', uri: URI, mimeType: 'application/json' }] };
    case 'resources/templates/list': return { resourceTemplates: [] };
    case 'resources/read': {
      if (params.uri !== URI) throw new RpcError(-32602, 'Unknown resource URI');
      const text = renderStatusline(object(params._meta)['com.openai/codex-statusline-state'], 'codex');
      const tree = text ? {
        type: 'row', props: { gap: 2, wrap: 'wrap' },
        children: text.split(' · ').map((label) => ({
          type: 'text', props: { color: label === 'JEVMIND' ? 'accent' : label.startsWith('Decision:') ? 'status-mode' : label.startsWith('Implementor:') ? 'status-model' : 'status-state' }, children: [label],
        })),
      } : null;
      return { contents: [{ uri: URI, mimeType: 'application/json', text: JSON.stringify(tree) }] };
    }
    default: throw new RpcError(-32601, 'Method not found');
  }
}

export async function serveStatusline() {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let id: unknown = null;
    let reply: object;
    try {
      let value: unknown;
      try { value = JSON.parse(line); } catch { throw new RpcError(-32700, 'Parse error'); }
      const request = object(value);
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number'))
        throw new RpcError(-32600, 'Invalid request');
      id = request.id ?? null;
      if (!Object.hasOwn(request, 'id')) continue;
      if (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) throw new RpcError(-32602, 'Invalid parameters');
      reply = { jsonrpc: '2.0', id, result: respond(request.method, object(request.params)) };
    } catch (error) {
      reply = { jsonrpc: '2.0', id, error: { code: error instanceof RpcError ? error.code : -32603, message: error instanceof RpcError ? error.message : 'Internal error' } };
    }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}
