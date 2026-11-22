import { openDatabase } from '../../src/database.ts';
import { createPreparationService } from '../../src/preparation.ts';
import { e1Input } from './e1-scenario.ts';
const db = openDatabase(process.argv[2]);
const keeper = setInterval(() => {}, 1000);
const service = createPreparationService(db, { profile: async () => { process.stdout.write('pending\n'); return new Promise(() => {}); }, judge: async () => [] });
await service.action('local', 'entry', new URLSearchParams({ ...e1Input, preparationRevision: '0' }), 'Crash fixture');
await service.action('local', 'profile', new URLSearchParams({ preparationRevision: String(db.readPreparation('local')!.revision), aiConsent: 'yes' }), 'Crash fixture');
clearInterval(keeper);
