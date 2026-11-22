import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.ts';
import { loadControl } from './fixtures/e3-control.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { renderHistory } from '../src/operations-page.ts';

const outsideDetails = (html: string) => html.replace(/<details[\s\S]*?<\/details>/g, '');
const insideDetails = (html: string) => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((match) => match[0]).join('');

function cabinet(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-history-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return db;
}

test('«История»: причина решения, эффект в деньгах и откат с последствиями до подтверждения', (t) => {
  const db = cabinet(t);
  loadControl(db, 'local', 'control', 0, 'Тест');
  const initial = db.readDemo('local')!;
  db.enqueueDemo('local', initial.datasetId, 'Тест'); db.processDemoJob();
  const view = db.operationsView('local'), applied = view.result!;
  assert.equal(applied.kind, 'automation_applied');
  const html = renderHistory(view);

  assert.equal((html.match(/<h1>/g) ?? []).length, 1, 'один h1');
  assert.match(html, /решение Goulash/);
  assert.match(html, /Почему остановили[\s\S]*Куда ушёл остаток[\s\S]*Общий бюджет/);
  assert.match(html, /Изменения кампании/);
  assert.match(html, /Учебный пример/);
  assert.match(html, new RegExp(`href="/history\\?review=${applied.id}#undo-review">Отменить решение`));

  // Consequences are shown before the confirmation button, in money.
  const review = renderHistory(db.operationsView('local', { undoId: applied.id }));
  assert.match(review, /Проверьте отмену/);
  assert.match(review, /После отмены/);
  assert.match(review, /Уже учтённый расход/);
  assert.match(review, /Уже потраченные деньги не возвращаются/);
  assert.match(review, /<button class="primary" type="submit">Подтвердить отмену<\/button>/);
  assert.match(review, /Оставить как есть/);

  // The undo record says what came back, and that spent money stayed.
  assert.equal(db.undo('local', applied.id, 'Тест'), 'ok');
  const undone = renderHistory(db.operationsView('local'));
  assert.match(undone, /Назначения после отмены/);
  assert.match(undone, /не изменился/);
  assert.match(undone, /Отменено/);
});

test('«История»: номера, владелец и fixture — только в раскрытии', (t) => {
  const db = cabinet(t);
  const first = { ...exampleCampaign, budget: '5000', title: 'Первый', adText: 'Текст' };
  db.saveCampaign('local', first, 0, 'Владелец А · fixture (yandex:101)');
  db.saveCampaign('local', { ...first, budget: '9000' }, 1, 'Владелец А · fixture (yandex:101)');
  const html = renderHistory(db.operationsView('local'));

  assert.match(html, /Бюджет<\/dt><dd>5\s000\s₽ → 9\s000\s₽/);
  assert.match(html, /ваше изменение/);
  const flow = outsideDetails(html);
  assert.doesNotMatch(flow, /Владелец А|fixture|yandex:101/, 'владельца и fixture нет в основном потоке');
  assert.doesNotMatch(flow, /Операция [0-9a-f-]{36}/, 'номер операции не в основном потоке');
  assert.match(insideDetails(html), /Владелец А · fixture \(yandex:101\)/);
  assert.match(insideDetails(html), /Операция <code>[0-9a-f-]{36}<\/code>/);

  // A text-only edit says money did not change.
  db.saveCampaign('local', { ...first, budget: '9000', title: 'Второй' }, 2, 'Тест');
  assert.match(renderHistory(db.operationsView('local')), /Бюджет не менялся/);

  // A conflicting undo still explains why nothing happened.
  const change = db.readHistory('local').find((entry) => entry.kind === 'draft_changed')!;
  db.saveCampaign('local', { ...first, budget: '9000', title: 'Третий' }, 3, 'Тест');
  const conflict = renderHistory(db.operationsView('local', { undoId: change.id }));
  assert.match(conflict, /Отмена не выполнена/);
  assert.match(conflict, /Актуальное состояние сохранено/);
  assert.doesNotMatch(conflict, /Подтвердить отмену/);
});

test('«История»: пустые состояния и фильтры объекта', (t) => {
  const db = cabinet(t);
  const empty = renderHistory(db.operationsView('local'));
  assert.match(empty, /<h1>История<\/h1>/);
  assert.match(empty, /История пока пуста/);
  assert.match(empty, /Как работает отмена/);
  assert.match(empty, /href="\/results#demo"/);
  assert.doesNotMatch(empty, /\/automation/);
  const view = db.operationsView('local');
  assert.match(renderHistory(view, 'draft'), /Здесь пока нет записей/);
  assert.match(renderHistory(view, 'demo'), /Здесь пока нет записей/);
});

test('«История»: фильтр по источнику сочетается с фильтром объекта', (t) => {
  const db = cabinet(t);
  loadControl(db, 'local', 'control', 0, 'Тест');
  const initial = db.readDemo('local')!;
  db.enqueueDemo('local', initial.datasetId, 'Тест'); db.processDemoJob();
  const view = db.operationsView('local');

  const decisions = renderHistory(view, 'all', 'goulash');
  assert.match(decisions, /data-source="goulash"/);
  assert.doesNotMatch(decisions, /data-source="mine"/);
  assert.match(decisions, /<span class="source-chip source-chip-goulash">решение Goulash<\/span>/);
  assert.match(decisions, /aria-current="page">Решения Goulash/);

  const mine = renderHistory(view, 'all', 'mine');
  assert.doesNotMatch(mine, /data-source="goulash"/);
  assert.match(mine, /data-source="mine"/);
  assert.match(mine, /href="\/history\?by=goulash"/, 'переключение источника сохраняет фильтр объекта');

  const combined = renderHistory(view, 'demo', 'mine');
  assert.match(combined, /href="\/history\?scope=demo&by=goulash"/);
  assert.equal((combined.match(/data-source="mine"/g) ?? []).length, 2, 'загрузка набора и включение правила');
  assert.match(combined, /href="\/history\?scope=demo&by=mine" aria-current="page"/);
  const nothing = renderHistory(view, 'draft', 'goulash');
  assert.match(nothing, /Здесь пока нет записей/);
  assert.match(nothing, /Показать все записи/);
});
