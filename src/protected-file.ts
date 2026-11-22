import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function readProtectedFile(file: string, credentialDirectory?: string): Buffer {
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Credential должен быть обычным файлом.');
  if(process.platform!=='win32'&&(stat.mode&0o077)){
    // systemd can deliver root:root 0440 credentials with an ACL for DynamicUser.
    const directory=credentialDirectory&&realpathSync(credentialDirectory),parent=directory&&lstatSync(directory);
    const unit=directory?.slice('/run/credentials/'.length);
    const serviceContext=unit&&/^[\w.@-]+\.service$/.test(unit)&&readFileSync('/proc/self/cgroup','utf8').trim().split('/').includes(unit);
    if(!directory||resolve(credentialDirectory!)!==directory||process.env.CREDENTIALS_DIRECTORY!==credentialDirectory||
        !/^[a-f0-9]{32}$/.test(process.env.INVOCATION_ID??'')||!serviceContext||!directory.startsWith('/run/credentials/')||resolve(dirname(file))!==directory||
        realpathSync(dirname(file))!==directory||!parent?.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||parent.gid!==0||
        (parent.mode&0o027)!==0||stat.uid!==0||stat.gid!==0||![0o400,0o440].includes(stat.mode&0o777))throw new Error('Credential должен быть доступен только владельцу или через защищённый systemd ACL.');
  }
  return readFileSync(file);
}
