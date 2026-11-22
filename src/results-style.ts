// Styles for results, the learning example and history.
export const resultsStyles = `
.results > .page-head{margin-bottom:14px}
.results > section.card-demo{border:1px dashed #cfcfd8;border-radius:var(--radius);background:#fbfbfc;padding:22px 24px}
.results-head{align-items:flex-start}
.results-head .lead{margin:0;max-width:64ch}
.results-controls{display:grid;grid-template-columns:minmax(0,1fr);justify-items:start;gap:14px;margin:0 0 22px}
.period-seg{display:inline-flex;align-items:flex-start;max-width:100%;gap:2px;padding:3px;background:var(--surface);border:1px solid var(--line);border-radius:11px}
.period-seg .seg-btn,#main details.custom-period>summary{margin:0;min-height:44px;padding:7px 12px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-weight:500;font-size:14px;line-height:1.3;white-space:nowrap;box-shadow:none}
.period-seg .seg-btn:hover,#main .custom-period>summary:hover{background:var(--wash);color:var(--ink)}
.period-seg .seg-btn[aria-pressed=true],#main .custom-period[data-active=true]>summary{background:var(--ink);color:var(--surface)}
#main details.custom-period{display:flex;align-items:flex-start;gap:8px;margin:0;border:0;background:transparent;padding:0}
#main .custom-period>summary{display:flex;align-items:center;justify-content:center;gap:6px}
#main .custom-period>summary::after{content:none}
#main .custom-period[open]>summary svg{transform:rotate(180deg)}
.custom-period[open]::details-content{display:contents}
.custom-period-body{display:grid;grid-template-columns:repeat(2,minmax(0,154px)) auto;align-items:start;gap:8px}
.date-field{position:relative;min-width:0}
#analytics-filters .date-field input{width:100%;min-width:0;color:var(--ink);font-size:14px}
.date-placeholder{display:none;position:absolute;inset-block-start:1px;inset-inline:1px 40px;height:42px;align-items:center;padding-inline-start:11px;border-radius:8px;background:var(--surface);color:var(--muted);font-size:14px;pointer-events:none}
.date-field input:invalid:not(:out-of-range):not(:focus) + .date-placeholder{display:flex}
.date-field input[aria-invalid=true] + .date-placeholder{background:#fff0ee}
.operations .results-controls button{margin:0}
.custom-period-body button{min-height:44px;padding-block:8px}
.campaign-field{display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;max-width:100%}
.campaign-filter{display:flex;align-items:center;gap:12px;min-width:0;max-width:100%}
.results-controls .campaign-filter label{flex:none;margin:0;color:var(--muted);font-size:14px;line-height:1.4}
.filter-select{position:relative;display:block;min-width:0;max-width:400px}
.results-controls .filter-select select{display:block;appearance:none;width:100%;padding-inline:14px 38px;color:var(--ink);font-size:14px}
.filter-select svg{position:absolute;inset-inline-end:12px;top:50%;transform:translateY(-50%);pointer-events:none}
@media(forced-colors:active){
  .results-controls .filter-select select{appearance:auto}
  .filter-select svg{display:none}
  .period-seg .seg-btn[aria-pressed=true],#main .custom-period[data-active=true]>summary{border:1px solid Highlight;color:Highlight}
}
.history-sources{align-items:center;gap:8px;margin-top:0}
.history-sources .mode{margin:0 4px 0 0;font-size:12.5px}
.source-chip{display:inline-flex;align-items:center;min-height:22px;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:500;background:#ececf1;color:#4b4b55;letter-spacing:0}
.source-chip-goulash{background:#e1f4ee;color:#115950}
.source-chip-system{background:#fff5dc;color:#654600}
.metric-line{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:13.5px;color:var(--muted);margin:8px 0 0}
.metric-line span{white-space:nowrap}
.metric dd.metric-missing{color:var(--muted-2);font-size:24px}
.card-note{font-size:13px;color:var(--muted);margin:14px 0 0;max-width:80ch}
.daily-bars{display:flex;align-items:flex-end;gap:6px;height:132px;margin:14px 0 6px}
.daily-bars i{flex:1;min-width:0;background:var(--chart);border-radius:5px 5px 2px 2px;min-height:2px}
.daily-bars i.zero{background:var(--control-line)}
.daily-axis{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin:0 0 8px}
.daily-total{font-size:13.5px;color:var(--muted);margin:0}
.daily-table{margin:6px 0 0}
.daily-table td:last-child{text-align:right;white-space:nowrap}
.results .rows>div{min-width:0}
#main .results-sources{margin:0}
.results-sources .support{margin-bottom:0}
.results-overview{display:grid;row-gap:16px}
.results-summary{min-width:0}
.results-summary .metric{margin:0}
@media(min-width:981px){
  .results-overview.grid-2 .results-budget{grid-area:1 / 2}
  .results-overview.grid-2:has(.results-summary) .results-budget{grid-row-end:span 2}
  .results-overview.grid-2 .results-refresh{grid-column:1}
}
.results-reports:has(>*){display:grid;gap:16px;margin-top:20px}
.results-reports>.card{min-width:0;margin:0}
.results-metrika.source-state{margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.results-metrika strong{color:var(--ink);font-size:14px}
.results-metrika .inline-link{display:inline-flex;align-items:center;min-height:44px}
.results .rows dd{white-space:normal;overflow-wrap:anywhere;text-align:right}
.results .card-head{flex-wrap:wrap;gap:6px 12px}
.results-table{margin:4px 0 0}
.results-table th,.results-table td{padding:11px 12px}
.results-table th:first-child{padding-left:0}
.results-table th:nth-child(n+2),.results-table td:nth-child(n+2){text-align:right}
.results-table th:last-child,.results-table td:last-child{padding-right:0}
.results-table tr:last-child td,.results-table tr:last-child th{border-bottom:0}
.results-empty{margin:0 0 12px;color:var(--muted);font-size:14px;max-width:60ch}
.source-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}
.source-row{display:grid;align-content:start;gap:6px;min-width:0}
.source-row button{width:100%;justify-content:flex-start;text-align:start}
.source-row button svg{flex:none;margin-inline-start:auto}
.source-state{font-size:12.5px;color:var(--muted);margin:0;display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}
.source-state .data-warning-inline{color:var(--danger)}
.report-facts{margin:6px 0 0}
.report-facts>div{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:4px 0;border-top:1px solid var(--line)}
.report-facts dt{color:var(--muted)}
.report-facts dd{margin:0;text-align:right;overflow-wrap:anywhere}
.previous-reports{margin-top:12px}
.previous-reports>summary{font-size:14px;font-weight:550;min-height:44px;display:flex;align-items:center}
.previous-list{list-style:none;padding:0;margin:10px 0 0;display:grid;gap:10px}
.previous-list li{border-top:1px solid var(--line);padding:10px 0 0;font-size:13.5px}
.previous-list .previous-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-weight:550}
.card-demo{border-style:dashed;border-color:#cfcfd8;background:#fbfbfc;margin-top:26px;padding:22px 24px}
#demo-decision{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
.demo-decision-head{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:0 0 6px}
.demo-decision-head h3{font-size:17px;margin:0}
.card-demo .ops-permission,.card-demo .ops-budget{margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}
.card-demo .ops-heading{margin-bottom:10px}
.card-demo .ops-heading h3{font-size:16.5px;margin:0}
.card-demo .ops-budget-total{font-size:24px;margin:6px 0 10px}
.card-demo .ops-permission form{margin-top:14px}
.card-demo .ops-permission p,.card-demo .ops-budget p{max-width:82ch}
.report-row{padding:14px 0;border-top:1px solid var(--line)}
.report-row:first-of-type{border-top:0;padding-top:0}
.report-row-meta{font-size:13px;color:var(--muted);margin:4px 0 0}
.demo-label{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:0 0 10px}
.demo-lead{font-size:13.5px;max-width:78ch;margin-bottom:20px}
.demo-sub{font-size:16.5px;margin:24px 0 12px;letter-spacing:-.01em}
.demo-status{margin:0 0 14px;font-size:13.5px;color:var(--muted);min-height:20px}
.demo-actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:15px}
.demo-actions:empty{display:none}
.demo-actions>a:not(.button){font-size:13.5px}
.demo-meta{font-size:12.5px;color:var(--muted);margin:10px 0 0}
.entry-effect{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px 18px;margin:14px 0 0;padding:12px 16px;background:var(--wash);border-radius:10px}
.entry-effect>div{min-width:0}
.entry-effect dt{font-size:12px;color:var(--muted)}
.entry-effect dd{margin:2px 0 0;font-weight:500;overflow-wrap:anywhere}
.entry-effect-note{font-size:13px;color:var(--muted);margin:12px 0 0}
.history-side h2{font-size:17px}
@media(max-width:700px){
  .results summary,.operations summary{min-height:44px}
  .operations .history-filters a{min-height:44px;display:inline-flex;align-items:center}
  .operations .ops-guide .ops-link{min-height:44px;display:inline-flex;align-items:center}
  .results-head{display:block}
  .period-seg{display:grid;grid-template-columns:1fr 1fr auto;width:100%;container-type:inline-size}
  .period-seg .seg-btn,#main details.custom-period>summary{padding-inline:8px}
  #main details.custom-period{display:block}
  .custom-period-body{grid-template-columns:repeat(2,minmax(0,1fr));width:100cqi;margin-inline-start:calc(100% - 100cqi);padding:8px 4px 4px}
  .custom-period-body button{grid-column:1/-1;justify-self:start}
  .campaign-field{width:100%;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
  .campaign-filter{display:grid;grid-template-columns:76px minmax(0,1fr)}
  .filter-select{max-width:none}
  .campaign-field button{width:100%}
  .history-sources{flex-wrap:wrap}
  .results .rows>div{display:grid;grid-template-columns:minmax(0,1fr);gap:2px}
  .results .rows dd{text-align:left}
  .metric-line{gap:2px 14px;font-size:13px}
  .metric-line span{white-space:normal}
  .demo-label{display:flex;flex-wrap:wrap;gap:6px 8px}
  .card-demo{padding:18px 16px}
  .daily-bars{height:96px;gap:3px}
  .daily-table td{padding:8px 0}
  .results-table,.results-table tbody{display:block}
  .results-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  .results-table tr{display:block;border-top:1px solid var(--line);padding:12px 0}
  .results-table th{display:block;border:0;padding:6px 0;font-size:16px;text-align:left}
  .results-table td{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;border:0;padding:7px 0;text-align:left;white-space:normal}
  .results-table td:nth-child(n+2),.results-table td:last-child{text-align:left}
  .results-table td::before{content:attr(data-label);color:var(--muted);font-size:12px}
  .results-table tr:last-child{padding-bottom:0}
  .report-facts>div{font-size:12px}
  .entry-effect{padding:12px}
}
@media(max-width:380px){
  .results-table td,.custom-period-body{grid-template-columns:minmax(0,1fr)}
}
`;
