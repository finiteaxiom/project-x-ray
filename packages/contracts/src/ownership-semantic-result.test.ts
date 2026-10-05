import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
  OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
  OWNERSHIP_SEMANTIC_PURPOSE,
  OWNERSHIP_SEMANTIC_RESULT_LIMITS,
  OWNERSHIP_SEMANTIC_RESULT_VERSION,
  OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION,
  OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION,
  OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION,
  OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION,
  OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION,
  OWNERSHIP_SEMANTIC_VERSION,
  OwnershipSemanticResultError,
  buildOwnershipSemanticResultEnvelope,
  canonicalJson,
  ownershipSemanticCapturedIdentitySchema,
  ownershipSemanticResultEnvelopeSchema,
  remoteUtf8Bytes,
  validateOwnershipSemanticResultEnvelope,
  type OwnershipSemanticCapturedIdentity,
  type OwnershipSemanticResponse,
  type OwnershipSemanticResultInput,
} from "./index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const TRANSIENT_IDENTITY_FIELDS = ["taskId", "ownerSessionId", "contextHandle", "contextEpoch"] as const;

function identity(): OwnershipSemanticCapturedIdentity {
  return {
    protocolVersion: OWNERSHIP_SEMANTIC_TASK_PROTOCOL_VERSION,
    repositoryId: "repo-result-fixture",
    snapshotId: "snapshot-result-fixture",
    activation: "2026-10-05T00:00:00.123456Z",
    analysisResultFingerprint: HASH_A,
    sourceManifestHash: HASH_B,
    configurationHash: HASH_C,
    ignorePolicyHash: null,
    ignoreRevision: 4,
    questionId: "question-result-fixture",
    questionVersion: "2.0.0-fixture",
    questionFingerprint: HASH_B,
    attemptId: "attempt-result-fixture",
    attemptHash: HASH_C,
    deterministicScoringVersion: "2.1.0",
    rubricVersion: OWNERSHIP_SEMANTIC_TASK_RUBRIC_VERSION,
    rubricHash: HASH_A,
    semanticProtocolVersion: OWNERSHIP_SEMANTIC_TASK_SEMANTIC_PROTOCOL_VERSION,
    semanticScoringVersion: OWNERSHIP_SEMANTIC_TASK_SEMANTIC_SCORING_VERSION,
    purpose: OWNERSHIP_SEMANTIC_PURPOSE,
    disclosureVersion: OWNERSHIP_SEMANTIC_POLICY_DISCLOSURE_VERSION,
    authorizationRevision: 3,
    provider: OWNERSHIP_SEMANTIC_POLICY_PROVIDER,
    model: "gpt-4.1-mini",
    providerRevision: 5,
    credentialRevision: 6,
    contextHandle: UUID_A,
    contextEpoch: 7,
    ownerSessionId: UUID_A,
    taskId: UUID_B,
    assessmentPackageId: HASH_C,
    bodyDigest: HASH_B,
    limitsVersion: OWNERSHIP_SEMANTIC_TASK_LIMITS_VERSION,
  };
}

function response(packageId = HASH_C): OwnershipSemanticResponse {
  return {
    version: OWNERSHIP_SEMANTIC_VERSION,
    assessmentPackageId: packageId,
    criteria: [
      {
        criterionId: "criterion-supported",
        verdict: "supported" as const,
        explanation: '源码支持此解释 🙂，引号"和反斜杠\\均保留。',
        evidenceIds: ["evidence-supported"],
        limitationIds: [],
        answerRanges: [{ start: 0, end: 1 }, { start: 2, end: 3 }],
      },
      {
        criterionId: "criterion-contradicted",
        verdict: "contradicted" as const,
        explanation: "另一段源码与该说法冲突。",
        evidenceIds: ["evidence-contradicted"],
        limitationIds: [],
        answerRanges: [{ start: 4, end: 5 }],
      },
      {
        criterionId: "criterion-insufficient",
        verdict: "insufficient" as const,
        explanation: "现有材料不足以证明这个结论。",
        evidenceIds: [],
        limitationIds: [HASH_A],
        answerRanges: [],
      },
    ],
  };
}

function input(): OwnershipSemanticResultInput {
  return {
    identity: identity(),
    createdAt: "2026-10-05T00:00:00.123456Z",
    completedAt: "2026-10-05T00:00:00.123457Z",
    response: response(),
  };
}

function graphBindingReference(value: OwnershipSemanticCapturedIdentity): string {
  const { taskId: _taskId, ownerSessionId: _ownerSessionId, contextHandle: _contextHandle, contextEpoch: _contextEpoch, ...binding } = value;
  return createHash("sha256").update(canonicalJson(binding), "utf8").digest("hex");
}

function responseDigestReference(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function isRecursivelyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !("value" in descriptor) || isRecursivelyFrozen(descriptor.value);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ownership semantic result envelope contract", () => {
  it("builds an immutable v1 candidate with exact canonical digests and preserves response order", async () => {
    const source = input();
    const before = canonicalJson(source);
    const result = await buildOwnershipSemanticResultEnvelope(source);
    const projectedKeys = Object.keys(source.identity).filter(key => !TRANSIENT_IDENTITY_FIELDS.includes(key as typeof TRANSIENT_IDENTITY_FIELDS[number]));

    expect(ownershipSemanticResultEnvelopeSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      version: OWNERSHIP_SEMANTIC_RESULT_VERSION,
      identity: source.identity,
      createdAt: source.createdAt,
      completedAt: source.completedAt,
      response: source.response,
    });
    expect(Object.keys(result.identity).filter(key => !TRANSIENT_IDENTITY_FIELDS.includes(key as typeof TRANSIENT_IDENTITY_FIELDS[number])).sort()).toEqual(projectedKeys.sort());
    expect(result.bindingHash).toBe(graphBindingReference(source.identity));
    expect(result.responseDigest).toBe(responseDigestReference(source.response));
    expect(result.response.criteria.map(item => item.verdict)).toEqual(["supported", "contradicted", "insufficient"]);
    expect(isRecursivelyFrozen(result)).toBe(true);
    expect(canonicalJson(source)).toBe(before);
    expect(ownershipSemanticResultEnvelopeSchema.safeParse(result).data).toEqual(result);
  });

  it("matches the graph binding projection and changes it for every mutable retained identity field", async () => {
    const baseInput = input();
    const base = await buildOwnershipSemanticResultEnvelope(baseInput);
    const transientMutations: Array<(value: OwnershipSemanticCapturedIdentity) => void> = [
      value => { value.taskId = "00000000-0000-4000-8000-000000000003"; },
      value => { value.ownerSessionId = "00000000-0000-4000-8000-000000000004"; },
      value => { value.contextHandle = "00000000-0000-4000-8000-000000000005"; },
      value => { value.contextEpoch += 1; },
    ];
    for (const mutate of transientMutations) {
      const variant = input();
      mutate(variant.identity);
      const prepared = await buildOwnershipSemanticResultEnvelope(variant);
      expect(prepared.bindingHash).toBe(base.bindingHash);
    }

    const retainedMutations: Array<{ name: string; apply: (value: OwnershipSemanticResultInput) => void }> = [
      { name: "repositoryId", apply: value => { value.identity.repositoryId += "-other"; } },
      { name: "snapshotId", apply: value => { value.identity.snapshotId += "-other"; } },
      { name: "activation", apply: value => { value.identity.activation = "2026-10-05T00:00:00.123457Z"; } },
      { name: "analysisResultFingerprint", apply: value => { value.identity.analysisResultFingerprint = HASH_C; } },
      { name: "sourceManifestHash", apply: value => { value.identity.sourceManifestHash = HASH_C; } },
      { name: "configurationHash", apply: value => { value.identity.configurationHash = HASH_B; } },
      { name: "ignorePolicyHash", apply: value => { value.identity.ignorePolicyHash = HASH_A; } },
      { name: "ignoreRevision", apply: value => { value.identity.ignoreRevision += 1; } },
      { name: "questionId", apply: value => { value.identity.questionId += "-other"; } },
      { name: "questionVersion", apply: value => { value.identity.questionVersion += "-other"; } },
      { name: "questionFingerprint", apply: value => { value.identity.questionFingerprint = HASH_A; } },
      { name: "attemptId", apply: value => { value.identity.attemptId += "-other"; } },
      { name: "attemptHash", apply: value => { value.identity.attemptHash = HASH_A; } },
      { name: "deterministicScoringVersion", apply: value => { value.identity.deterministicScoringVersion += ".other"; } },
      { name: "rubricHash", apply: value => { value.identity.rubricHash = HASH_C; } },
      { name: "authorizationRevision", apply: value => { value.identity.authorizationRevision += 1; } },
      { name: "model", apply: value => { value.identity.model = "another-model"; } },
      { name: "providerRevision", apply: value => { value.identity.providerRevision += 1; } },
      { name: "credentialRevision", apply: value => { value.identity.credentialRevision += 1; } },
      { name: "assessmentPackageId", apply: value => { value.identity.assessmentPackageId = HASH_A; value.response.assessmentPackageId = HASH_A; } },
      { name: "bodyDigest", apply: value => { value.identity.bodyDigest = HASH_C; } },
    ];
    for (const mutation of retainedMutations) {
      const variant = input();
      mutation.apply(variant);
      const prepared = await buildOwnershipSemanticResultEnvelope(variant);
      expect(prepared.bindingHash, mutation.name).not.toBe(base.bindingHash);
    }
  });

  it("compares the complete UTC fraction through the existing completed-task contract", async () => {
    const backwards = input();
    backwards.completedAt = "2026-10-05T00:00:00.123455Z";
    expect(Date.parse(backwards.completedAt)).toBe(Date.parse(backwards.createdAt));
    await expect(buildOwnershipSemanticResultEnvelope(backwards)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const equalDifferentPrecision = input();
    equalDifferentPrecision.completedAt = "2026-10-05T00:00:00.123456000Z";
    await expect(buildOwnershipSemanticResultEnvelope(equalDifferentPrecision)).resolves.toMatchObject({ completedAt: equalDifferentPrecision.completedAt });

    const nextWholeSecond = input();
    nextWholeSecond.createdAt = "2026-10-05T00:00:00.999999999Z";
    nextWholeSecond.completedAt = "2026-10-05T00:00:01Z";
    await expect(buildOwnershipSemanticResultEnvelope(nextWholeSecond)).resolves.toMatchObject({ completedAt: nextWholeSecond.completedAt });

    const reverseAcrossSecond = input();
    reverseAcrossSecond.createdAt = "2026-10-05T00:00:01Z";
    reverseAcrossSecond.completedAt = "2026-10-05T00:00:00.999999999Z";
    await expect(buildOwnershipSemanticResultEnvelope(reverseAcrossSecond)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const built = await buildOwnershipSemanticResultEnvelope(input());
    const invalidEnvelope = structuredClone(built);
    invalidEnvelope.completedAt = "2026-10-05T00:00:00.123455Z";
    await expect(validateOwnershipSemanticResultEnvelope(invalidEnvelope)).rejects.toMatchObject({ code: "INVALID_RESULT" });
  });

  it("keeps canonical UTF-8 accounting after escaping Chinese, emoji, quotes, and backslashes", async () => {
    const source = input();
    const longExplanation = `${"中".repeat(1180)} \"quoted\" \\ 🙂`;
    source.response.criteria = Array.from({ length: 8 }, (_, index) => {
      const common = { criterionId: `criterion-${index}`, explanation: longExplanation };
      const evidenceIds = Array.from({ length: 8 }, (_, evidenceIndex) => `e${index}-${evidenceIndex}-${"源".repeat(118)}`);
      if (index % 3 === 0) return { ...common, verdict: "supported" as const, evidenceIds, limitationIds: [], answerRanges: [{ start: index, end: index + 1 }] };
      if (index % 3 === 1) return { ...common, verdict: "contradicted" as const, evidenceIds, limitationIds: [], answerRanges: [{ start: index, end: index + 1 }] };
      return { ...common, verdict: "insufficient" as const, evidenceIds: [], limitationIds: [HASH_A], answerRanges: [] };
    });
    const result = await buildOwnershipSemanticResultEnvelope(source);
    const canonicalResponse = canonicalJson(result.response);
    const canonicalEnvelope = canonicalJson(result);
    const responseBytes = new TextEncoder().encode(canonicalResponse).byteLength;
    const envelopeBytes = new TextEncoder().encode(canonicalEnvelope).byteLength;

    expect(canonicalResponse).toContain("\\\"");
    expect(canonicalResponse).toContain("\\\\");
    expect(responseBytes).toBe(remoteUtf8Bytes(canonicalResponse));
    expect(envelopeBytes).toBe(remoteUtf8Bytes(canonicalEnvelope));
    expect(responseBytes).toBeGreaterThan(canonicalResponse.length);
    expect(responseBytes).toBeLessThanOrEqual(OWNERSHIP_SEMANTIC_RESULT_LIMITS.responseBytes);
    expect(envelopeBytes).toBeLessThanOrEqual(OWNERSHIP_SEMANTIC_RESULT_LIMITS.envelopeBytes);
    expect(OWNERSHIP_SEMANTIC_RESULT_LIMITS).toEqual({ responseBytes: 256 * 1024, envelopeBytes: 272 * 1024 });
  });

  it("rejects changed summaries and strict envelope, response, and identity field injection", async () => {
    const built = await buildOwnershipSemanticResultEnvelope(input());
    const tamperedResponse = structuredClone(built);
    tamperedResponse.response.criteria[0]!.explanation += " changed";
    await expect(validateOwnershipSemanticResultEnvelope(tamperedResponse)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });

    const tamperedBodyDigest = structuredClone(built);
    tamperedBodyDigest.identity.bodyDigest = HASH_A;
    await expect(validateOwnershipSemanticResultEnvelope(tamperedBodyDigest)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });

    const invalidValues: unknown[] = [
      { ...built, version: "2.0.0" },
      { ...built, score: 100 },
      { ...built, passed: true },
      { ...built, confidence: "verified" },
      { ...built, answer: "answer must remain outside this DTO" },
      { ...built, source: "source must remain outside this DTO" },
      { ...built, rubric: {} },
      { ...built, apiKey: "secret" },
      { ...built, identity: { ...built.identity, unrecognized: true } },
      { ...built, response: { ...built.response, passed: true } },
      { ...built, response: { ...built.response, assessmentPackageId: HASH_A } },
      { ...built, response: { ...built.response, version: "2.0.0" } },
      { ...built, bindingHash: "A".repeat(64) },
    ];
    for (const invalid of invalidValues) {
      await expect(validateOwnershipSemanticResultEnvelope(invalid)).rejects.toBeInstanceOf(OwnershipSemanticResultError);
    }

    const invalidBuilderInputs: unknown[] = [
      { ...input(), bindingHash: built.bindingHash },
      { ...input(), responseDigest: built.responseDigest },
      { ...input(), score: 1 },
      { ...input(), response: { ...response(), assessmentPackageId: HASH_A } },
    ];
    for (const invalid of invalidBuilderInputs) {
      await expect(buildOwnershipSemanticResultEnvelope(invalid as OwnershipSemanticResultInput)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }

    expect(ownershipSemanticCapturedIdentitySchema.safeParse({ ...built.identity, answer: "not identity" }).success).toBe(false);
  });

  it("requires unique criteria, evidence, limitation, and answer-range entries without reordering them", async () => {
    const duplicateCriterion = input();
    duplicateCriterion.response.criteria[1]!.criterionId = duplicateCriterion.response.criteria[0]!.criterionId;
    await expect(buildOwnershipSemanticResultEnvelope(duplicateCriterion)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const duplicateEvidence = input();
    duplicateEvidence.response.criteria[0]!.evidenceIds.push("evidence-supported");
    await expect(buildOwnershipSemanticResultEnvelope(duplicateEvidence)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const duplicateLimitation = input();
    duplicateLimitation.response.criteria[2]!.limitationIds.push(HASH_A);
    await expect(buildOwnershipSemanticResultEnvelope(duplicateLimitation)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const duplicateRange = input();
    duplicateRange.response.criteria[0]!.answerRanges.push({ ...duplicateRange.response.criteria[0]!.answerRanges[0]! });
    await expect(buildOwnershipSemanticResultEnvelope(duplicateRange)).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const built = await buildOwnershipSemanticResultEnvelope(input());
    const duplicateValidated = structuredClone(built);
    duplicateValidated.response.criteria[0]!.evidenceIds.push(duplicateValidated.response.criteria[0]!.evidenceIds[0]!);
    duplicateValidated.responseDigest = responseDigestReference(duplicateValidated.response);
    await expect(validateOwnershipSemanticResultEnvelope(duplicateValidated)).rejects.toMatchObject({ code: "INVALID_RESULT" });

    const changed = structuredClone(built);
    changed.response.criteria[0]!.answerRanges.reverse();
    changed.responseDigest = responseDigestReference(changed.response);
    const validated = await validateOwnershipSemanticResultEnvelope(changed);
    expect(validated.response.criteria[0]!.answerRanges).toEqual(changed.response.criteria[0]!.answerRanges);
  });

  it("captures builder inputs before the first digest await and ignores later caller mutation", async () => {
    const source = input();
    const original = structuredClone(source);
    let started!: () => void;
    let release!: () => void;
    const digestStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let pause = true;
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, data) => {
      if (!pause) return nativeDigest(algorithm, data);
      pause = false;
      started();
      return gate.then(() => nativeDigest(algorithm, data));
    });

    const building = buildOwnershipSemanticResultEnvelope(source);
    await digestStarted;
    source.identity.repositoryId = "late-replacement";
    source.identity.bodyDigest = HASH_A;
    source.response.criteria[0]!.explanation = "late answer replacement";
    source.completedAt = "2026-10-05T00:00:00.123455Z";
    release();

    const result = await building;
    expect(result.identity).toEqual(original.identity);
    expect(result.response).toEqual(original.response);
    expect(result.createdAt).toBe(original.createdAt);
    expect(result.completedAt).toBe(original.completedAt);
    expect(result.bindingHash).toBe(graphBindingReference(original.identity));
    expect(result.responseDigest).toBe(responseDigestReference(original.response));
    expect(digestSpy).toHaveBeenCalledTimes(2);
  });

  it("captures validator input before the first digest await", async () => {
    const built = await buildOwnershipSemanticResultEnvelope(input());
    const source = structuredClone(built);
    const original = canonicalJson(source);
    let started!: () => void;
    let release!: () => void;
    const digestStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const nativeDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let pause = true;
    vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation((algorithm, data) => {
      if (!pause) return nativeDigest(algorithm, data);
      pause = false;
      started();
      return gate.then(() => nativeDigest(algorithm, data));
    });

    const validating = validateOwnershipSemanticResultEnvelope(source);
    await digestStarted;
    source.identity.repositoryId = "late-replacement";
    source.response.criteria[0]!.explanation = "late replacement";
    source.bindingHash = HASH_C;
    release();

    const validated = await validating;
    expect(canonicalJson(validated)).toBe(original);
    expect(isRecursivelyFrozen(validated)).toBe(true);
  });

  it("rejects hostile plain-data shapes without evaluating getters or toJSON", async () => {
    const getterCalls = { count: 0 };
    const toJsonCalls = { count: 0 };
    const topLevelGetter = input() as unknown as Record<string, unknown>;
    Object.defineProperty(topLevelGetter, "completedAt", { enumerable: true, get() { getterCalls.count += 1; return "2026-10-05T00:00:00.123457Z"; } });

    const nestedGetter = input();
    Object.defineProperty(nestedGetter.response.criteria[0]!, "explanation", { enumerable: true, get() { getterCalls.count += 1; return "sensitive text"; } });

    const toJson = input() as unknown as Record<string, unknown>;
    Object.defineProperty(toJson, "toJSON", { enumerable: true, value() { toJsonCalls.count += 1; return {}; } });

    const hidden = input() as unknown as Record<string, unknown>;
    Object.defineProperty(hidden.identity!, "hidden", { enumerable: false, value: "sensitive text" });

    const symbol = input() as unknown as Record<string | symbol, unknown>;
    Object.defineProperty(symbol, Symbol("hidden"), { enumerable: true, value: "sensitive text" });

    const undefinedField = { ...input(), extra: undefined };
    const nonFinite = { ...input(), extra: Number.POSITIVE_INFINITY };
    const malformedUnicode = { ...input(), extra: "bad\ud800" };
    const unsupportedObject = { ...input(), extra: new Date("2026-10-05T00:00:00Z") };
    const sparse = input();
    delete sparse.response.criteria[1];
    const circular = input() as OwnershipSemanticResultInput & { extra?: unknown };
    circular.extra = circular;

    const invalidValues: unknown[] = [topLevelGetter, nestedGetter, toJson, hidden, symbol, undefinedField, nonFinite, malformedUnicode, unsupportedObject, sparse, circular];
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest");
    for (const invalid of invalidValues) {
      await expect(buildOwnershipSemanticResultEnvelope(invalid as OwnershipSemanticResultInput)).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: "Ownership semantic result input is invalid",
      });
    }
    expect(getterCalls.count).toBe(0);
    expect(toJsonCalls.count).toBe(0);
    expect(digestSpy).not.toHaveBeenCalled();
    expect(OwnershipSemanticResultError).toBeDefined();
  });

  it("accepts a self-consistent candidate only as structure, not as exact prepared-response approval", async () => {
    const forgedInput = input();
    forgedInput.response.criteria[0]!.evidenceIds = ["evidence-not-in-the-prepared-rubric"];
    forgedInput.response.criteria[0]!.explanation = "Self-created, shape-valid text with no prepared-response proof.";
    const candidate = await buildOwnershipSemanticResultEnvelope(forgedInput);
    const checked = await validateOwnershipSemanticResultEnvelope(candidate);
    expect(checked.response.criteria[0]!.evidenceIds).toEqual(["evidence-not-in-the-prepared-rubric"]);
    expect(checked.responseDigest).toBe(responseDigestReference(checked.response));
    // A caller still needs the exact prepared-reference validator and publication gates.
  });
});
