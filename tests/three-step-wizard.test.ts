import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { e3Browser } from './fixtures/e3-browser.ts';
import { policyHash } from '../src/phrase-policy.ts';

test('три шага: бизнес, объявление, проверка и запуск одним действием', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-three-steps-'));
  const x = await e3Browser(directory);
  x.server.listen(0, '127.0.0.1');
  await once(x.server, 'listening');
  t.after(async () => { await new Promise<void>((resolve) => x.server.close(() => resolve())); x.db.close(); rmSync(directory, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${(x.server.address() as any).port}`;
  const login = await fetch(origin + '/fixture-login/a', { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string) => fetch(origin + path, { headers: { Cookie: cookie }, signal: t.signal });
  const post = (path: string, values: Record<string, string>) => fetch(origin + path, {
    method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: new URLSearchParams(values), redirect: 'manual', signal: t.signal,
  });

  const created = await post('/campaign/new', {});
  assert.equal(created.status, 303);
  const ad = new URL(created.headers.get('location')!, origin).searchParams.get('ad')!;
  const base = {
    ad, policyHash, revision: '0',
    description: 'Студия йоги в Казани. Пробное занятие 500 ₽, группы для начинающих.',
    url: 'https://example.com/trial', region: 'Екатеринбург', goal: 'Оставить заявку', period: '7', title: '', adText: '',
  };
  const step1 = await post('/preparation/confirm-profile', {
    ...base, preparationRevision: '0', profileEditor: 'yes', editorVersion: '3', offer0: 'Пробное занятие йогой', kind0: 'service',
  });
  assert.equal(step1.status, 303);
  const page1 = await (await get('/campaigns?ad=' + ad)).text();
  assert.deepEqual([...page1.matchAll(/stage-label">([^<]+)/g)].map((match) => match[1]), ['О бизнесе', 'Объявление', 'Проверить и запустить']);
  assert.match(page1, /data-stage="2"/);
  assert.doesNotMatch(page1, /id="plan-budget"/, 'бюджет не спрашивается на шаге объявления');
  assert.match(page1, /id="plan-title"/);
  assert.match(page1, /id="plan-adText"/);

  const preparation = x.db.readPreparation(x.owner, ad)!.revision;
  const campaignRevision = x.db.readCampaign(x.owner, ad)?.revision ?? 0;
  const step2 = await post('/preparation/offer', {
    ...base, revision: String(campaignRevision), preparationRevision: String(preparation), formStep: '3',
    title: 'Пробное занятие йогой', adText: 'Студия йоги. Оставьте заявку на сайте.', budget: '', selectionEditor: 'yes',
    phrases: 'пробное занятие йогой', manualReview: 'yes',
  });
  assert.equal(step2.status, 303, await step2.text());
  const page2 = await (await get('/campaigns?ad=' + ad)).text();
  assert.match(page2, /data-stage="3"/);
  assert.match(page2, /Проверить и запустить/);
  assert.match(page2, /id="plan-budget"/);
  assert.match(page2, /name="confirmPlan"/);
  assert.match(page2, /Создать черновик в Директе/);

  const before = x.db.readPreparation(x.owner, ad)!.revision;
  const campaign = x.db.readCampaign(x.owner, ad)?.revision ?? 0;
  const draft = await post('/preparation/create-draft', {
    ...base, revision: String(campaign), preparationRevision: String(before), formStep: '4',
    title: 'Пробное занятие йогой', adText: 'Студия йоги. Оставьте заявку на сайте.', budget: '7000', confirmPlan: 'yes',
    selectionEditor: 'yes', phrases: 'пробное занятие йогой', manualReview: 'yes',
  });
  assert.equal(draft.status, 303, await draft.text());
  assert.match(draft.headers.get('location')!, /campaign=prepared/);
  const state = x.db.readDirect(x.owner)!;
  assert.equal(state.complete, true);
  assert.ok(state.steps.campaign.id);
  assert.ok(state.steps.ad.id);
  const after = await (await get('/campaigns?ad=' + ad)).text();
  assert.match(after, new RegExp(state.steps.ad.id!));
  assert.match(after, /<h2>Сводка<\/h2>/);
  assert.match(after, /Показы выключены/);
});
