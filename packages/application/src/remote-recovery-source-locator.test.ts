import { createRequire, syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readdir, copyFile } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphStore } from "@project-xray/graph";
import { buildOwnershipSemanticResultEnvelope, canonicalJson, remoteCapturedIdentitySchema, remoteResultSchema,
  type OwnershipSemanticCapturedIdentity, type OwnershipSemanticResultEnvelope, type OwnershipSubmission, type RemoteCapturedIdentity, type RemoteFailureCode } from "@project-xray/contracts";
import { XRayApplication } from "./index.js";
import { heldStoreRemoteRecovery } from "./remote-recovery-source-locator.js";
interface Raw { name: string; open: boolean; inTransaction: boolean; prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }; exec(sql: string): void; close(): void; pragma(sql: string): unknown; transaction<T>(work: () => T): { immediate(): T; (): T } }
interface SemanticTasks { reserve(id: OwnershipSemanticCapturedIdentity, time: string): unknown; promote(id: OwnershipSemanticCapturedIdentity): unknown; finish(id: OwnershipSemanticCapturedIdentity, code: RemoteFailureCode | null, time: string): unknown }
interface ResultPort { prepare(value: OwnershipSemanticResultEnvelope): Promise<object>; append(value: object, authority: GraphStore): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new(path: string) => Raw;
const taskModule = "../../graph/src/ownership-semantic-task-store.js", sharedModule = "../../graph/src/shared-remote-task-store.js";
const { OwnershipSemanticTaskStore } = await import(taskModule) as { OwnershipSemanticTaskStore: new(db: Raw, role: "global") => SemanticTasks };
const { SharedRemoteTaskStore } = await import(sharedModule) as { SharedRemoteTaskStore: new(db: Raw, role: "global") => { reserveFeature(id: RemoteCapturedIdentity, time: string): unknown; promoteFeature(value: { identity: RemoteCapturedIdentity; phase: "dispatched"; code: null; createdAt: string; completedAt: null }, inflight: 1): unknown } };
const raw = (store: GraphStore) => (store as unknown as { database: Raw }).database;
const internal = (app: XRayApplication) => app as unknown as { legacyStore: GraphStore; stores: Map<string, GraphStore>; snapshotStores: Map<string, GraphStore>; requireSnapshot: (...args: unknown[]) => unknown; storeForRepository: (...args: unknown[]) => unknown };
const roots: string[] = [], handles: { close(): void }[] = [], workers: Worker[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const worker of workers.splice(0)) await Worker.prototype.terminate.call(worker); for (const handle of handles.splice(0).reverse()) handle.close(); for (const p of roots.splice(0)) { if (!resolve(p).startsWith(resolve(tmpdir()) + sep)) throw Error("Unsafe fixture cleanup"); await rm(p, { recursive: true, force: true }); } });
const t1 = "2026-10-05T01:00:00.123456Z", t2 = "2026-10-05T01:00:00.123457Z", hash = "a".repeat(64);
function worker() { const w = new Worker("require('node:worker_threads').parentPort.on('message',()=>{});", { eval: true }); workers.push(w); return w; }
function rows(store: GraphStore) { const db = raw(store), tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]; return canonicalJson(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])); }
function history(store: GraphStore) { return canonicalJson(["snapshots", "source_snapshots", "snapshot_overviews", "nodes", "edges", "evidence", "ownership_attempts", "ownership_question_bindings", "ownership_semantic_capsules", "mastery_records"].map(name => [name, raw(store).prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])); }
const recover = (root: ReturnType<typeof heldStoreRemoteRecovery>) => Promise.resolve().then(() => root.recover());
async function fixture(layout: "legacy" | "split" | "hybrid" = "split") {
  const base = await mkdtemp(join(tmpdir(), "xray-held-recovery-")); roots.push(base); const project = join(base, "project"); await mkdir(project);
  await writeFile(join(project, "flow.ts"), "export function leaf(){return 42;}\nexport function middle(){return leaf();}\nexport function start(){return middle();}\n");
  const options = { databasePath: join(base, "authority.sqlite"), cacheRoot: join(base, "cache"), ...(layout === "split" ? { projectDatabaseRoot: join(base, "projects") } : {}) };
  let app = new XRayApplication(options); handles.push(app); const snapshot = await app.indexProject(project), ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  const question = (await app.createOwnershipQuestions({ ...ref, scope: { kind: "project" }, count: 20 })).find(q => q.kind === "call-direction")!;
  const check = question.deterministicChecks[0]!; if (check.kind !== "call-direction") throw Error("Missing actual call question");
  const proof = snapshot.evidence.find(e => e.id === snapshot.edges.find(e => e.id === check.edgeId)!.evidenceId)!;
  const structuredAnswer: OwnershipSubmission["structuredAnswer"] = { kind: "call-direction", callerNodeId: check.sourceNodeId, calleeNodeId: check.targetNodeId };
  expect((await app.gradeOwnershipAnswer({ ...ref, questionId: question.id, questionVersion: question.version, structuredAnswer, answer: "根据真实引用解释静态调用。", selfConfidence: .5, citations: [{ ...proof.span, evidenceId: proof.id }] })).passed).toBe(true);
  let source = internal(app).snapshotStores.get(ref.snapshotId)!;
  const attempt = source.listOwnershipAttempts(ref.repositoryId).find(a => !a.legacy)!;
  source.saveMastery({ ...ref, questionId: question.id, concept: attempt.concept.label, score: attempt.locationScore, completedAt: attempt.completedAt });
  expect(source.listMastery(ref.snapshotId)).toHaveLength(1); expect(source.listOwnershipAttempts(ref.repositoryId)).toHaveLength(1);
  if (layout === "hybrid") {
    app.close(); app = new XRayApplication({ ...options, projectDatabaseRoot: join(base, "projects") }); handles.push(app);
    app.saveIgnoreSettings({ ...ref, expectedRevision: 0, rules: ["owned-current-settings"] }); source = internal(app).snapshotStores.get(ref.snapshotId)!;
  }
  handles.push(source);
  const authority = internal(app).legacyStore, settings = internal(app).stores.get(ref.repositoryId) ?? authority;
  const material = await source.loadOwnershipSemanticPackage(attempt.attemptId); if (material.status !== "ready") throw Error("Actual ready material missing");
  const activation = source.remote.activation(ref.repositoryId, ref.snapshotId), owner = randomUUID(), context = authority.remote.commitTrustedContext(owner, activation), cap = material.capsule, pack = material.package;
  const identity: OwnershipSemanticCapturedIdentity = { protocolVersion: "1.0.0", ...ref, activation: activation.activation, analysisResultFingerprint: activation.analysisResultFingerprint, sourceManifestHash: activation.sourceManifestHash,
    configurationHash: activation.configurationHash, ignorePolicyHash: activation.ignorePolicyHash, ignoreRevision: cap.sourceIdentity.ignoreRevision!, questionId: question.id, questionVersion: question.version,
    questionFingerprint: cap.questionFingerprint, attemptId: attempt.attemptId, attemptHash: cap.attemptHash, deterministicScoringVersion: cap.deterministicScoringVersion, rubricVersion: "1.0.0", rubricHash: cap.rubric.rubricHash,
    semanticProtocolVersion: "ownership-semantic-assessment/1.0.0", semanticScoringVersion: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", authorizationRevision: 1,
    provider: "openai", model: "fixture-model", providerRevision: 1, credentialRevision: 1, contextHandle: context.contextHandle, contextEpoch: context.epoch, ownerSessionId: owner, taskId: randomUUID(),
    assessmentPackageId: pack.assessmentPackageId, bodyDigest: hash, limitsVersion: "1.0.0" };
  const envelope = await buildOwnershipSemanticResultEnvelope({ identity, createdAt: t1, completedAt: t2, response: { version: "1.0.0", assessmentPackageId: pack.assessmentPackageId,
    criteria: pack.rubric.criteria.map(c => ({ criterionId: c.criterionId, verdict: "supported", explanation: "静态源码支持。", evidenceIds: [...c.requiredEvidenceIds], limitationIds: [], answerRanges: [{ ...c.answerScope[0]! }] })) } });
  const results = (source as unknown as { semanticResults: ResultPort }).semanticResults;
  return { app, base, project, ref, snapshot, source, settings, authority, identity, envelope, results, owner, context, layout };
}
async function occupy(f: Awaited<ReturnType<typeof fixture>>, purpose: "feature" | "semantic", phase: "reserved" | "dispatched" | "failed" | "completed" = "failed", managed = true) {
  const root = heldStoreRemoteRecovery(f.app); let w!: Worker; const participant = root.create(f.owner, ["feature-explanation", "ownership-semantic-assessment"], () => w = worker()); root.bind(f.ref);
  const write = (work: () => void) => managed ? root.admit(participant, work) : work();
  let id: RemoteCapturedIdentity | OwnershipSemanticCapturedIdentity;
  if (purpose === "semantic") {
    id = f.identity; const tasks = new OwnershipSemanticTaskStore(raw(f.authority), "global");
    write(() => raw(f.authority).transaction(() => { tasks.reserve(f.identity, t1); if (phase !== "reserved") tasks.promote(f.identity); }).immediate());
    if (phase !== "reserved") {
      const prepared = await root.operation(participant, "prepare", () => f.results.prepare(f.envelope));
      root.admit(participant, () => raw(f.authority).transaction(() => raw(f.source).transaction(() => f.results.append(prepared, f.authority)).immediate()).immediate());
      if (phase === "failed" || phase === "completed") root.admit(participant, () => raw(f.authority).transaction(() => tasks.finish(f.identity, phase === "completed" ? null : "INVALID_RESPONSE", t2)).immediate());
    }
  } else {
    const featureId = remoteCapturedIdentitySchema.parse({ protocolVersion: "1.0.0", ...f.source.remote.activation(f.ref.repositoryId, f.ref.snapshotId), taskId: randomUUID(), ownerSessionId: f.owner,
      contextHandle: f.context.contextHandle, contextEpoch: f.context.epoch, ignoreRevision: f.settings.loadIgnoreSettings(f.ref.repositoryId).revision, authorizationRevision: 1, providerRevision: 0, credentialRevision: 0,
      packageId: hash, bodyDigest: hash, limitsVersion: "1.0.0" }); id = featureId;
    const shared = new SharedRemoteTaskStore(raw(f.authority), "global");
    write(() => raw(f.authority).transaction(() => { shared.reserveFeature(featureId, t1); if (phase !== "reserved") shared.promoteFeature({ identity: featureId, phase: "dispatched", code: null, createdAt: t1, completedAt: null }, 1); }).immediate());
    if (phase !== "reserved") {
      if (phase !== "dispatched") root.admit(participant, () => f.authority.remote.finish(featureId.taskId, phase === "completed" ? null : "INVALID_RESPONSE"));
      const proof = f.snapshot.evidence.find(e => e.kind === "call-expression")!, ended = f.authority.remote.task(featureId.taskId)!.completedAt ?? t2;
      const value = remoteResultSchema.parse({ version: "1.0.0", identity: featureId, narrative: { version: "1.0.0", ...f.ref, packageId: hash, claims: [{ text: "实际静态证据", evidenceIds: [proof.id], confidence: "inferred" }], unknowns: [] }, checkedAt: ended, completedAt: ended,
        localUnknowns: [], localLimitations: [], unknownEvidenceIds: [], localTruncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 },
        citations: [{ id: proof.id, kind: proof.kind, span: proof.span, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: proof.confidence, contentHash: f.snapshot.sourceFiles[0]!.contentHash, sliceSpan: proof.span }] });
      root.admit(participant, () => f.source.remote.immediate(() => f.source.remote.appendResult(value)));
    }
  }
  return { root, participant, worker: w, id, result: () => raw(f.source).prepare(`SELECT * FROM ${purpose === "feature" ? "remote_explanations" : "ownership_semantic_results"} WHERE task_id=?`).get(id.taskId), task: () => raw(f.authority).prepare(`SELECT * FROM ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHERE task_id=?`).get(id.taskId) };
}

describe("application held-store native recovery bridge", () => {
  it.each(["legacy", "split", "hybrid"].flatMap(layout => ["feature", "semantic"].flatMap(purpose => ["reserved", "dispatched", "failed", "completed"].map(phase => ({ layout: layout as "legacy" | "split" | "hybrid", purpose: purpose as "feature" | "semantic", phase: phase as "reserved" | "dispatched" | "failed" | "completed" })))))('actual $layout $purpose $phase retains nonempty answer/mastery history', async ({ layout, purpose, phase }) => {
    const f = await fixture(layout), run = await occupy(f, purpose, phase), before = history(f.source), result = run.result(), task = run.task();
    expect(heldStoreRemoteRecovery(f.app)).toBe(run.root); expect(Object.keys(run.root)).toEqual(["bind", "create", "retire", "operation", "admit", "recover"]);
    await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.worker.threadId).toBe(-1);
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]); expect(history(f.source)).toBe(before);
    expect(run.result()).toEqual(phase === "completed" ? result : undefined);
    const row = run.task() as { created_at?: string; payload: string; inflight: number }; const value = JSON.parse(row.payload);
    expect(value.createdAt).toBe(t1); expect(value.identity).toEqual(run.id); expect(value.phase).toBe(["reserved", "dispatched"].includes(phase) ? "interrupted" : phase); expect(row.inflight).toBe(0);
    if (phase === "failed" || phase === "completed") expect(run.task()).toEqual({ ...task as object, inflight: 0 });
  });
  it.each(["repo", "snapshot", "extra", "accessor", "proxy"])("strict ref %s rejects before touching stores", async kind => {
    const f = await fixture(), root = heldStoreRemoteRecovery(f.app), getter = vi.fn(() => f.ref.snapshotId), before = rows(f.authority), source = rows(f.source);
    const ref: unknown = kind === "repo" ? { ...f.ref, repositoryId: "wrong" } : kind === "snapshot" ? { ...f.ref, snapshotId: "wrong" } : kind === "extra" ? { ...f.ref, path: f.base } : kind === "proxy" ? new Proxy(f.ref, { ownKeys: () => { throw Error("must not inspect proxy"); } }) : Object.defineProperty({ repositoryId: f.ref.repositoryId }, "snapshotId", { get: getter });
    expect(() => root.bind(ref)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source);
  });
  it("captures ref once; later caller mutation cannot redirect actual binding", async () => {
    const f = await fixture(), run = await occupy(f, "feature"), ref = { ...f.ref }; run.root.bind(ref); ref.repositoryId = "wrong"; ref.snapshotId = "wrong";
    await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined();
  });
  it.each(["missing-settings", "wrong-source-map", "wrong-settings-map", "closed-source", "closed-settings", "broken-settings"])("held %s refuses with zero recovery writes", async kind => {
    const f = await fixture(), root = heldStoreRemoteRecovery(f.app), maps = internal(f.app), before = rows(f.authority);
    if (kind === "missing-settings") maps.stores.delete(f.ref.repositoryId);
    if (kind === "wrong-source-map") maps.snapshotStores.set(f.ref.snapshotId, f.authority);
    if (kind === "wrong-settings-map") { const other = await fixture(); maps.stores.set(f.ref.repositoryId, other.source); }
    if (kind === "closed-source") f.source.close();
    if (kind === "closed-settings") { const settings = new GraphStore(join(f.base, "closed.sqlite"), "project"); handles.push(settings); settings.saveIgnoreSettings(f.ref.repositoryId, 0, []); maps.stores.set(f.ref.repositoryId, settings); settings.close(); }
    if (kind === "broken-settings") { f.settings.saveIgnoreSettings(f.ref.repositoryId, 0, ["recorded-config"]); raw(f.settings).prepare("UPDATE project_ignore_settings SET payload='broken'").run(); }
    expect(() => root.bind(f.ref)).toThrow(); expect(rows(f.authority)).toBe(before);
  });
  it("same instance aliases deduplicate, distinct stores claiming one ref remain ambiguous", async () => {
    const f = await fixture(), root = heldStoreRemoteRecovery(f.app), maps = internal(f.app); maps.snapshotStores.set("held-alias", f.source); root.bind(f.ref);
    const path = join(f.base, "duplicate.sqlite"); raw(f.source).pragma("wal_checkpoint(TRUNCATE)"); await copyFile(raw(f.source).name, path); const duplicate = new GraphStore(path, "project"); handles.push(duplicate); maps.snapshotStores.set("other-held", duplicate);
    const before = rows(f.authority); expect(() => root.bind(f.ref)).toThrow(); await expect(recover(root)).rejects.toBeDefined(); expect(rows(f.authority)).toBe(before);
  });
  it("A to B to A resolves historical held instances without opening current-reference ports", async () => {
    const f = await fixture(), root = heldStoreRemoteRecovery(f.app); root.bind(f.ref); const other = join(f.base, "other"); await mkdir(other); await writeFile(join(other, "other.ts"), "export function other(){return 1;}\n");
    const b = await f.app.indexProject(other); root.bind({ repositoryId: b.repositoryId, snapshotId: b.snapshotId }); await f.app.indexProject(f.project); root.bind(f.ref); expect(heldStoreRemoteRecovery(f.app)).toBe(root);
    const require = vi.spyOn(internal(f.app), "requireSnapshot").mockImplementation(() => { throw Error("opening forbidden"); }), store = vi.spyOn(internal(f.app), "storeForRepository").mockImplementation(() => { throw Error("opening forbidden"); });
    root.bind(f.ref); expect(require).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
  });
  it("after construction locator does not enumerate/open files, even an existing unheld SQLite", async () => {
    const f = await fixture(), maps = internal(f.app), root = heldStoreRemoteRecovery(f.app), other = await fixture(); raw(other.source).pragma("wal_checkpoint(TRUNCATE)"); await copyFile(raw(other.source).name, join(f.base, "projects", `${other.ref.repositoryId}.sqlite`));
    const before = await readdir(join(f.base, "projects")), sizes = [maps.stores.size, maps.snapshotStores.size];
    const enumerate = vi.spyOn(fs, "readdirSync").mockImplementation(() => { throw Error("enumeration forbidden"); }), open = vi.spyOn(fs, "openSync").mockImplementation(() => { throw Error("opening forbidden"); });
    const require = vi.spyOn(maps, "requireSnapshot").mockImplementation(() => { throw Error("opening forbidden"); }), store = vi.spyOn(maps, "storeForRepository").mockImplementation(() => { throw Error("opening forbidden"); });
    const referenceFactory = vi.spyOn(f.app, "createRemoteExplanations").mockImplementation(() => { throw Error("reference enumeration forbidden"); });
    syncBuiltinESMExports(); root.bind(f.ref); expect(() => root.bind(other.ref)).toThrow();
    expect(enumerate).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(referenceFactory).not.toHaveBeenCalled(); expect(require).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled(); expect([maps.stores.size, maps.snapshotStores.size]).toEqual(sizes);
    vi.restoreAllMocks(); syncBuiltinESMExports(); expect(await readdir(join(f.base, "projects"))).toEqual(before);
  });
  it.each(["configuration", "source"])("old binding rejects %s drift; explicit same-instance rebind permits safe retry", async change => {
    const f = await fixture(), run = await occupy(f, "semantic"); const originalHistory = history(f.source); let originalNode: { node_id: string; payload: string } | undefined;
    if (change === "configuration") f.settings.saveIgnoreSettings(f.ref.repositoryId, 0, ["changed-current-policy"]);
    else { const row = raw(f.source).prepare("SELECT node_id,payload FROM nodes LIMIT 1").get() as { node_id: string; payload: string }; originalNode = row; raw(f.source).prepare("UPDATE nodes SET payload=? WHERE node_id=? AND snapshot_id=?").run(row.payload.replace('"name":', '"revalidatedName":'), row.node_id, f.ref.snapshotId); }
    const before = rows(f.authority), source = rows(f.source); await expect(recover(run.root)).rejects.toBeDefined(); expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source); expect(run.worker.threadId).toBe(-1);
    if (change === "source") { // Restore exact actual graph rather than fabricate new verified material.
      raw(f.source).prepare("UPDATE nodes SET payload=? WHERE node_id=? AND snapshot_id=?").run(originalNode!.payload, originalNode!.node_id, f.ref.snapshotId); expect(history(f.source) === originalHistory).toBe(true);
    }
    run.root.bind(f.ref); await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined();
  });
  it.each(["same-owner", "foreign-owner"])("unmanaged historical task %s cannot be adopted by a new native participant", async kind => {
    const f = await fixture(); if (kind === "foreign-owner") f.identity.ownerSessionId = randomUUID(); const run = await occupy(f, "semantic", "reserved", false), before = rows(f.authority);
    await expect(recover(run.root)).rejects.toBeDefined(); expect(rows(f.authority)).toBe(before); expect(run.worker.threadId).toBe(-1);
  });
  it("actual second-connection lock keeps occupation; fresh manual recovery retry succeeds", async () => {
    const f = await fixture(), run = await occupy(f, "semantic"), peer = new Database(raw(f.authority).name); handles.push(peer); peer.exec("BEGIN IMMEDIATE"); const before = rows(f.authority);
    await expect(recover(run.root)).rejects.toMatchObject({ code: "BUSY" }); expect(rows(f.authority)).toBe(before); peer.exec("ROLLBACK"); await expect(recover(run.root)).resolves.toMatchObject({ released: true });
  });
  it.each(["release", "global-commit"])("split exact source commit/$fault failure keeps lease and retries without reexecution", async fault => {
    const f = await fixture(), run = await occupy(f, "semantic"), db = raw(f.authority), old = history(f.source);
    if (fault === "release") db.exec("CREATE TRIGGER inject BEFORE UPDATE OF inflight ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'private');END");
    else db.exec("CREATE TABLE parent_fault(id INTEGER PRIMARY KEY);CREATE TABLE child_fault(id INTEGER REFERENCES parent_fault(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER inject AFTER UPDATE OF inflight ON ownership_semantic_tasks BEGIN INSERT INTO child_fault VALUES(1);END");
    await expect(recover(run.root)).rejects.toMatchObject({ progress: { terminalCommitted: true, sourceCommitted: true, released: false } }); expect(run.result()).toBeUndefined(); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); expect(history(f.source)).toBe(old);
    db.exec("DROP TRIGGER inject"); await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(history(f.source)).toBe(old); expect(run.worker.threadId).toBe(-1);
  });
  it("recover waits for actual operation settlement and rejects its late admission", async () => {
    const f = await fixture(), run = await occupy(f, "feature"); let release!: () => void; const held = new Promise<void>(r => release = r), write = vi.fn();
    const operation = run.root.operation(run.participant, "work", async () => { await held; run.root.admit(run.participant, write); }).catch(error => error);
    const pending = recover(run.root); await vi.waitFor(() => expect(run.worker.threadId).toBe(-1)); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
    release(); expect(await operation).toHaveProperty("code"); expect(write).not.toHaveBeenCalled(); await expect(pending).resolves.toMatchObject({ released: true });
  });
  it("application close revokes root and queued recovery/operation without treating terminate request as release", async () => {
    const f = await fixture(), run = await occupy(f, "semantic"), peer = new Database(raw(f.authority).name); handles.push(peer); let release!: () => void; const held = new Promise<void>(r => release = r), write = vi.fn();
    const operation = run.root.operation(run.participant, "work", async () => { await held; run.root.admit(run.participant, write); }).catch(error => error);
    const pending = recover(run.root).catch(error => error); await vi.waitFor(() => expect(run.worker.threadId).toBe(-1)); const before = peer.prepare("SELECT * FROM remote_provider_lease").all();
    f.app.close(); expect(() => heldStoreRemoteRecovery(f.app)).toThrow(); expect(() => run.root.bind(f.ref)).toThrow(); expect(() => run.root.create(f.owner, ["feature-explanation"], worker)).toThrow();
    release(); expect(await operation).toHaveProperty("code"); expect(await pending).toHaveProperty("code"); expect(write).not.toHaveBeenCalled(); expect(peer.prepare("SELECT * FROM remote_provider_lease").all()).toEqual(before);
  });
});

describe("held store failures stay local and revoke async source validation", () => {
  it.each(["overview", "snapshot", "source-hash"])("missing/broken %s evidence never falls back or writes", async kind => {
    const f = await fixture(), root = heldStoreRemoteRecovery(f.app), db = raw(f.source);
    if (kind === "overview") db.prepare("DELETE FROM snapshot_overviews WHERE snapshot_id=?").run(f.ref.snapshotId);
    if (kind === "snapshot") db.prepare("UPDATE snapshots SET payload='broken' WHERE snapshot_id=?").run(f.ref.snapshotId);
    if (kind === "source-hash") db.prepare("UPDATE source_snapshots SET content=content||' ' WHERE snapshot_id=?").run(f.ref.snapshotId);
    const before = rows(f.authority), source = rows(f.source); expect(() => root.bind(f.ref)).toThrow(); expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source);
  });
  it("closing the application during actual R1 digest validation cannot release or compensate late", async () => {
    const f = await fixture(), run = await occupy(f, "semantic"), global = new Database(raw(f.authority).name), source = new Database(raw(f.source).name); handles.push(global, source);
    let entered!: () => void, release!: () => void; const waiting = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r), real = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); entered(); await held; return value; });
    const pending = recover(run.root).catch(error => error); await waiting; expect(run.worker.threadId).toBe(-1);
    const lease = global.prepare("SELECT * FROM remote_provider_lease").all(), result = source.prepare("SELECT * FROM ownership_semantic_results").all();
    f.app.close(); release(); expect(await pending).toMatchObject({ progress: { terminalCommitted: true, sourceCommitted: false, released: false } });
    expect(global.prepare("SELECT * FROM remote_provider_lease").all()).toEqual(lease); expect(source.prepare("SELECT * FROM ownership_semantic_results").all()).toEqual(result);
  });
});

describe("held-map async gate regression", () => {
  it.each(["legacy", "split", "hybrid"] as const)("mapping changes during native settlement must reject layout=%s", async layout => {
    const f = await fixture(layout), run = await occupy(f, "semantic");
    let release!: () => void;
    const held = new Promise<void>(r => release = r);
    const operation = run.root.operation(run.participant, "work", async () => { await held; }).catch(e => e);
    const pending = recover(run.root).then(value => ({value}), error => ({error}));
    await vi.waitFor(() => expect(run.worker.threadId).toBe(-1));
    const before = rows(f.authority), source = rows(f.source), originalHistory = history(f.source);
    internal(f.app).snapshotStores.delete(f.ref.snapshotId);
    // Keep the old source alive and its bytes valid. A new instance now claims
    // the same snapshot, so pre-await locator approval is no longer sufficient.
    const path = join(f.base, "async-duplicate.sqlite"); raw(f.source).pragma("wal_checkpoint(TRUNCATE)");
    await copyFile(raw(f.source).name, path);
    const duplicate = new GraphStore(path, layout === "split" ? "project" : "global"); handles.push(duplicate);
    internal(f.app).snapshotStores.set(f.ref.snapshotId, duplicate);
    release(); await operation;
    const outcome = await pending;
    expect(outcome).toHaveProperty("error"); expect(outcome).toMatchObject({ error: { code: "POLICY_INVALID" } });
    expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source); expect(history(f.source)).toBe(originalHistory);
    internal(f.app).snapshotStores.set(f.ref.snapshotId, f.source); duplicate.close(); run.root.bind(f.ref);
    await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined(); expect(history(f.source)).toBe(originalHistory);
  });
  it.each(["legacy", "split", "hybrid"] as const)("mapping changes during real digest must reject layout=%s", async layout => {
    const f = await fixture(layout), run = await occupy(f, "semantic");
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(r => entered=r), held = new Promise<void>(r => release=r), real=crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle,"digest").mockImplementationOnce(async (...args) => {const value=await real(...args);entered();await held;return value;});
    const pending=recover(run.root).then(value=>({value}),error=>({error})); await waiting;
    const before=rows(f.authority), source=rows(f.source), originalHistory=history(f.source);
    internal(f.app).snapshotStores.delete(f.ref.snapshotId);
    const path=join(f.base,"digest-duplicate.sqlite");raw(f.source).pragma("wal_checkpoint(TRUNCATE)");await copyFile(raw(f.source).name,path);
    const duplicate=new GraphStore(path,layout==="split"?"project":"global");handles.push(duplicate);internal(f.app).snapshotStores.set(f.ref.snapshotId,duplicate);
    release();const outcome=await pending;
    expect(outcome).toHaveProperty("error"); expect(outcome).toMatchObject({ error: { code: "POLICY_INVALID", progress: { terminalCommitted: true, sourceCommitted: false, released: false } } });
    expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source); expect(history(f.source)).toBe(originalHistory);
    internal(f.app).snapshotStores.set(f.ref.snapshotId, f.source); duplicate.close(); run.root.bind(f.ref);
    await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined(); expect(history(f.source)).toBe(originalHistory);
  });
});

async function waitAtRecovery(run: Awaited<ReturnType<typeof occupy>>, cut: "native" | "digest") {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r);
  let operation: Promise<unknown> | undefined;
  if (cut === "native") operation = run.root.operation(run.participant, "work", async () => { entered(); await held; }).catch(error => error);
  else {
    const real = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); entered(); await held; return value; });
  }
  const pending = recover(run.root).catch(error => error);
  await waiting; await vi.waitFor(() => expect(run.worker.threadId).toBe(-1));
  return { pending, release: async () => { release(); await operation; } };
}
function peerRows(db: Raw) { return canonicalJson((db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])); }

describe("held-map async purpose settings and close guards", () => {
  it.each(["legacy", "split", "hybrid"] as const)("feature mapping ambiguity after native settlement refuses and permits explicit manual retry layout=%s", async layout => {
    const f = await fixture(layout), run = await occupy(f, "feature"), gate = await waitAtRecovery(run, "native"), before = rows(f.authority), source = rows(f.source), old = history(f.source), originalResult = run.result();
    const path = join(f.base, "feature-duplicate.sqlite"); raw(f.source).pragma("wal_checkpoint(TRUNCATE)"); await copyFile(raw(f.source).name, path);
    const duplicate = new GraphStore(path, layout === "split" ? "project" : "global"); handles.push(duplicate); internal(f.app).snapshotStores.set(f.ref.snapshotId, duplicate);
    await gate.release(); expect(await gate.pending).toMatchObject({ code: "POLICY_INVALID" });
    expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source); expect(run.result()).toEqual(originalResult); expect(history(f.source)).toBe(old);
    internal(f.app).snapshotStores.set(f.ref.snapshotId, f.source); duplicate.close(); run.root.bind(f.ref);
    await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined(); expect(history(f.source)).toBe(old); expect(run.worker.threadId).toBe(-1);
  });
  it.each(["legacy", "split", "hybrid"].flatMap(layout => ["settings", "close"].flatMap(change => ["native-feature", "native-semantic", "digest-semantic"].map(point => ({ layout: layout as "legacy" | "split" | "hybrid", change, point })))))("$change during $point refuses latest held context layout=$layout", async ({ layout, change, point }) => {
    const f = await fixture(layout), run = await occupy(f, point.endsWith("feature") ? "feature" : "semantic"), cut = point.startsWith("digest") ? "digest" : "native", gate = await waitAtRecovery(run, cut);
    const global = new Database(raw(f.authority).name), source = new Database(raw(f.source).name); handles.push(global, source);
    const before = peerRows(global), sourceBefore = peerRows(source), old = history(f.source), originalResult = run.result(), originalSettings = internal(f.app).stores.get(f.ref.repositoryId);
    let duplicate: GraphStore | undefined;
    if (change === "settings") {
      const path = join(f.base, "settings-duplicate.sqlite"); raw(f.settings).pragma("wal_checkpoint(TRUNCATE)"); await copyFile(raw(f.settings).name, path);
      duplicate = new GraphStore(path, f.settings === f.authority ? "global" : "project"); handles.push(duplicate); internal(f.app).stores.set(f.ref.repositoryId, duplicate);
    } else f.app.close();
    await gate.release(); const error: unknown = await gate.pending; expect(error).toMatchObject({ code: "POLICY_INVALID" });
    if (cut === "digest") expect(error).toMatchObject({ progress: { terminalCommitted: true, sourceCommitted: false, released: false } });
    expect(peerRows(global)).toBe(before); expect(peerRows(source)).toBe(sourceBefore); expect(global.prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1);
    if (change === "settings") {
      expect(run.result()).toEqual(originalResult); expect(history(f.source)).toBe(old);
      if (originalSettings) internal(f.app).stores.set(f.ref.repositoryId, originalSettings); else internal(f.app).stores.delete(f.ref.repositoryId);
      duplicate!.close(); run.root.bind(f.ref); await expect(recover(run.root)).resolves.toMatchObject({ released: true }); expect(run.result()).toBeUndefined(); expect(history(f.source)).toBe(old);
    } else { expect(() => heldStoreRemoteRecovery(f.app)).toThrow(); expect(() => run.root.bind(f.ref)).toThrow(); }
    expect(run.worker.threadId).toBe(-1);
  });
});

import { createHeldFeatureProducer, createHeldSemanticProducer } from "./remote-recovery-source-locator.js";
import { OWNERSHIP_SEMANTIC_POLICY_CATEGORIES, type OwnershipSemanticPrepareRequest } from "@project-xray/contracts";

async function producerFixture(layout: "legacy" | "split" | "hybrid") {
  const base = await mkdtemp(join(tmpdir(), "xray-producer-real-")); roots.push(base); const project = join(base, "project"); await mkdir(project);
  await writeFile(join(project, "flow.ts"), "export function leaf(){return 42;}\nexport function middle(){return leaf();}\nexport function start(){return middle();}\n");
  const options = { databasePath: join(base, "authority.sqlite"), cacheRoot: join(base, "cache"), ...(layout === "split" ? { projectDatabaseRoot: join(base, "projects") } : {}) };
  let app = new XRayApplication(options); handles.push(app); let snapshot = await app.indexProject(project);
  if (layout === "hybrid") { app.saveIgnoreSettings({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, expectedRevision: 0, rules: ["owned-current-settings"] }); snapshot = await app.indexProject(project); }
  const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  const question = (await app.createOwnershipQuestions({ ...ref, scope: { kind: "project" }, count: 20 })).find(q => q.kind === "call-direction")!, check = question.deterministicChecks[0]!;
  if (check.kind !== "call-direction") throw Error("Missing real question");
  const proof = snapshot.evidence.find(e => e.id === snapshot.edges.find(e => e.id === check.edgeId)!.evidenceId)!;
  expect((await app.gradeOwnershipAnswer({ ...ref, questionId: question.id, questionVersion: question.version, structuredAnswer: { kind: "call-direction", callerNodeId: check.sourceNodeId, calleeNodeId: check.targetNodeId }, answer: "根据真实源码引用解释调用方向。", selfConfidence: .5, citations: [{ ...proof.span, evidenceId: proof.id }] })).passed).toBe(true);
  let source = internal(app).snapshotStores.get(ref.snapshotId)!; const attempt = source.listOwnershipAttempts(ref.repositoryId).find(a => !a.legacy)!;
  source.saveMastery({ ...ref, questionId: question.id, concept: attempt.concept.label, score: attempt.locationScore, completedAt: attempt.completedAt });
  if (layout === "hybrid") { app.close(); app = new XRayApplication({ ...options, projectDatabaseRoot: join(base, "projects") }); handles.push(app); app.saveIgnoreSettings({ ...ref, expectedRevision: 0, rules: ["owned-current-settings"] }); source = internal(app).snapshotStores.get(ref.snapshotId)!; }
  handles.push(source); const authority = internal(app).legacyStore, settings = internal(app).stores.get(ref.repositoryId) ?? authority;
  authority.remote.saveProvider(0, { provider: "openai", model: "gpt-4.1-mini", credentialRevision: 1, credentialStatus: "configured", outputTokens: 2048 }); authority.remote.saveAuthorization(ref.repositoryId, 0, true);
  const authorization = authority.loadOwnershipSemanticAuthorization(ref.repositoryId);
  authority.grantOwnershipSemanticAuthorization({ repositoryId: ref.repositoryId, expectedRevision: authorization.revision, expectedProviderRevision: authority.remote.provider().revision, purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES] });
  const context = authority.remote.commitTrustedContext(randomUUID(), source.remote.activation(ref.repositoryId, ref.snapshotId));
  const request: OwnershipSemanticPrepareRequest = { ...ref, contextHandle: context.contextHandle, attemptId: attempt.attemptId, purpose: "ownership-semantic-assessment" };
  expect(await app.getSnapshotState(ref)).toMatchObject({ status: "current" }); expect(source.listMastery(ref.snapshotId)).toHaveLength(1);
  return { app, base, project, ref, source, authority, settings, request, context, snapshot, attempt };
}
function producerExecutor(mode: "normal" | "hold" | "invalid" = "normal") {
  const code = `const {parentPort,workerData}=require('node:worker_threads');const {createHash}=require('node:crypto');parentPort.on('message',message=>{
    if(message.version!=='1.0.0'||createHash('sha256').update(message.body).digest('hex')!==message.bodyDigest)throw Error('invalid wire');
    const body=JSON.parse(message.body),data=JSON.parse(body.input[0].content[0].text);
    let raw;
    if(message.purpose==='feature-explanation'){const p=data;raw={version:'1.0.0',repositoryId:p.repositoryId,snapshotId:p.snapshotId,packageId:p.packageId,claims:[{text:'静态源码证据支持调用关系。',evidenceIds:[p.proofs.find(e=>e.confidence==='verified').id],confidence:'inferred'}],unknowns:[]};}
    else {const p=data.data.semanticPackage;raw={version:'1.0.0',assessmentPackageId:p.assessmentPackageId,criteria:p.rubric.criteria.map(c=>({criterionId:c.criterionId,verdict:'supported',explanation:'真实源码支持。',evidenceIds:c.requiredEvidenceIds,limitationIds:[],answerRanges:c.answerScope}))};}
    if(workerData==='invalid')raw={invalid:true};if(workerData!=='hold')parentPort.postMessage({requestId:message.requestId,raw});
  });`;
  const actual = new Worker(code, { eval: true, workerData: mode }); workers.push(actual); const post = vi.spyOn(actual, "postMessage"); return { actual, post };
}
describe("real held producer integration", () => {
  it.each(["legacy", "split", "hybrid"].flatMap(layout => ["feature", "semantic"].map(purpose => ({ layout: layout as "legacy" | "split" | "hybrid", purpose }))))("actual $purpose executor created before prepare and sends once layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), old = history(f.source); let execution!: ReturnType<typeof producerExecutor>; const factory = vi.fn(() => (execution = producerExecutor()).actual);
    if (purpose === "feature") {
      const credentials = vi.fn(async () => ({ credential: "fixture-only", revision: 1 }));
      const flow = createHeldFeatureProducer(f.app, { ref: f.ref, contextHandle: f.context.contextHandle, createWorker: factory, credentials: { read: credentials } });
      expect(factory).toHaveBeenCalledTimes(1); expect(execution.post).not.toHaveBeenCalled(); expect(credentials).not.toHaveBeenCalled();
      const preview = await flow.prepare({ ...f.ref, contextHandle: f.context.contextHandle, purpose: "feature-explanation", query: "start" });
      expect(execution.post).not.toHaveBeenCalled(); expect(credentials).not.toHaveBeenCalled();
      const task = await flow.start({ taskId: randomUUID(), contextHandle: f.context.contextHandle, packageId: preview.packageId, previewId: preview.previewId });
      expect(task.phase).toBe("completed"); expect((await flow.result(task.identity.taskId))?.identity).toEqual(task.identity); expect(credentials).toHaveBeenCalledTimes(1); expect(execution.post).toHaveBeenCalledTimes(1);
      expect((execution.post.mock.calls[0]![0] as { bodyDigest: string }).bodyDigest).toBe(task.identity.bodyDigest); flow.close();
    } else {
      const flow = createHeldSemanticProducer(f.app, { ref: f.ref, contextHandle: f.context.contextHandle, createWorker: factory });
      expect(factory).toHaveBeenCalledTimes(1); const token = await flow.prepare(f.request); expect(execution.post).not.toHaveBeenCalled();
      const metadata = flow.reserve(token), lease = raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all(); expect(lease).toHaveLength(1); expect(execution.post).not.toHaveBeenCalled();
      const result = await flow.start(metadata.reservation); expect(result.identity.taskId).toBe(metadata.taskId); expect(result.createdAt).toBe(metadata.createdAt); expect(await flow.read(metadata.reservation)).toEqual(result); expect(execution.post).toHaveBeenCalledTimes(1); flow.close();
    }
    expect(factory).toHaveBeenCalledTimes(1); expect(execution.actual.threadId).toBe(-1); expect(history(f.source)).toBe(old); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
});

function heldPause() { let entered!: () => void, release!: () => void; return { entered: new Promise<void>(r => entered = r), held: new Promise<void>(r => release = r), enter: () => entered(), release: () => release() }; }
function productFlows(f: Awaited<ReturnType<typeof producerFixture>>, purpose: "feature" | "semantic", mode: "normal" | "hold" | "invalid" = "normal") {
  let execution!: ReturnType<typeof producerExecutor>; const factory = vi.fn(() => (execution = producerExecutor(mode)).actual);
  const credentials = vi.fn(async () => ({ credential: "fixture-only", revision: 1 }));
  return { feature: purpose === "feature" ? createHeldFeatureProducer(f.app, { ref: f.ref, contextHandle: f.context.contextHandle, createWorker: factory, credentials: { read: credentials } }) : null,
    semantic: purpose === "semantic" ? createHeldSemanticProducer(f.app, { ref: f.ref, contextHandle: f.context.contextHandle, createWorker: factory }) : null,
    factory, credentials, execution: () => execution };
}
async function preparedProduct(f: Awaited<ReturnType<typeof producerFixture>>, purpose: "feature" | "semantic", mode: "normal" | "hold" | "invalid" = "normal") {
  const flows = productFlows(f, purpose, mode);
  if (flows.feature) { const preview = await flows.feature.prepare({ ...f.ref, contextHandle: f.context.contextHandle, purpose: "feature-explanation", query: "start" }); const id = randomUUID();
    return { ...flows, id, metadata: undefined, start: () => flows.feature!.start({ taskId: id, previewId: preview.previewId, packageId: preview.packageId, contextHandle: preview.contextHandle }), cancel: () => flows.feature!.cancel({ taskId: id, contextHandle: preview.contextHandle }) }; }
  const token = await flows.semantic!.prepare(f.request), metadata = flows.semantic!.reserve(token);
  return { ...flows, id: metadata.taskId, metadata, start: () => flows.semantic!.start(metadata.reservation), cancel: () => flows.semantic!.cancel(metadata.reservation) };
}
const productCases = ["legacy", "split", "hybrid"].flatMap(layout => ["feature", "semantic"].map(purpose => ({ layout: layout as "legacy" | "split" | "hybrid", purpose: purpose as "feature" | "semantic" })));
describe("real producer failure and asynchronous SQL gates", () => {
  it.each(["legacy", "split", "hybrid"] as const)("semantic reserved with actual executor not yet sent recovers exact T1 layout=%s", async layout => {
    const f = await producerFixture(layout), run = await preparedProduct(f, "semantic"), old = history(f.source), row = raw(f.authority).prepare("SELECT * FROM remote_task_registry WHERE task_id=?").get(run.id);
    expect(run.execution().post).not.toHaveBeenCalled(); await expect(recover(heldStoreRemoteRecovery(f.app))).resolves.toMatchObject({ released: true });
    expect(run.execution().actual.threadId).toBe(-1); expect(run.execution().post).not.toHaveBeenCalled(); const task = raw(f.authority).prepare("SELECT * FROM ownership_semantic_tasks WHERE task_id=?").get(run.id) as { created_at: string; phase: string; payload: string };
    expect(task.created_at).toBe((row as { created_at: string }).created_at); expect(task.phase).toBe("interrupted"); expect(history(f.source)).toBe(old); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(productCases)("prepare actual wait is counted and freeze prevents late $purpose preview layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = productFlows(f, purpose), gate = heldPause(), before = rows(f.authority), old = history(f.source);
    if (purpose === "feature") { const real = f.app.getSnapshotState.bind(f.app); vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => { const value = await real(...args); gate.enter(); await gate.held; return value; }); }
    else { const real = crypto.subtle.digest.bind(crypto.subtle); vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); gate.enter(); await gate.held; return value; }); }
    const pending = (run.feature ? run.feature.prepare({ ...f.ref, contextHandle: f.context.contextHandle, purpose: "feature-explanation", query: "start" }) : run.semantic!.prepare(f.request)).catch(error => error); await gate.entered;
    const recovery = recover(heldStoreRemoteRecovery(f.app)); await vi.waitFor(() => expect(run.execution().actual.threadId).toBe(-1)); expect(rows(f.authority)).toBe(before); expect(history(f.source)).toBe(old);
    gate.release(); expect(await pending).toHaveProperty("code"); await expect(recovery).resolves.toMatchObject({ released: true }); expect(run.execution().post).not.toHaveBeenCalled(); expect(run.credentials).not.toHaveBeenCalled(); expect(history(f.source)).toBe(old);
  });
  it.each(productCases)("actual $purpose promotion commit failure has one send and no implicit retry layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose), db = raw(f.authority), old = history(f.source);
    db.exec("CREATE TABLE producer_parent(id INTEGER PRIMARY KEY);CREATE TABLE producer_child(id INTEGER REFERENCES producer_parent(id) DEFERRABLE INITIALLY DEFERRED);");
    db.exec(purpose === "feature" ? "CREATE TRIGGER producer_fault AFTER INSERT ON explanation_tasks BEGIN INSERT INTO producer_child VALUES(1);END" : "CREATE TRIGGER producer_fault AFTER INSERT ON ownership_semantic_tasks WHEN NEW.phase='dispatched' BEGIN INSERT INTO producer_child VALUES(1);END");
    await expect(run.start()).rejects.toHaveProperty("code"); expect(run.execution().post).toHaveBeenCalledTimes(1); expect(run.execution().actual.threadId).toBe(-1); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); expect(history(f.source)).toBe(old);
    const registry = db.prepare("SELECT * FROM remote_task_registry WHERE task_id=?").get(run.id) as { created_at: string; identity_payload: string }; db.exec("DROP TRIGGER producer_fault");
    await expect(recover(heldStoreRemoteRecovery(f.app))).resolves.toMatchObject({ released: true }); expect(run.execution().post).toHaveBeenCalledTimes(1); const task = db.prepare(`SELECT * FROM ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHERE task_id=?`).get(run.id) as { payload: string };
    expect(JSON.parse(task.payload).createdAt).toBe(registry.created_at); expect(JSON.parse(task.payload).identity).toEqual(JSON.parse(registry.identity_payload)); expect(history(f.source)).toBe(old);
  });
  it.each(productCases)("real $purpose publication wait cannot commit cleanup after freeze layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose), gate = heldPause(), old = history(f.source);
    if (purpose === "feature") { const real = f.app.getSnapshotState.bind(f.app); let calls = 0; vi.spyOn(f.app, "getSnapshotState").mockImplementation(async (...args) => { const value = await real(...args); if (++calls === 2) { gate.enter(); await gate.held; } return value; }); }
    else { const publish = f.source.publishOwnershipSemanticExecution.bind(f.source), real = crypto.subtle.digest.bind(crypto.subtle); vi.spyOn(f.source, "publishOwnershipSemanticExecution").mockImplementationOnce((...args) => { vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...values) => { const value = await real(...values); gate.enter(); await gate.held; return value; }); return publish(...args); }); }
    const pending = run.start().catch(error => error); await gate.entered; const before = rows(f.authority), source = rows(f.source), recovery = recover(heldStoreRemoteRecovery(f.app)); await vi.waitFor(() => expect(run.execution().actual.threadId).toBe(-1)); expect(rows(f.authority)).toBe(before); expect(rows(f.source)).toBe(source);
    gate.release(); expect(await pending).toHaveProperty("code"); await expect(recovery).resolves.toMatchObject({ released: true }); expect(run.execution().post).toHaveBeenCalledTimes(1); expect(history(f.source)).toBe(old); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(productCases)("normal $purpose cancel stops same actual executor and safe new producer retries layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose, "hold"), old = history(f.source), pending = run.start().catch(error => error);
    await vi.waitFor(() => expect(run.execution().post).toHaveBeenCalledTimes(1)); await run.cancel(); const outcome = await pending; expect(outcome).toBeDefined(); expect(run.execution().actual.threadId).toBe(-1); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]); expect(history(f.source)).toBe(old);
    const next = await preparedProduct(f, purpose); await expect(next.start()).resolves.toBeDefined(); expect(next.execution().post).toHaveBeenCalledTimes(1); expect(run.execution().post).toHaveBeenCalledTimes(1); expect(history(f.source)).toBe(old);
  });
});

describe("real producer domain boundaries", () => {
  it.each(["throw", "proxy", "promise"])("actual executor creation %s leaves unknown resource blocked", async kind => {
    const f = await producerFixture("split"), old = rows(f.authority), historyBefore = history(f.source), actual = producerExecutor();
    expect(() => createHeldSemanticProducer(f.app, { ref: f.ref, contextHandle: f.context.contextHandle, createWorker: () => { if (kind === "throw") throw Error("fixture failure"); return kind === "proxy" ? new Proxy(actual.actual, {}) : Promise.resolve(actual.actual) as never; } })).toThrow();
    await expect(recover(heldStoreRemoteRecovery(f.app))).rejects.toHaveProperty("code"); expect(rows(f.authority)).toBe(old); expect(history(f.source)).toBe(historyBefore); expect(actual.post).not.toHaveBeenCalled(); expect(actual.actual.threadId).not.toBe(-1);
  });
  it.each(["legacy", "split", "hybrid"] as const)("actual purposes share prepare and reserved occupancy layout=%s", async layout => {
    const f = await producerFixture(layout), semantic = productFlows(f, "semantic"), feature = productFlows(f, "feature"), gate = heldPause(), real = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); gate.enter(); await gate.held; return value; });
    const pending = semantic.semantic!.prepare(f.request); await gate.entered;
    await expect(feature.feature!.prepare({ ...f.ref, contextHandle: f.context.contextHandle, purpose: "feature-explanation", query: "start" })).rejects.toMatchObject({ code: "BUSY" });
    gate.release(); const reserved = semantic.semantic!.reserve(await pending); const lease = raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all(); expect(lease).toHaveLength(1);
    const competing = await preparedProduct(f, "feature"); await expect(competing.start()).rejects.toMatchObject({ code: "BUSY" }); expect(competing.execution().post).not.toHaveBeenCalled(); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual(lease);
    await semantic.semantic!.cancel(reserved.reservation); expect(semantic.execution().actual.threadId).toBe(-1); expect(semantic.execution().post).not.toHaveBeenCalled(); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(productCases)("actual $purpose source commit then global completion failure preserves history layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose), db = raw(f.authority), before = history(f.source);
    db.exec("CREATE TABLE producer_parent(id INTEGER PRIMARY KEY);CREATE TABLE producer_child(id INTEGER REFERENCES producer_parent(id) DEFERRABLE INITIALLY DEFERRED);");
    db.exec(`CREATE TRIGGER producer_completion_fault AFTER UPDATE OF phase ON ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHEN NEW.phase='completed' BEGIN INSERT INTO producer_child VALUES(1);END`);
    const result = await run.start().catch(error => error); expect(result).toHaveProperty(purpose === "feature" ? "phase" : "code"); if (purpose === "feature") expect(result.phase).toBe("failed");
    expect(run.execution().post).toHaveBeenCalledTimes(1); expect(run.execution().actual.threadId).toBe(-1); expect(history(f.source)).toBe(before);
    expect(raw(f.source).prepare(`SELECT * FROM ${purpose === "feature" ? "remote_explanations" : "ownership_semantic_results"}`).all()).toEqual([]);
    db.exec("DROP TRIGGER producer_completion_fault"); await expect(recover(heldStoreRemoteRecovery(f.app))).resolves.toMatchObject({ released: true }); expect(history(f.source)).toBe(before); expect(run.execution().post).toHaveBeenCalledTimes(1);
  });
  it.each(productCases)("actual $purpose release BUSY keeps completed artifact and stops native executor layout=$layout", async ({ layout, purpose }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose), before = history(f.source), db = raw(f.authority), peer = new Database(db.name); handles.push(peer); db.pragma("busy_timeout=0");
    run.execution().actual.once("exit", () => peer.exec("BEGIN IMMEDIATE"));
    await expect(run.start()).rejects.toMatchObject({ code: "BUSY" }); expect(run.execution().actual.threadId).toBe(-1); expect(run.execution().post).toHaveBeenCalledTimes(1); expect(history(f.source)).toBe(before);
    const task = db.prepare(`SELECT * FROM ${purpose === "feature" ? "explanation_tasks" : "ownership_semantic_tasks"} WHERE task_id=?`).get(run.id) as { phase: string };
    // Feature stops before publication; semantic stops after authoritative completion.
    expect(task.phase).toBe(purpose === "feature" ? "dispatched" : "completed"); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(1); peer.exec("ROLLBACK");
    await expect(recover(heldStoreRemoteRecovery(f.app))).resolves.toMatchObject({ released: true }); expect(history(f.source)).toBe(before); expect(run.execution().post).toHaveBeenCalledTimes(1); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it.each(productCases.flatMap(value => ["source", "settings", "close"].map(change => ({ ...value, change }))))("actual $purpose late read refuses $change layout=$layout", async ({ layout, purpose, change }) => {
    const f = await producerFixture(layout), run = await preparedProduct(f, purpose); await run.start(); const before = history(f.source), gate = heldPause(), historyPeer = new Database(raw(f.source).name); handles.push(historyPeer);
    if (purpose === "feature") { const real = f.app.getSnapshotState.bind(f.app); vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => { const value = await real(...args); gate.enter(); await gate.held; return value; }); }
    else { const real = crypto.subtle.digest.bind(crypto.subtle); vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { const value = await real(...args); gate.enter(); await gate.held; return value; }); }
    const pending = (run.feature ? run.feature.result(run.id) : run.semantic!.read(run.metadata!.reservation)).catch(error => error); await gate.entered;
    const oldSource = internal(f.app).snapshotStores.get(f.ref.snapshotId), oldSettings = internal(f.app).stores.get(f.ref.repositoryId), replacement = new GraphStore(":memory:", "project"); handles.push(replacement);
    if (change === "source") internal(f.app).snapshotStores.set(f.ref.snapshotId, replacement); else if (change === "settings") internal(f.app).stores.set(f.ref.repositoryId, replacement); else f.app.close();
    gate.release(); expect(await pending).toHaveProperty("code"); expect(history({ database: historyPeer } as unknown as GraphStore)).toBe(before); expect(run.execution().post).toHaveBeenCalledTimes(1);
    if (change !== "close") { if (oldSource) internal(f.app).snapshotStores.set(f.ref.snapshotId, oldSource); if (oldSettings) internal(f.app).stores.set(f.ref.repositoryId, oldSettings); else internal(f.app).stores.delete(f.ref.repositoryId); await expect(recover(heldStoreRemoteRecovery(f.app))).resolves.toMatchObject({ released: true }); }
  });
});


describe("root pending workspace scope challenge", () => {
  it.each(["legacy", "split", "hybrid"] as const)("cancellation cannot certify recovery before real old workspace settles layout=%s", async layout => {
    const f = await producerFixture(layout), run = await preparedProduct(f, "feature"), gate = heldPause();
    const real = f.app.getSnapshotState.bind(f.app); let workspaceSettled = false;
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => {
      const result = await real(...args); gate.enter(); await gate.held; workspaceSettled = true; return result;
    });
    const before = history(f.source), pending = run.start().catch(error => error);
    await gate.entered; await run.cancel(); const cancelled = await pending;
    expect(cancelled).toBeDefined(); expect(run.execution().actual.threadId).toBe(-1); expect(run.execution().post).not.toHaveBeenCalled();
    let finished = false; const recovery = recover(heldStoreRemoteRecovery(f.app)).then(value => { finished = true; return value; });
    try {
      await new Promise(resolve => setTimeout(resolve, 75));
      expect(workspaceSettled).toBe(false);
      expect(finished, "old actual workspace Promise remains pending after bounded cancellation").toBe(false);
    } finally { gate.release(); await recovery; }
    expect(workspaceSettled).toBe(true); expect(history(f.source)).toBe(before); expect(run.execution().post).not.toHaveBeenCalled();
  });
});


describe("root pending semantic workspace scope challenge", () => {
  it.each(["legacy", "split", "hybrid"] as const)("semantic cancellation retains actual preparation work layout=%s", async layout => {
    const f = await producerFixture(layout), run = productFlows(f, "semantic"), gate = heldPause();
    const real = f.app.getSnapshotState.bind(f.app); let workspaceSettled = false;
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => {
      const result = await real(...args); gate.enter(); await gate.held; workspaceSettled = true; return result;
    });
    const before = history(f.source), pending = run.semantic!.prepare(f.request).catch(error => error);
    await gate.entered; await run.semantic!.cancel(); await pending;
    expect(run.execution().actual.threadId).toBe(-1); expect(run.execution().post).not.toHaveBeenCalled();
    let finished = false; const recovery = recover(heldStoreRemoteRecovery(f.app)).then(value => { finished = true; return value; });
    try {
      await new Promise(resolve => setTimeout(resolve, 75)); expect(workspaceSettled).toBe(false);
      expect(finished, "old actual semantic workspace Promise remains pending after cancellation").toBe(false);
    } finally { gate.release(); await recovery; }
    expect(workspaceSettled).toBe(true); expect(history(f.source)).toBe(before); expect(run.execution().post).not.toHaveBeenCalled();
  });
});

describe("raw producer asynchronous settlement", () => {
  it.each(productCases.flatMap(value => ["before-read", "after-read"].flatMap(cut => ["cancel", "timeout"].map(stop => ({ ...value, cut, stop })))))("$purpose $stop retains raw workspace at $cut layout=$layout", async ({ layout, purpose, cut, stop }) => {
    const f = await producerFixture(layout), started = purpose === "feature" ? await preparedProduct(f, purpose) : null, run = started ?? productFlows(f, purpose), gate = heldPause(), before = history(f.source), real = f.app.getSnapshotState.bind(f.app); let settled = false, reads = 0;
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async (...args) => {
      if (cut === "before-read") { gate.enter(); await gate.held; }
      const result = await real(...args); reads++;
      if (cut === "after-read") { gate.enter(); await gate.held; }
      settled = true; return result;
    });
    if (stop === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    const pending = (started ? started.start() : run.semantic!.prepare(f.request)).catch(error => error); await gate.entered;
    if (stop === "timeout") await vi.advanceTimersByTimeAsync(purpose === "feature" ? 90_001 : 30_001);
    else if (started) await started.cancel(); else await run.semantic!.cancel();
    const outcome = await pending; expect(outcome).toBeDefined(); if (stop === "timeout") expect(outcome).toHaveProperty("code", "TIMEOUT"); vi.useRealTimers();
    expect(settled).toBe(false); expect(reads).toBe(cut === "before-read" ? 0 : 1); expect(run.execution().actual.threadId).toBe(-1); expect(run.execution().post).not.toHaveBeenCalled();
    let finished = false; const recovery = recover(heldStoreRemoteRecovery(f.app)).then(value => { finished = true; return value; });
    try { await new Promise(resolve => setTimeout(resolve, 75)); expect(finished).toBe(false); expect(settled).toBe(false); expect(history(f.source)).toBe(before); }
    finally { gate.release(); await recovery; }
    expect(settled).toBe(true); expect(reads).toBe(1); expect(history(f.source)).toBe(before); expect(run.execution().post).not.toHaveBeenCalled();
  });
  it.each(["legacy", "split", "hybrid"] as const)("raw credential read continues occupying scope after cancellation layout=%s", async layout => {
    const f = await producerFixture(layout), run = await preparedProduct(f, "feature"), gate = heldPause(), old = history(f.source); let settled = false;
    run.credentials.mockImplementationOnce(async () => { gate.enter(); await gate.held; settled = true; return { credential: "fixture-only", revision: 1 }; });
    const pending = run.start().catch(error => error); await gate.entered; await run.cancel(); await pending; expect(settled).toBe(false); expect(run.execution().post).not.toHaveBeenCalled();
    let finished = false; const recovery = recover(heldStoreRemoteRecovery(f.app)).then(value => { finished = true; return value; });
    try { await new Promise(resolve => setTimeout(resolve, 75)); expect(finished).toBe(false); }
    finally { gate.release(); await recovery; }
    expect(settled).toBe(true); expect(history(f.source)).toBe(old); expect(run.credentials).toHaveBeenCalledTimes(1); expect(run.execution().post).not.toHaveBeenCalled();
  });
});

describe("raw semantic validator and adapter settlement", () => {
  it.each(["legacy", "split", "hybrid"].flatMap(layout => ["validator", "adapter"].map(phase => ({ layout: layout as "legacy" | "split" | "hybrid", phase }))))("cancel retains actual $phase and prepare budget layout=$layout", async ({ layout, phase }) => {
    const f = await producerFixture(layout), run = productFlows(f, "semantic"), gate = heldPause(), old = history(f.source);
    const preparations = (f.source as unknown as { semanticPreparations: { validate(input: unknown): Promise<unknown> } }).semanticPreparations, realValidate = preparations.validate.bind(preparations); let validated = false, held = false, settled = false;
    vi.spyOn(preparations, "validate").mockImplementationOnce(async input => {
      const result = await realValidate(input); validated = true;
      if (phase === "validator") { gate.enter(); await gate.held; settled = true; }
      return result;
    });
    if (phase === "adapter") { const realDigest = crypto.subtle.digest.bind(crypto.subtle); vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { const result = await realDigest(...args); if (validated && !held) { held = true; gate.enter(); await gate.held; settled = true; } return result; }); }
    const pending = run.semantic!.prepare(f.request).catch(error => error); await gate.entered; await run.semantic!.cancel(); await pending; expect(settled).toBe(false);
    const next = productFlows(f, "semantic"); await expect(next.semantic!.prepare(f.request)).rejects.toHaveProperty("code", "BUSY"); expect(next.execution().post).not.toHaveBeenCalled();
    let finished = false; const recovery = recover(heldStoreRemoteRecovery(f.app)).then(value => { finished = true; return value; });
    try { await new Promise(resolve => setTimeout(resolve, 75)); expect(finished).toBe(false); expect(history(f.source)).toBe(old); }
    finally { gate.release(); await recovery; }
    expect(settled).toBe(true); expect(history(f.source)).toBe(old); expect(run.execution().post).not.toHaveBeenCalled(); expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
});
