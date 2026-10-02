import { describe, expect, it } from "vitest";
import {
  createMetricSummary,
  assertDiagnosticReportSize,
  NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES,
  NAVIGATION_DIAGNOSTIC_MAX_STOP_GRACE_MS,
  NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX,
  parseNavigationDiagnosticArguments,
  parseNavigationDiagnosticChildMessage,
  patchPropertyWithRestore,
  recordMetric,
  runControlledDiagnosticChild,
  validateNavigationDiagnosticSummary,
  type MetricSummary,
  type NavigationDiagnosticSummary,
} from "./local-index-navigation-diagnostic.ts";

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

const PHASES = ["setup", "coldIndex", "coldNavigation", "warmIndex", "warmNavigation", "secureReadReplay", "gateEvaluation", "appClose"] as const;
const SOURCES = ["indexProject", "getEvidence", "readSource"] as const;
const STORE_METHODS = ["loadSnapshot", "getEvidence", "readSnapshotSource", "loadIgnoreSettings"] as const;
const PROGRESS_PHASES = ["queued", "discovering", "reading", "analyzing", "verifying", "persisting"] as const;

function metricWithCount(count: number): MetricSummary {
  const metric = createMetricSummary();
  for (let index = 0; index < count; index += 1) recordMetric(metric, 0.5);
  return metric;
}

function validSummary(): NavigationDiagnosticSummary {
  const store = Object.fromEntries(PHASES.map((phase) => [
    phase,
    Object.fromEntries(SOURCES.map((source) => [
      source,
      Object.fromEntries(STORE_METHODS.map((method) => [method, createMetricSummary()])),
    ])),
  ])) as NavigationDiagnosticSummary["storage"];
  for (const phase of ["coldNavigation", "warmNavigation"] as const) {
    store[phase].getEvidence.loadSnapshot = metricWithCount(1_177);
    store[phase].getEvidence.getEvidence = metricWithCount(1_177);
    store[phase].readSource.loadSnapshot = metricWithCount(1_177);
    store[phase].readSource.readSnapshotSource = metricWithCount(1_177);
    store[phase].readSource.loadIgnoreSettings = metricWithCount(1_177);
  }
  const phase = () => ({
    wall: metricWithCount(1),
    nodeEvidenceCheck: metricWithCount(1),
    evidenceLoop: metricWithCount(1),
    canonicalizeAndHash: metricWithCount(1),
    counts: { nodesChecked: 387, evidenceExpected: 1_177, evidenceAttempted: 1_177, getEvidenceCalls: 1_177, readSourceCalls: 1_177, resolvedEvidence: 1_177, errors: 0 },
    api: { getEvidence: metricWithCount(1_177), readSource: metricWithCount(1_177) },
  });
  const progressStage = () => Object.fromEntries(PROGRESS_PHASES.map((name) => [
    name,
    { events: 0, firstElapsedMs: null, lastElapsedMs: null, lastCompleted: 0, total: 0 },
  ])) as NavigationDiagnosticSummary["progress"]["cold"];
  return {
    schemaVersion: 1,
    sample: { id: "e2e-project-medium-v1", generatorVersion: 1, fileCount: 128, totalBytes: 13_518, evidenceExpected: 1_177 },
    runtime: { nodeVersion: "v24.17.0", platform: "win32", architecture: "x64" },
    snapshot: { healthStatus: "ready", files: 128, nodes: 387, edges: 1_275, evidence: 1_177, unknownEdges: 0 },
    stages: { setup: metricWithCount(1), coldIndex: metricWithCount(1), warmIndex: metricWithCount(1), secureReadReplay: metricWithCount(1), gateEvaluation: metricWithCount(1), appClose: metricWithCount(1) },
    navigation: { cold: phase(), warm: phase() },
    storage: store,
    secureReadReplay: { calls: metricWithCount(1_177), bytesRead: 128_000 },
    progress: { cold: progressStage(), warm: progressStage() },
    gates: { passed: true, checks: Object.fromEntries(GATES.map((gate) => [gate, true])) as NavigationDiagnosticSummary["gates"]["checks"], failureCodes: [] },
  };
}

describe("navigation diagnostic bounded contracts", () => {
  it("defaults to one fixed medium pair and caps pair count and wall time", () => {
    expect(parseNavigationDiagnosticArguments([])).toEqual({ help: false, pairs: 1, timeoutMs: 180_000 });
    expect(parseNavigationDiagnosticArguments(["--pairs", "3", "--timeout-ms", "180000"])).toEqual({ help: false, pairs: 3, timeoutMs: 180_000 });
    expect(parseNavigationDiagnosticArguments(["--help"])).toMatchObject({ help: true, pairs: 1 });
    for (const args of [
      ["--pairs", "0"],
      ["--pairs", "4"],
      ["--timeout-ms", "4999"],
      ["--timeout-ms", "180001"],
      ["--pairs", "2", "--pairs", "2"],
      ["--sample", "small"],
      ["--pairs", "2", "unexpected"],
    ]) expect(() => parseNavigationDiagnosticArguments(args)).toThrow();
  });

  it("rejects cancellation grace outside the finite shutdown bound", async () => {
    await expect(runControlledDiagnosticChild(process.execPath, ["-e", "process.exit(0)"], {
      cwd: process.cwd(),
      timeoutMs: 5_000,
      stopGraceMs: NAVIGATION_DIAGNOSTIC_MAX_STOP_GRACE_MS + 1,
    })).rejects.toThrow("CHILD_STOP_GRACE_INVALID");
  });

  it("keeps fixed-size histogram aggregates and rejects invalid samples", () => {
    const metric = createMetricSummary();
    for (const elapsed of [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000]) recordMetric(metric, elapsed);
    expect(metric.count).toBe(11);
    expect(metric.totalMs).toBe(1_943);
    expect(metric.minMs).toBe(0);
    expect(metric.maxMs).toBe(1_000);
    expect(metric.buckets).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(() => recordMetric(metric, Number.NaN)).toThrow("METRIC_LIMIT_EXCEEDED");
    metric.count = 200_000;
    expect(() => recordMetric(metric, 1)).toThrow("METRIC_LIMIT_EXCEEDED");
  });

  it("restores inherited methods after normal, exception, and cancellation exits", () => {
    for (const exit of ["normal", "exception", "cancelled"] as const) {
      const prototype = { read(): string { return "original"; } };
      const target = Object.create(prototype) as { read(): string };
      const descriptorBefore = Object.getOwnPropertyDescriptor(target, "read");
      const restore = patchPropertyWithRestore(target, "read", () => "wrapped");
      expect(target.read()).toBe("wrapped");
      try {
        if (exit !== "normal") throw new Error(exit);
      } catch (error) {
        expect((error as Error).message).toBe(exit);
      } finally {
        restore();
      }
      expect(target.read()).toBe("original");
      expect(Object.getOwnPropertyDescriptor(target, "read")).toEqual(descriptorBefore);
    }
    const target = { read(): string { return "original-own"; } };
    const descriptorBefore = Object.getOwnPropertyDescriptor(target, "read");
    const restore = patchPropertyWithRestore(target, "read", () => "wrapped");
    expect(target.read()).toBe("wrapped");
    restore();
    expect(target.read()).toBe("original-own");
    expect(Object.getOwnPropertyDescriptor(target, "read")).toEqual(descriptorBefore);
  });

  it("accepts the exact bounded diagnostic summary and rejects extra or inconsistent fields", () => {
    const summary = validSummary();
    expect(validateNavigationDiagnosticSummary(summary)).toBe(true);
    const withLeak = { ...summary, evidenceIds: ["private-id"] };
    expect(validateNavigationDiagnosticSummary(withLeak)).toBe(false);
    const wrongCount = structuredClone(summary);
    wrongCount.navigation.cold.counts.evidenceAttempted = 1_176;
    expect(validateNavigationDiagnosticSummary(wrongCount)).toBe(false);
    const wrongBuckets = structuredClone(summary);
    wrongBuckets.navigation.warm.api.readSource.buckets.pop();
    expect(validateNavigationDiagnosticSummary(wrongBuckets)).toBe(false);
  });

  it("keeps three complete pair summaries below the report limit and rejects oversized JSON", () => {
    const summary = validSummary();
    expect(() => assertDiagnosticReportSize({ runs: [summary, summary, summary] })).not.toThrow();
    expect(() => assertDiagnosticReportSize({ payload: "x".repeat(NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES) })).toThrow("REPORT_SIZE_LIMIT");
  });

  it("accepts valid protocol messages and rejects malformed, oversized, and post-contract fields", () => {
    const progress = {
      type: "progress",
      stage: "cold",
      phase: "reading",
      elapsedMs: 2.5,
      completed: 1,
      total: 128,
    };
    expect(parseNavigationDiagnosticChildMessage(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + JSON.stringify(progress))).not.toBeNull();
    expect(parseNavigationDiagnosticChildMessage(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + JSON.stringify({ ...progress, currentFile: "src/private.ts" }))).toBeNull();
    expect(parseNavigationDiagnosticChildMessage(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + "{")).toBeNull();
    expect(parseNavigationDiagnosticChildMessage(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + "x".repeat(NAVIGATION_DIAGNOSTIC_MAX_PROTOCOL_BYTES))).toBeNull();
    const terminal = { type: "terminal", status: "completed", code: "OK", summary: validSummary() };
    expect(parseNavigationDiagnosticChildMessage(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + JSON.stringify(terminal))).not.toBeNull();
  });
});

describe("navigation diagnostic child control", () => {
  it("sends cooperative cancellation, receives the fixed terminal, and waits for child close", async () => {
    const controller = new AbortController();
    const source = [
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data',()=>{",
      "process.stdout.write(" + JSON.stringify(NAVIGATION_DIAGNOSTIC_PROTOCOL_PREFIX + JSON.stringify({ type: "terminal", status: "cancelled", code: "CANCELLED" }) + "\n") + ");",
      "process.exit(0);",
      "});",
      "setInterval(()=>{},1000);",
    ].join("");
    const pending = runControlledDiagnosticChild(process.execPath, ["-e", source], { cwd: process.cwd(), timeoutMs: 5_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const result = await pending;
    expect(result).toMatchObject({ termination: "cancelled", closed: true, forcedTermination: false, exitCode: 0, terminal: { status: "cancelled", code: "CANCELLED" } });
  });

  it("fails closed on malformed output without retaining an unbounded line", async () => {
    const source = "process.stdout.write('not-a-diagnostic-message\\n');";
    const result = await runControlledDiagnosticChild(process.execPath, ["-e", source], { cwd: process.cwd(), timeoutMs: 5_000, stopGraceMs: 50 });
    expect(result.closed).toBe(true);
    expect(result.protocolError).toBe("CHILD_PROTOCOL_INVALID");
    expect(result.termination).toBe("protocol_error");
  });

  it("escalates an uncooperative cancelled child and waits for close", async () => {
    const controller = new AbortController();
    const pending = runControlledDiagnosticChild(process.execPath, ["-e", "process.stdin.resume();setInterval(()=>{},1000);"], {
      cwd: process.cwd(),
      timeoutMs: 5_000,
      stopGraceMs: 40,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);
    const result = await pending;
    expect(result).toMatchObject({ termination: "cancelled", closed: true, forcedTermination: true });
  });
});
