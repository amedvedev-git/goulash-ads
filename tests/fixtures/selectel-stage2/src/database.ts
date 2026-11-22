import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(join(directory, 'stage2.sqlite'), { timeout: 5000 });

  try {
    database.exec('BEGIN IMMEDIATE');
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
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
    } else if (version !== 2) {
      throw new Error(`Неподдерживаемая версия схемы SQLite: ${version}`);
    }
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
    return {
      read(owner: string) {
        return (read.get(owner) as { content: string } | undefined)?.content ?? '';
      },
      write(owner: string, content: string) {
        write.run(owner, content);
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
