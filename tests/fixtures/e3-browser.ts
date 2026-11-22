import { createHash,randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createApp } from '../../src/server.ts';
import { createYandexAuth } from '../../src/yandex-auth.ts';
import { e3Fixture } from './e3.ts';
export async function e3Browser(directory:string){
  const x=await e3Fixture(directory),clientId='e3-fixture-login';
  const auth=createYandexAuth(x.db,clientId,'fictional-secret',{requestJson:async()=>{throw new Error('Only local fixture login is supported');}});
  const server=createApp(x.db,auth,undefined,undefined,undefined,undefined,undefined,undefined,{},x.manager,x.metrika);
  const handler=server.listeners('request')[0] as any;server.removeAllListeners('request');
  server.on('request',(request,response)=>{
    if(request.method==='GET'&&/^\/fixture-login\/(a|b)$/.test(request.url??'')){
      const second=request.url!.endsWith('/b'),token=randomBytes(32).toString('base64url');
      x.db.createSession(createHash('sha256').update(`${clientId}:${token}`).digest('hex'),second?'yandex:202':x.owner,second?'Владелец Б · fixture':'Владелец А · fixture',Date.now()+3600000);
      response.writeHead(303,{'Set-Cookie':`goulash_session=${token}; Path=/; HttpOnly; SameSite=Lax`,Location:'/analytics'}).end();return;
    }
    if(request.method==='GET'&&request.url==='/fixture-state'){
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({fixture:true,liveCalls:0,paidCalls:0,pid:process.pid,calls:x.calls,permission:x.db.readDemoPermission(x.owner),demo:x.db.readDemo(x.owner),job:x.db.operationsView(x.owner).job,history:x.db.readHistory(x.owner)},null,2));return;
    }
    if(request.method==='GET'&&request.url==='/fixture-mode/error'){x.fault.directStatus=500;response.writeHead(303,{Location:'/analytics'}).end();return;}
    handler(request,response);
  });
  return{...x,server};
}
if(import.meta.main){const directory=resolve(process.argv[2]??'output/orchestration/E3-001/browser-data'),x=await e3Browser(directory);x.server.listen(Number(process.argv[3]??8791),'127.0.0.1',()=>{writeFileSync(join(directory,'server.json'),JSON.stringify({pid:process.pid,port:(x.server.address() as any).port,directory,fixture:true,liveCalls:0,paidCalls:0}));console.log(`E3 fixture http://127.0.0.1:${(x.server.address() as any).port}`);});}
