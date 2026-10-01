import { parentPort, workerData } from "node:worker_threads";
import { XRayApplication } from "@project-xray/application";
import { TASK_PROTOCOL_VERSION, diagnosticForError, workerRequestSchema, workerResponseSchema, type ComparisonTaskEvent, type IndexTaskEvent, type WorkerRequest, type WorkerResponse } from "@project-xray/contracts";

interface WorkerConfiguration { databasePath: string; projectDatabaseRoot: string; cacheRoot: string }
const port = parentPort;
if (!port) throw new Error("分析工作线程缺少消息端口");
const configuration = workerData as WorkerConfiguration;
const controllers = new Map<string, AbortController>();
const retries = new Map<string, Extract<WorkerRequest, { operation: "start-index" }>>();

const send = (message: WorkerResponse): void => port.postMessage(workerResponseSchema.parse(message));
const event = (value: IndexTaskEvent): void => send({ type: "event", event: value });
const comparisonEvent = (value: ComparisonTaskEvent): void => send({ type: "comparison-event", event: value });
const application = new XRayApplication({
  databasePath: configuration.databasePath,
  projectDatabaseRoot: configuration.projectDatabaseRoot,
  cacheRoot: configuration.cacheRoot,
});

async function start(request: Extract<WorkerRequest, { operation: "start-index" }>): Promise<void> {
  for (const [taskId, controller] of controllers) {
    if (taskId !== request.taskId) controller.abort();
  }
  const controller = new AbortController(); controllers.set(request.taskId, controller); retries.set(request.taskId, request);
  event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: request.taskId, rootPath: request.rootPath, progress: { phase: "queued", completed: 0, total: 0 } });
  try {
    const snapshot = request.sourceType === "git"
      ? await application.importGit({ url: request.rootPath, ...(request.branch ? { branch: request.branch } : {}) }, { signal: controller.signal, onProgress: (progress) => event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: request.taskId, rootPath: request.rootPath, progress }) })
      : await application.indexProject(request.rootPath, "local", { signal: controller.signal, onProgress: (progress) => event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: request.taskId, rootPath: request.rootPath, progress }) });
    event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: request.taskId, rootPath: request.rootPath, repositoryId: snapshot.repositoryId, overview: application.getCurrentProject()! });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId: request.taskId, rootPath: request.rootPath, message: "索引已取消；上一份完整快照保持不变。" });
    else event({ protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId: request.taskId, rootPath: request.rootPath, code: diagnosticForError(error, "TASK_FAILED").code, retryable: true });
  } finally { controllers.delete(request.taskId); }
}

async function startComparison(request: Extract<WorkerRequest, { operation: "start-comparison" }>): Promise<void> {
  const controller = new AbortController(); controllers.set(request.taskId, controller); const repositoryId = request.input.repositoryId;
  try { const report = await application.createChangeReport(request.input, { signal: controller.signal, onProgress: (progress) => comparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "progress", taskId: request.taskId, repositoryId, progress }) }); comparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId: request.taskId, repositoryId, report }); }
  catch (error) { if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) comparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId: request.taskId, repositoryId, message: "变更比较已取消；既有快照和报告保持不变。" }); else comparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId: request.taskId, repositoryId, code: diagnosticForError(error, "GIT_COMPARISON_FAILED").code, retryable: true }); }
  finally { controllers.delete(request.taskId); }
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.operation) {
    case "start-index": retries.set(request.taskId, request); void start(request); return { accepted: true };
    case "cancel-index": controllers.get(request.taskId)?.abort(); return undefined;
    case "retry-index": {
      const prior = retries.get(request.taskId); if (!prior) throw new Error("找不到可重试任务");
      void start({ ...prior, requestId: request.requestId, taskId: request.taskId }); return { accepted: true };
    }
    case "get-ignore-settings": return application.getIgnoreSettings(request.ref);
    case "save-ignore-settings": return application.saveIgnoreSettings(request.input);
    case "get-current": return application.getCurrentProject();
    case "get-state": return application.getSnapshotState(request.ref);
    case "list-modules": return application.listModules(request.input);
    case "module-overview": return application.getModuleOverview(request.input);
    case "expand-module": return application.expandModule(request.input);
    case "module-relation-edges": return application.getModuleRelationEdges(request.input);
    case "search": return application.search(request.input);
    case "query-graph": return application.queryGraph(request.input);
    case "evidence": return application.getEvidence(request.input);
    case "evidence-range": return application.findEvidence(request.input);
    case "get-flow": return application.getFlow(request.ref, request.nodeId, request.depth);
    case "explain": return application.explainFeature(request.ref, request.query);
    case "start-comparison": void startComparison(request); return { accepted: true };
    case "cancel-comparison": controllers.get(request.taskId)?.abort(); return undefined;
    case "load-change-report": return application.loadChangeReport(request.input);
    case "change-report-state": return application.getChangeReportState(request.input);
    case "questions": return (await application.createOwnershipQuestions(request.input)).map(({ evidenceIds: _a, expectedNodeIds: _b, deterministicChecks: _c, ...prompt }) => prompt);
    case "grade": return application.gradeOwnershipAnswer(request.submission);
    case "ownership-progress": return application.getOwnershipProgress(request.ref);
    case "source": return application.readSource(request.location);
  }
}

port.on("message", (raw: unknown) => {
  const parsed = workerRequestSchema.safeParse(raw);
  if (!parsed.success) { const requestId = typeof raw === "object" && raw && "requestId" in raw ? String(raw.requestId) : "invalid"; send({ type: "response", requestId, ok: false, code: "TASK_FAILED" }); return; }
  void handle(parsed.data).then(
    (payload) => send({ type: "response", requestId: parsed.data.requestId, ok: true, payload }),
    (error) => send({ type: "response", requestId: parsed.data.requestId, ok: false, code: diagnosticForError(error, "TASK_FAILED").code }),
  );
});

process.once("exit", () => application.close());
