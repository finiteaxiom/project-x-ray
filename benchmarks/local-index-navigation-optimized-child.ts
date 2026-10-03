import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { Evidence, IndexProgress, ProjectSnapshot, SourceSpan } from "../packages/contracts/src/index.ts";
import { canonicalJson } from "../packages/contracts/src/snapshot-content.ts";
import { readProjectFile } from "../packages/analyzer-core/src/index.ts";
import { XRayApplication, type NavigationCacheObservationScopeV1, type NavigationCacheObserverSummaryV1 } from "../packages/application/src/index.ts";
import { GraphStore } from "../packages/graph/src/index.ts";
import { compareSnapshotPair } from "./local-index-baseline.ts";
import { getBaselineSample, getGeneratedSampleContent, MEDIUM_FILE_COUNT, MEDIUM_GENERATOR_VERSION, MEDIUM_MAX_FILE_BYTES, MEDIUM_MAX_TOTAL_BYTES, MEDIUM_SAMPLE_ID } from "./local-index-baseline-samples.ts";
import {
  createMetricSummary,
  deriveOptimizationGate,
  navigationEvidenceResponseFailures,
  NAVIGATION_OPTIMIZED_MAX_EVIDENCE,
  NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES,
  NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES,
  NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX,
  patchPropertyWithRestore,
  recordMetric,
  type OptimizedChildProgress,
  type OptimizedChildTerminal,
  type OptimizedPhase,
  type OptimizedStoreMethod,
  type OptimizedStoreSource,
  type MetricSummary,
  type NavigationEvidenceExpectation,
  type NavigationOptimizedSummary,
  type NavigationPhaseSummary,
} from "./local-index-navigation-optimized.ts";

const RUNS_DIRECTORY = "project-xray-local-index-baseline-runs";
const EXPECTED_EVIDENCE_COUNT = 1_177;
const MAX_PROGRESS_LINES = 1_024;
const MAX_FILE_BYTES = MEDIUM_MAX_FILE_BYTES;
const MAX_SAMPLE_BYTES = MEDIUM_MAX_TOTAL_BYTES;
const OBSERVER_LOOKUP_DECISIONS = ["hit", "empty_build_installed", "external_rebuild_installed", "local_rebuild_installed", "combined_rebuild_installed", "build_discard_external", "build_discard_local", "build_discard_combined", "build_discard_unclassified", "projection_limit_fallback", "transaction_bypass", "token_unavailable_bypass", "invalid_token_bypass", "store_closed_error", "legacy_bypass", "build_error_fallback", "lookup_error"] as const;
const OBSERVER_RACE_REASONS = ["external_only", "local_only", "both_changed", "unclassified"] as const;
const OBSERVER_OUTCOMES = ["unchanged", "external_only", "local_only", "both_changed", "unavailable", "invalid_type", "in_transaction", "closed"] as const;
const OBSERVER_CHECKPOINTS = ["phase_start", "lookup_validity", "build_before", "build_after", "after_last_lookup"] as const;

interface ChildArguments {
  runId: string;
  runNumber: number;
}

interface NavigationResult {
  sha256: string;
  counts: NavigationPhaseSummary["counts"];
  errors: string[];
}

type Phase = OptimizedPhase;
type ApiSource = OptimizedStoreSource | null;

interface NavigationFullLoadCounts {
  coldNavigation: { getEvidence: number; readSource: number; total: number };
  warmNavigation: { getEvidence: number; readSource: number; total: number };
  navigationTotal: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(".." + sep) && !isAbsolute(relativePath);
}

function parseChildArguments(args: readonly string[]): ChildArguments {
  if (args.length !== 4 || args[0] !== "--run-id" || args[2] !== "--run-number") throw new Error("CHILD_ARGUMENT_INVALID");
  const runId = args[1];
  const numberText = args[3];
  if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId)
    || !numberText || !/^[1-3]$/.test(numberText)) throw new Error("CHILD_ARGUMENT_INVALID");
  return { runId, runNumber: Number(numberText) };
}

let emittedBytes = 0;
let progressLines = 0;

function emit(value: OptimizedChildProgress | OptimizedChildTerminal, terminal = false): void {
  const line = NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify(value) + "\n";
  const bytes = Buffer.byteLength(line, "utf8");
  const progressLimit = terminal ? NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES : NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES - 16 * 1_024;
  if (bytes > NAVIGATION_OPTIMIZED_MAX_PROTOCOL_LINE_BYTES || emittedBytes + bytes > progressLimit) throw new Error("CHILD_PROTOCOL_LIMIT");
  if (!terminal && progressLines >= MAX_PROGRESS_LINES) throw new Error("CHILD_PROTOCOL_LIMIT");
  emittedBytes += bytes;
  if (!terminal) progressLines += 1;
  process.stdout.write(line);
}

async function locateOwnedRunDirectory(args: ChildArguments): Promise<{ repositoryRoot: string; runDirectory: string }> {
  const [tempRoot, basePath] = await Promise.all([realpath(tmpdir()), realpath(join(tmpdir(), RUNS_DIRECTORY))]);
  if (!isWithin(tempRoot, basePath) || dirname(basePath) !== tempRoot || basename(basePath) !== RUNS_DIRECTORY) throw new Error("OWNED_DIRECTORY_INVALID");
  const rootPath = await realpath(join(basePath, args.runId));
  if (!isWithin(basePath, rootPath) || dirname(rootPath) !== basePath || basename(rootPath) !== args.runId) throw new Error("OWNED_DIRECTORY_INVALID");
  const name = "run-" + String(args.runNumber).padStart(2, "0");
  const runDirectory = await realpath(join(rootPath, name));
  if (!isWithin(rootPath, runDirectory) || dirname(runDirectory) !== rootPath || basename(runDirectory) !== name) throw new Error("OWNED_DIRECTORY_INVALID");
  return { repositoryRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."), runDirectory };
}

async function copyMediumSample(runDirectory: string, signal: AbortSignal): Promise<{ sampleRoot: string; totalBytes: number }> {
  const definition = getBaselineSample("medium");
  if (!definition || definition.id !== MEDIUM_SAMPLE_ID || definition.generatorVersion !== MEDIUM_GENERATOR_VERSION || definition.files.length !== MEDIUM_FILE_COUNT) {
    throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
  }
  const requestedRoot = join(runDirectory, "sample");
  await mkdir(requestedRoot, { recursive: false });
  const sampleRoot = await realpath(requestedRoot);
  if (!isWithin(runDirectory, sampleRoot) || dirname(sampleRoot) !== runDirectory) throw new Error("OWNED_DIRECTORY_INVALID");
  const writtenFiles: Array<{ path: string; language: string; bytes: number; sha256: string }> = [];
  let totalBytes = 0;
  for (const file of definition.files) {
    if (signal.aborted) throw new Error("CANCELLED");
    const content = getGeneratedSampleContent(definition.id, file.path);
    if (content === undefined) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
    const data = Buffer.from(content, "utf8");
    if (data.byteLength !== file.bytes || data.byteLength > MAX_FILE_BYTES || hash(data) !== file.sha256) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
    totalBytes += data.byteLength;
    if (totalBytes > MAX_SAMPLE_BYTES) throw new Error("SAMPLE_SIZE_OUT_OF_RANGE");
    const targetPath = resolve(sampleRoot, ...file.path.split("/"));
    if (!isWithin(sampleRoot, targetPath)) throw new Error("SAMPLE_PATH_INVALID");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data, { flag: "wx" });
    if (signal.aborted) throw new Error("CANCELLED");
    writtenFiles.push({ path: file.path, language: file.language, bytes: data.byteLength, sha256: hash(data) });
  }
  if (canonicalJson(writtenFiles) !== canonicalJson(definition.files) || totalBytes !== definition.totalBytes) throw new Error("SAMPLE_SOURCE_MANIFEST_MISMATCH");
  return { sampleRoot, totalBytes };
}

function emptyProgressSummary(): NavigationOptimizedSummary["progress"] {
  const metric = () => ({ events: 0, firstElapsedMs: null, lastElapsedMs: null, lastCompleted: 0, total: 0 });
  const phases = () => ({ queued: metric(), discovering: metric(), reading: metric(), analyzing: metric(), verifying: metric(), persisting: metric() });
  return { cold: phases(), warm: phases() };
}

function emptyStoreMetrics(): NavigationOptimizedSummary["storage"] {
  const phases: readonly Phase[] = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"];
  const sources: readonly OptimizedStoreSource[] = ["indexProject", "getEvidence", "readSource"];
  const result = {} as NavigationOptimizedSummary["storage"];
  for (const phase of phases) {
    const phaseMetrics = {} as Record<OptimizedStoreSource, Record<OptimizedStoreMethod, MetricSummary>>;
    for (const source of sources) {
      phaseMetrics[source] = {
        loadSnapshot: createMetricSummary(),
        getEvidence: createMetricSummary(),
        readSnapshotSource: createMetricSummary(),
        loadIgnoreSettings: createMetricSummary(),
      };
    }
    result[phase] = phaseMetrics;
  }
  return result;
}

function emptyNavigationPhase(): NavigationPhaseSummary {
  return {
    wall: createMetricSummary(),
    nodeEvidenceCheck: createMetricSummary(),
    evidenceLoop: createMetricSummary(),
    canonicalizeAndHash: createMetricSummary(),
    counts: { nodesChecked: 0, evidenceExpected: 0, evidenceAttempted: 0, getEvidenceCalls: 0, readSourceCalls: 0, resolvedEvidence: 0, errors: 0 },
    api: { getEvidence: createMetricSummary(), readSource: createMetricSummary() },
  };
}

function emptyNavigationFullLoads(): NavigationFullLoadCounts {
  return { coldNavigation: { getEvidence: 0, readSource: 0, total: 0 }, warmNavigation: { getEvidence: 0, readSource: 0, total: 0 }, navigationTotal: 0 };
}

function countNavigationFullLoad(counts: NavigationFullLoadCounts, phase: Phase, source: ApiSource): void {
  if ((phase !== "coldNavigation" && phase !== "warmNavigation") || (source !== "getEvidence" && source !== "readSource")) return;
  const stage = counts[phase];
  const next = stage[source] + 1;
  const nextTotal = stage.total + 1;
  const nextNavigationTotal = counts.navigationTotal + 1;
  if (![next, nextTotal, nextNavigationTotal].every(Number.isSafeInteger)) throw new Error("METRIC_LIMIT_EXCEEDED");
  stage[source] = next;
  stage.total = nextTotal;
  counts.navigationTotal = nextNavigationTotal;
}

function recordStoreDuration(
  storage: NavigationOptimizedSummary["storage"],
  phase: Phase,
  source: ApiSource,
  method: OptimizedStoreMethod,
  elapsedMs: number,
): void {
  const bucket = source ?? "indexProject";
  recordMetric(storage[phase][bucket][method], elapsedMs);
}

function installStoreInstrumentation(
  storage: NavigationOptimizedSummary["storage"],
  navigationFullLoads: NavigationFullLoadCounts,
  current: () => { phase: Phase; source: ApiSource },
): () => void {
  const prototype = GraphStore.prototype;
  const restore: Array<() => void> = [];
  const originalLoad = prototype.loadSnapshot;
  const originalEvidence = prototype.getEvidence;
  const originalSource = prototype.readSnapshotSource;
  const originalIgnore = prototype.loadIgnoreSettings;

  const loadSnapshot: GraphStore["loadSnapshot"] = function (this: GraphStore, snapshotId) {
    const context = current();
    const started = performance.now();
    try { return originalLoad.call(this, snapshotId); }
    finally {
      recordStoreDuration(storage, context.phase, context.source, "loadSnapshot", Math.max(0, performance.now() - started));
      countNavigationFullLoad(navigationFullLoads, context.phase, context.source);
    }
  };
  const getEvidence: GraphStore["getEvidence"] = function (this: GraphStore, snapshotId, evidenceId) {
    const context = current();
    const started = performance.now();
    try { return originalEvidence.call(this, snapshotId, evidenceId); }
    finally { recordStoreDuration(storage, context.phase, context.source, "getEvidence", Math.max(0, performance.now() - started)); }
  };
  const readSnapshotSource: GraphStore["readSnapshotSource"] = function (this: GraphStore, snapshotId, filePath) {
    const context = current();
    const started = performance.now();
    try { return originalSource.call(this, snapshotId, filePath); }
    finally { recordStoreDuration(storage, context.phase, context.source, "readSnapshotSource", Math.max(0, performance.now() - started)); }
  };
  const loadIgnoreSettings: GraphStore["loadIgnoreSettings"] = function (this: GraphStore, repositoryId) {
    const context = current();
    const started = performance.now();
    try { return originalIgnore.call(this, repositoryId); }
    finally { recordStoreDuration(storage, context.phase, context.source, "loadIgnoreSettings", Math.max(0, performance.now() - started)); }
  };

  try {
    restore.push(patchPropertyWithRestore(prototype, "loadSnapshot", loadSnapshot));
    restore.push(patchPropertyWithRestore(prototype, "getEvidence", getEvidence));
    restore.push(patchPropertyWithRestore(prototype, "readSnapshotSource", readSnapshotSource));
    restore.push(patchPropertyWithRestore(prototype, "loadIgnoreSettings", loadIgnoreSettings));
  } catch (error) {
    for (const undo of restore.reverse()) undo();
    throw error;
  }
  return () => {
    for (const undo of restore.reverse()) undo();
  };
}

function nodeNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.nodes.map(({ id, kind, filePath, span, evidenceId }) => ({
    id,
    kind,
    ...(filePath ? { filePath } : {}),
    ...(span ? { span } : {}),
    ...(evidenceId ? { evidenceId } : {}),
  })).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function evidenceNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.evidence.map(({ id, analyzer, analyzerVersion, kind, confidence, span }) => ({ id, analyzer, analyzerVersion, kind, confidence, span }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

async function measurePart<T>(metric: MetricSummary, work: () => Promise<T> | T): Promise<T> {
  const started = performance.now();
  try { return await work(); }
  finally { recordMetric(metric, Math.max(0, performance.now() - started)); }
}

function makeReadSourceLocation(snapshot: ProjectSnapshot, evidence: Evidence): SourceSpan & { repositoryId: string; snapshotId: string; evidenceId: string } {
  return { ...evidence.span, repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, evidenceId: evidence.id };
}

async function resolveNavigation(
  snapshot: ProjectSnapshot,
  app: XRayApplication,
  metrics: NavigationPhaseSummary,
  setApiSource: (source: ApiSource) => void,
  signal: AbortSignal,
): Promise<NavigationResult> {
  const started = performance.now();
  const sample = getBaselineSample("medium");
  const sampleFiles = new Map((sample?.files ?? []).map((item) => [item.path, item]));
  const sampleContents = new Map((sample?.files ?? []).map((item) => [item.path, getGeneratedSampleContent(MEDIUM_SAMPLE_ID, item.path)]));
  const snapshotSourceFiles = new Map(snapshot.sourceFiles.map((item) => [item.filePath, item]));
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  const errors = new Set<string>();
  const resolved: Array<Record<string, unknown>> = [];
  metrics.counts.evidenceExpected = snapshot.evidence.length;

  try {
    await measurePart(metrics.nodeEvidenceCheck, () => {
      metrics.counts.nodesChecked = snapshot.nodes.length;
      for (const node of snapshot.nodes) {
        if (!node.evidenceId) continue;
        if (!evidenceIds.has(node.evidenceId)) errors.add("SAMPLE_NODE_EVIDENCE_MISSING");
        if (node.span && snapshot.evidence.find((item) => item.id === node.evidenceId)?.span.filePath !== node.span.filePath) {
          errors.add("SAMPLE_NODE_EVIDENCE_PATH_MISMATCH");
        }
      }
    });

    await measurePart(metrics.evidenceLoop, async () => {
      for (const evidence of snapshot.evidence) {
        if (signal.aborted) throw new Error("CANCELLED");
        metrics.counts.evidenceAttempted += 1;
        const sampleFile = sampleFiles.get(evidence.span.filePath);
        const expectedContent = sampleContents.get(evidence.span.filePath);
        const snapshotSourceFile = snapshotSourceFiles.get(evidence.span.filePath);
        if (!sampleFile || expectedContent === undefined || !snapshotSourceFile) {
          errors.add("SAMPLE_EVIDENCE_FILE_MISSING");
          continue;
        }
        try {
          metrics.counts.getEvidenceCalls += 1;
          setApiSource("getEvidence");
          const identified = app.getEvidence({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, evidenceId: evidence.id });
          setApiSource(null);
          if (signal.aborted) throw new Error("CANCELLED");

          metrics.counts.readSourceCalls += 1;
          setApiSource("readSource");
          const source = await app.readSource(makeReadSourceLocation(snapshot, evidence));
          setApiSource(null);
          if (signal.aborted) throw new Error("CANCELLED");
          const expectedResponse: NavigationEvidenceExpectation = {
            repositoryId: snapshot.repositoryId,
            snapshotId: snapshot.snapshotId,
            evidence,
            sampleFile,
            snapshotSourceFile,
            expectedContent,
          };
          for (const failure of navigationEvidenceResponseFailures(identified, source, expectedResponse)) errors.add(failure);
          resolved.push({
            evidenceId: identified.id,
            analyzer: identified.analyzer,
            analyzerVersion: identified.analyzerVersion,
            confidence: identified.confidence,
            span: identified.span,
            sourceHash: source.contentHash,
            workspaceStatus: source.workspaceStatus,
          });
        } catch (error) {
          setApiSource(null);
          if (signal.aborted || (error instanceof Error && error.message === "CANCELLED")) throw new Error("CANCELLED");
          errors.add("SAMPLE_NAVIGATION_READ_FAILED");
        }
      }
    });

    let navigationHash = "";
    await measurePart(metrics.canonicalizeAndHash, () => {
      resolved.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      const manifest = canonicalJson({ nodes: nodeNavigation(snapshot), evidence: evidenceNavigation(snapshot), resolved });
      navigationHash = hash(manifest);
    });
    metrics.counts.resolvedEvidence = resolved.length;
    metrics.counts.errors = errors.size;
    return { sha256: navigationHash, counts: { ...metrics.counts }, errors: [...errors].sort() };
  } finally {
    recordMetric(metrics.wall, Math.max(0, performance.now() - started));
    setApiSource(null);
  }
}

function expectedFilesMatchSnapshot(snapshot: ProjectSnapshot): boolean {
  const sample = getBaselineSample("medium");
  if (!sample) return false;
  const expected = sample.files.map((file) => ({ filePath: file.path, contentHash: file.sha256, bytes: file.bytes, language: file.language }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
  const actual = [...snapshot.sourceFiles].sort((left, right) => left.filePath.localeCompare(right.filePath));
  return canonicalJson(expected) === canonicalJson(actual);
}

function copyObserverPhase(source: NavigationCacheObserverSummaryV1["phases"]["coldNavigation"]): NavigationCacheObserverSummaryV1["phases"]["coldNavigation"] {
  const copyMap = <T extends readonly string[], V>(map: Record<T[number], V>, keys: T): Record<T[number], V> =>
    Object.fromEntries(keys.map((key) => [key, map[key as T[number]]])) as Record<T[number], V>;
  const checkpointCounts = Object.fromEntries(OBSERVER_CHECKPOINTS.map((checkpoint) => [checkpoint, copyMap(source.externalObservations[checkpoint], OBSERVER_OUTCOMES)])) as NavigationCacheObserverSummaryV1["phases"]["coldNavigation"]["externalObservations"];
  return {
    lookupDecisions: {
      getEvidence: copyMap(source.lookupDecisions.getEvidence, OBSERVER_LOOKUP_DECISIONS),
      readSource: copyMap(source.lookupDecisions.readSource, OBSERVER_LOOKUP_DECISIONS),
    },
    candidateBuilds: { attempted: source.candidateBuilds.attempted, installed: source.candidateBuilds.installed, discarded: source.candidateBuilds.discarded, rejectedByAdmission: source.candidateBuilds.rejectedByAdmission, failed: source.candidateBuilds.failed, cancelled: source.candidateBuilds.cancelled },
    buildRaceReasons: copyMap(source.buildRaceReasons, OBSERVER_RACE_REASONS),
    externalObservations: checkpointCounts,
    externalObservationCoverage: { complete: source.externalObservationCoverage.complete, checkpoints: copyMap(source.externalObservationCoverage.checkpoints, OBSERVER_CHECKPOINTS) },
    projectionAdmission: { evaluatedCount: source.projectionAdmission.evaluatedCount, acceptedCount: source.projectionAdmission.acceptedCount, acceptedBytesTotal: source.projectionAdmission.acceptedBytesTotal, maxAcceptedBytes: source.projectionAdmission.maxAcceptedBytes, overLimitCount: source.projectionAdmission.overLimitCount, invalidCount: source.projectionAdmission.invalidCount, limitBytes: source.projectionAdmission.limitBytes },
  };
}

function emptyObserverCoverage(): NavigationOptimizedSummary["externalObservationCoverage"] {
  const stage = () => ({ complete: false, checkpoints: { phase_start: false, lookup_validity: false, build_before: false, build_after: false, after_last_lookup: false } });
  return { coldNavigation: stage(), warmNavigation: stage() };
}

function makeOptimizedSummary(
  sampleTotalBytes: number,
  stages: NavigationOptimizedSummary["stages"],
  navigation: { cold: NavigationPhaseSummary; warm: NavigationPhaseSummary },
  navigationFullLoads: NavigationFullLoadCounts,
  observerStatus: NavigationOptimizedSummary["observer"]["status"],
  observerSummary: NavigationCacheObserverSummaryV1 | null,
  heapUsed: NavigationOptimizedSummary["heapUsed"],
  storage: NavigationOptimizedSummary["storage"],
  secureReadReplay: NavigationOptimizedSummary["secureReadReplay"],
  progress: NavigationOptimizedSummary["progress"],
  cold: ProjectSnapshot,
  warm: ProjectSnapshot,
  coldNavigation: NavigationResult,
  warmNavigation: NavigationResult,
): NavigationOptimizedSummary {
  const pair = compareSnapshotPair(cold, warm, coldNavigation.sha256, warmNavigation.sha256);
  const expectedSourceFilesEqual = expectedFilesMatchSnapshot(cold) && expectedFilesMatchSnapshot(warm);
  const bothSnapshotsHealthy = cold.health.status === "ready" && warm.health.status === "ready"
    && cold.health.failedFiles.length === 0 && warm.health.failedFiles.length === 0;
  const navigationResolved = coldNavigation.errors.length === 0 && warmNavigation.errors.length === 0
    && coldNavigation.counts.resolvedEvidence === EXPECTED_EVIDENCE_COUNT
    && warmNavigation.counts.resolvedEvidence === EXPECTED_EVIDENCE_COUNT
    && coldNavigation.counts.evidenceAttempted === EXPECTED_EVIDENCE_COUNT
    && warmNavigation.counts.evidenceAttempted === EXPECTED_EVIDENCE_COUNT
    && coldNavigation.counts.getEvidenceCalls === EXPECTED_EVIDENCE_COUNT
    && warmNavigation.counts.getEvidenceCalls === EXPECTED_EVIDENCE_COUNT
    && coldNavigation.counts.readSourceCalls === EXPECTED_EVIDENCE_COUNT
    && warmNavigation.counts.readSourceCalls === EXPECTED_EVIDENCE_COUNT;
  const checks: NavigationOptimizedSummary["semanticGates"]["checks"] = {
    sourceFilesEqual: pair.checks.sourceFilesEqual === true,
    canonicalFactsEqual: pair.checks.canonicalFactsEqual === true,
    persistedPayloadEqual: pair.checks.persistedPayloadEqual === true,
    sameSnapshotIdentity: pair.checks.sameSnapshotIdentity === true,
    originalCreatedAtPreserved: pair.checks.originalCreatedAtPreserved === true,
    stableNodeNavigation: pair.checks.stableNodeNavigation === true,
    stableEvidenceNavigation: pair.checks.stableEvidenceNavigation === true,
    stableResolvedSourceNavigation: pair.checks.stableResolvedSourceNavigation === true,
    expectedSourceFilesEqual,
    bothSnapshotsHealthy,
    navigationResolved,
  };
  const failures = [...pair.failureCodes];
  if (!expectedSourceFilesEqual) failures.push("SAMPLE_SOURCE_MANIFEST_MISMATCH");
  if (!bothSnapshotsHealthy) failures.push("SAMPLE_HEALTH_NOT_READY");
  if (!navigationResolved) failures.push(...coldNavigation.errors, ...warmNavigation.errors, "SAMPLE_NAVIGATION_INCOMPLETE");
  if (cold.evidence.length !== EXPECTED_EVIDENCE_COUNT || warm.evidence.length !== EXPECTED_EVIDENCE_COUNT) failures.push("SAMPLE_EVIDENCE_COUNT_MISMATCH");
  if (cold.evidence.length > NAVIGATION_OPTIMIZED_MAX_EVIDENCE || warm.evidence.length > NAVIGATION_OPTIMIZED_MAX_EVIDENCE) failures.push("SAMPLE_TOOL_LIMIT_EXCEEDED");
  const uniqueFailures = [...new Set(failures)].sort();
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
  const enabled = observerStatus === "enabled" && observerSummary?.contractVersion === "xray.navigation-cache-observer.v1";
  const effectiveObserverStatus = observerStatus === "enabled" && !enabled ? "version_mismatch" : observerStatus;
  const observerPhases = enabled ? {
    coldNavigation: copyObserverPhase(observerSummary.phases.coldNavigation),
    warmNavigation: copyObserverPhase(observerSummary.phases.warmNavigation),
  } : null;
  const summary: NavigationOptimizedSummary = {
    schemaVersion: 2,
    sample: { id: MEDIUM_SAMPLE_ID, generatorVersion: MEDIUM_GENERATOR_VERSION, fileCount: sample.files.length, totalBytes: sampleTotalBytes, evidenceExpected: EXPECTED_EVIDENCE_COUNT },
    runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch },
    snapshot: {
      healthStatus: cold.health.status,
      files: cold.health.totalFiles,
      nodes: cold.nodes.length,
      edges: cold.edges.length,
      evidence: cold.evidence.length,
      unknownEdges: cold.edges.filter((edge) => edge.confidence === "unknown").length,
    },
    stages,
    navigation: { cold: navigation.cold, warm: navigation.warm },
    navigationFullLoads: {
      coldNavigation: { ...navigationFullLoads.coldNavigation },
      warmNavigation: { ...navigationFullLoads.warmNavigation },
      navigationTotal: navigationFullLoads.navigationTotal,
      fullLoadOpportunityCount: 4_708,
      maximumWithCompleteNoExternalChangeObservation: 2,
    },
    observer: { status: effectiveObserverStatus, contractVersion: enabled ? observerSummary.contractVersion : null },
    lookupDecisions: observerPhases ? { coldNavigation: observerPhases.coldNavigation.lookupDecisions, warmNavigation: observerPhases.warmNavigation.lookupDecisions } : null,
    candidateBuilds: observerPhases ? { coldNavigation: observerPhases.coldNavigation.candidateBuilds, warmNavigation: observerPhases.warmNavigation.candidateBuilds } : null,
    buildRaceReasons: observerPhases ? { coldNavigation: observerPhases.coldNavigation.buildRaceReasons, warmNavigation: observerPhases.warmNavigation.buildRaceReasons } : null,
    externalObservations: observerPhases ? { coldNavigation: observerPhases.coldNavigation.externalObservations, warmNavigation: observerPhases.warmNavigation.externalObservations } : null,
    externalObservationCoverage: observerPhases ? { coldNavigation: observerPhases.coldNavigation.externalObservationCoverage, warmNavigation: observerPhases.warmNavigation.externalObservationCoverage } : emptyObserverCoverage(),
    projectionAdmission: observerPhases ? { coldNavigation: observerPhases.coldNavigation.projectionAdmission, warmNavigation: observerPhases.warmNavigation.projectionAdmission } : null,
    heapUsed,
    storage,
    secureReadReplay,
    progress,
    semanticGates: { passed: uniqueFailures.length === 0, checks, failureCodes: uniqueFailures },
    optimizationGate: { status: "failed", navigationFullSnapshotLoads: navigationFullLoads.navigationTotal, maximumWithCompleteNoExternalChangeObservation: 2, failureCodes: [] },
  };
  summary.optimizationGate = deriveOptimizationGate(summary);
  return summary;
}

function fixedFailureCode(error: unknown): string {
  if (error instanceof Error) {
    const allowed = new Set([
      "CHILD_ARGUMENT_INVALID",
      "OWNED_DIRECTORY_INVALID",
      "SAMPLE_GENERATOR_MANIFEST_INVALID",
      "SAMPLE_SOURCE_MANIFEST_MISMATCH",
      "SAMPLE_SIZE_OUT_OF_RANGE",
      "SAMPLE_PATH_INVALID",
      "SAMPLE_EVIDENCE_COUNT_MISMATCH",
      "SAMPLE_TOOL_LIMIT_EXCEEDED",
      "METRIC_LIMIT_EXCEEDED",
      "CHILD_PROTOCOL_LIMIT",
    ]);
    if (allowed.has(error.message)) return error.message;
    if (error.message === "CANCELLED") return "CANCELLED";
  }
  return "OPTIMIZED_OPERATION_FAILED";
}

function startCancelListener(controller: AbortController): () => void {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (Buffer.byteLength(line, "utf8") > 128) return;
    try {
      const message: unknown = JSON.parse(line);
      if (isRecord(message) && Object.keys(message).length === 1 && message.type === "cancel") controller.abort();
    } catch {
      // Invalid parent input cannot trigger cancellation or change the run.
    }
  });
  return () => input.close();
}

async function runChild(): Promise<void> {
  let args: ChildArguments | undefined;
  let app: XRayApplication | undefined;
  let observerScope: NavigationCacheObservationScopeV1 | null = null;
  let observerStatus: NavigationOptimizedSummary["observer"]["status"] = "unavailable";
  let observerSummary: NavigationCacheObserverSummaryV1 | null = null;
  let observerCallFailed = false;
  let restoreInstrumentation = (): void => undefined;
  let closeCancelListener = (): void => undefined;
  const controller = new AbortController();
  let phase: Phase = "setup";
  let apiSource: ApiSource = null;
  const storage = emptyStoreMetrics();
  const navigationFullLoads = emptyNavigationFullLoads();
  const stages: NavigationOptimizedSummary["stages"] = {
    setup: createMetricSummary(),
    coldIndex: createMetricSummary(),
    warmIndex: createMetricSummary(),
    secureReadReplay: createMetricSummary(),
    gateEvaluation: createMetricSummary(),
    appClose: createMetricSummary(),
  };
  const navigation = { cold: emptyNavigationPhase(), warm: emptyNavigationPhase() };
  const heapUsed: NavigationOptimizedSummary["heapUsed"] = { coldNavigation: { beforeBytes: 0, afterBytes: 0 }, warmNavigation: { beforeBytes: 0, afterBytes: 0 } };
  const secureReadReplay = { calls: createMetricSummary(), bytesRead: 0 };
  const progress = emptyProgressSummary();
  let terminal: OptimizedChildTerminal = { type: "terminal", status: "failed", code: "OPTIMIZED_OPERATION_FAILED" };
  const setupStarted = performance.now();
  try {
    args = parseChildArguments(process.argv.slice(2));
    closeCancelListener = startCancelListener(controller);
    const { runDirectory } = await locateOwnedRunDirectory(args);
    const sample = getBaselineSample("medium");
    if (!sample) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
    let sampleRoot = "";
    let totalBytes = 0;
    let databaseRoot = "";
    const copied = await copyMediumSample(runDirectory, controller.signal);
    sampleRoot = copied.sampleRoot;
    totalBytes = copied.totalBytes;
    const requestedDatabaseRoot = join(runDirectory, "db");
    await mkdir(requestedDatabaseRoot, { recursive: false });
    databaseRoot = await realpath(requestedDatabaseRoot);
    if (!isWithin(runDirectory, databaseRoot) || dirname(databaseRoot) !== runDirectory) throw new Error("OWNED_DIRECTORY_INVALID");
    app = new XRayApplication({
      databasePath: join(databaseRoot, "legacy.sqlite"),
      projectDatabaseRoot: join(databaseRoot, "projects"),
      cacheRoot: join(databaseRoot, "cache"),
    });
    restoreInstrumentation = installStoreInstrumentation(storage, navigationFullLoads, () => ({ phase, source: apiSource }));
    try {
      observerScope = app.openNavigationCacheObservationV1();
      observerStatus = observerScope ? "enabled" : "unavailable";
    } catch {
      observerScope = null;
      observerStatus = "unavailable";
    }
    const originalGetEvidence = app.getEvidence;
    const originalReadSource = app.readSource;
    const measuredGetEvidence: XRayApplication["getEvidence"] = function (this: XRayApplication, input) {
      const previous = apiSource;
      apiSource = "getEvidence";
      const started = performance.now();
      try { return originalGetEvidence.call(this, input); }
      finally {
        const metric = phase === "coldNavigation" ? navigation.cold.api.getEvidence : phase === "warmNavigation" ? navigation.warm.api.getEvidence : null;
        if (metric) recordMetric(metric, Math.max(0, performance.now() - started));
        apiSource = previous;
      }
    };
    const measuredReadSource: XRayApplication["readSource"] = async function (this: XRayApplication, location) {
      const previous = apiSource;
      apiSource = "readSource";
      const started = performance.now();
      try { return await originalReadSource.call(this, location); }
      finally {
        const metric = phase === "coldNavigation" ? navigation.cold.api.readSource : phase === "warmNavigation" ? navigation.warm.api.readSource : null;
        if (metric) recordMetric(metric, Math.max(0, performance.now() - started));
        apiSource = previous;
      }
    };
    const restoreGet = patchPropertyWithRestore(app, "getEvidence", measuredGetEvidence);
    try {
      const restoreRead = patchPropertyWithRestore(app, "readSource", measuredReadSource);
      const restoreStore = restoreInstrumentation;
      restoreInstrumentation = () => {
        restoreRead();
        restoreGet();
        restoreStore();
      };
    } catch (error) {
      restoreGet();
      throw error;
    }
    recordMetric(stages.setup, Math.max(0, performance.now() - setupStarted));
    if (!app) throw new Error("OPTIMIZED_OPERATION_FAILED");
    if (controller.signal.aborted) throw new Error("CANCELLED");

    const measureIndex = async (stage: "cold" | "warm") => {
      const indexPhase: Phase = stage === "cold" ? "coldIndex" : "warmIndex";
      phase = indexPhase;
      const indexStarted = performance.now();
      try {
        const snapshot = await app!.indexProject(sampleRoot, "local", {
          signal: controller.signal,
          onProgress: (event: IndexProgress) => {
            const elapsedMs = Math.max(0, performance.now() - indexStarted);
            const item: OptimizedChildProgress = {
              type: "progress",
              stage,
              phase: event.phase,
              elapsedMs,
              completed: event.completed,
              total: event.total,
            };
            const phaseProgress = progress[stage][event.phase];
            if (phaseProgress.events === 0) phaseProgress.firstElapsedMs = elapsedMs;
            phaseProgress.events += 1;
            phaseProgress.lastElapsedMs = elapsedMs;
            phaseProgress.lastCompleted = event.completed;
            phaseProgress.total = event.total;
            emit(item);
          },
        });
        recordMetric(stages[indexPhase], Math.max(0, performance.now() - indexStarted));
        return snapshot;
      } catch (error) {
        if (stages[indexPhase].count === 0) recordMetric(stages[indexPhase], Math.max(0, performance.now() - indexStarted));
        throw error;
      } finally {
        phase = "setup";
      }
    };

    const cold = await measureIndex("cold");
    if (cold.evidence.length !== EXPECTED_EVIDENCE_COUNT) throw new Error("SAMPLE_EVIDENCE_COUNT_MISMATCH");
    const coldNav = navigation.cold;
    heapUsed.coldNavigation.beforeBytes = process.memoryUsage().heapUsed;
    try { observerScope?.beginPhase("coldNavigation", { repositoryId: cold.repositoryId, snapshotId: cold.snapshotId }); }
    catch { observerCallFailed = true; }
    phase = "coldNavigation";
    let coldNavigation: NavigationResult;
    try { coldNavigation = await resolveNavigation(cold, app, coldNav, (source) => { apiSource = source; }, controller.signal); }
    finally {
      phase = "setup";
      apiSource = null;
      try { observerScope?.endPhase("coldNavigation"); } catch { observerCallFailed = true; }
      heapUsed.coldNavigation.afterBytes = process.memoryUsage().heapUsed;
    }

    if (controller.signal.aborted) throw new Error("CANCELLED");
    const warm = await measureIndex("warm");
    if (warm.evidence.length !== EXPECTED_EVIDENCE_COUNT) throw new Error("SAMPLE_EVIDENCE_COUNT_MISMATCH");
    const warmNav = navigation.warm;
    heapUsed.warmNavigation.beforeBytes = process.memoryUsage().heapUsed;
    try { observerScope?.beginPhase("warmNavigation", { repositoryId: warm.repositoryId, snapshotId: warm.snapshotId }); }
    catch { observerCallFailed = true; }
    phase = "warmNavigation";
    let warmNavigation: NavigationResult;
    try { warmNavigation = await resolveNavigation(warm, app, warmNav, (source) => { apiSource = source; }, controller.signal); }
    finally {
      phase = "setup";
      apiSource = null;
      try { observerScope?.endPhase("warmNavigation"); } catch { observerCallFailed = true; }
      heapUsed.warmNavigation.afterBytes = process.memoryUsage().heapUsed;
    }
    if (observerScope) {
      try { observerSummary = observerScope.getSummary(); }
      catch { observerCallFailed = true; }
      try { observerScope.dispose(); }
      catch { observerCallFailed = true; }
      observerScope = null;
      if (observerCallFailed) {
        observerStatus = "unavailable";
        observerSummary = null;
      } else if (observerSummary?.contractVersion !== "xray.navigation-cache-observer.v1") {
        observerStatus = "version_mismatch";
        observerSummary = null;
      } else {
        observerStatus = "enabled";
      }
    }

    const replayStarted = performance.now();
    phase = "secureReadReplay";
    let replayBytes = 0;
    let replayCount = 0;
    try {
      const knownFiles = new Set(warm.sourceFiles.map((item) => item.filePath));
      for (const evidence of warm.evidence) {
        if (controller.signal.aborted) throw new Error("CANCELLED");
        if (!knownFiles.has(evidence.span.filePath)) throw new Error("SAMPLE_SOURCE_MANIFEST_MISMATCH");
        const readStarted = performance.now();
        const content = await readProjectFile(warm.rootPath, evidence.span.filePath, { signal: controller.signal });
        recordMetric(secureReadReplay.calls, Math.max(0, performance.now() - readStarted));
        replayBytes += Buffer.byteLength(content, "utf8");
        replayCount += 1;
        if (controller.signal.aborted) throw new Error("CANCELLED");
      }
      if (replayCount !== EXPECTED_EVIDENCE_COUNT) throw new Error("SAMPLE_EVIDENCE_COUNT_MISMATCH");
      secureReadReplay.bytesRead = replayBytes;
      recordMetric(stages.secureReadReplay, Math.max(0, performance.now() - replayStarted));
    } catch (error) {
      if (stages.secureReadReplay.count === 0) recordMetric(stages.secureReadReplay, Math.max(0, performance.now() - replayStarted));
      throw error;
    } finally {
      phase = "setup";
    }
    if (controller.signal.aborted) throw new Error("CANCELLED");

    phase = "gateEvaluation";
    const gateStarted = performance.now();
    if (controller.signal.aborted) throw new Error("CANCELLED");
    const summary = makeOptimizedSummary(totalBytes, stages, navigation, navigationFullLoads, observerStatus, observerSummary, heapUsed, storage, secureReadReplay, progress, cold, warm, coldNavigation, warmNavigation);
    if (controller.signal.aborted) throw new Error("CANCELLED");
    recordMetric(stages.gateEvaluation, Math.max(0, performance.now() - gateStarted));
    phase = "setup";
    terminal = summary.semanticGates.passed && summary.optimizationGate.status !== "failed"
      ? { type: "terminal", status: "completed", code: "OK", summary }
      : { type: "terminal", status: "failed", code: summary.semanticGates.passed ? "OPTIMIZATION_GATE_FAILED" : "EQUIVALENCE_GATE_FAILED", summary };
  } catch (error) {
    terminal = controller.signal.aborted || (error instanceof Error && error.message === "CANCELLED")
      ? { type: "terminal", status: "cancelled", code: "CANCELLED" }
      : { type: "terminal", status: "failed", code: fixedFailureCode(error) };
  } finally {
    if (observerScope) {
      try { observerScope.dispose(); } catch { /* Observer cleanup must not replace the product result. */ }
      observerScope = null;
    }
    try { restoreInstrumentation(); }
    catch { terminal = { type: "terminal", status: "failed", code: "OPTIMIZED_OPERATION_FAILED" }; }
    if (app) {
      phase = "appClose";
      const closeStarted = performance.now();
      try { app.close(); }
      catch { terminal = { type: "terminal", status: "failed", code: "APPLICATION_CLOSE_FAILED" }; }
      finally {
        try { recordMetric(stages.appClose, Math.max(0, performance.now() - closeStarted)); }
        catch { terminal = { type: "terminal", status: "failed", code: "OPTIMIZED_OPERATION_FAILED" }; }
      }
    }
    closeCancelListener();
  }
  emit(terminal, true);
  if (terminal.status === "failed") process.exitCode = 1;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isMainModule()) {
  void runChild().catch(() => {
    try { emit({ type: "terminal", status: "failed", code: "OPTIMIZED_OPERATION_FAILED" }, true); }
    catch { process.exitCode = 1; }
    process.exitCode = 1;
  });
}
