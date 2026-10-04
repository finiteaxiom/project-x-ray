import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  canonicalJson, ownershipSemanticCapturedIdentitySchema, remoteCapturedIdentitySchema,
  remotePersistentTaskRecordSchema, remoteTimeSchema, remoteUuidSchema, RemoteExplanationError,
  type RemoteTaskRecord,
} from "@project-xray/contracts";
import type { GraphStoreRole } from "./remote-explanation-store.js";

const FEATURE = "feature-explanation";
const SEMANTIC = "ownership-semantic-assessment";
const MAX_METADATA = 16384;
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
type Row = Record<string, unknown>;
const identityComparison = `(SELECT key,type,atom FROM json_each(NEW.payload,'$.identity') EXCEPT SELECT key,type,atom FROM json_each(r.identity_payload))`;
const inverseComparison = `(SELECT key,type,atom FROM json_each(r.identity_payload) EXCEPT SELECT key,type,atom FROM json_each(NEW.payload,'$.identity'))`;

// No connection-local UDF: every SQLite connection executes the same bridge guards.
const objects = [
  { type: "table", name: "remote_task_registry", sql: `CREATE TABLE remote_task_registry(
    task_id TEXT PRIMARY KEY NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('${FEATURE}','${SEMANTIC}')),
    owner_session_id TEXT NOT NULL,repository_id TEXT NOT NULL,context_handle TEXT NOT NULL,context_epoch INTEGER NOT NULL,
    identity_digest TEXT NOT NULL CHECK(length(identity_digest)=64),identity_payload TEXT NOT NULL
      CHECK(json_valid(identity_payload) AND length(CAST(identity_payload AS BLOB))<=${MAX_METADATA}),created_at TEXT NOT NULL)` },
  { type: "table", name: "remote_provider_lease", sql: `CREATE TABLE remote_provider_lease(
    provider TEXT PRIMARY KEY NOT NULL CHECK(provider='openai'),task_id TEXT UNIQUE NOT NULL,
    purpose TEXT NOT NULL CHECK(purpose IN ('${FEATURE}','${SEMANTIC}')),identity_digest TEXT NOT NULL,
    stage TEXT NOT NULL CHECK(stage IN ('reserved','registered')),created_at TEXT NOT NULL,
    FOREIGN KEY(task_id) REFERENCES remote_task_registry(task_id))` },
  { type: "trigger", name: "remote_registry_immutable", sql: `CREATE TRIGGER remote_registry_immutable BEFORE UPDATE ON remote_task_registry
    BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END` },
  { type: "trigger", name: "remote_registry_no_delete", sql: `CREATE TRIGGER remote_registry_no_delete BEFORE DELETE ON remote_task_registry
    BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END` },
  { type: "trigger", name: "remote_lease_insert", sql: `CREATE TRIGGER remote_lease_insert BEFORE INSERT ON remote_provider_lease BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM remote_task_registry r WHERE r.task_id=NEW.task_id
      AND r.purpose=NEW.purpose AND r.identity_digest=NEW.identity_digest AND r.created_at=NEW.created_at)
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NEW.purpose='${FEATURE}' AND (NEW.stage<>'registered' OR NOT EXISTS(
      SELECT 1 FROM explanation_tasks t WHERE t.task_id=NEW.task_id AND t.inflight=1))
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END; END` },
  { type: "trigger", name: "remote_lease_no_update", sql: `CREATE TRIGGER remote_lease_no_update BEFORE UPDATE ON remote_provider_lease
    BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END` },
  { type: "trigger", name: "remote_lease_delete", sql: `CREATE TRIGGER remote_lease_delete BEFORE DELETE ON remote_provider_lease
    WHEN OLD.purpose='${FEATURE}' BEGIN SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM explanation_tasks t WHERE t.task_id=OLD.task_id AND t.inflight=0 AND t.phase<>'dispatched')
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END; END` },
  { type: "trigger", name: "remote_feature_insert", sql: `CREATE TRIGGER remote_feature_insert BEFORE INSERT ON explanation_tasks BEGIN
    SELECT CASE WHEN json_valid(NEW.payload)<>1 THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NEW.phase IS NOT json_extract(NEW.payload,'$.phase') OR NEW.owner_session_id IS NOT json_extract(NEW.payload,'$.identity.ownerSessionId')
      OR NEW.task_id IS NOT json_extract(NEW.payload,'$.identity.taskId') OR (NEW.phase='dispatched' AND NEW.inflight<>1)
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM remote_task_registry r WHERE r.task_id=NEW.task_id AND r.purpose='${FEATURE}'
      AND r.created_at=json_extract(NEW.payload,'$.createdAt') AND NOT EXISTS ${identityComparison} AND NOT EXISTS ${inverseComparison})
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NEW.inflight=1 AND EXISTS(SELECT 1 FROM remote_provider_lease) THEN RAISE(ABORT,'XRAY_SHARED_BUSY') END;
    END` },
  { type: "trigger", name: "remote_feature_acquire", sql: `CREATE TRIGGER remote_feature_acquire AFTER INSERT ON explanation_tasks
    WHEN NEW.inflight=1 BEGIN INSERT INTO remote_provider_lease SELECT 'openai',r.task_id,r.purpose,r.identity_digest,'registered',r.created_at
      FROM remote_task_registry r WHERE r.task_id=NEW.task_id; END` },
  { type: "trigger", name: "remote_feature_update", sql: `CREATE TRIGGER remote_feature_update BEFORE UPDATE ON explanation_tasks BEGIN
    SELECT CASE WHEN json_valid(NEW.payload)<>1 THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NEW.task_id IS NOT OLD.task_id OR NEW.owner_session_id IS NOT OLD.owner_session_id
      OR NEW.phase IS NOT json_extract(NEW.payload,'$.phase') OR NEW.phase='preparing'
      OR NEW.inflight>OLD.inflight OR (NEW.phase='dispatched' AND NEW.inflight<>1)
      OR (OLD.phase<>'dispatched' AND (NEW.phase IS NOT OLD.phase OR NEW.payload IS NOT OLD.payload))
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM remote_task_registry r WHERE r.task_id=NEW.task_id AND r.purpose='${FEATURE}'
      AND r.created_at=json_extract(NEW.payload,'$.createdAt') AND NOT EXISTS ${identityComparison} AND NOT EXISTS ${inverseComparison})
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    END` },
  { type: "trigger", name: "remote_feature_release", sql: `CREATE TRIGGER remote_feature_release AFTER UPDATE OF inflight ON explanation_tasks
    WHEN OLD.inflight=1 AND NEW.inflight=0 BEGIN DELETE FROM remote_provider_lease WHERE task_id=NEW.task_id AND purpose='${FEATURE}'; END` },
  { type: "trigger", name: "remote_feature_no_delete", sql: `CREATE TRIGGER remote_feature_no_delete BEFORE DELETE ON explanation_tasks
    BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END` },
] as const;

/** Internal SQL compatibility core. There is deliberately no semantic task/permission API. */
export class SharedRemoteTaskStore {
  constructor(private readonly db: Database.Database, private readonly role: GraphStoreRole) {}
  private open(): void { if (this.role !== "global" || !this.db.open) invalid(); }
  private locked(): void { this.open(); if (!this.db.inTransaction) invalid(); }
  private parse(text: unknown, limit: number): unknown {
    if (typeof text !== "string" || Buffer.byteLength(text) > limit) invalid();
    try { return JSON.parse(text); } catch { return invalid(); }
  }
  private time(time: unknown): string {
    const value = remoteTimeSchema.safeParse(time);
    if (!value.success || !Number.isFinite(Date.parse(value.data))) invalid();
    return value.data;
  }
  private registry(row: Row): { purpose: string; identity: Record<string, unknown>; createdAt: string } {
    const raw = this.parse(row.identity_payload, MAX_METADATA);
    const schema = row.purpose === FEATURE ? remoteCapturedIdentitySchema : row.purpose === SEMANTIC ? ownershipSemanticCapturedIdentitySchema : null;
    if (!schema) invalid();
    const parsed = schema.safeParse(raw); if (!parsed.success) invalid();
    const identity = parsed.data;
    if (row.task_id !== identity.taskId || row.owner_session_id !== identity.ownerSessionId || row.repository_id !== identity.repositoryId
      || row.context_handle !== identity.contextHandle || row.context_epoch !== identity.contextEpoch
      || row.identity_payload !== canonicalJson(identity) || row.identity_digest !== hash(canonicalJson(identity))) invalid();
    return { purpose: row.purpose as string, identity, createdAt: this.time(row.created_at) };
  }
  private feature(row: Row): RemoteTaskRecord {
    const parsed = remotePersistentTaskRecordSchema.safeParse(this.parse(row.payload, 262144)); if (!parsed.success) invalid();
    const task = parsed.data;
    if (row.task_id !== task.identity.taskId || row.owner_session_id !== task.identity.ownerSessionId || row.phase !== task.phase
      || (row.inflight !== 0 && row.inflight !== 1) || (task.phase === "dispatched" && row.inflight !== 1)) invalid();
    this.time(task.createdAt);
    if (task.completedAt !== null && Date.parse(this.time(task.completedAt)) < Date.parse(task.createdAt)) invalid();
    return task;
  }
  private schema(): void {
    for (const object of objects) {
      const found = this.db.prepare("SELECT sql FROM sqlite_master WHERE type=? AND name=?").get(object.type, object.name) as { sql: string } | undefined;
      if (!found || found.sql.trim() !== object.sql.trim()) invalid();
    }
    const index = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='explanation_single_dispatch'").get() as { sql: string } | undefined;
    if (!index || index.sql.replace(/\s+/g, "").toLowerCase() !== "createuniqueindexexplanation_single_dispatchonexplanation_tasks(inflight)whereinflight=1") invalid();
  }
  validateExistingMigration(): void {
    if (this.role === "project") return;
    this.locked();
    // Detect broken14 before legacy IF NOT EXISTS statements could silently repair it.
    if (this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get()) this.assertState();
  }
  migrate(): void {
    if (this.role === "project") return;
    this.open();
    this.db.transaction(() => {
      const migrated = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get();
      if (!migrated) {
        if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name IN ('remote_task_registry','remote_provider_lease') OR name LIKE 'remote_feature_%' OR name LIKE 'remote_registry_%' OR name LIKE 'remote_lease_%'").get()) invalid();
        const rows = this.db.prepare("SELECT * FROM explanation_tasks").all() as Row[];
        const tasks = rows.map(row => this.feature(row));
        if (rows.filter(row => row.inflight === 1).length > 1) invalid();
        // Bridge triggers are installed only after the validated legacy rows are captured.
        for (const object of objects.filter(object => object.type === "table")) this.db.exec(object.sql);
        for (let i = 0; i < tasks.length; i++) {
          this.insertRegistry(tasks[i]!);
          if (rows[i]!.inflight === 1) this.db.prepare("INSERT INTO remote_provider_lease SELECT 'openai',task_id,purpose,identity_digest,'registered',created_at FROM remote_task_registry WHERE task_id=?").run(tasks[i]!.identity.taskId);
        }
        for (const object of objects.filter(object => object.type === "trigger")) this.db.exec(object.sql);
        this.db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(14,?)").run(this.time(new Date().toISOString()));
      }
      this.schema(); this.assertState();
    }).immediate();
  }
  private insertRegistry(task: RemoteTaskRecord): void {
    const payload = canonicalJson(task.identity);
    if (Buffer.byteLength(payload) > MAX_METADATA) invalid();
    this.db.prepare("INSERT INTO remote_task_registry VALUES(?,?,?,?,?,?,?,?,?)").run(task.identity.taskId, FEATURE,
      task.identity.ownerSessionId, task.identity.repositoryId, task.identity.contextHandle, task.identity.contextEpoch,
      hash(payload), payload, this.time(task.createdAt));
  }
  assertState(): void {
    this.open(); this.schema();
    const registries = this.db.prepare("SELECT * FROM remote_task_registry").all() as Row[];
    const registry = new Map(registries.map(row => [row.task_id, { row, parsed: this.registry(row) }]));
    const rows = this.db.prepare("SELECT * FROM explanation_tasks").all() as Row[];
    const tasks = new Map(rows.map(row => [row.task_id, { row, task: this.feature(row) }]));
    const leases = this.db.prepare("SELECT * FROM remote_provider_lease").all() as Row[];
    if (leases.length > 1) invalid();
    for (const lease of leases) {
      const entry = registry.get(lease.task_id);
      if (!entry || lease.provider !== "openai" || lease.purpose !== entry.parsed.purpose || lease.identity_digest !== entry.row.identity_digest
        || lease.created_at !== entry.parsed.createdAt || (lease.stage !== "registered" && lease.stage !== "reserved")) invalid();
      if (lease.purpose === FEATURE && (lease.stage !== "registered" || tasks.get(lease.task_id)?.row.inflight !== 1)) invalid();
    }
    for (const [id, entry] of tasks) {
      const registered = registry.get(id);
      if (!registered || registered.parsed.purpose !== FEATURE || canonicalJson(registered.parsed.identity) !== canonicalJson(entry.task.identity)
        || registered.parsed.createdAt !== entry.task.createdAt) invalid();
      if (entry.row.inflight === 1 && !leases.some(lease => lease.task_id === id && lease.purpose === FEATURE)) invalid();
    }
    for (const [id, entry] of registry) if (entry.parsed.purpose === FEATURE && !tasks.has(id)) invalid();
  }
  featureTask(taskId: string): RemoteTaskRecord | null {
    this.open(); if (!remoteUuidSchema.safeParse(taskId).success) invalid();
    this.assertState();
    const row = this.db.prepare("SELECT * FROM explanation_tasks WHERE task_id=?").get(taskId) as Row | undefined;
    return row ? this.feature(row) : null;
  }
  assertAvailable(taskId: string, inflight: boolean): void {
    this.locked(); this.assertState();
    if (this.db.prepare("SELECT 1 FROM remote_task_registry WHERE task_id=?").get(taskId)) throw new RemoteExplanationError("REVISION_CONFLICT");
    if (inflight && this.db.prepare("SELECT 1 FROM remote_provider_lease").get()) throw new RemoteExplanationError("BUSY");
  }
  insertFeature(task: RemoteTaskRecord, inflight: 0 | 1): void {
    this.locked(); this.assertAvailable(task.identity.taskId, inflight === 1);
    this.feature({ task_id: task.identity.taskId, owner_session_id: task.identity.ownerSessionId, phase: task.phase, payload: JSON.stringify(task), inflight });
    this.insertRegistry(task);
    this.db.prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,?)").run(task.identity.taskId, task.identity.ownerSessionId, task.phase, JSON.stringify(task), inflight);
    this.assertFeatureWrite(task, inflight);
  }
  assertFeatureWrite(task: RemoteTaskRecord, inflight: 0 | 1): void {
    this.locked(); this.assertState();
    const row = this.db.prepare("SELECT * FROM explanation_tasks WHERE task_id=?").get(task.identity.taskId) as Row | undefined;
    if (!row || row.inflight !== inflight || canonicalJson(this.feature(row)) !== canonicalJson(task)) invalid();
  }
  validateTerminalTime(createdAt: string, completedAt: string): void {
    if (Date.parse(this.time(completedAt)) < Date.parse(this.time(createdAt))) invalid();
  }
  releaseFeature(taskId: string): void {
    this.locked(); const task = this.featureTask(taskId);
    if (!task || task.phase === "dispatched") invalid();
    // No write on a repeated/late release; another purpose or later task stays occupied.
    const row = this.db.prepare("SELECT inflight FROM explanation_tasks WHERE task_id=?").get(taskId) as { inflight: number };
    if (row.inflight === 1) this.db.prepare("UPDATE explanation_tasks SET inflight=0 WHERE task_id=?").run(taskId);
    this.assertState();
  }
  assertFeatureRecovery(): void {
    this.locked(); this.assertState();
    if (this.db.prepare("SELECT 1 FROM remote_provider_lease WHERE purpose<>?").get(FEATURE)) invalid();
  }
}
