import { escapeHtml as e } from './operations-page.ts';
import type { SearchOffer, SearchProfile } from './phrase-intelligence.ts';
import { uiIcon } from './ui-icons.ts';

type Errors = Record<string, string>;
type Index = number | '__index__';
type RowKind = 'offer' | 'exclude' | 'brand' | 'question';
type ExtraKind = Exclude<RowKind, 'offer'>;

const labels = { offer: 'Предложение', exclude: 'Исключение', brand: 'Бренд', question: 'Вопрос' };
const limits = { offer: 3, exclude: 10, brand: 3, question: 4 };
const position = (index: Index) => typeof index === 'number' ? String(index + 1) : '';
const deliveryHelp = 'Если есть доставка, поставьте галочку и упомяните доставку в описании. ИИ учтёт её при оценке найденных запросов. Без галочки Вордстат ищет по тем же стартовым фразам, а ИИ опирается на описание бизнеса и текст объявления.';
const aliasesHelp = 'Например, если предложение называется «Букеты», можно указать «букеты цветов». ИИ учитывает такие названия при оценке найденных запросов. Если поле пустое, ИИ опирается на основное название и сведения из описания бизнеса.';
const seedsHelp = 'Стартовые запросы для Вордстата, например «доставка букетов». Если поле пустое, сервис начнёт подбор с названия предложения.';
const extraHelp: Record<ExtraKind, string> = {
  brand: 'Укажите свой бренд, например «Лепесток», и упомяните его в описании бизнеса. Это помогает распознавать запросы о вашем бренде. Если список пуст, подбор продолжится по вашим предложениям.',
  exclude: 'Укажите, что хотите исключить, например «искусственные цветы», если продаёте только живые. Сервис отсеивает такие запросы и добавляет исключение в минус-слова плана. Если список пуст, действуют обычные правила отбора и минус-слова из плана.',
  question: 'Запишите, что ещё нужно уточнить, например «Доставляем ли букеты за город?». ИИ получает вопрос как контекст при оценке фраз. Ответ уточняете вы. Если список пуст, подбор продолжится по сведениям о предложении.',
};

function withHelp(caption: string, label: string, helpId: string, help: string) {
  return `<div class="offer-field-caption">${caption}
    <button type="button" class="offer-help-trigger" data-offer-help aria-label="Подсказка к полю «${e(label)}»" aria-describedby="${helpId}">${uiIcon('help', 16)}</button>
    <span class="offer-help-tooltip" id="${helpId}" role="tooltip" hidden>${e(help)}</span>
  </div>`;
}

function input(name: string, label: string, value: string, placeholder: string, max: number, errors: Errors, mode: 'single' | 'multiline' | 'row' = 'single', help?: string) {
  const id = 'plan-' + name, error = errors[name];
  const helpId = 'plan-help-' + name;
  const describedBy = [error && `${id}-error`, help && helpId].filter(Boolean).join(' ');
  const attributes = `id="${id}" name="${name}" maxlength="${max}" placeholder="${e(placeholder)}"${error ? ' aria-invalid="true"' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}`;
  const caption = `<label for="${id}"${mode === 'row' ? ' class="sr-only" data-row-title' : ''}>${label}</label>`;
  const heading = help ? withHelp(caption, label, helpId, help) : caption;
  return `<div class="field">${heading}${mode === 'multiline' ? `<textarea ${attributes} rows="2">${e(value)}</textarea>` : `<input ${attributes} value="${e(value)}">`}${error ? `<p class="field-error" id="${id}-error">${e(error)}</p>` : ''}</div>`;
}
const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${e(value)}">`;

function remove(kind: RowKind, index: Index) {
  return `<button class="editor-remove" type="submit" formaction="/preparation/edit-rows" name="rowAction" value="remove-${kind}-${index}" formnovalidate data-remove-row aria-label="Удалить: ${labels[kind]} ${position(index)}">Удалить</button>`;
}

function offerRow(index: Index, offer: SearchOffer | undefined, errors: Errors) {
  const deliveryLabel = 'Предлагаем доставку';
  const deliveryHelpId = 'plan-help-delivery' + index;
  const delivery = `<label class="check"><input type="checkbox" name="delivery${index}" value="yes" aria-describedby="${deliveryHelpId}"${offer?.delivery ? ' checked' : ''}>${deliveryLabel}</label>`;
  return `<section class="editor-row offer-row" data-editor-row>
    <div class="editor-row-heading"><h3 data-row-title>Предложение ${position(index)}</h3>${remove('offer', index)}</div>
    <input type="hidden" name="offerId${index}" value="${e(offer?.id ?? '')}">
    <div class="offer-fields">${input('offer' + index, 'Название', offer?.name ?? '', 'Название товара или услуги', 70, errors)}
    <div class="field"><label for="plan-kind${index}">Тип предложения</label><select id="plan-kind${index}" name="kind${index}">${[['service', 'Услуга'], ['product', 'Товар'], ['training', 'Обучение']].map(([v,l]) => `<option value="${v}"${offer?.kind === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${hidden('evidence' + index, offer?.evidence ?? '')}
    <details class="preparation-disclosure"><summary>Доставка и слова для поиска</summary>
      ${withHelp(delivery, deliveryLabel, deliveryHelpId, deliveryHelp)}
      ${input('aliases' + index, 'Другие названия', offer?.aliases.join('\n') ?? '', 'До двух названий, каждое с новой строки', 150, errors, 'multiline', aliasesHelp)}
      ${input('seeds' + index, 'По каким фразам искать', offer?.seeds.join('\n') ?? '', 'До двух коротких фраз, каждая с новой строки', 220, errors, 'multiline', seedsHelp)}
    </details></section>`;
}

function extraRow(kind: ExtraKind, index: Index, value: string, evidence: string, errors: Errors) {
  const fields = {
    brand: { placeholder: 'Например, МастерСервис', max: 60 },
    exclude: { placeholder: 'Например, установка', max: 100 },
    question: { placeholder: 'Например, работаем ли мы по выходным', max: 180 },
  };
  const { placeholder, max } = fields[kind];
  return `<div class="extra-row" data-editor-row>
    ${input(kind + index, `${labels[kind]} ${position(index)}`, value, placeholder, max, errors, 'row')}
    ${kind === 'exclude' ? hidden('excludeEvidence' + index, evidence) : ''}
    ${remove(kind, index)}
  </div>`;
}

function collection(kind: RowKind, rows: string[], template: string) {
  return `<div data-editor-list="${kind}" data-limit="${limits[kind]}" data-label="${labels[kind]}">${rows.join('')}</div><template data-row-template="${kind}">${template}</template>`;
}

function add(kind: RowKind, count: number) {
  const action = 'Добавить ' + labels[kind].toLocaleLowerCase('ru');
  return `<button type="submit" class="secondary editor-add" formaction="/preparation/edit-rows" name="rowAction" value="add-${kind}" data-add-row="${kind}" aria-label="${action}" title="Максимум позиций: ${limits[kind]}" formnovalidate${count >= limits[kind] ? ' disabled' : ''}>${uiIcon('plus', 16)}${kind === 'offer' ? labels[kind] : action}</button>`;
}

function extraGroup(kind: ExtraKind, heading: string, rows: string[]) {
  const headingId = 'plan-extra-label-' + kind;
  const helpId = 'plan-extra-help-' + kind;
  return `<div class="editor-extra-group" role="group" aria-labelledby="${headingId}" aria-describedby="${helpId}">
    ${withHelp(`<span id="${headingId}" class="editor-extra-label">${heading}</span>`, heading, helpId, extraHelp[kind])}
    ${collection(kind, rows, extraRow(kind, '__index__', '', '', {}))}
    ${add(kind, rows.length)}
  </div>`;
}

export function renderOfferEditor(profile: SearchProfile | undefined, errors: Errors) {
  const offers = profile?.offers.length ? profile.offers : [undefined];
  const brands = profile?.ownBrands ?? [], exclusions = profile?.exclusions ?? [], questions = profile?.uncertainty ?? [];
  const count = brands.length + exclusions.length + questions.length;
  return `<div class="offer-editor" data-offer-editor><input type="hidden" name="profileEditor" value="yes"><input type="hidden" name="editorVersion" value="3">
    ${collection('offer', offers.map((o,i) => offerRow(i, o, errors)), offerRow('__index__', undefined, {}))}
    ${add('offer', offers.length)}
    <details class="preparation-disclosure editor-extras"${count ? ' open' : ''}><summary>Бренды, исключения и вопросы</summary>
      <p class="hint">Заполните текущее поле, чтобы добавить ещё одно того же типа.</p>
      <div class="editor-extra-groups">
        ${extraGroup('brand', 'Бренды', brands.map((s,i) => extraRow('brand', i, s, '', errors)))}
        ${extraGroup('exclude', 'Исключения из поиска', exclusions.map((x,i) => extraRow('exclude', i, x.phrase, x.evidence, errors)))}
        ${extraGroup('question', 'Вопросы', questions.map((s,i) => extraRow('question', i, s, '', errors)))}
      </div>
    </details></div>`;
}
