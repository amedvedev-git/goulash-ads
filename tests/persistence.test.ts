import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exampleCampaign } from '../src/campaign.ts';

const entryPoint = fileURLToPath(new URL('../src/server.ts', import.meta.url));

async function startServer(directory: string, signal: AbortSignal) {
  const child = spawn(process.execPath, [entryPoint], {
    env: { ...process.env, GOULASH_DATA_DIR: directory, GOULASH_PORT: '0', YANDEX_CLIENT_ID: '', YANDEX_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  const stop = async () => {
    child.kill();
    await closed;
  };
  const output = createInterface({ input: child.stdout });
  try {
    const [origin] = await Promise.race([
      once(output, 'line', { signal }),
      closed.then(([code]) => { throw new Error(`Сервер остановился при запуске: ${code}`); }),
    ]);
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    return { origin, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    output.close();
  }
}

test('форма сохраняет запись в SQLite и читает её из нового процесса', { timeout: 20000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'goulash-stage2-'));
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  t.after(async () => {
    await server?.stop();
    await rm(join(directory, 'stage2.sqlite'), { force: true });
    await rmdir(directory);
  });

  server = await startServer(directory, t.signal);
  const { origin: firstOrigin } = server;
  const first = await fetch(`${firstOrigin}/diagnostics`, { signal: t.signal });
  assert.equal(first.status, 200);
  const initialPage = await first.text();
  assert.match(initialPage, /Директ не подключён/);
  assert.match(initialPage, /name="content"[^>]+value=""/);

  const save = (content: string, origin = firstOrigin) => fetch(`${firstOrigin}/test-record`, {
    method: 'POST',
    headers: { Origin: origin },
    body: new URLSearchParams({ content }),
    redirect: 'manual',
    signal: t.signal,
  });

  assert.equal((await save('Первая версия')).status, 303);
  const result = await save('Тест <запись> & "данные"');
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/diagnostics?saved=1');
  const confirmed = await fetch(`${firstOrigin}/diagnostics?saved=1`, { signal: t.signal });
  assert.match(await confirmed.text(), /Запись сохранена/);

  assert.equal((await save('Подмена', 'http://example.test')).status, 403);
  assert.equal((await save(' ')).status, 400);
  assert.equal((await save('x'.repeat(5000))).status, 413);

  const campaign = (action: string, values: Record<string, string>) => fetch(`${firstOrigin}/campaign/${action}`, {
    method: 'POST', headers: { Origin: firstOrigin }, body: new URLSearchParams(values),
    redirect: 'manual', signal: t.signal,
  });
  const demo = await (await fetch(`${firstOrigin}/?example=1`, { signal: t.signal })).text();
  assert.match(demo, /Рис и ролл/);
  assert.doesNotMatch(demo, /id="campaign-preview"/);
  assert.equal((await campaign('deepseek', { ...exampleCampaign, revision: '0' })).status, 404);
  const demoAnalysis = await campaign('analyze', { ...exampleCampaign, revision: '0' });
  assert.equal(demoAnalysis.status, 200);
  const demoProposal = await demoAnalysis.text();
  assert.match(demoProposal, /Подставной разбор вымышленного примера/);
  assert.match(demoProposal, /<blockquote>Меню и условия доставки указаны на сайте\.<\/blockquote>/);
  assert.match(demoProposal, /Стоимость доставки/);
  assert.doesNotMatch(demoProposal, /id="campaign-preview"/);
  const input = { revision: '0', description: 'Вымышленная пекарня', url: 'https://example.com/menu',
    region: 'Екатеринбург', budget: '7000', period: '7' };
  const invalid = await campaign('preview', { ...input, url: 'javascript:alert(1)', budget: '0' });
  assert.equal(invalid.status, 400);
  const invalidPage = await invalid.text();
  assert.match(invalidPage, /id="business-url-error"/);
  assert.match(invalidPage, /Вымышленная пекарня/);
  assert.doesNotMatch(invalidPage, /id="campaign-preview"/);

  const prepared = await campaign('preview', input);
  assert.equal(prepared.status, 200);
  assert.match(await prepared.text(), /id="campaign-preview"/);
  assert.equal((await campaign('save', { ...input, title: 'Тестовое объявление', adText: 'Подробности о предложении на сайте.' })).status, 303);
  const preview = await (await fetch(`${firstOrigin}/campaign?ad=default`, { signal: t.signal })).text();
  assert.match(preview, /id="campaign-preview"/);
  assert.match(preview, /Тестовое объявление/);
  const exampleWithDraft = await (await fetch(`${firstOrigin}/?example=1`, { signal: t.signal })).text();
  assert.match(exampleWithDraft, /Рис и ролл/);
  assert.match(exampleWithDraft, /name="title" value="Тестовое объявление"/);

  const business = { ...input, revision: '1' };
  const manual = await campaign('analyze', business);
  assert.equal(manual.status, 200);
  assert.match(await manual.text(), /Ручное заполнение/);
  const incomplete = await campaign('confirm', { ...business, title: 'Хлеб из пекарни', adText: '' });
  assert.equal(incomplete.status, 400);
  const incompletePage = await incomplete.text();
  assert.match(incompletePage, /id="analysis-adText-error"/);
  assert.match(incompletePage, /value="Хлеб из пекарни"/);
  assert.equal((await campaign('confirm', { ...business, title: 'Хлеб из пекарни', adText: 'Меню выпечки на сайте.' })).status, 200);
  assert.equal((await campaign('save', { ...business, title: 'Хлеб из пекарни', adText: 'Меню выпечки на сайте.' })).status, 303);
  const confirmedPreview = await (await fetch(`${firstOrigin}/campaign?ad=default`, { signal: t.signal })).text();
  assert.match(confirmedPreview, /class="ad-title"[^>]*>Хлеб из пекарни/);
  assert.match(confirmedPreview, /<p\b[^>]*\bdata-preview="adText"[^>]*>Меню выпечки на сайте\.<\/p>/);

  const edit = { revision: '2', title: 'Свежий хлеб <сегодня>', adText: 'Смотри меню пекарни.',
    url: 'https://example.com/bread', region: 'Пермь', budget: '21000', period: '30' };
  const invalidEdit = await campaign('save', { ...edit, period: '365' });
  assert.equal(invalidEdit.status, 400);
  assert.match(await invalidEdit.text(), /id="preview-period-error"/);
  assert.equal((await campaign('save', edit)).status, 303);
  assert.equal((await campaign('save', { ...edit, title: 'Устаревшая правка' })).status, 409);

  await server.stop();
  server = await startServer(directory, t.signal);
  const afterRestart = await fetch(`${server.origin}/campaign?ad=default`, { signal: t.signal });
  assert.equal(afterRestart.status, 200);
  const restored = await afterRestart.text();
  assert.match(await (await fetch(`${server.origin}/diagnostics`)).text(), /value="Тест &lt;запись&gt; &amp; &quot;данные&quot;"/);
  assert.match(restored, /class="ad-title"[^>]*>Свежий хлеб &lt;сегодня&gt;/);
  assert.match(restored, /Вымышленная пекарня/);
  assert.match(restored, /value="21000"/);
  assert.match(restored, /name="period" value="30"/);
  assert.doesNotMatch(restored, /Устаревшая правка/);
});
