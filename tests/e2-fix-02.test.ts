import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { e2Fixture,e2Draft,fixtureKey } from './fixtures/e2.ts';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { hasUnresolvedDirect } from '../src/direct-pending.ts';
function fixture(t:test.TestContext,options:Parameters<typeof e2Fixture>[1]={}){
  const dir=mkdtempSync(join(tmpdir(),'e2-fix02-')),x=e2Fixture(dir,options);
  t.after(()=>{x.db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});return x;
}
for(const outcome of ['rejected','not_sent'])test(`E2-T02-01: первый add ${outcome} → исправленный E1 → refresh → новый полный набор`,async t=>{
  let x:ReturnType<typeof fixture>,armed=false;const base=createSecretCodec({platform:'linux',key:fixtureKey});
  const codec={protect:base.protect,async unprotect(value:any,context:string){if(armed&&x.db.readDirect(x.owner)?.steps.campaign.phase==='pending'){armed=false;throw new Error('Synthetic credential unavailable before dispatch');}return base.unprotect(value,context);}};
  x=fixture(t,{codec});await x.connect();x.plan();await x.action('prepare',{name:'Первое создание'});
  if(outcome==='rejected')x.a.fault('campaigns/add','item');else armed=true;
  await assert.rejects(x.action('create'));const failed=x.db.readDirect(x.owner)!,writes=x.a.writes().length;
  assert.equal(failed.attempts!.at(-1)!.outcome,outcome);assert.ok(Object.values(failed.steps).every(step=>step.phase==='ready'&&!step.id));assert.equal(x.a.records.campaigns.length,0);assert.equal(writes,outcome==='rejected'?1:0);
  x.plan(x.owner,{...e2Draft,budget:'8000'});await x.action('refresh');const refreshed=x.db.readDirect(x.owner)!;
  assert.equal(refreshed.attempts!.at(-1)!.outcome,outcome);assert.equal(hasUnresolvedDirect(refreshed),false);assert.equal(refreshed.events[0].phase,'rejected');assert.equal(x.a.writes().length,writes);
  await x.action('prepare',{name:'Исправленное создание'});const next=x.db.readDirect(x.owner)!;assert.notEqual(next.planId,failed.planId);assert.equal(next.budget!.amountRub,'8000');
  await x.action('create');assert.equal(x.db.readDirect(x.owner)!.complete,true);assert.equal(x.a.records.campaigns.length,1);assert.equal(x.a.writes().length,writes+6);
  assert.equal(x.db.readDirect(x.owner,failed.planId)!.attempts!.at(-1)!.outcome,outcome);assert.equal(x.db.readDirectRuns(x.owner).length,2);
});

for(const fault of ['before','after'] as const)test(`E2-T02-01: unknown первого add ${fault} не становится достоверным отказом`,async t=>{
  const x=fixture(t);await x.connect();x.plan();await x.action('prepare',{name:'Неизвестный add'});x.a.fault('campaigns/add',fault);await assert.rejects(x.action('create'));
  const original=x.db.readDirect(x.owner)!,writes=x.a.writes().length;x.plan(x.owner,{...e2Draft,budget:'8000'});
  if(fault==='before')await assert.rejects(x.action('refresh'),/неизвестен/);else await x.action('refresh');
  assert.equal(hasUnresolvedDirect(x.db.readDirect(x.owner)),true);assert.equal(x.db.readDirect(x.owner)!.events[0].phase,'pending');
  await assert.rejects(x.action('prepare',{name:'Обход unknown',newRun:'yes'}),/незаверш|свер/i);assert.equal(x.db.readDirect(x.owner)!.planId,original.planId);assert.equal(x.a.writes().length,writes);
  assert.equal(x.a.records.campaigns.length,fault==='after'?1:0);
});

test('E2-T02-01: известный отказ группы при существующей кампании не разрешает замену частичного набора',async t=>{
  const x=fixture(t);await x.connect();x.plan();await x.action('prepare',{name:'Частичный набор'});x.a.fault('adgroups/add','item');await assert.rejects(x.action('create'));
  const original=x.db.readDirect(x.owner)!,writes=x.a.writes().length;assert.equal(original.steps.campaign.phase,'confirmed');assert.equal(original.attempts!.at(-1)!.outcome,'rejected');
  x.plan(x.owner,{...e2Draft,budget:'8000'});await x.action('refresh');assert.equal(hasUnresolvedDirect(x.db.readDirect(x.owner)),true);assert.equal(x.db.readDirect(x.owner)!.events[0].phase,'pending');
  await assert.rejects(x.action('prepare',{name:'Обход частичного',newRun:'yes'}),/незаверш|свер/i);assert.equal(x.db.readDirect(x.owner)!.planId,original.planId);assert.equal(x.a.writes().length,writes);assert.equal(x.a.records.campaigns.length,1);
  await x.action('create');assert.equal(x.db.readDirect(x.owner)!.complete,true);assert.equal(x.db.readDirect(x.owner)!.budget!.amountRub,'7000');assert.equal(x.a.records.campaigns.length,1);
});
