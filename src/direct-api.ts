import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { directReportBody, parseDirectReport } from './direct-reports.ts';
import type { DirectReportRequest } from './direct-reports.ts';

export class DirectError extends Error {}
export function retryAfterUntil(header:string|null,now=Date.now()){
  let deadline=NaN;
  if(header&&/^\d+$/.test(header.trim())){const seconds=Number(header),candidate=now+seconds*1000;if(Number.isSafeInteger(seconds)&&Number.isSafeInteger(candidate)&&Number.isFinite(new Date(candidate).getTime()))deadline=candidate;}
  else if(header){const parsed=Date.parse(header);if(Number.isFinite(parsed)&&new Date(parsed).toUTCString()===header)deadline=parsed;}
  return Number.isFinite(deadline)?Math.max(now+1000,deadline):now+60000;
}
export class ReadRateLimitError extends DirectError {
  retryAt:number;
  constructor(source:string,retryAt:number){super(`${source}: HTTP 429. Повторите после ${Math.max(1,Math.ceil((retryAt-Date.now())/1000))} с.`);this.retryAt=retryAt;}
}
export class DirectApiError extends DirectError {
  outcome: 'not_sent' | 'rejected' | 'unknown'; code?: string; requestId?: string;
  constructor(message: string, outcome: DirectApiError['outcome'], code?: string, requestId?: string) {
    super(message); this.outcome = outcome; this.code = code; this.requestId = requestId;
  }
}
export type WriteContext = { owner: string; runId: string; attemptId: string; beforeDispatch?: () => void };
export type DispatchGate = (send: () => Promise<Response>, request: { resource: string; method: string; body: string; context?: WriteContext }) => Promise<Response>;
export const directId = (value: unknown): string => {
  const text = typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new DirectError('Некорректный ID Директа. Запись не повторялась.');
  return text;
};

// Node 24 supplies the original token to the reviver, before Number rounding matters.
export function parseDirectJson(text: string) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value === 'number' && /^-?\d+$/.test(context.source)) return context.source;
    return value;
  });
}
export const targeting = {
  Categories: { Exact: 'YES', Narrow: 'NO', Alternative: 'NO', Accessory: 'NO', Broader: 'NO' },
  BrandOptions: { WithoutBrands: 'YES', WithAdvertiserBrand: 'YES', WithCompetitorsBrand: 'NO' },
};
export type DirectApi = ReturnType<typeof createDirectApi>;
export function createDirectApi(token: () => Promise<string>, transport: typeof fetch = fetch, gate?: DispatchGate) {
  let lastRequestId: string | undefined;
  const allowed = new Set(['clients/get', 'dictionaries/get', 'campaigns/get', 'campaigns/add', 'campaigns/update',
    'adgroups/get', 'adgroups/add', 'keywords/get', 'keywords/add', 'keywords/update', 'keywordsresearch/hasSearchVolume', 'ads/get', 'ads/add',
    'ads/moderate', 'campaigns/suspend', 'campaigns/resume']);
  async function call(resource: string, method: string, params: object, context?: WriteContext): Promise<any> {
    if (!allowed.has(`${resource}/${method}`)) throw new DirectError('Метод Директа запрещён.');
    if (['moderate', 'suspend', 'resume'].includes(method) && (!gate || !context?.beforeDispatch))
      throw new DirectApiError('Метод Директа запрещён без сохранённого намерения и проверки допуска.', 'not_sent');
    const version = ['clients', 'dictionaries'].includes(resource) ? 'v5' : 'v501';
    let secret: string;
    try { secret = await token(); } catch { throw new DirectApiError('Защищённый доступ недоступен. Запрос не отправлен.', 'not_sent'); }
    const body = JSON.stringify({ method, params }, (_key, value) => typeof value === 'bigint' ? JSON.rawJSON(value.toString()) : value);
    const readsGeoRegions = resource === 'dictionaries' && method === 'get'
      && (params as { DictionaryNames?: string[] }).DictionaryNames?.includes('GeoRegions');
    const signal = AbortSignal.timeout(readsGeoRegions ? 60000 : 25000);
    let response: Response;
    try {
      const send = () => transport(`https://api.direct.yandex.com/json/${version}/${resource}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${secret}`, 'Accept-Language': 'ru', 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
      response = await (gate ? gate(send, { resource, method, body, context }) : send());
    } catch (error) {
      if (error instanceof DirectApiError) throw error;
      throw new DirectApiError(`${resource}.${method}: соединение недоступно. Результат записи может быть неизвестен; сначала сверить состояние.`, 'unknown');
    }
    const requestId = response.headers.get('RequestId')?.match(/^[\w-]{1,100}$/)?.[0];
    lastRequestId=requestId;
    let responseText: string;
    try { responseText = await response.text(); }
    catch {
      const error = signal.aborted ? 'Истекло время чтения ответа Директа.' : 'Ответ Директа прервался при чтении.';
      const next = method === 'get' ? 'Повторите чтение.' : 'Сначала сверить результат.';
      throw new DirectApiError(`${resource}.${method}: ${error} ${next}`, 'unknown', undefined, requestId);
    }
    let data: any;
    try { data = parseDirectJson(responseText); }
    catch { throw new DirectApiError(`${resource}.${method}: некорректный JSON. Сначала сверить результат.`, 'unknown', undefined, requestId); }
    if (!response.ok || data?.error) {
      const code = /^\d{1,8}$/.test(String(data?.error?.error_code)) ? data.error.error_code : 'unknown';
      const rejected = ['53','54','58','513','3000','3001','8000','4000','4004','5000','5001','5004'].includes(String(code));
      throw new DirectApiError(`${resource}.${method}: HTTP ${response.status}, код API ${code}. ${rejected ? 'Запрос отклонён.' : 'Сначала сверить результат.'}`, rejected ? 'rejected' : 'unknown', String(code), requestId);
    }
    if (!data?.result || typeof data.result !== 'object' || Array.isArray(data.result)) throw new DirectApiError('Директ не вернул result.', 'unknown', undefined, requestId);
    return data.result;
  }
  async function list(resource: string, params: any, key: string): Promise<any[]> {
    const result = await call(resource, 'get', params);
    if (resource === 'ads' && Object.keys(result).length === 0) return [];
    if (!Array.isArray(result[key]) || result.LimitedBy) throw new DirectError(`Неполная выборка ${resource}. Запись остановлена.`);
    return result[key];
  }
  async function write(resource: string, method: string, params: object, context?: WriteContext) {
    const result = await call(resource, method, params, context);
    const items = result[({ add: 'AddResults', update: 'UpdateResults', moderate: 'ModerateResults', suspend: 'SuspendResults', resume: 'ResumeResults' } as Record<string, string>)[method]];
    if (!Array.isArray(items) || items.length !== 1) throw new DirectError('Неожиданный результат записи. Сначала сверить состояние.');
    if (items[0]?.Errors?.length) {
      const codes = items[0].Errors.map((e: any) => /^\d{1,8}$/.test(String(e.Code)) ? e.Code : 'unknown').join(', ');
      throw new DirectApiError(`Ошибка объекта Директа: ${codes}. Сначала сверить результат.`, items[0]?.Id ? 'unknown' : 'rejected', codes);
    }
    return directId(items[0]?.Id);
  }
  async function reportRead(request: DirectReportRequest,beforeSend?:()=>void) {
    const body=directReportBody(request);
    const secret=await token();
    beforeSend?.();
    const send=()=>transport('https://api.direct.yandex.com/json/v501/reports',{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${secret}`,'Accept-Language':'ru','Content-Type':'application/json; charset=utf-8',processingMode:'auto',skipReportHeader:'true',skipReportSummary:'true'},body});
    let response:Response;try{response=await(gate?gate(send,{resource:'reports',method:'report_read',body}):send());}catch(error){if(error instanceof DirectError)throw error;throw new DirectError('Reports: соединение недоступно. Повторите то же чтение.');}
    return parseDirectReport(response,request);
  }
  return { call, list, write, reportRead, get lastRequestId(){return lastRequestId;} };
}

// Only stdout of this fixed child process carries the decrypted secret; never log it.
export function dpapiToken(path: string) {
  let cached: string | undefined;
  return async () => {
    if (cached) return cached;
    if (process.platform !== 'win32') throw new DirectError('Локальное подключение Директа требует Windows DPAPI.');
    const script = "$ErrorActionPreference='Stop'; $s=ConvertTo-SecureString (([IO.File]::ReadAllText($env:GOULASH_DPAPI_PATH)).Trim()); try { [Console]::Out.Write([Net.NetworkCredential]::new('', $s).Password) } finally { $s.Dispose() }";
    try {
      const { stdout } = await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        windowsHide: true, timeout: 10000, maxBuffer: 16384, env: { ...process.env, GOULASH_DPAPI_PATH: path },
      });
      if (!stdout.trim()) throw new Error();
      cached = stdout.trim();
      return cached;
    } catch { throw new DirectError('Сохранённый токен недоступен текущей учётной записи Windows.'); }
  };
}
