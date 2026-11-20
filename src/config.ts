import fs from 'node:fs';
import { parse } from 'smol-toml';
import { configPath } from './project.ts';

export type RiskFloor = 'low' | 'elevated' | 'critical';

export type Config = {
  risk: { critical: string[]; elevated: string[]; humanReviewRequired: RiskFloor[] };
  checks: Record<string, string>; // name -> shell command, all required
  jev: { mode: 'off' | 'shadow' | 'enforce'; consent: boolean; dataLevel: 1 | 2; thresholds: { raiseRisk: number } };
  review: { crossProvider: boolean; claudeModel: string };
};

export function loadConfig(root: string): Config {
  const raw = parse(fs.readFileSync(configPath(root), 'utf8')) as Record<string, any>;
  const risk = raw.risk ?? {};
  const checks: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(raw.checks ?? {})) if (typeof cmd === 'string' && cmd.trim()) checks[name] = cmd;
  const jev = raw.jev ?? {};
  const review = raw.review ?? {};
  return {
    // Default: the other provider reviews (Claude's work by Codex, Codex's by Claude).
    review: { crossProvider: review.cross_provider !== false, claudeModel: typeof review.claude_model === 'string' ? review.claude_model : 'sonnet' },
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

[jev]
# Jev (TypeSafe) decides at each prompt: workflow, risk, missing business rule.
# With consent it sends the prompt (secrets redacted) and project metadata, never source.
mode = "${jev ? 'enforce' : 'off'}" # off | shadow (log only) | enforce
consent = ${jev}
data_level = 2 # 1: metadata only, 2: + redacted prompt
`;
}
