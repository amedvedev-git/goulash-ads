import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { posix } from 'node:path';

export const defaults = { root: '/opt/goulash-ads', data: '/var/lib/goulash-ads', backups: '/var/backups/goulash-ads',
  node: '/opt/goulash-ads/bin/node', unit: 'goulash-ads.service', bind: '172.18.0.1', port: 8767,
  publicOrigin: 'https://ads.example.org', suppliersOrigin: 'https://suppliers.example.org',
  credentials: '/etc/goulash-ads', caddySite: '/srv/caddy/ads.example.org.caddy', caddyBinary: '', caddyConfig: '/etc/caddy/Caddyfile' };
export type DeploymentConfig = typeof defaults;
export function readDeploymentConfig(file = process.env.GOULASH_DEPLOY_CONFIG ?? '/etc/goulash-ads/deployment.json'): DeploymentConfig {
  if (!existsSync(file)) {
    if (process.env.GOULASH_DEPLOY_CONFIG) throw new Error('Deployment configuration not found.');
    return { ...defaults };
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.uid !== 0 || (stat.mode & 0o022)))) throw new Error('Deployment configuration must be a root-owned regular file without group/world write.');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!value || Object.keys(value).some(key => !Object.hasOwn(defaults,key))) throw new Error('Unknown deployment setting.');
  const c = { ...defaults, ...value };
  if (!Object.hasOwn(value, 'suppliersOrigin') && c.publicOrigin !== defaults.publicOrigin) c.suppliersOrigin = '';
  for (const key of ['root','data','backups','node','credentials','caddySite','caddyConfig',...c.caddyBinary?['caddyBinary' as const]:[]] as const)
    if (typeof c[key] !== 'string' || !/^\/[A-Za-z0-9_./-]+$/.test(c[key]) || posix.resolve(c[key]) !== c[key] || c[key] === '/') throw new Error('Invalid deployment path.');
  if (new Set([c.root,c.data,c.backups,c.credentials]).size !== 4 || !/^goulash-ads(?:-e4-[a-z0-9-]+)?\.service$/.test(c.unit) ||
      !isIPv4(c.bind) || c.bind === '0.0.0.0' || !Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw new Error('Invalid deployment topology.');
  for (const origin of c.suppliersOrigin === '' ? [c.publicOrigin] : [c.publicOrigin,c.suppliersOrigin]) {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin || !/^[a-z0-9.-]+$/.test(u.hostname) || u.username || u.password) throw new Error('Expected a plain HTTPS origin.');
  }
  return c;
}
