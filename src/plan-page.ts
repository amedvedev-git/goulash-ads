import { sentenceText } from './ui-copy.ts';
import { preparationProgress, searchPreview } from './preparation-preview.ts';
import { campaignConnectionHref, campaignReference } from './campaign-catalog.ts';
import { campaignDisplayName, retainedPreparation } from './campaign-plan.ts';
import { renderOfferEditor } from './offer-editor.ts';
import { renderAdStep } from './ad-step.ts';
import { policyHash } from './phrase-policy.ts';
import { escapeHtml as e } from './operations-page.ts';
import type { PreparationView } from './preparation.ts';
import { hasProfileInput } from './preparation.ts';
import type { DirectView } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { descriptionHash, profileHash, selectionHash } from './campaign-plan.ts';
import { uiIcon } from './ui-icons.ts';
import { fieldPlaceholder, businessPicker } from './business-fields.ts';
import { campaignHref as canonicalCampaignHref, prepareHref, routes } from './routes.ts';
import { renderDraftReadiness } from './draft-readiness.ts';
import type { CampaignReadiness } from './draft-readiness.ts';
import type { DirectLaunchView } from './direct-launch.ts';

const hidden = (key: string, value: string | number) => `<input type="hidden" name="${key}" value="${e(String(value))}">`;
const check = (name: string, text: string) => `<label class="check"><input type="checkbox" name="${name}" value="yes">${text}</label>`;

export function renderPlan(view: PreparationView, scope: string, direct?: DirectView, campaignId = 'default', pilotAvailable = false, readiness?: CampaignReadiness, launch?: DirectLaunchView, openSettings = false) {
  const p = view.saved.value, step = p.step, errors = view.errors ?? {};
  const guided = Boolean(p.guided);
  if (guided && (step === 4 || direct?.runs?.some(run => run.guidedDraft))) return renderDraftReadiness(view, direct, campaignId, pilotAvailable, readiness, launch, openSettings);
  const campaignHref = (guided ? prepareHref : canonicalCampaignHref)(campaignId);
  const businessStep = step <= 2;
  const uiStep = businessStep ? 1 : step === 3 ? 2 : 3;
  const labels = { description: guided ? 'Что предлагаете клиенту?' : 'Чем занимается ваш бизнес?', url: guided ? 'Ссылка, куда ведём клиента' : 'Куда вести людей из объявления?', region: 'Город или регион', goal: 'Что должен сделать клиент после перехода?',
    budget: 'Бюджет кампании', period: 'Срок', title: 'Заголовок объявления', adText: 'Текст объявления' };
  const values = { ...p.input, goal: p.goal };
  function field(name: string, label: string, value: string, kind = 'input', hint = '', required = false, max = 1000) {
    const id = 'plan-' + name, error = errors[name];
    const describedBy = [hint && id + '-hint', (error || name === 'url') && id + '-error'].filter(Boolean).join(' ');
    const attrs = `id="${id}" name="${name}"${required ? ' required' : ''} maxlength="${max}"${fieldPlaceholder(name, guided)}${error ? ' aria-invalid="true"' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}`;
    const input = name === 'region' || name === 'goal' ? businessPicker(name, attrs, value) : kind === 'textarea' ? `<textarea ${attrs} rows="3">${e(value)}</textarea>` : kind === 'period'
      ? `<select ${attrs}>${['7', '30'].map(s => `<option value="${s}"${value === s ? ' selected' : ''}>${s} дней</option>`).join('')}</select>`
      : `<input ${attrs} type="${name === 'url' ? 'url' : 'text'}"${name === 'url' ? ' autocomplete="url" spellcheck="false" pattern="[Hh][Tt][Tt][Pp][Ss]?://.+"' : ''}${name === 'budget' ? ' inputmode="numeric"' : ''} value="${e(value)}">`;
    return `<div class="field"><label for="${id}">${e(label)}</label>${input}${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ''}${error || name === 'url' ? `<p class="field-error" id="${id}-error"${error ? '' : ' hidden'}>${e(error || '')}</p>` : ''}</div>`;
  }
  const inputField = (name: keyof typeof values, hint = '', required = true) => field(name, labels[name], values[name], ['description', 'adText'].includes(name) ? 'textarea' : name === 'period' ? 'period' : 'input', hint, required,
    name === 'description' ? 1000 : name === 'adText' ? 81 : name === 'title' ? 56 : name === 'goal' ? 160 : name === 'url' ? 2048 : 100);
  const post = (action: string, label: string, primary = false, extra = '') => `<button type="submit" formaction="/preparation/${action}" data-operation="${action}" class="${primary ? 'primary' : 'secondary'}"${extra}>${label}${primary ? uiIcon('arrow', 16) : ''}</button>`;
  const freshProposal = view.run?.kind === 'profile' && view.run.profileHash === descriptionHash(p.input.description) ? view.run.plan.strategy.profile : undefined;
  const savedProfile = p.profile && (hasProfileInput(p.profile.value) || p.profile.editedPaths.includes('empty-editor')) ? p.profile.value : undefined;
  const profile = savedProfile ?? freshProposal;
  const profileOpen = Boolean(freshProposal || step === 2 && !Object.keys(errors).length ||
    Object.keys(errors).some(key => /^(offer|evidence|seeds|aliases|exclude|brand|question)/u.test(key)));
  const profileCurrent = p.profile?.confirmedHash === profileHash(p);
  const visible: (keyof typeof values)[] = businessStep ? ['description', 'url', 'region', 'goal'] : step === 3 ? ['title', 'adText', ...(guided ? ['budget', 'period'] as const : [])] : ['budget', 'period'];
  const comparison = view.latest ? [
    ...Object.entries(labels).map(([key,label]) => [label, key === 'goal' ? view.latest!.goal : view.latest!.input[key], values[key]]),
    ...(guided ? [['Название кампании', view.latest.campaignName ?? '', p.campaignName ?? '']] : []),
    ['Предложения', view.latest.profile?.value.offers.map(o=>o.name + ' · ' + o.evidence).join('; ') ?? '', p.profile?.value.offers.map(o=>o.name + ' · ' + o.evidence).join('; ') ?? ''],
    ['Фразы', view.latest.selection.phrases.join('; '), p.selection.phrases.join('; ')]
  ].filter(([,a,b])=>a!==b) : [];
  const campaignComparison = view.campaign ? Object.entries(labels).filter(([key]) => key !== 'goal').map(([key,label]) => [label, view.campaign!.draft[key], values[key]]).filter(([,a,b])=>a!==b) : [];
  const comparisonTable = (rows: string[][], label: string, empty: string) => rows.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="${e(label)}"><table><thead><tr><th>Поле</th><th>Сохранено сейчас</th><th>Ваш ввод</th></tr></thead><tbody>${rows.map(([name,a,b])=>`<tr><th>${e(name)}</th><td>${e(a ?? '')}</td><td>${e(b ?? '')}</td></tr>`).join('')}</tbody></table></div>` : `<p>${empty}</p>`;
  const retained = guided ? retainedPreparation(view.saved) || Boolean(view.campaign) : view.saved.revision > 0;
  const state = view.unsaved ? 'Есть несохранённые изменения' : view.current ? 'План подтверждён' : retained ? 'Черновик сохранён' : 'Черновик ещё не сохранён';
  const fixture = direct?.mode === 'fixture';
  const directReady = Boolean(direct?.enabled && direct.ownChief);
  const directBlocked = Boolean(direct?.state && hasUnresolvedDirect(direct.state));
  const formAction = businessStep ? '/preparation/confirm-profile' : step === 3 ? '/preparation/offer' : directReady && !directBlocked ? '/preparation/create-draft' : '/preparation/confirm';
  const blockedAd = direct?.blockedCampaignId;
  const account = direct?.account;
  const connectionTarget = campaignConnectionHref(campaignId, 'summary');
  const directCreated = view.current && direct?.state?.campaignPlanId === view.plan?.id && direct.state.complete ? direct.state : undefined;
  const actionLabel = guided ? businessStep ? 'Подготовить план' : 'Подтвердить план и проверить готовность'
    : step === 4 ? directReady && !directBlocked ? 'Создать черновик в Директе' : 'Сохранить план' : 'Далее';
  const heading = guided ? businessStep ? 'Что будем продвигать?' : 'Проверьте план рекламы' : view.current ? 'Кампания' : 'Новая кампания';
  return `<a class="campaign-back inline-link" href="${routes.campaigns}">${uiIcon('arrow', 16)} ${guided ? 'Все кампании' : 'Вся реклама'}</a>
  <div class="page-head preparation-title"><div><h1>${heading}</h1>${!guided || !businessStep || p.campaignName ? `<p class="lead">${e(campaignDisplayName(p))}${guided ? '' : ' · подготовка рекламы'}</p>` : ''}
    <p id="save-state" class="save-state" role="status">${state}</p></div></div>
  ${view.legacy ? '<p class="source-note">Сохранённый прежний черновик и его история на месте. Перед новым созданием проверьте понимание и подтвердите план.</p>' : ''}
  ${fixture ? '<p class="source-note">Учебный кабинет. Подбор фраз и создание черновика проходят на тестовых данных.</p>' : ''}
  <div class="notice recovery" id="recovery" hidden><p>В этой вкладке остался несохранённый ввод подготовки.</p><button type="button" id="restore-work" class="secondary">Восстановить ввод</button><button type="button" id="discard-work" class="text-button">Удалить сохранённый ввод</button></div>
  <button type="submit" form="campaign-form" hidden></button>
  ${preparationProgress(uiStep, view.lastReadyStep, guided)}
  ${view.conflict ? `<div class="comparison"><h2>Сравните версии перед заменой</h2><p>В форме ниже сохранён ваш ввод. <a href="${campaignHref}" target="_blank" rel="noopener">Показать текущие сохранённые версии в другой вкладке</a></p>
    ${view.latest ? `<h3>Рабочая подготовка, версия ${view.currentRevision}</h3>${comparisonTable(comparison, 'Сравнение рабочей подготовки', 'Рабочая подготовка совпадает с вашим вводом.')}` : ''}
    <h3>Сохранённое объявление, версия ${view.campaignRevision}</h3>${view.campaign ? comparisonTable(campaignComparison, 'Сравнение сохранённого объявления', 'Поля объявления совпадают с вашим вводом; его версия всё равно проверяется перед заменой.') : '<p>Сохранённого объявления пока нет.</p>'}
    <p>Это отдельные сохранённые версии. Проверьте обе перед заменой. Новое внешнее изменение снова остановит сохранение.</p></div>` : ''}
  <div class="flow-layout preparation-layout" data-stage="${uiStep}"><form id="campaign-form" class="form-panel plan-form" method="post" action="${formAction}" data-resume-action="/preparation/resume"${step === 3 ? ' data-operation="offer"' : ''}
    data-plan="1" data-step="${step}" data-scope="${e(scope)}" data-restore="1" data-restored="${view.restored ? '1' : '0'}" data-saved="${view.acknowledged ? '1' : '0'}" data-ack="${view.acknowledged ? '1' : '0'}" data-dirty="${view.unsaved || view.errors || view.conflict ? '1' : '0'}">
    ${hidden('ad', campaignId)}${hidden('policyHash', policyHash)}${hidden('preparationRevision', view.saved.revision)}${hidden('revision', p.baseCampaignRevision)}${hidden('formStep', step)}
    ${Object.entries(values).filter(([key]) => !visible.includes(key as any)).map(([key, val]) => hidden(key, val)).join('')}
    ${businessStep ? `${guided ? '' : '<h2>О бизнесе</h2>'}
      ${guided ? field('campaignName', 'Название кампании', p.campaignName ?? '', 'input', 'По этому названию вы найдёте кампанию в списке.', true, 70) : ''}
      ${inputField('description', guided ? 'Начните с короткого названия предложения. Условия можно добавить следующей строкой.' : 'Укажите, что можно заказать и на каких условиях.')}
      <div class="field-grid">${inputField('url', guided ? '' : 'Ссылка на страницу записи, заказа или заявки.')}${inputField('region', 'Начните вводить название или откройте список.')}</div>
      ${inputField('goal', 'Выберите цель рекламы или опишите свой вариант.')}
      <button class="text-button example-link" type="submit" formaction="/preparation/example" data-operation="example" formnovalidate>Заполнить примером</button>
      ${guided ? `<details class="business-profile"${profileOpen ? ' open' : ''}><summary>Уточнить предложения для подбора</summary><p class="muted">Добавьте несколько товаров или услуг, синонимы и исключения.</p>`
        : `<section class="business-profile"><div class="section-heading"><h2>Что рекламируем</h2>${profileCurrent ? '<span class="muted small">Проверено</span>' : ''}</div><p class="muted">Укажите товар или услугу, для которой готовите рекламу.</p>`}
        ${freshProposal && !savedProfile ? hidden('profilePresented', 'yes') + '<p class="source-note">ИИ-помощник заполнил список по описанию. Проверьте предложения перед продолжением.</p>' : ''}
        ${renderOfferEditor(profile, errors)}
        ${view.ai || freshProposal ? `<details class="preparation-disclosure"><summary>Подобрать предложения с ИИ-помощником</summary>
          <p>ИИ-помощник выделит товары и услуги из описания.</p>
          ${view.ai ? `${check('aiConsent', 'Разрешаю передать информацию ИИ-помощнику для разбора.')}${post('profile', 'Получить предложения', false)}` : '<p>Разбор сейчас недоступен.</p>'}
          ${freshProposal && savedProfile ? `${hidden('runId', view.run!.id)}${post('use-profile', 'Использовать сохранённое предложение')}` : ''}
        </details>` : ''}
      ${guided ? '</details>' : '</section>'}` : ''}
    ${step === 3 ? renderAdStep(view, direct, inputField, post, check, campaignHref, connectionTarget, searchPreview(p, profile?.offers ?? [])) : ''}
    ${guided && step === 3 ? `<section class="final-card"><h2>Бюджет и площадка</h2>
      <div class="budget-row">${inputField('budget', 'Сумма без НДС, в рублях за весь срок.')}${inputField('period', 'Без автопродления.')}</div>
      ${field('targetCpa', 'Желаемая цена заявки, ₽', p.targetCpa ?? '', 'input', 'Необязательно. Ориентир для оценки результатов кампании.', false, 12)}
      <p>Поиск Яндекса. Директ получит сумму как бюджет стратегии на указанный срок.</p>
    </section>` : ''}
    ${step === 4 ? `<h2>Проверить и запустить</h2>
      <p class="muted">Один экран и одно подтверждение. Показы не включатся: создаётся черновик в Директе.</p>
      <section class="final-card"><div class="card-head"><h3>Что покажем</h3><span class="muted small">${p.selection.phrases.length} ${p.selection.phrases.length === 1 ? 'фраза' : p.selection.phrases.length < 5 ? 'фразы' : 'фраз'}</span></div>
        <div class="review-grid"><div class="ad-preview"><span class="ad-tag">Реклама в поиске</span><p class="ad-title">${e(p.input.title)}</p><p class="ad-body">${e(p.input.adText)}</p><p class="ad-url">${e(p.input.url)}</p></div>
        <dl class="review-facts"><div><dt>Кому</dt><dd>${e(p.input.region)}</dd></div><div><dt>Заявка</dt><dd>${e(p.goal)}</dd></div><div><dt>Фразы</dt><dd>${p.selection.phrases.length} · <button class="text-button" type="submit" formaction="/preparation/back" name="step" value="3" formnovalidate>проверить</button></dd></div><div><dt>Кабинет</dt><dd>${directReady ? 'Яндекс Директ подключён' : 'Директ не подключён'}</dd></div></dl></div>
      </section>
      <section class="final-card"><div class="card-head"><h3>Сколько потратим</h3></div>
        <div class="budget-row">${inputField('budget', 'Сумма на весь срок, не на день.')}${inputField('period', 'Показы прекратятся сами, без продления.')}</div>
        <p class="assure">${uiIcon('budget', 18)}<span>Сумма передаётся как бюджет стратегии Директа на указанный срок.</span></p>
        <div class="account-line"><span class="left"><span class="status-dot${directReady ? ' ok' : ''}"></span>${directReady ? 'Яндекс Директ подключён' : 'Директ не подключён'}</span><a class="link" href="${connectionTarget}">${directReady ? 'Сменить' : 'Подключить'}</a></div>
      </section>
      ${blockedAd ? `<p class="field-error">Сначала сверьте другую кампанию в Директе: <a href="${canonicalCampaignHref(blockedAd)}#direct">открыть</a>.</p>` : ''}
      ${directBlocked ? `<p class="field-error">Есть незавершённая операция в Директе. Сначала сверьте состояние, чтобы не создать дубль. <a href="${campaignHref}#direct">Открыть сверку</a></p>` : ''}
      ${!profileCurrent || p.selection.checkedHash !== selectionHash(p) ? '<p class="field-error">Факты или фразы изменились. Вернитесь к проверке соответствующего шага.</p>' : ''}
      <label class="check final-confirm"><input type="checkbox" name="confirmPlan" value="yes" required>Я проверил текст, ссылку, город и сумму</label>
      <details class="support overview-support"><summary>Подробности и ограничения</summary><div class="support-body">
        <p>Создаётся один черновик кампании и объявления в Яндекс Директе с выключенными показами. Запуск рекламы остаётся за вами.</p>
        <p>Бюджет действует на весь срок и не продлевается. Сумма передаётся как бюджет стратегии Директа; при изменении плана создаётся отдельный черновик.</p>
        <p>Заявка — срабатывание цели в Метрике, а не оплата и не подтверждённый клиент. Часовой пояс отчёта Директа пока не подтверждён; НДС и атрибуция источником не подтверждены.</p>
        ${account ? `<p>Номер кабинета: <code>${e(account)}</code>.</p>` : ''}
      </div></details>` : ''}
    ${view.conflict ? `${hidden('currentRevision', view.currentRevision ?? view.saved.revision)}${hidden('currentCampaignRevision', view.campaignRevision)}${check('replace', 'Я сравнил актуальные данные и хочу сохранить мой вариант вместо них.')}${post('resolve', 'Сохранить мой вариант после сравнения')}` : ''}
    ${step === 3 ? `<div class="phrase-review"><label class="check"><input type="checkbox" name="manualReview" value="yes"${errors.manualReview ? ' aria-invalid="true" aria-describedby="manual-review-error"' : ''}>Я проверил фразы для показа и исключения.</label>${errors.manualReview ? `<p class="field-error" id="manual-review-error">${e(errors.manualReview)}</p>` : ''}</div>` : ''}
    <div class="actions plan-actions">${directCreated ? `<a class="button secondary" href="${campaignHref}#direct">Открыть кампанию</a>` : `<button class="primary" type="submit">${actionLabel}${uiIcon('arrow', 16)}</button>`}${post('save', 'Сохранить черновик', false, ' formnovalidate')}</div>
    <p id="local-recovery-note" class="hint"></p>
  </form><aside class="preparation-aside" aria-label="Сведения о подготовке"${step === 3 && !view.runs.length ? ' hidden' : ''}>
    ${businessStep && !guided ? searchPreview(p, profile?.offers ?? []) : ''}
    ${step === 4 ? `<section class="preparation-guide"><h2>Что произойдёт</h2><ol class="after"><li><span class="n">1</span><span>Директ примет черновик; показы останутся выключены.</span></li><li><span class="n">2</span><span>Кампания появится в «Кампаниях» со статусом «Черновик».</span></li><li><span class="n">3</span><span>Запуск и управление показами — отдельно, в кабинете Директа.</span></li></ol></section>` : ''}
    ${view.runs.length ? `<details><summary>Попытки и сохранённые ответы (${view.runs.length})</summary>${view.runs.map(r => `<article><p>${r.kind === 'wording' ? 'Варианты объявлений' : r.kind === 'profile' ? 'Понимание' : r.kind === 'legacy' ? 'Прежний подбор' : 'Исследование'} · ${r.status === 'running' ? 'Есть незавершённое намерение; повтор остановлен' : r.status === 'stopped' ? 'Получены не все ответы' : 'Ответы сохранены'}</p><ul>${r.attempts.map(a => `<li>${a.kind} — ${a.status === 'succeeded' ? 'Ответ сохранён' : a.status === 'pending' || a.status === 'unknown' ? 'Результат неизвестен, повтор запрещён' : a.status === 'rejected' ? 'Получен неполный или некорректный ответ' : 'Провайдер отказал; проверьте доступ или лимит'}${a.error ? ' · ' + e(a.error) : ''}</li>`).join('')}</ul></article>`).join('')}<a href="/preparation/research.json?ad=${encodeURIComponent(campaignId)}">Скачать свои данные подготовки</a></details>` : ''}
    </aside></div>`;
}
