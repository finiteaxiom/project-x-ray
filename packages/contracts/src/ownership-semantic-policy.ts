import { z } from "zod";
import { OWNERSHIP_SEMANTIC_PURPOSE } from "./ownership-semantics.js";
import { remoteHashSchema, remoteIdSchema, remoteRevisionSchema, remoteTimeSchema, remoteUuidSchema } from "./remote-explanation.js";

export const OWNERSHIP_SEMANTIC_POLICY_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION = "ownership-semantics/1.0.0";
export const OWNERSHIP_SEMANTIC_POLICY_PROVIDER = "openai";
export const OWNERSHIP_SEMANTIC_POLICY_CATEGORIES = Object.freeze([
  "answer-text",
  "structured-answer-and-citations",
  "question-learning-objective-and-rubric",
  "source-snippets",
  "relative-paths-symbols-and-relationships",
  "analysis-snapshot-identities-and-limitations",
] as const);

export const ownershipSemanticPolicyCategorySchema = z.enum(OWNERSHIP_SEMANTIC_POLICY_CATEGORIES);
const policyVersion = z.literal(OWNERSHIP_SEMANTIC_POLICY_VERSION);
const purpose = z.literal(OWNERSHIP_SEMANTIC_PURPOSE);
const disclosureVersion = z.literal(OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION);
const provider = z.literal(OWNERSHIP_SEMANTIC_POLICY_PROVIDER);

function hasCompleteCategories(categories: readonly OwnershipSemanticPolicyCategory[]): boolean {
  const unique = new Set(categories);
  return categories.length === OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.length &&
    unique.size === OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.length &&
    OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.every(category => unique.has(category));
}

/** A validated DTO only; this schema does not grant or observe authorization. */
export const ownershipSemanticAuthorizationSchema = z.object({
  version: policyVersion,
  repositoryId: remoteIdSchema,
  provider,
  purpose,
  disclosureVersion,
  revision: remoteRevisionSchema,
  status: z.enum(["denied", "granted"]),
  categories: z.array(ownershipSemanticPolicyCategorySchema).max(6),
  grantedAt: remoteTimeSchema.nullable(),
  revokedAt: remoteTimeSchema.nullable(),
}).strict().superRefine((record, context) => {
  if (record.status === "granted") {
    if (!hasCompleteCategories(record.categories)) context.addIssue({ code: "custom", path: ["categories"], message: "Grants require every semantic assessment disclosure category exactly once." });
    if (record.grantedAt === null || record.revokedAt !== null) context.addIssue({ code: "custom", path: ["grantedAt"], message: "Granted authorization timestamps are inconsistent." });
    return;
  }

  if (record.categories.length !== 0) context.addIssue({ code: "custom", path: ["categories"], message: "Denied authorization cannot retain disclosure categories." });
  const neverGranted = record.grantedAt === null && record.revokedAt === null;
  const revoked = record.grantedAt !== null && record.revokedAt !== null &&
    Number.isFinite(Date.parse(record.grantedAt)) && Number.isFinite(Date.parse(record.revokedAt)) &&
    Date.parse(record.revokedAt) >= Date.parse(record.grantedAt);
  if (!neverGranted && !revoked) context.addIssue({ code: "custom", path: ["revokedAt"], message: "Denied authorization must be initial or have a valid revocation time." });
});

/** A command contract only; trusted main code must separately verify the real user action and current revisions. */
export const ownershipSemanticGrantCommandSchema = z.object({
  repositoryId: remoteIdSchema,
  expectedRevision: remoteRevisionSchema,
  expectedProviderRevision: remoteRevisionSchema,
  purpose,
  disclosureVersion,
  categories: z.array(ownershipSemanticPolicyCategorySchema).max(6),
}).strict().superRefine((command, context) => {
  if (!hasCompleteCategories(command.categories)) context.addIssue({ code: "custom", path: ["categories"], message: "Grant commands require every semantic assessment disclosure category exactly once." });
});

/** A command contract only; it does not revoke database state or cancel a task. */
export const ownershipSemanticRevokeCommandSchema = z.object({
  repositoryId: remoteIdSchema,
  expectedRevision: remoteRevisionSchema,
  purpose,
  disclosureVersion,
}).strict();

/** Renderer-facing reference only: answer, rubric, source, ownership and task identity are main-owned. */
export const ownershipSemanticPrepareRequestSchema = z.object({
  repositoryId: remoteIdSchema,
  snapshotId: remoteIdSchema,
  contextHandle: remoteUuidSchema,
  attemptId: remoteIdSchema,
  purpose,
}).strict();

/** Task identity is assigned by future trusted main registration, never by the caller. */
export const ownershipSemanticStartRequestSchema = z.object({
  contextHandle: remoteUuidSchema,
  previewId: remoteUuidSchema,
  assessmentPackageId: remoteHashSchema,
}).strict();

export type OwnershipSemanticPolicyCategory = z.infer<typeof ownershipSemanticPolicyCategorySchema>;
export type OwnershipSemanticAuthorization = z.infer<typeof ownershipSemanticAuthorizationSchema>;
export type OwnershipSemanticGrantCommand = z.infer<typeof ownershipSemanticGrantCommandSchema>;
export type OwnershipSemanticRevokeCommand = z.infer<typeof ownershipSemanticRevokeCommandSchema>;
export type OwnershipSemanticPrepareRequest = z.infer<typeof ownershipSemanticPrepareRequestSchema>;
export type OwnershipSemanticStartRequest = z.infer<typeof ownershipSemanticStartRequestSchema>;
