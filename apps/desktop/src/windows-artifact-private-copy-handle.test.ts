// Real Windows HANDLE tests. Run only in the coordinator's technical validation window.
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
const fixture = join(desktop, "scripts/test-fixtures/windows-artifact-private-copy-probe.ps1");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const fixtureSource = readFileSync(fixture, "utf8");
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

type CopySummary = {
  status: string;
  ready: boolean;
  created: boolean;
  failureCode: string | null;
  releaseStatus: string;
  releaseFailureCode: string | null;
  released: boolean;
  sourceConsumed: boolean;
  bytesRequested: number;
  sourceBytesRead: number;
  bytesWritten: number;
  copyBytesRead: number;
  sourceSha256: string | null;
  copySha256: string | null;
  sourceIdentityProof: string | null;
  outputIdentityProof: string | null;
  snapshotStatus: string;
  signatureStatus: string;
  ownedHandleCount: number;
};

type ReleaseSummary = {
  ready: boolean;
  released: boolean;
  releaseStatus: string;
  releaseFailureCode: string | null;
  failureCode: string | null;
  ownedHandleCount: number;
};

type FixtureResult = {
  version: number;
  mode: string;
  fixtureFailureStage: string | null;
  fixtureFailureCode: string | null;
  attempted: boolean;
  faultReached: boolean;
  faultStage: string | null;
  copySummary: CopySummary | null;
  firstRelease: ReleaseSummary | null;
  copyRelease: ReleaseSummary | null;
  sourceStillHeldAfterCopyClose: boolean;
  m8BorrowedSessionStillHeldAfterCopyClose: boolean;
  targetRenameBlocked: boolean | null;
  targetDeleteBlocked: boolean | null;
  targetAcl: { aclVerified: boolean; ownerVerified: boolean; daclPresent: boolean; daclProtected: boolean; aceCount: number };
  collisionBefore: { kind: string; identityProof: string; contentHash: string } | null;
  collisionAfter: { kind: string; identityProof: string; contentHash: string } | null;
};

function runProbe(mode: string, timeout = 180_000): FixtureResult {
  const root = mkdtempSync(join(tmpdir(), "xray-m10-private-copy-"));
  const child = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Mode", mode, "-RootPath", root],
    { cwd: desktop, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (child.error) throw new Error("M10 Windows copy fixture could not start");
  if (child.status !== 0) throw new Error(`M10 Windows copy fixture failed with exit ${String(child.status)}`);
  const lines = (child.stdout ?? "").trim().split(/\r?\n/);
  let result: FixtureResult;
  try {
    result = JSON.parse(lines[lines.length - 1] ?? "") as FixtureResult;
  } catch {
    throw new Error("M10 Windows copy fixture did not return its bounded result DTO");
  }
  expect(result.version).toBe(1);
  expect(result.fixtureFailureCode).toBeNull();
  expect(result.fixtureFailureStage).toBeNull();
  expect(result.attempted).toBe(true);
  return result;
}

function runPureFixtureIdentityProbe(): string {
  const start = fixtureSource.indexOf("function Get-XRayPrivateCopyFixtureIdentity(");
  const end = fixtureSource.indexOf("\nfunction Get-XRayPrivateCopyFixtureProof", start);
  if (start < 0 || end <= start) throw new Error("M10 fixture identity helper was not found");
  const helper = fixtureSource.slice(start, end);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$script:fixtureDeletePending = [byte]0; $script:fixtureDirectory = [byte]1; $script:fixtureShouldRejectReparse = $true; $script:fixtureClasses = @()",
    "function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) { if ($script:fixtureShouldRejectReparse) { throw 'REPARSE_REJECTED' }; return [pscustomobject]@{ directory = $Directory } }",
    "function New-XRayZeroBuffer([int]$Size) { $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($Size); [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($Size), 0, $pointer, $Size); return $pointer }",
    "function Invoke-XRayNative([string]$Name, [object[]]$Arguments) { if ($Name -cne 'GetFileInformationByHandleEx') { throw 'PURE_STUB_UNEXPECTED_API' }; $script:fixtureClasses += [int]$Arguments[1]; if ([int]$Arguments[1] -eq 1) { [Runtime.InteropServices.Marshal]::WriteByte([IntPtr]$Arguments[2], 20, [byte]$script:fixtureDeletePending); [Runtime.InteropServices.Marshal]::WriteByte([IntPtr]$Arguments[2], 21, [byte]$script:fixtureDirectory); return 1 }; if ([int]$Arguments[1] -eq 18) { [Runtime.InteropServices.Marshal]::WriteInt64([IntPtr]$Arguments[2], 0, [long]1); $id = [byte[]]::new(16); $id[0] = [byte]1; [Runtime.InteropServices.Marshal]::Copy($id, 0, [IntPtr]::Add([IntPtr]$Arguments[2], 8), 16); return 1 }; throw 'PURE_STUB_UNEXPECTED_CLASS' }",
    helper,
    "$valid = Get-XRayPrivateCopyFixtureIdentity ([IntPtr]4660) $true $true",
    "if ($valid.volume -cne '0000000000000001' -or $valid.fileId -cne '01000000000000000000000000000000' -or -not $valid.directory -or ($script:fixtureClasses -join ',') -cne '1,18') { throw 'M10_PURE_REPARSE_IDENTITY_MISMATCH' }",
    "function Assert-IdentityRejected([byte]$DeletePending, [byte]$IsDirectory, [bool]$M4RejectsReparse) { $script:fixtureDeletePending = $DeletePending; $script:fixtureDirectory = $IsDirectory; $script:fixtureShouldRejectReparse = $M4RejectsReparse; $code = $null; try { $null = Get-XRayPrivateCopyFixtureIdentity ([IntPtr]4660) $true $true } catch { $code = $_.Exception.Message }; if ($code -cne 'FIXTURE_IDENTITY_FAILED') { throw 'M10_PURE_UNSAFE_REPARSE_ACCEPTED' } }",
    "Assert-IdentityRejected ([byte]1) ([byte]1) $true",
    "Assert-IdentityRejected ([byte]0) ([byte]0) $true",
    "Assert-IdentityRejected ([byte]0) ([byte]1) $false",
    "Write-Output 'M10_PURE_REPARSE_IDENTITY_PASS'",
  ].join("\r\n");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { cwd: desktop, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (result.error) throw new Error("Pure PowerShell M10 identity helper regression could not start");
  if (result.status !== 0) throw new Error(`Pure PowerShell M10 identity helper regression failed: ${(result.stderr ?? "").trim()}`);
  return result.stdout ?? "";
}

function expectCopiedAndReleased(result: FixtureResult, byteCount?: number): void {
  expect(result.copySummary).toMatchObject({
    status: "ready",
    ready: true,
    created: true,
    failureCode: null,
    sourceConsumed: true,
    snapshotStatus: "incomplete",
    signatureStatus: "not-evaluated",
    ownedHandleCount: 1,
  });
  expect(result.copySummary?.sourceSha256).toMatch(/^[A-F0-9]{64}$/);
  expect(result.copySummary?.copySha256).toBe(result.copySummary?.sourceSha256);
  expect(result.copySummary?.sourceIdentityProof).toMatch(/^[A-F0-9]{64}$/);
  expect(result.copySummary?.outputIdentityProof).toMatch(/^[A-F0-9]{64}$/);
  expect(result.copySummary?.bytesWritten).toBe(result.copySummary?.bytesRequested);
  expect(result.copySummary?.copyBytesRead).toBe(result.copySummary?.bytesRequested);
  if (byteCount !== undefined) expect(result.copySummary?.bytesRequested).toBe(byteCount);
  expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
  expect(result.sourceStillHeldAfterCopyClose).toBe(true);
  expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
}

describe("M10 private copy HANDLE fixture source contracts", () => {
  it("keeps all fault injection inside the unexecuted fixture and returns no paths or exception text", () => {
    for (const mode of [
      "ordinary", "empty", "unicode", "multiblock", "over-32mib", "collision-file", "collision-directory", "collision-link",
      "already-consumed", "source-identity-change", "target-identity-change", "source-read-failure", "source-short-read",
      "write-failure", "short-write", "target-read-failure", "target-short-read", "target-eof-mismatch", "acl-query-failure", "close-failure",
    ]) expect(fixtureSource).toContain(`'${mode}'`);
    expect(fixtureSource).toContain("$null -ne $script:xrayPrivateCopySource -and $script:xrayPrivateCopySource.readStarted");
    expect(fixtureSource).toContain("sourceStillHeldAfterCopyClose = [bool]$sourceStillHeld");
    expect(fixtureSource).toContain("m8BorrowedSessionStillHeldAfterCopyClose = [bool]$m8BorrowedSessionStillHeld");
    expect(fixtureSource).toContain("ReadByte($standard, 20) -ne 0");
    expect(fixtureSource).toContain("$isDirectory -ne $Directory");
    expect(fixtureSource).toContain("Get-XRayHandleMetadata $Handle $Directory");
    expect(fixtureSource).toContain("GetFileInformationByHandleEx @($Handle, 18, $identity, [uint32]24)");
    expect(fixtureSource).not.toMatch(/Remove-Item|\[IO\.Directory\]::Delete|\bthrow \$_.Exception/);
    const resultBlock = fixtureSource.slice(fixtureSource.indexOf("$result = [pscustomobject]@{"));
    expect(resultBlock).not.toMatch(/Path|Exception|Handle =|filePath|directoryPath/i);
  });
});

purePowerShellDescribe("M10 collision-link identity helper (stubbed PowerShell data; no HANDLE or native API)", () => {
  it("accepts only a non-pending reparse identity with the requested directory type and full 128-bit id", () => {
    expect(runPureFixtureIdentityProbe()).toContain("M10_PURE_REPARSE_IDENTITY_PASS");
  }, 40000);
});

windowsDescribe("M10 held-source to private-output HANDLE copy (coordinator validation only)", () => {
  it.each(["ordinary", "unicode", "multiblock"] as const)("copies and independently reads back %s bytes", (mode) => {
    const result = runProbe(mode);
    expectCopiedAndReleased(result);
    expect(result.targetRenameBlocked).toBe(true);
    expect(result.targetDeleteBlocked).toBe(true);
    expect(result.targetAcl).toMatchObject({ aclVerified: true, ownerVerified: true, daclPresent: true, daclProtected: true });
    expect(result.targetAcl.aceCount).toBeGreaterThanOrEqual(1);
  }, 210_000);

  it("handles empty input with independent empty SHA-256 and exact EOF checks", () => {
    const result = runProbe("empty");
    expectCopiedAndReleased(result, 0);
    expect(result.copySummary?.sourceSha256).toBe("E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855");
  });

  it("copies beyond M9's 32 MiB caller-buffer limit using fixed M10 chunks", () => {
    const result = runProbe("over-32mib", 300_000);
    expectCopiedAndReleased(result, 33_554_433);
  }, 330_000);

  it.each([
    ["already-consumed", "PRIVATE_COPY_SOURCE_REJECTED", "", false],
    ["source-identity-change", "PRIVATE_COPY_SOURCE_CHANGED", "source-identity-recheck", true],
    ["target-identity-change", "PRIVATE_COPY_TARGET_CHANGED", "target-identity-recheck", true],
    ["source-read-failure", "PRIVATE_COPY_SOURCE_READ_FAILED", "source-read", true],
    ["source-short-read", "PRIVATE_COPY_SOURCE_SHORT_READ", "source-short-read", true],
    ["write-failure", "PRIVATE_COPY_WRITE_FAILED", "write", true],
    ["short-write", "PRIVATE_COPY_WRITE_COUNT_REJECTED", "short-write", true],
    ["target-read-failure", "PRIVATE_COPY_READ_FAILED", "target-read", true],
    ["target-short-read", "PRIVATE_COPY_READ_COUNT_REJECTED", "target-short-read", true],
    ["target-eof-mismatch", "PRIVATE_COPY_EOF_REJECTED", "target-eof", true],
    ["acl-query-failure", "PRIVATE_COPY_OUTPUT_REJECTED", "acl-query", false],
  ] as const)("fails closed for %s after its intended stage", (mode, failureCode, stage, sourceConsumed) => {
    const result = runProbe(mode);
    expect(result.copySummary).toMatchObject({ ready: false, failureCode, sourceConsumed });
    expect(result.firstRelease?.released).toBe(true);
    expect(result.copyRelease?.released).toBe(true);
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
    if (stage) {
      expect(result.faultReached).toBe(true);
      expect(result.faultStage).toBe(stage);
    }
  });

  it.each(["collision-file", "collision-directory", "collision-link"] as const)("preserves the existing %s identity and content", (mode) => {
    const result = runProbe(mode);
    expect(result.fixtureFailureCode).toBeNull();
    expect(result.fixtureFailureStage).toBeNull();
    expect(result.attempted).toBe(true);
    expect(result.copySummary).toMatchObject({ ready: false, created: false, failureCode: "PRIVATE_COPY_OUTPUT_REJECTED" });
    expect(result.collisionBefore?.identityProof).toMatch(/^[A-F0-9]{64}$/);
    expect(result.collisionBefore?.contentHash).toMatch(/^[A-F0-9]{64}$/);
    expect(result.collisionAfter).toEqual(result.collisionBefore);
    expect(result.copySummary?.sourceConsumed).toBe(false);
    expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
  });

  it("retains the first unconfirmed close DTO and succeeds on exact-owner retry", () => {
    const result = runProbe("close-failure");
    expect(result.copySummary?.ready).toBe(true);
    expect(result.faultReached).toBe(true);
    expect(result.faultStage).toBe("close");
    expect(result.firstRelease).toMatchObject({ ready: false, released: false, releaseStatus: "unconfirmed", ownedHandleCount: 1 });
    expect(result.firstRelease?.releaseFailureCode).toBe("PRIVATE_COPY_CLOSE_UNCONFIRMED");
    expect(result.copyRelease).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
    expect(result.sourceStillHeldAfterCopyClose).toBe(true);
    expect(result.m8BorrowedSessionStillHeldAfterCopyClose).toBe(true);
  }, 210_000);
});
