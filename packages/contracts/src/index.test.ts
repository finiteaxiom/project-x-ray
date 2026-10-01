import { describe, expect, it } from "vitest";
import { GRAPH_IR_VERSION, OWNERSHIP_QUESTION_VERSION, OWNERSHIP_SCORING_VERSION, TASK_PROTOCOL_VERSION, comparisonTaskEventSchema, diagnosticFailureSchema, graphNodeSchema, identifiedEvidenceSchema, indexTaskEventSchema, parseChangeReport, snapshotStateSchema, sourceFileResultSchema, workerRequestSchema, workerResponseSchema } from "./index.js";

describe("后台任务协议", () => {
  it("评分规则改动单独递增评分版本而不改变题目结构版本", () => {
    expect(OWNERSHIP_QUESTION_VERSION).toBe("2.0.0");
    expect(OWNERSHIP_SCORING_VERSION).toBe("2.1.0");
  });

  it("通过版本化 Graph IR 文件节点链接精确文件证据", () => {
    expect(GRAPH_IR_VERSION).toBe("1.3.0");
    expect(graphNodeSchema.parse({ id: "file", snapshotId: "snap", kind: "file", name: "empty.ts", qualifiedName: "empty.ts", filePath: "empty.ts", span: { filePath: "empty.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 }, evidenceId: "evidence-file", metadata: {} })).toMatchObject({ kind: "file", evidenceId: "evidence-file" });
    expect(graphNodeSchema.safeParse({ id: "file", snapshotId: "snap", kind: "file", name: "empty.ts", qualifiedName: "empty.ts", filePath: "empty.ts", evidenceId: "", metadata: {} }).success).toBe(false);
  });

  it("分别接受成功和失败响应", () => {
    expect(workerResponseSchema.parse({ type: "response", requestId: "1", ok: true, payload: { value: 1 } })).toEqual(expect.objectContaining({ ok: true }));
    const failedResponse = workerResponseSchema.parse({ type: "response", requestId: "2", ok: false, code: "TASK_FAILED", error: "C:\\Users\\Felix\\private\\snippet.ts: confidential source" });
    expect(failedResponse).toEqual(expect.objectContaining({ ok: false, code: "TASK_FAILED" })); expect(failedResponse).not.toHaveProperty("error");
    expect(workerResponseSchema.safeParse({ type: "response", requestId: "3", ok: false, error: "/home/private/source.ts: secret" }).success).toBe(false);
    expect(workerResponseSchema.safeParse({ type: "response", requestId: "4", ok: false, code: "ARBITRARY_CODE" }).success).toBe(false);
  });

  it("索引与比较失败事件只允许固定诊断码", () => {
    const indexFailure = { protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId: "task", rootPath: "repo", code: "NATIVE_MODULE_UNAVAILABLE", retryable: true, message: "C:\\Users\\private\\source.ts" };
    const comparisonFailure = { protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId: "task", repositoryId: "repo", code: "GIT_COMPARISON_FAILED", retryable: false, message: "/home/private/source.ts" };
    expect(indexTaskEventSchema.parse(indexFailure)).not.toHaveProperty("message");
    expect(comparisonTaskEventSchema.parse(comparisonFailure)).not.toHaveProperty("message");
    expect(indexTaskEventSchema.safeParse({ ...indexFailure, code: undefined }).success).toBe(false);
    expect(comparisonTaskEventSchema.safeParse({ ...comparisonFailure, code: "UNTRUSTED" }).success).toBe(false);
  });

  it("诊断边界移除绝对路径和任意消息，只保留安全类别", () => {
    const marker = "PRIVATE_SOURCE_SNIPPET";
    for (const filePath of ["C:\\Users\\Felix\\private\\source.ts", "/home/felix/private/source.ts", "../private/source.ts"]) {
      const failure = diagnosticFailureSchema.parse({ filePath, reason: marker, code: "ANALYSIS_FAILED", detailCode: marker });
      expect(failure.filePath).toBe("<项目>"); expect(failure.code).toBe("ANALYSIS_FAILED"); expect(failure.reason).not.toContain(marker); expect(JSON.stringify(failure)).not.toContain("Felix");
    }
  });

  it("校验不可用快照没有伪造的差异状态", () => {
    const state = snapshotStateSchema.parse({ repositoryId: "repo", snapshotId: "snap", status: "unavailable", snapshotAvailability: "available", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations: [], checkedAt: "2026-10-01T00:00:00.000Z" });
    expect(state.status).toBe("unavailable"); expect(state.changedFiles).toEqual([]); expect(state.configurationChanged).toBe(false);
  });

  it("源码结果保留无法验证状态，与确知缺失区分", () => {
    const result = { repositoryId: "repo", snapshotId: "snap", filePath: "a.ts", language: "TypeScript", content: "x", contentHash: "hash", workspaceStatus: "unavailable" };
    expect(sourceFileResultSchema.parse(result).workspaceStatus).toBe("unavailable");
    expect(sourceFileResultSchema.parse({ ...result, workspaceStatus: "missing" }).workspaceStatus).toBe("missing");
  });

  it("拒绝缺少项目根路径的进度事件和越界请求形状", () => {
    expect(workerResponseSchema.safeParse({ type: "event", event: { protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: "t", progress: { phase: "reading", completed: 1, total: 2 } } }).success).toBe(false);
    expect(workerRequestSchema.safeParse({ requestId: "r", operation: "source", location: { repositoryId: "r", snapshotId: "s", filePath: "a.ts" } }).success).toBe(false);
  });

  it("兼容读取 1.0.0 报告时明确降级为 partial", () => {
    const side = { label: "HEAD", kind: "commit", revision: "a".repeat(40), contentFingerprint: "content", manifestFingerprint: "config", capturedAt: "2026-01-01T00:00:00.000Z", snapshot: { repositoryId: "repo", snapshotId: "snap" }, analysisIdentity: { graphIrVersion: "1", analyzerVersions: {}, configurationHash: "config", sourceFingerprint: "content" } };
    const report = parseChangeReport({ version: "1.0.0", id: "old", repositoryId: "repo", mode: "staged", createdAt: "2026-01-01T00:00:00.000Z", left: side, right: { ...side, kind: "index", revision: undefined }, captureFingerprint: "capture", status: "current", files: [], impactPaths: [], truncated: false, truncationReasons: [], failures: [], limitations: [] });
    expect(report.version).toBe("1.1.0"); expect(report.completeness.status).toBe("partial"); expect(report.left.completeness.status).toBe("partial");
  });

  it("证据查询响应要求仓库身份，避免跨仓库证据被当作当前证据", () => {
    const evidence = { id: "ev", repositoryId: "repo", snapshotId: "snap", analyzer: "test", analyzerVersion: "1", kind: "definition", confidence: "verified", reason: "fixture", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 } };
    expect(identifiedEvidenceSchema.parse(evidence)).toEqual(expect.objectContaining({ repositoryId: "repo", snapshotId: "snap" }));
    const { repositoryId: _repositoryId, ...withoutRepository } = evidence;
    expect(identifiedEvidenceSchema.safeParse(withoutRepository).success).toBe(false);
  });
});
