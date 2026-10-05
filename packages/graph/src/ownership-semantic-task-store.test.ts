import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, ownershipSemanticCapturedIdentitySchema, type OwnershipSemanticCapturedIdentity } from "@project-xray/contracts";
import { GraphStore } from "./index.js";
import { SharedRemoteTaskStore } from "./shared-remote-task-store.js";
import { OwnershipSemanticTaskStore, semanticBindingHash } from "./ownership-semantic-task-store.js";

const time = "2026-10-05T00:00:00.123456Z", h = "a".repeat(64);
const stores: GraphStore[] = [], connections: Database.Database[] = [];
const raw = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
function open(path = ":memory:") {
  const store = new GraphStore(path, "global"); stores.push(store);
  const db = raw(store), core = new OwnershipSemanticTaskStore(db, "global");
  return { store, db, core, tx: <T>(work: () => T) => db.transaction(work).immediate() };
}
function connect(path: string) { const db = new Database(path); connections.push(db); db.pragma("busy_timeout=1"); return db; }
function identity(): OwnershipSemanticCapturedIdentity {
  return ownershipSemanticCapturedIdentitySchema.parse({ protocolVersion: "1.0.0", repositoryId: "repo", snapshotId: "snap", activation: time,
    analysisResultFingerprint: h, sourceManifestHash: h, configurationHash: h, ignorePolicyHash: null, ignoreRevision: 0,
    questionId: "question", questionVersion: "2.0.0", questionFingerprint: h, attemptId: "attempt", attemptHash: h,
    deterministicScoringVersion: "2.1.0", rubricVersion: "1.0.0", rubricHash: h, semanticProtocolVersion: "ownership-semantic-assessment/1.0.0",
    semanticScoringVersion: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0",
    authorizationRevision: 1, provider: "openai", model: "fixture", providerRevision: 1, credentialRevision: 1,
    contextHandle: randomUUID(), contextEpoch: 1, ownerSessionId: randomUUID(), taskId: randomUUID(), assessmentPackageId: h, bodyDigest: h, limitsVersion: "1.0.0" });
}
function snapshot(db: Database.Database): string {
  const schema = db.prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name").all() as { name: string; type: string }[];
  return canonicalJson({ schema, rows: schema.filter(row => row.type === "table").map(row => ({ name: row.name, rows: db.prepare(`SELECT * FROM "${row.name}"`).all() })) });
}
function corrupt(db: Database.Database, trigger: string, work: () => void) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(trigger) as { sql: string };
  db.exec(`DROP TRIGGER ${trigger}`); work(); db.exec(sql);
}
const safe = { code: "POLICY_INVALID", message: "远程解释未完成" };
afterEach(() => { for (const db of connections.splice(0)) if (db.open) db.close(); for (const store of stores.splice(0)) if (raw(store).open) store.close(); });

describe("internal semantic durable metadata", () => {
  it.each([null, "CANCELLED", "INTERRUPTED", "PROVIDER_FAILED"] as const)("stable T1 and one terminal/release %s", code => {
    const { db, core, tx } = open(), id = identity();
    expect(tx(() => core.reserve(id, time))).toBe(time); expect(core.read(id.taskId)).toBeNull();
    const reserved = snapshot(db);
    expect(() => tx(() => core.promote({ ...id, bodyDigest: "b".repeat(64) }))).toThrowError(expect.objectContaining(safe));
    expect(snapshot(db)).toBe(reserved);
    const task = tx(() => core.promote(id)); expect(task).toMatchObject({ createdAt: time, completedAt: null, phase: "dispatched" });
    expect(() => tx(() => core.release(id))).toThrowError(expect.objectContaining(safe));
    const terminal = tx(() => core.finish(id, code, "2026-10-05T00:00:00.1234560Z"));
    expect(terminal.createdAt).toBe(time); expect(db.prepare("SELECT stage FROM remote_provider_lease").get()).toEqual({ stage: "registered" });
    const ended = snapshot(db); expect(tx(() => core.finish(id, code, "2026-10-06T00:00:00Z"))).toEqual(terminal); expect(snapshot(db)).toBe(ended);
    expect(() => tx(() => core.finish(id, code === null ? "CANCELLED" : null))).toThrowError(expect.objectContaining(safe));
    tx(() => core.release(id)); const released = snapshot(db); tx(() => core.release(id)); expect(snapshot(db)).toBe(released);
    const next = identity(); tx(() => core.reserve(next, time)); const current = snapshot(db); tx(() => core.release(id)); expect(snapshot(db)).toBe(current);
    expect(() => tx(() => core.reserve(id, time))).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(core.read(id.taskId)).toEqual(terminal); expect(core.read(randomUUID())).toBeNull();
  });
  it.each(["CANCELLED", "INTERRUPTED", "PROVIDER_FAILED"] as const)("reserved terminal metadata %s keeps occupation until explicit release", code => {
    const { db, core, tx } = open(), id = identity(); tx(() => core.reserve(id, time));
    const task = tx(() => core.terminalReserved(id, code, time)); expect(task.createdAt).toBe(time);
    expect(db.prepare("SELECT stage FROM remote_provider_lease").get()).toEqual({ stage: "reserved" });
    expect(() => tx(() => core.reserve(identity(), time))).toThrowError(expect.objectContaining({ code: "BUSY" }));
    tx(() => core.release(id)); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("full fractions reject backwards completion in core and independent SQL guards", () => {
    const { db, core, tx } = open(), id = identity(); tx(() => { core.reserve(id, time); core.promote(id); }); const before = snapshot(db);
    for (const end of ["2026-10-05T00:00:00.1234559Z", "2026-10-05T00:00:00Z"]) {
      expect(() => tx(() => core.finish(id, null, end))).toThrowError(expect.objectContaining(safe));
      const task = { ...core.read(id.taskId)!, phase: "completed", completedAt: end };
      expect(() => db.prepare("UPDATE ownership_semantic_tasks SET phase='completed',completed_at=?,payload=? WHERE task_id=?").run(end, canonicalJson(task), id.taskId)).toThrow("XRAY_SHARED_INVALID");
      expect(snapshot(db)).toBe(before);
    }
    tx(() => core.finish(id, null, "2026-10-05T00:00:00.12345600000Z"));
  });
  it("binding removes exactly four transient identity fields", () => {
    const id = identity(), initial = semanticBindingHash(id);
    expect(semanticBindingHash({ ...id, taskId: randomUUID(), ownerSessionId: randomUUID(), contextHandle: randomUUID(), contextEpoch: 2 })).toBe(initial);
    for (const key of Object.keys(id).filter(key => !["taskId", "ownerSessionId", "contextHandle", "contextEpoch"].includes(key))) {
      const value = id[key as keyof typeof id]; expect(semanticBindingHash({ ...id, [key]: typeof value === "number" ? value + 1 : value === null ? h : `${value}x` })).not.toBe(initial);
    }
  });
  it("requires actual global transaction, strict purpose/identity; no getter or proxy execution", () => {
    const { db, core, tx } = open(), id = identity(), before = snapshot(db); let touched = 0;
    expect(() => core.reserve(id, time)).toThrowError(expect.objectContaining(safe));
    expect(() => tx(() => new OwnershipSemanticTaskStore(db, "project").reserve(id, time))).toThrowError(expect.objectContaining(safe));
    for (const bad of [{ ...id, answer: "secret" }, Object.defineProperty({ ...id }, "bodyDigest", { get() { touched++; return h; } }), new Proxy(id, { ownKeys() { touched++; return []; } })]) {
      expect(() => tx(() => core.reserve(bad as OwnershipSemanticCapturedIdentity, time))).toThrowError(expect.objectContaining(safe));
    }
    expect(touched).toBe(0); expect(snapshot(db)).toBe(before);
    expect(() => core.read(id.taskId, "feature-explanation")).toThrowError(expect.objectContaining(safe));
    expect(() => core.read("bad")).toThrowError(expect.objectContaining(safe));
  });
  it.each(["semantic", "feature"] as const)("two real connections share one slot: %s first", first => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-semantic-core-")), "global.sqlite"), { db, core, tx } = open(path), second = connect(path);
    const other = new OwnershipSemanticTaskStore(second, "global"), shared = new SharedRemoteTaskStore(second, "global"), id = identity();
    const feature = { protocolVersion: "1.0.0" as const, taskId: randomUUID(), ownerSessionId: id.ownerSessionId, contextHandle: id.contextHandle, contextEpoch: 1,
      repositoryId: id.repositoryId, snapshotId: id.snapshotId, activation: id.activation, sourceManifestHash: h, analysisResultFingerprint: h,
      configurationHash: h, ignorePolicyHash: null, ignoreRevision: 0, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1,
      packageId: h, bodyDigest: h, limitsVersion: "1.0.0" as const };
    if (first === "semantic") tx(() => core.reserve(id, time)); else second.transaction(() => shared.reserveFeature(feature, time)).immediate();
    const before = snapshot(db);
    expect(() => first === "semantic" ? second.transaction(() => shared.reserveFeature(feature, time)).immediate() : second.transaction(() => other.reserve(id, time)).immediate()).toThrowError(expect.objectContaining({ code: "BUSY" }));
    expect(snapshot(db)).toBe(before);
    if (first === "feature") expect(() => second.transaction(() => other.reserve({ ...id, taskId: feature.taskId }, time)).immediate()).toThrowError(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    db.exec("BEGIN IMMEDIATE"); try { expect(() => second.transaction(() => other.reserve(identity(), time)).immediate()).toThrow(); expect(snapshot(db)).toBe(before); } finally { db.exec("ROLLBACK"); }
  });
  it.each(["registry", "lease", "task", "promotion", "terminal", "release"])("injected %s write fault rolls back exact state", stage => {
    const { db, core, tx } = open(), id = identity();
    if (!["registry", "lease"].includes(stage)) tx(() => core.reserve(id, time));
    if (["terminal", "release"].includes(stage)) tx(() => core.promote(id));
    if (stage === "release") tx(() => core.finish(id, null, time));
    const targets: Record<string, string> = { registry: "BEFORE INSERT ON remote_task_registry", lease: "BEFORE INSERT ON remote_provider_lease", task: "BEFORE INSERT ON ownership_semantic_tasks", promotion: "BEFORE UPDATE ON remote_provider_lease", terminal: "BEFORE UPDATE ON ownership_semantic_tasks", release: "BEFORE DELETE ON remote_provider_lease" };
    db.exec(`CREATE TRIGGER injected_fault ${targets[stage]} BEGIN SELECT RAISE(ABORT,'private failure'); END`); const before = snapshot(db);
    expect(() => tx(() => ["registry", "lease"].includes(stage) ? core.reserve(id, time) : ["task", "promotion"].includes(stage) ? core.promote(id) : stage === "terminal" ? core.finish(id, null, time) : core.release(id))).toThrowError(expect.objectContaining(safe));
    expect(snapshot(db)).toBe(before); db.exec("DROP TRIGGER injected_fault");
  });
  it.each(["reserve", "promote", "finish", "release"])("deferred %s COMMIT failure preserves prior committed state", stage => {
    const { db, core, tx } = open(), id = identity();
    if (stage !== "reserve") tx(() => core.reserve(id, time));
    if (["finish", "release"].includes(stage)) tx(() => core.promote(id));
    if (stage === "release") tx(() => core.finish(id, null, time));
    db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)");
    const before = snapshot(db);
    expect(() => tx(() => { if (stage === "reserve") core.reserve(id, time); else if (stage === "promote") core.promote(id); else if (stage === "finish") core.finish(id, null, time); else core.release(id); db.exec("INSERT INTO fault_child VALUES(1)"); })).toThrow();
    expect(snapshot(db)).toBe(before);
    if (stage !== "reserve") expect(() => tx(() => core.reserve(identity(), time))).toThrowError(expect.objectContaining({ code: "BUSY" }));
  });
  it.each(["reserved-terminal", "finish", "release-ignore"])("valid injected occupancy change during %s must fail and roll back", stage => {
    const { db, core, tx } = open(), id = identity(); tx(() => core.reserve(id, time));
    if (stage !== "reserved-terminal") tx(() => core.promote(id));
    if (stage === "release-ignore") tx(() => core.finish(id, null, time));
    if (stage === "reserved-terminal") db.exec("CREATE TRIGGER injected_stop AFTER INSERT ON ownership_semantic_tasks WHEN NEW.phase<>'dispatched' BEGIN UPDATE ownership_semantic_tasks SET inflight=0 WHERE task_id=NEW.task_id; END");
    if (stage === "finish") db.exec("CREATE TRIGGER injected_stop AFTER UPDATE OF phase ON ownership_semantic_tasks WHEN NEW.phase<>'dispatched' BEGIN UPDATE ownership_semantic_tasks SET inflight=0 WHERE task_id=NEW.task_id; END");
    if (stage === "release-ignore") db.exec("CREATE TRIGGER injected_stop BEFORE UPDATE OF inflight ON ownership_semantic_tasks BEGIN SELECT RAISE(IGNORE); END");
    const before = snapshot(db);
    expect(() => tx(() => stage === "reserved-terminal" ? core.terminalReserved(id, "CANCELLED", time) : stage === "finish" ? core.finish(id, null, time) : core.release(id))).toThrowError(expect.objectContaining(safe));
    expect(snapshot(db)).toBe(before);
  });
  it("a valid terminal injected after promotion cannot masquerade as the proposed dispatch", () => {
    const { db, core, tx } = open(), id = identity(); tx(() => core.reserve(id, time));
    db.exec(`CREATE TRIGGER injected_terminal AFTER INSERT ON ownership_semantic_tasks WHEN NEW.phase='dispatched' BEGIN
      UPDATE ownership_semantic_tasks SET phase='failed',completed_at='2026-10-06T00:00:00Z',payload=json_set(payload,'$.phase','failed','$.completedAt','2026-10-06T00:00:00Z','$.code','PROVIDER_FAILED') WHERE task_id=NEW.task_id; END`);
    const before = snapshot(db); expect(() => tx(() => core.promote(id))).toThrowError(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
  });
  it("second connection cannot clear active lease or replace T1/identity/terminal", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-semantic-guards-")), "global.sqlite"), { db, core, tx } = open(path), other = connect(path), id = identity();
    tx(() => { core.reserve(id, time); core.promote(id); }); const before = snapshot(db);
    for (const sql of ["DELETE FROM remote_provider_lease", "UPDATE ownership_semantic_tasks SET inflight=0", "UPDATE ownership_semantic_tasks SET created_at='2026-10-06T00:00:00Z'", "UPDATE remote_provider_lease SET task_id='other'", "DELETE FROM ownership_semantic_tasks"]) {
      expect(() => other.exec(sql)).toThrow(); expect(snapshot(db)).toBe(before);
    }
    tx(() => core.finish(id, null, time)); const terminal = snapshot(db);
    expect(() => other.exec("UPDATE ownership_semantic_tasks SET phase='failed'")).toThrow(); expect(snapshot(db)).toBe(terminal);
  });
  it.each(["binding", "identity", "phase", "budget", "column", "trigger", "table", "marker"])("reopen rejects damaged17 %s without healing", damage => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-semantic-damaged-")), "global.sqlite"), { store, db, core, tx } = open(path), id = identity();
    tx(() => { core.reserve(id, time); core.promote(id); });
    if (damage === "trigger") db.exec("DROP TRIGGER semantic_task_update");
    else if (damage === "table") db.exec("DROP TABLE ownership_semantic_tasks");
    else if (damage === "marker") db.exec("DELETE FROM schema_migrations WHERE version=17");
    else corrupt(db, "semantic_task_update", () => {
      if (damage === "binding") db.exec("UPDATE ownership_semantic_tasks SET binding_hash='" + "b".repeat(64) + "'");
      if (damage === "column") db.exec("UPDATE ownership_semantic_tasks SET repository_id='other'");
      if (damage === "identity") db.exec("UPDATE ownership_semantic_tasks SET payload=json_set(payload,'$.identity.bodyDigest','" + "b".repeat(64) + "')");
      if (damage === "phase") db.exec("UPDATE ownership_semantic_tasks SET payload=json_set(payload,'$.phase','completed')");
      if (damage === "budget") { db.pragma("ignore_check_constraints=ON"); db.prepare("UPDATE ownership_semantic_tasks SET payload=?").run(JSON.stringify({ extra: "x".repeat(17000) })); db.pragma("ignore_check_constraints=OFF"); }
    });
    const before = snapshot(db); store.close(); const inspect = connect(path);
    expect(() => new GraphStore(path, "global")).toThrowError(expect.objectContaining(safe)); expect(snapshot(inspect)).toBe(before);
  });
});
