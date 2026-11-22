import { groundedIssues, groundedFacts, policyHash, geoQualifierOverrides } from './phrase-policy.ts';
import { geographyGuard } from './geo-policy.ts';
import type { GroundedResponse } from './phrase-policy.ts';
import { randomUUID } from 'node:crypto';
import type { CampaignDraft } from './campaign.ts';
import { DirectError } from './direct-api.ts';
import { foreignGeography, phraseKey, validPhrase, phraseLimit, wordstatNotice } from './search-phrases.ts';
import type { PhraseCandidate, PhrasePlan, GeoRegion, Wordstat } from './search-phrases.ts';
import type { Meaning, SearchProfile, PhraseIntelligence } from './phrase-intelligence.ts';

export const strategyVersion = 3;
export type SearchRequest = { seed: string; offerId: string; phase: 'ready' | 'pending' | 'complete' | 'failed'; at?: string;
  results?: { phrase: string; count: string }[] };
export type StrategyCandidate = PhraseCandidate & { id: string; offerId?: string; decision: 'include' | 'review' | 'exclude';
  assessment?: { model?: unknown; policyReasons: string[]; geoQualifierOverrides?: {text:string;regionId:string;name:string;reason:string}[]; geo?: unknown }; intent?: Meaning['intent']; evidence: { seed: string; count: string; at: string }[] };
export type SearchStrategy = { version: number; phase: 'profile-pending' | 'profile-review' | 'confirmed' | 'research' | 'judge-pending' | 'complete' | 'failed';
  profile?: SearchProfile; proposal?: SearchProfile; requests: SearchRequest[]; candidates: StrategyCandidate[]; confirmed: boolean; profileSource: 'ai' | 'manual';
  judgeSource?: 'ai' | 'unavailable'; evaluated?: number; coverage: { offerId: string; checked: number; planned: number; selected: number }[]; note?: string };
export type StrategyPlan = PhrasePlan & { strategy: SearchStrategy };
const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const words = (s: string) => norm(s).replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter(Boolean);
const simple = (s: string) => s.length > 4 ? s.replace(/(ами|ями|ого|ему|ов|ев|ой|ый|ая|ое|ые|ки|ка|ку|ке|ы|а|я|у|ю|е|и)$/u, '') : s;
const contains = (query: string, phrase: string) => { const q = words(query).map(simple), p = words(phrase).map(simple); return p.length > 0 && p.every(w => q.includes(w)); };

export function researchRequests(profile: SearchProfile): SearchRequest[] {
  const primary: SearchRequest[] = [], secondary: SearchRequest[] = [];
  const seen = new Set<string>();
  for (const o of profile.offers) {
    for (const [i, candidate] of o.seeds.entries()) {
      const phrase = norm(candidate);
      if (!validPhrase(phrase) || seen.has(phraseKey(phrase))) continue;
      seen.add(phraseKey(phrase)); (i === 0 ? primary : secondary).push({ seed: phrase, offerId: o.id, phase: 'ready' });
    }
  }
  return [...primary, ...secondary].slice(0, 6);
}
export function newStrategyPlan(draft: CampaignDraft, revision: number): StrategyPlan {
  return { id: randomUUID(), revision, offer: draft.title, region: draft.region, regionId: '', at: new Date().toISOString(), source: 'business',
    wordstatAttempted: false, notice: 'Сначала подтвердите предложения бизнеса. Частоты ещё не запрашивались.', candidates: [],
    selectionVersion: strategyVersion, strategy: { version: strategyVersion, phase: 'profile-pending', requests: [], candidates: [], confirmed: false,
      profileSource: 'ai', coverage: [] } };
}
export function confirmStrategy(plan: StrategyPlan, offerIds: string[]) {
  const profile = plan.strategy.profile ?? plan.strategy.proposal;
  if (!profile || !offerIds.length || new Set(offerIds).size !== offerIds.length || offerIds.some(id => !profile.offers.some(o => o.id === id))) throw new DirectError('Выберите подтверждённые товары или услуги.');
  plan.strategy.profile = { ...profile, offers: profile.offers.filter(o => offerIds.includes(o.id)) };
  const previous = plan.strategy.requests;
  plan.strategy.requests = researchRequests(plan.strategy.profile).map(r => previous.find(old => old.seed === r.seed && old.offerId === r.offerId) ?? r);
  if (!plan.strategy.requests.length) throw new DirectError('Не получилось подготовить корректные направления поиска. Уточните предложение.');
  plan.strategy.confirmed = true; plan.strategy.phase = 'confirmed';
  plan.strategy.coverage = plan.strategy.profile.offers.map(o => ({ offerId: o.id, checked: 0, planned: plan.strategy.requests.filter(r => r.offerId === o.id).length, selected: 0 }));
}
export function gatherCandidates(plan: StrategyPlan, draft: CampaignDraft, regions: GeoRegion[]): StrategyCandidate[] {
  const pool = new Map<string, StrategyCandidate>();
  // Round-robin prevents one popular direction from consuming the whole judgment budget.
  const complete = plan.strategy.requests.filter(r => r.phase === 'complete');
  for (let index = 0; index < 100; index++) for (const request of complete) {
    const row = request.results?.[index]; if (!row) continue;
    const phrase = norm(row.phrase); if (!validPhrase(phrase)) continue;
    const key = phraseKey(phrase); const existing = pool.get(key);
    const evidence = { seed: request.seed, count: row.count, at: request.at! };
    if (existing) { existing.evidence.push(evidence); continue; }
    const otherRegion = foreignGeography(phrase, plan.regionId, regions);
    const excluded = plan.strategy.profile!.exclusions.find(p => contains(phrase, p.phrase));
    pool.set(key, { id: `c${pool.size + 1}`, phrase, source: 'wordstat', count: row.count, selected: false, decision: otherRegion || excluded ? 'exclude' : 'review',
      reason: otherRegion ? `Другая география: ${otherRegion}.` : excluded ? `Исключено бизнесом: ${excluded.phrase}.` : 'Ожидает оценки смысла.', evidence: [evidence] });
  }
  const result = [...pool.values()];
  for (const c of result) if (c.evidence.some(e => e.count !== c.evidence[0].count)) { c.count = null; c.reason += ' Источники вернули разные частоты; единое число не вычислено.'; }
  return result;
}
export type MeaningEvaluation = { status: 'not-started'; reason?: 'incomplete-research' } | { status: 'unavailable' }
  | { status: 'complete'; submittedIds: string[]; limit?: number };
export function unassessedMeaningReason(id: string, evaluation?: MeaningEvaluation) {
  if (evaluation?.status === 'not-started') return evaluation.reason === 'incomplete-research'
    ? 'Смысловая оценка не запускалась: исследование спроса неполное. Проверьте фразу вручную.'
    : 'Смысловая оценка не запускалась. Проверьте фразу вручную.';
  if (evaluation?.status === 'unavailable') return 'Проверенная смысловая оценка не получена. Проверьте фразу вручную.';
  if (evaluation?.status === 'complete' && !evaluation.submittedIds.includes(id)) {
    if (evaluation.limit && evaluation.submittedIds.length === evaluation.limit)
      return `Смысл не оценён: достигнут лимит ${evaluation.limit} запросов одной проверки. Требуется ручной просмотр.`;
    return 'Эта фраза не вошла в выполненную смысловую оценку. Проверьте её вручную.';
  }
  return 'Смысл не оценён. Требуется ручной просмотр.';
}
export function applyMeanings(plan: StrategyPlan, rows: Meaning[], evaluation?: MeaningEvaluation) {
  const profile = plan.strategy.profile!;
  for (const c of plan.strategy.candidates) {
    c.selected = false;
    if (c.decision === 'exclude') continue;
    const r = rows.find(r => r.id === c.id);
    if (!r) { c.reason = unassessedMeaningReason(c.id, evaluation); continue; }
    c.offerId = r.offerId ?? undefined; c.intent = r.intent;
    const offer = profile.offers.find(o => o.id === r.offerId);
    const ownBrandVerified = r.brand !== 'own' || profile.ownBrands.some(b => contains(c.phrase, b));
    const productBrandVerified = r.brand !== 'product' || Boolean(r.brandTerm && norm(offer?.evidence ?? '').includes(norm(r.brandTerm)));
    const unwanted = r.intent === 'employment' ||
      (/(^| )(курсы|обучение)( |$)/u.test(c.phrase) && offer?.kind !== 'training');
    const unsupported = [/бесплатн\p{L}*/u, /круглосуточн\p{L}*|24 часа/u].some(p => p.test(c.phrase) && !p.test(norm(offer?.evidence ?? '')));
    c.decision = unwanted || unsupported || r.brand === 'competitor' || r.decision === 'exclude' ? 'exclude'
      : r.decision === 'include' && r.adRelevant && ownBrandVerified && productBrandVerified && r.brand !== 'uncertain' &&
        ['purchase', 'comparison', 'navigation'].includes(r.intent) && offer ? 'include' : 'review';
    c.reason = unwanted ? 'Запрос относится к работе или неподтверждённому обучению.' : unsupported ? 'Условие услуги не подтверждено.'
      : r.brand === 'competitor' ? 'Запрос о чужом бренде.' : r.reason;
  }
  const rank = (c: StrategyCandidate) => c.intent === 'purchase' ? 3 : c.intent === 'navigation' ? 2 : 1;
  const queues = profile.offers.map(o => plan.strategy.candidates.filter(c => c.offerId === o.id && c.decision === 'include' && c.count !== null && BigInt(c.count) > 0n)
    .sort((a, b) => rank(b) - rank(a) || (BigInt(b.count!) > BigInt(a.count!) ? 1 : BigInt(b.count!) < BigInt(a.count!) ? -1 : 0)));
  let picked = 0;
  for (let i = 0; picked < phraseLimit && queues.some(q => i < q.length); i++) for (const q of queues) if (q[i] && picked < phraseLimit) { q[i].selected = true; picked++; }
  for (const c of plan.strategy.candidates) if (c.decision === 'include' && !c.selected) c.reason += c.count === '0' ? ' Источник вернул ноль; автоматически не выбрано.' : ' Не выбрано автоматически: нет сопоставимой частоты или достигнут лимит.';
  plan.strategy.coverage = profile.offers.map(o => ({ offerId: o.id, planned: plan.strategy.requests.filter(r => r.offerId === o.id).length,
    checked: plan.strategy.requests.filter(r => r.offerId === o.id && r.phase === 'complete').length,
    selected: plan.strategy.candidates.filter(c => c.selected && c.offerId === o.id).length }));
  if (plan.strategy.requests.some(r => r.phase !== 'complete')) plan.strategy.note = `${plan.strategy.note ?? ''} Исследование неполное: часть направлений не получила ответ.`.trim();
  plan.candidates = plan.strategy.candidates;
}

export function judgmentCandidates(plan: StrategyPlan) {
  const priority = (phrase: string) => /(^| )(купить|заказать|цена|стоимость|записаться|вызвать|доставка|мастер)( |$)/u.test(phrase) ? 2
    : /(^| )(как|рецепт|вакансии|скачать)( |$)/u.test(phrase) ? 0 : 1;
  const eligible = plan.strategy.candidates.filter(c => c.decision !== 'exclude');
  const queues = plan.strategy.profile!.offers.map(o => eligible.filter(c => c.evidence.some(e => plan.strategy.requests.some(r => r.seed === e.seed && r.offerId === o.id)))
    .sort((a, b) => priority(b.phrase) - priority(a.phrase)));
  const result: { id: string; phrase: string }[] = [], seen = new Set<string>();
  for (let i = 0; result.length < 120 && queues.some(q => i < q.length); i++) for (const q of queues) {
    const c = q[i]; if (c && !seen.has(c.id) && result.length < 120) { seen.add(c.id); result.push({ id: c.id, phrase: c.phrase }); }
  }
  return result;
}

export async function runResearch(plan: StrategyPlan, draft: CampaignDraft, regions: GeoRegion[], wordstat: Wordstat | undefined,
  intelligence: PhraseIntelligence | undefined, save: () => void, allowJudge: boolean) {
  if (!plan.strategy.confirmed || !plan.strategy.profile) throw new DirectError('Сначала подтвердите предложения бизнеса.');
  if (plan.strategy.phase === 'complete') return;
  if (plan.strategy.phase === 'judge-pending' || plan.strategy.requests.some(r => r.phase === 'pending')) throw new DirectError('Предыдущий платный запрос имеет неизвестный результат. Автоматического повтора нет; сохранённые ответы доступны.');
  plan.strategy.phase = 'research'; save();
  for (const r of plan.strategy.requests) {
    if (r.phase !== 'ready') continue;
    if (!wordstat) { r.phase = 'failed'; continue; }
    r.phase = 'pending'; r.at = new Date().toISOString(); plan.wordstatAttempted = true; save();
    try { r.results = await wordstat(r.seed, plan.regionId); r.at = new Date().toISOString(); r.phase = 'complete'; }
    catch (error) {
      r.phase = 'failed';
      if (error instanceof DirectError && /HTTP (401|403|429)/.test(error.message)) {
        plan.strategy.note = 'Доступ или лимит Wordstat остановил исследование. Остальные платные запросы не отправлены.'; save(); break;
      }
    }
    save();
  }
  plan.strategy.candidates = gatherCandidates(plan, draft, regions);
  const toJudge = judgmentCandidates(plan);
  let judgments: Meaning[] = [];
  let evaluation: MeaningEvaluation = { status: 'not-started' };
  if (intelligence && allowJudge && toJudge.length) {
    plan.strategy.phase = 'judge-pending'; save();
    try { judgments = await intelligence.judge(draft, plan.strategy.profile, toJudge); plan.strategy.judgeSource = 'ai'; evaluation = { status: 'complete', submittedIds: toJudge.map(c => c.id), limit: 120 }; }
    catch { evaluation = { status: 'unavailable' }; plan.strategy.judgeSource = 'unavailable'; plan.strategy.note = 'Смысловая оценка не получена. Автоматический выбор остановлен; платный вызов не повторяется.'; }
  } else { plan.strategy.judgeSource = 'unavailable'; plan.strategy.note = 'Смысловой отбор не выполнен. Доступен ручной просмотр без автоматических рекомендаций.'; }
  applyMeanings(plan, judgments, evaluation);
  plan.strategy.evaluated = judgments.length;
  plan.source = plan.strategy.requests.some(r => r.phase === 'complete') ? 'wordstat' : 'business';
  plan.notice = `${wordstatNotice} Частоты пересекающихся запросов не складываются. Покрытие направлений показано отдельно; частотность не является прогнозом прибыли.`;
  plan.strategy.phase = 'complete'; save();
}

export function applyGrounded(plan: StrategyPlan, draft: CampaignDraft, regions: GeoRegion[], response?: GroundedResponse) {
  const rows = response?.judgments ?? [], facts = groundedFacts(draft, plan.strategy.profile!);
  // Final geography is part of eligibility, before the shared v3 ranking and coverage.
  const geography = new Map(plan.strategy.candidates.map(candidate => [candidate.id, geographyGuard(candidate.phrase, plan.regionId, regions)]));
  for (const candidate of plan.strategy.candidates) {
    const geo = geography.get(candidate.id)!;
    if (geo.status === 'foreign') { candidate.decision = 'exclude'; candidate.selected = false; candidate.reason = geo.reason!; }
  }
  // Reuse v3 hard rules and ranking, without manufacturing historical model fields in stored evidence.
  const meanings: Meaning[] = rows.map(row => {
    const geo = geography.get(row.id)!;
    const issues = groundedIssues(row, facts, {geo,targetId:plan.regionId});
    if (geo?.status === 'ambiguous') issues.push(geo.reason!);
    // Preserve manual review when this unsupported role alone would strengthen it to exclusion.
    const competitor = row.qualifiers.some(q => q.kind === 'brand' && q.role === 'competitor' &&
      !(row.decision === 'review' && ['unsupported','uncertain'].includes(q.basis) && q.factRefs.length === 0));
    return { ...row, decision: row.decision === 'exclude' ? 'exclude' : issues.length ? 'review' : row.decision,
      brand: competitor ? 'competitor' : 'none', brandTerm: null };
  });
  applyMeanings(plan, meanings);
  for (const candidate of plan.strategy.candidates) {
    const row = rows.find(row => row.id === candidate.id), geo = geography.get(candidate.id)!;
    const issues = row ? groundedIssues(row, facts, {geo,targetId:plan.regionId}) : ['Оценка нового контракта отсутствует; фраза не отправлялась или ответ не получен.'];
    if (geo.status === 'ambiguous') issues.push(geo.reason!);
    candidate.assessment = { model: row, policyReasons: issues, geo, geoQualifierOverrides: row ? geoQualifierOverrides(row,geo,plan.regionId) : [] };
    if (candidate.decision !== 'exclude' && issues.length) { candidate.decision = 'review'; candidate.selected = false; candidate.reason = issues.join(' '); }
  }
  plan.strategy.evaluated = rows.length;
  (plan as any).policyHash = policyHash;
  plan.candidates = plan.strategy.candidates;
}
