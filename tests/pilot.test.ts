import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { campaignCatalogItems } from '../src/campaign-catalog-data.ts';
import { createPilot } from '../src/pilot.ts';
import { pilotBrowser } from './fixtures/pilot-browser.ts';

test('локальный OAuth использует адрес стенда и отделён от учебного кабинета и форм', async t => {
  const root = resolve('output/cabinet-block2');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(resolve(root, 'combined-test-'));
  const loginApi: string[] = [];
  const fixture = await pilotBrowser(resolve(directory, 'training'), {
    directory: resolve(directory, 'actual'), clientId: 'local-login-test', clientSecret: 'test-secret',
    requestJson: async url => {
      loginApi.push(String(url));
      return String(url).endsWith('/token') ? Response.json({ access_token: 'auth-test', expires_in: 3600 })
        : Response.json({ id: '101', client_id: 'local-login-test', display_name: 'Владелец локального кабинета' });
    },
  });
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  t.after(async () => {
    const closed = once(fixture.server, 'close');
    fixture.server.close();
    fixture.server.closeAllConnections();
    await closed;
    fixture.db.close();
  });
  const origin = `http://127.0.0.1:${(fixture.server.address() as { port: number }).port}`;
  const cookies = new Map<string, string>();
  async function send(path: string, method = 'GET') {
    const response = await fetch(origin + path, { method, redirect: 'manual', signal: t.signal, body: method === 'POST' ? new URLSearchParams() : undefined,
      headers: { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '), Origin: origin } });
    for (const header of response.headers.getSetCookie()) {
      const [name, value] = header.split(';', 1)[0].split('=');
      if (value) cookies.set(name, value);
      else cookies.delete(name);
    }
    return response;
  }

  const landing = await (await send('/')).text();
  assert.match(landing, /href="\/auth\/yandex">Войти через Яндекс ID/);
  assert.doesNotMatch(landing, /href="https?:\/\/[^"]+\/auth\/yandex/);
  const localPilot = await send('/pilot');
  assert.equal(localPilot.status, 401);
  const pilotGuest = await localPilot.text();
  assert.match(pilotGuest, /Учебный запуск Rollstar/);
  assert.doesNotMatch(pilotGuest, /\/auth\/yandex|сохраните черновик в своём/);
  const pilotEntry = pilotGuest.match(/href="(\/fixture-login\/a\?return=pilot)"/)?.[1];
  assert.ok(pilotEntry);
  assert.equal((await send(pilotEntry)).headers.get('location'), fixture.path);
  assert.match(await (await send(fixture.path)).text(), /Ход запуска/);
  assert.deepEqual(loginApi, []);
  assert.equal((await send('/pilot')).headers.get('location'), fixture.path);
  assert.ok(cookies.has('goulash_training_session'));
  const training = await (await send('/connections/direct')).text();
  assert.match(training, /href="\/auth\/yandex">Войти через Яндекс ID/);
  assert.match(training, /action="\/_preview\/training\/connections\/direct\/disconnect"/);
  assert.equal((await send('/_preview/training/connections/direct/start', 'POST')).status, 303);
  assert.ok(cookies.has('goulash_training_direct'));
  assert.match(await (await send('/connections/direct')).text(), /Учебный код/);

  const start = await send('/auth/yandex');
  const authorization = new URL(start.headers.get('location')!);
  const callback = new URL(authorization.searchParams.get('redirect_uri')!);
  assert.equal(authorization.origin, 'https://oauth.yandex.ru');
  assert.equal(callback.origin + callback.pathname, origin + '/auth/yandex/callback');
  assert.equal((await send('/_preview/training/connections/direct/disconnect', 'POST')).status, 409);
  callback.searchParams.set('state', authorization.searchParams.get('state')!);
  callback.searchParams.set('code', 'local-test-code');
  assert.equal((await send(callback.pathname + callback.search)).headers.get('location'), '/');
  assert.ok(cookies.has('goulash_session'));
  assert.ok(cookies.has('goulash_training_session'));
  const actual = await (await send('/')).text();
  assert.match(actual, /Владелец локального кабинета/);
  assert.match(actual, /action="\/_preview\/live\/logout"/);
  assert.doesNotMatch(actual, /Rollstar|Владелец Rollstar/);
  assert.equal((await send('/connections/direct/disconnect', 'POST')).status, 409);
  assert.deepEqual(loginApi, ['https://oauth.yandex.ru/token', 'https://login.yandex.ru/info?format=json']);

  assert.equal((await send('/pilot')).headers.get('location'), fixture.path);
  assert.equal((await send('/_preview/live/logout', 'POST')).status, 409);
  await send('/fixture');
  assert.equal((await send('/_preview/live/logout', 'POST')).status, 409);
  assert.match(await (await send('/connections/direct')).text(), /connection-badge ok">Учебный/);
  assert.ok(fixture.manager.resolve(fixture.owner));
});

async function setup(t: { after(action: () => void): void }) {
  const root = resolve('output/cabinet-block2');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(resolve(root, 'test-'));
  let x = await pilotBrowser(directory);
  t.after(() => x.db.close());
  const service = () => createPilot(x.db, x.fixture.provider, owner => x.manager.resolve(owner),
    (owner, generation, run) => x.manager.reconciled(owner, generation, run));
  const view = () => service().view(x.owner, x.workspace)!;
  const form = (action: string, extra = {}) => new URLSearchParams({ action, revision: String(view().revision),
    generation: String(view().generation), run: view().target.run, confirm: 'yes', ...extra });
  const post = (action: string, extra = {}, input = form(action, extra)) => service().action(x.owner, x.workspace, input, 'Учебная проверка');
  const state = () => view().state;
  async function approve() {
    await post('check');
    await post('test-order');
    await post('moderate', { limitRub: '8540' });
    await post('refresh');
    await post('refresh');
    assert.equal(state().phase, 'ready');
  }
  async function start() {
    await post('start');
    await post('refresh');
    await post('refresh');
    assert.equal(state().phase, 'running');
  }
  async function stop() {
    await post('stop');
    await post('refresh');
    await post('refresh');
    assert.equal(state().phase, 'stopped');
  }
  return { get x() { return x; }, service, view, form, post, state, approve, start, stop,
    async restart() { x.db.close(); x = await pilotBrowser(directory); } };
}

test('Rollstar: полный учебный путь, точный НДС, CPA и клиенты, задержка списания и закрытие резерва', async t => {
  const a = await setup(t);
  assert.equal(a.state().phase, 'draft');
  await assert.rejects(a.post('moderate', { limitRub: '8540' }), /тестовый заказ/);
  await a.post('check');
  assert.equal(a.state().proof?.grossKop, 854000);
  await a.post('test-order');
  await a.post('test-order');
  assert.equal(a.x.fixture.state.testOrders, 1);
  await assert.rejects(a.post('moderate', { limitRub: '8539,99' }), /лимит меньше/);
  assert.equal(a.x.fixture.state.writes.length, 0);
  const submitted = a.form('moderate', { limitRub: '8540' });
  const simultaneous = await Promise.allSettled([a.post('moderate', {}, submitted), a.post('moderate', {}, submitted)]);
  assert.equal(simultaneous.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(a.x.fixture.state.writes.length, 1);
  assert.equal(a.state().budget?.reservedKop, 854000);
  await a.post('refresh');
  assert.equal(a.state().phase, 'reviewing');
  await a.post('refresh');
  assert.equal(a.state().phase, 'ready');
  await a.post('reports');
  assert.deepEqual(a.state().report, { status: 'waiting' });
  await a.start();
  assert.equal(campaignCatalogItems(a.x.db, a.x.owner)[0].state, 'live');
  await a.post('reports');
  const latest = a.state().report?.latest!;
  assert.deepEqual({ ...latest, at: '' }, { at: '', spendKop: 244000, impressions: 5000, clicks: 100, orders: 4,
    customers: { name: 'Заказы Rollstar · имитация', confirmed: 3, first: 2 } });
  a.x.fixture.faults.report = 'stale';
  await a.post('reports');
  assert.deepEqual(a.state().report, { status: 'stale', latest });
  assert.equal(a.state().budget?.reservedKop, 854000);
  await a.stop();
  assert.equal(campaignCatalogItems(a.x.db, a.x.owner)[0].state, 'paused');
  assert.equal(a.state().budget?.reservedKop, 854000);
  a.x.fixture.faults.report = 'settled';
  await a.post('reports');
  assert.deepEqual(a.state().budget, { limitKop: 854000, reservedKop: 0, settled: true, finalSpendKop: 256200, observedSpendKop: 256200 });
  await assert.rejects(a.post('start'), /Включение недоступно/);
  assert.equal(a.x.fixture.state.writes.length, 3);
});

test('Rollstar: неизвестный старт переживает перезапуск, устаревшая вкладка и другой владелец заблокированы', async t => {
  const a = await setup(t);
  await a.approve();
  a.x.fixture.faults.unknown = 'start';
  const submitted = a.form('start');
  await assert.rejects(a.post('start', {}, submitted), /Исход команды неизвестен/);
  const operation = a.state().pending?.id;
  assert.ok(operation);
  assert.equal(a.state().budget?.reservedKop, 854000);
  await a.restart();
  assert.equal(a.state().pending?.id, operation);
  await assert.rejects(a.post('start', {}, submitted), /Экран устарел/);
  await assert.rejects(a.post('start'), /сверьте исход/);
  assert.equal(a.service().view('yandex:202', a.x.workspace), undefined);
  await assert.rejects(a.service().action('yandex:202', a.x.workspace, a.form('refresh'), 'Другой владелец'), /не найден/);
  await a.post('refresh');
  assert.equal(a.state().phase, 'starting');
  await a.post('refresh');
  assert.equal(a.state().phase, 'running');
  assert.equal(a.x.fixture.state.writes.filter(item => item.command === 'start').length, 1);
  assert.equal(a.state().budget?.reservedKop, 854000);
});

test('Rollstar: остановка после неизвестного старта сначала сверяет исходную квитанцию', async t => {
  const a = await setup(t);
  await a.approve();
  a.x.fixture.faults.unknown = 'start';
  await assert.rejects(a.post('start'), /Исход команды неизвестен/);
  const startReceipt = a.state().pending?.id;
  a.x.fixture.faults.ambiguousReceipt = true;
  await assert.rejects(a.post('stop'), /пока не подтверждено/);
  assert.equal(a.state().pending?.id, startReceipt);
  assert.equal(a.state().budget?.reservedKop, 854000);
  assert.deepEqual(a.x.fixture.state.writes.map(item => item.command), ['moderate', 'start']);
  a.x.fixture.faults.ambiguousReceipt = false;
  await a.post('stop');
  assert.notEqual(a.state().pending?.id, startReceipt);
  await a.post('refresh');
  await a.post('refresh');
  assert.equal(a.state().phase, 'stopped');
  assert.equal(a.state().budget?.reservedKop, 854000);
  assert.deepEqual(a.x.fixture.state.writes.map(item => item.command), ['moderate', 'start', 'stop']);
});

test('Rollstar: при повторном открытии восстанавливается имитация исходного черновика и просроченное подключение', async t => {
  const a = await setup(t);
  const old = a.x.manager.resolve(a.x.owner)!;
  const saved = a.x.db.readDirectConnection(a.x.owner)!;
  a.x.db.setDirectConnection({ ...saved, value: { ...saved.value, expiresAt: Date.now() - 1 } }, saved.generation);
  await a.restart();
  const connected = a.x.manager.resolve(a.x.owner)!;
  assert.ok(connected.generation! > old.generation!);
  const run = a.x.db.readCampaignDirectRuns(a.x.owner, a.x.workspace).at(-1)!;
  await a.x.service().action(a.x.owner, 'guided-refresh', new URLSearchParams({
    campaignId: a.x.workspace, planId: run.planId, account: connected.account, generation: String(connected.generation),
  }), 'Учебная проверка');
  await a.post('check');
  assert.equal(a.state().proof?.grossKop, 854000);
});

test('Rollstar: неподтверждённые цели и маркировка, известная неотправка и отклонённая модерация', async t => {
  const a = await setup(t);
  a.x.fixture.faults.advertiser = false;
  await a.post('check');
  assert.match(a.state().issue!, /маркировка/);
  assert.equal(a.state().proof, undefined);
  a.x.fixture.faults.advertiser = true;
  a.x.fixture.faults.goal = false;
  await a.post('check');
  assert.match(a.state().issue!, /цель Метрики/);
  a.x.fixture.faults.goal = true;
  a.x.fixture.faults.budget = false;
  await a.post('check');
  assert.match(a.state().issue!, /бюджета/);
  a.x.fixture.faults.budget = true;
  await a.post('check');
  a.x.fixture.faults.testOrder = false;
  await assert.rejects(a.post('test-order'), /не подтвердила один/);
  assert.equal(a.state().test, undefined);
  a.x.fixture.faults.testOrder = true;
  await a.post('test-order');
  a.x.fixture.faults.notSent = 'moderate';
  await assert.rejects(a.post('moderate', { limitRub: '8540' }), /неизвестен/);
  assert.equal(a.state().budget?.reservedKop, 854000);
  await a.post('refresh');
  assert.equal(a.state().phase, 'draft');
  assert.equal(a.state().budget, undefined);
  a.x.fixture.faults.moderation = 'reject';
  await a.post('moderate', { limitRub: '8540' });
  await a.post('refresh');
  await a.post('refresh');
  assert.equal(a.state().phase, 'rejected');
  assert.match(a.state().moderationReason!, /условия доставки/);
  await assert.rejects(a.post('start'), /Включение недоступно/);
  a.x.fixture.faults.report = 'settled';
  await a.post('reports');
  assert.equal(a.state().budget?.settled, true);
  assert.equal(a.state().report?.latest?.spendKop, 0);
  assert.equal(a.state().report?.latest?.orders, 0);
});

test('Rollstar: при переподключении сохраняется безопасная остановка и итоговый расход', async t => {
  const a = await setup(t);
  await a.approve();
  await a.start();
  await a.post('reports');
  const old = a.form('stop');
  a.x.disconnect();
  await a.x.connect();
  assert.notEqual(a.view().generation, Number(old.get('generation')));
  await assert.rejects(a.post('stop', {}, old), /Экран устарел/);
  await a.stop();
  a.x.fixture.faults.report = 'settled';
  a.x.fixture.faults.goal = false;
  await a.post('reports');
  assert.equal(a.state().report?.status, 'stale');
  assert.equal(a.state().report?.latest?.spendKop, 244000);
  assert.equal(a.state().budget?.settled, true);
  assert.equal(a.state().budget?.finalSpendKop, 256200);
  assert.equal(a.state().budget?.reservedKop, 0);
});

test('Rollstar: перерасход Директа блокирует повторный запуск при несопоставимой Метрике', async t => {
  const a = await setup(t);
  await a.approve();
  await a.start();
  await a.post('reports');
  await a.stop();
  a.x.fixture.faults.report = 'ready';
  a.x.fixture.faults.spendKop = 860000;
  a.x.fixture.faults.attribution = false;
  await assert.rejects(a.post('reports'), /Отчёт Метрики/);
  assert.equal(a.state().report?.latest?.spendKop, 244000);
  assert.equal(a.state().budget?.observedSpendKop, 860000);
  assert.equal(a.state().budget?.reservedKop, 854000);
  await a.post('refresh');
  await assert.rejects(a.post('start'), /Включение недоступно/);
  a.x.fixture.faults.attribution = true;
  a.x.fixture.faults.spendKop = 256200;
  await a.post('reports');
  await assert.rejects(a.post('start'), /Включение недоступно/);
});
