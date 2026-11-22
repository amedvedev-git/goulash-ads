import { hash } from './campaign-plan.ts';
import { DirectError } from './direct-api.ts';
import type { createAnalyticsService } from './analytics.ts';
import type { openDatabase } from './database.ts';
import type { DirectConnection, DirectState } from './direct.ts';
import { reportCpa } from './analytics-money.ts';
import { escapeHtml as e } from './html.ts';
import { campaignTabHref, routes } from './routes.ts';
import { optimizationExplanationFacts } from './optimization-explanation.ts';
import type { OptimizationExplanation } from './optimization-explanation.ts';

type Decision = { key: string; at: string; actor: string; kind: 'enabled' | 'disabled' | 'waiting' | 'assessment'; reason: string; report?: string; cpaKop?: number; targetKop?: number; explanation?: OptimizationExplanation };
export type CampaignOptimization = { enabled: boolean; decisions: Decision[] };

export function createCampaignOptimization(db: ReturnType<typeof openDatabase>, analytics: ReturnType<typeof createAnalyticsService>,
  resolve: (owner: string) => DirectConnection | undefined) {
  const binding = (owner: string, workspace: string) => db.readCampaignWorkspace(owner, workspace) &&
    db.readCampaignDirectRuns(owner, workspace).findLast(run => run.guidedDraft && run.complete && !run.pilot);
  function record(owner: string, run: DirectState, entry: Omit<Decision, 'at'>, enabled: boolean) {
    const history = run.optimization?.decisions ?? [];
    if (history.at(-1)?.key === entry.key) return;
    run.optimization = { enabled, decisions: [...history.slice(-39), { ...entry, at: new Date().toISOString() }] };
    db.saveDirect(owner, run);
  }
  function assessment(owner: string, run: DirectState): Omit<Decision, 'at'> {
    const waiting = (reason: string, report?: string): Omit<Decision, 'at'> =>
      ({ key: hash([reason, report]), actor: 'Goulash', kind: 'waiting', reason, report });
    const connection = resolve(owner);
    if (!connection || connection.account !== run.account || connection.needsReconcile) return waiting('Доступ к кабинету кампании требует сверки.');
    if (run.launch?.pending) return waiting('Сначала нужно подтвердить исход команды Директа.');
    if (run.launch?.observation?.campaignState !== 'ON') return waiting('Директ пока не подтвердил активное состояние кампании.');
    const view = analytics.view(owner, run.planId, run.campaignId);
    if (!view.measurement?.verified) return waiting('Подтвердите тестовую заявку для текущей цели.');
    const report = view.currentReports.find(item => item.source === 'metrika_direct' && item.status === 'ready');
    const cpa = report && reportCpa(report);
    if (cpa === undefined) return waiting('Для оценки нужен полный актуальный отчёт Метрики по этой кампании и цели.', report?.id);
    const targetKop = db.readPlan(owner, run.campaignPlanId, run.campaignId)?.targetCpaKop;
    if (!targetKop) return waiting('В подтверждённом плане не задан ориентир цены заявки.', report.id);
    const cpaKop = Math.round(cpa * 100);
    if (!Number.isSafeInteger(cpaKop)) return waiting('Отчёт содержит некорректную стоимость заявки.', report.id);
    const reason = cpaKop > targetKop
      ? 'Цена достижения цели по Метрике выше ориентира. Для перераспределения нужны сопоставимые данные по вариантам.'
      : 'Цена достижения цели по Метрике в пределах ориентира. Оснований менять настройки нет.';
    return { key: hash([report.id, targetKop, cpaKop]), actor: 'Goulash', kind: 'assessment', reason, report: report.id, cpaKop, targetKop };
  }
  return {
    set(owner: string, workspace: string, form: URLSearchParams, actor: string) {
      const run = binding(owner, workspace);
      const one = (name: string) => form.getAll(name).length === 1 ? form.get(name) : undefined;
      const choice = one('enabled');
      if (!run || one('run') !== run.planId || one('revision') !== String(run.storageRevision) || (choice !== 'yes' && choice !== 'no'))
        throw new DirectError('Кампания изменилась. Откройте её заново.');
      const enabled = choice === 'yes';
      if (Boolean(run.optimization?.enabled) === enabled) return;
      const unlock = db.lockDirect(run.account);
      try {
        if (db.readDirect(owner, run.planId)?.storageRevision !== run.storageRevision) throw new DirectError('Кампания изменилась. Обновите страницу.');
        record(owner, run, { key: hash([run.storageRevision, enabled]), actor, kind: enabled ? 'enabled' : 'disabled',
          reason: enabled ? 'Автоматическая оценка результатов включена.' : 'Автоматическая оценка остановлена. Показы сохраняют своё состояние.' }, enabled);
      } finally { unlock(); }
    },
    tick() {
      for (const { owner, planId } of db.readEnabledCampaignOptimizations()) {
        const run = db.readDirect(owner, planId);
        if (!run?.campaignId || !run.optimization?.enabled || run.pilot || db.directBusy(run.account)) continue;
        const entry = assessment(owner, run);
        if (entry.key === run.optimization.decisions.at(-1)?.key) continue;
        try { record(owner, run, entry, true); }
        catch (error) { if (!(error instanceof DirectError)) throw error; }
      }
    },
  };
}

const price = (kopecks: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(kopecks / 100);

export function renderOptimization(run: DirectState, campaignId: string) {
  const state = run.optimization;
  return `<section class="form-panel connect-card" aria-labelledby="campaign-optimization-title"><h2 id="campaign-optimization-title">Автоматическая оценка</h2>
    <p role="status">${state?.enabled ? 'Оценка включена' : 'Оценка выключена'}</p>
    <p>Goulash сравнивает цену достижения цели с вашим ориентиром и записывает вывод в журнал. Настройки, бюджет и показы сохраняются.</p>
    ${state?.decisions.length ? `<p>${e(state.decisions.at(-1)!.reason)}</p>` : ''}
    <form method="post" action="/campaign/optimization?ad=${encodeURIComponent(campaignId)}">
      <input type="hidden" name="run" value="${e(run.planId)}"><input type="hidden" name="revision" value="${run.storageRevision}">
      <button type="submit" name="enabled" value="${state?.enabled ? 'no' : 'yes'}" class="secondary">${state?.enabled ? 'Выключить оценку' : 'Включить оценку'}</button>
    </form><div class="draft-related"><a class="task-link" href="${campaignTabHref(campaignId, 'journal', { by: 'goulash' })}">Оценки в журнале</a><a class="task-link" href="${routes.results}#demo">Учебный пример переноса бюджета</a></div></section>`;
}

export function renderOptimizationEntry(run: DirectState, workspace: string, entry: Decision, allowExplanation = false, journalFields = '') {
  const explanation = (entry: Decision) => {
    const facts = optimizationExplanationFacts(entry);
    if (!facts.length) return '';
    const details = `<details><summary>${entry.explanation?.status === 'ready' ? 'Пояснение ИИ' : 'Пояснение по записи'}</summary><ul>${facts.map(fact => `<li>${e(fact)}</li>`).join('')}</ul></details>`;
    if (entry.explanation?.status === 'pending') return `${details}<p class="hint">Запрос к ИИ учтён. Можно посмотреть пояснение по записи.</p>`;
    if (!allowExplanation || entry.explanation) return details;
    return `${details}<form method="post" action="/campaign/explain-optimization?ad=${encodeURIComponent(workspace)}">${journalFields}
      <input type="hidden" name="run" value="${e(run.planId)}"><input type="hidden" name="revision" value="${run.storageRevision}">
      <input type="hidden" name="decision" value="${e(entry.key)}"><input type="hidden" name="at" value="${e(entry.at)}">
      <label class="check"><input type="checkbox" name="confirm" value="yes" required>Подтверждаю один платный запрос к ИИ</label>
      <button class="secondary" type="submit">Спросить ИИ</button></form>`;
  };
  return `<h3>Автоматическая оценка</h3><p>${e(entry.reason)}</p><p class="hint">${e(entry.actor)} · ${e(new Date(entry.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }))} МСК</p>
      ${entry.cpaKop === undefined ? '' : `<p>По данным Метрики ${e(price(entry.cpaKop))} за достижение цели. Ориентир ${e(price(entry.targetKop!))}.</p>`}
      ${entry.report ? `<p class="hint">Сохранённый отчёт <code>${e(entry.report)}</code></p>` : ''}${explanation(entry)}`;
}
