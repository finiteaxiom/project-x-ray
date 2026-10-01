import { z } from "zod";

export const GRAPH_IR_VERSION = "1.3.0";
export const TASK_PROTOCOL_VERSION = "1.1.0";
export const GRAPH_QUERY_VERSION = "1.0.0";
export const MODULE_OVERVIEW_VERSION = "1.0.0";
export const CHANGESET_VERSION = "1.1.0";
export const OWNERSHIP_QUESTION_VERSION = "2.0.0";
export const OWNERSHIP_SCORING_VERSION = "2.1.0";

export const safeDiagnosticCodeSchema = z.enum([
  "FILE_DISCOVERY_FAILED", "FILE_READ_FAILED", "FILE_ACCESS_FAILED", "ANALYSIS_FAILED",
  "TYPESCRIPT_SYNTAX_ERROR", "PYTHON_SYNTAX_ERROR", "PYTHON_ENVIRONMENT_UNAVAILABLE", "PYTHON_ANALYSIS_FAILED", "ANALYSIS_TIMEOUT",
  "SECURE_READER_UNAVAILABLE", "PROJECT_PATH_REJECTED", "SECURE_READ_FAILED", "NATIVE_MODULE_UNAVAILABLE",
  "GIT_COMPARISON_FAILED", "GIT_REPOSITORY_INVALID", "GIT_NO_COMMIT", "GIT_CONFLICT", "GIT_MISSING_BASE", "GIT_PATH_REJECTED", "GIT_WORKTREE_UNSTABLE",
  "WORKER_FAILED", "TASK_FAILED", "SNAPSHOT_NOT_CURRENT", "INDEX_SOURCE_CHANGED", "SNAPSHOT_VALIDATION_UNAVAILABLE", "LEGACY_DIAGNOSTIC_REDACTED",
]);
export type SafeDiagnosticCode = z.infer<typeof safeDiagnosticCodeSchema>;
export const safeDiagnosticDetailCodeSchema = z.union([
  z.string().regex(/^TS[0-9]{1,6}$/),
  z.enum(["SyntaxError", "IndentationError", "TabError", "ENOENT", "EACCES", "EPERM", "EISDIR", "ERR_DLOPEN_FAILED", "ERR_SECURE_READ", "ERR_PROJECT_PATH_SECURITY"]),
]);
export type SafeDiagnosticDetailCode = z.infer<typeof safeDiagnosticDetailCodeSchema>;

const SAFE_DIAGNOSTIC_MESSAGES: Record<SafeDiagnosticCode, string> = {
  FILE_DISCOVERY_FAILED: "无法读取项目文件清单（详情已隐藏）",
  FILE_READ_FAILED: "无法读取项目文件（详情已隐藏）",
  FILE_ACCESS_FAILED: "无法访问项目文件（详情已隐藏）",
  ANALYSIS_FAILED: "源文件分析失败（详情已隐藏）",
  TYPESCRIPT_SYNTAX_ERROR: "TypeScript 语法错误（详情已隐藏）",
  PYTHON_SYNTAX_ERROR: "Python 语法错误（详情已隐藏）",
  PYTHON_ENVIRONMENT_UNAVAILABLE: "Python 分析环境不可用",
  PYTHON_ANALYSIS_FAILED: "Python 分析失败（详情已隐藏）",
  ANALYSIS_TIMEOUT: "代码分析超时",
  SECURE_READER_UNAVAILABLE: "安全文件读取模块不可用；已拒绝读取源码",
  PROJECT_PATH_REJECTED: "项目路径安全校验失败；已拒绝读取",
  SECURE_READ_FAILED: "安全文件读取失败（详情已隐藏）",
  NATIVE_MODULE_UNAVAILABLE: "所需原生模块不可用",
  GIT_COMPARISON_FAILED: "Git 比较失败（详情已隐藏）",
  GIT_REPOSITORY_INVALID: "Git 仓库状态无效，无法安全比较",
  GIT_NO_COMMIT: "Git 仓库尚无任何提交；请先创建初始提交",
  GIT_CONFLICT: "Git index 存在未合并条目；请先解决冲突",
  GIT_MISSING_BASE: "Git 比较基准不可用；检查浅克隆或所选父提交",
  GIT_PATH_REJECTED: "Git 对象包含越界或无效路径，已拒绝比较",
  GIT_WORKTREE_UNSTABLE: "工作区在比较期间发生变化；未发布报告",
  WORKER_FAILED: "后台分析工作线程异常退出",
  TASK_FAILED: "后台任务失败（详情已隐藏）",
  SNAPSHOT_NOT_CURRENT: "此快照未通过当前工作区校验；依赖它的解释和答题已失效，请重新索引后再试",
  INDEX_SOURCE_CHANGED: "索引期间项目文件发生变化；未发布快照",
  SNAPSHOT_VALIDATION_UNAVAILABLE: "无法校验当前工作区；快照内容未被判定为已变化",
  LEGACY_DIAGNOSTIC_REDACTED: "历史诊断详情已隐藏",
};

export interface SafeDiagnostic { code: SafeDiagnosticCode; reason: string; detailCode?: SafeDiagnosticDetailCode }
export function safeDiagnostic(code: SafeDiagnosticCode, detailCode?: unknown): SafeDiagnostic {
  const parsedDetail = safeDiagnosticDetailCodeSchema.safeParse(detailCode);
  return { code, reason: SAFE_DIAGNOSTIC_MESSAGES[code], ...(parsedDetail.success ? { detailCode: parsedDetail.data } : {}) };
}
export function safeDiagnosticMessage(code: SafeDiagnosticCode): string { return SAFE_DIAGNOSTIC_MESSAGES[code]; }

export class SafeDiagnosticError extends Error {
  readonly diagnosticCode: SafeDiagnosticCode;
  readonly detailCode?: SafeDiagnosticDetailCode;
  constructor(code: SafeDiagnosticCode, detailCode?: unknown) {
    const diagnostic = safeDiagnostic(code, detailCode);
    super(diagnostic.reason);
    this.name = "SafeDiagnosticError";
    this.diagnosticCode = diagnostic.code;
    if (diagnostic.detailCode) this.detailCode = diagnostic.detailCode;
  }
}

export function diagnosticForError(error: unknown, fallback: SafeDiagnosticCode): SafeDiagnostic {
  if (error instanceof SafeDiagnosticError) return safeDiagnostic(error.diagnosticCode, error.detailCode);
  if (!(error instanceof Error)) return safeDiagnostic(fallback);
  try {
    const code = (error as Error & { code?: unknown }).code;
    const knownDetails = new Set(["ENOENT", "EACCES", "EPERM", "EISDIR", "ERR_DLOPEN_FAILED", "ERR_SECURE_READ", "ERR_PROJECT_PATH_SECURITY"]);
    if (code === "ERR_PROJECT_PATH_SECURITY") return safeDiagnostic("PROJECT_PATH_REJECTED", code);
    if (code === "ERR_SECURE_READ") return safeDiagnostic("SECURE_READ_FAILED", code);
    if (code === "ERR_SECURE_READER_UNAVAILABLE") return safeDiagnostic("SECURE_READER_UNAVAILABLE");
    if (code === "ERR_DLOPEN_FAILED") return safeDiagnostic("NATIVE_MODULE_UNAVAILABLE", code);
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "EISDIR") return safeDiagnostic(fallback === "FILE_READ_FAILED" || fallback === "FILE_DISCOVERY_FAILED" ? "FILE_ACCESS_FAILED" : fallback, code);
    if (error.name === "AbortError") return safeDiagnostic("TASK_FAILED");
    if (error.name === "PythonAnalysisError") {
      const kind = (error as Error & { kind?: unknown }).kind;
      if (kind === "syntax") return safeDiagnostic("PYTHON_SYNTAX_ERROR");
      if (kind === "environment") return safeDiagnostic("PYTHON_ENVIRONMENT_UNAVAILABLE");
      if (kind === "timeout") return safeDiagnostic("ANALYSIS_TIMEOUT");
      if (kind === "protocol" || kind === "process") return safeDiagnostic("PYTHON_ANALYSIS_FAILED");
    }
    if (typeof code === "string" && knownDetails.has(code)) return safeDiagnostic(fallback, code);
  } catch { /* An unusual thrown object falls back to a fixed caller-supplied category. */ }
  return safeDiagnostic(fallback);
}

function safeDiagnosticProjectPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (["<项目>", "<分析器>", "<TypeScript Program>", "<Python Project>"].includes(normalized)) return normalized;
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0") || normalized.split("/").some((part) => part === ".." || part === "")) return "<项目>";
  return normalized;
}

function legacyDiagnostic(reason: string | undefined): SafeDiagnostic {
  if (!reason) return safeDiagnostic("LEGACY_DIAGNOSTIC_REDACTED");
  if (/^TypeScript 语法错误 TS([0-9]{1,6})，位置 [0-9]+:[0-9]+$/.test(reason)) return safeDiagnostic("TYPESCRIPT_SYNTAX_ERROR", reason.match(/^TypeScript 语法错误 (TS[0-9]{1,6})/)?.[1]);
  if (/^Python 语法错误（(?:SyntaxError|IndentationError|TabError)）$/.test(reason)) return safeDiagnostic("PYTHON_SYNTAX_ERROR", reason.match(/（(SyntaxError|IndentationError|TabError)）/)?.[1]);
  if (reason === "安全文件句柄查询模块不可用；为保护项目根目录边界，已拒绝读取源码") return safeDiagnostic("SECURE_READER_UNAVAILABLE");
  if (reason.includes("文件句柄超出项目根目录") || reason.includes("根目录包含性或对象身份校验失败")) return safeDiagnostic("PROJECT_PATH_REJECTED");
  if (reason === "文件读取失败" || reason === "读取失败") return safeDiagnostic("FILE_READ_FAILED");
  return safeDiagnostic("LEGACY_DIAGNOSTIC_REDACTED");
}

export const diagnosticFailureSchema = z.object({
  filePath: z.string(), code: z.unknown().optional(), detailCode: z.unknown().optional(), reason: z.string().optional(),
}).transform((item) => {
  const parsedCode = safeDiagnosticCodeSchema.safeParse(item.code);
  const diagnostic = parsedCode.success ? safeDiagnostic(parsedCode.data, item.detailCode) : legacyDiagnostic(item.reason);
  return { filePath: safeDiagnosticProjectPath(item.filePath), ...diagnostic };
});

export const diagnosticScopeFailureSchema = z.object({
  scope: z.string(), code: z.unknown().optional(), detailCode: z.unknown().optional(), reason: z.string().optional(),
}).transform((item) => {
  const match = item.scope.match(/^(left|right):(.+)$/);
  const scope = match ? `${match[1]}:${safeDiagnosticProjectPath(match[2]!)}` : "comparison";
  const parsedCode = safeDiagnosticCodeSchema.safeParse(item.code);
  const diagnostic = parsedCode.success ? safeDiagnostic(parsedCode.data, item.detailCode) : legacyDiagnostic(item.reason);
  return { scope, ...diagnostic };
});

export const confidenceSchema = z.enum(["verified", "inferred", "unknown"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const snapshotRefSchema = z.object({ repositoryId: z.string().min(1), snapshotId: z.string().min(1) });
export type SnapshotRef = z.infer<typeof snapshotRefSchema>;

export const sourceSpanSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().nonnegative(),
  endLine: z.number().int().positive(),
  endColumn: z.number().int().nonnegative(),
}).refine((span) => span.endLine > span.startLine || (span.endLine === span.startLine && span.endColumn >= span.startColumn), "源码范围结束位置不能早于开始位置");
export type SourceSpan = z.infer<typeof sourceSpanSchema>;

export const evidenceLocationSchema = sourceSpanSchema.extend({
  repositoryId: z.string().min(1), snapshotId: z.string().min(1), evidenceId: z.string().min(1).optional(),
});
export type EvidenceLocation = z.infer<typeof evidenceLocationSchema>;

export const evidenceSchema = z.object({
  id: z.string(), snapshotId: z.string(), analyzer: z.string(), analyzerVersion: z.string(), kind: z.string(),
  confidence: confidenceSchema, reason: z.string(), span: sourceSpanSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
/** Repository identity is added by the snapshot-scoped evidence lookup boundary. */
export const identifiedEvidenceSchema = evidenceSchema.extend({ repositoryId: z.string().min(1) });
export type IdentifiedEvidence = z.infer<typeof identifiedEvidenceSchema>;

export const nodeKindSchema = z.enum(["repository", "module", "file", "function", "class", "method", "variable", "endpoint", "external-dependency", "unresolved-call", "unsupported-semantic"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;
export const graphNodeSchema = z.object({
  id: z.string(), snapshotId: z.string(), kind: nodeKindSchema, name: z.string(), qualifiedName: z.string(),
  language: z.string().optional(), filePath: z.string().optional(), span: sourceSpanSchema.optional(), evidenceId: z.string().min(1).optional(), summary: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const edgeKindSchema = z.enum(["CONTAINS", "DEFINES", "IMPORTS", "EXPORTS", "DEPENDS_ON", "CALLS", "READS", "WRITES", "RETURNS", "PASSES_TO", "HANDLES", "EMITS", "PERSISTS", "QUERIES", "CHANGED", "MAY_AFFECT", "DERIVED_FROM"]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export const graphEdgeSchema = z.object({
  id: z.string(), snapshotId: z.string(), source: z.string(), target: z.string(), kind: edgeKindSchema,
  confidence: confidenceSchema, evidenceId: z.string(), reason: z.string(), unresolvedTarget: z.string().optional(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const indexHealthSchema = z.object({
  status: z.enum(["idle", "indexing", "ready", "partial", "failed"]), totalFiles: z.number().int().nonnegative(),
  indexedFiles: z.number().int().nonnegative(), skippedFiles: z.number().int().nonnegative(), unsupportedFiles: z.number().int().nonnegative().default(0),
  ignoredByRule: z.array(z.string()).default([]), failedFiles: z.array(diagnosticFailureSchema),
  languageCounts: z.record(z.string(), z.number().int().nonnegative()), limitations: z.array(z.string()).default([]),
});
export type IndexHealth = z.infer<typeof indexHealthSchema>;

export const sourceFileIdentitySchema = z.object({ filePath: z.string(), contentHash: z.string(), bytes: z.number().int().nonnegative(), language: z.string() });
export type SourceFileIdentity = z.infer<typeof sourceFileIdentitySchema>;
export const analysisIdentitySchema = z.object({
  graphIrVersion: z.string(), analyzerVersions: z.record(z.string(), z.string()), configurationHash: z.string(), sourceFingerprint: z.string(),
});
export type AnalysisIdentity = z.infer<typeof analysisIdentitySchema>;

export const projectSnapshotSchema = z.object({
  repositoryId: z.string(), snapshotId: z.string(), name: z.string(), rootPath: z.string(), sourceType: z.enum(["local", "git"]),
  gitHead: z.string().optional(), createdAt: z.string(), analysisIdentity: analysisIdentitySchema,
  sourceFiles: z.array(sourceFileIdentitySchema), nodes: z.array(graphNodeSchema), edges: z.array(graphEdgeSchema), evidence: z.array(evidenceSchema), health: indexHealthSchema,
});
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

export const snapshotStateSchema = z.object({
  repositoryId: z.string(), snapshotId: z.string(), status: z.enum(["current", "stale", "missing", "unavailable"]),
  snapshotAvailability: z.enum(["available", "legacy-missing-source"]),
  changedFiles: z.array(z.string()), addedFiles: z.array(z.string()), removedFiles: z.array(z.string()), missingFiles: z.array(z.string()),
  configurationChanged: z.boolean(), validationLimitations: z.array(z.string()), checkedAt: z.string(),
});
export type SnapshotState = z.infer<typeof snapshotStateSchema>;

export const projectOverviewSchema = snapshotRefSchema.extend({
  name: z.string(), rootPath: z.string(), sourceType: z.enum(["local", "git"]), gitHead: z.string().optional(), createdAt: z.string(),
  analysisIdentity: analysisIdentitySchema, health: indexHealthSchema,
  counts: z.object({ nodes: z.number().int().nonnegative(), edges: z.number().int().nonnegative(), evidence: z.number().int().nonnegative(), modules: z.number().int().nonnegative(), files: z.number().int().nonnegative(), calls: z.number().int().nonnegative(), unknown: z.number().int().nonnegative() }),
});
export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const pageRequestSchema = z.object({ cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(200).default(50) });
export const moduleSummarySchema = z.object({ id: z.string(), name: z.string(), qualifiedName: z.string(), fileCount: z.number().int().nonnegative(), symbolCount: z.number().int().nonnegative(), relationCount: z.number().int().nonnegative() });
export type ModuleSummary = z.infer<typeof moduleSummarySchema>;
export const moduleListRequestSchema = snapshotRefSchema.merge(pageRequestSchema).extend({ query: z.string().max(200).default("") });
export const moduleListResponseSchema = snapshotRefSchema.extend({ items: z.array(moduleSummarySchema), nextCursor: z.string().optional(), total: z.number().int().nonnegative() });
export type ModuleListRequest = z.infer<typeof moduleListRequestSchema>;
export type ModuleListResponse = z.infer<typeof moduleListResponseSchema>;

export const aggregateRelationSchema = z.object({ sourceModuleId: z.string(), targetModuleId: z.string(), kinds: z.record(z.string(), z.number().int().nonnegative()), confidences: z.record(z.string(), z.number().int().nonnegative()), edgeCount: z.number().int().nonnegative(), evidenceIds: z.array(z.string()), edges: z.array(graphEdgeSchema), sampledEdgeCount: z.number().int().nonnegative(), evidenceTruncated: z.boolean() });
export type AggregateRelation = z.infer<typeof aggregateRelationSchema>;
export const moduleExpansionRequestSchema = snapshotRefSchema.merge(pageRequestSchema).extend({ moduleId: z.string().min(1) });
export const moduleExpansionResponseSchema = snapshotRefSchema.extend({ module: moduleSummarySchema, nodes: z.array(graphNodeSchema), relations: z.array(aggregateRelationSchema), nextCursor: z.string().optional(), truncated: z.boolean() });
export type ModuleExpansionRequest = z.infer<typeof moduleExpansionRequestSchema>;
export type ModuleExpansionResponse = z.infer<typeof moduleExpansionResponseSchema>;
export const moduleRelationEdgesRequestSchema = snapshotRefSchema.merge(pageRequestSchema).extend({ sourceModuleId: z.string().min(1), targetModuleId: z.string().min(1) });
export const moduleRelationEdgesResponseSchema = snapshotRefSchema.extend({ sourceModuleId: z.string(), targetModuleId: z.string(), items: z.array(graphEdgeSchema), total: z.number().int().nonnegative(), nextCursor: z.string().optional() });
export type ModuleRelationEdgesRequest = z.infer<typeof moduleRelationEdgesRequestSchema>;
export type ModuleRelationEdgesResponse = z.infer<typeof moduleRelationEdgesResponseSchema>;

export const moduleReferenceSummarySchema = z.object({
  id: z.string(), name: z.string(), qualifiedName: z.string(),
  category: z.enum(["unresolved-module", "external-dependency", "unresolved-call", "unsupported-semantic"]),
  relationCount: z.number().int().nonnegative(), kinds: z.record(z.string(), z.number().int().nonnegative()),
  confidences: z.record(z.string(), z.number().int().nonnegative()),
});
export const moduleOverviewRequestSchema = snapshotRefSchema.extend({
  version: z.literal(MODULE_OVERVIEW_VERSION), query: z.string().max(200).default(""),
  cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(80).default(40),
  relationCursor: z.string().max(4096).optional(), relationLimit: z.number().int().min(1).max(300).default(160),
  referenceLimit: z.number().int().min(1).max(200).default(80),
});
export const moduleOverviewResponseSchema = snapshotRefSchema.extend({
  version: z.literal(MODULE_OVERVIEW_VERSION), query: z.string(), modules: z.array(moduleSummarySchema),
  moduleTotal: z.number().int().nonnegative(), nextCursor: z.string().optional(),
  relations: z.array(aggregateRelationSchema), relationTotal: z.number().int().nonnegative(), relationNextCursor: z.string().optional(),
  references: z.array(moduleReferenceSummarySchema), referenceTotal: z.number().int().nonnegative(), referencesTruncated: z.boolean(),
  scope: z.literal("visible-module-page"),
});
export type ModuleReferenceSummary = z.infer<typeof moduleReferenceSummarySchema>;
export type ModuleOverviewRequest = z.infer<typeof moduleOverviewRequestSchema>;
export type ModuleOverviewResponse = z.infer<typeof moduleOverviewResponseSchema>;

export const searchRequestSchema = snapshotRefSchema.merge(pageRequestSchema).extend({ query: z.string().max(300).default(""), kinds: z.array(nodeKindSchema).max(9).optional(), filePath: z.string().min(1).max(4096).optional() });
export const searchResponseSchema = snapshotRefSchema.extend({ items: z.array(graphNodeSchema), nextCursor: z.string().optional(), total: z.number().int().nonnegative() });
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const graphViewSchema = z.enum(["call", "data", "dependency"]);
export const graphDirectionSchema = z.enum(["incoming", "outgoing", "both"]);
export const graphQueryRequestSchema = snapshotRefSchema.extend({
  version: z.literal(GRAPH_QUERY_VERSION), rootNodeIds: z.array(z.string().min(1)).min(1).max(20), view: graphViewSchema,
  edgeKinds: z.array(edgeKindSchema).max(20).optional(), direction: graphDirectionSchema.default("outgoing"),
  maxDepth: z.number().int().min(1).max(8).default(3), maxNodes: z.number().int().min(1).max(1000).default(120),
  maxEdges: z.number().int().min(1).max(2000).default(240), maxWork: z.number().int().min(1).max(100000).default(5000),
  confidences: z.array(confidenceSchema).min(1).max(3).default(["verified", "inferred", "unknown"]), continuationCursor: z.string().max(65536).optional(),
});
export type GraphQueryRequest = z.infer<typeof graphQueryRequestSchema>;
export const graphQueryResponseSchema = snapshotRefSchema.extend({
  version: z.literal(GRAPH_QUERY_VERSION), query: graphQueryRequestSchema.omit({ continuationCursor: true }), nodes: z.array(graphNodeSchema), edges: z.array(graphEdgeSchema), evidence: z.array(evidenceSchema),
  unresolved: z.array(z.object({ edgeId: z.string(), target: z.string().optional(), reason: z.string(), confidence: confidenceSchema })),
  truncated: z.boolean(), truncationReasons: z.array(z.enum(["depth", "nodes", "edges", "work"])), continuationCursor: z.string().optional(),
  stats: z.object({ expandedNodes: z.number().int().nonnegative(), scannedEdges: z.number().int().nonnegative(), returnedNodes: z.number().int().nonnegative(), returnedEdges: z.number().int().nonnegative(), depthReached: z.number().int().nonnegative() }),
});
export type GraphQueryResponse = z.infer<typeof graphQueryResponseSchema>;

export const evidenceRequestSchema = snapshotRefSchema.extend({ evidenceId: z.string().min(1) });
export type EvidenceRequest = z.infer<typeof evidenceRequestSchema>;
export const evidenceRangeRequestSchema = snapshotRefSchema.extend({ span: sourceSpanSchema, cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(100).default(50) });
export type EvidenceRangeRequest = z.infer<typeof evidenceRangeRequestSchema>;
export const evidenceRangeResponseSchema = snapshotRefSchema.extend({ items: z.array(evidenceSchema), total: z.number().int().nonnegative(), nextCursor: z.string().optional(), truncated: z.boolean() });
export type EvidenceRangeResponse = z.infer<typeof evidenceRangeResponseSchema>;

export const flowResultSchema = snapshotRefSchema.extend({ rootNodeId: z.string(), nodes: z.array(graphNodeSchema), edges: z.array(graphEdgeSchema), unknowns: z.array(z.string()) });
export type FlowResult = z.infer<typeof flowResultSchema>;
export const explanationSchema = snapshotRefSchema.extend({
  title: z.string(), summary: z.string(), structure: z.enum(["ordered-path", "related-evidence"]),
  steps: z.array(z.object({ order: z.number().int().positive(), title: z.string(), description: z.string(), nodeIds: z.array(z.string()), evidenceIds: z.array(z.string()), confidence: confidenceSchema })),
  unknowns: z.array(z.string()),
});
export type FeatureExplanation = z.infer<typeof explanationSchema>;

export const diffImpactSchema = snapshotRefSchema.extend({
  base: z.string(), target: z.string(), files: z.array(z.object({ filePath: z.string(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), changedNodeIds: z.array(z.string()), affectedNodeIds: z.array(z.string()) })),
  summary: z.string(), limitations: z.array(z.string()),
});
export type DiffImpact = z.infer<typeof diffImpactSchema>;

export const comparisonModeSchema = z.enum(["working", "staged", "last-commit"]);
export type ComparisonMode = z.infer<typeof comparisonModeSchema>;
export const comparisonSourceKindSchema = z.enum(["empty-tree", "commit", "index", "working-tree"]);
const exclusionBucketSchema = z.object({ count: z.number().int().nonnegative(), paths: z.array(z.string()) });
export const sideCompletenessSchema = z.object({
  status: z.enum(["complete", "partial"]), indexedFiles: z.number().int().nonnegative(),
  failures: z.array(diagnosticFailureSchema),
  exclusions: z.object({ ignored: exclusionBucketSchema, secrets: exclusionBucketSchema, unsupported: exclusionBucketSchema, binary: exclusionBucketSchema, oversized: exclusionBucketSchema, submodules: exclusionBucketSchema }),
  limitations: z.array(z.string()),
});
export type SideCompleteness = z.infer<typeof sideCompletenessSchema>;
export const comparisonSideSchema = z.object({
  label: z.string(), kind: comparisonSourceKindSchema, revision: z.string().optional(), parentNumber: z.number().int().positive().optional(),
  contentFingerprint: z.string(), manifestFingerprint: z.string(), capturedAt: z.string(), snapshot: snapshotRefSchema, analysisIdentity: analysisIdentitySchema, completeness: sideCompletenessSchema,
});
export type ComparisonSide = z.infer<typeof comparisonSideSchema>;
export const changeHunkSchema = z.object({ id: z.string(), header: z.string(), oldStart: z.number().int().nonnegative(), oldLines: z.number().int().nonnegative(), newStart: z.number().int().nonnegative(), newLines: z.number().int().nonnegative() });
export const directChangeSchema = z.object({ id: z.string(), side: z.enum(["left", "right"]), match: z.enum(["minimal", "containing", "file", "unmatched"]), nodeId: z.string().optional(), span: sourceSpanSchema.optional(), reason: z.string() });
export type DirectChange = z.infer<typeof directChangeSchema>;
export const changeFileSchema = z.object({
  id: z.string(), status: z.enum(["added", "modified", "deleted", "renamed", "copied", "untracked", "conflicted"]), oldPath: z.string().optional(), newPath: z.string().optional(), similarity: z.number().int().min(0).max(100).optional(),
  classification: z.enum(["source", "generated", "third-party", "lockfile", "migration", "config", "binary", "unsupported"]), classificationReason: z.string(), classificationConfidence: confidenceSchema,
  additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative(), binary: z.boolean(), analyzable: z.boolean(), unsupportedReason: z.string().optional(), hunks: z.array(changeHunkSchema), directChanges: z.array(directChangeSchema),
});
export type ChangeFile = z.infer<typeof changeFileSchema>;
export const impactPathSchema = z.object({
  id: z.string(), changeId: z.string(), side: z.enum(["left", "right"]), startNodeId: z.string(), endpointNodeId: z.string().optional(), nodes: z.array(graphNodeSchema), edges: z.array(graphEdgeSchema), evidence: z.array(evidenceSchema), confidence: confidenceSchema,
  limitations: z.array(z.string()), truncated: z.boolean(), budget: z.object({ maxDepth: z.number().int().positive(), maxPaths: z.number().int().positive(), maxWork: z.number().int().positive(), usedWork: z.number().int().nonnegative() }),
});
export type ImpactPath = z.infer<typeof impactPathSchema>;
export const changeReportSchema = z.object({
  version: z.literal(CHANGESET_VERSION), id: z.string(), repositoryId: z.string(), mode: comparisonModeSchema, createdAt: z.string(), left: comparisonSideSchema, right: comparisonSideSchema,
  captureFingerprint: z.string(), status: z.enum(["current", "stale", "missing"]), files: z.array(changeFileSchema), impactPaths: z.array(impactPathSchema),
  queryBudget: z.object({ maxDepth: z.number().int().positive(), maxPaths: z.number().int().positive(), maxWork: z.number().int().positive() }),
  completeness: z.object({
    status: z.enum(["complete", "partial"]),
    unmappedChanges: z.array(z.object({ changeId: z.string(), side: z.enum(["left", "right"]).optional(), reason: z.string() })),
    impact: z.object({ status: z.enum(["complete", "partial"]), reasons: z.array(z.string()), unknownEdgeCount: z.number().int().nonnegative() }),
  }),
  truncated: z.boolean(), truncationReasons: z.array(z.string()), failures: z.array(diagnosticScopeFailureSchema), limitations: z.array(z.string()),
});
export type ChangeReport = z.infer<typeof changeReportSchema>;

const legacyComparisonSideSchema = comparisonSideSchema.omit({ completeness: true });
const legacyChangeReportSchema = z.object({
  version: z.literal("1.0.0"), id: z.string(), repositoryId: z.string(), mode: comparisonModeSchema, createdAt: z.string(), left: legacyComparisonSideSchema, right: legacyComparisonSideSchema,
  captureFingerprint: z.string(), status: z.enum(["current", "stale", "missing"]), files: z.array(changeFileSchema), impactPaths: z.array(impactPathSchema),
  truncated: z.boolean(), truncationReasons: z.array(z.string()), failures: z.array(diagnosticScopeFailureSchema), limitations: z.array(z.string()),
});
const unknownLegacyCompleteness: SideCompleteness = { status: "partial", indexedFiles: 0, failures: [], exclusions: { ignored: { count: 0, paths: [] }, secrets: { count: 0, paths: [] }, unsupported: { count: 0, paths: [] }, binary: { count: 0, paths: [] }, oversized: { count: 0, paths: [] }, submodules: { count: 0, paths: [] } }, limitations: ["旧版 1.0.0 报告未保存分析完整性，不能认定为完整"] };
export function parseChangeReport(raw: unknown): ChangeReport {
  const current = changeReportSchema.safeParse(raw); if (current.success) return current.data;
  const legacy = legacyChangeReportSchema.parse(raw); const budget = legacy.impactPaths[0]?.budget ?? { maxDepth: 1, maxPaths: 1, maxWork: 10 };
  return changeReportSchema.parse({ ...legacy, version: CHANGESET_VERSION, left: { ...legacy.left, completeness: unknownLegacyCompleteness }, right: { ...legacy.right, completeness: unknownLegacyCompleteness }, queryBudget: { maxDepth: budget.maxDepth, maxPaths: budget.maxPaths, maxWork: budget.maxWork }, completeness: { status: "partial", unmappedChanges: [], impact: { status: "partial", reasons: ["旧版报告未保存完整性状态"], unknownEdgeCount: 0 } }, limitations: [...legacy.limitations, "此报告由 1.0.0 兼容读取；完整性按 partial 处理"] });
}
export const comparisonRequestSchema = snapshotRefSchema.extend({ mode: comparisonModeSchema, parentNumber: z.number().int().positive().max(32).optional(), maxDepth: z.number().int().min(1).max(8).default(4), maxPaths: z.number().int().min(1).max(100).default(30), maxWork: z.number().int().min(10).max(100000).default(5000) });
export type ComparisonRequest = z.infer<typeof comparisonRequestSchema>;
export const changeReportRequestSchema = z.object({ repositoryId: z.string().min(1), reportId: z.string().min(1) });
export const changeReportFilesRequestSchema = changeReportRequestSchema.merge(pageRequestSchema).extend({ query: z.string().max(300).default(""), statuses: z.array(changeFileSchema.shape.status).max(7).optional() });
export const changeReportFilesResponseSchema = changeReportRequestSchema.extend({ items: z.array(changeFileSchema), total: z.number().int().nonnegative(), nextCursor: z.string().optional() });
export const changeReportStateSchema = changeReportRequestSchema.extend({ status: z.enum(["current", "stale", "missing"]), checkedAt: z.string(), reason: z.string().optional() });
export const comparisonProgressSchema = z.object({ phase: z.enum(["capturing", "analyzing-left", "analyzing-right", "diffing", "propagating", "persisting"]), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), currentFile: z.string().optional() });
export const comparisonTaskHandleSchema = z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), taskId: z.string(), repositoryId: z.string(), mode: comparisonModeSchema });
export type ComparisonTaskHandle = z.infer<typeof comparisonTaskHandleSchema>;
export const comparisonTaskEventSchema = z.discriminatedUnion("type", [
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("progress"), taskId: z.string(), repositoryId: z.string(), progress: comparisonProgressSchema }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("completed"), taskId: z.string(), repositoryId: z.string(), report: changeReportSchema }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("cancelled"), taskId: z.string(), repositoryId: z.string(), message: z.string() }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("failed"), taskId: z.string(), repositoryId: z.string(), code: safeDiagnosticCodeSchema, retryable: z.boolean() }),
]);
export type ComparisonTaskEvent = z.infer<typeof comparisonTaskEventSchema>;

export const ownershipConceptSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });
export const ownershipChoiceSchema = z.object({ nodeId: z.string(), label: z.string(), detail: z.string() });
export const ownershipCheckSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("definition"), nodeId: z.string(), edgeId: z.string() }),
  z.object({ kind: z.literal("call-direction"), sourceNodeId: z.string(), targetNodeId: z.string(), edgeId: z.string() }),
  z.object({ kind: z.literal("ordered-path"), legalNodePaths: z.array(z.array(z.string()).min(2)).min(1), legalEdgePaths: z.array(z.array(z.string()).min(1)).min(1) }),
  z.object({ kind: z.literal("variable-roles"), requirements: z.array(z.object({ role: z.enum(["write", "read", "return"]), edgeIds: z.array(z.string()).min(1) })).min(2) }),
]);
export const ownershipQuestionSchema = snapshotRefSchema.extend({
  version: z.literal(OWNERSHIP_QUESTION_VERSION), id: z.string(), kind: z.enum(["entry", "call-direction", "call-path", "variable-flow"]), prompt: z.string(), concept: ownershipConceptSchema, learningObjective: z.string(), difficulty: z.enum(["easy", "medium", "hard"]), choices: z.array(ownershipChoiceSchema),
  evidenceIds: z.array(z.string()), expectedNodeIds: z.array(z.string()), deterministicChecks: z.array(ownershipCheckSchema), variantKey: z.string(), retryOfQuestionId: z.string().optional(),
});
export type OwnershipQuestion = z.infer<typeof ownershipQuestionSchema>;
export const ownershipPromptSchema = ownershipQuestionSchema.omit({ evidenceIds: true, expectedNodeIds: true, deterministicChecks: true });
export type OwnershipPrompt = z.infer<typeof ownershipPromptSchema>;

export const ownershipQuestionRequestSchema = snapshotRefSchema.extend({ count: z.number().int().min(1).max(20).default(5), scope: z.object({ kind: z.enum(["project", "module", "symbol"]), nodeId: z.string().optional() }).default({ kind: "project" }), conceptId: z.string().optional() });
export type OwnershipQuestionRequest = z.infer<typeof ownershipQuestionRequestSchema>;

export const sourceCitationSchema = sourceSpanSchema.extend({ evidenceId: z.string().optional() }).refine((span) => span.endLine > span.startLine || span.endColumn > span.startColumn, "源码引用必须是非空半开范围");
export type SourceCitation = z.infer<typeof sourceCitationSchema>;
export const ownershipSubmissionSchema = snapshotRefSchema.extend({
  questionId: z.string(), questionVersion: z.literal(OWNERSHIP_QUESTION_VERSION), answer: z.string().max(10000), citations: z.array(sourceCitationSchema).min(1), selfConfidence: z.number().min(0).max(1),
  structuredAnswer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("entry"), nodeId: z.string() }),
    z.object({ kind: z.literal("call-direction"), callerNodeId: z.string(), calleeNodeId: z.string() }),
    z.object({ kind: z.literal("call-path"), nodeIds: z.array(z.string()).min(2).max(20) }),
    z.object({ kind: z.literal("variable-flow"), roles: z.array(z.object({ citationIndex: z.number().int().nonnegative(), role: z.enum(["write", "read", "return"]) })).min(2).max(20) }),
  ]),
});
export type OwnershipSubmission = z.infer<typeof ownershipSubmissionSchema>;
export const ownershipGradeSchema = snapshotRefSchema.extend({
  questionId: z.string(), passed: z.boolean(), location: z.object({ score: z.number().min(0).max(100), status: z.enum(["passed", "needs-review"]) }), structure: z.object({ score: z.number().min(0).max(100), status: z.enum(["passed", "needs-review"]) }),
  semantic: z.object({ status: z.literal("not-evaluated"), message: z.string() }), feedback: z.array(z.string()), revealedEvidenceIds: z.array(z.string()), validatedCitations: z.array(sourceCitationSchema), scoringVersion: z.literal(OWNERSHIP_SCORING_VERSION),
});
export type OwnershipGrade = z.infer<typeof ownershipGradeSchema>;

export const masteryRecordSchema = snapshotRefSchema.extend({ questionId: z.string(), concept: z.string(), score: z.number(), completedAt: z.string() });
export type MasteryRecord = z.infer<typeof masteryRecordSchema>;
export const ownershipAttemptSchema = snapshotRefSchema.extend({ attemptId: z.string(), questionId: z.string(), questionVersion: z.string(), concept: ownershipConceptSchema, questionKind: z.string(), variantKey: z.string(), structuredAnswer: z.unknown(), citations: z.array(sourceCitationSchema), locationScore: z.number(), structureScore: z.number(), passed: z.boolean(), scoringVersion: z.string(), semanticText: z.string(), completedAt: z.string(), legacy: z.boolean().default(false) });
export type OwnershipAttempt = z.infer<typeof ownershipAttemptSchema>;
export const ownershipProgressSchema = snapshotRefSchema.extend({ attempts: z.array(ownershipAttemptSchema), concepts: z.array(z.object({ concept: ownershipConceptSchema, status: z.enum(["unpracticed", "passed", "review", "needs-revalidation"]), attempts: z.number().int().nonnegative(), lastAttemptAt: z.string().optional(), lastQuestionId: z.string().optional(), variantAvailable: z.boolean() })) });
export type OwnershipProgress = z.infer<typeof ownershipProgressSchema>;

export const importGitInputSchema = z.object({ url: z.string().min(1), branch: z.string().optional() });
export const sourceFileResultSchema = snapshotRefSchema.extend({
  filePath: z.string(), language: z.string(), content: z.string(), contentHash: z.string(), workspaceStatus: z.enum(["current", "stale", "missing", "unavailable"]), currentHash: z.string().optional(),
  targetSpan: sourceSpanSchema.optional(), evidence: evidenceSchema.optional(),
});
export type SourceFileResult = z.infer<typeof sourceFileResultSchema>;

export const indexProgressSchema = z.object({
  phase: z.enum(["queued", "discovering", "reading", "analyzing", "verifying", "persisting"]), completed: z.number().int().nonnegative(), total: z.number().int().nonnegative(), currentFile: z.string().optional(),
});
export type IndexProgress = z.infer<typeof indexProgressSchema>;
export const indexTaskHandleSchema = z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), taskId: z.string(), repositoryId: z.string().optional(), rootPath: z.string() });
export type IndexTaskHandle = z.infer<typeof indexTaskHandleSchema>;
export const indexTaskEventSchema = z.discriminatedUnion("type", [
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("progress"), taskId: z.string(), rootPath: z.string(), repositoryId: z.string().optional(), progress: indexProgressSchema }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("completed"), taskId: z.string(), rootPath: z.string(), repositoryId: z.string(), overview: projectOverviewSchema }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("cancelled"), taskId: z.string(), rootPath: z.string(), repositoryId: z.string().optional(), message: z.string() }),
  z.object({ protocolVersion: z.literal(TASK_PROTOCOL_VERSION), type: z.literal("failed"), taskId: z.string(), rootPath: z.string(), repositoryId: z.string().optional(), code: safeDiagnosticCodeSchema, retryable: z.boolean() }),
]);
export type IndexTaskEvent = z.infer<typeof indexTaskEventSchema>;

export const workerRequestSchema = z.discriminatedUnion("operation", [
  z.object({ requestId: z.string(), operation: z.literal("start-index"), taskId: z.string(), rootPath: z.string(), sourceType: z.enum(["local", "git"]), branch: z.string().optional() }),
  z.object({ requestId: z.string(), operation: z.literal("cancel-index"), taskId: z.string() }),
  z.object({ requestId: z.string(), operation: z.literal("retry-index"), taskId: z.string() }),
  z.object({ requestId: z.string(), operation: z.literal("get-current") }),
  z.object({ requestId: z.string(), operation: z.literal("get-state"), ref: snapshotRefSchema }),
  z.object({ requestId: z.string(), operation: z.literal("list-modules"), input: moduleListRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("module-overview"), input: moduleOverviewRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("expand-module"), input: moduleExpansionRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("module-relation-edges"), input: moduleRelationEdgesRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("search"), input: searchRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("query-graph"), input: graphQueryRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("evidence"), input: evidenceRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("evidence-range"), input: evidenceRangeRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("get-flow"), ref: snapshotRefSchema, nodeId: z.string(), depth: z.number().optional() }),
  z.object({ requestId: z.string(), operation: z.literal("explain"), ref: snapshotRefSchema, query: z.string() }),
  z.object({ requestId: z.string(), operation: z.literal("start-comparison"), taskId: z.string(), input: comparisonRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("cancel-comparison"), taskId: z.string() }),
  z.object({ requestId: z.string(), operation: z.literal("load-change-report"), input: changeReportRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("change-report-state"), input: changeReportRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("questions"), input: ownershipQuestionRequestSchema }),
  z.object({ requestId: z.string(), operation: z.literal("grade"), submission: ownershipSubmissionSchema }),
  z.object({ requestId: z.string(), operation: z.literal("ownership-progress"), ref: snapshotRefSchema }),
  z.object({ requestId: z.string(), operation: z.literal("source"), location: evidenceLocationSchema }),
]);
export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export const workerResponseSchema = z.union([
  z.object({ type: z.literal("response"), requestId: z.string(), ok: z.literal(true), payload: z.unknown() }),
  z.object({ type: z.literal("response"), requestId: z.string(), ok: z.literal(false), code: safeDiagnosticCodeSchema }),
  z.object({ type: z.literal("event"), event: indexTaskEventSchema }),
  z.object({ type: z.literal("comparison-event"), event: comparisonTaskEventSchema }),
]);
export type WorkerResponse = z.infer<typeof workerResponseSchema>;

export interface XRayApi {
  selectLocalProject(): Promise<IndexTaskHandle | null>;
  importLocalProject(rootPath: string): Promise<IndexTaskHandle>;
  importGitProject(input: z.infer<typeof importGitInputSchema>): Promise<IndexTaskHandle>;
  cancelIndex(taskId: string): Promise<void>;
  retryIndex(taskId: string): Promise<IndexTaskHandle>;
  onIndexEvent(listener: (event: IndexTaskEvent) => void): () => void;
  getCurrentProject(): Promise<ProjectOverview | null>;
  getSnapshotState(ref: SnapshotRef): Promise<SnapshotState>;
  listModules(input: ModuleListRequest): Promise<ModuleListResponse>;
  getModuleOverview(input: ModuleOverviewRequest): Promise<ModuleOverviewResponse>;
  expandModule(input: ModuleExpansionRequest): Promise<ModuleExpansionResponse>;
  getModuleRelationEdges(input: ModuleRelationEdgesRequest): Promise<ModuleRelationEdgesResponse>;
  search(input: SearchRequest): Promise<SearchResponse>;
  queryGraph(input: GraphQueryRequest): Promise<GraphQueryResponse>;
  getEvidence(input: EvidenceRequest): Promise<IdentifiedEvidence>;
  findEvidence(input: EvidenceRangeRequest): Promise<EvidenceRangeResponse>;
  getFlow(ref: SnapshotRef, nodeId: string, depth?: number): Promise<FlowResult>;
  explainFeature(ref: SnapshotRef, query: string): Promise<FeatureExplanation>;
  startComparison(input: ComparisonRequest): Promise<ComparisonTaskHandle>;
  cancelComparison(taskId: string): Promise<void>;
  onComparisonEvent(listener: (event: ComparisonTaskEvent) => void): () => void;
  loadChangeReport(input: z.infer<typeof changeReportRequestSchema>): Promise<ChangeReport>;
  getChangeReportState(input: z.infer<typeof changeReportRequestSchema>): Promise<z.infer<typeof changeReportStateSchema>>;
  createOwnershipQuestions(input: OwnershipQuestionRequest): Promise<OwnershipPrompt[]>;
  gradeOwnershipAnswer(submission: OwnershipSubmission): Promise<OwnershipGrade>;
  getOwnershipProgress(ref: SnapshotRef): Promise<OwnershipProgress>;
  readSource(location: EvidenceLocation): Promise<SourceFileResult>;
}

export const IPC_CHANNELS = {
  selectLocalProject: "project:select-local", importLocalProject: "project:import-local", importGitProject: "project:import-git",
  cancelIndex: "index:cancel", retryIndex: "index:retry", indexEvent: "index:event", getCurrentProject: "project:current", getSnapshotState: "snapshot:state",
  listModules: "graph:list-modules", moduleOverview: "graph:module-overview", expandModule: "graph:expand-module", moduleRelationEdges: "graph:module-relation-edges", search: "graph:search", queryGraph: "graph:query", getEvidence: "evidence:get", findEvidence: "evidence:range",
  getFlow: "graph:flow", explainFeature: "feature:explain", createOwnershipQuestions: "ownership:create-questions", ownershipProgress: "ownership:progress",
  startComparison: "git:comparison-start", cancelComparison: "git:comparison-cancel", comparisonEvent: "git:comparison-event", loadChangeReport: "git:comparison-load", changeReportState: "git:comparison-state",
  gradeOwnershipAnswer: "ownership:grade", readSource: "source:read",
} as const;
