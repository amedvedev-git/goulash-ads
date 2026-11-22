import { removeE3Schema } from './fixtures/e3-control.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { verifyOwnChief,createDirectConnections } from '../src/direct-connect.ts';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { disconnectDirectFixture,e2Fixture,e2Draft,fixtureKey } from './fixtures/e2.ts';
import { openDatabase } from '../src/database.ts';
import { renderDirectConnect } from '../src/direct-connect-page.ts';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
function directory(_t:test.TestContext) { return mkdtempSync(join(tmpdir(),'e2-')); }
function cleanup(dir:string){assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});}
function fixture(t:test.TestContext,options:Parameters<typeof e2Fixture>[1]={}) { const dir=directory(t),x=e2Fixture(dir,options),extraClosers:(()=>void)[]=[];t.after(()=>{for(const close of extraClosers)close();x.db.close();cleanup(dir);});return {...x,dir,extraClosers}; }
function barrier() { let release!:()=>void;const wait=new Promise<void>(r=>release=r);return {wait,release}; }

test('E2-D01: документированная видимость CHIEF/DELEGATE/READONLY и нейтральный отказ',async t=>{
  for(const role of ['CHIEF','DELEGATE','READONLY']) {
    const x=fixture(t,{role});
    if(role==='CHIEF'){await x.connect();assert.equal(x.manager.resolve(x.owner)?.account,'10101');}
    else await assert.rejects(x.connect(),/Главный представитель не подтверждён/);
    assert.equal(x.a.writes().length,0);
  }
  const c={ClientId:'1',Login:'a',Type:'CLIENT',Currency:'RUB',Archived:'NO',ForbiddenPlatform:'NONE',AvailableCampaignTypes:['UNIFIED_CAMPAIGN'],Grants:[{Privilege:'EDIT_CAMPAIGNS',Value:'YES'}]};
  for(const Representatives of [[],[{Login:'a',Role:'CHIEF'},{Login:'a',Role:'CHIEF'}],[{Login:'b',Role:'CHIEF'}]]) assert.throws(()=>verifyOwnChief({...c,Representatives}),/Главный/);
});

test('E2: nonce/session/owner/replay и candidate CAS не изменяют действующий доступ',async t=>{
  const x=fixture(t);await x.connect();const generation=x.db.readDirectConnection(x.owner)!.generation;
  let browser=x.manager.start(x.owner,x.session),a=x.manager.view(x.owner,x.session,browser).attempt!;
  const form=new URLSearchParams({attemptId:a.id,nonce:a.nonce,code:'a'});
  await assert.rejects(x.manager.finish(x.owner,'other-session',browser,form),/устарела/);
  await assert.rejects(x.manager.finish(x.owner,x.session,'other-browser',form),/устарела/);
  await assert.rejects(x.manager.finish(x.owner,x.session,browser,new URLSearchParams({...Object.fromEntries(form),nonce:'bad'})),/устарела/);
  await x.manager.finish(x.owner,x.session,browser,form);
  await assert.rejects(x.manager.finish(x.owner,x.session,browser,form),/устарела/);
  const candidate=x.manager.view(x.owner,x.session,browser).candidate!;
  x.disconnect();
  assert.throws(()=>x.manager.activate(x.owner,x.session,new URLSearchParams({candidateId:candidate.id,confirm:'yes'})),/устарел/);
  assert.equal(x.db.readDirectConnection(x.owner)!.generation,generation+1);
  browser=x.manager.start(x.owner,x.session);a=x.manager.view(x.owner,x.session,browser).attempt!;
  await assert.rejects(x.manager.finish(x.owner,x.session,browser,new URLSearchParams({attemptId:a.id,nonce:a.nonce,code:'b'})),/другим аккаунтом/);
  assert.equal(x.manager.resolve(x.owner),undefined);
});

test('E2: полный периодный путь, точные ID, stale POST, undo, новый run и изоляция двух владельцев',async t=>{
  const x=fixture(t);await x.connect();await x.connect('yandex:202','b','session-b');x.plan();x.plan('yandex:202');
  await x.action('prepare',{name:'Периодный тест',startDate:'2099-12-29'});
  let state=x.db.readDirect(x.owner)!;const stale=String(state.storageRevision);
  assert.deepEqual(state.budget,{kind:'custom_period',amountRub:'7000',spendLimitMicros:'7000000000',periodDays:'7',startDate:'2099-12-29',endDate:'2100-01-04',autoContinue:'NO'});
  await x.action('create');state=x.db.readDirect(x.owner)!;assert.equal(state.complete,true);
  assert.equal(state.steps.ad.id,'9000123400000000123');assert.equal(x.a.writes().length,6);
  const strategy=x.a.records.campaigns[0].UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks;
  assert.equal(strategy.WeeklySpendLimit,undefined);assert.equal(strategy.CustomPeriodBudget.SpendLimit,'7000000000');
  assert.equal(x.db.directDispatches(x.owner,state.planId).length,6);
  await assert.rejects(x.action('create',{storageRevision:stale}),/устарела/);assert.equal(x.a.writes().length,6);
  await x.action('rename',{before:state.snapshot!.campaign.Name,name:'Изменённое имя'});
  const event=x.db.readDirect(x.owner)!.events.at(-1)!;await x.action('undo',{id:event.id});assert.equal(x.a.records.campaigns[0].Name,state.name);
  assert.equal(x.db.readDirect('yandex:202',state.planId),undefined);assert.equal(x.b.writes().length,0);
  const before=x.db.readDirectRuns(x.owner)[0].planId;await x.action('prepare',{name:'Отдельная подготовка',newRun:'yes'});
  assert.equal(x.db.readDirectRuns(x.owner).length,2);assert.equal(x.db.readDirect(x.owner,before)!.events.length,3);
  assert.notEqual(x.db.readDirect(x.owner)!.planId,before);
  await x.action('create');assert.equal(x.db.readDirect(x.owner)!.complete,true);assert.notEqual(x.db.readDirect(x.owner)!.steps.ad.id,x.db.readDirect(x.owner,before)!.steps.ad.id);assert.equal(x.db.readDirectRuns(x.owner).length,2);
});

test('E2: известный reject не заменяет period budget недельным, unknown не повторяется',async t=>{
  const x=fixture(t);await x.connect();x.plan();await x.action('prepare',{name:'Не повторять'});
  x.a.fault('campaigns/add','item');await assert.rejects(x.action('create'),/999/);
  assert.equal(x.a.writes().length,1);assert.equal(x.db.readDirect(x.owner)!.attempts![0].outcome,'rejected');
  assert.equal(x.a.records.campaigns.length,0);
  x.a.fault('campaigns/add','before');await assert.rejects(x.action('create'));
  const writes=x.a.writes().length;await assert.rejects(x.action('refresh'),/неизвестен/);await assert.rejects(x.action('create'),/неизвестен/);assert.equal(x.a.writes().length,writes);
});

test('E2-D02: отключение другим DB handle завершается во время первого write, late ID не воскрешает токен', {timeout:15000},async t=>{
  let x:ReturnType<typeof fixture>;const entered=barrier(),release=barrier();
  const transport:typeof fetch=(url,init)=>{
    const req=String(url).includes('/json/')?JSON.parse(String(init?.body)):undefined;
    const response=x.provider(url,init);
    if(req?.method==='add'&&String(url).endsWith('/campaigns')) { entered.release();return release.wait.then(()=>response); }
    return response;
  };
  x=fixture(t,{transport});await x.connect();x.plan();await x.action('prepare',{name:'Отключение'});
  const action=x.action('create');await entered.wait;
  const db2=openDatabase(x.dir);x.extraClosers.push(()=>db2.close());const manager2=createDirectConnections(db2,{clientId:'fixture-direct-app',clientSecret:'fixture',codec:createSecretCodec({platform:'linux',key:fixtureKey}),transport,mode:'fixture'});
  disconnectDirectFixture(db2,manager2,x.owner);assert.equal(db2.readDirectConnection(x.owner)!.status,'disconnected');
  assert.ok(db2.directBusy('10101'));await assert.rejects(x.action('create'));
  release.release();await assert.rejects(action,/Доступ отключён/);
  const state=db2.readDirect(x.owner)!;assert.equal(state.steps.campaign.id,'1001');assert.equal(state.steps.campaign.phase,'pending');assert.equal(state.complete,false);
  assert.equal(x.a.writes().length,1);assert.equal(x.a.calls.filter(c=>c.resource==='campaigns'&&c.method==='get').length,1);
  assert.equal(db2.readDirectConnection(x.owner)!.value.envelope,undefined);
  await x.connect();await x.action('refresh');assert.equal(x.db.readDirect(x.owner)!.steps.campaign.phase,'confirmed');assert.equal(x.a.writes().length,1);
});

test('E2-D02: disable после secret-await и до dispatch не вызывает transport', {timeout:15000},async t=>{
  let x:ReturnType<typeof fixture>,armed=false;const entered=barrier(),release=barrier(),base=createSecretCodec({platform:'linux',key:fixtureKey});
  const codec={protect:base.protect,async unprotect(value:any,context:string){const token=await base.unprotect(value,context);if(armed&&x.db.readDirect(x.owner)?.steps.campaign.phase==='pending'){armed=false;entered.release();await release.wait;}return token;}};
  x=fixture(t,{codec});await x.connect();x.plan();await x.action('prepare',{name:'Secret barrier'});armed=true;
  const action=x.action('create');await entered.wait;x.disconnect();release.release();await assert.rejects(action,/Доступ отключён/);
  assert.equal(x.a.writes().length,0);assert.equal(x.db.readDirectConnection(x.owner)!.status,'disconnected');assert.equal(x.db.readDirect(x.owner)!.attempts!.at(-1)!.outcome,'not_sent');
});

test('E2: plan/revision после await не применяется, минимальный budget, expiry и смена ClientID',async t=>{
  const x=fixture(t);await x.connect();x.plan(x.owner,{...e2Draft,budget:'1'});await assert.rejects(x.action('prepare',{name:'Мало'}),/не менее 350/);assert.equal(x.a.writes().length,0);
  const c=x.db.readDirectConnection(x.owner)!;x.db.setDirectConnection({...c,value:{...c.value,expiresAt:Date.now()-1}},c.generation);assert.equal(x.manager.resolve(x.owner),undefined);assert.equal(x.manager.view(x.owner,x.session,'').status,'expired');
  const manager=createDirectConnections(x.db,{clientId:'new-config',clientSecret:'fixture',codec:createSecretCodec({platform:'linux',key:fixtureKey}),transport:x.provider});assert.equal(manager.resolve(x.owner),undefined);
});

test('E2: новая конфигурация ClientID/client secret подключается без правки исходников',async t=>{
  const x=fixture(t);await x.connect();const oldGeneration=x.db.readDirectConnection(x.owner)!.generation;
  const next=e2Fixture(x.dir,{clientId:'fixture-app-two',clientSecret:'fixture-secret-two'});x.extraClosers.push(()=>next.db.close());await next.connect();
  assert.equal(x.manager.resolve(x.owner),undefined);assert.equal(next.manager.resolve(x.owner)!.account,'10101');assert.ok(next.db.readDirectConnection(x.owner)!.generation>oldGeneration);
  const rotated=e2Fixture(x.dir,{clientId:'fixture-app-two',clientSecret:'fixture-secret-three'});x.extraClosers.push(()=>rotated.db.close());await rotated.connect();assert.equal(rotated.manager.resolve(x.owner)!.account,'10101');assert.equal(x.a.writes().length+next.a.writes().length+rotated.a.writes().length,0);
});

test('E2: смена плана во время чтения справочника блокирует prepare до первого intent', {timeout:15000},async t=>{
  let x:ReturnType<typeof fixture>,armed=false;const entered=barrier(),release=barrier();
  const transport:typeof fetch=(url,init)=>{const response=x.provider(url,init),request=String(url).includes('/json/')?JSON.parse(String(init?.body)):undefined;if(armed&&request?.params?.DictionaryNames?.[0]==='Currencies'){armed=false;entered.release();return release.wait.then(()=>response);}return response;};
  x=fixture(t,{transport});await x.connect();x.plan();armed=true;const action=x.action('prepare',{name:'Старый план'});await entered.wait;
  x.db.saveCampaign(x.owner,{...e2Draft,budget:'8000'},x.db.readCampaign(x.owner)!.revision,'Другая вкладка');release.release();await assert.rejects(action,/План изменился/);assert.equal(x.db.readDirect(x.owner),undefined);assert.equal(x.a.writes().length,0);
});

test('E2-D02: замена токена во время write останавливает старый action и требует reconcile', {timeout:15000},async t=>{
  let x:ReturnType<typeof fixture>;const entered=barrier(),release=barrier();let first=true;
  const transport:typeof fetch=(url,init)=>{const response=x.provider(url,init),request=String(url).includes('/json/')?JSON.parse(String(init?.body)):undefined;if(first&&request?.method==='add'&&String(url).endsWith('/campaigns')){first=false;entered.release();return release.wait.then(()=>response);}return response;};
  x=fixture(t,{transport});await x.connect();x.plan();await x.action('prepare',{name:'Замена токена'});const action=x.action('create');await entered.wait;
  const old=x.db.readDirectConnection(x.owner)!.generation;await x.connect();assert.equal(x.db.readDirectConnection(x.owner)!.generation,old+1);assert.equal(x.manager.resolve(x.owner)!.needsReconcile,true);
  release.release();await assert.rejects(action,/Доступ отключён, истёк или изменился/);assert.equal(x.a.writes().length,1);await assert.rejects(x.action('create'),/Сначала сверить/);
  await x.action('refresh');await x.action('create');assert.equal(x.db.readDirect(x.owner)!.complete,true);assert.equal(x.a.writes().length,6);
});

test('E2: AES-GCM контекст, tamper, keyfile permissions и отсутствие секретов в UI/DB plaintext',async t=>{
  const x=fixture(t);await x.connect();const bytes=readFileSync(join(x.dir,'stage2.sqlite'));assert.equal(bytes.includes(Buffer.from('e2-fixture-a')),false);assert.equal(bytes.includes(Buffer.from('discard-this-fixture-refresh')),false);
  const codec=createSecretCodec({platform:'linux',key:fixtureKey}),envelope=await codec.protect('fictional-secret','owner-a');
  assert.equal(await codec.unprotect(envelope,'owner-a'),'fictional-secret');await assert.rejects(codec.unprotect(envelope,'owner-b'));await assert.rejects(codec.unprotect({...envelope,data:'AAAA'},'owner-a'));
  const html=renderDirectConnect(x.manager.view(x.owner,x.session,''));assert.doesNotMatch(html,/e2-fixture-a|fixture-app-secret|ciphertext|envelope|discard-this/);
  if(process.platform!=='win32'){const file=join(x.dir,'key');writeFileSync(file,fixtureKey,{mode:0o600});createSecretCodec({platform:'linux',keyFile:file});chmodSync(file,0o644);assert.throws(()=>createSecretCodec({platform:'linux',keyFile:file}),/владельца/);}
});

test('E2: v8→v9 переносит payload/unknown/Int64 без изменений, CAS и резервирование кабинета',t=>{
  const dir=directory(t),db=openDatabase(dir);db.close();const raw=new DatabaseSync(join(dir,'stage2.sqlite'));
  removeE3Schema(raw); raw.exec('DROP TABLE direct_runs; DROP TABLE direct_connections; DROP TABLE direct_accounts; DROP TABLE direct_connect_attempts; DROP TABLE direct_dispatches; CREATE TABLE direct_bindings(owner TEXT PRIMARY KEY,account TEXT UNIQUE,payload TEXT NOT NULL) STRICT; PRAGMA user_version=8;');
  const payload=JSON.stringify({account:'10101',planId:'legacy-run',steps:{campaign:{phase:'pending',id:'9000123400000000456'}},events:[],complete:false});raw.prepare('INSERT INTO direct_bindings VALUES(?,?,?)').run('local','10101',payload);raw.close();
  const migrated=openDatabase(dir);t.after(()=>{migrated.close();cleanup(dir);});const verify=new DatabaseSync(join(dir,'stage2.sqlite'));assert.equal(verify.prepare('SELECT payload FROM direct_runs').get()!.payload,payload);verify.close();
  const first=migrated.readDirect('local')!,second=migrated.readDirect('local')!;migrated.saveDirect('local',first);assert.throws(()=>migrated.saveDirect('local',second),/изменилась/);
  assert.equal(migrated.readDirect('yandex:101'),undefined);assert.equal(migrated.readDirectConnection('local')!.status,'disconnected');
});

test('E2-D02: другой процесс подтверждает disable до release транспорта и не снимает run-lock', {timeout:20000},async t=>{
  const dir=directory(t),child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/e2-process.ts',import.meta.url)),dir,'hold'],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true}),closed=once(child,'close');
  let db:ReturnType<typeof openDatabase>|undefined;
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;db?.close();cleanup(dir);});
  const [sent]=await once(child,'message',{signal:t.signal});assert.equal((sent as any).stage,'sent');
  db=openDatabase(dir);const manager=createDirectConnections(db,{clientId:'fixture-direct-app',clientSecret:'fixture',codec:createSecretCodec({platform:'linux',key:fixtureKey}),transport:async()=>{throw new Error('Parent must not send requests');}});
  disconnectDirectFixture(db,manager,'yandex:101');assert.equal(db.readDirectConnection('yandex:101')!.status,'disconnected');assert.equal(db.directBusy('10101'),true);assert.throws(()=>db!.lockDirect('10101'),/уже выполняется/);
  const resultMessage=once(child,'message',{signal:t.signal});child.send('release');const [result]=await resultMessage;await closed;
  assert.equal((result as any).writes,1);assert.equal((result as any).state.steps.campaign.id,'1001');assert.equal((result as any).state.steps.group.phase,'ready');assert.equal((result as any).connection.hasEnvelope,false);
  assert.equal(db.readDirect('yandex:202',(result as any).state.planId),undefined);
});

for(const mode of ['before','crash'])test(`E2-D02: crash ${mode} оставляет durable pending без допуска retry`, {timeout:20000},async t=>{
  const dir=directory(t),child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/e2-process.ts',import.meta.url)),dir,mode],{stdio:'pipe',windowsHide:true}),closed=once(child,'close');
  const [code]=await closed;assert.equal(code,mode==='before'?78:77);assert.match(readFileSync(join(dir,'crash-marker'),'utf8'),mode==='before'?/before-gate/:/after-send-before-commit/);
  const x=e2Fixture(dir);t.after(()=>{x.db.close();cleanup(dir);});const state=x.db.readDirect(x.owner)!;assert.equal(state.steps.campaign.phase,'pending');assert.equal(x.db.directDispatches(x.owner,state.planId).length,0);
  if(mode==='crash')Object.assign(x.a.records,JSON.parse(readFileSync(join(dir,'remote-records.json'),'utf8')));
  if(mode==='before')await assert.rejects(x.action('refresh'),/неизвестен/);else {await x.action('refresh');assert.equal(x.db.readDirect(x.owner)!.steps.campaign.phase,'confirmed');}
  assert.equal(x.a.writes().length,0);
});
