import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';
import type { DirectState } from '../src/direct.ts';
import { createOptimizationExplanation, optimizationExplanationFacts } from '../src/optimization-explanation.ts';
import { createPhraseIntelligence } from '../src/phrase-intelligence.ts';

function setup(t: test.TestContext) {
  const folder = mkdtempSync(join(tmpdir(), 'goulash-optimization-explanation-'));
  const db = openDatabase(folder);
  t.after(() => { db.close(); rmSync(folder, { recursive: true, force: true }); });
  const owner = 'yandex:501', campaignId = db.createCampaignWorkspace(owner).id;
  const decision = { key: 'decision-key', at: '2026-11-19T00:00:00Z', kind: 'assessment' as const, actor: 'private-actor',
    reason: 'private-reason', report: 'private-report-id', cpaKop: 63000, targetKop: 40000 };
  const run = { account: '100', planId: 'run-explanation', campaignId, guidedDraft: true, complete: true,
    optimization: { enabled: true, decisions: [decision] } } as DirectState;
  db.saveDirect(owner, run);
  const read = () => db.readDirect(owner, run.planId)!;
  const form = (overrides: Record<string, string> = {}) => new URLSearchParams({ run: run.planId, revision: String(read().storageRevision),
    decision: decision.key, at: decision.at, confirm: 'yes', ...overrides });
  return { db, owner, campaignId, decision, read, form };
}

const answer = (value: unknown) => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test('ИИ получает только разрешённые типы фактов, одна попытка устойчива к повтору и обновлению журнала', async t => {
  const x = setup(t);
  let calls = 0, finish!: () => void;
  const provider = createPhraseIntelligence('fixture-key', async (_url, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(JSON.parse(payload.messages[1].content), { verdict: 'above_target', factIds: ['finding', 'cost', 'target', 'report'] });
    assert.doesNotMatch(String(init?.body), /private-|63000|40000|run-explanation|yandex:501|fixture-key/);
    await new Promise<void>(resolve => { finish = resolve; });
    return answer({ order: ['target', 'report', 'cost', 'finding'] });
  });
  const service = createOptimizationExplanation(x.db, provider, owner => owner === x.owner);
  await assert.rejects(service.explain('other-owner', x.campaignId, x.form()), /недоступно/);
  await assert.rejects(service.explain(x.owner, x.campaignId, x.form({confirm: 'no'})), /Подтвердите/);
  await assert.rejects(service.explain(x.owner, x.campaignId, x.form({at: 'different'})), /сохранённую оценку/);
  assert.equal(calls, 0);

  const form = x.form();
  const started = service.explain(x.owner, x.campaignId, form);
  assert.equal(x.read().optimization!.decisions[0].explanation?.status, 'pending');
  assert.equal(calls, 1);
  const otherRequest = createOptimizationExplanation(x.db, provider, () => true);
  await otherRequest.explain(x.owner, x.campaignId, form);
  assert.equal(calls, 1);
  const current = x.read();
  current.optimization!.decisions.push({ key: 'new', at: '2026-11-19T00:01:00Z', actor: 's', kind: 'waiting', reason: 'Ожидание' });
  x.db.saveDirect(x.owner, current);
  finish();
  await started;

  const [decision, appended] = x.read().optimization!.decisions;
  assert.deepEqual(decision.explanation?.order, ['target', 'report', 'cost', 'finding']);
  assert.equal(decision.explanation?.status, 'ready');
  assert.equal(appended.key, 'new');
  const facts = optimizationExplanationFacts(decision);
  assert.match(facts[0], /400,00/);
  assert.match(facts[2], /630,00/);
  await service.explain(x.owner, x.campaignId, x.form());
  assert.equal(calls, 1);
});

test('некорректный или неопределённый ответ использует те же сохранённые факты и блокирует повтор', async t => {
  for (const failure of ['invalid', 'unknown']) await t.test(failure, async t => {
    const x = setup(t);
    let calls = 0;
    const provider = createPhraseIntelligence('fixture-key', async () => {
      calls++;
      if (failure === 'unknown') throw new Error('unsettled provider request');
      return answer({ order: ['finding', 'unknown-fact', 'cost', 'target'], content: 'unsupported external copy' });
    });
    await createOptimizationExplanation(x.db, provider, () => true).explain(x.owner, x.campaignId, x.form());
    const [decision] = x.read().optimization!.decisions;
    assert.equal(decision.explanation?.status, 'fallback');
    assert.deepEqual(optimizationExplanationFacts(decision), optimizationExplanationFacts(x.decision));
    assert.doesNotMatch(JSON.stringify(decision.explanation), /fixture-key|unsupported external copy|unknown-fact/);
    await createOptimizationExplanation(x.db, provider, () => true).explain(x.owner, x.campaignId, x.form());
    assert.equal(calls, 1);
  });
});
