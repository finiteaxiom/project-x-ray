// Real Windows HANDLE tests use only roots and materials created by this fixture.
// This suite is deliberately not part of the developer-side M9 validation window.
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
const fixture = join(desktop, "scripts/test-fixtures/windows-artifact-output-file-probe.ps1");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;
const fixtureSource = readFileSync(fixture, "utf8");

type OutputFileRelease = {
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
  outputFileNativeCallCount: number;
  outputFileHandleCaptured: boolean;
  outputFileExpectedBytes: number;
  outputFileSuccessfulWriteBytes: number;
  identityRecheckReached: boolean;
  m8BorrowedSessionStillHeld: boolean;
  fileSummary: {
    token: string | null;
    status: string;
    ready: boolean;
    created: boolean;
    failureCode: string | null;
    releaseStatus: string;
    bytesRequested: number;
    bytesWritten: number;
    bytesRead: number;
    inputSha256: string | null;
    readbackSha256: string | null;
    snapshotStatus: string;
    signatureStatus: string;
    ownedHandleCount: number;
  };
  fileFirstRelease: OutputFileRelease | null;
  fileRelease: OutputFileRelease | null;
  targetUnchanged: boolean | null;
  targetKind: string | null;
  targetIdentityBeforeProof: string | null;
  targetIdentityAfterProof: string | null;
  targetIdentityUnchanged: boolean | null;
  externalDirectoryIdentityBeforeProof: string | null;
  externalDirectoryIdentityAfterProof: string | null;
  externalDirectoryIdentityUnchanged: boolean | null;
  markerIdentityBeforeProof: string | null;
  markerIdentityAfterProof: string | null;
  markerIdentityUnchanged: boolean | null;
};

function runProbe(mode: string, timeout = 120_000): FixtureResult {
  const root = mkdtempSync(join(tmpdir(), "xray-m9-output-file-"));
  const child = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Mode", mode, "-RootPath", root],
    { cwd: desktop, encoding: "utf8", timeout, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (child.error) throw new Error("M9 Windows file fixture could not start");
  if (child.status !== 0) throw new Error(`M9 Windows file fixture failed with exit ${String(child.status)}`);
  const lines = (child.stdout ?? "").trim().split(/\r?\n/);
  const lastLine = lines[lines.length - 1] ?? "";
  let result: FixtureResult;
  try {
    result = JSON.parse(lastLine) as FixtureResult;
  } catch {
    throw new Error("M9 Windows file fixture did not return its bounded result DTO");
  }
  expect(result.version).toBe(1);
  expect(result.fixtureFailureCode).toBeNull();
  expect(result.fixtureFailureStage).toBeNull();
  expect(result.attempted).toBe(true);
  return result;
}

function expectReadyAndReleased(result: FixtureResult, expectedBytes?: number): void {
  expect(result.fileSummary.ready).toBe(true);
  expect(result.fileSummary.status).toBe("ready");
  expect(result.fileSummary.created).toBe(true);
  expect(result.fileSummary.failureCode).toBeNull();
  expect(result.fileSummary.token).toMatch(/^[a-f0-9]{32}$/);
  expect(result.fileSummary.inputSha256).toMatch(/^[A-F0-9]{64}$/);
  expect(result.fileSummary.readbackSha256).toBe(result.fileSummary.inputSha256);
  expect(result.fileSummary.bytesWritten).toBe(result.fileSummary.bytesRequested);
  expect(result.fileSummary.bytesRead).toBe(result.fileSummary.bytesRequested);
  if (expectedBytes !== undefined) expect(result.fileSummary.bytesRequested).toBe(expectedBytes);
  expect(result.fileSummary.snapshotStatus).toBe("incomplete");
  expect(result.fileSummary.signatureStatus).toBe("not-evaluated");
  expect(result.fileSummary.ownedHandleCount).toBe(1);
  expect(result.m8BorrowedSessionStillHeld).toBe(true);
  expect(result.fileRelease?.released).toBe(true);
  expect(result.fileRelease?.releaseStatus).toBe("released");
  expect(result.fileRelease?.ownedHandleCount).toBe(0);
}

function expectReachedFailure(result: FixtureResult, code: string, stage: string): void {
  expect(result.fileSummary.ready).toBe(false);
  expect(result.fileSummary.failureCode).toBe(code);
  expect(result.faultReached).toBe(true);
  expect(result.faultStage).toBe(stage);
  expect(result.fileRelease?.released).toBe(true);
  expect(result.fileRelease?.releaseStatus).toBe("released");
}

describe("M9 Windows fixture source contracts", () => {
  it("keeps the directory identity fault to the exact M8 three-field projection", () => {
    expect(fixtureSource).toMatch(
      /createdIdentity = \[pscustomobject\]@\{\s*volume = \[string\]\$savedIdentity\.volume;\s*fileId = \$wrongFileId;\s*directory = \$true\s*\}/,
    );
    expect(fixtureSource).toMatch(/if \(\[string\]\$savedIdentity\.fileId -ceq \$wrongFileId\) \{ \$wrongFileId = '2' \* 32 \}/);
  });

  it("injects the file identity fault only after the captured output HANDLE wrote the full payload", () => {
    expect(fixtureSource).toMatch(/\$Handle -eq \$script:xrayOutputFileCreatedHandle/);
    expect(fixtureSource).toMatch(/\$script:xrayOutputFileExpectedBytes -gt 0/);
    expect(fixtureSource).toMatch(/\$script:xrayOutputFileReportedWriteBytes -eq \$script:xrayOutputFileExpectedBytes/);
    expect(fixtureSource).toMatch(/\[long\]\$metadata\.length -eq \$script:xrayOutputFileExpectedBytes/);
    expect(fixtureSource).toMatch(/\$script:xrayOutputFileIdentityRecheckReached = \$true/);
    expect(fixtureSource).toMatch(/\$script:xrayOutputFileCreatedHandle = \$handle/);
    expect(fixtureSource).toMatch(/\$result -ne 0 -and \[IntPtr\]\$Arguments\[0\] -eq \$script:xrayOutputFileCreatedHandle/);
    expect(fixtureSource).toMatch(/\$script:xrayOutputFileReportedWriteBytes \+= \[long\]\[uint32\]\$Arguments\[3\]/);
  });

  it("preserves the first close DTO and samples target identities through M4 no-follow HANDLEs", () => {
    expect(fixtureSource).toMatch(/\$fileFirstRelease = \$fileRelease\s*\$fixtureStage = 'retry-close-output-file'\s*\$fileRelease = Close-XRayPrivateArtifactOutputFile/);
    expect(fixtureSource).toMatch(/Open-XRayRelativeHandle \$Parent \$Component \$Directory/);
    expect(fixtureSource).toMatch(/Get-XRayHandleMetadata \$Handle \$Directory/);
    expect(fixtureSource).toMatch(/if \(\$_\.Exception\.Message -cne 'REPARSE_REJECTED'\)/);
    expect(fixtureSource).toMatch(/Invoke-XRayNative GetFileInformationByHandleEx @\(\$Handle, 18, \$identity, \[uint32\]24\)/);
    expect(fixtureSource).toMatch(/Get-XRayOutputFileFixtureTargetSnapshot 'existing-link'/);
    expect(fixtureSource).toMatch(/targetIdentityBeforeProof = Get-XRayOutputFileFixtureIdentityProof/);
    expect(fixtureSource).not.toMatch(/Get-Item -LiteralPath \$targetPath/);
  });
});

windowsDescribe("M9 private sidecar HANDLE and same-handle readback fixture (coordinator validation only)", () => {
  it("creates a Unicode-content sidecar and verifies exact readback before release", () => {
    const result = runProbe("ordinary");
    expectReadyAndReleased(result);
  }, 150_000);

  it("creates and verifies an empty sidecar including exact EOF", () => {
    const result = runProbe("empty");
    expectReadyAndReleased(result, 0);
    expect(result.fileSummary.bytesWritten).toBe(0);
    expect(result.fileSummary.bytesRead).toBe(0);
  }, 120_000);

  it("accepts the exact 32 MiB boundary and rejects one byte over before any native call", () => {
    const boundary = runProbe("maximum", 240_000);
    expectReadyAndReleased(boundary, 33_554_432);

    const over = runProbe("over-limit");
    expect(over.fileSummary.ready).toBe(false);
    expect(over.fileSummary.failureCode).toBe("OUTPUT_FILE_LIMIT_REJECTED");
    expect(over.fileSummary.created).toBe(false);
    expect(over.outputFileNativeCallCount).toBe(0);
    expect(over.fileRelease?.released).toBe(true);
  }, 300_000);

  it.each(["existing-file", "existing-directory", "existing-link"] as const)(
    "preserves an existing %s target when fixed FILE_CREATE collides",
    (mode) => {
      const result = runProbe(mode);
      expect(result.fileSummary.ready).toBe(false);
      expect(result.fileSummary.failureCode).toBe("OUTPUT_FILE_CREATE_REJECTED");
      expect(result.fileSummary.created).toBe(false);
      expect(result.targetKind).toBe(mode.slice("existing-".length));
      expect(result.targetUnchanged).toBe(true);
      expect(result.targetIdentityBeforeProof).toMatch(/^[A-F0-9]{64}$/);
      expect(result.targetIdentityAfterProof).toBe(result.targetIdentityBeforeProof);
      expect(result.targetIdentityUnchanged).toBe(true);
      if (mode === "existing-link") {
        expect(result.externalDirectoryIdentityBeforeProof).toMatch(/^[A-F0-9]{64}$/);
        expect(result.externalDirectoryIdentityAfterProof).toBe(result.externalDirectoryIdentityBeforeProof);
        expect(result.externalDirectoryIdentityUnchanged).toBe(true);
        expect(result.markerIdentityBeforeProof).toMatch(/^[A-F0-9]{64}$/);
        expect(result.markerIdentityAfterProof).toBe(result.markerIdentityBeforeProof);
        expect(result.markerIdentityUnchanged).toBe(true);
      }
      expect(result.m8BorrowedSessionStillHeld).toBe(true);
      expect(result.fileRelease?.released).toBe(true);
    },
  );

  it.each([
    ["wrong-directory", "OUTPUT_FILE_DIRECTORY_REJECTED"],
    ["directory-not-ready", "OUTPUT_FILE_DIRECTORY_REJECTED"],
    ["directory-identity-mismatch", "OUTPUT_FILE_DIRECTORY_REJECTED"],
    ["forged-directory", "OUTPUT_FILE_DIRECTORY_REJECTED"],
    ["closed-directory", "OUTPUT_FILE_DIRECTORY_REJECTED"],
  ] as const)("fails closed for %s without a created file", (mode, code) => {
    const result = runProbe(mode);
    expect(result.fileSummary.ready).toBe(false);
    expect(result.fileSummary.failureCode).toBe(code);
    expect(result.fileSummary.created).toBe(false);
    expect(result.fileRelease?.released).toBe(true);
    if (mode === "closed-directory") expect(result.m8BorrowedSessionStillHeld).toBe(false);
    else expect(result.m8BorrowedSessionStillHeld).toBe(true);
  });

  it.each([
    ["native-create-failure", "OUTPUT_FILE_CREATE_REJECTED", "native-create"],
    ["write-failure", "OUTPUT_FILE_WRITE_FAILED", "write"],
    ["short-write", "OUTPUT_FILE_WRITE_COUNT_REJECTED", "short-write"],
    ["read-failure", "OUTPUT_FILE_READ_FAILED", "read"],
    ["short-read", "OUTPUT_FILE_READ_COUNT_REJECTED", "short-read"],
    ["eof-mismatch", "OUTPUT_FILE_EOF_REJECTED", "eof-probe"],
    ["acl-query-failure", "OUTPUT_FILE_ACL_QUERY_FAILED", "acl-query"],
    ["extra-ace", "OUTPUT_FILE_ACL_ACE_COUNT_REJECTED", "acl-verify"],
    ["null-dacl", "OUTPUT_FILE_ACL_DACL_REJECTED", "acl-verify"],
    ["identity-mismatch", "OUTPUT_FILE_METADATA_REJECTED", "file-identity-recheck"],
  ] as const)("reaches and reports the %s injected failure", (mode, code, stage) => {
    const result = runProbe(mode);
    expectReachedFailure(result, code, stage);
    expect(result.fileSummary.created).toBe(mode !== "native-create-failure");
    expect(result.m8BorrowedSessionStillHeld).toBe(true);
    if (mode === "identity-mismatch") {
      expect(result.outputFileHandleCaptured).toBe(true);
      expect(result.outputFileExpectedBytes).toBeGreaterThan(0);
      expect(result.outputFileSuccessfulWriteBytes).toBe(result.outputFileExpectedBytes);
      expect(result.identityRecheckReached).toBe(true);
      expect(result.fileSummary.bytesWritten).toBe(result.fileSummary.bytesRequested);
    }
  });

  it("keeps a failed close in the owner ledger, then releases only its file HANDLE on retry", () => {
    const result = runProbe("close-failure");
    expect(result.fileSummary.ready).toBe(true);
    expect(result.faultReached).toBe(true);
    expect(result.faultStage).toBe("close");
    expect(result.fileFirstRelease?.ready).toBe(false);
    expect(result.fileFirstRelease?.released).toBe(false);
    expect(result.fileFirstRelease?.releaseStatus).toBe("unconfirmed");
    expect(result.fileFirstRelease?.releaseFailureCode).toBe("OUTPUT_FILE_CLOSE_UNCONFIRMED");
    expect(result.fileFirstRelease?.ownedHandleCount).toBe(1);
    expect(result.fileRelease?.released).toBe(true);
    expect(result.fileRelease?.releaseStatus).toBe("released");
    expect(result.fileRelease?.releaseFailureCode).toBe("OUTPUT_FILE_CLOSE_UNCONFIRMED");
    expect(result.fileRelease?.ownedHandleCount).toBe(0);
    expect(result.m8BorrowedSessionStillHeld).toBe(true);
  }, 150_000);
});
