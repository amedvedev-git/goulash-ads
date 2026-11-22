import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readDeploymentConfig } from './config.ts';
import type { DeploymentConfig } from './config.ts';
import { verifyRelease, productionHost } from './manage-release.ts';

export function prepareClean(source: string, c: DeploymentConfig) {
  const manifest = verifyRelease(source), app = join(c.root,'app');
  if (existsSync(app) || existsSync(c.data)) throw new Error('Clean installation requires absent app and data directories. Use update or restore.');
  mkdirSync(c.root,{recursive:true,mode:0o755});chmodSync(c.root,0o755);
  for (const file of Object.keys(manifest.files).filter(file=>file==='package.json'||file.startsWith('src/'))) {
    mkdirSync(dirname(join(app,file)),{recursive:true,mode:0o755});
    chmodSync(dirname(join(app,file)),0o755);
    copyFileSync(join(source,file),join(app,file));chmodSync(join(app,file),0o644);
  }
  return manifest;
}
if(import.meta.main) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Use the root Linux wrapper.');
  const source=process.argv[2],configFile=process.argv[3],c=readDeploymentConfig(configFile),unitFile=join('/etc/systemd/system',c.unit);
  if (!/^\/var\/lib\/goulash-ads(?:-e4-[a-z0-9-]+)?$/.test(c.data)) throw new Error('StateDirectory must be a dedicated /var/lib/goulash-ads[-e4-*].');
  if (existsSync(unitFile) || existsSync(c.caddySite)) throw new Error('Clean install does not overwrite an existing unit or Caddy site.');
  if (!/^v24\.(\d+)\.\d+$/.test(execFileSync(c.node,['--version'],{encoding:'utf8'}).trim()) || Number(execFileSync(c.node,['--version'],{encoding:'utf8'}).trim().split('.')[1])<12) throw new Error('Prepare Node24.12+<25 first.');
  const credentialDirectory=lstatSync(c.credentials);
  if(!credentialDirectory.isDirectory()||credentialDirectory.isSymbolicLink()||credentialDirectory.uid!==0||(credentialDirectory.mode&0o077))throw new Error('Prepare a root-owned0700 credential directory.');
  for (const credential of ['yandex_client_id','yandex_client_secret']) {
    const file=join(c.credentials,credential);
    if(!existsSync(file)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||lstatSync(file).uid!==0||!readFileSync(file).length)throw new Error('Prepare root-owned regular login credential files first.');
    chmodSync(file,0o600);
  }
  const run=(cmd:string,args:string[])=>execFileSync(cmd,args,{stdio:'pipe'});
  let caddyCommand:string[];
  if(c.caddyBinary){run(c.caddyBinary,['version']);caddyCommand=[c.caddyBinary];}
  else{
    const containers=execFileSync('docker',['ps','--filter','name=caddy','--format','{{.Names}}'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
    if(containers.length!==1)throw new Error('Expected one existing Caddy container with the site directory included.');
    caddyCommand=['docker','exec',containers[0],'caddy'];
  }
  const caddy=(action:string)=>run(caddyCommand[0],[...caddyCommand.slice(1),action,'--config',c.caddyConfig]);
  // Check the neighbouring service before creating any application files.
  if (c.suppliersOrigin) {
    const neighbour=new URL(c.suppliersOrigin);
    run('curl',['-fsS','--max-time','10','--resolve',`${neighbour.hostname}:${neighbour.port||443}:127.0.0.1`,c.suppliersOrigin+'/']);
  }
  const manifest=prepareClean(source,c);
  const unit=readFileSync(join(source,'deploy/goulash-ads.service'),'utf8')
    .replaceAll('/opt/goulash-ads/bin/node',c.node).replaceAll('/opt/goulash-ads/app',join(c.root,'app'))
    .replaceAll('/var/lib/goulash-ads',c.data).replaceAll('StateDirectory=goulash-ads','StateDirectory='+c.data.slice('/var/lib/'.length))
    .replaceAll('/etc/goulash-ads',c.credentials).replaceAll('172.18.0.1',c.bind).replaceAll('8767',String(c.port)).replaceAll('https://ads.example.org',c.publicOrigin)
    .replaceAll(' docker.service',c.caddyBinary?'':' docker.service');
  const siteDirectory = dirname(c.caddySite);
  if (!existsSync(siteDirectory)) {
    mkdirSync(siteDirectory,{recursive:true,mode:0o755});
    chmodSync(siteDirectory,0o755);
  }
  let started=false,switched=false;
  try {
    writeFileSync(unitFile,unit,{mode:0o644});run('systemd-analyze',['verify',unitFile]);run('systemctl',['daemon-reload']);
    run('systemctl',['start',c.unit]);started=true;
    writeFileSync(c.caddySite,`${new URL(c.publicOrigin).host} {\n\treverse_proxy ${c.bind}:${c.port}\n}\n`,{mode:0o644});switched=true;
    chmodSync(c.caddySite,0o644);
    caddy('validate');caddy('reload');
    await productionHost(c).health();
    run('systemctl',['enable',c.unit]);
    console.log(JSON.stringify({status:'installed-clean',releaseId:manifest.releaseId,config:configFile,unit:c.unit,schema:11}));
  } catch(error) {
    if(started)run('systemctl',['stop',c.unit]);
    // Retain all new code/data/config for diagnosis; only disable the site we created.
    if(switched){writeFileSync(c.caddySite,'# Failed clean installation; application data retained.\n');caddy('reload');}
    throw error;
  }
}
