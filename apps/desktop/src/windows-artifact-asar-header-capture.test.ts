// M13 pure PowerShell tests use synthetic session ledgers and a managed-memory native-call stub.
// They do not open or exercise a Windows file HANDLE or native API.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const modulePath = join(desktop, "scripts/windows-artifact-asar-header-capture.ps1");
const fixturePath = join(desktop, "scripts/test-fixtures/windows-artifact-asar-header-capture-probe.ps1");
const moduleSource = readFileSync(modulePath, "utf8");
const fixtureSource = readFileSync(fixturePath, "utf8");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

type Capture = {
  version: number;
  status: string;
  failureCode: string | null;
  archiveLength: number;
  sizePickleBytesRead: number;
  headerPickleBytesRead: number;
  sizePickleLength: number;
  headerPickleLength: number;
  copySha256: string | null;
  identityProof: string | null;
  snapshotStatus: string;
  signatureStatus: string;
};

type Probe = {
  version: number;
  mode: string;
  capture: Capture;
  sizePickleIsByteArray: boolean;
  headerPickleIsByteArray: boolean;
  expectedSizeMatches: boolean;
  expectedHeaderMatches: boolean;
  emptyArraysOnFailure: boolean;
  reverifyCalls: number;
  captureReadCalls: number;
  sourceReadCalls: number;
  sourceSeekCalls: number;
  sourceChecks: number;
  directoryChecks: number;
  targetMetadataCalls: number;
  m10ReadyAfterCapture: boolean;
  m9ReadyAfterCapture: boolean;
  foreignM9ReadyAfterCapture: boolean | null;
  replacementStillCurrent: boolean;
  replacementReady: boolean | null;
  faultReached: boolean;
  faultStage: string | null;
  closeResult: { released: boolean; releaseStatus: string; ownedHandleCount: number } | null;
  retryResult: { released: boolean; releaseStatus: string; ownedHandleCount: number } | null;
  closeCalls: number;
  sourceHeld: boolean;
  directoryHeld: boolean;
};

function runProbe(mode: string, timeout = 60_000): Probe {
  const child = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixturePath, "-Mode", mode],
    { cwd: desktop, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (child.error) throw new Error("M13 pure PowerShell regression could not start");
  if (child.status !== 0) throw new Error(`M13 pure PowerShell regression failed with exit ${String(child.status)}`);
  const lines = (child.stdout ?? "").trim().split(/\r?\n/);
  if (lines.length !== 1) throw new Error("M13 pure PowerShell probe emitted extra stdout");
  try {
    return JSON.parse(lines[0] ?? "") as Probe;
  } catch {
    throw new Error("M13 pure PowerShell regression returned no bounded DTO");
  }
}

describe("M13 owned ASAR header capture source contract", () => {
  it("exposes one session-only internal endpoint and keeps outputs bounded and redacted", () => {
    expect(moduleSource).toContain("function Get-XRayPrivateArtifactAsarHeaderCapture($Session)");
    expect(moduleSource).toContain("Test-XRayPrivateArtifactCopyReverification $Session");
    expect(moduleSource).toContain("Assert-XRayPrivateCopyReverificationOwner $Owner");
    expect(moduleSource).toContain("Find-XRayOutputFileSession $fileSession");
    expect(moduleSource).toContain("[object]::ReferenceEquals($fileEntry.state, $fileState)");
    expect(moduleSource).toContain("SetFilePointerEx @($targetHandle, [int64]0");
    expect(moduleSource).toContain("Invoke-XRayOutputFileNative ReadFile");
    expect(moduleSource).toContain("[long]2147483648");
    expect(moduleSource).toContain("[uint32]8388608");
    expect(moduleSource).toContain("[long]1048576");
    expect(moduleSource).toContain("snapshotStatus = 'incomplete'");
    expect(moduleSource).toContain("signatureStatus = 'not-evaluated'");
    expect(moduleSource).not.toMatch(/\b(Add-Type|Start-Process|Remove-Item|DeleteFile|MoveFile|GetFullPath|Resolve-Path|ReadAllBytes|WriteAllBytes)\b/);
    expect(moduleSource).not.toMatch(/function Get-XRayPrivateArtifactAsarHeaderCapture\([^)]*(Path|Handle|Stream|Hash|Reader|Callback)/i);
    expect(moduleSource).not.toMatch(/return \[pscustomobject\]@\{[^}]*\b(Path|SID|Exception|Handle|Source|Stream)\s*=/is);
    expect(fixtureSource).toContain("Get-XRayPrivateArtifactAsarHeaderCapture $script:xrayM13CallSession");
    expect(fixtureSource).toContain("$capture.sizePickle -is [byte[]]");
    expect(fixtureSource).toContain("$capture.headerPickle -is [byte[]]");
    expect(fixtureSource).not.toMatch(/ToBase64String|WriteAllBytes|ReadAllBytes|Remove-Item|throw \$_\.Exception/);
    const resultBlock = fixtureSource.slice(fixtureSource.indexOf("$captureDto = [pscustomobject]@{"));
    expect(resultBlock).not.toMatch(/Path|Exception|Handle\s*=|filePath|directoryPath|sizePickle\s*=/i);
  });
});

purePowerShellDescribe("M13 PowerShell 5.1 pure owner and byte-range tests", () => {
  it("returns exact byte arrays and performs both full M11 reverifications for the same owner", () => {
    const result = runProbe("ordinary");
    expect(result.capture).toMatchObject({
      version: 1,
      status: "verified",
      failureCode: null,
      archiveLength: 23,
      sizePickleBytesRead: 8,
      headerPickleBytesRead: 12,
      sizePickleLength: 8,
      headerPickleLength: 12,
      copySha256: expect.stringMatching(/^[A-F0-9]{64}$/),
      identityProof: expect.stringMatching(/^[A-F0-9]{64}$/),
      snapshotStatus: "incomplete",
      signatureStatus: "not-evaluated",
    });
    expect(result.sizePickleIsByteArray).toBe(true);
    expect(result.headerPickleIsByteArray).toBe(true);
    expect(result.expectedSizeMatches).toBe(true);
    expect(result.expectedHeaderMatches).toBe(true);
    expect(result.reverifyCalls).toBe(2);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.sourceChecks).toBeGreaterThan(0);
    expect(result.directoryChecks).toBeGreaterThan(0);
    expect(result.m10ReadyAfterCapture).toBe(true);
    expect(result.m9ReadyAfterCapture).toBe(true);
    expect(result.sourceHeld).toBe(true);
    expect(result.directoryHeld).toBe(true);
    expect(result.closeResult).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
  });

  it("reads a header across the 1 MiB native buffer boundary", () => {
    const result = runProbe("multi-block-header", 120_000);
    expect(result.capture).toMatchObject({ status: "verified", archiveLength: 1_048_591, sizePickleBytesRead: 8, headerPickleBytesRead: 1_048_580 });
    expect(result.captureReadCalls).toBe(3);
    expect(result.headerPickleIsByteArray).toBe(true);
    expect(result.expectedHeaderMatches).toBe(true);
    expect(result.reverifyCalls).toBe(2);
  });

  it("rejects a clone without revoking the registered owner", () => {
    const result = runProbe("clone-session");
    expect(result.capture).toMatchObject({ status: "rejected", failureCode: "ASAR_HEADER_CAPTURE_SESSION_REJECTED", sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.m10ReadyAfterCapture).toBe(true);
    expect(result.m9ReadyAfterCapture).toBe(true);
    expect(result.reverifyCalls).toBe(0);
  });

  it("rejects an empty archive when the exact eight-byte prefix is unavailable", () => {
    const result = runProbe("empty-archive");
    expect(result.capture).toMatchObject({ status: "rejected", failureCode: "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", archiveLength: 0, sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
  });

  it("revokes only M10 when the saved M9 tuple does not match the live registry", () => {
    const result = runProbe("foreign-m9");
    expect(result.capture).toMatchObject({ status: "rejected", failureCode: "ASAR_HEADER_CAPTURE_LEDGER_REJECTED", sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.reverifyCalls).toBe(0);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(true);
    expect(result.foreignM9ReadyAfterCapture).toBe(true);
  });

  it("revokes the captured M9 state but leaves a late replacement untouched", () => {
    const result = runProbe("late-m9-replacement");
    expect(result.capture).toMatchObject({ status: "rejected", failureCode: "ASAR_HEADER_CAPTURE_LEDGER_REJECTED", sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.replacementStillCurrent).toBe(true);
    expect(result.replacementReady).toBe(true);
  });

  it.each(["failed-owner", "released-owner", "unready-owner"])("rejects %s without attempting a read", (mode) => {
    const result = runProbe(mode);
    expect(result.capture.status).toBe("rejected");
    expect(result.capture.sizePickleLength).toBe(0);
    expect(result.capture.headerPickleLength).toBe(0);
    expect(result.captureReadCalls).toBe(0);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
  });

  it.each([
    ["invalid-prefix", "ASAR_HEADER_CAPTURE_SIZE_PICKLE_REJECTED"],
    ["zero-header", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED"],
    ["short-header", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED"],
    ["negative-header", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED"],
    ["oversized-header", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED"],
    ["unaligned-header", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED"],
    ["out-of-bounds", "ASAR_HEADER_CAPTURE_HEADER_BOUNDS_REJECTED"],
    ["negative-archive-length", "ASAR_HEADER_CAPTURE_LEDGER_REJECTED"],
    ["oversized-archive", "ASAR_HEADER_CAPTURE_LEDGER_REJECTED"],
  ] as const)("rejects malformed pickle or archive bounds for %s before returning header bytes", (mode, failureCode) => {
    const result = runProbe(mode);
    expect(result.capture).toMatchObject({ status: "rejected", failureCode, sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.emptyArraysOnFailure).toBe(true);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    if (mode !== "negative-archive-length" && mode !== "oversized-archive") expect(result.capture.headerPickleLength).toBe(0);
  });

  it.each([
    ["seek-failure", "ASAR_HEADER_CAPTURE_SEEK_FAILED", "target-seek"],
    ["read-failure-size", "ASAR_HEADER_CAPTURE_READ_FAILED", "size-read"],
    ["short-read-size", "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", "size-short-read"],
    ["zero-read-size", "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", "size-zero-read"],
    ["over-count-size", "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", "size-over-count"],
    ["read-failure-header", "ASAR_HEADER_CAPTURE_READ_FAILED", "header-read"],
    ["short-read-header", "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", "header-short-read"],
    ["over-count-header", "ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED", "header-over-count"],
  ] as const)("fails closed on %s with no partial bytes", (mode, failureCode, faultStage) => {
    const result = runProbe(mode);
    expect(result.capture).toMatchObject({ status: "rejected", failureCode, archiveLength: 0, sizePickleBytesRead: 0, headerPickleBytesRead: 0, sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.emptyArraysOnFailure).toBe(true);
    expect(result.faultReached).toBe(true);
    expect(result.faultStage).toBe(faultStage);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
  });

  it.each([
    ["m11-before-failure", 1, 0, "before-reverify"],
    ["m11-after-failure", 2, 2, "after-reverify"],
  ] as const)("requires both M11 calls and drops capture bytes when %s fails", (mode, calls, captureReads, faultStage) => {
    const result = runProbe(mode);
    expect(result.capture).toMatchObject({ status: "rejected", failureCode: "ASAR_HEADER_CAPTURE_REVERIFY_REJECTED", sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.reverifyCalls).toBe(calls);
    expect(result.captureReadCalls).toBe(captureReads);
    expect(result.faultStage).toBe(faultStage);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
  });

  it.each([
    ["source-change", "ASAR_HEADER_CAPTURE_SOURCE_CHANGED"],
    ["directory-change", "ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED"],
    ["target-metadata-change", "ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED"],
  ] as const)("rechecks borrowed and target ownership during capture (%s)", (mode, failureCode) => {
    const result = runProbe(mode);
    expect(result.capture).toMatchObject({ status: "rejected", failureCode, sizePickleLength: 0, headerPickleLength: 0 });
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
  });

  it("retains M10 close retry after a first unconfirmed handle release", () => {
    const result = runProbe("close-retry");
    expect(result.capture.status).toBe("verified");
    expect(result.closeResult).toMatchObject({ released: false, releaseStatus: "unconfirmed", ownedHandleCount: 1 });
    expect(result.retryResult).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.closeCalls).toBeGreaterThan(1);
  });
});
