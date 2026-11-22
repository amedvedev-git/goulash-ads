import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, chownSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stageRelease } from './Build-SelectelPackage.ts';
import { defaults } from '../deploy/config.ts';
import { inspectDatabase, inventory, snapshotDatabase, productionHost } from '../deploy/manage-release.ts';
import { previousFixture } from '../tests/fixtures/e4-deployment.ts';
import { openDatabase as openStage2 } from '../tests/fixtures/selectel-stage2/src/database.ts';
import { fileURLToPath } from 'node:url';

// Real Caddy, TLS and systemd; one named network namespace with no external routes.
if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Linux root required.');
const out=resolve(process.argv[2]??'output/orchestration/E4-001/linux-clean'),caddy=resolve(process.argv[3]??'output/orchestration/E4-001/linux-tools/caddy');mkdirSync(out,{recursive:true});
const root=mkdtempSync('/opt/goulash-e4-clean-'),name='goulash-ads-e4-clean-'+process.pid,unit=name+'.service',ns='e4-clean-'+process.pid,data='/var/lib/'+name;
chmodSync(root,0o755);const sites=join(root,'sites'),credentials=join(root,'credentials'),stage=join(root,'stage');mkdirSync(sites);mkdirSync(credentials,{mode:0o700});
const c={...defaults,root:join(root,'installed'),data,backups:join(root,'backups'),node:process.execPath,unit,bind:'127.0.0.1',port:18796,
  publicOrigin:'https://ads.e4-fixture.invalid',suppliersOrigin:'',credentials,caddySite:join(sites,'ads.caddy'),caddyBinary:caddy,caddyConfig:join(root,'Caddyfile')};
const config=join(root,'deployment.json');writeFileSync(config,JSON.stringify(c),{mode:0o600});
const run=(cmd:string,args:string[],env:NodeJS.ProcessEnv=process.env)=>execFileSync(cmd,args,{encoding:'utf8',timeout:60000,env,stdio:['ignore','pipe','pipe']}).trim();
let child:ReturnType<typeof spawn>|undefined,closed:Promise<any>|undefined,namespace=false;
const unitFile='/etc/systemd/system/'+unit,dropin=unitFile+'.d';
try{
  const manifest=stageRelease(stage);writeFileSync(join(credentials,'yandex_client_id'),'fixture-clean-login',{mode:0o600});writeFileSync(join(credentials,'yandex_client_secret'),'fixture-clean-secret',{mode:0o600});
  writeFileSync(c.caddyConfig,`{\n admin 127.0.0.1:2019\n local_certs\n skip_install_trust\n}\nimport ${sites}/*.caddy\n`);
  // Bootstrap the local CA on the same hostname, on a separate test-only port.
  writeFileSync(join(sites,'ca.caddy'),'https://ads.e4-fixture.invalid:19443 {\n respond 200\n}\n');
  run('ip',['netns','add',ns]);namespace=true;run('ip',['netns','exec',ns,'ip','link','set','lo','up']);
  const env={...process.env,XDG_DATA_HOME:join(root,'caddy-data'),XDG_CONFIG_HOME:join(root,'caddy-config'),GOULASH_DEPLOY_CONFIG:config,GOULASH_BOOTSTRAP_NODE:process.execPath};
  child=spawn('ip',['netns','exec',ns,caddy,'run','--config',c.caddyConfig],{env,stdio:['ignore','ignore','ignore']});closed=once(child,'close');
  const ca=join(root,'caddy-data/caddy/pki/authorities/local/root.crt');
  for(let i=0;i<50&&!existsSync(ca);i++)await new Promise(r=>setTimeout(r,100));assert.ok(existsSync(ca),'Caddy generated its isolated internal CA');
  env.CURL_CA_BUNDLE=ca;
  mkdirSync(dropin);writeFileSync(join(dropin,'network.conf'),`[Unit]\nStartLimitIntervalSec=0\n[Service]\nNetworkNamespacePath=/run/netns/${ns}\n`);
  const install=run('ip',['netns','exec',ns,'bash',join(stage,'deploy/install-clean.sh'),'--config',config],env);
  assert.match(install,/installed-clean/);assert.equal(inspectDatabase(join(data,'stage2.sqlite')).schema,11);
  assert.equal(statSync(data).mode&0o777,0o700);assert.equal(statSync(credentials).mode&0o777,0o700);assert.equal(statSync(join(credentials,'yandex_client_secret')).mode&0o777,0o600);
  const original=inventory(join(c.root,'app'));
  run('systemctl',['restart',unit]);
  const installed=run('ip',['netns','exec',ns,'bash',join(stage,'deploy/update-selectel.sh')],env);assert.match(installed,/installed/);
  const repeat=run('ip',['netns','exec',ns,'bash',join(stage,'deploy/update-selectel.sh')],env);assert.match(repeat,/already-installed/);
  const rollback=run('ip',['netns','exec',ns,'bash',join(c.root,'tools/deploy/rollback-selectel.sh')],env);assert.match(rollback,/rolled-back/);
  assert.deepEqual(inventory(join(c.root,'app')),original);assert.equal(inspectDatabase(join(data,'stage2.sqlite')).schema,11);
  const migrations:any[]=[];
  run('systemctl',['stop',unit]);const savedApp=join(root,'clean-app'),savedDb=join(root,'clean.sqlite');renameSync(join(c.root,'app'),savedApp);await snapshotDatabase(join(data,'stage2.sqlite'),savedDb);
  for(const schema of [2,9] as const){
    let oldApp:string,oldData:string;
    if(schema===9){const old=await previousFixture(9,join(root,'old9'));oldApp=old.app;oldData=old.data;}
    else{oldApp=join(root,'old2/app');oldData=join(root,'old2/data');const oldSource=fileURLToPath(new URL('../tests/fixtures/selectel-stage2/',import.meta.url));
      for(const file of Object.keys(inventory(oldSource)).filter(f=>f!=='README.md')){const target=join(oldApp,file);mkdirSync(target.slice(0,target.lastIndexOf('/')),{recursive:true});copyFileSync(join(oldSource,file),target);}
      const db=openStage2(oldData);db.write('local','Synthetic old stage2');db.createSession('synthetic-session','yandex:101','fixture',Date.now()+3600000);db.close();}
    const oldCode=inventory(oldApp),before=inspectDatabase(join(oldData,'stage2.sqlite')),owner=statSync(data);
    renameSync(oldApp,join(c.root,'app'));
    for(const suffix of ['','-wal','-shm','-journal'])if(existsSync(join(data,'stage2.sqlite')+suffix))rmSync(join(data,'stage2.sqlite')+suffix);
    copyFileSync(join(oldData,'stage2.sqlite'),join(data,'stage2.sqlite'));chmodSync(join(data,'stage2.sqlite'),0o600);chownSync(join(data,'stage2.sqlite'),owner.uid,owner.gid);
    run('systemctl',['start',unit]);
    const upgrade=run('ip',['netns','exec',ns,'bash',join(stage,'deploy/update-selectel.sh')],env);assert.equal(inspectDatabase(join(data,'stage2.sqlite')).schema,11);
    const returned=run('ip',['netns','exec',ns,'bash',join(c.root,'tools/deploy/rollback-selectel.sh')],env);
    assert.deepEqual(inspectDatabase(join(data,'stage2.sqlite')),before);assert.deepEqual(inventory(join(c.root,'app')),oldCode);migrations.push({from:schema,to:11,restored:schema,upgrade,returned});
    run('systemctl',['stop',unit]);renameSync(join(c.root,'app'),join(root,'restored-old'+schema));
  }
  renameSync(savedApp,join(c.root,'app'));
  for(const suffix of ['','-wal','-shm','-journal'])if(existsSync(join(data,'stage2.sqlite')+suffix))rmSync(join(data,'stage2.sqlite')+suffix);
  copyFileSync(savedDb,join(data,'stage2.sqlite'));const restoredOwner=statSync(data);chmodSync(join(data,'stage2.sqlite'),0o600);chownSync(join(data,'stage2.sqlite'),restoredOwner.uid,restoredOwner.gid);run('systemctl',['start',unit]);
  // A failed service with MainPID0 has no database writer and must still permit paired recovery.
  run('systemctl',['stop',unit]);writeFileSync(join(dropin,'fault.conf'),'[Service]\nExecStart=\nExecStart=/bin/false\nRestart=no\n');run('systemctl',['daemon-reload']);
  try{run('systemctl',['start',unit]);}catch{}
  for(let i=0;i<30&&run('systemctl',['show',unit,'--property=ActiveState','--value'])!=='failed';i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(run('systemctl',['show',unit,'--property=MainPID','--value']),'0');await productionHost(c).stop();
  rmSync(join(dropin,'fault.conf'));run('systemctl',['daemon-reload']);run('systemctl',['reset-failed',unit]);run('systemctl',['start',unit]);
  const properties=run('systemctl',['show',unit,'--property=DynamicUser','--property=StateDirectory','--property=NetworkNamespacePath']);
  const result={status:'passed',actualSystemd:true,actualCaddy:run(caddy,['version']),actualTls:'isolated Caddy internal CA, curl verification enabled; trust store unchanged',releaseId:manifest.releaseId,
    clean:true,singleDomain:true,privateDataAndCredentials:true,failedServiceStop:true,schemas:['new11',...migrations.map(m=>m.from+'->11->'+m.restored)],migrations,update:JSON.parse(installed.slice(0,installed.lastIndexOf('}')+1)),repeat:JSON.parse(repeat.slice(0,repeat.lastIndexOf('}')+1)),rollback:JSON.parse(rollback.slice(0,rollback.lastIndexOf('}')+1)),properties,liveCalls:0,paidCalls:0,externalRoutes:run('ip',['netns','exec',ns,'ip','route'])};
  writeFileSync(join(out,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:'passed',report:join(out,'report.json')}));
}finally{
  try{run('systemctl',['disable','--now',unit]);}catch{}try{run('systemctl',['reset-failed',unit]);}catch{}
  if(child){child.kill();await closed;}
  if(namespace)try{run('ip',['netns','del',ns]);}catch{}
  if(existsSync(unitFile))rmSync(unitFile);if(existsSync(dropin))rmSync(dropin,{recursive:true});run('systemctl',['daemon-reload']);
  if(existsSync(data)){const target=realpathSync(data);assert.ok([data,'/var/lib/private/'+name].includes(target));rmSync(target,{recursive:true,force:true});if(target!==data)rmSync(data,{force:true});}
  assert.ok(root.startsWith('/opt/goulash-e4-clean-'));rmSync(root,{recursive:true,force:true});
}
