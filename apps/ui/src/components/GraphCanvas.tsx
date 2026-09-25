import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { GraphNodeBrowser } from "./GraphNodeBrowser";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { AggregateRelation, GraphEdge, GraphNode } from "@project-xray/contracts";

export interface GraphViewState { topology: string; zoom: number; pan: { x: number; y: number }; selectedIds: string[]; positions: Array<{ id: string; x: number; y: number }> }
export interface AggregateGraphRelation { id: string; relation: AggregateRelation }

export function GraphCanvas({ nodes, edges, aggregateRelations = [], onNode, onEdge, onAggregateRelation, contextKey, viewCache }: {
  nodes: GraphNode[]; edges: GraphEdge[]; aggregateRelations?: AggregateGraphRelation[];
  onNode: (node: GraphNode) => void; onEdge: (edge: GraphEdge) => void; onAggregateRelation?: (relation: AggregateRelation) => void;
  contextKey?: string; viewCache?: Map<string, GraphViewState>;
}): ReactElement {
  const container = useRef<HTMLDivElement>(null); const instance = useRef<Core | null>(null);
  const onNodeRef = useRef(onNode); const onEdgeRef = useRef(onEdge); const onAggregateRef = useRef(onAggregateRelation);
  const topology = useRef(""); const context = useRef(""); const userRevision = useRef(0); const fitFrame = useRef<number | undefined>(undefined);
  const cacheRef = useRef(viewCache); cacheRef.current = viewCache;
  const saveView = (): void => { const cy = instance.current; if (!cy || !context.current) return; const cache = cacheRef.current; if (!cache) return; if (cache.size >= 40 && !cache.has(context.current)) cache.delete(cache.keys().next().value!); cache.set(context.current, { topology: topology.current, zoom: cy.zoom(), pan: { ...cy.pan() }, selectedIds: cy.$(":selected").map((item) => item.id()), positions: cy.nodes().map((item) => ({ id: item.id(), ...item.position() })) }); };
  const [display, setDisplay] = useState<"canvas" | "list">("canvas");
  const [selectedLabel, setSelectedLabel] = useState("");
  const elements = useMemo<ElementDefinition[]>(() => {
    const ids = new Set(nodes.map((node) => node.id));
    return [
      ...nodes.map((node) => ({ data: { id: node.id, label: node.kind === "module" && typeof node.metadata.fileCount === "number" ? `${node.name.length > 24 ? node.name.slice(0, 23) + "…" : node.name}\n${node.metadata.fileCount} 文件 · ${node.metadata.symbolCount ?? 0} 符号` : node.name, detail: node.filePath ?? node.qualifiedName, kind: node.kind, node } })),
      ...edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)).map((edge) => ({ data: { id: edge.id, source: edge.source, target: edge.target, label: edge.kind, confidence: edge.confidence, edge } })),
      ...aggregateRelations.filter(({ relation }) => ids.has(relation.sourceModuleId) && ids.has(relation.targetModuleId)).map(({ id, relation }) => {
        const confidenceKinds = Object.keys(relation.confidences).filter((key) => (relation.confidences[key] ?? 0) > 0);
        return { data: { id: `aggregate:${id}`, source: relation.sourceModuleId, target: relation.targetModuleId, label: `${relation.edgeCount} 条`, confidence: confidenceKinds.length === 1 ? confidenceKinds[0] : "mixed", aggregateRelation: relation } };
      }),
    ];
  }, [nodes, edges, aggregateRelations]);
  const topologyKey = useMemo(() => `${nodes.map((node) => node.id).sort().join("|")}::${edges.map((edge) => edge.id).sort().join("|")}::${aggregateRelations.map((edge) => edge.id).sort().join("|")}`, [nodes, edges, aggregateRelations]);
  const effectiveContext = contextKey ?? topologyKey;

  useEffect(() => { onNodeRef.current = onNode; onEdgeRef.current = onEdge; onAggregateRef.current = onAggregateRelation; }, [onNode, onEdge, onAggregateRelation]);
  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({ container: container.current, elements: [], layout: { name: "preset" }, minZoom: .08, maxZoom: 2.4, wheelSensitivity: .18, style: [
      { selector: "node", style: { "background-color": "#242535", "border-color": "#7871bd", "border-width": 1.5, label: "data(label)", color: "#ededf5", "font-size": 12, "font-weight": "bold", "text-wrap": "ellipsis", "text-max-width": "132px", "text-valign": "center", "text-halign": "center", width: 154, height: 52, shape: "round-rectangle", padding: "8px" } },
      { selector: 'node[kind = "module"]', style: { "background-color": "#29263b", "border-color": "#9c90e9", width: 190, height: 76, "text-wrap": "wrap", "text-max-width": "180px", "line-height": 1.65 } },
      { selector: 'node[kind = "file"]', style: { "background-color": "#212c3c", "border-color": "#7198c9" } },
      { selector: 'node[kind = "external-dependency"]', style: { "background-color": "#302634", "border-color": "#b78bab" } },
      { selector: 'node[kind = "endpoint"]', style: { "background-color": "#392d1f", "border-color": "#e4ac69" } },
      { selector: "edge", style: { width: 2, label: "data(label)", color: "#b1aec9", "font-size": 10, "text-background-color": "#111218", "text-background-opacity": .9, "text-background-padding": "2px", "line-color": "#8a84c5", "target-arrow-color": "#8a84c5", "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: 1 } },
      { selector: 'edge[confidence = "inferred"]', style: { "line-style": "dotted", "line-color": "#e7a25e", "target-arrow-color": "#e7a25e" } },
      { selector: 'edge[confidence = "unknown"]', style: { "line-style": "dashed", "line-color": "#cf737b", "target-arrow-color": "#cf737b" } },
      { selector: 'edge[confidence = "mixed"]', style: { "line-style": "dashed", "line-color": "#8ab3ad", "target-arrow-color": "#8ab3ad" } },
      { selector: ".muted", style: { opacity: 1, "text-opacity": 1, color: "#bcb6d1", "border-color": "#817a99" } }, { selector: ".related", style: { opacity: 1, "text-opacity": 1 } },
      { selector: ":selected", style: { "border-color": "#c7c1ff", "border-width": 3, "background-color": "#3c3557", "overlay-color": "#9892ff", "overlay-opacity": .08 } },
    ] });
    instance.current = cy;
    const updateMetrics = (): void => { if (!container.current || cy.nodes().length === 0) return; const bounds = cy.nodes().renderedBoundingBox(); const tolerance = 2; container.current.dataset.nodesInBounds = String(bounds.x1 >= -tolerance && bounds.y1 >= -tolerance && bounds.x2 <= cy.width() + tolerance && bounds.y2 <= cy.height() + tolerance); container.current.dataset.renderedBounds = `${Math.round(bounds.x1)},${Math.round(bounds.y1)},${Math.round(bounds.x2)},${Math.round(bounds.y2)}`; container.current.dataset.nodeFontSize = "12"; container.current.dataset.viewport = JSON.stringify({ zoom: cy.zoom(), pan: cy.pan() }); };
    const scheduleFit = (revision = userRevision.current): void => { if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current); fitFrame.current = requestAnimationFrame(() => { fitFrame.current = requestAnimationFrame(() => { if (revision !== userRevision.current || cy.destroyed()) return; cy.resize(); cy.fit(undefined, 36); updateMetrics(); }); }); };
    cy.on("zoom pan", updateMetrics);
    cy.scratch("scheduleFit", scheduleFit); cy.scratch("updateMetrics", updateMetrics);
    cy.on("tap", "node", (event) => { const node = event.target; cy.elements().removeClass("muted related"); cy.elements().addClass("muted"); node.closedNeighborhood().removeClass("muted").addClass("related"); const value = node.data("node") as GraphNode; setSelectedLabel(value.qualifiedName); onNodeRef.current(value); });
    cy.on("tap", "edge", (event) => { cy.elements().removeClass("muted related"); cy.elements().addClass("muted"); event.target.connectedNodes().union(event.target).removeClass("muted").addClass("related"); const aggregate = event.target.data("aggregateRelation") as AggregateRelation | undefined; if (aggregate) onAggregateRef.current?.(aggregate); else onEdgeRef.current(event.target.data("edge") as GraphEdge); });
    cy.on("tap", (event) => { if (event.target === cy) { cy.elements().removeClass("muted related"); cy.$(":selected").unselect(); setSelectedLabel(""); } });
    const markInteraction = (): void => { userRevision.current += 1; }; container.current.addEventListener("pointerdown", markInteraction);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { cy.resize(); updateMetrics(); }); observer?.observe(container.current);
    return () => { saveView(); if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current); observer?.disconnect(); container.current?.removeEventListener("pointerdown", markInteraction); cy.destroy(); instance.current = null; };
  }, []);

  useEffect(() => {
    const cy = instance.current; if (!cy) return; const newContext = context.current !== effectiveContext; const hadNodes = cy.nodes().length > 0; const previousZoom = cy.zoom(); const previousPan = cy.pan(); const selectedIds = newContext ? [] : cy.$(":selected").map((item) => item.id());
    if (topology.current !== topologyKey || newContext) {
      saveView(); if (fitFrame.current !== undefined) cancelAnimationFrame(fitFrame.current);
      cy.batch(() => { cy.elements().remove(); cy.add(elements); });
      cy.layout({ name: aggregateRelations.length || edges.length ? "breadthfirst" : "grid", directed: true, padding: 48, spacingFactor: 1.24, animate: false, fit: false }).run();
      if (newContext || !hadNodes) { const saved = cacheRef.current?.get(effectiveContext); setSelectedLabel("");
        if (saved?.topology === topologyKey) { for (const position of saved.positions) cy.getElementById(position.id).position({ x: position.x, y: position.y }); cy.zoom(saved.zoom); cy.pan(saved.pan); for (const id of saved.selectedIds) { const item = cy.getElementById(id); item.select(); const node = item.data("node") as GraphNode | undefined; if (node) { setSelectedLabel(node.qualifiedName); cy.elements().addClass("muted"); item.closedNeighborhood().removeClass("muted").addClass("related"); } } (cy.scratch("updateMetrics") as (() => void) | undefined)?.(); }
        else (cy.scratch("scheduleFit") as ((revision?: number) => void) | undefined)?.(userRevision.current);
      }
      else { cy.zoom(previousZoom); cy.pan(previousPan); for (const id of selectedIds) cy.getElementById(id).select(); (cy.scratch("updateMetrics") as (() => void) | undefined)?.(); }
      topology.current = topologyKey; context.current = effectiveContext;
    } else cy.batch(() => { for (const element of elements) { const id = String(element.data?.id ?? ""); if (id) cy.getElementById(id).data(element.data ?? {}); } });
  }, [elements, topologyKey, effectiveContext, edges.length, aggregateRelations.length]);

  const fit = (): void => { const cy = instance.current; if (!cy) return; cy.resize(); cy.fit(undefined, 36); (cy.scratch("updateMetrics") as (() => void) | undefined)?.(); };
  const zoom = (factor: number): void => { const cy = instance.current; if (!cy) return; cy.zoom({ level: Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); };
  const focusSelected = (): void => { const cy = instance.current; if (!cy) return; const selected = cy.$(":selected"); if (selected.length) cy.animate({ center: { eles: selected }, zoom: Math.max(1, cy.zoom()), duration: 180 }); };
  return <div className="graph-surface" data-testid="graph-surface"><div className="graph-toolbar" aria-label="图视图控制"><button aria-pressed={display === "canvas"} onClick={() => { setDisplay("canvas"); requestAnimationFrame(() => instance.current?.resize()); }}>画布</button><button aria-pressed={display === "list"} onClick={() => setDisplay("list")}>节点列表</button><button disabled={display !== "canvas"} onClick={() => zoom(1.2)} aria-label="放大图">＋</button><button disabled={display !== "canvas"} onClick={() => zoom(.82)} aria-label="缩小图">－</button><button disabled={display !== "canvas"} onClick={fit}>适应视图</button><button onClick={focusSelected} disabled={!selectedLabel || display !== "canvas"}>聚焦选中</button>{selectedLabel && <span title={selectedLabel}>{selectedLabel}</span>}</div><div className="graph-canvas" hidden={display !== "canvas"} ref={container} data-testid="graph-canvas" />{display === "list" && <GraphNodeBrowser key={effectiveContext} nodes={nodes} onSelect={(node) => { instance.current?.$(":selected").unselect(); instance.current?.getElementById(node.id).select(); setSelectedLabel(node.qualifiedName); onNode(node); }} />}</div>;
}
