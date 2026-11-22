import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';

async function cabinet(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-ui-shell-'));
  const db = openDatabase(directory), server = createApp(db);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const get = (path: string, init: RequestInit = {}) => fetch(origin + path, { ...init, signal: t.signal });
  const post = (path: string, data: Record<string, string>) => fetch(origin + path, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data), redirect: 'manual', signal: t.signal,
  });
  return { db, origin, get, post };
}

test('каркас: четыре раздела, меню аккаунта и честный футер', async (t) => {
  const { get } = await cabinet(t);
  const html = await (await get('/')).text();
  const nav = html.match(/<nav class="nav" aria-label="Разделы">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, 'основная навигация отрисована');
  assert.equal((nav.match(/<a /g) ?? []).length, 4, 'в шапке ровно четыре раздела');
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((match) => match[1]), ['Обзор', 'Кампании', 'Результаты', 'История']);
  assert.match(nav, /href="\/" aria-current="page">Обзор/);
  assert.doesNotMatch(nav, /\/automation|\/connections\/direct/, 'подключение и автоматика не разделы меню');

  const account = html.match(/<details class="account">[\s\S]*?<\/details>/)?.[0];
  assert.ok(account, 'меню аккаунта отрисовано');
  assert.match(account, /href="\/connections\/direct">Подключения/);
  assert.match(account, /href="\/results#demo">Учебное перераспределение бюджета/);
  assert.match(account, /href="\/diagnostics">/);
  assert.doesNotMatch(html, /Подготовка черновиков без показов/, 'футер не обещает показы');
  assert.match(html, /Подготовка черновика в Яндекс Директе · показы не включаются/);

  const automation = await get('/automation', { redirect: 'manual' });
  assert.equal(automation.status, 308, 'учебная автоматика больше не раздел');
  assert.equal(automation.headers.get('location'), '/results#demo');
  assert.doesNotMatch(await (await get('/automation')).text(), /aria-current="page"[^>]*>Автоматика/, 'скрытый маршрут не подсвечивается в шапке');
});

test('старые URL отвечают 308 и сохраняют параметры; служебные POST не переименованы', async (t) => {
  const { origin, get, post } = await cabinet(t);
  const legacy = await get('/campaign?ad=default&example=1', { redirect: 'manual' });
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get('location'), '/campaigns?ad=default&example=1');

  const analytics = await get('/analytics?run=abc&dateFrom=2026-11-01', { redirect: 'manual' });
  assert.equal(analytics.status, 308);
  assert.equal(analytics.headers.get('location'), '/results?run=abc&dateFrom=2026-11-01');

  assert.equal((await get('/campaigns')).status, 200, 'список кампаний');
  assert.equal((await get('/campaigns?ad=default')).status, 200, 'кампания по ?ad=');
  assert.equal((await get('/results')).status, 200, 'результаты');
  assert.equal((await get('/connections/direct')).status, 200, 'подключение не сломано');
  const automation = await get('/automation', { redirect: 'manual' });
  assert.equal(automation.status, 308, 'учебная автоматика ведёт на «Результаты»');
  assert.equal(automation.headers.get('location'), '/results#demo');
  const legacyRepeat = await get('/automation?run=repeat', { redirect: 'manual' });
  assert.equal(legacyRepeat.status, 308, 'старый адрес с параметром тоже живой');
  assert.equal(legacyRepeat.headers.get('location'), '/results?demo=repeat#demo');

  const created = await fetch(origin + '/campaign/new', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual', signal: t.signal });
  assert.equal(created.status, 303);
  assert.match(created.headers.get('location')!, /^\/campaigns\?ad=/);
  assert.equal((await get(created.headers.get('location')!)).status, 200);

  const saved = await post('/test-record', { content: 'Проверка старого адреса' });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), '/diagnostics?saved=1');
  assert.equal((await post('/operations/undo', { id: 'nope' })).status, 400, 'POST отмены не редиректится');
});
