// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CHANGESET_VERSION, TASK_PROTOCOL_VERSION, type ChangeReport, type ComparisonMode, type ComparisonTaskEvent, type ProjectOverview, type SourceFileResult, type XRayApi } from "@project-xray/contracts";
import { ChangeExplorer } from "./ChangeExplorer";
import { createOwnershipSessionController, type OwnershipSessionController } from "../state/ownership-sessions";

vi.mock("./SourceViewer", () => ({
  SourceViewer: ({ project, source }: { project: { snapshotId: string }; source: SourceFileResult | null }) => <div data-testid="source-viewer" data-snapshot-id={project.snapshotId} data-source-file={source?.filePath ?? ""}>{source?.content ?? "empty"}</div>,
}));

const project = (): ProjectOverview => ({
  repositoryId: "repo", snapshotId: "current-snapshot", name: "demo", rootPath: "C:\\demo", sourceType: "local", createdAt: "2026-09-25T00:00:00.000Z",
  analysisIdentity: { graphIrVersion: "1.2.0", analyzerVersions: {}, configurationHash: "cfg", sourceFingerprint: "source" },
  health: { status: "ready", totalFiles: 2, indexedFiles: 2, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: {}, limitations: [] },
  counts: { nodes: 0, edges: 0, evidence: 0, modules: 0, files: 2, calls: 0, unknown: 0 },
});

const changedFile = (id: string, path: string) => ({
  id, status: "modified", oldPath: path, newPath: path, classification: "source", classificationReason: "source code", classificationConfidence: "verified", additions: 1, deletions: 1, binary: false, analyzable: true, hunks: [],
  directChanges: [
    { id: `${id}-left`, side: "left", match: "file", span: { filePath: path, startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 }, reason: "file changed" },
    { id: `${id}-right`, side: "right", match: "file", span: { filePath: path, startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 }, reason: "file changed" },
  ],
});

const makeReport = (id = "report-one", files: unknown = [changedFile("change-a", "src/a.ts"), changedFile("change-b", "src/b.ts")], mode: ComparisonMode = "working"): ChangeReport => {
  const complete = { status: "complete", indexedFiles: 2, failures: [], exclusions: Object.fromEntries(["ignored", "secrets", "unsupported", "binary", "oversized", "submodules"].map((key) => [key, { count: 0, paths: [] }])), limitations: [] };
  const side = (label: string, snapshotId: string, parentNumber?: number) => ({ label, kind: "commit", revision: `${snapshotId}-revision`, ...(parentNumber ? { parentNumber } : {}), contentFingerprint: `${snapshotId}-fingerprint`, manifestFingerprint: "manifest", capturedAt: "2026-09-25T00:00:00.000Z", snapshot: { repositoryId: "repo", snapshotId }, analysisIdentity: project().analysisIdentity, completeness: complete });
  return {
    version: CHANGESET_VERSION, id, repositoryId: "repo", mode, createdAt: "2026-09-25T00:00:00.000Z",
    left: side(mode === "last-commit" ? "父提交 2" : "Index", "left-snapshot", mode === "last-commit" ? 2 : undefined), right: side(mode === "last-commit" ? "HEAD" : "工作区", "right-snapshot", mode === "last-commit" ? 2 : undefined), captureFingerprint: "capture", status: "current", files,
    impactPaths: [], queryBudget: { maxDepth: 4, maxPaths: 30, maxWork: 5000 },
    completeness: { status: "complete", unmappedChanges: [], impact: { status: "complete", reasons: [], unknownEdgeCount: 0 } },
    truncated: false, truncationReasons: [], failures: [], limitations: [],
  } as unknown as ChangeReport;
};

const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const source = (snapshotId: string, filePath: string, content: string): SourceFileResult => ({ repositoryId: "repo", snapshotId, filePath, language: "TypeScript", content, contentHash: content, workspaceStatus: "current" });
const taskId = "55555555-5555-4555-8555-555555555555";
let sessions: OwnershipSessionController | undefined;

afterEach(() => { cleanup(); sessions = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(overrides: Partial<XRayApi> = {}) {
  const api = {
    onComparisonEvent: vi.fn(() => () => undefined),
    startComparison: vi.fn(async (input) => ({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, repositoryId: input.repositoryId, mode: input.mode })),
    cancelComparison: vi.fn(async () => undefined),
    getChangeReportState: vi.fn(async (input) => ({ ...input, status: "current" as const, checkedAt: "2026-09-25T00:00:00.000Z" })),
    search: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [], total: 0 })),
    readSource: vi.fn(async (input) => source(input.snapshotId, input.filePath, `${input.snapshotId}:${input.filePath}`)),
    ...overrides,
  };
  window.xray = api as unknown as XRayApi;
  sessions = createOwnershipSessionController();
  const view = render(<ChangeExplorer project={project()} sessions={sessions} />);
  return { view, api, sessions };
}

function complete(report = makeReport()): void {
  act(() => sessions?.receiveComparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId, repositoryId: "repo", report }));
}

describe("Git 比较交互", () => {
  it("从启动请求时阻止重复比较，显示实际报告基准并区分已修改的选择器", async () => {
    const start = deferred<Awaited<ReturnType<XRayApi["startComparison"]>>>();
    const startComparison = vi.fn(() => start.promise);
    const { api } = setup({ startComparison });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "比较模式" }), "last-commit");
    await user.clear(screen.getByRole("spinbutton", { name: "父提交序号" }));
    await user.type(screen.getByRole("spinbutton", { name: "父提交序号" }), "2");
    const generate = screen.getByRole("button", { name: "生成比较报告" });
    await user.click(generate);
    await user.click(screen.getByRole("button", { name: "正在启动比较…" }));
    expect(api.startComparison).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain("正在启动本地 Git 比较");
    await act(async () => start.resolve({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, repositoryId: "repo", mode: "last-commit" }));
    complete(makeReport("report-one", undefined, "last-commit"));
    expect(await screen.findByText(/报告基准：父提交 → HEAD · 父提交序号 2/)).toBeTruthy();
    const metadata = document.querySelector<HTMLDetailsElement>(".report-identity-details")!;
    expect(metadata.open).toBe(false); expect(screen.getByRole("region", { name: "变化文件列表" })).toBeTruthy();
    await user.click(metadata.querySelector("summary")!); expect(metadata.open).toBe(true); expect(metadata.textContent).toContain("left-snapshot"); expect(metadata.textContent).toContain("manifest");
    await user.click(metadata.querySelector("summary")!);
    await user.selectOptions(screen.getByRole("combobox", { name: "比较模式" }), "staged");
    expect(screen.getByTestId("report-selection-notice").textContent).toContain("当前报告基准：父提交 → HEAD · 父提交序号 2");
    expect(screen.getByTestId("report-selection-notice").textContent).toContain("选择器已修改为：HEAD → Index");
  });

  it("快速切换文件时丢弃迟到的左右侧源码响应", async () => {
    const waits = new Map<string, ReturnType<typeof deferred<SourceFileResult>>>();
    const readSource = vi.fn((input) => {
      const key = `${input.snapshotId}:${input.filePath}`;
      const wait = deferred<SourceFileResult>(); waits.set(key, wait); return wait.promise;
    });
    const { api } = setup({ readSource });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    await waitFor(() => expect(api.startComparison).toHaveBeenCalled());
    complete();
    await user.click(await screen.findByRole("button", { name: /modified · src\/b\.ts/ }));
    await act(async () => {
      waits.get("left-snapshot:src/b.ts")?.resolve(source("left-snapshot", "src/b.ts", "B LEFT"));
      waits.get("right-snapshot:src/b.ts")?.resolve(source("right-snapshot", "src/b.ts", "B RIGHT"));
    });
    const panes = await screen.findAllByTestId("source-viewer");
    await waitFor(() => {
      expect(panes[0]?.getAttribute("data-source-file")).toBe("src/b.ts");
      expect(panes[1]?.getAttribute("data-source-file")).toBe("src/b.ts");
    });
    await act(async () => {
      waits.get("left-snapshot:src/a.ts")?.resolve(source("left-snapshot", "src/a.ts", "LATE A LEFT"));
      waits.get("right-snapshot:src/a.ts")?.resolve(source("right-snapshot", "src/a.ts", "LATE A RIGHT"));
    });
    expect(panes[0]?.textContent).toContain("B LEFT");
    expect(panes[1]?.textContent).toContain("B RIGHT");
    expect(panes[0]?.getAttribute("data-snapshot-id")).toBe("left-snapshot");
    expect(panes[1]?.getAttribute("data-snapshot-id")).toBe("right-snapshot");
  });

  it("比较启动失败保留旧报告并允许安全重试", async () => {
    const startComparison = vi.fn().mockRejectedValueOnce(new Error("Git 索引暂不可读")).mockResolvedValueOnce({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, repositoryId: "repo", mode: "working" });
    setup({ startComparison });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Git 索引暂不可读");
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(startComparison).toHaveBeenCalledTimes(2));
    expect((screen.getByRole("button", { name: "正在比较…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("父提交序号非法时不发起请求", async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "比较模式" }), "last-commit");
    await user.clear(screen.getByRole("spinbutton", { name: "父提交序号" }));
    await user.type(screen.getByRole("spinbutton", { name: "父提交序号" }), "33");
    expect((screen.getByRole("button", { name: "生成比较报告" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.startComparison).not.toHaveBeenCalled();
  });

  it("筛选无匹配时清掉旧文件和源码，且可以清除筛选恢复列表", async () => {
    const { api } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    await waitFor(() => expect(api.startComparison).toHaveBeenCalled());
    complete();
    await user.type(screen.getByRole("textbox", { name: "搜索变化文件" }), "no-such-file");
    expect(await screen.findByText("没有匹配的变化文件。")).toBeTruthy();
    expect(screen.getByRole("region", { name: "变化详情" })).toBeTruthy();
    expect(screen.getByText("清除筛选后选择一个变化文件。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(await screen.findByRole("button", { name: /modified · src\/a\.ts/ })).toBeTruthy();
  });

  it("仅显示实际存在一侧的源码，并为另一侧说明缺少对应文件", async () => {
    const added = {
      id: "added", status: "added", newPath: "src/new.ts", classification: "source", classificationReason: "source code", classificationConfidence: "verified", additions: 2, deletions: 0, binary: false, analyzable: true, hunks: [],
      directChanges: [{ id: "added-right", side: "right", match: "file", span: { filePath: "src/new.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 }, reason: "new file" }],
    };
    const { api } = setup({ readSource: vi.fn(async (input) => source(input.snapshotId, input.filePath, "new file")) });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    await waitFor(() => expect(api.startComparison).toHaveBeenCalled());
    complete(makeReport("report-added", [added]));
    expect((await screen.findByRole("status")).textContent).toContain("左侧没有对应文件");
    await waitFor(() => expect(api.readSource).toHaveBeenCalledTimes(1));
    const viewers = screen.getAllByTestId("source-viewer");
    expect(viewers[0]?.getAttribute("data-source-file")).toBe("");
    expect(viewers[1]?.getAttribute("data-source-file")).toBe("src/new.ts");
  });

  it("定位影响路径时把该路径的证据 ID 传给精确快照源码读取", async () => {
    const { api } = setup();
    const user = userEvent.setup();
    const report = makeReport();
    const span = { filePath: "src/a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 4 };
    report.impactPaths.push({
      id: "impact-a", changeId: "change-a", side: "right", startNodeId: "validate", nodes: [], edges: [],
      evidence: [{ id: "impact-evidence", snapshotId: "right-snapshot", analyzer: "test", analyzerVersion: "1", kind: "call", confidence: "verified", reason: "fixture", span }],
      confidence: "verified", limitations: [], truncated: false, budget: { maxDepth: 4, maxPaths: 30, maxWork: 5000, usedWork: 1 },
    } as unknown as ChangeReport["impactPaths"][number]);
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    await waitFor(() => expect(api.startComparison).toHaveBeenCalled());
    complete(report);
    const detail = await screen.findByRole("region", { name: "变化详情" });
    await user.click(detail.querySelector(".impact-list button")!);
    await waitFor(() => expect(api.readSource).toHaveBeenCalledWith(expect.objectContaining({
      repositoryId: "repo", snapshotId: "right-snapshot", ...span, evidenceId: "impact-evidence",
    })));
  });

  it("切换报告后忽略旧报告状态检查的迟到响应", async () => {
    type ReportState = Awaited<ReturnType<XRayApi["getChangeReportState"]>>;
    const oldState = deferred<ReportState>(); const newState = deferred<ReportState>();
    const getChangeReportState = vi.fn((input: { repositoryId: string; reportId: string }) => input.reportId === "report-one" ? oldState.promise : newState.promise);
    const { api } = setup({ getChangeReportState });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    await waitFor(() => expect(api.startComparison).toHaveBeenCalled());
    complete();
    await waitFor(() => expect(getChangeReportState).toHaveBeenCalledWith({ repositoryId: "repo", reportId: "report-one" }));
    await user.click(screen.getByRole("button", { name: "生成比较报告" }));
    complete(makeReport("report-two"));
    await waitFor(() => expect(getChangeReportState).toHaveBeenCalledWith({ repositoryId: "repo", reportId: "report-two" }));
    await act(async () => oldState.resolve({ repositoryId: "repo", reportId: "report-one", status: "stale", checkedAt: "2026-09-25T00:00:00.000Z" }));
    expect(screen.queryByTestId("change-report-stale")).toBeNull();
    await act(async () => newState.resolve({ repositoryId: "repo", reportId: "report-two", status: "current", checkedAt: "2026-09-25T00:00:00.000Z" }));
    expect(screen.getByTestId("comparison-identities").getAttribute("data-report-id")).toBe("report-two");
  });

  it("窄内容区用左右侧标签切换源码，并保留每侧独立快照身份", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(private readonly callback: ResizeObserverCallback) {} observe(target: Element) { if (target.classList.contains("change-explorer")) callbacks.push(this.callback); } disconnect() {} unobserve() {} });
    const { api } = setup(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成比较报告" })); await waitFor(() => expect(api.startComparison).toHaveBeenCalled()); complete();
    await screen.findAllByTestId("source-viewer");
    const host = document.querySelector(".change-explorer")!;
    act(() => callbacks[0]?.([{ target: host, contentRect: { width: 760 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    const leftTab = screen.getByRole("tab", { name: "左侧 · Index" }); const rightTab = screen.getByRole("tab", { name: "右侧 · 工作区" });
    expect(rightTab.getAttribute("aria-selected")).toBe("true");
    await user.click(leftTab);
    const sides = document.querySelectorAll<HTMLElement>(".comparison-source-side");
    expect(sides[0]?.hidden).toBe(false); expect(sides[1]?.hidden).toBe(true);
    const panes = screen.getAllByTestId("source-viewer");
    expect(panes[0]?.getAttribute("data-snapshot-id")).toBe("left-snapshot"); expect(panes[0]?.getAttribute("data-source-file")).toBe("src/a.ts");
    expect(panes[1]?.getAttribute("data-snapshot-id")).toBe("right-snapshot");
  });
});
