import { describe, expect, it } from "vitest";
import { TASK_PROTOCOL_VERSION, identifiedEvidenceSchema, parseChangeReport, workerRequestSchema, workerResponseSchema } from "./index.js";

describe("后台任务协议", () => {
  it("分别接受成功和失败响应", () => {
    expect(workerResponseSchema.parse({ type: "response", requestId: "1", ok: true, payload: { value: 1 } })).toEqual(expect.objectContaining({ ok: true }));
    expect(workerResponseSchema.parse({ type: "response", requestId: "2", ok: false, error: "失败" })).toEqual(expect.objectContaining({ ok: false }));
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
