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
import { XRayApplication } from "../packages/application/src/index.ts";
import { GraphStore } from "../packages/graph/src/index.ts";
import { compareSnapshotPair } from "./local-index-baseline.ts";
import { getBaselineSample, getGeneratedSampleContent, MEDIUM_FILE_COUNT, MEDIUM_GENERATOR_VERSION, MEDIUM_MAX_FILE_BYTES, MEDIUM_MAX_TOTAL_BYTES, MEDIUM_SAMPLE_ID } from "./local-index-baseline-samples.ts";
import {
  createMetricSummary,
  NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE,
  NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES,
  NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES,
  NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX,
  patchPropertyWithRestore,
  recordMetric,
  type DiagnosticChildProgress,
  type DiagnosticChildTerminal,
  type DiagnosticPhase,
  type DiagnosticStoreMethod,
  type DiagnosticStoreSource,
  type MetricSummary,
  type NavigationDiagnosticSummary,
  type NavigationPhaseSummary,
} from "./local-index-navigation-diagnostic.ts";

const RUNS_DIRECTORY = "project-xray-local-index-baseline-runs";
const EXPECTED_EVIDENCE_COUNT = 1_177;
const MAX_PROGRESS_LINES = 1_024;
const MAX_FILE_BYTES = MEDIUM_MAX_FILE_BYTES;
const MAX_SAMPLE_BYTES = MEDIUM_MAX_TOTAL_BYTES;

interface ChildArguments {
  runId: string;
  runNumber: number;
}

interface NavigationResult {
  sha256: string;
  counts: NavigationPhaseSummary["counts"];
  errors: string[];
}

type Phase = DiagnosticPhase;
type ApiSource = DiagnosticStoreSource | null;

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

function emit(value: DiagnosticChildProgress | DiagnosticChildTerminal, terminal = false): void {
  const line = NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + JSON.stringify(value) + "\n";
  const bytes = Buffer.byteLength(line, "utf8");
  const progressLimit = terminal ? NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES : NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES - 16 * 1_024;
  if (bytes > NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_LINE_BYTES || emittedBytes + bytes > progressLimit) throw new Error("CHILD_PROTOCOL_LIMIT");
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

function emptyProgressSummary(): NavigationDiagnosticSummary["progress"] {
  const metric = () => ({ events: 0, firstElapsedMs: null, lastElapsedMs: null, lastCompleted: 0, total: 0 });
  const phases = () => ({ queued: metric(), discovering: metric(), reading: metric(), analyzing: metric(), verifying: metric(), persisting: metric() });
  return { cold: phases(), warm: phases() };
}

function emptyStoreMetrics(): NavigationDiagnosticSummary["storage"] {
  const phases: readonly Phase[] = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"];
  const sources: readonly DiagnosticStoreSource[] = ["indexProject", "getEvidence", "readSource"];
  const methods: readonly DiagnosticStoreMethod[] = ["loadSnapshot", "getEvidence", "readSnapshotSource", "loadIgnoreSettings"];
  const result = {} as NavigationDiagnosticSummary["storage"];
  for (const phase of phases) {
    const phaseMetrics = {} as Record<DiagnosticStoreSource, Record<DiagnosticStoreMethod, MetricSummary>>;
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

function recordStoreDuration(
  storage: NavigationDiagnosticSummary["storage"],
  phase: Phase,
  source: ApiSource,
  method: DiagnosticStoreMethod,
  elapsedMs: number,
): void {
  const bucket = source ?? "indexProject";
  recordMetric(storage[phase][bucket][method], elapsedMs);
}

function installStoreInstrumentation(
  storage: NavigationDiagnosticSummary["storage"],
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
    finally { recordStoreDuration(storage, context.phase, context.source, "loadSnapshot", Math.max(0, performance.now() - started)); }
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
  const expectedHashes = new Map(snapshot.sourceFiles.map((item) => [item.filePath, item.contentHash]));
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
        if (!expectedHashes.has(evidence.span.filePath)) {
          errors.add("SAMPLE_EVIDENCE_FILE_MISSING");
          continue;
        }
        try {
          metrics.counts.getEvidenceCalls += 1;
          setApiSource("getEvidence");
          const identified = app.getEvidence({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, evidenceId: evidence.id });
          setApiSource(null);
          if (signal.aborted) throw new Error("CANCELLED");
          if (identified.id !== evidence.id || identified.snapshotId !== snapshot.snapshotId || identified.repositoryId !== snapshot.repositoryId) {
            errors.add("SAMPLE_EVIDENCE_LOOKUP_MISMATCH");
          }

          metrics.counts.readSourceCalls += 1;
          setApiSource("readSource");
          const source = await app.readSource(makeReadSourceLocation(snapshot, evidence));
          setApiSource(null);
          if (signal.aborted) throw new Error("CANCELLED");
          if (source.workspaceStatus !== "current" || source.contentHash !== expectedHashes.get(evidence.span.filePath)
            || source.evidence?.id !== evidence.id || source.targetSpan?.filePath !== evidence.span.filePath) {
            errors.add("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
          }
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

function makeDiagnosticSummary(
  sampleTotalBytes: number,
  stages: NavigationDiagnosticSummary["stages"],
  navigation: { cold: NavigationPhaseSummary; warm: NavigationPhaseSummary },
  storage: NavigationDiagnosticSummary["storage"],
  secureReadReplay: NavigationDiagnosticSummary["secureReadReplay"],
  progress: NavigationDiagnosticSummary["progress"],
  cold: ProjectSnapshot,
  warm: ProjectSnapshot,
  coldNavigation: NavigationResult,
  warmNavigation: NavigationResult,
): NavigationDiagnosticSummary {
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
  const checks: NavigationDiagnosticSummary["gates"]["checks"] = {
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
  if (cold.evidence.length > NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE || warm.evidence.length > NAVIGATION_DIAGNOSTIC_MAX_EVIDENCE) failures.push("SAMPLE_TOOL_LIMIT_EXCEEDED");
  const uniqueFailures = [...new Set(failures)].sort();
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("SAMPLE_GENERATOR_MANIFEST_INVALID");
  return {
    schemaVersion: 1,
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
    storage,
    secureReadReplay,
    progress,
    gates: { passed: uniqueFailures.length === 0, checks, failureCodes: uniqueFailures },
  };
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
  return "DIAGNOSTIC_OPERATION_FAILED";
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
  let restoreInstrumentation = (): void => undefined;
  let closeCancelListener = (): void => undefined;
  const controller = new AbortController();
  let phase: Phase = "setup";
  let apiSource: ApiSource = null;
  const storage = emptyStoreMetrics();
  const stages: NavigationDiagnosticSummary["stages"] = {
    setup: createMetricSummary(),
    coldIndex: createMetricSummary(),
    warmIndex: createMetricSummary(),
    secureReadReplay: createMetricSummary(),
    gateEvaluation: createMetricSummary(),
    appClose: createMetricSummary(),
  };
  const navigation = { cold: emptyNavigationPhase(), warm: emptyNavigationPhase() };
  const secureReadReplay = { calls: createMetricSummary(), bytesRead: 0 };
  const progress = emptyProgressSummary();
  let terminal: DiagnosticChildTerminal = { type: "terminal", status: "failed", code: "DIAGNOSTIC_OPERATION_FAILED" };
  const setupStarted = performance.now();
  try {
    args = parseChildArguments(process.argv.slice(2));
    closeCancelListener = startCancelListener(controller);
    const { repositoryRoot, runDirectory } = await locateOwnedRunDirectory(args);
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
    restoreInstrumentation = installStoreInstrumentation(storage, () => ({ phase, source: apiSource }));
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
    if (!app) throw new Error("DIAGNOSTIC_OPERATION_FAILED");
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
            const item: DiagnosticChildProgress = {
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
    phase = "coldNavigation";
    let coldNavigation: NavigationResult;
    try { coldNavigation = await resolveNavigation(cold, app, coldNav, (source) => { apiSource = source; }, controller.signal); }
    finally { phase = "setup"; apiSource = null; }

    if (controller.signal.aborted) throw new Error("CANCELLED");
    const warm = await measureIndex("warm");
    if (warm.evidence.length !== EXPECTED_EVIDENCE_COUNT) throw new Error("SAMPLE_EVIDENCE_COUNT_MISMATCH");
    const warmNav = navigation.warm;
    phase = "warmNavigation";
    let warmNavigation: NavigationResult;
    try { warmNavigation = await resolveNavigation(warm, app, warmNav, (source) => { apiSource = source; }, controller.signal); }
    finally { phase = "setup"; apiSource = null; }

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
    const summary = makeDiagnosticSummary(totalBytes, stages, navigation, storage, secureReadReplay, progress, cold, warm, coldNavigation, warmNavigation);
    if (controller.signal.aborted) throw new Error("CANCELLED");
    recordMetric(stages.gateEvaluation, Math.max(0, performance.now() - gateStarted));
    phase = "setup";
    terminal = summary.gates.passed
      ? { type: "terminal", status: "completed", code: "OK", summary }
      : { type: "terminal", status: "failed", code: "EQUIVALENCE_GATE_FAILED", summary };
  } catch (error) {
    terminal = controller.signal.aborted || (error instanceof Error && error.message === "CANCELLED")
      ? { type: "terminal", status: "cancelled", code: "CANCELLED" }
      : { type: "terminal", status: "failed", code: fixedFailureCode(error) };
  } finally {
    try { restoreInstrumentation(); }
    catch { terminal = { type: "terminal", status: "failed", code: "DIAGNOSTIC_OPERATION_FAILED" }; }
    if (app) {
      phase = "appClose";
      const closeStarted = performance.now();
      try { app.close(); }
      catch { terminal = { type: "terminal", status: "failed", code: "APPLICATION_CLOSE_FAILED" }; }
      finally {
        try { recordMetric(stages.appClose, Math.max(0, performance.now() - closeStarted)); }
        catch { terminal = { type: "terminal", status: "failed", code: "DIAGNOSTIC_OPERATION_FAILED" }; }
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
    try { emit({ type: "terminal", status: "failed", code: "DIAGNOSTIC_OPERATION_FAILED" }, true); }
    catch { process.exitCode = 1; }
    process.exitCode = 1;
  });
}
