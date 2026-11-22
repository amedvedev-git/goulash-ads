import type { CampaignCatalogItem } from './campaign-catalog.ts';
import { campaignDisplayState } from './campaign-catalog.ts';
import { campaignDisplayName, planCurrent, retainedPreparation } from './campaign-plan.ts';
import type { openDatabase } from './database.ts';
import { hasUnresolvedDirect } from './direct-pending.ts';
import { lastReadyStep } from './preparation.ts';
import { campaignWorkspaceRun, confirmedOffDraft } from './direct.ts';
import type { DirectState } from './direct.ts';
import { pilotStatus } from './pilot.ts';

function confirmed(run?: DirectState) {
  return run && (run.pilot || run.launch?.observation || !run.guidedDraft ? run.complete : confirmedOffDraft(run));
}

export function campaignCatalogItems(db: ReturnType<typeof openDatabase>, owner: string): CampaignCatalogItem[] {
  const workspaces = db.readCampaignWorkspaces(owner);
  const runs = db.readDirectRuns(owner);
  if (runs.some(run => !run.campaignId || run.campaignId === 'default') && !workspaces.some(workspace => workspace.id === 'default')) {
    workspaces.push({ id: 'default', createdAt: '' });
  }
  return workspaces.flatMap(({ id, createdAt }) => {
    const saved = db.readPreparation(owner, id);
    const campaign = db.readCampaign(owner, id);
    const plan = db.readPlan(owner, saved?.value.confirmedPlanId, id);
    const draft = saved?.value.input ?? campaign?.draft;
    const linked = runs.filter(run => (run.campaignId ?? 'default') === id);
    // A workspace created by "Создать кампанию" and left without input is not a campaign yet.
    // The guided workspace starts with revision 1. Older explicit saves have a later revision.
    if (!retainedPreparation(saved) && !campaign && !plan && !linked.length) return [];
    const directRuns = linked.filter(run => run.guidedDraft || Object.values(run.steps).some(step => step.phase !== 'ready')).map(run => ({
      id: run.planId, name: run.name, account: run.account,
      campaignId: run.steps.campaign.phase === 'confirmed' ? run.steps.campaign.id : undefined,
      review: run.pilot ? Boolean(run.pilot.pending || run.pilot.issue)
        : hasUnresolvedDirect(run) || Boolean(run.error) || Boolean(run.guidedDraft && !confirmed(run)) ||
          Boolean(run.launch?.pending || ['MODERATION', 'REJECTED'].includes(run.launch?.observation?.adStatus ?? '')),
      complete: Boolean(confirmed(run)),
      region: run.regionName,
      budget: run.budget?.amountRub ?? run.weekly,
      period: run.budget?.periodDays,
      dates: run.budget && { from: run.budget.startDate, to: run.budget.endDate },
      checkedAt: run.pilot?.checkedAt ?? run.launch?.observation?.checkedAt ?? run.checkedAt,
      state: run.pilot ? run.pilot.pending ? undefined : ['running', 'stopping'].includes(run.pilot.phase) ? 'ON' : 'OFF'
        : run.launch?.observation?.campaignState ?? run.snapshot?.campaign?.State,
      moderation: run.pilot ? run.pilot.phase === 'draft' ? 'DRAFT' : 'ACCEPTED'
        : run.launch?.observation?.campaignStatus ?? run.snapshot?.campaign?.Status,
      changed: Boolean(draft && (Number(draft.budget) !== Number(run.draft.budget) || draft.period !== run.draft.period || draft.region !== run.draft.region)),
    }));
    const needsReview = directRuns.some(run => run.review);
    const latestRun = linked.at(-1);
    const pilot = latestRun?.pilot;
    const observation = latestRun?.launch?.observation;
    const decision = latestRun?.optimization?.decisions.findLast(entry => entry.kind === 'waiting' || entry.kind === 'assessment');
    const pilotLabel = pilot ? pilot.pending ? 'Учебный запуск · требуется сверка' : 'Учебный запуск · ' + pilotStatus(pilot.phase) : undefined;
    const deliveryLabel = latestRun?.launch?.pending ? 'Требуется сверка Директа' :
      observation?.campaignState === 'SUSPENDED' ? 'Показы остановлены' : observation?.adStatus === 'REJECTED' ? 'На исправлении' :
        observation?.adStatus === 'MODERATION' ? 'На модерации' : observation?.campaignState === 'ON' ? 'Показы разрешены' : undefined;
    const stage = needsReview ? 'review' : confirmed(latestRun) ? 'created' : planCurrent(plan, saved, campaign) ? 'plan' : 'draft';
    const latest = linked.findLast(run => confirmed(run) && run.steps.campaign.phase === 'confirmed');
    const lastDirect = directRuns.findLast(run => run.complete && run.campaignId);
    const activeAmount = latest?.budget?.amountRub ?? (latest && !latest.budget ? latest.weekly : undefined);
    const activePeriod = latest?.budget?.periodDays;
    const activity = [createdAt, plan?.confirmedAt, ...linked.map(run => run.pilot?.checkedAt ?? run.checkedAt)].filter(Boolean).sort().at(-1) ?? '';
    return [{
      id, stage, directRuns, guided: saved?.value.guided, workspace: Boolean(campaignWorkspaceRun(linked, saved?.value.guided)), pilotLabel, deliveryLabel,
      latestDecision: decision && { reason: decision.reason, at: decision.at },
      stopUnconfirmed: pilot?.pending?.command === 'stop' || latestRun?.launch?.pending?.action === 'pause',
      budgetExceeded: Boolean(pilot?.budget?.overrun),
      state: campaignDisplayState(lastDirect?.state, lastDirect?.moderation),
      needsReview,
      title: campaignDisplayName(saved?.value, draft?.description, linked[0]?.name),
      creativeTitle: draft?.title,
      preparationStep: saved?.value.step,
      readyStep: saved && lastReadyStep(saved.value),
      region: lastDirect?.region ?? draft?.region ?? '',
      budget: activeAmount ?? draft?.budget ?? '',
      period: activePeriod ?? (activeAmount ? '' : draft?.period ?? ''),
      budgetSource: activeAmount ? 'direct' : 'draft',
      conditionsChanged: Boolean(lastDirect?.changed),
      startDate: latest?.budget?.startDate ?? latest?.startDate,
      endDate: latest?.budget?.endDate,
      lastActivity: activity,
    }];
  });
}
