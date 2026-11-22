import { isDeepStrictEqual } from 'node:util';
import type { DirectView } from './direct.ts';
import { directEventPhases, directEventTitle, renderDirectReceipt } from './direct-page.ts';
import { renderDirectLaunchEntry } from './direct-launch-page.ts';
import { renderNextPeriodEntry } from './campaign-next-period.ts';
import { renderOptimizationEntry } from './campaign-optimization.ts';
import type { CampaignCatalogItem } from './campaign-catalog.ts';
import { campaignEditorHref, directResultsHref } from './campaign-catalog.ts';
import { assessmentAnchor, journalOriginFields, type HistoryScope, type HistorySource } from './operations-links.ts';
import type { HistoryEntry } from './operations.ts';
import { campaignTabHref } from './routes.ts';
import { escapeHtml as e } from './html.ts';

export type ProviderEntry = {
  at: string; source: 'mine' | 'goulash'; html: string; anchors: string[];
  creation?: { operationId: string; receipt: string; campaignLink: string };
};

export function providerEntries(direct: DirectView | undefined, history: HistoryEntry[], catalog?: CampaignCatalogItem[],
  campaignId?: string, allowExplanation = false, scope?: HistoryScope, by?: HistorySource): ProviderEntry[] {
  if (!direct) return [];
  const entries: ProviderEntry[] = [];
  const originFields = journalOriginFields(campaignId, scope, by);
  for (const run of direct.runs?.length ? direct.runs : direct.state ? [direct.state] : []) {
    const workspace = run.campaignId ?? 'default';
    if (campaignId && workspace !== campaignId) continue;
    const title = catalog?.find(item => item.id === workspace)?.title ?? run.draft.title;
    const editor = run.guidedDraft ? campaignTabHref(workspace, 'summary') : campaignEditorHref(workspace);
    const campaign = campaignId ? '' : `<p><a href="${e(run.guidedDraft ? campaignTabHref(workspace, 'journal') : editor)}">${e(title || 'Кампания')}</a></p>`;
    const add = (at: string, source: ProviderEntry['source'], html: string, anchors: string[]) => {
      const item: ProviderEntry = { at, source, html: campaign + html, anchors };
      entries.push(item);
      return item;
    };
    for (const event of [...(run.events ?? [])].reverse()) {
      const mode = direct.mode === 'fixture' ? 'Подставной API · отдельная проверочная база' : 'Сохранённая операция Директа';
      const receipt = `<p>${mode}</p>
        ${renderDirectReceipt(direct, run, event, originFields)}
        <p>Кабинет <code>${e(run.account)}</code> · кампания <code>${e(run.steps.campaign.id ?? 'не подтверждена')}</code>
        · группа <code>${e(run.steps.group.id ?? 'не подтверждена')}</code> · объявление <code>${e(run.steps.ad.id ?? 'не подтверждено')}</code>
        · версия плана <code>${e(run.campaignPlanId ?? 'прежний набор')}</code>.</p>
        ${campaignId ? '' : `<a href="${e(editor)}">Открыть кампанию Goulash</a>${run.steps.campaign.phase === 'confirmed' ? ` · <a href="${e(directResultsHref(run.planId))}">Результаты</a>` : ''}`}`;
      const item = add(event.at, 'mine', `<h3>${directEventTitle(event)}</h3>${event.phase !== 'confirmed' ? `<p>${directEventPhases[event.phase] ?? 'Исход не подтверждён · требуется сверка'}</p>` : ''}
        <details class="support-details"><summary>Квитанция Директа</summary>${receipt}</details>`,
        ['direct-history', 'direct-history-' + run.planId, 'direct-event-' + event.id]);
      if (event.kind === 'create' && event.phase === 'confirmed' && run.guidedDraft) {
        const creation = history.find(entry => entry.kind === 'draft_created' && (entry.campaignId ?? 'default') === workspace &&
          entry.revision === run.revision && Date.parse(entry.at) <= Date.parse(event.at) && isDeepStrictEqual(entry.after, run.draft));
        if (creation) item.creation = { operationId: creation.id, receipt, campaignLink: campaign };
      }
    }
    for (const item of [...(run.launch?.history ?? [])].reverse())
      add(item.at, 'mine', renderDirectLaunchEntry(item), ['launch-history-title']);
    for (const item of [...(run.nextPeriods ?? [])].reverse())
      add(item.at, 'mine', renderNextPeriodEntry(item), ['next-period-history', 'next-period-history-title']);
    for (const item of [...(run.optimization?.decisions ?? [])].reverse()) {
      const automatic = item.kind === 'waiting' || item.kind === 'assessment';
      add(item.at, automatic ? 'goulash' : 'mine', renderOptimizationEntry(run, workspace, item, allowExplanation, originFields),
        ['optimization-journal', assessmentAnchor(run.planId, item.key, item.at)]);
    }
  }
  return entries;
}
