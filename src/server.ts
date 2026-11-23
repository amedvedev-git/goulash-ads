import { loadCachedResearch } from './cached-research.ts';
import type { CachedResearch } from './cached-research.ts';
import { createServer } from 'node:http';
import { createPreparationService } from './preparation.ts';
import { saveNextPeriod } from './campaign-next-period.ts';
import type { PreparationView } from './preparation.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { loadServerResearch, localResearchAccess } from './research-config.ts';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { emptyCampaign, exampleCampaign } from './campaign.ts';
import { campaignAction, campaignActions } from './campaign-flow.ts';
import { createHash, createHmac } from 'node:crypto';
import type { CampaignView } from './campaign.ts';
import { renderPage } from './page.ts';
import type { Section } from './page.ts';
import { campaignCatalogItems } from './campaign-catalog-data.ts';
import { campaignHeaderContext, type CampaignContext } from './campaign-navigation.ts';
import { campaignDisplayName, initialPreparation } from './campaign-plan.ts';
import { policyHash } from './phrase-policy.ts';
import { campaignHref, campaignPlanHref, campaignTabHref, connectionHref, connectionOrigin, connectionReturn, legacySectionPaths, pilotHref, prepareHref, routes } from './routes.ts';
import type { CampaignTab } from './routes.ts';
import { createPilot, PilotLimitError } from './pilot.ts';
import type { PilotProvider, PilotView } from './pilot.ts';
import type { PilotPageOptions } from './pilot-page.ts';
import { createPublicPilot } from './public-pilot.ts';
import { authDestination, callbackPath, createYandexAuth } from './yandex-auth.ts';
import { createDeepSeekTrial } from './business-analysis.ts';
import { demoCases, demoPreset } from './demo.ts';
import type { DemoCase } from './demo.ts';
import { assessmentAnchor, journalUrl } from './operations-links.ts';
import { demoStatusPayload } from './demo-section.ts';
import { createDirectApi, dpapiToken, DirectError } from './direct-api.ts';
import { campaignWorkspaceRun, createDirectService } from './direct.ts';
import type { DirectConnection } from './direct.ts';
import type { DirectView } from './direct.ts';
import { createWordstat } from './search-phrases.ts';
import type { Wordstat } from './search-phrases.ts';
import { createPhraseIntelligence } from './phrase-intelligence.ts';
import type { PhraseIntelligence } from './phrase-intelligence.ts';
import { createDirectConnections, readAdvertiserName } from './direct-connect.ts';
import { createSecretCodec } from './direct-secrets.ts';
import { AnalyticsDateError, createAnalyticsService, analyticsDates, legacyMetrikaCurrent } from './analytics.ts';
import type { AnalyticsView } from './analytics-page.ts';
import { createMetrikaApi,metrikaConfigId } from './metrika-api.ts';
import type { MetrikaProvider } from './metrika-api.ts';
import type { MetrikaCounterChoice } from './metrika-api.ts';
import { createMetrikaConnections } from './metrika-connect.ts';
import type { ConnectionSettings } from './connections-page.ts';
import { connectionPanel, connectionPanelHref } from './connection-controls.ts';
import type { CampaignReadiness } from './draft-readiness.ts';
import type { DirectLaunchApproval, DirectLaunchReadiness } from './direct-launch.ts';
import { readProtectedFile } from './protected-file.ts';
import { createCampaignOptimization } from './campaign-optimization.ts';
import { saveCampaignCreativeReview } from './campaign-creative-review.ts';
import { createCampaignExperiments } from './campaign-experiment.ts';
import { createOptimizationExplanation } from './optimization-explanation.ts';

const host = '127.0.0.1';
const sections = new Map<string, Section>([[routes.overview, 'overview'], [routes.campaigns, 'campaign'], [routes.prepare, 'campaign'], [routes.results, 'analytics'], [routes.history, 'history'], [routes.diagnostics, 'diagnostics'], [routes.connection, 'connections']]);
const assets = new Map([
  ['/assets/ui-client.js', ['ui-client.js', 'text/javascript; charset=utf-8']],
  ['/assets/connection-client.js', ['connection-client.js', 'text/javascript; charset=utf-8']],
  ['/assets/connection-direct.png', ['connection-direct.png', 'image/png']],
  ['/assets/connection-metrika.png', ['connection-metrika.png', 'image/png']],
  ['/assets/connection-advertiser.svg', ['connection-advertiser.svg', 'image/svg+xml']],
  ['/assets/ad-wording.js', ['../ad-wording.ts', 'text/javascript; charset=utf-8']],
  ['/assets/Onest.ttf', ['Onest.ttf', 'font/ttf']],
  ['/assets/PixelifySans.ttf', ['PixelifySans.ttf', 'font/ttf']],
]);
type AuthNotice = { text: string; variant: 'neutral' | 'error' };
const authMessages = new Map<string, AuthNotice>([
  ['retry', { text: 'Не удалось подтвердить вход. Повторите вход через Яндекс ID.', variant: 'error' }],
  ['cancelled', { text: 'Вход отменён.', variant: 'neutral' }],
  ['unavailable', { text: 'Не удалось войти через Яндекс ID. Повторите вход. Если ошибка повторится, передайте организатору проверки время и шаг «Вход через Яндекс ID».', variant: 'error' }],
]);
const yandexSignIn = (destination?: string) => '/auth/yandex' + (destination ? '?return=' + encodeURIComponent(destination) : '');

async function readForm(request: IncomingMessage, response: ServerResponse, limit: number) {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    response.writeHead(415).end();
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      response.setHeader('Connection', 'close');
      response.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Запрос слишком большой.');
      request.resume();
      return;
    }
    chunks.push(chunk);
  }

  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

async function saveRecord(
  request: IncomingMessage, response: ServerResponse,
  sendPage: (status: number, value: string, message: string) => void,
  save: (content: string) => void,
) {
  const form = await readForm(request, response, 4096);
  if (!form) return;
  const fields = form.getAll('content');
  const value = fields[0]?.trim() ?? '';
  if (fields.length !== 1 || value.length < 1 || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    sendPage(400, value.slice(0, 200), 'Введи от 1 до 200 символов в одну строку.');
    return;
  }

  save(value);
  response.writeHead(303, { Location: '/diagnostics?saved=1' }).end();
}

export function createApp(
  database: ReturnType<typeof openDatabase>, auth?: ReturnType<typeof createYandexAuth>, publicOrigin?: URL,
  runDeepSeekTrial?: ReturnType<typeof createDeepSeekTrial>,
  directConnection?: DirectConnection,
  wordstat?: Wordstat,
  intelligence?: PhraseIntelligence,
  preparationRegions?: (owner: string) => Promise<import('./search-phrases.ts').GeoRegion[]>,
  cachedResearch: CachedResearch = {},
  connections?: ReturnType<typeof createDirectConnections>,
  metrikaProvider?:MetrikaProvider,
  researchAllowed?: (owner: string) => boolean,
  pilotProvider?: PilotProvider,
  publicPilotDatabase?: ReturnType<typeof openDatabase>,
  metrikaConnections?: ReturnType<typeof createMetrikaConnections>,
  launchApproval?: DirectLaunchApproval,
  localPreview?: { formPrefix: string; trainingHref?: string; trainingLoginHref?: string },
) {
  const diagnostics = !publicOrigin && !localPreview && !pilotProvider;
  const trialEnabled = !publicOrigin && Boolean(runDeepSeekTrial);
  const directCookie = (auth?.cookies.direct ?? 'goulash_direct') + '=';
  if (publicOrigin && directConnection) throw new Error('Локальный токен Директа нельзя использовать на публичном стенде.');
  if (pilotProvider && (publicOrigin || !auth || !connections || pilotProvider.mode !== 'fixture'))
    throw new Error('Учебный запуск требует отдельного локального кабинета и имитации.');
  if (publicPilotDatabase && (!publicOrigin || !auth || publicPilotDatabase === database))
    throw new Error('Для публичного учебного запуска нужны отдельная база и вход через Яндекс ID.');
  const publicPilot = publicPilotDatabase && createPublicPilot(publicPilotDatabase);
  const pilot = pilotProvider && connections ? createPilot(database, pilotProvider, owner => connections.resolve(owner),
    (owner, generation, run) => connections.reconciled(owner, generation, run)) : undefined;
  const legacyDirect = directConnection ? createDirectService(database, directConnection, wordstat, intelligence) : undefined;
  const metrikaFor = (owner: string) => database.readAnalyticsSettings(owner).metrikaOAuth
    ? metrikaConnections?.resolve(owner) : metrikaProvider?.owner === owner ? metrikaProvider : undefined;
  const analytics=createAnalyticsService(database,owner=>connections?.resolve(owner)??(directConnection?.owner===owner?directConnection:undefined),metrikaFor);
  const optimization = createCampaignOptimization(database, analytics, owner => connections?.resolve(owner));
  const experiments = createCampaignExperiments(database, analytics.campaignMeasurement);
  const explanations = createOptimizationExplanation(database, intelligence, researchAllowed ?? (() => !publicOrigin));
  function launchReadiness(owner: string, workspace: string): DirectLaunchReadiness | undefined {
    const c = connections?.resolve(owner);
    const advertiser = c && database.readAnalyticsSettings(owner).advertisers?.[c.account];
    if (!c?.ownChief || !advertiser || advertiser.generation !== c.generation) return;
    const view = analytics.campaignMeasurement(owner, workspace), m = view.measurement;
    if (!view.verified || !m?.goalId || !m.test?.verifiedAt) return;
    return { advertiser: { name: advertiser.name, generation: advertiser.generation, checkedAt: advertiser.checkedAt },
      measurement: { counterId: m.counter.id, goalId: m.goalId, landing: m.landing,
      configId: m.configId, generation: m.generation, verifiedAt: m.test.verifiedAt } };
  }
  const preparation = createPreparationService(database, intelligence, wordstat, preparationRegions ?? (directConnection || connections ? async owner => {
    const c=connections?.resolve(owner) ?? (owner===directConnection?.owner?directConnection:undefined);
    if (!c) throw new DirectError('Подключите свой Директ для проверки справочника региона.');
    return c.api.list('dictionaries', { DictionaryNames: ['GeoRegions'] }, 'GeoRegions');
  } : undefined), cachedResearch, researchAllowed ?? (publicOrigin ? () => false : () => true));
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'same-origin');
    const authority = publicOrigin?.host ?? `${host}:${request.socket.localPort}`;
    if (request.headers.host !== authority || !request.url?.startsWith('/') || request.url.startsWith('//')) {
      response.writeHead(400).end();
      return;
    }

    const origin = publicOrigin?.origin ?? `http://${authority}`;
    const post = request.method === 'POST';
    if (post && request.headers.origin !== origin) {
      response.writeHead(403).end();
      return;
    }

    let name: string | undefined;
    let owner: string | undefined;
    let direct=legacyDirect;
    let resolvedConnection: DirectConnection | undefined;
    const browserToken=()=>request.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(directCookie))?.slice(directCookie.length).match(/^[\w-]{43}$/)?.[0]??'';
    const legacyMetrikaDisconnectProof = (revision: number, configId?: string) => {
      const binding = auth?.binding(request);
      return binding ? createHmac('sha256', binding).update(JSON.stringify(['legacy-metrika-disconnect', revision, configId])).digest('base64url') : undefined;
    };
    function disconnectLegacyMetrika(owner: string, revision: string, confirm: string, submittedProof: string) {
      if (confirm !== 'disconnect') throw new DirectError('Подтвердите отключение чтения Метрики для всех ваших кампаний.');
      if (!/^\d+$/.test(revision)) throw new DirectError('Обновите подключения и подтвердите отключение Метрики.');
      analytics.disconnect(owner, Number(revision), () => {
        const saved = database.readAnalyticsSettings(owner);
        const proof = legacyMetrikaDisconnectProof(saved.revision, saved.metrikaConfigId);
        if (!saved.metrikaEnabled || (auth && (!proof || submittedProof !== proof)))
          throw new DirectError('Обновите подключения и подтвердите отключение текущего доступа к Метрике.');
      });
    }
    let section: Section = 'campaign';
    let restore = false, saveComplete = false;
    let operationId: string | undefined, undoId: string | undefined;
    let historyFilter: 'all' | 'draft' | 'demo' = 'all';
    let historySource: 'all' | 'goulash' | 'mine' = 'all';
    let experimentsOnly = false;
    let journalRecovery: string | undefined;
    function providerJournal(form: URLSearchParams, source: 'mine' | 'goulash') {
      const one = (field: string) => form.getAll(field).length === 1 ? form.get(field) : undefined;
      if (one('journal') === 'global') campaignContext = undefined;
      const filters: Record<string, string> = {};
      if (!campaignContext && one('scope') === 'draft') filters.scope = historyFilter = 'draft';
      if (one('by') === source) filters.by = historySource = source;
      return journalUrl(campaignContext?.id, filters);
    }
    let directInput: DirectView['input'];
    let preparationView: PreparationView | undefined, legacyCampaign = false;
    let campaignId = 'default';
    let campaignContext: CampaignContext | undefined;
    let connectionCampaign: {id: string; name: string; guided?: boolean; from?: ReturnType<typeof connectionOrigin>; runId?: string} | undefined;
    let connectionError: { field: string; message: string } | undefined;
    let openConnection: ConnectionSettings['panel'];
    let counterInput: string | undefined;
    let counterPreview: ConnectionSettings['counterPreview'];
    let advertiserLookup: string | null | undefined;
    let metrikaCounters: MetrikaCounterChoice[] | undefined;
    let creativeInput: { title: string; adText: string } | undefined;
    let catalog = false;
    let catalogFilter: string | undefined;
    let analyticsInput:Record<string,string>|undefined, analyticsErrors:Record<string,string>|undefined;
    let analyticsRunId: string | undefined;
    let demoNotice: {text: string; error: boolean} | undefined;
    let pilotView: PilotView | undefined;
    let pilotOptions: PilotPageOptions | undefined;
    function pilotActionError(error: unknown, form: URLSearchParams) {
      const message = error instanceof DirectError ? error.message : 'Не удалось выполнить учебную проверку. Сверьте состояние.';
      if (error instanceof PilotLimitError) {
        pilotOptions = { limitError: error };
        return '';
      }
      if (form.getAll('action').length === 1 && form.get('action') === 'reports') {
        pilotOptions = { reportError: message };
        return '';
      }
      return message;
    }
    let signInHref: string | undefined;
    let connectionRecoveryHref: string | undefined;
    const workspaceExists = (id: string) => id === 'default' || Boolean(database.readCampaignWorkspace(owner!, id));
    const isGuided = (id: string) => Boolean(owner && database.readPreparation(owner, id)?.value.guided);
    const campaignUrl = () => (isGuided(campaignId) ? prepareHref : campaignHref)(campaignId);
    const workspaceRun = (id: string) => owner && campaignWorkspaceRun(database.readCampaignDirectRuns(owner, id), isGuided(id));
    function selectCampaignContext(id: string, tab: CampaignTab) {
      if (!owner || !workspaceExists(id)) return false;
      const run = workspaceRun(id);
      if (!run) return false;
      const saved = database.readPreparation(owner, id)?.value ??
        initialPreparation(database.readCampaign(owner, id) ?? { draft: run.draft, revision: run.revision });
      campaignId = id;
      campaignContext = campaignHeaderContext(id, tab, saved, run, connections?.mode ?? directConnection?.mode);
      return true;
    }
    function sendPage(status: number, value: string | undefined, message = '', campaign?: CampaignView, noticeVariant?: AuthNotice['variant']) {
      if(section==='connections'&&owner&&!campaign){const saved=database.readCampaign(owner);campaign={input:saved?.draft??emptyCampaign,preview:saved?.draft,revision:saved?.revision??0};}
      let connectionSettings: ConnectionSettings | undefined;
      let readiness: CampaignReadiness | undefined;
      if (section === 'connections' && owner) {
        const stored = database.readAnalyticsSettings(owner);
        const provider = metrikaFor(owner);
        const availableCampaigns = campaignCatalogItems(database, owner);
        const scope = connectionCampaign?.id;
        const measure = !connectionCampaign?.runId && scope && database.readCampaignWorkspace(owner, scope)
          ? analytics.campaignMeasurement(owner, scope) : undefined;
        const connection = resolvedConnection;
        const advertiser = connection && stored.advertisers?.[connection.account];
        connectionSettings = { revision: stored.revision, campaignId: measure ? scope : undefined, contextId: scope, from: connectionCampaign?.from, runId: connectionCampaign?.runId,
          error: connectionError, panel: openConnection, counterInput, counterPreview, advertiserLookup, training: (connection?.mode ?? connections?.view(owner, auth?.binding(request) ?? '', browserToken()).mode) === 'fixture', campaigns: availableCampaigns,
          directConnected: Boolean(connection || directConnection?.owner === owner),
          metrika: { configured: Boolean(provider), enabled: stored.metrikaEnabled, legacy: !measure,
            disconnected: Boolean(stored.metrikaOAuth && !stored.metrikaOAuth.envelope),
            canList: Boolean(provider?.api.counters), canTest: measure?.canTest,
            current: measure ? measure.current : legacyMetrikaCurrent(stored, provider), counter: measure ? measure.measurement?.counter : stored.counter,
            goalId: measure ? measure.measurement?.goalId : stored.goalId, verified: measure?.verified, verifiedAt: measure?.measurement?.test?.verifiedAt, testUrl: measure?.testUrl },
          metrikaAccess: auth && metrikaConnections?.view(owner, auth.binding(request)), counters: metrikaCounters,
          legacyDisconnect: stored.metrikaEnabled && !stored.metrikaOAuth ? { proof: legacyMetrikaDisconnectProof(stored.revision, stored.metrikaConfigId) } : undefined,
          advertiser: connection?.ownChief && connection.generation !== undefined ? { account: connection.account,
            generation: connection.generation, name: advertiser?.generation === connection.generation ? advertiser.name : undefined,
            checkedAt: advertiser?.generation === connection.generation ? advertiser.checkedAt : undefined } : undefined };
      }
      if (owner && section === 'campaign' && !catalog && isGuided(campaignId) && database.readCampaignWorkspace(owner, campaignId)) {
        const measure = analytics.campaignMeasurement(owner, campaignId);
        const c = resolvedConnection;
        const advertiser = c && database.readAnalyticsSettings(owner).advertisers?.[c.account];
        readiness = { goalSelected: Boolean(measure.current && measure.measurement?.goalId), goalVerified: measure.verified,
          advertiserConfirmed: Boolean(c?.ownChief && advertiser && advertiser.generation === c.generation && advertiser.name) };
      }
      const cabinetOwner = section === 'pilot' || section === 'how-it-works' ? undefined : owner;
      const connectView=cabinetOwner&&connections?connections.view(cabinetOwner,auth?.binding(request)??'',browserToken()):undefined;
      const directScope = section === 'campaign' ? campaignId : campaignContext?.id;
      const directView: DirectView | undefined = cabinetOwner
        ? direct ? { ...direct.view(cabinetOwner, directScope), input: directInput }
          : connections || campaignContext ? { enabled: false, ownChief: true, mode: connectView?.mode ?? 'live',
            state: directScope ? database.readCampaignDirectRuns(cabinetOwner, directScope).at(-1) : database.readDirect(cabinetOwner),
            runs: directScope ? database.readCampaignDirectRuns(cabinetOwner, directScope) : database.readDirectRuns(cabinetOwner) }
            : undefined
        : undefined;
      let analyticsView: AnalyticsView | undefined = owner && (section === 'analytics' || section === 'overview' || (section === 'campaign' && catalog))
        ? { ...analytics.view(owner, analyticsRunId, campaignContext?.tab === 'results' ? campaignId : undefined), input: analyticsInput, errors: analyticsErrors } : undefined;
      if (analyticsView && campaignContext?.tab === 'results') {
        const runs = analyticsView.runs.filter(run => run.campaignId === campaignId);
        const runIds = new Set(runs.map(run => run.planId));
        const belongs = (report: typeof analyticsView.reports[number]) => report.context.runId && runIds.has(report.context.runId);
        analyticsView = { ...analyticsView, campaignId, runs,
          reports: analyticsView.reports.filter(belongs), currentReports: analyticsView.currentReports.filter(belongs),
          canRefresh: { ...analyticsView.canRefresh, metrika_site: false } };
      }
      response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      const html = renderPage(value, message, status >= 400, Boolean(auth), name, campaign,
        cabinetOwner && (!campaignContext || section === 'history') ? database.operationsView(cabinetOwner, { operationId, undoId, campaignId: campaignContext?.id }) : undefined, { section, restore, saved: saveComplete, historyFilter, historySource, journalRecovery, direct: directView,
          connect:connectView,directConfigured:Boolean(connections), connectionCampaign, connectionSettings, diagnostics,
          analytics: analyticsView,
          campaignCatalog: owner && (catalog || section === 'overview' || section === 'history') ? campaignCatalogItems(database, owner) : undefined,
          preparation: owner && section === 'campaign' && !catalog && !legacyCampaign ? preparationView ?? preparation.view(owner, undefined, undefined, campaignId) : undefined,
          scope: createHash('sha256').update(localPreview?.formPrefix ?? '').update(campaignId === 'default' ? owner ?? 'anonymous' : JSON.stringify([owner, campaignId])).digest('hex'),
          campaignId, campaignContext, catalogFilter, readiness, creativeInput, demoNotice, pilot: pilotView, pilotOptions, publicPilot: Boolean(publicPilot), trainingHref: localPreview?.trainingHref,
          summarySettingsOpen: status >= 400 && ['/campaign/next-period', '/campaign/optimization'].includes(request.url!.split('?', 1)[0]),
          signInHref, noticeVariant, connectionRecoveryHref, trainingLoginHref: localPreview?.trainingLoginHref,
          directLaunch: owner && section === 'campaign' && !catalog ? direct?.lifecycleView?.(owner, campaignId) : undefined,
          experimentsOnly, experiments: owner && campaignContext && isGuided(campaignContext.id) && (campaignContext.tab === 'ads' || campaignContext.tab === 'journal')
            ? experiments.view(owner, campaignId) : undefined,
          explainOptimization: Boolean(owner && campaignContext?.tab === 'journal' && explanations.available(owner)),
          pilotAvailable: owner && ((section === 'campaign' && !catalog) || campaignContext) && isGuided(campaignId) ? Boolean(pilot?.view(owner, campaignId)) : false });
      response.end(localPreview?.formPrefix ? html.replace(/(\s(?:formaction|action|data-resume-action)=")\/(?!\/)/g, `$1${localPreview.formPrefix}/`) : html);
    }

    function repeatAfterSignIn(destination: string) {
      signInHref = yandexSignIn(destination);
      return sendPage(401, undefined, 'Действие не выполнено. Войдите через Яндекс ID, вернитесь к работе и повторите действие.');
    }

    function repeatCampaignAction(fields: URLSearchParams, tab: CampaignTab, key = 'ad', filters?: Record<string, string>) {
      const ids = fields.getAll(key);
      const destination = ids.length === 1 && authDestination(campaignTabHref(ids[0], tab, filters));
      section = tab === 'journal' ? 'history' : 'campaign';
      return repeatAfterSignIn(destination || routes.campaigns);
    }

    try {
      const url = new URL(request.url, origin);
      const get = request.method === 'GET';
      const authNotice = get && auth ? authMessages.get(url.searchParams.get('auth') ?? '') : undefined;
      // Canonical addresses: old GET URLs live forever and keep their query
      // (?ad=, ?run=, ?example=, date filters). POST endpoints keep their paths.
      const legacyTarget = get ? legacySectionPaths.get(url.pathname) : undefined;
      if (legacyTarget) return response.writeHead(308, { Location: legacyTarget + url.search }).end();
      // "Учебная автоматика" is no longer a section: its content lives at the bottom
      // of "Результаты". A fragment cannot follow a query string, so the old
      // ?run=repeat notice becomes ?demo=repeat.
      if (get && (url.pathname === '/automation' || url.pathname === '/automation/')) {
        const repeat = url.searchParams.get('run') === 'repeat';
        return response.writeHead(308, { Location: routes.results + (repeat ? '?demo=repeat' : '') + '#demo' }).end();
      }
      section = sections.get(url.pathname) ?? (url.pathname.startsWith('/operations/') ? 'history' : url.pathname === '/demo/run' ? 'analytics' : url.pathname === '/demo/load' ? 'analytics' : url.pathname === '/test-record' ? 'diagnostics' : 'campaign');
      if (section === 'diagnostics' && !diagnostics) return response.writeHead(404).end();
      // Keep bookmarked preparation URLs working after the overview moves to the root.
      if (url.pathname === '/' && ['example', 'campaign', 'preparation'].some(key => url.searchParams.has(key))) section = 'campaign';
      if (get && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname)!;
        response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
        return response.end(readFileSync(new URL('./assets/' + file, import.meta.url)));
      }
      if (auth && get && url.pathname === '/auth/yandex') {
        const site = request.headers['sec-fetch-site'];
        if (site && site !== 'same-origin' && site !== 'none') return response.writeHead(403).end();
        const destinations = url.searchParams.getAll('return');
        const destination = destinations.length === 1 ? authDestination(destinations[0], Boolean(publicPilot)) : undefined;
        return auth.start(request, response, origin, destination);
      }
      if (auth && get && url.pathname === callbackPath) {
        response.setHeader('Referrer-Policy', 'no-referrer');
        return await auth.finish(request, response, url.searchParams);
      }
      if (auth && post && url.pathname === '/logout') return auth.logout(request, response);

      const session = auth?.session(request);
      name = session?.name;
      owner = auth ? session?.owner : 'local';
      if (url.pathname === routes.howItWorks) {
        if (!get && request.method !== 'HEAD') return response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        section = 'how-it-works';
        return sendPage(200, undefined, '', owner ? { input: emptyCampaign, revision: 0 } : undefined);
      }
      if (auth && !owner) {
        const connectionPost = post && /^\/connections\/(?:direct\/(?:start|finish|activate|disconnect|cancel)|metrika\/(?:start|finish|cancel|disconnect|list|choices|inspect|configure|counter|goal|test|verify)|advertiser)$/.test(url.pathname);
        const path = connectionPost ? routes.connection : url.pathname;
        const destination = publicPilot && url.pathname === routes.pilot ? routes.pilot
          : get || connectionPost ? authDestination(path + url.search) ?? authDestination(path) : undefined;
        if (destination) signInHref = yandexSignIn(destination);
      }
      if (publicPilot && url.pathname === routes.pilot) {
        section = 'pilot';
        if ((!get && !post) || url.searchParams.has('ad')) return response.writeHead(404).end();
        if (!owner) return sendPage(401, undefined, authNotice?.text ?? (post ? 'Войдите через Яндекс ID, чтобы открыть учебный запуск.' : ''), undefined, authNotice?.variant);
        const campaign = { input: emptyCampaign, revision: 0 };
        pilotView = publicPilot.view(owner);
        if (get) {
          pilotOptions = { confirmRestart: url.searchParams.getAll('restart').length === 1 && url.searchParams.get('restart') === 'confirm' };
          return sendPage(200, undefined, '', campaign);
        }
        const form = await readForm(request, response, 4096);
        if (!form) return;
        try {
          if (form.getAll('action').length !== 1) throw new DirectError('Выберите действие на экране учебного запуска.');
          const action = form.get('action');
          if (action === 'start-demo') await publicPilot.start(owner);
          else if (action === 'restart-demo') await publicPilot.start(owner, form);
          else {
            if (!pilotView || form.getAll('campaignId').length !== 1 || form.get('campaignId') !== pilotView.id)
              return response.writeHead(404).end();
            await publicPilot.action(owner, form, name ?? 'Владелец учебного кабинета');
          }
          return response.writeHead(303, { Location: routes.pilot + (action === 'reports' ? '#pilot-results-title' : '') }).end();
        } catch (error) {
          pilotView = publicPilot.view(owner);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined, pilotActionError(error, form), campaign);
        }
      }
      if(owner&&connections) {
        resolvedConnection=connections.resolve(owner);
        const allowed = researchAllowed?.(owner) ?? !publicOrigin;
        direct=resolvedConnection?createDirectService(database,resolvedConnection,allowed ? wordstat : undefined,allowed ? intelligence : undefined,
          { approval: launchApproval, readiness: launchReadiness }):undefined;
      }
      const actor = session ? `${session.name} (${owner})` : 'Локальный пользователь (local)';
      if (url.pathname === routes.pilot) {
        if (!pilot || (!get && !post)) return response.writeHead(404).end();
        if (!owner) { section = 'pilot'; return sendPage(401, undefined); }
        const form = post ? await readForm(request, response, 4096) : url.searchParams;
        if (!form) return;
        const field = post ? 'campaignId' : 'ad';
        campaignId = form.get(field) ?? '';
        if (form.getAll(field).length !== 1 || !isGuided(campaignId) || !(pilotView = pilot.view(owner, campaignId)))
          return response.writeHead(404).end();
        const saved = database.readCampaign(owner, campaignId);
        const campaign = { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 };
        if (get) return sendPage(200, database.read(owner), '', campaign);
        try {
          await pilot.action(owner, campaignId, form, actor);
          return response.writeHead(303, { Location: pilotHref(campaignId) + (form.get('action') === 'reports' ? '#pilot-results-title' : '') }).end();
        } catch (error) {
          pilotView = pilot.view(owner, campaignId);
          if (!pilotView) return response.writeHead(404).end();
          return sendPage(error instanceof DirectError ? 409 : 500, database.read(owner), pilotActionError(error, form), campaign);
        }
      }
      if (owner && url.pathname.startsWith('/connections/')) {
        if (get && url.searchParams.getAll('panel').length === 1) openConnection = connectionPanel(url.searchParams.get('panel'));
        const id = url.searchParams.get('ad');
        const from = url.searchParams.getAll('from').length === 1 ? connectionOrigin(url.searchParams.get('from')) : undefined;
        const runId = url.searchParams.get('run');
        const unavailable = () => {
          if (!get || url.pathname !== routes.connection) return response.writeHead(404).end();
          section = 'connections';
          connectionRecoveryHref = yandexSignIn(authDestination(url.pathname + url.search));
          sendPage(404, undefined, authNotice?.text, undefined, authNotice?.variant);
        };
        if (runId !== null) {
          const run = from === 'results' && url.searchParams.getAll('run').length === 1 ? database.readDirect(owner, runId) : undefined;
          if (!id || url.searchParams.getAll('ad').length !== 1 || run?.steps.campaign.phase !== 'confirmed' || (run.campaignId ?? 'default') !== id)
            return unavailable();
        }
        if (id && url.searchParams.getAll('ad').length === 1 && workspaceExists(id)) connectionCampaign = {id, name: campaignDisplayName(database.readPreparation(owner, id)?.value, database.readCampaign(owner, id)?.draft.description), guided: isGuided(id) || Boolean(workspaceRun(id)),
          from, runId: runId ?? undefined};
        if (get && url.pathname === routes.connection && url.searchParams.has('ad') && !connectionCampaign) return unavailable();
      }
      if (post && (url.pathname.startsWith('/connections/metrika/') || url.pathname === '/connections/advertiser')) {
        section = 'connections';
        if (!owner || (auth && !session)) return sendPage(401, undefined, 'Войдите, чтобы вернуться к подключениям. Подтвердите действие заново.');
        if (url.searchParams.has('ad') && !connectionCampaign) return response.writeHead(404).end();
        const form = await readForm(request, response, 4096);
        if (!form) return;
        const field = (key: string) => form.getAll(key).length === 1 ? form.get(key)!.trim() : '';
        const scope = connectionCampaign?.id;
        const location = connectionHref(scope, connectionCampaign?.from, connectionCampaign?.runId);
        const panel = url.pathname === '/connections/advertiser' ? 'advertiser' : 'metrika';
        if (field('returnPanel') === panel) openConnection = panel;
        const structured = request.headers.accept === 'application/json' && /\/(choices|inspect)$/.test(url.pathname);
        const json = (status: number, data: unknown) => response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));
        try {
          const settings = database.readAnalyticsSettings(owner);
          if (url.pathname === '/connections/advertiser') {
            const c = resolvedConnection, name = field('name');
            const lookup = field('operation') === 'lookup';
            const fromDirect = field('source') === 'direct';
            if (!c?.ownChief || c.generation === undefined || c.account !== field('account') || String(c.generation) !== field('generation'))
              throw new DirectError('Подключение Директа изменилось. Откройте «Подключения» и повторите сверку.');
            if (!lookup && (field('confirm') !== 'yes' || !name || name.length > 200 || /[\x00-\x1f\x7f]/.test(name)))
              throw new DirectError('Проверьте кабинет, название и сведения для маркировки.');
            const revision = field('revision');
            if (!/^\d+$/.test(revision) || Number(revision) !== settings.revision)
              throw new DirectError('Настройки изменились. Обновите страницу и повторите сверку.');
            if (lookup || fromDirect) {
              const latest = await readAdvertiserName(c);
              resolvedConnection = connections?.resolve(owner);
              if (resolvedConnection?.generation !== c.generation || resolvedConnection?.account !== c.account)
                throw new DirectError('Подключение Директа изменилось. Повторите сверку.');
              if (lookup || latest !== name) {
                advertiserLookup = latest;
                return sendPage(lookup ? 200 : 409, undefined, lookup ? '' : 'Данные рекламодателя изменились. Проверьте текущие сведения.');
              }
            }
            database.saveAnalyticsSettings(owner, { ...settings, advertisers: { ...settings.advertisers,
              [c.account]: { account: c.account, generation: c.generation, name, checkedAt: new Date().toISOString() } } }, Number(revision),
              undefined, { preservePending: true });
            if (fromDirect) return response.writeHead(303, { Location: openConnection ? location : location + '#advertiser-title' }).end();
          } else {
            const operation = url.pathname.slice('/connections/metrika/'.length);
            const binding = auth?.binding(request);
            if (operation === 'disconnect' && !settings.metrikaOAuth) {
              disconnectLegacyMetrika(owner, field('revision'), field('confirm'), field('disconnectProof'));
            } else if (['start', 'finish', 'cancel', 'disconnect'].includes(operation)) {
              if (!metrikaConnections || !binding) throw new DirectError('Подключение через Яндекс пока недоступно.');
              if (operation === 'start') metrikaConnections.start(owner, binding);
              else if (operation === 'finish') await metrikaConnections.finish(owner, binding, form);
              else if (operation === 'cancel') metrikaConnections.cancel(owner, binding, form);
              else metrikaConnections.disconnect(owner, binding, form);
            } else {
              const workspace = !connectionCampaign?.runId && scope && database.readCampaignWorkspace(owner, scope) ? scope : undefined;
              const revision = field('revision');
              if (!/^\d+$/.test(revision)) throw new DirectError('Обновите страницу настроек.');
              if (operation === 'choices') {
                if (Number(revision) !== settings.revision) throw new DirectError('Настройки изменились. Обновите страницу и повторите.');
                return json(200, { counters: await analytics.listCounters(owner) });
              } else if (operation === 'list') {
                if (Number(revision) !== settings.revision) throw new DirectError('Настройки изменились. Обновите страницу и повторите.');
                metrikaCounters = await analytics.listCounters(owner);
                return sendPage(200, undefined);
              } else if (operation === 'inspect') {
                counterPreview = await analytics.inspectCounter(owner, field('counterId'), Number(revision), workspace);
                if (structured) return json(200, { id: counterPreview.id, domain: counterPreview.domain, name: counterPreview.name,
                  goals: counterPreview.goals.map(({id, name}) => ({id, name})) });
                return sendPage(200, undefined);
              } else if (operation === 'configure') {
                await analytics.configureMetrika(owner, field('counterId'), field('goalId'), Number(revision), workspace, field('enable') === 'read');
              } else if (operation === 'counter') {
                if (!workspace && field('confirm') !== 'read') throw new DirectError('Подтвердите чтение отчётов этого счётчика.');
                await analytics.counter(owner, field('counterId'), Number(revision), workspace);
              } else if (operation === 'goal' && !workspace) {
                const goalId = field('goalId');
                if (!goalId || !legacyMetrikaCurrent(settings, metrikaFor(owner)))
                  throw new DirectError('Проверьте счётчик и выберите доступную цель.');
                analytics.save(owner, new URLSearchParams({ revision, goalId, dateFrom: settings.dateFrom, dateTo: settings.dateTo,
                  directRunId: settings.directRunId ?? '' }), true);
              } else if (!workspace) {
                throw new DirectError('Сначала выберите сохранённую кампанию.');
              } else if (operation === 'goal') analytics.setGoal(owner, workspace, field('goalId'), Number(revision));
              else if (operation === 'test') analytics.beginTest(owner, workspace, Number(revision));
              else if (operation === 'verify') {
                const result = await analytics.verifyTest(owner, workspace, Number(revision));
                if (result === 'not_found') return sendPage(200, undefined, 'Тестовая заявка пока не найдена', undefined, 'neutral');
              }
              else return response.writeHead(404).end();
            }
          }
          return response.writeHead(303, { Location: openConnection && panel === 'metrika' && !url.pathname.endsWith('/disconnect')
            ? connectionPanelHref(location, openConnection) : location }).end();
        } catch (error) {
          const message = error instanceof DirectError ? error.message : 'Не удалось сохранить подключение. Обновите страницу.';
          if (structured) return json(409, { message });
          const fieldId = ({ counter: 'metrika-counter', inspect: 'metrika-counter', goal: 'metrika-goal', finish: 'metrika-code' } as Record<string, string>)[url.pathname.split('/').at(-1)!];
          if (fieldId === 'metrika-counter') counterInput = field('counterId').slice(0, 19);
          if (fieldId && !/обновите страницу|изменил|заново|устарел/i.test(message)) connectionError = { field: fieldId, message };
          if (url.pathname === '/connections/advertiser' && !form.has('operation') && !form.has('source') &&
              (!field('name') || field('name').length > 200 || /[\x00-\x1f\x7f]/.test(field('name'))))
            connectionError = { field: 'advertiser-name', message: 'Введите название рекламодателя от 1 до 200 символов в одну строку.' };
          if (url.pathname === '/connections/advertiser' && field('operation') === 'lookup') connectionError = { field: 'advertiser-lookup', message };
          return sendPage(409, undefined, connectionError?.message ?? message);
        }
      }
      if(url.pathname.startsWith('/connections/direct/')&&post) {
        section='connections';
        if (!auth || !owner || !session) return sendPage(401, undefined, 'Войдите, чтобы вернуться к подключениям. Подтвердите действие заново.');
        if ((url.searchParams.has('ad') && !connectionCampaign) || (url.searchParams.has('from') && !connectionCampaign?.from))
          return response.writeHead(404).end();
        if(!connections)return sendPage(409,database.read(owner),'Администратор ещё не настроил подключение Директа.');
        const form=await readForm(request,response,4096);if(!form)return;
        if (form.getAll('returnPanel').length === 1 && form.get('returnPanel') === 'direct') openConnection = 'direct';
        if (form.has('contextCampaign') && (form.getAll('contextCampaign').length !== 1 || form.get('contextCampaign') !== connectionCampaign?.id))
          return response.writeHead(404).end();
        try {
          const action=url.pathname.slice('/connections/direct/'.length),binding=auth.binding(request);
          if(action==='start') { const token=connections.start(owner,binding);response.appendHeader('Set-Cookie',`${directCookie}${token}; Path=${localPreview?.formPrefix ? '/' : '/connections/direct'}; HttpOnly; SameSite=Lax; Max-Age=600${publicOrigin?'; Secure':''}`); }
          else if(action==='finish')await connections.finish(owner,binding,browserToken(),form);
          else if(action==='activate')connections.activate(owner,binding,form);
          else if(action==='disconnect')connections.disconnect(owner,binding,form);
          else if(action==='cancel')connections.cancel(owner);
          else return response.writeHead(404).end();
          const location = connectionCampaign
            ? action === 'activate' ? connectionReturn(connectionCampaign.id, connectionCampaign.from, connectionCampaign.guided, connectionCampaign.runId) : connectionHref(connectionCampaign.id, connectionCampaign.from, connectionCampaign.runId)
            : routes.connection;
          return response.writeHead(303,{Location:openConnection && action !== 'disconnect' && (action !== 'activate' || !connectionCampaign)
            ? connectionPanelHref(location, openConnection) : location}).end();
         }catch(error){
          const message = error instanceof DirectError ? error.message : 'Не удалось подтвердить подключение. Получите новый код.';
          if (url.pathname.endsWith('/finish') && /код/i.test(message)) connectionError = { field: 'direct-code', message };
          return sendPage(409,database.read(owner),message);
        }
      }
      if (post && url.pathname === '/campaign/lifecycle') {
        if (auth && !owner) return repeatCampaignAction(url.searchParams, 'summary');
        if (!owner || !session || !direct?.lifecycleAction) return response.writeHead(403).end();
        if (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'summary'))
          return response.writeHead(404).end();
        section = 'campaign';
        const form = await readForm(request, response, 4096);
        if (!form) return;
        const action = form.get('action');
        if (form.getAll('action').length !== 1 || !(action === 'refresh' || action === 'moderate' || action === 'pause' || action === 'resume'))
          return response.writeHead(400).end();
        try {
          await direct.lifecycleAction(owner, campaignId, action, form, actor);
          return response.writeHead(303, { Location: prepareHref(campaignId) + '#launch-commands' }).end();
        } catch (error) {
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined,
            error instanceof DirectError ? error.message : 'Не удалось сверить состояние показа. Повторно проверьте его в Директе.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      }
      if (post && url.pathname === '/campaign/optimization') {
        if (auth && !owner) return repeatCampaignAction(url.searchParams, 'summary');
        if (!owner || !session) return response.writeHead(403).end();
        if (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'summary'))
          return response.writeHead(404).end();
        section = 'campaign';
        const form = await readForm(request, response, 4096);
        if (!form) return;
        try {
          optimization.set(owner, campaignId, form, actor);
          return response.writeHead(303, { Location: prepareHref(campaignId) + '#campaign-optimization-title' }).end();
        } catch (error) {
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined,
            error instanceof DirectError ? error.message : 'Не удалось изменить режим оценки кампании.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      }
      if (post && url.pathname === '/campaign/next-period') {
        if (auth && !owner) return repeatCampaignAction(url.searchParams, 'summary');
        if (!owner || !session) return response.writeHead(403).end();
        if (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'summary'))
          return response.writeHead(404).end();
        section = 'campaign';
        const form = await readForm(request, response, 8192);
        if (!form) return;
        try {
          saveNextPeriod(database, owner, campaignId, form, actor);
          return response.writeHead(303, { Location: prepareHref(campaignId) + '#next-period' }).end();
        } catch (error) {
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined,
            error instanceof DirectError ? error.message : 'Не удалось сохранить черновик периода.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      }
      if (post && url.pathname === '/campaign/creative-review') {
        if (auth && !owner) return repeatCampaignAction(url.searchParams, 'ads');
        if (!owner || !session) return response.writeHead(403).end();
        if (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'ads'))
          return response.writeHead(404).end();
        section = 'campaign';
        const form = await readForm(request, response, 4096);
        if (!form) return;
        try {
          saveCampaignCreativeReview(database, owner, campaignId, form, actor);
          return response.writeHead(303, { Location: campaignTabHref(campaignId, 'ads') + '#creative-review' }).end();
        } catch (error) {
          creativeInput = { title: form.get('title') ?? '', adText: form.get('adText') ?? '' };
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined,
            error instanceof DirectError ? error.message : 'Не удалось сохранить редакцию объявления.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      }
      if (post && (url.pathname === '/campaign/experiment' || url.pathname === '/campaign/explain-optimization')) {
        if (!auth) return response.writeHead(403).end();
        const form = await readForm(request, response, 4096);
        if (!form) return;
        const explain = url.pathname === '/campaign/explain-optimization';
        const input = explain ? url.searchParams : form;
        const id = input.getAll('ad').length === 1 ? input.get('ad') : undefined;
        const tab = !explain && form.get('action') === 'propose' ? 'ads' : 'journal';
        if (!owner || !session) return repeatCampaignAction(input, tab, 'ad', !explain && tab === 'journal' ? { by: 'experiments' } : undefined);
        if (!id || !selectCampaignContext(id, tab)) return response.writeHead(404).end();
        section = tab === 'ads' ? 'campaign' : 'history';
        experimentsOnly = tab === 'journal' && !explain;
        if (explain) {
          const href = providerJournal(form, 'goulash');
          const run = database.readCampaignDirectRuns(owner, campaignId).find(item => item.planId === form.get('run'));
          const entry = run?.optimization?.decisions.find(item => item.key === form.get('decision') && item.at === form.get('at'));
          if (run && entry) journalRecovery = href + '#' + assessmentAnchor(run.planId, entry.key, entry.at);
        }
        try {
          if (explain) {
            await explanations.explain(owner, campaignId, form);
            return response.writeHead(303, { Location: journalRecovery ?? journalUrl(campaignContext?.id) }).end();
          }
          experiments.action(owner, campaignId, form, actor);
          const href = campaignTabHref(campaignId, tab, experimentsOnly ? { by: 'experiments' } : {});
          return response.writeHead(303, { Location: href + (tab === 'ads' ? '#campaign-experiment' : '#campaign-experiments') }).end();
        } catch (error) {
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, undefined,
            error instanceof DirectError ? error.message : 'Не удалось обработать выбранное решение.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      }
      const deepSeekTrial = trialEnabled && owner ? database.readDeepSeekTrial()?.status ?? 'ready' : undefined;
      // Status of the learning example without a page reload: the client updates the
      // card in place, so focus, scroll and screen-reader position survive.
      if (get && url.pathname === '/demo/status') {
        if (!owner) return response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }).end('{"error":"auth"}');
        const payload = demoStatusPayload(database.operationsView(owner), url.searchParams.get('dataset') ?? '');
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify(payload));
      }
      if (get && sections.has(url.pathname)) {
        const value = owner ? database.read(owner) : undefined;
        if (owner && (section === 'analytics' || section === 'history') && url.searchParams.has('ad')) {
          if (url.searchParams.getAll('ad').length !== 1 ||
            !selectCampaignContext(url.searchParams.get('ad')!, section === 'analytics' ? 'results' : 'journal'))
            return response.writeHead(404).end();
          if (section === 'analytics' && isGuided(campaignId)) analyticsRunId = database.readCampaignDirectRuns(owner, campaignId)
            .findLast(run => run.steps.campaign.phase === 'confirmed')?.planId ?? '';
        }
        if (section === 'analytics' && owner && url.searchParams.has('run')) {
          const requestedRun = database.readDirect(owner, url.searchParams.get('run')!);
          if (requestedRun?.steps.campaign.phase !== 'confirmed' || (campaignContext && (requestedRun.campaignId ?? 'default') !== campaignId)) {
            return sendPage(404, value, 'Подтверждённая кампания Директа не найдена в вашем кабинете.', { input: emptyCampaign, revision: 0 });
          }
          analyticsRunId = requestedRun.planId;
        }
        if (section === 'campaign' && owner) {
          campaignId = url.searchParams.get('ad') ?? 'default';
          catalog = url.pathname === routes.campaigns && !['ad', 'example', 'campaign', 'preparation'].some(key => url.searchParams.has(key));
          if (catalog) catalogFilter = url.searchParams.get('status') ?? undefined;
          if (!workspaceExists(campaignId)) {
            catalog = true;
            return sendPage(404, value, 'Реклама не найдена в вашем кабинете.', { input: emptyCampaign, revision: 0 });
          }
          if (!catalog) {
            const guided = isGuided(campaignId);
            const existing = workspaceRun(campaignId);
            const editingPlan = !guided && url.searchParams.get('edit') === '1';
            if (url.pathname === routes.campaigns && (guided || existing && !editingPlan)) {
              const destination = new URLSearchParams(url.search);
              destination.set('ad', campaignId);
              return response.writeHead(303, { Location: routes.prepare + '?' + destination }).end();
            }
            if (url.pathname === routes.prepare) {
              if (!guided && !existing) return response.writeHead(303, { Location: campaignHref(campaignId) }).end();
              const ads = url.searchParams.get('tab') === 'ads';
              if (ads && (url.searchParams.getAll('ad').length !== 1 || url.searchParams.getAll('tab').length !== 1 ||
                !selectCampaignContext(campaignId, 'ads'))) return response.writeHead(404).end();
              if (!ads && existing) selectCampaignContext(campaignId, 'summary');
            }
          }
        }
        const saved = owner ? database.readCampaign(owner, campaignId) : undefined;
        const example = section === 'campaign' && url.searchParams.get('example') === '1';
        restore = section === 'campaign';
        saveComplete = section === 'campaign' && url.searchParams.get('campaign') === 'saved';
        if (owner && section === 'campaign' && (url.searchParams.get('preparation') === 'saved' || url.searchParams.get('campaign') === 'saved')) preparationView = { ...preparation.view(owner, undefined, undefined, campaignId), acknowledged: true };
        if (owner && example) { const prior = preparation.view(owner, undefined, undefined, campaignId).saved; preparationView = preparation.view(owner, { revision: prior.revision, value: { ...prior.value, input: { ...prior.value.input, ...exampleCampaign }, goal: 'Обращения по доставке суши и роллов', step: 1 } }, undefined, campaignId); }
        const campaign: CampaignView | undefined = owner ? {
          input: example ? exampleCampaign : saved?.draft ?? emptyCampaign,
          ...(example ? { pending: { ...exampleCampaign, title: saved?.draft.title ?? '', adText: saved?.draft.adText ?? '' }, step: 1 as const, dirty: true } : {}),
          preview: saved?.draft, revision: saved?.revision ?? 0, deepSeekTrial,
        } : undefined;
        if (section === 'history' && owner) {
          const filter = url.searchParams.get('scope');
          historyFilter = !campaignContext && (filter === 'draft' || filter === 'demo') ? filter : 'all';
          const by = url.searchParams.get('by');
          experimentsOnly = Boolean(campaignContext && by === 'experiments');
          historySource = by === 'goulash' || by === 'mine' ? by : 'all';
          operationId = url.searchParams.get('operation') ?? undefined;
          undoId = url.searchParams.get('review') ?? undefined;
          if ([operationId, undoId].some((id) => id !== undefined && !/^[0-9a-f-]{36}$/.test(id))) {
            operationId = undefined; undoId = undefined;
            return sendPage(400, value, 'Некорректная ссылка на операцию. Выберите запись в истории.', campaign);
          }
          if ([operationId, undoId].some(id => {
            if (!id) return false;
            const operation = database.readOperation(owner!, id);
            return !operation || (campaignContext && operation.campaignId !== campaignId);
          })) {
            operationId = undefined; undoId = undefined;
            return sendPage(404, value, 'Операция не найдена в этом аккаунте.', campaign);
          }
        }
        const campaignStatus = saved ? url.searchParams.get('campaign') : undefined;
        const research = section === 'campaign' && preparationView?.run?.kind === 'research' && preparationView.run.id === url.searchParams.get('research') ? preparationView.run : undefined;
        const researchMessage = research && (research.status === 'complete' ? 'Подбор завершён. Проверьте поисковые фразы.' : research.status === 'running'
          ? 'Уже есть незавершённая попытка. Откройте сохранённые результаты перед повторным действием.'
          : (research.attempts.findLast(a => a.status !== 'succeeded')?.error ?? research.plan.strategy.note ?? 'Подбор остановлен.') + ' Полученные данные сохранены. Фразы можно дополнить вручную.');
        const message = authNotice?.text ?? researchMessage ?? (url.searchParams.get('undo') === 'ok' ? 'Отмена выполнена. Связанная запись добавлена в историю.'
          : url.searchParams.get('undo') === 'already' ? 'Операция уже отменена. Повторная отмена ничего не меняет.'
          : section === 'analytics' && url.searchParams.get('filters') === 'applied' && !campaignContext ? 'Параметры сохранены. Запросите свежие отчёты в блоке «Обновить данные».'
          : section === 'analytics' && (url.searchParams.get('demo') === 'loaded' || url.searchParams.get('loaded') === '1') ? 'Новый учебный набор загружен. Предыдущая история сохранена.'
          : section === 'analytics' && url.searchParams.get('demo') === 'repeat' ? 'Этот набор уже проверен. Показан прежний результат; бюджет повторно не менялся.'
          : campaignStatus === 'prepared' ? 'Тестовый черновик подготовлен.'
          : url.searchParams.get('plan') === 'confirmed' ? 'План подтверждён. Черновик в Директе не создавался: подключите кабинет.'
          : campaignStatus === 'saved' ? 'Изменения черновика сохранены.'
          : value && url.searchParams.get('saved') === '1' ? 'Запись сохранена.' : '');
        sendPage(200, value, message, campaign, authNotice?.variant);
      } else if (post && url.pathname === '/campaign/new') {
        if (!owner) return sendPage(401, undefined, 'Войдите, чтобы создать рекламу.');
        const form = await readForm(request, response, 4096);
        if (!form) return;
        campaignId = database.createCampaignWorkspace(owner).id;
        if (form.get('flow') === 'guided') database.savePreparation(owner, { ...initialPreparation(), guided: true }, 0, undefined, 0, campaignId);
        return response.writeHead(303, { Location: campaignUrl() }).end();
      } else if (post && ['/prepare/create', '/prepare/refresh', '/prepare/continue'].includes(url.pathname)) {
        section = 'campaign';
        const form = await readForm(request, response, 4096);
        if (!form) return;
        if (!owner) return repeatCampaignAction(form, 'summary', 'campaignId');
        campaignId = form.get('campaignId') ?? '';
        if (form.getAll('campaignId').length !== 1 || !isGuided(campaignId)) return response.writeHead(404).end();
        const saved = database.readCampaign(owner, campaignId);
        const campaign = { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 };
        if (!direct?.view(owner).ownChief) return sendPage(409, database.read(owner), 'Подключите свой Яндекс Директ для работы с черновиком.', campaign);
        const action = url.pathname.slice('/prepare/'.length);
        try {
          await direct.action(owner, 'guided-' + action, form, actor);
          if (action === 'refresh' && resolvedConnection?.generation !== undefined)
            connections?.reconciled(owner, resolvedConnection.generation, form.get('planId') ?? '');
          return response.writeHead(303, { Location: prepareHref(campaignId) }).end();
        } catch (error) {
          if (resolvedConnection?.generation !== undefined) {
            connections?.noteFailure(owner, resolvedConnection.generation, error);
            if (!connections?.resolve(owner)) direct = undefined;
          }
          return sendPage(error instanceof DirectError ? 409 : 500, database.read(owner),
            error instanceof DirectError ? error.message : 'Не удалось завершить действие. Откройте состояние черновика.', campaign);
        }
      } else if (get && url.pathname === '/preparation/research-status') {
        if (!owner) return response.writeHead(401).end();
        campaignId = url.searchParams.get('ad') ?? 'default';
        if (!workspaceExists(campaignId)) return response.writeHead(404).end();
        const revision = url.searchParams.get('revision') ?? '';
        if (!/^(0|[1-9]\d{0,9})$/.test(revision)) return response.writeHead(400).end();
        const saved = database.readPreparation(owner, campaignId);
        const run = saved && saved.revision > Number(revision) ? database.readRun(owner, saved.value.activeRunId, campaignId)?.value : undefined;
        const active = run?.kind === 'research' && run.startedFromRevision === Number(revision) ? run : undefined;
        const requests = active?.plan.strategy.requests ?? [];
        const phase = !active ? 'region' : active.status !== 'running' ? active.status
          : active.attempts.some(a => a.kind === 'judge') ? 'deepseek' : 'wordstat';
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return response.end(JSON.stringify({ phase, done: requests.filter(r => r.phase === 'complete').length, total: requests.length }));
      } else if (get && url.pathname === '/preparation/research.json') {
        if (!owner) return response.writeHead(401).end();
        campaignId = url.searchParams.get('ad') ?? 'default';
        if (!workspaceExists(campaignId)) return response.writeHead(404).end();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="campaign-preparation.json"' });
        return response.end(JSON.stringify({ preparation: database.readPreparation(owner, campaignId), runs: database.readRuns(owner, campaignId) }, null, 2));
      } else if (post && url.pathname === '/preparation/create-draft') {
        const form = await readForm(request, response, 64 * 1024); if (!form) return;
        if (!owner) return repeatCampaignAction(form, 'summary');
        campaignId = form.get('ad') ?? 'default';
        if (form.getAll('ad').length > 1 || !workspaceExists(campaignId)) return response.writeHead(404).end();
        if (isGuided(campaignId)) return response.writeHead(303, { Location: prepareHref(campaignId) }).end();
        // The final step owns the budget, so it must be persisted before confirmation.
        const saved = await preparation.action(owner, 'save', form, actor, campaignId);
        if (saved.status >= 400) {
          preparationView = saved.view;
          const campaign = database.readCampaign(owner, campaignId);
          return sendPage(saved.status, database.read(owner), saved.message, { input: campaign?.draft ?? emptyCampaign, preview: campaign?.draft, revision: campaign?.revision ?? 0 });
        }
        const revision = database.readPreparation(owner, campaignId)!.revision;
        const confirmForm = new URLSearchParams(form);
        confirmForm.set('preparationRevision', String(revision));
        const confirmed = await preparation.action(owner, 'confirm', confirmForm, actor, campaignId);
        if (confirmed.status >= 400) {
          preparationView = confirmed.view;
          const campaign = database.readCampaign(owner, campaignId);
          return sendPage(confirmed.status, database.read(owner), confirmed.message, { input: campaign?.draft ?? emptyCampaign, preview: campaign?.draft, revision: campaign?.revision ?? 0 });
        }
        const prepared = database.readPreparation(owner, campaignId);
        const plan = database.readPlan(owner, prepared?.value.confirmedPlanId, campaignId);
        if (!plan) return sendPage(409, database.read(owner), 'Подтверждённый план не найден. Повторите проверку.');
        if (!direct || !direct.view(owner).enabled || !direct.view(owner).ownChief) {
          return response.writeHead(303, { Location: campaignUrl() + '&plan=confirmed' }).end();
        }
        const runs = database.readDirectRuns(owner).filter(run => run.campaignPlanId === plan.id && (run.campaignId ?? 'default') === campaignId);
        const existing = runs.at(-1);
        if (existing?.complete) return response.writeHead(303, { Location: campaignUrl() + '&campaign=prepared#direct' }).end();
        try {
          if (!existing) {
            const campaign = database.readCampaign(owner, campaignId);
            if (!campaign) return sendPage(409, database.read(owner), 'Черновик кампании не найден.');
            const startDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
            await direct.action(owner, 'prepare', new URLSearchParams({
              campaignPlanId: plan.id, revision: String(campaign.revision), campaignId, newRun: 'yes', startDate,
              name: campaignDisplayName(prepared!.value).slice(0, 100),
            }), actor);
          }
          const state = database.readDirectRuns(owner).filter(run => run.campaignPlanId === plan.id && (run.campaignId ?? 'default') === campaignId).at(-1);
          if (!state || state.complete) throw new DirectError('Не удалось подготовить черновик Директа. Откройте кампанию и проверьте состояние.');
          await direct.action(owner, 'create', new URLSearchParams({
            planId: state.planId, storageRevision: String(state.storageRevision), confirm: 'yes', campaignId,
          }), actor);
        } catch (error) {
          preparationView = preparation.view(owner, undefined, undefined, campaignId);
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(409, database.read(owner), error instanceof DirectError ? error.message : 'Не удалось создать черновик в Директе. Проверьте состояние кампании.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
        return response.writeHead(303, { Location: campaignUrl() + '&campaign=prepared#direct' }).end();
      } else if (post && url.pathname.startsWith('/preparation/')) {
        const form = await readForm(request, response, 64 * 1024); if (!form) return;
        if (!owner) return repeatCampaignAction(form, 'summary');
        campaignId = form.get('ad') ?? 'default';
        if (form.getAll('ad').length > 1 || !workspaceExists(campaignId)) return response.writeHead(404).end();
        const action = url.pathname.slice('/preparation/'.length);
        let result = await preparation.action(owner, action, form, actor, campaignId);
        if (action === 'offer' && result.status < 400 && result.view.saved.value.guided) {
          result = await preparation.action(owner, 'confirm', new URLSearchParams({
            preparationRevision: String(result.view.saved.revision), policyHash, confirmPlan: 'yes',
          }), actor, campaignId);
        }
        if (result.status < 400 && !['/preparation/resume', '/preparation/edit-rows'].includes(url.pathname)) {
          const research = ['/preparation/research', '/preparation/continue-research'].includes(url.pathname) && result.view.run?.kind === 'research' ? result.view.run.id : undefined;
          const location = !isGuided(campaignId) && workspaceRun(campaignId) ? campaignPlanHref(campaignId) + '&preparation=saved'
            : form.has('ad') ? campaignUrl() + '&preparation=saved' : routes.campaigns + '?preparation=saved';
          return response.writeHead(303, { Location: location + (research ? '&research=' + encodeURIComponent(research) : '') }).end();
        }
        preparationView = result.view;
        const saved = database.readCampaign(owner, campaignId);
        sendPage(result.status, database.read(owner), result.message, { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
      } else if (get && url.pathname === '/direct/research.json') {
        if (!owner || !direct?.view(owner).enabled) return response.writeHead(403).end();
        const plan = direct.view(owner).phrasePlan;
        if (!plan) return response.writeHead(404).end();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="phrase-research.json"' });
        return response.end(JSON.stringify(plan, null, 2));
      } else if (post && url.pathname.startsWith('/direct/')) {
        if (!owner) return sendPage(401, undefined, 'Войдите в аккаунт для работы с Директом.');
        if (!direct?.view(owner).enabled) return response.writeHead(403).end();
        const form = await readForm(request, response, 64 * 1024);
        if (!form) return;
        const action = url.pathname.slice('/direct/'.length);
        const actionRun = action === 'prepare' ? undefined : database.readDirect(owner, form.get('planId') ?? '');
        campaignId = (action === 'prepare'
          ? database.readPlan(owner, form.get('campaignPlanId') ?? undefined)?.campaignId
          : actionRun?.campaignId) ?? 'default';
        if (action === 'undo') section = 'history';
        if (actionRun && (action === 'rename' || action === 'undo' || action === 'refresh' && !actionRun.guidedDraft))
          selectCampaignContext(campaignId, action === 'undo' ? 'journal' : 'summary');
        const journal = action === 'undo' ? providerJournal(form, 'mine') : undefined;
        const rename = action === 'undo' ? actionRun?.events.find(item => item.kind === 'rename' && item.id === form.get('id')) : undefined;
        if (rename) journalRecovery = journal + '#direct-event-' + encodeURIComponent(rename.id);
        try {
          campaignId = await direct.action(owner, action, form, actor) ?? campaignId;
          if(action==='refresh'&&resolvedConnection?.generation!==undefined)connections?.reconciled(owner,resolvedConnection.generation,form.get('planId')??'');
          if (journal && actionRun && rename) {
            const result = database.readDirect(owner, actionRun.planId)?.events.find(event => event.id === rename.id);
            return response.writeHead(303, { Location: journal + '#direct-event-' + encodeURIComponent(result?.undoneBy ?? rename.id) }).end();
          }
          const location = journal ?? (campaignContext ? campaignTabHref(campaignId, campaignContext.tab) : campaignUrl() + '#direct');
          return response.writeHead(303, { Location: location }).end();
        } catch (error) {
          if(resolvedConnection?.generation!==undefined)connections?.noteFailure(owner,resolvedConnection.generation,error);
          directInput = { action, startDate:(form.get('startDate')??'').slice(0,10), name: (form.get('name') ?? '').slice(0, 255), weekly: (form.get('weekly') ?? '').slice(0, 10), keyword: (form.get('keyword') ?? '').slice(0, 100),
            offer: (form.get('offer') ?? '').slice(0, 100), negatives: (form.get('negatives') ?? '').slice(0, 2100), additional: (form.get('additional') ?? '').slice(0, 1000), selected: form.getAll('selected').slice(0, 30) };
          const saved = database.readCampaign(owner, campaignId);
          return sendPage(error instanceof DirectError ? 409 : 500, database.read(owner),
            error instanceof DirectError ? error.message : 'Не удалось завершить действие. Сверьте состояние Директа.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      } else if(post&&url.pathname.startsWith('/analytics/')){
        section='analytics';
        if (!owner) return repeatAfterSignIn(authDestination(routes.results + url.search) ?? routes.results);
        if (url.searchParams.has('ad')) {
          if (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'results'))
            return response.writeHead(404).end();
          analyticsRunId = database.readCampaignDirectRuns(owner, campaignId)
            .findLast(run => run.steps.campaign.phase === 'confirmed')?.planId ?? '';
        }
        const form=await readForm(request,response,4096);if(!form)return;
        // Period segments submit `days`; translate them to explicit dates so the same save/refresh path runs.
        const segment=form.getAll('days').length===1?form.get('days'):'';
        if(segment&&['7','30'].includes(segment)){const{dateTo}=analyticsDates(Date.now());const from=new Date(Date.parse(dateTo)-(Number(segment)-1)*86400000).toISOString().slice(0,10),show=(iso:string)=>iso.split('-').reverse().join('.');form.set('dateFrom',show(from));form.set('dateTo',show(dateTo));}
        else if (url.pathname === '/analytics/settings' && form.get('period') === 'custom') {
          for (const [date, customDate] of [['dateFrom', 'customFrom'], ['dateTo', 'customTo']]) {
            const values = form.getAll(customDate);
            form.set(date, values.length === 1 ? values[0] : '');
          }
        }
        analyticsInput=Object.fromEntries(form);
        const saved=database.readCampaign(owner, campaignId),campaign={input:saved?.draft??emptyCampaign,preview:saved?.draft,revision:saved?.revision??0};
        try{
          const field=(key:string)=>form.getAll(key).length===1?form.get(key)!:'';
          if (campaignContext && ['/analytics/settings', '/analytics/refresh'].includes(url.pathname)) {
            const selected = field('directRunId');
            const run = selected ? database.readDirect(owner, selected) : undefined;
            if (form.getAll('directRunId').length !== 1 || form.getAll('revision').length !== 1 ||
              (selected ? !run || (run.campaignId ?? 'default') !== campaignId || run.steps.campaign.phase !== 'confirmed' : analyticsRunId !== '') ||
              (url.pathname === '/analytics/refresh' && (!selected || field('source') === 'metrika_site'))) {
              return sendPage(404, database.read(owner), 'Отчёт не относится к выбранной кампании.', campaign);
            }
            analyticsRunId = selected;
          }
          const scope = campaignContext?.id;
          if(!scope && (url.pathname==='/analytics/counter' || url.pathname==='/analytics/disconnect' || form.has('reportId'))){
            const selected=field('directRunId');
            if(selected && database.readDirect(owner,selected)?.steps.campaign.phase==='confirmed') analyticsRunId=selected;
          }
          if(url.pathname==='/analytics/settings')analytics.save(owner,form,true,scope);
          else if(url.pathname==='/analytics/counter'){if(scope || field('confirm')!=='read')throw new DirectError('Настройте цель и счётчик в «Подключениях».');await analytics.counter(owner,field('counterId'),Number(field('revision')));}
          else if(url.pathname==='/analytics/disconnect'){
            if(scope)throw new DirectError('Откройте «Подключения», чтобы изменить доступ.');
            disconnectLegacyMetrika(owner, field('revision'), field('confirm'), field('disconnectProof'));
          }
          else if(url.pathname==='/analytics/refresh'){
            if(form.has('reportId')){
              const id=field('reportId');
              if(!id || form.has('source')) throw new DirectError('Выберите ожидающий отчёт.');
              await analytics.reconcileDirectReport(owner,id,scope);
            } else {
              const source=field('source');
              if(!['direct_reports','metrika_site','metrika_direct','metrika_daily'].includes(source))throw new DirectError('Выберите источник отчёта.');
              const settings = form.has('revision') ? analytics.save(owner,form,true,scope) : undefined;
              await analytics.refresh(owner,source as any,settings?.revision,scope);
            }
          }
          else return response.writeHead(404).end();
          const filters = url.pathname === '/analytics/settings' ? { filters: 'applied' } : undefined;
          const location = campaignContext ? campaignTabHref(campaignId, 'results', { ...filters, ...(analyticsRunId ? { run: analyticsRunId } : {}) })
            : routes.results + (filters ? '?filters=applied' : analyticsRunId ? '?run=' + encodeURIComponent(analyticsRunId) : '');
          return response.writeHead(303, { Location: location }).end();
        }catch(error){
          if (error instanceof AnalyticsDateError) analyticsErrors = { [error.field]: error.message };
          return sendPage(409,database.read(owner),error instanceof DirectError?error.message:'Чтение недоступно. Прежние отчёты и выбор сохранены.',campaign);
        }
      } else if (post && ['/operations/undo', '/demo/load', '/demo/run','/demo/permission'].includes(url.pathname)) {
        if (!owner) return sendPage(401, undefined, 'Войди через Яндекс ID для работы с тестовыми операциями.');
        const form = await readForm(request, response, 4096);
        if (!form) return;
        const saved = database.readCampaign(owner);
        const current = { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0, deepSeekTrial };
        const fail = (status: number, message: string) => sendPage(status, database.read(owner!), message, current);
        // A failed learning-example action reports next to the card itself, not above real numbers.
        const failDemo = (status: number, message: string) => { section = 'analytics'; demoNotice = { text: message, error: status >= 400 }; return sendPage(status, database.read(owner!), '', current); };
        const field = (key: string) => form.getAll(key).length === 1 ? form.get(key)! : '';
        if(url.pathname==='/demo/permission'){
          section='analytics';const enabled=field('enabled')==='yes';
          if(!['yes','no'].includes(field('enabled'))||!/^\d+$/.test(field('revision'))||enabled&&field('confirm')!=='control')return failDemo(400,'Проверьте полномочия и подтвердите включение.');
          try{database.setDemoPermission(owner,enabled,Number(field('revision')),actor,field('datasetId'));}catch(error){return failDemo(409,error instanceof DirectError?error.message:'Полномочия не изменены.');}
          return response.writeHead(303,{Location: routes.results + '#demo'}).end();
        }
        if (url.pathname === '/operations/undo') {
          if (url.searchParams.has('ad') && (url.searchParams.getAll('ad').length !== 1 || !selectCampaignContext(url.searchParams.get('ad')!, 'journal')))
            return response.writeHead(404).end();
          const filters: Record<string, string> = {};
          const scope = url.searchParams.get('scope'), by = url.searchParams.get('by');
          if (!campaignContext && (scope === 'draft' || scope === 'demo')) filters.scope = historyFilter = scope;
          if (by === 'goulash' || by === 'mine') filters.by = historySource = by;
          const id = field('id');
          if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, 'Некорректный номер операции.');
          const operation = database.readOperation(owner, id);
          if (!operation || (campaignContext && operation.campaignId !== campaignId)) return fail(404, 'Операция не найдена.');
          undoId = id;
          if (field('confirm') !== 'undo') return fail(400, 'Сначала проверьте последствия и подтвердите отмену. Данные не изменены.');
          const result = database.undo(owner, id, actor);
          if (result === 'missing') return fail(404, 'Операция не найдена.');
          if (result === 'unsupported') return fail(400, 'Для этой операции отмена не поддерживается.');
          if (result === 'conflict') return fail(409, 'Конфликт отмены: есть более новая правка. Актуальное состояние сохранено.');
          const linked = database.readOperation(owner, id)?.undoneBy;
          const location = journalUrl(campaignContext?.id, filters, { undo: result, ...(linked ? { operation: linked } : {}) });
          return response.writeHead(303, { Location: location }).end();
        }
        if (url.pathname === '/demo/load') {
          section = 'analytics';
          const scenario = field('scenario'), revision = field('revision');
          if (!Object.hasOwn(demoCases, scenario) || !/^(0|[1-9]\d{0,8})$/.test(revision)) return failDemo(400, 'Выберите учебный сценарий из списка.');
          const preset = field('preset') === demoPreset;
          if (preset ? form.has('planId') : form.has('preset') || !field('planId'))
            return failDemo(409, 'Выберите готовый учебный набор или подтверждённую версию плана.');
          try{if (!database.loadDemo(owner, scenario as DemoCase, Number(revision), actor, preset ? { preset: demoPreset } : field('planId'))) return failDemo(409, 'Учебный набор уже изменён. Проверьте актуальные данные.');}
          catch(error){return failDemo(409,error instanceof DirectError?error.message:'Учебный набор не загружен.');}
        } else {
          section = 'analytics';
          const datasetId = field('datasetId');
          if (!/^[0-9a-f-]{36}$/.test(datasetId)) return failDemo(400, 'Сначала загрузите учебный набор.');
          const job = database.enqueueDemo(owner, datasetId, actor);
          if (!job) return failDemo(409, 'Набор заменён или полномочия не включены. Проверьте версию плана и включите контрольную автоматику.');
          return response.writeHead(303, { Location: routes.results + (job.status === 'completed' ? '?demo=repeat' : '') + '#demo' }).end();
        }
        response.writeHead(303, { Location: routes.results + '?demo=loaded#demo' }).end();
      } else if (post && url.pathname === '/test-record') {
        if (!owner) return sendPage(401, undefined, 'Войди через Яндекс ID, чтобы сохранить запись.');
        await saveRecord(request, response, sendPage, (content) => database.write(owner, content));
      } else if (post && url.pathname.startsWith('/campaign/') && campaignActions.has(url.pathname.slice('/campaign/'.length))) {
        const action = url.pathname.slice('/campaign/'.length);
        if (action === 'deepseek' && !trialEnabled) return response.writeHead(404).end();
        if (action === 'deepseek') return sendPage(409, owner ? database.read(owner) : undefined, 'Прежняя платная проба закрыта. Используйте подготовку с единым журналом попыток.', owner ? { input: emptyCampaign, revision: 0 } : undefined);
        if (!owner) return sendPage(401, undefined, 'Войди через Яндекс ID, чтобы работать с черновиком.');
        const form = await readForm(request, response, 64 * 1024);
        if (!form) return;
        const result = await campaignAction(action, form, database, owner, actor, deepSeekTrial, runDeepSeekTrial);
        legacyCampaign = true;
        if (result.location) return response.writeHead(result.status, { Location: result.location }).end();
        sendPage(result.status, database.read(owner), result.message, result.campaign);
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      console.error('Не удалось обработать запрос.', error instanceof Error ? error.name : 'UnknownError');
      if (!response.headersSent && !response.destroyed) {
        sendPage(500, undefined, 'Ошибка обработки запроса. Повтори попытку.');
      }
    }
  });
  let worker: ReturnType<typeof setInterval>;
  let nextAssessment = 0;
  server.on('listening', () => {
    worker = setInterval(() => {
      try { database.processDemoJob(); }
      catch (error) { console.error('Ошибка обработки тестового задания.', error instanceof Error ? error.name : 'UnknownError'); }
      if (Date.now() < nextAssessment) return;
      nextAssessment = Date.now() + 30000;
      try { optimization.tick(); }
      catch (error) { console.error('Ошибка оценки кампании.', error instanceof Error ? error.name : 'UnknownError'); }
    }, 250);
    worker.unref();
  });
  server.on('close', () => clearInterval(worker));
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.GOULASH_PORT || '8767');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('GOULASH_PORT должен быть целым числом от 0 до 65535');
  }
  const publicUrl = process.env.GOULASH_PUBLIC_ORIGIN;
  const publicOrigin = publicUrl ? new URL(publicUrl) : undefined;
  if (publicOrigin && (publicOrigin.protocol !== 'https:' || publicOrigin.origin !== publicUrl)) {
    throw new Error('GOULASH_PUBLIC_ORIGIN должен быть HTTPS origin без завершающего слеша');
  }
  const bind = process.env.GOULASH_BIND || host;
  if (!isIPv4(bind) || bind === '0.0.0.0' || (!publicOrigin && bind !== host)) {
    throw new Error('GOULASH_BIND должен указывать конкретный IPv4, локальный режим использует 127.0.0.1');
  }

  const credentials = process.env.CREDENTIALS_DIRECTORY;
  const clientId = (credentials
    ? readFileSync(join(credentials, 'yandex_client_id'), 'utf8') : process.env.YANDEX_CLIENT_ID)?.trim();
  const clientSecret = (credentials
    ? readFileSync(join(credentials, 'yandex_client_secret'), 'utf8') : process.env.YANDEX_CLIENT_SECRET)?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret) || (publicOrigin && !clientId)) {
    throw new Error('Для входа через Яндекс ID нужны YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET');
  }
  const directory = process.env.GOULASH_DATA_DIR || join(
    process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'),
    'Goulash-tech-2',
  );
  let runDeepSeekTrial: ReturnType<typeof createDeepSeekTrial> | undefined;
  if (process.argv.includes('--deepseek-trial')) {
    if (publicOrigin || process.stdin.isTTY) {
      throw new Error('Проба DeepSeek доступна только локально с ключом, переданным через stdin.');
    }
    const key = readFileSync(0, 'utf8').trim();
    if (!key) throw new Error('Ключ DeepSeek отсутствует. Используй команду со скрытым вводом из README.md.');
    runDeepSeekTrial = createDeepSeekTrial(key);
  }
  const database = openDatabase(directory);
  const auth = clientId && clientSecret
    ? createYandexAuth(database, clientId, clientSecret, { secureCookies: Boolean(publicOrigin) }) : undefined;
  let connections:ReturnType<typeof createDirectConnections>|undefined;
  if(process.argv.includes('--connect-direct')) {
    if(!auth)throw new Error('Для штатного подключения Директа настройте вход Яндекс ID.');
    const directClientId=(credentials?readFileSync(join(credentials,'yandex_direct_client_id'),'utf8'):process.env.GOULASH_DIRECT_CLIENT_ID_FILE?readFileSync(process.env.GOULASH_DIRECT_CLIENT_ID_FILE,'utf8'):process.env.YANDEX_DIRECT_CLIENT_ID)?.trim();
    const directClientSecret=(credentials?readFileSync(join(credentials,'yandex_direct_client_secret'),'utf8'):process.env.YANDEX_DIRECT_CLIENT_SECRET)?.trim()
      || (process.env.GOULASH_DIRECT_APP_SECRET_FILE?await dpapiToken(process.env.GOULASH_DIRECT_APP_SECRET_FILE)():undefined);
    if(!directClientId||!directClientSecret)throw new Error('Нужны отдельные ClientID/защищённый secret приложения Директа.');
    const keyFile=credentials?join(credentials,'direct_token_key'):process.env.GOULASH_DIRECT_TOKEN_KEY_FILE;
    connections=createDirectConnections(database,{clientId:directClientId,clientSecret:directClientSecret,codec:createSecretCodec({keyFile,credentialDirectory:credentials})});
  }
  let directConnection: DirectConnection | undefined;
  if (process.argv.includes('--direct')) {
    if (publicOrigin) throw new Error('Директ с DPAPI доступен только локально.');
    const owner = auth ? process.env.GOULASH_DIRECT_OWNER : 'local';
    if (!owner) throw new Error('Для Яндекс ID укажите GOULASH_DIRECT_OWNER — точный ID владельца сессии.');
    const account = process.env.GOULASH_DIRECT_ACCOUNT?.trim();
    if (!account || !/^[1-9]\d{0,19}$/.test(account)) throw new Error('Для локального DPAPI укажите номер своего кабинета в GOULASH_DIRECT_ACCOUNT.');
    directConnection = { api: createDirectApi(dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'Direct.dpapi'))),
      owner, account, mode: 'live' };
  }
  let wordstat: Wordstat | undefined;
  const serverResearch = credentials ? loadServerResearch(Boolean(auth), process.argv, process.env) : undefined;
  if (serverResearch) wordstat = serverResearch.wordstat;
  else if (process.argv.includes('--wordstat')) {
    if (!(directConnection || connections) || publicOrigin) throw new Error('Для локального Wordstat нужно подключение Директа (--connect-direct или --direct).');
    const folder = process.env.GOULASH_WORDSTAT_FOLDER;
    if (!folder) throw new Error('Для Wordstat укажите GOULASH_WORDSTAT_FOLDER.');
    const key = await dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'Wordstat.dpapi'))();
    wordstat = createWordstat(key, folder);
  }
  let intelligence: PhraseIntelligence | undefined;
  if (serverResearch) intelligence = serverResearch.intelligence;
  else if (process.argv.includes('--phrase-ai')) {
    if (publicOrigin) throw new Error('Локальный ключ DeepSeek через DPAPI недоступен на публичном стенде.');
    const key = await dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'PhraseAI.dpapi'))();
    intelligence = createPhraseIntelligence(key);
  }
  const cachedGeo = process.argv.find(a => a.startsWith('--cached-geo='))?.slice(13);
  const cachedExport = process.argv.find(a => a.startsWith('--cached-export='))?.slice(16);
  if (publicOrigin && cachedGeo) throw new Error('Локальный cached snapshot недоступен публичному серверу.');
  let metrikaProvider:MetrikaProvider|undefined;
  if(process.argv.includes('--metrika-read')){
    const owner=auth?process.env.GOULASH_METRIKA_OWNER:'local';if(!owner)throw new Error('Укажите GOULASH_METRIKA_OWNER — точного владельца чтения Метрики.');
    if(publicOrigin&&!credentials)throw new Error('Публичная Метрика требует systemd credential; локальный DPAPI запрещён.');
    const token=credentials?async()=>readFileSync(join(credentials,'metrika_token'),'utf8').trim():dpapiToken(join(process.env.LOCALAPPDATA||'','Goulash-tech-2','tokens','Metrika.dpapi'));
    metrikaProvider={owner,mode:'live',configId:metrikaConfigId(owner,process.env.GOULASH_METRIKA_CONFIG_VERSION??'1',credentials?'systemd':'dpapi'),api:createMetrikaApi(token)};
  }
  const researchAccess = serverResearch?.allowed ?? localResearchAccess(Boolean(auth), process.argv, process.env);
  let metrikaConnections: ReturnType<typeof createMetrikaConnections> | undefined;
  if (process.argv.includes('--connect-metrika')) {
    if (!auth) throw new Error('Для подключения Метрики настройте вход Яндекс ID.');
    const id = (credentials ? readFileSync(join(credentials, 'yandex_metrika_client_id'), 'utf8') : process.env.YANDEX_METRIKA_CLIENT_ID)?.trim();
    const secret = (credentials ? readFileSync(join(credentials, 'yandex_metrika_client_secret'), 'utf8') : process.env.YANDEX_METRIKA_CLIENT_SECRET)?.trim() ||
      (process.env.GOULASH_METRIKA_APP_SECRET_FILE ? await dpapiToken(process.env.GOULASH_METRIKA_APP_SECRET_FILE)() : undefined);
    if (!id || !secret) throw new Error('Нужны ClientID и защищённый секрет приложения Метрики.');
    const keyFile = credentials ? join(credentials, 'metrika_oauth_key') : process.env.GOULASH_METRIKA_OAUTH_KEY_FILE;
    metrikaConnections = createMetrikaConnections(database, { clientId: id, clientSecret: secret,
      codec: createSecretCodec({ keyFile, credentialDirectory: credentials }) });
  }
  const publicPilotDatabase = publicOrigin ? openDatabase(join(directory, 'pilot-demo')) : undefined;
  const approvalCredential = credentials && join(credentials, 'direct_launch_approval');
  const approvalPath = process.env.GOULASH_DIRECT_LAUNCH_APPROVAL_FILE ||
    (approvalCredential && existsSync(approvalCredential) ? approvalCredential : undefined);
  const launchApproval = approvalPath ? (await import('./direct-launch.ts')).parseDirectLaunchApproval(
    readProtectedFile(approvalPath, credentials).toString('utf8')) : undefined;
  const server = createApp(database, auth, publicOrigin, runDeepSeekTrial, directConnection, wordstat, intelligence, undefined,
    cachedGeo ? loadCachedResearch(cachedGeo,cachedExport) : {}, connections, metrikaProvider, researchAccess, undefined, publicPilotDatabase, metrikaConnections, launchApproval);
  server.listen(port, bind, () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`http://${bind}:${address.port}`);
  });
}
