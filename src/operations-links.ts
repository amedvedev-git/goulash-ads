import type { HistoryEntry, OperationsView } from './operations.ts';
import { hash } from './campaign-plan.ts';
import { escapeHtml as e } from './html.ts';

// Links and the undo action for history records. Shared by "История" and by the
// learning example on "Результаты", so both offer the same safe two-step undo.
export function journalUrl(campaignId?: string, filters: Record<string, string> = {}, fields: Record<string, string> = {}, path = '/history') {
  const query = new URLSearchParams({ ...(campaignId ? { ad: campaignId } : {}), ...filters, ...fields }).toString();
  return path + (query ? '?' + query : '');
}

export type HistoryScope = 'all' | 'draft' | 'demo';
export type HistorySource = 'all' | 'mine' | 'goulash';

export function journalOriginFields(campaignId?: string, scope: HistoryScope = 'all', by: HistorySource = 'all') {
  const field = (name: string, value: string) => `<input type="hidden" name="${name}" value="${e(value)}">`;
  return (campaignId ? '' : field('journal', 'global')) + (scope !== 'all' && !campaignId ? field('scope', scope) : '') +
    (by === 'all' ? '' : field('by', by));
}

export const assessmentAnchor = (run: string, key: string, at: string) => 'assessment-' + hash([run, key, at]);

export const operationUrl = (id: string, campaignId?: string, filters?: Record<string, string>) =>
  journalUrl(campaignId, filters, { operation: id }) + `#operation-${encodeURIComponent(id)}`;

export function canUndo(view: OperationsView, entry: HistoryEntry) {
  return !entry.undone && ['draft_changed', 'automation_applied'].includes(entry.kind) &&
    entry.revision === (entry.object === 'draft' ? view.draftRevision : view.demo?.revision);
}

export function undoLink(view: OperationsView, entry: HistoryEntry, campaignId?: string, filters?: Record<string, string>) {
  if (entry.undone) return `<span class="state-tag">Отменено</span>${entry.undoneBy ? ` <a class="inline-link" href="${e(operationUrl(entry.undoneBy, campaignId, filters))}">Запись об отмене</a>` : ''}`;
  if (!['draft_changed', 'automation_applied'].includes(entry.kind)) return '';
  const href = journalUrl(campaignId, filters, { review: entry.id });
  return canUndo(view, entry) ? `<a class="button secondary" href="${e(href)}#undo-review">${entry.object === 'draft' ? 'Отменить правку' : 'Отменить решение'}</a>`
    : '<span class="muted undo-unavailable">Отмена недоступна: после этой записи были изменения.</span>';
}
