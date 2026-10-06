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

describe("internal semantic candidate SQL", () => {
  it("publication recapture is issuer-only, SQL-scoped and rejects missing exact stored candidate", async () => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch();
    const candidate = f.lock(() => f.results.append(receipt, f.authority));
    expect(() => f.results.assertCandidate(candidate)).toThrowError(expect.objectContaining({ code: "INVALID_RECEIPT" }));
    f.lock(() => { expect(f.results.assertCandidate(candidate)).toEqual(f.envelope); expect(() => f.results.assertCandidate({ ...candidate } as never)).toThrow(); });
    raw(f.source).prepare("DELETE FROM ownership_semantic_results WHERE task_id=?").run(f.identity.taskId);
    f.lock(() => expect(() => f.results.assertCandidate(candidate)).toThrow());
    expect(f.tasks.read(f.identity.taskId)?.phase).toBe("dispatched"); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
  });
  it.each((["entry", "call-direction", "call-path", "variable-flow"] as const).flatMap(kind => [{ legacy: false, rules: false }, { legacy: false, rules: true }, { legacy: true, rules: false }, { legacy: true, rules: true }].map(layout => ({ ...layout, kind }))))("saved ignore revision governs prepare/read/reopen, current revision is separate $kind/$legacy/$rules", async ({ legacy, rules, kind }) => {
    const f = await fixture(legacy, rules, kind), savedRevision = f.material.capsule.sourceIdentity.ignoreRevision;
    expect(savedRevision).toBe(rules ? 1 : 0); expect(f.identity.ignoreRevision).toBe(savedRevision);
    const prepared = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(prepared, f.authority));
    expect((await f.results.readCandidate(f.identity.taskId))?.envelope).toEqual(f.envelope);
    raw(f.authority).transaction(() => { f.tasks.finish(f.identity, null, t2); f.tasks.release(f.identity); }).immediate();
    const ignore = f.source.loadIgnoreSettings(f.identity.repositoryId);
    f.source.saveIgnoreSettings(f.identity.repositoryId, ignore.revision, [...ignore.rules, "temporarily-unused"]);
    expect(f.source.loadIgnoreSettings(f.identity.repositoryId).revision).toBe(savedRevision! + 1);
    const snapshot = f.source.loadSnapshot(f.identity.snapshotId)!;
    f.source.saveSnapshot(snapshot, snapshot.sourceFiles.map(file => ({ filePath: file.filePath, ...f.source.readSnapshotSource(snapshot.snapshotId, file.filePath)! })), true);
    const activation = f.source.remote.activation(f.identity.repositoryId, f.identity.snapshotId).activation;
    expect(activation).not.toBe(f.identity.activation);
    expect((await f.results.readCandidate(f.identity.taskId))?.envelope).toEqual(f.envelope);
    const matching = await resign({ ...f.envelope, identity: { ...f.identity, taskId: randomUUID(), activation } });
    await expect(f.results.prepare(matching)).resolves.toBeDefined();
    const forged = await resign({ ...f.envelope, identity: { ...f.identity, taskId: randomUUID(), activation, ignoreRevision: savedRevision! + 1 } });
    const before = [state(raw(f.source)), state(raw(f.authority))];
    await expect(f.results.prepare(forged)).rejects.toMatchObject(safe);
    expect([state(raw(f.source)), state(raw(f.authority))]).toEqual(before);
    // Simulate an already persisted pre-fix row using real SQL and a real A2 task.
    f.dispatch(forged.identity); const db = raw(f.source), path = db.name;
    db.prepare("INSERT INTO ownership_semantic_results VALUES(?,?,?,?,?,?,?,?,?)").run(forged.identity.taskId, forged.identity.repositoryId, forged.identity.snapshotId,
      forged.identity.attemptId, forged.bindingHash, forged.responseDigest, forged.createdAt, forged.completedAt, canonicalJson(forged));
    const persisted = state(db), authority = state(raw(f.authority));
    await expect(f.results.readCandidate(forged.identity.taskId)).rejects.toMatchObject(safe);
    expect(state(db)).toBe(persisted); expect(state(raw(f.authority))).toBe(authority);
    f.source.close(); expect(() => new GraphStore(path, legacy ? "global" : "project")).toThrowError(expect.objectContaining(safe));
    const inspect = connect(path); expect(state(inspect)).toBe(persisted);
    if (!legacy) expect(state(raw(f.authority))).toBe(authority);
  });
  it.each([false, true])("actual indexed ready material append/read/compensate legacy=%s", async legacy => {
    const f = await fixture(legacy), old = state(raw(f.source)), receipt = await f.results.prepare(f.envelope); f.dispatch();
    const beforeAuthority = state(raw(f.authority)), candidate = f.lock(() => f.results.append(receipt, f.authority));
    expect(candidate.kind).toBe("stored-candidate"); expect(candidate.envelope).toEqual(f.envelope);
    if (!legacy) expect(state(raw(f.authority))).toBe(beforeAuthority);
    const read = await f.results.readCandidate(f.identity.taskId); expect(read?.envelope).toEqual(f.envelope);
    expect(() => f.lock(() => f.results.compensate(candidate, f.authority))).toThrowError(expect.objectContaining(safe));
    raw(f.authority).transaction(() => f.tasks.finish(f.identity, "PROVIDER_FAILED", t2)).immediate();
    f.lock(() => f.results.compensate(candidate, f.authority)); const removed = state(raw(f.source));
    f.lock(() => f.results.compensate(candidate, f.authority)); expect(state(raw(f.source))).toBe(removed);
    expect(await f.results.readCandidate(f.identity.taskId)).toBeNull(); expect(f.tasks.read(f.identity.taskId)?.phase).toBe("failed");
    expect(raw(f.authority).prepare("SELECT task_id FROM remote_provider_lease").get()).toEqual({ task_id: f.identity.taskId });
    if (!legacy) expect(removed).toBe(old); // Isolated source returns to its exact pre-append bytes.
    expect(f.source.listOwnershipAttempts(f.identity.repositoryId)).toEqual([f.material.attempt]);
    expect((await f.source.loadOwnershipSemanticPackage(f.identity.attemptId)).status).toBe("ready");
  });
  it("success history and same binding different task; late cleanup cannot touch newer slot", async () => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); const first = f.lock(() => f.results.append(receipt, f.authority));
    raw(f.authority).transaction(() => { f.tasks.finish(f.identity, null, t2); f.tasks.release(f.identity); }).immediate();
    const nextId = { ...f.identity, taskId: randomUUID() }, secondEnvelope = await resign({ ...f.envelope, identity: nextId }); const nextReceipt = await f.results.prepare(secondEnvelope); f.dispatch(nextId);
    const second = f.lock(() => f.results.append(nextReceipt, f.authority)); expect(first.envelope.bindingHash).toBe(second.envelope.bindingHash);
    const before = [state(raw(f.source)), state(raw(f.authority))]; expect(() => f.lock(() => f.results.compensate(first, f.authority))).toThrowError(expect.objectContaining(safe));
    expect([state(raw(f.source)), state(raw(f.authority))]).toEqual(before); expect((await f.results.readCandidate(f.identity.taskId))?.envelope).toEqual(f.envelope);
  });
  it("failed old candidate cleanup leaves a newer same-binding candidate and slot untouched", async () => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); const old = f.lock(() => f.results.append(receipt, f.authority));
    raw(f.authority).transaction(() => { f.tasks.finish(f.identity, "PROVIDER_FAILED", t2); f.tasks.release(f.identity); }).immediate();
    const next = { ...f.identity, taskId: randomUUID() }, envelope = await resign({ ...f.envelope, identity: next }), prepared = await f.results.prepare(envelope); f.dispatch(next);
    f.lock(() => f.results.append(prepared, f.authority)); const authority = state(raw(f.authority));
    f.lock(() => f.results.compensate(old, f.authority)); expect(state(raw(f.authority))).toBe(authority);
    expect(await f.results.readCandidate(f.identity.taskId)).toBeNull(); expect((await f.results.readCandidate(next.taskId))?.envelope).toEqual(envelope);
  });
  it("historical candidate stays readable after same snapshot activation changes; no currentness claim", async () => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(receipt, f.authority));
    raw(f.authority).transaction(() => { f.tasks.finish(f.identity, null, t2); f.tasks.release(f.identity); }).immediate();
    const snapshot = f.source.loadSnapshot(f.identity.snapshotId)!;
    f.source.saveSnapshot(snapshot, snapshot.sourceFiles.map(file => ({ filePath: file.filePath, ...f.source.readSnapshotSource(snapshot.snapshotId, file.filePath)! })), true);
    expect(f.source.getCurrentActivation()).not.toBe(f.identity.activation);
    expect((await f.results.readCandidate(f.identity.taskId))?.envelope).toEqual(f.envelope);
  });
  it.each(["criteria", "evidence", "limitation", "utf16", "attempt", "rubric", "source", "activation"])("rehashed outer %s cannot bypass actual materials/complete validator", async mode => {
    const f = await fixture(), value = structuredClone(f.envelope);
    if (mode === "criteria") value.response.criteria[0]!.criterionId = "other";
    if (mode === "evidence") value.response.criteria[0]!.evidenceIds = ["other"];
    if (mode === "limitation") value.response.criteria[0] = { criterionId: value.response.criteria[0]!.criterionId, verdict: "insufficient", explanation: "不能确认", evidenceIds: [], limitationIds: [h], answerRanges: [] };
    if (mode === "utf16") value.response.criteria[0]!.answerRanges = [{ start: f.material.attempt.semanticText.length - 1, end: f.material.attempt.semanticText.length }];
    if (mode === "attempt") value.identity.attemptHash = h;
    if (mode === "rubric") value.identity.rubricHash = h;
    if (mode === "source") value.identity.sourceManifestHash = h;
    if (mode === "activation") value.identity.activation = t1;
    const signed = await resign(value), before = state(raw(f.source)); await expect(f.results.prepare(signed)).rejects.toMatchObject(safe); expect(state(raw(f.source))).toBe(before);
  });
  it("private capture prevents caller mutation; getters never execute; foreign/repeated receipts and closed refuse", async () => {
    const f = await fixture(), value = structuredClone(f.envelope), pending = f.results.prepare(value); value.identity.bodyDigest = "b".repeat(64); value.response.criteria[0]!.explanation = "changed";
    const receipt = await pending; f.dispatch(); let hits = 0;
    const evil = Object.defineProperty(structuredClone(f.envelope), "response", { enumerable: true, get() { hits++; return f.envelope.response; } });
    await expect(f.results.prepare(evil)).rejects.toMatchObject(safe); expect(hits).toBe(0);
    const other = new OwnershipSemanticResultStore(raw(f.source), f.source); expect(() => f.lock(() => other.append(receipt, f.authority))).toThrow();
    expect(f.lock(() => f.results.append(receipt, f.authority)).envelope).toEqual(f.envelope);
    expect(() => f.lock(() => f.results.append(receipt, f.authority))).toThrow();
    other.close(); await expect(other.readCandidate(f.identity.taskId)).rejects.toMatchObject({ code: "INVALID_RECEIPT" });
  });
  it("source mutation while complete asynchronous material validation is held rejects preparation", async () => {
    const f = await fixture(), second = connect(raw(f.source).name); let entered!: () => void, release!: () => void, calls = 0;
    const inside = new Promise<void>(resolve => entered = resolve), held = new Promise<void>(resolve => release = resolve), digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { const result = await digest(...args); if (++calls === 3) { entered(); await held; } return result; });
    const pending = f.results.prepare(f.envelope), rejection = expect(pending).rejects.toMatchObject(safe); await inside;
    second.exec("UPDATE nodes SET name='changed'"); const before = state(raw(f.source)); release(); await rejection; expect(state(raw(f.source))).toBe(before);
  });
  it("ignored duplicate append cannot return success merely because the old exact row already exists", async () => {
    const f = await fixture(), first = await f.results.prepare(f.envelope), again = await f.results.prepare(f.envelope); f.dispatch();
    f.lock(() => f.results.append(first, f.authority)); const db = raw(f.source);
    db.exec("CREATE TRIGGER ignore_duplicate BEFORE INSERT ON ownership_semantic_results BEGIN SELECT RAISE(IGNORE); END"); const before = state(db);
    expect(() => f.lock(() => f.results.append(again, f.authority))).toThrowError(expect.objectContaining(safe)); expect(state(db)).toBe(before);
  });
  it.each(["attempt", "capsule", "binding", "snapshot", "overview", "source", "node", "edge", "evidence"])("second connection changes captured %s before synchronous write: zero append", async table => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); const second = connect(raw(f.source).name);
    const edits: Record<string, string> = { attempt: "UPDATE ownership_attempts SET concept_id='changed'", capsule: "UPDATE ownership_semantic_capsules SET attempt_hash='changed'",
      binding: "UPDATE ownership_question_bindings SET question_id='changed'", snapshot: "UPDATE snapshots SET root_path='changed'", overview: "UPDATE snapshot_overviews SET activated_at='changed'",
      source: "UPDATE source_snapshots SET content='changed'", node: "UPDATE nodes SET name='changed'", edge: "UPDATE edges SET source_id='changed'", evidence: "UPDATE evidence SET start_column=999" };
    second.exec(edits[table]!); const before = [state(raw(f.source)), state(raw(f.authority))];
    expect(() => f.lock(() => f.results.append(receipt, f.authority))).toThrowError(expect.objectContaining(safe)); expect([state(raw(f.source)), state(raw(f.authority))]).toEqual(before);
  });
  it.each(["reserved", "missing", "wrong-id", "wrong-t1", "wrong-purpose", "project-authority", "completed", "no-lock"])("actual authority %s rejects append without source writes", async mode => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope);
    if (mode === "reserved") raw(f.authority).transaction(() => f.tasks.reserve(f.identity, t1)).immediate();
    else if (mode === "wrong-purpose") {
      const id = remoteCapturedIdentitySchema.parse(Object.fromEntries(Object.keys(remoteCapturedIdentitySchema.shape).map(key => [key, key === "packageId" ? f.identity.assessmentPackageId : f.identity[key as keyof typeof f.identity]])));
      const shared = new SharedRemoteTaskStore(raw(f.authority), "global"); raw(f.authority).transaction(() => { shared.reserveFeature(id, t1); shared.promoteFeature({ identity: id, phase: "dispatched", createdAt: t1, completedAt: null, code: null }, 1); }).immediate();
    } else if (mode !== "missing") {
      const id = mode === "wrong-id" ? { ...f.identity, bodyDigest: "b".repeat(64) } : f.identity;
      raw(f.authority).transaction(() => { f.tasks.reserve(id, mode === "wrong-t1" ? t2 : t1); f.tasks.promote(id); if (mode === "completed") f.tasks.finish(id, null, t2); }).immediate();
    }
    const before = [state(raw(f.source)), state(raw(f.authority))]; expect(() => mode === "no-lock" ? f.results.append(receipt, f.authority) : f.lock(() => f.results.append(receipt, mode === "project-authority" ? f.source : f.authority))).toThrow();
    expect([state(raw(f.source)), state(raw(f.authority))]).toEqual(before);
  });
  it.each(["ignore", "wrong-payload", "wrong-target", "delete-ignore", "append-commit", "delete-commit"])("real SQL %s fault preserves task occupation and prior source state", async mode => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); let candidate: StoredSemanticCandidate | undefined;
    if (mode.startsWith("delete")) { candidate = f.lock(() => f.results.append(receipt, f.authority)); raw(f.authority).transaction(() => f.tasks.finish(f.identity, "PROVIDER_FAILED", t2)).immediate(); }
    const db = raw(f.source);
    if (mode === "ignore") db.exec("CREATE TRIGGER injected BEFORE INSERT ON ownership_semantic_results BEGIN SELECT RAISE(IGNORE); END");
    if (mode === "delete-ignore") db.exec("CREATE TRIGGER injected BEFORE DELETE ON ownership_semantic_results BEGIN SELECT RAISE(IGNORE); END");
    if (mode === "wrong-payload") db.exec(`CREATE TRIGGER injected BEFORE INSERT ON ownership_semantic_results WHEN NEW.completed_at='${t2}' BEGIN
      INSERT INTO ownership_semantic_results VALUES(NEW.task_id,NEW.repository_id,NEW.snapshot_id,NEW.attempt_id,NEW.binding_hash,NEW.response_digest,NEW.created_at,'2099-01-01T00:00:00Z',json_set(NEW.payload,'$.completedAt','2099-01-01T00:00:00Z')); SELECT RAISE(IGNORE); END`);
    if (mode === "wrong-target") { const other = randomUUID(); db.exec(`CREATE TRIGGER injected BEFORE INSERT ON ownership_semantic_results WHEN NEW.task_id='${f.identity.taskId}' BEGIN
      INSERT INTO ownership_semantic_results VALUES('${other}',NEW.repository_id,NEW.snapshot_id,NEW.attempt_id,NEW.binding_hash,NEW.response_digest,NEW.created_at,NEW.completed_at,json_set(NEW.payload,'$.identity.taskId','${other}')); SELECT RAISE(IGNORE); END`); }
    if (mode.endsWith("commit")) db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED)");
    const before = [state(db), state(raw(f.authority))];
    expect(() => f.lock(() => { if (candidate) f.results.compensate(candidate, f.authority); else f.results.append(receipt, f.authority); if (mode.endsWith("commit")) db.exec("INSERT INTO fault_child VALUES(1)"); })).toThrow();
    expect([state(db), state(raw(f.authority))]).toEqual(before);
  });
  it("actual two-connection BUSY preserves candidate, occupation and grades", async () => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); const second = connect(raw(f.source).name), before = [state(raw(f.source)), state(raw(f.authority))];
    second.exec("BEGIN IMMEDIATE"); try { expect(() => f.lock(() => f.results.append(receipt, f.authority))).toThrow(); } finally { second.exec("ROLLBACK"); }
    expect([state(raw(f.source)), state(raw(f.authority))]).toEqual(before);
  });
  it.each(["digest", "column", "inner-response"])("readCandidate rejects %s corruption without writing", async mode => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(receipt, f.authority)); const db = raw(f.source);
    if (mode === "digest") corrupt(db, () => db.exec("UPDATE ownership_semantic_results SET response_digest='" + h + "'"));
    if (mode === "column") corrupt(db, () => db.exec("UPDATE ownership_semantic_results SET repository_id='other'"));
    if (mode === "inner-response") {
      const value = structuredClone(f.envelope); value.response.criteria[0]!.evidenceIds = ["other"]; const signed = await resign(value);
      corrupt(db, () => db.prepare("UPDATE ownership_semantic_results SET payload=?,response_digest=?").run(canonicalJson(signed), signed.responseDigest));
    }
    const before = state(db); await expect(f.results.readCandidate(f.identity.taskId)).rejects.toMatchObject(safe); expect(state(db)).toBe(before);
  });
  it.each(["bad-hash", "bad-payload", "oversize"])("reopen rejects persisted %s without rewriting historical rows", async damage => {
    const f = await fixture(), receipt = await f.results.prepare(f.envelope); f.dispatch(); f.lock(() => f.results.append(receipt, f.authority)); const db = raw(f.source), path = db.name;
    corrupt(db, () => {
      if (damage === "bad-hash") db.exec("UPDATE ownership_semantic_results SET binding_hash='" + h + "'");
      else {
        db.pragma("ignore_check_constraints=ON"); db.prepare("UPDATE ownership_semantic_results SET payload=?").run(damage === "bad-payload" ? "private invalid payload" : JSON.stringify({ response: "x".repeat(280000) })); db.pragma("ignore_check_constraints=OFF");
      }
    });
    const before = state(db); f.source.close(); expect(() => new GraphStore(path, "project")).toThrowError(expect.objectContaining(safe)); const inspect = connect(path); expect(state(inspect)).toBe(before);
  });
});

describe("source migration18 strict preservation", () => {
  it.each([false, true])("pre18 actual indexed grade/capsule/question/source preserved legacy=%s", async legacy => {
    const f = await fixture(legacy), db = raw(f.source), path = db.name;
    for (const object of [...semanticResultObjects].reverse()) db.exec(`DROP ${object.type.toUpperCase()} ${object.name}`); db.exec("DELETE FROM schema_migrations WHERE version=18");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(t => t.name);
    const before = tables.map(name => ({ name, rows: db.prepare(`SELECT * FROM "${name}"`).all() })); f.source.close();
    const reopened = new GraphStore(path, legacy ? "global" : "project"); handles.push(reopened);
    for (const table of before) expect(raw(reopened).prepare(`SELECT * FROM "${table.name}"`).all().filter(row => table.name !== "schema_migrations" || (row as { version: number }).version !== 18)).toEqual(table.rows);
    expect(raw(reopened).prepare("SELECT * FROM ownership_semantic_results").all()).toEqual([]);
    expect((await reopened.loadOwnershipSemanticPackage(f.identity.attemptId)).status).toBe("ready");
  });
  it.each(["global", "project"] as const)("real pre18 %s layout adds empty objects only and reopens unchanged", async role => {
    const directory = await mkdtemp(join(tmpdir(), "xray-semantic-result-upgrade-")); roots.push(directory); const path = join(directory, "source.sqlite");
    const old = new GraphStore(path, role); handles.push(old); const db = raw(old);
    for (const object of [...semanticResultObjects].reverse()) db.exec(`DROP ${object.type.toUpperCase()} ${object.name}`); db.exec("DELETE FROM schema_migrations WHERE version=18");
    const before = state(db), tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(t => t.name);
    const rows = tables.map(name => ({ name, rows: db.prepare(`SELECT * FROM "${name}"`).all() })); old.close();
    const upgraded = new GraphStore(path, role); handles.push(upgraded);
    for (const table of rows) expect(raw(upgraded).prepare(`SELECT * FROM "${table.name}"`).all().filter(row => table.name !== "schema_migrations" || (row as { version: number }).version !== 18)).toEqual(table.rows);
    expect(raw(upgraded).prepare("SELECT count(*) n FROM ownership_semantic_results").get()).toEqual({ n: 0 });
    expect(raw(upgraded).prepare("SELECT version FROM schema_migrations WHERE version IN(11,13,17) ORDER BY version").all()).toEqual(role === "global" ? [{ version: 11 }, { version: 13 }, { version: 17 }] : [{ version: 11 }]);
    expect(state(raw(upgraded))).not.toBe(before); const after = state(raw(upgraded)); upgraded.close(); const reopened = new GraphStore(path, role); handles.push(reopened); expect(state(raw(reopened))).toBe(after);
  });
  it.each(["missing-table", "missing-trigger", "extra-column", "extra-object", "missing-marker", "partial", "marker-fault", "commit-fault"])("%s rejects without schema/marker healing", async damage => {
    const directory = await mkdtemp(join(tmpdir(), "xray-semantic-result-migration-")); roots.push(directory); const path = join(directory, "source.sqlite");
    const store = new GraphStore(path, "project"); handles.push(store); const db = raw(store);
    if (damage === "missing-table") db.exec("DROP TABLE ownership_semantic_results");
    if (damage === "missing-trigger") db.exec("DROP TRIGGER semantic_result_insert");
    if (damage === "extra-column") db.exec("ALTER TABLE ownership_semantic_results ADD COLUMN extra TEXT");
    if (damage === "extra-object") db.exec("CREATE INDEX semantic_result_extra ON ownership_semantic_results(task_id)");
    if (damage === "missing-marker") db.exec("DELETE FROM schema_migrations WHERE version=18");
    if (["partial", "marker-fault", "commit-fault"].includes(damage)) {
      for (const object of [...semanticResultObjects].reverse()) db.exec(`DROP ${object.type.toUpperCase()} ${object.name}`); db.exec("DELETE FROM schema_migrations WHERE version=18");
      if (damage === "partial") db.exec(semanticResultObjects[0].sql);
      if (damage === "marker-fault") db.exec("CREATE TRIGGER reject18 BEFORE INSERT ON schema_migrations WHEN NEW.version=18 BEGIN SELECT RAISE(ABORT,'private'); END");
      if (damage === "commit-fault") db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject18 AFTER INSERT ON schema_migrations WHEN NEW.version=18 BEGIN INSERT INTO fault_child VALUES(1); END");
    }
    const before = state(db); store.close(); expect(() => new GraphStore(path, "project")).toThrowError(expect.objectContaining(safe));
    const inspect = connect(path); expect(state(inspect)).toBe(before);
  });
});
