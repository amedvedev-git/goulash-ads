export const businessFieldStyles = `
.plan-form ::placeholder{opacity:1;color:#687373}
.business-picker{position:relative}
.business-picker.has-picker input{padding-right:46px}
.business-picker button.picker-toggle{position:absolute;top:2px;right:2px;width:42px;height:42px;padding:0;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--teal)}
.business-picker button.picker-toggle[hidden],.picker-popup[hidden],.picker-empty[hidden]{display:none}
.business-picker button.picker-toggle:hover,.business-picker button.picker-toggle[aria-expanded=true]{background:var(--wash)}
.picker-popup{position:absolute;z-index:5;top:calc(100% + 4px);inset-inline:0;background:white;border:1px solid #a6bdb7;border-radius:9px;overflow:hidden}
.picker-popup ul{max-height:200px;overflow:auto;margin:0;padding:4px;list-style:none;overscroll-behavior:contain}
.picker-popup ul:empty{display:none}
.picker-popup li{padding:8px 10px;cursor:pointer;border-radius:5px;color:var(--ink);overflow-wrap:anywhere}
.picker-popup li:hover,.picker-popup li[aria-selected=true]{background:var(--wash);color:var(--teal)}
.picker-popup .picker-empty{margin:0;padding:10px 12px;font-size:14px}
`;
