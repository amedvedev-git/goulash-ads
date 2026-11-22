import type { SearchProfile, MeaningInput } from '../../src/phrase-intelligence.ts';
import type { GroundedResponse } from '../../src/phrase-policy.ts';
// Explicit synthetic provider data only. This helper is never imported by production src/**.
export function fixtureGrounded(profile: SearchProfile, candidates: MeaningInput[]): GroundedResponse {
  return { schemaVersion:'judge-v3-grounded-1', judgments:candidates.map(c=>({ id:c.id,offerId:profile.offers[0].id,
    decision:'include',intent:'purchase',adRelevant:true,reason:'Подставная смысловая оценка; не результат модели.',
    support:{basis:'equivalent',factRefs:[`${profile.offers[0].id}:offer`]},qualifiers:[] })) };
}
