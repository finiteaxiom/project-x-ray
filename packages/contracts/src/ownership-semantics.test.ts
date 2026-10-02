import { describe, expect, it } from "vitest";
import { computeOwnershipLimitationId, computeOwnershipPackageId, computeOwnershipRubricHash, hashOwnershipAnswer, ownershipSemanticPackageSchema, ownershipSemanticResponseSchema, validateOwnershipSemanticPackage, validateOwnershipSemanticResponse, type OwnershipSemanticPackage, type OwnershipSemanticResponse } from "./ownership-semantics.js";

const hash = "a".repeat(64), answer = "A🙂B explains static code";
async function resign(value: OwnershipSemanticPackage): Promise<OwnershipSemanticPackage> {
  for (const limit of value.rubric.limitations) { const { limitationId: _id, ...content } = limit; const previous = limit.limitationId; limit.limitationId = await computeOwnershipLimitationId(content); for (const criterion of value.rubric.criteria) criterion.allowedLimitationIds = criterion.allowedLimitationIds.map(id => id === previous ? limit.limitationId : id); }
  value.answerHash = await hashOwnershipAnswer(value.answer);
  const { rubricHash: _rubricHash, ...rubric } = value.rubric; value.rubric.rubricHash = await computeOwnershipRubricHash(rubric);
  const { assessmentPackageId: _packageId, ...content } = value; value.assessmentPackageId = await computeOwnershipPackageId(content); return value;
}
async function fixture() {
  const proofs = ["p-a", "p-b"].map((id, index) => ({ id, kind: "symbol-definition" as const, span: { filePath: "a.ts", startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: 10 }, sliceSpan: { filePath: "a.ts", startLine: index + 1, startColumn: 0, endLine: index + 1, endColumn: 10 }, analyzer: "fixture", analyzerVersion: "1", confidence: "verified" as const, contentHash: hash, snippet: "staticCode" }));
  const limits = ["c-a", "c-b"].map(criterionId => ({ limitationId: hash, code: "answer-information-insufficient" as const, criterionIds: [criterionId], relatedEvidenceIds: [] as string[], description: "Answer does not explain this criterion" }));
  for (const limit of limits) { const { limitationId: _id, ...content } = limit; limit.limitationId = await computeOwnershipLimitationId(content); }
  const pack: OwnershipSemanticPackage = { version: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", repositoryId: "repo", snapshotId: "snap", attemptId: "attempt", attemptHash: hash, deterministicScoringVersion: "2.1.0", semanticScoringVersion: "1.0.0", analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { fixture: "1" }, configurationHash: hash, sourceFingerprint: hash, ignorePolicy: null, analysisResult: { version: "1.0.0", fingerprint: hash } }, answer, answerHash: hash, structuredAnswer: { kind: "entry", nodeId: "n-a" }, validatedCitations: [{ ...proofs[0]!.span, evidenceId: "p-a" }], rubric: { version: "1.0.0", questionId: "q", questionVersion: "2.0.0", questionFingerprint: hash, questionKind: "entry", learningObjective: "Explain the provided static code", rubricHash: hash, selectedPath: null, criteria: ["a", "b"].map((id, index) => ({ criterionId: `c-${id}`, proposition: `Explain ${id}`, weight: 50, requiredEvidenceIds: [`p-${id}`], allowedEvidenceIds: [`p-${id}`], allowedLimitationIds: [limits[index]!.limitationId], answerScope: [{ start: 0, end: answer.length }] })), limitations: limits }, nodes: ["a", "b"].map(id => ({ id: `n-${id}`, kind: "function" as const, name: id, filePath: "a.ts", evidenceIds: [`p-${id}`] })), edges: [], proofs, assessmentPackageId: hash };
  await resign(pack);
  const response: OwnershipSemanticResponse = { version: "1.0.0", assessmentPackageId: pack.assessmentPackageId, criteria: [{ criterionId: "c-a", verdict: "supported", explanation: "Provided evidence supports this explanation", evidenceIds: ["p-a"], limitationIds: [], answerRanges: [{ start: 0, end: 4 }] }, { criterionId: "c-b", verdict: "insufficient", explanation: "The explanation is not specific enough", evidenceIds: [], limitationIds: [pack.rubric.limitations[1]!.limitationId], answerRanges: [] }] };
  return { pack, response };
}
async function pathFixture() {
  const { pack } = await fixture(); pack.rubric.questionKind = "call-path";
  pack.structuredAnswer = { kind: "call-path", nodeIds: ["n-a", "n-b", "n-c"] };
  pack.rubric.selectedPath = { nodeIds: ["n-a", "n-b", "n-c"], edgeIds: ["ab", "bc"] };
  pack.nodes.push({ ...pack.nodes[1]!, id: "n-c", name: "c" });
  for (const proof of pack.proofs) proof.kind = "call-expression";
  pack.edges = [{ id: "ab", source: "n-a", target: "n-b", kind: "CALLS", evidenceId: "p-a", confidence: "verified", reason: "Provided static call" }, { id: "bc", source: "n-b", target: "n-c", kind: "CALLS", evidenceId: "p-b", confidence: "verified", reason: "Provided static call" }];
  pack.validatedCitations = pack.proofs.map(proof => ({ ...proof.span, evidenceId: proof.id })); return resign(pack);
}
describe("ownership semantic provided-package contracts", () => {
  it("validates advisory-only DTO and preserves both caller input and existing scoring boundaries", async () => {
    const { pack, response } = await fixture(); const before = JSON.stringify(pack);
    expect(await validateOwnershipSemanticPackage(pack, answer)).toEqual(pack);
    expect(await validateOwnershipSemanticResponse(JSON.stringify(response), pack, answer)).toEqual(response);
    expect(JSON.stringify(pack)).toBe(before); expect(Object.keys(response)).toEqual(["version", "assessmentPackageId", "criteria"]);
  });
  it("normalizes unordered criterion/dictionary/graph collections while binding text and ordered ranges", async () => {
    const { pack } = await fixture(); const reordered = structuredClone(pack); reordered.rubric.criteria.reverse(); reordered.rubric.limitations.reverse(); reordered.nodes.reverse(); reordered.proofs.reverse();
    const { assessmentPackageId: _id, ...data } = reordered; expect(await computeOwnershipPackageId(data)).toBe(pack.assessmentPackageId);
    expect(await validateOwnershipSemanticPackage(reordered, answer)).toEqual(reordered);
    const { rubricHash: _hash, ...rubric } = reordered.rubric; rubric.criteria[0]!.proposition += " changed"; expect(await computeOwnershipRubricHash(rubric)).not.toBe(pack.rubric.rubricHash);
  });
  it.each(["wrong-text", "wrong-hash", "surrogate", "scope-outside", "scope-split", "hash-tamper", "rubric-tamper"])("rejects package binding %s", async kind => {
    const { pack } = await fixture(); let submitted = answer;
    if (kind === "wrong-text") submitted = "Different submitted text";
    if (kind === "wrong-hash") pack.answerHash = "b".repeat(64);
    if (kind === "surrogate") pack.answer = "bad\ud800";
    if (kind === "scope-outside") pack.rubric.criteria[0]!.answerScope[0]!.end = 100;
    if (kind === "scope-split") pack.rubric.criteria[0]!.answerScope[0]!.end = 2;
    if (kind === "hash-tamper") pack.assessmentPackageId = "b".repeat(64);
    if (kind === "rubric-tamper") pack.rubric.rubricHash = "b".repeat(64);
    await expect(validateOwnershipSemanticPackage(pack, submitted)).rejects.toThrow();
  });
  it.each(["criterion-duplicate", "limitation-duplicate", "proof-duplicate", "required-missing", "required-not-allowed", "wrong-owner", "unknown-limit", "unused-proof", "weight", "citation-span", "slice", "dynamic-without-unknown"])("rejects provided closure %s even when the package hashes are recomputed", async kind => {
    const { pack } = await fixture();
    if (kind === "criterion-duplicate") pack.rubric.criteria[1]!.criterionId = "c-a";
    if (kind === "limitation-duplicate") pack.rubric.limitations.push(structuredClone(pack.rubric.limitations[0]!));
    if (kind === "proof-duplicate") pack.proofs.push(structuredClone(pack.proofs[0]!));
    if (kind === "required-missing") pack.proofs.pop();
    if (kind === "required-not-allowed") pack.rubric.criteria[0]!.requiredEvidenceIds = ["p-b"];
    if (kind === "wrong-owner") pack.rubric.criteria[0]!.allowedLimitationIds = [pack.rubric.limitations[1]!.limitationId];
    if (kind === "unknown-limit") pack.rubric.criteria[0]!.allowedLimitationIds = ["b".repeat(64)];
    if (kind === "unused-proof") pack.proofs.push({ ...pack.proofs[0]!, id: "unused" });
    if (kind === "weight") pack.rubric.criteria[0]!.weight = 49;
    if (kind === "citation-span") pack.validatedCitations[0]!.endColumn = 9;
    if (kind === "slice") pack.proofs[0]!.sliceSpan.endColumn = 9;
    if (kind === "dynamic-without-unknown") pack.rubric.limitations[0]!.code = "unresolved-dynamic-behavior";
    await resign(pack); await expect(validateOwnershipSemanticPackage(pack, answer)).rejects.toThrow();
  });
  it.each(["unknown-criterion", "duplicate-criterion", "missing-criterion", "wrong-package", "cross-proof", "cross-limit", "duplicate-proof", "duplicate-limit", "unknown-limit", "supported-limit", "empty-support", "empty-insufficient", "split-pair", "outside-text", "duplicate-range", "extra", "score", "verified", "unknown-key", "null-limits", "prose-limit"])("rejects response %s", async kind => {
    const { pack, response } = await fixture();
    if (kind === "unknown-criterion") response.criteria[0]!.criterionId = "other";
    if (kind === "duplicate-criterion") response.criteria[1]!.criterionId = "c-a";
    if (kind === "missing-criterion") response.criteria.pop();
    if (kind === "wrong-package") response.assessmentPackageId = "b".repeat(64);
    if (kind === "cross-proof") response.criteria[0]!.evidenceIds = ["p-b"];
    if (kind === "cross-limit") response.criteria[1]!.limitationIds = [pack.rubric.limitations[0]!.limitationId];
    if (kind === "duplicate-proof") response.criteria[0]!.evidenceIds.push("p-a");
    if (kind === "duplicate-limit") response.criteria[1]!.limitationIds.push(response.criteria[1]!.limitationIds[0]!);
    if (kind === "unknown-limit") response.criteria[1]!.limitationIds = ["b".repeat(64)];
    if (kind === "supported-limit") response.criteria[0]!.limitationIds = [pack.rubric.limitations[0]!.limitationId];
    if (kind === "empty-support") response.criteria[0]!.evidenceIds = [];
    if (kind === "empty-insufficient") response.criteria[1]!.limitationIds = [];
    if (kind === "split-pair") response.criteria[0]!.answerRanges[0]!.end = 2;
    if (kind === "outside-text") response.criteria[0]!.answerRanges[0]!.end = 100;
    if (kind === "duplicate-range") response.criteria[0]!.answerRanges.push({ ...response.criteria[0]!.answerRanges[0]! });
    if (["extra", "score", "verified"].includes(kind)) Object.assign(response.criteria[0]!, { [kind]: true });
    if (kind === "unknown-key") Object.assign(response, { apiKey: "forbidden" });
    if (kind === "null-limits") Object.assign(response.criteria[1]!, { limitationIds: null });
    if (kind === "prose-limit") { response.criteria[1]!.limitationIds = []; response.criteria[1]!.explanation = pack.rubric.limitations[1]!.limitationId; }
    await expect(validateOwnershipSemanticResponse(response, pack, answer)).rejects.toThrow();
  });
  it("checks nonempty insufficient citations/ranges and accepts contradicted without changing any deterministic score", async () => {
    const { pack, response } = await fixture(); Object.assign(response.criteria[0]!, { verdict: "contradicted" });
    response.criteria[1]!.evidenceIds = ["p-b"]; response.criteria[1]!.answerRanges = [{ start: 4, end: 5 }];
    expect(await validateOwnershipSemanticResponse(response, pack, answer)).toEqual(response);
    response.criteria[1]!.evidenceIds = ["p-a"]; await expect(validateOwnershipSemanticResponse(response, pack, answer)).rejects.toThrow();
  });
  it.each(["answer", "snippet", "lines", "source", "request", "response-string"])("enforces hard %s budget with no clipping", async kind => {
    const { pack, response } = await fixture();
    if (kind === "answer") { pack.answer = "中".repeat(5462); expect(ownershipSemanticPackageSchema.safeParse(pack).success).toBe(false); return; }
    if (kind === "snippet") pack.proofs[0]!.snippet = "x".repeat(4097);
    if (kind === "lines") pack.proofs[0]!.snippet = "x\n".repeat(40);
    if (kind === "source") { for (let i = 0; i < 7; i++) pack.proofs.push({ ...pack.proofs[0]!, id: `large-${i}`, snippet: "x".repeat(4096) }); }
    if (kind === "request") {
      pack.answer = "x".repeat(16384); for (let i = 0; i < 16; i++) pack.nodes.push({ ...pack.nodes[0]!, id: `n-${i}`, name: "中".repeat(256) }); for (const criterion of pack.rubric.criteria) criterion.proposition = "中".repeat(1200);
      for (const proof of pack.proofs) proof.snippet = "x".repeat(4096);
      for (let i = 0; i < 4; i++) { pack.proofs.push({ ...pack.proofs[0]!, id: `extra-p-${i}` }); pack.nodes.push({ ...pack.nodes[0]!, id: `extra-n-${i}`, evidenceIds: [`extra-p-${i}`] }); }
      expect(new TextEncoder().encode(JSON.stringify(pack)).length).toBeGreaterThan(65536);
      expect(pack.proofs.reduce((bytes, proof) => bytes + new TextEncoder().encode(proof.snippet).length, 0)).toBeLessThanOrEqual(24576);
    }
    if (kind === "response-string") { await expect(validateOwnershipSemanticResponse(" ".repeat(262145), pack, answer)).rejects.toThrow(); return; }
    if (kind !== "snippet") await resign(pack);
    let rejected = false; try { await validateOwnershipSemanticPackage(pack, pack.answer); } catch { rejected = true; } expect(rejected).toBe(true); expect(kind === "snippet" ? pack.proofs[0]!.snippet.length : true).toBe(kind === "snippet" ? 4097 : true);
  });
  it("strict schemas reject purpose reuse and response field injection", async () => {
    const { pack, response } = await fixture(); expect(ownershipSemanticPackageSchema.safeParse({ ...pack, purpose: "feature-explanation" }).success).toBe(false);
    expect(ownershipSemanticResponseSchema.safeParse({ ...response, passed: true }).success).toBe(false);
  });
  it("accepts a complete provided path and an alternative same-node path using its own full citation sequence", async () => {
    const pack = await pathFixture(); expect(await validateOwnershipSemanticPackage(pack, answer)).toEqual(pack);
    const originalHash = pack.assessmentPackageId;
    pack.proofs.push({ ...pack.proofs[0]!, id: "p-alternative", span: { ...pack.proofs[0]!.span, startLine: 3, endLine: 3 }, sliceSpan: { ...pack.proofs[0]!.sliceSpan, startLine: 3, endLine: 3 } });
    pack.edges.push({ ...pack.edges[0]!, id: "ab-alternative", evidenceId: "p-alternative" }); pack.rubric.selectedPath!.edgeIds[0] = "ab-alternative";
    pack.rubric.criteria[0]!.requiredEvidenceIds = ["p-alternative"]; pack.rubric.criteria[0]!.allowedEvidenceIds = ["p-alternative"];
    pack.validatedCitations[0] = { ...pack.proofs.at(-1)!.span, evidenceId: "p-alternative" }; await resign(pack);
    expect(pack.assessmentPackageId).not.toBe(originalHash); expect(await validateOwnershipSemanticPackage(pack, answer)).toEqual(pack);
  });
  it.each(["missing-edge", "missing-proof", "unknown", "wrong-kind", "mixed", "incomplete-citations", "short-path", "answer-path", "no-path", "missing-rubric-evidence"])("fails closed for incomplete or unsupported provided path %s", async kind => {
    const pack = await pathFixture();
    if (kind === "missing-edge") pack.edges.pop();
    if (kind === "missing-proof") pack.proofs.pop();
    if (kind === "unknown") { pack.edges[0]!.confidence = "unknown"; pack.proofs[0]!.confidence = "unknown"; }
    if (kind === "wrong-kind") pack.proofs[0]!.kind = "symbol-definition";
    if (kind === "mixed") pack.rubric.selectedPath!.edgeIds.reverse();
    if (kind === "incomplete-citations") pack.validatedCitations.shift();
    if (kind === "short-path") pack.rubric.selectedPath!.edgeIds.pop();
    if (kind === "answer-path" && pack.structuredAnswer.kind === "call-path") pack.structuredAnswer.nodeIds.reverse();
    if (kind === "no-path") pack.rubric.selectedPath = null;
    if (kind === "missing-rubric-evidence") { pack.rubric.criteria[0]!.requiredEvidenceIds = ["p-b"]; pack.rubric.criteria[0]!.allowedEvidenceIds.push("p-b"); }
    await resign(pack); await expect(validateOwnershipSemanticPackage(pack, answer)).rejects.toThrow();
  });
});
