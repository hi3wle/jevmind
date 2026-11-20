import fs from 'node:fs';
import path from 'node:path';
import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import { jodexHome } from './board.ts';

export const keyFile = () => path.join(jodexHome(), 'typesafe.key');

export function apiKey(): string | null {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    return fs.readFileSync(keyFile(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function saveKey(key: string) {
  fs.mkdirSync(path.dirname(keyFile()), { recursive: true });
  fs.writeFileSync(keyFile(), `${key.trim()}\n`, { mode: 0o600 });
  fs.chmodSync(keyFile(), 0o600);
}

// Best-effort removal of secrets from free text before it leaves the machine (spec §6.4).
export function redact(text: string): string {
  // Values of secret-named environment variables, wherever they appear.
  for (const [name, value] of Object.entries(process.env))
    // shortcut: values under 3 characters and true/false are skipped; replacing them would corrupt ordinary text.
    if (value && value.length >= 3 && !/^(true|false)$/i.test(value) && /KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL/i.test(name))
      text = text.split(value).join('[REDACTED]');
  return text
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|AIza)[-_A-Za-z0-9]{12,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED]')
    .replace(/(["']?authorization["']?\s*[:=]\s*)(["'])?[^\n"']+\2?/gi, '$1[REDACTED]')
    .replace(/(\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]')
    .replace(/(\w+:\/\/)[^\s:@/]+:[^\s@/]+@/g, '$1[REDACTED]@');
}

export type IntakeState = {
  request: string;
  repo: { languages: string[]; hasTests: boolean; testCommands: string[] };
  protectedMatches: string[];
};

export type IntakeAnswers = {
  model: string;
  usage: { input_tokens: number | null; output_tokens: number | null };
  isChange: number; // P(prompt asks for a change to project files)
  mode: { value: string; probabilities: Record<string, number> };
  risk: { value: 'low' | 'elevated' | 'critical'; probabilities: Record<string, number>; confidence: number };
  missingRule: number; // P(a needed business rule is missing)
};

const RISK = ['low', 'elevated', 'critical'] as const;

async function askIntakeLive(state: IntakeState, timeoutMs: number): Promise<IntakeAnswers> {
  const key = apiKey();
  if (!key) throw new Error('no TypeSafe API key (set TYPESAFE_API_KEY or run `jodex key`)');
  const client = new TypeSafeClient({ apiKey: key, retry: { maxRetries: 0 } });
  const r = await client.systemOne(
    {
      state,
      questions: {
        is_change: noul('This prompt asks for a change to project files'),
        mode: choice('Which workflow fits this coding task?', {
          solo: 'small, clear, low-risk change one agent can implement and test',
          review: 'clear task where an independent review of the result materially reduces risk',
          collaborative: 'unresolved technical design choice that benefits from a plan and challenge first',
          clarify: 'a material requirement or business rule is missing; ask the developer first',
        }),
        risk: score('Consequence if this change is implemented wrong', [
          'low: cosmetic, docs or local refactor',
          'elevated: behavior, API, dependency or concurrency',
          'critical: auth, money, data integrity, destructive or production',
        ]),
        missing_rule: noul('A business rule needed to implement this is missing or ambiguous'),
      },
    },
    { timeout: timeoutMs },
  );
  const a = r.answers;
  const riskProbs = Object.fromEntries(RISK.map((name, i) => [name, (a.risk.probabilities as Record<string, number>)[String(i)] ?? 0]));
  const top = RISK.reduce((best, k) => (riskProbs[k] > riskProbs[best] ? k : best), RISK[0]);
  return {
    model: r.model,
    usage: r.usage,
    isChange: a.is_change.noul,
    mode: { value: a.mode.choice, probabilities: { ...a.mode.probabilities } },
    risk: { value: top, probabilities: riskProbs, confidence: a.risk.confidence },
    missingRule: a.missing_rule.noul,
  };
}

export type FindingAnswer = { model: string; usage: IntakeAnswers['usage']; label: string; probabilities: Record<string, number> };

export type FindingState = { finding: { location: string; issue: string; expectedBehavior: string }; request: string };

async function askFindingLive(state: FindingState, timeoutMs: number): Promise<FindingAnswer> {
  const key = apiKey();
  if (!key) throw new Error('no TypeSafe API key (set TYPESAFE_API_KEY or run `jodex key`)');
  const client = new TypeSafeClient({ apiKey: key, retry: { maxRetries: 0 } });
  const r = await client.systemOne(
    {
      state,
      questions: {
        kind: choice('Classify this code review finding', {
          blocker: 'a defect that makes the change incorrect, unsafe or miss the requirement',
          nonblocker: 'a real but minor issue that should not block the change',
          question: 'a question or uncertainty, not a confirmed defect',
        }),
      },
    },
    { timeout: timeoutMs },
  );
  return { model: r.model, usage: r.usage, label: r.answers.kind.choice, probabilities: { ...r.answers.kind.probabilities } };
}

export type CommandState = { tool: string; command: string; mode: string; scope: string[] };
export type CommandAnswer = { model: string; usage: IntakeAnswers['usage']; probabilities: Record<'safe' | 'caution' | 'dangerous', number> };

async function askCommandLive(state: CommandState, timeoutMs: number): Promise<CommandAnswer> {
  const key = apiKey();
  if (!key) throw new Error('no TypeSafe API key (set TYPESAFE_API_KEY or run `jodex key`)');
  const client = new TypeSafeClient({ apiKey: key, retry: { maxRetries: 0 } });
  const r = await client.systemOne(
    { state, questions: { danger: score('How destructive or out of scope is this action for the current task?', ['safe', 'caution', 'dangerous']) } },
    { timeout: timeoutMs },
  );
  const p = r.answers.danger.probabilities as Record<string, number>;
  return { model: r.model, usage: r.usage, probabilities: { safe: p['0'] ?? 0, caution: p['1'] ?? 0, dangerous: p['2'] ?? 0 } };
}

// Indirection so tests can replace the network calls.
export const jev = { askIntake: askIntakeLive, askFinding: askFindingLive, askCommand: askCommandLive };
