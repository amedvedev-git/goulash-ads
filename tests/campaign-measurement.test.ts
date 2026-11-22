import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderAnalytics } from '../src/analytics-page.ts';
import { directReportBody } from '../src/direct-reports.ts';
import type { DirectReportRequest } from '../src/direct-reports.ts';
import { analyticsDates, createAnalyticsService } from '../src/analytics.ts';
import { exampleCampaign } from '../src/campaign.ts';
import { openDatabase } from '../src/database.ts';
import type { DirectConnection, DirectState } from '../src/direct.ts';
import { createMetrikaApi } from '../src/metrika-api.ts';
import type { MetrikaProvider } from '../src/metrika-api.ts';

function setup(t: {after(callback:()=>void):void}) {
  const directory = mkdtempSync(join(tmpdir(),'goulash-measurement-'));
  const db = openDatabase(directory);
  t.after(()=>{ db.close(); rmSync(directory,{recursive:true,force:true}); });
  const owner = 'yandex:501';
  const connection = {owner,account:'301',login:'test-owner',mode:'fixture',generation:4} as DirectConnection;
  const external = {counterReads:0,testReads:0,confirmed:false,beforeTest:async()=>{},beforeReport:async()=>{},
    testRequest:undefined as {counter:string;goal:string;marker:string;domain?:string}|undefined};
  const goals = ['901','902'].map(id=>({id,name:`Тестовая цель ${id}`,type:'action',condition:'fixture'}));
  const counters = [
    {id:'101',domain:'alpha.example',mirrors:[],goals},
    {id:'202',domain:'beta.example',mirrors:[],goals},
  ];
  const api = {
    ...createMetrikaApi(async()=>{ throw new Error('Unexpected live API'); }),
    async counters(guard?:()=>void) { guard?.(); return counters; },
    async counter(id:string,guard?:()=>void) { guard?.(); external.counterReads++; return counters.find(item=>item.id===id)!; },
    async testGoal(counter:string,goal:string,_from:string,_to:string,marker:string,guard?:()=>void,domain?:string) {
      await external.beforeTest(); guard?.(); external.testReads++;
      external.testRequest={counter,goal,marker,domain}; return external.confirmed;
    },
    async report(_query:unknown,guard?:()=>void) {
      await external.beforeReport(); guard?.();
      return {status:'ready' as const, metrics:{visits:1,reaches:1,goalVisits:1,cost:null,cpa:null},complete:true,issues:[],dataLag:0,sampled:false,sampleShare:1,query:{}};
    },
    async daily(_query:unknown,guard?:()=>void) {
      guard?.();
      return {status:'ready' as const, metrics:{visits:null,reaches:2,goalVisits:null,cost:null,cpa:null},days:[],complete:true,issues:[],dataLag:0,sampled:false,sampleShare:1,query:{}};
    },
  };
  let configId = 'working-config';
  const resolveMetrika = (who:string): MetrikaProvider|undefined => who===owner ? {owner,configId,mode:'fixture',api} : undefined;
  const analytics = createAnalyticsService(db,who=>who===owner?connection:undefined,resolveMetrika);
  function campaign(host:string,externalId:string) {
    const id=db.createCampaignWorkspace(owner).id;
    const draft={...exampleCampaign,url:`https://${host}/booking`};
    db.saveCampaign(owner,draft,0,'Тест',undefined,id);
    const run={name:host,campaignId:id,planId:`run-${externalId}`,draft,account:connection.account,steps:{campaign:{id:externalId,phase:'confirmed'}}} as DirectState;
    db.saveDirect(owner,run);
    return {id,run};
  }
  const a = campaign('alpha.example','401'), b = campaign('beta.example','402');
  const revision = () => db.readAnalyticsSettings(owner).revision;
  const attach = async (id:string,counter:string,goal:string) => {
    await analytics.counter(owner,counter,revision(),id);
    analytics.setGoal(owner,id,goal,revision());
  };
  return {db,directory,connection,owner,analytics,a,b,revision,attach,external,rotate:()=>{configId='rotated';}};
}

test('Метрика кампании: разные цели и отчёты двух кампаний, проверка сайта и сохранённый прежний выбор',async t=>{
  const x=setup(t),{db,owner,analytics,a,b,revision}=x;
  const legacy=db.readAnalyticsSettings(owner);
  await analytics.counter(owner,'101',legacy.revision);
  const legacyFilter={dateFrom:legacy.dateFrom,dateTo:legacy.dateTo,goalId:'901',directRunId:a.run.planId};
  analytics.save(owner,new URLSearchParams({...legacyFilter,revision:String(revision())}));
  const oldReport=await analytics.refresh(owner,'metrika_direct');
  assert.equal(analytics.campaignMeasurement(owner,a.id).legacy,true);
  assert.equal(analytics.campaignMeasurement(owner,b.id).measurement,undefined);
  assert.equal(analytics.view(owner,undefined,a.id).currentReports[0]?.id,oldReport.id);
  assert.deepEqual(analytics.view(owner,undefined,b.id).reports,[]);

  await assert.rejects(analytics.counter(owner,'202',revision(),a.id),/другому сайту/);
  assert.throws(()=>analytics.view('other-owner',undefined,a.id),/не найдена/);
  await x.attach(a.id,'101','902');
  await x.attach(b.id,'202','901');
  assert.throws(()=>analytics.save(owner,new URLSearchParams({...legacyFilter,revision:String(revision())}),true,b.id),/не найден в этой кампании/);
  const reportA=await analytics.refresh(owner,'metrika_direct',revision(),a.id);
  const reportB=await analytics.refresh(owner,'metrika_direct',revision(),b.id);
  await analytics.refresh(owner,'metrika_daily',revision(),a.id);
  const aView=analytics.view(owner,undefined,a.id), bView=analytics.view(owner,undefined,b.id);
  assert.equal(aView.settings.goalId,'902');
  assert.equal(bView.settings.goalId,'901');
  assert.equal(aView.currentReports.find(row=>row.source==='metrika_direct')?.id,reportA.id);
  assert.equal(bView.currentReports[0]?.id,reportB.id);
  assert.ok(aView.reports.some(row=>row.id===oldReport.id));
  assert.ok(!bView.reports.some(row=>row.id===oldReport.id||row.id===reportA.id));
  assert.equal(analytics.view(owner).campaignReports.some(row=>row.source==='metrika_daily'&&row.context.workspaceId===a.id),true);
  assert.equal(db.readAnalyticsSettings(owner).goalId,'901');
  const lostAccess = createAnalyticsService(db, () => x.connection);
  const history = lostAccess.view(owner, undefined, a.id);
  assert.equal(history.currentReports.some(report => report.source === 'metrika_direct'), false);
  assert.deepEqual(history.lastGoals.map(report => report.id), [reportA.id]);
  const historicHtml = renderAnalytics({ ...history, campaignId: a.id });
  assert.match(historicHtml, /Последний сохранённый отчёт[^<]+МСК/);
  assert.match(historicHtml, /Восстановить чтение Метрики/);
  assert.equal((historicHtml.match(/data-recovery/g) ?? []).length, 1);
  assert.match(historicHtml, /Новая оценка ждёт доступа/);
  const reopened=lostAccess.campaignMeasurement(owner,b.id);
  assert.equal(reopened.measurement?.counter.id,'202');
  assert.equal(reopened.current,false);
});

test('результаты показывают один следующий шаг по выбору кампании и настройке измерения', async t => {
  const x = setup(t);
  const { analytics, db, owner, a, revision } = x;
  const view = (service=analytics) => renderAnalytics({ ...service.view(owner, undefined, a.id), campaignId: a.id });
  const noCampaigns = renderAnalytics(analytics.view('other-owner'));
  assert.ok(noCampaigns.includes('Перейти к кампаниям'));
  assert.doesNotMatch(noCampaigns, /data-recovery|analytics-refresh/);
  const unselected = renderAnalytics(analytics.view(owner));
  assert.match(unselected, /id="analytics-run"/);
  assert.doesNotMatch(unselected, /data-recovery|analytics-refresh|id="metrika-settings"/);
  const counter = view();
  assert.match(counter, /name="source" value="direct_reports"/);
  assert.doesNotMatch(counter, /name="source" value="metrika|Восстановить чтение|Управлять измерением/);
  assert.match(counter, new RegExp(`ad=${a.id}&amp;from=results#metrika-counter">Выбрать счётчик`));
  assert.equal((counter.match(/data-recovery/g) ?? []).length, 1);
  const connect = view(createAnalyticsService(db, () => x.connection));
  assert.match(connect, new RegExp(`ad=${a.id}&amp;from=results#metrika-title">Подключить Метрику`));
  assert.doesNotMatch(connect, /Восстановить чтение/);
  await analytics.counter(owner, '101', revision(), a.id);
  assert.match(view(), new RegExp(`ad=${a.id}&amp;from=results#metrika-goal">Выбрать цель`));
  const stored = db.readCampaign(owner,a.id)!;
  db.saveCampaign(owner,{...stored.draft,url:'https://alpha.example/new'},stored.revision,'Тест',undefined,a.id);
  assert.match(view(), new RegExp(`ad=${a.id}&amp;from=results#metrika-counter">Сменить счётчик`));
});

test('Метрика кампании: уникальный тест привязан к счётчику, цели, сайту и доступу',async t=>{
  const x=setup(t),{owner,analytics,a,b,revision,external,db}=x;
  assert.deepEqual((await analytics.listCounters(owner)).map(item=>item.id),['101','202']);
  await x.attach(a.id,'101','901');
  await x.attach(b.id,'202','902');
  analytics.beginTest(owner,a.id,revision());
  analytics.beginTest(owner,b.id,revision());
  const markerA=new URL(analytics.campaignMeasurement(owner,a.id).testUrl!).searchParams.get('goulash_test');
  const markerB=new URL(analytics.campaignMeasurement(owner,b.id).testUrl!).searchParams.get('goulash_test');
  assert.match(markerA!,/^[a-f0-9]{32}$/u);
  assert.notEqual(markerA,markerB);
  assert.equal(await analytics.verifyTest(owner,a.id,revision()),false);
  assert.equal(analytics.campaignMeasurement(owner,a.id).verified,false);
  external.confirmed=true;
  assert.equal(await analytics.verifyTest(owner,a.id,revision()),true);
  assert.deepEqual(external.testRequest,{counter:'101',goal:'901',marker:markerA,domain:'alpha.example'});
  assert.equal(analytics.campaignMeasurement(owner,a.id).verified,true);
  assert.equal(analytics.campaignMeasurement(owner,b.id).verified,false);
  const reads=external.testReads;
  assert.equal(await analytics.verifyTest(owner,a.id,revision()),true);
  assert.equal(external.testReads,reads);
  analytics.setGoal(owner,a.id,'902',revision());
  assert.equal(analytics.campaignMeasurement(owner,a.id).verified,false);
  assert.equal(analytics.campaignMeasurement(owner,a.id).testUrl,undefined);

  const bDraft=db.readCampaign(owner,b.id)!;
  let release!:()=>void;
  external.beforeTest=()=>new Promise<void>(resolve=>{release=resolve;});
  const pending=analytics.verifyTest(owner,b.id,revision());
  db.saveCampaign(owner,{...bDraft.draft,url:'https://beta.example/different'},bDraft.revision,'Другой экран',undefined,b.id);
  release();
  await assert.rejects(pending,/страница кампании изменилась/);
  assert.equal(external.testReads,reads);
  assert.equal(analytics.campaignMeasurement(owner,b.id).current,false);
  x.rotate();
  assert.equal(analytics.campaignMeasurement(owner,a.id).current,false);
});

test('Директ 202: другая кампания видит ожидающий отчёт, повтор после рестарта сохраняет запрос', async t => {
  const x = setup(t);
  const sent: string[] = [];
  let ready = false;
  const connection = { ...x.connection, api: { async reportRead(request: DirectReportRequest, guard: () => void) {
    guard(); sent.push(directReportBody(request));
    return ready ? { status: 'empty' } : { status: 'pending', retryIn: 17 };
  } } } as DirectConnection;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const first = createAnalyticsService(x.db, () => connection);
  const pending = await first.refresh(x.owner, 'direct_reports', x.revision(), x.a.id);
  assert.equal(pending.status, 'pending');
  const period = analyticsDates();
  const apply = (dateFrom:string) => first.save(x.owner,new URLSearchParams({revision:String(x.revision()),
    directRunId:x.a.run.planId,dateFrom,dateTo:period.dateTo}),true,x.a.id);
  apply(new Date(Date.parse(period.dateTo)-29*86_400_000).toISOString().slice(0,10));
  assert.match(renderAnalytics({...first.view(x.owner,undefined,x.a.id),campaignId:x.a.id}),new RegExp(`name="reportId" value="${pending.id}">`));
  const reopened = openDatabase(x.directory);
  try {
    const afterRestart = createAnalyticsService(reopened, () => connection);
    const b = afterRestart.view(x.owner, undefined, x.b.id);
    const html = renderAnalytics({ ...b, campaignId: x.b.id });
    assert.match(html, /Открыть ожидающий отчёт/);
    assert.ok(html.includes(`/results?ad=${x.a.id}&amp;run=run-401#refresh-title`));
    assert.match(html, /Сверка после/);
    await assert.rejects(afterRestart.refresh(x.owner, 'direct_reports', x.revision(), x.b.id), /другого отчёта/);
    await assert.rejects(afterRestart.reconcileDirectReport(x.owner, pending.id, x.b.id), /не найден/);
    await assert.rejects(afterRestart.reconcileDirectReport('other-owner', pending.id, x.a.id), /не найден/);
    assert.equal((await afterRestart.reconcileDirectReport(x.owner, pending.id, x.a.id)).id, pending.id);
    assert.equal(sent.length, 1);
    t.mock.timers.tick(17_000); ready = true;
    const result = await afterRestart.reconcileDirectReport(x.owner, pending.id, x.a.id);
    assert.equal(result.id, pending.id); assert.equal(result.status, 'empty');
    assert.equal(sent[1], sent[0]); assert.match(sent[1], /"IncludeVAT":"NO"/);
    assert.equal(afterRestart.view(x.owner, undefined, x.a.id).currentReports.length, 0);
    apply(period.dateFrom);
    assert.equal(afterRestart.view(x.owner, undefined, x.a.id).currentReports[0]?.id, pending.id);
    assert.equal(afterRestart.view(x.owner, undefined, x.b.id).pending.length, 0);
    assert.equal((await afterRestart.refresh(x.owner, 'direct_reports', x.revision(), x.b.id)).status, 'empty');
    ready = false;
    const waiting = await first.refresh(x.owner,'direct_reports',x.revision(),x.a.id);
    connection.generation = 5;
    await assert.rejects(first.reconcileDirectReport(x.owner,waiting.id,x.a.id),/Подключение или кампания Директа изменились/);
    assert.equal(x.db.readAnalyticsReports(x.owner).find(item=>item.id===waiting.id)?.status,'superseded');
    assert.equal(first.view(x.owner,undefined,x.a.id).currentReports.length,0);
    ready = true;
    assert.notEqual((await first.refresh(x.owner,'direct_reports',x.revision(),x.a.id)).id,waiting.id);
  } finally { reopened.close(); }
});

test('правки цели одной кампании не прерывают чтение другой',async t=>{
  const x=setup(t),{db,owner,analytics,a,b,revision,external}=x;
  await x.attach(a.id,'101','901');
  await x.attach(b.id,'202','901');
  let release!:()=>void;
  external.beforeReport=()=>new Promise<void>(resolve=>{release=resolve;});
  const pending=analytics.refresh(owner,'metrika_site',revision(),a.id);
  analytics.setGoal(owner,b.id,'902',revision());
  const {dateFrom,dateTo}=db.readAnalyticsSettings(owner);
  analytics.save(owner,new URLSearchParams({revision:String(revision()),dateFrom,dateTo,directRunId:b.run.planId}));
  await assert.rejects(analytics.refresh(owner,'metrika_site',revision(),b.id),/другого отчёта/);
  release();
  const report=await pending;
  assert.equal(report.status,'ready');
  assert.equal(report.context.goalId,'901');
  assert.equal(analytics.view(owner,undefined,a.id).currentReports[0]?.id,report.id);
  assert.deepEqual(analytics.view(owner,undefined,b.id).currentReports,[]);
});
