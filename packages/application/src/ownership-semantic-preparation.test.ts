import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, canonicalSnapshotResult, computeOwnershipAttemptHash, computeOwnershipCapsuleHash, hashOwnershipAnswer, OWNERSHIP_SEMANTIC_POLICY_CATEGORIES, type OwnershipQuestion, type OwnershipSubmission, type OwnershipSemanticPrepareRequest } from "@project-xray/contracts";
import { GraphStore, SEMANTIC_PREPARATION_TIMEOUT_MS, type OwnershipSemanticTrustedPorts, type PreparedSemanticBinding, type SemanticRevisionReceipt } from "@project-xray/graph";
import { createOwnershipQuestionGeneratorPort } from "@project-xray/ownership";
import * as llm from "@project-xray/llm";
import { XRayApplication } from "./index.js";

interface Raw { prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new(path: string) => Raw;
const handles = new Set<{ close(): void }>(), roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const h of handles) h.close(); handles.clear(); for (const p of roots.splice(0)) { if (!resolve(p).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe cleanup"); await rm(p, { recursive: true, force: true }); } });
const code = 'export let token = 0;\nexport function flow() {\n token = 1;\n return token;\n}\nexport function leaf() { return 42; }\nexport function middle() { return leaf(); }\nexport function start() { return middle(); }\n';
function raw(store: GraphStore) { return (store as unknown as { database: Raw }).database; }
function rows(store: GraphStore) {
  const db = raw(store), tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]);
  return canonicalJson(tables.map(t => ({ table: t.name, rows: db.prepare(`SELECT * FROM "${t.name}"`).all() })));
}
async function fixture(kind: OwnershipQuestion["kind"] = "variable-flow", legacy = false, nonempty = false, configured = true, large = false, late?: "snapshot" | "navigation" | "enumeration" | "store") {
  const variable = "v".repeat(200), functionSuffix = "f".repeat(200);
  const largeCode = `export let ${variable} = 0;\n` + [
    ...Array.from({ length: 3 }, (_, i) => `export function writer${i}${functionSuffix}() { ${variable}=1; }`),
    ...Array.from({ length: 2 }, (_, i) => `export function reader${i}${functionSuffix}() { const value=${variable}; return value; }`),
    ...Array.from({ length: 3 }, (_, i) => `export function returner${i}${functionSuffix}() { return ${variable}; }`),
  ].join("\n");
  // Unicode relative metadata exercises full UTF-8 request size with eight real proofs;
  // no locally bounded name, node evidence list or source snippet is inflated past its limit.
  const base = await mkdtemp(join(tmpdir(), "xray-semantic-preparation-")); roots.push(base); const root = join(base, "project"); await mkdir(root);
  const directory = large ? join(root, ...Array.from({ length: 7 }, (_, i) => `${i}${"文".repeat(35)}`)) : root;
  await mkdir(directory, { recursive: true }); await writeFile(join(directory, large ? `fixture_${"文".repeat(70)}.ts` : "flow.ts"), large ? largeCode : code);
  const options = { databasePath: join(base, "authority.sqlite"), cacheRoot: join(base, "cache"), ...(!legacy ? { projectDatabaseRoot: join(base, "projects") } : {}) };
  const watcher = late ? new XRayApplication(options) : undefined; if (watcher) handles.add(watcher);
  let app = new XRayApplication(options); handles.add(app); let snapshot = await app.indexProject(root);
  if (nonempty) { app.saveIgnoreSettings({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, expectedRevision: 0, rules: ["never"] }); snapshot = await app.indexProject(root); }
  const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId }, question = (await app.createOwnershipQuestions({ ...ref, count: 20, scope: { kind: "project" }, ...(large ? { conceptId: `variable-flow:${snapshot.nodes.find(n => n.name === variable)!.id}` } : {}) })).find(q => q.kind === kind)!;
  const check = question.deterministicChecks[0]!; let structuredAnswer: OwnershipSubmission["structuredAnswer"], edgeIds: string[];
  if (check.kind === "definition") { structuredAnswer = { kind: "entry", nodeId: check.nodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "call-direction") { structuredAnswer = { kind: "call-direction", callerNodeId: check.sourceNodeId, calleeNodeId: check.targetNodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "ordered-path") { structuredAnswer = { kind: "call-path", nodeIds: check.legalNodePaths[0]! }; edgeIds = check.legalEdgePaths[0]!; }
  else {
    const selected = check.requirements.flatMap(r => (large ? r.edgeIds.filter(id => r.role !== "read" || snapshot.nodes.find(n => n.id === snapshot.edges.find(e => e.id === id)!.source)?.name.startsWith("reader")) : [r.edgeIds[0]!]).map(id => ({ role: r.role, id })));
    structuredAnswer = { kind: "variable-flow", roles: selected.map((r, i) => ({ role: r.role, citationIndex: i })) }; edgeIds = selected.map(r => r.id);
  }
  const citations = edgeIds.map(id => { const proof = snapshot.evidence.find(e => e.id === snapshot.edges.find(e => e.id === id)!.evidenceId)!; return { ...proof.span, evidenceId: proof.id }; });
  const submission: OwnershipSubmission = { ...ref, questionId: question.id, questionVersion: question.version, answer: "根据真实引用解释静态关系。🙂", selfConfidence: .5, structuredAnswer, citations };
  // The large fixture selects eight legal roles, not every read at a return location.
  // Its original partial location score stays intact; preparation does not upgrade that grade.
  const grade = await app.gradeOwnershipAnswer(submission); if (large) expect(grade.structure.status).toBe("passed"); else expect(grade.passed).toBe(true);
  if (watcher) {
    app.close(); handles.delete(app); app = watcher;
    expect((app as unknown as { stores: Map<string, GraphStore> }).stores.size).toBe(0);
    if (late === "snapshot") expect((await app.getSnapshotState(ref)).status).toBe("current");
    if (late === "navigation") expect(app.getEvidence({ ...ref, evidenceId: snapshot.evidence[0]!.id }).id).toBe(snapshot.evidence[0]!.id);
    if (late === "store") app.findEvidence({ ...ref, span: snapshot.evidence[0]!.span, limit: 5 });
    if (late === "enumeration") {
      // Invoke the actual constructed enumeration closure without introducing provider/credential ports.
      const remote = app.createRemoteExplanations() as unknown as { ports: { currentReference(): unknown } };
      expect(remote.ports.currentReference()).toMatchObject(ref);
    }
    const opened = (app as unknown as { stores: Map<string, GraphStore> }).stores.get(ref.repositoryId)!; expect(opened).toBeDefined();
    snapshot = await app.indexProject(root); expect(snapshot.snapshotId).toBe(ref.snapshotId);
    expect((app as unknown as { snapshotStores: Map<string, GraphStore> }).snapshotStores.get(ref.snapshotId)).toBe(opened);
  }
  const internal = app as unknown as { legacyStore: GraphStore; stores: Map<string, GraphStore>; snapshotStores: Map<string, GraphStore> };
  const authority = internal.legacyStore, source = internal.snapshotStores.get(ref.snapshotId)!, settings = internal.stores.get(ref.repositoryId) ?? authority;
  if (configured) authority.remote.saveProvider(0, { provider: "openai", model: "gpt-4.1-mini", credentialRevision: 1, credentialStatus: "configured", outputTokens: 2048 });
  const context = authority.remote.commitTrustedContext(randomUUID(), source.remote.activation(ref.repositoryId, ref.snapshotId));
  if (configured) grant(authority, ref.repositoryId);
  const attempt = source.listOwnershipAttempts(ref.repositoryId).at(-1)!;
  const request: OwnershipSemanticPrepareRequest = { ...ref, contextHandle: context.contextHandle, attemptId: attempt.attemptId, purpose: "ownership-semantic-assessment" };
  const flow = app.createOwnershipSemanticPreparations();
  return { app, flow, request, source, settings, authority, question, snapshot, ref, attempt, root, options, context };
}
function grant(authority: GraphStore, repositoryId: string) { const old = authority.loadOwnershipSemanticAuthorization(repositoryId); return authority.grantOwnershipSemanticAuthorization({ repositoryId, expectedRevision: old.revision, expectedProviderRevision: authority.remote.provider().revision, purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES] }); }
function gate() { let enter!: () => void, release!: () => void; return { entered: new Promise<void>(r => enter = r), held: new Promise<void>(r => release = r), enter: () => enter(), release: () => release() }; }
function holdMaterial() { const g = gate(), digest = crypto.subtle.digest.bind(crypto.subtle); vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const result = await digest(...args); g.enter(); await g.held; return result; }); return g; }
async function change(f: Awaited<ReturnType<typeof fixture>>, kind: string) {
  if (kind === "configuration") {
    const path = f.options.projectDatabaseRoot ? join(f.options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`) : f.options.databasePath;
    const second = new GraphStore(path, f.options.projectDatabaseRoot ? "project" : "global"); handles.add(second);
    const old = second.loadIgnoreSettings(f.ref.repositoryId), changed = second.saveIgnoreSettings(f.ref.repositoryId, old.revision, ["temporarily-excluded"]);
    second.saveIgnoreSettings(f.ref.repositoryId, changed.revision, old.rules);
    expect(second.loadIgnoreSettings(f.ref.repositoryId).revision).toBe(old.revision + 2);
  }
  if (kind === "policy") { const old = f.authority.loadOwnershipSemanticAuthorization(f.ref.repositoryId); f.authority.revokeOwnershipSemanticAuthorization({ repositoryId: f.ref.repositoryId, expectedRevision: old.revision, purpose: old.purpose, disclosureVersion: old.disclosureVersion }); grant(f.authority, f.ref.repositoryId); }
  if (kind === "provider") { const old = f.authority.remote.provider(), { revision: _r, ...value } = old; f.authority.remote.saveProvider(old.revision, { ...value, outputTokens: 1024 }); f.authority.remote.saveProvider(old.revision + 1, value); }
  if (kind === "context") { f.authority.remote.commitTrustedContext(f.context.ownerSessionId, null); f.authority.remote.commitTrustedContext(f.context.ownerSessionId, f.source.remote.activation(f.ref.repositoryId, f.ref.snapshotId)); }
  if (kind === "activation") { const sources = f.snapshot.sourceFiles.map(file => ({ filePath: file.filePath, ...f.source.readSnapshotSource(f.ref.snapshotId, file.filePath)! })); f.source.saveSnapshot(f.snapshot, sources, true, f.settings.loadIgnoreSettings(f.ref.repositoryId).revision); }
  if (kind === "main") { const other = `${f.root}-other`; await mkdir(other); await writeFile(join(other, "other.ts"), "export function other() { return 1; }"); await f.app.indexProject(other); await f.app.indexProject(f.root); }
  if (kind === "query") raw(f.source).prepare("UPDATE edges SET source_id='forged' WHERE snapshot_id=?").run(f.ref.snapshotId);
  if (kind === "cut") { const row = raw(f.source).prepare("SELECT basis_payload FROM ownership_question_bindings WHERE attempt_id=?").get(f.attempt.attemptId) as { basis_payload: string }; const basis = JSON.parse(row.basis_payload); basis.historyCut.maxAttemptRowid = 1; raw(f.source).prepare("UPDATE ownership_question_bindings SET basis_payload=? WHERE attempt_id=?").run(canonicalJson(basis), f.attempt.attemptId); }
  if (kind === "source") {
    const stored = f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts")!, content = stored.content.replace("42", "43"), hash = createHash("sha256").update(content).digest("hex");
    const snapshot = structuredClone(f.snapshot); snapshot.sourceFiles[0]!.contentHash = hash;
    snapshot.analysisIdentity.analysisResult!.fingerprint = createHash("sha256").update(canonicalSnapshotResult(snapshot)).digest("hex");
    raw(f.source).prepare("UPDATE source_snapshots SET content=?,content_hash=? WHERE snapshot_id=?").run(content, hash, f.ref.snapshotId);
    raw(f.source).prepare("UPDATE snapshots SET payload=? WHERE snapshot_id=?").run(JSON.stringify(snapshot), f.ref.snapshotId);
  }
  if (kind === "answer") {
    const row = raw(f.source).prepare("SELECT payload FROM ownership_semantic_capsules WHERE attempt_id=?").get(f.attempt.attemptId) as { payload: string }, capsule = JSON.parse(row.payload);
    const attempt = { ...f.attempt, semanticText: f.attempt.semanticText.replace("根据", "针对") }, attemptHash = await computeOwnershipAttemptHash(attempt);
    capsule.attemptHash = attemptHash; capsule.answerHash = await hashOwnershipAnswer(attempt.semanticText); capsule.capsuleHash = await computeOwnershipCapsuleHash(capsule);
    raw(f.source).prepare("UPDATE ownership_attempts SET payload=? WHERE attempt_id=?").run(JSON.stringify(attempt), attempt.attemptId);
    raw(f.source).prepare("UPDATE ownership_semantic_capsules SET payload=?,attempt_hash=?,capsule_hash=? WHERE attempt_id=?").run(JSON.stringify(capsule), attemptHash, capsule.capsuleHash, attempt.attemptId);
    raw(f.source).prepare("UPDATE ownership_question_bindings SET attempt_hash=?,capsule_hash=? WHERE attempt_id=?").run(attemptHash, capsule.capsuleHash, attempt.attemptId);
  }
}

describe("trusted local semantic preparation", () => {
  it.each(["snapshot", "navigation", "enumeration", "store"] as const)("late database via actual %s opener retains its instance and prepares", async opener => {
    const f = await fixture("call-direction", false, false, true, false, opener), before = [rows(f.authority), rows(f.source)];
    const token = await f.flow.prepare(f.request); expect(f.flow.withRevisions(token, r => f.flow.consume(r)).preparedReference).toBe(token);
    expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it("late database still rejects default denial and unconfigured metadata", async () => {
    const f = await fixture("call-direction", false, false, false, false, "snapshot"), before = rows(f.source);
    await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    grant(f.authority, f.ref.repositoryId);
    await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" }); expect(rows(f.source)).toBe(before);
  });
  it.each(["close", "main"])("late database preparation still invalidates on %s", async kind => {
    const f = await fixture("call-direction", false, false, true, false, "snapshot"), token = await f.flow.prepare(f.request), work = vi.fn();
    if (kind === "close") { f.app.close(); handles.delete(f.app); } else await change(f, "main");
    expect(() => f.flow.withRevisions(token, work)).toThrow("所有权语义准备失败"); expect(work).not.toHaveBeenCalled();
  });
  it.each((["entry", "call-direction", "call-path", "variable-flow"] as const).flatMap(kind => [false, true].flatMap(legacy => [false, true].map(nonempty => ({ kind, legacy, nonempty })))))("real $kind legacy=$legacy nonempty=$nonempty fixed adapter and one-shot barrier", async ({ kind, legacy, nonempty }) => {
    const f = await fixture(kind, legacy, nonempty), before = [rows(f.authority), rows(f.settings), rows(f.source)];
    const token = await f.flow.prepare(f.request), loaded = await f.source.loadOwnershipSemanticPackage(f.attempt.attemptId);
    if (loaded.status !== "ready") throw Error("fixture");
    const actual = await llm.prepareOwnershipSemanticRequest({ semanticPackage: loaded.package, submittedAnswer: f.attempt.semanticText });
    let escaped!: SemanticRevisionReceipt;
    const consumed = f.flow.withRevisions(token, receipt => { escaped = receipt; return f.flow.consume(receipt); });
    expect(consumed).toMatchObject({ assessmentPackageId: loaded.package.assessmentPackageId, adapterRequestDigest: createHash("sha256").update(actual.serializedRequest).digest("hex"), requestBytes: actual.requestBytes, provider: "openai", model: "gpt-4.1-mini", outputTokens: 2048, preparedReference: token });
    expect(actual.serializedRequest).toContain('"systemInstructions"'); expect(actual.serializedRequest).toContain('"responseSchema"'); expect(actual.serializedRequest).toContain('"data"');
    expect(() => f.flow.consume(escaped)).toThrow("所有权语义准备失败"); expect(() => f.flow.withRevisions(token, () => undefined)).toThrow("所有权语义准备失败");
    expect([rows(f.authority), rows(f.settings), rows(f.source)]).toEqual(before);
  });
  it("default provider/semantic denial and feature-only grant cannot prepare", async () => {
    const f = await fixture("entry", false, false, false), before = rows(f.source);
    await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    f.authority.remote.saveProvider(0, { provider: "openai", model: "gpt-4.1-mini", credentialRevision: 1, credentialStatus: "configured", outputTokens: 2048 });
    f.authority.remote.saveAuthorization(f.ref.repositoryId, 0, true);
    await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" }); expect(rows(f.source)).toBe(before);
  });
  it("semantic grant alone cannot invent configured provider metadata or read credentials", async () => {
    const f = await fixture("entry", false, false, false); grant(f.authority, f.ref.repositoryId);
    const before = [rows(f.authority), rows(f.source)]; await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it("caller request mutation after SQL capture cannot alter actual package/identity", async () => {
    const f = await fixture(), g = holdMaterial(), original = structuredClone(f.request), pending = f.flow.prepare(f.request); await g.entered;
    f.request.attemptId = "other"; f.request.repositoryId = "other"; f.request.contextHandle = randomUUID();
    g.release(); const token = await pending;
    expect(f.flow.withRevisions(token, r => f.flow.consume(r)).preparedReference).toBe(token);
    expect(f.source.listOwnershipAttempts(original.repositoryId)[0]?.attemptId).toBe(original.attemptId);
  });
  it.each(["configuration", "policy", "provider", "context", "activation", "main", "query", "cut", "source", "answer"])("actual async %s changes cannot be replaced by rehashed or same-state metadata", async kind => {
    const f = await fixture(), g = holdMaterial(), outcome = f.flow.prepare(f.request).catch(error => error); await g.entered;
    try { await change(f, kind); } finally { g.release(); }
    expect(await outcome).toMatchObject({ message: "所有权语义准备失败" });
    expect(raw(f.authority).prepare("SELECT count(*) n FROM explanation_tasks").get()).toEqual({ n: 0 });
    expect(raw(f.authority).prepare("SELECT count(*) n FROM remote_task_registry").get()).toEqual({ n: 0 });
  });
  it.each(["provider", "context"])("post-adapter recheck rejects restored %s while actual adapter returns", async kind => {
    const g = gate(), compiled = llm.prepareOwnershipSemanticRequest;
    vi.spyOn(llm, "prepareOwnershipSemanticRequest").mockImplementationOnce(async input => { const actual = await compiled(input); g.enter(); await g.held; return actual; });
    const f = await fixture(), outcome = f.flow.prepare(f.request).catch(error => error); await g.entered;
    try { await change(f, kind); } finally { g.release(); }
    expect(await outcome).toMatchObject({ message: "所有权语义准备失败" });
    expect(raw(f.authority).prepare("SELECT count(*) n FROM explanation_tasks").get()).toEqual({ n: 0 });
  });
  it.each(["configuration", "policy", "provider", "context", "activation", "query", "cut", "source", "answer"])("barrier observes committed %s after async preparation and runs no callback", async kind => {
    const f = await fixture(), token = await f.flow.prepare(f.request); await change(f, kind); const work = vi.fn();
    expect(() => f.flow.withRevisions(token, work)).toThrow("所有权语义准备失败"); expect(work).not.toHaveBeenCalled();
  });
  it.each(["promise", "rejected-promise", "thenable", "then-getter", "proxy", "throw", "unused", "twice"])("temporary receipt rejects %s without escaping authority or writing", async kind => {
    const f = await fixture(), token = await f.flow.prepare(f.request), before = [rows(f.authority), rows(f.source)], getter = vi.fn(), rejection = vi.fn();
    let escaped!: SemanticRevisionReceipt; process.on("unhandledRejection", rejection);
    try {
      expect(() => f.flow.withRevisions(token, receipt => {
        escaped = receipt;
        if (kind === "unused") return undefined;
        f.flow.consume(receipt);
        if (kind === "twice") return f.flow.consume(receipt);
        if (kind === "throw") throw Error("private fixture failure");
        if (kind === "promise") return Promise.resolve("later");
        if (kind === "rejected-promise") return Promise.reject(Error("private fixture rejection"));
        if (kind === "proxy") return new Proxy({}, { getOwnPropertyDescriptor: getter });
        if (kind === "thenable") return { then: getter };
        return Object.defineProperty({}, "then", { get: getter });
      })).toThrow("所有权语义准备失败");
      await new Promise(resolve => setTimeout(resolve, 1)); expect(rejection).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", rejection); }
    expect(() => f.flow.consume(escaped)).toThrow("所有权语义准备失败"); expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it.each([false, true])("global-settings-source actual locks reject second connections, legacy=%s", async legacy => {
    const f = await fixture("variable-flow", legacy), token = await f.flow.prepare(f.request), stages: string[] = [];
    const authPath = f.options.databasePath, sourcePath = legacy ? authPath : join(f.options.projectDatabaseRoot!, `${f.ref.repositoryId}.sqlite`);
    const otherAuth = new Database(authPath), otherSource = new Database(sourcePath); handles.add(otherAuth); handles.add(otherSource);
    otherAuth.exec("PRAGMA busy_timeout=1"); otherSource.exec("PRAGMA busy_timeout=1");
    const global = f.authority.withOwnershipSemanticAuthorityLock.bind(f.authority), settings = f.settings.withIgnoreRevision.bind(f.settings);
    vi.spyOn(f.authority, "withOwnershipSemanticAuthorityLock").mockImplementationOnce(work => global(() => { stages.push("global"); expect(() => otherAuth.exec("BEGIN IMMEDIATE")).toThrow(/locked/); return work(); }));
    vi.spyOn(f.settings, "withIgnoreRevision").mockImplementationOnce((id, rev, work) => settings(id, rev, () => { stages.push("settings"); expect(() => otherAuth.exec("BEGIN IMMEDIATE")).toThrow(/locked/); expect(() => otherSource.exec("BEGIN IMMEDIATE")).toThrow(/locked/); return work(); }));
    f.flow.withRevisions(token, receipt => { stages.push("source"); expect(() => otherAuth.exec("BEGIN IMMEDIATE")).toThrow(/locked/); expect(() => otherSource.exec("BEGIN IMMEDIATE")).toThrow(/locked/); return f.flow.consume(receipt); });
    expect(stages).toEqual(["global", "settings", "source"]);
    otherAuth.exec("BEGIN IMMEDIATE; ROLLBACK"); otherSource.exec("BEGIN IMMEDIATE; ROLLBACK");
  });
  it.each(["cancel", "timeout", "replace", "app-close", "source-close"] as const)("%s clears pending scope and cannot create a token or task", async kind => {
    const f = await fixture(), controller = new AbortController(), g = holdMaterial();
    if (kind === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const outcome = f.flow.prepare(f.request, { signal: controller.signal }).catch(error => error); await g.entered;
    if (kind === "cancel") controller.abort();
    if (kind === "timeout") await vi.advanceTimersByTimeAsync(SEMANTIC_PREPARATION_TIMEOUT_MS + 1);
    if (kind === "app-close") { f.app.close(); handles.delete(f.app); }
    if (kind === "source-close") f.source.close();
    let replacement: PreparedSemanticBinding | undefined;
    if (kind === "replace") replacement = await f.flow.prepare(f.request);
    g.release(); const error = await outcome; expect(error).toMatchObject({ message: "所有权语义准备失败" });
    if (kind === "timeout") expect(error.code).toBe("TIMEOUT");
    if (replacement) expect(f.flow.withRevisions(replacement, r => f.flow.consume(r)).preparedReference).toBe(replacement);
  });
  it("wrong same-database instance and ordinary/clone tokens cannot consume or revive preparation", async () => {
    const f = await fixture(), token = await f.flow.prepare(f.request), ports = (f.app as unknown as { semanticPorts: OwnershipSemanticTrustedPorts }).semanticPorts;
    const other = new GraphStore(f.options.projectDatabaseRoot ? join(f.options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`) : f.options.databasePath, "project", createOwnershipQuestionGeneratorPort(), ports); handles.add(other);
    expect(() => other.withOwnershipSemanticRevisions(token, () => undefined)).toThrow("所有权语义准备失败");
    expect(() => f.flow.withRevisions(structuredClone(token), () => undefined)).toThrow("所有权语义准备失败");
    expect(f.flow.withRevisions(token, r => { expect(() => other.consumeOwnershipSemanticRevision(r)).toThrow(expect.objectContaining({ code: "INVALID_RECEIPT" })); return f.flow.consume(r); }).preparedReference).toBe(token);
  });
  it.each(["missing-binding", "unavailable", "missing-capsule", "not-evaluated"])("%s cannot be upgraded to a prepared permission", async kind => {
    const f = await fixture();
    if (kind === "missing-binding") raw(f.source).exec("DELETE FROM ownership_question_bindings");
    if (kind === "missing-capsule") raw(f.source).exec("DELETE FROM ownership_semantic_capsules");
    if (kind === "unavailable") raw(f.source).exec("UPDATE ownership_question_bindings SET status='unavailable',question_preimage=NULL,basis_payload=NULL,reason='untrusted-issuance'");
    if (kind === "not-evaluated") {
      const row = raw(f.source).prepare("SELECT payload FROM ownership_semantic_capsules WHERE attempt_id=?").get(f.attempt.attemptId) as { payload: string }, original = JSON.parse(row.payload);
      const capsule = { version: "1.0.0" as const, builderVersion: "1.0.0" as const, status: "not-evaluated" as const, reason: "rubric-budget-exceeded" as const,
        sourceIdentity: original.sourceIdentity, questionFingerprint: original.questionFingerprint, attemptHash: original.attemptHash, answerHash: original.answerHash,
        submissionProjectionHash: null, capsuleHash: "0".repeat(64) };
      capsule.capsuleHash = await computeOwnershipCapsuleHash(capsule);
      raw(f.source).prepare("UPDATE ownership_semantic_capsules SET status='not-evaluated',payload=?,capsule_hash=? WHERE attempt_id=?").run(JSON.stringify(capsule), capsule.capsuleHash, f.attempt.attemptId);
      raw(f.source).prepare("UPDATE ownership_question_bindings SET capsule_hash=? WHERE attempt_id=?").run(capsule.capsuleHash, f.attempt.attemptId);
      expect(await f.source.loadOwnershipSemanticPackage(f.attempt.attemptId)).toMatchObject({ status: "not-evaluated", currentness: "not-checked" });
    }
    await expect(f.flow.prepare(f.request)).rejects.toThrow("所有权语义准备失败");
  });
  it("closing and reopening keeps history unchanged but requires a new preparation object", async () => {
    const f = await fixture(), token = await f.flow.prepare(f.request), before = [rows(f.authority), rows(f.source)];
    f.app.close(); handles.delete(f.app);
    const app = new XRayApplication(f.options); handles.add(app); const flow = app.createOwnershipSemanticPreparations();
    expect(() => f.flow.withRevisions(token, () => undefined)).toThrow("所有权语义准备失败");
    expect(() => flow.withRevisions(token, () => undefined)).toThrow("所有权语义准备失败");
    const next = await flow.prepare(f.request); expect(flow.withRevisions(next, r => flow.consume(r)).preparedReference).toBe(next);
    const internal = app as unknown as { legacyStore: GraphStore; snapshotStores: Map<string, GraphStore> };
    expect([rows(internal.legacyStore), rows(internal.snapshotStores.get(f.ref.snapshotId) ?? internal.legacyStore)]).toEqual(before);
  });
  it("local oversized-answer gate preserves the original answer without truncation", async () => {
    const f = await fixture(), request = { ...f.request };
    // A new trustworthy submission with an answer outside the existing semantic package budget.
    await f.app.createOwnershipQuestions({ ...f.ref, count: 20, scope: { kind: "project" } });
    const attempt = f.attempt;
    await f.app.gradeOwnershipAnswer({ ...f.ref, questionId: f.question.id, questionVersion: f.question.version, answer: "🙂".repeat(5000), selfConfidence: .5,
      structuredAnswer: attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"], citations: attempt.citations });
    const latest = f.source.listOwnershipAttempts(f.ref.repositoryId).at(-1)!; request.attemptId = latest.attemptId;
    expect(latest.semanticText).toBe("🙂".repeat(5000)); const before = [rows(f.authority), rows(f.source)];
    await expect(f.flow.prepare(request)).rejects.toThrow("所有权语义准备失败");
    expect([rows(f.authority), rows(f.source)]).toEqual(before); expect(f.source.listOwnershipAttempts(f.ref.repositoryId).at(-1)?.semanticText).toBe(latest.semanticText);
  });
  it("real saved large proof package reaches the fixed adapter byte gate", async () => {
    const f = await fixture("variable-flow", false, false, true, true);
    const first = await f.source.loadOwnershipSemanticPackage(f.attempt.attemptId);
    expect(first.status, first.status === "not-evaluated" && first.capsule.status === "not-evaluated" ? first.capsule.reason : first.status).toBe("ready"); if (first.status !== "ready") throw Error("Expected actual SQL package");
    const actual = await llm.prepareOwnershipSemanticRequest({ semanticPackage: first.package, submittedAnswer: f.attempt.semanticText });
    expect(actual.requestBytes).toBeGreaterThan(49152);
    const room = 65536 - actual.requestBytes + 32;
    const answer = f.attempt.semanticText + "文".repeat(Math.floor(room / 3)) + "x".repeat(room % 3);
    expect(Buffer.byteLength(answer)).toBeLessThanOrEqual(16384);
    await f.app.createOwnershipQuestions({ ...f.ref, count: 20, scope: { kind: "project" }, conceptId: f.question.concept.id });
    expect((await f.app.gradeOwnershipAnswer({ ...f.ref, questionId: f.question.id, questionVersion: f.question.version, answer, selfConfidence: .5,
      structuredAnswer: f.attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"], citations: f.attempt.citations })).structure.status).toBe("passed");
    const latest = f.source.listOwnershipAttempts(f.ref.repositoryId).at(-1)!, loaded = await f.source.loadOwnershipSemanticPackage(latest.attemptId);
    expect(loaded.status).toBe("ready"); if (loaded.status !== "ready") throw Error("Budget must be rejected by adapter, not capsule gate");
    expect(loaded.package.answer).toBe(answer);
    await expect(llm.prepareOwnershipSemanticRequest({ semanticPackage: loaded.package, submittedAnswer: answer })).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    const before = [rows(f.authority), rows(f.source)];
    await expect(f.flow.prepare({ ...f.request, attemptId: latest.attemptId })).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect([rows(f.authority), rows(f.source)]).toEqual(before); expect(f.source.listOwnershipAttempts(f.ref.repositoryId).at(-1)?.semanticText).toBe(answer);
  }, 20_000);
});
