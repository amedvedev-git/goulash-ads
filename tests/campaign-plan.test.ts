import { removeE3Schema } from './fixtures/e3-control.ts';
import { policyHash } from '../src/phrase-policy.ts';
import { fixtureGrounded } from './fixtures/grounded.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.ts';
import { createPreparationService } from '../src/preparation.ts';
import { suggestWording } from '../src/ad-wording.ts';
import { planCurrent, initialPreparation, hash } from '../src/campaign-plan.ts';
import { fakeDirect } from './fixtures/direct-api.ts';
import { createDirectService } from '../src/direct.ts';
import { limitAcceptance } from './fixtures/acceptance-limits.ts';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { renderPlan } from '../src/plan-page.ts';
import { DirectError } from '../src/direct-api.ts';
const input = { description: 'Вымышленная мастерская «Полюс» ремонтирует холодильники на дому. Работаем в Екатеринбурге. Не ремонтируем телевизоры.',
  url: 'https://example.com/repair', region: 'Екатеринбург', budget: '7000', period: '7', title: 'Ремонт холодильников', adText: 'Узнайте о ремонте и условиях на сайте.', goal: 'Обращения по ремонту холодильников' };
const profile = { offers: [{ id: 'repair', name: 'Ремонт холодильников', aliases: ['починка холодильников'], seeds: ['ремонт холодильников', 'вызов мастера по холодильникам'],
  kind: 'service' as const, delivery: false, evidence: 'ремонтирует холодильники на дому' }], ownBrands: ['Полюс'], exclusions: [{ phrase: 'телевизоры', evidence: 'Не ремонтируем телевизоры' }], uncertainty: ['Стоимость ремонта'] };
const profileForm = { profileEditor: 'yes', offer0: 'Ремонт холодильников', offerId0: 'repair', aliases0: 'починка холодильников',
  seeds0: 'ремонт холодильников\nвызов мастера по холодильникам', kind0: 'service', evidence0: 'ремонтирует холодильники на дому', ownBrands: 'Полюс', exclude0: 'телевизоры', excludeEvidence0: 'Не ремонтируем телевизоры', uncertainty: 'Стоимость ремонта' };
function fixture(t: test.TestContext, providers = true) {
  const dir = mkdtempSync(join(tmpdir(), 'e1-plan-')); let db = openDatabase(dir), profiles = 0, judgments = 0, requests = 0;
  const fake = fakeDirect();
  let wrong = false, fail = 0, hold: Promise<void> | undefined;
  const ai = { profile: async () => { profiles++; if (hold) await hold; return structuredClone(profile); },
    judge: async (_draft, confirmed, candidates) => { judgments++; assert.equal(confirmed.offers[0].name, wrong ? 'Починка холодильников' : 'Ремонт холодильников');
      return candidates.map(c => ({ id: c.id, offerId: 'repair', decision: 'include', intent: 'purchase', brand: 'none', brandTerm: null, adRelevant: true, reason: 'Соответствует ремонту холодильников.' })); } };
  ai.groundedJudge = async (draft, confirmed, candidates, meta) => { await ai.judge(draft,confirmed,candidates); return fixtureGrounded(confirmed,candidates); };
  const wordstat = async () => { requests++; if (requests === fail) throw new Error('private-key-must-not-appear'); return [{ phrase: 'заказать ремонт холодильников', count: '100' }, { phrase: 'мастер по холодильникам', count: '20' }]; };
  const geo = async () => [{ GeoRegionId: '54', GeoRegionName: 'Екатеринбург' }, { GeoRegionId: '6', GeoRegionName: 'Калуга' }];
  let service = createPreparationService(db, providers ? ai : undefined, providers ? wordstat : undefined, providers ? geo : undefined);
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  const act = (action: string, fields: Record<string, string> = {}, revision?: number) => service.action('local', action,
    new URLSearchParams({ policyHash, preparationRevision: String(revision ?? service.view('local').saved.revision), ...fields }), 'Тест');
  return { dir, db: () => db, fake, act, view: () => service.view('local'), counts: () => [profiles, requests, judgments],
    wrong: () => { wrong = true; }, fail: (n: number) => { fail = n; }, hold: (p: Promise<void>) => { hold = p; },
    restart: () => { db.close(); db = openDatabase(dir); service = createPreparationService(db, providers ? ai : undefined, providers ? wordstat : undefined, providers ? geo : undefined); } };
}
async function understood(x: ReturnType<typeof fixture>, ai = true, correction = false) {
  assert.equal((await x.act('entry', input)).status, 200);
  if (ai) assert.equal((await x.act('profile', { aiConsent: 'yes' })).status, 200);
  const fields = { ...profileForm, ...(correction ? { offer0: 'Починка холодильников' } : {}) };
  assert.equal((await x.act('confirm-profile', fields)).status, 200);
}
async function manualConfirmed(x: ReturnType<typeof fixture>) {
  await understood(x, false);
  assert.equal((await x.act('offer', { phrases: 'заказать ремонт холодильников', manualReview: 'yes' })).status, 200);
  assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 200);
}
test('E1: полный ручной путь без подключений, restart, неизменяемый план и полный no-op', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const accepted = x.view().plan!;
  assert.equal(x.view().current, true); assert.equal(accepted.phraseSource, 'manual');
  assert.deepEqual(x.db().readPhrasePlan('local')!.candidates.map(c => c.phrase), accepted.phrases);
  x.restart(); assert.equal(x.view().current, true); assert.equal(x.view().plan!.id, accepted.id);
  await x.act('confirm', { confirmPlan: 'yes' }); assert.equal(x.view().plan!.id, accepted.id);
  assert.deepEqual(x.counts(), [0, 0, 0]);
});
test('Трек разрешает возврат вперёд к проверенным шагам и сохраняет проверку фраз', async t => {
  const x = fixture(t, false);
  assert.equal((await x.act('back', { step: '4' })).status, 409);
  await understood(x, false);
  const unchecked = await x.act('offer', { phrases: 'заказать ремонт холодильников' });
  assert.equal(unchecked.status, 409);
  assert.ok(unchecked.view.errors?.manualReview);
  assert.equal((await x.act('offer', { phrases: 'заказать ремонт холодильников', manualReview: 'yes' })).status, 200);
  await x.act('confirm', { confirmPlan: 'yes' });
  const planId = x.view().plan!.id;
  await x.act('back', { step: '1' });
  x.restart();
  assert.equal(x.view().lastReadyStep, 4);
  assert.equal((await x.act('back', { step: '4', description: 'Новые сведения о бизнесе.' })).status, 409);
  assert.equal(x.view().saved.value.input.description, input.description);
  assert.equal((await x.act('back', { step: '4' })).status, 200);
  assert.equal(x.view().plan!.id, planId);
  assert.equal(x.view().current, true);
  await x.act('back', { step: '3' });
  assert.equal((await x.act('offer', { phrases: 'заказать ремонт холодильников' })).status, 200);
  await x.act('back', { step: '3' });
  assert.equal((await x.act('offer', { phrases: 'мастер по холодильникам' })).status, 409);
  await x.act('back', { step: '1', description: 'Новые сведения о бизнесе.' });
  assert.equal(x.view().lastReadyStep, 2);
  assert.equal((await x.act('back', { step: '4' })).status, 409);
});
test('Заголовок сохраняет целые названия и убирает повторяющиеся предложения', () => {
  const headline = (...names: string[]) => suggestWording('', names.map(name => ({ name }))).title;
  assert.equal(headline('Суши и роллы', 'Роллы'), 'Суши и роллы');
  assert.equal(headline('Суши', 'Роллы'), 'Суши, Роллы');
  assert.equal(headline('Роллы', 'РОЛЛЫ с лососем'), 'РОЛЛЫ с лососем');
  assert.equal(headline('Ролл', 'Роллы'), 'Ролл, Роллы');
  assert.equal(headline('C++', 'Курсы C++'), 'Курсы C++');
  assert.equal(headline('Суши', 'суши'), 'Суши');
});
test('Предпросмотр и подготовка обновляют предложение после возврата и сохраняют ручную правку отдельно', async t => {
  const x = fixture(t, false);
  const auto = { ...input, title:'', adText:'' };
  assert.equal((await x.act('entry', auto)).status, 200);
  assert.equal((await x.act('confirm-profile', profileForm)).status, 200);
  assert.equal(x.view().saved.value.input.title, profileForm.offer0);
  assert.match(x.view().saved.value.input.adText, /ремонтирует холодильники на дому/);
  assert.equal((await x.act('back', {step:'1', title:'Мой заголовок'})).status, 200);
  const updated = 'Настраиваем кофемашины в мастерской.';
  await x.act('entry', { description:updated });
  const html = renderPlan(x.view(),'local');
  assert.match(html, /data-preview="adText"[^>]*>Настраиваем кофемашины в мастерской\./);
  assert.match(html, /data-preview="title"[^>]*>Мой заголовок/);
  const revised = {profileEditor:'yes', offer0:'Настройка кофемашин', kind0:'service', evidence0:'Настраиваем кофемашины'};
  assert.equal((await x.act('confirm-profile', revised)).status, 200);
  x.restart();
  assert.equal(x.view().saved.value.input.title, 'Мой заголовок');
  assert.equal(x.view().saved.value.input.adText, updated);
  assert.equal((await x.act('suggest-wording')).status, 200);
  assert.equal(x.view().saved.value.input.title, revised.offer0);
  assert.equal(x.view().saved.value.input.adText, updated);
  assert.deepEqual(x.counts(), [0,0,0]);
});
test('Редактор предложений сохраняет частичные строки и возвращает ошибку к конкретному полю', async t => {
  const x = fixture(t, false);
  await x.act('entry', input);
  const fields = { editorVersion: '2', profileEditor: 'yes', evidence0: 'ремонтирует холодильники на дому', brand0: 'Полюс', excludeEvidence0: 'Не ремонтируем телевизоры', question0: 'Стоимость ремонта' };
  await x.act('save', fields);
  x.restart();
  const value = x.view().saved.value.profile!.value;
  assert.equal(value.offers[0].evidence, fields.evidence0);
  assert.deepEqual(value.ownBrands, ['Полюс']);
  assert.deepEqual(value.uncertainty, ['Стоимость ремонта']);
  assert.equal(value.exclusions[0].evidence, fields.excludeEvidence0);
  const invalid = await x.act('confirm-profile', fields);
  assert.equal(invalid.status, 400);
  assert.ok(invalid.view.errors?.offer0);
  assert.ok(invalid.view.errors?.exclude0);
  const html = renderPlan(invalid.view, 'owner');
  assert.match(html, /id="plan-offer0"[^>]*aria-invalid="true"/);
  assert.match(html, /id="plan-exclude0"[^>]*aria-invalid="true"/);
  assert.equal((await x.act('confirm-profile', { ...fields, offer0: 'Ремонт', exclude0: 'телевизоры' })).status, 200);
});
test('Редактор без JavaScript добавляет и убирает одну строку, оставляет остальные данные и сохранённую версию', async t => {
  const x = fixture(t, false);
  await x.act('entry', input);
  const stored = x.view().saved;
  const fields = { ...profileForm, editorVersion: '2', brand0: 'Полюс', question0: 'Стоимость ремонта' };
  const added = await x.act('edit-rows', { ...fields, rowAction: 'add-offer' });
  assert.equal(added.status, 200);
  assert.equal(added.view.saved.value.profile?.value.offers.length, 2);
  assert.match(renderPlan(added.view, 'owner'), /name="offer1"/);
  const removed = await x.act('edit-rows', { ...fields, rowAction: 'remove-offer-0', offer1: 'Роллы', offerId1: 'rolls' });
  assert.deepEqual(removed.view.saved.value.profile?.value.offers.map(o => [o.name, o.id]), [['Роллы', 'rolls']]);
  assert.deepEqual(removed.view.saved.value.profile?.value.ownBrands, ['Полюс']);
  const extras = [['brand', 'ownBrands', 'Полюс'], ['exclude', 'exclusions', 'телевизоры'], ['question', 'uncertainty', 'Стоимость ремонта']] as const;
  for (const [kind, key, value] of extras) {
    const firstField = kind + '0';
    const blank = await x.act('edit-rows', { ...fields, editorVersion: '3', [firstField]: ' ', rowAction: 'add-' + kind });
    assert.equal(blank.view.saved.value.profile?.value[key].length, 1);
    const filled = await x.act('edit-rows', { ...fields, editorVersion: '3', [firstField]: value, rowAction: 'add-' + kind });
    assert.equal(filled.view.saved.value.profile?.value[key].length, 2);
  }
  assert.deepEqual(x.view().saved, stored);
  assert.deepEqual(x.counts(), [0, 0, 0]);
});
test('Владелец подтверждает предложение, доставку и исключение без ручной цитаты', async t => {
  const x = fixture(t);
  await x.act('entry', {...input, title:'', adText:''});
  const response = await x.act('confirm-profile', {editorVersion:'3', profileEditor:'yes', offer0:'Настройка кофемашин', delivery0:'yes', exclude0:'телевизоры', brand0:'МастерСервис'});
  assert.equal(response.status, 200, response.message);
  assert.equal(x.view().saved.value.input.title, 'Настройка кофемашин');
  assert.doesNotMatch(x.view().saved.value.input.adText, /холодильник/);
  const profile = x.view().saved.value.profile!.value;
  assert.equal(profile.offers[0].delivery, true);
  assert.deepEqual(profile.ownBrands, ['МастерСервис']);
  assert.equal(profile.exclusions[0].phrase, 'телевизоры');
  const ad = renderPlan(x.view(), 'owner');
  assert.match(ad, /добавьте на шаге «О бизнесе» сведения о предложениях «Настройка кофемашин»/);
  assert.doesNotMatch(ad, /name="researchConsent"/);
  const blocked = await x.act('research', {researchConsent:'yes',judgeConsent:'yes'});
  assert.equal(blocked.status, 409);
  assert.match(blocked.message, /сведения о предложениях «Настройка кофемашин»/);
  assert.equal((await x.act('offer', {phrases:'настройка кофемашин', manualReview:'yes'})).status, 200);
  assert.equal((await x.act('confirm', {confirmPlan:'yes'})).status, 200);
  assert.equal(x.view().current, true);
  assert.deepEqual(x.counts(), [0, 0, 0]);
});
test('Пустой ручной черновик после разбора DeepSeek не подменяется прежними рекомендациями', async t => {
  const x = fixture(t);
  await x.act('entry', input);
  await x.act('profile', { aiConsent: 'yes' });
  assert.match(renderPlan(x.view(), 'owner'), /name="profilePresented"/);
  await x.act('save', { profilePresented: 'yes', profileEditor: 'yes', editorVersion: '2', offer0: '', evidence0: '' });
  x.restart();
  const html = renderPlan(x.view(), 'owner');
  assert.doesNotMatch(html, /name="profilePresented"/);
  assert.match(html, /name="runId"/);
  assert.deepEqual(x.view().saved.value.profile?.value.offers, []);
});
test('E1: восстановление помечает ввод несохранённым и не выдаёт его за принятый план', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const stored = x.view().saved;
  const restored = await x.act('resume', { title: 'Несохранённый ручной текст', formStep: '3' });
  assert.equal(restored.status, 200); assert.equal(restored.view.unsaved, true); assert.equal(restored.view.restored, true);
  assert.equal(restored.view.current, false); assert.deepEqual(x.view().saved, stored);
  const html = renderPlan(restored.view, 'owner'); assert.match(html, /data-dirty="1"/); assert.match(html, /data-restored="1"/);
  assert.match(html, /Есть несохранённые изменения/); assert.match(html, /value="Несохранённый ручной текст"/);
});
test('E1 DR01-I1: исправленный профиль доходит до judge, run ID и старые ответы не заменяются proposal', async t => {
  const x = fixture(t); await understood(x, true, true); x.wrong();
  const first = x.view().run!; assert.equal(first.plan.strategy.profile!.offers[0].name, 'Ремонт холодильников');
  const result = await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' }); assert.equal(result.status, 200);
  assert.equal(x.view().run!.plan.strategy.profile!.offers[0].name, 'Починка холодильников');
  assert.equal(x.db().readRun('local', first.id)!.value.id, first.id);
  assert.deepEqual(x.counts(), [1, 2, 1]);
  await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' }); assert.deepEqual(x.counts(), [1, 2, 1]);
});
test('E1 DR01-I3: только goal/выбор/профиль создают новую идентичность при прежнем CampaignDraft', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const old = x.view().plan!;
  await x.act('save', { goal: 'Звонки в мастерскую' }); assert.equal(x.view().current, false);
  await x.act('confirm', { confirmPlan: 'yes' }); assert.notEqual(x.view().plan!.id, old.id);
  assert.equal(x.view().plan!.campaignRevision, old.campaignRevision);
  const goal = x.view().plan!;
  await x.act('offer', { phrases: 'мастер по холодильникам', manualReview: 'yes' }); await x.act('confirm', { confirmPlan: 'yes' });
  assert.notEqual(x.view().plan!.id, goal.id); assert.equal(x.view().plan!.campaignRevision, old.campaignRevision);
  const selected = x.view().plan!;
  await x.act('confirm-profile', { ...profileForm, offer0: 'Починка холодильников' });
  await x.act('offer', { phrases: 'мастер по холодильникам', manualReview: 'yes' }); await x.act('confirm', { confirmPlan: 'yes' });
  assert.notEqual(x.view().plan!.id, selected.id); assert.equal(x.view().plan!.campaignRevision, old.campaignRevision);
});
test('E1: budget/period/URL не повторяют AI/Wordstat; регион и объявление снимают проверку', async t => {
  const x = fixture(t); await understood(x); await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  await x.act('offer', { phrases: 'заказать ремонт холодильников', manualReview: 'yes' }); await x.act('confirm', { confirmPlan: 'yes' });
  await x.act('save', { budget: '9000', period: '30', url: 'https://example.com/changed' });
  assert.equal(x.view().saved.value.profile!.confirmedHash, x.view().plan!.profile.confirmedHash);
  assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 200); assert.deepEqual(x.counts(), [1,2,1]);
  await x.act('save', { region: 'Калуга' }); assert.equal(x.view().current, false);
  assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 409);
  await x.act('save', { region: 'Екатеринбург', adText: 'Новые условия на сайте.' });
  assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 409); assert.deepEqual(x.counts(), [1,2,1]);
});
test('E1: поздний профиль не затирает ручную правку и неизвестный pending переживает restart', async t => {
  const x = fixture(t); await x.act('entry', input); let release!: () => void; x.hold(new Promise(r => { release = r; }));
  const pending = x.act('profile', { aiConsent: 'yes' }); await new Promise(r => setImmediate(r));
  const id = x.view().run!.id; assert.equal(x.view().run!.attempts[0].status, 'pending');
  await x.act('confirm-profile', { ...profileForm, offer0: 'Починка холодильников' }); release(); await pending;
  assert.equal(x.view().saved.value.profile!.value.offers[0].name, 'Починка холодильников');
  assert.equal(x.db().readRun('local', id)!.value.plan.strategy.profile!.offers[0].name, 'Ремонт холодильников');
  const run = x.db().readRun('local', id)!; run.value.status = 'running'; run.value.attempts[0].status = 'pending'; x.db().saveRun('local', run.value, run.revision);
  x.restart(); await x.act('profile', { aiConsent: 'yes' }); assert.equal(x.counts()[0], 1);
});
test('E1: частичный неизвестный Wordstat сохраняет ответы и не повторяется', async t => {
  const x = fixture(t); await understood(x); x.fail(2);
  await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' }); const run = x.view().run!;
  assert.equal(run.status, 'stopped'); assert.equal(run.plan.strategy.requests[0].phase, 'complete');
  assert.equal(run.attempts.at(-1)!.status, 'unknown'); assert.deepEqual(x.counts(), [1,2,0]);
  x.restart(); await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  assert.equal((await x.act('continue-research', { runId: run.id, researchConsent: 'yes', judgeConsent: 'yes' })).status, 409);
  assert.deepEqual(x.counts(), [1,2,0]); assert.doesNotMatch(JSON.stringify(x.db().readRuns('local')), /private-key/);
  assert.equal((await x.act('offer', { phrases: 'заказать ремонт холодильников', manualReview: 'yes' })).status, 200);
});
test('UX01-I1: partial Wordstat без judge объясняется неполным исследованием, включая сохранённый старый текст', async t => {
  const x = fixture(t); await understood(x); x.fail(2);
  await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  const run = x.view().run!, unassessed = run.plan.strategy.candidates.filter(c => c.decision !== 'exclude');
  assert.equal(x.counts()[2], 0); assert.equal(run.plan.strategy.evaluated, 0);
  for (const c of unassessed) { assert.match(c.reason, /не запускалась.*неполное/); assert.doesNotMatch(c.reason, /лимит/); assert.equal(c.selected, false); }
  const saved = x.db().readRun('local', run.id)!;
  saved.value.plan.strategy.candidates.forEach(c => { if (c.decision !== 'exclude') c.reason = 'Смысл не оценён: достигнут лимит одной проверки. Требуется ручной просмотр.'; });
  x.db().saveRun('local', saved.value, saved.revision);
  const html = renderPlan(x.view(), 'owner'); assert.match(html, /не запускалась.*неполное/); assert.doesNotMatch(html, /достигнут лимит одной проверки/);
  assert.match(x.db().readRun('local', run.id)!.value.plan.strategy.candidates[0].reason, /достигнут лимит/, 'render does not rewrite the stored evidence');
  assert.equal((await x.act('offer', { phrases: 'заказать ремонт холодильников', manualReview: 'yes' })).status, 200);
  assert.equal(x.view().saved.value.selection.source, 'manual'); assert.deepEqual(x.counts(), [1,2,0]);
});
for (const failure of ['failed', 'unknown', 'rejected']) test(`UX01-I1: judge ${failure} не выдаётся за достигнутый cap`, async t => {
  const x = fixture(t, false); let calls = 0;
  const service = createPreparationService(x.db(), { profile: async () => structuredClone(profile), judge: async () => {
    calls++; if (failure === 'failed') throw new DirectError('Смысловой разбор недоступен (HTTP 503).');
    if (failure === 'unknown') throw new Error('Transport result unknown'); return [];
  } }, async () => [{ phrase:'заказать ремонт холодильников',count:'20' }], async () => [{GeoRegionId:'54',GeoRegionName:'Екатеринбург'}]);
  const act = (action, values = {}) => service.action('local', action, new URLSearchParams({preparationRevision:String(service.view('local').saved.revision),...values}),'UX fixture');
  await act('entry',input); await act('confirm-profile',profileForm); await act('research',{researchConsent:'yes',judgeConsent:'yes'});
  const view = service.view('local'), run = view.run!; assert.equal(calls,1); assert.equal(run.attempts.find(a=>a.kind==='judge')!.status,failure);
  assert.equal(run.plan.strategy.evaluated,0); assert.match(run.plan.candidates[0].reason,/Проверенная смысловая оценка не получена/); assert.doesNotMatch(run.plan.candidates[0].reason,/лимит/);
  assert.match(renderPlan(view,'owner'),/Проверенная смысловая оценка не получена/);
});
test('UX01-I1: реальный cap80 применяется только к неотправленным кандидатам после полной оценки80', async t => {
  const x = fixture(t,false); let sent = 0, calls = 0;
  const service = createPreparationService(x.db(), { profile:async()=>structuredClone(profile),judge:async(_draft,p,candidates)=>{
    calls++;sent=candidates.length;return candidates.map(c=>({id:c.id,offerId:p.offers[0].id,decision:'include',intent:'purchase',brand:'none',brandTerm:null,adRelevant:true,reason:'Подставная оценка.'}));
  } }, async()=>Array.from({length:90},(_,i)=>({phrase:`ремонт холодильников ${i}`,count:String(100+i)})),async()=>[{GeoRegionId:'54',GeoRegionName:'Екатеринбург'}]);
  const act = (action,values={})=>service.action('local',action,new URLSearchParams({preparationRevision:String(service.view('local').saved.revision),...values}),'Cap fixture');
  await act('entry',input);await act('confirm-profile',profileForm);await act('research',{researchConsent:'yes',judgeConsent:'yes'});
  const view=service.view('local'), run=view.run!,unassessed=run.plan.candidates.filter(c=>c.decision==='review');
  assert.equal(calls,1);assert.equal(sent,80);assert.equal(run.plan.strategy.evaluated,80);assert.equal(unassessed.length,10);
  for(const c of unassessed) assert.match(c.reason,/лимит 80 запросов/);
  assert.equal((run.attempts.find(a=>a.kind==='judge')!.input as any).limit,80);
  assert.match(renderPlan(view,'owner'),/лимит 80 запросов/);
  assert.equal(run.plan.candidates.filter(c=>c.decision==='include').length,80);
});
test('ORCH-I1: неизвестный provider input блокируется после смены объявления и нового run key', async t => {
  const x = fixture(t); await understood(x); x.fail(2);
  await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' }); const original = x.view().run!.id;
  await x.act('save', { title: 'Мастер по холодильникам' });
  const result = await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  assert.equal(result.status, 409); assert.match(result.message, /Смена объявления/);
  assert.deepEqual(x.counts(), [1,2,0]); assert.equal(x.view().run!.id, original);
  assert.equal(x.db().readRuns('local').filter(r => r.kind === 'research').length, 1);
});
test('ORCH-I2: кеш 23ч, rejudge и ещё 2ч не продлевают свежесть частот', async t => {
  const x = fixture(t); await understood(x); await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  let saved = x.db().readRun('local', x.view().run!.id)!;
  const at = new Date(Date.now() - 23 * 3600000).toISOString();
  saved.value.plan.strategy.requests.forEach(r => { r.at = at; }); x.db().saveRun('local', saved.value, saved.revision);
  await x.act('save', { title: 'Мастер по холодильникам' }); await x.act('research', { researchConsent: 'yes', judgeConsent: 'yes' });
  assert.deepEqual(x.counts(), [1,2,2]); saved = x.db().readRun('local', x.view().run!.id)!;
  assert.ok(saved.value.plan.strategy.candidates.every(c => c.evidence.every(e => e.at === at)));
  const choose = () => x.act('offer', { selected: 'заказать ремонт холодильников' });
  assert.equal((await choose()).status, 200); assert.equal(x.view().saved.value.selection.source, 'strategy');
  const realNow = Date.now; Date.now = () => realNow() + 2 * 3600000;
  try {
    assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 409);
    assert.equal((await choose()).status, 409);
    assert.equal((await x.act('offer', { selected: 'заказать ремонт холодильников', manualReview: 'yes' })).status, 200);
    assert.equal(x.view().saved.value.selection.source, 'manual');
  } finally { Date.now = realNow; }
});
test('E1: CAS, конфликт и внешний undo не дают использовать старое подтверждение', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const revision = x.view().saved.revision;
  await x.act('save', { goal: 'Звонки' }); const conflict = await x.act('save', { goal: 'Мой вариант' }, revision);
  assert.equal(conflict.status, 409); assert.equal(conflict.view.saved.value.goal, 'Мой вариант');
  assert.equal(x.view().saved.value.goal, 'Звонки');
  await x.act('resolve', { goal: 'Мой вариант', currentRevision: String(x.view().saved.revision), currentCampaignRevision: String(x.view().campaignRevision), replace: 'yes' });
  assert.equal(x.view().saved.value.goal, 'Мой вариант');
  const saved = x.db().readCampaign('local')!; x.db().saveCampaign('local', { ...saved.draft, title: 'Внешняя правка' }, saved.revision);
  assert.equal(x.view().current, false); assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 409);
});
test('E1: финальная транзакция откатывает draft/history при конфликте workspace; owner isolation', async t => {
  const x = fixture(t, false); await understood(x, false); await x.act('offer', { phrases: 'ремонт холодильников', manualReview: 'yes' });
  const p = x.view().saved; const history = x.db().readHistory('local');
  assert.throws(() => x.db().saveCampaign('local', p.value.input, 0, 'Тест', revision => x.db().commitPlan('local', p.value, p.revision - 1, revision)));
  assert.equal(x.db().readCampaign('local'), undefined); assert.deepEqual(x.db().readHistory('local'), history);
  await x.act('confirm', { confirmPlan: 'yes' }); assert.equal(x.db().readPlan('other', x.view().plan!.id), undefined);
  assert.deepEqual(x.db().readRuns('other'), []);
});
for (const kind of ['save', 'undo']) test(`TR01-I1: сравнение показывает фактическое объявление после внешнего ${kind}`, async t => {
  const x = fixture(t, false); await manualConfirmed(x); const original = x.db().readCampaign('local')!;
  x.db().saveCampaign('local', { ...original.draft, title: 'Внешняя правка №2' }, original.revision);
  if (kind === 'undo') {
    const changed = x.db().readCampaign('local')!;
    x.db().saveCampaign('local', { ...changed.draft, title: 'Внешняя правка №3 перед undo' }, changed.revision);
    assert.equal(x.db().undo('local', x.db().readHistory('local')[0].id, 'Другая вкладка'), 'ok');
  }
  const external = x.db().readCampaign('local')!, result = await x.act('confirm', { confirmPlan: 'yes' });
  assert.equal(result.status, 409); assert.deepEqual(result.view.campaign, external);
  const html = renderPlan(result.view, 'owner');
  assert.match(html, /Внешняя правка №2/); assert.match(html, /Сохранённое объявление/);
  assert.match(html, new RegExp(`name="currentCampaignRevision" value="${external.revision}"`));
  assert.equal(result.view.latest!.input.title, original.draft.title, 'latest preparation stays distinct from the actual campaign');
  const reopened = x.view(); assert.equal(reopened.conflict, true);
  assert.match(renderPlan(reopened, 'owner'), /Внешняя правка №2/, 'the comparison link must also show actual external values');
  const stored = x.db().readPreparation('local');
  const restored = await x.act('resume', { title: 'Восстановленный ввод при конфликте', formStep: '3' });
  assert.equal(restored.status, 409); assert.equal(restored.view.restored, true);
  assert.equal(restored.view.saved.value.input.title, 'Восстановленный ввод при конфликте');
  assert.deepEqual(x.db().readPreparation('local'), stored);
});
test('TR01-I2: resolve требует обе показанные revision и новое сравнение после внешней гонки', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const original = x.db().readCampaign('local')!;
  x.db().saveCampaign('local', { ...original.draft, title: 'Показанная внешняя версия №2' }, original.revision);
  const shown = await x.act('confirm', { confirmPlan: 'yes' }); assert.equal(shown.status, 409);
  const snapshot = () => hash({ preparation: x.db().readPreparation('local'), campaign: x.db().readCampaign('local'), history: x.db().readHistory('local'), runs: x.db().readRuns('local'), phrases: x.db().readPhrasePlan('local') });
  const beforeMissing = snapshot();
  assert.equal((await x.act('resolve', { currentRevision: String(shown.view.currentRevision), replace: 'yes' })).status, 409);
  assert.equal(snapshot(), beforeMissing);
  x.db().saveCampaign('local', { ...original.draft, title: 'Невиденная внешняя версия №3' }, shown.view.campaignRevision);
  const beforeRace = snapshot();
  const raced = await x.act('resolve', { goal: 'Мой вариант', currentRevision: String(shown.view.currentRevision), currentCampaignRevision: String(shown.view.campaignRevision), replace: 'yes' });
  assert.equal(raced.status, 409); assert.equal(snapshot(), beforeRace);
  assert.match(renderPlan(raced.view, 'owner'), /Невиденная внешняя версия №3/);
  assert.equal(x.db().readPreparation('local')!.value.baseCampaignRevision, original.revision);
  const current = x.db().readPreparation('local')!;
  x.db().savePreparation('local', { ...current.value, goal: 'Ещё одна подготовка' }, current.revision);
  const beforePreparationRace = snapshot();
  const racedPreparation = await x.act('resolve', { goal: 'Мой вариант', currentRevision: String(raced.view.currentRevision), currentCampaignRevision: String(raced.view.campaignRevision), replace: 'yes' });
  assert.equal(racedPreparation.status, 409); assert.equal(snapshot(), beforePreparationRace);
  const accepted = await x.act('resolve', { goal: 'Мой вариант', currentRevision: String(racedPreparation.view.currentRevision), currentCampaignRevision: String(racedPreparation.view.campaignRevision), replace: 'yes' });
  assert.equal(accepted.status, 200); assert.equal(x.db().readPreparation('local')!.value.baseCampaignRevision, 3);
  assert.equal(x.db().readCampaign('local')!.draft.title, 'Невиденная внешняя версия №3', 'resolve saves only the preparation');
  assert.equal((await x.act('confirm', { confirmPlan: 'yes' })).status, 200);
  assert.equal(x.db().readCampaign('local')!.draft.title, original.draft.title, 'replacement follows an explicit comparison of version 3');
});
test('TR01-I2: обе revision сверяются внутри транзакции разрешения, без частичной записи', async t => {
  const x = fixture(t, false); await manualConfirmed(x); const original = x.db().readCampaign('local')!;
  x.db().saveCampaign('local', { ...original.draft, title: 'Показанная версия' }, original.revision);
  const shown = await x.act('confirm', { confirmPlan: 'yes' });
  const db = x.db(), originalSave = db.savePreparation;
  const snapshot = () => hash({ p: db.readPreparation('local'), c: db.readCampaign('local'), h: db.readHistory('local'), r: db.readRuns('local') });
  let snapshotAfterConcurrentWrite = '', injected = false;
  db.savePreparation = (...args) => {
    if (!injected) { injected = true; const latest = db.readCampaign('local')!;
      db.saveCampaign('local', { ...latest.draft, title: 'Гонка перед BEGIN' }, latest.revision);
      snapshotAfterConcurrentWrite = snapshot(); }
    return originalSave(...args);
  };
  try {
    const result = await x.act('resolve', { currentRevision: String(shown.view.currentRevision), currentCampaignRevision: String(shown.view.campaignRevision), replace: 'yes' });
    assert.equal(result.status, 409); assert.equal(snapshot(), snapshotAfterConcurrentWrite);
    assert.match(renderPlan(result.view, 'owner'), /Гонка перед BEGIN/);
  } finally { db.savePreparation = originalSave; }
});
test('E1: новый Direct только из актуального плана, старые платные входы закрыты без вызовов', async t => {
  const x = fixture(t, false); await manualConfirmed(x);
  const service = createDirectService(x.db(), { api: x.fake.api, owner: 'local', account: '31001001', mode: 'fixture' });
  for (const action of ['suggest', 'strategy', 'strategy-confirm', 'research']) await assert.rejects(service.action('local', action, new URLSearchParams(), 'Тест'), /прежний путь/);
  const plan = x.view().plan!, fields = new URLSearchParams({ revision: String(plan.campaignRevision), campaignPlanId: plan.id, name: 'Fixture', weekly: '300' });
  await assert.rejects(service.action('local', 'prepare', new URLSearchParams({ revision: '1', keyword: 'ремонт' }), 'Тест'), /подтвердите/);
  await service.action('local', 'prepare', fields, 'Тест'); const state = x.db().readDirect('local')!;
  await x.act('save', { goal: 'Новая цель' });
  await assert.rejects(service.action('local', 'create', new URLSearchParams({ planId: state.planId, confirm: 'yes' }), 'Тест'), /План изменился/);
  assert.equal(x.fake.writes().length, 0);
  await x.act('confirm', { confirmPlan: 'yes' }); fields.set('campaignPlanId', x.view().plan!.id); await service.action('local', 'prepare', fields, 'Тест');
  await service.action('local', 'create', new URLSearchParams({ planId: x.db().readDirect('local')!.planId, confirm: 'yes' }), 'Тест');
  assert.equal(x.db().readDirect('local')!.complete, true);
});
test('E1/E2: v7→v11 сохраняет старые строки и точные Int64', t => {
  const x = fixture(t, false); const dir = x.dir;
  x.db().saveCampaign('legacy', { ...input }, 0, 'Прежний автор');
  const raw = new DatabaseSync(join(dir, 'stage2.sqlite'));
  removeE3Schema(raw); raw.exec('DROP TABLE campaign_preparations; DROP TABLE campaign_plans; DROP TABLE campaign_strategy_runs; DROP TABLE direct_runs; DROP TABLE direct_connections; DROP TABLE direct_accounts; DROP TABLE direct_connect_attempts; DROP TABLE direct_dispatches; CREATE TABLE direct_bindings(owner TEXT PRIMARY KEY,account TEXT NOT NULL UNIQUE,payload TEXT NOT NULL) STRICT; PRAGMA user_version=7;');
  const fakeState = { account: '1', planId:'legacy-run', id: '9000123400000000456', status: 'pending' };
  raw.prepare('INSERT INTO direct_bindings VALUES(?,?,?)').run('legacy', '1', JSON.stringify(fakeState));
  const before = ['campaign_drafts', 'operation_history', 'phrase_plans'].map(table => [table, hash(raw.prepare('SELECT * FROM ' + table).all())]); raw.close();
  x.restart(); const migrated = new DatabaseSync(join(dir, 'stage2.sqlite'));
  assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version, 11);
  for (const [table, checksum] of before) {
    const rows = migrated.prepare('SELECT * FROM ' + table).all().map(({ campaign_id, ...row }) => row);
    assert.equal(hash(rows), checksum);
  }
  assert.equal(migrated.prepare('SELECT payload FROM direct_runs WHERE owner=?').get('legacy')!.payload, JSON.stringify(fakeState));
  assert.equal((x.db().readDirect('legacy') as any).id, '9000123400000000456'); migrated.close();
});
test('E1: настоящий обрыв процесса после платного намерения не вызывает провайдер повторно', { timeout: 15000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'e1-crash-'));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/e1-pending.ts', import.meta.url)), dir], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const closed = once(child, 'close'); let db: ReturnType<typeof openDatabase> | undefined;
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await closed; db?.close(); rmSync(dir, { recursive: true }); });
  const lines = createInterface({ input: child.stdout });
  const [message] = await Promise.race([once(lines, 'line', { signal: t.signal }), closed.then(() => { throw new Error('Crash fixture exited before intent'); })]);
  assert.equal(message, 'pending'); lines.close(); child.kill(); await closed;
  db = openDatabase(dir); let calls = 0;
  const service = createPreparationService(db, { profile: async () => { calls++; return profile; }, judge: async () => [] });
  const saved = db.readPreparation('local')!;
  const result = await service.action('local', 'profile', new URLSearchParams({ preparationRevision: String(saved.revision), aiConsent: 'yes' }), 'Restart');
  assert.equal(result.status, 200); assert.equal(calls, 0); assert.equal(db.readRuns('local')[0].attempts[0].status, 'pending');
});
test('E1: ограниченный live-сценарий локально допускает не более 1 profile + 2 Wordstat + 1 judge', async t => {
  const x = fixture(t, false); let profiles = 0, requests = 0, judgments = 0;
  const adapters = limitAcceptance(x.db(), { profile: async () => { profiles++; return structuredClone(profile); }, judge: async (_draft,p,candidates) => {
    judgments++; return candidates.map(c=>({id:c.id,offerId:p.offers[0].id,decision:'include',intent:'purchase',brand:'none',brandTerm:null,adRelevant:true,reason:'Fixture.'}));
  } }, async () => { requests++; return [{phrase:'ремонт холодильников',count:'20'}]; });
  const service = createPreparationService(x.db(), adapters.ai, adapters.wordstat, async () => [{GeoRegionId:'54',GeoRegionName:'Екатеринбург'},{GeoRegionId:'6',GeoRegionName:'Калуга'}]);
  const act = (action, values={}) => service.action('local',action,new URLSearchParams({preparationRevision:String(service.view('local').saved.revision),...values}),'Limit fixture');
  await act('entry',input); await act('profile',{aiConsent:'yes'}); await act('confirm-profile',profileForm);
  await act('research',{researchConsent:'yes',judgeConsent:'yes'}); assert.deepEqual([profiles,requests,judgments],[1,2,1]);
  await act('save',{title:'Мастер по холодильникам'}); await act('research',{researchConsent:'yes',judgeConsent:'yes'});
  assert.deepEqual([profiles,requests,judgments],[1,2,1]);
  await act('save',{region:'Калуга'}); await act('research',{researchConsent:'yes',judgeConsent:'yes'});
  assert.deepEqual([profiles,requests,judgments],[1,2,1]);
  await act('save',{description:input.description+' Только вымышленные данные.'}); await act('profile',{aiConsent:'yes'});
  assert.deepEqual([profiles,requests,judgments],[1,2,1]);
});
