export const campaignCatalogStyles = `
.catalog-empty { max-width: 720px; }
.catalog-empty h2 { margin: 0 0 10px; }
.catalog-empty p { max-width: 56ch; color: var(--muted); margin: 0 0 22px; }
.catalog-empty form { margin: 0; }

.campaign-list { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.campaign-row {
  display: block;
  padding: 20px 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.campaign-row > article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: start;
}
.campaign-main { min-width: 0; }
.campaign-title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
.campaign-title h2 { margin: 0; font-size: 17px; line-height: 1.3; overflow-wrap: anywhere; }
.campaign-sub { margin: 4px 0 0; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.campaign-next { margin: 10px 0 0; font-size: 14px; color: #3b3b43; }
.campaign-stats { display: flex; gap: 30px; flex-wrap: wrap; margin: 14px 0 0; padding: 0; }
.campaign-stats dt { margin: 0 0 2px; font-size: 12.5px; color: var(--muted); }
.campaign-stats dd { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; }
.campaign-stats dd small { font-size: 12.5px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.campaign-progress { max-width: 420px; margin-top: 12px; }
.campaign-note { margin: 10px 0 0; font-size: 13px; color: var(--muted); max-width: 70ch; }
.campaign-warning {
  margin: 10px 0 0;
  padding: 9px 12px;
  border-radius: 9px;
  background: var(--warn-bg);
  color: var(--warn);
  font-size: 13.5px;
  max-width: 80ch;
}
.campaign-warning a { color: inherit; }
.campaign-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.campaign-actions .btn { min-height: 44px; }
.campaign-actions .link { display: inline-flex; align-items: center; min-height: 44px; }
.campaign-details { margin-top: 12px; }
.campaign-details .support-body { max-width: 80ch; }
.metric-missing { color: var(--muted-2); }
.page-head form { margin: 0; }
@media (max-width: 700px) {
  .campaign-row { padding: 18px; }
  .campaign-row > article { grid-template-columns: 1fr; gap: 16px; }
  .campaign-title h2 { font-size: 16px; }
  .campaign-stats { gap: 18px; }
  .campaign-stats dd { font-size: 16px; }
  .campaign-actions { justify-content: flex-start; }
  .campaign-actions .btn { flex: 1; }
  .page-head .page-actions, .page-head form, .page-head .btn { width: 100%; }
}
`;
