import { escapeHtml as e } from './html.ts';
import { campaignTabHref, routes } from './routes.ts';
import type { CampaignTab } from './routes.ts';
import { campaignDisplayState, campaignStates, readableDirectName, renderCampaignStatus, type CampaignStatusTone } from './campaign-catalog.ts';
import { campaignDisplayName, type CampaignPreparation } from './campaign-plan.ts';
import { confirmedOffDraft, type DirectState, type DirectView } from './direct.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { pilotStatus } from './pilot.ts';
import { moderationResult } from './campaign-creative-review.ts';

export type CampaignContext = {
  id: string; name: string; tab: CampaignTab; region: string;
  status: string; tone: CampaignStatusTone; source: string;
};
export const campaignTabs = { summary: 'Сводка', ads: 'Объявления', results: 'Результаты', journal: 'Журнал' } as const;

export function campaignHeaderContext(id: string, tab: CampaignTab, preparation: CampaignPreparation, run: DirectState, mode?: DirectView['mode']): CampaignContext {
  const observed = run.launch?.observation;
  const actual = run.snapshot?.campaign;
  const name = actual?.Name && String(actual.Id) === run.steps.campaign.id
    ? readableDirectName(actual.Name, run.planId)
    : campaignDisplayName(preparation, run.draft.description, readableDirectName(run.name, run.planId));
  const region = run.regionName || run.draft.region;
  const source = run.pilot || mode === 'fixture' ? 'Учебные данные' : 'Яндекс Директ';
  const base = { id, name, tab, region, source };
  if (run.pilot) {
    const { phase, pending, issue } = run.pilot;
    const tone = pending || issue ? 'review' : phase === 'running' ? 'live' : phase === 'stopped' ? 'paused' : 'draft';
    return { ...base, status: pending ? 'Требуется сверка' : pilotStatus(phase), tone };
  }
  if (run.launch?.pending || hasUnresolvedDirect(run) || run.error) {
    return { ...base, status: 'Требуется сверка', tone: 'review' };
  }
  const adStatus = moderationResult(run).status;
  if (adStatus === 'REJECTED') return { ...base, status: 'Объявление отклонено', tone: 'review' };
  if (adStatus === 'MODERATION') return { ...base, status: 'На модерации', tone: 'review' };
  const latest = observed && (!run.checkedAt || observed.checkedAt >= run.checkedAt) ? observed : undefined;
  const campaignState = latest?.campaignState ?? actual?.State;
  const campaignStatus = latest?.campaignStatus ?? actual?.Status;
  const state = campaignDisplayState(campaignState, campaignStatus);
  if (campaignState === 'ENDED') return { ...base, status: 'Показы завершены', tone: 'paused' };
  if (state === 'draft' && !confirmedOffDraft(run)) return { ...base, status: 'Требуется сверка', tone: 'review' };
  return { ...base, status: state === 'live' ? 'Показы разрешены' : campaignStates[state].title, tone: state };
}

export function renderCampaignHeader({ name, region, status, tone, source }: CampaignContext) {
  return `<a class="campaign-back inline-link task-link" href="${routes.campaigns}">Все кампании</a>
    <div class="page-head" data-campaign-heading><div><h1>${e(name)}</h1>
      <p class="campaign-context">${renderCampaignStatus(status, tone)}${region ? `<span>${e(region)}</span>` : ''}
        <span>${e(source)}</span></p>
    </div></div>`;
}

export function renderCampaignTabs({ id, tab }: CampaignContext) {
  return `<nav class="guided-tabs" aria-label="Кампания">${(Object.keys(campaignTabs) as CampaignTab[]).map(key =>
      `<a id="campaign-tab-${key}" href="${e(campaignTabHref(id, key))}"${key === tab ? ' aria-current="page"' : ''}>${campaignTabs[key]}</a>`).join('')}</nav>`;
}

export function renderCampaignPanelHeading(tab: CampaignTab, controls = '', period = '') {
  return `<header class="campaign-panel-header${period ? ' campaign-results-header' : controls ? ' campaign-journal-header' : ''}">
    <div class="panel-heading"><h2>${campaignTabs[tab]}</h2></div>${period}${controls}</header>`;
}
