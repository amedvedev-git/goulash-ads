import { campaignLimits, validCampaignText } from './campaign.ts';
import type { openDatabase } from './database.ts';
import { DirectError } from './direct-api.ts';
import { campaignWorkspaceRun, type DirectState } from './direct.ts';
import { escapeHtml as e } from './html.ts';
import { renderDirectNumber } from './direct-page.ts';

type Copy = { title: string; adText: string };
export type CampaignCreativeReview = Copy & { original: Copy & { url: string }; at: string; actor: string };

function originalCopy(run: DirectState | undefined): CampaignCreativeReview['original'] | undefined {
  if (!run?.complete || run.pilot || !run.checkedAt || !run.storageRevision) return;
  const { campaign, ad } = run.steps;
  const snapshot = run.snapshot?.ad, responsive = snapshot?.ResponsiveAd;
  if (campaign.phase !== 'confirmed' || ad.phase !== 'confirmed' || !campaign.id || !ad.id ||
    String(run.snapshot?.campaign?.Id) !== campaign.id || String(snapshot?.Id) !== ad.id ||
    String(snapshot?.CampaignId) !== campaign.id || responsive?.Titles?.length !== 1 || responsive?.Texts?.length !== 1) return;
  const title = responsive.Titles[0]?.Title, adText = responsive.Texts[0]?.Text, url = responsive.Href;
  if (typeof title === 'string' && typeof adText === 'string' && typeof url === 'string') return { title, adText, url };
}

export function saveCampaignCreativeReview(db: ReturnType<typeof openDatabase>, owner: string, workspace: string, form: URLSearchParams, actor: string) {
  const one = (key: string) => form.getAll(key).length === 1 ? form.get(key)! : '';
  const latest = () => {
    const preparation = db.readPreparation(owner, workspace);
    return campaignWorkspaceRun(db.readCampaignDirectRuns(owner, workspace), preparation ? preparation.value.guided : true);
  };
  const initial = (workspace === 'default' || db.readCampaignWorkspace(owner, workspace)) && latest();
  if (!initial || one('run') !== initial.planId) throw new DirectError('Подтверждённое объявление этой кампании не найдено.');
  const unlock = db.lockDirect(initial.account);
  try {
    return db.directTransaction(() => {
      const run = latest(), snapshot = originalCopy(run);
      if (!run || !snapshot || run.planId !== initial.planId || run.account !== initial.account ||
        one('revision') !== String(run.storageRevision))
        throw new DirectError('Кампания уже изменилась. Обновите страницу перед сохранением.');
      const title = one('title').trim(), adText = one('adText').trim(), current = run.creativeReview;
      if (!validCampaignText('title', title) || !validCampaignText('adText', adText))
        throw new DirectError(`Введите заголовок до ${campaignLimits.title} и текст до ${campaignLimits.adText} символов. Используйте одну строку в каждом поле.`);
      const original = current?.original ?? snapshot;
      if (title === original.title && adText === original.adText) throw new DirectError('Измените заголовок или текст объявления.');
      if (current?.title === title && current.adText === adText) return current;
      const review = { title, adText, original, at: new Date().toISOString(), actor };
      run.creativeReview = review;
      db.saveDirect(owner, run);
      return review;
    });
  } finally { unlock(); }
}

export function renderCampaignCreativeReview(workspace: string, run: DirectState, input?: Copy) {
  const snapshot = originalCopy(run);
  if (!snapshot) return '';
  const saved = run.creativeReview, original = saved?.original ?? snapshot;
  const { title, adText } = input ?? saved ?? original;
  const { rejected, explanation } = moderationResult(run);
  const direct = 'https://direct.yandex.ru/';
  const status = input ? 'Изменения ещё не сохранены.' : saved ? 'Предложенная правка сохранена в Goulash.' : 'Исходный текст из Директа.';
  return `<section class="campaign-content-section creative-review" id="creative-review" aria-labelledby="creative-review-heading">
    <h3 id="creative-review-heading">Правка объявления</h3>
    ${rejected ? `<div class="notice error"><p><strong>Директ отклонил объявление.</strong> ${explanation ? e(explanation) : 'В Директ Про найдите кампанию по номеру из подробностей ниже. Рядом со статусом объявления откройте «Как исправить?».'}</p></div>` : ''}
    <form method="post" action="/campaign/creative-review?ad=${encodeURIComponent(workspace)}" data-creative-editor
      data-saved-title="${e((saved ?? original).title)}" data-saved-text="${e((saved ?? original).adText)}" data-creative-saved="${Boolean(saved)}">
      <input type="hidden" name="run" value="${e(run.planId)}">
      <input type="hidden" name="revision" value="${run.storageRevision}">
      <div class="notice recovery" data-creative-recovery hidden>
        <p>В этой вкладке осталась несохранённая правка объявления.</p>
        <button class="secondary" type="button" data-restore-creative>Восстановить ввод</button>
        <button class="text-button" type="button" data-discard-creative>Удалить сохранённый ввод</button>
      </div>
      <div class="field"><label for="creative-title">Заголовок</label><input id="creative-title" name="title" value="${e(title)}" maxlength="${campaignLimits.title}" required></div>
      <div class="field"><label for="creative-text">Текст</label><textarea id="creative-text" name="adText" rows="3" maxlength="${campaignLimits.adText}" required>${e(adText)}</textarea></div>
      <button class="primary" type="submit" aria-describedby="creative-apply-note">Сохранить предложенную правку</button>
      <p class="hint" id="creative-apply-note">После сохранения перенесите правку в Директ Про.</p>
      <section class="campaign-content-section creative-preview" aria-labelledby="creative-preview-title">
        <h3 id="creative-preview-title">Предпросмотр</h3>
        <div class="ad-preview"><span class="ad-tag">Реклама в поиске</span><p class="ad-url">${e(original.url)}</p>
          <p class="ad-title" data-creative-title>${e(title)}</p><p data-creative-text>${e(adText)}</p></div>
        <p class="hint" role="status" data-creative-status>${status}</p>
      </section>
    </form>
    <details class="campaign-fold"><summary>Исходный текст и номера в Директе</summary>
      <div class="ad-preview"><p class="ad-title">${e(original.title)}</p><p>${e(original.adText)}</p></div>
      ${renderDirectNumber('Номер кампании', 'creative-campaign-number', run.steps.campaign.id!)}
      ${renderDirectNumber('Номер объявления', 'creative-ad-number', run.steps.ad.id!)}
      <p>${saved ? 'Откройте в Директ Про раздел «Кампании» и введите номер кампании из подробностей в поле рядом с фильтром. Найдите объявление, перенесите сохранённый текст и проверьте бюджет и показы перед модерацией.'
        : 'Сохраните правку в Goulash, затем перенесите новый текст в объявление в Директ Про.'}</p>
      <a class="button secondary" href="${direct}" target="_blank" rel="noopener noreferrer">Открыть Директ Про</a>
    </details>
  </section>`;
}

export function moderationResult(run: DirectState) {
  const observed = run.launch?.observation, ad = run.snapshot?.ad;
  const later = observed?.adStatus && (!run.checkedAt || observed.checkedAt >= run.checkedAt);
  const status = later ? observed.adStatus : ad?.Status;
  const rejected = status === 'REJECTED';
  const reason = later ? observed.adStatusClarification : ad?.StatusClarification;
  return { status, rejected, explanation: rejected && typeof reason === 'string' ? reason.trim() : '' };
}
