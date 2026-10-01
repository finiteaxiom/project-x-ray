import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  ignoreSettingsRequestSchema, ignoreSettingsResponseSchema, saveIgnoreSettingsRequestSchema, IPC_CHANNELS, TASK_PROTOCOL_VERSION, changeReportRequestSchema, changeReportSchema, changeReportStateSchema, comparisonRequestSchema, comparisonTaskEventSchema, comparisonTaskHandleSchema, evidenceLocationSchema, evidenceRangeRequestSchema, evidenceRangeResponseSchema, evidenceRequestSchema, identifiedEvidenceSchema, explanationSchema, flowResultSchema, graphQueryRequestSchema, graphQueryResponseSchema, importGitInputSchema, indexTaskEventSchema,
  indexTaskHandleSchema, moduleExpansionRequestSchema, moduleExpansionResponseSchema, moduleListRequestSchema, moduleListResponseSchema, moduleOverviewRequestSchema, moduleOverviewResponseSchema, moduleRelationEdgesRequestSchema, moduleRelationEdgesResponseSchema, ownershipGradeSchema, ownershipProgressSchema, ownershipPromptSchema, ownershipQuestionRequestSchema, ownershipSubmissionSchema, projectOverviewSchema, searchRequestSchema, searchResponseSchema,
  snapshotRefSchema, snapshotStateSchema, sourceFileResultSchema, SafeDiagnosticError, diagnosticForError, workerRequestSchema, workerResponseSchema,
  type ComparisonRequest, type ComparisonTaskEvent, type ComparisonTaskHandle, type IndexProgress, type IndexTaskEvent, type IndexTaskHandle, type WorkerRequest,
} from "@project-xray/contracts";
import { z } from "zod";

let window: BrowserWindow | null = null;
let broker: AnalysisBroker | null = null;
if (process.env.XRAY_E2E_USER_DATA) app.setPath("userData", process.env.XRAY_E2E_USER_DATA);

interface WorkerConfiguration { databasePath: string; projectDatabaseRoot: string; cacheRoot: string }
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }
interface TaskRecord { taskId: string; rootPath: string; sourceType: "local" | "git"; branch?: string; worker: Worker; phase: IndexProgress["phase"]; settled: boolean }
interface RetryInput { rootPath: string; sourceType: "local" | "git"; branch?: string }
interface ComparisonTaskRecord { taskId: string; input: ComparisonRequest; worker: Worker; settled: boolean }

class AnalysisBroker {
  private queryWorker: Worker;
  private savingIgnoreSettings = false;
  private readonly pending = new Map<string, Pending>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly comparisonTasks = new Map<string, ComparisonTaskRecord>();
  private readonly history = new Map<string, RetryInput>();
  constructor(private readonly configuration: WorkerConfiguration, private readonly emit: (event: IndexTaskEvent) => void, private readonly emitComparison: (event: ComparisonTaskEvent) => void) { this.queryWorker = this.createQueryWorker(); }

  private worker(): Worker { return new Worker(join(__dirname, "analysis-worker.js"), { workerData: this.configuration }); }
  private createQueryWorker(): Worker {
    const worker = this.worker();
    worker.on("message", (raw) => {
      const message = workerResponseSchema.safeParse(raw); if (!message.success) return;
      if (message.data.type !== "response") return;
      const pending = this.pending.get(message.data.requestId); if (!pending) return; this.pending.delete(message.data.requestId);
      if (message.data.ok) pending.resolve(message.data.payload); else pending.reject(new SafeDiagnosticError(message.data.code));
    });
    worker.on("error", (error) => { if (this.queryWorker === worker) this.failPending(new SafeDiagnosticError(diagnosticForError(error, "WORKER_FAILED").code)); });
    worker.on("exit", (code) => { if (this.queryWorker === worker && code !== 0) this.failPending(new SafeDiagnosticError("WORKER_FAILED")); });
    return worker;
  }
  private failPending(error: Error): void { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear(); }
  private restartQueryWorker(): void { const old = this.queryWorker; this.failPending(new Error("索引更新后查询上下文已刷新，请重试")); this.queryWorker = this.createQueryWorker(); void old.terminate(); }
  request(input: Record<string, unknown>): Promise<unknown> {
    const saving = input.operation === "save-ignore-settings";
    if (saving && (this.savingIgnoreSettings || [...this.tasks.values()].some(task => !task.settled) || [...this.comparisonTasks.values()].some(task => !task.settled))) return Promise.reject(new SafeDiagnosticError("IGNORE_SETTINGS_BUSY"));
    const requestId = randomUUID(); const request = workerRequestSchema.parse({ ...input, requestId });
    if (saving) this.savingIgnoreSettings = true;
    return new Promise((resolve, reject) => { this.pending.set(requestId, { resolve, reject }); this.queryWorker.postMessage(request); }).finally(() => { if (saving) this.savingIgnoreSettings = false; });
  }
  start(input: RetryInput): IndexTaskHandle {
    if (this.savingIgnoreSettings) throw new SafeDiagnosticError("IGNORE_SETTINGS_BUSY");
    for (const task of this.tasks.values()) if (!task.settled) void this.cancel(task.taskId);
    const taskId = randomUUID(); const worker = this.worker();
    const record: TaskRecord = { taskId, ...input, worker, phase: "queued", settled: false }; this.tasks.set(taskId, record); this.history.set(taskId, input);
    worker.on("message", (raw) => {
      const message = workerResponseSchema.safeParse(raw); if (!message.success || message.data.type !== "event") return;
      const event = indexTaskEventSchema.parse(message.data.event); if (event.taskId !== taskId || record.settled) return;
      if (event.type === "progress") record.phase = event.progress.phase;
      else { record.settled = true; if (event.type === "completed") this.restartQueryWorker(); void worker.terminate(); }
      this.emit(event);
    });
    worker.on("error", () => { if (!record.settled) this.finishFailed(record, "WORKER_FAILED"); });
    worker.on("exit", (code) => { if (code !== 0 && !record.settled) this.finishFailed(record, "WORKER_FAILED"); });
    const request: WorkerRequest = { requestId: randomUUID(), operation: "start-index", taskId, rootPath: input.rootPath, sourceType: input.sourceType, ...(input.branch ? { branch: input.branch } : {}) };
    // 先让 IPC 调用把 taskId 返回给渲染进程，避免极小项目在 UI 记录任务身份前就完成。
    setTimeout(() => { if (!record.settled) worker.postMessage(request); }, 25);
    return indexTaskHandleSchema.parse({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, rootPath: input.rootPath });
  }
  private finishFailed(record: TaskRecord, code: "WORKER_FAILED"): void { record.settled = true; this.emit({ protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId: record.taskId, rootPath: record.rootPath, code, retryable: true }); }
  async cancel(taskId: string): Promise<void> {
    const record = this.tasks.get(taskId); if (!record || record.settled) return;
    record.worker.postMessage({ requestId: randomUUID(), operation: "cancel-index", taskId } satisfies WorkerRequest);
    if (record.phase === "persisting") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (record.settled) return;
    record.settled = true; await record.worker.terminate();
    this.emit({ protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId, rootPath: record.rootPath, message: "索引已取消；上一份完整快照保持不变。" });
  }
  retry(taskId: string): IndexTaskHandle { const input = this.history.get(taskId); if (!input) throw new Error("找不到可重试任务"); return this.start(input); }
  // A comparison publishes an independent report without changing the indexed snapshot; keep query RPCs alive while this worker exits.
  startComparison(input: ComparisonRequest): ComparisonTaskHandle { if (this.savingIgnoreSettings) throw new SafeDiagnosticError("IGNORE_SETTINGS_BUSY"); for (const task of this.comparisonTasks.values()) if (!task.settled) void this.cancelComparison(task.taskId); const taskId = randomUUID(); const worker = this.worker(); const record: ComparisonTaskRecord = { taskId, input, worker, settled: false }; this.comparisonTasks.set(taskId, record); worker.on("message", (raw) => { const message = workerResponseSchema.safeParse(raw); if (!message.success || message.data.type !== "comparison-event") return; const event = comparisonTaskEventSchema.parse(message.data.event); if (event.taskId !== taskId || record.settled) return; if (event.type !== "progress") { record.settled = true; void worker.terminate(); } this.emitComparison(event); }); const failWorker = (): void => { if (!record.settled) { record.settled = true; this.emitComparison({ protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId, repositoryId: input.repositoryId, code: "WORKER_FAILED", retryable: true }); } }; worker.on("error", failWorker); worker.on("exit", (code) => { if (code !== 0) failWorker(); }); const request: WorkerRequest = { requestId: randomUUID(), operation: "start-comparison", taskId, input }; setTimeout(() => { if (!record.settled) worker.postMessage(request); }, 25); return comparisonTaskHandleSchema.parse({ protocolVersion: TASK_PROTOCOL_VERSION, taskId, repositoryId: input.repositoryId, mode: input.mode }); }
  async cancelComparison(taskId: string): Promise<void> { const record = this.comparisonTasks.get(taskId); if (!record || record.settled) return; record.worker.postMessage({ requestId: randomUUID(), operation: "cancel-comparison", taskId } satisfies WorkerRequest); await new Promise((resolve) => setTimeout(resolve, 100)); if (record.settled) return; record.settled = true; await record.worker.terminate(); this.emitComparison({ protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId, repositoryId: record.input.repositoryId, message: "变更比较已取消；既有快照和报告保持不变。" }); }
  async close(): Promise<void> { for (const task of this.tasks.values()) if (!task.settled) await task.worker.terminate(); for (const task of this.comparisonTasks.values()) if (!task.settled) await task.worker.terminate(); await this.queryWorker.terminate(); }
}

function requireBroker(): AnalysisBroker { if (!broker) throw new Error("应用尚未初始化"); return broker; }
function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.selectLocalProject, async () => { const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory"], title: "选择要分析的项目" }); return result.canceled || !result.filePaths[0] ? null : requireBroker().start({ rootPath: result.filePaths[0], sourceType: "local" }); });
  ipcMain.handle(IPC_CHANNELS.importLocalProject, (_event, rootPath) => requireBroker().start({ rootPath: z.string().min(1).parse(rootPath), sourceType: "local" }));
  ipcMain.handle(IPC_CHANNELS.importGitProject, (_event, raw) => { const input = importGitInputSchema.parse(raw); return requireBroker().start({ rootPath: input.url, sourceType: "git", ...(input.branch ? { branch: input.branch } : {}) }); });
  ipcMain.handle(IPC_CHANNELS.cancelIndex, (_event, taskId) => requireBroker().cancel(z.string().uuid().parse(taskId)));
  ipcMain.handle(IPC_CHANNELS.retryIndex, (_event, taskId) => requireBroker().retry(z.string().uuid().parse(taskId)));
  ipcMain.handle(IPC_CHANNELS.getIgnoreSettings, async (_event, raw) => ignoreSettingsResponseSchema.parse(await requireBroker().request({ operation: "get-ignore-settings", ref: ignoreSettingsRequestSchema.parse(raw) })));
  ipcMain.handle(IPC_CHANNELS.saveIgnoreSettings, async (_event, raw) => ignoreSettingsResponseSchema.parse(await requireBroker().request({ operation: "save-ignore-settings", input: saveIgnoreSettingsRequestSchema.parse(raw) })));
  ipcMain.handle(IPC_CHANNELS.getCurrentProject, async () => { const value = await requireBroker().request({ operation: "get-current" }); return value === null ? null : projectOverviewSchema.parse(value); });
  ipcMain.handle(IPC_CHANNELS.getSnapshotState, async (_event, raw) => snapshotStateSchema.parse(await requireBroker().request({ operation: "get-state", ref: snapshotRefSchema.parse(raw) })));
  ipcMain.handle(IPC_CHANNELS.listModules, async (_event, raw) => { const input = moduleListRequestSchema.parse(raw); return moduleListResponseSchema.parse(await requireBroker().request({ operation: "list-modules", input })); });
  ipcMain.handle(IPC_CHANNELS.moduleOverview, async (_event, raw) => { const input = moduleOverviewRequestSchema.parse(raw); return moduleOverviewResponseSchema.parse(await requireBroker().request({ operation: "module-overview", input })); });
  ipcMain.handle(IPC_CHANNELS.expandModule, async (_event, raw) => { const input = moduleExpansionRequestSchema.parse(raw); return moduleExpansionResponseSchema.parse(await requireBroker().request({ operation: "expand-module", input })); });
  ipcMain.handle(IPC_CHANNELS.moduleRelationEdges, async (_event, raw) => { const input = moduleRelationEdgesRequestSchema.parse(raw); return moduleRelationEdgesResponseSchema.parse(await requireBroker().request({ operation: "module-relation-edges", input })); });
  ipcMain.handle(IPC_CHANNELS.search, async (_event, raw) => { const input = searchRequestSchema.parse(raw); return searchResponseSchema.parse(await requireBroker().request({ operation: "search", input })); });
  ipcMain.handle(IPC_CHANNELS.queryGraph, async (_event, raw) => { const input = graphQueryRequestSchema.parse(raw); return graphQueryResponseSchema.parse(await requireBroker().request({ operation: "query-graph", input })); });
  ipcMain.handle(IPC_CHANNELS.getEvidence, async (_event, raw) => { const input = evidenceRequestSchema.parse(raw); return identifiedEvidenceSchema.parse(await requireBroker().request({ operation: "evidence", input })); });
  ipcMain.handle(IPC_CHANNELS.findEvidence, async (_event, raw) => { const input = evidenceRangeRequestSchema.parse(raw); return evidenceRangeResponseSchema.parse(await requireBroker().request({ operation: "evidence-range", input })); });
  ipcMain.handle(IPC_CHANNELS.getFlow, async (_event, rawRef, nodeId, depth) => flowResultSchema.parse(await requireBroker().request({ operation: "get-flow", ref: snapshotRefSchema.parse(rawRef), nodeId: z.string().min(1).parse(nodeId), depth: z.number().int().min(1).max(6).optional().parse(depth) })));
  ipcMain.handle(IPC_CHANNELS.explainFeature, async (_event, rawRef, query) => explanationSchema.parse(await requireBroker().request({ operation: "explain", ref: snapshotRefSchema.parse(rawRef), query: z.string().trim().min(1).parse(query) })));
  ipcMain.handle(IPC_CHANNELS.startComparison, (_event, raw) => requireBroker().startComparison(comparisonRequestSchema.parse(raw)));
  ipcMain.handle(IPC_CHANNELS.cancelComparison, (_event, taskId) => requireBroker().cancelComparison(z.string().uuid().parse(taskId)));
  ipcMain.handle(IPC_CHANNELS.loadChangeReport, async (_event, raw) => { const input = changeReportRequestSchema.parse(raw); return changeReportSchema.parse(await requireBroker().request({ operation: "load-change-report", input })); });
  ipcMain.handle(IPC_CHANNELS.changeReportState, async (_event, raw) => { const input = changeReportRequestSchema.parse(raw); return changeReportStateSchema.parse(await requireBroker().request({ operation: "change-report-state", input })); });
  ipcMain.handle(IPC_CHANNELS.createOwnershipQuestions, async (_event, raw) => { const input = ownershipQuestionRequestSchema.parse(raw); return z.array(ownershipPromptSchema).parse(await requireBroker().request({ operation: "questions", input })); });
  ipcMain.handle(IPC_CHANNELS.gradeOwnershipAnswer, async (_event, raw) => ownershipGradeSchema.parse(await requireBroker().request({ operation: "grade", submission: ownershipSubmissionSchema.parse(raw) })));
  ipcMain.handle(IPC_CHANNELS.ownershipProgress, async (_event, raw) => ownershipProgressSchema.parse(await requireBroker().request({ operation: "ownership-progress", ref: snapshotRefSchema.parse(raw) })));
  ipcMain.handle(IPC_CHANNELS.readSource, async (_event, raw) => sourceFileResultSchema.parse(await requireBroker().request({ operation: "source", location: evidenceLocationSchema.parse(raw) })));
}

async function createWindow(): Promise<void> {
  const smokeMode = process.env.XRAY_SMOKE === "1";
  const e2eMode = process.env.XRAY_E2E === "1";
  window = new BrowserWindow({ show: !smokeMode, width: 1500, height: 940, minWidth: 960, minHeight: 720, backgroundColor: "#071018", title: "Project X-Ray", webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (smokeMode) { window.webContents.once("did-finish-load", () => app.quit()); window.webContents.once("did-fail-load", (_event, _code, description) => { process.exitCode = 1; console.error(`界面加载失败：${description}`); app.quit(); }); }
  if (smokeMode) await window.loadFile(join(__dirname, "../../ui/dist/index.html")); else if (e2eMode) await window.loadFile(join(__dirname, "../../ui/dist/index.html"), { query: { e2e: "1" } }); else if (process.env.XRAY_DEV_SERVER_URL) await window.loadURL(process.env.XRAY_DEV_SERVER_URL); else if (!app.isPackaged) await window.loadURL("http://localhost:5173"); else await window.loadFile(join(__dirname, "../../ui/dist/index.html"));
}

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  broker = new AnalysisBroker({ databasePath: join(userData, "project-xray.sqlite"), projectDatabaseRoot: join(userData, "projects"), cacheRoot: join(userData, "repositories") }, (event) => { for (const target of BrowserWindow.getAllWindows()) target.webContents.send(IPC_CHANNELS.indexEvent, event); }, (event) => { for (const target of BrowserWindow.getAllWindows()) target.webContents.send(IPC_CHANNELS.comparisonEvent, event); });
  registerIpc(); await createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void broker?.close(); });
