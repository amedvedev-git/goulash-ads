import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { openDatabase } from './database.ts';
import { connectionOrigin, routes } from './routes.ts';

export const callbackPath = '/auth/yandex/callback';
const attemptSeconds = 10 * 60;
const sessionSeconds = 8 * 60 * 60;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const workspace = /^(?:default|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;
const returnParameters = new Map<string, Record<string, RegExp>>([
  [routes.campaigns, { ad: workspace, status: /^(all|live|draft|review)$/, example: /^1$/, edit: /^1$/ }],
  [routes.prepare, { ad: workspace, tab: /^ads$/, example: /^1$/ }],
  [routes.results, { ad: workspace, run: uuid }],
  [routes.history, { ad: workspace, scope: /^(all|draft|demo)$/, by: /^(goulash|mine|experiments)$/, operation: uuid, review: uuid }],
  [routes.connection, { ad: workspace, run: uuid, panel: /^(direct|metrika|advertiser)$/ }],
]);
const notices = new Map<string, ReadonlySet<string>>([
  [routes.campaigns, new Set(['campaign', 'preparation', 'plan', 'research'])],
  [routes.prepare, new Set(['campaign', 'preparation', 'plan', 'research'])],
  [routes.results, new Set(['filters', 'demo', 'loaded'])],
  [routes.history, new Set(['undo'])],
]);

export function authDestination(value: string | undefined, publicPilot = false): string | undefined {
  if (!value || value.length > 256) return;
  if (publicPilot && value === routes.pilot) return routes.pilot;
  const fragmentAt = value.indexOf('#');
  const address = fragmentAt < 0 ? value : value.slice(0, fragmentAt);
  const fragment = fragmentAt < 0 ? '' : value.slice(fragmentAt);
  const separator = address.indexOf('?');
  const path = separator < 0 ? address : address.slice(0, separator);
  if (fragment && !(path === routes.connection && fragment === '#metrika-title') &&
      !(address === routes.results && fragment === '#demo')) return;
  const allowed = returnParameters.get(path);
  if (!allowed) return;
  const query = new URLSearchParams(separator < 0 ? '' : address.slice(separator + 1));
  const result = new URLSearchParams();
  for (const [key, input] of query) {
    if (key === 'auth' || notices.get(path)?.has(key)) continue;
    if (result.has(key)) return;
    if (key === 'from' && path === routes.connection && connectionOrigin(input)) result.set(key, input);
    else if (Object.hasOwn(allowed, key) && allowed[key].test(input)) result.set(key, input);
    else return;
  }
  if (result.has('from') && !result.has('ad')) return;
  if (path === routes.connection && result.has('run') && result.get('from') !== 'results') return;
  return (result.size ? path + '?' + result : path) + fragment;
}

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
  { requestJson = fetch, secureCookies = false, cookiePrefix = 'goulash' } = {},
) {
  const attemptCookie = `${cookiePrefix}_oauth`;
  const sessionCookie = `${cookiePrefix}_session`;
  function setCookie(response: ServerResponse, name: string, token: string, seconds: number) {
    const secure = secureCookies ? '; Secure' : '';
    response.appendHeader('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`);
  }

  function hash(token: string) {
    return createHash('sha256').update(`${clientId}:${token}`).digest('hex');
  }

  function signState(body: string) {
    return createHmac('sha256', clientSecret).update(`${clientId}:login:${body}`).digest('base64url');
  }

  function stateDestination(state: string) {
    const match = /^([\w-]{43}\.[\w-]{1,342})\.([\w-]{43})$/.exec(state);
    if (!match || !timingSafeEqual(Buffer.from(match[2]), Buffer.from(signState(match[1])))) return;
    return authDestination(Buffer.from(match[1].slice(44), 'base64url').toString('utf8'), true);
  }

  function resultLocation(destination: string, status: string) {
    const [address, fragment] = destination.split('#');
    return address + (address.includes('?') ? '&' : '?') + 'auth=' + status + (fragment ? '#' + fragment : '');
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
    cookies: { session: sessionCookie, direct: `${cookiePrefix}_direct` },
    binding(request: IncomingMessage) { const token=cookie(request,sessionCookie); return token&&database.readSession(hash(token))?hash(token):''; },
    session(request: IncomingMessage) {
      const token = cookie(request, sessionCookie);
      return token ? database.readSession(hash(token)) : undefined;
    },
    start(request: IncomingMessage, response: ServerResponse, origin: string, requestedDestination?: string) {
      const browser = randomToken();
      const nonce = randomToken();
      const destination = authDestination(requestedDestination, true);
      const body = destination ? nonce + '.' + Buffer.from(destination).toString('base64url') : '';
      const state = body ? body + '.' + signState(body) : nonce;
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
      const state = states.length === 1 ? states[0] : '';
      // A signed return path survives expiry, but only the browser's live attempt can authorize a session.
      const returnTo = stateDestination(state);
      const stored = browser && (returnTo || /^[\w-]{43}$/.test(state))
        ? database.consumeAttempt(hash(browser), state) : undefined;
      const attempt = stored?.match(/^([\w-]{43})(:pilot)?$/);
      if (!attempt) return redirect(response, resultLocation(returnTo ?? '/', 'retry'));
      const verifier = attempt[1];
      const destination = returnTo ?? (attempt[2] ? routes.pilot : routes.overview);

      setCookie(response, attemptCookie, '', 0);
      if (params.has('error')) {
        return redirect(response, resultLocation(destination, params.get('error') === 'access_denied' ? 'cancelled' : 'retry'));
      }
      const codes = params.getAll('code');
      if (codes.length !== 1 || !codes[0] || codes[0].length > 1024) return redirect(response, resultLocation(destination, 'retry'));

      let identity: Awaited<ReturnType<typeof identify>>;
      try {
        identity = await identify(codes[0], verifier);
      } catch {
        return redirect(response, resultLocation(destination, 'unavailable'));
      }
      const token = randomToken();
      database.createSession(hash(token), identity.owner, identity.name, Date.now() + identity.seconds * 1000);
      const oldToken = cookie(request, sessionCookie);
      if (oldToken) database.removeSession(hash(oldToken));
      setCookie(response, sessionCookie, token, identity.seconds);
      redirect(response, destination);
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
