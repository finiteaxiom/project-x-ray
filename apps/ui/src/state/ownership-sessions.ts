import type { ChangeReport, ComparisonMode, ComparisonRequest, ComparisonTaskEvent, ComparisonTaskHandle, Evidence, GraphNode, OwnershipGrade, OwnershipProgress, OwnershipPrompt, OwnershipSubmission, ProjectOverview, SnapshotRef, SourceCitation } from "@project-xray/contracts";
import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

export type TrainingScopeKind = "project" | "module" | "symbol";
export type TrainingScope = SnapshotRef & { kind: TrainingScopeKind; nodeId?: string; displayName: string };
export type SelectedTrainingNode = { id: string; name: string; qualifiedName?: string };
export type TrainingLocation = Evidence["span"] & { evidenceId?: string };
export type EditorSelection = Pick<SourceCitation, "startLine" | "startColumn" | "endLine" | "endColumn">;
export type TrainingChannel = "questions" | "progress" | "files" | "scope" | "grade" | "evidence";
export type TrainingLifecycle = "active" | "stale" | "archived";
export type TrainingRound = { questions: OwnershipPrompt[]; scope: TrainingScope | null };
export type TrainingSourceView = {
  open: boolean;
  loading: boolean;
  location: TrainingLocation | null;
  maximized: boolean;
  navigationCollapsed: boolean;
  activePane: "navigation" | "source";
  selection: EditorSelection | null;
  scrollTop: number;
  scrollLeft: number;
  error: string;
};

export type OwnershipTrainingSession = {
  id: string;
  ref: SnapshotRef;
  generation: number;
  lifecycle: TrainingLifecycle;
  round: TrainingRound;
  index: number;
  finished: boolean;
  answer: string;
  citations: SourceCitation[];
  caller: string;
  callee: string;
  path: string[];
  entry: string;
  roles: Record<number, "write" | "read" | "return">;
  grade: OwnershipGrade | null;
  progress: OwnershipProgress | null;
  scopeKind: TrainingScopeKind;
  scopeQuery: string;
  scopeNode: SelectedTrainingNode | null;
  scopeOptions: GraphNode[];
  fileQuery: string;
  sourceView: TrainingSourceView;
  pending: Record<TrainingChannel, boolean>;
  message: string;
  failureChannel: TrainingChannel | null;
  createdAt: number;
};

export type WorkspacePage = "architecture" | "flow" | "explain" | "diff";
export type WorkspacePageLifecycle = "active" | "stale" | "archived";
type WorkspacePageRecord = { ref: SnapshotRef; page: WorkspacePage; generation: number; lifecycle: WorkspacePageLifecycle; state: Record<string, unknown>; lastTouchedAt: number };
export type WorkspaceSourceView = {
  open: boolean;
  loading: boolean;
  location: (Evidence["span"] & { evidenceId?: string }) | null;
  error: string;
  presentation: { sourceVisible: boolean; sourceMaximized: boolean; navigationCollapsed: boolean; activePane: "navigation" | "source" };
  editor: { selection: Pick<SourceCitation, "startLine" | "startColumn" | "endLine" | "endColumn"> | null; scrollTop: number; scrollLeft: number };
};
export const emptyWorkspaceSourceView = (): WorkspaceSourceView => ({ open: false, loading: false, location: null, error: "", presentation: { sourceVisible: false, sourceMaximized: false, navigationCollapsed: false, activePane: "navigation" }, editor: { selection: null, scrollTop: -1, scrollLeft: -1 } });
type WorkspaceRequest = { token: number; generation: number; key: string };

export type ComparisonJobStatus = "starting" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
export type ComparisonJob = {
  requestId: string;
  repositoryId: string;
  snapshotId: string;
  projectName: string;
  project: ProjectOverview;
  request: ComparisonRequest;
  status: ComparisonJobStatus;
  taskId: string | null;
  event: ComparisonTaskEvent | null;
  report: ChangeReport | null;
  error: string;
  cancelError: string;
  cancelRequested: boolean;
  startedAt: number;
  finishedAt?: number;
};

function isTerminalComparison(status: ComparisonJobStatus): boolean { return status === "completed" || status === "failed" || status === "cancelled"; }
function pageIdentity(ref: SnapshotRef, page: WorkspacePage): string { return JSON.stringify([ref.repositoryId, ref.snapshotId, page]); }

type RequestToken = { sequence: number; generation: number; identity: string; captured: unknown };
const channels: TrainingChannel[] = ["questions", "progress", "files", "scope", "grade", "evidence"];
const identityOf = (ref: SnapshotRef): string => JSON.stringify([ref.repositoryId, ref.snapshotId]);
const emptyPending = (): Record<TrainingChannel, boolean> => ({ questions: false, progress: false, files: false, scope: false, grade: false, evidence: false });

function createSession(ref: SnapshotRef, generation: number): OwnershipTrainingSession {
  const stableRef = Object.freeze({ repositoryId: ref.repositoryId, snapshotId: ref.snapshotId });
  return {
    id: `${identityOf(stableRef)}:${generation}`, ref: stableRef, generation, lifecycle: "active",
    round: { questions: [], scope: null }, index: 0, finished: false, answer: "", citations: [],
    caller: "", callee: "", path: [], entry: "", roles: {}, grade: null, progress: null,
    scopeKind: "project", scopeQuery: "", scopeNode: null, scopeOptions: [], fileQuery: "",
    sourceView: { open: false, loading: false, location: null, maximized: false, navigationCollapsed: false, activePane: "navigation", selection: null, scrollTop: -1, scrollLeft: -1, error: "" },
    pending: emptyPending(), message: "", failureChannel: null, createdAt: Date.now(),
  };
}

/** In-memory owner of lightweight training drafts and requests that outlive page mounts. */
export class OwnershipSessionController {
  private readonly sessions = new Map<string, OwnershipTrainingSession>();
  private readonly activeByIdentity = new Map<string, string>();
  private readonly nextGeneration = new Map<string, number>();
  private readonly requests = new Map<string, Partial<Record<TrainingChannel, RequestToken>>>();
  private readonly sequences = new Map<string, Partial<Record<TrainingChannel, number>>>();
  private readonly listeners = new Set<() => void>();
  private readonly pageSessions = new Map<string, WorkspacePageRecord>();
  private readonly pageRequests = new Map<string, WorkspaceRequest>();
  private workspaceActivationEpoch = 0;
  private pageRequestSequence = 0;
  private readonly comparisonJobs = new Map<string, ComparisonJob>();
  private readonly comparisonStartOperations = new Map<string, { cancel: (taskId: string) => Promise<void> }>();
  private readonly earlyComparisonEvents = new Map<string, ComparisonTaskEvent>();
  private comparisonRequestSequence = 0;
  private revision = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getRevision = (): number => this.revision;

  getPageRecord(ref: SnapshotRef, page: WorkspacePage): WorkspacePageRecord | null { return this.pageSessions.get(pageIdentity(ref, page)) ?? null; }

  ensurePageValue<T>(ref: SnapshotRef, page: WorkspacePage, field: string, initial: T): { value: T; generation: number; lifecycle: WorkspacePageLifecycle } {
    const key = pageIdentity(ref, page);
    let record = this.pageSessions.get(key);
    if (!record) {
      record = { ref: Object.freeze({ ...ref }), page, generation: 1, lifecycle: "active", state: {}, lastTouchedAt: Date.now() };
    }
    record = { ...record, lastTouchedAt: Date.now() };
    this.pageSessions.set(key, record);
    if (!(field in record.state)) record.state[field] = initial;
    return { value: record.state[field] as T, generation: record.generation, lifecycle: record.lifecycle };
  }

  updatePageValue<T>(ref: SnapshotRef, page: WorkspacePage, field: string, generation: number, update: SetStateAction<T>): void {
    const record = this.pageSessions.get(pageIdentity(ref, page));
    if (!record || record.generation !== generation || record.lifecycle === "archived") return;
    const current = record.state[field] as T;
    const next = typeof update === "function" ? (update as (prior: T) => T)(current) : update;
    if (Object.is(current, next)) return;
    this.pageSessions.set(pageIdentity(ref, page), { ...record, state: { ...record.state, [field]: next }, lastTouchedAt: Date.now() });
    this.emit();
  }

  updateCurrentPageValue<T>(ref: SnapshotRef, page: WorkspacePage, field: string, update: SetStateAction<T>): void {
    const record = this.pageSessions.get(pageIdentity(ref, page));
    if (!record) return;
    this.updatePageValue(ref, page, field, record.generation, update);
  }

  runWorkspaceRequest<T>(ref: SnapshotRef, page: WorkspacePage, channel: string, key: string, operation: () => Promise<T>, accept: (value: T) => void, reject: (error: unknown) => void): boolean {
    const identity = pageIdentity(ref, page);
    const record = this.pageSessions.get(identity);
    if (!record || record.lifecycle !== "active") return false;
    const requestKey = `${identity}:${channel}`;
    const current = this.pageRequests.get(requestKey);
    if (current?.key === key && current.generation === record.generation) return false;
    const request: WorkspaceRequest = { token: ++this.pageRequestSequence, generation: record.generation, key };
    this.pageRequests.set(requestKey, request);
    const isCurrent = (): boolean => {
      const latest = this.pageRequests.get(requestKey);
      const session = this.pageSessions.get(identity);
      return latest?.token === request.token && session?.generation === request.generation && session.lifecycle === "active";
    };
    void operation().then((value) => { if (isCurrent()) accept(value); }).catch((error: unknown) => { if (isCurrent()) reject(error); }).finally(() => {
      if (isCurrent()) { this.pageRequests.delete(requestKey); this.emit(); }
    });
    return true;
  }

  invalidateWorkspaceRequest(ref: SnapshotRef, page: WorkspacePage, channel?: string): void {
    const prefix = `${pageIdentity(ref, page)}:`;
    for (const key of this.pageRequests.keys()) if (key.startsWith(prefix) && (!channel || key === `${prefix}${channel}`)) this.pageRequests.delete(key);
  }

  markWorkspaceStale(ref: SnapshotRef): void {
    // Materialize the evidence pages even when the current view has not opened
    // them yet, so a later mount inherits the confirmed stale lifecycle.
    for (const page of ["architecture", "flow", "explain"] as const) {
      const key = pageIdentity(ref, page);
      if (!this.pageSessions.has(key)) this.pageSessions.set(key, { ref: Object.freeze({ ...ref }), page, generation: 1, lifecycle: "active", state: {}, lastTouchedAt: Date.now() });
    }
    for (const [key, record] of this.pageSessions) {
      if (record.page !== "diff" && record.ref.repositoryId === ref.repositoryId && record.ref.snapshotId === ref.snapshotId && record.lifecycle === "active") {
        const state = { ...record.state };
        const sourceView = state.sourceView as WorkspaceSourceView | undefined;
        if (sourceView?.loading) state.sourceView = { ...sourceView, loading: false };
        if (record.page === "flow") { state.searching = false; state.querying = false; }
        if (record.page === "explain" && state.state === "loading") {
          state.state = "error";
          state.failedQuery = state.submittedQuery;
          state.error = "工作区已变化；本次未完成的解释已失效。更新索引后可以重新追踪。";
        }
        this.pageSessions.set(key, { ...record, state, generation: record.generation + 1, lifecycle: "stale", lastTouchedAt: Date.now() });
        this.invalidateWorkspaceRequest(ref, record.page);
      }
    }
    this.pruneWorkspacePages(ref.repositoryId);
    this.emit();
  }

  activateWorkspaceSnapshot(ref: SnapshotRef, activationEpoch?: number): void {
    if (activationEpoch !== undefined) {
      if (!Number.isSafeInteger(activationEpoch) || activationEpoch <= this.workspaceActivationEpoch) return;
      this.workspaceActivationEpoch = activationEpoch;
    }

    let changed = false;
    for (const [key, record] of this.pageSessions) {
      if (record.page !== "diff" && record.ref.repositoryId === ref.repositoryId && record.ref.snapshotId !== ref.snapshotId && record.lifecycle !== "archived") {
        this.pageSessions.set(key, { ...record, generation: record.generation + 1, lifecycle: "archived", lastTouchedAt: Date.now() });
        this.invalidateWorkspaceRequest(record.ref, record.page);
        changed = true;
      } else if (activationEpoch !== undefined && record.page !== "diff" && record.ref.repositoryId === ref.repositoryId && record.ref.snapshotId === ref.snapshotId) {
        this.pageSessions.set(key, {
          ...record,
          state: this.reactivatedPageState(record),
          generation: record.generation + 1,
          lifecycle: "active",
          lastTouchedAt: Date.now(),
        });
        this.invalidateWorkspaceRequest(ref, record.page);
        changed = true;
      }
    }
    this.pruneWorkspacePages(ref.repositoryId);
    if (changed) this.emit();
  }

  private reactivatedPageState(record: WorkspacePageRecord): Record<string, unknown> {
    const state = { ...record.state };
    const sourceView = state.sourceView as WorkspaceSourceView | undefined;
    if (sourceView) state.sourceView = { ...sourceView, loading: false, error: "" };

    if (record.page === "flow") {
      state.searching = false;
      state.querying = false;
      state.error = "";
      const result = state.result as { repositoryId?: string; snapshotId?: string } | null | undefined;
      if (result && (result.repositoryId !== record.ref.repositoryId || result.snapshotId !== record.ref.snapshotId)) {
        state.result = null;
        state.resultKey = "";
        state.resultLabel = "";
        state.selectedResultId = null;
      }
    } else if (record.page === "architecture") {
      state.requestError = "";
    } else if (record.page === "explain") {
      state.navigationError = "";
      state.navigationErrorEvidenceId = null;
      state.openingEvidence = "";
      if (state.state === "loading") state.state = "idle";
      if (state.state === "error" && typeof state.error === "string" && state.error.startsWith("工作区已变化；")) {
        state.state = "idle";
        state.failedQuery = "";
      }
      state.error = "";
      const result = state.result as { repositoryId?: string; snapshotId?: string } | null | undefined;
      if (result && (result.repositoryId !== record.ref.repositoryId || result.snapshotId !== record.ref.snapshotId)) {
        state.result = null;
        state.resultQuery = "";
        state.selectedEvidenceId = null;
        state.selectedStepOrder = null;
      }
    }
    return state;
  }

  private pruneWorkspacePages(repositoryId: string): void {
    const pages: WorkspacePage[] = ["architecture", "flow", "explain", "diff"];
    for (const page of pages) {
      const records = [...this.pageSessions.entries()]
        .filter(([, record]) => record.ref.repositoryId === repositoryId && record.page === page)
        .sort((a, b) => b[1].lastTouchedAt - a[1].lastTouchedAt);
      // Keep a small per-page history for convenient same-run return. Training
      // drafts and comparison jobs live in separate maps and are never pruned here.
      for (const [key, record] of records.slice(4)) {
        const task = page === "diff" ? this.comparisonJobs.get(repositoryId) : undefined;
        if (task && !isTerminalComparison(task.status) && task.snapshotId === record.ref.snapshotId) continue;
        this.pageSessions.delete(key);
        this.invalidateWorkspaceRequest(record.ref, record.page);
      }
    }
  }

  getComparisonJob(repositoryId: string): ComparisonJob | null { return this.comparisonJobs.get(repositoryId) ?? null; }
  listComparisonJobs(): ComparisonJob[] { return [...this.comparisonJobs.values()].sort((a, b) => b.startedAt - a.startedAt); }

  startComparison(
    project: ProjectOverview,
    request: ComparisonRequest,
    start: () => Promise<ComparisonTaskHandle>,
    cancel: (taskId: string) => Promise<void>,
  ): string | null {
    const current = this.comparisonJobs.get(project.repositoryId);
    if (current && !isTerminalComparison(current.status)) return null;
    const requestId = `${project.repositoryId}:${++this.comparisonRequestSequence}`;
    const job: ComparisonJob = {
      requestId, repositoryId: project.repositoryId, snapshotId: project.snapshotId, projectName: project.name, project,
      request: Object.freeze({ ...request }), status: "starting", taskId: null, event: null,
      report: current?.report ?? null, error: "", cancelError: "", cancelRequested: false, startedAt: Date.now(),
    };
    this.comparisonJobs.set(project.repositoryId, job);
    this.comparisonStartOperations.set(requestId, { cancel });
    this.emit();
    void start().then(async (handle) => {
      const latest = this.comparisonJobs.get(project.repositoryId);
      if (!latest || latest.requestId !== requestId) { void cancel(handle.taskId); return; }
      if (handle.repositoryId !== request.repositoryId || handle.mode !== request.mode) {
        this.updateComparisonJob(project.repositoryId, requestId, (prior) => ({ ...prior, status: "failed", error: "Git 比较启动响应与捕获的仓库或模式不一致。", finishedAt: Date.now() }));
        void cancel(handle.taskId);
        return;
      }
      this.updateComparisonJob(project.repositoryId, requestId, (prior) => ({ ...prior, taskId: handle.taskId, status: prior.cancelRequested ? "cancelling" : "running" }));
      const early = this.earlyComparisonEvents.get(handle.taskId);
      if (early) { this.earlyComparisonEvents.delete(handle.taskId); this.receiveComparisonEvent(early); }
      const afterAttach = this.comparisonJobs.get(project.repositoryId);
      if (afterAttach?.requestId === requestId && afterAttach.cancelRequested && !isTerminalComparison(afterAttach.status)) await this.sendComparisonCancel(project.repositoryId, requestId);
    }).catch((reason: unknown) => {
      this.updateComparisonJob(project.repositoryId, requestId, (prior) => ({ ...prior, status: "failed", error: reason instanceof Error ? reason.message : String(reason), finishedAt: Date.now() }));
      this.comparisonStartOperations.delete(requestId);
    });
    return requestId;
  }

  requestComparisonCancel(repositoryId: string): void {
    const job = this.comparisonJobs.get(repositoryId);
    if (!job || isTerminalComparison(job.status) || job.cancelRequested) return;
    this.updateComparisonJob(repositoryId, job.requestId, (prior) => ({ ...prior, cancelRequested: true, status: "cancelling", cancelError: "" }));
    if (job.taskId) void this.sendComparisonCancel(repositoryId, job.requestId);
  }

  dismissComparisonJob(repositoryId: string): void {
    const job = this.comparisonJobs.get(repositoryId);
    if (!job || !isTerminalComparison(job.status)) return;
    this.comparisonJobs.delete(repositoryId);
    this.comparisonStartOperations.delete(job.requestId);
    this.emit();
  }

  receiveComparisonEvent(event: ComparisonTaskEvent): void {
    const job = [...this.comparisonJobs.values()].find((candidate) => candidate.taskId === event.taskId);
    if (!job) {
      if (this.earlyComparisonEvents.size >= 24 && !this.earlyComparisonEvents.has(event.taskId)) this.earlyComparisonEvents.delete(this.earlyComparisonEvents.keys().next().value as string);
      const previous = this.earlyComparisonEvents.get(event.taskId);
      // Progress may be replaced by a newer progress or terminal event. Once a
      // terminal arrives during the start window, keep it as the authoritative
      // outcome even if a duplicate or out-of-order event follows.
      if (!previous || previous.type === "progress") this.earlyComparisonEvents.set(event.taskId, event);
      return;
    }
    if (job.repositoryId !== event.repositoryId || isTerminalComparison(job.status)) return;
    if (event.type === "completed") {
      if (event.report.repositoryId !== job.repositoryId || event.report.mode !== job.request.mode || event.report.left.snapshot.repositoryId !== job.repositoryId || event.report.right.snapshot.repositoryId !== job.repositoryId) {
        this.updateComparisonJob(job.repositoryId, job.requestId, (prior) => ({ ...prior, status: "failed", event, error: "比较报告的仓库或实际模式与启动请求不匹配，已丢弃。", finishedAt: Date.now() }));
        return;
      }
      this.updateComparisonJob(job.repositoryId, job.requestId, (prior) => ({ ...prior, status: "completed", event, report: event.report, error: "", finishedAt: Date.now() }));
      this.comparisonStartOperations.delete(job.requestId);
    } else if (event.type === "failed") {
      this.updateComparisonJob(job.repositoryId, job.requestId, (prior) => ({ ...prior, status: "failed", event, error: event.message, finishedAt: Date.now() }));
      this.comparisonStartOperations.delete(job.requestId);
    } else if (event.type === "cancelled") {
      this.updateComparisonJob(job.repositoryId, job.requestId, (prior) => ({ ...prior, status: "cancelled", event, error: event.message, finishedAt: Date.now() }));
      this.comparisonStartOperations.delete(job.requestId);
    } else {
      this.updateComparisonJob(job.repositoryId, job.requestId, (prior) => ({ ...prior, event }));
    }
  }

  private async sendComparisonCancel(repositoryId: string, requestId: string): Promise<void> {
    const job = this.comparisonJobs.get(repositoryId);
    const operation = this.comparisonStartOperations.get(requestId);
    if (!job || job.requestId !== requestId || !job.taskId || !operation || isTerminalComparison(job.status)) return;
    try { await operation.cancel(job.taskId); }
    catch (reason) {
      const current = this.comparisonJobs.get(repositoryId);
      if (current?.requestId === requestId && !isTerminalComparison(current.status)) {
        this.updateComparisonJob(repositoryId, requestId, (prior) => ({ ...prior, cancelError: reason instanceof Error ? reason.message : String(reason) }));
      }
    }
  }

  private updateComparisonJob(repositoryId: string, requestId: string, update: (job: ComparisonJob) => ComparisonJob): void {
    const current = this.comparisonJobs.get(repositoryId);
    if (!current || current.requestId !== requestId) return;
    this.comparisonJobs.set(repositoryId, update(current));
    this.emit();
  }

  activate(ref: SnapshotRef, forceFresh = false): string {
    const identity = identityOf(ref);
    const existingId = this.activeByIdentity.get(identity);
    const existing = existingId ? this.sessions.get(existingId) : undefined;
    if (existing && !forceFresh && existing.lifecycle !== "archived") return existing.id;
    if (existing && (forceFresh || existing.lifecycle === "archived")) this.archive(existing.id);

    for (const session of this.sessions.values()) {
      if (session.ref.repositoryId === ref.repositoryId && session.ref.snapshotId !== ref.snapshotId && session.lifecycle !== "archived") this.archive(session.id);
    }
    const generation = (this.nextGeneration.get(identity) ?? 0) + 1;
    this.nextGeneration.set(identity, generation);
    const session = createSession(ref, generation);
    this.sessions.set(session.id, session);
    this.activeByIdentity.set(identity, session.id);
    this.emit();
    return session.id;
  }

  sessionId(ref: SnapshotRef): string | null { return this.activeByIdentity.get(identityOf(ref)) ?? null; }
  getSession(id: string): OwnershipTrainingSession | null { return this.sessions.get(id) ?? null; }
  listArchived(repositoryId: string): OwnershipTrainingSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.ref.repositoryId === repositoryId && session.lifecycle === "archived")
      .sort((a, b) => b.createdAt - a.createdAt || b.generation - a.generation);
  }

  updateSession(id: string, update: (current: OwnershipTrainingSession) => OwnershipTrainingSession): void {
    const current = this.sessions.get(id);
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    this.sessions.set(id, next);
    this.emit();
  }

  async run<T>(id: string, channel: TrainingChannel, captured: unknown, operation: () => Promise<T>, accept: (value: T) => void): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || session.lifecycle !== "active" || session.pending[channel]) return;
    const sequenceSet = this.sequences.get(id) ?? {};
    const token: RequestToken = { sequence: (sequenceSet[channel] ?? 0) + 1, generation: session.generation, identity: identityOf(session.ref), captured };
    sequenceSet[channel] = token.sequence;
    this.sequences.set(id, sequenceSet);
    const requestSet = this.requests.get(id) ?? {};
    requestSet[channel] = token;
    this.requests.set(id, requestSet);
    this.updateSession(id, (current) => ({ ...current, pending: { ...current.pending, [channel]: true }, message: "", failureChannel: null }));

    const isCurrent = (): boolean => {
      const current = this.sessions.get(id);
      return current?.lifecycle === "active" && current.generation === token.generation && identityOf(current.ref) === token.identity && this.requests.get(id)?.[channel] === token;
    };
    try {
      const value = await operation();
      if (isCurrent()) accept(value);
    } catch (error) {
      if (isCurrent()) this.updateSession(id, (current) => ({ ...current, message: error instanceof Error ? error.message : String(error), failureChannel: channel }));
    } finally {
      if (isCurrent()) {
        this.updateSession(id, (current) => ({ ...current, pending: { ...current.pending, [channel]: false } }));
        const activeRequests = this.requests.get(id);
        if (activeRequests?.[channel] === token) {
          delete activeRequests[channel];
          if (Object.keys(activeRequests).length === 0) this.requests.delete(id);
        }
      }
    }
  }

  markStale(ref: SnapshotRef): void {
    const id = this.sessionId(ref);
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session || session.lifecycle !== "active") return;
    this.invalidate(id);
    this.sequences.delete(id);
    this.updateSession(id, (current) => ({ ...current, lifecycle: "stale", pending: emptyPending(), message: "", failureChannel: null }));
  }

  invalidateChannel(id: string, channel: TrainingChannel): void {
    const requests = this.requests.get(id);
    if (!requests?.[channel]) return;
    delete requests[channel];
    const sequences = this.sequences.get(id) ?? {};
    sequences[channel] = (sequences[channel] ?? 0) + 1;
    this.sequences.set(id, sequences);
    this.updateSession(id, (current) => ({ ...current, pending: { ...current.pending, [channel]: false } }));
  }

  discard(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.lifecycle !== "archived") return;
    this.invalidate(id);
    this.sequences.delete(id);
    this.sessions.delete(id);
    const identity = identityOf(session.ref);
    if (this.activeByIdentity.get(identity) === id) this.activeByIdentity.delete(identity);
    this.emit();
  }

  private archive(id: string): void {
    const session = this.sessions.get(id);
    if (!session || session.lifecycle === "archived") return;
    this.invalidate(id);
    this.sequences.delete(id);
    this.sessions.set(id, { ...session, lifecycle: "archived", pending: emptyPending(), sourceView: { ...session.sourceView, loading: false }, message: "", failureChannel: null });
    this.emit();
  }

  private invalidate(id: string): void {
    this.requests.delete(id);
    const sequences = this.sequences.get(id) ?? {};
    for (const channel of channels) sequences[channel] = (sequences[channel] ?? 0) + 1;
    this.sequences.set(id, sequences);
  }
  private emit(): void { this.revision += 1; for (const listener of this.listeners) listener(); }
}

export function createOwnershipSessionController(): OwnershipSessionController { return new OwnershipSessionController(); }

/** Persist one small serializable page slice in the same application session controller as training. */
export function useWorkspacePageState<T>(controller: OwnershipSessionController, ref: SnapshotRef, page: WorkspacePage, field: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  useSyncExternalStore(controller.subscribe, controller.getRevision, controller.getRevision);
  const entry = controller.ensurePageValue(ref, page, field, initial);
  const setter = useCallback<Dispatch<SetStateAction<T>>>((update) => controller.updatePageValue(ref, page, field, entry.generation, update), [controller, ref.repositoryId, ref.snapshotId, page, field, entry.generation]);
  return [entry.value, setter];
}

export type StructuredTrainingAnswer = OwnershipSubmission["structuredAnswer"];

export function structuredAnswerFor(session: OwnershipTrainingSession): StructuredTrainingAnswer | null {
  const question = session.round.questions[session.index];
  if (!question) return null;
  if (question.kind === "entry") return session.entry ? { kind: "entry", nodeId: session.entry } : null;
  if (question.kind === "call-direction") return session.caller && session.callee ? { kind: "call-direction", callerNodeId: session.caller, calleeNodeId: session.callee } : null;
  if (question.kind === "call-path") return session.path.length >= 2 ? { kind: "call-path", nodeIds: session.path } : null;
  const roles = Object.entries(session.roles).map(([citationIndex, role]) => ({ citationIndex: Number(citationIndex), role }));
  return roles.length >= 2 ? { kind: "variable-flow", roles } : null;
}
