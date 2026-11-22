import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export class DirectError extends Error {}
export class DirectApiError extends DirectError {
  outcome: 'not_sent' | 'rejected' | 'unknown'; code?: string; requestId?: string;
  constructor(message: string, outcome: DirectApiError['outcome'], code?: string, requestId?: string) {
    super(message); this.outcome = outcome; this.code = code; this.requestId = requestId;
  }
}
export type WriteContext = { owner: string; runId: string; attemptId: string };
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
    'adgroups/get', 'adgroups/add', 'keywords/get', 'keywords/add', 'keywords/update', 'keywordsresearch/hasSearchVolume', 'ads/get', 'ads/add']);
  async function call(resource: string, method: string, params: object, context?: WriteContext): Promise<any> {
    if (!allowed.has(`${resource}/${method}`)) throw new DirectError('Метод Директа запрещён.');
    const version = ['clients', 'dictionaries'].includes(resource) ? 'v5' : 'v501';
    let secret: string;
    try { secret = await token(); } catch { throw new DirectApiError('Защищённый доступ недоступен. Запрос не отправлен.', 'not_sent'); }
    const body = JSON.stringify({ method, params }, (_key, value) => typeof value === 'bigint' ? JSON.rawJSON(value.toString()) : value);
    let response: Response;
    try {
      const send = () => transport(`https://api.direct.yandex.com/json/${version}/${resource}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
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
    let data: any;
    try { data = parseDirectJson(await response.text()); }
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
    const items = result[method === 'add' ? 'AddResults' : 'UpdateResults'];
    if (!Array.isArray(items) || items.length !== 1) throw new DirectError('Неожиданный результат записи. Сначала сверить состояние.');
    if (items[0]?.Errors?.length) {
      const codes = items[0].Errors.map((e: any) => /^\d{1,8}$/.test(String(e.Code)) ? e.Code : 'unknown').join(', ');
      throw new DirectApiError(`Ошибка объекта Директа: ${codes}. Сначала сверить результат.`, items[0]?.Id ? 'unknown' : 'rejected', codes);
    }
    return directId(items[0]?.Id);
  }
  return { call, list, write, get lastRequestId(){return lastRequestId;} };
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
