import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the real browser script's persistence contract; no duplicate implementation of its logic.
const script = readFileSync(new URL('../src/assets/ui-client.js', import.meta.url), 'utf8');
function load(store: Map<string, string>, options: { dirty?: boolean; saved?: boolean; scope?: string; title?: string } = {}) {
  const listeners = new Map<string, () => void>();
  const directListeners = new Map<string, (event: { preventDefault(): void; submitter?: unknown }) => void>();
  const windowListeners = new Map<string, (event: { preventDefault(): void; returnValue?: string }) => void>();
  const values = { description: 'Тестовый пример', url: 'https://example.com', region: 'Пермь', budget: '7000', period: '7', title: options.title ?? 'Сохранённый текст', adText: 'Текст объявления' };
  const controls = Object.fromEntries(Object.entries({ ...values, revision: '1' }).map(([key, value]) => [key, { value }]));
  const form = {
    dataset: { scope: options.scope ?? 'a', dirty: options.dirty ? '1' : '0', saved: options.saved ? '1' : '0', restore: '1', step: '1', resumeAction: '/campaign/resume' },
    elements: { ...controls, namedItem: (key: string) => controls[key] },
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener), querySelectorAll: () => [],
  };
  const recovery = { hidden: true }, state = { textContent: 'Сохранено', classList: { toggle() {} }, scrollIntoView() {} };
  const directForm = { addEventListener: (event: string, listener: any) => directListeners.set(event, listener), setAttribute() {} };
  const button = { addEventListener() {} }, note = { textContent: '' };
  const nodes: Record<string, unknown> = { '#campaign-form': form, '#recovery': recovery, '#save-state': state, '#restore-work': button, '#discard-work': button, '#local-recovery-note': note };
  let replacedUrl = '';
  runInNewContext(script, {
    document: { addEventListener() {}, querySelector: (selector: string) => nodes[selector], querySelectorAll: (selector: string) => selector === 'form[action^="/direct/"]' ? [directForm] : [] },
    queueMicrotask: fn => fn(),
    sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
    window: { addEventListener: (event: string, listener: (event: { preventDefault(): void; returnValue?: string }) => void) => windowListeners.set(event, listener) }, URL, location: { href: 'http://localhost/?campaign=saved' },
    history: { replaceState: (_state: unknown, _title: string, url: string) => { replacedUrl = url; } },
  });
  return { recovery, controls, listeners, windowListeners, replacedUrl, directListeners, state };
}

test('клиент: прямой пример не стирает прежний ввод, после сохранения обновление восстанавливает новую правку, аккаунты разделены', () => {
  const key = 'goulash-work:a';
  const old = JSON.stringify({ values: { title: 'Прежний несохранённый текст' }, revision: '1', step: '3' });
  const store = new Map([[key, old]]);
  const example = load(store, { dirty: true });
  assert.equal(example.recovery.hidden, false);
  assert.equal(store.get(key), old, 'an example must leave the recovery copy intact');
  example.windowListeners.get('beforeunload')!({ preventDefault() {} });
  assert.equal(store.get(key), old, 'even a cancelled reload must preserve the offered recovery copy');
  assert.equal(load(store, { scope: 'b' }).recovery.hidden, true, 'another account must not offer this copy');
  const saved = load(store, { saved: true });
  assert.equal(store.has(key), false); assert.equal(saved.replacedUrl, '/campaign');
  saved.controls.title.value = 'Новый ввод после сохранения'; saved.listeners.get('input')!();
  const unsaved = store.get(key)!; assert.match(unsaved, /Новый ввод после сохранения/);
  assert.equal(load(store).recovery.hidden, false);
  assert.equal(store.get(key), unsaved, 'reload must not consume the prior save acknowledgement again');
});

test('клиент: несохранённый ручной ввод блокирует отправку прежней версии в Директ; двойной submit блокируется', () => {
  const page = load(new Map()); let prevented = false;
  page.controls.title.value = 'Несохранённая правка'; page.listeners.get('input')!();
  page.directListeners.get('submit')!({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.match(page.state.textContent, /Сначала сохраните/);
  const clean = load(new Map()); prevented = false;
  clean.directListeners.get('submit')!({ preventDefault() { prevented = true; } }); assert.equal(prevented, false);
  clean.directListeners.get('submit')!({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
});

function loadPlan(store: Map<string, string>, address: string, scope = 'a') {
  const controls = { title: { value: 'Сохранённый заголовок' }, preparationRevision: { value: '4' }, formStep: { value: '3' } };
  const listeners = new Map<string, () => void>(), buttonListeners = new Map<string, () => void>();
  const recovery = { hidden: true }, state = { textContent: 'Рабочий ввод сохранён' };
  const url = new URL(address);
  const form = { dataset: { plan: '1', scope, dirty: '0', restored: '0', resumeAction: '/preparation/resume', ack: url.searchParams.get('campaign') === 'saved' || url.searchParams.get('preparation') === 'saved' ? '1' : '0' },
    elements: { namedItem: (name: string) => controls[name] }, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) };
  let location = address, restoredPost: { action: string; values: [string,string][] } | undefined;
  const nodes = { '#campaign-form': form, '#recovery': recovery, '#save-state': state,
    '#restore-work': { addEventListener: (_name: string, fn: () => void) => buttonListeners.set('restore', fn) },
    '#discard-work': { addEventListener: (_name: string, fn: () => void) => buttonListeners.set('discard', fn) } };
  runInNewContext(script, {
    document: { addEventListener() {}, querySelector: (name: string) => nodes[name], querySelectorAll: () => [], body: { append() {} },
      createElement: (tag: string) => {
        if (tag !== 'form') return {};
        const inputs: { name: string; value: string }[] = [];
        return { action: '', append: (input: any) => inputs.push(input), submit() { restoredPost = { action: this.action, values: inputs.map(input => [input.name, input.value]) }; } };
      } },
    window: { addEventListener() {} }, URL, location: { href: address },
    queueMicrotask: fn => fn(),
    history: { replaceState: (_state: unknown, _title: string, next: string) => { location = new URL(next, address).href; } },
    FormData: class { entries() { return Object.entries(controls).map(([key, node]) => [key, node.value]); } },
    sessionStorage: { getItem: (key: string) => store.get(key), setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) },
  });
  return { controls, listeners, recovery, location, buttonListeners, restored: () => restoredPost };
}

test('TR01-I3: новая data-plan ветка потребляет оба success-маркера и восстанавливает ввод после reload', () => {
  for (const success of ['campaign=saved', 'preparation=saved', 'campaign=saved&preparation=saved']) {
    const store = new Map<string,string>([['goulash-plan:a', 'Прежний ввод']]);
    const first = loadPlan(store, `http://localhost/?${success}&keep=1#section`);
    assert.equal(new URL(first.location).searchParams.has('campaign'), false);
    assert.equal(new URL(first.location).searchParams.has('preparation'), false);
    assert.equal(first.location, 'http://localhost/campaign?keep=1#section'); assert.equal(store.has('goulash-plan:a'), false);
    first.controls.title.value = 'Новый несохранённый заголовок'; first.listeners.get('input')!();
    const saved = store.get('goulash-plan:a')!; assert.match(saved, /Новый несохранённый заголовок/);
    const otherOwner = loadPlan(store, first.location, 'b'); assert.equal(otherOwner.recovery.hidden, true);
    const reloaded = loadPlan(store, first.location); assert.equal(reloaded.recovery.hidden, false); assert.equal(store.get('goulash-plan:a'), saved);
    reloaded.buttonListeners.get('restore')!();
    assert.equal(reloaded.restored()!.action, '/preparation/resume');
    assert.deepEqual(reloaded.restored()!.values.find(([name]) => name === 'title'), ['title', 'Новый несохранённый заголовок']);
    assert.deepEqual(reloaded.restored()!.values.find(([name]) => name === 'preparationRevision'), ['preparationRevision', '4']);
  }
});
