import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, OWNERSHIP_SCORING_VERSION, type OwnershipAttempt, type OwnershipCapsule, type OwnershipQuestion, type OwnershipSubmission, type SourceCitation } from "@project-xray/contracts";
import { GraphStore } from "@project-xray/graph";
import { gradeAnswer } from "@project-xray/ownership";
import * as ownership from "@project-xray/ownership";
import { XRayApplication } from "./index.js";

interface RawDatabase { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => RawDatabase;
const handles = new Set<{ close(): void }>(), roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); for (const handle of handles) handle.close(); handles.clear();
  for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture cleanup"); await rm(root, { recursive: true, force: true }); }
});
const code = 'export let token = 0;\nexport function flow() {\n  token = 1;\n  return token;\n}\nexport function leaf() { return 42; }\nexport function middle() { return leaf(); }\nexport function start() { return middle(); }\n';
async function fixture(kind: OwnershipQuestion["kind"] = "variable-flow", legacy = false, content = code, rules?: string[]) {
  const base = await mkdtemp(join(tmpdir(), "xray-ownership-capsule-app-")); roots.push(base);
  const root = join(base, "project"); await mkdir(root); await writeFile(join(root, "flow.ts"), content);
  const options = { databasePath: join(base, "legacy.sqlite"), ...(!legacy ? { projectDatabaseRoot: join(base, "databases") } : {}), cacheRoot: join(base, "cache") };
  const app = new XRayApplication(options); handles.add(app); let snapshot = await app.indexProject(root);
  if (rules) { app.saveIgnoreSettings({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, expectedRevision: 0, rules }); snapshot = await app.indexProject(root); }
  const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  expect(snapshot.health.status).toBe("ready");
  const questions = await app.createOwnershipQuestions({ ...ref, count: 20, scope: { kind: "project" } }), question = questions.find(item => item.kind === kind)!;
  expect(question).toBeDefined();
  const check = question.deterministicChecks[0]!; let structured: OwnershipSubmission["structuredAnswer"], edgeIds: string[];
  if (check.kind === "definition") { structured = { kind: "entry", nodeId: check.nodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "call-direction") { structured = { kind: "call-direction", callerNodeId: check.sourceNodeId, calleeNodeId: check.targetNodeId }; edgeIds = [check.edgeId]; }
  else if (check.kind === "ordered-path") { structured = { kind: "call-path", nodeIds: check.legalNodePaths[0]! }; edgeIds = check.legalEdgePaths[0]!; }
  else { structured = { kind: "variable-flow", roles: check.requirements.map((item, index) => ({ citationIndex: index, role: item.role })) }; edgeIds = check.requirements.map(item => item.edgeIds[0]!); }
  const citations = edgeIds.map(id => { const proof = snapshot.evidence.find(item => item.id === snapshot.edges.find(edge => edge.id === id)!.evidenceId)!; return { ...proof.span, evidenceId: proof.id }; });
  const submission: OwnershipSubmission = { ...ref, questionId: question.id, questionVersion: question.version, answer: "用当前引用解释静态关系。🙂", selfConfidence: .5, citations, structuredAnswer: structured };
  const dbPath = options.projectDatabaseRoot ? join(options.projectDatabaseRoot, `${ref.repositoryId}.sqlite`) : options.databasePath;
  const raw = new Database(dbPath); handles.add(raw);
  const counts = () => ({ attempts: (raw.prepare("SELECT count(*) n FROM ownership_attempts").get() as { n: number }).n, capsules: (raw.prepare("SELECT count(*) n FROM ownership_semantic_capsules").get() as { n: number }).n });
  const saved = () => { const row = raw.prepare("SELECT payload FROM ownership_attempts ORDER BY completed_at DESC,attempt_id DESC LIMIT 1").get() as { payload: string } | undefined; return row ? JSON.parse(row.payload) as OwnershipAttempt : undefined; };
  const capsule = () => { const row = raw.prepare("SELECT payload FROM ownership_semantic_capsules ORDER BY attempt_id LIMIT 1").get() as { payload: string } | undefined; return row ? JSON.parse(row.payload) as OwnershipCapsule : undefined; };
  return { app, options, snapshot, ref, question, questions, submission, citations, raw, dbPath, root, counts, saved, capsule };
}
function gate() { let release!: () => void, enter!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; }); return { release, enter, held, entered }; }
function holdPreparation() {
  const g = gate(), original = GraphStore.prototype.prepareOwnershipAttemptWithCapsule;
  vi.spyOn(GraphStore.prototype, "prepareOwnershipAttemptWithCapsule").mockImplementationOnce(async function(this: GraphStore, ...args) {
    const prepared = await original.apply(this, args); g.enter(); await g.held; return prepared;
  });
  return g;
}
describe("ownership capsule application integration", () => {
  it.each(["entry", "call-direction", "call-path", "variable-flow"] as const)("非空排除规则下真实 %s builder/prepare/保存/重开，完整身份不改写", async kind => {
    const f = await fixture(kind, false, code, ["never"]), before = f.raw.prepare("SELECT * FROM snapshots ORDER BY snapshot_id").all(), sources = f.raw.prepare("SELECT * FROM source_snapshots ORDER BY snapshot_id,file_path").all();
    expect(f.snapshot.analysisIdentity.ignorePolicy?.rules).toEqual(["never"]);
    expect(await f.app.gradeOwnershipAnswer(f.submission)).toEqual(gradeAnswer(f.question, f.submission, f.snapshot, f.citations));
    const capsule = f.capsule()!; expect(capsule.status).toBe("ready"); if (capsule.status !== "ready") throw new Error("Expected ready");
    expect(capsule.analysisIdentity.ignorePolicy).toEqual({ version: f.snapshot.analysisIdentity.ignorePolicy!.version, hash: f.snapshot.analysisIdentity.ignorePolicy!.hash });
    expect(f.raw.prepare("SELECT * FROM snapshots ORDER BY snapshot_id").all()).toEqual(before); expect(f.raw.prepare("SELECT * FROM source_snapshots ORDER BY snapshot_id,file_path").all()).toEqual(sources);
    f.app.close(); handles.delete(f.app); const store = new GraphStore(f.dbPath, "project"); handles.add(store);
    expect(await store.loadOwnershipCapsule(f.saved()!.attemptId)).toMatchObject({ status: "ready", capsule, attempt: f.saved() });
  });
  it.each(["entry", "call-direction", "call-path", "variable-flow"] as const)("真实TS索引 %s 即时grade不变，attempt与ready胶囊原子保存并重开", async kind => {
    const f = await fixture(kind), original = structuredClone(f.submission), expected = gradeAnswer(f.question, f.submission, f.snapshot, f.citations);
    expect(await f.app.gradeOwnershipAnswer(f.submission)).toEqual(expected); expect(f.submission).toEqual(original);
    expect(f.counts()).toEqual({ attempts: 1, capsules: 1 }); expect(f.capsule(), canonicalJson(f.capsule())).toMatchObject({ status: "ready" });
    const attempt = f.saved()!; expect(attempt.scoringVersion).toBe(OWNERSHIP_SCORING_VERSION); expect(attempt.passed).toBe(true);
    f.app.close(); handles.delete(f.app); const reopened = new XRayApplication(f.options); handles.add(reopened);
    expect((await reopened.getOwnershipProgress(f.ref)).attempts.find(item => item.attemptId === attempt.attemptId)).toEqual(attempt);
    const store = new GraphStore(f.dbPath); handles.add(store); expect(await store.loadOwnershipCapsule(attempt.attemptId)).toMatchObject({ status: "ready", questionBinding: "prepare-only" });
  });

  it("captures submission and privately owned question before the first await", async () => {
    const f = await fixture(), original = structuredClone(f.submission), expected = gradeAnswer(structuredClone(f.question), original, f.snapshot, original.citations), g = gate();
    const state = f.app.getSnapshotState.bind(f.app);
    vi.spyOn(f.app, "getSnapshotState").mockImplementationOnce(async ref => { g.enter(); await g.held; return state(ref); });
    const pending = f.app.gradeOwnershipAnswer(f.submission); await g.entered;
    f.submission.answer = "late"; f.submission.citations.length = 0; f.submission.structuredAnswer = { kind: "entry", nodeId: "late" };
    f.question.prompt = "late prompt"; f.question.deterministicChecks.length = 0;
    g.release(); expect(await pending).toEqual(expected); expect(f.saved()?.semanticText).toBe(original.answer); expect(f.saved()?.citations).toEqual(original.citations);
    expect(f.counts()).toEqual({ attempts: 1, capsules: 1 });
  });

  it.each(["getter", "symbol", "hidden", "prototype", "cycle", "nan"] as const)("rejects complete-data violation %s without executing accessors or writing", async kind => {
    const f = await fixture(), getter = vi.fn(() => "caller source");
    const value = structuredClone(f.submission) as OwnershipSubmission & Record<string, unknown>;
    if (kind === "getter") Object.defineProperty(value, "answer", { enumerable: true, get: getter });
    if (kind === "symbol") Object.defineProperty(value, Symbol("hidden"), { enumerable: true, value: "hidden" });
    if (kind === "hidden") Object.defineProperty(value, "hidden", { value: "hidden" });
    if (kind === "prototype") Object.setPrototypeOf(value.citations[0]!, { inherited: true });
    if (kind === "cycle") value.cycle = value;
    if (kind === "nan") value.extra = NaN;
    await expect(f.app.gradeOwnershipAnswer(value)).rejects.toMatchObject({ diagnosticCode: "TASK_FAILED" });
    expect(getter).not.toHaveBeenCalled(); expect(f.counts()).toEqual({ attempts: 0, capsules: 0 });
    expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true);
  });

  it.each([0, 1, 3])("normalizes duplicate position %s without losing original builder input", async position => {
    const f = await fixture(), originalBuilder = ownership.buildOwnershipRubricCapsule, spy = vi.spyOn(ownership, "buildOwnershipRubricCapsule").mockImplementation(originalBuilder);
    const submitted = structuredClone(f.submission); submitted.citations.splice(position, 0, structuredClone(f.citations[0]!));
    if (submitted.structuredAnswer.kind !== "variable-flow") throw new Error("fixture");
    submitted.structuredAnswer.roles = submitted.structuredAnswer.roles.map(role => ({ ...role, citationIndex: role.citationIndex >= position ? role.citationIndex + 1 : role.citationIndex }));
    expect((await f.app.gradeOwnershipAnswer(submitted)).passed).toBe(true);
    expect(spy.mock.calls[0]![0].submission).toEqual(submitted);
    expect(f.saved()?.structuredAnswer).toEqual(f.submission.structuredAnswer); expect(f.saved()?.citations).toEqual(f.citations);
    expect(f.counts()).toEqual({ attempts: 1, capsules: 1 });
  });

  it("overlapping citation keeps local grade but produces citation-not-exact", async () => {
    const f = await fixture(); f.submission.citations[0]!.startColumn++;
    const expected = gradeAnswer(f.question, f.submission, f.snapshot, f.submission.citations);
    expect(await f.app.gradeOwnershipAnswer(f.submission)).toEqual(expected); expect(expected.passed).toBe(true);
    expect(f.capsule()).toMatchObject({ status: "not-evaluated", reason: "citation-not-exact" });
  });

  it.each(["wrong-structure", "role-out-of-bounds"] as const)("persists failed %s attempt and keeps retryable", async kind => {
    const f = await fixture(), submitted = structuredClone(f.submission);
    if (submitted.structuredAnswer.kind !== "variable-flow") throw new Error("fixture");
    if (kind === "wrong-structure") submitted.structuredAnswer.roles[0]!.role = "return";
    else submitted.structuredAnswer.roles[0]!.citationIndex = 999;
    expect((await f.app.gradeOwnershipAnswer(submitted)).passed).toBe(false);
    expect(f.counts()).toEqual({ attempts: 1, capsules: 1 }); expect(f.capsule()?.status).toBe("not-evaluated");
    expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true); expect(f.counts()).toEqual({ attempts: 2, capsules: 2 });
  });

  it.each(["", "\ud800", "汉".repeat(6000)])("preserves answer encoding/budget and immediate local grade (%#)", async answer => {
    const f = await fixture(); f.submission.answer = answer;
    const expected = gradeAnswer(f.question, f.submission, f.snapshot, f.citations);
    expect(await f.app.gradeOwnershipAnswer(f.submission)).toEqual(expected); expect(f.saved()?.semanticText).toBe(answer);
    if (answer === "") expect(f.capsule()).toMatchObject({ status: "ready", rubric: { criteria: expect.arrayContaining([expect.objectContaining({ answerScope: [] })]) } });
    else expect(f.capsule()).toMatchObject({ status: "not-evaluated", reason: answer.length === 1 ? "answer-encoding-unavailable" : "answer-budget-exceeded", answerHash: null });
  });

  it("real late source budget saves nonnull original projection with failed assessability", async () => {
    const f = await fixture("entry", false, 'export function giant() { /*' + "x".repeat(5000) + '*/ return 1; }\n');
    expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true);
    expect(f.capsule()).toMatchObject({ status: "not-evaluated", reason: "source-budget-exceeded", submissionProjectionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(f.counts()).toEqual({ attempts: 1, capsules: 1 });
  });

  it("real generator long variant remains complete and produces bounded late rubric fallback", async () => {
    const content = 'export let token = 0;\nexport function flow() { token = 1;\n' + Array.from({ length: 80 }, () => 'void token;').join("\n") + '\nreturn token; }\n';
    const f = await fixture("variable-flow", false, content); expect(f.question.variantKey.length).toBeGreaterThan(1200);
    expect(await f.app.gradeOwnershipAnswer(f.submission)).toEqual(gradeAnswer(f.question, f.submission, f.snapshot, f.citations));
    expect(f.saved()?.variantKey).toBe(f.question.variantKey);
    expect(f.capsule()).toMatchObject({ status: "not-evaluated", reason: "rubric-budget-exceeded", submissionProjectionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(Buffer.byteLength(canonicalJson(f.capsule()), "utf8")).toBeLessThanOrEqual(2048);
  });

  it.each(["ownership_attempts", "ownership_semantic_capsules"])("rolls back actual %s INSERT failure and retries same question", async table => {
    const f = await fixture(); f.raw.exec(`CREATE TRIGGER deny_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'private fixture text'); END`);
    await expect(f.app.gradeOwnershipAnswer(f.submission)).rejects.toThrow("所有权胶囊存储失败"); expect(f.counts()).toEqual({ attempts: 0, capsules: 0 });
    f.raw.exec("DROP TRIGGER deny_insert"); expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true); expect(f.counts()).toEqual({ attempts: 1, capsules: 1 });
    await expect(f.app.gradeOwnershipAnswer(f.submission)).rejects.toThrow("题目不存在");
  });

  it("same-question occupancy rejects overlap while different question remains independent", async () => {
    const f = await fixture(), g = holdPreparation(), pending = f.app.gradeOwnershipAnswer(f.submission); await g.entered;
    await expect(f.app.gradeOwnershipAnswer(structuredClone(f.submission))).rejects.toMatchObject({ diagnosticCode: "TASK_FAILED" });
    const other = f.questions.find(q => q.kind === "entry")!, check = other.deterministicChecks[0]!;
    if (check.kind !== "definition") throw new Error("fixture");
    const proof = f.snapshot.evidence.find(e => e.id === f.snapshot.edges.find(e => e.id === check.edgeId)!.evidenceId)!;
    expect((await f.app.gradeOwnershipAnswer({ ...f.submission, questionId: other.id, questionVersion: other.version, citations: [{ ...proof.span, evidenceId: proof.id }], structuredAnswer: { kind: "entry", nodeId: check.nodeId } })).passed).toBe(true);
    g.release(); expect((await pending).passed).toBe(true); expect(f.counts()).toEqual({ attempts: 2, capsules: 2 });
  });

  it.each(["close", "replace-questions", "workspace", "configuration", "activation"] as const)("rejects %s after async preparation with zero writes", async kind => {
    const f = await fixture(), g = holdPreparation(), pending = f.app.gradeOwnershipAnswer(f.submission); await g.entered;
    if (kind === "close") { f.app.close(); handles.delete(f.app); }
    if (kind === "replace-questions") await f.app.createOwnershipQuestions({ ...f.ref, count: 20, scope: { kind: "project" } });
    if (kind === "workspace") await writeFile(join(f.root, "flow.ts"), code + "// drift\n");
    if (kind === "configuration") { const second = new GraphStore(f.dbPath, "project"); handles.add(second); second.saveIgnoreSettings(f.ref.repositoryId, 0, ["never/"]); }
    if (kind === "activation") f.raw.prepare("UPDATE snapshot_overviews SET activated_at=? WHERE snapshot_id=?").run("2099-01-01T00:00:00.000Z", f.ref.snapshotId);
    g.release(); await expect(pending).rejects.toThrow(); expect(f.counts()).toEqual({ attempts: 0, capsules: 0 });
    if (kind === "workspace") { await writeFile(join(f.root, "flow.ts"), code); expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true); }
    if (kind === "replace-questions") expect((await f.app.gradeOwnershipAnswer(f.submission)).passed).toBe(true);
  });

  it("legacy source and separate settings retain lock order and configuration rejection", async () => {
    const f = await fixture("variable-flow", true); f.app.close(); handles.delete(f.app);
    const options = { ...f.options, projectDatabaseRoot: join(f.root, "settings") }, app = new XRayApplication(options); handles.add(app);
    await app.createOwnershipQuestions({ ...f.ref, count: 20, scope: { kind: "project" } });
    const settingsPath = join(options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`), second = new GraphStore(settingsPath, "project"); handles.add(second);
    const original = GraphStore.prototype.withIgnoreRevision;
    vi.spyOn(GraphStore.prototype, "withIgnoreRevision").mockImplementationOnce(function(this: GraphStore, repo, revision, work) {
      second.saveIgnoreSettings(repo, revision, ["never/"]);
      return original.call(this, repo, revision, work);
    });
    await expect(app.gradeOwnershipAnswer(f.submission)).rejects.toThrow("配置已变化"); expect(f.counts()).toEqual({ attempts: 0, capsules: 0 });
  });

  it("legacy source and separate settings can atomically save and reopen without altering source", async () => {
    const f = await fixture("variable-flow", true); const oldSources = f.raw.prepare("SELECT * FROM source_snapshots ORDER BY file_path").all();
    f.app.close(); handles.delete(f.app);
    const options = { ...f.options, projectDatabaseRoot: join(f.root, "settings") }, app = new XRayApplication(options); handles.add(app);
    await app.createOwnershipQuestions({ ...f.ref, count: 20, scope: { kind: "project" } });
    const settingsRaw = new Database(join(options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`)); handles.add(settingsRaw); settingsRaw.exec("PRAGMA busy_timeout=1");
    const original = GraphStore.prototype.withIgnoreRevision; let observedLock = false;
    vi.spyOn(GraphStore.prototype, "withIgnoreRevision").mockImplementationOnce(function(this: GraphStore, repo, revision, work) {
      return original.call(this, repo, revision, () => { expect(() => settingsRaw.exec("BEGIN IMMEDIATE")).toThrow(/locked/); observedLock = true; return work(); });
    });
    f.raw.exec("CREATE TRIGGER deny_legacy_capsule BEFORE INSERT ON ownership_semantic_capsules BEGIN SELECT RAISE(ABORT,'private legacy text'); END");
    await expect(app.gradeOwnershipAnswer(f.submission)).rejects.toThrow("所有权胶囊存储失败"); expect(observedLock).toBe(true); expect(f.counts()).toEqual({ attempts: 0, capsules: 0 });
    f.raw.exec("DROP TRIGGER deny_legacy_capsule");
    expect((await app.gradeOwnershipAnswer(f.submission)).passed).toBe(true); expect(f.counts()).toEqual({ attempts: 1, capsules: 1 });
    expect(f.raw.prepare("SELECT * FROM source_snapshots ORDER BY file_path").all()).toEqual(oldSources);
    const attempt = f.saved()!, payload = f.raw.prepare("SELECT payload FROM ownership_attempts WHERE attempt_id=?").get(attempt.attemptId);
    app.close(); handles.delete(app); const reopened = new XRayApplication(options); handles.add(reopened);
    expect((await reopened.getOwnershipProgress(f.ref)).attempts).toEqual([attempt]); expect(f.raw.prepare("SELECT payload FROM ownership_attempts WHERE attempt_id=?").get(attempt.attemptId)).toEqual(payload);
    expect((await reopened.getOwnershipProgress(f.ref)).concepts.find(item => item.concept.id === attempt.concept.id)?.status).toBe("passed");
    const sourceStore = new GraphStore(f.dbPath, "global"); handles.add(sourceStore);
    expect(await sourceStore.loadOwnershipCapsule(attempt.attemptId)).toMatchObject({ status: f.capsule()!.status, questionBinding: "prepare-only", attempt, capsule: f.capsule() });
  });
});
