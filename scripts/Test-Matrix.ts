import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';

const files = readdirSync('tests').filter(file => file.endsWith('.test.ts')).sort();
const dpapi = ['direct-dpapi.test.ts'];
const release = ['deployment.test.ts', 'e4-deployment.test.ts', 'e4-recovery.test.ts'];
const groups = [
  { name: 'Приложение', files: files.filter(file => !dpapi.includes(file) && !release.includes(file)), concurrency: 2 },
  { name: 'Windows DPAPI', files: dpapi, concurrency: 1 },
  { name: 'Выкладка, миграция и восстановление', files: release, concurrency: 1 },
];
const total = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
for (const group of groups) {
  const started = performance.now();
  console.log('\n' + group.name);
  const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=' + group.concurrency,
    ...group.files.map(file => 'tests/' + file)], { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const closed = once(child, 'close');
  const summary = new Set<string>();
  for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    console.log(line);
    const stats = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (stats) {
      summary.add(stats[1]);
      total[stats[1] as keyof typeof total] += Number(stats[2]);
    }
  }
  const [code] = await closed;
  console.log(group.name + ' · ' + ((performance.now() - started) / 1000).toFixed(1) + ' с');
  if (code !== 0 || summary.size !== Object.keys(total).length) process.exitCode = 1;
}
console.log('\nИтог всех групп', total);
