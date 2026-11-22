import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { initialPreparation } from '../../src/campaign-plan.ts';
import { openDatabase } from '../../src/database.ts';
import { DirectError, dpapiToken } from '../../src/direct-api.ts';
import { createDirectConnections } from '../../src/direct-connect.ts';
import type { DirectConnectConfig } from '../../src/direct-connect.ts';
import { createSecretCodec } from '../../src/direct-secrets.ts';
import { policyHash } from '../../src/phrase-policy.ts';
import { rollstarGoal } from '../../src/pilot.ts';
import type { PilotPhase, PilotProvider, PilotTarget } from '../../src/pilot.ts';
import { createPreparationService } from '../../src/preparation.ts';
import { pilotHref, prepareHref, routes } from '../../src/routes.ts';
import { createApp } from '../../src/server.ts';
import { styles } from '../../src/ui-style.ts';
import { callbackPath, createYandexAuth } from '../../src/yandex-auth.ts';
import { e2Fixture } from './e2.ts';

type Command = Parameters<PilotProvider['dispatch']>[1];
type Faults = {
  moderation: 'approve' | 'reject';
  unknown?: Command;
  notSent?: Command;
  ambiguousReceipt?: boolean;
  report: 'auto' | 'waiting' | 'stale' | 'ready' | 'settled';
  advertiser: boolean; goal: boolean; testOrder: boolean; budget: boolean; attribution: boolean; customers: boolean;
  spendKop?: number;
};
type ProviderState = {
  phase: PilotPhase; reads: number; stoppedReports: number; testOrders: number; impressions?: true;
  writes: { id: string; command: Command; outcome: 'applied' | 'not_sent' }[];
};
const testId = 'rollstar-test-order';
const trainingPrefix = '/_preview/training';
const livePrefix = '/_preview/live';
const modeCookie = 'goulash_preview=live';
type LiveCabinet = { directory: string; clientId: string; clientSecret: string; requestJson?: typeof fetch; direct?: DirectConnectConfig };
async function writeState(filename: string, state: object) {
  const next = filename + '.' + randomUUID();
  await writeFile(next, JSON.stringify(state));
  for (let attempt = 0; ; attempt++) {
    try { await rename(next, filename); return; }
    catch (error) {
      if (attempt === 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}

async function seedRollstar(x: ReturnType<typeof e2Fixture>) {
  const { db, owner } = x;
  const existing = db.readCampaignWorkspaces(owner).find(({ id }) => db.readPreparation(owner, id)?.value.campaignName === 'Rollstar');
  if (existing) {
    if (!db.readCampaignDirectRuns(owner, existing.id).some(run => run.guidedDraft && run.complete)) throw new Error('Учебный черновик не завершён.');
    if (!x.manager.resolve(owner)) await x.connect();
    return existing.id;
  }
  const workspace = db.createCampaignWorkspace(owner).id;
  db.savePreparation(owner, { ...initialPreparation(), guided: true }, 0, undefined, 0, workspace);
  const prep = createPreparationService(db);
  const active = () => db.readPreparation(owner, workspace)!;
  const actor = 'Владелец Rollstar · учебный кабинет';
  const submit = async (action: string, extra: Record<string, string>) => {
    const form = new URLSearchParams({ ad: workspace, policyHash, preparationRevision: String(active().revision), ...extra });
    const result = await prep.action(owner, action, form, actor, workspace);
    assert.equal(result.status, 200, result.message);
  };
  await submit('confirm-profile', {
    campaignName: 'Rollstar', description: 'Rollstar доставляет роллы и сеты в Екатеринбурге.', region: 'Екатеринбург',
    url: 'https://rollstar.ru/ekb/', goal: 'Принятый заказ', editorVersion: '3', profileEditor: 'yes',
    offer0: 'Роллы и сеты', kind0: 'product',
  });
  await submit('offer', { title: 'Rollstar — роллы и сеты', adText: 'Роллы и сеты с доставкой по Екатеринбургу.',
    budget: '7000', period: '7', selectionEditor: 'yes', phrases: 'доставка роллов', manualReview: 'yes' });
  await submit('confirm', { confirmPlan: 'yes' });
  if (!x.manager.resolve(owner)) await x.connect();
  const connection = x.manager.resolve(owner)!;
  await x.service().action(owner, 'guided-create', new URLSearchParams({
    campaignId: workspace, campaignPlanId: active().value.confirmedPlanId!, preparationRevision: String(active().revision),
    account: connection.account, generation: String(connection.generation), confirm: 'yes',
  }), actor);
  return workspace;
}

export async function pilotBrowser(directory: string, live?: LiveCabinet) {
  const dest = resolve(directory);
  mkdirSync(dest, { recursive: true });
  const marker = join(dest, 'rollstar-fixture');
  if (existsSync(join(dest, 'stage2.sqlite')) && !existsSync(marker)) throw new Error('Для имитации нужна отдельная локальная база.');
  if (!existsSync(marker)) writeFileSync(marker, 'Rollstar · local fixture\n', { flag: 'wx' });
  let x: ReturnType<typeof e2Fixture>;
  const directFile = join(dest, 'fixture-direct.json');
  const transport: typeof fetch = async (url, options) => {
    const writes = x.a.writes().length + x.b.writes().length;
    try { return await x.provider(url, options); }
    finally {
      if (x.a.writes().length + x.b.writes().length > writes)
        await writeState(directFile, { a: x.a.records, b: x.b.records });
    }
  };
  if (live) {
    mkdirSync(live.directory, { recursive: true });
    if (realpathSync(live.directory) === realpathSync(dest) || existsSync(join(live.directory, 'rollstar-fixture')))
      throw new Error('Для входа через Яндекс ID нужен отдельный каталог данных.');
    if (live.direct?.mode === 'fixture') throw new Error('Настоящий кабинет требует настоящего доступа к Директу.');
  }
  x = e2Fixture(dest, { transport, liveLogin: Boolean(live) });
  let liveDatabase: ReturnType<typeof openDatabase> | undefined;
  try {
    if (existsSync(directFile)) {
      const prior = JSON.parse(readFileSync(directFile, 'utf8'));
      Object.assign(x.a.records, prior.a);
      Object.assign(x.b.records, prior.b);
    }
    const workspace = await seedRollstar(x);
    const run = x.db.readCampaignDirectRuns(x.owner, workspace).at(-1)!;
    const filename = join(dest, 'pilot-provider.json');
    const state: ProviderState = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {
      phase: 'draft', reads: 0, stoppedReports: 0, testOrders: 0, writes: [],
    };
    const faults: Faults = { moderation: 'approve', report: 'auto', advertiser: true, goal: true, testOrder: true, budget: true, attribution: true, customers: true };
    const persist = () => writeState(filename, state);
    const verify = (target: PilotTarget) => {
      if (target.owner !== x.owner || target.account !== run.account || target.run !== run.planId ||
          target.campaign !== run.steps.campaign.id || target.ad !== run.steps.ad.id)
        throw new DirectError('Учебный объект не найден.');
      if (existsSync(filename)) Object.assign(state, JSON.parse(readFileSync(filename, 'utf8')));
    };
    const provider: PilotProvider = {
      mode: 'fixture',
      async observe(target, receipt) {
        verify(target);
        if (['reviewing', 'starting', 'stopping'].includes(state.phase)) {
          if (++state.reads >= 2) {
            if (state.phase === 'reviewing') state.phase = faults.moderation === 'approve' ? 'ready' : 'rejected';
            else if (state.phase === 'starting') { state.phase = 'running'; state.impressions = true; }
            else state.phase = 'stopped';
          }
          await persist();
        }
        return {
          account: target.account, campaign: target.campaign, ad: target.ad, phase: state.phase,
          receipt: receipt && !faults.ambiguousReceipt ? state.writes.find(item => item.id === receipt)?.outcome ?? 'not_sent' : undefined,
          reason: state.phase === 'rejected' ? 'Учебное отклонение: уточните условия доставки в объявлении.' : undefined,
          advertiser: faults.advertiser ? 'Rollstar · учебный рекламодатель' : null, marked: faults.advertiser, canManage: true,
          currency: 'RUB', vat: 22, counter: faults.goal ? rollstarGoal : null, landing: target.landing,
          period: { ...target.period, timeZone: 'Europe/Moscow', search: 'WB_MAXIMUM_CLICKS', network: 'SERVING_OFF',
            portfolio: false, spendLimitMicros: faults.budget ? target.period.spendLimitMicros : '9000000000' },
        };
      },
      async testOrder(target) {
        verify(target);
        if (state.phase !== 'draft') throw new DirectError('Тестовый заказ доступен для черновика.');
        if (faults.testOrder && !state.testOrders) {
          state.testOrders++;
          await persist();
        }
        return { counter: rollstarGoal.id, goal: rollstarGoal.goal, event: rollstarGoal.event, order: testId,
          accepted: faults.testOrder, occurrences: faults.testOrder ? 1 : 0 };
      },
      async dispatch(target, command, receipt) {
        verify(target);
        if (state.writes.some(item => item.id === receipt)) throw new Error('Повтор идентификатора команды.');
        if (faults.notSent === command) {
          faults.notSent = undefined;
          state.writes.push({ id: receipt, command, outcome: 'not_sent' });
          await persist();
          throw new Error('Имитация потери команды до отправки.');
        }
        const allowed = command === 'moderate' ? ['draft'] : command === 'start' ? ['ready', 'stopped'] : ['ready', 'starting', 'running'];
        if (!allowed.includes(state.phase)) throw new Error('Переход заблокирован имитацией.');
        state.phase = command === 'moderate' ? 'reviewing' : command === 'start' ? 'starting' : 'stopping';
        state.reads = 0;
        if (command === 'stop') state.stoppedReports = 0;
        state.writes.push({ id: receipt, command, outcome: 'applied' });
        await persist();
        if (faults.unknown === command) {
          faults.unknown = undefined;
          throw new Error('Имитация потери ответа после отправки.');
        }
      },
      async reports(target) {
        verify(target);
        let report = faults.report;
        if (report === 'auto') {
          if (state.phase === 'stopped' || state.phase === 'rejected') {
            report = ++state.stoppedReports > 1 ? 'settled' : 'stale';
            await persist();
          } else report = state.phase === 'running' ? 'ready' : 'waiting';
        }
        if (report === 'stale' || report === 'waiting') return { status: report };
        const scope = { account: target.account, campaign: target.campaign, from: target.period.startDate,
          to: target.period.endDate, timeZone: 'Europe/Moscow' };
        const orders = state.impressions ? ['one', 'two', 'three', 'four'] : [];
        const clients = state.impressions ? [
          { orderId: 'one', clientId: 'a', firstOrder: true },
          { orderId: 'two', clientId: 'a', firstOrder: false },
          { orderId: 'three', clientId: 'b', firstOrder: true },
          { orderId: 'four', clientId: 'c', firstOrder: false },
        ] : [];
        if (state.testOrders) {
          orders.push(testId);
          clients.push({ orderId: testId, clientId: 'test-client', firstOrder: true });
        }
        return { status: 'ready', settled: report === 'settled',
          direct: { ...scope, currency: 'RUB', includeVAT: true, spendKop: faults.spendKop ?? (state.impressions ? report === 'settled' ? 256200 : 244000 : 0),
            impressions: state.impressions ? report === 'settled' ? 5250 : 5000 : 0, clicks: state.impressions ? report === 'settled' ? 105 : 100 : 0 },
          metrika: { ...scope, counter: rollstarGoal.id, goal: rollstarGoal.goal, attribution: faults.attribution ? 'last' : 'auto', orderIds: orders },
          customers: faults.customers ? { ...scope, name: 'Заказы Rollstar · имитация', clients } : undefined,
        };
      },
    };
    const clientId = 'rollstar-fixture-login';
    const auth = createYandexAuth(x.db, clientId, 'fictional', { cookiePrefix: 'goulash_training',
      requestJson: async () => { throw new Error('Only local fixture login'); } });
    const server = createApp(x.db, auth, undefined, undefined, undefined, undefined, undefined, undefined, {}, x.manager,
      undefined, () => false, provider, undefined, undefined, undefined,
      { formPrefix: live ? trainingPrefix : '', trainingLoginHref: '/fixture-login/a?return=pilot' });
    let liveServer: ReturnType<typeof createApp> | undefined;
    if (live) {
      liveDatabase = openDatabase(live.directory);
      const liveAuth = createYandexAuth(liveDatabase, live.clientId, live.clientSecret, { requestJson: live.requestJson });
      const connections = live.direct && createDirectConnections(liveDatabase, live.direct);
      liveServer = createApp(liveDatabase, liveAuth, undefined, undefined, undefined, undefined, undefined, undefined, {}, connections,
        undefined, () => false, undefined, undefined, undefined, undefined, { formPrefix: livePrefix, trainingHref: '/fixture' });
      server.on('listening', () => liveServer!.emit('listening'));
      server.on('close', () => { liveServer!.emit('close'); liveDatabase!.close(); });
    }
    const handler = server.listeners('request')[0]!;
    const liveHandler = liveServer?.listeners('request')[0];
    server.removeListener('request', handler);
    server.on('request', (request, response) => {
      if (request.headers.host !== '127.0.0.1:' + request.socket.localPort) return handler(request, response);
      const path = request.url?.split('?', 1)[0] ?? '';
      const get = request.method === 'GET';
      const useLive = Boolean(liveHandler && request.headers.cookie?.split(';').some(part => part.trim() === modeCookie));
      const setMode = (active: boolean) => response.appendHeader('Set-Cookie',
        `${active ? modeCookie : 'goulash_preview=; Max-Age=0'}; Path=/; HttpOnly; SameSite=Lax`);
      if (get && path === '/fixture') {
        setMode(false);
        return response.writeHead(303, { 'Cache-Control': 'no-store', Location: routes.overview }).end();
      }
      if (get && liveHandler && (path === '/auth/yandex' || path === callbackPath)) {
        const site = request.headers['sec-fetch-site'];
        if (path === callbackPath || !site || site === 'same-origin' || site === 'none') setMode(true);
        return liveHandler(request, response);
      }
      if (get && path === '/auth/yandex') {
        return response.writeHead(303, { 'Cache-Control': 'no-store', Location: routes.overview }).end();
      }
      if (get && (path === '/fixture-login/a' || path === '/fixture-login/b')) {
        const alice = path.endsWith('/a');
        const query = new URLSearchParams(request.url?.split('?', 2)[1]);
        const destination = query.getAll('return').length === 1 ? query.get('return') : null;
        const target = !alice || destination === 'overview' ? routes.overview
          : destination === 'pilot' ? pilotHref(workspace) : prepareHref(workspace);
        const token = randomBytes(32).toString('base64url');
        const key = createHash('sha256').update(`${clientId}:${token}`).digest('hex');
        x.db.createSession(key, alice ? x.owner : 'yandex:202', alice ? 'Владелец Rollstar' : 'Другой владелец', Date.now() + 3600000);
        setMode(false);
        response.appendHeader('Set-Cookie', `${auth.cookies.session}=${token}; Path=/; HttpOnly; SameSite=Lax`);
        return response.writeHead(303, { Location: target }).end();
      }
      if (get && path === routes.pilot) {
        if (useLive) setMode(false);
        const query = new URLSearchParams(request.url?.split('?', 2)[1]);
        if (!query.has('ad') && auth.session(request)?.owner === x.owner)
          return response.writeHead(303, { 'Cache-Control': 'no-store', Location: pilotHref(workspace) }).end();
        return handler(request, response);
      }
      if (liveHandler) {
        const prefix = [trainingPrefix, livePrefix].find(candidate => path.startsWith(candidate + '/'));
        // An open tab from another mode must never submit a form to the active cabinet.
        if ((prefix && (prefix === livePrefix) !== useLive) || (request.method === 'POST' && !prefix)) {
          return response.writeHead(409, {
            'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          }).end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Режим стенда изменился</title><main><h1>Режим стенда изменился</h1><p>Данные из этой вкладки не отправлены. Откройте её кабинет и повторите действие.</p>
            ${prefix === livePrefix ? '<a href="/auth/yandex">Вернуться в рабочий кабинет</a>' : '<a href="/fixture">Вернуться в учебный кабинет</a>'}</main></html>`);
        }
        if (prefix) request.url = request.url!.slice(prefix.length);
        if (useLive) return liveHandler(request, response);
      }
      if (get) {
        if (path === routes.overview && !auth.session(request)) {
          response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; font-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
          }).end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Goulash Реклама · Вход</title><style>${styles}</style></head><body><main>
            <section class="login overview-focus"><h1>Goulash Реклама</h1>
            <div class="login-options">
              <div><a class="button primary" href="/fixture-login/a">Войти в учебный кабинет</a><p>Модерация и запуск Rollstar на тестовых данных.</p></div>
              ${liveHandler ? '<div><a class="button secondary" href="/auth/yandex">Войти через Яндекс ID</a><p>Подготовка рекламы для вашего кабинета Директа.</p></div>' : ''}
            </div></section></main></body></html>`);
          return;
        }
        if (request.url === '/fixture-state') {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            fixture: true, workspace, liveCalls: 0, paidCalls: 0, provider: state,
            pilot: x.db.readCampaignDirectRuns(x.owner, workspace).at(-1)?.pilot,
          }));
          return;
        }
      }
      handler(request, response);
    });
    return { ...x, server, workspace, path: pilotHref(workspace), fixture: { faults, state, provider } };
  } catch (error) {
    liveDatabase?.close();
    x.db.close();
    throw error;
  }
}

if (import.meta.main) {
  const directory = process.argv.includes('--training-only') ? undefined : process.env.GOULASH_PREVIEW_LIVE_DATA_DIR;
  let live: LiveCabinet | undefined;
  if (directory) {
    const clientId = process.env.YANDEX_CLIENT_ID?.trim(), clientSecret = process.env.YANDEX_CLIENT_SECRET?.trim();
    const directIdPath = process.env.GOULASH_DIRECT_CLIENT_ID_FILE, directSecretPath = process.env.GOULASH_DIRECT_APP_SECRET_FILE;
    if (!clientId || !clientSecret || Boolean(directIdPath) !== Boolean(directSecretPath))
      throw new Error('Для настоящего входа нужны настройки Яндекс ID и полная конфигурация Директа, если он подключён.');
    live = { directory, clientId, clientSecret,
      direct: directIdPath && directSecretPath ? { clientId: readFileSync(directIdPath, 'utf8').trim(),
        clientSecret: await dpapiToken(directSecretPath)(), codec: createSecretCodec() } : undefined };
  }
  const x = await pilotBrowser(process.argv[2] ?? 'output/cabinet-block2/browser-data', live);
  x.server.listen(Number(process.argv[3] ?? 8942), '127.0.0.1', () => {
    const address = x.server.address();
    if (address && typeof address !== 'string') console.log(`Учебный Rollstar http://127.0.0.1:${address.port}/fixture-login/a?return=pilot`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => x.server.close(() => { x.db.close(); process.exit(); }));
}
