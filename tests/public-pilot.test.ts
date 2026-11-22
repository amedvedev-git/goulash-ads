import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import { callbackPath, createYandexAuth } from '../src/yandex-auth.ts';

test('публичный Rollstar проходит учебный запуск в отдельной базе и изолирует владельцев', async t => {
  const root = resolve('output/cabinet-block2');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'public-'));
  const main = openDatabase(directory);
  const demoDirectory = join(directory, 'pilot-demo');
  let demo = openDatabase(demoDirectory);
  const publicOrigin = new URL('https://acceptance.example.test');
  const client = 'public-pilot-test';
  let verifier = '';
  const auth = createYandexAuth(main, client, 'test-only', { secureCookies: true, requestJson: async (url, init) => {
    if (String(url).endsWith('/token')) {
      verifier = (init?.body as URLSearchParams).get('code_verifier')!;
      return Response.json({ access_token: 'fixture-token', expires_in: 60 });
    }
    return Response.json({ client_id: client, id: '503', display_name: 'Учебный владелец' });
  } });
  const alice = 'yandex:501', bob = 'yandex:502';
  const aliceToken = 'a'.repeat(43), bobToken = 'b'.repeat(43);
  for (const [owner, token, name] of [[alice, aliceToken, 'Алиса'], [bob, bobToken, 'Борис']]) {
    main.createSession(createHash('sha256').update(`${client}:${token}`).digest('hex'), owner, name, Date.now() + 60000);
  }
  const liveCampaign = main.createCampaignWorkspace(alice);
  let liveConnectionReads = 0;
  const liveConnections = {
    resolve: () => { liveConnectionReads++; return undefined; },
    view: () => { liveConnectionReads++; return undefined; },
  } as unknown as NonNullable<Parameters<typeof createApp>[9]>;
  const app = (db: typeof demo) => createApp(main, auth, publicOrigin, undefined, undefined, undefined, undefined, undefined,
    {}, liveConnections, undefined, undefined, undefined, db);
  assert.throws(() => app(main), /отдельная база/);
  let server = app(demo);
  const listen = () => new Promise<number>(done => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    assert(address && typeof address !== 'string');
    done(address.port);
  }));
  const close = () => new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  let port = await listen();
  t.after(async () => { if (server.listening) await close(); demo.close(); main.close(); });
  const request = (path: string, token?: string, body?: URLSearchParams, origin = publicOrigin.origin, cookie?: string) =>
    new Promise<Response>((done, fail) => {
      const req = httpRequest(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', signal: t.signal,
        headers: { Host: publicOrigin.host, ...(cookie || token ? { Cookie: cookie ?? `goulash_session=${token}` } : {}),
          ...(body ? { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', fail);
        response.on('end', () => {
          const headers = new Headers(response.headers.location ? { Location: response.headers.location } : {});
          for (const value of response.headers['set-cookie'] ?? []) headers.append('Set-Cookie', value);
          done(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
        });
      });
      req.on('error', fail);
      req.end(body?.toString());
    });
  const html = async (token: string) => {
    const response = await request('/pilot', token);
    assert.equal(response.status, 200);
    return response.text();
  };
  const form = (page: string, action: string, extra: Record<string, string> = {}) => {
    const input = new URLSearchParams({ action, confirm: 'yes', ...extra });
    for (const field of ['campaignId', 'revision', 'generation', 'run']) {
      const value = page.match(new RegExp(`name="${field}" value="([^"]+)"`))?.[1];
      assert(value, field);
      input.set(field, value);
    }
    return input;
  };
  const start = new URLSearchParams({ action: 'start-demo' });
  const post = async (action: string, extra?: Record<string, string>) => {
    const response = await request('/pilot', aliceToken, form(await html(aliceToken), action, extra));
    assert.equal(response.status, 303, response.status === 303 ? undefined : await response.text());
    assert.equal(response.headers.get('location'), action === 'reports' ? '/pilot#pilot-results-title' : '/pilot');
  };

  assert.match(await (await request('/', aliceToken)).text(), /href="\/pilot">Учебный запуск Rollstar/);
  const guestHome = await request('/');
  assert.equal(guestHome.status, 200);
  const guestHomeHtml = await guestHome.text();
  assert.match(guestHomeHtml, /href="\/auth\/yandex">Войти через Яндекс ID/);
  assert.match(guestHomeHtml, /href="\/pilot">Учебный запуск Rollstar<\/a>/);
  assert.match(guestHomeHtml, /href="\/how-it-works">Как это работает<\/a>/);
  liveConnectionReads = 0;
  for (const token of [undefined, aliceToken]) {
    const guide = await request('/how-it-works', token);
    assert.equal(guide.status, 200);
    const guideHtml = await guide.text();
    assert.match(guideHtml, /<h1>Как это работает[\s\S]*<h2>Что это[\s\S]*<h2>Как работает[\s\S]*<h2>Где ИИ/);
    assert.match(guideHtml, /href="\/pilot">Учебный запуск Rollstar/);
    assert.match(guideHtml, /href="\/results#demo">«Учебное перераспределение бюджета»/);
    assert.equal(guideHtml.includes('Профиль: Алиса'), Boolean(token));
  }
  assert.equal(liveConnectionReads, 0, 'справка не читает рабочий кабинет');
  const guest = await request('/pilot');
  assert.equal(guest.status, 401);
  const guestHtml = await guest.text();
  assert.match(guestHtml, /Учебный запуск Rollstar/);
  assert.match(guestHtml, /href="\/auth\/yandex\?return=%2Fpilot"/);
  assert.doesNotMatch(guestHtml, /href="\/pilot">Учебный запуск Rollstar<\/a>/);
  assert.doesNotMatch(guestHtml, /сохраните черновик в своём/);
  async function login(target: string, result = 'code=fictional') {
    const start = await request('/auth/yandex?return=' + target);
    const authority = new URL(start.headers.get('location')!);
    const attempt = start.headers.getSetCookie()[0].split(';')[0];
    const done = await request(`${callbackPath}?state=${authority.searchParams.get('state')}&${result}`, undefined, undefined, publicOrigin.origin, attempt);
    return { done, authority };
  }
  const pilotLogin = await login('%2Fpilot');
  assert.equal(pilotLogin.done.headers.get('location'), '/pilot');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), pilotLogin.authority.searchParams.get('code_challenge'));
  const pilotSession = pilotLogin.done.headers.getSetCookie().find(cookie => cookie.startsWith('goulash_session='))!.split(';')[0];
  assert.match(await (await request('/pilot', undefined, undefined, publicOrigin.origin, pilotSession)).text(), /Начать учебный запуск/);
  assert.equal((await login('%2Fpilot', 'error=access_denied')).done.headers.get('location'), '/pilot?auth=cancelled');
  for (const invalid of ['%2F%2Foutside.example', '%2Fpilot%3Fad%3Dother', '%2Fpilot&return=%2Fpilot']) {
    assert.equal((await login(invalid)).done.headers.get('location'), '/');
  }
  assert.equal((await request('/pilot', undefined, start)).status, 401);
  assert.equal((await request('/pilot', aliceToken, start, 'https://other.example.test')).status, 403);
  assert.equal((await request('/pilot?ad=' + liveCampaign.id, aliceToken)).status, 404);
  assert.match(await html(aliceToken), /Начать учебный запуск/);
  assert.deepEqual(demo.readCampaignWorkspaces(alice), []);
  assert.equal((await request('/pilot', aliceToken, start)).status, 303);
  assert.equal((await request('/pilot', bobToken, start)).status, 303);
  const activeRun = demo.readDirect(alice);
  assert.equal((await request('/pilot', aliceToken, start)).status, 303);
  assert.deepEqual(demo.readDirect(alice), activeRun);
  const initial = await html(aliceToken);
  assert.match(initial, /Показы выключены/);
  assert.equal((await request('/pilot', bobToken, form(initial, 'check'))).status, 409);
  const wrongCampaign = form(initial, 'check');
  wrongCampaign.set('campaignId', liveCampaign.id);
  assert.equal((await request('/pilot', aliceToken, wrongCampaign)).status, 404);

  await post('check');
  await post('test-order');
  assert.equal((await request('/pilot', aliceToken, form(initial, 'check'))).status, 409);
  const invalidLimit = await request('/pilot', aliceToken, form(await html(aliceToken), 'moderate', { limitRub: ' 8000 ' }));
  assert.equal(invalidLimit.status, 409);
  const invalidPage = await invalidLimit.text();
  assert.match(invalidPage, /id="pilot-limit"[^>]*value=" 8000 "[\s\S]*?aria-describedby="pilot-limit-help" aria-invalid="true" autofocus data-page-focus/);
  assert.match(invalidPage, /id="pilot-limit-help" class="field-error">[^<]*Минимальный лимит с НДС — 8\s*540\s*₽/);
  assert.equal(demo.readDirect(alice)?.pilot?.budget, undefined);
  await post('moderate', { limitRub: '8540' });
  await post('refresh');
  assert.match(await html(aliceToken), /На модерации/);
  await post('refresh');
  assert.match(await html(aliceToken), /Отчёт ещё не запрашивали/);
  await post('reports');
  const waiting = await html(aliceToken);
  assert.match(waiting, /id="pilot-results-title" tabindex="-1" aria-describedby="pilot-report-status"/);
  assert.match(waiting, /Отчёт пока не готов\. Включите показы/);
  await post('start');
  const pendingStart = await html(aliceToken);
  assert.match(pendingStart, /<button class="primary" type="submit">Сверить статус/);
  assert.match(pendingStart, /<button class="secondary" type="submit">Остановить показы/);
  await close();
  demo.close();
  demo = openDatabase(demoDirectory);
  server = app(demo);
  port = await listen();
  await post('refresh');
  await post('refresh');
  assert.match(await html(aliceToken), /Показы идут/);
  await post('reports');
  assert.equal(demo.readDirect(alice)?.pilot?.report?.latest?.orders, 4);
  await post('stop');
  await post('refresh');
  await post('refresh');
  await post('reports');
  assert.equal(demo.readDirect(alice)?.pilot?.report?.status, 'stale');
  assert.match(await html(aliceToken), /Отчёт устарел\. Показаны последние подтверждённые данные/);
  await post('reports');
  assert.equal(demo.readDirect(alice)?.pilot?.budget?.finalSpendKop, 256200);
  assert.equal(demo.readDirect(alice)?.pilot?.budget?.reservedKop, 0);
  const finalPage = await html(aliceToken);
  assert.match(finalPage, /Итоговый отчёт\. Расход подтверждён/);
  assert.match(finalPage, /href="\/pilot\?restart=confirm">Начать новый учебный запуск/);
  const previous = demo.readDirect(alice);
  const confirmPage = async () => (await request('/pilot?restart=confirm', aliceToken)).text();
  const confirmation = await confirmPage();
  assert.match(confirmation, /Новый запуск удалит результаты, журнал и данные об учебном бюджете/);
  assert.match(confirmation, /Итоговый расход предыдущего запуска — 2\s*562\s*₽/);
  assert.match(confirmation, /href="\/pilot">Отмена/);
  assert.doesNotMatch(await html(aliceToken), /Заменить предыдущий учебный запуск/);
  const replacement = form(confirmation, 'restart-demo');
  replacement.delete('confirm');
  assert.equal((await request('/pilot', aliceToken, replacement)).status, 409);
  replacement.set('confirm', 'yes');
  replacement.append('confirm', 'yes');
  assert.equal((await request('/pilot', aliceToken, replacement)).status, 409);
  replacement.set('confirm', 'yes');
  assert.equal((await request('/pilot', aliceToken, start)).status, 409);
  assert.deepEqual(demo.readDirect(alice), previous);
  await post('reports');
  const staleReplacement = await request('/pilot', aliceToken, replacement);
  assert.equal(staleReplacement.status, 409);
  assert.match(await staleReplacement.text(), /Учебный запуск изменился/);
  assert.equal(demo.readDirect(alice)?.pilot?.budget?.finalSpendKop, 256200);
  const confirmedReplacement = form(await confirmPage(), 'restart-demo');
  const replaced = await Promise.all([request('/pilot', aliceToken, confirmedReplacement), request('/pilot', aliceToken, confirmedReplacement)]);
  assert.deepEqual(replaced.map(response => response.status).sort(), [303, 409]);
  const staleReport = await request('/pilot', aliceToken, form(finalPage, 'reports'));
  assert.equal(staleReport.status, 409);
  assert.match(await staleReport.text(), /id="pilot-results-title"[^>]*data-page-focus[\s\S]*?id="pilot-report-error"[^>]*>Экран устарел/);
  assert.match(await html(aliceToken), /Показы выключены/);
  assert.doesNotMatch(await html(aliceToken), /Итоговый отчёт|Журнал учебного запуска/);
  assert.equal(demo.readDirect(bob)?.pilot, undefined);
  assert.deepEqual(main.readCampaignWorkspaces(alice).map(row => ({ ...row })), [liveCampaign]);
  assert.deepEqual(main.readCampaignWorkspaces(bob), []);
  assert.equal(main.readDirect(alice), undefined);
  assert.equal(main.readDirect(bob), undefined);
  assert.equal(liveConnectionReads, 0);
});
