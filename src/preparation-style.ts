export const preparationStyles = `
.campaign-back{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-bottom:6px;color:var(--teal)}
.campaign-back .ui-icon{transform:rotate(180deg)}
.campaign-context{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 0;color:var(--muted);font-size:14px}
.campaign-context .chip{white-space:normal}
.preparation-title .lead,.preparation-title .save-state{margin:6px 0 0;padding:0}
.plan-progress{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%;align-items:stretch;margin:0 0 20px;padding:5px;list-style:none;background:white;border:1px solid var(--line);border-radius:13px}
.plan-progress li{display:flex;position:relative;align-items:stretch;min-width:0}
.plan-progress li>.ui-icon{position:absolute;z-index:1;right:-9px;top:50%;transform:translateY(-50%);color:#647772;background:white;border-radius:50%;pointer-events:none}
.plan-progress .stage{display:inline-flex;flex:1;min-width:0;justify-content:center;gap:9px;align-items:center;padding:10px 12px;margin-inline:9px;min-height:48px;font-size:14px;font-weight:550;line-height:1.25;color:var(--muted);border:0;border-radius:9px;background:#f3f6f6;text-align:left}
.plan-progress li:first-child .stage{margin-left:0}
.plan-progress li:last-child .stage{margin-right:0}
.plan-progress .stage-label{overflow-wrap:normal;text-wrap:balance}
.plan-progress button.stage{cursor:pointer;color:var(--ink)}
.plan-progress button.stage:hover{background:#eaf3f1}
.plan-progress button.stage:disabled{opacity:.76}
.plan-progress .stage-number{width:26px;height:26px;display:grid;place-items:center;flex:none;border:1px solid #a9b6b5;border-radius:50%;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}
.plan-progress [aria-current=step] .stage{color:#fff;background:#115950;font-weight:700}
.plan-progress [aria-current=step] .stage-number{background:white;color:#115950;border-color:white}
.plan-progress button .stage-number{color:#07655b;border-color:#83b7ae}
.preparation-layout{grid-template-columns:minmax(0,1.58fr) minmax(0,1fr);gap:20px}
.preparation-layout[data-stage="2"],.preparation-layout[data-stage="1"]:has(.plan-form details.business-profile):not(:has(.preparation-aside details)){grid-template-columns:minmax(0,1fr)}
.ad-composition{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
.ad-composition .search-preview{margin-top:16px}
.creative-preview h3{margin:0 0 8px}
.creative-preview .ad-preview{overflow-wrap:anywhere}
.creative-preview .ad-url{overflow-wrap:anywhere}
.creative-review form{margin:16px 0}
.direct-reference{display:flex;gap:4px 12px;align-items:baseline;flex-wrap:wrap;margin:6px 0}
.direct-reference code{font-size:14px;white-space:nowrap}
.direct-reference button{min-height:44px}
.direct-reference [data-copy-status]:empty{display:none}
.preparation-layout .form-panel{padding:24px}
.preparation-guide h2,.preparation-group h3{margin:0}
.plan-form .example-link{margin:0}
.preparation-group{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}
.preparation-group h3{margin-bottom:12px}
.preparation-aside{display:grid;gap:12px;min-width:0;align-content:start}
.preparation-guide{min-width:0;padding:22px;background:white;border:1px solid var(--line);border-radius:var(--radius);overflow-wrap:anywhere}
.preparation-guide h2{font-size:18px;margin-bottom:8px}
.preparation-guide p{color:var(--muted)}
.preparation-guide p:last-child{margin-bottom:0}
.preparation-icon{display:inline-grid;place-items:center;width:38px;height:38px;margin-bottom:12px;border-radius:9px;color:var(--teal);background:#e7f6f1}
.search-preview h2{display:flex;align-items:center;gap:9px;color:var(--ink)}
.search-preview h2 .ui-icon{color:var(--teal);flex:none}
.preparation-layout .ad-preview{padding:19px 20px;background:#f8fbfa;margin:16px 0 0;border-color:#d6e3e0}
.search-preview .ad-tag{display:block;font-size:12px;color:var(--muted)}
.search-preview .ad-url{margin:6px 0 0;font-size:13px;color:var(--teal)}
.search-preview .ad-title{color:var(--ink);margin:8px 0 4px;font-weight:600}
.search-preview .ad-body{margin:0;color:#3c4645;font-size:15px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.search-preview .preview-foot{font-size:13px;line-height:1.45;margin:12px 0 0}
.preview-context{margin:14px 0 0;padding-top:10px;border-top:1px solid var(--line);font-size:13px;line-height:1.45}
.preview-context:not(:has(>div:not([hidden]))){display:none}
.preview-context>div:not([hidden]){display:grid;grid-template-columns:minmax(78px,auto) minmax(0,1fr);gap:12px;margin:4px 0}
.preview-context dt{color:var(--muted)}
.preview-context dd{margin:0;text-align:right}
@media(min-width:701px){.preparation-aside:has(>.search-preview:only-child){position:sticky;top:16px;align-self:start}}
.preparation-disclosure{border-top:1px solid var(--line);padding-top:7px;margin:14px 0;overflow-wrap:anywhere}
.preparation-disclosure>summary{cursor:pointer;padding:8px 0;font-weight:600;color:var(--teal)}
.preparation-disclosure>summary .ui-icon{display:inline-block;vertical-align:middle;margin-right:3px}
.preparation-selection{margin:14px 0;padding:14px;border-radius:9px;background:var(--wash);overflow-wrap:anywhere}
.preparation-selection p{margin:6px 0 0;color:var(--muted)}
.preparation-note{display:flex;align-items:flex-start;gap:9px;margin:16px 0;padding:12px 14px;border-radius:8px;background:#e7f6f1;color:#164c45;font-size:14px}
.preparation-note .ui-icon{flex:none;margin-top:2px}
.preparation-facts{margin-top:10px}
.phrase-review{margin-top:20px;padding:2px 14px;background:#eef6f4;border:1px solid #cbdeda;border-radius:9px}
.phrase-review .field-error{margin:0 0 12px}
.business-profile{margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}
.business-profile .section-heading h2{font-size:18px}
.ad-fields{display:grid;gap:4px;margin:16px 0 8px}
.ad-fields .field{margin-bottom:6px}
.ad-fields>button{justify-self:start}
.selected-phrases{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 14px;padding:0;list-style:none}
.selected-phrases li{padding:6px 10px;border:1px solid #cbdad7;border-radius:999px;background:white;font-size:13.5px;overflow-wrap:anywhere}
.phrases-editor{margin:12px 0 16px}
.direct-summary{margin:18px 0;padding:14px 16px;border:1px solid #cdeee0;border-radius:10px;background:#f1fbf6}
.direct-summary p:last-child{margin-bottom:0}
.wording-card{margin:0 0 20px;padding:16px;border:1px solid #bddcde;border-radius:10px;background:#f0fafa}
.wording-card h3,.draft-status h2,.draft-check h3{margin:0 0 6px}
.wording-card p,.draft-status p,.draft-check p{margin:4px 0 8px}
.wording-variants{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0 0;padding:0;list-style:none}
.wording-variants li{min-width:0;padding:14px;border:1px solid #bddcde;border-radius:8px;background:var(--surface);overflow-wrap:anywhere}
.wording-variants button{margin-top:10px}
.wording-variants blockquote{margin:8px 0;padding-inline-start:10px;border-inline-start:2px solid var(--line-strong)}
html:has(main[data-campaign-id]){scrollbar-gutter:stable}
.guided-tabs{display:flex;flex-wrap:wrap;gap:4px 22px;margin:0 0 20px;border-bottom:1px solid var(--line)}
.guided-tabs a{display:inline-flex;align-items:center;min-height:44px;padding:8px 0 5px;border-bottom:3px solid transparent;color:var(--teal);font-weight:550;text-decoration:none}
.guided-tabs a:hover{text-decoration:underline}
.guided-tabs [aria-current]{border-bottom-color:var(--teal);color:var(--ink)}
[data-campaign-panel][aria-busy=true]{cursor:progress}
.draft-check{margin:14px 0;padding:12px 0 0;border-top:1px solid var(--line)}
.draft-status{padding:14px 16px;border-radius:9px;background:var(--warn-bg);color:var(--warn);overflow-wrap:anywhere}
.draft-status.verified{background:var(--ok-bg);color:var(--ok)}
.draft-meta dd{overflow-wrap:anywhere}
#pilot-flow .draft-meta dt{overflow-wrap:normal}
#pilot-flow .draft-meta dd{overflow-wrap:break-word}
#pilot-flow time{white-space:nowrap}
#pilot-limit{font-size:16px}
.pilot-restart{margin-bottom:24px}
#pilot-results-title{scroll-margin-block-start:24px}
#pilot-flow #pilot-report-error{color:var(--error)}
.draft-command{margin:14px 0}
.draft-actions{align-items:center;overflow-wrap:normal}
.draft-actions .primary{margin:0;flex:none}
.draft-actions :is(.button,button){max-width:100%;text-align:center}
.draft-actions .draft-command{margin:0}
.draft-related{display:flex;flex-wrap:wrap;gap:0 16px}
.readiness-checks{margin-top:12px}
.readiness-checks>div{display:grid;grid-template-columns:minmax(min-content,1fr) minmax(0,1.35fr);align-items:center;gap:10px;padding:0}
.readiness-checks :is(dt,dd){overflow-wrap:normal}
@media(max-width:600px){.wording-variants{grid-template-columns:minmax(0,1fr)}}
.final-card{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
.final-card h3{margin:0;font-size:18px}
.final-card .review-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:18px;align-items:start;margin-top:12px}
.final-card .ad-preview{padding:16px 18px;background:#f8fbfa}
.final-card .ad-title{font-size:18px;font-weight:600;line-height:1.3;margin:8px 0 4px}
.final-card .ad-body{margin:0;color:#3c4645;font-size:14px;line-height:1.45}
.final-card .ad-url{margin:6px 0 0;font-size:13px;color:var(--teal)}
.review-facts{display:grid;gap:8px;margin:0}
.review-facts>div{border-top:1px solid var(--line);padding-top:8px}
.review-facts>div:first-child{border-top:0;padding-top:0}
.review-facts dt{font-size:12.5px;color:var(--muted);margin-bottom:2px}
.review-facts dd{margin:0;font-size:14px;overflow-wrap:anywhere}
.budget-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.assure{display:flex;gap:9px;align-items:flex-start;margin:14px 0;padding:11px 13px;border-radius:9px;background:#f1fbf6;border:1px solid #cdeee0;font-size:13.5px;color:#1d5c40}
.assure .ui-icon{color:var(--ok);flex:none;margin-top:1px}
.account-line{display:flex;align-items:center;gap:10px;justify-content:space-between;border-top:1px solid var(--line);margin-top:16px;padding-top:14px;font-size:14px;flex-wrap:wrap}
.account-line .left{display:flex;align-items:center;gap:9px;min-width:0}
.final-confirm{margin:18px 0;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:white}
.final-card .check input{margin-top:3px}
.after{display:grid;gap:10px;margin:0;padding:0;list-style:none}
.after li{display:flex;gap:10px;font-size:14px;color:var(--muted)}
.after .n{width:22px;height:22px;border-radius:50%;background:#f1f1f5;display:grid;place-items:center;font-size:12px;color:#4b4b55;flex:none}
.plan-form .plan-actions{display:flex;flex-wrap:nowrap;align-items:stretch;justify-content:flex-end;gap:10px;margin-top:24px;padding-top:18px}
.plan-form .plan-actions :is(button,.button){width:auto;margin:0;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.plan-form .plan-actions .primary{margin:0;flex:0 1 auto}
.plan-form #local-recovery-note:empty{display:none}
.plan-form .profile-offer .field textarea{min-height:70px}
.connect-card form{margin:14px 0}
main>.flow-layout+.form-panel,main>.form-panel+.form-panel,.draft-readiness+.form-panel{margin-top:18px}
.connect-card code{overflow-wrap:anywhere}
@media(max-width:700px){
  .preparation-layout{grid-template-columns:minmax(0,1fr);gap:16px}
  .ad-composition{grid-template-columns:minmax(0,1fr);gap:12px}
  .ad-composition .search-preview{margin-top:0}
  .preparation-layout .form-panel,.preparation-guide{padding:18px}
  .plan-progress{padding:3px}
  .plan-progress li{position:relative;align-items:stretch;justify-content:center}
  .plan-progress li>.ui-icon{display:none}
  .plan-progress .stage{flex:1;min-width:0;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;gap:5px;font-size:12px;line-height:1.2;padding:6px 2px;margin:0 4px}
  .plan-progress .stage-number{width:25px;height:25px}
  .plan-progress .stage-label{overflow-wrap:normal;text-wrap:balance}
  .plan-form .plan-actions{gap:8px;justify-content:space-between}
  .plan-form .plan-actions :is(button,.button){padding:9px 10px}
  .draft-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
  .draft-actions :is(.button,button){width:100%}
  .draft-actions .task-link{justify-self:start}
  .preparation-layout[data-stage="3"] .preparation-aside{display:contents}
  .preparation-layout[data-stage="3"] .search-preview{grid-row:1}
  .budget-row,.final-card .review-grid{grid-template-columns:1fr}
}
@media(max-width:480px){
  .guided-tabs{justify-content:space-between;gap:4px 8px}
  .guided-tabs a{font-size:13px}
  .plan-form .plan-actions{flex-direction:column;align-items:stretch}
  .plan-form .plan-actions .primary{width:100%}
  .plan-form .plan-actions .secondary{width:100%}
}
@media(max-width:365px){.plan-progress .stage{font-size:11px;margin-inline:3px}.plan-form .plan-actions :is(button,.button){font-size:13px}}
`;
