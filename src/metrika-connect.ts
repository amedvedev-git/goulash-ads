import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { openDatabase } from './database.ts';
import { DirectError } from './direct-api.ts';
import { metrikaSecretContext } from './direct-secrets.ts';
import type { SecretCodec, SecretEnvelope } from './direct-secrets.ts';
import { createMetrikaApi } from './metrika-api.ts';
import type { MetrikaProvider } from './metrika-api.ts';

export type MetrikaOAuthConnection = {
  clientId: string;
  connectionId: string;
  envelope?: SecretEnvelope;
  expiresAt?: number;
};
export type MetrikaConnectView = {
  status: 'disconnected' | 'connected' | 'expired' | 'configuration_changed';
  revision: number;
  attempt?: { state: string; url: string };
  disconnectProof?: string;
};
type Config = { clientId: string; clientSecret: string; codec: SecretCodec; transport?: typeof fetch };
type Attempt = { session: string; pkce: string };
const random = () => randomBytes(32).toString('base64url');
const attemptTime = 600_000;
const scope = 'metrika:read';
const field = (form: URLSearchParams, name: string) => form.getAll(name).length === 1 ? form.get(name)! : '';
const retry = () => new DirectError('Попытка подключения Метрики устарела. Получите новый код.');

export function createMetrikaConnections(db: ReturnType<typeof openDatabase>, config: Config) {
  const transport = config.transport ?? fetch;
  const attemptKey = (owner: string) => createHash('sha256').update(JSON.stringify(['metrika-attempt', config.clientId, owner])).digest('hex');
  const disconnectProof = (owner: string, session: string, connectionId: string, revision: number) =>
    createHmac('sha256', config.clientSecret).update(JSON.stringify(['metrika-disconnect', config.clientId, owner, session, connectionId, revision])).digest('base64url');

  function requireSession(owner: string, session: string) {
    if (!/^yandex:\d{1,32}$/.test(owner) || !session || db.readSession(session)?.owner !== owner)
      throw new DirectError('Войдите через Яндекс ID, чтобы подключить Метрику.');
  }

  function readAttempt(owner: string, session: string) {
    const row = db.readOAuthAttempt(attemptKey(owner));
    if (!row || !session || db.readSession(session)?.owner !== owner) return;
    const attempt = JSON.parse(row.verifier) as Attempt;
    if (attempt.session === session) return { ...row, pkce: attempt.pkce };
  }

  function status(connection?: MetrikaOAuthConnection): MetrikaConnectView['status'] {
    if (!connection?.envelope) return 'disconnected';
    if (connection.clientId !== config.clientId) return 'configuration_changed';
    return (connection.expiresAt ?? 0) > Date.now() ? 'connected' : 'expired';
  }

  function view(owner: string, session: string): MetrikaConnectView {
    const settings = db.readAnalyticsSettings(owner);
    const result: MetrikaConnectView = { status: status(settings.metrikaOAuth), revision: settings.revision };
    if (settings.metrikaOAuth?.envelope && session && db.readSession(session)?.owner === owner)
      result.disconnectProof = disconnectProof(owner, session, settings.metrikaOAuth.connectionId, settings.revision);
    const attempt = readAttempt(owner, session);
    if (attempt?.pkce) {
      const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId,
        redirect_uri: 'https://oauth.yandex.ru/verification_code', scope, force_confirm: 'yes', state: attempt.state,
        code_challenge: createHash('sha256').update(attempt.pkce).digest('base64url'), code_challenge_method: 'S256' });
      result.attempt = { state: attempt.state, url: `https://oauth.yandex.ru/authorize?${params}` };
    }
    return result;
  }

  async function exchange(owner: string, code: string, verifier: string) {
    try {
      const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
      const response = await transport('https://oauth.yandex.ru/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Basic ${credentials}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }),
      });
      const token = await response.json().catch(() => undefined);
      if (!response.ok) {
        switch (token?.error) {
          case 'invalid_grant':
          case 'bad_verification_code':
            throw new DirectError('Код Метрики неверен, просрочен или уже использован. Получите новый код.');
          case 'invalid_client':
          case 'unauthorized_client':
            throw new DirectError('Яндекс отклонил настройки приложения Метрики. Обратитесь к администратору.');
          case 'invalid_scope':
            throw new DirectError('Яндекс не выдал право на чтение Метрики. Обратитесь к администратору.');
        }
        throw new DirectError('Яндекс не подтвердил выдачу доступа к Метрике. Повторите подключение позже.');
      }
      if (typeof token?.access_token !== 'string' || !/^[\x21-\x7e]{1,16000}$/.test(token.access_token)
        || !Number.isSafeInteger(token.expires_in) || token.expires_in <= 0 || token.expires_in > 10 * 366 * 86400)
        throw new DirectError('Яндекс вернул некорректные данные для доступа к Метрике. Обратитесь к администратору.');
      if (token.scope !== undefined && token.scope !== scope)
        throw new DirectError('Яндекс выдал неожиданный набор прав для Метрики. Обратитесь к администратору.');
      const expiresAt = Date.now() + token.expires_in * 1000;
      const identity = await transport('https://login.yandex.ru/info?format=json', {
        headers: { Authorization: `OAuth ${token.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      const profile = identity.ok ? await identity.json().catch(() => undefined) : undefined;
      if (profile?.client_id !== config.clientId || typeof profile.id !== 'string')
        throw new DirectError('Не удалось подтвердить Яндекс ID для доступа к Метрике. Повторите подключение позже.');
      return { access: token.access_token as string, expiresAt, ownerMatches: `yandex:${profile.id}` === owner };
    } catch (error) {
      if (error instanceof DirectError) throw error;
      throw new DirectError('Не удалось связаться с Яндексом для подключения Метрики. Повторите подключение позже.');
    }
  }

  return {
    view,
    start(owner: string, session: string) {
      requireSession(owner, session);
      db.replaceOAuthAttempt(attemptKey(owner), random(), JSON.stringify({ session, pkce: random() }), Date.now() + attemptTime);
    },
    async finish(owner: string, session: string, form: URLSearchParams) {
      requireSession(owner, session);
      const code = field(form, 'code').trim(), state = field(form, 'state');
      if (!/^[\x21-\x7e]{1,1024}$/.test(code)) throw new DirectError('Укажите одноразовый код Яндекса.');
      const key = attemptKey(owner), attempt = readAttempt(owner, session);
      // Keep the claimed attempt as a marker until publishing. A new start, cancel or unlink replaces it.
      const marker = JSON.stringify({ session, pkce: '' });
      if (!attempt?.pkce || attempt.state !== state || !db.claimOAuthAttempt(key, state, attempt.verifier, marker)) throw retry();
      try {
        const token = await exchange(owner, code, attempt.pkce);
        if (!token.ownerMatches) throw new DirectError('Выберите в Яндексе тот же аккаунт, под которым вошли в Goulash.');
        const connectionId = randomUUID();
        const envelope = await config.codec.protect(token.access, metrikaSecretContext(owner, config.clientId, connectionId));
        const current = db.readAnalyticsSettings(owner);
        db.saveAnalyticsSettings(owner, { ...current, metrikaEnabled: true, metrikaConfigId: connectionId,
          counter: undefined, goalId: undefined, generation: current.generation + 1,
          metrikaOAuth: { clientId: config.clientId, connectionId, envelope, expiresAt: token.expiresAt },
        }, current.revision, () => {
          requireSession(owner, session);
          if (token.expiresAt <= Date.now() || !db.discardOAuthAttempt(key, state, marker)) throw retry();
        }, { metrikaOnly: true });
      } catch (error) {
        // Clear only this spent marker after a failed exchange; a concurrent start is preserved.
        db.discardOAuthAttempt(key, state, marker);
        throw error;
      }
    },
    cancel(owner: string, session: string, form: URLSearchParams) {
      requireSession(owner, session);
      const state = field(form, 'state'), attempt = readAttempt(owner, session);
      if (!attempt || attempt.state !== state || !db.discardOAuthAttempt(attemptKey(owner), state, attempt.verifier)) throw retry();
    },
    disconnect(owner: string, session: string, form: URLSearchParams) {
      requireSession(owner, session);
      const current = db.readAnalyticsSettings(owner), revision = field(form, 'revision');
      const metrikaOAuth = current.metrikaOAuth;
      if (!metrikaOAuth?.envelope || String(current.revision) !== revision || field(form,'confirm') !== 'disconnect' ||
          field(form,'disconnectProof') !== disconnectProof(owner,session,metrikaOAuth.connectionId,current.revision))
        throw new DirectError('Обновите подключения и подтвердите отключение текущего доступа к Метрике.');
      db.saveAnalyticsSettings(owner, { ...current, metrikaEnabled: false, metrikaConfigId: undefined,
        generation: current.generation + 1,
        metrikaOAuth: { clientId: metrikaOAuth.clientId, connectionId: metrikaOAuth.connectionId },
      }, current.revision, () => {
        requireSession(owner, session);
        db.discardAttempt(attemptKey(owner));
      }, { metrikaOnly: true });
    },
    resolve(owner: string): MetrikaProvider | undefined {
      const connection = db.readAnalyticsSettings(owner).metrikaOAuth;
      if (!connection?.envelope || status(connection) !== 'connected') return;
      const envelope = connection.envelope;
      const api = createMetrikaApi(() => config.codec.unprotect(envelope, metrikaSecretContext(owner, config.clientId, connection.connectionId)), (url, options) => {
        const current = db.readAnalyticsSettings(owner).metrikaOAuth;
        if (current?.connectionId !== connection.connectionId || status(current) !== 'connected')
          throw new DirectError('Доступ к Метрике отключён, истёк или изменился.');
        return transport(url, options);
      });
      return { owner, mode: 'live', configId: connection.connectionId, api };
    },
  };
}
