import { describe, expect, it, vi } from "vitest";
import {
  remoteAuthorizationSchema,
  remoteCancelRequestSchema,
  remoteDataCategorySchema,
  remotePrepareRequestSchema,
  remoteStartRequestSchema,
} from "./remote-explanation.js";
import {
  OWNERSHIP_SEMANTIC_POLICY_CATEGORIES,
  OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
  OWNERSHIP_SEMANTIC_POLICY_VERSION,
  ownershipSemanticAuthorizationSchema,
  ownershipSemanticGrantCommandSchema,
  ownershipSemanticPolicyCategorySchema,
  ownershipSemanticPrepareRequestSchema,
  ownershipSemanticRevokeCommandSchema,
  ownershipSemanticStartRequestSchema,
} from "./ownership-semantic-policy.js";

const PURPOSE = "ownership-semantic-assessment";
const REPOSITORY = "repo-policy-fixture";
const CONTEXT = "00112233-4455-6677-8899-aabbccddeeff";
const PREVIEW = "10112233-4455-6677-8899-aabbccddeeff";
const HASH = "a".repeat(64);
const GRANTED_AT = "2026-10-05T08:00:00.000Z";
const REVOKED_AT = "2026-10-05T08:05:00.000Z";
const ANSWER_SECRET = "answer secret must not appear in validation errors";

function grantedRecord() {
  return {
    version: OWNERSHIP_SEMANTIC_POLICY_VERSION,
    repositoryId: REPOSITORY,
    provider: OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
    purpose: PURPOSE,
    disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
    revision: 4,
    status: "granted" as const,
    categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES],
    grantedAt: GRANTED_AT,
    revokedAt: null,
  };
}

function initialDeniedRecord() {
  return { ...grantedRecord(), revision: 0, status: "denied" as const, categories: [], grantedAt: null, revokedAt: null };
}

function grantCommand() {
  return {
    repositoryId: REPOSITORY,
    expectedRevision: 3,
    expectedProviderRevision: 9,
    purpose: PURPOSE,
    disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
    categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES],
  };
}

function revokeCommand() {
  return { repositoryId: REPOSITORY, expectedRevision: 4, purpose: PURPOSE, disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION };
}

function prepareRequest() {
  return { repositoryId: REPOSITORY, snapshotId: "snapshot-policy-fixture", contextHandle: CONTEXT, attemptId: "attempt-policy-fixture", purpose: PURPOSE };
}

function startRequest() {
  return { contextHandle: CONTEXT, previewId: PREVIEW, assessmentPackageId: HASH };
}

describe("ownership semantic independent policy and public entry contracts", () => {
  it("accepts a complete independent grant, initial denied record, and revoked record", () => {
    const granted = grantedRecord();
    granted.categories.reverse();
    expect(ownershipSemanticAuthorizationSchema.safeParse(granted).success).toBe(true);
    expect(ownershipSemanticAuthorizationSchema.safeParse(initialDeniedRecord()).success).toBe(true);
    expect(ownershipSemanticAuthorizationSchema.safeParse({
      ...grantedRecord(), revision: 5, status: "denied", categories: [], revokedAt: REVOKED_AT,
    }).success).toBe(true);
  });

  it("requires denied records to have no sendable scope and only valid time histories", () => {
    expect(ownershipSemanticAuthorizationSchema.safeParse({ ...initialDeniedRecord(), categories: [OWNERSHIP_SEMANTIC_POLICY_CATEGORIES[0]] }).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse({ ...initialDeniedRecord(), grantedAt: GRANTED_AT }).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse({ ...initialDeniedRecord(), revokedAt: REVOKED_AT }).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse({ ...grantedRecord(), grantedAt: null }).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse({ ...grantedRecord(), revokedAt: REVOKED_AT }).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse({
      ...grantedRecord(), status: "denied", categories: [], revokedAt: "2026-10-05T07:59:59.999Z",
    }).success).toBe(false);
  });

  it.each([
    ["partial categories", () => ({ ...grantedRecord(), categories: OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.slice(0, 5) })],
    ["duplicate categories", () => ({ ...grantedRecord(), categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.slice(0, 5), OWNERSHIP_SEMANTIC_POLICY_CATEGORIES[0]] })],
    ["extra category", () => ({ ...grantedRecord(), categories: [...OWNERSHIP_SEMANTIC_POLICY_CATEGORIES.slice(0, 5), "credential-data"] })],
    ["feature purpose", () => ({ ...grantedRecord(), purpose: "feature-explanation" })],
    ["old disclosure", () => ({ ...grantedRecord(), disclosureVersion: "1.0.0" })],
    ["other provider", () => ({ ...grantedRecord(), provider: "other" })],
    ["negative revision", () => ({ ...grantedRecord(), revision: -1 })],
    ["oversize repository id", () => ({ ...grantedRecord(), repositoryId: "r".repeat(129) })],
    ["malformed time", () => ({ ...grantedRecord(), grantedAt: "not-a-time" })],
  ])("rejects invalid authorization record: %s", (_label, makeInvalid) => {
    expect(ownershipSemanticAuthorizationSchema.safeParse(makeInvalid()).success).toBe(false);
  });

  it("requires the grant command to name the complete unique six-category scope", () => {
    expect(ownershipSemanticGrantCommandSchema.safeParse(grantCommand()).success).toBe(true);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), categories: grantCommand().categories.slice(0, 5) }).success).toBe(false);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), categories: [...grantCommand().categories.slice(0, 5), grantCommand().categories[0]] }).success).toBe(false);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), categories: [...grantCommand().categories.slice(0, 5), "query"] }).success).toBe(false);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), purpose: "feature-explanation" }).success).toBe(false);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), disclosureVersion: "1.0.0" }).success).toBe(false);
    expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), expectedProviderRevision: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(ownershipSemanticRevokeCommandSchema.safeParse({ ...revokeCommand(), disclosureVersion: "1.0.0" }).success).toBe(false);
  });

  it("accepts narrow revoke, prepare, and start commands without renderer-owned answer or task fields", () => {
    expect(ownershipSemanticRevokeCommandSchema.safeParse(revokeCommand()).success).toBe(true);
    expect(ownershipSemanticPrepareRequestSchema.safeParse(prepareRequest()).success).toBe(true);
    expect(ownershipSemanticStartRequestSchema.safeParse(startRequest()).success).toBe(true);
    expect(ownershipSemanticStartRequestSchema.safeParse({ ...startRequest(), assessmentPackageId: "A".repeat(64) }).success).toBe(false);

    for (const field of ["answer", "rubric", "source", "ownerSessionId", "taskId", "endpoint", "credential", "scope", "provider", "status"]) {
      expect(ownershipSemanticPrepareRequestSchema.safeParse({ ...prepareRequest(), [field]: ANSWER_SECRET }).success).toBe(false);
      expect(ownershipSemanticStartRequestSchema.safeParse({ ...startRequest(), [field]: ANSWER_SECRET }).success).toBe(false);
      expect(ownershipSemanticGrantCommandSchema.safeParse({ ...grantCommand(), [field]: ANSWER_SECRET }).success).toBe(false);
      expect(ownershipSemanticRevokeCommandSchema.safeParse({ ...revokeCommand(), [field]: ANSWER_SECRET }).success).toBe(false);
    }
  });

  it.each(["answer", "rubric", "source", "ownerSessionId", "taskId", "query", "model"])("rejects extra renderer-supplied %s on prepare", field => {
    expect(ownershipSemanticPrepareRequestSchema.safeParse({ ...prepareRequest(), [field]: ANSWER_SECRET }).success).toBe(false);
  });

  it("does not echo unknown input values in strict-schema errors", () => {
    const result = ownershipSemanticPrepareRequestSchema.safeParse({ ...prepareRequest(), source: ANSWER_SECRET });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).not.toContain(ANSWER_SECRET);
  });

  it("keeps the independent semantic policy disjoint from the existing feature-explanation authorization and entry contracts", () => {
    const oldCategories = ["query", "relative-paths-and-symbols", "relationships", "source-snippets", "evidence-identities", "analysis-limitations"] as const;
    const featureGrant = {
      version: "1.0.0", repositoryId: REPOSITORY, provider: "openai", scope: ["feature-explanation"], disclosureVersion: "1.0.0",
      revision: 4, status: "granted", categories: [...oldCategories], grantedAt: GRANTED_AT, revokedAt: null,
    };
    const semanticGrant = grantedRecord();
    expect(remoteAuthorizationSchema.safeParse(featureGrant).success).toBe(true);
    expect(ownershipSemanticAuthorizationSchema.safeParse(featureGrant).success).toBe(false);
    expect(ownershipSemanticAuthorizationSchema.safeParse(semanticGrant).success).toBe(true);
    expect(remoteAuthorizationSchema.safeParse(semanticGrant).success).toBe(false);
    expect(remoteDataCategorySchema.safeParse("answer-text").success).toBe(false);
    expect(remoteDataCategorySchema.safeParse("source-snippets").success).toBe(true);

    const featurePrepare = { repositoryId: REPOSITORY, snapshotId: "snapshot-policy-fixture", contextHandle: CONTEXT, purpose: "feature-explanation", query: "Explain a path" };
    const semanticPrepare = prepareRequest();
    expect(remotePrepareRequestSchema.safeParse(featurePrepare).success).toBe(true);
    expect(ownershipSemanticPrepareRequestSchema.safeParse(featurePrepare).success).toBe(false);
    expect(ownershipSemanticPrepareRequestSchema.safeParse(semanticPrepare).success).toBe(true);
    expect(remotePrepareRequestSchema.safeParse(semanticPrepare).success).toBe(false);

    const featureStart = { contextHandle: CONTEXT, previewId: PREVIEW, packageId: HASH, taskId: CONTEXT };
    const semanticStart = startRequest();
    expect(remoteStartRequestSchema.safeParse(featureStart).success).toBe(true);
    expect(ownershipSemanticStartRequestSchema.safeParse(featureStart).success).toBe(false);
    expect(ownershipSemanticStartRequestSchema.safeParse(semanticStart).success).toBe(true);
    expect(remoteStartRequestSchema.safeParse(semanticStart).success).toBe(false);
    expect(remoteCancelRequestSchema.safeParse({ contextHandle: CONTEXT, taskId: CONTEXT }).success).toBe(true);
  });

  it("exports only the same new contracts through the existing barrel and imports without network or timer work", async () => {
    const barrel = await import("./index.js");
    expect(barrel.ownershipSemanticAuthorizationSchema).toBe(ownershipSemanticAuthorizationSchema);
    expect(barrel.ownershipSemanticPrepareRequestSchema).toBe(ownershipSemanticPrepareRequestSchema);
    expect(barrel.ownershipSemanticStartRequestSchema).toBe(ownershipSemanticStartRequestSchema);
    expect(Object.isFrozen(OWNERSHIP_SEMANTIC_POLICY_CATEGORIES)).toBe(true);

    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const timerSpy = vi.spyOn(globalThis, "setTimeout");
    await import("./ownership-semantic-policy.js");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timerSpy).not.toHaveBeenCalled();
  });
});
