import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { e2Fixture,e2Draft,fixtureKey } from './fixtures/e2.ts';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { createPreparationService } from '../src/preparation.ts';
import { renderPlan } from '../src/plan-page.ts';
import { renderDirect } from '../src/direct-page.ts';
import { createApp } from '../src/server.ts';
import { createYandexAuth } from '../src/yandex-auth.ts';
import { renderDirectConnect } from '../src/direct-connect-page.ts';
function barrier(){let release!:()=>void;const wait=new Promise<void>(r=>release=r);return {wait,release};}
function fixture(t:test.TestContext,options:Parameters<typeof e2Fixture>[1]={}){
  const dir=mkdtempSync(join(tmpdir(),'e2-fix01-')),x=e2Fixture(dir,options);
  t.after(()=>{x.db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});return x;
}
for(const kind of ['rename','undo'])test(`E2-T01-01: unknown ${kind} блокирует newRun/account swap до reconcile`,async t=>{
  const x=fixture(t);await x.connect();x.plan();await x.action('prepare',{name:'Первый набор'});await x.action('create');
  const original=x.db.readDirect(x.owner)!;
  if(kind==='undo')await x.action('rename',{before:original.name,name:'Изменено перед отменой'});
  const target=x.db.readDirect(x.owner)!.events.at(-1)!;x.a.fault('campaigns/update','after');
  await assert.rejects(x.action(kind,kind==='rename'?{before:original.name,name:'Неизвестное имя'}:{id:target.id}));
  const pending=x.db.readDirect(x.owner)!,writes=x.a.writes().length;
  assert.equal(pending.complete,true);assert.equal(pending.events.at(-1)!.phase,'pending');
  const view=x.service().view(x.owner),preparation=createPreparationService(x.db).view(x.owner);
  await assert.rejects(x.action('prepare',{name:'Обход неизвестной записи',newRun:'yes'}),/свер|незаверш/i);
  assert.equal(x.db.readDirect(x.owner)!.planId,original.planId);assert.equal(x.db.readDirectRuns(x.owner).length,1);assert.equal(x.a.writes().length,writes);
  assert.match(renderPlan(preparation,'fixture',view),/незавершённая операция в Директе/);
  assert.doesNotMatch(renderPlan(preparation,'fixture',view),/Создать черновик в Директе/);
  assert.match(renderDirect(view,{input:e2Draft,revision:1}),/Сверить состояние Директа/);
  x.a.wrongAccount(true);
  const browser=x.manager.start(x.owner,x.session),attempt=x.manager.view(x.owner,x.session,browser).attempt!;
  await x.manager.finish(x.owner,x.session,browser,new URLSearchParams({attemptId:attempt.id,nonce:attempt.nonce,code:'a'}));
  const choice=new URLSearchParams({candidateId:x.manager.view(x.owner,x.session,browser).candidate!.id,confirm:'yes'});
  assert.throws(()=>x.manager.activate(x.owner,x.session,choice),/Сначала завершите и сверьте/);
  assert.equal(x.manager.resolve(x.owner)!.account,'10101');assert.equal(x.a.writes().length,writes);
  x.a.wrongAccount(false);await x.action('refresh');assert.equal(x.db.readDirect(x.owner)!.events.at(-1)!.phase,'confirmed');assert.equal(x.a.writes().length,writes);
  assert.doesNotMatch(renderPlan(createPreparationService(x.db).view(x.owner),'fixture',x.service().view(x.owner)),/незавершённая операция в Директе/);
  x.a.wrongAccount(true);x.manager.activate(x.owner,x.session,choice);assert.equal(x.manager.resolve(x.owner)!.account,'42');
  await x.action('prepare',{name:'Разрешено после сверки',newRun:'yes'});assert.notEqual(x.db.readDirect(x.owner)!.planId,original.planId);assert.equal(x.a.writes().length,writes);
});

for(const outcome of ['rejected','not_sent'])test(`E2-T01-01: достоверный ${outcome} имени не блокирует новый набор навсегда`,async t=>{
  let x:ReturnType<typeof fixture>;let armed=false;const codec=createSecretCodec({platform:'linux',key:fixtureKey});
  const wrapped={protect:codec.protect,async unprotect(value:any,context:string){if(armed&&x.db.readDirect(x.owner)?.events.at(-1)?.kind==='rename'&&x.db.readDirect(x.owner)?.events.at(-1)?.phase==='pending'){armed=false;throw new Error('Synthetic unavailable credential before dispatch');}return codec.unprotect(value,context);}};
  x=fixture(t,{codec:wrapped});await x.connect();x.plan();await x.action('prepare',{name:'Исходный набор'});await x.action('create');const original=x.db.readDirect(x.owner)!;
  if(outcome==='rejected')x.a.fault('campaigns/update','item');else armed=true;
  await assert.rejects(x.action('rename',{before:original.name,name:'Отклонённое изменение'}));assert.equal(x.db.readDirect(x.owner)!.attempts!.at(-1)!.outcome,outcome);
  const writes=x.a.writes().length;await x.action('prepare',{name:'Новый после отказа',newRun:'yes'});assert.notEqual(x.db.readDirect(x.owner)!.planId,original.planId);assert.equal(x.a.writes().length,writes);
});

test('E2-T01-02: stale prepare не меняет весь актуальный phrasePlan после нового E1', {timeout:15000},async t=>{
  let x:ReturnType<typeof fixture>;let armed=false;const entered=barrier(),release=barrier();
  const transport:typeof fetch=(url,init)=>{const response=x.provider(url,init),request=String(url).includes('/json/')?JSON.parse(String(init?.body)):undefined;if(armed&&request?.params?.DictionaryNames?.[0]==='Currencies'){armed=false;entered.release();return release.wait.then(()=>response);}return response;};
  x=fixture(t,{transport});await x.connect();x.plan();const oldId=x.db.readPhrasePlan(x.owner)!.id;armed=true;const action=x.action('prepare',{name:'Устаревшая вкладка'});await entered.wait;
  x.plan(x.owner,{...e2Draft,budget:'8000'});const latest=x.db.readPhrasePlan(x.owner)!,serialized=JSON.stringify(latest);assert.notEqual(latest.id,oldId);
  release.release();await assert.rejects(action,/План изменился/);assert.equal(JSON.stringify(x.db.readPhrasePlan(x.owner)),serialized);assert.equal(x.db.readDirect(x.owner),undefined);assert.equal(x.a.writes().length,0);
  await x.action('prepare',{name:'Актуальный план'});assert.equal(x.db.readDirect(x.owner)!.campaignPlanId,latest.id);
});

test('E2-T01-02: сбой сохранения Direct run откатывает связанную запись phrasePlan',async t=>{
  const x=fixture(t);await x.connect();x.plan();const plan=x.db.readPhrasePlan(x.owner)!;plan.candidates[0].selected=false;x.db.savePhrasePlan(x.owner,plan);const before=JSON.stringify(x.db.readPhrasePlan(x.owner));
  const save=x.db.saveDirect;x.db.saveDirect=()=>{throw new Error('Synthetic local save failure');};
  try{await assert.rejects(x.action('prepare',{name:'Сбой локального commit'}),/Synthetic local save failure/);}finally{x.db.saveDirect=save;}
  assert.equal(JSON.stringify(x.db.readPhrasePlan(x.owner)),before);assert.equal(x.db.readDirect(x.owner),undefined);assert.equal(x.a.writes().length,0);
});

async function connectionHttp(t:test.TestContext,delayToken=false){
  let x:ReturnType<typeof e2Fixture>;let armed=false;const entered=barrier(),release=barrier();
  const transport:typeof fetch=(url,init)=>{const response=x.provider(url,init);if(armed&&String(url)==='https://oauth.yandex.ru/token'){armed=false;entered.release();return release.wait.then(()=>response);}return response;};
  const dir=mkdtempSync(join(tmpdir(),'e2-fix01-http-'));x=e2Fixture(dir,{transport});await x.connect();
  const token='x'.repeat(43),session=createHash('sha256').update(`fixture-login:${token}`).digest('hex');x.db.createSession(session,x.owner,'Fixture owner',Date.now()+60000);
  const auth=createYandexAuth(x.db,'fixture-login','synthetic-secret'),server=createApp(x.db,auth,undefined,undefined,undefined,undefined,undefined,undefined,{},x.manager);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));x.db.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${(server.address() as any).port}`;let browser=x.manager.start(x.owner,session);
  const post=(action:string,form:URLSearchParams=new URLSearchParams())=>fetch(`${origin}/connections/direct/${action}`,{method:'POST',headers:{Origin:origin,Cookie:`goulash_session=${token}; goulash_direct=${browser}`},body:form,redirect:'manual'});
  const form=()=>{const a=x.manager.view(x.owner,session,browser).attempt!;return new URLSearchParams({attemptId:a.id,nonce:a.nonce,code:'a'});};
  return {...x,session,entered,release,post,form,arm(){armed=delayToken;},newAttempt(){browser=x.manager.start(x.owner,session);return x.manager.view(x.owner,session,browser).attempt!;},view:()=>x.manager.view(x.owner,session,browser)};
}

test('E2-T01-03: обычный cancel удаляет attempt/candidate, сохраняя рабочий доступ',async t=>{
  const x=await connectionHttp(t),active=x.db.readDirectConnection(x.owner)!,fields=x.form();assert.equal((await x.post('cancel')).status,303);assert.equal((await x.post('finish',fields)).status,409);assert.equal(x.view().attempt,undefined);
  x.newAttempt();assert.equal((await x.post('finish',x.form())).status,303);assert.ok(x.view().candidate);assert.match(renderDirectConnect(x.view()),/action="\/connections\/direct\/cancel"/);assert.equal((await x.post('cancel')).status,303);assert.equal(x.view().candidate,undefined);assert.equal(x.db.readDirectConnection(x.owner)!.value.candidate,undefined);
  const after=x.db.readDirectConnection(x.owner)!;assert.equal(after.generation,active.generation);assert.deepEqual(after.value.envelope,active.value.envelope);assert.ok(x.manager.resolve(x.owner));assert.equal(x.a.writes().length,0);
});

test('E2-T01-03: cancel после consume/во время HTTP запрещает поздний candidate', {timeout:15000},async t=>{
  const x=await connectionHttp(t,true),active=x.db.readDirectConnection(x.owner)!;x.arm();const response=x.post('finish',x.form());await x.entered.wait;assert.equal(x.db.readConnectAttempt(x.owner),undefined);
  assert.equal((await x.post('cancel')).status,303);x.release.release();assert.equal((await response).status,409);assert.equal(x.view().candidate,undefined);assert.equal(x.db.readDirectConnection(x.owner)!.value.candidate,undefined);
  const after=x.db.readDirectConnection(x.owner)!;assert.equal(after.generation,active.generation);assert.deepEqual(after.value.envelope,active.value.envelope);assert.ok(x.manager.resolve(x.owner));assert.equal(x.a.writes().length,0);
});

test('E2-T01-03: поздний отменённый finish не удаляет новую независимую попытку', {timeout:15000},async t=>{
  const x=await connectionHttp(t,true);x.arm();const old=x.post('finish',x.form());await x.entered.wait;await x.post('cancel');const next=x.newAttempt();x.release.release();assert.equal((await old).status,409);
  assert.equal(x.view().attempt!.id,next.id);assert.equal(x.view().candidate,undefined);assert.equal((await x.post('finish',x.form())).status,303);assert.ok(x.view().candidate);assert.equal(x.a.writes().length,0);
});
