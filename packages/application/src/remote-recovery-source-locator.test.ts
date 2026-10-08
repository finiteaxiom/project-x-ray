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
