import { cpa, money } from './demo.ts';
import type { DemoState } from './demo.ts';
import { escapeHtml as e } from './html.ts';

// Shared money-first view of learning (synthetic) A/B campaigns. Used by both
// the history screen and the learning example on "Результаты".
const number = (value: number) => value.toLocaleString('ru-RU');
const date = (value: string) => value.split('-').reverse().join('.');

export const demoStatus = (value: string) => value === 'stopped' ? 'Остановлена' : 'Активна';
export const spent = (state: DemoState) => state.campaigns.reduce((sum, campaign) => sum + campaign.spent, 0);

export function appliedOutcome(before: DemoState, after: DemoState) {
  const source = before.campaigns.find(c => c.status === 'active' && after.campaigns.some(item => item.id === c.id && item.status === 'stopped'));
  if (!source) return;
  const amount = source.remaining - after.campaigns.find((c) => c.id === source.id)!.remaining;
  const recipient = after.campaigns.find(c => before.campaigns.some(old => old.id === c.id && old.remaining < c.remaining));
  return {source, amount, recipient};
}

export function renderAppliedOutcome(before: DemoState, after: DemoState, {source, amount, recipient}: NonNullable<ReturnType<typeof appliedOutcome>>) {
  const cost = recipient && cpa(recipient, before.complete);
  return `<p class="entry-meta">${date(before.periodStart)} — ${date(before.periodEnd)} · учебные данные</p>
    <dl class="decision-summary">
      <div><dt>Почему остановили</dt><dd>Потратили <strong>${money(source.spent)}</strong>. Цель «${e(before.goal)}» сработала <strong>0 раз</strong>.</dd></div>
      <div><dt>Куда ушёл остаток</dt><dd><strong>${money(amount)}</strong> ${recipient ? `получила ${e(recipient.name)}. У неё ${number(recipient.goals ?? 0)} достижений цели${cost == null ? '' : ` по ${money(cost)} за каждое`}.` : 'перевели в резерв. Подходящей кампании для переноса не было.'}</dd></div>
      <div><dt>Общий бюджет</dt><dd>Лимит <strong>${money(after.limit)}</strong>. Из него уже потрачено ${money(spent(after))}.</dd></div>
    </dl>`;
}

export function transferTitle(before: DemoState, after: DemoState, future = false) {
  const outcome = appliedOutcome(before, after);
  if (!outcome) return 'Остановка и распределение остатка';
  const {source, amount, recipient} = outcome;
  return `${money(amount)} ${future ? 'перейдут' : 'перенесены'} ${recipient ? `из ${source.name.slice(-1)} в ${recipient.name.slice(-1)}` : 'в резерв'}`;
}

// Plain-language money effect of a learning decision for the history screen.
export function demoMoneyLines(before: DemoState, after: DemoState) {
  const outcome = appliedOutcome(before, after);
  const lines: [string, string][] = [
    ['Лимит', `${money(before.limit)} → ${money(after.limit)}`],
    ['Учтённый расход', `${money(spent(before))} → ${money(spent(after))}`],
  ];
  if (outcome) lines.push(['Остаток', outcome.recipient ? `перенесён: ${e(outcome.recipient.name)} +${money(outcome.amount)}` : `в резерв: +${money(outcome.amount)}`]);
  return lines;
}
