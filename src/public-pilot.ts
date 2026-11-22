import { randomUUID } from 'node:crypto';
import { directCalendarDate } from './campaign.ts';
import { initialPreparation } from './campaign-plan.ts';
import { defaultCampaignId } from './campaign-workspaces.ts';
import type { openDatabase } from './database.ts';
import { stepNames } from './direct.ts';
import type { DirectState } from './direct.ts';
import { DirectError } from './direct-api.ts';
import { policyHash } from './phrase-policy.ts';
import { createPilot, rollstarGoal } from './pilot.ts';
import type { PilotPhase, PilotProvider, PilotView } from './pilot.ts';
import { createPreparationService } from './preparation.ts';

const workspace = defaultCampaignId;
const demoAccount = (owner: string) => 'pilot-demo:' + owner;
const testOrder = 'rollstar-demo-test';
const transitions = { moderate: 'reviewing', start: 'starting', stop: 'stopping' } as const;
const nextPhase: Partial<Record<PilotPhase, PilotPhase>> = { reviewing: 'ready', starting: 'running', stopping: 'stopped' };
type DemoState = { phase: PilotPhase; receipt?: string; shown?: true; test?: true; finalReport?: true };

export function canRestartPublicPilot(view: PilotView) {
  const { budget, pending } = view.state;
  return !pending && (budget?.settled === true || (!budget && view.target.period.endDate < directCalendarDate()));
}

export function createPublicPilot(db: ReturnType<typeof openDatabase>) {
  const preparation = createPreparationService(db);
  const read = (owner: string): DemoState => JSON.parse(db.read(owner));
  const save = (owner: string, state: DemoState) => db.write(owner, JSON.stringify(state));
  const provider: PilotProvider = {
    mode: 'fixture',
    async observe(target, receipt) {
      const state = read(target.owner);
      const next = nextPhase[state.phase];
      if (!receipt && next) {
        state.phase = next;
        if (next === 'running') state.shown = true;
        save(target.owner, state);
      }
      return {
        account: target.account, campaign: target.campaign, ad: target.ad, phase: state.phase,
        receipt: receipt ? state.receipt === receipt ? 'applied' : 'not_sent' : undefined,
        advertiser: 'Rollstar · учебный рекламодатель', marked: true, canManage: true,
        currency: 'RUB', vat: 22, counter: rollstarGoal, landing: target.landing,
        period: { ...target.period, timeZone: 'Europe/Moscow', search: 'WB_MAXIMUM_CLICKS', network: 'SERVING_OFF', portfolio: false },
      };
    },
    async testOrder(target) {
      const state = read(target.owner);
      save(target.owner, { ...state, test: true });
      return { counter: rollstarGoal.id, goal: rollstarGoal.goal, event: rollstarGoal.event, order: testOrder, accepted: true, occurrences: 1 };
    },
    async dispatch(target, command, receipt) {
      save(target.owner, { ...read(target.owner), phase: transitions[command], receipt, finalReport: undefined });
    },
    async reports(target) {
      const state = read(target.owner);
      const settled = state.phase === 'stopped';
      if (settled && !state.finalReport) {
        save(target.owner, { ...state, finalReport: true });
        return { status: 'stale' };
      }
      if (!settled && state.phase !== 'running') return { status: 'waiting' };
      const scope = { account: target.account, campaign: target.campaign, from: target.period.startDate,
        to: target.period.endDate, timeZone: 'Europe/Moscow' };
      const clients = state.shown ? [
        { orderId: 'order-1', clientId: 'client-a', firstOrder: true },
        { orderId: 'order-2', clientId: 'client-a', firstOrder: false },
        { orderId: 'order-3', clientId: 'client-b', firstOrder: true },
        { orderId: 'order-4', clientId: 'client-c', firstOrder: false },
      ] : [];
      if (state.test) clients.push({ orderId: testOrder, clientId: 'demo-test-client', firstOrder: true });
      return {
        status: 'ready', settled,
        direct: { ...scope, currency: 'RUB', includeVAT: true, spendKop: state.shown ? settled ? 256200 : 244000 : 0,
          impressions: state.shown ? settled ? 5250 : 5000 : 0, clicks: state.shown ? settled ? 105 : 100 : 0 },
        metrika: { ...scope, counter: rollstarGoal.id, goal: rollstarGoal.goal, attribution: 'last', orderIds: clients.map(client => client.orderId) },
        customers: { ...scope, name: 'Заказы Rollstar · имитация', clients },
      };
    },
  };
  const pilot = createPilot(db, provider, owner => ({
    owner, account: demoAccount(owner), mode: 'fixture', ownChief: true, generation: 1,
  }), () => {});

  async function start(owner: string, replacement?: URLSearchParams) {
    const account = demoAccount(owner);
    const unlock = db.lockDirect(account);
    try {
      const current = pilot.view(owner, workspace);
      if (replacement) {
        if (!current || !canRestartPublicPilot(current)) throw new DirectError('Заменить этот учебный запуск пока нельзя.');
        if (replacement.getAll('run').length !== 1 || replacement.get('run') !== current.target.run ||
            replacement.getAll('revision').length !== 1 || replacement.get('revision') !== String(current.revision))
          throw new DirectError('Учебный запуск изменился. Откройте подтверждение заново.');
        if (replacement.getAll('confirm').length !== 1 || replacement.get('confirm') !== 'yes')
          throw new DirectError('Подтвердите замену предыдущего учебного запуска.');
      } else if (current) {
        if (!canRestartPublicPilot(current)) return;
        throw new DirectError('Учебный запуск уже есть. Откройте его, чтобы продолжить.');
      }
      const saved = () => db.readPreparation(owner, workspace)!;
      if (!db.readPreparation(owner, workspace)) db.savePreparation(owner, { ...initialPreparation(), guided: true }, 0, undefined, 0, workspace);
      if (!saved().value.confirmedPlanId) {
        const submit = async (action: string, fields: Record<string, string>) => {
          const input = new URLSearchParams({ ad: workspace, policyHash, preparationRevision: String(saved().revision), ...fields });
          const result = await preparation.action(owner, action, input, 'Учебный запуск', workspace);
          if (result.status !== 200) throw new DirectError(result.message);
        };
        await submit('confirm-profile', {
          campaignName: 'Rollstar', description: 'Rollstar доставляет роллы и сеты в Екатеринбурге.', region: 'Екатеринбург',
          url: 'https://rollstar.ru/ekb/', goal: 'Принятый заказ', editorVersion: '3', profileEditor: 'yes',
          offer0: 'Роллы и сеты', kind0: 'product',
        });
        await submit('offer', {
          title: 'Rollstar — роллы и сеты', adText: 'Роллы и сеты с доставкой по Екатеринбургу.', budget: '7000',
          period: '7', selectionEditor: 'yes', phrases: 'доставка роллов', manualReview: 'yes',
        });
        await submit('confirm', { confirmPlan: 'yes' });
      }
      const campaign = db.readCampaign(owner, workspace)!;
      const previous = db.readCampaignDirectRuns(owner, workspace).at(-1);
      const startDate = directCalendarDate(7);
      const endDate = new Date(Date.parse(startDate + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
      const draft: DirectState = {
        storageRevision: previous?.storageRevision, planId: previous?.planId ?? randomUUID(), campaignPlanId: saved().value.confirmedPlanId,
        account, campaignId: workspace, draft: campaign.draft, revision: campaign.revision, name: 'Rollstar', groupName: 'Учебная группа',
        regionId: '54', regionName: campaign.draft.region, weekly: '', keyword: 'доставка роллов', startDate,
        budget: { kind: 'custom_period', amountRub: '7000', spendLimitMicros: '7000000000', periodDays: '7',
          startDate, endDate, autoContinue: 'NO' },
        guidedDraft: true, complete: true, checkedAt: new Date().toISOString(), events: [],
        steps: Object.fromEntries(Object.keys(stepNames).map((step, index) => [step, { phase: 'confirmed', id: String(index + 1) }])) as DirectState['steps'],
        snapshot: { campaign: { Status: 'DRAFT', State: 'OFF', Statistics: { Impressions: 0, Clicks: 0 } },
          ad: { Status: 'DRAFT', State: 'OFF' }, group: {}, targeting: {}, keyword: {} },
      };
      db.directTransaction(() => {
        db.saveDirect(owner, draft);
        save(owner, { phase: 'draft' });
      });
    } finally { unlock(); }
  }
  return {
    start, view: (owner: string) => pilot.view(owner, workspace),
    action: (owner: string, form: URLSearchParams, actor: string) => pilot.action(owner, workspace, form, actor),
  };
}
