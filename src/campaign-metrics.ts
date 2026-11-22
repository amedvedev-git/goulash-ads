import type { AnalyticsView } from './analytics-page.ts';
import type { AnalyticsReport } from './analytics.ts';
import { micros, periodBudgetUsage, reportCpa, reportVat } from './analytics-money.ts';
import type { CampaignCatalogItem } from './campaign-catalog.ts';

export function latestRun(item: CampaignCatalogItem) {
  return (item.directRuns ?? []).findLast((run) => run.complete && run.campaignId);
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function sourcePeriod(report?: AnalyticsReport) {
  if (!report) return '';
  const { dateFrom, dateTo } = report.context;
  const date = (value: string) => value.split('-').reverse().join('.');
  const source = report.source === 'direct_reports' ? 'Директ' : 'Метрика';
  const updated = report.receivedAt && Number.isFinite(Date.parse(report.receivedAt))
    ? ' · обновлено ' + new Date(report.receivedAt).toLocaleString('ru-RU', {timeZone:'Europe/Moscow'}) + ' МСК' : '';
  return source + ' · ' + date(dateFrom) + ' — ' + date(dateTo) + updated + (report.stale ? ' · отчёт устарел' : '');
}

export function reportMetrics(reports: AnalyticsReport[], showHistorical = false) {
  const settled = (source: AnalyticsReport['source']) => reports.find(report => report.source === source
    && (report.status === 'ready' || report.status === 'empty'));
  const direct = settled('direct_reports'), metrika = settled('metrika_direct');
  const readable = (report?: AnalyticsReport) => report?.status === 'ready' && !report.interrupted && (showHistorical || !report.stale);
  const row = readable(direct) ? direct?.result?.rows?.[0] : undefined;
  const cost = typeof row?.costMicros === 'string' && /^\d+$/.test(row.costMicros) ? row.costMicros : undefined;
  const incomplete = metrika?.status === 'ready' && (!metrika.result?.complete || Boolean(metrika.result?.issues?.length
    || metrika.result?.sampled || metrika.result?.sampleShare !== undefined && metrika.result.sampleShare !== 1));
  const values = readable(metrika) && (showHistorical || !incomplete) ? metrika?.result?.metrics : undefined;
  return {
    direct, metrika,
    spend: cost === undefined ? undefined : micros(cost), spendVat: direct && reportVat(direct),
    impressions: count(row?.impressions), clicks: count(row?.clicks),
    reaches: count(values?.reaches), goalVisits: count(values?.goalVisits), cpa: metrika && reportCpa(metrika),
    goalName: metrika?.context.goalName, metrikaStale: metrika?.stale, metrikaIncomplete: incomplete,
    hasDirect: Boolean(row), hasMetrika: Boolean(values),
  };
}

export function campaignMetrics(item: CampaignCatalogItem, analytics?: AnalyticsView) {
  const run = latestRun(item);
  const reports = run ? (analytics?.campaignReports ?? []).filter(report => report.context.runId === run.id) : [];
  return {
    ...reportMetrics(reports), run,
    budgetUsage: run && item.budgetSource === 'direct' && Number(item.budget) > 0
      ? periodBudgetUsage(item.budget, run.review || run.budget !== item.budget ? undefined : run.dates, run.campaignId, reports)
      : undefined,
  };
}
export type CampaignMetrics = ReturnType<typeof campaignMetrics>;
