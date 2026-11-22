import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeepSeekAnalyzer } from '../src/business-analysis.ts';

test('DeepSeek получает только описание и возвращает проверенный разбор', async () => {
  const description = 'Пекарня печёт хлеб. Состав указан на сайте.';
  const proposal = { offer: 'Хлеб из пекарни', angle: 'Узнай состав на сайте.', evidence: 'Состав указан на сайте.', unknown: ['Цена'] };
  const completion = (content: unknown, finish_reason = 'stop') => Response.json({
    choices: [{ finish_reason, message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 214, completion_tokens: 67 },
  });
  let response = completion(proposal);
  let requests = 0;
  const usage: unknown[] = [];
  const analyze = createDeepSeekAnalyzer('test-key', async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-key');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    const body = JSON.parse(String(options.body));
    assert.equal(body.model, 'deepseek-flash');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.deepEqual(body.messages.slice(1), [{ role: 'user', content: description }]);
    return response;
  }, (value) => usage.push(value));
  assert.deepEqual(await analyze(description), proposal);
  assert.deepEqual(usage, [{ promptTokens: 214, completionTokens: 67 }]);
  response = completion({ ...proposal, evidence: 'Бесплатная доставка' });
  await assert.rejects(analyze(description), /Invalid business analysis/);
  response = completion(proposal, 'length');
  await assert.rejects(analyze(description), /Incomplete business analysis/);
  response = new Response(' '.repeat(20_000));
  await assert.rejects(analyze(description), /response too large/);
  response = new Response(null, { status: 429 });
  await assert.rejects(analyze(description), /HTTP 429/);
  assert.equal(requests, 5);
});
