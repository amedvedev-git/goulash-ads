import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { openDatabase as oldDatabase } from './fixtures/selectel-stage2/src/database.ts';
import { stageRelease } from '../scripts/Build-SelectelPackage.ts';
import { inventory, inspectDatabase, makeManifest, rollback, sha256, snapshotDatabase, update, verifyRelease } from '../deploy/manage-release.ts';
import type { Host, Paths } from '../deploy/manage-release.ts';

// A full scenario checks every TypeScript file in a separate Node process before the 30 s migration probe.
const releaseTimeoutMs = 90_000;
const oldCode = fileURLToPath(new URL('./fixtures/selectel-stage2/', import.meta.url));
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-deploy-'));
  const paths: Paths = { root: join(directory, 'app-root'), data: join(directory, 'data'), backups: join(directory, 'backups'), node: process.execPath };
  const app = join(paths.root, 'app'), candidate = join(directory, 'candidate');
  mkdirSync(app, { recursive: true });
  for (const file of Object.keys(inventory(oldCode)).filter((f) => f !== 'README.md')) {
    mkdirSync(dirname(join(app, file)), { recursive: true }); copyFileSync(join(oldCode, file), join(app, file));
  }
  const old = oldDatabase(paths.data);
  old.write('local', 'Локальная запись до обновления'); old.write('yandex:101', 'Запись первого аккаунта'); old.write('yandex:202', 'Запись второго аккаунта');
  old.createSession('synthetic-session', 'yandex:101', 'Тестовый пользователь', Date.now() + 3600000);
  old.startAttempt('synthetic-browser', 'synthetic-state', 'synthetic-verifier', Date.now() + 300000);
  old.close();
  const started = performance.now();
  stageRelease(candidate);
  t.diagnostic('Упаковка кандидата: ' + Math.round(performance.now() - started) + ' мс. Лимит сценария: ' + releaseTimeoutMs + ' мс.');
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  return { paths, candidate, app, database: join(paths.data, 'stage2.sqlite'), directory };
}
function service(t: TestContext, paths: Paths) {
  let child: ReturnType<typeof spawn> | undefined, closed: Promise<unknown> | undefined, origin = '';
  const counts = { starts: 0, stops: 0 };
  let failHealthOnce = false;
  const host: Host = {
    async checkBefore() { assert.ok(child && origin); await this.health(); },
    async stop() { counts.stops++; if (child) { child.kill(); await closed; child = undefined; } },
    async start() {
      counts.starts++;
      child = spawn(paths.node, [join(paths.root, 'app/src/server.ts')], {
        env: { ...process.env, GOULASH_DATA_DIR: paths.data, GOULASH_PORT: '0', GOULASH_BIND: '127.0.0.1',
          GOULASH_PUBLIC_ORIGIN: '', YANDEX_CLIENT_ID: '', YANDEX_CLIENT_SECRET: '', CREDENTIALS_DIRECTORY: '' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      closed = once(child, 'close');
      const lines = createInterface({ input: child.stdout! });
      try {
        const [line] = await Promise.race([once(lines, 'line', { signal: t.signal }), closed.then(() => { throw new Error('Service exited during startup'); })]);
        origin = line; assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      } finally { lines.close(); }
    },
    async health() {
      if (failHealthOnce && inspectDatabase(join(paths.data, 'stage2.sqlite')).schema === 11) { failHealthOnce = false; throw new Error('Simulated new release health failure'); }
      const response = await fetch(origin, { signal: t.signal });
      assert.equal(response.status, 200); const html = await response.text();
      assert.match(html, /Директ не подключён/);
      // The current UI moved the original persistence probe to Diagnostics; stage 2 keeps it on /.
      const recordPage = html.includes('href="/diagnostics"') ? await (await fetch(origin + '/diagnostics', { signal: t.signal })).text() : html;
      assert.match(recordPage, /Локальная запись до обновления/);
    },
  };
  return { host, counts, failNextHealth() { failHealthOnce = true; }, get origin() { return origin; } };
}
const noopHost: Host = { async checkBefore() {}, async stop() {}, async start() {}, async health() {} };
function remanifest(candidate: string) {
  rmSync(join(candidate, 'release.json')); makeManifest(candidate, 'test');
}

test('пакет: только runtime и инструменты, контрольные суммы и запрет подмены', (t) => {
  const { candidate } = fixture(t);
  const manifest = verifyRelease(candidate);
  assert.ok(manifest.files['src/operations.ts']);
  assert.ok(manifest.files['src/assets/Onest.ttf']);
  assert.ok(manifest.files['src/assets/PixelifySans.ttf']);
  assert.ok(manifest.files['src/assets/PixelifySans-OFL.txt']);
  assert.ok(manifest.files['src/assets/ui-client.js']);
  assert.ok(manifest.files['src/campaign-flow.ts']);
  assert.ok(Object.keys(manifest.files).every((f) => !/sqlite|credential|\.env|MEMORY|tests\//.test(f)));
  writeFileSync(join(candidate, 'src/server.ts'), '\n// changed', { flag: 'a' });
  assert.throws(() => verifyRelease(candidate), /checksum/);
});

test('SQLite backup включает WAL и не изменяет исходную старую базу', async (t) => {
  const { database, directory } = fixture(t);
  const db = new DatabaseSync(database);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; INSERT INTO test_records VALUES ('wal-owner', 'Данные в WAL');");
  const before = inspectDatabase(database), destination = join(directory, 'snapshot.sqlite');
  assert.ok(existsSync(database + '-wal'));
  try {
    const info = await snapshotDatabase(database, destination);
    assert.equal(info.schema, 2); assert.deepEqual(inspectDatabase(destination), before);
    assert.deepEqual(inspectDatabase(database), before);
    assert.equal(sha256(readFileSync(destination)), info.sha256);
  } finally { db.close(); }
});

test('v2 → v11 на копии: старые данные, реальный HTTP, идемпотентность и полный откат', { timeout: releaseTimeoutMs }, async (t) => {
  const f = fixture(t), svc = service(t, f.paths), originalCode = inventory(f.app);
  await svc.host.start();
  try {
    // A write after the rehearsal must appear in the final stopped-service backup as well.
    const stop = svc.host.stop.bind(svc.host); let lateWrite = true;
    svc.host.stop = async () => {
      if (lateWrite) { const db = new DatabaseSync(f.database); db.exec("INSERT INTO test_records VALUES ('late', 'Последняя запись');"); db.close(); lateWrite = false; }
      await stop();
    };
    chmodSync(f.database, 0o600);
    if (process.platform === 'linux' && process.getuid?.() === 0) chownSync(f.database, 65534, 65534);
    const originalOwner = statSync(f.database);
    const mask = process.umask(0o077);
    let result;
    try { result = await update(f.paths, svc.host, f.candidate); } finally { process.umask(mask); }
    assert.equal(result.status, 'installed'); assert.equal(inspectDatabase(f.database).schema, 11);
    const state = JSON.parse(readFileSync(join(f.paths.root, 'deployment.json'), 'utf8'));
    if (process.platform !== 'win32') {
      assert.equal(statSync(f.app).mode & 0o777, 0o755);
      assert.equal(statSync(join(f.app, 'src')).mode & 0o777, 0o755);
      assert.equal(statSync(f.paths.backups).mode & 0o777, 0o700);
      assert.equal(statSync(f.database).uid, originalOwner.uid);
      assert.equal(statSync(f.database).gid, originalOwner.gid);
      assert.equal(statSync(f.database).mode & 0o777, 0o600);
    }
    const oldSnapshot = join(f.paths.backups, state.id, 'before.sqlite');
    assert.equal(inspectDatabase(oldSnapshot).schema, 2);
    const oldRows = inspectDatabase(oldSnapshot).tables, newRows = inspectDatabase(f.database).tables;
    for (const [table, hash] of Object.entries(oldRows)) assert.equal(newRows[table], hash);
    assert.match(await (await fetch(svc.origin + '/history', { signal: t.signal })).text(), /Изменения и решения/);
    const beforeRepeat = { ...svc.counts };
    assert.equal((await update(f.paths, svc.host, f.candidate)).status, 'already-installed');
    assert.deepEqual(svc.counts, beforeRepeat);
    const db = new DatabaseSync(f.database); db.exec("INSERT INTO test_records VALUES ('after-update', 'Новая запись');"); db.close();
    assert.equal((await rollback(f.paths, svc.host)).status, 'rolled-back');
    assert.deepEqual(inventory(f.app), originalCode);
    assert.equal(inspectDatabase(f.database).schema, 2);
    const reopened = oldDatabase(f.paths.data);
    assert.equal(reopened.read('late'), 'Последняя запись');
    assert.equal(reopened.read('after-update'), '');
    assert.equal(reopened.readSession('synthetic-session')?.owner, 'yandex:101'); reopened.close();
    const preserved = new DatabaseSync(join(f.paths.backups, state.id, 'after-update/stage2.sqlite'), { readOnly: true });
    assert.equal(preserved.prepare("SELECT content FROM test_records WHERE owner = 'after-update'").get()?.content, 'Новая запись'); preserved.close();
    const counts = { ...svc.counts };
    assert.equal((await rollback(f.paths, svc.host)).status, 'already-rolled-back'); assert.deepEqual(svc.counts, counts);
  } finally { await svc.host.stop(); }
});

test('ошибка новой версии автоматически возвращает старый код и v2, HTTP снова работает', { timeout: releaseTimeoutMs }, async (t) => {
  const f = fixture(t), svc = service(t, f.paths), original = inspectDatabase(f.database);
  await svc.host.start(); svc.failNextHealth();
  try {
    await assert.rejects(update(f.paths, svc.host, f.candidate), /previous code and database restored/);
    assert.deepEqual(inspectDatabase(f.database), original);
    assert.equal(JSON.parse(readFileSync(join(f.paths.root, 'deployment.json'), 'utf8')).phase, 'rolled-back');
    await svc.host.health();
  } finally { await svc.host.stop(); }
});

test('неуспешная миграция копии не останавливает и не изменяет старую версию', { timeout: releaseTimeoutMs }, async (t) => {
  const f = fixture(t), before = inspectDatabase(f.database); let stopped = false;
  writeFileSync(join(f.candidate, 'deploy/probe-release.ts'), "throw new Error('Simulated migration rejection');\n"); remanifest(f.candidate);
  const started = performance.now();
  await assert.rejects(update(f.paths, { ...noopHost, async stop() { stopped = true; } }, f.candidate), /Simulated migration rejection/);
  t.diagnostic('Проверка кода и отказ миграции копии: ' + Math.round(performance.now() - started) + ' мс.');
  assert.equal(stopped, false); assert.deepEqual(inspectDatabase(f.database), before);
  assert.equal(existsSync(join(f.paths.root, 'deployment.json')), false);
});

test('прерывание после замены кода и миграции: журнал требует откат, повтор восстанавливает v2', { timeout: releaseTimeoutMs }, async (t) => {
  const f = fixture(t), before = inspectDatabase(f.database), oldCodeHash = sha256(JSON.stringify(inventory(f.app)));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/deployment-crash.ts', import.meta.url)), JSON.stringify(f.paths), f.candidate], { stdio: 'ignore' });
  assert.equal((await once(child, 'exit'))[0], 91);
  assert.equal(inspectDatabase(f.database).schema, 11);
  await assert.rejects(update(f.paths, noopHost, f.candidate), /Interrupted deployment/);
  await rollback(f.paths, noopHost);
  assert.deepEqual(inspectDatabase(f.database), before);
  assert.equal(sha256(JSON.stringify(inventory(f.app))), oldCodeHash);
});

test('повреждённая резервная копия запрещает откат до остановки службы', { timeout: releaseTimeoutMs }, async (t) => {
  const f = fixture(t); await update(f.paths, noopHost, f.candidate);
  const state = JSON.parse(readFileSync(join(f.paths.root, 'deployment.json'), 'utf8'));
  const path = join(f.paths.backups, state.id, 'before.sqlite');
  writeFileSync(path, 'broken backup'); let stopped = false;
  await assert.rejects(rollback(f.paths, { ...noopHost, async stop() { stopped = true; } }), /Backup checksum mismatch/);
  assert.equal(stopped, false); assert.equal(inspectDatabase(f.database).schema, 11);
});
