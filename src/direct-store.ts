import type { DatabaseSync } from 'node:sqlite';
import type { DirectState } from './direct.ts';
import { DirectError } from './direct-api.ts';
import type { PhrasePlan } from './search-phrases.ts';
import { defaultCampaignId, ensureCampaignWorkspace } from './campaign-workspaces.ts';

export type StoredConnection = { owner: string; account: string; generation: number; status: string; activeRunId?: string; value: any };
export function migrateDirectConnections(db: DatabaseSync) {
  db.exec(`CREATE TABLE direct_accounts(account TEXT PRIMARY KEY, owner TEXT NOT NULL) STRICT;
    CREATE TABLE direct_connections(owner TEXT PRIMARY KEY,account TEXT NOT NULL,generation INTEGER NOT NULL,status TEXT NOT NULL,active_run_id TEXT,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    CREATE TABLE direct_runs(owner TEXT NOT NULL,id TEXT NOT NULL,account TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(owner,id)) STRICT;
    CREATE TABLE direct_connect_attempts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    CREATE TABLE direct_dispatches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,run_id TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    INSERT INTO direct_accounts SELECT account,owner FROM direct_bindings;
    INSERT INTO direct_connections SELECT owner,account,0,'disconnected',json_extract(payload,'$.planId'),'{}' FROM direct_bindings;
    INSERT INTO direct_runs SELECT owner,json_extract(payload,'$.planId'),account,1,payload FROM direct_bindings;
    DROP TABLE direct_bindings;
    PRAGMA user_version=9;`);
}

export function migratePhrases(db: DatabaseSync) {
  db.exec(`CREATE TABLE phrase_plans (owner TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    PRAGMA user_version = 7;`);
}

export function migrateDirect(db: DatabaseSync) {
  db.exec(`CREATE TABLE direct_bindings (owner TEXT PRIMARY KEY, account TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
    CREATE TABLE direct_lock (account TEXT PRIMARY KEY, pid INTEGER NOT NULL) STRICT;
    PRAGMA user_version = 6;`);
}
export function createDirectStore(db: DatabaseSync) {
  function transaction<T>(action: () => T): T {
    if (db.isTransaction) return action();
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function connection(owner: string): StoredConnection | undefined {
    const row = db.prepare('SELECT * FROM direct_connections WHERE owner=?').get(owner) as any;
    return row && { owner, account: row.account, generation: row.generation, status: row.status, activeRunId: row.active_run_id ?? undefined, value: JSON.parse(row.payload) };
  }
  return {
    directTransaction: transaction,
    readDirectConnection: connection,
    ensureDirectConnection(owner: string) {
      db.prepare("INSERT INTO direct_connections VALUES (?,'',0,'disconnected',NULL,'{}') ON CONFLICT(owner) DO NOTHING").run(owner);
      return connection(owner)!;
    },
    setDirectConnection(value: StoredConnection, expected: number) {
      if (value.account) {
        const prior = db.prepare('SELECT owner FROM direct_accounts WHERE account=?').get(value.account) as any;
        if (prior && prior.owner !== value.owner) throw new DirectError('Этот кабинет нельзя подключить к данному владельцу.');
        db.prepare('INSERT INTO direct_accounts VALUES (?,?) ON CONFLICT(account) DO NOTHING').run(value.account, value.owner);
      }
      const result = db.prepare('UPDATE direct_connections SET account=?,generation=?,status=?,active_run_id=?,payload=? WHERE owner=? AND generation=?')
        .run(value.account, value.generation, value.status, value.activeRunId ?? null, JSON.stringify(value.value), value.owner, expected);
      if (result.changes !== 1) throw new DirectError('Подключение уже изменилось. Откройте актуальную страницу.');
    },
    saveConnectAttempt(id: string, owner: string, expires: number, value: any) {
      db.prepare('DELETE FROM direct_connect_attempts WHERE owner=? OR expires_at<=?').run(owner, Date.now());
      db.prepare('INSERT INTO direct_connect_attempts VALUES (?,?,?,?)').run(id, owner, expires, JSON.stringify(value));
    },
    readConnectAttempt(owner: string) {
      const row = db.prepare('SELECT * FROM direct_connect_attempts WHERE owner=? AND expires_at>?').get(owner, Date.now()) as any;
      return row && { id: row.id, expires: row.expires_at, value: JSON.parse(row.payload) };
    },
    removeConnectAttempts(owner: string) { db.prepare('DELETE FROM direct_connect_attempts WHERE owner=?').run(owner); },
    recordDirectDispatch(id: string, owner: string, runId: string, value: any) {
      db.prepare('INSERT INTO direct_dispatches VALUES (?,?,?,?)').run(id, owner, runId, JSON.stringify(value));
    },
    directDispatches(owner: string, runId: string) {
      return (db.prepare('SELECT payload FROM direct_dispatches WHERE owner=? AND run_id=? ORDER BY rowid').all(owner, runId) as any[]).map(row => JSON.parse(row.payload));
    },
    directBusy(account: string) { return Boolean(db.prepare('SELECT 1 FROM direct_lock WHERE account=?').get(account)); },
    readPhrasePlan(owner: string, campaignId = defaultCampaignId): PhrasePlan | undefined {
      const row = db.prepare('SELECT payload FROM phrase_plans WHERE owner=? AND campaign_id=?').get(owner, campaignId) as { payload: string } | undefined;
      return row ? JSON.parse(row.payload) : undefined;
    },
    savePhrasePlan(owner: string, plan: PhrasePlan, campaignId = defaultCampaignId) {
      transaction(() => {
        ensureCampaignWorkspace(db, owner, campaignId);
        db.prepare('INSERT INTO phrase_plans(owner,payload,campaign_id) VALUES (?,?,?) ON CONFLICT(owner,campaign_id) DO UPDATE SET payload=excluded.payload')
          .run(owner, JSON.stringify(plan), campaignId);
      });
    },
    readDirect(owner: string, id?: string): DirectState | undefined {
      const runId = id ?? connection(owner)?.activeRunId;
      const row = runId && db.prepare('SELECT payload,revision FROM direct_runs WHERE owner=? AND id=?').get(owner, runId) as any;
      return row ? { ...JSON.parse(row.payload), storageRevision: row.revision } : undefined;
    },
    readDirectRuns(owner: string): DirectState[] {
      return (db.prepare('SELECT payload,revision FROM direct_runs WHERE owner=? ORDER BY rowid').all(owner) as any[]).map(row => ({ ...JSON.parse(row.payload), storageRevision: row.revision }));
    },
    readEnabledCampaignOptimizations(): { owner: string; planId: string }[] {
      return db.prepare("SELECT owner,id AS planId FROM direct_runs WHERE json_extract(payload,'$.optimization.enabled')=1 ORDER BY rowid").all() as { owner: string; planId: string }[];
    },
    readCampaignDirectRuns(owner: string, campaignId: string): DirectState[] {
      const rows = db.prepare("SELECT payload,revision FROM direct_runs WHERE owner=? AND coalesce(json_extract(payload,'$.campaignId'),?)=? ORDER BY rowid")
        .all(owner, defaultCampaignId, campaignId);
      return rows.map(row => ({ ...JSON.parse(String(row.payload)), storageRevision: Number(row.revision) }));
    },
    saveDirect(owner: string, state: DirectState) {
      const { storageRevision, ...payload } = state;
      if (storageRevision) {
        const changed = db.prepare('UPDATE direct_runs SET revision=revision+1,payload=? WHERE owner=? AND id=? AND account=? AND revision=?')
          .run(JSON.stringify(payload), owner, state.planId, state.account, storageRevision);
        if (changed.changes !== 1) throw new DirectError('Операция уже изменилась. Сверьте актуальное состояние.');
        state.storageRevision = storageRevision + 1;
      } else {
        transaction(() => {
          const current = connection(owner);
          const reservation = db.prepare('SELECT owner FROM direct_accounts WHERE account=?').get(state.account) as any;
          if (reservation && reservation.owner !== owner) throw new DirectError('Этот кабинет принадлежит другому владельцу.');
          db.prepare('INSERT INTO direct_accounts VALUES (?,?) ON CONFLICT(account) DO NOTHING').run(state.account, owner);
          db.prepare('INSERT INTO direct_runs VALUES (?,?,?,1,?)').run(owner, state.planId, state.account, JSON.stringify(payload));
          if (!current) db.prepare("INSERT INTO direct_connections VALUES (?,?,0,'disconnected',?,'{}')").run(owner,state.account,state.planId);
          else db.prepare('UPDATE direct_connections SET active_run_id=? WHERE owner=?').run(state.planId, owner);
        });
        state.storageRevision = 1;
      }
    },
    lockDirect(account: string) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT pid FROM direct_lock WHERE account=?').get(account);
        if (row) {
          let alive = true;
          try { process.kill(Number(row.pid), 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
          if (alive) throw new DirectError('Операция Директа уже выполняется. Дождитесь результата и обновите страницу.');
          db.prepare('DELETE FROM direct_lock WHERE account=?').run(account);
        }
        db.prepare('INSERT INTO direct_lock VALUES (?, ?)').run(account, process.pid);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return () => db.prepare('DELETE FROM direct_lock WHERE account=? AND pid=?').run(account, process.pid);
    },
  };
}
