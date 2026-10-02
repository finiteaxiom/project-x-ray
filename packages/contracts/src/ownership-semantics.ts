import { z } from "zod";
import { canonicalJson } from "./snapshot-content.js";
import { remoteAnalysisIdentitySchema, remoteEdgeSchema, remoteHashSchema, remoteIdSchema, remoteNodeSchema, remoteProofSchema, remoteSpanSchema, remoteUtf8Bytes } from "./remote-explanation.js";

export const OWNERSHIP_SEMANTIC_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_PURPOSE = "ownership-semantic-assessment";
export const OWNERSHIP_SEMANTIC_LIMITS = Object.freeze({ requestBytes: 65536, responseBytes: 262144, answerBytes: 16384, sourceBytes: 24576, snippetBytes: 4096, snippetLines: 40, criteria: 8, limitations: 24, proofs: 24, nodes: 24, edges: 40, references: 8 });
const version = z.literal(OWNERSHIP_SEMANTIC_VERSION);
const text = z.string().min(1).max(1200).refine(value => remoteUtf8Bytes(value) <= 4800, "Text budget exceeded");
const ids = (min = 0, max = 8) => z.array(remoteIdSchema).min(min).max(max);
const hashes = (min = 0, max = 8) => z.array(remoteHashSchema).min(min).max(max);
export const ownershipAnswerRangeSchema = z.object({ start: z.number().int().min(0).max(16384), end: z.number().int().min(1).max(16384) }).strict().refine(value => value.start < value.end, "Empty answer range");
const ranges = (min = 0) => z.array(ownershipAnswerRangeSchema).min(min).max(8);
const limitationContent = z.object({ code: z.enum(["static-only", "unresolved-dynamic-behavior", "evidence-scope-insufficient", "answer-information-insufficient"]), criterionIds: ids(1), relatedEvidenceIds: ids(), description: text }).strict();
export const ownershipLimitationSchema = limitationContent.extend({ limitationId: remoteHashSchema }).strict();
export const ownershipSemanticCriterionSchema = z.object({ criterionId: remoteIdSchema, proposition: text, weight: z.number().int().min(1).max(100), requiredEvidenceIds: ids(1), allowedEvidenceIds: ids(1), allowedLimitationIds: hashes(), answerScope: ranges() }).strict();
const path = z.object({ nodeIds: ids(2, 20), edgeIds: ids(1, 19) }).strict();
const rubricContent = z.object({ version, questionId: remoteIdSchema, questionVersion: z.string().min(1).max(64), questionFingerprint: remoteHashSchema, questionKind: z.enum(["entry", "call-direction", "call-path", "variable-flow"]), learningObjective: text, criteria: z.array(ownershipSemanticCriterionSchema).min(1).max(8), limitations: z.array(ownershipLimitationSchema).max(24), selectedPath: path.nullable() }).strict();
export const ownershipSemanticRubricSchema = rubricContent.extend({ rubricHash: remoteHashSchema }).strict();
const structuredAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entry"), nodeId: remoteIdSchema }).strict(),
  z.object({ kind: z.literal("call-direction"), callerNodeId: remoteIdSchema, calleeNodeId: remoteIdSchema }).strict(),
  z.object({ kind: z.literal("call-path"), nodeIds: ids(2, 20) }).strict(),
  z.object({ kind: z.literal("variable-flow"), roles: z.array(z.object({ citationIndex: z.number().int().min(0).max(23), role: z.enum(["write", "read", "return"]) }).strict()).min(2).max(20) }).strict(),
]);
const citation = remoteSpanSchema.safeExtend({ evidenceId: remoteIdSchema }).strict().refine(value => value.endLine > value.startLine || value.endColumn > value.startColumn, "Empty source citation");
const packageContent = z.object({ version, purpose: z.literal(OWNERSHIP_SEMANTIC_PURPOSE), disclosureVersion: z.literal("ownership-semantics/1.0.0"), repositoryId: remoteIdSchema, snapshotId: remoteIdSchema, attemptId: remoteIdSchema, attemptHash: remoteHashSchema, deterministicScoringVersion: z.string().min(1).max(64), semanticScoringVersion: version, analysisIdentity: remoteAnalysisIdentitySchema, answer: z.string().max(16384).refine(value => remoteUtf8Bytes(value) <= 16384, "Answer budget exceeded"), answerHash: remoteHashSchema, structuredAnswer, validatedCitations: z.array(citation).min(1).max(24), rubric: ownershipSemanticRubricSchema, nodes: z.array(remoteNodeSchema).min(1).max(24), edges: z.array(remoteEdgeSchema).max(40), proofs: z.array(remoteProofSchema).min(1).max(24) }).strict();
export const ownershipSemanticPackageSchema = packageContent.extend({ assessmentPackageId: remoteHashSchema }).strict();
const outputBase = { criterionId: remoteIdSchema, explanation: text };
const criterionOutput = z.discriminatedUnion("verdict", [
  z.object({ ...outputBase, verdict: z.literal("supported"), evidenceIds: ids(1), limitationIds: hashes(0, 0), answerRanges: ranges(1) }).strict(),
  z.object({ ...outputBase, verdict: z.literal("contradicted"), evidenceIds: ids(1), limitationIds: hashes(0, 0), answerRanges: ranges(1) }).strict(),
  z.object({ ...outputBase, verdict: z.literal("insufficient"), evidenceIds: ids(), limitationIds: hashes(1), answerRanges: ranges() }).strict(),
]);
export const ownershipSemanticResponseSchema = z.object({ version, assessmentPackageId: remoteHashSchema, criteria: z.array(criterionOutput).min(1).max(8) }).strict();
export type OwnershipSemanticPackage = z.infer<typeof ownershipSemanticPackageSchema>;
export type OwnershipSemanticRubric = z.infer<typeof ownershipSemanticRubricSchema>;
export type OwnershipSemanticResponse = z.infer<typeof ownershipSemanticResponseSchema>;
export class OwnershipSemanticValidationError extends Error {
  constructor(readonly code: "INVALID_PACKAGE" | "INVALID_RESPONSE" | "ANSWER_MISMATCH" | "LIMIT_EXCEEDED") { super("Ownership semantic validation failed"); this.name = "OwnershipSemanticValidationError"; }
}
function reject(code: OwnershipSemanticValidationError["code"] = "INVALID_PACKAGE"): never { throw new OwnershipSemanticValidationError(code); }
function unique(values: readonly string[]): boolean { return new Set(values).size === values.length; }
function sorted(values: readonly string[]): string[] { return [...values].sort(); }
function ordered<T extends { id: string }>(values: readonly T[]): T[] { return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; } else if (unit >= 0xdc00 && unit <= 0xdfff) return false; }
  return true;
}
function validStrings(value: unknown): boolean { return typeof value === "string" ? wellFormed(value) : Array.isArray(value) ? value.every(validStrings) : value !== null && typeof value === "object" ? Object.entries(value).every(([key, item]) => wellFormed(key) && validStrings(item)) : true; }
function boundary(answer: string, offset: number): boolean { const previous = answer.charCodeAt(offset - 1), next = answer.charCodeAt(offset); return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff); }
function checkRanges(values: readonly z.infer<typeof ownershipAnswerRangeSchema>[], answer: string): void {
  if (!unique(values.map(value => `${value.start}:${value.end}`)) || values.some(value => value.end > answer.length || !boundary(answer, value.start) || !boundary(answer, value.end))) reject();
}
async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function hashOwnershipAnswer(answer: string): Promise<string> {
  if (typeof answer !== "string" || !wellFormed(answer) || remoteUtf8Bytes(answer) > 16384) reject("ANSWER_MISMATCH");
  return digest({ domain: "ownership-answer/1.0.0", answer });
}
function normalizedLimitation(value: z.infer<typeof limitationContent>) { return { ...value, criterionIds: sorted(value.criterionIds), relatedEvidenceIds: sorted(value.relatedEvidenceIds) }; }
export async function computeOwnershipLimitationId(input: z.input<typeof limitationContent>): Promise<string> { const value = limitationContent.parse(input); if (!validStrings(value) || !unique(value.criterionIds) || !unique(value.relatedEvidenceIds)) reject(); return digest({ domain: "ownership-limitation/1.0.0", ...normalizedLimitation(value) }); }
function normalizeRubric(value: z.infer<typeof rubricContent>) {
  return { ...value, criteria: [...value.criteria].sort((a, b) => a.criterionId < b.criterionId ? -1 : a.criterionId > b.criterionId ? 1 : 0).map(item => ({ ...item, requiredEvidenceIds: sorted(item.requiredEvidenceIds), allowedEvidenceIds: sorted(item.allowedEvidenceIds), allowedLimitationIds: sorted(item.allowedLimitationIds) })), limitations: [...value.limitations].sort((a, b) => a.limitationId < b.limitationId ? -1 : a.limitationId > b.limitationId ? 1 : 0).map(item => ({ ...item, ...normalizedLimitation(item) })) };
}
export async function computeOwnershipRubricHash(input: z.input<typeof rubricContent>): Promise<string> { const value = rubricContent.parse(input); if (!validStrings(value)) reject(); return digest({ domain: "ownership-rubric/1.0.0", ...normalizeRubric(value) }); }
export async function computeOwnershipPackageId(input: z.input<typeof packageContent>): Promise<string> {
  const value = packageContent.parse(input); if (!validStrings(value)) reject();
  const { rubricHash, ...rubric } = value.rubric;
  return digest({ domain: "ownership-package/1.0.0", ...value, rubric: { ...normalizeRubric(rubric), rubricHash }, nodes: ordered(value.nodes).map(node => ({ ...node, evidenceIds: sorted(node.evidenceIds) })), edges: ordered(value.edges), proofs: ordered(value.proofs) });
}
function budget(value: unknown, maximum: number): void { if (remoteUtf8Bytes(JSON.stringify(value)) > maximum) reject("LIMIT_EXCEEDED"); }

/** Provided DTO closure only: never verifies SQL currentness, real source truth or semantic prose. */
export async function validateOwnershipSemanticPackage(raw: unknown, submittedAnswer: string): Promise<OwnershipSemanticPackage> {
  try {
    const value = ownershipSemanticPackageSchema.parse(raw); budget(value, 65536);
    if (!validStrings(value)) reject();
    if (value.answer !== submittedAnswer || value.answerHash !== await hashOwnershipAnswer(submittedAnswer)) reject("ANSWER_MISMATCH");
    const rubric = value.rubric; const proofs = new Map(value.proofs.map(item => [item.id, item])); const nodes = new Map(value.nodes.map(item => [item.id, item])); const edges = new Map(value.edges.map(item => [item.id, item])); const criteria = new Map(rubric.criteria.map(item => [item.criterionId, item])); const limitations = new Map(rubric.limitations.map(item => [item.limitationId, item]));
    if (proofs.size !== value.proofs.length || nodes.size !== value.nodes.length || edges.size !== value.edges.length || criteria.size !== rubric.criteria.length || limitations.size !== rubric.limitations.length || rubric.criteria.reduce((sum, item) => sum + item.weight, 0) !== 100 || rubric.questionKind !== value.structuredAnswer.kind) reject();
    if (value.proofs.reduce((sum, item) => sum + remoteUtf8Bytes(item.snippet), 0) > 24576) reject("LIMIT_EXCEEDED");
    const used = new Set<string>();
    for (const proof of value.proofs) if (canonicalJson(proof.span) !== canonicalJson(proof.sliceSpan) || proof.snippet.split(/\r\n|\r|\n/u).length > 40) reject();
    for (const node of value.nodes) { if (!unique(node.evidenceIds) || node.evidenceIds.some(id => !proofs.has(id))) reject(); node.evidenceIds.forEach(id => used.add(id)); }
    const rank = { verified: 0, inferred: 1, unknown: 2 };
    for (const edge of value.edges) { const proof = proofs.get(edge.evidenceId); if (!nodes.has(edge.source) || !nodes.has(edge.target) || !proof || rank[edge.confidence] < rank[proof.confidence]) reject(); used.add(edge.evidenceId); }
    for (const criterion of rubric.criteria) {
      if (!unique(criterion.requiredEvidenceIds) || !unique(criterion.allowedEvidenceIds) || !unique(criterion.allowedLimitationIds) || criterion.requiredEvidenceIds.some(id => !criterion.allowedEvidenceIds.includes(id)) || criterion.allowedEvidenceIds.some(id => !proofs.has(id))) reject();
      checkRanges(criterion.answerScope, submittedAnswer); criterion.allowedEvidenceIds.forEach(id => used.add(id));
      for (const id of criterion.allowedLimitationIds) if (!limitations.get(id)?.criterionIds.includes(criterion.criterionId)) reject();
    }
    // The explicit loop below keeps limitation identity and both sides of membership authoritative.
    for (const limitation of rubric.limitations) {
      const { limitationId, ...content } = limitation;
      if (limitationId !== await computeOwnershipLimitationId(content) || limitation.criterionIds.some(id => !criteria.get(id)?.allowedLimitationIds.includes(limitationId)) || limitation.relatedEvidenceIds.some(id => !proofs.has(id))) reject();
      if (limitation.code === "unresolved-dynamic-behavior" && !limitation.relatedEvidenceIds.some(id => proofs.get(id)?.confidence === "unknown")) reject();
    }
    const cited = new Set<string>();
    const citationKeys = value.validatedCitations.map(item => canonicalJson(item)); if (!unique(citationKeys)) reject();
    for (const item of value.validatedCitations) { const proof = proofs.get(item.evidenceId); const { evidenceId: _id, ...span } = item; if (!proof || canonicalJson(proof.span) !== canonicalJson(span)) reject(); cited.add(item.evidenceId); }
    if (value.structuredAnswer.kind === "entry" && !nodes.has(value.structuredAnswer.nodeId)) reject();
    if (value.structuredAnswer.kind === "call-direction" && (!nodes.has(value.structuredAnswer.callerNodeId) || !nodes.has(value.structuredAnswer.calleeNodeId))) reject();
    if (value.structuredAnswer.kind === "variable-flow" && value.structuredAnswer.roles.some(role => role.citationIndex >= value.validatedCitations.length)) reject();
    if (rubric.questionKind === "call-path") {
      const selected = rubric.selectedPath;
      if (!selected || value.structuredAnswer.kind !== "call-path" || canonicalJson(selected.nodeIds) !== canonicalJson(value.structuredAnswer.nodeIds) || !unique(selected.nodeIds) || !unique(selected.edgeIds) || selected.edgeIds.length !== selected.nodeIds.length - 1) reject();
      for (const [index, id] of selected.edgeIds.entries()) { const edge = edges.get(id); const proof = edge ? proofs.get(edge.evidenceId) : undefined; if (!edge || edge.kind !== "CALLS" || edge.confidence !== "verified" || edge.source !== selected.nodeIds[index] || edge.target !== selected.nodeIds[index + 1] || proof?.confidence !== "verified" || proof.kind !== "call-expression" || !cited.has(edge.evidenceId) || !rubric.criteria.some(item => item.requiredEvidenceIds.includes(edge.evidenceId))) reject(); }
    } else if (rubric.selectedPath !== null) reject();
    if (used.size !== proofs.size) reject();
    const { rubricHash, ...rubricData } = rubric; if (rubricHash !== await computeOwnershipRubricHash(rubricData)) reject();
    const { assessmentPackageId, ...content } = value; if (assessmentPackageId !== await computeOwnershipPackageId(content)) reject();
    return value;
  } catch (error) { if (error instanceof OwnershipSemanticValidationError) throw error; return reject(); }
}

/** No scoring or confidence promotion; returns validated advisory DTO only. */
export async function validateOwnershipSemanticResponse(raw: unknown, pack: unknown, submittedAnswer: string): Promise<OwnershipSemanticResponse> {
  const value = await validateOwnershipSemanticPackage(pack, submittedAnswer);
  try {
    if (typeof raw === "string") { if (remoteUtf8Bytes(raw) > 262144) reject("LIMIT_EXCEEDED"); raw = JSON.parse(raw); }
    const response = ownershipSemanticResponseSchema.parse(raw); budget(response, 262144);
    if (!validStrings(response) || response.assessmentPackageId !== value.assessmentPackageId || !unique(response.criteria.map(item => item.criterionId)) || response.criteria.length !== value.rubric.criteria.length) reject("INVALID_RESPONSE");
    for (const output of response.criteria) {
      const criterion = value.rubric.criteria.find(item => item.criterionId === output.criterionId);
      if (!criterion || !unique(output.evidenceIds) || !unique(output.limitationIds) || output.evidenceIds.some(id => !criterion.allowedEvidenceIds.includes(id)) || output.limitationIds.some(id => !criterion.allowedLimitationIds.includes(id))) reject("INVALID_RESPONSE");
      checkRanges(output.answerRanges, submittedAnswer);
      if (output.answerRanges.some(range => !criterion.answerScope.some(scope => range.start >= scope.start && range.end <= scope.end))) reject("INVALID_RESPONSE");
    }
    return response;
  } catch (error) { if (error instanceof OwnershipSemanticValidationError && error.code === "LIMIT_EXCEEDED") throw error; return reject("INVALID_RESPONSE"); }
}
