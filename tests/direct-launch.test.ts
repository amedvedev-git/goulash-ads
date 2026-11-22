import assert from 'node:assert/strict';
import { renderDirectLaunch } from '../src/direct-launch-page.ts';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { initialPreparation } from '../src/campaign-plan.ts';
import { createDirectApi, parseDirectJson } from '../src/direct-api.ts';
import { createDirectService } from '../src/direct.ts';
import { parseDirectLaunchApproval } from '../src/direct-launch.ts';
import type { DirectLaunchAction, DirectLaunchApproval, DirectLaunchReadiness } from '../src/direct-launch.ts';
import { createPreparationService } from '../src/preparation.ts';
import { policyHash } from '../src/phrase-policy.ts';
import { e2Fixture } from './fixtures/e2.ts';
import { createApp } from '../src/server.ts';
import { createYandexAuth } from '../src/yandex-auth.ts';

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'goulash-direct-launch-'));
  const writes: { method: string; target: string }[] = [];
  let unknown = '', hideEffect = false, vat = '22', onAdsRead: (() => void) | undefined;
  const x = e2Fixture(directory, { transport: async (address, init) => {
    const url = new URL(String(address));
    if (url.hostname !== 'api.direct.yandex.com') return x.provider(address, init);
    const body = parseDirectJson(String(init?.body));
    if (body.method === 'get' && url.pathname.endsWith('/clients') && body.params.FieldNames.includes('VatRate')) {
      const base = await x.provider(address, init), response = await base.json();
      response.result.Clients[0].VatRate = vat;
      return Response.json(response);
    }
    if (body.method === 'get' && url.pathname.endsWith('/ads')) onAdsRead?.();
    if (!['moderate', 'suspend', 'resume'].includes(body.method)) return x.provider(address, init);
    const pid = x.db.readCampaignDirectRuns(x.owner, workspace)[0];
    const target = body.params.SelectionCriteria.Ids[0];
    assert.equal(pid.launch?.budget?.reservedKop, 854000, 'reserve committed before transport');
    assert.ok(x.db.directDispatches(x.owner, pid.planId).some(dispatch => dispatch.method === body.method), 'dispatch durable before fetch');
    assert.match(String(init?.body), new RegExp('"Ids":\\[' + target + '\\]'), 'Int64 encoded as exact JSON number');
    const [campaign] = x.a.records.campaigns, [ad] = x.a.records.ads;
    const resultName = { moderate: 'ModerateResults', suspend: 'SuspendResults', resume: 'ResumeResults' }[body.method as string]!;
    writes.push({ method: body.method, target });
    if (unknown === body.method && hideEffect) { unknown = ''; throw new Error('Fixture response lost before observed effect'); }
    if (body.method === 'moderate') {
      assert.equal(url.pathname, '/json/v501/ads');
      assert.equal(target, ad.Id);
      campaign.Status = 'MODERATION'; ad.Status = 'MODERATION';
    } else {
      assert.equal(url.pathname, '/json/v501/campaigns');
      assert.equal(target, campaign.Id);
      campaign.State = body.method === 'suspend' ? 'SUSPENDED' : 'ON';
      ad.State = body.method === 'suspend' ? 'OFF' : 'ON';
    }
    if (unknown === body.method) { unknown = ''; throw new Error('Fixture lost response'); }
    return Response.json({ result: { [resultName]: [{ Id: target }] } });
  } });
  t.after(() => { x.db.close(); rmSync(directory, { recursive: true, force: true }); });
  const { db, owner } = x, workspace = db.createCampaignWorkspace(owner).id;
  db.savePreparation(owner, { ...initialPreparation(), guided: true }, 0, undefined, 0, workspace);
  const prep = createPreparationService(db), saved = () => db.readPreparation(owner, workspace)!;
  const submit = async (action: string, extra: Record<string, string>) => {
    const result = await prep.action(owner, action, new URLSearchParams({ ad: workspace, policyHash,
      preparationRevision: String(saved().revision), ...extra }), 'Учебный владелец', workspace);
    assert.equal(result.status, 200, result.message);
  };
  await submit('confirm-profile', { campaignName: 'Проверка запуска', description: 'Доставка роллов в Екатеринбурге.',
    region: 'Екатеринбург', url: 'https://example.com/ekb/', goal: 'Принятый заказ', editorVersion: '3',
    profileEditor: 'yes', offer0: 'Роллы и сеты', kind0: 'product' });
  await submit('offer', { title: 'Роллы и сеты', adText: 'Роллы и сеты с доставкой по Екатеринбургу.',
    budget: '7000', period: '7', selectionEditor: 'yes', phrases: 'доставка роллов', manualReview: 'yes' });
  await submit('confirm', { confirmPlan: 'yes' });
  await x.connect();
  const connection = x.manager.resolve(owner)!;
  await x.service().action(owner, 'guided-create', new URLSearchParams({
    campaignId: workspace, campaignPlanId: saved().value.confirmedPlanId!, preparationRevision: String(saved().revision),
    account: connection.account, generation: String(connection.generation), confirm: 'yes',
  }), 'Учебный владелец');
  const [campaign] = x.a.records.campaigns, [ad] = x.a.records.ads;
  campaign.UnifiedCampaign.PackageBiddingStrategy = null;
  const run = () => db.readCampaignDirectRuns(owner, workspace)[0];
  const readiness: DirectLaunchReadiness = {
    advertiser: { name: 'Проверочный рекламодатель', checkedAt: new Date().toISOString(), generation: connection.generation! },
    measurement: { counterId: '1111', goalId: '2222', landing: run().draft.url, configId: 'fixture-counter', generation: 3, verifiedAt: Date.now() },
  };
  const approval: DirectLaunchApproval = {
    owner, workspace, run: run().planId, plan: run().campaignPlanId!, account: connection.account, generation: connection.generation!,
    campaign: run().steps.campaign.id!, ad: run().steps.ad.id!, startDate: run().budget!.startDate, endDate: run().budget!.endDate,
    spendLimitMicros: run().budget!.spendLimitMicros, vatBasisPoints: 2200, capKop: 854000, readiness,
  };
  const service = (a = approval, ready: () => DirectLaunchReadiness | undefined = () => readiness) =>
    createDirectService(db, connection, undefined, undefined, { approval: a, readiness: ready });
  const form = (extra: Record<string, string> = {}) => new URLSearchParams({ run: run().planId, revision: String(run().storageRevision),
    generation: String(connection.generation), confirm: 'yes', ...extra });
  const act = (s: ReturnType<typeof createDirectService>, action: DirectLaunchAction, extra?: Record<string, string>) =>
    s.lifecycleAction(owner, workspace, action, form(extra), 'Учебный владелец');
  return { db, manager: x.manager, connection, owner, workspace, readiness, approval, service, form, act, run, campaign, ad, writes,
    missingResponse: (command: string, withoutObservedEffect = false) => { unknown = command; hideEffect = withoutObservedEffect; }, changeVat: (value: string) => { vat = value; },
    watchAds: (read?: () => void) => { onAdsRead = read; } };
}

test('допуск с сохранёнными сведениями и событием проходит обычную форму кампании', async t => {
  const x = await fixture(t);
  const { advertiser, measurement } = x.readiness, original = x.db.readAnalyticsSettings(x.owner);
  x.db.saveAnalyticsSettings(x.owner, { ...original, metrikaEnabled: true, metrikaConfigId: measurement.configId,
    advertisers: { [x.approval.account]: { ...advertiser, account: x.approval.account } }, campaignAnalytics: { [x.workspace]: { revision: 1,
      measurement: { counter: { id: measurement.counterId, domain: 'example.com', mirrors: [], goals: [
        { id: measurement.goalId, name: 'Принятый заказ', type: 'action', condition: '' },
      ] }, goalId: measurement.goalId, configId: measurement.configId, generation: measurement.generation, landing: measurement.landing,
      test: { marker: 'abc', startedAt: measurement.verifiedAt, verifiedAt: measurement.verifiedAt } } } },
  }, original.revision);
  const auth = createYandexAuth(x.db, 'fixture-cabinet-launch', 'fixture');
  const token = randomBytes(32).toString('base64url');
  x.db.createSession(createHash('sha256').update(`fixture-cabinet-launch:${token}`).digest('hex'), x.owner, 'Проверочный владелец', Date.now() + 60_000);
  const unexpected = async () => { throw new Error('Unexpected new Metrika call'); };
  const server = createApp(x.db, auth, undefined, undefined, undefined, undefined, undefined, undefined, {}, x.manager,
    { owner: x.owner, mode: 'fixture', configId: measurement.configId, api: { counter: unexpected, report: unexpected, daily: unexpected } },
    undefined, undefined, undefined, undefined, x.approval);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`, cookie = `goulash_session=${token}`;
  const summary = await fetch(`${origin}/prepare?ad=${x.workspace}`, { headers: { Cookie: cookie } });
  assert.match(await summary.text(), /Отправить объявление на модерацию/);
  const reply = await fetch(`${origin}/campaign/lifecycle?ad=${x.workspace}`, { method: 'POST', redirect: 'manual',
    headers: { Origin: origin, Cookie: cookie }, body: x.form({ action: 'moderate' }) });
  assert.equal(reply.status, 303);
  assert.deepEqual(x.writes.map(write => write.method), ['moderate']);
});

test('платные методы недоступны без допуска, точной кампании, проверенных денег и подтверждения', async t => {
  const x = await fixture(t);
  assert.equal(parseDirectLaunchApproval('{"owner":"local"}'), undefined);
  assert.deepEqual(parseDirectLaunchApproval(JSON.stringify(x.approval)), x.approval);
  const disabled = createDirectService(x.db, x.connection);
  assert.equal(disabled.lifecycleView(x.owner, x.workspace), undefined);
  await assert.rejects(x.act(disabled, 'moderate'), /Допуск/);
  await assert.rejects(x.act(x.service({ ...x.approval, ad: '42' }), 'moderate'), /Допуск/);
  await assert.rejects(x.act(x.service({ ...x.approval, capKop: 853999 }), 'moderate'), /НДС превышает/);
  await assert.rejects(x.act(x.service(), 'moderate', { confirm: '' }), /Подтвердите/);
  await assert.rejects(x.act(x.service(), 'moderate', { generation: '0' }), /Допуск/);
  x.changeVat('20');
  await assert.rejects(x.act(x.service(), 'moderate'), /НДС Директа/);
  x.changeVat('22');
  x.campaign.UnifiedCampaign.PackageBiddingStrategy = { StrategyId: '1' };
  await assert.rejects(x.act(x.service(), 'moderate'), /изменились|стратегия/);
  x.campaign.UnifiedCampaign.PackageBiddingStrategy = null;
  x.campaign.Statistics.Impressions = '22';
  await assert.rejects(x.act(x.service(), 'moderate'), /состояние команды/);
  x.campaign.Statistics.Impressions = '0';
  assert.equal(x.writes.length, 0);
  assert.equal(x.run().launch?.budget, undefined);

  let readiness: DirectLaunchReadiness | undefined = x.readiness;
  x.watchAds(() => { readiness = undefined; });
  const readinessService = x.service(x.approval, () => readiness);
  await assert.rejects(x.act(readinessService, 'moderate'), /Проверки рекламодателя или цели/);
  const needsRepair = readinessService.lifecycleView(x.owner, x.workspace)!;
  assert.equal(needsRepair.canModerate, false);
  assert.match(renderDirectLaunch(x.workspace, needsRepair), /data-recovery[^>]+from=summary[^>]*>Проверить цель и данные рекламодателя/);
  assert.equal(x.writes.length, 0);
  assert.equal(x.run().launch?.budget, undefined);
  assert.equal(x.run().launch?.history.at(-1)?.outcome, 'not_sent');
  assert.ok(!x.db.directDispatches(x.owner, x.run().planId).some(dispatch => dispatch.method === 'moderate'));
  const raw = createDirectApi(async () => 'fixture', async () => assert.fail('transport should be unreachable'));
  await assert.rejects(raw.write('ads', 'moderate', { SelectionCriteria: { Ids: [7n] } }), /сохранённого намерения/);
});

test('модерация, возобновление и защитная пауза сверяются чтением и сохраняют резерв после потери доступа к платному действию', async t => {
  const x = await fixture(t), service = x.service();
  assert.equal(service.lifecycleView(x.owner, x.workspace)?.canModerate, true);
  x.missingResponse('moderate');
  await assert.rejects(x.act(service, 'moderate'), /сверить/i);
  assert.equal(x.run().launch?.pending?.action, 'moderate');
  assert.equal(x.run().launch?.budget?.reservedKop, 854000);
  await assert.rejects(x.act(service, 'moderate'), /Сначала сверьте/);
  await x.act(service, 'refresh');
  assert.equal(x.run().launch?.pending, undefined);
  assert.equal(x.run().launch?.history.at(-1)?.outcome, 'confirmed');
  assert.equal(x.run().launch?.observation?.adStatus, 'MODERATION');
  x.campaign.Status = 'ACCEPTED'; x.campaign.State = 'ON'; x.ad.Status = 'ACCEPTED'; x.ad.State = 'ON';
  await x.act(service, 'refresh');
  const noApproval = createDirectService(x.db, x.connection);
  assert.equal(noApproval.lifecycleView(x.owner, x.workspace)?.canPause, true);
  assert.equal(noApproval.lifecycleView(x.owner, x.workspace)?.canResume, false);
  await x.act(noApproval, 'pause');
  assert.equal(x.run().launch?.observation?.campaignState, 'SUSPENDED');
  assert.equal(x.run().launch?.history.at(-1)?.outcome, 'confirmed');
  await assert.rejects(x.act(noApproval, 'resume'), /Нет точного допуска/);
  await x.act(service, 'refresh');
  assert.equal(service.lifecycleView(x.owner, x.workspace)?.canResume, true);
  await x.act(service, 'resume');
  assert.equal(x.run().launch?.observation?.campaignState, 'ON');
  assert.equal(x.run().launch?.budget?.reservedKop, 854000);
  assert.deepEqual(x.writes.map(row => row.method), ['moderate', 'suspend', 'resume']);
});

test('защитная пауза работает при неизвестной модерации и недоступном объявлении, сохраняя прежнее намерение', async t => {
  const x = await fixture(t);
  x.missingResponse('moderate', true);
  await assert.rejects(x.act(x.service(), 'moderate'), /сверить/i);
  assert.equal(x.run().launch?.pending?.action, 'moderate');
  const disabled = createDirectService(x.db, x.connection);
  x.watchAds(() => { throw new Error('Учебное объявление недоступно для чтения'); });
  await x.act(disabled, 'pause');
  assert.equal(x.run().launch?.observation?.campaignState, 'SUSPENDED');
  assert.equal(x.run().launch?.history.at(-1)?.outcome, 'confirmed');
  assert.equal(x.run().launch?.pending?.action, 'moderate', 'pause does not erase an unknown operation');
  assert.equal(disabled.lifecycleView(x.owner, x.workspace)?.canPause, false, 'do not repeat a confirmed pause while still suspended');
  await assert.rejects(x.act(disabled, 'pause'), /не требуется/);
  x.watchAds();
  x.ad.Status = 'PREACCEPTED';
  await x.act(disabled, 'refresh');
  assert.equal(x.run().launch?.pending, undefined);
  assert.equal(x.run().launch?.history[0].outcome, 'confirmed');
  assert.equal(x.run().launch?.budget?.reservedKop, 854000);
  assert.deepEqual(x.writes.map(row => row.method), ['moderate', 'suspend']);
});
