import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson, OWNERSHIP_SEMANTIC_POLICY_CATEGORIES, OWNERSHIP_SEMANTIC_PURPOSE, OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  type OwnershipSemanticGrantCommand, type OwnershipSemanticRevokeCommand, type OwnershipSemanticAuthorization, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "./index.js";
const stores: GraphStore[] = [], connections: Database.Database[] = [];
const db = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
function open(file = ":memory:", role: "global" | "project" = "global") { const store = new GraphStore(file, role); stores.push(store); return store; }
function fixture() { const file = join(mkdtempSync(join(tmpdir(), "xray-semantic-policy-")), "global.sqlite"); return { file, store: open(file) }; }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const connection of connections.splice(0)) if (connection.open) connection.close(); for (const store of stores.splice(0)) if (db(store).open) store.close(); });
function grant(repositoryId = "repo", expectedRevision = 0, expectedProviderRevision = 0): OwnershipSemanticGrantCommand {
  return { repositoryId, expectedRevision, expectedProviderRevision, purpose: OWNERSHIP_SEMANTIC_PURPOSE, disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION, categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES] };
}
function revoke(repositoryId = "repo", expectedRevision = 0): OwnershipSemanticRevokeCommand { return { repositoryId, expectedRevision, purpose: OWNERSHIP_SEMANTIC_PURPOSE, disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION }; }
function state(store: GraphStore, omitPolicy = false) {
  const schema = db(store).prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name").all() as { name: string; type: string }[];
  return canonicalJson({ schema, rows: schema.filter(row => row.type === "table" && (!omitPolicy || row.name !== "ownership_semantic_authorizations"))
    .map(row => ({ name: row.name, rows: db(store).prepare(`SELECT * FROM "${row.name.replaceAll('"', '""')}"`).all() })) });
}
function persist(store: GraphStore, record: OwnershipSemanticAuthorization, override: Record<string, unknown> = {}) {
  db(store).prepare("INSERT OR REPLACE INTO ownership_semantic_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)").run(record.repositoryId,
    override.provider ?? record.provider, override.purpose ?? record.purpose, override.disclosure ?? record.disclosureVersion,
    override.version ?? record.version, override.revision ?? record.revision, override.status ?? record.status,
    override.grantedAt ?? record.grantedAt, override.revokedAt ?? record.revokedAt, override.payload ?? JSON.stringify(record));
}
const safe = { name: "RemoteExplanationError", code: "POLICY_INVALID", message: "远程解释未完成" };
describe("independent semantic authorization SQL", () => {
  it("initial denied reads zero-write and never derives feature grants or changes legacy tables", () => {
    const store = open(); store.remote.saveAuthorization("repo", 0, true);
    db(store).prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,?)").run("old-task", "old-session", "completed", "old-task-sentinel", 0);
    const content = "owned historical fixture", hash = createHash("sha256").update(content).digest("hex");
    const snapshot: ProjectSnapshot = { repositoryId: "repo", snapshotId: "old-snapshot", name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-10-05T00:00:00.000Z",
      analysisIdentity: { graphIrVersion: "1", analyzerVersions: { fixture: "1" }, configurationHash: "config", sourceFingerprint: hash },
      sourceFiles: [{ filePath: "owned.txt", contentHash: hash, bytes: Buffer.byteLength(content), language: "Text" }], nodes: [], edges: [], evidence: [],
      health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { Text: 1 }, limitations: [] } };
    store.saveSnapshot(snapshot, [{ filePath: "owned.txt", contentHash: hash, content, language: "Text" }]);
    const before = state(store), changes = db(store).prepare("SELECT total_changes() n").get(); db(store).pragma("query_only=ON");
    const denied = store.loadOwnershipSemanticAuthorization("repo"); expect(denied).toMatchObject({ revision: 0, status: "denied", categories: [], grantedAt: null, revokedAt: null });
    denied.categories.push("answer-text"); expect(store.loadOwnershipSemanticAuthorization("repo").categories).toEqual([]);
    expect(state(store)).toBe(before); expect(db(store).prepare("SELECT total_changes() n").get()).toEqual(changes); db(store).pragma("query_only=OFF");
    const legacy = state(store, true); store.grantOwnershipSemanticAuthorization(grant()); store.revokeOwnershipSemanticAuthorization(revoke("repo", 1)); expect(state(store, true)).toBe(legacy);
  });
  it("grant/revoke/regrant reopen, preserve real grant times, and return defensive copies", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-05T01:00:00.000Z"); const { store, file } = fixture();
    const input = grant(), first = store.grantOwnershipSemanticAuthorization(input); expect(first).toMatchObject({ revision: 1, status: "granted", grantedAt: "2026-10-05T01:00:00.000Z", revokedAt: null });
    input.categories.reverse(); first.categories.length = 0; expect(store.loadOwnershipSemanticAuthorization("repo").categories).toEqual(OWNERSHIP_SEMANTIC_POLICY_CATEGORIES);
    vi.setSystemTime("2026-10-05T01:01:00.000Z"); const denied = store.revokeOwnershipSemanticAuthorization(revoke("repo", 1)); expect(denied).toMatchObject({ revision: 2, status: "denied", categories: [], grantedAt: "2026-10-05T01:00:00.000Z", revokedAt: "2026-10-05T01:01:00.000Z" });
    store.close(); const reopened = open(file); expect(reopened.loadOwnershipSemanticAuthorization("repo")).toEqual(denied); vi.setSystemTime("2026-10-05T01:02:00.000Z");
    expect(reopened.grantOwnershipSemanticAuthorization(grant("repo", 2))).toMatchObject({ revision: 3, status: "granted", grantedAt: "2026-10-05T01:02:00.000Z", revokedAt: null });
  });
  it("never-granted revocation keeps both null times", () => {
    const store = open(); expect(store.revokeOwnershipSemanticAuthorization(revoke())).toMatchObject({ revision: 1, status: "denied", categories: [], grantedAt: null, revokedAt: null });
    expect(store.revokeOwnershipSemanticAuthorization(revoke("repo", 1))).toMatchObject({ revision: 2, grantedAt: null, revokedAt: null });
  });
  it("full composite keys isolate repository, provider, purpose and disclosure", () => {
    const store = open(), denied = store.loadOwnershipSemanticAuthorization("repo");
    for (const override of [{ purpose: "feature-explanation" }, { disclosure: "ownership-semantics/2.0.0" }, { provider: "other" }]) persist(store, denied, { ...override, payload: "unrelated corrupt payload" });
    expect(store.loadOwnershipSemanticAuthorization("repo")).toEqual(denied); store.grantOwnershipSemanticAuthorization(grant()); expect(store.loadOwnershipSemanticAuthorization("other").status).toBe("denied");
    expect(db(store).prepare("SELECT count(*) n FROM ownership_semantic_authorizations").get()).toEqual({ n: 4 });
  });
  it.each(["feature", "missing", "duplicate", "unknown", "version", "revision", "getter", "nested-getter", "proxy", "oversized"])("rejects strict input %s with zero writes/getter execution", change => {
    const store = open(), raw = grant() as unknown as Record<string, unknown>; let called = false;
    if (change === "feature") { delete raw.purpose; delete raw.disclosureVersion; raw.granted = true; }
    if (change === "missing") raw.categories = OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.slice(1);
    if (change === "duplicate") raw.categories = Array(6).fill("answer-text");
    if (change === "unknown") raw.answer = "private-input";
    if (change === "version") raw.disclosureVersion = "ownership-semantics/2.0.0";
    if (change === "revision") raw.expectedRevision = Number.MAX_SAFE_INTEGER + 1;
    if (change === "oversized") raw.repositoryId = "x".repeat(4097);
    if (change === "getter") Object.defineProperty(raw, "repositoryId", { enumerable: true, get() { called = true; throw Error("private-getter"); } });
    if (change === "nested-getter") Object.defineProperty(raw.categories, "0", { enumerable: true, get() { called = true; throw Error("private-getter"); } });
    const before = state(store); expect(() => store.grantOwnershipSemanticAuthorization((change === "proxy" ? new Proxy(raw, {}) : raw) as unknown as OwnershipSemanticGrantCommand)).toThrow(expect.objectContaining(safe));
    expect(called).toBe(false); expect(state(store)).toBe(before);
    expect(() => store.revokeOwnershipSemanticAuthorization({ ...revoke(), categories: [] } as OwnershipSemanticRevokeCommand)).toThrow(expect.objectContaining(safe));
  });
  it.each(["version", "revision", "status", "grant-time", "revoke-time", "payload", "repository", "categories", "oversized"])("rejects stored %s corruption without replacing it with denial", change => {
    const store = open(), record = store.grantOwnershipSemanticAuthorization(grant()), overrides: Record<string, unknown> = {};
    if (change === "version") overrides.version = "other"; if (change === "revision") overrides.revision = 2; if (change === "status") overrides.status = "denied";
    if (change === "grant-time") overrides.grantedAt = "2026-10-06T00:00:00.000Z"; if (change === "revoke-time") overrides.revokedAt = "2026-10-06T00:00:00.000Z";
    if (change === "payload") overrides.payload = "private corrupt JSON"; if (change === "repository") overrides.payload = JSON.stringify({ ...record, repositoryId: "other" });
    if (change === "categories") overrides.payload = JSON.stringify({ ...record, categories: ["answer-text"] });
    if (change === "oversized") overrides.payload = " ".repeat(4097) + JSON.stringify(record);
    persist(store, record, overrides); const before = state(store);
    for (const operation of [() => store.loadOwnershipSemanticAuthorization("repo"), () => store.grantOwnershipSemanticAuthorization(grant("repo", 1)), () => store.revokeOwnershipSemanticAuthorization(revoke("repo", 1))]) expect(operation).toThrow(expect.objectContaining(safe));
    expect(state(store)).toBe(before);
  });
  it("two connections reject stale own/provider revisions and normalize corrupt real provider state", () => {
    const { file, store } = fixture(), contender = open(file); contender.grantOwnershipSemanticAuthorization(grant());
    expect(() => store.grantOwnershipSemanticAuthorization(grant())).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    const { revision: _revision, ...provider } = store.remote.provider(); contender.remote.saveProvider(0, { ...provider, model: "owned-test-model" });
    expect(() => store.grantOwnershipSemanticAuthorization(grant("repo", 1, 0))).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(store.grantOwnershipSemanticAuthorization(grant("repo", 1, 1)).revision).toBe(2);
    expect(() => contender.revokeOwnershipSemanticAuthorization(revoke("repo", 1))).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    db(store).prepare("UPDATE remote_provider_settings SET payload='private corrupt provider'").run(); const before = state(store);
    expect(() => store.grantOwnershipSemanticAuthorization(grant("repo", 2, 1))).toThrow(expect.objectContaining(safe)); expect(state(store)).toBe(before);
    expect(store.revokeOwnershipSemanticAuthorization(revoke("repo", 2)).status).toBe("denied");
  });
  it("BUSY and trigger faults fully rollback and safely retry", () => {
    const { file, store } = fixture(), writer = new Database(file); connections.push(writer); db(store).pragma("busy_timeout=1"); writer.exec("BEGIN IMMEDIATE");
    try { expect(() => store.grantOwnershipSemanticAuthorization(grant())).toThrow(expect.objectContaining({ code: "BUSY", message: "远程解释未完成" })); } finally { writer.exec("ROLLBACK"); }
    expect(store.loadOwnershipSemanticAuthorization("repo").revision).toBe(0);
    db(store).exec("CREATE TRIGGER fail_insert BEFORE INSERT ON ownership_semantic_authorizations BEGIN SELECT RAISE(ABORT,'private SQL'); END");
    expect(() => store.grantOwnershipSemanticAuthorization(grant())).toThrow(expect.objectContaining(safe)); expect(store.loadOwnershipSemanticAuthorization("repo").revision).toBe(0); db(store).exec("DROP TRIGGER fail_insert");
    store.grantOwnershipSemanticAuthorization(grant()); db(store).exec("CREATE TRIGGER fail_update BEFORE UPDATE ON ownership_semantic_authorizations BEGIN SELECT RAISE(ABORT,'private SQL'); END");
    const before = state(store); expect(() => store.revokeOwnershipSemanticAuthorization(revoke("repo", 1))).toThrow(expect.objectContaining(safe)); expect(state(store)).toBe(before); db(store).exec("DROP TRIGGER fail_update");
    expect(store.revokeOwnershipSemanticAuthorization(revoke("repo", 1)).revision).toBe(2);
  });
  it.each(["revoke", "regrant", "grant-again"])("clock rollback %s preserves all history, later retry works", action => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-05T02:00:00.000Z"); const store = open(); store.grantOwnershipSemanticAuthorization(grant()); let revision = 1;
    if (action === "regrant") { vi.setSystemTime("2026-10-05T03:00:00.000Z"); store.revokeOwnershipSemanticAuthorization(revoke("repo", 1)); revision = 2; }
    vi.setSystemTime("2026-10-05T01:00:00.000Z"); const before = state(store);
    expect(() => action === "revoke" ? store.revokeOwnershipSemanticAuthorization(revoke("repo", revision)) : store.grantOwnershipSemanticAuthorization(grant("repo", revision))).toThrow(expect.objectContaining(safe));
    expect(state(store)).toBe(before); vi.setSystemTime("2026-10-05T04:00:00.000Z");
    expect(action === "revoke" ? store.revokeOwnershipSemanticAuthorization(revoke("repo", revision)).revision : store.grantOwnershipSemanticAuthorization(grant("repo", revision)).revision).toBe(revision + 1);
  });
  it("revision overflow and invalid clock produce no writes", () => {
    const store = open(), record = store.loadOwnershipSemanticAuthorization("repo"); record.revision = Number.MAX_SAFE_INTEGER; persist(store, record); const before = state(store);
    for (const operation of [() => store.grantOwnershipSemanticAuthorization(grant("repo", record.revision)), () => store.revokeOwnershipSemanticAuthorization(revoke("repo", record.revision))]) expect(operation).toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(state(store)).toBe(before); vi.spyOn(Date.prototype, "toISOString").mockImplementation(() => "invalid clock");
    expect(() => store.grantOwnershipSemanticAuthorization(grant("other"))).toThrow(expect.objectContaining(safe)); expect(state(store)).toBe(before);
  });
  it("global migration13 is idempotent; project keeps12 and has zero policy table/writes; closed rejects", () => {
    const { file, store } = fixture(), old = state(store); expect(db(store).prepare("SELECT version FROM schema_migrations WHERE version IN(12,13)").all()).toEqual([{ version: 13 }]);
    store.close(); const reopened = open(file); expect(state(reopened)).toBe(old);
    for (const operation of [() => store.loadOwnershipSemanticAuthorization("repo"), () => store.grantOwnershipSemanticAuthorization(grant()), () => store.revokeOwnershipSemanticAuthorization(revoke())]) expect(operation).toThrow(expect.objectContaining(safe));
    const project = open(":memory:", "project"), before = state(project);
    expect(db(project).prepare("SELECT version FROM schema_migrations WHERE version=13").all()).toEqual([]); expect(db(project).prepare("SELECT name FROM sqlite_master WHERE name='ownership_semantic_authorizations'").get()).toBeUndefined();
    for (const operation of [() => project.loadOwnershipSemanticAuthorization("repo"), () => project.grantOwnershipSemanticAuthorization(grant()), () => project.revokeOwnershipSemanticAuthorization(revoke())]) expect(operation).toThrow(expect.objectContaining(safe));
    expect(state(project)).toBe(before);
  });
  it("upgrade from pre13 is atomic on migration failure and preserves old rows/times when retried", () => {
    const { file, store } = fixture(); store.remote.saveAuthorization("repo", 0, true);
    const migrations = db(store).prepare("SELECT * FROM schema_migrations WHERE version<>13 ORDER BY version").all(), feature = db(store).prepare("SELECT * FROM project_remote_authorizations").all();
    store.close(); const raw = new Database(file); connections.push(raw);
    raw.exec("DROP TABLE ownership_semantic_authorizations; DELETE FROM schema_migrations WHERE version=13; CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'private migration SQL'); END");
    expect(() => new GraphStore(file, "global")).toThrow(expect.objectContaining(safe));
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='ownership_semantic_authorizations'").get()).toBeUndefined(); expect(raw.prepare("SELECT * FROM schema_migrations WHERE version=13").get()).toBeUndefined();
    expect(raw.prepare("SELECT * FROM schema_migrations WHERE version<>13 ORDER BY version").all()).toEqual(migrations); expect(raw.prepare("SELECT * FROM project_remote_authorizations").all()).toEqual(feature);
    raw.exec("DROP TRIGGER fail_migration"); const upgraded = open(file);
    expect(db(upgraded).prepare("SELECT * FROM schema_migrations WHERE version<>13 ORDER BY version").all()).toEqual(migrations); expect(db(upgraded).prepare("SELECT * FROM project_remote_authorizations").all()).toEqual(feature);
    expect(upgraded.loadOwnershipSemanticAuthorization("repo").status).toBe("denied");
  });
  it("provider read and insert hold the same IMMEDIATE lock against a second writer", () => {
    const { file, store } = fixture(), raw = new Database(file); connections.push(raw); raw.pragma("busy_timeout=1");
    const { revision: _revision, ...provider } = store.remote.provider(); store.remote.saveProvider(0, provider);
    let inTransaction = false, blocked = false;
    db(store).function("capture_provider", (payload: string) => {
      inTransaction = db(store).inTransaction;
      try { raw.prepare("UPDATE provider_original SET payload=payload").run(); } catch (error) { blocked = (error as { code?: string }).code === "SQLITE_BUSY"; }
      return payload;
    });
    // Owned adversarial SQL view makes the actual same-connection SELECT observable.
    db(store).exec("ALTER TABLE remote_provider_settings RENAME TO provider_original; CREATE VIEW remote_provider_settings AS SELECT id,capture_provider(payload) payload FROM provider_original");
    expect(store.grantOwnershipSemanticAuthorization(grant("repo", 0, 1)).revision).toBe(1); expect(inTransaction).toBe(true); expect(blocked).toBe(true);
  });
});
