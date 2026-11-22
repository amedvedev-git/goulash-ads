import type { CampaignOptimization } from './campaign-optimization.ts';
import type { openDatabase } from './database.ts';
import { DirectError } from './direct-api.ts';
import type { DirectState } from './direct.ts';
import type { OptimizationExplanationInput, OptimizationFactId, PhraseIntelligence } from './phrase-intelligence.ts';

export type OptimizationExplanation = {
  status: 'pending' | 'ready' | 'fallback';
  startedAt: string;
  finishedAt?: string;
  order?: OptimizationFactId[];
};

type Decision = CampaignOptimization['decisions'][number];
const factIds: readonly OptimizationFactId[] = ['finding', 'cost', 'target', 'report'];
const price = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });

function comparison(entry: Decision): { verdict: OptimizationExplanationInput['verdict']; cpaKop: number; targetKop: number } | undefined {
  const { cpaKop, targetKop } = entry;
  if (entry.kind === 'assessment' && entry.report && cpaKop !== undefined && targetKop !== undefined
      && Number.isSafeInteger(cpaKop) && cpaKop >= 0 && Number.isSafeInteger(targetKop) && targetKop > 0) {
    return { verdict: cpaKop > targetKop ? 'above_target' : 'within_target', cpaKop, targetKop };
  }
}

function validateOrder(value: unknown): OptimizationFactId[] | undefined {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'order')) return;
  const order = (value as { order?: unknown }).order;
  if (Array.isArray(order) && order.length === factIds.length && new Set(order).size === factIds.length
      && order.every((id): id is OptimizationFactId => factIds.includes(id))) return order;
}

export function optimizationExplanationFacts(entry: Decision): string[] {
  const result = comparison(entry);
  if (!result) return [];
  const facts: Record<OptimizationFactId, string> = {
    finding: result.verdict === 'above_target' ? 'Цена достижения цели выше ориентира.' : 'Цена достижения цели в пределах ориентира.',
    cost: `Стоимость достижения цели по отчёту Метрики — ${price.format(result.cpaKop / 100)}.`,
    target: `Ориентир в подтверждённом плане — ${price.format(result.targetKop / 100)}.`,
    report: `Сохранённый отчёт: ${entry.report}.`,
  };
  const order = entry.explanation?.status === 'ready' ? validateOrder({ order: entry.explanation.order }) : undefined;
  return (order ?? factIds).map(id => facts[id]);
}

export function createOptimizationExplanation(db: ReturnType<typeof openDatabase>, intelligence: PhraseIntelligence | undefined,
  researchAllowed: (owner: string) => boolean) {
  const available = (owner: string) => Boolean(intelligence?.explainOptimization && researchAllowed(owner));

  function save(owner: string, run: DirectState, entry: Decision, explanation: OptimizationExplanation) {
    run.optimization!.decisions = run.optimization!.decisions.map(item => item === entry ? { ...item, explanation } : item);
    db.saveDirect(owner, run);
  }

  return {
    available,
    async explain(owner: string, workspace: string, form: URLSearchParams) {
      if (!available(owner)) throw new DirectError('Объяснение с ИИ для вашего кабинета недоступно.');
      const one = (name: string) => form.getAll(name).length === 1 ? form.get(name) : undefined;
      if (one('confirm') !== 'yes') throw new DirectError('Подтвердите один запрос к ИИ.');
      const run = db.readCampaignWorkspace(owner, workspace) && db.readCampaignDirectRuns(owner, workspace)
        .findLast(item => item.guidedDraft && item.complete && !item.pilot);
      if (!run || run.planId !== one('run')) throw new DirectError('Кампания изменилась. Откройте её журнал заново.');
      const find = (state: DirectState) => state.optimization?.decisions.find(item => item.key === one('decision') && item.at === one('at'));
      const startedAt = new Date().toISOString();
      let input: OptimizationExplanationInput;
      const unlock = db.lockDirect(run.account);
      try {
        const current = db.readDirect(owner, run.planId);
        const entry = current && find(current);
        const result = entry && comparison(entry);
        if (!current || !entry || !result) throw new DirectError('Откройте сохранённую оценку цены цели.');
        if (entry.explanation) return;
        if (String(current.storageRevision) !== one('revision')) throw new DirectError('Журнал изменился. Обновите страницу.');
        input = { verdict: result.verdict, factIds: [...factIds] };
        save(owner, current, entry, { status: 'pending', startedAt });
      } finally { unlock(); }

      let order: OptimizationFactId[] | undefined;
      try { if (available(owner)) order = validateOrder(await intelligence!.explainOptimization!(input)); }
      catch { /* The outcome of a sent request may be unknown. Its recorded attempt blocks repeats. */ }
      const finishedAt = new Date().toISOString();
      // A worker can append an entry while the provider is responding. Merge into the latest revision.
      const current = db.readDirect(owner, run.planId);
      const entry = current && find(current);
      if (current && entry?.explanation?.status === 'pending' && entry.explanation.startedAt === startedAt) {
        save(owner, current, entry, { status: order ? 'ready' : 'fallback', startedAt, finishedAt, order });
      }
    },
  };
}
