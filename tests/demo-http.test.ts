import { loadControl, controlPlan } from './fixtures/e3-control.ts';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import { exampleCampaign } from '../src/campaign.ts';

test('HTTP: формы, фон, ноль и отсутствие данных, история, отмена и конфликт', { timeout: 15000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-demo-http-'));
  const db = openDatabase(directory), server = createApp(db);
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close(); rmSync(join(directory, 'stage2.sqlite')); rmdirSync(directory);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, values: Record<string, string>) => fetch(origin + path, {
    method: 'POST', headers: { Origin: origin }, body: new URLSearchParams(path === '/demo/load' ? { ...values, planId: controlPlan(db) } : values), redirect: 'manual', signal: t.signal,
  });
  const page = async (path = '/analytics') => (await fetch(origin + path, { signal: t.signal })).text();
  const analysis = await (await post('/campaign/analyze', { ...exampleCampaign, revision: '0' })).text();
  const ids = [...analysis.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'labels and headings must have distinct IDs');
  assert.equal((await post('/campaign/save', { ...exampleCampaign, title: 'Суши и роллы', adText: 'Меню на сайте.', revision: '0' })).status, 303);
  const edit = { ...db.readCampaign('local')!.draft, title: '<Изменение> & тест', revision: '1' };
  assert.equal((await post('/campaign/save', edit)).status, 303);
  const event = db.readHistory('local')[0];
  assert.match(await page('/'), /&lt;Изменение&gt; &amp; тест/);
  assert.equal((await post('/operations/undo', { id: event.id, confirm: 'undo' })).status, 303);
  assert.equal(db.readCampaign('local')!.revision, 3);
  assert.equal((await post('/campaign/save', { ...edit, revision: '3', title: 'Правка 1' })).status, 303);
  const firstEdit = db.readHistory('local')[0];
  assert.equal((await post('/campaign/save', { ...edit, revision: '4', title: 'Правка 2' })).status, 303);
  const conflict = await post('/operations/undo', { id: firstEdit.id, confirm: 'undo' });
  assert.equal(conflict.status, 409);
  assert.match(await conflict.text(), /Конфликт отмены/);
  assert.equal(db.readCampaign('local')!.draft.title, 'Правка 2');

  assert.equal((await post('/demo/load', { scenario: 'live', revision: '0' })).status, 400);
  assert.equal((await post('/demo/load', { scenario: 'control', revision: '0' })).status, 303);
  const loaded = db.readDemo('local')!;
  const initial = await page();
  assert.match(initial, /0 · подтверждённый ноль/);
  assert.match(initial, /Не вычисляется: 0 достижений/);
  assert.match(initial, /Europe\/Moscow/);
  assert.match(initial, /demo-order/);
  assert.match(initial, /Вымышленные данные/);
  assert.equal((await post('/demo/permission',{revision:'0',datasetId:loaded.datasetId,enabled:'yes',confirm:'control'})).status,303);
  assert.equal((await post('/demo/run', { datasetId: loaded.datasetId })).status, 303);
  // Wait for the actual interval worker, not a direct call to the rule.
  while (db.operationsView('local').job?.status !== 'completed') {
    await new Promise((resolve) => setTimeout(resolve, 30)); t.signal.throwIfAborted();
  }
  const decision = db.readHistory('local')[0];
  assert.equal(decision.kind, 'automation_applied');
  assert.equal(db.readDemo('local')!.state.campaigns[1].remaining, 240000);
  assert.equal((await post('/demo/run', { datasetId: loaded.datasetId })).status, 303);
  assert.equal(db.readHistory('local').filter((e) => e.kind === 'automation_applied').length, 1);
  assert.equal((await post('/operations/undo', { id: decision.id, confirm: 'undo' })).status, 303);
  assert.deepEqual(db.readDemo('local')!.state, loaded.state);
  assert.equal((await post('/demo/load', { scenario: 'missing', revision: '0' })).status, 409);
  assert.equal((await post('/demo/load', { scenario: 'missing', revision: '3' })).status, 303);
  assert.match(await page(), /Нет данных<\/td>/);
  assert.match(await page(), /Не вычисляется: нет полных данных/);
  assert.equal((await post('/demo/run', { datasetId: loaded.datasetId })).status, 409);
  assert.equal((await post('/demo/load', { scenario: 'incomplete', revision: '4' })).status, 303);
  const incomplete = (await page()).match(/<table id="demo-statistics"[^>]*>[\s\S]*?<\/table>/)![0];
  assert.match(incomplete, /0 · неполный отчёт/);
  assert.doesNotMatch(incomplete, /подтверждённый ноль/);
  assert.match(incomplete, /Не вычисляется: нет полных данных/);
});

test('два процесса worker, восстановление незавершённой транзакции и атомарность истории', { timeout: 20000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-two-workers-'));
  const db = openDatabase(directory);
  const workerUrl = new URL('./fixtures/demo-worker.ts', import.meta.url);
  const children: ReturnType<typeof fork>[] = [];
  t.after(() => { children.forEach((child) => child.kill()); db.close(); rmSync(join(directory, 'stage2.sqlite')); rmdirSync(directory); });
  loadControl(db, 'local', 'control', 0, 'Тест');
  const initial = db.readDemo('local')!;
  db.enqueueDemo('local', initial.datasetId, 'Тест');
  const crash = spawn(process.execPath, [fileURLToPath(workerUrl), directory, 'crash'], { stdio: 'ignore' });
  assert.equal((await once(crash, 'exit'))[0], 0);
  assert.deepEqual(db.readDemo('local'), initial, 'uncommitted partial mutation must roll back');

  const raw = new DatabaseSync(join(directory, 'stage2.sqlite'));
  raw.exec(`CREATE TRIGGER fail_result BEFORE UPDATE ON demo_jobs WHEN NEW.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'Simulated result write failure'); END;`);
  assert.throws(() => db.processDemoJob(), /Simulated result write failure/);
  assert.deepEqual(db.readDemo('local'), initial);
  assert.equal(db.readHistory('local').filter(e=>e.object==='demo').length, 2, 'history and state rolled back together');
  assert.equal(db.operationsView('local').job?.status, 'pending');
  raw.exec('DROP TRIGGER fail_result'); raw.close();

  const spawnReady = async () => {
    const child = fork(workerUrl, [directory], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child);
    const exited = once(child, 'exit');
    assert.equal((await once(child, 'message'))[0], 'ready');
    return { child, exited };
  };
  const workers = await Promise.all([spawnReady(), spawnReady()]);
  workers.forEach(({ child }) => child.send('go'));
  for (const { exited } of workers) assert.equal((await exited)[0], 0);
  assert.equal(db.readHistory('local').filter((e) => e.kind === 'automation_applied').length, 1);
  assert.equal(db.readDemo('local')!.state.campaigns[1].remaining, 240000);
  assert.equal(db.operationsView('local').job?.status, 'completed');
});
