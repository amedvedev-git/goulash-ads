export const connectionStyles = `
.connection-page-heading h1{font-size:clamp(30px,4vw,46px);font-weight:480;letter-spacing:-.045em}
.connection-settings{--connection-edge:24px;--connection-gap:12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;gap:14px;margin-top:24px}
.connection-card{display:grid;grid-template-rows:auto 1fr auto;min-width:0;padding:var(--connection-edge);background:var(--surface);border:1px solid var(--line);border-radius:14px}
.connection-card-heading{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:9px;min-height:32px;padding-bottom:15px;border-bottom:1px solid var(--line)}
.connection-name{display:flex;align-items:center;min-width:0;gap:9px}
.connection-logo{width:24px;height:24px;flex:none;object-fit:contain}
.connection-card h2{margin:0;font-size:18px;line-height:24px;font-weight:580;letter-spacing:-.02em}
.connection-badge{display:inline-flex;align-items:center;width:fit-content;gap:6px;padding:3px 7px;border-radius:5px;background:#efeff2;color:#505058;font-size:16px;line-height:1.25;font-weight:550;letter-spacing:-.02em}
.connection-badge::before{content:'';display:block;flex:none;width:5px;height:5px;border-radius:50%;background:currentColor}
.connection-badge.ok{background:#e9f6ef;color:#16583e}.connection-badge.pending{background:#fff0ce;color:#765000}
.connection-facts{display:grid;align-content:start;gap:10px;margin:0;min-width:0}
.connection-card>.connection-facts{padding-block:16px;min-height:94px}
.connection-card>.connection-facts>div{display:grid;grid-template-columns:minmax(92px,.75fr) minmax(0,1fr);gap:8px;align-items:baseline}
.connection-facts dt{color:var(--muted);font-size:13px}.connection-facts dd{margin:0;font-size:14px;font-weight:580;overflow-wrap:anywhere}
.connection-open{grid-row:3;width:100%}
.connection-settings :is(.button,button).secondary{background:#e7f3f3;border-color:#648688;color:#09565b}
.connection-settings :is(.button,button).secondary:hover{background:#d8ebeb;border-color:var(--teal)}

body:has(.connection-dialog[open]){overflow:hidden;padding-inline-end:var(--connection-scroll-space,0px)}
.connection-dialog{position:fixed;inset:0;width:608px;max-width:calc(100% - 28px);max-height:calc(100dvh - 28px);padding:0;border:1px solid #bbc7c9;border-radius:14px;background:var(--surface);color:var(--ink);overflow:hidden;box-shadow:0 16px 64px #0004}
.connection-dialog[open]{display:grid;grid-template-rows:auto minmax(0,1fr) auto}
.connection-dialog::backdrop{background:#070b1087}
.connection-dialog[open]:not(:modal){z-index:90;box-shadow:0 0 0 100vmax #070b1087}
.connection-dialog :is(.connection-dialog-heading,.connection-dialog-body,.connection-dialog-actions){padding-inline:var(--connection-edge)}
.connection-dialog-heading{min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding-block:13px;border-bottom:1px solid var(--line)}
.connection-dialog-heading .connection-name{flex:1;gap:10px}
.connection-dialog-heading h2{margin:0;font-size:22px;line-height:1.2;font-weight:580;letter-spacing:-.025em}
.connection-dialog-heading .connection-badge{margin-inline-start:auto}
.connection-dialog .connection-close.secondary{min-width:44px;min-height:44px;width:44px;padding:0;border-color:transparent;border-radius:8px;background:var(--wash);color:var(--ink);font-size:24px}
.connection-dialog .connection-close.secondary:hover{border-color:var(--control-line);background:#eeeef2}
.connection-dialog-body{display:grid;grid-auto-rows:max-content;gap:18px;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding-block:18px 20px}
.connection-dialog-actions{display:flex;justify-content:flex-start;align-items:center;gap:6px 16px;flex-wrap:wrap;padding-block:12px 13px;border-top:1px solid var(--line);background:var(--wash)}
.connection-block{display:grid;gap:9px;min-width:0}.connection-block+.connection-block{padding-top:16px;border-top:1px solid var(--line)}
.connection-block-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:44px}
.connection-block h3{margin:0;font-size:16px;line-height:1.35;font-weight:630}
.connection-block p,.connection-confirm p{margin:0;overflow-wrap:anywhere}
.connection-block .connection-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}
.connection-block .connection-facts dd{margin-top:3px;font-size:16px}
.connection-links,.connection-buttons,.connection-access{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.connection-links a,.connection-dialog-actions>a{display:inline-flex;align-items:center;gap:6px;min-height:44px;color:var(--teal);font-size:14px}
.connection-access,.connection-buttons{justify-content:space-between;align-items:flex-start}
.connection-dialog :is(button,.button,input,select){max-width:100%}
.connection-dialog .field{margin:0}.connection-dialog .field label{margin-bottom:5px;font-size:13px}
.connection-dialog .field :is(input,select){background:var(--wash);font-size:14px;min-height:44px}
.connection-dialog form:has(#metrika-code){display:grid;gap:var(--connection-gap)}
.connection-dialog form:has(#metrika-code)>button{justify-self:start}
.connection-field-grid{display:grid;gap:var(--connection-gap)}
.connection-select{position:relative;min-width:0}
.field .connection-select select{appearance:none;padding-inline:12px 42px}
.connection-select:has(.connection-select-value:not([hidden])){display:grid;grid-template-columns:minmax(0,1fr)}
.connection-select:has(.connection-select-value:not([hidden])) select,.connection-select-value{grid-area:1/1}
.connection-select:has(.connection-select-value:not([hidden])) select{color:transparent}
.connection-select select option{color:var(--ink);background:var(--surface)}
.connection-select-value{align-self:center;z-index:1;padding:11px 43px 11px 13px;pointer-events:none;font-size:14px;line-height:1.4;overflow-wrap:anywhere}
.connection-select select:disabled+.connection-select-value{color:var(--muted)}
.connection-select::after{content:'';position:absolute;inset-inline-end:18px;top:50%;width:7px;height:7px;border-inline-end:2px solid currentColor;border-block-end:2px solid currentColor;transform:translateY(-65%) rotate(45deg);pointer-events:none}
@media(forced-colors:active){
  .connection-select:has(.connection-select-value:not([hidden])) select{forced-color-adjust:none;color:transparent;background:Field;border-color:ButtonText}
  .connection-select select option{color:FieldText;background:Field}
  .connection-select-value{color:FieldText}
  .connection-select select:disabled+.connection-select-value{color:GrayText}
}
.connection-feedback:not(:empty){padding-top:8px;color:var(--muted);font-size:13px}
.connection-feedback[data-error]{color:var(--error)}
[data-enable-metrika]{margin-top:12px}
#main .connection-dialog details.connection-manual{margin:0;padding:0;border:0;background:transparent}
#main .connection-dialog .connection-manual>summary{margin:0;padding:12px 22px 12px 0;background:transparent;border:0;color:var(--teal);text-decoration:underline;text-underline-offset:4px;width:fit-content}
#main .connection-dialog .connection-manual>summary::after{right:4px}
.connection-manual form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 12px}
#main .connection-dialog details.connection-disconnect{margin:0;padding:0;border:0;background:transparent}
#main .connection-dialog .connection-access .connection-disconnect{margin-inline-start:auto}
#main .connection-dialog .connection-disconnect>summary{position:static;display:inline-flex;justify-content:center;margin:0;padding:10px 14px;min-height:44px;border:1px solid #bc8f8f;border-radius:8px;background:var(--surface);color:var(--danger)}
#main .connection-dialog .connection-disconnect>summary::after{content:none}
#main .connection-dialog .connection-disconnect>summary:hover{background:#fff1ef}
#main .connection-dialog .connection-disconnect[data-native-disconnect][open]{width:100%}
#main .connection-dialog .connection-disconnect[data-native-disconnect][open]>summary,
.connection-access:has(>.connection-disconnect[data-native-disconnect][open])>form,
.connection-dialog[data-confirming] :is([data-native-confirm-title],[data-native-confirm-cancel]){display:none}
.connection-confirm{display:grid;gap:18px;padding-top:10px}
.connection-dialog>.connection-confirm{grid-row:2;padding:var(--connection-edge)}
.connection-confirm .connection-buttons{justify-content:flex-end}
.connection-danger-primary{background:var(--danger);border-color:var(--danger);color:white}.connection-danger-primary:hover{background:#811919}
.connection-dialog[data-confirming] .connection-badge{display:none}
.connection-error-inline{color:var(--error);margin:0;font-size:14px}
.connection-dialog-body>.notice{margin:0}

.connection-tip-button{display:grid;place-items:center;flex:none;width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--teal)}
.connection-tip-button:hover{background:#e7f3f3;color:var(--teal)}
.connection-tip{position:fixed;inset:0;margin:auto;width:300px;max-width:calc(100vw - 32px);padding:10px 13px;border:1px solid #91b5b5;border-radius:8px;background:#f1fbfa;color:#244747;box-shadow:0 8px 24px #10233124;font-size:14px;line-height:1.45}
@supports (position-area:block-end span-inline-start){
  .connection-tip{inset:auto;margin-block:7px;margin-inline:0;position-area:block-end span-inline-start;position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline,block-end,block-start}
}
.connection-tip[data-positioned]{inset:auto;margin:0;position-area:none;position-try-fallbacks:none}
@media(max-width:1120px){.connection-settings{--connection-edge:18px}.connection-card-heading{column-gap:7px}.connection-name{gap:7px}.connection-card h2{font-size:17px}.connection-card .connection-badge{font-size:14px;gap:4px;padding-inline:5px}}
@media(max-width:1000px){.connection-settings{grid-template-columns:minmax(0,1fr)}}
@media(max-width:600px){
  .connection-settings{--connection-edge:16px}.connection-dialog-heading{min-height:66px;padding-block:10px}
  .connection-dialog-heading h2{font-size:19px}.connection-dialog-heading .connection-name{display:grid;grid-template-columns:auto 1fr;gap:3px 8px}
  .connection-dialog-heading .connection-badge{grid-column:2;margin-inline-start:0;font-size:15px}
  .connection-dialog .connection-dialog-body{padding-block:13px 16px}
}
@media(max-width:380px){
  .connection-card h2{font-size:16px;line-height:22px}.connection-card .connection-logo{width:22px;height:22px}.connection-card .connection-badge{font-size:13px}
  .connection-dialog-actions form,.connection-dialog-actions button,.connection-dialog-actions .connection-buttons button{width:100%}
  .connection-confirm .connection-buttons{display:grid;grid-template-columns:1fr}
}
`;
