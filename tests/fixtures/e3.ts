import { createMetrikaApi } from '../../src/metrika-api.ts';
import { createAnalyticsService } from '../../src/analytics.ts';
import { e2Fixture } from './e2.ts';
export function metrikaResponse(params:URLSearchParams,overrides:Record<string,unknown>={}){
  const metrics=params.get('metrics')!.split(','),date1=params.get('date1')!,date2=params.get('date2')!;
  if(params.get('dimensions')==='ym:s:date'){
    // Daily series: the fixture sums its pattern to the same 6 leads the ad report returns.
    const pattern=[1,0,2,0,1,0,2],days:any[]=[];
    const start=Date.parse(date1+'T00:00:00Z'),end=Date.parse(date2+'T00:00:00Z');
    for(let time=start,index=0;time<=end;time+=86400000,index++){
      days.push({dimensions:[{name:new Date(time).toISOString().slice(0,10)}],metrics:[pattern[index%pattern.length]]});
    }
    const totals=[days.reduce((sum,row)=>sum+row.metrics[0],0)];
    return {query:{metrics,date1,date2,timezone:params.get('timezone'),dimensions:['ym:s:date'],filters:params.get('filters')},
      data:days,totals,total_rows:days.length,total_rows_rounded:false,sampled:false,sample_share:1,contains_sensitive_data:false,data_lag:0,...overrides};
  }
  const ad=params.has('dimensions'),values=ad?[1400,6,5,233.33]:[100,20,16];
  return {query:{metrics,date1:params.get('date1'),date2:params.get('date2'),timezone:params.get('timezone'),...(ad?{dimensions:[params.get('dimensions')],filters:params.get('filters')}:{})},
    data:[{dimensions:ad?[{id:params.get('filters')!.split('==')[1]}]:[],metrics:values}],totals:values,total_rows:1,total_rows_rounded:false,sampled:false,sample_share:1,contains_sensitive_data:false,data_lag:0,...overrides};
}
export async function e3Fixture(directory:string){
  let x:ReturnType<typeof e2Fixture>;const calls:any[]=[],fault={directStatus:200,metrikaStatus:200,empty:false};
  const transport:typeof fetch=async(url,init)=>{
    if(String(url)==='https://api.direct.yandex.com/json/v501/reports'){
      const body=JSON.parse(String(init?.body));calls.push({source:'reports',body});
      return new Response(fault.directStatus===200?'CampaignId\tImpressions\tClicks\tCost\n'+(fault.empty?'':`${body.params.SelectionCriteria.Filter[0].Values[0]}\t0\t0\t0\n`):'',{status:fault.directStatus,headers:{RequestId:'e3-fixture-report',retryIn:'1'}});
    }
    return x.provider(url,init);
  };
  x=e2Fixture(directory,{transport});await x.connect();
  if(!x.db.readDirect(x.owner)){x.plan();await x.action('prepare',{name:'E3 fixture · без показов',startDate:'2099-12-20'});await x.action('create');}
  const metrikaTransport:typeof fetch=async(url,init)=>{
    const u=new URL(String(url));if(u.hostname!=='api-metrika.yandex.net'||(init?.method&&init.method!=='GET'))throw new Error('Only fixed read-only Metrika fixture endpoints are allowed');
    calls.push({source:'metrika',path:u.pathname,query:Object.fromEntries(u.searchParams)});
    if(fault.metrikaStatus!==200)return new Response('{}',{status:fault.metrikaStatus});
    if(u.pathname==='/management/v1/counter/11001001')return Response.json({counter:{id:11001001,site:'example.com',mirrors:[],goals:[{id:21001001,name:'Заказ оформлен · fixture',type:'action',conditions:[{url:'save_order'}]}]}});
    if(u.pathname!=='/stat/v1/data')throw new Error('Unsupported fixture endpoint');
    const daily=u.searchParams.get('dimensions')==='ym:s:date';
    const empty=fault.empty?(daily?{data:[],total_rows:0,totals:[0]}:{data:[],total_rows:0,totals:u.searchParams.has('dimensions')?[0,0,0,null]:[0,0,0]}):{};
    return Response.json(metrikaResponse(u.searchParams,empty));
  };
  const metrika={owner:x.owner,mode:'fixture' as const,configId:'e3-fixture-only',api:createMetrikaApi(async()=> 'e3-fictional-token',metrikaTransport)};
  const analytics=createAnalyticsService(x.db,owner=>x.manager.resolve(owner),metrika);
  return{...x,calls,fault,metrika,analytics};
}
