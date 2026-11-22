import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { DirectError } from './direct-api.ts';
import { readProtectedFile } from './protected-file.ts';

export type SecretEnvelope = { version: 1; kind: 'dpapi' | 'aes-gcm'; data: string; nonce?: string; tag?: string };
export type SecretCodec = { protect(value: string, context: string): Promise<SecretEnvelope>; unprotect(value: SecretEnvelope, context: string): Promise<string> };
export const metrikaSecretContext = (owner: string, clientId: string, connectionId: string) => JSON.stringify(['metrika', owner, clientId, connectionId]);

function dpapi(value: string, context: string, decrypt: boolean): Promise<string> {
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd() | ConvertFrom-Json; $b=[Convert]::FromBase64String($v.data); $a=[Text.Encoding]::UTF8.GetBytes($v.context); $r=[Security.Cryptography.ProtectedData]::${method}($b,$a,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = execFile('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 10000, maxBuffer: 32768 }, (error, stdout) => {
        if (error || !stdout.trim()) reject(new DirectError('Защищённый доступ недоступен текущему пользователю Windows.'));
        else resolve(stdout.trim());
      });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ data: value, context }));
  });
}

export function createSecretCodec(options: { platform?: string; key?: Buffer; keyFile?: string; credentialDirectory?: string } = {}): SecretCodec {
  const platform = options.platform ?? process.platform;
  let key = options.key;
  if (platform !== 'win32') {
    if (!key && options.keyFile) {
      try { key = readProtectedFile(options.keyFile,options.credentialDirectory); }
      catch { throw new DirectError('Файл ключа должен быть обычным файлом с доступом только владельца или защищённого systemd credential.'); }
    }
    if (key?.length !== 32) throw new DirectError('Для защищённого доступа нужен отдельный 32-байтный ключ.');
  }
  return {
    async protect(value, context) {
      if (!value || value.length > 16000) throw new DirectError('Некорректные данные доступа.');
      if (platform === 'win32') return { version: 1, kind: 'dpapi', data: await dpapi(Buffer.from(value).toString('base64'), context, false) };
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key!, nonce);
      cipher.setAAD(Buffer.from(context));
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return { version: 1, kind: 'aes-gcm', data: data.toString('base64'), nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    },
    async unprotect(value, context) {
      try {
        if (value.version !== 1) throw new Error();
        if (platform === 'win32') {
          if (value.kind !== 'dpapi') throw new Error();
          return Buffer.from(await dpapi(value.data, context, true), 'base64').toString('utf8');
        }
        if (value.kind !== 'aes-gcm') throw new Error();
        const cipher = createDecipheriv('aes-256-gcm', key!, Buffer.from(value.nonce!, 'base64'));
        cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(value.tag!, 'base64'));
        return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8');
      } catch { throw new DirectError('Защищённый доступ не прочитан. Подключите кабинет заново.'); }
    },
  };
}
