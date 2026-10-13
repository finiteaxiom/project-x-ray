# Test-only entry. Uses only caller-owned fixtures and emits a summary with at most three file samples.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
$script:controlReader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true), $false, 1024)
$session = $null
$exitCode = 3

function Assert-XRayTreeJsonTokens([string]$Text) {
    $matches = [regex]::Matches($Text, '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null')
    $offset = 0; $stack = [Collections.Generic.List[object]]::new(); $started = $false
    foreach ($match in $matches) {
        if ($Text.Substring($offset, $match.Index - $offset) -notmatch '^[ \t\r\n]*$') { throw 'CONTROL_INVALID' }
        $offset = $match.Index + $match.Length; $token = $match.Value
        if ($stack.Count -eq 0) {
            if ($started -or $token -ne '{') { throw 'CONTROL_INVALID' }; $started = $true
            $stack.Add([pscustomobject]@{ kind = 'object'; state = 'key-or-end'; keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) })
        } else {
            $current = $stack[$stack.Count - 1]
            if ($current.kind -eq 'object') {
                if (($current.state -eq 'key-or-end' -or $current.state -eq 'key-required') -and $token.StartsWith('"')) {
                    $key = ('{"key":' + $token + '}') | ConvertFrom-Json
                    if (-not $current.keys.Add($key.key)) { throw 'CONTROL_INVALID' }; $current.state = 'colon'
                } elseif ($token -eq '}' -and $current.state -in @('key-or-end', 'comma-or-end')) { $stack.RemoveAt($stack.Count - 1)
                } elseif ($current.state -eq 'colon' -and $token -eq ':') { $current.state = 'value'
                } elseif ($current.state -eq 'comma-or-end' -and $token -eq ',') { $current.state = 'key-required'
                } elseif ($current.state -eq 'value' -and $token -eq '{') {
                    if ($stack.Count -ge 4) { throw 'CONTROL_INVALID' }; $current.state = 'comma-or-end'
                    $stack.Add([pscustomobject]@{ kind = 'object'; state = 'key-or-end'; keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) })
                } elseif ($current.state -eq 'value' -and $token -eq '[') {
                    if ($stack.Count -ge 4) { throw 'CONTROL_INVALID' }; $current.state = 'comma-or-end'
                    $stack.Add([pscustomobject]@{ kind = 'string-array'; state = 'value-or-end' })
                } elseif ($current.state -eq 'value' -and $token -notin @('{', '}', '[', ']', ':', ',')) { $current.state = 'comma-or-end'
                } else { throw 'CONTROL_INVALID' }
            } else {
                if ($token -eq ']' -and $current.state -in @('value-or-end', 'comma-or-end')) { $stack.RemoveAt($stack.Count - 1)
                } elseif ($current.state -eq 'comma-or-end' -and $token -eq ',') { $current.state = 'value-required'
                } elseif ($current.state -in @('value-or-end', 'value-required') -and $token.StartsWith('"')) { $current.state = 'comma-or-end'
                } else { throw 'CONTROL_INVALID' }
            }
        }
    }
    if (-not $started -or $stack.Count -ne 0 -or $Text.Substring($offset) -notmatch '^[ \t\r\n]*$') { throw 'CONTROL_INVALID' }
}

function Read-XRayTreeControl {
    $deadline = [DateTime]::UtcNow.AddSeconds(30); $builder = [Text.StringBuilder]::new()
    while ($true) {
        $character = [char[]]::new(1); $pending = $script:controlReader.ReadAsync($character, 0, 1)
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not $pending.Wait($remaining)) { throw 'CONTROL_TIMEOUT' }
        if ($pending.Result -eq 0) { throw 'CONTROL_EOF' }
        if ($character[0] -eq "`n") { if ($builder.Length -gt 0 -and $builder[$builder.Length - 1] -eq "`r") { $builder.Length-- }; break }
        [void]$builder.Append($character[0]); if ($builder.Length -gt 16384) { throw 'CONTROL_INVALID' }
    }
    try { Assert-XRayTreeJsonTokens $builder.ToString(); return ($builder.ToString() | ConvertFrom-Json) } catch { throw 'CONTROL_INVALID' }
}

function Assert-XRayTreeKeys($Value, [string[]]$Keys) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'CONTROL_INVALID' }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Keys.Count) { throw 'CONTROL_INVALID' }
    foreach ($key in $Keys) { if ($key -cnotin $actual) { throw 'CONTROL_INVALID' } }
}

function Send-XRayTreeFrame($Frame) { [Console]::Out.WriteLine(($Frame | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush() }

function Assert-XRayTreeFixtureOwnerMarker([string]$DirectoryPath) {
    $normalizedDirectoryPath = $DirectoryPath.TrimEnd([char]92)
    if ($DirectoryPath -notmatch '^[A-Za-z]:\\[^\\]' -or $DirectoryPath.Contains('/') -or $DirectoryPath.Length -gt 32760 -or
        [IO.Path]::GetFileName($normalizedDirectoryPath) -cne 'observed') { throw 'FIXTURE_SETUP_INVALID' }
    $parent = [IO.Path]::GetDirectoryName($normalizedDirectoryPath)
    if ([string]::IsNullOrEmpty($parent)) { throw 'FIXTURE_SETUP_INVALID' }
    $parentName = [IO.Path]::GetFileName($parent.TrimEnd([char]92))
    if (-not $parentName.StartsWith('xray-m7-owned-', [StringComparison]::OrdinalIgnoreCase)) { throw 'FIXTURE_SETUP_INVALID' }
    $marker = Join-Path $parent '.xray-owned-material'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw 'FIXTURE_SETUP_INVALID' }
    $attributes = [IO.File]::GetAttributes($marker)
    if (($attributes -band [IO.FileAttributes]::Directory) -ne 0 -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        [IO.File]::ReadAllText($marker) -cne 'M7 self-owned material; retained, no recursive cleanup') { throw 'FIXTURE_SETUP_INVALID' }
    return $true
}

function Prepare-XRayTreeFixtureDirectories([string]$DirectoryPath, [object[]]$SetupPaths) {
    if ($SetupPaths.Count -eq 0) {
        return [pscustomobject]@{ markerVerified = $false; ownerSessionOpened = $false; ownerReleased = $false
            requestedDirectoryCount = 0; queriedDirectoryCount = 0 }
    }
    if ($SetupPaths.Count -gt 64) { throw 'FIXTURE_SETUP_INVALID' }
    $null = Assert-XRayTreeFixtureOwnerMarker $DirectoryPath
    $pathSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $paths = [Collections.Generic.List[string]]::new(); $totalPathBytes = [long]0
    foreach ($candidate in $SetupPaths) {
        if ($candidate -isnot [string] -or $candidate.Length -eq 0 -or $candidate.IndexOf([char]92) -ge 0 -or
            $candidate.StartsWith('/') -or $candidate.EndsWith('/') -or [Text.Encoding]::UTF8.GetByteCount($candidate) -gt 512) { throw 'FIXTURE_SETUP_INVALID' }
        $candidateBytes = [long][Text.Encoding]::UTF8.GetByteCount($candidate)
        if ($totalPathBytes -gt 8192 - $candidateBytes) { throw 'FIXTURE_SETUP_INVALID' }
        $totalPathBytes += $candidateBytes
        $components = $candidate.Split([char]'/')
        if ($components.Count -gt 64) { throw 'FIXTURE_SETUP_INVALID' }
        foreach ($component in $components) { Assert-XRayDirectoryName $component }
        if (-not $pathSet.Add($candidate)) { throw 'FIXTURE_SETUP_INVALID' }
        $paths.Add($candidate)
    }
    foreach ($candidate in $paths) {
        $components = $candidate.Split([char]'/'); $parent = ''
        for ($index = 0; $index -lt $components.Count; $index++) {
            $prefix = if ($parent.Length -eq 0) { $components[$index] } else { $parent + '/' + $components[$index] }
            if (-not $pathSet.Contains($prefix)) { throw 'FIXTURE_SETUP_INVALID' }
            $parent = $prefix
        }
    }
    $orderedPaths = [string[]]$paths.ToArray()
    [Array]::Sort($orderedPaths, [StringComparer]::OrdinalIgnoreCase)
    $session = $null; $ownerReleased = $false
    try {
        $session = Open-XRayArtifactDirectorySession $DirectoryPath
        $rootMetadata = Copy-XRayDirectoryMetadata $session.before
        if (-not $rootMetadata.directory) { throw 'FIXTURE_SETUP_INVALID' }
        $identities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($ancestorMetadata in $session.chain) {
            if (-not $identities.Add((Get-XRayTreeIdentityKey $ancestorMetadata))) { throw 'DIRECTORY_COLLISION' }
        }
        $handleByPath = [Collections.Generic.Dictionary[string, IntPtr]]::new([StringComparer]::OrdinalIgnoreCase)
        $handleByPath.Add('', $session.leaf)
        foreach ($relativePath in $orderedPaths) {
            $separator = $relativePath.LastIndexOf('/')
            $parentPath = if ($separator -lt 0) { '' } else { $relativePath.Substring(0, $separator) }
            $component = if ($separator -lt 0) { $relativePath } else { $relativePath.Substring($separator + 1) }
            if (-not $handleByPath.ContainsKey($parentPath) -or $session.handles.Count -ge 129) { throw 'FIXTURE_SETUP_INVALID' }
            $handle = Open-XRayRelativeHandle $handleByPath[$parentPath] $component $true
            if ($session.handles.Contains($handle)) { throw 'DIRECTORY_CHANGED' }
            # The preparation session owns each opened HANDLE before metadata validation.
            $session.handles.Add($handle)
            $metadata = Copy-XRayDirectoryMetadata (Get-XRayDirectoryMetadata $handle $true)
            if (-not $metadata.directory) { throw 'TYPE_REJECTED' }
            if ($metadata.volume -cne $session.before.volume) { throw 'VOLUME_REJECTED' }
            if (-not $identities.Add((Get-XRayTreeIdentityKey $metadata))) { throw 'DIRECTORY_COLLISION' }
            $handleByPath.Add($relativePath, $handle)
        }
        Close-XRayArtifactSession $session
        if (-not $session.released) { throw 'HANDLE_CLOSE_UNCONFIRMED' }
        $ownerReleased = $session.released
    } finally {
        if ($null -ne $session -and -not $session.released) { Close-XRayArtifactSession $session }
    }
    return [pscustomobject]@{ markerVerified = $true; ownerSessionOpened = $true; ownerReleased = $ownerReleased
        requestedDirectoryCount = $paths.Count + 1; queriedDirectoryCount = $paths.Count + 1 }
}

try {
    $start = Read-XRayTreeControl
    Assert-XRayTreeKeys $start @('protocolVersion', 'type', 'runId', 'token', 'input')
    if ($start.protocolVersion -isnot [int] -or $start.protocolVersion -ne 1 -or $start.type -isnot [string] -or $start.type -cne 'start' -or
        $start.runId -isnot [string] -or $start.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
        $start.token -isnot [string] -or $start.token -notmatch '^[A-Za-z0-9_-]{32}$') { throw 'CONTROL_INVALID' }
    Assert-XRayTreeKeys $start.input @('directoryPath', 'fixtureMode', 'setupPaths')
    $modes = @('ordinary', 'post-vector-add', 'post-vector-field', 'metadata-change-write', 'late-subtree-add', 'late-subtree-metadata', 'late-file-metadata', 'query-error', 'close-failure')
    if ($start.input.directoryPath -isnot [string] -or $start.input.fixtureMode -isnot [string] -or $start.input.fixtureMode -cnotin $modes -or
        $start.input.setupPaths -isnot [array] -or $start.input.setupPaths.Count -gt 64) { throw 'CONTROL_INVALID' }
    $script:fixturePreparation = Prepare-XRayTreeFixtureDirectories -DirectoryPath $start.input.directoryPath -SetupPaths $start.input.setupPaths
    if ($script:fixturePreparation.ownerSessionOpened) {
        [Console]::Error.WriteLine(('ROOT_PRIME_OWN_DIRECTORY_METADATA:{0}:{1}' -f $script:fixturePreparation.queriedDirectoryCount, $script:fixturePreparation.ownerReleased))
    }
    $script:mode = $start.input.fixtureMode; $script:ownedDirectory = $start.input.directoryPath
    $script:vectorCalls = 0; $script:enumerations = 0; $script:targetHandle = [IntPtr]::Zero; $script:readComplete = $false
    $script:fileObservationCalls = 0; $script:lateSubtreeInjected = $false; $script:lateMetadataArmed = $false; $script:lateMetadataInjected = $false
    $script:targetDirectoryHandle = [IntPtr]::Zero; $script:postVectorFieldInjected = $false; $script:savedPage = ${function:Invoke-XRayDirectoryPage}
    function Invoke-XRayDirectoryPage([IntPtr]$Handle, [int]$Class, [IntPtr]$Buffer, [uint32]$Bytes) {
        if ($Class -eq 20) {
            $script:enumerations++
            if ($script:mode -ceq 'post-vector-add' -and $script:enumerations -eq 2) { [IO.File]::WriteAllText([IO.Path]::Combine($script:ownedDirectory, 'added-after-vector-owned'), 'tree-owned') }
        }
        if ($script:mode -ceq 'query-error') { return [pscustomobject]@{ success = $false; error = 5 } }
        $result = & $script:savedPage $Handle $Class $Buffer $Bytes
        if ($result.success -and $Class -eq 20 -and $script:mode -ceq 'post-vector-field' -and $script:enumerations -eq 2 -and -not $script:postVectorFieldInjected) {
            $offset = 0
            while ($offset -lt 65536 - 90) {
                $nameBytes = [Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset + 60)
                if ($nameBytes -lt 2 -or $nameBytes -gt 510 -or ($nameBytes % 2) -ne 0 -or $nameBytes -gt 65536 - $offset - 88) { throw 'CONTROL_INVALID' }
                $name = [Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($Buffer, $offset + 88), [int]($nameBytes / 2))
                if ($name -cnotin @('.', '..') -and $name -ceq 'member') {
                    [Runtime.InteropServices.Marshal]::WriteInt64($Buffer, $offset + 24, ([Runtime.InteropServices.Marshal]::ReadInt64($Buffer, $offset + 24) + 1))
                    $script:postVectorFieldInjected = $true
                }
                $next = [Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset); if ($next -le 0) { break }; $offset += $next
            }
        }
        return $result
    }
    $script:savedNative = ${function:Invoke-XRayNative}
    function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
        if ($Name -ceq 'CloseHandle' -and $script:mode -ceq 'close-failure') { $script:closeCalls++; if ($script:closeCalls -eq 1) { return 0 } }
        $value = & $script:savedNative $Name $Arguments
        if ($Name -ceq 'ReadFile' -and $value -ne 0 -and [long]$Arguments[3] -eq 0) { $script:readComplete = $true }
        return $value
    }
    $script:closeCalls = 0; $script:savedMetadata = ${function:Get-XRayDirectoryMetadata}
    function Get-XRayDirectoryMetadata([IntPtr]$Handle, [bool]$Directory) {
        $metadata = & $script:savedMetadata $Handle $Directory
        if (-not $Directory -and $script:targetHandle -eq [IntPtr]::Zero) { $script:targetHandle = $Handle }
        if ($script:mode -ceq 'metadata-change-write' -and $script:readComplete -and $Handle -eq $script:targetHandle -and -not $script:metadataMutated) {
            $metadata.write += 1; $script:metadataMutated = $true
        }
        if ($script:mode -ceq 'late-subtree-metadata' -and $script:lateMetadataArmed -and $Directory -and
            $Handle -eq $script:targetDirectoryHandle -and -not $script:lateMetadataInjected) {
            $metadata.change += 1; $script:lateMetadataInjected = $true
        }
        if ($script:mode -ceq 'late-file-metadata' -and $script:lateMetadataArmed -and -not $Directory -and
            $Handle -eq $script:targetHandle -and -not $script:lateMetadataInjected) {
            $metadata.links += 1; $script:lateMetadataInjected = $true
        }
        return $metadata
    }
    $script:metadataMutated = $false
    $script:savedOpenRelative = ${function:Open-XRayRelativeHandle}
    function Open-XRayRelativeHandle([IntPtr]$Parent, [string]$Component, [bool]$Directory) {
        $handle = & $script:savedOpenRelative $Parent $Component $Directory
        if ($script:mode -ceq 'late-subtree-metadata' -and $Directory -and $Component -ceq 'b' -and $script:targetDirectoryHandle -eq [IntPtr]::Zero) {
            $script:targetDirectoryHandle = $handle
        }
        return $handle
    }
    $script:savedFileObservation = ${function:Get-XRayArtifactObservation}
    function Get-XRayArtifactObservation($View, [bool]$CapturePeHeader = $false) {
        $nextCall = $script:fileObservationCalls + 1
        if ($script:mode -ceq 'late-subtree-add' -and $nextCall -eq 2) {
            $marker = Join-Path (Split-Path $script:ownedDirectory -Parent) '.xray-owned-material'
            $targetDirectory = Join-Path (Join-Path $script:ownedDirectory 'a') 'b'
            $targetFile = Join-Path $targetDirectory 'added-after-subtree'
            if (-not (Test-Path -LiteralPath $marker -PathType Leaf) -or
                [IO.File]::ReadAllText($marker) -cne 'M7 self-owned material; retained, no recursive cleanup' -or
                -not (Test-Path -LiteralPath $targetDirectory -PathType Container) -or
                (Test-Path -LiteralPath $targetFile)) { throw 'FIXTURE_NOT_READY' }
            [IO.File]::WriteAllText($targetFile, 'late tree-owned insertion')
            $script:lateSubtreeInjected = $true
        }
        $script:fileObservationCalls = $nextCall
        $observation = & $script:savedFileObservation $View $CapturePeHeader
        if ($script:mode -cin @('late-subtree-metadata', 'late-file-metadata') -and $script:fileObservationCalls -eq 2) { $script:lateMetadataArmed = $true }
        return $observation
    }
    $script:savedTreeVector = ${function:Get-XRayDirectoryVector}
    function Get-XRayDirectoryVector([IntPtr]$Handle, [IntPtr]$Buffer, [byte[]]$Page, [int]$MaxMembers = 128, [int]$MaxCalls = 132, [int]$MaxRecords = 130, [long]$MaxAccountedBytes = 33554432) {
        $script:vectorCalls++
        return (& $script:savedTreeVector $Handle $Buffer $Page $MaxMembers $MaxCalls $MaxRecords $MaxAccountedBytes)
    }
    $session = Open-XRayArtifactDirectorySession $start.input.directoryPath
    $observation = Get-XRayArtifactTreeObservation $session
    $digest = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($record in $observation.files) {
            $line = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress -Depth 8) + "`n")
            [void]$digest.TransformBlock($line, 0, $line.Length, $line, 0)
            [Array]::Clear($line, 0, $line.Length)
        }
        [void]$digest.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $recordDigest = ([BitConverter]::ToString($digest.Hash)).Replace('-', '').ToLowerInvariant()
    } finally { $digest.Dispose() }
    $sample = @($observation.files | Select-Object -First 3)
    Send-XRayTreeFrame @{ protocolVersion = 1; type = 'ready'; runId = $start.runId; token = $start.token
        payload = @{ fixturePreparation = $script:fixturePreparation
            summary = @{ status = $observation.status; scope = $observation.scope; snapshotStatus = $observation.snapshotStatus
                signatureStatus = $observation.signatureStatus; fileCount = $observation.fileCount; directoryCount = $observation.directoryCount
                bytesRead = $observation.bytesRead; enumerationCalls = $observation.enumerationCalls; ownerHandleCount = $observation.ownerHandleCount
                borrowedViewCount = $observation.borrowedViewCount; borrowedViewHandleCount = $observation.borrowedViewHandleCount; recordDigest = $recordDigest }
            sample = $sample; processId = $PID; psVersion = $PSVersionTable.PSVersion.ToString(); pointerBytes = [IntPtr]::Size } }
    $release = Read-XRayTreeControl
    Assert-XRayTreeKeys $release @('protocolVersion', 'type', 'runId', 'token')
    if ($release.protocolVersion -isnot [int] -or $release.protocolVersion -ne 1 -or $release.type -isnot [string] -or $release.type -cne 'release' -or
        $release.runId -isnot [string] -or $release.token -isnot [string] -or $release.runId -cne $start.runId -or $release.token -cne $start.token) { throw 'CONTROL_INVALID' }
    Close-XRayArtifactSession $session
    if (-not $session.released) { throw 'HANDLE_CLOSE_UNCONFIRMED' }
    Send-XRayTreeFrame @{ protocolVersion = 1; type = 'terminal'; runId = $start.runId; token = $start.token; status = 'released' }
    $exitCode = 0
} catch {
    $code = $_.Exception.Message
    if ($code -cnotin @('CONTROL_TIMEOUT', 'CONTROL_EOF', 'CONTROL_INVALID', 'SESSION_INVALID', 'RUNTIME_UNSUPPORTED', 'DIRECTORY_BINDING_FAILED',
        'DIRECTORY_QUERY_FAILED', 'DIRECTORY_PAGE_INVALID', 'DIRECTORY_TYPE_REJECTED', 'DIRECTORY_ID_REJECTED', 'DIRECTORY_COLLISION', 'DIRECTORY_LIMIT',
        'DIRECTORY_CHANGED', 'TREE_LIMIT', 'TREE_PATH_LIMIT', 'TREE_SIZE_LIMIT', 'TREE_DEADLINE', 'TREE_OBSERVATION_FAILED', 'OPEN_REJECTED',
        'REPARSE_REJECTED', 'TYPE_REJECTED', 'SIZE_LIMIT', 'FILE_CHANGED', 'SIZE_OR_LENGTH_CHANGED', 'SHORT_READ', 'READ_FAILED', 'NOT_DISK',
        'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'VOLUME_REJECTED', 'HANDLE_CLOSE_UNCONFIRMED')) { $code = 'PROBE_FAILED' }
    if ($script:mode -ceq 'post-vector-field' -and $script:postVectorFieldInjected -and $code -ceq 'DIRECTORY_CHANGED') { $exitCode = 9 }
    if ($script:mode -ceq 'late-subtree-add') {
        if ($script:lateSubtreeInjected -and $code -ceq 'DIRECTORY_CHANGED') { $exitCode = 9 } else { $exitCode = 10 }
    }
    if ($script:mode -cin @('late-subtree-metadata', 'late-file-metadata')) {
        if ($script:lateMetadataInjected -and $code -ceq 'DIRECTORY_CHANGED') { $exitCode = 9 } else { $exitCode = 10 }
    }
    [Console]::Error.WriteLine($code)
} finally {
    if ($null -ne $digest) { $digest.Dispose() }
    try { if ($null -ne $session -and -not $session.released) { Close-XRayArtifactSession $session } }
    catch { [Console]::Error.WriteLine('HANDLE_CLOSE_UNCONFIRMED'); $exitCode = 4 }
}
exit $exitCode
