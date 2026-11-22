export const overviewStyles = `
.card-hero {
  position: relative;
  overflow: hidden;
  padding: 24px 26px 20px;
  background: var(--dark);
  border-color: var(--dark);
  color: white;
  border-radius: 18px;
}
.card-hero::after {
  content: "";
  position: absolute;
  right: -70px;
  top: -140px;
  width: 340px;
  height: 340px;
  background: radial-gradient(circle, rgba(0, 255, 255, .16), transparent 62%);
  pointer-events: none;
}
.card-hero h2 { color: white; }
.card-hero .btn-secondary { background: transparent; color: white; border-color: #46464d; }
.card-hero .btn-secondary:hover { background: #1b1b21; color: white; border-color: #5a5a63; }
.hero-lead { max-width: 60ch; margin: 0 0 18px; color: #d1dddd; font-size: 15px; }

.overview-heading { align-items: center; gap: 16px; margin-block-end: 24px; }
.overview-stack { display: grid; gap: 16px; min-inline-size: 0; }
.overview-hero {
  --hero-line: #3e3e47;
  --hero-muted: #c3c3cc;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(3, auto);
  row-gap: 16px;
  padding-block: 24px;
  border-radius: var(--radius);
  background: #17171b;
  color: white;
  overflow-wrap: anywhere;
}
.hero-zone {
  display: grid;
  grid-row: span 3;
  grid-template-rows: subgrid;
  min-inline-size: 0;
  padding-inline: 24px;
}
.hero-reports { border-inline-start: 1px solid var(--hero-line); }
.hero-heading :is(h2, h3) { margin: 0; font-size: 30px; line-height: 1.15; letter-spacing: -.025em; font-weight: 550; }
.hero-heading p { margin: 5px 0 0; color: var(--hero-muted); }
.hero-status { padding-block-start: 12px; border-block-start: 1px solid var(--hero-line); font-size: 14px; }
.hero-status p { margin: 6px 0 0; color: var(--hero-muted); }
.hero-status > :first-child { margin-block-start: 0; }
.hero-status-line { display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap; }
.hero-status-line .chip { white-space: normal; max-inline-size: 100%; }
.hero-status .hero-empty { display: flex; align-items: center; min-block-size: 26px; color: white; font-weight: 550; }
.hero-value { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 8px; }
.hero-number { font-size: 42px; line-height: 1; font-weight: 600; letter-spacing: -.045em; }
.hero-unit { display: block; font-size: 13px; color: var(--hero-muted); }
.hero-facts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-block-start: 8px; color: var(--hero-muted); }
.hero-facts b { color: white; font-weight: 550; }
.hero-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.hero-controls .btn, .overview-detail-actions .btn { white-space: normal; }
.hero-controls .btn { min-block-size: 46px; padding-inline: 16px; font-weight: 550; }
.hero-primary { background: white; color: var(--ink); }
.hero-primary:hover { background: #ebebf0; color: var(--ink); }
.hero-secondary { border-color: #858590; color: white; }
.hero-secondary:hover { background: #292930; color: white; }
.hero-switch { padding-inline: 4px; font-size: 14px; color: var(--hero-muted); }
.hero-switch:hover { color: white; }
.overview-hero :focus-visible { outline-color: var(--cyan); }

.overview-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(4, auto);
  gap: 12px 16px;
}
.overview-detail { display: grid; gap: 12px; padding-block: 20px; overflow-wrap: anywhere; }
.overview-details > .overview-detail { grid-row: span 4; grid-template-rows: subgrid; }
.overview-detail h2 { margin: 0; font-size: 18px; font-weight: 550; }
.overview-detail-key { display: grid; align-content: start; gap: 4px; }
.overview-detail-key p, .overview-detail-data p { margin: 0; }
.overview-detail-value { font-size: 28px; font-weight: 550; line-height: 1.2; letter-spacing: -.035em; }
.overview-detail-key .muted { font-size: 14px; }
.overview-detail-key .inline-status { display: flex; align-items: center; gap: 8px; }
.overview-detail-data {
  display: grid;
  align-content: start;
  gap: 8px;
  padding-block-start: 12px;
  border-block-start: 1px solid var(--line);
}
.overview-detail-data:empty { padding: 0; border: 0; }
.overview-detail-data .rows { margin: 0; gap: 6px; }
.overview-detail-data .rows > div { align-items: baseline; gap: 12px; }
.overview-detail-data .rows dd { white-space: normal; text-align: end; }
.overview-detail-actions { padding-block-start: 4px; }
.overview-detail-actions .btn { padding-inline: 12px; color: var(--teal); font-size: 14px; font-weight: 550; }
.overview-detail-actions .btn:hover { background: #f2f6f6; border-color: var(--teal); }

.mini-list { margin: 0; padding: 0; list-style: none; }
.mini-campaign { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: center; padding: 14px 0; border-top: 1px solid var(--line); }
.mini-campaign:first-child { border-top: 0; padding-top: 0; }
.mini-campaign:last-child { padding-bottom: 0; }
.mini-main { min-width: 0; }
.mini-main .campaign-title h3 { margin: 0; font-size: 15.5px; font-weight: 600; line-height: 1.3; }
.mini-main .campaign-title h3 a { display: inline-flex; align-items: center; min-height: 44px; color: inherit; text-decoration: none; }
.mini-main .campaign-title h3 a:hover { color: var(--teal); }
.mini-main .campaign-title h3 a:focus-visible { outline: 3px solid var(--teal); outline-offset: 3px; border-radius: 4px; }
.mini-stats { display: flex; gap: 24px; margin: 0; }
.mini-stats dt { margin: 0 0 2px; font-size: 12px; color: var(--muted); }
.mini-stats dd { margin: 0; font-size: 15px; font-weight: 600; white-space: nowrap; }
.overview-learning { margin-top: 18px; }
.overview-support { margin: 0; padding: 0; border: 0; }
.overview-support > summary { font-size: 14px; }

@media (max-width: 700px) {
  .card-hero { padding: 20px 18px 16px; }
  .mini-campaign { grid-template-columns: 1fr; gap: 8px; }
  .mini-stats { gap: 12px 18px; flex-wrap: wrap; }
}
@media (max-width: 660px) {
  .overview-heading { margin-block-end: 16px; }
  .overview-hero { display: block; padding-block: 0; }
  .hero-zone { grid-template-rows: auto; gap: 12px; padding: 18px; }
  .hero-reports { border-inline-start: 0; border-block-start: 1px solid var(--hero-line); }
  .hero-heading :is(h2, h3) { font-size: 25px; }
  .hero-status { padding: 0; border: 0; }
  .hero-controls:empty { display: none; }
  .overview-details { grid-template-columns: 1fr; grid-template-rows: none; }
  .overview-details > .overview-detail { grid-row: auto; grid-template-rows: auto; }
  .overview-detail { padding: 18px; }
}
@media (max-width: 580px) {
  .overview-heading .page-actions, .overview-heading .page-actions form, .overview-heading .page-actions .btn { width: 100%; }
}
`;
