// Static contracts plus a pure PowerShell descriptor regression; no Windows APIs are bound.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const modulePath = join(desktop, "scripts/windows-artifact-output-directory.ps1");
const source = readFileSync(modulePath, "utf8");
const fixture = readFileSync(join(desktop, "scripts/test-fixtures/windows-artifact-output-directory-probe.ps1"), "utf8");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

describe("M8 private output directory source contracts (static and pure PowerShell; HANDLE runtime remains gated)", () => {
  it("imports as function definitions only and keeps fixture fault injection out of the module", () => {
    expect(source.trim()).toMatch(/^#.*\r?\n#.*\r?\n\r?\nfunction /);
    expect(source).not.toMatch(/Add-Type|Start-Process|Diagnostics\.Process|ExecutionPolicy|Get-Acl|Set-Acl|SetSecurityInfo|WriteFile|ReadFile|MoveFile|DeleteFile|AssemblyBuilderAccess\]::Save/);
    expect(source).not.toMatch(/xrayOutputFixtureMode|faultReached|extra-ace|null-dacl/);
    expect(fixture).toContain("function Invoke-XRayOutputNative(");
    expect(fixture).toContain("function Get-XRayOutputSecurityDescriptor(");
  });

  it("accepts one explicit absolute local path and rejects ambiguous components without canonicalization", () => {
    expect(source).toContain("function Get-XRayOutputPathParts([string]$Path)");
    expect(source).toContain("$Path -notmatch '^[A-Za-z]:\\\\'");
    expect(source).toContain("$Path.Contains('/')");
    expect(source).toContain("$Path.EndsWith('\\')");
    expect(source).toContain("$Path.Substring(3).Split([char[]]@([char]92))");
    expect(source).toContain("$all.Count -gt 64");
    expect(source).toContain("$component.Length -gt 255");
    expect(source).toContain("$component -in @('.', '..')");
    expect(source).not.toMatch(/GetFullPath|GetFullPathName|Resolve-Path|Join-Path|Resolve-Path|Get-Acl/);
  });

  it("reuses M4 read-only component opens and registers each owned parent handle before metadata", () => {
    const parentStart = source.indexOf("function Open-XRayOutputParentChain");
    const parentEnd = source.indexOf("function Test-XRayOutputOwnedSession", parentStart);
    const parent = source.slice(parentStart, parentEnd);
    expect(parent).toContain("Invoke-XRayNative GetDriveTypeW");
    expect(parent).toContain("Invoke-XRayNative CreateFileW");
    expect(parent).toContain("Open-XRayRelativeHandle $parent");
    const rootOpen = parent.indexOf("$root = Invoke-XRayNative CreateFileW");
    const rootRegister = parent.indexOf("Add-XRayOutputOwnedHandle $Session $root", rootOpen);
    const rootMetadata = parent.indexOf("Get-XRayHandleMetadata $root", rootRegister);
    expect(rootOpen).toBeGreaterThanOrEqual(0);
    expect(rootRegister).toBeGreaterThan(rootOpen);
    expect(rootMetadata).toBeGreaterThan(rootRegister);
    const childOpen = parent.indexOf("$next = Open-XRayRelativeHandle");
    const childRegister = parent.indexOf("Add-XRayOutputOwnedHandle $Session $next", childOpen);
    const childMetadata = parent.indexOf("Get-XRayHandleMetadata $next", childRegister);
    expect(childRegister).toBeGreaterThan(childOpen);
    expect(childMetadata).toBeGreaterThan(childRegister);
    expect(source).not.toMatch(/function Invoke-XRayNative\(/);
    expect(source).toContain("function Test-XRayOutputOwnedSession");
    expect(source).toContain("[object]::ReferenceEquals($owned, $Session)");
    const createStart = source.indexOf("$nativeStatus = [int](Invoke-XRayOutputNative NtCreateFile $arguments)");
    const createRegister = source.indexOf("Add-XRayOutputOwnedHandle $session $createdHandle", createStart);
    const createMetadata = source.indexOf("Get-XRayHandleMetadata $createdHandle", createRegister);
    expect(createStart).toBeGreaterThan(0);
    expect(createRegister).toBeGreaterThan(createStart);
    expect(createMetadata).toBeGreaterThan(createRegister);
  });

  it("uses only an exclusive relative FILE_CREATE with creation-time protected DACL", () => {
    expect(source).toContain("function New-XRayOutputSecurityDescriptor([string]$UserSid)");
    expect(source).toContain("'D:P' + ($aces -join '')");
    expect(source).toContain("'(A;OICI;' + $rights");
    expect(source).toContain("$rights = '0x001301BF'");
    expect(source).toContain("Marshal]::Copy($securityBytes, 0, $securityPointer, $securityBytes.Length)");
    expect(source).toContain("[Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 32, $securityPointer)");
    expect(source).toContain("[uint32]0x120083");
    expect(source).toContain("[uint32]1, [uint32]2, [uint32]0x200021");
    expect(source).toContain("ReadInt64($ioStatus, 8) -ne 2");
    expect(source).toContain("function Invoke-XRayOutputNativeCore");
    expect(source).toContain("$Arguments[7] -ne [uint32]2");
    expect(source).toContain("$Arguments[8] -ne [uint32]0x200021");
    expect(source).not.toMatch(/SetSecurityInfo|SetNamedSecurityInfo|Set-Acl|Get-Acl|FILE_OPEN_IF|FILE_OVERWRITE|FILE_SUPERSEDE/);
  });

  it("verifies owner and the complete protected ACE set from the created handle", () => {
    expect(source).toContain("Get-XRayOutputSecurityDescriptorCore([IntPtr]$Handle)");
    expect(source).toContain("Invoke-XRayOutputNative GetSecurityInfo $arguments");
    expect(source).toContain("$descriptor.DiscretionaryAcl");
    expect(source).toContain("($control -band 0x4) -eq 0");
    expect(source).toContain("($control -band 0x1000) -eq 0");
    expect(source).toContain("$descriptor.Owner.Value -cne $UserSid");
    expect(source).toContain("$ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed");
    expect(source).toContain("[int]$ace.AceFlags -ne 3");
    expect(source).toContain("$ace.AccessMask -ne 0x001301BF");
    expect(source).toContain("-not $expected.Remove($ace.SecurityIdentifier.Value)");
    expect(source).toContain("'S-1-5-18'");
    expect(source).toContain("if ($UserSid -cne $systemSid)");
    expect(source).toContain("$ace = $acl[$index]");
    expect(source).not.toContain("$acl.GetAce(");
  });

  it("reports only a fixed fixture stage when a fixture operation fails", () => {
    for (const stage of [
      "setup",
      "acl-before",
      "open-portable",
      "mutate-input-identity",
      "open-application",
      "new-output",
      "summary",
      "rename-check",
      "delete-check",
      "close-output",
      "reopen-after-release",
      "acl-after",
      "release-output",
      "release-application",
      "release-portable",
    ]) {
      expect(fixture).toContain(`$fixtureStage = '${stage}'`);
    }
    expect(fixture).toContain("$fixtureFailureStage = $fixtureStage");
    expect(fixture).toContain("fixtureFailureStage = $fixtureFailureStage");
  });

  it("loads the target PowerShell security module from PSHOME before fixture ACL sampling", () => {
    const aclSamplerStart = fixture.indexOf("function Get-XRayOutputFixtureAclHash");
    const aclSamplerEnd = fixture.indexOf("\nfunction ", aclSamplerStart + 1);
    const aclSampler = fixture.slice(aclSamplerStart, aclSamplerEnd);
    const moduleImport = "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop";

    expect(aclSamplerStart).toBeGreaterThanOrEqual(0);
    expect(aclSampler).toContain(moduleImport);
    expect(aclSampler.indexOf(moduleImport)).toBeLessThan(aclSampler.indexOf("Get-Acl -LiteralPath $Path -ErrorAction Stop"));
    expect(source).not.toContain("Microsoft.PowerShell.Security");
  });

  it("borrows the two live input sessions and rejects output parents containing the app root identity", () => {
    expect(source).toContain("Assert-XRayOutputInputSession $PortableInputSession $false");
    expect(source).toContain("Assert-XRayOutputInputSession $ApplicationInputDirectorySession $true");
    expect(source).toContain("Get-XRayHandleMetadata $handle $expectedType");
    expect(source).toContain("$Session.leaf");
    expect(source).toContain("$Session.chain[$index]");
    expect(source).toContain("$applicationRootKey = $application.root.volume + ':' + $application.root.fileId");
    expect(source).toContain("if (($metadata.volume + ':' + $metadata.fileId) -ceq $applicationRootKey)");
    expect(source).not.toMatch(/Close-XRayArtifactSession \$PortableInputSession|Close-XRayArtifactSession \$ApplicationInputDirectorySession/);
  });

  it("returns bounded evidence and preserves incomplete, unsigned, and actual release states", () => {
    expect(source).toContain("snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'");
    expect(source).toContain("identityProof = $proof");
    expect(source).toContain("releaseStatus = [string]$Session.releaseStatus; releaseFailureCode = $Session.releaseFailureCode; released = [bool]$Session.released");
    expect(source).toContain("releaseFailureCode = $Session.releaseFailureCode");
    expect(source).toContain("applicationRootExcluded = [bool]$Session.applicationRootExcluded");
    expect(source).toContain("if ($failed -or $Session.handles.Count -ne 0)");
    expect(source).toContain("$Session.releaseStatus = 'unconfirmed'; $Session.released = $false");
    expect(source).toContain("if ($null -eq $Session.failureCode) { $Session.failureCode = 'HANDLE_CLOSE_UNCONFIRMED' }");
    const summaryStart = source.indexOf("function Get-XRayPrivateArtifactOutputSummary");
    const summaryEnd = source.indexOf("function Get-XRayOutputFixedFailure", summaryStart);
    const summary = source.slice(summaryStart, summaryEnd);
    expect(summary).not.toMatch(/absolutePath|directoryPath|UserSid|SID|source|handle =|Path =/);
  });
});

purePowerShellDescribe("M8 ACL constructor and parser regression (PowerShell 5.1; no native API calls)", () => {
  it("accepts the constructed descriptor and rejects extra ACE, null DACL, and mismatched owner", () => {
    const quotedModulePath = modulePath.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `. '${quotedModulePath}'`,
      "function Get-BinaryForm($Descriptor) { $bytes = [byte[]]::new($Descriptor.BinaryLength); $Descriptor.GetBinaryForm($bytes, 0); return ,$bytes }",
      "function Assert-Rejected([byte[]]$Bytes, [string]$Sid, [string]$Expected) { $actual = $null; try { $null = Assert-XRayOutputSecurityDescriptor $Bytes $Sid } catch { $actual = $_.Exception.Message }; if ($actual -cne $Expected) { throw 'PURE_ACL_REGRESSION_REJECTED' } }",
      "$userSid = 'S-1-5-21-111-222-333-1001'",
      "$normal = (New-XRayOutputSecurityDescriptor $userSid).bytes",
      "$normalSummary = Assert-XRayOutputSecurityDescriptor $normal $userSid",
      "if (-not $normalSummary.verified -or -not $normalSummary.ownerVerified -or -not $normalSummary.daclPresent -or -not $normalSummary.daclProtected -or $normalSummary.aceCount -ne 2) { throw 'PURE_ACL_NORMAL_REJECTED' }",
      "$systemSid = 'S-1-5-18'",
      "$system = (New-XRayOutputSecurityDescriptor $systemSid).bytes",
      "$systemSummary = Assert-XRayOutputSecurityDescriptor $system $systemSid",
      "if ($systemSummary.aceCount -ne 1) { throw 'PURE_ACL_SYSTEM_DEDUP_REJECTED' }",
      "$extraSddl = 'O:' + $userSid + 'D:P(A;OICI;0x001301BF;;;' + $userSid + ')(A;OICI;0x001301BF;;;S-1-5-18)(A;OICI;0x001301BF;;;S-1-5-32-545)'",
      "$extra = Get-BinaryForm ([Security.AccessControl.RawSecurityDescriptor]::new($extraSddl))",
      "Assert-Rejected $extra $userSid 'OUTPUT_ACL_ACE_COUNT_REJECTED'",
      "$owner = [Security.Principal.SecurityIdentifier]::new($userSid)",
      "$nullDaclDescriptor = [Security.AccessControl.RawSecurityDescriptor]::new([Security.AccessControl.ControlFlags]0x1004, $owner, $null, $null, $null)",
      "$nullDacl = Get-BinaryForm $nullDaclDescriptor",
      "Assert-Rejected $nullDacl $userSid 'OUTPUT_ACL_DACL_REJECTED'",
      "$otherSid = 'S-1-5-21-111-222-333-1002'",
      "$mismatch = (New-XRayOutputSecurityDescriptor $otherSid).bytes",
      "Assert-Rejected $mismatch $userSid 'OUTPUT_ACL_OWNER_REJECTED'",
      "Write-Output 'M8_PURE_ACL_REGRESSION_PASS'",
    ].join("\r\n");
    const result = spawnSync(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { cwd: desktop, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );

    if (result.error) throw new Error("Pure PowerShell ACL regression could not start");
    if (result.status !== 0) throw new Error(`Pure PowerShell ACL regression failed: ${(result.stderr ?? "").trim()}`);
    expect(result.stdout).toContain("M8_PURE_ACL_REGRESSION_PASS");
  }, 40000);
});
