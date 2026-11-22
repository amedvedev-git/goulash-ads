import { renderAnalytics } from './analytics-page.ts';
import type { AnalyticsView } from './analytics-page.ts';
import { renderDemoSection } from './demo-section.ts';
import type { DemoNotice } from './demo-section.ts';
import type { OperationsView } from './operations.ts';

// "Результаты": real Direct/Metrika numbers first, one clearly separated learning
// example last. Nothing synthetic is mixed into the real figures.
export function renderResults(analytics: AnalyticsView | undefined, operations?: OperationsView, notice?: DemoNotice, related = '') {
  if (!analytics) return `<div class="page-head"><div><h1>Результаты</h1><p class="lead">Данные кабинета ещё не готовы.</p></div></div>`;
  return `<div class="operations results">${renderAnalytics(analytics, related)}${operations ? renderDemoSection(operations, notice) : ''}</div>`;
}
