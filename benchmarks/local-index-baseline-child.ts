import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { safeDiagnosticCodeSchema } from "../packages/contracts/src/index.ts";
import { canonicalJson, canonicalSnapshotContent, canonicalSnapshotResult } from "../packages/contracts/src/snapshot-content.ts";
import type { IndexProgress, ProjectSnapshot, SourceSpan } from "../packages/contracts/src/index.ts";
import { XRayApplication } from "../packages/application/src/index.ts";
import { compareSnapshotPair, type ChildSummary, type PhaseEvent, type SampleFileSummary, type SnapshotPairEvidence, type TimingSummary } from "./local-index-baseline.ts";
import { computeSampleManifestSha256, getBaselineSample, getGeneratedSampleContent, MEDIUM_MAX_FILE_BYTES, MEDIUM_MAX_TOTAL_BYTES, type BaselineSampleDefinition } from "./local-index-baseline-samples.ts";

const PROTOCOL_PREFIX = "XRAY_LOCAL_INDEX_BASELINE:";
const RUNS_DIRECTORY = "project-xray-local-index-baseline-runs";
const RSS_INTERVAL_MS = 20;
const MAX_FILE_BYTES = 4_096;
const MAX_TOTAL_SAMPLE_BYTES = 16_384;

interface ChildArguments { runId: string; runNumber: number; sampleId: string }
interface NavigationResult { sha256: string; nodeCount: number; evidenceCount: number; resolvedEvidenceCount: number; errors: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function parseChildArguments(args: string[]): ChildArguments {
  if (args.length !== 6 || args[0] !== "--run-id" || args[2] !== "--run-number" || args[4] !== "--sample-id") throw new Error("CHILD_ARGUMENT_INVALID");
  const runId = args[1];
  const numberText = args[3];
  const sampleId = args[5];
  if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId) || !numberText || !/^\d{1,2}$/.test(numberText) || !sampleId || !getBaselineSample(sampleId)) throw new Error("CHILD_ARGUMENT_INVALID");
  const runNumber = Number(numberText);
  if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > 5) throw new Error("CHILD_ARGUMENT_INVALID");
  return { runId, runNumber, sampleId };
}

function emit(value: Record<string, unknown>): void {
  process.stdout.write(`${PROTOCOL_PREFIX}${JSON.stringify(value)}\n`);
}

async function locateOwnedRunDirectory(args: ChildArguments): Promise<{ repoRoot: string; runDirectory: string }> {
  const [tempRoot, basePath] = await Promise.all([realpath(tmpdir()), realpath(join(tmpdir(), RUNS_DIRECTORY))]);
  if (!isWithin(tempRoot, basePath) || dirname(basePath) !== tempRoot) throw new Error("OWNED_DIRECTORY_INVALID");
  const invocationPath = await realpath(join(basePath, args.runId));
  if (!isWithin(basePath, invocationPath)) throw new Error("OWNED_DIRECTORY_INVALID");
  const runName = `run-${String(args.runNumber).padStart(2, "0")}`;
  const requestedRunPath = join(invocationPath, runName);
  const runDirectory = await realpath(requestedRunPath);
  if (!isWithin(invocationPath, runDirectory) || dirname(runDirectory) !== invocationPath) throw new Error("OWNED_DIRECTORY_INVALID");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  return { repoRoot, runDirectory };
}

async function copySelectedSample(repoRoot: string, runDirectory: string, definition: BaselineSampleDefinition): Promise<{ sampleRoot: string; files: SampleFileSummary[]; manifestSha256: string }> {
  const sourceRoot = join(repoRoot, "test-fixtures", "e2e-project");
  const requestedSampleRoot = join(runDirectory, "sample");
  await mkdir(requestedSampleRoot, { recursive: false });
  const sampleRoot = await realpath(requestedSampleRoot);
  if (!isWithin(runDirectory, sampleRoot) || dirname(sampleRoot) !== runDirectory) throw new Error("OWNED_DIRECTORY_INVALID");
  const files: SampleFileSummary[] = [];
  let totalBytes = 0;
  for (const fixture of definition.files) {
    const content = definition.kind === "small"
      ? await readFile(join(sourceRoot, ...fixture.path.split("/")))
      : Buffer.from(getGeneratedSampleContent(definition.id, fixture.path) ?? "", "utf8");
    const fixtureLimit = definition.kind === "small" ? MAX_FILE_BYTES : MEDIUM_MAX_FILE_BYTES;
    if (content.length !== fixture.bytes || content.length > fixtureLimit || hash(content) !== fixture.sha256) {
      throw new Error(definition.kind === "small" ? "SAMPLE_FIXTURE_CHANGED" : "SAMPLE_GENERATOR_MANIFEST_INVALID");
    }
    totalBytes += content.length;
    const totalLimit = definition.kind === "small" ? MAX_TOTAL_SAMPLE_BYTES : MEDIUM_MAX_TOTAL_BYTES;
    if (totalBytes > totalLimit) throw new Error("SAMPLE_SIZE_OUT_OF_RANGE");
    const targetPath = resolve(sampleRoot, ...fixture.path.split("/"));
    if (!isWithin(sampleRoot, targetPath)) throw new Error("SAMPLE_PATH_INVALID");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, { flag: "wx" });
    files.push({ path: fixture.path, language: fixture.language, bytes: content.length, sha256: fixture.sha256 });
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (canonicalJson(files) !== canonicalJson(definition.files) || totalBytes !== definition.totalBytes
    || computeSampleManifestSha256(definition.id, files) !== definition.manifestSha256) throw new Error("SAMPLE_SOURCE_MANIFEST_MISMATCH");
  return { sampleRoot, files, manifestSha256: definition.manifestSha256 };
}

function beginRssSampling(): { finish: () => TimingSummary["rss"] } {
  const startBytes = process.memoryUsage().rss;
  let peakSampledBytes = startBytes;
  let samples = 1;
  let result: TimingSummary["rss"] | undefined;
  const timer = setInterval(() => {
    const rss = process.memoryUsage().rss;
    peakSampledBytes = Math.max(peakSampledBytes, rss);
    samples += 1;
  }, RSS_INTERVAL_MS);
  return {
    finish: () => {
      if (result) return result;
      clearInterval(timer);
      const rss = process.memoryUsage().rss;
      peakSampledBytes = Math.max(peakSampledBytes, rss);
      samples += 1;
      result = { source: "Node child process process.memoryUsage().rss", intervalMs: RSS_INTERVAL_MS, startBytes, peakSampledBytes, samples };
      return result;
    },
  };
}

async function measureIndex(
  app: XRayApplication,
  sampleRoot: string,
  stage: "cold" | "warm",
  signal: AbortSignal,
): Promise<{ snapshot: ProjectSnapshot; timing: TimingSummary }> {
  const start = performance.now();
  const events: PhaseEvent[] = [];
  const sampler = beginRssSampling();
  try {
    const snapshot = await app.indexProject(sampleRoot, "local", {
      signal,
      onProgress: (event: IndexProgress) => {
        const progress = { stage, phase: event.phase, elapsedMs: Math.max(0, performance.now() - start), completed: event.completed, total: event.total };
        events.push(progress);
        emit({ type: "progress", ...progress });
      },
    });
    const elapsedMs = Math.max(0, performance.now() - start);
    return { snapshot, timing: { elapsedMs, rss: sampler.finish(), phaseEvents: events } };
  } finally {
    sampler.finish();
  }
}

function nodeNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.nodes.map(({ id, kind, filePath, span, evidenceId }) => ({ id, kind, ...(filePath ? { filePath } : {}), ...(span ? { span } : {}), ...(evidenceId ? { evidenceId } : {}) }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function evidenceNavigation(snapshot: ProjectSnapshot): unknown[] {
  return snapshot.evidence.map(({ id, analyzer, analyzerVersion, kind, confidence, span }) => ({ id, analyzer, analyzerVersion, kind, confidence, span }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

async function resolveNavigation(snapshot: ProjectSnapshot, app: XRayApplication): Promise<NavigationResult> {
  const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  const expectedFileHashes = new Map(snapshot.sourceFiles.map((item) => [item.filePath, item.contentHash]));
  const errors: string[] = [];
  const resolved: Array<Record<string, unknown>> = [];
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  for (const node of snapshot.nodes) {
    if (!node.evidenceId) continue;
    if (!evidenceIds.has(node.evidenceId)) errors.push("SAMPLE_NODE_EVIDENCE_MISSING");
    if (node.span && snapshot.evidence.find((item) => item.id === node.evidenceId)?.span.filePath !== node.span.filePath) errors.push("SAMPLE_NODE_EVIDENCE_PATH_MISMATCH");
  }
  for (const evidence of snapshot.evidence) {
    if (!expectedFileHashes.has(evidence.span.filePath)) {
      errors.push("SAMPLE_EVIDENCE_FILE_MISSING");
      continue;
    }
    try {
      const identified = app.getEvidence({ ...ref, evidenceId: evidence.id });
      if (identified.id !== evidence.id || identified.snapshotId !== snapshot.snapshotId || identified.repositoryId !== snapshot.repositoryId) errors.push("SAMPLE_EVIDENCE_LOOKUP_MISMATCH");
      const location: SourceSpan & { repositoryId: string; snapshotId: string; evidenceId: string } = { ...evidence.span, ...ref, evidenceId: evidence.id };
      const source = await app.readSource(location);
      if (source.workspaceStatus !== "current" || source.contentHash !== expectedFileHashes.get(evidence.span.filePath) || source.evidence?.id !== evidence.id || source.targetSpan?.filePath !== evidence.span.filePath) errors.push("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
      resolved.push({ evidenceId: identified.id, analyzer: identified.analyzer, analyzerVersion: identified.analyzerVersion, confidence: identified.confidence, span: identified.span, sourceHash: source.contentHash, workspaceStatus: source.workspaceStatus });
    } catch {
      errors.push("SAMPLE_NAVIGATION_READ_FAILED");
    }
  }
  resolved.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const manifest = canonicalJson({ nodes: nodeNavigation(snapshot), evidence: evidenceNavigation(snapshot), resolved });
  return { sha256: hash(manifest), nodeCount: snapshot.nodes.length, evidenceCount: snapshot.evidence.length, resolvedEvidenceCount: resolved.length, errors: [...new Set(errors)].sort() };
}

function expectedFilesMatchSnapshot(files: readonly SampleFileSummary[], snapshot: ProjectSnapshot): boolean {
  const expected = files.map((item) => ({ filePath: item.path, contentHash: item.sha256, bytes: item.bytes, language: item.language })).sort((a, b) => a.filePath.localeCompare(b.filePath));
  const actual = [...snapshot.sourceFiles].sort((a, b) => a.filePath.localeCompare(b.filePath));
  return canonicalJson(expected) === canonicalJson(actual);
}

function pairEvidence(snapshot: ProjectSnapshot, navigation: NavigationResult, sampleId: string): SnapshotPairEvidence {
  const sourceFiles = snapshot.sourceFiles.map((item) => ({ path: item.filePath, language: item.language, bytes: item.bytes, sha256: item.contentHash }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    sourceManifestSha256: computeSampleManifestSha256(sampleId, sourceFiles),
    sourceFileCount: sourceFiles.length,
    canonicalFactsSha256: hash(canonicalSnapshotResult(snapshot)),
    persistedPayloadSha256: hash(canonicalSnapshotContent(snapshot)),
    repositoryId: snapshot.repositoryId,
    snapshotId: snapshot.snapshotId,
    originalCreatedAt: snapshot.createdAt,
    healthStatus: snapshot.health.status,
    indexedFiles: snapshot.health.indexedFiles,
    totalFiles: snapshot.health.totalFiles,
    failedFiles: snapshot.health.failedFiles.length,
    nodeNavigationSha256: hash(canonicalJson(nodeNavigation(snapshot))),
    evidenceNavigationSha256: hash(canonicalJson(evidenceNavigation(snapshot))),
    nodeCount: navigation.nodeCount,
    edgeCount: snapshot.edges.length,
    unknownEdgeCount: snapshot.edges.filter((edge) => edge.confidence === "unknown").length,
    evidenceCount: navigation.evidenceCount,
    resolvedEvidenceCount: navigation.resolvedEvidenceCount,
    resolvedNavigationSha256: navigation.sha256,
    navigationErrors: navigation.errors,
  };
}

function safeFailureCode(error: unknown): string {
  const fixedCodes = new Set([
    "CHILD_ARGUMENT_INVALID", "OWNED_DIRECTORY_INVALID", "SAMPLE_FIXTURE_CHANGED", "SAMPLE_SIZE_OUT_OF_RANGE", "SAMPLE_PATH_INVALID",
    "SAMPLE_SOURCE_MANIFEST_MISMATCH", "SAMPLE_GENERATOR_MANIFEST_INVALID", "APPLICATION_CLOSE_FAILED", "CHILD_OPERATION_FAILED",
  ]);
  if (error instanceof Error && fixedCodes.has(error.message)) return error.message;
  if (isRecord(error) && typeof error.code === "string") {
    const parsed = safeDiagnosticCodeSchema.safeParse(error.code);
    if (parsed.success) return parsed.data;
  }
  return "CHILD_OPERATION_FAILED";
}

function startCancelListener(controller: AbortController): () => void {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (line.length > 128) return;
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value) && Object.keys(value).length === 1 && value.type === "cancel") controller.abort();
    } catch { /* malformed parent messages have no effect */ }
  });
  return () => input.close();
}

async function run(): Promise<void> {
  let childArgs: ChildArguments | undefined;
  let app: XRayApplication | undefined;
  let closeCancelListener = (): void => undefined;
  let controller: AbortController | undefined;
  let terminal: { status: "completed" | "failed" | "cancelled"; code: string; summary?: ChildSummary };
  try {
    childArgs = parseChildArguments(process.argv.slice(2));
    controller = new AbortController();
    closeCancelListener = startCancelListener(controller);
    const { repoRoot, runDirectory } = await locateOwnedRunDirectory(childArgs);
    const definition = getBaselineSample(childArgs.sampleId);
    if (!definition) throw new Error("CHILD_ARGUMENT_INVALID");
    const sample = await copySelectedSample(repoRoot, runDirectory, definition);
    const requestedDatabaseRoot = join(runDirectory, "db");
    await mkdir(requestedDatabaseRoot, { recursive: false });
    const databaseRoot = await realpath(requestedDatabaseRoot);
    if (!isWithin(runDirectory, databaseRoot) || dirname(databaseRoot) !== runDirectory) throw new Error("OWNED_DIRECTORY_INVALID");
    app = new XRayApplication({ databasePath: join(databaseRoot, "legacy.sqlite"), projectDatabaseRoot: join(databaseRoot, "projects"), cacheRoot: join(databaseRoot, "cache") });
    const cold = await measureIndex(app, sample.sampleRoot, "cold", controller.signal);
    const coldNavigation = await resolveNavigation(cold.snapshot, app);
    const warm = await measureIndex(app, sample.sampleRoot, "warm", controller.signal);
    const warmNavigation = await resolveNavigation(warm.snapshot, app);
    const pair = compareSnapshotPair(cold.snapshot, warm.snapshot, coldNavigation.sha256, warmNavigation.sha256);
    const expectedSourceFilesEqual = expectedFilesMatchSnapshot(definition.files, cold.snapshot) && expectedFilesMatchSnapshot(definition.files, warm.snapshot);
    const bothSnapshotsHealthy = cold.snapshot.health.status === "ready" && warm.snapshot.health.status === "ready" && cold.snapshot.health.failedFiles.length === 0 && warm.snapshot.health.failedFiles.length === 0;
    const navigationResolved = coldNavigation.errors.length === 0 && warmNavigation.errors.length === 0 && coldNavigation.resolvedEvidenceCount === cold.snapshot.evidence.length && warmNavigation.resolvedEvidenceCount === warm.snapshot.evidence.length;
    const checks: Record<string, boolean> = { ...pair.checks, expectedSourceFilesEqual, bothSnapshotsHealthy, navigationResolved };
    const failures = [...pair.failureCodes];
    if (!expectedSourceFilesEqual) failures.push("SAMPLE_SOURCE_MANIFEST_MISMATCH");
    if (!bothSnapshotsHealthy) failures.push("SAMPLE_HEALTH_NOT_READY");
    if (!navigationResolved) failures.push(...coldNavigation.errors, ...warmNavigation.errors, "SAMPLE_NAVIGATION_INCOMPLETE");
    const uniqueFailures = [...new Set(failures)].sort();
    const summary: ChildSummary = {
      runNumber: childArgs.runNumber,
      sample: { id: definition.id, manifestSha256: sample.manifestSha256, files: sample.files, ...(definition.generatorVersion === undefined ? {} : { generatorVersion: definition.generatorVersion }) },
      runtime: { nodeVersion: process.version, platform: process.platform, architecture: process.arch, graphIrVersion: cold.snapshot.analysisIdentity.graphIrVersion, analyzerVersions: cold.snapshot.analysisIdentity.analyzerVersions },
      snapshot: {
        repositoryId: cold.snapshot.repositoryId,
        snapshotId: cold.snapshot.snapshotId,
        originalCreatedAt: cold.snapshot.createdAt,
        healthStatus: cold.snapshot.health.status,
        indexedFiles: cold.snapshot.health.indexedFiles,
        totalFiles: cold.snapshot.health.totalFiles,
        failedFiles: cold.snapshot.health.failedFiles.length,
        nodes: cold.snapshot.nodes.length,
        edges: cold.snapshot.edges.length,
        evidence: cold.snapshot.evidence.length,
        unknownEdges: cold.snapshot.edges.filter((edge) => edge.confidence === "unknown").length,
        canonicalResultSha256: pair.canonicalResultSha256,
        persistedContentSha256: pair.persistedContentSha256,
      },
      measurements: { coldIndex: cold.timing, warmNoopReindex: warm.timing },
      navigation: { nodeCount: coldNavigation.nodeCount, evidenceCount: coldNavigation.evidenceCount, resolvedEvidenceCount: coldNavigation.resolvedEvidenceCount, coldSha256: coldNavigation.sha256, warmSha256: warmNavigation.sha256 },
      ...(definition.kind === "medium" ? { pairEvidence: { cold: pairEvidence(cold.snapshot, coldNavigation, definition.id), warm: pairEvidence(warm.snapshot, warmNavigation, definition.id) } } : {}),
      gates: { passed: uniqueFailures.length === 0, checks, failureCodes: uniqueFailures },
    };
    terminal = summary.gates.passed ? { status: "completed", code: "OK", summary } : { status: "failed", code: "EQUIVALENCE_GATE_FAILED", summary };
  } catch (error) {
    const cancelled = controller?.signal.aborted === true || (error instanceof Error && error.name === "AbortError");
    terminal = { status: cancelled ? "cancelled" : "failed", code: cancelled ? "CANCELLED" : safeFailureCode(error) };
  } finally {
    closeCancelListener();
    try { app?.close(); } catch { terminal = { status: "failed", code: "APPLICATION_CLOSE_FAILED" }; }
  }
  emit({ type: "terminal", ...terminal! });
  if (terminal!.status === "failed") process.exitCode = 1;
}

function isMainModule(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked).toLocaleLowerCase() === fileURLToPath(import.meta.url).toLocaleLowerCase();
}

if (isMainModule()) void run().catch(() => {
  emit({ type: "terminal", status: "failed", code: "CHILD_OPERATION_FAILED" });
  process.exitCode = 1;
});
