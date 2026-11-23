import { escapeHtml as e } from './html.ts';
import { connectionBlock, connectionCard, connectionDisconnect, connectionHelp, connectionHidden as hidden, connectionPanelHref } from './connection-controls.ts';
import type { ConnectionPanel } from './connection-controls.ts';
import type { MetrikaCounter, MetrikaCounterChoice } from './metrika-api.ts';
import { connectionHref, routes } from './routes.ts';
import type { ConnectionOrigin } from './routes.ts';
import { uiIcon } from './ui-icons.ts';

type Access = {
  status: 'disconnected' | 'connected' | 'expired' | 'configuration_changed';
  revision: number;
  attempt?: { state: string; url: string };
  disconnectProof?: string;
};

export type ConnectionSettings = {
  revision: number;
  campaignId?: string;
  contextId?: string;
  from?: ConnectionOrigin;
  runId?: string;
  panel?: ConnectionPanel;
  training?: boolean;
  error?: { field: string; message: string };
  campaigns: { id: string; title: string }[];
  metrika: { configured: boolean; enabled?: boolean; disconnected?: boolean; legacy?: boolean; canList?: boolean; canTest?: boolean; current?: boolean; counter?: MetrikaCounter; goalId?: string; verified?: boolean; verifiedAt?: number; testUrl?: string };
  metrikaAccess?: Access;
  legacyDisconnect?: { proof?: string };
  counterInput?: string;
  counterPreview?: MetrikaCounter;
  counters?: MetrikaCounterChoice[];
  directConnected?: boolean;
  advertiser?: { account: string; generation: number; name?: string; checkedAt?: string };
  advertiserLookup?: string | null;
};

function checkedAt(value: number | string) {
  const date = new Date(value);
  return `<time datetime="${e(date.toISOString())}">${e(date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} МСК</time>`;
}

export function renderConnectionSettings(view: ConnectionSettings, metrikaNotice = '') {
  const { campaignId, campaigns, metrika, metrikaAccess: access, counters, advertiser } = view;
  const href = connectionHref(view.contextId ?? campaignId, view.from, view.runId);
  const query = e(href.slice(routes.connection.length));
  const invalid = (id: string) => view.error?.field === id ? ` aria-invalid="true" aria-describedby="${id}-error"` : '';
  const fieldError = (id: string) => view.error?.field === id ? `<p class="field-error" id="${id}-error">${e(view.error.message)}</p>` : '';
  const version = hidden('revision', view.revision);
  const action = (operation: string) => `/connections/metrika/${operation}${query}`;
  const form = (operation: string, body: string, label: string, style = 'secondary') =>
    `<form method="post" action="${action(operation)}">${version}${hidden('returnPanel', 'metrika')}${body}<button class="${style}" type="submit">${label}</button></form>`;
  const select = (id: string, label: string, body: string, attrs = '', wrap = false) => `<div class="field"><label for="${id}">${label}</label>
    <div class="connection-select"><select id="${id}"${invalid(id)} ${attrs}>${body}</select>${wrap ? '<span class="connection-select-value" aria-hidden="true" hidden></span>' : ''}</div>${fieldError(id)}</div>`;

  const scopes = [['', 'Общие отчёты'], ...campaigns.map(campaign => [campaign.id, campaign.title])];
  const scopeHref = (id: string) => e(connectionPanelHref(connectionHref(id || undefined, view.from), 'metrika'));
  const picker = !view.runId && campaigns.length ? `<div hidden data-metrika-enhanced>${select('connection-campaign', 'Для каких отчётов', scopes.map(([id, title]) =>
    `<option value="${scopeHref(id)}"${(campaignId ?? '') === id ? ' selected' : ''}>${e(title)}</option>`).join(''), 'data-connection-scope')}</div>
    <details class="connection-manual" data-metrika-native><summary>Для каких отчётов</summary>
      <div class="connection-links">${scopes.map(([id, title]) => `<a href="${scopeHref(id)}"${(campaignId ?? '') === id ? ' aria-current="page"' : ''}>${e(title)}</a>`).join('')}</div>
    </details>` : '';
  const accessPanel = access?.attempt ? connectionBlock('Одноразовый код', `
    <p>Разрешите чтение отчётов в Яндексе и вставьте сюда полученный код.</p>
    <div class="connection-links"><a href="${e(access.attempt.url)}" target="_blank" rel="noopener noreferrer">Получить код в Яндексе${uiIcon('external', 14)}</a></div>
    ${form('finish', hidden('state', access.attempt.state) + `<div class="field"><label for="metrika-code">Одноразовый код Яндекса</label><input id="metrika-code"${invalid('metrika-code')} name="code" maxlength="1024" autocomplete="one-time-code" required>${fieldError('metrika-code')}</div>`, 'Подключить Метрику', 'primary')}
    ${form('cancel', hidden('state', access.attempt.state), 'Отменить подключение', 'text-button')}`) : '';
  const unavailable = !metrika.configured && !access?.attempt ? connectionBlock('Доступ', !access
    ? '<p>Попросите администратора сервиса включить чтение Метрики для вашей учётной записи.</p>'
    : access.status === 'disconnected' ? '<p>Нажмите «Подключить Метрику», получите одноразовый код в Яндексе и введите его здесь.</p>'
      : '<p>Подключите доступ заново, чтобы вернуть чтение отчётов.</p>',
  access?.status === 'disconnected' ? connectionHelp('metrika-start-tip', 'Как получить доступ к счётчику', 'Если счётчик чужой, попросите владельца дать вам доступ на чтение в Метрике.') : '') : '';
  const connect = !metrika.configured && access && !access.attempt
    ? form('start', '', access.status === 'disconnected' ? 'Подключить Метрику' : 'Восстановить доступ к Метрике', 'primary') : '';

  const saved = metrika.current ? metrika.counter : undefined;
  const goalName = saved?.goals.find(goal => goal.id === metrika.goalId)?.name;
  const selection = view.counterPreview ?? saved;
  const selectedId = view.counterInput ?? selection?.id ?? '';
  const goalId = saved && !view.counterPreview ? metrika.goalId : undefined;
  const options = new Map((counters ?? []).map(counter => [counter.id, counter.name ? `${counter.name} · ${counter.id}` : `${counter.domain} · ${counter.id}`]));
  if (selection && !options.has(selection.id)) options.set(selection.id, `${selection.name || selection.domain} · ${selection.id}`);
  if (selectedId && !options.has(selectedId)) options.set(selectedId, selectedId);
  const counterSelect = select('metrika-counter', 'Счётчик', `<option value="">Выберите счётчик</option>${[...options].map(([id, label]) =>
    `<option value="${e(id)}"${id === selectedId ? ' selected' : ''}>${e(label)}</option>`).join('')}`, 'name="counterId" required');
  const goalSelect = select('metrika-goal', 'Цель', `<option value="">Выберите цель</option>${selection?.id === selectedId ? selection.goals.map(goal =>
    `<option value="${e(goal.id)}"${goal.id === goalId ? ' selected' : ''}>${e(goal.name)}</option>`).join('') : ''}`, 'name="goalId" required', true);
  const canChoose = metrika.configured && Boolean(campaignId || metrika.legacy);
  const goalStep = metrika.enabled ? 'Выберите цель и нажмите «Сохранить настройки».' : 'Выберите цель и нажмите «Включить чтение».';
  const nextStep = selection ? (selection.goals.length ? goalStep : '')
    : counters?.length ? 'Выберите счётчик и нажмите «Загрузить цели».'
      : counters ? 'У этого аккаунта нет доступных счётчиков.'
        : metrika.canList ? 'Нажмите «Показать счётчики».' : 'Укажите номер счётчика.';
  const setup = !goalName ? `<p>${metrika.enabled ? 'Выберите счётчик и цель для отчётов.' : 'Выберите счётчик и цель, чтобы включить чтение.'}</p>
    ${nextStep ? `<p data-metrika-native>${nextStep}</p>` : ''}` : '';
  const measurement = canChoose ? connectionBlock('Счётчик и цель', `${setup}${picker}
    ${metrika.canList ? `<div data-metrika-native>${form('list', '', 'Показать счётчики')}</div>` : ''}
    <form id="connection-metrika-form" method="post" action="${action('configure')}" data-metrika-pair${metrika.canList ? ' data-counter-list' : ''}${metrika.enabled ? ' data-reading' : ''}>${version}${hidden('returnPanel', 'metrika')}
      <div class="connection-field-grid">${counterSelect}${goalSelect}</div>
      <p class="connection-feedback" role="status" data-measurement-feedback>${metrika.enabled ? '<span hidden data-metrika-enhanced>Настройки сохраняются автоматически.</span>' : ''}</p>
      <div class="connection-links" data-metrika-native><button class="secondary" type="submit" formaction="${action('inspect')}" formnovalidate>Загрузить цели</button>
      ${metrika.enabled ? '<button class="primary" type="submit">Сохранить настройки</button>' : ''}</div>
      ${metrika.enabled ? ''
    : '<button class="primary" type="submit" name="enable" value="read" data-enable-metrika>Включить чтение</button>'}</form>
    <details class="connection-manual"><summary>Указать номер счётчика</summary>
      <form method="post" action="${action('inspect')}" data-inspect-counter>${version}${hidden('returnPanel', 'metrika')}
        <div class="field"><label for="metrika-counter-manual">Номер счётчика</label><input id="metrika-counter-manual" name="counterId" inputmode="numeric" pattern="[1-9][0-9]{0,18}" maxlength="19" value="${e(view.counterInput ?? '')}" required></div>
        <button class="secondary" type="submit">Проверить счётчик</button></form></details>
    ${selection && !selection.goals.length ? '<p>У счётчика пока нет доступных целей. Добавьте цель в Яндекс Метрике.</p>' : ''}`,
    connectionHelp('metrika-settings-tip', 'Как используются настройки отчёта', 'В общих отчётах сервис использует выбранный счётчик и цель. Для отдельной кампании можно задать свои настройки. Если счётчик чужой, попросите владельца дать доступ на чтение в Метрике.')) : '';
  const verification = metrika.verified && metrika.verifiedAt ? connectionBlock('Тестовая заявка', `<p>Тестовая заявка подтверждена. Проверено ${checkedAt(metrika.verifiedAt)}</p>`)
    : campaignId && metrika.current && metrika.goalId ? connectionBlock('Тестовая заявка', `${!metrika.canTest ? '<p>Проверка тестовой заявки для этого подключения недоступна.</p>' : ''}
      ${metrika.testUrl ? `<div class="connection-links"><a href="${e(metrika.testUrl)}" target="_blank" rel="noopener noreferrer">Открыть ссылку для теста${uiIcon('external', 14)}</a></div>${form('verify', '', 'Проверить тестовую заявку', 'primary')}` : ''}
      ${metrika.canTest ? form('test', '', metrika.testUrl ? 'Выдать новую тестовую ссылку' : 'Получить тестовую ссылку', metrika.testUrl ? 'text-button' : 'secondary') : ''}`,
    metrika.testUrl ? connectionHelp('metrika-test-tip', 'Как проверить тестовую заявку', 'Откройте тестовую ссылку в приватном окне. Отправьте одну заявку и после появления события в Метрике нажмите «Проверить тестовую заявку».') : '') : '';
  const disconnect = access?.disconnectProof ? { proof: access.disconnectProof } : view.legacyDisconnect;
  const replace = access && metrika.configured && !access.attempt;
  const accessManagement = disconnect || replace ? connectionBlock('Доступ', `<div class="connection-access">${replace ? form('start', '', 'Переподключить') : ''}
    ${disconnect ? connectionDisconnect('Отключить Метрику?', 'Отчёты Метрики по всем кампаниям перестанут обновляться. Сохранённые отчёты останутся доступны.', action('disconnect'),
    version + hidden('returnPanel', 'metrika') + (disconnect.proof ? hidden('disconnectProof', disconnect.proof) : ''), 'Отключить Метрику', connectionPanelHref(href, 'metrika')) : ''}</div>`) : '';
  const metrikaFacts: [string, string][] = saved ? [['Счётчик', saved.name || `${saved.domain} · ${saved.id}`], ['Цель', goalName || 'Требуется выбор']] : [];
  const metrikaActive = metrika.enabled && metrika.configured;
  const metrikaStatus = metrikaActive ? (goalName ? 'Включена' : 'Доступ получен')
    : metrika.disconnected || metrika.configured ? 'Отключена' : access?.status === 'expired' ? 'Доступ истёк' : 'Нужен доступ';
  const metrikaBody = metrikaNotice + unavailable + accessPanel + measurement + verification + accessManagement;

  const directLink = `<a href="https://direct.yandex.ru/" target="_blank" rel="noopener noreferrer">Открыть кабинет Директа${uiIcon('external', 14)}</a>`;
  const advertiserForm = (body: string, label: string, attributes: string, style = 'primary') => advertiser ?
    `<form method="post" action="/connections/advertiser${query}"${attributes}>${version}${hidden('returnPanel', 'advertiser')}${hidden('account', advertiser.account)}${hidden('generation', advertiser.generation)}${body}<button class="${style}" type="submit">${label}</button></form>` : '';
  const lookup = view.advertiserLookup;
  const manual = lookup === null || view.error?.field === 'advertiser-name';
  const availableName = lookup ?? advertiser?.name;
  const review = advertiser ? connectionBlock(manual ? 'Ручная сверка' : 'По данным Директа', `
    ${manual ? `<p>${lookup === null ? 'Директ не передал сведения для автоматической сверки.' : 'Сверьте название рекламодателя в Директе.'}</p>
    ${advertiserForm(`<div class="field"><label for="advertiser-name">Название рекламодателя</label><input id="advertiser-name"${invalid('advertiser-name')} name="name" maxlength="200" value="${e(advertiser.name ?? '')}" required>${fieldError('advertiser-name')}</div>${hidden('confirm', 'yes')}`, 'Подтвердить сверку', '')}`
    : availableName ? `<dl class="connection-facts"><div><dt>Организация</dt><dd><strong>${e(availableName)}</strong></dd></div></dl>`
      : '<p data-advertiser-status>Название и сведения для маркировки загружаются из Директа.</p>'}
    ${advertiser.name && advertiser.checkedAt ? `<p class="hint">Проверено владельцем ${checkedAt(advertiser.checkedAt)}</p>` : ''}`,
  connectionHelp('advertiser-help', manual ? 'Где сверить название рекламодателя' : 'Зачем подтверждать рекламодателя',
    manual ? 'В меню аккаунта Директа откройте «Данные рекламодателя» и сверьте название. Если анкета не заполнена, её можно заполнить там.'
      : 'Перед платным запуском подтвердите, что организация в Директе соответствует бизнесу, который вы рекламируете. Если сведения изменились, обновите их в кабинете Директа.'))
    : connectionBlock('Сведения для маркировки', view.directConnected ? '<p>Сверка недоступна в этом режиме.</p>'
      : `<p>Сначала <a href="${e(connectionPanelHref(href, 'direct'))}" data-open-connection="direct">подключите Яндекс Директ</a>.</p>`);
  const confirmAdvertiser = typeof lookup === 'string' && lookup !== advertiser?.name ?
    advertiserForm(hidden('source', 'direct') + hidden('name', lookup) + hidden('confirm', 'yes'), 'Подтвердить рекламодателя', '') : '';
  const checkAdvertiser = advertiser && lookup === undefined && !manual ? advertiserForm(hidden('operation', 'lookup'), advertiser.name ? 'Обновить данные из Директа' : 'Получить данные из Директа',
    !advertiser.name && view.error?.field !== 'advertiser-lookup' ? ' data-advertiser-lookup' : '', advertiser.name ? 'secondary' : 'primary') : '';
  const advertiserFacts: [string, string][] = advertiser ? [['Организация', availableName || 'Загрузится при открытии'], ['Источник', 'Яндекс Директ']] : [];
  const advertiserStatus = advertiser?.name && (typeof lookup !== 'string' || lookup === advertiser.name) ? 'Подтверждён' : advertiser ? 'К сверке' : 'Нет доступа';
  return connectionCard('metrika', href, view.panel, metrikaStatus, metrikaActive ? (goalName ? 'ok' : 'pending') : 'off', metrikaFacts, metrikaBody, connect) +
    connectionCard('advertiser', href, view.panel, advertiserStatus, advertiserStatus === 'Подтверждён' ? 'ok' : advertiser ? 'pending' : 'off', advertiserFacts, review,
    advertiser ? confirmAdvertiser + checkAdvertiser + (view.training ? '' : directLink) : '');
}
