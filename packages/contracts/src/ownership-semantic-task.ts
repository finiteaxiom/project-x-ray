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
  remoteHashSchema,
  remoteIdSchema,
  remoteModelSchema,
  remoteRevisionSchema,
  remoteTimeSchema,
  remoteUuidSchema,
} from "./remote-explanation.js";

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
