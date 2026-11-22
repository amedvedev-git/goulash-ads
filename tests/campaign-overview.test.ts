import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { campaignCatalogItems } from '../src/campaign-catalog-data.ts';
import { campaignDisplayState, renderCampaignCatalog, sortCampaigns } from '../src/campaign-catalog.ts';
import type { CampaignCatalogItem } from '../src/campaign-catalog.ts';
import { campaignMetrics } from '../src/campaign-metrics.ts';
import { renderAnalytics } from '../src/analytics-page.ts';
import { renderOverview } from '../src/overview-page.ts';
import type { AnalyticsView } from '../src/analytics-page.ts';

import { periodBudgetUsage } from '../src/analytics-money.ts';
import { e3Browser } from './fixtures/e3-browser.ts';
import { campaignTabHref } from '../src/routes.ts';
import { analyticsDates } from '../src/analytics.ts';

const item = (overrides: Partial<CampaignCatalogItem> = {}): CampaignCatalogItem => ({
  id: 'campaign-1', title: 'Пробные занятия йогой', stage: 'created', state: 'draft', needsReview: false,
  region: 'Казань', budget: '7000', period: '7', budgetSource: 'direct', conditionsChanged: false,
  lastActivity: '2026-11-18T10:00:00.000Z',
  directRuns: [{ id: 'run-1', name: 'Йога', account: '101', campaignId: '1001', review: false, complete: true, region: 'Казань', budget: '7000', period: '7', checkedAt: '2026-11-18T10:00:00.000Z', state: 'DRAFT', moderation: 'DRAFT', changed: false }],
  ...overrides,
});

const analytics = {
  campaignReports: [
    {
      source: 'direct_reports', status: 'ready', stale: false, mode: 'fixture',
      context: { runId: 'run-1', dateFrom: '2026-11-01', dateTo: '2026-11-17' },
      result: { rows: [{ campaignId: '1001', impressions: 4240, clicks: 128, costMicros: '1680000000' }] },
    },
    {
      source: 'metrika_direct', status: 'ready', stale: false, mode: 'fixture',
      context: { runId: 'run-1', dateFrom: '2026-11-01', dateTo: '2026-11-17', goalName: 'Отправка формы' },
      result: { complete: true, issues: [], metrics: { reaches: 6, cpa: 233.33 } },
    },
  ],
} as unknown as AnalyticsView;

test('одна кампания — один статус: черновик, показывается, остановлена', () => {
  assert.equal(campaignDisplayState('ON', 'ACCEPTED'), 'live');
  assert.equal(campaignDisplayState('OFF', 'ACCEPTED'), 'paused');
  assert.equal(campaignDisplayState('SUSPENDED', 'ACCEPTED'), 'paused');
  assert.equal(campaignDisplayState('OFF', 'DRAFT'), 'draft');
  assert.equal(campaignDisplayState(undefined, undefined), 'draft');
  assert.equal(sortCampaigns([item({ state: 'draft' }), item({ id: 'b', state: 'live' }), item({ id: 'c', state: 'paused' })])[0].state, 'live');
  const created = item({ id: 'created', stage: 'created', state: 'draft', lastActivity: '2026-01-01T00:00:00.000Z' });
  const draft = item({ id: 'newer-draft', stage: 'draft', state: 'draft', lastActivity: '2026-11-18T00:00:00.000Z' });
  assert.equal(sortCampaigns([draft, created])[0].id, 'created', 'запись в Директе важнее нового пустого черновика');
});

test('одна карточка — один набор метрик из сохранённых отчётов', () => {
  const metrics = campaignMetrics(item(), analytics);
  assert.match(metrics.spend!, /^1\s680,00\s₽$/);
  assert.equal(metrics.reaches, 6);
  assert.equal(metrics.cpa, 233.33);
  assert.equal(metrics.hasDirect, true);
  assert.equal(metrics.hasMetrika, true);
  const html = renderCampaignCatalog([item()], analytics);
  for (const label of ['Достижения цели', 'Стоимость достижения', 'Расход']) assert.match(html, new RegExp(label));
  assert.match(html, /1\s680,00\s₽/);
  assert.match(html, /233,33\s₽/);
  assert.match(html, /НДС не подтверждён/);
  assert.doesNotMatch(html, /из 7\s000\s₽|role="progressbar"/);
  assert.doesNotMatch(html, /Заявки|Заявка стоит|Учтённая стоимость/);
  assert.ok(html.indexOf('campaign-1') > html.indexOf('Подробности'), 'номер кампании остаётся в подробностях');
  assert.doesNotMatch(html.slice(0, html.indexOf('Подробности')), /campaign-1|1001/, 'технические номера не в основном потоке');
});

test('остаток и прогресс используют расход только за тот же период бюджета и на той же налоговой базе', () => {
  const dates = { from: '2026-11-11', to: '2026-11-17' };
  const campaign = item({ directRuns: [{ ...item().directRuns![0], dates }] });
  const render = (vat: string, dateFrom = dates.from, timezone = 'Europe/Moscow') => {
    const report = { ...analytics.campaignReports[0], context: { ...analytics.campaignReports[0].context,
      dateFrom, dateTo: dates.to, currency: 'RUB', timezone, vat, campaignId: '1001' },
      result: { rows: [{ campaignId: '1001', impressions: 4240, clicks: 128, costMicros: '6100000000' }] } };
    const view = { campaignReports: [report], currentReports: [report], reports: [report], plans: [], canRefresh: {}, metrikaAction: 'connect',
      settings: { dateFrom, dateTo: dates.to, directRunId: 'run-1' },
      runs: [{ planId: 'run-1', name: 'Йога', complete: true, draft: exampleCampaign, events: [],
        steps: { campaign: { phase: 'confirmed', id: '1001' }, ad: {}, group: {} },
        budget: { amountRub: '7000', periodDays: '7', startDate: dates.from, endDate: dates.to } }],
    } as unknown as AnalyticsView;
    return [renderOverview([campaign], view), renderCampaignCatalog([campaign], view), renderAnalytics(view)];
  };

  for (const html of render('included')) {
    assert.match(html, /6\s100,00\s₽/);
    assert.match(html, /Лимит указан без НДС, расход — с НДС/);
    assert.doesNotMatch(html, /900,00\s₽|role="progressbar"|из 7\s000\s₽/);
  }
  for (const views of [render('excluded', '2026-11-12'), render('excluded', dates.from, 'unknown')]) {
    for (const html of views) {
      assert.match(html, /Запросите отчёт Директа с|нужен отчёт за московские сутки/);
      assert.doesNotMatch(html, /role="progressbar"|из 7\s000\s₽/);
    }
  }
  const [overview, list, results] = render('excluded');
  for (const html of [overview, list, results]) assert.match(html, /role="progressbar"[^>]*aria-valuenow="87"/);
  for (const html of [overview, results]) assert.match(html, /Осталось по отчёту<\/dt><dd>900,00\s₽/);
});

test('пустой черновик не появляется в списке; сохранённый — появляется', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-catalog-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  db.createCampaignWorkspace('local');
  assert.deepEqual(campaignCatalogItems(db, 'local'), []);
  assert.match(renderCampaignCatalog([]), /Начните с первой кампании[\s\S]*Черновик появится в списке после сохранения/);
  db.saveCampaign('local', { ...exampleCampaign, description: 'Пробные занятия йогой' }, 0, 'Тест');
  const items = campaignCatalogItems(db, 'local');
  assert.equal(items.length, 1);
  assert.equal(items[0].stage, 'draft');
  assert.equal(items[0].state, 'draft');
  assert.equal(items[0].budgetSource, 'draft');
  assert.match(renderCampaignCatalog(items), /Пробные занятия йогой/);
});
test('R03–R04: отдельные периоды и даты обновления, 21 достижение в 5 визитах и ноль отдельно от пустого отчёта', () => {
  const [d, m] = analytics.campaignReports;
  const direct = { ...d, receivedAt: '2026-11-08T10:00:00Z', context: { ...d.context, dateTo: '2026-11-07' } };
  const metrika = { ...m, receivedAt: '2026-11-15T11:15:00Z', context: { ...m.context,
    dateFrom: '2026-11-08', dateTo: '2026-11-14', goalName: 'Просмотр страницы' },
    result: { ...m.result, metrics: { reaches: 21, goalVisits: 5, cpa: 3 } } };
  const view = { ...analytics, campaignReports: [metrika, direct] };
  const overview = renderOverview([item()], view);
  const list = renderCampaignCatalog([item()], view);
  for (const html of [overview, list]) {
    assert.match(html, /Директ · 01\.11\.2026 — 07\.11\.2026 · обновлено 08\.11\.2026, 13:00:00 МСК/);
    assert.match(html, /Метрика · 08\.11\.2026 — 14\.11\.2026 · обновлено 15\.11\.2026, 14:15:00 МСК/);
    assert.match(html, /Просмотр страницы/);
    assert.doesNotMatch(html, /заявок с рекламы|за заявку|<dt>Заявки<\/dt>/i);
  }
  assert.match(overview, /hero-number">21</);
  assert.match(overview, /Целевые визиты: 5/);
  const zero = { ...metrika, result: { ...metrika.result, metrics: { reaches: 0, goalVisits: 0, cpa: null } } };
  assert.equal(campaignMetrics(item(), { ...view, campaignReports: [zero, metrika, direct] }).reaches, 0);
  const empty = { ...zero, status: 'empty' as const };
  const after = campaignMetrics(item(), { ...view, campaignReports: [empty, metrika, direct] });
  assert.equal(after.reaches, undefined);
  assert.equal(after.cpa, undefined);
  assert.equal(after.spend, campaignMetrics(item(), view).spend);
});

test('R05: граница суток МСК, срез с начала бюджета, поздний расход и пересмотр итога', () => {
  const dates = { from: '2026-11-01', to: '2026-11-07' };
  const direct = (dateTo: string, cost: string) => ({ ...analytics.campaignReports[0], context: {
    ...analytics.campaignReports[0].context, dateFrom: dates.from, dateTo, currency: 'RUB', vat: 'excluded', timezone: 'Europe/Moscow', campaignId: '1001',
  }, result: { rows: [{ campaignId: '1001', costMicros: cost }] } });
  const earlier = direct('2026-11-02', '100000000');
  const third = direct('2026-11-03', '220000000');
  const updated = direct('2026-11-03', '250000000');
  const final = direct(dates.to, '850000000');
  const calc = (reports: typeof earlier[], instant: string) => periodBudgetUsage(1000, dates, '1001', reports, Date.parse(instant));
  assert.equal(calc([third, earlier], '2026-11-03T20:59:59Z').remaining, '900,00 ₽');
  const midnight = calc([third, earlier], '2026-11-03T21:00:00Z');
  assert.equal(midnight.remaining, '780,00 ₽');
  assert.match(midnight.note, /03\.11\.2026.*Резерв.*Поздние начисления/);
  assert.equal(calc([updated, third], '2026-11-05T12:00:00Z').remaining, '750,00 ₽');
  assert.equal(calc([updated, final, third], '2026-11-08T12:00:00Z').remaining, '150,00 ₽');
  const extraneous = { ...final, context: { ...final.context, dateFrom: '2026-11-02' } };
  assert.equal(calc([extraneous, updated], '2026-11-08T12:00:00Z').remaining, '750,00 ₽');
  assert.equal(calc([extraneous], '2026-11-08T12:00:00Z').remaining, undefined);
  assert.equal(calc([{ ...final, context: { ...final.context, currency: 'USD' } }], '2026-11-08T12:00:00Z').remaining, undefined);
});

test('R05: штатное чтение Reports без НДС сохраняет МСК и даёт промежуточный остаток на рабочем столе и в результатах кампании', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-budget-read-'));
  const x = await e3Browser(directory);
  x.server.listen(0, '127.0.0.1');
  await once(x.server, 'listening');
  t.after(async () => {
    await new Promise<void>(resolve => x.server.close(() => resolve()));
    x.db.close(); rmSync(directory, { recursive: true, force: true });
  });
  const {dateFrom, dateTo} = analyticsDates();
  const run = x.db.readDirect(x.owner)!;
  const saved = x.db.readPreparation(x.owner)!;
  const workspace = x.db.createCampaignWorkspace(x.owner).id;
  x.db.savePreparation(x.owner, {...saved.value, guided: true}, 0, undefined, undefined, workspace);
  run.campaignId = workspace;
  run.guidedDraft = true;
  const endDate = new Date(Date.parse(dateFrom) + 13 * 86400000).toISOString().slice(0,10);
  run.budget = {kind:'custom_period', amountRub:'7000', spendLimitMicros:'7000000000', periodDays:'14', startDate:dateFrom, endDate, autoContinue:'NO'};
  x.db.saveDirect(x.owner, run);
  x.analytics.save(x.owner, new URLSearchParams({revision:'0', directRunId:run.planId, dateFrom, dateTo}), false, workspace);
  const report = await x.analytics.refresh(x.owner, 'direct_reports', undefined, workspace);
  assert.equal(x.calls.find(call => call.source === 'reports').body.params.IncludeVAT, 'NO');
  assert.equal(report.context.timezone, 'Europe/Moscow');
  assert.equal(report.context.vat, 'excluded');
  assert.equal(report.status, 'ready');
  const view = x.analytics.view(x.owner, run.planId, workspace);
  const items = campaignCatalogItems(x.db, x.owner);
  for (const html of [renderOverview(items, view), renderCampaignCatalog(items, view), renderAnalytics(view)]) {
    assert.match(html, /Учтено по .* включительно \(МСК\), без НДС/);
    assert.match(html, /role="progressbar"[^>]*aria-valuenow="0"/);
  }
  for (const html of [renderOverview(items, view), renderAnalytics(view)]) assert.match(html, /Осталось по отчёту<\/dt><dd>7\s000,00 ₽/);
  const address = x.server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const login = await fetch(origin + '/fixture-login/a', {redirect:'manual'});
  const headers = {Cookie:login.headers.get('set-cookie')!.split(';')[0]};
  const response = await fetch(origin + campaignTabHref(workspace, 'summary'), {headers});
  assert.equal(response.status, 200);
  const summary = await response.text();
  assert.match(summary, /Условия кампании[\s\S]*Бюджет стратегии/);
  assert.doesNotMatch(summary, /Осталось по отчёту<\/dt>/);
  const results = await fetch(origin + campaignTabHref(workspace, 'results'), {headers});
  assert.equal(results.status, 200);
  const reports = await results.text();
  assert.match(reports, /Бюджет и цель[\s\S]*Осталось по отчёту<\/dt><dd>7\s000,00 ₽/);
  assert.match(reports, /Учтено по .* включительно \(МСК\), без НДС/);
});
