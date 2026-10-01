// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IGNORE_POLICY_VERSION, CHANGESET_VERSION, GRAPH_QUERY_VERSION, OWNERSHIP_SCORING_VERSION, TASK_PROTOCOL_VERSION, type ChangeReport, type ComparisonTaskEvent, type GraphEdge, type GraphNode, type GraphQueryResponse, type IndexTaskEvent, type IndexTaskHandle, type ProjectOverview, type SnapshotState, type SourceFileResult, type XRayApi } from "@project-xray/contracts";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onMount }: { value: string; onMount?: (editor: unknown, monaco: unknown) => void }) => {
    useEffect(() => {
      const editor = {
        onDidChangeCursorSelection: (callback: (event: unknown) => void) => { callback({ selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 } }); return { dispose: () => undefined }; },
        onDidScrollChange: () => ({ dispose: () => undefined }), getScrollTop: () => 0, getScrollLeft: () => 0, setScrollTop: () => undefined, setScrollLeft: () => undefined,
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
vi.mock("cytoscape", () => ({ default: () => ({ on: () => undefined, destroy: () => undefined, zoom: () => 1, pan: () => ({ x: 0, y: 0 }), $: () => ({ length: 0, map: () => [], unselect: () => undefined }), nodes: () => ({ length: 0, map: () => [] }), getElementById: () => ({ data: () => undefined, select: () => undefined }), elements: () => ({ remove: () => undefined, removeClass: () => ({ addClass: () => undefined }), addClass: () => undefined }), batch: (callback: () => void) => callback(), add: () => undefined, layout: () => ({ run: () => undefined }), destroyed: () => false, resize: () => undefined, fit: () => undefined, scratch: () => undefined, width: () => 100, height: () => 100, minZoom: () => .08, maxZoom: () => 2.4 }) }));

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
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function sourceResult(repositoryId: string, snapshotId: string, filePath: string, content: string): SourceFileResult { return { repositoryId, snapshotId, filePath, language: "TypeScript", content, contentHash: `${repositoryId}:${snapshotId}:${filePath}`, workspaceStatus: "current", targetSpan: { filePath, startLine: 1, startColumn: 0, endLine: 1, endColumn: 1 } }; }
function comparisonReport(repositoryId: string, id: string): ChangeReport {
  const completeness = { status: "complete" as const, indexedFiles: 0, failures: [], exclusions: Object.fromEntries(["ignored", "secrets", "unsupported", "binary", "oversized", "submodules"].map((key) => [key, { count: 0, paths: [] }])), limitations: [] };
  const side = (label: string, snapshotId: string) => ({ label, kind: "commit" as const, revision: `${snapshotId}-revision`, contentFingerprint: `${snapshotId}-content`, manifestFingerprint: "manifest", capturedAt: "2026-09-26T00:00:00.000Z", snapshot: { repositoryId, snapshotId }, analysisIdentity: snapshot().analysisIdentity, completeness });
  return { version: CHANGESET_VERSION, id, repositoryId, mode: "working", createdAt: "2026-09-26T00:00:00.000Z", left: side("Index", "left-snapshot"), right: side("工作区", "right-snapshot"), captureFingerprint: "capture", status: "current", files: [], impactPaths: [], queryBudget: { maxDepth: 4, maxPaths: 30, maxWork: 5000 }, completeness: { status: "complete", unmappedChanges: [], impact: { status: "complete", reasons: [], unknownEdgeCount: 0 } }, truncated: false, truncationReasons: [], failures: [], limitations: [] } as unknown as ChangeReport;
}

describe("可信快照 UI 闭环", () => {
  let listener: ((event: IndexTaskEvent) => void) | undefined;
  let comparisonListener: ((event: ComparisonTaskEvent) => void) | undefined;
  let indexSubscriptions = 0; let indexUnsubscriptions = 0;
  let state: "current" | "stale" | "unavailable" = "current";
  let api: XRayApi;
  beforeEach(() => {
    listener = undefined; comparisonListener = undefined; indexSubscriptions = 0; indexUnsubscriptions = 0; state = "current";
    api = {
      getIgnoreSettings: vi.fn(async (ref) => ({ ...ref, settings: { version: IGNORE_POLICY_VERSION, revision: 0, rules: [] }, policy: { version: IGNORE_POLICY_VERSION, hash: "empty", rules: [] }, defaultRules: [] })),
      saveIgnoreSettings: vi.fn(),
      getCurrentProject: vi.fn(async () => null),
      selectLocalProject: vi.fn(async () => handle("11111111-1111-4111-8111-111111111111")),
      importLocalProject: vi.fn(async () => handle("22222222-2222-4222-8222-222222222222")),
      importGitProject: vi.fn(async () => handle("33333333-3333-4333-8333-333333333333", "url")),
      cancelIndex: vi.fn(async () => undefined), retryIndex: vi.fn(async () => handle("44444444-4444-4444-8444-444444444444")),
      onIndexEvent: (callback) => { indexSubscriptions += 1; listener = callback; return () => { indexUnsubscriptions += 1; if (listener === callback) listener = undefined; }; },
      getSnapshotState: vi.fn(async (ref) => ({ ...ref, status: state, snapshotAvailability: "available" as const, changedFiles: state === "stale" ? ["a.ts"] : [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations: [], checkedAt: new Date().toISOString() })),
      listModules: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [], total: 0 })),
      getModuleOverview: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: "1.0.0" as const, query: input.query, modules: [], moduleTotal: 0, relations: [], relationTotal: 0, references: [], referenceTotal: 0, referencesTruncated: false, scope: "visible-module-page" as const })),
      expandModule: vi.fn(),
      getModuleRelationEdges: vi.fn(),
      search: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: input.kinds?.includes("file") ? [{ id: "file", snapshotId: input.snapshotId, kind: "file" as const, name: "a.ts", qualifiedName: "a.ts", filePath: "a.ts", language: "TypeScript", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 22 }, metadata: {} }] : [], total: 1 })),
      queryGraph: vi.fn(async (input): Promise<GraphQueryResponse> => { const { continuationCursor: _cursor, ...query } = input; return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [], edges: [], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 0, scannedEdges: 0, returnedNodes: 0, returnedEdges: 0, depthReached: 0 } }; }),
      getEvidence: vi.fn(async (input) => ({ ...evidence, repositoryId: input.repositoryId, snapshotId: input.snapshotId })),
      findEvidence: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [{ ...evidence, snapshotId: input.snapshotId }], total: 1, truncated: false })),
      getFlow: vi.fn(), explainFeature: vi.fn(),
      startComparison: vi.fn(async (input) => ({ protocolVersion: TASK_PROTOCOL_VERSION as typeof TASK_PROTOCOL_VERSION, taskId: "55555555-5555-4555-8555-555555555555", repositoryId: input.repositoryId, mode: input.mode })), cancelComparison: vi.fn(async () => undefined), onComparisonEvent: (callback) => { comparisonListener = callback; return () => { comparisonListener = undefined; }; }, loadChangeReport: vi.fn(), getChangeReportState: vi.fn(async (input) => ({ ...input, status: "current" as const, checkedAt: new Date().toISOString() })),
      createOwnershipQuestions: vi.fn(async (input) => [{ ...input, version: "2.0.0" as const, id: "q", kind: "entry" as const, prompt: "定位 login", concept: { id: "definition:login", label: "login 定义" }, learningObjective: "定位定义", difficulty: "easy" as const, choices: [{ nodeId: "login", label: "login", detail: "function · login" }], variantKey: "definition:ev" }]),
      gradeOwnershipAnswer: vi.fn(async (submission) => ({ repositoryId: submission.repositoryId, snapshotId: submission.snapshotId, questionId: submission.questionId, passed: true, location: { score: 100, status: "passed" as const }, structure: { score: 100, status: "passed" as const }, semantic: { status: "not-evaluated" as const, message: "未评估" }, feedback: ["语义未评估"], revealedEvidenceIds: ["ev"], validatedCitations: submission.citations, scoringVersion: OWNERSHIP_SCORING_VERSION as typeof OWNERSHIP_SCORING_VERSION })),
      getOwnershipProgress: vi.fn(async (ref) => ({ ...ref, attempts: [], concepts: [] })),
      readSource: vi.fn(async (location) => ({ repositoryId: location.repositoryId, snapshotId: location.snapshotId, filePath: location.filePath, language: "TypeScript", content: "export function login(){}", contentHash: "h", workspaceStatus: state, targetSpan: location, ...(location.evidenceId ? { evidence: { ...evidence, snapshotId: location.snapshotId } } : {}) })),
    };
    window.xray = api;
  });

  async function requestFlowEdge(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: /调用 \/ 数据流/ }));
    await user.type(screen.getByRole("textbox", { name: "搜索符号" }), "login");
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(await screen.findByRole("button", { name: "查询关系" }));
    await user.click(await screen.findByRole("button", { name: /CALLS · test edge/ }));
    return user;
  }

  async function openOwnershipSource(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(await screen.findByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    await screen.findByText("定位 login");
    await user.click(await screen.findByRole("button", { name: "a.ts" }));
  }

  async function completeLocalImport(overview: ProjectOverview): Promise<void> {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "项目概览" }));
    await user.click(await screen.findByRole("button", { name: "导入其他项目" }));
    await waitFor(() => expect(api.selectLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "11111111-1111-4111-8111-111111111111", rootPath: overview.rootPath, repositoryId: overview.repositoryId, overview }));
    await screen.findByText(overview.snapshotId);
  }

  it("Overview shows the safe Python environment failure and a reindex instruction", async () => {
    const overview = snapshot();
    overview.health = {
      ...overview.health,
      status: "partial",
      failedFiles: [{ filePath: "src/analysis.py", code: "PYTHON_ENVIRONMENT_UNAVAILABLE", reason: "raw Python spawn error" }],
    };
    api.getCurrentProject = vi.fn(async () => overview);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("不可变证据快照");
    await user.click(screen.getByText("查看忽略规则与分析限制"));

    expect(screen.getByText("失败文件（1）")).toBeTruthy();
    expect(screen.getByText("失败 1 个文件")).toBeTruthy();
    expect(screen.getByText("src/analysis.py")).toBeTruthy();
    expect(document.body.textContent).toContain("Python 分析环境不可用");
    expect(screen.getByText("PYTHON_ENVIRONMENT_UNAVAILABLE")).toBeTruthy();
    expect(document.body.textContent).toMatch(/python\.exe.*PATH.*python --version.*更新索引/);
    expect(document.body.textContent).toMatch(/修改 PATH.*重新启动 Project X-Ray.*更新索引/);
    expect(document.body.textContent).not.toContain("raw Python spawn error");
  });

  it("Overview shows existing analyzer failures with normalized messages and safe codes", async () => {
    const overview = snapshot();
    overview.health = {
      ...overview.health,
      status: "partial",
      failedFiles: [{ filePath: "src/broken.ts", code: "TYPESCRIPT_SYNTAX_ERROR", detailCode: "TS1005", reason: "raw parser exception with source" }],
    };
    api.getCurrentProject = vi.fn(async () => overview);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("不可变证据快照");
    await user.click(screen.getByText("查看忽略规则与分析限制"));

    expect(screen.getByText("失败文件（1）")).toBeTruthy();
    expect(screen.getByText("src/broken.ts")).toBeTruthy();
    expect(document.body.textContent).toContain("TypeScript 语法错误（详情已隐藏）");
    expect(screen.getByText("TYPESCRIPT_SYNTAX_ERROR")).toBeTruthy();
    expect(screen.getByText("TS1005")).toBeTruthy();
    expect(document.body.textContent).not.toContain("raw parser exception with source");
  });

  it("Overview explicitly reports when the snapshot has no failed files", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("不可变证据快照");
    await user.click(screen.getByText("查看忽略规则与分析限制"));

    expect(screen.getByText("失败 0 个文件")).toBeTruthy();
    expect(screen.getByText("失败文件（0）")).toBeTruthy();
    expect(screen.getByText("没有失败文件。")).toBeTruthy();
    expect(screen.queryByText(/python\.exe/)).toBeNull();
  });

  it("Overview redacts untrusted legacy diagnostic text and absolute paths", async () => {
    const overview = snapshot();
    const sourceMarker = "PRIVATE_OLD_DIAGNOSTIC_SOURCE_MARKER";
    const oldAbsolutePath = "D:\\private\\workspace\\src\\legacy.py";
    overview.health = {
      ...overview.health,
      status: "partial",
      failedFiles: [{
        filePath: oldAbsolutePath,
        code: "UNTRUSTED_PRIVATE_CODE" as never,
        detailCode: `D:\\private\\${sourceMarker}` as never,
        reason: `Parser failed near ${sourceMarker} at ${oldAbsolutePath}`,
      }],
    };
    api.getCurrentProject = vi.fn(async () => overview);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("不可变证据快照");
    await user.click(screen.getByText("查看忽略规则与分析限制"));

    const renderedText = document.body.textContent ?? "";
    expect(screen.getByText("<项目>")).toBeTruthy();
    expect(renderedText).toContain("历史诊断详情已隐藏");
    expect(screen.getByText("LEGACY_DIAGNOSTIC_REDACTED")).toBeTruthy();
    expect(renderedText).not.toContain(sourceMarker);
    expect(renderedText).not.toContain("UNTRUSTED_PRIVATE_CODE");
    expect(renderedText).not.toContain("D:\\private\\workspace");
    expect(renderedText).not.toContain("D:\\private\\");
  });

  it("StrictMode 下跨页恢复训练草稿、实际范围和源码位置，且生成与评分各执行一次", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const generation = deferred<Awaited<ReturnType<XRayApi["createOwnershipQuestions"]>>>();
    const scoring = deferred<Awaited<ReturnType<XRayApi["gradeOwnershipAnswer"]>>>();
    api.createOwnershipQuestions = vi.fn(() => generation.promise);
    api.gradeOwnershipAnswer = vi.fn(() => scoring.promise);
    const module = { id: "module-src", name: "src", qualifiedName: "src", fileCount: 1, symbolCount: 1, relationCount: 0 };
    const architectureFile = { id: "file-b", snapshotId: "snap-one", kind: "file" as const, name: "b.ts", qualifiedName: "b.ts", filePath: "b.ts", language: "TypeScript", span: { filePath: "b.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 24 }, metadata: {} };
    api.getModuleOverview = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: "1.0.0" as const, query: input.query, modules: [module], moduleTotal: 1, relations: [], relationTotal: 0, references: [], referenceTotal: 0, referencesTruncated: false, scope: "visible-module-page" as const }));
    api.expandModule = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, module, nodes: [architectureFile], relations: [], truncated: false }));
    window.xray = api;
    const prompt = { repositoryId: "repo", snapshotId: "snap-one", version: "2.0.0" as const, id: "q", kind: "entry" as const, prompt: "定位 login", concept: { id: "definition:login", label: "login 定义" }, learningObjective: "定位定义", difficulty: "easy" as const, choices: [{ nodeId: "login", label: "login", detail: "function · login" }], variantKey: "definition:ev" };
    const nextPrompt = { ...prompt, id: "q-next", prompt: "定位 login 的第二处定义证据", variantKey: "definition:ev:next" };
    const user = userEvent.setup();
    const view = render(<StrictMode><App /></StrictMode>);
    await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    expect(api.createOwnershipQuestions).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /架构地图/ }));
    await screen.findByTestId("architecture-overview");
    await act(async () => generation.resolve([prompt, nextPrompt]));
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    expect(await screen.findByText("1. 范围：整个项目")).toBeTruthy();
    expect(api.createOwnershipQuestions).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByRole("combobox", { name: "选择定义符号" }), "login");
    await user.type(screen.getByRole("textbox", { name: "自由文本学习记录" }), "从定义确认入口，稍后继续核验。");
    await user.click(await screen.findByRole("button", { name: "a.ts" }));
    await screen.findByTestId("mock-editor");
    await user.click(screen.getByRole("button", { name: "引用选中范围" }));
    await screen.findByText("源码引用 1");
    await user.click(screen.getByRole("button", { name: "重新定位" }));

    await user.click(screen.getByRole("button", { name: /架构地图/ }));
    await user.click(await screen.findByRole("button", { name: "列表" }));
    await user.click(await screen.findByRole("button", { name: "展开文件 →" }));
    await user.click(await screen.findByRole("button", { name: "符号与源码 →" }));
    await user.click(await screen.findByRole("button", { name: "打开文件源码" }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("b.ts"));
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("a.ts"));
    expect(screen.getByRole("combobox", { name: "选择定义符号" })).toHaveProperty("value", "login");
    expect((screen.getByRole("textbox", { name: "自由文本学习记录" }) as HTMLTextAreaElement).value).toBe("从定义确认入口，稍后继续核验。");
    expect(screen.getByRole("region", { name: "已添加源码引用" }).textContent).toContain("源码引用 1");
    expect(screen.getByTestId("source-viewer").getAttribute("data-monaco-selection")).toBe("1:0-1:22");

    await user.click(screen.getByRole("button", { name: "提交并核验结构" }));
    expect(api.gradeOwnershipAnswer).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /架构地图/ }));
    const submission = vi.mocked(api.gradeOwnershipAnswer).mock.calls[0]![0];
    await act(async () => scoring.resolve({ repositoryId: submission.repositoryId, snapshotId: submission.snapshotId, questionId: submission.questionId, passed: true, location: { score: 100, status: "passed" }, structure: { score: 100, status: "passed" }, semantic: { status: "not-evaluated", message: "未评估" }, feedback: ["跨页核验完成"], revealedEvidenceIds: ["ev"], validatedCitations: submission.citations, scoringVersion: OWNERSHIP_SCORING_VERSION }));
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    expect(await screen.findByText("跨页核验完成")).toBeTruthy();
    expect(api.gradeOwnershipAnswer).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "下一题" }));
    expect(await screen.findByText("定位 login 的第二处定义证据")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "自由文本学习记录" }), "第二题草稿也需保留");
    await user.click(screen.getByRole("button", { name: /架构地图/ }));
    await screen.findByTestId("architecture-file");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    expect(await screen.findByText("问题 2/2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "定位 login 的第二处定义证据" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "自由文本学习记录" }) as HTMLTextAreaElement).value).toBe("第二题草稿也需保留");
    expect(api.createOwnershipQuestions).toHaveBeenCalledTimes(1);
    expect(api.gradeOwnershipAnswer).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(indexSubscriptions).toBe(indexUnsubscriptions);
  });

  it("训练源码导航在离开页面后失效，不会覆盖架构页并在返回时按保存位置读取", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const firstRead = deferred<SourceFileResult>(); const restoredRead = deferred<SourceFileResult>();
    api.readSource = vi.fn().mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(restoredRead.promise);
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" })); await screen.findByText("定位 login");
    await user.click(await screen.findByRole("button", { name: "a.ts" }));
    await waitFor(() => expect(api.readSource).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /架构地图/ }));
    await act(async () => firstRead.resolve(sourceResult("repo", "snap-one", "a.ts", "OLD-TRAINING-READ")));
    expect(screen.queryByTestId("source-viewer")).toBeNull();
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await waitFor(() => expect(api.readSource).toHaveBeenCalledTimes(2));
    await act(async () => restoredRead.resolve(sourceResult("repo", "snap-one", "a.ts", "RESTORED-TRAINING-READ")));
    expect(await screen.findByText("RESTORED-TRAINING-READ")).toBeTruthy();
    expect(screen.queryByText("OLD-TRAINING-READ")).toBeNull();
  });

  it("用户关闭训练源码面板后跨页返回仍保持关闭，并可从恢复入口主动重新打开", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" })); await screen.findByText("定位 login");
    await user.click(await screen.findByRole("button", { name: "a.ts" })); await screen.findByTestId("source-viewer");
    await user.click(screen.getByRole("button", { name: "关闭源码" }));
    expect(screen.queryByTestId("source-viewer")).toBeNull();
    const readsWhenClosed = vi.mocked(api.readSource).mock.calls.length;
    await user.click(screen.getByRole("button", { name: /架构地图/ })); await screen.findByTestId("architecture-overview");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    expect(screen.queryByTestId("source-viewer")).toBeNull();
    expect(api.readSource).toHaveBeenCalledTimes(readsWhenClosed);
    await user.click(await screen.findByRole("button", { name: /重新打开上次训练源码/ }));
    await screen.findByTestId("source-viewer");
    expect(api.readSource).toHaveBeenCalledTimes(readsWhenClosed + 1);
  });

  it("工作区过期会保留草稿并拒绝旧评分回写；新快照提供只读查看和显式丢弃", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const scoring = deferred<Awaited<ReturnType<XRayApi["gradeOwnershipAnswer"]>>>();
    api.gradeOwnershipAnswer = vi.fn(() => scoring.promise);
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" })); await screen.findByText("定位 login");
    await user.selectOptions(screen.getByRole("combobox", { name: "选择定义符号" }), "login");
    await user.type(screen.getByRole("textbox", { name: "自由文本学习记录" }), "旧快照草稿笔记保留");
    await user.click(await screen.findByRole("button", { name: "a.ts" })); await screen.findByTestId("mock-editor");
    await user.click(screen.getByRole("button", { name: "引用选中范围" })); await screen.findByText("源码引用 1");
    await user.click(screen.getByRole("button", { name: "提交并核验结构" }));
    expect(api.gradeOwnershipAnswer).toHaveBeenCalledTimes(1);

    state = "stale"; fireEvent.focus(window);
    await screen.findByTestId("training-stale");
    expect((screen.getByRole("button", { name: "提交并核验结构" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => scoring.reject(new Error("旧快照迟到的评分失败")));
    expect(screen.getByTestId("training-stale")).toBeTruthy();
    expect(screen.queryByText("旧快照迟到的评分失败")).toBeNull();
    expect(screen.queryByRole("button", { name: "重试提交" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "更新索引" }));
    await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-two") }));
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await screen.findByRole("heading", { name: "选择学习范围" });
    expect(screen.queryByRole("heading", { name: "定位 login" })).toBeNull();
    await user.click(await screen.findByRole("button", { name: /查看快照 snap-one/ }));
    const archived = screen.getByTestId("archived-training-preview");
    expect(archived.textContent).toContain("定位 login");
    expect(archived.textContent).toContain("旧快照草稿笔记保留");
    expect(archived.textContent).toContain("a.ts:1:0");
    expect(screen.getByRole("button", { name: /丢弃旧草稿 snap-one/ })).toBeTruthy();
  });

  it("过期会话中的迟到题目成功和 finally 都不能恢复当前训练", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const generation = deferred<Awaited<ReturnType<XRayApi["createOwnershipQuestions"]>>>();
    api.createOwnershipQuestions = vi.fn(() => generation.promise); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    expect(api.createOwnershipQuestions).toHaveBeenCalledTimes(1);
    state = "stale"; fireEvent.focus(window); await screen.findByTestId("training-stale");
    await act(async () => generation.resolve([{ repositoryId: "repo", snapshotId: "snap-one", version: "2.0.0", id: "late", kind: "entry", prompt: "迟到的旧题目", concept: { id: "old", label: "旧概念" }, learningObjective: "old", difficulty: "easy", choices: [], variantKey: "old" }]));
    expect(screen.getByTestId("training-stale")).toBeTruthy();
    expect(screen.queryByText("迟到的旧题目")).toBeNull();
    expect(screen.queryByText("正在读取当前快照的已验证事实。")).toBeNull();
    expect((screen.getByRole("button", { name: "生成结构化题目" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("同一快照经重新索引和后端确认后恢复调用流搜索与查询", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const login: GraphNode = { id: "login", snapshotId: "snap-one", kind: "function", name: "login", qualifiedName: "auth.login", filePath: "a.ts", span: evidence.span, metadata: {} };
    api.search = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [login], total: 1 }));
    api.queryGraph = vi.fn(async (input): Promise<GraphQueryResponse> => {
      const { continuationCursor: _cursor, ...query } = input;
      return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [login], edges: [], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 1, scannedEdges: 0, returnedNodes: 1, returnedEdges: 0, depthReached: 1 } };
    });
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    const searchInput = screen.getByRole("textbox", { name: "搜索符号" });
    await user.type(searchInput, "login"); await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "选择符号" }), "login");
    await user.click(screen.getByRole("button", { name: "查询关系" }));
    await screen.findByText("auth.login");
    expect(api.search).toHaveBeenCalledTimes(1); expect(api.queryGraph).toHaveBeenCalledTimes(1);

    state = "stale"; fireEvent.focus(window);
    await screen.findByTestId("stale-banner");
    expect((screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "查询关系" }) as HTMLButtonElement).disabled).toBe(true);

    state = "current";
    await user.click(screen.getByRole("button", { name: "更新索引" }));
    await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-one") }));
    await waitFor(() => expect(screen.queryByTestId("stale-banner")).toBeNull());

    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    expect((await screen.findByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "选择符号" }), "login");
    await user.click(screen.getByRole("button", { name: "查询关系" }));
    await waitFor(() => expect(api.queryGraph).toHaveBeenCalledTimes(2));
    expect(screen.getByText("auth.login")).toBeTruthy();
    expect(api.search).toHaveBeenCalledTimes(2);
  });

  it("后续校验异常不保留旧current并关闭依赖当前源码的操作", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api;
    render(<App />); await screen.findByText("不可变证据快照");
    await waitFor(() => expect(api.getSnapshotState).toHaveBeenCalled());
    vi.mocked(api.getSnapshotState).mockRejectedValue(new Error("固定校验错误"));
    fireEvent.focus(window); await screen.findByTestId("snapshot-unavailable");
    fireEvent.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    expect(await screen.findByRole("button", { name: "搜索" })).toHaveProperty("disabled", true);
  });

  it("校验不可用时不声称工作区变化、不显示差异数，并在重新索引后恢复", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); state = "unavailable"; window.xray = api;
    const user = userEvent.setup(); render(<App />);
    const banner = await screen.findByTestId("snapshot-unavailable");
    expect(banner.textContent).toContain("无法校验当前工作区"); expect(banner.textContent).toContain("没有判定源码或配置已变化");
    expect(banner.textContent).not.toContain("新增 0"); expect(banner.textContent).not.toContain("修改 0"); expect(banner.textContent).not.toContain("删除/重命名 0");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    expect((await screen.findByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/无法校验当前工作区.*历史关系结果仍可查看/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /所有权模式/ }));
    const trainingState = await screen.findByTestId("training-stale"); expect(trainingState.textContent).toContain("无法校验当前工作区"); expect(trainingState.textContent).not.toContain("工作区已变化");
    state = "current"; await user.click(screen.getByRole("button", { name: "重新索引" })); await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-one") }));
    await waitFor(() => expect(screen.queryByTestId("snapshot-unavailable")).toBeNull());
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    expect((await screen.findByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["failed", "cancelled"] as const)("索引%s时仍保留调用流的过期门禁", async (outcome) => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    state = "stale"; fireEvent.focus(window); await screen.findByTestId("stale-banner");
    await user.click(screen.getByRole("button", { name: "更新索引" })); await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    const taskId = "22222222-2222-4222-8222-222222222222";
    await act(async () => listener!(outcome === "failed"
      ? { protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId, rootPath: "C:\\demo", repositoryId: "repo", code: "TASK_FAILED", retryable: true }
      : { protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId, rootPath: "C:\\demo", repositoryId: "repo", message: "cancelled" }));
    expect(screen.getByTestId("stale-banner")).toBeTruthy();
    expect((screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.search).not.toHaveBeenCalled(); expect(api.queryGraph).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("重新激活后的新搜索不受旧请求 %s 与 finally 回写影响", async (settlement) => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const oldSearch = deferred<Awaited<ReturnType<XRayApi["search"]>>>();
    const newSearch = deferred<Awaited<ReturnType<XRayApi["search"]>>>();
    api.search = vi.fn().mockReturnValueOnce(oldSearch.promise).mockReturnValueOnce(newSearch.promise);
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await user.type(screen.getByRole("textbox", { name: "搜索符号" }), "old"); await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(api.search).toHaveBeenCalledTimes(1);
    state = "stale"; fireEvent.focus(window); await screen.findByTestId("stale-banner");
    state = "current"; await user.click(screen.getByRole("button", { name: "更新索引" })); await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-one") }));
    await waitFor(() => expect(screen.queryByTestId("stale-banner")).toBeNull());
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    const input = screen.getByRole("textbox", { name: "搜索符号" }); await user.clear(input); await user.type(input, "new"); await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("button", { name: "搜索中…" })).toBeTruthy();
    if (settlement === "resolve") {
      const oldNode: GraphNode = { id: "old", snapshotId: "snap-one", kind: "function", name: "old", qualifiedName: "old.result", metadata: {} };
      await act(async () => oldSearch.resolve({ repositoryId: "repo", snapshotId: "snap-one", items: [oldNode], total: 1 }));
    } else {
      await act(async () => oldSearch.reject(new Error("late old activation failure")));
    }
    expect(screen.getByRole("button", { name: "搜索中…" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const newNode: GraphNode = { id: "new", snapshotId: "snap-one", kind: "function", name: "new", qualifiedName: "new.result", metadata: {} };
    await act(async () => newSearch.resolve({ repositoryId: "repo", snapshotId: "snap-one", items: [newNode], total: 1 }));
    expect(await screen.findByRole("option", { name: /new\.result/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /old\.result/ })).toBeNull();
  });

  it("激活前发起的过期状态检查不能覆盖当前确认，新激活后的过期检查仍然生效", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const stateFor = (ref: { repositoryId: string; snapshotId: string }, status: "current" | "stale"): SnapshotState => ({ ...ref, status, snapshotAvailability: "available", changedFiles: status === "stale" ? ["a.ts"] : [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations: [], checkedAt: new Date().toISOString() });
    const oldCheck = deferred<SnapshotState>(); const newStaleCheck = deferred<SnapshotState>();
    api.getSnapshotState = vi.fn()
      .mockImplementationOnce(async (ref) => stateFor(ref, "current"))
      .mockImplementationOnce(async (ref) => stateFor(ref, "stale"))
      .mockImplementationOnce(() => oldCheck.promise)
      .mockImplementationOnce(async (ref) => stateFor(ref, "current"))
      .mockImplementationOnce(async (ref) => stateFor(ref, "current"))
      .mockImplementationOnce(() => newStaleCheck.promise);
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    fireEvent.focus(window); await screen.findByTestId("stale-banner");
    fireEvent.focus(window); await waitFor(() => expect(api.getSnapshotState).toHaveBeenCalledTimes(3));

    await user.click(screen.getByRole("button", { name: "更新索引" })); await waitFor(() => expect(api.importLocalProject).toHaveBeenCalled());
    await act(async () => listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo", overview: snapshot("snap-one") }));
    await waitFor(() => expect(api.getSnapshotState).toHaveBeenCalledTimes(5));
    await act(async () => oldCheck.resolve(stateFor({ repositoryId: "repo", snapshotId: "snap-one" }, "stale")));
    await waitFor(() => expect(screen.queryByTestId("stale-banner")).toBeNull());
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    expect((screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.focus(window); await waitFor(() => expect(api.getSnapshotState).toHaveBeenCalledTimes(6));
    await act(async () => newStaleCheck.resolve(stateFor({ repositoryId: "repo", snapshotId: "snap-one" }, "stale")));
    await screen.findByTestId("stale-banner");
    expect((screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement).disabled).toBe(true);
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

  it("快照切走再切回后，旧源码成功结果不会重新获得回写资格", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const oldRead = deferred<SourceFileResult>(); api.readSource = vi.fn(() => oldRead.promise); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照"); await openOwnershipSource(user);
    await completeLocalImport(snapshot("snap-two")); await completeLocalImport(snapshot("snap-one"));
    await act(async () => oldRead.resolve(sourceResult("repo", "snap-one", "a.ts", "STALE-SNAPSHOT-A")));
    await user.click(await screen.findByRole("button", { name: /所有权模式/ }));
    expect(screen.queryByText("STALE-SNAPSHOT-A")).toBeNull(); expect(api.readSource).toHaveBeenCalledTimes(1);
  });

  it("项目切换后忽略旧源码读取错误", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const oldRead = deferred<SourceFileResult>(); api.readSource = vi.fn(() => oldRead.promise); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照"); await openOwnershipSource(user);
    await completeLocalImport({ ...snapshot("snap-two"), repositoryId: "repo-two", name: "other" });
    await act(async () => oldRead.reject(new Error("旧项目读取失败")));
    expect(screen.queryByRole("alert")).toBeNull(); expect(screen.queryByText("旧项目读取失败")).toBeNull();
  });

  it.each([
    ["repositoryId", "foreign-repository"],
    ["snapshotId", "foreign-snapshot"],
    ["filePath", "foreign.ts"],
  ] as const)("拒绝展示仓库、快照或文件身份不匹配的源码（%s）", async (field, wrongValue) => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    api.readSource = vi.fn(async (location) => ({ ...sourceResult(location.repositoryId, location.snapshotId, location.filePath, "WRONG-SOURCE"), [field]: wrongValue } as SourceFileResult)); window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照"); await openOwnershipSource(user);
    expect(await screen.findByText(/源码响应与本次请求的仓库、快照或文件不一致，已阻止显示/)).toBeTruthy(); expect(screen.queryByText("WRONG-SOURCE")).toBeNull();
  });

  it("边证据查询期间切换项目后，不会继续读取旧证据源码", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const edge: GraphEdge = { id: "edge-a", snapshotId: "snap-one", source: "a", target: "b", kind: "CALLS", confidence: "verified", evidenceId: "ev", reason: "test edge" };
    api.queryGraph = vi.fn(async (input): Promise<GraphQueryResponse> => { const { continuationCursor: _cursor, ...query } = input; return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [], edges: [edge], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 1, scannedEdges: 1, returnedNodes: 0, returnedEdges: 1, depthReached: 1 } }; });
    const oldEvidence = deferred<Awaited<ReturnType<XRayApi["getEvidence"]>>>(); api.getEvidence = vi.fn(() => oldEvidence.promise); window.xray = api;
    await requestFlowEdge(); expect(api.getEvidence).toHaveBeenCalledTimes(1);
    await completeLocalImport({ ...snapshot("snap-two"), repositoryId: "repo-two", name: "other" });
    await act(async () => oldEvidence.resolve({ ...evidence, repositoryId: "repo", snapshotId: "snap-one" }));
    expect(api.readSource).not.toHaveBeenCalled(); expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["repositoryId", "foreign-repository"],
    ["snapshotId", "foreign-snapshot"],
    ["id", "foreign-evidence"],
  ] as const)("边证据返回身份不匹配时拒绝继续读取源码（%s）", async (field, wrongValue) => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const edge: GraphEdge = { id: "edge-a", snapshotId: "snap-one", source: "a", target: "b", kind: "CALLS", confidence: "verified", evidenceId: "ev", reason: "test edge" };
    api.queryGraph = vi.fn(async (input): Promise<GraphQueryResponse> => { const { continuationCursor: _cursor, ...query } = input; return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [], edges: [edge], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 1, scannedEdges: 1, returnedNodes: 0, returnedEdges: 1, depthReached: 1 } }; });
    const oldEvidence = deferred<Awaited<ReturnType<XRayApi["getEvidence"]>>>(); api.getEvidence = vi.fn(() => oldEvidence.promise); window.xray = api;
    await requestFlowEdge();
    await act(async () => oldEvidence.resolve({ ...evidence, repositoryId: "repo", snapshotId: "snap-one", [field]: wrongValue }));
    expect(await screen.findByText(/证据与本次请求的仓库、快照或标识不一致，已阻止源码导航/)).toBeTruthy(); expect(api.readSource).not.toHaveBeenCalled();
  });

  it("比较启动窗口与页面卸载期间接收早到报告，返回后不重复启动", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const starting = deferred<Awaited<ReturnType<XRayApi["startComparison"]>>>();
    api.startComparison = vi.fn(() => starting.promise);
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /Git 变更/ }));
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    expect(api.startComparison).toHaveBeenCalledTimes(1);
    expect((await screen.findByTestId("comparison-task-tray")).textContent).toContain("正在启动");
    await user.click(screen.getByRole("button", { name: /架构地图/ })); await screen.findByTestId("architecture-overview");
    const report = comparisonReport("repo", "report-across-pages");
    act(() => comparisonListener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "55555555-5555-4555-8555-555555555555", repositoryId: "repo", report }));
    await act(async () => starting.resolve({ protocolVersion: TASK_PROTOCOL_VERSION, taskId: "55555555-5555-4555-8555-555555555555", repositoryId: "repo", mode: "working" }));
    await waitFor(() => expect(screen.getByTestId("comparison-task-tray").textContent).toContain("报告已生成"));
    expect(api.cancelComparison).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "打开任务" }));
    expect((await screen.findByTestId("comparison-identities")).getAttribute("data-report-id")).toBe("report-across-pages");
    expect(api.startComparison).toHaveBeenCalledTimes(1);
  });

  it("调用流查询、选中关系和源码位置在架构页往返后恢复", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const login: GraphEdge = { id: "flow-edge", snapshotId: "snap-one", source: "login", target: "validate", kind: "CALLS", confidence: "verified", evidenceId: "ev", reason: "登录请求调用校验" };
    const symbol: GraphNode = { id: "login", snapshotId: "snap-one", kind: "function", name: "login", qualifiedName: "auth.login", filePath: "a.ts", span: evidence.span, metadata: {} };
    const file: GraphNode = { id: "file-b", snapshotId: "snap-one", kind: "file", name: "b.ts", qualifiedName: "b.ts", filePath: "b.ts", language: "TypeScript", span: { ...evidence.span, filePath: "b.ts" }, metadata: {} };
    api.search = vi.fn(async (input): Promise<Awaited<ReturnType<XRayApi["search"]>>> => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [symbol], total: 1 }));
    api.queryGraph = vi.fn(async (input): Promise<GraphQueryResponse> => { const { continuationCursor: _cursor, ...query } = input; return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: [symbol], edges: [login], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 1, scannedEdges: 1, returnedNodes: 1, returnedEdges: 1, depthReached: 1 } }; });
    const module = { id: "module-src", name: "src", qualifiedName: "src", fileCount: 1, symbolCount: 1, relationCount: 0 };
    api.getModuleOverview = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: "1.0.0" as const, query: input.query, modules: [module], moduleTotal: 1, relations: [], relationTotal: 0, references: [], referenceTotal: 0, referencesTruncated: false, scope: "visible-module-page" as const }));
    api.expandModule = vi.fn(async (input): Promise<Awaited<ReturnType<XRayApi["expandModule"]>>> => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, module, nodes: [file], relations: [], truncated: false }));
    api.getEvidence = vi.fn(async (input) => ({ ...evidence, repositoryId: input.repositoryId, snapshotId: input.snapshotId }));
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await user.type(screen.getByRole("textbox", { name: "搜索符号" }), "login"); await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "选择符号" }), "login");
    await user.click(screen.getByRole("button", { name: "查询关系" }));
    await user.click(await screen.findByRole("button", { name: /CALLS · 登录请求调用校验/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("a.ts"));
    await user.click(screen.getByRole("button", { name: /架构地图/ })); await user.click(await screen.findByRole("button", { name: "列表" }));
    await user.click(await screen.findByRole("button", { name: "展开文件 →" }));
    await user.click(await screen.findByRole("button", { name: "符号与源码 →" })); await user.click(await screen.findByRole("button", { name: "打开文件源码" }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("b.ts"));
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("a.ts"));
    expect(screen.getByText("实际查询起点").parentElement?.textContent).toContain("auth.login");
    expect(screen.getByText(/已选 flow-edge/)).toBeTruthy();
    expect(vi.mocked(api.queryGraph).mock.calls.filter(([input]) => input.view === "call")).toHaveLength(1);
  });

  it("已有源码打开时，边和节点导航仍切换文件并更新同文件范围", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const location = (filePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number) => ({ filePath, startLine, startColumn, endLine, endColumn });
    const pythonSpan = location("src/context.py", 12, 4, 12, 11);
    const firstTsCallSpan = location("src/nested.ts", 3, 9, 3, 16);
    const helperSpan = location("src/nested.ts", 5, 2, 5, 8);
    const secondHelperSpan = location("src/nested.ts", 9, 4, 9, 17);
    const clean: GraphNode = { id: "clean", snapshotId: "snap-one", kind: "function", name: "clean", qualifiedName: "context.clean", filePath: "src/context.py", span: pythonSpan, metadata: {} };
    const outerA: GraphNode = { id: "outerA", snapshotId: "snap-one", kind: "function", name: "outerA", qualifiedName: "nested.outerA", filePath: "src/nested.ts", span: location("src/nested.ts", 1, 0, 10, 1), metadata: {} };
    const helper: GraphNode = { id: "helper", snapshotId: "snap-one", kind: "function", name: "helper", qualifiedName: "nested.outerA.helper", filePath: "src/nested.ts", span: helperSpan, metadata: {} };
    const firstPythonEdge: GraphEdge = { id: "python-call", snapshotId: "snap-one", source: "clean", target: "clean-helper", kind: "CALLS", confidence: "verified", evidenceId: "python-call-evidence", reason: "Python 装饰函数调用 helper" };
    const firstTsEdge: GraphEdge = { id: "ts-call-first", snapshotId: "snap-one", source: "outerA", target: "helper", kind: "CALLS", confidence: "verified", evidenceId: "ts-call-first-evidence", reason: "TS 调用 helper 第一处" };
    const secondTsEdge: GraphEdge = { id: "ts-call-second", snapshotId: "snap-one", source: "outerA", target: "helper", kind: "CALLS", confidence: "verified", evidenceId: "ts-call-second-evidence", reason: "TS 调用 helper 第二处" };
    const spans = new Map([["python-call-evidence", pythonSpan], ["ts-call-first-evidence", firstTsCallSpan], ["ts-call-second-evidence", secondHelperSpan]]);
    api.search = vi.fn(async (input): Promise<Awaited<ReturnType<XRayApi["search"]>>> => {
      const item = input.query === "clean" ? clean : outerA;
      return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [item], total: 1 };
    });
    api.queryGraph = vi.fn(async (input): Promise<GraphQueryResponse> => {
      const { continuationCursor: _cursor, ...query } = input;
      const isPython = input.rootNodeIds[0] === "clean";
      return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query, nodes: isPython ? [clean] : [outerA, helper], edges: isPython ? [firstPythonEdge] : [firstTsEdge, secondTsEdge], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 2, scannedEdges: isPython ? 1 : 2, returnedNodes: isPython ? 1 : 2, returnedEdges: isPython ? 1 : 2, depthReached: 1 } };
    });
    api.getEvidence = vi.fn(async (input) => ({ ...evidence, id: input.evidenceId, repositoryId: input.repositoryId, snapshotId: input.snapshotId, span: spans.get(input.evidenceId)! }));
    api.readSource = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, filePath: input.filePath, language: input.filePath.endsWith(".py") ? "Python" : "TypeScript", content: input.filePath.endsWith(".py") ? "def clean(): pass" : "function outerA() { function helper() {} }", contentHash: `${input.filePath}:${input.startLine}:${input.startColumn}`, workspaceStatus: "current" as const, targetSpan: input, ...(input.evidenceId ? { evidence: { ...evidence, id: input.evidenceId, repositoryId: input.repositoryId, snapshotId: input.snapshotId, span: spans.get(input.evidenceId)! } } : {}) }));
    window.xray = api;

    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await user.type(screen.getByRole("textbox", { name: "搜索符号" }), "clean"); await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(await screen.findByRole("button", { name: "查询关系" }));
    await user.click(await screen.findByRole("button", { name: /Python 装饰函数调用 helper/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("src/context.py"));
    expect(screen.getByTestId("source-viewer").getAttribute("data-monaco-selection")).toBe("12:4-12:11");

    await user.clear(screen.getByRole("textbox", { name: "搜索符号" })); await user.type(screen.getByRole("textbox", { name: "搜索符号" }), "outerA");
    await user.click(screen.getByRole("button", { name: "搜索" })); await user.click(await screen.findByRole("button", { name: "查询关系" }));
    await user.click(await screen.findByRole("button", { name: /TS 调用 helper 第一处/ }));
    await waitFor(() => expect(api.readSource).toHaveBeenCalledWith(expect.objectContaining({ filePath: "src/nested.ts", startLine: 3, startColumn: 9 })));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("src/nested.ts"));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-monaco-selection")).toBe("3:9-3:16"));

    await user.click(screen.getByRole("button", { name: "节点列表" }));
    await user.click(await screen.findByRole("button", { name: /helper.*src\/nested\.ts/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-monaco-selection")).toBe("5:2-5:8"));
    await user.click(screen.getByRole("button", { name: /TS 调用 helper 第二处/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-monaco-selection")).toBe("9:4-9:17"));
    expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("src/nested.ts");
    expect(vi.mocked(api.readSource).mock.calls.map(([request]) => `${request.filePath}:${request.startLine}:${request.startColumn}`)).toContain("src/nested.ts:3:9");
  });

  it("功能解释在切页期间完成一次，返回后恢复已提交问题、结果和独立源码位置", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot());
    const explanation = deferred<Awaited<ReturnType<XRayApi["explainFeature"]>>>();
    api.explainFeature = vi.fn(() => explanation.promise);
    api.getEvidence = vi.fn(async (input) => ({ ...evidence, repositoryId: input.repositoryId, snapshotId: input.snapshotId }));
    window.xray = api;
    const user = userEvent.setup(); render(<App />); await screen.findByText("不可变证据快照");
    await user.click(screen.getByRole("button", { name: /功能解释/ }));
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "登录");
    await user.click(screen.getByRole("button", { name: "开始追踪" }));
    expect(api.explainFeature).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await user.click(screen.getByRole("button", { name: /功能解释/ }));
    expect((await screen.findByTestId("explanation-state")).textContent).toBe("追踪中");
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await act(async () => explanation.resolve({ repositoryId: "repo", snapshotId: "snap-one", title: "登录处理", summary: "静态解释结果", structure: "ordered-path", steps: [{ order: 1, title: "入口", description: "处理登录请求", nodeIds: ["login"], evidenceIds: ["ev"], confidence: "verified" }], unknowns: ["运行时可能存在动态分派"] }));
    await user.click(screen.getByRole("button", { name: /功能解释/ }));
    expect(await screen.findByText("登录处理")).toBeTruthy(); expect(screen.getByText("登录").parentElement?.textContent).toContain("本结果对应的问题");
    await user.click(screen.getByRole("button", { name: "定位源码范围" }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("a.ts"));
    await user.click(screen.getByRole("button", { name: /调用 \/ 数据流/ }));
    await user.click(screen.getByRole("button", { name: /功能解释/ }));
    await waitFor(() => expect(screen.getByTestId("source-viewer").getAttribute("data-source-file")).toBe("a.ts"));
    expect(api.explainFeature).toHaveBeenCalledTimes(1);
  });

  it("项目切换后旧比较仍归属原仓库且可从任务入口返回", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api; const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole("button", { name: /Git 变更/ })); await user.click(screen.getByRole("button", { name: "生成比较报告" })); await waitFor(() => expect(comparisonListener).toBeDefined());
    state = "stale"; fireEvent.focus(window); await user.click(await screen.findByRole("button", { name: "更新索引" })); await waitFor(() => expect(listener).toBeDefined());
    listener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "22222222-2222-4222-8222-222222222222", rootPath: "C:\\demo", repositoryId: "repo-two", overview: { ...snapshot("snap-two"), repositoryId: "repo-two", name: "other" } });
    await screen.findAllByText("other"); expect(api.cancelComparison).not.toHaveBeenCalled();
    expect(screen.getByTestId("comparison-task-tray").textContent).toContain("demo · Index → 工作区");
    expect(screen.getByTestId("comparison-task-tray").textContent).toContain("正在比较");
    await user.click(screen.getByRole("button", { name: "打开任务" }));
    expect(screen.getByTestId("comparison-project-focus").textContent).toContain("正在查看后台任务项目：demo");
    expect(screen.queryByTestId("comparison-identities")).toBeNull();
  });

  it("选择比较模式并从重命名文件打开左侧不可变源码", async () => {
    api.getCurrentProject = vi.fn(async () => snapshot()); window.xray = api; const user = userEvent.setup(); render(<App />); await user.click(await screen.findByRole("button", { name: /Git 变更/ })); await user.selectOptions(screen.getByRole("combobox", { name: "比较模式" }), "staged"); await user.click(screen.getByRole("button", { name: "生成比较报告" })); await waitFor(() => expect(comparisonListener).toBeDefined());
    const identity = { graphIrVersion: "1.1.0", analyzerVersions: { test: "1" }, configurationHash: "cfg", sourceFingerprint: "src" }; const leftSpan = { filePath: "old.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 }; const rightSpan = { ...leftSpan, filePath: "new.ts" }; const exclusions = { ignored: { count: 0, paths: [] }, secrets: { count: 0, paths: [] }, unsupported: { count: 0, paths: [] }, binary: { count: 0, paths: [] }, oversized: { count: 0, paths: [] }, submodules: { count: 0, paths: [] } }; const sideCompleteness = { status: "complete" as const, indexedFiles: 1, failures: [], exclusions, limitations: [] }; const rightCompleteness = { ...sideCompleteness, status: "partial" as const, failures: [{ filePath: "new.ts", code: "TYPESCRIPT_SYNTAX_ERROR" as const, detailCode: "TS1005", reason: "TypeScript 存在语法错误（详情已隐藏）" }] }; const report: ChangeReport = { version: CHANGESET_VERSION, id: "report", repositoryId: "repo", mode: "staged", createdAt: new Date().toISOString(), left: { label: "HEAD", kind: "commit", revision: "a".repeat(40), contentFingerprint: "left", manifestFingerprint: "cfg", capturedAt: new Date().toISOString(), snapshot: { repositoryId: "repo", snapshotId: "left-snap" }, analysisIdentity: identity, completeness: sideCompleteness }, right: { label: "Index", kind: "index", contentFingerprint: "right", manifestFingerprint: "cfg", capturedAt: new Date().toISOString(), snapshot: { repositoryId: "repo", snapshotId: "right-snap" }, analysisIdentity: identity, completeness: rightCompleteness }, captureFingerprint: "capture", status: "current", files: [{ id: "change", status: "renamed", oldPath: "old.ts", newPath: "new.ts", similarity: 95, classification: "source", classificationReason: "source", classificationConfidence: "verified", additions: 1, deletions: 1, binary: false, analyzable: true, hunks: [], directChanges: [{ id: "left-direct", side: "left", match: "file", nodeId: "old-file", span: leftSpan, reason: "file" }, { id: "right-direct", side: "right", match: "file", nodeId: "new-file", span: rightSpan, reason: "file" }] }], impactPaths: [], queryBudget: { maxDepth: 4, maxPaths: 30, maxWork: 5000 }, completeness: { status: "partial", unmappedChanges: [], impact: { status: "partial", reasons: ["一侧分析不完整"], unknownEdgeCount: 0 } }, truncated: false, truncationReasons: [], failures: [{ scope: "right:new.ts", code: "TYPESCRIPT_SYNTAX_ERROR" as const, detailCode: "TS1005", reason: "TypeScript 存在语法错误（详情已隐藏）" }], limitations: [] };
    comparisonListener!({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: "55555555-5555-4555-8555-555555555555", repositoryId: "repo", report }); expect((await screen.findByTestId("comparison-partial")).textContent).toMatch(/new\.ts.*TS1005/); await user.click(await screen.findByRole("button", { name: /renamed · old\.ts/ })); await waitFor(() => expect(api.readSource).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: "left-snap", filePath: "old.ts" })));
  });
});
