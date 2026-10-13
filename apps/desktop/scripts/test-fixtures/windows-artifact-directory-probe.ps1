# Test-only entry. Caller loads the trusted internal library, never candidate code.
# No scanner CLI registration. Only explicit, test-owned temporary materials.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false, $true)
$script:controlReader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false, $true), $false, 1024)
$session = $null
$exitCode = 3

function Assert-XRayJsonTokens([string]$Text) {
    # ConvertFrom-Json alone overwrites duplicate properties in PS 5.1.
    $matches = [regex]::Matches($Text, '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]:,]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null')
    $offset = 0; $stack = [Collections.Generic.List[object]]::new(); $started = $false
    foreach ($match in $matches) {
        if ($Text.Substring($offset, $match.Index - $offset) -notmatch '^[ \t\r\n]*$') { throw 'CONTROL_INVALID' }
        $offset = $match.Index + $match.Length; $token = $match.Value
        if ($stack.Count -eq 0) {
            if ($started -or $token -ne '{') { throw 'CONTROL_INVALID' }
            $started = $true
            $stack.Add([pscustomobject]@{ state = 'key-or-end'; keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) })
        } else {
            $current = $stack[$stack.Count - 1]
            if (($current.state -eq 'key-or-end' -or $current.state -eq 'key-required') -and $token.StartsWith('"')) {
                $key = ('{"key":' + $token + '}') | ConvertFrom-Json
                if (-not $current.keys.Add($key.key)) { throw 'CONTROL_INVALID' }
                $current.state = 'colon'
            } elseif ($token -eq '}' -and $current.state -in @('key-or-end', 'comma-or-end')) {
                $stack.RemoveAt($stack.Count - 1)
            } elseif ($current.state -eq 'colon' -and $token -eq ':') {
                $current.state = 'value'
            } elseif ($current.state -eq 'comma-or-end' -and $token -eq ',') {
                $current.state = 'key-required'
            } elseif ($current.state -eq 'value' -and $token -eq '{') {
                if ($stack.Count -ge 4) { throw 'CONTROL_INVALID' }
                $current.state = 'comma-or-end'
                $stack.Add([pscustomobject]@{ state = 'key-or-end'; keys = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase) })
            } elseif ($current.state -eq 'value' -and $token -notin @('{', '}', '[', ']', ':', ',')) {
                $current.state = 'comma-or-end'
            } else {
                throw 'CONTROL_INVALID'
            }
        }
    }
    if (-not $started -or $stack.Count -ne 0 -or $Text.Substring($offset) -notmatch '^[ \t\r\n]*$') { throw 'CONTROL_INVALID' }
}

function Read-XRayControl {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $builder = [Text.StringBuilder]::new()
    while ($true) {
        $character = [char[]]::new(1)
        $pending = $script:controlReader.ReadAsync($character, 0, 1)
        $remaining = [int][Math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
        if (-not $pending.Wait($remaining)) { throw 'CONTROL_TIMEOUT' }
        if ($pending.Result -eq 0) { throw 'CONTROL_EOF' }
        if ($character[0] -eq "`n") {
            if ($builder.Length -gt 0 -and $builder[$builder.Length - 1] -eq "`r") { $builder.Length-- }
            break
        }
        [void]$builder.Append($character[0])
        if ($builder.Length -gt 16384) { throw 'CONTROL_INVALID' }
    }
    try { Assert-XRayJsonTokens $builder.ToString(); return ($builder.ToString() | ConvertFrom-Json) } catch { throw 'CONTROL_INVALID' }
}

function Assert-XRayKeys($Value, [string[]]$Keys) {
    if ($null -eq $Value -or $Value -isnot [pscustomobject]) { throw 'CONTROL_INVALID' }
    $actual = @($Value.PSObject.Properties.Name)
    if ($actual.Count -ne $Keys.Count) { throw 'CONTROL_INVALID' }
    foreach ($key in $Keys) { if ($key -cnotin $actual) { throw 'CONTROL_INVALID' } }
}

function Send-XRayFrame($Frame) { [Console]::Out.WriteLine(($Frame | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush() }

# Begin protocol
try {
    $start = Read-XRayControl
    Assert-XRayKeys $start @('protocolVersion', 'type', 'runId', 'token', 'input')
    if ($start.protocolVersion -isnot [int] -or $start.protocolVersion -ne 1 -or $start.type -isnot [string] -or $start.type -cne 'start' -or $start.runId -isnot [string] -or
        $start.runId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $start.token -isnot [string] -or $start.token -notmatch '^[A-Za-z0-9_-]{32}$') { throw 'CONTROL_INVALID' }
    Assert-XRayKeys $start.input @('directoryPath', 'fixtureMode')
    if ($start.input.directoryPath -isnot [string] -or $start.input.fixtureMode -isnot [string] -or
        $start.input.fixtureMode -cnotin @('ordinary', 'repeat-read', 'query-error', 'bad-page', 'unknown-id', 'mismatch-id', 'add-member', 'remove-member', 'close-failure', 'undefined-tag', 'small-pages', 'post-vector-add', 'post-vector-field', 'directory-source-time', 'metadata-query-failure', 'cross-source-volume', 'cross-source-fileId', 'cross-source-directory', 'cross-source-attributes', 'cross-source-creation', 'cross-source-write', 'cross-source-change', 'cross-source-length', 'cross-source-allocation', 'metadata-change-volume', 'metadata-change-fileId', 'metadata-change-directory', 'metadata-change-attributes', 'metadata-change-creation', 'metadata-change-write', 'metadata-change-change', 'metadata-change-length', 'metadata-change-allocation', 'metadata-change-links', 'name-length', 'bad-utf16', 'id-collision')) { throw 'CONTROL_INVALID' }
    $script:mode = $start.input.fixtureMode; $script:enumerations = 0; $script:queryCalls = 0; $script:closeCalls = 0
    $script:postVectorFieldInjected = $false; $script:postVectorFieldTarget = $null
    $script:observedDirectoryHandle = [IntPtr]::Zero; $script:childMetadataQueries = 0; $script:sharedMemberMetadata = $null
    $script:eofErrors = [Collections.Generic.List[int]]::new()
    $script:ownedDirectory = $start.input.directoryPath
    $script:savedNative = ${function:Invoke-XRayNative}
    function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
        if ($Name -ceq 'CloseHandle' -and $script:mode -ceq 'close-failure') { $script:closeCalls += 1; if ($script:closeCalls -eq 1) { return 0 } }
        $value = & $script:savedNative $Name $Arguments
        if ($Name -ceq 'GetFileInformationByHandleEx' -and $Arguments[1] -eq 9 -and $script:mode -ceq 'undefined-tag' -and $value -ne 0) {
            [Runtime.InteropServices.Marshal]::WriteInt32($Arguments[2], 4, 12345)
        }
        return $value
    }
    $script:savedPage = ${function:Invoke-XRayDirectoryPage}
    function Invoke-XRayDirectoryPage([IntPtr]$Handle, [int]$Class, [IntPtr]$Buffer, [uint32]$Bytes) {
        $script:queryCalls += 1
        if ($Class -eq 20) {
            $script:enumerations += 1
            if ($script:enumerations -eq 2) {
                if ($script:mode -ceq 'add-member') { [IO.File]::WriteAllText([IO.Path]::Combine($script:ownedDirectory, 'added-owned'), 'owned') }
                if ($script:mode -ceq 'remove-member') {
                    $target = [IO.Path]::Combine($script:ownedDirectory, 'remove-owned')
                    if ([IO.File]::ReadAllText($target) -cne 'M6-self-owned-remove-fixture') { throw 'CONTROL_INVALID' }
                    [IO.File]::Delete($target)
                }
            }
        }
        if ($script:mode -ceq 'query-error') { return [pscustomobject]@{ success = $false; error = 5 } }
        if ($script:mode -ceq 'small-pages') {
            # Same native API/handle; intentionally smaller self-owned test pages to force real pagination.
            $arguments = [object[]]@($Handle, $Class, $Buffer, [uint32]1024, [int]0)
            $success = $script:XRayDirectoryApi.GetMethod('Query').Invoke($null, $arguments)
            $result = [pscustomobject]@{ success = $success -ne 0; error = [int]$arguments[4] }
        } else { $result = & $script:savedPage $Handle $Class $Buffer $Bytes }
        if (-not $result.success) {
            $script:eofErrors.Add([int]$result.error)
            if ($result.error -eq 18 -and $script:enumerations -eq 2 -and $script:mode -ceq 'post-vector-add') {
                [IO.File]::WriteAllText([IO.Path]::Combine($script:ownedDirectory, 'added-after-vector-owned'), 'owned')
            }
        }
        if ($result.success) {
            $offset = 0
            while ($offset -lt 65536 - 90) {
                if ($script:mode -ceq 'directory-source-time' -and ([Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset + 56) -band 16) -ne 0) {
                    [Runtime.InteropServices.Marshal]::WriteInt64($Buffer, $offset + 24, ([Runtime.InteropServices.Marshal]::ReadInt64($Buffer, $offset + 24) + 10000))
                    [Runtime.InteropServices.Marshal]::WriteInt64($Buffer, $offset + 32, ([Runtime.InteropServices.Marshal]::ReadInt64($Buffer, $offset + 32) + 10000))
                }
                if ($script:mode -ceq 'post-vector-field' -and $script:enumerations -eq 2 -and -not $script:postVectorFieldInjected) {
                    $nameLength = [Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset + 60)
                    if ($nameLength -lt 2 -or $nameLength -gt 510 -or ($nameLength % 2) -ne 0 -or $nameLength -gt 65536 - $offset - 88) { throw 'CONTROL_INVALID' }
                    $name = [Runtime.InteropServices.Marshal]::PtrToStringUni([IntPtr]::Add($Buffer, $offset + 88), [int]($nameLength / 2))
                    if ($name -cnotin @('.', '..') -and $name -ceq 'member') {
                        $writeBefore = [Runtime.InteropServices.Marshal]::ReadInt64($Buffer, $offset + 24)
                        [Runtime.InteropServices.Marshal]::WriteInt64($Buffer, $offset + 24, ($writeBefore + 1))
                        $script:postVectorFieldTarget = $name
                        $script:postVectorFieldInjected = $true
                    }
                }
                $next = [Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset)
                if ($next -le 0) { break }; $offset += $next
            }
            if ($script:mode -ceq 'bad-page') { [Runtime.InteropServices.Marshal]::WriteInt32($Buffer, 0, 1) }
            $offset = 0
            while ($offset -lt 65536 - 90) {
                if ($script:mode -ceq 'unknown-id') { for ($i = 0; $i -lt 16; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($Buffer, $offset + 72 + $i, 0) } }
                if ($script:mode -ceq 'name-length') { [Runtime.InteropServices.Marshal]::WriteInt32($Buffer, $offset + 60, 511) }
                if ($script:mode -ceq 'bad-utf16') { [Runtime.InteropServices.Marshal]::WriteInt16($Buffer, $offset + 88, [int16](-10240)) }
                if ($script:mode -ceq 'id-collision') { for ($i = 0; $i -lt 16; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($Buffer, $offset + 72 + $i, 1) } }
                $next = [Runtime.InteropServices.Marshal]::ReadInt32($Buffer, $offset)
                if ($next -le 0) { break }; $offset += $next
            }
        }
        return $result
    }
    $script:savedMetadata = ${function:Get-XRayDirectoryMetadata}
    function Get-XRayDirectoryMetadata([IntPtr]$Handle, [bool]$Directory) {
        $metadata = & $script:savedMetadata $Handle $Directory
        if ($script:observedDirectoryHandle -ne [IntPtr]::Zero -and $Handle -ne $script:observedDirectoryHandle) {
            $script:childMetadataQueries += 1
            if ($script:mode -ceq 'metadata-query-failure' -and $script:childMetadataQueries -eq 2) { throw 'METADATA_UNAVAILABLE' }
            if ($script:mode -like 'cross-source-*' -and $script:childMetadataQueries -eq 1) {
                switch ($script:mode) {
                    'cross-source-volume' { $metadata.volume = $(if ($metadata.volume.Substring(0, 1) -ceq '0') { '1' } else { '0' }) + $metadata.volume.Substring(1) }
                    'cross-source-fileId' { $metadata.fileId = $(if ($metadata.fileId.Substring(0, 1) -ceq '0') { '1' } else { '0' }) + $metadata.fileId.Substring(1) }
                    'cross-source-directory' { $metadata.directory = -not $metadata.directory }
                    'cross-source-attributes' { $metadata.attributes = $metadata.attributes -bxor 2 }
                    'cross-source-creation' { $metadata.creation += 1 }
                    'cross-source-write' { $metadata.write += 1 }
                    'cross-source-change' { $metadata.change += 1 }
                    'cross-source-length' { $metadata.length += 1 }
                    'cross-source-allocation' { $metadata.allocation += 1 }
                    default { throw 'CONTROL_INVALID' }
                }
                return $metadata
            }
            if ($script:mode -like 'metadata-change-*') {
                if ($script:childMetadataQueries -eq 1) { $script:sharedMemberMetadata = $metadata; return $script:sharedMemberMetadata }
                if ($script:childMetadataQueries -eq 2) {
                    switch ($script:mode) {
                        'metadata-change-volume' { $script:sharedMemberMetadata.volume = $(if ($script:sharedMemberMetadata.volume.Substring(0, 1) -ceq '0') { '1' } else { '0' }) + $script:sharedMemberMetadata.volume.Substring(1) }
                        'metadata-change-fileId' { $script:sharedMemberMetadata.fileId = $(if ($script:sharedMemberMetadata.fileId.Substring(0, 1) -ceq '0') { '1' } else { '0' }) + $script:sharedMemberMetadata.fileId.Substring(1) }
                        'metadata-change-directory' { $script:sharedMemberMetadata.directory = -not $script:sharedMemberMetadata.directory }
                        'metadata-change-attributes' { $script:sharedMemberMetadata.attributes = $script:sharedMemberMetadata.attributes -bxor 2 }
                        'metadata-change-creation' { $script:sharedMemberMetadata.creation += 1 }
                        'metadata-change-write' { $script:sharedMemberMetadata.write += 1 }
                        'metadata-change-change' { $script:sharedMemberMetadata.change += 1 }
                        'metadata-change-length' { $script:sharedMemberMetadata.length += 1 }
                        'metadata-change-allocation' { $script:sharedMemberMetadata.allocation += 1 }
                        'metadata-change-links' { $script:sharedMemberMetadata.links += 1 }
                        default { throw 'CONTROL_INVALID' }
                    }
                    return $script:sharedMemberMetadata
                }
            }
        }
        if ($script:mode -ceq 'mismatch-id' -and $script:enumerations -gt 0 -and -not $Directory) { $metadata.fileId = 'BAD' }
        return $metadata
    }
    $session = Open-XRayArtifactDirectorySession $start.input.directoryPath
    $script:observedDirectoryHandle = $session.leaf
    $observation = Get-XRayArtifactDirectoryObservation $session
    if ($script:mode -ceq 'post-vector-field') { throw 'CONTROL_INVALID' }
    if ($script:mode -ceq 'repeat-read') { $null = Get-XRayArtifactDirectoryObservation $session }
    Send-XRayFrame @{
        protocolVersion = 1; type = 'ready'; runId = $start.runId; token = $start.token
        payload = @{ observation = $observation; processId = $PID; psVersion = $PSVersionTable.PSVersion.ToString()
            pointerBytes = [IntPtr]::Size; eofErrors = @($script:eofErrors) }
    }
    $release = Read-XRayControl
    Assert-XRayKeys $release @('protocolVersion', 'type', 'runId', 'token')
    if ($release.protocolVersion -isnot [int] -or $release.protocolVersion -ne 1 -or $release.type -isnot [string] -or $release.type -cne 'release' -or
        $release.runId -isnot [string] -or $release.token -isnot [string] -or
        $release.runId -cne $start.runId -or $release.token -cne $start.token) { throw 'CONTROL_INVALID' }
    Close-XRayArtifactSession $session
    if (-not $session.released) { throw 'HANDLE_CLOSE_UNCONFIRMED' }
    Send-XRayFrame @{ protocolVersion = 1; type = 'terminal'; runId = $start.runId; token = $start.token; status = 'released' }
    $exitCode = 0
} catch {
    # Never expose arbitrary exception text, paths, or bytes.
    $code = $_.Exception.Message
    if ($code -cnotin @('CONTROL_TIMEOUT', 'CONTROL_EOF', 'CONTROL_INVALID', 'OPEN_REJECTED', 'PATH_REJECTED', 'VOLUME_REJECTED', 'REPARSE_REJECTED', 'TYPE_REJECTED', 'RUNTIME_UNSUPPORTED', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'NOT_DISK', 'HANDLE_CLOSE_UNCONFIRMED', 'SESSION_INVALID', 'DIRECTORY_BINDING_FAILED', 'DIRECTORY_QUERY_FAILED', 'DIRECTORY_PAGE_INVALID', 'DIRECTORY_TYPE_REJECTED', 'DIRECTORY_ID_REJECTED', 'DIRECTORY_COLLISION', 'DIRECTORY_LIMIT', 'DIRECTORY_CHANGED', 'DIRECTORY_OBSERVATION_FAILED')) { $code = 'PROBE_FAILED' }
    if ($script:mode -ceq 'post-vector-field') {
        # Test-only exit receipt: 9 means the real member was changed and the vector guard rejected it; 10 means that path was not proven.
        if ($script:postVectorFieldInjected -and $script:postVectorFieldTarget -ceq 'member' -and $code -ceq 'DIRECTORY_CHANGED') { $exitCode = 9 } else { $exitCode = 10 }
    }
    [Console]::Error.WriteLine($code)
} finally {
    try {
        if ($null -ne $session -and -not $session.released) { Close-XRayArtifactSession $session }
    } catch { [Console]::Error.WriteLine('HANDLE_CLOSE_UNCONFIRMED'); $exitCode = 4 }
}
exit $exitCode
