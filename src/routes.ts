// Canonical cabinet URLs. Old addresses are kept alive by 308 redirects in server.ts.
export const routes = {
  overview: '/',
  campaigns: '/campaigns',
  prepare: '/prepare',
  pilot: '/pilot',
  results: '/results',
  history: '/history',
  diagnostics: '/diagnostics',
  connection: '/connections/direct',
  howItWorks: '/how-it-works',
} as const;

// Four sections of the cabinet. The automation screen is intentionally absent:
// it stays a hidden, working URL until its content moves to "Результаты".
export const navigation = [
  ['overview', routes.overview, 'Обзор'],
  ['campaign', routes.campaigns, 'Кампании'],
  ['analytics', routes.results, 'Результаты'],
  ['history', routes.history, 'История'],
] as const;

export function campaignHref(id: string) {
  return `${routes.campaigns}?ad=${encodeURIComponent(id)}`;
}
export function campaignPlanHref(id: string) {
  return campaignHref(id) + '&edit=1';
}
export function prepareHref(id: string) {
  return `${routes.prepare}?ad=${encodeURIComponent(id)}`;
}

export function pilotHref(id: string) {
  return `${routes.pilot}?ad=${encodeURIComponent(id)}`;
}

export type ConnectionOrigin = CampaignTab | 'overview';

export function connectionOrigin(value?: string | null): ConnectionOrigin | undefined {
  return value === 'summary' || value === 'ads' || value === 'results' || value === 'journal' || value === 'overview' ? value : undefined;
}

export function connectionHref(id?: string, from?: ConnectionOrigin, runId?: string) {
  if (!id) return routes.connection;
  const params = new URLSearchParams({ ad: id });
  if (from) params.set('from', from);
  if (from === 'results' && runId) params.set('run', runId);
  return routes.connection + '?' + params;
}

export function connectionReturn(id?: string, from?: ConnectionOrigin, guided = true, runId?: string) {
  if (from === 'overview') return routes.overview;
  if (from === 'results' && runId) return resultsHref(runId);
  if (from === 'results' && !guided) return routes.results;
  if (!id) return routes.campaigns;
  return from ? campaignTabHref(id, from) : guided ? prepareHref(id) : campaignHref(id);
}

export function resultsHref(runId: string) {
  return `${routes.results}?run=${encodeURIComponent(runId)}`;
}

export type CampaignTab = 'summary' | 'ads' | 'results' | 'journal';

export function campaignTabHref(id: string, tab: CampaignTab, query: Record<string, string> = {}) {
  const path = tab === 'results' ? routes.results : tab === 'journal' ? routes.history : routes.prepare;
  const params = new URLSearchParams({ ad: id, ...query });
  if (tab === 'ads') params.set('tab', 'ads');
  return `${path}?${params}`;
}

// Old section URLs. Query string is preserved by the redirect, so ?ad=, ?run=
// and the date filters keep working.
export const legacySectionPaths: ReadonlyMap<string, string> = new Map([
  ['/campaign', routes.campaigns],
  ['/analytics', routes.results],
]);
