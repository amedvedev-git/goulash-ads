import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { openDatabase } from '../src/database.ts';
import { createSecretCodec, type SecretCodec } from '../src/direct-secrets.ts';
import { createMetrikaConnections } from '../src/metrika-connect.ts';

const owner = 'yandex:101', other = 'yandex:202', clientId = 'metrika-fixture-client';
const session = 'owner-session', second = 'second-owner-session', foreign = 'foreign-session';
const access = 'fixture-metrika-token';
const form = (state: string, code = 'fixture-code') => new URLSearchParams({ state, code });
const disconnectForm = (view: ReturnType<ReturnType<typeof createMetrikaConnections>['view']>) =>
  new URLSearchParams({ confirm: 'disconnect', revision: String(view.revision), disconnectProof: view.disconnectProof ?? '' });

function fixture(t: TestContext) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'metrika-oauth-'));
  const db = openDatabase(directory);
  t.after(() => {
    db.close();
    assert.equal(dirname(resolve(directory)), root);
    rmSync(directory, { recursive: true, force: true });
  });
  for (const [who, whose] of [[session, owner], [second, owner], [foreign, other]])
    db.createSession(who, whose, 'Тестовый владелец', Date.now() + 3_600_000);

  let codeExchanges = 0, counterReads = 0, identity = '101', challenge: string | null = null;
  let exchangeGate: Promise<void> | undefined, readGate: Promise<void> | undefined;
  const codec = createSecretCodec({ platform: 'linux', key: Buffer.alloc(32, 17) });
  const wrappedCodec: SecretCodec = {
    protect: codec.protect,
    async unprotect(envelope, context) {
      await readGate;
      return codec.unprotect(envelope, context);
    },
  };
  const transport: typeof fetch = async (resource, request) => {
    const url = new URL(String(resource));
    assert.equal(request?.redirect, 'error');
    if (url.href === 'https://oauth.yandex.ru/token') {
      codeExchanges++;
      assert.equal(request?.method, 'POST');
      assert.equal(new Headers(request?.headers).get('authorization'), 'Basic ' + Buffer.from(clientId + ':fixture-secret').toString('base64'));
      const query = request?.body as URLSearchParams;
      assert.equal(query.get('grant_type'), 'authorization_code');
      assert.equal(query.get('code'), 'fixture-code');
      assert.equal(createHash('sha256').update(query.get('code_verifier')!).digest('base64url'), challenge);
      await exchangeGate;
      return Response.json({ access_token: access, scope: 'metrika:read', expires_in: 3600 });
    }
    assert.equal(new Headers(request?.headers).get('authorization'), 'OAuth ' + access);
    if (url.href === 'https://login.yandex.ru/info?format=json') return Response.json({ id: identity, client_id: clientId });
    assert.equal(url.origin + url.pathname, 'https://api-metrika.yandex.net/management/v1/counters');
    counterReads++;
    return Response.json({ counters: [{ id: 42, site: 'example.com', name: 'Тестовый счётчик' }] });
  };
  const config = { clientId, clientSecret: 'fixture-secret', codec: wrappedCodec, transport };
  const connections = createMetrikaConnections(db, config);
  function start(who = session, whose = owner) {
    connections.start(whose, who);
    const attempt = connections.view(whose, who).attempt!;
    const authorization = new URL(attempt.url);
    assert.equal(authorization.origin + authorization.pathname, 'https://oauth.yandex.ru/authorize');
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://oauth.yandex.ru/verification_code');
    assert.equal(authorization.searchParams.get('scope'), 'metrika:read');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('state'), attempt.state);
    challenge = authorization.searchParams.get('code_challenge');
    return attempt.state;
  }
  return { db, config, connections, start, differentUser: () => { identity = '202'; },
    counts: () => [codeExchanges, counterReads],
    holdExchange() { const gate = Promise.withResolvers<void>(); exchangeGate = gate.promise; return gate.resolve; },
    holdRead() { const gate = Promise.withResolvers<void>(); readGate = gate.promise; return gate.resolve; },
  };
}

test('Метрика OAuth: PKCE, владелец и браузер, шифрование, отзыв до отправки чтения', async t => {
  const x = fixture(t), state = x.start();
  const { connections } = x;
  assert.equal(connections.view(owner, second).attempt, undefined);
  await assert.rejects(connections.finish(owner, second, form(state)), /устарела/);
  await assert.rejects(connections.finish(owner, foreign, form(state)), /Войдите/);
  await assert.rejects(connections.finish(other, foreign, form(state)), /устарела/);
  assert.deepEqual(x.counts(), [0, 0]);

  await connections.finish(owner, session, form(state));
  assert.equal(connections.view(owner, session).status, 'connected');
  assert.equal(connections.view(owner, session).attempt, undefined);
  await assert.rejects(connections.finish(owner, session, form(state)), /устарела/);
  const stored = x.db.readAnalyticsSettings(owner);
  assert.equal(stored.metrikaEnabled, true);
  assert.equal(stored.metrikaOAuth!.envelope!.kind, 'aes-gcm');
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(access));
  assert.equal(connections.resolve(other), undefined);
  const restarted = createMetrikaConnections(x.db, x.config);
  const provider = restarted.resolve(owner)!;
  assert.deepEqual(await provider.api.counters(), [{ id: '42', domain: 'example.com', name: 'Тестовый счётчик' }]);
  const release = x.holdRead(), lateRead = provider.api.counters();
  const revoke = disconnectForm(restarted.view(owner, session));
  restarted.disconnect(owner, session, revoke);
  release();
  await assert.rejects(lateRead, /доступ отключён/);
  assert.deepEqual(x.counts(), [1, 1]);
  assert.equal(restarted.resolve(owner), undefined);
  assert.equal(restarted.view(owner, session).disconnectProof, undefined);
  assert.throws(() => restarted.disconnect(owner, session, revoke), /Обновите подключения/);
  assert.equal(x.db.readAnalyticsSettings(owner).metrikaOAuth!.envelope, undefined);
});

test('Метрика OAuth: новый старт, отмена и выход гасят уже отправленный обмен', async t => {
  for (const action of ['restart', 'cancel', 'unlink', 'logout']) {
    await t.test(action, async subtest => {
      const x = fixture(subtest);
      const { connections } = x;
      if (action === 'unlink') await connections.finish(owner, session, form(x.start()));
      const state = x.start();
      const release = x.holdExchange(), pending = connections.finish(owner, session, form(state));
      await assert.rejects(connections.finish(owner, session, form(state)), /устарела/);
      let replacement: string | undefined;
      if (action === 'restart') replacement = x.start(second);
      if (action === 'cancel') connections.cancel(owner, session, form(state));
      if (action === 'unlink') connections.disconnect(owner, session, disconnectForm(connections.view(owner, session)));
      if (action === 'logout') x.db.removeSession(session);
      release();
      await assert.rejects(pending, action === 'logout' ? /Войдите/ : /устарела/);
      assert.equal(connections.resolve(owner), undefined);
      assert.deepEqual(x.counts(), [action === 'unlink' ? 2 : 1, 0]);
      assert.equal(connections.view(owner, second).attempt?.state, replacement);
    });
  }
});

test('Метрика OAuth: старая форма отзыва не действует из другой сессии или на другого владельца с той же ревизией', async t => {
  const x = fixture(t);
  await x.connections.finish(owner, session, form(x.start()));
  const first = x.connections.view(owner, session);
  const stale = disconnectForm(first);
  assert.throws(() => x.connections.disconnect(owner, second, stale), /Обновите подключения/);
  x.differentUser();
  await x.connections.finish(other, foreign, form(x.start(foreign, other)));
  assert.equal(x.connections.view(other, foreign).revision, first.revision);
  assert.throws(() => x.connections.disconnect(other, foreign, stale), /Обновите подключения/);
  assert.ok(x.connections.resolve(owner));
  assert.ok(x.connections.resolve(other));
  x.connections.disconnect(owner, session, stale);
  assert.equal(x.connections.resolve(owner), undefined);
  assert.ok(x.connections.resolve(other));
});

test('Метрика OAuth: выдача кода под другим Яндекс ID не меняет подключение', async t => {
  const x = fixture(t);
  await x.connections.finish(owner, session, form(x.start()));
  const stored = x.db.readAnalyticsSettings(owner);
  x.differentUser();
  await assert.rejects(x.connections.finish(owner, session, form(x.start())), /тот же аккаунт/);
  assert.deepEqual(x.db.readAnalyticsSettings(owner), stored);
});
