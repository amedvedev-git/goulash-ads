import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DirectError, directId, ReadRateLimitError } from './direct-api.ts';
import { hash } from './campaign-plan.ts';
import { defaultCampaignId } from './campaign-workspaces.ts';
import type { openDatabase } from './database.ts';
import type { DirectConnection, DirectState } from './direct.ts';
import type { MetrikaCounter, MetrikaProvider, MetrikaQuery } from './metrika-api.ts';
import type { MetrikaOAuthConnection } from './metrika-connect.ts';

export type AnalyticsSource='direct_reports'|'metrika_site'|'metrika_direct'|'metrika_daily';
export type CampaignMeasurement = {
  counter: MetrikaCounter; goalId?: string; generation: number; landing: string; configId: string;
  counterCheckedAt?: number;
  test?: { marker: string; startedAt: number; verifiedAt?: number };
};
type CampaignAnalytics = {
  revision: number; directRevision?: number; dateFrom?: string; dateTo?: string; directRunId?: string; measurement?: CampaignMeasurement;
};
export type AnalyticsSettings={revision:number;generation:number;metrikaEnabled:boolean;metrikaConfigId?:string;directRunId?:string;counter?:MetrikaCounter;goalId?:string;dateFrom:string;dateTo:string;
  campaignAnalytics?: Record<string, CampaignAnalytics>; metrikaOAuth?: MetrikaOAuthConnection;
  advertisers?: Record<string,{ account:string; generation:number; name:string; checkedAt:string }>;
  legacyReportRevision?:number; legacyDirectRevision?:number; legacyMeasurementWorkspace?:string};
export function legacyMetrikaCurrent(settings: AnalyticsSettings, provider?: MetrikaProvider) {
  return Boolean(provider && settings.counter && settings.metrikaEnabled && settings.metrikaConfigId === provider.configId);
}
export type AnalyticsReport={id:string;source:AnalyticsSource;status:'pending'|'ready'|'empty'|'error'|'superseded';requestedAt:string;receivedAt?:string;settingsRevision:number;connectionGeneration?:number;metrikaGeneration?:number;configId?:string;mode:'fixture'|'live';requestKey:string;
  context:{dateFrom:string;dateTo:string;timezone:string;attribution:string;currency:string;vat:string;runId?:string;planId?:string;planHash?:string;planTitle?:string;planConfirmedAt?:string;account?:string;campaignId?:string;counterId?:string;domain?:string;goalId?:string;goalName?:string;businessMeaning:'not_agreed';workspaceId?:string;measurementGeneration?:number};
  query:any;result?:any;error?:string;retryAt?:number;cooldownUntil?:number;pid?:number;attempts:number;stale?:boolean;interrupted?:boolean;offlinePending?:boolean;failures?:{at?:string;message:string;retryAt?:number}[]};
export const analyticsDates=(now=Date.now())=>{const end=new Date(now-86400000+10800000).toISOString().slice(0,10);return{dateFrom:new Date(Date.parse(end)-6*86400000).toISOString().slice(0,10),dateTo:end};};
function reportRevision(saved:AnalyticsSettings,source:AnalyticsSource,campaignId?:string) {
  if (!campaignId) return (source==='direct_reports' ? saved.legacyDirectRevision : saved.legacyReportRevision) ?? saved.revision;
  const scope = saved.campaignAnalytics?.[campaignId];
  return (source==='direct_reports' ? scope?.directRevision : undefined) ?? scope?.revision ?? 0;
}
function parseFilterDate(value: string) {
  const date = value.trim();
  const parts = /^(\d{2})([./])(\d{2})\2(\d{4})$/u.exec(date);
  return parts ? `${parts[4]}-${parts[3]}-${parts[1]}` : date;
}
export class AnalyticsDateError extends DirectError {
  readonly field: 'dateFrom' | 'dateTo';
  constructor(field: AnalyticsDateError['field'], message: string) { super(message); this.field = field; }
}
export function validateDates(from:string,to:string,now=Date.now()){
  const calendarDay = (date: string, field: AnalyticsDateError['field']) => {
    const time = Date.parse(date);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== date)
      throw new AnalyticsDateError(field, 'Выберите существующую дату.');
    return time;
  };
  const start = calendarDay(from, 'dateFrom'), end = calendarDay(to, 'dateTo');
  const lastCompleted = Date.parse(analyticsDates(now).dateTo);
  const incompleteDays = 'Выберите завершённые дни. Последняя доступная дата — вчера по Москве.';
  if (start > lastCompleted) throw new AnalyticsDateError('dateFrom', incompleteDays);
  if (end < start) throw new AnalyticsDateError('dateTo', 'Выберите конец периода не раньше начала.');
  if (end - start > 30 * 86400000) throw new AnalyticsDateError('dateTo', 'Выберите период до 31 дня.');
  if (end > lastCompleted) throw new AnalyticsDateError('dateTo', incompleteDays);
}
export function sameSite(url:string,counter:MetrikaCounter){
  const hostname=(value:string)=>{try{return new URL(value.includes('://')?value:`https://${value}`).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}};
  const site=hostname(url);return Boolean(site&&[counter.domain,...counter.mirrors].some(s=>hostname(s)===site));
}
export function migrateAnalytics(db:DatabaseSync){
  db.exec(`CREATE TABLE analytics_settings(owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    CREATE TABLE analytics_reports(owner TEXT NOT NULL,id TEXT NOT NULL,source TEXT NOT NULL,request_key TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(owner,id)) STRICT;
    CREATE UNIQUE INDEX analytics_pending ON analytics_reports(owner,source) WHERE status='pending';
    CREATE TABLE demo_automation(owner TEXT PRIMARY KEY,revision INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),plan_id TEXT NOT NULL,policy_version TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    ALTER TABLE demo_jobs ADD COLUMN expected_revision INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE demo_jobs ADD COLUMN state_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_jobs ADD COLUMN context_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE demo_jobs ADD COLUMN authorization_revision INTEGER NOT NULL DEFAULT 0;
    PRAGMA user_version=10;`);
}
export function createAnalyticsStore(db:DatabaseSync){
  function settings(owner:string):AnalyticsSettings{const r=db.prepare('SELECT revision,payload FROM analytics_settings WHERE owner=?').get(owner);return r?{...JSON.parse(String(r.payload)),revision:Number(r.revision)}:{revision:0,generation:0,metrikaEnabled:false,...analyticsDates()};}
  function decode(payload:string):AnalyticsReport{
    const value=JSON.parse(payload) as AnalyticsReport;const age=Date.now()-Date.parse(value.receivedAt??'');value.stale=Boolean(value.receivedAt&&(!Number.isFinite(age)||age<0||age>86400000));
    value.offlinePending=value.source==='direct_reports'&&Boolean(value.offlinePending||value.result?.status==='pending');
    if(value.status==='pending'&&value.source!=='direct_reports'&&value.pid){try{process.kill(value.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')value.interrupted=true;}}
    return value;
  }
  function reports(owner:string):AnalyticsReport[]{return db.prepare('SELECT payload FROM analytics_reports WHERE owner=? ORDER BY rowid DESC LIMIT 30').all(owner).map(r=>decode(String(r.payload)));}
  const waitingCondition = "(status='pending' OR (source='direct_reports' AND status='error' AND (json_extract(payload,'$.offlinePending')=1 OR json_extract(payload,'$.result.status')='pending')))";
  function waiting(owner: string): AnalyticsReport[] {
    return db.prepare(`SELECT payload FROM analytics_reports WHERE owner=? AND ${waitingCondition} ORDER BY rowid DESC`).all(owner).map(row => decode(String(row.payload)));
  }
  function lastGoalReports(owner: string): AnalyticsReport[] {
    return db.prepare(`SELECT payload FROM (
      SELECT payload, row_number() OVER (PARTITION BY json_extract(payload,'$.context.runId') ORDER BY rowid DESC) AS rank
      FROM analytics_reports WHERE owner=? AND source='metrika_direct' AND status IN ('ready','empty')
    ) WHERE rank=1`).all(owner).map(row => decode(String(row.payload)));
  }
  return {readAnalyticsSettings:settings,readAnalyticsReports:reports, readPendingAnalyticsReports:waiting, readLastGoalReports:lastGoalReports,
    readAnalyticsCooldown(owner:string,source:AnalyticsSource):AnalyticsReport|undefined{
      const scope=source==='direct_reports'?"source='direct_reports'":"source IN('metrika_site','metrika_direct','metrika_daily')";
      const row=db.prepare(`SELECT payload FROM analytics_reports WHERE owner=? AND ${scope} AND json_extract(payload,'$.cooldownUntil')>? ORDER BY json_extract(payload,'$.cooldownUntil') DESC LIMIT 1`).get(owner,Date.now());
      return row?decode(String(row.payload)):undefined;
    },
    recordAnalyticsCooldown(owner:string,report:AnalyticsReport){db.prepare("INSERT INTO analytics_reports(owner,id,source,request_key,status,payload) VALUES(?,?,?,?,'error',?)").run(owner,report.id,report.source,report.requestKey,JSON.stringify(report));},
    saveAnalyticsCooldown(owner:string,id:string,until:number){db.prepare("UPDATE analytics_reports SET payload=json_set(payload,'$.cooldownUntil',?,'$.retryAt',?) WHERE owner=? AND id=?").run(until,until,owner,id);},
    saveAnalyticsSettings(owner:string,next:AnalyticsSettings,expected:number,guard?:()=>void,options?: { campaignId?:string; preservePending?:boolean; metrikaOnly?:boolean; legacyOnly?:boolean }){
      db.exec('BEGIN IMMEDIATE');try{const previous=settings(owner);if(previous.revision!==expected)throw new DirectError('Настройки аналитики уже изменены. Обновите страницу; ваши отчёты сохранены.');
        guard?.();
        if (!options?.preservePending) for(const row of db.prepare("SELECT payload FROM analytics_reports WHERE owner=? AND (status='pending' OR (source='direct_reports' AND status='error' AND (json_extract(payload,'$.offlinePending')=1 OR json_extract(payload,'$.result.status')='pending')))").all(owner)){
          const r=JSON.parse(String(row.payload)) as AnalyticsReport;
          if ((options?.campaignId && r.context.workspaceId !== options.campaignId) || (options?.metrikaOnly && r.source === 'direct_reports')
            || (options?.legacyOnly && r.context.workspaceId)) continue;
          r.status='superseded';r.error='Настройки изменены; ответ относится к прежнему контексту.';
          db.prepare('UPDATE analytics_reports SET status=?,payload=? WHERE owner=? AND id=?').run(r.status,JSON.stringify(r),owner,r.id);
        }
        const keepLegacy = options?.campaignId || options?.preservePending;
        db.prepare('INSERT INTO analytics_settings(owner,revision,payload) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(owner,expected+1,JSON.stringify({
          ...next,revision:expected+1,
          legacyReportRevision:keepLegacy ? reportRevision(previous,'metrika_site') : undefined,
          legacyDirectRevision:keepLegacy || options?.metrikaOnly ? reportRevision(previous,'direct_reports') : undefined,
        }));db.exec('COMMIT');return settings(owner);
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    beginAnalyticsReport(owner:string,value:AnalyticsReport,legacyKey?:string,resume=false){
      db.exec('BEGIN IMMEDIATE');try{
        const row=resume
          ? db.prepare(`SELECT payload FROM analytics_reports WHERE owner=? AND id=? AND ${waitingCondition}`).get(owner,value.id)
          : db.prepare(`SELECT payload FROM analytics_reports WHERE owner=? AND source=? AND ${waitingCondition} ORDER BY rowid DESC LIMIT 1`).get(owner,value.source);
        if(row){const existing=decode(String(row.payload));
          if (existing.requestKey !== value.requestKey && existing.requestKey !== legacyKey && (existing.context.workspaceId || value.context.workspaceId))
            throw new DirectError('Дождитесь завершения запроса другого отчёта этого источника.');
          if(existing.status==='error'){
          existing.failures??=existing.error?[{message:existing.error}]:[];
          existing.status='pending';existing.error=undefined;
          db.prepare("UPDATE analytics_reports SET status='pending',payload=? WHERE owner=? AND id=?").run(JSON.stringify(existing),owner,existing.id);
        }db.exec('COMMIT');return existing;}
        if(resume) throw new DirectError('Ожидающий отчёт уже завершён. Обновите страницу.');
        db.prepare('INSERT INTO analytics_reports(owner,id,source,request_key,status,payload) VALUES(?,?,?,?,?,?)').run(owner,value.id,value.source,value.requestKey,value.status,JSON.stringify(value));db.exec('COMMIT');return value;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    supersedeWaitingAnalyticsReport(owner:string,id:string){
      db.prepare(`UPDATE analytics_reports SET status='superseded',
        payload=json_set(payload,'$.status','superseded','$.offlinePending',json('false'),'$.error',?)
        WHERE owner=? AND id=? AND ${waitingCondition}`).run('Подключение или кампания Директа изменились.',owner,id);
    },
    updateAnalyticsReport(owner:string,value:AnalyticsReport){return db.prepare("UPDATE analytics_reports SET status=?,payload=? WHERE owner=? AND id=? AND status='pending'").run(value.status,JSON.stringify(value),owner,value.id).changes===1;},
  };
}
const campaignOf = (run: DirectState) => run.campaignId ?? defaultCampaignId;
const moscowDate = (time: number) => new Date(time + 10800000).toISOString().slice(0, 10);
const testWindowMs = 48 * 60 * 60 * 1000;
function normalizedLanding(raw:string|undefined) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* The campaign editor may contain an unconfirmed partial URL. */ }
}

export function createAnalyticsService(db:ReturnType<typeof openDatabase>,resolveDirect:(owner:string)=>DirectConnection|undefined,
  metrika?:MetrikaProvider | ((owner:string)=>MetrikaProvider|undefined)){
  const inFlight=new Set<string>();
  const providerFor = (owner:string) => {
    const provider = typeof metrika === 'function' ? metrika(owner) : metrika;
    return provider?.owner === owner ? provider : undefined;
  };
  function requireCampaign(owner:string,campaignId:string) {
    if(!db.readCampaignWorkspace(owner,campaignId) && (campaignId!==defaultCampaignId || !db.readCampaignDirectRuns(owner,campaignId).length))
      throw new DirectError('Кампания не найдена в этом кабинете.');
  }
  function campaignLanding(owner:string,campaignId:string) {
    return normalizedLanding(db.readPreparation(owner,campaignId)?.value.input.url ?? db.readCampaign(owner,campaignId)?.draft.url);
  }
  function saveScope(owner:string,campaignId:string,saved:AnalyticsSettings,next:CampaignAnalytics,measurementOnly=false,preservePending=false) {
    const previous = saved.campaignAnalytics?.[campaignId];
    const campaignAnalytics = { ...saved.campaignAnalytics, [campaignId]: {
      ...next, revision:(previous?.revision ?? 0) + (preservePending || measurementOnly ? 0 : 1),
      directRevision:reportRevision(saved,'direct_reports',campaignId),
    } };
    return db.saveAnalyticsSettings(owner,{...saved,campaignAnalytics},saved.revision,undefined,{campaignId,preservePending,metrikaOnly:true});
  }
  function inspectMeasurement(owner:string,campaignId:string,saved:AnalyticsSettings,provider=providerFor(owner)) {
    const landing = campaignLanding(owner,campaignId);
    const measurement = saved.campaignAnalytics?.[campaignId]?.measurement;
    const legacyRun = !measurement && saved.directRunId ? db.readDirect(owner,saved.directRunId) : undefined;
    const legacyWorkspace = saved.legacyMeasurementWorkspace ?? (legacyRun && campaignOf(legacyRun));
    const legacy = Boolean(!measurement && legacyWorkspace === campaignId && saved.counter && landing && sameSite(landing,saved.counter));
    // Historic site settings belong only to the workspace selected when they were saved.
    const selection: CampaignMeasurement|undefined = measurement ?? (legacy ? {
      counter:saved.counter!, goalId:saved.goalId, generation:saved.generation, landing:landing!, configId:saved.metrikaConfigId ?? '',
    } : undefined);
    const current = Boolean(selection && provider && selection.configId === provider.configId && saved.metrikaEnabled
      && saved.metrikaConfigId === provider.configId && landing === selection.landing && sameSite(landing!,selection.counter));
    const test = selection?.test;
    const verified = Boolean(current && selection?.goalId && test?.verifiedAt);
    const validTest = current && test && Date.now() - test.startedAt < testWindowMs && Date.now() >= test.startedAt;
    const testUrl = validTest && landing ? new URL(landing) : undefined;
    if (testUrl) testUrl.searchParams.set('goulash_test',test!.marker);
    return { measurement:selection, landing, configured:Boolean(provider), current, verified,
      testUrl:testUrl?.href, legacy, revision:saved.revision, canTest:Boolean(provider?.api.testGoal) };
  }
  function campaignMeasurement(owner:string,campaignId:string) {
    requireCampaign(owner,campaignId);
    return inspectMeasurement(owner,campaignId,db.readAnalyticsSettings(owner));
  }
  function scopeSettings(owner:string,saved:AnalyticsSettings,runs:DirectState[],requestedRunId?:string,campaignId?:string) {
    if (!campaignId) return requestedRunId === undefined ? saved : {
      ...saved,directRunId:runs.find(run=>run.planId===requestedRunId && run.steps.campaign.phase==='confirmed')?.planId,
    };
    const scope = saved.campaignAnalytics?.[campaignId];
    const measurement = inspectMeasurement(owner,campaignId,saved);
    const legacyRunId = runs.some(run=>run.planId===saved.directRunId && (measurement.legacy || !run.guidedDraft)) ? saved.directRunId : undefined;
    const chosen = requestedRunId ?? scope?.directRunId ?? legacyRunId;
    const confirmed = runs.filter(run=>run.steps.campaign.phase==='confirmed');
    const directRunId = chosen === undefined ? confirmed.at(-1)?.planId : confirmed.find(run=>run.planId===chosen)?.planId;
    const period = measurement.legacy || legacyRunId ? {dateFrom:saved.dateFrom,dateTo:saved.dateTo} : analyticsDates();
    return {...saved,directRunId,counter:measurement.current?measurement.measurement?.counter:undefined,
      goalId:measurement.current?measurement.measurement?.goalId:undefined,
      dateFrom:scope?.dateFrom ?? period.dateFrom,dateTo:scope?.dateTo ?? period.dateTo};
  }
  function direct(owner:string,s:AnalyticsSettings){const connection=resolveDirect(owner),run=s.directRunId?db.readDirect(owner,s.directRunId):undefined;
    if(!connection||!run||run.account!==connection.account||connection.owner!==owner||!run.steps.campaign.id||run.steps.campaign.phase!=='confirmed')throw new DirectError('Выберите подтверждённый набор своего подключённого Директа.');
    return{connection,run,campaignId:directId(run.steps.campaign.id)};
  }
  function reportConnection(owner:string,report:AnalyticsReport,saved:AnalyticsSettings) {
    const {context} = report;
    const connection = resolveDirect(owner);
    const run = context.runId ? db.readDirect(owner,context.runId) : undefined;
    if (!connection || connection.owner !== owner || !run || run.account !== connection.account ||
        run.steps.campaign.phase !== 'confirmed' || run.steps.campaign.id !== context.campaignId ||
        (context.workspaceId && campaignOf(run) !== context.workspaceId) ||
        context.account !== connection.account || report.mode !== connection.mode ||
        report.connectionGeneration !== connection.generation ||
        report.settingsRevision !== reportRevision(saved,'direct_reports',context.workspaceId)) return;
    return connection;
  }
  function view(owner: string, requestedRunId?: string, campaignId?: string) {
    if (campaignId) requireCampaign(owner,campaignId);
    const saved = db.readAnalyticsSettings(owner);
    const provider = providerFor(owner);
    const legacyCurrent = legacyMetrikaCurrent(saved, provider);
    const resolved = resolveDirect(owner);
    const connection = resolved?.owner === owner ? resolved : undefined;
    const allRuns = db.readDirectRuns(owner);
    const runs = campaignId ? allRuns.filter(run=>campaignOf(run)===campaignId) : allRuns;
    const settings = scopeSettings(owner,saved,runs,requestedRunId,campaignId);
    const measurements = new Map<string, ReturnType<typeof inspectMeasurement>>();
    const measurementFor = (id:string) => {
      if (!measurements.has(id)) measurements.set(id,inspectMeasurement(owner,id,saved,provider));
      return measurements.get(id)!;
    };
    const metrikaContextCurrent = campaignId ? measurementFor(campaignId).current : legacyCurrent;
    const run = runs.find(item => item.planId === settings.directRunId && item.account === connection?.account);
    const directCampaignId = run?.steps.campaign.phase === 'confirmed' ? run.steps.campaign.id : undefined;
    const workspacesByRun = new Map(allRuns.map(run=>[run.planId,campaignOf(run)]));
    const reports = db.readAnalyticsReports(owner).filter(({context}) => !campaignId ||
      (context.workspaceId ?? workspacesByRun.get(context.runId ?? '')) === campaignId);
    const connectedRuns = new Map(runs.filter(item => item.account === connection?.account && item.steps.campaign.phase === 'confirmed')
      .map(item => [item.planId, item.steps.campaign.id]));
    const forCampaign = ({ context, connectionGeneration }: AnalyticsReport) => Boolean(
      context.runId && context.campaignId && connectedRuns.get(context.runId) === context.campaignId &&
      context.account === connection?.account && connectionGeneration === connection?.generation);
    const forGoal = (report: AnalyticsReport) => {
      if (!provider || report.mode !== provider.mode || report.configId !== provider.configId) return false;
      const id = report.context.workspaceId;
      const associatedWorkspace = id ?? workspacesByRun.get(report.context.runId ?? '');
      if (id) {
        if (report.context.runId && workspacesByRun.get(report.context.runId) !== id) return false;
        const scope = measurementFor(id);
        const selection = scope.current ? scope.measurement : undefined;
        return Boolean(selection && selection.goalId && report.context.counterId === selection.counter.id && report.context.goalId === selection.goalId
          && report.context.measurementGeneration === selection.generation);
      }
      if ((campaignId && !measurementFor(campaignId).legacy) || (associatedWorkspace && saved.campaignAnalytics?.[associatedWorkspace]?.measurement)) return false;
      return legacyCurrent && report.context.counterId === saved.counter?.id && report.context.goalId === saved.goalId
        && (report.metrikaGeneration === undefined ? report.settingsRevision === reportRevision(saved,report.source) : report.metrikaGeneration === saved.generation);
    };
    const campaignReports = reports.filter(report => report.status !== 'superseded' && forCampaign(report) &&
      (report.source === 'direct_reports' ? report.mode === connection?.mode : ['metrika_direct','metrika_daily'].includes(report.source) && forGoal(report)));
    const currentReports = reports.filter(report => {
      const { context, source } = report;
      if (report.status === 'superseded' || context.dateFrom !== settings.dateFrom || context.dateTo !== settings.dateTo) return false;
      const revision = reportRevision(saved,source,context.workspaceId);
      if (report.settingsRevision !== revision && !['ready','empty'].includes(report.status)) return false;
      const selectedCampaign = directCampaignId && context.runId === run?.planId && forCampaign(report);
      if (source === 'direct_reports') return selectedCampaign && report.mode === connection?.mode;
      return forGoal(report) && (source === 'metrika_site' ? context.workspaceId === campaignId : selectedCampaign);
    });
    const metrikaReady = metrikaContextCurrent && Boolean(settings.counter?.goals.some(goal => goal.id === settings.goalId));
    const directReady = Boolean(directCampaignId);
    const metrikaAdReady = directReady && metrikaReady && Boolean(connection?.login && settings.counter && run && sameSite(run.draft.url,settings.counter)
      && (!campaignId || normalizedLanding(run.draft.url) === measurementFor(campaignId).measurement?.landing));
    const canRefresh = {
      direct_reports: directReady,
      metrika_site: metrikaReady,
      metrika_direct: metrikaAdReady,
      metrika_daily: metrikaAdReady,
    };
    const selected = runs.find(item => item.planId === settings.directRunId);
    const missingAccess = !provider || !saved.metrikaEnabled || saved.metrikaConfigId !== provider.configId;
    const pending = db.readPendingAnalyticsReports(owner).filter(report =>
      report.source !== 'direct_reports' || reportConnection(owner,report,saved));
    const lastGoals = db.readLastGoalReports(owner).filter(report => !campaignId ||
      (report.context.workspaceId ?? workspacesByRun.get(report.context.runId ?? '')) === campaignId);
    const directReason = !selected ? 'Выберите подтверждённую кампанию Директа.' : !connection ? 'Восстановите подключение Директа.' :
      selected.account !== connection.account ? 'Подключите кабинет Директа, в котором создана эта кампания.' : 'Проверьте подтверждение кампании в Директе.';
    const measurement = campaignId ? measurementFor(campaignId) : undefined;
    const hadMetrika = Boolean(saved.metrikaOAuth || saved.metrikaConfigId || measurement?.measurement || lastGoals.length);
    const metrikaAction = !provider ? hadMetrika ? 'restore' : 'connect' :
      (!saved.metrikaEnabled && hadMetrika) ? 'restore' :
      !metrikaContextCurrent ? (campaignId ? measurement?.measurement : saved.counter) ? 'replace_counter' : 'choose_counter' :
      !metrikaReady ? 'choose_goal' : 'manage';
    const goalNeedsDirect = !connection?.login;
    return { settings, reports, pending, lastGoals, missingAccess, directReason, goalNeedsDirect, metrikaAction, currentReports, campaignReports, metrikaConfigured: Boolean(provider), metrikaContextCurrent,
      canRefresh, runs, plans: db.readPlans(owner,campaignId), measurement:campaignId ? measurementFor(campaignId) : undefined };
  }
  function save(owner:string,form:URLSearchParams,skipUnchanged=false,campaignId?:string){const current=db.readAnalyticsSettings(owner),one=(key:string)=>form.getAll(key).length===1?form.get(key)!:'';
    if(String(current.revision)!==one('revision'))throw new DirectError('Настройки аналитики изменены. Обновите страницу.');
    const dateFrom = parseFilterDate(one('dateFrom')), dateTo = parseFilterDate(one('dateTo'));
    validateDates(dateFrom,dateTo);
    const runId=one('directRunId'),run=runId?db.readDirect(owner,runId):undefined;
    if(runId && (!run || (campaignId && (campaignOf(run)!==campaignId || run.steps.campaign.phase!=='confirmed'))))
      throw new DirectError('Набор не найден в этой кампании.');
    if(campaignId) {
      requireCampaign(owner,campaignId);
      const stored = current.campaignAnalytics?.[campaignId] ?? {revision:0};
      const selection = inspectMeasurement(owner,campaignId,current);
      const measurement = selection.current ? selection.measurement : undefined;
      const goalId = form.has('goalId') ? one('goalId') || undefined : measurement?.goalId;
      if(form.getAll('goalId').length>1 || (goalId && !measurement?.counter.goals.some(goal=>goal.id===goalId)))
        throw new DirectError('Выберите цель из прочитанного счётчика кампании.');
      const goalChanged = goalId !== measurement?.goalId;
      if(skipUnchanged && dateFrom===stored.dateFrom && dateTo===stored.dateTo && runId===(stored.directRunId??'') && !goalChanged) return current;
      return saveScope(owner,campaignId,current,{...stored,dateFrom,dateTo,directRunId:runId||undefined,
        measurement: goalChanged && measurement ? {...measurement,goalId,generation:measurement.generation+1,test:undefined} : stored.measurement});
    }
    const goalId=form.has('goalId') ? one('goalId') : current.goalId ?? '';
    if(form.getAll('goalId').length>1 || (goalId&&!current.counter?.goals.some(g=>g.id===goalId)))throw new DirectError('Выберите цель из прочитанного счётчика.');
    const goalChanged=goalId!==(current.goalId??'');
    const filtersChanged=dateFrom!==current.dateFrom || dateTo!==current.dateTo || runId!==(current.directRunId??'') || goalChanged;
    if(skipUnchanged&&!filtersChanged)return current;
    const previousRun = current.directRunId ? db.readDirect(owner,current.directRunId) : undefined;
    const legacyRun = previousRun ?? run;
    const legacyMeasurementWorkspace = current.legacyMeasurementWorkspace ?? (current.counter && legacyRun ? campaignOf(legacyRun) : undefined);
    return db.saveAnalyticsSettings(owner,{...current,dateFrom,dateTo,directRunId:runId||undefined,goalId:goalId||undefined,legacyMeasurementWorkspace,
      generation:current.generation+(goalChanged ? 1 : 0)},current.revision,undefined,{legacyOnly:true,metrikaOnly:filtersChanged});
  }
  function checkMetrikaCooldown(owner:string) {
    const cooldown=db.readAnalyticsCooldown(owner,'metrika_site');
    if(cooldown)throw new ReadRateLimitError('Метрика',cooldown.cooldownUntil!);
  }
  async function metrikaRead<T>(owner:string,provider:MetrikaProvider,context:Partial<AnalyticsReport['context']>,
    key:string[],check:()=>void,read:(guard:()=>void)=>Promise<T>) {
    checkMetrikaCooldown(owner);
    try{
      const result=await read(()=>{check();checkMetrikaCooldown(owner);});
      check();
      return result;
    }catch(error){
      if(error instanceof ReadRateLimitError)db.recordAnalyticsCooldown(owner,{id:randomUUID(),source:'metrika_site',status:'error',mode:provider.mode,
        requestedAt:new Date().toISOString(),settingsRevision:db.readAnalyticsSettings(owner).revision,configId:provider.configId,requestKey:hash([...key,provider.configId]),
        context:{...analyticsDates(),timezone:'Europe/Moscow',attribution:'not_applicable',currency:'RUB',vat:'unknown',businessMeaning:'not_agreed',...context},
        query:{kind:key[0]},attempts:1,error:error.message,cooldownUntil:error.retryAt,retryAt:error.retryAt});
      throw error;
    }
  }
  function checkSettings(owner:string,expected:number,provider:MetrikaProvider) {
    if(db.readAnalyticsSettings(owner).revision!==expected||providerFor(owner)?.configId!==provider.configId)
      throw new DirectError('Настройки изменились. Обновите страницу и повторите.');
  }
  async function listCounters(owner:string) {
    const provider=providerFor(owner);
    if(!provider?.api.counters) throw new DirectError('Список счётчиков недоступен. Укажите номер счётчика вручную.');
    const expected=db.readAnalyticsSettings(owner).revision;
    return metrikaRead(owner,provider,{},['counter_list'],()=>checkSettings(owner,expected,provider),guard=>provider.api.counters!(guard));
  }
  async function readCounter(owner:string,counterId:string,expected:number,campaignId?:string){
    if (!/^[1-9]\d{0,18}$/.test(counterId)) throw new DirectError('Укажите номер счётчика Метрики.');
    const current=db.readAnalyticsSettings(owner), provider=providerFor(owner);
    if(!provider||current.revision!==expected)throw new DirectError('Доступ Метрики не настроен или выбор устарел.');
    if(campaignId) requireCampaign(owner,campaignId);
    const landing=campaignId ? campaignLanding(owner,campaignId) : undefined;
    if(campaignId&&!landing) throw new DirectError('Сохраните адрес страницы кампании, чтобы выбрать счётчик.');
    const check=()=>{
      checkSettings(owner,expected,provider);
      if(campaignId && campaignLanding(owner,campaignId)!==landing) throw new DirectError('Адрес страницы кампании изменился.');
    };
    const metadata=await metrikaRead(owner,provider,{workspaceId:campaignId},['counter',counterId],check,guard=>provider.api.counter(counterId,guard));
    if(metadata.id!==counterId) throw new DirectError('Метрика вернула другой счётчик.');
    if(landing&&!sameSite(landing,metadata)) throw new DirectError('Этот счётчик относится к другому сайту. Выберите счётчик страницы кампании.');
    return {current,provider,landing,metadata};
  }
  async function inspectCounter(owner:string,counterId:string,expected:number,campaignId?:string){
    return (await readCounter(owner,counterId,expected,campaignId)).metadata;
  }
  function saveCounter(owner:string,selection:Awaited<ReturnType<typeof readCounter>>,campaignId?:string,goalId?:string){
    const { current,provider,landing,metadata } = selection;
    if(!campaignId) return db.saveAnalyticsSettings(owner,{...current,counter:metadata,goalId,metrikaEnabled:true,
      metrikaConfigId:provider.configId,generation:current.generation+1},current.revision,undefined,{metrikaOnly:true,legacyOnly:true});
    const scope=current.campaignAnalytics?.[campaignId] ?? {revision:0};
    const previous=scope.measurement;
    const measurement={ counter:metadata,goalId,counterCheckedAt:Date.now(),landing:landing!,configId:provider.configId,generation:(previous?.generation??0)+1 };
    return saveScope(owner,campaignId,{...current,metrikaEnabled:true,metrikaConfigId:provider.configId},{...scope,measurement},true);
  }
  async function counter(owner:string,counterId:string,expected:number,campaignId?:string){
    return saveCounter(owner,await readCounter(owner,counterId,expected,campaignId),campaignId);
  }
  async function configureMetrika(owner:string,counterId:string,goalId:string,expected:number,campaignId?:string,enable=false){
    if (!/^[1-9]\d{0,18}$/.test(goalId)) throw new DirectError('Выберите цель счётчика.');
    const saved=db.readAnalyticsSettings(owner),provider=providerFor(owner);
    if (saved.revision!==expected || !provider) throw new DirectError('Настройки изменились. Обновите страницу и повторите.');
    if (!saved.metrikaEnabled && !enable) throw new DirectError('Чтение отключено. Нажмите «Включить чтение».');
    const campaign=campaignId ? inspectMeasurement(owner,campaignId,saved,provider) : undefined;
    const current=campaign ? campaign.current && campaign.measurement : legacyMetrikaCurrent(saved,provider) && saved;
    if (current && current.counter?.id===counterId && current.goalId===goalId && current.counter.goals.some(goal=>goal.id===goalId)) return saved;
    const selection=await readCounter(owner,counterId,expected,campaignId);
    if (!selection.metadata.goals.some(goal=>goal.id===goalId)) throw new DirectError('Эта цель недоступна для выбранного счётчика. Выберите цель заново.');
    return saveCounter(owner,selection,campaignId,goalId);
  }
  function selectedMeasurement(owner:string,campaignId:string,expected:number) {
    requireCampaign(owner,campaignId);
    const saved=db.readAnalyticsSettings(owner),provider=providerFor(owner),view=inspectMeasurement(owner,campaignId,saved,provider);
    if(expected!==saved.revision||!provider||!view.current||!view.measurement)
      throw new DirectError('Выбор устарел или счётчик недоступен. Обновите настройки Метрики кампании.');
    return {saved,provider,measurement:view.measurement,scope:saved.campaignAnalytics?.[campaignId] ?? {revision:0}};
  }
  function setGoal(owner:string,campaignId:string,goalId:string,expected:number) {
    const {saved,scope,measurement}=selectedMeasurement(owner,campaignId,expected);
    if(!measurement.counter.goals.some(goal=>goal.id===goalId)) throw new DirectError('Выберите цель счётчика кампании.');
    if(scope.measurement && measurement.goalId===goalId) return saved;
    return saveScope(owner,campaignId,saved,{...scope,measurement:{...measurement,goalId,generation:measurement.generation+1,test:undefined}},true);
  }
  function beginTest(owner:string,campaignId:string,expected:number) {
    const {saved,scope,measurement,provider}=selectedMeasurement(owner,campaignId,expected);
    if(!measurement.goalId||!provider.api.testGoal) throw new DirectError('Проверка заявки недоступна. Выберите цель и проверьте доступ к Метрике.');
    return saveScope(owner,campaignId,saved,{...scope,measurement:{...measurement,test:{marker:randomUUID().replaceAll('-',''),startedAt:Date.now()}}},true,Boolean(scope.measurement));
  }
  async function verifyTest(owner:string,campaignId:string,expected:number) {
    const {saved,scope,measurement,provider}=selectedMeasurement(owner,campaignId,expected);
    const {test,goalId,counter,landing}=measurement;
    if(!test||!goalId||!provider.api.testGoal) throw new DirectError('Создайте тестовую ссылку для выбранной цели.');
    if(test.verifiedAt) return true;
    const check=()=>{
      checkSettings(owner,expected,provider);
      if(campaignLanding(owner,campaignId)!==landing||Date.now()-test.startedAt>=testWindowMs||test.startedAt>Date.now())
        throw new DirectError('Срок тестовой ссылки истёк или страница кампании изменилась. Создайте новую тестовую ссылку.');
    };
    check();
    const found=await metrikaRead(owner,provider,{workspaceId:campaignId,counterId:counter.id,goalId},['test_goal',test.marker],check,
      guard=>provider.api.testGoal!(counter.id,goalId,moscowDate(test.startedAt),moscowDate(Date.now()),test.marker,guard,new URL(landing).hostname));
    if(!found) return false;
    saveScope(owner,campaignId,saved,{...scope,measurement:{...measurement,test:{...test,verifiedAt:Date.now()}}},true,true);
    return true;
  }
  function disconnect(owner:string,expected:number,guard?:()=>void){const current=db.readAnalyticsSettings(owner);return db.saveAnalyticsSettings(owner,{...current,metrikaEnabled:false,generation:current.generation+1},expected,guard,{metrikaOnly:true});}
  async function reconcileDirectReport(owner:string,id:string,campaignId?:string) {
    const pending = db.readPendingAnalyticsReports(owner).find(item=>item.id===id && item.source==='direct_reports' && item.context.workspaceId===campaignId);
    if(!pending) throw new DirectError('Ожидающий отчёт не найден. Обновите страницу.');
    const connected = ()=>reportConnection(owner,pending,db.readAnalyticsSettings(owner));
    const connection = connected();
    if(!connection) {
      db.supersedeWaitingAnalyticsReport(owner,id);
      throw new DirectError('Подключение или кампания Директа изменились. Запросите новый отчёт.');
    }
    const cooldown = db.readAnalyticsCooldown(owner,'direct_reports');
    if(cooldown) return cooldown;
    if (inFlight.has(id) || (pending.retryAt ?? 0) > Date.now()) return pending;
    const report=db.beginAnalyticsReport(owner,pending,undefined,true);
    return requestReport(owner,report,()=>Boolean(connected()),(guard)=>connection.api.reportRead({
      ...report.query,includeVat:report.context.vat==='included'?'YES':'NO',
    },guard));
  }
  async function refresh(owner:string,source:AnalyticsSource,expectedRevision?:number,campaignId?:string){
    const saved=db.readAnalyticsSettings(owner),provider=providerFor(owner);
    if(expectedRevision!==undefined&&saved.revision!==expectedRevision)throw new DirectError('Параметры изменились. Проверьте кампанию и период перед запросом.');
    if(campaignId) requireCampaign(owner,campaignId);
    const runs=campaignId ? db.readCampaignDirectRuns(owner,campaignId) : [];
    const s=scopeSettings(owner,saved,runs,undefined,campaignId);
    const revision=reportRevision(saved,source,campaignId);
    validateDates(s.dateFrom,s.dateTo);
    const context:AnalyticsReport['context']={dateFrom:s.dateFrom,dateTo:s.dateTo,timezone:'Europe/Moscow',attribution:['metrika_direct','metrika_daily'].includes(source)?'last':'not_applicable',currency:'RUB',vat:source==='direct_reports'?'excluded':'unknown',businessMeaning:'not_agreed'};
    if(campaignId) context.workspaceId=campaignId;
    let c:ReturnType<typeof direct>|undefined;let query:any;let mode:'live'|'fixture';
    if(['direct_reports','metrika_direct','metrika_daily'].includes(source)){c=direct(owner,s);const plan=db.readPlan(owner,c.run.campaignPlanId);Object.assign(context,{runId:c.run.planId,planId:c.run.campaignPlanId,planHash:plan?hash(plan):undefined,planTitle:plan?.draft.title,planConfirmedAt:plan?.confirmedAt,account:c.run.account,campaignId:c.campaignId});}
    if(source==='direct_reports'){mode=c!.connection.mode;query={campaignId:c!.campaignId,dateFrom:s.dateFrom,dateTo:s.dateTo,reportName:`E3_${randomUUID()}`};}
    else{
      if(!provider||!s.metrikaEnabled||!s.counter||!s.goalId)throw new DirectError('Прочитайте счётчик и выберите техническую цель; доступ должен быть включён.');
      if(s.metrikaConfigId!==provider.configId)throw new DirectError('Конфигурация доступа Метрики изменилась. Прочитайте счётчик и выберите цель заново.');
      const goal=s.counter.goals.find(g=>g.id===s.goalId);if(!goal)throw new DirectError('Цель не найдена в выбранном счётчике.');
      Object.assign(context,{counterId:s.counter.id,domain:s.counter.domain,goalId:goal.id,goalName:goal.name});mode=provider.mode;
      const scope = campaignId ? inspectMeasurement(owner,campaignId,saved,provider) : undefined;
      if(campaignId) context.measurementGeneration=scope?.measurement?.generation;
      query={counterId:s.counter.id,goalId:goal.id,dateFrom:s.dateFrom,dateTo:s.dateTo};
      if(['metrika_direct','metrika_daily'].includes(source)){
        if(!sameSite(c!.run.draft.url,s.counter)||!c!.connection.login||scope&&normalizedLanding(c!.run.draft.url)!==scope.measurement?.landing)
          throw new DirectError('Сайт плана и счётчик или логин кабинета не соответствуют: общий CPA запрещён.');
        Object.assign(query,{campaignId:c!.campaignId,login:c!.connection.login});
      }
    }
    const cooldown=db.readAnalyticsCooldown(owner,source);if(cooldown)return cooldown;
    if(source==='direct_reports') {
      for(const report of db.readPendingAnalyticsReports(owner)){
        if(report.source===source && !reportConnection(owner,report,saved)) db.supersedeWaitingAnalyticsReport(owner,report.id);
      }
    }
    const configId=source==='direct_reports'?undefined:provider!.configId;
    const requestKey = (basis: AnalyticsReport['context']) => hash([source,revision,basis,c?.connection.generation,configId]);
    const key = requestKey(context);
    // An offline report started before the tax-basis change must be polled with its original body.
    const legacyKey = source === 'direct_reports' ? requestKey({...context,timezone:'unknown',vat:'included'}) : undefined;
    const report=db.beginAnalyticsReport(owner,{id:randomUUID(),source,status:'pending',mode,requestedAt:new Date().toISOString(),settingsRevision:revision,
      connectionGeneration:c?.connection.generation,metrikaGeneration:source==='direct_reports'?undefined:s.generation,configId,requestKey:key,context,query,attempts:0},legacyKey);
    if(report.requestKey!==key && report.requestKey!==legacyKey)throw new DirectError('Предыдущее чтение относится к другой конфигурации. Сохраните настройки заново.');
    const settingsCurrent=()=>{
      const latest=db.readAnalyticsSettings(owner);
      if(source==='direct_reports') return Boolean(reportConnection(owner,report,latest));
      if(reportRevision(latest,source,campaignId)!==revision) return false;
      if(!latest.metrikaEnabled||latest.metrikaConfigId!==configId||providerFor(owner)?.configId!==configId) return false;
      if(!campaignId) return true;
      const selected=inspectMeasurement(owner,campaignId,latest,provider);
      return Boolean(selected.current && selected.measurement?.generation===context.measurementGeneration &&
        selected.measurement?.counter.id===context.counterId && selected.measurement?.goalId===context.goalId);
    };
    const read = (guard:()=>void) => source==='direct_reports'
      ? c!.connection.api.reportRead({...report.query,includeVat:report.context.vat==='included'?'YES':'NO'},guard)
      : source==='metrika_daily' ? provider!.api.daily(report.query as MetrikaQuery,guard) : provider!.api.report(report.query as MetrikaQuery,guard);
    return requestReport(owner,report,settingsCurrent,read,c && source!=='direct_reports' ? ()=>{
      const current=resolveDirect(owner);
      if(!current||current.account!==c.connection.account||current.generation!==c.connection.generation)throw new DirectError('Подключение Директа изменилось.');
    } : undefined);
  }
  async function requestReport(owner:string,report:AnalyticsReport,settingsCurrent:()=>boolean,
    read:(guard:()=>void)=>Promise<{status:'pending'|'ready'|'empty'; retryIn?:number}>,checkConnection?:()=>void) {
    const {source}=report;
    if(inFlight.has(report.id)||report.retryAt&&Date.now()<report.retryAt&&!report.interrupted)return report;
    const check=()=>{
      if(!settingsCurrent())throw new DirectError('Чтение отключено или контекст изменился.');
      checkConnection?.();
    };
    const beforeSend=()=>{check();const wait=db.readAnalyticsCooldown(owner,source);if(wait)throw new ReadRateLimitError(source==='direct_reports'?'Reports':'Метрика',wait.cooldownUntil!);};
    inFlight.add(report.id);
    try{
      check();report={...report,attempts:report.attempts+1,pid:process.pid,retryAt:Date.now()+30000};db.updateAnalyticsReport(owner,report);
      const result=await read(beforeSend);
      check();report={...report,status:result.status,result,offlinePending:source==='direct_reports'&&result.status==='pending',error:undefined,cooldownUntil:undefined,receivedAt:result.status==='pending'?undefined:new Date().toISOString(),retryAt:result.status==='pending'?Date.now()+(result.retryIn??60)*1000:undefined};
    }catch(error){const message=error instanceof DirectError?error.message:'Чтение недоступно. Повторите запрос; прежний результат сохранён.',retryAt=error instanceof ReadRateLimitError?error.retryAt:undefined;report={...report,status:settingsCurrent()?'error':'superseded',cooldownUntil:retryAt,retryAt,error:message,failures:[...report.failures??[],{at:new Date().toISOString(),message,retryAt}]};if(error instanceof ReadRateLimitError)db.saveAnalyticsCooldown(owner,report.id,error.retryAt);}
    finally{inFlight.delete(report.id);}
    db.updateAnalyticsReport(owner,report);return report;
  }
  return{view,save,counter,inspectCounter,configureMetrika,disconnect,refresh,reconcileDirectReport,listCounters,campaignMeasurement,setGoal,beginTest,verifyTest};
}
