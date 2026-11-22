import { DatabaseSync,backup } from 'node:sqlite';
import { existsSync,chmodSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createSecretCodec } from '../src/direct-secrets.ts';

// Run only with the service stopped; the backup must retain its old encryption key.
export async function rotateDirectKey(directory:string,oldKey:string,newKey:string,backupFile:string,apply=false) {
  if(process.platform!=='linux')throw new Error('Смена серверного ключа выполняется в Linux после остановки службы.');
  const file=join(directory,'stage2.sqlite');
  if(resolve(file)===resolve(backupFile)||existsSync(backupFile))throw new Error('Нужен новый отдельный путь резервной копии.');
  const oldCodec=createSecretCodec({keyFile:oldKey}),newCodec=createSecretCodec({keyFile:newKey}),db=new DatabaseSync(file,{timeout:5000});
  try {
    if(![9,10,11].includes(Number(db.prepare('PRAGMA user_version').get()!.user_version)))throw new Error('Нужна схема SQLite 9, 10 или 11.');
    for(const row of db.prepare('SELECT pid FROM direct_lock').all()){
      try{process.kill(Number(row.pid),0);throw new Error('Есть живой процесс операции. Остановите службу.');}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    }
    const rows=db.prepare('SELECT owner,generation,payload FROM direct_connections').all() as any[];
    const replacements=[];
    for(const row of rows){
      const value=JSON.parse(row.payload);let changed=false;
      for(const [target,generation] of [[value,row.generation],[value.candidate,(value.candidate?.generation??0)+1]] as any[]){
        if(!target?.envelope)continue;
        const context=JSON.stringify([row.owner,target.clientId,generation]);
        target.envelope=await newCodec.protect(await oldCodec.unprotect(target.envelope,context),context);changed=true;
      }
      if(changed)replacements.push({...row,next:JSON.stringify(value)});
    }
    if(!apply)return {changed:0,eligible:replacements.length,applied:false};
    await backup(db,backupFile);chmodSync(backupFile,0o600);
    db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of replacements){const result=db.prepare('UPDATE direct_connections SET payload=? WHERE owner=? AND generation=? AND payload=?').run(row.next,row.owner,row.generation,row.payload);if(result.changes!==1)throw new Error('Подключение изменилось во время смены ключа; транзакция отменена.');}
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {changed:replacements.length,applied:true,backup:backupFile};
  }finally{db.close();}
}
if(import.meta.main){const args=process.argv.slice(2);if(args.length<4||!args.includes('--stopped'))throw new Error('Использование: node deploy/rotate-direct-key.ts <data-dir> <old-key> <new-key> <new-backup-file> --stopped [--apply]');console.log(JSON.stringify(await rotateDirectKey(args[0],args[1],args[2],args[3],args.includes('--apply'))));}
