export const offerEditorStyles = `
.offer-editor{margin-block:20px;min-width:0}
.offer-editor [data-editor-list]{display:grid;gap:12px}
.offer-editor [data-editor-list=offer] > :only-child [data-remove-row]{display:none}
.editor-row{min-width:0;padding:16px 18px;background:var(--wash);border-radius:12px}
.editor-row-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.editor-row-heading h3{margin:0;font-size:16px;font-weight:650;line-height:1.35}
.editor-row .field{margin:0 0 12px}
.editor-row .field:last-child{margin-bottom:0}
.offer-fields{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px;margin-bottom:12px}
.offer-fields .field{margin:0}
.plan-form .offer-editor .editor-row details{margin:12px 0 0}
.offer-field-caption{position:relative;display:flex;align-items:center;gap:4px;margin-bottom:4px}
.offer-field-caption label{margin:0}
.offer-field-caption label.check{align-items:center;margin:0}
.offer-field-caption .check input{margin:0}
.offer-field-caption .offer-help-trigger{flex:none;width:32px;min-height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--teal)}
.offer-field-caption .offer-help-trigger:hover{background:var(--surface)}
.offer-help-tooltip{position:absolute;z-index:2;inset-inline-start:0;top:100%;width:min(100%,22rem);padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:var(--shadow);color:var(--ink);font-size:13px;line-height:1.5}
@media(pointer:coarse){.offer-field-caption .offer-help-trigger{width:44px;min-height:44px}}
.offer-editor .editor-add{display:inline-flex;align-items:center;gap:6px;width:auto;min-height:44px;margin:12px 0 0;padding:7px 12px;font-size:14px}
.offer-editor .editor-remove{flex:none;min-height:32px;margin:0;padding:4px 7px;background:transparent;color:var(--muted);border:0;font-size:13px;font-weight:550}
.offer-editor .editor-remove:hover{background:white;color:var(--error)}
.editor-extra-groups{display:grid;gap:12px}
.editor-extra-group{min-width:0;margin:0;padding:12px;background:white;border:1px solid var(--line);border-radius:10px}
.editor-extra-label{font-size:14px;font-weight:650}
.offer-editor .editor-extra-group [data-editor-list]{gap:8px}
.editor-extra-group [data-editor-list]:empty~.editor-add{margin-top:0}
.extra-row{display:flex;align-items:flex-start;gap:8px;min-width:0}
.extra-row .field{flex:1;margin:0}
.offer-editor .extra-row .editor-remove{min-height:46px}
@media(max-width:480px){.editor-row{padding:14px 12px}.offer-fields{grid-template-columns:1fr}}
`;
