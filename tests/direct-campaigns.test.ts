import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { e2Draft, e2Fixture } from './fixtures/e2.ts';
import { confirmedPlan } from './fixtures/confirmed-plan.ts';

test('Директ использует выбранную кампанию даже при более новом наборе в другом черновике', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'direct-campaigns-'));
  const x = e2Fixture(directory);
  t.after(() => {
    x.db.close();
    assert.equal(dirname(directory), tmpdir());
    rmSync(directory, { recursive: true, force: true });
  });
  const { db, owner } = x;
  await x.connect();

  async function prepare(title: string) {
    const campaignId = db.createCampaignWorkspace(owner).id;
    const draft = { ...e2Draft, title };
    const campaignPlanId = confirmedPlan(db, draft, ['ремонт холодильников'], owner, [], campaignId);
    const revision = String(db.readCampaign(owner, campaignId)!.revision);
    const returned = await x.service().action(owner, 'prepare', new URLSearchParams({
      campaignId, campaignPlanId, revision, name: title,
    }), 'Fixture');
    assert.equal(returned, campaignId);
    return x.service().view(owner, campaignId).state!;
  }

  const first = await prepare('Ремонт дома');
  const second = await prepare('Ремонт в офисе');
  assert.equal(db.readDirect(owner)!.planId, second.planId);
  assert.equal(x.service().view(owner, first.campaignId).state?.planId, first.planId);
  assert.equal(db.readCampaignDirectRuns('yandex:202', first.campaignId!).length, 0);

  function request(action: string, runId: string, campaignId?: string) {
    const state = db.readDirect(owner, runId)!;
    return x.service().action(owner, action, new URLSearchParams({
      planId: runId, campaignId: campaignId ?? state.campaignId!, confirm: 'yes',
      storageRevision: String(state.storageRevision),
    }), 'Fixture');
  }

  await assert.rejects(request('create', first.planId, second.campaignId), /другой кампании/);
  assert.equal(x.a.writes().length, 0);

  x.a.fault('campaigns/add', 'after');
  await assert.rejects(request('create', first.planId));
  assert.equal(x.a.records.campaigns.length, 1);
  assert.equal(x.service().view(owner, second.campaignId).blockedCampaignId, first.campaignId);
  await assert.rejects(request('create', second.planId), /другой кампании/);

  await x.connect();
  let connection = x.manager.resolve(owner)!;
  assert.equal(connection.reconcileRunId, first.planId);
  await request('refresh', second.planId);
  x.manager.reconciled(owner, connection.generation!, second.planId);
  assert.equal(x.manager.resolve(owner)!.needsReconcile, true);
  await request('refresh', first.planId);
  x.manager.reconciled(owner, connection.generation!, first.planId);
  connection = x.manager.resolve(owner)!;
  assert.equal(connection.needsReconcile, false);

  assert.equal(await request('create', first.planId), first.campaignId);
  assert.equal(await request('create', second.planId), second.campaignId);
  const firstCreated = db.readDirect(owner, first.planId)!;
  const secondCreated = db.readDirect(owner, second.planId)!;
  assert.equal(firstCreated.complete, true);
  assert.equal(secondCreated.complete, true);
  assert.notEqual(firstCreated.steps.campaign.id, secondCreated.steps.campaign.id);
  assert.equal(firstCreated.snapshot?.campaign.State, 'OFF');
  assert.equal(secondCreated.snapshot?.campaign.State, 'OFF');
});
