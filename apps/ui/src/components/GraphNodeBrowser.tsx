import { useMemo, useState, type ReactElement } from "react";
import type { GraphNode } from "@project-xray/contracts";

const labels: Record<GraphNode["kind"], string> = { module: "模块", file: "文件", function: "函数", method: "方法", class: "类", variable: "变量", endpoint: "接口入口", "external-dependency": "外部依赖", repository: "仓库", "unresolved-call": "未解析调用", "unsupported-semantic": "不支持的语义" };
const PAGE_SIZE = 40;

export function GraphNodeBrowser({ nodes, onSelect }: { nodes: GraphNode[]; onSelect: (node: GraphNode) => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const kinds = useMemo(() => [...new Set(nodes.map(node => node.kind))].sort(), [nodes]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return nodes.filter(node => (!kind || node.kind === kind) && `${node.name} ${node.qualifiedName} ${node.filePath ?? ""}`.toLocaleLowerCase().includes(search))
      .sort((a, b) => (sort === "path" ? a.filePath ?? a.qualifiedName : a.name).localeCompare(sort === "path" ? b.filePath ?? b.qualifiedName : b.name) || a.id.localeCompare(b.id));
  }, [nodes, query, kind, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const reset = (): void => { setQuery(""); setKind(""); setPage(0); };
  return <section className="graph-node-browser" aria-label="图谱节点列表">
    <div className="node-browser-search">
      <label>名称或路径<input aria-label="筛选图谱节点" placeholder="搜索完整名称或路径" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      <label>节点类型<select aria-label="筛选节点类型" value={kind} onChange={event => { setKind(event.target.value); setPage(0); }}><option value="">全部类型</option>{kinds.map(value => <option key={value} value={value}>{labels[value] ?? value}</option>)}</select></label>
      <label>排序<select aria-label="节点排序" value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="name">按名称</option><option value="path">按路径</option></select></label>
      <button className="toolbar-button" disabled={!query && !kind} onClick={reset}>清除筛选</button>
    </div>
    <p role="status">当前范围共 {nodes.length} 个节点，匹配 {filtered.length} 个。选择节点查看详情或源码。</p>
    <div className="graph-node-rows">{filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(node => <button key={node.id} aria-pressed={selected === node.id} onClick={() => { setSelected(node.id); onSelect(node); }}><div className="node-row-heading"><b>{node.name}</b><small>{labels[node.kind] ?? node.kind}</small></div><span>{node.filePath ?? node.qualifiedName}</span>{node.kind === "module" && typeof node.metadata.fileCount === "number" && <small>{node.metadata.fileCount} 个文件 · {String(node.metadata.symbolCount ?? 0)} 个符号</small>}</button>)}</div>
    {!filtered.length && <div className="node-browser-empty"><b>{nodes.length ? "没有匹配的节点" : "当前范围暂无节点"}</b><p>{nodes.length ? "尝试缩短搜索词，或清除类型筛选。" : "请先选择模块或执行关系查询。"}</p>{nodes.length > 0 && <button className="toolbar-button" onClick={reset}>显示全部节点</button>}</div>}
    {pages > 1 && <nav className="node-pagination" aria-label="节点列表分页"><button className="toolbar-button" disabled={current === 0} onClick={() => setPage(current - 1)}>上一页</button><span>第 {current + 1} / {pages} 页 · 每页 {PAGE_SIZE} 个</span><button className="toolbar-button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>下一页</button></nav>}
  </section>;
}

