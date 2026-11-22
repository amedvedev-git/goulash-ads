import { budgetError, cpa, dataIssue, decide, demoCases, demoPreset, money, policy, presetLimit } from './demo.ts';
import type { DemoState, SavedDemo } from './demo.ts';
import type { OperationsView } from './operations.ts';
import { escapeHtml as e } from './html.ts';
import { uiIcon } from './ui-icons.ts';
import { appliedOutcome, demoStatus as campaignStatus, renderAppliedOutcome, spent, transferTitle } from './demo-outcome.ts';
import { operationUrl, undoLink } from './operations-links.ts';
import { changeList, changes } from './operations-page.ts';

// "Учебный пример" — synthetic A/B campaigns, clearly separated from real numbers.
const date = (value: string) => value.split('-').reverse().join('.');
const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
const number = (value: number) => value.toLocaleString('ru-RU');
export type DemoNotice = { text: string; error: boolean };

function datasetForm(saved?: SavedDemo, view?: OperationsView) {
  const revision = `<input type="hidden" name="revision" value="${saved?.revision ?? 0}">`;
  const scenario = (id: string) => `<label for="${id}">Учебный сценарий</label><select id="${id}" name="scenario">${Object.entries(demoCases).map(([key, label]) =>
    `<option value="${key}"${saved?.state.scenario === key ? ' selected' : ''}>${e(label)}</option>`).join('')}</select>`;
  const replacement = saved ? '<p class="mode">Загрузка заменит текущие назначения. Прежние решения останутся в истории. При смене источника правило выключится.</p>' : '';
  const presetForm = `<form method="post" action="/demo/load" class="dataset-form">${revision}<input type="hidden" name="preset" value="${demoPreset}">
    ${saved ? scenario('preset-scenario') : '<input type="hidden" name="scenario" value="control">'}
    <button class="${saved ? 'secondary' : 'primary'}" type="submit">${saved ? 'Загрузить готовый набор' : 'Открыть готовый пример'}</button></form>`;
  const planForm = view?.plans?.length ? `<details class="support-details"><summary>Использовать свой подтверждённый план</summary>
    <form method="post" action="/demo/load" class="dataset-form">${revision}
    <label for="control-plan">План для расчёта лимита и срока</label><select id="control-plan" name="planId" required><option value="">Выберите план</option>${view.plans.map(p =>
      `<option value="${e(p.id)}"${saved?.state.planRef?.id === p.id ? ' selected' : ''}>${e(p.draft.title)} · ${e(p.draft.budget)} ₽ / ${p.draft.period} дней · ${e(time(p.confirmedAt))}</option>`).join('')}</select>
    ${scenario('demo-scenario')}<p class="mode">Расходы и достижения будут вымышленными.</p>
    <button class="secondary" type="submit">Загрузить пример по плану</button></form></details>` : '';
  return replacement + presetForm + planForm;
}

function reportContext(state: DemoState) {
  const age = Date.now() - Date.parse(state.updatedAt), fresh = Number.isFinite(age) && age >= 0 && age <= policy.maxAgeMs;
  return `<div class="report-context">${state.planRef ? `<p><strong>Контекст плана: ${e(state.planContext!.title)}</strong> · подтверждён ${e(time(state.planContext!.confirmedAt))}. Только виртуальные назначения; это не календарь и не статистика реальной кампании.</p>` : state.preset === demoPreset ? '<p>Готовый пример Goulash на вымышленных данных.</p>' : '<p class="data-warning">Архивный учебный набор. Для фоновой проверки загрузите свежий пример.</p>'}<p><strong>${date(state.periodStart)} — ${date(state.periodEnd)}</strong> · ${state.periodDays ?? 7} полных дней · МСК <span class="sr-only">Europe/Moscow</span></p>
    <p>Цель: <strong>${e(state.goal)}</strong> <span class="muted">(${e(state.goalId)})</span> · достижения, не подтверждённые продажи.</p>
    <p class="mode">Источник: ${e(state.source)}. Обновлено ${time(state.updatedAt)}.</p>
    <p class="report-quality"><span class="state-tag${state.complete ? '' : ' caution'}">${state.complete ? 'Полный отчёт' : 'Неполный отчёт'}</span><span class="state-tag${fresh ? '' : ' caution'}">${fresh ? 'Не старше 24 часов' : 'Устаревшие данные или неверное время'}</span></p></div>`;
}

function demoMetrics(state: DemoState) {
  const goalsKnown = state.campaigns.every((campaign) => campaign.goals !== null);
  const goals = state.campaigns.reduce((sum, campaign) => sum + (campaign.goals ?? 0), 0);
  const cost = state.complete && goalsKnown && goals > 0 ? money(Math.round(spent(state) / goals)) : 'Не вычисляется';
  const items = [['Расход', money(spent(state))], ['Показы', number(state.campaigns.reduce((sum, c) => sum + c.impressions, 0))],
    ['Клики', number(state.campaigns.reduce((sum, c) => sum + c.clicks, 0))], ['Достижения цели', goalsKnown ? number(goals) : 'Нет полных данных'], ['Стоимость достижения', cost]];
  return `<dl class="metrics" aria-label="Суммарные показатели учебных кампаний А и Б">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    <p class="mode">${!state.complete ? 'Показана только полученная часть отчёта, а не итог за весь период. ' : ''}${!goalsKnown ? 'У части кампаний нет данных о достижениях: общий итог и его стоимость недоступны.' : goals === 0 ? 'Нет достижений: стоимость достижения не вычисляется.' : 'Общая стоимость достижения = суммарный расход А и Б / все их достижения за период.'}</p>`;
}

function demoStatistics(state: DemoState) {
  return `<table id="demo-statistics" class="responsive-table"><caption class="sr-only">Статистика учебных кампаний за указанный период</caption><thead><tr><th scope="col">Кампания</th><th scope="col">Расход</th><th scope="col">Показы</th><th scope="col">Клики</th><th scope="col">Достижения цели</th><th scope="col">Стоимость достижения</th></tr></thead><tbody>
    ${state.campaigns.map((c) => `<tr><th scope="row">${e(c.name)}</th><td data-label="Расход">${money(c.spent)}</td><td data-label="Показы">${number(c.impressions)}</td><td data-label="Клики">${number(c.clicks)}</td><td data-label="Достижения цели">${c.goals === null ? 'Нет данных' : c.goals === 0 ? (state.complete ? '0 · подтверждённый ноль' : '0 · неполный отчёт') : number(c.goals)}</td><td data-label="Стоимость достижения">${cpa(c, state.complete) === null ? (c.goals === 0 && state.complete ? 'Не вычисляется: 0 достижений' : 'Не вычисляется: нет полных данных') : money(cpa(c, state.complete)!)}</td></tr>`).join('')}</tbody></table>`;
}

function demoBudget(state: DemoState) {
  const used = spent(state), remaining = state.campaigns.reduce((sum, c) => sum + c.remaining, 0);
  return `<section class="ops-budget" aria-labelledby="demo-budget-title"><div class="ops-heading"><h3 id="demo-budget-title">Учебный бюджет</h3>${uiIcon('budget')}</div>
    <p class="mode">Виртуальный расход из лимита</p><p class="ops-budget-total">${money(used)} <small>из ${money(state.limit)}</small></p>
    ${!budgetError(state) && state.limit > 0 ? `<meter class="ops-meter" min="0" max="${state.limit / 100}" value="${used / 100}" aria-label="Учтено из виртуального лимита" aria-valuetext="${money(used)} из ${money(state.limit)}">${money(used)} из ${money(state.limit)}</meter>` : ''}
    <dl class="ops-budget-facts" id="budget-total"><div><dt>Назначенный остаток</dt><dd>${money(remaining)}</dd></div><div><dt>Резерв</dt><dd>${money(state.reserve)}</dd></div></dl>
    <p class="mode">Уже учтённый расход не перераспределяется и не возвращается при отмене.</p>
    <details class="support-details"><summary>Расходы и остатки по кампаниям</summary><table id="demo-budget" class="responsive-table"><caption class="sr-only">Текущее состояние и назначения бюджета</caption><thead><tr><th scope="col">Кампания</th><th scope="col">Состояние</th><th scope="col">Учтено расходов</th><th scope="col">Остаток</th></tr></thead><tbody>${state.campaigns.map((c) => `<tr><th scope="row">${e(c.name)}</th><td data-label="Состояние">${campaignStatus(c.status)}</td><td data-label="Учтено расходов">${money(c.spent)}</td><td data-label="Остаток">${money(c.remaining)}</td></tr>`).join('')}</tbody></table></details></section>`;
}

function demoPermission(view: OperationsView, saved: SavedDemo) {
  return `<section id="control-permission" class="ops-permission" aria-labelledby="permission-title"><div class="ops-heading"><h3 id="permission-title">Управление правилом</h3><span class="state-tag${view.permission?.enabled ? ' success' : ''}">${view.permission?.enabled ? 'Включено' : 'Выключено'}</span></div>
    ${saved.state.planContext ? `<p class="mode">План «${e(saved.state.planContext.title)}» · ${e(time(saved.state.planContext.confirmedAt))}</p>` : ''}
    <p>Правило работает в фоне. Оно может остановить учебную кампанию А или Б и перенести её виртуальный остаток другой кампании либо в резерв.</p>
    <form method="post" action="/demo/permission"><input type="hidden" name="revision" value="${view.permission?.revision ?? 0}"><input type="hidden" name="datasetId" value="${e(saved.datasetId)}"><input type="hidden" name="enabled" value="${view.permission?.enabled ? 'no' : 'yes'}">${view.permission?.enabled ? '' : '<label class="check"><input type="checkbox" name="confirm" value="control" required>Разрешаю фоновому правилу самостоятельно менять только учебные назначения выбранного набора</label>'}<button type="submit" class="${view.permission?.enabled ? 'secondary' : 'primary'}">${uiIcon(view.permission?.enabled ? 'pause' : 'play', 16)}${view.permission?.enabled ? 'Выключить автоматику' : 'Включить контрольную автоматику'}</button></form>
    <p class="mode">Новый набор из того же источника проверяется автоматически. Выключение сохраняет уже выполненные решения.</p></section>`;
}

// Inner HTML of the decision block. Re-rendered by /demo/status without a page reload.
export function demoDecision(view: OperationsView) {
  const saved = view.demo;
  if (!saved) return '';
  const state = saved.state, result = view.result, job = view.job, prediction = decide(state);
  const applied = result?.kind === 'automation_applied' && !result.undone;
  const before = applied ? result!.before as DemoState : undefined;
  const after = applied ? result!.after as DemoState : undefined;
  const outcome = before && after ? appliedOutcome(before, after) : undefined;
  const title = job?.status === 'pending' ? 'Проверка выполняется' : result?.undone ? 'Решение отменено'
    : result ? (result.kind === 'automation_applied' ? transferTitle(result.before as DemoState, result.after as DemoState) : 'Бюджет не изменён')
    : prediction.status === 'applied' ? transferTitle(state, prediction.after, true) : 'Правило не изменит бюджет';
  const tag = job?.status === 'pending' ? 'В очереди' : result?.undone ? 'Отменено' : result ? 'Проверка завершена' : 'Предварительная проверка';
  const body = job?.status === 'pending'
    ? '<p class="mode">Задание принято. Результат появится здесь после проверки; повторное нажатие не создаст ещё одно решение.</p>'
    : result
      ? `${outcome && before && after ? renderAppliedOutcome(before, after, outcome) : `<p>${result.undone ? 'Состояния и назначения восстановлены. Уже учтённый расход сохранён. Этот набор повторно не применяется.' : e(result.reason)}</p>`}
        <p class="demo-meta">${time(result.at)} · учебный пример</p>
        <div class="demo-actions"><a href="${operationUrl(result.id)}">Причина решения и результат в истории</a>${undoLink(view, result)}</div>
        ${applied ? `<details class="support-details"><summary>Значения до и после</summary>${changeList(changes('demo', result.before, result.after))}</details>` : ''}`
      : `<p class="mode">Расчёт ещё не применён. После включения полномочий фоновое правило самостоятельно проверит снимок и сохранит результат.</p>
        ${prediction.status === 'applied' ? `<ul class="rule-evidence">${state.campaigns.map((c) => `<li><strong>${e(c.name)}</strong>: расход ${money(c.spent)}, ${c.goals} достижений${c.goals ? `, стоимость ${money(cpa(c, true)!)}` : ''}. ${c.recipient ? 'Может получить остаток при выполнении условий.' : 'Исключена из получателей.'}</li>`).join('')}</ul>${state.scenario === 'noRecipient' ? '<p>Подходящего получателя нет: остаток будет сохранён в резерве.</p>' : ''}` : `<p class="data-warning">${e(prediction.reason)}</p>`}`;
  return `<div class="demo-decision-head"><h3>${e(title)}</h3><span class="state-tag${applied ? ' success' : ''}">${tag}</span></div>${body}`;
}

// Full learning-example card. Always rendered at the bottom of "Результаты".
export function renderDemoSection(view: OperationsView | undefined, notice?: DemoNotice) {
  const info = '<p class="demo-lead">Две вымышленные кампании делят бюджет. Посмотрите, куда правило перенесёт остаток и как отменить перенос.</p>';
  const noticeHtml = notice ? `<div id="notification" class="notice${notice.error ? ' error' : ''}" role="${notice.error ? 'alert' : 'status'}" tabindex="-1"><p>${e(notice.text)}</p></div>` : '';
  const saved = view?.demo;
  const empty = `<p>Учебный лимит <strong>${money(presetLimit)}</strong> на 7 дней. Подключение к Директу не требуется.</p><div id="datasets">${datasetForm(undefined, view)}</div>`;
  if (!view || !saved) return `<section id="demo" class="card card-demo" aria-labelledby="demo-title">
    <p class="demo-label">${uiIcon('info', 14)} Вымышленные данные</p>
    <h2 id="demo-title">Учебный перенос бюджета</h2>${info}${noticeHtml}${empty}</section>`;
  const state = saved.state, issue = dataIssue(state), error = budgetError(state);
  return `<section id="demo" class="card card-demo" aria-labelledby="demo-title">
    <p class="demo-label">${uiIcon('info', 14)} Вымышленные данные</p>
    <h2 id="demo-title">Учебный перенос бюджета</h2>${info}${noticeHtml}
    ${view.job?.status === 'pending' || (view.permission?.enabled && !view.result) ? `<p class="demo-status" id="demo-status" role="status" aria-live="polite" data-demo-poll="${e(saved.datasetId)}">${view.job?.status === 'pending' ? 'Проверка выполняется.' : 'Правило включено, проверка начнётся в течение минуты.'} Статус обновится автоматически, страница не перезагрузится.</p>` : ''}
    <div id="demo-decision" data-demo-decision>${demoDecision(view)}</div>
    ${demoPermission(view, saved)}
    ${demoBudget(state)}
    <h3 class="demo-sub">Результаты учебных кампаний А/Б</h3>
    ${demoMetrics(state)}${issue || error ? `<p class="data-warning" role="status">Для учебного правила: ${e(error ?? issue!)}</p>` : ''}
    ${demoStatistics(state)}
    <details class="support-details" id="datasets"><summary>Сменить тестовый сценарий</summary><p class="mode">Сейчас: ${e(demoCases[state.scenario])}.</p>${datasetForm(saved, view)}</details>
    <details class="support-details"><summary>Источник и контекст показателей</summary>${reportContext(state)}<p>Стоимость достижения — расход / достижения за тот же период, с округлением до копейки. При нуле, отсутствии данных о достижениях или неполном отчёте она не вычисляется. Устаревшие значения остаются видны, но не используются правилом.</p><p>Стоимость достижения рассчитана по условной привязке достижения к кампании. Валюта RUB; суммы условно включают НДС.</p></details>
    <details class="support-details"><summary>Условия правила и данные проверки</summary><p>Остановить активную кампанию при расходе от ${money(policy.stopSpend)}, нуле достижений и свободном остатке. Остаток получает другая разрешённая активная кампания с ${policy.minGoals} достижениями или больше и ценой до ${money(policy.maxCpa)} за достижение. Если получателя нет, остаток поступает в резерв.</p><p>Для учебного правила нужны ${state.periodDays ?? 7} завершённых полных дней с концом периода не старше двух суток, полный отчёт не старше 24 часов и минимум ${policy.minClicks} кликов у каждой кампании.</p></details>
    </section>`;
}

// JSON for the status endpoint: no reload, no focus loss, no invented numbers.
export function demoStatusPayload(view: OperationsView | undefined, datasetId: string) {
  const saved = view?.demo;
  if (!saved || saved.datasetId !== datasetId) {
    return { settled: true, status: 'Набор заменили. Откройте страницу заново, чтобы увидеть актуальные данные.', html: '' };
  }
  if (view?.job?.status === 'pending') {
    return { settled: false, status: 'Проверка выполняется. Статус обновится автоматически, страница не перезагрузится.', html: '' };
  }
  if (view?.permission?.enabled && !view?.result) {
    return { settled: false, status: 'Правило включено, проверка начнётся в течение минуты.', html: '' };
  }
  return { settled: true, status: 'Проверка завершена. Результат ниже.', html: demoDecision(view!) };
}
