import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { OWNERSHIP_QUESTION_VERSION, safeDiagnosticMessage, type GraphNode, type OwnershipProgress, type OwnershipPrompt, type ProjectOverview, type SnapshotRef, type SourceCitation, type SourceFileResult } from "@project-xray/contracts";
import { EvidenceWorkspace, type EvidenceWorkspacePresentation } from "./EvidenceWorkspace";
import { structuredAnswerFor, type OwnershipSessionController, type OwnershipTrainingSession, type TrainingLocation, type TrainingScope } from "../state/ownership-sessions";

const questionType = { entry: "定义定位", "call-direction": "调用方向", "call-path": "调用路径", "variable-flow": "变量读写" } as const;
const rangeText = (item: SourceCitation): string => `${item.filePath}:${item.startLine}:${item.startColumn}–${item.endLine}:${item.endColumn}`;
const MAX_VISIBLE_FILES = 200;
const emptyRoles = (): OwnershipTrainingSession["roles"] => ({});

type OwnershipWorkspaceProps = {
  project: ProjectOverview;
  sessionId: string;
  sessions: OwnershipSessionController;
  source: SourceFileResult | null;
  openLocation: (location: TrainingLocation) => void;
  restoreSource: () => void;
  closeSource: () => void;
};

export function OwnershipWorkspace(props: OwnershipWorkspaceProps): ReactElement {
  const { project, sessionId, sessions } = props;
  useSyncExternalStore(sessions.subscribe, sessions.getRevision, sessions.getRevision);
  const session = sessions.getSession(sessionId);
  if (!session || session.ref.repositoryId !== project.repositoryId || session.ref.snapshotId !== project.snapshotId) return <div className="empty-state">当前快照的训练会话不可用。</div>;
  return <OwnershipSessionPage {...props} session={session} />;
}

function OwnershipSessionPage({ project, sessionId, sessions, source, openLocation, restoreSource, closeSource, session }: OwnershipWorkspaceProps & { session: OwnershipTrainingSession }): ReactElement {
  const ref: SnapshotRef = session.ref;
  const current = session.finished ? undefined : session.round.questions[session.index];
  const blocked = session.lifecycle !== "active";
  const staleMessage = session.snapshotValidationReason === "unavailable" ? `${safeDiagnosticMessage("SNAPSHOT_VALIDATION_UNAVAILABLE")}；草稿保留供查看，校验恢复或重新索引后可以继续。`
    : session.snapshotValidationReason === "missing" ? "旧版快照缺少可校验源码；草稿保留供查看，重新索引后可以继续。"
      : "工作区已变化：草稿保留供查看，不能基于旧快照生成题目或提交评分。重新索引后会建立独立训练草稿。";
  const [files, setFiles] = useState<GraphNode[]>([]);
  const [fileCursor, setFileCursor] = useState<string>();
  const [fileResultsLimited, setFileResultsLimited] = useState(false);
  const initialFileFetchStarted = useRef(false);
  const mounted = useRef(false);
  const [selectedArchive, setSelectedArchive] = useState<string | null>(null);
  const restoreAttempt = useRef<string | null>(null);

  const update = (recipe: (value: OwnershipTrainingSession) => OwnershipTrainingSession): void => sessions.updateSession(sessionId, recipe);
  const searchScopes = (query = session.scopeQuery, kind = session.scopeKind): void => {
    const captured = Object.freeze({ ...ref, query, scopeKind: kind });
    void sessions.run(sessionId, "scope", captured, () => window.xray.search({ ...ref, query, kinds: kind === "module" ? ["module"] : ["function", "method", "class"], limit: 50 }), (value) => {
      if (value.repositoryId === ref.repositoryId && value.snapshotId === ref.snapshotId) update((prior) => ({ ...prior, scopeOptions: value.items.slice(0, 50) }));
    });
  };
  const findFiles = (cursor?: string): void => {
    const captured = Object.freeze({ ...ref, query: session.fileQuery, cursor });
    void sessions.run(sessionId, "files", captured, () => window.xray.search({ ...ref, query: session.fileQuery, kinds: ["file"], limit: 50, ...(cursor ? { cursor } : {}) }), (value) => {
      if (value.repositoryId !== ref.repositoryId || value.snapshotId !== ref.snapshotId || !mounted.current) return;
      const merged = cursor ? [...files, ...value.items] : value.items;
      setFiles(merged.slice(0, MAX_VISIBLE_FILES));
      setFileResultsLimited(merged.length > MAX_VISIBLE_FILES || Boolean(value.nextCursor && merged.length >= MAX_VISIBLE_FILES));
      setFileCursor(value.nextCursor && merged.length < MAX_VISIBLE_FILES ? value.nextCursor : undefined);
    });
  };
  const refreshProgress = (): void => {
    void sessions.run(sessionId, "progress", Object.freeze({ ...ref }), () => window.xray.getOwnershipProgress(ref), (value) => {
      if (value.repositoryId === ref.repositoryId && value.snapshotId === ref.snapshotId) update((prior) => ({ ...prior, progress: value }));
    });
  };

  useEffect(() => {
    mounted.current = true;
    refreshProgress();
    return () => { mounted.current = false; /* 页面卸载只移除视图订阅；控制器继续完成有效训练操作。 */ };
  }, [sessionId]);
  useEffect(() => {
    if (!initialFileFetchStarted.current && !session.pending.files) { initialFileFetchStarted.current = true; findFiles(); }
  }, [session.pending.files, session.fileQuery]);
  useEffect(() => {
    const view = session.sourceView;
    if (!view.open || !view.location || view.loading || !source) {
      if (view.open && view.location && !view.loading && !source) {
        const key = `${view.location.filePath}:${view.location.startLine}:${view.location.startColumn}:${view.location.evidenceId ?? ""}`;
        if (restoreAttempt.current !== key) { restoreAttempt.current = key; restoreSource(); }
      }
      return;
    }
    if (source.repositoryId !== ref.repositoryId || source.snapshotId !== ref.snapshotId || source.filePath !== view.location.filePath) {
      const key = `${view.location.filePath}:${view.location.startLine}:${view.location.startColumn}:${view.location.evidenceId ?? ""}`;
      if (restoreAttempt.current !== key) { restoreAttempt.current = key; restoreSource(); }
    }
  }, [session.sourceView, source, ref.repositoryId, ref.snapshotId, restoreSource]);

  const resetAnswer = (): void => update((prior) => ({ ...prior, answer: "", citations: [], grade: null, caller: "", callee: "", path: [], entry: "", roles: emptyRoles() }));
  const generate = (conceptId?: string): void => {
    const requestedRef: SnapshotRef = Object.freeze({ repositoryId: ref.repositoryId, snapshotId: ref.snapshotId });
    const requestedKind = session.scopeKind;
    const requestedNode = session.scopeNode;
    if (blocked || (requestedKind !== "project" && !requestedNode)) return;
    const requestedScope: TrainingScope = Object.freeze({
      ...requestedRef,
      kind: requestedKind,
      ...(requestedKind !== "project" && requestedNode ? { nodeId: requestedNode.id } : {}),
      displayName: requestedKind === "project" ? "整个项目" : requestedNode?.qualifiedName || requestedNode?.name || "已选范围",
    });
    const questionScope = { kind: requestedScope.kind, ...(requestedScope.nodeId ? { nodeId: requestedScope.nodeId } : {}) };
    const request = Object.freeze({ ...requestedRef, count: 5, scope: questionScope, ...(conceptId ? { conceptId } : {}) });
    void sessions.run(sessionId, "questions", request, () => window.xray.createOwnershipQuestions(request), (items) => {
      const matching = items.filter((item) => item.repositoryId === requestedRef.repositoryId && item.snapshotId === requestedRef.snapshotId);
      update((prior) => ({
        ...prior,
        round: { questions: matching, scope: matching.length ? requestedScope : null },
        index: 0, finished: false, answer: "", citations: [], grade: null, caller: "", callee: "", path: [], entry: "", roles: emptyRoles(),
        ...(matching.length ? {} : { message: "当前范围没有足够的 verified 事实，未生成牵强题目。" }),
      }));
    });
  };

  const structured = useMemo(() => structuredAnswerFor(session), [session]);
  const submitReason = session.lifecycle === "stale" ? staleMessage
    : session.lifecycle === "archived" ? "此旧快照训练草稿为只读，不能继续提交。"
      : !session.citations.length ? "至少添加一条源码引用后才能提交；变量流题还需为每条引用标记角色。"
        : !structured ? "先完成上方的结构化答案。" : null;
  const submit = (): void => {
    if (!current || !structured || blocked || session.pending.grade || session.grade) return;
    const submission = Object.freeze({ ...ref, questionId: current.id, questionVersion: OWNERSHIP_QUESTION_VERSION, answer: session.answer, citations: session.citations.map((item) => Object.freeze({ ...item })), selfConfidence: .7, structuredAnswer: structured });
    void sessions.run(sessionId, "grade", submission, () => window.xray.gradeOwnershipAnswer(submission), (value) => {
      if (value.repositoryId !== ref.repositoryId || value.snapshotId !== ref.snapshotId || value.questionId !== current.id) throw new Error("评分响应与当前题目或训练快照不一致，已阻止显示。");
      update((prior) => ({ ...prior, grade: value }));
      void sessions.run(sessionId, "progress", Object.freeze({ ...ref }), () => window.xray.getOwnershipProgress(ref), (progress) => update((prior) => ({ ...prior, progress })));
    });
  };
  const next = (): void => {
    if (session.index + 1 >= session.round.questions.length) update((prior) => ({ ...prior, finished: true }));
    else update((prior) => ({ ...prior, index: prior.index + 1, answer: "", citations: [], grade: null, caller: "", callee: "", path: [], entry: "", roles: emptyRoles(), message: "", failureChannel: null }));
  };
  const reveal = (id: string): void => {
    if (!session.grade) return;
    void sessions.run(sessionId, "evidence", Object.freeze({ ...ref, evidenceId: id }), () => window.xray.getEvidence({ ...ref, evidenceId: id }), (item) => {
      if (item.repositoryId === ref.repositoryId && item.snapshotId === ref.snapshotId && item.id === id) openLocation({ ...item.span, evidenceId: item.id });
      else update((prior) => ({ ...prior, message: "证据与当前训练快照不一致，已阻止源码导航。", failureChannel: "evidence" }));
    });
  };
  const removeCitation = (removedIndex: number): void => update((prior) => ({
    ...prior,
    citations: prior.citations.filter((_, itemIndex) => itemIndex !== removedIndex),
    roles: Object.fromEntries(Object.entries(prior.roles).flatMap(([rawIndex, role]) => {
      const itemIndex = Number(rawIndex); if (itemIndex === removedIndex) return [];
      return [[itemIndex > removedIndex ? itemIndex - 1 : itemIndex, role]];
    })),
  }));
  const addCitations = (items: SourceCitation[]): void => {
    if (session.grade || session.pending.grade || session.lifecycle === "archived") return;
    update((prior) => ({ ...prior, citations: [...new Map([...prior.citations, ...items].map((item) => [`${item.filePath}:${item.startLine}:${item.startColumn}:${item.endLine}:${item.endColumn}:${item.evidenceId}`, item])).values()] }));
  };
  const setRoles = (change: (prior: OwnershipTrainingSession["roles"]) => OwnershipTrainingSession["roles"]): void => update((prior) => ({ ...prior, roles: change(prior.roles) }));
  const setPresentation = (presentation: EvidenceWorkspacePresentation): void => update((prior) => ({ ...prior, sourceView: { ...prior.sourceView, open: presentation.sourceVisible, maximized: presentation.sourceMaximized, navigationCollapsed: presentation.navigationCollapsed, activePane: presentation.activePane } }));
  const closePanel = (): void => { update((prior) => ({ ...prior, sourceView: { ...prior.sourceView, open: false, loading: false, maximized: false, navigationCollapsed: false, activePane: "navigation" } })); closeSource(); };
  const scopeLabel = session.scopeKind === "project" ? "整个项目" : session.scopeNode?.qualifiedName ?? session.scopeNode?.name ?? "尚未选择";

  const training = !current ? <div className="ownership-start compact" aria-busy={session.pending.questions}>
    <span className="kicker">本地证据训练 · 快照 {ref.snapshotId.slice(0, 12)}</span>
    <h2>{session.finished ? "本轮已经完成" : "选择学习范围"}</h2>
    <ol className="training-steps" aria-label="训练步骤"><li aria-current="step">1. 选择范围</li><li>2. 回答并引用源码</li><li>3. 提交后核验与复习</li></ol>
    <p>题目只来自当前快照中已验证的源码事实。证据和补救反馈会在提交后显示；自由文本仅作本地学习记录，不参与语义评分。</p>
    {session.lifecycle === "stale" && <div className="ownership-message error" role="alert" data-testid="training-stale">{staleMessage}</div>}
    <div className="scope-picker">
      <label>学习范围<select aria-label="训练范围" disabled={session.pending.questions || blocked} value={session.scopeKind} onChange={(event) => { const kind = event.target.value as typeof session.scopeKind; sessions.invalidateChannel(sessionId, "scope"); update((prior) => ({ ...prior, scopeKind: kind, scopeNode: null, scopeOptions: [] })); }}><option value="project">当前项目</option><option value="module">指定目录模块</option><option value="symbol">指定符号附近</option></select></label>
      {session.scopeKind !== "project" && <><label>搜索范围<input aria-label="搜索训练范围" disabled={session.pending.questions || blocked} value={session.scopeQuery} onChange={(event) => { sessions.invalidateChannel(sessionId, "scope"); update((prior) => ({ ...prior, scopeQuery: event.target.value, scopeNode: null, scopeOptions: [] })); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); searchScopes(); } }} /></label><button className="button secondary" disabled={blocked || session.pending.questions || !session.scopeQuery.trim() || session.pending.scope} onClick={() => searchScopes()}>{session.pending.scope ? "搜索中…" : session.failureChannel === "scope" ? "重试搜索" : "搜索"}</button><div className="scope-results" aria-label="可选范围">{session.scopeOptions.map((node) => <button disabled={session.pending.questions || blocked} className={session.scopeNode?.id === node.id ? "active" : ""} key={node.id} aria-pressed={session.scopeNode?.id === node.id} onClick={() => update((prior) => ({ ...prior, scopeNode: { id: node.id, name: node.name, ...(node.qualifiedName ? { qualifiedName: node.qualifiedName } : {}) } }))}>{node.name}<small>{node.qualifiedName}</small></button>)}{!session.pending.scope && session.scopeOptions.length === 0 && session.scopeQuery && <p className="empty-inline">没有匹配范围。</p>}</div></>}
    </div>
    {session.scopeNode && <p className="selected-scope">当前范围：{scopeLabel}</p>}
    <button className="button primary" disabled={blocked || session.pending.questions || (session.scopeKind !== "project" && !session.scopeNode)} onClick={() => generate()}>{session.pending.questions ? "正在生成题目…" : session.failureChannel === "questions" ? "重试生成题目" : session.finished ? "开始新一轮" : "生成结构化题目"}</button>
    {session.pending.questions && <p className="ownership-message" role="status">正在读取当前快照的已验证事实。</p>}
    {session.message && <p className={session.failureChannel ? "ownership-message error" : "ownership-message"} role={session.failureChannel ? "alert" : "status"}>{session.message}</p>}
    <Progress progress={session.progress} review={generate} pending={session.pending.questions || blocked} />
  </div> : <div className="quiz ownership-quiz" aria-busy={session.pending.grade}>
    <div className="quiz-progress"><span>问题 {session.index + 1}/{session.round.questions.length}</span><b>{questionType[current.kind]}</b></div>
    <ol className="training-steps quiz-steps" aria-label="训练步骤"><li>1. 范围：{session.round.scope?.displayName ?? "范围身份未确认"}</li><li aria-current="step">2. 结构答案与源码引用</li><li>3. 提交后核验</li></ol>
    {session.lifecycle === "stale" && <div className="ownership-message error" role="alert" data-testid="training-stale">{staleMessage}</div>}
    <span className="difficulty">{current.difficulty} · {current.concept.label}</span><h2>{current.prompt}</h2><p>{current.learningObjective}</p>
    {current.retryOfQuestionId && <div className="retry-note">当前没有新变式，这是同一证据实例的明确重试。</div>}
    <StructuredControls current={current} session={session} setCaller={(value) => update((prior) => ({ ...prior, caller: value }))} setCallee={(value) => update((prior) => ({ ...prior, callee: value }))} setPath={(value) => update((prior) => ({ ...prior, path: value }))} setEntry={(value) => update((prior) => ({ ...prior, entry: value }))} setRoles={setRoles} disabled={session.pending.grade || Boolean(session.grade) || session.lifecycle === "archived"} />
    <section className="citations" aria-label="已添加源码引用">
      <div className="citation-heading"><b>源码引用 {session.citations.length}</b><small>{session.citations.length ? "路径、行列与变量角色按同一索引对应" : "至少添加一条源码范围后才能提交"}</small></div>
      {session.citations.map((item, itemIndex) => <div className="citation-row" key={`${item.filePath}:${item.startLine}:${item.startColumn}:${item.endLine}:${item.endColumn}:${item.evidenceId ?? ""}`}>
        <span>{itemIndex + 1}. {rangeText(item)}{item.evidenceId ? ` · ${item.evidenceId}` : ""}</span>
        <div><button className="button secondary" type="button" disabled={session.pending.grade || session.lifecycle === "archived"} onClick={() => openLocation({ filePath: item.filePath, startLine: item.startLine, startColumn: item.startColumn, endLine: item.endLine, endColumn: item.endColumn, ...(item.evidenceId ? { evidenceId: item.evidenceId } : {}) })}>重新定位</button><button className="button secondary" type="button" aria-label={`移除引用 ${itemIndex + 1}`} disabled={session.pending.grade || Boolean(session.grade) || session.lifecycle === "archived"} onClick={() => removeCitation(itemIndex)}>移除</button></div>
      </div>)}
    </section>
    <button className="button primary" disabled={blocked || !structured || !session.citations.length || session.pending.grade || Boolean(session.grade)} onClick={submit}>{session.pending.grade ? "正在核验…" : session.failureChannel === "grade" ? "重试提交" : "提交并核验结构"}</button>
    {!session.pending.grade && !session.grade && submitReason && <p className="submission-hint" role="status" data-testid="submission-hint">{submitReason}</p>}
    {session.pending.grade && <p className="ownership-message" role="status">正在验证引用范围与结构答案；期间答案和引用已锁定。</p>}
    {session.message && <p className="ownership-message error" role={session.failureChannel ? "alert" : "status"}>{session.message}</p>}
    {session.grade && <div className="grade structured-grade" aria-live="polite">
      <div><b>定位表现</b><strong>{session.grade.location.status === "passed" ? "通过" : "需复习"}</strong><small>{session.grade.location.score}</small></div>
      <div><b>结构理解</b><strong>{session.grade.structure.status === "passed" ? "通过" : "需复习"}</strong><small>{session.grade.structure.score}</small></div>
      <div><b>自由文本语义</b><strong>未评估</strong><small>不按关键词评分</small></div>
      <section><b>反馈</b>{session.grade.feedback.map((item) => <p key={item}>{item}</p>)}</section>
      <div className="revealed"><b>提交后可核验证据</b>{session.grade.revealedEvidenceIds.map((id) => <button key={id} disabled={session.pending.evidence || blocked} onClick={() => reveal(id)}>{session.pending.evidence ? "读取中…" : id}</button>)}</div>
      {session.grade.passed ? <button className="button secondary" disabled={blocked} onClick={next}>{session.index + 1 >= session.round.questions.length ? "完成本轮" : "下一题"}</button> : <button className="button secondary" disabled={blocked} onClick={() => update((prior) => ({ ...prior, grade: null, message: "" }))}>修正后重试</button>}
    </div>}
    <details className="ownership-notes">
      <summary><span>学习笔记（不参与评分）</span><small>{session.answer.trim() ? "已填写 · 内容已保留" : "可选 · 点击记录个人理解"}</small></summary>
      <div><label className="answer-label" htmlFor="ownership-note">自由文本学习记录</label><textarea id="ownership-note" aria-label="自由文本学习记录" placeholder="可选：记录你的解释；本轮不会对语义打分。" value={session.answer} disabled={session.pending.grade || session.lifecycle !== "active"} onChange={(event) => update((prior) => ({ ...prior, answer: event.target.value }))} /></div>
    </details>
  </div>;

  const navigation = <div className="ownership-navigation"><section className="panel">{training}</section><aside className="ownership-files" aria-label="训练源码文件">
    <div className="architecture-search"><label htmlFor="ownership-file-query">源码文件</label><input id="ownership-file-query" aria-label="搜索答题文件" placeholder="搜索源码文件" value={session.fileQuery} onChange={(event) => { sessions.invalidateChannel(sessionId, "files"); setFiles([]); setFileCursor(undefined); setFileResultsLimited(false); update((prior) => ({ ...prior, fileQuery: event.target.value })); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); findFiles(); } }} /><button className="button secondary" disabled={session.pending.files} onClick={() => findFiles()}>{session.pending.files ? "搜索中…" : session.failureChannel === "files" ? "重试搜索" : "搜索"}</button></div>
    {files.map((file) => <button key={file.id} title={file.filePath} onClick={() => file.span && openLocation(file.span)}>{file.filePath}</button>)}
    {fileResultsLimited && <p className="empty-inline">已显示前 {MAX_VISIBLE_FILES} 个文件；请缩小搜索范围以继续定位。</p>}
    {!session.pending.files && files.length === 0 && <p className="empty-inline">没有可浏览的源码文件。</p>}
    {fileCursor && <button className="button secondary" disabled={session.pending.files} onClick={() => findFiles(fileCursor)}>{session.pending.files ? "加载中…" : "加载更多文件"}</button>}
  </aside></div>;
  const presentation: EvidenceWorkspacePresentation = { sourceVisible: session.sourceView.open && Boolean(source), sourceMaximized: session.sourceView.maximized, navigationCollapsed: session.sourceView.navigationCollapsed, activePane: session.sourceView.activePane };
  return <div className="ownership-workspace-stack">
    {!session.sourceView.open && session.sourceView.location && <button className="button secondary ownership-reopen-source" title={`${session.sourceView.location.filePath}:${session.sourceView.location.startLine}:${session.sourceView.location.startColumn}`} onClick={restoreSource}>重新打开上次训练源码 · {session.sourceView.location.filePath}:{session.sourceView.location.startLine}</button>}
    <EvidenceWorkspace project={ref} source={session.sourceView.open ? source : null} navigation={navigation} navigationLabel="所有权训练" onCite={addCitations} navigationKey={session.id} presentation={presentation} onPresentationChange={setPresentation} editorState={session.sourceView} onEditorStateChange={(editorState) => update((prior) => ({ ...prior, sourceView: { ...prior.sourceView, ...editorState } }))} onCloseSource={closePanel} />
    {session.sourceView.error && <p className="ownership-message error" role="alert">源码读取失败：{session.sourceView.error}<button className="button secondary" onClick={restoreSource}>重试定位</button></p>}
    {session.sourceView.loading && <p className="ownership-message" role="status">正在恢复当前快照源码位置…</p>}
    <ArchivedTrainingDrafts sessions={sessions} repositoryId={project.repositoryId} />
  </div>;
}

function StructuredControls({ current, session, setCaller, setCallee, setPath, setEntry, setRoles, disabled }: {
  current: OwnershipPrompt; session: OwnershipTrainingSession; setCaller: (value: string) => void; setCallee: (value: string) => void; setPath: (value: string[]) => void; setEntry: (value: string) => void; setRoles: (change: (prior: OwnershipTrainingSession["roles"]) => OwnershipTrainingSession["roles"]) => void; disabled: boolean;
}): ReactElement {
  const options = current.choices;
  if (current.kind === "call-direction") return <div className="structured-answer"><label>调用者<select disabled={disabled} aria-label="选择调用者" value={session.caller} onChange={(event) => setCaller(event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.nodeId} value={option.nodeId}>{option.label} · {option.detail}</option>)}</select></label><label>被调用者<select disabled={disabled} aria-label="选择被调用者" value={session.callee} onChange={(event) => setCallee(event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.nodeId} value={option.nodeId}>{option.label} · {option.detail}</option>)}</select></label></div>;
  if (current.kind === "call-path") return <div className="structured-answer"><b>有序步骤</b><div className="path-answer">{session.path.map((id, itemIndex) => <button disabled={disabled} key={`${id}:${itemIndex}`} onClick={() => setPath(session.path.filter((_, index) => index !== itemIndex))}>{itemIndex + 1}. {options.find((option) => option.nodeId === id)?.label} ×</button>)}</div><select disabled={disabled} aria-label="添加路径步骤" value="" onChange={(event) => event.target.value && setPath([...session.path, event.target.value])}><option value="">添加下一步</option>{options.map((option) => <option key={option.nodeId} value={option.nodeId}>{option.label} · {option.detail}</option>)}</select></div>;
  if (current.kind === "variable-flow") return <div className="structured-answer"><b>为每条引用标记角色</b>{session.citations.map((item, itemIndex) => <label key={`${itemIndex}:${item.filePath}:${item.startLine}:${item.startColumn}`}>{itemIndex + 1}. {rangeText(item)}<select disabled={disabled} aria-label={`引用 ${itemIndex + 1} 的角色`} value={session.roles[itemIndex] ?? ""} onChange={(event) => setRoles((prior) => ({ ...prior, [itemIndex]: event.target.value as "write" | "read" | "return" }))}><option value="">选择角色</option><option value="write">写入</option><option value="read">读取</option><option value="return">返回</option></select></label>)}</div>;
  return <div className="structured-answer"><label>定义符号<select disabled={disabled} aria-label="选择定义符号" value={session.entry} onChange={(event) => setEntry(event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.nodeId} value={option.nodeId}>{option.label} · {option.detail}</option>)}</select></label></div>;
}

function Progress({ progress, review, pending }: { progress: OwnershipProgress | null; review: (conceptId?: string) => void; pending: boolean }): ReactElement | null {
  if (!progress) return null;
  const weak = progress.concepts.filter((item) => item.status === "review" || item.status === "needs-revalidation");
  const labels = { unpracticed: "尚未练习", passed: "本快照已通过", review: "需要复习", "needs-revalidation": "需要重新验证" } as const;
  return <section className="mastery-panel"><h3>概念记录</h3><p>训练数据仅保存在本项目的本地数据库。当前快照 {progress.snapshotId.slice(0, 12)}</p>{progress.concepts.map((item) => <div key={item.concept.id}><span>{item.concept.label}</span><b>{labels[item.status]}</b></div>)}{weak[0] && <button className="button secondary" disabled={pending} onClick={() => review(weak[0]?.concept.id)}>{pending ? "正在准备…" : weak[0].status === "needs-revalidation" ? "再次验证" : "复习薄弱概念"}</button>}</section>;
}

function ArchivedTrainingDrafts({ sessions, repositoryId }: { sessions: OwnershipSessionController; repositoryId: string }): ReactElement | null {
  useSyncExternalStore(sessions.subscribe, sessions.getRevision, sessions.getRevision);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drafts = sessions.listArchived(repositoryId);
  const selected = selectedId ? sessions.getSession(selectedId) : null;
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);
  if (!drafts.length) return null;
  return <section className="panel ownership-archive" aria-label="旧快照训练草稿"><h3>旧快照训练草稿 · 只读</h3><p>新快照不会继承旧题目、引用或评分。草稿只保留在本次应用运行中；可逐项查看或丢弃。</p>
    <div className="archive-list">{drafts.map((draft) => <div key={draft.id}><button className="button secondary" aria-expanded={selectedId === draft.id} onClick={() => setSelectedId((prior) => prior === draft.id ? null : draft.id)}>查看快照 {draft.ref.snapshotId.slice(0, 12)} · {draft.round.questions.length} 题</button><button className="button secondary" aria-label={`丢弃旧草稿 ${draft.ref.snapshotId.slice(0, 12)}`} onClick={() => { sessions.discard(draft.id); if (selectedId === draft.id) setSelectedId(null); }}>丢弃草稿</button></div>)}</div>
    {selected && <ArchivedDraftPreview session={selected} onClose={() => setSelectedId(null)} />}
  </section>;
}

function ArchivedDraftPreview({ session, onClose }: { session: OwnershipTrainingSession; onClose: () => void }): ReactElement {
  const prompt = session.round.questions[session.index] ?? session.round.questions.at(-1);
  const answer = structuredAnswerFor({ ...session, index: prompt ? session.round.questions.indexOf(prompt) : session.index });
  return <div className="archive-preview" data-testid="archived-training-preview"><div><b>快照 {session.ref.snapshotId.slice(0, 12)} · {session.round.scope?.displayName ?? "范围未生成"}</b><button className="button secondary" onClick={onClose}>关闭预览</button></div>
    <p>进度：{session.finished ? "本轮已完成" : `问题 ${session.index + 1}/${session.round.questions.length || 0}`}</p>
    {prompt && <><h4>{prompt.prompt}</h4><p>{prompt.learningObjective}</p></>}
    <b>结构答案（只读）</b><pre>{answer ? JSON.stringify(answer, null, 2) : "尚未填写"}</pre>
    <b>学习笔记</b><p>{session.answer || "尚无学习笔记"}</p>
    <b>源码引用</b>{session.citations.length ? <ul>{session.citations.map((item, index) => <li key={`${item.filePath}:${item.startLine}:${item.startColumn}:${index}`}>{rangeText(item)}{session.roles[index] ? ` · ${session.roles[index]}` : ""}</li>)}</ul> : <p>尚无引用</p>}
    {session.grade && <div><b>已提交评分</b><p>定位 {session.grade.location.score} · 结构 {session.grade.structure.score} · 自由文本语义未评估</p>{session.grade.feedback.map((item) => <p key={item}>{item}</p>)}</div>}
    {session.sourceView.location && <p>最后源码位置：{session.sourceView.location.filePath}:{session.sourceView.location.startLine}:{session.sourceView.location.startColumn}{session.sourceView.open ? " · 面板打开" : " · 面板已关闭"}</p>}
  </div>;
}
