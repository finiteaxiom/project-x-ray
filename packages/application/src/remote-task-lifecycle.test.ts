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

import { RemoteTaskLifecycle } from "./remote-task-lifecycle.js";
import { remoteResultSchema } from "@project-xray/contracts";
function idleWorker(){const w=new Worker("require('node:worker_threads').parentPort.on('message',()=>{});",{eval:true});workers.add(w);return w;}
function owned(f:Awaited<ReturnType<typeof fixture>>){
  f.flow.close();const lifecycle=new RemoteTaskLifecycle(f.authority);handles.add(lifecycle);
  const participant=lifecycle.create(f.context.ownerSessionId,["feature-explanation","ownership-semantic-assessment"],idleWorker);let actual!:Worker;
  const createWorker=vi.fn((prepared:{body:string})=>{lifecycle.create(f.context.ownerSessionId,["ownership-semantic-assessment"],()=>actual=localWorker(prepared));return actual;});
  const flow=new OwnershipSemanticApplication(f.authority,()=>({source:f.source,settings:f.settings}),{createWorker});handles.add(flow);lifecycle.bind(f.ref,f.settings,f.source);
  return {lifecycle,participant,flow,createWorker,actual:()=>actual};
}
async function reserveOwned(f:Awaited<ReturnType<typeof fixture>>,o:ReturnType<typeof owned>){const token=await o.lifecycle.operation(o.participant,"prepare",()=>o.flow.prepare(f.request));return o.lifecycle.admit(o.participant,()=>o.flow.reserve(token));}

describe("one trusted native lifecycle and exact recovery",()=>{
  it.each([false,true])("real Q3/B2 source-commit/global-failure window recovers without reexecution legacy=%s",async legacy=>{
    const f=await fixture("call-direction",legacy),o=owned(f),task=await reserveOwned(f,o),global=raw(f.authority),source=raw(f.source),attempts=f.source.listOwnershipAttempts(f.ref.repositoryId),saved=f.source.readSnapshotSource(f.ref.snapshotId,"flow.ts");
    global.exec("CREATE TABLE parent_failure(id INTEGER PRIMARY KEY);CREATE TABLE child_failure(id INTEGER REFERENCES parent_failure(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER completion_fault AFTER UPDATE ON ownership_semantic_tasks WHEN NEW.phase='completed' BEGIN INSERT INTO child_failure VALUES(1);END");
    if(legacy)global.exec("CREATE TRIGGER release_fault BEFORE UPDATE OF inflight ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'private');END");
    source.exec("CREATE TRIGGER cleanup_fault BEFORE DELETE ON ownership_semantic_results BEGIN SELECT RAISE(ABORT,'private');END");
    await expect(o.lifecycle.operation(o.participant,"work",()=>o.flow.start(task.reservation))).rejects.toMatchObject({message:"所有权语义执行失败"});
    expect(results(f)).toHaveLength(legacy?0:1);expect(table(f)).toMatchObject({phase:"failed",inflight:1,created_at:task.createdAt});expect(o.actual().threadId).toBe(-1);
    const old=global.prepare("SELECT * FROM ownership_semantic_tasks").all();source.exec("DROP TRIGGER cleanup_fault");global.exec("DROP TRIGGER completion_fault");if(legacy)global.exec("DROP TRIGGER release_fault");
    await expect(o.lifecycle.recover()).resolves.toMatchObject({released:true});expect(results(f)).toEqual([]);expect(global.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);expect(global.prepare("SELECT * FROM ownership_semantic_tasks").all()).toEqual(old.map(row=>({...row as object,inflight:0})));
    expect(o.createWorker).toHaveBeenCalledTimes(1);expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(attempts);expect(f.source.readSnapshotSource(f.ref.snapshotId,"flow.ts")).toEqual(saved);
    await expect(o.flow.start(task.reservation)).rejects.toMatchObject({code:"BUSY"});
  });
  it.each([false,true])("managed reserved Q3 has no execution and preserves first T1 legacy=%s",async legacy=>{
    const f=await fixture("call-direction",legacy),o=owned(f),task=await reserveOwned(f,o);expect(o.createWorker).not.toHaveBeenCalled();
    await o.lifecycle.recover();expect(table(f)).toMatchObject({phase:"interrupted",inflight:0,created_at:task.createdAt});expect(results(f)).toEqual([]);expect(o.createWorker).not.toHaveBeenCalled();
    expect(()=>o.lifecycle.admit(o.participant,()=>o.flow.start(task.reservation))).toThrow();
  });
  it.each([false,true])("reopening/unknown occupied execution cannot be adopted by a fresh same-owner worker legacy=%s",async legacy=>{
    const f=await fixture("call-direction",legacy),task=f.flow.reserve(await f.flow.prepare(f.request)),before=state(f),life=new RemoteTaskLifecycle(f.authority);handles.add(life);
    life.create(f.context.ownerSessionId,["ownership-semantic-assessment"],idleWorker);life.bind(f.ref,f.settings,f.source);
    await expect(life.recover()).rejects.toMatchObject({code:"POLICY_INVALID"});expect(state(f)).toEqual(before);expect(()=>new RemoteTaskLifecycle(f.authority)).toThrow();
    expect(persistedIdentity(f,task.taskId).taskId).toBe(task.taskId);
  });
  it("recovery freezes writes/events and waits for a retired asynchronous scope to settle",async()=>{
    const f=await fixture(),o=owned(f),task=await reserveOwned(f,o),g=gate(),before=state(f);
    const old=o.lifecycle.operation(o.participant,"work",async()=>{g.enter();await g.held;expect(()=>o.lifecycle.admit(o.participant,()=>f.authority.remote.finish(task.taskId,"CANCELLED"))).toThrow();});
    o.lifecycle.retire(o.participant);o.lifecycle.create(f.context.ownerSessionId,["ownership-semantic-assessment"],idleWorker);
    let done=false;const recovering=o.lifecycle.recover().then(value=>{done=true;return value;});await new Promise(resolve=>setTimeout(resolve,10));expect(done).toBe(false);expect(state(f)).toEqual(before);
    g.release();await expect(old).rejects.toMatchObject({code:"POLICY_INVALID"});expect(await recovering).toMatchObject({released:true});expect(table(f)).toMatchObject({phase:"interrupted"});
  });
  it.each([false,true].flatMap(legacy=>["reserved","dispatched","failed","cancelled","interrupted","completed"].map(phase=>({legacy,phase}))))("feature $phase uses the same actual native domain legacy=$legacy",async({legacy,phase})=>{
    const f=await fixture("call-direction",legacy),o=owned(f);f.authority.remote.saveAuthorization(f.ref.repositoryId,0,true);const id=featureIdentity(f);
    o.lifecycle.admit(o.participant,()=>f.authority.remote.immediate(()=>f.authority.remote.reserveDispatch(id)));
    const row=raw(f.authority).prepare("SELECT created_at FROM remote_provider_lease").get() as {created_at:string};
    let oldResult:unknown;
    if(phase!=="reserved"){
      // Actual reserved receipt is intentionally not reconstructed. Use strict
      // store promotion in this SQL fixture; no provider/HTTP is invoked.
      const shared=new SharedRemoteTaskStore(raw(f.authority),"global") as unknown as {promoteFeature(task:unknown,inflight:1):void};
      raw(f.authority).transaction(()=>shared.promoteFeature({identity:id,phase:"dispatched",createdAt:row.created_at,completedAt:null,code:null},1)).immediate();
      if(["failed","cancelled","interrupted"].includes(phase))f.authority.remote.finish(id.taskId,phase==="failed"?"INVALID_RESPONSE":phase==="cancelled"?"CANCELLED":"INTERRUPTED");
      if(phase==="completed"){
        const proof=f.snapshot.evidence.find(e=>e.kind==="call-expression")!,{id:proofId,kind,span,analyzer,analyzerVersion,confidence}=proof;
        const task=f.authority.remote.finish(id.taskId,null)!;
        const result=remoteResultSchema.parse({version:"1.0.0",identity:id,narrative:{version:"1.0.0",repositoryId:id.repositoryId,snapshotId:id.snapshotId,packageId:id.packageId,claims:[{text:"静态证据",evidenceIds:[proofId],confidence:"inferred"}],unknowns:[]},checkedAt:task.completedAt,completedAt:task.completedAt,localUnknowns:[],localLimitations:[],unknownEvidenceIds:[],localTruncation:{reasons:[],omittedNodes:0,omittedEdges:0,omittedProofs:0,omittedUnknowns:0,omittedLimitations:0,omittedFailures:0},citations:[{id:proofId,kind,span,analyzer,analyzerVersion,confidence,contentHash:f.snapshot.sourceFiles[0]!.contentHash,sliceSpan:span}]});
        f.source.remote.immediate(()=>f.source.remote.appendResult(result));oldResult=f.source.remote.result(id.taskId);
      }
    }
    const taskBefore=f.authority.remote.task(id.taskId);await o.lifecycle.recover();const task=f.authority.remote.task(id.taskId)!;
    expect(task.createdAt).toBe(row.created_at);expect(task.identity).toEqual(id);expect(task.phase).toBe(["reserved","dispatched"].includes(phase)?"interrupted":phase);
    if(!["reserved","dispatched"].includes(phase))expect(task).toEqual(taskBefore);
    expect(f.source.remote.result(id.taskId)).toEqual(phase==="completed"?oldResult:null);expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("unknown factory resources keep a genuinely managed reservation unchanged",async()=>{
    const f=await fixture(),o=owned(f);await reserveOwned(f,o);const before=state(f);
    expect(()=>o.lifecycle.create(f.context.ownerSessionId,["feature-explanation"],()=>{throw Error("private");})).toThrow();
    await expect(o.lifecycle.recover()).rejects.toMatchObject({code:"INTERRUPTED"});expect(state(f)).toEqual(before);
  });
  it("a managed worker of the wrong purpose cannot claim the semantic task",async()=>{
    const f=await fixture(),life=new RemoteTaskLifecycle(f.authority);handles.add(life);const producer=life.create(f.context.ownerSessionId,["feature-explanation"],idleWorker);
    const token=await f.flow.prepare(f.request);life.admit(producer,()=>f.flow.reserve(token));life.bind(f.ref,f.settings,f.source);const before=state(f);
    await expect(life.recover()).rejects.toMatchObject({code:"POLICY_INVALID"});expect(state(f)).toEqual(before);
  });
  it("managed task without a known source remains reserved and occupied",async()=>{
    const f=await fixture(),life=new RemoteTaskLifecycle(f.authority);handles.add(life);const producer=life.create(f.context.ownerSessionId,["ownership-semantic-assessment"],idleWorker);
    const token=await f.flow.prepare(f.request);life.admit(producer,()=>f.flow.reserve(token));const before=state(f);
    await expect(life.recover()).rejects.toMatchObject({code:"POLICY_INVALID"});expect(state(f)).toEqual(before);
  });
  it("close while old asynchronous scope waits cannot authorize database recovery",async()=>{
    const f=await fixture(),o=owned(f);await reserveOwned(f,o);const g=gate(),before=state(f);
    const pending=o.lifecycle.operation(o.participant,"work",()=>g.held).catch(error=>error),recovery=o.lifecycle.recover().catch(error=>error);
    o.lifecycle.close();g.release();expect(await pending).toMatchObject({code:"POLICY_INVALID"});expect(await recovery).toMatchObject({code:"POLICY_INVALID"});expect(state(f)).toEqual(before);
  });

  it("explicit rebinding of the same real source/settings permits safe retry after configuration drift",async()=>{
    const f=await fixture(),o=owned(f),task=await reserveOwned(f,o);const setting=f.settings.loadIgnoreSettings(f.ref.repositoryId);f.settings.saveIgnoreSettings(f.ref.repositoryId,setting.revision,["changed-current-policy"]);
    await expect(o.lifecycle.recover()).rejects.toMatchObject({code:"POLICY_INVALID"});expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
    o.lifecycle.bind(f.ref,f.settings,f.source);await expect(o.lifecycle.recover()).resolves.toMatchObject({released:true});expect(table(f)).toMatchObject({created_at:task.createdAt,phase:"interrupted",inflight:0});
  });

});
