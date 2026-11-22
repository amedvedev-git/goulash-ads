import { escapeHtml as e } from './operations-page.ts';
import type { DirectView } from './direct.ts';
import type { CampaignView } from './campaign.ts';
const hidden = (key: string, v: string | number) => `<input type="hidden" name="${key}" value="${e(String(v))}">`;
export function renderStrategy(view: DirectView, campaign: CampaignView) {
  if (!campaign.preview) return '<p>Сначала сохраните черновик.</p>';
  const plan = view.phrasePlan, s = plan?.strategy, profile = s?.phase === 'confirmed' ? s.proposal ?? s.profile : s?.profile;
  const fresh = plan && plan.revision === campaign.revision && Date.now() - Date.parse(plan.at) <= 86400000;
  const phases = { ready: 'Ещё не проверено', pending: 'Ответ неизвестен — повтор остановлен', complete: 'Ответ сохранён', failed: 'Ответ не получен' };
  const requestCount = s?.requests.filter(r => r.phase === 'ready').length ?? 0;
  return `<div class="phrase-preparation"><h3>Кому покажем объявление</h3><p>Подберём фразы, по которым люди в вашем регионе ищут ваше предложение.</p>
    ${!view.intelligenceEnabled ? '<p class="source-note">Смысловой разбор не подключён. Подключение DeepSeek описано в инструкции проекта. Прежние данные сохранены.</p>' : ''}
    <details class="preparation-disclosure"><summary>Какие сведения используются при подборе</summary><p>${e(campaign.preview.description)}</p><p>Объявление: ${e(campaign.preview.title)}. ${e(campaign.preview.adText)}</p><p>Регион: ${e(campaign.preview.region)}. Содержимое сайта автоматически не проверяется.</p></details>
    <details class="preparation-disclosure"${fresh && s ? '' : ' open'}><summary>Подобрать предложения с DeepSeek</summary><form method="post" action="/direct/strategy">${hidden('revision', campaign.revision)}${hidden('searchId', plan?.id ?? '')}<label class="check"><input type="checkbox" name="aiConsent" value="yes" required>Разрешаю передать описание и объявление DeepSeek для одного платного разбора.</label>
      <button class="secondary" type="submit"${s ? ' name="restart" value="yes"' : ''}${!view.intelligenceEnabled ? ' disabled' : ''}>${s ? 'Подготовить новый разбор' : 'Разобрать предложение'}</button><p class="hint">Новый разбор заменит текущую подборку. Созданные объявления сохранятся.</p></form></details>
    ${plan && !fresh ? '<p class="field-error">Стратегия относится к прежней версии или старше суток. Сохраните объявление и подготовьте актуальный разбор.</p>' : ''}
    ${s?.note ? `<p class="source-note">${e(s.note)}</p>` : ''}
    ${fresh && s?.phase === 'profile-pending' ? '<p role="status">Разбор не завершён. Неизвестный платный запрос не повторяется автоматически.</p>' : ''}
    ${fresh && profile ? `<h3>Что рекламируем</h3><p>Снимите выбор с неподходящих предложений. Чтобы поправить факты, измените описание бизнеса.</p>
      ${!s!.confirmed || s!.phase === 'confirmed' ? `<form method="post" action="/direct/strategy-confirm">${hidden('revision', campaign.revision)}${hidden('searchId', plan.id)}
        ${profile.offers.map(o => `<div class="phrase-row"><label class="check"><input type="checkbox" name="offerIds" value="${e(o.id)}"${!s!.confirmed || s!.profile!.offers.some(active => active.id === o.id) ? ' checked' : ''}><span><strong>${e(o.name)}</strong>${o.delivery ? ' · с доставкой' : ''}</span></label><p class="hint">Основание: «${e(o.evidence)}». ${o.aliases.length ? `Синонимы: ${o.aliases.map(e).join(', ')}.` : ''}</p></div>`).join('')}
        <p>Собственные бренды: ${profile.ownBrands.length ? profile.ownBrands.map(e).join(', ') : 'не указаны'}.</p>
        ${profile.exclusions.length ? `<p>Исключения: ${profile.exclusions.map(x => e(x.phrase)).join(', ')}.</p>` : ''}
        ${profile.uncertainty.length ? `<p>Неизвестно: ${profile.uncertainty.map(e).join('; ')}.</p>` : ''}
        <label class="check"><input type="checkbox" name="confirmProfile" value="yes" required>Подтверждаю выбранные предложения, синонимы и условия.</label><button class="secondary" type="submit">Подтвердить предложения и увидеть план поиска</button></form>`
        : `<ul>${profile.offers.map(o => `<li><strong>${e(o.name)}</strong>${o.aliases.length ? ` · ${o.aliases.map(e).join(', ')}` : ''}</li>`).join('')}</ul>`}` : ''}
    ${fresh && s?.confirmed ? `<h3>Что будем искать</h3><ol>${s.requests.map(r => `<li><strong>${e(r.seed)}</strong> — ${phases[r.phase]}${r.results ? ` · ${r.results.length} вариантов` : ''}</li>`).join('')}</ol>
      ${s.phase !== 'complete' ? `<form method="post" action="/direct/research">${hidden('revision', campaign.revision)}${hidden('searchId', plan.id)}
        <label class="check"><input type="checkbox" name="researchConsent" value="yes" required>Разрешаю до ${requestCount} платных запросов Wordstat по показанным направлениям.</label>
        <label class="check"><input type="checkbox" name="judgeConsent" value="yes" required>Разрешаю передать предложения и до 120 запросов DeepSeek для одной платной смысловой оценки.</label>
        <button class="secondary" type="submit"${!view.wordstatEnabled || !view.intelligenceEnabled ? ' disabled' : ''}>Исследовать спрос и отобрать фразы</button><p class="hint">Сохранённые ответы повторно не запрашиваются. После неизвестного ответа автоматического повтора нет.</p></form>`
        : `<details class="preparation-disclosure"><summary>Какие ответы получены</summary><ul>${s.coverage.map(c => `<li><strong>${e(profile!.offers.find(o => o.id === c.offerId)?.name ?? c.offerId)}</strong>: получены ответы ${c.checked} из ${c.planned}; выбрано ${c.selected} фраз.</li>`).join('')}</ul><p>Смысловая оценка: ${s.judgeSource === 'ai' ? 'получена от DeepSeek, применены ограничения сервиса' : 'не получена — автоматических рекомендаций нет'}. Оценено ${s.evaluated ?? 0} из ${s.candidates.length} вариантов; остальные доступны для ручного просмотра.</p><p><a href="/direct/research.json">Скачать исходные ответы и оценки</a></p></details>`}` : ''}</div>`;
}
