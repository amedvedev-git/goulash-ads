import { createHash,randomBytes } from 'node:crypto';
import { writeFileSync,readFileSync,existsSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { createApp } from '../../src/server.ts';
import { createYandexAuth } from '../../src/yandex-auth.ts';
import { e2Fixture } from './e2.ts';
export function e2Browser(directory:string) {
  let x:ReturnType<typeof e2Fixture>;
  const file=join(directory,'fixture-api.json');
  const transport:typeof fetch=async(url,init)=>{const response=await x.provider(url,init);writeFileSync(file,JSON.stringify({a:x.a.records,b:x.b.records,callsA:x.a.calls,callsB:x.b.calls},null,2));return response;};
  x=e2Fixture(directory,{transport});
  if(existsSync(file)){const saved=JSON.parse(readFileSync(file,'utf8'));Object.assign(x.a.records,saved.a);Object.assign(x.b.records,saved.b);x.a.calls.push(...saved.callsA);x.b.calls.push(...saved.callsB);}
  for(const who of [x.owner,'yandex:202'])if(!x.db.readPlan(who))x.plan(who);
  const auth=createYandexAuth(x.db,'fixture-login-app','fictional-login-secret',{requestJson:async()=>{throw new Error('Fixture browser uses only its local login shortcut.');}});
  const server=createApp(x.db,auth,undefined,undefined,undefined,undefined,undefined,undefined,{},x.manager);
  const original=server.listeners('request')[0] as any;server.removeAllListeners('request');
  server.on('request',(request,response)=>{
    if(request.method==='GET'&&/^\/fixture-login\/(a|b)$/.test(request.url??'')){
      const second=request.url!.endsWith('/b'),token=randomBytes(32).toString('base64url');
      x.db.createSession(createHash('sha256').update(`fixture-login-app:${token}`).digest('hex'),second?'yandex:202':x.owner,second?'Владелец B · fixture':'Владелец A · fixture',Date.now()+3600000);
      response.writeHead(303,{'Set-Cookie':`goulash_session=${token}; Path=/; HttpOnly; SameSite=Lax`,Location:'/'}).end();return;
    }
    if(request.method==='GET'&&request.url==='/fixture-state') {
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({fixture:true,liveCalls:0,paidCalls:0,pid:process.pid,a:{writes:x.a.writes().length,runs:x.db.readDirectRuns(x.owner)},b:{writes:x.b.writes().length,runs:x.db.readDirectRuns('yandex:202')}},null,2));return;
    }
    original(request,response);
  });
  return {...x,server};
}
if(import.meta.main){const directory=resolve(process.argv[2]??'output/orchestration/E2-001/browser-data'),x=e2Browser(directory);x.server.listen(Number(process.argv[3]??8785),'127.0.0.1',()=>{writeFileSync(join(directory,'server.json'),JSON.stringify({pid:process.pid,port:(x.server.address() as any).port,directory,fixture:true,liveCalls:0,paidCalls:0}));console.log(`E2 fixture http://127.0.0.1:${(x.server.address() as any).port}`);});}
