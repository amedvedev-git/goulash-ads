import type { ProviderEntry } from './operations-journal.ts';
import { demoCases, money } from './demo.ts';
import type { DemoState } from './demo.ts';
import type { CampaignDraft } from './campaign.ts';
import type { HistoryEntry, OperationsView } from './operations.ts';
import { escapeHtml as e } from './html.ts';
import { routes } from './routes.ts';
import { uiIcon } from './ui-icons.ts';
import { journalUrl, operationUrl, undoLink } from './operations-links.ts';
import { appliedOutcome, demoStatus as campaignStatus, renderAppliedOutcome, spent } from './demo-outcome.ts';

export { escapeHtml } from './html.ts';

const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
const date = (value: string) => value.split('-').reverse().join('.');
const number = (value: number) => value.toLocaleString('ru-RU');
const rub = (value: string) => /^\d{1,12}$/.test(value) ? `${Number(value).toLocaleString('ru-RU')} ₽` : value;
const kinds: Record<string, string> = {
  baseline: 'Исходное состояние после миграции', draft_created: 'Черновик создан', draft_changed: 'Правка черновика',
  draft_undo: 'Правка отменена', demo_loaded: 'Загрузка учебного примера', automation_applied: 'Остановка и распределение',
  automation_enabled: 'Контрольная автоматика включена', automation_disabled: 'Контрольная автоматика выключена',
  automation_skipped: 'Проверка без изменений', automation_error: 'Ошибка входных данных', automation_undo: 'Решение отменено',
  undo_conflict: 'Конфликт отмены',
};
const labels: Record<keyof CampaignDraft, string> = {
  description: 'Описание', url: 'Адрес', region: 'География', budget: 'Бюджет', period: 'Период', title: 'Заголовок', adText: 'Текст',
};
export type Change = { label: string; before: string; after: string };

export function changes(object: HistoryEntry['object'], before: HistoryEntry['before'], after: HistoryEntry['after']): Change[] {
  const result: Change[] = [];
  const add = (label: string, old: unknown, value: unknown) => {
    if (old !== value) result.push({ label, before: String(old ?? '—'), after: String(value ?? '—') });
  };
  if (object === 'draft') {
    const a = before as CampaignDraft | null, b = after as CampaignDraft | null;
    const display = (key: keyof CampaignDraft, draft: CampaignDraft | null) => {
      const value = draft?.[key];
      if (!value) return value;
      return key === 'budget' ? rub(value) : key === 'period' ? value + ' дн.' : value;
    };
    for (const key of Object.keys(labels) as (keyof CampaignDraft)[]) add(labels[key], display(key, a), display(key, b));
  } else {
    const a = before as DemoState | null, b = after as DemoState | null;
    if (!b) return result;
    add('Учебный сценарий', a && demoCases[a.scenario], demoCases[b.scenario]);
    add('Период', a && `${date(a.periodStart)} — ${date(a.periodEnd)}`, `${date(b.periodStart)} — ${date(b.periodEnd)}`);
    add('Цель', a?.goal, b.goal); add('Источник', a?.source, b.source);
    add('Обновление данных', a && time(a.updatedAt), time(b.updatedAt));
    add('Отчёт', a && (a.complete ? 'Полный' : 'Неполный'), b.complete ? 'Полный' : 'Неполный');
    b.campaigns.forEach((campaign) => {
      const old = a?.campaigns.find((item) => item.id === campaign.id);
      add(`${campaign.name} · состояние`, old && campaignStatus(old.status), campaignStatus(campaign.status));
      add(`${campaign.name} · остаток`, old && money(old.remaining), money(campaign.remaining));
      add(`${campaign.name} · расход`, old && money(old.spent), money(campaign.spent));
      add(`${campaign.name} · показы`, old && number(old.impressions), number(campaign.impressions));
      add(`${campaign.name} · клики`, old && number(old.clicks), number(campaign.clicks));
      add(`${campaign.name} · достижения`, old && (old.goals === null ? 'Нет данных' : number(old.goals)), campaign.goals === null ? 'Нет данных' : number(campaign.goals));
      add(`${campaign.name} · получатель`, old && (old.recipient ? 'Разрешён' : 'Исключена'), campaign.recipient ? 'Разрешён' : 'Исключена');
    });
    add('Резерв', a && money(a.reserve), money(b.reserve)); add('Общий лимит', a && money(a.limit), money(b.limit));
  }
  return result;
}

export function changeList(rows: Change[], undo = false) {
  return rows.length ? `<dl class="change-list">${rows.map((row) => `<div><dt>${e(row.label)}</dt><dd><span class="change-value"><small>${undo ? 'Сейчас' : 'До'}</small>${e(row.before)}</span><span class="change-value"><small>${undo ? 'После отмены' : 'После'}</small>${e(row.after)}</span></dd></div>`).join('')}</dl>` : '<p class="muted">Состояние не менялось.</p>';
}

// Who acted, in plain words. Technical owner/auth strings stay inside a disclosure.
const sourceLabelOf = (entry: HistoryEntry) => sourceOf(entry) === 'goulash' ? 'решение Goulash'
  : sourceOf(entry) === 'system' ? 'системная запись'
  : entry.object === 'demo' ? 'учебный пример' : 'ваше изменение';

function moneyEffect(entry: HistoryEntry) {
  const before = entry.before as DemoState | null, after = entry.after as DemoState | null;
  if (entry.object === 'draft') {
    const rows = changes('draft', entry.before, entry.after);
    const budget = rows.find((row) => row.label === 'Бюджет');
    const period = rows.find((row) => row.label === 'Период');
    if (!budget && !period) return '<p class="entry-effect-note">Бюджет не менялся: правка не влияет на сумму.</p>';
    return `<dl class="entry-effect">${budget ? `<div><dt>Бюджет</dt><dd>${e(budget.before)} → ${e(budget.after)}</dd></div>` : ''}${period ? `<div><dt>Период</dt><dd>${e(period.before)} → ${e(period.after)}</dd></div>` : ''}</dl>`;
  }
  if (entry.kind === 'automation_applied' && before && after) {
    const outcome = appliedOutcome(before, after);
    if (outcome) return renderAppliedOutcome(before, after, outcome);
    return `<dl class="entry-effect"><div><dt>Учтённый расход</dt><dd>${money(spent(before))} → ${money(spent(after))}</dd></div></dl>`;
  }
  if (entry.kind === 'automation_undo' && after) {
    const unchanged = before ? spent(before) === spent(after) : true;
    return `<dl class="entry-effect"><div><dt>Назначения после отмены</dt><dd>${after.campaigns.map((campaign) => `${e(campaign.name)} — ${money(campaign.remaining)}`).join(' · ')}</dd></div><div><dt>Учтённый расход</dt><dd>${money(spent(after))} ${unchanged ? 'не изменился' : `(было ${money(spent(before!))})`}</dd></div></dl>`;
  }
  if (entry.kind === 'demo_loaded' && before && after) {
    const lines = [`${money(before.limit)} → ${money(after.limit)}`];
    return `<dl class="entry-effect"><div><dt>Учебный лимит</dt><dd>${lines.map(e).join('')}</dd></div><div><dt>Виртуальный расход</dt><dd>${money(spent(after))}</dd></div></dl>`;
  }
  return `<p class="entry-effect-note">${entry.object === 'demo' ? 'Учебный бюджет не менялся.' : 'Бюджет не менялся.'}</p>`;
}

function historyEntry(view: OperationsView, entry: HistoryEntry, selected = false, campaignId?: string, filters?: Record<string, string>, receipt?: ProviderEntry) {
  const rows = changes(entry.object, entry.before, entry.after);
  const outcome = entry.kind === 'automation_applied' && entry.before && entry.after ? appliedOutcome(entry.before as DemoState, entry.after as DemoState) : undefined;
  const symbol = entry.kind.endsWith('_undo') || entry.kind === 'undo_conflict' ? 'undo'
    : entry.object === 'draft' ? 'edit' : entry.kind === 'demo_loaded' ? 'analytics' : 'automation';
  const changed = entry.kind === 'draft_changed' || entry.kind === 'draft_undo' ? rows.map((row) => row.label.toLowerCase()).join(', ') : '';
  const receiptBody = receipt?.creation;
  const combined = receiptBody && campaignId;
  const details = `<details${selected && !outcome ? ' open' : ''}><summary>${combined ? 'Квитанция и изменения' : `Значения до и после${rows.length ? ` · ${rows.length}` : ''}`}</summary>
      ${combined ? receiptBody.receipt : ''}${changeList(rows)}
      <p class="entry-meta">Кто: ${e(entry.actor)}. ${receipt ? `Черновик сохранён ${time(entry.at)}. ` : ''}Операция <code>${e(entry.id)}</code> · версия ${entry.revision}${entry.campaignId ? ` · кампания <code>${e(entry.campaignId)}</code>` : ''}.</p></details>`;
  const separateReceipt = receiptBody && !combined
    ? `${receiptBody.campaignLink}<details class="support-details"><summary>Квитанция Директа</summary>${receiptBody.receipt}</details>` : '';
  return `<article class="history-entry ops-event${selected ? ' selected' : ''}" data-source="${sourceOf(entry)}" id="operation-${e(entry.id)}">
    <div class="ops-event-icon ${entry.object === 'demo' ? 'ops-event-demo' : ''}">${uiIcon(symbol, 18)}</div><div class="ops-event-content">
    <div class="entry-heading"><h3>${outcome ? `${e(outcome.source.name)} остановлена` : e(kinds[entry.kind] ?? entry.kind)}</h3><time datetime="${e(receipt?.at ?? entry.at)}">${time(receipt?.at ?? entry.at)}</time></div>
    <p class="entry-meta"><span class="source-chip source-chip-${sourceOf(entry)}">${sourceLabelOf(entry)}</span>${changed ? ` · изменено: ${e(changed)}` : ''}</p>
    ${outcome ? '' : `<p class="history-reason">${e(receipt ? 'Черновик сохранён и подтверждён Директом.' : entry.reason)}</p>`}
    ${moneyEffect(entry)}
    ${entry.linkedId ? `<p class="inline-link"><a href="${e(operationUrl(entry.linkedId, campaignId, filters))}">${entry.kind === 'undo_conflict' ? 'Какая отмена не выполнена' : 'Исходная операция'}</a></p>` : ''}
    ${separateReceipt}${details}
    <div class="entry-actions">${undoLink(view, entry, campaignId, filters)}${entry.kind === 'automation_applied' || entry.kind === 'automation_undo' ? `<a class="link" href="${routes.results}#demo">Учебный пример на «Результатах»</a>` : ''}</div></div></article>`;
}

function undoReview(view: OperationsView, campaignId?: string, filters?: Record<string, string>) {
  const review = view.undo;
  if (!review) return '';
  const entry = review.entry;
  const messages = { missing: 'Операция не найдена в этом аккаунте.', already: 'Эта операция уже отменена. Повторная отмена ничего не изменит.',
    unsupported: 'Для этой операции отмена не поддерживается.', conflict: 'Отмена недоступна: после этой записи были изменения. Актуальное состояние сохранено.' };
  return `<section id="undo-review" class="undo-review ops-sheet" aria-labelledby="undo-title"><div class="ops-heading"><h2 id="undo-title">${review.status === 'ready' ? 'Проверьте отмену' : 'Отмена не выполнена'}</h2>${uiIcon('undo')}</div>
    ${review.status === 'ready' && entry ? `<p>${e(kinds[entry.kind])} от ${time(entry.at)}. ${entry.object === 'draft' ? 'Будут восстановлены прежние значения этой правки.' : 'Будут восстановлены состояния кампаний и назначения остатка.'}</p>
      ${changeList(changes(entry.object, review.current ?? null, review.target ?? null), true)}
      ${entry.object === 'demo' ? `<p class="expense-note">Уже учтённый расход <strong>${money(spent(review.current as DemoState))}</strong> и общий лимит <strong>${money((review.current as DemoState).limit)}</strong> сохранятся.</p>` : ''}
      <p class="muted">Уже потраченные деньги не возвращаются — отмена меняет только дальнейшие показы и назначения. Отмена создаст связанную запись в истории; если данные успеют измениться, она не выполнится.</p>
      <form method="post" action="${e(journalUrl(campaignId, filters, {}, '/operations/undo'))}"><input type="hidden" name="id" value="${e(entry.id)}"><input type="hidden" name="confirm" value="undo"><div class="actions"><a href="${e(operationUrl(entry.id, campaignId, filters))}">Оставить как есть</a><button class="primary" type="submit">Подтвердить отмену</button></div></form>`
      : `<p role="status">${messages[review.status as keyof typeof messages]}</p>${entry ? `<a href="${e(operationUrl(entry.id, campaignId, filters))}">Посмотреть операцию</a>${entry.undoneBy ? ` · <a href="${e(operationUrl(entry.undoneBy, campaignId, filters))}">Запись об отмене</a>` : ''}` : `<a href="${e(journalUrl(campaignId, filters))}">Вернуться к истории</a>`}`}
  </section>`;
}

type Source = 'goulash' | 'mine' | 'system';
// Who made the record: a Goulash decision, an owner action, or the migration baseline.
const sourceOf = (entry: HistoryEntry): Source => entry.kind === 'baseline' ? 'system'
  : ['automation_applied', 'automation_skipped', 'automation_error'].includes(entry.kind) ? 'goulash' : 'mine';
const sourceLabels: Record<Source, string> = { goulash: 'решение Goulash', mine: 'ваше изменение', system: 'системная запись' };

export function renderHistory(view: OperationsView | undefined, filter: 'all' | 'draft' | 'demo' = 'all', source: 'all' | 'goulash' | 'mine' = 'all', campaignId?: string, providers: ProviderEntry[] = []) {
  if (!view) return `<div class="page-head"><div><h1>История</h1><p class="lead">Что менялось и почему.</p></div></div>`;
  const filters: Record<string, string> = {};
  if (!campaignId && filter !== 'all') filters.scope = filter;
  if (source !== 'all') filters.by = source;
  // The earliest confirmed receipt represents the original creation. Later runs remain independent actions.
  const receipts = new Map<string, ProviderEntry>();
  for (const event of [...providers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const id = event.creation?.operationId;
    if (id && !receipts.has(id)) receipts.set(id, event);
  }
  const attached = new Set(receipts.values());
  type Row = { at: string; object: 'draft' | 'demo'; source: Source; anchors: string[]; operation?: HistoryEntry; html: string };
  const rows: Row[] = view.history.map(operation => {
    const receipt = receipts.get(operation.id);
    return { at: receipt?.at ?? operation.at, object: operation.object, source: sourceOf(operation), anchors: receipt?.anchors ?? [],
      operation, html: historyEntry(view, operation, operation.id === view.focus?.id, campaignId, filters, receipt) };
  });
  for (const event of providers) if (!attached.has(event)) {
    rows.push({ at: event.at, object: 'draft', source: event.source, anchors: event.anchors,
      html: `<article class="history-entry ops-event" data-source="${event.source}"><div class="ops-event-icon">${uiIcon(event.source === 'mine' ? 'edit' : 'automation', 18)}</div>
        <div class="ops-event-content"><p class="entry-meta"><span class="source-chip source-chip-${event.source}">${sourceLabels[event.source]}</span>
        · <time datetime="${e(event.at)}">${time(event.at)}</time></p>${event.html}</div></article>` });
  }
  // Millisecond ties retain recorded order within each stream, with creation below later actions.
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) ||
    Number(a.operation?.kind === 'draft_created') - Number(b.operation?.kind === 'draft_created'));
  const matches = (row: Row, scope: typeof filter, by: typeof source) =>
    (scope === 'all' || row.object === scope) && (by === 'all' || row.source === by);
  const visible = rows.filter(row => matches(row, filter, source));
  const count = (scope: typeof filter, by: typeof source) => rows.filter(row => matches(row, scope, by)).length;
  const focusedElsewhere = view.focus && !visible.some(row => row.operation?.id === view.focus!.id);
  const usedAnchors = new Set<string>();
  const timeline = visible.map(row => {
    const anchors = row.anchors.filter(id => !usedAnchors.has(id));
    anchors.forEach(id => usedAnchors.add(id));
    return anchors.map(id => `<span id="${e(id)}"></span>`).join('') + row.html;
  }).join('');
  const href = (scope: typeof filter, by: typeof source) => {
    const params: Record<string, string> = {};
    if (!campaignId && scope !== 'all') params.scope = scope;
    if (by !== 'all') params.by = by;
    return journalUrl(campaignId, params);
  };
  if (campaignId) {
    const empty = source === 'goulash' ? 'Решений сервиса пока нет.'
      : source === 'mine' ? 'Ваших изменений пока нет.' : 'Здесь пока нет записей.';
    return `<div class="operations campaign-journal">${undoReview(view, campaignId, filters)}
      <section class="campaign-content-section" aria-label="Записи кампании"><div class="ops-timeline">
      ${focusedElsewhere ? `<h3>Выбранная операция</h3>${historyEntry(view, view.focus!, true, campaignId, filters, receipts.get(view.focus!.id))}<h3>Последние записи</h3>` : ''}
      ${timeline || `<p class="muted">${empty}</p>`}</div></section></div>`;
  }
  return `${campaignId ? '' : '<div class="page-head"><div><h1>История</h1><p class="lead">Что менялось и почему. Отмену можно проверить до подтверждения: сначала последствия, потом кнопка.</p></div></div>'}
    <div class="operations">${undoReview(view, campaignId, filters)}<div class="ops-grid"><section class="ops-sheet" aria-labelledby="history-title"><div class="ops-heading"><h2 id="history-title">Изменения и решения</h2></div>
    ${campaignId ? '' : `<nav class="history-filters" aria-label="Фильтр по объекту">${([['all', 'Все'], ['draft', 'Изменения кампании'], ['demo', 'Учебный пример']] as const).map(([key, label]) => `<a href="${href(key, source)}"${key === filter ? ' aria-current="page"' : ''}>${label} <span>${count(key, source)}</span></a>`).join('')}</nav>`}
    <nav class="history-filters history-sources" aria-label="Источник записи"><span class="mode">Источник:</span>${([['all', 'Все'], ['goulash', 'Решения Goulash'], ['mine', 'Мои изменения']] as const).map(([key, label]) => `<a href="${href(filter, key)}"${key === source ? ' aria-current="page"' : ''}>${label} <span>${count(filter, key)}</span></a>`).join('')}</nav>
    <p class="mode">Число в фильтре — количество действий. Квитанция входит в запись действия. Сначала новые записи, время МСК. Видны последние 100 локальных записей и сохранённые операции Директа.</p>
    <div class="ops-timeline">${focusedElsewhere ? `<h3>Выбранная операция</h3>${historyEntry(view, view.focus!, true, campaignId, filters, receipts.get(view.focus!.id))}<h3>Последние записи</h3>` : ''}
    ${timeline || (campaignId
      ? '<div class="empty-state"><h3>Здесь пока нет записей</h3><p>После сохранения правок здесь появятся изменения кампании.</p></div>'
      : `<div class="empty-state"><h3>${filter === 'all' && source === 'all' ? 'История пока пуста' : 'Здесь пока нет записей'}</h3><p>${filter === 'all' && source === 'all' ? 'Сохраните правку кампании или загрузите учебный пример.' : 'Измените фильтр или выберите другой источник записей.'}</p><a href="${filter === 'all' && source === 'all' ? routes.results + '#demo' : '/history'}">${filter === 'all' && source === 'all' ? 'Открыть учебный пример' : 'Показать все записи'}</a></div>`)}
    </div></section><aside class="ops-sheet ops-guide history-side"><div class="ops-event-icon">${uiIcon('undo')}</div><h2>Как работает отмена</h2><p>Отмена возвращает прежние значения и назначения. Уже потраченные деньги не возвращаются, и это видно до подтверждения.</p><p class="mode">Если данные успеют измениться, отмена не выполнится: актуальное состояние сохранится. Отмена появляется в истории отдельной записью.</p>${campaignId ? '' : `<a class="ops-link" href="${routes.results}#demo">Открыть учебный пример ${uiIcon('arrow', 16)}</a>`}</aside></div></div>`;
}
