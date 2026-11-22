import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createDirectApi, DirectApiError, DirectError, directId } from './direct-api.ts';
import type { openDatabase } from './database.ts';
import type { SecretCodec } from './direct-secrets.ts';
import type { DirectConnection } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';

type Database = ReturnType<typeof openDatabase>;
export type DirectConnectConfig = { clientId: string; clientSecret: string; codec: SecretCodec; transport?: typeof fetch; mode?: 'live' | 'fixture';
  fixture?: { codeForOwner: (owner: string) => string | undefined; liveLogin?: boolean } };
export type ConnectView = { status: string; account?: string; login?: string; checkedAt?: string; expiresAt?: number;
  generation: number; attempt?: { id: string; nonce: string; url?: string; fixtureCode?: string }; candidate?: { id: string; account: string; login: string };
  mode: 'live' | 'fixture'; liveLogin?: boolean; disconnectProof?: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const field = (form: URLSearchParams, name: string) => form.getAll(name).length === 1 ? form.get(name)! : '';
const nonce = (browser: string, id: string) => createHmac('sha256', browser).update(id).digest('base64url');
const denied = (message: string) => new DirectApiError(message, 'not_sent');
export function verifyOwnChief(client: any) {
  if (!client || client.Type !== 'CLIENT' || client.Currency !== 'RUB' || client.Archived !== 'NO' || client.ForbiddenPlatform !== 'NONE' ||
      !client.AvailableCampaignTypes?.includes('UNIFIED_CAMPAIGN') || !client.Grants?.some((g: any) => g.Privilege === 'EDIT_CAMPAIGNS' && g.Value === 'YES')) {
    throw new DirectError('Нужен собственный действующий CLIENT-кабинет в RUB с разрешённой ЕПК и правом изменения.');
  }
  const chiefs = Array.isArray(client.Representatives) ? client.Representatives.filter((r: any) => r.Role === 'CHIEF') : [];
  if (chiefs.length !== 1 || typeof client.Login !== 'string' || !client.Login || chiefs[0].Login !== client.Login) {
    throw new DirectError('Главный представитель не подтверждён. Этот вариант подключения пока не поддерживается; войдите аккаунтом главного представителя.');
  }
  return { account: directId(client.ClientId), login: client.Login };
}

export async function readAdvertiserName(connection: DirectConnection): Promise<string | null> {
  const clients = await connection.api.list('clients', {
    FieldNames: ['ClientId', 'Type'],
    OrganizationFieldNames: ['Name'],
    TinInfoFieldNames: ['Tin'],
  }, 'Clients').catch(() => {
    throw new DirectError('Не удалось получить данные рекламодателя. Проверьте подключение Директа и повторите запрос.');
  });
  const client = clients[0];
  if (clients.length !== 1 || String(client?.ClientId) !== connection.account || client?.Type !== 'CLIENT')
    throw new DirectError('Директ вернул другой кабинет. Проверьте подключение и повторите запрос.');
  const name = client.ErirAttributes?.Organization?.Name;
  const tin = client.TinInfo?.Tin;
  return typeof name === 'string' && name.trim() && name.trim().length <= 200 && !/[\x00-\x1f\x7f]/.test(name) &&
    typeof tin === 'string' && tin.trim() ? name.trim() : null;
}

export function createDirectConnections(db: Database, config: DirectConnectConfig) {
  const transport = config.transport ?? fetch, mode = config.mode ?? 'live';
  const fixture = mode === 'fixture' ? config.fixture : undefined;
  const configHash = digest(config.clientId);
  const context = (owner: string, generation: number) => JSON.stringify([owner,config.clientId,generation]);
  const disconnectProof = (owner: string, session: string, account: string, generation: number) =>
    createHmac('sha256', config.clientSecret).update(JSON.stringify(['direct-disconnect', config.clientId, owner, session, account, generation])).digest('base64url');
  function current(owner: string) { return db.readDirectConnection(owner) ?? db.ensureDirectConnection(owner); }
  function view(owner: string, session: string, browser: string): ConnectView {
    const c = current(owner), a = db.readConnectAttempt(owner), candidate = c.value.candidate;
    const status = c.status === 'connected' && c.value.clientId !== config.clientId ? 'configuration_changed' : c.status === 'connected' && c.value.expiresAt <= Date.now() ? 'expired' : c.status;
    return { status, account: c.account || undefined, login: c.value.login, checkedAt: c.value.checkedAt, expiresAt: c.value.expiresAt, generation: c.generation, mode,
      liveLogin: fixture?.liveLogin,
      ...(session && c.account && status !== 'disconnected' ? { disconnectProof: disconnectProof(owner,session,c.account,c.generation) } : {}),
      ...(candidate?.session === session && candidate.expires > Date.now() ? { candidate: { id: candidate.id, account: candidate.account, login: candidate.login } } : {}),
      ...(a && browser && a.value.browser === digest(browser) && a.value.session === session ? { attempt: { id: a.id, nonce: nonce(browser,a.id),
        ...(mode === 'live' ? { url: a.value.url } : { fixtureCode: fixture?.codeForOwner(owner) }) } } : {}) };
  }
  return {
    mode, view,
    start(owner: string, session: string) {
      if (!owner.startsWith('yandex:') || !session) throw new DirectError('Войдите через Яндекс ID, чтобы подключить свой кабинет.');
      const browser = random(), id = randomUUID(), verifier = random();
      let url: string | undefined;
      if (mode === 'live') {
        const params = new URLSearchParams({ response_type:'code',client_id:config.clientId,redirect_uri:'https://oauth.yandex.ru/verification_code',scope:'direct:api',force_confirm:'yes',state:random(),
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' });
        url = `https://oauth.yandex.ru/authorize?${params}`;
      }
      db.directTransaction(()=>{
        const active=current(owner),{candidate:_,...value}=active.value;
        db.setDirectConnection({...active,value:{...value,connectEpoch:id}},active.generation);
        db.saveConnectAttempt(id,owner,Date.now()+600000,{session,browser:digest(browser),nonce:digest(nonce(browser,id)),verifier,generation:active.generation,configHash,url});
      });
      return browser;
    },
    async finish(owner: string, session: string, browser: string, form: URLSearchParams) {
      const a = db.directTransaction(() => {
        const a = db.readConnectAttempt(owner);
        if (!a || a.id !== field(form,'attemptId') || a.value.session !== session || a.value.browser !== digest(browser) || a.value.nonce !== digest(field(form,'nonce')) || a.value.configHash !== configHash || a.value.generation !== current(owner).generation || current(owner).value.connectEpoch!==a.id) throw new DirectError('Попытка подключения устарела. Получите новый код.');
        db.removeConnectAttempts(owner); return a;
      });
      const code = field(form,'code').trim();
      if (!code || code.length>1024 || /[\x00-\x20\x7f]/.test(code)) throw new DirectError('Укажите одноразовый код Яндекса. Получите новый код, если попытка уже завершена.');
      let token: any, profile: any;
      try {
        const response = await transport('https://oauth.yandex.ru/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`},
          body:new URLSearchParams({grant_type:'authorization_code',code,code_verifier:a.value.verifier})});
        if (!response.ok) throw new Error();
        token = await response.json();
        if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length>16000 || !Number.isSafeInteger(token.expires_in) || token.expires_in<=0 || token.expires_in>10*366*86400) throw new Error();
        const identity = await transport('https://login.yandex.ru/info?format=json',{headers:{Authorization:`OAuth ${token.access_token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
        if (!identity.ok) throw new Error(); profile = await identity.json();
      } catch { throw new DirectError('Код не подтверждён или Яндекс недоступен. Получите новый код; токен не сохранён.'); }
      if (profile.client_id !== config.clientId || typeof profile.id !== 'string' || `yandex:${profile.id}` !== owner) throw new DirectError('Вы вошли в сервис другим аккаунтом Яндекса. Подключите Директ владельца текущей сессии.');
      const api = createDirectApi(async()=>token.access_token,transport);
      const clients = await api.list('clients',{FieldNames:['ClientId','Login','Representatives','Type','Archived','Currency','Grants','AvailableCampaignTypes','ForbiddenPlatform']},'Clients');
      if (clients.length!==1) throw new DirectError('Кабинет определён неоднозначно.');
      const own = verifyOwnChief(clients[0]), generation = a.value.generation;
      const envelope = await config.codec.protect(token.access_token,context(owner,generation+1));
      const candidate = {id:randomUUID(),...own,envelope,expires:Date.now()+600000,expiresAt:Date.now()+token.expires_in*1000,session,generation,clientId:config.clientId};
      db.directTransaction(()=>{
        const c=current(owner);
        if (c.generation!==generation || c.value.connectEpoch!==a.id) throw new DirectError('Подключение изменилось; получите новый код.');
        c.value={...c.value,candidate}; db.setDirectConnection(c,generation);
      });
    },
    activate(owner: string, session: string, form: URLSearchParams) {
      db.directTransaction(()=>{
        const c=current(owner), candidate=c.value.candidate;
        if (!candidate || candidate.id!==field(form,'candidateId') || candidate.session!==session || candidate.expires<=Date.now() || candidate.generation!==c.generation || candidate.clientId!==config.clientId || field(form,'confirm')!=='yes') throw new DirectError('Выбор кабинета устарел. Получите новый код.');
        const accountRuns = db.readDirectRuns(owner).filter(run => run.account === c.account);
        const same = c.account === candidate.account;
        if (!same && c.account && (db.directBusy(c.account) || accountRuns.some(run => {
          const started = Object.values(run.steps).some(step => step.phase !== 'ready');
          return (started && !run.complete) || hasUnresolvedDirect(run) || Boolean(run.launch?.budget || run.pilot?.pending || (run.pilot?.budget && !run.pilot.budget.settled));
        }))) throw new DirectError('Сначала завершите и сверьте прежнюю операцию; кабинет пока изменить нельзя.');
        const expected = c.generation;
        const reconcileRunId = same ? accountRuns.find(hasUnresolvedDirect)?.planId ?? c.activeRunId : undefined;
        db.setDirectConnection({...c,account:candidate.account,generation:expected+1,status:'connected',activeRunId:same?c.activeRunId:undefined,
          value:{envelope:candidate.envelope,clientId:config.clientId,login:candidate.login,role:'CHIEF',expiresAt:candidate.expiresAt,checkedAt:new Date().toISOString(),
            needsReconcile:Boolean(reconcileRunId),reconcileRunId}},expected);
      });
    },
    cancel(owner: string) {
      db.directTransaction(()=>{
        const c=current(owner),{candidate:_,...value}=c.value;
        db.removeConnectAttempts(owner);
        db.setDirectConnection({...c,value:{...value,connectEpoch:randomUUID()}},c.generation);
      });
    },
    disconnect(owner: string, session: string, form: URLSearchParams) {
      db.directTransaction(()=>{
        const c=db.readDirectConnection(owner);
        if (!c?.account || c.status === 'disconnected' || !session || db.readSession(session)?.owner !== owner ||
            field(form,'confirm') !== 'disconnect' || field(form,'account') !== c.account ||
            field(form,'generation') !== String(c.generation) ||
            field(form,'disconnectProof') !== disconnectProof(owner,session,c.account,c.generation))
          throw new DirectError('Обновите подключения и подтвердите отключение текущего кабинета Директа.');
        db.setDirectConnection({...c,generation:c.generation+1,status:'disconnected',value:{}},c.generation);
        db.removeConnectAttempts(owner);
      });
    },
    noteFailure(owner:string,generation:number,error:unknown){
      if(!(error instanceof DirectApiError)||!['53','54','58','513','3000'].includes(error.code??''))return;
      db.directTransaction(()=>{const c=current(owner);if(c.generation===generation)db.setDirectConnection({...c,status:error.code==='53'?'invalid':'access_denied',generation:generation+1,value:{login:c.value.login,checkedAt:c.value.checkedAt,errorCode:error.code}},generation);});
    },
    reconciled(owner: string, generation: number, runId: string) {
      db.directTransaction(() => {
        const c = current(owner);
        const expected = c.value.reconcileRunId ?? c.activeRunId;
        if (c.generation === generation && c.status === 'connected' && expected === runId)
          db.setDirectConnection({ ...c, value: { ...c.value, needsReconcile: false, reconcileRunId: undefined } }, generation);
      });
    },
    resolve(owner: string): DirectConnection | undefined {
      const c=current(owner);
      if(c.status!=='connected'||c.value.clientId!==config.clientId||c.value.expiresAt<=Date.now()) return;
      const api=createDirectApi(()=>config.codec.unprotect(c.value.envelope,context(owner,c.generation)),transport,(send,request)=>db.directTransaction(()=>{
        const actual=current(owner);
        if(actual.generation!==c.generation||actual.status!=='connected'||actual.account!==c.account||actual.value.clientId!==config.clientId||actual.value.expiresAt<=Date.now()) throw denied('Доступ отключён, истёк или изменился. Новый запрос не отправлен.');
        if(!['get','hasSearchVolume'].includes(request.method)&&!(request.resource==='reports'&&request.method==='report_read')) {
          const x=request.context;
          if(!x||x.owner!==owner) throw denied('Нет сохранённого намерения для записи.');
          const run=db.readDirect(owner,x.runId), attempt=run?.attempts?.find(a=>a.id===x.attemptId);
          if(!run||run.account!==c.account||!attempt||attempt.outcome!=='pending'||attempt.requestHash!==digest(request.body)) throw denied('Намерение записи изменилось.');
          if(db.directDispatches(owner,x.runId).some(d=>d.id===x.attemptId)) throw new DirectApiError('Запрос уже передан транспорту; сначала сверить результат.','unknown');
          try { x.beforeDispatch?.(); }
          catch (error) { throw denied(error instanceof DirectError ? error.message : 'Проверка допуска завершилась ошибкой. Запрос не отправлен.'); }
          db.recordDirectDispatch(x.attemptId,owner,x.runId,{id:x.attemptId,generation:c.generation,at:new Date().toISOString(),resource:request.resource,method:request.method,requestHash:attempt.requestHash});
        }
        return send();
      }));
      return {api,owner,account:c.account,login:c.value.login,mode,ownChief:true,generation:c.generation,needsReconcile:Boolean(c.value.needsReconcile),
        reconcileRunId:c.value.needsReconcile ? c.value.reconcileRunId ?? c.activeRunId : undefined};
    },
  };
}
