import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as graph from "./index.js";
import { GraphStore } from "./index.js";
import { OwnershipSemanticReservationStore } from "./ownership-semantic-reservation-store.js";
import type { PreparedSemanticReservation } from "./ownership-semantic-preparation-store.js";

const raw = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
describe("private semantic reservation SQL lifecycle", () => {
  it("barrel exposes no ledger, identity signer, result writer, dispatch or recovery entry", () => {
    expect(graph).not.toHaveProperty("OwnershipSemanticReservationStore");
    expect(graph).not.toHaveProperty("OwnershipSemanticTaskStore");
    const store = new GraphStore(":memory:", "global");
    try {
      for (const name of ["takeReservation", "promoteOwnershipSemantic", "dispatchOwnershipSemantic", "recoverOwnershipSemantic", "appendOwnershipSemanticResult"]) expect(store).not.toHaveProperty(name);
      expect(() => store.reserveOwnershipSemantic({} as PreparedSemanticReservation)).toThrowError(expect.objectContaining({ code: "NOT_CONFIGURED" }));
      expect(() => store.cancelOwnershipSemanticReservation({} as never)).toThrowError(expect.objectContaining({ code: "INVALID_RECEIPT" }));
      expect(raw(store).prepare("SELECT * FROM remote_task_registry").all()).toEqual([]);
      expect(raw(store).prepare("SELECT * FROM ownership_semantic_tasks").all()).toEqual([]);
    } finally { store.close(); }
  });
  it.each(["closed", "outer-global", "outer-settings", "project-role"])("%s refuses before issuer/material access or any SQL write", state => {
    const authority = new GraphStore(":memory:", state === "project-role" ? "project" : "global"), settings = new GraphStore(), source = new GraphStore();
    const ledger = new OwnershipSemanticReservationStore(raw(authority), authority);
    let calls = 0;
    const issuer = Object.defineProperty({}, "takeReservation", { get() { calls++; throw Error("must not inspect"); } });
    if (state === "closed") ledger.close();
    if (state === "outer-global") raw(authority).exec("BEGIN IMMEDIATE");
    if (state === "outer-settings") raw(settings).exec("BEGIN IMMEDIATE");
    try {
      expect(() => ledger.reserve(issuer as never, {} as never, source, raw(settings), raw(source))).toThrowError(expect.objectContaining({ code: "INVALID_RECEIPT" }));
      expect(calls).toBe(0);
      if (state === "project-role") expect(raw(authority).prepare("SELECT name FROM sqlite_master WHERE name='remote_task_registry'").all()).toEqual([]);
      else expect(raw(authority).prepare("SELECT * FROM remote_task_registry").all()).toEqual([]);
    } finally { for (const store of [authority, settings, source]) { if (raw(store).inTransaction) raw(store).exec("ROLLBACK"); store.close(); } }
  });
  it("default source cannot mint preparation from five-field shape alone", async () => {
    const store = new GraphStore();
    try {
      await expect(store.prepareOwnershipSemanticReservation({ repositoryId: "repo", snapshotId: "snap", attemptId: "attempt", contextHandle: randomUUID(), purpose: "ownership-semantic-assessment" }, store, store, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    } finally { store.close(); }
  });
});
