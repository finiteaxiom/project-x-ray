import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson, OWNERSHIP_SEMANTIC_RESULT_LIMITS, ownershipSemanticResultEnvelopeSchema,
  ownershipSemanticTaskRecordSchema, ownershipAttemptSchema, ownershipCapsuleSchema, ownershipAttemptPreimage, ownershipCapsulePreimage,
  remoteUuidSchema, validateOwnershipSemanticResultEnvelope, validateOwnershipSemanticResponse,
  type OwnershipSemanticResultEnvelope } from "@project-xray/contracts";
import type { OwnershipSemanticPackageRead } from "./ownership-capsule-store.js";
import { GraphStore } from "./index.js";
import { OwnershipSemanticTaskStore, semanticBindingHash } from "./ownership-semantic-task-store.js";

// Internal module only; no barrel or application entry point.
export class OwnershipSemanticResultStoreError extends Error {
  constructor(readonly code: "INVALID_RESULT" | "INVALID_RECEIPT" | "BUSY" = "INVALID_RESULT") { super("所有权语义结果存储失败"); this.name = "OwnershipSemanticResultStoreError"; }
}
function fail(code: OwnershipSemanticResultStoreError["code"] = "INVALID_RESULT"): never { throw new OwnershipSemanticResultStoreError(code); }
function safe(error: unknown): OwnershipSemanticResultStoreError {
  if (error instanceof OwnershipSemanticResultStoreError) return new OwnershipSemanticResultStoreError(error.code);
  const code = error && typeof error === "object" && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
  return new OwnershipSemanticResultStoreError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "BUSY" ? "BUSY" : "INVALID_RESULT");
}
type Row = Record<string, unknown>;
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export const semanticResultObjects = [
  { type: "table", name: "ownership_semantic_results", sql: `CREATE TABLE ownership_semantic_results(
    task_id TEXT PRIMARY KEY NOT NULL,repository_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES ownership_attempts(attempt_id),binding_hash TEXT NOT NULL,response_digest TEXT NOT NULL,
    created_at TEXT NOT NULL,completed_at TEXT NOT NULL,payload TEXT NOT NULL
      CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=${OWNERSHIP_SEMANTIC_RESULT_LIMITS.envelopeBytes}))` },
  { type: "trigger", name: "semantic_result_insert", sql: `CREATE TRIGGER semantic_result_insert BEFORE INSERT ON ownership_semantic_results BEGIN
    SELECT CASE WHEN NEW.task_id IS NOT json_extract(NEW.payload,'$.identity.taskId') OR NEW.repository_id IS NOT json_extract(NEW.payload,'$.identity.repositoryId')
      OR NEW.snapshot_id IS NOT json_extract(NEW.payload,'$.identity.snapshotId') OR NEW.attempt_id IS NOT json_extract(NEW.payload,'$.identity.attemptId')
      OR NEW.binding_hash IS NOT json_extract(NEW.payload,'$.bindingHash') OR NEW.response_digest IS NOT json_extract(NEW.payload,'$.responseDigest')
      OR NEW.created_at IS NOT json_extract(NEW.payload,'$.createdAt') OR NEW.completed_at IS NOT json_extract(NEW.payload,'$.completedAt')
      OR NOT EXISTS(SELECT 1 FROM ownership_attempts WHERE attempt_id=NEW.attempt_id AND repository_id=NEW.repository_id AND snapshot_id=NEW.snapshot_id)
      THEN RAISE(ABORT,'XRAY_SEMANTIC_RESULT_INVALID') END; END` },
  { type: "trigger", name: "semantic_result_immutable", sql: `CREATE TRIGGER semantic_result_immutable BEFORE UPDATE ON ownership_semantic_results BEGIN SELECT RAISE(ABORT,'XRAY_SEMANTIC_RESULT_INVALID'); END` },
] as const;
declare const preparedBrand: unique symbol;
declare const candidateBrand: unique symbol;
export type PreparedSemanticResult = Readonly<{ [preparedBrand]: true }>;
export type StoredSemanticCandidate = Readonly<{ kind: "stored-candidate"; envelope: OwnershipSemanticResultEnvelope; [candidateBrand]: true }>;
interface Prepared { envelope: OwnershipSemanticResultEnvelope; material: string }

/** SQL candidate storage. Neither a DTO nor a returned receipt proves publication. */
export class OwnershipSemanticResultStore {
  #closed = false;
  #prepared = new WeakMap<object, Prepared>();
  #candidates = new WeakMap<object, OwnershipSemanticResultEnvelope>();
  constructor(private readonly db: Database.Database, private readonly owner: GraphStore) {}
  private open(): void {
    if (this.#closed || !this.db.open || !(this.owner instanceof GraphStore) || Object.getOwnPropertyDescriptor(this.owner, "database")?.value !== this.db) fail("INVALID_RECEIPT");
  }
  close(): void { this.#closed = true; this.#prepared = new WeakMap(); this.#candidates = new WeakMap(); }
  private schema(): void {
    if (!this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=18").get()) fail();
    if ((this.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='ownership_semantic_results' OR name LIKE 'semantic_result_%'").get() as { n: number }).n !== semanticResultObjects.length) fail();
    for (const object of semanticResultObjects) {
      const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE name=? AND type=?").get(object.name, object.type) as { sql: string } | undefined;
      if (!row || row.sql.trim() !== object.sql.trim()) fail();
    }
  }
  migrate(): void {
    try {
      this.open(); if (this.db.pragma("foreign_keys", { simple: true }) !== 1) fail();
      this.db.transaction(() => {
        if (!this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=18").get()) {
          if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ownership_semantic_results' OR name LIKE 'semantic_result_%'").get()) fail();
          for (const object of semanticResultObjects) this.db.exec(object.sql);
          this.db.prepare("INSERT INTO schema_migrations VALUES(18,?)").run(new Date().toISOString());
        }
        this.schema();
        for (const row of this.db.prepare("SELECT * FROM ownership_semantic_results").all() as Row[]) this.stored(row);
      }).immediate();
    } catch (error) { throw safe(error); }
  }
  // Exact rows read by the ready-material port, plus the original question binding.
  // Scope is one attempt and one snapshot, never arbitrary tables or a whole library.
  private material(value: OwnershipSemanticResultEnvelope): string {
    const id = value.identity;
    const rows = [
      ["attempt", this.db.prepare("SELECT * FROM ownership_attempts WHERE attempt_id=?").all(id.attemptId)],
      ["capsule", this.db.prepare("SELECT * FROM ownership_semantic_capsules WHERE attempt_id=?").all(id.attemptId)],
      ["binding", this.db.prepare("SELECT * FROM ownership_question_bindings WHERE attempt_id=?").all(id.attemptId)],
      ...["snapshots", "snapshot_overviews", "source_snapshots", "nodes", "edges", "evidence"].map(table => [table,
        this.db.prepare(`SELECT * FROM ${table} WHERE snapshot_id=? ORDER BY rowid`).all(id.snapshotId)]),
    ];
    return canonicalJson(rows);
  }
  private relations(value: OwnershipSemanticResultEnvelope, preparing = false): void {
    const id = value.identity;
    const a = this.db.prepare("SELECT * FROM ownership_attempts WHERE attempt_id=?").get(id.attemptId) as Row | undefined;
    const c = this.db.prepare("SELECT * FROM ownership_semantic_capsules WHERE attempt_id=?").get(id.attemptId) as Row | undefined;
    if (!a || !c || typeof a.payload !== "string" || typeof c.payload !== "string") fail();
    const attempt = ownershipAttemptSchema.parse(JSON.parse(a.payload)), capsule = ownershipCapsuleSchema.parse(JSON.parse(c.payload));
    const overview = this.db.prepare("SELECT * FROM snapshot_overviews WHERE snapshot_id=?").get(id.snapshotId) as Row | undefined;
    if (capsule.status !== "ready" || a.attempt_id !== attempt.attemptId || a.repository_id !== attempt.repositoryId || a.snapshot_id !== attempt.snapshotId
      || a.completed_at !== attempt.completedAt || a.concept_id !== attempt.concept.id || c.attempt_id !== attempt.attemptId || c.repository_id !== attempt.repositoryId
      || c.snapshot_id !== attempt.snapshotId || c.status !== capsule.status || c.version !== capsule.version || c.attempt_hash !== capsule.attemptHash || c.capsule_hash !== capsule.capsuleHash
      || hash(ownershipAttemptPreimage(attempt)) !== capsule.attemptHash || hash(ownershipCapsulePreimage(capsule)) !== capsule.capsuleHash
      || id.attemptId !== attempt.attemptId || id.repositoryId !== attempt.repositoryId || id.snapshotId !== attempt.snapshotId || id.questionId !== attempt.questionId
      || id.questionVersion !== attempt.questionVersion || id.questionFingerprint !== capsule.questionFingerprint || id.attemptHash !== capsule.attemptHash
      || id.deterministicScoringVersion !== capsule.deterministicScoringVersion || id.rubricVersion !== capsule.rubric.version || id.rubricHash !== capsule.rubric.rubricHash
      || id.analysisResultFingerprint !== capsule.sourceIdentity.analysisResultFingerprint || id.configurationHash !== capsule.sourceIdentity.configurationHash
      || id.ignoreRevision !== capsule.sourceIdentity.ignoreRevision
      || id.sourceManifestHash !== capsule.sourceIdentity.sourceManifestHash || id.ignorePolicyHash !== capsule.sourceIdentity.ignorePolicyHash
      || !overview || overview.repository_id !== id.repositoryId || preparing && overview.activated_at !== id.activation) fail();
  }
  private stored(row: Row): OwnershipSemanticResultEnvelope {
    if (typeof row.payload !== "string" || Buffer.byteLength(row.payload, "utf8") > OWNERSHIP_SEMANTIC_RESULT_LIMITS.envelopeBytes) fail();
    const value = ownershipSemanticResultEnvelopeSchema.parse(JSON.parse(row.payload));
    ownershipSemanticTaskRecordSchema.parse({ identity: value.identity, phase: "completed", createdAt: value.createdAt, completedAt: value.completedAt, code: null });
    if (row.payload !== canonicalJson(value) || row.task_id !== value.identity.taskId || row.repository_id !== value.identity.repositoryId || row.snapshot_id !== value.identity.snapshotId
      || row.attempt_id !== value.identity.attemptId || row.binding_hash !== value.bindingHash || row.response_digest !== value.responseDigest
      || row.created_at !== value.createdAt || row.completed_at !== value.completedAt || value.bindingHash !== semanticBindingHash(value.identity)
      || value.responseDigest !== hash(canonicalJson(value.response)) || value.response.assessmentPackageId !== value.identity.assessmentPackageId
      || Buffer.byteLength(canonicalJson(value.response), "utf8") > OWNERSHIP_SEMANTIC_RESULT_LIMITS.responseBytes) fail();
    this.relations(value); return value;
  }
  private async validate(value: OwnershipSemanticResultEnvelope): Promise<void> {
    const material = await GraphStore.prototype.loadOwnershipSemanticPackage.call(this.owner, value.identity.attemptId) as OwnershipSemanticPackageRead;
    if (material.status !== "ready") fail();
    const pack = material.package;
    if (pack.assessmentPackageId !== value.identity.assessmentPackageId || pack.semanticScoringVersion !== value.identity.semanticScoringVersion) fail();
    this.relations(value);
    await validateOwnershipSemanticResponse(value.response, pack, material.attempt.semanticText);
  }
  async prepare(raw: unknown): Promise<PreparedSemanticResult> {
    try {
      this.open(); this.schema();
      // L5 captures the complete caller DTO synchronously before its first await.
      const pending = validateOwnershipSemanticResultEnvelope(raw);
      const value = await pending; this.open();
      const material = this.db.transaction(() => { this.relations(value, true); return this.material(value); }).deferred();
      await this.validate(value); this.open();
      this.db.transaction(() => { this.schema(); if (this.material(value) !== material) fail(); }).deferred();
      const receipt = Object.freeze({}) as PreparedSemanticResult; this.#prepared.set(receipt, { envelope: value, material }); return receipt;
    } catch (error) { throw safe(error); }
  }
  private authority(value: OwnershipSemanticResultEnvelope, owner: GraphStore, terminal: boolean): void {
    if (!(owner instanceof GraphStore) || owner.remote.role !== "global") fail();
    const db = Object.getOwnPropertyDescriptor(owner, "database")?.value as Database.Database | undefined;
    if (!db?.open || !db.inTransaction || !this.db.inTransaction) fail();
    const task = new OwnershipSemanticTaskStore(db, "global").read(value.identity.taskId);
    if (!task || canonicalJson(task.identity) !== canonicalJson(value.identity) || task.createdAt !== value.createdAt
      || (terminal ? !["failed", "cancelled", "interrupted"].includes(task.phase) : task.phase !== "dispatched")) fail();
    if (!terminal) {
      const row = db.prepare("SELECT inflight FROM ownership_semantic_tasks WHERE task_id=?").get(task.identity.taskId) as { inflight: number } | undefined;
      const lease = db.prepare("SELECT * FROM remote_provider_lease WHERE task_id=? AND purpose='ownership-semantic-assessment' AND stage='registered'").get(task.identity.taskId);
      if (row?.inflight !== 1 || !lease) fail();
    }
  }
  private candidate(envelope: OwnershipSemanticResultEnvelope): StoredSemanticCandidate {
    const value = Object.freeze({ kind: "stored-candidate" as const, envelope }) as StoredSemanticCandidate;
    this.#candidates.set(value, envelope); return value;
  }
  private changes(): number { return (this.db.prepare("SELECT total_changes() n").get() as { n: number }).n; }
  append(receipt: PreparedSemanticResult, trustedAuthority: GraphStore): StoredSemanticCandidate {
    try {
      this.open(); const prepared = receipt && typeof receipt === "object" ? this.#prepared.get(receipt) : undefined;
      if (!prepared) fail("INVALID_RECEIPT"); this.#prepared.delete(receipt);
      const value = prepared.envelope;
      this.authority(value, trustedAuthority, false);
      return this.db.transaction(() => {
        this.schema(); if (this.material(value) !== prepared.material) fail(); this.authority(value, trustedAuthority, false);
        const before = this.changes();
        const written = this.db.prepare("INSERT INTO ownership_semantic_results VALUES(?,?,?,?,?,?,?,?,?)").run(value.identity.taskId, value.identity.repositoryId, value.identity.snapshotId,
          value.identity.attemptId, value.bindingHash, value.responseDigest, value.createdAt, value.completedAt, canonicalJson(value));
        if (written.changes !== 1 || this.changes() !== before + 1) fail();
        const row = this.db.prepare("SELECT * FROM ownership_semantic_results WHERE task_id=?").get(value.identity.taskId) as Row | undefined;
        if (!row || canonicalJson(this.stored(row)) !== canonicalJson(value) || this.material(value) !== prepared.material) fail();
        this.authority(value, trustedAuthority, false); return this.candidate(value);
      }).immediate();
    } catch (error) { throw safe(error); }
  }
  async readCandidate(taskId: string): Promise<StoredSemanticCandidate | null> {
    try {
      this.open(); this.schema(); if (!remoteUuidSchema.safeParse(taskId).success) fail();
      const capture = this.db.transaction(() => {
        const row = this.db.prepare("SELECT * FROM ownership_semantic_results WHERE task_id=?").get(taskId) as Row | undefined;
        if (!row) return null; const value = this.stored(row); return { payload: row.payload, value, material: this.material(value) };
      }).deferred();
      if (!capture) return null;
      const value = await validateOwnershipSemanticResultEnvelope(capture.value); await this.validate(value); this.open();
      this.db.transaction(() => {
        this.schema(); const row = this.db.prepare("SELECT * FROM ownership_semantic_results WHERE task_id=?").get(taskId) as Row | undefined;
        if (!row || row.payload !== capture.payload || canonicalJson(this.stored(row)) !== canonicalJson(value) || this.material(value) !== capture.material) fail();
      }).deferred(); return this.candidate(value);
    } catch (error) { throw safe(error); }
  }
  compensate(candidate: StoredSemanticCandidate, trustedAuthority: GraphStore): void {
    try {
      this.open(); const value = candidate && typeof candidate === "object" ? this.#candidates.get(candidate) : undefined;
      if (!value) fail("INVALID_RECEIPT"); this.authority(value, trustedAuthority, true);
      this.db.transaction(() => {
        this.schema(); this.authority(value, trustedAuthority, true);
        const row = this.db.prepare("SELECT * FROM ownership_semantic_results WHERE task_id=?").get(value.identity.taskId) as Row | undefined;
        if (!row) return;
        if (canonicalJson(this.stored(row)) !== canonicalJson(value)) fail();
        const before = this.changes();
        const deleted = this.db.prepare("DELETE FROM ownership_semantic_results WHERE task_id=? AND payload=?").run(value.identity.taskId, canonicalJson(value));
        if (deleted.changes !== 1 || this.changes() !== before + 1) fail();
        if (this.db.prepare("SELECT 1 FROM ownership_semantic_results WHERE task_id=?").get(value.identity.taskId)) fail();
        this.authority(value, trustedAuthority, true);
      }).immediate();
    } catch (error) { throw safe(error); }
  }
}
