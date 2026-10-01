import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../packages/contracts/src/index.ts";
import {
  compareSnapshotPair,
  createRunDirectory,
  createUniqueRunRoot,
  isCompletedChildRun,
  parseCliArguments,
  runControlledChild,
  writeReportExclusive,
  writeRunReportExclusive,
} from "./local-index-baseline.ts";

function snapshot(name = "login", createdAt = "2026-10-02T00:00:00.000Z"): ProjectSnapshot {
  const span = { filePath: "src/auth.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 };
  return {
    repositoryId: "repository-fixture",
    snapshotId: "snapshot-fixture",
    name: "fixture",
    rootPath: "C:\\private\\sample-root",
    sourceType: "local",
    createdAt,
    analysisIdentity: {
      graphIrVersion: "1.3.0",
      analyzerVersions: { typescript: "5.9.3+xray.3" },
      configurationHash: "a".repeat(64),
      sourceFingerprint: "b".repeat(64),
      analysisResult: { version: "1.0.0", fingerprint: "c".repeat(64) },
    },
    sourceFiles: [{ filePath: "src/auth.ts", contentHash: "d".repeat(64), bytes: 10, language: "TypeScript" }],
    nodes: [{ id: "node-login", snapshotId: "snapshot-fixture", kind: "function", name, qualifiedName: "src/auth.ts::login", filePath: "src/auth.ts", span, evidenceId: "evidence-login", metadata: {} }],
    edges: [],
    evidence: [{ id: "evidence-login", snapshotId: "snapshot-fixture", analyzer: "typescript", analyzerVersion: "5.9.3+xray.3", kind: "symbol", confidence: "verified", reason: "test fixture", span }],
    health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] },
  };
}

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

function protocolSummary(): Record<string, unknown> {
  const files = [
    { path: "src/auth.ts", language: "TypeScript", bytes: 10, sha256: "a".repeat(64) },
    { path: "src/validation.ts", language: "TypeScript", bytes: 10, sha256: "b".repeat(64) },
    { path: "worker.py", language: "Python", bytes: 10, sha256: "c".repeat(64) },
  ];
  const timing = {
    elapsedMs: 10,
    rss: { source: "Node child process process.memoryUsage().rss", intervalMs: 20, startBytes: 1, peakSampledBytes: 2, samples: 1 },
    phaseEvents: [],
  };
  return {
    runNumber: 1,
    sample: { id: "e2e-project-small-v1", manifestSha256: "d".repeat(64), files },
    runtime: { nodeVersion: "v24.17.0", platform: "win32", architecture: "x64", graphIrVersion: "1.3.0", analyzerVersions: { typescript: "5.9.3" } },
    snapshot: {
      repositoryId: "repository-fixture", snapshotId: "snapshot-fixture", originalCreatedAt: "2026-10-02T00:00:00.000Z", healthStatus: "ready",
      indexedFiles: 3, totalFiles: 3, failedFiles: 0, nodes: 1, edges: 0, evidence: 1, unknownEdges: 0,
      canonicalResultSha256: "e".repeat(64), persistedContentSha256: "f".repeat(64),
    },
    measurements: { coldIndex: timing, warmNoopReindex: timing },
    navigation: { nodeCount: 1, evidenceCount: 1, resolvedEvidenceCount: 1, coldSha256: "1".repeat(64), warmSha256: "2".repeat(64) },
    gates: { passed: true, checks: Object.fromEntries(REQUIRED_GATE_CHECKS.map((name) => [name, true])), failureCodes: [] },
  };
}

async function runProtocolTerminal(terminal: Record<string, unknown>) {
  const line = `XRAY_LOCAL_INDEX_BASELINE:${JSON.stringify({ type: "terminal", ...terminal })}\n`;
  return await runControlledChild(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(line)})`], {
    cwd: process.cwd(),
    timeoutMs: 5_000,
    protocol: true,
  });
}

describe("local index baseline tool guards", () => {
  it("accepts only bounded supported options", () => {
    expect(parseCliArguments([])).toEqual({ help: false, runs: 1, timeoutMs: 60_000 });
    expect(parseCliArguments(["--runs", "5", "--timeout-ms", "180000"])).toEqual({ help: false, runs: 5, timeoutMs: 180_000 });
    expect(parseCliArguments(["--help"]).help).toBe(true);
    for (const args of [
      ["--runs", "0"], ["--runs", "6"], ["--runs", "1.5"], ["--runs", "1", "--runs", "2"],
      ["--timeout-ms", "4999"], ["--timeout-ms", "180001"], ["--other", "value"], ["D:\\source"], ["--help", "--runs", "1"],
    ]) expect(() => parseCliArguments(args)).toThrow();
  });

  it("requires cold and warm facts, saved content, identities, and navigation to remain equal", () => {
    const cold = snapshot();
    const warm = structuredClone(cold);
    expect(compareSnapshotPair(cold, warm, "e".repeat(64), "e".repeat(64)).passed).toBe(true);

    const semanticChange = structuredClone(cold);
    semanticChange.nodes[0]!.name = "changed-login";
    const semanticResult = compareSnapshotPair(cold, semanticChange, "e".repeat(64), "e".repeat(64));
    expect(semanticResult.passed).toBe(false);
    expect(semanticResult.checks.canonicalFactsEqual).toBe(false);

    const changedHistory = structuredClone(cold);
    changedHistory.createdAt = "2026-10-02T00:00:01.000Z";
    const historyResult = compareSnapshotPair(cold, changedHistory, "e".repeat(64), "e".repeat(64));
    expect(historyResult.passed).toBe(false);
    expect(historyResult.checks.originalCreatedAtPreserved).toBe(false);

    expect(compareSnapshotPair(cold, warm, "e".repeat(64), "f".repeat(64)).checks.stableResolvedSourceNavigation).toBe(false);
  });

  it("creates distinct owned run directories and never replaces an existing report", async () => {
    const first = await createUniqueRunRoot();
    const second = await createUniqueRunRoot();
    expect(first.id).not.toBe(second.id);
    expect(first.path).not.toBe(second.path);
    const runDirectory = await createRunDirectory(first, 1);
    expect(resolve(runDirectory).startsWith(resolve(first.path))).toBe(true);

    await writeReportExclusive(first, { schemaVersion: 1, status: "first" });
    const reportPath = join(first.path, "report.json");
    const before = await readFile(reportPath, "utf8");
    await expect(writeReportExclusive(first, { schemaVersion: 1, status: "replacement" })).rejects.toThrow("REPORT_ALREADY_EXISTS");
    expect(await readFile(reportPath, "utf8")).toBe(before);

    await writeRunReportExclusive(first, 1, { schemaVersion: 1, status: "run-first" });
    const runReportPath = join(runDirectory, "report.json");
    const runBefore = await readFile(runReportPath, "utf8");
    await expect(writeRunReportExclusive(first, 1, { schemaVersion: 1, status: "run-replacement" })).rejects.toThrow("REPORT_ALREADY_EXISTS");
    expect(await readFile(runReportPath, "utf8")).toBe(runBefore);

    const outsideRoot = { ...first, path: tmpdir() };
    await expect(writeReportExclusive(outsideRoot, { schemaVersion: 1, status: "outside" })).rejects.toThrow("OWNED_DIRECTORY_INVALID");
  });

  it("records child failure only after its exit event", async () => {
    const result = await runControlledChild(process.execPath, ["-e", "process.exit(7)"], { cwd: process.cwd(), timeoutMs: 5_000 });
    expect(result.termination).toBe("exited");
    expect(result.exitCode).toBe(7);
    expect(result.closed).toBe(true);
  });

  it("records spawn failure without an unhandled process error", async () => {
    const missingCommand = join(tmpdir(), `.xray-baseline-missing-${randomUUID()}.exe`);
    const result = await runControlledChild(missingCommand, [], { cwd: process.cwd(), timeoutMs: 5_000 });
    expect(result.termination).toBe("spawn_failed");
    expect(result.closed).toBe(true);
    expect(result.exitCode === null || Number.isInteger(result.exitCode)).toBe(true);
  });

  it("cancels cooperatively and waits for child close", async () => {
    const controller = new AbortController();
    const childSource = "process.stdin.once('data',()=>process.exit(0)); setInterval(()=>{},1000)";
    const abortTimer = setTimeout(() => controller.abort(), 80);
    const result = await runControlledChild(process.execPath, ["-e", childSource], { cwd: process.cwd(), timeoutMs: 5_000, signal: controller.signal });
    clearTimeout(abortTimer);
    expect(result.termination).toBe("cancelled");
    expect(result.closed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.forcedTermination).toBe(false);
  });

  it("cancels the real index child and closes after RSS sampling stops", async () => {
    const root = await createUniqueRunRoot();
    await createRunDirectory(root, 1);
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const childPath = join(repoRoot, "benchmarks", "local-index-baseline-child.ts");
    const controller = new AbortController();
    const result = await runControlledChild(process.execPath, ["--import", "tsx", childPath, "--run-id", root.id, "--run-number", "1"], {
      cwd: repoRoot,
      timeoutMs: 20_000,
      signal: controller.signal,
      protocol: true,
      onProgress: (event) => { if (event.stage === "cold" && !controller.signal.aborted) controller.abort(); },
    });
    expect(result.progress.some((event) => event.stage === "cold")).toBe(true);
    expect(result.termination).toBe("cancelled");
    expect(result.terminal).toEqual({ status: "cancelled", code: "CANCELLED" });
    expect(result.closed).toBe(true);
    expect(result.forcedTermination).toBe(false);
  });

  it("rejects inconsistent, incomplete, and wrongly typed child gate claims at the process boundary", async () => {
    const valid = await runProtocolTerminal({ status: "completed", code: "OK", summary: protocolSummary() });
    expect(valid.protocolError).toBeUndefined();
    expect(valid.terminal?.status).toBe("completed");
    expect(isCompletedChildRun(valid)).toBe(true);

    const contradictorySummary = protocolSummary();
    (contradictorySummary.gates as { checks: Record<string, boolean> }).checks.canonicalFactsEqual = false;
    const contradictory = await runProtocolTerminal({ status: "completed", code: "OK", summary: contradictorySummary });
    expect(contradictory.protocolError).toBe("CHILD_PROTOCOL_INVALID");
    expect(contradictory.terminal).toBeUndefined();
    expect(isCompletedChildRun(contradictory)).toBe(false);

    const missingFailureSummary = protocolSummary();
    const missingFailureGates = missingFailureSummary.gates as { passed: boolean; checks: Record<string, boolean>; failureCodes: string[] };
    missingFailureGates.checks.canonicalFactsEqual = false;
    missingFailureGates.passed = false;
    const missingFailure = await runProtocolTerminal({ status: "failed", code: "EQUIVALENCE_GATE_FAILED", summary: missingFailureSummary });
    expect(missingFailure.protocolError).toBe("CHILD_PROTOCOL_INVALID");
    expect(isCompletedChildRun(missingFailure)).toBe(false);

    const missingCheckSummary = protocolSummary();
    delete (missingCheckSummary.gates as { checks: Record<string, boolean> }).checks.navigationResolved;
    const missingCheck = await runProtocolTerminal({ status: "completed", code: "OK", summary: missingCheckSummary });
    expect(missingCheck.protocolError).toBe("CHILD_PROTOCOL_INVALID");

    const wrongTypeSummary = protocolSummary();
    (wrongTypeSummary.gates as { checks: Record<string, unknown> }).checks.navigationResolved = "true";
    const wrongType = await runProtocolTerminal({ status: "completed", code: "OK", summary: wrongTypeSummary });
    expect(wrongType.protocolError).toBe("CHILD_PROTOCOL_INVALID");

    const falseGateSummary = protocolSummary();
    const falseGate = falseGateSummary.gates as { passed: boolean; checks: Record<string, boolean>; failureCodes: string[] };
    falseGate.checks.canonicalFactsEqual = false;
    falseGate.passed = false;
    falseGate.failureCodes = ["PAIR_CANONICAL_FACTS_EQUAL"];
    const failed = await runProtocolTerminal({ status: "failed", code: "EQUIVALENCE_GATE_FAILED", summary: falseGateSummary });
    expect(failed.protocolError).toBeUndefined();
    expect(failed.terminal?.status).toBe("failed");
    expect(isCompletedChildRun(failed)).toBe(false);

    const mismatchedStatus = await runProtocolTerminal({ status: "failed", code: "OK", summary: falseGateSummary });
    expect(mismatchedStatus.protocolError).toBe("CHILD_PROTOCOL_INVALID");
    expect(mismatchedStatus.terminal).toBeUndefined();
  });

  it("force-stops timed out children and returns only after close", async () => {
    const result = await runControlledChild(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: process.cwd(), timeoutMs: 100 });
    expect(result.termination).toBe("timeout");
    expect(result.closed).toBe(true);
    expect(result.exitCode !== null || result.signal !== null).toBe(true);
  });
});
