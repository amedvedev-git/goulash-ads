import { cpa, dataIssue, budgetError, decide, demoCases, money, policy } from './demo.ts';
import type { DemoState, SavedDemo } from './demo.ts';
import type { CampaignDraft } from './campaign.ts';
import type { HistoryEntry, OperationsView } from './operations.ts';

export function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
const e = escapeHtml;
const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
const date = (value: string) => value.split('-').reverse().join('.');
const number = (value: number) => value.toLocaleString('ru-RU');
const status = (value: string) => value === 'stopped' ? 'Остановлена' : 'Активна';
const spent = (state: DemoState) => state.campaigns.reduce((sum, campaign) => sum + campaign.spent, 0);
const operationUrl = (id: string) => `/history?operation=${encodeURIComponent(id)}#operation-${encodeURIComponent(id)}`;
const kinds: Record<string, string> = {
  baseline: 'Исходное состояние после миграции', draft_created: 'Черновик создан', draft_changed: 'Правка черновика',
  draft_undo: 'Правка отменена', demo_loaded: 'Загрузка тестового набора', automation_applied: 'Остановка и распределение',
  automation_skipped: 'Проверка без изменений', automation_error: 'Ошибка входных данных', automation_undo: 'Решение отменено', undo_conflict: 'Конфликт отмены',
};
const labels: Record<keyof CampaignDraft, string> = {
  description: 'Описание', url: 'Адрес', region: 'География', budget: 'Бюджет, ₽', period: 'Период, дней', title: 'Заголовок', adText: 'Текст',
};
type Change = { label: string; before: string; after: string };
function changes(object: HistoryEntry['object'], before: HistoryEntry['before'], after: HistoryEntry['after']): Change[] {
  const result: Change[] = [];
  const add = (label: string, old: unknown, value: unknown) => {
    if (old !== value) result.push({ label, before: String(old ?? '—'), after: String(value ?? '—') });
  };
  if (object === 'draft') {
    const a = before as CampaignDraft | null, b = after as CampaignDraft | null;
    Object.entries(labels).forEach(([key, label]) => add(label, a?.[key as keyof CampaignDraft], b?.[key as keyof CampaignDraft]));
  } else {
    const a = before as DemoState | null, b = after as DemoState | null;
    if (!b) return result;
    add('Тестовый сценарий', a && demoCases[a.scenario], demoCases[b.scenario]);
    add('Период', a && `${date(a.periodStart)} — ${date(a.periodEnd)}`, `${date(b.periodStart)} — ${date(b.periodEnd)}`);
    add('Цель', a?.goal, b.goal); add('Источник', a?.source, b.source);
    add('Обновление данных', a && time(a.updatedAt), time(b.updatedAt));
    add('Отчёт', a && (a.complete ? 'Полный' : 'Неполный'), b.complete ? 'Полный' : 'Неполный');
    b.campaigns.forEach((campaign) => {
      const old = a?.campaigns.find((item) => item.id === campaign.id);
      add(`${campaign.name} · состояние`, old && status(old.status), status(campaign.status));
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
function changeList(rows: Change[], undo = false) {
  return rows.length ? `<dl class="change-list">${rows.map((row) => `<div><dt>${e(row.label)}</dt><dd><span class="change-value"><small>${undo ? 'Сейчас' : 'До'}</small>${e(row.before)}</span><span class="change-value"><small>${undo ? 'После отмены' : 'После'}</small>${e(row.after)}</span></dd></div>`).join('')}</dl>` : '<p class="muted">Состояние не менялось.</p>';
}
function canUndo(view: OperationsView, entry: HistoryEntry) {
  return !entry.undone && ['draft_changed', 'automation_applied'].includes(entry.kind) &&
    entry.revision === (entry.object === 'draft' ? view.draftRevision : view.demo?.revision);
}
function undoLink(view: OperationsView, entry: HistoryEntry) {
  if (entry.undone) return `<span class="state-tag">Отменено</span>${entry.undoneBy ? ` <a class="inline-link" href="${operationUrl(entry.undoneBy)}">Запись об отмене</a>` : ''}`;
  if (!['draft_changed', 'automation_applied'].includes(entry.kind)) return '';
  return canUndo(view, entry) ? `<a class="button secondary" href="/history?review=${e(entry.id)}#undo-review">${entry.object === 'draft' ? 'Отменить правку' : 'Отменить решение'}</a>`
    : '<span class="muted undo-unavailable">Отмена недоступна: после этой записи были изменения.</span>';
}
function undoReview(view: OperationsView) {
  const review = view.undo;
  if (!review) return '';
  const entry = review.entry;
  const messages = { missing: 'Операция не найдена в этом аккаунте.', already: 'Эта операция уже отменена. Повторная отмена ничего не изменит.',
    unsupported: 'Для этой операции отмена не поддерживается.', conflict: 'Отмена недоступна: после этой записи были изменения. Актуальное состояние сохранено.' };
  return `<section id="undo-review" class="undo-review" aria-labelledby="undo-title"><h2 id="undo-title">${review.status === 'ready' ? 'Проверьте отмену' : 'Отмена не выполнена'}</h2>
    ${review.status === 'ready' && entry ? `<p>${e(kinds[entry.kind])} от ${time(entry.at)}. ${entry.object === 'draft' ? 'Будут восстановлены прежние значения этой правки.' : 'Будут восстановлены состояния кампаний и назначения остатка.'}</p>
      ${changeList(changes(entry.object, review.current ?? null, review.target ?? null), true)}
      ${entry.object === 'demo' ? `<p class="expense-note">Уже учтённый расход <strong>${money(spent(review.current as DemoState))}</strong> и общий лимит <strong>${money((review.current as DemoState).limit)}</strong> сохранятся.</p>` : ''}
      <p class="muted">Отмена создаст связанную запись в истории. Если данные успеют измениться, отмена не выполнится.</p>
      <form method="post" action="/operations/undo"><input type="hidden" name="id" value="${e(entry.id)}"><input type="hidden" name="confirm" value="undo"><div class="actions"><a href="${operationUrl(entry.id)}">Оставить как есть</a><button class="primary" type="submit">Подтвердить отмену</button></div></form>`
      : `<p role="status">${messages[review.status as keyof typeof messages]}</p>${entry ? `<a href="${operationUrl(entry.id)}">Посмотреть операцию</a>${entry.undoneBy ? ` · <a href="${operationUrl(entry.undoneBy)}">Запись об отмене</a>` : ''}` : '<a href="/history">Вернуться к истории</a>'}`}
  </section>`;
}
function historyEntry(view: OperationsView, entry: HistoryEntry, selected = false) {
  const rows = changes(entry.object, entry.before, entry.after);
  const short = entry.kind === 'draft_changed' || entry.kind === 'draft_undo' ? `Изменено: ${rows.map((row) => row.label.toLowerCase()).join(', ')}.`
    : entry.kind === 'automation_applied' ? `${transferTitle(entry.before as DemoState, entry.after as DemoState)}. Учтённый расход ${money(spent(entry.after as DemoState))} сохранён.` : entry.reason;
  return `<article class="history-entry${selected ? ' selected' : ''}" id="operation-${e(entry.id)}">
    <div class="entry-heading"><h3>${e(kinds[entry.kind] ?? entry.kind)}</h3><time datetime="${e(entry.at)}">${time(entry.at)}</time></div>
    <p class="entry-meta">${entry.object === 'draft' ? 'Черновик' : 'Кампании А/Б'} · ${e(entry.actor)}</p><p>${e(short)}</p>
    ${entry.linkedId ? `<p class="inline-link"><a href="${operationUrl(entry.linkedId)}">${entry.kind === 'undo_conflict' ? 'Какая отмена не выполнена' : 'Исходная операция'}</a></p>` : ''}
    <details${selected ? ' open' : ''}><summary>${entry.object === 'draft' ? 'Значения до и после' : 'Причина и изменения'}${rows.length ? ` · ${rows.length}` : ''}</summary><p class="history-reason">${e(entry.reason)}</p>${changeList(rows)}
      <p class="entry-meta">Операция ${e(entry.id)} · версия ${entry.revision}</p></details>
    <div class="entry-actions">${undoLink(view, entry)}</div></article>`;
}
function renderHistory(view: OperationsView, filter: 'all' | 'draft' | 'demo') {
  const entries = view.history.filter((entry) => filter === 'all' || entry.object === filter);
  const focusedElsewhere = view.focus && !entries.some((entry) => entry.id === view.focus!.id);
  return `${undoReview(view)}<section id="history" aria-labelledby="history-title"><div class="section-heading"><h2 id="history-title">Локальный черновик и тестовая автоматика</h2><span class="muted">Время МСК</span></div>
    <nav class="history-filters" aria-label="Фильтр истории">${([['all', 'Все'], ['draft', 'Черновик'], ['demo', 'Кампании А/Б']] as const).map(([key, label]) => `<a href="/history${key === 'all' ? '' : `?scope=${key}`}"${key === filter ? ' aria-current="page"' : ''}>${label} <span>${view.history.filter((entry) => key === 'all' || entry.object === key).length}</span></a>`).join('')}</nav>
    <p class="mode">Последние 100 записей этого аккаунта. Отмена добавляет запись и сохраняет историю.</p>
    ${focusedElsewhere ? `<h3>Выбранная операция</h3>${historyEntry(view, view.focus!, true)}<h3>Последние записи</h3>` : ''}
    ${entries.length ? entries.map((entry) => historyEntry(view, entry, entry.id === view.focus?.id)).join('') : `<div class="empty-state"><h3>${filter === 'all' ? 'История пока пуста' : 'Здесь пока нет записей'}</h3><p>Сохраните правку черновика или проверьте правило на тестовом наборе.</p><a href="${filter === 'draft' ? '/' : '/analytics'}">${filter === 'draft' ? 'Открыть кампанию' : 'Открыть аналитику'}</a></div>`}
  </section>`;
}
function datasetForm(saved?: SavedDemo) {
  return `<form method="post" action="/demo/load" class="dataset-form"><input type="hidden" name="revision" value="${saved?.revision ?? 0}">
    <label for="demo-scenario">Тестовый сценарий</label><div class="dataset-controls"><select id="demo-scenario" name="scenario">${Object.entries(demoCases).map(([key, label]) => `<option value="${key}"${saved?.state.scenario === key ? ' selected' : ''}>${label}</option>`).join('')}</select><button class="${saved ? 'secondary' : 'primary'}" type="submit">${saved ? 'Загрузить новый набор' : 'Загрузить тестовый пример'}</button></div>
    <p class="mode">${saved ? 'Заменит текущие данные и назначения остатка выбранным примером. История сохранится. Загрузку набора отменить нельзя.' : 'Вымышленные расходы и достижения цели. Деньги не расходуются; бюджет черновика не используется.'}</p></form>`;
}
function reportContext(state: DemoState) {
  const age = Date.now() - Date.parse(state.updatedAt), fresh = Number.isFinite(age) && age >= 0 && age <= policy.maxAgeMs;
  return `<div class="report-context"><p><strong>${date(state.periodStart)} — ${date(state.periodEnd)}</strong> · 7 полных дней · МСК <span class="sr-only">Europe/Moscow</span></p>
    <p>Цель: <strong>${e(state.goal)}</strong> <span class="muted">(${e(state.goalId)})</span> · достижения, не подтверждённые продажи.</p>
    <p class="mode">Источник: ${e(state.source)}. Обновлено ${time(state.updatedAt)}.</p>
    <p class="report-quality"><span class="state-tag${state.complete ? '' : ' caution'}">${state.complete ? 'Полный отчёт' : 'Неполный отчёт'}</span><span class="state-tag${fresh ? '' : ' caution'}">${fresh ? 'Не старше 24 часов' : 'Устаревшие данные или неверное время'}</span></p></div>`;
}
function metrics(state: DemoState) {
  const goalsKnown = state.campaigns.every((campaign) => campaign.goals !== null);
  const goals = state.campaigns.reduce((sum, campaign) => sum + (campaign.goals ?? 0), 0);
  const cost = state.complete && goalsKnown && goals > 0 ? money(Math.round(spent(state) / goals)) : 'Не вычисляется';
  const items = [['Расход', money(spent(state))], ['Показы', number(state.campaigns.reduce((sum, c) => sum + c.impressions, 0))],
    ['Клики', number(state.campaigns.reduce((sum, c) => sum + c.clicks, 0))], ['Достижения цели', goalsKnown ? number(goals) : 'Нет полных данных'], ['Стоимость достижения', cost]];
  return `<dl class="metrics" aria-label="Суммарные показатели кампаний А и Б">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    <p class="mode">${!state.complete ? 'Показана только полученная часть отчёта, а не итог за весь период. ' : ''}${!goalsKnown ? 'У части кампаний нет данных о достижениях: общий итог и его стоимость недоступны.' : goals === 0 ? 'Нет достижений: стоимость достижения не вычисляется.' : 'Общая стоимость достижения = суммарный расход А и Б / все их достижения за период.'}</p>`;
}
function analytics(view: OperationsView) {
  const saved = view.demo, state = saved?.state;
  if (!state) return `<section aria-labelledby="empty-analytics"><h2 id="empty-analytics">Посмотрите, как работает аналитика</h2><p>Загрузите тестовый пример, чтобы сравнить две кампании и проверить решение автоматики.</p>${datasetForm()}</section>`;
  const issue = dataIssue(state), error = budgetError(state);
  return `<section id="demo" aria-labelledby="demo-title"><div class="section-heading"><h2 id="demo-title">Результаты кампаний А/Б</h2><span class="test-badge">Тестовые данные</span></div>${reportContext(state)}
    ${metrics(state)}${issue || error ? `<p class="data-warning" role="status">Для автоматики: ${e(error ?? issue!)}</p>` : ''}
    <table id="demo-statistics" class="responsive-table"><caption class="sr-only">Статистика кампаний за указанный период</caption><thead><tr><th scope="col">Кампания</th><th scope="col">Расход</th><th scope="col">Показы</th><th scope="col">Клики</th><th scope="col">Достижения цели</th><th scope="col">Стоимость достижения</th></tr></thead><tbody>
    ${state.campaigns.map((c) => `<tr><th scope="row">${e(c.name)}</th><td data-label="Расход">${money(c.spent)}</td><td data-label="Показы">${number(c.impressions)}</td><td data-label="Клики">${number(c.clicks)}</td><td data-label="Достижения цели">${c.goals === null ? 'Нет данных' : c.goals === 0 ? state.complete ? '0 · подтверждённый ноль' : '0 · неполный отчёт' : number(c.goals)}</td><td data-label="Стоимость достижения">${cpa(c, state.complete) === null ? c.goals === 0 && state.complete ? 'Не вычисляется: 0 достижений' : 'Не вычисляется: нет полных данных' : money(cpa(c, state.complete)!)}</td></tr>`).join('')}</tbody></table>
    <div class="section-next"><p>Проверьте, как правило распорядится оставшимся бюджетом.</p><a class="button primary" href="/automation">Перейти к автоматике</a></div>
    <details class="support-details"><summary>Как читать показатели</summary><p>Расходы, показы, клики и достижения заданы синтетическим набором за указанный период, только для кампаний А и Б. Стоимость достижения — расход / достижения за тот же период, с округлением до копейки. При нуле, отсутствии данных о достижениях или неполном отчёте она не вычисляется. Устаревшие значения остаются видны, но не используются правилом.</p><p>Это наш расчёт на тестовых данных, не метрика CPA Метрики. Атрибуция задана тестовой привязкой достижения к кампании; это не модель Яндекса. Валюта RUB; суммы условно включают НДС. Обновление — время формирования примера.</p></details>
    <details class="support-details" id="datasets"><summary>Сменить тестовый сценарий</summary><p class="mode">Сейчас: ${e(demoCases[state.scenario])}.</p>${datasetForm(saved)}</details></section>`;
}
function transferTitle(before: DemoState, after: DemoState, future = false) {
  const source = before.campaigns.find((c) => c.remaining > (after.campaigns.find((item) => item.id === c.id)?.remaining ?? c.remaining));
  if (!source) return 'Остановка и распределение остатка';
  const amount = source.remaining - after.campaigns.find((c) => c.id === source.id)!.remaining;
  const recipient = after.campaigns.find((c) => c.remaining > before.campaigns.find((old) => old.id === c.id)!.remaining);
  return `${money(amount)} ${future ? 'перейдут' : 'перенесены'} ${recipient ? `из ${source.name.slice(-1)} в ${recipient.name.slice(-1)}` : 'в резерв'}`;
}
function budget(state: DemoState) {
  return `<section aria-labelledby="budget-title"><h2 id="budget-title">Текущий бюджет</h2><p class="mode">Уже учтённый расход не перераспределяется и не возвращается при отмене.</p>
    <dl class="budget-equation" id="budget-total"><div><dt>Учтённый расход</dt><dd>${money(spent(state))}</dd></div><div><dt>Назначенный остаток</dt><dd>${money(state.campaigns.reduce((sum, c) => sum + c.remaining, 0))}</dd></div><div><dt>Резерв</dt><dd>${money(state.reserve)}</dd></div><div><dt>Общий лимит</dt><dd>${money(state.limit)}</dd></div></dl>
    <p class="mode">Расход + назначенный остаток + резерв = общий лимит.</p><table id="demo-budget" class="responsive-table"><caption class="sr-only">Текущее состояние и назначения бюджета</caption><thead><tr><th scope="col">Кампания</th><th scope="col">Состояние</th><th scope="col">Учтено расходов</th><th scope="col">Остаток</th></tr></thead><tbody>${state.campaigns.map((c) => `<tr><th scope="row">${e(c.name)}</th><td data-label="Состояние">${status(c.status)}</td><td data-label="Учтено расходов">${money(c.spent)}</td><td data-label="Остаток">${money(c.remaining)}</td></tr>`).join('')}</tbody></table></section>`;
}
function automation(view: OperationsView) {
  const saved = view.demo;
  if (!saved) return `<section><h2>Сначала нужны тестовые данные</h2><p>В аналитике загрузите пример и посмотрите показатели. Здесь правило объяснит решение и изменит только тестовый остаток.</p><a class="button primary" href="/analytics">Открыть аналитику</a></section>`;
  const state = saved.state, result = view.result, job = view.job, prediction = decide(state);
  const title = job?.status === 'pending' ? 'Проверка выполняется' : result?.undone ? 'Решение отменено' : result ? result.kind === 'automation_applied' ? transferTitle(result.before as DemoState, result.after as DemoState) : 'Бюджет не изменён'
    : prediction.status === 'applied' ? transferTitle(state, prediction.after, true) : 'Правило не изменит бюджет';
  return `<section id="demo" aria-labelledby="decision-title"><div class="section-heading"><h2 id="decision-title">${e(title)}</h2><span class="state-tag${result?.kind === 'automation_applied' && !result.undone ? ' success' : ''}">${job?.status === 'pending' ? 'В очереди' : result?.undone ? 'Отменено' : result ? 'Проверка завершена' : 'Предварительная проверка'}</span></div>
    ${job?.status === 'pending' ? '<p role="status">Задание принято. Страница обновится автоматически после проверки. Повторное нажатие не создаст ещё одно решение.</p><a href="/automation">Обновить результат</a>'
      : result ? `<p>${result.undone ? 'Состояния и назначения восстановлены. Уже учтённый расход сохранён. Этот набор повторно не применяется.' : e(result.reason)}</p>
        <p class="entry-meta">${time(result.at)} · ${e(result.actor)}</p>
        ${result.kind === 'automation_applied' && !result.undone ? changeList(changes('demo', result.before, result.after)) : ''}
        <div class="entry-actions"><a href="${operationUrl(result.id)}">Причина решения и результат в истории</a>${undoLink(view, result)}</div>`
      : `<p class="muted">Расчёт ещё не применён. Кнопка ниже запустит проверку и сохранит её результат в истории.</p>
        ${prediction.status === 'applied' ? `<ul class="rule-evidence">${state.campaigns.map((c) => `<li><strong>${e(c.name)}</strong>: расход ${money(c.spent)}, ${c.goals} достижений${c.goals ? `, стоимость ${money(cpa(c, true)!)}` : ''}. ${c.recipient ? 'Может получить остаток при выполнении условий.' : 'Исключена из получателей.'}</li>`).join('')}</ul>${state.scenario === 'noRecipient' ? '<p>Подходящего получателя нет: остаток будет сохранён в резерве.</p>' : ''}` : `<p class="data-warning">${e(prediction.reason)}</p>`}`}
    <form method="post" action="/demo/run" class="run-rule"><input type="hidden" name="datasetId" value="${e(saved.datasetId)}"><button type="submit" class="${job ? 'secondary' : 'primary'}"${job?.status === 'pending' ? ' disabled' : ''}>${job?.status === 'pending' ? 'Проверка выполняется…' : job ? 'Повторить проверку' : 'Выполнить тестовую проверку'}</button>
      <p class="mode">${job ? 'Повтор этого набора не изменяет бюджет снова, в том числе после отмены. Для нового решения загрузите новый набор в аналитике.' : 'Только кампании А/Б. Реклама не запускается, реальные деньги не расходуются.'}</p></form>
    <details class="support-details"><summary>Условия правила и данные проверки</summary><p>Остановить активную кампанию, если расход от ${money(policy.stopSpend)}, достижений 0 и есть свободный остаток. Получатель: другая разрешённая активная кампания, от ${policy.minGoals} достижений, стоимость достижения до ${money(policy.maxCpa)}. Без получателя остаток поступает в резерв.</p><p>Нужны 7 завершённых полных дней, конец периода не старше двух суток, полный отчёт не старше 24 часов и минимум ${policy.minClicks} кликов у каждой кампании. Это демонстрационные допущения, не рекомендации для реальной рекламы.</p>${reportContext(state)}</details></section>
    ${budget(state)}<p class="section-tail"><a href="/analytics#datasets">Посмотреть показатели или загрузить другой тестовый набор</a></p>`;
}
export function renderOperations(view: OperationsView, section: 'analytics' | 'automation' | 'history' = 'analytics', filter: 'all' | 'draft' | 'demo' = 'all') {
  return section === 'history' ? renderHistory(view, filter) : section === 'analytics' ? analytics(view) : automation(view);
}
