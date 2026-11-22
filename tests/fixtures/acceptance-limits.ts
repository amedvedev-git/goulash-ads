import type {openDatabase} from '../../src/database.ts';
import { DirectError } from '../../src/direct-api.ts';
import type {PhraseIntelligence} from '../../src/phrase-intelligence.ts';
import type {Wordstat} from '../../src/search-phrases.ts';

export function limitAcceptance(db: ReturnType<typeof openDatabase>, ai: PhraseIntelligence, wordstat: Wordstat) {
  function check(kind: 'profile' | 'wordstat' | 'judge', limit: number) {
    // The application has already committed the current intent before entering an adapter.
    const count = db.readRuns('local').flatMap(r => r.attempts).filter(a => a.kind === kind).length;
    if (count > limit) throw Object.assign(new DirectError('Локальный предел приёмки исчерпан. Провайдер не вызван.'), { notSent: true });
  }
  return { ai: {
    groundedJudge: ai.groundedJudge ? async (draft,profile,candidates,meta)=>{check('judge',1);return ai.groundedJudge!(draft,profile,candidates,meta);} : undefined,
    profile: async (draft, meta) => { check('profile', 1); return ai.profile(draft, meta); },
    judge: async (draft, profile, candidates, meta) => { check('judge', 1); return ai.judge(draft, profile, candidates, meta); },
  } as PhraseIntelligence,
  wordstat: async (phrase: string, regionId: string) => { check('wordstat', 2); return wordstat(phrase, regionId); } };
}
