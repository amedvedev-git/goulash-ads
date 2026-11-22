import test from 'node:test';
import assert from 'node:assert/strict';
import { newStrategyPlan, confirmStrategy, researchRequests, gatherCandidates, applyMeanings, runResearch } from '../src/phrase-strategy.ts';
import { validateProfile, validateMeanings, createPhraseIntelligence } from '../src/phrase-intelligence.ts';
import { qualityCases, referenceMeanings } from './fixtures/phrase-quality.ts';
const regions = [{ GeoRegionId: '54', GeoRegionName: 'Екатеринбург' }, { GeoRegionId: '6', GeoRegionName: 'Калуга' }, { GeoRegionId: '213', GeoRegionName: 'Москва' }];

test('стратегия: отдельные товары/синонимы, ограниченные запросы и проверяемое происхождение профиля', () => {
  for (const sample of qualityCases) {
    validateProfile(sample.profile, sample.draft.description);
    const requests = researchRequests(sample.profile);
    assert.ok(requests.length <= 6 && requests.length >= sample.profile.offers.length);
    assert.equal(new Set(requests.map(r => r.seed)).size, requests.length);
  }
  assert.deepEqual(researchRequests(qualityCases[0].profile).map(r => r.seed), ['доставка суши', 'доставка роллов', 'заказать суши', 'заказать роллы']);
  const bad = structuredClone(qualityCases[0].profile); bad.offers[0].evidence = 'Не было такого в описании';
  assert.throws(() => validateProfile(bad, qualityCases[0].draft.description));
  const noDelivery = structuredClone(qualityCases[1].profile); noDelivery.offers[0].delivery = true;
  assert.throws(() => validateProfile(noDelivery, qualityCases[1].draft.description));
});
for (const sample of qualityCases) test(`политика на независимой эталонной разметке: ${sample.name}`, () => {
  const plan = newStrategyPlan(sample.draft, 1); plan.regionId = '54'; plan.strategy.profile = structuredClone(sample.profile);
  confirmStrategy(plan, sample.profile.offers.map(o => o.id));
  plan.strategy.requests[0] = { ...plan.strategy.requests[0], phase: 'complete', at: '2026-11-11T12:00:00Z',
    results: sample.queries.map((q, i) => ({ phrase: q.phrase, count: String(10000 - i) })) };
  plan.strategy.candidates = gatherCandidates(plan, sample.draft, regions);
  const candidates = plan.strategy.candidates.filter(c => c.decision !== 'exclude').map(c => ({ id: c.id, phrase: c.phrase }));
  const judgments = referenceMeanings(sample, candidates);
  validateMeanings({ judgments }, sample.profile, candidates); applyMeanings(plan, judgments);
  assert.deepEqual(plan.candidates.filter(c => c.selected).map(c => c.phrase), sample.queries.filter(q => q.expected === 'include').map(q => q.phrase));
  for (const q of sample.queries.filter(q => q.critical)) assert.equal(plan.candidates.find(c => c.phrase === q.phrase)?.selected, false);
  assert.equal(plan.strategy.coverage[0].checked, 1);
});
test('источники: дубли и разная частота не суммируются; редкое направление не теряется', () => {
  const sample = qualityCases[0], plan = newStrategyPlan(sample.draft, 1); plan.regionId = '54'; plan.strategy.profile = sample.profile;
  confirmStrategy(plan, ['sushi', 'rolls']);
  plan.strategy.requests[0] = { ...plan.strategy.requests[0], phase: 'complete', at: '2026-11-11T12:00:00Z', results: [{ phrase: 'заказать суши с доставкой', count: '1000' }] };
  plan.strategy.requests[1] = { ...plan.strategy.requests[1], phase: 'complete', at: '2026-11-11T12:01:00Z', results: [{ phrase: 'заказать суши с доставкой', count: '999' }, { phrase: 'купить роллы екатеринбург', count: '1' }] };
  plan.strategy.candidates = gatherCandidates(plan, sample.draft, regions);
  assert.equal(plan.strategy.candidates.length, 2); assert.equal(plan.strategy.candidates[0].count, null); assert.equal(plan.strategy.candidates[0].evidence.length, 2);
  applyMeanings(plan, referenceMeanings(sample, plan.strategy.candidates));
  assert.equal(plan.strategy.candidates.find(c => c.count === '1')?.selected, true);
});
test('платные вызовы: намерение до запроса, сбой/рестарт без повтора, частичное покрытие и отказ модели', async () => {
  const sample = qualityCases[0], plan = newStrategyPlan(sample.draft, 1); plan.regionId = '54'; plan.strategy.profile = sample.profile;
  confirmStrategy(plan, ['sushi', 'rolls']); let calls = 0, saved = '';
  const save = () => { saved = JSON.stringify(plan); };
  await runResearch(plan, sample.draft, regions, async () => {
    calls++; assert.match(saved, /"phase":"pending"/); if (calls === 2) throw new Error('secret'); return [{ phrase: sample.queries[0].phrase, count: '10' }];
  }, { profile: async () => sample.profile, judge: async () => { throw new Error('secret'); } }, save, true);
  assert.equal(plan.strategy.phase, 'complete'); assert.equal(plan.strategy.coverage[1].checked, 1); assert.equal(plan.candidates.filter(c => c.selected).length, 0);
  const paid = calls; await runResearch(JSON.parse(saved), sample.draft, regions, async () => { calls++; return []; }, undefined, save, true); assert.equal(calls, paid);
  const interrupted = structuredClone(plan); interrupted.strategy.phase = 'research'; interrupted.strategy.requests[0].phase = 'pending';
  await assert.rejects(runResearch(interrupted, sample.draft, regions, async () => { calls++; return []; }, undefined, () => {}, true), /неизвестный/);
  assert.equal(calls, paid);
});
test('границы модели: неизвестные ID, неполная оценка, подмена профиля и токены не проходят', async () => {
  const sample = qualityCases[0], candidates = [{ id: 'c1', phrase: 'заказать суши' }];
  assert.throws(() => validateMeanings({ judgments: [] }, sample.profile, candidates));
  assert.throws(() => validateMeanings({ judgments: [{ ...referenceMeanings(sample, [{ id: 'c1', phrase: sample.queries[0].phrase }])[0], id: 'foreign' }] }, sample.profile, candidates));
  let calls = 0;
  const provider = createPhraseIntelligence('never-log', async (_url, init) => {
    calls++; const body = JSON.parse(String(init!.body)); assert.equal(body.model, 'deepseek-flash'); assert.equal(body.response_format.type, 'json_object');
    return new Response('secret', { status: 429 });
  });
  await assert.rejects(provider.profile(sample.draft), /HTTP 429/); assert.equal(calls, 1);
});
test('UX01-I1: отсутствие метаданных причины не превращается в вымышленный лимит', () => {
  const sample=qualityCases[0],plan=newStrategyPlan(sample.draft,1);plan.regionId='54';plan.strategy.profile=sample.profile;confirmStrategy(plan,['sushi']);
  plan.strategy.requests[0]={...plan.strategy.requests[0],phase:'complete',at:new Date().toISOString(),results:[{phrase:'заказать суши',count:'10'}]};
  plan.strategy.candidates=gatherCandidates(plan,sample.draft,regions);applyMeanings(plan,[]);
  assert.match(plan.candidates[0].reason,/Смысл не оценён/);assert.doesNotMatch(plan.candidates[0].reason,/лимит|неполное|не запускалась/);
});
