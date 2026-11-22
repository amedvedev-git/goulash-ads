import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase as openOldDatabase } from '../tests/fixtures/selectel-stage2/src/database.ts';
import { previousFixture } from '../tests/fixtures/e4-deployment.ts';
import { inspectDatabase, inventory, sha256 } from '../deploy/manage-release.ts';

// Actual archive, synthetic databases. Host simulated; real systemd/TLS are separate drills.
const project=fileURLToPath(new URL('..',import.meta.url)),archive=join(project,'output/goulash-ads-update.tar.gz');
const checksum=sha256(readFileSync(archive));assert.equal(readFileSync(archive+'.sha256','utf8').trim().split(/\s+/)[0],checksum);
const entries=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
assert.ok(entries.every(name=>/^goulash-ads-update\/[A-Za-z0-9./_-]*$/.test(name)&&!name.split('/').includes('..')));
assert.ok(execFileSync('tar',['-tvzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/).every(line=>line.startsWith('-')||line.startsWith('d')),'Regular files and directories only');
const directory=mkdtempSync(join(project,'output/selectel-rehearsal-'));execFileSync('tar',['-xzf',archive,'-C',directory]);
const candidate=join(directory,'goulash-ads-update'),release=await import(pathToFileURL(join(candidate,'deploy/manage-release.ts')).href),manifest=release.verifyRelease(candidate);
const results=[];
for(const schema of [2,9,10] as const){
  const run=join(directory,'v'+schema);mkdirSync(run);const paths={root:join(run,'root'),data:join(run,'data'),backups:join(run,'backups'),node:process.execPath};
  mkdirSync(paths.root);const app=join(paths.root,'app');
  if(schema===2){
    const oldSource=join(project,'tests/fixtures/selectel-stage2');
    for(const file of Object.keys(inventory(oldSource)).filter(file=>file!=='README.md')){mkdirSync(dirname(join(app,file)),{recursive:true});copyFileSync(join(oldSource,file),join(app,file));}
    const old=openOldDatabase(paths.data);old.write('local','Synthetic stage2 record');old.write('yandex:101','Synthetic ownerA');old.createSession('synthetic-session','yandex:101','Fixture',Date.now()+3600000);old.close();
  }else{const old=await previousFixture(schema,join(run,'old'));renameSync(old.app,app);renameSync(old.data,paths.data);}
  const db=join(paths.data,'stage2.sqlite'),before=inspectDatabase(db),oldFiles=inventory(app);assert.equal(before.schema,schema);
  const events:string[]=[],host={async checkBefore(){events.push('simulated precheck');},async stop(){events.push('simulated stop');},async start(){events.push('simulated start');},async health(){events.push('simulated health');}};
  const installed=await release.update(paths,host,candidate),migrated=inspectDatabase(db);assert.equal(migrated.schema,11);
  for(const [table,hash] of Object.entries(before.tables))if(table!=='demo_jobs'&&table!=='direct_bindings')assert.equal(migrated.tables[table],hash);
  copyFileSync(db,join(run,'migrated-v10.sqlite'));
  const repeat=await release.update(paths,host,candidate);assert.equal(repeat.status,'already-installed');const reverted=await release.rollback(paths,host);
  assert.deepEqual(inspectDatabase(db),before);assert.deepEqual(inventory(app),oldFiles);
  results.push({schema,before,migrated,restored:inspectDatabase(db),installed,repeat,reverted,events});
}
const result={checkedAt:new Date().toISOString(),archive,sha256:checksum,releaseId:manifest.releaseId,input:'Synthetic schema2 from preserved stage2; schema9 from pinned E2; schema10 from pinned E4',results,
  realSystemdAndHttps:'not executed by this verifier; Host simulated',liveCalls:0,paidCalls:0,retainedFiles:directory};
writeFileSync(join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');writeFileSync(join(project,'output/selectel-update-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'passed',schemas:['2 -> 11 -> 2','9 -> 11 -> 9','10 -> 11 -> 10'],releaseId:manifest.releaseId,report:join(project,'output/selectel-update-check.json')},null,2));
