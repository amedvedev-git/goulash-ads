export const campaignWorkspaceStyles = `
main[data-campaign-id] { width: min(1020px, 100%); }
.campaign-workspace { --campaign-inset: 26px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.campaign-workspace .guided-tabs { margin: 0; padding-inline: var(--campaign-inset); }
.campaign-workspace [data-campaign-panel] { padding: 22px var(--campaign-inset); min-width: 0; container: campaign-workspace / inline-size; }
.campaign-panel-header { display: grid; align-items: center; gap: 8px 16px; margin-bottom: 16px; }
.campaign-panel-header .panel-heading { min-height: 52px; display: flex; align-items: center; }
.campaign-panel-header h2 { margin: 0; font-size: 24px; line-height: 1.25; }
.campaign-journal-header { grid-template-columns: minmax(0, 1fr) auto; }
.campaign-journal-filters { display: flex; flex-wrap: wrap; justify-self: start; gap: 3px; padding: 3px; border: 1px solid var(--line); border-radius: 10px; }
.campaign-journal-filters a { display: inline-flex; align-items: center; min-height: 44px; padding: 4px 11px; border-radius: 6px; font-size: 13px; text-decoration: none; }
.campaign-journal-filters [aria-current] { background: var(--ink); color: var(--surface); }
.campaign-journal .ops-timeline { margin-top: 0; }
.campaign-workspace .campaign-journal > .campaign-content-section { padding: 22px 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; }
.campaign-journal .ops-event:first-of-type { border-top: 0; padding-top: 0; }
.campaign-journal .ops-event:last-child { padding-bottom: 0; }

.campaign-content-section, .campaign-workspace .campaign-result-stack > .card,
.campaign-workspace .campaign-result-stack > section,
.campaign-workspace [data-campaign-panel] > .connect-card {
  padding: 22px 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; min-width: 0;
}
.campaign-content-section h3, .campaign-result-stack h3 { margin: 0 0 10px; }
.campaign-content-section .campaign-status-title { font-size: 24px; line-height: 1.25; }
.campaign-content-section p:last-child { margin-bottom: 0; }
.campaign-context-actions { margin: 12px 0; }
.campaign-summary-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px 20px; margin: 16px 0 0; }
.campaign-summary-facts dt { font-size: 13px; color: var(--muted); }
.campaign-summary-facts dd { margin: 3px 0 0; font-weight: 550; overflow-wrap: anywhere; }
.creative-review.campaign-content-section { padding-bottom: 0; }
.campaign-workspace .creative-review form { margin: 12px 0 0; }
.campaign-workspace .creative-preview { margin-top: 22px; }
.campaign-workspace .creative-preview .ad-preview { padding: 16px; }
.campaign-workspace .creative-preview .ad-preview > :last-child { margin-bottom: 0; }
.campaign-workspace #campaign-experiment { margin-top: 0; }
.campaign-workspace #campaign-settings > .connect-card { margin-top: 12px; }
#main .campaign-workspace details.campaign-fold { margin: 0; padding: 0; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: transparent; }
#main .campaign-workspace details.campaign-fold[open] { padding-bottom: 12px; }
#main .campaign-workspace details.campaign-fold > summary { margin-inline: 0; min-height: 48px; padding-inline: 0 24px; border-radius: 0; background: transparent; color: var(--ink); }
#main .campaign-workspace details.campaign-fold > summary::after { right: 5px; }
#main .campaign-workspace details.campaign-fold > summary:hover { color: var(--teal); }

.campaign-workspace .operations.results { gap: 0; }
.campaign-workspace #analytics-filters { display: block; justify-items: normal; width: 100%; margin: 0; }
.campaign-workspace .campaign-field { margin-bottom: 16px; }
.campaign-results-header { width: 100%; grid-template-columns: minmax(0, 1fr) minmax(0, 306px) minmax(0, 1fr); }
.campaign-workspace .campaign-presets { display: flex; flex-wrap: nowrap; width: max-content; justify-self: end; container-type: normal; }
.campaign-workspace .campaign-presets button { margin: 0; }
.campaign-period-apply { margin: 0 0 14px; }
.campaign-report-period { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 7px; }
.campaign-report-period .period-dash { color: var(--muted); justify-self: center; }
.report-date-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; min-height: 52px; border: 1px solid var(--control-line); border-radius: 9px; background: var(--surface); }
.campaign-workspace .results-controls .report-date-control input[type=text] { min-width: 0; width: 100%; min-height: 0; padding: 0 1px 0 7px; border: 0; background: transparent; font-size: 16px; }
.report-date-control input::placeholder { color: var(--muted); font-size: 13px; }
.campaign-workspace .report-date-control button { display: grid; place-items: center; width: 32px; min-height: 44px; margin: 0; padding: 0; border: 0; border-radius: 8px; color: var(--ink); background: transparent; }
.report-date-control:has([aria-invalid=true]) { border-color: var(--error); }
.campaign-period-error { margin: -4px 0 12px; }
.campaign-period-error:empty { position: absolute; width: 1px; height: 1px; margin: 0; overflow: hidden; clip-path: inset(50%); }
.campaign-result-stack > :last-child { padding-bottom: 22px; }
.campaign-result-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 10px 16px; padding: 12px; border-radius: 9px; background: var(--wash); margin: 12px 0 16px; }
.campaign-result-metrics dt { font-size: 13px; color: var(--muted); }
.campaign-result-metrics dd { margin: 2px 0 0; font-size: 20px; font-weight: 550; overflow-wrap: anywhere; }
.campaign-result-metrics small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
.campaign-result-stack .results-refresh .source-actions { grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), max-content)); }
.campaign-result-stack .source-row button { width: auto; justify-self: start; white-space: normal; }
.campaign-result-stack .results-metrika { padding-top: 12px; }

dialog.period-calendar { position: fixed; inset: auto; margin: 0; width: min(314px, calc(100% - 24px)); max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
.period-calendar::backdrop { background: transparent; }
.calendar-head, .calendar-actions { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.calendar-actions { flex-wrap: wrap; }
.calendar-head p { margin: 0; font-weight: 600; }
.calendar-head p::first-letter { text-transform: uppercase; }
.campaign-workspace .period-calendar button { min-height: 34px; margin: 0; padding: 0 4px; border: 0; border-radius: 6px; color: var(--ink); background: transparent; font-weight: 500; }
.period-calendar .calendar-head button { width: 38px; min-height: 40px; font-size: 23px; }
.period-calendar .calendar-days { width: 100%; min-width: 0; margin: 4px 0 6px; border-collapse: separate; border-spacing: 2px; table-layout: fixed; }
.period-calendar .calendar-days :is(td,th) { min-width: 0; padding: 0; border: 0; text-align: center; }
.period-calendar .calendar-days th:first-child { position: static; background: transparent; }
.calendar-days th { color: var(--muted); font-size: 12px; }
.period-calendar .calendar-days button { width: 100%; padding: 0; }
.period-calendar .calendar-days .adjacent-month { color: var(--muted); }
.period-calendar .calendar-days [aria-selected=true] button { color: white; background: var(--teal); }
.period-calendar .calendar-actions button { min-height: 38px; color: var(--teal); font-size: 12px; }
.campaign-workspace .period-calendar button:disabled { opacity: .48; cursor: default; }
@media (hover:hover) {
  .campaign-workspace .report-date-control button:hover, .campaign-workspace .period-calendar button:hover:not(:disabled) { background: var(--wash); color: var(--ink); }
}
@media (forced-colors:active) {
  .campaign-journal-filters [aria-current], .period-calendar .calendar-days [aria-selected=true] button { border: 1px solid Highlight; color: Highlight; }
}
@container campaign-workspace (width < 640px) {
  .campaign-results-header { grid-template-columns: minmax(0, 306px) auto; justify-content: space-between; }
  .campaign-results-header .panel-heading { grid-column: 1 / -1; }
}
@container campaign-workspace (width < 560px) {
  .campaign-journal-header { grid-template-columns: minmax(0, 1fr); }
  .campaign-summary-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container campaign-workspace (width < 470px) {
  .campaign-results-header { grid-template-columns: minmax(0, 1fr); }
  .campaign-workspace .campaign-presets { justify-self: start; }
  .campaign-report-period { max-width: 306px; }
}
@container campaign-workspace (width < 300px) {
  .campaign-report-period { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
@media(max-width:700px) {
  .campaign-workspace { --campaign-inset: 12px; }
  .campaign-workspace .guided-tabs { gap: 2px 5px; }
  .campaign-workspace [data-campaign-panel] { padding-block: 16px; }
  .campaign-workspace .campaign-result-stack .responsive-table { min-width: 0; }
}
`;
