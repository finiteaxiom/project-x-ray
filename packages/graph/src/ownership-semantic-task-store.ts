import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson, ownershipSemanticCapturedIdentitySchema, ownershipSemanticTaskRecordSchema, remoteFailureCodeSchema, remoteTimeSchema, remoteUuidSchema, RemoteExplanationError,
  type OwnershipSemanticCapturedIdentity, type OwnershipSemanticTaskRecord, type RemoteFailureCode } from "@project-xray/contracts";
import type { GraphStoreRole } from "./remote-explanation-store.js";
import { SharedRemoteTaskStore } from "./shared-remote-task-store.js";

const PURPOSE = "ownership-semantic-assessment";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
type Row = Record<string, unknown>;
const sameIdentity = `NOT EXISTS(SELECT key,type,atom FROM json_each(NEW.payload,'$.identity') EXCEPT SELECT key,type,atom FROM json_each(r.identity_payload))
      AND NOT EXISTS(SELECT key,type,atom FROM json_each(r.identity_payload) EXCEPT SELECT key,type,atom FROM json_each(NEW.payload,'$.identity'))`;
const columns = `NEW.task_id IS NOT json_extract(NEW.payload,'$.identity.taskId') OR NEW.owner_session_id IS NOT json_extract(NEW.payload,'$.identity.ownerSessionId')
      OR NEW.repository_id IS NOT json_extract(NEW.payload,'$.identity.repositoryId') OR NEW.phase IS NOT json_extract(NEW.payload,'$.phase')
      OR NEW.created_at IS NOT json_extract(NEW.payload,'$.createdAt') OR NEW.completed_at IS NOT json_extract(NEW.payload,'$.completedAt')`;
// UTC contract timestamps have at most 11 fraction digits. Compare decimal
// fractions as padded text; SQLite julianday/strftime lose submillisecond data.
const fraction = (column: string) => `substr((CASE WHEN substr(${column},20,1)='.' THEN substr(${column},21,length(${column})-21) ELSE '' END)||'000000000000',1,12)`;
const backwardsTime = `NEW.completed_at IS NOT NULL AND (substr(NEW.completed_at,1,19)<substr(NEW.created_at,1,19)
      OR (substr(NEW.completed_at,1,19)=substr(NEW.created_at,1,19) AND ${fraction("NEW.completed_at")}<${fraction("NEW.created_at")}))`;
const phase = `(NEW.phase='dispatched' AND (NEW.inflight<>1 OR NEW.completed_at IS NOT NULL OR json_extract(NEW.payload,'$.code') IS NOT NULL))
      OR (NEW.phase<>'dispatched' AND NEW.completed_at IS NULL)
      OR (NEW.phase='completed' AND json_extract(NEW.payload,'$.code') IS NOT NULL)
      OR (NEW.phase='cancelled' AND json_extract(NEW.payload,'$.code') IS NOT 'CANCELLED')
      OR (NEW.phase='interrupted' AND json_extract(NEW.payload,'$.code') IS NOT 'INTERRUPTED')
      OR (NEW.phase='failed' AND (json_extract(NEW.payload,'$.code') IS NULL OR json_extract(NEW.payload,'$.code') NOT IN (${remoteFailureCodeSchema.options.filter(code => code !== "CANCELLED" && code !== "INTERRUPTED").map(code => `'${code}'`).join(",")})))`;
export const semanticTaskObjects = [
  { type: "table", name: "ownership_semantic_tasks", sql: `CREATE TABLE ownership_semantic_tasks(
    task_id TEXT PRIMARY KEY NOT NULL,owner_session_id TEXT NOT NULL,repository_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('dispatched','completed','failed','cancelled','interrupted')),
    inflight INTEGER NOT NULL CHECK(inflight IN (0,1)),binding_hash TEXT NOT NULL CHECK(length(binding_hash)=64),
    created_at TEXT NOT NULL,completed_at TEXT,payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=16384),
    FOREIGN KEY(task_id) REFERENCES remote_task_registry(task_id))` },
  { type: "trigger", name: "semantic_task_insert", sql: `CREATE TRIGGER semantic_task_insert BEFORE INSERT ON ownership_semantic_tasks BEGIN
    SELECT CASE WHEN ${columns} OR ${phase} OR (${backwardsTime}) THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM remote_task_registry r WHERE r.task_id=NEW.task_id AND r.purpose='${PURPOSE}'
      AND r.created_at=NEW.created_at AND ${sameIdentity}) THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NEW.inflight<>1 OR NOT EXISTS(SELECT 1 FROM remote_provider_lease l WHERE l.task_id=NEW.task_id AND l.purpose='${PURPOSE}' AND l.stage='reserved')
      THEN RAISE(ABORT,'XRAY_SHARED_BUSY') END; END` },
  { type: "trigger", name: "semantic_task_acquire", sql: `CREATE TRIGGER semantic_task_acquire AFTER INSERT ON ownership_semantic_tasks
    WHEN NEW.phase='dispatched' BEGIN UPDATE remote_provider_lease SET stage='registered' WHERE task_id=NEW.task_id AND purpose='${PURPOSE}' AND stage='reserved'; END` },
  { type: "trigger", name: "semantic_task_update", sql: `CREATE TRIGGER semantic_task_update BEFORE UPDATE ON ownership_semantic_tasks BEGIN
    SELECT CASE WHEN ${columns} OR ${phase} OR (${backwardsTime}) OR NEW.task_id IS NOT OLD.task_id OR NEW.owner_session_id IS NOT OLD.owner_session_id
      OR NEW.repository_id IS NOT OLD.repository_id OR NEW.binding_hash IS NOT OLD.binding_hash OR NEW.created_at IS NOT OLD.created_at
      OR NEW.inflight>OLD.inflight OR (OLD.phase<>'dispatched' AND (NEW.phase IS NOT OLD.phase OR NEW.payload IS NOT OLD.payload OR NEW.completed_at IS NOT OLD.completed_at))
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM remote_task_registry r WHERE r.task_id=NEW.task_id AND r.purpose='${PURPOSE}' AND r.created_at=NEW.created_at AND ${sameIdentity})
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END; END` },
  { type: "trigger", name: "semantic_task_release", sql: `CREATE TRIGGER semantic_task_release AFTER UPDATE OF inflight ON ownership_semantic_tasks
    WHEN OLD.inflight=1 AND NEW.inflight=0 BEGIN DELETE FROM remote_provider_lease WHERE task_id=NEW.task_id AND purpose='${PURPOSE}'; END` },
  { type: "trigger", name: "semantic_task_no_delete", sql: `CREATE TRIGGER semantic_task_no_delete BEFORE DELETE ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END` },
] as const;

export function semanticBindingHash(identity: OwnershipSemanticCapturedIdentity): string {
  const { taskId: _task, ownerSessionId: _owner, contextHandle: _handle, contextEpoch: _epoch, ...binding } = identity;
  return hash(canonicalJson(binding));
}
function record(row: Row): OwnershipSemanticTaskRecord {
  if (typeof row.payload !== "string" || Buffer.byteLength(row.payload, "utf8") > 16384) invalid();
  let raw: unknown; try { raw = JSON.parse(row.payload); } catch { return invalid(); }
  const parsed = ownershipSemanticTaskRecordSchema.safeParse(raw); if (!parsed.success) invalid();
  const task = parsed.data;
  if (row.payload !== canonicalJson(task) || row.task_id !== task.identity.taskId || row.owner_session_id !== task.identity.ownerSessionId
    || row.repository_id !== task.identity.repositoryId || row.phase !== task.phase || row.created_at !== task.createdAt || row.completed_at !== task.completedAt
    || row.binding_hash !== semanticBindingHash(task.identity) || row.inflight !== 0 && row.inflight !== 1 || task.phase === "dispatched" && row.inflight !== 1) invalid();
  return task;
}
/** Full shared-state check; old16 registered-without-task is never backfilled. */
export function validateSemanticTaskState(db: Database.Database, registry: Row[], leases: Row[], installed: boolean): void {
  const rows = installed ? db.prepare("SELECT * FROM ownership_semantic_tasks").all() as Row[] : [];
  const tasks = new Map(rows.map(row => [row.task_id, { row, task: record(row) }]));
  for (const [id, entry] of tasks) {
    const registered = registry.find(row => row.task_id === id);
    if (!registered || registered.purpose !== PURPOSE || registered.identity_payload !== canonicalJson(entry.task.identity) || registered.created_at !== entry.task.createdAt) invalid();
    if (entry.row.inflight === 1 && !leases.some(row => row.task_id === id && row.purpose === PURPOSE)) invalid();
    if (entry.row.inflight === 0 && leases.some(row => row.task_id === id)) invalid();
  }
  for (const registered of registry.filter(row => row.purpose === PURPOSE)) {
    const task = tasks.get(registered.task_id), lease = leases.find(row => row.task_id === registered.task_id);
    if (!task && (!lease || lease.stage !== "reserved")) invalid();
    if (lease && (lease.stage === "registered" ? task?.row.inflight !== 1 : task && (task.task.phase === "dispatched" || task.row.inflight !== 1))) invalid();
  }
}

/** Internal metadata SQL only. No authority/currentness/dispatch/stop/result API or barrel export. */
export class OwnershipSemanticTaskStore {
  constructor(private readonly db: Database.Database, private readonly role: GraphStoreRole) {}
  private open(locked = false): void {
    if (this.role !== "global" || !this.db.open || locked && !this.db.inTransaction) invalid();
    if (!this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=17").get()) invalid();
  }
  private state(): void { new SharedRemoteTaskStore(this.db, this.role).assertState(); }
  private identity(raw: OwnershipSemanticCapturedIdentity): OwnershipSemanticCapturedIdentity {
    if (!raw || typeof raw !== "object" || types.isProxy(raw) || Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) invalid();
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(raw)) {
      if (typeof key !== "string") invalid(); const item = Object.getOwnPropertyDescriptor(raw, key);
      if (!item?.enumerable || !("value" in item) || item.value !== null && typeof item.value !== "string" && typeof item.value !== "number") invalid(); copy[key] = item.value;
    }
    const parsed = ownershipSemanticCapturedIdentitySchema.safeParse(copy); if (!parsed.success) invalid(); return parsed.data;
  }
  private guard<T>(work: () => T): T {
    try { return work(); } catch (error) {
      if (error instanceof RemoteExplanationError) throw new RemoteExplanationError(error.code);
      const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
      throw new RemoteExplanationError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "BUSY" : "POLICY_INVALID");
    }
  }
  read(taskId: string, purpose: string = PURPOSE): OwnershipSemanticTaskRecord | null {
    return this.guard(() => {
      this.open(); if (purpose !== PURPOSE || !remoteUuidSchema.safeParse(taskId).success) invalid(); this.state();
      const registered = this.db.prepare("SELECT purpose FROM remote_task_registry WHERE task_id=?").get(taskId) as { purpose: string } | undefined;
      if (registered && registered.purpose !== PURPOSE) invalid();
      const row = this.db.prepare("SELECT * FROM ownership_semantic_tasks WHERE task_id=?").get(taskId) as Row | undefined; return row ? record(row) : null;
    });
  }
  reserve(raw: OwnershipSemanticCapturedIdentity, createdAt = new Date().toISOString()): string {
    return this.guard(() => {
      this.open(true); const identity = this.identity(raw); this.state(); if (!remoteTimeSchema.safeParse(createdAt).success) invalid();
      const payload = canonicalJson(identity); if (Buffer.byteLength(payload, "utf8") > 16384) invalid();
      if (this.db.prepare("SELECT 1 FROM remote_task_registry WHERE task_id=?").get(identity.taskId)) throw new RemoteExplanationError("REVISION_CONFLICT");
      if (this.db.prepare("SELECT 1 FROM remote_provider_lease").get()) throw new RemoteExplanationError("BUSY");
      this.db.prepare("INSERT INTO remote_task_registry VALUES(?,?,?,?,?,?,?,?,?)").run(identity.taskId, PURPOSE, identity.ownerSessionId, identity.repositoryId, identity.contextHandle, identity.contextEpoch, hash(payload), payload, createdAt);
      this.db.prepare("INSERT INTO remote_provider_lease VALUES('openai',?,?,?,'reserved',?)").run(identity.taskId, PURPOSE, hash(payload), createdAt);
      if (this.reserved(identity) !== createdAt) invalid(); return createdAt;
    });
  }
  private reserved(identity: OwnershipSemanticCapturedIdentity): string {
    this.state(); const r = this.db.prepare("SELECT * FROM remote_task_registry WHERE task_id=?").get(identity.taskId) as Row | undefined;
    const lease = this.db.prepare("SELECT stage FROM remote_provider_lease WHERE task_id=?").get(identity.taskId) as { stage: string } | undefined;
    if (!r || r.purpose !== PURPOSE || r.identity_payload !== canonicalJson(identity) || lease?.stage !== "reserved" || this.read(identity.taskId)) invalid(); return r.created_at as string;
  }
  private insert(task: OwnershipSemanticTaskRecord): OwnershipSemanticTaskRecord {
    const parsed = ownershipSemanticTaskRecordSchema.safeParse(task); if (!parsed.success) invalid(); const value = parsed.data;
    this.db.prepare("INSERT INTO ownership_semantic_tasks VALUES(?,?,?,?,1,?,?,?,?)").run(value.identity.taskId, value.identity.ownerSessionId, value.identity.repositoryId, value.phase, semanticBindingHash(value.identity), value.createdAt, value.completedAt, canonicalJson(value));
    return this.persisted(value, 1);
  }
  private persisted(expected: OwnershipSemanticTaskRecord, inflight: 0 | 1): OwnershipSemanticTaskRecord {
    this.state(); const actual = this.read(expected.identity.taskId);
    const row = this.db.prepare("SELECT inflight FROM ownership_semantic_tasks WHERE task_id=?").get(expected.identity.taskId) as { inflight: number } | undefined;
    if (!actual || canonicalJson(actual) !== canonicalJson(expected) || row?.inflight !== inflight) invalid(); return actual;
  }
  promote(raw: OwnershipSemanticCapturedIdentity): OwnershipSemanticTaskRecord {
    return this.guard(() => { this.open(true); const identity = this.identity(raw), createdAt = this.reserved(identity); return this.insert({ identity, phase: "dispatched", createdAt, completedAt: null, code: null }); });
  }
  terminalReserved(raw: OwnershipSemanticCapturedIdentity, code: RemoteFailureCode, completedAt = new Date().toISOString()): OwnershipSemanticTaskRecord {
    return this.guard(() => { this.open(true); const identity = this.identity(raw), createdAt = this.reserved(identity); return this.insert({ identity, phase: code === "CANCELLED" ? "cancelled" : code === "INTERRUPTED" ? "interrupted" : "failed", createdAt, completedAt, code }); });
  }
  finish(raw: OwnershipSemanticCapturedIdentity, code: RemoteFailureCode | null, completedAt = new Date().toISOString()): OwnershipSemanticTaskRecord {
    return this.guard(() => {
      this.open(true); const identity = this.identity(raw), old = this.read(identity.taskId);
      if (!old || canonicalJson(old.identity) !== canonicalJson(identity)) invalid();
      if (old.phase !== "dispatched") { if (old.code !== code) invalid(); return old; }
      const parsed = ownershipSemanticTaskRecordSchema.safeParse({ ...old, phase: code === null ? "completed" : code === "CANCELLED" ? "cancelled" : code === "INTERRUPTED" ? "interrupted" : "failed", completedAt, code }); if (!parsed.success) invalid();
      const next = parsed.data;
      this.db.prepare("UPDATE ownership_semantic_tasks SET phase=?,completed_at=?,payload=? WHERE task_id=?").run(next.phase, next.completedAt, canonicalJson(next), identity.taskId); return this.persisted(next, 1);
    });
  }
  release(raw: OwnershipSemanticCapturedIdentity): void {
    this.guard(() => { this.open(true); const identity = this.identity(raw), old = this.read(identity.taskId);
      if (!old || old.phase === "dispatched" || canonicalJson(old.identity) !== canonicalJson(identity)) invalid();
      const row = this.db.prepare("SELECT inflight FROM ownership_semantic_tasks WHERE task_id=?").get(identity.taskId) as { inflight: number };
      if (row.inflight === 1) this.db.prepare("UPDATE ownership_semantic_tasks SET inflight=0 WHERE task_id=?").run(identity.taskId); this.persisted(old, 0);
    });
  }
}
