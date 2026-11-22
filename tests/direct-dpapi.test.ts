import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecretCodec } from '../src/direct-secrets.ts';
import { dpapiToken } from '../src/direct-api.ts';

test('Direct Windows: официальный DPAPI save-format и старые файлы', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'goulash-dpapi-'));
  t.after(() => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); });
  const secret = 'fictional-direct-app-secret';
  const script = `
    $ErrorActionPreference = 'Stop'
    function Read-Host { param([string]$Prompt, [switch]$AsSecureString); ConvertTo-SecureString 'fictional-direct-app-secret' -AsPlainText -Force }
    & $env:GOULASH_DPAPI_TEST_SCRIPT -ClientId 'fictional-app' -Directory $env:GOULASH_DPAPI_TEST_DIR
  `;
  await promisify(execFile)('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 10000,
    env: { ...process.env, GOULASH_DPAPI_TEST_SCRIPT: fileURLToPath(new URL('../scripts/Connect-DirectApp.ps1', import.meta.url)), GOULASH_DPAPI_TEST_DIR: dir },
  });
  const path = join(dir, 'DirectApp.dpapi'), saved = readFileSync(path, 'utf8');
  await t.test('новое сохранение без newline и roundtrip настоящим reader', async () => {
    assert.ok(/^[0-9a-f]+$/i.test(saved), 'DPAPI ciphertext must contain only hex, without BOM or newline');
    assert.equal(readFileSync(join(dir, 'DirectApp.client-id'), 'utf8').trim(), 'fictional-app');
    assert.equal(await dpapiToken(path)(), secret);
  });
  // Set-Content used by the previous writer appends CRLF on Windows; ReadAllText also accepts UTF-8 BOM.
  for (const [name, prefix, suffix] of [
    ['без newline', '', ''], ['legacy CRLF', '', '\r\n'], ['LF', '', '\n'], ['UTF-8 BOM и CRLF', '\ufeff', '\r\n'],
  ]) await t.test(name, async () => {
    const variant = join(dir, `${name}.dpapi`);
    writeFileSync(variant, `${prefix}${saved.trim()}${suffix}`);
    assert.equal(await dpapiToken(variant)(), secret);
  });
  await t.test('повреждённый ciphertext остаётся недоступным', async () => {
    const invalid = join(dir, 'invalid.dpapi');
    writeFileSync(invalid, `${saved.trim().slice(0, -8)}\r\n`);
    await assert.rejects(dpapiToken(invalid)(), /Сохранённый токен недоступен текущей учётной записи Windows/);
  });
});

test('E2 Windows: DPAPI CurrentUser на вымышленном секрете и другом контексте', {skip:process.platform!=='win32'},async()=>{
  const codec=createSecretCodec(),envelope=await codec.protect('fictional-dpapi-e2','owner-101');assert.equal(envelope.kind,'dpapi');assert.equal(await codec.unprotect(envelope,'owner-101'),'fictional-dpapi-e2');await assert.rejects(codec.unprotect(envelope,'owner-202'));
});
