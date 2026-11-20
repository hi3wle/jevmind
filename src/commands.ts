import type { Config } from './config.ts';
import { appendDecision, D2_DENY, newDecisionId } from './decisions.ts';
import { jev, redact } from './jev.ts';
import type { Run } from './run.ts';

// Destroys work that cannot be recovered or that belongs to the developer: denied by rule.
const DESTRUCTIVE = [
  /\brm\s+-[a-zA-Z]*(rf|fr)[a-zA-Z]*\s+(.*\s)?(\/|~|\$HOME|\.\.)(\/?\*?)?(\s|$)/,
  /\bgit\s+push\b.*\s(--force(-with-lease)?|-f)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
];
// Everyday build, test and inspection commands: allowed without asking Jev.
const ROUTINE = /^\s*(npm\s+(test|t|run|ci|install|i)|node|npx\s+(tsc|vitest|jest|eslint|prettier)|pnpm|yarn|python3?\s+-m\s+(pytest|unittest)|pytest|go\s+(test|build|vet)|cargo\s+(test|build|check|clippy)|make|jodex|git\s+(status|diff|log|show|add|commit|branch|switch|stash\s+list|rev-parse|ls-files|blame)|ls|cat|head|tail|grep|rg|wc|mkdir|touch|echo|printf|pwd|which|cd)\b/;

export const isDestructive = (cmd: string) => DESTRUCTIVE.some((r) => r.test(cmd));
// A heredoc body is data for the command that reads it: `cat > f <<'EOF'` writes a file and
// is routine whatever the body says; `bash <<EOF` is not routine because `bash` is not.
const stripHeredocs = (cmd: string) => {
  const lines = cmd.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const tag = lines[i].match(/<<-?\s*['"]?(\w+)['"]?/)?.[1];
    if (tag) while (i + 1 < lines.length && lines[i + 1].trim() !== tag) i++;
    if (tag) i++; // skip the terminator
  }
  return out.join('\n');
};

export const isRoutine = (cmd: string) =>
  stripHeredocs(cmd)
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim().replace(/^\(+|\)+$/g, '').trim())
    .filter(Boolean)
    .every((s) => ROUTINE.test(s) && !isDestructive(s));

const normalize = (cmd: string) => cmd.trim().replace(/\s+/g, ' ');

// D2. Returns a deny reason or null. Jev is asked only about commands the rules do not settle,
// at most once per command per run, and it can only add a denial (never allow a rule denial).
export async function gateCommand(root: string, run: Run | null, cfg: Config, tool: string, cmd: string, sessionId: string): Promise<string | null> {
  if (isDestructive(cmd)) return 'this command can destroy work that cannot be recovered; ask the developer to run it.';
  if (isRoutine(cmd) || cfg.jev.mode === 'off' || !cfg.jev.consent) return null;
  const key = normalize(cmd);
  const cached = run?.commandDecisions?.[key];
  if (cached !== undefined) return cached ? `Jev judged this command dangerous for the task (cached decision).` : null;
  const id = newDecisionId();
  const t0 = performance.now();
  const shown = cfg.jev.dataLevel === 2 ? redact(cmd).slice(0, 1000) : '';
  try {
    // 1500 ms: every hook is a fresh process, so each call pays Jev's cold start (about 1.05 s in M0).
    const a = await jev.askCommand({ tool, command: shown, mode: run?.mode ?? 'solo', scope: run?.touched ?? [] }, 1500);
    const denied = cfg.jev.mode === 'enforce' && a.probabilities.dangerous >= D2_DENY;
    if (run) run.commandDecisions = { ...(run.commandDecisions ?? {}), [key]: denied };
    appendDecision(root, { id, ts: new Date().toISOString(), point: 'D2', sessionId, runId: run?.runId ?? null, source: 'jev', model: a.model, usage: a.usage, latencyMs: Math.round(performance.now() - t0), thresholds: { deny: D2_DENY }, command: shown.slice(0, 300), d2: { probabilities: a.probabilities, denied }, action: null, actedOn: cfg.jev.mode === 'enforce', request: '' });
    return denied ? `Jev judged this command dangerous for the task (p=${a.probabilities.dangerous.toFixed(2)}); ask the developer.` : null;
  } catch (e) {
    appendDecision(root, { id, ts: new Date().toISOString(), point: 'D2', sessionId, runId: run?.runId ?? null, source: 'fallback', error: String((e as Error).message).slice(0, 200), model: null, latencyMs: Math.round(performance.now() - t0), thresholds: { deny: D2_DENY }, command: shown.slice(0, 300), action: null, actedOn: false, request: '' });
    return null; // fail open to the rules, which already ran
  }
}
