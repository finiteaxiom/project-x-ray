import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { SharedRemoteTaskStore } from "./shared-remote-task-store.js";
import {
  canonicalJson, IGNORE_POLICY_VERSION, REMOTE_DATA_CATEGORIES, RemoteExplanationError, remoteActivationSchema, remoteAuthorizationSchema,
  remoteCapturedIdentitySchema, remoteContextSchema, remoteIdSchema, remoteProviderSettingsSchema, remoteResultSchema,
  remotePersistentTaskRecordSchema, remoteUuidSchema, remoteRevisionSchema, remoteFailureCodeSchema,
  type RemoteActivation, type RemoteAuthorization, type RemoteCapturedIdentity, type RemoteContext, type RemoteFailureCode,
  type RemoteProviderSettings, type RemoteResult, type RemoteTaskRecord,
} from "@project-xray/contracts";

export type GraphStoreRole = "global" | "project";
type PayloadRow = { payload: string };
const digest = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
const now = (): string => new Date().toISOString();
export function remoteStoreFailure(error: unknown): RemoteExplanationError {
  try {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (error instanceof RemoteExplanationError && remoteFailureCodeSchema.safeParse(code).success) return new RemoteExplanationError(code as RemoteFailureCode);
    return new RemoteExplanationError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "BUSY" : code === "IGNORE_SETTINGS_CONFLICT" ? "REVISION_CONFLICT" : "POLICY_INVALID");
  } catch { return new RemoteExplanationError("POLICY_INVALID"); }
}
function synchronous<T>(work: () => T): T {
  const result = work();
  if (result && (typeof result === "object" || typeof result === "function") && "then" in result) throw new RemoteExplanationError("POLICY_INVALID");
  return result;
}
function revision(value: number): number {
  if (!remoteRevisionSchema.safeParse(value).success || value === Number.MAX_SAFE_INTEGER) throw new RemoteExplanationError("REVISION_CONFLICT");
  return value + 1;
}

/** Shares GraphStore's connection. No secrets or provider response bodies are stored here. */
export class RemoteExplanationStore {
  private readonly sharedTasks: SharedRemoteTaskStore;
  constructor(private readonly db: Database.Database, readonly role: GraphStoreRole) { this.sharedTasks = new SharedRemoteTaskStore(db, role); }

  migrate(): void {
    if (this.role !== "global" && this.role !== "project") throw new RemoteExplanationError("POLICY_INVALID");
    this.immediate(() => {
      this.sharedTasks.validateExistingMigration();
      this.db.exec("CREATE TABLE IF NOT EXISTS remote_explanations(task_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,payload TEXT NOT NULL)");
      if (this.role === "global") this.db.exec(`
        CREATE TABLE IF NOT EXISTS remote_provider_settings(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS project_remote_authorizations(repository_id TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS explanation_contexts(owner_session_id TEXT PRIMARY KEY,context_handle TEXT UNIQUE NOT NULL,payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS explanation_tasks(task_id TEXT PRIMARY KEY,owner_session_id TEXT NOT NULL,phase TEXT NOT NULL,payload TEXT NOT NULL,inflight INTEGER NOT NULL CHECK(inflight IN (0,1)));
        CREATE UNIQUE INDEX IF NOT EXISTS explanation_single_dispatch ON explanation_tasks(inflight) WHERE inflight=1;
      `);
      this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(10,?)").run(now());
      this.sharedTasks.migrate();
    });
  }

  immediate<T>(work: () => T): T {
    try { return this.db.transaction(() => synchronous(work)).immediate(); }
    catch (error) { throw remoteStoreFailure(error); }
  }
  private global(): void { if (this.role !== "global") throw new RemoteExplanationError("POLICY_INVALID"); }
  private read(table: string, column: string, id: string | number): unknown | undefined {
    const row = this.db.prepare(`SELECT payload FROM ${table} WHERE ${column}=?`).get(id) as PayloadRow | undefined;
    if (!row) return undefined;
    if (Buffer.byteLength(row.payload) > 262144) throw new RemoteExplanationError("POLICY_INVALID");
    try { return JSON.parse(row.payload); } catch { throw new RemoteExplanationError("POLICY_INVALID"); }
  }

  provider(): RemoteProviderSettings {
    this.global();
    try { return remoteProviderSettingsSchema.parse(this.read("remote_provider_settings", "id", 1) ?? { provider: "openai", model: null, revision: 0, credentialRevision: 0, credentialStatus: "unconfigured", outputTokens: 2048 }); }
    catch (error) { throw remoteStoreFailure(error); }
  }
  saveProvider(expectedRevision: number, input: Omit<RemoteProviderSettings, "revision">): RemoteProviderSettings {
    this.global();
    return this.immediate(() => {
      const old = this.provider(); if (old.revision !== expectedRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
      const next = remoteProviderSettingsSchema.parse({ ...remoteProviderSettingsSchema.omit({ revision: true }).parse(input), revision: revision(old.revision) });
      if (next.credentialRevision < old.credentialRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
      this.db.prepare("INSERT INTO remote_provider_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(next));
      this.terminateMatching(() => true, "NOT_CONFIGURED"); return next;
    });
  }
  authorization(repositoryId: string): RemoteAuthorization {
    this.global();
    try {
      remoteIdSchema.parse(repositoryId);
      const record = remoteAuthorizationSchema.parse(this.read("project_remote_authorizations", "repository_id", repositoryId) ?? { version: "1.0.0", repositoryId, provider: "openai", scope: [], disclosureVersion: "1.0.0", revision: 0, status: "denied", categories: [], grantedAt: null, revokedAt: null });
      if (record.repositoryId !== repositoryId || (record.status === "granted" && (record.scope.length !== 1 || record.categories.length !== 6 || new Set(record.categories).size !== 6 || !record.grantedAt || record.revokedAt !== null))) throw new RemoteExplanationError("POLICY_INVALID");
      return record;
    } catch (error) { throw remoteStoreFailure(error); }
  }
  /** Trusted command after main has verified sender and explicit disclosure choice. */
  saveAuthorization(repositoryId: string, expectedRevision: number, granted: boolean): RemoteAuthorization {
    this.global();
    if (typeof granted !== "boolean") throw new RemoteExplanationError("POLICY_INVALID");
    return this.immediate(() => {
      const old = this.authorization(repositoryId); if (old.revision !== expectedRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
      const next = remoteAuthorizationSchema.parse({ ...old, revision: revision(old.revision), status: granted ? "granted" : "denied", scope: granted ? ["feature-explanation"] : [], categories: granted ? [...REMOTE_DATA_CATEGORIES] : [], grantedAt: granted ? now() : old.grantedAt, revokedAt: granted ? null : now() });
      this.db.prepare("INSERT INTO project_remote_authorizations VALUES(?,?) ON CONFLICT(repository_id) DO UPDATE SET payload=excluded.payload").run(repositoryId, JSON.stringify(next));
      this.terminateMatching(task => task.identity.repositoryId === repositoryId, "CONSENT_REVOKED"); return next;
    });
  }
  context(handle: string): RemoteContext {
    this.global();
    try {
      remoteUuidSchema.parse(handle); const value = this.read("explanation_contexts", "context_handle", handle);
      if (!value) throw new RemoteExplanationError("CONTEXT_CHANGED");
      const context = remoteContextSchema.parse(value);
      const row = this.db.prepare("SELECT owner_session_id FROM explanation_contexts WHERE context_handle=?").get(handle) as { owner_session_id: string };
      if (context.contextHandle !== handle || context.ownerSessionId !== row.owner_session_id) throw new RemoteExplanationError("POLICY_INVALID");
      if (!context.active) throw new RemoteExplanationError("CONTEXT_CHANGED"); return context;
    } catch (error) { throw remoteStoreFailure(error); }
  }
  /** Not an IPC API: only a main-owned adapter may supply the owner session. */
  commitTrustedContext(ownerSessionId: string, reference: RemoteActivation | null): RemoteContext {
    this.global();
    return this.immediate(() => {
      remoteUuidSchema.parse(ownerSessionId);
      const oldValue = this.read("explanation_contexts", "owner_session_id", ownerSessionId);
      const old = oldValue ? remoteContextSchema.parse(oldValue) : undefined;
      if (old && old.ownerSessionId !== ownerSessionId) throw new RemoteExplanationError("POLICY_INVALID");
      const context = remoteContextSchema.parse({ ownerSessionId, contextHandle: randomUUID(), epoch: revision(old?.epoch ?? 0), active: reference !== null, reference });
      this.db.prepare("INSERT INTO explanation_contexts VALUES(?,?,?) ON CONFLICT(owner_session_id) DO UPDATE SET context_handle=excluded.context_handle,payload=excluded.payload").run(ownerSessionId, context.contextHandle, JSON.stringify(context));
      this.terminateMatching(task => task.identity.ownerSessionId === ownerSessionId, "CONTEXT_CHANGED"); return context;
    });
  }

  /** Reads actual activation and immutable identities, without loading nodes/edges/source text. */
  activation(repositoryId: string, snapshotId: string): RemoteActivation {
    try {
      remoteIdSchema.parse(repositoryId); remoteIdSchema.parse(snapshotId);
      const row = this.db.prepare(`SELECT s.repository_id, o.activated_at, o.is_current,
        json_extract(s.payload,'$.analysisIdentity') identity,
        json_extract(s.payload,'$.sourceFiles') manifest
        FROM snapshots s JOIN snapshot_overviews o ON s.snapshot_id=o.snapshot_id WHERE s.snapshot_id=?`).get(snapshotId) as { repository_id: string; activated_at: string; is_current: number; identity: string; manifest: string } | undefined;
      if (!row || row.repository_id !== repositoryId || row.is_current !== 1) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
      const identity = JSON.parse(row.identity) as Record<string, unknown>;
      const result = identity.analysisResult as { fingerprint?: string } | undefined;
      // Old snapshots remain usable offline, but remote requests require re-indexing.
      if (!result) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
      const manifest: unknown = JSON.parse(row.manifest);
      const actual = this.db.prepare("SELECT file_path filePath,content_hash contentHash,length(CAST(content AS BLOB)) bytes,language FROM source_snapshots WHERE snapshot_id=? ORDER BY file_path").all(snapshotId);
      // Canonical sort must be the same for manifest and database rows (not locale dependent).
      const ordered = (items: unknown): unknown => Array.isArray(items) ? [...items].sort((a, b) => String(a.filePath) < String(b.filePath) ? -1 : String(a.filePath) > String(b.filePath) ? 1 : 0) : null;
      if (canonicalJson(ordered(manifest)) !== canonicalJson(ordered(actual))) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
      return remoteActivationSchema.parse({ repositoryId, snapshotId, activation: row.activated_at, analysisResultFingerprint: result.fingerprint, configurationHash: identity.configurationHash, ignorePolicyHash: (identity.ignorePolicy as { hash?: string } | undefined)?.hash ?? null, sourceManifestHash: digest(ordered(actual)) });
    } catch (error) { throw remoteStoreFailure(error); }
  }

  assertIdentity(identity: RemoteCapturedIdentity, settings: { loadIgnoreSettings(repositoryId: string): { revision: number; rules: string[] } }, source: RemoteExplanationStore): void {
    this.global();
    identity = remoteCapturedIdentitySchema.parse(identity);
    const context = this.context(identity.contextHandle);
    if (context.epoch !== identity.contextEpoch || context.ownerSessionId !== identity.ownerSessionId || context.reference?.repositoryId !== identity.repositoryId || context.reference.snapshotId !== identity.snapshotId) throw new RemoteExplanationError("CONTEXT_CHANGED");
    const active = source.activation(identity.repositoryId, identity.snapshotId);
    if (active.activation !== identity.activation || canonicalJson(active) !== canonicalJson(context.reference) || active.configurationHash !== identity.configurationHash || active.ignorePolicyHash !== identity.ignorePolicyHash || active.sourceManifestHash !== identity.sourceManifestHash || active.analysisResultFingerprint !== identity.analysisResultFingerprint) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
    const ignore = settings.loadIgnoreSettings(identity.repositoryId);
    if (ignore.revision !== identity.ignoreRevision || (identity.ignorePolicyHash !== null ? createHash("sha256").update(JSON.stringify([IGNORE_POLICY_VERSION, ignore.rules])).digest("hex") !== identity.ignorePolicyHash : ignore.rules.length > 0)) throw new RemoteExplanationError("REVISION_CONFLICT");
    const provider = this.provider(); if (provider.revision !== identity.providerRevision || provider.credentialRevision !== identity.credentialRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
    const auth = this.authorization(identity.repositoryId); if (auth.revision !== identity.authorizationRevision) throw new RemoteExplanationError("CONSENT_REVOKED");
  }
  assertPermission(identity: RemoteCapturedIdentity): void {
    const auth = this.authorization(identity.repositoryId);
    if (auth.revision !== identity.authorizationRevision) throw new RemoteExplanationError("CONSENT_REVOKED");
    if (auth.status !== "granted") throw new RemoteExplanationError("CONSENT_REQUIRED");
    const provider = this.provider();
    if (provider.revision !== identity.providerRevision || provider.credentialRevision !== identity.credentialRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
    if (!provider.model || provider.credentialStatus === "unconfigured") throw new RemoteExplanationError("NOT_CONFIGURED");
    if (provider.credentialStatus !== "configured") throw new RemoteExplanationError("CREDENTIAL_UNAVAILABLE");
  }
  task(taskId: string): RemoteTaskRecord | null {
    this.global();
    try { return this.sharedTasks.featureTask(taskId); } catch (error) { throw remoteStoreFailure(error); }
  }
  registerDispatch(identity: RemoteCapturedIdentity): RemoteTaskRecord {
    this.global();
    if (!this.db.inTransaction) throw new RemoteExplanationError("POLICY_INVALID");
    identity = remoteCapturedIdentitySchema.parse(identity);
    this.assertPermission(identity);
    const context = this.context(identity.contextHandle);
    const reference = remoteActivationSchema.parse({ repositoryId: identity.repositoryId, snapshotId: identity.snapshotId, activation: identity.activation,
      analysisResultFingerprint: identity.analysisResultFingerprint, configurationHash: identity.configurationHash, ignorePolicyHash: identity.ignorePolicyHash, sourceManifestHash: identity.sourceManifestHash });
    if (context.ownerSessionId !== identity.ownerSessionId || context.epoch !== identity.contextEpoch || canonicalJson(context.reference) !== canonicalJson(reference)) throw new RemoteExplanationError("CONTEXT_CHANGED");
    this.sharedTasks.assertAvailable(identity.taskId, true);
    const task = remotePersistentTaskRecordSchema.parse({ identity, phase: "dispatched", createdAt: now(), completedAt: null, code: null });
    this.sharedTasks.insertFeature(task, 1); return task;
  }
  recordUndispatchedCancellation(identity: RemoteCapturedIdentity, createdAt: string): RemoteTaskRecord {
    this.global(); if (!this.db.inTransaction) throw new RemoteExplanationError("POLICY_INVALID");
    identity = remoteCapturedIdentitySchema.parse(identity);
    const context = this.context(identity.contextHandle);
    if (context.ownerSessionId !== identity.ownerSessionId || context.epoch !== identity.contextEpoch) throw new RemoteExplanationError("CONTEXT_CHANGED");
    this.sharedTasks.assertAvailable(identity.taskId, false);
    const task = remotePersistentTaskRecordSchema.parse({ identity, phase: "cancelled", createdAt, completedAt: now(), code: "CANCELLED" });
    // No permission check, dispatched phase, or network lease: cancellation only records the terminal.
    this.sharedTasks.insertFeature(task, 0); return task;
  }
  finish(taskId: string, code: RemoteFailureCode | null): RemoteTaskRecord {
    this.global();
    return this.immediate(() => {
      const old = this.task(taskId); if (!old) throw new RemoteExplanationError("CONTEXT_CHANGED"); if (old.phase !== "dispatched") return old;
      const phase = code === null ? "completed" : code === "CANCELLED" ? "cancelled" : code === "INTERRUPTED" ? "interrupted" : "failed";
      const next = remotePersistentTaskRecordSchema.parse({ ...old, phase, completedAt: now(), code });
      this.sharedTasks.validateTerminalTime(old.createdAt, next.completedAt!);
      this.db.prepare("UPDATE explanation_tasks SET phase=?,payload=? WHERE task_id=? AND phase='dispatched'").run(phase, JSON.stringify(next), taskId);
      this.sharedTasks.assertFeatureWrite(next, 1); return next;
    });
  }
  private terminateMatching(matches: (task: RemoteTaskRecord) => boolean, code: RemoteFailureCode): void {
    const rows = this.db.prepare("SELECT task_id FROM explanation_tasks WHERE phase='dispatched'").all() as { task_id: string }[];
    for (const row of rows) { const task = this.task(row.task_id)!; if (matches(task)) this.finish(row.task_id, code); }
  }
  /** Called once by the trusted broker at worker startup; never restores a request. */
  recoverInterrupted(): void {
    this.global(); this.immediate(() => {
      this.sharedTasks.assertFeatureRecovery();
      this.terminateMatching(() => true, "INTERRUPTED");
      const tasks = this.db.prepare("SELECT task_id FROM explanation_tasks WHERE inflight=1").all() as { task_id: string }[];
      for (const task of tasks) this.sharedTasks.releaseFeature(task.task_id);
      const rows = this.db.prepare("SELECT owner_session_id FROM explanation_contexts").all() as { owner_session_id: string }[];
      for (const row of rows) this.commitTrustedContext(row.owner_session_id, null);
    });
  }
  releaseDispatch(taskId: string): void {
    this.global(); this.immediate(() => {
      this.sharedTasks.releaseFeature(taskId);
    });
  }
  appendResult(raw: RemoteResult): void {
    if (!this.db.inTransaction) throw new RemoteExplanationError("POLICY_INVALID");
    const result = remoteResultSchema.parse(raw);
    this.db.prepare("INSERT INTO remote_explanations VALUES(?,?,?,?)").run(result.identity.taskId, result.identity.repositoryId, result.identity.snapshotId, JSON.stringify(result));
  }
  /** Only after an authoritative non-success terminal: compensate a cross-DB failed commit. */
  discardUnpublishedResult(identity: RemoteCapturedIdentity): void {
    if (!this.db.inTransaction) throw new RemoteExplanationError("POLICY_INVALID");
    identity = remoteCapturedIdentitySchema.parse(identity);
    const result = this.result(identity.taskId); if (!result) return;
    if (canonicalJson(result.identity) !== canonicalJson(identity)) throw new RemoteExplanationError("POLICY_INVALID");
    this.db.prepare("DELETE FROM remote_explanations WHERE task_id=? AND repository_id=? AND snapshot_id=?").run(identity.taskId, identity.repositoryId, identity.snapshotId);
  }
  result(taskId: string): RemoteResult | null {
    try { remoteUuidSchema.parse(taskId); const value = this.read("remote_explanations", "task_id", taskId); return value ? remoteResultSchema.parse(value) : null; }
    catch (error) { throw remoteStoreFailure(error); }
  }
}
