import { z } from "zod";
import { canonicalJson } from "./snapshot-content.js";
import { remoteHashSchema, remoteRevisionSchema, remoteTimeSchema, remoteUtf8Bytes } from "./remote-explanation.js";
import type { OwnershipAttempt, OwnershipQuestion, OwnershipQuestionRequest, ProjectSnapshot } from "./index.js";

export const OWNERSHIP_QUESTION_BINDING_VERSION = "1.0.0";
export const OWNERSHIP_GENERATOR_BINDING_VERSION = "1.0.0";
export const OWNERSHIP_QUESTION_BINDING_LIMITS = Object.freeze({ questionBytes: 131072, basisBytes: 8192, unavailableBytes: 2048 });
const versionText = z.string().min(1).max(64);
export const ownershipOrderingEngineSchema = z.object({
  implementationVersion: z.literal("js-localeCompare/1.0.0"), nodeVersion: versionText, v8Version: versionText,
  icuVersion: versionText, unicodeVersion: versionText, cldrVersion: versionText, hostRuntime: z.enum(["node", "electron"]), electronVersion: versionText.nullable(),
  locale: versionText, usage: z.enum(["sort", "search"]), sensitivity: z.enum(["base", "accent", "case", "variant"]),
  ignorePunctuation: z.boolean(), collation: versionText, numeric: z.boolean(), caseFirst: z.enum(["upper", "lower", "false"]),
}).strict().refine(value => value.hostRuntime === "electron" ? value.electronVersion !== null : value.electronVersion === null);
export type OwnershipOrderingEngine = z.infer<typeof ownershipOrderingEngineSchema>;
export const ownershipBindingSourceSchema = z.object({ activation: remoteTimeSchema, analysisResultFingerprint: remoteHashSchema.nullable(),
  configurationHash: remoteHashSchema, ignorePolicyHash: remoteHashSchema.nullable(), sourceManifestHash: remoteHashSchema, ignoreRevision: remoteRevisionSchema }).strict();
// Internal callers historically request more than the IPC's twenty-question limit.
// Certification records their actual count; it never clamps the local generator.
const request = z.object({ repositoryId: z.string(), snapshotId: z.string(), count: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  scope: z.object({ kind: z.enum(["project", "module", "symbol"]), nodeId: z.string().optional() }).strict(), conceptId: z.string().optional() }).strict();
export const ownershipQuestionBindingBasisSchema = z.object({ generatorVersion: z.literal(OWNERSHIP_GENERATOR_BINDING_VERSION),
  orderingVersion: z.literal("completedAt-attemptId-locale/1.0.0"), orderingEngine: ownershipOrderingEngineSchema,
  request, candidateIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), generatorInputHash: remoteHashSchema,
  historyCut: z.object({ maxAttemptRowid: remoteRevisionSchema }).strict(), matchingHistoryProjectionHash: remoteHashSchema,
  retryWitness: z.object({ attemptId: z.string(), attemptHash: remoteHashSchema, questionId: z.string() }).strict().nullable(),
  publicationSource: ownershipBindingSourceSchema, createdAt: remoteTimeSchema,
}).strict().refine(value => value.candidateIndex < value.request.count && remoteUtf8Bytes(canonicalJson(value)) <= OWNERSHIP_QUESTION_BINDING_LIMITS.basisBytes);
export type OwnershipQuestionBindingBasis = z.infer<typeof ownershipQuestionBindingBasisSchema>;
export const ownershipQuestionBindingReasonSchema = z.enum(["question-budget-exceeded", "basis-budget-exceeded", "history-unverifiable",
  "unsupported-generator", "unsupported-ordering-engine", "ambiguous-generator", "untrusted-issuance"]);
const common = { version: z.literal(OWNERSHIP_QUESTION_BINDING_VERSION), attemptId: z.string(), repositoryId: z.string(), snapshotId: z.string(),
  questionId: z.string(), questionVersion: z.string(), questionFingerprint: remoteHashSchema, attemptHash: remoteHashSchema, capsuleHash: remoteHashSchema };
export const ownershipQuestionBindingRecordSchema = z.discriminatedUnion("status", [
  z.object({ ...common, status: z.literal("verified-generator"), questionPreimage: z.string().refine(value => remoteUtf8Bytes(value) <= OWNERSHIP_QUESTION_BINDING_LIMITS.questionBytes),
    basis: ownershipQuestionBindingBasisSchema }).strict(),
  z.object({ ...common, status: z.literal("unavailable"), reason: ownershipQuestionBindingReasonSchema }).strict()
    .refine(value => remoteUtf8Bytes(canonicalJson(value)) <= OWNERSHIP_QUESTION_BINDING_LIMITS.unavailableBytes),
]);
export type OwnershipQuestionBindingRecord = z.infer<typeof ownershipQuestionBindingRecordSchema>;
export type OwnershipQuestionBindingRead = { status: "legacy-unbound" } | { status: "unsupported-ordering-engine" | "unsupported-generator"; currentness: "not-checked" }
  | { status: "verified-generator" | "unavailable"; currentness: "not-checked"; record: OwnershipQuestionBindingRecord };
/** Trusted compiled module supplied once at store construction, never an IPC callback. */
export interface OwnershipQuestionGeneratorPort {
  readonly version: string;
  readonly orderingEngine: OwnershipOrderingEngine | null;
  generate(snapshot: ProjectSnapshot, request: OwnershipQuestionRequest, attempts: OwnershipAttempt[]): { questions: OwnershipQuestion[]; candidates: OwnershipQuestion[] };
}
