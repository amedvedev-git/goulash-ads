import type { AnalyticsView } from './analytics-page.ts';
import { renderCampaignDailyReport } from './analytics-page.ts';
import type { ConnectView } from './direct-connect.ts';
import type { DirectView } from './direct.ts';
import { escapeHtml as e } from './operations-page.ts';
import { uiIcon } from './ui-icons.ts';
import { campaignActionHref, campaignBudget, campaignConnectionHref, campaignNextAction, campaignResultsHref, renderCatalogCampaignStatus, sortCampaigns } from './campaign-catalog.ts';
import type { CampaignCatalogItem } from './campaign-catalog.ts';
import { budgetStatus } from './analytics-money.ts';
import { campaignMetrics, sourcePeriod } from './campaign-metrics.ts';
import type { CampaignMetrics } from './campaign-metrics.ts';
import { campaignTabHref, pilotHref, prepareHref, routes } from './routes.ts';

const number = new Intl.NumberFormat('ru-RU');
const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const arrow = uiIcon('arrow', 16);
const missing = '<span class="metric-missing">—<span class="sr-only"> Нет данных</span></span>';
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const day = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`), now = new Date();
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};

function periodLabel(item: CampaignCatalogItem) {
  if (!item.startDate || !item.endDate) return '';
  const now = today();
  if (now < item.startDate) return `Старт ${day(item.startDate)}`;
  if (now > item.endDate) return `Период закончился ${day(item.endDate)}`;
  if (item.state !== 'live') return `Период ${day(item.startDate)} — ${day(item.endDate)}`;
  const total = Math.round((Date.parse(item.endDate) - Date.parse(item.startDate)) / 86400000) + 1;
  const current = Math.round((Date.parse(now) - Date.parse(item.startDate)) / 86400000) + 1;
  return `День ${current} из ${total} · до ${day(item.endDate)}`;
}

function connected(direct?: DirectView, connect?: ConnectView) {
  return Boolean(direct?.enabled || connect?.status === 'connected');
}

function createForm(label = 'Создать кампанию') {
  return `<form method="post" action="/campaign/new"><input type="hidden" name="flow" value="guided"><button class="btn btn-primary" type="submit">${uiIcon('plus', 18)}${label}</button></form>`;
}

function cabinetCard(item: CampaignCatalogItem | undefined, direct?: DirectView, connect?: ConnectView) {
  const online = connected(direct, connect);
  const account = direct?.account ?? connect?.account;
  const target = item ? campaignConnectionHref(item.id, 'overview') : routes.connection;
  return `<article class="card overview-detail" aria-labelledby="overview-cabinet">
    <h2 id="overview-cabinet">Кабинет</h2>
    <div class="overview-detail-key">
      <p class="overview-detail-value">Яндекс Директ</p>
      <p class="muted inline-status"><span class="status-dot${online ? ' ok' : ''}" aria-hidden="true"></span>${online
        ? direct?.mode === 'fixture' ? 'Учебное подключение · вымышленные данные' : 'Подключён' : 'Директ не подключён'}</p>
    </div>
    <div class="overview-detail-data">${online ? `<dl class="rows">
      <div><dt>Номер кабинета</dt><dd>${account ? e(account) : missing}</dd></div>
      <div><dt>Валюта</dt><dd>Рубли</dd></div>
    </dl>` : '<p class="muted small">Подключите кабинет, чтобы создавать черновики и читать отчёты.</p>'}</div>
    <div class="overview-detail-actions"><a class="btn btn-secondary" href="${e(target)}">${online ? 'Подключения' : 'Подключить кабинет'} ${arrow}</a></div>
  </article>`;
}

function emptyOverview(direct?: DirectView, connect?: ConnectView, workspace = false, publicPilotLink = '') {
  return `<div class="page-head"><div><h1>${workspace ? 'Рабочий стол' : 'Обзор'}</h1><p class="lead">Реклама, бюджет и результаты — в одном месте.</p></div></div>
  <div class="grid-2">
    <div class="col-main">
      <article class="card card-hero">
        <h2 style="margin-bottom:10px">Начните с первой кампании</h2>
        <p class="hero-lead">Расскажите, что продвигаете, где работаете и сколько готовы потратить. Goulash соберёт объявление, фразы и план, а вы проверите их перед созданием черновика.</p>
        ${createForm()}
        ${publicPilotLink}
      </article>
    </div>
    <aside class="col-side">
      ${cabinetCard(undefined, direct, connect)}
      <article class="card card-quiet">
        <h2 style="margin-bottom:8px">Показы не включаются</h2>
        <p class="muted small">Сервис создаёт черновик в Яндекс Директе с выключенными показами. Запуск рекламы остаётся за вами.</p>
      </article>
    </aside>
  </div>
  <p class="overview-learning"><a class="link" href="${routes.results}#demo">Учебное перераспределение бюджета ${arrow}</a></p>`;
}

function heroNotes(item: CampaignCatalogItem, metrics: CampaignMetrics, direct?: DirectView, connect?: ConnectView) {
  const notes: string[] = [];
  const run = metrics.run;
  if (run && !connected(direct, connect)) notes.push('Доступ к Директу отключён. Показаны сохранённые данные.');
  if (item.needsReview) notes.push('Последняя операция требует сверки.');
  if (!item.pilotLabel && !item.needsReview && item.stage === 'created' && run?.state !== 'ON' &&
      (run?.state === 'OFF' || run?.state === 'SUSPENDED' || run?.moderation === 'DRAFT')) notes.push('Показы выключены.');
  return notes;
}

function heroReport(metrics: CampaignMetrics) {
  if (!metrics.metrika && !metrics.direct) return `<p class="hero-empty">Отчётов пока нет</p>
    <p>${metrics.run ? 'Их можно запросить в разделе «Результаты».' : 'Они будут доступны после создания черновика в Директе.'}</p>`;
  const missingGoal = metrics.metrika?.status === 'empty' ? 'В отчёте Метрики нет строк.' :
    metrics.metrikaIncomplete ? 'Отчёт Метрики неполный.' : 'Подтверждённых данных о цели пока нет.';
  const metrika = metrics.metrika
    ? [metrics.reaches === undefined ? missingGoal : '', e(sourcePeriod(metrics.metrika)),
      metrics.goalName ? `цель «${e(metrics.goalName)}»` : '', metrics.goalVisits === undefined ? '' : `Целевые визиты: ${number.format(metrics.goalVisits)}`].filter(Boolean).join(' · ')
    : 'Для достижений цели нужен отчёт Метрики.';
  const direct = [
    metrics.direct ? `<span>${e(sourcePeriod(metrics.direct))}</span>` : '',
    metrics.spend ? `<span>Расход <b>${e(metrics.spend)} · ${e(metrics.spendVat ?? '')}</b></span>` : '',
    metrics.impressions !== undefined ? `<span>Показы ${number.format(metrics.impressions)}</span>` : '',
    metrics.clicks !== undefined ? `<span>Клики ${number.format(metrics.clicks)}</span>` : '',
  ].filter(Boolean).join('');
  return `${metrics.reaches === undefined ? '' : `<div class="hero-value">
      <div class="hero-number">${number.format(metrics.reaches)}</div>
      <div>Достижения цели<span class="hero-unit">${metrics.cpa === undefined ? 'Стоимость достижения пока не рассчитана' : `${rub.format(metrics.cpa)} за достижение`}</span></div>
    </div>`}
    <p>${metrika}</p>
    ${direct ? `<div class="hero-facts">${direct}</div>` : ''}`;
}

function heroCard(item: CampaignCatalogItem, metrics: CampaignMetrics, hasOthers: boolean, direct?: DirectView, connect?: ConnectView) {
  const pilot = Boolean(item.pilotLabel);
  const online = connected(direct, connect);
  const run = metrics.run;
  const action = campaignNextAction(item, direct);
  const accessLost = !pilot && run && !online;
  const actionHref = accessLost ? campaignConnectionHref(item.id) : pilot ? campaignActionHref(item) : action.href;
  const actionLabel = accessLost ? 'Восстановить доступ к Директу'
    : pilot || action.label === 'Открыть кампанию' ? 'К кампании' : action.label;
  const resultsHref = pilot ? online ? pilotHref(item.id) + '#pilot-results' : ''
    : run ? campaignResultsHref(item, run.id) : '';
  const period = periodLabel(item);
  const notes = heroNotes(item, metrics, direct, connect);
  if (!pilot && action.hint) notes.push(action.hint);
  const creative = item.creativeTitle?.trim();
  return `<article class="overview-hero" aria-labelledby="overview-campaign">
    <div class="hero-zone">
      <div class="hero-heading"><h2 id="overview-campaign">${e(item.title)}</h2>${item.region.trim() ? `<p>${e(item.region)}</p>` : ''}</div>
      <div class="hero-status">
        <div class="hero-status-line">${renderCatalogCampaignStatus(item)}${period ? `<span>${e(period)}</span>` : ''}</div>
        ${notes.map(note => `<p>${e(note)}</p>`).join('')}
        ${creative && creative !== item.title.trim() ? `<p>Объявление «${e(creative)}»</p>` : ''}
      </div>
      <div class="hero-controls"><a class="btn hero-primary" href="${e(actionHref)}">${actionLabel} ${arrow}</a>
        ${hasOthers ? `<a class="hero-switch task-link" href="${routes.campaigns}">Выбрать кампанию</a>` : ''}</div>
    </div>
    <section class="hero-zone hero-reports" aria-labelledby="overview-reports">
      <div class="hero-heading"><h3 id="overview-reports">Отчёты</h3><p>${pilot ? 'Учебный запуск' : 'Директ и Метрика'}</p></div>
      <div class="hero-status">${pilot ? '<p>Результаты и журнал доступны на экране учебного запуска.</p>' : heroReport(metrics)}</div>
      <div class="hero-controls">${resultsHref ? `<a class="btn hero-secondary" href="${e(resultsHref)}">Результаты ${arrow}</a>` : ''}</div>
    </section>
  </article>`;
}

function miniRow(item: CampaignCatalogItem, analytics?: AnalyticsView) {
  const metrics = campaignMetrics(item, analytics);
  return `<li class="mini-campaign">
    <div class="mini-main">
      <div class="campaign-title"><h3><a href="${campaignActionHref(item)}">${e(item.title)}</a></h3>${renderCatalogCampaignStatus(item)}</div>
      <p class="campaign-sub">${e(item.region.trim() || 'Город не указан')}${item.budget ? ` · ${e(campaignBudget(item.budget, item.period))}` : ''}${metrics.run ? ` · <a class="link" href="${campaignResultsHref(item, metrics.run.id)}">Результаты</a>` : ''}</p>
    </div>
    <dl class="mini-stats">
      <div><dt>Достижения цели</dt><dd>${metrics.reaches === undefined ? missing : number.format(metrics.reaches)}</dd></div>
      <div><dt>Стоимость достижения</dt><dd>${metrics.cpa === undefined ? missing : rub.format(metrics.cpa)}</dd></div>
      <div><dt>Расход</dt><dd>${metrics.spend ?? missing}</dd></div>
    </dl>
    ${[metrics.metrika, metrics.direct].filter(Boolean).map(report => `<p class="campaign-sub">${e(sourcePeriod(report))}</p>`).join('')}
  </li>`;
}

function budgetCard(item: CampaignCatalogItem, metrics: CampaignMetrics) {
  const budget = Number(item.budget);
  const { percent, spent, remaining, note, firstDayIncomplete } = metrics.budgetUsage ?? {};
  const budgetHref = item.guided && (item.preparationStep === 4 || Boolean(metrics.run))
    ? prepareHref(item.id) + '#campaign-budget' : campaignActionHref(item);
  const transferred = item.budgetSource === 'direct';
  const draft = transferred && metrics.run?.moderation === 'DRAFT';
  return `<article class="card overview-detail" aria-labelledby="overview-budget">
    <h2 id="overview-budget">Бюджет</h2>
    <div class="overview-detail-key">${budget > 0 ? `<p class="overview-detail-value">${money.format(budget)}</p>
      <p class="muted">Без НДС${item.period ? ` на ${e(item.period)} дней` : ''}${item.endDate ? `, до ${e(day(item.endDate))}` : ''}</p>`
      : '<p class="muted">Бюджет ещё не задан.</p>'}</div>
    <div class="overview-detail-data">${budget > 0 ? `
      <dl class="rows">
        <div><dt>Учтённый расход</dt><dd>${spent ?? missing}</dd></div>
        <div><dt>Осталось по отчёту</dt><dd>${remaining ?? missing}</dd></div>
      </dl>
      ${percent === undefined ? '' : `<div class="progress" role="progressbar" aria-label="Израсходовано из бюджета" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`}
      ${draft ? '' : `<p class="muted small">${budgetStatus(transferred, metrics.run?.state, item.stage === 'plan', metrics.run?.moderation)}</p>`}
      ${note && !(draft && firstDayIncomplete) ? `<p class="muted small">${e(note)}</p>` : ''}` : ''}</div>
    <div class="overview-detail-actions"><a class="btn btn-secondary" href="${e(budgetHref)}">${budget > 0 ? 'Условия бюджета' : 'Продолжить подготовку'} ${arrow}</a></div>
  </article>`;
}

function limitsCard(item: CampaignCatalogItem, metrics: CampaignMetrics) {
  if (item.pilotLabel || !metrics.run) return '';
  return `<details class="support overview-support"><summary>Подробности и ограничения</summary><div class="support-body">
    <p>Достижения и целевые визиты считает Метрика. В одном визите цель может сработать несколько раз. Стоимость достижения рассчитывает Метрика по визитам с учтённой стоимостью перехода.</p>
    <p>Для подтверждения заявки нужен отдельный источник с привязкой к кампании и проверкой повторов.</p>
    <p>Номера кампании и объектов Директа влияют только на сверку и доступны в «Кампаниях».</p>
  </div></details>`;
}

function campaignAttention(item: CampaignCatalogItem, analytics?: AnalyticsView, direct?: DirectView, connect?: ConnectView) {
  if (item.stopUnconfirmed) return { priority: 0, text: 'Остановка показов ещё не подтверждена', href: item.pilotLabel ? pilotHref(item.id) : campaignActionHref(item), action: 'Сверить остановку' };
  if (item.budgetExceeded) return { priority: 0, text: 'Отчёт показал расход выше подтверждённого лимита', href: item.pilotLabel ? pilotHref(item.id) : campaignActionHref(item), action: 'Проверить расход' };
  const run = item.directRuns?.at(-1);
  if (run && (!connected(direct, connect) || (direct?.account ?? connect?.account) !== run.account))
    return { priority: 1, text: 'Требуется доступ к кабинету кампании', href: campaignConnectionHref(item.id), action: 'Проверить подключение' };
  const lastGoal = run && analytics?.lastGoals?.find(report => report.context.runId === run.id);
  if (run && !item.pilotLabel && analytics?.missingAccess && (lastGoal || analytics.settings.campaignAnalytics?.[item.id]?.measurement?.goalId)) {
    const historic = lastGoal ? ` Последний сохранённый отчёт: ${new Date(lastGoal.receivedAt ?? lastGoal.requestedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} МСК.` : '';
    return { priority: 1, text: 'Для нового отчёта и оценки нужен доступ к Метрике.' + historic,
      href: campaignConnectionHref(item.id, 'overview') + '#metrika-title', action: 'Восстановить чтение Метрики' };
  }
  if (run && !item.pilotLabel && item.state === 'live' && ['direct_reports', 'metrika_direct', 'metrika_daily'].some(source =>
    analytics?.campaignReports.find(report => report.context.runId === run.id && report.source === source && report.status === 'ready')?.stale))
    return { priority: 1, text: 'Данные кампании устарели', href: campaignResultsHref(item, run.id), action: 'Обновить данные' };
  if (item.needsReview) return { priority: 2, text: 'Последняя операция требует сверки', href: campaignActionHref(item), action: 'Сверить состояние' };
  if (item.stage === 'plan') {
    const next = campaignNextAction(item, direct);
    return { priority: 3, text: next.hint, href: next.href, action: next.label };
  }
  return undefined;
}

export function renderOverview(catalog: CampaignCatalogItem[] = [], analytics?: AnalyticsView, direct?: DirectView, connect?: ConnectView,
  workspace = false, publicPilot = false) {
  const items = sortCampaigns(catalog).map(item => ({ item, attention: campaignAttention(item, analytics, direct, connect) }))
    .sort((a, b) => (a.attention?.priority ?? 4) - (b.attention?.priority ?? 4));
  const publicPilotLink = publicPilot ? `<a class="btn btn-secondary" href="${routes.pilot}">Учебный запуск Rollstar</a>` : '';
  if (!items.length) return emptyOverview(direct, connect, workspace, publicPilotLink);
  const { item: hero, attention } = items[0], others = items.slice(1);
  const metrics = campaignMetrics(hero, analytics);
  return `<div class="page-head overview-heading">
    <h1>${workspace ? 'Рабочий стол' : 'Обзор'}</h1>
    <div class="page-actions">${createForm()}${publicPilotLink}</div>
  </div>
  <div class="overview-stack">
      ${attention ? `<article class="card" aria-labelledby="overview-attention"><h2 id="overview-attention">Требуется действие</h2>
        <p>${attention.text}</p><a class="link" href="${attention.href}">${attention.action}</a></article>` : ''}
      ${heroCard(hero, metrics, others.length > 0, direct, connect)}
      <div class="overview-details">
        ${budgetCard(hero, metrics)}
        ${cabinetCard(hero, direct, connect)}
      </div>
      ${hero.pilotLabel ? '' : renderCampaignDailyReport(analytics, metrics.run?.id)}
      ${hero.latestDecision ? `<article class="card"><h2>Последнее решение Goulash</h2>
        <p>${e(hero.latestDecision.reason)}</p><p class="hint">${e(new Date(hero.latestDecision.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} МСК</p>
        <a class="link" href="${campaignTabHref(hero.id, 'journal')}">Открыть журнал кампании</a></article>` : ''}
      ${others.length ? `<article class="card">
        <div class="card-head"><h2>Ещё кампании</h2><a class="link" href="${routes.campaigns}">Все кампании</a></div>
        <ul class="mini-list">${others.slice(0, 5).map(({ item }) => miniRow(item, analytics)).join('')}</ul>
      </article>` : ''}
      ${limitsCard(hero, metrics)}
  </div>`;
}
