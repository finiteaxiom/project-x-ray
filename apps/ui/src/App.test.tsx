// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHANGESET_VERSION, GRAPH_QUERY_VERSION, TASK_PROTOCOL_VERSION, type ChangeReport, type ComparisonTaskEvent, type GraphQueryResponse, type IndexTaskEvent, type IndexTaskHandle, type ProjectOverview, type XRayApi } from "@project-xray/contracts";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onMount }: { value: string; onMount?: (editor: unknown, monaco: unknown) => void }) => {
    useEffect(() => {
      const editor = {
        onDidChangeCursorSelection: (callback: (event: unknown) => void) => { callback({ selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 } }); return { dispose: () => undefined }; },
        revealRangeInCenter: () => undefined, setSelection: () => undefined,
        createDecorationsCollection: () => ({ clear: () => undefined }),
        updateOptions: () => undefined, layout: () => undefined,
      };
      class Range { constructor(..._values: number[]) {} }
      onMount?.(editor, { Range, editor: { defineTheme: vi.fn(), setTheme: vi.fn() } });
    }, []);
    return <pre data-testid="mock-editor">{value}</pre>;
  },
}));
vi.mock("cytoscape", () => ({ default: () => ({ on: () => undefined, destroy: () => undefined }) }));

import { App } from "./App";
afterEach(() => cleanup());

const evidence = { id: "ev", snapshotId: "snap-one", analyzer: "test", analyzerVersion: "1", kind: "definition", confidence: "verified" as const, reason: "定义", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 19 } };
const handle = (taskId: string, rootPath = "C:\\demo"): IndexTaskHandle => ({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, rootPath });
function snapshot(snapshotId = "snap-one"): ProjectOverview {
  return {
    repositoryId: "repo", snapshotId, name: "demo", rootPath: "C:\\demo", sourceType: "local", createdAt: "2026-09-19T00:00:00.000Z",
    analysisIdentity: { graphIrVersion: "1.1.0", analyzerVersions: { test: "1" }, configurationHash: "c", sourceFingerprint: snapshotId },
    health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] },
    counts: { nodes: 2, edges: 1, evidence: 1, modules: 1, files: 1, calls: 0, unknown: 0 },
  };
}

describe("可信快照 UI 闭环", () => {
  let listener: ((event: IndexTaskEvent) => void) | undefined;
  let comparisonListener: ((event: ComparisonTaskEvent) => void) | undefined;
  let state: "current" | "stale" = "current";
  let api: XRayApi;
  beforeEach(() => {
    listener = undefined; comparisonListener = undefined; state = "current";
    api = {
      getCurrentProject: vi.fn(async () => null),
      selectLocalProject: vi.fn(async () => handle("11111111-1111-4111-8111-111111111111")),
      importLocalProject: vi.fn(async () => handle("22222222-2222-4222-8222-222222222222")),
      importGitProject: vi.fn(async () => handle("33333333-3333-4333-8333-333333333333", "url")),
      cancelIndex: vi.fn(async () => undefined), retryIndex: vi.fn(async () => handle("44444444-4444-4444-8444-444444444444")),
      onIndexEvent: (callback) => { listener = callback; return () => { listener = undefined; }; },
      getSnapshotState: vi.fn(async (ref) => ({ ...ref, status: state, snapshotAvailability: "available" as const, changedFiles: state === "stale" ? ["a.ts"] : [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations: [], checkedAt: new Date().toISOString() })),
      listModules: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [], total: 0 })),
      getModuleOverview: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: "1.0.0" as const, query: input.query, modules: [], moduleTotal: 0, relations: [], relationTotal: 0, references: [], referenceTotal: 0, referencesTruncated: false, scope: "visible-module-page" as const })),
      expandModule: vi.fn(),
      getModuleRelationEdges: vi.fn(),
      search: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: input.kinds?.includes("file") ? [{ id: "file", snapshotId: input.snapshotId, kind: "file" as const, name: "a.ts", qualifiedName: "a.ts", filePath: "a.ts", language: "TypeScript", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 22 }, metadata: {} }] : [], total: 1 })),
      queryGraph: vi.fn(async (input): Promise<GraphQueryResponse> => { const { continuationCursor: _cursor, ...query } = input; return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [], edges: [], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 0, scannedEdges: 0, returnedNodes: 0, returnedEdges: 0, depthReached: 0 } }; }),
      getEvidence: vi.fn(async (input) => ({ ...evidence, snapshotId: input.snapshotId })),
      findEvidence: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [{ ...evidence, snapshotId: input.snapshotId }], total: 1, truncated: false })),
      getFlow: vi.fn(), explainFeature: vi.fn(),
      startComparison: vi.fn(async (input) => ({ protocolVersion: TASK_PROTOCOL_VERSION as typeof TASK_PROTOCOL_VERSION, taskId: "55555555-5555-4555-8555-555555555555", repositoryId: input.repositoryId, mode: input.mode })), cancelComparison: vi.fn(async () => undefined), onComparisonEvent: (callback) => { comparisonListener = callback; return () => { comparisonListener = undefined; }; }, loadChangeReport: vi.fn(), getChangeReportState: vi.fn(async (input) => ({ ...input, status: "current" as const, checkedAt: new Date().toISOString() })),
      createOwnershipQuestions: vi.fn(async (input) => [{ ...input, version: "2.0.0" as const, id: "q", kind: "entry" as const, prompt: "定位 login", concept: { id: "definition:login", label: "login 定义" }, learningObjective: "定位定义", difficulty: "easy" as const, choices: [{ nodeId: "login", label: "login", detail: "function · login" }], variantKey: "definition:ev" }]),
      gradeOwnershipAnswer: vi.fn(async (submission) => ({ repositoryId: submission.repositoryId, snapshotId: submission.snapshotId, questionId: submission.questionId, passed: true, location: { score: 100, status: "passed" as const }, structure: { score: 100, status: "passed" as const }, semantic: { status: "not-evaluated" as const, message: "未评估" }, feedback: ["语义未评估"], revealedEvidenceIds: ["ev"], validatedCitations: submission.citations, scoringVersion: "2.0.0" as const })),
      getOwnershipProgress: vi.fn(async (ref) => ({ ...ref, attempts: [], concepts: [] })),
      readSource: vi.fn(async (location) => ({ repositoryId: location.repositoryId, snapshotId: location.snapshotId, filePath: location.filePath, language: "TypeScript", content: "export function login(){}", contentHash: "h", workspaceStatus: state, targetSpan: location, ...(location.evidenceId ? { evidence: { ...evidence, snapshotId: location.snapshotId } } : {}) })),
    };
    window.xray = api;
  });

  it("覆盖导入、源码定位、引用答题、过期和更新", async () => {
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: "选择本地项目" }));
    await waitFor(() => expect(listener).toBeDefined());
    listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "11111111-1111-4111-8111-111111111111", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot() });
    await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ })); await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    await screen.findByText("定位 login"); await user.click(screen.getByRole("button", { name: "a.ts" }));
    await screen.findByTestId("mock-editor"); await user.click(screen.getByRole("button", { name: /引用选中范围/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "选择定义符号" }), "login"); await user.type(screen.getByRole("textbox", { name: "自由文本学习记录" }), "我从定义位置确认入口"); await user.click(screen.getByRole("button", { name: "提交并核验结构" }));
    await screen.findByText("自由文本语义"); expect(api.readSource).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo", snapshotId: "snap-one", filePath: "a.ts", startLine: 1 }));
    state = "stale"; fireEvent.focus(window); await screen.findByText("工作区已变化");
    await user.click(screen.getByRole("button", { name: "更新索引" }));
    listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-two") });
    await waitFor(() => expect(screen.getByText("snap-two")).toBeTruthy());
  });

  it("取消按钮调用当前后台任务", async () => {
    const user = userEvent.setup(); render(<App />); await user.click(await screen.findByRole("button", { name: "选择本地项目" }));
    listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: "11111111-1111-4111-8111-111111111111", rootPath: "C:\\demo", progress: { phase: "analyzing", completed: 1, total: 3, currentFile: "a.ts" } });
    await user.click(await screen.findByRole("button", { name: "取消" }));
    expect(api.cancelIndex).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("同一快照源码 A/B 反序完成时只显示最后选择的 B", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); api.search = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: ["a.ts", "b.ts"].map((filePath) => ({ id: filePath, snapshotId: input.snapshotId, kind: "file" as const, name: filePath, qualifiedName: filePath, filePath, language: "TypeScript", span: { filePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 }, metadata: {} })), total: 2 }));
    let resolveA!: (value: Awaited<ReturnType<XRayApi["readSource"]>>) => void; let resolveB!: (value: Awaited<ReturnType<XRayApi["readSource"]>>) => void; const a = new Promise<Awaited<ReturnType<XRayApi["readSource"]>>>((resolve) => { resolveA = resolve; }); const b = new Promise<Awaited<ReturnType<XRayApi["readSource"]>>>((resolve) => { resolveB = resolve; });
    api.readSource = vi.fn((location) => location.filePath === "a.ts" ? a : b); window.xray = api; const user = userEvent.setup(); render(<App />); await user.click(await screen.findByRole("button", { name: /所有权模式/ })); await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    await user.click(await screen.findByRole("button", { name: "a.ts" })); await user.click(screen.getByRole("button", { name: "b.ts" })); resolveB({ repositoryId: "repo", snapshotId: "snap-one", filePath: "b.ts", language: "TypeScript", content: "BBBB", contentHash: "b", workspaceStatus: "current", targetSpan: { filePath: "b.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 } }); await screen.findByText("BBBB");
    resolveA({ repositoryId: "repo", snapshotId: "snap-one", filePath: "a.ts", language: "TypeScript", content: "AAAA", contentHash: "a", workspaceStatus: "current", targetSpan: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 } }); await waitFor(() => expect(screen.queryByText("AAAA")).toBeNull()); expect(screen.getByText("BBBB")).toBeTruthy();
  });

  it("项目切换时取消旧比较并清空旧项目查询状态", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api; const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: /Git 变更/ })); await user.click(screen.getByRole("button", { name: "生成比较报告" })); await waitFor(() => expect(comparisonListener).toBeDefined());
    state = "stale"; fireEvent.focus(window); await user.click(await screen.findByRole("button", { name: "更新索引" })); await waitFor(() => expect(listener).toBeDefined());
    listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo-two", overview: { ...snapshot("snap-two"), repositoryId: "repo-two", name: "other" } });
    await screen.findAllByText("other"); expect(api.cancelComparison).toHaveBeenCalledWith("55555555-5555-4555-8555-555555555555"); await user.click(screen.getByRole("button", { name: /Git 变更/ })); expect(screen.queryByTestId("comparison-identities")).toBeNull();
  });

  it("选择比较模式并从重命名文件打开左侧不可变源码", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api; const user = userEvent.setup(); render(<App />); await user.click(await screen.findByRole("button", { name: /Git 变更/ })); await user.selectOptions(screen.getByRole("combobox", { name: "比较模式" }), "staged"); await user.click(screen.getByRole("button", { name: "生成比较报告" })); await waitFor(() => expect(comparisonListener).toBeDefined());
    const identity = { graphIrVersion: "1.1.0", analyzerVersions: { test: "1" }, configurationHash: "cfg", sourceFingerprint: "src" }; const leftSpan = { filePath: "old.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 }; const rightSpan = { ...leftSpan, filePath: "new.ts" }; const exclusions = { ignored: { count: 0, paths: [] }, secrets: { count: 0, paths: [] }, unsupported: { count: 0, paths: [] }, binary: { count: 0, paths: [] }, oversized: { count: 0, paths: [] }, submodules: { count: 0, paths: [] } }; const sideCompleteness = { status: "complete" as const, indexedFiles: 1, failures: [], exclusions, limitations: [] }; const rightCompleteness = { ...sideCompleteness, status: "partial" as const, failures: [{ filePath: "new.ts", reason: "TypeScript 语法错误 TS1005，位置 1:9" }] }; const report: ChangeReport = { version: CHANGESET_VERSION, id: "report", repositoryId: "repo", mode: "staged", createdAt: new Date().toISOString(), left: { label: "HEAD", kind: "commit", revision: "a".repeat(40), contentFingerprint: "left", manifestFingerprint: "cfg", capturedAt: new Date().toISOString(), snapshot: { repositoryId: "repo", snapshotId: "left-snap" }, analysisIdentity: identity, completeness: sideCompleteness }, right: { label: "Index", kind: "index", contentFingerprint: "right", manifestFingerprint: "cfg", capturedAt: new Date().toISOString(), snapshot: { repositoryId: "repo", snapshotId: "right-snap" }, analysisIdentity: identity, completeness: rightCompleteness }, captureFingerprint: "capture", status: "current", files: [{ id: "change", status: "renamed", oldPath: "old.ts", newPath: "new.ts", similarity: 95, classification: "source", classificationReason: "source", classificationConfidence: "verified", additions: 1, deletions: 1, binary: false, analyzable: true, hunks: [], directChanges: [{ id: "left-direct", side: "left", match: "file", nodeId: "old-file", span: leftSpan, reason: "file" }, { id: "right-direct", side: "right", match: "file", nodeId: "new-file", span: rightSpan, reason: "file" }] }], impactPaths: [], queryBudget: { maxDepth: 4, maxPaths: 30, maxWork: 5000 }, completeness: { status: "partial", unmappedChanges: [], impact: { status: "partial", reasons: ["一侧分析不完整"], unknownEdgeCount: 0 } }, truncated: false, truncationReasons: [], failures: [{ scope: "right:new.ts", reason: "TypeScript 语法错误 TS1005，位置 1:9" }], limitations: [] };
    comparisonListener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "55555555-5555-4555-8555-555555555555", repositoryId: "repo", report }); expect((await screen.findByTestId("comparison-partial")).textContent).toMatch(/new\.ts.*TS1005/); await user.click(await screen.findByRole("button", { name: /renamed · old\.ts/ })); await waitFor(() => expect(api.readSource).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "left-snap", filePath: "old.ts" })));
  });
});
