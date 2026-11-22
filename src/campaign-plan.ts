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
import { defaultCampaignId, ensureCampaignWorkspace, readCampaignDraft } from './campaign-workspaces.ts';

export const profileVersion = 'e1-facts-1';
export class PreparationConflict extends DirectError {}
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
export type BusinessProfile = { value: SearchProfile; proposal?: SearchProfile; descriptionHash: string;
  origin: 'ai' | 'manual' | 'mixed' | 'legacy'; editedPaths: string[]; confirmedHash?: string; confirmedAt?: string };
export type CampaignPreparation = { schemaVersion: 1; input: CampaignDraft; goal: string; step: 1 | 2 | 3 | 4;
  baseCampaignRevision: number; profile?: BusinessProfile; wordingOrigin: 'manual' | 'suggested' | 'legacy'; manualWording?: ('title' | 'adText')[]; activeRunId?: string;
  selection: { phrases: string[]; negatives: string[]; editedRunId?: string; source: 'strategy' | 'manual' | 'legacy'; checkedHash?: string };
  confirmedPlanId?: string; campaignName?: string; guided?: true; directStartDate?: string; targetCpa?: string; explicitlySaved?: true };
export type SavedPreparation = { revision: number; value: CampaignPreparation };
export function retainedPreparation(saved?: SavedPreparation) {
  if (!saved) return false;
  const { value, revision } = saved;
  return !value.guided || value.explicitlySaved || revision > 1 || Boolean(value.campaignName || value.input.description || value.input.url);
}

export function manualWordingFields(p: CampaignPreparation): ('title' | 'adText')[] {
  if (p.manualWording) return p.manualWording;
  // Older workspaces recorded authorship for the entire ad. Preserve their existing copy.
  return p.wordingOrigin === 'suggested' ? [] : (['title', 'adText'] as const).filter(key => p.input[key]);
}
export type CampaignPlan = { schemaVersion: 1; id: string; campaignId?: string; preparationRevision: number; campaignRevision: number;
  confirmedAt: string; fingerprint: string; draft: CampaignDraft; goal: string; profile: BusinessProfile;
  dataFreshUntil?: string; policyHash?: string; directDraft?: { name: string; startDate: string }; targetCpaKop?: number;
  targeting: { type: 'search'; region: string; regionId?: string; audience: string }; phrases: string[]; negatives: string[];
  phraseSource: 'strategy' | 'manual' | 'legacy'; strategyRunId?: string;
  dependencies: { profile: string; research?: string; judgment?: string; selection: string } };
export type Attempt = { id: string; kind: 'profile' | 'wordstat' | 'judge' | 'wording'; input: unknown; at: string; finishedAt?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'rejected' | 'unknown'; fixture?: boolean; contract?: { schemaVersion:string; promptVersion?:string; promptHash:string; factsHash:string; policyHash:string; payloadHash:string; maxOutputTokens?:number;timeoutMs?:number;responseBytes?:number }; rawResponse?: unknown; result?: unknown; model?: string; usage?: unknown; error?: string; notSent?: boolean };
export type StrategyRun = { id: string; key: string; kind: 'profile' | 'research' | 'legacy' | 'derived' | 'rejudge' | 'wording'; input: CampaignDraft;
  startedFromRevision?: number;
  profileHash: string; researchHash?: string; judgmentHash?: string; status: 'running' | 'complete' | 'stopped';
  geoSnapshot?: GeoSnapshot; derivation?: any; plan: StrategyPlan; attempts: Attempt[]; imported?: PhrasePlan };
export type SavedRun = { revision: number; value: StrategyRun };
export const descriptionHash = (description: string) => hash([profileVersion, description]);
export const profileHash = (p: CampaignPreparation) => hash([descriptionHash(p.input.description), p.profile?.value]);
export const selectionHash = (p: CampaignPreparation) => hash([policyHash, profileHash(p), p.input.region, p.input.title, p.input.adText, p.selection.phrases, p.selection.negatives]);
export const researchHash = (p: CampaignPreparation, regionId: string) => hash([p.profile?.value.offers.map(o => [o.id, o.seeds]), regionId]);
export const judgmentHash = (p: CampaignPreparation) => hash([p.profile?.value, p.input.title, p.input.adText, p.input.region, 'judge-v3']);
export const fingerprint = (p: CampaignPreparation) => hash([policyHash, p.input, p.goal, p.profile?.value, p.profile?.origin,
  p.selection.phrases, p.selection.negatives, p.selection.source, p.selection.checkedHash, p.activeRunId,
  ...(p.guided ? [p.campaignName, p.directStartDate] : []), ...(p.guided && p.targetCpa ? [p.targetCpa] : [])]);
export function targetCpaInKopecks(value?: string) {
  if (!value || !/^(?:0|[1-9]\d{0,7})(?:[,.]\d{1,2})?$/.test(value)) return undefined;
  const [rubles, kopecks = ''] = value.split(/[,.]/);
  const amount = Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'));
  return amount > 0 ? amount : undefined;
}
function businessName(description = '') {
  return description.trim().split(/[\n.!?]/u)[0].slice(0, 75).trim();
}
export function campaignDisplayName(preparation?: CampaignPreparation, description?: string, fallback?: string) {
  const name = preparation?.campaignName || businessName(preparation?.input.description || description) || fallback;
  if (name) return name;
  const website = preparation?.input.url.trim();
  return website && /^https?:\/\//i.test(website) && URL.canParse(website) ? new URL(website).hostname : 'Новая реклама';
}
export function initialPreparation(saved?: { draft: CampaignDraft; revision: number }): CampaignPreparation {
  return { schemaVersion: 1, input: saved?.draft ?? { ...emptyCampaign, title: '', adText: '' }, goal: '', step: 1,
    baseCampaignRevision: saved?.revision ?? 0, wordingOrigin: saved ? 'legacy' : 'suggested',
    selection: { phrases: [], negatives: [], source: 'manual' } };
}
export function validEntry(p: CampaignPreparation, includeBudget = false) {
  const { errors } = readCampaignForm(new URLSearchParams(p.input), 'entry');
  // Budget and term are asked once on the final step; earlier steps must not block on them.
  if (!includeBudget) { delete errors.budget; delete errors.period; }
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
  function readPreparation(owner: string, campaignId = defaultCampaignId): SavedPreparation | undefined {
    const row = db.prepare('SELECT revision,payload FROM campaign_preparations WHERE owner=? AND campaign_id=?')
      .get(owner, campaignId) as { revision: number; payload: string } | undefined;
    return row && { revision: row.revision, value: JSON.parse(row.payload) };
  }
  function readPlan(owner: string, id?: string, campaignId?: string): CampaignPlan | undefined {
    if (!id) return;
    const row = campaignId === undefined
      ? db.prepare('SELECT payload FROM campaign_plans WHERE owner=? AND id=?').get(owner, id)
      : db.prepare('SELECT payload FROM campaign_plans WHERE owner=? AND id=? AND campaign_id=?').get(owner, id, campaignId);
    return row && JSON.parse(String(row.payload));
  }
  function readRun(owner: string, id?: string, campaignId = defaultCampaignId): SavedRun | undefined {
    if (!id) return;
    const row = db.prepare('SELECT revision,payload FROM campaign_strategy_runs WHERE owner=? AND id=? AND campaign_id=?')
      .get(owner, id, campaignId);
    return row && { revision: Number(row.revision), value: JSON.parse(String(row.payload)) };
  }
  function readAllRuns(owner: string): StrategyRun[] {
    return db.prepare('SELECT payload FROM campaign_strategy_runs WHERE owner=? ORDER BY rowid DESC').all(owner).map(row => JSON.parse(String(row.payload)));
  }
  function readRuns(owner: string, campaignId = defaultCampaignId): StrategyRun[] {
    return db.prepare('SELECT payload FROM campaign_strategy_runs WHERE owner=? AND campaign_id=? ORDER BY rowid DESC')
      .all(owner, campaignId).map(row => JSON.parse(String(row.payload)));
  }
  function requireEditable(owner: string, campaignId: string, value: CampaignPreparation) {
    if (value.guided && db.prepare("SELECT 1 FROM direct_runs WHERE owner=? AND json_extract(payload,'$.campaignId')=? LIMIT 1").get(owner, campaignId))
      throw new PreparationConflict('Создание в Директе уже начато. Откройте сохранённую операцию и сверьте её состояние.');
  }
  function writePreparation(owner: string, value: CampaignPreparation, revision: number, campaignId: string) {
    requireEditable(owner, campaignId, value);
    const current = readPreparation(owner, campaignId);
    if ((current?.revision ?? 0) !== revision) throw new PreparationConflict('Подготовка изменена в другой вкладке. Сравните версии; ваш ввод сохранён ниже.');
    const name = value.guided ? value.campaignName : current?.value.campaignName || businessName(current?.value.input.description || value.input.description);
    if (name) value = { ...value, campaignName: name };
    if (current && hash(current.value) === hash(value)) return current;
    ensureCampaignWorkspace(db, owner, campaignId);
    db.prepare(`INSERT INTO campaign_preparations(owner,revision,payload,campaign_id) VALUES(?,?,?,?)
      ON CONFLICT(owner,campaign_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload`)
      .run(owner, revision + 1, JSON.stringify(value), campaignId);
    return { revision: revision + 1, value };
  }
  return { readPreparation, readPlan, readRun, readRuns, readAllRuns,
    readPlans(owner: string, campaignId?: string): CampaignPlan[] {
      const rows = campaignId === undefined
        ? db.prepare('SELECT payload FROM campaign_plans WHERE owner=? ORDER BY rowid DESC').all(owner)
        : db.prepare('SELECT payload FROM campaign_plans WHERE owner=? AND campaign_id=? ORDER BY rowid DESC').all(owner, campaignId);
      return rows.map(row => JSON.parse(String(row.payload)));
    },
    savePreparation(owner: string, value: CampaignPreparation, revision: number, run?: StrategyRun, campaignRevision?: number, campaignId = defaultCampaignId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (campaignRevision !== undefined && (readCampaignDraft(db, owner, campaignId)?.revision ?? 0) !== campaignRevision)
          throw new PreparationConflict('Объявление изменилось после сравнения. Сравните новую версию; замена не сохранена.');
        const saved = writePreparation(owner, value, revision, campaignId);
        if (run) {
          if (run.kind === 'wording') {
            const existing = db.prepare("SELECT campaign_id, json_extract(payload,'$.key') AS key FROM campaign_strategy_runs WHERE owner=? AND json_extract(payload,'$.kind')='wording' AND (campaign_id=? OR json_extract(payload,'$.attempts[0].at')>=?)")
              .all(owner, campaignId, new Date(Date.now() - 86400000).toISOString());
            if (existing.some(row => row.campaign_id === campaignId && row.key === run.key)) throw new DirectError('Этот набор вариантов уже запрошен. Обновите страницу.');
            const recent = db.prepare("SELECT COUNT(*) AS count FROM campaign_strategy_runs WHERE owner=? AND json_extract(payload,'$.kind')='wording' AND json_extract(payload,'$.attempts[0].at')>=?")
              .get(owner, new Date(Date.now() - 86400000).toISOString());
            if (Number(recent?.count) >= 5) throw new DirectError('Доступно до пяти запросов вариантов за 24 часа. Введите текст вручную или вернитесь позже.');
          }
          db.prepare('INSERT INTO campaign_strategy_runs(owner,id,revision,payload,campaign_id) VALUES(?,?,1,?,?)')
            .run(owner, run.id, JSON.stringify(run), campaignId);
        }
        db.exec('COMMIT'); return saved;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    saveRun(owner: string, run: StrategyRun, revision: number, campaignId = defaultCampaignId) {
      if (db.prepare('UPDATE campaign_strategy_runs SET payload=?,revision=revision+1 WHERE owner=? AND id=? AND revision=? AND campaign_id=?')
        .run(JSON.stringify(run), owner, run.id, revision, campaignId).changes !== 1) throw new DirectError('Попытка уже изменена. Обновите страницу; повторный запрос не отправлен.');
      return revision + 1;
    },
    // Called only inside the existing saveCampaign transaction, including a no-op draft save.
    commitPlan(owner: string, p: CampaignPreparation, revision: number, campaignRevision: number, regionId?: string, campaignId = defaultCampaignId) {
      requireEditable(owner, campaignId, p);
      const current = readPreparation(owner, campaignId);
      if (!current || current.revision !== revision || hash(current.value) !== hash({ ...p, campaignName: current.value.campaignName })) throw new PreparationConflict('Подготовка изменилась до подтверждения. Откройте актуальную версию.');
      const previous = readPlan(owner, p.confirmedPlanId, campaignId);
      if (previous?.fingerprint === fingerprint(p) && previous.campaignRevision === campaignRevision) return previous;
      const run = readRun(owner, p.activeRunId, campaignId)?.value;
      const dates = p.selection.source === 'strategy' ? run?.plan.strategy.candidates.filter(c => p.selection.phrases.includes(c.phrase)).flatMap(c => c.evidence.map(e => Date.parse(e.at))) ?? [] : [];
      const plan: CampaignPlan = { schemaVersion: 1, id: randomUUID(), ...(campaignId === defaultCampaignId ? {} : { campaignId }), preparationRevision: revision + 1, campaignRevision,
        policyHash, confirmedAt: new Date().toISOString(), fingerprint: fingerprint(p), draft: p.input, goal: p.goal, profile: p.profile!,
        ...(p.guided && p.campaignName && p.directStartDate ? { directDraft: { name: p.campaignName, startDate: p.directStartDate } } : {}),
        ...(p.guided && p.targetCpa ? { targetCpaKop: targetCpaInKopecks(p.targetCpa) } : {}),
        targeting: { type: 'search', region: p.input.region, ...(regionId ? { regionId } : {}), audience: 'Люди, которые ищут подтверждённые товары или услуги в указанном регионе.' },
        phrases: p.selection.phrases, negatives: p.selection.negatives, phraseSource: p.selection.source,
        strategyRunId: p.activeRunId, ...(dates.length ? { dataFreshUntil: new Date(Math.min(...dates) + 86400000).toISOString() } : {}),
        dependencies: { profile: profileHash(p), selection: selectionHash(p), research: run?.researchHash, judgment: run?.judgmentHash } };
      db.prepare('INSERT INTO campaign_plans(owner,id,preparation_revision,payload,campaign_id) VALUES(?,?,?,?,?)')
        .run(owner, plan.id, plan.preparationRevision, JSON.stringify(plan), campaignId);
      writePreparation(owner, { ...p, baseCampaignRevision: campaignRevision, confirmedPlanId: plan.id }, revision, campaignId);
      return plan;
    },
  };
}
