export const disclosureStyles = `
main :where(p, .hint, label, summary) { text-wrap: pretty; }
.hint-sentence { display: inline-block; max-width: 100%; vertical-align: top; text-wrap: pretty; }

#main details {
  --disclosure-bg: #f7faf9;
  --disclosure-bar: #eff5f4;
  --disclosure-hover: #e2efed;
  --disclosure-line: #cbdad7;
  --disclosure-ink: #205554;
  min-width: 0;
  border: 1px solid var(--disclosure-line);
  border-radius: 10px;
  background: var(--disclosure-bg);
  padding: 0 14px;
}
#main details[open] { padding-bottom: 12px; }
#main details > summary {
  position: relative;
  list-style: none;
  min-height: 44px;
  margin: 0 -14px;
  padding: 12px 42px 12px 14px;
  border-radius: 9px;
  background: var(--disclosure-bar);
  color: var(--disclosure-ink);
  cursor: pointer;
  font-size: 14px;
  line-height: 1.4;
  font-weight: 600;
}
#main details > summary::-webkit-details-marker { display: none; }
#main details > summary::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 17px;
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: translateY(-72%) rotate(45deg);
}
#main details[open] > summary {
  margin-bottom: 12px;
  border-bottom: 1px solid var(--disclosure-line);
  border-radius: 9px 9px 0 0;
}
#main details[open] > summary::after { transform: translateY(-25%) rotate(225deg); }
#main details > summary:hover { background: var(--disclosure-hover); }
#main details > summary:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
#main details[open] > :last-child { margin-bottom: 0; }
@media (forced-colors: active) {
  #main details { border-color: CanvasText; }
  #main details > summary { color: LinkText; }
}
`;
