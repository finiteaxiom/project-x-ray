import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode } from "react";
import type { SnapshotRef, SourceCitation, SourceFileResult } from "@project-xray/contracts";
import { SourceViewer } from "./SourceViewer";

const WIDTH_KEY = "project-xray:evidence-workspace:source-width";
const NAV_KEY = "project-xray:evidence-workspace:navigation-collapsed";
const clamp = (value: number): number => Math.min(72, Math.max(32, value));

function storedNumber(key: string, fallback: number): number {
  try { const value = Number(window.localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback; } catch { return fallback; }
}
function storedBoolean(key: string): boolean {
  try { return window.localStorage.getItem(key) === "true"; } catch { return false; }
}

export function EvidenceWorkspace({ project, source, navigation, navigationLabel = "图与导航", className = "", onCite, navigationKey }: {
  project: SnapshotRef;
  source: SourceFileResult | null;
  navigation: ReactNode;
  navigationLabel?: string;
  className?: string;
  navigationKey?: string;
  onCite?: (items: SourceCitation[]) => void;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [sourceWidth, setSourceWidth] = useState(() => storedNumber(WIDTH_KEY, 44));
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => storedBoolean(NAV_KEY));
  const [sourceMaximized, setSourceMaximized] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [activePane, setActivePane] = useState<"navigation" | "source">("navigation");
  const [dragging, setDragging] = useState(false);

  useEffect(() => { try { window.localStorage.setItem(WIDTH_KEY, String(sourceWidth)); } catch { /* 纯布局偏好不可用时使用当前会话状态。 */ } }, [sourceWidth]);
  useEffect(() => { try { window.localStorage.setItem(NAV_KEY, String(navigationCollapsed)); } catch { /* 同上。 */ } }, [navigationCollapsed]);
  const validSource = source?.repositoryId === project.repositoryId && source.snapshotId === project.snapshotId ? source : null;
  useEffect(() => { setSourceVisible(false); setSourceMaximized(false); setActivePane("navigation"); }, [project.repositoryId, project.snapshotId, navigationKey]);
  useEffect(() => { if (validSource) { setSourceVisible(true); setActivePane("source"); } }, [validSource]);

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    if (!bounds.width) return;
    setSourceWidth(clamp(((bounds.right - event.clientX) / bounds.width) * 100));
  };
  const resizeFromKeyboard = (direction: number): void => setSourceWidth((value) => clamp(value + direction * 4));
  const split = Boolean(validSource && sourceVisible);
  const style: CSSProperties = { gridTemplateColumns: !split || sourceMaximized || navigationCollapsed ? "minmax(0,1fr)" : `minmax(320px, ${100 - sourceWidth}fr) 10px minmax(420px, ${sourceWidth}fr)` };

  return <div ref={root} className={`evidence-workspace ${className} ${split ? "with-source" : "without-source"} ${sourceMaximized ? "source-maximized" : ""} ${split && navigationCollapsed ? "navigation-collapsed" : ""}`} style={style} data-active-pane={activePane} data-testid="evidence-workspace">
    <div className="workspace-controls" aria-label="工作区布局">
      <div className="compact-pane-switch" role="group" aria-label="窄窗口面板">
        <button className={activePane === "navigation" ? "active" : ""} onClick={() => setActivePane("navigation")}>{navigationLabel}</button>
        <button className={activePane === "source" ? "active" : ""} disabled={!validSource} onClick={() => { setSourceVisible(true); setActivePane("source"); }}>源码</button>
      </div>
      {validSource && !sourceVisible && <button className="workspace-control" onClick={() => { setSourceVisible(true); setActivePane("source"); }}>显示源码</button>}
      {split && !sourceMaximized && <button className="workspace-control" onClick={() => setNavigationCollapsed((value) => !value)} aria-expanded={!navigationCollapsed}>{navigationCollapsed ? `显示${navigationLabel}` : `收起${navigationLabel}`}</button>}
      {split && <button className="workspace-control" onClick={() => { setSourceVisible(false); setSourceMaximized(false); setNavigationCollapsed(false); setActivePane("navigation"); }}>关闭源码</button>}
    </div>
    <div className="workspace-navigation" aria-hidden={split && (sourceMaximized || navigationCollapsed)}>{navigation}</div>
    {split && !sourceMaximized && !navigationCollapsed && <div
      className={`workspace-resizer ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-label="调整源码面板宽度"
      aria-orientation="vertical"
      aria-valuemin={32}
      aria-valuemax={72}
      aria-valuenow={Math.round(sourceWidth)}
      tabIndex={0}
      onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={resizeFromPointer}
      onPointerUp={(event) => { setDragging(false); event.currentTarget.releasePointerCapture?.(event.pointerId); }}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); resizeFromKeyboard(1); } else if (event.key === "ArrowRight") { event.preventDefault(); resizeFromKeyboard(-1); } else if (event.key === "Home") { event.preventDefault(); setSourceWidth(32); } else if (event.key === "End") { event.preventDefault(); setSourceWidth(72); } }}
    />}
    {split && <div className="workspace-source"><SourceViewer project={project} source={validSource} {...(onCite ? { onCite } : {})} maximized={sourceMaximized} onToggleMaximized={() => setSourceMaximized((value) => !value)} /></div>}
  </div>;
}
