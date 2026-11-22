import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { e3Fixture } from './fixtures/e3.ts';
import { e3Browser } from './fixtures/e3-browser.ts';
import { controlPlan } from './fixtures/e3-control.ts';
import { analyticsDates } from '../src/analytics.ts';
import { micros } from '../src/analytics-page.ts';
import { renderResults } from '../src/results-page.ts';
import { renderDemoSection } from '../src/demo-section.ts';

const displayDate = (value: string) => value.split('-').reverse().join('.');
const lastWindow = (days: number, now = Date.now()) => {
  const { dateTo } = analyticsDates(now);
  return { from: new Date(Date.parse(dateTo) - (days - 1) * 86400000).toISOString().slice(0, 10), to: dateTo };
};

const outsideDetails = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, '');
const insideDetails = (html: string) => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((match) => match[0]).join('');
const metricsBlock = (html: string) => html.match(/<div class="metrics-three">[\s\S]*?<\/div>\s*<p class="metric-line"/)![0];

test('созданная до guided кампания открывается в четырёх вкладках со своими отчётами и журналом', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-created-workspace-'));
  const x = await e3Browser(directory);
  x.server.listen(0, '127.0.0.1');
  await once(x.server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => x.server.close(() => resolve()));
    x.db.close();
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  });
  const address = x.server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const login = async (who: string) => (await fetch(origin + '/fixture-login/' + who, { redirect: 'manual' })).headers.getSetCookie()[0].split(';')[0];
  const cookie = await login('a');
  const get = (path: string, Cookie = cookie) => fetch(origin + path, { redirect: 'manual', headers: { Cookie } });
  const run = x.db.readDirect(x.owner)!;
  assert.ok(run.complete && !run.guidedDraft);
  const ad = run.campaignId ?? 'default';
  const summary = '/prepare?ad=' + ad;
  const results = '/results?ad=' + ad;
  const journal = '/history?ad=' + ad;
  const previous = x.db.readAnalyticsSettings(x.owner);
  x.analytics.save(x.owner, new URLSearchParams({
    revision: String(previous.revision), directRunId: run.planId, dateFrom: previous.dateFrom, dateTo: previous.dateTo,
  }));
  await x.analytics.refresh(x.owner, 'direct_reports');
  const calls = x.calls.length;
  const list = await (await get('/campaigns')).text();
  assert.ok(list.includes(`href="${summary}"`));
  assert.ok(list.includes(`href="${results}&run=${run.planId}"`));
  const redirect = await get('/campaigns?ad=' + ad);
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), summary);

  const pages = [[summary, 'summary', /Условия кампании/],
    [summary + '&tab=ads', 'ads', /Предпросмотр/],
    [results + '&run=' + run.planId, 'results', /Отчёт за период/],
    [journal, 'journal', /Решение сервиса/]] as const;
  for (const [path, tab, content] of pages) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(`data-campaign-panel aria-labelledby="campaign-tab-${tab}"`));
    assert.equal((html.match(/id="campaign-tab-/g) ?? []).length, 4);
    assert.match(html, content);
    assert.doesNotMatch(html, /<h2>Проверить и запустить<\/h2>/);
    if (tab === 'results') {
      assert.equal((html.match(/placeholder="ДД\.ММ\.ГГГГ"/g) ?? []).length, 2);
      assert.match(html, /<section id="real-analytics"/);
      assert.match(html, /<dt>Расход<\/dt><dd>0,00\s₽/);
      assert.doesNotMatch(html, /Учебный перенос бюджета/);
    }
    if (tab === 'journal') assert.match(html, /Квитанция Директа/);
  }
  assert.equal(x.calls.length, calls);
  assert.equal((await get(journal, await login('b'))).status, 404);
  const settings = x.db.readAnalyticsSettings(x.owner);
  const date = lastWindow(5);
  const saved = await fetch(origin + '/analytics/settings?ad=' + ad, {
    method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ revision: String(settings.revision), directRunId: run.planId, dateFrom: displayDate(date.from), dateTo: displayDate(date.to) }),
  });
  assert.equal(saved.status, 303);
  assert.equal(x.db.readAnalyticsSettings(x.owner).campaignAnalytics?.[ad]?.dateFrom, date.from);
  assert.equal(x.db.readAnalyticsSettings(x.owner).dateFrom, settings.dateFrom);
  assert.equal(x.calls.length, calls);
});

async function measured(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-results-'));
  const x = await e3Fixture(directory);
  t.after(() => { x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  await x.analytics.counter(x.owner, '11001001', 0);
  const settings = x.db.readAnalyticsSettings(x.owner);
  x.analytics.save(x.owner, new URLSearchParams({
    revision: String(settings.revision), directRunId: x.db.readDirect(x.owner)!.planId,
    goalId: '21001001', dateFrom: settings.dateFrom, dateTo: settings.dateTo,
  }));
  for (const source of ['direct_reports', 'metrika_site', 'metrika_direct'] as const) await x.analytics.refresh(x.owner, source);
  const direct = x.db.readAnalyticsReports(x.owner).find((report) => report.source === 'direct_reports' && report.status === 'ready')!;
  return { ...x, view: x.analytics.view(x.owner), spend: micros(direct.result!.rows![0].costMicros) };
}

test('«Результаты»: расход, достижения и визиты, подтверждённые настройки, номера только в раскрытии', async (t) => {
  const x = await measured(t);
  const previous = { ...x.view.currentReports[0], id: 'previous-report', status: 'superseded' as const };
  const html = renderResults({ ...x.view, reports: [...x.view.reports, previous] }, x.db.operationsView(x.owner));
  const numbers = metricsBlock(html);
  assert.match(numbers, new RegExp(`<dt>Расход</dt><dd>${x.spend.replace(' ', '\\s')}`));
  assert.match(numbers, /<dt>Достижения цели<\/dt><dd>6/);
  assert.match(numbers, /<dt>Стоимость достижения<\/dt><dd>233,33\s₽[\s\S]*За одно достижение · Метрика/);
  assert.ok(numbers.indexOf('<dt>Расход</dt>') < numbers.indexOf('<dt>Достижения цели</dt>'));
  assert.ok(numbers.indexOf('<dt>Достижения цели</dt>') < numbers.indexOf('<dt>Стоимость достижения</dt>'));
  assert.match(html, /<dt>Целевые визиты<\/dt><dd>5<\/dd>/);
  assert.match(html, /<dt>Подтверждённые клиенты<\/dt><dd>—<\/dd>/);
  assert.match(html, /Источник подтверждённых клиентов не подключён/);
  assert.match(html, /<dt>Цена заявки по расходу Директа<\/dt><dd>—<\/dd>/);
  assert.match(html, /сопоставимость кампании, периода, часового пояса, НДС, атрибуции и полноты отчётов/);
  assert.match(html, /Настройки Директа на [^<]+ — Поиск, РСЯ выключена/);
  assert.match(html, /Разбивка по объявлениям и площадкам недоступна/);

  // Keep the campaign-wide number explicit even when the plan has only one ad.
  const ads = html.match(/<h2 id="ads-title">Итог по кампании<\/h2>([\s\S]*?)<\/article>/)![1];
  const rows = ads.match(/<tbody>([\s\S]*?)<\/tbody>/)![1];
  assert.equal((rows.match(/<tr>/g) ?? []).length, 1, 'одна строка по кампании');
  assert.match(ads, /Кампания целиком/);
  assert.doesNotMatch(ads, /Группа|90001234/);

  // The learning example is a separate card below the real numbers and the sources.
  const demoAt = html.indexOf('Учебный перенос бюджета');
  assert.ok(demoAt > html.indexOf('Откуда данные'));
  assert.ok(demoAt > html.indexOf('id="real-analytics"'));
  assert.match(html, /Тестовые данные/);

  // Technical Direct numbers are disclosed, never part of the main flow.
  const run = x.db.readDirect(x.owner)!;
  const campaignId = run.steps.campaign.id!;
  const exactCampaignId = new RegExp(`(?<!\\d)${campaignId}(?!\\d)`);
  assert.match(insideDetails(html), exactCampaignId, 'номер кампании доступен в «Подробностях»');
  assert.doesNotMatch(outsideDetails(html), exactCampaignId, 'номера нет в основном потоке');
  const support = html.match(/<summary>Подробности и ограничения<\/summary>([\s\S]*?)<\/details>/)![1];
  assert.match(support, /Отчёт Директа получен по Москве/);
  assert.match(support, /НДС/);
  assert.match(support, /атрибуция last/);
  assert.match(support, /Смысл цели как бизнес-результата надо подтвердить/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1, 'один h1');
  assert.equal((html.match(/id="metrika-settings"/g) ?? []).length, 1);
  assert.match(html, /class="results-overview grid-2"[^>]*>[\s\S]*?<dt>Расход<\/dt>[\s\S]*?<h2>Бюджет<\/h2>[\s\S]*?<h2 id="refresh-title">Обновить данные<\/h2>[\s\S]*?id="metrika-settings"[\s\S]*?Подключена[\s\S]*?class="results-reports"/);
  assert.match(html, /<\/section><\/details>\s*<details class="card previous-reports"><summary>Предыдущие отчёты/);
  assert.doesNotMatch(html, /data-recovery|action="\/analytics\/(counter|disconnect)"/);
});

test('«Результаты»: ноль достижений, устаревший и семплированный отчёт не показывают цену цели', async (t) => {
  const x = await measured(t);
  const render = (edit: (report: typeof x.view.currentReports[number]) => typeof x.view.currentReports[number]) =>
    renderResults({ ...x.view, currentReports:x.view.currentReports.map(report=>report.source==='metrika_direct' ? edit(report) : report) });
  const zero = render(report=>({...report,result:{...report.result,metrics:{...report.result.metrics,reaches:0,goalVisits:0}}}));
  assert.match(zero, /<dt>Достижения цели<\/dt><dd>0/);
  assert.match(zero, /<dt>Целевые визиты<\/dt><dd>0/);
  assert.match(zero, /<dt>Подтверждённые клиенты<\/dt><dd>—/);
  const stale = render(report=>({...report,stale:true}));
  assert.match(stale, /Последний сохранённый отчёт Метрики|последний сохранённый отчёт Метрики/);
  const sampled = render(report=>({...report,result:{...report.result,sampled:true,sampleShare:0.2}}));
  for (const html of [zero,stale,sampled]) assert.match(metricsBlock(html), /<dt>Стоимость достижения<\/dt><dd><span class="metric-missing">/);
});

test('«Результаты»: отсутствующий источник не превращается в ноль', async (t) => {
  const x = await measured(t);
  const runs = x.view.runs.map(run => ({ ...run, budget: {
    kind: 'custom_period' as const, amountRub: '7000', spendLimitMicros: '7000000000', periodDays: '7',
    startDate: '2099-12-20', endDate: '2099-12-26', autoContinue: 'NO' as const,
  } }));
  const emptyView = { ...x.view, runs, currentReports: [], reports: [] };
  const empty = renderResults(emptyView);
  assert.doesNotMatch(empty, /class="metrics-three"|daily-bars|Итог по кампании/);
  assert.match(empty, /Данных за период пока нет/);
  assert.ok(empty.indexOf('Обновить данные') < empty.indexOf('id="metrika-settings"'));
  assert.match(empty, /Обновить данные[\s\S]*?<h2>Бюджет<\/h2>[\s\S]*?Учтённый расход/);
  assert.doesNotMatch(empty, /Лимит сохранён в черновике Директа|Первый день периода бюджета/);
  const live = renderResults({ ...emptyView, runs: runs.map(run => ({
    ...run, snapshot: { ...run.snapshot!, campaign: { ...run.snapshot?.campaign, State: 'ON', Status: 'ACCEPTED' } },
  })) });
  assert.match(live, /Лимит передан в Директ[\s\S]*?Первый день периода бюджета/);

  const directOnly = renderResults({ ...x.view, currentReports: x.view.currentReports.filter((report) => report.source === 'direct_reports') });
  const partial = metricsBlock(directOnly);
  assert.ok(partial.includes(x.spend), 'расход из Директа остаётся');
  assert.equal((partial.match(/metric-missing/g) ?? []).length, 2, 'без Метрики заявки и стоимость — прочерк');
});

test('учебный пример: редирект, ошибка рядом с карточкой, статус без перезагрузки, отмена', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-results-http-'));
  const x = await e3Browser(directory);
  t.after(async () => { await new Promise<void>((resolve) => x.server.close(() => resolve())); x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  x.server.listen(0, '127.0.0.1'); await once(x.server, 'listening');
  const origin = `http://127.0.0.1:${(x.server.address() as any).port}`;
  const login = await fetch(origin + '/fixture-login/a', { redirect: 'manual', signal: t.signal });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string, init: RequestInit = {}) => fetch(origin + path, { headers: { Cookie: cookie }, signal: t.signal, ...init });
  const post = (path: string, values: Record<string, string>) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: new URLSearchParams(values), redirect: 'manual', signal: t.signal });

  const redirect = await get('/automation', { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/results#demo');
  const page = await (await get('/results')).text();
  assert.equal((page.match(/<h1>/g) ?? []).length, 1);
  assert.match(page, /Учебный перенос бюджета/);
  assert.match(page, /Открыть готовый пример/);
  const noPlan = renderDemoSection({ history: [], plans: [] });
  assert.match(noPlan, /Открыть готовый пример/);
  assert.doesNotMatch(noPlan, /id="control-plan"|Перейти к кампаниям/);
  assert.doesNotMatch(page, /http-equiv="refresh"/, 'статус обновляется без перезагрузки страницы');

  const plan = controlPlan(x.db, x.owner);
  assert.equal((await post('/demo/load', { scenario: 'control', revision: '0', planId: plan })).status, 303);
  const loaded = x.db.readDemo(x.owner)!;
  // A failed learning action reports inside the card, not above the real numbers.
  const bad = await post('/demo/load', { scenario: 'nope', revision: '999', planId: plan });
  assert.equal(bad.status, 400);
  const badHtml = await bad.text();
  assert.equal((badHtml.match(/id="notification"/g) ?? []).length, 1);
  assert.ok(badHtml.indexOf('id="demo"') < badHtml.indexOf('id="notification"'), 'уведомление внутри демо-карточки');
  assert.equal((badHtml.match(/<h1>/g) ?? []).length, 1);

  // Status endpoint: a replaced dataset settles immediately, a completed job returns the decision.
  const replaced = await (await get(`/demo/status?dataset=${'0'.repeat(8)}-0000-0000-0000-000000000000`)).json();
  assert.equal(replaced.settled, true);
  assert.match(replaced.status, /Набор заменили/);
  x.db.setDemoPermission(x.owner, true, 0, 'Тест');
  x.db.enqueueDemo(x.owner, loaded.datasetId, 'Тест'); x.db.processDemoJob();
  const done = await (await get(`/demo/status?dataset=${loaded.datasetId}`)).json();
  assert.equal(done.settled, true);
  assert.match(done.html, /Почему остановили[\s\S]*Куда ушёл остаток/);
  assert.match(done.html, /Отменить решение/);

  // Pending rendering keeps the polling status outside the replaced block; no page refresh anywhere.
  const pendingView = { ...x.db.operationsView(x.owner), job: { id: 'job', status: 'pending' as const, resultId: null } };
  const pending = renderDemoSection(pendingView);
  assert.match(pending, /id="demo-status"[^>]*data-demo-poll=/);
  assert.doesNotMatch(pending, /http-equiv="refresh"/);
  const idle = renderDemoSection(x.db.operationsView(x.owner));
  assert.doesNotMatch(idle, /data-demo-poll/);
  assert.doesNotMatch(idle, /http-equiv="refresh"/);

  const result = x.db.operationsView(x.owner).result!;
  const undo = await post('/operations/undo', { id: result.id, confirm: 'undo' });
  assert.equal(undo.status, 303);
  assert.match(await (await get('/results')).text(), /Решение отменено/);
});

test('«Результаты» без учебного примера: настоящие цифры не смешиваются с учебными', async (t) => {
  const x = await measured(t);
  const onlyReal = renderResults(x.view);
  assert.doesNotMatch(onlyReal, /Учебный перенос бюджета/);
  assert.match(onlyReal, /Итог по кампании/);
  const fake = renderDemoSection({ history: [], plans: x.db.readPlans(x.owner) });
  assert.match(fake, /Открыть готовый пример/);
  assert.doesNotMatch(fake, /233,33/);
  assert.ok(!fake.includes(x.spend));
});

test('параметры: видимые сегменты периода и выбор кампании работают без JS', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-results-controls-'));
  const x = await e3Browser(directory);
  t.after(async () => { await new Promise<void>((resolve) => x.server.close(() => resolve())); x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  x.server.listen(0, '127.0.0.1'); await once(x.server, 'listening');
  const origin = `http://127.0.0.1:${(x.server.address() as any).port}`;
  const login = await fetch(origin + '/fixture-login/a', { redirect: 'manual', signal: t.signal });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string) => fetch(origin + path, { headers: { Cookie: cookie }, signal: t.signal });
  const post = (path: string, values: Record<string, string>) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: new URLSearchParams(values), redirect: 'manual', signal: t.signal });
  assert.equal((await post('/analytics/counter', { revision: '0', counterId: '11001001', confirm: 'read' })).status, 303);
  const run = x.db.readDirect(x.owner)!;
  let settings = x.db.readAnalyticsSettings(x.owner);

  const first = await (await get('/results')).text();
  assert.match(first, /id="analytics-run"/);
  assert.match(first, new RegExp(`type="hidden" name="dateFrom" value="${settings.dateFrom}"`));
  assert.equal((await post('/analytics/settings', { revision: String(settings.revision), dateFrom: settings.dateFrom,
    dateTo: settings.dateTo, directRunId: run.planId, goalId: '21001001' })).status, 303);
  settings = x.db.readAnalyticsSettings(x.owner);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  x.fault.directStatus = 202;
  const request = { revision: String(settings.revision), dateFrom: settings.dateFrom, dateTo: settings.dateTo,
    directRunId: run.planId, goalId: settings.goalId! };
  assert.equal((await post('/analytics/refresh', { ...request, source: 'direct_reports' })).status, 303);
  const pending = x.db.readPendingAnalyticsReports(x.owner)[0];
  const reportCalls = () => x.calls.filter(call => call.source === 'reports');
  assert.equal(reportCalls().length, 1);

  // A segment is a plain submit button: the server turns it into the last full days.
  assert.equal((await post('/analytics/settings', { revision: String(settings.revision), days: '30', directRunId: run.planId, goalId: '21001001' })).status, 303);
  const window = lastWindow(30);
  settings = x.db.readAnalyticsSettings(x.owner);
  assert.equal(settings.dateFrom, window.from);
  assert.equal(settings.dateTo, window.to);
  const page = await (await get('/results')).text();
  assert.match(page, /name="days" value="30" class="seg-btn" aria-pressed="true"/);
  assert.match(page, /name="days" value="7" class="seg-btn" aria-pressed="false"/);
  assert.match(page, /class="period-seg"[^>]*>[\s\S]*?<details class="custom-period" data-active="false">\s*<summary class="seg-btn">Свой период/);
  assert.doesNotMatch(page, /Помощь при проверке|cabinet-help/);
  assert.match(page, new RegExp(`name="reportId" value="${pending.id}">`));
  assert.match(page, /Сверка после/);
  assert.ok(page.includes(`${displayDate(request.dateFrom)} — ${displayDate(request.dateTo)}`));
  assert.doesNotMatch(page, /Предыдущие отчёты/);
  assert.equal((await post('/analytics/refresh', { directRunId: run.planId, reportId: pending.id })).status, 303);
  assert.equal(reportCalls().length, 1);
  for (const [id, label] of [['analytics-from', 'Начало'], ['analytics-to', 'Конец']]) {
    assert.match(page, new RegExp(`for="${id}">${label}</label>`));
    assert.match(page, new RegExp(`id="${id}"[^>]+type="date" value="" max="${window.to}"`));
  }

  // An invalid custom date keeps the field editable, opens the dates and explains what to fix.
  const filterForm = { revision: String(settings.revision), dateFrom: settings.dateFrom, dateTo: settings.dateTo,
    directRunId: run.planId, goalId: '21001001' };
  const bad = await post('/analytics/settings', { ...filterForm, period: 'custom', customFrom: '31.02.2026', customTo: displayDate(settings.dateTo) });
  assert.equal(bad.status, 409);
  const badHtml = await bad.text();
  assert.match(badHtml, /id="analytics-from"[^>]*aria-invalid="true"/);
  assert.match(badHtml, /class="custom-period" open/);
  assert.match(badHtml, /id="analytics-from-error">[^<]+/);

  t.mock.timers.tick(2_000);
  x.fault.directStatus = 200;
  assert.equal((await post('/analytics/refresh', { revision: request.revision, directRunId: run.planId, reportId: pending.id })).status, 303);
  assert.equal(x.db.readAnalyticsSettings(x.owner).dateFrom, window.from);
  assert.equal(x.analytics.view(x.owner).currentReports.length, 0);
  assert.equal(reportCalls().length, 2);
  assert.deepEqual(reportCalls()[1].body, reportCalls()[0].body);
  assert.equal((await post('/analytics/settings', { revision: String(settings.revision), days: '7', directRunId: run.planId, goalId: '21001001' })).status, 303);
  assert.deepEqual(x.analytics.view(x.owner).currentReports.map(report => [report.id, report.status]), [[pending.id, 'ready']]);
  settings = x.db.readAnalyticsSettings(x.owner);
  const filter = { ...filterForm, revision: String(settings.revision), dateFrom: settings.dateFrom, dateTo: settings.dateTo };
  assert.equal((await post('/analytics/settings', { ...filter, customFrom: '', customTo: '31.02.2026' })).status, 303);
  assert.equal(x.db.readAnalyticsSettings(x.owner).dateFrom, settings.dateFrom);
  assert.equal((await post('/analytics/settings', { ...filter, period: 'custom', customFrom: window.to, customTo: window.to })).status, 303);
  assert.equal(x.db.readAnalyticsSettings(x.owner).dateFrom, window.to);
  const savedCustom = await (await get('/results')).text();
  assert.match(savedCustom, /<details class="custom-period" data-active="true">/);
  assert.match(savedCustom, new RegExp(`id="analytics-from"[^>]+type="date" value="${window.to}"`));
});

test('восстановление Метрики из общих результатов возвращает в выбранную кампанию Директа', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-results-return-'));
  const x = await e3Browser(directory);
  t.after(async () => { await new Promise<void>(resolve => x.server.close(() => resolve())); x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  x.server.listen(0, '127.0.0.1'); await once(x.server, 'listening');
  const origin = 'http://127.0.0.1:' + (x.server.address() as {port:number}).port;
  const login = async (who:string) => (await fetch(origin + '/fixture-login/' + who, {redirect:'manual'})).headers.get('set-cookie')!.split(';')[0];
  const cookie = await login('a');
  const get = (path:string, session = cookie) => fetch(origin + path, {headers:{Cookie:session}, redirect:'manual'});
  const run = x.db.readDirect(x.owner)!;
  const { id: workspace } = x.db.createCampaignWorkspace(x.owner);
  x.db.saveDirect(x.owner, { ...run, campaignId: workspace });
  const saved = x.db.readAnalyticsSettings(x.owner);
  x.db.saveAnalyticsSettings(x.owner,{...saved, metrikaOAuth:{clientId:'fixture',connectionId:'expired-legacy-access'}},saved.revision);
  const results = '/results?run=' + run.planId;
  const query = `?ad=${workspace}&from=results&run=${run.planId}`;
  assert.ok((await (await get(results)).text()).includes(`/connections/direct${query.replaceAll('&','&amp;')}#metrika-title">Восстановить чтение Метрики`));
  const connections = await get('/connections/direct' + query);
  assert.equal(connections.status,200);
  const html = await connections.text();
  assert.match(html,new RegExp(`href="/results\\?run=${run.planId}">`));
  assert.equal((await get('/connections/direct' + query, await login('b'))).status,404);
  assert.equal((await get('/connections/direct' + query + '&run=' + run.planId)).status,404);
  assert.equal((await get('/connections/direct' + query.replace('from=results','from=overview'))).status,404);
  assert.equal((await get(results)).status,200);

  const unavailable = x.db.readAnalyticsSettings(x.owner);
  const restored = x.db.saveAnalyticsSettings(x.owner, {
    ...unavailable, metrikaOAuth: undefined, metrikaEnabled: true, metrikaConfigId: x.metrika.configId,
  }, unavailable.revision);
  const post = (operation: string, body: Record<string, string>) =>
    fetch(origin + '/connections/metrika/' + operation + query, { method:'POST', headers:{Origin:origin,Cookie:cookie}, redirect:'manual',
      body: new URLSearchParams(body) });
  const settingsPath = '/connections/direct' + query;
  const status = await (await get(results)).text();
  assert.ok(status.includes(settingsPath.replaceAll('&', '&amp;') + '#metrika-counter">Выбрать счётчик'));
  assert.doesNotMatch(status, /name="counterId"|name="disconnectProof"/);
  const settingsHtml = await (await get(settingsPath)).text();
  assert.match(settingsHtml, /Счётчик и цель/);
  assert.match(settingsHtml, /data-metrika-pair[^>]*data-reading/);
  assert.doesNotMatch(settingsHtml, /type="checkbox" name="confirm" value="read"/);
  assert.ok(settingsHtml.includes('/connections/metrika/configure' + query.replaceAll('&', '&amp;')));
  const counterFields = { revision: String(restored.revision), counterId: '11001001' };
  const unconfirmed = await post('counter', counterFields);
  assert.equal(unconfirmed.status,409);
  assert.match(await unconfirmed.text(), /id="metrika-counter"[\s\S]*<option value="11001001" selected>/);
  const attach = await post('counter', { ...counterFields, confirm: 'read' });
  assert.equal(attach.status,303);
  assert.equal(attach.headers.get('location'),settingsPath);
  const attached = x.db.readAnalyticsSettings(x.owner);
  assert.equal(attached.counter?.id, '11001001');
  assert.equal(attached.campaignAnalytics?.[workspace], undefined);
  assert.ok((await (await get(results)).text()).includes(settingsPath.replaceAll('&', '&amp;') + '#metrika-goal">Выбрать цель'));
  const goal = await post('goal', { revision: String(attached.revision), goalId: '21001001' });
  assert.equal(goal.status,303);
  assert.equal(x.db.readAnalyticsSettings(x.owner).goalId, '21001001');
  assert.match(await (await get(results)).text(), /id="analytics-goal"/);
});
