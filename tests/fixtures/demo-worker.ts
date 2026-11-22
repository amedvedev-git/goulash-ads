import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openDatabase } from '../../src/database.ts';

const directory = process.argv[2];
if (process.argv[3] === 'crash') {
  const raw = new DatabaseSync(join(directory, 'stage2.sqlite'));
  raw.exec('BEGIN IMMEDIATE');
  raw.exec("UPDATE demo_states SET payload = json_set(payload, '$.campaigns[0].remaining', 0), revision = revision + 1");
  process.exit(0); // Deliberate termination before COMMIT, to exercise SQLite recovery.
}
const db = openDatabase(directory);
process.send!('ready');
process.once('message', () => {
  db.processDemoJob(); db.close(); process.disconnect();
});
