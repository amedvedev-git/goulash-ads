import { mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inventory } from '../../deploy/manage-release.ts';
import { e2Draft } from './e2.ts';
import { confirmedPlan } from './confirmed-plan.ts';
import { createSecretCodec } from '../../src/direct-secrets.ts';

export const e2Commit='e8e014a920f3f751e1a8a34f093de4859ad6be8f';
const e4Commit = '4cb82d23829ba12e320f53daa103b477d1b9a149';
export async function previousFixture(schema:9|10,directory:string) {
  const app=join(directory,'app'),data=join(directory,'data');mkdirSync(app,{recursive:true});
  if(schema===9){
    const previous=fileURLToPath(new URL('./selectel-e2/',import.meta.url));
    for(const file of Object.keys(inventory(previous)).filter(file=>file!=='README.md')){mkdirSync(dirname(join(app,file)),{recursive:true});copyFileSync(join(previous,file),join(app,file));}
  } else {
    const archive = fileURLToPath(new URL('./sqlite-v10-source.tgz', import.meta.url));
    execFileSync('tar', ['-xzf', archive, '-C', app]);
  }
  const {openDatabase}=await import(pathToFileURL(join(app,'src/database.ts')).href),db=openDatabase(data),owner='yandex:101';
  db.write('local','Synthetic legacy record');db.createSession('fictional-session',owner,'Fixture',Date.now()+3600000);
  db.saveCampaign(owner,e2Draft,0,'fixture');confirmedPlan(db,e2Draft,['ремонт холодильников'],owner);
  const codec=createSecretCodec({platform:'linux',key:Buffer.alloc(32,71)}),clientId='fixture-direct-app',generation=2;
  const envelope=await codec.protect('synthetic-active',JSON.stringify([owner,clientId,generation]));
  const candidateEnvelope=await codec.protect('synthetic-candidate',JSON.stringify([owner,clientId,4]));
  // Stored JSON is synthetic and exercises both current and candidate encryption contexts.
  db.close();
  const {DatabaseSync}=await import('node:sqlite'),sql=new DatabaseSync(join(data,'stage2.sqlite'));
  sql.prepare('INSERT INTO direct_connections(owner,account,generation,status,payload) VALUES(?,?,?,?,?)').run(owner,'10101',generation,'connected',JSON.stringify({status:'connected',clientId,envelope,candidate:{clientId,generation:3,envelope:candidateEnvelope}}));
  sql.close();
  return {app,data,owner,code:inventory(app),sourceCommit:schema===9?e2Commit:e4Commit};
}
