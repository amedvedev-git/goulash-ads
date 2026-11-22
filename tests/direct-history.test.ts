import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleCampaign } from '../src/campaign.ts';
import { renderPage } from '../src/page.ts';
import type { OperationsView } from '../src/operations.ts';
import { renderDirect } from '../src/direct-page.ts';
import type { DirectEvent, DirectState } from '../src/direct.ts';

const error = 'adgroups.get: соединение недоступно. Сначала сверить состояние. <probe>';
function stateWith(event: Partial<DirectEvent>, currentError?: string): DirectState {
  return {
    account: '10101', planId: 'fictional-history', draft: { ...exampleCampaign, title: 'Тест', adText: 'Текст' },
    revision: 1, name: 'Тест', groupName: 'Группа', regionId: '54', regionName: 'Екатеринбург',
    weekly: '7000', keyword: 'роллы', startDate: '2099-01-01', complete: true,
    steps: { campaign: { phase: 'confirmed', id: '1' }, group: { phase: 'confirmed', id: '2' }, targeting: { phase: 'confirmed', id: '3' }, keyword: { phase: 'confirmed', id: '4' }, ad: { phase: 'confirmed', id: '5' } },
    events: [{ id: 'fictional-event', kind: 'create', phase: 'confirmed', at: '2026-11-16T12:00:00Z', actor: 'Тест', before: 'До', after: 'После', error, ...event }],
    ...(currentError ? { error: currentError } : {}),
  };
}

function render(event: Partial<DirectEvent>, currentError?: string) {
  const state = stateWith(event, currentError);
  const before = JSON.stringify(state);
  const html = renderDirect({ enabled: true, ownChief: true, mode: 'fixture', state }, { input: exampleCampaign, revision: 1 }, true);
  assert.equal(JSON.stringify(state), before, 'Rendering must preserve the original history and errors');
  assert.doesNotMatch(html, /<probe>/);
  if (state.events[0].error) assert.match(html, /&lt;probe&gt;/);
  return html;
}

test('единые счётчики и фильтры журнала учитывают Директ, оценку и ручную правку', () => {
  const run = stateWith({}); run.campaignId = 'default';
  run.optimization = { enabled: true, decisions: [{ key: 'decision', at: '2026-11-16T12:00:00Z', actor: 'Goulash', kind: 'waiting', reason: 'Ждём свежий отчёт' }] };
  const entry = { id: 'manual', campaignId: 'default', kind: 'draft_changed', object: 'draft', at: '2026-11-16T12:00:00Z',
    before: exampleCampaign, after: { ...exampleCampaign, budget: '9000' }, reason: 'Обновлён лимит', actor: 'Тест', revision: 2 };
  const operations = { history: [entry] } as OperationsView;
  const page = (historySource: 'all'|'mine'|'goulash', historyFilter: 'all'|'demo' = 'all') =>
    renderPage(undefined, '', false, true, 'Владелец', { input: exampleCampaign, revision: 1 }, operations,
      { section:'history', historySource, historyFilter, direct: { enabled: true, ownChief: true, mode:'fixture', runs:[run] } });
  const all = page('all');
  assert.match(all,/Все <span>3<\/span>/); assert.match(all,/Решения Goulash <span>1<\/span>/); assert.match(all,/Мои изменения <span>2<\/span>/);
  assert.match(all,/Ждём свежий отчёт/); assert.match(all,/Создание полного черновика/); assert.match(all,/Обновлён лимит/);
  assert.doesNotMatch(page('goulash'),/Создание полного черновика|Обновлён лимит/);
  assert.doesNotMatch(page('mine'),/Ждём свежий отчёт/);
  assert.doesNotMatch(page('all','demo'),/Создание полного черновика|Обновлён лимит|Ждём свежий отчёт/);
});

test('A09: квитанция первого создания относится к точной версии, повтор, правка и чужая кампания остаются отдельными', () => {
  const run = stateWith({ error: undefined }); run.campaignId = 'default'; run.guidedDraft = true;
  const at = run.events[0].at;
  const create = { id: 'local-create', campaignId: 'default', kind: 'draft_created', object: 'draft' as const,
    at, before: null, after: run.draft, reason: 'Локальное сохранение', actor: 'Тест', revision: 1, linkedId: null, undone: false };
  const rename = { ...run.events[0], id: 'rename', kind: 'rename' as const, before: 'Старое', after: 'Новое' };
  run.events.push(rename);
  const render = (runs: DirectState[], history = [create]) => renderPage(undefined, '', false, true, 'Владелец',
    { input: exampleCampaign, revision: 1 }, { history }, { section: 'history', direct: { enabled: true, mode: 'fixture', runs } });
  const html = render([run]);
  assert.match(html, /Все <span>2<\/span>/);
  assert.doesNotMatch(html, /Создание полного черновика/);
  assert.ok(html.indexOf('Изменение названия</h3>') < html.indexOf('Черновик создан</h3>'), 'при равном времени правка следует за созданием по смыслу');
  assert.match(html, /id="operation-local-create"[\s\S]*?<summary>Квитанция Директа<\/summary>[\s\S]*?Подтверждено API/);
  for (const anchor of ['direct-history', 'direct-history-fictional-history']) assert.equal(html.split('id="' + anchor + '"').length, 2);
  const later = structuredClone(run); later.planId = 'another-run'; later.events = [{ ...later.events[0], at: '2026-11-17T01:00:00Z' }];
  assert.match(render([run, later]), /Все <span>3<\/span>/);
  for (const other of [{ ...create, campaignId: 'other' }, { ...create, revision: 2 }, { ...create, after: { ...run.draft, budget: '100000' } }])
    assert.match(render([run], [other]), /Все <span>3<\/span>/);
});

test('Direct history: confirmed и отменённое изменение показывают прежнюю ошибку отдельно', () => {
  for (const event of [
    { kind: 'create' as const }, { kind: 'rename' as const, undoneBy: 'fictional-undo' }, { kind: 'undo' as const, related: 'fictional-rename' },
  ]) {
    const html = render(event);
    assert.match(html, /Подтверждено API/);
    assert.match(html, /<details><summary>Предыдущая ошибка · результат подтверждён<\/summary><p>adgroups\.get:/);
    assert.doesNotMatch(html, /class="field-error"/);
  }
});

test('Direct history: pending, legacy unknown и текущая ошибка confirmed остаются видимыми', () => {
  for (const [event, currentError] of [
    [{ phase: 'pending' }, undefined],
    [{ phase: 'unknown' }, undefined],
    [{ kind: 'rename', phase: 'confirmed' }, error],
    [{ kind: 'rename', phase: 'confirmed', undoneBy: 'fictional-undo' }, error],
  ] as [Partial<DirectEvent>, string | undefined][]) {
    const html = render(event, currentError);
    assert.doesNotMatch(html, /<strong>undefined<\/strong>/);
    if (event.phase === 'unknown') assert.match(html, /Исход не подтверждён · требуется сверка/);
    assert.match(html, /<p class="field-error">adgroups\.get:/);
    assert.doesNotMatch(html, /Предыдущая ошибка · результат подтверждён/);
  }
});

test('Direct history: confirmed без прежней ошибки не получает лишних подробностей', () => {
  const html = render({ error: undefined });
  assert.doesNotMatch(html, /Предыдущая ошибка|class="field-error"/);
});
