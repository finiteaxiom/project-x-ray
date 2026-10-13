param(
    [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'empty', 'unicode', 'multiblock', 'over-32mib', 'collision-file', 'collision-directory', 'collision-link',
        'already-consumed', 'source-identity-change', 'target-identity-change', 'source-read-failure', 'source-short-read', 'write-failure', 'short-write',
        'target-read-failure', 'target-short-read', 'target-eof-mismatch', 'acl-query-failure', 'close-failure')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$RootPath
)

$ErrorActionPreference = 'Stop'
$script:xrayPrivateCopyMode = $Mode
$script:xrayPrivateCopyFaultReached = $false
$script:xrayPrivateCopyFaultStage = $null
$script:xrayPrivateCopySource = $null
$script:xrayPrivateCopySourceHandle = [IntPtr]::Zero
$script:xrayPrivateCopyTargetHandle = [IntPtr]::Zero
$script:xrayPrivateCopyExpectedBytes = [long]0
$script:xrayPrivateCopySourceReadCalls = 0
$script:xrayPrivateCopyTargetReadCalls = 0
$script:xrayPrivateCopyTargetReadBytes = [long]0
$script:xrayPrivateCopyTargetWriteBytes = [long]0
$script:xrayPrivateCopyCloseFaultUsed = $false

. (Join-Path $PSScriptRoot '..\windows-artifact-handle-bridge.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-directory-observation.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-directory.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-file.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-private-copy.ps1')

$script:xrayPrivateCopyM4Core = (Get-Command Invoke-XRayNative -CommandType Function).ScriptBlock
$script:xrayPrivateCopyMetadataCore = (Get-Command Get-XRayHandleMetadata -CommandType Function).ScriptBlock
$script:xrayPrivateCopyOutputFileCore = (Get-Command Invoke-XRayOutputFileNative -CommandType Function).ScriptBlock
$script:xrayPrivateCopySecurityCore = (Get-Command Get-XRayOutputFileSecurityDescriptor -CommandType Function).ScriptBlock

# Fixture-only deterministic token and gated native adapters. Production exposes no fault controls.
function New-XRayOutputFileToken { return '0123456789abcdef0123456789abcdef' }

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    $metadata = & $script:xrayPrivateCopyMetadataCore $Handle $Directory
    if (-not $Directory -and $Handle -eq $script:xrayPrivateCopySourceHandle -and
        $script:xrayPrivateCopyMode -ceq 'source-identity-change' -and
        $null -ne $script:xrayPrivateCopySource -and $script:xrayPrivateCopySource.readStarted) {
        $metadata.change = [long]$metadata.change + 1
        if (-not $script:xrayPrivateCopyFaultReached) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'source-identity-recheck'
        }
    }
    if (-not $Directory -and $Handle -eq $script:xrayPrivateCopyTargetHandle -and
        $script:xrayPrivateCopyMode -ceq 'target-identity-change' -and
        $script:xrayPrivateCopyExpectedBytes -gt 0 -and
        $script:xrayPrivateCopyTargetWriteBytes -eq $script:xrayPrivateCopyExpectedBytes -and
        [long]$metadata.length -eq $script:xrayPrivateCopyExpectedBytes) {
        $replacement = '1' * 32
        if ([string]$metadata.fileId -ceq $replacement) { $replacement = '2' * 32 }
        $metadata.fileId = $replacement
        if (-not $script:xrayPrivateCopyFaultReached) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'target-identity-recheck'
        }
    }
    return $metadata
}

function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
    if ($Name -ceq 'ReadFile' -and $null -ne $script:xrayPrivateCopySource -and
        [IntPtr]$Arguments[0] -eq $script:xrayPrivateCopySourceHandle -and $script:xrayPrivateCopySource.readStarted) {
        $script:xrayPrivateCopySourceReadCalls++
        if ($script:xrayPrivateCopyMode -ceq 'source-read-failure' -and $script:xrayPrivateCopySourceReadCalls -eq 1) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'source-read'
            $Arguments[3] = [uint32]0; return [int]0
        }
        if ($script:xrayPrivateCopyMode -ceq 'source-short-read' -and $script:xrayPrivateCopySourceReadCalls -eq 1) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'source-short-read'
            $requested = [uint32]$Arguments[2]
            if ($requested -le 1) { $Arguments[3] = [uint32]0; return [int]1 }
            $Arguments[2] = [uint32]($requested - 1)
            try { return (& $script:xrayPrivateCopyM4Core $Name $Arguments) }
            finally { $Arguments[2] = $requested }
        }
    }
    return (& $script:xrayPrivateCopyM4Core $Name $Arguments)
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    $sourceConsumed = ($null -ne $script:xrayPrivateCopySource -and $script:xrayPrivateCopySource.readStarted)
    if ($Name -ceq 'NtCreateFile') {
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        $handle = [IntPtr]$Arguments[0]
        if ($result -ge 0 -and $handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
            $script:xrayPrivateCopyTargetHandle = $handle
        }
        return $result
    }
    if ($sourceConsumed -and $Name -ceq 'WriteFile' -and [IntPtr]$Arguments[0] -eq $script:xrayPrivateCopyTargetHandle) {
        if ($script:xrayPrivateCopyMode -ceq 'write-failure') {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'write'
            $Arguments[3] = [uint32]0; return [int]0
        }
        if ($script:xrayPrivateCopyMode -ceq 'short-write') {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'short-write'
            $requested = [uint32]$Arguments[2]
            if ($requested -le 1) { $Arguments[3] = [uint32]0; return [int]1 }
            $Arguments[2] = [uint32]($requested - 1)
            try {
                $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
                if ($result -ne 0) { $script:xrayPrivateCopyTargetWriteBytes += [long][uint32]$Arguments[3] }
                return $result
            } finally { $Arguments[2] = $requested }
        }
    }
    if ($sourceConsumed -and $Name -ceq 'WriteFile' -and [IntPtr]$Arguments[0] -eq $script:xrayPrivateCopyTargetHandle) {
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        if ($result -ne 0) { $script:xrayPrivateCopyTargetWriteBytes += [long][uint32]$Arguments[3] }
        return $result
    }
    if ($sourceConsumed -and $Name -ceq 'ReadFile' -and [IntPtr]$Arguments[0] -eq $script:xrayPrivateCopyTargetHandle) {
        $script:xrayPrivateCopyTargetReadCalls++
        if ($script:xrayPrivateCopyMode -ceq 'target-read-failure' -and $script:xrayPrivateCopyTargetReadCalls -eq 1) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'target-read'
            $Arguments[3] = [uint32]0; return [int]0
        }
        if ($script:xrayPrivateCopyMode -ceq 'target-short-read' -and $script:xrayPrivateCopyTargetReadCalls -eq 1) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'target-short-read'
            $requested = [uint32]$Arguments[2]
            if ($requested -le 1) { $Arguments[3] = [uint32]0; return [int]1 }
            $Arguments[2] = [uint32]($requested - 1)
            try {
                $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
                if ($result -ne 0) { $script:xrayPrivateCopyTargetReadBytes += [long][uint32]$Arguments[3] }
                return $result
            } finally { $Arguments[2] = $requested }
        }
        if ($script:xrayPrivateCopyMode -ceq 'target-eof-mismatch' -and
            [uint32]$Arguments[2] -eq 1 -and $script:xrayPrivateCopyTargetReadBytes -ge $script:xrayPrivateCopyExpectedBytes) {
            $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'target-eof'
            $Arguments[3] = [uint32]1; return [int]1
        }
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        if ($result -ne 0) { $script:xrayPrivateCopyTargetReadBytes += [long][uint32]$Arguments[3] }
        return $result
    }
    if ($sourceConsumed -and $Name -ceq 'CloseHandle' -and
        [IntPtr]$Arguments[0] -eq $script:xrayPrivateCopyTargetHandle -and
        $script:xrayPrivateCopyMode -ceq 'close-failure' -and -not $script:xrayPrivateCopyCloseFaultUsed) {
        $script:xrayPrivateCopyCloseFaultUsed = $true
        $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'close'
        return [int]0
    }
    return (Invoke-XRayOutputFileNativeCore $Name $Arguments)
}

function Get-XRayOutputFileSecurityDescriptor([IntPtr]$Handle) {
    if ($script:xrayPrivateCopyMode -ceq 'acl-query-failure') {
        $script:xrayPrivateCopyFaultReached = $true; $script:xrayPrivateCopyFaultStage = 'acl-query'
        throw 'OUTPUT_FILE_ACL_QUERY_FAILED'
    }
    return (& $script:xrayPrivateCopySecurityCore $Handle)
}

function Get-XRayPrivateCopyFixtureIdentity([IntPtr]$Handle, [bool]$Directory, [bool]$ReparsePoint) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'FIXTURE_IDENTITY_FAILED' }
    if (-not $ReparsePoint) {
        $metadata = Get-XRayHandleMetadata $Handle $Directory
        return [pscustomobject]@{ volume = [string]$metadata.volume; fileId = [string]$metadata.fileId; directory = [bool]$metadata.directory }
    }
    try { $null = Get-XRayHandleMetadata $Handle $Directory; throw 'FIXTURE_REPARSE_NOT_REJECTED' }
    catch { if ($_.Exception.Message -cne 'REPARSE_REJECTED') { throw 'FIXTURE_IDENTITY_FAILED' } }
    $standard = New-XRayZeroBuffer 24; $identity = New-XRayZeroBuffer 24; $idBytes = [byte[]]::new(16)
    try {
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 1, $standard, [uint32]24)) -eq 0) { throw 'FIXTURE_IDENTITY_FAILED' }
        $deletePending = [Runtime.InteropServices.Marshal]::ReadByte($standard, 20) -ne 0
        $isDirectory = [Runtime.InteropServices.Marshal]::ReadByte($standard, 21) -ne 0
        if ($deletePending -or $isDirectory -ne $Directory) { throw 'FIXTURE_IDENTITY_FAILED' }
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 18, $identity, [uint32]24)) -eq 0) { throw 'FIXTURE_IDENTITY_FAILED' }
        $volume = [BitConverter]::ToUInt64([BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt64($identity, 0)), 0).ToString('X16')
        [Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($identity, 8), $idBytes, 0, 16)
        $fileId = ([BitConverter]::ToString($idBytes)).Replace('-', '')
        if ($volume -cnotmatch '^[0-9A-F]{16}$' -or $volume -ceq ('0' * 16) -or
            $fileId -cnotmatch '^[0-9A-F]{32}$' -or $fileId -ceq ('0' * 32) -or $fileId -ceq ('F' * 32)) {
            throw 'FIXTURE_IDENTITY_FAILED'
        }
        return [pscustomobject]@{ volume = $volume; fileId = $fileId; directory = $isDirectory }
    } finally {
        [Array]::Clear($idBytes, 0, $idBytes.Length)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($identity); [Runtime.InteropServices.Marshal]::FreeHGlobal($standard)
    }
}

function Get-XRayPrivateCopyFixtureProof($Identity) {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Identity.volume + ':' + [string]$Identity.fileId)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function Get-XRayPrivateCopyCollisionSnapshot([string]$Kind, [IntPtr]$Parent, [string]$Component, [string]$TargetPath, [string]$ExternalPath) {
    $isDirectory = $Kind -in @('directory', 'link')
    $handle = [IntPtr]::Zero
    try {
        $handle = Open-XRayRelativeHandle $Parent $Component $isDirectory
        $identity = Get-XRayPrivateCopyFixtureIdentity $handle $isDirectory ($Kind -ceq 'link')
        if ($Kind -ceq 'file') {
            $payload = [IO.File]::ReadAllBytes($TargetPath)
        } elseif ($Kind -ceq 'directory') {
            $payload = [IO.File]::ReadAllBytes((Join-Path $TargetPath 'keep.bin'))
        } else {
            $payload = [IO.File]::ReadAllBytes((Join-Path $ExternalPath 'keep.bin'))
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $contentHash = ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace('-', '') }
        finally { [Array]::Clear($payload, 0, $payload.Length); $sha.Dispose() }
        return [pscustomobject]@{ kind = $Kind; identityProof = Get-XRayPrivateCopyFixtureProof $identity; contentHash = $contentHash }
    } finally {
        if ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
            if ((Invoke-XRayNative CloseHandle @($handle)) -eq 0) { throw 'FIXTURE_IDENTITY_CLOSE_FAILED' }
        }
    }
}

$portableSession = $null; $applicationSession = $null; $directorySession = $null; $sourceSession = $null; $copySession = $null
$copySummary = $null; $firstRelease = $null; $copyRelease = $null
$fixtureStage = 'setup'; $fixtureFailureStage = $null; $fixtureFailureCode = $null
$collisionBefore = $null; $collisionAfter = $null; $targetRenameBlocked = $null; $targetDeleteBlocked = $null
$m8BorrowedSessionStillHeld = $false; $sourceStillHeld = $false
$root = [IO.Path]::GetFullPath($RootPath)
$portablePath = Join-Path $root 'portable.bin'
$applicationPath = Join-Path $root 'application'
$sourcePath = Join-Path $root 'source.bin'
$outputParent = Join-Path $root 'output-parent'
$outputPath = Join-Path $outputParent 'private'
$externalPath = Join-Path $root 'link-target'
$component = 'xray-0123456789abcdef0123456789abcdef.sidecar'
$targetPath = Join-Path $outputPath $component
$script:xrayPrivateCopyComponent = $component

try {
    $fixtureStage = 'setup'
    [IO.Directory]::CreateDirectory($root) | Out-Null
    [IO.Directory]::CreateDirectory($applicationPath) | Out-Null
    [IO.Directory]::CreateDirectory($outputParent) | Out-Null
    $payload = $null
    if ($Mode -ceq 'empty') { $payload = [byte[]]::new(0) }
    elseif ($Mode -ceq 'unicode') { $payload = [Text.Encoding]::UTF8.GetBytes(([char]0x79C1).ToString() + ([char]0x6709).ToString() + ' evidence ' + [char]::ConvertFromUtf32(0x1F642)) }
    elseif ($Mode -ceq 'multiblock') { $payload = [byte[]]::new(2097169); for ($i = 0; $i -lt $payload.Length; $i++) { $payload[$i] = [byte](($i * 31 + 7) -band 0xff) } }
    elseif ($Mode -ceq 'over-32mib') { $payload = [byte[]]::new(33554433); for ($i = 0; $i -lt $payload.Length; $i += 4096) { $payload[$i] = [byte](($i -shr 12) -band 0xff) } }
    elseif ($Mode -in @('source-identity-change', 'target-identity-change', 'source-read-failure', 'source-short-read', 'write-failure', 'short-write', 'target-read-failure', 'target-short-read', 'target-eof-mismatch')) {
        $payload = [byte[]]::new(1048593); for ($i = 0; $i -lt $payload.Length; $i += 4096) { $payload[$i] = [byte](($i -shr 12) -band 0xff) }
    } else { $payload = [Text.Encoding]::UTF8.GetBytes('Project X-Ray private artifact copy fixture') }
    [IO.File]::WriteAllBytes($portablePath, [byte[]]@(0x58, 0x52, 0x41, 0x59, 0x01))
    [IO.File]::WriteAllBytes($sourcePath, $payload)
    $script:xrayPrivateCopyExpectedBytes = [long]$payload.LongLength

    $fixtureStage = 'open-portable'; $portableSession = Open-XRayArtifactSession $portablePath
    $fixtureStage = 'open-application'; $applicationSession = Open-XRayArtifactDirectorySession $applicationPath
    $fixtureStage = 'new-output-directory'; $directorySession = New-XRayPrivateArtifactOutputDirectory $outputPath $portableSession $applicationSession
    if (-not $directorySession.ready) { throw 'FIXTURE_DIRECTORY_NOT_READY' }
    $fixtureStage = 'open-source'; $sourceSession = Open-XRayArtifactSession $sourcePath
    $script:xrayPrivateCopySource = $sourceSession
    $script:xrayPrivateCopySourceHandle = [IntPtr]$sourceSession.leaf

    if ($Mode -ceq 'already-consumed') {
        $fixtureStage = 'consume-source-before-copy'
        $null = Get-XRayArtifactObservation $sourceSession
    }
    if ($Mode -in @('collision-file', 'collision-directory', 'collision-link')) {
        $fixtureStage = 'prepare-collision'
        if ($Mode -ceq 'collision-file') { [IO.File]::WriteAllBytes($targetPath, [byte[]]@(0x43, 0x4F, 0x4C, 0x4C, 0x49, 0x44, 0x45)) }
        elseif ($Mode -ceq 'collision-directory') {
            [IO.Directory]::CreateDirectory($targetPath) | Out-Null
            [IO.File]::WriteAllBytes((Join-Path $targetPath 'keep.bin'), [byte[]]@(0x4B, 0x45, 0x45, 0x50))
        } else {
            [IO.Directory]::CreateDirectory($externalPath) | Out-Null
            [IO.File]::WriteAllBytes((Join-Path $externalPath 'keep.bin'), [byte[]]@(0x4B, 0x45, 0x45, 0x50, 0x2D, 0x4C, 0x49, 0x4E, 0x4B))
            New-Item -ItemType Junction -Path $targetPath -Target $externalPath -ErrorAction Stop | Out-Null
        }
        $kind = if ($Mode -ceq 'collision-file') { 'file' } elseif ($Mode -ceq 'collision-directory') { 'directory' } else { 'link' }
        $collisionBefore = Get-XRayPrivateCopyCollisionSnapshot $kind $directorySession.createdHandle $component $targetPath $externalPath
    }

    $fixtureStage = 'copy'
    $copySession = New-XRayPrivateArtifactCopy $sourceSession $directorySession
    $copySummary = Get-XRayPrivateArtifactCopySummary $copySession
    if ($copySummary.ready -and $Mode -in @('ordinary', 'empty', 'unicode', 'multiblock', 'over-32mib', 'close-failure')) {
        $fixtureStage = 'probe-held-target'
        $entry = Find-XRayPrivateCopySession $copySession
        $target = [string]$entry.state.token
        $targetRenameBlocked = $false; $targetDeleteBlocked = $false
        try { [IO.File]::Move($targetPath, $targetPath + '.moved') }
        catch { $targetRenameBlocked = $true }
        if ([IO.File]::Exists($targetPath)) {
            try { [IO.File]::Delete($targetPath) }
            catch { $targetDeleteBlocked = $true }
        } else { $targetDeleteBlocked = $true }
        $fileEntry = Find-XRayOutputFileSession $entry.state.outputFileSession
        $fileState = $fileEntry.state
        $script:xrayPrivateCopyTargetHandle = [IntPtr]$fileState.handle
        $aclEvidence = [pscustomobject]@{
            aclVerified = [bool]$fileState.aclVerified; ownerVerified = [bool]$fileState.ownerVerified
            daclPresent = [bool]$fileState.daclPresent; daclProtected = [bool]$fileState.daclProtected; aceCount = [int]$fileState.aclAceCount
        }
    } else { $aclEvidence = [pscustomobject]@{ aclVerified = $false; ownerVerified = $false; daclPresent = $false; daclProtected = $false; aceCount = 0 } }

    $fixtureStage = 'close-copy'
    if ($null -ne $copySession) {
        $firstRelease = Close-XRayPrivateArtifactCopy $copySession
        if ($Mode -ceq 'close-failure' -and $firstRelease.releaseStatus -ceq 'unconfirmed') {
            $fixtureStage = 'retry-close-copy'
            $copyRelease = Close-XRayPrivateArtifactCopy $copySession
        } else { $copyRelease = $firstRelease }
    }
    $sourceStillHeld = ($null -ne $sourceSession -and -not $sourceSession.released -and
        $sourceSession.handles.Count -gt 0 -and [IntPtr]$sourceSession.handles[$sourceSession.handles.Count - 1] -eq [IntPtr]$sourceSession.leaf)
    $m8BorrowedSessionStillHeld = ($null -ne $directorySession -and $directorySession.ready -and
        -not $directorySession.released -and $directorySession.handles.Count -eq $directorySession.registeredHandleCount -and
        $directorySession.createdHandle -ne [IntPtr]::Zero)
    if ($null -ne $collisionBefore) {
        $fixtureStage = 'verify-collision'
        $collisionAfter = Get-XRayPrivateCopyCollisionSnapshot $collisionBefore.kind $directorySession.createdHandle $component $targetPath $externalPath
    }
} catch {
    $fixtureFailureStage = $fixtureStage; $fixtureFailureCode = 'FIXTURE_OPERATION_FAILED'
} finally {
    if ($null -ne $copySession -and $null -eq $copyRelease) { try { $copyRelease = Close-XRayPrivateArtifactCopy $copySession } catch { } }
    if ($null -ne $sourceSession) { try { $null = Close-XRayArtifactSession $sourceSession } catch { } }
    if ($null -ne $directorySession) { try { $null = Close-XRayPrivateArtifactOutputDirectory $directorySession } catch { } }
    if ($null -ne $applicationSession) { try { $null = Close-XRayArtifactSession $applicationSession } catch { } }
    if ($null -ne $portableSession) { try { $null = Close-XRayArtifactSession $portableSession } catch { } }
}

$result = [pscustomobject]@{
    version = 1; mode = $Mode; fixtureFailureStage = $fixtureFailureStage; fixtureFailureCode = $fixtureFailureCode
    attempted = ($null -ne $copySession); faultReached = [bool]$script:xrayPrivateCopyFaultReached; faultStage = $script:xrayPrivateCopyFaultStage
    copySummary = $copySummary; firstRelease = $firstRelease; copyRelease = $copyRelease
    sourceStillHeldAfterCopyClose = [bool]$sourceStillHeld; m8BorrowedSessionStillHeldAfterCopyClose = [bool]$m8BorrowedSessionStillHeld
    targetRenameBlocked = $targetRenameBlocked; targetDeleteBlocked = $targetDeleteBlocked
    targetAcl = $aclEvidence; collisionBefore = $collisionBefore; collisionAfter = $collisionAfter
}
ConvertTo-Json -InputObject $result -Compress -Depth 6
