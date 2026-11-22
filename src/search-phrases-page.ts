import { escapeHtml as e } from './operations-page.ts';
import { renderStrategy } from './strategy-page.ts';
import type { DirectView } from './direct.ts';
import type { CampaignView } from './campaign.ts';

const hidden = (key: string, value: string | number) => `<input type="hidden" name="${key}" value="${e(String(value))}">`;
function renderCandidateSelection(view: DirectView, campaign: CampaignView) {
  if (!campaign.preview) return '<p>Сначала подготовьте и сохраните черновик выше.</p>';
  const plan = view.phrasePlan;
  if (!plan || (plan.strategy && plan.strategy.phase !== 'complete')) return '';
  const fresh = plan && plan.revision === campaign.revision && Date.now() - Date.parse(plan.at) <= 86400000;
  const input = view.input;
  const selected = input?.action === 'prepare' ? input.selected ?? [] : plan?.candidates.filter(c => c.selected).map(c => c.phrase) ?? [];
  const row = (candidate: NonNullable<typeof plan>['candidates'][number], index: number) => `<li class="phrase-row"><label class="check" for="phrase-${index}"><input id="phrase-${index}" type="checkbox" name="selected" value="${e(candidate.phrase)}"${selected.includes(candidate.phrase) ? ' checked' : ''}${(candidate as any).decision === 'exclude' ? ' disabled' : ''}><span><strong>${e(candidate.phrase)}</strong><br><span class="hint">${e(candidate.reason)} ${candidate.count !== null ? `Частота Wordstat: ${e(candidate.count)} · период не подтверждён.` : 'Сопоставимая частотность отсутствует.'}</span></span></label></li>`;
  return `<div class="phrase-preparation">
    ${plan && !fresh ? '<p class="field-error">Подбор относится к прежней версии или старше суток. Подготовьте фразы заново.</p>' : ''}
    ${fresh ? `<form method="post" action="/direct/prepare" class="direct-prepare">${hidden('revision', campaign.revision)}${hidden('phrasePlanId', plan.id)}
      <h3>Поисковые фразы</h3><p class="source-note">${e(plan.region)} · ${plan.strategy ? 'Подборка от' : 'Сохранённый список от'} ${e(new Date(plan.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} МСК</p><p>Частотность помогает оценить спрос; результат рекламы ещё не проверен.</p><details class="preparation-disclosure"><summary>Источник статистики и ограничения</summary><p>${e(plan.notice)}</p></details>
      <p>Выберите до 30 фраз. Спорные варианты требуют вашей ручной проверки.</p>
      <ul class="phrase-list">${plan.candidates.map((c, i) => c.selected ? row(c, i) : '').join('')}</ul>
      ${plan.candidates.some(c => !c.selected) ? `<details class="preparation-disclosure"><summary>Проверить другие варианты</summary><ul class="phrase-list">${plan.candidates.map((c, i) => !c.selected ? row(c, i) : '').join('')}</ul></details>` : ''}
      <details class="preparation-disclosure"${input?.action === 'prepare' && (input.negatives || input.additional) ? ' open' : ''}><summary>Добавить свои фразы или исключения</summary><div class="field"><label for="phrase-additional">Дополнительные поисковые фразы, по одной в строке</label><textarea id="phrase-additional" name="additional" rows="3" maxlength="1000">${e(input?.additional ?? '')}</textarea><p class="hint">До 10 фраз без операторов. Они не проверены Wordstat.</p></div><div class="field"><label for="phrase-negatives">Не показывать по этим словам и фразам, по одному в строке</label><textarea id="phrase-negatives" name="negatives" rows="3" maxlength="2000">${e(input?.negatives ?? view.state?.negatives?.join('\n') ?? '')}</textarea><p class="hint">До 20 исключений для всей группы, включая автотаргетинг. Укажите слова, которые точно не подходят вашему предложению.</p></div></details>
      <div class="field-grid"><div class="field"><label for="direct-name">Название кампании</label><input id="direct-name" name="name" maxlength="100" required value="${e(input?.action === 'prepare' ? input.name : view.state?.name.replace(/ \[[\da-f-]+\]$/, '') ?? 'Тестовая кампания')}"></div><div class="field"><label for="direct-weekly">Недельный бюджет Директа, ₽</label><input id="direct-weekly" type="number" min="300" max="100000" name="weekly" required value="${e(input?.action === 'prepare' ? input.weekly : view.state?.weekly ?? '300')}"><p class="hint">Общий лимит ${e(campaign.preview.budget)} ₽ за ${e(campaign.preview.period)} дней остаётся в плане Goulash. В Директ передаётся недельный бюджет.</p></div></div>
      ${plan.strategy ? '<label class="check"><input type="checkbox" name="manualReview" value="yes">Я отдельно проверил выбранные спорные и добавленные вручную фразы.</label>' : '<label class="check"><input type="checkbox" name="legacyManual" value="yes" required>Подтверждаю прежний список как ручной, без новой смысловой оценки.</label>'}<button class="secondary" type="submit">Подтвердить фразы и проверить параметры</button><p class="hint">После проверки вы увидите условия перед созданием черновика с выключенными показами.</p>
    </form>` : ''}</div>`;
}

export function renderPhrasePreparation(view: DirectView, campaign: CampaignView) {
  return renderStrategy(view, campaign) + renderCandidateSelection(view, campaign);
}
