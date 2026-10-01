import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { open, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalSnapshotContent, canonicalSnapshotResult } from "../packages/contracts/src/snapshot-content.ts";
import type { ProjectSnapshot } from "../packages/contracts/src/index.ts";

const PROTOCOL_PREFIX = "XRAY_LOCAL_INDEX_BASELINE:";
const RUNS_DIRECTORY = "project-xray-local-index-baseline-runs";
const SAMPLE_ID = "e2e-project-small-v1";
const MAX_RUNS = 5;
const DEFAULT_RUNS = 1;
const MIN_TIMEOUT_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const CHILD_STOP_GRACE_MS = 1_000;
const MAX_PROTOCOL_LINES = 2_000;
const MAX_PROTOCOL_LINE_LENGTH = 32_768;
const PHASES = new Set(["queued", "discovering", "reading", "analyzing", "verifying", "persisting"]);
const PAIR_GATE_CHECKS = [
  "sourceFilesEqual",
  "canonicalFactsEqual",
  "persistedPayloadEqual",
  "sameSnapshotIdentity",
  "originalCreatedAtPreserved",
  "stableNodeNavigation",
  "stableEvidenceNavigation",
  "stableResolvedSourceNavigation",
] as const;
const REQUIRED_GATE_CHECKS = [
  ...PAIR_GATE_CHECKS,
  "expectedSourceFilesEqual",
  "bothSnapshotsHealthy",
  "navigationResolved",
] as const;
const NAVIGATION_FAILURE_CODES = new Set([
  "SAMPLE_NODE_EVIDENCE_MISSING",
  "SAMPLE_NODE_EVIDENCE_PATH_MISMATCH",
  "SAMPLE_EVIDENCE_FILE_MISSING",
  "SAMPLE_EVIDENCE_LOOKUP_MISMATCH",
  "SAMPLE_SOURCE_NAVIGATION_MISMATCH",
  "SAMPLE_NAVIGATION_READ_FAILED",
]);
const SAMPLE_FILES = new Map([
  ["src/auth.ts", "TypeScript"],
  ["src/validation.ts", "TypeScript"],
  ["worker.py", "Python"],
]);

export interface CliOptions {
  help: boolean;
  runs: number;
  timeoutMs: number;
}

export interface PhaseEvent {
  stage: "cold" | "warm";
  phase: string;
  elapsedMs: number;
  completed: number;
  total: number;
}

export interface SampleFileSummary {
  path: string;
  language: string;
  bytes: number;
  sha256: string;
}

export interface TimingSummary {
  elapsedMs: number;
  rss: {
    source: string;
    intervalMs: number;
    startBytes: number;
    peakSampledBytes: number;
    samples: number;
  };
  phaseEvents: PhaseEvent[];
}

export interface ChildSummary {
  runNumber: number;
  sample: {
    id: string;
    manifestSha256: string;
    files: SampleFileSummary[];
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    architecture: string;
    graphIrVersion: string;
    analyzerVersions: Record<string, string>;
  };
  snapshot: {
    repositoryId: string;
    snapshotId: string;
    originalCreatedAt: string;
    healthStatus: string;
    indexedFiles: number;
    totalFiles: number;
    failedFiles: number;
    nodes: number;
    edges: number;
    evidence: number;
    unknownEdges: number;
    canonicalResultSha256: string;
    persistedContentSha256: string;
  };
  measurements: {
    coldIndex: TimingSummary;
    warmNoopReindex: TimingSummary;
  };
  navigation: {
    nodeCount: number;
    evidenceCount: number;
    resolvedEvidenceCount: number;
    coldSha256: string;
    warmSha256: string;
  };
  gates: {
    passed: boolean;
    checks: Record<string, boolean>;
    failureCodes: string[];
  };
}

export interface ChildTerminal {
  status: "completed" | "failed" | "cancelled";
  code: string;
  summary?: ChildSummary;
}

export interface ControlledChildResult {
  termination: "exited" | "timeout" | "cancelled" | "spawn_failed";
  closed: true;
  forcedTermination: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  terminal?: ChildTerminal;
  progress: PhaseEvent[];
  protocolError?: "CHILD_PROTOCOL_INVALID" | "CHILD_PROTOCOL_LIMIT";
}

export function parseCliArguments(args: string[]): CliOptions {
  if (args.length === 1 && args[0] === "--help") return { help: true, runs: DEFAULT_RUNS, timeoutMs: DEFAULT_TIMEOUT_MS };
  const seen = new Set<string>();
  let runs = DEFAULT_RUNS;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--runs" && flag !== "--timeout-ms") throw new Error("CLI_ARGUMENT_INVALID");
    if (seen.has(flag)) throw new Error("CLI_ARGUMENT_DUPLICATE");
    seen.add(flag);
    const value = args[index + 1];
    if (!value || !/^\d{1,6}$/.test(value)) throw new Error("CLI_ARGUMENT_INVALID");
    index += 1;
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("CLI_ARGUMENT_INVALID");
    if (flag === "--runs") {
      if (number < 1 || number > MAX_RUNS) throw new Error("CLI_RUNS_OUT_OF_RANGE");
      runs = number;
    } else {
      if (number < MIN_TIMEOUT_MS || number > MAX_TIMEOUT_MS) throw new Error("CLI_TIMEOUT_OUT_OF_RANGE");
      timeoutMs = number;
    }
  }
  return { help: false, runs, timeoutMs };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeString(value: unknown, maxLength = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\r\n\0]/.test(value);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectNodeNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.nodes.map(({ id, kind, filePath, span, evidenceId }) => ({ id, kind, ...(filePath ? { filePath } : {}), ...(span ? { span } : {}), ...(evidenceId ? { evidenceId } : {}) }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function projectEvidenceNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.evidence.map(({ id, analyzer, analyzerVersion, kind, confidence, span }) => ({ id, analyzer, analyzerVersion, kind, confidence, span }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

export function compareSnapshotPair(
  cold: ProjectSnapshot,
  warm: ProjectSnapshot,
  coldResolvedNavigationSha256: string,
  warmResolvedNavigationSha256: string,
): { passed: boolean; checks: Record<string, boolean>; failureCodes: string[]; canonicalResultSha256: string; persistedContentSha256: string } {
  const sourceFilesEqual = canonicalJson([...cold.sourceFiles].sort((a, b) => a.filePath.localeCompare(b.filePath))) === canonicalJson([...warm.sourceFiles].sort((a, b) => a.filePath.localeCompare(b.filePath)));
  const canonicalFactsEqual = canonicalSnapshotResult(cold) === canonicalSnapshotResult(warm);
  const persistedPayloadEqual = canonicalSnapshotContent(cold) === canonicalSnapshotContent(warm);
  const sameSnapshotIdentity = cold.repositoryId === warm.repositoryId && cold.snapshotId === warm.snapshotId;
  const originalCreatedAtPreserved = cold.createdAt === warm.createdAt;
  const stableNodeNavigation = canonicalJson(projectNodeNavigation(cold)) === canonicalJson(projectNodeNavigation(warm));
  const stableEvidenceNavigation = canonicalJson(projectEvidenceNavigation(cold)) === canonicalJson(projectEvidenceNavigation(warm));
  const stableResolvedSourceNavigation = coldResolvedNavigationSha256 === warmResolvedNavigationSha256;
  const checks = { sourceFilesEqual, canonicalFactsEqual, persistedPayloadEqual, sameSnapshotIdentity, originalCreatedAtPreserved, stableNodeNavigation, stableEvidenceNavigation, stableResolvedSourceNavigation };
  const failureCodes = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => `PAIR_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toUpperCase()}`);
  return { passed: failureCodes.length === 0, checks, failureCodes, canonicalResultSha256: hash(canonicalSnapshotResult(cold)), persistedContentSha256: hash(canonicalSnapshotContent(cold)) };
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

export interface OwnedRunRoot {
  id: string;
  basePath: string;
  path: string;
}

async function resolveOwnedBasePath(): Promise<string> {
  const requestedBase = join(tmpdir(), RUNS_DIRECTORY);
  await mkdir(requestedBase, { recursive: true });
  const [tempRoot, basePath] = await Promise.all([realpath(tmpdir()), realpath(requestedBase)]);
  if (!isWithin(tempRoot, basePath) || dirname(basePath) !== tempRoot || basename(basePath) !== RUNS_DIRECTORY) throw new Error("OWNED_DIRECTORY_INVALID");
  return basePath;
}

export async function createUniqueRunRoot(): Promise<OwnedRunRoot> {
  const basePath = await resolveOwnedBasePath();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = randomUUID();
    const candidate = join(basePath, id);
    try {
      await mkdir(candidate, { recursive: false });
      const path = await realpath(candidate);
      if (!isWithin(basePath, path)) throw new Error("OWNED_DIRECTORY_INVALID");
      return { id, basePath, path };
    } catch (error) {
      if (record(error) && error.code === "EEXIST") continue;
      throw new Error("RUN_DIRECTORY_CREATE_FAILED");
    }
  }
  throw new Error("RUN_DIRECTORY_COLLISION");
}

export async function createRunDirectory(root: OwnedRunRoot, runNumber: number): Promise<string> {
  if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > MAX_RUNS) throw new Error("RUN_DIRECTORY_INVALID");
  const candidate = join(root.path, `run-${String(runNumber).padStart(2, "0")}`);
  await mkdir(candidate, { recursive: false });
  const path = await realpath(candidate);
  if (!isWithin(root.path, path)) throw new Error("OWNED_DIRECTORY_INVALID");
  return path;
}

async function verifyOwnedRunRoot(root: OwnedRunRoot): Promise<string> {
  const actualRoot = await realpath(root.path);
  const actualBase = await realpath(root.basePath);
  const configuredBase = await resolveOwnedBasePath();
  if (actualRoot !== root.path || actualBase !== configuredBase || !isWithin(actualBase, actualRoot) || dirname(actualRoot) !== actualBase || basename(actualRoot) !== root.id || !/^[0-9a-f-]{36}$/.test(root.id)) throw new Error("OWNED_DIRECTORY_INVALID");
  return actualRoot;
}

async function writeJsonExclusive(reportPath: string, report: unknown): Promise<void> {
  let handle;
  try {
    handle = await open(reportPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if (record(error) && error.code === "EEXIST") throw new Error("REPORT_ALREADY_EXISTS");
    throw new Error("REPORT_WRITE_FAILED");
  } finally {
    await handle?.close();
  }
}

export async function writeReportExclusive(root: OwnedRunRoot, report: unknown): Promise<void> {
  const actualRoot = await verifyOwnedRunRoot(root);
  await writeJsonExclusive(join(actualRoot, "report.json"), report);
}

export async function writeRunReportExclusive(root: OwnedRunRoot, runNumber: number, report: unknown): Promise<void> {
  const actualRoot = await verifyOwnedRunRoot(root);
  if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > MAX_RUNS) throw new Error("RUN_DIRECTORY_INVALID");
  const requestedDirectory = join(actualRoot, `run-${String(runNumber).padStart(2, "0")}`);
  const runDirectory = await realpath(requestedDirectory);
  if (!isWithin(actualRoot, runDirectory) || dirname(runDirectory) !== actualRoot || basename(runDirectory) !== `run-${String(runNumber).padStart(2, "0")}`) throw new Error("OWNED_DIRECTORY_INVALID");
  await writeJsonExclusive(join(runDirectory, "report.json"), report);
}

function parseTiming(value: unknown): TimingSummary | null {
  if (!record(value) || !finiteNonnegative(value.elapsedMs) || !record(value.rss) || !Array.isArray(value.phaseEvents)) return null;
  const rss = value.rss;
  if (rss.source !== "Node child process process.memoryUsage().rss" || rss.intervalMs !== 20 || !finiteNonnegative(rss.startBytes) || !finiteNonnegative(rss.peakSampledBytes) || !finiteNonnegative(rss.samples)) return null;
  const phaseEvents: PhaseEvent[] = [];
  for (const event of value.phaseEvents) {
    if (!record(event) || (event.stage !== "cold" && event.stage !== "warm") || typeof event.phase !== "string" || !PHASES.has(event.phase) || !finiteNonnegative(event.elapsedMs) || !finiteNonnegative(event.completed) || !finiteNonnegative(event.total)) return null;
    phaseEvents.push({ stage: event.stage, phase: event.phase, elapsedMs: event.elapsedMs, completed: event.completed, total: event.total });
  }
  return { elapsedMs: value.elapsedMs, rss: { source: rss.source, intervalMs: rss.intervalMs, startBytes: rss.startBytes, peakSampledBytes: rss.peakSampledBytes, samples: rss.samples }, phaseEvents };
}

function parseGateResults(value: unknown): ChildSummary["gates"] | null {
  if (!record(value) || typeof value.passed !== "boolean" || !record(value.checks) || !Array.isArray(value.failureCodes)) return null;
  const checkNames = Object.keys(value.checks);
  if (checkNames.length !== REQUIRED_GATE_CHECKS.length || REQUIRED_GATE_CHECKS.some((name) => !Object.hasOwn(value.checks, name))) return null;
  const checks: Record<string, boolean> = {};
  for (const name of REQUIRED_GATE_CHECKS) {
    const passed = value.checks[name];
    if (typeof passed !== "boolean") return null;
    checks[name] = passed;
  }

  const failureCodes: string[] = [];
  for (const item of value.failureCodes) {
    if (typeof item !== "string" || !/^PAIR_[A-Z_]{1,100}$|^SAMPLE_[A-Z_]{1,100}$/.test(item)) return null;
    failureCodes.push(item);
  }
  if (new Set(failureCodes).size !== failureCodes.length) return null;

  const expectedFailures = new Set<string>();
  for (const name of PAIR_GATE_CHECKS) {
    if (!checks[name]) expectedFailures.add(`PAIR_${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toUpperCase()}`);
  }
  if (!checks.expectedSourceFilesEqual) expectedFailures.add("SAMPLE_SOURCE_MANIFEST_MISMATCH");
  if (!checks.bothSnapshotsHealthy) expectedFailures.add("SAMPLE_HEALTH_NOT_READY");
  if (!checks.navigationResolved) expectedFailures.add("SAMPLE_NAVIGATION_INCOMPLETE");

  const actualFailures = new Set(failureCodes);
  for (const expected of expectedFailures) if (!actualFailures.has(expected)) return null;
  for (const actual of actualFailures) {
    if (expectedFailures.has(actual)) continue;
    if (checks.navigationResolved || !NAVIGATION_FAILURE_CODES.has(actual)) return null;
  }
  const passed = expectedFailures.size === 0 && failureCodes.length === 0;
  if (value.passed !== passed) return null;
  return { passed, checks, failureCodes };
}

function parseChildSummary(value: unknown): ChildSummary | null {
  if (!record(value) || !Number.isInteger(value.runNumber) || (value.runNumber as number) < 1 || (value.runNumber as number) > MAX_RUNS) return null;
  if (!record(value.sample) || value.sample.id !== SAMPLE_ID || !safeString(value.sample.manifestSha256, 64) || !/^[0-9a-f]{64}$/.test(value.sample.manifestSha256) || !Array.isArray(value.sample.files)) return null;
  const files: SampleFileSummary[] = [];
  for (const item of value.sample.files) {
    if (!record(item) || typeof item.path !== "string" || !SAMPLE_FILES.has(item.path) || typeof item.language !== "string" || SAMPLE_FILES.get(item.path) !== item.language || !finiteNonnegative(item.bytes) || !Number.isSafeInteger(item.bytes) || !safeString(item.sha256, 64) || !/^[0-9a-f]{64}$/.test(item.sha256)) return null;
    files.push({ path: item.path, language: item.language, bytes: item.bytes, sha256: item.sha256 });
  }
  if (files.length !== SAMPLE_FILES.size) return null;
  if (!record(value.runtime) || !safeString(value.runtime.nodeVersion, 80) || !safeString(value.runtime.platform, 40) || !safeString(value.runtime.architecture, 40) || !safeString(value.runtime.graphIrVersion, 40) || !record(value.runtime.analyzerVersions)) return null;
  const analyzerVersions: Record<string, string> = {};
  for (const [name, version] of Object.entries(value.runtime.analyzerVersions)) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || !safeString(version, 100) || /[\\/]/.test(version)) return null;
    analyzerVersions[name] = version;
  }
  if (!record(value.snapshot)) return null;
  const snapshot = value.snapshot;
  const digestFields = [snapshot.canonicalResultSha256, snapshot.persistedContentSha256];
  if (!safeString(snapshot.repositoryId, 80) || !safeString(snapshot.snapshotId, 80) || !safeString(snapshot.originalCreatedAt, 80) || !safeString(snapshot.healthStatus, 20) || digestFields.some((item) => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item))) return null;
  const countFields = [snapshot.indexedFiles, snapshot.totalFiles, snapshot.failedFiles, snapshot.nodes, snapshot.edges, snapshot.evidence, snapshot.unknownEdges];
  if (countFields.some((item) => !finiteNonnegative(item) || !Number.isSafeInteger(item))) return null;
  if (!record(value.measurements)) return null;
  const coldIndex = parseTiming(value.measurements.coldIndex);
  const warmNoopReindex = parseTiming(value.measurements.warmNoopReindex);
  if (!coldIndex || !warmNoopReindex) return null;
  if (!record(value.navigation) || !Number.isSafeInteger(value.navigation.nodeCount) || !Number.isSafeInteger(value.navigation.evidenceCount) || !Number.isSafeInteger(value.navigation.resolvedEvidenceCount) || !safeString(value.navigation.coldSha256, 64) || !/^[0-9a-f]{64}$/.test(value.navigation.coldSha256) || !safeString(value.navigation.warmSha256, 64) || !/^[0-9a-f]{64}$/.test(value.navigation.warmSha256)) return null;
  const gates = parseGateResults(value.gates);
  if (!gates) return null;
  const filesSorted = files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    runNumber: value.runNumber as number,
    sample: { id: SAMPLE_ID, manifestSha256: value.sample.manifestSha256, files: filesSorted },
    runtime: { nodeVersion: value.runtime.nodeVersion, platform: value.runtime.platform, architecture: value.runtime.architecture, graphIrVersion: value.runtime.graphIrVersion, analyzerVersions },
    snapshot: {
      repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, originalCreatedAt: snapshot.originalCreatedAt, healthStatus: snapshot.healthStatus,
      indexedFiles: snapshot.indexedFiles as number, totalFiles: snapshot.totalFiles as number, failedFiles: snapshot.failedFiles as number,
      nodes: snapshot.nodes as number, edges: snapshot.edges as number, evidence: snapshot.evidence as number, unknownEdges: snapshot.unknownEdges as number,
      canonicalResultSha256: snapshot.canonicalResultSha256 as string, persistedContentSha256: snapshot.persistedContentSha256 as string,
    },
    measurements: { coldIndex, warmNoopReindex },
    navigation: {
      nodeCount: value.navigation.nodeCount as number, evidenceCount: value.navigation.evidenceCount as number, resolvedEvidenceCount: value.navigation.resolvedEvidenceCount as number,
      coldSha256: value.navigation.coldSha256, warmSha256: value.navigation.warmSha256,
    },
    gates,
  };
}

function parseProtocolLine(line: string): { terminal?: ChildTerminal; progress?: PhaseEvent } | "invalid" | null {
  if (!line.startsWith(PROTOCOL_PREFIX)) return null;
  let value: unknown;
  try { value = JSON.parse(line.slice(PROTOCOL_PREFIX.length)); } catch { return "invalid"; }
  if (!record(value)) return "invalid";
  if (value.type === "progress") {
    if ((value.stage !== "cold" && value.stage !== "warm") || typeof value.phase !== "string" || !PHASES.has(value.phase) || !finiteNonnegative(value.elapsedMs) || !finiteNonnegative(value.completed) || !finiteNonnegative(value.total)) return "invalid";
    return { progress: { stage: value.stage, phase: value.phase, elapsedMs: value.elapsedMs, completed: value.completed, total: value.total } };
  }
  if (value.type === "terminal") {
    if (value.status !== "completed" && value.status !== "failed" && value.status !== "cancelled") return "invalid";
    if (!safeString(value.code, 80) || !/^[A-Z0-9_]+$/.test(value.code)) return "invalid";
    const summary = value.summary === undefined ? undefined : parseChildSummary(value.summary);
    if (value.summary !== undefined && !summary) return "invalid";
    if (value.status === "completed" && (value.code !== "OK" || !summary?.gates.passed)) return "invalid";
    if (value.status === "failed" && (value.code === "OK" || (summary && (summary.gates.passed || value.code !== "EQUIVALENCE_GATE_FAILED")) || (!summary && value.code === "EQUIVALENCE_GATE_FAILED"))) return "invalid";
    if (value.status === "cancelled" && (value.code !== "CANCELLED" || summary)) return "invalid";
    return { terminal: { status: value.status, code: value.code, ...(summary ? { summary } : {}) } };
  }
  return "invalid";
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "PATHEXT"]) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  return environment;
}

function waitForClose(child: ChildProcess): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolveClose) => {
    child.on("error", () => undefined);
    child.once("close", (exitCode, signal) => resolveClose({ exitCode, signal }));
  });
}

function closeWithin(closePromise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolveResult(false);
    }, timeoutMs);
    void closePromise.then(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveResult(true);
    });
  });
}

async function waitForAuxiliaryProcess(child: ChildProcess, timeoutMs: number): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  const closed = waitForClose(child);
  if (!await closeWithin(closed, timeoutMs)) child.kill("SIGKILL");
  return await closed;
}

async function terminateOwnedProcessTree(child: ChildProcess, closePromise: Promise<unknown>): Promise<void> {
  if (!child.pid) {
    child.kill("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const taskkill = windowsRoot ? join(windowsRoot, "System32", "taskkill.exe") : "taskkill.exe";
    let killer: ChildProcess | undefined;
    try {
      killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, env: safeChildEnvironment() });
      const result = await waitForAuxiliaryProcess(killer, 2_000);
      if (result.exitCode !== 0 && !await closeWithin(closePromise, 500)) child.kill("SIGKILL");
    } catch {
      killer?.kill("SIGKILL");
      if (killer) await waitForAuxiliaryProcess(killer, 2_000).catch(() => undefined);
      child.kill("SIGKILL");
    }
    if (!await closeWithin(closePromise, 500)) child.kill("SIGKILL");
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  if (!await closeWithin(closePromise, 500)) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

export async function runControlledChild(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal; protocol?: boolean; onProgress?: (event: PhaseEvent) => void },
): Promise<ControlledChildResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS) throw new Error("CHILD_TIMEOUT_INVALID");
  if (options.signal?.aborted) return { termination: "cancelled", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: 0, progress: [] };
  const startedAt = performance.now();
  let child: ChildProcess;
  try {
    child = spawn(command, args, { cwd: options.cwd, env: safeChildEnvironment(), detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  } catch {
    return { termination: "spawn_failed", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: performance.now() - startedAt, progress: [] };
  }
  const closePromise = waitForClose(child);
  const progress: PhaseEvent[] = [];
  let terminal: ChildTerminal | undefined;
  let protocolError: ControlledChildResult["protocolError"];
  let protocolLines = 0;
  let terminalSeen = false;
  if (options.protocol && child.stdout) {
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (!line.startsWith(PROTOCOL_PREFIX)) return;
      protocolLines += 1;
      if (protocolLines > MAX_PROTOCOL_LINES || line.length > MAX_PROTOCOL_LINE_LENGTH) {
        protocolError = "CHILD_PROTOCOL_LIMIT";
        return;
      }
      const message = parseProtocolLine(line);
      if (!message || message === "invalid") {
        protocolError = "CHILD_PROTOCOL_INVALID";
        return;
      }
      if (message.progress) progress.push(message.progress);
      if (message.progress) {
        try { options.onProgress?.(message.progress); }
        catch { protocolError = "CHILD_PROTOCOL_INVALID"; }
      }
      if (message.terminal) {
        if (terminalSeen) protocolError = "CHILD_PROTOCOL_INVALID";
        else { terminal = message.terminal; terminalSeen = true; }
      }
    });
  }

  let stopReason: "timeout" | "cancelled" | undefined;
  let forcedTermination = false;
  let stopTask: Promise<void> | undefined;
  const requestStop = (reason: "timeout" | "cancelled"): Promise<void> => {
    if (stopTask) return stopTask;
    stopReason = reason;
    try { child.stdin?.write(`${JSON.stringify({ type: "cancel" })}\n`); } catch { /* bounded force-stop below */ }
    stopTask = (async () => {
      if (await closeWithin(closePromise, CHILD_STOP_GRACE_MS)) return;
      forcedTermination = true;
      await terminateOwnedProcessTree(child, closePromise);
      await closePromise;
    })();
    return stopTask;
  };
  const timer = setTimeout(() => { void requestStop("timeout"); }, options.timeoutMs);
  const onAbort = (): void => { void requestStop("cancelled"); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const closed = await closePromise;
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);
  if (stopTask) await stopTask;
  return {
    termination: stopReason ?? (child.spawnargs.length && child.pid ? "exited" : "spawn_failed"),
    closed: true,
    forcedTermination,
    exitCode: closed.exitCode,
    signal: closed.signal,
    durationMs: Math.max(0, performance.now() - startedAt),
    ...(terminal ? { terminal } : {}),
    progress,
    ...(protocolError ? { protocolError } : {}),
  };
}

export function isCompletedChildRun(run: ControlledChildResult): boolean {
  return run.termination === "exited"
    && run.exitCode === 0
    && !run.forcedTermination
    && !run.protocolError
    && run.terminal?.status === "completed"
    && run.terminal.code === "OK"
    && run.terminal.summary?.gates.passed === true
    && run.terminal.summary.gates.failureCodes.length === 0;
}

export interface BaselineReport {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  requestedRuns: number;
  timeoutMs: number;
  validPairCount: number;
  environment: Record<string, string>;
  runs: Array<Record<string, unknown>>;
  limitations: string[];
}

export async function runBaseline(options: CliOptions, signal?: AbortSignal): Promise<{ root: OwnedRunRoot; report: BaselineReport }> {
  if (options.help || options.runs < 1 || options.runs > MAX_RUNS || options.timeoutMs < MIN_TIMEOUT_MS || options.timeoutMs > MAX_TIMEOUT_MS) throw new Error("CLI_OPTIONS_INVALID");
  const root = await createUniqueRunRoot();
  const deadline = Date.now() + options.timeoutMs;
  const runs: Array<Record<string, unknown>> = [];
  let status: BaselineReport["status"] = "completed";
  for (let runNumber = 1; runNumber <= options.runs; runNumber += 1) {
    if (signal?.aborted) {
      status = "cancelled";
      runs.push({ runNumber, status: "not_started", code: "CANCELLED_BEFORE_START" });
      break;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      status = "timed_out";
      runs.push({ runNumber, status: "not_started", code: "TOTAL_TIMEOUT" });
      break;
    }
    let runDirectory: string;
    try { runDirectory = await createRunDirectory(root, runNumber); }
    catch {
      status = "failed";
      runs.push({ runNumber, status: "failed", code: "RUN_DIRECTORY_CREATE_FAILED", closed: true });
      break;
    }
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const childPath = join(repoRoot, "benchmarks", "local-index-baseline-child.ts");
    const run = await runControlledChild(process.execPath, ["--import", "tsx", childPath, "--run-id", root.id, "--run-number", String(runNumber)], {
      cwd: repoRoot,
      timeoutMs: Math.min(remainingMs, MAX_TIMEOUT_MS),
      signal,
      protocol: true,
    });
    const childStatus = run.termination === "timeout" ? "timed_out"
      : run.termination === "cancelled" ? "cancelled"
        : run.termination === "spawn_failed" ? "failed"
          : isCompletedChildRun(run) ? "completed" : "failed";
    const code = run.termination === "timeout" ? "TOTAL_TIMEOUT"
      : run.termination === "cancelled" ? "CANCELLED"
        : run.termination === "spawn_failed" ? "CHILD_SPAWN_FAILED"
          : run.protocolError ?? run.terminal?.code ?? (run.exitCode === 0 ? "CHILD_TERMINAL_MISSING" : "CHILD_EXIT_FAILED");
    const runRecord = { runNumber, status: childStatus, code, exitCode: run.exitCode, signal: run.signal, childClosed: run.closed, forcedTermination: run.forcedTermination, durationMs: Number(run.durationMs.toFixed(3)), reportFile: `run-${String(runNumber).padStart(2, "0")}/report.json`, progress: run.progress, ...(run.terminal?.summary ? { summary: run.terminal.summary } : {}) };
    try { await writeRunReportExclusive(root, runNumber, { schemaVersion: 1, runId: root.id, ...runRecord }); }
    catch {
      status = "failed";
      runs.push({ runNumber, status: "failed", code: "RUN_REPORT_WRITE_FAILED", exitCode: run.exitCode, signal: run.signal, childClosed: run.closed, durationMs: Number(run.durationMs.toFixed(3)) });
      break;
    }
    runs.push(runRecord);
    if (childStatus !== "completed") {
      status = childStatus;
      break;
    }
  }
  const validPairCount = runs.filter((item) => item.status === "completed").length;
  if (status === "completed" && validPairCount !== options.runs) status = "failed";
  const report: BaselineReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: root.id,
    status,
    requestedRuns: options.runs,
    timeoutMs: options.timeoutMs,
    validPairCount,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      operatingSystemBuild: "not_collected",
      cpuModelAndLoad: "not_collected",
      physicalMemory: "not_collected",
      storageMedium: "not_collected",
      pythonRuntimeVersion: "not_collected",
      gitVersion: "not_collected",
      pnpmVersion: "not_collected",
      electronVersion: "not_applicable_application_api_only",
    },
    runs,
    limitations: [
      "Fixed three-file mixed TypeScript/Python sample only; no scale or broad-project inference.",
      "Direct XRayApplication.indexProject API; not an Electron or desktop-worker measurement.",
      "RSS samples cover only this Node indexing child process and exclude Python subprocess RSS.",
      "No operating-system build, hardware load, storage type, or external tool versions were collected.",
      "Sampled phase timings are timestamps of public IndexProgress events; no private analyzer subphase timing is inferred.",
    ],
  };
  await writeReportExclusive(root, report);
  return { root, report };
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked).toLocaleLowerCase() === fileURLToPath(import.meta.url).toLocaleLowerCase();
}

async function main(): Promise<void> {
  let options: CliOptions;
  try { options = parseCliArguments(process.argv.slice(2)); }
  catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "CLI_ARGUMENT_INVALID";
    process.stderr.write(`${code}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write("Usage: pnpm exec tsx benchmarks/local-index-baseline.ts [--runs 1..5] [--timeout-ms 5000..180000]\n");
    return;
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    const { root, report } = await runBaseline(options, controller.signal);
    process.stdout.write(`${JSON.stringify({ runId: root.id, report: "report.json", status: report.status, validPairCount: report.validPairCount, requestedRuns: report.requestedRuns })}\n`);
    process.exitCode = report.status === "completed" ? 0 : report.status === "cancelled" ? 130 : 1;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "BASELINE_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

if (isMainModule()) void main();
