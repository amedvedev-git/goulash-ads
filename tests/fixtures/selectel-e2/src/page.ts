import { campaignLimits, exampleCampaign } from './campaign.ts';
import type { CampaignDraft, CampaignView } from './campaign.ts';
import { escapeHtml as e, renderOperations } from './operations-page.ts';
import type { OperationsView } from './operations.ts';
import { styles } from './ui-style.ts';
import { renderDirect } from './direct-page.ts';
import type { DirectView } from './direct.ts';
import { renderDirectConnect } from './direct-connect-page.ts';
import type { ConnectView } from './direct-connect.ts';
import { renderPlan } from './plan-page.ts';
import type { PreparationView } from './preparation.ts';

export type Section = 'campaign' | 'analytics' | 'automation' | 'history' | 'diagnostics' | 'connections';
type Options = { section?: Section; scope?: string; restore?: boolean; saved?: boolean; historyFilter?: 'all' | 'draft' | 'demo'; direct?: DirectView; preparation?: PreparationView; connect?: ConnectView; directConfigured?: boolean };
const titles = { campaign: 'Кампания', analytics: 'Аналитика', automation: 'Автоматика', history: 'История', diagnostics: 'Диагностика', connections:'Подключение Директа' };
const labels: Record<keyof CampaignDraft, string> = {
  description: 'Описание бизнеса', url: 'Адрес посадочной страницы', region: 'География', budget: 'Бюджет, ₽',
  period: 'Период бюджета', title: 'Заголовок объявления', adText: 'Текст объявления',
};
const hidden = (key: string, value: string | number) => `<input type="hidden" name="${key}" value="${e(String(value))}">`;

function campaignPage(campaign: CampaignView, options: Options) {
  const step = campaign.step ?? (campaign.preview ? 3 : 1);
  const draft = campaign.pending ?? campaign.preview ?? { ...campaign.input, title: '', adText: '' };
  const prefix = step === 1 ? 'business' : step === 2 ? 'analysis' : 'preview';
  function field(key: keyof CampaignDraft, hint = '') {
    const id = `${prefix}-${key}`, error = campaign.errors?.[key], max = campaignLimits[key as keyof typeof campaignLimits];
    const count = ['description', 'title', 'adText'].includes(key);
    const described = [hint && `${id}-hint`, count && `${id}-count`, error && `${id}-error`].filter(Boolean).join(' ');
    const attrs = `id="${id}" name="${key}" required${error ? ' aria-invalid="true"' : ''}${described ? ` aria-describedby="${described}"` : ''}`;
    let input: string;
    if (key === 'period') input = `<select ${attrs}><option value="">Выберите период</option>${['7', '30'].map(v => `<option value="${v}"${draft.period === v ? ' selected' : ''}>${v} дней</option>`).join('')}</select>`;
    else if (key === 'description' || key === 'adText') input = `<textarea ${attrs} rows="${key === 'description' ? 4 : 3}" maxlength="${max}">\n${e(draft[key])}</textarea>`;
    else input = `<input ${attrs} type="${key === 'url' ? 'url' : 'text'}" ${key === 'budget' ? 'inputmode="numeric" maxlength="8"' : `maxlength="${max}"`} value="${e(draft[key])}">`;
    return `<div class="field"><label for="${id}">${labels[key]}</label>${input}${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}
      ${count ? `<p class="counter" id="${id}-count" data-count-for="${id}">${draft[key].length} / ${max}</p>` : ''}
      ${error ? `<p class="field-error" id="${id}-error">${e(error)}</p>` : ''}</div>`;
  }
  const visible = step === 1 ? ['description', 'url', 'region', 'budget', 'period'] : step === 2 ? ['title', 'adText'] : ['title', 'adText', 'url', 'region', 'budget', 'period'];
  const back = (target: number, label: string) => `<button class="secondary" type="submit" name="step" value="${target}" formaction="/campaign/back" formnovalidate>${label}</button>`;
  const analysis = campaign.analysis;
  const source = analysis?.source === 'example' ? 'Подставной разбор вымышленного примера'
    : analysis?.source === 'provider' ? 'Ответ DeepSeek Flash · проверьте сведения' : 'Ручное заполнение';
  const suggestion = analysis && (analysis.offer !== draft.title || analysis.angle !== draft.adText) && (analysis.offer || analysis.angle);
  const action = step === 1 ? '/campaign/analyze' : step === 2 ? '/campaign/confirm' : campaign.conflict ? '/campaign/resolve' : '/campaign/save';
  const comparison = campaign.preview && (campaign.conflict || (campaign.dirty && step === 3)) ?
    Object.entries(labels).filter(([key]) => campaign.preview![key as keyof CampaignDraft] !== draft[key as keyof CampaignDraft]) : [];
  return `<div class="page-heading"><div><h1>Кампания</h1><p class="lead">${step === 3 ? 'Проверьте объявление и сохраните черновик. Публикации и показов не будет.' : 'От описания бизнеса к объявлению — с проверкой на каждом шаге.'}</p></div>
    <p class="save-state${campaign.dirty ? ' dirty' : ''}" id="save-state" role="status">${campaign.dirty ? 'Есть несохранённые изменения' : campaign.preview ? 'Черновик сохранён' : 'Черновик ещё не сохранён'}</p></div>
    <div class="notice recovery" id="recovery" hidden><p>В этой вкладке остались несохранённые данные кампании.</p><button type="button" id="restore-work" class="secondary">Восстановить ввод</button> <button type="button" id="discard-work" class="text-button">Удалить сохранённый ввод</button></div>
    <ol class="steps" aria-label="Подготовка кампании">${['Бизнес и бюджет', 'Проверка формулировок', 'Черновик'].map((label, i) => `<li${i + 1 === step ? ' aria-current="step"' : ''}><span class="number">${i + 1}</span>${i + 1 < step ? `<button form="campaign-form" type="submit" name="step" value="${i + 1}" formaction="/campaign/back" formnovalidate>${label}</button>` : `<span>${label}</span>`}</li>`).join('')}</ol>
    ${campaign.conflict ? `<div class="comparison"><h2>Сравните актуальную версию с вашим вводом</h2><p>Сохранённый черновик пока не изменён. Ваш вариант находится в редакторе ниже.</p>${comparisonTable(comparison, campaign.preview, draft)}<a href="/">Открыть актуальный черновик</a></div>` : comparison.length ? `<details class="comparison"><summary>Что изменится после сохранения</summary>${comparisonTable(comparison, campaign.preview, draft)}</details>` : ''}
    <div class="flow-layout"><form id="campaign-form" class="form-panel" method="post" action="${action}" data-step="${step}" data-scope="${e(options.scope ?? 'local')}" data-dirty="${campaign.dirty ? '1' : '0'}" data-restore="${options.restore ? '1' : '0'}" data-saved="${options.saved ? '1' : '0'}">
      ${hidden('revision', campaign.revision)}${campaign.conflict ? hidden('currentRevision', campaign.conflictRevision ?? campaign.revision) : ''}${Object.keys(labels).filter(key => !visible.includes(key)).map(key => hidden(key, draft[key as keyof CampaignDraft])).join('')}
      ${step === 1 ? `<h2>Расскажите о бизнесе</h2><p class="muted">Что предлагаете, кому и куда вести покупателей.</p><button class="text-button example-link" type="submit" formaction="/campaign/example" formnovalidate>Заполнить тестовым примером</button>
        ${field('description', 'Используйте вымышленные данные. Укажите предложение и важные условия.')}<div class="field-grid">${field('url')}${field('region', 'Город или регион, где доступно предложение.')}</div>
        <div class="field-grid">${field('budget', 'Общий лимит на весь период, не на день.')}${field('period')}</div>
        <div class="actions">${campaign.preview ? back(3, 'К черновику') : ''}<button class="primary" type="submit">Продолжить</button></div>
        ${campaign.deepSeekTrial && draft.description === exampleCampaign.description ? `<details><summary>Отдельная проба DeepSeek</summary><p class="hint">Только вымышленный пример. Разбор выше работает без платного вызова.</p>${['ready', 'completed'].includes(campaign.deepSeekTrial) ? `<button class="secondary" type="submit" formaction="/campaign/deepseek">${campaign.deepSeekTrial === 'ready' ? 'Проверить DeepSeek Flash' : 'Показать ответ DeepSeek Flash'}</button>` : '<p>Попытка уже учтена. Можно продолжить вручную.</p>'}</details>` : ''}` : ''}
      ${step === 2 ? `<h2 id="analysis-heading">Проверьте формулировки</h2><div class="source-note">${source}${analysis?.usage ? `<br>Токены · вход ${analysis.usage.promptTokens}, выход ${analysis.usage.completionTokens}` : ''}</div>
        ${suggestion ? '<p class="hint">Ваши формулировки сохранены. Новый вариант разбора можно сравнить ниже.</p>' : '<p class="muted">Уточните предложение и текст. Эти формулировки перейдут в черновик.</p>'}
        ${field('title')}${field('adText')}
        ${analysis?.evidence ? `<details><summary>На чём основан разбор</summary><blockquote>${e(analysis.evidence)}</blockquote>${analysis.unknown.length ? `<p>Что ещё уточнить:</p><ul>${analysis.unknown.map(item => `<li>${e(item)}</li>`).join('')}</ul>` : ''}</details>` : ''}
        ${suggestion ? `<details class="suggestion"><summary>Сравнить с новым вариантом разбора</summary><p><strong>${e(analysis.offer)}</strong></p><p>${e(analysis.angle)}</p><button hidden type="button" class="secondary" data-use-proposal data-title="${e(analysis.offer)}" data-text="${e(analysis.angle)}">Использовать этот вариант</button><noscript><p>Чтобы использовать вариант, скопируйте его в поля выше.</p></noscript></details>` : ''}
        <div class="actions">${back(1, 'Назад')}<button class="primary" type="submit">К черновику</button></div>` : ''}
      ${step === 3 ? `<h2>Объявление и параметры</h2><p class="muted">Правки появятся в предпросмотре сразу. Сохранение — по кнопке ниже.</p>
        ${field('title')}${field('adText')}<div class="field-grid">${field('url')}${field('region')}</div><div class="field-grid">${field('budget', 'Общий лимит за выбранный период.')}${field('period')}</div>
        <button class="text-button" type="submit" name="step" value="1" formaction="/campaign/back" formnovalidate>Изменить описание бизнеса</button>
        ${campaign.conflict ? '<label class="check"><input type="checkbox" name="resolution" value="replace" required>Я сравнил версии и хочу сохранить свой вариант вместо актуального.</label>' : ''}
        <div class="actions">${back(2, 'К формулировкам')}<button class="primary" type="submit">${campaign.preview ? 'Сохранить изменения' : 'Сохранить черновик'}</button></div>` : ''}
      <p class="hint" id="local-recovery-note">До сохранения данные не меняют черновик. Несохранённый ввод можно восстановить в этой вкладке.</p>
    </form>
    ${step === 3 ? `<aside class="preview-panel" aria-label="Предпросмотр объявления"><p class="preview-label">Как будет выглядеть объявление</p><div class="ad-preview" id="campaign-preview"><span class="ad-tag">Тестовый черновик</span><p class="ad-title" data-preview="title">${e(draft.title)}</p><p data-preview="adText">${e(draft.adText)}</p><p class="ad-url" data-preview="url">${e(draft.url)}</p></div><dl class="preview-meta"><div><dt>География</dt><dd data-preview="region">${e(draft.region)}</dd></div><div><dt>Общий бюджет</dt><dd data-preview="budget">${e(draft.budget)} ₽</dd></div><div><dt>Период</dt><dd data-preview="period">${e(draft.period)} дней</dd></div></dl><p class="preview-foot">${options.direct?.enabled ? 'Для отправки сохранённой версии в Директ проверьте параметры ниже.' : 'Директ не подключён. Черновик сохраняется только в этом приложении.'}</p><a class="inline-link" href="/history">История изменений</a></aside>` : `<aside class="help-panel"><h2>${step === 1 ? 'Сначала черновик' : 'Последнее слово — за вами'}</h2><p class="muted">${step === 1 ? 'Вы задаёте условия. На следующем шаге проверяете текст, затем сохраняете объявление.' : 'Проверьте, что в объявлении нет обещаний, которых бизнес не давал. Любую формулировку можно изменить.'}</p><ul><li>Подготовка не запускает рекламу.</li><li>Ручные правки сохраняются при переходах.</li><li>Бюджет остаётся тестовым.</li></ul><a class="inline-link" href="/analytics">Посмотреть отдельный пример на кампаниях А/Б</a></aside>`}
    </div>`;
}

function comparisonTable(changes: [string, string][], saved: CampaignDraft | undefined, pending: CampaignDraft) {
  return changes.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Сравнение версий"><table><thead><tr><th>Поле</th><th>Сохранено сейчас</th><th>Ваш вариант</th></tr></thead><tbody>${changes.map(([key, label]) => `<tr><th>${label}</th><td>${e(saved?.[key as keyof CampaignDraft] ?? '—')}</td><td>${e(pending[key as keyof CampaignDraft])}</td></tr>`).join('')}</tbody></table></div>` : '<p>Значения совпадают; изменилась версия черновика.</p>';
}

export function renderPage(value: string | undefined, message = '', isError = false, oauth = false, name?: string, campaign?: CampaignView, operations?: OperationsView, options: Options = {}) {
  const section = options.section ?? 'campaign';
  const nav: [Section, string][] = [['campaign', '/'], ['analytics', '/analytics'], ['automation', '/automation'], ['history', '/history']];
  const fields = campaign?.errors ? Object.entries(campaign.errors) : [];
  const prefix = campaign?.step === 1 ? 'business' : campaign?.step === 2 ? 'analysis' : 'preview';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    ${section === 'automation' && operations?.job?.status === 'pending' ? '<meta http-equiv="refresh" content="1;url=/automation">' : ''}
    <title>${titles[section]} · Goulash Реклама</title><style>${styles}</style><script src="/assets/ui-client.js" defer></script></head><body data-scope="${e(options.scope ?? 'anonymous')}">
    <a class="skip" href="#main">К содержимому</a><header class="shell"><div class="shell-inner"><div class="bar"><a class="brand" href="/" aria-label="Goulash Реклама — кампания"><span class="mark" aria-hidden="true">${'<i></i>'.repeat(9)}</span>Goulash<span class="product">Реклама</span></a><span class="test-badge">Тестовый режим</span>
    <details class="account"><summary>${name ? e(name) : oauth ? 'Аккаунт' : 'Локальный режим'}</summary><div class="account-panel"><p>${options.direct?.enabled ? (options.direct.ownChief ? 'Свой кабинет Директа подключён' : 'Директ: локальное подключение') : 'Директ не подключён'}</p>${oauth && name ? '<a href="/connections/direct">Свой кабинет Директа</a>' : ''}${campaign ? '<a href="/diagnostics">Диагностика стенда</a>' : ''}${oauth ? name ? '<form method="post" action="/logout"><button class="secondary" type="submit" data-logout>Выйти</button></form>' : '<a href="/auth/yandex">Войти через Яндекс ID</a>' : `<p class="muted">${options.direct?.enabled ? 'Запись в Директ — только с подтверждением.' : 'Все изменения остаются в локальном приложении.'}</p>`}</div></details></div>
    ${campaign ? `<nav class="nav" aria-label="Разделы">${nav.map(([key, url]) => `<a href="${url}"${section === key ? ' aria-current="page"' : ''}>${titles[key]}</a>`).join('')}</nav>` : ''}</div></header>
    <main id="main">${message ? `<div id="notification" class="notice${isError ? ' error' : ''}" role="${isError ? 'alert' : 'status'}" tabindex="-1"><p>${e(message)}</p>${fields.length ? `<ul>${fields.map(([key, error]) => `<li><a href="#${prefix}-${key}">${labels[key as keyof CampaignDraft]}: ${e(error!)}</a></li>`).join('')}</ul>` : ''}</div>` : ''}
    ${section === 'connections' && name ? renderDirectConnect(options.connect) : campaign ? section === 'campaign' ? options.preparation ? renderPlan(options.preparation, options.scope ?? 'local', options.direct) : campaignPage(campaign, options) : section === 'diagnostics' ? `<h1>Диагностика стенда</h1><section class="diagnostics"><h2>Тестовая запись</h2><p>Проверка сохранения в локальной базе SQLite. До 200 символов.</p><form method="post" action="/test-record"><label for="content">Текст записи</label><input id="content" name="content" maxlength="200" required value="${e(value ?? '')}"><button type="submit">Сохранить</button></form></section>` : `<div class="page-heading"><div><h1>${titles[section]}</h1><p class="lead">${section === 'history' ? (options.direct?.enabled ? 'Изменения в Директе, локальном черновике и решения на тестовых данных.' : 'Изменения черновика и решения на тестовых данных.') : 'Отдельный тестовый пример на кампаниях А/Б. Он не связан с бюджетом вашего черновика.'}</p></div></div><div class="operations">${operations ? renderOperations(operations, section, options.historyFilter) : ''}</div>` : `<section class="login"><h1>Реклама под контролем</h1><p>Подготовьте черновик, проверьте тестовые результаты и проследите каждое изменение.</p><p class="muted">Директ не подключён. Реклама не запускается.</p>${oauth ? '<a class="button primary" href="/auth/yandex">Войти через Яндекс ID</a>' : ''}</section>`}
    ${campaign && ['campaign', 'history'].includes(section) ? renderDirect(options.direct, campaign, section === 'history', Boolean(options.preparation), options.preparation?.current ? options.preparation.plan?.id : undefined) : ''}</main><footer class="footer">Тестовый режим · показы выключены · платная подготовка только с отдельным согласием</footer></body></html>`;
}
