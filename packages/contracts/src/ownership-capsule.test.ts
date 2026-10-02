import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  computeOwnershipAttemptHash, computeOwnershipCapsuleHash, computeOwnershipQuestionFingerprint, computeOwnershipSubmissionProjectionHash,
  digestOwnershipPreimage, ownershipAttemptPreimage, ownershipCapsulePreimage, ownershipCapsuleSchema, ownershipNotEvaluatedCapsuleSchema,
  ownershipQuestionPreimage, ownershipSubmissionProjectionPreimage, validateOwnershipCapsule,
  type OwnershipCapsuleContent, type OwnershipSubmissionProjection,
} from "./ownership-capsule.js";
import { canonicalJson } from "./snapshot-content.js";
import { remoteUtf8Bytes } from "./remote-explanation.js";
import type { OwnershipAttempt, OwnershipQuestion } from "./index.js";

const hash = "a".repeat(64);
const question: OwnershipQuestion = { repositoryId: "r", snapshotId: "s", id: "q", version: "2.0.0", kind: "entry", prompt: "定位定义", concept: { id: "definition:n", label: "定义" }, learningObjective: "定位", difficulty: "easy", choices: [{ nodeId: "n", label: "名字", detail: "函数" }], evidenceIds: ["proof"], expectedNodeIds: ["n"], deterministicChecks: [{ kind: "definition", nodeId: "n", edgeId: "edge" }], variantKey: "definition:edge" };
const citation = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3, evidenceId: "proof" };
const attempt: OwnershipAttempt = { repositoryId: "r", snapshotId: "s", attemptId: "attempt", questionId: "q", questionVersion: "2.0.0", concept: question.concept, questionKind: "entry", variantKey: question.variantKey, structuredAnswer: { kind: "entry", nodeId: "n" }, citations: [citation], locationScore: 100, structureScore: 100, passed: true, scoringVersion: "2.1.0", semanticText: "中文与🙂", completedAt: "2026-10-02T00:00:00.000Z", legacy: false };
const identity = { activation: null, analysisResultFingerprint: null, configurationHash: null, ignorePolicyHash: null, sourceManifestHash: null, ignoreRevision: null };
async function capsule() {
  const content: OwnershipCapsuleContent = { version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason: "analysis-identity-unavailable", questionFingerprint: await computeOwnershipQuestionFingerprint(question), attemptHash: await computeOwnershipAttemptHash(attempt), answerHash: null, submissionProjectionHash: null, sourceIdentity: identity };
  return { ...content, capsuleHash: await computeOwnershipCapsuleHash(content) };
}
const nodeDigest = (preimage: string) => createHash("sha256").update(preimage, "utf8").digest("hex");
describe("ownership capsule contract and canonical preimages", () => {
  it("Node 同步与 WebCrypto 消费同一 UTF-8 preimage，包括中文/代理对/数组顺序", async () => {
    const value = await capsule();
    const projection: OwnershipSubmissionProjection = { originalCitations: [citation, citation], originalStructuredAnswer: { kind: "entry", nodeId: "n" }, citationOrder: [0, 0], roleBindings: [], normalizedStructuredAnswer: { kind: "entry", nodeId: "n" }, validatedCitations: [citation] };
    for (const [preimage, compute] of [
      [ownershipQuestionPreimage(question), () => computeOwnershipQuestionFingerprint(question)],
      [ownershipAttemptPreimage(attempt), () => computeOwnershipAttemptHash(attempt)],
      [ownershipCapsulePreimage(value), () => computeOwnershipCapsuleHash(value)],
      [ownershipSubmissionProjectionPreimage(projection), () => computeOwnershipSubmissionProjectionHash(projection)],
    ] as const) {
      expect(await compute()).toBe(nodeDigest(preimage)); expect(await digestOwnershipPreimage(preimage)).toBe(nodeDigest(preimage));
      expect(preimage).toBe(canonicalJson(JSON.parse(preimage)));
    }
    // Fixed vectors detect domain/preimage drift independently of the two digest implementations.
    expect([nodeDigest(ownershipQuestionPreimage(question)), nodeDigest(ownershipAttemptPreimage(attempt)), nodeDigest(ownershipSubmissionProjectionPreimage(projection))]).toEqual(["19fc65324a6cf4a33bc3639221d92d0228845e57f1cccccd4d6152df4c8c63b8", "1b059796f1b03477c5b8f4095fa9dd35da2fc8aeb23c5a8fb6fec659036d8088", "bb0375712cecb68f5d5c347a75ffe2b5a20841bb8dac887f4c5d3d7f6e355e58"]);
  });
  it("哈希包含完整题目、完整尝试与完整引用投影，不裁剪大型旧合法字段", async () => {
    const original = await computeOwnershipQuestionFingerprint(question);
    for (const changed of [
      { ...question, prompt: question.prompt + "!" }, { ...question, choices: [...question.choices, { nodeId: "x", label: "x", detail: "x" }] },
      { ...question, variantKey: "v".repeat(5275) }, { ...question, deterministicChecks: [{ kind: "definition" as const, nodeId: "n", edgeId: "changed" }] },
    ]) expect(await computeOwnershipQuestionFingerprint(changed)).not.toBe(original);
    const before = await computeOwnershipAttemptHash(attempt);
    for (const changed of [{ ...attempt, completedAt: "2026-10-02T00:00:01.000Z" }, { ...attempt, locationScore: 0 }, { ...attempt, semanticText: "\ud800" }, { ...attempt, citations: [citation, citation] }]) expect(await computeOwnershipAttemptHash(changed)).not.toBe(before);
    const reordered = Object.fromEntries(Object.entries(question).reverse()) as OwnershipQuestion; expect(await computeOwnershipQuestionFingerprint(reordered)).toBe(original);
    const projection: OwnershipSubmissionProjection = { originalCitations: [citation], originalStructuredAnswer: { kind: "entry", nodeId: "n" }, citationOrder: [0], roleBindings: [], normalizedStructuredAnswer: { kind: "entry", nodeId: "n" }, validatedCitations: [citation] };
    expect(await computeOwnershipSubmissionProjectionHash({ ...projection, citationOrder: [0, 0] })).not.toBe(await computeOwnershipSubmissionProjectionHash(projection));
  });
  it("not-evaluated 是独立严格分支，nullable 身份保持原值，理论最大记录小于 2KiB", async () => {
    const maximum = { version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason: "analysis-identity-unavailable", questionFingerprint: hash, attemptHash: hash, capsuleHash: hash, answerHash: hash, submissionProjectionHash: hash, sourceIdentity: { activation: "2026-10-02T00:00:00.00000000000Z", analysisResultFingerprint: hash, configurationHash: hash, ignorePolicyHash: hash, sourceManifestHash: hash, ignoreRevision: Number.MAX_SAFE_INTEGER } };
    expect(ownershipNotEvaluatedCapsuleSchema.safeParse(maximum).success).toBe(true);
    expect(remoteUtf8Bytes(canonicalJson(maximum))).toBe(992);
    const value = await capsule(); expect(ownershipCapsuleSchema.parse(value).sourceIdentity).toEqual(identity);
    for (const extra of [{ repositoryId: "r" }, { variantKey: "v".repeat(5275) }, { citations: [citation] }, { rubric: {} }, { createdAt: attempt.completedAt }]) expect(ownershipCapsuleSchema.safeParse({ ...value, ...extra }).success).toBe(false);
    expect(ownershipCapsuleSchema.safeParse({ ...value, sourceIdentity: { ...identity, unknown: "source" } }).success).toBe(false);
    expect(ownershipCapsuleSchema.safeParse({ ...value, reason: "arbitrary raw error" }).success).toBe(false);
  });
  it("供给记录绑定与分支签名验证，未知异常固定化且 capsuleHash 不进入自身 preimage", async () => {
    const value = await capsule(); expect(await validateOwnershipCapsule(value, question, attempt)).toEqual(value);
    expect(await computeOwnershipCapsuleHash({ ...value, capsuleHash: "b".repeat(64) })).toBe(value.capsuleHash);
    await expect(validateOwnershipCapsule({ ...value, reason: "answer-budget-exceeded" }, question, attempt)).rejects.toThrow("所有权语义准备失败");
    await expect(validateOwnershipCapsule(value, { ...question, variantKey: "changed" }, attempt)).rejects.toThrow("所有权语义准备失败");
    await expect(validateOwnershipCapsule(value, question, { ...attempt, semanticText: "changed" })).rejects.toThrow("所有权语义准备失败");
    await expect(validateOwnershipCapsule({ private: "private source content" }, question, attempt)).rejects.toThrow("所有权语义准备失败");
    expect(ownershipCapsuleSchema.safeParse({ ...value, capsuleHash: "A".repeat(64) }).success).toBe(false);
  });
  it.each(["repositoryId", "snapshotId", "id", "version", "kind", "variantKey"] as const)("降级分支完整摘要不能掩盖题目-尝试 %s 错配", async field => {
    const changed = { ...question, [field]: field === "kind" ? "call-direction" : field === "version" ? "1.0.0" : "other" } as OwnershipQuestion;
    const value = await capsule(); value.questionFingerprint = await computeOwnershipQuestionFingerprint(changed); value.capsuleHash = await computeOwnershipCapsuleHash(value);
    await expect(validateOwnershipCapsule(value, changed, attempt)).rejects.toThrow("所有权语义准备失败");
  });
  it("明确暂停首个摘要：迟到替换不能改验证目标，原匹配输入不被后改污染", async () => {
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    for (const initiallyMatches of [false, true]) {
      const callerAttempt = structuredClone(attempt), callerQuestion = structuredClone(question), other = { ...attempt, attemptId: "other-attempt" }, value = await capsule();
      if (!initiallyMatches) { value.attemptHash = await computeOwnershipAttemptHash(other); value.capsuleHash = await computeOwnershipCapsuleHash(value); }
      const callerCapsule = structuredClone(value);
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
      const spy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementationOnce(async (...args) => { entered(); await gate; return originalDigest(...args); });
      try {
        const pending = validateOwnershipCapsule(callerCapsule, callerQuestion, callerAttempt); await started;
        Object.assign(callerAttempt, other); callerQuestion.variantKey = "after-await"; callerCapsule.capsuleHash = "b".repeat(64); release();
        if (initiallyMatches) expect(await pending).toEqual(value); else await expect(pending).rejects.toThrow("所有权语义准备失败");
      } finally { release(); spy.mockRestore(); }
    }
  });
  it("公开 validator 捕获不执行 getter，也不静默丢符号/不可枚举字段", async () => {
    const value = await capsule(); let read = false;
    const accessor = structuredClone(attempt); Object.defineProperty(accessor, "semanticText", { enumerable: true, get: () => { read = true; return attempt.semanticText; } });
    await expect(validateOwnershipCapsule(value, question, accessor)).rejects.toThrow("所有权语义准备失败"); expect(read).toBe(false);
    const symbol = structuredClone(attempt); Object.defineProperty(symbol, Symbol("hidden"), { value: "hidden" });
    await expect(validateOwnershipCapsule(value, question, symbol)).rejects.toThrow("所有权语义准备失败");
    const hidden = structuredClone(attempt); Object.defineProperty(hidden, "hidden", { value: "hidden", enumerable: false });
    await expect(validateOwnershipCapsule(value, question, hidden)).rejects.toThrow("所有权语义准备失败");
  });
});
