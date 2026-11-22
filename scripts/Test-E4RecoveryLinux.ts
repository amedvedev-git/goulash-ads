import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageRelease } from './Build-SelectelPackage.ts';
import { previousFixture } from '../tests/fixtures/e4-deployment.ts';
import { defaults } from '../deploy/config.ts';
import { backupRecovery, restoreRecovery } from '../deploy/backup-restore.ts';
import { inspectDatabase, inventory, update } from '../deploy/manage-release.ts';

// Actual systemd StateDirectory and documented persisted CLI; all data/keys are synthetic.
if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Run as root in the authorised Linux environment.');
const out=resolve(process.argv[2]??'output/orchestration/E4-001/fix-tech-01/linux-recovery');mkdirSync(out,{recursive:true});
const root=mkdtempSync('/opt/goulash-e4-recovery-'),name='goulash-ads-e4-recovery-'+process.pid,unit=name+'.service',data='/var/lib/'+name;
const unitFile='/etc/systemd/system/'+unit,alias=data+'-wrong',nested=join(data,'forbidden-link');
const run=(command:string,args:string[],env:NodeJS.ProcessEnv=process.env)=>execFileSync(command,args,{encoding:'utf8',timeout:60000,env,stdio:['ignore','pipe','pipe']}).trim();
let unitWritten=false;
try{
  const old=await previousFixture(10,join(root,'old')),credentials=join(root,'credentials'),configuration=join(root,'configuration'),installed=join(root,'installed'),candidate=join(root,'upload');
  mkdirSync(credentials,{mode:0o700});mkdirSync(configuration,{mode:0o700});mkdirSync(installed);
  writeFileSync(join(credentials,'direct_token_key'),Buffer.alloc(32,71),{mode:0o600});writeFileSync(join(credentials,'yandex_client_secret'),'synthetic-login-secret',{mode:0o600});
  writeFileSync(unitFile,`[Service]\nType=oneshot\nDynamicUser=yes\nStateDirectory=${name}\nStateDirectoryMode=0700\nExecStart=/usr/bin/true\n`,{mode:0o644});unitWritten=true;
  run('systemctl',['daemon-reload']);run('systemctl',['start',unit]);assert.equal(run('systemctl',['show',unit,'--property=ActiveState','--value']),'inactive');
  assert.equal(lstatSync(data).isSymbolicLink(),true);assert.equal(realpathSync(data),'/var/lib/private/'+name);
  const owner=statSync(data);copyFileSync(join(old.data,'stage2.sqlite'),join(data,'stage2.sqlite'));chmodSync(join(data,'stage2.sqlite'),0o600);chownSync(join(data,'stage2.sqlite'),owner.uid,owner.gid);
  const {cpSync}=await import('node:fs');cpSync(old.app,join(installed,'app'),{recursive:true});const release=stageRelease(candidate);
  // Staging persisted recovery tools only; service is already inactive. This Host is explicitly simulated.
  const host={async checkBefore(){},async stop(){},async start(){},async health(){}};
  await update({root:installed,data,backups:join(root,'updates'),node:process.execPath},host,candidate);
  copyFileSync(unitFile,join(configuration,'unit.conf'));
  const config=join(root,'deployment.json');writeFileSync(config,JSON.stringify({...defaults,root:installed,data,backups:join(root,'updates'),credentials,node:process.execPath,unit}),{mode:0o600});
  const env={...process.env,GOULASH_DEPLOY_CONFIG:config},tool=join(installed,'tools/deploy/backup-restore.ts'),backup=join(root,'recovery'),restored=join(root,'restored');
  const before=inspectDatabase(join(data,'stage2.sqlite')),code=inventory(join(installed,'app'));
  rmSync(candidate,{recursive:true});
  const backed=JSON.parse(run(process.execPath,[tool,'backup',backup,configuration,'--stopped'],env));assert.equal(backed.format,2);assert.equal(backed.verifiedDirectEnvelopes,2);
  const returned=JSON.parse(run(process.execPath,[tool,'restore',backup,restored,'--stopped'],env));assert.equal(returned.status,'restored-to-new-directory');
  assert.deepEqual(inspectDatabase(join(restored,'data/stage2.sqlite')),before);assert.deepEqual(inventory(join(restored,'app')),code);
  assert.deepEqual(readFileSync(join(restored,'credentials/direct_token_key')),Buffer.alloc(32,71));assert.deepEqual(readFileSync(join(restored,'configuration/unit.conf')),readFileSync(unitFile));
  for(const [file,mode] of [[restored,0o700],[join(restored,'credentials'),0o700],[join(restored,'data'),0o700],[join(restored,'data/stage2.sqlite'),0o600],[join(restored,'app/src'),0o755],[join(backup,'.recovery-seal-key'),0o600]] as const)assert.equal(statSync(file).mode&0o777,mode);
  const rejected:string[]=[];
  symlinkSync(old.data,alias,'dir');await assert.rejects(backupRecovery(join(installed,'app'),alias,credentials,join(root,'bad-alias'),configuration));assert.equal(existsSync(join(root,'bad-alias')),false);rmSync(alias);rejected.push('outside-private-target');
  symlinkSync(join(configuration,'unit.conf'),nested);await assert.rejects(backupRecovery(join(installed,'app'),data,credentials,join(root,'bad-nested'),configuration));assert.equal(existsSync(join(root,'bad-nested')),false);rmSync(nested);rejected.push('nested-data-symlink');
  chmodSync(realpathSync(data),0o755);try{await assert.rejects(backupRecovery(join(installed,'app'),data,credentials,join(root,'bad-mode'),configuration));assert.equal(existsSync(join(root,'bad-mode')),false);}finally{chmodSync(realpathSync(data),0o700);}rejected.push('unsafe-private-target-mode');
  writeFileSync(join(backup,'credentials/direct_token_key'),Buffer.alloc(32,72));await assert.rejects(restoreRecovery(backup,join(root,'bad-restore')));assert.equal(existsSync(join(root,'bad-restore')),false);rejected.push('changed-valid32-AES-key');
  assert.deepEqual(inspectDatabase(join(data,'stage2.sqlite')),before);assert.deepEqual(readFileSync(join(credentials,'direct_token_key')),Buffer.alloc(32,71));
  const report={status:'passed',actualSystemdStateDirectory:true,symlink:true,canonicalPrivateTarget:true,persistedCliAfterUploadDeleted:true,format:2,
    verifiedActiveAndCandidateEnvelopes:2,exactCodeDbCredentialsConfiguration:true,privateModes:true,negativeCases:rejected,originalDataUnchanged:true,
    releaseId:release.releaseId,stagingHost:'simulated only for tool copy; backup/restore use real inactive systemd unit and actual StateDirectory',liveCalls:0,paidCalls:0};
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{
  if(existsSync(alias))rmSync(alias);if(existsSync(nested))rmSync(nested);
  if(unitWritten){try{run('systemctl',['stop',unit]);}catch{}try{run('systemctl',['reset-failed',unit]);}catch{}if(existsSync(unitFile))rmSync(unitFile);run('systemctl',['daemon-reload']);}
  if(existsSync(data)){const target=realpathSync(data);assert.equal(target,'/var/lib/private/'+name);rmSync(target,{recursive:true,force:true});rmSync(data,{force:true});}
  assert.ok(root.startsWith('/opt/goulash-e4-recovery-'));rmSync(root,{recursive:true,force:true});
}
