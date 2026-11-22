import { adStepStyles } from './ad-step-style.ts';
import { cabinetStyles } from './cabinet-style.ts';
import { operationsStyles } from './operations-style.ts';
import { offerEditorStyles } from './offer-editor-style.ts';
import { preparationStyles } from './preparation-style.ts';
import { disclosureStyles } from './disclosure-style.ts';
import { businessFieldStyles } from './business-field-style.ts';
import { campaignCatalogStyles } from './campaign-catalog-style.ts';
import { overviewStyles } from './overview-style.ts';
import { resultsStyles } from './results-style.ts';
import { campaignWorkspaceStyles } from './campaign-workspace-style.ts';
import { connectionStyles } from './connection-style.ts';

export const styles = `
.direct-panel{margin-top:32px;padding:24px;background:white;border:1px solid #d8d8df;border-radius:12px}.direct-panel .comparison{background:#f6f6f8;border-color:#d8d8df}.direct-event{border-top:1px solid #d8d8df;padding:20px 0}.direct-steps{padding-left:20px;line-height:1.9}.direct-panel dd,.direct-panel code,.direct-panel .hint{overflow-wrap:anywhere}.direct-panel form{margin:18px 0}.direct-panel button{margin-top:12px}@media(max-width:700px){.direct-panel{padding:16px}.direct-panel .preview-meta div{display:block}.direct-panel .preview-meta dd{text-align:left;margin-top:6px}}

@font-face{font-family:Onest;src:url('/assets/Onest.ttf') format('truetype');font-weight:100 900;font-display:swap}
@font-face{font-family:"Pixelify Sans";src:url('/assets/PixelifySans.ttf') format('truetype');font-weight:400 700;font-display:swap}
:root{--ink:#040406;--muted:#616169;--muted-2:#73737d;--line:#e4e4ea;--line-strong:#d3d3dc;--control-line:#858590;--chart:#008187;--wash:#f6f6f8;--surface:#fff;--dark:#0a0a0c;--cyan:#00ffff;--cyan-deep:#00b9c4;--teal:#006c73;--ok:#0f7a4a;--ok-bg:#e8f7ef;--warn:#8a5a00;--warn-bg:#fff5dc;--danger:#a12424;--error:#a12424;--radius:16px;--shadow:0 1px 2px rgba(4,4,6,.04),0 10px 30px -18px rgba(4,4,6,.18)}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:400 15px/1.5 Onest,Arial,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
::selection{background:var(--cyan);color:var(--ink)}input,textarea{caret-color:var(--teal)}:focus-visible{outline:3px solid var(--teal);outline-offset:3px}
a{color:inherit;text-underline-offset:4px}a:hover{color:var(--teal)}button,input,textarea,select{font:inherit}button,a,input,select,textarea{-webkit-tap-highlight-color:transparent}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:11px 20px;border:1px solid var(--ink);border-radius:10px;background:var(--ink);color:white;font-weight:550;text-decoration:none;cursor:pointer;line-height:1.35}
button:hover,.button:hover{background:#303034;color:white}button.primary,.button.primary{background:var(--cyan);border-color:var(--teal);color:var(--ink)}button.primary:hover,.button.primary:hover{background:#7fffff;border-color:var(--teal);color:var(--ink)}
button.secondary,.button.secondary{background:white;color:var(--ink);border-color:var(--control-line)}button.secondary:hover,.button.secondary:hover{background:#eeeeF1;color:var(--ink)}
button.text-button{min-height:44px;padding:7px 0;background:transparent;border:0;color:var(--ink);text-decoration:underline;text-underline-offset:4px}button:disabled{opacity:.55;cursor:not-allowed}
.task-link{display:inline-flex;align-items:center;min-height:44px}
input,select,textarea,button,summary{scroll-margin-block:24px}
:is(input,select,textarea)[aria-invalid=true]{outline:2px solid var(--error);outline-offset:1px}
:is(input,select,textarea)[aria-invalid=true]:focus-visible{outline:3px solid var(--teal);outline-offset:3px;background:#fff0ee}
.check:has(input[aria-invalid=true]){background:#fff0ee}
.topbar :focus-visible{outline-color:var(--cyan)}
.account-panel :focus-visible{outline-color:var(--teal)}
[hidden]{display:none!important}.skip{position:absolute;top:-100px;left:20px;z-index:10;background:white;padding:12px}.skip:focus{top:12px}
.topbar{background:var(--ink);color:white}.topbar-inner,main,.footer{width:min(1200px,100%);margin:0 auto;padding-inline:32px}.topbar-inner{min-height:64px;display:flex;align-items:center;gap:30px}
.brand{display:flex;gap:14px;align-items:center;min-height:44px;text-decoration:none;font:500 26px/1 "Pixelify Sans",Onest,Arial,sans-serif;letter-spacing:.04em;white-space:nowrap}
.brand:hover{color:white}
.topbar-guide{margin-inline-start:auto;display:inline-flex;align-items:center;min-height:44px;color:#e6e6ea;font-size:14px}
.topbar-guide:hover{color:var(--cyan)}
.guide-heading{align-items:center;margin-block-end:30px}
.guide-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.24fr);gap:clamp(24px,4vw,52px);align-items:start}
.guide-story section{padding-block:18px;border-bottom:1px solid var(--line)}
.guide-story section:first-child{padding-block-start:0}
.guide-story section:last-child{border:0;padding-block-end:0}
.guide-story h2,.guide-scenarios h2{margin:0 0 10px;font-size:22px;line-height:1.3}
.guide-story p,.guide-scenarios p{margin:0}
.guide-story p+p{margin-top:9px}
.guide-scenarios ol{margin:17px 0 0;padding-inline-start:23px}
.guide-scenarios li+li{margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}
.guide-scenarios li::marker{color:var(--teal);font-weight:650}
.guide-scenarios h3{margin:0 0 4px;font-size:16px;line-height:1.35}
.guide-scenarios p a{color:var(--teal)}
@media(max-width:820px){.guide-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:420px){.guide-heading{gap:14px}.guide-heading .button{width:100%}}
@media(min-width:821px){
  .topbar-inner:has(>.nav){column-gap:20px}
  .brand:has(+.nav)::after{content:"";block-size:24px;inline-size:1px;margin-inline-start:6px;background:#55555e}
}
.mark{display:grid;width:26px;height:26px;grid-template-columns:repeat(3,1fr);padding:5px;gap:2px;background:var(--cyan);border-radius:6px}.mark i{background:var(--ink)}.mark i:nth-child(2),.mark i:nth-child(4),.mark i:nth-child(9){background:transparent}
.test-badge{display:inline-block;font-size:12px;line-height:1.4;font-weight:550;background:#fff1c9;color:#604700;padding:5px 9px;border-radius:6px}.topbar-inner>.test-badge{margin-left:auto}
.account{position:relative;margin:0 0 0 auto;min-width:0}
.account>summary{list-style:none;display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:1px solid #3b3b42;border-radius:10px;cursor:pointer;font-size:13.5px;color:#e6e6ea}
.account>summary::-webkit-details-marker{display:none}
.account>summary:hover,.account[open]>summary{border-color:#5a5a63;background:#15151a}
.account[open]>summary>.ui-icon:last-child{transform:rotate(180deg)}
.account-name{max-width:min(20vw,22ch);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.account-label{display:none}
@media(max-width:480px){.account-label{display:block}.account-name{display:none}}
.account-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:min(270px,calc(100vw - 32px));max-height:calc(100dvh - 80px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));overflow:auto;overscroll-behavior:contain;scroll-padding-block:8px;background:white;color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:8px}
.account-panel .account-state{display:flex;align-items:center;gap:8px;margin:0 0 4px;padding:9px 10px 12px;border-bottom:1px solid var(--line);font-size:13px;color:var(--muted)}
.account-panel .account-owner{margin:0;padding:6px 10px 0;font-size:14px;font-weight:550;overflow-wrap:anywhere}
.account-panel a{display:flex;align-items:center;gap:8px;min-height:44px;padding:9px 10px;border-radius:8px;color:var(--ink);text-decoration:none;font-size:14px}
.account-panel a:hover{background:var(--wash);color:var(--ink)}
.account-panel form{margin:6px 0 0;border-top:1px solid var(--line);padding-top:6px}
.account-panel button{width:100%;min-height:44px;margin:0;padding:9px 10px;background:transparent;color:var(--ink);border:0;justify-content:flex-start;font-weight:500}
.account-panel button:hover{background:var(--wash);color:var(--ink)}
.status-dot{width:7px;height:7px;border-radius:50%;background:#a6a6b0;flex:none}.status-dot.ok{background:var(--ok)}
.nav{display:flex;gap:26px;align-self:stretch}
.nav a{display:flex;align-items:center;min-height:44px;color:#c3c3ca;text-decoration:none;font-size:14.5px;padding:0;border-bottom:3px solid transparent;white-space:nowrap}
.nav a:hover{color:white}
.nav a[aria-current=page]{color:white;border-bottom-color:var(--cyan)}
main{padding-top:32px;padding-bottom:48px;min-height:calc(100vh - 210px)}h1{font-size:36px;line-height:42px;font-weight:400;overflow-wrap:anywhere;letter-spacing:-.025em;margin:0 0 12px}h2{font-size:23px;line-height:1.3;font-weight:550;letter-spacing:-.02em;margin:0 0 10px}h3{font-size:18px;font-weight:550;margin:24px 0 10px}p{margin:0 0 14px}.lead,.muted,.mode{color:var(--muted)}.lead{max-width:70ch}.page-heading{display:flex;align-items:start;justify-content:space-between;gap:20px;margin-bottom:26px}.page-heading .lead{margin:0}.save-state{flex:none;font-size:13px;color:var(--muted);padding-top:10px}.save-state.dirty{color:#815000}
.steps{display:flex;list-style:none;margin:0 0 28px;padding:0;gap:22px}.steps li{display:flex;align-items:center;gap:10px;flex:1;padding-bottom:16px;border-bottom:1px solid var(--line);font-size:14px;color:var(--muted)}.steps li[aria-current=step]{color:var(--ink);border-color:var(--ink)}.steps .number{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;border:1px solid #bcbcc4;border-radius:50%;font-size:13px}.steps [aria-current=step] .number{background:var(--ink);color:var(--cyan);border-color:var(--ink)}.steps button{display:inline;padding:0;min-height:32px;color:inherit;background:none;border:0;font-size:inherit;font-weight:inherit;text-decoration:underline;text-underline-offset:4px}
.flow-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,.85fr);gap:32px;align-items:start}.form-panel{min-width:0;background:white;border:1px solid var(--line);border-radius:var(--radius);padding:28px 32px}.help-panel{padding:24px 8px 0}.help-panel p{max-width:42ch}.help-panel ul{padding-left:20px;color:var(--muted);margin:20px 0 28px}.help-panel li{margin-bottom:12px}.help-panel h2{font-size:18px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}.field{margin-bottom:20px;min-width:0}.field label{display:block;margin-bottom:7px;font-size:14px;font-weight:550}.field input,.field select,.field textarea{display:block;width:100%;border:1px solid var(--control-line);border-radius:9px;background:white;color:var(--ink);padding:11px 12px;min-height:46px}.field textarea{resize:vertical;min-height:110px}.field input:hover,.field select:hover,.field textarea:hover{border-color:var(--ink)}.field :is(input,select,textarea)[aria-invalid=true]{border-color:var(--error)}
.hint,.counter{font-size:12px;color:var(--muted);margin:7px 0 0}.counter{text-align:right}.field-error{font-size:13px;color:var(--error);margin:7px 0 0}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:22px;border-top:1px solid var(--line);margin-top:8px}.actions .primary{margin-left:auto}.example-link{display:inline-block;margin-bottom:22px;font-size:14px}.notice{margin-bottom:24px;padding:16px 20px;background:#e8f5f0;color:#154a36;border:1px solid #b5daca;border-radius:10px;max-width:100%}.notice.error{color:#792121;background:#fff0ee;border-color:#e7bbb7}.notice p:last-child{margin-bottom:0}.notice ul{margin:8px 0 0;padding-left:20px}.notice.recovery{background:#fff6df;border-color:#ddcd9f;color:#654600}.notice button{margin-top:10px}.notice:focus{outline:2px solid var(--teal)}
.preview-panel{position:sticky;top:24px;min-width:0}.preview-label{font-size:13px;color:var(--muted);margin-bottom:12px}.ad-preview{background:white;padding:28px;border:1px solid var(--line);border-radius:var(--radius);overflow-wrap:anywhere}.ad-preview .ad-title{font-size:22px;font-weight:550;line-height:1.3;letter-spacing:-.02em;margin:12px 0}.ad-url{color:var(--teal);font-size:13px}.ad-tag{font-size:12px;color:var(--muted)}.preview-meta{margin:24px 0 0}.preview-meta div{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:12px 0;font-size:14px}.preview-meta dt{color:var(--muted)}.preview-meta dd{margin:0;text-align:right;overflow-wrap:anywhere}.preview-foot{font-size:13px;color:var(--muted);margin-top:20px}
details{margin-top:18px}summary{cursor:pointer}blockquote{margin:16px 0;padding:0 0 0 14px;border-left:1px solid #bcbcc4;color:var(--muted);font-size:14px}.source-note{font-size:13px;padding-bottom:14px;margin-bottom:22px;border-bottom:1px solid var(--line)}.suggestion{margin:18px 0 24px;padding-top:16px;border-top:1px solid var(--line)}.suggestion summary{font-size:14px;font-weight:550}.suggestion p{font-size:14px;margin-top:12px}.check{display:flex;gap:10px;align-items:start;margin:18px 0;font-size:14px}.check input{margin-top:4px;width:18px;height:18px;flex:none;accent-color:var(--ink)}.comparison{margin:0 0 24px;padding:22px;background:#fff6df;border:1px solid #ddcd9f;border-radius:var(--radius)}.comparison h2{font-size:19px}.comparison table{font-size:13px}.comparison td{white-space:pre-wrap}.comparison p{font-size:14px}
.operations>section,.diagnostics,.login{background:white;border:1px solid var(--line);border-radius:var(--radius);padding:28px 32px}.operations form select,.operations form input:not([type=hidden]):not([type=checkbox]),.diagnostics input{font:inherit;min-height:44px;padding:10px 12px;border:1px solid var(--control-line);border-radius:9px;max-width:100%;background:white}.operations form label,.diagnostics label{display:block;margin:16px 0 8px}.operations form button{margin-top:12px}.operations .mode{font-size:13px}.operations #demo>p{max-width:80ch}.table-scroll{overflow-x:auto;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px 14px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{font-weight:550}caption{text-align:left;font-weight:550;padding-bottom:14px}.history-entry{border-top:1px solid var(--line);padding:24px 0;overflow-wrap:anywhere}.history-entry h3{margin:0 0 12px}.history-entry p{font-size:14px}.history-entry form{margin-top:16px}.footer{font-size:12px;color:var(--muted);padding-bottom:24px}.login{max-width:650px;margin:30px auto}.diagnostics{max-width:650px}.diagnostics input{width:100%;margin-bottom:14px}.inline-link{font-size:14px}.section-context{margin:0 0 22px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted)}

/* ---------- каркас страницы: сетка, карточки, статусы ---------- */
.page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:26px;flex-wrap:wrap}
.page-head>div{min-width:0}
.page-head h1{margin:0}
.page-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.grid-2{display:grid;grid-template-columns:minmax(0,1fr) 336px;gap:20px;align-items:start}
.col-main{display:grid;gap:20px;min-width:0}
.col-side{display:grid;gap:16px;min-width:0}
.card{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px}
.card-quiet{background:#fbfbfc}
.card-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:16px}
.card-head h2{margin:0;font-size:16.5px;letter-spacing:-.01em}
.lead{color:var(--muted);font-size:14.5px;margin-top:6px;max-width:62ch}
.small{font-size:13px}.nowrap{white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 10px;border-radius:999px;font-size:12.5px;font-weight:500;white-space:nowrap}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.chip-live{background:var(--ok-bg);color:var(--ok)}
.chip-draft{background:#ececf1;color:#4b4b55}
.chip-paused,.chip-review{background:var(--warn-bg);color:var(--warn)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:10px;border:1px solid transparent;font-weight:500;font-size:15px;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn-primary{background:var(--cyan);color:var(--ink);border-color:var(--teal)}
.btn-primary:hover{background:#33ffff;color:#04191b}
.btn-secondary{background:#fff;color:var(--ink);border-color:var(--control-line)}
.btn-secondary:hover{background:#fafafc;color:var(--ink);border-color:#b7b7c2}
.btn-lg{min-height:52px;padding:0 24px;font-size:16px}
.btn-sm{min-height:36px;padding:0 12px;font-size:13.5px;border-radius:9px}
.progress{height:6px;border-radius:999px;background:#ebebf0;overflow:hidden}
.progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#00e2ee,#00aab5)}
.rows{display:grid;gap:10px;margin:16px 0 0}
.rows>div{display:flex;justify-content:space-between;gap:16px;font-size:14px}
.rows dt{color:var(--muted)}
.rows dd{margin:0;font-weight:500;white-space:nowrap}
.big{font-size:26px;font-weight:600;letter-spacing:-.02em;margin:4px 0 0}
.big span{font-size:14px;font-weight:400;color:var(--muted);letter-spacing:0}
.metrics-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.metric{min-width:0;background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.metric dt{font-size:13px;color:var(--muted)}
.metric dd{font-size:29px;font-weight:600;letter-spacing:-.025em;margin:4px 0 0;white-space:nowrap}
.metric dd .sub{display:block;font-size:12.5px;color:var(--muted-2);margin-top:2px;font-weight:400;letter-spacing:0;white-space:normal}
.support{margin-top:14px;border-top:1px solid var(--line);padding-top:12px}
.support>summary{cursor:pointer;font-size:13.5px;color:var(--teal);font-weight:500;min-height:32px}
#main .support{margin-top:12px;padding:0;border:0;background:transparent}
#main .support>summary{margin:0;padding:6px 20px 6px 0;min-height:44px;background:transparent;border:0;color:var(--teal);font-weight:500;font-size:13.5px;display:inline-flex;align-items:center;gap:8px}
#main .support>summary::after{right:4px}
#main .support[open]>summary{margin-bottom:8px;border:0}
.support-body{font-size:13px;color:var(--muted);display:grid;gap:8px;margin-top:10px;max-width:80ch}
.support-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f1f1f5;padding:2px 6px;border-radius:5px;color:#3b3b43;white-space:nowrap}
@media(max-width:980px){.grid-2{grid-template-columns:1fr}}
@media(max-width:700px){.page-head{margin-bottom:20px}.card{padding:18px 16px}.metrics-three{grid-template-columns:1fr}.metric dd{font-size:24px}.support-body code{white-space:normal;word-break:break-all}}
@media(max-width:370px){.nav a{font-size:12.5px}}
@media(max-width:900px){.topbar-inner,main,.footer{padding-inline:24px}.flow-layout{gap:22px;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}.form-panel{padding:24px}.field-grid{grid-template-columns:1fr}.steps{gap:14px}.steps li{font-size:13px}.ad-preview{padding:22px}.topbar-inner{gap:16px}}
@media(max-width:820px){
  .topbar-inner{min-height:56px;padding-top:calc(10px + env(safe-area-inset-top,0px));gap:12px;flex-wrap:wrap}
  .nav{width:100%;justify-content:space-between;gap:0 12px;border-top:1px solid #26262c;flex-wrap:wrap}
}
@media(max-width:700px){.topbar-inner,main,.footer{padding-inline:16px}.brand{font-size:23px;gap:9px}.mark{width:24px;height:24px}.account>summary{padding:0 9px;font-size:12.5px}.nav a{font-size:13px;padding:12px 0}.page-heading{display:block;margin-bottom:22px}h1{font-size:28px;line-height:34px}.lead{font-size:14px}.save-state{padding-top:12px}main{padding-top:26px}.steps{gap:8px;margin-bottom:22px}.steps li{align-items:flex-start;flex-direction:column;gap:8px;font-size:12px;padding-bottom:12px}.steps button{min-height:36px;text-align:left}.steps .number{width:25px;height:25px;font-size:12px}.flow-layout{grid-template-columns:1fr;gap:24px}.form-panel{padding:22px 18px}.help-panel{padding:0 4px}.preview-panel{position:static}.field-grid{grid-template-columns:1fr}.actions{gap:12px}.actions .primary{margin-left:0;flex:1}.actions .text-button{flex-basis:100%;order:2}button,.button{font-size:14px;padding:12px 16px}.notice{padding:14px 16px;font-size:14px}.operations>section{padding:22px 18px}.operations table{min-width:580px}.operations th:first-child{position:sticky;left:0;background:white;min-width:110px}.comparison{padding:18px}.comparison table{min-width:500px}.ad-preview{padding:22px}.preview-meta div{font-size:14px}}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.operations>section+section{margin-top:24px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:18px}.section-heading h2{margin:0}.section-heading>.muted{font-size:13px;white-space:nowrap}
.report-context{font-size:14px}.report-context p{margin-bottom:8px}.report-quality{display:flex;gap:8px;flex-wrap:wrap;padding-top:5px}.state-tag{display:inline-block;background:#ededf1;color:#494952;padding:5px 9px;border-radius:6px;font-size:12px;line-height:1.4}.state-tag.success{background:#e8f5f0;color:#154a36}.state-tag.caution{background:#fff1c9;color:#604700}
.metrics,.budget-equation{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:20px;padding:24px 0 20px;margin:24px 0 10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.metrics dt,.budget-equation dt{font-size:13px;color:var(--muted);margin-bottom:8px}.metrics dd,.budget-equation dd{font-size:25px;font-weight:550;line-height:1.3;margin:0;overflow-wrap:anywhere;letter-spacing:-.02em}.budget-equation{grid-template-columns:repeat(4,minmax(0,1fr))}.budget-equation>div:last-child{border-left:1px solid var(--line);padding-left:20px}
.operations .responsive-table{margin:26px 0;width:100%;min-width:0;table-layout:fixed}.responsive-table td,.responsive-table th{padding:16px 12px}.responsive-table th:first-child{width:16%;position:static;min-width:0}.responsive-table td[data-label='Стоимость достижения']{font-size:13px}.responsive-table thead{color:var(--muted)}
.section-next{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}.section-next p{margin:0;font-size:14px;max-width:48ch}.section-next .button{flex-shrink:0}.support-details{padding-top:18px;border-top:1px solid var(--line);margin-top:22px}.support-details summary{font-size:14px;font-weight:550;min-height:28px}.support-details[open] summary{margin-bottom:16px}.support-details>p{max-width:80ch;font-size:14px}.dataset-controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.operations .dataset-controls select{min-width:0;flex:1}.operations .dataset-controls button{margin:0}.dataset-form .mode{margin-top:12px}.data-warning,.expense-note{padding:14px 16px;background:#fff6df;border-radius:9px;color:#654600;font-size:14px;margin:20px 0}.expense-note{background:#e8f5f0;color:#154a36}
.entry-heading{display:flex;align-items:baseline;justify-content:space-between;gap:20px}.entry-heading time{font-size:12px;color:var(--muted);flex:none}.entry-heading h3{margin:0}.history-entry .entry-meta,.entry-meta{color:var(--muted);font-size:12px;margin:8px 0 14px}.history-entry>p{max-width:85ch}.entry-actions{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:18px}.entry-actions:empty{display:none}.entry-actions>a:not(.button),.undo-unavailable{font-size:13px}.history-entry details{margin-top:12px}.history-reason{margin-top:16px;max-width:85ch}.history-entry summary{font-size:14px;min-height:32px}.history-entry.selected{background:#f2fcfc;padding:24px 20px;margin-inline:-20px}.history-entry:target{scroll-margin-top:24px;outline:2px solid var(--teal);outline-offset:8px}.history-filters{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 16px}.history-filters a{display:inline-flex;align-items:center;min-height:44px;text-decoration:none;padding:9px 13px;border:1px solid var(--line);border-radius:9px;font-size:14px}.history-filters a[aria-current=page]{background:var(--ink);color:white;border-color:var(--ink)}.history-filters span{margin-left:5px;font-size:12px}.history-filters a:not([aria-current]) span{color:var(--muted)}
.change-list{margin:20px 0;font-size:14px}.change-list>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:20px;border-top:1px solid var(--line);padding:12px 0}.change-list dt{font-weight:550;padding-top:2px}.change-list dd{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:0;min-width:0}.change-value{white-space:pre-wrap;overflow-wrap:anywhere}.change-value small{display:block;font-size:11px;color:var(--muted);margin-bottom:4px}.rule-evidence{padding-left:20px;font-size:14px;max-width:85ch}.rule-evidence li{margin:12px 0}.run-rule{border-top:1px solid var(--line);padding-top:18px;margin-top:24px}.operations .run-rule button{margin:0}.run-rule .mode{max-width:85ch;margin:12px 0 0}.undo-review{scroll-margin-top:24px}.undo-review>p{font-size:14px;max-width:85ch}.empty-state{padding-block:24px}.empty-state h3{margin-top:0}.section-tail{font-size:14px;margin-top:24px}
@media(max-width:900px){.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.metrics dd,.budget-equation dd{font-size:22px}.section-next{align-items:flex-start}.entry-heading{align-items:flex-start;flex-direction:column;gap:4px}.entry-heading time{font-size:12px}}
@media(max-width:700px){.section-heading{align-items:flex-start;flex-direction:column;gap:12px}.metrics,.budget-equation{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 16px;padding-block:20px}.metrics>div:last-child{grid-column:1/-1}.metrics dd,.budget-equation dd{font-size:clamp(18px,5vw,22px)}.budget-equation>div:last-child{border:0;padding:0}.report-context{font-size:13px}.section-next{flex-direction:column;gap:16px}.section-next .button{width:100%}.dataset-controls{flex-direction:column;align-items:stretch}.operations .dataset-controls select{width:100%;font-size:13px}.operations .responsive-table,.responsive-table tbody{display:block}.responsive-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.responsive-table tr{display:block;border-top:1px solid var(--line);padding:12px 0 18px}.operations .responsive-table th:first-child{display:block;width:auto;position:static;padding:8px 0 12px;background:transparent;border:0;font-size:16px}.responsive-table td{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;border:0;padding:8px 0;font-size:14px}.responsive-table td::before{content:attr(data-label);color:var(--muted);font-size:12px}.operations .responsive-table{margin:22px 0}.history-filters{gap:6px}.history-filters a{font-size:12px;padding:10px}.entry-actions{gap:12px}.history-entry.selected{padding:22px 10px;margin-inline:-10px}.change-list>div{grid-template-columns:1fr;gap:10px}.change-list dd{gap:16px}.history-entry:target{outline-offset:3px}.undo-review .actions .primary{flex-basis:100%}}
@media(prefers-reduced-motion:no-preference){button,.button,a{transition:background-color .15s,color .15s,border-color .15s}}
.notice.neutral{background:var(--surface);color:var(--ink);border-color:var(--line)}
#metrika-title{scroll-margin-block-start:24px}

.phrase-list{list-style:none;padding:0;margin:16px 0}.phrase-row{padding:12px 0;border-bottom:1px solid #d9d9df}.phrase-row .check{align-items:flex-start}.phrase-row .check input{flex:0 0 auto;margin-top:4px}.phrase-row strong,.phrase-row .hint{overflow-wrap:anywhere}.phrase-preparation form{margin-top:24px}.phrase-preparation details{margin:20px 0}.phrase-preparation .field{margin-top:16px}

.plan-steps { flex-wrap: wrap; }
.profile-offer { border: 1px solid #dedee3; border-radius: 12px; padding: 16px; margin: 20px 0; min-width: 0; }
.profile-offer legend { font-weight: 650; padding: 0 6px; }
.plan-form details { margin: 16px 0; }
.plan-form details > summary { cursor: pointer; font-weight: 600; padding: 8px 0; }
.plan-form .check { margin: 14px 0; }
.optional-exclusion { border-top: 1px solid #e5e5e8; padding-top: 12px; }
.plan-form input, .plan-form textarea, .plan-form select { max-width: 100%; }
@media (max-width: 700px) { .plan-steps li { width: calc(50% - 12px); } .plan-form .actions { flex-wrap: wrap; } .plan-form .actions button { width: 100%; } }
${cabinetStyles}
${preparationStyles}
${operationsStyles}
${disclosureStyles}
${offerEditorStyles}
${businessFieldStyles}
${adStepStyles}
${campaignCatalogStyles}
${overviewStyles}
${resultsStyles}
${campaignWorkspaceStyles}
${connectionStyles}
`;
