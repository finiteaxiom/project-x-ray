import type Database from "better-sqlite3";
import { canonicalJson, type OwnershipSemanticCapturedIdentity } from "@project-xray/contracts";
import type { GraphStore } from "./index.js";
import { OwnershipSemanticTaskStore } from "./ownership-semantic-task-store.js";
import { OwnershipSemanticPreparationError, semanticPreparationFailure, type OwnershipSemanticPreparationStore, type PreparedSemanticReservation } from "./ownership-semantic-preparation-store.js";

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
}
function fail(): never { throw new OwnershipSemanticPreparationError("INVALID_RECEIPT"); }

/** Private global ledger. It accepts only a token from the actual source issuer.
 * No dispatch/provider/credential/result ports exist in this sealed stage. */
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
    source: GraphStore, settings: Database.Database, sourceDb: Database.Database): SemanticReservedMetadata {
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
          return { identity: material.identity, createdAt, source, settings, sourceDb };
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
      if (!saved || saved.source !== source) fail();
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
}
