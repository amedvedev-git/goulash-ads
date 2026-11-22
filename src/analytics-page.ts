import { analyticsDates } from './analytics.ts';
import type { createAnalyticsService, AnalyticsReport, AnalyticsSource } from './analytics.ts';
import { budgetStatus, micros, runBudgetUsage, reportCpa } from './analytics-money.ts';
import { escapeHtml as e } from './html.ts';
import { uiIcon } from './ui-icons.ts';
import { reportMetrics, sourcePeriod } from './campaign-metrics.ts';
import { campaignDisplayState, readableDirectName } from './campaign-catalog.ts';
import { campaignTabHref, connectionHref, routes } from './routes.ts';
import { renderCampaignPanelHeading } from './campaign-navigation.ts';

export { micros, reportCpa } from './analytics-money.ts';

export type AnalyticsView = ReturnType<ReturnType<typeof createAnalyticsService>['view']> & { input?: Record<string, string>; errors?: Record<string, string>; campaignId?: string };
const analyticsAction = (action: string, campaignId?: string) => '/analytics/' + action + (campaignId ? '?ad=' + encodeURIComponent(campaignId) : '');

const sources: Record<AnalyticsSource, string> = {
  direct_reports: 'Директ · показы и расход',
  metrika_direct: 'Метрика · достижения цели кампании',
  metrika_daily: 'Метрика · достижения по дням',
  metrika_site: 'Метрика · весь сайт',
};
const states: Record<AnalyticsReport['status'], string> = {
  pending: 'Отчёт готовится', ready: 'Отчёт получен', empty: 'Нет строк за период',
  error: 'Чтение не завершено', superseded: 'Прежние параметры',
};
const dash = '<span class="metric-missing">—<span class="sr-only"> Нет данных</span></span>';
const number = (value: number | null | undefined) => value == null ? 'Нет данных' : value.toLocaleString('ru-RU');
const rubles = (value: number | null | undefined) => value == null ? 'Нет данных' : value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
const plain = (value: number) => value.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const date = (value: string) => value.split('-').reverse().join('.');
const time = (value: number) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
const stamp = (value: string | undefined) => {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? time(parsed) : '';
};

type Headline = ReturnType<typeof headline>;

function headline(view: AnalyticsView) {
  const reports = view.currentReports;
  const metrics = reportMetrics(reports, true);
  const run = view.runs.find((item) => item.planId === view.settings.directRunId);
  const plan = view.plans.find((item) => item.id === run?.campaignPlanId);
  const amount = run?.budget?.amountRub ?? run?.weekly;
  return {
    ...metrics,
    fixture: reports.some((report) => report.mode === 'fixture'),
    budget: amount && Number(amount) > 0 ? { amount: Number(amount), period: run?.budget?.periodDays ?? plan?.draft.period } : plan?.draft.budget && Number(plan.draft.budget) > 0 ? { amount: Number(plan.draft.budget), period: plan.draft.period } : undefined,
    budgetUsage: runBudgetUsage(run, view.campaignReports ?? []),
  };
}

// Windows the segment buttons submit: the same last full days the saved period uses.
const presetWindow = (days: number, now = Date.now()) => {
  const { dateTo } = analyticsDates(now);
  return { from: new Date(Date.parse(dateTo) - (days - 1) * 86400000).toISOString().slice(0, 10), to: dateTo };
};

function campaignPeriodFields(from: string, to: string, lastDay: string, view: AnalyticsView) {
  const field = (id: 'from' | 'to', value: string) => {
    const label = id === 'from' ? 'Начало периода' : 'Конец периода';
    const error = view.errors?.[id === 'from' ? 'dateFrom' : 'dateTo'];
    return `<div class="report-date-control">
      <input id="analytics-${id}" name="${id === 'from' ? 'customFrom' : 'customTo'}" type="text" value="${e(value)}"
        aria-label="${label}" aria-describedby="campaign-period-error" placeholder="ДД.ММ.ГГГГ" maxlength="10" autocomplete="off" spellcheck="false" required${error ? ' aria-invalid="true"' : ''}>
      <button type="button" data-calendar-for="${id}" aria-label="${id === 'from' ? 'Календарь начала периода' : 'Календарь конца периода'}"
        aria-haspopup="dialog" aria-controls="campaign-period-calendar" hidden>${uiIcon('calendar', 18)}</button>
    </div>`;
  };
  return `<div class="campaign-report-period" data-report-period data-last-day="${lastDay}" role="group" aria-label="Даты отчёта">
    ${field('from', from)}<span class="period-dash" aria-hidden="true">—</span>${field('to', to)}
    <dialog class="period-calendar" id="campaign-period-calendar" aria-label="Выберите дату">
      <div class="calendar-head">
        <button type="button" data-month-offset="-1" aria-label="Предыдущий месяц">‹</button>
        <p id="calendar-month" aria-live="polite"></p>
        <button type="button" data-month-offset="1" aria-label="Следующий месяц">›</button>
      </div>
      <table class="calendar-days" role="grid" aria-labelledby="calendar-month"><thead><tr>
        ${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => `<th scope="col">${day}</th>`).join('')}
      </tr></thead><tbody></tbody></table>
      <div class="calendar-actions">
        <button type="button" data-calendar-clear>Очистить</button>
        <button type="button" data-calendar-latest>Последний доступный день</button>
        <button type="button" data-calendar-close>Закрыть</button>
      </div>
    </dialog>
  </div>`;
}

function controls(view: AnalyticsView) {
  const { settings } = view, input = view.input ?? {};
  const selected = input.directRunId ?? settings.directRunId ?? '';
  const goal = input.goalId ?? settings.goalId ?? '';
  const available = view.runs.filter((run) => run.steps.campaign.phase === 'confirmed');
  const counter = settings.counter;
  const { dateTo: lastDay } = analyticsDates();
  const active = [7, 30].find((days) => {
    const window = presetWindow(days);
    return settings.dateFrom === window.from && settings.dateTo === window.to;
  });
  const editingPeriod = input.period === 'custom' || Boolean(view.errors?.dateFrom || view.errors?.dateTo);
  const presetButtons = [7, 30].map((days) => `<button type="submit" name="days" value="${days}" class="seg-btn" aria-pressed="${active === days && !editingPeriod}" formnovalidate>${days} дней</button>`).join('');
  const savedDate = (name: 'dateFrom' | 'dateTo') => {
    const value = editingPeriod ? input[name] ?? '' : settings[name];
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? date(value) : value;
  };
  function dateField(name: 'dateFrom' | 'dateTo', id: string, label: string) {
    const error = view.errors?.[name];
    const value = (editingPeriod ? input[name] ?? '' : active ? '' : settings[name]).trim().replace(/^(\d{2})[./](\d{2})[./](\d{4})$/u, '$3-$2-$1');
    return `<div class="date-field">
      <label class="sr-only" for="${id}">${label}</label>
      <input id="${id}" name="${name === 'dateFrom' ? 'customFrom' : 'customTo'}" type="date" value="${e(value)}" max="${lastDay}" required${error ? ` aria-invalid="true" aria-describedby="${id}-error"` : ''}>
      <span class="date-placeholder" aria-hidden="true">${label}</span>
      ${error ? `<p class="field-error" id="${id}-error">${e(error)}</p>` : ''}
    </div>`;
  }
  const fixedRun = view.campaignId && available.length === 1;
  return `<form id="analytics-filters" method="post" action="${analyticsAction('settings', view.campaignId)}" class="results-controls">
    <input type="hidden" name="revision" value="${settings.revision}">
    <input type="hidden" name="dateFrom" value="${e(settings.dateFrom)}">
    <input type="hidden" name="dateTo" value="${e(settings.dateTo)}">
    ${view.campaignId && selected ? '<button type="submit" name="period" value="custom" hidden></button>' : ''}
    ${view.campaignId ? (selected ? renderCampaignPanelHeading('results',
      `<div class="period-seg campaign-presets" role="group" aria-label="Готовые периоды">${presetButtons}</div>`,
      campaignPeriodFields(savedDate('dateFrom'), savedDate('dateTo'), lastDay, view)) + `
      <p class="field-error campaign-period-error" id="campaign-period-error" role="status">${e(view.errors?.dateFrom ?? view.errors?.dateTo ?? '')}</p>
      <button type="submit" name="period" value="custom" class="secondary campaign-period-apply" data-period-submit>Применить</button>`
      : renderCampaignPanelHeading('results')) : selected ? `<div class="period-seg" role="group" aria-label="Период">
      <!-- The first submit button handles Enter in the date fields. -->
      <button type="submit" name="period" value="custom" hidden></button>
      ${presetButtons}
      <details class="custom-period"${editingPeriod ? ' open' : ''} data-active="${!active || editingPeriod}">
        <summary class="seg-btn">Свой период${uiIcon('chevron', 16)}</summary>
        <div class="custom-period-body">
          ${dateField('dateFrom', 'analytics-from', 'Начало')}
          ${dateField('dateTo', 'analytics-to', 'Конец')}
          <button type="submit" name="period" value="custom" class="secondary">Применить</button>
        </div>
      </details>
    </div>` : ''}
    ${fixedRun ? `<input type="hidden" name="directRunId" value="${e(available[0].planId)}">` : `<div class="campaign-field">
      <div class="campaign-filter"><label for="analytics-run">Кампания</label>
      <span class="filter-select"><select id="analytics-run" name="directRunId"><option value="">Выберите кампанию</option>${available.map(run => `<option value="${e(run.planId)}"${selected === run.planId ? ' selected' : ''}>${e(readableDirectName(run.name, run.planId))}</option>`).join('')}</select>${uiIcon('chevron', 16)}</span></div>
      ${selected && !view.campaignId && counter && view.metrikaContextCurrent ? `<div class="campaign-filter"><label for="analytics-goal">Цель</label><span class="filter-select"><select id="analytics-goal" name="goalId"><option value="">Выберите цель</option>${counter.goals.map(item => `<option value="${e(item.id)}"${item.id === goal ? ' selected' : ''}>${e(item.name)}</option>`).join('')}</select>${uiIcon('chevron', 16)}</span></div>` : ''}
      <button type="submit" class="secondary" formnovalidate>Показать</button>
    </div>`}
  </form>`;
}
function noticeOf(report: AnalyticsReport) {
  const issues = report.result?.issues ?? [];
  const state = report.interrupted ? 'Чтение прервано' : report.stale ? 'Устаревший отчёт' : states[report.status];
  const caution = Boolean(report.stale || report.interrupted || issues.length || report.status !== 'ready');
  const period = `${date(report.context.dateFrom)} — ${date(report.context.dateTo)}`;
  const numbers = report.source === 'direct_reports'
    ? `Показы ${number(report.result?.rows?.[0]?.impressions)} · Клики ${number(report.result?.rows?.[0]?.clicks)}`
    : `Достижения цели ${number(report.result?.metrics?.reaches)} · Целевые визиты ${number(report.result?.metrics?.goalVisits)}${reportCpa(report) === undefined ? '' : ` · Стоимость достижения ${rubles(reportCpa(report))}`}`;
  return { state, caution, period, numbers, issues };
}

function reportFacts(report: AnalyticsReport) {
  const rows = [
    ['Отчёт', report.id],
    ['Запрошен', stamp(report.requestedAt) || report.requestedAt],
    report.receivedAt ? ['Получен', stamp(report.receivedAt) || report.receivedAt] : ['Попыток', String(report.attempts)],
    ['Полнота', report.result?.complete === false ? 'Неполный' : 'Полный'],
  ];
  if (report.context.campaignId) rows.push(['Кампания Директа', report.context.campaignId]);
  if (report.context.planId) rows.push(['Версия плана', report.context.planId]);
  if (report.context.counterId) rows.push(['Счётчик', `${report.context.counterId} · цель ${report.context.goalId ?? '—'}`]);
  return `<dl class="report-facts">${rows.filter(([, value]) => value).map(([label, value]) => `<div><dt>${e(label)}</dt><dd><code>${e(String(value))}</code></dd></div>`).join('')}</dl>`;
}

function reportRow(report: AnalyticsReport) {
  const info = noticeOf(report);
  const messages = [
    report.error ? `<p class="data-warning">${e(report.error)}</p>` : '',
    report.status === 'empty' ? '<p class="mode">За этот период источник не вернул данных.</p>' : '',
    report.status === 'pending' ? `<p class="mode" role="status">${report.interrupted ? 'Запросите отчёт ещё раз в блоке «Обновить данные».' : `Проверьте готовность после ${time(report.retryAt ?? Date.now())}.`}</p>` : '',
    report.stale ? '<p class="data-warning">Отчёт получен более 24 часов назад. Для сравнения нужен свежий отчёт.</p>' : '',
    info.issues.length ? `<p class="data-warning">${e(info.issues.join('. '))}. Сравнение недоступно.</p>` : '',
  ].filter(Boolean).join('');
  return `<div class="report-row" data-report-source="${report.source}" data-report-status="${report.status}">
    <div class="report-row-head"><strong>${sources[report.source]}</strong><span class="state-tag ${info.caution ? 'caution' : 'success'}">${info.state}</span></div>
    <p class="report-row-meta">${info.period} · ${info.numbers}</p>${messages}
    <details class="support"><summary>Запрос и точность</summary>${reportFacts(report)}</details>
  </div>`;
}

function metricsBlock(headline: Headline) {
  const spendSub = !headline.spend ? 'Нужен отчёт Директа'
    : `${sourcePeriod(headline.direct)} · ${headline.spendVat}`;
  const target = headline.metrika ? [sourcePeriod(headline.metrika), headline.goalName && `цель «${headline.goalName}»`].filter(Boolean).join(' · ') : 'По выбранной цели Метрики';
  const leadsSub = headline.reaches === undefined ? 'Нужен отчёт Метрики по цели'
    : headline.metrikaIncomplete ? `${target} · неполный отчёт` : target;
  const cpaSub = headline.cpa === undefined ? 'Нужен полный свежий отчёт с достижениями' : 'За одно достижение · Метрика';
  return `<div class="metrics-three">
    <dl class="metric"><dt>Расход</dt><dd>${headline.spend ? e(headline.spend) : dash}<span class="sub">${e(spendSub)}</span></dd></dl>
    <dl class="metric"><dt>Достижения цели</dt><dd>${headline.reaches === undefined ? dash : number(headline.reaches)}<span class="sub">${e(leadsSub)}</span></dd></dl>
    <dl class="metric"><dt>Стоимость достижения</dt><dd>${headline.cpa === undefined ? dash : e(rubles(headline.cpa))}<span class="sub">${cpaSub}</span></dd></dl>
  </div>`;
}

const plural = (value: number) => {
  const tail = Math.abs(value) % 100, last = tail % 10;
  if (tail > 10 && tail < 20) return 'достижений';
  if (last === 1) return 'достижение';
  if (last >= 2 && last <= 4) return 'достижения';
  return 'достижений';
};

// Daily series from Metrika: site goal reaches by day, filtered by the campaign's last direct order.
// The chart is drawn only from a complete, fresh report whose days add up to the period total.
function dailyCard(report: AnalyticsReport | undefined, leads?: number) {
  const result = report?.result;
  const days: { date: string; reaches: number }[] = Array.isArray(result?.days) ? result.days : [];
  const total = typeof result?.metrics?.reaches === 'number' ? result.metrics.reaches : undefined;
  const usable = report?.status === 'ready' && days.length > 0 && result?.complete === true && !(result.issues?.length || result.sampled);
  const periodText = report ? `${date(report.context.dateFrom)} — ${date(report.context.dateTo)}` : '';
  let body: string;
  if (!report) body = '<p class="results-empty">Отчёта по дням пока нет. Запросите его в «Обновить данные» — «Метрика · достижения по дням».</p>';
  else if (report.status === 'pending') body = '<p class="mode" role="status">Отчёт по дням готовится.</p>';
  else if (report.error) body = `<p class="data-warning">${e(report.error)}</p>`;
  else if (report.status === 'empty') body = '<p class="results-empty">За этот период Метрика не вернула строк по выбранной цели кампании.</p>';
  else if (!usable) body = `<p class="data-warning">${e((result?.issues ?? []).join('. ') || 'Отчёт неполный')}. Дни не показываем, чтобы ряд не расходился с итогом.</p>`;
  else {
    const max = Math.max(...days.map((day) => day.reaches));
    const bars = days.map((day) => `<i class="${day.reaches ? '' : 'zero'}" style="height:${day.reaches ? Math.max(4, Math.round(day.reaches / max * 100)) + '%' : '3px'}" title="${date(day.date)}: ${number(day.reaches)}"></i>`).join('');
    body = `${report.stale ? `<p class="data-warning">Последний полный отчёт устарел${report.receivedAt ? ' · ' + e(stamp(report.receivedAt)) : ''}.</p>` : ''}<div class="daily-bars" aria-hidden="true">${bars}</div>
      <div class="daily-axis"><span>${date(days[0].date)}</span><span>${date(days[days.length - 1].date)}</span></div>
      <p class="daily-total">Всего ${number(total ?? 0)} ${plural(total ?? 0)} за период · максимум ${number(max)} за день</p>
      ${!report.stale && leads !== undefined && total !== undefined && leads !== total ? `<p class="card-note">В карточке «Достижения цели» ${number(leads)}, по дням ${number(total)}. Обновите оба отчёта для сверки.</p>` : ''}
      <details class="support"><summary>Таблица по дням</summary><div class="table-scroll"><table class="daily-table"><caption class="sr-only">Достижения по дням, ${periodText}</caption><thead><tr><th scope="col">День</th><th scope="col">Достижения цели</th></tr></thead><tbody>${days.map((day) => `<tr><td>${date(day.date)}</td><td>${number(day.reaches)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  return `<article class="card daily-card" aria-labelledby="daily-title">
    <div class="card-head"><h2 id="daily-title">Достижения по дням</h2>${periodText ? `<span class="muted small">${periodText} · МСК</span>` : ''}</div>
    <p class="card-note">Достижения выбранной цели в Метрике</p>
    ${body}
  </article>`;
}

export function renderCampaignDailyReport(view: AnalyticsView | undefined, runId: string | undefined) {
  if (!runId) return '';
  const report = view?.campaignReports.find(item => item.source === 'metrika_daily' && item.context.runId === runId);
  return report ? dailyCard(report) : '';
}

function campaignTotals(view: AnalyticsView, headline: Headline) {
  const direct = view.currentReports.find((report) => report.source === 'direct_reports');
  const metrika = view.currentReports.find((report) => report.source === 'metrika_direct');
  const issues = [...(direct?.result?.issues ?? []), ...(metrika?.result?.issues ?? [])];
  const totals = Boolean(headline.spend || headline.reaches !== undefined);
  if (!totals) return '';
  const row = `<table class="responsive-table results-table"><caption class="sr-only">Расход и достижения цели по кампании</caption>
    <thead><tr><th scope="col">Срез</th><th scope="col">Расход</th><th scope="col">Достижения цели</th><th scope="col">Стоимость достижения</th></tr></thead>
    <tbody><tr><th scope="row">Кампания целиком</th>
      <td data-label="Расход">${headline.spend ? e(headline.spend) : '—'}</td><td data-label="Достижения цели">${headline.reaches === undefined ? '—' : number(headline.reaches)}</td>
      <td data-label="Стоимость достижения">${headline.cpa === undefined ? '—' : e(rubles(headline.cpa)) + ' · Метрика'}</td></tr></tbody></table>`;
  return `<article class="card" aria-labelledby="ads-title">
    <div class="card-head"><h2 id="ads-title">Итог по кампании</h2><a class="link" href="${view.campaignId ? campaignTabHref(view.campaignId, 'journal') : '/history'}">История решений</a></div>
    ${row}
    ${issues.length ? `<p class="data-warning">${e(issues.join('. '))}. Сравнение недоступно.</p>` : ''}
  </article>`;
}

function platformCard(view: AnalyticsView) {
  const run = view.runs.find(item => item.planId === view.settings.directRunId);
  const snapshot = run?.snapshot?.campaign;
  const strategy = snapshot?.UnifiedCampaign?.BiddingStrategy;
  const checkedAt = stamp(run?.checkedAt);
  const searchOnly = checkedAt && run?.steps.campaign.phase === 'confirmed' && snapshot?.Id !== undefined
    && String(snapshot.Id) === run.steps.campaign.id
    && strategy?.Search?.BiddingStrategyType === 'WB_MAXIMUM_CLICKS' && strategy?.Network?.BiddingStrategyType === 'SERVING_OFF';
  return searchOnly ? `<p>Настройки Директа на ${e(checkedAt)} — Поиск, РСЯ выключена.</p>` : '';
}

function clientJourneyCard(view: AnalyticsView, headline: Headline) {
  return `<article class="card" aria-labelledby="client-journey-title">
    <div class="card-head"><h2 id="client-journey-title">От заявки до клиента</h2></div>
    ${headline.metrikaStale ? '<p class="data-warning">Показан последний сохранённый отчёт Метрики. Данные устарели.</p>'
      : headline.metrikaIncomplete ? '<p class="data-warning">Метрика вернула неполные данные по цели.</p>' : ''}
    <dl class="rows">
      <div><dt>Достижения цели</dt><dd>${headline.reaches === undefined ? '—' : number(headline.reaches)}</dd></div>
      <div><dt>Целевые визиты</dt><dd>${headline.goalVisits === undefined ? '—' : number(headline.goalVisits)}</dd></div>
      <div><dt>Подтверждённые заявки</dt><dd>—</dd></div>
      <div><dt>Подтверждённые клиенты</dt><dd>—</dd></div>
      <div><dt>Стоимость клиента</dt><dd>—</dd></div>
    </dl>
    <p class="card-note">Метрика считает срабатывания цели и визиты с такими событиями. В одном визите цель может сработать несколько раз.</p>
    <p class="card-note">Источник подтверждённых клиентов не подключён. Для числа клиентов и их стоимости нужны подтверждённые записи из CRM или системы заказов с привязкой к кампании.</p>
    ${view.measurement?.verified ? '<p class="card-note">Тестовое достижение цели в Метрике подтверждено.</p>' : ''}
  </article>`;
}

function sourceCard(view: AnalyticsView, headline: Headline) {
  const { settings, metrikaContextCurrent } = view;
  const direct = view.currentReports.find((report) => report.source === 'direct_reports');
  const metrikaDirect = view.currentReports.find((report) => report.source === 'metrika_direct');
  const metrikaSite = view.currentReports.find((report) => report.source === 'metrika_site');
  const context = direct?.context ?? metrikaDirect?.context ?? metrikaSite?.context;
  const metrikaContext = metrikaDirect?.context ?? metrikaSite?.context;
  const campaign = view.runs.find((run) => run.planId === view.settings.directRunId);
  const ad = campaign?.steps.ad?.id, group = campaign?.steps.group?.id;
  const siteRow = metrikaSite ? '<p>Отчёт всего сайта охватывает все визиты. Для показателей кампании используется отчёт с её идентификатором.</p>' : '';
  const goalRow = metrikaContext?.counterId ? `<p>Счётчик ${e(metrikaContext.counterId)} · цель ${e(metrikaContext.goalId ?? '—')}. Счётчик фиксирует срабатывания выбранной цели.</p>` : '';
  const vat = context?.vat === 'included' ? 'В суммах Директа НДС запрошен включённым; ставку источник не подтвердил.'
    : context?.vat === 'excluded' ? 'Расход Директа указан без НДС.' : 'НДС источником не подтверждён.';
  const attribution = metrikaDirect ? 'Метрика связывает визиты с кампанией по последнему переходу (атрибуция last).' : '';
  const zone = direct?.context.timezone === 'Europe/Moscow' ? 'Отчёт Директа получен по Москве.'
    : 'Часовой пояс отчёта Директа пока не подтверждён.';
  return `${view.campaignId ? '<section><h3>Откуда данные</h3>' : '<details class="card card-quiet results-sources"><summary>Откуда данные</summary>'}
    ${headline.fixture ? '<p><span class="state-tag caution">Тестовые данные</span></p>' : ''}
    <dl class="rows">
      <div><dt>Расход, показы, клики</dt><dd>${direct?.status === 'ready' ? 'Яндекс Директ' : 'Отчёт Директа ещё не получен'}</dd></div>
      <div><dt>Достижения цели и целевые визиты</dt><dd>${metrikaContextCurrent && settings.counter && settings.goalId ? `Яндекс Метрика, цель «${e(settings.counter.goals.find(goal => goal.id === settings.goalId)?.name ?? 'выбрана')}»` : 'Нужен счётчик и цель Метрики'}</dd></div>
      <div><dt>Стоимость достижения</dt><dd>${headline.cpa === undefined ? 'Нужен полный свежий отчёт Метрики' : 'Яндекс Метрика'}</dd></div>
      <div><dt>Цена заявки по расходу Директа</dt><dd>—</dd></div>
      ${[headline.direct,headline.metrika].filter(Boolean).map(report => `<div><dt>Период и обновление</dt><dd>${e(sourcePeriod(report))}</dd></div>`).join('')}
    </dl>
    <p class="card-note">Для расчёта цены заявки по расходу Директа нужно подтвердить смысл цели и сопоставимость кампании, периода, часового пояса, НДС, атрибуции и полноты отчётов.</p>
    ${view.campaignId ? '<div>' : '<details class="support"><summary>Подробности и ограничения</summary><div class="support-body">'}
      <p>Смысл цели как бизнес-результата надо подтвердить отдельно.</p>
      <p>${zone} ${vat} Валюта RUB. ${attribution}</p>
      ${siteRow}${goalRow}${platformCard(view)}
      <p>Отчёты содержат итоги по кампании за период. Разбивка по объявлениям и площадкам недоступна.</p>
      <p>Стоимость достижения в Метрике — это стоимость переходов, делённая на число достижений цели в визитах с учтённой стоимостью перехода.</p>
      ${campaign ? `<p>Кампания ${campaign.steps.campaign.id ? `в Директе — <code>${e(campaign.steps.campaign.id)}</code>` : 'ещё не создана в Директе'}; версия плана <code>${e(campaign.campaignPlanId ?? '—')}</code>${ad ? `, объявление <code>${e(ad)}</code>` : ''}${group ? `, группа <code>${e(group)}</code>` : ''}.</p>` : ''}
      ${view.runs.length > 1 ? `<p>В аккаунте несколько записей Директа. Здесь показана выбранная: <code>${e(readableDirectName(campaign?.name ?? '', campaign?.planId ?? ''))}</code>.</p>` : ''}
    </div>${view.campaignId ? '</section>' : '</details></details>'}`;
}

function budgetCard(view: AnalyticsView, headline: Headline) {
  const budget = headline.budget;
  const run = view.runs.find((item) => item.planId === view.settings.directRunId);
  const plan = view.plans.find((item) => item.id === run?.campaignPlanId);
  if (!budget) return '';
  const { percent, spent, remaining, note, firstDayIncomplete } = headline.budgetUsage ?? {};
  const transferred = run?.steps.campaign.phase === 'confirmed' && Boolean(run.steps.campaign.id);
  const state = run?.launch?.observation?.campaignState ?? run?.snapshot?.campaign?.State;
  const moderation = run?.launch?.observation?.campaignStatus ?? run?.snapshot?.campaign?.Status;
  const draft = moderation === 'DRAFT' || campaignDisplayState(state, moderation) === 'draft';
  return `<article class="card results-budget">
    <div class="card-head">${view.campaignId ? '<h3>Бюджет и цель</h3>' : `<h2>Бюджет</h2>${plan ? `<span class="muted small">${e(plan.draft.title)}</span>` : ''}`}</div>
    <p class="big">${plain(budget.amount)}<span> без НДС${budget.period ? ` на ${e(String(budget.period))} дней` : ''}</span></p>
    ${percent === undefined ? '' : `<div class="progress" style="margin-top:14px" role="progressbar" aria-label="Израсходовано из бюджета" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`}
    <dl class="rows"><div><dt>Учтённый расход</dt><dd>${spent ?? '—'}</dd></div><div><dt>Осталось по отчёту</dt><dd>${remaining ?? '—'}</dd></div></dl>
    ${draft ? '' : `<p class="muted small">${budgetStatus(transferred, state, Boolean(plan?.confirmedAt), moderation)}</p>`}
    ${note && !(draft && firstDayIncomplete) ? `<p class="muted small">${e(note)}</p>` : ''}
    ${view.campaignId ? metrikaStatus(view) : ''}
  </article>`;
}

function refreshCard(view: AnalyticsView, hasData: boolean, metrics = '', showMetrika = true) {
  const now = Date.now();
  const { currentReports, reports, canRefresh } = view;
  const directRecovery = !canRefresh.direct_reports ? (() => {
    const run = view.runs.find(item => item.planId === view.settings.directRunId);
    return `<p>${e(view.directReason ?? 'Проверьте подключение Директа.')}
      <a class="inline-link" data-recovery href="${e(connectionHref(view.campaignId ?? run?.campaignId ?? 'default', 'results', view.campaignId ? undefined : run?.planId))}#connect-title">Проверить подключение Директа</a></p>`;
  })() : '';
  const cooldown = (source: AnalyticsSource) => reports.reduce((until, report) =>
    (report.source === 'direct_reports') === (source === 'direct_reports') ? Math.max(until, report.cooldownUntil ?? 0) : until, 0);
  const actions = (Object.keys(sources) as AnalyticsSource[]).filter(source => canRefresh[source] && (!view.campaignId || source !== 'metrika_site')).map((source) => {
      const report = currentReports.find((item) => item.source === source);
      const pending = view.pending?.find(item => item.source === source);
      const running = Boolean(pending);
      const foreign = pending && (pending.context.workspaceId !== view.campaignId ||
        pending.context.runId !== (source === 'metrika_site' ? undefined : view.settings.directRunId) ||
        pending.context.dateFrom !== view.settings.dateFrom || pending.context.dateTo !== view.settings.dateTo);
      const canPollOriginal = source === 'direct_reports' && pending && pending.context.workspaceId === view.campaignId;
      const wait = Math.max(cooldown(source), pending && !pending.interrupted ? pending.retryAt ?? 0 : 0);
      const pendingLink = pending?.context.workspaceId
        ? campaignTabHref(pending.context.workspaceId, 'results', pending.context.runId ? { run: pending.context.runId } : {})
        : routes.results + (pending?.context.runId ? '?run=' + encodeURIComponent(pending.context.runId) : '');
      const pendingRun = pending && view.runs.find(run => run.planId === pending.context.runId);
      const pendingTitle = pending?.context.planTitle || (pendingRun && readableDirectName(pendingRun.name, pendingRun.planId));
      const hint = pending ? `${pendingTitle ? `Ожидается отчёт «${pendingTitle}»` : 'Ожидается отчёт'} за ${date(pending.context.dateFrom)} — ${date(pending.context.dateTo)}.${wait > now ? ' Сверка после ' + time(wait) + '.' : ''}`
        : wait > now ? `Повторное чтение доступно после ${time(wait)}.`
        : report?.error ? `Не удалось прочитать: ${report.error}`
        : report?.stale ? 'Данные старше 24 часов.'
        : '';
      const state = report ? `<span class="state-tag ${['ready', 'empty'].includes(report.status) && !report.stale ? 'success' : 'caution'}">${report.interrupted ? 'Чтение прервано' : report.stale ? 'Устаревший отчёт' : states[report.status]}</span>` : '';
      const action = foreign && !canPollOriginal ? `<a class="inline-link" href="${e(pendingLink)}#refresh-title">Открыть ожидающий отчёт</a>`
        : `<button type="submit" class="${view.campaignId && source === 'direct_reports' ? 'primary' : 'secondary'}" form="analytics-refresh" name="${canPollOriginal ? 'reportId' : 'source'}" value="${canPollOriginal ? e(pending.id) : source}"${wait > now && !canPollOriginal ? ' disabled' : ''}><span>${view.campaignId && source === 'direct_reports' ? running ? 'Сверить отчёт Директа' : 'Запросить отчёт Директа' : `${running ? 'Сверить' : 'Запросить'}: ${sources[source]}`}</span>${uiIcon(running ? 'history' : 'arrow', 16)}</button>`;
      return `<div class="source-row">${action}${state || hint ? `<p class="source-state">${state}${hint ? `<span class="${report?.error ? 'data-warning-inline' : ''}">${e(hint)}</span>` : ''}</p>` : ''}</div>`;
    }).join('');
  return `<section class="card results-refresh" aria-labelledby="refresh-title">
    <div class="card-head">${view.campaignId ? '<h3 id="refresh-title">Отчёт за период</h3>' : '<h2 id="refresh-title">Обновить данные</h2>'}</div>
    ${hasData ? '' : '<p class="results-empty">Данных за период пока нет.</p>'}
    ${metrics}
    ${directRecovery}
    ${actions ? `<form id="analytics-refresh" method="post" action="${analyticsAction('refresh', view.campaignId)}">
      <input type="hidden" name="revision" value="${view.settings.revision}">
      <input type="hidden" name="directRunId" value="${e(view.settings.directRunId ?? '')}">
      <input type="hidden" name="dateFrom" value="${e(view.settings.dateFrom)}">
      <input type="hidden" name="dateTo" value="${e(view.settings.dateTo)}">
      ${!view.campaignId && view.settings.goalId ? `<input type="hidden" name="goalId" value="${e(view.settings.goalId)}">` : ''}
    </form><div class="source-actions">${actions}</div>` : ''}
    ${showMetrika ? metrikaStatus(view) : ''}
  </section>`;
}

function metrikaStatus(view: AnalyticsView) {
  const { settings, metrikaConfigured, metrikaAction } = view;
  const run = view.runs.find(item => item.planId === settings.directRunId);
  const scope = view.campaignId ?? run?.campaignId ?? 'default';
  const context = connectionHref(scope, 'results', view.campaignId ? undefined : run?.planId);
  const reportUnavailable = metrikaAction === 'manage' && view.canRefresh.direct_reports && !view.canRefresh.metrika_direct;
  const [status, anchor, label] = {
    connect: ['Не подключена', 'metrika-title', 'Подключить Метрику'],
    restore: ['Нужно восстановить доступ', metrikaConfigured ? 'metrika-counter' : 'metrika-title', 'Восстановить чтение Метрики'],
    choose_counter: ['Нужен счётчик', 'metrika-counter', 'Выбрать счётчик'],
    replace_counter: [view.missingAccess ? 'Настройки доступа изменились' : 'Нужно сверить счётчик', 'metrika-counter', 'Сменить счётчик'],
    choose_goal: settings.counter?.goals.length
      ? ['Цель не выбрана', 'metrika-goal', 'Выбрать цель']
      : ['У счётчика нет доступных целей', 'metrika-counter', 'Проверить счётчик'],
    manage: !reportUnavailable ? ['Подключена'] : view.goalNeedsDirect
      ? ['Для отчёта нужен логин Директа', 'connect-title', 'Проверить подключение Директа']
      : ['Нужно сверить сайт счётчика', 'metrika-counter', 'Проверить счётчик'],
  }[metrikaAction];
  return `<div class="results-metrika source-state" id="metrika-settings">
    <strong id="metrika-title">Яндекс Метрика</strong>
    <span class="state-tag ${label ? 'caution' : 'success'}">${status}</span>
    ${label ? `<a class="inline-link" data-recovery href="${e(context)}#${anchor}">${label}</a>` : ''}
  </div>`;
}

function previousReports(view: AnalyticsView) {
  const current = view.currentReports;
  const waiting = new Set(view.pending?.map(report => report.id));
  const previous = view.reports.filter(report => !current.includes(report) && !waiting.has(report.id));
  const historic = view.missingAccess && view.lastGoals?.find(report => report.context.runId === view.settings.directRunId);
  if (historic && !previous.some(report => report.id === historic.id)) previous.push(historic);
  if (!previous.length) return '';
  return `${view.campaignId ? `<section><h3>Предыдущие отчёты · ${previous.length}</h3>`
    : `<details class="card previous-reports"><summary>Предыдущие отчёты · ${previous.length}</summary>`}
    ${historic ? `<p class="hint">Последний сохранённый отчёт Метрики от ${stamp(historic.receivedAt ?? historic.requestedAt)}. Новая оценка ждёт доступа к цели.</p>` : ''}
    <ul class="previous-list">${previous.map((report) => {
    const row = report.result?.rows?.[0];
    const cpa = reportCpa(report);
    const cost = typeof row?.costMicros === 'string' && /^\d+$/.test(row.costMicros) ? micros(row.costMicros) : 'нет данных';
    const numbers = report.status !== 'ready' ? (states[report.status] ?? '') : report.source === 'direct_reports'
      ? `Расход ${cost} · Показы ${number(row?.impressions)} · Клики ${number(row?.clicks)}`
      : `Достижения цели ${number(report.result?.metrics?.reaches)} · Целевые визиты ${number(report.result?.metrics?.goalVisits)}${cpa === undefined ? '' : ` · Стоимость достижения ${rubles(cpa)}`}`;
    return `<li><div class="previous-head"><span>${sources[report.source]}</span><span class="muted">${date(report.context.dateFrom)} — ${date(report.context.dateTo)}</span></div>
      <p class="previous-body">${e(numbers)}${report.requestedAt ? ` · запрошен ${stamp(report.requestedAt) || e(report.requestedAt)}` : ''}</p></li>`;
  }).join('')}</ul>${view.campaignId ? '</section>' : '</details>'}`;
}

export function renderAnalytics(view: AnalyticsView, related = '') {
  const { settings } = view;
  const heading = '<div class="page-head results-head"><div><h1>Результаты</h1></div></div>';
  if (!view.runs.some(item => item.steps.campaign.phase === 'confirmed')) {
    return `${view.campaignId ? renderCampaignPanelHeading('results') : heading}
      ${related}<section class="card"><p>Отчёты появятся после создания кампании в Директе.</p>
      <a class="button primary" href="${view.campaignId ? e(campaignTabHref(view.campaignId, 'summary')) : routes.campaigns}">${view.campaignId ? 'Открыть сводку' : 'Перейти к кампаниям'}</a></section>
      ${previousReports(view)}`;
  }
  const run = view.runs.find(item => item.planId === settings.directRunId && item.steps.campaign.phase === 'confirmed');
  if (!run) return view.campaignId ? controls(view) + related : `<div class="page-head results-head"><div><h1>Результаты</h1><p class="lead">Выберите кампанию для отчёта.</p></div></div>${controls(view)}`;
  const h = headline(view);
  // Direct first: it owns spend, impressions and clicks; Metrika follows by scope.
  const order: AnalyticsSource[] = ['direct_reports', 'metrika_direct', 'metrika_daily', 'metrika_site'];
  const current = [...view.currentReports].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
  const plan = view.plans.find((item) => item.id === run.campaignPlanId);
  const title = plan?.draft.title?.trim() || readableDirectName(run.name, run.planId);
  const period = `${date(settings.dateFrom)} — ${date(settings.dateTo)}`;
  const zone = h.direct && h.direct.context.timezone !== 'Europe/Moscow' ? 'часовой пояс Директа не подтверждён' : 'МСК';
  const lead = `${title ? `«${e(title)}» · ` : ''}${period} · ${zone}`;
  const line = [
    h.impressions === undefined ? '' : `<span>Показы ${number(h.impressions)}</span>`,
    h.clicks === undefined ? '' : `<span>Клики ${number(h.clicks)}</span>`,
  ].filter(Boolean).join('');
  const daily = current.find(item => item.source === 'metrika_daily' && item.status === 'ready' && item.result?.days?.length);
  const hasData = h.hasDirect || h.hasMetrika || Boolean(daily);
  if (view.campaignId) {
    const metrics = [
      ['Показы', h.impressions === undefined ? dash : number(h.impressions)],
      ['Клики', h.clicks === undefined ? dash : number(h.clicks)],
      ['Расход', h.spend ? e(h.spend) + (h.spendVat ? `<small>${e(h.spendVat)}</small>` : '') : dash],
      ...(h.reaches === undefined ? [] : [['Достижения цели', number(h.reaches)]]),
      ...(h.cpa === undefined ? [] : [['Стоимость достижения', e(rubles(h.cpa))]]),
    ];
    const stats = `<dl class="campaign-result-metrics">${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
    return `${controls(view)}
      ${related}
      <div class="campaign-result-stack">
        ${refreshCard(view, hasData, stats, !h.budget)}
        ${budgetCard(view, h)}
        ${daily ? dailyCard(daily, h.metrikaStale || h.metrikaIncomplete ? undefined : h.reaches) : ''}
        ${campaignTotals(view, h)}
        ${h.metrika ? clientJourneyCard(view, h) : ''}
      </div>
      <details class="campaign-fold"><summary>Источники и предыдущие отчёты</summary>
        ${sourceCard(view, h)}
        ${current.length ? `<section id="real-analytics" aria-labelledby="real-analytics-title"><h3 id="real-analytics-title">Отчёты источников</h3>${current.map(reportRow).join('')}</section>` : ''}
        ${previousReports(view) || '<p class="muted">Сохранённых предыдущих отчётов пока нет.</p>'}
      </details>`;
  }
  return `<div class="page-head results-head"><div><h1>Результаты</h1><p class="lead">${lead}</p></div></div>
    ${controls(view)}
    <div class="results-overview${h.budget ? ' grid-2' : ''}">
      ${hasData ? `<div class="results-summary">${metricsBlock(h)}${line ? `<p class="metric-line">${line}</p>` : ''}</div>` : refreshCard(view, hasData)}
      ${budgetCard(view, h)}
      ${hasData ? refreshCard(view, hasData) : ''}
    </div>
    <div class="results-reports">
      ${daily ? dailyCard(daily, h.metrikaStale || h.metrikaIncomplete ? undefined : h.reaches) : ''}
      ${campaignTotals(view, h)}
      ${h.metrika ? clientJourneyCard(view, h) : ''}
      ${current.length ? sourceCard(view, h) : ''}
      ${current.length ? `<details class="card results-sources"><summary>Отчёты источников</summary>
          <section id="real-analytics" aria-labelledby="real-analytics-title">
            <h2 class="sr-only" id="real-analytics-title">Отчёты источников</h2>
            ${current.map(reportRow).join('')}
          </section></details>` : ''}
      ${previousReports(view)}
    </div>`;
}
