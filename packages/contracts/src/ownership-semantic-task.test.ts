import { describe, expect, it } from "vitest";
import {
  OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
  ownershipSemanticPrepareRequestSchema,
  ownershipSemanticStartRequestSchema,
} from "./ownership-semantic-policy.js";
import {
  OWNERSHIP_SEMANTIC_PURPOSE,
  OWNERSHIP_SEMANTIC_VERSION,
} from "./ownership-semantics.js";
import {
  EXPLANATION_TASK_PROTOCOL_VERSION,
  remoteCapturedIdentitySchema,
} from "./remote-explanation.js";
import {
  OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION,
  OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION,
  OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION,
  OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION,
  OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION,
  ownershipSemanticCapturedIdentitySchema,
  type OwnershipSemanticCapturedIdentity,
} from "./ownership-semantic-task.js";
import { ownershipSemanticCapturedIdentitySchema as barrelIdentitySchema } from "./index.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const otherUuid = "00000000-0000-4000-8000-000000000002";
const hash = (character: string) => character.repeat(64);

function identity(): OwnershipSemanticCapturedIdentity {
  return {
    protocolVersion: OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION,
    repositoryId: "repo-fixture",
    snapshotId: "snapshot-fixture",
    activation: "2026-10-05T00:00:00.000Z",
    analysisResultFingerprint: hash("a"),
    sourceManifestHash: hash("b"),
    configurationHash: hash("c"),
    ignorePolicyHash: null,
    ignoreRevision: 0,
    questionId: "question-fixture",
    questionVersion: "historical-question-version",
    questionFingerprint: hash("d"),
    attemptId: "attempt-fixture",
    attemptHash: hash("e"),
    deterministicScoringVersion: "historical-scoring-version",
    rubricVersion: OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION,
    rubricHash: hash("f"),
    semanticProtocolVersion: OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION,
    semanticScoringVersion: OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION,
    purpose: OWNERSHIP_SEMANTIC_PURPOSE,
    disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
    authorizationRevision: 0,
    provider: OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
    model: "gpt-test-model",
    providerRevision: 0,
    credentialRevision: 0,
    contextHandle: uuid,
    contextEpoch: 0,
    ownerSessionId: uuid,
    taskId: otherUuid,
    assessmentPackageId: hash("1"),
    bodyDigest: hash("2"),
    limitsVersion: OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION,
  };
}

const identityFields = [
  "protocolVersion", "repositoryId", "snapshotId", "activation", "analysisResultFingerprint", "sourceManifestHash", "configurationHash", "ignorePolicyHash", "ignoreRevision",
  "questionId", "questionVersion", "questionFingerprint", "attemptId", "attemptHash", "deterministicScoringVersion", "rubricVersion", "rubricHash",
  "semanticProtocolVersion", "semanticScoringVersion", "purpose", "disclosureVersion", "authorizationRevision", "provider", "model", "providerRevision",
  "credentialRevision", "contextHandle", "contextEpoch", "ownerSessionId", "taskId", "assessmentPackageId", "bodyDigest", "limitsVersion",
] as const satisfies readonly (keyof OwnershipSemanticCapturedIdentity)[];

describe("ownership semantic captured task identity contract", () => {
  it("exports exactly 33 required fields and rejects unknown or omitted fields", () => {
    const valid = identity();
    expect(ownershipSemanticCapturedIdentitySchema.safeParse(valid).success).toBe(true);
    expect(Object.keys(ownershipSemanticCapturedIdentitySchema.shape).sort()).toEqual([...identityFields].sort());
    expect(identityFields).toHaveLength(33);

    for (const field of identityFields) {
      const missing: Record<string, unknown> = { ...valid };
      delete missing[field];
      expect(ownershipSemanticCapturedIdentitySchema.safeParse(missing).success, `missing ${field}`).toBe(false);
    }

    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
  });

  it("rejects wrong runtime types at every field, while allowing only the nullable ignore hash", () => {
    const valid = identity();
    for (const field of identityFields) {
      const candidate: Record<string, unknown> = { ...valid };
      candidate[field] = field === "ignorePolicyHash" ? 123 : null;
      expect(ownershipSemanticCapturedIdentitySchema.safeParse(candidate).success, `wrong type for ${field}`).toBe(false);
    }

    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, ignorePolicyHash: hash("9") }).success).toBe(true);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, ignorePolicyHash: null }).success).toBe(true);
  });

  it("uses bounded ids, lowercase hashes, timestamps, UUIDs, model names, and free-form historical versions", () => {
    const valid = identity();
    for (const field of ["repositoryId", "snapshotId", "questionId", "attemptId"] as const) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "" }).success, `empty ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "x".repeat(129) }).success, `oversized ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "x".repeat(128) }).success, `maximum ${field}`).toBe(true);
    }

    for (const field of ["analysisResultFingerprint", "sourceManifestHash", "configurationHash", "questionFingerprint", "attemptHash", "rubricHash", "assessmentPackageId", "bodyDigest"] as const) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "a".repeat(63) }).success, `short ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "A".repeat(64) }).success, `non-lowercase ${field}`).toBe(false);
    }

    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, activation: "not-a-timestamp" }).success).toBe(false);
    for (const field of ["contextHandle", "ownerSessionId", "taskId"] as const) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "not-a-uuid" }).success, `invalid ${field}`).toBe(false);
    }

    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, model: "" }).success).toBe(false);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, model: "model with spaces" }).success).toBe(false);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, model: "m".repeat(129) }).success).toBe(false);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, model: "m".repeat(128) }).success).toBe(true);

    for (const field of ["questionVersion", "deterministicScoringVersion"] as const) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "" }).success, `empty ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "v".repeat(65) }).success, `oversized ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: "v".repeat(64) }).success, `maximum ${field}`).toBe(true);
    }
    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, questionVersion: "historical-v4", deterministicScoringVersion: "historical-v2" }).success).toBe(true);
  });

  it("pins independent protocol, policy, semantic scoring, rubric, and limits versions", () => {
    const valid = identity();
    expect(OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION).toBe("1.0.0");
    expect(OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION).toBe(`${OWNERSHIP_SEMANTIC_PURPOSE}/${OWNERSHIP_SEMANTIC_VERSION}`);
    expect(OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION).toBe("1.0.0");
    expect(OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION).toBe("1.0.0");
    expect(OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION).toBe("1.0.0");

    const fixedValues: Array<[keyof OwnershipSemanticCapturedIdentity, string]> = [
      ["protocolVersion", "wrong"], ["rubricVersion", "wrong"], ["semanticProtocolVersion", "wrong"], ["semanticScoringVersion", "wrong"],
      ["purpose", "feature-explanation"], ["disclosureVersion", "1.0.0"], ["provider", "other-provider"], ["limitsVersion", "wrong"],
    ];
    for (const [field, value] of fixedValues) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: value }).success, `fixed ${field}`).toBe(false);
    }
  });

  it("accepts the maximum safe revision and rejects negative or overflowing revisions", () => {
    const valid = identity();
    const revisions = ["ignoreRevision", "authorizationRevision", "providerRevision", "credentialRevision", "contextEpoch"] as const;
    for (const field of revisions) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: Number.MAX_SAFE_INTEGER }).success, `maximum ${field}`).toBe(true);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: -1 }).success, `negative ${field}`).toBe(false);
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, [field]: Number.MAX_SAFE_INTEGER + 1 }).success, `overflow ${field}`).toBe(false);
    }
  });

  it("keeps the complete semantic identity separate from the legacy feature identity", () => {
    const oldIdentity = {
      protocolVersion: EXPLANATION_TASK_PROTOCOL_VERSION,
      taskId: otherUuid,
      repositoryId: "repo-fixture",
      snapshotId: "snapshot-fixture",
      analysisResultFingerprint: hash("a"),
      ignoreRevision: 0,
      authorizationRevision: 0,
      providerRevision: 0,
      contextEpoch: 0,
      ownerSessionId: uuid,
      packageId: hash("1"),
      limitsVersion: "1.0.0",
      contextHandle: uuid,
      activation: "2026-10-05T00:00:00.000Z",
      configurationHash: hash("c"),
      ignorePolicyHash: null,
      sourceManifestHash: hash("b"),
      credentialRevision: 0,
      bodyDigest: hash("2"),
    };

    expect(remoteCapturedIdentitySchema.safeParse(oldIdentity).success).toBe(true);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse(oldIdentity).success).toBe(false);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse(identity()).success).toBe(true);
    expect(remoteCapturedIdentitySchema.safeParse(identity()).success).toBe(false);
  });

  it("does not let the internal identity widen renderer-facing prepare or start requests", () => {
    const valid = identity();
    const publicPrepare = {
      repositoryId: valid.repositoryId,
      snapshotId: valid.snapshotId,
      contextHandle: valid.contextHandle,
      attemptId: valid.attemptId,
      purpose: valid.purpose,
    };
    const publicStart = {
      contextHandle: valid.contextHandle,
      previewId: uuid,
      assessmentPackageId: valid.assessmentPackageId,
    };
    expect(ownershipSemanticPrepareRequestSchema.safeParse(publicPrepare).success).toBe(true);
    expect(ownershipSemanticStartRequestSchema.safeParse(publicStart).success).toBe(true);
    expect(ownershipSemanticPrepareRequestSchema.safeParse(valid).success).toBe(false);
    expect(ownershipSemanticStartRequestSchema.safeParse({ ...publicStart, ...valid }).success).toBe(false);

    for (const extra of [
      { answer: "answer body" },
      { rubric: { criteria: [] } },
      { credential: "fixture-only" },
      { endpoint: "https://example.invalid" },
      { unrecognized: true },
    ]) {
      expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it("treats hashes and references as structural fields, not a cross-field truth claim", () => {
    const first = identity();
    const second = {
      ...first,
      questionId: "another-question",
      questionVersion: "another-question-version",
      questionFingerprint: hash("3"),
      attemptId: "another-attempt",
      attemptHash: hash("4"),
      rubricHash: hash("5"),
      configurationHash: hash("6"),
      contextHandle: otherUuid,
      bodyDigest: hash("7"),
      assessmentPackageId: hash("8"),
    };

    expect(ownershipSemanticCapturedIdentitySchema.safeParse(first).success).toBe(true);
    expect(ownershipSemanticCapturedIdentitySchema.safeParse(second).success).toBe(true);
  });

  it("is exported through the contracts barrel", () => {
    expect(barrelIdentitySchema).toBe(ownershipSemanticCapturedIdentitySchema);
  });
});
