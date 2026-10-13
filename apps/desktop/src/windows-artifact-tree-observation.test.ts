// Pure source-contract regression only. It does not execute PS5.1, bind APIs, or authenticate a tree.
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cwd=resolve(process.cwd()),desktop=basename(cwd).toLowerCase()==="desktop"&&basename(dirname(cwd)).toLowerCase()==="apps"?cwd:join(cwd,"apps","desktop");
const tree=readFileSync(join(desktop,"scripts/windows-artifact-tree-observation.ps1"),"utf8"),directory=readFileSync(join(desktop,"scripts/windows-artifact-directory-observation.ps1"),"utf8"),bridge=readFileSync(join(desktop,"scripts/windows-artifact-handle-bridge.ps1"),"utf8"),fixture=readFileSync(join(desktop,"scripts/test-fixtures/windows-artifact-tree-probe.ps1"),"utf8");

describe("M7 pure recursive tree contracts (static; Windows runtime remains gated)",()=>{
  it("imports as function definitions only and has no source enumeration or process launcher",()=>{
    expect(tree.trim()).toMatch(/^#.*\r?\n(?:\r?\n)?function /);
    expect(tree).not.toMatch(/Add-Type|Start-Process|Diagnostics\.Process|Directory\]::|File\]::|Get-ChildItem|Invoke-Expression|Get-Content|Set-Content|CreateFileMapping|AssemblyBuilderAccess\]::Save/);
  });
  it("leaves M6 caps at 128 members, 130 page records, and 132 calls while exposing bounded explicit capacity",()=>{
    expect(directory).toContain("[int]$MaxMembers = 128");expect(directory).toContain("[int]$MaxCalls = 132");expect(directory).toContain("[int]$MaxRecords = 130");
    expect(directory).toContain("if (++$records -gt 130)");expect(directory).toContain("if (++$calls -gt 132)");expect(directory).toContain("if ($entries.Count -ge 128)");
    expect(directory).toContain("$MaxMembers -gt 5000");expect(directory).toContain("$MaxCalls -gt 5003");expect(directory).toContain("$MaxRecords -gt 682");
    expect(tree).toContain("$Node.handle $State.nativeBuffer $State.page 5000 5003 682 $remaining");
  });
  it("opens each child from one parent plus one validated component and registers before metadata",()=>{
    expect(tree).toContain("function Get-XRayTreeRelativePath");expect(tree).toContain("Assert-XRayDirectoryName $Name");expect(tree).toContain("GetByteCount($relative) -gt 512");
    expect(tree).toContain("Open-XRayRelativeHandle $Node.handle $entry.name $entry.directory");
    const open=tree.indexOf("$handle = Open-XRayRelativeHandle"),owned=tree.indexOf("$Session.handles.Add($handle)",open),metadata=tree.indexOf("$metadata = Get-XRayDirectoryMetadata $handle",owned);
    expect(open).toBeGreaterThan(0);expect(owned).toBeGreaterThan(open);expect(metadata).toBeGreaterThan(owned);
    expect(tree).not.toMatch(/GetFullPath|GetFullPathName|Resolve-Path|Join-Path|Normalize\(/);
    expect(tree).not.toMatch(/Close-XRayArtifactSession|Invoke-XRayNative CloseHandle/);
  });
  it("rejects all volume/file identity reuse across ancestors and descendants",()=>{
    expect(tree).toContain("function Get-XRayTreeIdentityKey");expect(tree).toContain("[Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)");
    expect(tree).toContain("foreach ($ancestorMetadata in $Session.chain)");expect(tree).toContain("if (-not $State.identities.Add($key)) { throw 'DIRECTORY_COLLISION' }");
    expect(tree).toContain("$Metadata.volume -cnotmatch '^[0-9A-F]{16}$'");expect(tree).toContain("$Metadata.fileId -cnotmatch '^[0-9A-F]{32}$'");
  });
  it("borrows M5's same registered file handle and keeps view counters distinct from the owner ledger",()=>{
    expect(tree).toContain("$observation = Get-XRayArtifactObservation $view $true");expect(tree).toContain("maxBytes = [long]2147483648");
    expect(tree).toContain("$viewHandles.Add($handle); $viewChain.Add($metadataBefore)");expect(tree).toContain("$viewStart = [Math]::Max(0, $BranchHandles.Count - 64)");expect(tree).toContain("if ($viewHandles.Count -gt 65) { throw 'TREE_LIMIT' }");expect(tree).toContain("borrowedHandleCount = [int]$observation.heldHandles");
    expect(tree).toContain("borrowedViewHandleCount += [long]$observation.heldHandles");expect(tree).toContain("ownerHandleCount = $Session.handles.Count");
    expect(tree).toContain("function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) { return (Get-XRayDirectoryMetadata $Handle $Directory) }");
    expect(tree).toContain("$viewBefore = New-XRayTreeReadMetadata $metadataBefore");expect(tree).toContain("before = $viewBefore");
    const m5View=tree.slice(tree.indexOf("function New-XRayTreeReadMetadata"),tree.indexOf("function Visit-XRayArtifactTreeDirectory"));
    expect(m5View.indexOf("attributes = [int]$copy.attributes; length = [long]$copy.length; allocation = [long]$copy.allocation; links = [int]$copy.links")).toBeGreaterThan(0);
    expect(m5View.indexOf("creation = [long]$copy.creation; write = [long]$copy.write; change = [long]$copy.change")).toBeGreaterThan(m5View.indexOf("attributes = [int]$copy.attributes"));
    expect(bridge).toContain("function Get-XRayArtifactObservation($Session, [bool]$CapturePeHeader = $false)");
  });
  it("retains every first vector and member preimage until a global final vector and metadata pass",()=>{
    const visitStart=tree.indexOf("function Visit-XRayArtifactTreeDirectory"),finalStart=tree.indexOf("function Assert-XRayArtifactTreeFinalState"),visit=tree.slice(visitStart,finalStart),final=tree.slice(finalStart,tree.indexOf("function Get-XRayArtifactTreeObservation",finalStart));
    expect(visit).toContain("$first = Get-XRayDirectoryVector");expect(visit).toContain("$State.directories.Add");expect(visit).toContain("$State.members.Add");expect(visit).toContain("Visit-XRayArtifactTreeDirectory $Session $directoryNode");
    expect(visit).not.toContain("$second = Get-XRayDirectoryVector");expect(visit).not.toContain("$State.accountedBytes -= $firstCharge");
    expect(final).toContain("foreach ($directory in $State.directories)");expect(final).toContain("Get-XRayDirectoryVector $directory.handle");expect(final).toContain("Assert-XRayDirectoryVectorsStable $directory.first $second");
    expect(final).toContain("foreach ($member in $State.members)");expect(final).toContain("Assert-XRayDirectoryMetadataStable $member.metadataBefore $actual");expect(final).toContain("Assert-XRayDirectoryMember $member.entry $actual");
    const visitCall=tree.indexOf("Visit-XRayArtifactTreeDirectory $Session $rootNode"),globalFinal=tree.indexOf("Assert-XRayArtifactTreeFinalState $Session $state"),output=tree.indexOf("$output = [pscustomobject]");
    expect(visitCall).toBeGreaterThan(0);expect(globalFinal).toBeGreaterThan(visitCall);expect(output).toBeGreaterThan(globalFinal);
    expect(directory).toContain("function Assert-XRayDirectoryVectorsStable");expect(directory).toContain("function Assert-XRayDirectoryMetadataStable");
    const stableMetadata=directory.slice(directory.indexOf("function Assert-XRayDirectoryMetadataStable"),directory.indexOf("# Local dynamic-scope override"));
    for(const field of ["volume","fileId","directory","attributes","creation","write","change","length","allocation","links"]) expect(stableMetadata).toMatch(new RegExp(`\\$expected\\.${field} -c?ne \\$actual\\.${field}`));
    expect(tree).toContain("$State.directoryCalls -gt 50000 - $first.calls");expect(tree).toContain("$State.directoryCalls -gt 50000 - $second.calls");
  });
  it("enforces finite recursive limits and the unchanged 1MiB hash plus 64KiB directory buffers",()=>{
    for(const required of ["$Depth -gt 64","$State.directoryCount -gt 5000","$Session.handles.Count -gt 10000","$State.fileCount -ge 5000","$entry.length -gt 2147483648","8589934592 - $entry.length","GetByteCount($relative) -gt 512","$State.timer.Elapsed.TotalSeconds -gt 900","33554432 - $State.accountedBytes","[byte[]]::new(65536)","New-XRayZeroBuffer 65536"]) expect(tree).toContain(required);
    expect(tree).toContain("accountedBytes = [long]131072");expect(directory).toContain("[byte[]]::new(65536)");expect(bridge).toContain("$bufferSize = 1048576");
  });
  it("returns only incomplete, unsigned tree-file records with bounded same-handle PE material",()=>{
    expect(tree).toContain("scope = 'tree-files'; snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'");
    expect(tree).toContain("peCapture = $observation.peCapture");expect(tree).toContain("sha256 = $observation.sha256");
    const output=tree.slice(tree.indexOf("$output = [pscustomobject]"));expect(output).not.toMatch(/signatureStatus = 'verified'|snapshotStatus = 'complete'|absolutePath|directoryPath|Path =/);
  });
  it("keeps probe output bounded to a summary, three samples, and a canonical digest",()=>{
    expect(fixture).toContain("$sample = @($observation.files | Select-Object -First 3)");expect(fixture).toContain("recordDigest = $recordDigest");
    expect(fixture).toContain("foreach ($record in $observation.files)");expect(fixture).not.toMatch(/Send-XRayTreeFrame\s+\$observation/);
    expect(fixture).toContain("'post-vector-add'");expect(fixture).toContain("'post-vector-field'");expect(fixture).toContain("'metadata-change-write'");expect(fixture).toContain("'late-subtree-add'");expect(fixture).toContain("'late-subtree-metadata'");expect(fixture).toContain("'late-file-metadata'");
    expect(fixture).toContain("$script:lateSubtreeInjected = $true");expect(fixture).toContain("$script:lateMetadataInjected = $true");expect(fixture).toContain("$code -ceq 'DIRECTORY_CHANGED'");
    expect(fixture).toContain("$release.type -cne 'release'");expect(fixture).toContain("Close-XRayArtifactSession $session");
  });
});
