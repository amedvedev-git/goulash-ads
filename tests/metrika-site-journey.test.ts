import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { createMetrikaConnections } from '../src/metrika-connect.ts';
import { createApp } from '../src/server.ts';
import { createYandexAuth } from '../src/yandex-auth.ts';

test('владелец подключает и переподключает Метрику, выбирает цель и получает отчёт без Директа', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-site-report-'));
  const db = openDatabase(directory);
  const login = createYandexAuth(db, 'fixture-login', 'fixture-secret', { requestJson: async url =>
    Response.json(String(url).startsWith('https://login.yandex.ru/') ? { client_id: 'fixture-login', id: '202' } :
      { access_token: 'fixture-login-token', expires_in: 3600 }) });
  const counter = { id: 101, site2: { site: 'shop.example' }, mirrors2: [{ site: 'mirror.example' }],
    goals: [{ id: 42, name: 'Заказ', type: 'action' }] };
  const metrika = createMetrikaConnections(db, {
    clientId: 'fixture-metrika', clientSecret: 'fixture-secret',
    codec: createSecretCodec({ platform: 'linux', key: Buffer.alloc(32, 42) }),
    async transport(url, request) {
      const { origin, pathname, searchParams } = new URL(String(url));
      if (origin === 'https://oauth.yandex.ru') {
        if ((request?.body as URLSearchParams).get('code') === 'bad-code') return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({ access_token: 'fixture-read', scope: 'metrika:read', expires_in: 3600 });
      }
      assert.equal(new Headers(request?.headers).get('authorization'), 'OAuth fixture-read');
      if (origin === 'https://login.yandex.ru') return Response.json({ id: '202', client_id: 'fixture-metrika' });
      assert.equal(origin, 'https://api-metrika.yandex.net');
      if (pathname === '/management/v1/counters') {
        if (searchParams.get('offset') !== '1') return Response.json({ error: 'offset starts at 1' }, { status: 400 });
        return Response.json({ counters: [counter] });
      }
      if (pathname === '/management/v1/counter/101') return Response.json({ counter });
      assert.equal(pathname, '/stat/v1/data');
      assert.equal(searchParams.get('ids'), '101');
      assert.equal(searchParams.get('metrics'), 'ym:s:visits,ym:s:goal42reaches,ym:s:goal42visits');
      const query = { ...Object.fromEntries(searchParams), metrics: searchParams.get('metrics')!.split(',') };
      return Response.json({ query, totals: [12, 3, 2], data: [{ metrics: [12, 3, 2] }],
        total_rows: 1, sampled: false, sample_share: 1, data_lag: 0 });
    },
  });
  const server = createApp(db, login, undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined,
    undefined, undefined, undefined, undefined, metrika);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const begin = await fetch(origin + '/auth/yandex', { redirect: 'manual' });
  const state = new URL(begin.headers.get('location')!).searchParams.get('state')!;
  const callback = await fetch(origin + '/auth/yandex/callback?' + new URLSearchParams({ code: 'fixture', state }), {
    redirect: 'manual', headers: { Cookie: begin.headers.getSetCookie()[0].split(';')[0] },
  });
  const cookie = callback.headers.getSetCookie().find(value => value.startsWith('goulash_session='))!.split(';')[0];
  const get = async (path: string) => (await fetch(origin + path, { headers: { Cookie: cookie } })).text();
  const post = (path: string, data: Record<string, string>, json = false) => fetch(origin + path, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, Accept: json ? 'application/json' : 'text/html' },
    body: new URLSearchParams(data),
  });
  const panel = '/connections/direct?panel=metrika';
  const revision = () => String(db.readAnalyticsSettings('yandex:202').revision);
  const action = (name: string, values: Record<string, string> = {}, json = false) =>
    post('/connections/metrika/' + name, { returnPanel: 'metrika', revision: revision(), ...values }, json);
  async function startConnection() {
    assert.equal((await action('start')).status, 303);
    const link = (await get(panel)).match(/href="(https:\/\/oauth\.yandex\.ru\/authorize[^"]+)"/)![1];
    const approval = new URL(link.replaceAll('&amp;', '&'));
    assert.equal(approval.searchParams.get('scope'), 'metrika:read');
    return approval.searchParams.get('state')!;
  }
  async function connectAndSelect() {
    assert.equal((await action('finish', { code: 'fixture-approval', state: await startConnection() })).status, 303);
    assert.match(await get(panel), /Доступ получен[\s\S]*Выберите счётчик и цель для отчётов/);
    assert.match(await get(panel), /<form[^>]+action="\/connections\/metrika\/list"[\s\S]*?Показать счётчики/);
    const serverOptions = await action('list');
    assert.equal(serverOptions.status, 200);
    assert.match(await serverOptions.text(), /<option value="101">shop\.example · 101<\/option>/);
    const serverGoals = await action('inspect', { counterId: '101' });
    assert.equal(serverGoals.status, 200);
    const serverPanel = await serverGoals.text();
    assert.match(serverPanel, /<option value="42">Заказ<\/option>/);
    assert.match(serverPanel, /formaction="\/connections\/metrika\/inspect" formnovalidate>Загрузить цели/);
    assert.match(serverPanel, /data-metrika-native[^>]*>[\s\S]*?Сохранить настройки/);
    const choices = await action('choices', {}, true);
    assert.equal(choices.status, 200, 'список счётчиков должен загружаться после подключения');
    assert.deepEqual((await choices.json()).counters, [{ id: '101', domain: 'shop.example' }]);
    const inspected = await (await action('inspect', { counterId: '101' }, true)).json();
    assert.deepEqual(inspected.goals, [{ id: '42', name: 'Заказ' }]);
    assert.equal((await action('configure', { counterId: '101', goalId: '42', enable: 'read' })).status, 303);
    const settings = db.readAnalyticsSettings('yandex:202');
    assert.equal(settings.goalId, '42');
    assert.deepEqual(settings.counter?.mirrors, ['mirror.example']);
  }
  assert.match(await get(panel), /Подключить Метрику/);
  const failed = await action('finish', { code: 'bad-code', state: await startConnection() });
  assert.equal(failed.status, 409);
  const errorDialog = (await failed.text()).match(/<dialog[^>]+id="connection-metrika"[\s\S]+?<\/dialog>/)?.[0] ?? '';
  assert.match(errorDialog, /role="alert"[^>]*><p>Код Метрики неверен, просрочен или уже использован/);
  await connectAndSelect();
  const before = await get('/results');
  assert.match(before, /name="source" value="metrika_site"/);
  assert.doesNotMatch(before, /name="source" value="(?:direct_reports|metrika_direct)"/);
  const original = db.readAnalyticsSettings('yandex:202');
  assert.equal((await post('/analytics/settings', { period: 'custom', customFrom: original.dateTo,
    customTo: original.dateTo, revision: revision(), directRunId: '' })).status, 303);
  const dates = db.readAnalyticsSettings('yandex:202');
  assert.equal(dates.dateFrom, original.dateTo);
  assert.equal(dates.goalId, '42');
  assert.equal((await post('/analytics/refresh', { source: 'metrika_site', goalId: '42', revision: revision(),
    dateFrom: dates.dateFrom, dateTo: dates.dateTo, directRunId: '' })).status, 303);
  const result = await get('/results');
  assert.match(result, /data-report-source="metrika_site" data-report-status="ready"/);
  assert.match(result, /Достижения цели 3 · Целевые визиты 2/);
  assert.match(result, /shop\.example · цель «Заказ»/);

  await connectAndSelect();
  const proof = (await get(panel)).match(/name="disconnectProof" value="([\w-]+)"/);
  assert.ok(proof, 'в личном подключении доступно отключение');
  assert.equal((await action('disconnect', { confirm: 'disconnect', disconnectProof: proof[1] })).status, 303);
  const disconnected = await get(panel);
  assert.match(disconnected, /Отключена[\s\S]*Подключить Метрику/);
  assert.doesNotMatch(disconnected, /shop\.example|Счётчик и цель/);
  await connectAndSelect();
});
