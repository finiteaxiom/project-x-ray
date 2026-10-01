import { describe, expect, it } from "vitest";
import { remoteKeySchema, remotePathSchema, remoteIdSchema, remoteQuerySchema, remoteModelSchema, remoteRevisionSchema, remoteAnalysisIdentitySchema, remoteNarrativeSchema, remoteNarrativeJsonSchema, remoteAuthorizationSchema, remoteProviderStateSchema, remoteTaskIdentitySchema, remoteUtf8Bytes } from "./remote-explanation.js";
import { remoteActivationSchema, remoteCapturedIdentitySchema, remoteContextSchema, remotePrepareRequestSchema, remoteStartRequestSchema, remoteProviderSettingsSchema, remoteResultSchema, remoteTaskRecordSchema, remotePersistentTaskRecordSchema } from "./remote-explanation.js";
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

const uuid = "00000000-0000-4000-8000-000000000001";
const activation = { repositoryId: "repo", snapshotId: "snapshot", activation: "2026-10-01T00:00:00.000Z", analysisResultFingerprint: "a".repeat(64), configurationHash: "b".repeat(64), ignorePolicyHash: null, sourceManifestHash: "c".repeat(64) };
const captured = () => ({ ...activation, protocolVersion: "1.0.0", taskId: uuid, ignoreRevision: 0, authorizationRevision: 0, providerRevision: 0, credentialRevision: 0, contextEpoch: 1, contextHandle: uuid, ownerSessionId: uuid, packageId: "a".repeat(64), bodyDigest: "d".repeat(64), limitsVersion: "1.0.0" });
const persisted = () => ({ version: "1.0.0", identity: captured(), narrative: response(), checkedAt: activation.activation, completedAt: activation.activation,
  localUnknowns: [], localLimitations: ["static only"], localTruncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 },
  citations: [{ id: "proof", kind: "call-expression", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 }, analyzer: "test", analyzerVersion: "1", confidence: "verified", contentHash: "a".repeat(64), sliceSpan: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 } }], unknownEvidenceIds: [] });
describe("remote application and persistence boundaries", () => {
  it("strict captured identity includes source/configuration/activation/context/credential/body versions", () => {
    expect(remoteCapturedIdentitySchema.safeParse(captured()).success).toBe(true);
    for (const field of ["activation", "configurationHash", "ignorePolicyHash", "sourceManifestHash", "credentialRevision", "contextHandle", "bodyDigest"] as const) {
      const value: Record<string, unknown> = captured(); delete value[field]; expect(remoteCapturedIdentitySchema.safeParse(value).success).toBe(false);
    }
    expect(remoteActivationSchema.safeParse({ ...activation, activation: "raw failure" }).success).toBe(false);
  });
  it("context active/ref coherence and epoch bounds are mandatory; no arbitrary owner fields on requests", () => {
    const context = { ownerSessionId: uuid, contextHandle: uuid, epoch: 1, active: true, reference: activation };
    expect(remoteContextSchema.safeParse(context).success).toBe(true);
    expect(remoteContextSchema.safeParse({ ...context, reference: null }).success).toBe(false);
    expect(remoteContextSchema.safeParse({ ...context, active: false }).success).toBe(false);
    expect(remoteContextSchema.safeParse({ ...context, epoch: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    const request = { repositoryId: "repo", snapshotId: "snapshot", contextHandle: uuid, query: "query", purpose: "feature-explanation" };
    expect(remotePrepareRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [{ ownerSessionId: uuid }, { epoch: 1 }, { evidencePackage: {} }, { credential: "value" }]) expect(remotePrepareRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    const start = { contextHandle: uuid, previewId: uuid, packageId: "a".repeat(64), taskId: uuid };
    expect(remoteStartRequestSchema.safeParse(start).success).toBe(true); expect(remoteStartRequestSchema.safeParse({ ...start, expectedRevision: 0 }).success).toBe(false);
  });
  it("non-secret provider settings cannot contain key/env/endpoint, allow only bounded tokens and revisions", () => {
    const settings = { provider: "openai", model: null, revision: 0, credentialRevision: 0, credentialStatus: "unconfigured", outputTokens: 2048 };
    expect(remoteProviderSettingsSchema.safeParse(settings).success).toBe(true);
    for (const extra of [{ key: "value" }, { endpoint: "https://example.test" }, { env: "key" }]) expect(remoteProviderSettingsSchema.safeParse({ ...settings, ...extra }).success).toBe(false);
    for (const tokens of [0, 2049, 1.2]) expect(remoteProviderSettingsSchema.safeParse({ ...settings, outputTokens: tokens }).success).toBe(false);
  });
  it("task phases have exactly one bounded terminal code/time and never store failure text", () => {
    const task = { identity: captured(), phase: "dispatched", createdAt: activation.activation, completedAt: null, code: null };
    expect(remoteTaskRecordSchema.safeParse(task).success).toBe(true);
    expect(remoteTaskRecordSchema.safeParse({ ...task, phase: "completed" }).success).toBe(false);
    expect(remoteTaskRecordSchema.safeParse({ ...task, phase: "failed", completedAt: activation.activation, code: "TIMEOUT" }).success).toBe(true);
    expect(remoteTaskRecordSchema.safeParse({ ...task, phase: "failed", completedAt: activation.activation, code: "raw key/private source" }).success).toBe(false);
    expect(remoteTaskRecordSchema.safeParse({ ...task, error: "raw source" }).success).toBe(false);
  });
  it("preparing is strict transient metadata, never a persisted permission or a terminal", () => {
    const task = { identity: captured(), phase: "preparing", createdAt: activation.activation, completedAt: null, code: null };
    expect(remoteTaskRecordSchema.safeParse(task).success).toBe(true); expect(remotePersistentTaskRecordSchema.safeParse(task).success).toBe(false);
    expect(remoteTaskRecordSchema.safeParse({ ...task, completedAt: activation.activation, code: "CANCELLED" }).success).toBe(false);
    expect(remoteTaskRecordSchema.safeParse({ ...task, credential: "value" }).success).toBe(false);
    expect(remotePersistentTaskRecordSchema.safeParse({ ...task, phase: "cancelled", completedAt: activation.activation, code: "CANCELLED" }).success).toBe(true);
  });
  it("persisted narrative and exact source references are strict and closed, no source/body/key fields", () => {
    expect(remoteResultSchema.safeParse(persisted()).success).toBe(true);
    for (const extra of [{ evidencePackage: {} }, { key: "value" }, { responseBody: "text" }]) expect(remoteResultSchema.safeParse({ ...persisted(), ...extra }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), citations: [{ ...persisted().citations[0], snippet: "raw source" }] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), narrative: { ...response(), repositoryId: "other" } }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), citations: [] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), citations: [{ ...persisted().citations[0], sliceSpan: { ...persisted().citations[0]!.sliceSpan, endColumn: 2 } }] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), narrative: { ...response(), claims: [{ ...response().claims[0], evidenceIds: ["proof", "proof"] }] } }).success).toBe(false);
  });
  it("unknown evidence from either proof or edge cannot become an inferred persistent claim", () => {
    expect(remoteResultSchema.safeParse({ ...persisted(), unknownEvidenceIds: ["proof"] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), citations: [{ ...persisted().citations[0], confidence: "unknown" }] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), unknownEvidenceIds: ["outside"] }).success).toBe(false);
    expect(remoteResultSchema.safeParse({ ...persisted(), unknownEvidenceIds: ["proof"], narrative: { ...response(), claims: [{ ...response().claims[0], confidence: "unknown" }] } }).success).toBe(true);
  });
});
