import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Evidence } from "../packages/contracts/src/index.ts";
import { canonicalJson } from "../packages/contracts/src/snapshot-content.ts";
import { createRunDirectory, createUniqueRunRoot, writeReportExclusive, writeRunReportExclusive, type OwnedRunRoot } from "./local-index-baseline.ts";
import { getBaselineSample, MEDIUM_GENERATOR_VERSION, MEDIUM_SAMPLE_ID, type BaselineSampleFile } from "./local-index-baseline-samples.ts";

export const NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX = "XRAY_NAVIGATION_OPTIMIZED_V2:";
export const NAVIGATION_OPTIMIZED_SCHEMA_VERSION = 2 as const;
export const NAVIGATION_OPTIMIZED_MEASUREMENT_PROTOCOL_VERSION = 2 as const;
export const NAVIGATION_OPTIMIZED_BASELINE_PROTOCOL_VERSION = 1 as const;
export const NAVIGATION_OPTIMIZED_MAX_PAIRS = 3;
export const NAVIGATION_OPTIMIZED_DEFAULT_PAIRS = 1;
export const NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS = 180_000;
export const NAVIGATION_OPTIMIZED_DEFAULT_TIMEOUT_MS = 180_000;
export const NAVIGATION_OPTIMIZED_MIN_TIMEOUT_MS = 5_000;
export const NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES = 256 * 1_024;
export const NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES = 64 * 1_024;
export const NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINES = 2_048;
export const NAVIGATION_OPTIMIZED_STOP_GRACE_MS = 1_000;
export const NAVIGATION_OPTIMIZED_MAX_STOP_GRACE_MS = 2_000;
export const NAVIGATION_OPTIMIZED_CHILD_SHUTDOWN_RESERVE_MS = 4_000;
export const NAVIGATION_OPTIMIZED_MAX_EVIDENCE = 2_000;
export const NAVIGATION_OPTIMIZED_REPORT_MAX_BYTES = 256 * 1_024;
export const NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES = 4_708;
export const NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM = 2;
export const NAVIGATION_OPTIMIZED_PROJECTION_LIMIT_BYTES = 4_194_304;

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
const LOOKUP_DECISIONS = ["hit", "empty_build_installed", "external_rebuild_installed", "local_rebuild_installed", "combined_rebuild_installed", "build_discard_external", "build_discard_local", "build_discard_combined", "build_discard_unclassified", "projection_limit_fallback", "transaction_bypass", "token_unavailable_bypass", "invalid_token_bypass", "store_closed_error", "legacy_bypass", "build_error_fallback", "lookup_error"] as const;
const BUILD_RACE_REASONS = ["external_only", "local_only", "both_changed", "unclassified"] as const;
const TOKEN_OBSERVATIONS = ["unchanged", "external_only", "local_only", "both_changed", "unavailable", "invalid_type", "in_transaction", "closed"] as const;
const OBSERVATION_CHECKPOINTS = ["phase_start", "lookup_validity", "build_before", "build_after", "after_last_lookup"] as const;
const OPTIMIZATION_FAILURE_CODES = ["SEMANTIC_GATES_FAILED", "PROTOCOL_RELATION_VIOLATION", "CANDIDATE_BUILD_FAILED", "CANDIDATE_ADMISSION_REJECTED", "CANDIDATE_CANCELLED", "OBSERVER_DISABLED", "OBSERVER_UNAVAILABLE", "OBSERVER_VERSION_MISMATCH", "EXTERNAL_OBSERVATION_INCOMPLETE", "TOKEN_CLASSIFICATION_INCOMPLETE", "EXTERNAL_WRITE_OBSERVED", "NAVIGATION_FULL_LOAD_LIMIT_EXCEEDED"] as const;
const PAIR_STATUSES = ["completed", "failed", "cancelled", "timed_out", "inconclusive_external_write", "inconclusive_external_observation", "not_started"] as const;
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
  "OPTIMIZED_OPERATION_FAILED",
  "SQLITE_VERSION_UNAVAILABLE",
  "REPORT_SCHEMA_INVALID",
  "REPORT_SIZE_LIMIT",
  "REPORT_WRITE_FAILED",
  "RUN_DIRECTORY_CREATE_FAILED",
  "PREVIOUS_PAIR_FAILED",
  "CHILD_PROTOCOL_INVALID",
  "CHILD_PROTOCOL_LIMIT",
  "CHILD_TERMINAL_MISSING",
  "OBSERVER_SUMMARY_INVALID",
  "OBSERVER_VERSION_MISMATCH",
  "OPTIMIZATION_GATE_FAILED",
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

export interface NavigationOptimizedOptions {
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

export type OptimizedStage = "setup" | "coldIndex" | "warmIndex" | "secureReadReplay" | "gateEvaluation" | "appClose";
export type OptimizedPhase = "setup" | "coldIndex" | "coldNavigation" | "warmIndex" | "warmNavigation" | "secureReadReplay" | "gateEvaluation" | "appClose";
export type OptimizedApi = "getEvidence" | "readSource";
export type OptimizedStoreMethod = "loadSnapshot" | "getEvidence" | "readSnapshotSource" | "loadIgnoreSettings";
export type OptimizedStoreSource = "indexProject" | "getEvidence" | "readSource";

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
  api: Record<OptimizedApi, MetricSummary>;
}

export interface NavigationOptimizedSummary {
  schemaVersion: 2;
  sample: { id: typeof MEDIUM_SAMPLE_ID; generatorVersion: typeof MEDIUM_GENERATOR_VERSION; fileCount: number; totalBytes: number; evidenceExpected: 1_177 };
  runtime: { nodeVersion: string; platform: string; architecture: string };
  snapshot: { healthStatus: string; files: number; nodes: number; edges: number; evidence: number; unknownEdges: number };
  stages: Record<OptimizedStage, MetricSummary>;
  navigation: { cold: NavigationPhaseSummary; warm: NavigationPhaseSummary };
  navigationFullLoads: {
    coldNavigation: { getEvidence: number; readSource: number; total: number };
    warmNavigation: { getEvidence: number; readSource: number; total: number };
    navigationTotal: number;
    fullLoadOpportunityCount: 4_708;
    maximumWithCompleteNoExternalChangeObservation: 2;
  };
  observer: { status: "enabled" | "disabled" | "unavailable" | "version_mismatch"; contractVersion: string | null };
  lookupDecisions: Record<"coldNavigation" | "warmNavigation", Record<OptimizedApi, Record<(typeof LOOKUP_DECISIONS)[number], number>>> | null;
  candidateBuilds: Record<"coldNavigation" | "warmNavigation", { attempted: number; installed: number; discarded: number; rejectedByAdmission: number; failed: number; cancelled: number }> | null;
  buildRaceReasons: Record<"coldNavigation" | "warmNavigation", Record<(typeof BUILD_RACE_REASONS)[number], number>> | null;
  externalObservations: Record<"coldNavigation" | "warmNavigation", Record<(typeof OBSERVATION_CHECKPOINTS)[number], Record<(typeof TOKEN_OBSERVATIONS)[number], number>>> | null;
  externalObservationCoverage: Record<"coldNavigation" | "warmNavigation", { complete: boolean; checkpoints: Record<(typeof OBSERVATION_CHECKPOINTS)[number], boolean> }>;
  projectionAdmission: Record<"coldNavigation" | "warmNavigation", { evaluatedCount: number; acceptedCount: number; acceptedBytesTotal: number; maxAcceptedBytes: number; overLimitCount: number; invalidCount: number; limitBytes: 4_194_304 }> | null;
  heapUsed: Record<"coldNavigation" | "warmNavigation", { beforeBytes: number; afterBytes: number }>;
  storage: Record<OptimizedPhase, Record<OptimizedStoreSource, Record<OptimizedStoreMethod, MetricSummary>>>;
  secureReadReplay: { calls: MetricSummary; bytesRead: number };
  progress: Record<"cold" | "warm", Record<(typeof PROGRESS_PHASES)[number], OptimizedProgressSummary>>;
  semanticGates: { passed: boolean; checks: Record<(typeof REQUIRED_GATE_CHECKS)[number], boolean>; failureCodes: string[] };
  optimizationGate: { status: "passed" | "failed" | "inconclusive_external_write" | "inconclusive_external_observation"; navigationFullSnapshotLoads: number; maximumWithCompleteNoExternalChangeObservation: 2; failureCodes: string[] };
}

export interface NavigationEvidenceExpectation {
  repositoryId: string;
  snapshotId: string;
  evidence: Evidence;
  sampleFile: BaselineSampleFile;
  snapshotSourceFile: { filePath: string; contentHash: string; bytes: number; language: string };
  expectedContent: string;
}

function matchesCanonicalValue(actual: unknown, expected: unknown): boolean {
  try { return canonicalJson(actual) === canonicalJson(expected); }
  catch { return false; }
}

/** Validates full getEvidence/readSource responses against the active snapshot and fixed fixture. */
export function navigationEvidenceResponseFailures(
  identified: unknown,
  source: unknown,
  expected: NavigationEvidenceExpectation,
): Array<"SAMPLE_EVIDENCE_LOOKUP_MISMATCH" | "SAMPLE_SOURCE_NAVIGATION_MISMATCH"> {
  const failures: Array<"SAMPLE_EVIDENCE_LOOKUP_MISMATCH" | "SAMPLE_SOURCE_NAVIGATION_MISMATCH"> = [];
  const expectedIdentified = { ...expected.evidence, repositoryId: expected.repositoryId };
  if (expected.evidence.snapshotId !== expected.snapshotId || !matchesCanonicalValue(identified, expectedIdentified)) {
    failures.push("SAMPLE_EVIDENCE_LOOKUP_MISMATCH");
  }

  const sampleFile = expected.sampleFile;
  const expectedSourceFile = { filePath: sampleFile.path, contentHash: sampleFile.sha256, bytes: sampleFile.bytes, language: sampleFile.language };
  const expectedContentValid = Buffer.byteLength(expected.expectedContent, "utf8") === sampleFile.bytes
    && createHash("sha256").update(expected.expectedContent, "utf8").digest("hex") === sampleFile.sha256;
  const expectedEvidenceValid = expected.evidence.snapshotId === expected.snapshotId && expected.evidence.span.filePath === sampleFile.path;
  const sourceMatches = isRecord(source)
    && hasExactKeys(source, ["repositoryId", "snapshotId", "filePath", "language", "content", "contentHash", "workspaceStatus", "currentHash", "targetSpan", "evidence"])
    && typeof source.content === "string"
    && expectedContentValid
    && expectedEvidenceValid
    && matchesCanonicalValue(expected.snapshotSourceFile, expectedSourceFile)
    && source.repositoryId === expected.repositoryId
    && source.snapshotId === expected.snapshotId
    && source.filePath === sampleFile.path
    && source.language === sampleFile.language
    && source.content === expected.expectedContent
    && source.contentHash === sampleFile.sha256
    && source.workspaceStatus === "current"
    && source.currentHash === sampleFile.sha256
    && matchesCanonicalValue(source.targetSpan, expected.evidence.span)
    && matchesCanonicalValue(source.evidence, expected.evidence)
    && Buffer.byteLength(source.content, "utf8") === sampleFile.bytes
    && createHash("sha256").update(source.content, "utf8").digest("hex") === sampleFile.sha256;
  if (!sourceMatches) failures.push("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
  return failures;
}

export interface OptimizedProgressSummary {
  events: number;
  firstElapsedMs: number | null;
  lastElapsedMs: number | null;
  lastCompleted: number;
  total: number;
}

export interface OptimizedChildProgress {
  type: "progress";
  stage: "cold" | "warm";
  phase: (typeof PROGRESS_PHASES)[number];
  elapsedMs: number;
  completed: number;
  total: number;
}

export interface OptimizedChildTerminal {
  type: "terminal";
  status: "completed" | "failed" | "cancelled";
  code: string;
  summary?: NavigationOptimizedSummary;
}

export type OptimizedChildMessage = { progress: OptimizedChildProgress } | { terminal: OptimizedChildTerminal };

export interface ControlledOptimizedChildResult {
  termination: "exited" | "timeout" | "cancelled" | "protocol_error" | "spawn_failed";
  closed: true;
  forcedTermination: boolean;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  terminal?: OptimizedChildTerminal;
  progressCounts: Record<"cold" | "warm", Record<(typeof PROGRESS_PHASES)[number], number>>;
  protocolError?: "CHILD_PROTOCOL_INVALID" | "CHILD_PROTOCOL_LIMIT" | "CHILD_TERMINAL_MISSING";
}

export interface OptimizedRunReport {
  runNumber: number;
  status: (typeof PAIR_STATUSES)[number];
  code: string;
  termination: ControlledOptimizedChildResult["termination"] | "not_started";
  exitCode: number | null;
  signal: string | null;
  childClosed: boolean;
  forcedTermination: boolean;
  durationMs: number;
  progressCounts: ControlledOptimizedChildResult["progressCounts"];
  summary?: NavigationOptimizedSummary;
  protocolError?: ControlledOptimizedChildResult["protocolError"];
}

export interface NavigationOptimizedReport {
  schemaVersion: 2;
  measurementProtocolVersion: 2;
  baselineProtocolVersion: 1;
  generatedAt: string;
  runId: string;
  status: "completed" | "failed" | "cancelled" | "timed_out";
  requestedPairs: number;
  timeoutMs: number;
  terminalSummaryPairCount: number;
  semanticValidPairCount: number;
  performanceComparablePairCount: number;
  optimizationPassPairCount: number;
  externalWriteInconclusivePairCount: number;
  externalObservationInconclusivePairCount: number;
  notStartedPairCount: number;
  environment: { nodeVersion: string; platform: string; architecture: string; betterSqlite3Version: string };
  baseline: { protocolVersion: 1; state: "frozen"; sampleId: typeof MEDIUM_SAMPLE_ID; generatorVersion: typeof MEDIUM_GENERATOR_VERSION; navigationFullSnapshotLoadsPerPair: 4_708 };
  sample: { id: typeof MEDIUM_SAMPLE_ID; generatorVersion: typeof MEDIUM_GENERATOR_VERSION; fileCount: number; totalBytes: number };
  runs: OptimizedRunReport[];
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

function emptyProgressCounts(): ControlledOptimizedChildResult["progressCounts"] {
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

export function parseNavigationOptimizedArguments(args: readonly string[]): NavigationOptimizedOptions {
  if (args.length === 1 && args[0] === "--help") return { help: true, pairs: NAVIGATION_OPTIMIZED_DEFAULT_PAIRS, timeoutMs: NAVIGATION_OPTIMIZED_DEFAULT_TIMEOUT_MS };
  let pairs = NAVIGATION_OPTIMIZED_DEFAULT_PAIRS;
  let timeoutMs = NAVIGATION_OPTIMIZED_DEFAULT_TIMEOUT_MS;
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
      if (parsed < 1 || parsed > NAVIGATION_OPTIMIZED_MAX_PAIRS) throw new Error("CLI_PAIRS_OUT_OF_RANGE");
      pairs = parsed;
    } else {
      if (parsed < NAVIGATION_OPTIMIZED_MIN_TIMEOUT_MS || parsed > NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS) throw new Error("CLI_TIMEOUT_OUT_OF_RANGE");
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
  if (Object.values(value.counts).some((count) => !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > NAVIGATION_OPTIMIZED_MAX_EVIDENCE * 2)) return false;
  if (!isRecord(value.api) || !hasExactKeys(value.api, ["getEvidence", "readSource"]) || !isMetricSummary(value.api.getEvidence) || !isMetricSummary(value.api.readSource)) return false;
  return value.counts.getEvidenceCalls === value.api.getEvidence.count && value.counts.readSourceCalls === value.api.readSource.count;
}

function validateStoreMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const phaseNames: readonly OptimizedPhase[] = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"];
  const sourceNames: readonly OptimizedStoreSource[] = ["indexProject", "getEvidence", "readSource"];
  const methodNames: readonly OptimizedStoreMethod[] = ["loadSnapshot", "getEvidence", "readSnapshotSource", "loadIgnoreSettings"];
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

function validateProgress(value: unknown): value is NavigationOptimizedSummary["progress"] {
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

function validateGateResults(value: unknown): value is NavigationOptimizedSummary["semanticGates"] {
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

type NavigationStage = "coldNavigation" | "warmNavigation";
type ObservationCheckpoint = (typeof OBSERVATION_CHECKPOINTS)[number];

function isCount(value: unknown, maximum = 200_000): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function sumRecord(value: Record<string, unknown>, keys: readonly string[]): number {
  return keys.reduce((sum, key) => sum + (value[key] as number), 0);
}

function validateCounterRecord(value: unknown, keys: readonly string[], maximum = 200_000): value is Record<string, number> {
  return isRecord(value) && hasExactKeys(value, keys) && keys.every((key) => isCount(value[key], maximum));
}

function validateCoverage(value: unknown, observerEnabled: boolean): value is NavigationOptimizedSummary["externalObservationCoverage"][NavigationStage] {
  if (!isRecord(value) || !hasExactKeys(value, ["complete", "checkpoints"]) || typeof value.complete !== "boolean") return false;
  const rawCheckpoints = value.checkpoints;
  if (!isRecord(rawCheckpoints) || !hasExactKeys(rawCheckpoints, OBSERVATION_CHECKPOINTS)
    || OBSERVATION_CHECKPOINTS.some((name) => typeof rawCheckpoints[name] !== "boolean")) return false;
  const checkpoints = rawCheckpoints as Record<ObservationCheckpoint, boolean>;
  if (!observerEnabled && (value.complete || OBSERVATION_CHECKPOINTS.some((name) => checkpoints[name]))) return false;
  if (value.complete !== OBSERVATION_CHECKPOINTS.every((name) => checkpoints[name])) return false;
  return true;
}

function summaryRuntimeMatchesEnvironment(
  summary: NavigationOptimizedSummary,
  environment: Pick<NavigationOptimizedReport["environment"], "nodeVersion" | "platform" | "architecture">,
): boolean {
  return summary.runtime.nodeVersion === environment.nodeVersion
    && summary.runtime.platform === environment.platform
    && summary.runtime.architecture === environment.architecture;
}

function checkpointTotal(summary: NavigationOptimizedSummary, stage: NavigationStage, checkpoint: ObservationCheckpoint): number {
  const outcomes = summary.externalObservations?.[stage]?.[checkpoint];
  return outcomes ? TOKEN_OBSERVATIONS.reduce((sum, outcome) => sum + outcomes[outcome], 0) : 0;
}

/** Checks independently reported domains. O/R checks run only when both build checkpoints are fully covered. */
export function observerRelationsValid(summary: NavigationOptimizedSummary): boolean {
  const navigationStages: readonly NavigationStage[] = ["coldNavigation", "warmNavigation"];
  for (const stage of navigationStages) {
    const phase = stage === "coldNavigation" ? summary.navigation.cold : summary.navigation.warm;
    const builds = summary.candidateBuilds?.[stage];
    const decisions = summary.lookupDecisions?.[stage];
    const races = summary.buildRaceReasons?.[stage];
    const admission = summary.projectionAdmission?.[stage];
    const coverage = summary.externalObservationCoverage[stage];
    const observations = summary.externalObservations?.[stage];
    const loads = summary.navigationFullLoads[stage];
    if (loads.getEvidence !== summary.storage[stage].getEvidence.loadSnapshot.count
      || loads.readSource !== summary.storage[stage].readSource.loadSnapshot.count
      || loads.total !== loads.getEvidence + loads.readSource
      || loads.getEvidence > phase.counts.getEvidenceCalls || loads.readSource > phase.counts.readSourceCalls) return false;
    if (!summary.observer || summary.observer.status !== "enabled") continue;
    if (!builds || !decisions || !races || !admission || !observations) return false;
    if (sumRecord(decisions.getEvidence, LOOKUP_DECISIONS) !== 1_177 || sumRecord(decisions.readSource, LOOKUP_DECISIONS) !== 1_177) return false;
    if (builds.attempted !== builds.installed + builds.discarded + builds.rejectedByAdmission + builds.failed + builds.cancelled) return false;
    const installedDecisions = decisions.getEvidence.empty_build_installed + decisions.readSource.empty_build_installed
      + decisions.getEvidence.external_rebuild_installed + decisions.readSource.external_rebuild_installed
      + decisions.getEvidence.local_rebuild_installed + decisions.readSource.local_rebuild_installed
      + decisions.getEvidence.combined_rebuild_installed + decisions.readSource.combined_rebuild_installed;
    const discardedDecisions = decisions.getEvidence.build_discard_external + decisions.readSource.build_discard_external
      + decisions.getEvidence.build_discard_local + decisions.readSource.build_discard_local
      + decisions.getEvidence.build_discard_combined + decisions.readSource.build_discard_combined
      + decisions.getEvidence.build_discard_unclassified + decisions.readSource.build_discard_unclassified;
    const rejectedDecisions = decisions.getEvidence.projection_limit_fallback + decisions.readSource.projection_limit_fallback;
    const failedDecisions = decisions.getEvidence.build_error_fallback + decisions.readSource.build_error_fallback;
    if (builds.installed !== installedDecisions || builds.discarded !== discardedDecisions
      || builds.rejectedByAdmission !== rejectedDecisions || builds.failed !== failedDecisions) return false;
    if (sumRecord(races, BUILD_RACE_REASONS) !== builds.discarded
      || races.external_only !== decisions.getEvidence.build_discard_external + decisions.readSource.build_discard_external
      || races.local_only !== decisions.getEvidence.build_discard_local + decisions.readSource.build_discard_local
      || races.both_changed !== decisions.getEvidence.build_discard_combined + decisions.readSource.build_discard_combined
      || races.unclassified !== decisions.getEvidence.build_discard_unclassified + decisions.readSource.build_discard_unclassified) return false;
    if (admission.evaluatedCount !== admission.acceptedCount + admission.overLimitCount + admission.invalidCount
      || admission.evaluatedCount > builds.attempted
      || admission.overLimitCount !== builds.rejectedByAdmission
      || admission.invalidCount > builds.failed
      || admission.acceptedCount < builds.installed + builds.discarded
      || admission.limitBytes !== NAVIGATION_OPTIMIZED_PROJECTION_LIMIT_BYTES) return false;
    if (admission.maxAcceptedBytes > admission.limitBytes || admission.maxAcceptedBytes > admission.acceptedBytesTotal
      || (admission.acceptedCount === 0 && (admission.acceptedBytesTotal !== 0 || admission.maxAcceptedBytes !== 0))) return false;

    const expected: Record<ObservationCheckpoint, number> = {
      phase_start: 1,
      lookup_validity: 2_354,
      build_before: builds.attempted,
      build_after: builds.attempted,
      after_last_lookup: 1,
    };
    for (const checkpoint of OBSERVATION_CHECKPOINTS) {
      const count = checkpointTotal(summary, stage, checkpoint);
      if (count > expected[checkpoint]) return false;
      if (coverage.checkpoints[checkpoint] && count !== expected[checkpoint]) return false;
    }
    if (coverage.complete && OBSERVATION_CHECKPOINTS.some((checkpoint) => checkpointTotal(summary, stage, checkpoint) !== expected[checkpoint])) return false;
    if (coverage.checkpoints.build_before && coverage.checkpoints.build_after) {
      for (const race of ["external_only", "local_only", "both_changed"] as const) {
        const outcome = race === "external_only" ? "external_only" : race === "local_only" ? "local_only" : "both_changed";
        if (races[race] > observations.build_after[outcome]) return false;
      }
      const unavailable = observations.build_after.unavailable + observations.build_after.invalid_type + observations.build_after.in_transaction + observations.build_after.closed;
      if (races.unclassified > unavailable) return false;
      const delta = (observations.build_after.external_only - races.external_only)
        + (observations.build_after.local_only - races.local_only)
        + (observations.build_after.both_changed - races.both_changed)
        + (unavailable - races.unclassified);
      if (delta < 0 || delta > builds.failed + builds.rejectedByAdmission + builds.cancelled
        || builds.installed > observations.build_after.unchanged) return false;
    }
    if (phase.counts.getEvidenceCalls !== 1_177 || phase.counts.readSourceCalls !== 1_177) return false;
  }
  const fullLoads = summary.navigationFullLoads;
  return fullLoads.navigationTotal === fullLoads.coldNavigation.total + fullLoads.warmNavigation.total
    && fullLoads.navigationTotal === fullLoads.coldNavigation.getEvidence + fullLoads.coldNavigation.readSource + fullLoads.warmNavigation.getEvidence + fullLoads.warmNavigation.readSource
    && fullLoads.navigationTotal <= NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES;
}

function hasExternalChange(summary: NavigationOptimizedSummary): boolean {
  const observations = summary.externalObservations;
  if (!observations) return false;
  return (["coldNavigation", "warmNavigation"] as const).some((stage) => OBSERVATION_CHECKPOINTS.some((checkpoint) =>
    observations[stage][checkpoint].external_only > 0 || observations[stage][checkpoint].both_changed > 0));
}

function hasUnclassifiableTokenObservation(summary: NavigationOptimizedSummary): boolean {
  const observations = summary.externalObservations;
  if (!observations) return true;
  return (["coldNavigation", "warmNavigation"] as const).some((stage) => OBSERVATION_CHECKPOINTS.some((checkpoint) =>
    (["unavailable", "invalid_type", "in_transaction", "closed"] as const).some((outcome) => observations[stage][checkpoint][outcome] > 0)));
}

export function deriveOptimizationGate(summary: NavigationOptimizedSummary): NavigationOptimizedSummary["optimizationGate"] {
  const failureCodes: string[] = [];
  const relationsValid = observerRelationsValid(summary);
  const builds = summary.candidateBuilds;
  if (!summary.semanticGates.passed) failureCodes.push("SEMANTIC_GATES_FAILED");
  if (!relationsValid) failureCodes.push("PROTOCOL_RELATION_VIOLATION");
  if (builds) {
    if ((["coldNavigation", "warmNavigation"] as const).some((stage) => builds[stage].failed > 0)) failureCodes.push("CANDIDATE_BUILD_FAILED");
    if ((["coldNavigation", "warmNavigation"] as const).some((stage) => builds[stage].rejectedByAdmission > 0)) failureCodes.push("CANDIDATE_ADMISSION_REJECTED");
    if ((["coldNavigation", "warmNavigation"] as const).some((stage) => builds[stage].cancelled > 0)) failureCodes.push("CANDIDATE_CANCELLED");
  }
  if (failureCodes.length) return { status: "failed", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };

  if (summary.observer.status !== "enabled") {
    failureCodes.push(summary.observer.status === "disabled" ? "OBSERVER_DISABLED" : summary.observer.status === "version_mismatch" ? "OBSERVER_VERSION_MISMATCH" : "OBSERVER_UNAVAILABLE");
    return { status: "inconclusive_external_observation", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };
  }
  if ((["coldNavigation", "warmNavigation"] as const).some((stage) => !summary.externalObservationCoverage[stage].complete)) failureCodes.push("EXTERNAL_OBSERVATION_INCOMPLETE");
  if (hasUnclassifiableTokenObservation(summary)) failureCodes.push("TOKEN_CLASSIFICATION_INCOMPLETE");
  if (failureCodes.length) return { status: "inconclusive_external_observation", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };
  if (hasExternalChange(summary)) {
    failureCodes.push("EXTERNAL_WRITE_OBSERVED");
    return { status: "inconclusive_external_write", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };
  }
  if (summary.navigationFullLoads.navigationTotal > NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM) {
    failureCodes.push("NAVIGATION_FULL_LOAD_LIMIT_EXCEEDED");
    return { status: "failed", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };
  }
  return { status: "passed", navigationFullSnapshotLoads: summary.navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM, failureCodes };
}

export function validateNavigationOptimizedSummary(value: unknown): value is NavigationOptimizedSummary {
  const summaryKeys = ["schemaVersion", "sample", "runtime", "snapshot", "stages", "navigation", "navigationFullLoads", "observer", "lookupDecisions", "candidateBuilds", "buildRaceReasons", "externalObservations", "externalObservationCoverage", "projectionAdmission", "heapUsed", "storage", "secureReadReplay", "progress", "semanticGates", "optimizationGate"] as const;
  if (!isRecord(value) || !hasExactKeys(value, summaryKeys) || value.schemaVersion !== NAVIGATION_OPTIMIZED_SCHEMA_VERSION) return false;
  const definition = getBaselineSample("medium");
  if (!definition || !isRecord(value.sample) || !hasExactKeys(value.sample, ["id", "generatorVersion", "fileCount", "totalBytes", "evidenceExpected"])
    || value.sample.id !== MEDIUM_SAMPLE_ID || value.sample.generatorVersion !== MEDIUM_GENERATOR_VERSION || value.sample.fileCount !== definition.files.length || value.sample.totalBytes !== definition.totalBytes || value.sample.evidenceExpected !== 1_177) return false;
  if (!isRecord(value.runtime) || !hasExactKeys(value.runtime, ["nodeVersion", "platform", "architecture"]) || !boundedString(value.runtime.nodeVersion, 80) || value.runtime.platform !== "win32" || !boundedString(value.runtime.architecture, 40)) return false;
  if (!isRecord(value.snapshot) || !hasExactKeys(value.snapshot, ["healthStatus", "files", "nodes", "edges", "evidence", "unknownEdges"])) return false;
  const snapshot = value.snapshot as Record<string, unknown>;
  if (!boundedString(snapshot.healthStatus, 20) || snapshot.files !== definition.files.length || snapshot.evidence !== 1_177
    || ["files", "nodes", "edges", "evidence", "unknownEdges"].some((key) => !isCount(snapshot[key], NAVIGATION_OPTIMIZED_MAX_EVIDENCE * 4))) return false;
  if (!isRecord(value.stages) || !hasExactKeys(value.stages, ["setup", "coldIndex", "warmIndex", "secureReadReplay", "gateEvaluation", "appClose"])
    || Object.values(value.stages).some((item) => !isMetricSummary(item) || item.count !== 1)) return false;
  if (!isRecord(value.navigation) || !hasExactKeys(value.navigation, ["cold", "warm"]) || !validateNavigationPhase(value.navigation.cold) || !validateNavigationPhase(value.navigation.warm)) return false;
  if (!validateStoreMetrics(value.storage)) return false;
  if (!isRecord(value.secureReadReplay) || !hasExactKeys(value.secureReadReplay, ["calls", "bytesRead"]) || !isMetricSummary(value.secureReadReplay.calls) || value.secureReadReplay.calls.count !== 1_177 || !isCount(value.secureReadReplay.bytesRead, 5 * 1_024 * 1_024)) return false;
  if (!validateProgress(value.progress) || !validateGateResults(value.semanticGates)) return false;

  if (!isRecord(value.navigationFullLoads) || !hasExactKeys(value.navigationFullLoads, ["coldNavigation", "warmNavigation", "navigationTotal", "fullLoadOpportunityCount", "maximumWithCompleteNoExternalChangeObservation"])) return false;
  for (const stage of ["coldNavigation", "warmNavigation"] as const) {
    const loads = value.navigationFullLoads[stage];
    if (!isRecord(loads) || !hasExactKeys(loads, ["getEvidence", "readSource", "total"])
      || !isCount(loads.getEvidence, 1_177) || !isCount(loads.readSource, 1_177) || !isCount(loads.total, 2_354)) return false;
  }
  if (!isCount(value.navigationFullLoads.navigationTotal, NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES)
    || value.navigationFullLoads.fullLoadOpportunityCount !== NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES
    || value.navigationFullLoads.maximumWithCompleteNoExternalChangeObservation !== NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM) return false;

  if (!isRecord(value.observer) || !hasExactKeys(value.observer, ["status", "contractVersion"]) || !["enabled", "disabled", "unavailable", "version_mismatch"].includes(String(value.observer.status))) return false;
  const observerStatus = value.observer.status as NavigationOptimizedSummary["observer"]["status"];
  const observerEnabled = observerStatus === "enabled";
  if (observerEnabled ? value.observer.contractVersion !== "xray.navigation-cache-observer.v1" : value.observer.contractVersion !== null) return false;
  const navigationStages: readonly NavigationStage[] = ["coldNavigation", "warmNavigation"];
  if (!isRecord(value.externalObservationCoverage) || !hasExactKeys(value.externalObservationCoverage, navigationStages)) return false;
  for (const stage of navigationStages) if (!validateCoverage(value.externalObservationCoverage[stage], observerEnabled)) return false;
  const nullWhenDisabled = ["lookupDecisions", "candidateBuilds", "buildRaceReasons", "externalObservations", "projectionAdmission"] as const;
  if (!observerEnabled) {
    if (nullWhenDisabled.some((key) => value[key] !== null)) return false;
  } else {
    if (!isRecord(value.lookupDecisions) || !hasExactKeys(value.lookupDecisions, navigationStages)
      || !isRecord(value.candidateBuilds) || !hasExactKeys(value.candidateBuilds, navigationStages)
      || !isRecord(value.buildRaceReasons) || !hasExactKeys(value.buildRaceReasons, navigationStages)
      || !isRecord(value.externalObservations) || !hasExactKeys(value.externalObservations, navigationStages)
      || !isRecord(value.projectionAdmission) || !hasExactKeys(value.projectionAdmission, navigationStages)) return false;
    for (const stage of navigationStages) {
      const decisions = value.lookupDecisions[stage];
      if (!isRecord(decisions) || !hasExactKeys(decisions, ["getEvidence", "readSource"])
        || !validateCounterRecord(decisions.getEvidence, LOOKUP_DECISIONS, 1_177) || !validateCounterRecord(decisions.readSource, LOOKUP_DECISIONS, 1_177)) return false;
      const builds = value.candidateBuilds[stage];
      if (!isRecord(builds) || !hasExactKeys(builds, ["attempted", "installed", "discarded", "rejectedByAdmission", "failed", "cancelled"])
        || ["attempted", "installed", "discarded", "rejectedByAdmission", "failed", "cancelled"].some((key) => !isCount(builds[key], 2_354))) return false;
      if (!validateCounterRecord(value.buildRaceReasons[stage], BUILD_RACE_REASONS, 2_354)) return false;
      const observations = value.externalObservations[stage];
      if (!isRecord(observations) || !hasExactKeys(observations, OBSERVATION_CHECKPOINTS)
        || OBSERVATION_CHECKPOINTS.some((checkpoint) => !validateCounterRecord(observations[checkpoint], TOKEN_OBSERVATIONS, 2_354))) return false;
      const admission = value.projectionAdmission[stage];
      if (!isRecord(admission) || !hasExactKeys(admission, ["evaluatedCount", "acceptedCount", "acceptedBytesTotal", "maxAcceptedBytes", "overLimitCount", "invalidCount", "limitBytes"])
        || !["evaluatedCount", "acceptedCount", "overLimitCount", "invalidCount"].every((key) => isCount(admission[key], 2_354))
        || !isCount(admission.acceptedBytesTotal, 200_000 * NAVIGATION_OPTIMIZED_PROJECTION_LIMIT_BYTES)
        || !isCount(admission.maxAcceptedBytes, NAVIGATION_OPTIMIZED_PROJECTION_LIMIT_BYTES)
        || admission.limitBytes !== NAVIGATION_OPTIMIZED_PROJECTION_LIMIT_BYTES) return false;
    }
  }
  if (!isRecord(value.heapUsed) || !hasExactKeys(value.heapUsed, navigationStages)) return false;
  const heapUsed = value.heapUsed as Record<NavigationStage, unknown>;
  if (navigationStages.some((stage) => {
    const heap = heapUsed[stage];
    return !isRecord(heap) || !hasExactKeys(heap, ["beforeBytes", "afterBytes"])
      || !isCount(heap.beforeBytes, Number.MAX_SAFE_INTEGER) || !isCount(heap.afterBytes, Number.MAX_SAFE_INTEGER);
  })) return false;

  const navigation = value.navigation as NavigationOptimizedSummary["navigation"];
  const storage = value.storage as NavigationOptimizedSummary["storage"];
  const semanticGates = value.semanticGates as NavigationOptimizedSummary["semanticGates"];
  if (([navigation.cold, navigation.warm] as const).some((item) => item.wall.count !== 1 || item.nodeEvidenceCheck.count !== 1 || item.evidenceLoop.count !== 1 || item.canonicalizeAndHash.count !== 1)) return false;
  if (([navigation.cold, navigation.warm] as const).some((item) => item.counts.evidenceExpected !== 1_177 || item.counts.evidenceAttempted !== 1_177 || item.counts.resolvedEvidence > 1_177)) return false;
  for (const stage of navigationStages) {
    const loads = value.navigationFullLoads[stage] as NavigationOptimizedSummary["navigationFullLoads"][NavigationStage];
    if (loads.getEvidence !== storage[stage].getEvidence.loadSnapshot.count || loads.readSource !== storage[stage].readSource.loadSnapshot.count
      || loads.total !== loads.getEvidence + loads.readSource) return false;
  }
  if (semanticGates.passed) {
    if (snapshot.healthStatus !== "ready" || navigation.cold.counts.resolvedEvidence !== 1_177 || navigation.warm.counts.resolvedEvidence !== 1_177
      || navigation.cold.counts.errors !== 0 || navigation.warm.counts.errors !== 0) return false;
    for (const phase of [navigation.cold, navigation.warm]) if (phase.api.getEvidence.count !== 1_177 || phase.api.readSource.count !== 1_177) return false;
  }
  const summary = value as unknown as NavigationOptimizedSummary;
  const expectedGate = deriveOptimizationGate(summary);
  if (!isRecord(value.optimizationGate) || !hasExactKeys(value.optimizationGate, ["status", "navigationFullSnapshotLoads", "maximumWithCompleteNoExternalChangeObservation", "failureCodes"])
    || value.optimizationGate.status !== expectedGate.status || value.optimizationGate.navigationFullSnapshotLoads !== expectedGate.navigationFullSnapshotLoads
    || value.optimizationGate.maximumWithCompleteNoExternalChangeObservation !== NAVIGATION_OPTIMIZED_FULL_LOAD_MAXIMUM
    || !Array.isArray(value.optimizationGate.failureCodes) || JSON.stringify(value.optimizationGate.failureCodes) !== JSON.stringify(expectedGate.failureCodes)) return false;
  return true;
}

export function parseNavigationOptimizedChildMessage(line: string): OptimizedChildMessage | null {
  if (Buffer.byteLength(line, "utf8") > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES || !line.startsWith(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX.length));
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
    return { progress: parsed as unknown as OptimizedChildProgress };
  }
  if (parsed.type !== "terminal" || !hasExactKeys(parsed, parsed.summary === undefined ? ["type", "status", "code"] : ["type", "status", "code", "summary"])) return null;
  if (parsed.status !== "completed" && parsed.status !== "failed" && parsed.status !== "cancelled") return null;
  const allowedCode = typeof parsed.code === "string"
    && (SAFE_CODES.has(parsed.code)
      || (PAIR_FAILURE_CODES as readonly string[]).includes(parsed.code)
      || (SAMPLE_FAILURE_CODES as readonly string[]).includes(parsed.code)
      || (OPTIMIZATION_FAILURE_CODES as readonly string[]).includes(parsed.code));
  if (!allowedCode) return null;
  if (parsed.summary !== undefined && !validateNavigationOptimizedSummary(parsed.summary)) return null;
  if (parsed.status === "completed" && (parsed.code !== "OK" || !parsed.summary || !parsed.summary.semanticGates.passed || parsed.summary.optimizationGate.status === "failed")) return null;
  if (parsed.status === "cancelled" && parsed.code !== "CANCELLED") return null;
  if (parsed.status === "failed" && parsed.code === "OK") return null;
  if (parsed.status === "failed" && parsed.summary) {
    const expectedCode = parsed.summary.semanticGates.passed ? "OPTIMIZATION_GATE_FAILED" : "EQUIVALENCE_GATE_FAILED";
    if (parsed.summary.optimizationGate.status !== "failed" || parsed.code !== expectedCode) return null;
  }
  return { terminal: parsed as unknown as OptimizedChildTerminal };
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

function protocolProgressCounts(): ControlledOptimizedChildResult["progressCounts"] {
  return emptyProgressCounts();
}

function progressMatchesSummary(
  progress: ControlledOptimizedChildResult["progressCounts"],
  summary: NavigationOptimizedSummary["progress"],
): boolean {
  return (["cold", "warm"] as const).every((stage) => PROGRESS_PHASES.every((phase) => progress[stage][phase] === summary[stage][phase].events));
}

export async function runControlledOptimizedChild(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal; stopGraceMs?: number },
): Promise<ControlledOptimizedChildResult> {
  const startedAt = performance.now();
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS) throw new Error("CHILD_TIMEOUT_INVALID");
  const stopGraceMs = options.stopGraceMs ?? NAVIGATION_OPTIMIZED_STOP_GRACE_MS;
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 1 || stopGraceMs > NAVIGATION_OPTIMIZED_MAX_STOP_GRACE_MS) throw new Error("CHILD_STOP_GRACE_INVALID");
  if (options.signal?.aborted) return { termination: "cancelled", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: 0, progressCounts: protocolProgressCounts() };
  let child: ChildProcess;
  try {
    child = spawn(command, [...args], { cwd: options.cwd, env: safeChildEnvironment(), detached: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  } catch {
    return { termination: "spawn_failed", closed: true, forcedTermination: false, exitCode: null, signal: null, durationMs: performance.now() - startedAt, progressCounts: protocolProgressCounts() };
  }
  const closePromise = waitForClose(child);
  const progressCounts = protocolProgressCounts();
  let terminal: OptimizedChildTerminal | undefined;
  let protocolError: ControlledOptimizedChildResult["protocolError"];
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
  const failProtocol = (code: NonNullable<ControlledOptimizedChildResult["protocolError"]>): void => {
    protocolError = code;
    void requestStop("protocol_error");
  };
  const onLine = (rawLine: string): void => {
    if (protocolError) return;
    protocolLines += 1;
    if (protocolLines > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINES) {
      failProtocol("CHILD_PROTOCOL_LIMIT");
      return;
    }
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const message = parseNavigationOptimizedChildMessage(line);
    if (!message) {
      failProtocol(Buffer.byteLength(line, "utf8") > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES ? "CHILD_PROTOCOL_LIMIT" : "CHILD_PROTOCOL_INVALID");
      return;
    }
    if ("progress" in message) {
      if (terminalSeen) {
        failProtocol("CHILD_PROTOCOL_INVALID");
        return;
      }
      const current = progressCounts[message.progress.stage][message.progress.phase];
      if (current >= NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINES) {
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
    if (protocolBytes > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES) {
      failProtocol("CHILD_PROTOCOL_LIMIT");
      return;
    }
    pending += chunk.toString("utf8");
    if (Buffer.byteLength(pending, "utf8") > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES && !pending.includes("\n")) {
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
    if (Buffer.byteLength(pending, "utf8") > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES) {
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

export function isValidOptimizedPair(run: ControlledOptimizedChildResult): boolean {
  return run.termination === "exited"
    && run.exitCode === 0
    && !run.forcedTermination
    && !run.protocolError
    && run.terminal?.status === "completed"
    && run.terminal.code === "OK"
    && run.terminal.summary?.semanticGates.passed === true
    && run.terminal.summary.semanticGates.failureCodes.length === 0
    && run.terminal.summary.optimizationGate.status === "passed"
    && run.terminal.summary.optimizationGate.failureCodes.length === 0;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function assertOptimizedReportSize(value: unknown): void {
  if (jsonByteLength(value) > NAVIGATION_OPTIMIZED_REPORT_MAX_BYTES) throw new Error("REPORT_SIZE_LIMIT");
}

function isPerformanceComparableSummary(summary: NavigationOptimizedSummary): boolean {
  return summary.semanticGates.passed
    && summary.observer.status === "enabled"
    && summary.externalObservationCoverage.coldNavigation.complete
    && summary.externalObservationCoverage.warmNavigation.complete
    && !hasExternalChange(summary)
    && !hasUnclassifiableTokenObservation(summary)
    && observerRelationsValid(summary)
    && summary.navigation.cold.counts.getEvidenceCalls === 1_177
    && summary.navigation.cold.counts.readSourceCalls === 1_177
    && summary.navigation.warm.counts.getEvidenceCalls === 1_177
    && summary.navigation.warm.counts.readSourceCalls === 1_177;
}

function getPairCounts(
  runs: readonly OptimizedRunReport[],
  environment: Pick<NavigationOptimizedReport["environment"], "nodeVersion" | "platform" | "architecture">,
): Pick<NavigationOptimizedReport,
  "terminalSummaryPairCount" | "semanticValidPairCount" | "performanceComparablePairCount" | "optimizationPassPairCount"
  | "externalWriteInconclusivePairCount" | "externalObservationInconclusivePairCount" | "notStartedPairCount"> {
  return {
    terminalSummaryPairCount: runs.filter((run) => run.summary !== undefined).length,
    semanticValidPairCount: runs.filter((run) => run.summary?.semanticGates.passed === true).length,
    performanceComparablePairCount: runs.filter((run) => run.summary && run.childClosed && !run.protocolError
      && run.termination === "exited" && run.summary.stages.appClose.count === 1
      && summaryRuntimeMatchesEnvironment(run.summary, environment) && isPerformanceComparableSummary(run.summary)).length,
    optimizationPassPairCount: runs.filter((run) => run.status === "completed").length,
    externalWriteInconclusivePairCount: runs.filter((run) => run.status === "inconclusive_external_write").length,
    externalObservationInconclusivePairCount: runs.filter((run) => run.status === "inconclusive_external_observation").length,
    notStartedPairCount: runs.filter((run) => run.status === "not_started").length,
  };
}

function validateProgressCounts(value: unknown): value is ControlledOptimizedChildResult["progressCounts"] {
  if (!isRecord(value) || !hasExactKeys(value, ["cold", "warm"])) return false;
  return (["cold", "warm"] as const).every((stage) => {
    const phaseCounts = value[stage];
    return isRecord(phaseCounts) && hasExactKeys(phaseCounts, PROGRESS_PHASES)
      && PROGRESS_PHASES.every((phase) => isCount(phaseCounts[phase], NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINES));
  });
}

const RUN_FAILURE_CODES = new Set(["CANCELLED_BEFORE_START", "TOTAL_TIMEOUT", "PREVIOUS_PAIR_FAILED", "RUN_DIRECTORY_CREATE_FAILED", "REPORT_SIZE_LIMIT", "REPORT_WRITE_FAILED"]);

function validateOptimizedRunReport(
  value: unknown,
  expectedRunNumber: number,
  environment: Pick<NavigationOptimizedReport["environment"], "nodeVersion" | "platform" | "architecture">,
): value is OptimizedRunReport {
  if (!isRecord(value)) return false;
  const required = ["runNumber", "status", "code", "termination", "exitCode", "signal", "childClosed", "forcedTermination", "durationMs", "progressCounts"];
  if (!hasExactKeys(value, value.summary === undefined ? (value.protocolError === undefined ? required : [...required, "protocolError"])
    : (value.protocolError === undefined ? [...required, "summary"] : [...required, "summary", "protocolError"]))) return false;
  if (value.runNumber !== expectedRunNumber || !PAIR_STATUSES.includes(value.status as (typeof PAIR_STATUSES)[number])
    || !boundedString(value.code, 100) || !finiteNonnegative(value.durationMs) || value.durationMs > NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS
    || typeof value.childClosed !== "boolean" || typeof value.forcedTermination !== "boolean" || !validateProgressCounts(value.progressCounts)) return false;
  const safeCode = SAFE_CODES.has(value.code)
    || RUN_FAILURE_CODES.has(value.code)
    || (PAIR_FAILURE_CODES as readonly string[]).includes(value.code)
    || (SAMPLE_FAILURE_CODES as readonly string[]).includes(value.code)
    || (OPTIMIZATION_FAILURE_CODES as readonly string[]).includes(value.code);
  if (!safeCode) return false;
  if (value.protocolError !== undefined && !["CHILD_PROTOCOL_INVALID", "CHILD_PROTOCOL_LIMIT", "CHILD_TERMINAL_MISSING"].includes(String(value.protocolError))) return false;
  if (value.exitCode !== null && (!Number.isSafeInteger(value.exitCode) || (value.exitCode as number) < 0 || (value.exitCode as number) > 255)) return false;
  if (value.signal !== null && (typeof value.signal !== "string" || !/^SIG[A-Z0-9]{1,12}$/.test(value.signal))) return false;
  if (!value.childClosed) return false;
  if (value.termination === "not_started") {
    return value.status === "not_started" && RUN_FAILURE_CODES.has(value.code) && value.exitCode === null && value.signal === null
      && value.forcedTermination === false && value.durationMs === 0 && value.summary === undefined && value.protocolError === undefined;
  }
  if (!["exited", "timeout", "cancelled", "protocol_error", "spawn_failed"].includes(String(value.termination))) return false;
  if (value.summary !== undefined) {
    if (!validateNavigationOptimizedSummary(value.summary)) return false;
    const summary = value.summary as NavigationOptimizedSummary;
    if (!summaryRuntimeMatchesEnvironment(summary, environment)) return false;
    if (value.status === "failed" && value.protocolError === undefined
      && ((value.code === "OPTIMIZATION_GATE_FAILED" && (!summary.semanticGates.passed || summary.optimizationGate.status !== "failed"))
        || (value.code === "EQUIVALENCE_GATE_FAILED" && (summary.semanticGates.passed || summary.optimizationGate.status !== "failed")))) return false;
    for (const stage of ["cold", "warm"] as const) for (const phase of PROGRESS_PHASES) {
      if (value.progressCounts[stage][phase] !== summary.progress[stage][phase].events) return false;
    }
  }
  if (value.status === "completed") return value.termination === "exited" && value.exitCode === 0 && value.forcedTermination === false
    && value.protocolError === undefined && value.code === "OK" && value.summary?.optimizationGate.status === "passed";
  if (value.status === "inconclusive_external_write" || value.status === "inconclusive_external_observation") {
    const expectedStatus = value.status === "inconclusive_external_write" ? "inconclusive_external_write" : "inconclusive_external_observation";
    return value.termination === "exited" && value.exitCode === 0 && value.forcedTermination === false && value.protocolError === undefined
      && value.code === "OK" && value.summary?.semanticGates.passed === true && value.summary.optimizationGate.status === expectedStatus;
  }
  if (value.status === "cancelled") return value.termination === "cancelled" || value.termination === "exited" && value.exitCode !== 0 && value.code === "CANCELLED";
  if (value.status === "timed_out") return value.termination === "timeout";
  return value.status === "failed" && (value.termination !== "exited" || value.exitCode !== 0 || value.forcedTermination || value.protocolError !== undefined
    || value.code !== "OK" || value.summary?.optimizationGate.status === "failed" || value.summary?.semanticGates.passed === false);
}

export function validateNavigationOptimizedReport(value: unknown): value is NavigationOptimizedReport {
  const keys = ["schemaVersion", "measurementProtocolVersion", "baselineProtocolVersion", "generatedAt", "runId", "status", "requestedPairs", "timeoutMs", "terminalSummaryPairCount", "semanticValidPairCount", "performanceComparablePairCount", "optimizationPassPairCount", "externalWriteInconclusivePairCount", "externalObservationInconclusivePairCount", "notStartedPairCount", "environment", "baseline", "sample", "runs", "limitations"] as const;
  if (!isRecord(value) || !hasExactKeys(value, keys) || value.schemaVersion !== 2 || value.measurementProtocolVersion !== 2 || value.baselineProtocolVersion !== 1
    || !boundedString(value.generatedAt, 40) || !/^\d{4}-\d\d-\d\dT/.test(value.generatedAt)
    || typeof value.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.runId)
    || !["completed", "failed", "cancelled", "timed_out"].includes(String(value.status))
    || !isCount(value.requestedPairs, NAVIGATION_OPTIMIZED_MAX_PAIRS) || value.requestedPairs < 1
    || !isCount(value.timeoutMs, NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS) || value.timeoutMs < NAVIGATION_OPTIMIZED_MIN_TIMEOUT_MS) return false;
  if (!isRecord(value.environment) || !hasExactKeys(value.environment, ["nodeVersion", "platform", "architecture", "betterSqlite3Version"])
    || !boundedString(value.environment.nodeVersion, 80) || value.environment.platform !== "win32"
    || !boundedString(value.environment.architecture, 40) || !boundedString(value.environment.betterSqlite3Version, 40)) return false;
  if (!isRecord(value.baseline) || !hasExactKeys(value.baseline, ["protocolVersion", "state", "sampleId", "generatorVersion", "navigationFullSnapshotLoadsPerPair"])
    || value.baseline.protocolVersion !== 1 || value.baseline.state !== "frozen" || value.baseline.sampleId !== MEDIUM_SAMPLE_ID
    || value.baseline.generatorVersion !== MEDIUM_GENERATOR_VERSION || value.baseline.navigationFullSnapshotLoadsPerPair !== NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES) return false;
  const sample = getBaselineSample("medium");
  if (!sample || !isRecord(value.sample) || !hasExactKeys(value.sample, ["id", "generatorVersion", "fileCount", "totalBytes"])
    || value.sample.id !== MEDIUM_SAMPLE_ID || value.sample.generatorVersion !== MEDIUM_GENERATOR_VERSION
    || value.sample.fileCount !== sample.files.length || value.sample.totalBytes !== sample.totalBytes) return false;
  const environment = value.environment as NavigationOptimizedReport["environment"];
  if (!Array.isArray(value.runs) || value.runs.length !== value.requestedPairs
    || !value.runs.every((run, index) => validateOptimizedRunReport(run, index + 1, environment))) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length < 6 || value.limitations.length > 16
    || value.limitations.some((item) => !boundedString(item, 300))) return false;
  const runs = value.runs as OptimizedRunReport[];
  const counts = getPairCounts(runs, environment);
  for (const [key, count] of Object.entries(counts)) if (value[key] !== count) return false;
  const pairStatuses = runs.map((run) => run.status);
  const expectedStatus = pairStatuses.some((status) => status === "cancelled") || runs.some((run) => run.status === "not_started" && run.code === "CANCELLED_BEFORE_START") ? "cancelled"
    : pairStatuses.some((status) => status === "timed_out") || runs.some((run) => run.status === "not_started" && run.code === "TOTAL_TIMEOUT") ? "timed_out"
      : pairStatuses.some((status) => status === "failed" || status === "not_started") ? "failed" : "completed";
  return value.status === expectedStatus;
}

function makeNotStartedRun(runNumber: number, code: string): OptimizedRunReport {
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

function validChildTerminal(run: ControlledOptimizedChildResult): OptimizedChildTerminal | undefined {
  const terminal = run.terminal;
  if (!terminal) return undefined;
  if (terminal.status === "completed" && (run.termination !== "exited" || run.exitCode !== 0 || run.forcedTermination || run.protocolError)) return undefined;
  if (terminal.status === "cancelled" && terminal.code !== "CANCELLED") return undefined;
  return terminal;
}

function statusForRun(run: ControlledOptimizedChildResult): OptimizedRunReport["status"] {
  if (run.termination === "cancelled") return "cancelled";
  if (run.termination === "timeout") return "timed_out";
  if (run.termination !== "exited" || run.exitCode !== 0 || run.forcedTermination || run.protocolError) return "failed";
  if (run.terminal?.status === "cancelled") return "cancelled";
  const summary = run.terminal?.summary;
  if (run.terminal?.status !== "completed" || run.terminal.code !== "OK" || !summary?.semanticGates.passed) return "failed";
  return summary.optimizationGate.status === "passed" ? "completed" : summary.optimizationGate.status;
}

function safeRunCode(run: ControlledOptimizedChildResult): string {
  if (run.protocolError) return run.protocolError;
  if (run.termination === "timeout") return "TOTAL_TIMEOUT";
  if (run.termination === "cancelled") return "CANCELLED";
  if (run.termination === "spawn_failed") return "OPTIMIZED_OPERATION_FAILED";
  if (run.forcedTermination) return "CHILD_PROTOCOL_INVALID";
  return run.terminal?.code ?? "CHILD_TERMINAL_MISSING";
}

function installedSqliteVersion(): string {
  const fromRoot = createRequire(new URL("../package.json", import.meta.url));
  const entry = fromRoot.resolve("better-sqlite3");
  const packageJsonPath = resolve(dirname(entry), "..", "package.json");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")); }
  catch { throw new Error("SQLITE_VERSION_UNAVAILABLE"); }
  if (!isRecord(parsed) || !boundedString(parsed.version, 40)) throw new Error("SQLITE_VERSION_UNAVAILABLE");
  return parsed.version;
}

function createRootReport(root: OwnedRunRoot, options: NavigationOptimizedOptions, runs: OptimizedRunReport[], status: NavigationOptimizedReport["status"]): NavigationOptimizedReport {
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
  const environment = { nodeVersion: process.version, platform: process.platform, architecture: process.arch, betterSqlite3Version: installedSqliteVersion() };
  const pairCounts = getPairCounts(runs, environment);
  return {
    schemaVersion: 2,
    measurementProtocolVersion: NAVIGATION_OPTIMIZED_MEASUREMENT_PROTOCOL_VERSION,
    baselineProtocolVersion: NAVIGATION_OPTIMIZED_BASELINE_PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    runId: root.id,
    status,
    requestedPairs: options.pairs,
    timeoutMs: options.timeoutMs,
    ...pairCounts,
    environment,
    baseline: { protocolVersion: 1, state: "frozen", sampleId: MEDIUM_SAMPLE_ID, generatorVersion: MEDIUM_GENERATOR_VERSION, navigationFullSnapshotLoadsPerPair: NAVIGATION_OPTIMIZED_FULL_LOAD_OPPORTUNITIES },
    sample: { id: MEDIUM_SAMPLE_ID, generatorVersion: MEDIUM_GENERATOR_VERSION, fileCount: sample.files.length, totalBytes: sample.totalBytes },
    runs,
    limitations: [
      "仅测固定 medium128 synthetic fixture；样例和 generator 固定，不代表更大或真实仓库。",
      "导航 wall/evidenceLoop 包含完整返回身份范围校验和源码 SHA-256；API/store 只测调用内部，后处理开销未扣除。子计时不能相加。",
      "Child wall 含启动与协议开销；IndexProgress 首末时间是观测点，不是独立 phase 时长。",
      "heapUsed 是整个 child 的未强制 GC heap 读数，受索引和导航结果影响，不是缓存净内存。",
      "外部写入 challenge 与计时配对分开；安全失效验证不进入 4,708 分母或性能汇总。",
      "有界 observer 只覆盖 phase_start 到 after_last_lookup；之后发生的提交不在本次观察结论内。",
      "报告不含 token 原值、源码、路径、evidence ID 或内容/导航 hash；合成结果不代表跨机器性能。",
    ],
  };
}

export async function runNavigationOptimized(options: NavigationOptimizedOptions, signal?: AbortSignal): Promise<{ root: OwnedRunRoot; report: NavigationOptimizedReport }> {
  if (options.help || !Number.isSafeInteger(options.pairs) || options.pairs < 1 || options.pairs > NAVIGATION_OPTIMIZED_MAX_PAIRS
    || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < NAVIGATION_OPTIMIZED_MIN_TIMEOUT_MS || options.timeoutMs > NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS) throw new Error("CLI_OPTIONS_INVALID");
  if (process.platform !== "win32") throw new Error("PLATFORM_UNSUPPORTED");
  const deadline = performance.now() + options.timeoutMs;
  const root = await createUniqueRunRoot();
  const runs: OptimizedRunReport[] = [];
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const childPath = join(repositoryRoot, "benchmarks", "local-index-navigation-optimized-child.ts");
  let stopCode: string | undefined;

  for (let runNumber = 1; runNumber <= options.pairs; runNumber += 1) {
    if (stopCode) {
      let directory: boolean = false;
      try { await createRunDirectory(root, runNumber); directory = true; } catch { /* the root report still records this pair */ }
      const notStarted = makeNotStartedRun(runNumber, stopCode);
      if (directory) {
        try { await writeRunReportExclusive(root, runNumber, notStarted); }
        catch { notStarted.code = "REPORT_WRITE_FAILED"; }
      }
      runs.push(notStarted);
      continue;
    }
    try {
      await createRunDirectory(root, runNumber);
    } catch {
      runs.push(makeNotStartedRun(runNumber, "RUN_DIRECTORY_CREATE_FAILED"));
      stopCode = "RUN_DIRECTORY_CREATE_FAILED";
      continue;
    }
    if (signal?.aborted) {
      const notStarted = makeNotStartedRun(runNumber, "CANCELLED_BEFORE_START");
      try { await writeRunReportExclusive(root, runNumber, notStarted); } catch { notStarted.code = "REPORT_WRITE_FAILED"; }
      runs.push(notStarted);
      stopCode = "CANCELLED_BEFORE_START";
      continue;
    }
    const remainingMs = Math.floor(deadline - performance.now());
    const childBudgetMs = remainingMs - NAVIGATION_OPTIMIZED_CHILD_SHUTDOWN_RESERVE_MS;
    if (childBudgetMs < 1) {
      const notStarted = makeNotStartedRun(runNumber, "TOTAL_TIMEOUT");
      try { await writeRunReportExclusive(root, runNumber, notStarted); } catch { notStarted.code = "REPORT_WRITE_FAILED"; }
      runs.push(notStarted);
      stopCode = "TOTAL_TIMEOUT";
      continue;
    }
    const controlled = await runControlledOptimizedChild(process.execPath, [
      "--import", "tsx", childPath,
      "--run-id", root.id,
      "--run-number", String(runNumber),
    ], {
      cwd: repositoryRoot,
      timeoutMs: Math.min(childBudgetMs, NAVIGATION_OPTIMIZED_MAX_TIMEOUT_MS),
      ...(signal ? { signal } : {}),
    });
    const terminal = validChildTerminal(controlled);
    const runStatus = statusForRun(controlled);
    const runReport: OptimizedRunReport = {
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
    try {
      assertOptimizedReportSize(runReport);
    } catch {
      runReport.status = "failed";
      runReport.code = "REPORT_SIZE_LIMIT";
      delete runReport.summary;
    }
    try {
      await writeRunReportExclusive(root, runNumber, runReport);
    } catch {
      runReport.status = "failed";
      runReport.code = "REPORT_WRITE_FAILED";
    }
    runs.push(runReport);
    if (runReport.status === "failed") stopCode = "PREVIOUS_PAIR_FAILED";
    else if (runReport.status === "cancelled") stopCode = "CANCELLED_BEFORE_START";
    else if (runReport.status === "timed_out") stopCode = "TOTAL_TIMEOUT";
  }
  const rootStatus: NavigationOptimizedReport["status"] = runs.some((run) => run.status === "cancelled" || run.status === "not_started" && run.code === "CANCELLED_BEFORE_START") ? "cancelled"
    : runs.some((run) => run.status === "timed_out" || run.status === "not_started" && run.code === "TOTAL_TIMEOUT") ? "timed_out"
      : runs.some((run) => run.status === "failed" || run.status === "not_started") ? "failed" : "completed";
  const report = createRootReport(root, options, runs, rootStatus);
  assertOptimizedReportSize(report);
  if (!validateNavigationOptimizedReport(report)) throw new Error("REPORT_SCHEMA_INVALID");
  await writeReportExclusive(root, report);
  return { root, report };
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

async function main(): Promise<void> {
  let options: NavigationOptimizedOptions;
  try {
    options = parseNavigationOptimizedArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : "CLI_ARGUMENT_INVALID") + "\n");
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write("Usage: pnpm exec tsx benchmarks/local-index-navigation-optimized.ts [--pairs 1..3] [--timeout-ms 5000..180000]\n");
    return;
  }
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  const onSigterm = (): void => controller.abort();
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const { root, report } = await runNavigationOptimized(options, controller.signal);
    process.stdout.write(JSON.stringify({ runId: root.id, status: report.status, optimizationPassPairCount: report.optimizationPassPairCount, performanceComparablePairCount: report.performanceComparablePairCount, report: "report.json" }) + "\n");
    if (report.status === "cancelled") process.exitCode = 130;
    else if (report.status !== "completed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write((error instanceof Error && SAFE_CODES.has(error.message) ? error.message : "OPTIMIZED_OPERATION_FAILED") + "\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (isMainModule()) void main();
