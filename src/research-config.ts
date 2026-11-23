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
  if (!['0', '1', 'ai-all'].includes(enabled)) throw new Error('GOULASH_RESEARCH_ENABLED: ожидается 0, 1 или ai-all.');
  if (enabled === '0') return { allowed: (_owner: string) => false };
  if (!authenticated || !env.CREDENTIALS_DIRECTORY) throw new Error('Серверному ИИ нужны вход через Яндекс ID и systemd credentials.');
  const credentialDirectory = env.CREDENTIALS_DIRECTORY;
  const secret = (name: string) => {
    const file = join(credentialDirectory, name);
    const value = readProtectedFile(file, credentialDirectory).toString('utf8').trim();
    if (!value || value.length > 16000) throw new Error('Credential исследования отсутствует или некорректен.');
    return value;
  };
  if (enabled === 'ai-all') return {
    allowed: (who: string) => /^yandex:\d{1,32}$/.test(who),
    intelligence: createPhraseIntelligence(secret('phrase_ai_key'), request),
  };
  const owner = env.GOULASH_RESEARCH_OWNER ?? '', version = env.GOULASH_RESEARCH_CONFIG_VERSION ?? '1';
  if (!/^yandex:[1-9]\d{0,19}$/.test(owner) || !/^[\w.-]{1,80}$/.test(version) ||
      !args.includes('--wordstat') || !args.includes('--phrase-ai')) {
    throw new Error('Исследование требует точного владельца, версию и оба --wordstat --phrase-ai.');
  }
  return { allowed: (who: string) => who === owner, owner, version,
    wordstat: createWordstat(secret('wordstat_api_key'), env.GOULASH_WORDSTAT_FOLDER ?? '', request),
    intelligence: createPhraseIntelligence(secret('phrase_ai_key'), request) };
}
