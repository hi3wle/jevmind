import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RiskFloor } from './config.ts';
import type { IntakeAnswers } from './jev.ts';
import { jodexDir } from './project.ts';

// Starting thresholds (spec §6.3); `jodex calibrate` will propose project-specific ones.
export const D1_THRESHOLDS = { clarify: 0.6, missingRule: 0.7, raiseRisk: 0.5, recommendMode: 0.5 };
export const D4_THRESHOLD = 0.5; // P(blocker) needed to confirm a reviewer's blocking finding
export const D2_DENY = 0.8; // P(dangerous) at which a shell command is denied

export type D1Action = {
  clarify: boolean; // ask the developer before editing
  riskFloor: RiskFloor | null; // floor Jev raises the run to, never lowers
  recommendedMode: string | null; // logged now; team modes act on it in M2
};

// Pure policy: Jev answers + thresholds -> actions. Only ever tightens (asymmetry invariant).
export function decideIntake(a: IntakeAnswers, t = D1_THRESHOLDS): D1Action {
  const clarify = (a.mode.value === 'clarify' && a.mode.probabilities.clarify >= t.clarify) || a.missingRule >= t.missingRule;
  // Same quantity that `jodex calibrate` tunes: P(elevated) + P(critical).
  const pE = a.risk.probabilities.elevated ?? 0;
  const pC = a.risk.probabilities.critical ?? 0;
  const raised = pE + pC >= t.raiseRisk ? (pC >= pE ? 'critical' : 'elevated') : null;
  const pMode = a.mode.probabilities[a.mode.value] ?? 0;
  return { clarify, riskFloor: raised, recommendedMode: a.mode.value !== 'clarify' && pMode >= t.recommendMode ? a.mode.value : null };
}

export type Decision = {
  id: string;
  ts: string;
  point: 'D1' | 'D2' | 'D4';
  sessionId: string;
  runId: string | null; // filled when the prompt leads to a run
  source: 'jev' | 'fallback';
  error?: string;
  model: string | null;
  latencyMs: number;
  usage?: IntakeAnswers['usage'];
  answers?: Omit<IntakeAnswers, 'model' | 'usage'>;
  thresholds: typeof D1_THRESHOLDS | { blocker: number } | { deny: number };
  command?: string; // D2 only, redacted
  d2?: { probabilities: Record<string, number>; denied: boolean }; // D2 only
  finding?: { round: string; location: string; issue: string }; // D4 only
  d4?: { label: string; probabilities: Record<string, number> }; // D4 only
  action: D1Action | null;
  actedOn: boolean;
  request: string; // redacted, truncated
};

const logFile = (root: string) => path.join(jodexDir(root), 'decisions.jsonl');

export const newDecisionId = () => crypto.randomBytes(5).toString('hex');

export function appendDecision(root: string, d: Decision) {
  fs.mkdirSync(jodexDir(root), { recursive: true });
  fs.appendFileSync(logFile(root), JSON.stringify(d) + '\n');
}

export function readDecisions(root: string): Decision[] {
  try {
    return fs
      .readFileSync(logFile(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as Decision];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
