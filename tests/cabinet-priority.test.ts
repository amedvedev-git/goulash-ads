import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCampaignCatalog } from '../src/campaign-catalog.ts';
import type { CampaignCatalogItem } from '../src/campaign-catalog.ts';
import { renderOverview } from '../src/overview-page.ts';

const item = (id: string, state: CampaignCatalogItem['state'], options: Partial<CampaignCatalogItem> = {}): CampaignCatalogItem => ({
  id, title: id, state, stage: 'created', needsReview: false, region: 'Казань', budget: '', period: '',
  budgetSource: 'draft', conditionsChanged: false, lastActivity: '', ...options,
});

test('фильтры списка выбирают кампании по состоянию и выделяют текущий раздел', () => {
  const campaigns = [item('Обычная кампания', 'live'), item('Мой черновик', 'draft'), item('Кампания на сверке', 'draft', { needsReview: true })];
  const html = renderCampaignCatalog(campaigns, undefined, 'review');
  assert.match(html, /status=review" aria-current="page"/);
  assert.match(html, /Кампания на сверке/);
  assert.doesNotMatch(html, /Обычная кампания|Мой черновик/);
  assert.match(renderCampaignCatalog(campaigns.slice(1), undefined, 'live'), /Кампаний с этим статусом пока нет/);
});

test('на рабочем столе неподтверждённая остановка важнее обычной активной кампании', () => {
  const html = renderOverview([item('Обычная кампания', 'live'), item('Проверяем остановку', 'paused', { stopUnconfirmed: true })]);
  assert.match(html, /<h2 id="overview-campaign">Проверяем остановку<\/h2>/);
  assert.match(html, /Остановка показов ещё не подтверждена[\s\S]*Сверить остановку/);
});
