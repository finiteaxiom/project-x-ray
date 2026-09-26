import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode } from "react";
import type { SnapshotRef, SourceCitation, SourceFileResult } from "@project-xray/contracts";
import { SourceViewer, type SourceEditorViewState } from "./SourceViewer";

const WIDTH_KEY = "project-xray:evidence-workspace:source-width";
const NAV_KEY = "project-xray:evidence-workspace:navigation-collapsed";
const clamp = (value: number): number => Math.min(72, Math.max(32, value));

export type EvidenceWorkspacePresentation = { sourceVisible: boolean; sourceMaximized: boolean; navigationCollapsed: boolean; activePane: "navigation" | "source" };

function storedNumber(key: string, fallback: number): number {
  try { const value = Number(window.localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback; } catch { return fallback; }
}
function storedBoolean(key: string): boolean {
  try { return window.localStorage.getItem(key) === "true"; } catch { return false; }
}

export function EvidenceWorkspace({ project, source, navigation, navigationLabel = "图与导航", className = "", onCite, navigationKey, presentation, onPresentationChange, editorState, onEditorStateChange, onCloseSource }: {
  project: SnapshotRef;
  source: SourceFileResult | null;
  navigation: ReactNode;
  navigationLabel?: string;
  className?: string;
  navigationKey?: string;
  onCite?: (items: SourceCitation[]) => void;
  presentation?: EvidenceWorkspacePresentation;
  onPresentationChange?: (next: EvidenceWorkspacePresentation) => void;
  editorState?: SourceEditorViewState;
  onEditorStateChange?: (next: SourceEditorViewState) => void;
  onCloseSource?: () => void;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const [sourceWidth, setSourceWidth] = useState(() => storedNumber(WIDTH_KEY, 44));
  const [compactLayout, setCompactLayout] = useState(false);
  const [localNavigationCollapsed, setLocalNavigationCollapsed] = useState(() => storedBoolean(NAV_KEY));
  const [localSourceMaximized, setLocalSourceMaximized] = useState(false);
  const [localSourceVisible, setLocalSourceVisible] = useState(false);
  const [localActivePane, setLocalActivePane] = useState<"navigation" | "source">("navigation");
  const [dragging, setDragging] = useState(false);
  const sourceVisible = presentation?.sourceVisible ?? localSourceVisible;
  const sourceMaximized = presentation?.sourceMaximized ?? localSourceMaximized;
  const navigationCollapsed = presentation?.navigationCollapsed ?? localNavigationCollapsed;
  const activePane = presentation?.activePane ?? localActivePane;

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCompactLayout(entry.contentRect.width < 940);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { try { window.localStorage.setItem(WIDTH_KEY, String(sourceWidth)); } catch { /* 纯布局偏好不可用时使用当前会话状态。 */ } }, [sourceWidth]);
  useEffect(() => { if (!presentation) try { window.localStorage.setItem(NAV_KEY, String(navigationCollapsed)); } catch { /* 同上。 */ } }, [navigationCollapsed, presentation]);
  const validSource = source?.repositoryId === project.repositoryId && source.snapshotId === project.snapshotId ? source : null;
  useEffect(() => { if (!presentation) { setLocalSourceVisible(false); setLocalSourceMaximized(false); setLocalActivePane("navigation"); } }, [project.repositoryId, project.snapshotId, navigationKey, presentation]);
  useEffect(() => { if (validSource && !presentation) { setLocalSourceVisible(true); setLocalActivePane("source"); } }, [validSource, presentation]);
  const changePresentation = (patch: Partial<EvidenceWorkspacePresentation>): void => {
    if (presentation) onPresentationChange?.({ ...presentation, ...patch });
    else {
      if (patch.sourceVisible !== undefined) setLocalSourceVisible(patch.sourceVisible);
      if (patch.sourceMaximized !== undefined) setLocalSourceMaximized(patch.sourceMaximized);
      if (patch.navigationCollapsed !== undefined) setLocalNavigationCollapsed(patch.navigationCollapsed);
      if (patch.activePane !== undefined) setLocalActivePane(patch.activePane);
    }
  };

  const resizeFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    if (!bounds.width) return;
    setSourceWidth(clamp(((bounds.right - event.clientX) / bounds.width) * 100));
  };
  const resizeFromKeyboard = (direction: number): void => setSourceWidth((value) => clamp(value + direction * 4));
  const split = Boolean(validSource && sourceVisible);
  const compactActivePane = split && compactLayout ? activePane : "navigation";
  const navigationHidden = split && (sourceMaximized || navigationCollapsed || (compactLayout && compactActivePane !== "navigation"));
  const sourceHidden = !split || (compactLayout && compactActivePane !== "source");
  const style: CSSProperties = { gridTemplateColumns: !split || compactLayout || sourceMaximized || navigationCollapsed ? "minmax(0,1fr)" : `minmax(0, ${100 - sourceWidth}fr) 10px minmax(0, ${sourceWidth}fr)` };

  return <div ref={root} className={`evidence-workspace ${className} ${split ? "with-source" : "without-source"} ${compactLayout ? "compact-layout" : ""} ${sourceMaximized ? "source-maximized" : ""} ${split && navigationCollapsed ? "navigation-collapsed" : ""}`} style={style} data-active-pane={compactActivePane} data-testid="evidence-workspace">
    <div className="workspace-controls" aria-label="工作区布局">
      <div className="compact-pane-switch" role="group" aria-label="工作区面板" hidden={!compactLayout || sourceMaximized}>
        <button className={compactActivePane === "navigation" ? "active" : ""} aria-pressed={compactActivePane === "navigation"} onClick={() => changePresentation({ activePane: "navigation" })}>{navigationLabel}</button>
        <button className={compactActivePane === "source" ? "active" : ""} aria-pressed={compactActivePane === "source"} disabled={!validSource} onClick={() => changePresentation({ sourceVisible: true, activePane: "source" })}>源码</button>
      </div>
      {validSource && !sourceVisible && <button className="workspace-control" onClick={() => changePresentation({ sourceVisible: true, activePane: "source" })}>显示源码</button>}
      {split && !sourceMaximized && <button className="workspace-control" onClick={() => changePresentation({ navigationCollapsed: !navigationCollapsed })} aria-expanded={!navigationCollapsed}>{navigationCollapsed ? `显示${navigationLabel}` : `收起${navigationLabel}`}</button>}
      {split && <button className="workspace-control" onClick={() => { changePresentation({ sourceVisible: false, sourceMaximized: false, navigationCollapsed: false, activePane: "navigation" }); onCloseSource?.(); }}>关闭源码</button>}
    </div>
    <div className="workspace-navigation" aria-hidden={navigationHidden} hidden={navigationHidden}>{navigation}</div>
    {split && !compactLayout && !sourceMaximized && !navigationCollapsed && <div
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
    {split && <div className="workspace-source" aria-hidden={sourceHidden} hidden={sourceHidden}><SourceViewer project={project} source={validSource} {...(onCite ? { onCite } : {})} {...(editorState ? { editorState } : {})} {...(onEditorStateChange ? { onEditorStateChange } : {})} maximized={sourceMaximized} onToggleMaximized={() => changePresentation({ sourceMaximized: !sourceMaximized })} /></div>}
  </div>;
}
