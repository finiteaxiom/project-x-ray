import { z } from "zod";
import {
  OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
} from "./ownership-semantic-policy.js";
import {
  OWNERSHIP_SEMANTIC_PURPOSE,
  OWNERSHIP_SEMANTIC_VERSION,
} from "./ownership-semantics.js";
import {
  remoteFailureCodeSchema,
  remoteHashSchema,
  remoteIdSchema,
  remoteModelSchema,
  remoteRevisionSchema,
  remoteTimeSchema,
  remoteUuidSchema,
  remoteUtf8Bytes,
} from "./remote-explanation.js";
import { canonicalJson } from "./snapshot-content.js";

export const OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION = `${OWNERSHIP_SEMANTIC_PURPOSE}/${OWNERSHIP_SEMANTIC_VERSION}`;
export const OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION = "1.0.0";

const boundedVersionText = z.string().min(1).max(64);

/**
 * A strict captured-identity DTO for future trusted task registration.
 * Parsing proves only shape and bounded values; it does not establish provenance,
 * authorization, snapshot currentness, or any relationship between the hashes.
 */
export const ownershipSemanticCapturedIdentitySchema = z.object({
  protocolVersion: z.literal(OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION),
  repositoryId: remoteIdSchema,
  snapshotId: remoteIdSchema,
  activation: remoteTimeSchema,
  analysisResultFingerprint: remoteHashSchema,
  sourceManifestHash: remoteHashSchema,
  configurationHash: remoteHashSchema,
  ignorePolicyHash: remoteHashSchema.nullable(),
  ignoreRevision: remoteRevisionSchema,
  questionId: remoteIdSchema,
  questionVersion: boundedVersionText,
  questionFingerprint: remoteHashSchema,
  attemptId: remoteIdSchema,
  attemptHash: remoteHashSchema,
  deterministicScoringVersion: boundedVersionText,
  rubricVersion: z.literal(OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION),
  rubricHash: remoteHashSchema,
  semanticProtocolVersion: z.literal(OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION),
  semanticScoringVersion: z.literal(OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION),
  purpose: z.literal(OWNERSHIP_SEMANTIC_PURPOSE),
  disclosureVersion: z.literal(OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION),
  authorizationRevision: remoteRevisionSchema,
  provider: z.literal(OWNERSHIP_SEMANTIC_POLICY_PROVIDER),
  model: remoteModelSchema,
  providerRevision: remoteRevisionSchema,
  credentialRevision: remoteRevisionSchema,
  contextHandle: remoteUuidSchema,
  contextEpoch: remoteRevisionSchema,
  ownerSessionId: remoteUuidSchema,
  taskId: remoteUuidSchema,
  assessmentPackageId: remoteHashSchema,
  bodyDigest: remoteHashSchema,
  limitsVersion: z.literal(OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION),
}).strict();

export type OwnershipSemanticCapturedIdentity = z.infer<typeof ownershipSemanticCapturedIdentitySchema>;

const taskRecordMaximumBytes = 16 * 1024;
const remoteUtcTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

/**
 * Compares the complete fractional second. The accepted timestamp grammar is
 * fixed-width UTC, so the whole-second prefix is lexically ordered; fractions
 * are right-padded to compare their exact decimal values without millisecond loss.
 */
function compareRemoteUtcTimes(left: string, right: string): -1 | 0 | 1 | null {
  const leftMatch = remoteUtcTimestampPattern.exec(left);
  const rightMatch = remoteUtcTimestampPattern.exec(right);
  if (!leftMatch || !rightMatch) return null;

  const leftSecond = leftMatch[1]!;
  const rightSecond = rightMatch[1]!;
  if (leftSecond < rightSecond) return -1;
  if (leftSecond > rightSecond) return 1;

  const leftFraction = leftMatch[2] ?? "";
  const rightFraction = rightMatch[2] ?? "";
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(precision, "0");
  const rightPadded = rightFraction.padEnd(precision, "0");
  if (leftPadded < rightPadded) return -1;
  if (leftPadded > rightPadded) return 1;
  return 0;
}

/**
 * A persisted semantic task metadata DTO, separate from the feature task record.
 * Parsing validates structure and terminal consistency only; it does not prove
 * dispatch, authority, source/currentness, result publication, or stop completion.
 */
export const ownershipSemanticTaskRecordSchema = z.object({
  identity: ownershipSemanticCapturedIdentitySchema,
  phase: z.enum(["dispatched", "completed", "failed", "cancelled", "interrupted"]),
  createdAt: remoteTimeSchema,
  completedAt: remoteTimeSchema.nullable(),
  code: remoteFailureCodeSchema.nullable(),
}).strict().superRefine((record, context) => {
  const terminal = record.phase !== "dispatched";
  let stateIsValid = false;

  switch (record.phase) {
    case "dispatched":
      stateIsValid = record.completedAt === null && record.code === null;
      break;
    case "completed":
      stateIsValid = record.completedAt !== null && record.code === null;
      break;
    case "failed":
      stateIsValid = record.completedAt !== null && record.code !== null && record.code !== "CANCELLED" && record.code !== "INTERRUPTED";
      break;
    case "cancelled":
      stateIsValid = record.completedAt !== null && record.code === "CANCELLED";
      break;
    case "interrupted":
      stateIsValid = record.completedAt !== null && record.code === "INTERRUPTED";
      break;
  }

  if (!stateIsValid) context.addIssue({ code: "custom", path: ["phase"], message: "Task phase, terminal time, and failure code are inconsistent." });

  if (terminal && record.completedAt !== null) {
    const order = compareRemoteUtcTimes(record.createdAt, record.completedAt);
    if (order !== null && order > 0) context.addIssue({ code: "custom", path: ["completedAt"], message: "Terminal time precedes task creation." });
  }

  if (remoteUtf8Bytes(canonicalJson(record)) > taskRecordMaximumBytes) {
    context.addIssue({ code: "custom", message: "Semantic task record exceeds its storage budget." });
  }
});

export type OwnershipSemanticTaskRecord = z.infer<typeof ownershipSemanticTaskRecordSchema>;
