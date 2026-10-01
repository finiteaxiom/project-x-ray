import { describe, expect, it } from "vitest";
import { canonicalSnapshotContent, canonicalSnapshotResult, type ProjectSnapshot } from "@project-xray/contracts";
import { finalizeAnalysisSnapshot } from "./snapshot-identity.js";

const draft: ProjectSnapshot = { repositoryId: "repo", snapshotId: "draft", name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-01-01", analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { a: "1", b: "2" }, configurationHash: "config", sourceFingerprint: "source" }, sourceFiles: [], nodes: [{ id: "file", snapshotId: "draft", kind: "file", name: "a", qualifiedName: "a", evidenceId: "e1", metadata: { z: 1, a: 2 } }], edges: [{ id: "edge", snapshotId: "draft", source: "file", target: "file", kind: "CALLS", confidence: "verified", evidenceId: "e1", reason: "call" }], evidence: ["e1", "e2"].map((id, i) => ({ id, snapshotId: "draft", analyzer: "a", analyzerVersion: "1", kind: "call", confidence: "verified", reason: id, span: { filePath: "a.ts", startLine: 1, startColumn: i, endLine: 1, endColumn: i + 1 } })), health: { status: "partial", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: ["b", "a"], failedFiles: [{ filePath: "b.py", code: "PYTHON_ENVIRONMENT_UNAVAILABLE", reason: "fixed" }, { filePath: "a.py", code: "PYTHON_ENVIRONMENT_UNAVAILABLE", reason: "fixed" }], languageCounts: { TypeScript: 1 }, limitations: ["b", "a"] } };
describe("规范化结果身份", () => {
  it("异步失败顺序、键顺序、集合顺序和时间不影响结果身份", () => {
    const reordered = structuredClone(draft); reordered.createdAt = "later"; reordered.evidence.reverse(); reordered.health.failedFiles.reverse(); reordered.health.limitations.reverse(); reordered.health.ignoredByRule.reverse(); reordered.analysisIdentity.analyzerVersions = { b: "2", a: "1" }; reordered.nodes[0]!.metadata = { a: 2, z: 1 };
    expect(finalizeAnalysisSnapshot(reordered).snapshotId).toBe(finalizeAnalysisSnapshot(draft).snapshotId);
    const renamed = structuredClone(draft); renamed.snapshotId = "another-seed"; renamed.nodes[0]!.evidenceId = "renamed-e1"; renamed.edges[0]!.id = "renamed-edge"; renamed.edges[0]!.evidenceId = "renamed-e1"; renamed.evidence[0]!.id = "renamed-e1";
    expect(canonicalSnapshotContent(finalizeAnalysisSnapshot(renamed))).toBe(canonicalSnapshotContent(finalizeAnalysisSnapshot(draft)));
  });
  it("范围、置信度、完整性和来源变化改变身份；引用绑定最终快照", () => {
    const final = finalizeAnalysisSnapshot(draft);
    for (const change of [(s: ProjectSnapshot) => { s.evidence[0]!.confidence = "unknown"; }, (s: ProjectSnapshot) => { s.evidence[0]!.span.endColumn += 1; }, (s: ProjectSnapshot) => { s.health.failedFiles = []; s.health.status = "ready"; }, (s: ProjectSnapshot) => { s.gitHead = "new-commit"; }]) { const value = structuredClone(draft); change(value); expect(finalizeAnalysisSnapshot(value).snapshotId).not.toBe(final.snapshotId); }
    expect(final.nodes[0]!.id).toBe(draft.nodes[0]!.id); expect([...final.nodes, ...final.edges, ...final.evidence].every(item => item.snapshotId === final.snapshotId)).toBe(true);
    expect(final.edges[0]!.evidenceId).toBe(final.evidence[0]!.id); expect(final.nodes[0]!.evidenceId).toBe(final.evidence[0]!.id);
    expect(canonicalSnapshotResult(final)).toBe(canonicalSnapshotResult(draft));
    expect(finalizeAnalysisSnapshot(final)).toEqual(final);
  });
});
