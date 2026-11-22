import { escapeHtml as e } from './html.ts';
import { pilotCommand, pilotMoney as rub, pilotStatus } from './pilot.ts';
import type { PilotView } from './pilot.ts';
import { canRestartPublicPilot } from './public-pilot.ts';
import { prepareHref, routes } from './routes.ts';

const hidden = (name: string, value: string | number) => `<input type="hidden" name="${name}" value="${e(String(value))}">`;
const fact = (label: string, value: string) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`;
const stamp = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
}).format(new Date(value)) + ' МСК';
const day = (date: string) => `<time datetime="${e(date)}">${e(date.split('-').reverse().join('.'))}</time>`;

export type PilotPageOptions = {
  confirmRestart?: boolean;
  limitError?: { value: string; message: string };
  reportError?: string;
};

export function renderPilotIntro() {
  return `<a class="campaign-back inline-link" href="${routes.overview}">На рабочий стол</a>
    <div class="page-head"><div><h1>Учебный запуск · Rollstar</h1></div></div>
    <section class="form-panel"><p>Пройдите от готового черновика до остановки показов и итогового отчёта на учебных данных.</p>
    <p>Показы, расходы и тестовый заказ имитируются. Подключение Директа для примера не требуется.</p>
    <form method="post" action="${routes.pilot}">${hidden('action', 'start-demo')}<button class="primary" type="submit">Начать учебный запуск</button></form></section>`;
}

export function renderPilot(view: PilotView, publicDemo = false, { confirmRestart, limitError, reportError }: PilotPageOptions = {}) {
  const { state, target } = view;
  const proof = state.proof, test = state.test, budget = state.budget, report = state.report, latest = report?.latest;
  const settled = budget?.settled === true;
  const overBudget = budget?.overrun || (proof && (budget?.observedSpendKop ?? latest?.spendKop ?? 0) > proof.grossKop);
  const ready = Boolean(proof && test?.hash === proof.hash && !state.issue);
  const pending = state.pending;
  const canStart = budget && ['ready', 'stopped'].includes(state.phase) && ready && !settled && !overBudget;
  const canStop = budget && ['starting', 'running'].includes(state.phase);
  const testLabel = test ? 'Получен · одно достижение цели' : 'Нужен тестовый заказ.';
  const status = pending?.unknown ? 'Исход команды неизвестен' : pending ? 'Ожидается сверка команды' : pilotStatus(state.phase);
  const period = day(target.period.startDate) + ' — ' + day(target.period.endDate);
  const confirmation = (effect: string) => `<label class="check"><input type="checkbox" name="confirm" value="yes" required>${effect}</label>`;
  const limitKop = budget?.limitKop ?? proof?.grossKop;
  const limit = limitError?.value ?? (limitKop === undefined ? '' : String(limitKop / 100));
  const reportNext = pending ? 'Сначала сверьте статус команды.' : {
    draft: ready ? 'Отправьте объявление на модерацию.' : proof && !test && !state.issue ? 'Проведите тестовый заказ.' : 'Проверьте готовность к запуску.',
    reviewing: 'Сверьте статус модерации.',
    rejected: 'Обновите отчёт, чтобы подтвердить расход и закрыть резерв.',
    ready: canStart ? 'Включите показы или откажитесь от запуска, затем обновите отчёт.' : 'Сверьте статус или откажитесь от запуска.',
    starting: 'Сверьте статус включения показов, затем обновите отчёт.',
    running: 'Обновите отчёт, чтобы увидеть расход и заказы.',
    stopping: 'Сверьте статус остановки показов, затем обновите отчёт.',
    stopped: 'Обновите отчёт, чтобы подтвердить итоговый расход.',
  }[state.phase];
  const staleNext = pending ? reportNext : 'Повторите обновление позже.';
  const reportStatus = !report ? `Отчёт ещё не запрашивали. ${reportNext}`
    : report.status === 'waiting' ? `Отчёт пока не готов. ${reportNext}`
    : report.status === 'stale' ? latest
      ? `Отчёт устарел. Показаны последние подтверждённые данные. ${staleNext}`
      : `Отчёты ещё не готовы или не совпали. ${staleNext}`
    : settled ? 'Итоговый отчёт. Расход подтверждён, резерв освобождён.' : 'Отчёт за текущий запуск.';
  const form = (action: string, label: string, content = '', primary = false) => `<form method="post" action="${routes.pilot}" class="draft-command">
    ${hidden('campaignId', view.id)}${hidden('revision', view.revision)}${hidden('generation', view.generation)}${hidden('run', target.run)}
    ${hidden('action', action)}${content}<button class="${primary ? 'primary' : 'secondary'}" type="submit">${label}</button></form>`;

  return `<a class="campaign-back inline-link" href="${publicDemo ? routes.overview : prepareHref(view.id)}">${publicDemo ? 'На рабочий стол' : 'К сводке кампании'}</a>
    <div class="page-head"><div><h1>Учебный запуск · ${e(view.name)}</h1><p class="lead">Имитация Директа, Метрики и заказов Rollstar. Реальных показов и списаний нет.</p></div></div>
    ${publicDemo && canRestartPublicPilot(view) ? confirmRestart
      ? `<section class="form-panel pilot-restart" aria-labelledby="pilot-restart-title">
          <h2 id="pilot-restart-title" tabindex="-1" data-page-focus>Заменить предыдущий учебный запуск?</h2>
          <p>В аккаунте хранится один учебный запуск. Новый запуск удалит результаты, журнал и данные об учебном бюджете предыдущего запуска. Восстановить их нельзя.</p>
          ${budget?.finalSpendKop !== undefined ? `<p>Итоговый расход предыдущего запуска — ${rub(budget.finalSpendKop)}.</p>` : ''}
          <form method="post" action="${routes.pilot}">
            ${hidden('action', 'restart-demo')}${hidden('revision', view.revision)}${hidden('run', target.run)}
            ${confirmation('Подтверждаю замену предыдущего учебного запуска.')}
            <div class="actions"><a class="button secondary" href="${routes.pilot}">Отмена</a><button class="primary" type="submit">Заменить и начать новый запуск</button></div>
          </form>
        </section>`
      : `<a class="button secondary pilot-restart" href="${routes.pilot}?restart=confirm">Начать новый учебный запуск</a>` : ''}
    <div class="flow-layout preparation-layout" id="pilot-flow">
      <section class="form-panel draft-readiness" aria-label="Ход запуска">
        <div class="draft-status" role="status"><h2>${status}</h2>
        ${pending ? `<p>${pilotCommand(pending.command)}. Сверьте ответ площадки. До сверки повторная отправка заблокирована.</p>` : ''}
        ${state.moderationReason ? `<p>${e(state.moderationReason)}</p>` : ''}
        ${state.phase === 'rejected' ? '<p>Уточните объявление и подготовьте новый черновик. Для закрытия резерва обновите отчёт.</p>' : ''}
        ${state.checkedAt ? `<p class="muted">Последняя сверка ${stamp(state.checkedAt)}</p>` : ''}</div>
        ${state.issue ? `<p class="field-error" role="alert">${e(state.issue)}</p>` : ''}
        ${overBudget && !state.issue ? '<p class="field-error">Расход по последнему отчёту выше подтверждённого лимита стратегии.</p>' : ''}
        <section class="draft-check"><h3>Готовность к отправке</h3>
          <dl class="preview-meta draft-meta">
            ${fact('Учебный кабинет Директа', publicDemo ? 'Rollstar · имитация' : target.account)}
            ${fact('Рекламодатель и маркировка', proof && !state.issue ? proof.advertiser + ' · подтверждено имитацией' : 'Требуется сверка')}
            ${fact('Цель Метрики', proof && !state.issue ? 'Заказ оформлен · Rollstar' : 'Требуется сверка')}
            ${fact('Тестовый заказ', testLabel)}
          </dl>
          ${state.phase === 'draft' && !pending ? form('check', 'Проверить готовность', '', !proof) : ''}
          ${state.phase === 'draft' && proof && !test && !budget && !state.issue && !pending ? form('test-order', 'Провести тестовый заказ', '', true) : ''}
        </section>
        <div class="actions draft-actions">
          ${state.phase === 'draft' && ready && !pending && !settled ? form('moderate', 'Отправить на модерацию',
            `<p class="small">Резерв действует с момента отправки на модерацию. После одобрения платформа может разрешить показы.</p>
            <div class="field"><label for="pilot-limit">Лимит с НДС, ₽</label><input id="pilot-limit" name="limitRub" type="text" inputmode="decimal" value="${e(limit)}"
              aria-describedby="pilot-limit-help"${limitError ? ' aria-invalid="true" autofocus data-page-focus' : ''} required>
              <p id="pilot-limit-help" class="${limitError ? 'field-error' : 'hint'}">${limitError ? e(limitError.message) : `Минимум — ${rub(proof!.grossKop)} с НДС.`}</p></div>
            ${confirmation('Отправить объявление и зарезервировать учебный лимит.')}`, true) : ''}
          ${pending || state.phase !== 'draft' ? form('refresh', 'Сверить статус', '', Boolean(pending)) : ''}
          ${!pending && canStart ? form('start', 'Включить показы', confirmation('Включить учебные показы с подтверждённым лимитом.'), true) : ''}
          ${(!pending && canStop) || pending?.command === 'start' ? form('stop', 'Остановить показы', confirmation('Остановить учебные показы и дождаться итогового расхода.'), !pending) : ''}
          ${!pending && state.phase === 'ready' && !settled ? form('stop', 'Отказаться от запуска', confirmation('Отменить запуск и сверить учебный резерв.')) : ''}
        </div>
      </section>
      <aside class="preparation-aside" aria-label="Бюджет и измерение">
        <section class="preparation-guide"><h2>Бюджет и период</h2><dl class="preview-meta draft-meta">
          <div><dt>Период по Москве</dt><dd>${period}</dd></div>
          ${fact('Лимит стратегии без НДС', rub(Number(target.period.amountRub) * 100))}
          ${fact('Лимит стратегии с НДС', proof ? rub(proof.grossKop) + ' · НДС ' + proof.vat + '%' : 'Требуется сверка')}
          ${budget ? fact('Подтверждённый лимит с НДС', rub(budget.limitKop)) + fact('Резерв', rub(budget.reservedKop) + (settled ? ' · итоговый расход подтверждён' : ' · до итоговой сверки')) : ''}
          ${budget?.finalSpendKop !== undefined ? fact('Итоговый расход Директа', rub(budget.finalSpendKop)) : ''}
        </dl><p class="small">Поиск Яндекса, фиксированные даты и отсутствие автопродления.</p></section>
        <section class="preparation-guide" id="pilot-results" aria-labelledby="pilot-results-title">
          <h2 id="pilot-results-title" tabindex="-1" aria-describedby="${reportError ? 'pilot-report-error ' : ''}pilot-report-status"${reportError ? ' data-page-focus' : ''}>Результаты</h2>
          ${reportError ? `<p id="pilot-report-error" class="field-error">${e(reportError)}</p>` : ''}
          <p id="pilot-report-status" class="muted">${reportStatus}</p>
          ${latest ? `<p class="muted">Сверено ${stamp(latest.at)}. ${period}, МСК.</p>` : ''}
          <dl class="preview-meta draft-meta">
            ${fact('Расход с НДС', latest ? rub(latest.spendKop) : '—')}
            ${fact('Показы', String(latest?.impressions ?? '—'))}
            ${fact('Клики', String(latest?.clicks ?? '—'))}
            ${fact('Заказы по учебной цели', String(latest?.orders ?? '—'))}
            ${fact('Стоимость заказа', latest?.orders ? rub(Math.round(latest.spendKop / latest.orders)) : '—')}
            ${fact('Подтверждённые клиенты', String(latest?.customers?.confirmed ?? '—'))}
            ${fact('Новые клиенты', String(latest?.customers?.first ?? '—'))}
            ${fact('Стоимость нового клиента', latest?.customers?.first ? rub(Math.round(latest.spendKop / latest.customers.first)) : '—')}
          </dl>
          ${latest?.customers ? `<p class="small">Источник клиентов: ${e(latest.customers.name)}.</p>` : '<p class="small">Для клиентов нужен отдельный отчёт по заказам.</p>'}
          ${budget && !pending ? form('reports', 'Обновить отчёт') : ''}
          <details><summary>Источники</summary><p class="small">В учебном примере расход и показы имитируют отчёт Директа, заказы имитируют цель save_order. Цель для реального пилота согласуется отдельно.</p></details>
        </section>
      </aside>
    </div>
    ${state.history.length ? `<section class="form-panel" id="pilot-history"><h2>Журнал учебного запуска</h2><ul>
      ${state.history.slice().reverse().map(row => `<li>${e(row.text)} <span class="muted">${stamp(row.at)} · ${e(row.actor)}</span></li>`).join('')}
    </ul></section>` : ''}`;
}
