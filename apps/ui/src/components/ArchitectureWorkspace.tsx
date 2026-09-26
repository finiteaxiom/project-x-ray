import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { GRAPH_QUERY_VERSION, MODULE_OVERVIEW_VERSION, type AggregateRelation, type GraphEdge, type GraphNode, type GraphQueryResponse, type ModuleExpansionResponse, type ModuleOverviewResponse, type ModuleSummary, type ProjectOverview, type SnapshotRef, type SourceFileResult } from "@project-xray/contracts";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { GraphCanvas, type AggregateGraphRelation, type GraphViewState } from "./GraphCanvas";

import { RelationInspector } from "./RelationInspector";
import { useWorkspacePageState, type OwnershipSessionController, type WorkspaceSourceView } from "../state/ownership-sessions";

type Level = "overview" | "module" | "file";
type OverviewMode = "graph" | "list";
type FilePane = "symbols" | "relations";
const confidenceText = { verified: "已验证", inferred: "推断", unknown: "未知" } as const;
const referenceText = { "unresolved-module": "未解析模块引用", "external-dependency": "外部包依赖", "unresolved-call": "未解析调用目标", "unsupported-semantic": "证据不足的语义结构" } as const;
const refOf = (project: ProjectOverview): SnapshotRef => ({ repositoryId: project.repositoryId, snapshotId: project.snapshotId });
const relationKey = (relation: AggregateRelation): string => `${relation.sourceModuleId}:${relation.targetModuleId}`;
function ConfidenceLegend(): ReactElement { return <span className="legend"><i className="verified" /> 已验证 <i className="inferred" /> 推断 <i className="unknown" /> 未知</span>; }

export function ArchitectureWorkspace({ project, onNode, onEdge, source, sessions, sourceView, onSourceViewChange, onCloseSource }: { project: ProjectOverview; onNode: (node: GraphNode) => void; onEdge: (edge: GraphEdge) => void; source: SourceFileResult | null; sessions: OwnershipSessionController; sourceView: WorkspaceSourceView; onSourceViewChange: (update: (current: WorkspaceSourceView) => WorkspaceSourceView) => void; onCloseSource: () => void }): ReactElement {
  const ref = refOf(project); const identity = `${project.repositoryId}:${project.snapshotId}`; const projectIdentity = useRef(identity); projectIdentity.current = identity;
  const [level, setLevel] = useWorkspacePageState(sessions, ref, "architecture", "level", "overview" as Level); const [overviewMode, setOverviewMode] = useWorkspacePageState(sessions, ref, "architecture", "overviewMode", "graph" as OverviewMode); const [query, setQuery] = useWorkspacePageState(sessions, ref, "architecture", "query", ""); const [pageCursor, setPageCursor] = useWorkspacePageState<string | undefined>(sessions, ref, "architecture", "pageCursor", undefined); const [pageHistory, setPageHistory] = useWorkspacePageState<Array<string | undefined>>(sessions, ref, "architecture", "pageHistory", []);
  const [overview, setOverview] = useWorkspacePageState<ModuleOverviewResponse | null>(sessions, ref, "architecture", "overview", null); const [selectedModule, setSelectedModule] = useWorkspacePageState<ModuleSummary | null>(sessions, ref, "architecture", "selectedModule", null); const [expanded, setExpanded] = useWorkspacePageState<ModuleExpansionResponse | null>(sessions, ref, "architecture", "expanded", null);
  const [relation, setRelation] = useWorkspacePageState<AggregateRelation | null>(sessions, ref, "architecture", "relation", null); const [relationEdges, setRelationEdges] = useWorkspacePageState<GraphEdge[]>(sessions, ref, "architecture", "relationEdges", []); const [relationCursor, setRelationCursor] = useWorkspacePageState<string | undefined>(sessions, ref, "architecture", "relationCursor", undefined);
  const [selectedFile, setSelectedFile] = useWorkspacePageState<GraphNode | null>(sessions, ref, "architecture", "selectedFile", null); const [dependencyGraph, setDependencyGraph] = useWorkspacePageState<GraphQueryResponse | null>(sessions, ref, "architecture", "dependencyGraph", null);
  const [symbols, setSymbols] = useWorkspacePageState<GraphNode[]>(sessions, ref, "architecture", "symbols", []); const [symbolQuery, setSymbolQuery] = useWorkspacePageState(sessions, ref, "architecture", "symbolQuery", ""); const [symbolCursor, setSymbolCursor] = useWorkspacePageState<string | undefined>(sessions, ref, "architecture", "symbolCursor", undefined); const [symbolTotal, setSymbolTotal] = useWorkspacePageState(sessions, ref, "architecture", "symbolTotal", 0); const [selectedSymbol, setSelectedSymbol] = useWorkspacePageState<GraphNode | null>(sessions, ref, "architecture", "selectedSymbol", null); const [localGraph, setLocalGraph] = useWorkspacePageState<GraphQueryResponse | null>(sessions, ref, "architecture", "localGraph", null);
  const [requestError, setRequestError] = useWorkspacePageState(sessions, ref, "architecture", "requestError", "");
  const [inspectedEdge, setInspectedEdge] = useWorkspacePageState<GraphEdge | null>(sessions, ref, "architecture", "inspectedEdge", null);
  const [graphViews, setGraphViews] = useWorkspacePageState<Record<string, GraphViewState>>(sessions, ref, "architecture", "graphViews", {});
  const [savedScrollPositions, setSavedScrollPositions] = useWorkspacePageState<Record<string, number>>(sessions, ref, "architecture", "scrollPositions", {});
  const [filePane, setFilePane] = useWorkspacePageState<FilePane>(sessions, ref, "architecture", "filePane", "symbols");
  const [compactFileLayout, setCompactFileLayout] = useState(false);
  const viewCache = useRef(new Map<string, GraphViewState>(Object.entries(graphViews)));
  const scrollPositions = useRef(new Map<string, number>(Object.entries(savedScrollPositions)));
  const levelRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = levelRoot.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCompactFileLayout(entry.contentRect.width < 720);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const levelKey = level === "overview" ? `overview:${query}:${pageCursor ?? "first"}` : `${level}:${selectedModule?.id}:${selectedFile?.id}`;
  useEffect(() => { const root = levelRoot.current?.querySelector<HTMLElement>(".architecture-level"); if (!root) return; root.scrollTop = scrollPositions.current.get(levelKey) ?? 0; const remember = () => scrollPositions.current.set(levelKey, root.scrollTop); root.addEventListener("scroll", remember); return () => root.removeEventListener("scroll", remember); }, [levelKey]);
  useEffect(() => { viewCache.current = new Map(Object.entries(graphViews)); scrollPositions.current = new Map(Object.entries(savedScrollPositions)); }, [identity]);
  useEffect(() => () => {
    setGraphViews(Object.fromEntries([...viewCache.current.entries()].slice(-40)));
    setSavedScrollPositions(Object.fromEntries([...scrollPositions.current.entries()].slice(-12)));
  }, [identity]);

  const invalidate = (...channels: string[]): void => { if (!channels.length) sessions.invalidateWorkspaceRequest(ref, "architecture"); else for (const channel of channels) sessions.invalidateWorkspaceRequest(ref, "architecture", channel); };
  const request = <T,>(channel: string, key: string, operation: () => Promise<T>, accept: (value: T) => void): void => {
    setRequestError("");
    sessions.runWorkspaceRequest(ref, "architecture", channel, `${identity}:${key}`, operation, (value) => {
      if (projectIdentity.current !== identity) return;
      const response = value as { repositoryId?: unknown; snapshotId?: unknown };
      if (response.repositoryId !== ref.repositoryId || response.snapshotId !== ref.snapshotId) throw new Error("架构查询响应属于其他仓库或快照，已丢弃。");
      accept(value);
    }, (error) => { if (projectIdentity.current === identity) setRequestError(error instanceof Error ? error.message : String(error)); });
  };

  useEffect(() => {
    invalidate("overview-relations", "relation"); setRelation(null); setRelationEdges([]); setInspectedEdge(null);
    const key = `overview:${query}:${pageCursor ?? "first"}`;
    if (overview?.repositoryId === ref.repositoryId && overview.snapshotId === ref.snapshotId && overview.query === query) return;
    request("overview", key, () => window.xray.getModuleOverview({ version: MODULE_OVERVIEW_VERSION, ...ref, query, limit: 40, relationLimit: 160, referenceLimit: 16, ...(pageCursor ? { cursor: pageCursor } : {}) }), (value) => { if (value.repositoryId !== ref.repositoryId || value.snapshotId !== ref.snapshotId) throw new Error("架构概览属于其他仓库或快照。"); setOverview(value); if (selectedModule && !value.modules.some((item) => item.id === selectedModule.id)) setSelectedModule(null); });
  }, [identity, query, pageCursor, overview]);

  const goOverview = (): void => { invalidate("module", "module-page", "relation", "file-dependency", "symbols", "local-graph"); setLevel("overview"); setInspectedEdge(null); };
  const enterModule = (module: ModuleSummary): void => {
    setInspectedEdge(null); if (expanded?.module.id === module.id) { invalidate("symbols", "local-graph"); setLevel("module"); setSelectedModule(module); return; }
    invalidate("module", "module-page", "relation", "file-dependency", "symbols", "local-graph"); setSelectedModule(module); setLevel("module"); setExpanded(null); setRelation(null); setRelationEdges([]); setSelectedFile(null); setDependencyGraph(null);
    request("module", `module:${module.id}`, () => window.xray.expandModule({ ...ref, moduleId: module.id, limit: 60 }), (value) => setExpanded(value));
  };
  const loadMoreFiles = (): void => {
    if (!expanded?.nextCursor || !selectedModule) return; const moduleId = selectedModule.id; const cursor = expanded.nextCursor;
    request("module-page", `module:${moduleId}:${cursor}`, () => window.xray.expandModule({ ...ref, moduleId, limit: 60, cursor }), (value) => { setExpanded((prior) => prior?.module.id === moduleId ? { ...value, nodes: [...prior.nodes, ...value.nodes] } : prior); });
  };
  const openRelation = (next: AggregateRelation, cursor?: string): void => {
    const key = relationKey(next); setInspectedEdge(null); setRelation(next); if (!cursor) { setRelationEdges([]); setRelationCursor(undefined); }
    request("relation", `relation:${key}:${cursor ?? "first"}`, () => window.xray.getModuleRelationEdges({ ...ref, sourceModuleId: next.sourceModuleId, targetModuleId: next.targetModuleId, limit: 30, ...(cursor ? { cursor } : {}) }), (value) => { if (relationKey(next) !== key) return; setRelationEdges((prior) => cursor ? [...new Map([...prior, ...value.items].map((edge) => [edge.id, edge])).values()] : value.items); setRelationCursor(value.nextCursor); });
  };
  const inspectFileDependencies = (file: GraphNode): void => {
    invalidate("file-dependency", "symbols", "local-graph"); setInspectedEdge(null); setSelectedFile(file); setDependencyGraph(null); setSelectedSymbol(null); setLocalGraph(null);
    request("file-dependency", `file:${file.id}`, () => window.xray.queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [file.id], view: "dependency", direction: "both", maxDepth: 1, maxNodes: 42, maxEdges: 72, maxWork: 600, confidences: ["verified", "inferred", "unknown"] }), setDependencyGraph);
  };
  const loadSymbols = (file: GraphNode, text: string, cursor?: string): void => {
    const filePath = file.filePath; if (!filePath) return; const key = `symbols:${file.id}:${text}:${cursor ?? "first"}`;
    request("symbols", key, () => window.xray.search({ ...ref, filePath, query: text, kinds: ["function", "class", "method", "variable", "endpoint"], limit: 50, ...(cursor ? { cursor } : {}) }), (value) => { setSymbols((prior) => cursor ? [...new Map([...prior, ...value.items].map((node) => [node.id, node])).values()] : value.items); setSymbolCursor(value.nextCursor); setSymbolTotal(value.total); });
  };
  const enterFile = (file: GraphNode): void => { inspectFileDependencies(file); setLevel("file"); setSymbolQuery(""); setSymbols([]); setSymbolTotal(0); onNode(file); loadSymbols(file, ""); };
  const inspectSymbol = (node: GraphNode): void => { setSelectedSymbol(node); setLocalGraph(null); if (compactFileLayout) setFilePane("relations"); onNode(node); request("local-graph", `symbol:${node.id}`, () => window.xray.queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [node.id], view: "call", direction: "both", maxDepth: 2, maxNodes: 48, maxEdges: 80, maxWork: 900, confidences: ["verified", "inferred", "unknown"] }), setLocalGraph); };

  const modules = overview?.modules ?? []; const files = expanded?.nodes.filter((node) => node.kind === "file") ?? [];
  const graphNodes = useMemo<GraphNode[]>(() => modules.map((module) => ({ id: module.id, snapshotId: project.snapshotId, kind: "module", name: module.name, qualifiedName: module.qualifiedName, metadata: { directoryGrouping: true, fileCount: module.fileCount, symbolCount: module.symbolCount } })), [modules, project.snapshotId]);
  const graphRelations = useMemo<AggregateGraphRelation[]>(() => (overview?.relations ?? []).map((item) => ({ id: relationKey(item), relation: item })), [overview]);
  const moduleName = (id: string): string => overview?.modules.find((item) => item.id === id)?.name ?? (selectedModule?.id === id ? selectedModule.name : id.slice(0, 10));
  const selectGraphModule = (node: GraphNode): void => { const module = modules.find((item) => item.id === node.id); if (module) { setSelectedModule(module); setRelation(null); setInspectedEdge(null); } };
  const nextOverviewPage = (): void => { if (!overview?.nextCursor) return; setPageHistory((items) => [...items, pageCursor]); setPageCursor(overview.nextCursor); setSelectedModule(null); setRelation(null); };
  const previousOverviewPage = (): void => { const previous = pageHistory.at(-1); setPageHistory((items) => items.slice(0, -1)); setPageCursor(previous); setSelectedModule(null); setRelation(null); };
  const loadMoreOverviewRelations = (): void => { if (!overview?.relationNextCursor) return; const cursor = overview.relationNextCursor; request("overview-relations", `overview-relations:${query}:${pageCursor ?? "first"}:${cursor}`, () => window.xray.getModuleOverview({ version: MODULE_OVERVIEW_VERSION, ...ref, query, limit: 40, relationLimit: 160, referenceLimit: 16, ...(pageCursor ? { cursor: pageCursor } : {}), relationCursor: cursor }), (value) => setOverview((prior) => prior ? { ...value, relations: [...prior.relations, ...value.relations] } : value)); };

  const nodeLabel = (id: string): string => [...(dependencyGraph?.nodes ?? []), ...(localGraph?.nodes ?? []), ...symbols].find((node) => node.id === id)?.qualifiedName ?? id;
  const inspectedDirection = inspectedEdge ? relation && relationEdges.some((edge) => edge.id === inspectedEdge.id) ? `${moduleName(relation.sourceModuleId)} → ${moduleName(relation.targetModuleId)}（目录分组）` : `${nodeLabel(inspectedEdge.source)} → ${nodeLabel(inspectedEdge.target)}` : "";
  const relationPanel = relation && <section className="relation-detail" data-testid="module-relation-detail"><div className="section-caption"><b>{moduleName(relation.sourceModuleId)} → {moduleName(relation.targetModuleId)}</b><span>{relation.edgeCount} 条真实底层关系</span></div><div className="relation-composition">{Object.entries(relation.kinds).map(([kind, count]) => <span key={kind}>{kind} {count}</span>)}{Object.entries(relation.confidences).map(([confidence, count]) => <span className={`confidence ${confidence}`} key={confidence}>{confidenceText[confidence as keyof typeof confidenceText] ?? confidence} {count}</span>)}</div>{relationEdges.map((edge) => <button key={edge.id} className={`evidence-row ${edge.confidence}`} onClick={() => setInspectedEdge(edge)}><b>{edge.kind} · {confidenceText[edge.confidence]}</b><span>{edge.reason}</span></button>)}{relationCursor && <button className="button secondary" onClick={() => openRelation(relation, relationCursor)}>继续加载底层证据</button>}</section>;

  const breadcrumbs = <div className="architecture-breadcrumbs" aria-label="架构层级"><button className={level === "overview" ? "current" : ""} onClick={goOverview}>项目概览</button>{level !== "overview" && selectedModule && <><span>›</span><button className={level === "module" ? "current" : ""} onClick={() => { invalidate("symbols", "local-graph"); setLevel("module"); setInspectedEdge(null); }}>{selectedModule.name}</button></>}{level === "file" && selectedFile && <><span>›</span><button className="current">{selectedFile.name}</button></>}</div>;
  let content: ReactElement;
  if (level === "overview") content = <div className="architecture-level overview-level" data-testid="architecture-overview"><div className="architecture-heading"><div><span className="kicker">层级 1 · 目录分组与真实聚合关系</span><h2>项目架构关系总览</h2><p>节点只表示包含已索引文件的目录分组；聚合边来自底层事实，不声明未经证明的业务边界。</p></div><ConfidenceLegend /></div><div className="overview-toolbar"><div className="architecture-search"><input aria-label="搜索模块" placeholder="按目录或模块名称搜索" value={query} onChange={(event) => { setQuery(event.target.value); setPageCursor(undefined); setPageHistory([]); }} /><span>{modules.length}/{overview?.moduleTotal ?? 0}</span></div><div className="view-switch" role="group" aria-label="总览显示方式"><button className={overviewMode === "graph" ? "active" : ""} onClick={() => setOverviewMode("graph")}>关系图</button><button className={overviewMode === "list" ? "active" : ""} onClick={() => setOverviewMode("list")}>列表</button></div></div>
    {overviewMode === "graph" ? <div className="overview-graph"><GraphCanvas viewCache={viewCache.current} contextKey={`module-overview:${identity}:${query}:${pageCursor ?? "first"}`} nodes={graphNodes} edges={[]} aggregateRelations={graphRelations} onNode={selectGraphModule} onEdge={setInspectedEdge} onAggregateRelation={openRelation} /><aside className="overview-inspector">{relationPanel}{selectedModule && !relation ? <><span className="kicker">目录分组</span><h3>{selectedModule.name}</h3><code>{selectedModule.qualifiedName}</code><p>{selectedModule.fileCount} 个文件 · {selectedModule.symbolCount} 个符号</p><button className="button primary" onClick={() => enterModule(selectedModule)}>展开文件</button><div className="module-neighbors"><b>当前范围的相关关系</b>{(overview?.relations ?? []).filter((item) => item.sourceModuleId === selectedModule.id || item.targetModuleId === selectedModule.id).map((item) => <button key={relationKey(item)} onClick={() => openRelation(item)}>{moduleName(item.sourceModuleId)} → {moduleName(item.targetModuleId)}<small>{item.edgeCount} 条 · 查看依据</small></button>)}</div></> : !relation && <div className="explore-guide"><span className="kicker">从结构开始</span><h3>探索代码地图</h3><p>01 选择模块，查看文件与符号规模</p><p>02 点击连线，检查方向和关系依据</p><p>03 定位源码，核验准确位置</p><small>目录分组不等于业务边界。所有数字来自当前快照。</small></div>}{overview?.references.length ? <details className="reference-summary"><summary>限制与外部依赖（{overview.referenceTotal}）</summary>{overview.references.map((item) => <div key={item.id} className={item.category}><span>{item.name}</span><small>{referenceText[item.category]} · {item.relationCount}</small></div>)}{overview.referencesTruncated && <small>仅显示 {overview.references.length}/{overview.referenceTotal} 项</small>}</details> : <div className="empty-inline">当前范围没有未解析模块引用、调用或外部依赖。</div>}</aside></div> : <div className="module-card-grid">{modules.map((module) => <article key={module.id} className={`module-card ${selectedModule?.id === module.id ? "selected" : ""}`}><button className="module-card-main" onClick={() => setSelectedModule(module)} title={module.qualifiedName}><span className="module-icon">M</span><span><b>{module.name}</b><small>{module.qualifiedName}</small></span></button><dl><div><dt>文件</dt><dd>{module.fileCount}</dd></div><div><dt>符号</dt><dd>{module.symbolCount}</dd></div><div><dt>结构关系</dt><dd>{module.relationCount}</dd></div></dl><button className="module-open" onClick={() => enterModule(module)}>展开文件 →</button></article>)}</div>}
    <div className="overview-pagination">{pageHistory.length > 0 && <button className="button secondary" onClick={previousOverviewPage}>上一范围</button>}<span>本页 {modules.length} 个目录模块 · {overview?.relations.length ?? 0}/{overview?.relationTotal ?? 0} 条聚合关系</span>{overview?.relationNextCursor && <button className="button secondary" onClick={loadMoreOverviewRelations}>继续加载本范围关系</button>}{overview?.nextCursor && <button className="button secondary" onClick={nextOverviewPage}>下一范围</button>}</div>{overviewMode === "list" && relationPanel}</div>;
  else if (level === "module") content = <div className="architecture-level module-level" data-testid="architecture-module"><div className="architecture-heading"><div><span className="kicker">层级 2 · 模块内部</span><h2>{selectedModule?.name}</h2><p>{selectedModule?.qualifiedName} · 默认只列文件，依赖按需查询。</p></div><ConfidenceLegend /></div><div className="module-browser"><section className="file-browser"><div className="section-caption"><b>文件</b><span>{files.length}/{selectedModule?.fileCount ?? files.length}</span></div><div className="file-card-list">{files.map((file) => <article key={file.id} className={selectedFile?.id === file.id ? "selected" : ""}><button className="file-select" aria-label={`查看 ${file.filePath ?? file.name} 的依赖`} onClick={() => inspectFileDependencies(file)} title={file.filePath}><b>{file.name}</b><span>{file.filePath}</span></button><button className="file-open" onClick={() => enterFile(file)}>符号与源码 →</button></article>)}</div>{expanded?.nextCursor && <button className="button secondary load-more" onClick={loadMoreFiles}>继续加载文件</button>}</section><section className="dependency-view"><div className="section-caption"><b>文件依赖</b><span>IMPORTS / DEPENDS_ON</span></div>{dependencyGraph && selectedFile ? <><GraphCanvas viewCache={viewCache.current} contextKey={`file-dependency:${identity}:${selectedFile.id}`} nodes={dependencyGraph.nodes} edges={dependencyGraph.edges} onNode={onNode} onEdge={setInspectedEdge} /><div className="query-stats">{dependencyGraph.edges.length ? `${dependencyGraph.edges.length} 条依赖关系` : "查询范围内没有依赖证据"}{dependencyGraph.truncated ? ` · 已截断：${dependencyGraph.truncationReasons.join(" / ")}` : ""}</div></> : <div className="empty-state">选择文件后按需查询；不会绘制目录归属连线。</div>}</section></div>{expanded && expanded.relations.length > 0 && <section className="module-relations"><div className="section-caption"><b>此模块的跨模块关系</b><span>点击后核验底层证据</span></div>{expanded.relations.map((item) => <button className="relation-summary compact" key={relationKey(item)} onClick={() => openRelation(item)}><span>{moduleName(item.sourceModuleId)} → {moduleName(item.targetModuleId)}</span><b>{item.edgeCount} 条</b></button>)}</section>}{relationPanel}</div>;
  else content = <div className="architecture-level file-level" data-testid="architecture-file">
    <div className="architecture-heading"><div><span className="kicker">层级 3 · 文件 / 符号</span><h2>{selectedFile?.name}</h2><p title={selectedFile?.filePath}>{selectedFile?.filePath}</p></div><button className="button secondary" onClick={() => selectedFile && onNode(selectedFile)}>打开文件源码</button></div>
    <ArchitectureFileWorkspace selectedFile={selectedFile} symbols={symbols} symbolQuery={symbolQuery} setSymbolQuery={setSymbolQuery} symbolCursor={symbolCursor} symbolTotal={symbolTotal} selectedSymbol={selectedSymbol} localGraph={localGraph} filePane={filePane} setFilePane={setFilePane} compact={compactFileLayout} viewCache={viewCache.current} contextKey={`symbol-call:${identity}:${selectedSymbol?.id ?? "none"}`} requestError={requestError} onSearch={() => selectedFile && loadSymbols(selectedFile, symbolQuery)} onLoadMore={() => selectedFile && symbolCursor && loadSymbols(selectedFile, symbolQuery, symbolCursor)} onSelectSymbol={inspectSymbol} onNode={onNode} onEdge={setInspectedEdge} />
  </div>;

  return <EvidenceWorkspace project={ref} source={source} navigationLabel="架构地图" className="architecture-workbench" navigationKey={level} presentation={sourceView.presentation} onPresentationChange={(next) => onSourceViewChange((current) => ({ ...current, open: next.sourceVisible, presentation: next }))} editorState={sourceView.editor} onEditorStateChange={(editor) => onSourceViewChange((current) => ({ ...current, editor }))} onCloseSource={onCloseSource} navigation={<section className="panel architecture-panel">{breadcrumbs}{requestError && <div className="error-banner architecture-error"><b>查询失败</b><span>{requestError}</span><button onClick={() => setRequestError("")}>×</button></div>}<div className={`architecture-stage ${inspectedEdge ? "inspecting" : ""}`} ref={levelRoot}>{content}{inspectedEdge && <RelationInspector key={`${identity}:${inspectedEdge.id}`} project={ref} edge={inspectedEdge} direction={inspectedDirection} onOpen={onEdge} onClose={() => setInspectedEdge(null)} />}</div></section>} />;
}

function ArchitectureFileWorkspace({ selectedFile, symbols, symbolQuery, setSymbolQuery, symbolCursor, symbolTotal, selectedSymbol, localGraph, filePane, setFilePane, compact, viewCache, contextKey, requestError, onSearch, onLoadMore, onSelectSymbol, onNode, onEdge }: {
  selectedFile: GraphNode | null;
  symbols: GraphNode[];
  symbolQuery: string;
  setSymbolQuery: (value: string) => void;
  symbolCursor: string | undefined;
  symbolTotal: number;
  selectedSymbol: GraphNode | null;
  localGraph: GraphQueryResponse | null;
  filePane: FilePane;
  setFilePane: (value: FilePane) => void;
  compact: boolean;
  viewCache: Map<string, GraphViewState>;
  contextKey: string;
  requestError: string;
  onSearch: () => void;
  onLoadMore: () => void;
  onSelectSymbol: (node: GraphNode) => void;
  onNode: (node: GraphNode) => void;
  onEdge: (edge: GraphEdge) => void;
}): ReactElement {
  return <div className={`symbol-browser ${compact ? "compact-symbol-browser" : ""}`} data-testid="architecture-symbol-workspace">
    <div className="file-pane-switch view-switch" role="tablist" aria-label="文件视图" hidden={!compact}>
      <button role="tab" aria-selected={filePane === "symbols"} className={filePane === "symbols" ? "active" : ""} onClick={() => setFilePane("symbols")}>符号列表</button>
      <button role="tab" aria-selected={filePane === "relations"} className={filePane === "relations" ? "active" : ""} onClick={() => setFilePane("relations")}>局部关系{selectedSymbol ? ` · ${selectedSymbol.name}` : ""}</button>
    </div>
    <section className="symbol-list" aria-label="文件符号列表" hidden={compact && filePane !== "symbols"}>
      <div className="architecture-search"><input aria-label="搜索当前文件符号" placeholder="按名称筛选此文件" value={symbolQuery} onChange={(event) => setSymbolQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onSearch(); } }} /><button className="button secondary" onClick={onSearch}>搜索</button><span>{symbols.length}/{symbolTotal}</span></div>
      {symbols.length ? symbols.map((node) => <button key={node.id} className={selectedSymbol?.id === node.id ? "selected" : ""} aria-pressed={selectedSymbol?.id === node.id} onClick={() => onSelectSymbol(node)} title={node.qualifiedName}><b>{node.name}</b><span>{node.kind} · 第 {node.span?.startLine ?? "?"}–{node.span?.endLine ?? "?"} 行</span><small>{node.qualifiedName}</small></button>) : <div className="empty-inline" role="status">{symbolQuery ? `没有匹配“${symbolQuery}”的文件内符号。` : "当前文件没有可展示的已索引符号。"}</div>}
      {symbolCursor && selectedFile && <button className="button secondary load-more" onClick={onLoadMore}>继续加载符号</button>}
    </section>
    <section className="local-graph" aria-label="选中符号的局部静态调用关系" hidden={compact && filePane !== "relations"}>
      <div className="section-caption"><b>局部静态调用关系</b><span title={selectedSymbol?.qualifiedName}>{selectedSymbol ? `中心：${selectedSymbol.qualifiedName} · 双向 · 最多 2 跳` : "选择符号后显示"}</span></div>
      {!selectedSymbol && <div className="empty-inline">先从符号列表选择一个符号，再查看已索引的局部调用关系。</div>}
      {selectedSymbol && !localGraph && requestError && <div className="empty-inline" role="alert">查询失败：{requestError}<button className="button secondary" onClick={() => onSelectSymbol(selectedSymbol)}>重试局部关系</button></div>}
      {selectedSymbol && !localGraph && !requestError && <div className="empty-inline" role="status">正在查询当前快照的已索引调用关系。</div>}
      {selectedSymbol && localGraph && localGraph.edges.length > 0 && <>
        <div className="local-graph-legend"><ConfidenceLegend /><span>静态分析关系，不代表完整运行时路径。</span></div>
        <GraphCanvas viewCache={viewCache} contextKey={contextKey} nodes={localGraph.nodes} edges={localGraph.edges} onNode={onNode} onEdge={onEdge} />
        <div className="query-stats">扫描 {localGraph.stats.scannedEdges} 条候选边 · {localGraph.edges.length} 条关系{localGraph.truncated ? ` · 已截断（${localGraph.truncationReasons.join(" / ")}），更多关系尚未加载` : " · 本次有界查询未截断"}</div>
      </>}
      {selectedSymbol && localGraph && localGraph.edges.length === 0 && <div className="empty-inline" role="status">该有界查询没有返回已解析的调用关系。没有生成或推断额外关系；静态分析也不覆盖完整运行时路径。</div>}
    </section>
  </div>;
}
