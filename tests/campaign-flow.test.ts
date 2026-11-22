import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import { exampleCampaign } from '../src/campaign.ts';

async function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'goulash-campaign-flow-'));
  const db = openDatabase(dir), server = createApp(db);
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); rmSync(dir, { recursive: true, force: true }); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (action: string, values: Record<string, string>, source = origin) => fetch(origin + '/campaign/' + action, {
    method: 'POST', headers: { Origin: source }, body: new URLSearchParams(values), redirect: 'manual', signal: t.signal,
  });
  const get = (path = '/', init: RequestInit = {}) => fetch(origin + path, { ...init, signal: t.signal });
  return { db, post, get };
}
const input = { ...exampleCampaign, revision: '0' };
const wording = { title: 'Мой ручной заголовок', adText: 'Мой проверенный текст.' };

test('три шага, возврат и восстановление не пишут базу; только явное сохранение создаёт черновик', async t => {
  const { db, post, get } = await fixture(t);
  const overview = await (await get()).text();
  assert.match(overview, /<h1>Обзор<\/h1>/);
  assert.match(overview, /action="\/campaign\/new"[\s\S]*Создать кампанию/);
  assert.match(overview, /href="\/results#demo">Учебное перераспределение бюджета/);
  assert.doesNotMatch(overview, /<form id="campaign-form"/);
  const first = await (await get('/?example=1')).text();
  assert.match(first, /data-step="1"/); assert.doesNotMatch(first, /id="campaign-preview"/);
  assert.equal((first.match(/<form id="campaign-form"/g) ?? []).length, 1);
  const analyze = await post('analyze', input);
  assert.equal(analyze.status, 200); assert.match(await analyze.text(), /data-step="2"/);
  const candidate = { ...input, ...wording };
  const confirmed = await post('confirm', candidate);
  assert.equal(confirmed.status, 200); assert.match(await confirmed.text(), /data-step="3"/);
  const back = await (await post('back', { ...candidate, step: '1' })).text();
  assert.match(back, /name="title" value="Мой ручной заголовок"/);
  assert.match(await (await post('analyze', candidate)).text(), /value="Мой ручной заголовок"/);
  assert.match(await (await post('resume', { ...candidate, step: '3' })).text(), /Мой проверенный текст/);
  const exampleAgain = await (await post('example', { ...candidate, description: 'Другое описание' })).text();
  assert.match(exampleAgain, /name="title" value="Мой ручной заголовок"/);
  assert.equal(db.readCampaign('local'), undefined); assert.equal(db.readHistory('local').length, 0);
  const saved = await post('save', candidate);
  assert.equal(saved.status, 303); assert.equal(saved.headers.get('location'), '/campaigns?campaign=saved');
  assert.equal(db.readCampaign('local')?.draft.title, wording.title);
  assert.equal(db.readHistory('local').length, 1);
  const overviewAfterSave = await (await get()).text();
  assert.match(overviewAfterSave, /Черновик сохранён. Откройте его, чтобы продолжить работу/);
  assert.match(overviewAfterSave, /Вымышленное кафе|Рис и ролл/);
  const page = await (await get(saved.headers.get('location')!)).text();
  assert.match(page, /data-saved="1"/); assert.match(page, /Изменения черновика сохранены/);
  assert.doesNotMatch(page, /id="business-description"/);
  assert.equal((page.match(/name="budget"/g) ?? []).length, 1);
});

test('повторный разбор сохраняет ручной текст, конфликт сохраняет оба варианта и требует явного решения', async t => {
  const { db, post } = await fixture(t);
  await post('save', { ...input, ...wording });
  const base = db.readCampaign('local')!;
  const changed = { ...input, ...wording, region: 'Пермь', revision: '1' };
  const proposed = await (await post('analyze', changed)).text();
  assert.match(proposed, /value="Мой ручной заголовок"/); assert.match(proposed, /Сравнить с новым вариантом/);
  assert.equal((await post('preview', { ...input, revision: '1' })).status, 200);
  assert.deepEqual(db.readCampaign('local'), base); assert.equal(db.readHistory('local').length, 1);
  await post('save', { ...changed, title: 'Новая версия из вкладки А' });
  const outdated = { ...changed, title: 'Несохранённый текст вкладки Б', budget: '9200' };
  const conflict = await post('save', outdated);
  assert.equal(conflict.status, 409);
  const html = await conflict.text();
  assert.match(html, /Новая версия из вкладки А/); assert.match(html, /value="Несохранённый текст вкладки Б"/);
  assert.match(html, /value="9200"/); assert.match(html, /action="\/campaign\/resolve"/);
  assert.equal(db.readCampaign('local')?.draft.title, 'Новая версия из вкладки А');
  assert.match(html, /name="revision" value="1"/);
  assert.match(html, /name="currentRevision" value="2"/);
  // Back/resume carry the stale revision, so they cannot silently dismiss a conflict.
  const back = await (await post('back', { ...outdated, step: '2' })).text();
  assert.match(back, /name="revision" value="1"/);
  await post('confirm', outdated);
  assert.equal((await post('save', outdated)).status, 409);
  await post('resume', { ...outdated, step: '3' });
  assert.equal((await post('save', outdated)).status, 409);
  assert.equal((await post('resolve', { ...outdated, currentRevision: '2' })).status, 400);
  assert.equal(db.readHistory('local').length, 2);
  // Another edit after the conflict screen must still be protected by compare-and-swap.
  await post('save', { ...changed, revision: '2', title: 'Ещё более новая версия' });
  assert.equal((await post('resolve', { ...outdated, currentRevision: '2', resolution: 'replace' })).status, 409);
  assert.equal((await post('resolve', { ...outdated, currentRevision: '3', resolution: 'replace' })).status, 303);
  assert.equal(db.readCampaign('local')?.draft.title, outdated.title);
  assert.equal(db.readCampaign('local')?.draft.budget, '9200');
});

test('экраны разделены, ввод экранирован, ошибки сохраняют поля, локальные assets и Origin защищены', async t => {
  const { db, post, get } = await fixture(t);
  const bad = await post('confirm', { ...input, ...wording, adText: '', title: '<script>alert(1)</script>' });
  assert.equal(bad.status, 400);
  const html = await bad.text();
  assert.match(html, /id="analysis-adText-error"/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal((await post('save', { ...input, ...wording }, 'https://example.test')).status, 403);
  assert.equal(db.readCampaign('local'), undefined);
  db.loadDemo('local', 'control', 0, 'Тест');
  const campaign = await (await get()).text(), analytics = await (await get('/analytics')).text();
  assert.doesNotMatch(campaign, /id="demo-statistics"|id="history-title"/);
  assert.match(analytics, /id="demo-statistics"/); assert.doesNotMatch(analytics, /id="campaign-form"|action="\/demo\/run/);
  // "Учебная автоматика" is no longer a section: GET is a permanent redirect to the learning card.
  const automation = await get('/automation', { redirect: 'manual' });
  assert.equal(automation.status, 308); assert.equal(automation.headers.get('location'), '/results#demo');
  assert.match(await (await get('/automation')).text(), /action="\/demo\/permission"/);
  assert.match(await (await get('/history')).text(), /Загрузка учебного примера/);
  const response = await get();
  assert.match(response.headers.get('content-security-policy')!, /script-src 'self'/);
  const font = await get('/assets/Onest.ttf'); assert.equal(font.status, 200);
  assert.equal((await font.arrayBuffer()).byteLength, 193056);
  const pixelFont = await get('/assets/PixelifySans.ttf');
  assert.equal(pixelFont.status, 200);
  assert.equal(pixelFont.headers.get('content-type'), 'font/ttf');
  assert.ok((await pixelFont.arrayBuffer()).byteLength > 0);
  const js = await get('/assets/ui-client.js'); assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type')!, /javascript/);
  assert.equal((await get('/assets/OFL.txt')).status, 404);
  assert.equal((await get('/assets/../database.ts')).status, 404);
});
