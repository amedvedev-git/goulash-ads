import { escapeHtml as e } from './operations-page.ts';
import { regionNames } from './region-directory.ts';
import { uiIcon } from './ui-icons.ts';

const examples: Record<string, string> = {
  description: 'Ремонтируем холодильники на дому в Перми. Мастер выезжает в день заявки.',
  url: 'https://example.ru/remont',
  goal: 'Например, оставить заявку',
  region: 'Пермь',
  budget: '7000',
  title: 'Ремонт холодильников в Перми',
  adText: 'Мастер приедет на дом в день заявки.',
  phrases: 'ремонт холодильника на дому',
  negatives: 'ремонт своими руками',
  name: 'Ремонт холодильников · Пермь',
  weekly: '7000',
};

const guidedPlaceholders: Record<string, string> = {
  description: 'Опишите, что предлагаете и на каких условиях.',
  url: 'https://example.ru/order',
  region: 'Выберите',
  goal: 'Выберите действие',
  title: 'Заголовок объявления',
  adText: 'Текст объявления',
};

export function fieldPlaceholder(name: string, guided = false) {
  const placeholder = (guided ? guidedPlaceholders[name] : undefined) ?? examples[name];
  return placeholder ? ` placeholder="${e(placeholder)}"` : '';
}

const goalNames = ['Оставить заявку', 'Оформить заказ', 'Позвонить', 'Записаться на услугу', 'Написать в мессенджере', 'Посетить магазин', 'Зарегистрироваться'];
const options = (names: readonly string[]) => names.map(name => `<option value="${e(name)}"></option>`).join('');
const directories = {
  region: { label: 'Города и регионы', open: 'Открыть справочник городов и регионов', options: options(regionNames) },
  goal: { label: 'Цели рекламы', open: 'Выбрать цель рекламы', options: options(goalNames) },
};

export function businessPicker(name: keyof typeof directories, attrs: string, value: string) {
  const directory = directories[name];
  return `<div class="business-picker" data-business-picker="${name}">
    <input ${attrs} type="text" autocomplete="off" list="${name}-directory" value="${e(value)}">
    <datalist id="${name}-directory">${directory.options}</datalist>
    <button type="button" class="picker-toggle" aria-label="${directory.open}" aria-controls="${name}-results" aria-expanded="false" hidden>${uiIcon('chevron', 18)}</button>
    <div class="picker-popup" hidden><ul id="${name}-results" role="listbox" aria-label="${directory.label}"></ul>
      <p class="picker-empty" role="status" hidden>Можно сохранить свой вариант.</p></div>
  </div>`;
}
