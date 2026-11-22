import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stageRelease } from '../scripts/Build-SelectelPackage.ts';
import { inspectDatabase, inventory, update, rollback, verifyRelease, sha256 } from '../deploy/manage-release.ts';
import { backupRecovery, restoreRecovery } from '../deploy/backup-restore.ts';
import { prepareClean } from '../deploy/install-clean.ts';
import { defaults, readDeploymentConfig } from '../deploy/config.ts';
import { previousFixture } from './fixtures/e4-deployment.ts';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { rotateDirectKey } from '../deploy/rotate-direct-key.ts';
const host={async checkBefore(){},async stop(){},async start(){},async health(){}};
function directory(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'e4-deploy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

for(const schema of [9,10] as const)test(`E4 package ${schema}->11->${schema}: genuine prior code, rows, active/candidate envelopes, restart-independent rollback`,{timeout:90_000},async t=>{
  const dir=directory(t),old=await previousFixture(schema,join(dir,'old')),candidate=join(dir,'candidate');stageRelease(candidate);
  const paths={root:join(dir,'root'),data:old.data,backups:join(dir,'backups'),node:process.execPath};mkdirSync(paths.root); 
  const {renameSync}=await import('node:fs');renameSync(old.app,join(paths.root,'app'));const before=inspectDatabase(join(old.data,'stage2.sqlite'));
  const started=performance.now();
  assert.equal(before.schema,schema);const result=await update(paths,host,candidate);assert.equal(result.status,'installed');assert.equal(inspectDatabase(join(old.data,'stage2.sqlite')).schema,11);
  t.diagnostic('Обновление схемы ' + schema + ' → 11: ' + Math.round(performance.now() - started) + ' мс; лимит сценария 90000 мс.');
  assert.equal((await update(paths,host,candidate)).status,'already-installed');
  const rollbackStart=performance.now();await rollback(paths,host);
  t.diagnostic('Откат к схеме ' + schema + ': ' + Math.round(performance.now() - rollbackStart) + ' мс.');
  assert.deepEqual(inspectDatabase(join(old.data,'stage2.sqlite')),before);assert.deepEqual(inventory(join(paths.root,'app')),old.code);
});

test('E4 recovery: WAL-aware backup, exact code/DB/config/keys restored only into new destination, tamper denied',async t=>{
  const dir=directory(t),old=await previousFixture(10,join(dir,'old')),credentials=join(dir,'credentials'),configuration=join(dir,'configuration');mkdirSync(credentials);mkdirSync(configuration);
  writeFileSync(join(credentials,'direct_token_key'),Buffer.alloc(32,71),{mode:0o600});writeFileSync(join(configuration,'unit.conf'),'fictional-config',{mode:0o600});
  const db=new DatabaseSync(join(old.data,'stage2.sqlite'));db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO test_records VALUES('wal-fixture','in-wal');");
  const before=inspectDatabase(join(old.data,'stage2.sqlite')),backup=join(dir,'recovery');await backupRecovery(old.app,old.data,credentials,backup,configuration);db.close();
  const restored=join(dir,'restored');await restoreRecovery(backup,restored);
  assert.deepEqual(inspectDatabase(join(restored,'data/stage2.sqlite')),before);assert.deepEqual(inventory(join(restored,'app')),old.code);
  assert.deepEqual(readFileSync(join(restored,'credentials/direct_token_key')),Buffer.alloc(32,71));assert.equal(readFileSync(join(restored,'configuration/unit.conf'),'utf8'),'fictional-config');
  if(process.platform!=='win32'){assert.equal(statSync(restored).mode&0o777,0o700);assert.equal(statSync(join(restored,'app/src')).mode&0o777,0o755);assert.equal(statSync(join(restored,'credentials')).mode&0o777,0o700);assert.equal(statSync(join(restored,'data/stage2.sqlite')).mode&0o777,0o600);}
  await assert.rejects(restoreRecovery(backup,restored),/must be new/);writeFileSync(join(backup,'before.sqlite'),'broken');await assert.rejects(restoreRecovery(backup,join(dir,'tampered')),/integrity/);
});

test('E4 clean staging uses complete verified manifest and refuses existing app/data; topology is data, not source edits',t=>{
  const dir=directory(t),candidate=join(dir,'candidate');const release=stageRelease(candidate),root=join(dir,'root');
  const c={...defaults,root,data:join(dir,'data')};const mask=process.umask(0o077);try{assert.equal(prepareClean(candidate,c).releaseId,release.releaseId);}finally{process.umask(mask);}
  if(process.platform!=='win32')for(const path of [root,join(root,'app'),join(root,'app/src'),join(root,'app/src/assets')])assert.equal(statSync(path).mode&0o777,0o755,'E4-CLEAN-01: code dirs remain readable with wrapper umask077');
  assert.ok(inventory(join(root,'app'))['src/research-config.ts']);assert.throws(()=>prepareClean(candidate,c),/absent/);
  const config=join(dir,'deployment.json');writeFileSync(config,JSON.stringify({publicOrigin:'https://e4.invalid',suppliersOrigin:'https://suppliers.e4.invalid'}));
  assert.equal(readDeploymentConfig(config).suppliersOrigin,'https://suppliers.e4.invalid');
  writeFileSync(config,JSON.stringify({publicOrigin:'https://e4.invalid'}));assert.equal(readDeploymentConfig(config).suppliersOrigin,'');
  assert.equal(readDeploymentConfig(config).publicOrigin,'https://e4.invalid');writeFileSync(config,JSON.stringify({publicOrigin:'http://bad.invalid'}));assert.throws(()=>readDeploymentConfig(config));
});

test('E4-D01 freeze/build receipt: metadata comes from frozen input; external final receipt does not change source/runtime; additions rejected',t=>{
  const dir=directory(t),source=join(dir,'source'),stage=join(dir,'stage');stageRelease(source);rmSync(join(source,'release.json'));
  const source_files=inventory(source),candidate={head:'0'.repeat(40),source_dirty:true,source_files},before=JSON.stringify(source_files);
  const manifest=stageRelease(stage,{source,candidate});assert.equal(manifest.sourceCommit,'0'.repeat(40));assert.equal(manifest.sourceDirty,true);
  const receipt=join(dir,'DELIVERY-MANIFEST.json');writeFileSync(receipt,JSON.stringify({candidateManifestSha256:sha256(JSON.stringify(candidate)),releaseId:manifest.releaseId}));
  assert.equal(JSON.stringify(inventory(source)),before);assert.equal(verifyRelease(stage).releaseId,manifest.releaseId);assert.ok(!Object.hasOwn(manifest.files,'DELIVERY-MANIFEST.json'));
  writeFileSync(join(source,'DELIVERY-MANIFEST.json'),'old receipt');assert.throws(()=>stageRelease(join(dir,'bad'),{source,candidate}),/inventory mismatch/);
});

for(const schema of [9,10] as const)test(`E4 Linux actual AES rotation schema${schema}: active/candidate, dry-run, paired old-key restore`,{skip:process.platform!=='linux'},async t=>{
  const dir=directory(t),old=await previousFixture(schema,join(dir,'old')),oldKey=join(dir,'old-key'),newKey=join(dir,'new-key'),backup=join(dir,'before.sqlite');
  writeFileSync(oldKey,Buffer.alloc(32,71),{mode:0o600});writeFileSync(newKey,Buffer.alloc(32,72),{mode:0o600});
  const before=readFileSync(join(old.data,'stage2.sqlite'));assert.equal((await rotateDirectKey(old.data,oldKey,newKey,backup)).applied,false);assert.deepEqual(readFileSync(join(old.data,'stage2.sqlite')),before);
  assert.equal((await rotateDirectKey(old.data,oldKey,newKey,backup,true)).changed,1);
  const verify=async(file:string,keyFile:string)=>{const db=new DatabaseSync(file,{readOnly:true}),row=db.prepare('SELECT generation,payload FROM direct_connections').get()!,p=JSON.parse(String(row.payload));db.close();const codec=createSecretCodec({keyFile});
    assert.equal(await codec.unprotect(p.envelope,JSON.stringify([old.owner,p.clientId,row.generation])),'synthetic-active');
    assert.equal(await codec.unprotect(p.candidate.envelope,JSON.stringify([old.owner,p.candidate.clientId,p.candidate.generation+1])),'synthetic-candidate');};
  await verify(join(old.data,'stage2.sqlite'),newKey);await verify(backup,oldKey);await assert.rejects(verify(join(old.data,'stage2.sqlite'),oldKey));
});
