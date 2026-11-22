import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CampaignDraft } from './campaign.ts';
import { DirectError } from './direct-api.ts';

export const defaultCampaignId = 'default';
type Workspace = { id: string; createdAt: string };

export function migrateCampaignWorkspaces(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE campaign_workspaces (
      owner TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner, id)
    ) STRICT;
    INSERT INTO campaign_workspaces (owner, id, created_at)
    SELECT owner, 'default', COALESCE(
      (SELECT MIN(at) FROM operation_history h WHERE h.owner = owners.owner AND h.object = 'draft'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ) FROM (
      SELECT owner FROM campaign_drafts UNION SELECT owner FROM campaign_preparations
      UNION SELECT owner FROM campaign_plans UNION SELECT owner FROM campaign_strategy_runs
      UNION SELECT owner FROM phrase_plans
    ) owners;

    ALTER TABLE campaign_drafts RENAME TO prior_campaign_drafts;
    CREATE TABLE campaign_drafts (
      owner TEXT NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      revision INTEGER NOT NULL CHECK (revision > 0),
      campaign_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (owner, campaign_id),
      FOREIGN KEY (owner, campaign_id) REFERENCES campaign_workspaces(owner, id)
    ) STRICT;
    INSERT INTO campaign_drafts SELECT *, 'default' FROM prior_campaign_drafts ORDER BY rowid;
    DROP TABLE prior_campaign_drafts;

    ALTER TABLE campaign_preparations RENAME TO prior_campaign_preparations;
    CREATE TABLE campaign_preparations (
      owner TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      campaign_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (owner, campaign_id),
      FOREIGN KEY (owner, campaign_id) REFERENCES campaign_workspaces(owner, id)
    ) STRICT;
    INSERT INTO campaign_preparations SELECT *, 'default' FROM prior_campaign_preparations ORDER BY rowid;
    DROP TABLE prior_campaign_preparations;

    ALTER TABLE campaign_plans RENAME TO prior_campaign_plans;
    CREATE TABLE campaign_plans (
      owner TEXT NOT NULL,
      id TEXT NOT NULL,
      preparation_revision INTEGER NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      campaign_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (owner, id),
      UNIQUE (owner, campaign_id, preparation_revision),
      FOREIGN KEY (owner, campaign_id) REFERENCES campaign_workspaces(owner, id)
    ) STRICT;
    INSERT INTO campaign_plans SELECT *, 'default' FROM prior_campaign_plans ORDER BY rowid;
    DROP TABLE prior_campaign_plans;

    ALTER TABLE phrase_plans RENAME TO prior_phrase_plans;
    CREATE TABLE phrase_plans (
      owner TEXT NOT NULL,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      campaign_id TEXT NOT NULL DEFAULT 'default',
      PRIMARY KEY (owner, campaign_id),
      FOREIGN KEY (owner, campaign_id) REFERENCES campaign_workspaces(owner, id)
    ) STRICT;
    INSERT INTO phrase_plans SELECT *, 'default' FROM prior_phrase_plans ORDER BY rowid;
    DROP TABLE prior_phrase_plans;

    ALTER TABLE campaign_strategy_runs ADD COLUMN campaign_id TEXT NOT NULL DEFAULT 'default';
    CREATE INDEX strategy_run_campaign ON campaign_strategy_runs(owner, campaign_id);
    ALTER TABLE operation_history ADD COLUMN campaign_id TEXT;
    UPDATE operation_history SET campaign_id = 'default' WHERE object = 'draft';
    PRAGMA user_version = 11;
  `);
}

export function readCampaignDraft(db: DatabaseSync, owner: string, campaignId = defaultCampaignId) {
  const row = db.prepare('SELECT payload, revision FROM campaign_drafts WHERE owner = ? AND campaign_id = ?')
    .get(owner, campaignId) as { payload: string; revision: number } | undefined;
  return row && { draft: JSON.parse(row.payload) as CampaignDraft, revision: row.revision };
}

export function ensureCampaignWorkspace(db: DatabaseSync, owner: string, id: string) {
  if (id === defaultCampaignId) {
    db.prepare('INSERT INTO campaign_workspaces VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(owner, id, new Date().toISOString());
  } else if (!db.prepare('SELECT 1 FROM campaign_workspaces WHERE owner = ? AND id = ?').get(owner, id)) {
    throw new DirectError('Реклама не найдена в этом кабинете.');
  }
}

export function createCampaignWorkspaceStore(db: DatabaseSync) {
  return {
    createCampaignWorkspace(owner: string): Workspace {
      const id = randomUUID(), createdAt = new Date().toISOString();
      db.prepare('INSERT INTO campaign_workspaces VALUES (?, ?, ?)').run(owner, id, createdAt);
      return { id, createdAt };
    },
    readCampaignWorkspace(owner: string, id: string) {
      return db.prepare('SELECT id, created_at AS createdAt FROM campaign_workspaces WHERE owner = ? AND id = ?')
        .get(owner, id) as Workspace | undefined;
    },
    readCampaignWorkspaces(owner: string) {
      return db.prepare('SELECT id, created_at AS createdAt FROM campaign_workspaces WHERE owner = ? ORDER BY rowid DESC')
        .all(owner) as Workspace[];
    },
  };
}
