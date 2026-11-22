import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.ts';
import { renderPage } from './page.ts';
import { callbackPath, createYandexAuth } from './yandex-auth.ts';

const host = '127.0.0.1';
const authMessages = new Map([
  ['retry', 'Не удалось подтвердить вход. Начни вход заново.'],
  ['cancelled', 'Вход отменён.'],
  ['unavailable', 'Не удалось войти через Яндекс ID. Проверь настройки OAuth и повтори попытку.'],
]);

async function saveRecord(
  request: IncomingMessage, response: ServerResponse,
  sendPage: (status: number, value: string, message: string) => void,
  save: (content: string) => void,
) {
  const contentType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') {
    response.writeHead(415).end();
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) {
      response.setHeader('Connection', 'close');
      sendPage(413, '', 'Запрос слишком большой.');
      request.resume();
      return;
    }
    chunks.push(chunk);
  }

  const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).getAll('content');
  const value = fields[0]?.trim() ?? '';
  if (fields.length !== 1 || value.length < 1 || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    sendPage(400, value.slice(0, 200), 'Введи от 1 до 200 символов в одну строку.');
    return;
  }

  save(value);
  response.writeHead(303, { Location: '/?saved=1' }).end();
}

export function createApp(database: ReturnType<typeof openDatabase>, auth?: ReturnType<typeof createYandexAuth>, publicOrigin?: URL) {
  return createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
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
    function sendPage(status: number, value: string | undefined, message = '') {
      response.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      });
      response.end(renderPage(value, message, status >= 400, Boolean(auth), name));
    }

    try {
      const url = new URL(request.url, origin);
      const get = request.method === 'GET';
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
      const owner = auth ? session?.owner : 'local';
      if (get && url.pathname === '/') {
        const value = owner ? database.read(owner) : undefined;
        const authMessage = auth ? authMessages.get(url.searchParams.get('auth') ?? '') : undefined;
        const message = authMessage ?? (value && url.searchParams.get('saved') === '1' ? 'Запись сохранена.' : '');
        sendPage(200, value, message);
      } else if (post && url.pathname === '/test-record') {
        if (!owner) return sendPage(401, undefined, 'Войди через Яндекс ID, чтобы сохранить запись.');
        await saveRecord(request, response, sendPage, (content) => database.write(owner, content));
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
  const database = openDatabase(directory);
  const auth = clientId && clientSecret
    ? createYandexAuth(database, clientId, clientSecret, { secureCookies: Boolean(publicOrigin) }) : undefined;
  const server = createApp(database, auth, publicOrigin);
  server.listen(port, bind, () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`http://${bind}:${address.port}`);
  });
}
