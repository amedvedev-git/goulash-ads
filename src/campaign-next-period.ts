import { campaignLimits, directCalendarDate, validCampaignText } from './campaign.ts';
import type { openDatabase } from './database.ts';
import { DirectError } from './direct-api.ts';
import type { DirectState } from './direct.ts';
import { escapeHtml as e } from './html.ts';
import { campaignTabHref } from './routes.ts';

type Conditions = { amount: string; offer: string; region: string };
export type NextPeriod = { from: string; at: string; actor: string; before: Conditions; after: Conditions };

const price = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0, style: 'currency', currency: 'RUB' });
const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeZone: 'Europe/Moscow' });
const formatDate = (value: string) => date.format(new Date(value));

function conditions(run: DirectState) {
  return { amount: run.budget!.amountRub, offer: run.draft.description, region: run.regionName };
}

function firstDay(run: DirectState) {
  const today = directCalendarDate(), end = run.budget!.endDate;
  return new Date(Date.parse(end > today ? end : today) + 86_400_000).toISOString().slice(0, 10);
}

export function saveNextPeriod(db: ReturnType<typeof openDatabase>, owner: string, workspace: string, form: URLSearchParams, actor: string) {
  const one = (key: string) => form.getAll(key).length === 1 ? form.get(key)!.trim() : '';
  const latest = () => db.readCampaignWorkspace(owner, workspace) &&
    db.readCampaignDirectRuns(owner, workspace).findLast(item => item.guidedDraft);
  const initial = latest();
  if (!initial?.complete || !initial.budget || initial.pilot || initial.planId !== one('run'))
    throw new DirectError('Подтверждённый период кампании не найден.');
  const unlock = db.lockDirect(initial.account);
  try {
    const run = latest();
    if (!run?.budget || run.pilot || run.planId !== initial.planId || run.storageRevision !== initial.storageRevision ||
        String(run.storageRevision) !== one('revision'))
      throw new DirectError('Кампания изменилась. Откройте сводку заново.');
    const after = { amount: one('amount'), offer: one('offer'), region: one('region') };
    if (!/^[1-9]\d{3,6}$/.test(after.amount) || Number(after.amount) > 1_000_000)
      throw new DirectError('Укажите бюджет следующего периода от 1 000 до 1 000 000 ₽ без НДС.');
    if (!validCampaignText('description', after.offer) || !validCampaignText('region', after.region))
      throw new DirectError('Проверьте предложение и географию. Заполните оба поля.');
    const previous = run.nextPeriods?.at(-1);
    const before = previous?.after ?? conditions(run);
    const from = firstDay(run);
    if (from !== one('from')) throw new DirectError('Граница следующего периода изменилась. Проверьте новую дату.');
    if (previous?.from === from && before.amount === after.amount && before.offer === after.offer && before.region === after.region) return;
    run.nextPeriods = [...(run.nextPeriods ?? []).slice(-29), { from, at: new Date().toISOString(), actor, before, after }];
    db.saveDirect(owner, run);
  } finally { unlock(); }
}

export function renderNextPeriod(run: DirectState, workspace: string) {
  if (!run.complete || !run.budget || run.pilot) return '';
  const current = conditions(run), previous = run.nextPeriods?.at(-1), values = previous?.after ?? current;
  const from = firstDay(run);
  return `<section class="form-panel connect-card" id="next-period" aria-labelledby="next-period-title">
    <h2 id="next-period-title">Условия следующего периода</h2>
    <p>Бюджет стратегии ${e(price.format(Number(current.amount)))} без НДС до ${formatDate(run.budget.endDate)}.</p>
    ${previous ? `<p role="status">Черновик с ${formatDate(previous.from)} сохранён. <a href="${e(campaignTabHref(workspace, 'journal'))}#next-period-history">Открыть запись</a>.</p>` : ''}
    <details class="preparation-disclosure"><summary>Бюджет, предложение и география</summary>
      <p>Черновик с ${formatDate(from)} МСК. Для нового периода потребуется подтверждение настроек в Директе.</p>
      <form method="post" action="/campaign/next-period?ad=${encodeURIComponent(workspace)}">
        <input type="hidden" name="run" value="${e(run.planId)}"><input type="hidden" name="revision" value="${run.storageRevision}">
        <input type="hidden" name="from" value="${from}">
        <div class="field"><label>Лимит, ₽ без НДС<input name="amount" type="number" min="1000" max="1000000" step="1" value="${e(values.amount)}" required></label></div>
        <div class="field"><label>Предложение<textarea name="offer" maxlength="${campaignLimits.description}" rows="2" required>${e(values.offer)}</textarea></label></div>
        <div class="field"><label>География<input name="region" maxlength="${campaignLimits.region}" value="${e(values.region)}" required></label></div>
        <button class="secondary" type="submit">Сохранить черновик периода</button>
      </form>
    </details></section>`;
}

export function renderNextPeriodEntry({ from, at, actor, before, after }: NextPeriod) {
  return `<h3>Условия с ${formatDate(from)}</h3><p>${e(actor)} · ${formatDate(at)}</p>
    <dl class="preview-meta"><div><dt>Лимит без НДС</dt><dd>${e(price.format(Number(before.amount)))} → ${e(price.format(Number(after.amount)))}</dd></div>
    <div><dt>Предложение</dt><dd>${e(before.offer)} → ${e(after.offer)}</dd></div>
    <div><dt>География</dt><dd>${e(before.region)} → ${e(after.region)}</dd></div></dl>`;
}
