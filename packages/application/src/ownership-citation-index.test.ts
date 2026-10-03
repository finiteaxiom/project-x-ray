import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNERSHIP_SCORING_VERSION, type OwnershipAttempt, type OwnershipSubmission, type SourceCitation } from "@project-xray/contracts";
import { GraphStore } from "@project-xray/graph";
import { gradeAnswer } from "@project-xray/ownership";
import * as ownership from "@project-xray/ownership";
import { XRayApplication } from "./index.js";

interface RawDatabase { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => RawDatabase;
const roots: string[] = []; const handles = new Set<{ close(): void }>();
afterEach(async () => {
  vi.restoreAllMocks(); for (const handle of handles) handle.close(); handles.clear();
  for (const root of roots.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Fixture root escaped"); await rm(root, { recursive: true, force: true }); }
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "xray-ownership-citation-index-")); roots.push(base);
  const root = join(base, "project"); await mkdir(root);
  await writeFile(join(root, "flow.ts"), 'export let token = 0;\nexport function flow() {\n  token = 1;\n  return token;\n}\n');
  const options = { databasePath: join(base, "legacy.sqlite"), projectDatabaseRoot: join(base, "databases"), cacheRoot: join(base, "cache") };
  const app = new XRayApplication(options); handles.add(app);
  const snapshot = await app.indexProject(root); const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  expect(snapshot.health.status).toBe("ready");
  const question = (await app.createOwnershipQuestions({ ...ref, count: 20, scope: { kind: "project" } })).find(item => item.kind === "variable-flow")!;
  expect(question).toBeDefined(); const check = question.deterministicChecks[0]!;
  if (check.kind !== "variable-roles") throw new Error("Fixture has no variable roles");
  expect(check.requirements.map(item => item.role)).toEqual(["write", "read", "return"]);
  const citations = check.requirements.map(item => {
    expect(item.edgeIds).toHaveLength(1);
    const edge = snapshot.edges.find(candidate => candidate.id === item.edgeIds[0])!;
    const proof = snapshot.evidence.find(candidate => candidate.id === edge.evidenceId)!;
    return { ...proof.span, evidenceId: proof.id };
  });
  const submit = (selected: SourceCitation[], indices: number[], roles: ("write" | "read" | "return")[] = ["write", "read", "return"]): OwnershipSubmission => ({
    ...ref, questionId: question.id, questionVersion: question.version, answer: "本地角色记录", selfConfidence: .5, citations: selected,
    structuredAnswer: { kind: "variable-flow", roles: indices.map((citationIndex, index) => ({ citationIndex, role: roles[index]! })) },
  });
  const dbPath = join(options.projectDatabaseRoot, `${ref.repositoryId}.sqlite`);
  const raw = new Database(dbPath); handles.add(raw);
  const attempts = async () => (await app.getOwnershipProgress(ref)).attempts.filter(item => item.questionId === question.id);
  return { app, options, snapshot, ref, question, citations, submit, raw, dbPath, attempts };
}
function structure(attempt: OwnershipAttempt): Extract<OwnershipSubmission["structuredAnswer"], { kind: "variable-flow" }> {
  return attempt.structuredAnswer as Extract<OwnershipSubmission["structuredAnswer"], { kind: "variable-flow" }>;
}
const key = (citation: SourceCitation) => JSON.stringify([citation.filePath, citation.startLine, citation.startColumn, citation.endLine, citation.endColumn, citation.evidenceId]);

describe("new ownership attempts bind role indices to their persisted citations", () => {
  it("real indexed duplicate write citations persist [0,1,2] and reopen with the same correct role evidence", async () => {
    const f = await fixture(); const [write, read, returned] = f.citations;
    const submission = f.submit([write!, write!, read!, returned!], [0, 2, 3]);
    const before = structuredClone(submission);
    const expectedGrade = gradeAnswer(f.question, submission, f.snapshot, f.citations);
    const grade = await f.app.gradeOwnershipAnswer(submission);
    expect(grade).toEqual(expectedGrade); expect(grade.passed).toBe(true); expect(grade.scoringVersion).toBe(OWNERSHIP_SCORING_VERSION);
    expect(submission).toEqual(before);
    const attempt = (await f.attempts())[0]!;
    expect(attempt.citations).toEqual(f.citations);
    expect(structure(attempt).roles.map(item => item.citationIndex)).toEqual([0, 1, 2]);
    f.app.close(); handles.delete(f.app);
    const reopened = new XRayApplication(f.options); handles.add(reopened);
    const saved = (await reopened.getOwnershipProgress(f.ref)).attempts.find(item => item.attemptId === attempt.attemptId)!;
    expect(saved).toEqual(attempt);
    for (const [index, role] of structure(saved).roles.entries()) expect(saved.citations[role.citationIndex]?.evidenceId).toBe(f.citations[index]!.evidenceId);
  });

  it.each([
    { order: [0, 0, 1, 2], indices: [1, 2, 3] },
    { order: [0, 1, 1, 2], indices: [0, 2, 3] },
    { order: [0, 1, 2, 2], indices: [0, 1, 3] },
    { order: [2, 1, 0, 1, 2], indices: [2, 3, 4] },
  ])("preserves first occurrence order for duplicate layout $order", async ({ order, indices }) => {
    const f = await fixture(); const selected = order.map(index => f.citations[index]!);
    const submission = f.submit(selected, indices);
    const normalized = [...new Map(selected.map(citation => [key(citation), citation])).values()];
    const expected = gradeAnswer(f.question, submission, f.snapshot, normalized);
    expect(await f.app.gradeOwnershipAnswer(submission)).toEqual(expected);
    const saved = (await f.attempts())[0]!; expect(saved.citations).toEqual(normalized);
    expect(structure(saved).roles.map(item => item.citationIndex)).toEqual(indices.map(index => normalized.findIndex(citation => key(citation) === key(selected[index]!))));
  });

  it("keeps duplicate roles and different roles sharing a citation, without changing the original grade", async () => {
    const f = await fixture(); const [write, read, returned] = f.citations;
    const submission = f.submit([write!, write!, read!, returned!], [0, 1, 2, 3, 3], ["write", "write", "read", "return", "read"]);
    const before = structuredClone(submission);
    expect(await f.app.gradeOwnershipAnswer(submission)).toEqual(gradeAnswer(f.question, submission, f.snapshot, f.citations));
    expect(structure((await f.attempts())[0]!).roles).toEqual([
      { role: "write", citationIndex: 0 }, { role: "write", citationIndex: 0 }, { role: "read", citationIndex: 1 },
      { role: "return", citationIndex: 2 }, { role: "read", citationIndex: 2 },
    ]);
    expect(submission).toEqual(before);
  });

  it("does not merge distinct ranges attached to the same evidence", async () => {
    const f = await fixture(); const [write, read, returned] = f.citations;
    expect(write!.endColumn - write!.startColumn).toBeGreaterThan(1);
    const partial = { ...write!, endColumn: write!.endColumn - 1 };
    const selected = [write!, partial, read!, returned!, partial];
    const submission = f.submit(selected, [4, 2, 3]);
    const normalized = [write!, partial, read!, returned!];
    expect(await f.app.gradeOwnershipAnswer(submission)).toEqual(gradeAnswer(f.question, submission, f.snapshot, normalized));
    const saved = (await f.attempts())[0]!;
    expect(saved.citations).toEqual(normalized); expect(structure(saved).roles.map(item => item.citationIndex)).toEqual([1, 2, 3]);
  });

  it("keeps a genuinely out-of-range index invalid and preserves the original failed grade", async () => {
    const f = await fixture(); const [write, read, returned] = f.citations;
    const submission = f.submit([write!, write!, read!, returned!], [0, 2, 4]);
    const expected = gradeAnswer(f.question, submission, f.snapshot, f.citations);
    expect(expected.passed).toBe(false); expect(await f.app.gradeOwnershipAnswer(submission)).toEqual(expected);
    const saved = (await f.attempts())[0]!;
    expect(structure(saved).roles.map(item => item.citationIndex)).toEqual([0, 1, 4]);
    expect(saved.citations[structure(saved).roles[2]!.citationIndex]).toBeUndefined();
    expect(saved.passed).toBe(false); expect(saved.structureScore).toBe(0);
  });

  it.each(["unknown-proof", "missing-proof", "outside-file", "outside-content", "nonoverlap"] as const)("rejects %s citation before writing and keeps the question retryable", async kind => {
    const f = await fixture(); const bad: SourceCitation = { ...f.citations[0]! };
    if (kind === "unknown-proof") bad.evidenceId = "not-in-snapshot";
    if (kind === "missing-proof") delete bad.evidenceId;
    if (kind === "outside-file") bad.filePath = "outside.ts";
    if (kind === "outside-content") { bad.startLine = 999; bad.endLine = 999; }
    if (kind === "nonoverlap") { bad.startLine = 1; bad.endLine = 1; bad.startColumn = 0; bad.endColumn = 1; }
    await expect(f.app.gradeOwnershipAnswer(f.submit([bad, ...f.citations.slice(1)], [0, 1, 2]))).rejects.toThrow();
    expect(await f.attempts()).toEqual([]);
    expect((await f.app.gradeOwnershipAnswer(f.submit(f.citations, [0, 1, 2]))).passed).toBe(true);
  });

  it("rolls back an actual SQL insert failure and retries the same still-owned question", async () => {
    const f = await fixture(); const [write, read, returned] = f.citations;
    const submission = f.submit([write!, write!, read!, returned!], [0, 2, 3]);
    f.raw.exec("CREATE TRIGGER reject_fixture_attempt BEFORE INSERT ON ownership_attempts BEGIN SELECT RAISE(ABORT,'fixture insert denied'); END");
    const failure: unknown = await f.app.gradeOwnershipAnswer(submission).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "OwnershipCapsuleStoreError", message: "所有权胶囊存储失败", code: "INVALID_MATERIAL" });
    // The native trigger's SQL text must not cross the application boundary.
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).not.toContain("fixture insert denied");
    expect(await f.attempts()).toEqual([]);
    f.raw.exec("DROP TRIGGER reject_fixture_attempt");
    expect((await f.app.gradeOwnershipAnswer(submission)).passed).toBe(true);
    expect(structure((await f.attempts())[0]!).roles.map(item => item.citationIndex)).toEqual([0, 1, 2]);
    await expect(f.app.gradeOwnershipAnswer(submission)).rejects.toThrow("题目不存在");
  });

  it("preserves an existing misindexed historical payload byte for byte through new saves and reopen", async () => {
    const f = await fixture(); const store = new GraphStore(f.dbPath, "project"); handles.add(store);
    const historical: OwnershipAttempt = {
      ...f.ref, attemptId: "historical-before-fix", questionId: f.question.id, questionVersion: f.question.version,
      concept: f.question.concept, questionKind: f.question.kind, variantKey: f.question.variantKey,
      structuredAnswer: { kind: "variable-flow", roles: [{ role: "write", citationIndex: 0 }, { role: "read", citationIndex: 2 }, { role: "return", citationIndex: 3 }] },
      citations: f.citations, locationScore: 100, structureScore: 100, passed: true, scoringVersion: OWNERSHIP_SCORING_VERSION,
      semanticText: "historical fixture", completedAt: "2026-01-01T00:00:00.000Z", legacy: false,
    };
    store.saveOwnershipAttempt(historical);
    const payload = () => (f.raw.prepare("SELECT payload FROM ownership_attempts WHERE attempt_id=?").get(historical.attemptId) as { payload: string }).payload;
    const original = payload();
    const [write, read, returned] = f.citations;
    await f.app.gradeOwnershipAnswer(f.submit([write!, write!, read!, returned!], [0, 2, 3]));
    expect(payload()).toBe(original);
    f.app.close(); handles.delete(f.app);
    const reopened = new XRayApplication(f.options); handles.add(reopened);
    const attempts = (await reopened.getOwnershipProgress(f.ref)).attempts;
    expect(attempts.find(item => item.attemptId === historical.attemptId)).toEqual(historical);
    expect(payload()).toBe(original);
    expect(structure(attempts.find(item => item.attemptId !== historical.attemptId)!).roles.map(item => item.citationIndex)).toEqual([0, 1, 2]);
  });

  it("rejects a second-connection configuration change after validation and before the save, without writing", async () => {
    const f = await fixture(); const second = new GraphStore(f.dbPath, "project"); handles.add(second);
    const original = GraphStore.prototype.withIgnoreRevision;
    vi.spyOn(GraphStore.prototype, "withIgnoreRevision").mockImplementationOnce(function(this: GraphStore, repositoryId, revision, work) {
      second.saveIgnoreSettings(repositoryId, revision, ["never/"]);
      return original.call(this, repositoryId, revision, work);
    });
    const [write, read, returned] = f.citations;
    await expect(f.app.gradeOwnershipAnswer(f.submit([write!, write!, read!, returned!], [0, 2, 3]))).rejects.toThrow("配置已变化");
    expect(second.listOwnershipAttempts(f.ref.repositoryId)).toEqual([]);
  });

  it("fails safely without writing when an internal grade loses a validated citation mapping", async () => {
    const f = await fixture(); const original = ownership.gradeAnswer;
    vi.spyOn(ownership, "gradeAnswer").mockImplementationOnce((question, submission, snapshot, citations) => ({
      ...original(question, submission, snapshot, citations), validatedCitations: citations.filter(item => item.evidenceId !== f.citations[1]!.evidenceId),
    }));
    await expect(f.app.gradeOwnershipAnswer(f.submit(f.citations, [0, 1, 2]))).rejects.toMatchObject({ name: "SafeDiagnosticError", diagnosticCode: "TASK_FAILED" });
    expect(await f.attempts()).toEqual([]);
  });
});
