export const adStepStyles = `
.ad-step h2,.ad-step h3{margin:0}
.ad-step h3{font-size:20px}
.ad-step h2+p,.ad-step h3+p{margin:6px 0 14px;color:var(--muted)}
.ad-step .search-targets{margin-top:26px}
.ad-step details>summary .ui-icon{margin-right:4px}
#main .ad-step .ai-setup>summary{background:#d6f5ef;color:#07564e}
#main .ad-step .ai-setup>summary:hover{background:#c4ece5}
.ad-step .research-result,.ad-step .ai-unavailable,.ad-step [data-research-progress]{background:var(--wash);border-radius:8px;padding:11px 14px;color:var(--ink)}
.ad-step .research-result p,.ad-step [data-research-progress] p{margin:4px 0}
.ad-step .ai-unavailable{margin-top:12px}
.ad-step .ai-unavailable p{margin:0}
.ad-step .ai-unavailable p+p{margin-top:6px}
.ad-step .phrase-help{margin:0 0 8px;color:var(--muted);font-size:13px}
.ad-step .phrase-editor{margin-block:16px 12px}
.ad-step .phrase-editor [hidden],.ad-step [data-research-progress][hidden]{display:none}
.ad-step .phrase-input-row{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px}
.ad-step .phrase-input-row input{min-width:min(14rem,100%);flex:1}
.ad-step .phrase-input-row button{flex:none;font-size:13px;padding:6px 12px}
.ad-step .phrase-items{list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;padding:0}
.ad-step .phrase-items:empty{display:none}
.ad-step .phrase-items li{display:flex;align-items:center;max-width:100%;padding-left:10px;gap:3px;border-radius:7px;border:1px solid #cbdad7;background:white;font-size:14px}
.ad-step .phrase-items li span{min-width:0;overflow-wrap:anywhere}
.ad-step .phrase-items button{color:var(--teal);background:transparent;border:0;min-height:34px;min-width:32px;padding:3px 7px;font-size:20px;line-height:1}
.ad-step .phrase-items button:hover{background:var(--wash)}
.ad-step .phrase-error{color:var(--error);font-size:13px;margin:5px 0 0}
.ad-step .phrase-error:empty{display:none}
.ad-step .candidate-list{list-style:none;margin:0;padding:0;max-height:26rem;overflow-y:auto}
.ad-step .candidate-list .check{margin:0;padding:9px 0;align-items:flex-start}
.ad-step .candidate-list strong,.ad-step .candidate-list small,.ad-step .candidate-reasons small{display:block}
.ad-step .candidate-list small,.ad-step .candidate-reasons small{color:var(--muted);font-size:12px}
.ad-step .candidate-reasons dt{margin-top:10px;font-weight:600}
.ad-step .candidate-reasons dd{margin:3px 0 0}
.ad-step button[data-sending]{cursor:progress}
`;
