import { loadCachedResearch } from './cached-research.ts';
import type { CachedResearch } from './cached-research.ts';
import { createServer } from 'node:http';
import { createPreparationService } from './preparation.ts';
import type { PreparationView } from './preparation.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { emptyCampaign, exampleCampaign } from './campaign.ts';
import { campaignAction, campaignActions } from './campaign-flow.ts';
import { createHash } from 'node:crypto';
import type { CampaignView } from './campaign.ts';
import { renderPage } from './page.ts';
import type { Section } from './page.ts';
import { callbackPath, createYandexAuth } from './yandex-auth.ts';
import { createDeepSeekTrial } from './business-analysis.ts';
import { demoCases } from './demo.ts';
import type { DemoCase } from './demo.ts';
import { createDirectApi, dpapiToken, DirectError } from './direct-api.ts';
import { createDirectService } from './direct.ts';
import type { DirectConnection } from './direct.ts';
import type { DirectView } from './direct.ts';
import { createWordstat } from './search-phrases.ts';
import type { Wordstat } from './search-phrases.ts';
import { createPhraseIntelligence } from './phrase-intelligence.ts';
import type { PhraseIntelligence } from './phrase-intelligence.ts';
import { createDirectConnections } from './direct-connect.ts';
import { createSecretCodec } from './direct-secrets.ts';

const host = '127.0.0.1';
const sections = new Map<string, Section>([['/', 'campaign'], ['/campaign', 'campaign'], ['/analytics', 'analytics'], ['/automation', 'automation'], ['/history', 'history'], ['/diagnostics', 'diagnostics'],['/connections/direct','connections']]);
const assets = new Map([['/assets/ui-client.js', ['ui-client.js', 'text/javascript; charset=utf-8']], ['/assets/Onest.ttf', ['Onest.ttf', 'font/ttf']]]);
const authMessages = new Map([
  ['retry', 'Не удалось подтвердить вход. Начни вход заново.'],
  ['cancelled', 'Вход отменён.'],
  ['unavailable', 'Не удалось войти через Яндекс ID. Проверь настройки OAuth и повтори попытку.'],
]);

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
) {
  const trialEnabled = !publicOrigin && Boolean(runDeepSeekTrial);
  if (publicOrigin && directConnection) throw new Error('Локальный токен Директа нельзя использовать на публичном стенде.');
  const legacyDirect = directConnection ? createDirectService(database, directConnection, wordstat, intelligence) : undefined;
  const preparation = createPreparationService(database, intelligence, wordstat, preparationRegions ?? (directConnection || connections ? async owner => {
    const c=connections?.resolve(owner) ?? (owner===directConnection?.owner?directConnection:undefined);
    if (!c) throw new DirectError('Подключите свой Директ для проверки справочника региона.');
    return c.api.list('dictionaries', { DictionaryNames: ['GeoRegions'] }, 'GeoRegions');
  } : undefined), cachedResearch);
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
    const browserToken=()=>request.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('goulash_direct='))?.slice(15).match(/^[\w-]{43}$/)?.[0]??'';
    let section: Section = 'campaign';
    let restore = false, saveComplete = false;
    let operationId: string | undefined, undoId: string | undefined;
    let historyFilter: 'all' | 'draft' | 'demo' = 'all';
    let directInput: DirectView['input'];
    let preparationView: PreparationView | undefined, legacyCampaign = false;
    function sendPage(status: number, value: string | undefined, message = '', campaign?: CampaignView) {
      if(section==='connections'&&owner&&!campaign){const saved=database.readCampaign(owner);campaign={input:saved?.draft??emptyCampaign,preview:saved?.draft,revision:saved?.revision??0};}
      const connectView=owner&&connections?connections.view(owner,auth?.binding(request)??'',browserToken()):undefined;
      response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; font-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(renderPage(value, message, status >= 400, Boolean(auth), name, campaign,
        owner ? database.operationsView(owner, { operationId, undoId }) : undefined, { section, restore, saved: saveComplete, historyFilter, direct: owner && direct ? { ...direct.view(owner), input: directInput } : owner&&connections?{enabled:false,ownChief:true,mode:connectView?.mode==='fixture'?'fixture':'live',state:database.readDirect(owner),runs:database.readDirectRuns(owner)}:undefined,
          connect:connectView,directConfigured:Boolean(connections),
          preparation: owner && section === 'campaign' && !legacyCampaign ? preparationView ?? preparation.view(owner) : undefined,
          scope: createHash('sha256').update(owner ?? 'anonymous').digest('hex') }));
    }

    try {
      const url = new URL(request.url, origin);
      const get = request.method === 'GET';
      section = sections.get(url.pathname) ?? (url.pathname.startsWith('/operations/') ? 'history' : url.pathname === '/demo/run' ? 'automation' : url.pathname === '/demo/load' ? 'analytics' : url.pathname === '/test-record' ? 'diagnostics' : 'campaign');
      if (get && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname)!;
        response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
        return response.end(readFileSync(new URL('./assets/' + file, import.meta.url)));
      }
      if (auth && get && url.pathname === '/auth/yandex') {
        const site = request.headers['sec-fetch-site'];
        if (site && site !== 'same-origin' && site !== 'none') return response.writeHead(403).end();
        return auth.start(request, response, origin);
      }
      if (auth && get && url.pathname === callbackPath) {
        response.setHeader('Referrer-Policy', 'no-referrer');
        return await auth.finish(request, response, url.searchParams);
      }
      if (auth && post && url.pathname === '/logout') return auth.logout(request, response);

      const session = auth?.session(request);
      name = session?.name;
      owner = auth ? session?.owner : 'local';
      if(owner&&connections) { resolvedConnection=connections.resolve(owner);direct=resolvedConnection?createDirectService(database,resolvedConnection,wordstat,intelligence):undefined; }
      const actor = session ? `${session.name} (${owner})` : 'Локальный пользователь (local)';
      if(url.pathname.startsWith('/connections/direct')&&post) {
        if(!auth||!owner||!session)return sendPage(401,undefined,'Войдите через Яндекс ID, чтобы подключить свой кабинет.');
        section='connections';
        if(!connections)return sendPage(409,database.read(owner),'Администратор ещё не настроил подключение Директа.');
        const form=await readForm(request,response,4096);if(!form)return;
        try {
          const action=url.pathname.slice('/connections/direct/'.length),binding=auth.binding(request);
          if(action==='start') { const token=connections.start(owner,binding);response.appendHeader('Set-Cookie',`goulash_direct=${token}; Path=/connections/direct; HttpOnly; SameSite=Lax; Max-Age=600${publicOrigin?'; Secure':''}`); }
          else if(action==='finish')await connections.finish(owner,binding,browserToken(),form);
          else if(action==='activate')connections.activate(owner,binding,form);
          else if(action==='disconnect')connections.disconnect(owner);
          else if(action==='cancel')connections.cancel(owner);
          else return response.writeHead(404).end();
          return response.writeHead(303,{Location:'/connections/direct'}).end();
        }catch(error){return sendPage(409,database.read(owner),error instanceof DirectError?error.message:'Не удалось подтвердить подключение. Получите новый код.');}
      }
      const deepSeekTrial = trialEnabled && owner ? database.readDeepSeekTrial()?.status ?? 'ready' : undefined;
      if (get && sections.has(url.pathname)) {
        const value = owner ? database.read(owner) : undefined;
        const saved = owner ? database.readCampaign(owner) : undefined;
        const example = section === 'campaign' && url.searchParams.get('example') === '1';
        restore = section === 'campaign';
        saveComplete = section === 'campaign' && url.searchParams.get('campaign') === 'saved';
        if (owner && section === 'campaign' && (url.searchParams.get('preparation') === 'saved' || url.searchParams.get('campaign') === 'saved')) preparationView = { ...preparation.view(owner), acknowledged: true };
        if (owner && example) { const prior = preparation.view(owner).saved; preparationView = preparation.view(owner, { revision: prior.revision, value: { ...prior.value, input: { ...prior.value.input, ...exampleCampaign }, goal: 'Обращения по доставке суши и роллов', step: 1 } }); }
        const campaign: CampaignView | undefined = owner ? {
          input: example ? exampleCampaign : saved?.draft ?? emptyCampaign,
          ...(example ? { pending: { ...exampleCampaign, title: saved?.draft.title ?? '', adText: saved?.draft.adText ?? '' }, step: 1 as const, dirty: true } : {}),
          preview: saved?.draft, revision: saved?.revision ?? 0, deepSeekTrial,
        } : undefined;
        if (section === 'history' && owner) {
          const filter = url.searchParams.get('scope');
          historyFilter = filter === 'draft' || filter === 'demo' ? filter : 'all';
          operationId = url.searchParams.get('operation') ?? undefined;
          undoId = url.searchParams.get('review') ?? undefined;
          if ([operationId, undoId].some((id) => id !== undefined && !/^[0-9a-f-]{36}$/.test(id))) {
            operationId = undefined; undoId = undefined;
            return sendPage(400, value, 'Некорректная ссылка на операцию. Выберите запись в истории.', campaign);
          }
          if ([operationId, undoId].some((id) => id && !database.readOperation(owner!, id))) {
            return sendPage(404, value, 'Операция не найдена в этом аккаунте.', campaign);
          }
        }
        const authMessage = auth ? authMessages.get(url.searchParams.get('auth') ?? '') : undefined;
        const campaignStatus = saved ? url.searchParams.get('campaign') : undefined;
        const message = authMessage ?? (url.searchParams.get('undo') === 'ok' ? 'Отмена выполнена. Связанная запись добавлена в историю.'
          : url.searchParams.get('undo') === 'already' ? 'Операция уже отменена. Повторная отмена ничего не меняет.'
          : section === 'analytics' && url.searchParams.get('loaded') === '1' ? 'Новый тестовый набор загружен. Предыдущая история сохранена.'
          : section === 'automation' && url.searchParams.get('run') === 'repeat' ? 'Этот набор уже проверен. Показан прежний результат; бюджет повторно не менялся.'
          : campaignStatus === 'prepared' ? 'Тестовый черновик подготовлен.'
          : campaignStatus === 'saved' ? 'Изменения черновика сохранены.'
          : value && url.searchParams.get('saved') === '1' ? 'Запись сохранена.' : '');
        sendPage(200, value, message, campaign);
      } else if (get && url.pathname === '/preparation/research.json') {
        if (!owner) return response.writeHead(401).end();
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="campaign-preparation.json"' });
        return response.end(JSON.stringify({ preparation: database.readPreparation(owner), runs: database.readRuns(owner) }, null, 2));
      } else if (post && url.pathname.startsWith('/preparation/')) {
        if (!owner) return sendPage(401, undefined, 'Войдите, чтобы сохранить подготовку.');
        const form = await readForm(request, response, 64 * 1024); if (!form) return;
        const result = await preparation.action(owner, url.pathname.slice('/preparation/'.length), form, actor);
        if (result.status < 400 && !url.pathname.endsWith('/resume')) return response.writeHead(303, { Location: '/?preparation=saved' }).end();
        preparationView = result.view;
        const saved = database.readCampaign(owner);
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
        if (action === 'undo') section = 'history';
        try {
          await direct.action(owner, action, form, actor);
          if(action==='refresh'&&resolvedConnection?.generation!==undefined)connections?.reconciled(owner,resolvedConnection.generation,form.get('planId')??'');
          return response.writeHead(303, { Location: action === 'undo' ? '/history#direct-history' : '/#direct' }).end();
        } catch (error) {
          if(resolvedConnection?.generation!==undefined)connections?.noteFailure(owner,resolvedConnection.generation,error);
          directInput = { action, startDate:(form.get('startDate')??'').slice(0,10), name: (form.get('name') ?? '').slice(0, 255), weekly: (form.get('weekly') ?? '').slice(0, 10), keyword: (form.get('keyword') ?? '').slice(0, 100),
            offer: (form.get('offer') ?? '').slice(0, 100), negatives: (form.get('negatives') ?? '').slice(0, 2100), additional: (form.get('additional') ?? '').slice(0, 1000), selected: form.getAll('selected').slice(0, 30) };
          const saved = database.readCampaign(owner);
          return sendPage(error instanceof DirectError ? 409 : 500, database.read(owner),
            error instanceof DirectError ? error.message : 'Не удалось завершить действие. Сверьте состояние Директа.',
            { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0 });
        }
      } else if (post && ['/operations/undo', '/demo/load', '/demo/run'].includes(url.pathname)) {
        if (!owner) return sendPage(401, undefined, 'Войди через Яндекс ID для работы с тестовыми операциями.');
        const form = await readForm(request, response, 4096);
        if (!form) return;
        const saved = database.readCampaign(owner);
        const current = { input: saved?.draft ?? emptyCampaign, preview: saved?.draft, revision: saved?.revision ?? 0, deepSeekTrial };
        const fail = (status: number, message: string) => sendPage(status, database.read(owner!), message, current);
        const field = (key: string) => form.getAll(key).length === 1 ? form.get(key)! : '';
        if (url.pathname === '/operations/undo') {
          const id = field('id');
          if (!/^[0-9a-f-]{36}$/.test(id)) return fail(400, 'Некорректный номер операции.');
          if (!database.readOperation(owner, id)) return fail(404, 'Операция не найдена.');
          undoId = id;
          if (field('confirm') !== 'undo') return fail(400, 'Сначала проверьте последствия и подтвердите отмену. Данные не изменены.');
          const result = database.undo(owner, id, actor);
          if (result === 'missing') return fail(404, 'Операция не найдена.');
          if (result === 'unsupported') return fail(400, 'Для этой операции отмена не поддерживается.');
          if (result === 'conflict') return fail(409, 'Конфликт отмены: есть более новая правка. Актуальное состояние сохранено.');
          const linked = database.readOperation(owner, id)?.undoneBy;
          return response.writeHead(303, { Location: `/history?undo=${result}${linked ? `&operation=${linked}` : ''}` }).end();
        }
        if (url.pathname === '/demo/load') {
          const scenario = field('scenario'), revision = field('revision');
          if (!Object.hasOwn(demoCases, scenario) || !/^(0|[1-9]\d{0,8})$/.test(revision)) return fail(400, 'Выбери тестовый сценарий из списка.');
          if (!database.loadDemo(owner, scenario as DemoCase, Number(revision), actor)) return fail(409, 'Тестовый набор уже изменён. Проверь актуальные данные.');
        } else {
          const datasetId = field('datasetId');
          if (!/^[0-9a-f-]{36}$/.test(datasetId)) return fail(400, 'Сначала загрузи тестовый набор.');
          const job = database.enqueueDemo(owner, datasetId, actor);
          if (!job) return fail(409, 'Набор уже заменён. Проверь актуальные данные.');
          return response.writeHead(303, { Location: job.status === 'completed' ? '/automation?run=repeat' : '/automation' }).end();
        }
        response.writeHead(303, { Location: '/analytics?loaded=1' }).end();
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
  server.on('listening', () => {
    worker = setInterval(() => {
      try { database.processDemoJob(); }
      catch (error) { console.error('Ошибка обработки тестового задания.', error instanceof Error ? error.name : 'UnknownError'); }
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
    connections=createDirectConnections(database,{clientId:directClientId,clientSecret:directClientSecret,codec:createSecretCodec({keyFile})});
  }
  let directConnection: DirectConnection | undefined;
  if (process.argv.includes('--direct')) {
    if (publicOrigin) throw new Error('Директ с DPAPI доступен только локально.');
    const owner = auth ? process.env.GOULASH_DIRECT_OWNER : 'local';
    if (!owner) throw new Error('Для Яндекс ID укажите GOULASH_DIRECT_OWNER — точный ID владельца сессии.');
    directConnection = { api: createDirectApi(dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'Direct.dpapi'))),
      owner, account: '31001001', mode: 'live' };
  }
  let wordstat: Wordstat | undefined;
  if (process.argv.includes('--wordstat')) {
    if (!directConnection || publicOrigin) throw new Error('Wordstat в этой версии включается только в локальном режиме --direct.');
    const folder = process.env.GOULASH_WORDSTAT_FOLDER;
    if (!folder) throw new Error('Для Wordstat укажите GOULASH_WORDSTAT_FOLDER.');
    const key = await dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'Wordstat.dpapi'))();
    wordstat = createWordstat(key, folder);
  }
  let intelligence: PhraseIntelligence | undefined;
  if (process.argv.includes('--phrase-ai')) {
    if (publicOrigin) throw new Error('Локальный ключ DeepSeek через DPAPI недоступен на публичном стенде.');
    const key = await dpapiToken(join(process.env.LOCALAPPDATA || '', 'Goulash-tech-2', 'tokens', 'PhraseAI.dpapi'))();
    intelligence = createPhraseIntelligence(key);
  }
  const cachedGeo = process.argv.find(a => a.startsWith('--cached-geo='))?.slice(13);
  const cachedExport = process.argv.find(a => a.startsWith('--cached-export='))?.slice(16);
  if (publicOrigin && cachedGeo) throw new Error('Локальный cached snapshot недоступен публичному серверу.');
  const server = createApp(database, auth, publicOrigin, runDeepSeekTrial, directConnection, wordstat, intelligence, undefined, cachedGeo ? loadCachedResearch(cachedGeo,cachedExport) : {}, connections);
  server.listen(port, bind, () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`http://${bind}:${address.port}`);
  });
}
