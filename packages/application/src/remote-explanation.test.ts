import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson, canonicalSnapshotResult, RemoteExplanationError, remoteResultSchema, type ProjectSnapshot, type RemotePreview, type RemoteProviderSettings, type RemoteTaskRecord } from "@project-xray/contracts";
import { GraphStore } from "@project-xray/graph";
import { type PreparedEvidencePackage } from "@project-xray/llm";
import { RemoteExplanationApplication, type RemoteApplicationPorts } from "./remote-explanation.js";
import { XRayApplication } from "./index.js";

interface RawDatabase { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => RawDatabase;
const roots: string[] = []; const handles: { close(): void }[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); for (const handle of handles.splice(0).reverse()) handle.close(); for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("临时目录边界无效"); rmSync(root, { recursive: true, force: true }); } });
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const content = "export function login(){ return target() }\nfunction target(){ return 1 }\n";
const sourceFile = { filePath: "a.ts", contentHash: hash(content), language: "TypeScript", content };
function snapshot(id = "snap", partial = false): ProjectSnapshot {
  const value: ProjectSnapshot = { repositoryId: "repo", snapshotId: id, name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-10-01T00:00:00.000Z",
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { test: "1" }, configurationHash: hash("config"), sourceFingerprint: hash(content) },
    sourceFiles: [{ filePath: "a.ts", contentHash: sourceFile.contentHash, bytes: Buffer.byteLength(content), language: "TypeScript" }],
    nodes: [
      { id: "file", snapshotId: id, kind: "file", name: "a.ts", qualifiedName: "a.ts", filePath: "a.ts", evidenceId: "file-proof", metadata: {} },
      { id: "login", snapshotId: id, kind: "function", name: "login", qualifiedName: "login", filePath: "a.ts", evidenceId: "login-proof", metadata: {} },
      { id: "target", snapshotId: id, kind: "function", name: "target", qualifiedName: "target", filePath: "a.ts", evidenceId: "target-proof", metadata: {} },
      { id: "dynamic", snapshotId: id, kind: "unresolved-call", name: "dynamic", qualifiedName: "dynamic", metadata: {} },
    ],
    edges: [ { id: "call", snapshotId: id, source: "login", target: "target", kind: "CALLS", evidenceId: "call-proof", confidence: "verified", reason: "syntax" },
      { id: "unknown", snapshotId: id, source: "login", target: "dynamic", kind: "CALLS", evidenceId: "unknown-proof", confidence: "unknown", reason: "dynamic structure", unresolvedTarget: "dynamic" } ],
    evidence: [
      { id: "file-proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "file", confidence: "verified", reason: "file", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 3, endColumn: 0 } },
      { id: "login-proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "symbol-definition", confidence: "verified", reason: "definition", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 41 } },
      { id: "target-proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "symbol-definition", confidence: "verified", reason: "definition", span: { filePath: "a.ts", startLine: 2, startColumn: 0, endLine: 2, endColumn: 29 } },
      { id: "call-proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "call-expression", confidence: "verified", reason: "call", span: { filePath: "a.ts", startLine: 1, startColumn: 32, endLine: 1, endColumn: 40 } },
      { id: "unknown-proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "call-expression", confidence: "unknown", reason: "dynamic", span: { filePath: "a.ts", startLine: 1, startColumn: 32, endLine: 1, endColumn: 40 } },
    ],
    health: { status: partial ? "partial" : "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: ["static only"] } };
  value.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: hash(canonicalSnapshotResult(value)) }; return value;
}
function narrative(prepared: PreparedEvidencePackage) {
  const pack = prepared.evidencePackage;
  return { version: "1.0.0", repositoryId: pack.repositoryId, snapshotId: pack.snapshotId, packageId: pack.packageId,
    claims: [{ text: "受源码支持的静态说明", evidenceIds: [pack.proofs.find(item => item.confidence === "verified")!.id], confidence: "inferred" }], unknowns: [] };
}
function stagedResult(task: RemoteTaskRecord, prepared: PreparedEvidencePackage) {
  const pack = prepared.evidencePackage;
  return remoteResultSchema.parse({ version: "1.0.0", identity: task.identity, narrative: narrative(prepared), checkedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    localUnknowns: prepared.localUnknowns, localLimitations: prepared.localLimitations, localTruncation: pack.truncation,
    citations: pack.proofs.map(({ snippet: _snippet, ...proof }) => proof),
    unknownEvidenceIds: [...new Set([...pack.proofs.filter(proof => proof.confidence === "unknown").map(proof => proof.id), ...pack.edges.filter(edge => edge.confidence === "unknown").map(edge => edge.evidenceId)])] });
}
function fixture(options: { configured?: boolean; allowed?: boolean; legacy?: boolean; noPorts?: boolean; partial?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "xray-remote-app-")); roots.push(root);
  const authorityPath = join(root, "global.sqlite"), projectPath = join(root, "project.sqlite");
  const authority = new GraphStore(authorityPath, "global"), settings = new GraphStore(projectPath, "project"); handles.push(authority, settings);
  const source = options.legacy ? authority : settings; const snap = snapshot("snap", options.partial); source.saveSnapshot(snap, [sourceFile]);
  const events: string[] = []; let count = 0; let checks = 0; let clock = 0; let preparedInput: PreparedEvidencePackage | undefined;
  const behavior = {
    check: (_stage: number): void | Promise<void> => undefined,
    dispatch: (prepared: PreparedEvidencePackage, _signal: AbortSignal): Promise<unknown> => Promise.resolve(narrative(prepared)),
    digest: (prepared: PreparedEvidencePackage, provider: RemoteProviderSettings): string => hash(canonicalJson({ fixtureProtocol: "1.0.0", prepared: prepared.evidencePackage, model: provider.model, outputTokens: provider.outputTokens, store: false, stream: false })),
  };
  const ports: RemoteApplicationPorts = { authority, stores: () => ({ settings, source }), currentReference: () => source.getActiveReference(),
    checkWorkspace: async () => { checks++; await behavior.check(checks); return { status: "current", checkedAt: new Date().toISOString(), validationLimitations: ["filesystem reads are not atomic"] }; },
    now: () => clock, onTask: task => events.push(task.phase),
    ...(options.noPorts ? {} : { provider: { bodyDigest: (prepared: PreparedEvidencePackage, provider: RemoteProviderSettings) => behavior.digest(prepared, provider), dispatch: (input: { prepared: PreparedEvidencePackage; signal: AbortSignal }) => { count++; preparedInput = input.prepared; return behavior.dispatch(input.prepared, input.signal); } },
      credentials: { read: async () => ({ credential: "test-only-protocol-value", revision: authority.remote.provider().credentialRevision }) } }),
  };
  const app = new RemoteExplanationApplication(ports);
  if (options.configured !== false) app.saveProvider(0, { provider: "openai", model: "fixture-model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 });
  if (options.allowed !== false) app.saveAuthorization("repo", 0, true);
  const owner = randomUUID(); const context = app.commitTrustedContext(owner, { repositoryId: "repo", snapshotId: "snap" });
  const prepare = () => app.prepare({ repositoryId: "repo", snapshotId: "snap", contextHandle: context.contextHandle, purpose: "feature-explanation", query: "login" });
  const start = (preview: RemotePreview, taskId = randomUUID()) => app.start({ previewId: preview.previewId, packageId: preview.packageId, contextHandle: preview.contextHandle, taskId });
  const raw = new Database(options.legacy ? authorityPath : projectPath); handles.push(raw);
  return { root, app, ports, authority, settings, source, snap, context, owner, behavior, prepare, start, raw, authorityPath, projectPath, events,
    calls: () => count, input: () => preparedInput, checks: () => checks, setClock: (value: number) => { clock = value; } };
}
type Mutation = "authorization" | "provider" | "context" | "ignore" | "activation";
function mutate(f: ReturnType<typeof fixture>, kind: Mutation): void {
  const other = new GraphStore(kind === "ignore" || kind === "activation" ? f.projectPath : f.authorityPath, kind === "ignore" || kind === "activation" ? "project" : "global"); handles.push(other);
  if (kind === "authorization") other.remote.saveAuthorization("repo", 1, false);
  if (kind === "provider") other.remote.saveProvider(1, { provider: "openai", model: "other-model", credentialStatus: "configured", credentialRevision: 2, outputTokens: 32 });
  if (kind === "context") other.remote.commitTrustedContext(f.owner, null);
  if (kind === "ignore") other.saveIgnoreSettings("repo", 0, ["generated/**"]);
  if (kind === "activation") other.saveSnapshot(f.snap, [sourceFile]);
}

describe("remote application task core", () => {
  it.each([{ configured: false }, { allowed: false }, { noPorts: true }])("preview is zero network and start is closed by default %j", async options => {
    const f = fixture(options); const preview = await f.prepare(); expect(f.calls()).toBe(0);
    await expect(f.start(preview)).rejects.toThrow(); expect(f.calls()).toBe(0); expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 0 });
  });
  it("preview is isolated from caller mutation; full local unknown/partial preserved; SQL never saves snippets/keys/body", async () => {
    const f = fixture({ partial: true }); const preview = await f.prepare();
    expect(preview.evidencePackage.nodes.some(node => node.kind === "unresolved-call")).toBe(true); expect(preview.localUnknowns.length).toBeGreaterThan(0);
    preview.evidencePackage.proofs[0]!.snippet = "caller-mutated";
    const task = await f.start(preview); expect(task.phase).toBe("completed"); expect(f.calls()).toBe(1);
    const result = await f.app.result(task.identity.taskId, f.context.contextHandle);
    expect(result?.localUnknowns).toEqual(preview.localUnknowns); expect(result?.localLimitations.some(text => text.includes("partial"))).toBe(true);
    const saved = (f.raw.prepare("SELECT payload FROM remote_explanations").get() as { payload: string }).payload;
    for (const forbidden of ["snippet", "export function", "test-only-protocol-value", "caller-mutated", '"body"']) expect(saved).not.toContain(forbidden);
    expect(f.events).toEqual(["dispatched", "completed"]); expect(f.source.loadSnapshot("snap")).toEqual(f.snap);
    f.authority.discardFailedExplanation(task.identity, f.settings, f.source);
    expect(f.source.remote.result(task.identity.taskId)).toEqual(result);
  });
  it("unavailable credential status and failing credential reader both stay zero network", async () => {
    const f = fixture(); f.app.saveProvider(1, { provider: "openai", model: "model", credentialStatus: "unavailable", credentialRevision: 2, outputTokens: 32 });
    await expect(f.start(await f.prepare())).rejects.toThrow(expect.objectContaining({ code: "CREDENTIAL_UNAVAILABLE" })); expect(f.calls()).toBe(0);
    f.app.saveProvider(2, { provider: "openai", model: "model", credentialStatus: "configured", credentialRevision: 3, outputTokens: 32 });
    f.ports.credentials = { read: async () => { throw new Error("private credential exception"); } };
    await expect(f.start(await f.prepare())).rejects.toThrow(expect.objectContaining({ code: "CREDENTIAL_UNAVAILABLE", message: "远程解释未完成" })); expect(f.calls()).toBe(0);
  });
  it.each(["authorization", "provider", "context", "ignore", "activation"] as const)("second SQLite connection changes %s after precheck/before dispatch: zero network", async kind => {
    const f = fixture(); const preview = await f.prepare(); f.behavior.check = stage => { if (stage === 2) mutate(f, kind); };
    await expect(f.start(preview)).rejects.toThrow(); expect(f.calls()).toBe(0); expect(f.authority.remote.task(randomUUID())).toBeNull();
  });
  it.each(["authorization", "provider", "context", "ignore", "activation"] as const)("second SQLite connection changes %s after postcheck/before publish: no result", async kind => {
    const f = fixture(); const preview = await f.prepare(); f.behavior.check = stage => { if (stage === 3) mutate(f, kind); };
    const task = await f.start(preview); expect(task.phase).not.toBe("completed"); expect(f.calls()).toBe(1);
    expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 0 });
    expect(f.events).toHaveLength(2); expect(f.events[1]).not.toBe("completed");
  });
  it("network await holds no DB locks; earlier permitted dispatch cannot be recalled; revoked response is discarded", async () => {
    const f = fixture(); let deliver: ((value: unknown) => void) | undefined;
    f.behavior.dispatch = () => new Promise(resolve => { deliver = resolve; });
    const preview = await f.prepare(); const completion = f.start(preview);
    await vi.waitFor(() => expect(f.calls()).toBe(1)); mutate(f, "authorization");
    expect(f.authority.remote.authorization("repo").status).toBe("denied"); deliver!(narrative(f.input()!));
    const task = await completion; expect(task.code).toBe("CONSENT_REVOKED"); expect(f.calls()).toBe(1); expect(f.source.remote.result(task.identity.taskId)).toBeNull();
  });
  it("cancel aborts a hanging provider, produces one terminal, and late completion cannot append", async () => {
    const f = fixture(); let deliver: ((value: unknown) => void) | undefined; let signal: AbortSignal | undefined;
    f.behavior.dispatch = (_pack, supplied) => { signal = supplied; return new Promise(resolve => { deliver = resolve; }); };
    const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id);
    await vi.waitFor(() => expect(f.calls()).toBe(1)); expect(f.app.cancel({ taskId: id, contextHandle: preview.contextHandle }).phase).toBe("cancelled");
    expect(signal!.aborted).toBe(true); expect((await completion).phase).toBe("cancelled"); deliver!(narrative(f.input()!)); await Promise.resolve();
    expect(f.source.remote.result(id)).toBeNull(); expect(f.events).toEqual(["dispatched", "cancelled"]);
    expect(f.app.cancel({ taskId: id, contextHandle: preview.contextHandle }).phase).toBe("cancelled");
  });
  it.each(["resolve", "reject", "malformed"] as const)("cancel credential preflight once and ignore late %s without dispatch/parsing", async outcome => {
    const f = fixture(); let entered = false; let deliver: ((value: { credential: string; revision: number }) => void) | undefined; let reject: ((error: Error) => void) | undefined;
    const stalled = new Promise<{ credential: string; revision: number }>((resolve, rejectPromise) => { deliver = resolve; reject = rejectPromise; });
    f.ports.credentials = { read: () => { entered = true; return stalled; } }; const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id);
    await vi.waitFor(() => expect(entered).toBe(true)); expect(f.app.status(id, preview.contextHandle)?.phase).toBe("preparing"); expect(f.authority.remote.task(id)).toBeNull();
    const cancelled = f.app.cancel({ taskId: id, contextHandle: preview.contextHandle }); expect(f.app.cancel({ taskId: id, contextHandle: preview.contextHandle })).toEqual(cancelled);
    expect(await completion).toEqual(cancelled); const getter = vi.fn(() => { throw new Error("private late credential"); });
    if (outcome === "resolve") deliver!({ credential: "test-only-protocol-value", revision: 1 });
    if (outcome === "reject") reject!(new Error("private late credential failure"));
    if (outcome === "malformed") deliver!({ get credential() { return getter(); }, revision: 1 });
    await Promise.resolve(); await Promise.resolve(); expect(getter).not.toHaveBeenCalled(); expect(f.calls()).toBe(0); expect(f.events).toEqual(["cancelled"]);
    expect(f.source.remote.result(id)).toBeNull(); expect(f.app.cancel({ taskId: id, contextHandle: preview.contextHandle })).toEqual(cancelled);
    await expect(f.start(await f.prepare(), id)).rejects.toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
  });
  it.each(["resolve", "reject", "malformed"] as const)("cancel workspace preflight once and ignore late %s without dispatch/parsing", async outcome => {
    const f = fixture(); type Check = Awaited<ReturnType<RemoteApplicationPorts["checkWorkspace"]>>;
    let entered = false; let deliver: ((value: Check) => void) | undefined; let reject: ((error: Error) => void) | undefined;
    const stalled = new Promise<Check>((resolve, rejectPromise) => { deliver = resolve; reject = rejectPromise; });
    const original = f.ports.checkWorkspace; let checks = 0;
    f.ports.checkWorkspace = (ref, signal) => { checks++; if (checks === 2) { entered = true; return stalled; } return original(ref, signal); };
    const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id); await vi.waitFor(() => expect(entered).toBe(true));
    expect(f.app.status(id, preview.contextHandle)?.phase).toBe("preparing"); const cancelled = f.app.cancel({ taskId: id, contextHandle: preview.contextHandle });
    expect(await completion).toEqual(cancelled); const getter = vi.fn(() => { throw new Error("private late source validation"); });
    if (outcome === "resolve") deliver!({ status: "current", checkedAt: new Date().toISOString(), validationLimitations: ["filesystem reads are not atomic"] });
    if (outcome === "reject") reject!(new Error("private late workspace failure"));
    if (outcome === "malformed") deliver!({ get status() { return getter(); }, checkedAt: new Date().toISOString(), validationLimitations: [] });
    await Promise.resolve(); await Promise.resolve(); expect(getter).not.toHaveBeenCalled(); expect(f.calls()).toBe(0); expect(f.events).toEqual(["cancelled"]); expect(f.source.remote.result(id)).toBeNull();
  });
  it("preflight cancellation rejects another owner, stale handle and unknown UUID without stopping the other owner", async () => {
    const f = fixture(); let readCount = 0; let deliver: ((value: { credential: string; revision: number }) => void) | undefined;
    const stalled = new Promise<{ credential: string; revision: number }>(resolve => { deliver = resolve; });
    f.ports.credentials = { read: () => ++readCount === 1 ? stalled : Promise.resolve({ credential: "test-only-protocol-value", revision: 1 }) };
    const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id); await vi.waitFor(() => expect(readCount).toBe(1));
    const other = f.app.commitTrustedContext(randomUUID(), { repositoryId: "repo", snapshotId: "snap" });
    expect(() => f.app.cancel({ taskId: id, contextHandle: other.contextHandle })).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" }));
    expect(() => f.app.status(id, other.contextHandle)).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" }));
    expect(() => f.app.cancel({ taskId: randomUUID(), contextHandle: preview.contextHandle })).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" }));
    expect(f.app.status(id, preview.contextHandle)?.phase).toBe("preparing"); f.app.cancel({ taskId: id, contextHandle: preview.contextHandle }); expect((await completion).phase).toBe("cancelled");
    const otherPreview = await f.app.prepare({ repositoryId: "repo", snapshotId: "snap", purpose: "feature-explanation", query: "login", contextHandle: other.contextHandle });
    expect((await f.start(otherPreview)).phase).toBe("completed"); expect(f.calls()).toBe(1); deliver!({ credential: "test-only-protocol-value", revision: 1 });
    f.app.commitTrustedContext(f.owner, null);
    expect(() => f.app.cancel({ taskId: id, contextHandle: preview.contextHandle })).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" }));
    expect(f.calls()).toBe(1);
  });
  it("reentrant cancellation observes an already rejected credential promise, never dispatches", async () => {
    const f = fixture(); const preview = await f.prepare(); const id = randomUUID();
    f.ports.credentials = { read: () => { f.app.cancel({ taskId: id, contextHandle: preview.contextHandle }); return Promise.reject(new Error("private rejection after synchronous cancel")); } };
    expect((await f.start(preview, id)).phase).toBe("cancelled"); expect(f.calls()).toBe(0); expect(f.events).toEqual(["cancelled"]);
  });
  it("cancellation-log failure still stops the validated local preflight without pretending a terminal committed", async () => {
    const f = fixture(); let entered = false; let deliver: ((value: { credential: string; revision: number }) => void) | undefined;
    const stalled = new Promise<{ credential: string; revision: number }>(resolve => { deliver = resolve; });
    f.ports.credentials = { read: () => { entered = true; return stalled; } }; const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id);
    const rejected = expect(completion).rejects.toThrow(expect.objectContaining({ code: "CANCELLED" })); await vi.waitFor(() => expect(entered).toBe(true));
    const db = new Database(f.authorityPath); handles.push(db); db.exec("CREATE TRIGGER deny_cancel BEFORE INSERT ON explanation_tasks BEGIN SELECT RAISE(ABORT,'private cancel-log failure'); END");
    expect(() => f.app.cancel({ taskId: id, contextHandle: preview.contextHandle })).toThrow(expect.objectContaining({ code: "POLICY_INVALID" }));
    await rejected; deliver!({ credential: "test-only-protocol-value", revision: 1 }); await Promise.resolve(); expect(f.calls()).toBe(0); expect(f.authority.remote.task(id)).toBeNull(); expect(f.events).toEqual([]);
  });
  it("globally busy across owners/connections, retains lease after revoke until pending request exits", async () => {
    const f = fixture(); let deliver: ((value: unknown) => void) | undefined;
    f.behavior.dispatch = () => new Promise(resolve => { deliver = resolve; });
    const firstPreview = await f.prepare(); const firstId = randomUUID(); const first = f.start(firstPreview, firstId);
    await vi.waitFor(() => expect(f.calls()).toBe(1));
    const otherAuthority = new GraphStore(f.authorityPath, "global"); handles.push(otherAuthority);
    const other = new RemoteExplanationApplication({ ...f.ports, authority: otherAuthority });
    const context = other.commitTrustedContext(randomUUID(), { repositoryId: "repo", snapshotId: "snap" });
    const preview = await other.prepare({ repositoryId: "repo", snapshotId: "snap", query: "login", purpose: "feature-explanation", contextHandle: context.contextHandle });
    await expect(other.start({ previewId: preview.previewId, packageId: preview.packageId, contextHandle: context.contextHandle, taskId: randomUUID() })).rejects.toThrow(expect.objectContaining({ code: "BUSY" }));
    expect(f.calls()).toBe(1); mutate(f, "authorization");
    // A revoked policy cannot send, and the already-permitted request still owns the lease.
    otherAuthority.remote.saveAuthorization("repo", 2, true);
    expect(() => otherAuthority.remote.immediate(() => otherAuthority.remote.registerDispatch({ ...f.authority.remote.task(firstId)!.identity, authorizationRevision: 3, taskId: randomUUID() }))).toThrow(expect.objectContaining({ code: "BUSY" }));
    deliver!(narrative(f.input()!)); await first;
  });
  it("preview is consumed once and response completion cannot be replayed under the same taskId", async () => {
    const f = fixture(); const preview = await f.prepare(); const id = randomUUID(); const task = await f.start(preview, id); expect(task.phase).toBe("completed");
    await expect(f.start(preview, id)).rejects.toThrow();
    const next = await f.prepare(); await expect(f.start(next, id)).rejects.toThrow();
    expect(f.calls()).toBe(1); expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 1 });
  });
  it("body or package changes require a new preview; grant does not dispatch or reuse denied preview", async () => {
    const f = fixture({ allowed: false }); const denied = await f.prepare(); f.app.saveAuthorization("repo", 0, true);
    await expect(f.start(denied)).rejects.toThrow(); expect(f.calls()).toBe(0);
    const preview = await f.prepare(); f.behavior.digest = () => hash("changed actual fixture body");
    await expect(f.start(preview)).rejects.toThrow(expect.objectContaining({ code: "PREVIEW_EXPIRED" })); expect(f.calls()).toBe(0);
  });
  it("one preview per owner, expiration and stale handles cannot send", async () => {
    const f = fixture(); const first = await f.prepare(); const second = await f.prepare();
    await expect(f.start(first)).rejects.toThrow(expect.objectContaining({ code: "PREVIEW_EXPIRED" }));
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(second.expiresAt) + 1);
    await expect(f.start(second)).rejects.toThrow(expect.objectContaining({ code: "PREVIEW_EXPIRED" })); expect(f.calls()).toBe(0);
  });
  it("busy authority context commit keeps caller closed, does not reuse old current/preview", async () => {
    const f = fixture(); const preview = await f.prepare(); const db = new Database(f.authorityPath); handles.push(db); db.exec("BEGIN IMMEDIATE");
    try { expect(() => f.app.commitTrustedContext(f.owner, null)).toThrow(expect.objectContaining({ code: "BUSY" })); }
    finally { db.exec("ROLLBACK"); }
    await expect(f.start(preview)).rejects.toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED" })); await expect(f.prepare()).rejects.toThrow(); expect(f.calls()).toBe(0);
    expect(f.app.commitTrustedContext(f.owner, null).active).toBe(false);
  });
  it("async provider errors and hostile exception messages never enter SQL/events", async () => {
    const f = fixture(); f.behavior.dispatch = () => Promise.reject(Object.assign(new RemoteExplanationError("AUTH_REJECTED"), { message: "private-source-and-key" }));
    const preview = await f.prepare(); const task = await f.start(preview); expect(task.code).toBe("AUTH_REJECTED");
    const db = new Database(f.authorityPath); handles.push(db); expect(JSON.stringify(db.prepare("SELECT payload FROM explanation_tasks").all())).not.toContain("private-source-and-key");
    expect(f.source.remote.result(task.identity.taskId)).toBeNull(); expect(f.calls()).toBe(1);
  });
  it("wrong citations or a verified narrative fail as one response, without a result", async () => {
    const f = fixture(); f.behavior.dispatch = async prepared => ({ ...narrative(prepared), claims: [{ text: "wrong", confidence: "verified", evidenceIds: ["outside"] }] });
    const preview = await f.prepare(); const task = await f.start(preview); expect(task.code).toBe("INVALID_RESPONSE"); expect(f.source.remote.result(task.identity.taskId)).toBeNull(); expect(f.calls()).toBe(1);
  });
  it("a structurally valid narrative echoing the configured credential is never persisted", async () => {
    const f = fixture(); f.behavior.dispatch = async prepared => ({ ...narrative(prepared), claims: [{ ...narrative(prepared).claims[0], text: "echo test-only-protocol-value" }] });
    const task = await f.start(await f.prepare()); expect(task.code).toBe("INVALID_RESPONSE"); expect(f.source.remote.result(task.identity.taskId)).toBeNull();
    const db = new Database(f.authorityPath); handles.push(db); expect(JSON.stringify(db.prepare("SELECT payload FROM explanation_tasks").all())).not.toContain("test-only-protocol-value");
  });
  it("startup recovery interrupts a pending task without retry and rejects its late response", async () => {
    const f = fixture(); let deliver: ((value: unknown) => void) | undefined; f.behavior.dispatch = () => new Promise(resolve => { deliver = resolve; });
    const preview = await f.prepare(); const completion = f.start(preview); await vi.waitFor(() => expect(f.calls()).toBe(1));
    f.app.recoverInterruptedTasks(); const task = await completion; expect(task.phase).toBe("interrupted");
    deliver!(narrative(f.input()!)); await Promise.resolve(); expect(f.calls()).toBe(1); expect(f.source.remote.result(task.identity.taskId)).toBeNull();
  });
  it("context change aborts a preparation whose source check is stalled, zero network", async () => {
    const f = fixture(); f.behavior.check = () => new Promise(() => undefined);
    const preparation = f.prepare(); const rejected = expect(preparation).rejects.toThrow(expect.objectContaining({ code: "CANCELLED" }));
    await Promise.resolve(); f.app.commitTrustedContext(f.owner, null); await rejected; expect(f.calls()).toBe(0);
  });
  it("timeout bounds a provider that ignores abort and never retries", async () => {
    const f = fixture(); f.behavior.dispatch = () => new Promise(() => undefined);
    vi.useFakeTimers(); const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id);
    await vi.advanceTimersByTimeAsync(0); expect(f.calls()).toBe(1);
    f.setClock(90001); await vi.advanceTimersByTimeAsync(90001);
    const task = await completion; expect(task.code).toBe("TIMEOUT"); expect(f.calls()).toBe(1); expect(f.source.remote.result(id)).toBeNull();
  });
  it("permission log insertion failure refuses dispatch with fixed error", async () => {
    const f = fixture(); const preview = await f.prepare(); const db = new Database(f.authorityPath); handles.push(db);
    db.exec("CREATE TRIGGER deny_task BEFORE INSERT ON explanation_tasks BEGIN SELECT RAISE(ABORT,'private-source-and-key'); END");
    await expect(f.start(preview)).rejects.toThrow(expect.objectContaining({ code: "POLICY_INVALID", message: "远程解释未完成" }));
    expect(f.calls()).toBe(0); expect(db.prepare("SELECT count(*) count FROM explanation_tasks").get()).toEqual({ count: 0 });
  });
  it("permission log COMMIT failure after permitted dispatch aborts once, no log/result or retry", async () => {
    const f = fixture(); const preview = await f.prepare(); const db = new Database(f.authorityPath); handles.push(db);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.exec("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_guard(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER deny_commit AFTER INSERT ON explanation_tasks BEGIN INSERT INTO commit_guard VALUES(1); END");
    let signal: AbortSignal | undefined; f.behavior.dispatch = (_prepared, value) => { signal = value; return Promise.resolve(narrative(_prepared)); };
    await expect(f.start(preview)).rejects.toThrow(expect.objectContaining({ code: "POLICY_INVALID", message: "远程解释未完成" }));
    expect(f.calls()).toBe(1); expect(signal!.aborted).toBe(true); expect(db.prepare("SELECT count(*) count FROM explanation_tasks").get()).toEqual({ count: 0 });
    expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 0 }); expect(f.events).toEqual([]);
  });
  it("result insertion failure rolls back and saves only a fixed terminal diagnostic", async () => {
    const f = fixture(); const preview = await f.prepare(); f.raw.exec("CREATE TRIGGER deny_result BEFORE INSERT ON remote_explanations BEGIN SELECT RAISE(ABORT,'private-source-and-key'); END");
    const task = await f.start(preview); expect(task.code).toBe("POLICY_INVALID"); expect(task.phase).toBe("failed");
    expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 0 }); expect(f.source.loadSnapshot("snap")).toEqual(f.snap);
  });
  it("authority terminal COMMIT failure after project result commit leaves no unpublished result", async () => {
    const f = fixture(); const preview = await f.prepare(); const db = new Database(f.authorityPath); handles.push(db);
    db.exec("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_guard(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER deny_terminal_commit AFTER UPDATE OF phase ON explanation_tasks WHEN NEW.phase='completed' BEGIN INSERT INTO commit_guard VALUES(1); END");
    const task = await f.start(preview); expect(task.code).toBe("POLICY_INVALID"); expect(task.phase).toBe("failed");
    expect(await f.app.result(task.identity.taskId, f.context.contextHandle)).toBeNull();
    expect(f.raw.prepare("SELECT count(*) count FROM remote_explanations").get()).toEqual({ count: 0 });
    expect(f.source.loadSnapshot("snap")).toEqual(f.snap); expect(f.events).toEqual(["dispatched", "failed"]); expect(f.calls()).toBe(1);
  });
  it("restart retains but cannot return a project-committed/unpublished result; explicit cleanup matches only failed identity", async () => {
    const f = fixture(); f.behavior.dispatch = () => new Promise(() => undefined); const preview = await f.prepare(); const id = randomUUID(); const completion = f.start(preview, id);
    await vi.waitFor(() => expect(f.calls()).toBe(1)); const original = f.authority.remote.task(id)!;
    // Inject the exact persistent crash cut: result DB committed, authority still dispatched.
    // No production fault switch and no claim of having killed a real desktop worker.
    f.source.remote.immediate(() => f.source.remote.appendResult(stagedResult(original, f.input()!)));
    const authority = new GraphStore(f.authorityPath, "global"), source = new GraphStore(f.projectPath, "project"); handles.push(authority, source);
    const restarted = new RemoteExplanationApplication({ ...f.ports, authority, stores: () => ({ settings: source, source }), currentReference: () => source.getActiveReference() });
    restarted.recoverInterruptedTasks(); f.app.recoverInterruptedTasks(); expect((await completion).phase).toBe("interrupted");
    const context = restarted.commitTrustedContext(f.owner, { repositoryId: "repo", snapshotId: "snap" });
    expect(await restarted.result(id, context.contextHandle)).toBeNull(); expect(source.remote.result(id)).not.toBeNull(); expect(f.calls()).toBe(1);
    const fresh = await restarted.prepare({ repositoryId: "repo", snapshotId: "snap", contextHandle: context.contextHandle, purpose: "feature-explanation", query: "login" });
    await expect(restarted.start({ taskId: id, previewId: fresh.previewId, packageId: fresh.packageId, contextHandle: context.contextHandle })).rejects.toThrow(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    f.behavior.dispatch = prepared => Promise.resolve(narrative(prepared)); const next = await restarted.start({ taskId: randomUUID(), previewId: fresh.previewId, packageId: fresh.packageId, contextHandle: context.contextHandle });
    expect(next.phase).toBe("completed"); expect(f.calls()).toBe(2); // second explicit start, not a recovery retry
    authority.discardFailedExplanation(original.identity, source, source);
    expect(source.remote.result(id)).toBeNull(); expect(source.remote.result(next.identity.taskId)).not.toBeNull(); expect(source.readSnapshotSource("snap", "a.ts")?.content).toBe(content);
  });
  it("finish BUSY preserves its fixed error and closed lease; finally never releases an unclean task", async () => {
    const f = fixture(); f.behavior.dispatch = () => Promise.reject(new RemoteExplanationError("TIMEOUT")); const preview = await f.prepare(); const id = randomUUID();
    const finish = vi.spyOn(f.authority.remote, "finish").mockImplementation(() => { throw new RemoteExplanationError("BUSY"); });
    const release = vi.spyOn(f.authority.remote, "releaseDispatch").mockImplementation(() => { throw new RemoteExplanationError("AUTH_REJECTED"); });
    await expect(f.start(preview, id)).rejects.toThrow(expect.objectContaining({ code: "BUSY", message: "远程解释未完成" })); expect(release).not.toHaveBeenCalled();
    expect(f.authority.remote.task(id)?.phase).toBe("dispatched"); expect(f.events).toEqual(["dispatched"]); expect(f.source.remote.result(id)).toBeNull();
    finish.mockRestore(); release.mockRestore(); f.app.recoverInterruptedTasks(); expect(f.authority.remote.task(id)?.phase).toBe("interrupted"); expect(f.calls()).toBe(1);
  });
  it("discard BUSY leaves failed artifact closed and lease occupied until explicit recovery/cleanup", async () => {
    const f = fixture(); const preview = await f.prepare(); const id = randomUUID(); const db = new Database(f.authorityPath); handles.push(db);
    db.exec("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE commit_guard(id INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER deny_terminal_commit AFTER UPDATE OF phase ON explanation_tasks WHEN NEW.phase='completed' BEGIN INSERT INTO commit_guard VALUES(1); END");
    const discard = vi.spyOn(f.authority, "discardFailedExplanation").mockImplementation(() => { throw new RemoteExplanationError("BUSY"); });
    const release = vi.spyOn(f.authority.remote, "releaseDispatch").mockImplementation(() => { throw new RemoteExplanationError("AUTH_REJECTED"); });
    await expect(f.start(preview, id)).rejects.toThrow(expect.objectContaining({ code: "BUSY" })); expect(release).not.toHaveBeenCalled();
    expect(f.authority.remote.task(id)?.phase).toBe("failed"); expect(f.source.remote.result(id)).not.toBeNull(); expect(await f.app.result(id, preview.contextHandle)).toBeNull(); expect(f.events).toEqual(["dispatched"]);
    await expect(f.start(await f.prepare())).rejects.toThrow(expect.objectContaining({ code: "BUSY" })); expect(f.calls()).toBe(1);
    discard.mockRestore(); release.mockRestore(); f.app.recoverInterruptedTasks();
    expect(f.source.remote.result(id)).not.toBeNull(); f.authority.discardFailedExplanation(f.authority.remote.task(id)!.identity, f.settings, f.source);
    expect(f.source.remote.result(id)).toBeNull(); expect(f.calls()).toBe(1); expect(f.source.loadSnapshot("snap")).toEqual(f.snap);
  });
  it("release failure cannot mask the original terminal error or emit a success", async () => {
    const f = fixture(); f.behavior.dispatch = () => Promise.reject(new RemoteExplanationError("TIMEOUT")); const preview = await f.prepare(); const id = randomUUID();
    const release = vi.spyOn(f.authority.remote, "releaseDispatch").mockImplementation(() => { throw new RemoteExplanationError("BUSY"); });
    await expect(f.start(preview, id)).rejects.toThrow(expect.objectContaining({ code: "TIMEOUT" })); expect(f.authority.remote.task(id)?.code).toBe("TIMEOUT"); expect(f.events).toEqual(["dispatched"]);
    release.mockRestore(); f.app.recoverInterruptedTasks(); expect(f.calls()).toBe(1); expect(f.source.remote.result(id)).toBeNull();
  });
  it("same-length immutable source tampering after validation is caught under publish lock", async () => {
    const f = fixture(); const preview = await f.prepare(); f.behavior.check = stage => { if (stage === 3) f.raw.prepare("UPDATE source_snapshots SET content=? WHERE snapshot_id='snap'").run(content.replace("return 1", "return 9")); };
    const task = await f.start(preview); expect(task.phase).toBe("failed"); expect(f.source.remote.result(task.identity.taskId)).toBeNull();
  });
  it("legacy publication retains old source and append-only result across reopen", async () => {
    const f = fixture({ legacy: true }); const preview = await f.prepare(); const task = await f.start(preview); expect(task.phase).toBe("completed");
    const reopened = new GraphStore(f.authorityPath, "global"); handles.push(reopened); expect(reopened.remote.result(task.identity.taskId)?.narrative.claims).toHaveLength(1);
    expect(reopened.loadSnapshot("snap")?.createdAt).toBe(f.snap.createdAt); expect(reopened.readSnapshotSource("snap", "a.ts")?.content).toBe(content);
    expect(() => reopened.remote.immediate(() => reopened.remote.appendResult(f.source.remote.result(task.identity.taskId)!))).toThrow();
  });
  it("A→B→A of same source reactivation and worker restart never revive old context or task", async () => {
    const f = fixture(); const preview = await f.prepare(); const b = snapshot("b"); f.source.saveSnapshot(b, [sourceFile]);
    f.app.commitTrustedContext(f.owner, { repositoryId: "repo", snapshotId: "b" }); f.source.saveSnapshot(f.snap, [sourceFile]);
    const current = f.app.commitTrustedContext(f.owner, { repositoryId: "repo", snapshotId: "snap" }); expect(current.epoch).toBeGreaterThan(f.context.epoch);
    const reopenedAuthority = new GraphStore(f.authorityPath, "global"), reopenedSource = new GraphStore(f.projectPath, "project"); handles.push(reopenedAuthority, reopenedSource);
    const restarted = new RemoteExplanationApplication({ ...f.ports, authority: reopenedAuthority, stores: () => ({ settings: reopenedSource, source: reopenedSource }), currentReference: () => reopenedSource.getActiveReference() });
    restarted.recoverInterruptedTasks(); await expect(restarted.start({ taskId: randomUUID(), previewId: preview.previewId, packageId: preview.packageId, contextHandle: preview.contextHandle })).rejects.toThrow();
    await expect(restarted.prepare({ repositoryId: "repo", snapshotId: "snap", purpose: "feature-explanation", query: "login", contextHandle: current.contextHandle })).rejects.toThrow();
    const reopenedContext = restarted.commitTrustedContext(randomUUID(), { repositoryId: "repo", snapshotId: "snap" });
    expect((await restarted.prepare({ repositoryId: "repo", snapshotId: "snap", purpose: "feature-explanation", query: "login", contextHandle: reopenedContext.contextHandle })).packageId).toBe(preview.packageId);
    expect(f.calls()).toBe(0);
  });
  it("bounded 80-node query selects <=320 input proofs and discloses omitted duplicate-span candidates", async () => {
    const f = fixture(); const targetNames = Array.from({ length: 79 }, (_, index) => `n${index + 1}`);
    const lines = [`export function entry(){ ${targetNames.map(name => `${name}();`).join(" ")} }`, ...targetNames.map(name => `function ${name}(){ return 1 }`)];
    const content = lines.join("\n"); const manifest = { filePath: "a.ts", contentHash: hash(content), language: "TypeScript", bytes: Buffer.byteLength(content) };
    const names = ["entry", ...targetNames]; const value: ProjectSnapshot = { ...f.snap, snapshotId: "wide", sourceFiles: [manifest],
      nodes: names.map((name, index) => ({ id: name, snapshotId: "wide", kind: "function", name, qualifiedName: name, filePath: "a.ts", span: { filePath: "a.ts", startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: lines[index]!.length }, metadata: {} })),
      edges: targetNames.map(name => ({ id: `edge-${name}`, snapshotId: "wide", source: "entry", target: name, kind: "CALLS", evidenceId: `call-${name}`, confidence: "verified", reason: "direct call" })),
      evidence: [...names.flatMap((name, index) => Array.from({ length: 8 }, (_, variant) => ({ id: `proof-${name}-${variant}`, snapshotId: "wide", analyzer: "test", analyzerVersion: "1", kind: "symbol-definition", confidence: "verified" as const, reason: `definition observation ${variant}`, span: { filePath: "a.ts", startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: lines[index]!.length } }))),
        ...targetNames.map(name => ({ id: `call-${name}`, snapshotId: "wide", analyzer: "test", analyzerVersion: "1", kind: "call-expression", confidence: "verified" as const, reason: "call", span: { filePath: "a.ts", startLine: 1, startColumn: lines[0]!.indexOf(`${name}()`), endLine: 1, endColumn: lines[0]!.indexOf(`${name}()`) + name.length + 2 } }))],
    };
    value.analysisIdentity = { ...value.analysisIdentity, sourceFingerprint: manifest.contentHash }; value.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: hash(canonicalSnapshotResult(value)) };
    f.source.saveSnapshot(value, [{ ...manifest, content }]); const context = f.app.commitTrustedContext(f.owner, { repositoryId: "repo", snapshotId: "wide" });
    const preview = await f.app.prepare({ repositoryId: "repo", snapshotId: "wide", purpose: "feature-explanation", query: "entry", contextHandle: context.contextHandle });
    expect(preview.localLimitations.some(text => text.includes("同范围证据") && text.includes("2"))).toBe(true);
    expect(preview.evidencePackage.proofs.length).toBeLessThanOrEqual(24); const ids = new Set(preview.evidencePackage.nodes.map(node => node.id));
    expect(preview.evidencePackage.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true); expect(f.calls()).toBe(0);
  });
  it.each(["credentials", "workspace"] as const)("real indexed start can be cancelled while waiting for %s before dispatch", async waiting => {
    const root = mkdtempSync(join(tmpdir(), "xray-preflight-cancel-")); roots.push(root); const project = join(root, "code"); mkdirSync(project);
    writeFileSync(join(project, "a.ts"), "export function login(){ return 1 }\n");
    const authorityPath = join(root, "global.sqlite");
    const app = new XRayApplication({ databasePath: authorityPath, projectDatabaseRoot: join(root, "projects"), cacheRoot: join(root, "cache") }); handles.push(app);
    const snap = await app.indexProject(project); const ref = { repositoryId: snap.repositoryId, snapshotId: snap.snapshotId }; const state = await app.getSnapshotState(ref);
    let readEntered = false, checkEntered = false, calls = 0; let releaseCredential: ((value: { credential: string; revision: number }) => void) | undefined;
    let releaseState: ((value: typeof state) => void) | undefined; const credentialWait = new Promise<{ credential: string; revision: number }>(resolve => { releaseCredential = resolve; });
    const stateWait = new Promise<typeof state>(resolve => { releaseState = resolve; }); const original = app.getSnapshotState.bind(app); let checks = 0;
    if (waiting === "workspace") vi.spyOn(app, "getSnapshotState").mockImplementation(input => { checks++; if (checks === 2) { checkEntered = true; return stateWait; } return original(input); });
    const remote = app.createRemoteExplanations({ provider: { bodyDigest: prepared => hash(canonicalJson(prepared.evidencePackage)), dispatch: async input => { calls++; return narrative(input.prepared); } },
      credentials: { read: () => { readEntered = true; return waiting === "credentials" ? credentialWait : Promise.resolve({ credential: "fixture-only", revision: 1 }); } } });
    remote.saveProvider(0, { provider: "openai", model: "fixture-model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 }); remote.saveAuthorization(ref.repositoryId, 0, true);
    const context = remote.commitTrustedContext(randomUUID(), ref); const preview = await remote.prepare({ ...ref, query: "login", purpose: "feature-explanation", contextHandle: context.contextHandle });
    const id = randomUUID(); const completion = remote.start({ taskId: id, previewId: preview.previewId, packageId: preview.packageId, contextHandle: context.contextHandle });
    await vi.waitFor(() => expect(waiting === "credentials" ? readEntered : checkEntered).toBe(true));
    let cancelled: unknown;
    try { cancelled = remote.cancel({ taskId: id, contextHandle: context.contextHandle }); } catch (error) { cancelled = error; }
    releaseCredential!({ credential: "fixture-only", revision: 1 }); releaseState!(state);
    const terminal = await completion;
    expect(cancelled).toMatchObject({ phase: "cancelled", code: "CANCELLED" }); expect(terminal.phase).toBe("cancelled"); expect(calls).toBe(0);
    const db = new Database(authorityPath); handles.push(db); expect(db.prepare("SELECT phase,inflight FROM explanation_tasks WHERE task_id=?").get(id)).toEqual({ phase: "cancelled", inflight: 0 });
    expect(await remote.result(id, context.contextHandle)).toBeNull();
  });
  it("real application default ports preserve offline indexing and never send; actual saved-source preview", async () => {
    const root = mkdtempSync(join(tmpdir(), "xray-default-remote-")); roots.push(root); const project = join(root, "code"); mkdirSync(project);
    writeFileSync(join(project, "a.ts"), "export function login(){ return target() }\nfunction target(){return 1}\n");
    const app = new XRayApplication({ databasePath: join(root, "global.sqlite"), projectDatabaseRoot: join(root, "projects"), cacheRoot: join(root, "cache") }); handles.push(app);
    const snap = await app.indexProject(project); const ref = { repositoryId: snap.repositoryId, snapshotId: snap.snapshotId };
    const remote = app.createRemoteExplanations(); const context = remote.commitTrustedContext(randomUUID(), ref);
    const preview = await remote.prepare({ ...ref, query: "login", purpose: "feature-explanation", contextHandle: context.contextHandle });
    expect(preview.bodyDigest).toBeNull(); expect(preview.authorization.status).toBe("denied"); expect(preview.provider.credentialStatus).toBe("unconfigured");
    await expect(remote.start({ taskId: randomUUID(), previewId: preview.previewId, packageId: preview.packageId, contextHandle: context.contextHandle })).rejects.toThrow();
    expect((await app.explainFeature(ref, "login")).steps.length).toBeGreaterThan(0);
  });
  it.each(["before-start", "during-request", "unchanged"] as const)("real saved snapshot and workspace freshness, injected protocol only: %s", async change => {
    const root = mkdtempSync(join(tmpdir(), "xray-source-remote-")); roots.push(root); const project = join(root, "code"); mkdirSync(project);
    const path = join(project, "a.ts"); writeFileSync(path, "export function login(){ return target() }\nfunction target(){ return 1 }\n");
    const app = new XRayApplication({ databasePath: join(root, "global.sqlite"), projectDatabaseRoot: join(root, "projects"), cacheRoot: join(root, "cache") }); handles.push(app);
    const snap = await app.indexProject(project); const ref = { repositoryId: snap.repositoryId, snapshotId: snap.snapshotId }; let calls = 0;
    const remote = app.createRemoteExplanations({ provider: { bodyDigest: prepared => hash(canonicalJson(prepared.evidencePackage)), dispatch: async input => {
      calls++; if (change === "during-request") writeFileSync(path, "export function login(){ return 9 }\n"); return narrative(input.prepared);
    } }, credentials: { read: async () => ({ credential: "fixture-only", revision: 1 }) } });
    remote.saveProvider(0, { provider: "openai", model: "fixture-model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 32 }); remote.saveAuthorization(ref.repositoryId, 0, true);
    const context = remote.commitTrustedContext(randomUUID(), ref); const preview = await remote.prepare({ ...ref, query: "login", purpose: "feature-explanation", contextHandle: context.contextHandle });
    const request = { taskId: randomUUID(), previewId: preview.previewId, packageId: preview.packageId, contextHandle: context.contextHandle };
    if (change === "before-start") { writeFileSync(path, "export function login(){ return 9 }\n"); await expect(remote.start(request)).rejects.toThrow(expect.objectContaining({ code: "SNAPSHOT_NOT_CURRENT" })); expect(calls).toBe(0); }
    else {
      const task = await remote.start(request); expect(calls).toBe(1);
      if (change === "during-request") { expect(task.code).toBe("SNAPSHOT_NOT_CURRENT"); expect(await remote.result(task.identity.taskId, context.contextHandle)).toBeNull(); }
      else { expect(task.phase).toBe("completed"); expect((await remote.result(task.identity.taskId, context.contextHandle))?.citations.length).toBeGreaterThan(0); }
    }
  });
});
