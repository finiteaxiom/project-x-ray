import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, ownershipSemanticCapturedIdentitySchema, remoteCapturedIdentitySchema, type OwnershipSemanticCapturedIdentity } from "@project-xray/contracts";
import { GraphStore } from "./index.js";
import { SharedRemoteTaskStore } from "./shared-remote-task-store.js";
import { OwnershipSemanticTaskStore, semanticBindingHash } from "./ownership-semantic-task-store.js";
import { invalidateOwnershipSemanticTasks } from "./ownership-semantic-invalidation-store.js";
import { OWNERSHIP_SEMANTIC_POLICY_CATEGORIES } from "@project-xray/contracts";

const time = "2026-10-05T00:00:00.123456Z", h = "a".repeat(64);
const stores: GraphStore[] = [], connections: Database.Database[] = [];
const roots: string[] = [];
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
afterEach(() => { for (const db of connections.splice(0)) if (db.open) db.close(); for (const store of stores.splice(0)) if (raw(store).open) store.close(); for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe cleanup"); rmSync(root, { recursive: true, force: true }); } });

function update(store: GraphStore, mode: string, id = identity()) {
  if (mode.startsWith("provider")) {
    const { revision, ...old } = store.remote.provider();
    return store.remote.saveProvider(revision, { ...old, ...(mode === "provider-model" ? { model: "changed" } : mode === "provider-credential" ? { credentialRevision: old.credentialRevision + 1 } : { outputTokens: 64 }) });
  }
  if (mode.startsWith("context")) return store.remote.commitTrustedContext(mode === "context-other" ? randomUUID() : id.ownerSessionId, null);
  if (mode === "feature-auth") return store.remote.saveAuthorization(id.repositoryId, store.remote.authorization(id.repositoryId).revision, true);
  const repositoryId = mode === "semantic-other" ? "other" : id.repositoryId, old = store.loadOwnershipSemanticAuthorization(repositoryId);
  if (mode === "semantic-revoke") return store.revokeOwnershipSemanticAuthorization({ repositoryId, expectedRevision: old.revision, purpose: old.purpose, disclosureVersion: old.disclosureVersion });
  return store.grantOwnershipSemanticAuthorization({ repositoryId, expectedRevision: old.revision, expectedProviderRevision: store.remote.provider().revision, purpose: old.purpose, disclosureVersion: old.disclosureVersion, categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES] });
}
describe("semantic policy invalidation transactions", () => {
  it("committed semantic policy terminal still blocks feature on a real second connection", () => {
    const root = mkdtempSync(join(tmpdir(), "xray-semantic-invalidation-")); roots.push(root);
    const file = join(root, "global.sqlite"), { store, db, core, tx } = open(file), id = identity(); tx(() => { core.reserve(id, time); core.promote(id); }); update(store, "provider-model", id);
    const second = connect(file), shared = new SharedRemoteTaskStore(second, "global");
    const feature = remoteCapturedIdentitySchema.parse({ protocolVersion: "1.0.0", taskId: randomUUID(), ownerSessionId: id.ownerSessionId, contextHandle: id.contextHandle, contextEpoch: id.contextEpoch,
      repositoryId: id.repositoryId, snapshotId: id.snapshotId, activation: id.activation, analysisResultFingerprint: h, sourceManifestHash: h, configurationHash: h, ignorePolicyHash: null, ignoreRevision: 0, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1, packageId: h, bodyDigest: h, limitsVersion: "1.0.0" });
    const before = snapshot(db); expect(() => second.transaction(() => shared.reserveFeature(feature, time)).immediate()).toThrowError(expect.objectContaining({ code: "BUSY" })); expect(snapshot(db)).toBe(before);
  });
  it.each(["provider-output", "provider-model", "provider-credential", "context", "semantic-grant", "semantic-revoke"])("%s atomically fails matching dispatched but retains T1/inflight/lease", mode => {
    const { store, db, core, tx } = open(), id = identity(); tx(() => { core.reserve(id, time); core.promote(id); });
    const lease = db.prepare("SELECT * FROM remote_provider_lease").get(); update(store, mode, id);
    expect(core.read(id.taskId)).toMatchObject({ phase: "failed", createdAt: time, code: mode.startsWith("provider") ? "NOT_CONFIGURED" : mode === "context" ? "CONTEXT_CHANGED" : "CONSENT_REVOKED" });
    expect(db.prepare("SELECT inflight FROM ownership_semantic_tasks").get()).toEqual({ inflight: 1 }); expect(db.prepare("SELECT * FROM remote_provider_lease").get()).toEqual(lease);
    expect(() => tx(() => core.reserve(identity(), time))).toThrowError(expect.objectContaining({ code: "BUSY" }));
  });
  it.each(["context-other", "semantic-other", "feature-auth"])("%s cannot invalidate unrelated semantic task", mode => {
    const { store, db, core, tx } = open(), id = identity(); tx(() => { core.reserve(id, time); core.promote(id); }); const old = core.read(id.taskId), lease = db.prepare("SELECT * FROM remote_provider_lease").get();
    update(store, mode, id); expect(core.read(id.taskId)).toEqual(old); expect(db.prepare("SELECT * FROM remote_provider_lease").get()).toEqual(lease);
  });
  it.each(["reserved", "completed", "failed", "cancelled"])("%s history is never rewritten or released by policy", phase => {
    const { store, db, core, tx } = open(), id = identity();
    tx(() => { core.reserve(id, time); if (phase !== "reserved") { core.promote(id); core.finish(id, phase === "completed" ? null : phase === "cancelled" ? "CANCELLED" : "PROVIDER_FAILED", time); } });
    const old = core.read(id.taskId), lease = db.prepare("SELECT * FROM remote_provider_lease").get(); update(store, "provider-model", id); update(store, "semantic-grant", id); update(store, "context", id);
    expect(core.read(id.taskId)).toEqual(old); expect(db.prepare("SELECT * FROM remote_provider_lease").get()).toEqual(lease);
  });
  it.each(["provider-model", "context", "semantic-grant", "semantic-revoke"].flatMap(mode => ["abort", "ignore", "wrong-terminal", "commit"].map(fault => ({ mode, fault }))))("$mode/$fault rolls back policy and all task state", ({ mode, fault }) => {
    const { store, db, core, tx } = open(), id = identity(); tx(() => { core.reserve(id, time); core.promote(id); });
    if (fault === "commit") db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER UPDATE ON ownership_semantic_tasks BEGIN INSERT INTO fault_child VALUES(1); END");
    else if (fault === "wrong-terminal") {
      // Legal strict failure row with a different code after the intended write.
      db.exec("DROP TRIGGER semantic_task_update; CREATE TRIGGER inject AFTER UPDATE ON ownership_semantic_tasks BEGIN UPDATE ownership_semantic_tasks SET payload=json_set(payload,'$.code','PROVIDER_FAILED') WHERE task_id=NEW.task_id; END");
    } else db.exec(`CREATE TRIGGER inject BEFORE UPDATE ON ownership_semantic_tasks BEGIN SELECT RAISE(${fault === "ignore" ? "IGNORE" : "ABORT,'private'"}); END`);
    const before = snapshot(db); expect(() => update(store, mode, id)).toThrow(); expect(snapshot(db)).toBe(before);
  });
  it("missing17/half-installed schema refuses, while a legitimate empty pre17 store remains compatible", () => {
    const db = new Database(":memory:"); connections.push(db); db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)");
    db.transaction(() => invalidateOwnershipSemanticTasks(db, { kind: "all" }, "NOT_CONFIGURED"))();
    db.exec("CREATE TABLE ownership_semantic_tasks(task_id TEXT)"); expect(() => db.transaction(() => invalidateOwnershipSemanticTasks(db, { kind: "all" }, "NOT_CONFIGURED"))()).toThrow();
    const f = open(); f.db.exec("DROP TABLE ownership_semantic_tasks"); expect(() => f.store.remote.saveProvider(0, { provider: "openai", model: "changed", credentialRevision: 1, credentialStatus: "configured", outputTokens: 64 })).toThrow();
  });
});
