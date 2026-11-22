import type { AnalyticsReport } from './analytics.ts';
import { analyticsDates } from './analytics.ts';
import type { DirectState } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';

// Money in Direct reports is an integer number of micros (1 RUB = 1 000 000).
export function micros(value: string) {
  const kopecks = (BigInt(value) + 5000n) / 10000n;
  return `${(kopecks / 100n).toLocaleString('ru-RU')},${String(kopecks % 100n).padStart(2, '0')} ₽`;
}

export function reportVat(report?: AnalyticsReport) {
  if (report?.context.vat === 'included') return 'с НДС';
  if (report?.context.vat === 'excluded') return 'без НДС';
  return 'НДС не подтверждён';
}

export function periodBudgetUsage(
  amountRub: string | number,
  dates: { from: string; to: string } | undefined,
  campaignId: string | undefined,
  reports: AnalyticsReport[],
  now = Date.now(),
): { percent?: number; spent?: string; remaining?: string; note: string; firstDayIncomplete?: true } {
  if (!dates?.from || !dates.to || !campaignId) {
    return { note: 'Для расчёта остатка нужно подтвердить период бюджета и кампанию Директа.' };
  }
  const lastDay = analyticsDates(now).dateTo;
  // Reports arrive newest first. On equal end dates the newer correction wins, including an empty response.
  const report = reports.filter(({source, status, context}) => source === 'direct_reports' && ['ready', 'empty'].includes(status)
    && context.campaignId === campaignId && context.dateFrom === dates.from && context.dateTo >= dates.from
    && context.dateTo <= dates.to && context.dateTo <= lastDay).sort((a,b) => b.context.dateTo.localeCompare(a.context.dateTo))[0];
  if (!report) {
    if (dates.from > lastDay) return { note: 'Первый день периода бюджета ещё не завершился по Москве.', firstDayIncomplete: true };
    return { note: `Запросите отчёт Директа с ${dates.from} по ${dates.to < lastDay ? dates.to : lastDay} (МСК).` };
  }
  const row = report.result?.rows?.[0];
  if (report.status !== 'ready' || report.stale || report.interrupted
    || report.result?.complete === false || report.result?.issues?.length || typeof row?.costMicros !== 'string' || !/^\d+$/.test(row.costMicros)) {
    return { note: 'Для расчёта остатка нужен актуальный отчёт Директа за период бюджета.' };
  }
  if (report.context.vat === 'included') {
    return { note: 'Лимит указан без НДС, расход — с НДС. Для расчёта остатка нужен расход без НДС.' };
  }
  if (report.context.vat !== 'excluded' || report.context.currency !== 'RUB') {
    return { note: 'Для расчёта остатка подтвердите валюту и НДС в отчёте Директа.' };
  }
  if (row.campaignId !== campaignId) {
    return { note: 'Для расчёта остатка нужно подтвердить период бюджета и соответствие отчёта кампании.' };
  }
  if (report.context.timezone !== 'Europe/Moscow') {
    return { note: 'Для расчёта остатка нужен отчёт за московские сутки.' };
  }
  const amount = Number(amountRub);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { note: 'Лимит бюджета не подтверждён.' };
  const limit = BigInt(amount) * 1000000n;
  const spent = BigInt(row.costMicros);
  const remaining = micros(String(spent > limit ? 0n : limit - spent));
  const percent = spent >= limit ? 100 : Number((spent * 100n + limit / 2n) / limit);
  const cutoff = report.context.dateTo.split('-').reverse().join('.');
  return { percent, remaining, spent: micros(row.costMicros), note: `Учтено по ${cutoff} включительно (МСК), без НДС. Резерв не вычтен. Поздние начисления могут изменить остаток.${spent > limit ? ' Расход по отчёту превышает лимит.' : ''}` };
}

export function budgetStatus(transferred: boolean, state: string | undefined, confirmedPlan: boolean, moderation?: string) {
  if (transferred && moderation === 'DRAFT') return 'Лимит сохранён в черновике Директа. Показы выключены.';
  if (transferred) return state === 'ON' ? 'Лимит передан в Директ. Показы включены.'
    : state === 'OFF' || state === 'SUSPENDED' ? 'Лимит сохранён в Директе. Показы выключены.' : 'Лимит сохранён в кампании Директа.';
  return confirmedPlan ? 'Лимит сохранён в подтверждённом плане Goulash.' : 'Лимит сохранён в черновике Goulash.';
}

export function runBudgetUsage(run: DirectState | undefined, reports: AnalyticsReport[]) {
  if (!run?.budget || run.pilot) return;
  const dates = run.complete && !run.error && !hasUnresolvedDirect(run)
    ? { from: run.budget.startDate, to: run.budget.endDate } : undefined;
  return periodBudgetUsage(run.budget.amountRub, dates, run.steps.campaign.id, reports.filter(report => report.context.runId === run.planId));
}

// Metrika's native CPA uses goal reaches in visits with recorded click cost.
export function reportCpa(report: AnalyticsReport): number | undefined {
  const { result } = report;
  if (report.source !== 'metrika_direct' || report.status !== 'ready' || report.stale || report.interrupted ||
    !result?.complete || result.issues?.length || result.sampled || (result.sampleShare !== undefined && result.sampleShare !== 1)) return;
  const { reaches, cpa } = result.metrics ?? {};
  if (Number.isSafeInteger(reaches) && reaches > 0 && Number.isFinite(cpa) && cpa >= 0) return cpa;
}
