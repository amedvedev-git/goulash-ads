import type { CampaignPreparation } from './campaign-plan.ts';
import { descriptionHash, manualWordingFields } from './campaign-plan.ts';
import type { SearchOffer } from './phrase-intelligence.ts';
import { campaignHeadline, currentOffers, previewContext, suggestWording } from './ad-wording.ts';
import { escapeHtml as e } from './operations-page.ts';
import { uiIcon } from './ui-icons.ts';
import { sentenceText } from './ui-copy.ts';

export function preparationProgress(step: number, lastReadyStep: number, guided = false, form = 'campaign-form') {
  const stages: [string, number][] = guided
    ? [['Предложение', 1], ['План рекламы', 3], ['Черновик в Директе', 4]]
    : [['О бизнесе', 1], ['Объявление', 3], ['Проверить и запустить', 4]];
  const ready = lastReadyStep >= 4 ? 3 : lastReadyStep >= 3 ? 2 : 1;
  return `<ol class="plan-progress" aria-label="Этапы подготовки">${stages.map(([label, target], index) => {
    const number = index + 1;
    const content = `<span class="stage-number" aria-hidden="true">${number}</span><span class="stage-label">${label}</span>`;
    const forward = number > step && number <= ready;
    const stage = number < step || forward
      ? `<button class="stage" type="submit" form="${form}" name="step" value="${target}" formaction="/preparation/back" formnovalidate${forward ? ' data-forward-step' : ''}>${content}</button>`
      : `<span class="stage">${content}</span>`;
    return `<li${number === step ? ' aria-current="step"' : ''}>${stage}${number < stages.length ? uiIcon('arrow', 17) : ''}</li>`;
  }).join('')}</ol>`;
}

export function searchPreview(p: CampaignPreparation, offers: SearchOffer[]) {
  const { input, step } = p, early = step < 3;
  const manual = manualWordingFields(p);
  const trusted = !p.profile || p.profile.descriptionHash === descriptionHash(input.description);
  const facts = offers.map(({ name, evidence }) => ({ name, evidence }));
  const generated = suggestWording(input.description, currentOffers(input.description, facts, trusted));
  const example = !p.guided && early && !input.title && !input.adText && !input.description && !offers.some(o => o.name) && !input.url;
  const title = early && p.guided ? campaignHeadline(p.campaignName) : early && !manual.includes('title') ? generated.title : input.title;
  const adText = early && !manual.includes('adText')
    ? p.guided && !input.description.trim() ? '' : generated.adText
    : input.adText;
  const empty = p.guided ? !title && !adText && !input.url : example;
  const context = previewContext(input, p.goal);
  const contextField = (key: keyof typeof context, label: string) =>
    `<div${context[key] ? '' : ' hidden'}><dt>${label}</dt><dd data-preview-context="${key}">${e(context[key])}</dd></div>`;
  const field = (key: string, className: string, value: string, sample: string, placeholder = '') => {
    if (p.guided) return `<p class="${className}" data-preview="${key}" data-empty=""${value ? '' : ' hidden'}>${e(value)}</p>`;
    return `<p class="${className}" data-preview="${key}" data-sample="${e(sample)}" data-empty="${e(placeholder)}">${e(value || (example ? sample : placeholder))}</p>`;
  };
  return `<section class="preparation-guide search-preview" aria-label="Предпросмотр объявления">
    <h2>${uiIcon('search', 19)} Предпросмотр объявления</h2>
    <div class="ad-preview" id="${input.title ? 'campaign-preview' : 'plan-placeholder'}" data-search-preview${p.guided ? ' data-guided-preview' : ''} data-offers="${e(JSON.stringify(facts))}" data-manual="${e(JSON.stringify(manual))}" data-description="${e(input.description)}" data-trusted="${trusted ? 'yes' : 'no'}">
      <span class="ad-tag">Реклама в поиске</span>
      ${field('url', 'ad-url', input.url, 'example.ru', 'Адрес вашей страницы')}
      ${field('title', 'ad-title', title, 'Ремонт холодильников', early ? 'Ваш товар или услуга' : 'Введите заголовок')}
      ${field('adText', 'ad-body', adText, 'Ремонтируем холодильники на дому. Оставьте заявку на выезд мастера.')}
    </div>
    <p class="preview-foot"><span data-preview-example${empty ? '' : ' hidden'}>${p.guided ? 'Заполните поля, чтобы увидеть объявление.' : sentenceText('Пример оформления. Введите описание, чтобы увидеть свой вариант.')}</span><span data-preview-own${empty ? ' hidden' : ''}>${early && p.guided ? 'На шаге «План рекламы» можно отдельно изменить заголовок и текст.' : early ? sentenceText(manual.length ? 'Ручная правка сохранена. На шаге «Объявление» можно взять текст из нового описания.' : 'Предварительный вид. Текст можно изменить на шаге «Объявление».') : 'Оформление зависит от места показа.'}</span></p>
    <dl class="preview-context" aria-label="Условия размещения">${contextField('region', 'Где показывать')}${contextField('goal', 'Цель')}</dl>
    <script type="module" src="/assets/ad-wording.js"></script>
  </section>`;
}
