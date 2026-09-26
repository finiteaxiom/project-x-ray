import { useEffect, useRef, type ReactElement } from "react";
import type { GraphEdge, GraphNode, GraphQueryResponse, ProjectOverview, SourceFileResult } from "@project-xray/contracts";
import { GRAPH_QUERY_VERSION } from "@project-xray/contracts";
import { GraphCanvas, type GraphViewState } from "./GraphCanvas";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { useWorkspacePageState, type OwnershipSessionController, type WorkspaceSourceView } from "../state/ownership-sessions";

const confidenceText = { verified: "已验证", inferred: "推断", unknown: "未知" } as const;
const refOf = (project: ProjectOverview) => ({ repositoryId: project.repositoryId, snapshotId: project.snapshotId });
function ConfidenceLegend(): ReactElement { return <span className="legend"><i className="verified" /> 已验证 <i className="inferred" /> 推断 <i className="unknown" /> 未知</span>; }

export function FlowExplorer({ project, onNode, onEdge, source, sessions, sourceView, onSourceViewChange, onCloseSource }: { project: ProjectOverview; onNode: (node: GraphNode) => void; onEdge: (edge: GraphEdge) => void; source: SourceFileResult | null; sessions: OwnershipSessionController; sourceView: WorkspaceSourceView; onSourceViewChange: (update: (current: WorkspaceSourceView) => WorkspaceSourceView) => void; onCloseSource: () => void }): ReactElement {
  const ref = refOf(project);
  const [search, setSearch] = useWorkspacePageState(sessions, ref, "flow", "search", "");
  const [symbols, setSymbols] = useWorkspacePageState<GraphNode[]>(sessions, ref, "flow", "symbols", []);
  const [selected, setSelected] = useWorkspacePageState(sessions, ref, "flow", "selected", "");
  const [view, setView] = useWorkspacePageState(sessions, ref, "flow", "view", "call" as "call" | "data" | "dependency");
  const [direction, setDirection] = useWorkspacePageState(sessions, ref, "flow", "direction", "outgoing" as "incoming" | "outgoing" | "both");
  const [depth, setDepth] = useWorkspacePageState(sessions, ref, "flow", "depth", 3);
  const [maxNodes, setMaxNodes] = useWorkspacePageState(sessions, ref, "flow", "maxNodes", 120);
  const [confidence, setConfidence] = useWorkspacePageState<Array<"verified" | "inferred" | "unknown">>(sessions, ref, "flow", "confidence", ["verified", "inferred", "unknown"]);
  const [flow, setFlow] = useWorkspacePageState<GraphQueryResponse | null>(sessions, ref, "flow", "result", null);
  const [searching, setSearching] = useWorkspacePageState(sessions, ref, "flow", "searching", false);
  const [querying, setQuerying] = useWorkspacePageState(sessions, ref, "flow", "querying", false);
  const [searched, setSearched] = useWorkspacePageState(sessions, ref, "flow", "searched", false);
  const [resultKey, setResultKey] = useWorkspacePageState(sessions, ref, "flow", "resultKey", "");
  const [resultLabel, setResultLabel] = useWorkspacePageState(sessions, ref, "flow", "resultLabel", "");
  const [error, setError] = useWorkspacePageState(sessions, ref, "flow", "error", "");
  const [selectedResultId, setSelectedResultId] = useWorkspacePageState<string | null>(sessions, ref, "flow", "selectedResultId", null);
  const [graphViews, setGraphViews] = useWorkspacePageState<Record<string, GraphViewState>>(sessions, ref, "flow", "graphViews", {});
  const graphViewCache = useRef(new Map<string, GraphViewState>(Object.entries(graphViews)));
  const searchSequence = useRef(0); const querySequence = useRef(0);
  const lifecycle = sessions.getPageRecord(ref, "flow")?.lifecycle ?? "active";
  const canQuery = lifecycle === "active";
  useEffect(() => () => { setGraphViews(Object.fromEntries([...graphViewCache.current.entries()].slice(-8))); }, []);

  const validOptions = Number.isInteger(depth) && depth >= 1 && depth <= 8 && Number.isInteger(maxNodes) && maxNodes >= 10 && maxNodes <= 1000 && confidence.length > 0;
  const queryKey = JSON.stringify([selected, view, direction, depth, maxNodes, [...confidence].sort()]);
  const changed = Boolean(flow && resultKey !== queryKey);
  const find = (): void => {
    if (searching || !canQuery) return;
    const current = ++searchSequence.current; setSearching(true); setError("");
    sessions.runWorkspaceRequest(ref, "flow", "search", search.trim(), () => window.xray.search({ ...ref, query: search, kinds: ["function", "method", "class", "endpoint", "file"], limit: 60 }), value => {
      if (current !== searchSequence.current) return;
      if (value.repositoryId !== ref.repositoryId || value.snapshotId !== ref.snapshotId) throw new Error("符号搜索响应属于其他仓库或快照。");
      setSymbols(value.items.slice(0, 60)); setSearched(true);
      setSelected(prior => value.items.some(node => node.id === prior) ? prior : value.items[0]?.id ?? "");
      setSearching(false);
    }, failure => { if (current === searchSequence.current) { setError(failure instanceof Error ? failure.message : String(failure)); setSearching(false); } });
  };
  const execute = (cursor?: string): void => {
    if (!selected || !validOptions || querying || searching || (cursor && changed) || !canQuery) return;
    const current = ++querySequence.current; const submittedKey = queryKey;
    const label = symbols.find(node => node.id === selected)?.qualifiedName ?? selected;
    setQuerying(true); setError("");
    sessions.runWorkspaceRequest(ref, "flow", "query", `${submittedKey}:${cursor ?? "first"}`, () => window.xray.queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [selected], view, direction, maxDepth: depth, maxNodes, maxEdges: maxNodes * 2, maxWork: maxNodes * 30, confidences: confidence, ...(cursor ? { continuationCursor: cursor } : {}) }), value => {
      if (current !== querySequence.current) return;
      if (value.repositoryId !== ref.repositoryId || value.snapshotId !== ref.snapshotId) throw new Error("关系查询响应属于其他仓库或快照。");
      setResultKey(submittedKey); setResultLabel(label);
      setFlow(cursor && flow ? { ...value, nodes: [...new Map([...flow.nodes, ...value.nodes].map(node => [node.id, node])).values()].slice(0, maxNodes), edges: [...new Map([...flow.edges, ...value.edges].map(edge => [edge.id, edge])).values()].slice(0, maxNodes * 2) } : value);
      setQuerying(false);
    }, failure => { if (current === querySequence.current) { setError(failure instanceof Error ? failure.message : String(failure)); setQuerying(false); } });
  };
  const selectNode = (node: GraphNode): void => { setSelectedResultId(node.id); onNode(node); };
  const selectEdge = (edge: GraphEdge): void => { setSelectedResultId(edge.id); onEdge(edge); };

  return <EvidenceWorkspace project={ref} source={source} navigationLabel="关系图" presentation={sourceView.presentation} onPresentationChange={(next) => onSourceViewChange((current) => ({ ...current, open: next.sourceVisible, presentation: next }))} editorState={sourceView.editor} onEditorStateChange={(editor) => onSourceViewChange((current) => ({ ...current, editor }))} onCloseSource={onCloseSource} navigation={<section className="panel graph-panel"><div className="panel-heading"><div><span className="kicker">从一个符号开始</span><h3>探索代码之间的关系</h3></div><ConfidenceLegend /></div>
    {lifecycle !== "active" && <div className="stale-banner" role="status">当前快照的调用流会话已过期，保留历史结果供查看；请激活新快照后重新查询。</div>}
    {error && <div className="error-banner" role="alert">查询失败：{error}<button className="button secondary" onClick={() => setError("")}>关闭</button></div>}
    <div className="flow-controls"><input aria-label="搜索符号" placeholder="输入函数、类或文件名称" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.nativeEvent.isComposing && find()} /><button className="button secondary" disabled={searching || !canQuery} onClick={find}>{searching ? "搜索中…" : "搜索"}</button><select aria-label="选择符号" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择搜索结果</option>{symbols.map(node => <option key={node.id} value={node.id}>{node.qualifiedName} · {node.filePath ?? node.kind}</option>)}</select><select aria-label="关系视图" value={view} onChange={(event) => setView(event.target.value as "call" | "data" | "dependency")}><option value="call">调用关系</option><option value="data">数据读写与传递</option><option value="dependency">导入与依赖</option></select><button className="button primary" disabled={!selected || !validOptions || querying || searching || !canQuery} onClick={() => execute()}>{querying ? "查询中…" : "查询关系"}</button></div>
    {searched && !symbols.length && <p className="query-feedback" role="status">没有找到匹配的符号。尝试文件名、函数名或缩短关键词。</p>}
    <details className="query-options"><summary>查询选项 · 深度 {depth} · 最多 {maxNodes} 个节点 · {confidence.length} 类置信度</summary><div className="flow-controls"><select aria-label="查询方向" value={direction} onChange={(event) => setDirection(event.target.value as "incoming" | "outgoing" | "both")}><option value="outgoing">从当前符号出发</option><option value="incoming">指向当前符号</option><option value="both">两个方向</option></select><label>深度 <input aria-label="查询深度" type="number" min="1" max="8" value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label><label>最多显示节点 <input aria-label="节点预算" type="number" min="10" max="1000" value={maxNodes} onChange={(event) => setMaxNodes(Number(event.target.value))} /></label><div className="confidence-filter">{(["verified", "inferred", "unknown"] as const).map(item => <label key={item}><input type="checkbox" checked={confidence.includes(item)} onChange={() => setConfidence(prior => prior.includes(item) ? prior.filter(value => value !== item) : [...prior, item])} />{confidenceText[item]}</label>)}</div></div></details>
    {!validOptions && <p className="query-feedback warning" role="status">深度应为 1–8 的整数，节点数应为 10–1000 的整数，并至少选择一种置信度。</p>}{changed && <p className="query-feedback warning" role="status">查询条件已修改。下方仍是上次结果，请点击“查询关系”更新。</p>}{querying && <p className="query-feedback" role="status">正在读取当前快照的关系证据…</p>}
    {flow ? <><div className="result-context"><span>实际查询起点</span><b>{resultLabel}</b><small>{flow.nodes.length} 个节点 · {flow.edges.length} 条关系{selectedResultId ? ` · 已选 ${selectedResultId.slice(0, 10)}` : ""}</small></div><GraphCanvas viewCache={graphViewCache.current} contextKey={`flow:${ref.repositoryId}:${ref.snapshotId}:${resultKey}`} nodes={flow.nodes} edges={flow.edges} onNode={selectNode} onEdge={selectEdge} /><div className="query-stats">扫描 {flow.stats.scannedEdges} 条候选边，展开 {flow.stats.expandedNodes} 个节点。{flow.truncated ? `已截断：${flow.truncationReasons.join(" / ")}` : "查询范围内未截断"}{flow.continuationCursor && <button className="button secondary" disabled={changed || querying || searching || !validOptions || !canQuery} onClick={() => execute(flow.continuationCursor)}>继续探索</button>}</div><div className="relation-list">{flow.edges.map(edge => <button key={edge.id} className={`confidence ${edge.confidence}`} onClick={() => selectEdge(edge)}>{edge.kind} · {edge.reason}</button>)}</div>{flow.unresolved.length > 0 && <div className="unknown-strip">未解析目标仍保留：{flow.unresolved.map(item => item.target ?? item.reason).join(" · ")}</div>}</> : <div className="empty-state">先搜索一个函数、类或文件，再选择关系类型。每条可解析关系都能定位到源码依据。</div>}
  </section>} />;
}
