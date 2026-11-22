import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DirectError } from './direct-api.ts';
import { hash, profileHash, judgmentHash } from './campaign-plan.ts';
import type { CampaignPreparation, StrategyRun } from './campaign-plan.ts';
import { gatherCandidates, applyGrounded, judgmentCandidates } from './phrase-strategy.ts';
import { groundedPayload, policyHash, validateGrounded } from './phrase-policy.ts';
import type { GeoRegion } from './search-phrases.ts';
export type GeoSnapshot = { rows: GeoRegion[]; hash: string; rowsHash: string; capturedAt: string; source: string };
export type CachedResearch = { geo?: GeoSnapshot; sourceExportHash?: string; sourceRuns?: StrategyRun[] };
export function geoSnapshot(rows: GeoRegion[], capturedAt = new Date().toISOString(), source = 'Direct GeoRegions, saved with research'): GeoSnapshot {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100000 || rows.some(r => !r || !/^\d+$/.test(String(r.GeoRegionId)) || typeof r.GeoRegionName !== 'string' || r.GeoRegionName.length > 300) || new Set(rows.map(r => String(r.GeoRegionId))).size !== rows.length) throw new DirectError('Некорректный сохранённый справочник.');
  return { rows, hash: hash(rows), rowsHash: hash(rows), capturedAt, source };
}
export function loadCachedResearch(geoPath: string, exportPath?: string): CachedResearch {
  const bytes = readFileSync(geoPath);if (bytes.length > 8388608) throw new DirectError('Слишком большой справочник.');
  const data = JSON.parse(bytes.toString()), snapshot = geoSnapshot(data.rows, data.capturedAt, data.source);
  if (!Number.isFinite(Date.parse(snapshot.capturedAt)) || typeof snapshot.source !== 'string') throw new DirectError('Нет даты/источника справочника.');
  snapshot.hash = createHash('sha256').update(bytes).digest('hex');
  const original = exportPath ? readFileSync(exportPath) : undefined;
  return { geo: snapshot, ...(original ? { sourceExportHash: createHash('sha256').update(original).digest('hex'), sourceRuns: JSON.parse(original.toString()).runs } : {}) };
}
export function cachedPlan(source: StrategyRun, p: CampaignPreparation, snapshot: GeoSnapshot) {
  if (source.profileHash !== profileHash(p) || source.judgmentHash !== judgmentHash(p)) throw new DirectError('Сохранённый ответ относится к другим фактам, объявлению или региону.');
  if (hash(snapshot.rows) !== snapshot.rowsHash) throw new DirectError('Справочник изменён.');
  const plan = structuredClone(source.plan);plan.id = randomUUID();
  const original = new Map(source.plan.strategy.candidates.map(c => [c.id, c.phrase]));
  plan.strategy.candidates = gatherCandidates(plan, p.input, snapshot.rows);
  if (original.size !== source.plan.strategy.candidates.length || plan.strategy.candidates.length !== original.size || plan.strategy.candidates.some(c => original.get(c.id) !== c.phrase)) throw new DirectError('Нарушено соответствие ID и точного текста исходных кандидатов.');
  const attempt = source.attempts.find(a => a.kind === 'judge' && a.status === 'succeeded');
  const input = attempt?.input as any;
  if (attempt && (!Array.isArray(input?.candidates) || new Set(input.candidates.map(c => c.id)).size !== input.candidates.length || input.candidates.some(c => original.get(c.id) !== c.phrase))) throw new DirectError('Исходный журнал оценки противоречит query mapping.');
  // Historical rows remain only in the source run; no new grounded fields are fabricated.
  applyGrounded(plan, p.input, snapshot.rows);
  plan.strategy.phase = 'complete';
  return plan;
}
export function researchPayload(plan: StrategyRun['plan'], draft: StrategyRun['input']) {
  return groundedPayload(draft, plan.strategy.profile!, judgmentCandidates(plan).slice(0,80));
}
export function sourceProvenance(source: StrategyRun, snapshot: GeoSnapshot, extra: CachedResearch = {}) {
  if (extra.sourceRuns && !extra.sourceRuns.some(r => r.id === source.id && hash(r) === hash(source))) throw new DirectError('Immutable export не соответствует исходному run.');
  return { sourceRunId: source.id, sourceRunHash: hash(source), sourceExportHash: extra.sourceExportHash,
    sourceAttempts: source.attempts.map(a => ({ id: a.id, kind: a.kind, inputHash: hash(a.input), responseHash: hash(a.result), status: a.status })),
    geo: { hash: snapshot.hash, rowsHash: snapshot.rowsHash, capturedAt: snapshot.capturedAt, source: snapshot.source }, policyHash, processedAt: new Date().toISOString() };
}
