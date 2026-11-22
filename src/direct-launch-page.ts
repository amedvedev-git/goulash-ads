import type { DirectLaunchState, DirectLaunchView } from './direct-launch.ts';
import { escapeHtml as e } from './html.ts';
import { connectionHref } from './routes.ts';

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const time = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const labels: Record<string, string> = { moderate: 'Отправка на модерацию', pause: 'Остановка показов', resume: 'Возобновление показов' };

export function renderDirectLaunch(campaignId: string, view: DirectLaunchView) {
  const observation = view.state.observation;
  const status = observation?.campaignState === 'SUSPENDED' ? 'Показы остановлены' :
    observation?.adStatus === 'REJECTED' ? 'Объявление отклонено' :
    observation?.adStatus === 'MODERATION' ? 'Объявление на модерации' :
    observation?.campaignState === 'ON' ? 'Показы разрешены Директом' : 'Проверьте состояние в Директе';
  const cap = view.capKop === undefined ? '' : money.format(view.capKop / 100);
  const form = (action: 'refresh' | 'moderate' | 'pause' | 'resume', label: string, confirmation?: string) =>
    `<form method="post" action="/campaign/lifecycle?ad=${encodeURIComponent(campaignId)}">
      <input type="hidden" name="action" value="${action}"><input type="hidden" name="run" value="${e(view.run)}">
      <input type="hidden" name="revision" value="${view.revision}"><input type="hidden" name="generation" value="${view.generation}">
      ${confirmation ? `<label class="check"><input type="checkbox" name="confirm" value="yes" required>${confirmation}</label>` : ''}
      <button class="secondary" type="submit">${label}</button></form>`;
  return `<section class="form-panel connect-card" aria-labelledby="launch-commands"><h2 id="launch-commands">Модерация и показы</h2>
    <p role="status">${view.state.pending ? `${labels[view.state.pending.action] ?? 'Команда'} · требуется сверка` : status}</p>
    ${cap ? `<p>Согласованный предел · ${e(cap)} с НДС</p>` : ''}
    ${view.state.budget ? `<p>Резерв периода · ${e(money.format(view.state.budget.reservedKop / 100))} с НДС.</p>` : ''}
    ${view.reason ? `<p class="hint">${e(view.reason)}</p>` : ''}
    ${view.needsReadiness ? `<p><a class="inline-link" data-recovery href="${e(connectionHref(campaignId, 'summary'))}">Проверить цель и данные рекламодателя</a></p>` : ''}
    ${form('refresh', 'Проверить состояние в Директе')}
    ${view.canModerate ? form('moderate', 'Отправить объявление на модерацию', `Подтверждаю отправку и лимит ${e(cap)} с НДС. После одобрения Директ может начать показы автоматически.`) : ''}
    ${view.canPause ? form('pause', 'Остановить показы', 'Подтверждаю остановку показов этой кампании.') : ''}
    ${view.canResume ? form('resume', 'Возобновить показы', `Подтверждаю возобновление показов с лимитом ${e(cap)} с НДС.`) : ''}
  </section>`;
}

export function renderDirectLaunchEntry(event: DirectLaunchState['history'][number]) {
  const outcomes: Record<string, string> = { pending: 'Ожидает сверки', unknown: 'Исход требует сверки', rejected: 'Директ отклонил команду',
    not_sent: 'Запрос не был отправлен', confirmed: 'Подтверждено чтением', applied: 'Подтверждено чтением' };
  return `<h3>${labels[event.action] ?? 'Сверка состояния'}</h3><p>${e(outcomes[event.outcome] ?? 'Операция записана')}</p>
    <p class="hint">${e(time.format(new Date(event.at)))} МСК · ${e(event.actor)}</p>`;
}
