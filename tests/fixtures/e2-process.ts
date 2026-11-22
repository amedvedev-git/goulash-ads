import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { e2Fixture,fixtureKey } from './e2.ts';
import { createSecretCodec } from '../../src/direct-secrets.ts';
const directory=process.argv[2],mode=process.argv[3];
let x:ReturnType<typeof e2Fixture>;
const base=createSecretCodec({platform:'linux',key:fixtureKey});
const codec={protect:base.protect,async unprotect(value:any,context:string){const token=await base.unprotect(value,context);if(mode==='before'&&x.db.readDirect(x.owner)?.steps.campaign.phase==='pending'){writeFileSync(join(directory,'crash-marker'),'before-gate');process.exit(78);}return token;}};
const transport:typeof fetch=(url,init)=>{
  const response=x.provider(url,init),request=String(url).includes('/json/')?JSON.parse(String(init?.body)):undefined;
  if(request?.method==='add'&&String(url).endsWith('/campaigns')){
    if(mode==='crash'){writeFileSync(join(directory,'remote-records.json'),JSON.stringify(x.a.records));writeFileSync(join(directory,'crash-marker'),'after-send-before-commit');process.exit(77);}
    if(mode==='hold'){process.send?.({stage:'sent'});return new Promise<void>(resolve=>process.on('message',m=>{if(m==='release')resolve();})).then(()=>response);}
  }
  return response;
};
x=e2Fixture(directory,{transport,codec});await x.connect();x.plan();await x.action('prepare',{name:'Межпроцессный набор'});
try{await x.action('create');process.send?.({stage:'result',unexpectedSuccess:true});}
catch(error){const c=x.db.readDirectConnection(x.owner)!;process.send?.({stage:'result',error:(error as Error).message,writes:x.a.writes().length,state:x.db.readDirect(x.owner),connection:{status:c.status,generation:c.generation,hasEnvelope:Boolean(c.value.envelope)}});}
finally{x.db.close();process.disconnect?.();}
