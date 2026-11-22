import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { openDatabase } from './database.ts';
import type { PilotState } from './pilot.ts';
import { directCalendarDate, minimumPeriodBudget } from './campaign.ts';
import type { CampaignDraft } from './campaign.ts';
import { DirectError, DirectApiError, directId, targeting } from './direct-api.ts';
import { verifyOwnChief } from './direct-connect.ts';
import type { DirectApi } from './direct-api.ts';
import { phraseKey, selectionVersion, foreignGeography } from './search-phrases.ts';
import type { PhrasePlan, Wordstat } from './search-phrases.ts';
import { planCurrent } from './campaign-plan.ts';
import type { PhraseIntelligence } from './phrase-intelligence.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { defaultCampaignId } from './campaign-workspaces.ts';
import { createDirectLifecycle, directTraffic } from './direct-launch.ts';
import type { DirectLaunchObservation, DirectLaunchOptions, DirectLaunchState } from './direct-launch.ts';
import type { CampaignOptimization } from './campaign-optimization.ts';
import type { CampaignExperiment } from './campaign-experiment.ts';
import type { CampaignCreativeReview } from './campaign-creative-review.ts';
import type { NextPeriod } from './campaign-next-period.ts';

export const stepNames = { campaign: 'Кампания', group: 'Группа', targeting: 'Автотаргетинг', keyword: 'Поисковые фразы', ad: 'Объявление' };
type Step = keyof typeof stepNames;
type Phase = 'ready' | 'pending' | 'confirmed';
export type DirectEvent = { id: string; kind: 'create' | 'rename' | 'undo'; phase: Phase | 'conflict' | 'rejected'; at: string; actor: string;
  before: string; after: string; related?: string; undoneBy?: string; error?: string };
export type DirectState = {
  storageRevision?: number;
  guidedDraft?: true;
  pilot?: PilotState;
  launch?: DirectLaunchState;
  optimization?: CampaignOptimization;
  experiments?: CampaignExperiment[];
  creativeReview?: CampaignCreativeReview;
  nextPeriods?: NextPeriod[];
  safeToContinue?: boolean;
  budget?: { kind: 'custom_period'; amountRub: string; spendLimitMicros: string; periodDays: string; startDate: string; endDate: string; autoContinue: 'NO' };
  frozenPlan?: unknown;
  attempts?: { id: string; stepKey: string; requestHash: string; resource: string; method: string; at: string; outcome: string; code?: string; requestId?: string }[];
  account: string; planId: string; campaignPlanId?: string; campaignId?: string; draft: CampaignDraft; revision: number; name: string; groupName: string;
  regionId: string; regionName: string; weekly: string; keyword: string; startDate: string;
  steps: Record<Step, { phase: Phase; id?: string }>; events: DirectEvent[]; targetingBefore?: unknown;
  snapshot?: Record<Step, any>; checkedAt?: string; error?: string; complete: boolean;
  keywordEntries?: { phrase: string; phase: Phase; id?: string }[]; negatives?: string[]; phrasePlan?: PhrasePlan;
};
export type DirectConnection = { api: DirectApi; owner: string; account: string; login?: string; mode: 'live' | 'fixture'; ownChief?: boolean; generation?: number; needsReconcile?: boolean; reconcileRunId?: string };
export type DirectView = { enabled: boolean; account?: string; mode?: 'live' | 'fixture'; state?: DirectState; runs?: DirectState[]; ownChief?: boolean; needsReconcile?: boolean; blockedCampaignId?: string; phrasePlan?: PhrasePlan; wordstatEnabled?: boolean; intelligenceEnabled?: boolean;
  generation?: number;
  input?: { action: string; name: string; weekly: string; keyword: string; startDate?:string;offer?: string; negatives?: string; additional?: string; selected?: string[] } };

export function campaignWorkspaceRun(runs: readonly DirectState[] | undefined, guided?: boolean) {
  return (guided ? runs?.findLast(run => run.guidedDraft) : undefined) ??
    runs?.findLast(run => !run.guidedDraft && run.complete && run.steps.campaign.phase === 'confirmed' && run.steps.campaign.id);
}
const steps = Object.keys(stepNames) as Step[];
const today = () => directCalendarDate();
const future = () => directCalendarDate(7);
const fail = (message: string): never => { throw new DirectError(message); };
const one = (form: URLSearchParams, key: string) => form.getAll(key).length === 1 ? form.get(key)!.trim() : '';
const line = (value: string, max: number) => value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const sameId = (a: unknown, b: unknown) => directId(a) === directId(b);
const freshEvent = (kind: DirectEvent['kind'], actor: string, before: string, after: string): DirectEvent =>
  ({ id: randomUUID(), kind, actor, before, after, phase: 'ready', at: new Date().toISOString() });
export function confirmedOffDraft(state?: DirectState) {
  const c = state?.snapshot?.campaign, ad = state?.snapshot?.ad;
  return Boolean(state?.complete && !state.launch?.budget && state.checkedAt && !state.error && !hasUnresolvedDirect(state) &&
    c?.Status === 'DRAFT' && c.State === 'OFF' && String(c.Statistics?.Impressions) === '0' && String(c.Statistics?.Clicks) === '0' &&
    ad?.Status === 'DRAFT' && ad.State === 'OFF');
}
function hasUnconfirmedWrite(state: DirectState) {
  const latest = new Map((state.attempts ?? []).map(attempt => [attempt.stepKey, attempt]));
  return steps.some(step => !(step === 'keyword' && state.keywordEntries) && state.steps[step].phase === 'pending') ||
    state.keywordEntries?.some(entry => entry.phase === 'pending') ||
    [...latest.values()].some(attempt => ['pending', 'unknown'].includes(attempt.outcome));
}

export function createDirectService(db: ReturnType<typeof openDatabase>, connection: DirectConnection, wordstat?: Wordstat, intelligence?: PhraseIntelligence, launch?: DirectLaunchOptions) {
  const { api, account } = connection;
  const accountRuns = (owner: string) => db.readDirectRuns(owner).filter(run => run.account === account);
  const scopedRun = (owner: string, campaignId: string) => db.readCampaignDirectRuns(owner, campaignId).findLast(run => run.account === account);
  const blockingRun = (owner: string, except?: string) =>
    accountRuns(owner).find(run => run.planId !== except && hasUnresolvedDirect(run));
  async function accountCheck(withVat = false) {
    const clients = await api.list('clients', { FieldNames: ['ClientId', 'Login', 'Representatives', 'Type', 'Archived', 'Currency', 'Grants', 'AvailableCampaignTypes', 'ForbiddenPlatform', ...(withVat ? ['VatRate'] : [])] }, 'Clients');
    const c = clients[0];
    if (clients.length !== 1 || !sameId(c.ClientId, account) || c.Type !== 'CLIENT' || c.Archived !== 'NO' || c.Currency !== 'RUB' || c.ForbiddenPlatform !== 'NONE' ||
      !c.AvailableCampaignTypes?.includes('UNIFIED_CAMPAIGN') || !c.Grants?.some((g: any) => g.Privilege === 'EDIT_CAMPAIGNS' && g.Value === 'YES')) fail('Кабинет или права Директа не соответствуют подключению.');
    if (connection.ownChief) verifyOwnChief(c);
    return c;
  }
  async function prepare(owner: string, form: URLSearchParams, actor: string, guided = false) {
    const confirmed = db.readPlan(owner, one(form, 'campaignPlanId'));
    if (Boolean(confirmed?.directDraft) !== guided) fail('Откройте актуальный экран создания черновика.');
    const campaignId = confirmed?.campaignId ?? defaultCampaignId;
    if (form.has('campaignId') && one(form, 'campaignId') !== campaignId) fail('Этот план относится к другой кампании.');
    const existing = scopedRun(owner, campaignId);
    if (blockingRun(owner)) fail('Есть незавершённая операция Директа. Сначала сверить её результат; новый набор не создаётся.');
    if (existing && steps.some(s => existing.steps[s].phase !== 'ready') && !(existing.complete && connection.ownChief && one(form,'newRun')==='yes')) fail('Создание уже начато. Используйте сверку или продолжение; новый набор не создаётся.');
    const saved = db.readCampaign(owner, campaignId);
    if (!saved || (!guided && String(saved.revision) !== one(form, 'revision'))) fail('Сначала сохраните и проверьте актуальный черновик.');
    const weekly = one(form, 'weekly'), name = confirmed?.directDraft?.name ?? one(form, 'name');
    if (!planCurrent(confirmed, db.readPreparation(owner, campaignId), saved)) fail('Сначала подтвердите актуальный план в мастере подготовки.');
    const phrasePlan = db.readPhrasePlan(owner, campaignId);
    if (!phrasePlan || phrasePlan.id !== confirmed!.id || phrasePlan.revision !== saved.revision) fail('Подтверждённый список изменился. Проверьте план заново.');
    const selected = [...confirmed!.phrases], negatives = [...confirmed!.negatives], keyword = selected[0];
    if ((form.has('keyword') && one(form, 'keyword') !== keyword) ||
        (form.has('selected') && !isDeepStrictEqual(form.getAll('selected'), selected)) ||
        (form.has('additional') && one(form, 'additional')) || (form.has('negatives') && !isDeepStrictEqual(one(form, 'negatives').split(/\r?\n/).filter(Boolean), negatives))) fail('Параметры фраз отличаются от подтверждённого плана.');
    if (!connection.ownChief && (!/^\d{1,6}$/.test(weekly) || Number(weekly) < 300 || Number(weekly) > 100000)) fail('Укажите недельный бюджет API от 300 до 100 000 ₽ целым числом.');
    if (!line(keyword, 100) || keyword === '---autotargeting') fail('В подтверждённом плане нужна поисковая фраза от 1 до 100 символов, без служебного автотаргетинга. Исправьте список фраз и подтвердите план заново.');
    if (!line(name, 100)) fail('Укажите название кампании от 1 до 100 символов в одну строку.');
    await accountCheck();
    const regions = await api.list('dictionaries', { DictionaryNames: ['GeoRegions'] }, 'GeoRegions');
    const matching = regions.filter((r: any) => r.GeoRegionName?.toLocaleLowerCase('ru') === saved.draft.region.toLocaleLowerCase('ru'));
    if (matching.length !== 1) fail('География не определена однозначно. Укажите в черновике точное название города или региона из Директа и сохраните.');
    if (selected.some(p => foreignGeography(p, directId(matching[0].GeoRegionId), regions))) fail('Выбранная фраза содержит другой регион. Уберите её из списка или уточните географию кампании.');
    const currencies = await api.list('dictionaries', { DictionaryNames: ['Currencies'] }, 'Currencies');
    const limits = currencies.filter((c: any) => c.Currency === 'RUB').flatMap((c: any) => c.Properties ?? []).filter((p: any) => p.Name === 'MinimumWeeklySpendLimit');
    if (!connection.ownChief && (limits.length !== 1 || !/^\d+$/.test(String(limits[0].Value)) || BigInt(limits[0].Value) <= 0n || BigInt(limits[0].Value) > BigInt(weekly) * 1000000n)) fail('Недельный бюджет не подтверждён текущими ограничениями Директа.');
    const startDate = confirmed?.directDraft?.startDate ?? (connection.ownChief ? one(form,'startDate') || future() : future());
    let budget: DirectState['budget'];
    if (connection.ownChief) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0,10)!==startDate || startDate<=today()) fail('Выберите полный будущий день начала.');
      const days=Number(saved.draft.period), amount=BigInt(saved.draft.budget);
      if (![7,30].includes(days) || amount<BigInt(minimumPeriodBudget(days))) fail(`Для ${days} дней нужно не менее ${minimumPeriodBudget(days)} ₽. Исправьте бюджет и подтвердите план заново; новые платные запросы не нужны.`);
      budget={kind:'custom_period',amountRub:saved.draft.budget,spendLimitMicros:String(amount*1000000n),periodDays:saved.draft.period,startDate,endDate:new Date(Date.parse(startDate)+(days-1)*86400000).toISOString().slice(0,10),autoContinue:'NO'};
    }
    const id = randomUUID();
    const state: DirectState = {
      account, planId: id, campaignPlanId: confirmed!.id, campaignId, draft: saved.draft, revision: saved.revision,
      name: `${name} [${id}]`, groupName: `Группа ${id}`, regionId: directId(matching[0].GeoRegionId), regionName: matching[0].GeoRegionName,
      weekly, keyword, startDate, ...(guided ? { guidedDraft: true } : {}),
      ...(budget?{budget,frozenPlan:structuredClone(confirmed),attempts:[]}:{}), steps: Object.fromEntries(steps.map(s => [s, { phase: 'ready' }])) as DirectState['steps'],
      ...(phrasePlan ? { phrasePlan, keywordEntries: selected.map(phrase => ({ phrase, phase: 'ready' as const })), negatives } : {}),
      events: [], complete: false,
    };
    db.directTransaction(()=>{
      checkCurrentPlan(owner,state);
      if (guided && db.readCampaignDirectRuns(owner, campaignId).length) fail('Для этой кампании уже есть операция создания. Откройте её состояние.');
      if (!isDeepStrictEqual(db.readPhrasePlan(owner, campaignId),phrasePlan)) fail('Подтверждённый список изменился. Проверьте план заново.');
      if (phrasePlan) {
        for (const c of phrasePlan.candidates) c.selected = selected.includes(c.phrase);
        for (const phrase of selected.filter(p => !phrasePlan!.candidates.some(c => c.phrase === p))) {
          phrasePlan.candidates.push({ phrase, count: null, source: 'business', selected: true, reason: 'Добавлено вручную; спрос и частотность не проверены.' });
        }
        db.savePhrasePlan(owner, phrasePlan, campaignId);
      }
      state.events.push(freshEvent('create', actor, 'Объекты отсутствуют', state.name));
      db.saveDirect(owner,state);
    });
    return campaignId;
  }
  async function readSnapshot(state: DirectState, forLaunch = false) {
    const selection = state.steps.campaign.id ? { Ids: [BigInt(state.steps.campaign.id)] } : { Types: ['UNIFIED_CAMPAIGN'] };
    const cs = await api.list('campaigns', { SelectionCriteria: selection, FieldNames: ['Id', 'Name', 'Type', 'Status', 'State', 'StartDate', 'Statistics', ...(state.budget?['EndDate','TimeZone']:[])], UnifiedCampaignFieldNames: forLaunch ? ['BiddingStrategy', 'PackageBiddingStrategy'] : ['BiddingStrategy'] }, 'Campaigns');
    const matches = state.steps.campaign.id ? cs : cs.filter((c: any) => c.Name === state.name);
    if (matches.length > 1) fail('Найдены дубликаты кампании. Нужна ручная сверка; запись остановлена.');
    const campaign = matches[0];
    if (!campaign) return { campaign: null, group: null, targeting: null, keyword: null, ad: null, keywords: [] };
    directId(campaign.Id);
    const filter = { CampaignIds: [BigInt(directId(campaign.Id))] };
    const groups = await api.list('adgroups', { SelectionCriteria: filter, FieldNames: ['Id', 'CampaignId', 'Name', 'RegionIds', 'Type', 'Status', 'NegativeKeywords'], UnifiedAdGroupFieldNames: ['OfferRetargeting'], Page: { Limit: 10 } }, 'AdGroups');
    const ads = await api.list('ads', { SelectionCriteria: filter, FieldNames: ['Id', 'CampaignId', 'AdGroupId', 'Type', 'Status', 'State', 'StatusClarification'], ResponsiveAdFieldNames: ['Titles', 'Texts', 'Href'], Page: { Limit: 10 } }, 'Ads');
    const keywords = await api.list('keywords', { SelectionCriteria: filter, FieldNames: ['Id', 'CampaignId', 'AdGroupId', 'Keyword', 'State'],
      AutotargetingSettingsCategoriesFieldNames: Object.keys(targeting.Categories), AutotargetingSettingsBrandOptionsFieldNames: Object.keys(targeting.BrandOptions), Page: { Limit: 200 } }, 'Keywords');
    const expected = (state.keywordEntries?.map(k => k.phrase) ?? [state.keyword]).map(phraseKey);
    const ordinary = keywords.filter(k => k.Keyword !== '---autotargeting');
    if (groups.length > 1 || ads.length > 1 || keywords.length > expected.length + 1 || keywords.filter(k => k.Keyword === '---autotargeting').length > 1 ||
      new Set(ordinary.map(k => phraseKey(k.Keyword))).size !== ordinary.length || ordinary.some(k => !expected.includes(phraseKey(k.Keyword)))) fail('Обнаружены посторонние объекты или дубликаты.');
    return { campaign, group: groups[0] ?? null, ad: ads[0] ?? null,
      targeting: keywords.find(k => k.Keyword === '---autotargeting') ?? null, keyword: ordinary.find(k => phraseKey(k.Keyword) === phraseKey(state.keyword)) ?? null, keywords: ordinary };
  }
  function validate(state: DirectState, snapshot: Record<Step, any>, names: string[], forLaunch = false) {
    const c = snapshot.campaign;
    if (!c) {
      if (state.steps.campaign.phase === 'confirmed') fail('Подтверждённая кампания отсутствует в API.');
      return;
    }
    const strategy = c.UnifiedCampaign?.BiddingStrategy;
    const off = state.guidedDraft ? ['OFF'] : ['OFF', 'SUSPENDED'];
    if (!names.includes(c.Name) || c.Type !== 'UNIFIED_CAMPAIGN' || c.StartDate !== state.startDate ||
      (!forLaunch && (c.Status !== 'DRAFT' || !off.includes(c.State) ||
        String(c.Statistics?.Clicks) !== '0' || String(c.Statistics?.Impressions) !== '0')) ||
      (forLaunch && c.UnifiedCampaign?.PackageBiddingStrategy !== null) ||
      strategy?.Network?.BiddingStrategyType !== 'SERVING_OFF' ||
      strategy?.Search?.BiddingStrategyType !== 'WB_MAXIMUM_CLICKS') fail('Конфликт: название, статус, статистика или параметры кампании изменились в Директе. Запись остановлена.');
    const actualBudget=strategy?.Search?.WbMaximumClicks;
    if (state.budget) {
      const b=actualBudget?.CustomPeriodBudget;
      if (!b || String(b.SpendLimit)!==state.budget.spendLimitMicros || b.StartDate!==state.budget.startDate || b.EndDate!==state.budget.endDate || b.AutoContinue!=='NO' || c.TimeZone!=='Europe/Moscow' || c.EndDate!==state.budget.endDate) fail('Периодный бюджет, даты или часовой пояс не подтверждены API. Недельный бюджет не подставляется.');
    } else if (String(actualBudget?.WeeklySpendLimit)!==String(BigInt(state.weekly)*1000000n)) fail('Недельный бюджет прежнего набора изменился в Директе.');
    for (const step of steps) {
      if (step === 'keyword' && state.keywordEntries) continue;
      const object = snapshot[step], entry = state.steps[step];
      if (!object) { if (entry.phase === 'confirmed') fail(`Подтверждённый объект отсутствует: ${stepNames[step]}.`); continue; }
      const id = directId(object.Id);
      if (entry.id && id !== entry.id) fail(`ID объекта изменился: ${stepNames[step]}.`);
      if (step === 'campaign') {
        if (entry.phase === 'ready') fail('Кампания появилась без намерения в журнале. Запись остановлена.');
        continue;
      }
      if (!sameId(object.CampaignId, c.Id)) fail('Объект принадлежит другой кампании.');
      if (step === 'group') {
        if (object.Name !== state.groupName || object.Type !== 'UNIFIED_AD_GROUP' || (!forLaunch && object.Status !== 'DRAFT') || object.RegionIds?.length !== 1 ||
          !sameId(object.RegionIds[0], state.regionId) || object.UnifiedAdGroup?.OfferRetargeting !== 'NO') fail('Конфликт параметров группы.');
        if (!isDeepStrictEqual([...(object.NegativeKeywords?.Items ?? [])].sort(), [...(state.negatives ?? [])].sort())) fail('Минус-фразы группы изменились снаружи.');
      } else {
        if (!snapshot.group || !sameId(object.AdGroupId, snapshot.group.Id)) fail('Объект принадлежит другой группе.');
        if (step === 'ad') {
          if (object.Type !== 'RESPONSIVE_AD' || (!forLaunch && (object.Status !== 'DRAFT' || !off.includes(object.State))) ||
            object.ResponsiveAd?.Href !== state.draft.url || object.ResponsiveAd?.Titles?.length !== 1 || object.ResponsiveAd?.Texts?.length !== 1 ||
            object.ResponsiveAd.Titles[0].Title !== state.draft.title || object.ResponsiveAd.Texts[0].Text !== state.draft.adText) fail('Конфликт текста, ссылки или состояния объявления.');
        } else if (!['ON', 'OFF'].includes(object.State)) fail('Небезопасное состояние нацеливания.');
      }
      if (step !== 'targeting' && entry.phase === 'ready') fail('Объект появился без записи в журнале. Нужна сверка.');
      if (step === 'targeting' && entry.phase === 'confirmed' && !isDeepStrictEqual(object.AutotargetingSettings, targeting)) fail('Настройки автотаргетинга изменились снаружи.');
      if (step === 'targeting' && entry.phase === 'pending' && !isDeepStrictEqual(object.AutotargetingSettings, targeting) &&
        !isDeepStrictEqual(object.AutotargetingSettings, state.targetingBefore)) fail('Конфликт незавершённого автотаргетинга. Внешние настройки сохранены.');
    }
    for (const entry of state.keywordEntries ?? []) {
      const object = snapshot.keywords?.find(k => phraseKey(k.Keyword) === phraseKey(entry.phrase));
      if (!object) { if (entry.phase === 'confirmed') fail('Подтверждённая поисковая фраза отсутствует в API.'); continue; }
      if (entry.phase === 'ready') fail('Фраза появилась без намерения в журнале.');
      if ((entry.id && directId(object.Id) !== entry.id) || !sameId(object.CampaignId, c.Id) || !snapshot.group ||
        !sameId(object.AdGroupId, snapshot.group.Id) || !['ON', 'OFF'].includes(object.State)) fail('Конфликт ID, связей или состояния поисковой фразы.');
    }
  }
  function expectedName(state: DirectState) {
    return [...state.events].reverse().find(e => ['rename', 'undo'].includes(e.kind) && e.phase === 'confirmed')?.after ?? state.name;
  }
  async function observeLaunch(state: DirectState, strict: boolean, readAd = true): Promise<DirectLaunchObservation> {
    let campaign, ad;
    if (strict) {
      const scope = await readSnapshot(state, true);
      validate(state, scope, [expectedName(state)], true);
      campaign = scope.campaign; ad = scope.ad;
      if (!campaign || !ad) return fail('Не подтверждены кампания и объявление для запуска.');
    } else {
      const [reported, ...others] = await api.list('campaigns', {
        SelectionCriteria: { Ids: [BigInt(state.steps.campaign.id!)] }, FieldNames: ['Id', 'Status', 'State', 'Type', 'Statistics'],
      }, 'Campaigns');
      if (!reported || others.length || !sameId(reported.Id, state.steps.campaign.id) || reported.Type !== 'UNIFIED_CAMPAIGN')
        return fail('Директ не подтвердил идентификатор ЕПК.');
      campaign = reported;
      if (readAd) {
        try {
          const [reportedAd, ...otherAds] = await api.list('ads', {
            SelectionCriteria: { Ids: [BigInt(state.steps.ad.id!)] }, FieldNames: ['Id', 'CampaignId', 'AdGroupId', 'Status', 'State', 'Type', 'StatusClarification'],
          }, 'Ads');
          if (reportedAd && !otherAds.length && sameId(reportedAd.Id, state.steps.ad.id) && sameId(reportedAd.CampaignId, campaign.Id) &&
            sameId(reportedAd.AdGroupId, state.steps.group.id) && reportedAd.Type === 'RESPONSIVE_AD') ad = reportedAd;
        } catch (error) {
          if (!(error instanceof DirectError)) throw error;
        }
      }
    }
    if (typeof campaign.Status !== 'string' || typeof campaign.State !== 'string') return fail('Директ вернул неполное состояние кампании.');
    return { campaignStatus: campaign.Status, campaignState: campaign.State,
      adStatus: typeof ad?.Status === 'string' ? ad.Status : undefined,
      adState: typeof ad?.State === 'string' ? ad.State : undefined,
      ...(ad?.Status === 'REJECTED' && typeof ad.StatusClarification === 'string' ? { adStatusClarification: ad.StatusClarification } : {}),
      ...directTraffic(campaign.Statistics), checkedAt: new Date().toISOString() };
  }
  async function snapshot(owner: string, state: DirectState, names = [expectedName(state)]) {
    state.snapshot = await readSnapshot(state);
    state.checkedAt = new Date().toISOString();
    db.saveDirect(owner, state); // Keep actual state even when validation reports an external conflict.
    validate(state, state.snapshot, names);
    return state.snapshot;
  }
  const ready = (s: Record<Step, any>, step: Step) => Boolean(s[step]) && (step !== 'targeting' || isDeepStrictEqual(s.targeting.AutotargetingSettings, targeting));
  async function confirmStep(owner: string, state: DirectState, step: Step) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = await snapshot(owner, state);
      if (ready(s, step)) {
        state.steps[step] = { phase: 'confirmed', id: directId(s[step].Id) }; confirmAttempt(state,step); db.saveDirect(owner, state); return;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 350));
    }
    fail(`${stepNames[step]}: результат пока неизвестен. Выполните сверку позже. Запись автоматически не повторяется.`);
  }
  function checkCurrentPlan(owner: string, state: DirectState) {
    const campaignId = state.campaignId ?? defaultCampaignId;
    const plan = db.readPlan(owner, state.campaignPlanId);
    if (!plan || (plan.campaignId ?? defaultCampaignId) !== campaignId ||
        !planCurrent(plan, db.readPreparation(owner, campaignId), db.readCampaign(owner, campaignId))) fail('План изменился. Подтвердите актуальную подготовку перед новым созданием.');
  }
  function confirmAttempt(state: DirectState, key: string) { const a=state.attempts?.findLast(a=>a.stepKey===key); if(a)a.outcome='confirmed'; }
  function settleInitialCreateFailure(state: DirectState) {
    // A known first-add failure created no objects. Unknown or partial runs keep their pending event.
    const event=state.events[0], attempts=state.attempts??[];
    if (event?.kind!=='create' || event.phase!=='pending' || state.complete || state.snapshot?.campaign!==null || (!state.guidedDraft && !attempts.length) ||
        !attempts.every(a=>a.stepKey==='campaign' && a.resource==='campaigns' && a.method==='add' && ['rejected','not_sent'].includes(a.outcome)) ||
        !steps.every(s=>state.steps[s].phase==='ready' && !state.steps[s].id) ||
        state.keywordEntries?.some(k=>k.phase!=='ready' || k.id)) return;
    event.phase='rejected';
  }
  async function writeObject(owner: string,state:DirectState,key:string,resource:string,method:string,params:object,notSent:(outcome: 'not_sent' | 'rejected')=>void,beforeDispatch?:()=>void) {
    const attempt={id:randomUUID(),stepKey:key,resource,method,at:new Date().toISOString(),outcome:'pending',requestHash:createHash('sha256').update(JSON.stringify({method,params},(_k,v)=>typeof v==='bigint'?JSON.rawJSON(String(v)):v)).digest('hex'),code:undefined as string|undefined,requestId:undefined as string|undefined};
    if(connection.ownChief) {
      db.directTransaction(()=>{ if(key==='campaign')checkCurrentPlan(owner,state); (state.attempts??=[]).push(attempt); db.saveDirect(owner,state); });
    }
    try { const id=await api.write(resource,method,params,connection.ownChief?{owner,runId:state.planId,attemptId:attempt.id,beforeDispatch}:undefined); attempt.outcome='unknown';attempt.requestId=api.lastRequestId; return id; }
    catch(error) {
      if(connection.ownChief&&error instanceof DirectApiError) { attempt.outcome=error.outcome;attempt.code=error.code;attempt.requestId=error.requestId;if(error.outcome==='not_sent'||error.outcome==='rejected')notSent(error.outcome);settleInitialCreateFailure(state);db.saveDirect(owner,state); }
      throw error;
    }
  }
  async function create(owner: string, state: DirectState, write: boolean) {
    const event = state.events[0];
    if (write && steps.every(s => state.steps[s].phase === 'ready')) checkCurrentPlan(owner, state);
    if (write && state.phrasePlan && state.phrasePlan.selectionVersion !== selectionVersion) fail('Правила отбора обновлены. Проверьте сохранённый подбор и подтвердите исправленные фразы перед созданием.');
    if (write && state.phrasePlan?.strategy && state.phrasePlan.strategy.phase !== 'complete') fail('Исследование спроса ещё не завершено.');
    if (write && state.phrasePlan && !state.phrasePlan.strategy && !state.phrasePlan.manualSelectionConfirmed) fail('Прежний список не подтверждён как ручной. Подготовьте новую стратегию или явно проверьте ручной список.');
    if (write && steps.every(s => state.steps[s].phase === 'ready') && db.readCampaign(owner, state.campaignId)?.revision !== state.revision) fail('Сохранённый черновик изменился. Подготовьте актуальные параметры заново.');
    if (write && steps.every(s => state.steps[s].phase === 'ready') && state.phrasePlan && db.readPhrasePlan(owner, state.campaignId)?.id !== state.phrasePlan.id) fail('Подбор изменился. Подтвердите актуальные фразы перед созданием.');
    for (const step of steps) {
      if (step === 'keyword' && state.keywordEntries) {
        for (const phrase of state.keywordEntries) {
          if (phrase.phase === 'ready' && write) {
            await snapshot(owner, state);
            if (state.startDate <= today()) fail('Дата начала уже наступила. Новые записи остановлены; нужна проверка условий.');
            phrase.phase = 'pending'; state.steps.keyword.phase = 'pending'; event.phase = 'pending'; db.saveDirect(owner, state);
            phrase.id = await writeObject(owner,state,`phrase:${phrase.phrase}`,'keywords', 'add', { Keywords: [{ AdGroupId: BigInt(state.steps.group.id!), Keyword: phrase.phrase }] },()=>{phrase.phase='ready';});
            db.saveDirect(owner, state);
          }
          if (phrase.phase === 'pending') {
            let confirmed = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              const s = await snapshot(owner, state);
              const found = s.keywords?.find(k => phraseKey(k.Keyword) === phraseKey(phrase.phrase));
              if (found) { phrase.id = directId(found.Id); phrase.phase = 'confirmed'; confirmAttempt(state,`phrase:${phrase.phrase}`); confirmed = true; db.saveDirect(owner, state); break; }
              if (attempt < 2) await new Promise(r => setTimeout(r, 350));
            }
            if (!confirmed) fail('Поисковая фраза: результат пока неизвестен. Сверьте позже; запись не повторяется.');
          }
        }
        const complete = state.keywordEntries.every(k => k.phase === 'confirmed');
        state.steps.keyword = { phase: complete ? 'confirmed' : state.keywordEntries.some(k => k.phase !== 'ready') ? 'pending' : 'ready', ...(complete ? { id: state.keywordEntries[0].id } : {}) };
        db.saveDirect(owner, state);
        if (!complete) break;
        continue;
      }
      const entry = state.steps[step];
      if (entry.phase === 'pending') await confirmStep(owner, state, step);
      if (state.steps[step].phase !== 'ready') continue;
      if (!write) break;
      const s = await snapshot(owner, state);
      if (state.startDate <= today()) fail('Дата начала уже наступила. Новые записи остановлены; нужна проверка условий.');
      let resource: string, params: object, method = 'add';
      if (step === 'campaign') {
        resource = 'campaigns'; params = { Campaigns: [{ Name: state.name, StartDate: state.startDate, ...(state.budget?{EndDate:state.budget.endDate,TimeZone:'Europe/Moscow'}:{}), UnifiedCampaign: { BiddingStrategy: {
          Search: { BiddingStrategyType: 'WB_MAXIMUM_CLICKS', WbMaximumClicks: state.budget?{CustomPeriodBudget:{SpendLimit:BigInt(state.budget.spendLimitMicros),StartDate:state.budget.startDate,EndDate:state.budget.endDate,AutoContinue:'NO'}}:{ WeeklySpendLimit: BigInt(state.weekly) * 1000000n } }, Network: { BiddingStrategyType: 'SERVING_OFF' },
        } } }] };
      } else if (step === 'group') {
        resource = 'adgroups'; params = { AdGroups: [{ Name: state.groupName, CampaignId: BigInt(state.steps.campaign.id!), RegionIds: [BigInt(state.regionId)], ...(state.negatives?.length ? { NegativeKeywords: { Items: state.negatives } } : {}), UnifiedAdGroup: { OfferRetargeting: 'NO' } }] };
      } else if (step === 'targeting') {
        resource = 'keywords'; method = s.targeting ? 'update' : 'add';
        state.targetingBefore = s.targeting?.AutotargetingSettings ?? null;
        if (s.targeting) entry.id = directId(s.targeting.Id);
        params = { Keywords: [{ ...(s.targeting ? { Id: BigInt(entry.id!) } : { AdGroupId: BigInt(state.steps.group.id!), Keyword: '---autotargeting' }), AutotargetingSettings: targeting }] };
      } else if (step === 'keyword') {
        resource = 'keywords'; params = { Keywords: [{ AdGroupId: BigInt(state.steps.group.id!), Keyword: state.keyword }] };
      } else {
        resource = 'ads'; params = { Ads: [{ AdGroupId: BigInt(state.steps.group.id!), ResponsiveAd: { Titles: [state.draft.title], Texts: [state.draft.adText], Href: state.draft.url } }] };
      }
      if (step === 'campaign') checkCurrentPlan(owner, state);
      entry.phase = 'pending'; event.phase = 'pending'; db.saveDirect(owner, state);
      entry.id = await writeObject(owner,state,step,resource,method,params,()=>{entry.phase='ready';}); db.saveDirect(owner, state);
      await confirmStep(owner, state, step);
    }
    await snapshot(owner, state);
    state.complete = steps.every(s => state.steps[s].phase === 'confirmed');
    if (state.complete) event.phase = 'confirmed';
    else settleInitialCreateFailure(state);
    db.saveDirect(owner, state);
  }
  async function guidedDraft(owner: string, action: string, form: URLSearchParams, actor: string) {
    if (!connection.ownChief || connection.generation === undefined ||
        one(form, 'account') !== account || one(form, 'generation') !== String(connection.generation))
      fail('Кабинет или доступ изменились. Откройте кампанию и проверьте подключение.');
    const campaignId = one(form, 'campaignId');
    const runs = db.readCampaignDirectRuns(owner, campaignId);
    let state = runs.findLast(run => run.guidedDraft && run.account === account);
    if (state?.pilot) fail('Кампания уже передана в учебный запуск. Проверяйте её состояние на экране запуска.');
    if (state?.launch?.budget) fail('Для этой кампании открыт допуск к показам. Сверьте её на экране «Сводка».');
    const checking = action === 'guided-refresh';
    if (checking) {
      if (!state || state.planId !== one(form, 'planId')) fail('Операция изменилась. Откройте кампанию.');
    } else {
      const saved = db.readPreparation(owner, campaignId);
      const plan = db.readPlan(owner, one(form, 'campaignPlanId'), campaignId);
      if (one(form, 'confirm') !== 'yes' || !saved || !plan?.directDraft ||
          one(form, 'preparationRevision') !== String(saved.revision) || saved.value.confirmedPlanId !== plan.id ||
          !planCurrent(plan, saved, db.readCampaign(owner, campaignId))) fail('Подтвердите актуальный план и кабинет перед созданием.');
      if (state?.campaignPlanId === plan.id && confirmedOffDraft(state)) return campaignId;
      if (connection.needsReconcile || blockingRun(owner, state?.planId)) fail('Сначала сверьте незавершённую операцию Директа.');
      if (action === 'guided-continue') {
        if (!state || state.campaignPlanId !== plan.id || state.planId !== one(form, 'planId') ||
          one(form, 'storageRevision') !== String(state.storageRevision) || !state.safeToContinue || hasUnconfirmedWrite(state) || state.complete)
          fail('Сначала сверьте созданные объекты. Не подтверждённая запись не будет отправлена повторно.');
      } else {
        if (runs.length) fail('Для этой кампании уже есть операция создания. Сверьте её состояние.');
        await prepare(owner, form, actor, true);
        state = scopedRun(owner, campaignId);
      }
    }
    if (!state) fail('Операция создания не найдена.');
    state!.safeToContinue = false;
    db.saveDirect(owner, state!);
    try {
      await accountCheck();
      const pendingRename = checking && state.events.find(event => event.kind !== 'create' && event.phase === 'pending');
      if (pendingRename) await confirmRename(owner, state, pendingRename);
      else {
        if (checking) restoreUnsentDraftSteps(owner, state);
        await create(owner, state, !checking);
      }
      state!.safeToContinue = checking && !state!.complete && !hasUnconfirmedWrite(state!) && state!.startDate > today();
      delete state!.error;
    } catch (error) {
      state!.error = error instanceof DirectError ? error.message : 'Не удалось проверить состояние. Сверьте Директ перед продолжением.';
      throw error instanceof DirectApiError ? error : new DirectError(state!.error);
    } finally {
      db.saveDirect(owner, state!);
    }
    return campaignId;
  }
  function restoreUnsentDraftSteps(owner: string, state: DirectState) {
    const latest = new Map((state.attempts ?? []).map(attempt => [attempt.stepKey, attempt]));
    const dispatched = new Set(db.directDispatches(owner, state.planId).map(row => row.id));
    const restore = (entry: { phase: Phase; id?: string }, key: string) => {
      if (entry.phase !== 'pending') return;
      const attempt = latest.get(key);
      if (!attempt || ['rejected', 'not_sent'].includes(attempt.outcome) ||
          (['pending', 'unknown'].includes(attempt.outcome) && !dispatched.has(attempt.id))) {
        entry.phase = 'ready';
        if (attempt && ['pending', 'unknown'].includes(attempt.outcome)) attempt.outcome = 'not_sent';
      }
    };
    for (const step of steps) {
      if (step !== 'keyword' || !state.keywordEntries) restore(state.steps[step], step);
    }
    for (const entry of state.keywordEntries ?? []) restore(entry, `phrase:${entry.phrase}`);
    db.saveDirect(owner, state);
  }
  async function confirmRename(owner: string, state: DirectState, event: DirectEvent) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = await snapshot(owner, state, [event.before, event.after]);
      if (s.campaign?.Name === event.after) {
        event.phase = 'confirmed'; delete event.error;
        confirmAttempt(state,event.id);
        if (event.related) state.events.find(e => e.id === event.related)!.undoneBy = event.id;
        db.saveDirect(owner, state); return;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 350));
    }
    fail('Изменение названия пока не подтверждено чтением. Сверьте результат позже; запись не повторяется.');
  }
  async function rename(owner: string, state: DirectState, form: URLSearchParams, actor: string, undo: boolean) {
    if (!state.complete) fail('Сначала завершите создание и сверку всех объектов.');
    const pending = state.events.find(e => e.kind !== 'create' && e.phase === 'pending');
    if (pending) { await confirmRename(owner, state, pending); return; }
    const target = undo ? state.events.find(e => e.id === one(form, 'id') && e.kind === 'rename' && e.phase === 'confirmed') : undefined;
    if (undo && !target) fail('Изменение не найдено в этом аккаунте.');
    if (target?.undoneBy) return;
    const before = undo ? target!.after : one(form, 'before');
    const after = undo ? target!.before : one(form, 'name');
    if (!line(after, 255) || !line(before, 255) || before === after) fail('Введите новое название от 1 до 255 символов.');
    const lastConfirmed = state.events.filter(e => e.kind !== 'create' && e.phase === 'confirmed').at(-1);
    if (!undo && lastConfirmed?.kind === 'rename' && lastConfirmed.before === before && lastConfirmed.after === after) {
      await snapshot(owner, state); return;
    }
    const event = freshEvent(undo ? 'undo' : 'rename', actor, before, after);
    if (target) event.related = target.id;
    state.events.push(event);
    try {
      const s = await snapshot(owner, state);
      const last = state.events.filter(e => e.kind !== 'create' && e.phase === 'confirmed').at(-1);
      if (s.campaign.Name !== before || (target && last?.id !== target.id)) fail('Конфликт отмены или изменения: есть более новая правка. Она сохранена.');
    } catch (error) { event.phase = 'conflict'; db.saveDirect(owner, state); throw error; }
    event.phase = 'pending'; db.saveDirect(owner, state);
    const id = await writeObject(owner,state,event.id,'campaigns', 'update', { Campaigns: [{ Id: BigInt(state.steps.campaign.id!), Name: after }] },()=>{event.phase='rejected';});
    if (id !== state.steps.campaign.id) fail('API вернул другой ID кампании.');
    await confirmRename(owner, state, event);
  }
  return {
    ...createDirectLifecycle(db, connection, launch, { accountVat: async () => (await accountCheck(true)).VatRate,
      validatePlan: checkCurrentPlan, observe: observeLaunch, write: writeObject }),
    view(owner: string, campaignId?: string): DirectView {
      if (owner !== connection.owner) return { enabled: false };
      const runs = campaignId === undefined ? db.readDirectRuns(owner) : db.readCampaignDirectRuns(owner, campaignId);
      const latest = campaignId === undefined ? db.readDirect(owner) : runs.findLast(run => run.account === account);
      const reconcile = connection.reconcileRunId ? db.readDirect(owner, connection.reconcileRunId) : undefined;
      const blocker = reconcile ?? blockingRun(owner, latest?.planId);
      const blockerCampaign = blocker && (blocker.campaignId ?? defaultCampaignId);
      const state = campaignId !== undefined && blockerCampaign === campaignId ? blocker : latest;
      const blockedCampaignId = blocker?.planId !== state?.planId ? blockerCampaign : undefined;
      return { enabled: true, account, generation: connection.generation, mode: connection.mode, ownChief: connection.ownChief, needsReconcile: connection.needsReconcile,
        state, runs, blockedCampaignId, phrasePlan: db.readPhrasePlan(owner, campaignId), wordstatEnabled: Boolean(wordstat), intelligenceEnabled: Boolean(intelligence) };
    },
    async action(owner: string, action: string, form: URLSearchParams, actor: string) {
      if (owner !== connection.owner) fail('Директ не подключён к этому аккаунту.');
      if (!['strategy', 'strategy-confirm', 'research', 'suggest', 'prepare', 'create', 'refresh', 'rename', 'undo',
        'guided-create', 'guided-refresh', 'guided-continue'].includes(action)) fail('Действие не поддерживается.');
      const unlock = db.lockDirect(account);
      try {
        if (['strategy', 'strategy-confirm', 'research', 'suggest'].includes(action)) fail('Этот прежний путь подготовки закрыт. Используйте четыре шага мастера: платные запросы учитываются в едином журнале.');
        if (action.startsWith('guided-')) return await guidedDraft(owner, action, form, actor);
        if (connection.needsReconcile && action!=='refresh') fail('Доступ изменился. Сначала сверить прежнюю операцию; новый набор не создаётся.');
        if (action === 'prepare') return await prepare(owner, form, actor);
        const state = db.readDirect(owner, one(form, 'planId'));
        if (!state || state.account !== account || state.planId !== one(form, 'planId')) fail('Параметры устарели. Откройте актуальную кампанию.');
        if (state.pilot) fail('Кампания уже передана в учебный запуск. Проверяйте её состояние на экране запуска.');
        if (state.launch?.budget) fail('Для этой кампании открыт допуск к показам. Сверьте её на экране «Сводка».');
        const campaignId = state.campaignId ?? defaultCampaignId;
        if (state.guidedDraft && action === 'create') fail('Продолжите создание через сохранённую кампанию.');
        if (form.has('campaignId') && one(form, 'campaignId') !== campaignId) fail('Этот набор относится к другой кампании.');
        if (action === 'create' && scopedRun(owner, campaignId)?.planId !== state.planId) fail('Форма создания устарела. Откройте актуальную кампанию.');
        if (action !== 'refresh' && blockingRun(owner, state.planId)) fail('Сначала сверьте незавершённую операцию в другой кампании.');
        if (action !== 'refresh' && one(form, 'confirm') !== 'yes') fail('Проверьте параметры и подтвердите действие.');
        if (connection.ownChief && action!=='refresh' && one(form,'storageRevision')!==String(state.storageRevision)) fail('Форма операции устарела. Обновите страницу и проверьте последствия.');
        if (connection.needsReconcile && action!=='refresh') fail('Доступ изменился. Сначала сверить прежнюю операцию; новый набор не создаётся.');
        try {
          await accountCheck();
          if (action === 'refresh') {
            const pending = state.events.find(e => e.kind !== 'create' && e.phase === 'pending');
            if (pending) await confirmRename(owner, state, pending);
            else await create(owner, state, false);
          } else if (action === 'create') {
            if (state.events.some(e => e.kind !== 'create' && e.phase === 'pending')) fail('Сначала сверить незавершённое изменение названия.');
            await create(owner, state, true);
          } else await rename(owner, state, form, actor, action === 'undo');
          delete state.error;
        } catch (error) {
          state.error = error instanceof DirectError ? error.message : 'Ошибка обработки Директа. Журнал сохранён; сначала сверить результат.';
          const event = state.events.at(-1); if (event) event.error = state.error;
          throw error instanceof DirectApiError ? error : new DirectError(state.error);
        } finally { db.saveDirect(owner, state); }
        return campaignId;
      } finally { unlock(); }
    },
  };
}
