export const cabinetStyles = `
body {
  overflow-wrap: anywhere;
}

.ui-icon {
  display: inline-block;
  vertical-align: middle;
  flex: none;
}

.topbar :focus-visible,.overview-focus :focus-visible {
  outline-color: var(--cyan);
}

.account-panel :focus-visible {
  outline-color: var(--teal);
}

main {
  min-height: calc(100vh - 138px);
}

.cabinet-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 0 0 12px;
  font-size: 14px;
  color: var(--muted);
}

.cabinet-context>span {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.cabinet-context>a,.overview-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--teal);
  text-decoration: none;
  font-size: 14px;
  font-weight: 570;
  min-height: 37px;
  text-align: left;
}

.cabinet-context>a {
  flex: none;
  font-size: 13px;
}

.cabinet-context>a:hover,.overview-link:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.cabinet-heading {
  align-items: center;
  margin: 0 0 23px;
}

.cabinet-context+.cabinet-heading {
  margin-top: 24px;
}

.cabinet-heading h1 {
  letter-spacing: -.025em;
  margin: 0;
  text-wrap: balance;
}

.cabinet-heading h1+.lead {
  margin-top: 7px;
}

.cabinet-heading .button {
  flex: none;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0,1.68fr) minmax(270px,1fr);
  gap: 20px;
}

.overview-panel {
  padding: 23px 25px;
  background: white;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  min-width: 0;
}

.overview-panel h2 {
  font-size: 22px;
  font-weight: 650;
  line-height: 1.2;
  letter-spacing: -.03em;
  margin: 0 0 12px;
}

.overview-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.overview-panel-head h2 {
  margin: 0;
}

.overview-panel-head .ui-icon {
  color: var(--muted);
}

.overview-panel-head .overview-link {
  min-height: 28px;
  flex: none;
}

.overview-panel p {
  max-width: 65ch;
}

.overview-focus,.login.overview-focus {
  background: var(--dark);
  border-color: var(--dark);
  color: white;
}

.overview-focus p {
  color: #d1dddd;
  max-width: 58ch;
}

.overview-focus .overview-link {
  color: #a1eeea;
}

.overview-focus .button {
  margin: 5px 0 2px;
}

.overview-report-period {
  font-size: 13px;
}
.overview-campaigns { display: grid; gap: 14px; }
.overview-campaigns .overview-panel-head { align-items: flex-start; flex-wrap: wrap; }
.overview-campaigns .overview-panel h2, .cabinet-heading h1 { overflow-wrap: anywhere; }
.overview-campaigns .overview-metrics > div { min-width: 0; }
.overview-campaigns .overview-metrics .overview-report-period { display: block; margin-top: 5px; font-size: 13px; font-weight: 400; }
.overview-campaigns .overview-panel:not(.overview-focus) .overview-metrics { border-color: var(--line); }
.overview-campaigns .overview-panel:not(.overview-focus) .overview-metrics :is(dt,.overview-report-period) { color: var(--muted); }
.overview-focus .overview-metrics .overview-report-period { color: #d1dddd; }
@media (min-width: 701px) {
  .overview-campaigns .overview-metrics { grid-template-columns: repeat(auto-fit, minmax(195px, 1fr)); }
}
.overview-learning { margin-top: 18px; }

.overview-metrics,.overview-limit {
  margin: 18px 0 14px;
}

.overview-metrics {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 16px;
  padding: 4px 0 13px;
  border-bottom: 1px solid #354042;
}

.overview-metrics dd,.overview-limit dd {
  font-weight: 590;
  font-size: clamp(30px,3.6vw,48px);
  letter-spacing: -.04em;
  margin: 1px 0 0;
  line-height: 1.08;
}

.overview-metrics .overview-missing {
  font-size: 16px;
  line-height: 1.35;
  font-weight: 500;
  letter-spacing: 0;
}

.overview-metrics dt,.overview-limit dt {
  font-size: 14px;
  color: var(--muted);
}

.overview-metrics dt {
  color: #d1dddd;
}

.overview-limit dd span {
  color: var(--muted);
  font-size: 14px;
  font-weight: 440;
  letter-spacing: 0;
  margin-left: 8px;
  display: inline-block;
}

.overview-ad-title {
  font-size: 19px;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 5px;
}

.overview-recent {
  list-style: none;
  padding: 0;
  margin: 0 0 6px;
}

.overview-recent li {
  display: grid;
  grid-template-columns: 34px minmax(0,1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.overview-event-icon {
  display: grid;
  place-items: center;
  width: 33px;
  height: 33px;
  background: #e4f4ef;
  color: #17614d;
  border-radius: 8px;
}

.overview-recent a {
  font-weight: 600;
}

.overview-recent p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--muted);
}

.overview-recent time {
  font-size: 12px;
  color: var(--muted);
}

.login.overview-focus {
  padding: clamp(24px,4vw,48px);
  max-width: 760px;
  margin: clamp(12px,5vw,64px) auto;
}

.login h1 { text-wrap: balance; }
.login-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 24px; }
.login-options:has(> :only-child) { grid-template-columns: minmax(0, 320px); }
.login-options .button { width: 100%; padding-inline: 10px; }
.login-options p { margin: 8px 0 0; font-size: 13px; color: #acacb5; }
@media (max-width: 700px) { .login-options { grid-template-columns: minmax(0, 1fr); } }

.footer-inner {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-top: 15px;
  border-top: 1px solid var(--line);
}

@media (max-width: 900px) {
  .overview-grid {
    gap: 15px;
    grid-template-columns: minmax(0,1.4fr) minmax(228px,1fr);
  }
  .overview-panel {
    padding: 20px;
  }
}

@media (max-width: 700px) {
  .cabinet-heading {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-direction: column;
  }
  .cabinet-context+.cabinet-heading {
    margin-top: 17px;
  }
  .overview-grid {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .overview-panel {
    padding: 18px;
  }
  .overview-panel h2 {
    font-size: 20px;
  }
  .overview-recent li {
    grid-template-columns: 34px minmax(0,1fr);
    row-gap: 3px;
  }
  .overview-recent time {
    grid-column: 2;
  }
  .footer-inner {
    flex-direction: column;
    gap: 4px;
  }
}

@media (max-width: 370px) {
  .cabinet-context>a {
    flex: 0 1 auto;
  }
  .overview-panel-head {
    flex-wrap: wrap;
  }
}
`;
