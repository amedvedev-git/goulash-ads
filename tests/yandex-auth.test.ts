import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { controlPlan } from './fixtures/e3-control.ts';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import { authDestination, callbackPath, createYandexAuth } from '../src/yandex-auth.ts';

test('вход через Яндекс ID, владение записью, истечение и выход', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'goulash-auth-'));
  const file = join(directory, 'stage2.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE test_record (id INTEGER PRIMARY KEY, content TEXT NOT NULL);
    INSERT INTO test_record VALUES (1, 'Прежняя локальная запись'); PRAGMA user_version = 1;`);
  legacy.close();
  const database = openDatabase(directory);
  assert.equal(database.read('local'), 'Прежняя локальная запись');

  let expectedChallenge = '';
  let exchanges = 0;
  const request: typeof fetch = async (url, options) => {
    if (url === 'https://oauth.yandex.ru/token') {
      exchanges++;
      assert.equal(options?.method, 'POST');
      assert.equal(new Headers(options?.headers).get('Authorization'), `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
      assert.ok(options?.body instanceof URLSearchParams);
      assert.equal(options.body.get('grant_type'), 'authorization_code');
      const verifier = options.body.get('code_verifier');
      assert.ok(verifier);
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), expectedChallenge);
      return Response.json({ access_token: `token-${options.body.get('code')}`, expires_in: 3600 });
    }
    assert.equal(url, 'https://login.yandex.ru/info?format=json');
    const authorization = new Headers(options?.headers).get('Authorization');
    if (authorization === 'OAuth token-unavailable') return new Response(null, { status: 401 });
    assert.match(authorization ?? '', /^OAuth token-[ab]$/);
    const alice = authorization === 'OAuth token-a';
    return Response.json({ id: alice ? '101' : '202', client_id: 'test-client', display_name: alice ? 'Анна <A>' : 'Борис' });
  };

  const server = createApp(database, createYandexAuth(database, 'test-client', 'test-secret', { requestJson: request }));
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    await rm(file, { force: true });
    await rmdir(directory);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const get = (path: string, cookie = '') => fetch(`${origin}${path}`, {
    headers: { Cookie: cookie }, redirect: 'manual', signal: t.signal,
  });
  const post = (path: string, cookie = '', source = origin, values: Record<string, string> = { content: 'Запись Анны' }) => fetch(`${origin}${path}`, {
    method: 'POST', headers: { Cookie: cookie, Origin: source },
    body: new URLSearchParams(values), redirect: 'manual', signal: t.signal,
  });
  async function start(returnTo?: string) {
    const response = await get('/auth/yandex' + (returnTo ? '?return=' + encodeURIComponent(returnTo) : ''));
    assert.equal(response.status, 303);
    const authorize = new URL(response.headers.get('location')!);
    assert.equal(authorize.origin + authorize.pathname, 'https://oauth.yandex.ru/authorize');
    assert.equal(authorize.searchParams.get('scope'), 'login:info');
    assert.equal(authorize.searchParams.get('redirect_uri'), `${origin}${callbackPath}`);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    expectedChallenge = authorize.searchParams.get('code_challenge')!;
    const cookie = response.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    return { state: authorize.searchParams.get('state'), cookie: cookie.split(';')[0] };
  }
  const sessionCookie = (response: Response) => {
    assert.equal(response.headers.get('location'), '/');
    const cookie = response.headers.getSetCookie().find((item) => item.startsWith('goulash_session='));
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=3600$/);
    return cookie.split(';')[0];
  };

  const initial = await (await get('/')).text();
  assert.match(initial, /Войти через Яндекс ID/);
  assert.doesNotMatch(initial, /Тестовая запись|Прежняя локальная запись/);
  assert.equal((await post('/test-record')).status, 401);
  assert.equal((await post('/campaign/preview')).status, 401);

  const a = await start();
  const aCallback = `${callbackPath}?state=${a.state}&code=a`;
  assert.equal((await get(aCallback)).headers.get('location'), '/?auth=retry');
  assert.equal((await get(`${callbackPath}?state=wrong&code=a`, a.cookie)).headers.get('location'), '/?auth=retry');
  assert.equal(exchanges, 0);
  const alice = sessionCookie(await get(aCallback, a.cookie));
  assert.equal((await get(aCallback, a.cookie)).headers.get('location'), '/?auth=retry');
  assert.equal(exchanges, 1);
  assert.match(await (await get('/', alice)).text(), /Анна &lt;A&gt;/);
  assert.equal((await post('/test-record', alice)).status, 303);
  const aliceInput = {
    revision: '0', description: 'Бизнес Анны', url: 'https://example.com', region: 'Пермь', budget: '1000', period: '7',
  };
  const manual = await post('/campaign/analyze', alice, origin, aliceInput);
  assert.equal(manual.status, 200);
  assert.match(await manual.text(), /Ручное заполнение/);
  assert.equal((await post('/campaign/preview', alice, origin, aliceInput)).status, 200);
  assert.equal((await post('/campaign/save', alice, origin, { ...aliceInput, title: 'Объявление Анны', adText: 'Описание предложения.' })).status, 303);

  const b = await start();
  const boris = sessionCookie(await get(`${callbackPath}?state=${b.state}&code=b`, b.cookie));
  const borisPage = await (await get('/', boris)).text();
  assert.match(borisPage, /Борис/);
  assert.doesNotMatch(borisPage, /Запись Анны/);
  assert.doesNotMatch(borisPage, /Бизнес Анны|id="campaign-preview"/);
  assert.equal((await post('/campaign/save', boris)).status, 409);
  const alicePage = await (await get('/campaigns?ad=default', alice)).text();
  assert.match(await (await get('/diagnostics', alice)).text(), /Запись Анны/);
  assert.match(alicePage, /Бизнес Анны/);

  // New operations must use the session owner, including forged cross-account IDs.
  assert.equal((await post('/demo/load', '', origin, { revision: '0', scenario: 'control' })).status, 401);
  assert.equal((await post('/demo/load', alice, 'https://example.test', { revision: '0', scenario: 'control' })).status, 403);
  const alicePlan=controlPlan(database,'yandex:101');
  assert.equal((await post('/demo/load', alice, origin, { revision: '0', scenario: 'control', planId:alicePlan, owner: 'yandex:202' })).status, 303);
  const aliceDemo = database.readDemo('yandex:101')!;
  assert.equal(database.readDemo('yandex:202'), undefined);
  assert.equal((await post('/demo/run', boris, origin, { datasetId: aliceDemo.datasetId })).status, 409);
  const aliceHistoryId = database.readHistory('yandex:101')[0].id;
  assert.equal((await post('/operations/undo', boris, origin, { id: aliceHistoryId })).status, 404);
  assert.doesNotMatch(await (await get('/', boris)).text(), new RegExp(aliceHistoryId));
  assert.equal((await post('/demo/permission',alice,origin,{revision:'0',datasetId:aliceDemo.datasetId,enabled:'yes',confirm:'control'})).status,303);
  assert.equal((await post('/demo/run', alice, origin, { datasetId: aliceDemo.datasetId })).status, 303);
  database.processDemoJob();
  const aliceDecision = database.readHistory('yandex:101')[0].id;
  for (const query of ['operation', 'review']) {
    const foreignView = await get(`/history?${query}=${aliceDecision}`, boris);
    assert.equal(foreignView.status, 404);
    assert.doesNotMatch(await foreignView.text(), new RegExp(aliceDecision));
  }
  assert.equal((await post('/operations/undo', boris, origin, { id: aliceDecision })).status, 404);
  assert.equal((await post('/operations/undo', alice, origin, { id: aliceDecision, confirm: 'undo' })).status, 303);
  assert.equal(database.readDemo('yandex:101')!.state.campaigns[0].spent, 180000);

  const cancelled = await start();
  const cancelledLocation = (await get(`${callbackPath}?state=${cancelled.state}&error=access_denied`, cancelled.cookie)).headers.get('location');
  assert.equal(cancelledLocation, '/?auth=cancelled');
  assert.match(await (await get(cancelledLocation!)).text(), /class="notice neutral" role="status"[^>]*><p>Вход отменён/);
  const failed = await start();
  const failureLocation = (await get(`${callbackPath}?state=${failed.state}&code=unavailable`, failed.cookie)).headers.get('location');
  assert.equal(failureLocation, '/?auth=unavailable');
  assert.match(await (await get(failureLocation!)).text(), /class="notice error" role="alert"[^>]*><p>Не удалось войти/);

  const workspace = database.createCampaignWorkspace('yandex:101').id;
  const connection = '/connections/direct?ad=' + workspace + '&from=results';
  const connectionLogin = '/auth/yandex?return=' + encodeURIComponent(connection);
  const guest = await (await get(connection)).text();
  assert.match(guest, /<h1>Подключения<\/h1>/);
  assert.ok(guest.includes(`href="${connectionLogin}"`));
  for (const [target, notice] of [
    [`/prepare?ad=${workspace}&tab=ads`, 'preparation=saved'],
    [`/results?ad=${workspace}&run=${workspace}`, 'filters=applied'],
    [`/history?ad=${workspace}&operation=${workspace}`, 'undo=ok'],
  ]) {
    assert.ok((await (await get(target + '&' + notice)).text()).includes(`href="/auth/yandex?return=${encodeURIComponent(target)}"`));
  }
  const scoped = await start(connection);
  const complete = await get(`${callbackPath}?state=${scoped.state}&code=a`, scoped.cookie);
  assert.equal(complete.headers.get('location'), connection);
  const scopedSession = complete.headers.getSetCookie().find(item => item.startsWith('goulash_session='))!.split(';')[0];
  assert.match(await (await get(connection, scopedSession)).text(), /Результаты кампании/);
  const inaccessible = await get(connection, boris);
  assert.equal(inaccessible.status, 404);
  const inaccessibleHtml = await inaccessible.text();
  assert.match(inaccessibleHtml, /Подключения недоступны/);
  assert.match(inaccessibleHtml, /href="\/connections\/direct">Открыть подключения/);
  assert.ok(inaccessibleHtml.includes(`href="${connectionLogin}">Войти под другим аккаунтом`));
  assert.doesNotMatch(inaccessibleHtml, /Анна &lt;A&gt;/);

  const metrika = connection + '#metrika-title';
  const budgetLogin = await start('/results#demo');
  assert.equal((await get(`${callbackPath}?state=${budgetLogin.state}&code=a`, budgetLogin.cookie)).headers.get('location'), '/results#demo');
  assert.equal(authDestination('/results?ad=default#demo'), undefined);
  const settingsPanel = connection + '&panel=metrika';
  assert.equal(authDestination(settingsPanel), settingsPanel);
  assert.ok((await (await get(settingsPanel)).text()).includes(`href="/auth/yandex?return=${encodeURIComponent(settingsPanel)}"`));
  for (const invalid of [connection + '#other', metrika + '#other', '/prepare?ad=default#metrika-title', '/pilot#metrika-title',
    connection + '&panel=other', settingsPanel + '&panel=advertiser', '/prepare?ad=default&panel=metrika']) {
    assert.equal(authDestination(invalid, true), undefined);
  }
  const anchoredRefusal = await start(metrika);
  assert.equal((await get(`${callbackPath}?state=${anchoredRefusal.state}&error=access_denied`, anchoredRefusal.cookie)).headers.get('location'),
    connection + '&auth=cancelled#metrika-title');
  const anchored = await start(metrika);
  assert.equal((await get(`${callbackPath}?state=${anchored.state}&code=a`, anchored.cookie)).headers.get('location'), metrika);

  const exchangeCount = exchanges;
  const refused = await start(connection);
  const tamperedState = refused.state!.replace(/.$/, character => character === 'A' ? 'B' : 'A');
  assert.equal((await get(`${callbackPath}?state=${tamperedState}&code=a`, refused.cookie)).headers.get('location'), '/?auth=retry');
  const refusal = await get(`${callbackPath}?state=${refused.state}&error=access_denied`, refused.cookie);
  assert.equal(refusal.headers.get('location'), connection + '&auth=cancelled');
  assert.match(await (await get(refusal.headers.get('location')!)).text(), /Вход отменён/);
  const outdated = await start(connection);
  const expiredAttempt = new DatabaseSync(file);
  expiredAttempt.exec('UPDATE oauth_attempts SET expires_at = 0');
  expiredAttempt.close();
  for (const browserCookie of [outdated.cookie, '']) {
    const retry = await get(`${callbackPath}?state=${outdated.state}&code=a`, browserCookie);
    assert.equal(retry.headers.get('location'), connection + '&auth=retry');
    assert.ok(!retry.headers.getSetCookie().some(item => item.startsWith('goulash_session=')));
    assert.ok((await (await get(retry.headers.get('location')!)).text()).includes(`href="${connectionLogin}"`));
  }
  assert.equal(exchanges, exchangeCount);
  for (const invalid of ['https://outside.example', '//outside.example', '/connections/direct?from=results', '/connections/direct?ad=default&ad=default']) {
    const attempt = await start(invalid);
    assert.equal((await get(`${callbackPath}?state=${attempt.state}&error=access_denied`, attempt.cookie)).headers.get('location'), '/?auth=cancelled');
  }

  const priorBrowser = 'a'.repeat(43), priorState = 'b'.repeat(43), priorVerifier = 'c'.repeat(43);
  database.startAttempt(createHash('sha256').update('test-client:' + priorBrowser).digest('hex'), priorState, priorVerifier + ':pilot', Date.now() + 60000);
  expectedChallenge = createHash('sha256').update(priorVerifier).digest('base64url');
  assert.equal((await get(`${callbackPath}?state=${priorState}&code=a`, 'goulash_oauth=' + priorBrowser)).headers.get('location'), '/pilot');

  assert.equal((await post('/logout', alice, 'https://example.test')).status, 403);
  const logout = await post('/logout', alice);
  assert.equal(logout.status, 303);
  assert.match(logout.headers.getSetCookie()[0], /goulash_session=;.*Max-Age=0/);
  assert.equal((await post('/test-record', alice)).status, 401);

  const sqlite = new DatabaseSync(file);
  sqlite.exec('UPDATE sessions SET expires_at = 0');
  sqlite.close();
  assert.equal((await post('/test-record', boris)).status, 401);
  assert.ok((await (await get(connection, scopedSession)).text()).includes(`href="${connectionLogin}"`));
  const expired = await post(connection.replace('/connections/direct', '/connections/metrika/disconnect'), scopedSession);
  assert.equal(expired.status, 401);
  assert.ok((await expired.text()).includes(`href="${connectionLogin}"`));

  for (const [path, target, fields] of [
    ['/preparation/save', `/prepare?ad=${workspace}`, { ad: workspace, campaignName: 'Несохранённый черновик' }],
    [`/campaign/creative-review?ad=${workspace}`, `/prepare?ad=${workspace}&tab=ads`, { title: 'Несохранённая правка' }],
    [`/campaign/next-period?ad=${workspace}`, `/prepare?ad=${workspace}`, { from: '2099-02-01' }],
    [`/analytics/settings?ad=${workspace}`, `/results?ad=${workspace}`, { days: '30' }],
  ] as const) {
    const recovery = await post(path, scopedSession, origin, fields);
    assert.equal(recovery.status, 401);
    const page = await recovery.text();
    assert.match(page, /Действие не выполнено/);
    assert.ok(page.includes(`href="/auth/yandex?return=${encodeURIComponent(target)}"`));
    assert.doesNotMatch(page, /Несохранённый черновик|Несохранённая правка/);
  }
});

test('за Caddy используются публичный HTTPS callback и Secure cookies', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'goulash-https-'));
  const database = openDatabase(directory);
  const publicOrigin = new URL('https://ads.example.org');
  const requestJson: typeof fetch = async (url) => url === 'https://oauth.yandex.ru/token'
    ? Response.json({ access_token: 'test-token', expires_in: 3600 })
    : Response.json({ id: '101', client_id: 'test-client', display_name: 'Анна' });
  const auth = createYandexAuth(database, 'test-client', 'test-secret', { requestJson, secureCookies: true });
  const server = createApp(database, auth, publicOrigin);
  t.after(async () => {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
    await rm(join(directory, 'stage2.sqlite'), { force: true });
    await rmdir(directory);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const upstream = `http://127.0.0.1:${address.port}`;
  const send = (path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number | undefined; headers: Headers }>((resolve, reject) => {
      const request = httpRequest(`${upstream}${path}`, {
        method: options.method, headers: { Host: publicOrigin.host, ...options.headers }, signal: t.signal,
      }, (response) => {
        const headers = new Headers();
        for (const [key, values] of Object.entries(response.headersDistinct)) {
          for (const value of values ?? []) headers.append(key, value);
        }
        response.resume();
        response.once('end', () => resolve({ status: response.statusCode, headers }));
        response.once('error', reject);
      });
      request.once('error', reject);
      request.end(options.body);
    });

  assert.equal((await fetch(upstream, { signal: t.signal })).status, 400);
  const start = await send('/auth/yandex', { headers: { 'X-Forwarded-Host': 'bad.example', 'X-Forwarded-Proto': 'http' } });
  assert.equal(start.status, 303);
  const authorize = new URL(start.headers.get('location')!);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${publicOrigin.origin}${callbackPath}`);
  const browser = start.headers.getSetCookie()[0];
  assert.match(browser, /; Secure$/);
  const callback = await send(`${callbackPath}?state=${authorize.searchParams.get('state')}&code=test-code`, {
    headers: { Cookie: browser.split(';')[0] },
  });
  assert.equal(callback.headers.get('location'), '/');
  const session = callback.headers.getSetCookie().find((item) => item.startsWith('goulash_session='));
  assert.ok(session);
  assert.match(session, /; Secure$/);

  const post = (origin: string) => send('/campaign/new', {
    method: 'POST', headers: { Origin: origin, Cookie: session.split(';')[0], 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams().toString(),
  });
  assert.equal((await post(upstream)).status, 403);
  assert.equal((await post(publicOrigin.origin)).status, 303);
  assert.equal((await send('/diagnostics', { headers: { Cookie: session.split(';')[0] } })).status, 404);
  assert.equal((await send('/test-record', { method: 'POST', headers: { Origin: publicOrigin.origin, Cookie: session.split(';')[0] } })).status, 404);
});
