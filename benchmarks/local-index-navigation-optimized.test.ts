import { describe, expect, it } from "vitest";
import {
  assertOptimizedReportSize,
  createMetricSummary,
  deriveOptimizationGate,
  navigationEvidenceResponseFailures,
  NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES,
  NAVIGATION_OPTIMIZED_MAX_STOP_GRACE_MS,
  NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX,
  observerRelationsValid,
  parseNavigationOptimizedArguments,
  parseNavigationOptimizedChildMessage,
  patchPropertyWithRestore,
  recordMetric,
  runControlledOptimizedChild,
  validateNavigationOptimizedReport,
  validateNavigationOptimizedSummary,
  type MetricSummary,
  type NavigationOptimizedReport,
  type NavigationOptimizedSummary,
  type OptimizedPhase,
  type OptimizedStoreSource,
} from "./local-index-navigation-optimized.ts";
import { getBaselineSample, getGeneratedSampleContent } from "./local-index-baseline-samples.ts";

const GATES = [
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
const PHASES: readonly OptimizedPhase[] = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"];
const SOURCES: readonly OptimizedStoreSource[] = ["indexProject", "getEvidence", "readSource"];
const PROGRESS_PHASES = ["queued", "discovering", "reading", "analyzing", "verifying", "persisting"] as const;
const LOOKUP_DECISIONS = ["hit", "empty_build_installed", "external_rebuild_installed", "local_rebuild_installed", "combined_rebuild_installed", "build_discard_external", "build_discard_local", "build_discard_combined", "build_discard_unclassified", "projection_limit_fallback", "transaction_bypass", "token_unavailable_bypass", "invalid_token_bypass", "store_closed_error", "legacy_bypass", "build_error_fallback", "lookup_error"] as const;
const RACES = ["external_only", "local_only", "both_changed", "unclassified"] as const;
const OUTCOMES = ["unchanged", "external_only", "local_only", "both_changed", "unavailable", "invalid_type", "in_transaction", "closed"] as const;
const CHECKPOINTS = ["phase_start", "lookup_validity", "build_before", "build_after", "after_last_lookup"] as const;
type NavigationStage = "coldNavigation" | "warmNavigation";
type Decisions = NonNullable<NavigationOptimizedSummary["lookupDecisions"]>[NavigationStage];
type Builds = NonNullable<NavigationOptimizedSummary["candidateBuilds"]>[NavigationStage];
type Races = NonNullable<NavigationOptimizedSummary["buildRaceReasons"]>[NavigationStage];
type Observations = NonNullable<NavigationOptimizedSummary["externalObservations"]>[NavigationStage];
type Admission = NonNullable<NavigationOptimizedSummary["projectionAdmission"]>[NavigationStage];

function metricWithCount(count: number): MetricSummary {
  const metric = createMetricSummary();
  metric.count = count;
  metric.totalMs = count * 0.5;
  metric.minMs = count === 0 ? null : 0.5;
  metric.maxMs = count === 0 ? null : 0.5;
  metric.buckets[0] = count;
  return metric;
}

function emptyMap<T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function makeDecisions(): Decisions {
  return {
    getEvidence: emptyMap(LOOKUP_DECISIONS) as Decisions["getEvidence"],
    readSource: emptyMap(LOOKUP_DECISIONS) as Decisions["readSource"],
  };
}

function makeBuilds(): Builds {
  return { attempted: 1, installed: 1, discarded: 0, rejectedByAdmission: 0, failed: 0, cancelled: 0 };
}

function makeRaces(): Races { return emptyMap(RACES) as Races; }

function makeObservations(): Observations {
  return Object.fromEntries(CHECKPOINTS.map((checkpoint) => [checkpoint, emptyMap(OUTCOMES)])) as Observations;
}

function makeAdmission(): Admission {
  return { evaluatedCount: 1, acceptedCount: 1, acceptedBytesTotal: 1_024, maxAcceptedBytes: 1_024, overLimitCount: 0, invalidCount: 0, limitBytes: 4_194_304 };
}

function makeObserverPhase(stage: NavigationStage): NonNullable<NavigationOptimizedSummary["lookupDecisions"]>[NavigationStage] extends never ? never : {
  lookupDecisions: Decisions; candidateBuilds: Builds; buildRaceReasons: Races;
  externalObservations: Observations; externalObservationCoverage: { complete: boolean; checkpoints: Record<(typeof CHECKPOINTS)[number], boolean> };
  projectionAdmission: Admission;
} {
  const decisions = makeDecisions();
  decisions.getEvidence.hit = 1_176;
  decisions.readSource.hit = 1_177;
  if (stage === "coldNavigation") decisions.getEvidence.empty_build_installed = 1;
  else decisions.getEvidence.local_rebuild_installed = 1;
  const observations = makeObservations();
  observations.phase_start.unchanged = 1;
  observations.lookup_validity.unchanged = 2_354;
  observations.build_before.unchanged = 1;
  observations.build_after.unchanged = 1;
  observations.after_last_lookup.unchanged = 1;
  return {
    lookupDecisions: decisions,
    candidateBuilds: makeBuilds(),
    buildRaceReasons: makeRaces(),
    externalObservations: observations,
    externalObservationCoverage: { complete: true, checkpoints: { phase_start: true, lookup_validity: true, build_before: true, build_after: true, after_last_lookup: true } },
    projectionAdmission: makeAdmission(),
  };
}

function makeNavigationPhase(): NavigationOptimizedSummary["navigation"]["cold"] {
  return {
    wall: metricWithCount(1), nodeEvidenceCheck: metricWithCount(1), evidenceLoop: metricWithCount(1), canonicalizeAndHash: metricWithCount(1),
    counts: { nodesChecked: 387, evidenceExpected: 1_177, evidenceAttempted: 1_177, getEvidenceCalls: 1_177, readSourceCalls: 1_177, resolvedEvidence: 1_177, errors: 0 },
    api: { getEvidence: metricWithCount(1_177), readSource: metricWithCount(1_177) },
  };
}

function makeStorage(): NavigationOptimizedSummary["storage"] {
  const result = {} as NavigationOptimizedSummary["storage"];
  for (const phase of PHASES) {
    const bySource = {} as NavigationOptimizedSummary["storage"][OptimizedPhase];
    for (const source of SOURCES) {
      bySource[source] = {
        loadSnapshot: createMetricSummary(), getEvidence: createMetricSummary(),
        readSnapshotSource: createMetricSummary(), loadIgnoreSettings: createMetricSummary(),
      };
    }
    result[phase] = bySource;
  }
  for (const phase of ["coldNavigation", "warmNavigation"] as const) {
    result[phase].getEvidence.loadSnapshot = metricWithCount(1);
    result[phase].getEvidence.getEvidence = metricWithCount(1_177);
    result[phase].readSource.readSnapshotSource = metricWithCount(1_177);
    result[phase].readSource.loadIgnoreSettings = metricWithCount(1_177);
  }
  return result;
}

function makeProgress(): NavigationOptimizedSummary["progress"] {
  const stage = () => Object.fromEntries(PROGRESS_PHASES.map((phase) => [phase, { events: 0, firstElapsedMs: null, lastElapsedMs: null, lastCompleted: 0, total: 0 }])) as NavigationOptimizedSummary["progress"]["cold"];
  return { cold: stage(), warm: stage() };
}

function makeSummary(): NavigationOptimizedSummary {
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("TEST_SAMPLE_UNAVAILABLE");
  const storage = makeStorage();
  const coldObserver = makeObserverPhase("coldNavigation");
  const warmObserver = makeObserverPhase("warmNavigation");
  const summary = {
    schemaVersion: 2,
    sample: { id: "e2e-project-medium-v1", generatorVersion: 1, fileCount: sample.files.length, totalBytes: sample.totalBytes, evidenceExpected: 1_177 },
    runtime: { nodeVersion: process.version, platform: "win32", architecture: process.arch },
    snapshot: { healthStatus: "ready", files: sample.files.length, nodes: 387, edges: 1_275, evidence: 1_177, unknownEdges: 0 },
    stages: { setup: metricWithCount(1), coldIndex: metricWithCount(1), warmIndex: metricWithCount(1), secureReadReplay: metricWithCount(1), gateEvaluation: metricWithCount(1), appClose: metricWithCount(1) },
    navigation: { cold: makeNavigationPhase(), warm: makeNavigationPhase() },
    navigationFullLoads: { coldNavigation: { getEvidence: 1, readSource: 0, total: 1 }, warmNavigation: { getEvidence: 1, readSource: 0, total: 1 }, navigationTotal: 2, fullLoadOpportunityCount: 4_708, maximumWithCompleteNoExternalChangeObservation: 2 },
    observer: { status: "enabled", contractVersion: "xray.navigation-cache-observer.v1" },
    lookupDecisions: { coldNavigation: coldObserver.lookupDecisions, warmNavigation: warmObserver.lookupDecisions },
    candidateBuilds: { coldNavigation: coldObserver.candidateBuilds, warmNavigation: warmObserver.candidateBuilds },
    buildRaceReasons: { coldNavigation: coldObserver.buildRaceReasons, warmNavigation: warmObserver.buildRaceReasons },
    externalObservations: { coldNavigation: coldObserver.externalObservations, warmNavigation: warmObserver.externalObservations },
    externalObservationCoverage: { coldNavigation: coldObserver.externalObservationCoverage, warmNavigation: warmObserver.externalObservationCoverage },
    projectionAdmission: { coldNavigation: coldObserver.projectionAdmission, warmNavigation: warmObserver.projectionAdmission },
    heapUsed: { coldNavigation: { beforeBytes: 20_000_000, afterBytes: 21_000_000 }, warmNavigation: { beforeBytes: 21_000_000, afterBytes: 21_100_000 } },
    storage,
    secureReadReplay: { calls: metricWithCount(1_177), bytesRead: 128_000 },
    progress: makeProgress(),
    semanticGates: { passed: true, checks: Object.fromEntries(GATES.map((name) => [name, true])) as NavigationOptimizedSummary["semanticGates"]["checks"], failureCodes: [] },
    optimizationGate: { status: "failed", navigationFullSnapshotLoads: 2, maximumWithCompleteNoExternalChangeObservation: 2, failureCodes: [] },
  } as NavigationOptimizedSummary;
  summary.optimizationGate = deriveOptimizationGate(summary);
  return summary;
}

function makeProgressCounts(): { cold: Record<(typeof PROGRESS_PHASES)[number], number>; warm: Record<(typeof PROGRESS_PHASES)[number], number> } {
  const empty = () => Object.fromEntries(PROGRESS_PHASES.map((phase) => [phase, 0])) as Record<(typeof PROGRESS_PHASES)[number], number>;
  return { cold: empty(), warm: empty() };
}

function makeReport(runs: NavigationOptimizedReport["runs"]): NavigationOptimizedReport {
  const sample = getBaselineSample("medium");
  if (!sample) throw new Error("TEST_SAMPLE_UNAVAILABLE");
  const summaries = runs.filter((run) => run.summary);
  const comparable = runs.filter((run) => run.summary && run.termination === "exited" && run.childClosed && !run.protocolError
    && run.summary.semanticGates.passed && run.summary.observer.status === "enabled"
    && run.summary.externalObservationCoverage.coldNavigation.complete && run.summary.externalObservationCoverage.warmNavigation.complete
    && !["coldNavigation", "warmNavigation"].some((stage) => CHECKPOINTS.some((checkpoint) => {
      const counts = run.summary!.externalObservations![stage as NavigationStage][checkpoint];
      return counts.external_only > 0 || counts.both_changed > 0 || counts.unavailable > 0 || counts.invalid_type > 0 || counts.in_transaction > 0 || counts.closed > 0;
    })) && observerRelationsValid(run.summary)).length;
  const terminalSummaryPairCount = summaries.length;
  const semanticValidPairCount = runs.filter((run) => run.summary?.semanticGates.passed).length;
  const optimizationPassPairCount = runs.filter((run) => run.status === "completed").length;
  const externalWriteInconclusivePairCount = runs.filter((run) => run.status === "inconclusive_external_write").length;
  const externalObservationInconclusivePairCount = runs.filter((run) => run.status === "inconclusive_external_observation").length;
  const notStartedPairCount = runs.filter((run) => run.status === "not_started").length;
  return {
    schemaVersion: 2, measurementProtocolVersion: 2, baselineProtocolVersion: 1,
    generatedAt: "2026-10-03T00:00:00.000Z", runId: "10000000-0000-4000-8000-000000000001",
    status: runs.some((run) => run.status === "failed" || run.status === "not_started") ? "failed" : "completed",
    requestedPairs: runs.length, timeoutMs: 180_000,
    terminalSummaryPairCount, semanticValidPairCount, performanceComparablePairCount: comparable,
    optimizationPassPairCount, externalWriteInconclusivePairCount, externalObservationInconclusivePairCount, notStartedPairCount,
    environment: { nodeVersion: process.version, platform: "win32", architecture: process.arch, betterSqlite3Version: "13.0.3" },
    baseline: { protocolVersion: 1, state: "frozen", sampleId: "e2e-project-medium-v1", generatorVersion: 1, navigationFullSnapshotLoadsPerPair: 4_708 },
    sample: { id: "e2e-project-medium-v1", generatorVersion: 1, fileCount: sample.files.length, totalBytes: sample.totalBytes },
    runs,
    limitations: [
      "仅测固定 medium128 synthetic fixture；样例和 generator 固定，不代表更大或真实仓库。",
      "计时包装开销未扣除；导航 wall 与 API/store 指标为嵌套 inclusive 计时，子计时不能相加。",
      "Child wall 含启动与协议开销；IndexProgress 首末时间是观测点，不是独立 phase 时长。",
      "heapUsed 是整个 child 的未强制 GC heap 读数，受索引和导航结果影响，不是缓存净内存。",
      "外部写入 challenge 与计时配对分开；安全失效验证不进入 4,708 分母或性能汇总。",
      "有界 observer 只覆盖 phase_start 到 after_last_lookup；之后发生的提交不在本次观察结论内。",
      "报告不含 token 原值、源码、路径、evidence ID 或内容/导航 hash；合成结果不代表跨机器性能。",
    ],
  };
}

describe("optimized navigation v2 bounded contracts", () => {
  it("keeps fixed pair count and shutdown time limits", async () => {
    expect(parseNavigationOptimizedArguments([])).toEqual({ help: false, pairs: 1, timeoutMs: 180_000 });
    expect(parseNavigationOptimizedArguments(["--pairs", "3", "--timeout-ms", "180000"])).toEqual({ help: false, pairs: 3, timeoutMs: 180_000 });
    expect(parseNavigationOptimizedArguments(["--help"]).help).toBe(true);
    for (const args of [["--pairs", "0"], ["--pairs", "4"], ["--timeout-ms", "4999"], ["--timeout-ms", "180001"], ["--pairs", "1", "--pairs", "2"], ["--sample", "small"]]) {
      expect(() => parseNavigationOptimizedArguments(args)).toThrow();
    }
    await expect(runControlledOptimizedChild(process.execPath, ["-e", "process.exit(0)"], { cwd: process.cwd(), timeoutMs: 5_000, stopGraceMs: NAVIGATION_OPTIMIZED_MAX_STOP_GRACE_MS + 1 })).rejects.toThrow("CHILD_STOP_GRACE_INVALID");
  });

  it("retains v1 histogram null and bucket semantics", () => {
    const empty = createMetricSummary();
    expect(empty).toMatchObject({ count: 0, totalMs: 0, minMs: null, maxMs: null });
    const metric = createMetricSummary();
    for (const elapsed of [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000]) recordMetric(metric, elapsed);
    expect(metric).toMatchObject({ count: 11, totalMs: 1_943, minMs: 0, maxMs: 1_000, buckets: Array(11).fill(1) });
    expect(() => recordMetric(metric, Number.NaN)).toThrow("METRIC_LIMIT_EXCEEDED");
  });

  it("validates a complete v2 summary and rejects extra fields and cross-domain inconsistencies", () => {
    const summary = makeSummary();
    expect(summary.optimizationGate.status).toBe("passed");
    expect(validateNavigationOptimizedSummary(summary)).toBe(true);
    expect(validateNavigationOptimizedSummary({ ...summary, rawToken: 1 })).toBe(false);
    const badDecision = structuredClone(summary);
    badDecision.lookupDecisions!.coldNavigation.getEvidence.hit += 1;
    expect(validateNavigationOptimizedSummary(badDecision)).toBe(false);
    const badLoads = structuredClone(summary);
    badLoads.navigationFullLoads.coldNavigation.total += 1;
    expect(validateNavigationOptimizedSummary(badLoads)).toBe(false);

    const overApiOpportunity = makeSummary();
    overApiOpportunity.navigationFullLoads.coldNavigation.getEvidence = 1_178;
    overApiOpportunity.navigationFullLoads.coldNavigation.total = 1_178;
    overApiOpportunity.navigationFullLoads.navigationTotal = 1_179;
    const loadMetric = overApiOpportunity.storage.coldNavigation.getEvidence.loadSnapshot;
    loadMetric.count = 1_178;
    loadMetric.totalMs = 589;
    loadMetric.minMs = 0.5;
    loadMetric.maxMs = 0.5;
    loadMetric.buckets[0] = 1_178;
    overApiOpportunity.optimizationGate = deriveOptimizationGate(overApiOpportunity);
    expect(observerRelationsValid(overApiOpportunity)).toBe(false);
    expect(overApiOpportunity.optimizationGate.failureCodes).toContain("PROTOCOL_RELATION_VIOLATION");
    expect(validateNavigationOptimizedSummary(overApiOpportunity)).toBe(false);
  });

  it("allows failed/rejected finally samples without relabeling them as race discards", () => {
    const failed = makeSummary();
    const phase = failed.candidateBuilds!.coldNavigation;
    phase.installed = 0;
    phase.failed = 1;
    failed.lookupDecisions!.coldNavigation.getEvidence.empty_build_installed = 0;
    failed.lookupDecisions!.coldNavigation.getEvidence.build_error_fallback = 1;
    failed.projectionAdmission!.coldNavigation = { evaluatedCount: 0, acceptedCount: 0, acceptedBytesTotal: 0, maxAcceptedBytes: 0, overLimitCount: 0, invalidCount: 0, limitBytes: 4_194_304 };
    failed.externalObservations!.coldNavigation.build_after.unchanged = 0;
    failed.externalObservations!.coldNavigation.build_after.external_only = 1;
    failed.optimizationGate = deriveOptimizationGate(failed);
    expect(failed.optimizationGate.status).toBe("failed");
    expect(failed.optimizationGate.failureCodes).toContain("CANDIDATE_BUILD_FAILED");
    expect(observerRelationsValid(failed)).toBe(true);
    expect(validateNavigationOptimizedSummary(failed)).toBe(true);

    const rejected = makeSummary();
    rejected.candidateBuilds!.coldNavigation.installed = 0;
    rejected.candidateBuilds!.coldNavigation.rejectedByAdmission = 1;
    rejected.lookupDecisions!.coldNavigation.getEvidence.empty_build_installed = 0;
    rejected.lookupDecisions!.coldNavigation.getEvidence.projection_limit_fallback = 1;
    rejected.projectionAdmission!.coldNavigation = { evaluatedCount: 1, acceptedCount: 0, acceptedBytesTotal: 0, maxAcceptedBytes: 0, overLimitCount: 1, invalidCount: 0, limitBytes: 4_194_304 };
    rejected.externalObservations!.coldNavigation.build_after.unchanged = 0;
    rejected.externalObservations!.coldNavigation.build_after.external_only = 1;
    rejected.optimizationGate = deriveOptimizationGate(rejected);
    expect(rejected.optimizationGate.status).toBe("failed");
    expect(rejected.optimizationGate.failureCodes).toContain("CANDIDATE_ADMISSION_REJECTED");
    expect(observerRelationsValid(rejected)).toBe(true);
    expect(validateNavigationOptimizedSummary(rejected)).toBe(true);
  });

  it("distinguishes a valid unclassified discard from a contradictory complete observation", () => {
    const unclassified = makeSummary();
    unclassified.candidateBuilds!.coldNavigation.installed = 0;
    unclassified.candidateBuilds!.coldNavigation.discarded = 1;
    unclassified.lookupDecisions!.coldNavigation.getEvidence.empty_build_installed = 0;
    unclassified.lookupDecisions!.coldNavigation.getEvidence.build_discard_unclassified = 1;
    unclassified.buildRaceReasons!.coldNavigation.unclassified = 1;
    unclassified.externalObservations!.coldNavigation.build_after.unchanged = 0;
    unclassified.externalObservations!.coldNavigation.build_after.unavailable = 1;
    unclassified.optimizationGate = deriveOptimizationGate(unclassified);
    expect(observerRelationsValid(unclassified)).toBe(true);
    expect(unclassified.optimizationGate.status).toBe("inconclusive_external_observation");
    expect(validateNavigationOptimizedSummary(unclassified)).toBe(true);

    const contradiction = makeSummary();
    contradiction.candidateBuilds!.coldNavigation.installed = 0;
    contradiction.candidateBuilds!.coldNavigation.discarded = 1;
    contradiction.lookupDecisions!.coldNavigation.getEvidence.empty_build_installed = 0;
    contradiction.lookupDecisions!.coldNavigation.getEvidence.build_discard_external = 1;
    contradiction.buildRaceReasons!.coldNavigation.external_only = 1;
    contradiction.optimizationGate = deriveOptimizationGate(contradiction);
    expect(observerRelationsValid(contradiction)).toBe(false);
    expect(contradiction.optimizationGate.status).toBe("failed");
    expect(contradiction.optimizationGate.failureCodes).toContain("PROTOCOL_RELATION_VIOLATION");
    expect(validateNavigationOptimizedSummary(contradiction)).toBe(true);
  });

  it("treats genuinely missing observations as inconclusive and external writes as a separate status", () => {
    const missing = makeSummary();
    missing.externalObservations!.coldNavigation.lookup_validity.unchanged -= 1;
    missing.externalObservationCoverage.coldNavigation.checkpoints.lookup_validity = false;
    missing.externalObservationCoverage.coldNavigation.complete = false;
    missing.optimizationGate = deriveOptimizationGate(missing);
    expect(observerRelationsValid(missing)).toBe(true);
    expect(missing.optimizationGate.status).toBe("inconclusive_external_observation");
    expect(validateNavigationOptimizedSummary(missing)).toBe(true);

    const external = makeSummary();
    external.externalObservations!.warmNavigation.lookup_validity.unchanged -= 1;
    external.externalObservations!.warmNavigation.lookup_validity.external_only = 1;
    external.optimizationGate = deriveOptimizationGate(external);
    expect(external.optimizationGate.status).toBe("inconclusive_external_write");
    expect(validateNavigationOptimizedSummary(external)).toBe(true);
  });

  it("keeps observer-unavailable data null and refuses performance comparability", () => {
    const summary = makeSummary();
    summary.observer = { status: "unavailable", contractVersion: null };
    summary.lookupDecisions = null;
    summary.candidateBuilds = null;
    summary.buildRaceReasons = null;
    summary.externalObservations = null;
    summary.projectionAdmission = null;
    summary.externalObservationCoverage = {
      coldNavigation: { complete: false, checkpoints: { phase_start: false, lookup_validity: false, build_before: false, build_after: false, after_last_lookup: false } },
      warmNavigation: { complete: false, checkpoints: { phase_start: false, lookup_validity: false, build_before: false, build_after: false, after_last_lookup: false } },
    };
    summary.optimizationGate = deriveOptimizationGate(summary);
    expect(summary.optimizationGate.status).toBe("inconclusive_external_observation");
    expect(validateNavigationOptimizedSummary(summary)).toBe(true);
  });

  it("rejects altered source bytes and every part of the returned evidence range", () => {
    const sample = getBaselineSample("medium");
    expect(sample).toBeDefined();
    const sampleFile = sample!.files[0]!;
    const expectedContent = getGeneratedSampleContent(sample!.id, sampleFile.path);
    expect(expectedContent).toBeDefined();
    const firstLine = expectedContent!.split("\n", 1)[0]!;
    const evidence: import("../packages/contracts/src/index.ts").Evidence = {
      id: "fixture-evidence",
      snapshotId: "fixture-snapshot",
      analyzer: "fixture-analyzer",
      analyzerVersion: "1",
      kind: "symbol-definition",
      confidence: "verified",
      reason: "fixed synthetic evidence",
      span: { filePath: sampleFile.path, startLine: 1, startColumn: 0, endLine: 1, endColumn: firstLine.length },
    };
    const expected = {
      repositoryId: "fixture-repository",
      snapshotId: "fixture-snapshot",
      evidence,
      sampleFile,
      snapshotSourceFile: { filePath: sampleFile.path, contentHash: sampleFile.sha256, bytes: sampleFile.bytes, language: sampleFile.language },
      expectedContent: expectedContent!,
    };
    const identified = { ...evidence, repositoryId: expected.repositoryId };
    const source = {
      repositoryId: expected.repositoryId,
      snapshotId: expected.snapshotId,
      filePath: sampleFile.path,
      language: sampleFile.language,
      content: expectedContent!,
      contentHash: sampleFile.sha256,
      workspaceStatus: "current",
      currentHash: sampleFile.sha256,
      targetSpan: evidence.span,
      evidence,
    };

    expect(navigationEvidenceResponseFailures(identified, source, expected)).toEqual([]);

    const wrongLookup = { ...identified, reason: "different persisted evidence" };
    expect(navigationEvidenceResponseFailures(wrongLookup, source, expected)).toContain("SAMPLE_EVIDENCE_LOOKUP_MISMATCH");
    const wrongLookupIdentity = { ...identified, snapshotId: "other-snapshot" };
    expect(navigationEvidenceResponseFailures(wrongLookupIdentity, source, expected)).toContain("SAMPLE_EVIDENCE_LOOKUP_MISMATCH");

    const wrongContent = { ...source, content: "CONTROLLED_REVIEW_WRONG_CONTENT" };
    expect(navigationEvidenceResponseFailures(identified, wrongContent, expected)).toContain("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
    const wrongSourceIdentity = { ...source, repositoryId: "other-repository" };
    expect(navigationEvidenceResponseFailures(identified, wrongSourceIdentity, expected)).toContain("SAMPLE_SOURCE_NAVIGATION_MISMATCH");

    const wrongTargetSpan = { ...source, targetSpan: { ...source.targetSpan, startLine: 999_999, endLine: 999_999 } };
    expect(navigationEvidenceResponseFailures(identified, wrongTargetSpan, expected)).toContain("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
    const wrongTargetColumn = { ...source, targetSpan: { ...source.targetSpan, startColumn: 999_999 } };
    expect(navigationEvidenceResponseFailures(identified, wrongTargetColumn, expected)).toContain("SAMPLE_SOURCE_NAVIGATION_MISMATCH");

    const wrongEvidenceSpan = { ...source, evidence: { ...evidence, span: { ...evidence.span, startLine: 999_999, endLine: 999_999 } } };
    expect(navigationEvidenceResponseFailures(identified, wrongEvidenceSpan, expected)).toContain("SAMPLE_SOURCE_NAVIGATION_MISMATCH");
  });

  it("parses only the independent v2 prefix and strict terminal/progress shapes", () => {
    const progress = { type: "progress", stage: "cold", phase: "reading", elapsedMs: 2.5, completed: 1, total: 128 };
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify(progress))).not.toBeNull();
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify({ ...progress, currentFile: "private.ts" }))).toBeNull();
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + "{" )).toBeNull();
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + "x".repeat(NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES))).toBeNull();
    const terminal = { type: "terminal", status: "completed", code: "OK", summary: makeSummary() };
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify(terminal))).not.toBeNull();
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify({ ...terminal, status: "failed", code: "OPTIMIZATION_GATE_FAILED" }))).toBeNull();
    expect(parseNavigationOptimizedChildMessage("XRAY_NAVIGATION_DIAGNOSTIC:" + JSON.stringify(terminal))).toBeNull();
    expect(parseNavigationOptimizedChildMessage(NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify({ ...terminal, rawToken: "hidden" }))).toBeNull();
  });

  it("recomputes report counters and keeps three complete summaries under the report cap", () => {
    const summary = makeSummary();
    const runs: NavigationOptimizedReport["runs"] = [1, 2, 3].map((runNumber) => ({
      runNumber, status: "completed", code: "OK", termination: "exited", exitCode: 0, signal: null,
      childClosed: true, forcedTermination: false, durationMs: 100, progressCounts: makeProgressCounts(), summary,
    }));
    const report = makeReport(runs);
    expect(validateNavigationOptimizedReport(report)).toBe(true);
    expect(report.performanceComparablePairCount).toBe(3);
    expect(() => assertOptimizedReportSize(report)).not.toThrow();
    expect(validateNavigationOptimizedReport({ ...report, optimizationPassPairCount: 2 })).toBe(false);
    const mismatchedRuntime = structuredClone(report);
    mismatchedRuntime.runs[0]!.summary!.runtime.nodeVersion = "v0.0.0";
    mismatchedRuntime.performanceComparablePairCount = 2;
    expect(validateNavigationOptimizedReport(mismatchedRuntime)).toBe(false);
    expect(() => assertOptimizedReportSize({ payload: "x".repeat(NAVIGATION_OPTIMIZED_MAX_PROTOCOL_BYTES) })).toThrow("REPORT_SIZE_LIMIT");
  });

  it("restores inherited and owned instrumentation targets", () => {
    const prototype = { read(): string { return "original"; } };
    const target = Object.create(prototype) as { read(): string };
    const before = Object.getOwnPropertyDescriptor(target, "read");
    const restore = patchPropertyWithRestore(target, "read", () => "wrapped");
    expect(target.read()).toBe("wrapped");
    restore();
    expect(target.read()).toBe("original");
    expect(Object.getOwnPropertyDescriptor(target, "read")).toEqual(before);
  });
});

describe("optimized navigation controlled child lifecycle", () => {
  it("cooperatively cancels, accepts its terminal, and waits for close", async () => {
    const terminal = NAVIGATION_OPTIMIZED_PROTOCOL_PREFIX + JSON.stringify({ type: "terminal", status: "cancelled", code: "CANCELLED" }) + "\n";
    const source = `process.stdin.setEncoding('utf8');process.stdin.on('data',()=>{process.stdout.write(${JSON.stringify(terminal)});process.exit(0)});setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const pending = runControlledOptimizedChild(process.execPath, ["-e", source], { cwd: process.cwd(), timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 40);
    const result = await pending;
    expect(result).toMatchObject({ termination: "cancelled", closed: true, exitCode: 0, forcedTermination: false, terminal: { status: "cancelled", code: "CANCELLED" } });
  });

  it("applies timeout while still waiting for cooperative child close", async () => {
    const source = "process.stdin.resume();process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000);";
    const result = await runControlledOptimizedChild(process.execPath, ["-e", source], { cwd: process.cwd(), timeoutMs: 60 });
    expect(result.termination).toBe("timeout");
    expect(result.closed).toBe(true);
  });
});
