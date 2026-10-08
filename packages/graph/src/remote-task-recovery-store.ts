import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { canonicalJson, projectSnapshotSchema, remoteContextSchema, remotePersistentTaskRecordSchema, remoteCapturedIdentitySchema,
  ownershipSemanticCapturedIdentitySchema, snapshotRefSchema, RemoteExplanationError, type SnapshotRef, type RemoteTaskRecord, type OwnershipSemanticTaskRecord } from "@project-xray/contracts";
import type { GraphStore } from "./index.js";
import { SharedRemoteTaskStore, type RemoteRecoveryState } from "./shared-remote-task-store.js";
import { OwnershipSemanticTaskStore } from "./ownership-semantic-task-store.js";
import type { OwnershipSemanticResultStore } from "./ownership-semantic-result-store.js";

declare const captureBrand: unique symbol, permitBrand: unique symbol, sourceBrand: unique symbol;
export interface RemoteRecoveryCapture { readonly [captureBrand]: true; readonly owners: readonly string[]; readonly occupied: { taskId: string; owner: string; purpose: "feature-explanation" | "ownership-semantic-assessment" } | null }
export interface RemoteRecoveryPermit { readonly [permitBrand]: true }
export interface RemoteRecoverySource { readonly [sourceBrand]: true }
/** Privileged construction port: issuer stays in the trusted lifecycle closure.
 * Graph receives no Worker, Boolean, caller inventory or stop callback. */
export interface RemoteRecoveryIssuer {
  close(): void;
  capture(): RemoteRecoveryCapture;
  authorize(capture: RemoteRecoveryCapture): RemoteRecoveryPermit;
  recover(permit: RemoteRecoveryPermit, sources: readonly RemoteRecoverySource[], contextVeto?: () => void): Promise<{ terminalCommitted: boolean; sourceCommitted: boolean; released: boolean }>;
}
export class RemoteRecoveryError extends RemoteExplanationError {
  constructor(code: import("@project-xray/contracts").RemoteFailureCode, readonly progress: Readonly<{ terminalCommitted: boolean; sourceCommitted: boolean; released: boolean }>) { super(code); }
}
interface RecoverySession { closed: boolean }
interface Binding { ref: SnapshotRef; source: GraphStore; settings: GraphStore; sourceDb: Database.Database; settingsDb: Database.Database; results: OwnershipSemanticResultStore; preimage: string }
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
function safe(error: unknown): RemoteExplanationError {
  if (error instanceof RemoteExplanationError) return new RemoteExplanationError(error.code);
  const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
  return new RemoteExplanationError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "BUSY" : "POLICY_INVALID");
}
/** Internal recovery only. Each issuer/capture/permit is tied to this actual open
 * authority; no existing dispatch or feature-only recovery API is relaxed. */
export class RemoteTaskRecoveryStore {
  #closed = false;
  #captures = new WeakMap<object, { state: RemoteRecoveryState; session: RecoverySession }>();
  #permits = new WeakMap<object, { state: RemoteRecoveryState; session: RecoverySession }>();
  #sources = new WeakMap<object, Binding>();
  constructor(private readonly db: Database.Database, private readonly owner: GraphStore) {}
  close(): void { this.#closed = true; this.#captures = new WeakMap(); this.#permits = new WeakMap(); this.#sources = new WeakMap(); }
  private open(): void { if (this.#closed || !this.db.open || this.owner.remote.role !== "global") invalid(); }
  private capture(): RemoteRecoveryState {
    this.open();
    const read = () => {
      this.owner.remote.provider();
      const state = new SharedRemoteTaskStore(this.db, "global").captureRecoveryState();
      for (const row of this.db.prepare("SELECT * FROM explanation_contexts").all() as { owner_session_id: string; context_handle: string; payload: string }[]) {
        const value = remoteContextSchema.parse(JSON.parse(row.payload));
        if (value.ownerSessionId !== row.owner_session_id || value.contextHandle !== row.context_handle) invalid();
      }
      return state;
    };
    return this.db.inTransaction ? read() : this.db.transaction(read).immediate();
  }
  private same(state: RemoteRecoveryState): void { if (this.capture().preimage !== state.preimage) invalid(); }
  issuer(): RemoteRecoveryIssuer {
    this.open();
    const session: RecoverySession = { closed: false };
    return Object.freeze({
      close: () => { session.closed = true; },
      capture: () => { if (session.closed) invalid(); const state = this.capture(), cap = Object.freeze({ owners: Object.freeze([...state.owners]), occupied: state.occupied ? Object.freeze({ taskId: String(state.occupied.identity.taskId), owner: String(state.occupied.identity.ownerSessionId), purpose: state.occupied.purpose }) : null }) as RemoteRecoveryCapture; this.#captures.set(cap, { state, session }); return cap; },
      authorize: (cap: RemoteRecoveryCapture) => {
        this.open(); const captured = this.#captures.get(cap); if (!captured || captured.session !== session || session.closed) invalid(); const state = captured.state; this.#captures.delete(cap); this.same(state);
        const permit = Object.freeze({}) as RemoteRecoveryPermit; this.#permits.set(permit, { state, session }); return permit;
      },
      recover: (permit: RemoteRecoveryPermit, sources: readonly RemoteRecoverySource[], contextVeto?: () => void) => this.recover(permit, sources, session, contextVeto),
    });
  }
  private material(b: Binding): string {
    if (!b.sourceDb.open || !b.settingsDb.open) invalid();
    // A default ignore value on an unrelated empty project DB is not a locator.
    // A distinct settings DB must already have this repository's actual metadata.
    if (b.settingsDb !== b.sourceDb && b.settingsDb !== this.db && !b.settingsDb.prepare(
      "SELECT repository_id FROM snapshot_overviews WHERE repository_id=? UNION SELECT repository_id FROM project_ignore_settings WHERE repository_id=?"
    ).get(b.ref.repositoryId, b.ref.repositoryId)) invalid();
    const row = b.sourceDb.prepare("SELECT payload,repository_id FROM snapshots WHERE snapshot_id=?").get(b.ref.snapshotId) as { payload: string; repository_id: string } | undefined;
    if (!row) invalid(); const snapshot = projectSnapshotSchema.parse(JSON.parse(row.payload));
    if (row.repository_id !== b.ref.repositoryId || snapshot.repositoryId !== b.ref.repositoryId || snapshot.snapshotId !== b.ref.snapshotId) invalid();
    const overview = b.sourceDb.prepare("SELECT repository_id FROM snapshot_overviews WHERE snapshot_id=?").get(b.ref.snapshotId) as { repository_id: string } | undefined;
    if (overview?.repository_id !== b.ref.repositoryId) invalid();
    const sources = b.sourceDb.prepare("SELECT * FROM source_snapshots WHERE snapshot_id=? ORDER BY file_path").all(b.ref.snapshotId) as { file_path: string; content: string; content_hash: string; language: string }[];
    if (sources.length !== snapshot.sourceFiles.length) invalid();
    for (const file of sources) if (createHash("sha256").update(file.content).digest("hex") !== file.content_hash || !snapshot.sourceFiles.some(f => f.filePath === file.file_path && f.contentHash === file.content_hash && f.bytes === Buffer.byteLength(file.content, "utf8") && f.language === file.language)) invalid();
    const facts = ["snapshot_overviews", "nodes", "edges", "evidence", "ownership_attempts", "ownership_semantic_capsules", "mastery_records"].map(table => [table, b.sourceDb.prepare(`SELECT * FROM ${table} WHERE snapshot_id=? ORDER BY rowid`).all(b.ref.snapshotId)]);
    const bindings = b.sourceDb.prepare("SELECT * FROM ownership_question_bindings WHERE attempt_id IN(SELECT attempt_id FROM ownership_attempts WHERE snapshot_id=?) ORDER BY rowid").all(b.ref.snapshotId);
    // Recovery may delete only its unpublished result. Preserve actual history of
    // the known source and settings stores, including snapshots other than this task.
    const history = ["snapshots", "source_snapshots", "snapshot_overviews", "nodes", "edges", "evidence", "ownership_attempts", "ownership_semantic_capsules", "ownership_question_bindings", "mastery_records"].map(table => [table, b.sourceDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
    const settingsHistory = b.settingsDb.prepare("SELECT * FROM project_ignore_settings ORDER BY rowid").all();
    return canonicalJson({ snapshot: row, sources, facts, bindings, history, settingsHistory, settings: b.settings.loadIgnoreSettings(b.ref.repositoryId) });
  }
  bind(ref: SnapshotRef, settings: GraphStore, settingsDb: Database.Database, source: GraphStore, sourceDb: Database.Database, results: OwnershipSemanticResultStore): RemoteRecoverySource {
    try {
      this.open(); const b: Binding = { ref: snapshotRefSchema.parse(ref), settings, settingsDb, source, sourceDb, results, preimage: "" };
      if ([this.db, settingsDb, sourceDb].some(db => !db.open || db.inTransaction)) invalid();
      b.preimage = this.material(b); const cap = Object.freeze({}) as RemoteRecoverySource; this.#sources.set(cap, b); return cap;
    } catch (error) { throw safe(error); }
  }
  private binding(state: RemoteRecoveryState, sources: readonly RemoteRecoverySource[]): Binding | null {
    if (!state.occupied) return null;
    const id = state.occupied.identity;
    const matches: Binding[] = [];
    for (const cap of sources) {
      const b = this.#sources.get(cap); if (!b) invalid();
      if (b.ref.repositoryId === id.repositoryId && b.ref.snapshotId === id.snapshotId) matches.push(b);
    }
    if (matches.length !== 1) invalid(); const b = matches[0]!;
    if (this.material(b) !== b.preimage) invalid(); return b;
  }
  private stable(state: RemoteRecoveryState, final = false): string {
    const taskId = state.occupied?.identity.taskId;
    const tables = JSON.parse(state.preimage) as [string, Record<string, unknown>[]][];
    return canonicalJson(tables.map(([table, rows]) => [table,
      final && table === "explanation_contexts" ? [] : ["remote_provider_lease", "explanation_tasks", "ownership_semantic_tasks"].includes(table)
        ? rows.filter(row => row.task_id !== taskId) : rows]));
  }
  private task(state: RemoteRecoveryState): RemoteTaskRecord | OwnershipSemanticTaskRecord | null {
    const occupied = state.occupied; if (!occupied) return null;
    const id = occupied.identity;
    return occupied.purpose === "feature-explanation" ? this.owner.remote.task(String(id.taskId)) : new OwnershipSemanticTaskStore(this.db, "global").read(String(id.taskId));
  }
  private terminal(state: RemoteRecoveryState): void {
    const o = state.occupied; if (!o) return;
    const old = this.task(state);
    if (!old) {
      if (o.purpose === "feature-explanation") {
        const shared = new SharedRemoteTaskStore(this.db, "global");
        const task = remotePersistentTaskRecordSchema.parse({ identity: remoteCapturedIdentitySchema.parse(o.identity), phase: "interrupted", code: "INTERRUPTED", createdAt: o.createdAt, completedAt: new Date().toISOString() });
        shared.promoteFeature(task, 1);
      } else new OwnershipSemanticTaskStore(this.db, "global").terminalReserved(ownershipSemanticCapturedIdentitySchema.parse(o.identity), "INTERRUPTED");
    } else if (old.phase === "dispatched") {
      if (o.purpose === "feature-explanation") this.owner.remote.finish(old.identity.taskId, "INTERRUPTED");
      else new OwnershipSemanticTaskStore(this.db, "global").finish(ownershipSemanticCapturedIdentitySchema.parse(o.identity), "INTERRUPTED");
    }
  }
  private async recover(permit: RemoteRecoveryPermit, sources: readonly RemoteRecoverySource[], session: RecoverySession, contextVeto?: () => void) {
    const progress = { terminalCommitted: false, sourceCommitted: false, released: false };
    const permission = this.#permits.get(permit); if (!permission || permission.session !== session || session.closed) invalid(); this.#permits.delete(permit);
    let state = permission.state;
    // Trusted synchronous context refusal is additional to every original SQL
    // guard, including after readCandidate awaits. It cannot authorize recovery.
    const current = (expected: RemoteRecoveryState) => {
      if (session.closed) invalid();
      if (contextVeto !== undefined && (typeof contextVeto !== "function" || contextVeto() !== undefined)) invalid();
      this.same(expected);
    };
    try {
      this.open(); current(state); const binding = this.binding(state, sources);
      if ([this.db, ...(binding ? [binding.settingsDb, binding.sourceDb] : [])].some(db => !db.open || db.inTransaction)) invalid();
      this.db.transaction(() => { current(state!); this.terminal(state!); const next = this.capture(); if (this.stable(state!) !== this.stable(next)) invalid(); state = next; }).immediate(); progress.terminalCommitted = true;
      const task = this.task(state), completed = task?.phase === "completed";
      const candidate = binding && state.occupied?.purpose === "ownership-semantic-assessment" ? await binding.results.readCandidate(String(state.occupied.identity.taskId)) : null;
      current(state);
      const held: Database.Database[] = []; let sourceCommitted = false, primary: unknown;
      try {
        this.db.transaction(() => {
          for (const db of [...new Set(binding ? [binding.settingsDb, binding.sourceDb] : [])].filter(db => db !== this.db)) { db.exec("BEGIN IMMEDIATE"); held.push(db); }
          current(state!);
          let verifySource: (() => void) | undefined;
          if (binding) {
            if (this.material(binding) !== binding.preimage) invalid();
            const o = state!.occupied!;
            const history = () => canonicalJson(["remote_explanations", "ownership_semantic_results"].map(table => [table, binding.sourceDb.prepare(`SELECT * FROM ${table} WHERE task_id<>? ORDER BY rowid`).all(o.identity.taskId)]));
            const oldHistory = history();
            const resultTables = ["remote_explanations", "ownership_semantic_results"] as const;
            const resultRows = () => resultTables.map(table => [table, binding.sourceDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
            const targetTable = o.purpose === "feature-explanation" ? "remote_explanations" : "ownership_semantic_results";
            // Expected state is computed before any cleanup, never from its side effects.
            const expectedResults = canonicalJson(resultTables.map(table => [table,
              (binding.sourceDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as { task_id: string }[])
                .filter(row => completed || table !== targetTable || row.task_id !== o.identity.taskId)]));
            verifySource = () => {
              if (this.material(binding) !== binding.preimage || history() !== oldHistory || canonicalJson(resultRows()) !== expectedResults) invalid();
              if (candidate && completed) binding.results.assertCandidate(candidate);
            };
            if (o.purpose === "ownership-semantic-assessment") {
              if (candidate) {
                const value = binding.results.assertCandidate(candidate);
                if (canonicalJson(value.identity) !== canonicalJson(o.identity) || value.createdAt !== o.createdAt || completed && value.completedAt !== task!.completedAt) invalid();
                if (!completed) binding.results.compensate(candidate, this.owner);
              } else if (completed) invalid();
            } else {
              const result = binding.source.remote.result(String(o.identity.taskId));
              if (result && (canonicalJson(result.identity) !== canonicalJson(o.identity) || completed && result.completedAt !== task!.completedAt)) invalid();
              if (completed && !result) invalid();
              if (!completed) binding.source.remote.discardUnpublishedResult(remoteCapturedIdentitySchema.parse(o.identity));
            }
            verifySource();
            if (binding.sourceDb !== this.db) {
              // Source commit is real and cannot be undone by the later global commit.
              binding.sourceDb.exec("COMMIT"); sourceCommitted = true; progress.sourceCommitted = true;
              binding.sourceDb.exec("BEGIN IMMEDIATE");
            }
            current(state!); verifySource();
            if (!completed) {
              const table = o.purpose === "feature-explanation" ? "remote_explanations" : "ownership_semantic_results";
              if (binding.sourceDb.prepare(`SELECT 1 FROM ${table} WHERE task_id=?`).get(o.identity.taskId)) invalid();
            } else if (candidate) binding.results.assertCandidate(candidate);
          }
          const priorContexts = this.db.prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all() as { owner_session_id: string; context_handle: string; payload: string }[];
          for (const owner of state!.owners) {
            const committed = this.owner.remote.commitTrustedContext(owner, null);
            const row = this.db.prepare("SELECT * FROM explanation_contexts WHERE owner_session_id=?").get(owner) as { owner_session_id: string; context_handle: string; payload: string };
            if (row.owner_session_id !== owner || row.context_handle !== committed.contextHandle) invalid();
            if (canonicalJson(remoteContextSchema.parse(JSON.parse(row.payload))) !== canonicalJson(committed)) invalid();
            const index = priorContexts.findIndex(value => value.owner_session_id === owner);
            if (index === -1) priorContexts.push(row); else priorContexts[index] = row;
          }
          if (canonicalJson(this.db.prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all()) !== canonicalJson(priorContexts)) invalid();
          const o = state!.occupied;
          if (o) {
            if (o.purpose === "feature-explanation") this.owner.remote.releaseDispatch(String(o.identity.taskId));
            else new OwnershipSemanticTaskStore(this.db, "global").release(ownershipSemanticCapturedIdentitySchema.parse(o.identity));
          }
          verifySource?.();
          const final = this.capture(); if (final.occupied || this.stable(state!, true) !== this.stable({ ...final, occupied: state!.occupied }, true)) invalid();
        }).immediate();
      } catch (error) { primary = error; throw error; }
      finally {
        for (const db of held.reverse()) {
          try { if (db.inTransaction) db.exec("ROLLBACK"); } catch (error) { if (!primary) throw error; }
        }
      }
      progress.sourceCommitted = !!binding || sourceCommitted; progress.released = true;
      return Object.freeze(progress);
    } catch (error) { throw new RemoteRecoveryError(safe(error).code, Object.freeze({ ...progress })); }
  }
}
