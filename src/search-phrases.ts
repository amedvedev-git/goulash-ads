import { geographyGuard } from './geo-policy.ts';
import { randomUUID } from 'node:crypto';
import type { CampaignDraft } from './campaign.ts';
import { DirectError } from './direct-api.ts';
import type { SearchStrategy } from './phrase-strategy.ts';

export type PhraseCandidate = { phrase: string; source: 'business' | 'wordstat'; count: string | null; selected: boolean; reason: string };
export type PhrasePlan = { id: string; revision: number; offer: string; region: string; regionId: string; at: string;
  source: 'business' | 'wordstat'; wordstatAttempted: boolean; notice: string; candidates: PhraseCandidate[];
  policyHash?: string; selectionVersion?: number; selectionCheckedAt?: string; strategy?: SearchStrategy; manualSelectionConfirmed?: boolean };
export type GeoRegion = { GeoRegionId: unknown; GeoRegionName: string; ParentId?: unknown; GeoRegionType?: unknown };
export const selectionVersion = 3;
export type Wordstat = (phrase: string, regionId: string) => Promise<{ phrase: string; count: string }[]>;
export const phraseLimit = 30;
export const wordstatNotice = 'По документации на 11.11.2026 API Wordstat не содержит статистику после 07.10.2026. Точный период ответа GetTop не возвращает; свежесть не подтверждена.';
const normalize = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
export const phraseKey = (s: string) => normalize(s).split(' ').sort().join(' ');
function validPhraseWords(phrase: string) {
  const words = phrase.split(' ');
  return /^[\p{L}\p{N} ]+$/u.test(phrase) && words.length <= 7 && words.every(word => word.length <= 35);
}
export function validPhrase(s: string) {
  return s.length <= 100 && validPhraseWords(s);
}
export function readPhrases(values: string[], max = phraseLimit) {
  const list = values.map(normalize);
  if (!list.length || list.length > max || list.some(s => !validPhrase(s)) || new Set(list.map(phraseKey)).size !== list.length) {
    throw new DirectError(`Выберите от 1 до ${max} разных фраз: до 7 слов и 100 символов, без операторов и специальных знаков.`);
  }
  return list;
}
export function readNegativePhrases(values: string[]) {
  const list = values.map(normalize);
  if (list.length > 20 || new Set(list.map(phraseKey)).size !== list.length) {
    throw new DirectError('Укажите до 20 разных минус-фраз.');
  }
  if (list.some(phrase => !validPhraseWords(phrase))) {
    throw new DirectError('В минус-фразе допускается до 7 слов, до 35 символов в каждом. Используйте буквы, цифры и пробелы.');
  }
  if (list.reduce((length, phrase) => length + phrase.replaceAll(' ', '').length, 0) > 4096) {
    throw new DirectError('Общая длина минус-фраз для группы в Директе — до 4096 символов без пробелов.');
  }
  return list;
}
export function suggestedOffer(draft: CampaignDraft) {
  // The confirmed headline is a starting point, never a claim that its topic is already understood.
  return normalize(draft.title.split(/\s+от\s+|[«»".!?:]/u)[0].replace(/[^\p{L}\p{N} ]/gu, ' ')).slice(0, 100);
}
const stop = new Set(['и', 'в', 'на', 'для', 'с', 'по', 'от', 'из', 'к', 'у', 'за', 'о', 'об', 'или', 'а', 'без', 'услуги', 'услуг', 'доставка', 'купить', 'заказать', 'цена', 'цены', 'стоимость']);
const stem = (word: string) => word.length < 5 ? word : word.replace(/(ами|ями|ого|ему|ыми|ими|ов|ев|ам|ям|ах|ях|ой|ый|ий|ая|ое|ые|ки|ка|ку|ке|ы|а|я|у|ю|е|и)$/u, '');
const tokens = (s: string) => normalize(s).split(' ').filter(w => !stop.has(w));
const information = [/(^| )как( |$)/u, /рецепт\p{L}*/u, /ваканси\p{L}*/u, /реферат\p{L}*/u,
  /(^| )скачать( |$)/u, /(^| )(фото|картинки)( |$)/u, /(^| )(обучение|курсы)( |$)/u, /самостоятельно|своими руками/u];
const queryWords = new Set(('купить заказать заказ заказа заказы цена цены стоимость доставка доставкой доставку доставке доставок онлайн ' + [...stop].join(' ')).split(' ').map(stem));
const wordStems = (s: string) => normalize(s).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).map(stem);

export function foreignGeography(phrase: string, targetId: string, regions: GeoRegion[]) {
  const result = geographyGuard(phrase, targetId, regions);
  return result.status === 'foreign' ? result.matches[0].name : undefined;
}

// Compatibility review for old manual lists. Automatic research uses phrase-strategy.ts.
function selectCandidates(draft: CampaignDraft, offer: string, regionId: string, input: Pick<PhraseCandidate, 'phrase' | 'source' | 'count'>[], regions: GeoRegion[]) {
  const anchors = tokens(offer).map(stem);
  if (!anchors.length) throw new DirectError('Уточните предложение: укажите сам товар или услугу, например «ремонт холодильников», а не только «услуги».');
  const parts = offer.split(' и ').map(p => tokens(p).map(stem));
  const alternatives = parts.length > 1 && parts.every(p => p.length === 1);
  const candidates: PhraseCandidate[] = [];
  const keys = new Set<string>();
  const allowed = new Set([...wordStems(offer), ...wordStems(draft.region), ...queryWords]);
  const add = (phrase: string, source: PhraseCandidate['source'], count: string | null) => {
    phrase = normalize(phrase);
    if (!validPhrase(phrase) || keys.has(phraseKey(phrase))) return;
    keys.add(phraseKey(phrase));
    const words = tokens(phrase).map(stem);
    const related = alternatives ? parts.some(part => words.includes(part[0])) : anchors.every(anchor => words.includes(anchor));
    // A general blacklist must not exclude the advertiser's actual product, e.g. paid training or recipe books.
    const unwanted = information.some(pattern => pattern.test(phrase) && !pattern.test(offer));
    const unsupported = [/бесплатн\p{L}*/u, /круглосуточн\p{L}*|24 часа/u].some(pattern => pattern.test(phrase) && !pattern.test(normalize(draft.description + ' ' + offer)));
    const geography = foreignGeography(phrase, regionId, regions);
    const unknown = phrase.split(' ').filter(w => !allowed.has(stem(w)));
    const zero = count === '0';
    const selected = related && !unwanted && !unsupported && !geography && !unknown.length && !zero && candidates.filter(c => c.selected).length < phraseLimit;
    const reason = geography ? `Другая география: ${geography}. Выбран регион ${draft.region}.`
      : !related ? 'Другая тема — проверьте вручную.'
      : unwanted ? 'Возможно информационный запрос или поиск работы — не выбран автоматически.'
      : unsupported ? 'Условие услуги не подтверждено описанием — не выбрано автоматически.'
      : unknown.length ? `Не подтверждены товар, бренд или уточнение: ${[...new Set(unknown)].join(', ')}. Проверьте вручную.`
      : zero ? 'Источник вернул ноль запросов; это не доказательство отсутствия спроса.'
      : selected ? 'По теме вашего предложения.' : 'Вне первых 30 подходящих фраз — можно заменить выбранные.';
    candidates.push({ phrase, source, count, selected, reason });
  };
  for (const item of input) add(item.phrase, item.source, item.count);
  add(offer, 'business', null);
  add(`${offer} ${draft.region}`, 'business', null);
  return candidates.slice(0, 102);
}

export function refilterPhrasePlan(draft: CampaignDraft, plan: PhrasePlan, regions: GeoRegion[]): PhrasePlan {
  return { ...plan, id: randomUUID(), selectionVersion, selectionCheckedAt: new Date().toISOString(),
    candidates: selectCandidates(draft, plan.offer, plan.regionId, plan.candidates, regions) };
}

export async function buildPhrasePlan(draft: CampaignDraft, revision: number, offerText: string, regionId: string, wordstat?: Wordstat, regions: GeoRegion[] = []): Promise<PhrasePlan> {
  const offer = readPhrases([offerText], 1)[0];
  const input: Pick<PhraseCandidate, 'phrase' | 'source' | 'count'>[] = [];
  let notice = 'Предварительные фразы из подтверждённого предложения. Wordstat не подключён; частотность и спрос не проверены.';
  let source: PhrasePlan['source'] = 'business';
  if (wordstat) {
    try {
      const rows = await wordstat(offer, regionId);
      source = 'wordstat'; notice = `${wordstatNotice} Частоты вложенных фраз нельзя складывать в общий охват.`;
      // Relevance comes before frequency. The provider's ordering is not a profitability score.
      rows.sort((a, b) => Number(BigInt(b.count) > BigInt(a.count)) - Number(BigInt(b.count) < BigInt(a.count)));
      for (const row of rows) input.push({ ...row, source: 'wordstat' });
      if (!rows.length) notice += ' Источник вернул пустой список; добавлены только предварительные фразы из предложения.';
    } catch {
      notice = 'Wordstat не ответил или вернул неполные данные. Показаны предварительные фразы из предложения без частотности; повторный платный запрос автоматически не выполняется.';
    }
  }
  const candidates = selectCandidates(draft, offer, regionId, input, regions);
  return { id: randomUUID(), revision, offer, region: draft.region, regionId, at: new Date().toISOString(), source, wordstatAttempted: Boolean(wordstat), notice, candidates, selectionVersion };
}

export function createWordstat(apiKey: string, folderId: string, request: typeof fetch = fetch): Wordstat {
  if (!apiKey.trim() || !/^[a-zA-Z0-9_-]{1,100}$/.test(folderId)) throw new Error('Некорректная конфигурация Wordstat');
  return async (phrase, regionId) => {
    if (!validPhrase(phrase) || !/^[1-9]\d{0,9}$/.test(regionId)) throw new DirectError('Некорректные параметры Wordstat.');
    const response = await request('https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phrase, regions: [regionId], devices: ['DEVICE_ALL'], numPhrases: 100, folderId }),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new DirectError(`Wordstat недоступен (HTTP ${response.status}).`); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 262144) throw new DirectError('Ответ Wordstat слишком большой.');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(data.results) || data.results.length > 100 || data.results.some((r: any) =>
      typeof r?.phrase !== 'string' || r.phrase.length > 4096 || typeof r.count !== 'string' || !/^\d{1,18}$/.test(r.count))) {
      throw new DirectError('Wordstat вернул неполный ответ.');
    }
    // Associations are adjacent interests, not evidence that the advertiser offers those products.
    return data.results;
  };
}
