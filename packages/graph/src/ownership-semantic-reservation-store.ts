import type Database from "better-sqlite3";
import { canonicalJson, buildOwnershipSemanticResultEnvelope, validateOwnershipSemanticResponse, type OwnershipSemanticCapturedIdentity, type OwnershipSemanticResultEnvelope, type RemoteFailureCode } from "@project-xray/contracts";
import { Worker } from "node:worker_threads";
import { types } from "node:util";
import type { GraphStore } from "./index.js";
import { OwnershipSemanticTaskStore } from "./ownership-semantic-task-store.js";
import { OwnershipSemanticPreparationError, semanticPreparationFailure, type OwnershipSemanticPreparationStore, type PreparedSemanticReservation } from "./ownership-semantic-preparation-store.js";
import type { OwnershipSemanticResultStore, StoredSemanticCandidate } from "./ownership-semantic-result-store.js";
const nativeWorkerThreadId = Object.getOwnPropertyDescriptor(Worker.prototype, "threadId")?.get;
export type SemanticExecutionPreparation = ReturnType<OwnershipSemanticPreparationStore["takeReservation"]>["continuation"]["responses"];

declare const reservationBrand: unique symbol;
export type SemanticReservation = Readonly<{ [reservationBrand]: true }>;
export interface SemanticReservedMetadata {
  readonly reservation: SemanticReservation;
  readonly taskId: string;
  readonly createdAt: string;
  readonly phase: "reserved";
}
interface Reserved {
  identity: OwnershipSemanticCapturedIdentity;
  createdAt: string;
  source: GraphStore;
  settings: Database.Database;
  sourceDb: Database.Database;
  material: ReturnType<OwnershipSemanticPreparationStore["takeReservation"]>;
  results: OwnershipSemanticResultStore | undefined;
  starting: boolean;
  attempted: boolean;
  worker?: Worker;
  candidate?: StoredSemanticCandidate;
  envelope?: OwnershipSemanticResultEnvelope;
}
function fail(): never { throw new OwnershipSemanticPreparationError("INVALID_RECEIPT"); }

/** Private global ledger. Only actual source-issued tokens can enter the backend
 * execution path. No production provider, credential, HTTP or IPC port exists. */
export class OwnershipSemanticReservationStore {
  #closed = false;
  #tickets = new WeakMap<object, Reserved>();
  constructor(private readonly db: Database.Database, private readonly owner: GraphStore) {}
  close(): void { this.#closed = true; this.#tickets = new WeakMap(); }
  revoke(ticket: SemanticReservation): void { this.#tickets.delete(ticket); }
  private open(): void { if (this.#closed || !this.db.open || this.owner.remote.role !== "global") fail(); }
  private outside(databases: Database.Database[]): void {
    this.open(); if (databases.some(db => !db.open || db.inTransaction)) fail();
  }
  reserve(issuer: OwnershipSemanticPreparationStore, token: PreparedSemanticReservation,
    source: GraphStore, settings: Database.Database, sourceDb: Database.Database, results?: OwnershipSemanticResultStore): SemanticReservedMetadata {
    try {
      this.outside([this.db, settings, sourceDb]);
      // Deduplicate compatibility layouts while retaining global -> settings -> source order.
      const locks = [...new Set([settings, sourceDb])].filter(db => db !== this.db);
      const tasks = new OwnershipSemanticTaskStore(this.db, "global");
      const held: Database.Database[] = [];
      let saved: Reserved | undefined, failed = false;
      try {
        saved = this.db.transaction(() => {
          // These read locks must outlive the global COMMIT. Nested transaction
          // callbacks release secondary locks before committing the outer DB.
          for (const db of locks) { db.exec("BEGIN IMMEDIATE"); held.push(db); }
          const material = issuer.takeReservation(token, this.owner);
          const createdAt = tasks.reserve(material.identity);
          material.recheck();
          this.assertReserved(material.identity, createdAt);
          return { identity: material.identity, createdAt, source, settings, sourceDb, material, results, starting: false, attempted: false };
        }).immediate();
      } catch (error) { failed = true; throw error; }
      finally {
        let releaseError: unknown;
        // Secondary databases receive no writes. Rollback releases their read
        // transactions only after the authoritative commit/rollback has finished.
        for (const db of held.reverse()) {
          try { db.exec("ROLLBACK"); } catch (error) { releaseError ??= error; }
        }
        if (!failed && releaseError) throw releaseError;
      }
      if (!saved) fail();
      // better-sqlite3 returns only after the OUTER COMMIT; a failed COMMIT never
      // mints a ticket. No nested transaction can reach this line as a success.
      const reservation = Object.freeze(Object.create(null)) as SemanticReservation;
      this.#tickets.set(reservation, saved);
      return Object.freeze({ reservation, taskId: saved.identity.taskId, createdAt: saved.createdAt, phase: "reserved" });
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  private assertReserved(identity: OwnershipSemanticCapturedIdentity, createdAt: string): void {
    const registry = this.db.prepare("SELECT identity_payload,created_at FROM remote_task_registry WHERE task_id=?").get(identity.taskId) as { identity_payload: string; created_at: string } | undefined;
    const lease = this.db.prepare("SELECT task_id,purpose,stage,created_at FROM remote_provider_lease").get() as { task_id: string; purpose: string; stage: string; created_at: string } | undefined;
    if (!registry || registry.identity_payload !== canonicalJson(identity) || registry.created_at !== createdAt
      || lease?.task_id !== identity.taskId || lease.purpose !== identity.purpose || lease.stage !== "reserved" || lease.created_at !== createdAt
      || new OwnershipSemanticTaskStore(this.db, "global").read(identity.taskId)) fail();
  }
  cancel(ticket: SemanticReservation, source: GraphStore): void {
    try {
      this.open(); const saved = this.#tickets.get(ticket);
      if (!saved || saved.source !== source || saved.attempted) fail();
      this.outside([this.db, saved.settings, saved.sourceDb]);
      this.db.transaction(() => {
        this.assertReserved(saved.identity, saved.createdAt);
        const tasks = new OwnershipSemanticTaskStore(this.db, "global");
        // This class has no path to dispatch. An exact reserved state plus the
        // instance ticket proves cancellation is still before dispatch.
        tasks.terminalReserved(saved.identity, "CANCELLED"); tasks.release(saved.identity);
      }).immediate();
      this.#tickets.delete(ticket);
    } catch (error) { throw semanticPreparationFailure(error); }
  }

  private saved(ticket: SemanticReservation, source: GraphStore): Reserved {
    this.open(); const value = this.#tickets.get(ticket);
    if (!value || value.source !== source || !value.results || !value.settings.open || !value.sourceDb.open) fail(); return value;
  }
  /** Secondary read locks survive the actual authoritative outer COMMIT. */
  private locked<T>(saved: Reserved, work: () => T): T {
    this.outside([this.db, saved.settings, saved.sourceDb]);
    const held: Database.Database[] = []; let failed = false;
    try { return this.db.transaction(() => {
      for (const db of [...new Set([saved.settings, saved.sourceDb])].filter(db => db !== this.db)) { db.exec("BEGIN IMMEDIATE"); held.push(db); }
      return work();
    }).immediate(); }
    catch (error) { failed = true; throw error; }
    finally {
      let releaseError: unknown;
      for (const db of held.reverse()) try { if (db.inTransaction) db.exec("ROLLBACK"); } catch (error) { releaseError ??= error; }
      if (!failed && releaseError) throw releaseError;
    }
  }
  private task(saved: Reserved) {
    const task = new OwnershipSemanticTaskStore(this.db, "global").read(saved.identity.taskId);
    if (!task || canonicalJson(task.identity) !== canonicalJson(saved.identity) || task.createdAt !== saved.createdAt) fail(); return task;
  }
  async begin(ticket: SemanticReservation, source: GraphStore, execute: (prepared: SemanticExecutionPreparation) => Worker): Promise<void> {
    const saved = this.saved(ticket, source); if (saved.starting || saved.attempted) fail(); saved.starting = true;
    try {
      await saved.material.continuation.checkWorkspace();
      if (this.#tickets.get(ticket) !== saved) fail();
      this.locked(saved, () => {
        saved.material.recheck(); this.assertReserved(saved.identity, saved.createdAt);
        new OwnershipSemanticTaskStore(this.db, "global").promote(saved.identity);
        saved.material.continuation.begin();
        // Non-SQL latch is set BEFORE any execution call and never rolls back.
        saved.attempted = true;
        const worker = execute(saved.material.continuation.responses);
        if (types.isPromise(worker)) void Promise.prototype.then.call(worker, undefined, () => undefined);
        if (types.isProxy(worker) || !(worker instanceof Worker)) fail(); saved.worker = worker;
        saved.material.recheck(); if (this.task(saved).phase !== "dispatched") fail();
      });
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  async publish(ticket: SemanticReservation, source: GraphStore, rawResponse: unknown): Promise<void> {
    const saved = this.saved(ticket, source); if (!saved.attempted || !saved.worker || saved.envelope) fail();
    try {
      // L5 captures the entire response before this method's first await. The
      // identity, T1 and source package are never taken from caller response data.
      const pending = buildOwnershipSemanticResultEnvelope({ identity: saved.identity, createdAt: saved.createdAt, completedAt: new Date().toISOString(), response: rawResponse as never });
      const envelope = await pending;
      await validateOwnershipSemanticResponse(envelope.response, saved.material.continuation.semanticPackage, saved.material.continuation.submittedAnswer);
      const prepared = await saved.results!.prepare(envelope);
      await saved.material.continuation.checkWorkspace();
      this.locked(saved, () => {
        saved.material.recheck(); if (this.task(saved).phase !== "dispatched") fail();
        saved.candidate = saved.results!.append(prepared, this.owner);
        if (saved.sourceDb !== this.db) {
          // Source is committed before the authoritative completed marker. This
          // is explicitly NOT atomic across DBs. Reacquire and recapture source.
          saved.sourceDb.exec("COMMIT"); saved.sourceDb.exec("BEGIN IMMEDIATE");
        }
        saved.material.recheck(); saved.results!.assertCandidate(saved.candidate);
        const terminal = new OwnershipSemanticTaskStore(this.db, "global").finish(saved.identity, null, envelope.completedAt);
        if (terminal.phase !== "completed" || terminal.completedAt !== envelope.completedAt) fail();
      });
      saved.envelope = envelope;
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  /** Persist terminal FIRST, then compensate only this opaque unpublished row.
   * Caller handles resource exit separately; no error path releases a lease. */
  failExecution(ticket: SemanticReservation, source: GraphStore, code: RemoteFailureCode): void {
    const saved = this.saved(ticket, source);
    try {
      this.outside([this.db, saved.settings, saved.sourceDb]);
      this.db.transaction(() => {
        const tasks = new OwnershipSemanticTaskStore(this.db, "global"), old = tasks.read(saved.identity.taskId);
        if (old) {
          if (canonicalJson(old.identity) !== canonicalJson(saved.identity) || old.createdAt !== saved.createdAt || old.phase === "completed") fail();
          if (old.phase === "dispatched") tasks.finish(saved.identity, code);
        } else tasks.terminalReserved(saved.identity, code);
        // The private latch is authoritative for the never-attempted path only.
        if (!saved.attempted) tasks.release(saved.identity);
      }).immediate();
      if (saved.candidate) {
        this.db.transaction(() => saved.sourceDb.transaction(() => saved.results!.compensate(saved.candidate!, this.owner)).immediate()).immediate();
        delete saved.candidate;
      }
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  releaseExecution(ticket: SemanticReservation, source: GraphStore, worker: Worker): void {
    const saved = this.saved(ticket, source);
    // Native worker state, not a caller Boolean, Promise settlement, event emitted
    // by a fixture, abort signal, or mutable public threadId property.
    if (!saved.attempted || saved.worker !== worker || !nativeWorkerThreadId || nativeWorkerThreadId.call(worker) !== -1) fail();
    this.outside([this.db, saved.settings, saved.sourceDb]);
    const task = this.task(saved);
    if (task.phase === "dispatched" || (task.phase === "completed" ? !saved.envelope : saved.candidate !== undefined)) fail();
    try { this.db.transaction(() => new OwnershipSemanticTaskStore(this.db, "global").release(saved.identity)).immediate(); }
    catch (error) { throw semanticPreparationFailure(error); }
  }
  executionState(ticket: SemanticReservation, source: GraphStore) {
    const saved = this.saved(ticket, source), task = new OwnershipSemanticTaskStore(this.db, "global").read(saved.identity.taskId);
    if (task && (canonicalJson(task.identity) !== canonicalJson(saved.identity) || task.createdAt !== saved.createdAt)) fail();
    return task ? Object.freeze({ phase: task.phase, code: task.code, createdAt: task.createdAt }) : null;
  }
  async readPublished(ticket: SemanticReservation, source: GraphStore): Promise<OwnershipSemanticResultEnvelope> {
    const saved = this.saved(ticket, source); if (!saved.envelope) fail();
    try {
      await saved.material.continuation.checkWorkspace();
      const candidate = await saved.results!.readCandidate(saved.identity.taskId); if (!candidate) fail();
      return this.locked(saved, () => {
        saved.material.recheck(); const task = this.task(saved), actual = saved.results!.assertCandidate(candidate);
        if (task.phase !== "completed" || task.completedAt !== actual.completedAt || canonicalJson(actual) !== canonicalJson(saved.envelope)) fail();
        return actual;
      });
    } catch (error) { throw semanticPreparationFailure(error); }
  }
}
