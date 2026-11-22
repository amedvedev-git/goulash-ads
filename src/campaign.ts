import type { BusinessAnalysis, DeepSeekTrial, DeepSeekUsage } from './business-analysis.ts';

export type CampaignInput = {
  description: string;
  url: string;
  region: string;
  budget: string;
  period: string;
};

export type CampaignDraft = CampaignInput & { title: string; adText: string };
export type CampaignErrors = Partial<Record<keyof CampaignDraft, string>>;
export type CampaignView = {
  input: CampaignInput;
  preview?: CampaignDraft;
  revision: number;
  errors?: CampaignErrors;
  editing?: boolean;
  analysis?: BusinessAnalysis & { source: 'example' | 'manual' | 'provider'; usage?: DeepSeekUsage };
  deepSeekTrial?: 'ready' | DeepSeekTrial['status'];
  step?: 1 | 2 | 3;
  pending?: CampaignDraft;
  conflict?: boolean;
  conflictRevision?: number;
  dirty?: boolean;
};

export const emptyCampaign: CampaignInput = { description: '', url: '', region: '', budget: '', period: '7' };
export const exampleCampaign: CampaignInput = {
  description: 'Вымышленное кафе «Рис и ролл» доставляет суши и роллы. Меню и условия доставки указаны на сайте.',
  url: 'https://example.com/menu', region: 'Екатеринбург', budget: '7000', period: '7',
};
export const campaignLimits = { description: 1000, url: 2048, region: 100, title: 56, adText: 81 };
export const directCalendarDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
export const minimumPeriodBudget = (days: number) => Math.max(300, 50 * days);
export function validCampaignText(key: 'description' | 'region' | 'title' | 'adText', value: string) {
  const control = key === 'description' ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/;
  return Boolean(value && value.length <= campaignLimits[key] && !control.test(value));
}

export function readCampaignForm(form: URLSearchParams, mode: 'entry' | 'preview' | 'confirm', description = '') {
  const errors: CampaignErrors = {};
  function read(key: keyof CampaignDraft) {
    const values = form.getAll(key);
    if (values.length !== 1) errors[key] = 'Укажи одно значение.';
    return values[0]?.trim() ?? '';
  }
  const business = mode === 'preview' ? description : read('description');
  const isExample = business === exampleCampaign.description;
  const value = {
    description: business,
    url: read('url'), region: read('region'), budget: read('budget'), period: read('period'),
    title: mode !== 'entry' ? read('title') : isExample ? 'Суши и роллы от «Рис и ролл»' : 'Тестовое объявление',
    adText: mode !== 'entry' ? read('adText') : isExample ? 'Посмотри меню и условия доставки на сайте.' : 'Подробности о предложении на сайте.',
  };

  for (const key of ['description', 'region', 'title', 'adText'] as const) {
    if (!validCampaignText(key, value[key])) {
      errors[key] = `Укажи текст от 1 до ${campaignLimits[key]} символов.`;
    }
  }
  const url = URL.parse(value.url);
  if (value.url.length > campaignLimits.url || !/^https?:\/\/[^/?#]/i.test(value.url) || !url?.hostname ||
      url.username || url.password || /[\s\\]/.test(value.url)) {
    errors.url = 'Введите полный адрес страницы с http:// или https://, без логина и пароля.';
  }
  if (!/^\d{1,8}$/.test(value.budget) || Number(value.budget) < 1 || Number(value.budget) > 10_000_000) {
    errors.budget = 'Укажи сумму от 1 до 10 000 000 целых рублей.';
  }
  if (value.period !== '7' && value.period !== '30') errors.period = 'Выбери 7 или 30 дней.';
  return { value, errors };
}
