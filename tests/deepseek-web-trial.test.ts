import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.ts';
import { createApp } from '../src/server.ts';
import { exampleCampaign } from '../src/campaign.ts';

test('прежняя trial-форма закрыта: история сохраняется, нового платного входа нет', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-trial-')), db = openDatabase(dir); let requests = 0;
  db.startDeepSeekTrial();
  const server = createApp(db, undefined, undefined, async () => { requests++; throw new Error('should not call'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true }); });
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string'); const origin = `http://127.0.0.1:${addr.port}`;
  for (let i = 0; i < 2; i++) {
    const response = await fetch(origin + '/campaign/deepseek', { method: 'POST', headers: { Origin: origin }, body: new URLSearchParams({ ...exampleCampaign, revision: '0' }) });
    assert.equal(response.status, 409); assert.match(await response.text(), /Прежняя платная проба закрыта/);
  }
  assert.equal(requests, 0); assert.equal(db.readDeepSeekTrial()?.status, 'started');
});
