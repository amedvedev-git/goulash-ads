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

test('новый владелец подключает Метрику и получает отчёт по сайту без кампании Директа', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-site-report-'));
  const db = openDatabase(directory);
  const login = createYandexAuth(db, 'fixture-login', 'fixture-secret', { requestJson: async url =>
    Response.json(String(url).startsWith('https://login.yandex.ru/') ? { client_id: 'fixture-login', id: '202' } :
      { access_token: 'fixture-login-token', expires_in: 3600 }) });
  const counter = { id: 101, site: 'shop.example', goals: [{ id: 42, name: 'Заказ', type: 'action' }] };
  const metrika = createMetrikaConnections(db, {
    clientId: 'fixture-metrika', clientSecret: 'fixture-secret',
    codec: createSecretCodec({ platform: 'linux', key: Buffer.alloc(32, 42) }),
    async transport(url, request) {
      const { origin, pathname, searchParams } = new URL(String(url));
      if (origin === 'https://oauth.yandex.ru') return Response.json({ access_token: 'fixture-read', scope: 'metrika:read', expires_in: 3600 });
      assert.equal(new Headers(request?.headers).get('authorization'), 'OAuth fixture-read');
      if (origin === 'https://login.yandex.ru') return Response.json({ id: '202', client_id: 'fixture-metrika' });
      assert.equal(origin, 'https://api-metrika.yandex.net');
      if (pathname === '/management/v1/counters') return Response.json({ counters: [counter] });
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
  assert.match(await get(panel), /Подключить Метрику/);
  assert.equal((await action('start')).status, 303);
  const link = (await get(panel)).match(/href="(https:\/\/oauth\.yandex\.ru\/authorize[^"]+)"/)![1];
  const approval = new URL(link.replaceAll('&amp;', '&'));
  assert.equal(approval.searchParams.get('scope'), 'metrika:read');
  assert.equal((await action('finish', { code: 'fixture-approval', state: approval.searchParams.get('state')! })).status, 303);
  const choices = await (await action('choices', {}, true)).json();
  assert.equal(choices.counters[0].id, '101');
  const inspected = await (await action('inspect', { counterId: '101' }, true)).json();
  assert.deepEqual(inspected.goals, [{ id: '42', name: 'Заказ' }]);
  assert.equal((await action('configure', { counterId: '101', goalId: '42', enable: 'read' })).status, 303);
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
});
