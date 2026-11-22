import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { e3Fixture } from './fixtures/e3.ts';
import { e3Browser } from './fixtures/e3-browser.ts';
import { metrikaDailyParams, parseMetrikaDaily } from '../src/metrika-api.ts';
import { renderResults } from '../src/results-page.ts';

const query = { counterId: '11001001', goalId: '21001001', campaignId: '41001001', login: 'user', dateFrom: '2026-11-12', dateTo: '2026-11-14' };
const payload = (days: any[], totals: any[], extra: Record<string, unknown> = {}) => ({
  query: { metrics: ['ym:s:goal21001001reaches'], date1: query.dateFrom, date2: query.dateTo, timezone: '+03:00', dimensions: ['ym:s:date'], filters: 'ym:ad:lastDirectOrder==41001001' },
  data: days.map(([date, reaches]: any) => ({ dimensions: [{ name: date }], metrics: [reaches] })),
  totals, total_rows: days.length, total_rows_rounded: false, sampled: false, sample_share: 1, contains_sensitive_data: false, data_lag: 0,
  ...extra,
});

test('дневной отчёт: строгий разбор, сумма дней и честные состояния', () => {
  const good = parseMetrikaDaily(payload([['2026-11-13', 0], ['2026-11-12', 1], ['2026-11-14', 2]], [3]), query);
  assert.equal(good.status, 'ready');
  assert.deepEqual(good.days, [{ date: '2026-11-12', reaches: 1 }, { date: '2026-11-13', reaches: 0 }, { date: '2026-11-14', reaches: 2 }]);
  assert.equal(good.metrics.reaches, 3);
  assert.equal(good.complete, true);

  const mismatch = parseMetrikaDaily(payload([['2026-11-12', 1]], [2]), query);
  assert.equal(mismatch.complete, false);
  assert.match(mismatch.issues.join(' '), /Сумма дней не совпадает с итогом/);

  const sampled = parseMetrikaDaily(payload([['2026-11-12', 1]], [1], { sampled: true, sample_share: 0.5 }), query);
  assert.match(sampled.issues.join(' '), /Семплированный отчёт/);

  const empty = parseMetrikaDaily(payload([], [0]), query);
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.days, []);

  assert.throws(() => parseMetrikaDaily(payload([['2026-11-12', 1], ['2026-11-12', 2]], [3]), query), /некорректный день/);
  assert.throws(() => parseMetrikaDaily({ ...payload([['2026-11-12', 1]], [1]), data: [{ dimensions: [{ id: '2026-11-12' }], metrics: [1] }] }, query), /некорректный день/);
  assert.throws(() => parseMetrikaDaily(payload([['2026-11-12', -1]], [-1]), query), /некорректное число/);
  assert.throws(() => parseMetrikaDaily({ ...payload([], [0]), query: { ...payload([], [0]).query, metrics: ['ym:ad:goal21001001reaches'] } }, query), /не соответствует запросу/);
  assert.throws(() => parseMetrikaDaily({ ...payload([], [0]), query: { ...payload([], [0]).query, dimensions: ['ym:ad:lastDirectOrder'] } }, query), /не соответствует запросу/);

  // The request the product sends keeps the cross-prefix rule: ad filter, site metric, date dimension.
  const params = metrikaDailyParams(query);
  assert.equal(params.get('metrics'), 'ym:s:goal21001001reaches');
  assert.equal(params.get('dimensions'), 'ym:s:date');
  assert.equal(params.get('filters'), 'ym:ad:lastDirectOrder==41001001');
  assert.equal(params.get('direct_client_logins'), 'user');
});

async function live(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-daily-'));
  const x = await e3Browser(directory);
  t.after(async () => { await new Promise<void>((resolve) => x.server.close(() => resolve())); x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  x.server.listen(0, '127.0.0.1'); await once(x.server, 'listening');
  const origin = `http://127.0.0.1:${(x.server.address() as any).port}`;
  const login = await fetch(origin + '/fixture-login/a', { redirect: 'manual', signal: t.signal });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const get = (path: string) => fetch(origin + path, { headers: { Cookie: cookie }, signal: t.signal });
  const post = (path: string, values: Record<string, string>) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: new URLSearchParams(values), redirect: 'manual', signal: t.signal });
  assert.equal((await post('/analytics/counter', { revision: '0', counterId: '11001001', confirm: 'read' })).status, 303);
  const settings = x.db.readAnalyticsSettings(x.owner);
  assert.equal((await post('/analytics/settings', {
    revision: String(settings.revision), dateFrom: settings.dateFrom, dateTo: settings.dateTo,
    goalId: '21001001', directRunId: x.db.readDirect(x.owner)!.planId,
  })).status, 303);
  return { x, origin, get, post };
}

test('дневной отчёт: обновление сохраняется, график и таблица совпадают с итогом', async (t) => {
  const { x, get, post } = await live(t);
  assert.equal((await post('/analytics/refresh', { source: 'metrika_direct' })).status, 303);
  assert.equal((await post('/analytics/refresh', { source: 'metrika_daily' })).status, 303);
  const daily = x.db.readAnalyticsReports(x.owner).find((report) => report.source === 'metrika_daily')!;
  assert.equal(daily.status, 'ready');
  assert.equal(daily.result.days.length, 7);
  assert.equal(daily.result.metrics.reaches, daily.result.days.reduce((sum: number, day: any) => sum + day.reaches, 0));

  const html = await (await get('/results')).text();
  assert.match(html, /id="daily-title">Достижения по дням/);
  assert.equal((html.match(/class="daily-bars"/g) ?? []).length, 1);
  assert.equal((html.match(/<i class="[^"]*" style="height:/g) ?? []).length, 7, 'по столбику на день');
  assert.equal((html.match(/<details class="support"><summary>Таблица по дням<\/summary>/g) ?? []).length, 1);
  assert.match(html, /Всего 6 достижений за период/);
  assert.doesNotMatch(html, /Обновите оба отчёта/);
  assert.match(html, /<dt>Достижения цели<\/dt><dd>6/, 'главная цифра не изменилась');
});

test('дневной отчёт: пустой ответ не превращается в выдуманный график', async (t) => {
  const { x, get, post } = await live(t);
  x.fault.empty = true;
  assert.equal((await post('/analytics/refresh', { source: 'metrika_daily' })).status, 303);
  const daily = x.db.readAnalyticsReports(x.owner).find((report) => report.source === 'metrika_daily')!;
  assert.equal(daily.status, 'empty');
  const html = await (await get('/results')).text();
  assert.match(html, /За этот период источник не вернул данных\./);
  assert.doesNotMatch(html, /class="daily-bars"/);
});

test('дневной отчёт: неполный ряд и расхождение с карточкой показываются словами', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-daily-view-'));
  const x = await e3Fixture(directory);
  t.after(() => { x.db.close(); for (const name of readdirSync(directory)) unlinkSync(join(directory, name)); rmdirSync(directory); });
  await x.analytics.counter(x.owner, '11001001', 0);
  const settings = x.db.readAnalyticsSettings(x.owner);
  x.analytics.save(x.owner, new URLSearchParams({
    revision: String(settings.revision), directRunId: x.db.readDirect(x.owner)!.planId,
    goalId: '21001001', dateFrom: settings.dateFrom, dateTo: settings.dateTo,
  }));
  await x.analytics.refresh(x.owner, 'metrika_direct');
  await x.analytics.refresh(x.owner, 'metrika_daily');
  const view = x.analytics.view(x.owner);
  const daily = view.currentReports.find((report) => report.source === 'metrika_daily')!;

  const broken = renderResults({ ...view, currentReports: view.currentReports.map((report) => report === daily
    ? { ...report, result: { ...report.result, issues: ['Сумма дней не совпадает с итогом'], complete: false } } : report) });
  assert.match(broken, /Сумма дней не совпадает с итогом/);
  assert.doesNotMatch(broken, /daily-bars/);

  const shifted = renderResults({ ...view, currentReports: view.currentReports.map((report) => report === daily
    ? { ...report, result: { ...report.result, metrics: { ...report.result.metrics, reaches: 5 } } } : report) });
  assert.match(shifted, /В карточке «Достижения цели» 6, по дням 5/);
  assert.equal((shifted.match(/class="daily-bars"/g) ?? []).length, 1);
});
