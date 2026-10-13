# Internal recursive observation. Import defines functions only; M4 retains every HANDLE until release.

function Add-XRayTreeAccountedValue($State, $Value, [long]$Reserve = 256) {
    $bytes = [long]([Text.Encoding]::UTF8.GetByteCount(($Value | ConvertTo-Json -Compress -Depth 8)) + $Reserve)
    if ($bytes -lt 0 -or $State.accountedBytes -gt 33554432 - $bytes) { throw 'TREE_LIMIT' }
    $State.accountedBytes += $bytes
    return $bytes
}

function Assert-XRayTreeDeadline($State) {
    if ($State.timer.Elapsed.TotalSeconds -gt 900) { throw 'TREE_DEADLINE' }
}

function Get-XRayTreeRelativePath([string]$Parent, [string]$Name) {
    Assert-XRayDirectoryName $Name
    $relative = if ($Parent.Length -eq 0) { $Name } else { $Parent + '/' + $Name }
    if ([Text.Encoding]::UTF8.GetByteCount($relative) -gt 512) { throw 'TREE_PATH_LIMIT' }
    return $relative
}

function Get-XRayTreeIdentityKey($Metadata) {
    if ($Metadata.volume -cnotmatch '^[0-9A-F]{16}$' -or $Metadata.fileId -cnotmatch '^[0-9A-F]{32}$') { throw 'DIRECTORY_ID_REJECTED' }
    return $Metadata.volume + ':' + $Metadata.fileId
}

function New-XRayTreeReadMetadata($Metadata) {
    $copy = Copy-XRayDirectoryMetadata $Metadata
    # M5 compares its before image as JSON; retain the native metadata field order and types for that private view.
    return [pscustomobject]@{ volume = [string]$copy.volume; fileId = [string]$copy.fileId; directory = [bool]$copy.directory
        attributes = [int]$copy.attributes; length = [long]$copy.length; allocation = [long]$copy.allocation; links = [int]$copy.links
        creation = [long]$copy.creation; write = [long]$copy.write; change = [long]$copy.change }
}

function Visit-XRayArtifactTreeDirectory($Session, $Node, [int]$Depth, [string]$RelativePath,
    [Collections.Generic.List[IntPtr]]$BranchHandles, [Collections.Generic.List[object]]$BranchMetadata, $State) {
    Assert-XRayTreeDeadline $State
    if ($Depth -gt 64 -or $State.directoryCount -gt 5000 -or $Session.handles.Count -gt 10000) { throw 'TREE_LIMIT' }
    $remaining = [long](33554432 - $State.accountedBytes)
    if ($remaining -lt 65536) { throw 'TREE_LIMIT' }
    $first = Get-XRayDirectoryVector $Node.handle $State.nativeBuffer $State.page 5000 5003 682 $remaining
    if ($State.directoryCalls -gt 50000 - $first.calls) { throw 'TREE_LIMIT' }
    $State.directoryCalls += $first.calls
    $firstCharge = [long]$first.accountedBytes
    if ($State.accountedBytes -gt 33554432 - $firstCharge) { throw 'TREE_LIMIT' }
    $State.accountedBytes += $firstCharge
    $null = Add-XRayTreeAccountedValue $State ([pscustomobject]@{ path = $RelativePath; depth = $Depth; metadata = $Node.metadataBefore; kind = 'directory' }) 384
    $State.directories.Add([pscustomobject]@{ handle = $Node.handle; path = $RelativePath; depth = $Depth
        entry = $Node.entry; metadataBefore = $Node.metadataBefore; first = $first })
    foreach ($entry in $first.entries) {
        Assert-XRayTreeDeadline $State
        $childPath = Get-XRayTreeRelativePath $RelativePath $entry.name
        if ($entry.directory) {
            if ($Depth -ge 64 -or $State.directoryCount -ge 5000) { throw 'TREE_LIMIT' }
        } else {
            if ($State.fileCount -ge 5000) { throw 'TREE_LIMIT' }
            if ($entry.length -gt 2147483648 -or $State.bytesRead -gt 8589934592 - $entry.length) { throw 'TREE_SIZE_LIMIT' }
        }
        if ($Session.handles.Count -ge 10000) { throw 'TREE_LIMIT' }
        $handle = Open-XRayRelativeHandle $Node.handle $entry.name $entry.directory
        # The single owner ledger takes the HANDLE before any metadata read or validation can fail.
        if ($Session.handles.Contains($handle)) { throw 'DIRECTORY_CHANGED' }
        $Session.handles.Add($handle)
        $metadata = Get-XRayDirectoryMetadata $handle $entry.directory
        if ($metadata.volume -cne $Session.before.volume) { throw 'VOLUME_REJECTED' }
        $metadataBefore = Copy-XRayDirectoryMetadata $metadata
        Assert-XRayDirectoryMember $entry $metadataBefore $Session.before.volume
        $key = Get-XRayTreeIdentityKey $metadataBefore
        if (-not $State.identities.Add($key)) { throw 'DIRECTORY_COLLISION' }
        $null = Add-XRayTreeAccountedValue $State ([pscustomobject]@{ path = $childPath; entry = $entry; metadata = $metadataBefore; kind = 'member' }) 384
        $State.members.Add([pscustomobject]@{ entry = $entry; handle = $handle; metadataBefore = $metadataBefore; path = $childPath })
        if ($entry.directory) {
            $State.directoryCount++
            $directoryNode = [pscustomobject]@{ handle = $handle; metadataBefore = $metadataBefore; entry = $entry }
            $BranchHandles.Add($handle); $BranchMetadata.Add($metadataBefore)
            try { Visit-XRayArtifactTreeDirectory $Session $directoryNode ($Depth + 1) $childPath $BranchHandles $BranchMetadata $State }
            finally {
                $BranchHandles.RemoveAt($BranchHandles.Count - 1)
                $BranchMetadata.RemoveAt($BranchMetadata.Count - 1)
            }
        } else {
            $State.fileCount++
            $viewHandles = [Collections.Generic.List[IntPtr]]::new()
            $viewChain = [Collections.Generic.List[object]]::new()
            if ($BranchHandles.Count -ne $BranchMetadata.Count) { throw 'TREE_LIMIT' }
            # M5's original session permits at most 64 parents plus the file leaf. The tree owner
            # still verifies every older parent and directory in the global final pass.
            $viewStart = [Math]::Max(0, $BranchHandles.Count - 64)
            for ($index = $viewStart; $index -lt $BranchHandles.Count; $index++) {
                $viewHandles.Add($BranchHandles[$index]); $viewChain.Add($BranchMetadata[$index])
            }
            $viewHandles.Add($handle); $viewChain.Add($metadataBefore)
            if ($viewHandles.Count -gt 65) { throw 'TREE_LIMIT' }
            $viewCharge = Add-XRayTreeAccountedValue $State ([pscustomobject]@{ path = $childPath; parentCount = ($BranchHandles.Count - $viewStart); borrowedHandleCount = $viewHandles.Count }) 4096
            try {
                $viewBefore = New-XRayTreeReadMetadata $metadataBefore
                $view = [pscustomobject]@{ released = $false; readStarted = $false; before = $viewBefore; leaf = $handle
                    maxBytes = [long]2147483648; handles = $viewHandles; chain = $viewChain }
                $observation = Get-XRayArtifactObservation $view $true
                if ($observation.bytesRead -ne $metadataBefore.length -or $observation.bytesRead -gt 2147483648 -or
                    $State.bytesRead -gt 8589934592 - $observation.bytesRead) { throw 'TREE_SIZE_LIMIT' }
                $State.bytesRead += [long]$observation.bytesRead
                $State.borrowedViewHandleCount += [long]$observation.heldHandles
                $record = [pscustomobject]@{ path = $childPath; identity = $observation.identity; length = ([long]$observation.bytesRead).ToString([Globalization.CultureInfo]::InvariantCulture)
                    sha256 = $observation.sha256; bytesRead = [long]$observation.bytesRead; bufferBytes = [int]1048576
                    readCalls = [long]$observation.readCalls; borrowedHandleCount = [int]$observation.heldHandles; peCapture = $observation.peCapture }
                $null = Add-XRayTreeAccountedValue $State $record 384
                if ($State.files.Count -ge 5000) { throw 'TREE_LIMIT' }
                $State.files.Add($record)
                $State.borrowedViewCount++
            } finally {
                $State.accountedBytes -= $viewCharge
            }
        }
        if ($Session.handles.Count -gt 10000) { throw 'TREE_LIMIT' }
    }
    Assert-XRayTreeDeadline $State
}

function Assert-XRayArtifactTreeFinalState($Session, $State, $RootMetadata, [int]$AncestorCount) {
    foreach ($directory in $State.directories) {
        Assert-XRayTreeDeadline $State
        $remaining = [long](33554432 - $State.accountedBytes)
        if ($remaining -lt 65536) { throw 'TREE_LIMIT' }
        $second = $null; $secondCharge = [long]0; $secondAccounted = $false
        try {
            $second = Get-XRayDirectoryVector $directory.handle $State.nativeBuffer $State.page 5000 5003 682 $remaining
            $secondCharge = [long]$second.accountedBytes
            if ($State.directoryCalls -gt 50000 - $second.calls) { throw 'TREE_LIMIT' }
            $State.directoryCalls += $second.calls
            if ($secondCharge -lt 0 -or $State.accountedBytes -gt 33554432 - $secondCharge) { throw 'TREE_LIMIT' }
            $State.accountedBytes += $secondCharge
            $secondAccounted = $true
            Assert-XRayDirectoryVectorsStable $directory.first $second
        } finally {
            if ($secondAccounted -and $secondCharge -gt 0) { $State.accountedBytes -= $secondCharge }
        }
    }
    foreach ($member in $State.members) {
        Assert-XRayTreeDeadline $State
        $actual = Get-XRayDirectoryMetadata $member.handle $member.entry.directory
        Assert-XRayDirectoryMetadataStable $member.metadataBefore $actual
        Assert-XRayDirectoryMember $member.entry $actual $Session.before.volume
    }
    # Session ancestors outside the tree stay owner-held; preserve M5's structural checks for
    # the full path and its complete final metadata check for the observed root directory.
    for ($index = 0; $index -lt $AncestorCount; $index++) {
        Assert-XRayTreeDeadline $State
        $actual = Get-XRayDirectoryMetadata $Session.handles[$index] $true
        $expected = $Session.chain[$index]
        if ($actual.volume -cne $expected.volume -or $actual.fileId -cne $expected.fileId -or $actual.attributes -ne $expected.attributes) { throw 'DIRECTORY_CHANGED' }
        if ($index -eq $AncestorCount - 1) { Assert-XRayDirectoryMetadataStable $RootMetadata $actual }
    }
}

function Get-XRayArtifactTreeObservation($Session) {
    if ($null -eq $Session -or $Session.released -or $Session.readStarted -or -not $Session.before.directory -or $Session.leaf -eq [IntPtr]::Zero) { throw 'SESSION_INVALID' }
    $Session.readStarted = $true
    # M5's reader borrows this adapter through PowerShell dynamic scope; it never closes these views.
    function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) { return (Get-XRayDirectoryMetadata $Handle $Directory) }
    $page = $null; $buffer = [IntPtr]::Zero; $result = $null
    $ancestors = $Session.handles.Count
    $state = $null
    try {
        Initialize-XRayDirectoryApi
        $page = [byte[]]::new(65536); $buffer = New-XRayZeroBuffer 65536
        $state = [pscustomobject]@{ timer = [Diagnostics.Stopwatch]::StartNew(); page = $page; nativeBuffer = $buffer
            identities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal); directoryCount = 1; fileCount = 0
            bytesRead = [long]0; directoryCalls = [long]0; borrowedViewCount = 0; borrowedViewHandleCount = [long]0
            accountedBytes = [long]131072; files = [Collections.Generic.List[object]]::new()
            directories = [Collections.Generic.List[object]]::new(); members = [Collections.Generic.List[object]]::new() }
        $null = Add-XRayTreeAccountedValue $state ([pscustomobject]@{ ancestorCount = $ancestors; metadata = $Session.chain }) (2048 + ($ancestors * 64))
        foreach ($ancestorMetadata in $Session.chain) {
            $key = Get-XRayTreeIdentityKey $ancestorMetadata
            if (-not $state.identities.Add($key)) { throw 'DIRECTORY_COLLISION' }
        }
        $rootBefore = Get-XRayDirectoryMetadata $Session.leaf $true
        if ($rootBefore.volume -cne $Session.before.volume -or $rootBefore.fileId -cne $Session.before.fileId -or
            $rootBefore.attributes -ne $Session.before.attributes) { throw 'DIRECTORY_CHANGED' }
        $rootMetadata = Copy-XRayDirectoryMetadata $rootBefore
        $rootNode = [pscustomobject]@{ handle = $Session.leaf; metadataBefore = $rootMetadata; entry = $null }
        $branchHandles = [Collections.Generic.List[IntPtr]]::new()
        $branchMetadata = [Collections.Generic.List[object]]::new()
        for ($index = 0; $index -lt $ancestors; $index++) {
            $branchHandles.Add($Session.handles[$index]); $branchMetadata.Add($Session.chain[$index])
        }
        Visit-XRayArtifactTreeDirectory $Session $rootNode 0 '' $branchHandles $branchMetadata $state
        Assert-XRayArtifactTreeFinalState $Session $state $rootMetadata $ancestors
        Assert-XRayTreeDeadline $state
        $output = [pscustomobject]@{ version = 1; status = 'observed'; scope = 'tree-files'; snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'
            identity = [pscustomobject]@{ volume = $rootMetadata.volume; fileId = $rootMetadata.fileId }
            fileCount = $state.fileCount; directoryCount = $state.directoryCount; bytesRead = $state.bytesRead
            enumerationCalls = $state.directoryCalls; borrowedViewCount = $state.borrowedViewCount
            borrowedViewHandleCount = $state.borrowedViewHandleCount; ownerHandleCount = $Session.handles.Count; files = @($state.files.ToArray()) }
        # File-record charges include their UTF8 record bytes plus reserve; account the fixed DTO envelope and array references here.
        $outputReserve = [long](1024 + ($state.files.Count * 16))
        if ($state.accountedBytes -gt 33554432 - $outputReserve) { throw 'TREE_LIMIT' }
        return $output
    } catch {
        if ($_.Exception.Message -cin @('RUNTIME_UNSUPPORTED', 'DIRECTORY_BINDING_FAILED', 'DIRECTORY_QUERY_FAILED', 'DIRECTORY_PAGE_INVALID', 'DIRECTORY_TYPE_REJECTED',
            'DIRECTORY_ID_REJECTED', 'DIRECTORY_COLLISION', 'DIRECTORY_LIMIT', 'DIRECTORY_CHANGED', 'TREE_LIMIT', 'TREE_PATH_LIMIT', 'TREE_SIZE_LIMIT',
            'TREE_DEADLINE', 'OPEN_REJECTED', 'REPARSE_REJECTED', 'TYPE_REJECTED', 'SIZE_LIMIT', 'FILE_CHANGED', 'SIZE_OR_LENGTH_CHANGED', 'SHORT_READ',
            'READ_FAILED', 'NOT_DISK', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'VOLUME_REJECTED', 'HANDLE_CLOSE_UNCONFIRMED', 'SESSION_INVALID')) { throw $_.Exception.Message }
        throw 'TREE_OBSERVATION_FAILED'
    } finally {
        if ($null -ne $page) { [Array]::Clear($page, 0, $page.Length) }
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
    }
}
