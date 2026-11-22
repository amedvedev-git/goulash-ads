import { cachedPlan, researchPayload, sourceProvenance, geoSnapshot } from './cached-research.ts';
import type { CachedResearch } from './cached-research.ts';
import { groundedPayload, validateGrounded, policyHash } from './phrase-policy.ts';
import { applyGrounded } from './phrase-strategy.ts';
import { geographyGuard } from './geo-policy.ts';
import { randomUUID } from 'node:crypto';
import type { openDatabase } from './database.ts';
import { exampleCampaign, readCampaignForm } from './campaign.ts';
import type { CampaignDraft } from './campaign.ts';
import { DirectError, directId } from './direct-api.ts';
import { validateProfile, validateMeanings } from './phrase-intelligence.ts';
import type { SearchProfile, PhraseIntelligence, Meaning } from './phrase-intelligence.ts';
import { newStrategyPlan, confirmStrategy, gatherCandidates, judgmentCandidates, applyMeanings, unassessedMeaningReason } from './phrase-strategy.ts';
import type { MeaningEvaluation, StrategyCandidate } from './phrase-strategy.ts';
import { readPhrases, phraseKey, foreignGeography, wordstatNotice } from './search-phrases.ts';
import type { Wordstat, GeoRegion } from './search-phrases.ts';
import { initialPreparation, descriptionHash, profileHash, selectionHash, judgmentHash, researchHash, planCurrent, validEntry, hash, PreparationConflict } from './campaign-plan.ts';
import type { CampaignPreparation, CampaignPlan, SavedPreparation, StrategyRun, Attempt } from './campaign-plan.ts';

export type PreparationView = { saved: SavedPreparation; plan?: CampaignPlan; current: boolean; run?: StrategyRun; runs: StrategyRun[];
  ai: boolean; wordstat: boolean; errors?: Record<string, string>; conflict?: boolean; currentRevision?: number; campaignRevision: number;
  form?: URLSearchParams; legacy: boolean; message?: string; acknowledged?: boolean; latest?: CampaignPreparation; unsaved?: boolean; restored?: boolean;
  cached?: boolean; campaign?: { draft: CampaignDraft; revision: number } };
const one = (form: URLSearchParams, key: string, fallback = '') => {
  if (form.getAll(key).length > 1) throw new DirectError('Поле передано несколько раз. Обновите форму.');
  return (form.get(key) ?? fallback).trim();
};
const lines = (s: string) => s.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
function researchEvaluation(run: StrategyRun): MeaningEvaluation {
  const attempt = run.attempts.find(a => a.kind === 'judge');
  if (!attempt) return { status: 'not-started', ...(run.plan.strategy.requests.some(r => r.phase !== 'complete') ? { reason: 'incomplete-research' as const } : {}) };
  if (attempt.status !== 'succeeded') return { status: 'unavailable' };
  const input = attempt.input as { candidates?: { id: string }[]; limit?: number } | undefined;
  if (!Array.isArray(input?.candidates) || !input.candidates.every(c => typeof c?.id === 'string') || !Array.isArray((attempt.result as any)?.judgments ?? attempt.result)) return { status: 'unavailable' };
  const ids = input.candidates.map(c => c.id), result = (attempt.result as any)?.judgments ?? attempt.result;
  if (new Set(ids).size !== ids.length || result.length !== ids.length || !ids.every(id => result.some(r => r?.id === id))) return { status: 'unavailable' };
  return { status: 'complete', submittedIds: ids, ...(Number.isSafeInteger(input.limit) && input.limit! > 0 ? { limit: input.limit } : {}) };
}
export function researchCandidateReason(run: StrategyRun, candidate: StrategyCandidate) {
  if (candidate.assessment?.policyReasons.length) return candidate.assessment.policyReasons.join(' ');
  if (candidate.assessment?.model) return candidate.reason;
  if (candidate.decision === 'exclude') return candidate.reason;
  const evaluation = researchEvaluation(run);
  if (evaluation.status === 'complete' && evaluation.submittedIds.includes(candidate.id)) return candidate.reason;
  return unassessedMeaningReason(candidate.id, evaluation);
}
const failure = (error: unknown): Attempt['status'] => error instanceof DirectError && ('notSent' in error || /HTTP (401|403|429|\d{3})/.test(error.message)) ? 'failed'
  : error instanceof DirectError && /провер|непол|некоррект|большой/.test(error.message) ? 'rejected' : 'unknown';
function automaticSelection(p: CampaignPreparation, run?: StrategyRun) {
  return Boolean(run && ['research','derived','rejudge'].includes(run.kind) && run.plan.policyHash === policyHash && run.profileHash === profileHash(p) && run.judgmentHash === judgmentHash(p) && run.status === 'complete' && p.selection.phrases.every(s => {
    const candidate = run.plan.strategy.candidates.find(c => c.phrase === s);
    return candidate?.decision === 'include' && candidate.count !== null && BigInt(candidate.count) > 0n && candidate.evidence.length > 0 &&
      candidate.evidence.every(e => Number.isFinite(Date.parse(e.at)) && Date.now() - Date.parse(e.at) <= 86400000);
  }));
}
export function readProfileForm(form: URLSearchParams): SearchProfile {
  const offers: SearchProfile['offers'] = [];
  for (let i = 0; i < 3; i++) {
    const name = one(form, `offer${i}`); if (!name) continue;
    const seeds = lines(one(form, `seeds${i}`));
    offers.push({ id: one(form, `offerId${i}`, `offer-${i + 1}`), name, kind: one(form, `kind${i}`, 'service') as 'service',
      delivery: one(form, `delivery${i}`) === 'yes', evidence: one(form, `evidence${i}`), aliases: lines(one(form, `aliases${i}`)),
      seeds: seeds.length ? seeds : [name.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N} ]/gu, '').trim()] });
  }
  const exclusions: SearchProfile['exclusions'] = [];
  for (let i = 0; i < 10; i++) if (one(form, `exclude${i}`)) exclusions.push({ phrase: one(form, `exclude${i}`), evidence: one(form, `excludeEvidence${i}`) });
  return { offers, ownBrands: lines(one(form, 'ownBrands')), exclusions, uncertainty: lines(one(form, 'uncertainty')) };
}
export function createPreparationService(db: ReturnType<typeof openDatabase>, intelligence?: PhraseIntelligence, wordstat?: Wordstat,
  geo?: (owner: string) => Promise<GeoRegion[]>, cached: CachedResearch = {}) {
  function snapshotFor(owner: string, run?: StrategyRun) {
    return run?.geoSnapshot ?? db.readRun(owner,run?.derivation?.geoSnapshotRunId)?.value.geoSnapshot ?? cached.geo;
  }
  function view(owner: string, pending?: SavedPreparation, form?: URLSearchParams): PreparationView {
    const campaign = db.readCampaign(owner), preparation = db.readPreparation(owner);
    const saved = pending ?? preparation ?? { revision: 0, value: initialPreparation(campaign) };
    const plan = db.readPlan(owner, saved.value.confirmedPlanId);
    const externalConflict = saved.value.baseCampaignRevision !== (campaign?.revision ?? 0);
    return { saved, plan, campaign, cached: Boolean(snapshotFor(owner,db.readRun(owner,saved.value.activeRunId)?.value)), current: planCurrent(plan, saved, campaign), run: db.readRun(owner, saved.value.activeRunId)?.value,
      runs: db.readRuns(owner), ai: Boolean(intelligence), wordstat: Boolean(wordstat && geo), campaignRevision: campaign?.revision ?? 0,
      legacy: !preparation && Boolean(campaign), form,
      ...(externalConflict ? { conflict: true, latest: preparation?.value, currentRevision: preparation?.revision ?? 0 } : {}),
      unsaved: Boolean(pending && hash(saved.value) !== hash(preparation?.value ?? initialPreparation(campaign))) };
  }
  function readInput(form: URLSearchParams, p: CampaignPreparation) {
    const next = structuredClone(p);
    for (const key of ['description', 'url', 'region', 'budget', 'period', 'title', 'adText'] as const) {
      next.input[key] = one(form, key, p.input[key]).slice(0, 4096);
    }
    next.goal = one(form, 'goal', p.goal).slice(0, 4096);
    if (hash([next.input.title, next.input.adText]) !== hash([p.input.title, p.input.adText])) next.wordingOrigin = 'manual';
    if (form.has('profileEditor')) {
      const value = readProfileForm(form);
      if (hash(value) !== hash(p.profile?.value)) next.profile = { value, proposal: p.profile?.proposal, descriptionHash: descriptionHash(next.input.description),
        origin: p.profile?.origin === 'ai' || p.profile?.origin === 'mixed' ? 'mixed' : 'manual', editedPaths: ['user-correction'] };
    }
    if (form.has('selectionEditor')) {
      next.selection.phrases = [...form.getAll('selected'), ...lines(one(form, 'phrases'))];
      next.selection.negatives = lines(one(form, 'negatives'));
    }
    return next;
  }
  function save(owner: string, p: CampaignPreparation, revision: number, run?: StrategyRun, campaignRevision?: number) {
    // Archive the previous single-slot cache before publishing any replacement.
    const old = db.readPhrasePlan(owner);
    if (old && !db.readRuns(owner).some(r => r.kind === 'legacy' && r.imported?.id === old.id)) {
      const archive: StrategyRun = { id: randomUUID(), key: `legacy:${old.id}`, kind: 'legacy', input: p.input,
        profileHash: '', status: 'complete', plan: newStrategyPlan(p.input, p.baseCampaignRevision), attempts: [], imported: old };
      db.savePreparation(owner, p, revision, archive, campaignRevision);
      const latest = db.readPreparation(owner)!;
      return run ? db.savePreparation(owner, p, latest.revision, run, campaignRevision) : latest;
    }
    return db.savePreparation(owner, p, revision, run, campaignRevision);
  }
  async function action(owner: string, action: string, form: URLSearchParams, actor: string): Promise<{ status: number; view: PreparationView; message: string }> {
    const current = view(owner), before = current.saved;
    let p = structuredClone(before.value), revision = before.revision;
    const show = (status: number, message: string, errors?: Record<string, string>) => ({ status, message,
      view: { ...view(owner, { revision, value: p }, form), errors } });
    const conflict = (message: string) => {
      const latest = view(owner), inputRevision = form.get('preparationRevision') ?? '';
      return { status: 409, message, view: { ...view(owner, { revision: /^(0|[1-9]\d{0,8})$/.test(inputRevision) ? Number(inputRevision) : 0, value: p }, form),
        conflict: true, latest: latest.saved.value, currentRevision: latest.saved.revision, campaign: latest.campaign, campaignRevision: latest.campaignRevision,
        ...(action === 'resume' ? { restored: true } : {}) } };
    };
    try {
      p = readInput(form, p);
      if (['recover-rejudge','reprocess','rejudge','offer','confirm'].includes(action) && one(form,'policyHash') !== policyHash) throw new DirectError('Правила обновлены. Откройте актуальную страницу и проверьте список.');
      if (action === 'resume') p.step = Math.min(4, Math.max(1, Number(one(form, 'formStep', '1')) || 1)) as 1;
      const expected = one(form, action === 'resolve' ? 'currentRevision' : 'preparationRevision');
      if (!/^(0|[1-9]\d{0,8})$/.test(expected) || Number(expected) !== before.revision) {
        return conflict('Подготовка изменена в другой вкладке. Ваш ввод сохранён; сравните варианты.');
      }
      if (action === 'resolve') {
        const shownCampaignRevision = one(form, 'currentCampaignRevision');
        if (!/^(0|[1-9]\d{0,8})$/.test(shownCampaignRevision) || Number(shownCampaignRevision) !== current.campaignRevision)
          return conflict('Сохранённое объявление изменилось после сравнения или его версия не указана. Сравните обе актуальные версии; замена не сохранена.');
        if (one(form, 'replace') !== 'yes') return { ...conflict('Подтвердите замену после сравнения версий.'), status: 400 };
        p.baseCampaignRevision = Number(shownCampaignRevision);
      } else if (p.baseCampaignRevision !== current.campaignRevision) {
        return conflict('Сохранённое объявление изменилось вне мастера. Сравните версии перед подтверждением.');
      }
      const saveHere = () => { const saved = save(owner, p, revision, undefined, action === 'resolve' ? p.baseCampaignRevision : undefined); revision = saved.revision; p = saved.value; };
      if (action === 'resume') { const result = show(200, 'Восстановлен несохранённый ввод. Подтверждение не выполнялось.'); result.view.restored = true; return result; }
      if (action === 'example') {
        p.input = { ...p.input, ...exampleCampaign }; p.goal = 'Обращения по доставке суши и роллов'; p.step = 1;
        delete p.profile; p.selection = { phrases: [], negatives: [], source: 'manual' }; delete p.activeRunId; saveHere();
        return show(200, 'Заполнен вымышленный пример. Формулировки объявления сохранены.');
      }
      if (action === 'back' || action === 'save' || action === 'resolve') {
        if (action === 'back') p.step = Math.min(4, Math.max(1, Number(one(form, 'step', '1')) || 1)) as 1;
        saveHere(); return show(200, 'Рабочий ввод сохранён. Подтверждённый план не изменён.');
      }
      if (action === 'entry') {
        const errors = validEntry(p); if (Object.keys(errors).length) { p.step = 1; return show(400, 'Исправьте отмеченные поля. Ввод оставлен в форме.', errors); }
        p.step = 2; saveHere(); return show(200, 'Условия сохранены. Проверьте понимание бизнеса.');
      }
      if (action === 'profile') {
        const errors = validEntry(p); if (Object.keys(errors).length) return show(400, 'Сначала заполните бизнес и условия.', errors);
        if (!intelligence || one(form, 'aiConsent') !== 'yes') return show(400, 'Нужно подключение DeepSeek и согласие на один платный разбор описания. Ручное заполнение доступно.');
        const key = `profile:${descriptionHash(p.input.description)}`;
        const old = db.readRuns(owner).find(r => r.key === key);
        if (old) { p.activeRunId = old.id; p.step = 2; saveHere(); return show(200, 'Показана сохранённая попытка. Новый платный запрос не отправлялся.'); }
        const run: StrategyRun = { id: randomUUID(), key, kind: 'profile', input: structuredClone(p.input), profileHash: descriptionHash(p.input.description),
          status: 'running', plan: newStrategyPlan(p.input, p.baseCampaignRevision), attempts: [] };
        p.activeRunId = run.id; p.step = 2;
        const attempt: Attempt = { id: randomUUID(), kind: 'profile', input: { description: p.input.description, version: 'e1-facts-1' },
          at: new Date().toISOString(), status: 'pending' }; run.attempts.push(attempt);
        revision = save(owner, p, revision, run).revision;
        let runRevision = 1;
        try {
          const profile = validateProfile(await intelligence.profile(run.input, meta => Object.assign(attempt, meta)), run.input.description);
          run.plan.strategy.profile = profile; run.plan.strategy.proposal = structuredClone(profile); run.plan.strategy.phase = 'profile-review';
          attempt.status = 'succeeded'; attempt.result = profile; run.status = 'complete';
        } catch (error) { attempt.status = failure(error); attempt.error = 'Проверенный профиль не получен. Автоматического повтора нет.';
          if (error instanceof DirectError && 'notSent' in error) { attempt.notSent = true; attempt.error = error.message; }
          run.plan.strategy.phase = 'failed'; run.status = 'stopped'; }
        attempt.finishedAt = new Date().toISOString(); db.saveRun(owner, run, runRevision);
        return { status: attempt.status === 'succeeded' ? 200 : 502, view: { ...view(owner), acknowledged: true }, message: attempt.status === 'succeeded'
          ? 'Предложение DeepSeek сохранено. Проверьте и исправьте факты.' : attempt.error! };
      }
      if (action === 'use-profile') {
        const run = db.readRun(owner, one(form, 'runId'))?.value;
        if (!run?.plan.strategy.profile || run.profileHash !== descriptionHash(p.input.description)) throw new DirectError('Разбор относится к другому описанию.');
        p.profile = { value: structuredClone(run.plan.strategy.profile), proposal: run.plan.strategy.proposal,
          origin: 'ai', editedPaths: [], descriptionHash: descriptionHash(p.input.description) }; p.step = 2; saveHere();
        return show(200, 'Предложенный вариант применён. Подтвердите или исправьте его.');
      }
      if (action === 'confirm-profile') {
        const entered = readProfileForm(form), errors: Record<string, string> = {};
        if (!entered.offers.length) errors.offer0 = 'Укажите хотя бы один товар или услугу.';
        entered.offers.forEach((o, i) => { if (!o.evidence || !p.input.description.includes(o.evidence)) errors['evidence' + i] = 'Нужна точная цитата из описания выше.';
          else if (o.delivery && !/достав|привез|привоз/iu.test(o.evidence)) errors['evidence' + i] = 'Доставка должна быть явно указана в этой цитате.'; });
        if (Object.keys(errors).length) { p.step = 2; return show(400, 'Исправьте понимание бизнеса. Новый запрос модели для этого не нужен.', errors); }
        let value: SearchProfile;
        try { value = validateProfile(entered, p.input.description); }
        catch { p.step = 2; return show(400, 'Проверьте тип предложения, синонимы, направления и цитаты для брендов/исключений. Используйте сведения из описания; запрос модели не выполнялся.'); }
        const proposal = current.run?.kind === 'profile' && current.run.profileHash === descriptionHash(p.input.description) ? current.run.plan.strategy.profile : p.profile?.proposal;
        p.profile = { value, proposal, descriptionHash: descriptionHash(p.input.description),
          origin: proposal ? hash(proposal) === hash(value) ? 'ai' : 'mixed' : 'manual', editedPaths: proposal && hash(proposal) !== hash(value) ? ['user-correction'] : [] };
        p.profile.confirmedHash = profileHash(p); p.profile.confirmedAt = new Date().toISOString();
        if (!p.input.title && value.offers[0].name.length <= 56) p.input.title = value.offers[0].name;
        if (!p.input.adText) p.input.adText = 'Узнайте о предложении и условиях на сайте.';
        p.step = 3; saveHere(); return show(200, 'Понимание подтверждено. Подготовьте рекламное предложение.');
      }
      if (action === 'recover-rejudge') {
        p.selection = structuredClone(before.value.selection);
        if(hash(p)!==hash(before.value)) throw new DirectError('Сначала сохраните изменения ввода.');
        const stored = db.readRun(owner,p.activeRunId), run=stored?.value;
        if(!run || run.kind!=='rejudge' || !snapshotFor(owner,run) || !intelligence?.recoverGrounded || run.profileHash!==profileHash(p) || run.judgmentHash!==judgmentHash(p)) throw new DirectError('Нет подходящего сохранённого ответа для восстановления.');
        const attempt=run.attempts[0],payload=researchPayload(run.plan,p.input);
        if(attempt.status==='succeeded')return show(200,'Ответ уже сохранён. Провайдер не вызван.');
        const recovered=await intelligence.recoverGrounded(payload);
        if(!recovered)throw new DirectError('Полный ответ не найден в журнале. Повтор провайдера запрещён.');
        if(hash(attempt.input)!==payload.inputHash || (attempt as any).contract?.payloadHash!==payload.payloadHash)throw new DirectError('Ответ относится к другому input.');
        const response=validateGrounded(recovered.response,payload);Object.assign(attempt,recovered.metadata,{result:response,status:'succeeded',finishedAt:recovered.receivedAt});
        applyGrounded(run.plan,run.input,snapshotFor(owner,run)!.rows,response);run.status='complete';db.saveRun(owner,run,stored!.revision);
        return show(200,'Полученный ранее ответ восстановлен из журнала. Новых вызовов0.');
      }
      if (action === 'reprocess' || action === 'rejudge') {
        p.selection = structuredClone(before.value.selection);
        if (hash(p) !== hash(before.value)) throw new DirectError('Сначала сохраните изменения ввода.');
        if (p.profile?.confirmedHash !== profileHash(p)) throw new DirectError('Подтвердите факты бизнеса.');
        const active = db.readRun(owner, p.activeRunId)?.value;
        const source = active?.derivation?.sourceRunId ? db.readRun(owner, active.derivation.sourceRunId)?.value : active;
        if (!source || source.kind !== 'research') throw new DirectError('Нет исходного сохранённого исследования.');
        const snapshot = snapshotFor(owner,active) ?? snapshotFor(owner,source);
        if (!snapshot) throw new DirectError('Нет сохранённого справочника; API не вызывался.');
        const provenance = sourceProvenance(source, snapshot, cached);
        const plan = cachedPlan(source, p, snapshot), payload = researchPayload(plan, p.input);
        const judgmentSource = active?.kind === 'rejudge' ? active : active?.derivation?.judgmentRunId ? db.readRun(owner,active.derivation.judgmentRunId)?.value : undefined;
        const savedJudgment = judgmentSource?.attempts.find(a=>a.kind==='judge' && a.status==='succeeded');
        if (action === 'reprocess' && savedJudgment) {
          if (hash(savedJudgment.input) !== payload.inputHash) throw new DirectError('Новая оценка относится к другому точному input.');
          applyGrounded(plan,p.input,snapshot.rows,validateGrounded(savedJudgment.result,payload));
        }
        const key = `${action}:${hash([provenance.sourceRunHash, payload.payloadHash, policyHash, snapshot.hash, action==='reprocess' ? savedJudgment?.id : null])}`;
        const previous = db.readRuns(owner).find(r => r.key === key);
        if (previous) {
          if (p.activeRunId !== previous.id) { p.activeRunId = previous.id; p.step = 3; p.selection = { ...p.selection, phrases: [], checkedHash: undefined }; saveHere(); }
          return show(200, 'Показан сохранённый результат. Новый запрос не отправлялся.');
        }
        if (action === 'rejudge' && (!intelligence?.groundedJudge || one(form,'rejudgeConsent') !== 'yes')) throw new DirectError('Нужно отдельное согласие на новую оценку; прежние разрешения исчерпаны.');
        const snapshotOwner = db.readRuns(owner).find(r=>r.geoSnapshot?.hash===snapshot.hash);
        const run: StrategyRun = { id: randomUUID(), key, kind: action === 'reprocess' ? 'derived' : 'rejudge', input: structuredClone(p.input),
          profileHash: profileHash(p), researchHash: source.researchHash, judgmentHash: judgmentHash(p), status: action === 'reprocess' ? 'complete' : 'running',
          ...(snapshotOwner ? {} : {geoSnapshot:snapshot}), derivation: { ...provenance, geoSnapshotRunId:snapshotOwner?.id, inputHash: payload.inputHash, factsHash: payload.factsHash, mappingHash: hash(payload.input.candidates), ...(action==='reprocess' && savedJudgment ? {judgmentRunId:judgmentSource!.id,judgmentAttemptId:savedJudgment.id,judgmentResponseHash:hash(savedJudgment.result)} : {}) }, plan, attempts: [] };
        p.activeRunId = run.id; p.step = 3; p.selection = { ...p.selection, phrases: [], checkedHash: undefined };
        if (action === 'rejudge') run.attempts.push({ id: randomUUID(), kind: 'judge', input: payload.input, at: new Date().toISOString(), status: 'pending', ...{ contract: { schemaVersion: payload.schemaVersion, promptVersion:payload.promptVersion, promptHash: payload.promptHash, factsHash: payload.factsHash, policyHash, payloadHash: payload.payloadHash, maxOutputTokens:payload.max_tokens,timeoutMs:payload.timeoutMs,responseBytes:payload.responseBytes } } });
        revision = save(owner, p, revision, run, current.campaignRevision).revision;
        if (action === 'reprocess') return show(200, 'Сохранённые ответы пересмотрены локально. Новых вызовов0; прежняя модельная оценка не подтверждает новый контракт.');
        const attempt = run.attempts[0];
        try {
          const response = await intelligence!.groundedJudge!(run.input, run.plan.strategy.profile!, payload.input.candidates, meta => Object.assign(attempt,meta));
          attempt.result = response;
          validateGrounded(response, payload);
          attempt.status = 'succeeded'; applyGrounded(run.plan, run.input, snapshot.rows, response); run.status = 'complete';
        } catch (error) { attempt.status = failure(error); attempt.error = error instanceof DirectError ? error.message : 'Ответ нового judge не получен. Повтора нет.'; if (error instanceof DirectError && 'notSent' in error) attempt.notSent = true; run.status = 'stopped'; }
        attempt.finishedAt = new Date().toISOString();db.saveRun(owner,run,1);
        return { status: attempt.status === 'succeeded' ? 200 : 502, view: view(owner), message: attempt.status === 'succeeded' ? 'Новая оценка сохранена. Проверьте и подтвердите итог.' : attempt.error! };
      }
      if (action === 'research' || action === 'continue-research') {
        const errors = { ...validEntry(p), ...readCampaignForm(new URLSearchParams(p.input), 'confirm').errors };
        if (Object.keys(errors).length) return show(400, 'Перед платным исследованием исправьте входные данные.', errors);
        if (!p.profile || p.profile.confirmedHash !== profileHash(p)) throw new DirectError('Сначала подтвердите актуальные факты бизнеса.');
        if (!wordstat || !intelligence || !geo) throw new DirectError('Для исследования нужны Wordstat, DeepSeek и справочник регионов. Можно заполнить фразы вручную.');
        if (one(form, 'researchConsent') !== 'yes' || one(form, 'judgeConsent') !== 'yes') throw new DirectError('Подтвердите запросы Wordstat и одну оценку DeepSeek.');
        const regions = await geo(owner), matches = regions.filter(r => r.GeoRegionName.toLocaleLowerCase('ru') === p.input.region.toLocaleLowerCase('ru'));
        if (matches.length !== 1) throw new DirectError('Регион не определён однозначно. Укажите точное название города или региона.');
        const regionId = directId(matches[0].GeoRegionId), rh = researchHash(p, regionId), jh = judgmentHash(p);
        const parent = action === 'continue-research' ? db.readRun(owner, one(form, 'runId'))?.value : undefined;
        if (action === 'continue-research' && (!parent || parent.researchHash !== rh || parent.judgmentHash !== jh || parent.status !== 'stopped' || parent.attempts.some(a => a.status === 'unknown' || a.status === 'pending')))
          throw new DirectError('Неизвестный или изменённый запрос не повторяется. Используйте сохранённые данные вручную.');
        const key = `research:${rh}:${jh}${parent ? ':' + parent.id : ''}`;
        const old = db.readRuns(owner).find(r => r.key === key);
        if (old) { p.activeRunId = old.id; saveHere(); return show(200, 'Показана сохранённая попытка. Повторной оплаты нет.'); }
        const run: StrategyRun = { id: randomUUID(), key, kind: 'research', input: structuredClone(p.input), profileHash: profileHash(p), researchHash: rh,
          judgmentHash: jh, status: 'running', plan: newStrategyPlan(p.input, p.baseCampaignRevision), attempts: [] };
        run.geoSnapshot = geoSnapshot(regions); run.plan.regionId = regionId; run.plan.strategy.profile = structuredClone(p.profile.value);
        confirmStrategy(run.plan, p.profile.value.offers.map(o => o.id));
        const earlier = db.readRuns(owner).filter(r => r.kind === 'research' && r.plan.regionId === regionId);
        for (const request of run.plan.strategy.requests) {
          const previous = parent?.plan.strategy.requests.find(r => r.seed === request.seed);
          const cached = earlier.flatMap(r => r.plan.strategy.requests).find(r => r.seed === request.seed && r.phase === 'complete' && Date.now() - Date.parse(r.at!) <= 86400000);
          if (previous) Object.assign(request, structuredClone(previous)); else if (cached) Object.assign(request, structuredClone(cached), { offerId: request.offerId });
        }
        const unknownInputs = db.readRuns(owner).flatMap(r => r.attempts).filter(a => a.kind === 'wordstat' && ['pending', 'unknown'].includes(a.status)).map(a => hash(a.input));
        if (run.plan.strategy.requests.some(r => r.phase === 'ready' && unknownInputs.includes(hash({ seed: r.seed, regionId }))))
          throw new DirectError('Результат прежнего Wordstat по этому направлению и региону неизвестен. Смена объявления не разрешает повтор: используйте сохранённые данные вручную.');
        if (parent && !run.plan.strategy.requests.some(r => r.phase === 'ready')) throw new DirectError('Неотправленных направлений больше нет. Сохранённые данные доступны вручную.');
        p.activeRunId = run.id; p.step = 3; revision = save(owner, p, revision, run).revision;
        let runRevision = 1;
        const persist = () => { runRevision = db.saveRun(owner, run, runRevision); };
        let stop = false;
        for (const request of run.plan.strategy.requests) {
          if (request.phase !== 'ready') continue;
          if (db.readPreparation(owner)?.revision !== revision) { stop = true; run.plan.strategy.note = 'Ввод изменился. Неотправленные запросы остановлены.'; break; }
          const attempt: Attempt = { id: randomUUID(), kind: 'wordstat', input: { seed: request.seed, regionId }, at: new Date().toISOString(), status: 'pending' };
          run.attempts.push(attempt); request.phase = 'pending'; request.at = attempt.at; run.plan.wordstatAttempted = true; persist();
          try { request.results = await wordstat(request.seed, regionId); request.phase = 'complete'; request.at = new Date().toISOString(); attempt.status = 'succeeded'; attempt.result = request.results; }
          catch (error) { attempt.status = failure(error); attempt.error = 'Ответ Wordstat не получен. Повтор не выполнялся.';
            if (error instanceof DirectError && 'notSent' in error) { attempt.notSent = true; attempt.error = error.message; }
            request.phase = 'failed'; stop = true; }
          attempt.finishedAt = new Date().toISOString(); persist(); if (stop) break;
        }
        run.plan.strategy.candidates = gatherCandidates(run.plan, run.input, regions);
        // A single bounded judgment leaves output-token headroom; the rest remain for manual review.
        const candidates = judgmentCandidates(run.plan).slice(0, 80); let meanings: Meaning[] = []; let grounded: any;
        if (!stop && candidates.length && db.readPreparation(owner)?.revision === revision) {
          const attempt: Attempt = { id: randomUUID(), kind: 'judge', input: intelligence.groundedJudge ? groundedPayload(run.input,run.plan.strategy.profile!,candidates).input : { profile: run.plan.strategy.profile, title: run.input.title,
            adText: run.input.adText, region: run.input.region, candidates, limit: 80, version: 'judge-v3' }, at: new Date().toISOString(), status: 'pending' };
          if(intelligence.groundedJudge){const payload=groundedPayload(run.input,run.plan.strategy.profile!,candidates);Object.assign(attempt,{contract:{schemaVersion:payload.schemaVersion,promptVersion:payload.promptVersion,promptHash:payload.promptHash,factsHash:payload.factsHash,policyHash,payloadHash:payload.payloadHash,maxOutputTokens:payload.max_tokens,timeoutMs:payload.timeoutMs,responseBytes:payload.responseBytes}});}
          run.attempts.push(attempt); run.plan.strategy.phase = 'judge-pending'; persist();
          try { if (intelligence.groundedJudge) { grounded = await intelligence.groundedJudge(run.input, run.plan.strategy.profile!, candidates, meta => Object.assign(attempt,meta)); attempt.result = grounded; validateGrounded(grounded,groundedPayload(run.input,run.plan.strategy.profile!,candidates)); } else meanings = validateMeanings({ judgments: await intelligence.judge(run.input, run.plan.strategy.profile!, candidates, meta => Object.assign(attempt, meta)) }, run.plan.strategy.profile!, candidates);
            attempt.status = 'succeeded'; attempt.result = grounded ?? meanings; run.plan.strategy.judgeSource = 'ai'; }
          catch (error) { attempt.status = failure(error); attempt.error = 'Смысловая оценка не получена полностью. Автоматического повтора нет.';
            if (error instanceof DirectError && 'notSent' in error) { attempt.notSent = true; attempt.error = error.message; } stop = true; }
          attempt.finishedAt = new Date().toISOString(); persist();
        }
        if (grounded && !stop) applyGrounded(run.plan, run.input, regions, grounded); else applyMeanings(run.plan, meanings, researchEvaluation(run)); run.plan.strategy.evaluated = grounded?.judgments.length ?? meanings.length;
        run.plan.source = run.plan.strategy.requests.some(r => r.phase === 'complete') ? 'wordstat' : 'business'; run.plan.notice = wordstatNotice;
        run.plan.strategy.phase = 'complete'; run.status = stop ? 'stopped' : 'complete'; persist();
        return { status: 200, view: view(owner), message: stop ? 'Исследование неполное. Полученные ответы сохранены; проверьте фразы вручную.' : 'Исследование сохранено. Проверьте выбранные фразы.' };
      }
      if (action === 'offer') {
        const { errors } = readCampaignForm(new URLSearchParams(p.input), 'confirm');
        if (Object.keys(errors).length) return show(400, 'Исправьте поля объявления.', errors);
        if (p.profile?.confirmedHash !== profileHash(p)) throw new DirectError('Подтвердите актуальное понимание бизнеса.');
        const run = db.readRun(owner, p.activeRunId)?.value;
        const usable = run && ['research','derived','rejudge'].includes(run.kind) && run.profileHash === profileHash(p) && run.judgmentHash === judgmentHash(p);
        const selected = form.getAll('selected');
        const additional = lines(one(form, 'phrases'));
        const candidates = usable ? run.plan.candidates : [];
        if (selected.some(s => !candidates.some(c => c.phrase === s))) throw new DirectError('Выбранный список относится к другому исследованию.');
        p.selection.phrases = readPhrases([...selected, ...additional]);
        p.selection.negatives = [...new Map([...lines(one(form, 'negatives')), ...p.profile.value.exclusions.map(x => x.phrase)].map(s => [phraseKey(s), s])).values()];
        if (p.selection.negatives.length) p.selection.negatives = readPhrases(p.selection.negatives, 20);
        if (p.selection.phrases.some(s => run?.plan.strategy.candidates.some(c => c.phrase === s && c.decision === 'exclude') && usable)) throw new DirectError('Исключённая фраза не допускается к объявлению.');
        if (p.selection.negatives.some(n => p.selection.phrases.some(s => n.split(' ').every(w => s.split(' ').includes(w))))) throw new DirectError('Исключение перекрывает выбранную фразу.');
        const snapshot = snapshotFor(owner,run);
        if (snapshot && p.selection.phrases.some(phrase => geographyGuard(phrase,run?.plan.regionId ?? '',snapshot.rows).status === 'foreign')) throw new DirectError('Фраза содержит доказанную чужую географию.');
        const automatic = !additional.length && automaticSelection(p, run);
        if (!automatic && one(form, 'manualReview') !== 'yes') throw new DirectError('Подтвердите ручную проверку списка: спрос и соответствие могли не оцениваться.');
        p.selection.source = automatic ? 'strategy' : 'manual'; p.selection.checkedHash = selectionHash(p); p.step = 4; saveHere();
        return show(200, 'Предложение сохранено. Проверьте и подтвердите весь план.');
      }
      if (action === 'confirm') {
        if (one(form, 'confirmPlan') !== 'yes') throw new DirectError('Подтвердите сводку плана.');
        const errors = { ...validEntry(p), ...readCampaignForm(new URLSearchParams(p.input), 'confirm').errors };
        if (Object.keys(errors).length) return show(400, 'Исправьте обязательные поля.', errors);
        if (!p.profile || p.profile.confirmedHash !== profileHash(p)) throw new DirectError('Понимание бизнеса требует подтверждения.');
        validateProfile(p.profile.value, p.input.description);
        if (!p.selection.phrases.length || p.selection.checkedHash !== selectionHash(p)) throw new DirectError('Список фраз или объявление изменились. Проверьте рекламное предложение.');
        // Commit requires the exact stored workspace, never a hidden form's unpersisted replacement.
        if (hash(p) !== hash(before.value)) throw new DirectError('Сначала сохраните внесённые изменения.');
        let result: CampaignPlan | undefined;
        const run = db.readRun(owner, p.activeRunId)?.value;
        if (p.selection.source === 'strategy' && !automaticSelection(p, run)) throw new DirectError('Автоматический список устарел или изменился. Вернитесь к предложению и проверьте его как ручной либо обновите исследование.');
        if (run?.profileHash === profileHash(p) && run.judgmentHash === judgmentHash(p) && p.selection.phrases.some(s => run.plan.strategy.candidates.some(c => c.phrase === s && c.decision === 'exclude')))
          throw new DirectError('В списке есть исключённая фраза. Проверьте рекламное предложение.');
        const ok = db.saveCampaign(owner, p.input, p.baseCampaignRevision, actor, savedRevision => {
          result = db.commitPlan(owner, p, revision, savedRevision, run && ['research','derived','rejudge'].includes(run.kind) && run.profileHash === profileHash(p) ? run.plan.regionId : undefined);
          const projected = run && ['research','derived','rejudge'].includes(run.kind) && p.selection.source === 'strategy' ? structuredClone(run.plan) : {
            id: result!.id, revision: savedRevision, offer: p.input.title, region: p.input.region, regionId: '', at: result!.confirmedAt, source: 'business' as const,
            wordstatAttempted: false, notice: 'Ручной список. Спрос и частотность не проверены.', candidates: p.selection.phrases.map(phrase => ({ phrase, source: 'business' as const, count: null, selected: true, reason: 'Проверено владельцем вручную.' })), selectionVersion: 3, manualSelectionConfirmed: true };
          projected.policyHash = policyHash;
          projected.id = result!.id; projected.revision = savedRevision;
          projected.candidates.forEach(c => { c.selected = p.selection.phrases.includes(c.phrase); });
          db.savePhrasePlan(owner, projected);
        });
        if (!ok) throw new DirectError('Объявление изменилось в другой вкладке. Подтверждение не записано.');
        return { status: 200, view: view(owner), message: `План подтверждён. Рекламные объекты не создавались. Версия ${result!.preparationRevision}.` };
      }
      return show(400, 'Действие подготовки не поддерживается.');
    } catch (error) {
      if (error instanceof PreparationConflict) return conflict(error.message);
      return show(error instanceof DirectError ? 409 : 500, error instanceof DirectError ? error.message : 'Не удалось завершить подготовку. Сохранённые ответы доступны; автоматического повтора нет.');
    }
  }
  return { view, action };
}
