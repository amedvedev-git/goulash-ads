import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { e4Browser } from './fixtures/e4-browser.ts';
import { policyHash } from '../src/phrase-policy.ts';

async function emptyFixture(t:test.TestContext, waitFor?: Parameters<typeof e4Browser>[1]){
  const directory=mkdtempSync(join(tmpdir(),'e4-example-')),x=e4Browser(directory,waitFor);x.server.listen(0,'127.0.0.1');await once(x.server,'listening');
  t.after(async()=>{await new Promise<void>(r=>x.server.close(()=>r()));x.db.close();rmSync(directory,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${(x.server.address() as any).port}`;
  let cookie=(await fetch(origin+'/fixture-login/a',{redirect:'manual'})).headers.get('set-cookie')!.split(';')[0];
  const get=(path:string)=>fetch(origin+path,{headers:{Cookie:cookie},redirect:'manual',signal:t.signal});
  const post=(path:string,values:URLSearchParams|Record<string,string>={})=>fetch(origin+path,{method:'POST',headers:{Cookie:cookie,Origin:origin},body:values instanceof URLSearchParams?values:new URLSearchParams(values),redirect:'manual',signal:t.signal});
  const act=(action:string,values:Record<string,string>={})=>post('/preparation/'+action,{policyHash,preparationRevision:String(x.db.readPreparation(x.owner)?.revision??0),...values});
  return {...x,origin,get,post,act,addCookie:(value:string)=>{cookie+='; '+value.split(';')[0];}};
}

test('E4-U01: empty HTTP fixture uses the UI example through coherent profile/research/plan and downstream Direct/analytics/control',{timeout:30000},async t=>{
  const stages = {wordstat:Promise.withResolvers<void>(), deepseek:Promise.withResolvers<void>()};
  const release = {wordstat:Promise.withResolvers<void>(), deepseek:Promise.withResolvers<void>()};
  let timeoutJudge = false;
  const x=await emptyFixture(t,async stage=>{
    stages[stage].resolve();await release[stage].promise;
    if (timeoutJudge && stage === 'deepseek') throw new DOMException('fixture timeout','TimeoutError');
  });
  assert.equal(x.db.readPlans(x.owner).length,0);assert.equal(x.db.readDirectRuns(x.owner).length,0);
  assert.equal((await x.act('example')).status,303); // The driver imports no hidden business input.
  const input=x.db.readPreparation(x.owner)!.value.input;assert.match(input.description,/кафе.*суши и роллы/);assert.equal(input.budget,'7000');
  assert.equal((await x.act('entry')).status,303);assert.equal((await x.act('profile',{aiConsent:'yes'})).status,303);
  const profileRun=x.db.readRuns(x.owner).find(r=>r.kind==='profile')!,profile=profileRun.plan.strategy.profile!;assert.equal(profileRun.attempts[0].status,'succeeded');
  assert.equal(profile.offers.length,2);assert.deepEqual(profile.exclusions,[]);for(const offer of profile.offers)assert.ok(input.description.includes(offer.evidence));
  const fields:Record<string,string>={profileEditor:'yes',ownBrands:profile.ownBrands.join('\n'),uncertainty:profile.uncertainty.join('\n'),title:'Доставка суши и роллов',adText:'Меню и условия доставки указаны на сайте.'};
  profile.offers.forEach((o,i)=>Object.assign(fields,{['offer'+i]:i===0?o.name+' с доставкой':o.name,['offerId'+i]:o.id,['kind'+i]:o.kind,['evidence'+i]:o.evidence,['aliases'+i]:o.aliases.join('\n'),['seeds'+i]:o.seeds.join('\n'),...(o.delivery?{['delivery'+i]:'yes'}:{})}));
  assert.equal((await x.act('confirm-profile',fields)).status,303);
  // Connect through the same local forms documented for the fixture; do not follow external OAuth links.
  const start=await x.post('/connections/direct/start');assert.equal(start.status,303);x.addCookie(start.headers.get('set-cookie')!);
  let html=await(await x.get('/connections/direct')).text();const hidden=(name:string)=>html.match(new RegExp(`name="${name}" value="([^"]*)"`))![1];
  assert.equal((await x.post('/connections/direct/finish',{attemptId:hidden('attemptId'),nonce:hidden('nonce'),code:'a'})).status,303);
  html=await(await x.get('/connections/direct')).text();assert.equal((await x.post('/connections/direct/activate',{candidateId:hidden('candidateId'),confirm:'yes'})).status,303);
  const statusUrl='/preparation/research-status?revision='+x.db.readPreparation(x.owner)!.revision;
  assert.equal((await fetch(x.origin+statusUrl)).status,401);
  assert.equal((await (await x.get(statusUrl)).json()).phase,'region');
  const pending=x.act('research',{researchConsent:'yes',judgeConsent:'yes'});
  try {
    await stages.wordstat.promise;
    assert.deepEqual(await (await x.get(statusUrl)).json(),{phase:'wordstat',done:0,total:2});
    release.wordstat.resolve();
    await stages.deepseek.promise;
    assert.deepEqual(await (await x.get(statusUrl)).json(),{phase:'deepseek',done:2,total:2});
  } finally {release.wordstat.resolve();release.deepseek.resolve();}
  const result=await pending;assert.equal(result.status,303);assert.deepEqual(x.counts,{profile:1,wordstat:2,judge:1});
  assert.deepEqual(await (await x.get(statusUrl)).json(),{phase:'complete',done:2,total:2});
  assert.match(await (await x.get(result.headers.get('location')!)).text(),/Подбор завершён/);
  const research=x.db.readRuns(x.owner).find(r=>r.kind==='research')!,selected=research.plan.strategy.candidates.filter(c=>c.selected);assert.equal(selected.length,2);
  assert.deepEqual(new Set(selected.map(c=>c.offerId)),new Set(['sushi','rolls']));
  const response=research.attempts.find(a=>a.kind==='judge')!.result as any;
  for(const candidate of selected){const offerId=candidate.phrase.includes('ролл')?'rolls':'sushi',judgment=response.judgments.find((r:any)=>r.id===candidate.id);
    assert.equal(candidate.offerId,offerId);assert.equal(judgment.offerId,offerId);assert.deepEqual(judgment.support.factRefs,[offerId+':offer']);assert.match(candidate.reason,/Подставная/);
    assert.equal(candidate.source,'wordstat');assert.ok(candidate.evidence.length>0);}
  const choose=new URLSearchParams({policyHash,preparationRevision:String(x.db.readPreparation(x.owner)!.revision),manualReview:'yes'});for(const candidate of selected)choose.append('selected',candidate.phrase);
  assert.equal((await x.post('/preparation/offer',choose)).status,303);assert.equal((await x.act('confirm',{confirmPlan:'yes'})).status,303);
  const plan=x.db.readPlans(x.owner)[0];assert.deepEqual(new Set(plan.phrases),new Set(selected.map(c=>c.phrase)));assert.equal(plan.draft.budget,'7000');assert.equal(plan.draft.period,'7');
  assert.equal((await x.post('/direct/prepare',{campaignPlanId:plan.id,revision:String(plan.campaignRevision),storageRevision:'0',name:'Штатный пример E4',startDate:'2099-12-20'})).status,303);
  const run=x.db.readDirect(x.owner)!;assert.equal((await x.post('/direct/create',{planId:run.planId,storageRevision:String(run.storageRevision),confirm:'yes'})).status,303);assert.equal(x.db.readDirect(x.owner)!.complete,true);
  assert.equal((await x.post('/analytics/counter',{revision:'0',counterId:'11001001',confirm:'read'})).status,303);let settings=x.db.readAnalyticsSettings(x.owner);
  assert.equal((await x.post('/analytics/settings',{revision:String(settings.revision),dateFrom:settings.dateFrom,dateTo:settings.dateTo,goalId:'21001001',directRunId:run.planId})).status,303);
  for(const source of ['direct_reports','metrika_site','metrika_direct'])assert.equal((await x.post('/analytics/refresh',{source})).status,303);
  assert.equal(x.db.readAnalyticsReports(x.owner).filter(r=>r.status==='ready').length,3);
  assert.equal((await x.post('/demo/load',{scenario:'control',revision:'0',planId:plan.id})).status,303);const demo=x.db.readDemo(x.owner)!;
  assert.equal((await x.post('/demo/permission',{revision:'0',datasetId:demo.datasetId,enabled:'yes',confirm:'control'})).status,303);
  while(x.db.operationsView(x.owner).job?.status!=='completed'){await new Promise(r=>setTimeout(r,40));t.signal.throwIfAborted();}
  const operation=x.db.operationsView(x.owner).result!;assert.equal(operation.kind,'automation_applied');assert.equal(x.db.readDemo(x.owner)!.state.campaigns[1].remaining,279999);
  assert.equal((await x.post('/demo/permission',{revision:'1',datasetId:demo.datasetId,enabled:'no'})).status,303);assert.equal((await x.post('/operations/undo',{id:operation.id,confirm:'undo'})).status,303);
  assert.deepEqual(x.db.readDemo(x.owner)!.state,demo.state);assert.deepEqual(x.counts,{profile:1,wordstat:2,judge:1});
  const state=await(await x.get('/fixture-state')).json();assert.equal(state.liveCalls,0);assert.equal(state.paidCalls,0);assert.equal(state.permission.enabled,false);
  // New wording reuses the stored Wordstat results. A timed-out evaluation must return
  // a visible outcome and never pay for another attempt when the request is repeated.
  timeoutJudge = true;
  await x.act('back',{step:'3'});
  const fieldsForTimeout={title:'Суши с доставкой',researchConsent:'yes',judgeConsent:'yes'};
  const timeoutRevision=x.db.readPreparation(x.owner)!.revision;
  const timeoutResult=await x.act('research',fieldsForTimeout);
  assert.equal(timeoutResult.status,303);
  html=await (await x.get(timeoutResult.headers.get('location')!)).text();
  assert.match(html,/DeepSeek не ответил вовремя/);
  assert.equal((await (await x.get('/preparation/research-status?revision='+timeoutRevision)).json()).phase,'stopped');
  await x.act('research',fieldsForTimeout);
  assert.deepEqual(x.counts,{profile:1,wordstat:2,judge:2});
});

test('E4-U01: unsupported descriptions get an actionable fixture-only refusal, not refrigerator facts',async t=>{
  const x=await emptyFixture(t);await x.act('example');await x.act('entry',{description:'Произвольный вымышленный бизнес вне закрытого набора локальных ответов.'});
  const result=await x.act('profile',{aiConsent:'yes'});assert.equal(result.status,502);assert.match(await result.text(),/Заполнить вымышленным примером/);
  const run=x.db.readRuns(x.owner).find(r=>r.kind==='profile')!;assert.equal(run.attempts[0].notSent,true);assert.equal(run.attempts[0].status,'failed');assert.equal(run.plan.strategy.profile,undefined);
});

test('Моя реклама: независимые черновики, планы и объекты Директа в одном кабинете', { timeout: 30000 }, async t => {
  const x = await emptyFixture(t);
  assert.match(await (await x.get('/campaigns')).text(), /Создать кампанию/u);
  const create = async () => {
    const response = await x.post('/campaign/new');
    assert.equal(response.status, 303);
    const location = response.headers.get('location')!;
    return new URL(location, x.origin).searchParams.get('ad')!;
  };
  const a = await create(), b = await create();
  assert.ok(a && b && a !== b);
  const form = (ad: string, action: string, fields: Record<string, string> = {}) => x.post('/preparation/' + action, {
    ad, policyHash, preparationRevision: String(x.db.readPreparation(x.owner, ad)?.revision ?? 0),
    revision: String(x.db.readCampaign(x.owner, ad)?.revision ?? 0), ...fields,
  });
  const names = ['Доставка суши', 'Самовывоз роллов'];
  for (const [i, ad] of [a, b].entries()) {
    const offer = names[i], description = offer + ' доступны по предварительному заказу.';
    const progress = await form(ad, i === 0 ? 'entry' : 'save', {
      description, url: 'https://example.com/menu', goal: 'Оформить заказ', region: 'Екатеринбург', budget: i === 0 ? '7000' : '9000', period: '7',
    });
    assert.equal(progress.status, 303);
    assert.match(progress.headers.get('location')!, new RegExp('ad=' + ad));
    assert.equal(x.db.readPreparation(x.owner, ad)!.value.step, i === 0 ? 2 : 1);
  }
  assert.equal(x.db.readPreparation(x.owner, a)!.value.input.budget, '7000');
  assert.equal(x.db.readPreparation(x.owner, b)!.value.input.budget, '9000');
  assert.match(await (await x.get('/campaigns')).text(), /Доставка суши[\s\S]*Самовывоз роллов|Самовывоз роллов[\s\S]*Доставка суши/u);
  const foreign = await fetch(x.origin + '/fixture-login/b', { redirect: 'manual' });
  const cookie = foreign.headers.get('set-cookie')!.split(';')[0];
  const foreignGet = await fetch(x.origin + '/campaigns?ad=' + a, { headers: { Cookie: cookie } });
  assert.equal(foreignGet.status, 404);
  assert.doesNotMatch(await foreignGet.text(), /Доставка суши/u);
  const foreignPost = await fetch(x.origin + '/preparation/save', {
    method: 'POST', headers: { Cookie: cookie, Origin: x.origin }, body: new URLSearchParams({ ad: a, preparationRevision: '1' }),
  });
  assert.equal(foreignPost.status, 404);
  assert.equal((await form(b, 'entry')).status, 303);
  for (const [i, ad] of [a, b].entries()) {
    const offer = names[i];
    assert.equal((await form(ad, 'confirm-profile', { profileEditor: 'yes', offer0: offer, evidence0: offer, kind0: 'product' })).status, 303);
    assert.equal((await form(ad, 'offer', { selectionEditor: 'yes', phrases: offer, manualReview: 'yes' })).status, 303);
    assert.equal((await form(ad, 'confirm', { confirmPlan: 'yes' })).status, 303);
  }
  const start = await x.post('/connections/direct/start?ad=' + a);
  assert.equal(start.headers.get('location'), '/connections/direct?ad=' + a);
  x.addCookie(start.headers.get('set-cookie')!);
  const field = async (name: string) => (await (await x.get('/connections/direct')).text()).match(new RegExp(`name="${name}" value="([^"]*)"`))![1];
  assert.equal((await x.post('/connections/direct/finish', { attemptId: await field('attemptId'), nonce: await field('nonce'), code: 'a' })).status, 303);
  const activated = await x.post('/connections/direct/activate?ad=' + a, { candidateId: await field('candidateId'), confirm: 'yes' });
  assert.equal(activated.status, 303);
  assert.equal(activated.headers.get('location'), '/campaigns?ad=' + a);
  assert.match(await (await x.get('/campaigns?ad=' + a)).text(), /<h1>Кампания<\/h1><p class="lead">Доставка суши доступны по предварительному заказу/u);
  for (const [i, ad] of [a, b].entries()) {
    const planId = x.db.readPreparation(x.owner, ad)!.value.confirmedPlanId!;
    const plan = x.db.readPlan(x.owner, planId)!;
    assert.equal(plan.campaignId, ad);
    assert.equal(plan.draft.title, names[i]);
    const prepared = await x.post('/direct/prepare', { campaignPlanId: planId, revision: String(plan.campaignRevision), storageRevision: '0', name: names[i], startDate: '2099-12-20' });
    assert.equal(prepared.status, 303, prepared.status === 303 ? undefined : await prepared.text());
    assert.equal(prepared.headers.get('location'), '/campaigns?ad=' + ad + '#direct');
    const [run] = x.db.readCampaignDirectRuns(x.owner, ad);
    const created = await x.post('/direct/create', { planId: run.planId, storageRevision: String(run.storageRevision), confirm: 'yes' });
    assert.equal(created.status, 303, created.status === 303 ? undefined : await created.text());
    assert.equal(x.db.readDirect(x.owner, run.planId)!.complete, true);
  }
  const runs = x.db.readDirectRuns(x.owner);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[0].steps.campaign.id, runs[1].steps.campaign.id);
  const analytics = await (await x.get('/results')).text();
  for (const run of runs) assert.match(analytics, new RegExp(run.planId));
  const settings = x.db.readAnalyticsSettings(x.owner);
  const filters = { revision: String(settings.revision), dateFrom: settings.dateFrom, dateTo: settings.dateTo };
  assert.equal((await x.post('/analytics/settings', { ...filters, directRunId: runs[0].planId })).status, 303);
  const applied = x.db.readAnalyticsSettings(x.owner);
  const scoped = await (await x.get('/results?run=' + runs[1].planId)).text();
  assert.match(scoped, new RegExp(`value="${runs[1].planId}" selected`));
  assert.equal(x.db.readAnalyticsSettings(x.owner).directRunId, runs[0].planId);
  const refresh = { ...filters, source: 'direct_reports', revision: String(applied.revision), directRunId: runs[1].planId };
  assert.equal((await x.post('/analytics/refresh', refresh)).status, 303);
  const reports = x.db.readAnalyticsReports(x.owner);
  assert.equal(reports[0].context.campaignId, runs[1].steps.campaign.id);
  assert.equal((await x.post('/analytics/refresh', { ...refresh, directRunId: runs[0].planId })).status, 409);
  assert.equal(x.db.readAnalyticsReports(x.owner).length, reports.length);
  assert.equal((await fetch(x.origin + '/results?run=' + runs[1].planId, {headers: {Cookie:cookie}})).status, 404);

  assert.equal((await form(a, 'save', { budget: '12000', region: 'Москва' })).status, 303);
  const list = await (await x.get('/campaigns')).text();
  assert.match(list, /Екатеринбург[\s\S]*Действуют условия Директа: 7\s000\s₽ на 7 дней/u);
  assert.match(list, /Достижения цели[\s\S]*Стоимость достижения[\s\S]*Расход/u);
  assert.doesNotMatch(list, /Лимит в Goulash|Моя реклама/u);
  const overview = await (await x.get('/')).text();
  assert.match(overview, /Расход <b>/u);
  for (const run of runs) assert.ok(overview.replaceAll('&amp;', '&').includes(`/results?ad=${run.campaignId}&run=${run.planId}`));
  const [{ campaignId: first }, second] = runs;
  assert.equal((await x.get(`/results?ad=${first}&run=${second.planId}`)).status, 404);
  const state = await (await x.get('/fixture-state')).json();
  assert.equal(state.liveCalls, 0);
  assert.equal(state.paidCalls, 0);
});
