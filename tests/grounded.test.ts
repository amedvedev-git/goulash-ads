import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundedPayload, groundedFacts, groundedIssues, validateGrounded, groundedVersion, policyHash } from '../src/phrase-policy.ts';
import { createPhraseIntelligence } from '../src/phrase-intelligence.ts';
import { qualityCases } from './fixtures/phrase-quality.ts';
import { fixtureGrounded } from './fixtures/grounded.ts';
import { grantedJudge, savedGrantResponse } from '../src/judge-grant.ts';
import { hash } from '../src/campaign-plan.ts';
import { spawn } from 'node:child_process';
const sample=qualityCases[0], candidates=[{id:'a',phrase:'суши рис и ролл заказать'}];
const payload=()=>groundedPayload(sample.draft,sample.profile,candidates);
test('DR03-I1: own-brand-only не заменяет положительный факт предложения',()=>{
  const p=payload(),response=fixtureGrounded(sample.profile,candidates),row=response.judgments[0];
  row.support.factRefs=['own:0'];assert.ok(groundedIssues(validateGrounded(response,p).judgments[0],p.input.facts).length);
  row.support.factRefs=['sushi:offer','own:0'];assert.deepEqual(groundedIssues(validateGrounded(response,p).judgments[0],p.input.facts),[]);
  assert.equal(p.input.facts.find(f=>f.id==='sushi:kind')!.quote,sample.profile.offers[0].evidence);
});
test('grounded: синоним не требует покрытия всех слов; manufactured restriction нельзя выдать за equivalent',()=>{
  const s=qualityCases[1],c=[{id:'a',phrase:'холодильник не охлаждает нужен мастер'}],p=groundedPayload(s.draft,s.profile,c),response=fixtureGrounded(s.profile,c);
  assert.deepEqual(groundedIssues(validateGrounded(response,p).judgments[0],p.input.facts),[]);
  const query=[{id:'a',phrase:'ремонт холодильников велоракс'}],p2=groundedPayload(s.draft,s.profile,query),r2=fixtureGrounded(s.profile,query);
  r2.judgments[0].qualifiers=[{text:'велоракс',kind:'manufacturer',role:'product',basis:'equivalent',factRefs:['repair:offer']}];
  assert.ok(groundedIssues(validateGrounded(r2,p2).judgments[0],p2.input.facts).length);
  r2.judgments[0].qualifiers[0].role='attribute';assert.ok(groundedIssues(r2.judgments[0],p2.input.facts).length);
});
test('grounded: выдуманные refs, subword span, повторные ID, неполный ответ и legacy отвергаются',()=>{
  const p=payload(),valid=fixtureGrounded(sample.profile,candidates);
  for(const mutate of [r=>r.judgments[0].support.factRefs=['rolls:offer'],r=>r.judgments[0].qualifiers=[{text:'рол',kind:'brand',role:'own',basis:'fact',factRefs:['own:0']}],r=>r.judgments=[],r=>delete r.schemaVersion,r=>r.judgments.push(r.judgments[0])]){
    const value=structuredClone(valid);mutate(value);assert.throws(()=>validateGrounded(value,p));
  }
});
test('grounded facts: отрицательный контекст не становится фактом, seed/alias не добавляют марки',()=>{
  const s=qualityCases[1],profile=structuredClone(s.profile);profile.offers[0].evidence='ремонт холодильников';profile.offers[0].seeds=['ремонт холодильников велоракс'];
  assert.equal(groundedFacts({...s.draft,description:'Не предлагаем ремонт холодильников.'},profile).length,0);
  assert.ok(!JSON.stringify(groundedFacts(s.draft,s.profile)).includes('велоракс'));
  const full=structuredClone(profile);full.offers[0].evidence='Ремонт холодильников.';assert.ok(groundedFacts({...s.draft,description:'Ремонт холодильников. Не продаём телевизоры.'},full).some(f=>f.kind==='offer')); 
});
test('grounded adapter: exact production body,120s/bytes/finish_reason, raw response сохранён до rejection',async()=>{
  let body:any,meta:any;const response=fixtureGrounded(sample.profile,candidates);
  const ai=createPhraseIntelligence('fixture',async(_url,init)=>{body=JSON.parse(String(init!.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}],model:'actual-fixture',usage:{completion_tokens:1}}));});
  assert.deepEqual(await ai.groundedJudge!(sample.draft,sample.profile,candidates,m=>meta={...meta,...m}),response);assert.deepEqual(body,payload().body);assert.equal(meta.rawResponse,JSON.stringify(response));
  const cut=createPhraseIntelligence('fixture',async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"judgments":['}}],usage:{completion_tokens:5}})));
  await assert.rejects(cut.groundedJudge!(sample.draft,sample.profile,candidates,m=>meta={...meta,...m}),/неполный/);assert.equal(meta.rawResponse,'{"judgments":[');
  const huge=createPhraseIntelligence('fixture',async()=>new Response('x'.repeat(262145)));await assert.rejects(huge.groundedJudge!(sample.draft,sample.profile,candidates),/большой/);
  const eighty=Array.from({length:80},(_,i)=>({id:String(i),phrase:'заказать суши'}));assert.equal(groundedPayload(sample.draft,sample.profile,eighty).max_tokens,12000);
});
test('grant: два процесса/повтор/unknown не резервируют второй call, payload должен быть точным',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'judge-grant-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'approval.json'),p=payload(),preview={calls:[{slot:'B1',payload:p}]};writeFileSync(path,JSON.stringify({approved:true,previewHash:hash(preview),allowedSlots:['B1']}));
  let calls=0,release!:()=>void;const first=grantedJudge(path,preview,'B1',p,async()=>{calls++;await new Promise<void>(r=>release=r);throw new Error('unknown');});
  await assert.rejects(grantedJudge(path,preview,'B1',p,async()=>{calls++;}),/уже использован/);release();await assert.rejects(first,/unknown/);
  await assert.rejects(grantedJudge(path,preview,'B1',p,async()=>{calls++;}),/уже использован/);assert.equal(calls,1);
  const ledger=JSON.parse(readFileSync(path+'.ledger.json','utf8'));assert.equal(ledger.calls[0].status,'unknown');
  await assert.rejects(grantedJudge(path,preview,'B1',{...p,payloadHash:'changed'},async()=>{calls++;}),/не соответствует/);
});
test('grant: полный response+metadata атомарно переживают потерю caller-file и повторный запуск',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'judge-received-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'approval.json'),p=payload(),preview={calls:[{slot:'B1',payload:p}]},response=fixtureGrounded(sample.profile,candidates),metadata={model:'FIXTURE',usage:{completion_tokens:10}};
  writeFileSync(path,JSON.stringify({approved:true,previewHash:hash(preview),allowedSlots:['B1']}));
  await grantedJudge(path,preview,'B1',p,async()=>response,()=>metadata);
  const saved=savedGrantResponse(path,preview,'B1',p)!;assert.deepEqual(saved.response,response);assert.deepEqual(saved.metadata,metadata);
  const ledger=JSON.parse(readFileSync(path+'.ledger.json','utf8'));ledger.calls[0].response.judgments[0].reason='tampered';writeFileSync(path+'.ledger.json',JSON.stringify(ledger));
  assert.throws(()=>savedGrantResponse(path,preview,'B1',p),/полного подтверждённого/);
});
test('grant: два настоящих процесса резервируют один слот ровно один раз',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'judge-process-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const approval=join(dir,'approval.json'),previewFile=join(dir,'preview.json'),counter=join(dir,'sent.txt'),p=payload(),preview={calls:[{slot:'B1',payload:p}]};
  writeFileSync(approval,JSON.stringify({approved:true,previewHash:hash(preview),allowedSlots:['B1']}));writeFileSync(previewFile,JSON.stringify(preview));
  const moduleUrl=new URL('../src/judge-grant.ts',import.meta.url).href;
  const code=`import {readFileSync,appendFileSync} from 'node:fs';import {grantedJudge} from ${JSON.stringify(moduleUrl)};const p=JSON.parse(readFileSync(process.argv[2],'utf8'));try{await grantedJudge(process.argv[1],p,'B1',p.calls[0].payload,async()=>{appendFileSync(process.argv[3],'sent\\n');await new Promise(r=>setTimeout(r,200));return {ok:true};});}catch(e){if(!e.notSent)throw e;}`;
  const run=()=>new Promise<void>((done,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code,approval,previewFile,counter],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',data=>error+=data);child.on('exit',code=>code===0?done():reject(new Error(error)));});
  await Promise.all([run(),run()]);assert.equal(readFileSync(counter,'utf8'),'sent\n');
});
