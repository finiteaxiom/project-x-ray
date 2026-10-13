// Coordinator-gated tests that exercise real Windows file HANDLEs through the M10/M11 modules.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const fixture = join(desktop, "scripts/test-fixtures/windows-artifact-copy-reverification-probe.ps1");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const fixtureSource = readFileSync(fixture, "utf8");
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

type Verification = {
  version: number;
  status: string;
  failureCode: string | null;
  bytesRequested: number;
  bytesRead: number;
  copySha256: string | null;
  identityProof: string | null;
  snapshotStatus: string;
  signatureStatus: string;
};

type CopySummary = {
  status: string;
  ready: boolean;
  created: boolean;
  failureCode: string | null;
  released: boolean;
  sourceConsumed: boolean;
  bytesRequested: number;
  sourceBytesRead: number;
  bytesWritten: number;
  copyBytesRead: number;
  sourceSha256: string | null;
  copySha256: string | null;
  outputIdentityProof: string | null;
  snapshotStatus: string;
  signatureStatus: string;
  ownedHandleCount: number;
};

type Release = {
  ready: boolean;
  released: boolean;
  releaseStatus: string;
  releaseFailureCode: string | null;
  ownedHandleCount: number;
};

type ProbeResult = {
  version: number;
  mode: string;
  fixtureFailureStage: string | null;
  fixtureFailureCode: string | null;
  attempted: boolean;
  copyReadyBeforeVerification: boolean;
  copySummaryBefore: CopySummary | null;
  firstVerification: Verification | null;
  secondVerification: Verification | null;
  cloneVerification: Verification | null;
  unconfirmedVerification: Verification | null;
  readsBeforeUnconfirmedVerify: number | null;
  readsAfterUnconfirmedVerify: number | null;
  copySummaryAfterVerification: CopySummary | null;
  firstRelease: Release | null;
  copyRelease: Release | null;
  m10ReadyAfterVerification: boolean;
  m9ReadyAfterVerification: boolean;
  m10ReadyAfterClone: boolean;
  m9ReadyAfterClone: boolean;
  faultReached: boolean;
  faultStage: string | null;
  closeRetryReached: boolean;
  closeFaultStage: string | null;
  sourceReadCallsDuringVerification: number;
  sourceSeekCallsDuringVerification: number;
  sourceStillHeldAfterCopyClose: boolean;
  m8BorrowedSessionStillHeldAfterCopyClose: boolean;
};

function runProbe(mode: string, timeout = 240_000): ProbeResult {
  // Keep this self-owned fixture scene for inspection; do not recursively remove temp material.
  const root = mkdtempSync(join(tmpdir(), "xray-m11-copy-reverify-"));
  const child = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Mode", mode, "-RootPath", root],
    { cwd: desktop, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (child.error) throw new Error("M11 Windows re-verification fixture could not start");
  if (child.status !== 0) throw new Error(`M11 Windows re-verification fixture failed with exit ${String(child.status)}`);
  const lines = (child.stdout ?? "").trim().split(/\r?\n/);
  let result: ProbeResult;
  try {
    result = JSON.parse(lines[lines.length - 1] ?? "") as ProbeResult;
  } catch {
    throw new Error("M11 Windows re-verification fixture did not return its bounded result DTO");
  }
  expect(result.version).toBe(1);
  expect(result.fixtureFailureCode).toBeNull();
  expect(result.fixtureFailureStage).toBeNull();
  expect(result.attempted).toBe(true);
  return result;
}

describe("M11 Windows fixture source contract", () => {
  it("keeps fault injection in the gated fixture and emits no paths, handles, or exception text", () => {
    for (const mode of [
      "ordinary", "empty", "unicode", "multiblock", "over-32mib", "clone-session", "released-session", "not-ready",
      "target-identity-change", "target-length-change", "target-metadata-change", "source-identity-change", "directory-identity-change",
      "owner-reference-change", "read-failure", "short-read", "over-count", "eof-mismatch", "seek-failure",
      "hash-mismatch", "read-failure-close-retry",
    ]) expect(fixtureSource).toContain(`'${mode}'`);
    expect(fixtureSource).toContain("copyReadyBeforeVerification = [bool]$copySummaryBefore.ready");
    expect(fixtureSource).toContain("Test-XRayPrivateArtifactCopyReverification $clone");
    expect(fixtureSource).toContain("Test-XRayPrivateArtifactCopyReverification $copySession");
    expect(fixtureSource).toContain("sourceStillHeldAfterCopyClose = [bool]$sourceStillHeldAfterCopyClose");
    expect(fixtureSource).toContain("m8BorrowedSessionStillHeldAfterCopyClose = [bool]$directoryStillHeldAfterCopyClose");
    expect(fixtureSource).toContain("target-read-buffer-hash-mismatch-not-file-write");
    expect(fixtureSource).not.toMatch(/Remove-Item|\[IO\.Directory\]::Delete|\bthrow \$_\.Exception/);
    const resultBlock = fixtureSource.slice(fixtureSource.indexOf("$result = [pscustomobject]@{"));
    expect(resultBlock).not.toMatch(/Path|Exception|Handle\s*=|filePath|directoryPath/i);
  });
});

windowsDescribe("M11 repeated verification of the M10-owned target HANDLE", () => {
  it.each([
    ["ordinary", 54],
    ["empty", 0],
    ["unicode", 20],
    ["multiblock", 2_097_169],
    ["over-32mib", 33_554_433],
  ] as const)("reads %s through the same target HANDLE twice with exact length, hash, EOF, and stable owner ledgers", (mode, length) => {
    const result = runProbe(mode, mode === "over-32mib" ? 360_000 : 240_000);
    expect(result.copyReadyBeforeVerification).toBe(true);
    expect(result.copySummaryBefore).toMatchObject({ ready: true, sourceConsumed: true, bytesRequested: length });
    expect(result.firstVerification).toMatchObject({ status: "verified", failureCode: null, bytesRequested: length, bytesRead: length });
    expect(result.secondVerification).toMatchObject({ status: "verified", failureCode: null, bytesRequested: length, bytesRead: length });
    expect(result.firstVerification?.copySha256).toMatch(/^[A-F0-9]{64}$/);
    expect(result.secondVerification?.copySha256).toBe(result.firstVerification?.copySha256);
    expect(result.firstVerification?.copySha256).toBe(result.copySummaryBefore?.copySha256);
    expect(result.firstVerification?.identityProof).toBe(result.copySummaryBefore?.outputIdentityProof);
    expect(result.firstVerification).toMatchObject({ snapshotStatus: "incomplete", signatureStatus: "not-evaluated" });
    expect(result.copySummaryAfterVerification).toMatchObject({ ready: true, status: "ready" });
    expect(result.copySummaryAfterVerification).toMatchObject({
      sourceBytesRead: result.copySummaryBefore?.sourceBytesRead,
      bytesWritten: result.copySummaryBefore?.bytesWritten,
      copyBytesRead: result.copySummaryBefore?.copyBytesRead,
    });
    expect(result.m10ReadyAfterVerification).toBe(true);
    expect(result.m9ReadyAfterVerification).toBe(true);
    expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
    expect(result.sourceReadCallsDuringVerification).toBe(0);
    expect(result.sourceSeekCallsDuringVerification).toBe(0);
    expect(result.faultReached).toBe(false);
  }, 390_000);

  it("rejects a cloned session without revoking the true owner", () => {
    const result = runProbe("clone-session");
    expect(result.copyReadyBeforeVerification).toBe(true);
    expect(result.cloneVerification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_SESSION_REJECTED" });
    expect(result.m10ReadyAfterClone).toBe(true);
    expect(result.m9ReadyAfterClone).toBe(true);
    expect(result.firstVerification).toMatchObject({ status: "verified" });
    expect(result.copyRelease).toMatchObject({ released: true, ownedHandleCount: 0 });
  }, 240_000);

  it("rejects a released owner", () => {
    const result = runProbe("released-session");
    expect(result.copyReadyBeforeVerification).toBe(true);
    expect(result.firstRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.firstVerification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_SESSION_REJECTED" });
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
  }, 240_000);

  it.each([
    ["not-ready", "COPY_REVERIFY_NOT_READY", "owner-ready-flag-after-copy-ready"],
    ["target-identity-change", "COPY_REVERIFY_TARGET_IDENTITY_REJECTED", "target-identity-recheck"],
    ["target-length-change", "COPY_REVERIFY_TARGET_IDENTITY_REJECTED", "target-length-recheck"],
    ["target-metadata-change", "COPY_REVERIFY_TARGET_IDENTITY_REJECTED", "target-full-metadata-recheck"],
    ["source-identity-change", "COPY_REVERIFY_SOURCE_CHANGED", "source-identity-recheck"],
    ["directory-identity-change", "COPY_REVERIFY_DIRECTORY_CHANGED", "directory-identity-recheck"],
    ["owner-reference-change", "COPY_REVERIFY_LEDGER_REJECTED", "owner-reference-recheck"],
    ["read-failure", "COPY_REVERIFY_READ_FAILED", "target-read"],
    ["short-read", "COPY_REVERIFY_READ_COUNT_REJECTED", "target-short-read"],
    ["over-count", "COPY_REVERIFY_READ_COUNT_REJECTED", "target-read-count"],
    ["eof-mismatch", "COPY_REVERIFY_EOF_REJECTED", "target-eof"],
    ["seek-failure", "COPY_REVERIFY_SEEK_FAILED", "target-seek"],
    ["hash-mismatch", "COPY_REVERIFY_CONTENT_MISMATCH", "target-read-buffer-hash-mismatch-not-file-write"],
  ] as const)("permanently revokes ready after %s, only after M10 reported ready", (mode, failureCode, faultStage) => {
    const result = runProbe(mode);
    expect(result.copyReadyBeforeVerification).toBe(true);
    expect(result.firstVerification).toMatchObject({ status: "rejected", failureCode });
    expect(result.faultReached).toBe(true);
    expect(result.faultStage).toBe(faultStage);
    expect(result.m10ReadyAfterVerification).toBe(false);
    expect(result.m9ReadyAfterVerification).toBe(false);
    expect(result.copySummaryAfterVerification).toMatchObject({ ready: false, status: "rejected" });
    expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
  }, 240_000);

  it("keeps the precise owned ledger on an unconfirmed close and releases it on the original close retry", () => {
    const result = runProbe("read-failure-close-retry");
    expect(result.firstVerification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_READ_FAILED" });
    expect(result.unconfirmedVerification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_NOT_READY" });
    expect(result.readsAfterUnconfirmedVerify).toBe(result.readsBeforeUnconfirmedVerify);
    expect(result.firstRelease).toMatchObject({ ready: false, released: false, releaseStatus: "unconfirmed", ownedHandleCount: 1 });
    expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.closeRetryReached).toBe(true);
    expect(result.closeFaultStage).toBe("first-close-unconfirmed");
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
  }, 240_000);
});
