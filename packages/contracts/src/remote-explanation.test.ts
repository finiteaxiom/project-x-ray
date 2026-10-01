import { describe, expect, it } from "vitest";
import { remoteKeySchema, remotePathSchema, remoteIdSchema, remoteQuerySchema, remoteModelSchema, remoteRevisionSchema, remoteAnalysisIdentitySchema, remoteNarrativeSchema, remoteNarrativeJsonSchema, remoteAuthorizationSchema, remoteProviderStateSchema, remoteTaskIdentitySchema, remoteUtf8Bytes } from "./remote-explanation.js";
const response = () => ({ version: "1.0.0", repositoryId: "repo", snapshotId: "snapshot", packageId: "a".repeat(64), claims: [{ text: "inferred statement", evidenceIds: ["proof"], confidence: "inferred" }], unknowns: [] });
describe("remote contracts, no existing API wiring", () => {
  it("uses strict bounded narrative schemas and never accepts verified", () => {
    expect(remoteNarrativeSchema.parse(response())).toEqual(response());
    expect(remoteNarrativeSchema.safeParse({ ...response(), source: "model" }).success).toBe(false);
    expect(remoteNarrativeSchema.safeParse({ ...response(), claims: [{ ...response().claims[0], confidence: "verified" }] }).success).toBe(false);
  });
  it.each(["claims", "unknowns"])("bounds %s count and text", field => {
    const item = field === "claims" ? response().claims[0]! : { text: "x", evidenceIds: [] };
    expect(remoteNarrativeSchema.safeParse({ ...response(), [field]: Array(13).fill(item) }).success).toBe(false);
    expect(remoteNarrativeSchema.safeParse({ ...response(), [field]: [{ ...item, text: "x".repeat(1201) }] }).success).toBe(false);
    expect(remoteNarrativeSchema.safeParse({ ...response(), [field]: [{ ...item, evidenceIds: Array(9).fill("p") }] }).success).toBe(false);
  });
  it("bounds IDs, queries and model identifiers without trimming", () => {
    expect(remoteIdSchema.safeParse("a".repeat(129)).success).toBe(false); expect(remoteQuerySchema.safeParse(" ").success).toBe(false); expect(remoteQuerySchema.safeParse("x".repeat(1001)).success).toBe(false);
    for (const model of ["ft:custom", "https://evil.test", "m".repeat(129), "model\n"]) expect(remoteModelSchema.safeParse(model).success).toBe(false);
    expect(remoteModelSchema.parse("explicit-model-1")).toBe("explicit-model-1");
  });
  it("limits key by UTF8 bytes within Windows native blob capacity, no truncation", () => {
    expect(remoteKeySchema.parse("k".repeat(2048))).toHaveLength(2048); expect(remoteKeySchema.safeParse("k".repeat(2049)).success).toBe(false);
    expect(remoteUtf8Bytes("中".repeat(683))).toBe(2049); expect(remoteKeySchema.safeParse("中".repeat(683)).success).toBe(false);
    for (const key of ["key\n", "two words", "\0key"]) expect(remoteKeySchema.safeParse(key).success).toBe(false);
  });
  it.each(["../a", "a/../b", "/a", "C:/a", "a\\b", "a//b", "a\0b", "a/./b"])("rejects unsafe path %j", path => expect(remotePathSchema.safeParse(path).success).toBe(false));
  it("has bounded record keys/revisions and preserves only versioned analysis identity", () => {
    const identity = { graphIrVersion: "1.3.0", analyzerVersions: {}, configurationHash: "a".repeat(64), sourceFingerprint: "b".repeat(64), ignorePolicy: null, analysisResult: { version: "1.0.0", fingerprint: "c".repeat(64) } };
    expect(remoteAnalysisIdentitySchema.parse(identity)).toEqual(identity);
    expect(remoteAnalysisIdentitySchema.safeParse({ ...identity, analyzerVersions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, "1"])) }).success).toBe(false);
    expect(remoteAnalysisIdentitySchema.safeParse({ ...identity, rootPath: "private" }).success).toBe(false); expect(remoteRevisionSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });
  it("exposes only boolean credential status and rejects key/provider switches", () => {
    const state = { provider: "openai", model: null, revision: 0, configured: false, availability: "available" };
    expect(remoteProviderStateSchema.parse(state)).toEqual(state); expect(remoteProviderStateSchema.safeParse({ ...state, key: "never" }).success).toBe(false); expect(remoteProviderStateSchema.safeParse({ ...state, provider: "mock" }).success).toBe(false);
  });
  it("does not allow another purpose, arbitrary disclosure or oversized scopes", () => {
    const authorization = { version: "1.0.0", repositoryId: "repo", provider: "openai", scope: ["feature-explanation"], disclosureVersion: "1.0.0", revision: 1, status: "granted", categories: ["query"], grantedAt: "2026-10-01T00:00:00.000Z", revokedAt: null };
    expect(remoteAuthorizationSchema.safeParse(authorization).success).toBe(true); expect(remoteAuthorizationSchema.safeParse({ ...authorization, scope: ["ownership-grade"] }).success).toBe(false); expect(remoteAuthorizationSchema.safeParse({ ...authorization, categories: Array(7).fill("query") }).success).toBe(false);
    expect(remoteTaskIdentitySchema.safeParse({ taskId: "anything" }).success).toBe(false);
  });
  it("JSON schema recursively requires every field, forbids extras and bounds every string/array", () => {
    function inspect(raw: unknown): void { const schema = raw as Record<string, unknown>; if (schema.type === "object") { const props = schema.properties as Record<string, unknown>; expect(schema.additionalProperties).toBe(false); expect(schema.required).toEqual(Object.keys(props)); Object.values(props).forEach(inspect); } if (schema.type === "array") { expect(schema.maxItems).toBeGreaterThan(0); expect(typeof schema.minItems).toBe("number"); inspect(schema.items); } if (schema.type === "string") expect(schema.pattern || schema.enum).toBeTruthy(); }
    inspect(remoteNarrativeJsonSchema);
  });
});
