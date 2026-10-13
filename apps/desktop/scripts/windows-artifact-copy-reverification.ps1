# M11 re-reads an M10-owned private copy through its original M9 HANDLE.
# This internal port accepts only the registered M10 session object.

function Get-XRayPrivateCopyReverificationFailure([string]$Message) {
    $allowed = @(
        'COPY_REVERIFY_SESSION_REJECTED', 'COPY_REVERIFY_NOT_READY', 'COPY_REVERIFY_LEDGER_REJECTED',
        'COPY_REVERIFY_SIZE_REJECTED', 'COPY_REVERIFY_HASH_REJECTED', 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED',
        'COPY_REVERIFY_SOURCE_CHANGED', 'COPY_REVERIFY_DIRECTORY_CHANGED', 'COPY_REVERIFY_SEEK_FAILED',
        'COPY_REVERIFY_READ_FAILED', 'COPY_REVERIFY_READ_COUNT_REJECTED', 'COPY_REVERIFY_EOF_REJECTED',
        'COPY_REVERIFY_CONTENT_MISMATCH', 'COPY_REVERIFY_BUFFER_FAILED', 'COPY_REVERIFY_FAILED'
    )
    if ($Message -cin $allowed) { return $Message }
    if ($Message -cin @('PRIVATE_COPY_SOURCE_REJECTED', 'PRIVATE_COPY_SOURCE_CHANGED', 'PRIVATE_COPY_LIMIT_REJECTED',
        'PRIVATE_COPY_SOURCE_READ_FAILED', 'PRIVATE_COPY_SOURCE_SHORT_READ', 'PRIVATE_COPY_SOURCE_EOF_REJECTED',
        'PRIVATE_COPY_DIRECTORY_CHANGED')) { return 'COPY_REVERIFY_SOURCE_CHANGED' }
    if ($Message -cin @('OUTPUT_FILE_DIRECTORY_CHANGED', 'OUTPUT_FILE_DIRECTORY_REJECTED',
        'PRIVATE_COPY_DIRECTORY_REJECTED')) { return 'COPY_REVERIFY_DIRECTORY_CHANGED' }
    if ($Message -cin @('PRIVATE_COPY_OUTPUT_REJECTED', 'PRIVATE_COPY_TARGET_CHANGED', 'OUTPUT_FILE_METADATA_REJECTED',
        'OUTPUT_FILE_IDENTITY_UNAVAILABLE', 'NOT_DISK', 'REPARSE_REJECTED', 'TYPE_REJECTED')) {
        return 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
    }
    if ($Message -cin @('OUTPUT_FILE_BUFFER_REJECTED', 'OUTPUT_FILE_BUFFER_FAILED', 'BUFFER_FAILED')) {
        return 'COPY_REVERIFY_BUFFER_FAILED'
    }
    return 'COPY_REVERIFY_FAILED'
}

function New-XRayPrivateCopyReverificationResult([string]$Status, [object]$FailureCode,
    [long]$BytesRequested, [long]$BytesRead, [object]$CopySha256, [object]$IdentityProof) {
    return [pscustomobject]@{
        version = 1
        status = $Status
        failureCode = $FailureCode
        bytesRequested = [long]$BytesRequested
        bytesRead = [long]$BytesRead
        copySha256 = $CopySha256
        identityProof = $IdentityProof
        snapshotStatus = 'incomplete'
        signatureStatus = 'not-evaluated'
    }
}

function Assert-XRayPrivateCopyReverificationOwner($Owner) {
    if ($null -eq $Owner -or $null -eq $Owner.entry -or $null -eq $Owner.state -or
        -not [object]::ReferenceEquals((Find-XRayPrivateCopySession $Owner.session), $Owner.entry) -or
        -not [object]::ReferenceEquals($Owner.entry.session, $Owner.session) -or
        -not [object]::ReferenceEquals($Owner.entry.state, $Owner.state)) {
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
    if ($Owner.state.status -cne 'ready' -or $Owner.state.ready -ne $true -or
        $Owner.state.created -ne $true -or $Owner.state.released -ne $false -or
        $Owner.state.releaseStatus -cne 'held' -or $null -ne $Owner.state.failureCode -or
        $Owner.state.sourceConsumed -ne $true -or
        -not [object]::ReferenceEquals($Owner.state.sourceSession, $Owner.sourceSession) -or
        -not [object]::ReferenceEquals($Owner.state.sourceSnapshot, $Owner.sourceSnapshot) -or
        -not [object]::ReferenceEquals($Owner.state.directorySession, $Owner.directorySession) -or
        -not [object]::ReferenceEquals($Owner.state.directoryIdentity, $Owner.directoryIdentity) -or
        -not [object]::ReferenceEquals($Owner.state.outputFileSession, $Owner.fileSession) -or
        -not [object]::ReferenceEquals($Owner.state.outputFileEntry, $Owner.fileEntry) -or
        -not [object]::ReferenceEquals($Owner.state.outputFileState, $Owner.fileState)) {
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
    if ($Owner.state.bytesRequested -isnot [long] -or $Owner.state.sourceBytesRead -isnot [long] -or
        $Owner.state.bytesWritten -isnot [long] -or $Owner.state.copyBytesRead -isnot [long] -or
        [long]$Owner.state.bytesRequested -ne $Owner.expectedLength -or
        [long]$Owner.state.sourceBytesRead -ne $Owner.sourceBytesRead -or
        [long]$Owner.state.bytesWritten -ne $Owner.bytesWritten -or
        [long]$Owner.state.copyBytesRead -ne $Owner.copyBytesRead -or
        $Owner.state.sourceSha256 -cne $Owner.sourceSha256 -or $Owner.state.copySha256 -cne $Owner.copySha256 -or
        $Owner.state.outputIdentityProof -cne $Owner.identityProof) {
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
    if ($null -eq $Owner.fileEntry -or $null -eq $Owner.fileState -or
        -not [object]::ReferenceEquals((Find-XRayOutputFileSession $Owner.fileSession), $Owner.fileEntry) -or
        -not [object]::ReferenceEquals($Owner.fileEntry.session, $Owner.fileSession) -or
        -not [object]::ReferenceEquals($Owner.fileEntry.state, $Owner.fileState) -or
        $Owner.fileState.status -cne 'ready' -or $Owner.fileState.ready -ne $true -or
        $Owner.fileState.created -ne $true -or $Owner.fileState.released -ne $false -or
        $Owner.fileState.releaseStatus -cne 'held' -or $null -ne $Owner.fileState.failureCode -or
        -not [object]::ReferenceEquals($Owner.fileState.handles, $Owner.handleList) -or
        -not [object]::ReferenceEquals($Owner.fileState.createdIdentity, $Owner.fileCreatedIdentity) -or
        -not [object]::ReferenceEquals($Owner.fileState.directoryIdentity, $Owner.directoryIdentity)) {
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
    if ($Owner.fileState.bytesRequested -isnot [long] -or $Owner.fileState.bytesWritten -isnot [long] -or
        $Owner.fileState.bytesRead -isnot [long] -or
        [long]$Owner.fileState.bytesRequested -ne $Owner.expectedLength -or
        [long]$Owner.fileState.bytesWritten -ne $Owner.fileBytesWritten -or
        [long]$Owner.fileState.bytesRead -ne $Owner.fileBytesRead -or
        $Owner.fileState.inputSha256 -cne $Owner.fileInputSha256 -or
        $Owner.fileState.readbackSha256 -cne $Owner.fileReadbackSha256 -or
        $Owner.fileState.identityProof -cne $Owner.fileIdentityProof -or
        [IntPtr]$Owner.fileState.handle -ne [IntPtr]$Owner.targetHandle -or
        $Owner.fileState.handles.Count -ne 1 -or [IntPtr]$Owner.fileState.handles[0] -ne [IntPtr]$Owner.targetHandle) {
        throw 'COPY_REVERIFY_LEDGER_REJECTED'
    }
}

function Assert-XRayPrivateCopyReverificationTargetMetadata($Owner, $SavedMetadata, [long]$ExpectedLength) {
    $actual = $null
    try { $actual = Get-XRayHandleMetadata ([IntPtr]$Owner.targetHandle) $false }
    catch { throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED' }
    try { $actual = Assert-XRayOutputFileMetadataStable $actual $SavedMetadata $ExpectedLength }
    catch { throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED' }
    if (-not (Test-XRayPrivateCopyMetadataEqual $actual $SavedMetadata) -or
        [bool]$actual.directory -or [long]$actual.length -ne $ExpectedLength -or
        [int]$actual.links -ne 1 -or ([int]$actual.attributes -band 0x400) -ne 0) {
        throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
    }
    $m10Proof = Get-XRayPrivateCopyIdentityProof $actual
    $m9Proof = Get-XRayOutputFileIdentityProof $actual
    if ($m10Proof -cne $Owner.identityProof -or $m9Proof -cne $Owner.fileIdentityProof) {
        throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
    }
    return (New-XRayPrivateCopyMetadataSnapshot $actual)
}

function Revoke-XRayPrivateCopyReverificationOwner($OwnerState, $FileState) {
    if ($null -ne $OwnerState) {
        try { $OwnerState.ready = $false; $OwnerState.status = 'rejected' } catch { }
    }
    if ($null -ne $FileState) {
        try { $FileState.ready = $false; $FileState.status = 'rejected' } catch { }
    }
}

function Test-XRayPrivateArtifactCopyReverification($Session) {
    $ownerEntry = $null; $ownerState = $null; $fileEntry = $null; $fileState = $null
    $owner = $null; $ownerCaptured = $false; $fileOwnerCaptured = $false; $targetHandle = [IntPtr]::Zero
    $expectedLength = [long]0; $bytesRead = [long]0; $observedDigest = $null; $identityProof = $null
    $savedMetadata = $null; $metadataBeforeRead = $null; $sha = $null; $buffer = [IntPtr]::Zero
    $failureCode = $null
    try {
        if (-not (Get-Command 'Find-XRayPrivateCopySession' -CommandType Function -ErrorAction SilentlyContinue)) {
            throw 'COPY_REVERIFY_SESSION_REJECTED'
        }
        $ownerEntry = Find-XRayPrivateCopySession $Session
        if ($null -eq $ownerEntry -or -not [object]::ReferenceEquals($ownerEntry.session, $Session)) {
            throw 'COPY_REVERIFY_SESSION_REJECTED'
        }
        $ownerState = $ownerEntry.state
        if ($null -eq $ownerState -or $ownerState -isnot [pscustomobject]) { throw 'COPY_REVERIFY_NOT_READY' }
        $ownerCaptured = $true
        foreach ($required in @('Find-XRayPrivateCopySession', 'Find-XRayOutputFileSession',
            'Assert-XRayPrivateCopySourceStable',
            'Assert-XRayOutputFileDirectoryStable', 'Assert-XRayOutputFileMetadataStable',
            'Get-XRayHandleMetadata', 'Invoke-XRayOutputFileNative', 'New-XRayOutputFileZeroBuffer',
            'New-XRayPrivateCopyMetadataSnapshot', 'Test-XRayPrivateCopyMetadataEqual',
            'Get-XRayPrivateCopyIdentityProof', 'Get-XRayOutputFileIdentityProof')) {
            if (-not (Get-Command $required -CommandType Function -ErrorAction SilentlyContinue)) {
                throw 'COPY_REVERIFY_FAILED'
            }
        }
        $fileSession = $ownerState.outputFileSession
        $fileEntry = $ownerState.outputFileEntry
        $fileState = $ownerState.outputFileState
        if ($null -eq $fileEntry -or $null -eq $fileState -or
            $fileState -isnot [pscustomobject]) {
            throw 'COPY_REVERIFY_LEDGER_REJECTED'
        }
        $liveFileEntry = Find-XRayOutputFileSession $fileSession
        if ($null -eq $liveFileEntry -or
            -not [object]::ReferenceEquals($liveFileEntry, $fileEntry) -or
            -not [object]::ReferenceEquals($fileEntry.session, $fileSession) -or
            -not [object]::ReferenceEquals($fileEntry.state, $fileState)) {
            throw 'COPY_REVERIFY_LEDGER_REJECTED'
        }
        $fileOwnerCaptured = $true
        if ($ownerState.status -cne 'ready' -or $ownerState.ready -ne $true -or $ownerState.created -ne $true -or
            $ownerState.released -ne $false -or $ownerState.releaseStatus -cne 'held' -or
            $ownerState.sourceConsumed -ne $true -or
            $fileState.status -cne 'ready' -or $fileState.ready -ne $true -or $fileState.created -ne $true -or
            $fileState.released -ne $false -or $fileState.releaseStatus -cne 'held') {
            throw 'COPY_REVERIFY_NOT_READY'
        }

        $owner = [pscustomobject]@{
            entry = $ownerEntry; session = $Session; state = $ownerState
            sourceSession = $ownerState.sourceSession; sourceSnapshot = $ownerState.sourceSnapshot
            directorySession = $ownerState.directorySession; directoryIdentity = $ownerState.directoryIdentity
            fileSession = $fileSession; fileEntry = $fileEntry; fileState = $fileState
            targetHandle = [IntPtr]$fileState.handle; handleList = $fileState.handles
            fileCreatedIdentity = $fileState.createdIdentity
            expectedLength = [long]0; sourceBytesRead = [long]0; bytesWritten = [long]0; copyBytesRead = [long]0
            fileBytesWritten = [long]0; fileBytesRead = [long]0
            sourceSha256 = $null; copySha256 = $null; fileInputSha256 = $null; fileReadbackSha256 = $null
            identityProof = $null; fileIdentityProof = $null
        }
        $targetHandle = [IntPtr]$owner.targetHandle
        if ([IntPtr]$fileState.handle -eq [IntPtr]::Zero -or [IntPtr]$fileState.handle -eq [IntPtr](-1) -or
            $fileState.handles -isnot [Collections.Generic.List[System.IntPtr]] -or
            $fileState.handles.Count -ne 1 -or [IntPtr]$fileState.handles[0] -ne $targetHandle -or
            $null -eq $owner.sourceSession -or $null -eq $owner.sourceSnapshot -or
            $null -eq $owner.directorySession -or $null -eq $owner.directoryIdentity) {
            throw 'COPY_REVERIFY_LEDGER_REJECTED'
        }
        if ($ownerState.bytesRequested -isnot [long] -or $ownerState.sourceBytesRead -isnot [long] -or
            $ownerState.bytesWritten -isnot [long] -or $ownerState.copyBytesRead -isnot [long] -or
            $fileState.bytesRequested -isnot [long] -or $fileState.bytesWritten -isnot [long] -or
            $fileState.bytesRead -isnot [long]) { throw 'COPY_REVERIFY_SIZE_REJECTED' }
        $candidateLength = [long]$ownerState.bytesRequested
        if ($candidateLength -lt 0 -or $candidateLength -gt 2147483648 -or
            [long]$ownerState.sourceBytesRead -ne $candidateLength -or
            [long]$ownerState.bytesWritten -ne $candidateLength -or
            [long]$ownerState.copyBytesRead -ne $candidateLength -or
            [long]$fileState.bytesRequested -ne $candidateLength -or
            [long]$fileState.bytesWritten -ne $candidateLength -or
            [long]$fileState.bytesRead -ne $candidateLength) { throw 'COPY_REVERIFY_SIZE_REJECTED' }
        $expectedLength = $candidateLength
        $owner.expectedLength = $expectedLength
        $owner.sourceBytesRead = [long]$ownerState.sourceBytesRead
        $owner.bytesWritten = [long]$ownerState.bytesWritten
        $owner.copyBytesRead = [long]$ownerState.copyBytesRead
        $owner.fileBytesWritten = [long]$fileState.bytesWritten
        $owner.fileBytesRead = [long]$fileState.bytesRead
        foreach ($digest in @($ownerState.sourceSha256, $ownerState.copySha256, $fileState.inputSha256, $fileState.readbackSha256)) {
            if ($digest -isnot [string] -or $digest -cnotmatch '^[A-F0-9]{64}$') { throw 'COPY_REVERIFY_HASH_REJECTED' }
        }
        if ($ownerState.sourceSha256 -cne $ownerState.copySha256 -or
            $ownerState.sourceSha256 -cne $fileState.inputSha256 -or
            $ownerState.sourceSha256 -cne $fileState.readbackSha256) { throw 'COPY_REVERIFY_HASH_REJECTED' }
        $owner.sourceSha256 = [string]$ownerState.sourceSha256
        $owner.copySha256 = [string]$ownerState.copySha256
        $owner.fileInputSha256 = [string]$fileState.inputSha256
        $owner.fileReadbackSha256 = [string]$fileState.readbackSha256
        foreach ($proof in @($ownerState.outputIdentityProof, $fileState.identityProof)) {
            if ($proof -isnot [string] -or $proof -cnotmatch '^[A-F0-9]{64}$') {
                throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
            }
        }
        if ($ownerState.outputIdentityProof -cne $fileState.identityProof) {
            throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
        }
        $identityProof = [string]$ownerState.outputIdentityProof
        $owner.identityProof = [string]$ownerState.outputIdentityProof
        $owner.fileIdentityProof = [string]$fileState.identityProof
        $savedMetadata = New-XRayPrivateCopyMetadataSnapshot $fileState.createdIdentity
        if ([bool]$savedMetadata.directory -or [long]$savedMetadata.length -ne $expectedLength -or
            [int]$savedMetadata.links -ne 1 -or ([int]$savedMetadata.attributes -band 0x400) -ne 0) {
            throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
        }
        if (-not [object]::ReferenceEquals($fileState.directoryIdentity, $owner.directoryIdentity)) {
            throw 'COPY_REVERIFY_LEDGER_REJECTED'
        }

        Assert-XRayPrivateCopyReverificationOwner $owner
        try { $null = Assert-XRayPrivateCopySourceStable $owner.sourceSnapshot $true }
        catch { throw 'COPY_REVERIFY_SOURCE_CHANGED' }
        try { $null = Assert-XRayOutputFileDirectoryStable $owner.directorySession $owner.directoryIdentity }
        catch { throw 'COPY_REVERIFY_DIRECTORY_CHANGED' }
        $metadataBeforeRead = Assert-XRayPrivateCopyReverificationTargetMetadata $owner $savedMetadata $expectedLength

        try { $buffer = New-XRayOutputFileZeroBuffer 1048576 }
        catch { throw 'COPY_REVERIFY_BUFFER_FAILED' }
        $sha = [Security.Cryptography.SHA256]::Create()
        $seekResult = 0
        try { $seekResult = [int](Invoke-XRayOutputFileNative SetFilePointerEx @($targetHandle, [int64]0, [IntPtr]::Zero, [uint32]0)) }
        catch { throw 'COPY_REVERIFY_SEEK_FAILED' }
        if ($seekResult -eq 0) { throw 'COPY_REVERIFY_SEEK_FAILED' }

        while ($bytesRead -lt $expectedLength) {
            $remaining = $expectedLength - $bytesRead
            $requested = [int][Math]::Min([long]1048576, $remaining)
            if ($requested -lt 1 -or $requested -gt 1048576) { throw 'COPY_REVERIFY_SIZE_REJECTED' }
            [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($requested), 0, $buffer, $requested)
            $readArgs = [object[]]@($targetHandle, $buffer, [uint32]$requested, [uint32]0, [IntPtr]::Zero)
            $readResult = 0
            try { $readResult = [int](Invoke-XRayOutputFileNative ReadFile $readArgs) }
            catch { throw 'COPY_REVERIFY_READ_FAILED' }
            $actual = [uint32]$readArgs[3]
            if ($actual -gt [uint32]$requested -or [long]$actual -gt ($expectedLength - $bytesRead)) {
                throw 'COPY_REVERIFY_READ_COUNT_REJECTED'
            }
            if ($actual -gt 0) { $bytesRead += [long]$actual }
            if ($bytesRead -gt $expectedLength) { throw 'COPY_REVERIFY_READ_COUNT_REJECTED' }
            if ($readResult -eq 0) { throw 'COPY_REVERIFY_READ_FAILED' }
            if ($actual -ne [uint32]$requested -or $actual -eq 0) { throw 'COPY_REVERIFY_READ_COUNT_REJECTED' }
            $chunk = [byte[]]::new([int]$actual)
            try {
                [Runtime.InteropServices.Marshal]::Copy($buffer, $chunk, 0, [int]$actual)
                [void]$sha.TransformBlock($chunk, 0, $chunk.Length, $chunk, 0)
            } finally { [Array]::Clear($chunk, 0, $chunk.Length) }
        }
        if ($bytesRead -ne $expectedLength) { throw 'COPY_REVERIFY_READ_COUNT_REJECTED' }
        [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(1), 0, $buffer, 1)
        $eofArgs = [object[]]@($targetHandle, $buffer, [uint32]1, [uint32]0, [IntPtr]::Zero)
        $eofResult = 0
        try { $eofResult = [int](Invoke-XRayOutputFileNative ReadFile $eofArgs) }
        catch { throw 'COPY_REVERIFY_READ_FAILED' }
        if ($eofResult -eq 0) { throw 'COPY_REVERIFY_READ_FAILED' }
        if ([uint32]$eofArgs[3] -ne 0) { throw 'COPY_REVERIFY_EOF_REJECTED' }
        [void]$sha.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $observedDigest = ([BitConverter]::ToString($sha.Hash)).Replace('-', '')
        if ($observedDigest -cnotmatch '^[A-F0-9]{64}$' -or
            $observedDigest -cne $owner.copySha256 -or $observedDigest -cne $owner.sourceSha256) {
            throw 'COPY_REVERIFY_CONTENT_MISMATCH'
        }

        try { $null = Assert-XRayPrivateCopySourceStable $owner.sourceSnapshot $true }
        catch { throw 'COPY_REVERIFY_SOURCE_CHANGED' }
        try { $null = Assert-XRayOutputFileDirectoryStable $owner.directorySession $owner.directoryIdentity }
        catch { throw 'COPY_REVERIFY_DIRECTORY_CHANGED' }
        Assert-XRayPrivateCopyReverificationOwner $owner
        $metadataAfterRead = Assert-XRayPrivateCopyReverificationTargetMetadata $owner $savedMetadata $expectedLength
        if (-not (Test-XRayPrivateCopyMetadataEqual $metadataBeforeRead $metadataAfterRead)) {
            throw 'COPY_REVERIFY_TARGET_IDENTITY_REJECTED'
        }
        return (New-XRayPrivateCopyReverificationResult 'verified' $null $expectedLength $bytesRead $observedDigest $identityProof)
    } catch {
        $failureCode = Get-XRayPrivateCopyReverificationFailure $_.Exception.Message
        if ($ownerCaptured) {
            if ($fileOwnerCaptured) { Revoke-XRayPrivateCopyReverificationOwner $ownerState $fileState }
            else { Revoke-XRayPrivateCopyReverificationOwner $ownerState $null }
        }
        return (New-XRayPrivateCopyReverificationResult 'rejected' $failureCode $expectedLength $bytesRead $observedDigest $identityProof)
    } finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($buffer -ne [IntPtr]::Zero) {
            try { [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(1048576), 0, $buffer, 1048576) } catch { }
            [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
        }
    }
}
