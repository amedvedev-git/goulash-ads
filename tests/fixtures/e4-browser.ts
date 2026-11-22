import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server.ts';
import { createYandexAuth } from '../../src/yandex-auth.ts';
import { createMetrikaApi } from '../../src/metrika-api.ts';
import { e2Fixture } from './e2.ts';
import { e1Input, e1Profile } from './e1-scenario.ts';
import { fixtureGrounded } from './grounded.ts';
import { metrikaResponse } from './e3.ts';
import { exampleCampaign } from '../../src/campaign.ts';
import { DirectError } from '../../src/direct-api.ts';
import { phraseKey } from '../../src/search-phrases.ts';
import type { SearchProfile } from '../../src/phrase-intelligence.ts';

const cafeProfile:SearchProfile={offers:[
  {id:'sushi',name:'Суши',aliases:[],seeds:['доставка суши'],kind:'product',delivery:true,evidence:'доставляет суши и роллы'},
  {id:'rolls',name:'Роллы',aliases:[],seeds:['доставка роллов'],kind:'product',delivery:true,evidence:'доставляет суши и роллы'},
],ownBrands:['Рис и ролл'],exclusions:[],uncertainty:[]};
// Closed synthetic cases, not a universal language model. The default is the UI's own example.
const scenarios=[
  {description:exampleCampaign.description,profile:cafeProfile,rows:[
    {seed:'доставка суши',phrase:'доставка суши',count:'120',offerId:'sushi',adTerm:'суши'},
    {seed:'доставка роллов',phrase:'доставка роллов',count:'35',offerId:'rolls',adTerm:'ролл'},
  ]},
  {description:e1Input.description,profile:e1Profile,rows:[
    {seed:'ремонт холодильников',phrase:'ремонт холодильников',count:'120',offerId:'repair',adTerm:'холодильник'},
    {seed:'вызов мастера по холодильникам',phrase:'вызов мастера по холодильникам',count:'35',offerId:'repair',adTerm:'холодильник'},
  ]},
];
const unsupported=()=>Object.assign(new DirectError('Локальный fixture поддерживает штатную кнопку «Заполнить вымышленным примером». Произвольный бизнес требует настоящего провайдера; запрос не отправлен.'),{notSent:true});

// A genuinely empty fixture. Login shortcuts and provider controls never enter runtime packages.
export function e4Browser(directory: string, waitFor?: (stage: 'wordstat' | 'deepseek') => Promise<void>) {
  mkdirSync(directory,{recursive:true});
  const file=join(directory,'fixture-provider.json'),counts={profile:0,wordstat:0,judge:0},fault={reports:200,ai:false};
  let x:ReturnType<typeof e2Fixture>;
  const transport:typeof fetch=async(url,init)=>{
    if(String(url)==='https://api.direct.yandex.com/json/v501/reports'){
      const campaign = JSON.parse(String(init?.body)).params.SelectionCriteria.Filter[0].Values[0];
      const sample = Number(campaign) % 2 === 0 ? '4240\t128\t1680000000' : '7850\t246\t3120000000';
      return new Response(fault.reports===200?`CampaignId\tImpressions\tClicks\tCost\n${campaign}\t${sample}\n`:'',{status:fault.reports,headers:{RequestId:'e4-fixture-report'}});
    }
    if(!['oauth.yandex.ru','login.yandex.ru','api.direct.yandex.com'].includes(new URL(String(url)).hostname)) throw new Error('Unexpected fixture egress.');
    return x.provider(url,init);
  };
  x=e2Fixture(directory,{transport});
  if(existsSync(file)){
    const prior=JSON.parse(readFileSync(file,'utf8'));Object.assign(counts,prior.counts);Object.assign(x.a.records,prior.a);Object.assign(x.b.records,prior.b);
    x.a.calls.push(...prior.callsA);x.b.calls.push(...prior.callsB);
  }
  const save=()=>writeFileSync(file,JSON.stringify({counts,a:x.a.records,b:x.b.records,callsA:x.a.calls,callsB:x.b.calls},null,2));
  const intelligence={profile:async(draft:any)=>{counts.profile++;if(fault.ai)throw new Error('Fixture interruption');const scenario=scenarios.find(s=>s.description===draft.description);if(!scenario)throw unsupported();return structuredClone(scenario.profile);},
    judge:async()=>{throw new Error('Grounded path required.');},groundedJudge:async(draft:any,profile:SearchProfile,candidates:any)=>{
      counts.judge++;await waitFor?.('deepseek');const scenario=scenarios.find(s=>s.description===draft.description);if(!scenario)throw unsupported();
      const response=fixtureGrounded(profile,candidates);
      response.judgments.forEach((row,i)=>{
        const source=scenario.rows.find(r=>phraseKey(r.phrase)===phraseKey(candidates[i].phrase)),offer=profile.offers.find(o=>o.id===source?.offerId);
        row.offerId=offer?.id??null;row.support={basis:offer?'equivalent':'unsupported',factRefs:offer?[`${offer.id}:offer`]:[]};
        if(!offer||!`${draft.title} ${draft.adText}`.toLocaleLowerCase('ru').includes(source!.adTerm)){
          row.decision='review';row.adRelevant=false;if(!offer)row.intent='unknown';row.reason='Подставная оценка: проверьте соответствие фразы предложению и объявлению.';
        }
      });return response;
    }};
  const wordstat=async(seed:string)=>{counts.wordstat++;await waitFor?.('wordstat');const row=scenarios.flatMap(s=>s.rows).find(r=>phraseKey(r.seed)===phraseKey(seed));if(!row)throw unsupported();return [{phrase:row.phrase,count:row.count}];};
  const metrika={owner:x.owner,mode:'fixture' as const,configId:'e4-fixture-metrika',api:createMetrikaApi(async()=>'fictional',async(url)=>{
    const u=new URL(String(url));if(u.hostname!=='api-metrika.yandex.net')throw new Error('Unexpected fixture endpoint');
    if(u.pathname==='/management/v1/counters')return Response.json({counters:[{id:11001001,site:'example.com',name:'Учебное кафе'}]});
    if(u.pathname==='/management/v1/counter/11001001')return Response.json({counter:{id:11001001,site:'example.com',goals:[{id:21001001,name:'Заказ оформлен · fixture',type:'action'}]}});
    if(u.pathname!=='/stat/v1/data')throw new Error('Unexpected fixture endpoint');return Response.json(metrikaResponse(u.searchParams));
  })};
  const clientId='e4-fixture-login',auth=createYandexAuth(x.db,clientId,'fictional-secret',{requestJson:async()=>{throw new Error('Only local fixture login');}});
  const server=createApp(x.db,auth,undefined,undefined,undefined,wordstat,intelligence,undefined,{},x.manager,metrika,owner=>owner===x.owner);
  const handler=server.listeners('request')[0] as any;server.removeAllListeners('request');
  server.on('request',(request,response)=>{
    response.on('finish',save);
    if(request.method==='GET'&&/^\/fixture-login\/(a|b)$/.test(request.url??'')){
      const second=request.url!.endsWith('/b'),token=randomBytes(32).toString('base64url');
      x.db.createSession(createHash('sha256').update(`${clientId}:${token}`).digest('hex'),second?'yandex:202':x.owner,second?'Владелец Б · fixture':'Владелец А · fixture',Date.now()+3600000);
      response.writeHead(303,{'Set-Cookie':`goulash_session=${token}; Path=/; HttpOnly; SameSite=Lax`,Location:'/'}).end();return;
    }
    if(request.method==='GET'&&request.url==='/fixture-state'){
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({fixture:true,liveCalls:0,paidCalls:0,pid:process.pid,counts,plans:x.db.readPlans(x.owner).length,runs:x.db.readDirectRuns(x.owner),writes:x.a.writes().length,job:x.db.operationsView(x.owner).job,demo:x.db.readDemo(x.owner),permission:x.db.readDemoPermission(x.owner),history:x.db.readHistory(x.owner)}));return;
    }
    if(request.method==='GET'&&/^\/fixture-mode\/(error|ready)$/.test(request.url??'')){fault.reports=request.url!.endsWith('/error')?500:200;response.writeHead(303,{Location:'/analytics'}).end();return;}
    handler(request,response);
  });
  return {...x,server,counts,fault,save};
}
if(import.meta.main){
  const directory=resolve(process.argv[2]??'output/orchestration/E4-001/browser-data'),port=Number(process.argv[3]??8795);
  if([8767,8768,8793].includes(port))throw new Error('Protected existing port.');
  const x=e4Browser(directory);
  x.server.listen(port,'127.0.0.1',()=>{
    const address=x.server.address();
    if(!address || typeof address==='string') throw new Error('Не удалось определить порт учебного кабинета.');
    writeFileSync(join(directory,'server.json'),JSON.stringify({pid:process.pid,port:address.port,directory,fixture:true,liveCalls:0,paidCalls:0}));
    console.log(`Учебный вход: http://127.0.0.1:${address.port}/fixture-login/a`);
  });
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{x.save();x.server.close(()=>{x.db.close();process.exit();});});
}
