export const operationsStyles = `
.operations {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.operations > section + section { margin-top: 0; }
.ops-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(270px, 1fr);
  align-items: start;
  gap: 20px;
  min-width: 0;
}
.operations .ops-sheet {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--line, #d9dfe0);
  border-radius: 15px;
  background: #fff;
  overflow-wrap: anywhere;
  scroll-margin-top: 24px;
}
.ops-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.ops-heading h2, .ops-heading h3 { margin: 0; }
.ops-heading > .ui-icon { color: var(--muted, #576166); flex: none; }
.ops-guide > .ops-event-icon { margin-bottom: 14px; }
.ops-guide { align-self: start; }
.ops-guide a, .ops-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  color: var(--teal, #006c73);
  text-underline-offset: 3px;
}
.ops-guide a .ui-icon, .ops-link .ui-icon { flex: none; }
.ops-guide p { max-width: 60ch; }
.ops-guide p:last-child { margin-bottom: 0; }

.analytics-metrika { border-top: 1px solid var(--line); padding-top: 16px; scroll-margin-top: 24px; }
.analytics-metrika .ops-heading { margin-bottom: 8px; }
.analytics-metrika > p:last-child { margin-bottom: 0; }
.analytics-metrika .support-details { margin-top: 8px; }
.operations .analytics-metrika #analytics-counter { display: block; width: min(100%, 240px); }

.ops-timeline { margin-top: 16px; }
.ops-event {
  display: grid;
  grid-template-columns: 35px minmax(0, 1fr);
  gap: 12px;
  padding-block: 17px;
}
.ops-event-icon {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border-radius: 9px;
  background: #e8efef;
  color: #426269;
}
.ops-event-demo { background: #e4f4ef; color: #17614d; }
.ops-event .entry-heading h3 { font-size: 16px; line-height: 1.35; margin-bottom: 0; }
.ops-event p { margin-bottom: 8px; }
.ops-event .entry-meta { margin: 4px 0 7px; }
.ops-event .entry-actions { margin-top: 10px; }
.ops-event details { margin-top: 6px; }
.ops-event summary { cursor: pointer; }
.ops-timeline .empty-state { padding-block: 10px 0; }
.decision-summary { margin: 12px 0; }
.decision-summary > div { display: grid; grid-template-columns: minmax(135px, .7fr) minmax(0, 1.6fr); gap: 4px 16px; border-top: 1px solid var(--line); padding: 8px 0; }
.decision-summary dt { font-weight: 620; }
.decision-summary dd { margin: 0; }

.ops-permission form + p { margin: 12px 0 0; }
.ops-budget .ops-heading { margin-bottom: 10px; }
.ops-budget .mode { margin-bottom: 8px; }
.ops-budget-total {
  margin: 0;
  font-size: clamp(24px, 3vw, 35px);
  line-height: 1.2;
  letter-spacing: -.035em;
  font-weight: 640;
}
.ops-budget-total small { font-size: 14px; font-weight: 480; color: var(--muted); }
.ops-meter { display: block; width: 100%; height: 12px; margin: 10px 0 0; }
.ops-meter::-webkit-meter-bar { height: 10px; background: #e2e9e8; border: 0; border-radius: 4px; }
.ops-meter::-webkit-meter-optimum-value { background: #08868b; }
.ops-meter::-moz-meter-bar { background: #08868b; }
.ops-budget-facts { margin: 16px 0 12px; }
.ops-budget-facts > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; border-top: 1px solid var(--line); padding: 9px 0; }
.ops-budget-facts dt { color: var(--muted); }
.ops-budget-facts dd { margin: 0; font-weight: 620; }
.ops-budget .support-details { margin-top: 14px; }
.ops-budget .responsive-table td, .ops-budget .responsive-table th { padding-inline: 6px; }
.ops-budget .responsive-table th:first-child { width: auto; }

@media (max-width: 820px) {
  .ops-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 540px) {
.operations, .ops-grid { gap: 14px; }
  .operations .ops-sheet { padding: 17px; }
  .ops-event { grid-template-columns: 28px minmax(0, 1fr); gap: 9px; }
  .ops-event-icon { width: 28px; height: 28px; }
  .ops-event .entry-actions .button { text-align: left; }
  .decision-summary > div { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .operations .ops-budget .responsive-table td { padding-inline: 0; }
}
`;
