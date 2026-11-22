import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DirectApiError, DirectError, directId } from './direct-api.ts';
import { directCalendarDate } from './campaign.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import type { openDatabase } from './database.ts';
import type { DirectConnection, DirectState } from './direct.ts';

export type DirectLaunchReadiness = {
  advertiser: { name: string; checkedAt: string; generation: number };
  measurement: { counterId: string; goalId: string; landing: string; configId: string; generation: number; verifiedAt: number };
};
export type DirectLaunchApproval = {
  owner: string; workspace: string; run: string; plan: string; account: string; generation: number;
  campaign: string; ad: string; startDate: string; endDate: string; spendLimitMicros: string;
  vatBasisPoints: number; capKop: number; readiness: DirectLaunchReadiness;
};
export type DirectLaunchOptions = { approval?: DirectLaunchApproval; readiness(owner: string, workspace: string): DirectLaunchReadiness | undefined };
export type DirectLaunchAction = 'refresh' | 'moderate' | 'pause' | 'resume';
type Command = Exclude<DirectLaunchAction, 'refresh'>;
type Outcome = 'pending' | 'unknown' | 'confirmed' | 'not_sent' | 'rejected';
type LaunchEvent = { id: string; action: Command; outcome: Outcome; at: string; actor: string; approvalHash?: string };
export type DirectLaunchObservation = {
  campaignStatus: string; campaignState: string; adStatus?: string; adState?: string; zeroTraffic?: boolean; checkedAt: string;
  impressions?: string; clicks?: string; adStatusClarification?: string;
};
type Pending = { id: string; action: Command; before: string; acknowledged?: true };
export type DirectLaunchState = {
  observation?: DirectLaunchObservation;
  pending?: Pending & { earlier?: Pending };
  budget?: { capKop: number; reservedKop: number; vatBasisPoints: number };
  history: LaunchEvent[];
};
export type DirectLaunchView = {
  run: string; generation: number; revision: number; state: DirectLaunchState; capKop?: number;
  canModerate: boolean; canPause: boolean; canResume: boolean; reason?: string; needsReadiness?: boolean;
};
type Hooks = {
  accountVat(): Promise<unknown>;
  validatePlan(owner: string, run: DirectState): void;
  observe(run: DirectState, strict: boolean, readAd?: boolean): Promise<DirectLaunchObservation>;
  write(owner: string, run: DirectState, id: string, resource: string, method: string, params: object,
    onFailure: (outcome: 'not_sent' | 'rejected') => void, beforeDispatch: () => void): Promise<string>;
};
type Database = ReturnType<typeof openDatabase>;
const fail = (message: string): never => { throw new DirectError(message); };
class LaunchReadinessError extends DirectError {}
const one = (form: URLSearchParams, field: string) => form.getAll(field).length === 1 ? form.get(field)! : '';
const nonempty = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const natural = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const stamp = () => new Date().toISOString();
const isId = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;

export function directTraffic(statistics: { Impressions?: unknown; Clicks?: unknown } | undefined) {
  const count = (value: unknown) => {
    if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') return;
    const text = String(value);
    if (/^\d{1,19}$/.test(text)) return text;
  };
  const impressions = count(statistics?.Impressions), clicks = count(statistics?.Clicks);
  return { impressions, clicks, zeroTraffic: impressions === '0' && clicks === '0' };
}

function isApproval(value: unknown): value is DirectLaunchApproval {
  if (!value || typeof value !== 'object') return false;
  const a = value as DirectLaunchApproval;
  const advertiser = a.readiness?.advertiser, measurement = a.readiness?.measurement;
  return [a.owner, a.workspace, a.run, a.plan].every(nonempty) &&
    [a.account, a.campaign, a.ad, a.spendLimitMicros, measurement?.counterId, measurement?.goalId].every(isId) &&
    date(a.startDate) && date(a.endDate) && a.startDate <= a.endDate &&
    natural(a.generation) && natural(a.vatBasisPoints) && a.vatBasisPoints <= 10000 && natural(a.capKop) && a.capKop > 0 &&
    Boolean(advertiser && nonempty(advertiser.name) && nonempty(advertiser.checkedAt) && Number.isFinite(Date.parse(advertiser.checkedAt)) &&
      advertiser.generation === a.generation && measurement && natural(measurement.generation) &&
      natural(measurement.verifiedAt) && measurement.verifiedAt > 0 && nonempty(measurement.configId) && nonempty(measurement.landing));
}

export function parseDirectLaunchApproval(value?: string) {
  if (!value) return undefined;
  try {
    const approval: unknown = JSON.parse(value);
    return isApproval(approval) ? approval : undefined;
  } catch { return undefined; }
}

function grossKop(approval: DirectLaunchApproval) {
  const micros = BigInt(approval.spendLimitMicros);
  const gross = (micros * BigInt(10000 + approval.vatBasisPoints) + 99999999n) / 100000000n;
  if (gross <= 0n || gross > BigInt(Number.MAX_SAFE_INTEGER)) return fail('Не удалось проверить сумму лимита с НДС.');
  return Number(gross);
}

function providerVat(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parts = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (parts) return Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
}

function canStop(state: DirectLaunchState, observed: DirectLaunchObservation | undefined) {
  if (!state.budget || state.pending?.action === 'pause' ||
      (observed && ['ARCHIVED', 'CONVERTED', 'ENDED'].includes(observed.campaignState))) return false;
  if (observed?.campaignState !== 'SUSPENDED') return true;
  const last = state.history.at(-1);
  return Boolean(state.pending && !(last?.action === 'pause' && last.outcome === 'confirmed'));
}
const draftForModeration = (o: DirectLaunchObservation) =>
  o.adStatus === 'DRAFT' && o.adState === 'OFF' && o.campaignStatus === 'DRAFT' && o.campaignState === 'OFF' && o.zeroTraffic;
const suspendedForResume = (o: DirectLaunchObservation | undefined) =>
  o?.campaignState === 'SUSPENDED' && o.campaignStatus === 'ACCEPTED' && o.adStatus === 'ACCEPTED' && o.adState === 'OFF';

function effectSeen(command: Pending, observation: DirectLaunchObservation) {
  if (command.action === 'moderate') return ['MODERATION', 'PREACCEPTED', 'ACCEPTED', 'REJECTED'].includes(observation.adStatus ?? '');
  if (command.action === 'pause') return observation.campaignState === 'SUSPENDED' &&
    (command.before !== 'SUSPENDED' || command.acknowledged === true);
  return observation.campaignState === 'ON' || (command.acknowledged === true && observation.campaignState === 'OFF');
}

export function createDirectLifecycle(db: Database, connection: DirectConnection, options: DirectLaunchOptions | undefined, hooks: Hooks) {
  const configured = isApproval(options?.approval) ? options.approval : undefined;

  function findRun(owner: string, workspace: string) {
    if (owner !== connection.owner || !connection.ownChief || connection.generation === undefined ||
        !db.readCampaignWorkspace(owner, workspace)) return;
    return db.readCampaignDirectRuns(owner, workspace).findLast(run => run.account === connection.account &&
      run.guidedDraft && run.complete && !run.pilot && run.budget && run.steps.campaign.phase === 'confirmed' &&
      run.steps.ad.phase === 'confirmed' && isId(run.steps.campaign.id) && isId(run.steps.ad.id));
  }

  function approvalFor(owner: string, workspace: string, run: DirectState) {
    const a = configured, period = run.budget;
    return a && period && a.owner === owner && a.workspace === workspace && a.run === run.planId && a.plan === run.campaignPlanId &&
      a.account === run.account && a.generation === connection.generation && a.campaign === run.steps.campaign.id &&
      a.ad === run.steps.ad.id && a.startDate === period.startDate && a.endDate === period.endDate &&
      a.spendLimitMicros === period.spendLimitMicros && a.readiness.measurement.landing === run.draft.url ? a : undefined;
  }

  function paidApproval(owner: string, workspace: string, run: DirectState, action: 'moderate' | 'resume') {
    const a = approvalFor(owner, workspace, run);
    if (!a) return fail('Нет точного допуска на этот кабинет, черновик и период.');
    if (directCalendarDate() > (action === 'moderate' ? a.startDate : a.endDate))
      return fail('Срок допуска на запуск истёк.');
    if (connection.needsReconcile) return fail('Сначала сверьте состояние после изменения подключения.');
    if (!isDeepStrictEqual(options?.readiness(owner, workspace), a.readiness))
      throw new LaunchReadinessError('Проверки рекламодателя или цели Метрики изменились. Требуется новый допуск.');
    hooks.validatePlan(owner, run);
    const gross = grossKop(a);
    if (gross > a.capKop) return fail('Стратегия с НДС превышает согласованный лимит.');
    const existing = run.launch?.budget;
    if (action === 'resume' && (!existing || existing.capKop !== a.capKop || existing.reservedKop !== gross || existing.vatBasisPoints !== a.vatBasisPoints))
      return fail('Утверждённый резерв изменился. Возобновление заблокировано.');
    return { a, gross };
  }

  function initialState(run: DirectState): DirectLaunchState {
    if (run.launch) return run.launch;
    const campaign = run.snapshot?.campaign, ad = run.snapshot?.ad;
    return { history: [], observation: campaign && run.checkedAt ? {
      campaignStatus: campaign.Status, campaignState: campaign.State,
      adStatus: ad?.Status, adState: ad?.State, checkedAt: run.checkedAt,
      ...(ad?.Status === 'REJECTED' && typeof ad.StatusClarification === 'string' ? { adStatusClarification: ad.StatusClarification } : {}),
      ...directTraffic(campaign.Statistics),
    } : undefined };
  }

  function lifecycleView(owner: string, workspace: string): DirectLaunchView | undefined {
    const run = findRun(owner, workspace);
    if (!run) return;
    const a = approvalFor(owner, workspace, run);
    if (!a && !run.launch?.budget) return;
    const state = initialState(run), observed = state.observation;
    const paid = state.budget ? 'resume' : 'moderate';
    let reason: string | undefined, needsReadiness: boolean | undefined;
    try {
      paidApproval(owner, workspace, run, paid);
      if (state.pending || hasUnresolvedDirect(run)) reason = 'Сначала сверьте исход предыдущей команды.';
    } catch (error) {
      reason = error instanceof DirectError ? error.message : 'Допуск требует проверки.';
      if (error instanceof LaunchReadinessError) needsReadiness = true;
    }
    return { run: run.planId, generation: connection.generation!, revision: run.storageRevision!, state, capKop: a?.capKop ?? state.budget?.capKop,
      canModerate: !reason && !state.budget && Boolean(observed && draftForModeration(observed)),
      canPause: canStop(state, observed), canResume: !reason && Boolean(state.budget && suspendedForResume(observed)), reason, needsReadiness };
  }

  function record(run: DirectState, command: Pending, outcome: Outcome) {
    const event = run.launch!.history.find(item => item.id === command.id);
    if (event) event.outcome = outcome;
    if (outcome === 'confirmed') {
      const attempt = run.attempts?.findLast(item => item.stepKey === command.id);
      if (attempt) attempt.outcome = 'confirmed';
    }
  }

  function reconcile(run: DirectState, fresh: DirectLaunchObservation) {
    const state = run.launch!;
    state.observation = fresh;
    const pending = state.pending;
    if (pending && effectSeen(pending, fresh)) {
      record(run, pending, 'confirmed');
      state.pending = pending.earlier;
    }
    const earlier = state.pending?.earlier;
    if (earlier && effectSeen(earlier, fresh)) {
      record(run, earlier, 'confirmed');
      delete state.pending!.earlier;
    } else if (state.pending && state.pending !== pending && effectSeen(state.pending, fresh)) {
      record(run, state.pending, 'confirmed');
      state.pending = undefined;
    }
  }

  async function lifecycleAction(owner: string, workspace: string, action: DirectLaunchAction, form: URLSearchParams, actor: string) {
    if (!['refresh', 'moderate', 'pause', 'resume'].includes(action) || owner !== connection.owner || !connection.ownChief || connection.generation === undefined)
      return fail('Управление показами недоступно.');
    const unlock = db.lockDirect(connection.account);
    try {
      const run = findRun(owner, workspace), a = run && approvalFor(owner, workspace, run);
      if (!run || (!a && !run.launch?.budget) || one(form, 'run') !== run.planId ||
          one(form, 'revision') !== String(run.storageRevision) || one(form, 'generation') !== String(connection.generation))
        return fail('Допуск или версия кампании изменились. Откройте сводку заново.');
      const state = run.launch ??= initialState(run);
      if (action === 'refresh') {
        reconcile(run, await hooks.observe(run, false));
        db.saveDirect(owner, run);
        return;
      }
      if (one(form, 'confirm') !== 'yes') return fail('Подтвердите действие и его последствия.');
      const previous = state.pending;
      if (action === 'pause' && !canStop(state, state.observation)) return fail('Для этой кампании не требуется защитная остановка.');
      if (action !== 'pause' && (previous || hasUnresolvedDirect(run))) return fail('Сначала сверьте исход предыдущей команды.');
      if (action === 'moderate' && state.budget) return fail('У кампании уже есть резерв и допуск. Сверьте статус.');
      const paid = action === 'pause' ? undefined : paidApproval(owner, workspace, run, action);
      if (paid && providerVat(await hooks.accountVat()) !== paid.a.vatBasisPoints)
        return fail('Ставка НДС Директа отличается от допуска или не подтверждена.');
      const reading = await hooks.observe(run, action !== 'pause', action !== 'pause');
      reconcile(run, reading);
      if (action === 'moderate' && !draftForModeration(reading) || action === 'resume' && !suspendedForResume(reading)) {
        db.saveDirect(owner, run);
        return fail('Директ не подтвердил ожидаемое исходное состояние команды.');
      }
      if (action === 'pause' && !canStop(state, reading)) {
        db.saveDirect(owner, run);
        return;
      }

      const budgetWasReserved = Boolean(state.budget);
      if (paid && !budgetWasReserved) state.budget = { capKop: paid.a.capKop, reservedKop: paid.gross, vatBasisPoints: paid.a.vatBasisPoints };
      const pending: NonNullable<DirectLaunchState['pending']> = {
        action, id: randomUUID(), before: reading.campaignState, ...(state.pending ? { earlier: state.pending } : {}),
      };
      state.pending = pending;
      state.history.push({ id: pending.id, action, outcome: 'pending', at: stamp(), actor,
        ...(paid ? { approvalHash: createHash('sha256').update(JSON.stringify(paid.a)).digest('hex') } : {}) });
      const resource = action === 'moderate' ? 'ads' : 'campaigns';
      const method = action === 'pause' ? 'suspend' : action;
      const target = directId(action === 'moderate' ? run.steps.ad.id : run.steps.campaign.id);
      try {
        const result = await hooks.write(owner, run, pending.id, resource, method, { SelectionCriteria: { Ids: [BigInt(target)] } }, outcome => {
          record(run, pending, outcome);
          state.pending = pending.earlier;
          if (!budgetWasReserved) state.budget = undefined;
        }, () => {
          const saved = db.readDirect(owner, run.planId);
          if (!saved?.launch?.budget || saved.launch.pending?.id !== pending.id)
            return fail('Резерв и намерение не подтверждены.');
          if (action !== 'pause') {
            const { a, gross } = paidApproval(owner, workspace, saved, action), reserved = saved.launch.budget;
            if (reserved.capKop !== a.capKop || reserved.reservedKop !== gross || reserved.vatBasisPoints !== a.vatBasisPoints)
              fail('Сохранённый резерв расходится с подтверждённым лимитом.');
          }
        });
        if (result !== target) throw new DirectApiError('Директ вернул другой ID. Сверьте состояние.', 'unknown');
        pending.acknowledged = true;
        record(run, pending, 'unknown');
        db.saveDirect(owner, run);
      } catch (error) {
        if (state.pending?.id === pending.id && db.readDirect(owner, run.planId)?.launch?.pending?.id === pending.id) {
          record(run, pending, 'unknown');
          db.saveDirect(owner, run);
        }
        throw error;
      }
      reconcile(run, await hooks.observe(run, false, action !== 'pause'));
      db.saveDirect(owner, run);
    } finally { unlock(); }
  }

  return { lifecycleView, lifecycleAction };
}
