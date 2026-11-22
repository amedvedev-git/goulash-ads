import { openDatabase } from '../../src/database.ts';
import { createDirectConnections } from '../../src/direct-connect.ts';
import { createSecretCodec } from '../../src/direct-secrets.ts';
import { createDirectService } from '../../src/direct.ts';
import { confirmedPlan } from './confirmed-plan.ts';
import { fakeDirect } from './direct-api.ts';
import { exampleCampaign } from '../../src/campaign.ts';
export const fixtureKey=Buffer.alloc(32,71);
export const e2Draft={...exampleCampaign,budget:'7000',period:'7',title:'Ремонт холодильников',adText:'Ремонт холодильников на дому.',url:'https://example.com/e2-fixture'};
export function disconnectDirectFixture(db: ReturnType<typeof openDatabase>, manager: ReturnType<typeof createDirectConnections>, owner: string) {
  const session = 'fixture-disconnect:' + owner;
  if (!db.readSession(session)) db.createSession(session, owner, 'Владелец учебного кабинета', Date.now() + 3_600_000);
  const view = manager.view(owner, session, '');
  manager.disconnect(owner, session, new URLSearchParams({
    confirm: 'disconnect', generation: String(view.generation), account: view.account ?? '', disconnectProof: view.disconnectProof ?? '',
  }));
}
export function e2Fixture(directory:string,options:{clientId?:string;clientSecret?:string;transport?:typeof fetch;role?:string;codec?:ReturnType<typeof createSecretCodec>;liveLogin?:boolean}={}) {
  const db=openDatabase(directory),a=fakeDirect({account:'10101',login:'owner-a',role:options.role}),b=fakeDirect({account:'20202',login:'owner-b'});
  const clientId=options.clientId??'fixture-direct-app';
  const clientSecret=options.clientSecret??'fixture-app-secret';
  const provider:typeof fetch=async(url,init)=>{
    if(String(url)==='https://oauth.yandex.ru/token') {
      const body=init!.body as URLSearchParams;
      if(new Headers(init?.headers).get('Authorization')!==`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`)throw new Error('Wrong fixture app credentials');
      if(!body.get('code_verifier')||body.get('grant_type')!=='authorization_code')throw new Error('Invalid fixture code exchange');
      const code=body.get('code');if(!['a','b'].includes(code!))return new Response('{}',{status:400});
      return Response.json({access_token:`e2-fixture-${code}`,refresh_token:'discard-this-fixture-refresh',expires_in:3600});
    }
    const authorization=new Headers(init?.headers).get('Authorization')??'';
    const second=authorization.endsWith('-b');
    if(String(url)==='https://login.yandex.ru/info?format=json')return Response.json({client_id:clientId,id:second?'202':'101',login:second?'owner-b':'owner-a'});
    return (second?b:a).transport(url,init);
  };
  const codes = new Map([['yandex:101', 'a'], ['yandex:202', 'b']]);
  const manager=createDirectConnections(db,{clientId,clientSecret,codec:options.codec??createSecretCodec({platform:'linux',key:fixtureKey}),transport:options.transport??provider,mode:'fixture',
    fixture: { codeForOwner: owner => codes.get(owner), liveLogin: options.liveLogin } });
  const owner='yandex:101',session='fixture-session-a';
  async function connect(who=owner,code='a',binding=session) {
    const browser=manager.start(who,binding),view=manager.view(who,binding,browser),attempt=view.attempt!;
    await manager.finish(who,binding,browser,new URLSearchParams({attemptId:attempt.id,nonce:attempt.nonce,code}));
    manager.activate(who,binding,new URLSearchParams({candidateId:manager.view(who,binding,browser).candidate!.id,confirm:'yes'}));
  }
  function service(who=owner) { const c=manager.resolve(who);if(!c)throw new Error('Fixture not connected');return createDirectService(db,c); }
  function plan(who=owner,draft=e2Draft) { db.saveCampaign(who,draft,db.readCampaign(who)?.revision??0,'Fixture');return confirmedPlan(db,draft,['ремонт холодильников','мастер холодильников'],who,['бесплатно']); }
  async function action(action:string,fields:Record<string,string>={},who=owner) {
    const state=db.readDirect(who);
    await service(who).action(who,action,new URLSearchParams({planId:state?.planId??'',campaignPlanId:db.readPreparation(who)?.value.confirmedPlanId??'',revision:String(db.readCampaign(who)?.revision??0),storageRevision:String(state?.storageRevision??0),confirm:'yes',...fields}),'Fixture');
    if(action==='refresh')manager.reconciled(who,manager.resolve(who)!.generation!,state!.planId);
  }
  return {db,a,b,manager,provider,connect,service,plan,action,owner,session,disconnect: () => disconnectDirectFixture(db, manager, owner)};
}
