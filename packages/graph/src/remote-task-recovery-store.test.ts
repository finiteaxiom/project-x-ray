import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOwnershipSemanticResultEnvelope, canonicalJson, remoteCapturedIdentitySchema, type OwnershipSemanticCapturedIdentity, type OwnershipSemanticResultEnvelope,
  type OwnershipQuestion, type OwnershipQuestionRequest, type OwnershipSubmission, type OwnershipGrade, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "./index.js";
import { OwnershipSemanticTaskStore } from "./ownership-semantic-task-store.js";
import { SharedRemoteTaskStore } from "./shared-remote-task-store.js";
import { OwnershipSemanticResultStore, semanticResultObjects, type StoredSemanticCandidate } from "./ownership-semantic-result-store.js";

// Execute the existing indexing/grading fixture without adding an application
// dependency to the graph package or a production edge in its dependency graph.
interface FixtureApplication {
  indexProject(root: string): Promise<ProjectSnapshot>;
  createOwnershipQuestions(request: OwnershipQuestionRequest): Promise<OwnershipQuestion[]>;
  gradeOwnershipAnswer(submission: OwnershipSubmission): Promise<OwnershipGrade>;
  saveIgnoreSettings(request: { repositoryId: string; snapshotId: string; expectedRevision: number; rules: string[] }): unknown;
  close(): void;
}
const applicationModule = "../../application/src/index.js";
const { XRayApplication } = await import(applicationModule) as { XRayApplication: new(options: { databasePath: string; cacheRoot: string; projectDatabaseRoot?: string }) => FixtureApplication };

const handles: { close(): void }[] = [], roots: string[] = [];
const raw = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
const core = (store: GraphStore) => (store as unknown as { semanticResults: OwnershipSemanticResultStore }).semanticResults;
const t1 = "2026-10-05T01:00:00.123456Z", t2 = "2026-10-05T01:00:00.123457Z", h = "a".repeat(64);
const safe = { code: "INVALID_RESULT", message: "所有权语义结果存储失败" };
function state(db: Database.Database): string {
  const schema = db.prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name").all() as { name: string; type: string }[];
  return canonicalJson({ schema, rows: schema.filter(t => t.type === "table").map(t => ({ name: t.name, rows: db.prepare(`SELECT * FROM "${t.name}"`).all() })) });
}
function connect(path: string) { const db = new Database(path); handles.push(db); db.pragma("busy_timeout=1"); return db; }
afterEach(async () => {
  vi.restoreAllMocks(); for (const handle of handles.splice(0).reverse()) { if (handle instanceof Database) { if (handle.open) handle.close(); } else handle.close(); }
  for (const path of roots.splice(0)) { if (!resolve(path).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe fixture cleanup"); await rm(path, { recursive: true, force: true }); }
});
async function fixture(legacy = false, nonemptyRules = false, kind: OwnershipQuestion["kind"] = "call-direction") {
  const base = await mkdtemp(join(tmpdir(), "xray-semantic-result-")); roots.push(base); const project = join(base, "project"); await mkdir(project);
  await writeFile(join(project, "flow.ts"), "export let token=0;\nexport function leaf(){ return 1; }\nexport function middle(){ return leaf(); }\nexport function flow(){ token=1; const value=token; return token; }\nexport function start(){ return middle(); }\n");
  const app = new XRayApplication({ databasePath: join(base, "authority.sqlite"), cacheRoot: join(base, "cache"), ...(!legacy ? { projectDatabaseRoot: join(base, "sources") } : {}) }); handles.push(app);
  let snapshot = await app.indexProject(project);
  if (nonemptyRules) {
    app.saveIgnoreSettings({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, expectedRevision: 0, rules: ["never"] });
    snapshot = await app.indexProject(project);
  }
  const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  const question = (await app.createOwnershipQuestions({ ...ref, count: 20, scope: { kind: "project" } })).find(q => q.kind === kind)!;
  const check = question.deterministicChecks[0]!; let structuredAnswer: OwnershipSubmission["structuredAnswer"], edgeIds: string[];
  if (check.kind === "definition") { structuredAnswer = { kind: "entry", nodeId: check.nodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "call-direction") { structuredAnswer = { kind: "call-direction", callerNodeId: check.sourceNodeId, calleeNodeId: check.targetNodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "ordered-path") { structuredAnswer = { kind: "call-path", nodeIds: check.legalNodePaths[0]! }; edgeIds = check.legalEdgePaths[0]!; }
  else { const selected = check.requirements.flatMap(item => item.edgeIds.map(id => ({ role: item.role, id }))); structuredAnswer = { kind: "variable-flow", roles: selected.map((item, index) => ({ role: item.role, citationIndex: index })) }; edgeIds = selected.map(item => item.id); }
  const citations = edgeIds.map(id => { const evidence = snapshot.evidence.find(e => e.id === snapshot.edges.find(e => e.id === id)!.evidenceId)!; return { ...evidence.span, evidenceId: evidence.id }; });
  const grade = await app.gradeOwnershipAnswer({ ...ref, questionId: question.id, questionVersion: question.version, answer: "根据真实引用解释静态调用。🙂", selfConfidence: .5,
    structuredAnswer, citations }); expect(grade.passed).toBe(true);
  const internal = app as unknown as { legacyStore: GraphStore; snapshotStores: Map<string, GraphStore> };
  const authority = internal.legacyStore, source = internal.snapshotStores.get(ref.snapshotId)!, attempt = source.listOwnershipAttempts(ref.repositoryId).at(-1)!;
  const material = await source.loadOwnershipSemanticPackage(attempt.attemptId); if (material.status !== "ready") throw Error("Missing actual ready material");
  const pack = material.package, cap = material.capsule, activation = source.remote.activation(ref.repositoryId, ref.snapshotId);
  const identity: OwnershipSemanticCapturedIdentity = { protocolVersion: "1.0.0", ...ref, activation: activation.activation, analysisResultFingerprint: activation.analysisResultFingerprint,
    sourceManifestHash: activation.sourceManifestHash, configurationHash: activation.configurationHash, ignorePolicyHash: activation.ignorePolicyHash, ignoreRevision: cap.sourceIdentity.ignoreRevision!,
    questionId: question.id, questionVersion: question.version, questionFingerprint: cap.questionFingerprint, attemptId: attempt.attemptId, attemptHash: cap.attemptHash,
    deterministicScoringVersion: cap.deterministicScoringVersion, rubricVersion: "1.0.0", rubricHash: cap.rubric.rubricHash,
    semanticProtocolVersion: "ownership-semantic-assessment/1.0.0", semanticScoringVersion: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0",
    authorizationRevision: 1, provider: "openai", model: "fixture-model", providerRevision: 1, credentialRevision: 1,
    contextHandle: randomUUID(), contextEpoch: 1, ownerSessionId: randomUUID(), taskId: randomUUID(), assessmentPackageId: pack.assessmentPackageId, bodyDigest: h, limitsVersion: "1.0.0" };
  const response = { version: "1.0.0" as const, assessmentPackageId: pack.assessmentPackageId, criteria: pack.rubric.criteria.map(c => ({ criterionId: c.criterionId, verdict: "supported" as const,
    explanation: "静态源码支持该关系。", evidenceIds: [...c.requiredEvidenceIds], limitationIds: [], answerRanges: [{ ...c.answerScope[0]! }] })) };
  const envelope = await buildOwnershipSemanticResultEnvelope({ identity, createdAt: t1, completedAt: t2, response });
  const tasks = new OwnershipSemanticTaskStore(raw(authority), "global"), results = core(source);
  const lock = <T>(work: () => T) => raw(authority).transaction(() => raw(source).transaction(work).immediate()).immediate();
  const dispatch = (id = identity) => raw(authority).transaction(() => { tasks.reserve(id, t1); tasks.promote(id); }).immediate();
  return { app, base, source, authority, identity, envelope, tasks, results, lock, dispatch, material };
}
async function resign(value: OwnershipSemanticResultEnvelope) { return buildOwnershipSemanticResultEnvelope({ identity: value.identity, createdAt: value.createdAt, completedAt: value.completedAt, response: value.response }); }
function corrupt(db: Database.Database, work: () => void) { const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='semantic_result_immutable'").get() as { sql: string }).sql; db.exec("DROP TRIGGER semantic_result_immutable"); work(); db.exec(sql); }


function issuer(f: Awaited<ReturnType<typeof fixture>>) {
  const port = f.authority.openRemoteRecoveryIssuer();
  const binding = f.authority.bindRemoteRecoverySource({ repositoryId: f.identity.repositoryId, snapshotId: f.identity.snapshotId }, f.source, f.source);
  return { port, binding, permit: () => port.authorize(port.capture()) };
}
function occupied(f: Awaited<ReturnType<typeof fixture>>) { return raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all(); }
function taskRow(f: Awaited<ReturnType<typeof fixture>>) { return raw(f.authority).prepare("SELECT * FROM ownership_semantic_tasks WHERE task_id=?").get(f.identity.taskId); }
function sourceResult(f: Awaited<ReturnType<typeof fixture>>) { return raw(f.source).prepare("SELECT * FROM ownership_semantic_results WHERE task_id=?").get(f.identity.taskId); }

describe("private exact shared recovery SQL", () => {
  it.each([false, true].flatMap(legacy => ["reserved", "dispatched", "failed", "cancelled", "interrupted", "completed"].map(phase => ({ legacy, phase }))))("recovers exact semantic $phase history legacy=$legacy", async ({ legacy, phase }) => {
    const f = await fixture(legacy); let old: unknown;
    if (phase === "reserved") raw(f.authority).transaction(() => f.tasks.reserve(f.identity, t1)).immediate();
    else {
      const prepared = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(prepared, f.authority));
      if (!["dispatched", "completed"].includes(phase)) raw(f.authority).transaction(() => f.tasks.finish(f.identity, phase === "cancelled" ? "CANCELLED" : phase === "interrupted" ? "INTERRUPTED" : "INVALID_RESPONSE", t2)).immediate();
      if (phase === "completed") raw(f.authority).transaction(() => f.tasks.finish(f.identity, null, t2)).immediate();
      old=taskRow(f);
    }
    const beforeSource=f.source.readSnapshotSource(f.identity.snapshotId,"flow.ts"), beforeAttempts=f.source.listOwnershipAttempts(f.identity.repositoryId), oldResult=sourceResult(f), i=issuer(f);
    await expect(i.port.recover(i.permit(),[i.binding])).resolves.toMatchObject({released:true});
    expect(occupied(f)).toEqual([]); const task=f.tasks.read(f.identity.taskId)!;
    expect(task.createdAt).toBe(t1);expect(task.identity).toEqual(f.identity);expect(task.phase).toBe(["reserved","dispatched"].includes(phase)?"interrupted":phase);
    if (!["reserved","dispatched"].includes(phase)) expect(taskRow(f)).toEqual({...old as object,inflight:0});
    expect(sourceResult(f)).toEqual(phase==="completed"?oldResult:undefined);expect(f.source.readSnapshotSource(f.identity.snapshotId,"flow.ts")).toEqual(beforeSource);expect(f.source.listOwnershipAttempts(f.identity.repositoryId)).toEqual(beforeAttempts);
  });
  it.each(["unknown", "clone", "duplicate", "closed", "changed"])("source %s keeps occupation and never treats absence as cleanup",async kind=>{
    const f=await fixture();f.dispatch();const i=issuer(f), before=occupied(f);
    let bindings=[i.binding];if(kind==="unknown")bindings=[];if(kind==="clone")bindings=[{...i.binding}];if(kind==="duplicate")bindings=[i.binding,i.binding];if(kind==="closed")f.source.close();
    if(kind==="changed")raw(f.source).prepare("UPDATE source_snapshots SET content=content||' ' WHERE snapshot_id=?").run(f.identity.snapshotId);
    await expect(i.port.recover(i.permit(),bindings)).rejects.toBeDefined();expect(occupied(f)).toEqual(before);
  });
  it.each(["clone", "other-authority", "changed-state", "consumed", "closed"])("recovery permit %s cannot authorize SQL",async kind=>{
    const f=await fixture();f.dispatch();const i=issuer(f), permit=i.permit();let target=i.port;
    if(kind==="other-authority"){const g=new GraphStore(":memory:","global");handles.push(g);target=g.openRemoteRecoveryIssuer();}
    if(kind==="changed-state")f.authority.remote.commitTrustedContext(randomUUID(),null);
    if(kind==="consumed")await i.port.recover(permit,[i.binding]);
    const before=occupied(f);if(kind==="closed")f.authority.close();
    await expect(target.recover(kind==="clone"?{...permit}:permit,[i.binding])).rejects.toBeDefined();if(kind!=="closed")expect(occupied(f)).toEqual(before);
  });
  it.each([false,true].flatMap(legacy=>["terminal","delete","source-commit","release","global-commit"].map(fault=>({legacy,fault}))))("$fault failure preserves occupation and permits explicit new session legacy=$legacy",async({legacy,fault})=>{
    const f=await fixture(legacy), prepared=await f.results.prepare(f.envelope);f.dispatch();f.lock(()=>f.results.append(prepared,f.authority));const i=issuer(f), global=raw(f.authority),source=raw(f.source);
    if(fault==="terminal")global.exec("CREATE TRIGGER inject BEFORE UPDATE ON ownership_semantic_tasks WHEN NEW.phase='interrupted' BEGIN SELECT RAISE(ABORT,'private'); END");
    if(fault==="delete")source.exec("CREATE TRIGGER inject BEFORE DELETE ON ownership_semantic_results BEGIN SELECT RAISE(ABORT,'private'); END");
    if(fault==="release")global.exec("CREATE TRIGGER inject BEFORE UPDATE OF inflight ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'private'); END");
    if(fault==="source-commit"){source.exec("CREATE TABLE parent_fault(id INTEGER PRIMARY KEY);CREATE TABLE child_fault(id INTEGER REFERENCES parent_fault(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER inject AFTER DELETE ON ownership_semantic_results BEGIN INSERT INTO child_fault VALUES(1);END");}
    if(fault==="global-commit"){global.exec("CREATE TABLE parent_fault(id INTEGER PRIMARY KEY);CREATE TABLE child_fault(id INTEGER REFERENCES parent_fault(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER inject AFTER UPDATE OF inflight ON ownership_semantic_tasks BEGIN INSERT INTO child_fault VALUES(1);END");}
    const permit=i.permit();await expect(i.port.recover(permit,[i.binding])).rejects.toMatchObject({message:"远程解释未完成",progress:{terminalCommitted:fault!=="terminal",sourceCommitted:!legacy&&["release","global-commit"].includes(fault),released:false}});expect(occupied(f)).toHaveLength(1);await expect(i.port.recover(permit,[i.binding])).rejects.toBeDefined();
    (fault==="delete"||fault==="source-commit"?source:global).exec("DROP TRIGGER inject");
    await expect(i.port.recover(i.permit(),[i.binding])).resolves.toMatchObject({released:true});expect(sourceResult(f)).toBeUndefined();expect(f.tasks.read(f.identity.taskId)?.createdAt).toBe(t1);
  });
  it("a consumed old session cannot clear a subsequent slot",async()=>{
    const f=await fixture();f.dispatch();const i=issuer(f),permit=i.permit();await i.port.recover(permit,[i.binding]);
    const next={...f.identity,taskId:randomUUID()};raw(f.authority).transaction(()=>f.tasks.reserve(next,t2)).immediate();const before=occupied(f);
    await expect(i.port.recover(permit,[i.binding])).rejects.toBeDefined();expect(occupied(f)).toEqual(before);
  });
  it("actual second-connection BEGIN BUSY consumes only that session and preserves T1/lease",async()=>{
    const f=await fixture();f.dispatch();const i=issuer(f),permit=i.permit(),peer=new Database(raw(f.authority).name);handles.push(peer);peer.exec("BEGIN IMMEDIATE");const before=occupied(f);
    await expect(i.port.recover(permit,[i.binding])).rejects.toMatchObject({code:"BUSY",progress:{terminalCommitted:false,released:false}});expect(occupied(f)).toEqual(before);peer.exec("ROLLBACK");
    await i.port.recover(i.permit(),[i.binding]);expect(f.tasks.read(f.identity.taskId)?.createdAt).toBe(t1);
  });
  it.each(["provider","material"])("second connection changes %s while real R1 crypto validation waits: no compensation/release",async change=>{
    const f=await fixture(),prepared=await f.results.prepare(f.envelope);f.dispatch();f.lock(()=>f.results.append(prepared,f.authority));const i=issuer(f);let entered!:()=>void,release!:()=>void;
    const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r),native=crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle,"digest").mockImplementationOnce(async(...args)=>{const value=await native(...args);entered();await held;return value;});
    const pending=i.port.recover(i.permit(),[i.binding]).catch(error=>error);await waiting;
    if(change==="provider"){const other=new GraphStore(raw(f.authority).name,"global");handles.push(other);other.remote.saveProvider(0,{provider:"openai",model:"changed",outputTokens:128,credentialStatus:"unconfigured",credentialRevision:0});}
    else{const peer=new Database(raw(f.source).name);handles.push(peer);peer.prepare("UPDATE nodes SET payload=json_set(payload,'$.name','changed') WHERE snapshot_id=?").run(f.identity.snapshotId);}
    release();expect(await pending).toMatchObject({progress:{terminalCommitted:true,released:false}});expect(occupied(f)).toHaveLength(1);expect(sourceResult(f)).toBeDefined();
  });
  it("terminal SQL side effects cannot silently change captured contexts",async()=>{
    const f=await fixture();f.dispatch();const i=issuer(f),owner=randomUUID(),handle=randomUUID(),payload=JSON.stringify({ownerSessionId:owner,contextHandle:handle,epoch:1,active:false,reference:null});
    raw(f.authority).exec(`CREATE TRIGGER inject AFTER UPDATE ON ownership_semantic_tasks WHEN NEW.phase='interrupted' BEGIN INSERT INTO explanation_contexts VALUES('${owner}','${handle}','${payload}');END`);
    await expect(i.port.recover(i.permit(),[i.binding])).rejects.toMatchObject({progress:{terminalCommitted:false,released:false}});expect(f.tasks.read(f.identity.taskId)?.phase).toBe("dispatched");expect(occupied(f)).toHaveLength(1);
  });
  it("context write IGNORE after source cleanup never releases the lease",async()=>{
    const f=await fixture(),prepared=await f.results.prepare(f.envelope);f.dispatch();f.lock(()=>f.results.append(prepared,f.authority));const i=issuer(f);
    raw(f.authority).exec("CREATE TRIGGER inject BEFORE INSERT ON explanation_contexts BEGIN SELECT RAISE(IGNORE);END");
    await expect(i.port.recover(i.permit(),[i.binding])).rejects.toMatchObject({progress:{terminalCommitted:true,sourceCommitted:true,released:false}});expect(sourceResult(f)).toBeUndefined();expect(occupied(f)).toHaveLength(1);
    raw(f.authority).exec("DROP TRIGGER inject");await i.port.recover(i.permit(),[i.binding]);expect(occupied(f)).toEqual([]);
  });

  it("a different issuer on the same authority cannot borrow a capture or permit",async()=>{
    const f=await fixture();f.dispatch();const i=issuer(f),other=f.authority.openRemoteRecoveryIssuer(),capture=i.port.capture(),permit=i.permit(),before=occupied(f);
    expect(()=>other.authorize(capture)).toThrow();await expect(other.recover(permit,[i.binding])).rejects.toBeDefined();expect(occupied(f)).toEqual(before);await i.port.recover(permit,[i.binding]);
  });
  it("closing the owning session during actual R1 validation preserves its candidate and lease",async()=>{
    const f=await fixture(),prepared=await f.results.prepare(f.envelope);f.dispatch();f.lock(()=>f.results.append(prepared,f.authority));const i=issuer(f);let entered!:()=>void,release!:()=>void;
    const held=new Promise<void>(r=>release=r),waiting=new Promise<void>(r=>entered=r),native=crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle,"digest").mockImplementationOnce(async(...args)=>{const value=await native(...args);entered();await held;return value;});
    const pending=i.port.recover(i.permit(),[i.binding]).catch(error=>error);await waiting;i.port.close();release();expect(await pending).toMatchObject({progress:{terminalCommitted:true,sourceCommitted:false,released:false}});
    expect(sourceResult(f)).toBeDefined();expect(occupied(f)).toHaveLength(1);expect(()=>i.port.capture()).toThrow();
  });

  it("an empty foreign settings store's default policy is not repository ownership evidence",async()=>{
    const f=await fixture(),foreign=new GraphStore(":memory:","project");handles.push(foreign);f.dispatch();const before=occupied(f);
    expect(()=>f.authority.bindRemoteRecoverySource({repositoryId:f.identity.repositoryId,snapshotId:f.identity.snapshotId},foreign,f.source)).toThrow();expect(occupied(f)).toEqual(before);
  });

  it("legacy source with separately owned project settings retains historical semantic validation",async()=>{
    const f=await fixture(true),settings=new GraphStore(":memory:","project");handles.push(settings);settings.saveIgnoreSettings(f.identity.repositoryId,0,["new-current-config"]);
    const prepared=await f.results.prepare(f.envelope);f.dispatch();f.lock(()=>f.results.append(prepared,f.authority));const port=f.authority.openRemoteRecoveryIssuer(),binding=f.authority.bindRemoteRecoverySource({repositoryId:f.identity.repositoryId,snapshotId:f.identity.snapshotId},settings,f.source),config=settings.loadIgnoreSettings(f.identity.repositoryId);
    await port.recover(port.authorize(port.capture()),[binding]);expect(sourceResult(f)).toBeUndefined();expect(settings.loadIgnoreSettings(f.identity.repositoryId)).toEqual(config);expect(f.tasks.read(f.identity.taskId)?.createdAt).toBe(t1);
  });

});

// Fresh indexing and actual grading are required for these integrity regressions.
// Compatibility mastery is explicitly saved from the actual answer, not inferred
// from an empty legacy table or copied from a historical review database.
import { remoteResultSchema, type RemoteCapturedIdentity } from "@project-xray/contracts";
const integrityTables = ["snapshots", "source_snapshots", "snapshot_overviews", "nodes", "edges", "evidence", "ownership_attempts", "ownership_semantic_capsules", "ownership_question_bindings", "mastery_records"];
function integrityHistory(f: Awaited<ReturnType<typeof fixture>>) {
  return canonicalJson(integrityTables.map(table => [table, raw(f.source).prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}
function saveActualMastery(f: Awaited<ReturnType<typeof fixture>>) {
  const attempt = f.source.listOwnershipAttempts(f.identity.repositoryId).find(a => !a.legacy)!;
  expect(attempt).toBeDefined();
  f.source.saveMastery({ repositoryId: f.identity.repositoryId, snapshotId: f.identity.snapshotId, questionId: attempt.questionId,
    concept: attempt.concept.label, score: attempt.locationScore, completedAt: attempt.completedAt });
  expect(f.source.listMastery(f.identity.snapshotId)).toHaveLength(1);
  expect(raw(f.source).prepare("SELECT * FROM ownership_question_bindings").all()).not.toHaveLength(0);
}
async function integrityFixture(legacy: boolean, purpose: "feature" | "semantic", phase = "completed") {
  const f = await fixture(legacy); saveActualMastery(f);
  let id: RemoteCapturedIdentity | OwnershipSemanticCapturedIdentity;
  if (purpose === "semantic") {
    id = f.identity; f.authority.remote.commitTrustedContext(id.ownerSessionId, null);
    if (phase === "reserved") raw(f.authority).transaction(() => f.tasks.reserve(f.identity, t1)).immediate();
    else {
      const prepared = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(prepared, f.authority));
      if (phase === "completed") raw(f.authority).transaction(() => f.tasks.finish(f.identity, null, t2)).immediate();
      else if (phase !== "dispatched") raw(f.authority).transaction(() => f.tasks.finish(f.identity, phase === "failed" ? "INVALID_RESPONSE" : phase === "cancelled" ? "CANCELLED" : "INTERRUPTED", t2)).immediate();
    }
  } else {
    const activation = f.source.remote.activation(f.identity.repositoryId, f.identity.snapshotId), owner = randomUUID();
    const context = f.authority.remote.commitTrustedContext(owner, activation);
    id = remoteCapturedIdentitySchema.parse({ protocolVersion: "1.0.0", ...activation, taskId: randomUUID(), ownerSessionId: owner,
      contextHandle: context.contextHandle, contextEpoch: context.epoch, ignoreRevision: f.source.loadIgnoreSettings(f.identity.repositoryId).revision,
      authorizationRevision: 1, providerRevision: 0, credentialRevision: 0, packageId: h, bodyDigest: h, limitsVersion: "1.0.0" });
    const featureId = id, shared = new SharedRemoteTaskStore(raw(f.authority), "global");
    raw(f.authority).transaction(() => shared.reserveFeature(featureId, t1)).immediate();
    if (phase !== "reserved") {
      raw(f.authority).transaction(() => shared.promoteFeature({ identity: featureId, phase: "dispatched", code: null, createdAt: t1, completedAt: null }, 1)).immediate();
      if (phase === "completed") f.authority.remote.finish(id.taskId, null);
      else if (phase !== "dispatched") f.authority.remote.finish(id.taskId, phase === "failed" ? "INVALID_RESPONSE" : phase === "cancelled" ? "CANCELLED" : "INTERRUPTED");
      const snapshot = f.source.loadSnapshot(id.snapshotId)!, proof = snapshot.evidence.find(e => e.kind === "call-expression")!;
      expect(proof).toBeDefined(); const ended = f.authority.remote.task(id.taskId)!.completedAt ?? t2;
      const result = remoteResultSchema.parse({ version: "1.0.0", identity: id, narrative: { version: "1.0.0", repositoryId: id.repositoryId, snapshotId: id.snapshotId,
        packageId: id.packageId, claims: [{ text: "实际静态源码证据", evidenceIds: [proof.id], confidence: "inferred" }], unknowns: [] }, checkedAt: ended, completedAt: ended,
        localUnknowns: [], localLimitations: [], unknownEvidenceIds: [], localTruncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 },
        citations: [{ id: proof.id, kind: proof.kind, span: proof.span, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: proof.confidence, contentHash: snapshot.sourceFiles.find(file => file.filePath === proof.span.filePath)!.contentHash, sliceSpan: proof.span }] });
      f.source.remote.immediate(() => f.source.remote.appendResult(result));
    }
  }
  const port = f.authority.openRemoteRecoveryIssuer(), binding = f.authority.bindRemoteRecoverySource({ repositoryId: id.repositoryId, snapshotId: id.snapshotId }, f.source, f.source);
  const table = purpose === "feature" ? "remote_explanations" : "ownership_semantic_results";
  const result = () => raw(f.source).prepare(`SELECT * FROM ${table} WHERE task_id=?`).get(id.taskId);
  const task = () => raw(f.authority).prepare(`SELECT * FROM ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHERE task_id=?`).get(id.taskId);
  return { ...f, id, port, binding, table, result, task, recover: () => port.recover(port.authorize(port.capture()), [binding]) };
}

describe("recovery committed result and complete history integrity", () => {
  it.each([false, true].flatMap(legacy => ["reserved", "dispatched", "failed", "cancelled", "interrupted", "completed"].map(phase => ({ legacy, phase }))))("fresh feature $phase retains nonempty history legacy=$legacy", async ({ legacy, phase }) => {
    const f = await integrityFixture(legacy, "feature", phase), before = integrityHistory(f), result = f.result();
    await expect(f.recover()).resolves.toMatchObject({ released: true });
    expect(occupied(f)).toEqual([]); expect(integrityHistory(f)).toBe(before);
    expect(f.authority.remote.task(f.id.taskId)).toMatchObject({ createdAt: t1, identity: f.id, phase: ["reserved", "dispatched"].includes(phase) ? "interrupted" : phase });
    expect(f.result()).toEqual(phase === "completed" ? result : undefined);
  });
  it.each(["delete", "valid-change"])("completed feature rejects external source COMMIT window %s without claiming external rollback", async fault => {
    const f = await integrityFixture(false, "feature"), db = raw(f.source), beforeTask = f.task(), before = integrityHistory(f), result = f.result();
    const contexts = raw(f.authority).prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all(); let cut = false;
    const exec = db.exec.bind(db);
    vi.spyOn(db, "exec").mockImplementation(sql => {
      const value = exec(sql);
      if (sql === "COMMIT" && !cut) {
        cut = true; const peer = new GraphStore(db.name, "project"); handles.push(peer);
        if (fault === "delete") raw(peer).prepare("DELETE FROM remote_explanations WHERE task_id=?").run(f.id.taskId);
        else {
          const old = peer.remote.result(f.id.taskId)!;
          const changed = remoteResultSchema.parse({ ...old, narrative: { ...old.narrative, claims: old.narrative.claims.map(c => ({ ...c, text: "结构仍合法，但内容由第二连接改写" })) } });
          raw(peer).prepare("UPDATE remote_explanations SET payload=? WHERE task_id=?").run(JSON.stringify(changed), f.id.taskId);
        }
        peer.close();
      }
      return value;
    });
    await expect(f.recover()).rejects.toMatchObject({ code: "POLICY_INVALID", progress: { terminalCommitted: true, sourceCommitted: true, released: false } });
    expect(cut).toBe(true); expect(occupied(f)).toHaveLength(1); expect(f.task()).toEqual(beforeTask); expect(f.result()).not.toEqual(result);
    expect(integrityHistory(f)).toBe(before); expect(raw(f.authority).prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all()).toEqual(contexts);
  });
  it.each(["feature", "semantic"].flatMap(purpose => ["context-source", "context-attempt", "context-mastery", "context-result", "context-ignore", "release-source", "global-commit"].map(fault => ({ purpose: purpose as "feature" | "semantic", fault }))))("legacy $purpose $fault rolls back history and permits fresh manual retry", async ({ purpose, fault }) => {
    const f = await integrityFixture(true, purpose), db = raw(f.authority), history = integrityHistory(f), result = f.result(), task = f.task(), contexts = db.prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all();
    if (fault.startsWith("context-")) {
      const body = fault === "context-source" ? "UPDATE source_snapshots SET content=content||' ';" : fault === "context-attempt" ? "DELETE FROM ownership_attempts;" : fault === "context-mastery" ? "DELETE FROM mastery_records;" : fault === "context-result"
        ? `DELETE FROM ${f.table};` : "SELECT RAISE(IGNORE);";
      db.exec(`CREATE TRIGGER integrity_inject ${fault === "context-ignore" ? "BEFORE" : "AFTER"} UPDATE ON explanation_contexts BEGIN ${body} END`);
    } else if (fault === "release-source") db.exec(`CREATE TRIGGER integrity_inject AFTER UPDATE OF inflight ON ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHEN NEW.inflight=0 BEGIN UPDATE source_snapshots SET content=content||' '; END`);
    else db.exec(`CREATE TABLE integrity_parent(id INTEGER PRIMARY KEY); CREATE TABLE integrity_child(id INTEGER REFERENCES integrity_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER integrity_inject AFTER UPDATE OF inflight ON ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHEN NEW.inflight=0 BEGIN INSERT INTO integrity_child VALUES(1); END`);
    await expect(f.recover()).rejects.toMatchObject({ progress: { terminalCommitted: true, sourceCommitted: false, released: false } });
    expect(integrityHistory(f)).toBe(history); expect(f.result()).toEqual(result); expect(f.task()).toEqual(task); expect(occupied(f)).toHaveLength(1);
    expect(db.prepare("SELECT * FROM explanation_contexts ORDER BY rowid").all()).toEqual(contexts);
    db.exec("DROP TRIGGER integrity_inject"); await expect(f.recover()).resolves.toMatchObject({ released: true });
    expect(f.result()).toEqual(result); expect(integrityHistory(f)).toBe(history); expect(occupied(f)).toEqual([]);
  });
  it.each([false, true].flatMap(legacy => ["feature", "semantic"].flatMap(purpose => ["source", "attempt", "mastery", "ignore"].map(fault => ({ legacy, purpose: purpose as "feature" | "semantic", fault })))))("$purpose cleanup $fault guards actual history and retry legacy=$legacy", async ({ legacy, purpose, fault }) => {
    const f = await integrityFixture(legacy, purpose, "failed"), source = raw(f.source), history = integrityHistory(f), result = f.result(), task = f.task();
    const body = fault === "source" ? "UPDATE source_snapshots SET content=content||' ';" : fault === "attempt" ? "DELETE FROM ownership_attempts;" : fault === "mastery" ? "DELETE FROM mastery_records;" : "SELECT RAISE(IGNORE);";
    source.exec(`CREATE TRIGGER integrity_inject ${fault === "ignore" ? "BEFORE" : "AFTER"} DELETE ON ${f.table} BEGIN ${body} END`);
    await expect(f.recover()).rejects.toMatchObject({ progress: { terminalCommitted: true, sourceCommitted: false, released: false } });
    expect(f.task()).toEqual(task); expect(f.result()).toEqual(result); expect(integrityHistory(f)).toBe(history); expect(occupied(f)).toHaveLength(1);
    source.exec("DROP TRIGGER integrity_inject"); await expect(f.recover()).resolves.toMatchObject({ released: true });
    expect(f.result()).toBeUndefined(); expect(integrityHistory(f)).toBe(history); expect(occupied(f)).toEqual([]);
  });
});
describe("recovery binds all known history, not only the occupied snapshot", () => {
  it.each(["other-snapshot", "other-settings"])("legacy final side effect on %s is rejected and rolled back", async fault => {
    const f = await integrityFixture(true, "feature"), g = await fixture(true), other = g.source.loadSnapshot(g.identity.snapshotId)!;
    f.source.saveSnapshot(other, other.sourceFiles.map(file => ({ filePath: file.filePath, ...g.source.readSnapshotSource(other.snapshotId, file.filePath)! })), true);
    const attempt = g.source.listOwnershipAttempts(other.repositoryId).find(a => !a.legacy)!;
    f.source.saveMastery({ repositoryId: other.repositoryId, snapshotId: other.snapshotId, questionId: attempt.questionId, concept: attempt.concept.label, score: attempt.locationScore, completedAt: attempt.completedAt });
    f.source.saveIgnoreSettings(other.repositoryId, 0, ["recorded-other-policy"]);
    expect(raw(f.source).prepare("SELECT DISTINCT snapshot_id FROM source_snapshots").all()).toHaveLength(2);
    const before = integrityHistory(f), settings = raw(f.source).prepare("SELECT * FROM project_ignore_settings ORDER BY rowid").all(), result = f.result();
    const binding = f.authority.bindRemoteRecoverySource({ repositoryId: f.id.repositoryId, snapshotId: f.id.snapshotId }, f.source, f.source);
    const body = fault === "other-snapshot" ? `DELETE FROM mastery_records WHERE snapshot_id='${other.snapshotId}'; UPDATE source_snapshots SET content=content||' ' WHERE snapshot_id='${other.snapshotId}';` : `DELETE FROM project_ignore_settings WHERE repository_id='${other.repositoryId}';`;
    raw(f.authority).exec(`CREATE TRIGGER integrity_inject AFTER UPDATE ON explanation_contexts BEGIN ${body} END`);
    const recover = () => f.port.recover(f.port.authorize(f.port.capture()), [binding]);
    await expect(recover()).rejects.toMatchObject({ code: "POLICY_INVALID", progress: { released: false } });
    expect(occupied(f)).toHaveLength(1); expect(integrityHistory(f)).toBe(before); expect(f.result()).toEqual(result);
    expect(raw(f.source).prepare("SELECT * FROM project_ignore_settings ORDER BY rowid").all()).toEqual(settings);
    raw(f.authority).exec("DROP TRIGGER integrity_inject"); await expect(recover()).resolves.toMatchObject({ released: true });
    expect(integrityHistory(f)).toBe(before); expect(f.result()).toEqual(result);
  });
});

it.each(["true", "false", "promise"])("context veto %s refuses before terminal and does not authorize SQL recovery", async kind => {
  const f = await fixture(); f.dispatch(); const i = issuer(f), before = state(raw(f.authority)), source = state(raw(f.source));
  const veto = () => kind === "promise" ? Promise.resolve() : kind === "true";
  await expect(i.port.recover(i.permit(), [i.binding], veto)).rejects.toMatchObject({ code: "POLICY_INVALID", progress: { terminalCommitted: false, sourceCommitted: false, released: false } });
  expect(state(raw(f.authority))).toBe(before); expect(state(raw(f.source))).toBe(source);
  await expect(i.port.recover(i.permit(), [i.binding])).resolves.toMatchObject({ released: true });
});
it("context veto is rechecked after actual candidate digest before compensation", async () => {
  const f = await fixture(), prepared = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(prepared, f.authority)); const i = issuer(f);
  let reject = false, entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r), real = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); entered(); await held; return value; });
  const pending = i.port.recover(i.permit(), [i.binding], () => { if (reject) throw Error("context changed"); }).catch(error => error); await waiting;
  const before = state(raw(f.authority)), source = state(raw(f.source)); reject = true; release();
  expect(await pending).toMatchObject({ code: "POLICY_INVALID", progress: { terminalCommitted: true, sourceCommitted: false, released: false } });
  expect(state(raw(f.authority))).toBe(before); expect(state(raw(f.source))).toBe(source); expect(occupied(f)).toHaveLength(1);
  reject = false; await expect(i.port.recover(i.permit(), [i.binding], () => { if (reject) throw Error("context changed"); })).resolves.toMatchObject({ released: true }); expect(sourceResult(f)).toBeUndefined();
});
