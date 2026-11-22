import { emptyCampaign, exampleCampaign, readCampaignForm } from './campaign.ts';
import type { CampaignDraft, CampaignView } from './campaign.ts';
import { emptyAnalysis, exampleAnalysis, localAnalysis } from './business-analysis.ts';
import type { createDeepSeekTrial } from './business-analysis.ts';
import type { openDatabase } from './database.ts';

export const campaignActions = new Set(['preview', 'save', 'analyze', 'confirm', 'deepseek', 'back', 'resume', 'resolve', 'example']);
type Result = { status: number; message?: string; campaign?: CampaignView; location?: string };
const keys = ['description', 'url', 'region', 'budget', 'period', 'title', 'adText'] as const;

// Navigation carries working values, never writes them. The only write is the explicit save below.
export async function campaignAction(action: string, form: URLSearchParams, database: ReturnType<typeof openDatabase>,
  owner: string, actor: string, deepSeekTrial: CampaignView['deepSeekTrial'], runTrial?: ReturnType<typeof createDeepSeekTrial>): Promise<Result> {
  const saved = database.readCampaign(owner);
  const currentRevision = saved?.revision ?? 0;
  const fallback = saved?.draft ?? { ...emptyCampaign, title: '', adText: '' };
  const pending = Object.fromEntries(keys.map(key => [key, (form.get(key) ?? fallback[key]).slice(0, 4096)])) as CampaignDraft;
  const revisionText = form.get('revision') ?? '';
  const revisionValid = form.getAll('revision').length === 1 && /^(0|[1-9]\d{0,8})$/.test(revisionText);
  const revision = revisionValid ? Number(revisionText) : -1;
  const view = (step: 1 | 2 | 3, extra: Partial<CampaignView> = {}): CampaignView => ({
    input: pending, preview: saved?.draft, pending, revision, step, dirty: true, deepSeekTrial, ...extra,
  });
  const conflict = (): Result => ({ status: 409,
    message: 'Черновик изменился в другой вкладке. Ваш ввод сохранён ниже. Сравните версии перед сохранением.',
    campaign: view(3, { conflictRevision: currentRevision, conflict: true }),
  });
  if (!revisionValid && action !== 'resolve') return { status: 409, message: 'Не удалось определить версию. Откройте сохранённый черновик; ваш ввод оставлен ниже.',
    campaign: view(3, { conflict: true, conflictRevision: currentRevision }) };
  if (action === 'back' || action === 'resume') {
    const step = form.get('step') === '1' ? 1 : form.get('step') === '2' ? 2 : 3;
    return { status: 200, campaign: view(step) };
  }
  if (action === 'example') {
    const example = { ...pending, ...exampleCampaign };
    return { status: 200, message: 'Исходные данные заполнены примером. Ваши формулировки объявления сохранены.',
      campaign: view(1, { pending: example, input: example }) };
  }
  const writing = action === 'save' || action === 'resolve';
  const target = form.get('currentRevision') ?? '';
  const validTarget = form.getAll('currentRevision').length === 1 && /^(0|[1-9]\d{0,8})$/.test(target);
  if (action === 'resolve' && (form.get('resolution') !== 'replace' || !validTarget)) return { status: 400,
    message: 'Подтвердите замену актуальной версии вашим вариантом или вернитесь к сохранённому черновику.',
    campaign: view(3, { conflictRevision: currentRevision, conflict: true }) };
  const writeRevision = action === 'resolve' ? Number(target) : revision;
  if (writing && writeRevision !== currentRevision) return conflict();
  const full = writing || action === 'confirm';
  // Old saved drafts can be edited by existing clients that omit an unchanged description.
  const validatedForm = new URLSearchParams(form);
  if (writing && !validatedForm.has('description') && saved) validatedForm.set('description', saved.draft.description);
  const { value, errors } = readCampaignForm(validatedForm, full ? 'confirm' : 'entry');
  if (Object.keys(errors).length) {
    const step = errors.description || (action === 'confirm' && Object.keys(errors).some(key => !['title', 'adText'].includes(key))) ? 1 : writing ? 3 : action === 'confirm' ? 2 : 1;
    return { status: 400, message: 'Исправьте отмеченные поля. Введённые данные сохранены в форме.',
      campaign: view(step, { errors, editing: writing }) };
  }
  if (writing) {
    if (!database.saveCampaign(owner, value, writeRevision, actor)) {
      const latest = database.readCampaign(owner);
      return { ...conflict(), campaign: view(3, { preview: latest?.draft, conflictRevision: latest?.revision ?? 0, conflict: true }) };
    }
    return { status: 303, location: '/?campaign=saved' };
  }
  if (action === 'confirm') return { status: 200, campaign: view(3, { pending: value, input: value }) };
  if (action === 'preview') {
    // Compatibility route: preparing a candidate is now read-only, even for older clients.
    const candidate = { ...value, title: pending.title || value.title, adText: pending.adText || value.adText };
    return { status: 200, campaign: view(3, { pending: candidate, input: candidate }) };
  }
  let analysis: CampaignView['analysis'];
  let trialStatus = deepSeekTrial;
  let failure = '';
  let status = 200;
  if (action === 'deepseek' && runTrial) {
    if (value.description !== exampleCampaign.description) return { status: 400,
      message: 'Для запроса DeepSeek загрузите вымышленный пример и сохраните его описание без изменений.', campaign: view(1) };
    if (database.startDeepSeekTrial()) {
      let result: Awaited<ReturnType<typeof runTrial>> | undefined;
      try { result = await runTrial(); }
      catch (error) {
        const code = error instanceof Error ? /^Business analysis unavailable \(HTTP (\d{3})\)$/.exec(error.message)?.[1] : undefined;
        failure = code ? `DeepSeek вернул HTTP ${code}. ` : '';
      }
      database.finishDeepSeekTrial(result);
    }
    const trial = database.readDeepSeekTrial();
    trialStatus = trial?.status;
    if (trial?.status === 'completed') analysis = { ...trial.result.analysis, source: 'provider', usage: trial.result.usage };
    else if (trial?.status === 'failed') {
      status = 502; failure += 'Проба завершилась без проверенного ответа. Можно продолжить вручную.';
      analysis = { ...emptyAnalysis, source: 'manual' };
    } else return { status: 409, message: 'Попытка уже учтена. Дождитесь ответа в первой вкладке.', campaign: view(1, { deepSeekTrial: 'started' }) };
  } else {
    const local = localAnalysis(value.description);
    analysis = { ...local, source: local === exampleAnalysis ? 'example' : 'manual' };
  }
  // Existing wording is authoritative. A new suggestion is shown separately and must be chosen.
  const candidate = { ...value, title: pending.title || analysis.offer, adText: pending.adText || analysis.angle };
  return { status, message: failure, campaign: view(2, { pending: candidate, input: candidate, analysis, deepSeekTrial: trialStatus }) };
}
