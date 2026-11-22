import type { DirectState } from './direct.ts';

// complete describes object creation; later writes can still have an unknown outcome.
export function hasUnresolvedDirect(state?: DirectState): boolean {
  if (!state) return false;
  if (state.events.some(event => ['pending','unknown'].includes(event.phase)) ||
      Object.values(state.steps).some(step => step.phase === 'pending') ||
      state.keywordEntries?.some(entry => entry.phase === 'pending')) return true;
  const latest = new Map((state.attempts ?? []).map(attempt => [attempt.stepKey, attempt]));
  return [...latest.values()].some(attempt => ['pending','unknown'].includes(attempt.outcome));
}
