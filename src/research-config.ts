import { join } from 'node:path';
import { createPhraseIntelligence } from './phrase-intelligence.ts';
import { createWordstat } from './search-phrases.ts';
import { readProtectedFile } from './protected-file.ts';

export function localResearchAccess(authenticated: boolean, args: string[], env: NodeJS.ProcessEnv) {
  if (!authenticated || (!args.includes('--wordstat') && !args.includes('--phrase-ai'))) return undefined;
  const owner = env.GOULASH_RESEARCH_OWNER || env.GOULASH_DIRECT_OWNER;
  if (!owner || !/^yandex:[1-9]\d{0,19}$/.test(owner)) throw new Error('Для локальных платных провайдеров укажите GOULASH_RESEARCH_OWNER — точного владельца Яндекс ID.');
  return (who: string) => who === owner;
}

// Server research credentials are administrative capabilities, separate from each form's consent.
export function loadServerResearch(authenticated: boolean, args: string[], env: NodeJS.ProcessEnv, request: typeof fetch = fetch) {
  const enabled = env.GOULASH_RESEARCH_ENABLED ?? '0';
  if (!['0', '1'].includes(enabled)) throw new Error('GOULASH_RESEARCH_ENABLED: ожидается 0 или 1.');
  if (enabled === '0') return { allowed: (_owner: string) => false };
  const owner = env.GOULASH_RESEARCH_OWNER ?? '', version = env.GOULASH_RESEARCH_CONFIG_VERSION ?? '1';
  if (!authenticated || !/^yandex:[1-9]\d{0,19}$/.test(owner) || !/^[\w.-]{1,80}$/.test(version) ||
      !env.CREDENTIALS_DIRECTORY || !args.includes('--wordstat') || !args.includes('--phrase-ai')) {
    throw new Error('Исследование требует вход, точного владельца, версию, systemd credentials и оба --wordstat --phrase-ai.');
  }
  const secret = (name: string) => {
    const file = join(env.CREDENTIALS_DIRECTORY!, name);
    const value = readProtectedFile(file,env.CREDENTIALS_DIRECTORY).toString('utf8').trim();
    if (!value || value.length > 16000) throw new Error('Credential исследования отсутствует или некорректен.');
    return value;
  };
  return { allowed: (who: string) => who === owner, owner, version,
    wordstat: createWordstat(secret('wordstat_api_key'), env.GOULASH_WORDSTAT_FOLDER ?? '', request),
    intelligence: createPhraseIntelligence(secret('phrase_ai_key'), request) };
}
