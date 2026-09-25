import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { totalmem } from "node:os";
import { createRequire } from "node:module";
import { XRayApplication } from "../packages/application/src/index.ts";
import { GRAPH_QUERY_VERSION } from "../packages/contracts/src/index.ts";

const execFile = promisify(execFileCallback);
const Database = createRequire(import.meta.url)("../packages/graph/node_modules/better-sqlite3") as new (path: string, options?: { readonly?: boolean }) => { prepare(sql: string): { all(...args: unknown[]): unknown[] }; close(): void };
const root = resolve(import.meta.dirname, ".."); const work = join(root, ".benchmarks");
const real = { name: "p-map", url: "https://github.com/sindresorhus/p-map.git", sha: "f0c43e358a449584c2045c89d1b9ae3cd5a9f293", license: "MIT" };

async function generateProject(path: string, files: number): Promise<void> {
  await rm(path, { recursive: true, force: true }); await mkdir(join(path, "src"), { recursive: true });
  for (let index = 0; index < files; index += 1) { const targets = index === 0 ? Array.from({ length: Math.min(50, files - 1) }, (_, target) => target + 1) : index + 1 < files ? [index + 1] : []; const imports = targets.map((target) => `import { fn${target} } from './file-${target}';`).join("\n"); const call = targets.length ? `return ${targets.map((target) => `fn${target}(value)`).join(" + ")} + ${index};` : "return value;"; await writeFile(join(path, "src", `file-${index}.ts`), `${imports}\nexport function fn${index}(value: number): number { ${call} }\n`, "utf8"); }
  await writeFile(join(path, "package.json"), JSON.stringify({ name: `xray-benchmark-${files}`, private: true, type: "module" }), "utf8");
}

async function benchChangeImpact(projectPath: string): Promise<Record<string, unknown>> {
  await generateProject(projectPath, 60); await execFile("git", ["init"], { cwd: projectPath }); await execFile("git", ["config", "user.email", "xray@example.test"], { cwd: projectPath }); await execFile("git", ["config", "user.name", "X-Ray Benchmark"], { cwd: projectPath }); await execFile("git", ["add", "."], { cwd: projectPath }); await execFile("git", ["commit", "-m", "baseline"], { cwd: projectPath }); await writeFile(join(projectPath, "src", "file-59.ts"), "export function fn59(value: number): number { return value + 1; }\n", "utf8");
  const state = join(work, "state", "change-impact"); await rm(state, { recursive: true, force: true }); await mkdir(state, { recursive: true }); const app = new XRayApplication({ databasePath: join(state, "legacy.sqlite"), projectDatabaseRoot: join(state, "projects"), cacheRoot: join(state, "cache") }); const snapshot = await app.indexProject(projectPath, "git"); const phaseAt = new Map<string, number>(); const started = performance.now(); const measured = await measure(() => app.createChangeReport({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, mode: "working", maxDepth: 6, maxPaths: 20, maxWork: 5000 }, { onProgress: (progress) => { if (!phaseAt.has(progress.phase)) phaseAt.set(progress.phase, performance.now() - started); } })); const report = measured.value; app.close();
  const cancelState = join(work, "state", "change-impact-cancel"); await rm(cancelState, { recursive: true, force: true }); await mkdir(cancelState, { recursive: true }); const cancelApp = new XRayApplication({ databasePath: join(cancelState, "legacy.sqlite"), projectDatabaseRoot: join(cancelState, "projects"), cacheRoot: join(cancelState, "cache") }); const cancelSnapshot = await cancelApp.indexProject(projectPath, "git"); const controller = new AbortController(); let abortAt = 0; let cancelled = false; try { await cancelApp.createChangeReport({ repositoryId: cancelSnapshot.repositoryId, snapshotId: cancelSnapshot.snapshotId, mode: "working", maxDepth: 6, maxPaths: 20, maxWork: 5000 }, { signal: controller.signal, onProgress: (progress) => { if (progress.phase === "analyzing-left" && !abortAt) { abortAt = performance.now(); controller.abort(); } } }); } catch (error) { cancelled = error instanceof Error && error.name === "AbortError"; } const cancelResponseMs = abortAt ? performance.now() - abortAt : -1; cancelApp.close();
  return { sample: "deterministic-60-file-chain", scale: { files: snapshot.sourceFiles.length, nodesLeft: report.impactPaths[0]?.nodes.length ?? 0, changedFiles: report.files.length, impactPaths: report.impactPaths.length }, totalMs: measured.ms, phaseStartedAtMs: Object.fromEntries(phaseAt), responseBytes: Buffer.byteLength(JSON.stringify(report)), truncated: report.truncated, cancel: { cancelled, responseMs: cancelResponseMs } };
}

async function ensureRealProject(path: string): Promise<void> {
  if (!existsSync(join(path, ".git"))) { await rm(path, { recursive: true, force: true }); await execFile("git", ["clone", "--filter=blob:none", "--no-checkout", real.url, path]); }
  await execFile("git", ["-C", path, "fetch", "--depth", "1", "origin", real.sha]); await execFile("git", ["-C", path, "checkout", "--detach", real.sha]);
}

async function measure<T>(operation: () => Promise<T> | T): Promise<{ value: T; ms: number; rssDeltaMb: number; peakRssMb: number }> {
  const before = process.memoryUsage().rss; let peak = before; const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10); const start = performance.now();
  try { const value = await operation(); return { value, ms: performance.now() - start, rssDeltaMb: (process.memoryUsage().rss - before) / 1024 / 1024, peakRssMb: peak / 1024 / 1024 }; } finally { clearInterval(timer); }
}

async function bench(name: string, projectPath: string): Promise<Record<string, unknown>> {
  const state = join(work, "state", name); await rm(state, { recursive: true, force: true }); await mkdir(state, { recursive: true });
  let app = new XRayApplication({ databasePath: join(state, "legacy.sqlite"), projectDatabaseRoot: join(state, "projects"), cacheRoot: join(state, "cache") });
  const cold = await measure(() => app.indexProject(projectPath)); const snapshot = cold.value; const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId }; app.close();
  const reopenRuns: number[] = []; for (let run = 0; run < 3; run += 1) { const result = await measure(() => { const opened = new XRayApplication({ databasePath: join(state, "legacy.sqlite"), projectDatabaseRoot: join(state, "projects"), cacheRoot: join(state, "cache") }); const current = opened.getCurrentProject(); opened.close(); return current; }); reopenRuns.push(result.ms); }
  app = new XRayApplication({ databasePath: join(state, "legacy.sqlite"), projectDatabaseRoot: join(state, "projects"), cacheRoot: join(state, "cache") });
  const searchRuns: number[] = []; let rootNodeId = ""; const searchTerm = name === "p-map" ? "pMap" : name === "small-gold" ? "login" : "fn0"; for (let run = 0; run < 3; run += 1) { const result = await measure(() => app.search({ ...ref, query: searchTerm, kinds: ["function"], limit: 20 })); searchRuns.push(result.ms); rootNodeId ||= result.value.items[0]?.id ?? ""; }
  const queryRuns: number[] = []; let responseBytes = 0; let queryStats: unknown; for (let run = 0; run < 3 && rootNodeId; run += 1) { const result = await measure(() => app.queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [rootNodeId], view: "call", direction: "outgoing", maxDepth: 3, maxNodes: 120, maxEdges: 240, maxWork: 5000, confidences: ["verified", "inferred", "unknown"] })); queryRuns.push(result.ms); responseBytes = Buffer.byteLength(JSON.stringify(result.value)); queryStats = result.value.stats; }
  const branch = rootNodeId ? await measure(() => app.queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [rootNodeId], view: "call", direction: "both", maxDepth: 8, maxNodes: 10, maxEdges: 10, maxWork: 20, confidences: ["verified", "inferred", "unknown"] })) : undefined;
  app.close(); const database = new Database(join(state, "projects", `${snapshot.repositoryId}.sqlite`), { readonly: true }); const plans = { search: database.prepare("EXPLAIN QUERY PLAN SELECT payload FROM nodes WHERE snapshot_id=? AND kind='function' AND lower(name) LIKE ? ORDER BY lower(qualified_name) LIMIT 20").all(snapshot.snapshotId, `%${searchTerm.toLowerCase()}%`).map((row) => (row as { detail: string }).detail), outgoingEdges: database.prepare("EXPLAIN QUERY PLAN SELECT payload FROM edges WHERE snapshot_id=? AND source_id=? AND kind IN ('HANDLES','CALLS') ORDER BY kind,source_id,target_id,edge_id LIMIT 240").all(snapshot.snapshotId, rootNodeId).map((row) => (row as { detail: string }).detail) }; database.close();
  return { name, projectPath, scale: { files: snapshot.health.indexedFiles, nodes: snapshot.nodes.length, edges: snapshot.edges.length, evidence: snapshot.evidence.length }, coldIndex: { runs: 1, ms: cold.ms, rssDeltaMb: cold.rssDeltaMb, peakProcessRssMb: cold.peakRssMb }, reopen: { runs: 3, ms: reopenRuns }, search: { runs: 3, ms: searchRuns }, query3Hop: { runs: queryRuns.length, ms: queryRuns, stats: queryStats, responseBytes }, highBranchBudget: branch ? { ms: branch.ms, truncated: branch.value.truncated, reasons: branch.value.truncationReasons, stats: branch.value.stats } : null, queryPlans: plans };
}

async function main(): Promise<void> {
  await mkdir(work, { recursive: true }); const small = join(work, "small"); const medium = join(work, "medium"); const large = join(work, "large"); const realPath = join(work, "real-p-map");
  await cp(join(root, "test-fixtures", "e2e-project"), small, { recursive: true, force: true }); await generateProject(medium, 200); await generateProject(large, 800); await ensureRealProject(realPath);
  const samples = []; for (const [name, path] of [["small-gold", small], ["medium-200", medium], ["large-800", large], ["p-map", realPath]] as const) samples.push(await bench(name, path)); const changeImpact = await benchChangeImpact(join(work, "change-impact"));
  const report = { generatedAt: new Date().toISOString(), environment: { platform: process.platform, arch: process.arch, node: process.version, cpu: process.env.PROCESSOR_IDENTIFIER ?? "unknown", logicalProcessors: process.env.NUMBER_OF_PROCESSORS ?? "unknown", memoryMb: Math.round(totalmem() / 1024 / 1024) }, conditions: { coldIndexRuns: 1, hotQueryRuns: 3, importedProjectCommandsExecuted: false, percentileReported: false, memoryNote: "同一 Node 进程顺序运行；peakProcessRssMb 是进程采样峰值，后续样本会受先前堆保留影响。" }, realProject: real, samples, changeImpact };
  await mkdir(join(root, "docs", "benchmarks"), { recursive: true }); await writeFile(join(root, "docs", "benchmarks", "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
