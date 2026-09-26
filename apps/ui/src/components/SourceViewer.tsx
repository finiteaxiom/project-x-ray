import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { SnapshotRef, SourceCitation, SourceFileResult } from "@project-xray/contracts";

const WRAP_KEY = "project-xray:source-viewer:word-wrap";

export type SourceEditorViewState = { selection: Pick<SourceCitation, "startLine" | "startColumn" | "endLine" | "endColumn"> | null; scrollTop: number; scrollLeft: number };

export function SourceViewer({ project, source, onCite, maximized = false, onToggleMaximized, editorState, onEditorStateChange }: { project: SnapshotRef; source: SourceFileResult | null; onCite?: (items: SourceCitation[]) => void; maximized?: boolean; onToggleMaximized?: () => void; editorState?: SourceEditorViewState; onEditorStateChange?: (next: SourceEditorViewState) => void }): ReactElement {
  type MountedEditor = Parameters<OnMount>[0]; type MountedMonaco = Parameters<OnMount>[1];
  const panelRef = useRef<HTMLElement | null>(null); const editorRef = useRef<MountedEditor | null>(null); const monacoRef = useRef<MountedMonaco | null>(null); const decorations = useRef<ReturnType<MountedEditor["createDecorationsCollection"]> | null>(null); const listener = useRef<ReturnType<MountedEditor["onDidChangeCursorSelection"]> | null>(null); const scrollListener = useRef<ReturnType<MountedEditor["onDidScrollChange"]> | null>(null);
  const editorStateRef = useRef(editorState); editorStateRef.current = editorState;
  const editorStateChangeRef = useRef(onEditorStateChange); editorStateChangeRef.current = onEditorStateChange;
  const sourceRef = useRef(source); sourceRef.current = source;
  const [selection, setSelection] = useState(editorState?.selection ?? { startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 }); const selectionRef = useRef(selection); selectionRef.current = selection; const [actualSelection, setActualSelection] = useState(""); const [citationError, setCitationError] = useState(""); const [monacoReady, setMonacoReady] = useState(import.meta.env.MODE === "test");
  const [wordWrap, setWordWrap] = useState<"on" | "off">(() => { try { return window.localStorage.getItem(WRAP_KEY) === "on" ? "on" : "off"; } catch { return "off"; } });
  useEffect(() => { if (source && !monacoReady) void import("../monaco").then(() => setMonacoReady(true)); }, [source, monacoReady]);
  const focusTarget = useCallback(() => {
    const target = sourceRef.current?.targetSpan;
    if (!target || !editorRef.current || !monacoRef.current) return;
    const span = target; const range = new monacoRef.current.Range(span.startLine, span.startColumn + 1, span.endLine, Math.max(span.startColumn + 1, span.endColumn + 1));
    const targetSelection = { startLine: span.startLine, startColumn: span.startColumn, endLine: span.endLine, endColumn: span.endColumn };
    editorRef.current.revealRangeInCenter(range); editorRef.current.setSelection(range); setSelection(targetSelection); selectionRef.current = targetSelection; setActualSelection(`${span.startLine}:${span.startColumn}-${span.endLine}:${span.endColumn}`); decorations.current?.clear();
    decorations.current = editorRef.current.createDecorationsCollection([{ range, options: { isWholeLine: span.startLine !== span.endLine, className: "evidence-highlight", ...(span.startLine === span.endLine ? { inlineClassName: "evidence-inline-highlight" } : {}) } }]);
  }, []);
  const applySavedView = useCallback(() => {
    const editor = editorRef.current; const monaco = monacoRef.current; const saved = editorStateRef.current;
    if (!editor || !monaco || !saved) return;
    if (saved.selection) {
      const range = new monaco.Range(saved.selection.startLine, saved.selection.startColumn + 1, saved.selection.endLine, saved.selection.endColumn + 1);
      editor.setSelection(range); setSelection(saved.selection); setActualSelection(`${saved.selection.startLine}:${saved.selection.startColumn}-${saved.selection.endLine}:${saved.selection.endColumn}`); editor.revealRangeInCenter(range);
    }
    if (saved.scrollTop >= 0) editor.setScrollTop(saved.scrollTop);
    if (saved.scrollLeft >= 0) editor.setScrollLeft(saved.scrollLeft);
  }, []);
  useEffect(() => { focusTarget(); }, [focusTarget]);
  const sourceKey = source ? `${source.contentHash}:${source.targetSpan?.filePath ?? source.filePath}:${source.targetSpan?.startLine ?? 0}:${source.targetSpan?.startColumn ?? 0}:${source.targetSpan?.endLine ?? 0}:${source.targetSpan?.endColumn ?? 0}` : "";
  const restoredSourceKey = useRef("");
  const onMount: OnMount = (editor, monaco) => { monaco.editor.defineTheme("xray-graphite", { base: "vs-dark", inherit: true, rules: [{ token: "comment", foreground: "AAB7CD" }, { token: "keyword", foreground: "C1B2FF" }, { token: "string", foreground: "EFD09E" }, { token: "number", foreground: "98DFCB" }, { token: "type", foreground: "93D7FF" }, { token: "identifier", foreground: "E5E8F2" }], colors: { "editor.background": "#111218", "editor.foreground": "#d9dbe8", "editorLineNumber.foreground": "aeb5ca", "editor.selectionBackground": "#353149", "editor.inactiveSelectionBackground": "#2b2c3c", "editor.lineHighlightBackground": "#1c1d28" } }); monaco.editor.setTheme("xray-graphite"); editorRef.current = editor; monacoRef.current = monaco; listener.current?.dispose(); scrollListener.current?.dispose(); listener.current = editor.onDidChangeCursorSelection((event) => { const next = { startLine: event.selection.startLineNumber, startColumn: event.selection.startColumn - 1, endLine: event.selection.endLineNumber, endColumn: event.selection.endColumn - 1 }; setSelection(next); selectionRef.current = next; setActualSelection(`${next.startLine}:${next.startColumn}-${next.endLine}:${next.endColumn}`); editorStateChangeRef.current?.({ selection: next, scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft() }); }); scrollListener.current = editor.onDidScrollChange(() => editorStateChangeRef.current?.({ selection: selectionRef.current, scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft() })); editor.layout(); focusTarget(); applySavedView(); };
  useEffect(() => { if (sourceKey && editorRef.current && restoredSourceKey.current !== sourceKey) { restoredSourceKey.current = sourceKey; focusTarget(); applySavedView(); } }, [sourceKey, focusTarget, applySavedView]);
  useEffect(() => () => { listener.current?.dispose(); scrollListener.current?.dispose(); }, []);
  useEffect(() => { try { window.localStorage.setItem(WRAP_KEY, wordWrap); } catch { /* 不持久化源码，只忽略不可用的布局偏好。 */ } editorRef.current?.updateOptions({ wordWrap }); editorRef.current?.layout(); }, [wordWrap]);
  useEffect(() => { const element = panelRef.current; if (!element || typeof ResizeObserver === "undefined") return; const observer = new ResizeObserver(() => editorRef.current?.layout()); observer.observe(element); return () => observer.disconnect(); }, []);
  const cite = async () => { if (!source || !onCite) return; setCitationError(""); try { const evidence = await window.xray.findEvidence({ ...project, span: { filePath: source.filePath, ...selection }, limit: 50 }); if (!evidence.items.length) { setCitationError("选中范围没有可验证证据；请选择符号定义、调用或读写位置。"); return; } onCite(evidence.items.map((item) => ({ filePath: source.filePath, ...selection, evidenceId: item.id }))); if (evidence.truncated) setCitationError(`该范围共有 ${evidence.total} 条证据；本次引用前 ${evidence.items.length} 条，请缩小选择范围。`); } catch (error) { setCitationError(error instanceof Error ? error.message : String(error)); } };
  return <section ref={panelRef} className="source-panel" data-testid="source-viewer" data-monaco-selection={actualSelection} data-snapshot-id={source?.snapshotId ?? project.snapshotId} data-source-file={source?.filePath ?? ""} data-evidence-id={source?.evidence?.id ?? ""} data-content-hash={source?.contentHash ?? ""}>
    <div className="source-toolbar"><div className="source-title"><span className="kicker">快照源码证据</span><h3 title={source?.filePath} data-testid="source-location">{source ? `${source.filePath}:${source.targetSpan?.startLine ?? 1}:${source.targetSpan?.startColumn ?? 0}` : "选择一个源码节点或关系"}</h3>{source && <details className="source-full-path"><summary>查看完整路径</summary><code>{source.filePath}</code></details>}</div><div className="source-actions"><button className={`toolbar-button ${wordWrap === "on" ? "active" : ""}`} aria-pressed={wordWrap === "on"} onClick={() => setWordWrap((value) => value === "on" ? "off" : "on")}>自动换行</button>{onToggleMaximized && <button className="toolbar-button" aria-pressed={maximized} onClick={onToggleMaximized}>{maximized ? "还原" : "最大化"}</button>}{onCite && source && <button className="button secondary" onClick={() => void cite()}>引用选中范围</button>}</div></div>
    {citationError && <div className="source-status missing">{citationError}</div>}
    {source && source.workspaceStatus !== "current" && <div className={`source-status ${source.workspaceStatus}`}>{source.workspaceStatus === "stale" ? "工作区源码已变化；这里显示的是不可变快照内容。" : "工作区文件已不存在；这里显示的是历史快照内容。"}</div>}
    <div className="source-editor-frame">{source && monacoReady ? <Editor height="100%" path={`${source.snapshotId}/${source.filePath}`} language={source.language.toLowerCase() === "typescript" ? "typescript" : source.language.toLowerCase() === "javascript" ? "javascript" : "python"} value={source.content} onMount={onMount} theme="vs-dark" options={{ readOnly: true, wordWrap, automaticLayout: false, minimap: { enabled: false }, fontSize: 13, lineNumbersMinChars: 3, padding: { top: 14 }, renderLineHighlight: "all", scrollBeyondLastLine: false, scrollbar: { horizontal: "visible", horizontalScrollbarSize: 12, verticalScrollbarSize: 12 }, overviewRulerLanes: 0 }} /> : <div className="empty-state">{source ? "正在本地加载源码编辑器……" : "点击图节点、关系、解释步骤或答题反馈，在这里定位准确源码范围。"}</div>}</div>
  </section>;
}
