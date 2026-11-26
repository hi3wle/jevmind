import * as prompt from '@clack/prompts';
import { type Agent, type Allow, applyAllow, DEFAULT_ROUTES, EFFORT_ORDER, globalAllow, MODEL_ORDER, ROLES, type Route, type RouteRole, type Routes, saveGlobalAllow } from './config.ts';

const AGENT_NAME: Record<Agent, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const STEP: Record<RouteRole, string> = { planner: 'Planner', implementor: 'Implementor', tester: 'Tester', reviewer: 'Reviewer' };
const WHY: Record<RouteRole, string> = {
  planner: 'Plans need the strongest model; runs rarely',
  implementor: 'Suggestion only: this is your own session',
  tester: 'Scoped tests, verified by jevmind check',
  reviewer: 'Reads and verifies; no edits',
};
const HINT: Record<string, string> = {
  haiku: 'fastest, lowest cost',
  sonnet: 'balanced',
  opus: 'strong, higher cost',
  fable: 'strongest, highest cost',
  'gpt-6-luna': 'fastest, lowest cost',
  'gpt-6.1-terra': 'fast, low cost',
  'gpt-6.2-sol': 'balanced',
  'gpt-6.2-astra': 'strongest, highest cost',
};
const name = (m: string | null) => (m ? (m.startsWith('gpt-') ? m : m[0].toUpperCase() + m.slice(1)) : 'host default');
const cell = (p: Route['normal']) => `${name(p.model)} · ${p.effort ?? 'default'}`;

// "Step | Normal task | Critical task | Why"; * marks a cell the developer's limits changed.
// When the lines do not fit `width` (an 80-column terminal), the reasons move below the table.
export function routeTable(host: Agent, effective: Routes, recommended: Routes = DEFAULT_ROUTES, width = Infinity): string[] {
  const mark = (role: RouteRole, tier: 'normal' | 'critical') => {
    const [e, r] = [effective[host][role][tier], recommended[host][role][tier]];
    return `${cell(e)}${e.model !== r.model || e.effort !== r.effort ? ' *' : ''}`;
  };
  const all = [['Step', 'Normal task', 'Critical task', 'Why'], ...ROLES.map((role) => [STEP[role], mark(role, 'normal'), mark(role, 'critical'), WHY[role]])];
  const cols = [0, 1, 2].map((i) => Math.max(...all.map((r) => r[i].length)));
  const lines = all.map((r) => r.map((c, i) => (i < 3 ? c.padEnd(cols[i]) : c)).join('  '));
  if (Math.max(...lines.map((l) => l.length)) <= width) return lines;
  return [...all.map((r) => r.slice(0, 3).map((c, i) => c.padEnd(cols[i])).join('  ').trimEnd()), '', ...ROLES.map((role) => `${STEP[role]}: ${WHY[role]}`)];
}

// Room inside a clack note box: its border and padding take 6 columns.
const noteWidth = () => (process.stdout.columns || 80) - 6;

export const pickLine = (role: RouteRole, route: Route) => `→ ${STEP[role]} will run: ${cell(route.normal)} (normal), ${cell(route.critical)} (critical)`;

// `jevmind models` (also the end of `jevmind setup`): limits are saved globally; Cancel saves nothing.
export async function modelsCommand(agents: Agent[], log: (s: string) => void, interactive: boolean, file: string) {
  for (const host of agents) {
    const saved = globalAllow()[host] ?? {};
    const effective = (draft: Partial<Record<RouteRole, Allow>>) => applyAllow(DEFAULT_ROUTES, { [host]: draft });
    if (!interactive) {
      log(`${AGENT_NAME[host]} model routing:\n${routeTable(host, effective(saved)).join('\n')}`);
      log(`Limit a step in ${file}, e.g.\n[models.${host === 'codex' ? 'codex' : 'claude'}.allow.tester]\nmodels = ["${MODEL_ORDER[host][0]}", "${MODEL_ORDER[host][1]}"]\nefforts = ["medium"]`);
      continue;
    }
    prompt.note(`${routeTable(host, effective(saved), DEFAULT_ROUTES, noteWidth()).join('\n')}${Object.keys(saved).length ? '\n* = changed by your limits' : ''}\n\nHigh effort is used only by the planner. Change this anytime: jevmind models`, `Model routing (${AGENT_NAME[host]})`);
    const how = await prompt.select({
      message: 'How do you want to route models?',
      options: [
        { value: 'recommended', label: 'Use recommended', hint: 'best cost/quality balance' },
        { value: 'customize', label: 'Customize some steps' },
      ],
      initialValue: Object.keys(saved).length ? 'customize' : 'recommended',
    });
    if (prompt.isCancel(how)) return log('Nothing changed.');
    if (how === 'recommended') {
      saveGlobalAllow(host, null);
      log(`${AGENT_NAME[host]}: using the recommended routing.`);
      continue;
    }
    const draft: Partial<Record<RouteRole, Allow>> = { ...saved };
    for (;;) {
      const steps = await prompt.multiselect({ message: 'Which steps do you want to change?', options: ROLES.map((r) => ({ value: r, label: STEP[r] })), required: true });
      if (prompt.isCancel(steps)) return log('Nothing changed.');
      for (const role of steps) {
        const rec = DEFAULT_ROUTES[host][role];
        const recModels = new Set([rec.normal.model, rec.critical.model]);
        const recEfforts = new Set([rec.normal.effort, rec.critical.effort]);
        const known = [...MODEL_ORDER[host], ...(draft[role]?.models ?? []).filter((m) => !MODEL_ORDER[host].includes(m))];
        const models = await prompt.multiselect({
          message: `${STEP[role]} · models Jevmind may use`,
          options: known.map((m) => ({ value: m, label: name(m), hint: [HINT[m], recModels.has(m) ? 'recommended' : ''].filter(Boolean).join(' · ') || undefined })),
          initialValues: draft[role]?.models ?? MODEL_ORDER[host],
          required: true,
        });
        if (prompt.isCancel(models)) return log('Nothing changed.');
        const efforts = await prompt.multiselect({
          message: `${STEP[role]} · effort levels Jevmind may use`,
          options: EFFORT_ORDER.map((e) => ({ value: e, label: e, hint: recEfforts.has(e) ? 'recommended' : undefined })),
          initialValues: draft[role]?.efforts ?? EFFORT_ORDER,
          required: true,
        });
        if (prompt.isCancel(efforts)) return log('Nothing changed.');
        // Everything allowed is no limit: store nothing for that field.
        const allow: Allow = {
          ...(models.length === MODEL_ORDER[host].length && models.every((m) => MODEL_ORDER[host].includes(m)) ? {} : { models }),
          ...(efforts.length === EFFORT_ORDER.length ? {} : { efforts }),
        };
        if (Object.keys(allow).length) draft[role] = allow;
        else delete draft[role];
        log(pickLine(role, effective(draft)[host][role]));
      }
      prompt.note(routeTable(host, effective(draft), DEFAULT_ROUTES, noteWidth()).join('\n'), 'Review your routing (* = changed)');
      const next = await prompt.select({
        message: 'Save these settings?',
        options: [
          { value: 'save', label: 'Save' },
          { value: 'edit', label: 'Edit another step' },
          { value: 'reset', label: 'Reset to recommended' },
          { value: 'cancel', label: 'Cancel', hint: 'nothing is saved' },
        ],
      });
      if (prompt.isCancel(next) || next === 'cancel') return log('Nothing changed.');
      if (next === 'edit') continue;
      if (next === 'reset') for (const role of ROLES) delete draft[role];
      saveGlobalAllow(host, draft);
      log(`${AGENT_NAME[host]}: routing saved to ${file}.`);
      break;
    }
  }
}
