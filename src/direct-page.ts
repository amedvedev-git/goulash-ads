import { escapeHtml as e } from './operations-page.ts';
import { confirmedOffDraft, stepNames } from './direct.ts';
import { renderPhrasePreparation } from './search-phrases-page.ts';
import type { DirectEvent, DirectState, DirectView } from './direct.ts';
import type { CampaignView } from './campaign.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { uiIcon } from './ui-icons.ts';
import { campaignConnectionHref, campaignEditorHref, campaignReference, directResultsHref, directShowing, readableDirectName } from './campaign-catalog.ts';
import type { CampaignCatalogItem } from './campaign-catalog.ts';
import { defaultCampaignId } from './campaign-workspaces.ts';
import { campaignTabHref } from './routes.ts';
const hidden = (key: string, value: string | number) => `<input type="hidden" name="${key}" value="${e(String(value))}">`;
const confirm = (text: string) => `<label class="check"><input type="checkbox" name="confirm" value="yes" required>${text}</label>`;
const time = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК';
// Direct keeps a `[<id>]` marker in campaign names for post-crash matching; it is not for owners.
const displayName = (value: string) => value.replace(/\s*\[[\w-]{1,64}\]$/, '');
export const directEventPhases = { ready: 'Подготовлено', pending: 'Результат неизвестен · нужна сверка', confirmed: 'Подтверждено API', conflict: 'Конфликт · запись не выполнена', rejected: 'Запрос отклонён · запись не подтверждена' };
function directForm(view: DirectView, state: NonNullable<DirectView['state']>, action: string, content: string) {
  return `<form method="post" action="/direct/${action}">${hidden('planId', state.planId)}${hidden('campaignId', state.campaignId ?? defaultCampaignId)}${view.ownChief ? hidden('storageRevision', state.storageRevision ?? 0) : ''}${content}</form>`;
}

export function renderDirectRefresh(view: DirectView, state: DirectState) {
  return directForm(view, state, 'refresh', '<button class="secondary" type="submit">Сверить состояние Директа</button><p class="hint">Только чтение. Неизвестная запись не отправляется повторно.</p>');
}

export function renderDirectRename(view: DirectView, state: NonNullable<DirectView['state']>) {
  const name = state.snapshot?.campaign?.Name;
  if (!view.enabled || (view.account && view.account !== state.account) || view.needsReconcile || view.blockedCampaignId ||
    state.pilot || hasUnresolvedDirect(state) || !state.complete || !name) return '';
  return `<h3>Изменить название</h3>${directForm(view, state, 'rename', hidden('before', name) +
    `<div class="field"><label for="direct-rename">Новое название кампании</label><input id="direct-rename" name="name" maxlength="255" required value="${e(view.input?.action === 'rename' ? view.input.name : readableDirectName(name, state.planId))}"></div>` +
    confirm('Сохранить новое название кампании в Директе.') + '<button class="secondary" type="submit">Изменить название в Директе</button>')}`;
}

export function renderDirectNumber(label: string, id: string, value: string) {
  return `<div class="direct-reference"><span>${label}</span><code id="${id}">${e(value)}</code>
    <button class="text-button" type="button" data-copy-target="${id}" aria-label="Скопировать ${label.toLocaleLowerCase('ru')}" hidden>Скопировать</button>
    <span class="hint" role="status" data-copy-status></span></div>`;
}

export function directEventTitle(event: DirectEvent) {
  return event.kind === 'create' ? 'Создание полного черновика' : event.kind === 'undo' ? 'Отмена изменения названия' : 'Изменение названия';
}

export function renderDirectReceipt(view: DirectView, s: DirectState, event: DirectEvent, journalFields = '') {
  const canWrite = view.enabled && (!view.account || s.account === view.account) && !view.needsReconcile && !view.blockedCampaignId;
  return `<p><strong>${directEventPhases[event.phase] ?? 'Исход не подтверждён · требуется сверка'}</strong> · ${e(time(event.at))}</p><dl class="preview-meta"><div><dt>До</dt><dd>${e(displayName(event.before))}</dd></div><div><dt>После</dt><dd>${e(displayName(event.after))}</dd></div></dl><details class="support"><summary>Номер операции</summary><p class="hint">Операция ${e(event.id)}${event.related ? ` · <a href="#direct-event-${e(event.related)}">Исходная операция</a> ${e(event.related)}` : ''}${event.undoneBy ? ` · <a href="#direct-event-${e(event.undoneBy)}">Запись об отмене</a> ${e(event.undoneBy)}` : ''} · ${e(event.actor)}</p></details>${event.error ? event.phase === 'confirmed' && !s.error ? `<details><summary>Предыдущая ошибка · результат подтверждён</summary><p>${e(event.error)}</p></details>` : `<p class="field-error">${e(event.error)}</p>` : ''}${canWrite && !s.pilot && (!s.guidedDraft || confirmedOffDraft(s)) && !hasUnresolvedDirect(s) && event.kind === 'rename' && event.phase === 'confirmed' && !event.undoneBy ? `<details><summary>Проверить и отменить изменение</summary><p>Название вернётся с «${e(event.after)}» на «${e(event.before)}». Перед записью сервис проверит текущее название и историю. Внешняя правка остановит отмену.</p>${directForm(view, s, 'undo', hidden('id', event.id) + journalFields + confirm('Подтверждаю возврат названия через API.') + '<button class="secondary" type="submit">Отменить изменение в Директе</button>')}</details>` : ''}`;
}

export function renderDirect(view: DirectView | undefined, campaign: CampaignView, history = false, prepared = false, currentPlanId?: string, historyEntry = false, catalog?: CampaignCatalogItem[], scoped = false) {
  if (!view) return '';
  if (!view.enabled && !view.state && !history) return '';
  if (history && view.runs?.length) return `<section id="direct-history"><h2>${scoped ? 'Операции в Директе' : 'Директ — сохранённые кампании'}</h2>${[...view.runs].reverse().map(run => renderDirect({...view,state:run,runs:undefined},campaign,true,false,undefined,true,catalog,scoped)).join('')}</section>`;
  const s = view.state;
  const canRead = view.enabled && (!view.account || !s || view.account === s.account);
  const canWrite = canRead && !view.needsReconcile && !view.blockedCampaignId;
  const historyId=historyEntry?`direct-history-${s!.planId}`:'direct-history';
  const form = (action: string, content: string) => directForm(view, s!, action, content);
  const refresh = () => renderDirectRefresh(view, s!);
  const mode = view.mode === 'fixture' ? 'Подставной API · отдельная проверочная база' : view.ownChief ? 'Настоящий API · собственный кабинет' : 'Настоящий API · локальный тестовый кабинет';
  const item = s && catalog?.find(entry => entry.id === (s.campaignId ?? defaultCampaignId));
  const editor = s && campaignEditorHref(s.campaignId ?? defaultCampaignId);
  if (history) return `<section class="direct-panel" aria-labelledby="${historyId}"><h2 id="${historyId}">${item ? e(item.title) : 'Директ — история операций'}</h2>${item ? `<p><a href="${editor}#direct">Открыть кампанию Goulash</a>${s?.steps.campaign.phase === 'confirmed' ? ` · <a href="${scoped ? e(campaignTabHref(s.campaignId!, 'results')) : directResultsHref(s.planId)}">Результаты</a>` : ''}</p>` : ''}<p class="source-note">${mode}</p>${!s ? '<p>Операций ещё нет.</p>' : `<p>Создание объектов не отменяется: оно остаётся в истории отдельной записью.</p><details class="support-details"><summary>Номера и кабинет</summary><p>Кабинет <code>${e(s.account)}</code> · кампания <code>${e(s.steps.campaign.id ?? 'ещё не подтверждена')}</code> · группа <code>${e(s.steps.group.id ?? 'не подтверждена')}</code> · объявление <code>${e(s.steps.ad.id ?? 'не подтверждено')}</code> · версия плана <code>${e(s.campaignPlanId ?? 'прежний набор')}</code>${item ? ` · ${e(campaignReference(item.id))}` : ''}.</p></details>${[...s.events].reverse().map(event => `<article id="direct-event-${e(event.id)}" class="direct-event"><h3>${directEventTitle(event)}</h3>${renderDirectReceipt(view, s, event)}</article>`).join('')}`}</section>`;
  const started = s && Object.values(s.steps).some(entry => entry.phase !== 'ready');
  const blocker = view.blockedCampaignId
    ? `<p class="hint">Перед записью в Директ <a href="${campaignEditorHref(view.blockedCampaignId)}#direct">сверьте другую кампанию</a>.</p>`
    : '';
  if (prepared && !started && (!s || s.campaignPlanId !== currentPlanId)) {
    if (blocker) return `<section class="direct-panel" id="direct"><h2>Нужна сверка Директа</h2>${blocker}</section>`;
    return view.needsReconcile ? '<section class="direct-panel" id="direct"><h2>Проверьте подключение Директа</h2><p>Прежде чем создавать черновик, восстановите доступ к кабинету и проверьте историю операций.</p><a href="/connections/direct">Управление подключением</a></section>' : '';
  }
  const phrases = s?.keywordEntries?.map(k => k.phrase) ?? (s ? [s.keyword] : []);
  const status = s?.complete ? hasUnresolvedDirect(s) ? 'Набор создан · незавершённая операция требует сверки'
    : s.error ? 'Черновик создан · проверьте ошибку последней операции' : 'Создана в Директе · последнее чтение: ' + directShowing({checkedAt:s.checkedAt,state:s.snapshot?.campaign?.State}).replace(/^./u, letter => letter.toLowerCase())
    : started ? 'Создание начато · проверьте результат' : 'Перед созданием проверьте условия';
  return `<section class="direct-panel" id="direct" aria-labelledby="direct-heading"><h2 id="direct-heading">Черновик в Директе</h2>${view.mode === 'fixture' || !view.ownChief ? `<p class="source-note">${mode}</p>` : ''}
    <p>Создание сохраняет одно объявление на поиске без модерации и с выключенными показами.</p>
    ${blocker}
    ${!started && !prepared ? renderPhrasePreparation(view, campaign) : ''}
    ${s ? `<div class="comparison"><h3>${status}</h3>
      ${hasUnresolvedDirect(s)?'<p class="hint">Есть незавершённая операция. Сначала сверить состояние Директа; новый набор и смена кабинета пока недоступны.</p>':''}${s.error ? `<p class="field-error">${e(s.error)}</p>` : ''}
      <dl class="preview-meta preparation-facts"><div><dt>Название кампании</dt><dd>${e(displayName(s.name))}</dd></div><div><dt>Город или регион</dt><dd>${e(s.regionName)}</dd></div><div><dt>${s.budget ? 'Лимит на период' : 'Недельный бюджет Директа'}</dt><dd><strong>${e(s.budget?.amountRub ?? s.weekly)} ₽</strong></dd></div><div><dt>${s.budget ? 'Период (МСК)' : 'Дата начала (МСК)'}</dt><dd>${e(s.startDate)}${s.budget ? ` — ${e(s.budget.endDate)} · без продления` : ''}</dd></div></dl>
      <p class="preparation-note">${uiIcon('budget', 18)}<span>${s.budget ? 'Эта сумма передаётся как бюджет стратегии Директа. Фактические расходы зависят от показов.' : `Лимит плана ${e(s.draft.budget)} ₽ за ${e(s.draft.period)} дней остаётся в Goulash. В Директ передаётся недельный бюджет.`}</span></p>
      <div class="ad-preview"><p class="ad-title">${e(s.draft.title)}</p><p>${e(s.draft.adText)}</p><p class="ad-url">${e(s.draft.url)}</p></div>
      <details class="preparation-disclosure"><summary>Поисковые фразы (${phrases.length}) и исключения</summary><p>${phrases.map(e).join('<br>')}</p><p>Исключения: ${s.negatives?.length ? s.negatives.map(e).join(', ') : 'не заданы'}.</p><p class="hint">Только целевой автотаргетинг. Бренды конкурентов исключены из автотаргетинга.</p></details>
      <details class="preparation-disclosure"${started && (!s.complete || s.error || hasUnresolvedDirect(s)) ? ' open' : ''}><summary>Состояние объектов в Директе</summary>
        <p class="hint">Кабинет <code>${e(s.account)}</code> · код региона: ${e(s.regionId)}. В названии есть метка для сверки после обрыва.</p>
        <ul class="direct-steps">${Object.entries(s.steps).map(([key, value]) => `<li><strong>${stepNames[key as keyof typeof stepNames]}</strong>: ${directEventPhases[value.phase]}${value.id ? ` · <code>${e(value.id)}</code>` : ''}${key === 'keyword' && s.keywordEntries ? `<ul>${s.keywordEntries.map(k => `<li>${e(k.phrase)} — ${directEventPhases[k.phase]}${k.id ? ` · <code>${e(k.id)}</code>` : ''}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
        ${s.snapshot?.campaign ? `<h3>Последняя проверка Директа</h3><p>${e(time(s.checkedAt!))}${s.error ? ' · есть ошибка, успешная сверка не подтверждена' : ''}</p><dl class="preview-meta"><div><dt>Фактическое название</dt><dd>${e(s.snapshot.campaign.Name)}</dd></div><div><dt>Кампания</dt><dd>${e(s.snapshot.campaign.Status)} / ${e(s.snapshot.campaign.State)}</dd></div><div><dt>Объявление</dt><dd>${e(s.snapshot.ad?.Status ?? 'нет')} / ${e(s.snapshot.ad?.State ?? 'нет')}</dd></div><div><dt>Показы / клики</dt><dd>${e(String(s.snapshot.campaign.Statistics?.Impressions ?? 'неизвестно'))} / ${e(String(s.snapshot.campaign.Statistics?.Clicks ?? 'неизвестно'))}</dd></div></dl>` : '<p>Фактическое состояние ещё не прочитано.</p>'}</details>
      ${canRead ? refresh() : `<p><a href="${campaignConnectionHref(s.campaignId ?? defaultCampaignId)}">Подключите этот кабинет заново для сверки</a>. История сохранена. Данные из последнего чтения.</p>`}
      ${canWrite && !view.needsReconcile && !s.complete ? form('create', confirm(started ? 'Подтверждаю создание только ещё не начатых шагов после сверки.' : s.budget?'Я проверил текст, ссылку, географию, сумму и даты периодного бюджета. Создать объекты в Директе без показов.':'Я проверил текст, ссылку, географию и недельный бюджет. Создать объекты в Директе без показов.') + `<button class="primary" type="submit">${started ? 'Продолжить создание после сверки' : 'Создать черновик в Директе'}</button>`) : renderDirectRename(view, s)}
      <p><a href="/history#direct-history-${encodeURIComponent(s.planId)}">История операций и отмена изменения названия</a></p><p class="hint">Создание объектов необратимо. Во время работы здесь не запускайте и не редактируйте эту кампанию в Директе. Правки в плане Goulash не меняют созданные объекты.</p></div>` : ''}
  </section>`;
}
