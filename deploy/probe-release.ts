import { openDatabase } from '../src/database.ts';
import { renderPage } from '../src/page.ts';
import { createApp } from '../src/server.ts';

// Only a supplied database copy (or a stopped service's DB) is opened. No worker or network starts.
const directory = process.argv[2];
if (!directory) throw new Error('Database directory is required.');
const db = openDatabase(directory);
try {
  const server = createApp(db);
  if (server.listening) throw new Error('Unexpected listener in migration probe.');
  const html = renderPage(undefined, '', false, true);
  if (!html.includes('Войти через Яндекс ID') || !html.includes('href="/auth/yandex"')) throw new Error('Page probe failed.');
  console.log('OK: migration and module probe; no network or worker started.');
} finally { db.close(); }
