import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initialPreparation } from '../src/campaign-plan.ts';
import { renderConnectionSettings } from '../src/connections-page.ts';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import type { MetrikaProvider } from '../src/metrika-api.ts';

test('Метрика показывает следующий шаг для текущего состояния доступа', () => {
  const view = { revision: 1, campaigns: [], metrika: { configured: false } };
  const admin = renderConnectionSettings(view);
  assert.match(admin, /Попросите администратора сервиса включить чтение/);
  assert.doesNotMatch(admin, /попросите владельца|Восстановить доступ к Метрике|Подключить Метрику/);
  const first = renderConnectionSettings({ ...view, metrikaAccess: { status: 'disconnected', revision: 1 } });
  assert.match(first, /попросите владельца дать вам доступ[\s\S]*Подключить Метрику/);
  assert.doesNotMatch(first, /Попросите администратора|Восстановить доступ к Метрике/);
  const expired = renderConnectionSettings({ ...view, metrikaAccess: { status: 'expired', revision: 1 } });
  assert.match(expired, /Доступ истёк[\s\S]*Восстановить доступ к Метрике/);
  assert.doesNotMatch(expired, /Попросите администратора|попросите владельца/);
});

test('подключения сохраняют отдельные цели кампаний и проверяют только отмеченный визит', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-connections-'));
  const db = openDatabase(directory);
  const create = (domain: string) => {
    const { id } = db.createCampaignWorkspace('local');
    const p = initialPreparation();
    p.guided = true;
    p.campaignName = domain;
    p.input.url = 'https://' + domain + '/subscribe';
    db.savePreparation('local', p, 0, undefined, 0, id);
    return id;
  };
  const a = create('first.example'), b = create('second.example');
  let probes = 0;
  const provider: MetrikaProvider = { owner: 'local', mode: 'fixture', configId: 'fixture', api: {
    async counter(id) {
      return { id, domain: id === '123' ? 'first.example' : 'second.example', mirrors: [], goals: [
        { id: id === '123' ? '456' : '789', name: 'Подтверждение', type: 'action', condition: '' },
      ] };
    },
    async testGoal(counter, goal, _from, _to, marker, guard, domain) {
      guard?.();
      assert.deepEqual([counter, goal, domain], ['123', '456', 'first.example']);
      assert.match(marker, /^[a-f0-9]{32}$/);
      probes++;
      return true;
    },
    async report() { throw new Error('Unexpected report'); },
    async daily() { throw new Error('Unexpected report'); },
  } };
  const server = createApp(db, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {}, undefined, provider);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const get = async (id: string) => (await fetch(`${origin}/connections/direct?ad=${id}`)).text();
  const saved = () => db.readAnalyticsSettings('local');
  const post = (action: string, id: string, fields: Record<string, string> = {}) => fetch(`${origin}/connections/metrika/${action}?ad=${id}`, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, ...(action === 'inspect' ? { Accept: 'application/json' } : {}) },
    body: new URLSearchParams({ revision: String(saved().revision), ...fields }),
  });
  assert.match(await get(a), /Яндекс Метрика[\s\S]*Рекламодатель/);
  const invalidCounter = await post('counter', a, { counterId: '999' });
  assert.equal(invalidCounter.status, 409);
  assert.match(await invalidCounter.text(), /id="metrika-counter" aria-invalid="true" aria-describedby="metrika-counter-error"/);
  for (const [source, path] of [['summary', 'prepare'], ['results', 'results'], ['journal', 'history']]) {
    const page = await (await fetch(`${origin}/connections/direct?ad=${a}&from=${source}`)).text();
    assert.equal(page.split(`href="/${path}?ad=${a}"`).length - 1, 1);
    assert.match(page, /Кампания «first\.example»/);
    const result = await fetch(`${origin}/connections/metrika/counter?ad=${a}&from=${source}`, {
      method: 'POST', headers: { Origin: origin }, redirect: 'manual',
      body: new URLSearchParams({ revision: String(db.readAnalyticsSettings('local').revision), counterId: '123' }),
    });
    assert.equal(result.headers.get('location'), `/connections/direct?ad=${a}&from=${source}`);
  }
  assert.equal((await post('counter', a, { counterId: '123' })).status, 303);
  assert.ok(saved().campaignAnalytics?.[a].measurement?.counterCheckedAt);
  assert.equal((await post('goal', a, { goalId: '456' })).status, 303);
  assert.equal((await post('test', a)).status, 303);
  assert.match(await get(a), /goulash_test=[a-f0-9]{32}/);
  assert.equal((await post('verify', a)).status, 303);
  assert.match(await get(a), /Тестовая заявка подтверждена\. Проверено <time/);
  assert.doesNotMatch(await get(b), /Тестовая заявка подтверждена|value="123"/);
  assert.equal(probes, 1);
  const before = saved();
  const preview = await post('inspect', b, { counterId: '812' });
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { id: '812', domain: 'second.example', goals: [{ id: '789', name: 'Подтверждение' }] });
  assert.deepEqual(saved(), before);
  const target = { counterId: '812', goalId: '789', returnPanel: 'metrika' };
  assert.equal((await post('configure', b, { ...target, goalId: '456' })).status, 409);
  assert.equal((await post('configure', a, target)).status, 409);
  assert.deepEqual(saved(), before);
  const configured = await post('configure', b, target);
  assert.equal(configured.headers.get('location'), `/connections/direct?ad=${b}&panel=metrika`);
  const after = saved();
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual([after.campaignAnalytics?.[b].measurement?.counter.id, after.campaignAnalytics?.[b].measurement?.goalId], ['812', '789']);
  assert.deepEqual(after.campaignAnalytics?.[a].measurement, before.campaignAnalytics?.[a].measurement);
  assert.equal((await post('configure', b, { ...target, revision: String(before.revision) })).status, 409);
  assert.equal((await post('configure', b, target)).status, 303);
  assert.deepEqual(saved(), after);
  const revoke = await fetch(origin+'/analytics/disconnect', { method: 'POST', redirect: 'manual', headers: { Origin: origin },
    body: new URLSearchParams({ confirm: 'disconnect', revision: String(db.readAnalyticsSettings('local').revision) }) });
  assert.equal(revoke.status, 303);
  assert.equal(db.readAnalyticsSettings('local').metrikaEnabled, false);
  const off = saved();
  assert.equal((await post('configure', b, target)).status, 409);
  assert.deepEqual(saved(), off);
  assert.equal((await post('configure', b, { ...target, enable: 'read' })).status, 303);
  assert.equal(saved().metrikaEnabled, true);
});
