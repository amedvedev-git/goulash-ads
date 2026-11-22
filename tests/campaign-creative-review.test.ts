import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { exampleCampaign } from '../src/campaign.ts';
import { renderCampaignCreativeReview, saveCampaignCreativeReview } from '../src/campaign-creative-review.ts';
import { openDatabase } from '../src/database.ts';
import type { DirectState } from '../src/direct.ts';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-creative-review-'));
  let db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = 'yandex:1', workspace = db.createCampaignWorkspace(owner).id;
  const runId = 'fixture-run', actor = 'Владелец', checkedAt = '2026-11-20T11:30:00.000Z';
  const campaign = '9223372036854775800', ad = '9223372036854775801';
  const draft = { ...exampleCampaign, title: 'Старый заголовок', adText: 'Старый текст' };
  const run: DirectState = {
    account: '10', planId: runId, campaignId: workspace, campaignPlanId: 'fixture-plan', draft, revision: 1,
    name: 'Проверка', groupName: 'Поиск', regionId: '22', regionName: 'Екатеринбург', weekly: '1000',
    keyword: 'роллы', startDate: '2026-11-20', complete: true, guidedDraft: true, events: [], checkedAt,
    steps: { campaign: { phase: 'confirmed', id: campaign }, ad: { phase: 'confirmed', id: ad },
      group: { phase: 'confirmed', id: '2' }, targeting: { phase: 'confirmed', id: '3' }, keyword: { phase: 'confirmed', id: '4' } },
    snapshot: { campaign: { Id: campaign }, ad: { Id: ad, CampaignId: campaign, Status: 'DRAFT', State: 'OFF',
      ResponsiveAd: { Titles: [{ Title: draft.title }], Texts: [{ Text: draft.adText }], Href: draft.url } },
      group: {}, targeting: {}, keyword: {} },
    launch: { history: [], observation: { campaignStatus: 'REJECTED', campaignState: 'OFF', adStatus: 'REJECTED', adState: 'OFF', checkedAt } },
  };
  db.saveDirect(owner, run);
  const read = () => db.readDirect(owner, runId)!;
  const form = (extra: Record<string, string> = {}) => new URLSearchParams({
    run: runId, revision: String(read().storageRevision), title: 'Суши и роллы', adText: 'Заказать доставку на сайте.', ...extra,
  });
  const save = (input = form(), as = owner, scope = workspace) => saveCampaignCreativeReview(db, as, scope, input, actor);
  return { owner, workspace, runId, actor, read, form, save, db: () => db, reopen: () => { db.close(); db = openDatabase(directory); } };
}

test('предложенная правка отклонённого объявления сохраняется отдельно от оригинала, статуса и попыток Директа', t => {
  const x = fixture(t);
  const original = x.read();
  const first = x.save(x.form({ title: ' <Новый заголовок> ', adText: 'Новый «текст»' }));
  assert.deepEqual(first.original, { title: original.draft.title, adText: original.draft.adText, url: original.draft.url });
  assert.equal(first.title, '<Новый заголовок>');
  assert.equal(first.actor, x.actor);
  x.reopen();
  const saved = x.read();
  assert.deepEqual(saved, { ...original, storageRevision: 2, creativeReview: first });
  assert.deepEqual(x.db().directDispatches(x.owner, x.runId), []);
  const html = renderCampaignCreativeReview(x.workspace, saved);
  assert.match(html, /Директ отклонил объявление/);
  assert.match(html, /Как исправить\?/);
  assert.match(html, /Старый заголовок/);
  assert.match(html, /&lt;Новый заголовок&gt;/);
  assert.doesNotMatch(html, /<Новый заголовок>/);
  assert.match(html, /9223372036854775801/);
  assert.match(html, /href="https:\/\/direct.yandex.ru\//);
  assert.match(html, /Предложенная правка сохранена в Goulash/);
  assert.match(html, /name="adText"/);
  assert.match(html, /data-creative-title>&lt;Новый заголовок&gt;/);
  assert.match(html, /data-creative-text>Новый «текст»/);
  const second = x.save();
  assert.deepEqual(second.original, first.original);
  assert.deepEqual(x.save(), second);
  assert.equal(x.read().storageRevision, 3);
});

test('причина отказа берётся из последней сверки и выводится как текст', t => {
  const x = fixture(t), run = x.read();
  run.launch!.observation!.adStatusClarification = 'Нужны сведения <о продавце>.';
  const rejected = renderCampaignCreativeReview(x.workspace, run);
  assert.match(rejected, /Нужны сведения &lt;о продавце&gt;\./);
  assert.doesNotMatch(rejected, /Как исправить\?/);
  run.checkedAt = '2026-11-20T12:00:00.000Z';
  const reread = renderCampaignCreativeReview(x.workspace, run);
  assert.doesNotMatch(reread, /Нужны сведения|отклонил/);
});

test('локальная правка проверяет владельца, кампанию, ревизию, блокировку и правила текста', t => {
  const x = fixture(t), initial = x.read(), other = 'yandex:2';
  const differentWorkspace = x.db().createCampaignWorkspace(x.owner).id;
  assert.throws(() => x.save(x.form(), other), /этой кампании не найдено/);
  assert.throws(() => x.save(x.form(), x.owner, differentWorkspace), /этой кампании не найдено/);
  assert.throws(() => x.save(x.form({ run: 'wrong-run' })), /этой кампании не найдено/);
  assert.throws(() => x.save(x.form({ revision: '0' })), /уже изменилась/);
  const duplicate = x.form();
  duplicate.append('revision', '1');
  assert.throws(() => x.save(duplicate), /уже изменилась/);
  for (const invalid of [x.form({ title: 'ж'.repeat(57) }), x.form({ adText: 'ж'.repeat(82) }),
    x.form({ title: 'Первая\u0000строка' }), x.form({ adText: 'Первая\nВторая' }), x.form({ title: ' ' })])
    assert.throws(() => x.save(invalid), /Используйте одну строку/);
  assert.throws(() => x.save(x.form({ title: initial.draft.title, adText: initial.draft.adText })), /Измените заголовок/);
  const unlock = x.db().lockDirect(initial.account);
  try { assert.throws(() => x.save(), /уже выполняется/); } finally { unlock(); }
  assert.deepEqual(x.read(), initial);
  const stale = x.form();
  x.save();
  assert.throws(() => x.save(stale), /уже изменилась/);
});

test('редактор доступен для подтверждённого черновика, проверяет идентичность объявления и исключает незавершённый запуск', t => {
  const x = fixture(t), run = x.read();
  delete run.launch;
  x.db().saveDirect(x.owner, run);
  assert.match(renderCampaignCreativeReview(x.workspace, run), /Правка объявления/);
  assert.doesNotMatch(renderCampaignCreativeReview(x.workspace, run), /отклонил/);
  run.snapshot!.ad.CampaignId = '1';
  x.db().saveDirect(x.owner, run);
  assert.equal(renderCampaignCreativeReview(x.workspace, run), '');
  assert.throws(() => x.save(), /уже изменилась/);
  run.snapshot!.ad.CampaignId = run.steps.campaign.id;
  run.complete = false;
  x.db().saveDirect(x.owner, run);
  assert.equal(renderCampaignCreativeReview(x.workspace, run), '');
  assert.throws(() => x.save(), /уже изменилась/);
});
