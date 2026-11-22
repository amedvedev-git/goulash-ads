import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, chownSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, statfsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaults, readDeploymentConfig } from './config.ts';
import type { DeploymentConfig } from './config.ts';
import { get as httpGet } from 'node:http';

export type Paths = { root: string; data: string; backups: string; node: string };
export type Host = { checkBefore(): Promise<void>; stop(): Promise<void>; start(): Promise<void>; health(): Promise<void> };
type Manifest = { format: 1; releaseId: string; sourceCommit: string; sourceDirty: boolean; files: Record<string, string> };
type DbInfo = { sha256: string; schema: number; uid: number; gid: number; mode: number };
type State = { format: 1; id: string; releaseId: string; phase: string; oldHash: string; newHash: string; database?: DbInfo };
const sidecars = ['-wal', '-shm', '-journal'];
export const productionPaths: Paths = {
  root: '/opt/goulash-ads', data: '/var/lib/goulash-ads', backups: '/var/backups/goulash-ads', node: '/opt/goulash-ads/bin/node',
};
const releaseTools = ['deploy/manage-release.ts', 'deploy/config.ts', 'deploy/probe-release.ts', 'deploy/rotate-direct-key.ts', 'deploy/backup-restore.ts',
  'deploy/install-clean.ts', 'deploy/install-clean.sh', 'deploy/goulash-ads.service',
  'deploy/deployment.config.example.json', 'deploy/runtime.conf.example', 'deploy/direct.conf.example', 'deploy/update-selectel.sh', 'deploy/rollback-selectel.sh',
  'deploy/README.md'];
const olderReleaseDocs = ['deploy/ads.example.org.caddy','docs/E1-PLAN.md','docs/E2-DIRECT.md','docs/E3-ANALYTICS.md','docs/E4-DELIVERY.md'];
export const deploymentFiles = [...releaseTools,'docs/handoff/SETUP.md','docs/handoff/ACCEPTANCE.md','docs/handoff/COMPONENTS.md'];
const baseUiAssets = ['Onest.ttf', 'OFL.txt', 'ui-client.js'];
export const uiAssetFiles = [...baseUiAssets, 'PixelifySans.ttf', 'PixelifySans-OFL.txt',
  'connection-client.js', 'connection-direct.png', 'connection-metrika.png', 'connection-advertiser.svg'].map(name => 'src/assets/' + name);
export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export function backendPage(bind: string, port: number, authority: string): Promise<{status:number;body:string}> {
  // Node24 fetch ignores custom Host; use HTTP directly for the application's strict authority check.
  return new Promise((resolve,reject)=>{
    const request=httpGet({host:bind,port,path:'/',headers:{Host:authority},timeout:3000},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>1024*1024)request.destroy(new Error('Oversized health response.'));});
      response.on('end',()=>resolve({status:response.statusCode??0,body}));response.on('error',reject);
    });request.on('timeout',()=>request.destroy(new Error('Backend health timeout.')));request.on('error',reject);
  });
}
const fileHash = (path: string) => sha256(readFileSync(path));
function requireCondition(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function inventory(directory: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), key = prefix + name, stat = lstatSync(path);
    requireCondition(!stat.isSymbolicLink(), `Symlinks are not allowed in code: ${key}`);
    if (stat.isDirectory()) Object.assign(result, inventory(path, key + '/'));
    else { requireCondition(stat.isFile(), `Unexpected file type: ${key}`); result[key] = fileHash(path); }
  }
  return result;
}
const treeHash = (directory: string) => sha256(JSON.stringify(inventory(directory)));
function writeJson(path: string, value: unknown) {
  const temp = path + '.tmp';
  const fd = openSync(temp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  syncDirectory(dirname(path));
}
function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}
function copyFiles(source: string, destination: string, files: string[]) {
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  chmodSync(destination, 0o755);
  syncDirectory(dirname(destination));
  for (const file of files) {
    mkdirSync(dirname(join(destination, file)), { recursive: true, mode: 0o755 });
    chmodSync(dirname(join(destination, file)), 0o755);
    const staged = join(destination, file) + '.new';
    copyFileSync(join(source, file), staged);
    chmodSync(staged, 0o644);
    const fd = openSync(staged, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(staged, join(destination, file));
    syncDirectory(dirname(join(destination, file)));
  }
}
export function makeManifest(directory: string, sourceCommit: string, sourceDirty = true) {
  const files = inventory(directory);
  const manifest: Manifest = { format: 1, releaseId: 'r-' + sha256(JSON.stringify(files)).slice(0, 20), sourceCommit, sourceDirty, files };
  writeJson(join(directory, 'release.json'), manifest);
  return manifest;
}
export function verifyRelease(directory: string): Manifest {
  const manifest = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8')) as Manifest;
  requireCondition(manifest.format === 1 && /^r-[a-f0-9]{20}$/.test(manifest.releaseId), 'Invalid release manifest.');
  const files = inventory(directory); delete files['release.json'];
  const expected = files['docs/handoff/SETUP.md'] ? deploymentFiles : [...releaseTools,...olderReleaseDocs];
  for (const file of Object.keys(files)) {
    requireCondition(file === 'package.json' || /^src\/[a-z-]+\.ts$/.test(file) ||
      uiAssetFiles.includes(file) || expected.includes(file), `Unexpected package member: ${file}`);
  }
  for (const required of ['package.json', 'src/server.ts', 'src/database.ts', ...expected]) requireCondition(files[required], `Missing package member: ${required}`);
  if (files['src/ui-style.ts']) for (const asset of baseUiAssets) requireCondition(files['src/assets/' + asset], `Missing UI asset: ${asset}`);
  requireCondition(JSON.stringify(files) === JSON.stringify(manifest.files) &&
    manifest.releaseId === 'r-' + sha256(JSON.stringify(files)).slice(0, 20), 'Package checksum mismatch.');
  return manifest;
}
export function inspectDatabase(file: string) {
  requireCondition(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'Expected a regular SQLite file.');
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    requireCondition(db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok', 'SQLite integrity check failed.');
    requireCondition(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'SQLite foreign key check failed.');
    const schema = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    const tables: Record<string, string> = {};
    for (const row of db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      const name = String(row.name);
      requireCondition(/^[a-z_]+$/.test(name), 'Unexpected SQLite table name.');
      // Compare rows without logging account data or session hashes.
      tables[name] = sha256(JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()));
    }
    return { schema, tables };
  } finally { db.close(); }
}
export async function snapshotDatabase(source: string, target: string): Promise<DbInfo> {
  requireCondition(!existsSync(target), 'Backup destination already exists.');
  requireCondition(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), 'Expected a regular source SQLite file.');
  const stat = statSync(source), db = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  try { await backup(db, target); } finally { db.close(); }
  chmodSync(target, 0o600);
  const fd = openSync(target, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(target));
  const inspected = inspectDatabase(target);
  return { sha256: fileHash(target), schema: inspected.schema, uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 };
}
function migrateAndVerify(paths: Paths, candidate: string, data: string) {
  const file = join(data, 'stage2.sqlite'), before = inspectDatabase(file);
  requireCondition([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(before.schema), `Unsupported previous schema: ${before.schema}`);
  let legacy: any[] | undefined;
  if (Object.hasOwn(before.tables,'direct_bindings')) {
    const old = new DatabaseSync(file,{readOnly:true});
    try { legacy=old.prepare('SELECT owner,account,payload FROM direct_bindings').all(); } finally { old.close(); }
  }
  execFileSync(paths.node, [join(candidate, 'deploy/probe-release.ts'), data], { timeout: 30000, stdio: 'pipe' });
  const after = inspectDatabase(file);
  requireCondition(after.schema === 11, 'Expected schema v11 after migration.');
  // The scoped storage appends campaign_id without rewriting legacy payloads or revisions.
  const legacyColumns = {
    campaign_drafts: 'owner,payload,revision',
    campaign_preparations: 'owner,revision,payload',
    campaign_plans: 'owner,id,preparation_revision,payload',
    campaign_strategy_runs: 'owner,id,revision,payload',
    phrase_plans: 'owner,payload',
    operation_history: 'id,owner,mode,object,kind,actor,at,reason,before_json,after_json,revision,linked_id',
  } as Record<string, string>;
  for (const [table, hash] of Object.entries(before.tables)) {
    if(table==='direct_bindings'&&legacy)continue;
    if(table==='demo_jobs'&&before.schema<10){
      const migrated=new DatabaseSync(file,{readOnly:true});
      try{requireCondition(sha256(JSON.stringify(migrated.prepare('SELECT id,owner,mode,dataset_id,actor,status,result_id FROM demo_jobs ORDER BY rowid').all()))===hash,'Migration changed existing demo jobs.');}finally{migrated.close();}
      continue;
    }
    if (before.schema < 11 && Object.hasOwn(legacyColumns, table)) {
      const migrated = new DatabaseSync(file, { readOnly: true });
      try {
        const rows = migrated.prepare(`SELECT ${legacyColumns[table]} FROM "${table}" ORDER BY rowid`).all();
        requireCondition(sha256(JSON.stringify(rows)) === hash, `Migration changed existing rows in ${table}.`);
        const wrongScope = migrated.prepare(`SELECT 1 FROM "${table}" WHERE campaign_id IS NOT ${table === 'operation_history'
          ? "(CASE object WHEN 'draft' THEN 'default' END)" : "'default'"} LIMIT 1`).get();
        requireCondition(!wrongScope, `Migration changed campaign scope in ${table}.`);
      } finally { migrated.close(); }
      continue;
    }
    requireCondition(after.tables[table] === hash, `Migration changed existing rows in ${table}.`);
  }
  if(legacy) {
    const migrated=new DatabaseSync(file,{readOnly:true});
    try { for(const row of legacy) {
      const actual=migrated.prepare('SELECT payload FROM direct_runs WHERE owner=? AND id=? AND account=?').get(row.owner,JSON.parse(row.payload).planId,row.account);
      requireCondition(actual?.payload===row.payload,'Migration changed a legacy Direct journal.');
    }}finally{migrated.close();}
  }
  return { from: before.schema, to: after.schema, preservedTables: Object.keys(before.tables) };
}
function readState(paths: Paths): State | undefined {
  const file = join(paths.root, 'deployment.json');
  if (!existsSync(file)) return;
  const state = JSON.parse(readFileSync(file, 'utf8')) as State;
  requireCondition(state.format === 1 && /^r-[a-f0-9]{20}-[a-f0-9-]{36}$/.test(state.id), 'Invalid deployment journal.');
  return state;
}
function saveState(paths: Paths, state: State) {
  writeJson(join(paths.backups, state.id, 'deployment.json'), state);
  writeJson(join(paths.root, 'deployment.json'), state);
}
function freeSpace(directory: string, required: number) {
  const stat = statfsSync(directory, { bigint: true });
  requireCondition(stat.bavail * stat.bsize >= BigInt(required) + 64n * 1024n * 1024n, `Insufficient free space: ${directory}`);
}
function sizeOf(directory: string) { return Object.keys(inventory(directory)).reduce((sum, file) => sum + statSync(join(directory, file)).size, 0); }
function restoreOwnership(file: string, info: DbInfo) {
  chmodSync(file, info.mode);
  if (process.platform !== 'win32') chownSync(file, info.uid, info.gid);
}

export async function rollback(paths: Paths, host: Host) {
  const state = readState(paths);
  requireCondition(state, 'No deployment journal found.');
  if (state.phase === 'rolled-back') return { status: 'already-rolled-back', id: state.id };
  const directory = join(paths.root, 'releases', state.id), previous = join(directory, 'previous');
  const app = join(paths.root, 'app'), backupDir = join(paths.backups, state.id), snapshot = join(backupDir, 'before.sqlite');
  if (existsSync(previous)) requireCondition(treeHash(previous) === state.oldHash, 'Previous code checksum mismatch; refusing rollback.');
  else requireCondition(existsSync(app) && treeHash(app) === state.oldHash, 'Previous code is unavailable; refusing rollback.');
  if (existsSync(app)) requireCondition([state.oldHash, state.newHash].includes(treeHash(app)), 'Installed code changed outside this update; refusing overwrite.');
  if (state.database) {
    requireCondition(fileHash(snapshot) === state.database.sha256, 'Backup checksum mismatch; refusing restore.');
    requireCondition(inspectDatabase(snapshot).schema === state.database.schema, 'Backup schema mismatch.');
  }
  state.phase = 'rolling-back'; saveState(paths, state);
  await host.stop();
  if (state.database) {
    const live = join(paths.data, 'stage2.sqlite'), preserved = join(backupDir, 'after-update');
    mkdirSync(preserved, { recursive: true, mode: 0o700 });
    // Preserve every raw SQLite file even if the failed database cannot be opened.
    if (!existsSync(join(preserved, 'complete'))) {
      for (const suffix of ['', ...sidecars]) if (existsSync(live + suffix)) {
        requireCondition(lstatSync(live + suffix).isFile() && !lstatSync(live + suffix).isSymbolicLink(), 'Unexpected SQLite sidecar.');
        copyFileSync(live + suffix, join(preserved, 'stage2.sqlite' + suffix));
        chmodSync(join(preserved, 'stage2.sqlite' + suffix), 0o600);
        const fd = openSync(join(preserved, 'stage2.sqlite' + suffix), 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
      }
      writeJson(join(preserved, 'complete'), { preservedAt: new Date().toISOString() });
    }
    const replacement = join(paths.data, 'stage2.restore.sqlite');
    copyFileSync(snapshot, replacement); restoreOwnership(replacement, state.database);
    const fd = openSync(replacement, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
    for (const suffix of sidecars) if (existsSync(live + suffix)) unlinkSync(live + suffix);
    renameSync(replacement, live); syncDirectory(paths.data);
  }
  if (existsSync(previous)) {
    if (existsSync(app)) renameSync(app, join(directory, 'failed-app'));
    renameSync(previous, app); syncDirectory(paths.root); syncDirectory(directory);
  }
  await host.start(); await host.health();
  state.phase = 'rolled-back'; saveState(paths, state);
  return { status: 'rolled-back', id: state.id, schema: state.database?.schema };
}

export async function update(paths: Paths, host: Host, source: string) {
  const manifest = verifyRelease(source), last = readState(paths), app = join(paths.root, 'app');
  if (last?.phase === 'committed' && last.releaseId === manifest.releaseId) {
    requireCondition(treeHash(app) === last.newHash, 'Installed code differs from the recorded release.');
    await host.health(); return { status: 'already-installed', id: last.id };
  }
  requireCondition(!last || ['committed', 'rolled-back'].includes(last.phase), 'Interrupted deployment found. Run rollback before another update.');
  requireCondition(lstatSync(app).isDirectory() && !lstatSync(app).isSymbolicLink(), 'Expected existing app directory; this is not a first-install script.');
  const version = execFileSync(paths.node, ['--version'], { encoding: 'utf8' }).trim();
  requireCondition(/^v24\.(\d+)\.\d+$/.test(version) && Number(version.split('.')[1]) >= 12, 'Node.js 24.12+ is required; update does not replace Node.');
  await host.checkBefore();
  mkdirSync(paths.backups, { recursive: true, mode: 0o700 }); chmodSync(paths.backups, 0o700);
  const dbFile = join(paths.data, 'stage2.sqlite');
  const dbSize = ['', ...sidecars].reduce((n, suffix) => n + (existsSync(dbFile + suffix) ? statSync(dbFile + suffix).size : 0), 0);
  freeSpace(paths.backups, dbSize * 4); freeSpace(paths.data, dbSize * 2); freeSpace(paths.root, sizeOf(app) + sizeOf(source) * 3);
  const id = `${manifest.releaseId}-${randomUUID()}`, directory = join(paths.root, 'releases', id), backupDir = join(paths.backups, id);
  mkdirSync(directory, { recursive: true, mode: 0o755 }); mkdirSync(backupDir, { mode: 0o700 });
  chmodSync(join(paths.root, 'releases'), 0o755); chmodSync(directory, 0o755);
  syncDirectory(paths.root); syncDirectory(join(paths.root, 'releases'));
  const candidate = join(directory, 'package'), next = join(directory, 'next');
  copyFiles(source, candidate, [...Object.keys(manifest.files), 'release.json']);
  requireCondition(verifyRelease(candidate).releaseId === manifest.releaseId, 'Staged package differs from source.');
  const appFiles = Object.keys(manifest.files).filter((file) => file === 'package.json' || file.startsWith('src/'));
  copyFiles(candidate, next, appFiles);
  for (const file of appFiles.filter((f) => f.endsWith('.ts'))) execFileSync(paths.node, ['--check', join(next, file)], { timeout: 15000, stdio: 'pipe' });
  const rehearsal = join(backupDir, 'rehearsal'); mkdirSync(rehearsal, { mode: 0o700 });
  await snapshotDatabase(dbFile, join(rehearsal, 'stage2.sqlite'));
  const preflight = migrateAndVerify(paths, candidate, rehearsal);
  writeJson(join(backupDir, 'preflight.json'), { ...preflight, releaseId: manifest.releaseId });
  // Install the recovery tool before stopping the service; its path survives deletion of the upload directory.
  copyFiles(candidate, join(paths.root, 'tools'), ['deploy/manage-release.ts', 'deploy/config.ts', 'deploy/backup-restore.ts', 'deploy/rollback-selectel.sh',
    'src/direct-secrets.ts', 'src/protected-file.ts', 'src/direct-api.ts', 'src/direct-reports.ts']);
  copyFileSync(join(candidate, 'package.json'), join(paths.root, 'tools/package.json'));
  const state: State = { format: 1, id, releaseId: manifest.releaseId, phase: 'prepared', oldHash: treeHash(app), newHash: treeHash(next) };
  saveState(paths, state);
  try {
    await host.stop();
    state.database = await snapshotDatabase(dbFile, join(backupDir, 'before.sqlite'));
    state.phase = 'backed-up'; saveState(paths, state);
    state.phase = 'switching'; saveState(paths, state);
    renameSync(app, join(directory, 'previous')); renameSync(next, app); syncDirectory(paths.root); syncDirectory(directory);
    const migration = migrateAndVerify(paths, candidate, paths.data);
    for (const suffix of ['', ...sidecars]) if (existsSync(dbFile + suffix)) restoreOwnership(dbFile + suffix, state.database);
    state.phase = 'running'; saveState(paths, state);
    await host.start(); await host.health();
    state.phase = 'committed'; saveState(paths, state);
    return { status: 'installed', id, ...migration, backup: backupDir };
  } catch (error) {
    try { await rollback(paths, host); }
    catch (recovery) { throw new Error(`Update failed; automatic rollback incomplete. Run the rollback command. ${recovery instanceof Error ? recovery.message : ''}`); }
    throw new Error(`Update failed; previous code and database restored. ${error instanceof Error ? error.message : ''}`);
  }
}

function command(name: string, args: string[]) { return execFileSync(name, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function checkSuppliers(c: DeploymentConfig) {
  if (!c.suppliersOrigin) return;
  const url = new URL(c.suppliersOrigin);
  requireCondition(command('curl', ['-fsS', '--max-time', '10', '--resolve', `${url.hostname}:${url.port || 443}:127.0.0.1`, '-o', '/dev/null', '-w', '%{http_code}', c.suppliersOrigin + '/']) === '200', 'Suppliers health check failed.');
}
export function productionHost(c: DeploymentConfig = defaults): Host {
  const unit = c.unit, origin = new URL(c.publicOrigin);
  return {
    async checkBefore() {
      requireCondition(command('systemctl', ['is-active', unit]) === 'active', 'The existing service must be active.');
      const exec = command('systemctl', ['show', unit, '--property=ExecStart', '--value']);
      requireCondition(exec.includes(c.node) && exec.includes(join(c.root,'app/src/server.ts')) && !exec.includes('--deepseek-trial'), 'Unexpected service command.');
      requireCondition(command('systemctl', ['show', unit, '--property=WorkingDirectory', '--value']) === join(c.root,'app'), 'Unexpected service working directory.');
      const environment = command('systemctl', ['show', unit, '--property=Environment', '--value']);
      for (const expected of [`GOULASH_DATA_DIR=${c.data}`, `GOULASH_BIND=${c.bind}`, `GOULASH_PORT=${c.port}`, `GOULASH_PUBLIC_ORIGIN=${c.publicOrigin}`]) {
        requireCondition(environment.split(' ').includes(expected), 'Service environment differs from the supported configuration.');
      }
      requireCondition(command('systemctl', ['show', unit, '--property=StateDirectory', '--value']) === c.data.replace('/var/lib/',''), 'Unexpected systemd StateDirectory.');
      const data = realpathSync(c.data);
      requireCondition([c.data,c.data.replace('/var/lib/','/var/lib/private/')].includes(data), 'Unexpected StateDirectory.');
      await this.health();
    },
    async stop() {
      command('systemctl', ['stop', unit]);
      requireCondition(['inactive','failed'].includes(command('systemctl', ['show', unit, '--property=ActiveState', '--value'])) &&
        command('systemctl', ['show', unit, '--property=MainPID', '--value']) === '0', 'Service did not stop; database must not be replaced.');
    },
    async start() { command('systemctl', ['start', unit]); },
    async health() {
      let good = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const response = await backendPage(c.bind,c.port,origin.host);
          good = response.status === 200 && response.body.includes('Войти через Яндекс ID') && response.body.includes('href="/auth/yandex"') && command('systemctl', ['is-active', unit]) === 'active';
          if (good) break;
        } catch { /* Service can take a moment to bind after systemctl start. */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      requireCondition(good, 'Application backend health check failed.');
      const body = command('curl', ['-fsS', '--max-time', '10', '--resolve', `${origin.hostname}:${origin.port || 443}:127.0.0.1`, c.publicOrigin + '/']);
      requireCondition(body.includes('Войти через Яндекс ID') && body.includes('href="/auth/yandex"'), 'HTTPS health check failed.');
      checkSuppliers(c);
    },
  };
}
if (import.meta.main) {
  try {
    requireCondition(process.platform === 'linux' && process.arch === 'x64' && process.getuid?.() === 0 && process.env.GOULASH_DEPLOY_LOCKED === '1', 'Use the sudo bash wrapper on Selectel.');
    process.umask(0o077);
    const mode = process.argv[2];
    requireCondition(mode === 'update' || mode === 'rollback', 'Expected update or rollback.');
    const c = readDeploymentConfig(), host = productionHost(c);
    const result = mode === 'update' ? await update(c, host, resolve(process.argv[3])) : await rollback(c, host);
    console.log(JSON.stringify(result, null, 2));
    console.log('Rollback: sudo bash /opt/goulash-ads/tools/deploy/rollback-selectel.sh');
  } catch (error) { console.error(error instanceof Error ? error.message : 'Deployment failed.'); process.exitCode = 1; }
}
