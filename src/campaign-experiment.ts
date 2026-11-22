import { randomUUID } from 'node:crypto';
import type { CampaignMeasurement } from './analytics.ts';
import { campaignLimits } from './campaign.ts';
import type { openDatabase } from './database.ts';
import { DirectError, directId } from './direct-api.ts';
import type { DirectState } from './direct.ts';
import { escapeHtml as e } from './html.ts';
import type { WordingVariant } from './phrase-intelligence.ts';
import { campaignTabHref, connectionHref } from './routes.ts';

type Arm = { campaign: string; conversions: number; spendKop: number };
type Review = { source: 'manual'; report: string; from: string; to: string; at: string; actor: string;
  control: Arm; candidate: Arm; status: 'waiting' | 'goal_changed' | 'insufficient' | 'over_budget' | 'manual_review' };
type Goal = { counter: string; id: string; generation: number; configId: string };
export type CampaignExperiment = {
  id: string; run: string; plan: string; createdAt: string; actor: string; hypothesis: string;
  control: { campaign: string; ad: string; title: string; text: string; landing: string };
  candidateTitle: string; from: string; to: string; lagDays: number; limitKop: number; minimum: number;
  goal?: Goal; reviews: Review[]; closed?: { at: string; actor: string };
};
export type CampaignExperimentsView = {
  campaignId: string; run: string; revision: number; title: string; text: string;
  limitRub: string; from: string; to: string; goalReady: boolean; experiments: readonly CampaignExperiment[];
};
type MeasurementFor = (owner: string, campaignId: string) => { verified: boolean; measurement?: CampaignMeasurement };

const one = (form: URLSearchParams, key: string) => form.getAll(key).length === 1 ? form.get(key)!.trim() : '';
const fail = (message: string): never => { throw new DirectError(message); };
const clean = (value: string, max: number) => Boolean(value && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
const normal = (title: string) => title.toLocaleLowerCase('ru').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const dayNumber = (value: string) => {
  const number = Date.parse(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(number) || new Date(number).toISOString().slice(0, 10) !== value)
    fail('Укажите корректные даты эксперимента.');
  return number;
};
const integer = (value: string, min: number, max: number, message: string) => {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) fail(message);
  return number;
};
const money = (value: string) => {
  if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) fail('Укажите суммы в рублях с точностью до копеек.');
  const [rubles, kopecks = ''] = value.split(/[.,]/);
  return Number(rubles) * 100 + Number(kopecks.padEnd(2, '0'));
};

function controlOf(run: DirectState | undefined): CampaignExperiment['control'] | undefined {
  const snapshot = run?.snapshot?.ad, ad = snapshot?.ResponsiveAd;
  const title = ad?.Titles?.length === 1 && ad.Titles[0]?.Title;
  const text = ad?.Texts?.length === 1 && ad.Texts[0]?.Text;
  if (!run?.guidedDraft || !run.complete || !run.campaignPlanId || !run.budget || !run.steps.campaign.id || !run.steps.ad.id ||
    typeof title !== 'string' || typeof text !== 'string' || typeof ad.Href !== 'string' || String(snapshot?.Id) !== run.steps.ad.id) return;
  return { campaign: run.steps.campaign.id, ad: run.steps.ad.id, title, text, landing: ad.Href };
}

export function createCampaignExperiments(db: ReturnType<typeof openDatabase>, measurementFor?: MeasurementFor, currentTime = Date.now) {
  const latest = (owner: string, campaignId: string) => db.readCampaignDirectRuns(owner, campaignId).findLast(row => row.guidedDraft);
  const today = () => new Date(currentTime()).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  function goalFor(owner: string, campaignId: string, landing: string): Goal | undefined {
    const state = measurementFor?.(owner, campaignId), measurement = state?.measurement;
    if (state?.verified && measurement?.goalId && measurement.landing === landing) {
      return { counter: measurement.counter.id, id: measurement.goalId, generation: measurement.generation, configId: measurement.configId };
    }
  }
  function view(owner: string, campaignId: string): CampaignExperimentsView | undefined {
    const run = latest(owner, campaignId), control = controlOf(run);
    if (!run || !control) return;
    const todayDate = today();
    return { campaignId, run: run.planId, revision: run.storageRevision!, title: control.title, text: control.text,
      from: run.budget!.startDate < todayDate ? todayDate : run.budget!.startDate, to: run.budget!.endDate,
      limitRub: run.budget!.amountRub, goalReady: Boolean(goalFor(owner, campaignId, control.landing)), experiments: run.experiments ?? [] };
  }
  return {
    view,
    action(owner: string, campaignId: string, form: URLSearchParams, actor: string) {
      const initial = latest(owner, campaignId);
      if (!initial || initial.planId !== one(form, 'run')) fail('Подтверждённый запуск кампании не найден.');
      const unlock = db.lockDirect(initial.account);
      try {
        db.directTransaction(() => {
          const run = latest(owner, campaignId), control = controlOf(run);
          if (!run || !control || run.planId !== initial.planId || String(run.storageRevision) !== one(form, 'revision'))
            fail('Кампания уже изменилась. Обновите страницу перед сохранением.');
          const experiment = run.experiments?.findLast(item => !item.closed);
          const action = one(form, 'action'), at = new Date(currentTime()).toISOString();
          if (action === 'propose') {
            if (experiment) fail('Сначала завершите учёт открытого эксперимента.');
            const candidateTitle = one(form, 'title'), hypothesis = one(form, 'hypothesis');
            if (!clean(candidateTitle, campaignLimits.title) || !normal(candidateTitle) || normal(candidateTitle) === normal(control.title))
              fail('Введите другой заголовок до 56 символов. Текст и посадочная страница сохраняются одинаковыми.');
            if (!clean(hypothesis, 240)) fail('Сформулируйте одну гипотезу до 240 символов.');
            const from = one(form, 'from'), to = one(form, 'to');
            const start = dayNumber(from), end = dayNumber(to);
            if (start < dayNumber(today()) || end < start || from < run.budget!.startDate || to > run.budget!.endDate)
              fail('Выберите будущий или текущий период в пределах дат бюджета кампании.');
            const limitKop = money(one(form, 'limit'));
            if (limitKop <= 0 || limitKop > money(run.budget!.amountRub)) fail('Сумма эксперимента должна укладываться в бюджет стратегии без НДС.');
            (run.experiments ??= []).push({ id: randomUUID(), run: run.planId, plan: run.campaignPlanId!, createdAt: at, actor,
              hypothesis, control, candidateTitle, from, to, limitKop,
              lagDays: integer(one(form, 'lagDays'), 0, 90, 'Укажите окно дозревания от 0 до 90 дней.'),
              minimum: integer(one(form, 'minimum'), 1, 1_000_000, 'Укажите минимальное число конверсий на вариант.'),
              goal: goalFor(owner, campaignId, control.landing), reviews: [] });
          } else {
            if (!experiment || experiment.id !== one(form, 'experiment')) fail('Открытый эксперимент уже изменился. Обновите страницу.');
            if (action === 'close') experiment.closed = { at, actor };
            else if (action === 'record') {
              const report = one(form, 'report'), from = one(form, 'from'), to = one(form, 'to');
              if (!/^[\p{L}\p{N}._-]{1,80}$/u.test(report) || from !== experiment.from || to !== experiment.to || one(form, 'confirm') !== 'yes')
                fail('Укажите номер отчёта Директ Про и подтвердите, что обе группы относятся к заданному периоду, цели и базе НДС.');
              const candidate = directId(one(form, 'candidateCampaign'));
              if (candidate === experiment.control.campaign) fail('В отчёте должны быть две разные кампании Директа.');
              const count = (name: string) => integer(one(form, name), 0, Number.MAX_SAFE_INTEGER, 'Укажите число конверсий целым числом.');
              const arms = {
                control: { campaign: experiment.control.campaign, conversions: count('controlConversions'), spendKop: money(one(form, 'controlSpend')) },
                candidate: { campaign: candidate, conversions: count('candidateConversions'), spendKop: money(one(form, 'candidateSpend')) },
              };
              const goal = goalFor(owner, campaignId, control.landing);
              let status: Review['status'] = 'manual_review';
              if (arms.control.spendKop + arms.candidate.spendKop > experiment.limitKop) status = 'over_budget';
              else if (dayNumber(today()) <= dayNumber(to) + experiment.lagDays * 86400000) status = 'waiting';
              else if (!experiment.goal || JSON.stringify(goal) !== JSON.stringify(experiment.goal) || JSON.stringify(control) !== JSON.stringify(experiment.control))
                status = 'goal_changed';
              else if (arms.control.conversions < experiment.minimum || arms.candidate.conversions < experiment.minimum || !arms.control.spendKop || !arms.candidate.spendKop)
                status = 'insufficient';
              experiment.reviews.push({ source: 'manual', report, from, to, at, actor, ...arms, status });
            } else fail('Действие с экспериментом не поддерживается.');
          }
          db.saveDirect(owner, run);
        });
      } finally { unlock(); }
    },
  };
}

const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });
const amount = (kopecks: number) => rubles.format(kopecks / 100);
const date = (value: string) => value.slice(0, 10).split('-').reverse().join('.');
const hidden = (name: string, value: string | number) => `<input type="hidden" name="${name}" value="${e(String(value))}">`;
const input = (name: string, label: string, attributes = '') => `<div class="field"><label for="experiment-${name}">${label}</label><input id="experiment-${name}" name="${name}" ${attributes} required></div>`;
const directGuide = '<a href="https://yandex.ru/support/direct/ru/campaigns/experiments" target="_blank" rel="noopener noreferrer">Как настроить разбиение в Директ Про</a>';
const reviewText: Record<Review['status'], string> = {
  waiting: 'Период наблюдения или окно дозревания ещё продолжается.',
  goal_changed: 'Для сравнения нужна неизменная проверенная цель и исходная версия объявления.',
  insufficient: 'Мало конверсий или нет положительного расхода по одному из вариантов.',
  over_budget: 'Указанные расходы превысили заданный лимит эксперимента.',
  manual_review: 'Минимум достигнут по введённым данным. Проверьте разбиение аудитории и значимость в отчёте Директ Про.',
};

export function renderExperimentForm(view: CampaignExperimentsView | undefined, campaignId: string, suggestions: readonly WordingVariant[] = []) {
  if (!view) return '<p>Подготовить вариант можно после создания и сверки объявления в Директе.</p>';
  const open = view.experiments.findLast(item => !item.closed);
  const context = hidden('ad', campaignId) + hidden('run', view.run) + hidden('revision', view.revision);
  if (open) return `<section><h3>Учёт A/B-теста</h3><p>${e(open.hypothesis)}</p>
    <dl class="preview-meta"><div><dt>Контроль</dt><dd>${e(open.control.title)}</dd></div><div><dt>Вариант</dt><dd>${e(open.candidateTitle)}</dd></div>
    <div><dt>Период · МСК</dt><dd>${date(open.from)} — ${date(open.to)}</dd></div><div><dt>Лимит без НДС</dt><dd>${amount(open.limitKop)}</dd></div></dl>
    <p>Запуск и остановка эксперимента выполняются в Директ Про. ${directGuide}.</p>
    <details class="preparation-disclosure"><summary>Записать показатели вручную</summary>
      <form method="post" action="/campaign/experiment">${context}${hidden('experiment', open.id)}${hidden('action', 'record')}
        ${input('report', 'Номер отчёта или эксперимента в Директ Про', 'maxlength="80"')}
        <div class="field-grid">${input('from', 'Начало отчёта', `type="date" value="${open.from}"`)}${input('to', 'Конец отчёта', `type="date" value="${open.to}"`)}</div>
        <p>Контрольная кампания Директа <strong>${e(open.control.campaign)}</strong>.</p>
        ${input('candidateCampaign', 'Номер кампании варианта', 'inputmode="numeric" maxlength="19"')}
        <div class="field-grid">${input('controlConversions', 'Конверсии контроля', 'inputmode="numeric"')}${input('controlSpend', 'Расход контроля без НДС, ₽', 'inputmode="decimal"')}
          ${input('candidateConversions', 'Конверсии варианта', 'inputmode="numeric"')}${input('candidateSpend', 'Расход варианта без НДС, ₽', 'inputmode="decimal"')}</div>
        <label class="check"><input type="checkbox" name="confirm" value="yes" required>Подтверждаю, что перенёс показатели обеих групп за заданный период, по одной цели и без НДС.</label>
        <button class="secondary" type="submit">Записать показатели</button></form></details>
    <div class="actions"><a href="${e(campaignTabHref(campaignId, 'journal', { by: 'experiments' }))}#campaign-experiments">Открыть эксперимент в журнале</a>
      <form method="post" action="/campaign/experiment">${context}${hidden('experiment', open.id)}${hidden('action', 'close')}
        <button class="secondary" type="submit">Завершить учёт</button></form></div></section>`;
  if (view.from > view.to) return '<p>Для нового теста нужна кампания с действующим периодом бюджета.</p>';
  const choices = [...new Set(suggestions.map(variant => variant.title))].filter(title => normal(title) !== normal(view.title));
  return `<section>
    <p>Подготовьте второй заголовок. Запустите тест в Директ Про, затем вручную перенесите показатели из его отчёта сюда.</p>
    ${view.goalReady ? '' : `<p class="hint">Перед записью результатов <a href="${e(connectionHref(campaignId, 'ads'))}#metrika-title">подтвердите цель Метрики</a>.</p>`}
    <form method="post" action="/campaign/experiment">${context}${hidden('action', 'propose')}
      ${input('hypothesis', 'Что должно улучшиться', 'maxlength="240"')}
      ${input('title', 'Заголовок варианта', `maxlength="56"${choices.length ? ' list="experiment-headings"' : ''}`)}
      ${choices.length ? `<datalist id="experiment-headings">${choices.map(title => `<option value="${e(title)}"></option>`).join('')}</datalist>` : ''}
      <div class="field-grid">${input('from', 'Начало эксперимента', `type="date" min="${view.from}" max="${view.to}" value="${view.from}"`)}${input('to', 'Окончание эксперимента', `type="date" min="${view.from}" max="${view.to}" value="${view.to}"`)}
        ${input('limit', 'Общий лимит без НДС, ₽', `inputmode="decimal" maxlength="12" value="${e(view.limitRub)}"`)}${input('minimum', 'Минимум конверсий на вариант', 'inputmode="numeric" maxlength="7"')}
        ${input('lagDays', 'Сколько дней ждать поздние конверсии', 'inputmode="numeric" maxlength="2"')}</div>
      <button class="secondary" type="submit">Сохранить черновик A/B-теста</button></form></section>`;
}

export function renderExperimentJournal(view: CampaignExperimentsView | undefined) {
  if (!view) return '';
  return `<section class="form-panel" id="campaign-experiments"><h2>Эксперименты</h2>
    <p><a class="task-link" href="${e(campaignTabHref(view.campaignId, 'ads'))}#campaign-experiment">К учёту A/B-теста</a></p>
    ${view.experiments.length ? [...view.experiments].reverse().map(item => `<article class="direct-event">
      <h3>${e(item.hypothesis)}</h3><p>${item.closed ? 'Учёт завершён' : 'В учёте'} · ${date(item.createdAt)} · ${e(item.actor)}</p>
      <dl class="preview-meta"><div><dt>Контроль</dt><dd>${e(item.control.title)}</dd></div><div><dt>Вариант</dt><dd>${e(item.candidateTitle)}</dd></div>
      <div><dt>Общий текст</dt><dd>${e(item.control.text)}</dd></div><div><dt>Период · МСК</dt><dd>${date(item.from)} — ${date(item.to)}</dd></div>
      <div><dt>Лимит без НДС</dt><dd>${amount(item.limitKop)}</dd></div><div><dt>Минимум на вариант</dt><dd>${item.minimum} конверсий</dd></div>
      <div><dt>Ожидание поздних конверсий</dt><dd>${item.lagDays} дн.</dd></div>
      <div><dt>Цель Метрики</dt><dd>${item.goal ? e(item.goal.id) + ' · счётчик ' + e(item.goal.counter) : 'Не подтверждена при создании черновика'}</dd></div></dl>
      ${item.reviews.length ? [...item.reviews].reverse().map(review => `<details class="preparation-disclosure"><summary>Ручная запись ${e(review.report)} · ${date(review.at)}</summary>
        <p>${e(reviewText[review.status])} Эти показатели внёс владелец.</p>
        <dl class="preview-meta"><div><dt>Контроль №${e(review.control.campaign)}</dt><dd>${review.control.conversions} конверсий · ${amount(review.control.spendKop)}</dd></div>
        <div><dt>Вариант №${e(review.candidate.campaign)}</dt><dd>${review.candidate.conversions} конверсий · ${amount(review.candidate.spendKop)}</dd></div></dl></details>`).join('')
        : '<p>Показатели пока не записаны. Для сравнения нужен отчёт Директ Про.</p>'}
      <p>Контрольный вариант сохранён в журнале. ${item.closed ? `Учёт завершил ${e(item.closed.actor)} ${date(item.closed.at)}.` : ''}</p></article>`).join('') : '<p>Для этой кампании пока нет экспериментов.</p>'}</section>`;
}
