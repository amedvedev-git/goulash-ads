import { removeE3Schema } from './fixtures/e3-control.ts';
import { confirmedPlan } from './fixtures/confirmed-plan.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createWordstat, buildPhrasePlan, readNegativePhrases, readPhrases, selectionVersion, refilterPhrasePlan } from '../src/search-phrases.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { openDatabase } from '../src/database.ts';
import { createDirectService } from '../src/direct.ts';
import { createApp } from '../src/server.ts';
import { fakeDirect } from './fixtures/direct-api.ts';
import { once } from 'node:events';

const draft = { ...exampleCampaign, title: 'Ремонт холодильников', adText: 'Подробности на сайте.', description: 'Мастерская ремонтирует холодильники.' };
const rows = [
  { phrase: 'ремонт холодильников', count: '1000' }, { phrase: 'ремонт холодильников цена', count: '150' },
  { phrase: 'холодильников ремонт цена', count: '150' }, { phrase: 'ремонт холодильников своими руками', count: '3000' },
  { phrase: 'ремонт холодильников вакансии', count: '2000' }, { phrase: 'купить холодильник', count: '9000' },
  { phrase: 'ремонт холодильников недорого', count: '0' },
];
test('регрессия живого Wordstat: чужой город/бренд/неподтверждённый товар не выбираются по общему слову суши', async () => {
  const business = { ...draft, title: 'Доставка суши и роллов', description: 'Вымышленное кафе «Рис и ролл» доставляет суши и роллы.' };
  const source = [
    { phrase: 'доставка суши и роллов', count: '121' },
    { phrase: 'заказать суши и роллы с доставкой', count: '49' },
    { phrase: 'заказать суши и роллы с доставкой екатеринбург', count: '42' },
    { phrase: 'суши ебидоеби доставка и роллов', count: '9' },
    { phrase: 'купить суши и роллы с доставкой', count: '3' },
    { phrase: 'yasuka доставка суши роллы и пицца калуга', count: '1' },
    { phrase: 'заказать сет суши и роллы с доставкой', count: '1' },
  ];
  const plan = await buildPhrasePlan(business, 1, 'доставка суши и роллов', '54', async () => structuredClone(source));
  assert.deepEqual(plan.candidates.filter(c => c.selected).map(c => c.phrase), [
    'доставка суши и роллов', 'заказать суши и роллы с доставкой', 'заказать суши и роллы с доставкой екатеринбург',
    'купить суши и роллы с доставкой', 'доставка суши и роллов екатеринбург',
  ]);
  assert.equal(plan.candidates.find(c => c.phrase.includes('ебидоеби'))?.count, '9');
});
test('фразы: релевантность важнее частоты, дубли и информационные запросы не выбираются, нет вымышленных метрик', async () => {
  const plan = await buildPhrasePlan(draft, 1, 'ремонт холодильников', '54', async () => structuredClone(rows));
  assert.deepEqual(plan.candidates.filter(c => c.selected).map(c => c.phrase), ['ремонт холодильников', 'ремонт холодильников цена', 'ремонт холодильников екатеринбург']);
  assert.equal(plan.candidates.find(c => c.phrase.endsWith('екатеринбург'))?.count, null);
  assert.equal(plan.candidates.filter(c => c.phrase.includes('цена')).length, 1);
  assert.match(plan.notice, /07.10.2026/);
  assert.equal(plan.candidates.find(c => c.phrase.includes('недорого'))?.selected, false);
  const course = await buildPhrasePlan({ ...draft, title: 'курсы маникюра' }, 1, 'курсы маникюра', '54', async () => [{ phrase: 'курсы маникюра', count: '100' }, { phrase: 'курсы маникюра вакансии', count: '90' }]);
  assert.equal(course.candidates[0].selected, true);
  assert.equal(course.candidates.find(c => c.phrase.endsWith('вакансии'))?.selected, false);
  const food = await buildPhrasePlan({ ...draft, description: 'Кафе доставляет суши и роллы.' }, 1, 'доставка суши и роллов', '54', async () => [
    { phrase: 'доставка суши', count: '100' }, { phrase: 'доставка роллов', count: '50' }, { phrase: 'доставка пиццы', count: '1000' },
  ]);
  assert.equal(food.candidates.find(c => c.phrase === 'доставка суши')?.selected, true);
  assert.equal(food.candidates.find(c => c.phrase === 'доставка роллов')?.selected, true);
  assert.equal(food.candidates.find(c => c.phrase === 'доставка пиццы')?.selected, false);
});
test('фразы: без Wordstat и при его ошибке нет поддельного спроса; нет добавления услуг и соседних интересов', async () => {
  for (const wordstat of [undefined, async () => { throw new Error('secret'); }]) {
    const plan = await buildPhrasePlan(draft, 1, 'ремонт холодильников', '54', wordstat);
    assert.equal(plan.source, 'business'); assert.ok(plan.candidates.every(c => c.count === null));
    assert.doesNotMatch(JSON.stringify(plan), /secret|бесплатный|круглосуточно/);
  }
  assert.throws(() => readPhrases(['---autotargeting']));
  assert.throws(() => readPhrases(['цена ремонта', 'ремонта цена']));
  assert.throws(() => readPhrases(['раз два три четыре пять шесть семь восемь']));
});
test('минус-фразы допускают больше 100 символов и проверяют ограничения группы Директа', () => {
  const longPhrases = Array.from({ length: 17 }, (_, index) =>
    [('а' + String(index)).padEnd(35, 'а'), ...Array(6).fill('б'.repeat(35))].join(' '));
  const fullGroup = [...longPhrases.slice(0, 16), [...Array(5).fill('в'.repeat(35)), 'г'].join(' ')];
  assert.deepEqual(readNegativePhrases(fullGroup), fullGroup);
  assert.throws(() => readNegativePhrases(longPhrases), /4096 символов/);
  assert.throws(() => readNegativePhrases(['раз два три четыре пять шесть семь восемь']), /7 слов/);
  assert.throws(() => readNegativePhrases(['а'.repeat(36)]), /35 символов/);
  assert.throws(() => readPhrases([longPhrases[0]]), /100 символов/);
});
test('география берётся из справочника, бренды не узнаются по списку известных конкурентов', async () => {
  const regions = [
    { GeoRegionId: '54', GeoRegionName: 'Екатеринбург' }, { GeoRegionId: '6', GeoRegionName: 'Калуга', GeoRegionType: 'City' },
    { GeoRegionId: '213', GeoRegionName: 'Москва', GeoRegionType: 'City' }, { GeoRegionId: '100', GeoRegionName: 'Район доставки', ParentId: '54' },
  ];
  const plan = await buildPhrasePlan(draft, 1, 'ремонт холодильников', '54', async () => [
    { phrase: 'ремонт холодильников в калуге', count: '10' }, { phrase: 'ремонт холодильников москва', count: '11' },
    { phrase: 'ремонт холодильников supernewbrand', count: '12' }, { phrase: 'ремонт холодильников новаямарка', count: '13' },
    { phrase: 'ремонт холодильников екатеринбург', count: '8' },
  ], regions);
  assert.match(plan.candidates.find(c => c.phrase.includes('калуге'))!.reason, /Другая география: Калуга/);
  assert.match(plan.candidates.find(c => c.phrase.includes('москва'))!.reason, /Другая география: Москва/);
  assert.ok(plan.candidates.filter(c => /supernewbrand|новаямарка/.test(c.phrase)).every(c => !c.selected));
  assert.equal(plan.candidates.find(c => c.phrase.endsWith('екатеринбург'))!.selected, true);
  const reviewed = refilterPhrasePlan(draft, { ...plan, selectionVersion: undefined }, regions);
  assert.equal(reviewed.at, plan.at); assert.equal(reviewed.source, plan.source); assert.equal(reviewed.selectionVersion, selectionVersion);
  assert.deepEqual(reviewed.candidates.map(c => [c.phrase, c.count]), plan.candidates.map(c => [c.phrase, c.count]));
});
test('Wordstat: прямой API, регион, лимит, отсутствие повторов и проверка формы ответа', async () => {
  let calls = 0;
  const api = createWordstat('private-key', 'folder', async (url, init) => {
    calls++; assert.equal(String(url), 'https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests');
    assert.deepEqual(JSON.parse(String(init!.body)), { phrase: 'ремонт холодильников', regions: ['54'], devices: ['DEVICE_ALL'], numPhrases: 100, folderId: 'folder' });
    return Response.json({ results: rows, associations: [{ phrase: 'неподдержанная услуга', count: '999' }] });
  });
  assert.equal((await api('ремонт холодильников', '54')).length, rows.length); assert.equal(calls, 1);
  for (const value of [{ results: null }, { results: [{ phrase: 'ремонт', count: 123 }] }, { results: [{ phrase: 'ремонт', count: '-1' }] }]) {
    await assert.rejects(createWordstat('private-key', 'folder', async () => Response.json(value))('ремонт холодильников', '54'), /неполный/);
  }
  const failed = createWordstat('private-key', 'folder', async () => { calls++; return new Response('hidden-key', { status: 429 }); });
  await assert.rejects(failed('ремонт холодильников', '54'), /HTTP 429/); assert.equal(calls, 2);
});
function setup(t: test.TestContext, cloud = false) {
  const dir = mkdtempSync(join(tmpdir(), 'phrases-')); let db = openDatabase(dir); const fake = fakeDirect(); let calls = 0;
  const config = { api: fake.api, owner: 'local', account: '31001001', mode: 'fixture' as const };
  const wordstat = cloud ? async () => { calls++; return structuredClone(rows); } : undefined;
  let service = createDirectService(db, config, wordstat);
  db.saveCampaign('local', draft, 0, 'Тест');
  const action = (name: string, data: Record<string, string> = {}, owner = 'local') => service.action(owner, name, new URLSearchParams({ revision: '1', campaignPlanId: db.readPreparation(owner)?.value.confirmedPlanId ?? '', planId: db.readDirect(owner)?.planId ?? '', confirm: 'yes', ...data }), 'Тест');
  const prepare = async () => {
    const campaignPlanId = confirmedPlan(db, draft, ['ремонт холодильников', 'вызвать мастера по холодильникам'], 'local', ['вакансии']);
    await service.action('local', 'prepare', new URLSearchParams({ revision: '1', campaignPlanId, name: 'Фразы', weekly: '300' }), 'Тест');
  };
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  return { fake, action, prepare, service: () => service, db: () => db, dir, calls: () => calls,
    restart() { db.close(); db = openDatabase(dir); service = createDirectService(db, config, wordstat); } };
}
test('прежние платные входы закрыты, новый snapshot не допускает подмену фраз', async t => {
  const x = setup(t, true);
  for (const action of ['suggest', 'strategy', 'strategy-confirm', 'research']) await assert.rejects(x.action(action, { paid: 'yes' }), /прежний путь/);
  assert.equal(x.calls(), 0); await x.prepare();
  await assert.rejects(x.action('prepare', { name: 'Подмена', weekly: '300', selected: 'чужая фраза' }), /отличаются/);
  assert.equal(x.fake.writes().length, 0);
});
test('старые правила готового набора блокируют запись без нового платного запроса', async t => {
  const x = setup(t, true); await x.prepare();
  const state = x.db().readDirect('local')!; state.phrasePlan!.selectionVersion = 2; x.db().saveDirect('local', state);
  await assert.rejects(x.action('create'), /Правила отбора обновлены/); assert.equal(x.fake.writes().length, 0); assert.equal(x.calls(), 0);
});
for (const mode of ['after', 'before'] as const) test(`список фраз: обрыв ${mode} второй фразы, рестарт, сохранность ID и отсутствие дублей`, async t => {
  const x = setup(t, true); await x.prepare();
  x.fake.fault('keywords/add', mode, 3); await assert.rejects(x.action('create'));
  assert.equal(x.db().readDirect('local')!.keywordEntries![0].phase, 'confirmed');
  assert.equal(x.db().readDirect('local')!.keywordEntries![1].phase, 'pending');
  const writes = x.fake.writes().length;
  x.restart();
  if (mode === 'before') {
    await assert.rejects(x.action('refresh'), /неизвестен/); await assert.rejects(x.action('create'), /неизвестен/);
    assert.equal(x.fake.writes().length, writes);
  } else {
    await x.action('refresh'); assert.equal(x.fake.writes().length, writes);
    await x.action('create'); const state = x.db().readDirect('local')!;
    assert.equal(state.complete, true); assert.equal(x.fake.records.keywords.length, state.keywordEntries!.length + 1);
    assert.deepEqual(x.fake.records.adgroups[0].NegativeKeywords.Items, ['вакансии']);
    const doneWrites = x.fake.writes().length; await x.action('create'); assert.equal(x.fake.writes().length, doneWrites);
    const before = state.name; await x.action('rename', { before, name: 'Название со списком фраз' });
    const event = x.db().readDirect('local')!.events.at(-1)!; await x.action('undo', { id: event.id });
    assert.equal(x.fake.records.campaigns[0].Name, before);
    x.fake.records.adgroups[0].NegativeKeywords.Items = ['снаружи']; await assert.rejects(x.action('refresh'), /снаружи/);
  }
});
test('SQLite v6 → v9 сохраняет прежнюю кампанию, её журнал, сессию и историю; подбор переживает рестарт', async t => {
  const x = setup(t); await x.prepare(); await x.action('create');
  const old = x.db().readDirect('local'); x.db().createSession('session', 'local', 'Имя', Date.now() + 60000);
  const raw = new DatabaseSync(join(x.dir, 'stage2.sqlite')); removeE3Schema(raw); raw.exec('DROP TABLE campaign_preparations; DROP TABLE campaign_plans; DROP TABLE campaign_strategy_runs; DROP TABLE phrase_plans; CREATE TABLE direct_bindings(owner TEXT PRIMARY KEY,account TEXT UNIQUE,payload TEXT NOT NULL) STRICT; INSERT INTO direct_bindings SELECT owner,account,payload FROM direct_runs; DROP TABLE direct_runs; DROP TABLE direct_accounts; DROP TABLE direct_connections; DROP TABLE direct_connect_attempts; DROP TABLE direct_dispatches; PRAGMA user_version=6;'); raw.close();
  x.restart(); assert.deepEqual({...x.db().readDirect('local'),storageRevision:old!.storageRevision}, old); assert.equal(x.db().readSession('session')?.name, 'Имя');
  await x.action('refresh'); assert.equal(x.db().readDirect('local')?.complete, true);
});
test('HTTP: CSRF, закрытый suggest, подтверждённый список до Direct без подмены', async t => {
  const x = setup(t); const campaignPlanId = confirmedPlan(x.db(), draft, ['ремонт холодильников', 'вызвать мастера по холодильникам', 'ремонт холодильников цена'], 'local', ['вакансии']);
  const server = createApp(x.db(), undefined, undefined, undefined, { api: x.fake.api, owner: 'local', account: '31001001', mode: 'fixture' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { await new Promise<void>(r => server.close(() => r())); });
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string'); const origin = `http://127.0.0.1:${addr.port}`;
  const post = (action, values, site = origin) => fetch(origin + '/direct/' + action, { method: 'POST', headers: { Origin: site }, body: new URLSearchParams(values), redirect: 'manual' });
  assert.equal((await post('suggest', {}, 'https://other.test')).status, 403); assert.equal((await post('suggest', {})).status, 409);
  assert.equal((await post('prepare', { campaignPlanId, revision: '1', name: 'Все фразы', weekly: '300' })).status, 303);
  const state = x.db().readDirect('local')!; assert.equal(state.keywordEntries!.length, 3);
  assert.equal((await post('create', { planId: state.planId, confirm: 'yes' })).status, 303);
  assert.equal(x.fake.records.keywords.length, 4); assert.equal(x.db().readDirect('local')?.complete, true);
});
