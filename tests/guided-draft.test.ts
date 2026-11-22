import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { assessmentAnchor } from '../src/operations-links.ts';
import { confirmedOffDraft } from '../src/direct.ts';
import { campaignHeaderContext } from '../src/campaign-navigation.ts';
import { renderDraftReadiness } from '../src/draft-readiness.ts';
import { geoSnapshot } from '../src/cached-research.ts';
import { newStrategyPlan } from '../src/phrase-strategy.ts';
import { policyHash } from '../src/phrase-policy.ts';
import { createApp } from '../src/server.ts';
import { callbackPath, createYandexAuth } from '../src/yandex-auth.ts';
import type { PhraseIntelligence } from '../src/phrase-intelligence.ts';
import { validateWording } from '../src/phrase-intelligence.ts';
import { e2Fixture } from './fixtures/e2.ts';

const description = 'Ремонт холодильников на дому. Принимаем заявки на сайте.';
const variants = { variants: [
  { title: 'Ремонт холодильников', adText: 'Ремонт холодильников на дому.', evidence: ['Ремонт холодильников на дому.'] },
  { title: 'Мастер по холодильникам на дом', adText: 'Оставьте заявку на сайте.', evidence: [description] },
] };
const required = (page: string, name: string) => page.match(new RegExp(`name="${name}" value="([^"]*)"`))![1];

test('варианты ИИ сохраняют отрицания, контекст чисел и различаются текстом', () => {
  const offer = 'Бесплатно диагностику не проводим. Ремонт от 1500 ₽. Выезд стоит 300 ₽.';
  assert.equal(validateWording(variants, description).length, 2);
  assert.throws(() => validateWording({ variants: [
    { title: 'Бесплатная диагностика', adText: 'Оставьте заявку.', evidence: ['Бесплатно диагностику'] },
    { title: 'Ремонт на дому', adText: 'Выезд стоит 300 ₽.', evidence: ['Выезд стоит 300 ₽.'] },
  ] }, offer), /проверяемыми/);
  assert.throws(() => validateWording({ variants: [
    { title: 'Ремонт за 300 ₽', adText: 'Оставьте заявку.', evidence: ['Ремонт от 1500 ₽. Выезд стоит 300 ₽.'] },
    { title: 'Ремонт на дому', adText: 'Выезд стоит 300 ₽.', evidence: ['Выезд стоит 300 ₽.'] },
  ] }, offer), /проверяемыми/);
});

async function fixture(t: TestContext, wording: PhraseIntelligence['wording'], beforeDirect?: (url: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'guided-draft-'));
  const direct = e2Fixture(directory, { transport: async (url, init) => {
    await beforeDirect?.(String(url));
    return direct.provider(url, init);
  } });
  const { db, manager, owner, a, b, plan } = direct;
  const auth = createYandexAuth(db, 'fixture-login', 'fixture-login-secret', {
    requestJson: async (url, init) => String(url).includes('/token')
      ? Response.json({ access_token: (init!.body as URLSearchParams).get('code'), expires_in: 3600 })
      : Response.json({ id: new Headers(init?.headers).get('Authorization')?.endsWith(' b') ? '202' : '101', client_id: 'fixture-login', display_name: 'Владелец' }),
  });
  const intelligence: PhraseIntelligence = { wording, async explainOptimization() { return { order: ['finding', 'cost', 'target', 'report'] }; }, async profile() { throw new Error('unexpected profile'); }, async judge() { throw new Error('unexpected judge'); } };
  const server = createApp(db, auth, undefined, undefined, undefined, undefined, intelligence, undefined, {}, manager, undefined, who => who === owner);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  function get(path: string, cookie = '') {
    return fetch(origin + path, { headers: { Cookie: cookie }, redirect: 'manual', signal: t.signal });
  }
  function post(path: string, values: Record<string, string>, cookie: string) {
    return fetch(origin + path, { method: 'POST', redirect: 'manual', signal: t.signal, headers: { Cookie: cookie, Origin: origin }, body: new URLSearchParams(values) });
  }
  async function login(who: 'a' | 'b') {
    const start = await get('/auth/yandex');
    assert.equal(start.status, 303);
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const done = await get(`${callbackPath}?state=${state}&code=${who}`, start.headers.getSetCookie()[0].split(';')[0]);
    assert.equal(done.headers.get('location'), '/');
    return done.headers.getSetCookie().find(row => row.startsWith('goulash_session='))!.split(';')[0];
  }
  const prep = (id: string, who = owner) => db.readPreparation(who, id)!;
  async function start(c: string, name: string, id = owner) {
    const created = await post('/campaign/new', { flow: 'guided' }, c);
    const path = created.headers.get('location')!;
    assert.match(path, /^\/prepare\?ad=/);
    const ad = new URL(path, origin).searchParams.get('ad')!;
    const rev = () => ({ ad, policyHash, preparationRevision: String(prep(ad, id).revision) });
    const prepared = await post('/preparation/confirm-profile', {
      ...rev(), campaignName: name, description, region: 'Калуга', url: 'https://example.com/book', goal: 'Оставить заявку',
      editorVersion: '3', profileEditor: 'yes', offer0: 'Ремонт холодильников',
    }, c);
    assert.equal(prepared.status, 303, await prepared.text());
    return { path, ad, rev };
  }
  async function connect(c: string, ad: string) {
    const path = '/connections/direct', suffix = '?ad=' + ad;
    const begin = await post(path + '/start' + suffix, {}, c);
    assert.equal(begin.status, 303);
    const cookies = c + '; ' + begin.headers.getSetCookie()[0].split(';')[0];
    let page = await (await get(path + suffix, cookies)).text();
    const finish = await post(path + '/finish' + suffix, {
      attemptId: required(page, 'attemptId'), nonce: required(page, 'nonce'), code: 'a',
    }, cookies);
    assert.equal(finish.status, 303, await finish.text());
    page = await (await get(path + suffix, cookies)).text();
    return post(path + '/activate' + suffix, { candidateId: required(page, 'candidateId'), confirm: 'yes' }, cookies);
  }
  return { db, owner, a, b, plan, get, post, login, prep, start, connect };
}

test('пример заполняет предложение для плана и сохраняет ручное объявление', async t => {
  const x = await fixture(t, undefined);
  const cookie = await x.login('a');
  const { ad, path, rev } = await x.start(cookie, 'Произвольное название');
  const wording = { title: 'Мой заголовок', adText: 'Мой текст объявления.' };
  assert.equal((await x.post('/preparation/save', { ...rev(), ...wording }, cookie)).status, 303);
  assert.equal((await x.post('/preparation/example', rev(), cookie)).status, 303);

  const html = await (await x.get(path, cookie)).text();
  assert.match(html, /name="offer0"[^>]*value="Суши и роллы"/);
  const { profile, campaignName, input, goal } = x.prep(ad).value;
  const [offer] = profile!.value.offers;
  const confirmed = await x.post('/preparation/confirm-profile', {
    ...rev(), ...input, campaignName: campaignName!, goal, editorVersion: '3', profileEditor: 'yes',
    offer0: offer.name, offerId0: offer.id, kind0: offer.kind, delivery0: 'yes', evidence0: offer.evidence, seeds0: offer.seeds.join('\n'),
  }, cookie);
  assert.equal(confirmed.status, 303, await confirmed.text());
  assert.equal(x.prep(ad).value.step, 3);
  assert.equal(x.prep(ad).value.input.title, wording.title);
  assert.equal(x.prep(ad).value.input.adText, wording.adText);
  assert.equal(x.a.writes().length, 0);
});

test('короткое предложение используется в ручном плане без повторного ввода', async t => {
  const x = await fixture(t, undefined);
  const cookie = await x.login('a');
  const created = await x.post('/campaign/new', { flow: 'guided' }, cookie);
  const path = created.headers.get('location')!;
  const ad = new URL(path, 'http://127.0.0.1').searchParams.get('ad')!;
  const fields = { ad, policyHash, preparationRevision: String(x.prep(ad).revision), campaignName: 'Услуги в Калуге',
    description: 'Ремонт холодильников. Оставьте заявку на сайте.', url: 'https://example.com/book',
    region: 'Калуга', goal: 'Оставить заявку', editorVersion: '3', profileEditor: 'yes', offer0: '' };
  const bad = await x.post('/preparation/confirm-profile', { ...fields, description: 'Только ремонт холодильников по отдельному согласованию' }, cookie);
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /class="business-profile" open/);
  const done = await x.post('/preparation/confirm-profile', fields, cookie);
  assert.equal(done.status, 303, done.status === 303 ? undefined : await done.text());
  const saved = x.prep(ad).value;
  assert.equal(saved.step, 3);
  assert.equal(saved.profile?.value.offers[0].name, 'Ремонт холодильников');
  assert.deepEqual(saved.profile?.value.offers[0].seeds, ['ремонт холодильников']);
  const plan = await (await x.get(path, cookie)).text();
  assert.ok(plan.indexOf('id="plan-title"') < plan.indexOf('Предпросмотр объявления'));
  assert.ok(plan.indexOf('Предпросмотр объявления') < plan.indexOf('Фразы для показа'));
  assert.ok(plan.indexOf('Фразы для показа') < plan.indexOf('Подтвердить план и проверить готовность'));
});

test('новый кабинет: OAuth, выбор текста и бюджет, возврат из подключения, только один подтверждённый DRAFT/OFF', async t => {
  let llm = 0;
  let holdAccountCheck: (() => Promise<void>) | undefined;
  const x = await fixture(t, async input => {
    assert.equal(input, description);
    llm++;
    return variants;
  }, async url => {
    if (url.endsWith('/clients')) await holdAccountCheck?.();
  });
  x.plan();
  const legacy = x.prep('default');
  const alice = await x.login('a'), bob = await x.login('b');
  assert.match(await (await x.get('/', alice)).text(), /Рабочий стол/);
  const { path, ad, rev } = await x.start(alice, 'Ремонт в Калуге');
  assert.equal(x.prep(ad).value.campaignName, 'Ремонт в Калуге');
  assert.deepEqual(x.prep('default'), legacy);
  assert.equal((await x.get(path, bob)).status, 404);
  assert.equal((await x.post('/preparation/wording', { ...rev(), wordingConsent: 'yes' }, bob)).status, 404);
  const foreign = await x.start(bob, 'Другой владелец', 'yandex:202');
  assert.equal((await x.post('/preparation/wording', { ...foreign.rev(), wordingConsent: 'yes' }, bob)).status, 403);
  assert.equal(llm, 0);
  const generated = await x.post('/preparation/wording', { ...rev(), wordingConsent: 'yes' }, alice);
  assert.equal(generated.status, 303, await generated.text());
  let page = await (await x.get(path, alice)).text();
  assert.match(page, /Исходные факты/);
  assert.match(page, /Использовать вариант 2/);
  assert.equal((await x.post('/preparation/use-wording', { ...rev(), wordingRun: required(page, 'wordingRun'), variant: '1' }, alice)).status, 303);
  assert.equal(x.prep(ad).value.input.title, variants.variants[1].title);
  assert.equal(llm, 1);
  const review = { ...rev(), budget: '7000', period: '7', selectionEditor: 'yes', phrases: 'ремонт холодильников, мастер по холодильникам',
    negatives: 'вакансии, обучение мастеров\r\nчертежи', manualReview: 'yes' };
  assert.equal((await x.post('/preparation/offer', { ...review, budget: '349' }, alice)).status, 400);
  const ready = await x.post('/preparation/offer', review, alice);
  assert.equal(ready.status, 303, await ready.text());
  assert.deepEqual(x.prep(ad).value.selection.phrases, ['ремонт холодильников', 'мастер по холодильникам']);
  assert.deepEqual(x.prep(ad).value.selection.negatives, ['вакансии', 'обучение мастеров', 'чертежи']);
  page = await (await x.get(path, alice)).text();
  assert.match(page, /Бюджет стратегии без НДС/);
  assert.match(page, /Подключить Директ/);
  assert.doesNotMatch(page, /action="\/prepare\/create"/);
  assert.doesNotMatch(await (await x.get('/', alice)).text(), /Черновик в Директе · показы выключены/);

  const activate = await x.connect(alice, ad);
  assert.equal(activate.headers.get('location'), path);
  page = await (await x.get(path, alice)).text();
  const command = {
    campaignId: ad, campaignPlanId: required(page, 'campaignPlanId'), preparationRevision: required(page, 'preparationRevision'),
    account: required(page, 'account'), generation: required(page, 'generation'), confirm: 'yes',
  };
  assert.equal((await x.post('/prepare/create', { ...command, account: '20202' }, alice)).status, 409);
  assert.equal(x.a.writes().length, 0);
  x.a.fault('campaigns/add', 'after');
  const reserved = Promise.withResolvers<void>(), proceed = Promise.withResolvers<void>();
  holdAccountCheck = async () => {
    if (!x.db.readCampaignDirectRuns(x.owner, ad).length) return;
    holdAccountCheck = undefined;
    reserved.resolve();
    await proceed.promise;
  };
  const creating = x.post('/prepare/create', command, alice);
  await reserved.promise;
  try {
    assert.equal((await x.post('/prepare/create', command, alice)).status, 409);
    assert.equal((await x.post('/preparation/save', { ...rev(), campaignName: 'Подмена', region: 'Москва' }, alice)).status, 409);
    assert.equal(x.prep(ad).value.campaignName, 'Ремонт в Калуге');
    assert.equal(x.a.writes().length, 0);
  } finally {
    proceed.resolve();
  }
  const interrupted = await creating;
  assert.equal(interrupted.status, 409);
  assert.equal(x.a.writes().length, 1, (await interrupted.text()).match(/role="alert"[^>]*><p>([^<]+)/)?.[1]);
  page = await (await x.get(path, alice)).text();
  assert.match(page, /Требуется сверка в Директе/);
  assert.match(page, /id="direct"[\s\S]*?action="\/prepare\/refresh"[\s\S]*?id="campaign-settings"/);
  assert.doesNotMatch(page, /action="\/prepare\/(create|continue)"/);
  assert.equal((await x.post('/prepare/create', command, alice)).status, 409);
  const planId = required(page, 'planId');
  assert.equal((await x.post('/prepare/refresh', { ...command, planId }, alice)).status, 303);
  assert.equal(x.a.writes().length, 1);
  page = await (await x.get(path, alice)).text();
  assert.match(page, /Можно продолжить создание/);
  let continuation = { ...command, planId, storageRevision: required(page, 'storageRevision') };
  x.a.fault('keywords/add', 'item', 3); // Targeting and the first phrase succeed, the second is rejected.
  assert.equal((await x.post('/prepare/continue', continuation, alice)).status, 409);
  const beforeRefresh = x.a.writes().length;
  assert.equal((await x.post('/prepare/refresh', { ...command, planId }, alice)).status, 303);
  assert.equal(x.a.writes().length, beforeRefresh);
  page = await (await x.get(path, alice)).text();
  assert.match(page, /Можно продолжить создание/);
  continuation = { ...continuation, storageRevision: required(page, 'storageRevision') };
  const resumed = await x.post('/prepare/continue', continuation, alice);
  assert.equal(resumed.status, 303, await resumed.text());
  const writes = x.a.writes();
  assert.deepEqual(writes.map(call => call.resource + '/' + call.method),
    ['campaigns/add', 'adgroups/add', 'keywords/add', 'keywords/add', 'keywords/add', 'keywords/add', 'ads/add']);
  assert.equal(writes.filter(call => call.params.Keywords?.[0]?.Keyword === 'ремонт холодильников').length, 1);
  const run = x.db.readCampaignDirectRuns(x.owner, ad)[0];
  assert.ok(confirmedOffDraft(run));
  const moderated = structuredClone(run), prepared = x.db.readPreparation(x.owner, ad)!.value;
  moderated.snapshot!.ad.Status = 'REJECTED';
  moderated.checkedAt = '2026-11-20T16:00:00.000Z';
  moderated.launch = { history: [], observation: { campaignStatus: 'ACCEPTED', campaignState: 'ON', adStatus: 'ACCEPTED',
    checkedAt: '2026-11-20T16:01:00.000Z' } };
  assert.equal(campaignHeaderContext(ad, 'summary', prepared, moderated, 'fixture').status, 'Показы разрешены');
  const visibleSummary = renderDraftReadiness({ saved: x.prep(ad), current: true, runs: [] },
    { enabled: true, ownChief: true, mode: 'fixture', account: run.account, generation: 1, runs: [moderated] }, ad);
  assert.match(visibleSummary, /<h3 class="campaign-status-title">Показы разрешены Директом<\/h3>/);
  assert.doesNotMatch(visibleSummary, /Показы выключены/);
  moderated.checkedAt = '2026-11-20T16:02:00.000Z';
  assert.equal(campaignHeaderContext(ad, 'ads', prepared, moderated, 'fixture').status, 'Объявление отклонено');
  assert.match(run.name, /^Ремонт в Калуге \[/);
  assert.equal(run.budget?.amountRub, '7000');
  page = await (await x.get(path, alice)).text();
  assert.match(page, /Кампания и объявление проверены в Директе/);
  assert.equal((page.match(/DRAFT \/ OFF/g) ?? []).length, 2);
  assert.match(page, /0 \/ 0/);
  assert.equal((await x.post('/prepare/create', command, alice)).status, 303);
  assert.equal(x.a.writes().length, writes.length);
  const adsPath = path + '&tab=ads', resultsPath = '/results?ad=' + ad, journalPath = '/history?ad=' + ad;
  for (const [tab, key] of [[path, 'summary'], [adsPath, 'ads'], [resultsPath, 'results'], [journalPath, 'journal']]) {
    const response = await x.get(tab, alice);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<h1>Ремонт в Калуге<\/h1>/);
    assert.match(html, /class="campaign-context">\s*<span class="chip chip-draft"><span class="dot" aria-hidden="true"><\/span>Черновик<\/span><span>Калуга<\/span>\s*<span>Учебные данные<\/span>/);
    assert.equal((html.match(/aria-label="Кампания"/g) ?? []).length, 1);
    assert.equal((html.match(/class="campaign-workspace"/g) ?? []).length, 1);
    assert.ok(html.includes(`<section data-campaign-panel aria-labelledby="campaign-tab-${key}"`));
    assert.equal((await x.get(tab, bob)).status, 404);
  }
  const other = await x.start(alice, 'Соседняя кампания');
  assert.ok(x.db.saveCampaign(x.owner, { ...run.draft, title: 'Посторонняя запись' }, 0, 'Посторонняя запись', undefined, other.ad));
  const otherOperation = x.db.readHistory(x.owner, other.ad)[0];
  assert.equal((await x.get(journalPath + '&review=' + otherOperation.id, alice)).status, 404);
  assert.equal((await x.post('/operations/undo?ad=' + ad, { id: otherOperation.id, confirm: 'undo' }, alice)).status, 404);
  assert.doesNotMatch(await (await x.get(journalPath, alice)).text(), /Посторонняя запись/);
  let results = await (await x.get(resultsPath, alice)).text();
  assert.match(results, /<h2>Результаты<\/h2>/);
  assert.match(results, /name="customFrom" type="text"[^>]+placeholder="ДД\.ММ\.ГГГГ"/);
  assert.match(results, /class="period-dash"[^>]*>—<\/span>/);
  assert.doesNotMatch(results, /<summary[^>]*>Свой период/);
  assert.doesNotMatch(results, /value="metrika_site"/);
  assert.match(results, new RegExp('action="/analytics/settings\\?ad=' + ad + '"'));
  const analyticsFields = { revision: required(results, 'revision'), directRunId: run.planId, days: '7' };
  assert.equal((await x.post('/analytics/settings?ad=' + ad, { ...analyticsFields, directRunId: randomUUID() }, alice)).status, 404);
  assert.equal((await x.post('/analytics/refresh?ad=' + ad, { source: 'direct_reports' }, alice)).status, 404);
  const filters = await x.post('/analytics/settings?ad=' + ad, analyticsFields, alice);
  assert.equal(filters.status, 303, await filters.text());
  assert.equal(filters.headers.get('location'), resultsPath + '&filters=applied&run=' + run.planId);
  assert.equal((await x.get('/results?run=' + run.planId, alice)).status, 200);
  results = await (await x.get(resultsPath, alice)).text();
  assert.match(results, /Отчёт за период/);
  const periodTo = required(results, 'dateTo');
  const customFrom = new Date(Date.parse(periodTo) - 2 * 86400000).toISOString().slice(0, 10).split('-').reverse().join('.');
  const customTo = periodTo.split('-').reverse().join('.');
  const customFields = { revision: required(results, 'revision'), directRunId: run.planId, period: 'custom', customFrom, customTo };
  const badPeriod = await x.post('/analytics/settings?ad=' + ad, { ...customFields, customFrom: '31.02.2026' }, alice);
  assert.equal(badPeriod.status, 409);
  assert.match(await badPeriod.text(), /name="customFrom" type="text" value="31\.02\.2026"[^>]+aria-invalid="true"/);
  const customPeriod = await x.post('/analytics/settings?ad=' + ad, customFields, alice);
  assert.equal(customPeriod.status, 303);
  assert.match(await (await x.get(resultsPath, alice)).text(), new RegExp('name="customFrom" type="text" value="' + customFrom.replaceAll('.', '\\.') + '"'));
  const ads = await (await x.get(adsPath, alice)).text();
  assert.doesNotMatch(ads, /Изменить название в Директе/);
  const summary = await (await x.get(path, alice)).text();
  assert.match(summary, /Переименовать кампанию/);
  assert.match(summary, /Изменить название в Директе/);
  assert.match(summary, /data-copy-target="direct-campaign-number"/);
  const renaming = { planId, campaignId: ad, storageRevision: required(summary, 'storageRevision'),
    before: required(summary, 'before'), name: 'Черновик после переименования', confirm: 'yes' };
  const renamed = await x.post('/direct/rename', renaming, alice);
  assert.equal(renamed.status, 303, await renamed.text());
  assert.equal(renamed.headers.get('location'), path);
  assert.match(await (await x.get(path, alice)).text(), /<h1>Черновик после переименования<\/h1>/);
  assert.match(await (await x.get(resultsPath, alice)).text(), /<h1>Черновик после переименования<\/h1>/);
  assert.equal(x.db.readCampaignDirectRuns(x.owner, ad)[0].snapshot?.campaign?.Name, renaming.name);
  const journal = await (await x.get(journalPath + '&by=mine', alice)).text();
  assert.match(journal, /Отменить изменение в Директе/);
  assert.match(journal, /Решение сервиса/);
  assert.match(journal, /<summary>Квитанция и изменения<\/summary>/);
  assert.doesNotMatch(journal, /Как работает отмена/);
  assert.doesNotMatch(journal, /Посторонняя запись/);
  const original = required(journal, 'id');
  const global = await (await x.get('/history?scope=draft&by=mine', alice)).text();
  const stale = await x.post('/direct/undo', { journal: required(global, 'journal'), scope: required(global, 'scope'), by: required(global, 'by'),
    planId, campaignId: ad, storageRevision: '0', id: original, confirm: 'yes' }, alice);
  assert.equal(stale.status, 409);
  assert.ok((await stale.text()).includes('href="/history?scope=draft&amp;by=mine#direct-event-' + original + '"'));
  const undone = await x.post('/direct/undo', {
    planId, campaignId: ad, by: required(journal, 'by'), storageRevision: required(journal, 'storageRevision'), id: required(journal, 'id'), confirm: 'yes',
  }, alice);
  assert.equal(undone.status, 303, await undone.text());
  const restored = x.db.readCampaignDirectRuns(x.owner, ad)[0];
  const undoAnchor = 'direct-event-' + restored.events.at(-1)!.id;
  assert.equal(undone.headers.get('location'), journalPath + '&by=mine#' + undoAnchor);
  assert.ok((await (await x.get(undone.headers.get('location')!, alice)).text()).includes('id="' + undoAnchor + '"'));
  assert.equal(restored.snapshot?.campaign?.Name, renaming.before);
  assert.ok(confirmedOffDraft(restored));
  assert.equal(x.a.writes().length, writes.length + 2);
  x.a.fault('campaigns/update', 'after');
  const pending = await x.post('/direct/rename', { ...renaming, storageRevision: String(restored.storageRevision), name: 'Переименован после обрыва' }, alice);
  assert.equal(pending.status, 409);
  assert.match(await pending.text(), /Переименован после обрыва|сверьте результат|Журнал/);
  assert.equal(x.db.readCampaignDirectRuns(x.owner, ad)[0].events.at(-1)?.phase, 'pending');
  const refreshed = await x.post('/prepare/refresh', { ...command, planId }, alice);
  assert.equal(refreshed.status, 303, await refreshed.text());
  const recovered = x.db.readCampaignDirectRuns(x.owner, ad)[0];
  assert.equal(recovered.events.at(-1)?.phase, 'confirmed');
  assert.equal(recovered.snapshot?.campaign?.Name, 'Переименован после обрыва');
  assert.equal(x.a.writes().length, writes.length + 3);
  x.a.records.ads[0].State = 'SUSPENDED';
  assert.equal((await x.post('/prepare/refresh', { ...command, planId }, alice)).status, 409);
  page = await (await x.get(path, alice)).text();
  assert.match(page, /DRAFT \/ SUSPENDED/);
  assert.doesNotMatch(page, /Кампания и объявление проверены в Директе/);
  assert.match(page, /class="chip chip-review"><span class="dot" aria-hidden="true"><\/span>Требуется сверка/);
  assert.equal(x.a.writes().length, writes.length + 3);
  assert.equal(x.b.writes().length, 0);
  const active = x.db.readDirect(x.owner, planId)!;
  const decision = { key: 'filtered-assessment', at: new Date().toISOString(), actor: 'Goulash', kind: 'assessment' as const,
    reason: 'Сравнение цены', report: 'Учебный отчёт', cpaKop: 6000, targetKop: 8000 };
  active.optimization = { enabled: false, decisions: [decision] };
  x.db.saveDirect(x.owner, active);
  const scopedResults = await (await x.get(journalPath + '&by=goulash', alice)).text();
  const explanationForm = scopedResults.match(/<form method="post" action="[^"]*explain-optimization[^"]*">[\s\S]*?<\/form>/)![0];
  const values = Object.fromEntries(['run', 'revision', 'decision', 'at', 'by'].map(name => [name, required(explanationForm, name)]));
  const endpoint = '/campaign/explain-optimization?ad=' + ad;
  const anchor = assessmentAnchor(planId, decision.key, decision.at);
  assert.ok(scopedResults.includes('id="' + anchor + '"'));
  const failure = await x.post(endpoint, values, alice);
  assert.equal(failure.status, 409);
  assert.ok((await failure.text()).includes('href="' + journalPath + '&amp;by=goulash#' + anchor + '"'));
  const explanation = await x.post(endpoint, { ...values, confirm: 'yes' }, alice);
  assert.equal(explanation.status, 303);
  assert.equal(explanation.headers.get('location'), journalPath + '&by=goulash#' + anchor);
  assert.ok((await (await x.get(explanation.headers.get('location')!, alice)).text()).includes('id="' + anchor + '"'));
  const connectionPage = await (await x.get('/connections/direct?ad=' + ad, alice)).text();
  const disconnected = await x.post('/connections/direct/disconnect?ad=' + ad, {
    account: run.account, generation: required(connectionPage, 'generation'),
    disconnectProof: required(connectionPage, 'disconnectProof'), confirm: 'disconnect',
  }, alice);
  assert.equal(disconnected.status, 303, await disconnected.text());
  for (const tab of [path, adsPath, resultsPath, journalPath]) {
    assert.match(await (await x.get(tab, alice)).text(), /class="campaign-context">[\s\S]*<span>Учебные данные<\/span>/);
  }
});

test('сверка отменяет только доказанно неотправленные шаги после обрыва; ручная география сверяется по текущему городу', async t => {
  const x = await fixture(t, undefined);
  const alice = await x.login('a');
  const { ad, path, rev } = await x.start(alice, 'Калуга');
  const saved = x.prep(ad);
  const oldInput = { ...saved.value.input, region: 'Москва' };
  const old = newStrategyPlan(oldInput, 0);
  old.regionId = '213';
  const id = randomUUID();
  x.db.savePreparation(x.owner, { ...saved.value, activeRunId: id }, saved.revision, {
    id, key: 'old-moscow-research', kind: 'research', input: oldInput, profileHash: 'old-report', status: 'complete',
    plan: old, attempts: [], geoSnapshot: geoSnapshot([
      { GeoRegionId: '213', GeoRegionName: 'Москва', GeoRegionType: 'City' },
      { GeoRegionId: '6', GeoRegionName: 'Калуга', GeoRegionType: 'City' },
    ]),
  }, 0, ad);
  const review = { ...rev(), budget: '1000', period: '7', phrases: 'ремонт холодильников в Калуге', manualReview: 'yes' };
  assert.equal((await x.post('/preparation/offer', { ...review, phrases: 'ремонт холодильников в городе Москве' }, alice)).status, 409);
  const confirm = await x.post('/preparation/offer', review, alice);
  assert.equal(confirm.status, 303, await confirm.text());
  assert.equal(x.db.readPlan(x.owner, x.prep(ad).value.confirmedPlanId, ad)?.targeting.regionId, undefined);
  await x.connect(alice, ad);
  let page = await (await x.get(path, alice)).text();
  const command = {
    campaignId: ad, campaignPlanId: required(page, 'campaignPlanId'), preparationRevision: required(page, 'preparationRevision'),
    account: required(page, 'account'), generation: required(page, 'generation'), confirm: 'yes',
  };
  x.a.fault('campaigns/get', 'before');
  assert.equal((await x.post('/prepare/create', command, alice)).status, 409);
  assert.equal(x.a.writes().length, 0);
  let run = x.db.readCampaignDirectRuns(x.owner, ad)[0];
  const refresh = { ...command, planId: run.planId };
  run.steps.campaign.phase = 'pending';
  run.events[0].phase = 'pending';
  x.db.saveDirect(x.owner, run);
  assert.equal((await x.post('/prepare/refresh', refresh, alice)).status, 303);
  run = x.db.readDirect(x.owner, run.planId)!;
  assert.equal(run.steps.campaign.phase, 'ready');
  assert.equal(run.safeToContinue, true);
  assert.equal(run.events[0].phase, 'rejected');
  run.steps.campaign.phase = 'pending';
  const attempt = { id: randomUUID(), stepKey: 'campaign', requestHash: 'fixture', resource: 'campaigns', method: 'add', at: new Date().toISOString(), outcome: 'pending' };
  run.attempts!.push(attempt);
  x.db.saveDirect(x.owner, run);
  assert.equal((await x.post('/prepare/refresh', refresh, alice)).status, 303);
  run = x.db.readDirect(x.owner, run.planId)!;
  assert.equal(run.attempts![0].outcome, 'not_sent');
  assert.equal(run.safeToContinue, true);
  run.steps.campaign.phase = 'pending';
  const sent = { ...attempt, id: randomUUID() };
  run.attempts!.push(sent);
  x.db.saveDirect(x.owner, run);
  x.db.recordDirectDispatch(sent.id, x.owner, run.planId, sent);
  assert.equal((await x.post('/prepare/refresh', refresh, alice)).status, 409);
  page = await (await x.get(path, alice)).text();
  assert.doesNotMatch(page, /action="\/prepare\/continue"/);
  assert.equal(x.db.readDirect(x.owner, run.planId)?.attempts?.at(-1)?.outcome, 'pending');
  assert.equal(x.a.writes().length, 0);
});

test('DeepSeek: намерение переживает параллельное сохранение и тайм-аут без повторной отправки', async t => {
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<never>();
  let calls = 0;
  const x = await fixture(t, async () => {
    calls++;
    entered.resolve();
    return response.promise;
  });
  const alice = await x.login('a');
  const { path, ad, rev } = await x.start(alice, 'Текст и ручное продолжение');
  const request = () => x.post('/preparation/wording', { ...rev(), wordingConsent: 'yes' }, alice);
  const first = request();
  await entered.promise;
  assert.equal(x.db.readRuns(x.owner, ad)[0].attempts[0].status, 'pending');
  assert.equal((await request()).status, 303);
  const save = await x.post('/preparation/offer', {
    ...rev(), title: 'Мой заголовок', adText: 'Мой текст объявления.', budget: '1000', period: '7',
    phrases: 'ремонт холодильников', manualReview: 'yes',
  }, alice);
  assert.equal(save.status, 303, await save.text());
  const version = x.prep(ad);
  response.reject(new DOMException('fixture deadline', 'TimeoutError'));
  assert.equal((await first).status, 502);
  assert.equal(x.db.readRuns(x.owner, ad)[0].attempts[0].status, 'unknown');
  assert.deepEqual(x.prep(ad), version);
  assert.match(await (await x.get(path, alice)).text(), /Проверьте готовность черновика/);
  assert.equal((await x.post('/preparation/back', { ...rev(), step: '3' }, alice)).status, 303);
  assert.equal((await request()).status, 303);
  assert.equal(calls, 1);
});
