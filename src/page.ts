import { campaignLimits, exampleCampaign } from './campaign.ts';
import type { CampaignDraft, CampaignView } from './campaign.ts';
import { escapeHtml as e, renderHistory } from './operations-page.ts';
import { providerEntries } from './operations-journal.ts';
import type { OperationsView } from './operations.ts';
import { styles } from './ui-style.ts';
import { renderDirect } from './direct-page.ts';
import type { DirectView } from './direct.ts';
import { renderDirectConnect } from './direct-connect-page.ts';
import { renderConnectionSettings } from './connections-page.ts';
import { renderHowItWorks } from './how-it-works-page.ts';
import type { ConnectionSettings } from './connections-page.ts';
import type { CampaignReadiness } from './draft-readiness.ts';
import type { DirectLaunchView } from './direct-launch.ts';
import { renderExperimentForm, renderExperimentJournal } from './campaign-experiment.ts';
import type { CampaignExperimentsView } from './campaign-experiment.ts';
import type { ConnectView } from './direct-connect.ts';
import { renderPlan } from './plan-page.ts';
import type { PreparationView } from './preparation.ts';
import { renderResults } from './results-page.ts';
import type { AnalyticsView } from './analytics-page.ts';
import type { DemoNotice } from './demo-section.ts';
import { renderOverview } from './overview-page.ts';
import { navigation, campaignTabHref, connectionHref, pilotHref, routes } from './routes.ts';
import { uiIcon } from './ui-icons.ts';
import { renderCampaignCatalog } from './campaign-catalog.ts';
import type { CampaignCatalogItem } from './campaign-catalog.ts';
import { renderPilot, renderPilotIntro } from './pilot-page.ts';
import type { PilotPageOptions } from './pilot-page.ts';
import type { PilotView } from './pilot.ts';
import { campaignHeaderContext, campaignTabs, renderCampaignHeader, renderCampaignPanelHeading, renderCampaignTabs } from './campaign-navigation.ts';
import type { CampaignContext } from './campaign-navigation.ts';
import { renderCampaignAds, renderDraftReadiness } from './draft-readiness.ts';

export type Section = 'overview' | 'campaign' | 'analytics' | 'history' | 'diagnostics' | 'connections' | 'pilot' | 'how-it-works';
type Options = { section?: Section; scope?: string; restore?: boolean; saved?: boolean; journalRecovery?: string; historyFilter?: 'all' | 'draft' | 'demo'; historySource?: 'all' | 'goulash' | 'mine'; direct?: DirectView; preparation?: PreparationView; connect?: ConnectView; directConfigured?: boolean; analytics?:AnalyticsView; campaignCatalog?: CampaignCatalogItem[]; catalogFilter?: string; campaignId?: string; campaignContext?: CampaignContext; connectionCampaign?: {id: string; name: string; guided?: boolean; from?: import('./routes.ts').ConnectionOrigin}; diagnostics?: boolean; connectionSettings?: ConnectionSettings; readiness?: CampaignReadiness; summarySettingsOpen?: boolean; directLaunch?: DirectLaunchView; creativeInput?: { title: string; adText: string }; experiments?: CampaignExperimentsView; experimentsOnly?: boolean; explainOptimization?: boolean; demoNotice?: DemoNotice; pilot?: PilotView; pilotAvailable?: boolean; publicPilot?: boolean };
const accountNavigation = [
  ['overview', routes.overview, 'Рабочий стол'],
  ['campaign', routes.campaigns, 'Кампании'],
  ['connections', routes.connection, 'Подключения'],
] as const;
const titles = { overview: 'Обзор', campaign: 'Кампании', analytics: 'Результаты', history: 'История', diagnostics: 'Диагностика', connections: 'Подключения', pilot: 'Учебный запуск', 'how-it-works': 'Как это работает' };
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
    ${campaign.conflict ? `<div class="comparison"><h2>Сравните актуальную версию с вашим вводом</h2><p>Сохранённый черновик пока не изменён. Ваш вариант находится в редакторе ниже.</p>${comparisonTable(comparison, campaign.preview, draft)}<a href="${routes.campaigns}">Открыть актуальный черновик</a></div>` : comparison.length ? `<details class="comparison"><summary>Что изменится после сохранения</summary>${comparisonTable(comparison, campaign.preview, draft)}</details>` : ''}
    <div class="flow-layout"><form id="campaign-form" class="form-panel" method="post" action="${action}" data-resume-action="/campaign/resume" data-step="${step}" data-scope="${e(options.scope ?? 'local')}" data-dirty="${campaign.dirty ? '1' : '0'}" data-restore="${options.restore ? '1' : '0'}" data-saved="${options.saved ? '1' : '0'}">
      ${hidden('revision', campaign.revision)}${campaign.conflict ? hidden('currentRevision', campaign.conflictRevision ?? campaign.revision) : ''}${Object.keys(labels).filter(key => !visible.includes(key)).map(key => hidden(key, draft[key as keyof CampaignDraft])).join('')}
      ${step === 1 ? `<h2>Расскажите о бизнесе</h2><p class="muted">Что предлагаете, кому и куда вести покупателей.</p><button class="text-button example-link" type="submit" formaction="/campaign/example" data-operation="example" formnovalidate>Заполнить тестовым примером</button>
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
    ${step === 3 ? `<aside class="preview-panel" aria-label="Предпросмотр объявления"><p class="preview-label">Как будет выглядеть объявление</p><div class="ad-preview" id="campaign-preview"><span class="ad-tag">Тестовый черновик</span><p class="ad-title" data-preview="title">${e(draft.title)}</p><p data-preview="adText">${e(draft.adText)}</p><p class="ad-url" data-preview="url">${e(draft.url)}</p></div><dl class="preview-meta"><div><dt>География</dt><dd data-preview="region">${e(draft.region)}</dd></div><div><dt>Общий бюджет</dt><dd data-preview="budget">${e(draft.budget)} ₽</dd></div><div><dt>Период</dt><dd data-preview="period">${e(draft.period)} дней</dd></div></dl><p class="preview-foot">${options.direct?.enabled ? 'Для отправки сохранённой версии в Директ проверьте параметры ниже.' : 'Директ не подключён. Черновик сохраняется только в этом приложении.'}</p><a class="inline-link" href="/history">История изменений</a></aside>` : `<aside class="help-panel"><h2>${step === 1 ? 'Сначала черновик' : 'Последнее слово — за вами'}</h2><p class="muted">${step === 1 ? 'Вы задаёте условия. На следующем шаге проверяете текст, затем сохраняете объявление.' : 'Проверьте, что в объявлении нет обещаний, которых бизнес не давал. Любую формулировку можно изменить.'}</p><ul><li>Подготовка не запускает рекламу.</li><li>Ручные правки сохраняются при переходах.</li><li>Бюджет остаётся тестовым.</li></ul><a class="inline-link" href="${routes.results}#demo">Посмотреть отдельный пример на кампаниях А/Б</a></aside>`}
    </div>`;
}

function comparisonTable(changes: [string, string][], saved: CampaignDraft | undefined, pending: CampaignDraft) {
  return changes.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Сравнение версий"><table><thead><tr><th>Поле</th><th>Сохранено сейчас</th><th>Ваш вариант</th></tr></thead><tbody>${changes.map(([key, label]) => `<tr><th>${label}</th><td>${e(saved?.[key as keyof CampaignDraft] ?? '—')}</td><td>${e(pending[key as keyof CampaignDraft])}</td></tr>`).join('')}</tbody></table></div>` : '<p>Значения совпадают; изменилась версия черновика.</p>';
}

export function renderPage(value: string | undefined, message = '', isError = false, oauth = false, name?: string, campaign?: CampaignView, operations?: OperationsView, options: Options & {
  trainingHref?: string; signInHref?: string; trainingLoginHref?: string; noticeVariant?: 'neutral' | 'error';
  connectionRecoveryHref?: string; pilotOptions?: PilotPageOptions;
} = {}) {
  const section = options.section ?? 'campaign';
  const catalog = section === 'campaign' ? options.campaignCatalog : undefined;
  const preparation = options.preparation?.saved.value;
  const guidedRun = options.direct?.runs?.findLast(run => run.guidedDraft);
  const context = options.campaignContext ?? (section === 'campaign' && !catalog && preparation?.guided && guidedRun
    ? campaignHeaderContext(options.campaignId ?? 'default', 'summary', preparation, guidedRun, options.direct?.mode) : undefined);
  const training = context && options.pilotAvailable && options.direct?.runs?.some(run => run.pilot) &&
    (context.tab === 'results' || context.tab === 'journal')
    ? `<p class="campaign-context-actions"><a class="inline-link" href="${pilotHref(context.id)}${context.tab === 'results' ? '#pilot-results' : '#pilot-history'}">Открыть ${context.tab === 'results' ? 'результаты' : 'журнал'} учебного запуска</a></p>`
    : '';
  const fields = campaign?.errors ? Object.entries(campaign.errors) : [];
  const prefix = campaign?.step === 1 ? 'business' : campaign?.step === 2 ? 'analysis' : 'preview';
  const connected = Boolean(options.direct?.enabled || options.connect?.status === 'connected');
  const fixture = (options.connect?.mode ?? options.direct?.mode) === 'fixture';
  const accountState = connected ? 'Яндекс Директ подключён' : 'Директ не подключён';
  const connectionText = section === 'how-it-works' ? '' : section === 'pilot' ? 'Учебный запуск · имитация Директа' :
    fixture ? 'Учебный кабинет · ' + accountState : options.trainingHref ? 'Рабочий кабинет · ' + accountState : accountState;
  const connectionTarget = connectionHref(context?.id ?? (section === 'campaign' && !catalog ? options.campaignId : undefined), context?.tab ?? (section === 'campaign' && !catalog ? 'summary' : undefined));
  const footer = options.pilot || section === 'pilot' ? 'Учебные данные · реальные показы не включаются'
    : oauth || (context && guidedRun?.launch) || options.directLaunch ? 'Управление кампаниями Яндекс Директа'
    : 'Подготовка черновика в Яндекс Директе · показы не включаются';
  const noticeStyle = options.noticeVariant ?? (isError ? 'error' : '');
  const notice = message ? `<div id="notification" class="notice${noticeStyle ? ' ' + noticeStyle : ''}" role="${noticeStyle === 'error' ? 'alert' : 'status'}" tabindex="-1"><p>${e(message)}</p>${options.journalRecovery ? `<a class="task-link" href="${e(options.journalRecovery)}">Вернуться к записи журнала</a>` : ''}${fields.length ? `<ul>${fields.map(([key, error]) => `<li><a href="#${prefix}-${key}">${labels[key as keyof CampaignDraft]}: ${e(error!)}</a></li>`).join('')}</ul>` : ''}</div>` : '';
  const metrikaNotice = section === 'connections' && campaign && !options.connectionRecoveryHref && options.connectionSettings?.panel === 'metrika' ? notice : '';
  const pageNotice = metrikaNotice ? '' : notice;
  let body: string;
  if (options.pilot) body = renderPilot(options.pilot, section === 'pilot', options.pilotOptions);
  else if (section === 'pilot' && campaign) body = renderPilotIntro();
  else if (section === 'how-it-works') body = renderHowItWorks(options.publicPilot ? routes.pilot : options.trainingLoginHref);
  else if (options.connectionRecoveryHref) body = `<div class="page-head"><div><h1>Подключения недоступны</h1></div></div>
    <section class="form-panel"><p>Эта страница недоступна в текущем аккаунте. Откройте свои подключения или выберите другой аккаунт Яндекса.</p>
      <div class="entry-actions">
        <a class="button primary" href="${routes.connection}">Открыть подключения</a>
        <a class="button secondary" data-login-return href="${e(options.connectionRecoveryHref)}">Войти под другим аккаунтом</a>
      </div></section>`;
  else if (section === 'connections' && campaign) body = renderDirectConnect(options.connect, options.direct, options.connectionCampaign,
    options.connectionSettings ? renderConnectionSettings(options.connectionSettings, metrikaNotice) : '', options.connectionSettings?.error, options.connectionSettings?.panel);
  else if (!campaign) {
    const trainingLogin = section === 'pilot' ? options.trainingLoginHref : undefined;
    const pilotLogin = section === 'pilot' && (options.publicPilot || trainingLogin);
    const loginTitle = pilotLogin ? 'Учебный запуск Rollstar' : options.signInHref ? titles[section] : 'Войти в Goulash Рекламу';
    const loginText = pilotLogin ? 'Попробуйте модерацию, запуск и остановку на учебных данных.'
      : options.signInHref ? 'Войдите через Яндекс ID, чтобы открыть этот раздел.'
      : 'Подготовьте кампанию и сохраните черновик в своём Яндекс Директе.';
    const signIn = oauth ? `<a class="button primary"${options.signInHref && !trainingLogin ? ' data-login-return' : ''} href="${e(trainingLogin ?? options.signInHref ?? '/auth/yandex')}">${trainingLogin ? 'Войти в учебный кабинет' : 'Войти через Яндекс ID'} ${uiIcon('arrow', 16)}</a>` : '';
    const showPilotLink = section === 'overview' && options.publicPilot;
    body = `<section class="login overview-focus">
      <h1>${loginTitle}</h1>
      <p>${loginText}</p>
      ${showPilotLink ? `<div class="login-options">
        ${signIn}
        <a class="button secondary" href="${routes.pilot}">Учебный запуск Rollstar</a>
      </div>` : signIn}
      ${options.trainingHref ? `<p><a href="${e(options.trainingHref)}">Вернуться в учебный кабинет</a></p>` : ''}
    </section>`;
  }
  else if (section === 'overview') body = renderOverview(options.campaignCatalog, options.analytics, options.direct, options.connect, oauth, options.publicPilot);
  else if (catalog) body = renderCampaignCatalog(catalog, options.analytics, options.catalogFilter, options.direct);
  else if (section === 'campaign' && context?.tab === 'ads' && options.preparation) body = renderCampaignAds(options.preparation, options.direct, context, options.creativeInput)
    + (options.preparation.saved.value.guided ? `<details class="campaign-fold" id="campaign-experiment"${isError && !options.creativeInput ? ' open' : ''}>
      <summary>${options.experiments?.experiments.some(item => !item.closed) ? 'Учёт A/B-теста' : `Черновик A/B-теста${options.experiments && !options.experiments.goalReady ? ' <span class="muted small">Нужно подтвердить цель</span>' : ''}`}</summary>
      ${renderExperimentForm(options.experiments, context.id, options.preparation.wordingVariants)}</details>` : '');
  else if (section === 'campaign' && context?.tab === 'summary' && options.preparation) body = renderDraftReadiness(
    options.preparation, options.direct, context.id, options.pilotAvailable, options.readiness, options.directLaunch, options.summarySettingsOpen);
  else if (section === 'campaign') body = options.preparation ? renderPlan(options.preparation, options.scope ?? 'local', options.direct, options.campaignId, options.pilotAvailable, options.readiness, options.directLaunch, options.summarySettingsOpen) : campaignPage(campaign, options);
  else if (section === 'diagnostics') body = `<h1>Диагностика стенда</h1><section class="diagnostics"><h2>Тестовая запись</h2><p>Проверка сохранения в локальной базе SQLite. До 200 символов.</p><form method="post" action="/test-record"><label for="content">Текст записи</label><input id="content" name="content" maxlength="200" required value="${e(value ?? '')}"><button type="submit">Сохранить</button></form></section>`;
  else if (section === 'analytics') body = renderResults(options.analytics, context ? undefined : operations, options.demoNotice, training);
  else if (section === 'history') {
    const mainJournal = !options.experimentsOnly;
    const experimentJournal = renderExperimentJournal(options.experiments);
    const journalHeading = context ? renderCampaignPanelHeading('journal', `<nav class="campaign-journal-filters" aria-label="Записи журнала">${([
      ['all', 'Все'], ['mine', 'Мои изменения'], ['goulash', 'Решение сервиса'], ['experiments', 'Эксперименты'],
    ] as const).map(([key, label]) => {
      const active = key === (mainJournal ? options.historySource ?? 'all' : 'experiments');
      return `<a href="${e(campaignTabHref(context.id, 'journal', key === 'all' ? {} : { by: key }))}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('')}</nav>`) : '';
    const events = mainJournal ? providerEntries(options.direct, operations?.history ?? [], options.campaignCatalog, context?.id, options.explainOptimization, options.historyFilter, options.historySource) : [];
    body = journalHeading + training + (mainJournal
      ? renderHistory(operations, options.historyFilter, options.historySource, context?.id, events)
      : experimentJournal || '<p>Для этой кампании пока нет экспериментов.</p>');
  }
  else body = '';
  const directPanel = Boolean(options.direct && (options.direct.state || options.direct.input || !options.direct.ownChief));
  const title = context ? `${campaignTabs[context.tab]} · ${context.name}` : titles[section];
  const paneHeading = context?.tab === 'summary' || context?.tab === 'ads' ? renderCampaignPanelHeading(context.tab) : '';
  const contents = context
    ? renderCampaignHeader(context) + `<div class="campaign-workspace">${renderCampaignTabs(context)}<section data-campaign-panel aria-labelledby="campaign-tab-${context.tab}" tabindex="-1">${paneHeading}${pageNotice}${body}</section></div>`
    : pageNotice + body;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#040406"><title>${e(title)} · Goulash Реклама</title><style>${styles}</style><script src="/assets/ui-client.js" defer></script>${section === 'connections' ? '<script src="/assets/connection-client.js" defer></script>' : ''}</head><body data-scope="${e(options.scope ?? 'anonymous')}">
    <a class="skip" href="#main">К содержимому</a><header class="topbar"><div class="topbar-inner">
      <a class="brand" href="${routes.overview}" aria-label="Реклама — ${oauth ? 'рабочий стол' : 'обзор'}"><span class="mark" aria-hidden="true">${'<i></i>'.repeat(9)}</span>Реклама</a>
      ${campaign ? `<nav class="nav" aria-label="Разделы">${(oauth ? accountNavigation : navigation).map(([key, url, label]) => `<a${key === 'connections' ? ' data-campaign-connection' : ''} href="${key === 'connections' ? e(connectionTarget) : url}"${(context ? 'campaign' : section) === key ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : ''}
      ${!campaign && section === 'overview' ? `<a class="topbar-guide" href="${routes.howItWorks}">Как это работает</a>` : ''}
      ${campaign ? `<details class="account"><summary aria-label="Профиль: ${name ? e(name) : 'Локальный режим'}">${uiIcon('account', 18)}<span class="account-name">${name ? e(name) : 'Локальный режим'}</span><span class="account-label" aria-hidden="true">Профиль</span>${uiIcon('chevron', 14)}</summary><div class="account-panel">
        ${name ? `<p class="account-owner">${e(name)}</p>` : ''}
        ${connectionText ? `<p class="account-state"><span class="status-dot${connected ? ' ok' : ''}" aria-hidden="true"></span>${connectionText}</p>` : ''}
        <a data-campaign-connection href="${connectionTarget}">Подключения</a>
        ${oauth ? `<a href="${routes.results}">Результаты</a><a href="${routes.history}">Журнал</a>` : ''}
        <a href="${routes.results}#demo">Учебное перераспределение бюджета</a>
        ${options.publicPilot ? `<a href="${routes.pilot}">Учебный запуск Rollstar</a>` : ''}
        ${options.trainingHref ? `<a href="${e(options.trainingHref)}">Открыть учебный кабинет</a>` : ''}
        ${section === 'pilot' ? '<a href="/">Вернуться в рабочий кабинет</a>' : ''}
        <a href="${routes.howItWorks}"${section === 'how-it-works' ? ' aria-current="page"' : ''}>Как это работает</a>
        ${options.diagnostics ? `<a href="${routes.diagnostics}">${uiIcon('settings', 17)} Диагностика стенда</a>` : ''}
        ${oauth && name ? `<form method="post" action="/logout"><button class="secondary" type="submit" data-logout>${uiIcon('logout', 16)} Выйти</button></form>` : ''}
      </div></details>` : ''}
    </div></header>
    <main id="main" tabindex="-1"${context ? ` data-campaign-id="${e(context.id)}"` : ''}>${contents}
    ${campaign && !context && !options.pilot && !catalog && !options.preparation?.saved.value.guided && (!options.preparation || directPanel) && section === 'campaign' ? renderDirect(options.direct, campaign, false, Boolean(options.preparation), options.preparation?.current ? options.preparation.plan?.id : undefined, false, options.campaignCatalog) : ''}
    </main><footer class="footer"><div class="footer-inner"><span>Goulash · Реклама</span><span>${footer}</span></div></footer></body></html>`;
}
