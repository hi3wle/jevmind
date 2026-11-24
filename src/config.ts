import fs from 'node:fs';
import { parse } from 'smol-toml';
import { configPath } from './project.ts';

export type RiskFloor = 'low' | 'elevated' | 'critical';
export type Level = 'L0' | 'L1' | 'L2';
type Pair = { model: string | null; effort: string | null };

// Model tiers for shadow proposals and planner/tester launch requests.
const LEVELS: Level[] = ['L0', 'L1', 'L2'];
const DEFAULT_LEVELS: Record<'claude-code' | 'codex', Record<Level, Pair>> = {
  'claude-code': { L0: { model: 'haiku', effort: 'high' }, L1: { model: 'sonnet', effort: 'high' }, L2: { model: 'opus', effort: 'high' } },
  codex: { L0: { model: 'gpt-6-luna', effort: 'high' }, L1: { model: 'gpt-6.2-sol', effort: 'high' }, L2: { model: 'gpt-6.2-astra', effort: 'high' } },
};

export type Config = {
  risk: { critical: string[]; elevated: string[]; humanReviewRequired: RiskFloor[] };
  checks: Record<string, string>; // name -> shell command, all required
  jev: { mode: 'off' | 'shadow' | 'enforce'; consent: boolean; dataLevel: 1 | 2; thresholds: { raiseRisk: number } };
  review: { crossProvider: boolean; claudeModel: string };
  models: { mode: 'off' | 'shadow' | 'apply'; roles: Partial<Record<'planner' | 'tester' | 'reviewer', Level>>; levels: typeof DEFAULT_LEVELS };
};

function modelsConfig(raw: any): Config['models'] {
  const roles: Config['models']['roles'] = {};
  for (const role of ['planner', 'tester', 'reviewer'] as const) if (LEVELS.includes(raw?.roles?.[role])) roles[role] = raw.roles[role];
  const levels = structuredClone(DEFAULT_LEVELS);
  for (const [host, key] of [['claude-code', 'claude'], ['codex', 'codex']] as const)
    for (const l of LEVELS) {
      const o = raw?.[key]?.[l];
      if (typeof o?.model === 'string') levels[host][l] = { model: o.model, effort: typeof o.effort === 'string' ? o.effort : null };
    }
  return { mode: ['shadow', 'apply'].includes(raw?.mode) ? raw.mode : 'off', roles, levels };
}

export function loadConfig(root: string): Config {
  const raw = parse(fs.readFileSync(configPath(root), 'utf8')) as Record<string, any>;
  const risk = raw.risk ?? {};
  if (typeof risk !== 'object' || Array.isArray(risk) || risk instanceof Date) throw new Error('[risk] must be a table in .jodex/config.toml');
  for (const key of ['critical', 'elevated', 'human_review_required']) {
    if (risk[key] !== undefined && (!Array.isArray(risk[key]) || risk[key].some((value: unknown) => typeof value !== 'string'))) throw new Error(`[risk] ${key} must be an array of strings in .jodex/config.toml`);
  }
  if (risk.human_review_required?.some((value: string) => !['low', 'elevated', 'critical'].includes(value))) throw new Error('[risk] human_review_required contains an unknown risk level');
  const checks: Record<string, string> = {};
  if (raw.checks !== undefined && (!raw.checks || typeof raw.checks !== 'object' || Array.isArray(raw.checks))) throw new Error('[checks] must be a table in .jodex/config.toml');
  for (const [name, cmd] of Object.entries(raw.checks ?? {})) {
    if (typeof cmd !== 'string' || !cmd.trim()) throw new Error(`[checks] ${name} must be a non-empty command in .jodex/config.toml`);
    checks[name] = cmd;
  }
  const jev = raw.jev ?? {};
  const review = raw.review ?? {};
  return {
    // Default: the other provider reviews (Claude's work by Codex, Codex's by Claude).
    review: { crossProvider: review.cross_provider !== false, claudeModel: typeof review.claude_model === 'string' ? review.claude_model : 'sonnet' },
    models: modelsConfig(raw.models), // absent: off, launches stay as before
    jev: {
      mode: ['shadow', 'enforce'].includes(jev.mode) ? jev.mode : 'off',
      consent: jev.consent === true,
      dataLevel: jev.data_level === 1 ? 1 : 2, // level 3 (source) is not sent by M1
      // Calibrated cut, clamped so a bad calibration can never switch the risk raise off or on for everything.
      thresholds: { raiseRisk: Math.min(0.9, Math.max(0.3, Number(jev.thresholds?.raise_risk ?? 0.5))) },
    },
    risk: {
      critical: risk.critical ?? [],
      elevated: risk.elevated ?? [],
      humanReviewRequired: risk.human_review_required ?? ['critical'],
    },
    checks,
  };
}

export function renderConfig(checks: Record<string, string>, jev = false): string {
  const lines = Object.entries(checks).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  return `# Jodex project configuration. See coding-harness-v4.md §10.1.

[risk]
# Paths matching these globs raise the task's risk floor.
critical = ["**/auth/**", "**/*payment*", "**/*payment*/**", "**/migrations/**", "infra/**"]
elevated = ["package.json", "**/*.lock", "**/api/**"]
human_review_required = ["critical"]

[checks]
# Every check listed here is required before a run can be verified.
${lines.length ? lines.join('\n') : '# test = "npm test"'}

[review]
# The other provider reviews: Claude Code's work by Codex, Codex's by Claude Code.
cross_provider = true
claude_model = "sonnet"

[models]
# apply: planner on Opus / Astra high, tester on Haiku (Sonnet when critical) / Luna high.
mode = "apply" # off | shadow (record proposals only) | apply

[jev]
# Jev (TypeSafe) decides at each prompt: workflow, risk, missing business rule.
# With consent it sends the prompt (secrets redacted) and project metadata, never source.
mode = "${jev ? 'enforce' : 'off'}" # off | shadow (log only) | enforce
consent = ${jev}
data_level = 2 # 1: metadata only, 2: + redacted prompt
`;
}
