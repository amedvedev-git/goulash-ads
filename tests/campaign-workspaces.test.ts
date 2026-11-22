import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { initialPreparation } from '../src/campaign-plan.ts';
import { newStrategyPlan } from '../src/phrase-strategy.ts';
import { campaignCatalogItems } from '../src/campaign-catalog-data.ts';
import { campaignNextAction } from '../src/campaign-catalog.ts';
import { createPreparationService } from '../src/preparation.ts';
import { prepareHref } from '../src/routes.ts';

test('R02/R13: неполные черновики переживают перезапуск и открываются на сохранённом шаге', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-drafts-'));
  let db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = 'local';
  const untouched = db.createCampaignWorkspace(owner).id;
  const saved = [db.createCampaignWorkspace(owner).id, db.createCampaignWorkspace(owner).id, db.createCampaignWorkspace(owner).id];
  for (const id of [untouched, ...saved]) db.savePreparation(owner, { ...initialPreparation(), guided: true }, 0, undefined, 0, id);
  const service = createPreparationService(db);
  const changes = [{ url: 'https://example.ru/order' }, { campaignName: 'Только название' }, { description: 'Установка кондиционеров' }];
  for (const [index, id] of saved.entries()) {
    const result = await service.action(owner, 'save', new URLSearchParams({ ...changes[index], preparationRevision: '1' }), owner, id);
    assert.equal(result.status, 200);
    assert.equal(result.view.saved.value.explicitlySaved, true);
  }
  db.close();
  db = openDatabase(directory);
  const items = campaignCatalogItems(db, owner);
  assert.deepEqual(new Set(items.map(item => item.id)), new Set(saved));
  assert.deepEqual(saved.map(id => items.find(item => item.id === id)!.title), ['example.ru', 'Только название', 'Установка кондиционеров']);
  for (const item of items) {
    assert.equal(item.preparationStep, 1);
    const next = campaignNextAction(item);
    assert.equal(next.href, prepareHref(item.id));
    assert.match(next.hint, /Заполните предложение/);
  }
  const item = items[0];
  assert.match(campaignNextAction({ ...item, preparationStep: 3 }).hint, /поисковые фразы/);
  assert.equal(campaignNextAction({ ...item, stage: 'plan' }).href, `/connections/direct?ad=${item.id}`);
  assert.equal(campaignNextAction({ ...item, stage: 'plan' }).label, 'Подключить Директ');
});

test('две рекламы сохраняют отдельные ревизии, планы, исследования и отмену правки после перезапуска', t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-campaigns-'));
  let db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = 'local', other = 'yandex:1';
  const a = db.createCampaignWorkspace(owner), b = db.createCampaignWorkspace(owner);
  assert.equal(db.readCampaignWorkspace(other, a.id), undefined);
  assert.deepEqual(db.readCampaignWorkspaces(owner).map(item => item.id), [b.id, a.id]);
  assert.throws(() => db.savePreparation(other, initialPreparation(), 0, undefined, undefined, a.id), /не найдена/);

  const confirm = (id: string, title: string, budget: string) => {
    const preparation = initialPreparation();
    preparation.input = { ...exampleCampaign, title, adText: 'Посмотрите условия на сайте.', budget };
    const run = {
      id: title, key: title, kind: 'legacy' as const, input: preparation.input, profileHash: '',
      status: 'complete' as const, plan: newStrategyPlan(preparation.input, 0), attempts: [],
    };
    const saved = db.savePreparation(owner, preparation, 0, run, undefined, id);
    assert.equal(saved.revision, 1);
    assert.equal(db.saveCampaign(owner, preparation.input, 0, owner, revision => {
      db.commitPlan(owner, preparation, saved.revision, revision, undefined, id);
    }, id), true);
  };

  confirm(a.id, 'Доставка', '20000');
  confirm(b.id, 'Самовывоз', '10000');
  const firstPlan = db.readPlans(owner, a.id)[0], secondPlan = db.readPlans(owner, b.id)[0];
  assert.equal(firstPlan.preparationRevision, secondPlan.preparationRevision);
  assert.equal(firstPlan.campaignId, a.id);
  assert.equal(db.readPlan(owner, secondPlan.id)?.campaignId, b.id);
  assert.equal(db.readPlan(owner, secondPlan.id, a.id), undefined);
  assert.equal(db.readPlan(other, secondPlan.id), undefined);
  assert.equal(db.readAllRuns(owner).length, 2);
  assert.equal(db.readRuns(owner, a.id).length, 1);
  assert.equal(db.readRun(owner, 'Самовывоз', a.id), undefined);
  const secondRun = db.readRun(owner, 'Самовывоз', b.id)!;
  assert.throws(() => db.saveRun(owner, secondRun.value, secondRun.revision, a.id), /уже изменена/);

  const draftA = db.readCampaign(owner, a.id)!;
  assert.equal(db.saveCampaign(owner, { ...draftA.draft, title: 'Изменённая доставка' }, draftA.revision, owner, undefined, a.id), true);
  const operation = db.readHistory(owner, a.id)[0];
  assert.equal(operation.campaignId, a.id);
  assert.equal(db.reviewUndo(other, operation.id).status, 'missing');
  db.close();
  db = openDatabase(directory);
  assert.equal(db.readPreparation(owner, b.id)!.value.input.title, 'Самовывоз');
  assert.equal(db.undo(owner, operation.id, owner), 'ok');
  assert.equal(db.readCampaign(owner, a.id)!.draft.title, 'Доставка');
  assert.equal(db.readCampaign(owner, b.id)!.draft.title, 'Самовывоз');
  assert.equal(db.readCampaign(owner), undefined);
});
