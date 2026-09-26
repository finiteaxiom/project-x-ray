import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CHANGESET_VERSION, type ChangeFile, type ChangeReport, type ComparisonMode, type ProjectOverview, type SnapshotRef, type SourceFileResult, type SourceSpan } from "@project-xray/contracts";
import { SourceViewer } from "./SourceViewer";
import { useWorkspacePageState, type OwnershipSessionController } from "../state/ownership-sessions";
import type { SourceEditorViewState } from "./SourceViewer";

const modeText: Record<ComparisonMode, string> = {
  working: "Index → 工作区",
  staged: "HEAD → Index",
  "last-commit": "父提交 → HEAD",
};

type PaneStatus = "idle" | "loading" | "ready" | "missing" | "error";
type SourcePaneState = { status: PaneStatus; path?: string; span?: SourceSpan; message?: string; editor?: SourceEditorViewState };
const emptyPane = (): SourcePaneState => ({ status: "idle" });

export function ChangeExplorer({ project, sessions }: { project: ProjectOverview; sessions: OwnershipSessionController }): ReactElement {
  const identity = `${project.repositoryId}:${project.snapshotId}`;
  const root = useRef<HTMLDivElement>(null);
  const [narrowSources, setNarrowSources] = useState(false);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const mounted = useRef(true);
  const reportRef = useRef<ChangeReport | null>(null);
  const selectionRef = useRef<string | null>(null);
  const sideSequence = useRef({ left: 0, right: 0 });

  const [mode, setMode] = useWorkspacePageState<ComparisonMode>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "mode", "working");
  const [parentNumberText, setParentNumberText] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "parentNumberText", "1");
  const [pageStartError, setPageStartError] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "startError", "");
  const [report, setReport] = useWorkspacePageState<ChangeReport | null>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "report", null);
  const [reportBasis, setReportBasis] = useWorkspacePageState<{ reportId: string; mode: ComparisonMode; parentNumber?: number } | null>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "reportBasis", null);
  const [reportState, setReportState] = useWorkspacePageState<ChangeReport["status"] | null>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "reportState", null);
  const [reportStateError, setReportStateError] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "reportStateError", "");
  const [query, setQuery] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "query", "");
  const [status, setStatus] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "status", "all");
  const [page, setPage] = useWorkspacePageState(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "page", 0);
  const [selectedId, setSelectedId] = useWorkspacePageState<string | null>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "selectedId", null);
  const [leftPane, setLeftPane] = useWorkspacePageState<SourcePaneState>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "leftPane", emptyPane());
  const [rightPane, setRightPane] = useWorkspacePageState<SourcePaneState>(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "rightPane", emptyPane());
  const [activeSourceSide, setActiveSourceSide] = useWorkspacePageState<"left" | "right">(sessions, { repositoryId: project.repositoryId, snapshotId: project.snapshotId }, "diff", "activeSourceSide", "right");
  const [leftSource, setLeftSource] = useState<SourceFileResult | null>(null);
  const [rightSource, setRightSource] = useState<SourceFileResult | null>(null);
  const job = sessions.getComparisonJob(project.repositoryId);
  const starting = job?.status === "starting";
  const taskId = job && (job.status === "running" || job.status === "cancelling") ? job.taskId : null;
  const event = job?.event ?? null;
  const startError = job?.status === "failed" ? job.error : pageStartError;
  const controllerReport = job?.report ?? null;

  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setNarrowSources(entry.contentRect.width < 920); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const numericParentNumber = Number(parentNumberText);
  const validParentNumber = Number.isInteger(numericParentNumber) && numericParentNumber >= 1 && numericParentNumber <= 32;
  const filtered = useMemo(() => (report?.files ?? []).filter((file) =>
    (status === "all" || file.status === status) &&
    `${file.oldPath ?? ""} ${file.newPath ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [report, query, status]);
  const pageSize = 50;
  const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const selected = report?.files.find((file) => file.id === selectedId) ?? null;
  const isWorking = Boolean(job && (job.status === "starting" || job.status === "running" || job.status === "cancelling"));
  const selectionDiffersFromReport = Boolean(reportBasis && (
    mode !== reportBasis.mode ||
    (mode === "last-commit" && numericParentNumber !== reportBasis.parentNumber)
  ));

  const setPane = (side: "left" | "right", value: SourcePaneState): void => {
    if (side === "left") { setLeftPane(value); if (value.status !== "ready") setLeftSource(null); }
    else { setRightPane(value); if (value.status !== "ready") setRightSource(null); }
  };

  const loadSide = async (capturedReport: ChangeReport, file: ChangeFile, side: "left" | "right", preferredSpan?: SourceSpan, evidenceId?: string): Promise<void> => {
    const request = ++sideSequence.current[side];
    const selectionKey = `${capturedReport.id}:${file.id}`;
    const identitySide = side === "left" ? capturedReport.left : capturedReport.right;
    const path = preferredSpan?.filePath ?? (side === "left" ? file.oldPath : file.newPath);
    const isCurrent = (): boolean => mounted.current &&
      sideSequence.current[side] === request && reportRef.current?.id === capturedReport.id &&
      selectionRef.current === selectionKey;

    if (!path) {
      if (isCurrent()) setPane(side, { status: "missing", message: `该变化在${side === "left" ? "左" : "右"}侧没有对应文件。` });
      return;
    }
    setPane(side, { status: "loading", path, ...(preferredSpan ? { span: preferredSpan } : {}) });
    try {
      let span = preferredSpan;
      if (!span) {
        const found = await window.xray.search({ ...identitySide.snapshot, query: path, kinds: ["file"], limit: 20 });
        if (!isCurrent()) return;
        if (found.repositoryId !== identitySide.snapshot.repositoryId || found.snapshotId !== identitySide.snapshot.snapshotId) {
          throw new Error("文件索引返回了不同的仓库快照。");
        }
        span = found.items.find((node) => node.filePath === path)?.span;
      }
      if (!span || span.filePath !== path) {
        if (isCurrent()) setPane(side, { status: "missing", path, message: `在${side === "left" ? "左" : "右"}侧快照中找不到 ${path} 的源码范围。` });
        return;
      }
      const source = await window.xray.readSource({ ...identitySide.snapshot, ...span, ...(evidenceId ? { evidenceId } : {}) });
      if (!isCurrent()) return;
      if (source.repositoryId !== identitySide.snapshot.repositoryId ||
          source.snapshotId !== identitySide.snapshot.snapshotId || source.filePath !== path) {
        throw new Error("源码响应与当前文件、比较侧或不可变快照不一致，已丢弃。");
      }
      const editor = side === "left" ? leftPane.editor : rightPane.editor;
      setPane(side, { status: "ready", path, span, ...(editor ? { editor } : {}) });
      if (side === "left") setLeftSource(source); else setRightSource(source);
    } catch (reason) {
      if (isCurrent()) setPane(side, { status: "error", path, message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const activateFile = (capturedReport: ChangeReport, file: ChangeFile | null): void => {
    sideSequence.current.left += 1;
    sideSequence.current.right += 1;
    reportRef.current = capturedReport;
    const selectionKey = file ? `${capturedReport.id}:${file.id}` : null;
    selectionRef.current = selectionKey;
    setSelectedId(file?.id ?? null);
    setLeftPane(emptyPane());
    setRightPane(emptyPane());
    if (file) {
      void loadSide(capturedReport, file, "left", file.directChanges.find((item) => item.side === "left")?.span);
      void loadSide(capturedReport, file, "right", file.directChanges.find((item) => item.side === "right")?.span);
    }
  };

  const installReport = (next: ChangeReport, requested?: { mode: ComparisonMode; parentNumber?: number }): void => {
    sideSequence.current.left += 1;
    sideSequence.current.right += 1;
    reportRef.current = next;
    setReport(next);
    setReportState(next.status);
    setReportStateError("");
    const capturedParentNumber = next.left.parentNumber ?? next.right.parentNumber ?? requested?.parentNumber;
    setReportBasis({ reportId: next.id, mode: next.mode, ...(capturedParentNumber === undefined ? {} : { parentNumber: capturedParentNumber }) });
    setQuery("");
    setStatus("all");
    const first = next.files[0] ?? null;
    activateFile(next, first);
  };

  useEffect(() => {
    mounted.current = true; identityRef.current = identity;
    reportRef.current = report;
    selectionRef.current = report && selectedId ? `${report.id}:${selectedId}` : null;
    return () => { mounted.current = false; for (const side of ["left", "right"] as const) sideSequence.current[side] += 1; };
  }, [identity]);

  useEffect(() => {
    if (!report || !selectedId) return;
    const file = report.files.find((item) => item.id === selectedId);
    if (!file) { setSelectedId(null); setLeftPane(emptyPane()); setRightPane(emptyPane()); return; }
    for (const side of ["left", "right"] as const) {
      const pane = side === "left" ? leftPane : rightPane;
      if (pane.path && (pane.status === "ready" || pane.status === "loading")) void loadSide(report, file, side, pane.span);
    }
  }, []);

  useEffect(() => {
    if (controllerReport && controllerReport.id !== report?.id) installReport(controllerReport, job ? { mode: job.request.mode, ...(job.request.parentNumber === undefined ? {} : { parentNumber: job.request.parentNumber }) } : undefined);
  }, [controllerReport?.id, report?.id]);

  useEffect(() => {
    if (!report) return;
    const reportId = report.id;
    let current = true;
    const check = (): void => {
      void window.xray.getChangeReportState({ repositoryId: report.repositoryId, reportId })
        .then((value) => {
          if (!current || reportRef.current?.id !== reportId) return;
          if (value.repositoryId !== report.repositoryId || value.reportId !== reportId) throw new Error("状态响应属于其他报告。");
          setReportState(value.status);
          setReportStateError("");
        })
        .catch((reason: unknown) => {
          if (!current || reportRef.current?.id !== reportId) return;
          setReportStateError(reason instanceof Error ? reason.message : String(reason));
        });
    };
    check();
    const timer = window.setInterval(check, 3_000);
    return () => { current = false; window.clearInterval(timer); };
  }, [report?.id]);

  const start = async (): Promise<void> => {
    const active = sessions.getComparisonJob(project.repositoryId);
    if (active && (active.status === "starting" || active.status === "running" || active.status === "cancelling")) return;
    if (mode === "last-commit" && !validParentNumber) {
      setPageStartError("父提交序号必须是 1 到 32 的整数。");
      return;
    }
    const request = { repositoryId: project.repositoryId, snapshotId: project.snapshotId, mode, ...(mode === "last-commit" ? { parentNumber: numericParentNumber } : {}), maxDepth: 4, maxPaths: 30, maxWork: 5000 };
    setPageStartError("");
    sessions.startComparison(project, request, () => window.xray.startComparison(request), (id) => window.xray.cancelComparison(id));
  };

  const cancel = async (): Promise<void> => {
    sessions.requestComparisonCancel(project.repositoryId);
  };

  const selectFile = (file: ChangeFile): void => {
    const activeReport = reportRef.current;
    if (activeReport) activateFile(activeReport, file);
  };

  const openDirectChange = (side: "left" | "right", file: ChangeFile, span?: SourceSpan): void => {
    const activeReport = reportRef.current;
    if (activeReport) void loadSide(activeReport, file, side, span);
  };

  const openImpactEvidence = (path: ChangeReport["impactPaths"][number], evidenceIndex = 0): void => {
    const activeReport = reportRef.current;
    const activeFile = selected;
    const evidence = path.evidence[evidenceIndex];
    if (!activeReport || !activeFile || !evidence || activeReport.id !== report?.id) return;
    void loadSide(activeReport, activeFile, path.side, { ...evidence.span }, evidence.id);
  };

  const retrySide = (side: "left" | "right"): void => {
    const activeReport = reportRef.current;
    const activeFile = activeReport?.files.find((file) => file.id === selectedId);
    if (activeReport && activeFile) void loadSide(activeReport, activeFile, side);
  };

  useEffect(() => {
    if (!report || !selectedId || filtered.some((file) => file.id === selectedId)) return;
    sideSequence.current.left += 1;
    sideSequence.current.right += 1;
    selectionRef.current = null;
    setSelectedId(null);
    setLeftPane(emptyPane());
    setRightPane(emptyPane());
    setLeftSource(null);
    setRightSource(null);
  }, [filtered, report, selectedId]);

  const rightStateText: Record<ChangeReport["status"], string> = { current: "当前", stale: "已过期", missing: "报告缺失" };

  return <div className={`change-explorer ${narrowSources ? "compact-change-layout" : ""}`} ref={root}>
    <section className="panel change-controls" aria-label="Git 比较控制">
      <div className="panel-heading">
        <div><span className="kicker">双侧不可变快照 · {CHANGESET_VERSION} · {project.name}</span><h3>Git 变更解释与影响路径</h3></div>
        <span className={`health ${reportState ?? "missing"}`}>{report ? rightStateText[reportState ?? report.status] : "未生成"}</span>
      </div>
      <div className="flow-controls comparison-controls">
        <label>比较基准<select aria-label="比较模式" value={mode} disabled={isWorking} onChange={(input) => setMode(input.target.value as ComparisonMode)}>
          <option value="working">Index → 工作区</option><option value="staged">HEAD → Index</option><option value="last-commit">父提交 → HEAD</option>
        </select></label>
        {mode === "last-commit" && <label>父提交序号（1–32）<input aria-label="父提交序号" type="number" min="1" max="32" step="1" value={parentNumberText} disabled={isWorking} aria-invalid={!validParentNumber} onChange={(input) => setParentNumberText(input.target.value)} /></label>}
        <button className="button primary" disabled={isWorking || (mode === "last-commit" && !validParentNumber)} onClick={() => void start()}>{starting ? "正在启动比较…" : job?.status === "cancelling" ? "正在取消…" : isWorking ? "正在比较…" : job?.status === "failed" || job?.status === "cancelled" ? "重试比较" : reportState === "stale" ? "安全重算" : "生成比较报告"}</button>
        {isWorking && <button className="button secondary" disabled={job?.status === "cancelling"} onClick={() => void cancel()}>{job?.status === "cancelling" ? "正在取消…" : "取消比较"}</button>}
      </div>
      {mode === "last-commit" && !validParentNumber && <p className="comparison-validation" role="alert">父提交序号必须是 1 到 32 的整数。</p>}
      {starting && <p className="task-status comparison-starting" role="status">正在启动本地 Git 比较。任务已归属 {job?.projectName ?? project.name}，切换页面不会取消。</p>}
      {event?.type === "progress" && <div className="task-status" data-testid="comparison-progress" role="status"><b>{event.progress.phase}</b><progress value={event.progress.completed} max={Math.max(1, event.progress.total)} /><span>{event.progress.currentFile ?? "准备中"}</span></div>}
      {job?.status === "cancelling" && <p className="task-status" role="status">已请求取消，等待比较后端确认终态。</p>}
      {job?.cancelError && <div className="error-banner" role="alert">取消请求失败：{job.cancelError}。任务仍由后台跟踪。</div>}
      {event?.type === "failed" && <div className="callout comparison-failure" role="alert"><span>{event.message}</span><button className="button secondary" onClick={() => void start()}>重试比较</button></div>}
      {event?.type === "cancelled" && <div className="callout comparison-cancelled" role="status"><span>{event.message}</span><button className="button secondary" onClick={() => void start()}>重新比较</button></div>}
      {startError && <div className="error-banner" role="alert">比较失败：{startError}<button className="button secondary" onClick={() => void start()}>重试</button></div>}
      {report && <>
        {isWorking && <div className="stale-banner" role="status">新比较正在运行。下方仍是上一份报告，其基准、快照和源码不会随当前选择器变化。</div>}
        {selectionDiffersFromReport && <div className="report-selection-notice" role="status" data-testid="report-selection-notice">当前报告基准：{modeText[reportBasis?.mode ?? report.mode]}{reportBasis?.mode === "last-commit" ? ` · 父提交序号 ${reportBasis.parentNumber ?? "未记录"}` : ""}。选择器已修改为：{modeText[mode]}{mode === "last-commit" ? ` · 父提交序号 ${parentNumberText}` : ""}；重新生成前，当前报告仍使用原基准。</div>}
        <ReportBasis report={report} reportBasis={reportBasis} status={reportState ?? report.status} />
        <details className="report-identity-details">
          <summary>查看完整比较身份与分析详情</summary>
          <ComparisonIdentityDetails report={report} />
        </details>
        {reportStateError && <div className="error-banner report-state-error" role="alert">无法刷新报告状态：{reportStateError}。仍显示报告生成时记录的状态“{report.status}”。</div>}
        {report.completeness.status === "partial" && <div className="callout" data-testid="comparison-partial">分析不完整：{[...report.left.completeness.failures, ...report.right.completeness.failures].map((item) => `${item.filePath}：${item.reason}`).join("；") || report.completeness.impact.reasons.join("；") || "存在排除或无法映射的内容"}</div>}
        {report.files.length === 0 && <div className="callout" data-testid="comparison-no-changes">左右捕获内容没有变化。</div>}
        {report.truncated && <div className="callout" data-testid="comparison-truncated">查询已截断：{report.truncationReasons.join("、")}</div>}
        {reportState && reportState !== "current" && <div className="stale-banner" data-testid="change-report-stale">报告对应的历史源码仍可读，但当前 Git 状态为“{rightStateText[reportState]}”。请安全重算；已生成报告不会被覆盖。</div>}
      </>}
    </section>

    {report && <>
      <div className="change-layout">
        <section className="panel change-files" aria-label="变化文件列表">
          <div className="query-row"><input aria-label="搜索变化文件" placeholder="筛选变化文件" value={query} onChange={(input) => { setQuery(input.target.value); setPage(0); }} /><select aria-label="变化状态" value={status} onChange={(input) => { setStatus(input.target.value); setPage(0); }}><option value="all">全部状态</option>{["added", "modified", "deleted", "renamed", "copied", "untracked", "conflicted"].map((item) => <option key={item}>{item}</option>)}</select></div>
          <small>{modeText[report.mode]} · {filtered.length} / {report.files.length} 个文件 · 预算 {report.queryBudget.maxDepth} hop / {report.queryBudget.maxPaths} 路径 / {report.queryBudget.maxWork} work</small>
          {pageItems.map((file) => <button className={`change-file ${selected?.id === file.id ? "active" : ""}`} key={file.id} aria-pressed={selected?.id === file.id} onClick={() => selectFile(file)} title={file.newPath ?? file.oldPath}>
            <b>{file.status} · {file.oldPath ?? "（新增文件）"}{file.newPath && file.newPath !== file.oldPath ? ` → ${file.newPath}` : ""}</b><span>{file.classification} / {file.classificationConfidence} · +{file.additions} −{file.deletions}</span><small>{file.classificationReason}{file.unsupportedReason ? ` · ${file.unsupportedReason}` : ""}</small>
          </button>)}
          {report.files.length > 0 && filtered.length === 0 && <div className="empty-state comparison-empty" role="status">没有匹配的变化文件。<button className="button secondary" onClick={() => { setQuery(""); setStatus("all"); setPage(0); }}>清除筛选</button></div>}
          <div className="query-row pagination"><button disabled={page === 0 || filtered.length === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><span>{filtered.length === 0 ? 0 : page + 1} / {Math.max(1, Math.ceil(filtered.length / pageSize))}</span><button disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage((value) => value + 1)}>下一页</button></div>
        </section>

        <section className="panel change-detail" aria-label="变化详情">
          {selected ? <>
            <h3 title={`${selected.oldPath ?? ""}${selected.newPath ? ` → ${selected.newPath}` : ""}`}>{selected.oldPath ?? "（新增文件）"}{selected.newPath && selected.newPath !== selected.oldPath ? ` → ${selected.newPath}` : ""}</h3>
            <div className="hunk-list"><b>文本变化</b>{selected.hunks.length ? selected.hunks.map((hunk) => <button key={hunk.id} onClick={() => { openDirectChange("left", selected, selected.directChanges.find((item) => item.side === "left")?.span); openDirectChange("right", selected, selected.directChanges.find((item) => item.side === "right")?.span); }}>{hunk.header}</button>) : <span>没有文本 hunk；文件状态和分类仍保留。</span>}</div>
            <div className="direct-list"><b>直接变化</b>{selected.directChanges.map((item) => <button key={item.id} onClick={() => openDirectChange(item.side, selected, item.span)}>{item.side === "left" ? "左侧" : "右侧"} · {item.match} · {item.reason}</button>)}{selected.directChanges.length === 0 && <span>没有映射到符号的直接变化证据。</span>}</div>
            <div className="impact-list"><b>可能影响路径</b>{report.impactPaths.filter((path) => path.changeId === selected.id).map((path) => { const evidence = path.evidence[0]; return <button key={path.id} disabled={!evidence} data-evidence-id={evidence?.id ?? ""} data-side={path.side} data-snapshot-id={(path.side === "left" ? report.left : report.right).snapshot.snapshotId} onClick={() => openImpactEvidence(path)}><span>{path.side === "left" ? "左侧" : "右侧"} · {path.nodes.map((node) => node.name).join(" ← ")}</span><small>{path.confidence} · 静态关系证据，不代表运行时路径或已证明业务影响 · {path.edges.length} 条图边 · work {path.budget.usedWork}/{path.budget.maxWork}{path.truncated ? " · 已截断" : ""}</small></button>; })}{!report.impactPaths.some((path) => path.changeId === selected.id) && <span>{report.completeness.status === "partial" ? "分析不完整，当前没有已知影响路径；不能据此排除影响。" : "没有已知影响路径；这不等于确认无影响。"}</span>}</div>
          </> : <div className="empty-state">{report.files.length === 0 ? "本报告没有变化文件。" : filtered.length === 0 ? "清除筛选后选择一个变化文件。" : "选择变化文件查看摘要、证据和双侧源码。"}</div>}
        </section>
      </div>

      <div className="comparison-source-workspace">
        <div className="comparison-source-switch view-switch" role="tablist" aria-label="比较源码侧" hidden={!narrowSources}>
          <button role="tab" aria-selected={activeSourceSide === "left"} className={activeSourceSide === "left" ? "active" : ""} onClick={() => setActiveSourceSide("left")}>左侧 · {report.left.label}</button>
          <button role="tab" aria-selected={activeSourceSide === "right"} className={activeSourceSide === "right" ? "active" : ""} onClick={() => setActiveSourceSide("right")}>右侧 · {report.right.label}</button>
        </div>
        <div className={`comparison-sources ${narrowSources ? "compact-comparison-sources" : ""}`}>
          <SourceSide title={`左侧不可变源码 · ${report.left.label}`} identity={report.left.snapshot} pane={leftPane} source={leftSource} hidden={narrowSources && activeSourceSide !== "left"} onRetry={() => retrySide("left")} onEditorStateChange={(editor) => setLeftPane((prior) => ({ ...prior, editor }))} />
          <SourceSide title={`右侧不可变源码 · ${report.right.label}`} identity={report.right.snapshot} pane={rightPane} source={rightSource} hidden={narrowSources && activeSourceSide !== "right"} onRetry={() => retrySide("right")} onEditorStateChange={(editor) => setRightPane((prior) => ({ ...prior, editor }))} />
        </div>
      </div>
    </>}
    {!report && !isWorking && <div className="panel empty-state comparison-initial">选择比较基准后生成报告。报告会记录双方快照、提交或内容指纹及分析完整性。</div>}
  </div>;
}

function ReportBasis({ report, reportBasis, status }: { report: ChangeReport; reportBasis: { reportId: string; mode: ComparisonMode; parentNumber?: number } | null; status: ChangeReport["status"] }): ReactElement {
  const stateText = status === "current" ? "报告仍对应当前比较基准" : status === "stale" ? "历史报告准确描述捕获时基准；当前基准已变化" : "历史报告已保留；后端未能确认其当前状态";
  const parent = reportBasis?.reportId === report.id ? reportBasis.parentNumber : report.left.parentNumber ?? report.right.parentNumber;
  return <section className={`report-basis ${status}`} data-testid="comparison-identities" data-report-id={report.id} aria-label="已生成报告基准">
    <div><b>报告基准：{modeText[report.mode]}{report.mode === "last-commit" ? ` · 父提交序号 ${parent ?? "未记录"}` : ""}</b><small>{report.left.label} → {report.right.label} · {stateText}</small></div>
    <code>报告 {report.id.slice(0, 12)}</code>
  </section>;
}

function ComparisonIdentityDetails({ report }: { report: ChangeReport }): ReactElement {
  const details = {
    report: { id: report.id, repositoryId: report.repositoryId, mode: report.mode, createdAt: report.createdAt, captureFingerprint: report.captureFingerprint, queryBudget: report.queryBudget, completeness: report.completeness, truncated: report.truncated, truncationReasons: report.truncationReasons, failures: report.failures, limitations: report.limitations },
    left: report.left,
    right: report.right,
  };
  return <div className="comparison-identities">
    <div><b>左侧 · {report.left.label}</b><small>{report.left.kind} · 快照 {report.left.snapshot.repositoryId} / {report.left.snapshot.snapshotId}</small><small>revision {report.left.revision ?? "无提交 SHA"}</small><small>内容指纹 {report.left.contentFingerprint}</small><small>配置指纹 {report.left.manifestFingerprint} · 完整性 {report.left.completeness.status}</small></div>
    <div><b>右侧 · {report.right.label}</b><small>{report.right.kind} · 快照 {report.right.snapshot.repositoryId} / {report.right.snapshot.snapshotId}</small><small>revision {report.right.revision ?? "无提交 SHA"}</small><small>内容指纹 {report.right.contentFingerprint}</small><small>配置指纹 {report.right.manifestFingerprint} · 完整性 {report.right.completeness.status}</small></div>
    <details className="comparison-metadata-json"><summary>检查完整快照、配置、分析限制与报告元数据</summary><pre>{JSON.stringify(details, null, 2)}</pre></details>
  </div>;
}

function SourceSide({ title, identity, pane, source, hidden, onRetry, onEditorStateChange }: { title: string; identity: SnapshotRef; pane: SourcePaneState; source: SourceFileResult | null; hidden: boolean; onRetry: () => void; onEditorStateChange: (state: SourceEditorViewState) => void }): ReactElement {
  const message = pane.status === "loading" ? `正在读取 ${pane.path ?? "所选源码"}`
    : pane.status === "missing" ? pane.message ?? "该侧没有对应源码。"
      : pane.status === "error" ? pane.message ?? "源码读取失败。"
        : pane.status === "idle" ? "选择变化文件后读取此侧不可变源码。" : "";
  return <section className="comparison-source-side" aria-label={`${title} · 快照 ${identity.snapshotId}`} aria-hidden={hidden} hidden={hidden}>
    <div className="comparison-source-heading"><b>{title}</b><span title={pane.path}>{pane.path ?? "尚未选择文件"} · snapshot {identity.snapshotId.slice(0, 12)}</span></div>
    {pane.status !== "ready" && <div className={`source-read-state ${pane.status}`} role={pane.status === "error" ? "alert" : "status"} aria-live="polite">{message}{pane.status === "error" && <button className="button secondary" onClick={onRetry}>重试读取</button>}</div>}
    <SourceViewer project={identity} source={pane.status === "ready" ? source : null} {...(pane.editor ? { editorState: pane.editor } : {})} onEditorStateChange={onEditorStateChange} />
  </section>;
}
