import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inventory, inspectDatabase, sha256, snapshotDatabase } from './manage-release.ts';
import { readDeploymentConfig } from './config.ts';
import { createSecretCodec, metrikaSecretContext } from '../src/direct-secrets.ts';
import { readProtectedFile } from '../src/protected-file.ts';

function regularFiles(directory: string, prefix = ''): string[] {
  const root=lstatSync(directory);
  if(!root.isDirectory()||root.isSymbolicLink())throw new Error('Expected regular recovery source directories.');
  const files:string[]=[];
  for(const name of readdirSync(directory).sort()){
    const file=join(directory,name),stat=lstatSync(file),key=prefix+name;
    if(stat.isSymbolicLink())throw new Error('Symlinks inside recovery data are not supported.');
    if(stat.isDirectory())files.push(...regularFiles(file,key+'/'));
    else if(stat.isFile())files.push(key);
    else throw new Error('Unexpected recovery file type.');
  }
  return files;
}
export function recoveryDataDirectory(data: string): string {
  const stat=lstatSync(data);
  if(!stat.isSymbolicLink()){regularFiles(data);return data;}
  // StateDirectory name derives from the configured data path, not a test/service-name prefix.
  const target='/var/lib/private/'+basename(data),parent=lstatSync('/var/lib/private');
  if(process.platform!=='linux'||resolve(data)!==data||dirname(data)!=='/var/lib'||!/^[A-Za-z0-9][\w.-]{0,127}$/.test(basename(data))||
      stat.uid!==0||stat.gid!==0||!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||parent.gid!==0||
      (parent.mode&0o077)!==0||realpathSync('/var/lib/private')!=='/var/lib/private'||realpathSync(data)!==target)
    throw new Error('Unsupported StateDirectory symlink.');
  const state=lstatSync(target);
  if(!state.isDirectory()||state.isSymbolicLink()||(state.mode&0o777)!==0o700)throw new Error('Unsafe private StateDirectory.');
  regularFiles(target);
  return target;
}

function copyTree(source: string, target: string, privateFiles = false) {
  const files = regularFiles(source);
  mkdirSync(target, { recursive: true, mode: privateFiles ? 0o700 : 0o755 });
  chmodSync(target,privateFiles ? 0o700 : 0o755);
  for (const file of files) {
    mkdirSync(dirname(join(target,file)), { recursive: true, mode: privateFiles ? 0o700 : 0o755 });
    chmodSync(dirname(join(target,file)),privateFiles ? 0o700 : 0o755);
    copyFileSync(join(source,file),join(target,file)); chmodSync(join(target,file),privateFiles ? 0o600 : 0o644);
  }
}
function criticalSnapshot(root: string, hasConfiguration: boolean) {
  const files:Record<string,string>={};let bytes=0;
  for(const directory of ['credentials',...hasConfiguration?['configuration']:[]])for(const file of regularFiles(join(root,directory))){
    const value=readFileSync(join(root,directory,file));bytes+=value.length;
    if(bytes>1024*1024)throw new Error('Recovery credentials/configuration exceed the supported 1MiB limit.');
    files[directory+'/'+file]=value.toString('base64');
  }
  if(!hasConfiguration&&existsSync(join(root,'configuration')))throw new Error('Unexpected recovery configuration.');
  return Buffer.from(JSON.stringify(files));
}
async function matchingAccessKeys(database: string, credentials: string) {
  const db=new DatabaseSync(database,{readOnly:true});
  try{
    const schema=Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if(![2,3,4,5,6,7,8,9,10,11].includes(schema))throw new Error('Unsupported recovery database schema.');
    const table = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?");
    const count = { direct: 0, metrika: 0 };
    if (table.get('direct_connections')) {
      let codec: ReturnType<typeof createSecretCodec> | undefined;
      for (const row of db.prepare('SELECT owner,generation,payload FROM direct_connections').all()) {
        const value = JSON.parse(String(row.payload));
        for (const [item,generation] of [[value,Number(row.generation)],[value.candidate,Number(value.candidate?.generation??0)+1]] as any[]) {
          if (!item?.envelope) continue;
          if (item.envelope.kind !== 'aes-gcm' || typeof item.clientId !== 'string' || !item.clientId || !Number.isSafeInteger(generation) || generation < 0)
            throw new Error('Unsupported recovery envelope/context.');
          codec ??= createSecretCodec({platform:'linux',keyFile:join(credentials,'direct_token_key')});
          await codec.unprotect(item.envelope, JSON.stringify([row.owner,item.clientId,generation]));
          count.direct++;
        }
      }
    }
    if (table.get('analytics_settings')) {
      let codec: ReturnType<typeof createSecretCodec> | undefined;
      for (const row of db.prepare('SELECT owner,payload FROM analytics_settings').all()) {
        const grant = JSON.parse(String(row.payload)).metrikaOAuth;
        if (grant === undefined) continue;
        if (typeof row.owner !== 'string' || typeof grant?.clientId !== 'string' || !grant.clientId ||
          typeof grant.connectionId !== 'string' || !grant.connectionId) throw new Error('Unsupported recovery envelope/context.');
        if (grant.envelope === undefined) continue;
        if (grant.envelope?.kind !== 'aes-gcm') throw new Error('Unsupported recovery envelope/context.');
        codec ??= createSecretCodec({platform:'linux',keyFile:join(credentials,'metrika_oauth_key')});
        await codec.unprotect(grant.envelope, metrikaSecretContext(row.owner, grant.clientId, grant.connectionId));
        count.metrika++;
      }
    }
    return count;
  }catch{throw new Error('Recovery AES key does not match active/candidate envelopes, or the envelope format is unsupported.');}
  finally{db.close();}
}
function verifyCritical(root: string, metadata: any) {
  try{
    const {privateSeal,...core}=metadata,key=readProtectedFile(join(root,'.recovery-seal-key'));
    if(key.length!==32||typeof core.hasConfiguration!=='boolean')throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(privateSeal.nonce,'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(core)));decipher.setAuthTag(Buffer.from(privateSeal.tag,'base64'));
    const expected=Buffer.concat([decipher.update(Buffer.from(privateSeal.data,'base64')),decipher.final()]);
    if(!expected.equals(criticalSnapshot(root,core.hasConfiguration)))throw new Error();
    return expected;
  }catch{throw new Error('Recovery credentials/configuration or private seal are missing, changed or mismatched.');}
}
export async function backupRecovery(app: string, data: string, credentials: string, destination: string, configuration?: string) {
  if (existsSync(destination)) throw new Error('Recovery destination already exists.');
  const actualData=recoveryDataDirectory(data);
  for (const file of [app,credentials,...configuration ? [configuration] : []])regularFiles(file);
  await matchingAccessKeys(join(actualData,'stage2.sqlite'),credentials);
  mkdirSync(destination, { mode: 0o700 });
  copyTree(app,join(destination,'app'));const code=inventory(join(destination,'app'));
  copyTree(credentials,join(destination,'credentials'),true);
  if (configuration) copyTree(configuration,join(destination,'configuration'),true);
  const database = await snapshotDatabase(join(actualData,'stage2.sqlite'),join(destination,'before.sqlite'));
  const pilotPath = join(actualData,'pilot-demo','stage2.sqlite');
  const pilotDatabase = existsSync(pilotPath) ? await snapshotDatabase(pilotPath,join(destination,'pilot.sqlite')) : undefined;
  const envelopes=await matchingAccessKeys(join(destination,'before.sqlite'),join(destination,'credentials'));
  const metadata={format:pilotDatabase ? 3 : 2,recoveryId:randomUUID(),code,database,
    ...(pilotDatabase ? {pilotDatabase} : {}),hasConfiguration:Boolean(configuration),directEnvelopes:envelopes.direct,
    ...(envelopes.metrika ? {metrikaEnvelopes:envelopes.metrika} : {}),createdAt:new Date().toISOString()};
  // Authenticated encryption binds the complete private trees; no short-secret digest is recorded.
  const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
  const sealed=Buffer.concat([cipher.update(criticalSnapshot(destination,metadata.hasConfiguration)),cipher.final()]);
  writeFileSync(join(destination,'.recovery-seal-key'),key,{mode:0o600});
  writeFileSync(join(destination,'recovery.json'),JSON.stringify({...metadata,privateSeal:{nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:sealed.toString('base64')}},null,2)+'\n',{mode:0o600});
  return {destination,schema:database.schema,pilotSchema:pilotDatabase?.schema,codeFiles:Object.keys(code).length,configuration:Boolean(configuration),format:metadata.format,recoveryId:metadata.recoveryId,
    verifiedDirectEnvelopes:envelopes.direct,verifiedMetrikaEnvelopes:envelopes.metrika};
}
export async function restoreRecovery(source: string, destination: string) {
  if (existsSync(destination)) throw new Error('Restore destination must be new; existing data will not be overwritten.');
  const metadata = JSON.parse(readFileSync(join(source,'recovery.json'),'utf8'));
  if(metadata.format!==2 && metadata.format!==3)throw new Error('Unsupported recovery format; create a new verified backup.');
  const critical=verifyCritical(source,metadata);
  const pilotFile = join(source,'pilot.sqlite');
  if (metadata.format === 3) {
    if (!metadata.pilotDatabase || !lstatSync(pilotFile).isFile() ||
        sha256(readFileSync(pilotFile)) !== metadata.pilotDatabase.sha256 ||
        inspectDatabase(pilotFile).schema !== metadata.pilotDatabase.schema) throw new Error('Pilot recovery integrity mismatch.');
  } else if (existsSync(pilotFile) || metadata.pilotDatabase) throw new Error('Unexpected pilot recovery file.');
  regularFiles(join(source,'app'));
  if (JSON.stringify(inventory(join(source,'app'))) !== JSON.stringify(metadata.code) ||
      sha256(readFileSync(join(source,'before.sqlite'))) !== metadata.database.sha256 ||
      inspectDatabase(join(source,'before.sqlite')).schema !== metadata.database.schema) throw new Error('Recovery integrity mismatch.');
  const envelopes=await matchingAccessKeys(join(source,'before.sqlite'),join(source,'credentials'));
  if(envelopes.direct!==metadata.directEnvelopes || envelopes.metrika!==(metadata.metrikaEnvelopes??0))throw new Error('Recovery envelope count mismatch.');
  const expectedDatabase=inspectDatabase(join(source,'before.sqlite'));
  mkdirSync(destination,{mode:0o700});
  copyTree(join(source,'app'),join(destination,'app'));
  copyTree(join(source,'credentials'),join(destination,'credentials'),true);
  if (metadata.hasConfiguration) copyTree(join(source,'configuration'),join(destination,'configuration'),true);
  mkdirSync(join(destination,'data'),{mode:0o700});
  await snapshotDatabase(join(source,'before.sqlite'),join(destination,'data/stage2.sqlite'));
  if (metadata.format === 3) {
    const pilotDir = join(destination,'data','pilot-demo');
    mkdirSync(pilotDir,{mode:0o700});
    const restored = join(pilotDir,'stage2.sqlite');
    await snapshotDatabase(pilotFile,restored);
    if (JSON.stringify(inspectDatabase(restored)) !== JSON.stringify(inspectDatabase(pilotFile))) throw new Error('Restored pilot database differs.');
  }
  chmodSync(join(destination,'data/stage2.sqlite'),0o600);
  if(JSON.stringify(inventory(join(destination,'app')))!==JSON.stringify(metadata.code)||!critical.equals(criticalSnapshot(destination,metadata.hasConfiguration))||
      JSON.stringify(inspectDatabase(join(destination,'data/stage2.sqlite')))!==JSON.stringify(expectedDatabase))throw new Error('Restored recovery changed during copying.');
  await matchingAccessKeys(join(destination,'data/stage2.sqlite'),join(destination,'credentials'));
  return { destination, schema: metadata.database.schema, pilotSchema:metadata.pilotDatabase?.schema, status: 'restored-to-new-directory', configuration: metadata.hasConfiguration };
}
if(import.meta.main) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || !process.argv.includes('--stopped')) throw new Error('Use root on Linux with --stopped and an inactive service.');
  const config = readDeploymentConfig(), state = execFileSync('systemctl',['show',config.unit,'--property=ActiveState','--property=MainPID'],{encoding:'utf8'});
  if (!state.includes('ActiveState=inactive') || !state.includes('MainPID=0')) throw new Error('Stop the service before recovery.');
  const [mode,source,destination] = process.argv.slice(2);
  if(mode==='backup') console.log(JSON.stringify(await backupRecovery(join(config.root,'app'),config.data,config.credentials,resolve(source),destination && destination !== '--stopped' ? resolve(destination) : undefined)));
  else if(mode==='restore' && destination) console.log(JSON.stringify(await restoreRecovery(resolve(source),resolve(destination))));
  else throw new Error('backup <new-directory> [configuration-directory] --stopped | restore <recovery-directory> <new-directory> --stopped');
}
