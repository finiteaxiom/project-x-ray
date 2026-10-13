// Pure PowerShell 5.1 conversion, size, and private-owner tests. This file does not exercise Windows HANDLE or native behavior.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd = resolve(process.cwd());
const desktop =
  basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps"
    ? cwd
    : join(cwd, "apps", "desktop");
const modulePath = join(desktop, "scripts/windows-artifact-private-copy.ps1");
const source = readFileSync(modulePath, "utf8");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const purePowerShellDescribe = process.platform === "win32" ? describe : describe.skip;

function runPurePowerShell(body: string): string {
  const quotedModulePath = modulePath.replace(/'/g, "''");
  const script = ["$ErrorActionPreference = 'Stop'", `. '${quotedModulePath}'`, body].join("\r\n");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { cwd: desktop, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  if (result.error) throw new Error("Pure PowerShell M10 regression could not start");
  if (result.status !== 0) throw new Error(`Pure PowerShell M10 regression failed: ${(result.stderr ?? "").trim()}`);
  return result.stdout ?? "";
}

describe("M10 private copy source-free helper contracts", () => {
  it("keeps the public copy call limited to already-held session objects and exposes no target path or native handle", () => {
    expect(source).toContain("function New-XRayPrivateArtifactCopy($SourceSession, $DirectorySession)");
    const signature = source.slice(source.indexOf("function New-XRayPrivateArtifactCopy"), source.indexOf("\n", source.indexOf("function New-XRayPrivateArtifactCopy")));
    expect(signature).not.toMatch(/Path|Name|IntPtr|Stream|scriptblock/i);
    expect(source).toContain("snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'");
    expect(source).toContain("# M4 has no owner registry. This remains a trusted internal caller port");
    expect(source).not.toMatch(/\b(Add-Type|Start-Process|GetFullPath|Resolve-Path|Remove-Item|DeleteFile|MoveFile)\b/);
  });
});

purePowerShellDescribe("M10 pure PowerShell 5.1 size, metadata, and owner validation", () => {
  it("bounds every chunk through the exact 2 GiB limit and rejects malformed numeric ranges", () => {
    const output = runPurePowerShell([
      "if ((Get-XRayPrivateCopyChunkLength 0 0 0) -ne 0) { throw 'M10_EMPTY_CHUNK_MISMATCH' }",
      "if ((Get-XRayPrivateCopyChunkLength 0 1 1) -ne 1) { throw 'M10_ONE_BYTE_CHUNK_MISMATCH' }",
      "if ((Get-XRayPrivateCopyChunkLength 0 1048576 1048576) -ne 1048576) { throw 'M10_FULL_CHUNK_MISMATCH' }",
      "if ((Get-XRayPrivateCopyChunkLength 1048576 1048593 1048593) -ne 17) { throw 'M10_FINAL_CHUNK_MISMATCH' }",
      "if ((Get-XRayPrivateCopyChunkLength 0 2147483648 2147483648) -ne 1048576) { throw 'M10_2_GIB_CHUNK_MISMATCH' }",
      "if ((Get-XRayPrivateCopyChunkLength 2147483647 2147483648 2147483648) -ne 1) { throw 'M10_2_GIB_FINAL_CHUNK_MISMATCH' }",
      "function Assert-ChunkRejected([long]$Done, [long]$Expected, [long]$Maximum) { $code = $null; try { $null = Get-XRayPrivateCopyChunkLength $Done $Expected $Maximum } catch { $code = $_.Exception.Message }; if ($code -cne 'PRIVATE_COPY_SIZE_REJECTED') { throw 'M10_INVALID_CHUNK_ACCEPTED' } }",
      "Assert-ChunkRejected -1 1 1; Assert-ChunkRejected 0 -1 0; Assert-ChunkRejected 2 1 2; Assert-ChunkRejected 0 2 1; Assert-ChunkRejected 0 1 2147483649",
      "Write-Output 'M10_PURE_SIZE_PASS'",
    ].join("\r\n"));
    expect(output).toContain("M10_PURE_SIZE_PASS");
  }, 40000);

  it("copies exact metadata types, detects any field change, and rejects incomplete or unsafe metadata", () => {
    const output = runPurePowerShell([
      "$metadata = [pscustomobject]@{ volume = '0000000000000001'; fileId = '00000000000000000000000000000001'; directory = $false; attributes = [int]128; length = [long]17; allocation = [long]4096; links = [int]1; creation = [long]10; write = [long]11; change = [long]12 }",
      "$snapshot = New-XRayPrivateCopyMetadataSnapshot $metadata",
      "if (-not (Test-XRayPrivateCopyMetadataEqual $metadata $snapshot)) { throw 'M10_METADATA_COPY_MISMATCH' }",
      "$proof = Get-XRayPrivateCopyIdentityProof $snapshot; if ($proof -cnotmatch '^[A-F0-9]{64}$') { throw 'M10_IDENTITY_PROOF_INVALID' }",
      "$metadata.change = [long]13; if (Test-XRayPrivateCopyMetadataEqual $metadata $snapshot) { throw 'M10_METADATA_CHANGE_ACCEPTED' }",
      "function Assert-MetadataRejected($Value) { $code = $null; try { $null = New-XRayPrivateCopyMetadataSnapshot $Value } catch { $code = $_.Exception.Message }; if ($code -cne 'PRIVATE_COPY_SOURCE_REJECTED') { throw 'M10_INVALID_METADATA_ACCEPTED' } }",
      "Assert-MetadataRejected ([pscustomobject]@{ volume = '1' })",
      "$bad = [pscustomobject]@{ volume = '0000000000000001'; fileId = '00000000000000000000000000000001'; directory = $false; attributes = [int]1024; length = [long]17; allocation = [long]4096; links = [int]1; creation = [long]10; write = [long]11; change = [long]12 }; Assert-MetadataRejected $bad",
      "$bad.attributes = [int]128; $bad.links = [int]0; Assert-MetadataRejected $bad",
      "Write-Output 'M10_PURE_METADATA_PASS'",
    ].join("\r\n"));
    expect(output).toContain("M10_PURE_METADATA_PASS");
  }, 40000);

  it("binds session lookup to the exact private owner reference despite public DTO mutation", () => {
    const output = runPurePowerShell([
      "$state = [pscustomobject]@{ token = 'private-token'; status = 'ready'; ready = $true; created = $true; failureCode = $null; releaseStatus = 'held'; releaseFailureCode = $null; released = $false; sourceConsumed = $true; bytesRequested = [long]1; sourceBytesRead = [long]1; bytesWritten = [long]1; copyBytesRead = [long]1; sourceSha256 = 'A'; copySha256 = 'A'; sourceIdentityProof = 'B'; outputIdentityProof = 'C'; outputFileState = [pscustomobject]@{ handles = [Collections.Generic.List[IntPtr]]::new() } }",
      "$public = [pscustomobject]@{ version = 1; token = $null }; $entry = Register-XRayPrivateCopySession $public $state",
      "if (-not (Test-XRayPrivateCopyOwnerEntry $entry $public) -or -not [object]::ReferenceEquals((Find-XRayPrivateCopySession $public), $entry)) { throw 'M10_EXACT_OWNER_REJECTED' }",
      "$clone = [pscustomobject]@{ version = $public.version; token = $public.token }; if (Test-XRayPrivateCopyOwnerEntry $entry $clone) { throw 'M10_CLONED_OWNER_ACCEPTED' }",
      "$public.token = 'caller-controlled'; $summary = Get-XRayPrivateArtifactCopySummary $public; if ($summary.token -cne 'private-token') { throw 'M10_PUBLIC_MUTATION_CHANGED_PRIVATE_STATE' }",
      "$code = $null; try { $null = Get-XRayPrivateArtifactCopySummary $clone } catch { $code = $_.Exception.Message }; if ($code -cne 'PRIVATE_COPY_SESSION_INVALID') { throw 'M10_CLONED_SESSION_LOOKUP_ACCEPTED' }",
      "Write-Output 'M10_PURE_OWNER_PASS'",
    ].join("\r\n"));
    expect(output).toContain("M10_PURE_OWNER_PASS");
  }, 40000);
});
