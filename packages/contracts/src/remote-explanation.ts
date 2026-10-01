import { z } from "zod";

export const EVIDENCE_PACKAGE_VERSION = "1.0.0";
export const REMOTE_EXPLANATION_VERSION = "1.0.0";
export const REMOTE_POLICY_VERSION = "1.0.0";
export const EXPLANATION_TASK_PROTOCOL_VERSION = "1.0.0";
export const REMOTE_LIMITS = Object.freeze({ requestBytes: 65536, responseBytes: 262144, textBytes: 65536, sourceBytes: 24576, snippetBytes: 4096, snippetLines: 40, proofs: 24, nodes: 24, edges: 40, networkMs: 60000, taskMs: 90000, outputTokens: 2048 });

export const remoteUtf8Bytes = (value: string): number => new TextEncoder().encode(value).length;
function text(min: number, max: number, bytes = max * 4) {
  return z.string().min(min).max(max).regex(new RegExp(`^[\\s\\S]{${min},${max}}$`, "u")).refine(value => remoteUtf8Bytes(value) <= bytes, "字段字节超限");
}
export const remoteIdSchema = text(1, 128, 512);
export const remoteHashSchema = z.string().length(64).regex(/^[0-9a-f]{64}$/);
export const remoteTextSchema = text(1, 1200, 4800);
export const remoteQuerySchema = text(1, 1000, 4096).refine(value => value.trim().length > 0, "查询不能为空");
export const remoteModelSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]{1,128}$/);
export const remoteKeySchema = text(1, 2048, 2048).refine(value => !/[\u0000-\u0020\u007f-\u009f]/u.test(value), "密钥格式无效");
export const remoteCountSchema = z.number().int().min(0).max(2147483647);
export const remoteRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const versionText = text(1, 64, 256);
const confidence = z.enum(["verified", "inferred", "unknown"]);
export const remotePurposeSchema = z.literal("feature-explanation");
export const remoteDataCategorySchema = z.enum(["query", "relative-paths-and-symbols", "relationships", "source-snippets", "evidence-identities", "analysis-limitations"]);
export const remoteTruncationSchema = z.enum(["node-limit", "edge-limit", "proof-limit", "snippet-limit", "source-byte-limit", "package-byte-limit", "unknown-limit", "limitation-limit", "failure-limit", "unsupported-field", "query-truncated"]);
export const remotePathSchema = text(1, 1024, 4096).refine(value => !value.includes("\\") && !/[\u0000-\u001f\u007f]/u.test(value) && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== ".."), "必须为受限相对路径");
export const remoteSpanSchema = z.object({ filePath: remotePathSchema, startLine: remoteCountSchema.min(1), startColumn: remoteCountSchema, endLine: remoteCountSchema.min(1), endColumn: remoteCountSchema }).strict().refine(span => span.endLine > span.startLine || (span.endLine === span.startLine && span.endColumn >= span.startColumn), "范围无效");
export const remoteAnalysisIdentitySchema = z.object({
  graphIrVersion: versionText,
  analyzerVersions: z.record(remoteIdSchema, versionText).refine(value => Object.keys(value).length <= 8, "分析器数量超限"),
  configurationHash: remoteHashSchema, sourceFingerprint: remoteHashSchema,
  ignorePolicy: z.object({ version: versionText, hash: remoteHashSchema }).strict().nullable(),
  analysisResult: z.object({ version: z.literal("1.0.0"), fingerprint: remoteHashSchema }).strict(),
}).strict();
export const remoteNodeSchema = z.object({ id: remoteIdSchema, name: text(1, 256, 1024), kind: z.enum(["repository", "module", "file", "function", "class", "method", "variable", "endpoint", "external-dependency", "unresolved-call", "unsupported-semantic"]), filePath: remotePathSchema.nullable(), evidenceIds: z.array(remoteIdSchema).min(1).max(8) }).strict();
export const remoteEdgeSchema = z.object({ id: remoteIdSchema, source: remoteIdSchema, target: remoteIdSchema, kind: z.enum(["CONTAINS", "DEFINES", "IMPORTS", "EXPORTS", "DEPENDS_ON", "CALLS", "READS", "WRITES", "RETURNS", "PASSES_TO", "HANDLES", "EMITS", "PERSISTS", "QUERIES", "CHANGED", "MAY_AFFECT", "DERIVED_FROM"]), evidenceId: remoteIdSchema, confidence, reason: remoteTextSchema }).strict();
export const remoteProofSchema = z.object({ id: remoteIdSchema, kind: z.enum(["file", "symbol-definition", "import", "import-binding", "call-expression", "argument-flow", "return-flow", "variable-read", "variable-write", "react-event", "http-route", "python-route", "git-diff", "configuration", "heuristic"]), span: remoteSpanSchema, analyzer: remoteIdSchema, analyzerVersion: versionText, confidence, contentHash: remoteHashSchema, snippet: text(0, REMOTE_LIMITS.snippetBytes, REMOTE_LIMITS.snippetBytes), sliceSpan: remoteSpanSchema }).strict();
export const evidencePackageSchema = z.object({
  version: z.literal(EVIDENCE_PACKAGE_VERSION), repositoryId: remoteIdSchema, snapshotId: remoteIdSchema, packageId: remoteHashSchema, purpose: remotePurposeSchema, query: remoteQuerySchema,
  analysisIdentity: remoteAnalysisIdentitySchema, nodes: z.array(remoteNodeSchema).min(1).max(24), edges: z.array(remoteEdgeSchema).max(40), proofs: z.array(remoteProofSchema).min(1).max(24),
  pathEdgeIds: z.array(remoteIdSchema).max(24), unknowns: z.array(remoteTextSchema).max(24), limitations: z.array(remoteTextSchema).max(24),
  health: z.object({ status: z.enum(["ready", "partial"]), failedCount: remoteCountSchema, failures: z.array(z.object({ filePath: remotePathSchema, code: z.enum(["analysis-failed", "unavailable", "unsupported"]) }).strict()).max(24) }).strict(),
  truncation: z.object({ reasons: z.array(remoteTruncationSchema).max(12), omittedNodes: remoteCountSchema, omittedEdges: remoteCountSchema, omittedProofs: remoteCountSchema, omittedUnknowns: remoteCountSchema, omittedLimitations: remoteCountSchema, omittedFailures: remoteCountSchema }).strict(),
}).strict().superRefine((value, context) => {
  if (value.proofs.reduce((sum, item) => sum + remoteUtf8Bytes(item.snippet), 0) > REMOTE_LIMITS.sourceBytes) context.addIssue({ code: "custom", message: "源码总字节超限" });
  if (remoteUtf8Bytes(JSON.stringify(value)) > REMOTE_LIMITS.requestBytes) context.addIssue({ code: "custom", message: "证据包总字节超限" });
});
const claimSchema = z.object({ text: remoteTextSchema, evidenceIds: z.array(remoteIdSchema).min(1).max(8), confidence: z.enum(["inferred", "unknown"]) }).strict();
export const remoteNarrativeSchema = z.object({ version: z.literal(REMOTE_EXPLANATION_VERSION), repositoryId: remoteIdSchema, snapshotId: remoteIdSchema, packageId: remoteHashSchema, claims: z.array(claimSchema).min(1).max(12), unknowns: z.array(z.object({ text: remoteTextSchema, evidenceIds: z.array(remoteIdSchema).max(8) }).strict()).max(12) }).strict();
// JSON Schema deliberately contains no Zod refinements or provider-specific state.
const jsonText = (min: number, max: number) => ({ type: "string", pattern: `^[\\s\\S]{${min},${max}}$` });
const jsonIds = (min: number) => ({ type: "array", minItems: min, maxItems: 8, items: jsonText(1, 128) });
const jsonObject = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const remoteNarrativeJsonSchema = jsonObject({
  version: { type: "string", enum: [REMOTE_EXPLANATION_VERSION] }, repositoryId: jsonText(1, 128), snapshotId: jsonText(1, 128), packageId: { type: "string", pattern: "^[0-9a-f]{64}$" },
  claims: { type: "array", minItems: 1, maxItems: 12, items: jsonObject({ text: jsonText(1, 1200), evidenceIds: jsonIds(1), confidence: { type: "string", enum: ["inferred", "unknown"] } }) },
  unknowns: { type: "array", minItems: 0, maxItems: 12, items: jsonObject({ text: jsonText(1, 1200), evidenceIds: jsonIds(0) }) },
});
export const remoteFailureCodeSchema = z.enum(["NOT_CONFIGURED", "CREDENTIAL_UNAVAILABLE", "CONSENT_REQUIRED", "CONSENT_REVOKED", "CONTEXT_CHANGED", "SNAPSHOT_NOT_CURRENT", "EVIDENCE_INSUFFICIENT", "LIMIT_EXCEEDED", "BUSY", "TIMEOUT", "CANCELLED", "AUTH_REJECTED", "RATE_LIMITED", "PROVIDER_FAILED", "REFUSED", "INCOMPLETE", "INVALID_RESPONSE", "INTERRUPTED", "POLICY_INVALID", "REVISION_CONFLICT", "PREVIEW_EXPIRED"]);
export type RemoteFailureCode = z.infer<typeof remoteFailureCodeSchema>;
export class RemoteExplanationError extends Error {
  readonly code: RemoteFailureCode;
  constructor(code: RemoteFailureCode) { super("远程解释未完成"); this.name = "RemoteExplanationError"; this.code = remoteFailureCodeSchema.parse(code); }
}
export const remoteProviderStateSchema = z.object({ provider: z.literal("openai"), model: remoteModelSchema.nullable(), revision: remoteRevisionSchema, configured: z.boolean(), availability: z.enum(["available", "unavailable"]) }).strict();
export const remoteAuthorizationSchema = z.object({ version: z.literal(REMOTE_POLICY_VERSION), repositoryId: remoteIdSchema, provider: z.literal("openai"), scope: z.array(remotePurposeSchema).max(1), disclosureVersion: z.literal("1.0.0"), revision: remoteRevisionSchema, status: z.enum(["denied", "granted"]), categories: z.array(remoteDataCategorySchema).max(6), grantedAt: z.string().datetime().max(32).nullable(), revokedAt: z.string().datetime().max(32).nullable() }).strict();
export const remoteTaskIdentitySchema = z.object({ protocolVersion: z.literal(EXPLANATION_TASK_PROTOCOL_VERSION), taskId: z.string().uuid(), repositoryId: remoteIdSchema, snapshotId: remoteIdSchema, analysisResultFingerprint: remoteHashSchema, ignoreRevision: remoteRevisionSchema, authorizationRevision: remoteRevisionSchema, providerRevision: remoteRevisionSchema, contextEpoch: remoteRevisionSchema, ownerSessionId: z.string().uuid(), packageId: remoteHashSchema, limitsVersion: z.literal("1.0.0") }).strict();
export type EvidencePackage = z.infer<typeof evidencePackageSchema>;
export type RemoteNarrative = z.infer<typeof remoteNarrativeSchema>;
export type RemoteProof = z.infer<typeof remoteProofSchema>;
export type RemoteNode = z.infer<typeof remoteNodeSchema>;
export type RemoteEdge = z.infer<typeof remoteEdgeSchema>;
export type RemoteTruncation = z.infer<typeof remoteTruncationSchema>;

// These are application/persistence contracts, separate from the outbound model schema.
export const REMOTE_DATA_CATEGORIES = ["query", "relative-paths-and-symbols", "relationships", "source-snippets", "evidence-identities", "analysis-limitations"] as const;
export const remoteUuidSchema = z.string().length(36).uuid();
export const remoteTimeSchema = z.string().datetime().max(32);
export const remoteRefSchema = z.object({ repositoryId: remoteIdSchema, snapshotId: remoteIdSchema }).strict();
export const remoteProviderSettingsSchema = z.object({
  provider: z.literal("openai"), model: remoteModelSchema.nullable(), revision: remoteRevisionSchema,
  credentialRevision: remoteRevisionSchema, credentialStatus: z.enum(["configured", "unconfigured", "unavailable"]),
  outputTokens: remoteCountSchema.min(1).max(REMOTE_LIMITS.outputTokens),
}).strict();
export const remoteActivationSchema = remoteRefSchema.extend({ activation: remoteTimeSchema, analysisResultFingerprint: remoteHashSchema, configurationHash: remoteHashSchema, ignorePolicyHash: remoteHashSchema.nullable(), sourceManifestHash: remoteHashSchema }).strict();
export const remoteContextSchema = z.object({ ownerSessionId: remoteUuidSchema, contextHandle: remoteUuidSchema, epoch: remoteRevisionSchema, active: z.boolean(), reference: remoteActivationSchema.nullable() }).strict().refine(value => value.active === (value.reference !== null), "上下文状态不一致");
export const remoteCapturedIdentitySchema = remoteTaskIdentitySchema.extend({
  contextHandle: remoteUuidSchema, activation: remoteTimeSchema, configurationHash: remoteHashSchema,
  ignorePolicyHash: remoteHashSchema.nullable(), sourceManifestHash: remoteHashSchema, credentialRevision: remoteRevisionSchema,
  bodyDigest: remoteHashSchema,
}).strict();
export const remotePrepareRequestSchema = remoteRefSchema.extend({ contextHandle: remoteUuidSchema, purpose: remotePurposeSchema, query: remoteQuerySchema }).strict();
export const remoteStartRequestSchema = z.object({ contextHandle: remoteUuidSchema, previewId: remoteUuidSchema, packageId: remoteHashSchema, taskId: remoteUuidSchema }).strict();
export const remoteCancelRequestSchema = z.object({ contextHandle: remoteUuidSchema, taskId: remoteUuidSchema }).strict();
export const remotePreviewSchema = z.object({
  protocolVersion: z.literal(EXPLANATION_TASK_PROTOCOL_VERSION), previewId: remoteUuidSchema, contextHandle: remoteUuidSchema,
  createdAt: remoteTimeSchema, expiresAt: remoteTimeSchema, packageId: remoteHashSchema, bodyDigest: remoteHashSchema.nullable(),
  evidencePackage: evidencePackageSchema, provider: remoteProviderSettingsSchema, authorization: remoteAuthorizationSchema,
  categories: z.array(remoteDataCategorySchema).length(6), localUnknowns: z.array(remoteTextSchema).max(1200), localLimitations: z.array(remoteTextSchema).max(1200),
  sourceBytes: remoteCountSchema.max(REMOTE_LIMITS.sourceBytes), maxRequestBytes: z.literal(65536), maxOutputTokens: remoteCountSchema.min(1).max(2048),
}).strict().superRefine((value, context) => {
  if (value.packageId !== value.evidencePackage.packageId || value.authorization.repositoryId !== value.evidencePackage.repositoryId || new Set(value.categories).size !== 6 || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) context.addIssue({ code: "custom", message: "预览身份无效" });
  if (remoteUtf8Bytes(JSON.stringify(value)) > 262144) context.addIssue({ code: "custom", message: "预览字节超限" });
});
export const remoteTaskRecordSchema = z.object({
  identity: remoteCapturedIdentitySchema, phase: z.enum(["preparing", "dispatched", "completed", "failed", "cancelled", "interrupted"]),
  createdAt: remoteTimeSchema, completedAt: remoteTimeSchema.nullable(), code: remoteFailureCodeSchema.nullable(),
}).strict().refine(value => value.phase === "preparing" || value.phase === "dispatched" ? value.completedAt === null && value.code === null : value.completedAt !== null && (value.phase === "completed" ? value.code === null : value.code !== null), "任务状态不一致");
// Preparing is a transient status, never a persisted permission or an inflight lease.
export const remotePersistentTaskRecordSchema = remoteTaskRecordSchema.refine(value => value.phase !== "preparing", "准备状态不得持久化为许可");
export const remoteResultSchema = z.object({
  version: z.literal(REMOTE_EXPLANATION_VERSION), identity: remoteCapturedIdentitySchema, narrative: remoteNarrativeSchema,
  checkedAt: remoteTimeSchema, completedAt: remoteTimeSchema, localUnknowns: z.array(remoteTextSchema).max(1200), localLimitations: z.array(remoteTextSchema).max(1200),
  localTruncation: evidencePackageSchema.shape.truncation,
  // References can be reopened without persisting source snippets or a whole evidence package.
  citations: z.array(remoteProofSchema.omit({ snippet: true })).min(1).max(24),
  unknownEvidenceIds: z.array(remoteIdSchema).max(24),
}).strict().superRefine((value, context) => {
  const identity = value.identity; const narrative = value.narrative;
  const ids = new Set(value.citations.map(item => item.id));
  if (ids.size !== value.citations.length || narrative.repositoryId !== identity.repositoryId || narrative.snapshotId !== identity.snapshotId || narrative.packageId !== identity.packageId || [...narrative.claims, ...narrative.unknowns].some(item => new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => !ids.has(id)))) context.addIssue({ code: "custom", message: "结果引用不闭合" });
  if (value.citations.some(proof => JSON.stringify(proof.span) !== JSON.stringify(proof.sliceSpan))) context.addIssue({ code: "custom", message: "引用范围不一致" });
  if (new Set(value.unknownEvidenceIds).size !== value.unknownEvidenceIds.length || value.unknownEvidenceIds.some(id => !ids.has(id))) context.addIssue({ code: "custom", message: "未知引用集合无效" });
  const unknownIds = new Set([...value.unknownEvidenceIds, ...value.citations.filter(item => item.confidence === "unknown").map(item => item.id)]);
  if (narrative.claims.some(item => item.confidence !== "unknown" && item.evidenceIds.some(id => unknownIds.has(id)))) context.addIssue({ code: "custom", message: "未知引用不能变为推断" });
  if (remoteUtf8Bytes(JSON.stringify(value)) > 262144) context.addIssue({ code: "custom", message: "结果字节超限" });
});
export const remoteTaskEventSchema = z.object({ protocolVersion: z.literal(EXPLANATION_TASK_PROTOCOL_VERSION), task: remoteTaskRecordSchema }).strict();
export type RemoteProviderSettings = z.infer<typeof remoteProviderSettingsSchema>;
export type RemoteAuthorization = z.infer<typeof remoteAuthorizationSchema>;
export type RemoteActivation = z.infer<typeof remoteActivationSchema>;
export type RemoteContext = z.infer<typeof remoteContextSchema>;
export type RemoteCapturedIdentity = z.infer<typeof remoteCapturedIdentitySchema>;
export type RemotePreview = z.infer<typeof remotePreviewSchema>;
export type RemoteTaskRecord = z.infer<typeof remoteTaskRecordSchema>;
export type RemoteResult = z.infer<typeof remoteResultSchema>;
export type RemotePrepareRequest = z.infer<typeof remotePrepareRequestSchema>;
export type RemoteStartRequest = z.infer<typeof remoteStartRequestSchema>;
