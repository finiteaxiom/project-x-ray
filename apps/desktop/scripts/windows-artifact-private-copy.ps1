# M10 copies one already-held M4 file into an M9-owned private file. No paths or native handles are accepted from callers.

function Get-XRayPrivateCopyChunkLength([long]$Completed, [long]$Expected, [long]$Maximum) {
    if ($Maximum -lt 0 -or $Maximum -gt 2147483648 -or $Expected -lt 0 -or $Expected -gt $Maximum -or
        $Completed -lt 0 -or $Completed -gt $Expected) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
    if ($Completed -eq $Expected) { return [long]0 }
    $remaining = $Expected - $Completed
    return [long][Math]::Min([long]1048576, $remaining)
}

function Get-XRayPrivateCopyFailure([string]$Message) {
    $allowed = @(
        'PRIVATE_COPY_INPUT_REJECTED', 'PRIVATE_COPY_SOURCE_REJECTED', 'PRIVATE_COPY_SOURCE_CHANGED',
        'PRIVATE_COPY_LIMIT_REJECTED', 'PRIVATE_COPY_SOURCE_READ_FAILED', 'PRIVATE_COPY_SOURCE_SHORT_READ',
        'PRIVATE_COPY_SOURCE_EOF_REJECTED', 'PRIVATE_COPY_DIRECTORY_REJECTED', 'PRIVATE_COPY_DIRECTORY_CHANGED',
        'PRIVATE_COPY_OUTPUT_REJECTED', 'PRIVATE_COPY_TARGET_CHANGED', 'PRIVATE_COPY_WRITE_FAILED',
        'PRIVATE_COPY_WRITE_COUNT_REJECTED', 'PRIVATE_COPY_READ_FAILED', 'PRIVATE_COPY_READ_COUNT_REJECTED',
        'PRIVATE_COPY_EOF_REJECTED', 'PRIVATE_COPY_CONTENT_MISMATCH', 'PRIVATE_COPY_BUFFER_FAILED',
        'PRIVATE_COPY_SESSION_INVALID', 'PRIVATE_COPY_CLOSE_UNCONFIRMED', 'PRIVATE_COPY_FAILED'
    )
    if ($Message -cin $allowed) { return $Message }
    if ($Message -ceq 'OUTPUT_FILE_DIRECTORY_CHANGED') { return 'PRIVATE_COPY_DIRECTORY_CHANGED' }
    if ($Message -like 'OUTPUT_FILE_DIRECTORY_*') { return 'PRIVATE_COPY_DIRECTORY_REJECTED' }
    if ($Message -like 'OUTPUT_FILE_*') { return 'PRIVATE_COPY_OUTPUT_REJECTED' }
    if ($Message -in @('REPARSE_REJECTED', 'NOT_DISK', 'TYPE_REJECTED', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE',
        'FILE_CHANGED', 'SESSION_INVALID', 'OPEN_REJECTED', 'VOLUME_REJECTED', 'SIZE_LIMIT')) {
        return 'PRIVATE_COPY_SOURCE_REJECTED'
    }
    return 'PRIVATE_COPY_FAILED'
}

function New-XRayPrivateCopyMetadataSnapshot($Metadata) {
    $required = @('volume', 'fileId', 'directory', 'attributes', 'length', 'allocation', 'links', 'creation', 'write', 'change')
    if ($null -eq $Metadata -or $Metadata -isnot [pscustomobject] -or @($Metadata.PSObject.Properties).Count -ne $required.Count) {
        throw 'PRIVATE_COPY_SOURCE_REJECTED'
    }
    foreach ($name in $required) {
        if ($null -eq $Metadata.PSObject.Properties[$name]) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    }
    if ($Metadata.volume -isnot [string] -or $Metadata.volume -cnotmatch '^[0-9A-F]{16}$' -or
        $Metadata.volume -ceq ('0' * 16) -or $Metadata.fileId -isnot [string] -or
        $Metadata.fileId -cnotmatch '^[0-9A-F]{32}$' -or $Metadata.fileId -ceq ('0' * 32) -or
        $Metadata.fileId -ceq ('F' * 32) -or $Metadata.directory -isnot [bool] -or
        $Metadata.attributes -isnot [int] -or $Metadata.length -isnot [long] -or
        $Metadata.allocation -isnot [long] -or $Metadata.links -isnot [int] -or
        $Metadata.creation -isnot [long] -or $Metadata.write -isnot [long] -or $Metadata.change -isnot [long] -or
        ([int]$Metadata.attributes -band 0x400) -ne 0 -or [long]$Metadata.length -lt 0 -or
        [long]$Metadata.allocation -lt 0 -or [int]$Metadata.links -lt 1) {
        throw 'PRIVATE_COPY_SOURCE_REJECTED'
    }
    return [pscustomobject]@{
        volume = [string]$Metadata.volume; fileId = [string]$Metadata.fileId; directory = [bool]$Metadata.directory
        attributes = [int]$Metadata.attributes; length = [long]$Metadata.length; allocation = [long]$Metadata.allocation
        links = [int]$Metadata.links; creation = [long]$Metadata.creation; write = [long]$Metadata.write; change = [long]$Metadata.change
    }
}

function Test-XRayPrivateCopyMetadataEqual($Left, $Right) {
    try { $leftSnapshot = New-XRayPrivateCopyMetadataSnapshot $Left; $rightSnapshot = New-XRayPrivateCopyMetadataSnapshot $Right }
    catch { return $false }
    foreach ($name in @('volume', 'fileId', 'directory', 'attributes', 'length', 'allocation', 'links', 'creation', 'write', 'change')) {
        if ($leftSnapshot.$name -cne $rightSnapshot.$name) { return $false }
    }
    return $true
}

function Get-XRayPrivateCopyIdentityProof($Metadata) {
    $snapshot = New-XRayPrivateCopyMetadataSnapshot $Metadata
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$snapshot.volume + ':' + [string]$snapshot.fileId)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function Test-XRayPrivateCopyOwnerEntry($Entry, $Session) {
    return ($null -ne $Entry -and $null -ne $Session -and $null -ne $Entry.state -and
        [object]::ReferenceEquals($Entry.session, $Session))
}

function Register-XRayPrivateCopySession($Session, $State) {
    if (-not $script:XRayPrivateArtifactCopySessions) {
        $script:XRayPrivateArtifactCopySessions = [Collections.Generic.List[object]]::new()
    }
    $entry = [pscustomobject]@{ session = $Session; state = $State }
    $script:XRayPrivateArtifactCopySessions.Add($entry)
    return $entry
}

function Find-XRayPrivateCopySession($Session) {
    if ($null -eq $Session -or -not $script:XRayPrivateArtifactCopySessions) { return $null }
    foreach ($entry in $script:XRayPrivateArtifactCopySessions) {
        if (Test-XRayPrivateCopyOwnerEntry $entry $Session) { return $entry }
    }
    return $null
}

function Find-XRayPrivateCopyAnySession($Session) {
    $entry = Find-XRayPrivateCopySession $Session
    if ($null -ne $entry) { return $entry }
    if ($script:XRayPrivateArtifactCopyReleasedSessions) {
        foreach ($released in $script:XRayPrivateArtifactCopyReleasedSessions) {
            if (Test-XRayPrivateCopyOwnerEntry $released $Session) { return $released }
        }
    }
    return $null
}

function Complete-XRayPrivateCopySession($Entry) {
    if ($null -eq $Entry -or -not $script:XRayPrivateArtifactCopySessions) { return }
    for ($index = $script:XRayPrivateArtifactCopySessions.Count - 1; $index -ge 0; $index--) {
        if ([object]::ReferenceEquals($script:XRayPrivateArtifactCopySessions[$index], $Entry)) {
            $script:XRayPrivateArtifactCopySessions.RemoveAt($index)
            break
        }
    }
    if (-not $script:XRayPrivateArtifactCopyReleasedSessions) {
        $script:XRayPrivateArtifactCopyReleasedSessions = [Collections.Generic.List[object]]::new()
    }
    $script:XRayPrivateArtifactCopyReleasedSessions.Add($Entry)
}

function Assert-XRayPrivateCopyDependencies {
    $required = @(
        'Get-XRayHandleMetadata', 'Invoke-XRayNative', 'New-XRayZeroBuffer',
        'Assert-XRayOutputFileBorrowedDirectory', 'Assert-XRayOutputFileDirectoryStable',
        'Assert-XRayOutputFileMetadataStable', 'Get-XRayOutputFileIdentityProof',
        'Find-XRayOutputFileSession', 'Find-XRayOutputFileAnySession',
        'New-XRayPrivateArtifactOutputFile', 'Get-XRayPrivateArtifactOutputFileSummary',
        'Close-XRayPrivateArtifactOutputFile', 'Invoke-XRayOutputFileNative'
    )
    foreach ($name in $required) {
        if (-not (Get-Command $name -CommandType Function -ErrorAction SilentlyContinue)) { throw 'PRIVATE_COPY_OUTPUT_REJECTED' }
    }
}

function Assert-XRayPrivateCopySourceSession($SourceSession) {
    Assert-XRayPrivateCopyDependencies
    $sessionFields = @('handles', 'chain', 'released', 'readStarted', 'maxBytes', 'before', 'leaf')
    if ($null -eq $SourceSession -or $SourceSession -isnot [pscustomobject] -or
        @($SourceSession.PSObject.Properties).Count -ne $sessionFields.Count) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    foreach ($name in $sessionFields) {
        if ($null -eq $SourceSession.PSObject.Properties[$name]) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    }
    if ($SourceSession.released -isnot [bool] -or $SourceSession.released -ne $false -or
        $SourceSession.readStarted -isnot [bool] -or $SourceSession.readStarted -ne $false -or
        $SourceSession.maxBytes -isnot [long] -or $SourceSession.maxBytes -lt 0 -or
        $SourceSession.maxBytes -gt 2147483648 -or
        $SourceSession.handles -isnot [Collections.Generic.List[System.IntPtr]] -or
        $SourceSession.chain -isnot [Collections.Generic.List[object]] -or
        $SourceSession.handles.Count -lt 1 -or $SourceSession.handles.Count -gt 65 -or
        $SourceSession.chain.Count -ne $SourceSession.handles.Count) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    $handles = [IntPtr[]]::new($SourceSession.handles.Count)
    $parentSnapshots = [Collections.Generic.List[object]]::new()
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $leafSnapshot = $null
    for ($index = 0; $index -lt $SourceSession.handles.Count; $index++) {
        $handle = [IntPtr]$SourceSession.handles[$index]
        if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1) -or -not $seen.Add($handle.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture))) {
            throw 'PRIVATE_COPY_SOURCE_REJECTED'
        }
        $handles[$index] = $handle
        $directory = $index -lt $SourceSession.handles.Count - 1
        try {
            $actual = New-XRayPrivateCopyMetadataSnapshot (Get-XRayHandleMetadata $handle $directory)
            $saved = New-XRayPrivateCopyMetadataSnapshot $SourceSession.chain[$index]
        } catch { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
        if ($actual.directory -ne $directory -or $saved.directory -ne $directory -or
            $actual.volume -cne $saved.volume -or $actual.fileId -cne $saved.fileId -or
            $actual.attributes -ne $saved.attributes) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
        if ($directory) {
            $parentSnapshots.Add([pscustomobject]@{ handle = $handle; metadata = $actual })
        } else {
            $leafSnapshot = $actual
            if ($actual.length -gt 2147483648 -or $actual.length -gt $SourceSession.maxBytes) {
                throw 'PRIVATE_COPY_LIMIT_REJECTED'
            }
            if (-not (Test-XRayPrivateCopyMetadataEqual $actual $SourceSession.before) -or
                -not (Test-XRayPrivateCopyMetadataEqual $actual $saved)) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
        }
    }
    if ([IntPtr]$SourceSession.leaf -ne $handles[$handles.Length - 1] -or
        $null -eq $leafSnapshot -or $leafSnapshot.directory) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    foreach ($parent in $parentSnapshots) {
        if ($parent.metadata.volume -cne $leafSnapshot.volume) { throw 'PRIVATE_COPY_SOURCE_REJECTED' }
    }
    return [pscustomobject]@{
        session = $SourceSession; handleList = $SourceSession.handles; chainList = $SourceSession.chain
        handles = $handles; parents = [object[]]$parentSnapshots.ToArray(); leaf = $leafSnapshot
        maxBytes = [long]$SourceSession.maxBytes
    }
}

function Assert-XRayPrivateCopySourceStable($Snapshot, [bool]$Consumed) {
    $session = $Snapshot.session
    if ($null -eq $session -or $session.released -ne $false -or $session.readStarted -ne $Consumed -or
        -not [object]::ReferenceEquals($session.handles, $Snapshot.handleList) -or
        -not [object]::ReferenceEquals($session.chain, $Snapshot.chainList) -or
        $session.handles.Count -ne $Snapshot.handles.Length -or $session.chain.Count -ne $Snapshot.handles.Length -or
        [IntPtr]$session.leaf -ne $Snapshot.handles[$Snapshot.handles.Length - 1]) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    if (-not (Test-XRayPrivateCopyMetadataEqual $session.before $Snapshot.leaf) -or
        -not (Test-XRayPrivateCopyMetadataEqual $session.chain[$session.chain.Count - 1] $Snapshot.leaf)) {
        throw 'PRIVATE_COPY_SOURCE_CHANGED'
    }
    for ($index = 0; $index -lt $Snapshot.handles.Length; $index++) {
        if ([IntPtr]$session.handles[$index] -ne $Snapshot.handles[$index]) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    }
    for ($index = 0; $index -lt $Snapshot.parents.Count; $index++) {
        $saved = $Snapshot.parents[$index].metadata
        try { $actual = New-XRayPrivateCopyMetadataSnapshot (Get-XRayHandleMetadata $Snapshot.parents[$index].handle $true) }
        catch { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
        if ($actual.volume -cne $saved.volume -or $actual.fileId -cne $saved.fileId -or
            $actual.directory -ne $saved.directory -or $actual.attributes -ne $saved.attributes) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    }
    try { $actualLeaf = New-XRayPrivateCopyMetadataSnapshot (Get-XRayHandleMetadata $session.leaf $false) }
    catch { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    if (-not (Test-XRayPrivateCopyMetadataEqual $actualLeaf $Snapshot.leaf)) { throw 'PRIVATE_COPY_SOURCE_CHANGED' }
    return $actualLeaf
}

function Get-XRayPrivateCopyOutputFileEntry($FileSession, [bool]$RequireReady = $true) {
    $entry = Find-XRayOutputFileSession $FileSession
    if ($null -eq $entry -or -not [object]::ReferenceEquals($entry.session, $FileSession) -or $null -eq $entry.state) {
        throw 'PRIVATE_COPY_OUTPUT_REJECTED'
    }
    $state = $entry.state
    if (-not $RequireReady) { return $entry }
    if (-not $state.ready -or $state.status -cne 'ready' -or -not $state.created -or
        $state.released -or $state.handles -isnot [Collections.Generic.List[System.IntPtr]] -or
        $state.handles.Count -ne 1 -or [IntPtr]$state.handle -eq [IntPtr]::Zero -or
        [IntPtr]$state.handle -eq [IntPtr](-1) -or [IntPtr]$state.handles[0] -ne [IntPtr]$state.handle -or
        -not $state.aclVerified -or -not $state.ownerVerified -or -not $state.daclPresent -or -not $state.daclProtected -or
        $state.aclAceCount -lt 1 -or $null -eq $state.createdIdentity -or $null -eq $state.directoryIdentity) {
        throw 'PRIVATE_COPY_OUTPUT_REJECTED'
    }
    try {
        $actual = Get-XRayHandleMetadata ([IntPtr]$state.handle) $false
        $null = Assert-XRayOutputFileMetadataStable $actual $state.createdIdentity ([long]0)
    } catch { throw 'PRIVATE_COPY_OUTPUT_REJECTED' }
    return $entry
}

function Get-XRayPrivateArtifactCopySummary($Session) {
    $entry = Find-XRayPrivateCopyAnySession $Session
    if ($null -eq $entry) { throw 'PRIVATE_COPY_SESSION_INVALID' }
    $state = $entry.state
    $ownedHandleCount = 0
    if ($null -ne $state.outputFileState -and $null -ne $state.outputFileState.handles) {
        $ownedHandleCount = [int]$state.outputFileState.handles.Count
    }
    return [pscustomobject]@{
        version = 1; token = $state.token; status = [string]$state.status; ready = [bool]$state.ready
        created = [bool]$state.created; failureCode = $state.failureCode
        releaseStatus = [string]$state.releaseStatus; releaseFailureCode = $state.releaseFailureCode; released = [bool]$state.released
        sourceConsumed = [bool]$state.sourceConsumed; bytesRequested = [long]$state.bytesRequested
        sourceBytesRead = [long]$state.sourceBytesRead; bytesWritten = [long]$state.bytesWritten; copyBytesRead = [long]$state.copyBytesRead
        sourceSha256 = $state.sourceSha256; copySha256 = $state.copySha256
        sourceIdentityProof = $state.sourceIdentityProof; outputIdentityProof = $state.outputIdentityProof
        snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'; ownedHandleCount = $ownedHandleCount
    }
}

function New-XRayPrivateArtifactCopy($SourceSession, $DirectorySession) {
    if (-not $script:XRayPrivateArtifactCopySessions) {
        $script:XRayPrivateArtifactCopySessions = [Collections.Generic.List[object]]::new()
    }
    $public = [pscustomobject]@{ version = 1; token = $null }
    $state = [pscustomobject]@{
        status = 'rejected'; ready = $false; created = $false; failureCode = $null
        releaseStatus = 'none'; releaseFailureCode = $null; released = $false
        sourceConsumed = $false; bytesRequested = [long]0; sourceBytesRead = [long]0; bytesWritten = [long]0; copyBytesRead = [long]0
        sourceSha256 = $null; copySha256 = $null; sourceIdentityProof = $null; outputIdentityProof = $null; token = $null
        sourceSession = $SourceSession; sourceSnapshot = $null; directorySession = $DirectorySession; directoryIdentity = $null
        outputFileSession = $null; outputFileEntry = $null; outputFileState = $null
    }
    $null = Register-XRayPrivateCopySession $public $state
    $sourceHash = $null; $copyHash = $null; $buffer = [IntPtr]::Zero; $hashBytes = $null; $zeroBytes = $null
    try {
        Assert-XRayPrivateCopyDependencies
        $source = Assert-XRayPrivateCopySourceSession $SourceSession
        $state.sourceSnapshot = $source
        $state.bytesRequested = [long]$source.leaf.length
        $state.sourceIdentityProof = Get-XRayPrivateCopyIdentityProof $source.leaf
        $maximum = [long][Math]::Min([long]2147483648, $source.maxBytes)

        $directory = Assert-XRayOutputFileBorrowedDirectory $DirectorySession
        $state.directoryIdentity = $directory
    } catch {
        $state.failureCode = Get-XRayPrivateCopyFailure $_.Exception.Message
        $state.status = 'rejected'; $state.ready = $false
        return $public
    }

    try {
        $empty = [byte[]]::new(0)
        $fileSession = New-XRayPrivateArtifactOutputFile $DirectorySession $empty
        $state.outputFileSession = $fileSession
        $fileEntry = Get-XRayPrivateCopyOutputFileEntry $fileSession $false
        $state.outputFileEntry = $fileEntry; $state.outputFileState = $fileEntry.state
        if ($null -ne $fileEntry.state.directoryIdentity) { $state.directoryIdentity = $fileEntry.state.directoryIdentity }
        $fileSummary = Get-XRayPrivateArtifactOutputFileSummary $fileSession
        $state.created = [bool]$fileSummary.created
        $state.releaseStatus = 'held'
        if ($state.created) { $state.token = [string]$fileSummary.token; $public.token = $state.token }
        if (-not $fileSummary.ready -or -not $fileSummary.created -or $fileSummary.failureCode) { throw 'PRIVATE_COPY_OUTPUT_REJECTED' }
        $fileEntry = Get-XRayPrivateCopyOutputFileEntry $fileSession
        $state.outputFileEntry = $fileEntry; $state.outputFileState = $fileEntry.state

        $outputState = $state.outputFileState
        $outputState.ready = $false; $outputState.status = 'copying'
        $null = Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity
        $null = Assert-XRayPrivateCopySourceStable $source $false
        try {
            $buffer = New-XRayZeroBuffer 1048576
            $hashBytes = [byte[]]::new(1048576)
            $zeroBytes = [byte[]]::new(1048576)
        } catch { throw 'PRIVATE_COPY_BUFFER_FAILED' }
        $sourceHash = [Security.Cryptography.SHA256]::Create()
        $copyHash = [Security.Cryptography.SHA256]::Create()

        # M4 has no owner registry. This remains a trusted internal caller port; metadata only binds the held object.
        $SourceSession.readStarted = $true
        $state.sourceConsumed = $true
        $total = [long]0
        while ($total -lt $state.bytesRequested) {
            $count = Get-XRayPrivateCopyChunkLength $total $state.bytesRequested $maximum
            if ($count -le 0 -or $count -gt 1048576) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
            [Runtime.InteropServices.Marshal]::Copy($zeroBytes, 0, $buffer, [int]$count)
            $readArgs = [object[]]@([IntPtr]$SourceSession.leaf, $buffer, [uint32]$count, [uint32]0, [IntPtr]::Zero)
            try { $readResult = [int](Invoke-XRayNative ReadFile $readArgs) }
            catch { throw 'PRIVATE_COPY_SOURCE_READ_FAILED' }
            $actualRead = [uint32]$readArgs[3]
            if ($actualRead -gt [uint32]$count) { throw 'PRIVATE_COPY_SOURCE_SHORT_READ' }
            if ($actualRead -gt 0) {
                if ($state.sourceBytesRead -gt $state.bytesRequested - [long]$actualRead) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
                $state.sourceBytesRead += [long]$actualRead
            }
            if ($readResult -eq 0) { throw 'PRIVATE_COPY_SOURCE_READ_FAILED' }
            if ($actualRead -ne [uint32]$count -or $actualRead -eq 0) { throw 'PRIVATE_COPY_SOURCE_SHORT_READ' }

            [Runtime.InteropServices.Marshal]::Copy($buffer, $hashBytes, 0, [int]$actualRead)
            [void]$sourceHash.TransformBlock($hashBytes, 0, [int]$actualRead, $hashBytes, 0)
            try {
                $writeArgs = [object[]]@([IntPtr]$outputState.handle, $buffer, [uint32]$actualRead, [uint32]0, [IntPtr]::Zero)
                $writeResult = [int](Invoke-XRayOutputFileNative WriteFile $writeArgs)
            } catch { throw 'PRIVATE_COPY_WRITE_FAILED' }
            $actualWritten = [uint32]$writeArgs[3]
            if ($actualWritten -gt $actualRead) { throw 'PRIVATE_COPY_WRITE_COUNT_REJECTED' }
            if ($actualWritten -gt 0) {
                if ($state.bytesWritten -gt $state.bytesRequested - [long]$actualWritten) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
                $state.bytesWritten += [long]$actualWritten
                $outputState.bytesWritten += [long]$actualWritten
            }
            [Array]::Clear($hashBytes, 0, [int]$actualRead)
            if ($writeResult -eq 0) { throw 'PRIVATE_COPY_WRITE_FAILED' }
            if ($actualWritten -ne $actualRead -or $actualWritten -eq 0) { throw 'PRIVATE_COPY_WRITE_COUNT_REJECTED' }
            if ($total -gt $state.bytesRequested - [long]$actualRead) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
            $total += [long]$actualRead
        }
        if ($total -ne $state.bytesRequested -or $state.sourceBytesRead -ne $state.bytesRequested -or
            $state.bytesWritten -ne $state.bytesRequested) { throw 'PRIVATE_COPY_SOURCE_SHORT_READ' }
        $sourceEofArgs = [object[]]@([IntPtr]$SourceSession.leaf, $buffer, [uint32]1, [uint32]0, [IntPtr]::Zero)
        try { $sourceEofResult = [int](Invoke-XRayNative ReadFile $sourceEofArgs) }
        catch { throw 'PRIVATE_COPY_SOURCE_READ_FAILED' }
        $sourceEofCount = [uint32]$sourceEofArgs[3]
        if ($sourceEofResult -eq 0) { throw 'PRIVATE_COPY_SOURCE_READ_FAILED' }
        if ($sourceEofCount -ne 0) { throw 'PRIVATE_COPY_SOURCE_EOF_REJECTED' }

        [void]$sourceHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $sourceDigest = ([BitConverter]::ToString($sourceHash.Hash)).Replace('-', '')
        $outputState.inputSha256 = $sourceDigest
        $outputState.bytesRequested = $state.bytesRequested
        $null = Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity
        try {
            $targetAfterWrite = Assert-XRayOutputFileMetadataStable (Get-XRayHandleMetadata ([IntPtr]$outputState.handle) $false) $outputState.createdIdentity $state.bytesRequested
        } catch { throw 'PRIVATE_COPY_TARGET_CHANGED' }
        if ((Invoke-XRayOutputFileNative SetFilePointerEx @([IntPtr]$outputState.handle, [int64]0, [IntPtr]::Zero, [uint32]0)) -eq 0) {
            throw 'PRIVATE_COPY_TARGET_CHANGED'
        }

        $readTotal = [long]0
        while ($readTotal -lt $state.bytesRequested) {
            $count = Get-XRayPrivateCopyChunkLength $readTotal $state.bytesRequested $maximum
            if ($count -le 0 -or $count -gt 1048576) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
            [Runtime.InteropServices.Marshal]::Copy($zeroBytes, 0, $buffer, [int]$count)
            $copyReadArgs = [object[]]@([IntPtr]$outputState.handle, $buffer, [uint32]$count, [uint32]0, [IntPtr]::Zero)
            try { $copyReadResult = [int](Invoke-XRayOutputFileNative ReadFile $copyReadArgs) }
            catch { throw 'PRIVATE_COPY_READ_FAILED' }
            $actualCopyRead = [uint32]$copyReadArgs[3]
            if ($actualCopyRead -gt [uint32]$count) { throw 'PRIVATE_COPY_READ_COUNT_REJECTED' }
            if ($actualCopyRead -gt 0) {
                if ($state.copyBytesRead -gt $state.bytesRequested - [long]$actualCopyRead) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
                $state.copyBytesRead += [long]$actualCopyRead
                $outputState.bytesRead += [long]$actualCopyRead
            }
            if ($copyReadResult -eq 0) { throw 'PRIVATE_COPY_READ_FAILED' }
            if ($actualCopyRead -ne [uint32]$count -or $actualCopyRead -eq 0) { throw 'PRIVATE_COPY_READ_COUNT_REJECTED' }
            [Runtime.InteropServices.Marshal]::Copy($buffer, $hashBytes, 0, [int]$actualCopyRead)
            [void]$copyHash.TransformBlock($hashBytes, 0, [int]$actualCopyRead, $hashBytes, 0)
            [Array]::Clear($hashBytes, 0, [int]$actualCopyRead)
            if ($readTotal -gt $state.bytesRequested - [long]$actualCopyRead) { throw 'PRIVATE_COPY_SIZE_REJECTED' }
            $readTotal += [long]$actualCopyRead
        }
        if ($readTotal -ne $state.bytesRequested -or $state.copyBytesRead -ne $state.bytesRequested) { throw 'PRIVATE_COPY_READ_COUNT_REJECTED' }
        $copyEofArgs = [object[]]@([IntPtr]$outputState.handle, $buffer, [uint32]1, [uint32]0, [IntPtr]::Zero)
        try { $copyEofResult = [int](Invoke-XRayOutputFileNative ReadFile $copyEofArgs) }
        catch { throw 'PRIVATE_COPY_READ_FAILED' }
        if ($copyEofResult -eq 0) { throw 'PRIVATE_COPY_READ_FAILED' }
        if ([uint32]$copyEofArgs[3] -ne 0) { throw 'PRIVATE_COPY_EOF_REJECTED' }
        [void]$copyHash.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $copyDigest = ([BitConverter]::ToString($copyHash.Hash)).Replace('-', '')
        if ($copyDigest -cne $sourceDigest) { throw 'PRIVATE_COPY_CONTENT_MISMATCH' }

        $null = Assert-XRayPrivateCopySourceStable $source $true
        $null = Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity
        try {
            $targetAfterRead = Assert-XRayOutputFileMetadataStable (Get-XRayHandleMetadata ([IntPtr]$outputState.handle) $false) $outputState.createdIdentity $state.bytesRequested
        } catch { throw 'PRIVATE_COPY_TARGET_CHANGED' }
        if ([long]$targetAfterRead.creation -ne [long]$targetAfterWrite.creation) { throw 'PRIVATE_COPY_TARGET_CHANGED' }

        $state.sourceSha256 = $sourceDigest; $state.copySha256 = $copyDigest
        $state.outputIdentityProof = Get-XRayPrivateCopyIdentityProof $targetAfterRead
        $outputState.createdIdentity = $targetAfterRead
        $outputState.identityProof = Get-XRayOutputFileIdentityProof $targetAfterRead
        $outputState.bytesRequested = $state.bytesRequested; $outputState.bytesWritten = $state.bytesWritten
        $outputState.bytesRead = $state.copyBytesRead; $outputState.inputSha256 = $sourceDigest; $outputState.readbackSha256 = $copyDigest
        $outputState.status = 'ready'; $outputState.ready = $true
        $state.status = 'ready'; $state.ready = $true; $state.failureCode = $null
    } catch {
        $state.failureCode = Get-XRayPrivateCopyFailure $_.Exception.Message
        $state.status = 'rejected'; $state.ready = $false
        if ($null -ne $state.outputFileState) {
            $state.outputFileState.ready = $false
            if ($state.outputFileState.status -ceq 'copying' -or $state.outputFileState.status -ceq 'ready') {
                $state.outputFileState.status = 'rejected'
            }
        }
    } finally {
        if ($null -ne $sourceHash) { $sourceHash.Dispose() }
        if ($null -ne $copyHash) { $copyHash.Dispose() }
        if ($null -ne $hashBytes) { [Array]::Clear($hashBytes, 0, $hashBytes.Length) }
        if ($null -ne $zeroBytes) { [Array]::Clear($zeroBytes, 0, $zeroBytes.Length) }
        if ($buffer -ne [IntPtr]::Zero) {
            try { [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(1048576), 0, $buffer, 1048576) } catch { }
            [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
        }
    }
    return $public
}

function Close-XRayPrivateArtifactCopy($Session) {
    $entry = Find-XRayPrivateCopySession $Session
    if ($null -eq $entry) {
        $released = Find-XRayPrivateCopyAnySession $Session
        if ($null -ne $released -and $released.state.released) { return (Get-XRayPrivateArtifactCopySummary $Session) }
        throw 'PRIVATE_COPY_SESSION_INVALID'
    }
    $state = $entry.state
    if ($state.released) { return (Get-XRayPrivateArtifactCopySummary $Session) }
    if ($null -ne $state.outputFileSession) {
        try {
            $current = Find-XRayOutputFileSession $state.outputFileSession
            if ($null -eq $current -or -not [object]::ReferenceEquals($current, $state.outputFileEntry) -or
                -not [object]::ReferenceEquals($current.session, $state.outputFileSession)) { throw 'PRIVATE_COPY_SESSION_INVALID' }
            $fileRelease = Close-XRayPrivateArtifactOutputFile $state.outputFileSession
            $state.outputFileState = $current.state
            if (-not $fileRelease.released -or $fileRelease.releaseStatus -cne 'released' -or $fileRelease.ownedHandleCount -ne 0) {
                $state.ready = $false; $state.status = 'rejected'; $state.released = $false
                $state.releaseStatus = 'unconfirmed'; $state.releaseFailureCode = 'PRIVATE_COPY_CLOSE_UNCONFIRMED'
                return (Get-XRayPrivateArtifactCopySummary $Session)
            }
        } catch {
            $state.ready = $false; $state.status = 'rejected'; $state.released = $false
            $state.releaseStatus = 'unconfirmed'; $state.releaseFailureCode = 'PRIVATE_COPY_CLOSE_UNCONFIRMED'
            if ($null -eq $state.failureCode) { $state.failureCode = Get-XRayPrivateCopyFailure $_.Exception.Message }
            return (Get-XRayPrivateArtifactCopySummary $Session)
        }
    }
    $state.ready = $false; $state.released = $true; $state.releaseStatus = 'released'; $state.releaseFailureCode = $null
    if ($state.status -ceq 'ready') { $state.status = 'released' }
    Complete-XRayPrivateCopySession $entry
    return (Get-XRayPrivateArtifactCopySummary $Session)
}
