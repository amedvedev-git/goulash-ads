// This ES module is also served directly to the browser. Keep it valid JavaScript.
const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const headlineLimit = 56;

export function campaignHeadline(name) {
  return clean(name).slice(0, headlineLimit).replace(/[\uD800-\uDBFF]$/u, '').trimEnd();
}

export function suggestWording(description, offers) {
  const business = clean(description);
  const names = offers.map(offer => clean(offer.name)).filter(Boolean);
  const eligible = names.filter(name => name.length <= headlineLimit);
  // Keep the owner's spelling and the most complete offer that fits the headline.
  const distinct = eligible.filter((name, index) => {
    const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeName = new RegExp('(?<![\\p{L}\\p{N}\\p{M}])' + literal + '(?![\\p{L}\\p{N}\\p{M}])', 'iu');
    return !eligible.some((other, i) => (other.length > name.length || (other.length === name.length && i < index)) && wholeName.test(other));
  });
  let title = '';
  for (const name of distinct) {
    const candidate = title ? title + ', ' + name : name;
    if (candidate.length <= headlineLimit) title = candidate;
  }
  if (!title && names.length) title = 'Товары и услуги';

  // Use whole source sentences. Cutting a qualification can turn a condition into a promise.
  const sentences = business.split(/(?<=[.!?…])\s+/u).filter(sentence => sentence && sentence.length <= 81);
  const matching = offers.flatMap(offer => {
    const quote = clean(offer.evidence);
    const sentence = quote && sentences.find(part => part.includes(quote));
    return sentence ? [sentence] : [];
  });
  const useDescription = !names.length || offers.some(offer => {
    const quote = clean(offer.evidence);
    return quote && business.includes(quote);
  });
  const adText = useDescription && business.length <= 81 ? business
    : matching[0] || (useDescription ? sentences[0] : '') || 'Узнайте о предложении и условиях на сайте.';
  return { title, adText };
}

export function currentOffers(description, offers, sameDescription) {
  const business = clean(description);
  return sameDescription ? offers : offers.filter(offer => clean(offer.evidence) && business.includes(clean(offer.evidence)));
}

export function previewContext(input, goal) {
  const budget = /^\d+$/u.test(input.budget) ? Number(input.budget).toLocaleString('ru-RU') + ' ₽' : '';
  return { region: input.region, goal, spending: budget && (input.period ? budget + ' за ' + input.period + ' дней' : budget) };
}

function connectPreview(form, preview) {
  const read = name => form.elements.namedItem(name)?.value.trim() || '';
  const step = Number(form.dataset.step);
  const guided = preview.hasAttribute('data-guided-preview');
  const stored = JSON.parse(preview.dataset.offers);
  const manual = JSON.parse(preview.dataset.manual);
  const panel = preview.closest('.search-preview');
  function paint() {
    const description = read('description');
    const offers = step === 2 ? Array.from(form.querySelectorAll('[data-editor-list="offer"] > [data-editor-row]'), (_, index) => ({
      name: read('offer' + index), evidence: read('evidence' + index),
    })) : stored;
    const trusted = preview.dataset.trusted === 'yes' && description === preview.dataset.description;
    const matching = currentOffers(description, offers, trusted);
    const edited = step === 2 ? offers.filter(offer => matching.includes(offer) || !stored.some(item => item.name === offer.name)) : matching;
    const generated = suggestWording(description, edited);
    const example = !guided && step < 3 && !description && !read('url') && !offers.some(offer => offer.name) && !read('title') && !read('adText');
    const content = { url: read('url'), ...generated };
    for (const key of ['title','adText']) {
      if (step >= 3 || manual.includes(key)) content[key] = read(key);
    }
    if (guided && step < 3) {
      content.title = campaignHeadline(read('campaignName'));
      if (!description && !manual.includes('adText')) content.adText = '';
    }
    preview.querySelectorAll('[data-preview]').forEach(node => {
      const value = content[node.dataset.preview];
      node.textContent = value || (example ? node.dataset.sample : node.dataset.empty);
      node.hidden = guided && !value;
    });
    const empty = guided ? !content.title && !content.adText && !content.url : example;
    panel.querySelector('[data-preview-example]').hidden = !empty;
    panel.querySelector('[data-preview-own]').hidden = empty;
    const context = previewContext({ region:read('region'), budget:read('budget'), period:read('period') }, read('goal'));
    panel.querySelectorAll('[data-preview-context]').forEach(node => {
      const value = context[node.dataset.previewContext];
      node.textContent = value;
      node.parentElement.hidden = !value;
    });
  }
  form.addEventListener('input', paint);
  form.addEventListener('change', paint);
  window.addEventListener('pageshow', paint);
  paint();
}

if (typeof document !== 'undefined') {
  const form = document.querySelector('#campaign-form'), preview = document.querySelector('[data-search-preview]');
  if (form && preview) connectPreview(form, preview);
}
