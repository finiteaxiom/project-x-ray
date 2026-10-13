# Internal bounded ASAR prefix/header capture from the original M10-owned HANDLE.
# Import defines functions only; it does not open files or bind native APIs.

function New-XRayPrivateArtifactAsarHeaderCaptureResult($Status, $FailureCode, [long]$ArchiveLength,
    [long]$SizePickleBytesRead, [long]$HeaderPickleBytesRead, [byte[]]$SizePickle, [byte[]]$HeaderPickle,
    $CopySha256, $IdentityProof) {
    $result = [pscustomobject]@{
        version = 1
        status = [string]$Status
        failureCode = $FailureCode
        archiveLength = [long]$ArchiveLength
        sizePickleBytesRead = [long]$SizePickleBytesRead
        headerPickleBytesRead = [long]$HeaderPickleBytesRead
        sizePickle = [byte[]]$SizePickle
        headerPickle = [byte[]]$HeaderPickle
        copySha256 = $CopySha256
        identityProof = $IdentityProof
        snapshotStatus = 'incomplete'
        signatureStatus = 'not-evaluated'
    }
    return ,$result
}

function Get-XRayPrivateArtifactAsarHeaderCaptureFailure([string]$Message) {
    $known = @(
        'ASAR_HEADER_CAPTURE_SESSION_REJECTED', 'ASAR_HEADER_CAPTURE_NOT_READY',
        'ASAR_HEADER_CAPTURE_LEDGER_REJECTED', 'ASAR_HEADER_CAPTURE_REVERIFY_REJECTED',
        'ASAR_HEADER_CAPTURE_SEEK_FAILED', 'ASAR_HEADER_CAPTURE_READ_FAILED',
        'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED', 'ASAR_HEADER_CAPTURE_SIZE_PICKLE_REJECTED',
        'ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED', 'ASAR_HEADER_CAPTURE_HEADER_BOUNDS_REJECTED',
        'ASAR_HEADER_CAPTURE_BUFFER_FAILED', 'ASAR_HEADER_CAPTURE_SOURCE_CHANGED',
        'ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED', 'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED',
        'ASAR_HEADER_CAPTURE_FAILED'
    )
    if ($Message -cin $known) { return $Message }
    if ($Message -cin @('COPY_REVERIFY_SESSION_REJECTED')) { return 'ASAR_HEADER_CAPTURE_SESSION_REJECTED' }
    if ($Message -cin @('COPY_REVERIFY_NOT_READY')) { return 'ASAR_HEADER_CAPTURE_NOT_READY' }
    if ($Message -cin @('COPY_REVERIFY_LEDGER_REJECTED', 'COPY_REVERIFY_SIZE_REJECTED', 'COPY_REVERIFY_HASH_REJECTED')) {
        return 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
    }
    if ($Message -cin @('COPY_REVERIFY_SOURCE_CHANGED')) { return 'ASAR_HEADER_CAPTURE_SOURCE_CHANGED' }
    if ($Message -cin @('COPY_REVERIFY_DIRECTORY_CHANGED')) { return 'ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED' }
    if ($Message -cin @('COPY_REVERIFY_TARGET_IDENTITY_REJECTED')) { return 'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED' }
    if ($Message -cin @('COPY_REVERIFY_BUFFER_FAILED', 'OUTPUT_FILE_BUFFER_REJECTED', 'OUTPUT_FILE_BUFFER_FAILED', 'BUFFER_FAILED')) {
        return 'ASAR_HEADER_CAPTURE_BUFFER_FAILED'
    }
    if ($Message -cin @('COPY_REVERIFY_SEEK_FAILED')) { return 'ASAR_HEADER_CAPTURE_SEEK_FAILED' }
    if ($Message -cin @('COPY_REVERIFY_READ_FAILED', 'COPY_REVERIFY_READ_COUNT_REJECTED', 'COPY_REVERIFY_EOF_REJECTED',
        'COPY_REVERIFY_CONTENT_MISMATCH', 'COPY_REVERIFY_FAILED')) { return 'ASAR_HEADER_CAPTURE_REVERIFY_REJECTED' }
    return 'ASAR_HEADER_CAPTURE_FAILED'
}

function Revoke-XRayPrivateArtifactAsarHeaderCaptureOwner($OwnerState, $FileState) {
    if ($null -ne $OwnerState) {
        try { $OwnerState.ready = $false; $OwnerState.status = 'rejected' } catch { }
    }
    if ($null -ne $FileState) {
        try { $FileState.ready = $false; $FileState.status = 'rejected' } catch { }
    }
}

function Assert-XRayPrivateArtifactAsarHeaderCaptureOwner($Owner, $SavedMetadata) {
    try { Assert-XRayPrivateCopyReverificationOwner $Owner }
    catch { throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED' }
    try { $null = Assert-XRayPrivateCopySourceStable $Owner.sourceSnapshot $true }
    catch { throw 'ASAR_HEADER_CAPTURE_SOURCE_CHANGED' }
    try { $null = Assert-XRayOutputFileDirectoryStable $Owner.directorySession $Owner.directoryIdentity }
    catch { throw 'ASAR_HEADER_CAPTURE_DIRECTORY_CHANGED' }
    try { $metadata = Assert-XRayPrivateCopyReverificationTargetMetadata $Owner $SavedMetadata $Owner.expectedLength }
    catch { throw 'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED' }
    if (-not (Test-XRayPrivateCopyMetadataEqual $metadata $SavedMetadata)) {
        throw 'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED'
    }
    return $metadata
}

function Read-XRayPrivateArtifactAsarHeaderCaptureExact([IntPtr]$TargetHandle, [IntPtr]$Buffer, [int]$Requested) {
    if ($Requested -lt 1 -or $Requested -gt 1048576) { throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED' }
    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($Requested), 0, $Buffer, $Requested)
    $arguments = [object[]]@($TargetHandle, $Buffer, [uint32]$Requested, [uint32]0, [IntPtr]::Zero)
    $readResult = 0
    try { $readResult = [int](Invoke-XRayOutputFileNative ReadFile $arguments) }
    catch { throw 'ASAR_HEADER_CAPTURE_READ_FAILED' }
    $actual = [uint32]$arguments[3]
    if ($actual -gt [uint32]$Requested) { throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED' }
    if ($readResult -eq 0) { throw 'ASAR_HEADER_CAPTURE_READ_FAILED' }
    if ($actual -ne [uint32]$Requested -or $actual -eq 0) { throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED' }
    return [long]$actual
}

function Assert-XRayPrivateArtifactAsarHeaderCaptureReverification($Verification, $Owner) {
    if ($null -eq $Verification -or $Verification.version -ne 1 -or $Verification.status -cne 'verified' -or
        $null -ne $Verification.failureCode -or $Verification.bytesRequested -isnot [long] -or
        $Verification.bytesRead -isnot [long] -or [long]$Verification.bytesRequested -ne $Owner.expectedLength -or
        [long]$Verification.bytesRead -ne $Owner.expectedLength -or
        $Verification.copySha256 -cne $Owner.copySha256 -or $Verification.identityProof -cne $Owner.identityProof -or
        $Verification.snapshotStatus -cne 'incomplete' -or $Verification.signatureStatus -cne 'not-evaluated') {
        throw 'ASAR_HEADER_CAPTURE_REVERIFY_REJECTED'
    }
}

function Get-XRayPrivateArtifactAsarHeaderCapture($Session) {
    $ownerEntry = $null; $ownerState = $null; $fileSession = $null; $fileEntry = $null; $fileState = $null
    $ownerCaptured = $false; $fileOwnerConfirmed = $false; $owner = $null
    $targetHandle = [IntPtr]::Zero; $expectedLength = [long]0; $identityProof = $null; $copySha256 = $null
    $savedMetadata = $null; $metadataBeforeCapture = $null; $buffer = [IntPtr]::Zero
    $sizePickle = [byte[]]::new(0); $headerPickle = [byte[]]::new(0)
    $sizePickleBytesRead = [long]0; $headerPickleBytesRead = [long]0; $success = $false
    try {
        if (-not (Get-Command 'Find-XRayPrivateCopySession' -CommandType Function -ErrorAction SilentlyContinue)) {
            throw 'ASAR_HEADER_CAPTURE_SESSION_REJECTED'
        }
        $ownerEntry = Find-XRayPrivateCopySession $Session
        if ($null -eq $ownerEntry -or -not [object]::ReferenceEquals($ownerEntry.session, $Session)) {
            throw 'ASAR_HEADER_CAPTURE_SESSION_REJECTED'
        }
        $ownerState = $ownerEntry.state
        if ($null -eq $ownerState -or $ownerState -isnot [pscustomobject]) { throw 'ASAR_HEADER_CAPTURE_NOT_READY' }
        $ownerCaptured = $true

        # Capture M10's saved M9 tuple before consulting the live M9 registry.
        $fileSession = $ownerState.outputFileSession
        $fileEntry = $ownerState.outputFileEntry
        $fileState = $ownerState.outputFileState
        if ($null -eq $fileSession -or $null -eq $fileEntry -or $null -eq $fileState -or $fileState -isnot [pscustomobject]) {
            throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
        }

        $targetHandle = $fileState.handle
        $owner = [pscustomobject]@{
            entry = $ownerEntry; session = $Session; state = $ownerState
            sourceSession = $ownerState.sourceSession; sourceSnapshot = $ownerState.sourceSnapshot
            directorySession = $ownerState.directorySession; directoryIdentity = $ownerState.directoryIdentity
            fileSession = $fileSession; fileEntry = $fileEntry; fileState = $fileState
            targetHandle = $targetHandle; handleList = $fileState.handles
            fileCreatedIdentity = $fileState.createdIdentity
            expectedLength = $ownerState.bytesRequested; sourceBytesRead = $ownerState.sourceBytesRead
            bytesWritten = $ownerState.bytesWritten; copyBytesRead = $ownerState.copyBytesRead
            fileBytesWritten = $fileState.bytesWritten; fileBytesRead = $fileState.bytesRead
            sourceSha256 = $ownerState.sourceSha256; copySha256 = $ownerState.copySha256
            fileInputSha256 = $fileState.inputSha256; fileReadbackSha256 = $fileState.readbackSha256
            identityProof = $ownerState.outputIdentityProof; fileIdentityProof = $fileState.identityProof
        }
        foreach ($required in @('Find-XRayOutputFileSession', 'Assert-XRayPrivateCopyReverificationOwner',
            'Assert-XRayPrivateCopySourceStable', 'Assert-XRayOutputFileDirectoryStable',
            'Assert-XRayPrivateCopyReverificationTargetMetadata', 'Test-XRayPrivateCopyMetadataEqual',
            'New-XRayPrivateCopyMetadataSnapshot', 'Get-XRayPrivateCopyIdentityProof', 'Get-XRayOutputFileIdentityProof',
            'Get-XRayHandleMetadata', 'Invoke-XRayOutputFileNative', 'New-XRayOutputFileZeroBuffer',
            'Test-XRayPrivateArtifactCopyReverification')) {
            if (-not (Get-Command $required -CommandType Function -ErrorAction SilentlyContinue)) {
                throw 'ASAR_HEADER_CAPTURE_FAILED'
            }
        }
        $liveFileEntry = Find-XRayOutputFileSession $fileSession
        if ($null -eq $liveFileEntry -or -not [object]::ReferenceEquals($liveFileEntry, $fileEntry) -or
            -not [object]::ReferenceEquals($fileEntry.session, $fileSession) -or
            -not [object]::ReferenceEquals($fileEntry.state, $fileState)) {
            throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
        }
        $fileOwnerConfirmed = $true

        if ($targetHandle -isnot [IntPtr] -or [IntPtr]$targetHandle -eq [IntPtr]::Zero -or
            [IntPtr]$targetHandle -eq [IntPtr](-1) -or
            $fileState.handles -isnot [Collections.Generic.List[System.IntPtr]] -or
            $fileState.handles.Count -ne 1 -or [IntPtr]$fileState.handles[0] -ne [IntPtr]$targetHandle) {
            throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
        }
        $targetHandle = [IntPtr]$targetHandle
        $owner.targetHandle = $targetHandle
        if ($owner.expectedLength -isnot [long] -or $owner.sourceBytesRead -isnot [long] -or
            $owner.bytesWritten -isnot [long] -or $owner.copyBytesRead -isnot [long] -or
            $owner.fileBytesWritten -isnot [long] -or $owner.fileBytesRead -isnot [long]) {
            throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
        }
        $expectedLength = [long]$owner.expectedLength
        if ($expectedLength -lt 0 -or $expectedLength -gt [long]2147483648) { throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED' }
        foreach ($digest in @($owner.sourceSha256, $owner.copySha256, $owner.fileInputSha256, $owner.fileReadbackSha256,
            $owner.identityProof, $owner.fileIdentityProof)) {
            if ($digest -isnot [string] -or $digest -cnotmatch '^[A-F0-9]{64}$') {
                throw 'ASAR_HEADER_CAPTURE_LEDGER_REJECTED'
            }
        }
        $copySha256 = [string]$owner.copySha256; $identityProof = [string]$owner.identityProof
        $savedMetadata = New-XRayPrivateCopyMetadataSnapshot $owner.fileCreatedIdentity

        Assert-XRayPrivateCopyReverificationOwner $owner
        $beforeVerification = Test-XRayPrivateArtifactCopyReverification $Session
        Assert-XRayPrivateArtifactAsarHeaderCaptureReverification $beforeVerification $owner
        $metadataBeforeCapture = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata

        $buffer = New-XRayOutputFileZeroBuffer 1048576
        if ($null -eq $buffer -or $buffer -eq [IntPtr]::Zero) { throw 'ASAR_HEADER_CAPTURE_BUFFER_FAILED' }
        $seekResult = 0
        try { $seekResult = [int](Invoke-XRayOutputFileNative SetFilePointerEx @($targetHandle, [int64]0, [IntPtr]::Zero, [uint32]0)) }
        catch { throw 'ASAR_HEADER_CAPTURE_SEEK_FAILED' }
        if ($seekResult -eq 0) { throw 'ASAR_HEADER_CAPTURE_SEEK_FAILED' }

        $null = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata
        $sizePickle = [byte[]]::new(8)
        $sizePickleBytesRead = Read-XRayPrivateArtifactAsarHeaderCaptureExact $targetHandle $buffer 8
        [Runtime.InteropServices.Marshal]::Copy($buffer, $sizePickle, 0, 8)
        $null = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata
        $picklePayloadLength = [BitConverter]::ToUInt32($sizePickle, 0)
        $headerLengthUnsigned = [BitConverter]::ToUInt32($sizePickle, 4)
        if ($picklePayloadLength -ne [uint32]4) { throw 'ASAR_HEADER_CAPTURE_SIZE_PICKLE_REJECTED' }
        if ($expectedLength -lt [long]8 -or $headerLengthUnsigned -lt [uint32]12 -or
            $headerLengthUnsigned -gt [uint32]8388608 -or ($headerLengthUnsigned % [uint32]4) -ne 0) {
            throw 'ASAR_HEADER_CAPTURE_HEADER_LENGTH_REJECTED'
        }
        $headerLength = [long]$headerLengthUnsigned
        if ($headerLength -gt ($expectedLength - [long]8)) { throw 'ASAR_HEADER_CAPTURE_HEADER_BOUNDS_REJECTED' }
        $headerEnd = [long]8 + $headerLength
        if ($headerEnd -lt [long]8 -or $headerEnd -gt $expectedLength -or $headerEnd -gt [long]2147483648) {
            throw 'ASAR_HEADER_CAPTURE_HEADER_BOUNDS_REJECTED'
        }

        # Allocate the exact managed range only after every prefix and archive bound is accepted.
        $headerPickle = [byte[]]::new([int]$headerLength)
        $headerOffset = 0
        while ($headerOffset -lt $headerPickle.Length) {
            $null = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata
            $remaining = $headerPickle.Length - $headerOffset
            $requested = [int][Math]::Min([long]1048576, [long]$remaining)
            if ($requested -lt 1 -or $requested -gt 1048576 -or $requested -gt $remaining) {
                throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED'
            }
            $actual = Read-XRayPrivateArtifactAsarHeaderCaptureExact $targetHandle $buffer $requested
            if ($actual -gt [long]$requested -or $actual -gt [long]$remaining) {
                throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED'
            }
            [Runtime.InteropServices.Marshal]::Copy($buffer, $headerPickle, $headerOffset, [int]$actual)
            $headerOffset += [int]$actual
            $headerPickleBytesRead += $actual
        }
        if ($headerPickleBytesRead -ne $headerLength) { throw 'ASAR_HEADER_CAPTURE_READ_COUNT_REJECTED' }

        $null = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata
        $afterVerification = Test-XRayPrivateArtifactCopyReverification $Session
        Assert-XRayPrivateArtifactAsarHeaderCaptureReverification $afterVerification $owner
        if ($afterVerification.copySha256 -cne $beforeVerification.copySha256 -or
            $afterVerification.identityProof -cne $beforeVerification.identityProof) {
            throw 'ASAR_HEADER_CAPTURE_REVERIFY_REJECTED'
        }
        $metadataAfterCapture = Assert-XRayPrivateArtifactAsarHeaderCaptureOwner $owner $savedMetadata
        if (-not (Test-XRayPrivateCopyMetadataEqual $metadataBeforeCapture $metadataAfterCapture)) {
            throw 'ASAR_HEADER_CAPTURE_TARGET_IDENTITY_REJECTED'
        }
        $success = $true
        return (New-XRayPrivateArtifactAsarHeaderCaptureResult 'verified' $null $expectedLength $sizePickleBytesRead $headerPickleBytesRead `
            $sizePickle $headerPickle $copySha256 $identityProof)
    } catch {
        $failureCode = Get-XRayPrivateArtifactAsarHeaderCaptureFailure $_.Exception.Message
        if ($ownerCaptured) {
            if ($fileOwnerConfirmed) { Revoke-XRayPrivateArtifactAsarHeaderCaptureOwner $ownerState $fileState }
            else { Revoke-XRayPrivateArtifactAsarHeaderCaptureOwner $ownerState $null }
        }
        if ($null -ne $sizePickle) { [Array]::Clear($sizePickle, 0, $sizePickle.Length) }
        if ($null -ne $headerPickle) { [Array]::Clear($headerPickle, 0, $headerPickle.Length) }
        $emptySizePickle = [byte[]]::new(0); $emptyHeaderPickle = [byte[]]::new(0)
        return (New-XRayPrivateArtifactAsarHeaderCaptureResult 'rejected' $failureCode 0 0 0 `
            $emptySizePickle $emptyHeaderPickle $null $null)
    } finally {
        if ($null -ne $buffer -and $buffer -ne [IntPtr]::Zero) {
            try { [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(1048576), 0, $buffer, 1048576) } catch { }
            try { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) } catch { }
        }
        if (-not $success) {
            if ($null -ne $sizePickle) { [Array]::Clear($sizePickle, 0, $sizePickle.Length) }
            if ($null -ne $headerPickle) { [Array]::Clear($headerPickle, 0, $headerPickle.Length) }
        }
    }
}
