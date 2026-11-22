import { openDatabase } from '../../src/database.ts';
import { createAnalyticsService } from '../../src/analytics.ts';
import { createDirectConnections } from '../../src/direct-connect.ts';
import { createSecretCodec } from '../../src/direct-secrets.ts';
import { createMetrikaApi } from '../../src/metrika-api.ts';
import { fixtureKey } from './e2.ts';
import { metrikaResponse } from './e3.ts';
const [directory,mode,source,configId]=process.argv.slice(2),owner='yandex:101',db=openDatabase(directory);
let dispatches=0;
const transport:typeof fetch=async(url,init)=>{
  dispatches++;
  if(mode==='crash')return new Promise(()=>{process.send!('dispatched',()=>process.exit(0));});
  if(String(url).endsWith('/reports')){const q=JSON.parse(String(init!.body)).params;return new Response(`CampaignId\tImpressions\tClicks\tCost\n${q.SelectionCriteria.Filter[0].Values[0]}\t0\t0\t0\n`);}
  return Response.json(metrikaResponse(new URL(String(url)).searchParams));
};
const manager=createDirectConnections(db,{clientId:'fixture-direct-app',clientSecret:'fictional',codec:createSecretCodec({platform:'linux',key:fixtureKey}),transport,mode:'fixture'});
const analytics=createAnalyticsService(db,o=>manager.resolve(o),{owner,mode:'fixture',configId,api:createMetrikaApi(async()=> 'fictional',transport)});
process.send!('ready');
process.once('message',async()=>{try{const report=await analytics.refresh(owner,source as any);db.close();process.send!({id:report.id,status:report.status,dispatches},()=>process.exit(0));}catch(error){db.close();process.send!({error:error instanceof Error?error.message:'unknown',dispatches},()=>process.exit(1));}});
