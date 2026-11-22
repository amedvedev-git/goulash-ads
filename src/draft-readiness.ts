import { directCalendarDate } from './campaign.ts';
import { campaignDisplayName } from './campaign-plan.ts';
import type { CampaignPlan } from './campaign-plan.ts';
import { campaignBudget } from './campaign-catalog.ts';
import { campaignWorkspaceRun, confirmedOffDraft } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { pilotStatus } from './pilot.ts';
import type { DirectView } from './direct.ts';
import { escapeHtml as e } from './html.ts';
import type { PreparationView } from './preparation.ts';
import { preparationProgress, searchPreview } from './preparation-preview.ts';
import { campaignPlanHref, campaignTabHref, connectionHref, pilotHref, prepareHref, routes } from './routes.ts';
import type { CampaignContext } from './campaign-navigation.ts';
import { renderDirectNumber, renderDirectRefresh, renderDirectRename } from './direct-page.ts';
import { renderDirectLaunch } from './direct-launch-page.ts';
import type { DirectLaunchView } from './direct-launch.ts';
import { renderOptimization } from './campaign-optimization.ts';
import { moderationResult, renderCampaignCreativeReview } from './campaign-creative-review.ts';
import { renderNextPeriod } from './campaign-next-period.ts';
import { budgetStatus } from './analytics-money.ts';

const hidden = (name: string, value: string | number) => `<input type="hidden" name="${name}" value="${e(String(value))}">`;
const fact = (label: string, value: string) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`;
const statusPair = (object: { Status?: string; State?: string } | undefined) =>
  object ? `${object.Status ?? 'неизвестно'} / ${object.State ?? 'неизвестно'}` : 'Не сверено';
const stamp = (value: string) => new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
}).format(new Date(value)) + ' МСК';
const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export type CampaignReadiness = { goalSelected: boolean; goalVerified: boolean; advertiserConfirmed: boolean };

export function renderDraftReadiness(view: PreparationView, direct: DirectView | undefined, campaignId: string, pilotAvailable = false, readiness?: CampaignReadiness, launch?: DirectLaunchView, openSettings = false) {
  const p = view.saved.value, plan = view.plan;
  const run = campaignWorkspaceRun(direct?.runs, p.guided);
  const legacy = Boolean(run && !run.guidedDraft);
  const actual = run?.snapshot?.campaign, ad = run?.snapshot?.ad;
  const observed = launch?.state.observation ?? run?.launch?.observation;
  const observation = observed && (!run?.checkedAt || observed.checkedAt >= run.checkedAt) ? observed : undefined;
  const readAt = observation?.checkedAt ?? run?.checkedAt;
  const traffic = observation ? [observation.impressions, observation.clicks] : [actual?.Statistics?.Impressions, actual?.Statistics?.Clicks];
  const verified = confirmedOffDraft(run) && (!observation
    || observation.campaignStatus === 'DRAFT' && observation.campaignState === 'OFF'
      && observation.adStatus === 'DRAFT' && observation.adState === 'OFF');
  const pilot = run?.pilot;
  const frozen = run?.frozenPlan as CampaignPlan | undefined;
  const rename = run && direct && (legacy || verified && direct.ownChief) ? renderDirectRename(direct, run) : '';
  const moderation = run ? moderationResult(run) : undefined;
  const connected = Boolean(direct?.enabled && (legacy || direct.ownChief && direct.generation !== undefined));
  const sameAccount = connected && (!run || run.account === direct?.account);
  const planReady = view.current && !view.conflict && Boolean(plan?.directDraft && plan.directDraft.startDate > directCalendarDate());
  const writeReady = sameAccount && planReady && !direct?.blockedCampaignId && !direct?.needsReconcile;
  const matchingPlan = Boolean(run && plan?.id === run.campaignPlanId);
  const canContinue = Boolean(run?.safeToContinue && writeReady && matchingPlan);
  const connect = connectionHref(campaignId, 'summary');
  const startDate = run?.startDate ?? (planReady ? plan?.directDraft?.startDate : p.directStartDate);
  const draft = run?.draft ?? (planReady ? plan?.draft : undefined) ?? p.input;
  const endDate = startDate && Number.isFinite(Date.parse(startDate)) && ['7', '30'].includes(draft.period)
    ? new Date(Date.parse(startDate) + (Number(draft.period) - 1) * 86400000).toISOString().slice(0, 10) : '';

  function command(action: 'create' | 'refresh' | 'continue', label: string) {
    const checking = action === 'refresh';
    return `<form class="draft-command" method="post" action="/prepare/${action}">
      ${hidden('campaignId', campaignId)}${hidden('account', direct?.account ?? '')}${hidden('generation', direct?.generation ?? '')}
      ${run ? hidden('planId', run.planId) + hidden('storageRevision', run.storageRevision ?? 0) : ''}
      ${checking ? '' : hidden('campaignPlanId', plan?.id ?? '') + hidden('preparationRevision', view.saved.revision) +
        '<label class="check"><input type="checkbox" name="confirm" value="yes" required>Подтверждаю текст, условия и кабинет. Создать черновик с выключенными показами.</label>'}
      <button class="${checking ? 'secondary' : 'primary'}" type="submit">${label}</button>
    </form>`;
  }
  if (run) {
    const state = observation?.campaignState ?? (legacy && readAt && String(actual?.Id) === run.steps.campaign.id ? actual?.State : undefined);
    const review = (!verified && !state) || hasUnresolvedDirect(run) || Boolean(run.error || run.launch?.pending);
    const pilotAction = pilotAvailable
      ? `<a class="button primary" href="${pilotHref(campaignId)}">Перейти к учебному запуску</a>` : '';
    const connectionAction = `<a class="button primary" href="${connect}">Подключить кабинет ${e(run.account)}</a>`;
    const refresh = sameAccount && !launch ? (legacy && direct ? renderDirectRefresh(direct, run) : command('refresh', 'Сверить состояние в Директе')) : '';
    const nextAction = pilot ? pilotAction || connectionAction
      : canContinue ? command('continue', 'Продолжить создание')
      : !sameAccount ? connectionAction
      : legacy || review || !pilotAvailable && !verified ? refresh
      : pilotAction || (!launch ? `<a class="button primary" href="${connect}">Проверить готовность к запуску</a>` : '');
    const weekly = legacy && !run.budget;
    const budget = campaignBudget(run.budget?.amountRub ?? (weekly ? run.weekly : draft.budget));
    const periodStart = Date.parse(run.budget?.startDate ?? startDate ?? '');
    const periodEnd = Date.parse(run.budget?.endDate ?? endDate);
    return `<section class="campaign-content-section" id="direct">
      <h3 class="campaign-status-title">${pilot ? pilot.pending ? 'Требуется сверка команды' : pilotStatus(pilot.phase)
        : canContinue ? 'Можно продолжить создание' : review ? 'Требуется сверка в Директе'
        : state === 'ON' ? 'Показы разрешены Директом'
        : state === 'SUSPENDED' ? 'Показы остановлены'
        : state === 'ENDED' ? 'Показы завершены'
        : verified || state === 'OFF' ? 'Показы выключены' : 'Кампания в Директе'}</h3>
      <p>${pilot ? 'Состояние учебной кампании и отчёты доступны на экране запуска.'
        : canContinue ? 'Отправленные объекты сверены. Можно создать оставшуюся часть.'
        : review ? 'Сверьте состояние в Директе. Операция с неизвестным результатом повторно не отправляется.'
        : legacy && readAt ? 'Последняя сверка Директа · ' + e(stamp(readAt))
        : verified ? 'Кампания и объявление проверены в Директе.'
        : sameAccount ? 'Команды и последнее состояние показов доступны в этом разделе.' : 'Для управления восстановите доступ к кабинету кампании.'}</p>
      ${run.error ? `<p class="field-error">${e(run.error)}</p>` : ''}
      ${moderation?.rejected ? `<div class="notice error"><p><strong>Директ отклонил объявление.</strong>${moderation.explanation ? ' ' + e(moderation.explanation) : ''}</p>
        <p><a href="${campaignTabHref(campaignId, 'ads')}">Открыть объявление и узнать, как исправить</a></p></div>` : ''}
      ${nextAction}
      ${run.launch?.budget && !sameAccount ? '<p class="campaign-context-actions"><a href="https://direct.yandex.ru/" target="_blank" rel="noopener noreferrer">Проверить и остановить показы в Директ Про</a></p>' : ''}
      ${run.safeToContinue && !matchingPlan ? '<p class="hint">Сохранённый план отличается от версии операции. Проверьте журнал.</p>' : ''}
    </section>
    ${launch ? renderDirectLaunch(campaignId, launch) : ''}
    <section class="campaign-content-section" id="campaign-budget"><h3>Условия кампании</h3><dl class="campaign-summary-facts">
      ${fact('Бюджет стратегии', budget === 'Не задан' ? budget : budget + (weekly ? ' без НДС на неделю' : ' без НДС'))}
      ${weekly && Number.isFinite(periodStart) ? fact('Дата начала', day.format(new Date(periodStart)))
        : periodStart <= periodEnd ? fact('Период', day.formatRange(new Date(periodStart), new Date(periodEnd))) : ''}
      ${fact('Цель', frozen?.goal || plan?.goal || p.goal || 'Не указана')}
      ${fact('Площадка', 'Поиск Яндекса')}
      ${(frozen ?? plan)?.targetCpaKop ? fact('Желаемая цена заявки', rubles.format((frozen ?? plan)!.targetCpaKop! / 100)) : ''}
    </dl></section>
    <details class="campaign-fold" id="campaign-settings"${openSettings || direct?.input?.action === 'rename' ? ' open' : ''}>
      <summary>Настройки и сведения из Директа</summary>
      <dl class="preview-meta draft-meta">
        ${fact('Кабинет', run.account)}
        ${readAt ? fact('Последняя проверка в Директе', stamp(readAt)) : ''}
        ${fact('Показы / клики', traffic.map(value => String(value ?? '—')).join(' / '))}
        ${fact('Кампания', observation ? statusPair({ Status: observation.campaignStatus, State: observation.campaignState }) : statusPair(actual))}
        ${fact('Объявление', observation ? statusPair({ Status: observation.adStatus, State: observation.adState }) : statusPair(ad))}
        ${run.steps.ad.id ? fact('Номер объявления', run.steps.ad.id) : ''}
      </dl>
      ${run.steps.campaign.phase === 'confirmed' && run.steps.campaign.id ? `<div class="draft-check">
        ${renderDirectNumber('Номер кампании', 'direct-campaign-number', run.steps.campaign.id)}
        <p class="small">В Директ Про введите этот номер рядом с фильтром в разделе «Кампании».</p>
        <a class="inline-link" href="https://direct.yandex.ru/" target="_blank" rel="noopener noreferrer">Открыть Директ Про</a></div>` : ''}
      ${nextAction === refresh ? '' : refresh}
      ${rename ? `<details class="support"${direct?.input?.action === 'rename' ? ' open' : ''}><summary>Переименовать кампанию</summary>${rename}</details>` : ''}
      ${legacy ? `<p><a class="inline-link" href="${e(campaignPlanHref(campaignId))}">Открыть сохранённый план</a></p>` : renderNextPeriod(run, campaignId)}
      ${!legacy && run.complete && !pilot ? renderOptimization(run, campaignId) : ''}
    </details>`;
  }

  const back = `<form id="draft-back" method="post" action="/preparation/back">
    ${hidden('ad', campaignId)}${hidden('preparationRevision', view.saved.revision)}
    <button class="text-button" type="submit" name="step" value="3">К плану рекламы</button></form>`;
  const campaignLabel = !planReady && p.directStartDate && p.directStartDate <= directCalendarDate()
    ? 'Дата начала прошла. Проверьте план и подтвердите новые даты.'
    : 'Проверьте, куда будет сохранён черновик и на каких условиях.';
  return `<a class="campaign-back inline-link task-link" href="${routes.campaigns}">Все кампании</a>
      <div class="page-head"><div><h1>Проверьте готовность черновика</h1><p class="lead">${e(campaignDisplayName(p))}</p></div></div>
      ${preparationProgress(3, 4, true, 'draft-back')}
    <div class="flow-layout preparation-layout" data-stage="3">
      <section class="form-panel draft-readiness" id="direct">
        ${direct?.mode === 'fixture' ? '<p class="source-note">Учебное подключение</p>' : ''}
        <h2>Для черновика</h2><p class="muted">${e(campaignLabel)}</p>
          <section class="draft-check"><h3>Яндекс Директ</h3>
          ${connected ? `<p>Кабинет <strong>${e(direct?.account ?? '')}</strong> подключён. Показы будут выключены.</p>`
            : '<p>Подключите кабинет, в котором хотите создать черновик.</p>'}
          <a class="${!connected && planReady ? 'button primary' : 'inline-link task-link'}" href="${connect}">${connected ? 'Настройки Директа' : 'Подключить Директ'}</a></section>
          ${direct?.blockedCampaignId ? `<p class="field-error">Есть незавершённая операция. <a href="${prepareHref(direct.blockedCampaignId)}">Открыть кампанию и сверить</a>.</p>`
            : direct?.needsReconcile ? `<p class="field-error">Сначала сверьте прежнюю операцию в <a href="/history?scope=draft">журнале</a>.</p>` : ''}
          ${writeReady ? command('create', 'Создать черновик в Директе') : ''}
          ${!planReady ? '<p class="muted">Проверьте параметры и подтвердите актуальный план перед созданием.</p>' : ''}
          ${back}
          <section class="draft-check"><h2>Для платного запуска</h2>
            <p class="muted">К этим проверкам можно вернуться после создания черновика.</p>
            <dl class="preview-meta readiness-checks">
              <div><dt><a class="inline-link task-link" href="${connect}#metrika-title">Яндекс Метрика</a></dt>
                <dd>${readiness?.goalVerified ? 'Тестовая заявка подтверждена' : readiness?.goalSelected ? 'Нужна тестовая заявка' : 'Нужны счётчик и цель'}</dd></div>
              <div><dt><a class="inline-link task-link" href="${connect}#advertiser-title">Рекламодатель</a></dt>
                <dd>${readiness?.advertiserConfirmed ? 'Сведения подтверждены' : 'Нужно сверить сведения и маркировку'}</dd></div>
            </dl>
          </section>
      </section>
      <aside class="preparation-aside" aria-label="Условия кампании">
        <section class="preparation-guide" id="campaign-budget"><h2>Условия черновика</h2><dl class="preview-meta draft-meta">
          ${fact('География', draft.region)}
          ${fact('Рабочая цель', (planReady ? plan?.goal : undefined) ?? p.goal)}
          ${fact('Площадка', 'Поиск Яндекса')}
          ${fact('Бюджет стратегии без НДС', campaignBudget(draft.budget, draft.period))}
          ${plan?.targetCpaKop ? fact('Желаемая цена заявки', rubles.format(plan.targetCpaKop / 100)) : ''}
          ${startDate && endDate ? fact('Период', `${startDate} — ${endDate}, МСК`) : ''}
        </dl><p class="small">${budgetStatus(false, undefined, Boolean(view.current && plan), undefined)} Период стратегии не продлевается автоматически.</p></section>
        <div id="ad-summary">${searchPreview({ ...p, input: draft, step: 4 }, p.profile?.value.offers ?? [])}</div>
      </aside>
    </div>`;
}

export function renderCampaignAds(view: PreparationView, direct: DirectView | undefined, context: CampaignContext, creativeInput?: { title: string; adText: string }) {
  const preparation = view.saved.value;
  const run = campaignWorkspaceRun(direct?.runs, preparation.guided);
  const review = run?.complete ? renderCampaignCreativeReview(context.id, run, creativeInput) : '';
  if (review) return review;
  if (run && !run.guidedDraft) {
    const draft = run.draft;
    return `<section class="campaign-content-section">
      <h3>Сохранённое объявление</h3>
      <dl class="preview-meta"><div><dt>Заголовок</dt><dd>${e(draft.title)}</dd></div><div><dt>Текст</dt><dd>${e(draft.adText)}</dd></div></dl>
      <a class="inline-link" href="${e(campaignPlanHref(context.id))}">Изменить сохранённый план</a>
    </section>
    <section class="campaign-content-section creative-preview"><h3>Предпросмотр</h3>
      <div class="ad-preview"><span class="ad-tag">Реклама в поиске</span><p class="ad-url">${e(draft.url)}</p>
        <p class="ad-title">${e(draft.title)}</p><p>${e(draft.adText)}</p></div>
    </section>
    <details class="campaign-fold"><summary>Номера и правка в Директе</summary>
      ${run.steps.campaign.id ? renderDirectNumber('Номер кампании', 'creative-campaign-number', run.steps.campaign.id) : ''}
      ${run.steps.ad.id ? renderDirectNumber('Номер объявления', 'creative-ad-number', run.steps.ad.id) : ''}
      <p>В Директ Про найдите объявление по номеру кампании. Изменения сохранённого плана в Goulash не меняют объявление в Директе.</p>
      <a class="button secondary" href="https://direct.yandex.ru/" target="_blank" rel="noopener noreferrer">Открыть Директ Про</a>
    </details>`;
  }
  return `
    <div class="campaign-ad-incomplete">
      <section class="campaign-content-section" aria-labelledby="campaign-ad-heading">
        <h2 id="campaign-ad-heading">Объявление</h2>
        <p class="muted">Правка будет доступна после сверки объявления в Директе.</p>
        <a class="inline-link" href="${campaignTabHref(context.id, 'summary')}#direct">Открыть сводку и проверить состояние</a>
      </section>
      <aside class="preparation-aside" id="ad-summary" aria-label="Предпросмотр">
        ${searchPreview({ ...preparation, input: run?.draft ?? preparation.input, step: 4 }, preparation.profile?.value.offers ?? [])}
      </aside>
    </div>`;
}
