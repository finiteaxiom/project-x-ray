const { Worker } = require("node:worker_threads");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

async function main() {
  const base = await mkdtemp(join(tmpdir(), "xray-worker-smoke-"));
  const project = join(base, "project"); await mkdir(project);
  await writeFile(join(project, "app.ts"), "export function login(token: string){ return token.length > 2 }\n", "utf8");
  await writeFile(join(project, "worker.py"), "def run(value):\n    return value\n", "utf8");
  const git = (...args) => execFileSync("git", args, { cwd: project, stdio: "pipe" }); git("init"); git("config", "user.email", "xray@example.test"); git("config", "user.name", "X-Ray Smoke"); git("add", "."); git("commit", "-m", "base");
  const worker = new Worker(join(__dirname, "../dist/analysis-worker.js"), { workerData: { databasePath: join(base, "legacy.sqlite"), projectDatabaseRoot: join(base, "databases"), cacheRoot: join(base, "cache") } });
  const responses = new Map(); const eventWaiters = [];
  worker.on("message", (message) => {
    if (message.type === "response") { const waiter = responses.get(message.requestId); if (waiter) { responses.delete(message.requestId); message.ok ? waiter.resolve(message.payload) : waiter.reject(new Error(message.error)); } }
    if (message.type === "event" || message.type === "comparison-event") { const index = eventWaiters.findIndex((waiter) => waiter.predicate(message.event)); if (index >= 0) eventWaiters.splice(index, 1)[0].resolve(message.event); }
  });
  const request = (value) => new Promise((resolve, reject) => { responses.set(value.requestId, { resolve, reject }); worker.postMessage(value); });
  const waitEvent = (predicate) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("等待工作线程事件超时")), 20_000); eventWaiters.push({ predicate, resolve: (value) => { clearTimeout(timer); resolve(value); } }); });
  try {
    const completedPromise = waitEvent((event) => event.taskId === "task-one" && event.type === "completed");
    await request({ requestId: "start-one", operation: "start-index", taskId: "task-one", rootPath: project, sourceType: "local" });
    const completed = await completedPromise; assert.equal(completed.overview.health.indexedFiles, 2);
    const ref = { repositoryId: completed.repositoryId, snapshotId: completed.overview.snapshotId };
    const current = await request({ requestId: "state-one", operation: "get-state", ref }); assert.equal(current.status, "current");
    const search = await request({ requestId: "search-one", operation: "search", input: { ...ref, query: "app.ts", kinds: ["file"], limit: 10 } }); const file = search.items[0]; assert.equal(file.filePath, "app.ts");
    const source = await request({ requestId: "source-one", operation: "source", location: { ...ref, ...file.span } }); assert.equal(source.workspaceStatus, "current");
    await writeFile(join(project, "app.ts"), "export function changed(){ return false }\n", "utf8");
    const stale = await request({ requestId: "state-two", operation: "get-state", ref }); assert.equal(stale.status, "stale");

    const cancelledPromise = waitEvent((event) => event.taskId === "task-two" && event.type === "cancelled"); const cancelStarted = performance.now();
    const started = request({ requestId: "start-two", operation: "start-index", taskId: "task-two", rootPath: project, sourceType: "local" });
    worker.postMessage({ requestId: "cancel-two", operation: "cancel-index", taskId: "task-two" }); await started; await cancelledPromise;
    const previous = await request({ requestId: "current", operation: "get-current" }); assert.equal(previous.snapshotId, ref.snapshotId);
    await writeFile(join(project, "app.ts"), "export function changed(){ return true }\n", "utf8"); const compareCancelled = waitEvent((event) => event.taskId === "compare-cancel" && event.type === "cancelled"); const compareCancelStarted = performance.now(); const compareStarted = request({ requestId: "compare-start", operation: "start-comparison", taskId: "compare-cancel", input: { ...ref, mode: "working", maxDepth: 4, maxPaths: 20, maxWork: 2000 } }); worker.postMessage({ requestId: "compare-stop", operation: "cancel-comparison", taskId: "compare-cancel" }); await compareStarted; await compareCancelled;
    process.stdout.write(`worker-smoke: progress, persistence, source, stale, index and comparison cancellation passed ${JSON.stringify({ cancelResponseMs: performance.now() - cancelStarted, comparisonCancelResponseMs: performance.now() - compareCancelStarted })}\n`);
  } finally { await worker.terminate(); await rm(base, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
