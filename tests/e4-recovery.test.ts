import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupRecovery, restoreRecovery } from '../deploy/backup-restore.ts';
import { inspectDatabase, inventory, update } from '../deploy/manage-release.ts';
import { stageRelease } from '../scripts/Build-SelectelPackage.ts';
import { previousFixture } from './fixtures/e4-deployment.ts';
import { openDatabase } from '../src/database.ts';
import { createSecretCodec, metrikaSecretContext } from '../src/direct-secrets.ts';

async function fixture(t:test.TestContext){
  const root=mkdtempSync(join(tmpdir(),'e4-recovery-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const old=await previousFixture(10,join(root,'old')),credentials=join(root,'credentials'),configuration=join(root,'configuration');
  mkdirSync(credentials,{mode:0o700});mkdirSync(configuration,{mode:0o700});
  writeFileSync(join(credentials,'direct_token_key'),Buffer.alloc(32,71),{mode:0o600});
  writeFileSync(join(credentials,'yandex_client_secret'),'fictional-short-secret',{mode:0o600});
  writeFileSync(join(configuration,'runtime.conf'),'[Service]\nEnvironment=GOULASH_RESEARCH_ENABLED=0\n',{mode:0o600});
  return {root,old,credentials,configuration};
}

test('восстановление возвращает рабочую и учебную базы с их собственными записями',async t=>{
  const x=await fixture(t),backup=join(x.root,'backup'),restored=join(x.root,'restored');
  const pilot=openDatabase(join(x.old.data,'pilot-demo'));
  pilot.write('local','Учебная кампания после остановки');pilot.close();
  const receipt=await backupRecovery(x.old.app,x.old.data,x.credentials,backup);
  assert.equal(receipt.format,3);assert.equal(receipt.pilotSchema,11);
  await restoreRecovery(backup,restored);
  const outcome=openDatabase(join(restored,'data','pilot-demo'));
  try { assert.equal(outcome.read('local'),'Учебная кампания после остановки'); } finally { outcome.close(); }
  assert.deepEqual(inspectDatabase(join(restored,'data/stage2.sqlite')),inspectDatabase(join(x.old.data,'stage2.sqlite')));
  writeFileSync(join(backup,'pilot.sqlite'),'corrupt');
  await assert.rejects(restoreRecovery(backup,join(x.root,'second')),/integrity/);
  assert.equal(existsSync(join(x.root,'second')),false);
});

test('E4-T02: complete private seal + active/candidate AES matching, format1 unsupported and rejected before destination writes',async t=>{
  const x=await fixture(t),backup=join(x.root,'backup'),before=inspectDatabase(join(x.old.data,'stage2.sqlite'));
  const result=await backupRecovery(x.old.app,x.old.data,x.credentials,backup,x.configuration);assert.equal(result.format,2);assert.equal(result.verifiedDirectEnvelopes,2);
  const metadata=JSON.parse(readFileSync(join(backup,'recovery.json'),'utf8'));
  assert.equal(readFileSync(join(backup,'recovery.json'),'utf8').includes('fictional-short-secret'),false);
  assert.equal(Object.hasOwn(metadata,'credentialsHashes'),false);assert.equal(Object.hasOwn(metadata,'configurationHashes'),false);
  assert.equal(Object.hasOwn(metadata,'metrikaEnvelopes'),false,'legacy format-2 metadata omits the Metrika envelope count');
  const restored=join(x.root,'restored');await restoreRecovery(backup,restored);assert.deepEqual(inspectDatabase(join(restored,'data/stage2.sqlite')),before);
  assert.deepEqual(inventory(join(restored,'app')),x.old.code);assert.deepEqual(readFileSync(join(restored,'credentials/direct_token_key')),Buffer.alloc(32,71));
  assert.equal(readFileSync(join(restored,'configuration/runtime.conf'),'utf8'),readFileSync(join(x.configuration,'runtime.conf'),'utf8'));
  const changes:Record<string,(dir:string)=>void>={
    wrongAES:dir=>writeFileSync(join(dir,'credentials/direct_token_key'),Buffer.alloc(32,72)),
    missingAES:dir=>rmSync(join(dir,'credentials/direct_token_key')),
    wrongSecret:dir=>writeFileSync(join(dir,'credentials/yandex_client_secret'),'different-fictional-secret'),
    missingSecret:dir=>rmSync(join(dir,'credentials/yandex_client_secret')),
    addedCredential:dir=>writeFileSync(join(dir,'credentials/new-file'),'fixture'),
    changedConfiguration:dir=>writeFileSync(join(dir,'configuration/runtime.conf'),'changed'),
    missingConfiguration:dir=>rmSync(join(dir,'configuration/runtime.conf')),
    missingConfigurationDirectory:dir=>rmSync(join(dir,'configuration'),{recursive:true}),
    missingSealKey:dir=>rmSync(join(dir,'.recovery-seal-key')),
    wrongSealKey:dir=>writeFileSync(join(dir,'.recovery-seal-key'),Buffer.alloc(32,12)),
    metadataSplice:dir=>{const value=JSON.parse(readFileSync(join(dir,'recovery.json'),'utf8'));value.recoveryId='other-recovery';writeFileSync(join(dir,'recovery.json'),JSON.stringify(value));},
    legacyFormat:dir=>{const value=JSON.parse(readFileSync(join(dir,'recovery.json'),'utf8'));value.format=1;writeFileSync(join(dir,'recovery.json'),JSON.stringify(value));},
  };
  for(const [name,change] of Object.entries(changes)){
    const altered=join(x.root,name),destination=join(x.root,'out-'+name);cpSync(backup,altered,{recursive:true});change(altered);
    await assert.rejects(restoreRecovery(altered,destination),/Recovery|recovery/);assert.equal(existsSync(destination),false,name);
  }
  assert.deepEqual(inspectDatabase(join(x.old.data,'stage2.sqlite')),before,'negative restores never overwrite original working data');
  assert.deepEqual(readFileSync(join(x.credentials,'direct_token_key')),Buffer.alloc(32,71));
});

test('E4-T02: wrong original key cannot create an apparently matching backup',async t=>{
  const x=await fixture(t),destination=join(x.root,'bad-backup');writeFileSync(join(x.credentials,'direct_token_key'),Buffer.alloc(32,72));
  await assert.rejects(backupRecovery(x.old.app,x.old.data,x.credentials,destination,x.configuration),/AES key/);assert.equal(existsSync(destination),false);
});

test('recovery: Metrika envelope binds owner, app and connection to the dedicated AES key', async t => {
  const x = await fixture(t);
  const key = Buffer.alloc(32, 84), keyFile = join(x.credentials, 'metrika_oauth_key');
  writeFileSync(keyFile, key, { mode: 0o600 });
  const secret = 'synthetic-metrika-access', owner = 'yandex:101';
  const clientId = 'synthetic-metrika-app', connectionId = 'synthetic-connection';
  const codec = createSecretCodec({ platform: 'linux', key });
  const envelope = await codec.protect(secret, metrikaSecretContext(owner, clientId, connectionId));
  const grant = { clientId, connectionId, envelope, expiresAt: Date.now() - 1 };
  const db = openDatabase(x.old.data);
  try {
    const existing = db.readAnalyticsSettings(owner);
    db.saveAnalyticsSettings(owner, { ...existing, metrikaEnabled: true, metrikaConfigId: connectionId, metrikaOAuth: grant }, existing.revision);
    const removed = db.readAnalyticsSettings('yandex:202');
    db.saveAnalyticsSettings('yandex:202', { ...removed, metrikaOAuth: { clientId, connectionId: 'removed' } }, removed.revision);
  } finally { db.close(); }

  const backup = join(x.root, 'metrika-backup'), output = join(x.root, 'metrika-restore');
  const result = await backupRecovery(x.old.app, x.old.data, x.credentials, backup);
  assert.equal(result.schema, 11);
  assert.equal(result.verifiedDirectEnvelopes, 2);
  assert.equal(result.verifiedMetrikaEnvelopes, 1);
  const metadata = readFileSync(join(backup, 'recovery.json'), 'utf8');
  assert.equal(JSON.parse(metadata).metrikaEnvelopes, 1);
  assert.equal(metadata.includes(secret), false);
  await restoreRecovery(backup, output);
  assert.deepEqual(readFileSync(join(output, 'credentials', 'metrika_oauth_key')), key);
  const restored = openDatabase(join(output, 'data'));
  try { assert.deepEqual(restored.readAnalyticsSettings(owner).metrikaOAuth, grant); }
  finally { restored.close(); }

  writeFileSync(keyFile, Buffer.alloc(32, 85));
  const wrongKey = join(x.root, 'wrong-metrika-key');
  await assert.rejects(backupRecovery(x.old.app, x.old.data, x.credentials, wrongKey), /AES key/);
  assert.equal(existsSync(wrongKey), false);
  writeFileSync(keyFile, key);

  const source = openDatabase(x.old.data), wrongOwner = 'yandex:303';
  try {
    const previous = source.readAnalyticsSettings(wrongOwner);
    source.saveAnalyticsSettings(wrongOwner, { ...previous, metrikaOAuth: grant }, previous.revision);
  } finally { source.close(); }
  const transferred = join(x.root, 'wrong-metrika-owner');
  await assert.rejects(backupRecovery(x.old.app, x.old.data, x.credentials, transferred), /AES key/);
  assert.equal(existsSync(transferred), false);
});

test('E4-T01: ordinary and nested symlinks remain rejected',{skip:process.platform==='win32'},async t=>{
  const x=await fixture(t),alias=join(x.root,'alias');symlinkSync(x.old.data,alias,'dir');
  await assert.rejects(backupRecovery(x.old.app,alias,x.credentials,join(x.root,'bad-link'),x.configuration));assert.equal(existsSync(join(x.root,'bad-link')),false);
  symlinkSync(join(x.configuration,'runtime.conf'),join(x.old.data,'nested-link'));
  await assert.rejects(backupRecovery(x.old.app,x.old.data,x.credentials,join(x.root,'bad-nested'),x.configuration),/Symlinks/);
  assert.equal(existsSync(join(x.root,'bad-nested')),false);
});

test('E4-T02: recovery tool and minimal crypto dependencies survive deletion of the upload directory',async t=>{
  const x=await fixture(t),root=join(x.root,'installed'),candidate=join(x.root,'upload');mkdirSync(root);cpSync(x.old.app,join(root,'app'),{recursive:true});stageRelease(candidate);
  const host={async checkBefore(){},async stop(){},async start(){},async health(){}};
  await update({root,data:x.old.data,backups:join(x.root,'updates'),node:process.execPath},host,candidate);rmSync(candidate,{recursive:true});
  const tools=await import(pathToFileURL(join(root,'tools/deploy/backup-restore.ts')).href);
  const backup=join(x.root,'tool-backup');await tools.backupRecovery(join(root,'app'),x.old.data,x.credentials,backup,x.configuration);
  await tools.restoreRecovery(backup,join(x.root,'tool-restore'));
});
