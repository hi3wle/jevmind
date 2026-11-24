import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import { jodexHome } from './board.ts';
import { configPath } from './project.ts';

// The agents the developer works with: chosen at setup (global), optionally overridden per project.
export type Agent = 'claude-code' | 'codex';
export const AGENTS: Agent[] = ['claude-code', 'codex'];
export const globalConfigFile = () => path.join(jodexHome(), 'config.toml');
function agentList(value: unknown, where: string): Agent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.some((a) => !AGENTS.includes(a))) throw new Error(`agents in ${where} must be a non-empty list of "claude-code" and/or "codex"`);
  return value as Agent[];
}
function readGlobal(): Record<string, unknown> | undefined {
  if (!fs.existsSync(globalConfigFile())) return undefined;
  try {
    return parse(fs.readFileSync(globalConfigFile(), 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${globalConfigFile()} is not valid TOML (${(e as Error).message.split('\n')[0]}); repair or delete it`);
  }
}
export const globalAgents = (): Agent[] | undefined => agentList(readGlobal()?.agents, globalConfigFile());
function writeGlobal(raw: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(globalConfigFile()), { recursive: true });
  fs.writeFileSync(globalConfigFile(), `${stringify(raw)}\n`);
}
export const saveGlobalAgents = (agents: Agent[]) => writeGlobal({ ...(readGlobal() ?? {}), agents });

export type RiskFloor = 'low' | 'elevated' | 'critical';
type Pair = { model: string | null; effort: string | null };
export type RouteRole = 'planner' | 'implementor' | 'tester' | 'reviewer';
export type Route = { normal: Pair; critical: Pair };
export type Routes = Record<Agent, Record<RouteRole, Route>>;
export const ROLES: RouteRole[] = ['planner', 'implementor', 'tester', 'reviewer'];
// Weakest to strongest; the nearest allowed value replaces a recommendation the developer did not allow.
export const MODEL_ORDER: Record<Agent, string[]> = { 'claude-code': ['haiku', 'sonnet', 'opus', 'fable'], codex: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra'] };
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh'];
export type Allow = { models?: string[]; efforts?: string[] };
export type AllowMap = Partial<Record<Agent, Partial<Record<RouteRole, Allow>>>>;
const HOST_KEY: Record<Agent, string> = { 'claude-code': 'claude', codex: 'codex' };

// The recommendation if allowed; else the nearest allowed value (ties: cheaper on normal runs, stronger on
// critical ones). Unknown recommendations count from the middle; free-text values only when nothing known is allowed.
export function pickAllowed(rec: string | null, allowed: string[] | undefined, order: string[], tier: 'normal' | 'critical', unknownAt = 1): string | null {
  if (!allowed?.length || (rec !== null && allowed.includes(rec))) return rec;
  if (allowed.length === 1) return allowed[0];
  const known = allowed.filter((a) => order.includes(a));
  if (!known.length) return allowed[0];
  const at = rec !== null && order.includes(rec) ? order.indexOf(rec) : unknownAt;
  const dist = (a: string) => Math.abs(order.indexOf(a) - at);
  return known.reduce((best, a) => {
    const d = dist(a) - dist(best);
    return d < 0 || (d === 0 && (tier === 'critical' ? order.indexOf(a) > order.indexOf(best) : order.indexOf(a) < order.indexOf(best))) ? a : best;
  });
}

export function applyAllow(routes: Routes, allow: AllowMap): Routes {
  const out = structuredClone(routes);
  for (const host of AGENTS)
    for (const role of ROLES)
      for (const tier of ['normal', 'critical'] as const) {
        const a = allow[host]?.[role];
        if (!a) continue;
        const pair = out[host][role][tier];
        // A free-text recommendation (legacy override): cheapest allowed on normal runs, strongest on critical ones.
        const unknownAt = tier === 'critical' ? MODEL_ORDER[host].length - 1 : 0;
        out[host][role][tier] = {
          model: pickAllowed(pair.model, a.models, MODEL_ORDER[host], tier, unknownAt),
          effort: a.efforts ? pickAllowed(pair.effort ?? 'medium', a.efforts, EFFORT_ORDER, tier) : pair.effort,
        };
      }
  return out;
}

// [models.<claude|codex>.allow.<role>] models = [...], efforts = [...]
function allowOf(models: any, where: string): AllowMap {
  const out: AllowMap = {};
  for (const host of AGENTS) {
    const table = models?.[HOST_KEY[host]]?.allow;
    if (table === undefined) continue;
    for (const [role, a] of Object.entries<any>(table)) {
      const bad = (what: string) => new Error(`models.${HOST_KEY[host]}.allow.${role} in ${where}: ${what}`);
      if (!ROLES.includes(role as RouteRole)) throw bad(`unknown step (use ${ROLES.join(', ')})`);
      if (a.models !== undefined && (!Array.isArray(a.models) || !a.models.length || a.models.some((m: unknown) => typeof m !== 'string' || !m.trim()))) throw bad('models must be a non-empty list of model names');
      if (a.efforts !== undefined && (!Array.isArray(a.efforts) || !a.efforts.length || a.efforts.some((e: unknown) => !EFFORT_ORDER.includes(e as string)))) throw bad(`efforts must be a non-empty list of ${EFFORT_ORDER.join(', ')}`);
      (out[host] ??= {})[role as RouteRole] = { models: a.models, efforts: a.efforts };
    }
  }
  return out;
}
export const globalAllow = (): AllowMap => allowOf(readGlobal()?.models, globalConfigFile());
// null removes this agent's allow sets, so the recommendation applies again.
export function saveGlobalAllow(host: Agent, allow: Partial<Record<RouteRole, Allow>> | null) {
  const raw = readGlobal() ?? {};
  const models = { ...((raw.models as Record<string, any>) ?? {}) };
  const entry = { ...(models[HOST_KEY[host]] ?? {}) };
  if (allow && Object.keys(allow).length) entry.allow = allow;
  else delete entry.allow;
  if (Object.keys(entry).length) models[HOST_KEY[host]] = entry;
  else delete models[HOST_KEY[host]];
  const { models: _, ...rest } = raw;
  writeGlobal(Object.keys(models).length ? { ...rest, models } : rest);
}
const p = (model: string, effort: string): Pair => ({ model, effort });

// Model and effort per role. Developer rule: effort high only for the planner; every other role stays at
// medium and a critical run moves it to a stronger model instead (vendor docs: medium for scoped work).
export const DEFAULT_ROUTES: Routes = {
  'claude-code': {
    planner: { normal: p('opus', 'medium'), critical: p('opus', 'high') },
    implementor: { normal: p('sonnet', 'medium'), critical: p('opus', 'medium') },
    tester: { normal: p('haiku', 'medium'), critical: p('sonnet', 'medium') },
    reviewer: { normal: p('sonnet', 'medium'), critical: p('opus', 'medium') },
  },
  codex: {
    planner: { normal: p('gpt-6.2-astra', 'medium'), critical: p('gpt-6.2-astra', 'high') },
    implementor: { normal: p('gpt-6.2-sol', 'medium'), critical: p('gpt-6.2-sol', 'medium') },
    tester: { normal: p('gpt-6-luna', 'high'), critical: p('gpt-6.2-sol', 'medium') }, // developer exception: Luna is cheap enough at high
    reviewer: { normal: p('gpt-6.2-sol', 'medium'), critical: p('gpt-6.2-astra', 'medium') },
  },
};

export type Config = {
  risk: { critical: string[]; elevated: string[]; humanReviewRequired: RiskFloor[] };
  checks: Record<string, string>; // name -> shell command, all required
  jev: { mode: 'off' | 'shadow' | 'enforce'; consent: boolean; dataLevel: 1 | 2; thresholds: { raiseRisk: number } };
  agents: Agent[];
  review: { crossProvider: boolean; claudeModel: string };
  models: { mode: 'off' | 'shadow' | 'apply'; routes: typeof DEFAULT_ROUTES };
};

// The recommendation, after a project's legacy overrides: [models.claude|codex] <role> / <role>_critical = {model, effort}.
export function recommendedRoutes(raw: any): Routes {
  const routes = structuredClone(DEFAULT_ROUTES);
  for (const host of AGENTS)
    for (const role of ROLES)
      for (const tier of ['normal', 'critical'] as const) {
        const o = raw?.[HOST_KEY[host]]?.[tier === 'normal' ? role : `${role}_critical`];
        if (typeof o?.model === 'string') routes[host][role][tier] = { model: o.model, effort: typeof o.effort === 'string' ? o.effort : null };
      }
  return routes;
}

// Allow sets: the project's per step, else the global one (`jodex models`), else no limit.
function effectiveRoutes(raw: any): Routes {
  const allow = globalAllow();
  for (const [host, roles] of Object.entries(allowOf(raw, '.jodex/config.toml')) as [Agent, AllowMap[Agent]][]) allow[host] = { ...allow[host], ...roles };
  return applyAllow(recommendedRoutes(raw), allow);
}

function modelsConfig(raw: any): Config['models'] {
  const mode = ['shadow', 'apply'].includes(raw?.mode) ? raw.mode : 'off';
  // Off means host defaults: the global file is not even read for models.
  return { mode, routes: mode === 'off' ? recommendedRoutes(raw) : effectiveRoutes(raw) };
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
  // No choice stored anywhere: both agents, as before onboarding existed.
  const agents = agentList(raw.agents, '.jodex/config.toml') ?? globalAgents() ?? AGENTS;
  return {
    agents,
    // The other provider reviews (Claude's work by Codex, Codex's by Claude), only when both are in use.
    review: { crossProvider: review.cross_provider !== false && AGENTS.every((a) => agents.includes(a)), claudeModel: typeof review.claude_model === 'string' ? review.claude_model : 'sonnet' },
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

export function renderConfig(checks: Record<string, string>, jev = false, agents?: Agent[]): string {
  const lines = Object.entries(checks).map(([k, v]) => `${k} = ${JSON.stringify(v)}`);
  return `# Jodex project configuration. See coding-harness-v4.md §10.1.
${agents ? `\n# Agents used in this project (overrides the machine-wide choice).\nagents = ${JSON.stringify(agents)}\n` : ''}
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
# apply: each role gets a model and effort; medium by default, more only on critical runs (coding-harness-v4.md §17).
mode = "apply" # off | shadow (record proposals only) | apply

[jev]
# Jev (TypeSafe) decides at each prompt: workflow, risk, missing business rule.
# With consent it sends the prompt (secrets redacted) and project metadata, never source.
mode = "${jev ? 'enforce' : 'off'}" # off | shadow (log only) | enforce
consent = ${jev}
data_level = 2 # 1: metadata only, 2: + redacted prompt
`;
}
