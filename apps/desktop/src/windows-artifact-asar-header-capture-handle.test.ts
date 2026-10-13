// Coordinator-gated Windows tests for real M10/M9 HANDLE capture. Do not run in the developer window.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const repositoryRoot = resolve(desktop, "../..");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const modulePath = join(desktop, "scripts/windows-artifact-asar-header-capture.ps1");
const m12Path = join(desktop, "scripts/windows-artifact-asar-header-preflight.cjs");
const asarPackageRoot = join(
  repositoryRoot,
  "node_modules",
  ".pnpm",
  "@electron+asar@3.4.1",
  "node_modules",
  "@electron",
  "asar",
);
const windowsDescribe = process.platform === "win32" ? describe : describe.skip;
const packetHeaderBytes = 565;
const maxHeaderBytes = 8 * 1024 * 1024;
const nativeChunkBytes = 1024 * 1024;

type Pickle = Readonly<{
  writeUInt32(value: number): boolean;
  writeString(value: string): boolean;
  toBuffer(): Buffer;
}>;

type PickleModule = Readonly<{ Pickle: Readonly<{ createEmpty(): Pickle }> }>;
type OwnedArchiveMaterial = Readonly<{ path: string; length: number; sha256: string }>;
type Entry = Readonly<{ path: string; file: boolean; unpacked: boolean }>;
type Observation = Readonly<{
  observationStatus: "passed" | "failed";
  failureCode: string | null;
  evidence: Readonly<{ source: "caller-bytes"; scope: "header-only" }>;
  claims: Readonly<{
    snapshot: "incomplete";
    signature: "not-evaluated";
    content: "not-evaluated";
    hash: "not-evaluated";
    sourceIdentity: "not-evaluated";
  }>;
  archiveBytes: number | null;
  sizePickleBytes: number | null;
  headerPickleBytes: number | null;
  counts: Readonly<{ entries: number; directories: number; files: number }>;
  entries: readonly Entry[];
}>;
type M12Api = Readonly<{
  observeAsarHeader(sizePickle: Buffer, headerPickle: Buffer, archiveBytes: number): Observation;
}>;

type Scenario =
  | "producer-empty-tree"
  | "producer-unicode"
  | "producer-cross-1mib-header"
  | "producer-eight-mib-header"
  | "producer-header-over-cap"
  | "invalid-size-prefix"
  | "native-read-observation-fault"
  | "owner-recheck-observation-fault"
  | "metadata-observation-fault"
  | "borrowed-source-observation-fault"
  | "directory-observation-fault"
  | "foreign-m9-tuple"
  | "late-m9-state-replacement"
  | "m11-before-observation-fault"
  | "m11-after-observation-fault"
  | "close-retry";

type CapturePacket = {
  status: "verified" | "rejected";
  failureCode: string | null;
  archiveLength: number;
  sizePickleBytesRead: number;
  headerPickleBytesRead: number;
  sizePickle: Buffer;
  headerPickle: Buffer;
  copySha256: string | null;
  identityProof: string | null;
  m10ReadyAfterCapture: boolean;
  m9ReadyAfterCapture: boolean;
  sourceConsumedOnce: boolean;
  sourceCountersStable: boolean;
  sourceStillHeldAfterCopyClose: boolean;
  outputDirectoryStillHeldAfterCopyClose: boolean;
  releaseSucceeded: boolean;
  m9ReleaseProven: boolean;
  sourceReleaseProven: boolean;
  outputDirectoryReleaseProven: boolean;
  applicationReleaseProven: boolean;
  portableReleaseProven: boolean;
  heldRenameBlocked: boolean;
  heldDeleteBlocked: boolean;
  foreignM9ReadyAfterCapture: boolean;
  replacementStillCurrent: boolean;
  replacementReady: boolean;
  firstCloseUnconfirmed: boolean;
  closeRetrySucceeded: boolean;
  captureClaimsBounded: boolean;
  m11Calls: number;
  m13ReadCalls: number;
  sourceReadCalls: number;
  sourceSeekCalls: number;
  faultStage: string | null;
  fixtureStage: string;
  fixtureCurrentStage: string;
  fixtureErrorCategory: string;
  fixtureErrorCode: string;
};

type HandleResult = CapturePacket & { observation: Observation | null; expectedArchiveLength: number };

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function fixedPickleString(value: string, targetHeaderBytes?: number): Buffer {
  const pickle = (require(join(asarPackageRoot, "lib/pickle.js")) as PickleModule).Pickle.createEmpty();
  let text = value;
  if (targetHeaderBytes !== undefined) {
    const targetStringBytes = targetHeaderBytes - 8;
    const currentStringBytes = Buffer.byteLength(text, "utf8");
    if (targetStringBytes < currentStringBytes || targetStringBytes % 4 !== 0) {
      throw new Error("M13 producer header size is invalid");
    }
    text += " ".repeat(targetStringBytes - currentStringBytes);
  }
  if (!pickle.writeString(text)) throw new Error("M13 trusted ASAR pickle producer rejected its fixture text");
  return pickle.toBuffer();
}

function fixedPickleUInt32(value: number): Buffer {
  const pickle = (require(join(asarPackageRoot, "lib/pickle.js")) as PickleModule).Pickle.createEmpty();
  if (!pickle.writeUInt32(value)) throw new Error("M13 trusted ASAR pickle producer rejected its fixture length");
  return pickle.toBuffer();
}

function writePickleArchive(destination: string, headerText: string, targetHeaderBytes?: number, badSizePrefix = false): number {
  const headerPickle = fixedPickleString(headerText, targetHeaderBytes);
  const sizePickle = fixedPickleUInt32(headerPickle.length);
  const packed = Buffer.alloc(0);
  const archive = Buffer.concat([sizePickle, headerPickle, packed]);
  if (badSizePrefix) archive.writeUInt32LE(5, 0);
  writeFileSync(destination, archive);
  return archive.length;
}

function runInstalledAsarProducer(inputRoot: string, sourcePath: string): void {
  const producerScript = [
    '"use strict";',
    "(async () => {",
    "  try {",
    `    const producer = require(${JSON.stringify(asarPackageRoot)});`,
    `    await producer.createPackage(${JSON.stringify(inputRoot)}, ${JSON.stringify(sourcePath)});`,
    "  } catch {",
    "    process.exitCode = 1;",
    "  }",
    "})();",
  ].join("\n");
  const child = spawnSync(process.execPath, ["-e", producerScript], {
    cwd: repositoryRoot,
    stdio: "ignore",
    timeout: 120_000,
    windowsHide: true,
  });
  if (child.error || child.status !== 0 || child.signal !== null) {
    let category = "producer-failed";
    const errorCode = child.error && "code" in child.error ? child.error.code : undefined;
    if (errorCode === "ETIMEDOUT") category = "timeout";
    else if (child.error) category = "spawn-failed";
    else if (child.signal) category = "child-terminated";
    throw new Error(`M13 fixture stage=producer-child category=${category}`);
  }
}

function inspectOwnedArchive(path: string): OwnedArchiveMaterial {
  try {
    const before = statSync(path);
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size <= 0) {
      throw new Error("M13 fixture stage=producer-material category=material-unverified");
    }
    const contents = readFileSync(path);
    const after = statSync(path);
    if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || contents.length !== after.size) {
      throw new Error("M13 fixture stage=producer-material category=material-unverified");
    }
    return { path, length: after.size, sha256: createHash("sha256").update(contents).digest("hex") };
  } catch {
    throw new Error("M13 fixture stage=producer-material category=material-unverified");
  }
}

function verifyOwnedArchiveUnchanged(before: OwnedArchiveMaterial): void {
  const after = inspectOwnedArchive(before.path);
  if (before.length !== after.length || before.sha256 !== after.sha256) {
    throw new Error("M13 fixture stage=source-material-recheck category=material-changed");
  }
}

function createOwnedSourceArchive(root: string, scenario: Scenario): OwnedArchiveMaterial {
  const sourcePath = join(root, "owned-fixture.asar");
  const inputRoot = join(root, "producer-input");
  mkdirSync(inputRoot, { recursive: true });

  const packageInfo = JSON.parse(readFileSync(join(asarPackageRoot, "package.json"), "utf8")) as { version?: string };
  if (packageInfo.version !== "3.4.1") throw new Error("M13 requires the installed @electron/asar 3.4.1 producer");

  if (scenario === "producer-empty-tree" || scenario === "producer-unicode") {
    if (scenario === "producer-unicode") {
      const nested = join(inputRoot, "目录");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, "naïve.txt"), Buffer.from([0x61, 0x62, 0x63]));
    }
    runInstalledAsarProducer(inputRoot, sourcePath);
  } else if (scenario === "producer-cross-1mib-header") {
    const headerText = JSON.stringify({ files: {} });
    writePickleArchive(sourcePath, headerText, 1_048_580);
  } else if (scenario === "producer-eight-mib-header") {
    const headerText = JSON.stringify({ files: {} });
    writePickleArchive(sourcePath, headerText, maxHeaderBytes);
  } else if (scenario === "producer-header-over-cap") {
    const headerText = JSON.stringify({ files: {} });
    writePickleArchive(sourcePath, headerText, maxHeaderBytes + 4);
  } else if (scenario === "invalid-size-prefix") {
    writePickleArchive(sourcePath, JSON.stringify({ files: {} }), undefined, true);
  } else {
    runInstalledAsarProducer(inputRoot, sourcePath);
  }
  return inspectOwnedArchive(sourcePath);
}

function readFixedAscii(buffer: Buffer, offset: number): string | null {
  const value = buffer.toString("ascii", offset, offset + 64).replace(/\0+$/u, "");
  return value.length === 0 ? null : value;
}

function readPacketFlags(flags: number, bit: number): boolean {
  return (flags & bit) !== 0;
}

function parseCapturePacket(stdout: Buffer): CapturePacket {
  if (!Buffer.isBuffer(stdout) || stdout.length < packetHeaderBytes || stdout.toString("ascii", 0, 8) !== "XRAYM13P") {
    throw new Error("M13 HANDLE fixture returned no private capture packet");
  }
  const status = stdout.readUInt8(8);
  if (status !== 0 && status !== 1) throw new Error("M13 HANDLE fixture returned an invalid capture status");
  const archiveBigInt = stdout.readBigUInt64LE(9);
  if (archiveBigInt > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("M13 HANDLE fixture returned an unsafe archive length");
  const archiveLength = Number(archiveBigInt);
  const sizePickleBytesRead = stdout.readUInt32LE(17);
  const headerPickleBytesRead = stdout.readUInt32LE(21);
  const sizeLength = stdout.readUInt32LE(25);
  const headerLength = stdout.readUInt32LE(29);
  const flags = stdout.readUInt32LE(33);
  const m11Calls = stdout.readUInt32LE(37);
  const m13ReadCalls = stdout.readUInt32LE(41);
  const sourceReadCalls = stdout.readUInt32LE(45);
  const sourceSeekCalls = stdout.readUInt32LE(49);
  const copySha256 = readFixedAscii(stdout, 53);
  const identityProof = readFixedAscii(stdout, 117);
  const failureCode = readFixedAscii(stdout, 181);
  const faultStage = readFixedAscii(stdout, 245);
  const fixtureStage = readFixedAscii(stdout, 309);
  const fixtureErrorCategory = readFixedAscii(stdout, 373);
  const fixtureErrorCode = readFixedAscii(stdout, 437);
  const fixtureCurrentStage = readFixedAscii(stdout, 501);
  if (sizeLength > 8 || headerLength > maxHeaderBytes || packetHeaderBytes + sizeLength + headerLength !== stdout.length) {
    throw new Error("M13 HANDLE fixture capture packet exceeded its declared bounds");
  }
  if ((status === 1 && (sizeLength !== 8 || headerLength < 12)) ||
      (status === 0 && (sizeLength !== 0 || headerLength !== 0 || archiveLength !== 0))) {
    throw new Error("M13 HANDLE fixture packet has an inconsistent status and range");
  }
  let offset = packetHeaderBytes;
  const sizePickle = Buffer.from(stdout.subarray(offset, offset + sizeLength));
  offset += sizeLength;
  const headerPickle = Buffer.from(stdout.subarray(offset, offset + headerLength));
  return {
    status: status === 1 ? "verified" : "rejected",
    failureCode,
    archiveLength,
    sizePickleBytesRead,
    headerPickleBytesRead,
    sizePickle,
    headerPickle,
    copySha256,
    identityProof,
    m10ReadyAfterCapture: readPacketFlags(flags, 1),
    m9ReadyAfterCapture: readPacketFlags(flags, 2),
    sourceConsumedOnce: readPacketFlags(flags, 4),
    sourceCountersStable: readPacketFlags(flags, 8),
    sourceStillHeldAfterCopyClose: readPacketFlags(flags, 16),
    outputDirectoryStillHeldAfterCopyClose: readPacketFlags(flags, 32),
    releaseSucceeded: readPacketFlags(flags, 64),
    m9ReleaseProven: readPacketFlags(flags, 65536),
    sourceReleaseProven: readPacketFlags(flags, 131072),
    outputDirectoryReleaseProven: readPacketFlags(flags, 262144),
    applicationReleaseProven: readPacketFlags(flags, 524288),
    portableReleaseProven: readPacketFlags(flags, 1048576),
    heldRenameBlocked: readPacketFlags(flags, 128),
    heldDeleteBlocked: readPacketFlags(flags, 256),
    foreignM9ReadyAfterCapture: readPacketFlags(flags, 1024),
    replacementStillCurrent: readPacketFlags(flags, 2048),
    replacementReady: readPacketFlags(flags, 4096),
    firstCloseUnconfirmed: readPacketFlags(flags, 8192),
    closeRetrySucceeded: readPacketFlags(flags, 16384),
    captureClaimsBounded: readPacketFlags(flags, 32768),
    m11Calls,
    m13ReadCalls,
    sourceReadCalls,
    sourceSeekCalls,
    faultStage,
    fixtureStage: fixtureStage ?? "missing",
    fixtureCurrentStage: fixtureCurrentStage ?? "missing",
    fixtureErrorCategory: fixtureErrorCategory ?? "missing",
    fixtureErrorCode: fixtureErrorCode ?? "missing",
  };
}

function observeCapturedRanges(packet: CapturePacket): Observation | null {
  if (packet.status !== "verified") return null;
  const api = require(m12Path) as M12Api;
  return api.observeAsarHeader(packet.sizePickle, packet.headerPickle, packet.archiveLength);
}

async function runOwnedCapture(scenario: Scenario): Promise<HandleResult> {
  // Keep every generated fixture for review; never path-delete or recursively clean unknown members.
  let root: string;
  try {
    root = mkdtempSync(join(tmpdir(), "xray-m13-asar-capture-"));
  } catch {
    throw new Error("M13 fixture stage=temp-root category=create-failed");
  }
  let source: OwnedArchiveMaterial;
  try {
    source = createOwnedSourceArchive(root, scenario);
  } catch {
    throw new Error("M13 fixture stage=producer category=producer-failed");
  }
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$script:m13Mode = __MODE__
$script:m13SourcePath = __SOURCE__
$script:m13Phase = 'setup'
$script:m13CurrentStage = 'startup'
$script:m13FirstFailureStage = 'none'
$script:m13FixtureErrorCategory = 'none'
$script:m13FixtureErrorCode = 'none'
$script:m13FixtureFailed = $false
$script:m13ReverifyCalls = 0; $script:m13CaptureReadCalls = 0
$script:m13SourceReadCalls = 0; $script:m13SourceSeekCalls = 0; $script:m13SeekCalls = 0
$script:m13FaultMarker = ''; $script:m13FaultUsed = $false; $script:m13CloseFaultUsed = $false
$script:m13CoreOutputNative = $null; $script:m13CoreM4Native = $null; $script:m13CoreReverify = $null
$script:m13CoreMetadata = $null; $script:m13CoreOwnerCheck = $null; $script:m13CoreSourceStable = $null
$script:m13CoreDirectoryStable = $null; $script:m13CoreFindOutputFile = $null
$script:m13TargetHandle = [IntPtr]::Zero; $script:m13SourceHandle = [IntPtr]::Zero
$script:m13OwnerEntry = $null; $script:m13OwnerState = $null; $script:m13FileEntry = $null
$script:m13FileState = $null; $script:m13ForeignSession = $null; $script:m13ForeignState = $null
$script:m13ReplacementState = $null
# Fixture faults affect returned observations or test-owned registry state; no source or target file is mutated concurrently.

. __HANDLE_BRIDGE__
. __DIRECTORY_OBSERVATION__
. __OUTPUT_DIRECTORY__
. __OUTPUT_FILE__
. __PRIVATE_COPY__
. __COPY_REVERIFY__
. __ASAR_CAPTURE__

$script:m13CoreOutputNative = (Get-Command Invoke-XRayOutputFileNative -CommandType Function).ScriptBlock
$script:m13CoreM4Native = (Get-Command Invoke-XRayNative -CommandType Function).ScriptBlock
$script:m13CoreReverify = (Get-Command Test-XRayPrivateArtifactCopyReverification -CommandType Function).ScriptBlock
$script:m13CoreMetadata = (Get-Command Get-XRayHandleMetadata -CommandType Function).ScriptBlock
$script:m13CoreOwnerCheck = (Get-Command Assert-XRayPrivateCopyReverificationOwner -CommandType Function).ScriptBlock
$script:m13CoreSourceStable = (Get-Command Assert-XRayPrivateCopySourceStable -CommandType Function).ScriptBlock
$script:m13CoreDirectoryStable = (Get-Command Assert-XRayOutputFileDirectoryStable -CommandType Function).ScriptBlock
$script:m13CoreFindOutputFile = (Get-Command Find-XRayOutputFileSession -CommandType Function).ScriptBlock

function New-XRayOutputFileToken { return '0123456789abcdef0123456789abcdef' }

function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
    if ($script:m13Phase -ceq 'm13' -and $Arguments.Count -gt 0 -and [IntPtr]$Arguments[0] -eq $script:m13SourceHandle) {
        if ($Name -ceq 'ReadFile') { $script:m13SourceReadCalls++ }
        if ($Name -ceq 'SetFilePointerEx') { $script:m13SourceSeekCalls++ }
    }
    return (& $script:m13CoreM4Native $Name $Arguments)
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    if ($script:m13Phase -ceq 'm13' -and $Name -ceq 'SetFilePointerEx' -and
        [IntPtr]$Arguments[0] -eq $script:m13TargetHandle) { $script:m13SeekCalls++ }
    if ($script:m13Phase -ceq 'm13' -and $Name -ceq 'ReadFile' -and
        [IntPtr]$Arguments[0] -eq $script:m13TargetHandle) {
        $script:m13CaptureReadCalls++
        if ($script:m13Mode -ceq 'native-read-observation-fault' -and -not $script:m13FaultUsed) {
            $script:m13FaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:target-read'
            $Arguments[3] = [uint32]0; return [int]0
        }
        $result = [int](& $script:m13CoreOutputNative $Name $Arguments)
        if ($script:m13CaptureReadCalls -eq 1 -and $script:m13FaultMarker -ceq '') {
            $script:m13FaultMarker = 'm13-first-prefix-read'
        }
        if ($script:m13Mode -ceq 'late-m9-state-replacement' -and $script:m13CaptureReadCalls -eq 1) {
            $script:m13ReplacementState = [pscustomobject]@{ status = 'ready'; ready = $true; owner = 'fixture-replacement' }
            $script:m13FileEntry.state = $script:m13ReplacementState
            $script:m13FaultMarker = 'fixture-state:m9-replacement'
        }
        return $result
    }
    if ($script:m13Phase -ceq 'close' -and $Name -ceq 'CloseHandle' -and
        $script:m13Mode -ceq 'close-retry' -and -not $script:m13CloseFaultUsed) {
        $script:m13CloseFaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:m10-close-unconfirmed'
        return [int]0
    }
    return (& $script:m13CoreOutputNative $Name $Arguments)
}

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    $metadata = & $script:m13CoreMetadata $Handle $Directory
    if ($script:m13Phase -ceq 'm13' -and $script:m13Mode -ceq 'metadata-observation-fault' -and
        $Handle -eq $script:m13TargetHandle -and -not $Directory -and -not $script:m13FaultUsed) {
        $script:m13FaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:target-metadata'
        $metadata.write = [long]$metadata.write + 1
    }
    return $metadata
}

function Assert-XRayPrivateCopyReverificationOwner($Owner) {
    if ($script:m13Phase -ceq 'm13' -and $script:m13Mode -ceq 'owner-recheck-observation-fault' -and -not $script:m13FaultUsed) {
        $script:m13FaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:owner-recheck'
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
    & $script:m13CoreOwnerCheck $Owner
}

function Assert-XRayPrivateCopySourceStable($Snapshot, [bool]$Consumed) {
    $result = & $script:m13CoreSourceStable $Snapshot $Consumed
    if ($script:m13Phase -ceq 'm13' -and $script:m13Mode -ceq 'borrowed-source-observation-fault' -and
        $script:m13CaptureReadCalls -ge 1 -and -not $script:m13FaultUsed) {
        $script:m13FaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:source-stability'
        throw 'PRIVATE_COPY_SOURCE_CHANGED'
    }
    return $result
}

function Assert-XRayOutputFileDirectoryStable($DirectorySession, $SavedDirectory) {
    $result = & $script:m13CoreDirectoryStable $DirectorySession $SavedDirectory
    if ($script:m13Phase -ceq 'm13' -and $script:m13Mode -ceq 'directory-observation-fault' -and -not $script:m13FaultUsed) {
        $script:m13FaultUsed = $true; $script:m13FaultMarker = 'fixture-observation:directory-stability'
        throw 'OUTPUT_FILE_DIRECTORY_CHANGED'
    }
    return $result
}

function Find-XRayOutputFileSession($Session) {
    $entry = & $script:m13CoreFindOutputFile $Session
    if ($script:m13Phase -ceq 'm13' -and $script:m13Mode -ceq 'foreign-m9-tuple' -and
        [object]::ReferenceEquals($Session, $script:m13ForeignSession)) {
        $script:m13FaultMarker = 'fixture-state:foreign-m9-pair'
    }
    return $entry
}

function Test-XRayPrivateArtifactCopyReverification($Session) {
    $script:m13ReverifyCalls++
    $script:m13Phase = if ($script:m13ReverifyCalls -eq 1) { 'm11-before' } else { 'm11-after' }
    $result = & $script:m13CoreReverify $Session
    if (($script:m13Mode -ceq 'm11-before-observation-fault' -and $script:m13ReverifyCalls -eq 1) -or
        ($script:m13Mode -ceq 'm11-after-observation-fault' -and $script:m13ReverifyCalls -eq 2)) {
        $result.status = 'rejected'; $result.failureCode = 'COPY_REVERIFY_CONTENT_MISMATCH'
        $script:m13FaultMarker = if ($script:m13ReverifyCalls -eq 1) { 'fixture-observation:m11-before' } else { 'fixture-observation:m11-after' }
        $script:m13FaultUsed = $true
    }
    $script:m13Phase = 'm13'
    return ,$result
}

function Get-M13FixedAsciiField([string]$Value) {
    $field = [byte[]]::new(64)
    if (-not [string]::IsNullOrEmpty($Value)) {
        $bytes = [Text.Encoding]::ASCII.GetBytes($Value)
        if ($bytes.Length -gt $field.Length) { throw 'M13_PACKET_FIELD_REJECTED' }
        [Array]::Copy($bytes, 0, $field, 0, $bytes.Length)
    }
    return ,$field
}

function Get-M13FixtureErrorCategory($ErrorRecord) {
    $typeName = ''
    try { $typeName = [string]$ErrorRecord.Exception.GetType().FullName } catch { }
    switch -Exact ($typeName) {
        'System.ArgumentException' { return 'argument' }
        'System.IO.IOException' { return 'io' }
        'System.UnauthorizedAccessException' { return 'access-denied' }
        'System.InvalidOperationException' { return 'invalid-operation' }
        'System.Management.Automation.MethodInvocationException' { return 'method-invocation' }
        'System.Management.Automation.RuntimeException' { return 'powershell-runtime' }
        'System.ComponentModel.Win32Exception' { return 'native-call' }
        default { return 'other' }
    }
}

function Get-M13FixtureErrorCode($ErrorRecord) {
    $message = ''
    try { $message = [string]$ErrorRecord.Exception.Message } catch { }
    $knownCodes = @(
        'ACL_QUERY_FAILED', 'ASAR_HEADER_CAPTURE_BUFFER_FAILED', 'ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED',
        'ASAR_HEADER_CAPTURE_FAILED', 'ASAR_HEADER_CAPTURE_HEADER_BOUNDS_REJECTED',
        'ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED', 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED',
        'ASAR_HEADER_CAPTURE_NOT_READY', 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED',
        'ASAR_HEADER_CAPTURE_READ_FAILED', 'ASAR_HEADER_CAPTURE_REVERIFY_REJECTED',
        'ASAR_HEADER_CAPTURE_SEEK_FAILED', 'ASAR_HEADER_CAPTURE_SESSION_REJECTED',
        'ASAR_HEADER_CAPTURE_SIZE_PICKLE_REJECTED', 'ASAR_HEADER_CAPTURE_SOURCE_CHANGED',
        'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED', 'BUFFER_FAILED', 'COPY_REVERIFY_BUFFER_FAILED',
        'COPY_REVERIFY_CONTENT_MISMATCH', 'COPY_REVERIFY_DIRECTORY_CHANGED', 'COPY_REVERIFY_EOF_REJECTED',
        'COPY_REVERIFY_FAILED', 'COPY_REVERIFY_HASH_REJECTED', 'COPY_REVERIFY_LEDGER_REJECTED',
        'COPY_REVERIFY_NOT_READY', 'COPY_REVERIFY_READ_COUNT_REJECTED', 'COPY_REVERIFY_READ_FAILED',
        'COPY_REVERIFY_SEEK_FAILED', 'COPY_REVERIFY_SESSION_REJECTED', 'COPY_REVERIFY_SIZE_REJECTED',
        'COPY_REVERIFY_SOURCE_CHANGED', 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED', 'CREATE_RESULT_INVALID',
        'DIRECTORY_BINDING_FAILED', 'DIRECTORY_CHANGED', 'DIRECTORY_COLLISION', 'DIRECTORY_ID_REJECTED',
        'DIRECTORY_LIMIT', 'DIRECTORY_OBSERVATION_FAILED', 'DIRECTORY_PAGE_INVALID', 'DIRECTORY_QUERY_FAILED',
        'DIRECTORY_TYPE_REJECTED', 'FILE_CHANGED', 'HANDLE_CLOSE_UNCONFIRMED', 'IDENTITY_UNAVAILABLE',
        'INPUT_SESSION_INVALID', 'METADATA_UNAVAILABLE', 'NATIVE_BINDING_FAILED', 'NATIVE_CALL_FAILED',
        'NATIVE_CALL_REJECTED', 'NOT_DISK', 'OPEN_REJECTED', 'OUTPUT_ACL_ACE_COUNT_REJECTED',
        'OUTPUT_ACL_ACE_REJECTED', 'OUTPUT_ACL_CONTROL_REJECTED', 'OUTPUT_ACL_DACL_REJECTED',
        'OUTPUT_ACL_DESCRIPTOR_INVALID', 'OUTPUT_ACL_OWNER_REJECTED', 'OUTPUT_ACL_REJECTED',
        'OUTPUT_BUFFER_FAILED', 'OUTPUT_BUFFER_REJECTED', 'OUTPUT_FILE_ACL_ACE_COUNT_REJECTED',
        'OUTPUT_FILE_ACL_ACE_REJECTED', 'OUTPUT_FILE_ACL_CONTROL_REJECTED', 'OUTPUT_FILE_ACL_DACL_REJECTED',
        'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID', 'OUTPUT_FILE_ACL_OWNER_REJECTED', 'OUTPUT_FILE_ACL_QUERY_FAILED',
        'OUTPUT_FILE_ACL_REJECTED', 'OUTPUT_FILE_BUFFER_FAILED', 'OUTPUT_FILE_BUFFER_REJECTED',
        'OUTPUT_FILE_CLOSE_UNCONFIRMED', 'OUTPUT_FILE_CONTENT_MISMATCH', 'OUTPUT_FILE_CREATE_REJECTED',
        'OUTPUT_FILE_CREATE_RESULT_REJECTED', 'OUTPUT_FILE_DIRECTORY_CHANGED', 'OUTPUT_FILE_DIRECTORY_REJECTED',
        'OUTPUT_FILE_EOF_REJECTED', 'OUTPUT_FILE_IDENTITY_UNAVAILABLE', 'OUTPUT_FILE_INPUT_REJECTED',
        'OUTPUT_FILE_LIMIT_REJECTED', 'OUTPUT_FILE_METADATA_REJECTED', 'OUTPUT_FILE_NATIVE_BINDING_FAILED',
        'OUTPUT_FILE_NATIVE_CALL_FAILED', 'OUTPUT_FILE_NATIVE_CALL_REJECTED', 'OUTPUT_FILE_POINTER_RESET_FAILED',
        'OUTPUT_FILE_READ_COUNT_REJECTED', 'OUTPUT_FILE_READ_FAILED', 'OUTPUT_FILE_RUNTIME_UNSUPPORTED',
        'OUTPUT_FILE_SESSION_INVALID', 'OUTPUT_FILE_TOKEN_REJECTED', 'OUTPUT_FILE_WRITE_COUNT_REJECTED',
        'OUTPUT_FILE_WRITE_FAILED', 'OUTPUT_HANDLE_INVALID', 'OUTPUT_IDENTITY_REJECTED',
        'OUTPUT_IDENTITY_UNAVAILABLE', 'OUTPUT_NATIVE_BINDING_FAILED', 'OUTPUT_NATIVE_CALL_FAILED',
        'OUTPUT_NATIVE_CALL_REJECTED', 'OUTPUT_OVERLAP', 'OUTPUT_PATH_REJECTED', 'OUTPUT_SESSION_INVALID',
        'OUTPUT_VOLUME_REJECTED', 'PARENT_CHAIN_INVALID', 'PARENT_OPEN_REJECTED', 'PARENT_WALKER_UNAVAILABLE',
        'PATH_REJECTED', 'PRIVATE_COPY_BUFFER_FAILED', 'PRIVATE_COPY_CLOSE_UNCONFIRMED',
        'PRIVATE_COPY_CONTENT_MISMATCH', 'PRIVATE_COPY_EOF_REJECTED', 'PRIVATE_COPY_LIMIT_REJECTED',
        'PRIVATE_COPY_OUTPUT_REJECTED', 'PRIVATE_COPY_READ_COUNT_REJECTED', 'PRIVATE_COPY_READ_FAILED',
        'PRIVATE_COPY_SESSION_INVALID', 'PRIVATE_COPY_SIZE_REJECTED', 'PRIVATE_COPY_SOURCE_CHANGED',
        'PRIVATE_COPY_SOURCE_EOF_REJECTED', 'PRIVATE_COPY_SOURCE_READ_FAILED', 'PRIVATE_COPY_SOURCE_REJECTED',
        'PRIVATE_COPY_SOURCE_SHORT_READ', 'PRIVATE_COPY_TARGET_CHANGED', 'PRIVATE_COPY_WRITE_COUNT_REJECTED',
        'PRIVATE_COPY_WRITE_FAILED', 'READ_FAILED', 'REPARSE_REJECTED', 'RUNTIME_UNSUPPORTED',
        'SESSION_INVALID', 'SHORT_READ', 'SIZE_LIMIT', 'SIZE_OR_LENGTH_CHANGED', 'TARGET_CREATE_REJECTED',
        'TYPE_REJECTED', 'VOLUME_REJECTED', 'M13_FIXTURE_DIRECTORY_FAILED', 'M13_FIXTURE_COPY_FAILED',
        'M13_FIXTURE_TARGET_HANDLE_FAILED', 'M13_PACKET_FIELD_REJECTED'
    )
    if ($knownCodes -ccontains $message) { return $message }
    return 'unknown'
}

function Set-M13FixtureFailure([string]$Stage, [string]$Category, [string]$Code) {
    $script:m13FixtureFailed = $true
    if ($script:m13FixtureErrorCategory -ceq 'none') {
        $script:m13FirstFailureStage = $Stage
        $script:m13FixtureErrorCategory = $Category
        $script:m13FixtureErrorCode = $Code
    }
}

$portableSession = $null; $applicationSession = $null; $directorySession = $null; $sourceSession = $null; $copySession = $null
$capture = $null; $before = $null; $after = $null; $release = $null; $retry = $null
$ownerReadyAfterCapture = $false; $m9ReadyAfterCapture = $false; $foreignReadyAfterCapture = $false
$replacementStillCurrent = $false; $replacementReady = $false; $sourceStillHeld = $false; $directoryStillHeld = $false
$heldRenameBlocked = $false; $heldDeleteBlocked = $false
$firstCloseUnconfirmed = $false; $closeRetrySucceeded = $false; $sourceConsumedOnce = $false; $sourceCountersStable = $false
$releaseSucceeded = $false; $m9ReleaseProven = $false; $sourceReleaseProven = $false
$directoryReleaseProven = $false; $applicationReleaseProven = $false; $portableReleaseProven = $false
$root = __ROOT__
$sourcePath = $script:m13SourcePath
$portablePath = Join-Path $root 'portable.bin'
$applicationPath = Join-Path $root 'application'
$outputParent = Join-Path $root 'output-parent'
$outputPath = Join-Path $outputParent 'private'
$component = 'xray-0123456789abcdef0123456789abcdef.sidecar'
$targetPath = Join-Path $outputPath $component
$savedFileSession = $null; $savedFileEntry = $null; $savedFileState = $null
$foreignEntry = $null

try {
    $script:m13CurrentStage = 'create-fixture-paths'
    [IO.Directory]::CreateDirectory($applicationPath) | Out-Null
    [IO.Directory]::CreateDirectory($outputParent) | Out-Null
    [IO.File]::WriteAllBytes($portablePath, [byte[]]@(0x58, 0x52, 0x41, 0x59, 0x01))
    $script:m13CurrentStage = 'open-portable-session'
    $portableSession = Open-XRayArtifactSession $portablePath
    $script:m13CurrentStage = 'open-application-directory'
    $applicationSession = Open-XRayArtifactDirectorySession $applicationPath
    $script:m13CurrentStage = 'create-private-output-directory'
    $directorySession = New-XRayPrivateArtifactOutputDirectory $outputPath $portableSession $applicationSession
    if (-not $directorySession.ready) { throw 'M13_FIXTURE_DIRECTORY_FAILED' }
    $script:m13CurrentStage = 'open-source-session'
    $sourceSession = Open-XRayArtifactSession $sourcePath
    $script:m13SourceHandle = [IntPtr]$sourceSession.leaf
    $script:m13CurrentStage = 'create-m10-copy'
    $copySession = New-XRayPrivateArtifactCopy $sourceSession $directorySession
    $script:m13CurrentStage = 'snapshot-copy-before'
    $before = Get-XRayPrivateArtifactCopySummary $copySession
    if (-not $before.ready -or -not $before.created -or $before.bytesRequested -le 0) { throw 'M13_FIXTURE_COPY_FAILED' }
    $script:m13CurrentStage = 'capture-m10-m9-owner-tuple'
    $script:m13OwnerEntry = Find-XRayPrivateCopySession $copySession
    $script:m13OwnerState = $script:m13OwnerEntry.state
    $savedFileSession = $script:m13OwnerState.outputFileSession
    $savedFileEntry = $script:m13OwnerState.outputFileEntry
    $savedFileState = $script:m13OwnerState.outputFileState
    $script:m13FileEntry = $savedFileEntry
    $script:m13FileState = $savedFileState
    $script:m13TargetHandle = [IntPtr]$savedFileState.handle
    if ($script:m13TargetHandle -eq [IntPtr]::Zero -or $script:m13TargetHandle -eq [IntPtr](-1)) { throw 'M13_FIXTURE_TARGET_HANDLE_FAILED' }

    if ($script:m13Mode -ceq 'foreign-m9-tuple') {
        $script:m13CurrentStage = 'install-test-owned-foreign-m9-tuple'
        $script:m13ForeignState = [pscustomobject]@{ status = 'ready'; ready = $true }
        $script:m13ForeignSession = [pscustomobject]@{ version = 1; token = 'fixture-foreign-session' }
        $foreignEntry = [pscustomobject]@{ session = $script:m13ForeignSession; state = $script:m13ForeignState }
        $script:XRayOutputFileOwnedSessions.Add($foreignEntry)
        $script:m13OwnerState.outputFileSession = $script:m13ForeignSession
    }

    $script:m13Phase = 'm13'
    $script:m13CurrentStage = 'invoke-m13-capture'
    $capture = Get-XRayPrivateArtifactAsarHeaderCapture $copySession
    $script:m13CurrentStage = 'snapshot-copy-after-capture'
    $ownerReadyAfterCapture = [bool]$script:m13OwnerState.ready
    $m9ReadyAfterCapture = [bool]$savedFileState.ready
    $foreignReadyAfterCapture = ($null -ne $script:m13ForeignState -and [bool]$script:m13ForeignState.ready)
    $replacementStillCurrent = ($null -ne $script:m13ReplacementState -and
        [object]::ReferenceEquals($savedFileEntry.state, $script:m13ReplacementState))
    $replacementReady = ($null -ne $script:m13ReplacementState -and [bool]$script:m13ReplacementState.ready)
    $after = Get-XRayPrivateArtifactCopySummary $copySession
    $sourceConsumedOnce = ([bool]$before.sourceConsumed -and $before.sourceBytesRead -eq $before.bytesRequested -and
        $after.sourceBytesRead -eq $before.sourceBytesRead)
    $sourceCountersStable = ($before.bytesRequested -eq $after.bytesRequested -and
        $before.sourceBytesRead -eq $after.sourceBytesRead -and $before.bytesWritten -eq $after.bytesWritten -and
        $before.copyBytesRead -eq $after.copyBytesRead)

    if ($capture.status -ceq 'verified') {
        $script:m13CurrentStage = 'held-rename-probe'
        $heldRenameBlocked = $false
        $movedPath = $targetPath + '.m13-moved'
        try { [IO.File]::Move($targetPath, $movedPath) } catch { $heldRenameBlocked = $true }
        $script:m13CurrentStage = 'held-delete-probe'
        $heldDeleteBlocked = $false
        if ([IO.File]::Exists($targetPath)) {
            try { [IO.File]::Delete($targetPath) } catch { $heldDeleteBlocked = $true }
            if ([IO.File]::Exists($targetPath)) { $heldDeleteBlocked = $true }
        }
    }

    $script:m13CurrentStage = 'restore-test-owned-m9-tuple'
    # Restore only the test-owned registry tuple so the original M10 close can release its own M9 HANDLE.
    $script:m13OwnerState.outputFileSession = $savedFileSession
    $script:m13OwnerState.outputFileEntry = $savedFileEntry
    $script:m13OwnerState.outputFileState = $savedFileState
    $savedFileEntry.state = $savedFileState

    $script:m13Phase = 'close'
    $script:m13CurrentStage = 'close-m10-copy'
    $release = Close-XRayPrivateArtifactCopy $copySession
    $firstCloseUnconfirmed = (-not $release.released -and $release.releaseStatus -ceq 'unconfirmed')
    if (-not $release.released) {
        $script:m13CurrentStage = 'retry-m10-copy-close'
        $retry = Close-XRayPrivateArtifactCopy $copySession
        $closeRetrySucceeded = [bool]$retry.released
        if ($retry.released) { $release = $retry }
    }
    $script:m13CurrentStage = 'verify-source-and-directory-remain-held'
    $sourceStillHeld = ($null -ne $sourceSession -and -not $sourceSession.released -and
        $sourceSession.handles.Count -gt 0 -and [IntPtr]$sourceSession.handles[$sourceSession.handles.Count - 1] -eq $sourceSession.leaf)
    $directoryStillHeld = ($null -ne $directorySession -and $directorySession.ready -and -not $directorySession.released -and
        $directorySession.handles.Count -eq $directorySession.registeredHandleCount -and $directorySession.createdHandle -ne [IntPtr]::Zero)
} catch {
    Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_)
} finally {
    $script:m13Phase = 'cleanup'
    $script:m13CurrentStage = 'restore-test-owned-m9-tuple-for-release'
    try {
        if ($null -ne $script:m13OwnerState -and $null -ne $savedFileSession -and $null -ne $savedFileEntry -and $null -ne $savedFileState) {
            $script:m13OwnerState.outputFileSession = $savedFileSession
            $script:m13OwnerState.outputFileEntry = $savedFileEntry
            $script:m13OwnerState.outputFileState = $savedFileState
            $savedFileEntry.state = $savedFileState
        }
        if ($null -ne $foreignEntry -and $null -ne $script:XRayOutputFileOwnedSessions) {
            $script:XRayOutputFileOwnedSessions.Remove($foreignEntry) | Out-Null
        }
    } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    if ($null -ne $copySession -and ($null -eq $release -or -not $release.released)) {
        $script:m13CurrentStage = 'release-m10-copy'
        try { $release = Close-XRayPrivateArtifactCopy $copySession }
        catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if ($null -ne $copySession) {
        $script:m13CurrentStage = 'prove-m10-m9-release'
        try {
            $copyAfterClose = Get-XRayPrivateArtifactCopySummary $copySession
            $releaseSucceeded = ($copyAfterClose.released -eq $true -and $copyAfterClose.releaseStatus -ceq 'released' -and $copyAfterClose.ownedHandleCount -eq 0)
            $m9ReleaseProven = ($null -ne $savedFileState -and $savedFileState.released -eq $true -and
                $savedFileState.releaseStatus -ceq 'released' -and $savedFileState.handles.Count -eq 0 -and
                [IntPtr]$savedFileState.handle -eq [IntPtr]::Zero)
            if (-not $releaseSucceeded -or -not $m9ReleaseProven) { Set-M13FixtureFailure $script:m13CurrentStage 'release-unconfirmed' 'release-unconfirmed' }
        } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if ($null -ne $sourceSession) {
        $script:m13CurrentStage = 'release-m4-source'
        try {
            Close-XRayArtifactSession $sourceSession
            $sourceReleaseProven = ($sourceSession.released -eq $true -and $sourceSession.handles.Count -eq 0)
            if (-not $sourceReleaseProven) { Set-M13FixtureFailure $script:m13CurrentStage 'release-unconfirmed' 'release-unconfirmed' }
        } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if ($null -ne $directorySession) {
        $script:m13CurrentStage = 'release-m8-output-directory'
        try {
            $directoryRelease = Close-XRayPrivateArtifactOutputDirectory $directorySession
            $directoryReleaseProven = ($directoryRelease.released -eq $true -and $directoryRelease.releaseStatus -ceq 'released' -and
                $directoryRelease.remainingHandleCount -eq 0 -and $directorySession.handles.Count -eq 0 -and
                $directorySession.createdHandle -eq [IntPtr]::Zero)
            if (-not $directoryReleaseProven) { Set-M13FixtureFailure $script:m13CurrentStage 'release-unconfirmed' 'release-unconfirmed' }
        } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if ($null -ne $applicationSession) {
        $script:m13CurrentStage = 'release-application-directory'
        try {
            Close-XRayArtifactSession $applicationSession
            $applicationReleaseProven = ($applicationSession.released -eq $true -and $applicationSession.handles.Count -eq 0)
            if (-not $applicationReleaseProven) { Set-M13FixtureFailure $script:m13CurrentStage 'release-unconfirmed' 'release-unconfirmed' }
        } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if ($null -ne $portableSession) {
        $script:m13CurrentStage = 'release-portable-input'
        try {
            Close-XRayArtifactSession $portableSession
            $portableReleaseProven = ($portableSession.released -eq $true -and $portableSession.handles.Count -eq 0)
            if (-not $portableReleaseProven) { Set-M13FixtureFailure $script:m13CurrentStage 'release-unconfirmed' 'release-unconfirmed' }
        } catch { Set-M13FixtureFailure $script:m13CurrentStage (Get-M13FixtureErrorCategory $_) (Get-M13FixtureErrorCode $_) }
    }
    if (-not $script:m13FixtureFailed) { $script:m13CurrentStage = 'complete' }
}

$statusByte = [byte]0; $archiveBytes = [long]0; $sizeRead = [uint32]0; $headerRead = [uint32]0
$sizeRange = [byte[]]::new(0); $headerRange = [byte[]]::new(0); $digest = ''; $identityProof = ''; $failureCode = 'M13_FIXTURE_OPERATION_FAILED'
if (-not $script:m13FixtureFailed -and $null -ne $capture) {
    $failureCode = [string]$capture.failureCode
    if ($capture.status -ceq 'verified') {
        $statusByte = [byte]1; $archiveBytes = [long]$capture.archiveLength
        $sizeRead = [uint32]$capture.sizePickleBytesRead; $headerRead = [uint32]$capture.headerPickleBytesRead
        $sizeRange = [byte[]]$capture.sizePickle; $headerRange = [byte[]]$capture.headerPickle
        $digest = [string]$capture.copySha256; $identityProof = [string]$capture.identityProof
        $failureCode = ''
    }
}
if ($script:m13FixtureFailed -and $null -ne $capture) {
    if ($null -ne $capture.sizePickle) { [Array]::Clear($capture.sizePickle, 0, $capture.sizePickle.Length) }
    if ($null -ne $capture.headerPickle) { [Array]::Clear($capture.headerPickle, 0, $capture.headerPickle.Length) }
}
$flags = [uint32]0
if ($ownerReadyAfterCapture) { $flags = $flags -bor [uint32]1 }
if ($m9ReadyAfterCapture) { $flags = $flags -bor [uint32]2 }
if ($sourceConsumedOnce) { $flags = $flags -bor [uint32]4 }
if ($sourceCountersStable) { $flags = $flags -bor [uint32]8 }
if ($sourceStillHeld) { $flags = $flags -bor [uint32]16 }
if ($directoryStillHeld) { $flags = $flags -bor [uint32]32 }
if ($releaseSucceeded) { $flags = $flags -bor [uint32]64 }
if ($m9ReleaseProven) { $flags = $flags -bor [uint32]65536 }
if ($sourceReleaseProven) { $flags = $flags -bor [uint32]131072 }
if ($directoryReleaseProven) { $flags = $flags -bor [uint32]262144 }
if ($applicationReleaseProven) { $flags = $flags -bor [uint32]524288 }
if ($portableReleaseProven) { $flags = $flags -bor [uint32]1048576 }
if ($heldRenameBlocked) { $flags = $flags -bor [uint32]128 }
if ($heldDeleteBlocked) { $flags = $flags -bor [uint32]256 }
if ($foreignReadyAfterCapture) { $flags = $flags -bor [uint32]1024 }
if ($replacementStillCurrent) { $flags = $flags -bor [uint32]2048 }
if ($replacementReady) { $flags = $flags -bor [uint32]4096 }
if ($firstCloseUnconfirmed) { $flags = $flags -bor [uint32]8192 }
if ($closeRetrySucceeded) { $flags = $flags -bor [uint32]16384 }
if ($null -ne $capture -and $capture.snapshotStatus -ceq 'incomplete' -and $capture.signatureStatus -ceq 'not-evaluated') { $flags = $flags -bor [uint32]32768 }
$stream = [Console]::OpenStandardOutput()
$writer = [IO.BinaryWriter]::new($stream, [Text.Encoding]::ASCII, $true)
$writer.Write([Text.Encoding]::ASCII.GetBytes('XRAYM13P'))
$writer.Write($statusByte); $writer.Write([long]$archiveBytes); $writer.Write([uint32]$sizeRead); $writer.Write([uint32]$headerRead)
$writer.Write([uint32]$sizeRange.Length); $writer.Write([uint32]$headerRange.Length); $writer.Write([uint32]$flags)
$writer.Write([uint32]$script:m13ReverifyCalls); $writer.Write([uint32]$script:m13CaptureReadCalls)
$writer.Write([uint32]$script:m13SourceReadCalls); $writer.Write([uint32]$script:m13SourceSeekCalls)
$writer.Write((Get-M13FixedAsciiField $digest)); $writer.Write((Get-M13FixedAsciiField $identityProof))
$writer.Write((Get-M13FixedAsciiField $failureCode)); $writer.Write((Get-M13FixedAsciiField $script:m13FaultMarker))
$writer.Write((Get-M13FixedAsciiField $script:m13FirstFailureStage)); $writer.Write((Get-M13FixedAsciiField $script:m13FixtureErrorCategory))
$writer.Write((Get-M13FixedAsciiField $script:m13FixtureErrorCode)); $writer.Write((Get-M13FixedAsciiField $script:m13CurrentStage))
$writer.Write([byte[]]$sizeRange); $writer.Write([byte[]]$headerRange); $writer.Flush()
`;
  const powershellScript = script
    .replace("__ROOT__", quotePowerShell(root))
    .replace("__SOURCE__", quotePowerShell(source.path))
    .replace("__MODE__", quotePowerShell(scenario))
    .replace("__HANDLE_BRIDGE__", quotePowerShell(join(desktop, "scripts/windows-artifact-handle-bridge.ps1")))
    .replace("__DIRECTORY_OBSERVATION__", quotePowerShell(join(desktop, "scripts/windows-artifact-directory-observation.ps1")))
    .replace("__OUTPUT_DIRECTORY__", quotePowerShell(join(desktop, "scripts/windows-artifact-output-directory.ps1")))
    .replace("__OUTPUT_FILE__", quotePowerShell(join(desktop, "scripts/windows-artifact-output-file.ps1")))
    .replace("__PRIVATE_COPY__", quotePowerShell(join(desktop, "scripts/windows-artifact-private-copy.ps1")))
    .replace("__COPY_REVERIFY__", quotePowerShell(join(desktop, "scripts/windows-artifact-copy-reverification.ps1")))
    .replace("__ASAR_CAPTURE__", quotePowerShell(modulePath));
  const child = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", powershellScript],
    { cwd: desktop, encoding: "buffer", timeout: 300_000, windowsHide: true, maxBuffer: 9 * 1024 * 1024 },
  );
  if (child.error || child.status !== 0 || !Buffer.isBuffer(child.stdout)) {
    throw new Error("M13 fixture stage=child-process category=bounded-packet-unavailable");
  }
  try {
    verifyOwnedArchiveUnchanged(source);
  } catch {
    throw new Error("M13 fixture stage=source-material-recheck category=material-changed");
  }
  const packet = parseCapturePacket(child.stdout);
  expect({
    fixture: {
      firstFailureStage: packet.fixtureStage,
      currentStage: packet.fixtureCurrentStage,
      category: packet.fixtureErrorCategory,
      code: packet.fixtureErrorCode,
    },
    releaseProofs: [
      packet.releaseSucceeded,
      packet.m9ReleaseProven,
      packet.sourceReleaseProven,
      packet.outputDirectoryReleaseProven,
      packet.applicationReleaseProven,
      packet.portableReleaseProven,
    ],
  }).toEqual({
    fixture: { firstFailureStage: "none", currentStage: "complete", category: "none", code: "none" },
    releaseProofs: [true, true, true, true, true, true],
  });
  let observation: Observation | null;
  try {
    observation = observeCapturedRanges(packet);
  } catch {
    throw new Error("M13 fixture stage=m12-preflight category=observer-threw");
  }
  return { ...packet, observation, expectedArchiveLength: source.length };
}

function expectM12Accepted(result: HandleResult): void {
  expect(result.status).toBe("verified");
  expect(result.failureCode).toBeNull();
  expect(result.observation?.observationStatus).toBe("passed");
  expect(result.observation?.failureCode).toBeNull();
  expect(result.observation?.evidence).toEqual({ source: "caller-bytes", scope: "header-only" });
  expect(result.observation?.claims).toEqual({
    snapshot: "incomplete",
    signature: "not-evaluated",
    content: "not-evaluated",
    hash: "not-evaluated",
    sourceIdentity: "not-evaluated",
  });
  expect(result.captureClaimsBounded).toBe(true);
  expect(result.sizePickle.length === 8 && result.sizePickle.readUInt32LE(0) === 4).toBe(true);
  expect(result.sizePickle.readUInt32LE(4) === result.headerPickle.length).toBe(true);
  expect(result.sizePickleBytesRead).toBe(8);
  expect(result.headerPickleBytesRead).toBe(result.headerPickle.length);
  expect(result.copySha256).toMatch(/^[A-F0-9]{64}$/);
  expect(result.identityProof).toMatch(/^[A-F0-9]{64}$/);
  expect(result.m11Calls).toBe(2);
  expect(result.m10ReadyAfterCapture).toBe(true);
  expect(result.m9ReadyAfterCapture).toBe(true);
  expect(result.sourceConsumedOnce).toBe(true);
  expect(result.sourceCountersStable).toBe(true);
  expect(result.sourceReadCalls).toBe(0);
  expect(result.sourceSeekCalls).toBe(0);
  expect(result.sourceStillHeldAfterCopyClose).toBe(true);
  expect(result.outputDirectoryStillHeldAfterCopyClose).toBe(true);
  expect(result.releaseSucceeded).toBe(true);
  expect(result.m9ReleaseProven).toBe(true);
  expect(result.sourceReleaseProven).toBe(true);
  expect(result.outputDirectoryReleaseProven).toBe(true);
  expect(result.applicationReleaseProven).toBe(true);
  expect(result.portableReleaseProven).toBe(true);
  expect(result.heldRenameBlocked).toBe(true);
  expect(result.heldDeleteBlocked).toBe(true);
}

describe("M13 real HANDLE test source contract", () => {
  it("uses the installed ASAR 3.4.1 producer and passes captured buffers directly to M12", () => {
    const source = readFileSync(__filename, "utf8");
    const endpoint = readFileSync(modulePath, "utf8");
    expect(source).toContain("@electron+asar@3.4.1");
    expect(source).toContain("lib/pickle.js");
    expect(source).toContain("spawnSync(process.execPath");
    expect(source).toContain("timeout: 120_000");
    expect(source).toContain('stdio: "ignore"');
    expect(source).toContain('createHash("sha256")');
    expect(source).toContain("verifyOwnedArchiveUnchanged(source)");
    expect(source).not.toContain(["process", ".exit("].join(""));
    expect(source).toContain("api.observeAsarHeader(packet.sizePickle, packet.headerPickle, packet.archiveLength)");
    expect(source).toContain("XRAYM13P");
    expect(source).toContain(["$script:m13FirstFailure", "Stage"].join(""));
    expect(source).toContain(["$script:m13Current", "Stage"].join(""));
    expect(source).toContain(["Get-M13Fixture", "ErrorCode"].join(""));
    expect(source).toContain(["if", "($knownCodes -ccontains $message) { return $message }"].join(" "));
    expect(source).toContain(["return", "'unknown'"].join(" "));
    expect(source).not.toContain(["Get-M13FixedAsciiField", "$ErrorRecord.Exception.Message"].join(" "));
    for (const forbidden of [
      ["ToBase64", "String"].join(""),
      ["console", ".log"].join(""),
      ["Write-Output", "$capture"].join(" "),
      ["ConvertTo-Json", "-InputObject", "$capture"].join(" "),
      ["rm", "Sync"].join(""),
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toContain(["deleteAfterRelease", "Succeeded"].join(""));
    const prefixCheck = endpoint.indexOf("if ($picklePayloadLength -ne [uint32]4)");
    const headerLengthCheck = endpoint.indexOf("if ($expectedLength -lt [long]8 -or $headerLengthUnsigned -lt [uint32]12");
    const allocationComment = endpoint.indexOf("# Allocate the exact managed range only after every prefix and archive bound is accepted.");
    const headerAllocation = endpoint.indexOf("$headerPickle = [byte[]]::new([int]$headerLength)");
    expect(prefixCheck).toBeGreaterThanOrEqual(0);
    expect(headerLengthCheck).toBeGreaterThan(prefixCheck);
    expect(allocationComment).toBeGreaterThan(headerLengthCheck);
    expect(headerAllocation).toBeGreaterThan(allocationComment);
  });
});

windowsDescribe("M13 real M10-owned HANDLE capture and M12 consumption", () => {
  it.each([
    ["producer-empty-tree", 0],
    ["producer-unicode", 2],
    ["producer-cross-1mib-header", 0],
    ["producer-eight-mib-header", 0],
  ] as const)("captures and preflights %s from the original target HANDLE", async (scenario, expectedEntries) => {
    const result = await runOwnedCapture(scenario);
    expectM12Accepted(result);
    expect(result.observation?.counts.entries).toBe(expectedEntries);
    if (scenario === "producer-unicode") {
      expect(result.observation?.entries.map((entry) => entry.path)).toContain("目录/naïve.txt");
    }
    if (scenario === "producer-cross-1mib-header") {
      expect(result.headerPickle.length).toBe(1_048_580);
      expect(result.headerPickle.length).toBeGreaterThan(nativeChunkBytes);
      expect(result.m13ReadCalls).toBe(3);
    }
    if (scenario === "producer-eight-mib-header") {
      expect(result.headerPickle.length).toBe(maxHeaderBytes);
      expect(result.headerPickle.length).toBeGreaterThan(nativeChunkBytes);
      expect(result.m13ReadCalls).toBe(9);
    }
    expect(result.expectedArchiveLength).toBe(result.archiveLength);
  }, 360_000);

  it.each([
    ["invalid-size-prefix", "ASAR_HEADER_CAPTURE_SIZE_PICKLE_REJECTED", "m13-first-prefix-read", 1],
    ["producer-header-over-cap", "ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED", "m13-first-prefix-read", 1],
  ] as const)("rejects %s at the actual prefix path before reading a header range", async (scenario, failureCode, marker, reads) => {
    const result = await runOwnedCapture(scenario);
    expect(result.status).toBe("rejected");
    expect(result.failureCode).toBe(failureCode);
    expect(result.sizePickle.length).toBe(0);
    expect(result.headerPickle.length).toBe(0);
    expect(result.sizePickleBytesRead).toBe(0);
    expect(result.headerPickleBytesRead).toBe(0);
    expect(result.m13ReadCalls).toBe(reads);
    expect(result.m11Calls).toBe(1);
    expect(result.faultStage).toBe(marker);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.captureClaimsBounded).toBe(true);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.releaseSucceeded).toBe(true);
    expect(result.observation).toBeNull();
  }, 360_000);

  it.each([
    ["native-read-observation-fault", "ASAR_HEADER_CAPTURE_READ_FAILED", "fixture-observation:target-read", 1, 1],
    ["owner-recheck-observation-fault", "ASAR_HEADER_CAPTURE_LEDGER_REJECTED", "fixture-observation:owner-recheck", 0, 0],
    ["metadata-observation-fault", "ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED", "fixture-observation:target-metadata", 0, 1],
    ["borrowed-source-observation-fault", "ASAR_HEADER_CAPTURE_SOURCE_CHANGED", "fixture-observation:source-stability", 1, 1],
    ["directory-observation-fault", "ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED", "fixture-observation:directory-stability", 0, 1],
  ] as const)("reaches and records the M13 %s failure point", async (scenario, failureCode, marker, reads, m11Calls) => {
    const result = await runOwnedCapture(scenario);
    expect(result.status).toBe("rejected");
    expect(result.failureCode).toBe(failureCode);
    expect(result.sizePickle.length).toBe(0);
    expect(result.headerPickle.length).toBe(0);
    expect(result.m13ReadCalls).toBe(reads);
    expect(result.m11Calls).toBe(m11Calls);
    expect(result.faultStage).toBe(marker);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.captureClaimsBounded).toBe(true);
    expect(result.releaseSucceeded).toBe(true);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.observation).toBeNull();
  }, 360_000);

  it("rejects a foreign live M9 tuple while preserving both foreign and original M9 state", async () => {
    const result = await runOwnedCapture("foreign-m9-tuple");
    expect(result.status).toBe("rejected");
    expect(result.failureCode).toBe("ASAR_HEADER_CAPTURE_LEDGER_REJECTED");
    expect(result.faultStage).toBe("fixture-state:foreign-m9-pair");
    expect(result.m13ReadCalls).toBe(0);
    expect(result.m11Calls).toBe(0);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(true);
    expect(result.foreignM9ReadyAfterCapture).toBe(true);
    expect(result.captureClaimsBounded).toBe(true);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.releaseSucceeded).toBe(true);
    expect(result.observation).toBeNull();
  }, 360_000);

  it("revokes the captured M9 state after a late replacement and preserves the replacement", async () => {
    const result = await runOwnedCapture("late-m9-state-replacement");
    expect(result.status).toBe("rejected");
    expect(result.failureCode).toBe("ASAR_HEADER_CAPTURE_LEDGER_REJECTED");
    expect(result.faultStage).toBe("fixture-state:m9-replacement");
    expect(result.m13ReadCalls).toBe(1);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.replacementStillCurrent).toBe(true);
    expect(result.replacementReady).toBe(true);
    expect(result.captureClaimsBounded).toBe(true);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.releaseSucceeded).toBe(true);
    expect(result.observation).toBeNull();
  }, 360_000);

  it.each([
    ["m11-before-observation-fault", "fixture-observation:m11-before", 1, 0],
    ["m11-after-observation-fault", "fixture-observation:m11-after", 2, 2],
  ] as const)("records both actual M11 calls on %s", async (scenario, marker, m11Calls, m13ReadCalls) => {
    const result = await runOwnedCapture(scenario);
    expect(result.status).toBe("rejected");
    expect(result.failureCode).toBe("ASAR_HEADER_CAPTURE_REVERIFY_REJECTED");
    expect(result.faultStage).toBe(marker);
    expect(result.m11Calls).toBe(m11Calls);
    expect(result.m13ReadCalls).toBe(m13ReadCalls);
    expect(result.sizePickle.length).toBe(0);
    expect(result.headerPickle.length).toBe(0);
    expect(result.m10ReadyAfterCapture).toBe(false);
    expect(result.m9ReadyAfterCapture).toBe(false);
    expect(result.captureClaimsBounded).toBe(true);
    expect(result.sourceReadCalls).toBe(0);
    expect(result.sourceSeekCalls).toBe(0);
    expect(result.releaseSucceeded).toBe(true);
    expect(result.observation).toBeNull();
  }, 360_000);

  it("preserves an unconfirmed M10 close and releases the same owner on retry", async () => {
    const result = await runOwnedCapture("close-retry");
    expectM12Accepted(result);
    expect(result.faultStage).toBe("fixture-observation:m10-close-unconfirmed");
    expect(result.releaseSucceeded).toBe(true);
    expect(result.firstCloseUnconfirmed).toBe(true);
    expect(result.closeRetrySucceeded).toBe(true);
  }, 360_000);
});
