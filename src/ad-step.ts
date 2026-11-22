import { escapeHtml as e } from './operations-page.ts';
import { uiIcon } from './ui-icons.ts';
import type { PreparationView } from './preparation.ts';
import { researchCandidateReason, researchGroundingIssue } from './preparation.ts';
import type { DirectView } from './direct.ts';
import type { StrategyRun } from './campaign-plan.ts';
import { judgmentHash, profileHash, selectionHash } from './campaign-plan.ts';
import { researchRequests } from './phrase-strategy.ts';
import { phraseKey } from './search-phrases.ts';
import { policyHash } from './phrase-policy.ts';

type Button = (action: string, label: string, primary?: boolean, extra?: string) => string;
type Consent = (name: string, text: string) => string;
type TextField = (name: 'title' | 'adText', hint: string, required: boolean) => string;

function phraseField(name: 'phrases' | 'negatives', label: string, hint: string, placeholder: string, values: string[], error?: string) {
  const id = 'plan-' + name;
  return `<div class="field phrase-editor" data-phrase-editor>
    <label for="${id}">${label}</label>
    <p class="phrase-help" id="${id}-hint">${hint}</p>
    <textarea name="${name}" id="${id}" aria-describedby="${id}-hint${error ? ` ${id}-error` : ''}"${error ? ' aria-invalid="true"' : ''} placeholder="${e(placeholder)}" rows="2">${e(values.join('\n'))}</textarea>
    ${error ? `<p class="field-error" id="${id}-error">${e(error)}</p>` : ''}
    <noscript><p class="hint">Можно также вводить по одной фразе на строку.</p></noscript>
  </div>`;
}

function researchLog(run: StrategyRun, cached: boolean, ai: boolean, post: Button, check: Consent) {
  return `<details class="ad-diagnostics"><summary>Источники и повторная оценка</summary><p>${e(run.plan.notice)}</p>
    ${run.plan.strategy.note ? `<p>${e(run.plan.strategy.note)}</p>` : ''}
    <p>Ответов Wordstat: ${run.plan.strategy.requests.filter(r=>r.phase==='complete').length} из ${run.plan.strategy.requests.length}. Оценено фраз: ${run.plan.strategy.evaluated ?? 0} из ${run.plan.strategy.candidates.length}.</p>
    <p>Правила: ${run.plan.policyHash === policyHash ? 'актуальные' : 'прежняя версия'}. ${run.derivation ? `Исходный подбор: ${e(run.derivation.sourceRunId)}. Пересмотр: ${e(run.derivation.processedAt)}.` : ''}</p>
    ${run.kind === 'rejudge' && run.status !== 'complete' ? post('recover-rejudge', 'Восстановить сохранённый ответ') : ''}
    ${post('reprocess', 'Пересмотреть без запросов', false, cached ? '' : ' disabled')}
    ${check('rejudgeConsent', 'Разрешаю один платный разбор до 80 сохранённых фраз в DeepSeek.')}
    ${post('rejudge', 'Запросить новую оценку', false, cached && ai ? '' : ' disabled')}
  </details>`;
}

function candidatesList(run: StrategyRun, selected: string[]) {
  const rows = run.plan.strategy.candidates;
  const chosen = new Set(selected.map(phraseKey));
  return `<div class="candidate-picker">
    <input type="hidden" name="candidateRun" value="${e(run.id)}">
    <p class="hint">Подбор: выбрано <span data-selected-count>${rows.filter(c => chosen.has(phraseKey(c.phrase)) && c.decision !== 'exclude').length}</span> из ${rows.length}.</p>
    <ul class="candidate-list">${rows.map((c,i) => {
      const rejected = c.decision === 'exclude';
      return `<li><label class="check"><input type="checkbox" id="candidate-${i}" name="selected" value="${e(c.phrase)}"${chosen.has(phraseKey(c.phrase)) && !rejected ? ' checked' : ''}${rejected ? ' disabled' : ''}><span><strong>${e(c.phrase)}</strong><small>${rejected ? 'Исключено' : c.decision === 'include' ? 'Подходит' : 'Проверьте'} · ${c.count === null ? 'Частота неизвестна' : 'Частота в Wordstat: ' + e(c.count)}</small></span></label></li>`;
    }).join('')}</ul>
    <details><summary>Почему выбраны эти фразы</summary><dl class="candidate-reasons">${rows.map(c => {
      const at = c.evidence[0]?.at ?? run.plan.at;
      const model = c.assessment?.model as {reason?: string} | undefined;
      return `<dt>${e(c.phrase)}</dt><dd>${e(researchCandidateReason(run,c))}${model?.reason ? ' ' + e(model.reason) : ''}
        ${(c.assessment?.geoQualifierOverrides ?? []).map(item=>e(item.reason)).join(' ')}
        <small>Получено ${e(new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))} МСК</small></dd>`;
    }).join('')}</dl></details></div>`;
}

export function renderAdStep(view: PreparationView, direct: DirectView | undefined, inputField: TextField, post: Button, check: Consent, campaignHref: string, connectionHref: string, preview: string) {
  const p = view.saved.value;
  const profile = p.profile?.value;
  const confirmed = p.profile?.confirmedHash === profileHash(p);
  const run = view.run && ['research', 'derived', 'rejudge'].includes(view.run.kind) ? view.run : undefined;
  const current = run?.profileHash === profileHash(p) && run.judgmentHash === judgmentHash(p) ? run : undefined;
  const candidates = current?.plan.strategy.candidates ?? [];
  const kept = p.selection.checkedHash === selectionHash(p) || Boolean(current && p.selection.editedRunId === current.id);
  const selected = kept ? p.selection.phrases : current?.plan.policyHash === policyHash ? candidates.filter(c=>c.selected).map(c=>c.phrase) : [];
  const candidateKeys = new Set(candidates.map(c=>phraseKey(c.phrase)));
  const manual = p.selection.phrases.filter(s=>!candidateKeys.has(phraseKey(s)));
  const seeds = profile ? researchRequests(profile).map(r => r.seed) : [];
  const needsConnection = direct?.ownChief && !direct.enabled;
  const groundingIssue = confirmed ? researchGroundingIssue(p) : '';
  const researchEnabled = view.wordstat && view.ai;
  const available = researchEnabled && confirmed && !needsConnection && !groundingIssue;
  const failure = current?.attempts.findLast(a => a.status !== 'succeeded');
  const canContinue = current?.status === 'stopped' && current.plan.strategy.requests.some(r => r.phase === 'ready') &&
    !current.attempts.some(a => ['pending','unknown'].includes(a.status));
  const complete = current?.status === 'complete';
  const unusable = !confirmed ? 'Сначала подтвердите предложения на шаге «О бизнесе».' : !researchEnabled
    ? 'Подбор фраз в этом кабинете недоступен. Укажите фразы вручную.'
    : needsConnection ? `Для подбора в вашем регионе <a href="${connectionHref}">подключите Яндекс Директ</a>.` : e(groundingIssue);
  const result = current ? current.status === 'running' ? 'Подбор начат. Проверьте сохранённое состояние.' : current.status === 'stopped' ? 'Подбор прерван'
    : candidates.length ? 'Подбор завершён' : 'Подбор завершён без подходящих фраз' : run ? 'Прежний подбор относится к другим условиям' : '';
  const wording = view.wordingVariants, wordingAttempt = view.wordingRun?.attempts[0];
  const variants = !p.guided ? '' : `<details class="wording-card"${wording || wordingAttempt ? ' open' : ''}><summary>Варианты текста с ИИ</summary>
    ${wording ? `<p>Черновики ИИ. Перед сохранением проверьте формулировки, цифры и условия.</p>
      <input type="hidden" name="wordingRun" value="${e(view.wordingRun!.id)}"><ul class="wording-variants">${wording.map((item, index) => `<li>
      <strong>${e(item.title)}</strong><p>${e(item.adText)}</p>
      <details><summary>Исходные факты</summary>${item.evidence.map(q => `<blockquote>${e(q)}</blockquote>`).join('')}</details>
      <button class="secondary" type="submit" name="variant" value="${index}" formaction="/preparation/use-wording" formnovalidate>Использовать вариант ${index + 1}</button></li>`).join('')}</ul>`
      : wordingAttempt ? `<p role="status">${wordingAttempt.status === 'pending' ? 'Ожидается ответ DeepSeek. Проверьте позже; текст можно заполнить вручную.' : e(wordingAttempt.error ?? 'Ответ не подтверждён. Продолжите вручную.')}</p>
        ${wordingAttempt.status === 'pending' ? `<a class="inline-link" href="${campaignHref}">Проверить состояние</a>` : ''}`
      : view.wordingAvailable ? `<p>DeepSeek предложит два объявления по описанию бизнеса. Варианты сохраняются в кампании.</p>
        ${check('wordingConsent', 'Разрешаю один платный запрос к DeepSeek с описанием бизнеса.')}${post('wording', 'Подготовить варианты', false, ' formnovalidate')}`
      : '<p>ИИ помощник недоступен для этого кабинета.</p><p>Используйте текст из описания или напишите свой.</p>'}
    </details>`;
  const openPhrases = !selected.length || manual.length > 0 || current?.status === 'stopped' || (complete && !candidates.length);
  return `<section class="ad-step" data-ad-step>
    <h2>Объявление</h2>
    <p>Проверьте заголовок и текст будущего объявления в Поиске Яндекса.</p>
    <div class="ad-composition"><div class="ad-fields">
      ${inputField('title', 'До 56 символов.', true)}
      ${inputField('adText', 'До 81 символа.', true)}
      ${p.guided ? '' : post('suggest-wording', 'Взять текст из описания', false, ' formnovalidate')}
    </div>${preview}</div>
    ${variants}
    <section class="search-targets">
      <div class="section-heading"><h3>Фразы для показа</h3></div>
      ${selected.length ? `<ul class="selected-phrases">${selected.map(phrase => `<li>${e(phrase)}</li>`).join('')}</ul>` : ''}
      ${result ? `<div class="research-result" role="status"><strong>${result}</strong>${current?.status === 'stopped' ? `<p>${e(failure?.error || current.plan.strategy.note || 'Проверьте доступ к источникам.')} Полученные фразы можно проверить вручную.</p>` : ''}${current?.status === 'running' ? `<p><a href="${campaignHref}">Проверить состояние</a></p>` : ''}</div>` : ''}
      <details class="phrases-editor"${openPhrases ? ' open' : ''}><summary>${uiIcon('edit', 16)} Проверить фразы и исключения</summary>
        <input type="hidden" name="selectionEditor" value="yes">
        ${current && candidates.length ? candidatesList(current, selected) : ''}
        ${phraseField('phrases', 'Свои фразы', 'Введите фразы, которыми клиент ищет ваше предложение. Несколько фраз можно разделить запятыми.', 'Например, доставка роллов', manual, view.errors?.phrases)}
        ${phraseField('negatives', 'Минус-слова', 'Укажите слова или фразы, по которым объявление показывать не нужно. Разделите их запятыми.', 'Например, вакансии', p.selection.negatives, view.errors?.negatives)}
        ${profile?.exclusions.length ? `<p class="hint">Из условий бизнеса также добавятся исключения: ${profile.exclusions.map(x=>e(x.phrase)).join(', ')}.</p>` : ''}
      </details>
      ${available && (!current || complete || canContinue) ? `<details class="ai-setup"><summary>${uiIcon('search',16)} Подобрать фразы с Wordstat</summary>
        <p>Wordstat найдёт запросы по направлениям «${seeds.map(e).join('», «')}». Смысловая проверка отберёт те, которые подходят объявлению.</p>
        ${check('researchConsent', seeds.length === 1
          ? 'Разрешаю платный запрос Wordstat по этому направлению и региону'
          : 'Разрешаю платные запросы Wordstat по этим направлениям и региону. По одному запросу на каждое направление.')}
        ${check('judgeConsent', 'Разрешаю платную смысловую проверку фраз с ИИ-помощником')}
        ${canContinue ? `<input type="hidden" name="runId" value="${e(current!.id)}">` : ''}
        ${post(canContinue ? 'continue-research' : 'research', canContinue ? 'Продолжить подбор' : 'Начать подбор', true, ' data-research-submit')}
        <div data-research-progress role="status" hidden><p data-progress-text>Проверяем регион для подбора…</p><a href="${campaignHref}" target="_blank" rel="noopener" hidden>Открыть сохранённое состояние</a></div>
      </details>` : !available ? `<details class="ai-unavailable"><summary>Подбор фраз в Wordstat</summary><p>${unusable}</p>${p.guided && confirmed && researchEnabled && needsConnection ? '<p>До подключения можно сохранить ручной список.</p><p>Географию Директ проверит перед созданием.</p>' : ''}</details>` : ''}
      ${run ? researchLog(run, Boolean(view.cached), view.ai, post, check) : ''}
    </section></section>`;
}
