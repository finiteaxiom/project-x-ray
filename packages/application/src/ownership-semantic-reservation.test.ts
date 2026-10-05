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
import { OwnershipSemanticReservationApplication } from "./ownership-semantic-reservation.js";
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
  const flow = new OwnershipSemanticReservationApplication(authority, () => ({ source, settings }));
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

describe("trusted semantic durable reservation", () => {
  it.each((["entry", "call-direction", "call-path", "variable-flow"] as const).flatMap(kind => [false, true].flatMap(legacy => [false, true].map(nonempty => ({ kind, legacy, nonempty })))))("actual $kind legacy=$legacy nonempty=$nonempty reserves only after outer commit", async ({ kind, legacy, nonempty }) => {
    const f = await fixture(kind, legacy, nonempty), oldAttempts = f.source.listOwnershipAttempts(f.ref.repositoryId);
    const oldSource = f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts"), oldRows = !legacy ? rows(f.source) : null;
    const prepared = await f.flow.prepare(f.request), before = [rows(f.source), rows(f.authority)];
    const full = await llm.prepareOwnershipSemanticResponsesRequest({ semanticPackage: (await f.source.loadOwnershipSemanticPackage(f.request.attemptId) as { package: Parameters<typeof llm.prepareOwnershipSemanticResponsesRequest>[0]["semanticPackage"] }).package,
      submittedAnswer: f.attempt.semanticText, model: "gpt-4.1-mini", maxOutputTokens: 2048 });
    expect([rows(f.source), rows(f.authority)]).toEqual(before);
    const held = f.flow.reserve(prepared), id = persistedIdentity(f, held.taskId);
    expect(Reflect.ownKeys(held).sort()).toEqual(["createdAt", "phase", "reservation", "taskId"]); expect(Object.isFrozen(held)).toBe(true);
    expect(Reflect.ownKeys(held.reservation)).toEqual([]); expect(id.bodyDigest).toBe(full.bodyDigest);
    expect(id.ignoreRevision).toBe(nonempty ? 1 : 0); expect(id.attemptId).toBe(f.request.attemptId);
    expect(id.questionFingerprint).toBe((await f.source.loadOwnershipSemanticPackage(f.request.attemptId) as { capsule: { questionFingerprint: string } }).capsule.questionFingerprint);
    expect(raw(f.authority).prepare("SELECT stage,created_at FROM remote_provider_lease").get()).toEqual({ stage: "reserved", created_at: held.createdAt });
    noTaskOrResult(f);
    expect(f.source.listOwnershipAttempts(f.ref.repositoryId)).toEqual(oldAttempts); expect(f.source.readSnapshotSource(f.ref.snapshotId, "flow.ts")).toEqual(oldSource);
    if (oldRows) expect(rows(f.source)).toBe(oldRows);
    const observer = second(f.authority); expect(observer.prepare("SELECT created_at FROM remote_task_registry WHERE task_id=?").get(held.taskId)).toEqual({ created_at: held.createdAt });
    expect(() => f.flow.reserve(prepared)).toThrow();
    f.flow.cancel(held.reservation);
    expect(raw(f.authority).prepare("SELECT phase,created_at,inflight FROM ownership_semantic_tasks").get()).toEqual({ phase: "cancelled", created_at: held.createdAt, inflight: 0 });
    expect(raw(f.authority).prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    expect(() => f.flow.cancel(held.reservation)).toThrow();
  });

  it.each(["configuration", "policy", "provider", "provider-model", "context", "activation", "main", "query", "source", "answer", "cut"])("prepare then actual %s change refuses before registration", async kind => {
    const f = await fixture(), token = await f.flow.prepare(f.request); await change(f, kind);
    const before = [rows(f.authority), rows(f.source)]; expect(() => f.flow.reserve(token)).toThrow();
    expect([rows(f.authority), rows(f.source)]).toEqual(before); noTaskOrResult(f);
  });
  it.each(["policy", "model", "credential", "context", "ignore"])("second connection %s mutation between prepare and reserve refuses", async kind => {
    const f = await fixture(), token = await f.flow.prepare(f.request);
    const peer = new GraphStore(raw(kind === "ignore" ? f.settings : f.authority).name, kind === "ignore" && f.settings !== f.authority ? "project" : "global"); handles.add(peer);
    if (kind === "ignore") peer.saveIgnoreSettings(f.ref.repositoryId, peer.loadIgnoreSettings(f.ref.repositoryId).revision, ["never"]);
    else if (kind === "policy") { const policy = peer.loadOwnershipSemanticAuthorization(f.ref.repositoryId); peer.revokeOwnershipSemanticAuthorization({ repositoryId: f.ref.repositoryId, expectedRevision: policy.revision, purpose: policy.purpose, disclosureVersion: policy.disclosureVersion }); }
    else if (kind === "context") peer.remote.commitTrustedContext(f.context.ownerSessionId, null);
    else { const { revision, ...provider } = peer.remote.provider(); peer.remote.saveProvider(revision, { ...provider, ...(kind === "model" ? { model: "gpt-4.1" } : { credentialRevision: provider.credentialRevision + 1 }) }); }
    const before = [rows(f.authority), rows(f.source)]; expect(() => f.flow.reserve(token)).toThrow(); expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it("saved revision cannot be replaced by current revision after rules A -> B -> A", async () => {
    const f = await fixture(); await change(f, "configuration");
    const before = [rows(f.authority), rows(f.source)]; await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: "NOT_CURRENT" });
    expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it.each([false, true])("separate once gates reject old/new token substitution legacy=%s", async legacy => {
    const f = await fixture("call-direction", legacy), old = f.app.createOwnershipSemanticPreparations(), q3 = await old.prepare(f.request), token = await f.flow.prepare(f.request);
    expect(() => f.source.reserveOwnershipSemantic(q3 as never)).toThrow();
    expect(() => f.source.withOwnershipSemanticRevisions(token as never, () => undefined)).toThrow();
    expect(old.withRevisions(q3, receipt => old.consume(receipt)).preparedReference).toBe(q3);
    const reserved = f.flow.reserve(token); f.flow.cancel(reserved.reservation);
  });
  it.each(["proxy", "getter", "hidden", "extra", "purpose"])("malicious %s five-field request has no effects or accessor reads", async mode => {
    const f = await fixture(), input = { ...f.request }; let reads = 0; let value: unknown = input;
    if (mode === "proxy") value = new Proxy(input, { ownKeys() { reads++; return []; } });
    if (mode === "getter") Object.defineProperty(input, "attemptId", { enumerable: true, get() { reads++; return f.request.attemptId; } });
    if (mode === "hidden") Object.defineProperty(input, "hidden", { value: 1 });
    if (mode === "extra") value = { ...input, identity: {} };
    if (mode === "purpose") value = { ...input, purpose: "feature-explanation" };
    const before = [rows(f.authority), rows(f.source)]; await expect(f.flow.prepare(value as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(reads).toBe(0); expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it("request is captured before await and cannot be redirected while real material validation waits", async () => {
    const f = await fixture(), input = { ...f.request }, g = holdMaterial(), pending = f.flow.prepare(input); await g.entered;
    input.attemptId = "replaced"; input.contextHandle = randomUUID(); g.release();
    const held = f.flow.reserve(await pending); expect(persistedIdentity(f, held.taskId).attemptId).toBe(f.request.attemptId); f.flow.cancel(held.reservation);
  });
  it.each(["denied", "feature-only", "unconfigured"])("actual %s authority grants no reservation", async mode => {
    const f = await fixture("call-direction", false, false, false), before = rows(f.source);
    if (mode === "feature-only") f.authority.remote.saveAuthorization(f.ref.repositoryId, 0, true);
    if (mode === "unconfigured") grant(f.authority, f.ref.repositoryId);
    await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ code: mode === "unconfigured" ? "NOT_CONFIGURED" : "NOT_AUTHORIZED" });
    expect(rows(f.source)).toBe(before); expect(raw(f.authority).prepare("SELECT * FROM remote_task_registry").all()).toEqual([]);
  });

  it.each(["registry-abort", "lease-abort", "registry-ignore", "lease-ignore", "wrong-payload", "commit"])("actual %s fault gives no committed receipt or slot and supports fresh prepare", async mode => {
    const f = await fixture(), token = await f.flow.prepare(f.request), db = dbOf(f.authority);
    if (mode === "commit") db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER INSERT ON remote_provider_lease BEGIN INSERT INTO fault_child VALUES(1); END");
    else if (mode === "wrong-payload") {
      // A legal alternate identity changes the registry after insert; schema validation
      // alone must not turn it into this preparation's durable reservation.
      db.function("metadata_hash", value => createHash("sha256").update(String(value)).digest("hex"));
      db.exec("DROP TRIGGER remote_registry_immutable; DROP TRIGGER remote_lease_no_update");
      db.exec("CREATE TRIGGER inject AFTER INSERT ON remote_provider_lease BEGIN UPDATE remote_task_registry SET identity_payload=json_set(identity_payload,'$.model','gpt-4.1'),identity_digest=metadata_hash(json_set(identity_payload,'$.model','gpt-4.1')) WHERE task_id=NEW.task_id; UPDATE remote_provider_lease SET identity_digest=(SELECT identity_digest FROM remote_task_registry WHERE task_id=NEW.task_id) WHERE task_id=NEW.task_id; END");
    } else db.exec(`CREATE TRIGGER inject BEFORE INSERT ON ${mode.startsWith("registry") ? "remote_task_registry" : "remote_provider_lease"} BEGIN SELECT RAISE(${mode.endsWith("ignore") ? "IGNORE" : "ABORT,'private answer fragment'"}); END`);
    const before = [rows(f.authority), rows(f.source)]; expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ message: "所有权语义准备失败" }));
    expect([rows(f.authority), rows(f.source)]).toEqual(before); noTaskOrResult(f); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
    db.exec("DROP TRIGGER inject");
    if (mode !== "wrong-payload") { const reserved = f.flow.reserve(await f.flow.prepare(f.request)); f.flow.cancel(reserved.reservation); }
  });
  it.each(["authority", "source"])("real second connection %s lock refuses BEGIN without writes", async where => {
    const f = await fixture(), token = await f.flow.prepare(f.request), peer = second(where === "authority" ? f.authority : f.source);
    peer.exec("BEGIN IMMEDIATE"); const before = [rows(f.authority), rows(f.source)];
    expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ code: "BUSY" })); expect([rows(f.authority), rows(f.source)]).toEqual(before); peer.exec("ROLLBACK");
    expect(() => f.source.reserveOwnershipSemantic(token)).toThrow(); const held = f.flow.reserve(await f.flow.prepare(f.request)); f.flow.cancel(held.reservation);
  });
  it.each(["authority", "source"])("existing outer %s transaction never returns a savepoint ticket", async where => {
    const f = await fixture(), token = await f.flow.prepare(f.request), db = dbOf(where === "authority" ? f.authority : f.source), before = [rows(f.authority), rows(f.source)];
    db.transaction(() => { expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ code: "INVALID_RECEIPT" })); })();
    expect([rows(f.authority), rows(f.source)]).toEqual(before); expect(() => f.source.reserveOwnershipSemantic(token)).toThrow();
  });
  it.each(["terminal", "release", "commit"])("sealed reserved cancellation %s failure preserves exact occupation and ticket", async stage => {
    const f = await fixture(), held = f.flow.reserve(await f.flow.prepare(f.request)), db = dbOf(f.authority);
    if (stage === "commit") db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER INSERT ON ownership_semantic_tasks BEGIN INSERT INTO fault_child VALUES(1); END");
    else db.exec(`CREATE TRIGGER inject BEFORE ${stage === "terminal" ? "INSERT" : "UPDATE OF inflight"} ON ownership_semantic_tasks BEGIN SELECT RAISE(ABORT,'private failure'); END`);
    const before = [rows(f.authority), rows(f.source)]; expect(() => f.flow.cancel(held.reservation)).toThrowError(expect.objectContaining({ message: "所有权语义准备失败" }));
    expect([rows(f.authority), rows(f.source)]).toEqual(before); noTaskOrResult(f);
    db.exec("DROP TRIGGER inject"); f.flow.cancel(held.reservation); expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toEqual([]);
  });
  it("cancellation before durable commit performs zero registration", async () => {
    const f = await fixture(), g = holdMaterial(), pending = f.flow.prepare(f.request); await g.entered;
    const before = [rows(f.authority), rows(f.source)]; f.flow.cancel(); g.release(); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect([rows(f.authority), rows(f.source)]).toEqual(before);
    const controller = new AbortController(), token = await f.flow.prepare(f.request, { signal: controller.signal }); controller.abort();
    expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ code: "CANCELLED" })); expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it.each(["application", "source", "authority", "settings"])("close %s revokes ticket without clearing durable occupation", async which => {
    const f = await fixture(), held = f.flow.reserve(await f.flow.prepare(f.request)), path = raw(f.authority).name, observer = second(f.authority);
    const old = observer.prepare("SELECT * FROM remote_provider_lease").all();
    if (which === "application") f.flow.close(); else (which === "source" ? f.source : which === "settings" ? f.settings : f.authority).close();
    expect(() => f.flow.cancel(held.reservation)).toThrow(); expect(observer.prepare("SELECT * FROM remote_provider_lease").all()).toEqual(old);
    const reopened = new GraphStore(path, "global"); handles.add(reopened);
    expect(raw(reopened).prepare("SELECT * FROM remote_provider_lease").all()).toEqual(old); expect(raw(reopened).prepare("SELECT * FROM ownership_semantic_tasks").all()).toEqual([]);
  });
  it("plain/cross application/source tickets cannot cancel and do not destroy actual ticket", async () => {
    const f = await fixture(), held = f.flow.reserve(await f.flow.prepare(f.request)), other = new OwnershipSemanticReservationApplication(f.authority, () => ({ source: f.source, settings: f.settings })); handles.add(other);
    const peer = new GraphStore(raw(f.source).name); handles.add(peer); const before = rows(f.authority);
    expect(() => other.cancel(held.reservation)).toThrow(); expect(() => f.source.cancelOwnershipSemanticReservation({} as never)).toThrow();
    expect(() => peer.cancelOwnershipSemanticReservation(held.reservation)).toThrow(); expect(rows(f.authority)).toBe(before); f.flow.cancel(held.reservation);
  });
  it.each(["feature-first", "semantic-first", "semantic-terminal"])("real two-connection shared slot competition %s", async order => {
    const f = await fixture(), token = await f.flow.prepare(f.request), db = second(f.authority), shared = new SharedRemoteTaskStore(db, "global"), feature = featureIdentity(f);
    if (order === "feature-first") {
      db.transaction(() => shared.reserveFeature(feature, new Date().toISOString())).immediate(); const before = rows(f.authority);
      expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ code: "BUSY" })); expect(rows(f.authority)).toBe(before);
    } else {
      const held = f.flow.reserve(token), id = persistedIdentity(f, held.taskId);
      if (order === "semantic-terminal") { const tasks = new OwnershipSemanticTaskStore(db, "global"); db.transaction(() => tasks.terminalReserved(id, "CANCELLED")).immediate(); }
      const before = rows(f.authority); expect(() => db.transaction(() => shared.reserveFeature(feature, new Date().toISOString())).immediate()).toThrowError(expect.objectContaining({ code: "BUSY" })); expect(rows(f.authority)).toBe(before);
      if (order === "semantic-first") f.flow.cancel(held.reservation);
    }
  });
  it.each(["model", "store", "hash", "bytes"])("modified actual compiled full-body %s cannot mint preparation", async field => {
    const compiled = llm.prepareOwnershipSemanticResponsesRequest;
    vi.spyOn(llm, "prepareOwnershipSemanticResponsesRequest").mockImplementationOnce(async input => {
      const actual = await compiled(input), data = JSON.parse(actual.body);
      if (field === "model") data.model = "gpt-4.1";
      if (field === "store") data.store = true;
      const body = canonicalJson(data);
      return Object.freeze({ ...actual, body, bodyDigest: field === "hash" ? "f".repeat(64) : createHash("sha256").update(body).digest("hex"), requestBytes: Buffer.byteLength(body) + (field === "bytes" ? 1 : 0) });
    });
    const f = await fixture(), before = [rows(f.authority), rows(f.source)]; await expect(f.flow.prepare(f.request)).rejects.toMatchObject({ message: "所有权语义准备失败" });
    expect([rows(f.authority), rows(f.source)]).toEqual(before);
  });
  it.each([false, true])("actual global/settings/source locks are held at registry write legacy=%s", async legacy => {
    const f = await fixture("call-direction", legacy), token = await f.flow.prepare(f.request), peers = [...new Set([f.authority, f.settings, f.source])].map(second);
    const db = raw(f.authority), prepare = db.prepare.bind(db); let writes = 0;
    vi.spyOn(db, "prepare").mockImplementation(sql => {
      if (sql.startsWith("INSERT INTO remote_task_registry")) {
        writes++; for (const store of [f.authority, f.settings, f.source]) expect(raw(store).inTransaction).toBe(true);
        for (const peer of peers) expect(() => peer.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
      }
      return prepare(sql);
    });
    const held = f.flow.reserve(token); expect(writes).toBe(1); f.flow.cancel(held.reservation);
    for (const peer of peers) peer.exec("BEGIN IMMEDIATE; ROLLBACK");
  });
  it.each(["source", "main", "policy"])("post-write %s recheck rolls back all tentative writes", async mode => {
    const f = await fixture(), token = await f.flow.prepare(f.request), db = raw(f.authority);
    db.function("inject_change", () => {
      if (mode === "source") raw(f.source).prepare("UPDATE source_snapshots SET content=replace(content,'42','43') WHERE snapshot_id=?").run(f.ref.snapshotId);
      if (mode === "main") (f.app as unknown as { semanticGeneration: number }).semanticGeneration++;
      if (mode === "policy") { const policy = f.authority.loadOwnershipSemanticAuthorization(f.ref.repositoryId); f.authority.revokeOwnershipSemanticAuthorization({ repositoryId: f.ref.repositoryId, expectedRevision: policy.revision, purpose: policy.purpose, disclosureVersion: policy.disclosureVersion }); }
      return 0;
    });
    db.exec("CREATE TRIGGER inject AFTER INSERT ON remote_provider_lease BEGIN SELECT inject_change(); END");
    const before = [rows(f.authority), rows(f.source)]; expect(() => f.flow.reserve(token)).toThrow(); expect([rows(f.authority), rows(f.source)]).toEqual(before); noTaskOrResult(f);
  });
  it("secondary locks remain held after actual global COMMIT and before ticket mint", async () => {
    const f = await fixture(), token = await f.flow.prepare(f.request), db = raw(f.authority), observer = second(f.authority), sourcePeer = second(f.source);
    const transaction = db.transaction.bind(db); let commits = 0;
    vi.spyOn(db, "transaction").mockImplementationOnce(work => {
      const actual = transaction(work);
      const run = () => {
        const value = actual.immediate(); commits++;
        // This connection now sees the durable global reservation, while source
        // and settings are still reserved until the enclosing ledger releases them.
        expect(observer.prepare("SELECT * FROM remote_task_registry").all()).toHaveLength(1);
        expect(raw(f.source).inTransaction).toBe(true); expect(raw(f.settings).inTransaction).toBe(true);
        expect(() => sourcePeer.exec("BEGIN IMMEDIATE")).toThrow(/locked/);
        return value;
      };
      return Object.assign(run, { immediate: run });
    });
    const held = f.flow.reserve(token); expect(commits).toBe(1); expect(raw(f.source).inTransaction).toBe(false); f.flow.cancel(held.reservation);
  });
  it.each(["terminal-ignore", "release-ignore"])("cancel %s cannot falsely report success", async mode => {
    const f = await fixture(), held = f.flow.reserve(await f.flow.prepare(f.request)), db = raw(f.authority);
    db.exec(`CREATE TRIGGER inject BEFORE ${mode === "terminal-ignore" ? "INSERT" : "UPDATE OF inflight"} ON ownership_semantic_tasks BEGIN SELECT RAISE(IGNORE); END`);
    const before = rows(f.authority); expect(() => f.flow.cancel(held.reservation)).toThrow(); expect(rows(f.authority)).toBe(before);
    db.exec("DROP TRIGGER inject"); f.flow.cancel(held.reservation);
  });
  it.each([false, true])("secondary rollback failure retains primary error/global occupation as appropriate commitFailure=%s", async commitFailure => {
    const f = await fixture(), token = await f.flow.prepare(f.request), source = raw(f.source), exec = source.exec.bind(source), db = raw(f.authority);
    if (commitFailure) db.exec("CREATE TABLE fault_parent(id INTEGER PRIMARY KEY); CREATE TABLE fault_child(id INTEGER REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER inject AFTER INSERT ON remote_provider_lease BEGIN INSERT INTO fault_child VALUES(1); END");
    let failed = false;
    vi.spyOn(source, "exec").mockImplementation(sql => {
      if (sql === "ROLLBACK" && !failed) { failed = true; throw Object.assign(Error("private cleanup"), { code: "SQLITE_BUSY" }); }
      exec(sql);
    });
    expect(() => f.flow.reserve(token)).toThrowError(expect.objectContaining({ code: commitFailure ? "INVALID_MATERIAL" : "BUSY" }));
    expect(db.prepare("SELECT * FROM remote_provider_lease").all()).toHaveLength(commitFailure ? 0 : 1);
    expect(db.prepare("SELECT * FROM ownership_semantic_tasks").all()).toEqual([]);
    expect(source.inTransaction).toBe(true); exec("ROLLBACK");
    if (!commitFailure) { const again = await f.flow.prepare(f.request); expect(() => f.flow.reserve(again)).toThrowError(expect.objectContaining({ code: "BUSY" })); }
  });
  it.each(["replace", "timeout"])("pending %s discards old receipt before any reservation", async mode => {
    const f = await fixture(), g = holdMaterial();
    if (mode === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const pending = f.flow.prepare(f.request).catch(error => error); await g.entered;
    const newer = mode === "replace" ? await f.flow.prepare(f.request) : undefined;
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(SEMANTIC_PREPARATION_TIMEOUT_MS + 1);
    g.release(); expect(await pending).toMatchObject({ code: mode === "timeout" ? "TIMEOUT" : "CANCELLED" });
    expect(raw(f.authority).prepare("SELECT * FROM remote_task_registry").all()).toEqual([]);
    if (newer) { const held = f.flow.reserve(newer); f.flow.cancel(held.reservation); }
  });
});
