import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CampaignDraft } from './campaign.ts';
import type { DeepSeekTrial, DeepSeekTrialResult } from './business-analysis.ts';
import { createOperations, migrateOperations } from './operations.ts';
import { createDirectStore, migrateDirect, migratePhrases, migrateDirectConnections } from './direct-store.ts';
import { createCampaignPlanStore, migrateCampaignPlans } from './campaign-plan.ts';

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, 'stage2.sqlite'), { timeout: 5000 });

  try {
    database.exec('BEGIN IMMEDIATE');
    const version = Number(database.prepare('PRAGMA user_version').get()?.user_version);
    if (version === 0 || version === 1) {
      database.exec(`
        CREATE TABLE test_records (
          owner TEXT PRIMARY KEY,
          content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 200)
        ) STRICT;
        CREATE TABLE oauth_attempts (
          browser_hash TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          verifier TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE sessions (
          session_hash TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        ) STRICT;
      `);
      if (version === 1) {
        database.exec(`
          INSERT INTO test_records (owner, content)
          SELECT 'local', content FROM test_record;
          DROP TABLE test_record;
        `);
      }
      database.exec('PRAGMA user_version = 2');
    } else if (![2, 3, 4, 5, 6, 7, 8, 9].includes(version)) {
      throw new Error(`Неподдерживаемая версия схемы SQLite: ${version}`);
    }
    if (version < 3) {
      database.exec(`
        CREATE TABLE campaign_drafts (
          owner TEXT PRIMARY KEY,
          payload TEXT NOT NULL CHECK (json_valid(payload)),
          revision INTEGER NOT NULL CHECK (revision > 0)
        ) STRICT;
        PRAGMA user_version = 3;
      `);
    }
    if (version < 4) {
      database.exec(`
        CREATE TABLE deepseek_trial (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          status TEXT NOT NULL CHECK (status IN ('started', 'failed', 'completed')),
          payload TEXT CHECK ((status = 'completed' AND payload IS NOT NULL AND json_valid(payload))
            OR (status IN ('started', 'failed') AND payload IS NULL))
        ) STRICT;
        PRAGMA user_version = 4;
      `);
    }
    if (version < 5) migrateOperations(database);
    if (version < 6) migrateDirect(database);
    if (version < 7) migratePhrases(database);
    if (version < 8) migrateCampaignPlans(database);
    if (version < 9) migrateDirectConnections(database);
    database.exec('COMMIT');

    const read = database.prepare('SELECT content FROM test_records WHERE owner = ?');
    const write = database.prepare(`
      INSERT INTO test_records (owner, content) VALUES (?, ?)
      ON CONFLICT (owner) DO UPDATE SET content = excluded.content
    `);
    const discardAttempt = database.prepare('DELETE FROM oauth_attempts WHERE browser_hash = ?');
    const removeSession = database.prepare('DELETE FROM sessions WHERE session_hash = ?');
    const pruneAttempts = database.prepare('DELETE FROM oauth_attempts WHERE expires_at <= ?');
    const pruneSessions = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    const insertAttempt = database.prepare('INSERT INTO oauth_attempts VALUES (?, ?, ?, ?)');
    const consumeAttempt = database.prepare(`
      DELETE FROM oauth_attempts WHERE browser_hash = ? AND state = ? AND expires_at > ? RETURNING verifier
    `);
    const insertSession = database.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)');
    const readSession = database.prepare('SELECT owner, name FROM sessions WHERE session_hash = ? AND expires_at > ?');
    const readCampaign = database.prepare('SELECT payload, revision FROM campaign_drafts WHERE owner = ?');
    const readTrial = database.prepare('SELECT status, payload FROM deepseek_trial WHERE id = 1');
    const startTrial = database.prepare("INSERT INTO deepseek_trial VALUES (1, 'started', NULL) ON CONFLICT (id) DO NOTHING");
    const finishTrial = database.prepare("UPDATE deepseek_trial SET status = ?, payload = ? WHERE id = 1 AND status = 'started'");
    return {
      ...createOperations(database),
      ...createDirectStore(database),
      ...createCampaignPlanStore(database),
      read(owner: string) {
        return (read.get(owner) as { content: string } | undefined)?.content ?? '';
      },
      write(owner: string, content: string) {
        write.run(owner, content);
      },
      readCampaign(owner: string) {
        const row = readCampaign.get(owner) as { payload: string; revision: number } | undefined;
        return row ? { draft: JSON.parse(row.payload) as CampaignDraft, revision: row.revision } : undefined;
      },
      readDeepSeekTrial(): DeepSeekTrial | undefined {
        const row = readTrial.get() as { status: DeepSeekTrial['status']; payload: string | null } | undefined;
        if (!row) return;
        if (row.status === 'completed') return { status: 'completed', result: JSON.parse(row.payload!) as DeepSeekTrialResult };
        return { status: row.status };
      },
      startDeepSeekTrial() {
        return startTrial.run().changes === 1;
      },
      finishDeepSeekTrial(result?: DeepSeekTrialResult) {
        finishTrial.run(result ? 'completed' : 'failed', result ? JSON.stringify(result) : null);
      },
      startAttempt(hash: string, state: string, verifier: string, expiresAt: number) {
        pruneAttempts.run(Date.now());
        insertAttempt.run(hash, state, verifier, expiresAt);
      },
      discardAttempt(hash: string) {
        discardAttempt.run(hash);
      },
      consumeAttempt(hash: string, state: string) {
        return (consumeAttempt.get(hash, state, Date.now()) as { verifier: string } | undefined)?.verifier;
      },
      createSession(hash: string, owner: string, name: string, expiresAt: number) {
        pruneSessions.run(Date.now());
        insertSession.run(hash, owner, name, expiresAt);
      },
      readSession(hash: string) {
        return readSession.get(hash, Date.now()) as { owner: string; name: string } | undefined;
      },
      removeSession(hash: string) {
        removeSession.run(hash);
      },
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
