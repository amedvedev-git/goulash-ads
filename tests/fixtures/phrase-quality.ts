import type { CampaignDraft } from '../../src/campaign.ts';
import type { SearchProfile, Meaning } from '../../src/phrase-intelligence.ts';
export type QualityCase = { name: string; draft: CampaignDraft; profile: SearchProfile; queries: { phrase: string; expected: 'include' | 'exclude' | 'review'; offerId: string | null; critical?: boolean }[] };
const draft = (description: string, title: string): CampaignDraft => ({ description, title, adText: 'Предложения и условия на сайте.', region: 'Екатеринбург', url: 'https://example.com/', budget: '7000', period: '7' });
const base = { ownBrands: [] as string[], exclusions: [], uncertainty: [] as string[] };
export const qualityCases: QualityCase[] = [
  { name: 'Доставка суши и роллов', draft: draft('Кафе «Рис и ролл» доставляет суши и роллы. Пиццу не доставляем.', 'Доставка суши и роллов'),
    profile: { ...base, ownBrands: ['Рис и ролл'], exclusions: [{ phrase: 'Пиццу', evidence: 'Пиццу не доставляем.' }], offers: [
      { id: 'sushi', name: 'суши', seeds: ['доставка суши', 'заказать суши'], aliases: [], kind: 'product', delivery: true, evidence: 'доставляет суши и роллы' },
      { id: 'rolls', name: 'роллы', seeds: ['доставка роллов', 'заказать роллы'], aliases: [], kind: 'product', delivery: true, evidence: 'доставляет суши и роллы' }] }, queries: [
      { phrase: 'заказать суши с доставкой', expected: 'include', offerId: 'sushi' },
      { phrase: 'купить роллы екатеринбург', expected: 'include', offerId: 'rolls' },
      { phrase: 'доставка роллов цена', expected: 'include', offerId: 'rolls' },
      { phrase: 'суши рис и ролл заказать', expected: 'include', offerId: 'sushi' },
      { phrase: 'суши ебидоеби доставка', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'yasuka доставка суши калуга', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'доставка пиццы и суши', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'работа поваром суши вакансии', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'роллы рецепт своими руками', expected: 'exclude', offerId: null },
      { phrase: 'сеты роллов с доставкой', expected: 'review', offerId: 'rolls' },
    ] },
  { name: 'Ремонт холодильников', draft: draft('Мастерская ремонтирует бытовые холодильники. Обучение и продажу техники не предлагаем.', 'Ремонт холодильников'),
    profile: { ...base, offers: [{ id: 'repair', name: 'ремонт холодильников', seeds: ['ремонт холодильников', 'вызов мастера по холодильникам'], aliases: ['починка холодильников'], kind: 'service', delivery: false, evidence: 'ремонтирует бытовые холодильники' }] }, queries: [
      { phrase: 'починить холодильник екатеринбург', expected: 'include', offerId: 'repair' },
      { phrase: 'мастер по холодильникам вызвать', expected: 'include', offerId: 'repair' },
      { phrase: 'ремонт холодильника стоимость', expected: 'include', offerId: 'repair' },
      { phrase: 'холодильник не охлаждает нужен мастер', expected: 'include', offerId: 'repair' },
      { phrase: 'купить холодильник', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'курсы ремонта холодильников', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'работа мастером по холодильникам', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'ремонт холодильников москва', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'как отремонтировать холодильник самому', expected: 'exclude', offerId: null },
      { phrase: 'ремонт холодильника bosch', expected: 'review', offerId: 'repair' },
    ] },
  { name: 'Маникюр как услуга', draft: draft('Салон оказывает услуги маникюра с гелевым покрытием по записи.', 'Маникюр с покрытием'),
    profile: { ...base, offers: [{ id: 'nails', name: 'маникюр с покрытием', seeds: ['маникюр с покрытием', 'записаться на маникюр'], aliases: ['ногтевой сервис'], kind: 'service', delivery: false, evidence: 'услуги маникюра с гелевым покрытием' }] }, queries: [
      { phrase: 'записаться на маникюр', expected: 'include', offerId: 'nails' },
      { phrase: 'маникюр гель лак цена', expected: 'include', offerId: 'nails' },
      { phrase: 'сделать ногти у мастера', expected: 'include', offerId: 'nails' },
      { phrase: 'салон маникюра екатеринбург', expected: 'include', offerId: 'nails' },
      { phrase: 'курсы маникюра', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'купить материалы для маникюра', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'мастер маникюра вакансии', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'маникюр бесплатно', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'как снять гель лак дома', expected: 'exclude', offerId: null },
      { phrase: 'детский маникюр запись', expected: 'review', offerId: 'nails' },
    ] },
  { name: 'Маникюр как обучение', draft: draft('Школа обучает начинающих мастеров маникюру на очных платных курсах.', 'Курсы маникюра для начинающих'),
    profile: { ...base, offers: [{ id: 'course', name: 'курсы маникюра', seeds: ['курсы маникюра', 'обучение маникюру'], aliases: ['обучение маникюру'], kind: 'training', delivery: false, evidence: 'обучает начинающих мастеров маникюру на очных платных курсах' }] }, queries: [
      { phrase: 'курсы маникюра екатеринбург', expected: 'include', offerId: 'course' },
      { phrase: 'обучение ногтевому сервису с нуля', expected: 'include', offerId: 'course' },
      { phrase: 'научиться маникюру на курсах', expected: 'include', offerId: 'course' },
      { phrase: 'школа маникюра стоимость обучения', expected: 'include', offerId: 'course' },
      { phrase: 'сделать маникюр у мастера', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'купить гель лак', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'курсы маникюра бесплатно', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'курсы маникюра калуга', expected: 'exclude', offerId: null, critical: true },
      { phrase: 'маникюр обучающее видео бесплатно', expected: 'exclude', offerId: null },
      { phrase: 'онлайн курс маникюра', expected: 'review', offerId: 'course' },
    ] },
];
export const referenceMeanings = (sample: QualityCase, candidates: { id: string; phrase: string }[]): Meaning[] => candidates.map(c => {
  const truth = sample.queries.find(q => q.phrase === c.phrase)!;
  return { id: c.id, offerId: truth?.offerId ?? null, decision: truth?.expected ?? 'review', intent: truth?.expected === 'include' ? 'purchase' : 'unknown',
    brand: /ебидоеби|yasuka/.test(c.phrase) ? 'competitor' : /рис и ролл/.test(c.phrase) ? 'own' : /bosch/.test(c.phrase) ? 'product' : 'none',
    brandTerm: /ебидоеби/.test(c.phrase) ? 'ебидоеби' : /yasuka/.test(c.phrase) ? 'yasuka' : /рис и ролл/.test(c.phrase) ? 'рис и ролл' : /bosch/.test(c.phrase) ? 'bosch' : null,
    adRelevant: truth?.expected === 'include', reason: 'Эталонная разметка сценария, не ответ модели.' };
});
