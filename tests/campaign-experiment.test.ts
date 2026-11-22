import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createCampaignExperiments, renderExperimentForm, renderExperimentJournal } from '../src/campaign-experiment.ts';
import { openDatabase } from '../src/database.ts';
import type { DirectState } from '../src/direct.ts';

const owner = 'yandex:101', other = 'yandex:202';
const from = '2026-11-20', to = '2026-11-26';
const control = { title: 'Ремонт на дому', adText: 'Заявка на ремонт.', url: 'https://example.com/order' };
const proposal = { action: 'propose', hypothesis: 'Обращения после <проверки>', title: 'Вызов мастера', from, to, limit: '3000', minimum: '10', lagDays: '2' };
const manual = { action: 'record', report: 'native-1', from, to, candidateCampaign: '102', confirm: 'yes',
  controlConversions: '11', controlSpend: '1000', candidateConversions: '17', candidateSpend: '900' };

function fixture(t: TestContext) {
  const root = resolve(tmpdir()), folder = mkdtempSync(join(root, 'campaign-experiment-'));
  const db = openDatabase(folder);
  t.after(() => {
    db.close();
    assert.equal(dirname(resolve(folder)), root);
    rmSync(folder, { recursive: true, force: true });
  });
  const campaign = db.createCampaignWorkspace(owner).id, sibling = db.createCampaignWorkspace(owner).id;
  const run: DirectState = {
    account: '1000', planId: 'confirmed-run', campaignPlanId: 'frozen-plan', campaignId: campaign, guidedDraft: true, complete: true,
    name: 'Ремонт', groupName: 'Ремонт', regionId: '54', regionName: 'Екатеринбург', weekly: '7000', keyword: '', startDate: from, revision: 1,
    budget: { kind: 'custom_period', amountRub: '7000', spendLimitMicros: '7000000000', periodDays: '7', startDate: from, endDate: to, autoContinue: 'NO' },
    steps: { campaign: { phase: 'confirmed', id: '101' }, group: { phase: 'confirmed', id: '103' }, targeting: { phase: 'confirmed' },
      keyword: { phase: 'confirmed' }, ad: { phase: 'confirmed', id: '104' } },
    events: [], draft: { ...control, description: control.title, region: 'Екатеринбург', budget: '7000', period: '7' },
    snapshot: { campaign: { Id: '101' }, group: { Id: '103' }, targeting: null, keyword: null, ad: {
      Id: '104', ResponsiveAd: { Href: control.url, Titles: [{ Title: control.title }], Texts: [{ Text: control.adText }] },
    } },
  };
  db.saveDirect(owner, run);
  let clock = Date.parse(from + 'T09:00:00+03:00');
  const experiments = createCampaignExperiments(db, (who, id) => {
    const measurement = db.readAnalyticsSettings(who).campaignAnalytics?.[id]?.measurement;
    return { verified: Boolean(measurement?.test?.verifiedAt), measurement };
  }, () => clock);
  const get = () => experiments.view(owner, campaign)!;
  const form = (fields: Record<string, string>) => new URLSearchParams({ run: get().run, revision: String(get().revision), ...fields });
  const act = (fields: Record<string, string>) => experiments.action(owner, campaign, form(fields), 'Владелец');
  const setGoal = (generation: number) => {
    const saved = db.readAnalyticsSettings(owner);
    db.saveAnalyticsSettings(owner, { ...saved, metrikaEnabled: true, metrikaConfigId: 'measurement-provider', campaignAnalytics: {
      [campaign]: { revision: 1, measurement: { counter: { id: '77', domain: 'example.com', goals: [] }, goalId: '88', generation,
        landing: control.url, configId: 'measurement-provider', test: { marker: 'fictional-test', startedAt: 1, verifiedAt: 2 } } },
    } }, saved.revision);
  };
  return { db, campaign, sibling, run, experiments, get, form, act, setGoal, setDay: (day: string) => { clock = Date.parse(day + 'T09:00:00+03:00'); } };
}

test('сохранение A/B фиксирует один заголовок, неизменный контроль и границы кампании', t => {
  const x = fixture(t);
  const request = x.form(proposal);
  assert.throws(() => x.experiments.action(other, x.campaign, request, 'Другой владелец'), /не найден/);
  assert.throws(() => x.experiments.action(owner, x.sibling, request, 'Другая кампания'), /не найден/);
  assert.throws(() => x.act({ ...proposal, title: 'РЕМОНТ НА ДОМУ!' }), /другой заголовок/);
  assert.throws(() => x.act({ ...proposal, limit: '7000.01' }), /укладываться/);
  assert.throws(() => x.act({ ...proposal, to: '2026-11-27' }), /пределах дат/);
  const html = renderExperimentForm(x.get(), x.campaign, [{ title: 'Готовый вариант', adText: 'Игнорируемый текст', evidence: [] }]);
  assert.match(html, /list="experiment-headings"/);
  assert.match(html, /Готовый вариант/);
  assert.doesNotMatch(html, /Игнорируемый текст/);
  x.experiments.action(owner, x.campaign, request, 'Владелец');
  assert.throws(() => x.experiments.action(owner, x.campaign, request, 'Владелец'), /Кампания уже изменилась/);
  const view = x.get(), experiment = view.experiments[0];
  assert.equal(view.experiments.length, 1);
  assert.equal(experiment.candidateTitle, proposal.title);
  assert.deepEqual(experiment.control, { campaign: '101', ad: '104', title: control.title, text: control.adText, landing: control.url });
  assert.equal(experiment.plan, 'frozen-plan');
  assert.equal(x.experiments.view(owner, x.sibling), undefined);
  const journal = renderExperimentJournal(view);
  assert.match(journal, /Обращения после &lt;проверки&gt;/);
  assert.match(journal, /Контрольный вариант сохранён в журнале/);
  assert.deepEqual(x.db.readDirect(owner, x.run.planId)!.snapshot, x.run.snapshot);
});

test('ручные показатели A/B учитывают дозревание, цель, лимит и минимум, контроль остаётся', t => {
  const x = fixture(t);
  x.setGoal(1);
  x.act(proposal);
  const id = x.get().experiments[0].id;
  const record = (fields: Record<string, string> = {}) => x.act({ ...manual, experiment: id, ...fields });
  assert.throws(() => record({ candidateCampaign: '101' }), /две разные кампании/);
  assert.throws(() => record({ from: '2026-11-21' }), /заданному периоду/);
  assert.throws(() => record({ confirm: 'no' }), /подтвердите/);
  x.setDay('2026-11-27');
  record();
  x.setDay('2026-11-30');
  record({ candidateConversions: '2' });
  record({ candidateSpend: '2500' });
  record();
  x.setGoal(2);
  record();
  const reviewed = x.get().experiments[0].reviews;
  assert.deepEqual(reviewed.map(review => review.status), ['waiting', 'insufficient', 'over_budget', 'manual_review', 'goal_changed']);
  assert.ok(reviewed.every(review => review.source === 'manual'));
  assert.match(renderExperimentJournal(x.get()), /Проверьте разбиение аудитории и значимость/);
  x.act({ action: 'close', experiment: id });
  assert.ok(x.get().experiments[0].closed);
  assert.match(renderExperimentJournal(x.get()), /Учёт завершён/);
  assert.throws(() => record(), /эксперимент уже изменился/);
  const stored = x.db.readDirect(owner, x.run.planId)!;
  assert.deepEqual(stored.draft, x.run.draft);
  assert.deepEqual(stored.steps, x.run.steps);
  assert.deepEqual(stored.events, []);
});
