param(
    [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'multi-block-header', 'clone-session', 'foreign-m9',
        'late-m9-replacement', 'failed-owner', 'released-owner', 'unready-owner', 'empty-archive', 'invalid-prefix',
        'zero-header', 'short-header', 'negative-header', 'oversized-header', 'unaligned-header', 'out-of-bounds', 'negative-archive-length',
        'oversized-archive', 'seek-failure', 'read-failure-size', 'short-read-size', 'zero-read-size',
        'over-count-size', 'read-failure-header', 'short-read-header', 'over-count-header',
        'm11-before-failure', 'm11-after-failure', 'source-change', 'directory-change',
        'target-metadata-change', 'close-retry')][string]$Mode
)

$ErrorActionPreference = 'Stop'
$script:xrayM13Mode = $Mode
$script:xrayM13Phase = 'setup'
$script:xrayM13Position = [long]0
$script:xrayM13ReverificationCalls = 0
$script:xrayM13CaptureReadCalls = 0
$script:xrayM13SourceChecks = 0
$script:xrayM13DirectoryChecks = 0
$script:xrayM13MetadataCalls = 0
$script:xrayM13CloseCalls = 0
$script:xrayM13CloseFaultUsed = $false
$script:xrayM13FaultReached = $false
$script:xrayM13FaultStage = $null
$script:xrayM13ReplacementState = $null
$script:xrayM13ForeignState = $null
$script:xrayM13TargetHandle = [IntPtr]4321

. (Join-Path $PSScriptRoot '..\windows-artifact-handle-bridge.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-directory-observation.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-directory.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-file.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-private-copy.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-copy-reverification.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-asar-header-capture.ps1')

$script:xrayM13CoreReverification = (Get-Command Test-XRayPrivateArtifactCopyReverification -CommandType Function).ScriptBlock

function New-XRayOutputFileToken { return '0123456789abcdef0123456789abcdef' }

function Test-XRayM13ByteArraysEqual([byte[]]$Left, [byte[]]$Right) {
    if ($null -eq $Left -or $null -eq $Right -or $Left.Length -ne $Right.Length) { return $false }
    for ($index = 0; $index -lt $Left.Length; $index++) { if ($Left[$index] -ne $Right[$index]) { return $false } }
    return $true
}

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    if ($Handle -ne $script:xrayM13TargetHandle -or $Directory) { throw 'TEST_UNEXPECTED_METADATA_REQUEST' }
    $script:xrayM13MetadataCalls++
    $metadata = New-XRayPrivateCopyMetadataSnapshot $script:xrayM13Metadata
    if ($script:xrayM13Phase -ceq 'capture' -and $script:xrayM13Mode -ceq 'target-metadata-change' -and
        $script:xrayM13CaptureReadCalls -ge 1) { $metadata.write = [long]$metadata.write + 1 }
    return $metadata
}

function Assert-XRayPrivateCopySourceStable($Snapshot, [bool]$Consumed) {
    $script:xrayM13SourceChecks++
    if (-not $Consumed -or -not [object]::ReferenceEquals($Snapshot, $script:xrayM13SourceSnapshot)) {
        throw 'PRIVATE_COPY_SOURCE_CHANGED'
    }
    if ($script:xrayM13Phase -ceq 'capture' -and $script:xrayM13Mode -ceq 'source-change' -and
        $script:xrayM13CaptureReadCalls -ge 1) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    return $script:xrayM13Metadata
}

function Assert-XRayOutputFileDirectoryStable($DirectorySession, $SavedDirectory) {
    $script:xrayM13DirectoryChecks++
    if (-not [object]::ReferenceEquals($DirectorySession, $script:xrayM13Directory) -or
        -not [object]::ReferenceEquals($SavedDirectory, $script:xrayM13DirectoryIdentity)) { throw 'OUTPUT_FILE_DIRECTORY_CHANGED' }
    if ($script:xrayM13Phase -ceq 'capture' -and $script:xrayM13Mode -ceq 'directory-change' -and
        $script:xrayM13CaptureReadCalls -ge 1) { throw 'OUTPUT_FILE_DIRECTORY_CHANGED' }
    return $SavedDirectory
}

function Test-XRayPrivateArtifactCopyReverification($Session) {
    $script:xrayM13ReverificationCalls++
    if ($script:xrayM13ReverificationCalls -eq 1) { $script:xrayM13Phase = 'before-reverify' }
    else { $script:xrayM13Phase = 'after-reverify' }
    $result = & $script:xrayM13CoreReverification $Session
    if (($script:xrayM13Mode -ceq 'm11-before-failure' -and $script:xrayM13ReverificationCalls -eq 1) -or
        ($script:xrayM13Mode -ceq 'm11-after-failure' -and $script:xrayM13ReverificationCalls -eq 2)) {
        $result.status = 'rejected'; $result.failureCode = 'COPY_REVERIFY_CONTENT_MISMATCH'
        $script:xrayM13FaultReached = $true
        $script:xrayM13FaultStage = if ($script:xrayM13ReverificationCalls -eq 1) { 'before-reverify' } else { 'after-reverify' }
    }
    $script:xrayM13Phase = 'capture'
    return ,$result
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    if ($Name -ceq 'SetFilePointerEx') {
        if ($Arguments.Count -ne 4 -or [IntPtr]$Arguments[0] -ne $script:xrayM13TargetHandle -or
            [int64]$Arguments[1] -ne 0 -or $Arguments[2] -ne [IntPtr]::Zero -or [uint32]$Arguments[3] -ne 0) {
            throw 'TEST_UNEXPECTED_SEEK'
        }
        if ($script:xrayM13Phase -ceq 'capture' -and $script:xrayM13Mode -ceq 'seek-failure') {
            $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'target-seek'; return [int]0
        }
        $script:xrayM13Position = [long]0
        return [int]1
    }
    if ($Name -ceq 'CloseHandle') {
        $script:xrayM13CloseCalls++
        if ($script:xrayM13Mode -ceq 'close-retry' -and -not $script:xrayM13CloseFaultUsed) {
            $script:xrayM13CloseFaultUsed = $true; return [int]0
        }
        return [int]1
    }
    if ($Name -ceq 'ReadFile') {
        if ($Arguments.Count -ne 5 -or [IntPtr]$Arguments[0] -ne $script:xrayM13TargetHandle) { throw 'TEST_UNEXPECTED_READ' }
        $requested = [int]$Arguments[2]
        if ($script:xrayM13Phase -ceq 'capture') {
            $script:xrayM13CaptureReadCalls++
            $captureCall = $script:xrayM13CaptureReadCalls
            if ($captureCall -eq 1 -and $script:xrayM13Mode -ceq 'read-failure-size') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'size-read'; $Arguments[3] = [uint32]0; return [int]0
            }
            if ($captureCall -eq 1 -and $script:xrayM13Mode -ceq 'short-read-size') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'size-short-read'
                [Runtime.InteropServices.Marshal]::Copy($script:xrayM13Archive, [int]$script:xrayM13Position, [IntPtr]$Arguments[1], $requested - 1)
                $script:xrayM13Position += $requested - 1; $Arguments[3] = [uint32]($requested - 1); return [int]1
            }
            if ($captureCall -eq 1 -and $script:xrayM13Mode -ceq 'zero-read-size') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'size-zero-read'; $Arguments[3] = [uint32]0; return [int]1
            }
            if ($captureCall -eq 1 -and $script:xrayM13Mode -ceq 'over-count-size') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'size-over-count'; $Arguments[3] = [uint32]($requested + 1); return [int]1
            }
            if ($captureCall -eq 2 -and $script:xrayM13Mode -ceq 'read-failure-header') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'header-read'; $Arguments[3] = [uint32]0; return [int]0
            }
            if ($captureCall -eq 2 -and $script:xrayM13Mode -ceq 'short-read-header') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'header-short-read'
                [Runtime.InteropServices.Marshal]::Copy($script:xrayM13Archive, [int]$script:xrayM13Position, [IntPtr]$Arguments[1], $requested - 1)
                $script:xrayM13Position += $requested - 1; $Arguments[3] = [uint32]($requested - 1); return [int]1
            }
            if ($captureCall -eq 2 -and $script:xrayM13Mode -ceq 'over-count-header') {
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'header-over-count'; $Arguments[3] = [uint32]($requested + 1); return [int]1
            }
            if ($captureCall -eq 1 -and $script:xrayM13Mode -ceq 'late-m9-replacement') {
                $script:xrayM13ReplacementState = [pscustomobject]@{ status = 'ready'; ready = $true; owner = 'replacement' }
                $script:xrayM13FileEntry.state = $script:xrayM13ReplacementState
                $script:xrayM13FaultReached = $true; $script:xrayM13FaultStage = 'm9-state-replacement'
            }
        } else {
            $script:xrayM13ReverificationReadCalls++
        }
        $remaining = [long]$script:xrayM13Archive.LongLength - $script:xrayM13Position
        if ($remaining -le 0) { $Arguments[3] = [uint32]0; return [int]1 }
        $actual = [int][Math]::Min([long]$requested, $remaining)
        [Runtime.InteropServices.Marshal]::Copy($script:xrayM13Archive, [int]$script:xrayM13Position, [IntPtr]$Arguments[1], $actual)
        $script:xrayM13Position += $actual
        $Arguments[3] = [uint32]$actual
        return [int]1
    }
    throw 'TEST_UNEXPECTED_NATIVE_OPERATION'
}

function New-XRayM13Archive([int]$HeaderLength) {
    $header = [byte[]]::new($HeaderLength)
    if ($HeaderLength -eq 12) {
        [BitConverter]::GetBytes([uint32]8).CopyTo($header, 0)
        [BitConverter]::GetBytes([uint32]2).CopyTo($header, 4)
        $header[8] = 0x7B; $header[9] = 0x7D
    }
    $archive = [byte[]]::new(8 + $HeaderLength + 3)
    [BitConverter]::GetBytes([uint32]4).CopyTo($archive, 0)
    [BitConverter]::GetBytes([uint32]$HeaderLength).CopyTo($archive, 4)
    [Array]::Copy($header, 0, $archive, 8, $HeaderLength)
    $archive[8 + $HeaderLength] = 0x50; $archive[9 + $HeaderLength] = 0x4B; $archive[10 + $HeaderLength] = 0x44
    return ,$archive
}

$headerLength = if ($Mode -ceq 'multi-block-header') { 1048580 } else { 12 }
$script:xrayM13Archive = New-XRayM13Archive $headerLength
if ($Mode -ceq 'invalid-prefix') { [BitConverter]::GetBytes([uint32]8).CopyTo($script:xrayM13Archive, 0) }
if ($Mode -ceq 'zero-header') { [BitConverter]::GetBytes([uint32]0).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'short-header') { [BitConverter]::GetBytes([uint32]8).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'negative-header') { [BitConverter]::GetBytes([uint32]4294967295).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'oversized-header') { [BitConverter]::GetBytes([uint32]8388612).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'unaligned-header') { [BitConverter]::GetBytes([uint32]13).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'out-of-bounds') { [BitConverter]::GetBytes([uint32]16).CopyTo($script:xrayM13Archive, 4) }
if ($Mode -ceq 'empty-archive') { $script:xrayM13Archive = [byte[]]::new(0) }

$script:xrayM13Source = [pscustomobject]@{ held = $true; bytesRead = [long]$script:xrayM13Archive.LongLength; seekCalls = 0; readCalls = 0 }
$script:xrayM13SourceSnapshot = [pscustomobject]@{ session = $script:xrayM13Source }
$script:xrayM13Directory = [pscustomobject]@{ held = $true }
$script:xrayM13DirectoryIdentity = [pscustomobject]@{
    handle = [IntPtr]8765; volume = '0000000000000001'; fileId = '00000000000000000000000000000002'; directory = $true
}
$script:xrayM13Metadata = [pscustomobject]@{
    volume = '0000000000000001'; fileId = '00000000000000000000000000000003'; directory = $false
    attributes = [int]128; length = [long]$script:xrayM13Archive.LongLength; allocation = [long]4096
    links = [int]1; creation = [long]101; write = [long]102; change = [long]103
}
$script:xrayM13Sha = [Security.Cryptography.SHA256]::Create()
$script:xrayM13Digest = ([BitConverter]::ToString($script:xrayM13Sha.ComputeHash($script:xrayM13Archive))).Replace('-', '')
$script:xrayM13Sha.Dispose()
$script:xrayM13Handles = [Collections.Generic.List[System.IntPtr]]::new()
$script:xrayM13Handles.Add($script:xrayM13TargetHandle)
$script:xrayM13FileState = [pscustomobject]@{
    token = 'm9-private'; status = 'ready'; ready = $true; created = $true; failureCode = $null
    releaseStatus = 'held'; releaseFailureCode = $null; released = $false
    bytesRequested = [long]$script:xrayM13Archive.LongLength; bytesWritten = [long]$script:xrayM13Archive.LongLength
    bytesRead = [long]$script:xrayM13Archive.LongLength; inputSha256 = $script:xrayM13Digest; readbackSha256 = $script:xrayM13Digest
    identityProof = Get-XRayOutputFileIdentityProof $script:xrayM13Metadata; createdIdentity = $script:xrayM13Metadata
    directoryIdentity = $script:xrayM13DirectoryIdentity; handle = $script:xrayM13TargetHandle; handles = $script:xrayM13Handles
}
$script:xrayM13FileSession = [pscustomobject]@{ version = 1; token = 'file-session' }
$script:xrayM13FileEntry = [pscustomobject]@{ session = $script:xrayM13FileSession; state = $script:xrayM13FileState }
$script:XRayOutputFileOwnedSessions = [Collections.Generic.List[object]]::new()
$script:XRayOutputFileOwnedSessions.Add($script:xrayM13FileEntry)
$script:xrayM13OwnerState = [pscustomobject]@{
    status = 'ready'; ready = $true; created = $true; failureCode = $null; releaseStatus = 'held'; releaseFailureCode = $null
    released = $false; sourceConsumed = $true; bytesRequested = [long]$script:xrayM13Archive.LongLength
    sourceBytesRead = [long]$script:xrayM13Archive.LongLength; bytesWritten = [long]$script:xrayM13Archive.LongLength
    copyBytesRead = [long]$script:xrayM13Archive.LongLength; sourceSha256 = $script:xrayM13Digest; copySha256 = $script:xrayM13Digest
    sourceIdentityProof = ('A' * 64); outputIdentityProof = $script:xrayM13FileState.identityProof
    sourceSession = $script:xrayM13Source; sourceSnapshot = $script:xrayM13SourceSnapshot
    directorySession = $script:xrayM13Directory; directoryIdentity = $script:xrayM13DirectoryIdentity
    outputFileSession = $script:xrayM13FileSession; outputFileEntry = $script:xrayM13FileEntry; outputFileState = $script:xrayM13FileState
}
$script:xrayM13Public = [pscustomobject]@{ version = 1; token = 'mutated-public-token' }
$script:xrayM13OwnerEntry = Register-XRayPrivateCopySession $script:xrayM13Public $script:xrayM13OwnerState

if ($Mode -ceq 'failed-owner') { $script:xrayM13OwnerState.status = 'failed'; $script:xrayM13OwnerState.ready = $false }
if ($Mode -ceq 'released-owner') { $script:xrayM13OwnerState.status = 'released'; $script:xrayM13OwnerState.ready = $false }
if ($Mode -ceq 'unready-owner') { $script:xrayM13OwnerState.ready = $false }
if ($Mode -ceq 'negative-archive-length') {
    $script:xrayM13OwnerState.bytesRequested = [long]-1; $script:xrayM13OwnerState.sourceBytesRead = [long]-1
    $script:xrayM13OwnerState.bytesWritten = [long]-1; $script:xrayM13OwnerState.copyBytesRead = [long]-1
}
if ($Mode -ceq 'oversized-archive') {
    $unsafeLength = [long]2147483649
    $script:xrayM13OwnerState.bytesRequested = $unsafeLength; $script:xrayM13OwnerState.sourceBytesRead = $unsafeLength
    $script:xrayM13OwnerState.bytesWritten = $unsafeLength; $script:xrayM13OwnerState.copyBytesRead = $unsafeLength
    $script:xrayM13FileState.bytesRequested = $unsafeLength; $script:xrayM13FileState.bytesWritten = $unsafeLength; $script:xrayM13FileState.bytesRead = $unsafeLength
}
if ($Mode -ceq 'foreign-m9') {
    $script:xrayM13ForeignState = [pscustomobject]@{ status = 'ready'; ready = $true }
    $foreignSession = [pscustomobject]@{ version = 1; token = 'foreign-session' }
    $foreignEntry = [pscustomobject]@{ session = $foreignSession; state = $script:xrayM13ForeignState }
    $script:XRayOutputFileOwnedSessions.Add($foreignEntry)
    $script:xrayM13OwnerState.outputFileSession = $foreignSession
}
if ($Mode -ceq 'clone-session') { $script:xrayM13CallSession = [pscustomobject]@{ version = 1; token = 'mutated-public-token' } }
else { $script:xrayM13CallSession = $script:xrayM13Public }

$capture = Get-XRayPrivateArtifactAsarHeaderCapture $script:xrayM13CallSession
$m10ReadyAfterCapture = [bool]$script:xrayM13OwnerState.ready
$m9ReadyAfterCapture = [bool]$script:xrayM13FileState.ready
$foreignM9ReadyAfterCapture = if ($null -ne $script:xrayM13ForeignState) { [bool]$script:xrayM13ForeignState.ready } else { $null }
$replacementStillCurrent = ($null -ne $script:xrayM13ReplacementState -and
    [object]::ReferenceEquals($script:xrayM13FileEntry.state, $script:xrayM13ReplacementState))
$replacementReady = if ($null -ne $script:xrayM13ReplacementState) { [bool]$script:xrayM13ReplacementState.ready } else { $null }
$closeResult = $null; $retryResult = $null
if ($Mode -cin @('ordinary', 'multi-block-header', 'close-retry')) {
    $closeResult = Close-XRayPrivateArtifactCopy $script:xrayM13Public
    if ($Mode -ceq 'close-retry' -and -not $closeResult.released) { $retryResult = Close-XRayPrivateArtifactCopy $script:xrayM13Public }
}

$sizeExpected = [byte[]]::new(8)
[BitConverter]::GetBytes([uint32]4).CopyTo($sizeExpected, 0)
[BitConverter]::GetBytes([uint32]$headerLength).CopyTo($sizeExpected, 4)
$headerExpected = [byte[]]::new($headerLength)
if ($headerLength -eq 12) {
    [BitConverter]::GetBytes([uint32]8).CopyTo($headerExpected, 0)
    [BitConverter]::GetBytes([uint32]2).CopyTo($headerExpected, 4)
    $headerExpected[8] = 0x7B; $headerExpected[9] = 0x7D
}
$expectedSizeMatches = Test-XRayM13ByteArraysEqual ([byte[]]$capture.sizePickle) $sizeExpected
$expectedHeaderMatches = Test-XRayM13ByteArraysEqual ([byte[]]$capture.headerPickle) $headerExpected
$emptyArraysOnFailure = ($capture.status -ceq 'verified' -or ($capture.sizePickle -is [byte[]] -and $capture.sizePickle.Length -eq 0 -and
    $capture.headerPickle -is [byte[]] -and $capture.headerPickle.Length -eq 0))
$captureDto = [pscustomobject]@{
    version = $capture.version; status = $capture.status; failureCode = $capture.failureCode
    archiveLength = $capture.archiveLength; sizePickleBytesRead = $capture.sizePickleBytesRead
    headerPickleBytesRead = $capture.headerPickleBytesRead; sizePickleLength = $capture.sizePickle.Length
    headerPickleLength = $capture.headerPickle.Length; copySha256 = $capture.copySha256
    identityProof = $capture.identityProof; snapshotStatus = $capture.snapshotStatus
    signatureStatus = $capture.signatureStatus
}
$result = [pscustomobject]@{
    version = 1; mode = $Mode; capture = $captureDto; sizePickleIsByteArray = ($capture.sizePickle -is [byte[]])
    headerPickleIsByteArray = ($capture.headerPickle -is [byte[]]); expectedSizeMatches = $expectedSizeMatches
    expectedHeaderMatches = $expectedHeaderMatches; emptyArraysOnFailure = $emptyArraysOnFailure
    reverifyCalls = $script:xrayM13ReverificationCalls; captureReadCalls = $script:xrayM13CaptureReadCalls
    sourceReadCalls = 0; sourceSeekCalls = 0; sourceChecks = $script:xrayM13SourceChecks
    directoryChecks = $script:xrayM13DirectoryChecks; targetMetadataCalls = $script:xrayM13MetadataCalls
    m10ReadyAfterCapture = $m10ReadyAfterCapture; m9ReadyAfterCapture = $m9ReadyAfterCapture
    foreignM9ReadyAfterCapture = $foreignM9ReadyAfterCapture; replacementStillCurrent = $replacementStillCurrent
    replacementReady = $replacementReady
    faultReached = [bool]$script:xrayM13FaultReached; faultStage = $script:xrayM13FaultStage
    closeResult = $closeResult; retryResult = $retryResult; closeCalls = $script:xrayM13CloseCalls
    sourceHeld = [bool]$script:xrayM13Source.held; directoryHeld = [bool]$script:xrayM13Directory.held
}
ConvertTo-Json -InputObject $result -Compress -Depth 6
