import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import type { Evidence, FeatureExplanation, ProjectOverview, SourceFileResult } from "@project-xray/contracts";
import { EvidenceWorkspace } from "./EvidenceWorkspace";
import { useWorkspacePageState, type OwnershipSessionController, type WorkspaceSourceView } from "../state/ownership-sessions";

type Props = {
  project: ProjectOverview;
  source: SourceFileResult | null;
  sessions: OwnershipSessionController;
  sourceView: WorkspaceSourceView;
  onSourceViewChange: (update: (current: WorkspaceSourceView) => WorkspaceSourceView) => void;
  onCloseSource: () => void;
  openLocation: (location: Evidence["span"] & { evidenceId?: string }) => void;
};
type ResultState = "idle" | "loading" | "ready" | "empty" | "error";
const confidenceText = { verified: "已验证", inferred: "推断", unknown: "未知" } as const;

export function FeatureExplanationWorkspace({ project, source, openLocation, sessions, sourceView, onSourceViewChange, onCloseSource }: Props): ReactElement {
  const ref = { repositoryId: project.repositoryId, snapshotId: project.snapshotId };
  const identity = `${ref.repositoryId}:${ref.snapshotId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requestSequence = useRef(0);
  const navigationSequence = useRef(0);
  const explanationPanel = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useWorkspacePageState(sessions, ref, "explain", "query", "");
  const [submittedQuery, setSubmittedQuery] = useWorkspacePageState(sessions, ref, "explain", "submittedQuery", "");
  const [failedQuery, setFailedQuery] = useWorkspacePageState(sessions, ref, "explain", "failedQuery", "");
  const [result, setResult] = useWorkspacePageState<FeatureExplanation | null>(sessions, ref, "explain", "result", null);
  const [resultQuery, setResultQuery] = useWorkspacePageState(sessions, ref, "explain", "resultQuery", "");
  const [state, setState] = useWorkspacePageState<ResultState>(sessions, ref, "explain", "state", "idle");
  const [error, setError] = useWorkspacePageState(sessions, ref, "explain", "error", "");
  const [navigationError, setNavigationError] = useWorkspacePageState(sessions, ref, "explain", "navigationError", "");
  const [openingEvidence, setOpeningEvidence] = useWorkspacePageState(sessions, ref, "explain", "openingEvidence", "");
  const [selectedEvidenceId, setSelectedEvidenceId] = useWorkspacePageState<string | null>(sessions, ref, "explain", "selectedEvidenceId", null);
  const [selectedStepOrder, setSelectedStepOrder] = useWorkspacePageState<number | null>(sessions, ref, "explain", "selectedStepOrder", null);
  const [navigationErrorEvidenceId, setNavigationErrorEvidenceId] = useWorkspacePageState<string | null>(sessions, ref, "explain", "navigationErrorEvidenceId", null);
  const [readingScroll, setReadingScroll] = useWorkspacePageState(sessions, ref, "explain", "readingScroll", 0);
  const lifecycle = sessions.getPageRecord(ref, "explain")?.lifecycle ?? "active";


  // Explanation generation survives navigation; only pending source navigation is page-bound.
  useEffect(() => () => { navigationSequence.current += 1; }, []);
  useEffect(() => { if (explanationPanel.current) explanationPanel.current.scrollTop = readingScroll; }, [identity]);

  const execute = async (rawQuery: string): Promise<void> => {
    const requested = rawQuery.trim();
    if (!requested || state === "loading" || lifecycle !== "active") return;
    const requestId = ++requestSequence.current;
    const requestIdentity = identity;
    navigationSequence.current += 1;
    setSubmittedQuery(requested); setFailedQuery(""); setError(""); setNavigationError(""); setOpeningEvidence(""); setState("loading");
    sessions.runWorkspaceRequest(ref, "explain", "generation", requested, () => window.xray.explainFeature(ref, requested), (next) => {
      if (requestId !== requestSequence.current || identityRef.current !== requestIdentity) return;
      if (next.repositoryId !== ref.repositoryId || next.snapshotId !== ref.snapshotId) throw new Error("解释结果与当前项目快照不匹配，已丢弃该结果。请重新追踪。");
      setResult(next); setResultQuery(requested); setState(next.steps.length ? "ready" : "empty");
      setSelectedEvidenceId(null); setSelectedStepOrder(null); setNavigationErrorEvidenceId(null);
      setError("");
    }, (reason) => {
      if (requestId !== requestSequence.current || identityRef.current !== requestIdentity) return;
      setFailedQuery(requested); setError(reason instanceof Error ? reason.message : String(reason)); setState("error");
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); void execute(query); };
  const guardCompositionEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
  };
  const openEvidence = async (evidenceId: string, stepOrder: number): Promise<void> => {
    if (!result?.steps.some((step) => step.order === stepOrder && step.evidenceIds.includes(evidenceId))) return;
    const requestId = ++navigationSequence.current;
    const requestIdentity = identity;
    setSelectedEvidenceId(evidenceId);
    setSelectedStepOrder(stepOrder);
    setNavigationErrorEvidenceId(null);
    setOpeningEvidence(evidenceId); setNavigationError("");
    try {
      const evidence = await window.xray.getEvidence({ ...ref, evidenceId });
      if (requestId !== navigationSequence.current || identityRef.current !== requestIdentity) return;
      if (evidence.repositoryId !== ref.repositoryId || evidence.snapshotId !== ref.snapshotId || evidence.id !== evidenceId) throw new Error("证据属于其他项目、快照或请求位置，已阻止源码导航。");
      openLocation({ ...evidence.span, evidenceId: evidence.id });
    } catch (reason) {
      if (requestId === navigationSequence.current && identityRef.current === requestIdentity) { setNavigationError(reason instanceof Error ? reason.message : String(reason)); setNavigationErrorEvidenceId(evidenceId); }
    } finally {
      if (requestId === navigationSequence.current && identityRef.current === requestIdentity) setOpeningEvidence("");
    }
  };

  const returnToStep = (stepOrder: number): void => {
    setSelectedStepOrder(stepOrder);
    setReturnStepOrder(stepOrder);
    onSourceViewChange((current) => ({ ...current, presentation: { ...current.presentation, activePane: "navigation" } }));
  };
  const [returnStepOrder, setReturnStepOrder] = useWorkspacePageState<number | null>(sessions, ref, "explain", "returnStepOrder", null);
  useEffect(() => {
    if (returnStepOrder === null || sourceView.presentation.activePane !== "navigation") return;
    const panel = explanationPanel.current;
    const step = panel?.querySelector<HTMLElement>(`[data-step-order="${returnStepOrder}"]`);
    if (!panel || !step) return;
    panel.scrollTop += step.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    setReadingScroll(panel.scrollTop);
    setReturnStepOrder(null);
  }, [returnStepOrder, sourceView.presentation.activePane]);

  const inputChanged = query.trim() !== resultQuery && Boolean(result);
  const evidenceRows = result?.steps.flatMap((step) => step.evidenceIds.map((evidenceId) => ({ step, evidenceId }))) ?? [];

  return <EvidenceWorkspace className="explain-layout" project={ref} source={source} navigationLabel="功能解释" presentation={sourceView.presentation} onPresentationChange={(next) => onSourceViewChange((current) => ({ ...current, open: next.sourceVisible, presentation: next }))} editorState={sourceView.editor} onEditorStateChange={(editor) => onSourceViewChange((current) => ({ ...current, editor }))} onCloseSource={onCloseSource} navigation={
    <section ref={explanationPanel} className="panel explanation-panel" aria-busy={state === "loading"} onScroll={(event) => setReadingScroll(event.currentTarget.scrollTop)}>
      <div className="panel-heading">
        <div><span className="kicker">从问题回到源码</span><h2>解释一个功能</h2></div>
        <span className={`health ${state === "ready" ? "ready" : state === "error" ? "missing" : state === "loading" ? "partial" : ""}`} data-testid="explanation-state">{{ idle: "等待查询", loading: "追踪中", ready: "已完成", empty: "无结果", error: "失败" }[state]}</span>
      </div>
      <form className="explanation-query" onSubmit={submit}>
        <label htmlFor="feature-query">要理解的功能</label>
        <div className="query-row">
          <input id="feature-query" aria-label="需要解释的功能" placeholder="例如：登录、文件导入或权限校验" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={guardCompositionEnter} />
          <button className="button primary" type="submit" disabled={!query.trim() || state === "loading" || lifecycle !== "active"}>{state === "loading" ? "正在追踪…" : state === "error" ? "重新追踪" : "开始追踪"}</button>
        </div>
      </form>
      {state === "loading" && <div className="query-feedback" role="status">正在为“{submittedQuery}”检索当前快照中的入口、静态路径和源码依据。{result && <>下面暂时保留上次结果“{resultQuery}”。</>}</div>}
      {state === "error" && <div className="error-banner explanation-error" role="alert"><span>追踪“{failedQuery}”失败：{error}</span><button className="button secondary" type="button" disabled={lifecycle !== "active"} onClick={() => void execute(failedQuery)}>重试“{failedQuery}”</button></div>}
      {inputChanged && <div className="query-feedback warning" role="status">下方结果仍对应已提交的问题“{resultQuery}”；当前输入尚未追踪。</div>}
      {!result && state === "idle" && <div className="empty-state spacious">输入功能名称并开始追踪。系统会展示可支持的静态关系、源码证据和无法确认的部分。</div>}
      {result && <article className="explanation" aria-label="功能解释结果">
        <section className="explanation-summary">
          <span className="kicker">问题与结果摘要</span>
          <p className="submitted-question"><b>本结果对应的问题</b><span>{resultQuery}</span></p>
          <h3>{result.title}</h3>
          <p>{result.summary}</p>
          <span className="structure-label">{result.structure === "ordered-path" ? "有界静态调用路径 · 不代表运行时轨迹" : "相关证据 · 未证明执行顺序"}</span>
        </section>
        {state === "empty" && <div className="query-feedback" role="status">没有找到可解释的源码步骤。可换用路由、函数、类或文件名关键词后重新追踪。</div>}
        <section className="explanation-section">
          <h3>解释步骤 <small>{result.steps.length} 步</small></h3>
          {result.steps.length ? <ol className="steps explanation-steps">{result.steps.map((step) => <li key={step.order} data-step-order={step.order} className={selectedStepOrder === step.order ? "step-verifying" : ""} aria-current={selectedStepOrder === step.order ? "step" : undefined}>
            <div className="step-copy"><span>{String(step.order).padStart(2, "0")}</span><div><b>{step.title}</b><p>{step.description}</p><small className={`confidence ${step.confidence}`}>{confidenceText[step.confidence]} · {step.evidenceIds.length} 条证据</small></div></div>
            {!step.evidenceIds.length && <p className="no-step-evidence">此步骤没有可定位的源码证据，不能作为已验证结论。</p>}
            {step.evidenceIds.length === 1 && <div className="step-verification"><button className="button secondary" type="button" disabled={Boolean(openingEvidence)} aria-pressed={selectedStepOrder === step.order && selectedEvidenceId === step.evidenceIds[0]} onClick={() => void openEvidence(step.evidenceIds[0]!, step.order)}>{openingEvidence === step.evidenceIds[0] ? "读取证据…" : selectedStepOrder === step.order && selectedEvidenceId === step.evidenceIds[0] ? "当前正在核验此步" : `核验第 ${step.order} 步`}</button>{selectedStepOrder === step.order && selectedEvidenceId === step.evidenceIds[0] && <button className="button secondary" type="button" onClick={() => returnToStep(step.order)}>返回第 {step.order} 步说明</button>}</div>}
            {step.evidenceIds.length > 1 && <details className="step-evidence-picker"><summary>选择此步的源码证据（{step.evidenceIds.length}）</summary><ul>{step.evidenceIds.map((evidenceId, index) => <li key={evidenceId}><span>证据 {index + 1} · {evidenceId}</span><button className="button secondary" type="button" disabled={Boolean(openingEvidence)} aria-pressed={selectedStepOrder === step.order && selectedEvidenceId === evidenceId} onClick={() => void openEvidence(evidenceId, step.order)}>{openingEvidence === evidenceId ? "读取证据…" : selectedEvidenceId === evidenceId && selectedStepOrder === step.order ? "当前证据范围" : `核验第 ${step.order} 步证据 ${index + 1}`}</button></li>)}</ul></details>}
            {step.evidenceIds.length > 1 && selectedStepOrder === step.order && selectedEvidenceId && step.evidenceIds.includes(selectedEvidenceId) && <button className="button secondary" type="button" onClick={() => returnToStep(step.order)}>返回第 {step.order} 步说明</button>}
            {selectedStepOrder === step.order && navigationErrorEvidenceId && step.evidenceIds.includes(navigationErrorEvidenceId) && <div className="step-navigation-error" role="alert"><span>这一步的源码读取失败：{navigationError}</span><button className="button secondary" type="button" disabled={Boolean(openingEvidence)} onClick={() => void openEvidence(navigationErrorEvidenceId, step.order)}>重试核验</button></div>}
          </li>)}</ol> : <div className="empty-inline">本次检索没有返回步骤。</div>}
        </section>
        <section className="explanation-section">
          <h3>源码证据 <small>{evidenceRows.length} 条</small></h3>
          {evidenceRows.length ? <ul className="explanation-evidence">{evidenceRows.map(({ step, evidenceId }) => <li key={`${step.order}:${evidenceId}`}>
            <span>第 {step.order} 步 · {step.title} · {confidenceText[step.confidence]}</span>
            <button className="button secondary" type="button" disabled={Boolean(openingEvidence)} aria-pressed={selectedEvidenceId === evidenceId} onClick={() => void openEvidence(evidenceId, step.order)}>{openingEvidence === evidenceId ? "读取证据…" : selectedEvidenceId === evidenceId ? "当前证据范围" : "定位源码范围"}</button>
          </li>)}</ul> : <div className="empty-inline">没有可定位的证据范围。</div>}
          {navigationError && !navigationErrorEvidenceId && <div className="error-banner" role="alert">源码导航失败：{navigationError}</div>}
        </section>
        <section className="explanation-section uncertainty-section">
          <h3>不确定性 <small>{result.unknowns.length} 项</small></h3>
          {result.unknowns.length ? <ul>{result.unknowns.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul> : <p>当前结果没有额外的未知项；静态证据仍不证明运行时一定执行。</p>}
        </section>
      </article>}
    </section>
  } />;
}
