import type { openDatabase } from '../../src/database.ts';
import type { DemoCase } from '../../src/demo.ts';
import { exampleCampaign } from '../../src/campaign.ts';
import { confirmedPlan } from './confirmed-plan.ts';
import type { DatabaseSync } from 'node:sqlite';
export function controlPlan(db:ReturnType<typeof openDatabase>,owner='local'){
  return db.readPlans(owner)[0]?.id??confirmedPlan(db,{...exampleCampaign,budget:'6000',title:'Контрольный план',adText:'Проверяем сохранение назначений.'},['проверка'],owner);
}
export function loadControl(db:ReturnType<typeof openDatabase>,owner:string,scenario:DemoCase,revision:number,actor:string){
  const ok=db.loadDemo(owner,scenario,revision,actor,controlPlan(db,owner));
  if(ok&&!db.readDemoPermission(owner)?.enabled)db.setDemoPermission(owner,true,db.readDemoPermission(owner)?.revision??0,actor);
  return ok;
}
// Older migration fixtures deliberately reconstruct pre-E3 schemas, rather than retain future tables.
export function removeE3Schema(raw:DatabaseSync){raw.exec(`
  ALTER TABLE campaign_drafts RENAME TO scoped_drafts;
  CREATE TABLE campaign_drafts (owner TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK (json_valid(payload)), revision INTEGER NOT NULL CHECK (revision > 0)) STRICT;
  INSERT INTO campaign_drafts SELECT owner,payload,revision FROM scoped_drafts WHERE campaign_id='default' ORDER BY rowid;
  DROP TABLE scoped_drafts;
  ALTER TABLE campaign_preparations RENAME TO scoped_preparations;
  CREATE TABLE campaign_preparations(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
  INSERT INTO campaign_preparations SELECT owner,revision,payload FROM scoped_preparations WHERE campaign_id='default' ORDER BY rowid;
  DROP TABLE scoped_preparations;
  ALTER TABLE campaign_plans RENAME TO scoped_plans;
  CREATE TABLE campaign_plans(owner TEXT NOT NULL, id TEXT NOT NULL, preparation_revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), PRIMARY KEY(owner,id), UNIQUE(owner,preparation_revision)) STRICT;
  INSERT INTO campaign_plans SELECT owner,id,preparation_revision,payload FROM scoped_plans WHERE campaign_id='default' ORDER BY rowid;
  DROP TABLE scoped_plans;
  ALTER TABLE phrase_plans RENAME TO scoped_phrases;
  CREATE TABLE phrase_plans(owner TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload))) STRICT;
  INSERT INTO phrase_plans SELECT owner,payload FROM scoped_phrases WHERE campaign_id='default' ORDER BY rowid;
  DROP TABLE scoped_phrases;
  DROP INDEX strategy_run_campaign;
  ALTER TABLE campaign_strategy_runs DROP COLUMN campaign_id;
  ALTER TABLE operation_history DROP COLUMN campaign_id;
  DROP TABLE campaign_workspaces;
  DROP TABLE analytics_reports;DROP TABLE analytics_settings;DROP TABLE demo_automation;
  ALTER TABLE demo_jobs DROP COLUMN expected_revision;ALTER TABLE demo_jobs DROP COLUMN state_hash;ALTER TABLE demo_jobs DROP COLUMN context_hash;ALTER TABLE demo_jobs DROP COLUMN authorization_revision;`);}
