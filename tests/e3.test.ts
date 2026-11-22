import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,readdirSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/database.ts';
import { hash } from '../src/campaign-plan.ts';
import { makePlanDemo,decide,budgetError } from '../src/demo.ts';
import { parseDirectReport } from '../src/direct-reports.ts';
import { createDirectApi } from '../src/direct-api.ts';
import { parseMetrikaReport,metrikaParams,createMetrikaApi } from '../src/metrika-api.ts';
import { sameSite } from '../src/analytics.ts';
import { e3Fixture,metrikaResponse } from './fixtures/e3.ts';
import { confirmedPlan } from './fixtures/confirmed-plan.ts';
import { e2Draft } from './fixtures/e2.ts';
import { removeE3Schema } from './fixtures/e3-control.ts';
import { renderDemoSection } from '../src/demo-section.ts';

const dispose=(directory:string)=>{for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);};
async function fixture(t:test.TestContext){const directory=mkdtempSync(join(tmpdir(),'goulash-e3-')),x=await e3Fixture(directory);t.after(()=>{x.db.close();dispose(directory);});return{...x,directory};}
async function choose(x:Awaited<ReturnType<typeof fixture>>){let s=x.db.readAnalyticsSettings(x.owner);await x.analytics.counter(x.owner,'11001001',s.revision);s=x.db.readAnalyticsSettings(x.owner);x.analytics.save(x.owner,new URLSearchParams({revision:String(s.revision),directRunId:x.db.readDirect(x.owner)!.planId,goalId:'21001001',dateFrom:s.dateFrom,dateTo:s.dateTo}));}
test('E3 Reports: TSV exact IDs/micros, empty and pending; malformed response is never a zero',async()=>{
  const q={campaignId:'9100000000000000101',dateFrom:'2026-11-01',dateTo:'2026-11-07',reportName:'fixed'};
  const r=await parseDirectReport(new Response(`Cost\tClicks\tCampaignId\tImpressions\n900719925474099312345\t2\t${q.campaignId}\t3\n`),q);
  assert.equal(r.rows![0].costMicros,'900719925474099312345');assert.equal(r.rows![0].campaignId,q.campaignId);
  assert.equal((await parseDirectReport(new Response('CampaignId\tImpressions\tClicks\tCost\n'),q)).status,'empty');
  for(const status of [201,202]){const r=await parseDirectReport(new Response('',{status,headers:{retryIn:'17'}}),q);assert.equal(r.status,'pending');assert.equal(r.retryIn,17);}
  for(const text of ['<html>no report</html>','CampaignId\tImpressions\tClicks\tCost\n1\t0\t0\t0','CampaignId\tImpressions\tClicks\tCost\n'+q.campaignId+'\t3\t2\t0.1','CampaignId\tClicks\tClicks\tCost'])await assert.rejects(parseDirectReport(new Response(text),q));
  for(const status of [400,401,403,429,500,502])await assert.rejects(parseDirectReport(new Response('',{status}),q));
});
test('E3 Metrika: exact goal/query, null and zero, sampling, seconds of lag, mismatched campaign',()=>{
  const now=Date.parse('2026-11-09T12:00:00Z'),q={counterId:'11001001',goalId:'21001001',dateFrom:'2026-11-02',dateTo:'2026-11-08'},p=metrikaParams(q);
  assert.equal(parseMetrikaReport(metrikaResponse(p),q,now).metrics.reaches,20);
  const zero=parseMetrikaReport(metrikaResponse(p,{data:[{metrics:[0,0,0]}],totals:[0,0,0]}),q,now);assert.equal(zero.metrics.reaches,0);assert.equal(zero.complete,true);
  const absent=parseMetrikaReport(metrikaResponse(p,{data:[{metrics:[10,null,null]}],totals:[10,null,null]}),q,now);assert.equal(absent.metrics.reaches,null);assert.equal(absent.complete,false);
  assert.equal(parseMetrikaReport(metrikaResponse(p,{sampled:true,sample_share:0.5}),q,now).complete,false);
  assert.equal(parseMetrikaReport(metrikaResponse(p,{data_lag:3600}),q,now).complete,true,'one hour lag still covers yesterday');
  assert.equal(parseMetrikaReport(metrikaResponse(p,{data_lag:86400}),q,now).complete,false,'lag is seconds, not milliseconds');
  assert.throws(()=>parseMetrikaReport(metrikaResponse(p,{query:{metrics:['wrong']}}),q,now));
  const segmented=metrikaResponse(p);segmented.query={...segmented.query,filters:"ym:s:trafficSource=='organic'"};assert.throws(()=>parseMetrikaReport(segmented,q,now));
  const ad={...q,campaignId:'42',login:'owner-a'};assert.throws(()=>parseMetrikaReport(metrikaResponse(metrikaParams(ad),{data:[{dimensions:[{id:'43'}],metrics:[1,1,1,1]}]}),ad,now));
  assert.equal(sameSite('https://eda1.ru', {id:'1',domain:'rollstar.ru',mirrors:[],goals:[]}),false);
});
test('E3 read receipts: pending survives reopen with identical request, errors retain success; owner and CPA scopes',async t=>{
  const x=await fixture(t);await choose(x);x.fault.directStatus=201;
  const pending=await x.analytics.refresh(x.owner,'direct_reports');assert.equal(pending.status,'pending');
  const body=x.calls.find(c=>c.source==='reports').body;assert.equal((await x.analytics.refresh(x.owner,'direct_reports')).id,pending.id);assert.equal(x.calls.filter(c=>c.source==='reports').length,1);
  const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));pending.retryAt=0;raw.prepare('UPDATE analytics_reports SET payload=? WHERE id=?').run(JSON.stringify(pending),pending.id);raw.close();
  const reopened=openDatabase(x.directory);reopened.close();x.fault.directStatus=200;
  const ready=await x.analytics.refresh(x.owner,'direct_reports');assert.equal(ready.id,pending.id);assert.equal(ready.status,'ready');assert.deepEqual(x.calls.filter(c=>c.source==='reports')[1].body,body);
  x.fault.directStatus=500;assert.equal((await x.analytics.refresh(x.owner,'direct_reports')).status,'error');assert.equal(x.db.readAnalyticsReports(x.owner).filter(r=>r.status==='ready').length,1);
  const site=await x.analytics.refresh(x.owner,'metrika_site'),ad=await x.analytics.refresh(x.owner,'metrika_direct');
  assert.equal(site.result.metrics.reaches,20);assert.equal(ad.result.metrics.reaches,6);assert.equal(ad.context.vat,'unknown');assert.equal(ad.context.businessMeaning,'not_agreed');
  assert.equal(site.result.metrics.cpa,null);assert.equal(ad.result.metrics.cpa,233.33);assert.equal(x.analytics.view('yandex:other').reports.length,0);
  await assert.rejects(x.analytics.refresh('yandex:other','metrika_site'));
  let settings=x.db.readAnalyticsSettings(x.owner);x.analytics.disconnect(x.owner,settings.revision);const count=x.calls.length;await assert.rejects(x.analytics.refresh(x.owner,'metrika_site'));assert.equal(x.calls.length,count);
});
test('R05: прежний отложенный отчёт опрашивается с исходным НДС, новый запрос использует базу лимита', async t => {
  const x = await fixture(t);
  await choose(x);
  x.fault.directStatus = 201;
  const pending = await x.analytics.refresh(x.owner, 'direct_reports');
  const context = { ...pending.context, timezone:'unknown', vat:'included' };
  const key = hash([pending.source, pending.settingsRevision, context, pending.connectionGeneration, pending.configId]);
  const raw = new DatabaseSync(join(x.directory,'stage2.sqlite'));
  try {
    raw.prepare('UPDATE analytics_reports SET request_key=?,payload=? WHERE id=?')
      .run(key, JSON.stringify({...pending, context, requestKey:key, retryAt:0}), pending.id);
  } finally { raw.close(); }
  x.fault.directStatus = 200;
  const resumed = await x.analytics.refresh(x.owner, 'direct_reports');
  assert.equal(resumed.id, pending.id);
  assert.equal(resumed.context.vat, 'included');
  assert.equal(x.calls.at(-1).body.params.IncludeVAT, 'YES');
  const fresh = await x.analytics.refresh(x.owner, 'direct_reports');
  assert.notEqual(fresh.id, resumed.id);
  assert.equal(fresh.context.vat, 'excluded');
  assert.equal(x.calls.at(-1).body.params.IncludeVAT, 'NO');
});
test('E3 disable barrier: no Metrika dispatch after secret wait; Direct gate blocks stale capability',async t=>{
  const x=await fixture(t);await choose(x);const stale=x.manager.resolve(x.owner)!;x.disconnect();const count=x.calls.length;
  await assert.rejects(stale.api.reportRead({campaignId:'42',dateFrom:'2026-11-01',dateTo:'2026-11-07',reportName:'blocked'}));assert.equal(x.calls.length,count);
  let release!:(value:string)=>void,allowed=true,network=0;const api=createMetrikaApi(()=>new Promise(resolve=>{release=resolve;}),async()=>{network++;return Response.json({});});
  const request=api.counter('11001001',()=>{if(!allowed)throw new Error('disabled');});allowed=false;release('fixture');await assert.rejects(request);assert.equal(network,0);
  let sendCount=0;const direct=createDirectApi(async()=> 'fictional',async()=>{sendCount++;return new Response('');});await assert.rejects(direct.call('reports','add',{}));assert.equal(sendCount,0);
});
test('E3 control: plan7000/30, exact rounding, persisted authority, replacement, disable, undo and no network',async t=>{
  const x=await fixture(t),planId=confirmedPlan(x.db,{...e2Draft,period:'30'},['ремонт'],x.owner),plan=x.db.readPlan(x.owner,planId)!;
  const state=makePlanDemo(plan,'control');assert.equal(budgetError(state),undefined);assert.equal(state.periodDays,30);assert.deepEqual(state.campaigns.map(c=>[c.spent,c.remaining]),[[210000,81666],[140000,198333]]);assert.equal(state.reserve,70001);
  const decision=decide(state);assert.equal(decision.status,'applied');assert.equal(decision.after.campaigns[1].remaining,279999);
  const beforeCalls=x.calls.length;
  x.db.loadDemo(x.owner,'control',0,'author',planId);assert.equal(x.db.processDemoJob(),false,'no authority implies no automatic job');
  const controlHtml=renderDemoSection(x.db.operationsView(x.owner));assert.match(controlHtml,/Ремонт холодильников/);assert.match(controlHtml,/30 завершённых полных дней/);
  x.db.setDemoPermission(x.owner,true,0,'author');assert.equal(x.db.processDemoJob(),true,'worker enqueues and applies without manual enqueue');
  const first=x.db.operationsView(x.owner).result!;assert.equal(first.kind,'automation_applied');x.db.setDemoPermission(x.owner,false,1,'author');assert.equal(x.db.undo(x.owner,first.id,'author'),'ok');assert.equal(x.db.processDemoJob(),false);assert.equal(x.db.readDemo(x.owner)!.state.campaigns.reduce((s,c)=>s+c.spent,0),350000);
  x.db.loadDemo(x.owner,'noRecipient',x.db.readDemo(x.owner)!.revision,'author',planId);x.db.setDemoPermission(x.owner,true,2,'author');x.db.enqueueDemo(x.owner,x.db.readDemo(x.owner)!.datasetId,'author');x.db.setDemoPermission(x.owner,false,3,'author');x.db.processDemoJob();assert.equal(x.db.operationsView(x.owner).result!.kind,'automation_skipped');
  x.db.setDemoPermission(x.owner,true,4,'author');x.db.loadDemo(x.owner,'noRecipient',x.db.readDemo(x.owner)!.revision,'author',planId);x.db.processDemoJob();assert.equal(x.db.readDemo(x.owner)!.state.reserve,151667);
  x.db.loadDemo(x.owner,'control',x.db.readDemo(x.owner)!.revision,'author',planId);
  const corrupt=new DatabaseSync(join(x.directory,'stage2.sqlite'));corrupt.prepare("UPDATE demo_states SET payload=json_set(payload,'$.planRef.snapshotHash','changed') WHERE owner=?").run(x.owner);corrupt.close();
  assert.equal(x.db.processDemoJob(),true);assert.equal(x.db.operationsView(x.owner).result!.kind,'automation_skipped','invalid context gets a terminal audit result, not endless polling');
  const alternate=confirmedPlan(x.db,{...e2Draft,budget:'8000'},['ремонт'],x.owner);x.db.loadDemo(x.owner,'control',x.db.readDemo(x.owner)!.revision,'author',alternate);assert.equal(x.db.readDemoPermission(x.owner)!.enabled,false);assert.equal(x.db.processDemoJob(),false);
  assert.equal(x.calls.length,beforeCalls,'entire control/undo has zero external transport calls');
  for(const budget of ['1','6000','10000000']){const p={...plan,draft:{...plan.draft,budget}};const demo=makePlanDemo(p,'control');assert.equal(budgetError(demo),undefined);assert.equal(budgetError(decide(demo).after),undefined);}
});
test('E3 migration v9 preserves exact E1/E2 data and history; legacy pending is skipped, not executed',async t=>{
  const x=await fixture(t),run=x.db.readDirect(x.owner)!,plans=x.db.readPlans(x.owner);x.db.loadDemo(x.owner,'control',0,'legacy');
  const state=x.db.readDemo(x.owner)!;const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));removeE3Schema(raw);raw.prepare("INSERT INTO demo_jobs VALUES('legacy-job',?,'test',?,'legacy','pending',NULL)").run(x.owner,state.datasetId);raw.exec('PRAGMA user_version=9');raw.close();
  const upgraded=openDatabase(x.directory);try{assert.deepEqual(upgraded.readDirect(x.owner),run);assert.deepEqual(upgraded.readPlans(x.owner),plans);assert.equal(upgraded.readDemoPermission(x.owner),undefined);assert.equal(upgraded.processDemoJob(),true);assert.equal(upgraded.operationsView(x.owner).result!.kind,'automation_skipped');assert.deepEqual(upgraded.readDemo(x.owner),state);
  const inspect=new DatabaseSync(join(x.directory,'stage2.sqlite'));assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version,11);assert.equal(inspect.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');inspect.close();}finally{upgraded.close();}
});
