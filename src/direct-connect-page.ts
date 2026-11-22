import { escapeHtml as e } from './html.ts';
import { connectionBlock, connectionCard, connectionDisconnect, connectionFacts, connectionHelp, connectionHidden as hidden } from './connection-controls.ts';
import type { ConnectionPanel } from './connection-controls.ts';
import type { ConnectView } from './direct-connect.ts';
import type { DirectView } from './direct.ts';
import { connectionHref, connectionReturn, routes } from './routes.ts';
import type { ConnectionOrigin } from './routes.ts';
import { uiIcon } from './ui-icons.ts';

export function renderDirectConnect(view?: ConnectView, direct?: DirectView, campaign?: {id: string; name: string; guided?: boolean; from?: ConnectionOrigin; runId?: string},
  settings = '', error?: { field: string; message: string }, panel?: ConnectionPanel) {
  const backHref = connectionReturn(campaign?.id, campaign?.from, campaign?.guided, campaign?.runId);
  const backLabel = campaign?.from === 'results' ? 'Результаты кампании' : campaign?.from === 'journal' ? 'Журнал кампании'
    : campaign?.from === 'overview' ? 'Рабочий стол' : campaign ? 'К кампании' : 'Все кампании';
  const href = connectionHref(campaign?.id, campaign?.from, campaign?.runId);
  const query = e(href.slice(routes.connection.length));
  const heading = `<a class="campaign-back inline-link" href="${e(backHref)}">${uiIcon('arrow', 16)}${backLabel}</a>
    <div class="page-heading cabinet-heading connection-page-heading"><div><h1>Подключения</h1>${campaign ? `<p class="lead">Кампания «${e(campaign.name)}»</p>` : ''}</div></div>`;
  const layout = (card: string) => `${heading}<div class="connection-settings" data-connections>${card}${settings}</div>`;
  if (!view) {
    const facts: [string, string][] = direct?.account ? [['Номер кабинета', direct.account]] : [];
    const body = connectionBlock('Доступ', direct?.enabled ? '<p>Доступом управляет администратор.</p>'
      : '<p>Попросите администратора сервиса включить подключение Директа.</p>');
    return layout(connectionCard('direct', href, panel, direct?.enabled ? 'Подключён' : 'Недоступен', direct?.enabled ? 'ok' : 'off', facts, body));
  }
  const training = view.mode === 'fixture';
  const context = hidden('returnPanel', 'direct') + (campaign ? hidden('contextCampaign', campaign.id) : '');
  const form = (operation: string, body: string) => `<form method="post" action="/connections/direct/${operation}${query}">${context}${body}</form>`;
  const action = (label: string, style = 'secondary') => form('start', `<button class="${style}" type="submit">${label}</button>`);
  const cancel = form('cancel', '<button class="text-button" type="submit">Отменить подключение</button>');
  const busy = Boolean(view.attempt || view.candidate);
  const connected = view.status === 'connected';
  const facts: [string, string][] = [];
  if (view.account) facts.push(['Номер кабинета', view.account]);
  if (view.login) facts.push(['Логин', view.login]);
  const links = view.account ? `<div class="connection-links">
    <a href="${routes.history}#direct-history">История операций</a>
    ${training ? '' : `<a href="https://id.yandex.ru/personal/data-access" target="_blank" rel="noopener noreferrer">Управлять доступом в Яндекс ID${uiIcon('external', 14)}</a>`}
  </div>` : '';
  const access = view.disconnectProof ? connectionDisconnect('Отключить Директ?',
    'Отчёты и оценка рекламы по всем кампаниям перестанут обновляться. Показы продолжатся.', `/connections/direct/disconnect${query}`,
    context + hidden('generation', view.generation) + hidden('account', view.account ?? '') + hidden('disconnectProof', view.disconnectProof), 'Отключить Директ') : '';
  const codeError = error?.field === 'direct-code';
  const attempt = view.attempt ? connectionBlock(training ? 'Проверка учебного кабинета' : 'Одноразовый код', `
    ${view.attempt.url ? `<div class="connection-links"><a href="${e(view.attempt.url)}" target="_blank" rel="noopener noreferrer">Получить код в Яндексе${uiIcon('external', 14)}</a></div>` : ''}
    ${form('finish', hidden('attemptId', view.attempt.id) + hidden('nonce', view.attempt.nonce) + `<div class="field"><label for="direct-code">${training ? 'Учебный код' : 'Одноразовый код Яндекса'}</label>
      <input id="direct-code" name="code"${codeError ? ' aria-invalid="true" aria-describedby="direct-code-error"' : ''} autocomplete="one-time-code" maxlength="1024"${training && view.attempt.fixtureCode ? ` value="${e(view.attempt.fixtureCode)}"` : ''} required>
      ${codeError ? `<p class="field-error" id="direct-code-error">${e(error.message)}</p>` : ''}</div><button class="primary" type="submit">Проверить мой кабинет</button>`)}${cancel}`,
    connectionHelp('direct-code-tip', 'Как использовать одноразовый код', 'Код действует 10 минут с начала подключения.')) : '';
  const candidate = view.candidate ? connectionBlock('Подтвердите свой кабинет', connectionFacts([['Номер кабинета', view.candidate.account], ['Логин', view.candidate.login]]) +
    form('activate', hidden('candidateId', view.candidate.id) + '<button class="primary" type="submit" name="confirm" value="yes">Подключить этот кабинет</button>') + cancel,
    connectionHelp('direct-owner-tip', 'Что проверил сервис', 'Вы главный представитель кабинета. Валюта — рубль. Есть право создавать кампании.')) : '';
  const needsSetup = !connected && !busy;
  const body = (facts.length ? connectionBlock(connected ? 'Рекламный кабинет' : 'Последний кабинет', connectionFacts(facts) + links) : '') + attempt + candidate +
    (needsSetup && !training ? connectionBlock('Доступ', '<p>Войдите в Яндексе как главный представитель действующего рублёвого кабинета.</p>') : '') +
    (connected || access ? connectionBlock('Управление доступом', `<div class="connection-access">${connected && !busy ? action('Переподключить') : ''}${access}</div>`) : '') +
    (training && view.liveLogin ? connectionBlock('Рабочий кабинет', '<a class="button secondary" href="/auth/yandex">Войти через Яндекс ID</a>') : '');
  const status = connected ? (training ? 'Учебный' : 'Подключён') : view.status === 'expired' ? 'Истёк' : busy ? 'Подключение' : view.status === 'disconnected' ? 'Отключён' : 'Проверьте доступ';
  return layout(connectionCard('direct', href, panel, status, connected ? 'ok' : busy ? 'pending' : 'off', facts, body,
    needsSetup ? action(view.account ? 'Восстановить доступ' : 'Подключить Директ', 'primary') : ''));
}
