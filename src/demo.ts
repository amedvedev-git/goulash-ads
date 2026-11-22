import { hash } from './campaign-plan.ts';
import type { CampaignPlan } from './campaign-plan.ts';
// All amounts are integer kopecks; this module has no external API adapter.
export const demoCases = {
  control: 'Контрольный пример: остановка А и перенос остатка',
  missing: 'Нет данных о достижениях А',
  incomplete: 'Неполный отчёт',
  stale: 'Устаревшие данные',
  lowVolume: 'Мало наблюдений',
  noRecipient: 'Б исключена из получателей',
  exhausted: 'Лимит исчерпан',
} as const;
export type DemoCase = keyof typeof demoCases;
export type DemoCampaign = {
  id: 'a' | 'b'; name: string; status: 'active' | 'stopped'; recipient: boolean;
  spent: number; remaining: number; impressions: number; clicks: number; goals: number | null;
};
export type DemoState = {
  schemaVersion?: 2; periodDays?: 7 | 30; policyVersion?: 'e3-control-1';
  preset?: 'budget-example-v1';
  planRef?: { id: string; preparationRevision: number; campaignRevision: number; fingerprint: string; snapshotHash: string };
  planContext?: { title: string; goal: string; region: string; budget: string; confirmedAt: string };
  mode: 'test'; scenario: DemoCase; limit: number; reserve: number;
  periodStart: string; periodEnd: string; timezone: 'Europe/Moscow';
  updatedAt: string; complete: boolean; goal: string; goalId: string; source: string;
  campaigns: DemoCampaign[];
};
export type SavedDemo = { state: DemoState; revision: number; datasetId: string };
export const policy = { minClicks: 20, maxAgeMs: 24 * 60 * 60 * 1000, stopSpend: 150000, minGoals: 5, maxCpa: 40000 };
export const demoPreset = 'budget-example-v1' as const;
export const presetLimit = 600000;
export function makePresetDemo(scenario: DemoCase): DemoState {
  return { ...makeDemo(scenario), preset: demoPreset, schemaVersion: 2, periodDays: 7, policyVersion: 'e3-control-1',
    source: 'Готовый учебный пример Goulash · две вымышленные кампании' };
}

export function makePlanDemo(plan: CampaignPlan, scenario: DemoCase, now = Date.now()): DemoState {
  if (!/^\d{1,8}$/.test(plan.draft.budget) || Number(plan.draft.budget) < 1 || Number(plan.draft.budget) > 10000000 || !['7','30'].includes(plan.draft.period)) throw new Error('Некорректный бюджет или период плана.');
  const state = makeDemo(scenario, now), limit = BigInt(plan.draft.budget) * 100n;
  const parts = [3n * limit / 10n, limit / 5n, 7n * limit / 60n, 17n * limit / 60n].map(Number);
  Object.assign(state, { schemaVersion: 2, periodDays: Number(plan.draft.period), policyVersion: 'e3-control-1',
    planRef: { id: plan.id, preparationRevision: plan.preparationRevision, campaignRevision: plan.campaignRevision, fingerprint: plan.fingerprint, snapshotHash: hash(plan) },
    planContext: { title: plan.draft.title, goal: plan.goal, region: plan.draft.region, budget: plan.draft.budget, confirmedAt: plan.confirmedAt },
    limit: Number(limit), reserve: Number(limit) - parts.reduce((a,b)=>a+b,0), goal: plan.goal,
    source: 'Синтетические данные для выбранной версии плана · виртуальные назначения' });
  state.periodStart = new Date(Date.parse(state.periodEnd) - (state.periodDays! - 1) * 86400000).toISOString().slice(0,10);
  state.campaigns[0].spent=parts[0];state.campaigns[1].spent=parts[1];state.campaigns[0].remaining=parts[2];state.campaigns[1].remaining=parts[3];
  if(scenario==='exhausted'){state.campaigns[0].spent=Math.floor(state.limit/2);state.campaigns[1].spent=state.limit-state.campaigns[0].spent;state.campaigns.forEach(c=>c.remaining=0);state.reserve=0;}
  return state;
}
export const money = (kopecks: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 2,
}).format(kopecks / 100);

export function makeDemo(scenario: DemoCase, now = Date.now()): DemoState {
  const day = 86400000;
  const moscowDay = Math.floor((now + 3 * 3600000) / day) * day;
  const state: DemoState = {
    mode: 'test', scenario, limit: presetLimit, reserve: 60000,
    periodStart: new Date(moscowDay - 7 * day).toISOString().slice(0, 10),
    periodEnd: new Date(moscowDay - day).toISOString().slice(0, 10),
    timezone: 'Europe/Moscow', updatedAt: new Date(now).toISOString(), complete: true,
    goal: 'Заказ оформлен', goalId: 'demo-order', source: 'Синтетический набор · исследование аналогов 09.11.2026',
    campaigns: [
      { id: 'a', name: 'Кампания А', status: 'active', recipient: false, spent: 180000, remaining: 70000, impressions: 10000, clicks: 60, goals: 0 },
      { id: 'b', name: 'Кампания Б', status: 'active', recipient: true, spent: 120000, remaining: 170000, impressions: 8000, clicks: 60, goals: 6 },
    ],
  };
  if (scenario === 'missing') state.campaigns[0].goals = null;
  if (scenario === 'incomplete') state.complete = false;
  if (scenario === 'stale') state.updatedAt = new Date(now - 25 * 3600000).toISOString();
  if (scenario === 'lowVolume') state.campaigns[0].clicks = 5;
  if (scenario === 'noRecipient') state.campaigns[1].recipient = false;
  if (scenario === 'exhausted') {
    state.campaigns.forEach((campaign) => { campaign.spent = 300000; campaign.remaining = 0; });
    state.reserve = 0;
  }
  return state;
}

export function budgetError(state: DemoState): string | undefined {
  const amounts = [state.limit, state.reserve, ...state.campaigns.flatMap((c) => [c.spent, c.remaining])];
  if (amounts.some((n) => !Number.isSafeInteger(n) || n < 0)) return 'Некорректная сумма: нужны неотрицательные целые копейки.';
  const spent = state.campaigns.reduce((sum, c) => sum + c.spent, 0);
  if (spent > state.limit) return 'Учтённый расход превышает лимит. Распределение запрещено.';
  const total = spent + state.reserve + state.campaigns.reduce((sum, c) => sum + c.remaining, 0);
  if (!Number.isSafeInteger(total) || total !== state.limit) return 'Расход + назначения + резерв не равны общему лимиту.';
}

export function dataIssue(state: DemoState, now = Date.now()): string | undefined {
  if (state.mode !== 'test') return 'Разрешены только тестовые данные.';
  if (!state.complete) return 'Отчёт неполный; недостаточно данных для решения.';
  if (state.goalId !== 'demo-order' || state.timezone !== 'Europe/Moscow') return 'Цель или часовой пояс не соответствуют тестовому набору.';
  const start = Date.parse(state.periodStart), end = Date.parse(state.periodEnd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(state.periodEnd) ||
    !Number.isFinite(start) || ![7,30].includes(state.periodDays ?? 7) || end - start !== ((state.periodDays ?? 7)-1) * 86400000 || end + 86400000 - 3 * 3600000 > now) {
    return 'Нужен завершённый период из 7 или 30 полных дней.';
  }
  const age = now - Date.parse(state.updatedAt);
  if (!Number.isFinite(age) || age < 0 || age > policy.maxAgeMs) return 'Данные устарели или время обновления некорректно; допустимо не более 24 часов.';
  if (now - (end + 86400000 - 3 * 3600000) > 2 * 86400000) return 'Период отчёта слишком старый для решения.';
  if (state.campaigns.length !== 2 || state.campaigns[0].id !== 'a' || state.campaigns[1].id !== 'b') return 'Тестовый набор кампаний неполон.';
  if (state.campaigns.some((c) => c.goals === null)) return 'Нет данных о достижениях цели; отсутствие данных не равно нулю.';
  if (state.campaigns.some((c) => [c.impressions, c.clicks, c.goals].some((n) => !Number.isSafeInteger(n) || n! < 0) || c.clicks > c.impressions)) {
    return 'Некорректные показатели отчёта.';
  }
  if (state.campaigns.some((c) => c.clicks < policy.minClicks)) return 'Недостаточно наблюдений: требуется минимум 20 кликов у каждой кампании.';
}

export function cpa(campaign: DemoCampaign, complete: boolean): number | null {
  return complete && campaign.goals !== null && campaign.goals > 0 ? Math.round(campaign.spent / campaign.goals) : null;
}

export function decide(state: DemoState, now = Date.now()): { status: 'applied' | 'skipped' | 'error'; reason: string; after: DemoState } {
  const error = budgetError(state);
  if (error) return { status: 'error', reason: error, after: state };
  const issue = dataIssue(state, now);
  if (issue) return { status: 'skipped', reason: issue, after: state };
  const source = state.campaigns.find((c) => c.status === 'active' && c.spent >= policy.stopSpend && c.goals === 0 && c.remaining > 0);
  if (!source) return { status: 'skipped', reason: 'Нет активной кампании с расходом от 1 500 ₽, нулём достижений и свободным остатком.', after: state };
  const after = structuredClone(state);
  const stopped = after.campaigns.find((c) => c.id === source.id)!;
  const recipient = after.campaigns.find((c) => c.id !== stopped.id && c.status === 'active' && c.recipient &&
    c.goals! >= policy.minGoals && c.spent <= policy.maxCpa * c.goals!);
  const amount = stopped.remaining;
  stopped.status = 'stopped';
  stopped.remaining = 0;
  if (recipient) recipient.remaining += amount;
  else after.reserve += amount;
  const invariant = budgetError(after);
  if (invariant) return { status: 'error', reason: invariant, after: state };
  const reason = `${source.name} остановлена: за ${state.periodStart} — ${state.periodEnd} учтён расход ${money(source.spent)}, ` +
    `не зафиксировано достижений цели «${state.goal}». Остаток ${money(amount)} ` +
    (recipient ? `назначен: ${recipient.name}, ${recipient.goals} достижений, стоимость достижения ${money(cpa(recipient, true)!)}.`
      : 'сохранён в резерве: подходящего получателя нет.') +
    ` Общий лимит ${money(state.limit)}, учтённый расход ${money(state.campaigns.reduce((sum, c) => sum + c.spent, 0))} сохранён. Тестовые данные.`;
  return { status: 'applied', reason, after };
}
