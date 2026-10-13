param(
    [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'empty', 'unicode', 'multiblock', 'over-32mib',
        'clone-session', 'released-session', 'not-ready', 'target-identity-change', 'target-length-change', 'target-metadata-change',
        'source-identity-change', 'directory-identity-change', 'owner-reference-change', 'read-failure',
        'short-read', 'over-count', 'eof-mismatch', 'seek-failure', 'hash-mismatch', 'read-failure-close-retry')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$RootPath
)

$ErrorActionPreference = 'Stop'
$script:xrayM11Mode = $Mode
$script:xrayM11Phase = 'setup'
$script:xrayM11FaultReached = $false
$script:xrayM11FaultStage = $null
$script:xrayM11CloseRetryReached = $false
$script:xrayM11CloseFaultUsed = $false
$script:xrayM11CloseFaultStage = $null
$script:xrayM11ExpectedBytes = [long]0
$script:xrayM11TargetHandle = [IntPtr]::Zero
$script:xrayM11CopySession = $null
$script:xrayM11SourceHandle = [IntPtr]::Zero
$script:xrayM11DirectoryHandle = [IntPtr]::Zero
$script:xrayM11TargetPosition = [long]0
$script:xrayM11VerifyReadCalls = 0
$script:xrayM11SourceReadCalls = 0
$script:xrayM11SourceSeekCalls = 0
$script:xrayM11CoreMetadata = $null
$script:xrayM11CoreOutputNative = $null

. (Join-Path $PSScriptRoot '..\windows-artifact-handle-bridge.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-directory-observation.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-directory.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-file.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-private-copy.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-copy-reverification.ps1')

$script:xrayM11CoreMetadata = (Get-Command Get-XRayHandleMetadata -CommandType Function).ScriptBlock
$script:xrayM11CoreM4Native = (Get-Command Invoke-XRayNative -CommandType Function).ScriptBlock
$script:xrayM11CoreOutputNative = (Get-Command Invoke-XRayOutputFileNativeCore -CommandType Function).ScriptBlock

# Fixture-only deterministic token and fault injection around fixed native calls.
function New-XRayOutputFileToken { return '0123456789abcdef0123456789abcdef' }

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    $metadata = & $script:xrayM11CoreMetadata $Handle $Directory
    if ($script:xrayM11Phase -ceq 'verify' -and $Handle -eq $script:xrayM11TargetHandle -and -not $Directory) {
        if ($script:xrayM11Mode -ceq 'target-identity-change') {
            $metadata.fileId = '00000000000000000000000000000004'
            if (-not $script:xrayM11FaultReached) { $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-identity-recheck' }
        } elseif ($script:xrayM11Mode -ceq 'target-length-change') {
            $metadata.length = [long]$metadata.length + 1
            if (-not $script:xrayM11FaultReached) { $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-length-recheck' }
        } elseif ($script:xrayM11Mode -ceq 'target-metadata-change') {
            $metadata.write = [long]$metadata.write + 1
            if (-not $script:xrayM11FaultReached) { $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-full-metadata-recheck' }
        }
    }
    if ($script:xrayM11Phase -ceq 'verify' -and $Handle -eq $script:xrayM11SourceHandle -and -not $Directory -and
        $script:xrayM11Mode -ceq 'source-identity-change') {
        $metadata.change = [long]$metadata.change + 1
        if (-not $script:xrayM11FaultReached) { $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'source-identity-recheck' }
    }
    if ($script:xrayM11Phase -ceq 'verify' -and $Handle -eq $script:xrayM11DirectoryHandle -and $Directory -and
        $script:xrayM11Mode -ceq 'directory-identity-change') {
        $metadata.fileId = '00000000000000000000000000000005'
        if (-not $script:xrayM11FaultReached) { $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'directory-identity-recheck' }
    }
    return $metadata
}

function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
    if ($script:xrayM11Phase -ceq 'verify' -and [IntPtr]$Arguments[0] -eq $script:xrayM11SourceHandle) {
        if ($Name -ceq 'ReadFile') { $script:xrayM11SourceReadCalls++ }
        if ($Name -ceq 'SetFilePointerEx') { $script:xrayM11SourceSeekCalls++ }
    }
    return (& $script:xrayM11CoreM4Native $Name $Arguments)
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    if ($Name -ceq 'NtCreateFile') {
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        $handle = [IntPtr]$Arguments[0]
        if ($result -ge 0 -and $handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
            $script:xrayM11TargetHandle = $handle
        }
        return $result
    }
    if ($Name -ceq 'CloseHandle' -and $script:xrayM11Phase -ceq 'close' -and
        $script:xrayM11Mode -ceq 'read-failure-close-retry' -and -not $script:xrayM11CloseFaultUsed) {
        $script:xrayM11CloseFaultUsed = $true; $script:xrayM11CloseRetryReached = $true
        $script:xrayM11CloseFaultStage = 'first-close-unconfirmed'
        return [int]0
    }
    if ($script:xrayM11Phase -ceq 'verify' -and [IntPtr]$Arguments[0] -eq $script:xrayM11TargetHandle) {
        if ($Name -ceq 'SetFilePointerEx') {
            if ($script:xrayM11Mode -ceq 'seek-failure') {
                $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-seek'
                return [int]0
            }
            $result = & $script:xrayM11CoreOutputNative $Name $Arguments
            if ($result -ne 0) { $script:xrayM11TargetPosition = [long]$Arguments[1] }
            return $result
        }
        if ($Name -ceq 'ReadFile') {
            $script:xrayM11VerifyReadCalls++
            if ($script:xrayM11Mode -in @('read-failure', 'read-failure-close-retry') -and $script:xrayM11VerifyReadCalls -eq 1) {
                $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-read'
                $Arguments[3] = [uint32]0
                return [int]0
            }
            if ($script:xrayM11TargetPosition -ge $script:xrayM11ExpectedBytes) {
                if ($script:xrayM11Mode -ceq 'eof-mismatch') {
                    $Arguments[3] = [uint32]1
                    $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-eof'
                } else { $Arguments[3] = [uint32]0 }
                return [int]1
            }
            if ($script:xrayM11Mode -ceq 'over-count' -and $script:xrayM11VerifyReadCalls -eq 1) {
                $Arguments[3] = [uint32]$Arguments[2] + [uint32]1
                $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-read-count'
                return [int]1
            }
            if ($script:xrayM11Mode -ceq 'short-read' -and $script:xrayM11VerifyReadCalls -eq 1) {
                $requested = [uint32]$Arguments[2]
                if ($requested -le 1) { $Arguments[3] = [uint32]0; return [int]1 }
                $Arguments[2] = [uint32]($requested - 1)
                try {
                    $result = & $script:xrayM11CoreOutputNative $Name $Arguments
                    if ($result -ne 0) { $script:xrayM11TargetPosition += [long][uint32]$Arguments[3] }
                    $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'target-short-read'
                    return $result
                } finally { $Arguments[2] = $requested }
            }
            $result = & $script:xrayM11CoreOutputNative $Name $Arguments
            $actual = [uint32]$Arguments[3]
            if ($result -ne 0) { $script:xrayM11TargetPosition += [long]$actual }
            if ($script:xrayM11Mode -ceq 'hash-mismatch' -and $script:xrayM11VerifyReadCalls -eq 1 -and $actual -gt 0) {
                $first = [Runtime.InteropServices.Marshal]::ReadByte([IntPtr]$Arguments[1], 0)
                [Runtime.InteropServices.Marshal]::WriteByte([IntPtr]$Arguments[1], 0, [byte]($first -bxor 1))
                $script:xrayM11FaultReached = $true
                $script:xrayM11FaultStage = 'target-read-buffer-hash-mismatch-not-file-write'
            }
            if ($script:xrayM11Mode -ceq 'owner-reference-change' -and $script:xrayM11VerifyReadCalls -eq 1) {
                $entry = Find-XRayPrivateCopySession $script:xrayM11CopySession
                $entry.state.outputFileEntry = [pscustomobject]@{
                    session = $entry.state.outputFileSession; state = $entry.state.outputFileState
                }
                $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'owner-reference-recheck'
            }
            return $result
        }
    }
    return (& $script:xrayM11CoreOutputNative $Name $Arguments)
}

$portableSession = $null; $applicationSession = $null; $directorySession = $null; $sourceSession = $null; $copySession = $null
$firstVerification = $null; $secondVerification = $null; $cloneVerification = $null; $unconfirmedVerification = $null
$readsBeforeUnconfirmedVerify = $null; $readsAfterUnconfirmedVerify = $null
$firstRelease = $null; $copyRelease = $null; $copySummaryBefore = $null; $copySummaryAfter = $null
$fixtureStage = 'setup'; $fixtureFailureStage = $null; $fixtureFailureCode = $null
$sourceStillHeldAfterCopyClose = $false; $directoryStillHeldAfterCopyClose = $false
$m9ReadyAfterVerification = $false; $m10ReadyAfterVerification = $false
$root = [IO.Path]::GetFullPath($RootPath)
$portablePath = Join-Path $root 'portable.bin'
$applicationPath = Join-Path $root 'application'
$sourcePath = Join-Path $root 'source.bin'
$outputParent = Join-Path $root 'output-parent'
$outputPath = Join-Path $outputParent 'private'
$script:xrayM11Component = 'xray-0123456789abcdef0123456789abcdef.sidecar'

try {
    $fixtureStage = 'setup'
    [IO.Directory]::CreateDirectory($root) | Out-Null
    [IO.Directory]::CreateDirectory($applicationPath) | Out-Null
    [IO.Directory]::CreateDirectory($outputParent) | Out-Null
    if ($Mode -ceq 'empty') { $payload = [byte[]]::new(0) }
    elseif ($Mode -ceq 'unicode') {
        $payload = [Text.Encoding]::UTF8.GetBytes(([char]0x79C1).ToString() + ([char]0x6709).ToString() + ' evidence ' + [char]::ConvertFromUtf32(0x1F642))
    } elseif ($Mode -ceq 'multiblock') {
        $payload = [byte[]]::new(2097169); for ($i = 0; $i -lt $payload.Length; $i++) { $payload[$i] = [byte](($i * 31 + 7) -band 0xff) }
    } elseif ($Mode -ceq 'over-32mib') {
        $payload = [byte[]]::new(33554433); for ($i = 0; $i -lt $payload.Length; $i += 4096) { $payload[$i] = [byte](($i -shr 12) -band 0xff) }
    } elseif ($Mode -in @('target-identity-change', 'target-length-change', 'target-metadata-change', 'source-identity-change', 'directory-identity-change',
        'owner-reference-change', 'read-failure', 'short-read', 'over-count', 'eof-mismatch', 'seek-failure', 'hash-mismatch', 'read-failure-close-retry')) {
        $payload = [byte[]]::new(1048593); for ($i = 0; $i -lt $payload.Length; $i += 4096) { $payload[$i] = [byte](($i -shr 12) -band 0xff) }
    } else { $payload = [Text.Encoding]::UTF8.GetBytes('Project X-Ray M11 private-copy re-verification fixture') }
    [IO.File]::WriteAllBytes($portablePath, [byte[]]@(0x58, 0x52, 0x41, 0x59, 0x01))
    [IO.File]::WriteAllBytes($sourcePath, $payload)
    $script:xrayM11ExpectedBytes = [long]$payload.LongLength

    $fixtureStage = 'open-portable'; $portableSession = Open-XRayArtifactSession $portablePath
    $fixtureStage = 'open-application'; $applicationSession = Open-XRayArtifactDirectorySession $applicationPath
    $fixtureStage = 'new-output-directory'; $directorySession = New-XRayPrivateArtifactOutputDirectory $outputPath $portableSession $applicationSession
    if (-not $directorySession.ready) { throw 'M11_FIXTURE_DIRECTORY_NOT_READY' }
    $script:xrayM11DirectoryHandle = [IntPtr]$directorySession.createdHandle
    $fixtureStage = 'open-source'; $sourceSession = Open-XRayArtifactSession $sourcePath
    $script:xrayM11SourceHandle = [IntPtr]$sourceSession.leaf

    $fixtureStage = 'copy'; $copySession = New-XRayPrivateArtifactCopy $sourceSession $directorySession
    $script:xrayM11CopySession = $copySession
    $copySummaryBefore = Get-XRayPrivateArtifactCopySummary $copySession
    if (-not $copySummaryBefore.ready -or -not $copySummaryBefore.created -or
        $copySummaryBefore.bytesRequested -ne $script:xrayM11ExpectedBytes) { throw 'M11_FIXTURE_COPY_NOT_READY' }
    $entry = Find-XRayPrivateCopySession $copySession
    $script:xrayM11TargetHandle = [IntPtr]$entry.state.outputFileState.handle
    if ($script:xrayM11TargetHandle -eq [IntPtr]::Zero -or $script:xrayM11TargetHandle -eq [IntPtr](-1)) {
        throw 'M11_FIXTURE_TARGET_HANDLE_UNAVAILABLE'
    }

    $fixtureStage = 'verify'; $script:xrayM11Phase = 'verify'
    if ($Mode -ceq 'clone-session') {
        $clone = [pscustomobject]@{ version = $copySession.version; token = $copySession.token }
        $cloneVerification = Test-XRayPrivateArtifactCopyReverification $clone
        $m10ReadyAfterClone = [bool]$entry.state.ready
        $m9ReadyAfterClone = [bool]$entry.state.outputFileState.ready
        $firstVerification = Test-XRayPrivateArtifactCopyReverification $copySession
        if (-not $m10ReadyAfterClone -or -not $m9ReadyAfterClone) { throw 'M11_FIXTURE_CLONE_REVOKED_OWNER' }
    } elseif ($Mode -ceq 'released-session') {
        $script:xrayM11Phase = 'close'
        $firstRelease = Close-XRayPrivateArtifactCopy $copySession
        $script:xrayM11Phase = 'verify'
        $firstVerification = Test-XRayPrivateArtifactCopyReverification $copySession
    } else {
        if ($Mode -ceq 'not-ready') {
            $entry.state.ready = $false
            $script:xrayM11FaultReached = $true; $script:xrayM11FaultStage = 'owner-ready-flag-after-copy-ready'
        }
        $firstVerification = Test-XRayPrivateArtifactCopyReverification $copySession
        if ($Mode -ceq 'owner-reference-change') { $entry.state.outputFileEntry = Find-XRayOutputFileSession $entry.state.outputFileSession }
        if ($Mode -in @('ordinary', 'empty', 'unicode', 'multiblock', 'over-32mib')) {
            $secondVerification = Test-XRayPrivateArtifactCopyReverification $copySession
        }
    }
    $m10ReadyAfterVerification = [bool]$entry.state.ready
    $m9ReadyAfterVerification = [bool]$entry.state.outputFileState.ready
    $copySummaryAfter = Get-XRayPrivateArtifactCopySummary $copySession

    if ($null -eq $firstRelease) {
        $fixtureStage = 'close-copy'; $script:xrayM11Phase = 'close'
        $firstRelease = Close-XRayPrivateArtifactCopy $copySession
        if ($script:xrayM11CloseRetryReached -and $firstRelease.releaseStatus -ceq 'unconfirmed') {
            $fixtureStage = 'reject-unconfirmed-owner'; $script:xrayM11Phase = 'verify'
            $readsBeforeUnconfirmedVerify = $script:xrayM11VerifyReadCalls
            $unconfirmedVerification = Test-XRayPrivateArtifactCopyReverification $copySession
            $readsAfterUnconfirmedVerify = $script:xrayM11VerifyReadCalls
            $script:xrayM11Phase = 'close'
            $fixtureStage = 'retry-close-copy'
            $copyRelease = Close-XRayPrivateArtifactCopy $copySession
        } else { $copyRelease = $firstRelease }
    } else { $copyRelease = $firstRelease }
    $sourceStillHeldAfterCopyClose = ($null -ne $sourceSession -and -not $sourceSession.released -and
        $sourceSession.handles.Count -gt 0 -and [IntPtr]$sourceSession.handles[$sourceSession.handles.Count - 1] -eq $sourceSession.leaf)
    $directoryStillHeldAfterCopyClose = ($null -ne $directorySession -and $directorySession.ready -and
        -not $directorySession.released -and $directorySession.handles.Count -eq $directorySession.registeredHandleCount -and
        $directorySession.createdHandle -ne [IntPtr]::Zero)
} catch {
    $fixtureFailureStage = $fixtureStage; $fixtureFailureCode = 'M11_FIXTURE_OPERATION_FAILED'
} finally {
    $script:xrayM11Phase = 'cleanup'
    if ($null -ne $copySession -and $null -eq $copyRelease) {
        try { $copyRelease = Close-XRayPrivateArtifactCopy $copySession } catch { }
    }
    if ($null -ne $sourceSession) { try { $null = Close-XRayArtifactSession $sourceSession } catch { } }
    if ($null -ne $directorySession) { try { $null = Close-XRayPrivateArtifactOutputDirectory $directorySession } catch { } }
    if ($null -ne $applicationSession) { try { $null = Close-XRayArtifactSession $applicationSession } catch { } }
    if ($null -ne $portableSession) { try { $null = Close-XRayArtifactSession $portableSession } catch { } }
}

$result = [pscustomobject]@{
    version = 1; mode = $Mode; fixtureFailureStage = $fixtureFailureStage; fixtureFailureCode = $fixtureFailureCode
    attempted = ($null -ne $copySession); copyReadyBeforeVerification = [bool]$copySummaryBefore.ready
    copySummaryBefore = $copySummaryBefore; firstVerification = $firstVerification; secondVerification = $secondVerification
    cloneVerification = $cloneVerification; unconfirmedVerification = $unconfirmedVerification
    readsBeforeUnconfirmedVerify = $readsBeforeUnconfirmedVerify; readsAfterUnconfirmedVerify = $readsAfterUnconfirmedVerify
    copySummaryAfterVerification = $copySummaryAfter
    firstRelease = $firstRelease; copyRelease = $copyRelease
    m10ReadyAfterVerification = [bool]$m10ReadyAfterVerification; m9ReadyAfterVerification = [bool]$m9ReadyAfterVerification
    m10ReadyAfterClone = [bool]$m10ReadyAfterClone; m9ReadyAfterClone = [bool]$m9ReadyAfterClone
    faultReached = [bool]$script:xrayM11FaultReached; faultStage = $script:xrayM11FaultStage
    closeRetryReached = [bool]$script:xrayM11CloseRetryReached
    closeFaultStage = $script:xrayM11CloseFaultStage
    sourceReadCallsDuringVerification = [int]$script:xrayM11SourceReadCalls
    sourceSeekCallsDuringVerification = [int]$script:xrayM11SourceSeekCalls
    sourceStillHeldAfterCopyClose = [bool]$sourceStillHeldAfterCopyClose
    m8BorrowedSessionStillHeldAfterCopyClose = [bool]$directoryStillHeldAfterCopyClose
}
ConvertTo-Json -InputObject $result -Compress -Depth 6
