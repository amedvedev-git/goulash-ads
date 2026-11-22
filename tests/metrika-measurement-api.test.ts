import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetrikaApi } from '../src/metrika-api.ts';

test('проверка цели использует только отмеченный визит и отклоняет повторные события и семплирование', async () => {
  let counts = [1, 1, 1], sampled = false, changedFilter = false;
  const marker = 'da8e11cb1e254f848e10ac352af761b6';
  const api = createMetrikaApi(async () => 'fixture', async url => {
    const query = new URL(String(url)).searchParams;
    const filters = `ym:s:startURLPathFull=@'goulash_test=${marker}' AND ym:s:startURLDomain=='example.test'`;
    assert.equal(query.get('filters'), filters);
    assert.equal(query.get('ids'), '123');
    return Response.json({ query: { filters: changedFilter ? '' : filters, date1: query.get('date1'), date2: query.get('date2'),
      timezone: '+03:00', metrics: query.get('metrics')!.split(','), dimensions: [] }, totals: counts,
    data: [{ metrics: counts }], total_rows: 1, sampled, sample_share: sampled ? 0.5 : 1 });
  });
  const verify = () => api.testGoal('123', '456', '2026-11-20', '2026-11-20', marker, undefined, 'example.test');
  assert.equal(await verify(), true);
  counts = [1, 2, 1];
  assert.equal(await verify(), false);
  counts = [1, 1, 1]; sampled = true;
  assert.equal(await verify(), false);
  changedFilter = true;
  await assert.rejects(verify, /не соответствует/);
});
