import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, remoteCapturedIdentitySchema, ownershipSemanticCapturedIdentitySchema,
  type RemoteCapturedIdentity, type RemoteTaskRecord } from "@project-xray/contracts";
import { GraphStore } from "./index.js";
import { RemoteExplanationStore } from "./remote-explanation-store.js";
import { OwnershipSemanticTaskStore, semanticTaskObjects } from "./ownership-semantic-task-store.js";

const connections: Database.Database[] = [], stores: GraphStore[] = [];
const h = "a".repeat(64), time = "2026-10-01T00:00:00.000Z";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const raw = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
const safe = { code: "POLICY_INVALID", message: "远程解释未完成" };
function open(path = ":memory:", role: "global" | "project" = "global") { const store = new GraphStore(path, role); stores.push(store); return store; }
function connect(path: string) { const db = new Database(path); connections.push(db); db.pragma("busy_timeout=1"); return db; }
function snapshot(db: Database.Database) {
  const schema = db.prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name").all() as { name: string; type: string }[];
  return canonicalJson({ schema, rows: schema.filter(row => row.type === "table").map(row => ({ name: row.name, rows: db.prepare(`SELECT * FROM "${row.name}"`).all() })) });
}
function identity(taskId = randomUUID()): RemoteCapturedIdentity {
  return { protocolVersion: "1.0.0", taskId, ownerSessionId: randomUUID(), contextHandle: randomUUID(), contextEpoch: 1,
    repositoryId: "repo", snapshotId: "snap", activation: time, sourceManifestHash: h, analysisResultFingerprint: h,
    configurationHash: h, ignorePolicyHash: null, ignoreRevision: 0, authorizationRevision: 1, providerRevision: 1,
    credentialRevision: 1, packageId: h, bodyDigest: h, limitsVersion: "1.0.0" };
}
function configured(store: GraphStore, id = identity()): RemoteCapturedIdentity {
  if (store.remote.provider().revision === 0) store.remote.saveProvider(0, { provider: "openai", model: "fixture-model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
  if (store.remote.authorization(id.repositoryId).revision === 0) store.remote.saveAuthorization(id.repositoryId, 0, true);
  const context = store.remote.commitTrustedContext(id.ownerSessionId, { repositoryId: id.repositoryId, snapshotId: id.snapshotId, activation: id.activation,
    analysisResultFingerprint: id.analysisResultFingerprint, sourceManifestHash: id.sourceManifestHash, configurationHash: id.configurationHash, ignorePolicyHash: id.ignorePolicyHash });
  return { ...id, contextHandle: context.contextHandle, contextEpoch: context.epoch };
}
const start = (store: GraphStore, id: RemoteCapturedIdentity) => store.remote.immediate(() => store.remote.registerDispatch(id));
function semantic(id = identity()) {
  const { packageId: _packageId, ...base } = id;
  return ownershipSemanticCapturedIdentitySchema.parse({ ...base, questionId: "question", questionVersion: "2.0.0", questionFingerprint: h,
    attemptId: "attempt", attemptHash: h, deterministicScoringVersion: "2.1.0", rubricVersion: "1.0.0", rubricHash: h,
    semanticProtocolVersion: "ownership-semantic-assessment/1.0.0", semanticScoringVersion: "1.0.0", purpose: "ownership-semantic-assessment",
    disclosureVersion: "ownership-semantics/1.0.0", provider: "openai", model: "fixture-model", assessmentPackageId: h });
}
// Owned SQL fixture only. Legal17 task metadata never establishes dispatch or permission.
function artificial(db: Database.Database, id = semantic(), slot = true) {
  const core = new OwnershipSemanticTaskStore(db, "global");
  db.transaction(() => { core.reserve(id, time); core.promote(id); if (!slot) { core.finish(id, null, time); core.release(id); } }).immediate();
  return id;
}
function damage(db: Database.Database, trigger: string, mutate: () => void): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger) as { sql: string };
  db.exec(`DROP TRIGGER ${trigger}`); mutate(); db.exec(row.sql);
}
function legacy(task: RemoteTaskRecord, inflight: number, unique = true) {
  const db = new Database(":memory:"); connections.push(db);
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(10,'old-time'); CREATE TABLE explanation_tasks(task_id TEXT PRIMARY KEY,owner_session_id TEXT NOT NULL,phase TEXT NOT NULL,payload TEXT NOT NULL,inflight INTEGER NOT NULL CHECK(inflight IN (0,1)))");
  if (unique) db.exec("CREATE UNIQUE INDEX explanation_single_dispatch ON explanation_tasks(inflight) WHERE inflight=1");
  db.prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,?)").run(task.identity.taskId, task.identity.ownerSessionId, task.phase, JSON.stringify(task), inflight);
  return { db, remote: new RemoteExplanationStore(db, "global") };
}
function legacyTask(phase: "dispatched" | "completed" = "dispatched"): RemoteTaskRecord {
  return { identity: identity(), phase, createdAt: time, completedAt: phase === "completed" ? time : null, code: null };
}
function installed14(db: Database.Database): void {
  installed16(db);
  // Restore the four exact installed14 objects, not a loosely equivalent legacy schema.
  for (const name of ["remote_lease_insert", "remote_lease_no_update", "remote_feature_insert", "remote_feature_acquire"]) {
    let sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name) as { sql: string }).sql;
    if (name === "remote_lease_insert") sql = sql.replace("((NEW.stage='reserved' AND EXISTS(SELECT 1 FROM explanation_tasks WHERE task_id=NEW.task_id)) OR (NEW.stage='registered' AND NOT EXISTS(", "(NEW.stage<>'registered' OR NOT EXISTS(").replace("t.inflight=1)))", "t.inflight=1))");
    if (name === "remote_lease_no_update") sql = "CREATE TRIGGER remote_lease_no_update BEFORE UPDATE ON remote_provider_lease\n    BEGIN SELECT RAISE(ABORT,'XRAY_SHARED_INVALID'); END";
    if (name === "remote_feature_insert") sql = sql.replace("EXISTS(SELECT 1 FROM remote_provider_lease WHERE task_id<>NEW.task_id OR purpose<>'feature-explanation' OR stage<>'reserved')", "EXISTS(SELECT 1 FROM remote_provider_lease)");
    if (name === "remote_feature_acquire") sql = "CREATE TRIGGER remote_feature_acquire AFTER INSERT ON explanation_tasks\n    WHEN NEW.inflight=1 BEGIN INSERT INTO remote_provider_lease SELECT 'openai',r.task_id,r.purpose,r.identity_digest,'registered',r.created_at\n      FROM remote_task_registry r WHERE r.task_id=NEW.task_id; END";
    db.exec(`DROP TRIGGER ${name}`); db.exec(sql);
  }
  db.exec("DELETE FROM schema_migrations WHERE version=16");
}
function installed16(db: Database.Database): void {
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=17").get()) return;
  const insert = (db.prepare("SELECT sql FROM sqlite_master WHERE name='remote_lease_insert'").get() as { sql: string }).sql.split("\n    SELECT CASE WHEN NEW.purpose='ownership-semantic-assessment'")[0]! + "END";
  const update = `CREATE TRIGGER remote_lease_no_update BEFORE UPDATE ON remote_provider_lease BEGIN
    SELECT CASE WHEN OLD.stage<>'reserved' OR NEW.stage<>'registered' OR NEW.provider IS NOT OLD.provider
      OR NEW.task_id IS NOT OLD.task_id OR NEW.purpose IS NOT OLD.purpose OR NEW.identity_digest IS NOT OLD.identity_digest
      OR NEW.created_at IS NOT OLD.created_at OR NEW.purpose<>'feature-explanation' OR NOT EXISTS(
        SELECT 1 FROM explanation_tasks t WHERE t.task_id=NEW.task_id AND t.inflight=1 AND t.phase='dispatched')
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END; END`;
  const remove = `CREATE TRIGGER remote_lease_delete BEFORE DELETE ON remote_provider_lease
    WHEN OLD.purpose='feature-explanation' BEGIN SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM explanation_tasks t WHERE t.task_id=OLD.task_id AND t.inflight=0 AND t.phase<>'dispatched')
      THEN RAISE(ABORT,'XRAY_SHARED_INVALID') END; END`;
  for (const [name, sql] of [["remote_lease_insert", insert], ["remote_lease_no_update", update], ["remote_lease_delete", remove]]) { db.exec(`DROP TRIGGER ${name}`); db.exec(sql!); }
  for (const object of [...semanticTaskObjects].reverse()) db.exec(`DROP ${object.type.toUpperCase()} ${object.name}`);
  db.exec("DELETE FROM schema_migrations WHERE version=17");
}
afterEach(() => { vi.useRealTimers(); for (const store of stores.splice(0)) if (raw(store).open) store.close(); for (const db of connections.splice(0)) if (db.open) db.close(); });

describe("global shared SQL task compatibility", () => {
  it("actual16 legal reserved semantic survives17 without invented task or T1", () => {
    const store = open(), db = raw(store), id = semantic(); installed16(db);
    const payload = canonicalJson(id);
    db.transaction(() => {
      db.prepare("INSERT INTO remote_task_registry VALUES(?,?,?,?,?,?,?,?,?)").run(id.taskId, id.purpose, id.ownerSessionId, id.repositoryId, id.contextHandle, id.contextEpoch, digest(payload), payload, time);
      db.prepare("INSERT INTO remote_provider_lease VALUES('openai',?,?,?,'reserved',?)").run(id.taskId, id.purpose, digest(payload), time);
    }).immediate();
    db.exec("CREATE TABLE historical_source(payload TEXT); INSERT INTO historical_source VALUES('historical bytes')");
    const before = [db.prepare("SELECT * FROM remote_task_registry").all(), db.prepare("SELECT * FROM remote_provider_lease").all(), db.prepare("SELECT * FROM historical_source").all(), db.prepare("SELECT * FROM schema_migrations WHERE version IN(14,16)").all()];
    store.remote.migrate();
    expect([db.prepare("SELECT * FROM remote_task_registry").all(), db.prepare("SELECT * FROM remote_provider_lease").all(), db.prepare("SELECT * FROM historical_source").all(), db.prepare("SELECT * FROM schema_migrations WHERE version IN(14,16)").all()]).toEqual(before);
    expect(new OwnershipSemanticTaskStore(db, "global").read(id.taskId)).toBeNull();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=17").get()).toEqual({ version: 17 });
  });
  it.each(["registered-no-task", "orphan", "broken16", "partial17", "marker-insert", "commit"])("actual16 %s rejects17 with exact schema/row rollback", failure => {
    const store = open(), db = raw(store); installed16(db);
    if (["registered-no-task", "orphan"].includes(failure)) {
      const id = semantic(), payload = canonicalJson(id);
      db.prepare("INSERT INTO remote_task_registry VALUES(?,?,?,?,?,?,?,?,?)").run(id.taskId, id.purpose, id.ownerSessionId, id.repositoryId, id.contextHandle, id.contextEpoch, digest(payload), payload, time);
      if (failure === "registered-no-task") db.prepare("INSERT INTO remote_provider_lease VALUES('openai',?,?,?,'registered',?)").run(id.taskId, id.purpose, digest(payload), time);
    }
    if (failure === "broken16") db.exec("DROP TRIGGER remote_feature_update");
    if (failure === "partial17") db.exec(semanticTaskObjects[0].sql);
    if (failure === "marker-insert") db.exec("CREATE TRIGGER reject17 BEFORE INSERT ON schema_migrations WHEN NEW.version=17 BEGIN SELECT RAISE(ABORT,'private'); END");
    if (failure === "commit") db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject17 AFTER INSERT ON schema_migrations WHEN NEW.version=17 BEGIN INSERT INTO fault_child VALUES(1); END");
    const before = snapshot(db); expect(() => store.remote.migrate()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version=17").get()).toBeUndefined();
  });
  it.each(["dispatched", "completed"] as const)("strict installed14 upgrades16 preserving %s history and marker", phase => {
    const store = open(), id = configured(store), db = raw(store); start(store, id);
    if (phase === "completed") { store.remote.finish(id.taskId, null); store.remote.releaseDispatch(id.taskId); }
    installed14(db);
    db.exec("CREATE TABLE historical_source(payload TEXT); INSERT INTO historical_source VALUES('historical bytes')");
    const old = [db.prepare("SELECT * FROM explanation_tasks").all(), db.prepare("SELECT * FROM remote_task_registry").all(), db.prepare("SELECT * FROM remote_provider_lease").all(), db.prepare("SELECT * FROM schema_migrations WHERE version=14").all()];
    store.remote.migrate();
    expect([db.prepare("SELECT * FROM explanation_tasks").all(), db.prepare("SELECT * FROM remote_task_registry").all(), db.prepare("SELECT * FROM remote_provider_lease").all(), db.prepare("SELECT * FROM schema_migrations WHERE version=14").all()]).toEqual(old);
    expect(db.prepare("SELECT * FROM historical_source").all()).toEqual([{ payload: "historical bytes" }]);
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version=16").get()).toBeDefined(); const after = snapshot(db); store.remote.migrate(); expect(snapshot(db)).toBe(after);
  });
  it.each(["schema", "digest", "time"])("broken installed14 %s fails before upgrading or repairing", kind => {
    const store = open(), id = configured(store), db = raw(store); start(store, id); installed14(db);
    if (kind === "schema") db.exec("DROP TRIGGER remote_lease_insert");
    if (kind === "digest") damage(db, "remote_registry_immutable", () => db.prepare("UPDATE remote_task_registry SET identity_digest=?").run("b".repeat(64)));
    if (kind === "time") damage(db, "remote_registry_immutable", () => db.exec("UPDATE remote_task_registry SET created_at='invalid'"));
    const before = snapshot(db); expect(() => store.remote.migrate()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version=16").get()).toBeUndefined();
  });
  it("upgrade16 deferred COMMIT failure restores exact installed14 objects and rows", () => {
    const store = open(), id = configured(store), db = raw(store); start(store, id); installed14(db);
    db.exec("CREATE TABLE m16_parent(id INTEGER PRIMARY KEY); CREATE TABLE m16_guard(id INTEGER REFERENCES m16_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER fail16 AFTER INSERT ON schema_migrations WHEN NEW.version=16 BEGIN INSERT INTO m16_guard VALUES(1); END");
    const before = snapshot(db); expect(() => store.remote.migrate()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    db.exec("DROP TRIGGER fail16"); store.remote.migrate(); expect(store.remote.task(id.taskId)?.phase).toBe("dispatched");
  });
  it("project never installs16; two global connections serialize committed reserve and promotion", () => {
    const project = open(":memory:", "project"); expect(raw(project).prepare("SELECT 1 FROM schema_migrations WHERE version=16").get()).toBeUndefined();
    const path = join(mkdtempSync(join(tmpdir(), "xray-reserve-")), "global.sqlite"), store = open(path), id = configured(store), other = open(path), second = { ...id, taskId: randomUUID() };
    const receipt = store.remote.immediate(() => {
      const r = store.remote.reserveDispatch(id);
      expect(() => other.remote.immediate(() => other.remote.reserveDispatch(second))).toThrow(expect.objectContaining({ code: "BUSY" })); return r;
    });
    expect(() => other.remote.immediate(() => other.remote.reserveDispatch(second))).toThrow(expect.objectContaining({ code: "BUSY" }));
    store.remote.immediate(() => { store.remote.registerReservedDispatch(receipt); store.remote.markReservedDispatchAttempt(receipt); });
    store.remote.finish(id.taskId, null); store.remote.releaseDispatch(id.taskId);
    const next = other.remote.immediate(() => other.remote.reserveDispatch(second)); expect(() => store.remote.releaseDispatch(id.taskId)).not.toThrow();
    expect(raw(other).prepare("SELECT task_id,stage FROM remote_provider_lease").get()).toEqual({ task_id: second.taskId, stage: "reserved" });
    other.remote.immediate(() => other.remote.finishUndispatchedReservation(next, "CANCELLED"));
  });
  it("global14 is idempotent, project has neither table nor14, no semantic task/result or public API", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-shared-core-")), "global.sqlite");
    const store = open(path), before = snapshot(raw(store)); store.close(); const reopened = open(path);
    expect(snapshot(raw(reopened))).toBe(before);
    const project = open(":memory:", "project"); expect(raw(project).prepare("SELECT 1 FROM schema_migrations WHERE version=14").get()).toBeUndefined();
    for (const table of ["remote_task_registry", "remote_provider_lease"]) expect(raw(project).prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)).toBeUndefined();
    expect(raw(reopened).prepare("SELECT name FROM sqlite_master WHERE name IN ('ownership_semantic_tasks','ownership_semantic_results')").all()).toEqual([{ name: "ownership_semantic_tasks" }]);
    expect("registerSemanticDispatch" in reopened.remote).toBe(false);
  });
  it.each(["dispatched", "completed"] as const)("migration preserves legacy %s1 identity/time/slot and old history bytes", phase => {
    const task = legacyTask(phase), { db, remote } = legacy(task, 1), original = db.prepare("SELECT * FROM explanation_tasks").all();
    db.exec("CREATE TABLE old_source(payload TEXT); INSERT INTO old_source VALUES('immutable history');");
    remote.migrate(); expect(db.prepare("SELECT * FROM explanation_tasks").all()).toEqual(original);
    expect(db.prepare("SELECT * FROM old_source").all()).toEqual([{ payload: "immutable history" }]);
    expect(db.prepare("SELECT created_at FROM remote_task_registry").get()).toEqual({ created_at: task.createdAt });
    expect(db.prepare("SELECT task_id,created_at,stage FROM remote_provider_lease").get()).toEqual({ task_id: task.identity.taskId, created_at: time, stage: "registered" });
    expect(db.prepare("SELECT * FROM schema_migrations WHERE version=10").get()).toEqual({ version: 10, applied_at: "old-time" });
    const before = snapshot(db); remote.migrate(); expect(snapshot(db)).toBe(before);
  });
  it.each(["dispatched0", "bad-payload", "owner", "phase", "created", "terminal-time", "multiple", "partial"])("bad upgrade %s rolls14 DDL/marker back", change => {
    const task = legacyTask(), { db, remote } = legacy(task, change === "dispatched0" ? 0 : 1, change !== "multiple");
    if (change === "bad-payload") db.exec("UPDATE explanation_tasks SET payload='private source error'");
    if (change === "owner") db.exec("UPDATE explanation_tasks SET owner_session_id='wrong'");
    if (change === "phase") db.exec("UPDATE explanation_tasks SET phase='completed'");
    if (change === "created") db.prepare("UPDATE explanation_tasks SET payload=?").run(JSON.stringify({ ...task, createdAt: "invalid-time" }));
    if (change === "terminal-time") db.prepare("UPDATE explanation_tasks SET phase='completed',payload=?").run(JSON.stringify({ ...task, phase: "completed", completedAt: "2026-09-01T00:00:00.000Z" }));
    if (change === "multiple") { const other = legacyTask(); db.prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,1)").run(other.identity.taskId, other.identity.ownerSessionId, other.phase, JSON.stringify(other)); }
    if (change === "partial") db.exec("CREATE TABLE remote_task_registry(untrusted TEXT)");
    const before = snapshot(db); expect(() => remote.migrate()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version=14").get()).toBeUndefined();
  });
  it("migration14 commit trigger failure rolls all DDL back and retry preserves old task", () => {
    const task = legacyTask("completed"), { db, remote } = legacy(task, 0); const old = db.prepare("SELECT * FROM explanation_tasks").all();
    db.exec("CREATE TRIGGER fail14 BEFORE INSERT ON schema_migrations WHEN NEW.version=14 BEGIN SELECT RAISE(ABORT,'private migration error'); END");
    const before = snapshot(db); expect(() => remote.migrate()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    db.exec("DROP TRIGGER fail14"); remote.migrate(); expect(db.prepare("SELECT * FROM explanation_tasks").all()).toEqual(old);
    expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("missing/replaced schema or bridge rejects reopen without repair", () => {
    for (const mode of ["table", "trigger", "marker", "old-index"] as const) {
      const path = join(mkdtempSync(join(tmpdir(), "xray-shared-reopen-")), "global.sqlite"), store = open(path); store.close(); const db = connect(path);
      if (mode === "table") db.exec("DROP TABLE remote_provider_lease");
      if (mode === "trigger") db.exec("DROP TRIGGER remote_feature_update");
      if (mode === "marker") db.exec("DELETE FROM schema_migrations WHERE version=14");
      if (mode === "old-index") db.exec("DROP INDEX explanation_single_dispatch");
      const before = snapshot(db); expect(() => open(path)).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    }
  });
  it("semantic artificial slot blocks feature; feature slot rejects other purpose atomically", () => {
    const store = open(), id = configured(store), db = raw(store); const sem = artificial(db); const before = snapshot(db);
    expect(() => start(store, id)).toThrow(expect.objectContaining({ code: "BUSY" })); expect(snapshot(db)).toBe(before);
    const core = new OwnershipSemanticTaskStore(db, "global"); db.transaction(() => { core.finish(sem, null, time); core.release(sem); }).immediate(); start(store, id); const beforeOther = snapshot(db);
    expect(() => db.transaction(() => artificial(db)).immediate()).toThrow(); expect(snapshot(db)).toBe(beforeOther);
    expect(db.prepare("SELECT count(*) count FROM remote_provider_lease").get()).toEqual({ count: 1 });
  });
  it("historical cross-purpose UUID collision is REVISION_CONFLICT without a slot", () => {
    const store = open(), id = configured(store); artificial(raw(store), semantic(id), false); const before = snapshot(raw(store));
    expect(() => start(store, id)).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" })); expect(snapshot(raw(store))).toBe(before);
  });
  it("two actual connections serialize IMMEDIATE registration and remain BUSY after commit", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-shared-two-")), "global.sqlite"), store = open(path), id = configured(store), other = open(path);
    raw(other).pragma("busy_timeout=1");
    store.remote.immediate(() => { expect(() => start(other, { ...id, taskId: randomUUID() })).toThrow(expect.objectContaining({ code: "BUSY" })); store.remote.registerDispatch(id); });
    expect(() => start(other, { ...id, taskId: randomUUID() })).toThrow(expect.objectContaining({ code: "BUSY" }));
    expect(raw(store).prepare("SELECT count(*) count FROM explanation_tasks").get()).toEqual({ count: 1 });
  });
  it("finish retains slot; repeated/late release never clears a later task or other purpose", () => {
    const store = open(), id = configured(store), first = start(store, id); const db = raw(store);
    expect(() => store.remote.releaseDispatch(id.taskId)).toThrow(expect.objectContaining(safe));
    const completed = store.remote.finish(id.taskId, null); expect(completed.createdAt).toBe(first.createdAt);
    const held = snapshot(db); expect(store.remote.finish(id.taskId, "CANCELLED")).toEqual(completed); expect(snapshot(db)).toBe(held);
    expect(db.prepare("SELECT task_id FROM remote_provider_lease").get()).toEqual({ task_id: id.taskId }); store.remote.releaseDispatch(id.taskId);
    const next = { ...id, taskId: randomUUID() }; start(store, next); const nextState = snapshot(db), changes = db.prepare("SELECT total_changes() n").get();
    store.remote.releaseDispatch(id.taskId); expect(snapshot(db)).toBe(nextState); expect(db.prepare("SELECT total_changes() n").get()).toEqual(changes);
    store.remote.finish(next.taskId, "CANCELLED"); store.remote.releaseDispatch(next.taskId); artificial(db); const semanticState = snapshot(db);
    store.remote.releaseDispatch(id.taskId); expect(snapshot(db)).toBe(semanticState);
  });
  it("first trusted createdAt persists across later finish/recover; clock rollback rejects without writes", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-05T01:00:00.000Z");
    const store = open(), id = configured(store), first = start(store, id), db = raw(store);
    vi.setSystemTime("2026-10-05T00:00:00.000Z"); const before = snapshot(db);
    expect(() => store.remote.finish(id.taskId, null)).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    vi.setSystemTime("2026-10-05T02:00:00.000Z"); store.remote.recoverInterrupted();
    expect(store.remote.task(id.taskId)).toMatchObject({ phase: "interrupted", createdAt: first.createdAt, completedAt: "2026-10-05T02:00:00.000Z" });
    expect(db.prepare("SELECT created_at FROM remote_task_registry").get()).toEqual({ created_at: first.createdAt });
  });
  it("undispatched cancellation registers UUID, zero slot, unchanged trusted createdAt", () => {
    const store = open(), id = configured(store), db = raw(store);
    const task = store.remote.immediate(() => store.remote.recordUndispatchedCancellation(id, time));
    expect(task).toMatchObject({ phase: "cancelled", createdAt: time }); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    expect(db.prepare("SELECT created_at FROM remote_task_registry").get()).toEqual({ created_at: time });
    const before = snapshot(db); expect(() => start(store, id)).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" })); expect(snapshot(db)).toBe(before);
  });
  it.each(["valid-semantic", "digest", "time", "context", "lease-mismatch", "missing-slot"])("feature recovery %s fails before any context/terminal/slot write", mode => {
    const store = open(), id = configured(store), db = raw(store);
    if (mode === "missing-slot") { start(store, id); damage(db, "remote_lease_delete", () => db.exec("DELETE FROM remote_provider_lease")); }
    else { const sem = artificial(db); if (mode !== "valid-semantic") {
      if (mode === "lease-mismatch") damage(db, "remote_lease_no_update", () => db.exec("UPDATE remote_provider_lease SET identity_digest='bad'"));
      else damage(db, "remote_registry_immutable", () => {
        if (mode === "digest") db.prepare("UPDATE remote_task_registry SET identity_digest=?").run("b".repeat(64));
        if (mode === "time") db.exec("UPDATE remote_task_registry SET created_at='invalid'");
        if (mode === "context") db.prepare("UPDATE remote_task_registry SET context_handle=? WHERE task_id=?").run(randomUUID(), sem.taskId);
      });
    } }
    const before = snapshot(db), changes = db.prepare("SELECT total_changes() n").get();
    expect(() => store.remote.recoverInterrupted()).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before); expect(db.prepare("SELECT total_changes() n").get()).toEqual(changes);
  });
  it.each(["remote_task_registry", "explanation_tasks", "remote_provider_lease"])("%s insert fault rolls whole registration back and retry succeeds", table => {
    const store = open(), id = configured(store), db = raw(store);
    db.exec(`CREATE TRIGGER fault BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private source SQL'); END`);
    const before = snapshot(db); expect(() => start(store, id)).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    db.exec("DROP TRIGGER fault"); expect(start(store, id).phase).toBe("dispatched");
  });
  it("lease delete fault preserves terminal slot and later retry is safe", () => {
    const store = open(), id = configured(store), db = raw(store); start(store, id); store.remote.finish(id.taskId, null);
    db.exec("CREATE TRIGGER fault BEFORE DELETE ON remote_provider_lease BEGIN SELECT RAISE(ABORT,'private'); END");
    const before = snapshot(db); expect(() => store.remote.releaseDispatch(id.taskId)).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    db.exec("DROP TRIGGER fault"); store.remote.releaseDispatch(id.taskId); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("a valid but different task injected after INSERT rolls back rather than returning the proposed phase", () => {
    const store = open(), id = configured(store), db = raw(store);
    db.exec(`CREATE TRIGGER fault AFTER INSERT ON explanation_tasks WHEN NEW.phase='dispatched' BEGIN
      UPDATE explanation_tasks SET phase='failed',payload=json_set(payload,'$.phase','failed','$.completedAt','2099-01-01T00:00:00.000Z','$.code','PROVIDER_FAILED') WHERE task_id=NEW.task_id; END`);
    const before = snapshot(db); expect(() => start(store, id)).toThrow(expect.objectContaining(safe)); expect(snapshot(db)).toBe(before);
    db.exec("DROP TRIGGER fault"); start(store, id); expect(store.remote.task(id.taskId)?.phase).toBe("dispatched");
  });
  it("permission and actual context failures remain zero registry/task/slot writes", () => {
    const store = open(), id = configured(store), db = raw(store), before = snapshot(db);
    expect(() => start(store, { ...id, authorizationRevision: 0 })).toThrow(expect.objectContaining({ code: "CONSENT_REVOKED" }));
    expect(() => start(store, { ...id, contextHandle: randomUUID() })).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" }));
    expect(snapshot(db)).toBe(before);
    const closedId = randomUUID(); store.close(); expect(() => store.remote.task(closedId)).toThrow(expect.objectContaining(safe));
  });
  it("connection-independent SQL guards reject unregistered writes, identity/time rewrites and reactivation", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xray-shared-bridge-")), "global.sqlite"), store = open(path), id = configured(store), db = connect(path);
    const task = legacyTask(); expect(() => db.prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,1)").run(task.identity.taskId, task.identity.ownerSessionId, task.phase, JSON.stringify(task))).toThrow();
    const registered = start(store, id); const before = snapshot(db);
    expect(() => db.prepare("UPDATE explanation_tasks SET payload=?").run(JSON.stringify({ ...registered, createdAt: time }))).toThrow(); expect(snapshot(db)).toBe(before);
    store.remote.finish(id.taskId, null); store.remote.releaseDispatch(id.taskId);
    expect(() => db.exec("UPDATE explanation_tasks SET inflight=1")).toThrow(); expect(() => db.exec("DELETE FROM explanation_tasks")).toThrow();
    expect(() => db.exec("DELETE FROM remote_task_registry")).toThrow();
  });
  it("maximum strict feature and semantic identity metadata fit16KiB without narrowing contracts", () => {
    // Unpaired surrogate is legal bounded text and maximizes JSON escape bytes per UTF-16 unit.
    const maxId = "\ud800".repeat(128), maxRevision = Number.MAX_SAFE_INTEGER;
    const feature = remoteCapturedIdentitySchema.parse({ ...identity(), repositoryId: maxId, snapshotId: maxId, ignoreRevision: maxRevision,
      authorizationRevision: maxRevision, providerRevision: maxRevision, credentialRevision: maxRevision, contextEpoch: maxRevision });
    const sem = ownershipSemanticCapturedIdentitySchema.parse({ ...semantic(feature), questionId: maxId, attemptId: maxId,
      questionVersion: "\ud800".repeat(64), deterministicScoringVersion: "\ud800".repeat(64), model: "m".repeat(128), activation: "2026-10-01T00:00:00.123456789Z" });
    for (const captured of [feature, sem]) expect(Buffer.byteLength(canonicalJson(captured))).toBeLessThan(16384);
  });
});
