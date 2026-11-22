import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { openDatabase } from './database.ts';

export const callbackPath = '/auth/yandex/callback';
const attemptCookie = 'goulash_oauth';
const sessionCookie = 'goulash_session';
const attemptSeconds = 10 * 60;
const sessionSeconds = 8 * 60 * 60;

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function cookie(request: IncomingMessage, name: string) {
  const pair = request.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const token = pair?.slice(name.length + 1) ?? '';
  return /^[\w-]{43}$/.test(token) ? token : '';
}

function redirect(response: ServerResponse, destination: string) {
  response.writeHead(303, { Location: destination }).end();
}

export function createYandexAuth(
  database: ReturnType<typeof openDatabase>, clientId: string, clientSecret: string,
  { requestJson = fetch, secureCookies = false } = {},
) {
  function setCookie(response: ServerResponse, name: string, token: string, seconds: number) {
    const secure = secureCookies ? '; Secure' : '';
    response.appendHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`);
  }

  function hash(token: string) {
    return createHash('sha256').update(`${clientId}:${token}`).digest('hex');
  }

  async function identify(code: string, verifier: string) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenResponse = await requestJson('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!tokenResponse.ok) throw new Error('Yandex token exchange failed');
    const token = await tokenResponse.json();
    if (typeof token?.access_token !== 'string' || !token.access_token ||
        !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0) {
      throw new Error('Invalid Yandex token response');
    }

    const profileResponse = await requestJson('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${token.access_token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!profileResponse.ok) throw new Error('Yandex profile request failed');
    const profile = await profileResponse.json();
    if (profile?.client_id !== clientId || typeof profile.id !== 'string' || !/^\d{1,32}$/.test(profile.id)) {
      throw new Error('Invalid Yandex profile');
    }

    const name = [profile.display_name, profile.login].find((field) => typeof field === 'string' && field.trim());
    return {
      owner: `yandex:${profile.id}`,
      name: name?.trim().slice(0, 120) || 'Пользователь Яндекс ID',
      seconds: Math.min(sessionSeconds, token.expires_in),
    };
  }

  return {
    session(request: IncomingMessage) {
      const token = cookie(request, sessionCookie);
      return token ? database.readSession(hash(token)) : undefined;
    },
    start(request: IncomingMessage, response: ServerResponse, origin: string) {
      const browser = randomToken();
      const state = randomToken();
      const verifier = randomToken();
      const oldBrowser = cookie(request, attemptCookie);
      if (oldBrowser) database.discardAttempt(hash(oldBrowser));
      database.startAttempt(hash(browser), state, verifier, Date.now() + attemptSeconds * 1000);
      const params = new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: `${origin}${callbackPath}`,
        scope: 'login:info', force_confirm: 'yes', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      });
      setCookie(response, attemptCookie, browser, attemptSeconds);
      redirect(response, `https://oauth.yandex.ru/authorize?${params}`);
    },
    async finish(request: IncomingMessage, response: ServerResponse, params: URLSearchParams) {
      const browser = cookie(request, attemptCookie);
      const states = params.getAll('state');
      const state = states[0];
      const verifier = browser && states.length === 1 && /^[\w-]{43}$/.test(state)
        ? database.consumeAttempt(hash(browser), state) : undefined;
      if (!verifier) return redirect(response, '/?auth=retry');

      setCookie(response, attemptCookie, '', 0);
      if (params.has('error')) {
        return redirect(response, params.get('error') === 'access_denied' ? '/?auth=cancelled' : '/?auth=retry');
      }
      const codes = params.getAll('code');
      if (codes.length !== 1 || !codes[0] || codes[0].length > 1024) return redirect(response, '/?auth=retry');

      let identity: Awaited<ReturnType<typeof identify>>;
      try {
        identity = await identify(codes[0], verifier);
      } catch {
        return redirect(response, '/?auth=unavailable');
      }
      const token = randomToken();
      database.createSession(hash(token), identity.owner, identity.name, Date.now() + identity.seconds * 1000);
      const oldToken = cookie(request, sessionCookie);
      if (oldToken) database.removeSession(hash(oldToken));
      setCookie(response, sessionCookie, token, identity.seconds);
      redirect(response, '/');
    },
    logout(request: IncomingMessage, response: ServerResponse) {
      const token = cookie(request, sessionCookie);
      const browser = cookie(request, attemptCookie);
      if (token) database.removeSession(hash(token));
      if (browser) database.discardAttempt(hash(browser));
      setCookie(response, sessionCookie, '', 0);
      setCookie(response, attemptCookie, '', 0);
      redirect(response, '/');
    },
  };
}
