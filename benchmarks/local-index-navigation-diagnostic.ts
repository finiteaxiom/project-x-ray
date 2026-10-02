import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRunDirectory, createUniqueRunRoot, writeReportExclusive, writeRunReportExclusive, type OwnedRunRoot } from "./local-index-baseline.ts";
import { getBaselineSample, MEDIUM_GENERATOR_VERSION, MEDIUM_SAMPLE_ID } from "./local-index-baseline-samples.ts";

export const NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX = "XRAY_NAVIGATION_DIAGNOSTIC:";
export const NAVIGATION_DIAGNOSTIC_MAX_PAIRS = 3;
export const NAVIGATION_DIAGNOSTIC_DEFAULT_PAIRS = 1;
export const NAVIGATION_DIAGNOSTIC_MAX_TIMEOUT_MS = 180_000;
export const NAVIGATION_DIAGNOSTIC_DEFAULT_TIMEOUT_MS = 180_000;
export const NAVIGATION_DIAGNOSTIC_MIN_TIMEOUT_MS = 5_000;
export const NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES = 256 * 1_024;
export const NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES = 64 * 1_024;
export const NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINES = 2_048;
export const NAVIGATION_DIAGNOSTIC_STOP_GRACE_MS = 1_000;
export const NAVIGATION_DIAGNOSTIC_MAX_STOP_GRACE_MS = 2_000;
export const NAVIGATION_DIAGNOSTIC_CHILD_SHUTDOWN_RESERVE_MS = 4_000;
export const NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE = 2_000;

const BUCKET_LIMITS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000] as const;
const PROGRESS_PHASES = ["queued", "discovering", "reading", "analyzing", "verifying", "persisting"] as const;
const REQUIRED_GATE_CHECKS = [
  "sourceFilesEqual",
  "canonicalFactsEqual",
  "persistedPayloadEqual",
  "sameSnapshotIdentity",
  "originalCreatedAtPreserved",
  "stableNodeNavigation",
  "stableEvidenceNavigation",
  "stableResolvedSourceNavigation",
  "expectedSourceFilesEqual",
  "bothSnapshotsHealthy",
  "navigationResolved",
] as const;
const SAFE_CODES = new Set([
  "OK",
  "EQUIVALENCE_GATE_FAILED",
  "CANCELLED",
  "CANCELLED_BEFORE_START",
  "TOTAL_TIMEOUT",
  "CHILD_ARGUMENT_INVALID",
  "OWNED_DIRECTORY_INVALID",
  "SAMPLE_GENERATOR_MANIFEST_INVALID",
  "SAMPLE_SOURCE_MANIFEST_MISMATCH",
  "SAMPLE_SIZE_OUT_OF_RANGE",
  "SAMPLE_PATH_INVALID",
  "SAMPLE_EVIDENCE_COUNT_MISMATCH",
  "SAMPLE_TOOL_LIMIT_EXCEEDED",
  "METRIC_LIMIT_EXCEEDED",
  "APPLICATION_CLOSE_FAILED",
  "DIAGNOSTIC_OPERATION_FAILED",
  "REPORT_SIZE_LIMIT",
  "REPORT_WRITE_FAILED",
  "RUN_DIRECTORY_CREATE_FAILED",
  "PREVIOUS_PAIR_FAILED",
  "CHILD_PROTOCOL_INVALID",
  "CHILD_PROTOCOL_LIMIT",
  "CHILD_TERMINAL_MISSING",
]);
const PAIR_FAILURE_CODES = REQUIRED_GATE_CHECKS.slice(0, 8).map((name) => "PAIR_" + name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()).toUpperCase());
const SAMPLE_FAILURE_CODES = [
  "SAMPLE_SOURCE_MANIFEST_MISMATCH",
  "SAMPLE_HEALTH_NOT_READY",
  "SAMPLE_NAVIGATION_INCOMPLETE",
  "SAMPLE_NODE_EVIDENCE_MISSING",
  "SAMPLE_NODE_EVIDENCE_PATH_MISMATCH",
  "SAMPLE_EVIDENCE_FILE_MISSING",
  "SAMPLE_EVIDENCE_LOOKUP_MISMATCH",
  "SAMPLE_SOURCE_NAVIGATION_MISMATCH",
  "SAMPLE_NAVIGATION_READ_FAILED",
  "SAMPLE_EVIDENCE_COUNT_MISMATCH",
  "SAMPLE_TOOL_LIMIT_EXCEEDED",
] as const;

export interface NavigationDiagnosticOptions {
  help: boolean;
  pairs: number;
  timeoutMs: number;
}

export interface MetricSummary {
  count: number;
  totalMs: number;
  minMs: number | null;
  maxMs: number | null;
  buckets: number[];
}

export type DiagnosticStage = "setup" | "coldIndex" | "warmIndex" | "secureReadReplay" | "gateEvaluation" | "appClose";
export type DiagnosticPhase = "setup" | "coldIndex" | "coldNavigation" | "warmIndex" | "warmNavigation" | "secureReadReplay" | "gateEvaluation" | "appClose";
export type DiagnosticApi = "getEvidence" | "readSource";
export type DiagnosticStoreMethod = "loadSnapshot" | "getEvidence" | "readSnapshotSource" | "loadIgnoreSettings";
export type DiagnosticStoreSource = "indexProject" | "getEvidence" | "readSource";

export interface NavigationPhaseSummary {
  wall: MetricSummary;
  nodeEvidenceCheck: MetricSummary;
  evidenceLoop: MetricSummary;
  canonicalizeAndHash: MetricSummary;
  counts: {
    nodesChecked: number;
    evidenceExpected: number;
    evidenceAttempted: number;
    getEvidenceCalls: number;
    readSourceCalls: number;
    resolvedEvidence: number;
    errors: number;
  };
  api: Record<DiagnosticApi, MetricSummary>;
}

export interface NavigationDiagnosticSummary {
  schemaVersion: 1;
  sample: { id: typeof MEDIUM_SAMPLE_ID; generatorVersion: typeof MEDIUM_GENERATOR_VERSION; fileCount: number; totalBytes: number; evidenceExpected: 1_177 };
  runtime: { nodeVersion: string; platform: string; architecture: string };
  snapshot: { healthStatus: string; files: number; nodes: number; edges: number; evidence: number; unknownEdges: number };
  stages: Record<DiagnosticStage, MetricSummary>;
  navigation: { cold: NavigationPhaseSummary; warm: NavigationPhaseSummary };
  storage: Record<DiagnosticPhase, Record<DiagnosticStoreSource, Record<DiagnosticStoreMethod, MetricSummary>>>;
  secureReadReplay: { calls: MetricSummary; bytesRead: number };
  progress: Record<"cold" | "warm", Record<(typeof PROGRESS_PHASES)[number], DiagnosticProgressSummary>>;
  gates: { passed: boolean; checks: Record<(typeof REQUIRED_GATE_CHECKS)[number], boolean>; failureCodes: string[] };
}

export interface DiagnosticProgressSummary {
  events: number;
  firstElapsedMs: number | null;
  lastElapsedMs: number | null;
  lastCompleted: number;
  total: number;
}

export interface DiagnosticChildProgress {
  type: "progress";
  stage: "cold" | "warm";
  phase: (typeof PROGRESS_PHASES)[number];
  elapsedMs: number;
  completed: number;
  total: number;
}

export interface DiagnosticChildTerminal {
  type: "terminal";
  status: "completed" | "failed" | "cancelled";
  code: string;
  summary?: NavigationDiagnosticSummary;
}

export type DiagnosticChildMessage = { progress: DiagnosticChildProgress } | { terminal: DiagnosticChildTerminal };

export interface ControlledDiagnosticChildResult {
  termination: "exited" | "timeout" | "cancelled" | "protocol_error" | "spawn_failed";
  closed: true;
  forcedTermination: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  terminal?: DiagnosticChildTerminal;
  progressCounts: Record<"cold" | "warm", Record<(typeof PROGRESS_PHASES)[number], number>>;
  protocolError?: "CHILD_PROTOCOL_INVALID" | "CHILD_PROTOCOL_LIMIT" | "CHILD_TERMINAL_MISSING";
}

export interface DiagnosticRunReport {
  runNumber: number;
  status: "completed" | "failed" | "cancelled" | "timed_out" | "not_started";
  code: string;
  termination: ControlledDiagnosticChildResult["termination"] | "not_started";
  exitCode: number | null;
  signal: string | null;
  childClosed: boolean;
  forcedTermination: boolean;
  durationMs: number;
  reportWriteMs?: number;
  progressCounts: ControlledDiagnosticChildResult["progressCounts"];
  summary?: NavigationDiagnosticSummary;
  protocolError?: ControlledDiagnosticChildResult["protocolError"];
}

export interface NavigationDiagnosticReport {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  requestedPairs: number;
  timeoutMs: number;
  validPairCount: number;
  environment: { nodeVersion: string; platform: string; architecture: string };
  sample: { id: typeof MEDIUM_SAMPLE_ID; generatorVersion: typeof MEDIUM_GENERATOR_VERSION; fileCount: number; totalBytes: number };
  runs: DiagnosticRunReport[];
  limitations: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\r\n\0]/.test(value);
}

function emptyProgressCounts(): ControlledDiagnosticChildResult["progressCounts"] {
  const emptyStage = (): Record<(typeof PROGRESS_PHASES)[number], number> => ({
    queued: 0,
    discovering: 0,
    reading: 0,
    analyzing: 0,
    verifying: 0,
    persisting: 0,
  });
  return { cold: emptyStage(), warm: emptyStage() };
}

export function createMetricSummary(): MetricSummary {
  return { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: Array.from({ length: BUCKET_LIMITS.length + 1 }, () => 0) };
}

export function recordMetric(summary: MetricSummary, elapsedMs: number): void {
  if (!finiteNonnegative(elapsedMs) || summary.count >= 200_000) throw new Error("METRIC_LIMIT_EXCEEDED");
  summary.count += 1;
  summary.totalMs += elapsedMs;
  summary.minMs = summary.minMs === null ? elapsedMs : Math.min(summary.minMs, elapsedMs);
  summary.maxMs = summary.maxMs === null ? elapsedMs : Math.max(summary.maxMs, elapsedMs);
  const bucket = BUCKET_LIMITS.findIndex((limit) => elapsedMs < limit);
  const bucketIndex = bucket < 0 ? BUCKET_LIMITS.length : bucket;
  summary.buckets[bucketIndex] = (summary.buckets[bucketIndex] ?? 0) + 1;
}

export function patchPropertyWithRestore(target: object, property: PropertyKey, replacement: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, property);
  if (original && original.configurable === false && (!("value" in original) || original.writable === false)) throw new Error("METHOD_PATCH_UNAVAILABLE");
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: original?.enumerable ?? false,
    writable: true,
    value: replacement,
  });
  return () => {
    if (original) Object.defineProperty(target, property, original);
    else if (!Reflect.deleteProperty(target, property)) throw new Error("METHOD_RESTORE_FAILED");
  };
}

export function parseNavigationDiagnosticArguments(args: readonly string[]): NavigationDiagnosticOptions {
  if (args.length === 1 && args[0] === "--help") return { help: true, pairs: NAVIGATION_DIAGNOSTIC_DEFAULT_PAIRS, timeoutMs: NAVIGATION_DIAGNOSTIC_DEFAULT_TIMEOUT_MS };
  let pairs = NAVIGATION_DIAGNOSTIC_DEFAULT_PAIRS;
  let timeoutMs = NAVIGATION_DIAGNOSTIC_DEFAULT_TIMEOUT_MS;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--pairs" && flag !== "--timeout-ms") throw new Error("CLI_ARGUMENT_INVALID");
    if (seen.has(flag)) throw new Error("CLI_ARGUMENT_DUPLICATE");
    seen.add(flag);
    const value = args[index + 1];
    if (!value || !/^\d{1,6}$/.test(value)) throw new Error("CLI_ARGUMENT_INVALID");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("CLI_ARGUMENT_INVALID");
    if (flag === "--pairs") {
      if (parsed < 1 || parsed > NAVIGATION_DIAGNOSTIC_MAX_PAIRS) throw new Error("CLI_PAIRS_OUT_OF_RANGE");
      pairs = parsed;
    } else {
      if (parsed < NAVIGATION_DIAGNOSTIC_MIN_TIMEOUT_MS || parsed > NAVIGATION_DIAGNOSTIC_MAX_TIMEOUT_MS) throw new Error("CLI_TIMEOUT_OUT_OF_RANGE");
      timeoutMs = parsed;
    }
    index += 1;
  }
  return { help: false, pairs, timeoutMs };
}

function isMetricSummary(value: unknown): value is MetricSummary {
  if (!isRecord(value) || !hasExactKeys(value, ["count", "totalMs", "minMs", "maxMs", "buckets"])) return false;
  if (!Number.isSafeInteger(value.count) || (value.count as number) < 0 || (value.count as number) > 200_000 || !finiteNonnegative(value.totalMs)) return false;
  if (!(value.minMs === null || finiteNonnegative(value.minMs)) || !(value.maxMs === null || finiteNonnegative(value.maxMs))) return false;
  if (!Array.isArray(value.buckets) || value.buckets.length !== BUCKET_LIMITS.length + 1 || value.buckets.some((count) => !Number.isSafeInteger(count) || count < 0)) return false;
  if (value.buckets.reduce((sum: number, count) => sum + (count as number), 0) !== value.count) return false;
  if (value.count === 0) return value.minMs === null && value.maxMs === null && value.totalMs === 0;
  return finiteNonnegative(value.minMs) && finiteNonnegative(value.maxMs) && (value.minMs as number) <= (value.maxMs as number);
}

function validateNavigationPhase(value: unknown): value is NavigationPhaseSummary {
  if (!isRecord(value) || !hasExactKeys(value, ["wall", "nodeEvidenceCheck", "evidenceLoop", "canonicalizeAndHash", "counts", "api"])) return false;
  if (![value.wall, value.nodeEvidenceCheck, value.evidenceLoop, value.canonicalizeAndHash].every(isMetricSummary)) return false;
  if (!isRecord(value.counts) || !hasExactKeys(value.counts, ["nodesChecked", "evidenceExpected", "evidenceAttempted", "getEvidenceCalls", "readSourceCalls", "resolvedEvidence", "errors"])) return false;
  if (Object.values(value.counts).some((count) => !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE * 2)) return false;
  if (!isRecord(value.api) || !hasExactKeys(value.api, ["getEvidence", "readSource"]) || !isMetricSummary(value.api.getEvidence) || !isMetricSummary(value.api.readSource)) return false;
  return value.counts.getEvidenceCalls === value.api.getEvidence.count && value.counts.readSourceCalls === value.api.readSource.count;
}

function validateStoreMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const phaseNames: readonly DiagnosticPhase[] = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"];
  const sourceNames: readonly DiagnosticStoreSource[] = ["indexProject", "getEvidence", "readSource"];
  const methodNames: readonly DiagnosticStoreMethod[] = ["loadSnapshot", "getEvidence", "readSnapshotSource", "loadIgnoreSettings"];
  if (!hasExactKeys(value, phaseNames)) return false;
  return phaseNames.every((phase) => {
    const sources = value[phase];
    if (!isRecord(sources) || !hasExactKeys(sources, sourceNames)) return false;
    return sourceNames.every((source) => {
      const methods = sources[source];
      return isRecord(methods) && hasExactKeys(methods, methodNames) && methodNames.every((method) => isMetricSummary(methods[method]));
    });
  });
}

function validateProgress(value: unknown): value is NavigationDiagnosticSummary["progress"] {
  if (!isRecord(value) || !hasExactKeys(value, ["cold", "warm"])) return false;
  return (["cold", "warm"] as const).every((stage) => {
    const phases = value[stage];
    return isRecord(phases) && hasExactKeys(phases, PROGRESS_PHASES) && PROGRESS_PHASES.every((phase) => {
      const item = phases[phase];
      if (!isRecord(item) || !hasExactKeys(item, ["events", "firstElapsedMs", "lastElapsedMs", "lastCompleted", "total"])) return false;
      if (!Number.isSafeInteger(item.events) || (item.events as number) < 0 || (item.events as number) > 2_048
        || !Number.isSafeInteger(item.lastCompleted) || (item.lastCompleted as number) < 0
        || !Number.isSafeInteger(item.total) || (item.total as number) < 0
        || (item.lastCompleted as number) > (item.total as number)) return false;
      if ((item.events as number) === 0) return item.firstElapsedMs === null && item.lastElapsedMs === null && item.lastCompleted === 0 && item.total === 0;
      return finiteNonnegative(item.firstElapsedMs) && finiteNonnegative(item.lastElapsedMs) && (item.firstElapsedMs as number) <= (item.lastElapsedMs as number);
    });
  });
}

function validateGateResults(value: unknown): value is NavigationDiagnosticSummary["gates"] {
  if (!isRecord(value) || !hasExactKeys(value, ["passed", "checks", "failureCodes"]) || typeof value.passed !== "boolean" || !isRecord(value.checks)) return false;
  const rawChecks = value.checks;
  if (!hasExactKeys(rawChecks, REQUIRED_GATE_CHECKS) || REQUIRED_GATE_CHECKS.some((name) => typeof rawChecks[name] !== "boolean")) return false;
  if (!Array.isArray(value.failureCodes) || value.failureCodes.length > 32 || value.failureCodes.some((code) => typeof code !== "string")) return false;
  const checks = value.checks as Record<string, unknown>;
  const failures = value.failureCodes as string[];
  if (new Set(failures).size !== failures.length) return false;
  if (failures.some((code) => !(PAIR_FAILURE_CODES as readonly string[]).includes(code) && !(SAMPLE_FAILURE_CODES as readonly string[]).includes(code))) return false;
  const expectedFailures = new Set<string>();
  for (const name of REQUIRED_GATE_CHECKS.slice(0, 8)) if (checks[name] !== true) expectedFailures.add("PAIR_" + name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase()).toUpperCase());
  if (checks.expectedSourceFilesEqual !== true) expectedFailures.add("SAMPLE_SOURCE_MANIFEST_MISMATCH");
  if (checks.bothSnapshotsHealthy !== true) expectedFailures.add("SAMPLE_HEALTH_NOT_READY");
  if (checks.navigationResolved !== true) expectedFailures.add("SAMPLE_NAVIGATION_INCOMPLETE");
  const actual = new Set(failures);
  for (const code of expectedFailures) if (!actual.has(code)) return false;
  return value.passed === (expectedFailures.size === 0 && failures.length === 0);
}

export function validateNavigationDiagnosticSummary(value: unknown): value is NavigationDiagnosticSummary {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "sample", "runtime", "snapshot", "stages", "navigation", "storage", "secureReadReplay", "progress", "gates"])) return false;
  if (value.schemaVersion !== 1 || !isRecord(value.sample) || !hasExactKeys(value.sample, ["id", "generatorVersion", "fileCount", "totalBytes", "evidenceExpected"])) return false;
  const definition = getBaselineSample("medium");
  if (!definition || value.sample.id !== MEDIUM_SAMPLE_ID || value.sample.generatorVersion !== MEDIUM_GENERATOR_VERSION || value.sample.fileCount !== definition.files.length || value.sample.totalBytes !== definition.totalBytes || value.sample.evidenceExpected !== 1_177) return false;
  if (!isRecord(value.runtime) || !hasExactKeys(value.runtime, ["nodeVersion", "platform", "architecture"]) || !boundedString(value.runtime.nodeVersion, 80) || value.runtime.platform !== "win32" || !boundedString(value.runtime.architecture, 40)) return false;
  if (!isRecord(value.snapshot) || !hasExactKeys(value.snapshot, ["healthStatus", "files", "nodes", "edges", "evidence", "unknownEdges"])) return false;
  const snapshot = value.snapshot as Record<string, unknown>;
  if (!boundedString(snapshot.healthStatus, 20) || snapshot.files !== definition.files.length || snapshot.evidence !== 1_177) return false;
  if (["files", "nodes", "edges", "evidence", "unknownEdges"].some((key) => !Number.isSafeInteger(snapshot[key]) || (snapshot[key] as number) < 0 || (snapshot[key] as number) > NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE * 4)) return false;
  if (!isRecord(value.stages) || !hasExactKeys(value.stages, ["setup", "coldIndex", "warmIndex", "secureReadReplay", "gateEvaluation", "appClose"]) || Object.values(value.stages).some((item) => !isMetricSummary(item) || item.count !== 1)) return false;
  if (!isRecord(value.navigation) || !hasExactKeys(value.navigation, ["cold", "warm"]) || !validateNavigationPhase(value.navigation.cold) || !validateNavigationPhase(value.navigation.warm)) return false;
  if (!validateStoreMetrics(value.storage)) return false;
  if (!isRecord(value.secureReadReplay) || !hasExactKeys(value.secureReadReplay, ["calls", "bytesRead"]) || !isMetricSummary(value.secureReadReplay.calls) || value.secureReadReplay.calls.count !== 1_177 || !Number.isSafeInteger(value.secureReadReplay.bytesRead) || (value.secureReadReplay.bytesRead as number) < 0 || (value.secureReadReplay.bytesRead as number) > 5 * 1_024 * 1_024) return false;
  if (!validateProgress(value.progress) || !validateGateResults(value.gates)) return false;
  const navigation = value.navigation as NavigationDiagnosticSummary["navigation"];
  const storage = value.storage as NavigationDiagnosticSummary["storage"];
  const gates = value.gates as NavigationDiagnosticSummary["gates"];
  if (([navigation.cold, navigation.warm] as const).some((item) => item.wall.count !== 1 || item.nodeEvidenceCheck.count !== 1 || item.evidenceLoop.count !== 1 || item.canonicalizeAndHash.count !== 1)) return false;
  if (navigation.cold.counts.evidenceExpected !== 1_177 || navigation.warm.counts.evidenceExpected !== 1_177) return false;
  if (navigation.cold.counts.evidenceAttempted !== 1_177 || navigation.warm.counts.evidenceAttempted !== 1_177) return false;
  if (navigation.cold.counts.resolvedEvidence > 1_177 || navigation.warm.counts.resolvedEvidence > 1_177) return false;
  if (gates.passed) {
    if (snapshot.healthStatus !== "ready" || navigation.cold.counts.resolvedEvidence !== 1_177 || navigation.warm.counts.resolvedEvidence !== 1_177) return false;
    for (const stage of ["coldNavigation", "warmNavigation"] as const) {
      const nav = stage === "coldNavigation" ? navigation.cold : navigation.warm;
      const stores = storage[stage];
      if (nav.api.getEvidence.count !== 1_177 || nav.api.readSource.count !== 1_177
        || stores.getEvidence.loadSnapshot.count !== 1_177 || stores.getEvidence.getEvidence.count !== 1_177
        || stores.readSource.loadSnapshot.count !== 1_177 || stores.readSource.readSnapshotSource.count !== 1_177
        || stores.readSource.loadIgnoreSettings.count !== 1_177) return false;
    }
  }
  return true;
}

export function parseNavigationDiagnosticChildMessage(line: string): DiagnosticChildMessage | null {
  if (Buffer.byteLength(line, "utf8") > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES || !line.startsWith(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.type === "progress") {
    if (!hasExactKeys(parsed, ["type", "stage", "phase", "elapsedMs", "completed", "total"])
      || (parsed.stage !== "cold" && parsed.stage !== "warm")
      || !(PROGRESS_PHASES as readonly unknown[]).includes(parsed.phase)
      || !finiteNonnegative(parsed.elapsedMs)
      || !Number.isSafeInteger(parsed.completed) || (parsed.completed as number) < 0
      || !Number.isSafeInteger(parsed.total) || (parsed.total as number) < 0
      || (parsed.completed as number) > (parsed.total as number)) return null;
    return { progress: parsed as unknown as DiagnosticChildProgress };
  }
  if (parsed.type !== "terminal" || !hasExactKeys(parsed, parsed.summary === undefined ? ["type", "status", "code"] : ["type", "status", "code", "summary"])) return null;
  if (parsed.status !== "completed" && parsed.status !== "failed" && parsed.status !== "cancelled") return null;
  const allowedCode = typeof parsed.code === "string"
    && (SAFE_CODES.has(parsed.code)
      || (PAIR_FAILURE_CODES as readonly string[]).includes(parsed.code)
      || (SAMPLE_FAILURE_CODES as readonly string[]).includes(parsed.code));
  if (!allowedCode) return null;
  if (parsed.summary !== undefined && !validateNavigationDiagnosticSummary(parsed.summary)) return null;
  if (parsed.status === "completed" && (parsed.code !== "OK" || !parsed.summary || !parsed.summary.gates.passed)) return null;
  if (parsed.status === "cancelled" && parsed.code !== "CANCELLED") return null;
  if (parsed.status === "failed" && parsed.code === "OK") return null;
  return { terminal: parsed as unknown as DiagnosticChildTerminal };
}

function safeChildEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC"]);
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key.toUpperCase()) && value !== undefined) result[key] = value;
  }
  return result;
}

interface ClosedProcess {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function waitForClose(child: ChildProcess): Promise<ClosedProcess> {
  return new Promise((resolveClose) => {
    child.once("close", (exitCode, signal) => resolveClose({ exitCode, signal }));
  });
}

function closeWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveWithin) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveWithin(false);
    }, timeoutMs);
    void promise.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveWithin(true);
    });
  });
}

async function waitForAuxiliaryClose(child: ChildProcess, timeoutMs: number): Promise<ClosedProcess> {
  const close = waitForClose(child);
  if (!await closeWithin(close, timeoutMs)) child.kill();
  return await close;
}

async function terminateProcessTree(child: ChildProcess, closePromise: Promise<ClosedProcess>): Promise<void> {
  if (!child.pid) {
    child.kill();
    await closePromise;
    return;
  }
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    const taskkillPath = windowsRoot ? join(windowsRoot, "System32", "taskkill.exe") : "taskkill.exe";
    let killer: ChildProcess | undefined;
    try {
      killer = spawn(taskkillPath, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, env: safeChildEnvironment() });
      const result = await waitForAuxiliaryClose(killer, 2_000);
      if (result.exitCode !== 0 && !await closeWithin(closePromise, 500)) child.kill();
    } catch {
      killer?.kill();
      if (killer) await waitForAuxiliaryClose(killer, 2_000).catch(() => undefined);
      child.kill();
    }
    if (!await closeWithin(closePromise, 500)) child.kill();
    await closePromise;
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  if (!await closeWithin(closePromise, 500)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await closePromise;
}

function protocolProgressCounts(): ControlledDiagnosticChildResult["progressCounts"] {
  return emptyProgressCounts();
}

function progressMatchesSummary(
  progress: ControlledDiagnosticChildResult["progressCounts"],
  summary: NavigationDiagnosticSummary["progress"],
): boolean {
  return (["cold", "warm"] as const).every((stage) => PROGRESS_PHASES.every((phase) => progress[stage][phase] === summary[stage][phase].events));
}

export async function runControlledDiagnosticChild(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal; stopGraceMs?: number },
): Promise<ControlledDiagnosticChildResult> {
  const startedAt = performance.now();
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > NAVIGATION_DIAGNOSTIC_MAX_TIMEOUT_MS) throw new Error("CHILD_TIMEOUT_INVALID");
  const stopGraceMs = options.stopGraceMs ?? NAVIGATION_DIAGNOSTIC_STOP_GRACE_MS;
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 1 || stopGraceMs > NAVIGATION_DIAGNOSTIC_MAX_STOP_GRACE_MS) throw new Error("CHILD_STOP_GRACE_INVALID");
  if (options.signal?.aborted) return { termination: "cancelled", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: 0, progressCounts: protocolProgressCounts() };
  let child: ChildProcess;
  try {
    child = spawn(command, [...args], { cwd: options.cwd, env: safeChildEnvironment(), detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  } catch {
    return { termination: "spawn_failed", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: performance.now() - startedAt, progressCounts: protocolProgressCounts() };
  }
  const closePromise = waitForClose(child);
  const progressCounts = protocolProgressCounts();
  let terminal: DiagnosticChildTerminal | undefined;
  let protocolError: ControlledDiagnosticChildResult["protocolError"];
  let protocolLines = 0;
  let protocolBytes = 0;
  let pending = "";
  let terminalSeen = false;
  let spawnFailed = false;
  let stopReason: "timeout" | "cancelled" | "protocol_error" | undefined;
  let forcedTermination = false;
  let stopTask: Promise<void> | undefined;
  const requestStop = (reason: "timeout" | "cancelled" | "protocol_error"): Promise<void> => {
    if (stopTask) return stopTask;
    stopReason = reason;
    try { child.stdin?.write(JSON.stringify({ type: "cancel" }) + "\n"); } catch { /* bounded force-stop follows */ }
    stopTask = (async () => {
      if (await closeWithin(closePromise, stopGraceMs)) return;
      forcedTermination = true;
      await terminateProcessTree(child, closePromise);
      await closePromise;
    })();
    return stopTask;
  };
  const failProtocol = (code: NonNullable<ControlledDiagnosticChildResult["protocolError"]>): void => {
    protocolError = code;
    void requestStop("protocol_error");
  };
  const onLine = (rawLine: string): void => {
    if (protocolError) return;
    protocolLines += 1;
    if (protocolLines > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINES) {
      failProtocol("CHILD_PROTOCOL_LIMIT");
      return;
    }
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const message = parseNavigationDiagnosticChildMessage(line);
    if (!message) {
      failProtocol(Buffer.byteLength(line, "utf8") > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES ? "CHILD_PROTOCOL_LIMIT" : "CHILD_PROTOCOL_INVALID");
      return;
    }
    if ("progress" in message) {
      if (terminalSeen) {
        failProtocol("CHILD_PROTOCOL_INVALID");
        return;
      }
      const current = progressCounts[message.progress.stage][message.progress.phase];
      if (current >= NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINES) {
        failProtocol("CHILD_PROTOCOL_LIMIT");
        return;
      }
      progressCounts[message.progress.stage][message.progress.phase] = current + 1;
      return;
    }
    if (terminalSeen) {
      failProtocol("CHILD_PROTOCOL_INVALID");
      return;
    }
    terminalSeen = true;
    terminal = message.terminal;
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    protocolBytes += chunk.byteLength;
    if (protocolBytes > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES) {
      failProtocol("CHILD_PROTOCOL_LIMIT");
      return;
    }
    pending += chunk.toString("utf8");
    if (Buffer.byteLength(pending, "utf8") > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES && !pending.includes("\n")) {
      pending = "";
      failProtocol("CHILD_PROTOCOL_LIMIT");
      return;
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      onLine(line);
      if (protocolError) return;
    }
    if (Buffer.byteLength(pending, "utf8") > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES) {
      pending = "";
      failProtocol("CHILD_PROTOCOL_LIMIT");
    }
  });
  child.on("error", () => { spawnFailed = true; });
  const timer = setTimeout(() => { void requestStop("timeout"); }, options.timeoutMs);
  const onAbort = (): void => { void requestStop("cancelled"); };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const closed = await closePromise;
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);
  if (stopTask) await stopTask;
  if (pending.length > 0 && !protocolError) protocolError = "CHILD_PROTOCOL_INVALID";
  if (!protocolError && !terminalSeen) protocolError = "CHILD_TERMINAL_MISSING";
  if (!protocolError && terminal?.summary && !progressMatchesSummary(progressCounts, terminal.summary.progress)) protocolError = "CHILD_PROTOCOL_INVALID";
  return {
    termination: stopReason === "timeout" ? "timeout"
      : stopReason === "cancelled" ? "cancelled"
        : stopReason === "protocol_error" ? "protocol_error"
          : spawnFailed ? "spawn_failed" : "exited",
    closed: true,
    forcedTermination,
    exitCode: closed.exitCode,
    signal: closed.signal,
    durationMs: Math.max(0, performance.now() - startedAt),
    ...(terminal ? { terminal } : {}),
    progressCounts,
    ...(protocolError ? { protocolError } : {}),
  };
}

export function isValidDiagnosticPair(run: ControlledDiagnosticChildResult): boolean {
  return run.termination === "exited"
    && run.exitCode === 0
    && !run.forcedTermination
    && !run.protocolError
    && run.terminal?.status === "completed"
    && run.terminal.code === "OK"
    && run.terminal.summary?.gates.passed === true
    && run.terminal.summary.gates.failureCodes.length === 0;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function assertDiagnosticReportSize(value: unknown): void {
  if (jsonByteLength(value) > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES) throw new Error("REPORT_SIZE_LIMIT");
}

function makeNotStartedRun(runNumber: number, code: string): DiagnosticRunReport {
  return {
    runNumber,
    status: "not_started",
    code,
    termination: "not_started",
    exitCode: null,
    signal: null,
    childClosed: true,
    forcedTermination: false,
    durationMs: 0,
    progressCounts: emptyProgressCounts(),
  };
}

function validChildTerminal(run: ControlledDiagnosticChildResult): DiagnosticChildTerminal | undefined {
  const terminal = run.terminal;
  if (!terminal) return undefined;
  if (terminal.status === "completed" && !isValidDiagnosticPair(run)) return undefined;
  if (terminal.status === "cancelled" && terminal.code !== "CANCELLED") return undefined;
  return terminal;
}

function statusForRun(run: ControlledDiagnosticChildResult): DiagnosticRunReport["status"] {
  if (run.termination === "cancelled") return "cancelled";
  if (run.termination === "timeout") return "timed_out";
  if (run.termination !== "exited" || run.exitCode !== 0 || run.forcedTermination || run.protocolError) return "failed";
  return isValidDiagnosticPair(run) ? "completed" : run.terminal?.status === "cancelled" ? "cancelled" : "failed";
}

function safeRunCode(run: ControlledDiagnosticChildResult): string {
  if (run.protocolError) return run.protocolError;
  if (run.termination === "timeout") return "TOTAL_TIMEOUT";
  if (run.termination === "cancelled") return "CANCELLED";
  if (run.termination === "spawn_failed") return "DIAGNOSTIC_OPERATION_FAILED";
  if (run.forcedTermination) return "CHILD_PROTOCOL_INVALID";
  return run.terminal?.code ?? "CHILD_TERMINAL_MISSING";
}

function createRootReport(root: OwnedRunRoot, options: NavigationDiagnosticOptions, runs: DiagnosticRunReport[], status: NavigationDiagnosticReport["status"]): NavigationDiagnosticReport {
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: root.id,
    status,
    requestedPairs: options.pairs,
    timeoutMs: options.timeoutMs,
    validPairCount: runs.filter((run) => run.status === "completed").length,
    environment: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
    sample: { id: MEDIUM_SAMPLE_ID, generatorVersion: MEDIUM_GENERATOR_VERSION, fileCount: sample.files.length, totalBytes: sample.totalBytes },
    runs,
    limitations: [
      "应用 API 和 GraphStore 时长为嵌套 inclusive 计时，不得相加到导航 wall。",
      "导航分段计时之间包含极小的计时/调度开销，分项和不作为导航 wall 的精确等式。",
      "Child wall 还含 child 模块启动与协议开销；未归属余量不标为导航时间。",
      "安全读取回放独立于 readSource 内部路径，不能当作应用内安全读取耗时。",
      "安全读取回放 wall 包含逐次读取计时与字节累计，逐次分布不能再加到回放 wall。",
      "IndexProgress 的首末 elapsed 是索引开始后的观测时间点，不是该 phase 的独立耗时。",
      "计时包装开销未扣除；单次配对不是跨机器或真实项目性能结论。",
      "计时与计数不包含源码、文件路径、证据 ID、内容哈希或导航哈希。",
    ],
  };
}

export async function runNavigationDiagnostic(options: NavigationDiagnosticOptions, signal?: AbortSignal): Promise<{ root: OwnedRunRoot; report: NavigationDiagnosticReport }> {
  if (options.help || !Number.isSafeInteger(options.pairs) || options.pairs < 1 || options.pairs > NAVIGATION_DIAGNOSTIC_MAX_PAIRS
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < NAVIGATION_DIAGNOSTIC_MIN_TIMEOUT_MS || options.timeoutMs > NAVIGATION_DIAGNOSTIC_MAX_TIMEOUT_MS) throw new Error("CLI_OPTIONS_INVALID");
  if (process.platform !== "win32") throw new Error("PLATFORM_UNSUPPORTED");
  const deadline = performance.now() + options.timeoutMs;
  const root = await createUniqueRunRoot();
  const runs: DiagnosticRunReport[] = [];
  let rootStatus: NavigationDiagnosticReport["status"] = "completed";
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const childPath = join(repositoryRoot, "benchmarks", "local-index-navigation-diagnostic-child.ts");

  for (let runNumber = 1; runNumber <= options.pairs; runNumber += 1) {
    let runDirectory: string;
    try {
      runDirectory = await createRunDirectory(root, runNumber);
    } catch {
      rootStatus = "failed";
      runs.push(makeNotStartedRun(runNumber, "RUN_DIRECTORY_CREATE_FAILED"));
      break;
    }
    if (signal?.aborted) {
      runs.push(makeNotStartedRun(runNumber, "CANCELLED_BEFORE_START"));
      rootStatus = "cancelled";
      continue;
    }
    const remainingMs = Math.floor(deadline - performance.now());
    const childBudgetMs = remainingMs - NAVIGATION_DIAGNOSTIC_CHILD_SHUTDOWN_RESERVE_MS;
    if (childBudgetMs < 1) {
      runs.push(makeNotStartedRun(runNumber, "TOTAL_TIMEOUT"));
      rootStatus = "timed_out";
      continue;
    }
    const controlled = await runControlledDiagnosticChild(process.execPath, [
      "--import", "tsx", childPath,
      "--run-id", root.id,
      "--run-number", String(runNumber),
    ], {
      cwd: repositoryRoot,
      timeoutMs: Math.min(childBudgetMs, NAVIGATION_DIAGNOSTIC_MAX_TIMEOUT_MS),
      ...(signal ? { signal } : {}),
    });
    const terminal = validChildTerminal(controlled);
    const runStatus = statusForRun(controlled);
    const runReport: DiagnosticRunReport = {
      runNumber,
      status: runStatus,
      code: safeRunCode(controlled),
      termination: controlled.termination,
      exitCode: controlled.exitCode,
      signal: controlled.signal,
      childClosed: controlled.closed,
      forcedTermination: controlled.forcedTermination,
      durationMs: controlled.durationMs,
      progressCounts: controlled.progressCounts,
      ...(terminal?.summary ? { summary: terminal.summary } : {}),
      ...(controlled.protocolError ? { protocolError: controlled.protocolError } : {}),
    };
    runs.push(runReport);
    try {
      assertDiagnosticReportSize(runReport);
    } catch {
      runReport.status = "failed";
      runReport.code = "REPORT_SIZE_LIMIT";
      delete runReport.summary;
      rootStatus = "failed";
      break;
    }
    const reportStart = performance.now();
    try {
      await writeRunReportExclusive(root, runNumber, runReport);
      runReport.reportWriteMs = Math.max(0, performance.now() - reportStart);
    } catch {
      runReport.status = "failed";
      runReport.code = "REPORT_WRITE_FAILED";
      rootStatus = "failed";
      break;
    }
    if (runStatus !== "completed") {
      rootStatus = runStatus === "cancelled" ? "cancelled" : runStatus === "timed_out" ? "timed_out" : "failed";
      for (let remaining = runNumber + 1; remaining <= options.pairs; remaining += 1) {
        try {
          await createRunDirectory(root, remaining);
          const notStarted = makeNotStartedRun(
            remaining,
            rootStatus === "cancelled" ? "CANCELLED_BEFORE_START" : rootStatus === "timed_out" ? "TOTAL_TIMEOUT" : "PREVIOUS_PAIR_FAILED",
          );
          runs.push(notStarted);
          assertDiagnosticReportSize(notStarted);
          await writeRunReportExclusive(root, remaining, notStarted);
        } catch {
          rootStatus = "failed";
        }
      }
      break;
    }
  }
  if (runs.length === 0 && rootStatus === "failed") {
    runs.push(makeNotStartedRun(1, "RUN_DIRECTORY_CREATE_FAILED"));
  }
  const report = createRootReport(root, options, runs, rootStatus);
  assertDiagnosticReportSize(report);
  await writeReportExclusive(root, report);
  return { root, report };
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

async function main(): Promise<void> {
  let options: NavigationDiagnosticOptions;
  try {
    options = parseNavigationDiagnosticArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "CLI_ARGUMENT_INVALID") + "\n");
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write("Usage: pnpm exec tsx benchmarks/local-index-navigation-diagnostic.ts [--pairs 1..3] [--timeout-ms 5000..180000]\n");
    return;
  }
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  const onSigterm = (): void => controller.abort();
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const { root, report } = await runNavigationDiagnostic(options, controller.signal);
    process.stdout.write(JSON.stringify({ runId: root.id, status: report.status, validPairCount: report.validPairCount, report: "report.json" }) + "\n");
    if (report.status === "cancelled") process.exitCode = 130;
    else if (report.status !== "completed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write((error instanceof Error && SAFE_CODES.has(error.message) ? error.message : "DIAGNOSTIC_OPERATION_FAILED") + "\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (isMainModule()) void main();
