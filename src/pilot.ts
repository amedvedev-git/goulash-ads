import { randomUUID } from 'node:crypto';
import { directCalendarDate } from './campaign.ts';
import { hash, planCurrent } from './campaign-plan.ts';
import type { openDatabase } from './database.ts';
import { confirmedOffDraft } from './direct.ts';
import type { DirectConnection, DirectState } from './direct.ts';
import { DirectError } from './direct-api.ts';

export const rollstarGoal = { id: process.env.GOULASH_TRAINING_COUNTER_ID || '11001001',
  goal: process.env.GOULASH_TRAINING_GOAL_ID || '21001001', event: 'save_order', domain: 'rollstar.ru' } as const;
export type PilotPhase = 'draft' | 'reviewing' | 'rejected' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped';
type Command = 'moderate' | 'start' | 'stop';
type Period = NonNullable<DirectState['budget']>;
export type PilotTarget = { owner: string; run: string; plan: string; account: string; campaign: string; ad: string; landing: string; period: Period };
type Identity = Pick<PilotTarget, 'account' | 'campaign' | 'ad'>;
export type PilotObservation = Identity & {
  phase: PilotPhase; receipt?: 'applied' | 'not_sent'; reason?: string;
  advertiser: string | null; marked: boolean; canManage: boolean; currency: string; vat: number;
  counter: { id: string; goal: string; event: string; domain: string } | null;
  landing: string; period: Period & { timeZone: string; search: string; network: string; portfolio: boolean };
};
type ReportScope = { account: string; campaign: string; from: string; to: string; timeZone: string };
export type PilotReports =
  { status: 'waiting' | 'stale' } |
  {
    status: 'ready'; settled: boolean;
    direct: ReportScope & { currency: string; includeVAT: boolean; spendKop: number; impressions: number; clicks: number };
    metrika: ReportScope & { counter: string; goal: string; attribution: string; orderIds: string[] };
    customers?: ReportScope & { name: string; clients: { orderId: string; clientId: string; firstOrder: boolean }[] };
  };
export type PilotProvider = {
  mode: 'fixture';
  observe(target: PilotTarget, operation?: string): Promise<PilotObservation>;
  testOrder(target: PilotTarget): Promise<{ counter: string; goal: string; event: string; order: string; accepted: boolean; occurrences: number }>;
  dispatch(target: PilotTarget, command: Command, receipt: string): Promise<void>;
  reports(target: PilotTarget): Promise<PilotReports>;
};

export type PilotState = {
  phase: PilotPhase; checkedAt?: string; issue?: string; moderationReason?: string;
  proof?: { hash: string; advertiser: string; vat: number; grossKop: number };
  test?: { hash: string; order: string; at: string };
  testOrderId?: string;
  budget?: { limitKop: number; reservedKop: number; settled: boolean; overrun?: true; observedSpendKop?: number; finalSpendKop?: number };
  pending?: { id: string; command: Command; from: PilotPhase; unknown?: true };
  history: { at: string; text: string; actor: string }[];
  report?: { status: 'waiting' | 'stale' | 'ready'; latest?: {
    at: string; spendKop: number; impressions: number; clicks: number; orders: number;
    customers?: { name: string; confirmed: number; first: number };
  } };
};

export type PilotView = { id: string; name: string; revision: number; generation: number; target: PilotTarget; state: PilotState };
type Database = ReturnType<typeof openDatabase>;
type PilotConnection = Pick<DirectConnection, 'owner' | 'account' | 'mode' | 'ownChief' | 'generation' | 'needsReconcile'>;
type RunBinding = { run: DirectState; target: PilotTarget; state: PilotState };
const fail = (message: string): never => { throw new DirectError(message); };
const one = (form: URLSearchParams, key: string) => form.getAll(key).length === 1 ? form.get(key)!.trim() : '';
const at = () => new Date().toISOString();
function dateNumber(value: string) {
  const date = Date.parse(value + 'T00:00:00Z');
  return /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : NaN;
}
const id = (value: string) => /^\d{1,19}$/.test(value);
const reportId = (value: string) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const commands = new Set(['moderate', 'start', 'stop']);
const phaseAfterCommand: Record<Command, PilotPhase[]> = {
  moderate: ['reviewing', 'ready', 'rejected', 'starting', 'running'],
  start: ['starting', 'running'], stop: ['stopping', 'stopped'],
};
const phaseText: Record<PilotPhase, string> = {
  draft: 'Показы выключены', reviewing: 'На модерации', rejected: 'Модерация отклонена',
  ready: 'Модерация пройдена', starting: 'Показы включаются', running: 'Показы идут',
  stopping: 'Показы останавливаются', stopped: 'Показы остановлены',
};
const commandText: Record<Command, string> = { moderate: 'Отправка на модерацию', start: 'Включение показов', stop: 'Остановка показов' };

export function pilotStatus(phase: PilotPhase) { return phaseText[phase]; }
export function pilotCommand(command: Command) { return commandText[command]; }
export const pilotMoney = (kopecks: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: kopecks % 100 ? 2 : 0,
}).format(kopecks / 100);

export class PilotLimitError extends DirectError {
  value: string;

  constructor(value: string, message: string) {
    super(message);
    this.value = value;
  }
}

export function pilotLanding(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
      parsed.hostname.replace(/^www\./, '') === rollstarGoal.domain;
  } catch { return false; }
}

function targetFor(owner: string, run: DirectState): PilotTarget | undefined {
  const { budget: period, campaignPlanId: plan, account, planId, steps, draft } = run;
  const campaign = steps.campaign.id, ad = steps.ad.id;
  if (!run.guidedDraft || !run.complete || !period || !plan || !campaign || !ad || !id(campaign) || !id(ad)) return;
  if (!run.pilot && !confirmedOffDraft(run)) return;
  return { owner, run: planId, plan, account, campaign, ad, landing: draft.url, period };
}

function expectedProof(target: PilotTarget, reading: PilotObservation, generation: number) {
  const { period, advertiser, vat, counter } = reading;
  if (!(reading.canManage && reading.marked && typeof advertiser === 'string' && advertiser.trim()))
    fail('Рекламодатель, маркировка или право управления не подтверждены.');
  if (!pilotLanding(target.landing) || reading.landing !== target.landing || !counter ||
      counter.domain !== rollstarGoal.domain || counter.id !== rollstarGoal.id || counter.goal !== rollstarGoal.goal || counter.event !== rollstarGoal.event)
    fail('Посадочная страница или цель Метрики не совпадает с Rollstar.');
  const start = dateNumber(period.startDate), end = dateNumber(period.endDate);
  if (reading.currency !== 'RUB' || !Number.isInteger(vat) || vat < 0 || vat > 100 ||
      period.kind !== 'custom_period' || period.timeZone !== 'Europe/Moscow' || period.autoContinue !== 'NO' ||
      period.search !== 'WB_MAXIMUM_CLICKS' || period.network !== 'SERVING_OFF' || period.portfolio ||
      !Number.isFinite(start) || !Number.isFinite(end) || end < start || !/^\d{1,15}$/.test(period.spendLimitMicros) ||
      period.spendLimitMicros !== target.period.spendLimitMicros || period.startDate !== target.period.startDate ||
      period.endDate !== target.period.endDate || period.periodDays !== target.period.periodDays ||
      (end - start) / 86400000 + 1 !== Number(period.periodDays)) fail('Параметры бюджета Директа изменились. Нужна сверка периода, стратегии и НДС.');
  const grossKop = Number((BigInt(period.spendLimitMicros) * BigInt(100 + vat) + 999999n) / 1000000n);
  if (!count(grossKop) || grossKop === 0) fail('Лимит стратегии не подтверждён.');
  return { hash: hash([target, generation, advertiser, vat, counter]), advertiser: advertiser!, vat, grossKop };
}

function parseLimit(form: URLSearchParams, minimum: number) {
  const fields = form.getAll('limitRub');
  const value = fields[0] ?? '';
  const amount = value.trim();
  const minimumText = `Минимальный лимит с НДС — ${pilotMoney(minimum)}.`;
  if (fields.length !== 1 || !/^\d{1,9}([,.]\d{1,2})?$/.test(amount))
    throw new PilotLimitError(value, `Укажите лимит в рублях с точностью до копеек. ${minimumText}`);
  const [rubles, cents = ''] = amount.split(/[,.]/);
  const limitKop = Number(rubles) * 100 + Number(cents.padEnd(2, '0'));
  if (limitKop < minimum)
    throw new PilotLimitError(value, `Введённый лимит меньше минимального. ${minimumText}`);
  return limitKop;
}

function sameScope(scope: ReportScope, target: PilotTarget) {
  return scope.account === target.account && scope.campaign === target.campaign && scope.timeZone === 'Europe/Moscow' &&
    scope.from === target.period.startDate && scope.to === target.period.endDate;
}

function readSpend(direct: Extract<PilotReports, { status: 'ready' }>['direct'], target: PilotTarget) {
  if (!sameScope(direct, target) || direct.currency !== 'RUB' || !direct.includeVAT ||
      !count(direct.spendKop) || !count(direct.impressions) || !count(direct.clicks) || direct.clicks > direct.impressions)
    fail('Расход не совпадает по кампании, периоду или НДС.');
  return direct.spendKop;
}

function readMetrics(result: Extract<PilotReports, { status: 'ready' }>, target: PilotTarget, testOrder?: string) {
  const { direct, metrika, customers } = result;
  if (!sameScope(metrika, target) || metrika.counter !== rollstarGoal.id || metrika.goal !== rollstarGoal.goal ||
      metrika.attribution !== 'last' || !Array.isArray(metrika.orderIds) || !metrika.orderIds.every(reportId))
    fail('Отчёт Метрики не совпадает по кампании, периоду или цели. Сравнение недоступно.');
  const orders = new Set(metrika.orderIds.filter(order => order !== testOrder));
  let matched: { name: string; confirmed: number; first: number } | undefined;
  if (customers && sameScope(customers, target) && typeof customers.name === 'string' && customers.name.trim() && Array.isArray(customers.clients) &&
      customers.clients.every(row => reportId(row.clientId) && (orders.has(row.orderId) || row.orderId === testOrder) && typeof row.firstOrder === 'boolean')) {
    const clients = customers.clients.filter(row => row.orderId !== testOrder);
    matched = { name: customers.name, confirmed: new Set(clients.map(row => row.clientId)).size,
      first: new Set(clients.filter(row => row.firstOrder).map(row => row.clientId)).size };
  }
  return { at: at(), spendKop: direct.spendKop, impressions: direct.impressions, clicks: direct.clicks, orders: orders.size, customers: matched };
}

export function createPilot(db: Database, provider: PilotProvider, connectionFor: (owner: string) => PilotConnection | undefined,
  reconciled: (owner: string, generation: number, run: string) => void) {
  function binding(owner: string, workspace: string): RunBinding | undefined {
    if (!db.readCampaignWorkspace(owner, workspace)) return;
    const run = db.readCampaignDirectRuns(owner, workspace).findLast(candidate => candidate.guidedDraft);
    const target = run && targetFor(owner, run);
    if (!run || !target || !pilotLanding(target.landing)) return;
    return { run, target, state: run.pilot ?? { phase: 'draft', history: [] } };
  }
  function fixtureConnection(owner: string, target: PilotTarget) {
    const value = connectionFor(owner);
    if (value?.mode !== 'fixture' || value.owner !== owner || value.account !== target.account || !value.ownChief ||
        value.generation === undefined) return;
    return value;
  }
  function view(owner: string, workspace: string): PilotView | undefined {
    const found = binding(owner, workspace);
    const connection = found && fixtureConnection(owner, found.target);
    if (!found || !connection) return;
    const name = db.readPreparation(owner, workspace)?.value.campaignName ?? 'Rollstar';
    return { id: workspace, name, revision: found.run.storageRevision!, generation: connection.generation!, target: found.target, state: found.state };
  }
  function record(state: PilotState, actor: string, text: string) {
    state.history = [...state.history.slice(-39), { at: at(), actor, text }];
  }
  function save(owner: string, snapshot: RunBinding) {
    snapshot.run.pilot = snapshot.state;
    db.saveDirect(owner, snapshot.run);
  }
  async function observe(target: PilotTarget, operation?: string) {
    let data: PilotObservation;
    try { data = await provider.observe(target, operation); }
    catch { return fail('Имитация Директа не ответила. Сверьте статус позже.'); }
    if (data.account !== target.account || data.campaign !== target.campaign || data.ad !== target.ad ||
        !Object.hasOwn(phaseText, data.phase)) return fail('Ответ относится к другой кампании или состояние неизвестно.');
    return data;
  }
  function applyObservation(state: PilotState, reading: PilotObservation, actor: string) {
    state.checkedAt = at();
    if (state.pending) {
      const { command, from } = state.pending;
      if (reading.receipt === 'applied' && phaseAfterCommand[command].includes(reading.phase)) {
        record(state, actor, commandText[command] + ' подтверждена чтением · ' + phaseText[reading.phase]);
        state.pending = undefined;
      } else if (reading.receipt === 'not_sent' && reading.phase === from) {
        record(state, actor, commandText[command] + ' · имитация подтвердила, что команда не применена.');
        if (command === 'moderate' && from === 'draft') state.budget = undefined;
        state.pending = undefined;
      } else return;
    }
    if (state.phase !== reading.phase) record(state, actor, phaseText[reading.phase]);
    state.phase = reading.phase;
    state.moderationReason = reading.phase === 'rejected' ? reading.reason : undefined;
  }
  function refreshProof(snapshot: RunBinding, reading: PilotObservation, generation: number) {
    const { state, target } = snapshot;
    try {
      const proof = expectedProof(target, reading, generation);
      if (state.proof?.hash !== proof.hash) {
        state.test = undefined;
        if (state.budget) fail('Подтверждённые условия запуска изменились. Резерв сохранён.');
      }
      state.proof = proof;
      state.issue = undefined;
    } catch (error) {
      state.issue = (error as Error).message;
      if (!state.budget) state.proof = state.test = undefined;
    }
  }
  return { view, async action(owner: string, workspace: string, form: URLSearchParams, actor: string) {
    const initial = binding(owner, workspace);
    if (!initial) return fail('Подтверждённый черновик не найден.');
    const unlock = db.lockDirect(initial.target.account);
    try {
      const snapshot = binding(owner, workspace);
      const connected = snapshot && fixtureConnection(owner, snapshot.target);
      if (!snapshot || !connected || snapshot.run.planId !== initial.run.planId ||
          one(form, 'run') !== snapshot.target.run ||
          one(form, 'generation') !== String(connected.generation) ||
          one(form, 'revision') !== String(snapshot.run.storageRevision)) return fail('Экран устарел или доступ изменился. Откройте кампанию заново.');
      const generation = connected.generation!;
      const validateConnection = (allowReconcile = false) => {
        const current = fixtureConnection(owner, snapshot.target);
        if (!current || current.generation !== generation || (current.needsReconcile && !allowReconcile))
          fail('Доступ к учебному кабинету изменился. Команда остановлена.');
      };
      const validatePlan = () => {
        const saved = db.readPreparation(owner, workspace);
        if (saved?.value.confirmedPlanId !== snapshot.target.plan ||
            !planCurrent(db.readPlan(owner, snapshot.target.plan, workspace), saved, db.readCampaign(owner, workspace)))
          fail('Версия рекламного плана изменилась. Выключение и сверка доступны на исходном запуске.');
      };
      const { state, target } = snapshot;
      const action = one(form, 'action');
      const stoppingUnknownStart = action === 'stop' && state.pending?.command === 'start';
      if (state.pending && action !== 'refresh' && !stoppingUnknownStart) return fail('Сначала сверьте исход предыдущей команды.');
      if (action === 'check' || action === 'refresh') {
        const reading = await observe(target, state.pending?.id);
        validateConnection(true);
        applyObservation(state, reading, actor);
        refreshProof(snapshot, reading, generation);
        save(owner, snapshot);
        if (!state.pending && connected.needsReconcile) reconciled(owner, generation, target.run);
        return;
      }
      if (action === 'test-order') {
        if (!state.proof || state.budget || state.phase !== 'draft' || state.issue)
          return fail('Сначала подтвердите подключение и параметры, пока показы выключены.');
        const reading = await observe(target);
        validateConnection();
        validatePlan();
        refreshProof(snapshot, reading, generation);
        if (!state.proof || state.issue || reading.phase !== 'draft') {
          save(owner, snapshot);
          return fail(state.issue ?? 'Черновик изменился. Сверьте состояние.');
        }
        if (state.test?.hash === state.proof.hash) return;
        const order = await db.directTransaction(() => {
          validateConnection();
          validatePlan();
          return provider.testOrder(target);
        });
        validateConnection();
        if (!order.accepted || order.occurrences !== 1 || order.counter !== rollstarGoal.id ||
            order.goal !== rollstarGoal.goal || order.event !== rollstarGoal.event || !reportId(order.order)) {
          state.test = undefined;
          save(owner, snapshot);
          return fail('Имитация не подтвердила один принятый заказ по выбранной цели.');
        }
        state.test = { hash: state.proof.hash, order: order.order, at: at() };
        state.testOrderId = order.order;
        record(state, actor, 'Тестовый заказ и одно событие save_order подтверждены.');
        save(owner, snapshot);
        return;
      }
      if (action === 'reports') {
        if (!state.budget) return fail('Отчёт доступен после отправки на модерацию.');
        const reading = await observe(target);
        validateConnection(true);
        applyObservation(state, reading, actor);
        refreshProof(snapshot, reading, generation);
        try {
          const reports = await provider.reports(target);
          validateConnection(true);
          if (reports.status !== 'ready') {
            state.report = { status: state.report?.latest || reports.status === 'stale' ? 'stale' : 'waiting', latest: state.report?.latest };
          } else {
            const comparable = !state.issue;
            const spendKop = readSpend(reports.direct, target);
            state.budget.observedSpendKop = spendKop;
            if (spendKop > (state.proof?.grossKop ?? state.budget.reservedKop)) {
              state.budget.overrun = true;
              state.issue = 'Подтверждённый расход превысил резерв. Дальнейший запуск остановлен.';
              record(state, actor, state.issue);
            }
            if (reports.settled && ['stopped', 'rejected'].includes(state.phase)) {
              state.budget.finalSpendKop = spendKop;
              if (!state.budget.settled && spendKop <= state.budget.reservedKop) {
                state.budget.settled = true;
                state.budget.reservedKop = 0;
                record(state, actor, 'Итоговый расход подтверждён. Резерв освобождён.');
              }
            }
            state.report = comparable ? { status: 'ready', latest: readMetrics(reports, target, state.testOrderId ?? state.test?.order) } :
              { status: 'stale', latest: state.report?.latest };
          }
          save(owner, snapshot);
          return;
        } catch (error) {
          state.report = { status: 'stale', latest: state.report?.latest };
          save(owner, snapshot);
          return fail(error instanceof DirectError ? error.message : 'Не удалось сверить отчёты. Последние подтверждённые данные сохранены.');
        }
      }
      if (!commands.has(action) || one(form, 'confirm') !== 'yes') return fail('Подтвердите действие, показанное на экране.');
      const command = action as Command;
      const reading = await observe(target, stoppingUnknownStart ? state.pending?.id : undefined);
      validateConnection(command === 'stop');
      if (stoppingUnknownStart) {
        // Before sending stop, reconcile the original start against the exact mock receipt.
        if (reading.receipt === 'applied' && ['ready', 'stopping', 'stopped'].includes(reading.phase)) {
          record(state, actor, 'Получена квитанция о включении: ' + phaseText[reading.phase]);
          state.pending = undefined;
        }
        applyObservation(state, reading, actor);
        refreshProof(snapshot, reading, generation);
        save(owner, snapshot);
        if (state.pending) return fail('Включение пока не подтверждено. Повторно сверьте статус. Резерв сохранён.');
        if (['stopping', 'stopped'].includes(state.phase)) return;
      }
      if (reading.phase !== state.phase && !(command === 'stop' && ['ready', 'running', 'starting'].includes(reading.phase))) {
        applyObservation(state, reading, actor);
        save(owner, snapshot);
        return fail('Статус изменился. Проверьте состояние перед повтором.');
      }
      if (command === 'stop') {
        if (!['ready', 'running', 'starting'].includes(reading.phase) || !state.budget) return fail('Показы уже выключены.');
        state.phase = reading.phase;
      } else {
        validatePlan();
        if (directCalendarDate() > target.period.endDate) return fail('Срок бюджета закончился. Повторное включение недоступно.');
        const previous = state.proof?.hash;
        refreshProof(snapshot, reading, generation);
        if (!state.proof || state.issue || state.proof.hash !== previous || state.test?.hash !== state.proof.hash) {
          save(owner, snapshot);
          return fail(state.issue ?? 'Сначала проверьте параметры и тестовый заказ.');
        }
        if (command === 'moderate') {
          if (state.phase !== 'draft' || state.budget?.settled) return fail('Модерация доступна только для черновика.');
          const limitKop = parseLimit(form, state.proof.grossKop);
          if (state.budget && (limitKop !== state.budget.limitKop || state.budget.reservedKop !== state.proof.grossKop))
            return fail('Действует уже подтверждённый резерв.');
          if (db.readDirectRuns(owner).some(run => run.account === target.account && run.planId !== target.run &&
              (run.pilot?.pending || (run.pilot?.budget && !run.pilot.budget.settled))))
            return fail('Сначала закройте учёт расхода другой учебной кампании в этом кабинете.');
          state.budget = { limitKop, reservedKop: state.proof.grossKop, settled: false };
        } else if (!['ready', 'stopped'].includes(state.phase) || !state.budget || state.budget.settled ||
            state.budget.overrun ||
            state.budget.reservedKop !== state.proof.grossKop ||
            (state.budget.observedSpendKop ?? state.report?.latest?.spendKop ?? 0) > state.budget.reservedKop) {
          return fail('Включение недоступно. Сверьте модерацию, состояние показов и резерв.');
        }
      }
      const receipt = randomUUID();
      state.pending = { id: receipt, command, from: state.phase };
      record(state, actor, commandText[command] + ' · подтверждение сохранено. Ожидается сверка состояния.');
      save(owner, snapshot);
      try {
        await db.directTransaction(() => {
          validateConnection(command === 'stop');
          if (command !== 'stop') validatePlan();
          return provider.dispatch(target, command, receipt);
        });
        validateConnection(command === 'stop');
      } catch {
        state.pending.unknown = true;
        record(state, actor, commandText[command] + ' · ответ не получен. Требуется сверка.');
        save(owner, snapshot);
        return fail('Исход команды неизвестен. Обновите статус; повтор команды заблокирован.');
      }
    } finally { unlock(); }
  } };
}
