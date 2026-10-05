import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalSnapshotResult, type ProjectSnapshot, type RemoteCapturedIdentity } from "@project-xray/contracts";
import { GraphStore } from "./index.js";

const roots: string[] = []; const handles: { close(): void }[] = [];
afterEach(() => { vi.useRealTimers(); for (const handle of handles.splice(0).reverse()) handle.close(); for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("临时目录边界无效"); rmSync(root, { recursive: true, force: true }); } });
const content = "export function login(){ return 1 }\n";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const source = { filePath: "a.ts", contentHash: hash(content), language: "TypeScript", content };
function fixtureSnapshot(id = "snap"): ProjectSnapshot {
  const snapshot: ProjectSnapshot = { repositoryId: "repo", snapshotId: id, name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-10-01T00:00:00.000Z",
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { test: "1" }, configurationHash: hash("config"), sourceFingerprint: hash(content) },
    sourceFiles: [{ filePath: "a.ts", contentHash: source.contentHash, language: source.language, bytes: Buffer.byteLength(content) }],
    nodes: [{ id: "login", snapshotId: id, kind: "function", name: "login", qualifiedName: "login", filePath: "a.ts", evidenceId: "proof", metadata: {} }], edges: [],
    evidence: [{ id: "proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "symbol-definition", confidence: "verified", reason: "syntax", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: content.trimEnd().length } }],
    health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] } };
  snapshot.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: hash(canonicalSnapshotResult(snapshot)) }; return snapshot;
}
function fixture(legacy = false) {
  const root = mkdtempSync(join(tmpdir(), "xray-policy-")); roots.push(root);
  const authorityPath = join(root, "global.sqlite"), projectPath = join(root, "project.sqlite");
  const authority = new GraphStore(authorityPath, "global"), project = new GraphStore(projectPath, "project"); handles.push(authority, project);
  const src = legacy ? authority : project; const snapshot = fixtureSnapshot(); src.saveSnapshot(snapshot, [source]);
  const context = authority.remote.commitTrustedContext(randomUUID(), src.remote.activation("repo", "snap"));
  const identity: RemoteCapturedIdentity = { protocolVersion: "1.0.0", taskId: randomUUID(), repositoryId: "repo", snapshotId: "snap", analysisResultFingerprint: snapshot.analysisIdentity.analysisResult!.fingerprint,
    configurationHash: snapshot.analysisIdentity.configurationHash, ignorePolicyHash: null, sourceManifestHash: src.remote.activation("repo", "snap").sourceManifestHash,
    activation: context.reference!.activation, ignoreRevision: 0, authorizationRevision: 0, providerRevision: 0, credentialRevision: 0,
    contextEpoch: context.epoch, ownerSessionId: context.ownerSessionId, contextHandle: context.contextHandle, packageId: hash("package"), bodyDigest: hash("body"), limitsVersion: "1.0.0" };
  return { authority, project, src, snapshot, identity, authorityPath, projectPath, context };
}

describe("remote policy persistence", () => {
  it("private reservation keeps first T1 through late promotion, rejects replay and foreign receipts", () => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true); f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    const id = { ...f.identity, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1 }; vi.useFakeTimers(); vi.setSystemTime("2026-10-05T01:00:00Z");
    const receipt = f.authority.remote.immediate(() => f.authority.remote.reserveDispatch(id)), db = new Database(f.authorityPath); handles.push(db);
    expect(db.prepare("SELECT created_at,stage FROM remote_provider_lease").get()).toEqual({ created_at: "2026-10-05T01:00:00.000Z", stage: "reserved" });
    const other = new GraphStore(f.authorityPath, "global"); handles.push(other);
    expect(() => other.remote.immediate(() => other.remote.registerReservedDispatch(receipt))).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
    expect(() => f.authority.remote.immediate(() => f.authority.remote.registerReservedDispatch(structuredClone(receipt)))).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
    vi.setSystemTime("2026-10-05T02:00:00Z"); const task = f.authority.remote.immediate(() => { const task = f.authority.remote.registerReservedDispatch(receipt); f.authority.remote.markReservedDispatchAttempt(receipt); return task; });
    expect(task.createdAt).toBe("2026-10-05T01:00:00.000Z");
    expect(() => f.authority.remote.immediate(() => f.authority.remote.registerReservedDispatch(receipt))).toThrow();
    expect(() => f.authority.remote.immediate(() => f.authority.remote.finishUndispatchedReservation(receipt, "CANCELLED"))).toThrow();
    vi.setSystemTime("2026-10-05T00:00:00Z"); expect(() => f.authority.remote.finish(id.taskId, null)).toThrow(expect.objectContaining({ code: "POLICY_INVALID" })); expect(f.authority.remote.task(id.taskId)?.phase).toBe("dispatched");
    vi.setSystemTime("2026-10-05T03:00:00Z"); f.authority.remote.finish(id.taskId, null); f.authority.remote.releaseDispatch(id.taskId);
  });
  it.each(["delete", "commit"])("zero-dispatch cleanup %s failure retains reservation and safely retries", kind => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true); f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    const id = { ...f.identity, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1 }, receipt = f.authority.remote.immediate(() => f.authority.remote.reserveDispatch(id)), db = new Database(f.authorityPath); handles.push(db);
    const before = db.prepare("SELECT * FROM remote_provider_lease").all();
    if (kind === "delete") db.exec("CREATE TRIGGER cleanup_fault BEFORE DELETE ON remote_provider_lease BEGIN SELECT RAISE(ABORT,'private'); END");
    else db.exec("CREATE TABLE clean_parent(id INTEGER PRIMARY KEY); CREATE TABLE clean_guard(id INTEGER REFERENCES clean_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER cleanup_fault AFTER INSERT ON explanation_tasks BEGIN INSERT INTO clean_guard VALUES(1); END");
    expect(() => f.authority.remote.immediate(() => f.authority.remote.finishUndispatchedReservation(receipt, "CANCELLED"))).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
    expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual(before); expect(f.authority.remote.task(id.taskId)).toBeNull();
    db.exec("DROP TRIGGER cleanup_fault"); const terminal = f.authority.remote.immediate(() => f.authority.remote.finishUndispatchedReservation(receipt, "CANCELLED"));
    expect(terminal.createdAt).toBe((before[0] as { created_at: string }).created_at); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("attempt latch survives transaction rollback and cannot become zero-dispatch cleanup", () => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true); f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    const id = { ...f.identity, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1 }, receipt = f.authority.remote.immediate(() => f.authority.remote.reserveDispatch(id));
    expect(() => f.authority.remote.immediate(() => { f.authority.remote.registerReservedDispatch(receipt); f.authority.remote.markReservedDispatchAttempt(receipt); throw Error("controlled rollback"); })).toThrow();
    expect(f.authority.remote.task(id.taskId)).toBeNull();
    expect(() => f.authority.remote.immediate(() => f.authority.remote.finishUndispatchedReservation(receipt, "CANCELLED"))).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
    expect(() => f.authority.remote.recoverInterrupted()).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
  });
  it("shared registry retains first feature creation time through trusted policy termination and release", () => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true);
    f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    const identity = { ...f.identity, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1 };
    const first = f.authority.remote.immediate(() => f.authority.remote.registerDispatch(identity));
    const db = new Database(f.authorityPath); handles.push(db);
    expect(db.prepare("SELECT created_at FROM remote_task_registry WHERE task_id=?").get(identity.taskId)).toEqual({ created_at: first.createdAt });
    f.authority.remote.saveProvider(1, { provider: "openai", model: "changed", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    expect(f.authority.remote.task(identity.taskId)).toMatchObject({ phase: "failed", code: "NOT_CONFIGURED", createdAt: first.createdAt });
    expect(db.prepare("SELECT created_at FROM remote_provider_lease WHERE task_id=?").get(identity.taskId)).toEqual({ created_at: first.createdAt });
    f.authority.remote.releaseDispatch(identity.taskId); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("migration10 creates only role-appropriate tables and retains old source/payload/time", () => {
    const f = fixture(); const db = new Database(f.projectPath); handles.push(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name);
    expect(names).toContain("remote_explanations"); for (const name of ["remote_provider_settings", "project_remote_authorizations", "explanation_contexts", "explanation_tasks"]) expect(names).not.toContain(name);
    expect(db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get()).toBeTruthy();
    expect(() => f.project.remote.provider()).toThrow();
    const reopened = new GraphStore(f.projectPath, "project"); handles.push(reopened);
    expect(reopened.loadSnapshot("snap")).toEqual(f.snapshot); expect(reopened.readSnapshotSource("snap", "a.ts")?.content).toBe(content);
  });
  it("defaults denied/unconfigured, accepts no credential/endpoint in settings", () => {
    const f = fixture(); expect(f.authority.remote.authorization("repo").status).toBe("denied"); expect(f.authority.remote.provider().credentialStatus).toBe("unconfigured");
    expect(() => f.authority.remote.assertPermission(f.identity)).toThrow();
    expect(() => f.authority.remote.saveProvider(0, { ...f.authority.remote.provider(), key: "private" } as never)).toThrow();
    expect(f.authority.remote.provider().revision).toBe(0);
  });
  it("old snapshots missing result identity remain readable offline and require re-indexing remotely", () => {
    const f = fixture(); const legacy = fixtureSnapshot("old"); delete legacy.analysisIdentity.analysisResult; f.src.saveSnapshot(legacy, [source]);
    expect(() => f.src.remote.activation("repo", "old")).toThrow(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
    expect(f.src.loadSnapshot("old")).toEqual(legacy); expect(f.src.getEvidence("old", "proof")?.id).toBe("proof"); expect(f.src.readSnapshotSource("old", "a.ts")?.content).toBe(content);
  });
  it.each(["authorization", "provider", "context", "ignore", "activation"] as const)("second connection changes %s before dispatch: callback is never called", kind => {
    const f = fixture(); const other = new GraphStore(kind === "ignore" || kind === "activation" ? f.projectPath : f.authorityPath, kind === "ignore" || kind === "activation" ? "project" : "global"); handles.push(other);
    if (kind === "authorization") other.remote.saveAuthorization("repo", 0, true);
    if (kind === "provider") other.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    if (kind === "context") other.remote.commitTrustedContext(f.context.ownerSessionId, null);
    if (kind === "ignore") other.saveIgnoreSettings("repo", 0, ["generated/**"]);
    if (kind === "activation") other.saveSnapshot(f.snapshot, [source]);
    let calls = 0; expect(() => f.authority.withExplanationRevisions(f.identity, f.project, f.src, () => { calls++; })).toThrow(); expect(calls).toBe(0);
  });
  it("legacy dispatch/publication holds authority and config locks through source write", () => {
    const f = fixture(true); const otherAuthority = new GraphStore(f.authorityPath, "global"), otherProject = new GraphStore(f.projectPath, "project"); handles.push(otherAuthority, otherProject);
    f.authority.withExplanationRevisions(f.identity, f.project, f.src, () => {
      expect(() => otherAuthority.remote.commitTrustedContext(f.context.ownerSessionId, null)).toThrow(expect.objectContaining({ code: "BUSY" }));
      expect(() => otherProject.saveIgnoreSettings("repo", 0, ["x/**"])).toThrow();
      expect(f.src.readSnapshotSource("snap", "a.ts")?.content).toBe(content);
    });
    expect(otherAuthority.remote.commitTrustedContext(f.context.ownerSessionId, null).active).toBe(false);
    expect(otherProject.saveIgnoreSettings("repo", 0, ["x/**"]).revision).toBe(1);
  });
  it("rejects a Promise returned from synchronous transaction and rolls writes back", () => {
    const f = fixture(); expect(() => f.authority.remote.immediate(() => { f.authority.remote.saveAuthorization("repo", 0, true); return Promise.resolve(); })).toThrow();
    expect(f.authority.remote.authorization("repo").revision).toBe(0);
  });
  it("policy termination is terminal once and keeps inflight lease until cleanup; restart interrupts without resending", () => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true); f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    f.identity.authorizationRevision = 1; f.identity.providerRevision = 1; f.identity.credentialRevision = 1;
    f.authority.withExplanationRevisions(f.identity, f.project, f.src, () => f.authority.remote.registerDispatch(f.identity));
    f.authority.remote.saveAuthorization("repo", 1, true);
    expect(f.authority.remote.finish(f.identity.taskId, "CANCELLED").code).toBe("CONSENT_REVOKED");
    expect(() => f.authority.remote.immediate(() => f.authority.remote.registerDispatch({ ...f.identity, authorizationRevision: 2, taskId: randomUUID() }))).toThrow(expect.objectContaining({ code: "BUSY" }));
    f.authority.remote.releaseDispatch(f.identity.taskId); const next = { ...f.identity, authorizationRevision: 2, taskId: randomUUID() }; f.authority.remote.immediate(() => f.authority.remote.registerDispatch(next));
    const reopened = new GraphStore(f.authorityPath, "global"); handles.push(reopened); reopened.remote.recoverInterrupted();
    expect(reopened.remote.task(next.taskId)?.phase).toBe("interrupted"); expect(reopened.remote.task(f.identity.taskId)?.code).toBe("CONSENT_REVOKED");
    expect(() => reopened.remote.context(f.context.contextHandle)).toThrow();
    const current = reopened.remote.commitTrustedContext(f.context.ownerSessionId, f.src.remote.activation("repo", "snap"));
    expect(reopened.remote.immediate(() => reopened.remote.registerDispatch({ ...next, contextHandle: current.contextHandle, contextEpoch: current.epoch, taskId: randomUUID() })).phase).toBe("dispatched");
  });
  it.each(["remote_provider_settings", "project_remote_authorizations", "explanation_contexts"] as const)("corrupt %s fails closed without exception text", table => {
    const f = fixture(); f.authority.remote.saveAuthorization("repo", 0, true); f.authority.remote.saveProvider(0, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
    const db = new Database(f.authorityPath); handles.push(db); db.prepare(`UPDATE ${table} SET payload=?`).run('{"key":"private","body":"raw source"}');
    const work = table === "remote_provider_settings" ? () => f.authority.remote.provider() : table === "project_remote_authorizations" ? () => f.authority.remote.authorization("repo") : () => f.authority.remote.context(f.context.contextHandle);
    expect(work).toThrow(expect.objectContaining({ code: "POLICY_INVALID", message: "远程解释未完成" }));
  });
});
