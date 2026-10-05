import { describe, expect, it } from "vitest";
import { canonicalJson, ownershipOrderingEngineSchema, ownershipQuestionBindingBasisSchema, ownershipQuestionBindingRecordSchema } from "./index.js";

const digest = "a".repeat(64), time = "2026-10-05T00:00:00.000Z";
const engine = { implementationVersion: "js-localeCompare/1.0.0", nodeVersion: "24", v8Version: "13", icuVersion: "77", unicodeVersion: "16", cldrVersion: "47",
  hostRuntime: "node", electronVersion: null, locale: "en-US", usage: "sort", sensitivity: "variant", ignorePunctuation: false, collation: "default", numeric: false, caseFirst: "false" };
const basis = { generatorVersion: "1.0.0", orderingVersion: "completedAt-attemptId-locale/1.0.0", orderingEngine: engine,
  request: { repositoryId: "repo", snapshotId: "snap", count: 5, scope: { kind: "project" } }, candidateIndex: 0, generatorInputHash: digest,
  historyCut: { maxAttemptRowid: 0 }, matchingHistoryProjectionHash: digest, retryWitness: null,
  publicationSource: { activation: time, analysisResultFingerprint: null, configurationHash: digest, ignorePolicyHash: null, sourceManifestHash: digest, ignoreRevision: 0 }, createdAt: time };
const common = { version: "1.0.0", attemptId: "attempt", repositoryId: "repo", snapshotId: "snap", questionId: "q", questionVersion: "2.0.0", questionFingerprint: digest, attemptHash: digest, capsuleHash: digest };
describe("local ownership question binding contracts", () => {
  it("strict source-only union and bounded explicit basis", () => {
    expect(ownershipQuestionBindingRecordSchema.parse({ ...common, status: "verified-generator", questionPreimage: "{}", basis })).toMatchObject({ status: "verified-generator" });
    expect(ownershipQuestionBindingRecordSchema.parse({ ...common, status: "unavailable", reason: "untrusted-issuance" })).toMatchObject({ reason: "untrusted-issuance" });
    for (const extra of [{ permission: true }, { currentness: "current" }, { callback: "trusted" }, { providerId: "provider" }]) {
      expect(ownershipQuestionBindingRecordSchema.safeParse({ ...common, status: "unavailable", reason: "untrusted-issuance", ...extra }).success).toBe(false);
    }
    expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, analysisIdentity: {} }).success).toBe(false);
    expect(ownershipQuestionBindingRecordSchema.safeParse({ ...common, status: "unavailable", reason: "sql-error" }).success).toBe(false);
  });
  it("UTF8 budgets and safe history cut, count and index", () => {
    expect(ownershipQuestionBindingRecordSchema.safeParse({ ...common, status: "verified-generator", questionPreimage: "中".repeat(43691), basis }).success).toBe(false);
    expect(ownershipQuestionBindingRecordSchema.safeParse({ ...common, questionId: "中".repeat(700), status: "unavailable", reason: "question-budget-exceeded" }).success).toBe(false);
    expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, request: { ...basis.request, conceptId: "中".repeat(3000) } }).success).toBe(false);
    for (const n of [-1, .5, Number.MAX_SAFE_INTEGER + 1]) expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, historyCut: { maxAttemptRowid: n } }).success).toBe(false);
    expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, candidateIndex: 20 }).success).toBe(false);
    expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, request: { ...basis.request, count: 100 }, candidateIndex: 20 }).success).toBe(true);
    expect(ownershipQuestionBindingBasisSchema.safeParse({ ...basis, request: { ...basis.request, count: 0 } }).success).toBe(false);
    expect(canonicalJson(ownershipQuestionBindingBasisSchema.parse(basis))).toBe(canonicalJson(basis));
  });
  it("full collator/engine is required and host fields must agree", () => {
    expect(ownershipOrderingEngineSchema.safeParse(engine).success).toBe(true);
    expect(ownershipOrderingEngineSchema.safeParse({ ...engine, icuVersion: undefined }).success).toBe(false);
    expect(ownershipOrderingEngineSchema.safeParse({ ...engine, hostRuntime: "electron" }).success).toBe(false);
    expect(ownershipOrderingEngineSchema.safeParse({ ...engine, electronVersion: "44" }).success).toBe(false);
  });
});
