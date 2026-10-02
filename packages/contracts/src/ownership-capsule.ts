import { z } from "zod";
import { canonicalJson } from "./snapshot-content.js";
import { remoteAnalysisIdentitySchema, remoteHashSchema, remoteIdSchema, remoteProofSchema, remoteTimeSchema, remoteUtf8Bytes } from "./remote-explanation.js";
import { computeOwnershipLimitationId, computeOwnershipRubricHash, hashOwnershipAnswer, ownershipSemanticRubricSchema } from "./ownership-semantics.js";
import type { OwnershipAttempt, OwnershipQuestion, OwnershipSubmission, SourceCitation } from "./index.js";

export const OWNERSHIP_CAPSULE_VERSION = "1.0.0";
export const OWNERSHIP_RUBRIC_BUILDER_VERSION = "1.0.0";
export const ownershipCapsuleReasonSchema = z.enum(["unsupported-question-shape", "structured-answer-mismatch", "incomplete-selected-path", "missing-required-proof", "unsupported-proof-kind", "citation-not-exact", "citation-outside-rubric", "invalid-role-binding", "analysis-identity-unavailable", "answer-encoding-unavailable", "answer-budget-exceeded", "rubric-budget-exceeded", "source-budget-exceeded", "package-budget-exceeded"]);
export const ownershipCapsuleSourceIdentitySchema = z.object({ activation: remoteTimeSchema.nullable(), analysisResultFingerprint: remoteHashSchema.nullable(), configurationHash: remoteHashSchema.nullable(), ignorePolicyHash: remoteHashSchema.nullable(), sourceManifestHash: remoteHashSchema.nullable(), ignoreRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).strict();
const readySource = ownershipCapsuleSourceIdentitySchema.extend({ activation: remoteTimeSchema, analysisResultFingerprint: remoteHashSchema, configurationHash: remoteHashSchema, sourceManifestHash: remoteHashSchema, ignoreRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict();
const text = z.string().min(1).max(1200).refine(value => remoteUtf8Bytes(value) <= 4800);
const ids = (max: number) => z.array(remoteIdSchema).max(max);
export const ownershipRoleBindingSchema = z.object({ originalCitationIndex: z.number().int().min(0).max(23), validatedCitationIndex: z.number().int().min(0).max(23), role: z.enum(["write", "read", "return"]), edgeId: remoteIdSchema, evidenceId: remoteIdSchema }).strict();
const necessaryProof = remoteProofSchema.omit({ id: true, snippet: true, sliceSpan: true }).extend({ evidenceId: remoteIdSchema, filePath: remoteProofSchema.shape.span.shape.filePath }).strict().refine(value => value.filePath === value.span.filePath);
const common = { version: z.literal(OWNERSHIP_CAPSULE_VERSION), builderVersion: z.literal(OWNERSHIP_RUBRIC_BUILDER_VERSION), questionFingerprint: remoteHashSchema, attemptHash: remoteHashSchema, capsuleHash: remoteHashSchema };
export const ownershipReadyCapsuleSchema = z.object({
  ...common, status: z.literal("ready"), repositoryId: remoteIdSchema, snapshotId: remoteIdSchema, attemptId: remoteIdSchema,
  questionId: remoteIdSchema, questionVersion: z.string().min(1).max(64), questionKind: z.enum(["entry", "call-direction", "call-path", "variable-flow"]), variantKey: text, prompt: text, learningObjective: text,
  answerHash: remoteHashSchema, submissionProjectionHash: remoteHashSchema, deterministicScoringVersion: z.literal("2.1.0"), sourceIdentity: readySource, analysisIdentity: remoteAnalysisIdentitySchema, rubric: ownershipSemanticRubricSchema,
  citationOrder: z.array(z.number().int().min(0).max(23)).min(1).max(24), roleBindings: z.array(ownershipRoleBindingSchema).max(20), necessaryNodeIds: ids(24).min(1), necessaryEdgeIds: ids(40).min(1), necessaryProofs: z.array(necessaryProof).min(1).max(24), createdAt: remoteTimeSchema,
}).strict();
export const ownershipNotEvaluatedCapsuleSchema = z.object({ ...common, status: z.literal("not-evaluated"), reason: ownershipCapsuleReasonSchema, answerHash: remoteHashSchema.nullable(), submissionProjectionHash: remoteHashSchema.nullable(), sourceIdentity: ownershipCapsuleSourceIdentitySchema }).strict();
export const ownershipCapsuleSchema = z.discriminatedUnion("status", [ownershipReadyCapsuleSchema, ownershipNotEvaluatedCapsuleSchema]).superRefine((value, context) => {
  if (remoteUtf8Bytes(canonicalJson(value)) > (value.status === "ready" ? 65536 : 2048)) context.addIssue({ code: "custom", message: "Capsule budget exceeded" });
  if (value.status !== "ready") return;
  const rubric = value.rubric;
  if (rubric.questionId !== value.questionId || rubric.questionVersion !== value.questionVersion || rubric.questionKind !== value.questionKind || rubric.questionFingerprint !== value.questionFingerprint || rubric.learningObjective !== value.learningObjective || value.analysisIdentity.analysisResult.fingerprint !== value.sourceIdentity.analysisResultFingerprint || value.analysisIdentity.configurationHash !== value.sourceIdentity.configurationHash || (value.analysisIdentity.ignorePolicy?.hash ?? null) !== value.sourceIdentity.ignorePolicyHash) context.addIssue({ code: "custom", message: "Capsule identity mismatch" });
  for (const values of [value.necessaryNodeIds, value.necessaryEdgeIds, value.necessaryProofs.map(item => item.evidenceId)]) if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "Duplicate capsule identity" });
});
export type OwnershipCapsule = z.infer<typeof ownershipCapsuleSchema>;
export type OwnershipReadyCapsule = z.infer<typeof ownershipReadyCapsuleSchema>;
export type OwnershipCapsuleContent = Omit<OwnershipReadyCapsule, "capsuleHash"> | Omit<z.infer<typeof ownershipNotEvaluatedCapsuleSchema>, "capsuleHash">;
export type OwnershipCapsuleReason = z.infer<typeof ownershipCapsuleReasonSchema>;
export type OwnershipCapsuleSourceIdentity = z.infer<typeof ownershipCapsuleSourceIdentitySchema>;
export type OwnershipRoleBinding = z.infer<typeof ownershipRoleBindingSchema>;
export interface OwnershipSubmissionProjection { originalCitations: SourceCitation[]; originalStructuredAnswer: OwnershipSubmission["structuredAnswer"]; citationOrder: number[]; roleBindings: OwnershipRoleBinding[]; normalizedStructuredAnswer: OwnershipSubmission["structuredAnswer"]; validatedCitations: SourceCitation[] }
export class OwnershipCapsuleError extends Error { constructor() { super("所有权语义准备失败"); this.name = "OwnershipCapsuleError"; } }

/** Capture all plain, enumerable data before any asynchronous digest; never execute accessors. */
function captureData<T>(input: T): T {
  const visiting = new Set<object>();
  const check = (value: unknown): void => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) throw new OwnershipCapsuleError(); return; }
    if (typeof value !== "object" || visiting.has(value) || Object.getOwnPropertySymbols(value).length || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new OwnershipCapsuleError();
    visiting.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get || descriptor.set || (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))) throw new OwnershipCapsuleError();
      check(descriptor.value);
    }
    visiting.delete(value);
  };
  check(input); return structuredClone(input);
}

/** One canonical UTF-8 preimage shared with a future synchronous Node digest. */
export function ownershipQuestionPreimage(question: OwnershipQuestion): string { return canonicalJson({ domain: "ownership-question/1.0.0", question }); }
export function ownershipAttemptPreimage(attempt: OwnershipAttempt): string { return canonicalJson({ domain: "ownership-attempt/1.0.0", attempt }); }
export function ownershipCapsulePreimage(capsule: OwnershipCapsuleContent | OwnershipCapsule): string { const { capsuleHash: _hash, ...content } = capsule as OwnershipCapsule; return canonicalJson({ domain: "ownership-capsule/1.0.0", capsule: content }); }
export function ownershipSubmissionProjectionPreimage(projection: OwnershipSubmissionProjection): string { return canonicalJson({ domain: "ownership-submission-projection/1.0.0", ...projection }); }
export async function digestOwnershipPreimage(preimage: string): Promise<string> { const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(preimage)); return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""); }
export async function computeOwnershipQuestionFingerprint(question: OwnershipQuestion): Promise<string> { return digestOwnershipPreimage(ownershipQuestionPreimage(question)); }
export async function computeOwnershipAttemptHash(attempt: OwnershipAttempt): Promise<string> { return digestOwnershipPreimage(ownershipAttemptPreimage(attempt)); }
export async function computeOwnershipCapsuleHash(capsule: OwnershipCapsuleContent | OwnershipCapsule): Promise<string> { return digestOwnershipPreimage(ownershipCapsulePreimage(capsule)); }
export async function computeOwnershipSubmissionProjectionHash(projection: OwnershipSubmissionProjection): Promise<string> { return digestOwnershipPreimage(ownershipSubmissionProjectionPreimage(projection)); }

/** Strict shape and binding to supplied records only; no SQL/source/currentness claim. */
export async function validateOwnershipCapsule(raw: unknown, suppliedQuestion: OwnershipQuestion, suppliedAttempt: OwnershipAttempt): Promise<OwnershipCapsule> {
  try {
    const captured = captureData({ raw, question: suppliedQuestion, attempt: suppliedAttempt });
    const { question, attempt } = captured;
    const value = ownershipCapsuleSchema.parse(captured.raw);
    // A bounded not-evaluated result relaxes assessability, never the association between records.
    if (question.repositoryId !== attempt.repositoryId || question.snapshotId !== attempt.snapshotId || question.id !== attempt.questionId || question.version !== attempt.questionVersion || question.kind !== attempt.questionKind || question.variantKey !== attempt.variantKey || canonicalJson(question.concept) !== canonicalJson(attempt.concept)) throw new OwnershipCapsuleError();
    if (value.questionFingerprint !== await computeOwnershipQuestionFingerprint(question) || value.attemptHash !== await computeOwnershipAttemptHash(attempt) || value.capsuleHash !== await computeOwnershipCapsuleHash(value)) throw new OwnershipCapsuleError();
    if (value.status === "ready") {
      if (value.repositoryId !== attempt.repositoryId || value.repositoryId !== question.repositoryId || value.snapshotId !== attempt.snapshotId || value.snapshotId !== question.snapshotId || value.attemptId !== attempt.attemptId || value.questionId !== question.id || attempt.questionId !== question.id || value.questionVersion !== question.version || value.questionVersion !== attempt.questionVersion || value.questionKind !== question.kind || value.questionKind !== attempt.questionKind || value.variantKey !== question.variantKey || value.variantKey !== attempt.variantKey || value.prompt !== question.prompt || value.learningObjective !== question.learningObjective || value.createdAt !== attempt.completedAt || value.deterministicScoringVersion !== attempt.scoringVersion || value.answerHash !== await hashOwnershipAnswer(attempt.semanticText)) throw new OwnershipCapsuleError();
      const { rubricHash, ...content } = value.rubric;
      if (rubricHash !== await computeOwnershipRubricHash(content) || content.criteria.reduce((sum, item) => sum + item.weight, 0) !== 100) throw new OwnershipCapsuleError();
      const proofs = new Map(value.necessaryProofs.map(proof => [proof.evidenceId, proof]));
      const criteria = new Map(content.criteria.map(item => [item.criterionId, item]));
      const limitations = new Map(content.limitations.map(item => [item.limitationId, item]));
      if (criteria.size !== content.criteria.length || limitations.size !== content.limitations.length || content.limitations.length !== content.criteria.length * 2) throw new OwnershipCapsuleError();
      const covered = new Set<string>();
      for (const criterion of content.criteria) {
        const unique = (values: string[]) => new Set(values).size === values.length;
        if (!unique(criterion.requiredEvidenceIds) || !unique(criterion.allowedEvidenceIds) || !unique(criterion.allowedLimitationIds) || canonicalJson(criterion.requiredEvidenceIds) !== canonicalJson(criterion.allowedEvidenceIds) || criterion.requiredEvidenceIds.some(id => !proofs.has(id)) || canonicalJson(criterion.answerScope) !== canonicalJson(attempt.semanticText.length ? [{ start: 0, end: attempt.semanticText.length }] : []) || criterion.allowedLimitationIds.length !== 2) throw new OwnershipCapsuleError();
        criterion.requiredEvidenceIds.forEach(id => covered.add(id));
        const local = criterion.allowedLimitationIds.map(id => limitations.get(id));
        if (local.some(item => !item || canonicalJson(item.criterionIds) !== canonicalJson([criterion.criterionId])) || new Set(local.map(item => item?.code)).size !== 2 || local.some(item => item?.code !== "static-only" && item?.code !== "answer-information-insufficient")) throw new OwnershipCapsuleError();
        for (const item of local) {
          const { limitationId, ...limitation } = item!;
          if (limitationId !== await computeOwnershipLimitationId(limitation) || canonicalJson(limitation.relatedEvidenceIds) !== canonicalJson(limitation.code === "static-only" ? criterion.requiredEvidenceIds : [])) throw new OwnershipCapsuleError();
        }
      }
      if (covered.size !== proofs.size || attempt.citations.length !== proofs.size || new Set(attempt.citations.map(item => canonicalJson(item))).size !== attempt.citations.length || value.necessaryProofs.some(proof => proof.confidence !== "verified")) throw new OwnershipCapsuleError();
      for (const citation of attempt.citations) {
        const proof = citation.evidenceId ? proofs.get(citation.evidenceId) : undefined;
        const { evidenceId: _id, ...span } = citation;
        if (!proof || canonicalJson(proof.span) !== canonicalJson(span)) throw new OwnershipCapsuleError();
      }
      if (new Set(value.citationOrder).size !== attempt.citations.length || value.citationOrder.some(index => index >= attempt.citations.length)) throw new OwnershipCapsuleError();
      const normalized = attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"];
      if (!normalized || normalized.kind !== value.questionKind) throw new OwnershipCapsuleError();
      let original = normalized;
      if (normalized.kind === "variable-flow") {
        if (!Array.isArray(normalized.roles) || normalized.roles.length !== value.roleBindings.length || normalized.roles.some((role, index) => role.role !== value.roleBindings[index]?.role || role.citationIndex !== value.roleBindings[index]?.validatedCitationIndex)) throw new OwnershipCapsuleError();
        for (const binding of value.roleBindings) if (value.citationOrder[binding.originalCitationIndex] !== binding.validatedCitationIndex || attempt.citations[binding.validatedCitationIndex]?.evidenceId !== binding.evidenceId || !value.necessaryEdgeIds.includes(binding.edgeId)) throw new OwnershipCapsuleError();
        original = { kind: "variable-flow", roles: value.roleBindings.map(binding => ({ role: binding.role, citationIndex: binding.originalCitationIndex })) };
      } else if (value.roleBindings.length) throw new OwnershipCapsuleError();
      const projection = { originalCitations: value.citationOrder.map(index => attempt.citations[index]!), originalStructuredAnswer: original, citationOrder: value.citationOrder, roleBindings: value.roleBindings, normalizedStructuredAnswer: normalized, validatedCitations: attempt.citations };
      if (value.submissionProjectionHash !== await computeOwnershipSubmissionProjectionHash(projection)) throw new OwnershipCapsuleError();
    }
    return value;
  } catch { throw new OwnershipCapsuleError(); }
}
