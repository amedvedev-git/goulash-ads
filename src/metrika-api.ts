import { DirectError,ReadRateLimitError,retryAfterUntil } from './direct-api.ts';
import { createHash } from 'node:crypto';
export function metrikaConfigId(owner:string,version='1',provider:'dpapi'|'systemd'='dpapi'){
  if(!/^[\w.-]{1,80}$/.test(version))throw new DirectError('GOULASH_METRIKA_CONFIG_VERSION: нужна несекретная версия доступа до 80 букв, цифр, точек или дефисов.');
  return createHash('sha256').update(JSON.stringify([owner,provider,version])).digest('hex');
}
export type MetrikaCounter = {id:string;domain:string;name?:string;mirrors:string[];goals:{id:string;name:string;type:string;condition:string}[]};
export type MetrikaCounterChoice = { id: string; domain: string; name?: string };
export type MetrikaQuery = {counterId:string;goalId:string;dateFrom:string;dateTo:string;campaignId?:string;login?:string};
export type MetrikaReport = {status:'ready'|'empty';metrics:{visits:number|null;reaches:number|null;goalVisits:number|null;cost:number|null;cpa:number|null};
  complete:boolean;issues:string[];dataLag:number;sampled:boolean;sampleShare:number|null;query:Record<string,unknown>};
const id=(value:unknown)=>{const s=String(value);if(!/^[1-9]\d{0,18}$/.test(s))throw new DirectError('Некорректный ID Метрики.');return s;};
const counterDomain = (counter?: { site?: unknown; domain?: unknown; site2?: { site?: unknown } }) =>
  counter?.site2?.site ?? counter?.site ?? counter?.domain;
export function metrikaParams(q:MetrikaQuery){
  const ad=Boolean(q.campaignId),g=id(q.goalId);
  const metrics=ad?[`ym:ad:RUBConvertedAdCost`,`ym:ad:goal${g}reaches`,`ym:ad:goal${g}visits`,`ym:ad:goal${g}convertedRUBCPA`]:['ym:s:visits',`ym:s:goal${g}reaches`,`ym:s:goal${g}visits`];
  const params=new URLSearchParams({ids:id(q.counterId),metrics:metrics.join(','),date1:q.dateFrom,date2:q.dateTo,timezone:'+03:00',accuracy:'full',attribution:'last',currency:'RUB',limit:'10'});
  if(ad){if(!q.login||!/^[\w.@-]{1,100}$/.test(q.login))throw new DirectError('Логин кабинета не подтверждён.');params.set('dimensions','ym:ad:lastDirectOrder');params.set('filters',`ym:ad:lastDirectOrder==${id(q.campaignId)}`);params.set('direct_client_logins',q.login);}
  return params;
}
// Live check 19.11: Metrika rejects advertising metrics grouped by the site date dimension
// (error 4011). The supported daily series is the site goal reach metric grouped by date and
// filtered by the campaign's last direct order, so cross-prefix use stays in the filter only.
export type MetrikaDailyReport = {
  status:'ready'|'empty'; metrics:{visits:null;reaches:number;goalVisits:null;cost:null;cpa:null};
  days:{date:string;reaches:number}[]; complete:boolean; issues:string[]; dataLag:number; sampled:boolean; sampleShare:number|null; query:Record<string,unknown>;
};
export function metrikaDailyParams(q:MetrikaQuery){
  const params=metrikaParams(q),g=id(q.goalId);
  params.set('metrics',`ym:s:goal${g}reaches`);
  params.set('dimensions','ym:s:date');
  params.set('limit','100');
  return params;
}
export function parseMetrikaDaily(data:any,q:MetrikaQuery,now=Date.now()):MetrikaDailyReport{
  const p=metrikaDailyParams(q),expected=p.get('metrics')!.split(','),query=data?.query;
  if(!query||JSON.stringify(query.metrics)!==JSON.stringify(expected)||query.date1!==q.dateFrom||query.date2!==q.dateTo
    ||query.timezone!=='+03:00'||JSON.stringify(query.dimensions)!==JSON.stringify(['ym:s:date'])
    ||String(query.filters??'')!==String(p.get('filters')??'')
    ||!Array.isArray(data.data)||!Array.isArray(data.totals)||data.totals.length!==1
    ||!Number.isSafeInteger(data.total_rows)||data.total_rows<0||typeof data.sampled!=='boolean'
    ||!Number.isSafeInteger(data.data_lag)||data.data_lag<0)throw new DirectError('Метрика: ответ по дням не соответствует запросу.');
  const issues:string[]=[];
  if(data.sampled||data.sample_share!==1)issues.push('Семплированный отчёт');
  if(data.total_rows_rounded||data.total_rows>data.data.length)issues.push('Неполная выборка');
  if(now-data.data_lag*1000<Date.parse(q.dateTo)+86400000-10800000)issues.push('Данные периода ещё обновляются');
  if(data.data.length>Number(p.get('limit')))throw new DirectError('Метрика: неожиданный объём выборки по дням.');
  const days:{date:string;reaches:number}[]=[],seen=new Set<string>();
  for(const row of data.data){
    const date=row?.dimensions?.[0]?.name,value=row?.metrics?.[0];
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(date)||date<q.dateFrom||date>q.dateTo||seen.has(date))
      throw new DirectError('Метрика: некорректный день в ответе.');
    if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new DirectError('Метрика: некорректное число заявок за день.');
    seen.add(date);days.push({date,reaches:value});
  }
  days.sort((a,b)=>a.date.localeCompare(b.date));
  const total=data.totals[0],sum=days.reduce((acc,day)=>acc+day.reaches,0);
  if(typeof total!=='number'||!Number.isFinite(total)||total<0)throw new DirectError('Метрика: некорректный итог за период.');
  if(sum!==total)issues.push('Сумма дней не совпадает с итогом');
  const share=(value:unknown)=>{if(value===null||value===undefined)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new DirectError('Метрика: некорректная доля выборки.');return value;};
  return {status:days.length?'ready':'empty',metrics:{visits:null,reaches:total,goalVisits:null,cost:null,cpa:null},days,
    complete:issues.length===0,issues,dataLag:data.data_lag,sampled:data.sampled,sampleShare:share(data.sample_share),query};
}
export function parseMetrikaReport(data:any,q:MetrikaQuery,now=Date.now()):MetrikaReport{
  const p=metrikaParams(q),expected=p.get('metrics')!.split(','),ad=Boolean(q.campaignId),query=data?.query;
  if(!query||JSON.stringify(query.metrics)!==JSON.stringify(expected)||query.date1!==q.dateFrom||query.date2!==q.dateTo||query.timezone!=='+03:00'||(ad&&(query.filters!==p.get('filters')||JSON.stringify(query.dimensions)!==JSON.stringify(['ym:ad:lastDirectOrder'])))||!Array.isArray(data.data)||!Array.isArray(data.totals)||data.totals.length!==expected.length||!Number.isSafeInteger(data.total_rows)||data.total_rows<0||typeof data.sampled!=='boolean'||!Number.isSafeInteger(data.data_lag)||data.data_lag<0)throw new DirectError('Метрика: ответ не соответствует запросу.');
  const number=(v:unknown)=>{if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new DirectError('Метрика: некорректный показатель.');return v;};
  const issues:string[]=[];
  if(!ad&&((query.dimensions?.length??0)>0||query.filters))throw new DirectError('Метрика: отчёт всего сайта неожиданно ограничен сегментом.');
  if(data.sampled||data.sample_share!==1)issues.push('Семплированный отчёт');
  if(data.total_rows_rounded||data.total_rows>data.data.length||data.contains_sensitive_data)issues.push('Неполная выборка');
  if(now-data.data_lag*1000<Date.parse(q.dateTo)+86400000-10800000)issues.push('Данные периода ещё обновляются');
  if(data.data.length>1)throw new DirectError('Метрика: неожиданный объём выборки.');
  const row=data.data[0];if(row&&(!Array.isArray(row.metrics)||row.metrics.length!==expected.length))throw new DirectError('Метрика: неполная строка.');
  if(ad&&row&&String(row.dimensions?.[0]?.id)!==q.campaignId)throw new DirectError('Метрика: кампания не соответствует запросу.');
  const values=(row?.metrics??data.totals).map(number);
  const metrics=ad?{visits:null,reaches:values[1],goalVisits:values[2],cost:values[0],cpa:values[3]}:{visits:values[0],reaches:values[1],goalVisits:values[2],cost:null,cpa:null};
  if(values.some((v:unknown)=>v===null))issues.push('Нет части показателей');
  return {status:!data.data.length&&data.total_rows===0?'empty':'ready',metrics,complete:issues.length===0,issues,dataLag:data.data_lag,sampled:data.sampled,sampleShare:number(data.sample_share),query};
}
export function createMetrikaApi(token:()=>Promise<string>,transport:typeof fetch=fetch){
  async function get(path:string,params:URLSearchParams,beforeSend?:()=>void){
    let response:Response;try{const secret=await token();beforeSend?.();response=await transport(`https://api-metrika.yandex.net${path}?${params}`,{headers:{Authorization:`OAuth ${secret}`},redirect:'error',signal:AbortSignal.timeout(20000)});}catch(error){if(error instanceof ReadRateLimitError)throw error;throw new DirectError('Метрика: доступ отключён или соединение недоступно. Повторите чтение.');}
    if(response.status===429)throw new ReadRateLimitError('Метрика',retryAfterUntil(response.headers.get('Retry-After')));
    if(!response.ok)throw new DirectError(`Метрика: HTTP ${response.status}. ${response.status===401||response.status===403?'Проверьте доступ к счётчику.':'Чтение не завершено.'}`);
    const text=await response.text();if(Buffer.byteLength(text)>2097152)throw new DirectError('Метрика: ответ слишком большой.');
    try{return JSON.parse(text);}catch{throw new DirectError('Метрика: некорректный JSON.');}
  }
  return {async counters(beforeSend?: () => void): Promise<MetrikaCounterChoice[]> {
    const data = await get('/management/v1/counters', new URLSearchParams({ per_page: '100', offset: '1' }), beforeSend);
    if (!Array.isArray(data?.counters) || data.counters.length > 100) throw new DirectError('Метрика вернула некорректный список счётчиков.');
    return data.counters.flatMap((counter: any) => {
      const domain = counterDomain(counter);
      if (typeof domain !== 'string') return [];
      return [{ id: id(counter.id), domain: domain.slice(0, 253),
        name: typeof counter.name === 'string' ? counter.name.slice(0, 200) : undefined }];
    });
  },async testGoal(counterId: string, goalId: string, dateFrom: string, dateTo: string, marker: string, beforeSend?: () => void, domain?: string): Promise<boolean | 'not_found'> {
    if (!/^[a-f0-9]{32}$/.test(marker) || !domain || !/^[a-z0-9.-]{1,253}$/.test(domain))
      throw new DirectError('Некорректная метка или домен тестового визита.');
    const metrics = ['ym:s:visits', `ym:s:goal${id(goalId)}reaches`, `ym:s:goal${id(goalId)}visits`];
    const filters = `ym:s:startURLPathFull=@'goulash_test=${marker}' AND ym:s:startURLDomain=='${domain}'`;
    const params = new URLSearchParams({ ids: id(counterId), date1: dateFrom, date2: dateTo, timezone: '+03:00',
      metrics: metrics.join(','), accuracy: 'full', filters, limit: '1' });
    const report = await get('/stat/v1/data', params, beforeSend);
    const query = report?.query;
    if (!query || query.filters !== filters || query.date1 !== dateFrom || query.date2 !== dateTo || query.timezone !== '+03:00' ||
        JSON.stringify(query.metrics) !== JSON.stringify(metrics) || query.dimensions?.length ||
        !Array.isArray(report.data) || report.data.length > 1 || report.total_rows !== report.data.length ||
        !Array.isArray(report.totals) || report.totals.length !== metrics.length ||
        !report.totals.every((value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
      throw new DirectError('Метрика вернула отчёт, который не соответствует проверке тестового визита.');
    }
    if (report.sampled !== false || report.sample_share !== 1 || report.total_rows_rounded || report.contains_sensitive_data) return false;
    const [visits, reaches, goalVisits] = report.totals;
    if (report.data.length === 0) return visits === 0 && reaches === 0 && goalVisits === 0 ? 'not_found' : false;
    if (JSON.stringify(report.data[0]?.metrics) !== JSON.stringify(report.totals)) return false;
    if (reaches === 0 && goalVisits === 0) return 'not_found';
    return visits === 1 && reaches === 1 && goalVisits === 1;
  },async counter(counterId:string,beforeSend?:()=>void):Promise<MetrikaCounter>{
    const d=(await get(`/management/v1/counter/${id(counterId)}`,new URLSearchParams({field:'goals,mirrors'}),beforeSend)).counter;
    const domain = counterDomain(d);
    if(!d||String(d.id)!==counterId||typeof domain!=='string'||!Array.isArray(d.goals))throw new DirectError('Метрика: карточка счётчика неполна.');
    const mirrors = Array.isArray(d.mirrors2) ? d.mirrors2.map((mirror: { site?: unknown } | null) => mirror?.site) : d.mirrors;
    return {id:counterId,domain,...(typeof d.name==='string'?{name:d.name.slice(0,200)}:{}),mirrors:Array.isArray(mirrors)?mirrors.filter((v:unknown)=>typeof v==='string'):[],goals:d.goals.filter((g:any)=>!g.is_deleted).map((g:any)=>({id:id(g.id),name:String(g.name).slice(0,200),type:String(g.type),condition:(g.conditions??[]).map((c:any)=>String(c.url??c.type??'')).join(', ').slice(0,500)}))};
  },async report(q:MetrikaQuery,beforeSend?:()=>void){return parseMetrikaReport(await get('/stat/v1/data',metrikaParams(q),beforeSend),q);},
  async daily(q:MetrikaQuery,beforeSend?:()=>void){return parseMetrikaDaily(await get('/stat/v1/data',metrikaDailyParams(q),beforeSend),q);}};
}
type MetrikaMethods = ReturnType<typeof createMetrikaApi>;
export type MetrikaApi = Omit<MetrikaMethods, 'counters' | 'testGoal'> & Partial<Pick<MetrikaMethods, 'counters' | 'testGoal'>>;
export type MetrikaProvider={owner:string;mode:'live'|'fixture';configId:string;api:MetrikaApi};
