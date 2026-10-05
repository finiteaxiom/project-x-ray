import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GraphStore } from "./index.js";

const stores: GraphStore[] = [];
const directories: string[] = [];
const raw = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
afterEach(async () => {
  for (const store of stores.splice(0)) if (raw(store).open) store.close();
  for (const directory of directories.splice(0)) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture cleanup"); await rm(directory, { recursive: true, force: true }); }
});
describe("source question binding migration 15", () => {
  it.each(["global", "project"] as const)("%s pre-15 upgrade changes only new table/marker and preserves all old rows", async role => {
    const directory = await mkdtemp(join(tmpdir(), "xray-question-binding-")); directories.push(directory); const path = join(directory, "source.sqlite");
    let store = new GraphStore(path, role); stores.push(store);
    raw(store).exec("DROP TABLE ownership_question_bindings; DELETE FROM schema_migrations WHERE version=15");
    const oldTables = (raw(store).prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(row => row.name);
    const oldRows = () => oldTables.map(name => ({ name, rows: raw(store).prepare(`SELECT * FROM "${name}"`).all().filter(row => name !== "schema_migrations" || (row as { version: number }).version !== 15) }));
    const before = oldRows(); store.close(); store = new GraphStore(path, role); stores.push(store);
    expect(oldRows()).toEqual(before); expect(raw(store).prepare("SELECT version FROM schema_migrations WHERE version=15").get()).toEqual({ version: 15 });
    expect(raw(store).prepare("SELECT count(*) n FROM ownership_question_bindings").get()).toEqual({ n: 0 });
  });
  it.each(["missing-table", "missing-marker", "extra-column", "bad-row"] as const)("reopen refuses %s without repairing material", async damage => {
    const directory = await mkdtemp(join(tmpdir(), "xray-question-binding-")); directories.push(directory); const path = join(directory, "source.sqlite");
    const store = new GraphStore(path, "project"); stores.push(store);
    if (damage === "missing-table") raw(store).exec("DROP TABLE ownership_question_bindings");
    if (damage === "missing-marker") raw(store).exec("DELETE FROM schema_migrations WHERE version=15");
    if (damage === "extra-column") raw(store).exec("ALTER TABLE ownership_question_bindings ADD COLUMN forged TEXT");
    if (damage === "bad-row") { raw(store).pragma("foreign_keys=OFF"); raw(store).prepare("INSERT INTO ownership_question_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("missing-attempt", "repo", "snap", "q", "2.0.0", "1.0.0", "unavailable", "a".repeat(64), "b".repeat(64), "c".repeat(64), null, null, "untrusted-issuance"); }
    const before = raw(store).prepare("SELECT sql FROM sqlite_master WHERE name='ownership_question_bindings'").get(), markers = raw(store).prepare("SELECT * FROM schema_migrations").all();
    store.close(); expect(() => new GraphStore(path, "project")).toThrow("所有权原题绑定失败");
    const connection = new Database(path); try { expect(connection.prepare("SELECT sql FROM sqlite_master WHERE name='ownership_question_bindings'").get()).toEqual(before); expect(connection.prepare("SELECT * FROM schema_migrations").all()).toEqual(markers); } finally { connection.close(); }
  });
  it.each(["global", "project"] as const)("%s source table has FK and isolated role markers", role => {
    const store = new GraphStore(":memory:", role); stores.push(store);
    expect(raw(store).prepare("SELECT version FROM schema_migrations WHERE version=15").get()).toEqual({ version: 15 });
    const foreignKeys = raw(store).prepare("PRAGMA foreign_key_list(ownership_question_bindings)").all();
    expect(foreignKeys).toMatchObject([{ table: "ownership_attempts", from: "attempt_id", to: "attempt_id", on_delete: "CASCADE" }]);
    expect(store.loadOwnershipQuestionBinding("old-absent")).toEqual({ status: "legacy-unbound" });
    expect(raw(store).prepare("SELECT count(*) n FROM ownership_question_bindings").get()).toEqual({ n: 0 });
    if (role === "project") {
      expect(raw(store).prepare("SELECT version FROM schema_migrations WHERE version IN (13,14)").all()).toEqual([]);
      expect(raw(store).prepare("SELECT name FROM sqlite_master WHERE name IN ('remote_task_registry','ownership_semantic_policies')").all()).toEqual([]);
    } else expect(raw(store).prepare("SELECT version FROM schema_migrations WHERE version IN (13,14)").all()).toEqual([{ version: 13 }, { version: 14 }]);
  });
  it("missing or changed material schema fails without repairing it", () => {
    const store = new GraphStore(":memory:", "project"); stores.push(store);
    raw(store).exec("ALTER TABLE ownership_question_bindings ADD COLUMN caller_claim TEXT");
    expect(() => store.loadOwnershipQuestionBinding("absent")).toThrow("所有权原题绑定失败");
    raw(store).exec("DROP TABLE ownership_question_bindings");
    expect(() => store.loadOwnershipQuestionBinding("absent")).toThrow("所有权原题绑定失败");
    expect(raw(store).prepare("SELECT name FROM sqlite_master WHERE name='ownership_question_bindings'").get()).toBeUndefined();
  });
  it("without compiled generator port no issuer exists; close refuses reads", () => {
    const store = new GraphStore(":memory:", "project"); stores.push(store);
    expect(() => store.issueOwnershipQuestions({ repositoryId: "repo", snapshotId: "snap", count: 5, scope: { kind: "project" } })).toThrow("所有权原题绑定失败");
    store.close(); expect(() => store.loadOwnershipQuestionBinding("absent")).toThrow("所有权原题绑定失败");
  });
});
