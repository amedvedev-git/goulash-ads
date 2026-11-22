import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CampaignDraft } from './campaign.ts';
import { budgetError, decide, demoPreset, makeDemo, makePlanDemo, makePresetDemo, presetLimit } from './demo.ts';
import type { DemoCase, DemoState, SavedDemo } from './demo.ts';
import { hash } from './campaign-plan.ts';
import type { CampaignPlan } from './campaign-plan.ts';
import { DirectError } from './direct-api.ts';
import { defaultCampaignId, ensureCampaignWorkspace, readCampaignDraft } from './campaign-workspaces.ts';

type Snapshot = CampaignDraft | DemoState | null;
export type HistoryEntry = {
  id: string; object: 'draft' | 'demo'; kind: string; actor: string; at: string;
  reason: string; before: Snapshot; after: Snapshot; revision: number; linkedId: string | null;
  undone: boolean; undoneBy?: string | null; campaignId?: string | null;
};
type HistoryRow = Omit<HistoryEntry, 'before' | 'after' | 'undone'> & { before: string; after: string; undone: number };
export type DemoJob = { id: string; status: 'pending' | 'completed'; resultId: string | null };
export type DemoPermission = {revision:number;enabled:boolean;planId:string;planHash:string;policyVersion:string;actor:string;at:string};
export type UndoReview = { status: 'ready' | 'already' | 'conflict' | 'missing' | 'unsupported'; entry?: HistoryEntry; current?: Snapshot; target?: Snapshot };
export type OperationsView = { demo?: SavedDemo; job?: DemoJob; history: HistoryEntry[]; draftRevision?: number;
  permission?: DemoPermission; plans?: CampaignPlan[];
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
    before: Snapshot, after: Snapshot, revision: number, linkedId: string | null = null, campaignId: string | null = null) {
    const id = randomUUID();
    db.prepare(`INSERT INTO operation_history (id, owner, mode, object, kind, actor, at, reason,
      before_json, after_json, revision, linked_id, campaign_id) VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, owner, object, kind, actor, new Date().toISOString(), reason, JSON.stringify(before), JSON.stringify(after), revision, linkedId, campaignId);
    return id;
  }
  function readDraft(owner: string, campaignId?: string | null) {
    return readCampaignDraft(db, owner, campaignId ?? defaultCampaignId);
  }
  function readDemo(owner: string): SavedDemo | undefined {
    const row = db.prepare('SELECT payload, revision, dataset_id FROM demo_states WHERE owner = ? AND mode = \'test\'').get(owner) as
      { payload: string; revision: number; dataset_id: string } | undefined;
    return row ? { state: JSON.parse(row.payload) as DemoState, revision: row.revision, datasetId: row.dataset_id } : undefined;
  }
  function readJob(owner: string, datasetId: string) {
    return db.prepare('SELECT id, status, result_id AS resultId FROM demo_jobs WHERE owner = ? AND dataset_id = ?').get(owner, datasetId) as DemoJob | undefined;
  }
  function readPlan(owner:string,id:string):CampaignPlan|undefined {const row=db.prepare('SELECT payload FROM campaign_plans WHERE owner=? AND id=?').get(owner,id);return row?JSON.parse(String(row.payload)):undefined;}
  function readPermission(owner:string):DemoPermission|undefined {const row=db.prepare('SELECT revision,enabled,payload FROM demo_automation WHERE owner=?').get(owner);return row?{...JSON.parse(String(row.payload)),revision:Number(row.revision),enabled:Boolean(row.enabled)}:undefined;}
  function controlRef(state?: DemoState) {
    if (state?.preset === demoPreset && !state.planRef) return { id: demoPreset, snapshotHash: hash(demoPreset) };
    return state?.planRef;
  }
  function controlIssue(owner:string,current:SavedDemo|undefined){
    const state=current?.state,ref=state?.planRef,plan=ref&&typeof ref.id==='string'?readPlan(owner,ref.id):undefined;
    if (state?.preset === demoPreset) {
      if (ref || state.planContext || state.schemaVersion !== 2 || state.policyVersion !== 'e3-control-1' ||
          state.mode !== 'test' || state.limit !== presetLimit || state.periodDays !== 7 || state.goalId !== 'demo-order')
        return 'Учебный набор изменён. Загрузите готовый пример снова.';
      return;
    }
    if(!state||state.schemaVersion!==2||state.policyVersion!=='e3-control-1'||!ref||!plan||hash(plan)!==ref.snapshotHash||ref.fingerprint!==plan.fingerprint||ref.campaignRevision!==plan.campaignRevision||ref.preparationRevision!==plan.preparationRevision)return 'Прежний пример не связан с подтверждённой версией плана.';
    if(!/^\d{1,8}$/.test(plan.draft.budget)||state.mode!=='test'||state.goalId!=='demo-order'||state.limit!==Number(BigInt(plan.draft.budget)*100n)||state.periodDays!==Number(plan.draft.period)||state.goal!==plan.goal||hash(state.planContext)!==hash({title:plan.draft.title,goal:plan.goal,region:plan.draft.region,budget:plan.draft.budget,confirmedAt:plan.confirmedAt}))return 'Контекст контрольного набора изменён. Загрузите новый набор.';
  }
  function enqueue(owner:string,datasetId:string,actor:string){
    const current=readDemo(owner);if(!current||current.datasetId!==datasetId)return;
    const permission=readPermission(owner);if(!permission?.enabled)return;
    db.prepare(`INSERT INTO demo_jobs(id,owner,mode,dataset_id,actor,status,result_id,expected_revision,state_hash,context_hash,authorization_revision)
      VALUES(?,?,'test',?,?,'pending',NULL,?,?,?,?) ON CONFLICT(owner,dataset_id) DO NOTHING`)
      .run(randomUUID(),owner,datasetId,actor,current.revision,hash(current.state),hash(controlRef(current.state)),permission.revision);
    return readJob(owner,datasetId);
  }
  function decode(row: HistoryRow): HistoryEntry {
    return { ...row, before: JSON.parse(row.before), after: JSON.parse(row.after), undone: Boolean(row.undone) };
  }
  const historySelect = `SELECT h.id, h.object, h.kind, h.actor, h.at, h.reason, h.before_json AS before,
    h.after_json AS after, h.revision, h.linked_id AS linkedId, h.campaign_id AS campaignId,
    EXISTS(SELECT 1 FROM operation_history u WHERE u.owner = h.owner AND u.linked_id = h.id
      AND u.kind IN ('draft_undo', 'automation_undo')) AS undone,
    (SELECT u.id FROM operation_history u WHERE u.owner = h.owner AND u.linked_id = h.id
      AND u.kind IN ('draft_undo', 'automation_undo') LIMIT 1) AS undoneBy FROM operation_history h`;
  function readHistory(owner: string, campaignId?: string) {
    const rows = campaignId === undefined
      ? db.prepare(`${historySelect} WHERE h.owner = ? ORDER BY h.rowid DESC LIMIT 100`).all(owner)
      : db.prepare(`${historySelect} WHERE h.owner = ? AND h.campaign_id = ? ORDER BY h.rowid DESC LIMIT 100`).all(owner, campaignId);
    return (rows as HistoryRow[]).map(decode);
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
    const current = entry.object === 'draft' ? readDraft(owner, entry.campaignId) : readDemo(owner);
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
    readDemo, readHistory, readOperation, reviewUndo, readDemoPermission:readPermission,
    setDemoPermission(owner:string,enabled:boolean,revision:number,actor:string,datasetId?:string){return transaction(()=>{
      const previous=readPermission(owner),current=readDemo(owner);if((previous?.revision??0)!==revision)throw new DirectError('Полномочия изменены. Обновите страницу.');
      if (datasetId !== undefined && current?.datasetId !== datasetId) throw new DirectError('Учебный набор заменён. Обновите страницу.');
      const issue = enabled && controlIssue(owner,current);
      if (issue) throw new DirectError(issue);
      const ref=controlRef(current?.state);
      if(!ref&&!previous)throw new DirectError('Сначала загрузите связанный контрольный набор.');
      const permission:DemoPermission={revision:revision+1,enabled,planId:ref?.id??previous!.planId,planHash:ref?.snapshotHash??previous!.planHash,policyVersion:'e3-control-1',actor,at:new Date().toISOString()};
      db.prepare('INSERT INTO demo_automation(owner,revision,enabled,plan_id,policy_version,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,plan_id=excluded.plan_id,policy_version=excluded.policy_version,payload=excluded.payload').run(owner,permission.revision,enabled?1:0,permission.planId,permission.policyVersion,JSON.stringify(permission));
      record(owner,'demo',enabled?'automation_enabled':'automation_disabled',actor,enabled?'Включено фоновое правило для виртуальных назначений учебного набора.':'Контрольная автоматика выключена. Уже выполненные решения не отменяются.',current?.state??null,current?.state??null,current?.revision??0);
      return permission;
    });},
    operationsView(owner: string, selection: { operationId?: string; undoId?: string; campaignId?: string } = {}): OperationsView {
      const { campaignId } = selection;
      const demo = campaignId ? undefined : readDemo(owner);
      const job = demo ? readJob(owner, demo.datasetId) : undefined;
      return { demo, job, permission:campaignId ? undefined : readPermission(owner),plans:campaignId ? undefined : db.prepare('SELECT payload FROM campaign_plans WHERE owner=? ORDER BY rowid DESC').all(owner).map(row=>JSON.parse(String(row.payload))), history: readHistory(owner, campaignId), draftRevision: readDraft(owner, campaignId)?.revision,
        result: job?.resultId ? readOperation(owner, job.resultId) : undefined,
        focus: selection.operationId ? readOperation(owner, selection.operationId) : undefined,
        undo: selection.undoId ? reviewUndo(owner, selection.undoId) : undefined };
    },
    saveCampaign(owner: string, draft: CampaignDraft, revision: number, actor = owner, commit?: (savedRevision: number) => void, campaignId = defaultCampaignId) {
      return transaction(() => {
        const current = readDraft(owner, campaignId);
        if ((current?.revision ?? 0) !== revision) return false;
        if (JSON.stringify(current?.draft) === JSON.stringify(draft)) { commit?.(revision); return true; }
        ensureCampaignWorkspace(db, owner, campaignId);
        db.prepare(`INSERT INTO campaign_drafts(owner,payload,revision,campaign_id) VALUES (?, ?, ?, ?) ON CONFLICT(owner,campaign_id)
          DO UPDATE SET payload = excluded.payload, revision = excluded.revision`).run(owner, JSON.stringify(draft), revision + 1, campaignId);
        record(owner, 'draft', current ? 'draft_changed' : 'draft_created', actor,
          current ? 'Пользователь сохранил правку тестового черновика.' : 'Подготовлен тестовый черновик; создание не отменяется.',
          current?.draft ?? null, draft, revision + 1, null, campaignId);
        commit?.(revision + 1);
        return true;
      });
    },
    loadDemo(owner: string, scenario: DemoCase, revision: number, actor: string, selection?: string | { preset: typeof demoPreset }) {
      return transaction(() => {
        const current = readDemo(owner);
        if ((current?.revision ?? 0) !== revision) return false;
        const plan = typeof selection === 'string' ? readPlan(owner, selection) : undefined;
        if (typeof selection === 'string' && !plan) throw new DirectError('План не найден у этого владельца.');
        const state = plan ? makePlanDemo(plan, scenario) : typeof selection === 'object' && selection.preset === demoPreset ? makePresetDemo(scenario) : makeDemo(scenario);
        const ref = controlRef(state), permission = readPermission(owner);
        if (permission?.enabled && (permission.planId !== ref?.id || permission.planHash !== ref?.snapshotHash)) {
          db.prepare('UPDATE demo_automation SET enabled=0,revision=revision+1 WHERE owner=?').run(owner);
          record(owner,'demo','automation_disabled',actor,'Изменился источник учебных данных. Включите правило для нового набора.',current?.state??null,state,revision+1);
        }
        db.prepare(`INSERT INTO demo_states VALUES (?, 'test', ?, ?, ?) ON CONFLICT(owner)
          DO UPDATE SET dataset_id = excluded.dataset_id, payload = excluded.payload, revision = excluded.revision`)
          .run(owner, randomUUID(), JSON.stringify(state), revision + 1);
        record(owner, 'demo', 'demo_loaded', actor, 'Загружен новый синтетический набор. Предыдущая история сохранена; это не расходование денег.',
          current?.state ?? null, state, revision + 1);
        return true;
      });
    },
    enqueueDemo(owner: string, datasetId: string, actor: string) {
      return transaction(() => {if(readDemo(owner)?.datasetId!==datasetId)return;const existing=readJob(owner,datasetId);return existing??enqueue(owner,datasetId,actor);});
    },
    processDemoJob() {
      return transaction(() => {
        for(const row of db.prepare('SELECT owner FROM demo_automation WHERE enabled=1').all()){const owner=String(row.owner),current=readDemo(owner);if(current&&!readJob(owner,current.datasetId))enqueue(owner,current.datasetId,'Фоновое правило');}
        const job = db.prepare("SELECT * FROM demo_jobs WHERE status = 'pending' AND mode = 'test' ORDER BY rowid LIMIT 1").get() as
          { id: string; owner: string; dataset_id: string; actor: string;expected_revision:number;state_hash:string;context_hash:string;authorization_revision:number } | undefined;
        if (!job) return false;
        const current = readDemo(job.owner);
        const permission=readPermission(job.owner);
        const ref = controlRef(current?.state);
        const issue=controlIssue(job.owner,current)||(!current||current.datasetId!==job.dataset_id?'Набор заменён до обработки задания. Актуальное состояние сохранено.':undefined)||
          (!permission?.enabled?'Автоматика выключена.':undefined)||
          (permission?.revision!==job.authorization_revision||permission?.policyVersion!=='e3-control-1'||permission?.planId!==ref?.id||permission?.planHash!==ref?.snapshotHash?'Полномочия изменены после постановки задания.':undefined)||
          (current?.revision!==job.expected_revision||hash(current?.state)!==job.state_hash||hash(ref)!==job.context_hash?'Снимок изменён после постановки задания.':undefined);
        let decision:{status:string;reason:string;after:DemoState|null};
        try{decision=issue?{status:'skipped',reason:issue,after:current?.state??null}:decide(current!.state);}catch{decision={status:'error',reason:'Некорректный контрольный снимок. Назначения сохранены.',after:current?.state??null};}
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
          const current = entry!.object === 'draft' ? readDraft(owner, entry!.campaignId) : readDemo(owner);
          record(owner, entry!.object, 'undo_conflict', actor, 'Конфликт отмены: есть более новая правка. Актуальное состояние сохранено.',
            snapshot ?? null, snapshot ?? null, current?.revision ?? 0, id, entry!.campaignId ?? null);
          return 'conflict';
        }
        const revision = entry!.revision + 1;
        const restored = review.target!;
        if (entry!.object === 'draft') {
          db.prepare('UPDATE campaign_drafts SET payload = ?, revision = ? WHERE owner = ? AND campaign_id = ?')
            .run(JSON.stringify(restored), revision, owner, entry!.campaignId ?? defaultCampaignId);
        } else {
          db.prepare('UPDATE demo_states SET payload = ?, revision = ? WHERE owner = ?').run(JSON.stringify(restored), revision, owner);
        }
        record(owner, entry!.object, entry!.object === 'draft' ? 'draft_undo' : 'automation_undo', actor,
          entry!.object === 'draft' ? 'Правка черновика отменена отдельной операцией.' : 'Остановка и назначения отменены. Уже учтённый расход сохранён.',
          snapshot!, restored, revision, id, entry!.campaignId ?? null);
        return 'ok';
      });
    },
  };
}
