import { useEffect, useState, type ReactElement } from "react";
import type { Evidence, GraphEdge, SnapshotRef } from "@project-xray/contracts";

const confidenceText = { verified: "已验证", inferred: "推断", unknown: "未知" };

/** Facts come only from the snapshot-bound evidence API, never from display labels. */
export function RelationInspector({ project, edge, direction, onOpen, onClose }: {
  project: SnapshotRef; edge: GraphEdge; direction?: string; onOpen: (edge: GraphEdge) => void; onClose: () => void;
}): ReactElement {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setEvidence(null); setError("");
    if (edge.snapshotId !== project.snapshotId) { setError("关系与当前快照不匹配，请重新选择关系。"); return; }
    if (!edge.evidenceId) { setError("此关系没有可导航的源码证据。"); return; }
    void window.xray.getEvidence({ ...project, evidenceId: edge.evidenceId }).then((value) => {
      if (!active) return;
      if (value.snapshotId !== project.snapshotId || value.id !== edge.evidenceId) { setError("证据与当前快照不匹配，请重新选择关系。"); return; }
      setEvidence(value);
    }).catch(() => { if (active) setError("证据读取失败，请重试。"); });
    return () => { active = false; };
  }, [project.repositoryId, project.snapshotId, edge.id, edge.snapshotId, edge.evidenceId, attempt]);
  return <section className="relation-inspector" aria-label="关系证据检查" data-testid="relation-inspector">
    <header><span className="kicker">关系依据</span><button className="toolbar-button" onClick={onClose} aria-label="关闭关系检查">×</button></header>
    <h3>{edge.kind} <span className={`confidence ${edge.confidence}`}>{confidenceText[edge.confidence]}</span></h3>
    {direction && <p className="inspector-direction">{direction}</p>}
    <p>{edge.reason}</p>
    <p className="inspector-caution">这是静态分析关系，不代表真实运行时路径。</p>
    {error ? <div role="alert">{error} <button className="button secondary" onClick={() => setAttempt((value) => value + 1)}>重试</button></div> : evidence ? <>
      <dl><dt title="行从 1 开始，列从 0 开始；结束位置不包含在范围内">源码位置 · 行:列</dt><dd>{evidence.span.filePath}<br />{evidence.span.startLine}:{evidence.span.startColumn} → {evidence.span.endLine}:{evidence.span.endColumn}</dd>
        <dt>分析器</dt><dd>{evidence.analyzer} · {evidence.analyzerVersion}</dd><dt>证据类型</dt><dd>{evidence.kind} · {confidenceText[evidence.confidence]}</dd>
        <dt>快照</dt><dd>{evidence.snapshotId}</dd></dl>
      <button className="button primary" onClick={() => onOpen(edge)}>定位源码证据 →</button>
    </> : <p role="status">正在读取当前快照证据…</p>}
  </section>;
}
