// Static contracts plus a pure PowerShell descriptor regression; native HANDLE work remains separately gated.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const modulePath = join(desktop, "scripts/windows-artifact-output-file.ps1");
const source = readFileSync(modulePath, "utf8");
const fixture = readFileSync(join(desktop, "scripts/test-fixtures/windows-artifact-output-file-probe.ps1"), "utf8");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

describe("M9 private sidecar output source contracts", () => {
  it("imports as function definitions only and keeps fixture adapters out of production", () => {
    expect(source.trim()).toMatch(/^#.*\r?\n#.*\r?\n\r?\nfunction /);
    expect(source).not.toMatch(/Add-Type|Start-Process|Diagnostics\.Process|ExecutionPolicy|Get-Acl|Set-Acl|SetSecurityInfo|GetFullPath|Resolve-Path|CreateFileW|DeleteFile|MoveFile|AssemblyBuilderAccess\]::Save/);
    expect(source).not.toMatch(/xrayOutputFileFixtureMode|faultReached|extra-ace|null-dacl/);
    expect(fixture).toContain("function Invoke-XRayOutputFileNative(");
    expect(fixture).toContain("function Get-XRayOutputFileSecurityDescriptor(");
  });

  it("accepts only a bounded copied byte array and uses a fixed one-component token name", () => {
    expect(source).toContain("function Copy-XRayOutputFileInput([object]$InputBytes)");
    expect(source).toContain("$InputBytes -isnot [byte[]]");
    expect(source).toContain("$InputBytes.LongLength -gt 33554432");
    expect(source).toContain("$component = 'xray-' + $token + '.sidecar'");
    expect(source).toContain("$token -cnotmatch '^[a-f0-9]{32}$'");
    const publicCreateSignature = source.slice(source.indexOf("function New-XRayPrivateArtifactOutputFile"), source.indexOf("\n", source.indexOf("function New-XRayPrivateArtifactOutputFile")));
    expect(publicCreateSignature).toContain("($DirectorySession, [object]$InputBytes)");
    expect(publicCreateSignature).not.toMatch(/Path|Name|IntPtr|Stream|scriptblock/i);
    const operationStart = source.indexOf("function New-XRayPrivateArtifactOutputFile");
    const operationEnd = source.indexOf("function Close-XRayPrivateArtifactOutputFile", operationStart);
    const operation = source.slice(operationStart, operationEnd);
    expect(operation.indexOf("Copy-XRayOutputFileInput $InputBytes")).toBeGreaterThan(0);
    expect(operation.indexOf("Get-XRayOutputFileHash $captured")).toBeGreaterThan(operation.indexOf("Copy-XRayOutputFileInput $InputBytes"));
    expect(operation.indexOf("Initialize-XRayOutputFileApi")).toBeGreaterThan(operation.indexOf("Get-XRayOutputFileHash $captured"));
    expect(operation.indexOf("Invoke-XRayOutputFileNative NtCreateFile")).toBeGreaterThan(operation.indexOf("Initialize-XRayOutputFileApi"));
  });

  it("creates relative to the registered M8 directory with fixed no-follow FILE_CREATE parameters", () => {
    expect(source).toContain("Test-XRayOutputOwnedSession $DirectorySession");
    expect(source).toContain("$DirectorySession.status -cne 'ready'");
    expect(source).toContain("$DirectorySession.createdHandle");
    expect(source).toContain("Get-XRayHandleMetadata $handle $true");
    expect(source).toContain("function Assert-XRayOutputFileIdentityProjection");
    const borrowerStart = source.indexOf("function Assert-XRayOutputFileBorrowedDirectory");
    const borrowerEnd = source.indexOf("function Assert-XRayOutputFileDirectoryStable", borrowerStart);
    const borrower = source.slice(borrowerStart, borrowerEnd);
    expect(borrower).toContain("Assert-XRayOutputFileMetadata (Get-XRayHandleMetadata $handle $true) $true");
    expect(borrower).toContain("Assert-XRayOutputFileIdentityProjection $DirectorySession.createdIdentity $true");
    expect(borrower).not.toContain("Assert-XRayOutputFileMetadata $DirectorySession.createdIdentity");
    expect(source).toContain("$nativeStatus = [int](Invoke-XRayOutputFileNative NtCreateFile $arguments)");
    expect(source).toContain("[uint32]0x00120083");
    expect(source).toContain("[uint32]1, [uint32]2, [uint32]0x00200060");
    expect(source).toContain("[Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 8, $directory.handle)");
    expect(source).toContain("ReadInt64($ioStatus, 8) -ne 2");
    expect(source).not.toMatch(/FILE_OPEN_IF|FILE_OVERWRITE|FILE_SUPERSEDE|SetSecurityInfo|SetNamedSecurityInfo/);
    expect(source).not.toMatch(/Open-XRayRelativeHandle|Open-XRayArtifactSession|GetFullPath|Resolve-Path|\[IO\.File\]::|\[IO\.Directory\]::/);
  });

  it("applies and verifies a protected ordinary-file ACL with exact user and SYSTEM ACEs", () => {
    expect(source).toContain("'D:P' + ($aces -join '')");
    expect(source).toContain("$rights = '0x00120083'");
    expect(source).toContain("'(A;;' + $rights");
    expect(source).toContain("Get-XRayOutputFileSecurityDescriptor $createdHandle");
    expect(source).toContain("$descriptor.DiscretionaryAcl");
    expect(source).toContain("($control -band 0x1000) -eq 0");
    expect(source).toContain("$descriptor.Owner.Value -cne $UserSid");
    expect(source).toContain("[int]$ace.AceFlags -ne 0");
    expect(source).toContain("$ace.AccessMask -ne 0x00120083");
    expect(source).toContain("if ($UserSid -cne 'S-1-5-18')");
  });

  it("writes and reads in bounded chunks, checks actual counters, same-handle EOF, and independent hashes", () => {
    expect(source).toContain("while ($offset -lt $state.bytesRequested)");
    expect(source).toContain("[Math]::Min([long]1048576, $remaining)");
    expect(source).toContain("$actual = [uint32]$writeArgs[3]");
    expect(source).toContain("$actual -ne [uint32]$count -or $actual -eq 0");
    expect(source).toContain("SetFilePointerEx @($createdHandle, [int64]0");
    expect(source).toContain("while ($readOffset -lt $state.bytesRequested)");
    expect(source).toContain("$actual = [uint32]$readArgs[3]");
    expect(source).toContain("$eofArgs = [object[]]@($createdHandle, $buffer, [uint32]1");
    expect(source).toContain("if ($eofCount -ne 0) { throw 'OUTPUT_FILE_EOF_REJECTED' }");
    expect(source).toContain("$state.readbackSha256 -cne $state.inputSha256");
    expect(source).toContain("Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity");
  });

  it("keeps owned file handles private, borrows M8 handles, and returns fixed incomplete evidence", () => {
    expect(source).toContain("[object]::ReferenceEquals($entry.session, $Session)");
    expect(source).toContain("$State.handles.Add($Handle)");
    expect(source).toContain("snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'");
    expect(source).toContain("releaseStatus = 'unconfirmed'; $state.released = $false");
    expect(source).toContain("Close-XRayPrivateArtifactOutputFile");
    expect(source).not.toMatch(/Close-XRayPrivateArtifactOutputDirectory \$DirectorySession|Close-XRayArtifactSession \$DirectorySession|\bRemove-Item\b|\[IO\.File\]::|\[IO\.Directory\]::/);
    const summaryStart = source.indexOf("function Get-XRayPrivateArtifactOutputFileSummary");
    const summaryEnd = source.indexOf("function Add-XRayOutputFileOwnedHandle", summaryStart);
    const summary = source.slice(summaryStart, summaryEnd);
    expect(summary).not.toMatch(/absolutePath|directoryPath|UserSid|SID|exception|handle =|Path =/i);
  });

  it("defines reached markers and stage boundaries for each injected native failure", () => {
    for (const stage of [
      "setup",
      "open-portable",
      "open-application",
      "new-output-directory",
      "new-output-file",
      "file-summary",
      "close-output-file",
      "verify-existing-target",
    ]) {
      expect(fixture).toContain(`$fixtureStage = '${stage}'`);
    }
    for (const fault of [
      "native-create",
      "write",
      "short-write",
      "read",
      "short-read",
      "eof-probe",
      "close",
      "acl-query",
      "acl-verify",
      "file-identity-recheck",
    ]) {
      expect(fixture).toContain(`$script:xrayOutputFileFaultStage = '${fault}'`);
    }
    expect(fixture).toContain("faultReached = [bool]$script:xrayOutputFileFaultReached");
    expect(fixture).toContain("attempted = [bool]$fileAttempted");
  });
});

purePowerShellDescribe("M9 file ACL constructor and parser regression (pure PowerShell; no native API calls)", () => {
  it("accepts exact protected ACLs and rejects extra, null, wrong-owner, inherited, and wrong-mask descriptors", () => {
    const quotedModulePath = modulePath.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `. '${quotedModulePath}'`,
      "function Get-BinaryForm($Descriptor) { $bytes = [byte[]]::new($Descriptor.BinaryLength); $Descriptor.GetBinaryForm($bytes, 0); return ,$bytes }",
      "function Assert-Rejected([byte[]]$Bytes, [string]$Sid, [string]$Expected) { $actual = $null; try { $null = Assert-XRayOutputFileSecurityDescriptor $Bytes $Sid } catch { $actual = $_.Exception.Message }; if ($actual -cne $Expected) { throw 'M9_PURE_ACL_REJECTION_MISMATCH' } }",
      "$userSid = 'S-1-5-21-111-222-333-1001'",
      "$normal = (New-XRayOutputFileSecurityDescriptor $userSid).bytes",
      "$normalSummary = Assert-XRayOutputFileSecurityDescriptor $normal $userSid",
      "if (-not $normalSummary.verified -or -not $normalSummary.ownerVerified -or -not $normalSummary.daclPresent -or -not $normalSummary.daclProtected -or $normalSummary.aceCount -ne 2) { throw 'M9_PURE_ACL_NORMAL_REJECTED' }",
      "$systemSid = 'S-1-5-18'",
      "$system = (New-XRayOutputFileSecurityDescriptor $systemSid).bytes",
      "$systemSummary = Assert-XRayOutputFileSecurityDescriptor $system $systemSid",
      "if ($systemSummary.aceCount -ne 1) { throw 'M9_PURE_ACL_SYSTEM_DEDUP_REJECTED' }",
      "$extraSddl = 'O:' + $userSid + 'D:P(A;;0x00120083;;;' + $userSid + ')(A;;0x00120083;;;S-1-5-18)(A;;0x00120083;;;S-1-5-32-545)'",
      "$extra = Get-BinaryForm ([Security.AccessControl.RawSecurityDescriptor]::new($extraSddl))",
      "Assert-Rejected $extra $userSid 'OUTPUT_FILE_ACL_ACE_COUNT_REJECTED'",
      "$owner = [Security.Principal.SecurityIdentifier]::new($userSid)",
      "$nullDaclDescriptor = [Security.AccessControl.RawSecurityDescriptor]::new([Security.AccessControl.ControlFlags]0x1004, $owner, $null, $null, $null)",
      "$nullDacl = Get-BinaryForm $nullDaclDescriptor",
      "Assert-Rejected $nullDacl $userSid 'OUTPUT_FILE_ACL_DACL_REJECTED'",
      "$otherSid = 'S-1-5-21-111-222-333-1002'",
      "$mismatch = (New-XRayOutputFileSecurityDescriptor $otherSid).bytes",
      "Assert-Rejected $mismatch $userSid 'OUTPUT_FILE_ACL_OWNER_REJECTED'",
      "$inheritedSddl = 'O:' + $userSid + 'D:P(A;OI;0x00120083;;;' + $userSid + ')(A;;0x00120083;;;S-1-5-18)'",
      "$inherited = Get-BinaryForm ([Security.AccessControl.RawSecurityDescriptor]::new($inheritedSddl))",
      "Assert-Rejected $inherited $userSid 'OUTPUT_FILE_ACL_ACE_REJECTED'",
      "$wrongMaskSddl = 'O:' + $userSid + 'D:P(A;;0x00120003;;;' + $userSid + ')(A;;0x00120083;;;S-1-5-18)'",
      "$wrongMask = Get-BinaryForm ([Security.AccessControl.RawSecurityDescriptor]::new($wrongMaskSddl))",
      "Assert-Rejected $wrongMask $userSid 'OUTPUT_FILE_ACL_ACE_REJECTED'",
      "Write-Output 'M9_PURE_ACL_REGRESSION_PASS'",
    ].join("\r\n");
    const result = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { cwd: desktop, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );

    if (result.error) throw new Error("Pure PowerShell ACL regression could not start");
    if (result.status !== 0) throw new Error(`Pure PowerShell ACL regression failed: ${(result.stderr ?? "").trim()}`);
    expect(result.stdout).toContain("M9_PURE_ACL_REGRESSION_PASS");
  }, 40000);

  it("validates the actual M8 three-field identity projection separately from full HANDLE metadata", () => {
    const quotedModulePath = modulePath.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `. '${quotedModulePath}'`,
      "$script:ownerObject = $null",
      "$script:ownerAccepted = $true",
      "$script:actualMetadata = $null",
      "function Test-XRayOutputOwnedSession($Session) { return ($script:ownerAccepted -and [object]::ReferenceEquals($Session, $script:ownerObject)) }",
      "function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) { if (([int]$script:actualMetadata.attributes -band 0x400) -ne 0) { throw 'REPARSE_REJECTED' }; return $script:actualMetadata }",
      "function Assert-BorrowedRejected($Session, [string]$Expected) { $actual = $null; try { $null = Assert-XRayOutputFileBorrowedDirectory $Session } catch { $actual = $_.Exception.Message }; if ($actual -cne $Expected) { throw 'M9_BORROWED_REJECTION_MISMATCH' } }",
      "$handle = [IntPtr]4660",
      "$script:actualMetadata = [pscustomobject]@{ volume = '0000000000000001'; fileId = '00000000000000000000000000000001'; directory = $true; attributes = 16; length = 0; links = 1; creation = 123; write = 123; change = 123; allocation = 0 }",
      "$projection = [pscustomobject]@{ volume = '0000000000000001'; fileId = '00000000000000000000000000000001'; directory = $true }",
      "$handles = [Collections.Generic.List[IntPtr]]::new(); $handles.Add($handle)",
      "$session = [pscustomobject]@{ status = 'ready'; ready = $true; created = $true; released = $false; ownerRegistered = $true; handles = $handles; registeredHandleCount = 1; createdHandle = $handle; createdIdentity = $projection }",
      "$script:ownerObject = $session",
      "$valid = Assert-XRayOutputFileBorrowedDirectory $session",
      "if ($valid.handle -ne $handle -or $valid.volume -cne $projection.volume -or $valid.fileId -cne $projection.fileId -or -not $valid.directory) { throw 'M9_BORROWED_M8_PROJECTION_REJECTED' }",
      "$session.createdIdentity = [pscustomobject]@{ volume = $projection.volume; fileId = '00000000000000000000000000000002'; directory = $true }",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "$session.createdIdentity = [pscustomobject]@{ volume = $projection.volume; fileId = $projection.fileId; directory = $false }",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "$session.createdIdentity = [pscustomobject]@{ volume = $projection.volume; fileId = $projection.fileId; directory = $true; attributes = 16 }",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "$session.createdIdentity = $projection; $script:ownerAccepted = $false",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "$script:ownerAccepted = $true; $session.status = 'released'; $session.ready = $false; $session.released = $true",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "$session.status = 'ready'; $session.ready = $true; $session.released = $false; $script:actualMetadata.directory = $false",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_METADATA_REJECTED'",
      "$script:actualMetadata.directory = $true; $script:actualMetadata.attributes = 1040",
      "Assert-BorrowedRejected $session 'REPARSE_REJECTED'",
      "$script:actualMetadata.attributes = 16",
      "$script:actualMetadata.directory = $true; $session.createdHandle = [IntPtr]8192",
      "Assert-BorrowedRejected $session 'OUTPUT_FILE_DIRECTORY_REJECTED'",
      "Write-Output 'M9_PURE_BORROWED_DIRECTORY_REGRESSION_PASS'",
    ].join("\r\n");
    const result = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { cwd: desktop, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );

    if (result.error) throw new Error("Pure PowerShell M8 identity-projection regression could not start");
    if (result.status !== 0) throw new Error(`Pure PowerShell M8 identity-projection regression failed: ${(result.stderr ?? "").trim()}`);
    expect(result.stdout).toContain("M9_PURE_BORROWED_DIRECTORY_REGRESSION_PASS");
  }, 40000);
});
