import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CampaignDraft } from './campaign.ts';
import { budgetError, decide, makeDemo } from './demo.ts';
import type { DemoCase, DemoState, SavedDemo } from './demo.ts';

type Snapshot = CampaignDraft | DemoState | null;
export type HistoryEntry = {
  id: string; object: 'draft' | 'demo'; kind: string; actor: string; at: string;
  reason: string; before: Snapshot; after: Snapshot; revision: number; linkedId: string | null;
  undone: boolean; undoneBy?: string | null;
};
type HistoryRow = Omit<HistoryEntry, 'before' | 'after' | 'undone'> & { before: string; after: string; undone: number };
export type DemoJob = { id: string; status: 'pending' | 'completed'; resultId: string | null };
export type UndoReview = { status: 'ready' | 'already' | 'conflict' | 'missing' | 'unsupported'; entry?: HistoryEntry; current?: Snapshot; target?: Snapshot };
export type OperationsView = { demo?: SavedDemo; job?: DemoJob; history: HistoryEntry[]; draftRevision?: number;
  result?: HistoryEntry; focus?: HistoryEntry; undo?: UndoReview };

export function migrateOperations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE operation_history (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode = 'test'),
      object TEXT NOT NULL CHECK (object IN ('draft', 'demo')), kind TEXT NOT NULL,
      actor TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL,
      before_json TEXT NOT NULL CHECK (json_valid(before_json)), after_json TEXT NOT NULL CHECK (json_valid(after_json)),
      revision INTEGER NOT NULL, linked_id TEXT
    ) STRICT;
    CREATE INDEX history_owner ON operation_history(owner);
    CREATE UNIQUE INDEX history_undo ON operation_history(owner, linked_id) WHERE kind IN ('draft_undo', 'automation_undo');
    CREATE TABLE demo_states (
      owner TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode = 'test'), dataset_id TEXT NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)), revision INTEGER NOT NULL CHECK (revision > 0)
    ) STRICT;
    CREATE TABLE demo_jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode = 'test'), dataset_id TEXT NOT NULL,
      actor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending', 'completed')), result_id TEXT,
      UNIQUE (owner, dataset_id)
    ) STRICT;
  `);
  const insert = db.prepare(`INSERT INTO operation_history VALUES (?, ?, 'test', 'draft', 'baseline', ?, ?, ?, 'null', ?, ?, NULL)`);
  for (const row of db.prepare('SELECT owner, payload, revision FROM campaign_drafts').all()) {
    insert.run(randomUUID(), row.owner, 'Миграция · прежний автор неизвестен', new Date().toISOString(),
      'Сохранён прежний черновик. Время записи — время миграции; история до неё неизвестна.', row.payload, row.revision);
  }
  db.exec('PRAGMA user_version = 5');
}

export function createOperations(db: DatabaseSync) {
  function transaction<T>(action: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function record(owner: string, object: HistoryEntry['object'], kind: string, actor: string, reason: string,
    before: Snapshot, after: Snapshot, revision: number, linkedId: string | null = null) {
    const id = randomUUID();
    db.prepare('INSERT INTO operation_history VALUES (?, ?, \'test\', ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, owner, object, kind, actor, new Date().toISOString(), reason, JSON.stringify(before), JSON.stringify(after), revision, linkedId);
    return id;
  }
  function readDraft(owner: string) {
    const row = db.prepare('SELECT payload, revision FROM campaign_drafts WHERE owner = ?').get(owner) as { payload: string; revision: number } | undefined;
    return row ? { draft: JSON.parse(row.payload) as CampaignDraft, revision: row.revision } : undefined;
  }
  function readDemo(owner: string): SavedDemo | undefined {
    const row = db.prepare('SELECT payload, revision, dataset_id FROM demo_states WHERE owner = ? AND mode = \'test\'').get(owner) as
      { payload: string; revision: number; dataset_id: string } | undefined;
    return row ? { state: JSON.parse(row.payload) as DemoState, revision: row.revision, datasetId: row.dataset_id } : undefined;
  }
  function readJob(owner: string, datasetId: string) {
    return db.prepare('SELECT id, status, result_id AS resultId FROM demo_jobs WHERE owner = ? AND dataset_id = ?').get(owner, datasetId) as DemoJob | undefined;
  }
  function decode(row: HistoryRow): HistoryEntry {
    return { ...row, before: JSON.parse(row.before), after: JSON.parse(row.after), undone: Boolean(row.undone) };
  }
  const historySelect = `SELECT h.id, h.object, h.kind, h.actor, h.at, h.reason, h.before_json AS before,
    h.after_json AS after, h.revision, h.linked_id AS linkedId,
    EXISTS(SELECT 1 FROM operation_history u WHERE u.owner = h.owner AND u.linked_id = h.id
      AND u.kind IN ('draft_undo', 'automation_undo')) AS undone,
    (SELECT u.id FROM operation_history u WHERE u.owner = h.owner AND u.linked_id = h.id
      AND u.kind IN ('draft_undo', 'automation_undo') LIMIT 1) AS undoneBy FROM operation_history h`;
  function readHistory(owner: string) {
    return (db.prepare(`${historySelect} WHERE h.owner = ? ORDER BY h.rowid DESC LIMIT 100`).all(owner) as HistoryRow[]).map(decode);
  }
  function readOperation(owner: string, id: string): HistoryEntry | undefined {
    const row = db.prepare(`${historySelect} WHERE h.owner = ? AND h.id = ?`).get(owner, id) as HistoryRow | undefined;
    return row && decode(row);
  }
  function reviewUndo(owner: string, id: string): UndoReview {
    const entry = readOperation(owner, id);
    if (!entry) return { status: 'missing' };
    if (entry.undone) return { status: 'already', entry };
    if (!['draft_changed', 'automation_applied'].includes(entry.kind)) return { status: 'unsupported', entry };
    const current = entry.object === 'draft' ? readDraft(owner) : readDemo(owner);
    const snapshot = current && ('draft' in current ? current.draft : current.state);
    if (!current || current.revision !== entry.revision || JSON.stringify(snapshot) !== JSON.stringify(entry.after)) {
      return { status: 'conflict', entry, current: snapshot };
    }
    let target = entry.before!;
    if (entry.object === 'demo') {
      // Preview and execution share the same restoration: accounted expense always stays current.
      const state = structuredClone(snapshot as DemoState), before = entry.before as DemoState;
      state.reserve = before.reserve;
      state.campaigns.forEach((campaign) => {
        const old = before.campaigns.find((item) => item.id === campaign.id)!;
        campaign.remaining = old.remaining; campaign.status = old.status;
      });
      if (budgetError(state)) return { status: 'conflict', entry, current: snapshot };
      target = state;
    }
    return { status: 'ready', entry, current: snapshot, target };
  }
  return {
    readDemo, readHistory, readOperation, reviewUndo,
    operationsView(owner: string, selection: { operationId?: string; undoId?: string } = {}): OperationsView {
      const demo = readDemo(owner);
      const job = demo ? readJob(owner, demo.datasetId) : undefined;
      return { demo, job, history: readHistory(owner), draftRevision: readDraft(owner)?.revision,
        result: job?.resultId ? readOperation(owner, job.resultId) : undefined,
        focus: selection.operationId ? readOperation(owner, selection.operationId) : undefined,
        undo: selection.undoId ? reviewUndo(owner, selection.undoId) : undefined };
    },
    saveCampaign(owner: string, draft: CampaignDraft, revision: number, actor = owner, commit?: (savedRevision: number) => void) {
      return transaction(() => {
        const current = readDraft(owner);
        if ((current?.revision ?? 0) !== revision) return false;
        if (JSON.stringify(current?.draft) === JSON.stringify(draft)) { commit?.(revision); return true; }
        db.prepare(`INSERT INTO campaign_drafts VALUES (?, ?, ?) ON CONFLICT(owner)
          DO UPDATE SET payload = excluded.payload, revision = excluded.revision`).run(owner, JSON.stringify(draft), revision + 1);
        record(owner, 'draft', current ? 'draft_changed' : 'draft_created', actor,
          current ? 'Пользователь сохранил правку тестового черновика.' : 'Подготовлен тестовый черновик; создание не отменяется.',
          current?.draft ?? null, draft, revision + 1);
        commit?.(revision + 1);
        return true;
      });
    },
    loadDemo(owner: string, scenario: DemoCase, revision: number, actor: string) {
      return transaction(() => {
        const current = readDemo(owner);
        if ((current?.revision ?? 0) !== revision) return false;
        const state = makeDemo(scenario);
        db.prepare(`INSERT INTO demo_states VALUES (?, 'test', ?, ?, ?) ON CONFLICT(owner)
          DO UPDATE SET dataset_id = excluded.dataset_id, payload = excluded.payload, revision = excluded.revision`)
          .run(owner, randomUUID(), JSON.stringify(state), revision + 1);
        record(owner, 'demo', 'demo_loaded', actor, 'Загружен новый синтетический набор. Предыдущая история сохранена; это не расходование денег.',
          current?.state ?? null, state, revision + 1);
        return true;
      });
    },
    enqueueDemo(owner: string, datasetId: string, actor: string) {
      return transaction(() => {
        if (readDemo(owner)?.datasetId !== datasetId) return undefined;
        db.prepare(`INSERT INTO demo_jobs VALUES (?, ?, 'test', ?, ?, 'pending', NULL)
          ON CONFLICT(owner, dataset_id) DO NOTHING`).run(randomUUID(), owner, datasetId, actor);
        return readJob(owner, datasetId);
      });
    },
    processDemoJob() {
      return transaction(() => {
        const job = db.prepare("SELECT id, owner, dataset_id, actor FROM demo_jobs WHERE status = 'pending' AND mode = 'test' ORDER BY rowid LIMIT 1").get() as
          { id: string; owner: string; dataset_id: string; actor: string } | undefined;
        if (!job) return false;
        const current = readDemo(job.owner);
        const decision = current && current.datasetId === job.dataset_id ? decide(current.state)
          : { status: 'skipped', reason: 'Набор заменён до обработки задания. Актуальное состояние сохранено.', after: current?.state ?? null };
        const revision = (current?.revision ?? 0) + (decision.status === 'applied' ? 1 : 0);
        if (decision.status === 'applied') db.prepare('UPDATE demo_states SET payload = ?, revision = ? WHERE owner = ?')
          .run(JSON.stringify(decision.after), revision, job.owner);
        const id = record(job.owner, 'demo', `automation_${decision.status}`, `Автоматика · запуск: ${job.actor}`,
          decision.reason, current?.state ?? null, decision.after, revision);
        db.prepare("UPDATE demo_jobs SET status = 'completed', result_id = ? WHERE id = ?").run(id, job.id);
        return true;
      });
    },
    undo(owner: string, id: string, actor: string): 'ok' | 'already' | 'conflict' | 'missing' | 'unsupported' {
      return transaction(() => {
        const review = reviewUndo(owner, id), entry = review.entry;
        if (review.status === 'missing' || review.status === 'already' || review.status === 'unsupported') return review.status;
        const snapshot = review.current;
        if (review.status === 'conflict') {
          const current = entry!.object === 'draft' ? readDraft(owner) : readDemo(owner);
          record(owner, entry!.object, 'undo_conflict', actor, 'Конфликт отмены: есть более новая правка. Актуальное состояние сохранено.',
            snapshot ?? null, snapshot ?? null, current?.revision ?? 0, id);
          return 'conflict';
        }
        const revision = entry!.revision + 1;
        const restored = review.target!;
        if (entry!.object === 'draft') {
          db.prepare('UPDATE campaign_drafts SET payload = ?, revision = ? WHERE owner = ?').run(JSON.stringify(restored), revision, owner);
        } else {
          db.prepare('UPDATE demo_states SET payload = ?, revision = ? WHERE owner = ?').run(JSON.stringify(restored), revision, owner);
        }
        record(owner, entry!.object, entry!.object === 'draft' ? 'draft_undo' : 'automation_undo', actor,
          entry!.object === 'draft' ? 'Правка черновика отменена отдельной операцией.' : 'Остановка и назначения отменены. Уже учтённый расход сохранён.',
          snapshot!, restored, revision, id);
        return 'ok';
      });
    },
  };
}
