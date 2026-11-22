import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync,readdirSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { e3Fixture,metrikaResponse } from './fixtures/e3.ts';
import { createAnalyticsService } from '../src/analytics.ts';
import { createMetrikaApi,metrikaConfigId } from '../src/metrika-api.ts';
import { parseDirectReport } from '../src/direct-reports.ts';
import { renderAnalytics } from '../src/analytics-page.ts';
import { renderOverview } from '../src/overview-page.ts';
import { campaignCatalogItems } from '../src/campaign-catalog-data.ts';
import { createDirectApi } from '../src/direct-api.ts';
async function fixture(t:test.TestContext){
  const directory=mkdtempSync(join(tmpdir(),'goulash-e3-recovery-')),x=await e3Fixture(directory);
  t.after(()=>{x.db.close();for(const name of readdirSync(directory))unlinkSync(join(directory,name));rmdirSync(directory);});
  await x.analytics.counter(x.owner,'11001001',0);const s=x.db.readAnalyticsSettings(x.owner);
  x.analytics.save(x.owner,new URLSearchParams({revision:String(s.revision),directRunId:x.db.readDirect(x.owner)!.planId,goalId:'21001001',dateFrom:s.dateFrom,dateTo:s.dateTo}));
  return{...x,directory};
}
async function worker(t:test.TestContext,directory:string,mode:string,source:string,configId:string){
  const child=fork(new URL('./fixtures/e3-read-worker.ts',import.meta.url),[directory,mode,source,configId],{stdio:['ignore','ignore','inherit','ipc']});t.after(()=>{if(child.exitCode===null)child.kill();});
  const exited=once(child,'exit');assert.equal((await once(child,'message'))[0],'ready');return{child,exited,go:async()=>{const result=once(child,'message');child.send('go');return(await result)[0] as any;}};
}
test('обзор следует активному черновику, аналитика хранит выбранный набор и прежние отчёты', async t => {
  const x = await fixture(t);
  const connection = { ...x.manager.resolve(x.owner)!, mode: 'live' as const };
  const provider = { ...x.metrika, mode: 'live' as const };
  const service = createAnalyticsService(x.db, () => connection, provider);
  for (const source of ['direct_reports', 'metrika_site', 'metrika_direct'] as const) assert.equal((await service.refresh(x.owner, source)).status, 'ready');

  const overview = (analytics: ReturnType<typeof service.view>) => renderOverview(
    campaignCatalogItems(x.db, x.owner), analytics,
    { enabled: true, ownChief: true, mode: connection.mode, account: connection.account });
  const calls = x.calls.length;
  const current = service.view(x.owner);
  assert.equal(current.currentReports.length, 3);
  assert.match(overview(current), /233,33\s₽ за достижение/);
  assert.match(overview(current), /hero-number">6</);
  assert.match(overview(current), /Директ · /);

  const rotated = createAnalyticsService(x.db, () => connection, { ...provider, configId: 'rotated-test-config' }).view(x.owner);
  assert.deepEqual(rotated.currentReports.map(report => report.source), ['direct_reports']);
  assert.equal(rotated.reports.length, 3);
  assert.doesNotMatch(overview(rotated), /233,33/);
  const archived = renderAnalytics(rotated);
  assert.match(archived, /Настройки доступа изменились/);
  assert.match(archived, /Предыдущие отчёты · 2[\s\S]*233,33/);

  const reconnected = createAnalyticsService(x.db, () => ({ ...connection, generation: connection.generation! + 1 }), provider).view(x.owner);
  assert.deepEqual(reconnected.currentReports.map(report => report.source), ['metrika_site']);
  assert.doesNotMatch(overview(reconnected), /233,33|<dt>Расход по Директу<\/dt>/);
  assert.equal(x.calls.length, calls, 'просмотр страниц использует сохранённые данные');

  await x.action('prepare', { name: 'Другой черновик того же плана', startDate: '2099-12-20', newRun: 'yes' });
  const after = service.view(x.owner);
  assert.notEqual(x.db.readDirect(x.owner)!.planId, after.settings.directRunId);
  assert.equal(after.currentReports.length, 3, 'аналитика продолжает показывать выбранный пользователем набор');
  assert.match(overview(after), /Черновик/);
  assert.match(overview(after), /Проверьте условия и создайте черновик в Директе/);
  assert.match(overview(after), /233,33/, 'сохранённые результаты действующей записи Директа остаются видимы');
  assert.doesNotMatch(overview(after), /По последней сверке показы выключены/);
});
test('TR01-01: a hidden Direct request survives disabling Metrika and stays isolated by owner',async t=>{
  for(const action of ['save','disable']){
    const x=await fixture(t);x.fault.directStatus=201;const pending=await x.analytics.refresh(x.owner,'direct_reports');
    x.db.beginAnalyticsReport('another-owner',{...pending,id:'foreign-pending'});
    for(let i=0;i<31;i++)await x.analytics.refresh(x.owner,'metrika_site');
    assert.equal(x.db.readAnalyticsReports(x.owner).some(r=>r.id===pending.id),false);
    const s=x.db.readAnalyticsSettings(x.owner);
    if(action==='save')x.analytics.save(x.owner,new URLSearchParams({revision:String(s.revision),directRunId:s.directRunId!,goalId:s.goalId!,dateFrom:s.dateFrom,dateTo:s.dateTo}));else x.analytics.disconnect(x.owner,s.revision);
    const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));
    try {
      const row=raw.prepare('SELECT status,payload FROM analytics_reports WHERE id=?').get(pending.id)!;
      const status=action==='save'?'superseded':'pending';
      assert.equal(row.status,status);
      assert.equal(JSON.parse(String(row.payload)).status,status);
      assert.equal(raw.prepare('SELECT status FROM analytics_reports WHERE id=?').get('foreign-pending')!.status,'pending');
      raw.prepare("UPDATE analytics_reports SET payload=json_set(payload,'$.retryAt',0) WHERE id=?").run(pending.id);
    } finally { raw.close(); }
    x.fault.directStatus=200;
    const ready=await x.analytics.refresh(x.owner,'direct_reports');
    assert.equal(ready.status,'ready');
    if(action==='disable') {
      assert.equal(ready.id,pending.id);
      const reads=x.calls.filter(call=>call.source==='reports');
      assert.deepEqual(reads[1].body,reads[0].body);
    } else assert.notEqual(ready.id,pending.id);
  }
});
test('TR01-02: Direct pending ignores unrelated Metrika config changes; identical body/id resumes',async t=>{
  const x=await fixture(t);x.fault.directStatus=201;const pending=await x.analytics.refresh(x.owner,'direct_reports'),first=x.calls.find(c=>c.source==='reports').body;
  const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));pending.retryAt=0;raw.prepare('UPDATE analytics_reports SET payload=? WHERE id=?').run(JSON.stringify(pending),pending.id);raw.close();
  x.fault.directStatus=200;const restarted=createAnalyticsService(x.db,o=>x.manager.resolve(o),{...x.metrika,configId:'rotated-unrelated-provider'}),result=await restarted.refresh(x.owner,'direct_reports');
  assert.equal(result.id,pending.id);assert.equal(result.status,'ready');assert.deepEqual(x.calls.filter(c=>c.source==='reports')[1].body,first);
});
test('TR01-02: interrupted Metrika GET resumes after real process exit; rotated credential/owner is rejected',async t=>{
  const stable=metrikaConfigId('yandex:101','1');assert.equal(metrikaConfigId('yandex:101','1'),stable);assert.notEqual(metrikaConfigId('yandex:101','2'),stable);assert.notEqual(metrikaConfigId('yandex:202','1'),stable);assert.notEqual(metrikaConfigId('yandex:101','1','systemd'),stable);assert.throws(()=>metrikaConfigId('yandex:101','bad config'));
  const x=await fixture(t),child=await worker(t,x.directory,'crash','metrika_site',x.metrika.configId);assert.equal(await child.go(),'dispatched');await child.exited;
  const pending=x.db.readAnalyticsReports(x.owner)[0];assert.equal(pending.interrupted,true);
  const restarted=createAnalyticsService(x.db,o=>x.manager.resolve(o),x.metrika),result=await restarted.refresh(x.owner,'metrika_site');assert.equal(result.id,pending.id);assert.equal(result.status,'ready');
  await assert.rejects(createAnalyticsService(x.db,o=>x.manager.resolve(o),{...x.metrika,configId:'real-rotation'}).refresh(x.owner,'metrika_site'),/Конфигурация|конфигураци|счётчик/);
  await assert.rejects(createAnalyticsService(x.db,o=>x.manager.resolve(o),{...x.metrika,owner:'another-owner'}).refresh(x.owner,'metrika_site'));
});
test('TR01-03: persistent 429 prevents two-process/reopen retries, while explicit retry after deadline works',async t=>{
  for(const source of ['direct_reports','metrika_site'] as const){
    const x=await fixture(t);if(source==='direct_reports')x.fault.directStatus=429;else x.fault.metrikaStatus=429;
    const first=await x.analytics.refresh(x.owner,source),before=x.calls.length;assert.equal(first.status,'error');
    const second=await x.analytics.refresh(x.owner,source);assert.equal(second.id,first.id);assert.equal(x.calls.length,before);
    const children=await Promise.all([worker(t,x.directory,'refresh',source,x.metrika.configId),worker(t,x.directory,'refresh',source,x.metrika.configId)]);
    const results=await Promise.all(children.map(child=>child.go()));for(let i=0;i<children.length;i++){assert.equal(results[i].id,first.id);assert.equal(results[i].dispatches,0);assert.equal((await children[i].exited)[0],0);}
    const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));first.cooldownUntil=Date.now()-1;raw.prepare('UPDATE analytics_reports SET payload=? WHERE id=?').run(JSON.stringify(first),first.id);raw.close();
    x.fault.directStatus=200;x.fault.metrikaStatus=200;const ready=await x.analytics.refresh(x.owner,source);assert.equal(ready.status,'ready');assert.equal(x.calls.length,before+1);
  }
});
test('TR01-03: hidden 429 survives settings/context changes and is visible as a persisted wait',async t=>{
  const x=await fixture(t);x.fault.directStatus=429;const first=await x.analytics.refresh(x.owner,'direct_reports');
  for(let i=0;i<31;i++)await x.analytics.refresh(x.owner,'metrika_site');assert.equal(x.db.readAnalyticsReports(x.owner).some(r=>r.id===first.id),false);
  const s=x.db.readAnalyticsSettings(x.owner);x.analytics.save(x.owner,new URLSearchParams({revision:String(s.revision),directRunId:s.directRunId!,goalId:s.goalId!,dateFrom:s.dateFrom,dateTo:s.dateTo}));
  const calls=x.calls.length;assert.equal((await x.analytics.refresh(x.owner,'direct_reports')).id,first.id);assert.equal(x.calls.length,calls);assert.equal(x.db.readAnalyticsCooldown('another-owner','direct_reports'),undefined);
  assert.match(renderAnalytics({...x.analytics.view(x.owner),reports:[first]}),/Повторное чтение доступно после/);
});
test('TR01-03: Metrika metadata and advertising share cooldown; a late 429 remains effective after invalidation',async t=>{
  const x=await fixture(t);let calls=0;
  const api=createMetrikaApi(async()=> 'fictional',async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'120'}});});
  const service=createAnalyticsService(x.db,o=>x.manager.resolve(o),{...x.metrika,api});
  await assert.rejects(service.counter(x.owner,'11001001',x.db.readAnalyticsSettings(x.owner).revision),/429/);
  await service.refresh(x.owner,'metrika_site');await service.refresh(x.owner,'metrika_direct');await assert.rejects(service.counter(x.owner,'11001001',x.db.readAnalyticsSettings(x.owner).revision),/429/);assert.equal(calls,1);
  const y=await fixture(t);let release!:(r:Response)=>void,lateCalls=0;
  const late=createAnalyticsService(y.db,o=>y.manager.resolve(o),{...y.metrika,api:createMetrikaApi(async()=> 'fictional',()=>{lateCalls++;return new Promise(resolve=>{release=resolve;});})});
  const pending=late.refresh(y.owner,'metrika_site');await Promise.resolve();late.disconnect(y.owner,y.db.readAnalyticsSettings(y.owner).revision);
  release(new Response('',{status:429,headers:{'Retry-After':'180'}}));assert.equal((await pending).status,'superseded');
  const receipt=y.db.readAnalyticsReports(y.owner)[0];assert.equal(receipt.status,'superseded');assert.ok(receipt.cooldownUntil!>Date.now()+170000);assert.equal(y.db.readAnalyticsCooldown(y.owner,'metrika_direct')!.id,receipt.id);
  await assert.rejects(late.counter(y.owner,'11001001',y.db.readAnalyticsSettings(y.owner).revision),/429/);assert.equal(lateCalls,1);
});
test('TR01-03: both adapters retain numeric/date/default/expired Retry-After as structured deadlines',async()=>{
  const q={campaignId:'42',dateFrom:'2026-11-01',dateTo:'2026-11-07',reportName:'limited'};
  for(const header of [null,'17',new Date(Date.now()+120000).toUTCString(),'nonsense','-1','1.5','99999999999999999999999','0',new Date(Date.now()-60000).toUTCString()]){
    const headers=header===null?{}:{'Retry-After':header},now=Date.now();
    const expected=header==='17'?17000:header===null||['nonsense','-1','1.5','99999999999999999999999'].includes(header)?60000:header==='0'||Date.parse(header)<now?1000:Date.parse(header)-now;
    for(const call of [()=>parseDirectReport(new Response('',{status:429,headers}),q),()=>createMetrikaApi(async()=> 'fictional',async()=>new Response('',{status:429,headers})).report({counterId:'11001001',goalId:'21001001',dateFrom:q.dateFrom,dateTo:q.dateTo})]){
      await assert.rejects(call(),(error:any)=>{assert.ok(Math.abs(error.retryAt-now-expected)<1000,`${header}: deadline must preserve provider delay`);return true;});
    }
  }
});
test('Related offline recovery: accepted201 then429/transport failure resumes the same id/body/ReportName',async t=>{
  for(const failure of ['429','transport']){
    const x=await fixture(t);x.fault.directStatus=201;const pending=await x.analytics.refresh(x.owner,'direct_reports'),body=x.calls.find(c=>c.source==='reports').body;
    const raw=new DatabaseSync(join(x.directory,'stage2.sqlite'));try{pending.retryAt=0;raw.prepare('UPDATE analytics_reports SET payload=? WHERE id=?').run(JSON.stringify(pending),pending.id);}finally{raw.close();}
    let broken=x.analytics;
    if(failure==='429')x.fault.directStatus=429;
    else{const connection=x.manager.resolve(x.owner)!;broken=createAnalyticsService(x.db,()=>({...connection,api:createDirectApi(async()=> 'fictional',async()=>{throw new Error('fixture transport interruption');})}),x.metrika);}
    const failed=await broken.refresh(x.owner,'direct_reports');assert.equal(failed.id,pending.id);assert.equal(failed.status,'error');
    const reset=new DatabaseSync(join(x.directory,'stage2.sqlite'));try{failed.cooldownUntil=Date.now()-1;failed.retryAt=0;reset.prepare('UPDATE analytics_reports SET payload=? WHERE id=?').run(JSON.stringify(failed),failed.id);}finally{reset.close();}
    x.fault.directStatus=200;const resumed=await x.analytics.refresh(x.owner,'direct_reports');assert.equal(resumed.id,pending.id);assert.equal(resumed.status,'ready');assert.deepEqual(x.calls.filter(c=>c.source==='reports').at(-1).body,body);assert.equal(resumed.error,undefined);assert.ok(resumed.failures?.length);
  }
});
