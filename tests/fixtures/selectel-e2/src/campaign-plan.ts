import { policyHash } from './phrase-policy.ts';
import type { GeoSnapshot } from './cached-research.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { emptyCampaign, readCampaignForm } from './campaign.ts';
import type { CampaignDraft } from './campaign.ts';
import type { SearchProfile } from './phrase-intelligence.ts';
import type { StrategyPlan } from './phrase-strategy.ts';
import type { PhrasePlan } from './search-phrases.ts';
import { DirectError } from './direct-api.ts';

export const profileVersion = 'e1-facts-1';
export class PreparationConflict extends DirectError {}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
export type BusinessProfile = { value: SearchProfile; proposal?: SearchProfile; descriptionHash: string;
  origin: 'ai' | 'manual' | 'mixed' | 'legacy'; editedPaths: string[]; confirmedHash?: string; confirmedAt?: string };
export type CampaignPreparation = { schemaVersion: 1; input: CampaignDraft; goal: string; step: 1 | 2 | 3 | 4;
  baseCampaignRevision: number; profile?: BusinessProfile; wordingOrigin: 'manual' | 'suggested' | 'legacy'; activeRunId?: string;
  selection: { phrases: string[]; negatives: string[]; source: 'strategy' | 'manual' | 'legacy'; checkedHash?: string };
  confirmedPlanId?: string };
export type SavedPreparation = { revision: number; value: CampaignPreparation };
export type CampaignPlan = { schemaVersion: 1; id: string; preparationRevision: number; campaignRevision: number;
  confirmedAt: string; fingerprint: string; draft: CampaignDraft; goal: string; profile: BusinessProfile;
  dataFreshUntil?: string; policyHash?: string;
  targeting: { type: 'search'; region: string; regionId?: string; audience: string }; phrases: string[]; negatives: string[];
  phraseSource: 'strategy' | 'manual' | 'legacy'; strategyRunId?: string;
  dependencies: { profile: string; research?: string; judgment?: string; selection: string } };
export type Attempt = { id: string; kind: 'profile' | 'wordstat' | 'judge'; input: unknown; at: string; finishedAt?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'rejected' | 'unknown'; fixture?: boolean; contract?: { schemaVersion:string; promptVersion?:string; promptHash:string; factsHash:string; policyHash:string; payloadHash:string; maxOutputTokens?:number;timeoutMs?:number;responseBytes?:number }; rawResponse?: unknown; result?: unknown; model?: string; usage?: unknown; error?: string; notSent?: boolean };
export type StrategyRun = { id: string; key: string; kind: 'profile' | 'research' | 'legacy' | 'derived' | 'rejudge'; input: CampaignDraft;
  profileHash: string; researchHash?: string; judgmentHash?: string; status: 'running' | 'complete' | 'stopped';
  geoSnapshot?: GeoSnapshot; derivation?: any; plan: StrategyPlan; attempts: Attempt[]; imported?: PhrasePlan };
export type SavedRun = { revision: number; value: StrategyRun };
export const descriptionHash = (description: string) => hash([profileVersion, description]);
export const profileHash = (p: CampaignPreparation) => hash([descriptionHash(p.input.description), p.profile?.value]);
export const selectionHash = (p: CampaignPreparation) => hash([policyHash, profileHash(p), p.input.region, p.input.title, p.input.adText, p.selection.phrases, p.selection.negatives]);
export const researchHash = (p: CampaignPreparation, regionId: string) => hash([p.profile?.value.offers.map(o => [o.id, o.seeds]), regionId]);
export const judgmentHash = (p: CampaignPreparation) => hash([p.profile?.value, p.input.title, p.input.adText, p.input.region, 'judge-v3']);
export const fingerprint = (p: CampaignPreparation) => hash([policyHash, p.input, p.goal, p.profile?.value, p.profile?.origin,
  p.selection.phrases, p.selection.negatives, p.selection.source, p.selection.checkedHash, p.activeRunId]);
export function initialPreparation(saved?: { draft: CampaignDraft; revision: number }): CampaignPreparation {
  return { schemaVersion: 1, input: saved?.draft ?? { ...emptyCampaign, title: '', adText: '' }, goal: '', step: 1,
    baseCampaignRevision: saved?.revision ?? 0, wordingOrigin: saved ? 'legacy' : 'suggested',
    selection: { phrases: [], negatives: [], source: 'manual' } };
}
export function validEntry(p: CampaignPreparation) {
  const { errors } = readCampaignForm(new URLSearchParams(p.input), 'entry');
  if (!p.goal.trim() || p.goal.length > 160 || /[\x00-\x1f\x7f]/.test(p.goal)) return { ...errors, goal: 'Укажите цель до 160 символов.' };
  return errors;
}
export function planCurrent(plan: CampaignPlan | undefined, saved: SavedPreparation | undefined, campaign?: { draft: CampaignDraft; revision: number }) {
  return Boolean(plan && plan.policyHash === policyHash && saved && campaign && plan.campaignRevision === campaign.revision && hash(plan.draft) === hash(campaign.draft) &&
    (plan.phraseSource !== 'strategy' || (plan.dataFreshUntil && Date.now() <= Date.parse(plan.dataFreshUntil))) &&
    plan.fingerprint === fingerprint(saved.value) && saved.value.profile?.confirmedHash === profileHash(saved.value) &&
    saved.value.selection.checkedHash === selectionHash(saved.value));
}
export function migrateCampaignPlans(db: DatabaseSync) {
  db.exec(`CREATE TABLE campaign_preparations(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    CREATE TABLE campaign_plans(owner TEXT NOT NULL, id TEXT NOT NULL, preparation_revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(owner,id), UNIQUE(owner,preparation_revision)) STRICT;
    CREATE TABLE campaign_strategy_runs(owner TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(owner,id)) STRICT;
    PRAGMA user_version=8;`);
}
export function createCampaignPlanStore(db: DatabaseSync) {
  function readPreparation(owner: string): SavedPreparation | undefined {
    const row = db.prepare('SELECT revision,payload FROM campaign_preparations WHERE owner=?').get(owner) as { revision: number; payload: string } | undefined;
    return row && { revision: row.revision, value: JSON.parse(row.payload) };
  }
  function readPlan(owner: string, id?: string): CampaignPlan | undefined {
    if (!id) return;
    const row = db.prepare('SELECT payload FROM campaign_plans WHERE owner=? AND id=?').get(owner, id);
    return row && JSON.parse(String(row.payload));
  }
  function readRun(owner: string, id?: string): SavedRun | undefined {
    if (!id) return;
    const row = db.prepare('SELECT revision,payload FROM campaign_strategy_runs WHERE owner=? AND id=?').get(owner, id);
    return row && { revision: Number(row.revision), value: JSON.parse(String(row.payload)) };
  }
  function readRuns(owner: string): StrategyRun[] {
    return db.prepare('SELECT payload FROM campaign_strategy_runs WHERE owner=? ORDER BY rowid DESC').all(owner).map(row => JSON.parse(String(row.payload)));
  }
  function writePreparation(owner: string, value: CampaignPreparation, revision: number) {
    const current = readPreparation(owner);
    if ((current?.revision ?? 0) !== revision) throw new PreparationConflict('Подготовка изменена в другой вкладке. Сравните версии; ваш ввод сохранён ниже.');
    if (current && hash(current.value) === hash(value)) return current;
    db.prepare('INSERT INTO campaign_preparations VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,payload=excluded.payload')
      .run(owner, revision + 1, JSON.stringify(value));
    return { revision: revision + 1, value };
  }
  return { readPreparation, readPlan, readRun, readRuns,
    savePreparation(owner: string, value: CampaignPreparation, revision: number, run?: StrategyRun, campaignRevision?: number) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (campaignRevision !== undefined && Number(db.prepare('SELECT revision FROM campaign_drafts WHERE owner=?').get(owner)?.revision ?? 0) !== campaignRevision)
          throw new PreparationConflict('Объявление изменилось после сравнения. Сравните новую версию; замена не сохранена.');
        const saved = writePreparation(owner, value, revision);
        if (run) db.prepare('INSERT INTO campaign_strategy_runs VALUES(?,?,1,?)').run(owner, run.id, JSON.stringify(run));
        db.exec('COMMIT'); return saved;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    saveRun(owner: string, run: StrategyRun, revision: number) {
      if (db.prepare('UPDATE campaign_strategy_runs SET payload=?,revision=revision+1 WHERE owner=? AND id=? AND revision=?')
        .run(JSON.stringify(run), owner, run.id, revision).changes !== 1) throw new DirectError('Попытка уже изменена. Обновите страницу; повторный запрос не отправлен.');
      return revision + 1;
    },
    // Called only inside the existing saveCampaign transaction, including a no-op draft save.
    commitPlan(owner: string, p: CampaignPreparation, revision: number, campaignRevision: number, regionId?: string) {
      const current = readPreparation(owner);
      if (!current || current.revision !== revision || hash(current.value) !== hash(p)) throw new PreparationConflict('Подготовка изменилась до подтверждения. Откройте актуальную версию.');
      const previous = readPlan(owner, p.confirmedPlanId);
      if (previous?.fingerprint === fingerprint(p) && previous.campaignRevision === campaignRevision) return previous;
      const run = readRun(owner, p.activeRunId)?.value;
      const dates = p.selection.source === 'strategy' ? run?.plan.strategy.candidates.filter(c => p.selection.phrases.includes(c.phrase)).flatMap(c => c.evidence.map(e => Date.parse(e.at))) ?? [] : [];
      const plan: CampaignPlan = { schemaVersion: 1, id: randomUUID(), preparationRevision: revision + 1, campaignRevision,
        policyHash, confirmedAt: new Date().toISOString(), fingerprint: fingerprint(p), draft: p.input, goal: p.goal, profile: p.profile!,
        targeting: { type: 'search', region: p.input.region, ...(regionId ? { regionId } : {}), audience: 'Люди, которые ищут подтверждённые товары или услуги в указанном регионе.' },
        phrases: p.selection.phrases, negatives: p.selection.negatives, phraseSource: p.selection.source,
        strategyRunId: p.activeRunId, ...(dates.length ? { dataFreshUntil: new Date(Math.min(...dates) + 86400000).toISOString() } : {}),
        dependencies: { profile: profileHash(p), selection: selectionHash(p), research: run?.researchHash, judgment: run?.judgmentHash } };
      db.prepare('INSERT INTO campaign_plans VALUES(?,?,?,?)').run(owner, plan.id, plan.preparationRevision, JSON.stringify(plan));
      writePreparation(owner, { ...p, baseCampaignRevision: campaignRevision, confirmedPlanId: plan.id }, revision);
      return plan;
    },
  };
}
