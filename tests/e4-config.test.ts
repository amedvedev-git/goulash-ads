import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { loadServerResearch, localResearchAccess } from '../src/research-config.ts';
import { createPreparationService } from '../src/preparation.ts';
import { openDatabase } from '../src/database.ts';
import { e1Input,e1Profile } from './fixtures/e1-scenario.ts';
import { e4Browser } from './fixtures/e4-browser.ts';
import { readProtectedFile } from '../src/protected-file.ts';
import { createServer } from 'node:http';
import { backendPage } from '../deploy/manage-release.ts';

test('локальный OAuth с ключами исследования разрешает расход только настроенному владельцу',()=>{
  const flags=['--wordstat','--phrase-ai','--connect-direct'];
  assert.throws(()=>localResearchAccess(true,flags,{}));
  assert.throws(()=>localResearchAccess(true,flags,{GOULASH_RESEARCH_OWNER:'local'}));
  const access=localResearchAccess(true,flags,{GOULASH_RESEARCH_OWNER:'yandex:101'})!;
  assert.equal(access('yandex:101'),true);
  assert.equal(access('yandex:202'),false);
  assert.equal(localResearchAccess(false,flags,{}),undefined);
});

test('E4 server research: default off/no secret read, invalid enable/owner/flags, same adapters on protected fixture credentials',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'e4-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  assert.equal(loadServerResearch(true,[],{CREDENTIALS_DIRECTORY:'/absent'}).allowed('yandex:101'),false);
  assert.throws(()=>loadServerResearch(true,[],{GOULASH_RESEARCH_ENABLED:'yes'}));
  const env={CREDENTIALS_DIRECTORY:dir,GOULASH_RESEARCH_ENABLED:'1',GOULASH_RESEARCH_OWNER:'yandex:101',GOULASH_RESEARCH_CONFIG_VERSION:'v2',GOULASH_WORDSTAT_FOLDER:'fictional-folder'};
  assert.throws(()=>loadServerResearch(false,['--wordstat','--phrase-ai'],env));assert.throws(()=>loadServerResearch(true,['--phrase-ai'],env));
  assert.throws(()=>loadServerResearch(true,['--wordstat','--phrase-ai'],{...env,GOULASH_RESEARCH_OWNER:'local'}));
  for(const name of ['wordstat_api_key','phrase_ai_key'])writeFileSync(join(dir,name),'fictional-key',{mode:0o600});
  const calls:any[]=[];const request:typeof fetch=async(url,init)=>{const body=JSON.parse(String(init?.body));calls.push({url:String(url),body});
    if(String(url).includes('wordstat'))return Response.json({results:[{phrase:'ремонт холодильников',count:'120'}]});
    return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify(e1Profile)}}]});};
  const configured=loadServerResearch(true,['--wordstat','--phrase-ai'],env,request);assert.equal(calls.length,0);assert.equal(configured.allowed('yandex:101'),true);assert.equal(configured.allowed('yandex:202'),false);
  assert.equal((await configured.wordstat!('ремонт холодильников','54'))[0].count,'120');await configured.intelligence!.profile(e1Input);
  assert.equal(calls.length,2);assert.equal(calls[1].body.model,'deepseek-flash');assert.equal(calls[1].body.max_tokens,1800);
  if(process.platform!=='win32'){chmodSync(join(dir,'phrase_ai_key'),0o644);assert.throws(()=>loadServerResearch(true,['--wordstat','--phrase-ai'],env,request),/владельц/);}
});

test('серверный режим ИИ для всех требует вход и открывает только DeepSeek', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'e4-ai-all-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'phrase_ai_key'), 'fictional-key', { mode: 0o600 });
  const env = { CREDENTIALS_DIRECTORY: dir, GOULASH_RESEARCH_ENABLED: 'ai-all' };
  assert.throws(() => loadServerResearch(false, [], env), /Яндекс ID/);
  const calls: string[] = [];
  const ai = loadServerResearch(true, [], env, async url => {
    calls.push(String(url));
    return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(e1Profile) } }] });
  });
  assert.equal(ai.allowed('yandex:101'), true);
  assert.equal(ai.allowed('yandex:202'), true);
  assert.equal(ai.allowed('local'), false);
  assert.equal(ai.wordstat, undefined);
  assert.deepEqual(calls, []);
  await ai.intelligence!.profile(e1Input);
  assert.deepEqual(calls, ['https://api.deepseek.com/chat/completions']);
  assert.equal(loadServerResearch(true, [], { GOULASH_RESEARCH_ENABLED: '0' }).allowed('yandex:101'), false);
});

test('E4-HEALTH-01: backend health preserves exact public Host and does not follow redirects',async t=>{
  const server=createServer((req,res)=>{if(req.headers.host==='timeout.invalid')return;if(req.headers.host==='error.invalid')return res.writeHead(500).end('fixture error');if(req.headers.host!=='e4-fixture.invalid')return res.writeHead(400).end('wrong authority');res.writeHead(302,{Location:'https://never-contact.invalid'}).end('fixture');});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise<void>(r=>server.close(()=>r())));
  const result=await backendPage('127.0.0.1',(server.address() as any).port,'e4-fixture.invalid');assert.deepEqual(result,{status:302,body:'fixture'});
  assert.equal((await backendPage('127.0.0.1',(server.address() as any).port,'wrong.invalid')).status,400);
  assert.equal((await backendPage('127.0.0.1',(server.address() as any).port,'error.invalid')).status,500);
  await assert.rejects(backendPage('127.0.0.1',(server.address() as any).port,'timeout.invalid'),/timeout/);
});

test('E4-CRED-01 negative: 0440 arbitrary files/env prefix, symlink and world/group writes do not get the systemd exception',{skip:process.platform==='win32'},t=>{
  const dir=mkdtempSync(join(tmpdir(),'e4-credentials-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'key');writeFileSync(file,Buffer.alloc(32,7),{mode:0o600});
  assert.equal(readProtectedFile(file).length,32);chmodSync(file,0o440);assert.throws(()=>readProtectedFile(file));assert.throws(()=>readProtectedFile(file,dir));
  const prior=process.env.CREDENTIALS_DIRECTORY,invocation=process.env.INVOCATION_ID;process.env.CREDENTIALS_DIRECTORY=dir;process.env.INVOCATION_ID='a'.repeat(32);
  try{assert.throws(()=>readProtectedFile(file,dir));chmodSync(file,0o660);assert.throws(()=>readProtectedFile(file,dir));chmodSync(file,0o604);assert.throws(()=>readProtectedFile(file,dir));chmodSync(file,0o600);symlinkSync(file,join(dir,'link'));assert.throws(()=>readProtectedFile(join(dir,'link'),dir));}
  finally{if(prior===undefined)delete process.env.CREDENTIALS_DIRECTORY;else process.env.CREDENTIALS_DIRECTORY=prior;if(invocation===undefined)delete process.env.INVOCATION_ID;else process.env.INVOCATION_ID=invocation;}
});

test('E4 service owner gate rejects all dispatch-capable POSTs before intent, preserves manual preparation and per-action consent',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'e4-gate-')),db=openDatabase(dir);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});let calls=0;
  const ai={profile:async()=>{calls++;return structuredClone(e1Profile);},judge:async()=>{calls++;return [];}};
  const service=createPreparationService(db,ai,async()=>{calls++;return [];},async()=>[],{},owner=>owner==='yandex:101');
  for(const action of ['profile','research','continue-research','rejudge','recover-rejudge'])assert.equal((await service.action('yandex:202',action,new URLSearchParams(),'test')).status,403);
  assert.equal(service.view('yandex:202').ai,false);assert.equal(db.readRuns('yandex:202').length,0);
  const act=(action:string,fields:Record<string,string>={})=>service.action('yandex:101',action,new URLSearchParams({preparationRevision:String(service.view('yandex:101').saved.revision),...fields}),'fixture');
  assert.equal((await act('entry',e1Input)).status,200);assert.equal((await act('profile')).status,400);assert.equal(calls,0);
  assert.equal((await act('profile',{aiConsent:'yes'})).status,200);assert.equal(calls,1);await act('profile',{aiConsent:'yes'});assert.equal(calls,1);
  assert.equal((await service.action('yandex:202','save',new URLSearchParams({preparationRevision:'0',description:'Ручной текст'}),'test')).status,200);
});

test('E4 empty HTTP fixture: no seeded plans/runs, foreign direct POSTs and legacy research have no dispatch',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'e4-http-')),x=e4Browser(dir);x.server.listen(0,'127.0.0.1');await once(x.server,'listening');
  t.after(async()=>{await new Promise<void>(r=>x.server.close(()=>r()));x.db.close();rmSync(dir,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${(x.server.address() as any).port}`;
  assert.equal(x.db.readPlans(x.owner).length,0);assert.equal(x.db.readDirectRuns(x.owner).length,0);
  const cookie=(await fetch(origin+'/fixture-login/b',{redirect:'manual'})).headers.get('set-cookie')!.split(';')[0];
  for(const action of ['profile','research','continue-research','rejudge','recover-rejudge']){
    const r=await fetch(origin+'/preparation/'+action,{method:'POST',headers:{Cookie:cookie,Origin:origin},body:new URLSearchParams({preparationRevision:'0',aiConsent:'yes',researchConsent:'yes',judgeConsent:'yes',rejudgeConsent:'yes'})});assert.equal(r.status,403);
  }
  await fetch(origin+'/',{headers:{Cookie:cookie}});assert.deepEqual(x.counts,{profile:0,wordstat:0,judge:0});assert.equal(x.a.writes().length,0);
});
