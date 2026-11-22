import { initialPreparation, profileHash, selectionHash } from '../../src/campaign-plan.ts';
import type { CampaignDraft } from '../../src/campaign.ts';
import type { openDatabase } from '../../src/database.ts';

// Direct adapter tests start after E1 acceptance; E1 HTTP tests exercise the actual wizard.
export function confirmedPlan(db: ReturnType<typeof openDatabase>, draft: CampaignDraft, phrases: string[], owner = 'local', negatives: string[] = [], campaignId?: string) {
  const campaign = db.readCampaign(owner, campaignId);
  const p = initialPreparation(campaign); p.input = draft; p.goal = 'Обращения по предложению'; p.step = 4;
  p.profile = { value: { offers: [{ id: 'offer-1', name: phrases[0], kind: 'service', delivery: false,
    aliases: [], seeds: [phrases[0]], evidence: draft.description.slice(0, 240) }], ownBrands: [], exclusions: [], uncertainty: [] },
    descriptionHash: '', origin: 'manual', editedPaths: [] };
  p.profile.confirmedHash = profileHash(p);
  p.selection = { phrases, negatives, source: 'manual' }; p.selection.checkedHash = selectionHash(p);
  const saved = db.savePreparation(owner, p, db.readPreparation(owner, campaignId)?.revision ?? 0, undefined, undefined, campaignId);
  let id = '';
  db.saveCampaign(owner, draft, campaign?.revision ?? 0, 'Тест', revision => {
    const plan = db.commitPlan(owner, p, saved.revision, revision, undefined, campaignId); id = plan.id;
    db.savePhrasePlan(owner, { id, revision, offer: draft.title, region: draft.region, regionId: '54', at: new Date().toISOString(),
      source: 'business', wordstatAttempted: false, notice: 'Ручной fixture', candidates: phrases.map(phrase => ({ phrase, count: null, selected: true, source: 'business', reason: 'Проверено вручную.' })), selectionVersion: 3, manualSelectionConfirmed: true }, campaignId);
  }, campaignId);
  return id;
}
