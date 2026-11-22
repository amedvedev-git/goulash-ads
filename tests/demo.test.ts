import { loadControl, controlPlan } from './fixtures/e3-control.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { exampleCampaign } from '../src/campaign.ts';
import { budgetError, cpa, decide, demoPreset, makeDemo } from '../src/demo.ts';
import type { DemoCase } from '../src/demo.ts';
import { openDatabase } from '../src/database.ts';

const now = Date.parse('2026-11-09T12:00:00Z');
const draft = { ...exampleCampaign, title: 'Первый заголовок', adText: 'Первый текст' };

test('контрольный расчёт: 700 ₽ А → Б; расход 3000 ₽, резерв 600 ₽, лимит 6000 ₽', () => {
  const before = makeDemo('control', now);
  const result = decide(before, now);
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.after.campaigns.map((c) => [c.spent, c.remaining, c.status]), [
    [180000, 0, 'stopped'], [120000, 240000, 'active'],
  ]);
  assert.equal(result.after.reserve, 60000);
  assert.equal(result.after.limit, 600000);
  assert.equal(budgetError(result.after), undefined);
  assert.equal(before.campaigns[0].remaining, 70000);
  assert.match(result.reason, /не зафиксировано достижений/);
  assert.equal(cpa(before.campaigns[0], true), null);
  assert.equal(cpa(before.campaigns[1], true), 20000);
  assert.equal(cpa(before.campaigns[1], false), null);
  assert.equal(decide(result.after, now).status, 'skipped');
});

test('нет получателя: А остановлена, 700 ₽ в резерв, Б и расход сохранены', () => {
  const result = decide(makeDemo('noRecipient', now), now);
  assert.equal(result.status, 'applied');
  assert.equal(result.after.reserve, 130000);
  assert.deepEqual(result.after.campaigns.map((c) => [c.spent, c.remaining, c.status]), [
    [180000, 0, 'stopped'], [120000, 170000, 'active'],
  ]);
  assert.match(result.reason, /подходящего получателя нет/);
  assert.equal(budgetError(result.after), undefined);
});

test('неполнота, отсутствие, устаревание, малый объём и исчерпанный лимит не меняют состояние', () => {
  const cases: DemoCase[] = ['missing', 'incomplete', 'stale', 'lowVolume', 'exhausted'];
  for (const scenario of cases) {
    const input = makeDemo(scenario, now), result = decide(input, now);
    assert.equal(result.status, 'skipped', scenario);
    assert.deepEqual(result.after, input);
  }
  assert.equal(cpa(makeDemo('missing', now).campaigns[0], true), null);
  for (const mutate of [
    (s) => { s.updatedAt = new Date(now + 1).toISOString(); },
    (s) => { s.periodEnd = s.periodStart; },
    (s) => { s.goalId = 'other'; },
    (s) => { s.mode = 'live'; },
    (s) => { s.campaigns[1].clicks = -1; },
  ] as Array<(state: any) => void>) {
    const input = makeDemo('control', now); mutate(input);
    assert.equal(decide(input, now).status, 'skipped');
    assert.deepEqual(decide(input, now).after, input);
  }
});

test('финансовые входы и пороги: превышение лимита, отрицательные и дробные деньги, CPA без округления порога', () => {
  for (const mutate of [
    (s) => { s.campaigns[0].spent = 700000; },
    (s) => { s.reserve = -1; },
    (s) => { s.reserve = 1.5; },
    (s) => { s.limit = Number.MAX_SAFE_INTEGER + 1; },
    (s) => { s.reserve = 0; },
  ] as Array<(state: any) => void>) {
    const input = makeDemo('control', now); mutate(input);
    const result = decide(input, now);
    assert.equal(result.status, 'error'); assert.deepEqual(result.after, input);
  }
  const input = makeDemo('control', now);
  input.campaigns[1].spent = 240001;
  input.campaigns[1].remaining = 49999;
  const result = decide(input, now);
  assert.equal(result.after.reserve, 130000, '400.0017 ₽ exceeds threshold even if displayed as 400.00');
  const threshold = makeDemo('control', now);
  threshold.campaigns[0].spent = 150000; threshold.campaigns[0].remaining = 100000;
  threshold.campaigns[1].goals = 5; threshold.campaigns[1].spent = 200000; threshold.campaigns[1].remaining = 90000;
  assert.equal(decide(threshold, now).after.campaigns[1].remaining, 190000);
});

test('A10: разрешение на готовый пример и на собственный план выдаётся отдельно', t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-demo-source-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const preset = { preset: demoPreset } as const;
  db.loadDemo('local', 'control', 0, 'Владелец', preset);
  db.setDemoPermission('local', true, 0, 'Владелец');
  const oldDataset = db.readDemo('local')!.datasetId;
  db.enqueueDemo('local', oldDataset, 'Правило');
  const plan = controlPlan(db);
  db.loadDemo('local', 'control', 1, 'Владелец', plan);
  assert.equal(db.readDemoPermission('local')!.enabled, false);
  db.processDemoJob();
  assert.equal(db.readHistory('local')[0].kind, 'automation_skipped');
  assert.equal(db.readDemo('local')!.state.campaigns[0].status, 'active');
  db.setDemoPermission('local', true, db.readDemoPermission('local')!.revision, 'Владелец');
  db.loadDemo('local', 'control', 2, 'Владелец', preset);
  assert.equal(db.readDemoPermission('local')!.enabled, false);
  assert.equal(db.processDemoJob(), false);
});

test('история, автор, связанная отмена, конфликт и аккаунты в SQLite', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-operations-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(join(directory, 'stage2.sqlite')); rmdirSync(directory); });
  assert.equal(db.saveCampaign('a', draft, 0, 'Анна'), true);
  assert.equal(db.saveCampaign('a', { ...draft, title: 'Вторая' }, 1, 'Анна'), true);
  const edit = db.readHistory('a')[0];
  assert.equal(edit.kind, 'draft_changed'); assert.equal(edit.actor, 'Анна');
  assert.ok(Number.isFinite(Date.parse(edit.at))); assert.deepEqual(edit.before, draft);
  assert.equal(db.undo('b', edit.id, 'Борис'), 'missing');
  assert.deepEqual(db.readHistory('b'), []);
  assert.equal(db.undo('a', edit.id, 'Анна'), 'ok');
  assert.deepEqual(db.readCampaign('a'), { draft, revision: 3 });
  const undo = db.readHistory('a')[0];
  assert.equal(undo.kind, 'draft_undo'); assert.equal(undo.linkedId, edit.id);
  assert.equal(db.undo('a', edit.id, 'Анна'), 'already');
  assert.equal(db.readHistory('a').length, 3);
  assert.equal(db.saveCampaign('a', { ...draft, title: 'Третья' }, 3, 'Анна'), true);
  const old = db.readHistory('a')[0];
  assert.equal(db.saveCampaign('a', { ...draft, title: 'Актуальная' }, 4, 'Анна'), true);
  assert.equal(db.undo('a', old.id, 'Анна'), 'conflict');
  assert.equal(db.readCampaign('a')!.draft.title, 'Актуальная');
  assert.equal(db.readHistory('a')[0].linkedId, old.id);
  assert.equal(db.saveCampaign('a', draft, 4, 'Анна'), false);
});

test('фоновое задание, идемпотентность, отмена без изменения расхода, замена набора', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-worker-'));
  let db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(join(directory, 'stage2.sqlite')); rmdirSync(directory); });
  assert.ok(loadControl(db, 'a', 'control', 0, 'Анна'));
  const initial = db.readDemo('a')!;
  const job = db.enqueueDemo('a', initial.datasetId, 'Анна');
  assert.equal(db.enqueueDemo('b', initial.datasetId, 'Борис'), undefined);
  assert.equal(db.enqueueDemo('a', initial.datasetId, 'Анна')!.id, job!.id);
  db.close(); db = openDatabase(directory);
  assert.equal(db.processDemoJob(), true, 'pending job survives restart');
  assert.equal(db.processDemoJob(), false);
  const result = db.readDemo('a')!;
  assert.equal(result.state.campaigns[1].remaining, 240000);
  const event = db.readHistory('a')[0];
  assert.equal(event.kind, 'automation_applied');
  assert.equal(db.undo('a', event.id, 'Анна'), 'ok');
  assert.deepEqual(db.readDemo('a')!.state, initial.state);
  assert.equal(db.readDemo('a')!.state.campaigns.reduce((s, c) => s + c.spent, 0), 300000);
  db.close(); db = openDatabase(directory);
  assert.equal(db.enqueueDemo('a', initial.datasetId, 'Анна')!.status, 'completed');
  assert.equal(db.processDemoJob(), false, 'undo must not allow same decision to run again');
  assert.equal(db.readHistory('a').filter((e) => e.kind === 'automation_applied').length, 1);
  assert.ok(loadControl(db, 'a', 'control', 3, 'Анна'));
  db.enqueueDemo('a', db.readDemo('a')!.datasetId, 'Анна');
  assert.ok(loadControl(db, 'a', 'missing', 4, 'Анна'));
  assert.equal(db.processDemoJob(), true);
  assert.equal(db.readHistory('a')[0].kind, 'automation_skipped');
  assert.equal(db.readDemo('a')!.state.scenario, 'missing');
  assert.equal(db.undo('a', event.id, 'Анна'), 'already');
});

test('отмена автоматики при новой загрузке конфликтует; история пропусков и резерв сохраняются', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-demo-cases-'));
  const db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(join(directory, 'stage2.sqlite')); rmdirSync(directory); });
  for (const scenario of ['control', 'noRecipient', 'missing', 'incomplete', 'stale', 'lowVolume', 'exhausted'] as DemoCase[]) {
    const previous = db.readDemo('a');
    assert.ok(loadControl(db, 'a', scenario, previous?.revision ?? 0, 'Анна'));
    const loaded = db.readDemo('a')!;
    db.enqueueDemo('a', loaded.datasetId, 'Анна'); db.processDemoJob();
    const event = db.readHistory('a')[0];
    if (['control', 'noRecipient'].includes(scenario)) {
      assert.equal(event.kind, 'automation_applied');
      assert.equal(db.undo('a', event.id, 'Анна'), 'ok');
      assert.deepEqual(db.readDemo('a')!.state, loaded.state);
    } else {
      assert.equal(event.kind, 'automation_skipped');
      assert.deepEqual(db.readDemo('a')!.state, loaded.state);
    }
  }
  loadControl(db, 'a', 'control', db.readDemo('a')!.revision, 'Анна');
  db.enqueueDemo('a', db.readDemo('a')!.datasetId, 'Анна'); db.processDemoJob();
  const event = db.readHistory('a')[0];
  loadControl(db, 'a', 'noRecipient', db.readDemo('a')!.revision, 'Анна');
  const current = db.readDemo('a');
  assert.equal(db.undo('a', event.id, 'Анна'), 'conflict');
  assert.deepEqual(db.readDemo('a'), current);
});

test('миграция реальной схемы v4 сохраняет записи, сессии, черновики и единственную попытку DeepSeek', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-v4-'));
  const file = join(directory, 'stage2.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE test_records (owner TEXT PRIMARY KEY, content TEXT NOT NULL) STRICT;
    CREATE TABLE oauth_attempts (browser_hash TEXT PRIMARY KEY, state TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE sessions (session_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE campaign_drafts (owner TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL) STRICT;
    CREATE TABLE deepseek_trial (id INTEGER PRIMARY KEY, status TEXT NOT NULL, payload TEXT) STRICT;
    INSERT INTO test_records VALUES ('local', 'Старая запись');
    INSERT INTO deepseek_trial VALUES (1, 'started', NULL);
    PRAGMA user_version = 4;`);
  old.prepare('INSERT INTO campaign_drafts VALUES (?, ?, ?)').run('a', JSON.stringify(draft), 9);
  old.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('hash', 'a', 'Анна', Date.now() + 60000);
  old.prepare('INSERT INTO oauth_attempts VALUES (?, ?, ?, ?)').run('browser', 'state', 'verifier', Date.now() + 60000);
  old.close();
  let db = openDatabase(directory);
  t.after(() => { db.close(); rmSync(file); rmdirSync(directory); });
  assert.equal(db.read('local'), 'Старая запись');
  assert.deepEqual(db.readCampaign('a'), { draft, revision: 9 });
  assert.deepEqual({ ...db.readSession('hash') }, { owner: 'a', name: 'Анна' });
  assert.equal(db.consumeAttempt('browser', 'state'), 'verifier');
  assert.equal(db.startDeepSeekTrial(), false);
  assert.equal(db.readHistory('a')[0].kind, 'baseline');
  assert.equal(db.undo('a', db.readHistory('a')[0].id, 'Анна'), 'unsupported');
  db.close(); db = openDatabase(directory);
  assert.equal(db.readHistory('a').length, 1);
  const inspect = new DatabaseSync(file);
  assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 11);
  assert.equal(inspect.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  inspect.close();
});
