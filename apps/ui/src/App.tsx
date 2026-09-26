import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import type { Evidence, GraphEdge, GraphNode, IndexTaskEvent, IndexTaskHandle, ProjectOverview, SnapshotRef, SnapshotState, SourceFileResult } from "@project-xray/contracts";
import { FlowExplorer } from "./components/FlowExplorer";
import { ChangeExplorer } from "./components/ChangeExplorer";
import { ArchitectureWorkspace } from "./components/ArchitectureWorkspace";
import { FeatureExplanationWorkspace } from "./components/FeatureExplanationWorkspace";
import { OwnershipWorkspace } from "./components/OwnershipWorkspace";
import { createOwnershipSessionController, emptyWorkspaceSourceView, type TrainingLocation, type WorkspacePage, type WorkspaceSourceView } from "./state/ownership-sessions";

type Page = "overview" | "architecture" | "flow" | "explain" | "diff" | "ownership";
type Runner = <T>(snapshotId: string | null, operation: () => Promise<T>, done: (value: T) => void) => Promise<void>;
type SourceNavigationRequest = { requestId: number; identity: string; generation: number; ref: SnapshotRef; page: Page; pageGeneration: number; workspacePage?: WorkspacePage; workspacePageGeneration?: number; trainingSessionId?: string };
const pages: Array<{ id: Page; label: string; eyebrow: string }> = [{ id: "overview", label: "项目概览", eyebrow: "01" }, { id: "architecture", label: "架构地图", eyebrow: "02" }, { id: "flow", label: "调用 / 数据流", eyebrow: "03" }, { id: "explain", label: "功能解释", eyebrow: "04" }, { id: "diff", label: "Git 变更", eyebrow: "05" }, { id: "ownership", label: "所有权模式", eyebrow: "06" }];
const confidenceText = { verified: "已验证", inferred: "推断", unknown: "未知" } as const;
function refOf(project: ProjectOverview): SnapshotRef { return { repositoryId: project.repositoryId, snapshotId: project.snapshotId }; }
function identityOf(ref: SnapshotRef | null): string | null { return ref ? JSON.stringify([ref.repositoryId, ref.snapshotId]) : null; }
function shortId(value: string): string { return value.slice(0, 10); }
function workspacePageFor(page: Page): WorkspacePage | null { return page === "architecture" || page === "flow" || page === "explain" || page === "diff" ? page : null; }
function NavIcon({ page }: { page: Page }): ReactElement {
  const paths: Record<Page, string> = { overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', architecture: 'M9 3h6v6H9z M2 16h6v5H2z M16 16h6v5h-6z M12 9v4 M5 16v-3h14v3', flow: 'M3 6h12 M11 2l4 4-4 4 M21 18H9 M13 14l-4 4 4 4', explain: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5', diff: 'M6 5v14 M6 8c0 8 12 0 12 8 M15 4h6 M18 1v6 M3 19h6', ownership: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6' };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page]} /></svg>;
}
function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }): ReactElement { return <div className={`stat ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong></div>; }

export function App(): ReactElement {
  const [page, setPage] = useState<Page>("overview"); const [project, setProject] = useState<ProjectOverview | null>(null); const [snapshotState, setSnapshotState] = useState<SnapshotState | null>(null);
  const [task, setTask] = useState<IndexTaskHandle | null>(null); const [taskEvent, setTaskEvent] = useState<IndexTaskEvent | null>(null); const [error, setError] = useState(""); const [gitUrl, setGitUrl] = useState(""); const [source, setSource] = useState<SourceFileResult | null>(null); const [trainingSource, setTrainingSource] = useState<SourceFileResult | null>(null);
  const [ownershipSessions] = useState(createOwnershipSessionController);
  useSyncExternalStore(ownershipSessions.subscribe, ownershipSessions.getRevision, ownershipSessions.getRevision);
  const comparisonJobs = ownershipSessions.listComparisonJobs();
  const [comparisonFocusRepository, setComparisonFocusRepository] = useState<string | null>(null);
  const activeTask = useRef<string | null>(null); const activeSnapshot = useRef<string | null>(null); const sourceRequest = useRef(0);
  const indexRequestSequence = useRef(0); const workspaceActivationEpoch = useRef(0);
  const projectSession = useRef<{ identity: string | null; generation: number }>({ identity: null, generation: 0 });
  const activePage = useRef<Page>("overview"); const pageGeneration = useRef(0);
  const appMounted = useRef(false);
  const navigateTo = useCallback((next: Page) => {
    if (activePage.current !== next) {
      if (activePage.current === "ownership" && project) {
        const trainingId = ownershipSessions.sessionId(refOf(project));
        if (trainingId) ownershipSessions.updateSession(trainingId, (session) => ({ ...session, sourceView: { ...session.sourceView, loading: false } }));
      }
      activePage.current = next; pageGeneration.current += 1; sourceRequest.current += 1;
      setComparisonFocusRepository(null);
      setSource(null); setTrainingSource(null);
    }
    setPage(next);
  }, [ownershipSessions, project]);
  const installProject = useCallback((value: ProjectOverview | null, options: { forceFreshTraining?: boolean; invalidateSession?: boolean; activationEpoch?: number } = {}) => {
    const identity = identityOf(value);
    const transition = projectSession.current.identity !== identity || options.forceFreshTraining || options.invalidateSession || options.activationEpoch !== undefined;
    if (transition) {
      projectSession.current = { identity, generation: projectSession.current.generation + 1 };
      sourceRequest.current += 1;
      setSource(null); setTrainingSource(null); setSnapshotState(null); setError("");
    }
    activeSnapshot.current = value?.snapshotId ?? null;
    if (value) { ownershipSessions.activate(refOf(value), options.forceFreshTraining); ownershipSessions.activateWorkspaceSnapshot(refOf(value), options.activationEpoch); }
    setProject(value);
  }, [ownershipSessions]);
  useEffect(() => { appMounted.current = true; return () => { appMounted.current = false; sourceRequest.current += 1; projectSession.current = { ...projectSession.current, generation: projectSession.current.generation + 1 }; }; }, []);
  useEffect(() => { void window.xray.getCurrentProject().then(installProject).catch(() => undefined); }, [installProject]);
  useEffect(() => window.xray.onComparisonEvent((event) => ownershipSessions.receiveComparisonEvent(event)), [ownershipSessions]);
  const handleIndexEvent = useCallback((event: IndexTaskEvent): void => {
    if (event.taskId !== activeTask.current) return;
    setTaskEvent(event);
    if (event.type === "completed") {
      activeTask.current = null;
      const requestSequence = indexRequestSequence.current;
      const ref = refOf(event.overview);
      void window.xray.getSnapshotState(ref).then((state) => {
        if (indexRequestSequence.current !== requestSequence) return;
        if (event.repositoryId !== ref.repositoryId || state.repositoryId !== ref.repositoryId || state.snapshotId !== ref.snapshotId) {
          throw new Error("索引结果与后端确认的仓库或快照不一致，未激活该页面会话。");
        }
        const confirmedCurrent = state.status === "current" && state.snapshotAvailability === "available";
        const currentTrainingId = ownershipSessions.sessionId(ref);
        const forceFreshTraining = confirmedCurrent && currentTrainingId !== null && ownershipSessions.getSession(currentTrainingId)?.lifecycle === "stale";
        const activationEpoch = confirmedCurrent ? ++workspaceActivationEpoch.current : undefined;
        installProject(event.overview, { forceFreshTraining, invalidateSession: !confirmedCurrent, ...(activationEpoch !== undefined ? { activationEpoch } : {}) });
        setSnapshotState(state);
        if (!confirmedCurrent) {
          ownershipSessions.markStale(ref);
          ownershipSessions.markWorkspaceStale(ref);
        }
        navigateTo("overview");
        setTask(null);
      }).catch((reason: unknown) => {
        if (indexRequestSequence.current !== requestSequence) return;
        setTask(null);
        setError(`索引已完成，但无法确认快照当前有效：${reason instanceof Error ? reason.message : String(reason)}`);
      });
      return;
    }
    if (event.type === "failed" || event.type === "cancelled") {
      activeTask.current = null;
      setTask(null);
    }
  }, [installProject, navigateTo, ownershipSessions]);
  useEffect(() => window.xray.onIndexEvent(handleIndexEvent), [handleIndexEvent]);
  const currentIdentity = identityOf(project);
  const currentGeneration = projectSession.current.generation;
  const refreshState = useCallback(async () => {
    if (!project || !appMounted.current || projectSession.current.identity !== currentIdentity || projectSession.current.generation !== currentGeneration) return;
    try {
      const state = await window.xray.getSnapshotState(refOf(project));
      if (appMounted.current && projectSession.current.identity === currentIdentity && projectSession.current.generation === currentGeneration && state.repositoryId === project.repositoryId && state.snapshotId === project.snapshotId) {
        setSnapshotState(state);
        if (state.status !== "current" || state.snapshotAvailability !== "available") { ownershipSessions.markStale(refOf(project)); ownershipSessions.markWorkspaceStale(refOf(project)); }
      }
    } catch { /* 调用方显示错误。 */ }
  }, [project, currentIdentity, currentGeneration, ownershipSessions]);
  useEffect(() => { void refreshState(); const timer = window.setInterval(() => void refreshState(), 3_000); const focus = () => void refreshState(); window.addEventListener("focus", focus); return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); }; }, [refreshState]);
  const run: Runner = async (snapshotId, operation, done) => { setError(""); try { const value = await operation(); if (snapshotId === null || activeSnapshot.current === snapshotId) done(value); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); void refreshState(); } };
  const acceptTask = (handle: IndexTaskHandle | null) => { if (!handle) return; indexRequestSequence.current += 1; activeTask.current = handle.taskId; setTask(handle); setTaskEvent({ protocolVersion: handle.protocolVersion, type: "progress", taskId: handle.taskId, rootPath: handle.rootPath, progress: { phase: "queued", completed: 0, total: 0 } }); setError(""); };
  const importLocal = () => void run(null, () => window.xray.selectLocalProject(), acceptTask); const importPath = (path: string) => void run(null, () => window.xray.importLocalProject(path), acceptTask); const importGit = () => void run(null, () => window.xray.importGitProject({ url: gitUrl }), (handle) => { acceptTask(handle); setGitUrl(""); });
  const updateIndex = () => project && importPath(project.rootPath); const cancel = () => task && void window.xray.cancelIndex(task.taskId); const retry = () => taskEvent && (taskEvent.type === "failed" || taskEvent.type === "cancelled") && void run(null, () => window.xray.retryIndex(taskEvent.taskId), acceptTask);
  const updatePageSourceView = (ownerPage: WorkspacePage, update: (current: WorkspaceSourceView) => WorkspaceSourceView): void => {
    if (!project) return;
    ownershipSessions.updateCurrentPageValue(refOf(project), ownerPage, "sourceView", update);
  };
  const preparePageSource = (request: SourceNavigationRequest, location: Evidence["span"] & { evidenceId?: string }): void => {
    const ownerPage = workspacePageFor(request.page);
    if (!ownerPage || !isSourceRequestCurrent(request)) return;
    updatePageSourceView(ownerPage, (current) => ({ ...current, open: true, loading: true, location, error: "", presentation: { ...current.presentation, sourceVisible: true, activePane: "source" }, editor: { selection: null, scrollTop: -1, scrollLeft: -1 } }));
  };
  const isSourceRequestCurrent = useCallback((request: SourceNavigationRequest): boolean => {
    const trainingSession = request.trainingSessionId ? ownershipSessions.getSession(request.trainingSessionId) : null;
    const workspaceRecord = request.workspacePage ? ownershipSessions.getPageRecord(request.ref, request.workspacePage) : null;
    return appMounted.current && sourceRequest.current === request.requestId && projectSession.current.identity === request.identity && projectSession.current.generation === request.generation && activePage.current === request.page && pageGeneration.current === request.pageGeneration && (!request.workspacePage || workspaceRecord?.generation === request.workspacePageGeneration) && (!request.trainingSessionId || Boolean(trainingSession && trainingSession.lifecycle !== "archived" && trainingSession.sourceView.open));
  }, [ownershipSessions]);
  const beginSourceRequest = useCallback((ownerPage: Page = page, trainingSessionId?: string): SourceNavigationRequest | null => {
    if (!project || !currentIdentity || !appMounted.current || projectSession.current.identity !== currentIdentity || projectSession.current.generation !== currentGeneration) return null;
    if (activePage.current !== ownerPage) return null;
    if (trainingSessionId) {
      const session = ownershipSessions.getSession(trainingSessionId);
      if (!session || session.lifecycle === "archived" || identityOf(session.ref) !== currentIdentity) return null;
    }
    const workspacePage = trainingSessionId ? undefined : workspacePageFor(ownerPage);
    const workspaceEntry = workspacePage ? ownershipSessions.ensurePageValue(refOf(project), workspacePage, "sourceView", emptyWorkspaceSourceView()) : null;
    const request = { requestId: ++sourceRequest.current, identity: currentIdentity, generation: currentGeneration, ref: refOf(project), page: ownerPage, pageGeneration: pageGeneration.current, ...(workspacePage && workspaceEntry ? { workspacePage, workspacePageGeneration: workspaceEntry.generation } : {}), ...(trainingSessionId ? { trainingSessionId } : {}) };
    setError("");
    if (trainingSessionId) setTrainingSource(null); else setSource(null);
    return request;
  }, [project, currentIdentity, currentGeneration, page, ownershipSessions]);
  const readSourceForRequest = useCallback((request: SourceNavigationRequest, location: Evidence["span"] & { evidenceId?: string }): void => {
    if (!isSourceRequestCurrent(request)) return;
    const requestedFilePath = location.filePath;
    void window.xray.readSource({ ...request.ref, ...location }).then((value) => {
      if (!isSourceRequestCurrent(request)) return;
      if (value.repositoryId !== request.ref.repositoryId || value.snapshotId !== request.ref.snapshotId || value.filePath !== requestedFilePath) {
        const reason = "源码响应与本次请求的仓库、快照或文件不一致，已阻止显示。";
        if (request.trainingSessionId) ownershipSessions.updateSession(request.trainingSessionId, (session) => ({ ...session, sourceView: { ...session.sourceView, loading: false, error: reason } })); else {
          const ownerPage = workspacePageFor(request.page);
          if (ownerPage) updatePageSourceView(ownerPage, (current) => ({ ...current, loading: false, error: reason }));
          setError(reason);
        }
        return;
      }
      if (request.trainingSessionId) {
        setTrainingSource(value);
        ownershipSessions.updateSession(request.trainingSessionId, (session) => ({ ...session, sourceView: { ...session.sourceView, loading: false, error: "" } }));
      } else {
        const ownerPage = workspacePageFor(request.page);
        if (ownerPage) updatePageSourceView(ownerPage, (current) => ({ ...current, loading: false, error: "" }));
        setSource(value);
      }
    }).catch((reason: unknown) => {
      if (!isSourceRequestCurrent(request)) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      if (request.trainingSessionId) ownershipSessions.updateSession(request.trainingSessionId, (session) => ({ ...session, sourceView: { ...session.sourceView, loading: false, error: message } })); else {
        const ownerPage = workspacePageFor(request.page);
        if (ownerPage) updatePageSourceView(ownerPage, (current) => ({ ...current, loading: false, error: message }));
        setError(message); void refreshState();
      }
    });
  }, [isSourceRequestCurrent, ownershipSessions, refreshState, project]);
  const openLocation = useCallback((location: Evidence["span"] & { evidenceId?: string }) => { const request = beginSourceRequest(); if (request) { preparePageSource(request, location); readSourceForRequest(request, location); } }, [beginSourceRequest, readSourceForRequest, project]);
  const openTrainingLocation = useCallback((sessionId: string, location: TrainingLocation) => {
    const request = beginSourceRequest("ownership", sessionId);
    if (!request) return;
    ownershipSessions.updateSession(sessionId, (session) => ({ ...session, sourceView: { ...session.sourceView, open: true, loading: true, location, error: "", selection: null, scrollTop: -1, scrollLeft: -1, activePane: "source" } }));
    readSourceForRequest(request, location);
  }, [beginSourceRequest, ownershipSessions, readSourceForRequest]);
  const restoreTrainingLocation = useCallback((sessionId: string) => {
    const session = ownershipSessions.getSession(sessionId);
    if (!session?.sourceView.location || session.lifecycle === "archived") return;
    const request = beginSourceRequest("ownership", sessionId);
    if (request) {
      ownershipSessions.updateSession(sessionId, (current) => ({ ...current, sourceView: { ...current.sourceView, open: true, loading: true, error: "" } }));
      readSourceForRequest(request, session.sourceView.location);
    }
  }, [beginSourceRequest, ownershipSessions, readSourceForRequest]);
  const closeTrainingSource = useCallback((sessionId: string) => {
    sourceRequest.current += 1; setTrainingSource(null);
    ownershipSessions.updateSession(sessionId, (session) => ({ ...session, sourceView: { ...session.sourceView, open: false, loading: false, maximized: false, navigationCollapsed: false, activePane: "navigation" } }));
  }, [ownershipSessions]);
  const openNode = useCallback((node: GraphNode) => { if (node.filePath && node.span) openLocation(node.span); }, [openLocation]);
  const openEdge = useCallback((edge: GraphEdge) => {
    const request = beginSourceRequest();
    if (!request) return;
    const evidenceId = edge.evidenceId;
    if (!evidenceId || edge.snapshotId !== request.ref.snapshotId) { setError("关系与当前快照不匹配或没有证据，已阻止源码导航。"); return; }
    void window.xray.getEvidence({ ...request.ref, evidenceId }).then((evidence) => {
      if (!isSourceRequestCurrent(request)) return;
      if (evidence.repositoryId !== request.ref.repositoryId || evidence.snapshotId !== request.ref.snapshotId || evidence.id !== evidenceId) { setError("证据与本次请求的仓库、快照或标识不一致，已阻止源码导航。"); return; }
      if (!isSourceRequestCurrent(request)) return;
      const location = { ...evidence.span, evidenceId: evidence.id };
      preparePageSource(request, location);
      readSourceForRequest(request, location);
    }).catch((reason: unknown) => {
      if (isSourceRequestCurrent(request)) setError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [beginSourceRequest, isSourceRequestCurrent, preparePageSource, readSourceForRequest]);
  const restorePageSource = useCallback(() => {
    const ownerPage = workspacePageFor(page);
    if (!project || !ownerPage || ownerPage === "diff") return;
    const saved = ownershipSessions.ensurePageValue(refOf(project), ownerPage, "sourceView", emptyWorkspaceSourceView()).value;
    if (!saved.open || !saved.location) return;
    if (source?.repositoryId === project.repositoryId && source.snapshotId === project.snapshotId && source.filePath === saved.location.filePath) return;
    const request = beginSourceRequest(page);
    if (!request) return;
    updatePageSourceView(ownerPage, (current) => ({ ...current, loading: true, error: "" }));
    readSourceForRequest(request, saved.location);
  }, [page, project, source, ownershipSessions, beginSourceRequest, readSourceForRequest]);
  useEffect(() => { restorePageSource(); }, [restorePageSource]);
  const ownershipSessionId = project ? ownershipSessions.sessionId(refOf(project)) : null;
  const pageSourceView = (ownerPage: WorkspacePage): WorkspaceSourceView => project ? ownershipSessions.ensurePageValue(refOf(project), ownerPage, "sourceView", emptyWorkspaceSourceView()).value : emptyWorkspaceSourceView();
  const updatePageSource = (ownerPage: WorkspacePage) => (update: (current: WorkspaceSourceView) => WorkspaceSourceView): void => updatePageSourceView(ownerPage, update);
  const closePageSource = (ownerPage: WorkspacePage): void => {
    sourceRequest.current += 1;
    setSource(null);
    updatePageSourceView(ownerPage, (current) => ({ ...current, open: false, loading: false, presentation: { sourceVisible: false, sourceMaximized: false, navigationCollapsed: false, activePane: "navigation" } }));
  };
  const openComparison = (repositoryId: string): void => { navigateTo("diff"); setComparisonFocusRepository(repositoryId); };
  const focusedJob = comparisonFocusRepository ? ownershipSessions.getComparisonJob(comparisonFocusRepository) : null;
  const diffProject = focusedJob?.project ?? project;
  const returnToCurrentProject = (): void => { setComparisonFocusRepository(null); if (page !== "diff") navigateTo("diff"); };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">X</div><div><strong>PROJECT X-RAY</strong><span>CODE OWNERSHIP SYSTEM</span></div></div>
      <div className="project-chip"><span className={`status-dot ${snapshotState?.status === "current" ? "ready" : snapshotState?.status ?? ""}`} /><div><b>{project?.name ?? "尚未导入项目"}</b><small>{project ? `${project.health.indexedFiles} files · ${shortId(project.snapshotId)}` : "LOCAL-FIRST ANALYSIS"}</small></div></div>
      <div className="nav-caption">工作空间</div><nav aria-label="主导航">{pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} aria-current={page === item.id ? "page" : undefined} title={item.label} onClick={() => navigateTo(item.id)} disabled={!project && item.id !== "overview"}><NavIcon page={item.id} />{item.label}</button>)}</nav>
      <div className="sidebar-foot"><span>静态证据模式</span><b>源码不会默认离开本机</b></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><span className="kicker">{pages.find((item) => item.id === page)?.eyebrow} / PROJECT X-RAY</span><h1>{pages.find((item) => item.id === page)?.label}</h1></div><div className="snapshot"><span>SNAPSHOT · {snapshotState?.status ?? "unchecked"}</span><code>{project ? shortId(project.snapshotId) : "—"}</code></div></header>
      {comparisonJobs.length > 0 && <section className="comparison-task-tray" aria-label="Git 比较后台任务" data-testid="comparison-task-tray">{comparisonJobs.map((job) => <div className={`comparison-task-row ${job.status}`} key={job.requestId} data-repository-id={job.repositoryId}><div><b>{job.projectName} · {job.request.mode === "working" ? "Index → 工作区" : job.request.mode === "staged" ? "HEAD → Index" : `父提交 ${job.request.parentNumber ?? "1"} → HEAD`}</b><span>{job.status === "starting" ? "正在启动" : job.status === "running" ? `正在比较${job.event?.type === "progress" && job.event.progress.currentFile ? ` · ${job.event.progress.currentFile}` : ""}` : job.status === "cancelling" ? "正在取消，等待后端终态" : job.status === "completed" ? "报告已生成" : job.status === "cancelled" ? "比较已取消" : `比较失败：${job.error || job.cancelError}`}</span>{job.cancelError && <small>取消请求失败：{job.cancelError}</small>}</div><button className="button secondary" onClick={() => openComparison(job.repositoryId)}>打开任务</button>{job.status === "starting" || job.status === "running" || job.status === "cancelling" ? <button className="button secondary" disabled={job.status === "cancelling"} onClick={() => ownershipSessions.requestComparisonCancel(job.repositoryId)}>{job.status === "cancelling" ? "正在取消…" : "取消比较"}</button> : <button className="button secondary" onClick={() => ownershipSessions.dismissComparisonJob(job.repositoryId)}>移除提示</button>}</div>)}</section>}
      {comparisonFocusRepository && diffProject?.repositoryId !== project?.repositoryId && <div className="stale-banner" role="status" data-testid="comparison-project-focus"><b>正在查看后台任务项目：{diffProject?.name}</b><span>当前工作项目仍为 {project?.name ?? "未导入"}；该比较报告只属于其捕获的仓库。</span><button className="button secondary" onClick={returnToCurrentProject}>返回当前项目</button></div>}
      {error && <div className="error-banner"><b>操作失败</b><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError("")}>×</button></div>}
      {snapshotState && snapshotState.status !== "current" && <div className="stale-banner" data-testid="stale-banner"><b>工作区已变化</b><span>新增 {snapshotState.addedFiles.length}、修改 {snapshotState.changedFiles.length}、删除/重命名 {snapshotState.removedFiles.length}。历史快照仍可查看；依赖当前源码的解释和答题已失效。</span><button className="button primary" onClick={updateIndex}>更新索引</button></div>}
      {taskEvent && (taskEvent.type === "progress" || taskEvent.type === "failed" || taskEvent.type === "cancelled") && <TaskStatus event={taskEvent} onCancel={cancel} onRetry={retry} />}
      <div className="page-body" data-page={page}>
        {page === "overview" && <Overview project={project} gitUrl={gitUrl} setGitUrl={setGitUrl} importLocal={importLocal} importPath={importPath} importGit={importGit} indexing={Boolean(task)} updateIndex={updateIndex} onNavigate={navigateTo} />}
        {page === "architecture" && project && <ArchitectureWorkspace project={project} onNode={openNode} onEdge={openEdge} source={source} sessions={ownershipSessions} sourceView={pageSourceView("architecture")} onSourceViewChange={updatePageSource("architecture")} onCloseSource={() => closePageSource("architecture")} />}
        {page === "flow" && project && <FlowExplorer project={project} onNode={openNode} onEdge={openEdge} source={source} sessions={ownershipSessions} sourceView={pageSourceView("flow")} onSourceViewChange={updatePageSource("flow")} onCloseSource={() => closePageSource("flow")} />}
        {page === "explain" && project && <FeatureExplanationWorkspace key={`${project.repositoryId}:${project.snapshotId}`} project={project} openLocation={openLocation} source={source} sessions={ownershipSessions} sourceView={pageSourceView("explain")} onSourceViewChange={updatePageSource("explain")} onCloseSource={() => closePageSource("explain")} />}
        {page === "diff" && diffProject && <ChangeExplorer key={`${diffProject.repositoryId}:${diffProject.snapshotId}`} project={diffProject} sessions={ownershipSessions} />}
        {page === "ownership" && project && ownershipSessionId && <OwnershipWorkspace key={ownershipSessionId} project={project} sessionId={ownershipSessionId} sessions={ownershipSessions} source={trainingSource} openLocation={(location) => openTrainingLocation(ownershipSessionId, location)} restoreSource={() => restoreTrainingLocation(ownershipSessionId)} closeSource={() => closeTrainingSource(ownershipSessionId)} />}
      </div>
    </main>
  </div>;
}

function TaskStatus({ event, onCancel, onRetry }: { event: IndexTaskEvent; onCancel: () => void; onRetry: () => void }): ReactElement { if (event.type === "progress") { const percent = event.progress.total > 0 ? Math.round(event.progress.completed / event.progress.total * 100) : 0; return <div className="task-status" data-testid="index-progress"><div><b>后台索引 · {event.progress.phase}</b><span>{event.progress.currentFile ?? "准备中"}</span></div><progress value={event.progress.completed} max={Math.max(1, event.progress.total)} /><code>{percent}%</code><button className="button secondary" onClick={onCancel}>取消</button></div>; } if (event.type === "completed") return <></>; return <div className={`task-status ${event.type}`}><div><b>{event.type === "failed" ? "索引失败" : "索引已取消"}</b><span>{event.message}</span></div><button className="button secondary" onClick={onRetry}>安全重试</button></div>; }

function Overview({ project, gitUrl, setGitUrl, importLocal, importPath, importGit, indexing, updateIndex, onNavigate }: { project: ProjectOverview | null; gitUrl: string; setGitUrl: (value: string) => void; importLocal: () => void; importPath: (path: string) => void; importGit: () => void; indexing: boolean; updateIndex: () => void; onNavigate: (page: Page) => void }): ReactElement { const [testPath, setTestPath] = useState(""); const e2e = new URLSearchParams(window.location.search).get("e2e") === "1"; if (!project) return <div className="welcome-grid"><section className="hero"><span className="kicker">理解，而不只是生成</span><h2>让每一条 AI 代码<br />重新变得<span>可解释、可追溯、可掌握。</span></h2><p>导入项目后，后台任务会在本机建立绑定快照的架构、调用和源码证据。</p><button className="button primary" onClick={importLocal} disabled={indexing}>选择本地项目</button>{e2e && <div className="test-import"><input aria-label="测试项目路径" value={testPath} onChange={(event) => setTestPath(event.target.value)} /><button className="button secondary" disabled={!testPath} onClick={() => importPath(testPath)}>导入测试项目</button></div>}</section><section className="import-card"><span className="kicker">或从 Git 导入</span><h3>克隆远程仓库</h3><p className="import-hint">从源码开始建立项目地图。索引在本机完成，无需配置模型。</p><input aria-label="Git 仓库地址" placeholder="https://github.com/team/repository" value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} /><button className="button secondary" onClick={importGit} disabled={indexing || !gitUrl.trim()}>克隆并分析</button></section></div>; return <div className="stack"><section className="overview-hero"><div><span className="kicker">不可变证据快照</span><h2>{project.name}</h2><p>{project.rootPath}</p></div><div><button className="button secondary" onClick={updateIndex} disabled={indexing}>更新索引</button> <button className="button secondary" onClick={importLocal} disabled={indexing}>导入其他项目</button></div></section><div className="stats"><Stat label="已索引" value={project.health.indexedFiles} /><Stat label="模块分组" value={project.counts.modules} /><Stat label="调用关系" value={project.counts.calls} /><Stat label="待确认关系" value={project.counts.unknown} tone={project.counts.unknown ? "warn" : ""} /></div><div className="journey-grid">{[{ page: "architecture" as const, title: "探索项目结构", description: "从模块到符号，用源码核验关系。", step: "01" }, { page: "explain" as const, title: "追踪一个功能", description: "检索入口与静态路径，辨别已知和未知。", step: "02" }, { page: "ownership" as const, title: "验证你的理解", description: "引用真实源码，检验结构与调用方向。", step: "03" }].map((item) => <button key={item.page} className="journey-card" onClick={() => onNavigate(item.page)}><span>{item.step} / WORKFLOW</span><h3>{item.title} <b>↗</b></h3><p>{item.description}</p></button>)}</div><section className="panel"><div className="panel-heading"><div><span className="kicker">索引健康</span><h3>证据覆盖与限制</h3></div><span className={`health ${project.health.status}`}>{({ ready: "可开始探索", partial: "部分索引", failed: "索引失败" } as Record<string, string>)[project.health.status] ?? project.health.status}</span></div><div className="language-grid">{Object.entries(project.health.languageCounts).map(([language, count]) => <div key={language}><span>{language}</span><b>{count}</b></div>)}</div><div className="coverage-summary"><span>跳过 {project.health.skippedFiles} 个文件</span><span>不支持 {project.health.unsupportedFiles} 个文件</span></div><p className="coverage-note">架构和关系来自静态源码分析，不代表实际运行时路径。未解析的动态行为会保留不确定性。</p><details className="coverage-details"><summary>查看忽略规则与分析限制</summary><h4>忽略规则</h4><div className="rule-tags">{project.health.ignoredByRule.map(rule => <code key={rule}>{rule}</code>)}</div><h4>分析限制</h4>{project.health.limitations.map((item) => <p className="limitation" key={item}>{item}</p>)}</details></section></div>; }
