import { removeE3Schema } from './fixtures/e3-control.ts';
import { confirmedPlan } from './fixtures/confirmed-plan.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.ts';
import { createDirectService } from '../src/direct.ts';
import { directId, parseDirectJson, createDirectApi } from '../src/direct-api.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { fakeDirect } from './fixtures/direct-api.ts';

export const draft = { ...exampleCampaign, title: 'Мой ручной заголовок', adText: 'Мой сохранённый текст.', url: 'https://rollstar.ru/' };

test('Директ даёт больше времени геосправочнику и отличает обрыв чтения от неверного JSON', async t => {
  const timeouts: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  const api = createDirectApi(async () => 'fixture', async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('body interrupted')); },
  }), { headers: { RequestId: 'fixture-body' } }));
  await assert.rejects(api.list('dictionaries', { DictionaryNames: ['GeoRegions'] }, 'GeoRegions'), {
    message: 'dictionaries.get: Ответ Директа прервался при чтении. Повторите чтение.',
    outcome: 'unknown', requestId: 'fixture-body',
  });
  await assert.rejects(api.write('campaigns', 'add', {}), {
    message: 'campaigns.add: Ответ Директа прервался при чтении. Сначала сверить результат.',
    outcome: 'unknown', requestId: 'fixture-body',
  });
  assert.deepEqual(timeouts, [60000, 25000]);
});

function setup(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'goulash-direct-'));
  let db = openDatabase(dir);
  const fake = fakeDirect();
  const config = { api: fake.api, owner: 'local', account: '31001001', mode: 'fixture' as const };
  let service = createDirectService(db, config);
  db.saveCampaign('local', draft, 0, 'Тест');
  confirmedPlan(db, draft, ['роллы доставка']);
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const action = (name: string, fields: Record<string, string> = {}, owner = 'local') => service.action(owner, name, new URLSearchParams({ planId: db.readDirect('local')?.planId ?? '', campaignPlanId: db.readPreparation('local')?.value.confirmedPlanId ?? '', confirm: 'yes', ...fields }), 'Тест');
  return { fake, action, state: () => db.readDirect('local')!, db: () => db,
    restart() { db.close(); db = openDatabase(dir); service = createDirectService(db, config); },
    prepare: () => action('prepare', { revision: '1', name: 'Приёмка', weekly: '500', keyword: 'роллы доставка' }), dir, config };
}

test('Direct: точные Int64, JSON строки с цифрами, ошибки HTTP 200 и пустой ads.get', async () => {
  assert.equal(parseDirectJson('{"Id":9000123400000000123,"text":"9000123400000000123"}').Id, '9000123400000000123');
  assert.equal(directId('9223372036854775807'), '9223372036854775807');
  for (const id of ['9223372036854775808', '-1', '0', '1e3', 9000123400000000123]) assert.throws(() => directId(id));
  const api = createDirectApi(async () => 'secret', async () => Response.json({ error: { error_code: 1000, error_detail: 'hidden-token' } }));
  await assert.rejects(api.call('campaigns', 'add', {}), /код API 1000/);
  await assert.rejects(api.call('ads', 'moderate', {}), /запрещён/);
  const broken = createDirectApi(async () => 'secret', async () => Response.json({ result: { Ads: null } }));
  await assert.rejects(broken.list('ads', {}, 'Ads'), /Неполная/);
});

test('Direct: полный путь, ручные поля, чтение, повтор, рестарт, переименование и отмена', async t => {
  const x = setup(t); await x.prepare(); await x.action('create');
  assert.equal(x.state().complete, true);
  assert.equal(x.state().steps.ad.id, '9000123400000000123');
  assert.equal(x.fake.records.ads[0].ResponsiveAd.Titles[0].Title, draft.title);
  assert.equal(x.fake.records.ads[0].ResponsiveAd.Texts[0].Text, draft.adText);
  assert.equal(x.fake.records.ads[0].ResponsiveAd.Href, draft.url);
  assert.equal(x.fake.records.campaigns[0].UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks.WeeklySpendLimit, '500000000');
  assert.deepEqual(x.fake.records.adgroups[0].RegionIds, ['54']);
  const writes = x.fake.writes().length;
  x.restart(); await x.action('create'); await x.action('refresh'); assert.equal(x.fake.writes().length, writes);
  const before = x.state().name;
  x.fake.fault('campaigns/update', 'stale');
  await x.action('rename', { before, name: 'Новое имя' });
  await x.action('rename', { before, name: 'Новое имя' });
  assert.equal(x.state().events.filter(e => e.kind === 'rename').length, 1);
  const event = x.state().events.at(-1)!;
  assert.equal(event.phase, 'confirmed');
  await x.action('undo', { id: event.id }); await x.action('undo', { id: event.id });
  assert.equal(x.fake.records.campaigns[0].Name, before);
  assert.equal(x.state().events.filter(e => e.kind === 'undo').length, 1);
  assert.equal(x.state().events.at(-1)?.related, event.id);
});

for (const at of ['campaigns/add', 'adgroups/add', 'keywords/add', 'ads/add']) {
  test(`Direct: обрыв после ${at}, рестарт и восстановление без дубликата`, async t => {
    const x = setup(t); await x.prepare(); x.fake.fault(at, 'after');
    await assert.rejects(x.action('create'));
    const writes = x.fake.writes().length;
    x.restart(); await x.action('refresh'); assert.equal(x.fake.writes().length, writes);
    await x.action('create'); assert.equal(x.state().complete, true);
    assert.equal(x.fake.records.campaigns.length, 1); assert.equal(x.fake.records.adgroups.length, 1); assert.equal(x.fake.records.ads.length, 1); assert.equal(x.fake.records.keywords.length, 2);
  });
  test(`Direct: обрыв до ${at} не повторяет неизвестную запись`, async t => {
    const x = setup(t); await x.prepare(); x.fake.fault(at, 'before'); await assert.rejects(x.action('create'));
    const writes = x.fake.writes().length;
    x.restart(); await assert.rejects(x.action('create'), /неизвестен/); await assert.rejects(x.action('refresh'), /неизвестен/);
    assert.equal(x.fake.writes().length, writes);
  });
}

test('Direct: реальная регрессия 1000 после группы без автотаргетинга', async t => {
  const x = setup(t); await x.prepare(); x.fake.fault('adgroups/add', 'api1000');
  await assert.rejects(x.action('create'), /1000/);
  assert.equal(x.fake.records.adgroups.length, 1); assert.equal(x.fake.records.keywords.length, 0);
  await x.action('refresh'); await x.action('create'); assert.equal(x.fake.records.adgroups.length, 1); assert.equal(x.state().complete, true);
});

for (const mode of ['before', 'after'] as const) test(`Direct: обрыв ${mode} добавления обычной фразы после автотаргетинга`, async t => {
  const x = setup(t); await x.prepare(); x.fake.fault('keywords/add', mode, 2); await assert.rejects(x.action('create'));
  assert.equal(x.state().steps.targeting.phase, 'confirmed'); assert.equal(x.state().steps.keyword.phase, 'pending');
  const writes = x.fake.writes().length; x.restart();
  if (mode === 'before') { await assert.rejects(x.action('create'), /неизвестен/); assert.equal(x.fake.writes().length, writes); }
  else { await x.action('create'); assert.equal(x.state().complete, true); assert.equal(x.fake.records.keywords.length, 2); }
});

test('Direct: автоматический автотаргетинг настраивается и не дублируется', async t => {
  const x = setup(t); x.fake.autoGroup(true); await x.prepare(); x.fake.fault('keywords/update', 'after');
  await assert.rejects(x.action('create')); x.restart(); await x.action('create');
  assert.equal(x.state().complete, true); assert.equal(x.fake.records.keywords.length, 2);
});

test('Direct: ошибка объекта сохраняет неизвестный результат и не раскрывает текст API', async t => {
  const x = setup(t); await x.prepare(); x.fake.fault('campaigns/add', 'item');
  await assert.rejects(x.action('create'), /999/);
  assert.doesNotMatch(JSON.stringify(x.state()), /secret-must/);
  assert.equal(x.state().steps.campaign.phase, 'pending');
});

test('Direct: неизвестное изменение, рестарт, сверка и конфликт внешней правки при отмене', async t => {
  const x = setup(t); await x.prepare(); await x.action('create'); x.fake.fault('campaigns/update', 'after');
  await assert.rejects(x.action('rename', { before: x.state().name, name: 'Новое имя' }));
  const writes = x.fake.writes().length;
  x.restart(); await x.action('refresh'); assert.equal(x.fake.writes().length, writes);
  const event = x.state().events.at(-1)!;
  x.fake.records.campaigns[0].Name = 'Внешняя правка';
  await assert.rejects(x.action('undo', { id: event.id }), /Конфликт/);
  assert.equal(x.fake.records.campaigns[0].Name, 'Внешняя правка'); assert.equal(x.fake.writes().length, writes);
  assert.equal(x.state().snapshot?.campaign.Name, 'Внешняя правка');
  assert.equal(x.state().events.at(-1)?.phase, 'conflict');
});

test('Direct: чужой владелец, кабинет, stale revision, пагинация, небезопасные статусы и двойной клик', async t => {
  const x = setup(t); await assert.rejects(x.action('prepare', {}, 'stranger'), /не подключён/);
  x.fake.wrongAccount(true); await assert.rejects(x.prepare(), /Кабинет/); x.fake.wrongAccount(false);
  await x.prepare(); x.db().saveCampaign('local', { ...draft, title: 'Правка 2' }, 1, 'Тест');
  await assert.rejects(x.action('create'), /изменился/); assert.equal(x.fake.writes().length, 0);
  confirmedPlan(x.db(), x.db().readCampaign('local')!.draft, ['роллы']);
  await x.action('prepare', { revision: '2', name: 'Актуальный', weekly: '300', keyword: 'роллы' });
  const a = x.action('create'); await assert.rejects(x.action('create'), /уже выполняется/); await a;
  const writes = x.fake.writes().length;
  x.fake.pagination(true); await assert.rejects(x.action('refresh'), /Неполная/); x.fake.pagination(false);
  x.fake.records.campaigns[0].State = 'ON'; await assert.rejects(x.action('rename', { before: x.state().name, name: 'Запрещено' }), /Конфликт/);
  assert.equal(x.fake.writes().length, writes);
});

test('Direct: миграция v5 сохраняет черновик, историю, сессии и восстанавливает lock погибшего процесса', async t => {
  const x = setup(t), raw = new DatabaseSync(join(x.dir, 'stage2.sqlite'));
  removeE3Schema(raw); raw.exec('DROP TABLE campaign_preparations; DROP TABLE campaign_plans; DROP TABLE campaign_strategy_runs; DROP TABLE direct_runs; DROP TABLE direct_connections; DROP TABLE direct_accounts; DROP TABLE direct_connect_attempts; DROP TABLE direct_dispatches; DROP TABLE direct_lock; DROP TABLE phrase_plans; PRAGMA user_version=5;'); raw.close();
  x.restart(); assert.equal(x.db().readCampaign('local')?.draft.title, draft.title); assert.ok(x.db().readHistory('local').length);
  const lock = new DatabaseSync(join(x.dir, 'stage2.sqlite'));
  lock.prepare('INSERT INTO direct_lock VALUES (?, ?)').run('31001001', 2147483647); lock.close();
  confirmedPlan(x.db(), draft, ['роллы доставка']);
  await x.prepare(); assert.ok(x.state());
});

test('Direct: неизвестная запись названия не повторяется даже после перезапуска', async t => {
  const x = setup(t); await x.prepare(); await x.action('create');
  x.fake.fault('campaigns/update', 'before');
  await assert.rejects(x.action('rename', { before: x.state().name, name: 'Новое имя' }));
  const writes = x.fake.writes().length; x.restart();
  await assert.rejects(x.action('rename', { before: x.state().name, name: 'Другое имя' }), /не подтверждено/);
  assert.equal(x.fake.writes().length, writes);
});

test('Direct: фраза после автотаргетинга восстанавливается отдельно, ручные настройки не перезаписываются', async t => {
  const x = setup(t); await x.prepare(); x.fake.fault('ads/add', 'before'); await assert.rejects(x.action('create'));
  assert.equal(x.state().steps.keyword.phase, 'confirmed');
  x.fake.records.keywords[0].AutotargetingSettings.Categories.Broader = 'YES';
  const writes = x.fake.writes().length;
  await assert.rejects(x.action('create'), /изменились снаружи/); assert.equal(x.fake.writes().length, writes);
});

test('Direct: истекшая дата, подменённые родительские связи и внешний текст блокируют запись', async t => {
  const x = setup(t); await x.prepare(); const state = x.state(); state.startDate = '2000-01-01'; x.db().saveDirect('local', state);
  await assert.rejects(x.action('create'), /Дата начала/); assert.equal(x.fake.writes().length, 0);
  await x.prepare(); await x.action('create'); const writes = x.fake.writes().length;
  x.fake.records.ads[0].AdGroupId = '123';
  await assert.rejects(x.action('rename', { before: x.state().name, name: 'Новое имя' }), /другой группе/);
  assert.equal(x.fake.writes().length, writes);
  x.fake.records.ads[0].AdGroupId = x.state().steps.group.id;
  x.fake.records.ads[0].ResponsiveAd.Titles[0].Title = 'Внешний заголовок';
  await assert.rejects(x.action('refresh'), /Конфликт текста/);
});
