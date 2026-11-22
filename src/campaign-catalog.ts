import { escapeHtml as e } from './operations-page.ts';
import { uiIcon } from './ui-icons.ts';
import { campaignHref, campaignTabHref, connectionHref, pilotHref, prepareHref, resultsHref, routes } from './routes.ts';
import { budgetStatus } from './analytics-money.ts';
import { campaignMetrics, sourcePeriod } from './campaign-metrics.ts';
import type { AnalyticsView } from './analytics-page.ts';
import type { DirectView } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';

export type CatalogDirectRun = {
  id: string;
  name: string;
  account: string;
  campaignId?: string;
  review: boolean;
  complete: boolean;
  region: string;
  budget: string;
  period?: string;
  dates?: {from: string; to: string};
  checkedAt?: string;
  state?: string;
  moderation?: string;
  changed: boolean;
};

export type CampaignStage = 'draft' | 'plan' | 'created' | 'review';
export type CampaignDisplayState = 'draft' | 'live' | 'paused';

export type CampaignCatalogItem = {
  id: string;
  title: string;
  guided?: boolean;
  workspace?: boolean;
  creativeTitle?: string;
  preparationStep?: 1 | 2 | 3 | 4;
  readyStep?: 1 | 2 | 3 | 4;
  stage: CampaignStage;
  state: CampaignDisplayState;
  needsReview: boolean;
  region: string;
  budget: string;
  period: string;
  budgetSource: 'direct' | 'draft';
  conditionsChanged: boolean;
  startDate?: string;
  endDate?: string;
  lastActivity: string;
  directRuns?: CatalogDirectRun[];
  pilotLabel?: string;
  deliveryLabel?: string;
  latestDecision?: { reason: string; at: string };
  stopUnconfirmed?: boolean;
  budgetExceeded?: boolean;
};

// The cabinet has three user-facing states; workflow details stay in the editor.
export function campaignDisplayState(state?: string, moderation?: string): CampaignDisplayState {
  if (state === 'ON') return 'live';
  if (state && ['OFF', 'SUSPENDED'].includes(state) && moderation && moderation !== 'DRAFT') return 'paused';
  return 'draft';
}

export const campaignStates = {
  draft: { title: 'Черновик', tone: 'draft', action: 'Продолжить подготовку' },
  live: { title: 'Показывается', tone: 'live', action: 'Открыть кампанию' },
  paused: { title: 'Остановлена', tone: 'paused', action: 'Открыть кампанию' },
} as const;

export type CampaignStatusTone = CampaignDisplayState | 'review';

export function renderCampaignStatus(label: string, tone: CampaignStatusTone) {
  return `<span class="chip chip-${tone}"><span class="dot" aria-hidden="true"></span>${e(label)}</span>`;
}

const rank = (item: CampaignCatalogItem) => {
  if (item.state === 'live') return 0;
  if (item.state === 'paused') return 1;
  if (item.stage === 'created' || item.stage === 'review') return 2;
  if (item.stage === 'plan') return 3;
  return 4;
};
export function sortCampaigns(items: CampaignCatalogItem[]) {
  return [...items].sort((a, b) => rank(a) - rank(b) || b.lastActivity.localeCompare(a.lastActivity));
}

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('ru-RU');
const checkTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const day = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`), now = new Date();
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(date.getUTCFullYear() !== now.getUTCFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
const time = (value: string) => checkTime.format(new Date(value)) + ' МСК';
const missing = '<span class="metric-missing">—<span class="sr-only"> Нет данных</span></span>';

export function campaignBudget(amount: string, period?: string) {
  return /^\d{1,12}$/.test(amount) && Number(amount) > 0 ? money.format(Number(amount)) + (period ? ` на ${period} дней` : '') : 'Не задан';
}

export function campaignReference(id: string) {
  return id === 'default' ? 'Основная кампания' : `№ ${id.slice(0, 8)}`;
}

export const directResultsHref = resultsHref;
export const campaignEditorHref = campaignHref;
export const campaignConnectionHref = connectionHref;

export function campaignActionHref(item: CampaignCatalogItem) {
  if (item.workspace) return prepareHref(item.id);
  return (item.guided ? prepareHref : campaignEditorHref)(item.id) + (item.stage === 'created' || item.stage === 'review' ? '#direct' : '');
}

export function campaignResultsHref(item: CampaignCatalogItem, runId: string) {
  return item.workspace || item.guided ? campaignTabHref(item.id, 'results', { run: runId }) : directResultsHref(runId);
}

export function readableDirectName(name: string, runId: string) {
  const marker = ` [${runId}]`;
  return name.endsWith(marker) ? name.slice(0, -marker.length) : name;
}

export function directShowing(run: Pick<CatalogDirectRun, 'state' | 'checkedAt'>) {
  if (!run.checkedAt || !Number.isFinite(Date.parse(run.checkedAt))) return 'Состояние показов не сверено';
  const status = run.state === 'OFF' || run.state === 'SUSPENDED' ? 'Показы выключены'
    : run.state === 'ON' ? 'Показы включены' : 'Состояние показов неизвестно';
  return `${status} · ${checkTime.format(new Date(run.checkedAt))} МСК`;
}

function createButton(label = 'Создать кампанию') {
  return `<form method="post" action="/campaign/new"><input type="hidden" name="flow" value="guided"><button class="btn btn-primary" type="submit">${uiIcon('plus', 18)}${label}</button></form>`;
}

export function renderCatalogCampaignStatus(item: CampaignCatalogItem) {
  const state = campaignStates[item.state];
  return renderCampaignStatus(item.pilotLabel ?? item.deliveryLabel ?? state.title, state.tone);
}

export function campaignNextAction(item: CampaignCatalogItem, direct?: DirectView) {
  const href = campaignActionHref(item);
  if (item.stage === 'plan') {
    if (!direct?.enabled || !direct.ownChief || (item.guided && direct.generation === undefined))
      return { href: campaignConnectionHref(item.id), label: 'Подключить Директ', hint: 'План сохранён. Подключите Директ, чтобы создать черновик.' };
    const unresolved = direct.runs?.find(run => run.account === direct.account && hasUnresolvedDirect(run));
    const blocked = direct.blockedCampaignId ?? (unresolved && (unresolved.campaignId ?? 'default'));
    if (blocked || direct.needsReconcile) {
      const target = blocked ?? direct.state?.campaignId ?? item.id;
      return { href: (item.guided ? prepareHref : campaignEditorHref)(target) + '#direct', label: 'Сверить операцию', hint: 'Перед созданием черновика сверьте незавершённую операцию в Директе.' };
    }
    return { href, label: 'Открыть план', hint: 'План подтверждён. Проверьте условия и создайте черновик в Директе.' };
  }
  if (item.stage === 'draft') {
    if (item.preparationStep === undefined && item.creativeTitle)
      return { href, label: 'Открыть черновик', hint: 'Черновик сохранён. Откройте его, чтобы продолжить работу.' };
    const step = item.preparationStep ?? 1;
    const hint = step <= 2 ? 'Заполните предложение и условия рекламы.' : step === 3 ? 'Проверьте объявление и поисковые фразы.'
      : item.readyStep === 4 ? 'Подтвердите план рекламы.' : 'Вернитесь к плану и проверьте изменившиеся условия.';
    return { href, label: 'Продолжить подготовку', hint };
  }
  return { href, label: item.stage === 'review' ? 'Сверить с Директом' : 'Открыть кампанию', hint: '' };
}

function metricNote(metrics: ReturnType<typeof campaignMetrics>) {
  if (metrics.hasDirect && metrics.hasMetrika) return '';
  if (!metrics.hasDirect && !metrics.hasMetrika) return 'Отчётов пока нет: цифры появятся после запроса в «Результатах».';
  if (!metrics.hasMetrika) return 'Для достижений цели нужен свежий отчёт Метрики.';
  return 'Данных о расходе пока нет: нужен отчёт Директа.';
}

function renderRow(item: CampaignCatalogItem, index: number, analytics?: AnalyticsView, direct?: DirectView) {
  const metrics = campaignMetrics(item, analytics);
  const action = campaignNextAction(item, direct);
  const run = metrics.run;
  const { percent, note: budgetNote } = metrics.budgetUsage ?? {};
  const warnings = [
    item.needsReview ? `<p class="campaign-warning">Последняя операция в Директе не подтверждена. <a href="${campaignActionHref(item)}">Сверить состояние</a></p>` : '',
    item.conditionsChanged && item.budgetSource === 'direct'
      ? `<p class="campaign-warning">Черновик отличается от записи в Директе. Действуют условия Директа: ${e(campaignBudget(item.budget, item.period))}. <a href="${campaignActionHref(item)}">Открыть</a></p>` : '',
  ].join('');
  const note = item.pilotLabel ? 'Сопоставление расходов и заказов доступно в учебных результатах.' : metricNote(metrics);
  return `<li class="campaign-row"><article aria-labelledby="campaign-${index}">
    <div class="campaign-main">
      <div class="campaign-title"><h2 id="campaign-${index}">${e(item.title)}</h2>${renderCatalogCampaignStatus(item)}</div>
      <p class="campaign-sub">${e(item.region.trim() || 'Город не указан')}${item.startDate ? ` · с ${e(day(item.startDate))}` : ''}${item.creativeTitle ? ` · «${e(item.creativeTitle)}»` : ''}</p>
      ${warnings}
      ${action.hint ? `<p class="campaign-next">${action.hint}</p>` : ''}
      <dl class="campaign-stats">
        <div><dt>Достижения цели</dt><dd>${metrics.reaches === undefined ? missing : number.format(metrics.reaches)}</dd></div>
        <div><dt>Стоимость достижения</dt><dd>${metrics.cpa === undefined ? missing : rub.format(metrics.cpa)}</dd></div>
        <div><dt>Расход</dt><dd>${metrics.spend ?? missing}${metrics.spend ? ` <small>${e(metrics.spendVat ?? '')}</small>` : ''}</dd></div>
      </dl>
      ${[metrics.metrika, metrics.direct].filter(Boolean).map(report => `<p class="campaign-note">${e(sourcePeriod(report))}${report === metrics.metrika && metrics.goalName ? ` · цель «${e(metrics.goalName)}»` : ''}</p>`).join('')}
      ${percent === undefined ? '' : `<div class="progress campaign-progress" role="progressbar" aria-label="Израсходовано из бюджета" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${percent}%"></i></div>`}
      ${note ? `<p class="campaign-note">${note}</p>` : ''}
      ${budgetNote && metrics.spend ? `<p class="campaign-note">${e(budgetNote)}</p>` : ''}
      <details class="support campaign-details"><summary>Подробности</summary><div class="support-body">
        <p>Номер кампании: <code>${e(item.id === 'default' ? 'основная' : item.id)}</code>.</p>
        ${run ? `<p>Кампания в Директе: <code>${e(run.campaignId!)}</code>${run.checkedAt ? ` · проверено ${e(time(run.checkedAt))}` : ''}.</p><p>${e(directShowing(run))}.</p>` : ''}
        <p>${budgetStatus(item.budgetSource === 'direct', metrics.run?.state, item.stage === 'plan', metrics.run?.moderation)}</p>
      </div></details>
    </div>
    <div class="campaign-actions">
      <a class="btn btn-secondary" href="${action.href}" aria-label="${action.label} — ${e(item.title)}">${action.label}${uiIcon('arrow', 16)}</a>
      ${run ? `<a class="link" href="${item.pilotLabel ? pilotHref(item.id) + '#pilot-results' : campaignResultsHref(item, run.id)}" aria-label="Результаты — ${e(item.title)}">Результаты</a>` : ''}
    </div>
  </article></li>`;
}

const catalogFilters = [
  ['all', 'Все'], ['live', 'Показываются'], ['draft', 'Черновики'], ['review', 'На проверке или паузе'],
] as const;

export function renderCampaignCatalog(items: CampaignCatalogItem[], analytics?: AnalyticsView, status?: string, direct?: DirectView) {
  const ordered = sortCampaigns(items);
  const action = items.length ? `<div class="page-actions">${createButton()}</div>` : '';
  const head = `<div class="page-head"><div><h1>Кампании</h1><p class="lead">Всё, что вы рекламируете. У каждой кампании один бюджет и один статус.</p></div>${action}</div>`;
  if (!ordered.length) return `${head}<section class="card catalog-empty">
    <h2>Начните с первой кампании</h2>
    <p>Опишите бизнес и предложение, проверьте объявление и сумму. Черновик появится в списке после сохранения.</p>
    ${createButton()}
  </section>`;
  const active = catalogFilters.find(([key]) => key === status)?.[0] ?? 'all';
  const shown = ordered.filter(item => {
    if (active === 'all') return true;
    const category = item.state === 'live' ? 'live' : item.state === 'paused' || item.needsReview ? 'review' : 'draft';
    return category === active;
  });
  return `${head}<nav class="history-filters" aria-label="Статус кампании">${catalogFilters.map(([key, label]) =>
    `<a href="${routes.campaigns}${key === 'all' ? '' : '?status=' + key}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    ${shown.length ? `<ul class="campaign-list" aria-label="Кампании">${shown.map((item, index) => renderRow(item, index, analytics, direct)).join('')}</ul>`
    : '<p class="empty-state">Кампаний с этим статусом пока нет.</p>'}`;
}
