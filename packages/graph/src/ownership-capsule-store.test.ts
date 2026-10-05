import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson, canonicalSnapshotResult, computeOwnershipAttemptHash, computeOwnershipCapsuleHash, computeOwnershipLimitationId, computeOwnershipQuestionFingerprint,
  computeOwnershipRubricHash, computeOwnershipSubmissionProjectionHash, hashOwnershipAnswer, IGNORE_POLICY_VERSION, ownershipAttemptPreimage, ownershipCapsulePreimage, ownershipQuestionPreimage, validateOwnershipSemanticPackage,
  type OwnershipAttempt, type OwnershipCapsule, type OwnershipCapsuleSourceIdentity, type OwnershipGrade, type OwnershipQuestion, type OwnershipQuestionRequest, type OwnershipReadyCapsule, type OwnershipSubmission, type ProjectSnapshot, type SourceCitation,
} from "@project-xray/contracts";
import { GraphStore } from "./index.js";
import { type OwnershipCapsuleWriteInput, type PreparedOwnershipWrite } from "./ownership-capsule-store.js";

const handles: (Database.Database | GraphStore)[] = [], directories: string[] = [];
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const db = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
const open = (path = ":memory:", role: "global" | "project" = "project") => { const store = new GraphStore(path, role); handles.push(store); return store; };
const connect = (path: string) => { const connection = new Database(path); connection.pragma("busy_timeout=10"); handles.push(connection); return connection; };
async function pathFixture(name: string): Promise<string> { const directory = await mkdtemp(join(tmpdir(), "xray-capsule-")); directories.push(directory); return join(directory, name); }
afterEach(async () => {
  vi.restoreAllMocks(); for (const handle of handles.splice(0).reverse()) { if (handle instanceof Database) { if (handle.open) handle.close(); } else if (db(handle).open) handle.close(); }
  for (const directory of directories.splice(0)) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith("xray-capsule-")) throw new Error("unsafe fixture cleanup"); await rm(directory, { recursive: true, force: true }); }
});
const span = (line: number, endColumn: number) => ({ filePath: "a.ts", startLine: line, startColumn: 0, endLine: line, endColumn });
async function fixture(store: GraphStore, attemptId = "attempt", ready = true, rules?: string[]): Promise<OwnershipCapsuleWriteInput> {
  const content = "token = 1;\nuse(token)\nreturn token\n// 中文🙂";
  const snapshot: ProjectSnapshot = {
    repositoryId: "repo", snapshotId: "snap", name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-10-02T00:00:00.000Z",
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { fixture: "1.0.0" }, configurationHash: "a".repeat(64), sourceFingerprint: sha(content) },
    sourceFiles: [{ filePath: "a.ts", contentHash: sha(content), bytes: Buffer.byteLength(content), language: "TypeScript" }],
    health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] },
    nodes: ["a", "b", "c", "v"].map((id, index) => ({ id, snapshotId: "snap", kind: id === "v" ? "variable" : "function", name: id, qualifiedName: id, filePath: "a.ts", span: span(Math.min(index + 1, 3), 3), metadata: {} })),
    edges: ["write", "read", "return"].map((id, index) => ({ id, snapshotId: "snap", source: ["a", "b", "c"][index]!, target: "v", kind: (["WRITES", "READS", "RETURNS"] as const)[index]!, confidence: "verified", evidenceId: `e-${id}`, reason: "fixture" })),
    evidence: ["write", "read", "return"].map((id, index) => ({ id: `e-${id}`, snapshotId: "snap", analyzer: "fixture", analyzerVersion: "1.0.0", kind: ["variable-write", "variable-read", "return-flow"][index]!, confidence: "verified", reason: "fixture", span: span(index + 1, content.split("\n")[index]!.length) })),
  };
  if (rules) {
    const normalized = store.saveIgnoreSettings("repo", 0, rules).rules;
    snapshot.analysisIdentity.ignorePolicy = { version: IGNORE_POLICY_VERSION, rules: normalized, hash: sha(JSON.stringify([IGNORE_POLICY_VERSION, normalized])) };
  }
  snapshot.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: sha(canonicalSnapshotResult(snapshot)) };
  if (!store.loadSnapshot("snap")) store.saveSnapshot(snapshot, [{ filePath: "a.ts", contentHash: sha(content), content, language: "TypeScript" }]);
  const source = store.captureOwnershipSource("repo", "snap", store.loadIgnoreSettings("repo").revision);
  const question: OwnershipQuestion = { repositoryId: "repo", snapshotId: "snap", id: "q", version: "2.0.0", kind: "variable-flow", prompt: "解释三个所选位置的变量角色", concept: { id: "variable-flow:v", label: "变量v" }, learningObjective: "定位变量角色", difficulty: "hard", choices: [], evidenceIds: snapshot.evidence.map(item => item.id), expectedNodeIds: ["v"], deterministicChecks: [{ kind: "variable-roles", requirements: ["write", "read", "return"].map((role, index) => ({ role: role as "write" | "read" | "return", edgeIds: [snapshot.edges[index]!.id] })) }], variantKey: ready ? "variable:v:write,read,return" : "v".repeat(5275) };
  const citations = snapshot.evidence.map(proof => ({ ...proof.span, evidenceId: proof.id }));
  const attempt: OwnershipAttempt = { attemptId, repositoryId: "repo", snapshotId: "snap", questionId: question.id, questionVersion: question.version, concept: question.concept, questionKind: question.kind, variantKey: question.variantKey,
    structuredAnswer: { kind: "variable-flow", roles: (["write", "read", "return"] as const).map((role, index) => ({ role, citationIndex: index })) }, citations, locationScore: 100, structureScore: 100, passed: true, scoringVersion: "2.1.0", semanticText: ready ? "三个源码引用分别写入、读取与返回。🙂" : "原答案".repeat(1500), completedAt: "2026-10-02T01:00:00.000Z", legacy: false };
  const questionFingerprint = await computeOwnershipQuestionFingerprint(question), attemptHash = await computeOwnershipAttemptHash(attempt), answerHash = await hashOwnershipAnswer(attempt.semanticText);
  const sourceIdentity = { activation: source.activation, analysisResultFingerprint: source.analysisIdentity.analysisResult!.fingerprint, configurationHash: source.analysisIdentity.configurationHash, ignorePolicyHash: source.analysisIdentity.ignorePolicy?.hash ?? null, sourceManifestHash: source.sourceManifestHash, ignoreRevision: source.ignoreRevision };
  if (!ready) {
    const capsule: OwnershipCapsule = { version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason: "rubric-budget-exceeded", questionFingerprint, attemptHash, answerHash, submissionProjectionHash: null, sourceIdentity, capsuleHash: "0".repeat(64) };
    capsule.capsuleHash = await computeOwnershipCapsuleHash(capsule); return { question, attempt, capsule, source };
  }
  const roleBindings = (["write", "read", "return"] as const).map((role, index) => ({ role, originalCitationIndex: index + 1, validatedCitationIndex: index, edgeId: snapshot.edges[index]!.id, evidenceId: snapshot.evidence[index]!.id }));
  const citationOrder = [0, 0, 1, 2];
  const criteria: OwnershipReadyCapsule["rubric"]["criteria"] = [], limitations: OwnershipReadyCapsule["rubric"]["limitations"] = [];
  for (const [index, role] of roleBindings.entries()) {
    const criterionId = `criterion-${role.role}`, requiredEvidenceIds = [role.evidenceId], allowedLimitationIds: string[] = [];
    for (const code of ["static-only", "answer-information-insufficient"] as const) {
      const item = { code, criterionIds: [criterionId], relatedEvidenceIds: code === "static-only" ? requiredEvidenceIds : [], description: code === "static-only" ? "静态事实不能证明运行时发生" : "答案信息可能不足" };
      const limitationId = await computeOwnershipLimitationId(item); limitations.push({ ...item, limitationId }); allowedLimitationIds.push(limitationId);
    }
    criteria.push({ criterionId, proposition: `变量在所选位置承担${role.role}角色`, weight: index === 0 ? 34 : 33, requiredEvidenceIds, allowedEvidenceIds: requiredEvidenceIds, allowedLimitationIds, answerScope: [{ start: 0, end: attempt.semanticText.length }] });
  }
  const rubricContent = { version: "1.0.0" as const, questionId: question.id, questionVersion: question.version, questionFingerprint, questionKind: question.kind, learningObjective: question.learningObjective, criteria, limitations, selectedPath: null };
  const structured = attempt.structuredAnswer as { kind: "variable-flow"; roles: { role: "write" | "read" | "return"; citationIndex: number }[] };
  const submissionProjectionHash = await computeOwnershipSubmissionProjectionHash({ originalCitations: citationOrder.map(index => citations[index]!), originalStructuredAnswer: { kind: "variable-flow", roles: roleBindings.map(role => ({ role: role.role, citationIndex: role.originalCitationIndex })) }, citationOrder, roleBindings, normalizedStructuredAnswer: structured, validatedCitations: citations });
  const capsule: OwnershipReadyCapsule = { version: "1.0.0", builderVersion: "1.0.0", status: "ready", repositoryId: "repo", snapshotId: "snap", attemptId, questionId: question.id, questionVersion: question.version, questionKind: question.kind, variantKey: question.variantKey, prompt: question.prompt, learningObjective: question.learningObjective,
    questionFingerprint, attemptHash, answerHash, submissionProjectionHash, deterministicScoringVersion: "2.1.0", sourceIdentity, analysisIdentity: { ...snapshot.analysisIdentity, ignorePolicy: snapshot.analysisIdentity.ignorePolicy ? { version: snapshot.analysisIdentity.ignorePolicy.version, hash: snapshot.analysisIdentity.ignorePolicy.hash } : null, analysisResult: snapshot.analysisIdentity.analysisResult },
    rubric: { ...rubricContent, rubricHash: await computeOwnershipRubricHash(rubricContent) }, citationOrder, roleBindings, necessaryNodeIds: ["a", "b", "c", "v"], necessaryEdgeIds: ["read", "return", "write"],
    necessaryProofs: snapshot.evidence.map(proof => ({ evidenceId: proof.id, kind: proof.kind as "variable-write" | "variable-read" | "return-flow", filePath: proof.span.filePath, span: proof.span, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: "verified", contentHash: sha(content) })), createdAt: attempt.completedAt, capsuleHash: "0".repeat(64) };
  capsule.capsuleHash = await computeOwnershipCapsuleHash(capsule); return { question, attempt, capsule, source };
}
function counts(store: GraphStore): { attempts: number; capsules: number } {
  return { attempts: (db(store).prepare("SELECT count(*) n FROM ownership_attempts").get() as { n: number }).n, capsules: (db(store).prepare("SELECT count(*) n FROM ownership_semantic_capsules").get() as { n: number }).n };
}
function databaseState(store: GraphStore): string {
  const schema = db(store).prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name").all() as { name: string; type: string; sql: string | null }[];
  return canonicalJson({ schema, rows: schema.filter(item => item.type === "table").map(item => ({ table: item.name, rows: db(store).prepare(`SELECT * FROM "${item.name.replaceAll('"', '""')}"`).all() })) });
}
async function resign(input: OwnershipCapsuleWriteInput): Promise<void> {
  input.capsule.questionFingerprint = await computeOwnershipQuestionFingerprint(input.question); input.capsule.attemptHash = await computeOwnershipAttemptHash(input.attempt); input.capsule.capsuleHash = await computeOwnershipCapsuleHash(input.capsule);
}
async function relationshipFixture(store: GraphStore, kind: "entry" | "call-direction" | "call-path", rules?: string[]): Promise<OwnershipCapsuleWriteInput> {
  const input = await fixture(store, "attempt", true, rules), snapshot = structuredClone(store.loadSnapshot("snap")!), content = "function b() {}\na calls b()\nb calls c()";
  snapshot.snapshotId = kind; snapshot.createdAt = "2026-10-02T00:01:00.000Z";
  snapshot.nodes.forEach(node => { node.snapshotId = kind; }); if (kind === "entry") snapshot.nodes[0]!.kind = "file";
  snapshot.sourceFiles[0]!.contentHash = sha(content); snapshot.sourceFiles[0]!.bytes = Buffer.byteLength(content);
  snapshot.analysisIdentity.sourceFingerprint = sha(content);
  const edgeIds = kind === "entry" ? ["definition"] : kind === "call-direction" ? ["ab"] : ["ab", "bc"];
  snapshot.edges = edgeIds.map((id, index) => ({ id, snapshotId: kind, source: index === 0 ? "a" : "b", target: index === 0 ? "b" : "c", kind: kind === "entry" ? "DEFINES" : "CALLS", confidence: "verified", evidenceId: `e-${id}`, reason: "fixture" }));
  snapshot.evidence = edgeIds.map((id, index) => ({ id: `e-${id}`, snapshotId: kind, analyzer: "fixture", analyzerVersion: "1.0.0", kind: kind === "entry" ? "symbol-definition" : "call-expression", confidence: "verified", reason: "fixture", span: span(kind === "entry" ? 1 : index + 2, kind === "entry" ? 15 : 11) }));
  snapshot.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: sha(canonicalSnapshotResult(snapshot)) };
  store.saveSnapshot(snapshot, [{ filePath: "a.ts", contentHash: sha(content), language: "TypeScript", content }]);
  const q = input.question; Object.assign(q, { id: `q-${kind}`, snapshotId: kind, kind, variantKey: kind, concept: { id: kind, label: kind }, prompt: "解释所选静态关系", learningObjective: "核验静态关系", evidenceIds: snapshot.evidence.map(proof => proof.id), expectedNodeIds: kind === "entry" ? ["b"] : kind === "call-direction" ? ["a", "b"] : ["a", "b", "c"], deterministicChecks: kind === "entry" ? [{ kind: "definition", nodeId: "b", edgeId: "definition" }] : kind === "call-direction" ? [{ kind: "call-direction", sourceNodeId: "a", targetNodeId: "b", edgeId: "ab" }] : [{ kind: "ordered-path", legalNodePaths: [["a", "b", "c"]], legalEdgePaths: [["ab", "bc"]] }] });
  Object.assign(input.attempt, { snapshotId: kind, questionId: q.id, questionKind: kind, variantKey: kind, concept: q.concept, structuredAnswer: kind === "entry" ? { kind, nodeId: "b" } : kind === "call-direction" ? { kind, callerNodeId: "a", calleeNodeId: "b" } : { kind, nodeIds: ["a", "b", "c"] }, citations: snapshot.evidence.map(proof => ({ ...proof.span, evidenceId: proof.id })) });
  input.source = store.captureOwnershipSource("repo", kind, store.loadIgnoreSettings("repo").revision);
  const cap = input.capsule as OwnershipReadyCapsule; Object.assign(cap, { snapshotId: kind, questionId: q.id, questionKind: kind, variantKey: kind, prompt: q.prompt, learningObjective: q.learningObjective, questionFingerprint: await computeOwnershipQuestionFingerprint(q), attemptHash: await computeOwnershipAttemptHash(input.attempt), sourceIdentity: { activation: input.source.activation, analysisResultFingerprint: input.source.analysisIdentity.analysisResult!.fingerprint, configurationHash: input.source.analysisIdentity.configurationHash, ignorePolicyHash: input.source.analysisIdentity.ignorePolicy?.hash ?? null, sourceManifestHash: input.source.sourceManifestHash, ignoreRevision: input.source.ignoreRevision }, analysisIdentity: { ...snapshot.analysisIdentity, ignorePolicy: snapshot.analysisIdentity.ignorePolicy ? { version: snapshot.analysisIdentity.ignorePolicy.version, hash: snapshot.analysisIdentity.ignorePolicy.hash } : null }, citationOrder: edgeIds.map((_, index) => index), roleBindings: [], necessaryNodeIds: kind === "call-path" ? ["a", "b", "c"] : ["a", "b"], necessaryEdgeIds: edgeIds,
    necessaryProofs: snapshot.evidence.map(proof => ({ evidenceId: proof.id, kind: proof.kind, filePath: proof.span.filePath, span: proof.span, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: "verified", contentHash: sha(content) })) });
  const criteria: OwnershipReadyCapsule["rubric"]["criteria"] = [], limitations: OwnershipReadyCapsule["rubric"]["limitations"] = [];
  for (const [index, edge] of snapshot.edges.entries()) {
    const criterionId = `criterion-${index}`, allowedLimitationIds: string[] = [], requiredEvidenceIds = [edge.evidenceId];
    for (const code of ["static-only", "answer-information-insufficient"] as const) { const value = { code, criterionIds: [criterionId], relatedEvidenceIds: code === "static-only" ? requiredEvidenceIds : [], description: "有限静态关系" }; const limitationId = await computeOwnershipLimitationId(value); limitations.push({ ...value, limitationId }); allowedLimitationIds.push(limitationId); }
    criteria.push({ criterionId, proposition: "解释所选静态关系", weight: 100 / edgeIds.length, requiredEvidenceIds, allowedEvidenceIds: requiredEvidenceIds, allowedLimitationIds, answerScope: [{ start: 0, end: input.attempt.semanticText.length }] });
  }
  const contentRubric = { version: "1.0.0" as const, questionId: q.id, questionVersion: q.version, questionFingerprint: cap.questionFingerprint, questionKind: q.kind, learningObjective: q.learningObjective, criteria, limitations, selectedPath: kind === "call-path" ? { nodeIds: ["a", "b", "c"], edgeIds } : null };
  cap.rubric = { ...contentRubric, rubricHash: await computeOwnershipRubricHash(contentRubric) };
  const structure = input.attempt.structuredAnswer as import("@project-xray/contracts").OwnershipSubmission["structuredAnswer"];
  cap.submissionProjectionHash = await computeOwnershipSubmissionProjectionHash({ originalCitations: input.attempt.citations, originalStructuredAnswer: structure, citationOrder: cap.citationOrder, roleBindings: [], normalizedStructuredAnswer: structure, validatedCitations: input.attempt.citations });
  cap.capsuleHash = await computeOwnershipCapsuleHash(cap); return input;
}
describe("source-owned ownership capsule transactions", () => {
  it.each([{ rules: [] }, { rules: ["never"] }])("完整policy $rules与有限DTO保存重开，完整规则与源码不改写", async ({ rules }) => {
    const path = await pathFixture("policy.sqlite"); let store = open(path); const input = await fixture(store, "attempt", true, rules);
    const snapshot = canonicalJson(store.loadSnapshot("snap")), sources = db(store).prepare("SELECT * FROM source_snapshots").all();
    expect(input.source.analysisIdentity.ignorePolicy?.rules).toEqual(rules);
    expect(Object.keys((input.capsule as OwnershipReadyCapsule).analysisIdentity.ignorePolicy!).sort()).toEqual(["hash", "version"]);
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    store.close(); store = open(path);
    expect(await store.loadOwnershipCapsule("attempt")).toMatchObject({ status: "ready", capsule: input.capsule, attempt: input.attempt });
    expect(canonicalJson(store.loadSnapshot("snap"))).toBe(snapshot); expect(db(store).prepare("SELECT * FROM source_snapshots").all()).toEqual(sources);
  });
  it.each(["policy-version", "policy-hash", "source-fingerprint", "result-fingerprint", "configuration-hash", "captured-rules"] as const)("有限投影 %s 错配重算capsuleHash仍拒绝且零写", async change => {
    const store = open(), input = await fixture(store, "attempt", true, ["never"]), cap = input.capsule as OwnershipReadyCapsule;
    if (change === "policy-version") cap.analysisIdentity.ignorePolicy!.version = "2.0.0";
    if (change === "policy-hash") { cap.analysisIdentity.ignorePolicy!.hash = "b".repeat(64); cap.sourceIdentity.ignorePolicyHash = "b".repeat(64); }
    if (change === "source-fingerprint") cap.analysisIdentity.sourceFingerprint = "b".repeat(64);
    if (change === "result-fingerprint") { cap.analysisIdentity.analysisResult.fingerprint = "b".repeat(64); cap.sourceIdentity.analysisResultFingerprint = "b".repeat(64); }
    if (change === "configuration-hash") { cap.analysisIdentity.configurationHash = "b".repeat(64); cap.sourceIdentity.configurationHash = "b".repeat(64); }
    if (change === "captured-rules") input.source.analysisIdentity.ignorePolicy!.rules = ["different"];
    cap.capsuleHash = await computeOwnershipCapsuleHash(cap);
    await expect(store.prepareOwnershipAttemptWithCapsule(input)).rejects.toMatchObject({ name: "OwnershipCapsuleStoreError" }); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
    expect(store.loadSnapshot("snap")!.analysisIdentity.ignorePolicy?.rules).toEqual(["never"]);
  });
  it("有限DTO不放宽完整policy的第二连接配置事务门", async () => {
    const path = await pathFixture("policy-gate.sqlite"), store = open(path), input = await fixture(store, "attempt", true, ["never"]);
    const receipt = await store.prepareOwnershipAttemptWithCapsule(input), second = open(path);
    second.saveIgnoreSettings("repo", input.source.ignoreRevision, ["later"]);
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
  });
  it("builder晚期not-evaluated保留的非空projection必须有原submission才能prepare", async () => {
    const store = open(), input = await fixture(store, "late-budget", false), snapshot = store.loadSnapshot("snap")!;
    const builderUrl = new URL("../../ownership/src/semantic-rubric.ts", import.meta.url).href, ownershipUrl = new URL("../../ownership/src/index.ts", import.meta.url).href;
    const builder = await import(/* @vite-ignore */ builderUrl) as { buildOwnershipRubricCapsule(input: unknown): Promise<OwnershipCapsule> }, ownership = await import(/* @vite-ignore */ ownershipUrl) as { gradeAnswer(question: OwnershipQuestion, submission: OwnershipSubmission, snapshot: ProjectSnapshot, citations: SourceCitation[]): OwnershipGrade };
    const submission: OwnershipSubmission = { repositoryId: "repo", snapshotId: "snap", questionId: input.question.id, questionVersion: input.question.version, selfConfidence: .5, answer: input.attempt.semanticText, citations: [input.attempt.citations[0]!, ...input.attempt.citations], structuredAnswer: { kind: "variable-flow", roles: (["write", "read", "return"] as const).map((role, index) => ({ role, citationIndex: index + 1 })) } };
    const grade = ownership.gradeAnswer(input.question, submission, snapshot, input.attempt.citations), source = store.readSnapshotSource("snap", "a.ts")!;
    input.capsule = await builder.buildOwnershipRubricCapsule({ question: input.question, submission, grade, attempt: input.attempt, snapshot, validatedCitations: input.attempt.citations, sourceIdentity: input.capsule.sourceIdentity, sources: [{ repositoryId: "repo", snapshotId: "snap", filePath: "a.ts", contentHash: source.contentHash, content: source.content }] });
    expect(input.capsule).toMatchObject({ status: "not-evaluated", reason: "rubric-budget-exceeded" }); expect(input.capsule.submissionProjectionHash).not.toBeNull();
    await expect(store.prepareOwnershipAttemptWithCapsule(input)).rejects.toThrow("所有权胶囊存储失败");
    const withSubmission = { ...input, submission };
    const forged = structuredClone(withSubmission); forged.capsule.submissionProjectionHash = "b".repeat(64); forged.capsule.capsuleHash = await computeOwnershipCapsuleHash(forged.capsule);
    await expect(store.prepareOwnershipAttemptWithCapsule(forged)).rejects.toThrow("所有权胶囊存储失败");
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { entered(); await gate; return digest(...args); });
    const pending = store.prepareOwnershipAttemptWithCapsule(withSubmission); await started;
    withSubmission.submission.answer = "after-capture"; if (withSubmission.submission.structuredAnswer.kind === "variable-flow") withSubmission.submission.structuredAnswer.roles[0]!.citationIndex = 2; release();
    const receipt = await pending; store.savePreparedOwnershipAttempt(receipt);
    expect(await store.loadOwnershipCapsule("late-budget")).toMatchObject({ status: "not-evaluated", questionBinding: "prepare-only", attempt: input.attempt });
  });
  it.each((["entry", "call-direction", "call-path", "variable-flow"] as const).flatMap(kind => (["project", "global"] as const).flatMap(role => [[], ["never"]].map(rules => ({ kind, role, rules }))))) ("消费真实builder $kind/$role/$rules 保存重开并零写返回完整语义材料", async ({ kind, role, rules }) => {
    // Test orchestration only: builder is deliberately not exported from the production package barrel until S5.
    // Runtime module loading keeps graph's production dependencies/rootDir unchanged; all exchanged data use public contracts.
    const ownershipUrl = new URL("../../ownership/src/index.ts", import.meta.url).href;
    const builderUrl = new URL("../../ownership/src/semantic-rubric.ts", import.meta.url).href;
    const ownership = await import(/* @vite-ignore */ ownershipUrl) as { createQuestions(snapshot: ProjectSnapshot, request: OwnershipQuestionRequest): OwnershipQuestion[]; gradeAnswer(question: OwnershipQuestion, submission: OwnershipSubmission, snapshot: ProjectSnapshot, citations: SourceCitation[]): OwnershipGrade };
    const builder = await import(/* @vite-ignore */ builderUrl) as { buildOwnershipRubricCapsule(input: { question: OwnershipQuestion; submission: OwnershipSubmission; grade: OwnershipGrade; attempt: OwnershipAttempt; snapshot: ProjectSnapshot; validatedCitations: SourceCitation[]; sourceIdentity: OwnershipCapsuleSourceIdentity; sources: { repositoryId: string; snapshotId: string; filePath: string; contentHash: string; content: string }[] }): Promise<OwnershipCapsule> };
    const path = await pathFixture(`${kind}.sqlite`); let store = open(path, role);
    const input = kind === "variable-flow" ? await fixture(store, "attempt", true, rules) : await relationshipFixture(store, kind, rules), snapshot = store.loadSnapshot(input.attempt.snapshotId)!;
    const question = ownership.createQuestions(snapshot, { repositoryId: "repo", snapshotId: snapshot.snapshotId, count: 20, scope: { kind: "project" } }).find(item => item.kind === kind)!;
    expect(question).toBeDefined();
    const structured = input.attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"];
    const submission: OwnershipSubmission = { repositoryId: "repo", snapshotId: snapshot.snapshotId, questionId: question.id, questionVersion: question.version, selfConfidence: .5, answer: input.attempt.semanticText, citations: input.attempt.citations,
      structuredAnswer: structured.kind === "variable-flow" ? { kind: "variable-flow", roles: structured.roles.map((role, index) => ({ ...role, citationIndex: index + 1 })) } : structured };
    if (kind === "variable-flow") submission.citations = [input.attempt.citations[0]!, ...input.attempt.citations];
    const grade = ownership.gradeAnswer(question, submission, snapshot, input.attempt.citations); expect(grade.passed).toBe(true);
    Object.assign(input.attempt, { questionId: question.id, questionVersion: question.version, questionKind: question.kind, concept: question.concept, variantKey: question.variantKey, locationScore: grade.location.score, structureScore: grade.structure.score, passed: grade.passed, scoringVersion: grade.scoringVersion });
    const sourceIdentity: OwnershipCapsuleSourceIdentity = { activation: input.source.activation, analysisResultFingerprint: input.source.analysisIdentity.analysisResult!.fingerprint, configurationHash: input.source.analysisIdentity.configurationHash, ignorePolicyHash: input.source.analysisIdentity.ignorePolicy?.hash ?? null, sourceManifestHash: input.source.sourceManifestHash, ignoreRevision: input.source.ignoreRevision };
    const sources = snapshot.sourceFiles.map(file => { const source = store.readSnapshotSource(snapshot.snapshotId, file.filePath)!; return { repositoryId: "repo", snapshotId: snapshot.snapshotId, filePath: file.filePath, contentHash: source.contentHash, content: source.content }; });
    const capsule = await builder.buildOwnershipRubricCapsule({ question, submission, grade, attempt: input.attempt, snapshot, validatedCitations: input.attempt.citations, sourceIdentity, sources });
    expect(capsule.status).toBe("ready"); const before = canonicalJson(input.attempt);
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule({ ...input, question, capsule, submission }));
    store.close(); store = open(path, role);
    expect(await store.loadOwnershipCapsule("attempt")).toMatchObject({ status: "ready", questionBinding: "prepare-only", capsule, attempt: input.attempt }); expect(canonicalJson(store.listOwnershipAttempts("repo")[0])).toBe(before);
    const state = databaseState(store), changes = db(store).prepare("SELECT total_changes() n").get();
    db(store).pragma("query_only=ON");
    const material = await store.loadOwnershipSemanticPackage("attempt");
    expect(material).toMatchObject({ status: "ready", questionBinding: "prepare-only", currentness: "not-checked", attempt: input.attempt, capsule });
    if (material.status !== "ready" || capsule.status !== "ready") throw new Error("ready required");
    expect(await validateOwnershipSemanticPackage(material.package, input.attempt.semanticText)).toEqual(material.package);
    expect(material.package.analysisIdentity).toEqual(capsule.analysisIdentity);
    expect(material.package.structuredAnswer).toEqual(input.attempt.structuredAnswer);
    expect(material.package.validatedCitations).toEqual(input.attempt.citations);
    expect(material.package.rubric).toEqual(capsule.rubric);
    expect(material.package.edges.map(edge => edge.id)).toEqual(capsule.necessaryEdgeIds);
    expect(material.package.proofs.map(proof => proof.id)).toEqual(capsule.necessaryProofs.map(proof => proof.evidenceId));
    for (const proof of material.package.proofs) { const original = sources.find(source => source.filePath === proof.span.filePath)!; const lines = original.content.split("\n"); const slice = lines.slice(proof.span.startLine - 1, proof.span.endLine); slice[0] = slice[0]!.slice(proof.span.startColumn); slice[slice.length - 1] = slice[slice.length - 1]!.slice(0, proof.span.startLine === proof.span.endLine ? proof.span.endColumn - proof.span.startColumn : proof.span.endColumn); expect(proof.snippet).toBe(slice.join("\n")); }
    expect(db(store).prepare("SELECT total_changes() n").get()).toEqual(changes); expect(databaseState(store)).toBe(state);
    db(store).pragma("query_only=OFF");
  });
  it.each(["entry", "call-direction", "call-path"] as const)("%s 在源事实闭合下保存/读取，完整原题与关系错配拒绝", async kind => {
    const store = open(), input = await relationshipFixture(store, kind); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    expect(await store.loadOwnershipCapsule("attempt")).toMatchObject({ status: "ready", questionBinding: "prepare-only", capsule: input.capsule });
    const forged = structuredClone(input); forged.attempt.attemptId = "wrong"; (forged.capsule as OwnershipReadyCapsule).attemptId = "wrong";
    forged.question.deterministicChecks = kind === "entry" ? [{ kind: "definition", nodeId: "c", edgeId: "definition" }] : kind === "call-direction" ? [{ kind: "call-direction", sourceNodeId: "b", targetNodeId: "a", edgeId: "ab" }] : [{ kind: "ordered-path", legalNodePaths: [["a", "b", "c"]], legalEdgePaths: [["bc", "ab"]] }];
    await resign(forged); const cap = forged.capsule as OwnershipReadyCapsule; cap.rubric.questionFingerprint = cap.questionFingerprint; const { rubricHash: _hash, ...content } = cap.rubric; cap.rubric.rubricHash = await computeOwnershipRubricHash(content); cap.capsuleHash = await computeOwnershipCapsuleHash(cap);
    await expect(store.prepareOwnershipAttemptWithCapsule(forged)).rejects.toThrow("所有权胶囊存储失败"); expect(counts(store)).toEqual({ attempts: 1, capsules: 1 });
  });
  it("WebCrypto与Node消耗同preimage；ready双INSERT重开与prepare-only历史保证", async () => {
    const path = await pathFixture("source.sqlite"); let store = open(path); const input = await fixture(store);
    expect(input.capsule.attemptHash).toBe(sha(ownershipAttemptPreimage(input.attempt))); expect(input.capsule.capsuleHash).toBe(sha(ownershipCapsulePreimage(input.capsule))); expect(input.capsule.questionFingerprint).toBe(sha(ownershipQuestionPreimage(input.question)));
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input)); expect(counts(store)).toEqual({ attempts: 1, capsules: 1 }); store.close(); store = open(path);
    const result = await store.loadOwnershipCapsule("attempt"); expect(result).toMatchObject({ status: "ready", questionBinding: "prepare-only", attempt: input.attempt, capsule: input.capsule });
    expect(store.loadOwnershipQuestionBinding("attempt")).toMatchObject({ status: "unavailable", currentness: "not-checked", record: { reason: "untrusted-issuance" } });
    expect((db(store).prepare("PRAGMA foreign_key_check").all())).toEqual([]); expect(db(store).pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db(store).prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([...Array.from({ length: 11 }, (_, index) => ({ version: index + 1 })), { version: 15 }, { version: 18 }]);
  });
  it("not-evaluated完整大attempt与孤立代理JSON转义双写，不扩大胶囊或重解释旧数据", async () => {
    const path = await pathFixture("not-ready.sqlite"); let store = open(path); const large = await fixture(store, "original-large", false);
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(large));
    expect(Buffer.byteLength(canonicalJson(large.attempt))).toBeGreaterThan(19000);
    const input = await fixture(store, "large", false); input.attempt.citations = Array.from({ length: 100 }, (_, index) => input.attempt.citations[index % 3]!);
    input.attempt.semanticText = "\ud800原本地答案"; input.capsule.answerHash = null; input.capsule.status === "not-evaluated" && (input.capsule.reason = "answer-encoding-unavailable"); await resign(input);
    expect(input.capsule.attemptHash).toBe(sha(ownershipAttemptPreimage(input.attempt)));
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    const row = db(store).prepare("SELECT payload FROM ownership_attempts WHERE attempt_id='large'").get() as { payload: string };
    expect(row.payload).toBe(canonicalJson(input.attempt)); expect(row.payload).toContain("\\ud800"); expect(row.payload).toContain("v".repeat(5275));
    const cap = db(store).prepare("SELECT payload FROM ownership_semantic_capsules WHERE attempt_id='large'").get() as { payload: string }; expect(Buffer.byteLength(cap.payload)).toBeLessThanOrEqual(2048);
    store.close(); store = open(path);
    expect(await store.loadOwnershipCapsule("large")).toMatchObject({ status: "not-evaluated", questionBinding: "prepare-only", attempt: input.attempt });
    expect(await store.loadOwnershipCapsule("original-large")).toMatchObject({ status: "not-evaluated", questionBinding: "prepare-only", attempt: large.attempt });
  });
  it("首await前捕获所有输入，prepare后改对象不影响精确持久字符串；未知/跨store/复用receipt拒绝", async () => {
    const store = open(), input = await fixture(store), original = structuredClone(input), other = open();
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { expect(db(store).inTransaction).toBe(false); entered(); await gate; return digest(...args); });
    const pending = store.prepareOwnershipAttemptWithCapsule(input); await started;
    input.attempt.semanticText = "changed"; input.question.variantKey = "changed"; input.capsule.capsuleHash = "b".repeat(64); input.source.activation = "2026-01-01T00:00:00.000Z"; release();
    const receipt = await pending; expect(Object.keys(receipt)).toEqual([]); expect(Object.isFrozen(receipt)).toBe(true);
    expect(() => other.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); expect(() => store.savePreparedOwnershipAttempt({} as PreparedOwnershipWrite)).toThrow("所有权胶囊存储失败");
    input.attempt.attemptId = "after-prepare"; store.savePreparedOwnershipAttempt(receipt); expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败");
    expect(await store.loadOwnershipCapsule("attempt")).toMatchObject({ status: "ready", attempt: original.attempt, capsule: original.capsule });
  });
  it.each(["attempt", "capsule"] as const)("第 %s INSERT故障两行回滚，receipt失效后可安全重prepare", async stage => {
    const store = open(), input = await fixture(store), receipt = await store.prepareOwnershipAttemptWithCapsule(input);
    db(store).exec(`CREATE TRIGGER reject_insert BEFORE INSERT ON ${stage === "attempt" ? "ownership_attempts" : "ownership_semantic_capsules"} BEGIN SELECT RAISE(ABORT,'private injected source'); END`);
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); db(store).exec("DROP TRIGGER reject_insert");
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input)); expect(counts(store)).toEqual({ attempts: 1, capsules: 1 });
  });
  it("重复/不同payload冲突及存量attempt不能补胶囊，旧payload字节不变", async () => {
    const store = open(), input = await fixture(store); store.saveOwnershipAttempt(input.attempt);
    const old = (db(store).prepare("SELECT payload FROM ownership_attempts").get() as { payload: string }).payload;
    expect(await store.loadOwnershipCapsule("attempt")).toEqual({ status: "legacy-capsule-absent" });
    expect(() => store.savePreparedOwnershipAttempt({} as PreparedOwnershipWrite)).toThrow();
    const receipt = await store.prepareOwnershipAttemptWithCapsule(input); expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow();
    input.attempt.semanticText = "同ID其他答案"; input.capsule = { version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason: "structured-answer-mismatch", questionFingerprint: input.capsule.questionFingerprint, attemptHash: "0".repeat(64), capsuleHash: "0".repeat(64), answerHash: null, submissionProjectionHash: null, sourceIdentity: input.capsule.sourceIdentity }; await resign(input);
    const different = await store.prepareOwnershipAttemptWithCapsule(input); expect(() => store.savePreparedOwnershipAttempt(different)).toThrow();
    expect(counts(store)).toEqual({ attempts: 1, capsules: 0 }); expect((db(store).prepare("SELECT payload FROM ownership_attempts").get() as { payload: string }).payload).toBe(old);
    expect(await store.loadOwnershipCapsule("absent")).toEqual({ status: "not-found" });
  });
  it.each(["activation", "source", "settings", "analysis"] as const)("第二连接写前改变 %s 导致双行零写且重用receipt失败", async change => {
    const path = await pathFixture("source.sqlite"), store = open(path), input = await fixture(store), receipt = await store.prepareOwnershipAttemptWithCapsule(input), connection = connect(path);
    if (change === "activation") connection.prepare("UPDATE snapshot_overviews SET activated_at=? WHERE snapshot_id='snap'").run("2026-12-01T00:00:00.000Z");
    else if (change === "source") connection.prepare("UPDATE source_snapshots SET content=content || 'changed' WHERE snapshot_id='snap'").run();
    else if (change === "settings") connection.prepare("INSERT OR REPLACE INTO project_ignore_settings VALUES(?,?)").run("repo", JSON.stringify({ version: IGNORE_POLICY_VERSION, revision: 1, rules: ["later"] }));
    else { const changed = store.loadSnapshot("snap")!; changed.analysisIdentity.configurationHash = "b".repeat(64); changed.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: sha(canonicalSnapshotResult(changed)) }; connection.prepare("UPDATE snapshots SET payload=? WHERE snapshot_id='snap'").run(JSON.stringify(changed)); }
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 }); expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow();
  });
  it("两库legacy写入持有settings→source锁，第二settings连接写入被锁拒绝", async () => {
    const sourcePath = await pathFixture("source.sqlite"), settingsPath = await pathFixture("settings.sqlite"), store = open(sourcePath, "global"), settings = open(settingsPath), contender = connect(settingsPath);
    const input = await fixture(store), receipt = await store.prepareOwnershipAttemptWithCapsule(input, settings); let blocked = false;
    db(store).function("settings_probe", () => { try { contender.prepare("INSERT OR REPLACE INTO project_ignore_settings VALUES(?,?)").run("repo", JSON.stringify({ version: IGNORE_POLICY_VERSION, revision: 1, rules: ["change"] })); return 0; } catch (error) { blocked = (error as { code?: string }).code === "SQLITE_BUSY"; return blocked ? 1 : 0; } });
    db(store).exec("CREATE TRIGGER probe_lock BEFORE INSERT ON ownership_semantic_capsules BEGIN SELECT CASE WHEN settings_probe()!=1 THEN RAISE(ABORT,'settings not locked') END; END");
    store.savePreparedOwnershipAttempt(receipt); expect(blocked).toBe(true); expect(counts(store)).toEqual({ attempts: 1, capsules: 1 }); expect(settings.loadIgnoreSettings("repo").revision).toBe(0);
  });
  it("当前activation/settings已变化仍只读历史，短读事务后无await锁且保存前当前门不减弱", async () => {
    const path = await pathFixture("source.sqlite"), store = open(path), input = await fixture(store); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input)); const connection = connect(path);
    connection.prepare("UPDATE snapshot_overviews SET is_current=0,activated_at=? WHERE snapshot_id='snap'").run("2026-12-01T00:00:00.000Z"); store.saveIgnoreSettings("repo", 0, ["later"]);
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let transactionAtDigest = true;
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { transactionAtDigest = db(store).inTransaction; return digest(...args); });
    expect(await store.loadOwnershipCapsule("attempt")).toMatchObject({ status: "ready", questionBinding: "prepare-only", capsule: input.capsule }); expect(transactionAtDigest).toBe(false);
    await expect(store.prepareOwnershipAttemptWithCapsule(input)).rejects.toThrow("所有权胶囊存储失败");
    expect(counts(store)).toEqual({ attempts: 1, capsules: 1 });
  });
  it.each(["column", "attempt", "hash", "payload", "role", "proof", "source", "edge-column", "proof-payload"] as const)("持久 %s 损坏固定拒绝，不能降级为缺胶囊", async change => {
    const store = open(), input = await fixture(store); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    if (change === "column") db(store).prepare("UPDATE ownership_semantic_capsules SET snapshot_id='other'").run();
    if (change === "attempt") { const attempt = { ...input.attempt, locationScore: 0 }; db(store).prepare("UPDATE ownership_attempts SET payload=?").run(canonicalJson(attempt)); }
    if (change === "hash") db(store).prepare("UPDATE ownership_semantic_capsules SET capsule_hash=?").run("f".repeat(64));
    if (change === "payload") db(store).prepare("UPDATE ownership_semantic_capsules SET payload='private invalid JSON'").run();
    if (change === "role" || change === "proof") { const cap = structuredClone(input.capsule) as OwnershipReadyCapsule; if (change === "role") cap.roleBindings[0]!.edgeId = "read"; else cap.necessaryProofs[0]!.span.endColumn--; cap.capsuleHash = await computeOwnershipCapsuleHash(cap); db(store).prepare("UPDATE ownership_semantic_capsules SET payload=?,capsule_hash=?").run(canonicalJson(cap), cap.capsuleHash); }
    if (change === "source") db(store).prepare("UPDATE source_snapshots SET content=content || 'modified'").run();
    if (change === "edge-column") db(store).prepare("UPDATE edges SET source_id='other' WHERE edge_id='write'").run();
    if (change === "proof-payload") { const proof = { ...store.loadSnapshot("snap")!.evidence[0]!, analyzerVersion: "fake" }; db(store).prepare("UPDATE evidence SET payload=? WHERE evidence_id='e-write'").run(canonicalJson(proof)); }
    await expect(store.loadOwnershipCapsule("attempt")).rejects.toThrow("所有权胶囊存储失败");
    await expect(store.loadOwnershipSemanticPackage("attempt")).rejects.toMatchObject({ code: "INVALID_MATERIAL", message: "所有权胶囊存储失败" });
  });
  it("新迁移不改旧attempt/源码字节或7/10时间；FK精确删除同attempt胶囊", async () => {
    const path = await pathFixture("old.sqlite"), initial = open(path), input = await fixture(initial, "old"); initial.saveOwnershipAttempt(input.attempt); initial.close(); const connection = connect(path);
    const oldPayload = (connection.prepare("SELECT payload FROM ownership_attempts").get() as { payload: string }).payload, oldSource = (connection.prepare("SELECT content FROM source_snapshots").get() as { content: string }).content;
    connection.exec("DROP TABLE ownership_semantic_capsules; DELETE FROM schema_migrations WHERE version=11"); connection.prepare("UPDATE schema_migrations SET applied_at='frozen' WHERE version IN(7,10)").run(); connection.close();
    const store = open(path); expect((db(store).prepare("SELECT payload FROM ownership_attempts WHERE attempt_id='old'").get() as { payload: string }).payload).toBe(oldPayload);
    expect((db(store).prepare("SELECT content FROM source_snapshots").get() as { content: string }).content).toBe(oldSource); expect(db(store).prepare("SELECT applied_at FROM schema_migrations WHERE version IN(7,10)").all()).toEqual([{ applied_at: "frozen" }, { applied_at: "frozen" }]);
    expect(await store.loadOwnershipCapsule("old")).toEqual({ status: "legacy-capsule-absent" });
    expect(store.loadOwnershipQuestionBinding("old")).toEqual({ status: "legacy-unbound" });
    for (const attemptId of ["new1", "new2"]) { const fresh = await fixture(store, attemptId); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(fresh)); }
    db(store).prepare("DELETE FROM ownership_attempts WHERE attempt_id='new1'").run(); expect(counts(store)).toEqual({ attempts: 2, capsules: 1 }); expect(await store.loadOwnershipCapsule("new2")).toMatchObject({ status: "ready" }); expect(await store.loadOwnershipCapsule("new1")).toEqual({ status: "not-found" });
    expect((db(store).prepare("SELECT payload FROM ownership_attempts WHERE attempt_id='old'").get() as { payload: string }).payload).toBe(oldPayload);
  });
  it("ready重新计算摘要也不能通过伪来源/角色；getter不执行且封存receipt不从外部取字段", async () => {
    const store = open(), input = await fixture(store); let read = false;
    Object.defineProperty(input.attempt, "semanticText", { enumerable: true, get: () => { read = true; return "private"; } }); await expect(store.prepareOwnershipAttemptWithCapsule(input)).rejects.toThrow("所有权胶囊存储失败"); expect(read).toBe(false);
    const forged = await fixture(store); (forged.capsule as OwnershipReadyCapsule).roleBindings[0]!.edgeId = "read"; await resign(forged); await expect(store.prepareOwnershipAttemptWithCapsule(forged)).rejects.toThrow();
    const wrongEpoch = await fixture(store); wrongEpoch.capsule.sourceIdentity.activation = "2026-01-01T00:00:00.000Z"; await resign(wrongEpoch); await expect(store.prepareOwnershipAttemptWithCapsule(wrongEpoch)).rejects.toThrow(); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
  });
  it("not-evaluated nullable身份仍捕获真实配置/快照，未知分析版本不获得外发资格", async () => {
    const store = open(), input = await fixture(store, "partial", false), snapshot = store.loadSnapshot("snap")!;
    delete snapshot.analysisIdentity.analysisResult; db(store).prepare("UPDATE snapshots SET payload=? WHERE snapshot_id='snap'").run(JSON.stringify(snapshot));
    input.source = store.captureOwnershipSource("repo", "snap", 0); input.capsule.sourceIdentity.analysisResultFingerprint = null; input.capsule.sourceIdentity.configurationHash = null; input.capsule.sourceIdentity.sourceManifestHash = null; input.capsule.sourceIdentity.activation = null; input.capsule.sourceIdentity.ignoreRevision = null; await resign(input);
    const receipt = await store.prepareOwnershipAttemptWithCapsule(input);
    const changed = { ...snapshot, analysisIdentity: { ...snapshot.analysisIdentity, configurationHash: "b".repeat(64) } }; db(store).prepare("UPDATE snapshots SET payload=? WHERE snapshot_id='snap'").run(JSON.stringify(changed));
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow(); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
    db(store).prepare("UPDATE snapshots SET payload=? WHERE snapshot_id='snap'").run(JSON.stringify(snapshot));
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    expect(await store.loadOwnershipCapsule("partial")).toMatchObject({ status: "not-evaluated", questionBinding: "prepare-only", capsule: { sourceIdentity: input.capsule.sourceIdentity } });
  });
  it("两库配置在prepare后变化同样零写；关闭源store使receipt失效", async () => {
    const sourcePath = await pathFixture("source.sqlite"), settingsPath = await pathFixture("settings.sqlite"), store = open(sourcePath, "global"), settings = open(settingsPath), input = await fixture(store), receipt = await store.prepareOwnershipAttemptWithCapsule(input, settings);
    const writer = open(settingsPath); writer.saveIgnoreSettings("repo", 0, ["later"]);
    expect(() => store.savePreparedOwnershipAttempt(receipt)).toThrow("所有权胶囊存储失败"); expect(counts(store)).toEqual({ attempts: 0, capsules: 0 });
    const own = await store.prepareOwnershipAttemptWithCapsule(input); store.close(); expect(() => store.savePreparedOwnershipAttempt(own)).toThrow("所有权胶囊存储失败");
  });
  it("读取以短事务捕获的一致历史为准，await后变动不会拼接两版材料；下次读取拒绝损坏", async () => {
    const path = await pathFixture("source.sqlite"), store = open(path), input = await fixture(store); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input)); const writer = connect(path);
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { expect(db(store).inTransaction).toBe(false); entered(); await gate; return digest(...args); });
    const pending = store.loadOwnershipCapsule("attempt"); await started; writer.prepare("UPDATE source_snapshots SET content=content || 'later-corruption'").run(); release();
    expect(await pending).toMatchObject({ status: "ready", questionBinding: "prepare-only", attempt: input.attempt });
    await expect(store.loadOwnershipCapsule("attempt")).rejects.toThrow("所有权胶囊存储失败");
  });
  it("完整重写与重算摘要没有认证保证：仅原题指纹变化不宣称已读时原题验证", async () => {
    const store = open(), input = await fixture(store); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input)); const cap = structuredClone(input.capsule) as OwnershipReadyCapsule;
    cap.questionFingerprint = "f".repeat(64); cap.rubric.questionFingerprint = cap.questionFingerprint;
    const { rubricHash: _hash, ...content } = cap.rubric; cap.rubric.rubricHash = await computeOwnershipRubricHash(content); cap.capsuleHash = await computeOwnershipCapsuleHash(cap);
    db(store).prepare("UPDATE ownership_semantic_capsules SET payload=?,capsule_hash=?").run(canonicalJson(cap), cap.capsuleHash);
    const read = await store.loadOwnershipCapsule("attempt"); expect(read).toMatchObject({ status: "ready", questionBinding: "prepare-only", capsule: cap });
    expect(await store.loadOwnershipSemanticPackage("attempt")).toMatchObject({ status: "ready", questionBinding: "prepare-only", currentness: "not-checked", capsule: cap });
    // The supplied original question still rejects this rewriting at preparation; the read tag is not an authorization.
    await expect(store.prepareOwnershipAttemptWithCapsule({ ...input, capsule: cap })).rejects.toThrow("所有权胶囊存储失败");
    expect(db(store).prepare("SELECT name FROM sqlite_master WHERE name LIKE '%capsule%' AND type='table'").all()).toEqual([{ name: "ownership_semantic_capsules" }]);
  });
  it("错attempt关联及存在orphan胶囊不能返回缺胶囊，FK阻止正常孤立INSERT", async () => {
    const store = open(), first = await fixture(store, "first"), second = await fixture(store, "second"); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(first)); store.saveOwnershipAttempt(second.attempt);
    db(store).prepare("UPDATE ownership_semantic_capsules SET attempt_id='second'").run(); await expect(store.loadOwnershipCapsule("second")).rejects.toThrow();
    db(store).pragma("foreign_keys=OFF"); db(store).prepare("DELETE FROM ownership_attempts WHERE attempt_id='second'").run(); db(store).pragma("foreign_keys=ON"); await expect(store.loadOwnershipCapsule("second")).rejects.toThrow();
    expect(() => db(store).prepare("INSERT INTO ownership_semantic_capsules VALUES(?,?,?,?,?,?,?,?)").run("missing", "repo", "snap", "not-evaluated", "1.0.0", "a".repeat(64), "b".repeat(64), "{}")).toThrow();
  });
  it("语义端口不猜补缺attempt/旧无胶囊/预算或证据不足，并保持全部历史字节", async () => {
    const store = open(); const legacy = await fixture(store, "legacy"); store.saveOwnershipAttempt(legacy.attempt);
    for (const [attemptId, reason] of [["budget", "rubric-budget-exceeded"], ["evidence", "structured-answer-mismatch"]] as const) {
      const input = await fixture(store, attemptId, false); if (input.capsule.status !== "not-evaluated") throw new Error("not evaluated required");
      input.capsule.reason = reason; input.capsule.capsuleHash = await computeOwnershipCapsuleHash(input.capsule);
      store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    }
    const before = databaseState(store); db(store).pragma("query_only=ON");
    expect(await store.loadOwnershipSemanticPackage("missing")).toEqual({ status: "not-found" });
    expect(await store.loadOwnershipSemanticPackage("legacy")).toEqual({ status: "legacy-capsule-absent" });
    for (const id of ["budget", "evidence"]) { const result = await store.loadOwnershipSemanticPackage(id); expect(result).toMatchObject({ status: "not-evaluated", questionBinding: "prepare-only", currentness: "not-checked" }); expect(result).not.toHaveProperty("package"); }
    expect(databaseState(store)).toBe(before); db(store).pragma("query_only=OFF");
    await expect(store.loadOwnershipSemanticPackage({} as string)).rejects.toMatchObject({ code: "INVALID_MATERIAL" });
    store.close(); await expect(store.loadOwnershipSemanticPackage("legacy")).rejects.toMatchObject({ code: "RECEIPT_INVALID", message: "所有权胶囊存储失败" });
  });
  it.each(["source", "edge", "role-order", "analysis-projection", "path-order"] as const)("语义读取首摘要await后第二连接改%s，只返回原私有捕获，下次严格拒绝损坏", async change => {
    const path = await pathFixture("semantic-race.sqlite"), store = open(path), input = change === "path-order" ? await relationshipFixture(store, "call-path") : await fixture(store);
    store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    const baseline = await store.loadOwnershipSemanticPackage("attempt"), writer = connect(path);
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { expect(db(store).inTransaction).toBe(false); entered(); await gate; return digest(...args); });
    const pending = store.loadOwnershipSemanticPackage("attempt"); await started;
    try {
      if (change === "source") writer.prepare("UPDATE source_snapshots SET content=content || 'later-corruption'").run();
      else if (change === "edge") writer.prepare("UPDATE edges SET target_id='other'").run();
      else {
        const cap = structuredClone(input.capsule) as OwnershipReadyCapsule;
        if (change === "role-order") cap.roleBindings.reverse();
        if (change === "analysis-projection") cap.analysisIdentity.configurationHash = "b".repeat(64);
        if (change === "path-order") { cap.rubric.selectedPath!.edgeIds.reverse(); const { rubricHash: _hash, ...content } = cap.rubric; cap.rubric.rubricHash = await computeOwnershipRubricHash(content); }
        cap.capsuleHash = await computeOwnershipCapsuleHash(cap);
        writer.prepare("UPDATE ownership_semantic_capsules SET payload=?,capsule_hash=?").run(canonicalJson(cap), cap.capsuleHash);
      }
    } finally { release(); }
    expect(await pending).toEqual(baseline); expect(baseline).toMatchObject({ currentness: "not-checked" });
    await expect(store.loadOwnershipSemanticPackage("attempt")).rejects.toMatchObject({ code: "INVALID_MATERIAL", message: "所有权胶囊存储失败" });
  });
  it("返回对象及getter不能污染持久材料/再读，当前配置和activation改变不授予当前性", async () => {
    const store = open(), input = await fixture(store, "attempt", true, ["never"]); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    const first = await store.loadOwnershipSemanticPackage("attempt"); if (first.status !== "ready") throw new Error("ready required");
    const baseline = canonicalJson(first), before = databaseState(store); let getterRead = false;
    first.package.proofs[0]!.snippet = "caller alteration"; first.capsule.roleBindings.reverse();
    Object.defineProperty(first.package.analysisIdentity, "configurationHash", { enumerable: true, get() { getterRead = true; throw new Error("must not run"); } });
    expect(canonicalJson(await store.loadOwnershipSemanticPackage("attempt"))).toBe(baseline); expect(getterRead).toBe(false); expect(databaseState(store)).toBe(before);
    db(store).prepare("UPDATE snapshot_overviews SET is_current=0,activated_at=?").run("2026-12-01T00:00:00.000Z"); store.saveIgnoreSettings("repo", store.loadIgnoreSettings("repo").revision, ["changed"]);
    expect(canonicalJson(await store.loadOwnershipSemanticPackage("attempt"))).toBe(baseline);
    const old = await store.loadOwnershipCapsule("attempt"); expect(Object.keys(old).sort()).toEqual(["attempt", "capsule", "questionBinding", "status"]);
  });
  it("首await后关闭store时语义端口固定失败，私有捕获不变成关闭后的可用结果", async () => {
    const store = open(), input = await fixture(store); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule(input));
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle); let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { entered(); await gate; return digest(...args); });
    const pending = store.loadOwnershipSemanticPackage("attempt"); await started; store.close(); release();
    await expect(pending).rejects.toMatchObject({ code: "RECEIPT_INVALID", message: "所有权胶囊存储失败" });
  });
});
