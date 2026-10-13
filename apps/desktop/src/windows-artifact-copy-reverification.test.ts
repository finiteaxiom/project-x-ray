// M11 pure PowerShell tests use synthetic owner ledgers and a managed-memory reader stub.
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
const modulePath = join(desktop, "scripts/windows-artifact-copy-reverification.ps1");
const fixturePath = join(desktop, "scripts/test-fixtures/windows-artifact-copy-reverification-probe.ps1");
const moduleSource = readFileSync(modulePath, "utf8");
const fixtureSource = readFileSync(fixturePath, "utf8");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

function runPurePowerShell(body: string): string {
  const scripts = [
    "windows-artifact-handle-bridge.ps1",
    "windows-artifact-output-directory.ps1",
    "windows-artifact-output-file.ps1",
    "windows-artifact-private-copy.ps1",
    "windows-artifact-copy-reverification.ps1",
  ];
  const imports = scripts.map((script) => `. '${join(desktop, "scripts", script).replace(/'/g, "''")}'`);
  const script = ["$ErrorActionPreference = 'Stop'", ...imports, body].join("\r\n");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { cwd: desktop, encoding: "utf8", timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (result.error) throw new Error("M11 pure PowerShell regression could not start");
  if (result.status !== 0) throw new Error(`M11 pure PowerShell regression failed: ${(result.stderr ?? "").trim()}`);
  return result.stdout ?? "";
}

const syntheticOwnerSetup = String.raw`
$script:testMode = '__MODE__'
$script:testPosition = 0
$script:testReadCalls = 0
$script:testSeekCalls = 0
$script:testSourceChecks = 0
$script:testDirectoryChecks = 0
$script:testTargetMetadataCalls = 0
$script:testReplacementState = $null
$script:testPayload = [byte[]]::new(__LENGTH__)
for ($i = 0; $i -lt $script:testPayload.Length; $i++) { $script:testPayload[$i] = [byte](($i * 31 + 7) -band 0xff) }
$script:testSha = [Security.Cryptography.SHA256]::Create()
$script:testDigest = ([BitConverter]::ToString($script:testSha.ComputeHash($script:testPayload))).Replace('-', '')
$script:testSha.Dispose()
$script:testTarget = [IntPtr]4321
$script:testSource = [pscustomobject]@{ readStarted = $true }
$script:testSourceSnapshot = [pscustomobject]@{ session = $script:testSource }
$script:testDirectory = [pscustomobject]@{ held = $true }
$script:testDirectoryIdentity = [pscustomobject]@{ handle = [IntPtr]8765; volume = '0000000000000001'; fileId = '00000000000000000000000000000002'; directory = $true }
$script:testMetadata = [pscustomobject]@{
    volume = '0000000000000001'; fileId = '00000000000000000000000000000003'; directory = $false
    attributes = [int]128; length = [long]$script:testPayload.LongLength; allocation = [long]4096
    links = [int]1; creation = [long]101; write = [long]102; change = [long]103
}
$script:testHandles = [Collections.Generic.List[System.IntPtr]]::new()
$script:testHandles.Add($script:testTarget)
$script:testFileState = [pscustomobject]@{
    token = 'm9-private'; status = 'ready'; ready = $true; created = $true; failureCode = $null
    releaseStatus = 'held'; releaseFailureCode = $null; released = $false
    bytesRequested = [long]$script:testPayload.LongLength; bytesWritten = [long]$script:testPayload.LongLength; bytesRead = [long]$script:testPayload.LongLength
    inputSha256 = $script:testDigest; readbackSha256 = $script:testDigest
    identityProof = Get-XRayOutputFileIdentityProof $script:testMetadata
    createdIdentity = $script:testMetadata; directoryIdentity = $script:testDirectoryIdentity
    aclVerified = $true; ownerVerified = $true; daclPresent = $true; daclProtected = $true; aclAceCount = [int]1
    handle = $script:testTarget; handles = $script:testHandles
}
$script:testFileSession = [pscustomobject]@{ version = 1; token = 'file-session' }
$script:testFileEntry = [pscustomobject]@{ session = $script:testFileSession; state = $script:testFileState }
$script:XRayOutputFileOwnedSessions = [Collections.Generic.List[object]]::new()
$script:XRayOutputFileOwnedSessions.Add($script:testFileEntry)
$script:testState = [pscustomobject]@{
    status = 'ready'; ready = $true; created = $true; failureCode = $null
    releaseStatus = 'held'; releaseFailureCode = $null; released = $false
    sourceConsumed = $true; bytesRequested = [long]$script:testPayload.LongLength
    sourceBytesRead = [long]$script:testPayload.LongLength; bytesWritten = [long]$script:testPayload.LongLength; copyBytesRead = [long]$script:testPayload.LongLength
    sourceSha256 = $script:testDigest; copySha256 = $script:testDigest
    sourceIdentityProof = ('A' * 64); outputIdentityProof = $script:testFileState.identityProof; token = 'm10-private'
    sourceSession = $script:testSource; sourceSnapshot = $script:testSourceSnapshot
    directorySession = $script:testDirectory; directoryIdentity = $script:testDirectoryIdentity
    outputFileSession = $script:testFileSession; outputFileEntry = $script:testFileEntry; outputFileState = $script:testFileState
}
$script:testPublic = [pscustomobject]@{ version = 1; token = 'mutated-public-token' }
$script:testOwnerEntry = Register-XRayPrivateCopySession $script:testPublic $script:testState

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    if ($Handle -ne $script:testTarget -or $Directory) { throw 'TEST_UNEXPECTED_METADATA_REQUEST' }
    $script:testTargetMetadataCalls++
    $copy = New-XRayPrivateCopyMetadataSnapshot $script:testMetadata
    if ($script:testMode -ceq 'target-identity-change') { $copy.fileId = '00000000000000000000000000000004' }
    if ($script:testMode -ceq 'target-length-change') { $copy.length = [long]$copy.length + 1 }
    return $copy
}
function Assert-XRayPrivateCopySourceStable($Snapshot, [bool]$Consumed) {
    $script:testSourceChecks++
    if (-not $Consumed -or -not [object]::ReferenceEquals($Snapshot, $script:testSourceSnapshot)) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    if ($script:testMode -ceq 'source-change') { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    return $script:testMetadata
}
function Assert-XRayOutputFileDirectoryStable($DirectorySession, $SavedDirectory) {
    $script:testDirectoryChecks++
    if (-not [object]::ReferenceEquals($DirectorySession, $script:testDirectory) -or
        -not [object]::ReferenceEquals($SavedDirectory, $script:testDirectoryIdentity)) { throw 'OUTPUT_FILE_DIRECTORY_CHANGED' }
    if ($script:testMode -ceq 'directory-change') { throw 'OUTPUT_FILE_DIRECTORY_CHANGED' }
    return $SavedDirectory
}
function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    if ($Name -ceq 'SetFilePointerEx') {
        $script:testSeekCalls++
        if ($script:testMode -ceq 'seek-failure') { return [int]0 }
        $script:testPosition = [int]$Arguments[1]
        return [int]1
    }
    if ($Name -ceq 'ReadFile') {
        $script:testReadCalls++
        if ($script:testMode -ceq 'read-failure' -and $script:testReadCalls -eq 1) { $Arguments[3] = [uint32]0; return [int]0 }
        $requested = [int]$Arguments[2]
        if ($script:testPosition -ge $script:testPayload.Length) {
            if ($script:testMode -ceq 'eof-mismatch') { $Arguments[3] = [uint32]1 } else { $Arguments[3] = [uint32]0 }
            return [int]1
        }
        $actual = $requested
        if ($script:testMode -ceq 'short-read' -and $script:testReadCalls -eq 1 -and $actual -gt 1) { $actual-- }
        if ($script:testMode -ceq 'over-count' -and $script:testReadCalls -eq 1) { $Arguments[3] = [uint32]($requested + 1); return [int]1 }
        [Runtime.InteropServices.Marshal]::Copy($script:testPayload, $script:testPosition, [IntPtr]$Arguments[1], $actual)
        if ($script:testMode -ceq 'hash-mismatch' -and $script:testReadCalls -eq 1 -and $actual -gt 0) {
            $byte = [Runtime.InteropServices.Marshal]::ReadByte([IntPtr]$Arguments[1], 0)
            [Runtime.InteropServices.Marshal]::WriteByte([IntPtr]$Arguments[1], 0, [byte]($byte -bxor 1))
        }
        $script:testPosition += $actual
        $Arguments[3] = [uint32]$actual
        if ($script:testMode -ceq 'owner-change' -and $script:testReadCalls -eq 1) {
            $script:testState.outputFileEntry = [pscustomobject]@{ session = $script:testFileSession; state = $script:testFileState }
        }
        if ($script:testMode -ceq 'm9-state-replacement' -and $script:testReadCalls -eq 1) {
            $script:testReplacementState = [pscustomobject]@{ status = 'ready'; ready = $true; owner = 'replacement' }
            $script:testFileEntry.state = $script:testReplacementState
        }
        return [int]1
    }
    if ($Name -ceq 'CloseHandle') { return [int]1 }
    throw 'TEST_UNEXPECTED_NATIVE_OPERATION'
}
`;

function runScenario(mode: string, length = 1_048_593): string {
  const body = syntheticOwnerSetup.replace("__MODE__", mode).replace("__LENGTH__", String(length)) + String.raw`
$before = Get-XRayPrivateArtifactCopySummary $script:testPublic
$first = Test-XRayPrivateArtifactCopyReverification $script:testPublic
$second = $null
if ($script:testMode -ceq 'repeat') { $second = Test-XRayPrivateArtifactCopyReverification $script:testPublic }
if ($script:testMode -ceq 'owner-change') { $script:testState.outputFileEntry = $script:testFileEntry }
$after = Get-XRayPrivateArtifactCopySummary $script:testPublic
$m9Ready = [bool]$script:testFileState.ready
$release = Close-XRayPrivateArtifactCopy $script:testPublic
$releasedCall = $null
if ($script:testMode -ceq 'released') { $releasedCall = Test-XRayPrivateArtifactCopyReverification $script:testPublic }
$result = [pscustomobject]@{
    first = $first; second = $second; beforeReady = [bool]$before.ready; afterReady = [bool]$after.ready
    afterStatus = [string]$after.status; m9ReadyBeforeClose = $m9Ready; release = $release
    releasedCall = $releasedCall; seekCalls = $script:testSeekCalls; readCalls = $script:testReadCalls
    sourceChecks = $script:testSourceChecks; directoryChecks = $script:testDirectoryChecks
    targetMetadataCalls = $script:testTargetMetadataCalls; sourceReadCalls = 0; sourceSeekCalls = 0
}
ConvertTo-Json -InputObject $result -Compress -Depth 5
`;
  return runPurePowerShell(body);
}

function parseResult(output: string): Record<string, any> {
  const line = output.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error("M11 pure PowerShell regression returned no DTO");
  return JSON.parse(line) as Record<string, any>;
}

describe("M11 private copy re-verification contracts", () => {
  it("accepts only the registered M10 session and returns a finite, redacted DTO", () => {
    expect(moduleSource).toContain("function Test-XRayPrivateArtifactCopyReverification($Session)");
    expect(moduleSource).toContain("Find-XRayPrivateCopySession $Session");
    expect(moduleSource).toContain("Find-XRayOutputFileSession $fileSession");
    expect(moduleSource).toContain("[object]::ReferenceEquals");
    expect(moduleSource).toContain("Assert-XRayPrivateCopySourceStable $owner.sourceSnapshot $true");
    expect(moduleSource).toContain("Assert-XRayOutputFileDirectoryStable $owner.directorySession $owner.directoryIdentity");
    expect(moduleSource).toContain("SetFilePointerEx @($targetHandle, [int64]0");
    expect(moduleSource).toContain("Invoke-XRayOutputFileNative ReadFile");
    expect(moduleSource).toContain("TransformBlock");
    expect(moduleSource).toContain("[long]1048576");
    expect(moduleSource).toContain("snapshotStatus = 'incomplete'");
    expect(moduleSource).toContain("signatureStatus = 'not-evaluated'");
    expect(moduleSource).not.toMatch(/\b(Add-Type|Start-Process|Remove-Item|DeleteFile|MoveFile|GetFullPath|Resolve-Path)\b/);
    expect(moduleSource).not.toMatch(/function Test-XRayPrivateArtifactCopyReverification\([^)]*(Path|Handle|Stream|Hash|Reader|Callback)/i);
    expect(moduleSource).not.toMatch(/return \[pscustomobject\]@\{[^}]*\b(Path|SID|Exception|Handle|Source|Stream)\s*=/is);
    const revokeStart = moduleSource.indexOf("function Revoke-XRayPrivateCopyReverificationOwner(");
    const revokeEnd = moduleSource.indexOf("\nfunction Test-XRayPrivateArtifactCopyReverification(", revokeStart);
    expect(revokeStart).toBeGreaterThanOrEqual(0);
    expect(revokeEnd).toBeGreaterThan(revokeStart);
    expect(moduleSource.slice(revokeStart, revokeEnd)).not.toMatch(/(OwnerEntry|FileEntry)\.state/);
    expect(fixtureSource).toContain("$firstVerification = Test-XRayPrivateArtifactCopyReverification $copySession");
    expect(fixtureSource).toContain("$script:xrayM11CopySession = $copySession");
    expect(fixtureSource).toContain("Find-XRayPrivateCopySession $script:xrayM11CopySession");
    expect(fixtureSource).toContain("$script:xrayM11FaultStage = 'owner-reference-recheck'");
  });

  it("parses the production helper and Windows HANDLE fixture with PowerShell 5.1 without executing the fixture", () => {
    const paths = [modulePath, fixturePath].map((path) => `'${path.replace(/'/g, "''")}'`).join(",");
    const output = runPurePowerShell(String.raw`
$paths = @(${paths})
foreach ($path in $paths) {
    $tokens = $null; $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw 'M11_POWERSHELL_AST_FAILED' }
}
Write-Output 'M11_POWERSHELL_AST_PASS'
`);
    expect(output).toContain("M11_POWERSHELL_AST_PASS");
  }, 40_000);
});

purePowerShellDescribe("M11 pure PowerShell 5.1 managed-memory owner and readback tests", () => {
  it("re-reads a multiblock copy twice through the same exact owner and keeps M10 creation counters stable", () => {
    const result = parseResult(runScenario("repeat", 2_097_169));
    expect(result.beforeReady).toBe(true);
    expect(result.first).toMatchObject({ status: "verified", failureCode: null, bytesRequested: 2_097_169, bytesRead: 2_097_169 });
    expect(result.second).toMatchObject({ status: "verified", failureCode: null, bytesRequested: 2_097_169, bytesRead: 2_097_169 });
    expect(result.first.copySha256).toMatch(/^[A-F0-9]{64}$/);
    expect(result.second.copySha256).toBe(result.first.copySha256);
    expect(result.first.identityProof).toMatch(/^[A-F0-9]{64}$/);
    expect(result.first.snapshotStatus).toBe("incomplete");
    expect(result.first.signatureStatus).toBe("not-evaluated");
    expect(result.afterReady).toBe(true);
    expect(result.m9ReadyBeforeClose).toBe(true);
    expect(result.seekCalls).toBe(2);
    expect(result.readCalls).toBe(8);
    expect(result.sourceChecks).toBe(4);
    expect(result.directoryChecks).toBe(4);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.release).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
  }, 40_000);

  it("verifies an empty copy with the independent empty digest and exact EOF", () => {
    const result = parseResult(runScenario("repeat", 0));
    expect(result.first).toMatchObject({
      status: "verified",
      bytesRequested: 0,
      bytesRead: 0,
      copySha256: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
    });
    expect(result.second).toMatchObject({ status: "verified", bytesRequested: 0, bytesRead: 0 });
    expect(result.seekCalls).toBe(2);
    expect(result.readCalls).toBe(2);
  }, 40_000);

  it("rejects a clone without revoking the real owner, then accepts the real owner", () => {
    const output = runPurePowerShell(syntheticOwnerSetup.replace("__MODE__", "ordinary").replace("__LENGTH__", "17") + String.raw`
$clone = [pscustomobject]@{ version = $script:testPublic.version; token = $script:testPublic.token }
$cloneResult = Test-XRayPrivateArtifactCopyReverification $clone
$ownerReadyAfterClone = [bool]$script:testState.ready
$realResult = Test-XRayPrivateArtifactCopyReverification $script:testPublic
[pscustomobject]@{ clone = $cloneResult; ownerReadyAfterClone = $ownerReadyAfterClone; real = $realResult } | ConvertTo-Json -Compress -Depth 4
`);
    const result = parseResult(output);
    expect(result.clone).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_SESSION_REJECTED", bytesRequested: 0, bytesRead: 0 });
    expect(result.ownerReadyAfterClone).toBe(true);
    expect(result.real).toMatchObject({ status: "verified", bytesRead: 17 });
  }, 40_000);

  it("rejects a mismatched foreign M9 session without revoking either M9 state and preserves M10 close failure", () => {
    const output = runPurePowerShell(syntheticOwnerSetup.replace("__MODE__", "ordinary").replace("__LENGTH__", "17") + String.raw`
$foreignState = [pscustomobject]@{ status = 'ready'; ready = $true }
$foreignSession = [pscustomobject]@{ version = 1; token = 'foreign-session' }
$foreignEntry = [pscustomobject]@{ session = $foreignSession; state = $foreignState }
$script:XRayOutputFileOwnedSessions.Add($foreignEntry)
$script:testState.outputFileSession = $foreignSession
$verification = Test-XRayPrivateArtifactCopyReverification $script:testPublic
$close = Close-XRayPrivateArtifactCopy $script:testPublic
[pscustomobject]@{
    verification = $verification; close = $close; reads = $script:testReadCalls; seeks = $script:testSeekCalls
    m10Ready = [bool]$script:testState.ready; originalM9Ready = [bool]$script:testFileState.ready
    foreignM9Ready = [bool]$foreignState.ready; foreignM9Status = [string]$foreignState.status
} | ConvertTo-Json -Compress -Depth 4
`);
    const result = parseResult(output);
    expect(result.verification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_LEDGER_REJECTED" });
    expect(result.reads).toBe(0);
    expect(result.seeks).toBe(0);
    expect(result.m10Ready).toBe(false);
    expect(result.originalM9Ready).toBe(true);
    expect(result.foreignM9Ready).toBe(true);
    expect(result.foreignM9Status).toBe("ready");
    expect(result.close).toMatchObject({ released: false, releaseStatus: "unconfirmed", ownedHandleCount: 1 });
  }, 40_000);

  it("revokes only the captured M9 state when its live entry state is replaced during verification", () => {
    const output = runPurePowerShell(syntheticOwnerSetup.replace("__MODE__", "m9-state-replacement").replace("__LENGTH__", "17") + String.raw`
$verification = Test-XRayPrivateArtifactCopyReverification $script:testPublic
[pscustomobject]@{
    verification = $verification; m10Ready = [bool]$script:testState.ready
    capturedM9Ready = [bool]$script:testFileState.ready; replacementReady = [bool]$script:testReplacementState.ready
    replacementStillCurrent = [object]::ReferenceEquals($script:testFileEntry.state, $script:testReplacementState)
    reads = $script:testReadCalls; seeks = $script:testSeekCalls
} | ConvertTo-Json -Compress -Depth 4
`);
    const result = parseResult(output);
    expect(result.verification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_LEDGER_REJECTED" });
    expect(result.m10Ready).toBe(false);
    expect(result.capturedM9Ready).toBe(false);
    expect(result.replacementReady).toBe(true);
    expect(result.replacementStillCurrent).toBe(true);
    expect(result.reads).toBe(2);
    expect(result.seeks).toBe(1);
  }, 40_000);

  it("rejects an out-of-range owner size without echoing the unsafe count in the DTO", () => {
    const output = runPurePowerShell(syntheticOwnerSetup.replace("__MODE__", "ordinary").replace("__LENGTH__", "17") + String.raw`
$unsafe = [long]2147483649
$script:testState.bytesRequested = $unsafe; $script:testState.sourceBytesRead = $unsafe
$script:testState.bytesWritten = $unsafe; $script:testState.copyBytesRead = $unsafe
$script:testFileState.bytesRequested = $unsafe; $script:testFileState.bytesWritten = $unsafe; $script:testFileState.bytesRead = $unsafe
$verification = Test-XRayPrivateArtifactCopyReverification $script:testPublic
[pscustomobject]@{ verification = $verification; m10Ready = [bool]$script:testState.ready; m9Ready = [bool]$script:testFileState.ready } | ConvertTo-Json -Compress -Depth 4
`);
    const result = parseResult(output);
    expect(result.verification).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_SIZE_REJECTED", bytesRequested: 0 });
    expect(result.m10Ready).toBe(false);
    expect(result.m9Ready).toBe(false);
  }, 40_000);

  it.each([
    ["read-failure", "COPY_REVERIFY_READ_FAILED"],
    ["short-read", "COPY_REVERIFY_READ_COUNT_REJECTED"],
    ["over-count", "COPY_REVERIFY_READ_COUNT_REJECTED"],
    ["eof-mismatch", "COPY_REVERIFY_EOF_REJECTED"],
    ["seek-failure", "COPY_REVERIFY_SEEK_FAILED"],
    ["hash-mismatch", "COPY_REVERIFY_CONTENT_MISMATCH"],
    ["target-identity-change", "COPY_REVERIFY_TARGET_IDENTITY_REJECTED"],
    ["target-length-change", "COPY_REVERIFY_TARGET_IDENTITY_REJECTED"],
    ["source-change", "COPY_REVERIFY_SOURCE_CHANGED"],
    ["directory-change", "COPY_REVERIFY_DIRECTORY_CHANGED"],
    ["owner-change", "COPY_REVERIFY_LEDGER_REJECTED"],
  ] as const)("permanently revokes the exact M10 and M9 ready owners after %s", (mode, failureCode) => {
    const result = parseResult(runScenario(mode));
    expect(result.beforeReady).toBe(true);
    expect(result.first).toMatchObject({ status: "rejected", failureCode });
    expect(result.afterReady).toBe(false);
    expect(result.afterStatus).toBe("rejected");
    expect(result.m9ReadyBeforeClose).toBe(false);
    expect(result.release).toMatchObject({ released: true, releaseStatus: "released", ownedHandleCount: 0 });
  }, 40_000);

  it("rejects a released owner while preserving its released ledger", () => {
    const result = parseResult(runScenario("released", 17));
    expect(result.first).toMatchObject({ status: "verified", bytesRequested: 17 });
    expect(result.releasedCall).toMatchObject({ status: "rejected", failureCode: "COPY_REVERIFY_SESSION_REJECTED" });
  }, 40_000);
});
