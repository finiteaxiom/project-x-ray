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
import { OwnershipSemanticApplication } from "./ownership-semantic-application.js";
import { Worker } from "node:worker_threads";
import { remoteCapturedIdentitySchema, ownershipSemanticCapturedIdentitySchema, type RemoteCapturedIdentity, type OwnershipSemanticCapturedIdentity } from "@project-xray/contracts";

interface Raw { name: string; open: boolean; inTransaction: boolean; prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }; exec(sql: string): void; close(): void; pragma(sql: string): unknown; function(name: string, callback: (...args: unknown[]) => unknown): Raw; transaction<T>(work: () => T): { immediate(): T; (): T } }
const Database = createRequire(import.meta.url)("better-sqlite3") as new(path: string) => Raw;
// Internal SQL is used only to inject faults/competition, never to supply a
// reservation's identity or to replace the actual compiled application ports.
const taskModule = "../../graph/src/ownership-semantic-task-store.js", sharedModule = "../../graph/src/shared-remote-task-store.js";
const { OwnershipSemanticTaskStore } = await import(taskModule) as { OwnershipSemanticTaskStore: new(db: Raw, role: "global") => { terminalReserved(id: OwnershipSemanticCapturedIdentity, code: "CANCELLED"): unknown } };
const { SharedRemoteTaskStore } = await import(sharedModule) as { SharedRemoteTaskStore: new(db: Raw, role: "global") => { reserveFeature(id: RemoteCapturedIdentity, time: string): unknown } };
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
  const flow = new OwnershipSemanticApplication(authority, () => ({ source, settings }), { createWorker: localWorker }); handles.add(flow);
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
  if (kind === "provider-model") { const old = f.authority.remote.provider(), { revision: _r, ...value } = old; f.authority.remote.saveProvider(old.revision, { ...value, model: "gpt-4.1" }); f.authority.remote.saveProvider(old.revision + 1, value); }
  if (kind === "credential") { const { revision, ...value } = f.authority.remote.provider(); f.authority.remote.saveProvider(revision, { ...value, credentialRevision: value.credentialRevision + 1 }); }
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

const dbOf = (store: GraphStore) => raw(store);
const persistedIdentity = (f: Awaited<ReturnType<typeof fixture>>, taskId: string) => {
  const row = raw(f.authority).prepare("SELECT identity_payload FROM remote_task_registry WHERE task_id=?").get(taskId) as { identity_payload: string };
  return ownershipSemanticCapturedIdentitySchema.parse(JSON.parse(row.identity_payload));
};
const noTaskOrResult = (f: Awaited<ReturnType<typeof fixture>>) => {
  expect(raw(f.authority).prepare("SELECT * FROM ownership_semantic_tasks").all()).toEqual([]);
  expect(raw(f.source).prepare("SELECT * FROM ownership_semantic_results").all()).toEqual([]);
};
function second(store: GraphStore) { const db = new Database(raw(store).name); db.pragma("busy_timeout=1"); handles.add(db); return db; }
function featureIdentity(f: Awaited<ReturnType<typeof fixture>>) {
  const activation = f.source.remote.activation(f.ref.repositoryId, f.ref.snapshotId);
  return remoteCapturedIdentitySchema.parse({ protocolVersion: "1.0.0", ...activation, taskId: randomUUID(), ownerSessionId: f.context.ownerSessionId,
    contextHandle: f.context.contextHandle, contextEpoch: f.context.epoch, ignoreRevision: f.settings.loadIgnoreSettings(f.ref.repositoryId).revision,
    authorizationRevision: 1, providerRevision: f.authority.remote.provider().revision, credentialRevision: 1,
    packageId: "a".repeat(64), bodyDigest: "b".repeat(64), limitsVersion: "1.0.0" });
}

// Self-authored local worker script, never imported project code or network.
const workers = new Set<Worker>();
afterEach(async () => { for (const worker of workers) await Worker.prototype.terminate.call(worker); workers.clear(); });
function localResponse(prepared: { body: string }) {
  const body = JSON.parse(prepared.body), pack = JSON.parse(body.input[0].content[0].text).data.semanticPackage;
  return { version: "1.0.0", assessmentPackageId: pack.assessmentPackageId, criteria: pack.rubric.criteria.map((c: { criterionId: string; requiredEvidenceIds: string[]; answerScope: unknown[] }) => ({ criterionId: c.criterionId, verdict: "supported", explanation: "静态源码支持该关系。", evidenceIds: c.requiredEvidenceIds, limitationIds: [], answerRanges: c.answerScope })) };
}
function localWorker(prepared: { body: string }) {
  const worker = new Worker("const {parentPort,workerData}=require('node:worker_threads'); parentPort.postMessage(workerData);", { eval: true, workerData: localResponse(prepared) }); workers.add(worker); return worker;
}
function controlled(f: Awaited<ReturnType<typeof fixture>>, mode: "reply" | "throw" | "invalid" = "reply") {
  f.flow.close(); const g = gate(); let worker: Worker | undefined;
  const createWorker = vi.fn((prepared: { body: string }) => {
    g.enter(); if (mode === "throw") throw Error("private body");
    const response = localResponse(prepared); if (mode === "invalid") response.criteria[0]!.evidenceIds = ["fabricated"];
    worker = new Worker("const {parentPort,workerData}=require('node:worker_threads'); parentPort.on('message',()=>parentPort.postMessage(workerData));", { eval: true, workerData: response }); workers.add(worker); return worker;
  });
  const flow = new OwnershipSemanticApplication(f.authority, () => ({ source: f.source, settings: f.settings }), { createWorker }); handles.add(flow);
  return { flow, createWorker, created: g.entered, worker: () => worker!, reply: () => worker!.postMessage("reply") };
}
async function ready(f: Awaited<ReturnType<typeof fixture>>, c: ReturnType<typeof controlled>) { const task = c.flow.reserve(await c.flow.prepare(f.request)); const outcome = c.flow.start(task.reservation).then(result => ({ result }), error => ({ error })); await c.created; return { task, outcome }; }
function state(f: Awaited<ReturnType<typeof fixture>>) { return [rows(f.authority), rows(f.source)]; }
function results(f: Awaited<ReturnType<typeof fixture>>) { return raw(f.source).prepare("SELECT * FROM ownership_semantic_results").all(); }
function table(f: Awaited<ReturnType<typeof fixture>>) { return raw(f.authority).prepare("SELECT phase,json_extract(payload,'$.code') code,inflight,created_at FROM ownership_semantic_tasks").get(); }
describe("trusted once-only semantic execution/publication", () => {
  it.each((["entry", "call-direction", "call-path", "variable-flow"] as const).flatMap(kind => [false, true].flatMap(legacy => [false, true].map(nonempty => ({ kind, legacy, nonempty })))))("actual $kind/$legacy/$nonempty publishes with unchanged source/grade/mastery and T1", async ({ kind, legacy, nonempty }) => {
    const f = await fixture(kind, legacy, nonempty), before = f.source.listOwnershipAttempts(f.ref.repositoryId), source = f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts"), mastery = raw(f.source).prepare("SELECT * FROM mastery_records").all(), bindings = raw(f.source).prepare("SELECT * FROM ownership_question_bindings").all();
    const task = f.flow.reserve(await f.flow.prepare(f.request)); noTaskOrResult(f);
    const published = await f.flow.start(task.reservation);
    expect(published.createdAt).toBe(task.createdAt); expect(published.identity.taskId).toBe(task.taskId);
    expect(await f.flow.read(task.reservation)).toEqual(published);
    expect(raw(f.authority).prepare("SELECT phase,inflight,created_at FROM ownership_semantic_tasks").get()).toEqual({ phase: "completed", inflight: 0, created_at: task.createdAt });
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(before); expect(f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts")).toEqual(source);
    expect(raw(f.source).prepare("SELECT * FROM mastery_records").all()).toEqual(mastery); expect(raw(f.source).prepare("SELECT * FROM ownership_question_bindings").all()).toEqual(bindings);
    await expect(f.flow.start(task.reservation)).rejects.toMatchObject({ code: "BUSY" });
  });
  it("production entry remains absent; default internal executor returns NOT_CONFIGURED with zero execution/tasks", async () => {
    const f = await fixture(), flow = new OwnershipSemanticApplication(f.authority, () => ({ source: f.source, settings: f.settings })); handles.add(flow);
    expect(f.app).not.toHaveProperty("createOwnershipSemanticApplication"); const task = flow.reserve(await flow.prepare(f.request)), before = state(f);
    await expect(flow.start(task.reservation)).rejects.toMatchObject({ code: "NOT_CONFIGURED" }); expect(state(f)).toEqual(before); await flow.cancel(task.reservation);
  });
  it.each(["configuration", "policy", "provider", "provider-model", "credential", "context", "activation", "main", "query", "source", "answer", "cut"])("second gate rejects actual %s change with zero worker calls/results", async kind => {
    const f = await fixture(), c = controlled(f), task = c.flow.reserve(await c.flow.prepare(f.request)); await change(f, kind);
    const attempts = f.source.listOwnershipAttempts(f.ref.repositoryId); await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ message: "所有权语义执行失败" });
    expect(c.createWorker).not.toHaveBeenCalled(); expect(results(f)).toEqual([]); expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(attempts); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("second gate workspace wait cannot authorize late A -> B -> A main state", async () => {
    const f = await fixture(), c = controlled(f), task = c.flow.reserve(await c.flow.prepare(f.request)), g = gate(), real = f.app.getSnapshotState.bind(f.app);
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => { const answer = await real(...args); g.enter(); await g.held; return answer; });
    const outcome = c.flow.start(task.reservation).catch(error => error); await g.entered; await change(f, "main"); g.release(); expect(await outcome).toMatchObject({ message: "所有权语义执行失败" }); expect(c.createWorker).not.toHaveBeenCalled(); expect(results(f)).toEqual([]);
  });
  it.each(["configuration", "policy", "provider", "provider-model", "credential", "context", "activation", "main", "query", "source", "answer", "cut"])("late response after %s change never publishes", async kind => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), attempts = f.source.listOwnershipAttempts(f.ref.repositoryId);
    await change(f, kind); c.reply(); expect(await run.outcome).toHaveProperty("error"); expect(results(f)).toEqual([]);
    // Some adversarial fixtures intentionally mutate saved answer/rows; execution never grades again.
    if (kind !== "answer") expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(attempts);
  });
  it.each([false, true])("promotion COMMIT failure retains attempt/slot while actual worker is pending legacy=%s", async legacy => {
    const f = await fixture("call-direction", legacy), c = controlled(f), task = c.flow.reserve(await c.flow.prepare(f.request)), db = raw(f.authority);
    db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER INSERT ON ownership_semantic_tasks WHEN NEW.phase='dispatched' BEGIN INSERT INTO fault_child VALUES(1); END");
    await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ message: "所有权语义执行失败" }); expect(c.createWorker).toHaveBeenCalledTimes(1);
    expect(c.worker().threadId).not.toBe(-1);
    await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" });
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); expect(results(f)).toEqual([]);
    expect(() => f.source.cancelOwnershipSemanticReservation(task.reservation)).toThrow(); await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ code: "BUSY" });
    const peer = second(f.authority), shared = new SharedRemoteTaskStore(peer, "global"); expect(() => peer.transaction(() => shared.reserveFeature(featureIdentity(f), new Date().toISOString())).immediate()).toThrowError(expect.objectContaining({ code: "BUSY" }));
    expect(c.createWorker).toHaveBeenCalledTimes(1); db.exec("DROP TRIGGER inject"); await c.flow.cancel(task.reservation); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" });
  });
  it("synchronous factory throw cannot prove stop, repeat, or use old zero-dispatch cancel", async () => {
    const f = await fixture(), c = controlled(f, "throw"), task = c.flow.reserve(await c.flow.prepare(f.request));
    await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ code: "PROVIDER_FAILED" }); expect(c.createWorker).toHaveBeenCalledTimes(1);
    expect(() => f.source.cancelOwnershipSemanticReservation(task.reservation)).toThrow(); await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ code: "BUSY" });
    await expect(c.flow.cancel(task.reservation)).rejects.toMatchObject({ code: "POLICY_INVALID" });
    await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" }); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); expect(results(f)).toEqual([]);
  });
  it.each(["boolean", "rejected-promise"])("abnormal factory %s cannot prove resource ownership or create unhandled rejection", async kind => {
    const f = await fixture(), unhandled = vi.fn(); f.flow.close(); process.on("unhandledRejection", unhandled);
    const createWorker = vi.fn(() => (kind === "boolean" ? true : Promise.reject(Error("private"))) as never), flow = new OwnershipSemanticApplication(f.authority, () => ({ source: f.source, settings: f.settings }), { createWorker }); handles.add(flow);
    try {
      const task = flow.reserve(await flow.prepare(f.request)); await expect(flow.start(task.reservation)).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
      await new Promise(resolve => setTimeout(resolve, 1)); expect(unhandled).not.toHaveBeenCalled(); expect(createWorker).toHaveBeenCalledTimes(1); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
      await expect(flow.start(task.reservation)).rejects.toMatchObject({ code: "BUSY" });
      await expect(flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" });
    } finally { process.off("unhandledRejection", unhandled); }
  });
  it("actual strict prepared validator rejects self-authored fabricated evidence and never modifies grades", async () => {
    const f = await fixture(), c = controlled(f, "invalid"), old = f.source.listOwnershipAttempts(f.ref.repositoryId), run = await ready(f, c); c.reply();
    expect(await run.outcome).toMatchObject({ error: { code: "INVALID_RESPONSE" } }); expect(results(f)).toEqual([]); expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(old);
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("ordinary boolean/exit event/mutable threadId cannot release a still-live actual worker", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c); f.source.failOwnershipSemanticExecution(run.task.reservation, "PROVIDER_FAILED");
    // Only shadow within this synchronous assertion. Native Node messaging also
    // uses the public getter during exit; restore it before letting exit run.
    Object.defineProperty(c.worker(), "threadId", { value: -1, configurable: true });
    try { expect(() => f.source.releaseOwnershipSemanticExecution(run.task.reservation, c.worker())).toThrow(); expect(() => f.source.releaseOwnershipSemanticExecution(run.task.reservation, true as never)).toThrow(); }
    finally { Reflect.deleteProperty(c.worker(), "threadId"); }
    const native = Object.getOwnPropertyDescriptor(Worker.prototype, "threadId")!;
    Object.defineProperty(Worker.prototype, "threadId", { configurable: true, get: () => -1 });
    try { expect(() => f.source.releaseOwnershipSemanticExecution(run.task.reservation, c.worker())).toThrow(); }
    finally { Object.defineProperty(Worker.prototype, "threadId", native); }
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); await c.flow.cancel(run.task.reservation); await run.outcome;
  });
  it.each([false, true])("source result commit precedes completed; completed COMMIT failure compensates exact candidate legacy=%s", async legacy => {
    const f = await fixture("call-direction", legacy), c = controlled(f), db = raw(f.authority), task = c.flow.reserve(await c.flow.prepare(f.request));
    db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER UPDATE ON ownership_semantic_tasks WHEN NEW.phase='completed' BEGIN INSERT INTO fault_child VALUES(1); END");
    const pending = c.flow.start(task.reservation).catch(error => error); await c.created; c.reply(); expect(await pending).toMatchObject({ message: "所有权语义执行失败" });
    expect(results(f)).toEqual([]); expect(table(f)).toMatchObject({ phase: "failed", inflight: 0, created_at: task.createdAt }); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    await expect(c.flow.read(task.reservation)).rejects.toBeDefined();
  });
  it.each(["abort", "ignore", "commit", "wrong-payload"])("source %s failure has no published result or successful task", async fault => {
    const f = await fixture(), c = controlled(f), source = raw(f.source);
    if (fault === "commit") source.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER INSERT ON ownership_semantic_results BEGIN INSERT INTO fault_child VALUES(1); END");
    else if (fault === "wrong-payload") {
      source.function("alternate_candidate", payload => { const value = JSON.parse(String(payload)); value.response.criteria[0].explanation = "changed"; value.responseDigest = createHash("sha256").update(canonicalJson(value.response)).digest("hex"); return canonicalJson(value); });
      source.exec("CREATE TRIGGER inject AFTER INSERT ON ownership_semantic_results BEGIN DELETE FROM ownership_semantic_results WHERE task_id=NEW.task_id; INSERT INTO ownership_semantic_results VALUES(NEW.task_id,NEW.repository_id,NEW.snapshot_id,NEW.attempt_id,NEW.binding_hash,json_extract(alternate_candidate(NEW.payload),'$.responseDigest'),NEW.created_at,NEW.completed_at,alternate_candidate(NEW.payload)); END");
    }
    else source.exec(`CREATE TRIGGER inject BEFORE INSERT ON ownership_semantic_results BEGIN SELECT RAISE(${fault === "ignore" ? "IGNORE" : "ABORT,'private'"}); END`);
    const run = await ready(f, c); c.reply(); expect(await run.outcome).toHaveProperty("error"); expect(results(f)).toEqual([]); expect(table(f)).toMatchObject({ phase: "failed", inflight: 0 });
  });
  it.each(["finish", "compensate", "release"])("failed publication %s cleanup fault retains occupation/primary and remains unreadable", async stage => {
    const f = await fixture(), c = controlled(f), global = raw(f.authority), source = raw(f.source);
    global.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER completion_fault AFTER UPDATE ON ownership_semantic_tasks WHEN NEW.phase='completed' BEGIN INSERT INTO fault_child VALUES(1); END");
    if (stage === "finish") global.exec("CREATE TRIGGER inject BEFORE UPDATE ON ownership_semantic_tasks WHEN NEW.phase='failed' BEGIN SELECT RAISE(ABORT,'cleanup private'); END");
    if (stage === "compensate") source.exec("CREATE TRIGGER inject BEFORE DELETE ON ownership_semantic_results BEGIN SELECT RAISE(ABORT,'cleanup private'); END");
    if (stage === "release") global.exec("CREATE TRIGGER inject BEFORE UPDATE OF inflight ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'cleanup private'); END");
    const run = await ready(f, c); c.reply(); expect(await run.outcome).toMatchObject({ error: { message: "所有权语义执行失败" } });
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); await expect(c.flow.read(run.task.reservation)).rejects.toBeDefined();
    if (stage !== "release") expect(results(f)).toHaveLength(1); else expect(results(f)).toEqual([]);
    expect(table(f)).toMatchObject({ phase: stage === "finish" ? "dispatched" : "failed", inflight: 1 });
    const beforeRetry = state(f); await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" }); expect(state(f)).toEqual(beforeRetry);
    if (stage === "compensate") source.exec("DROP TRIGGER inject"); else global.exec("DROP TRIGGER inject");
    await c.flow.cancel(run.task.reservation); expect(results(f)).toEqual([]); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(["application", "source", "authority"])("close %s while response pending never publishes/releases and reopening never resends", async kind => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), observer = second(f.authority), path = raw(f.authority).name;
    if (kind === "application") c.flow.close(); else (kind === "source" ? f.source : f.authority).close();
    expect(await run.outcome).toHaveProperty("error"); expect(observer.prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
    const reopened = new GraphStore(path, "global"); handles.add(reopened); expect(raw(reopened).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); expect(c.createWorker).toHaveBeenCalledTimes(1);
  });
  it("post-completion currentness failure hides result without deleting successful history", async () => {
    const f = await fixture(), task = f.flow.reserve(await f.flow.prepare(f.request)), result = await f.flow.start(task.reservation);
    await change(f, "configuration"); const before = state(f); await expect(f.flow.read(task.reservation)).rejects.toBeDefined(); expect(state(f)).toEqual(before); expect(results(f)).toHaveLength(1); expect(table(f)).toMatchObject({ phase: "completed", created_at: result.createdAt });
  });
  it("a worker-emitted exit event cannot prove native resource end", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c); f.source.failOwnershipSemanticExecution(run.task.reservation, "PROVIDER_FAILED");
    c.worker().emit("exit", 0);
    expect(() => f.source.releaseOwnershipSemanticExecution(run.task.reservation, c.worker())).toThrow(); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
    expect(await run.outcome).toHaveProperty("error"); expect(c.worker().threadId).toBe(-1);
  });
  it("response validator wait observes a committed second-connection revision before any result write", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), g = holdMaterial(); c.reply(); await g.entered;
    const peer = new GraphStore(raw(f.settings).name); handles.add(peer); const ignore = peer.loadIgnoreSettings(f.ref.repositoryId); peer.saveIgnoreSettings(f.ref.repositoryId, ignore.revision, ["unused-now"]);
    g.release(); expect(await run.outcome).toHaveProperty("error"); expect(results(f)).toEqual([]);
  });
  it("publishing workspace wait rechecks original generation after real response validation", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), g = gate(), real = f.app.getSnapshotState.bind(f.app);
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => { const answer = await real(...args); g.enter(); await g.held; return answer; });
    c.reply(); await g.entered; await change(f, "main"); g.release(); expect(await run.outcome).toHaveProperty("error"); expect(results(f)).toEqual([]);
  });
  it("timeout requests native stop, keeps T1, and releases only after real worker exit", async () => {
    const f = await fixture(), c = controlled(f), task = c.flow.reserve(await c.flow.prepare(f.request));
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const outcome = c.flow.start(task.reservation).catch(error => error); await c.created; await vi.advanceTimersByTimeAsync(60_001);
    expect(await outcome).toMatchObject({ code: "TIMEOUT" }); expect(c.worker().threadId).toBe(-1); expect(table(f)).toMatchObject({ phase: "failed", created_at: task.createdAt }); expect(results(f)).toEqual([]); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("clock advance at promotion never replaces first persistent T1", async () => {
    const f = await fixture(), task = f.flow.reserve(await f.flow.prepare(f.request)); vi.useFakeTimers({ toFake: ["Date"] }); await vi.advanceTimersByTimeAsync(5_000);
    const published = await f.flow.start(task.reservation); expect(published.createdAt).toBe(task.createdAt); expect(table(f)).toMatchObject({ created_at: task.createdAt, phase: "completed" });
  });
  it("concurrent cancellation and response rejection share one native termination request", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), terminate = vi.spyOn(Worker.prototype, "terminate");
    await Promise.all([c.flow.cancel(run.task.reservation), c.flow.cancel(run.task.reservation), c.flow.cancel(run.task.reservation)]);
    expect(await run.outcome).toHaveProperty("error"); expect(terminate).toHaveBeenCalledTimes(1); expect(c.worker().threadId).toBe(-1); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(["authority", "source"])("second-gate actual %s BEGIN BUSY executes nothing and preserves original data", async where => {
    const f = await fixture(), c = controlled(f), task = c.flow.reserve(await c.flow.prepare(f.request)), peer = second(where === "authority" ? f.authority : f.source);
    peer.exec("BEGIN IMMEDIATE"); const old = f.source.listOwnershipAttempts(f.ref.repositoryId); await expect(c.flow.start(task.reservation)).rejects.toMatchObject({ code: "BUSY" });
    expect(c.createWorker).not.toHaveBeenCalled(); expect(results(f)).toEqual([]); expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(old); peer.exec("ROLLBACK"); await c.flow.cancel(task.reservation);
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each([false, true].flatMap(legacy => ["cancel", "invalid", "timeout", "policy"].map(reason => ({ legacy, reason }))))("same instance explicitly retries only after safe failure cleanup $reason legacy=$legacy", async ({ legacy, reason }) => {
    const f = await fixture("call-direction", legacy), c = controlled(f, reason === "invalid" ? "invalid" : "reply");
    const attempts = f.source.listOwnershipAttempts(f.ref.repositoryId), source = f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts"), mastery = raw(f.source).prepare("SELECT * FROM mastery_records").all();
    if (reason === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const run = await ready(f, c), oldWorker = c.worker();
    if (reason === "cancel") await c.flow.cancel(run.task.reservation);
    else if (reason === "invalid") c.reply();
    else if (reason === "policy") await change(f, "policy");
    else await vi.advanceTimersByTimeAsync(60_001);
    expect(await run.outcome).toHaveProperty("error"); vi.useRealTimers();
    expect(oldWorker.threadId).toBe(-1); expect(results(f)).toEqual([]);
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    const oldTask = raw(f.authority).prepare("SELECT * FROM ownership_semantic_tasks WHERE task_id=?").get(run.task.taskId);
    expect(table(f)).toMatchObject({ inflight: 0, created_at: run.task.createdAt, phase: reason === "cancel" ? "cancelled" : "failed" });
    const nextToken = await c.flow.prepare(f.request);
    // Preparation itself is a new preview, never an implicit dispatch or retry.
    expect(c.createWorker).toHaveBeenCalledTimes(1);
    const next = c.flow.reserve(nextToken); expect(next.taskId).not.toBe(run.task.taskId);
    await expect(c.flow.start(run.task.reservation)).rejects.toMatchObject({ code: "POLICY_INVALID" });
    await expect(c.flow.cancel(run.task.reservation)).rejects.toMatchObject({ code: "POLICY_INVALID" });
    c.createWorker.mockImplementationOnce(localWorker);
    expect(await c.flow.start(next.reservation)).toMatchObject({ identity: { taskId: next.taskId }, createdAt: next.createdAt });
    await expect(c.flow.start(next.reservation)).rejects.toMatchObject({ code: "BUSY" });
    expect(c.createWorker).toHaveBeenCalledTimes(2);
    expect(raw(f.authority).prepare("SELECT * FROM ownership_semantic_tasks WHERE task_id=?").get(run.task.taskId)).toEqual(oldTask);
    expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(attempts); expect(f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts")).toEqual(source); expect(raw(f.source).prepare("SELECT * FROM mastery_records").all()).toEqual(mastery);
  });

  it.each([false, true])("released cancellation waits for old validation/cancel settlement before new slot legacy=%s", async legacy => {
    const f = await fixture("call-direction", legacy), c = controlled(f), run = await ready(f, c), g = holdMaterial();
    c.reply(); await g.entered;
    await Promise.all([c.flow.cancel(run.task.reservation), c.flow.cancel(run.task.reservation)]);
    expect(c.worker().threadId).toBe(-1); expect(results(f)).toEqual([]); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    const before = state(f); await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" }); expect(state(f)).toEqual(before);
    g.release(); expect(await run.outcome).toMatchObject({ error: { code: "CANCELLED" } });
    const next = c.flow.reserve(await c.flow.prepare(f.request)); expect(next.taskId).not.toBe(run.task.taskId);
    const outcome = c.flow.start(next.reservation); const unchanged = state(f);
    await expect(c.flow.cancel(run.task.reservation)).rejects.toMatchObject({ code: "POLICY_INVALID" });
    await expect(c.flow.start(run.task.reservation)).rejects.toMatchObject({ code: "POLICY_INVALID" });
    expect(state(f)).toEqual(unchanged);
    // Wait for this second worker creation, not the first worker's resolved gate.
    await vi.waitFor(() => expect(c.createWorker).toHaveBeenCalledTimes(2)); c.reply();
    expect(await outcome).toMatchObject({ identity: { taskId: next.taskId } });
    expect(results(f)).toHaveLength(1);
  });
  it("pending native termination never admits a new preparation", async () => {
    const f = await fixture(), c = controlled(f), run = await ready(f, c), g = gate(), native = Worker.prototype.terminate;
    vi.spyOn(Worker.prototype, "terminate").mockImplementationOnce(async function (this: Worker) { g.enter(); await g.held; return native.call(this); });
    const cancellation = c.flow.cancel(run.task.reservation); await g.entered;
    expect(c.worker().threadId).not.toBe(-1); const before = state(f);
    await expect(c.flow.prepare(f.request)).rejects.toMatchObject({ code: "BUSY" }); expect(state(f)).toEqual(before);
    g.release(); await cancellation; await run.outcome;
    const next = c.flow.reserve(await c.flow.prepare(f.request)); expect(next.taskId).not.toBe(run.task.taskId); await c.flow.cancel(next.reservation);
  });

});
