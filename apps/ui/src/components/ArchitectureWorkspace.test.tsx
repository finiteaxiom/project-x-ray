// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GRAPH_QUERY_VERSION, MODULE_OVERVIEW_VERSION, type GraphQueryRequest, type GraphQueryResponse, type ModuleExpansionResponse, type ProjectOverview, type XRayApi } from "@project-xray/contracts";

vi.mock("./GraphCanvas", () => ({ GraphCanvas: ({ nodes, edges, aggregateRelations = [], onNode, onEdge, onAggregateRelation }: { nodes: Array<{ id: string; name: string }>; edges: Array<{ id: string; kind: string }>; aggregateRelations?: Array<{ id: string; relation: never }>; onNode: (node: never) => void; onEdge: (edge: never) => void; onAggregateRelation?: (relation: never) => void }) => <div data-testid="graph-stub">{nodes.map((node) => <button key={node.id} onClick={() => onNode(node as never)}>{node.name}</button>)}{edges.map((edge) => <button key={edge.id} onClick={() => onEdge(edge as never)}>{edge.kind}</button>)}{aggregateRelations.map((item) => <button key={item.id} onClick={() => onAggregateRelation?.(item.relation)}>{`聚合:${item.id}`}</button>)}</div> }));

import { ArchitectureWorkspace } from "./ArchitectureWorkspace";
import { createOwnershipSessionController, emptyWorkspaceSourceView } from "../state/ownership-sessions";

const project: ProjectOverview = { repositoryId: "repo", snapshotId: "snap", name: "demo", rootPath: "C:\\demo", sourceType: "local", createdAt: "2026-09-21T00:00:00.000Z", analysisIdentity: { graphIrVersion: "1.1.0", analyzerVersions: { test: "1" }, configurationHash: "c", sourceFingerprint: "s" }, health: { status: "ready", totalFiles: 2, indexedFiles: 2, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 2 }, limitations: [] }, counts: { nodes: 6, edges: 3, evidence: 2, modules: 2, files: 2, calls: 1, unknown: 0 } };
const modules = [{ id: "module-a", name: "src", qualifiedName: "src", fileCount: 1, symbolCount: 1, relationCount: 1 }, { id: "module-b", name: "api", qualifiedName: "api", fileCount: 1, symbolCount: 1, relationCount: 1 }];
const fileA = { id: "file-a", snapshotId: "snap", kind: "file" as const, name: "service.ts", qualifiedName: "src/service.ts", filePath: "src/service.ts", language: "TypeScript", span: { filePath: "src/service.ts", startLine: 1, startColumn: 0, endLine: 8, endColumn: 0 }, metadata: {} };
const fileB = { ...fileA, id: "file-b", name: "api.ts", qualifiedName: "api/api.ts", filePath: "api/api.ts", span: { ...fileA.span, filePath: "api/api.ts" } };
const symbol = { id: "symbol-a", snapshotId: "snap", kind: "function" as const, name: "loadAccount", qualifiedName: "src/service.ts:loadAccount", filePath: "src/service.ts", language: "TypeScript", span: { filePath: "src/service.ts", startLine: 2, startColumn: 0, endLine: 5, endColumn: 1 }, metadata: {} };
const neighbor = { ...symbol, id: "symbol-b", name: "readAccount", qualifiedName: "src/service.ts:readAccount", span: { ...symbol.span, startLine: 7, endLine: 9 } };
const edge = { id: "edge-real", snapshotId: "snap", source: "symbol-a", target: "symbol-b", kind: "CALLS" as const, confidence: "verified" as const, evidenceId: "ev-real", reason: "静态目标已解析" };
const aggregate = { sourceModuleId: "module-a", targetModuleId: "module-b", kinds: { CALLS: 1 }, confidences: { verified: 1 }, edgeCount: 1, evidenceIds: [], edges: [], sampledEdgeCount: 0, evidenceTruncated: true };
const overview = { version: MODULE_OVERVIEW_VERSION, repositoryId: "repo", snapshotId: "snap", query: "", modules, moduleTotal: 2, relations: [aggregate], relationTotal: 1, references: [{ id: "style", name: "./styles.css", qualifiedName: "./styles.css", category: "unresolved-module" as const, relationCount: 1, kinds: { IMPORTS: 1 }, confidences: { unknown: 1 } }], referenceTotal: 1, referencesTruncated: false, scope: "visible-module-page" as const };
const expansion = (moduleId: string, file = fileA): ModuleExpansionResponse => ({ repositoryId: "repo", snapshotId: "snap", module: modules.find((item) => item.id === moduleId)!, nodes: [file], relations: moduleId === "module-a" ? [aggregate] : [], truncated: false });
const queryResponse = (input: GraphQueryRequest): GraphQueryResponse => { const { continuationCursor: _cursor, ...query } = input; return { version: GRAPH_QUERY_VERSION, repositoryId: "repo", snapshotId: "snap", query, nodes: [fileA], edges: [], evidence: [], unresolved: [], truncated: false, truncationReasons: [], stats: { expandedNodes: 1, scannedEdges: 0, returnedNodes: 1, returnedEdges: 0, depthReached: 0 } }; };
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe("分层架构工作区", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    window.localStorage.clear(); window.xray = {
      getEvidence: vi.fn(async () => ({ id: "ev-real", repositoryId: "repo", snapshotId: "snap", analyzer: "test-analyzer", analyzerVersion: "1", kind: "call", confidence: "verified", reason: "静态目标已解析", span: symbol.span })),
      getModuleOverview: vi.fn(async () => overview), listModules: vi.fn(), expandModule: vi.fn(async (input) => expansion(input.moduleId, input.moduleId === "module-a" ? fileA : fileB)),
      getModuleRelationEdges: vi.fn(async () => ({ repositoryId: "repo", snapshotId: "snap", sourceModuleId: "module-a", targetModuleId: "module-b", items: [edge], total: 1 })),
      queryGraph: vi.fn(async (input) => queryResponse(input)), search: vi.fn(async (input) => ({ repositoryId: "repo", snapshotId: "snap", items: [symbol], total: 1 })),
    } as unknown as XRayApi;
  });

  it("总览图与列表复用真实聚合数据并进入文件、符号和证据", async () => {
    const user = userEvent.setup(); const onNode = vi.fn(); const onEdge = vi.fn(); const sessions = createOwnershipSessionController(); render(<ArchitectureWorkspace project={project} onNode={onNode} onEdge={onEdge} source={null} sessions={sessions} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={() => undefined} onCloseSource={() => undefined} />);
    await screen.findByText("项目架构关系总览"); expect(screen.getByText("./styles.css")).toBeTruthy(); expect(screen.getByText(/未解析模块引用/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "src" })); await user.click(screen.getByRole("button", { name: "展开文件" })); await screen.findByTestId("architecture-module");
    await user.click(screen.getByRole("button", { name: "符号与源码 →" })); await screen.findByTestId("architecture-file"); await screen.findByTitle("src/service.ts:loadAccount");
    expect(screen.queryByTestId("graph-stub")).toBeNull(); expect(screen.getByText(/第 2–5 行/)).toBeTruthy();
    expect(window.xray.search).toHaveBeenCalledWith(expect.objectContaining({ filePath: "src/service.ts", limit: 50 })); await user.click(screen.getByTitle("src/service.ts:loadAccount")); expect(onNode).toHaveBeenCalledWith(symbol); await screen.findByText(/没有返回已解析的调用关系/);
    await user.click(screen.getByRole("button", { name: "项目概览" })); await user.click(screen.getByRole("button", { name: "聚合:module-a:module-b" })); await user.click(await screen.findByRole("button", { name: /CALLS · 已验证/ })); expect(onEdge).not.toHaveBeenCalled(); await screen.findByText("test-analyzer · 1"); await user.click(screen.getByRole("button", { name: "定位源码证据 →" })); expect(onEdge).toHaveBeenCalledWith(edge);
    await user.click(screen.getByRole("button", { name: "列表" })); expect(screen.getAllByRole("button", { name: "展开文件 →" })).toHaveLength(2);
  });

  it("同快照 A/B 反序完成时只接受 B，返回上层后忽略迟到结果和错误", async () => {
    const user = userEvent.setup(); const a = deferred<ModuleExpansionResponse>(); const b = deferred<ModuleExpansionResponse>(); vi.mocked(window.xray.expandModule).mockImplementation((input) => input.moduleId === "module-a" ? a.promise : b.promise);
    render(<ArchitectureWorkspace project={project} onNode={() => undefined} onEdge={() => undefined} source={null} sessions={createOwnershipSessionController()} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={() => undefined} onCloseSource={() => undefined} />); await screen.findByText("项目架构关系总览");
    await user.click(screen.getByRole("button", { name: "src" })); await user.click(screen.getByRole("button", { name: "展开文件" })); await user.click(screen.getByRole("button", { name: "项目概览" })); await user.click(screen.getByRole("button", { name: "api" })); await user.click(screen.getByRole("button", { name: "展开文件" }));
    b.resolve(expansion("module-b", fileB)); await screen.findByText("api.ts"); a.resolve(expansion("module-a", fileA)); await waitFor(() => expect(screen.queryByText("service.ts")).toBeNull()); expect(screen.getByText("api.ts")).toBeTruthy();
    const late = deferred<ModuleExpansionResponse>(); vi.mocked(window.xray.expandModule).mockReturnValueOnce(late.promise); await user.click(screen.getByRole("button", { name: "项目概览" })); await user.click(screen.getByRole("button", { name: "src" })); await user.click(screen.getByRole("button", { name: "展开文件" })); await user.click(screen.getByRole("button", { name: "项目概览" })); late.reject(new Error("旧请求错误")); await waitFor(() => expect(screen.queryByText("旧请求错误")).toBeNull()); expect(screen.getByText("项目架构关系总览")).toBeTruthy();
  });

  it("选择符号后只绘制返回的真实局部关系，并保留中心、置信度依据和截断说明", async () => {
    const user = userEvent.setup();
    vi.mocked(window.xray.queryGraph).mockImplementation(async (input) => ({ ...queryResponse(input), nodes: [symbol, neighbor], edges: [edge], truncated: true, truncationReasons: ["edges"], stats: { expandedNodes: 2, scannedEdges: 81, returnedNodes: 2, returnedEdges: 1, depthReached: 2 } }));
    const sessions = createOwnershipSessionController();
    const props = { project, onNode: () => undefined, onEdge: () => undefined, source: null, sessions, sourceView: emptyWorkspaceSourceView(), onSourceViewChange: () => undefined, onCloseSource: () => undefined };
    const first = render(<ArchitectureWorkspace {...props} />); await screen.findByText("项目架构关系总览");
    const userModule = screen.getByRole("button", { name: "src" }); await user.click(userModule); await user.click(screen.getByRole("button", { name: "展开文件" })); await user.click(await screen.findByRole("button", { name: "符号与源码 →" }));
    await user.click(await screen.findByTitle("src/service.ts:loadAccount")); await screen.findByRole("button", { name: "CALLS" });
    expect(document.querySelector(".local-graph .section-caption span")?.textContent).toContain("中心：src/service.ts:loadAccount"); expect(screen.getByText(/已截断（edges）/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "CALLS" })); await screen.findByTestId("relation-inspector"); expect(screen.getByText(/静态目标已解析/)).toBeTruthy();
    first.unmount(); render(<ArchitectureWorkspace {...props} />);
    await screen.findByTestId("architecture-file"); expect(document.querySelector(".symbol-list button[title='src/service.ts:loadAccount']")?.getAttribute("aria-pressed")).toBe("true"); expect(screen.getByRole("button", { name: "CALLS" })).toBeTruthy();
    expect(window.xray.search).toHaveBeenCalledTimes(1);
  });
});
