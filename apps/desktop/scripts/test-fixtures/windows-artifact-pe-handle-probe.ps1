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
    Assert-XRayKeys $start.input @('filePath', 'maxBytes', 'fixtureMode')
    if ($start.input.filePath -isnot [string] -or ($start.input.maxBytes -isnot [int] -and $start.input.maxBytes -isnot [long]) -or
        $start.input.maxBytes -lt 0 -or $start.input.maxBytes -gt 2147483648 -or
        $start.input.fixtureMode -isnot [string] -or $start.input.fixtureMode -cnotin @('ordinary', 'short-chunks', 'early-eof', 'read-failure', 'repeat-read', 'leaf-change', 'parent-change', 'close-failure')) { throw 'CONTROL_INVALID' }
    # Controlled faults only in this self-owned harness; production native surface stays unchanged.
    $script:originalNative = ${function:Invoke-XRayNative}
    $script:fixtureMode = $start.input.fixtureMode; $script:fixtureReads = 0; $script:fixtureCloses = 0
    function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
        if ($Name -ceq 'ReadFile') {
            if ($script:fixtureMode -ceq 'read-failure') { return 0 }
            if ($script:fixtureMode -ceq 'early-eof' -and $script:fixtureReads -gt 0) { $Arguments[3] = [uint32]0; return 1 }
            if ($script:fixtureMode -in @('short-chunks', 'early-eof')) { $Arguments[2] = [uint32]7 }
            $script:fixtureReads += 1
        }
        if ($Name -ceq 'CloseHandle' -and $script:fixtureMode -ceq 'close-failure') {
            $script:fixtureCloses += 1; if ($script:fixtureCloses -eq 1) { return 0 }
        }
        return (& $script:originalNative $Name $Arguments)
    }
    $script:originalMetadata = ${function:Get-XRayHandleMetadata}
    function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
        $metadata = & $script:originalMetadata $Handle $Directory
        if ($script:fixtureReads -gt 0) {
            if ($script:fixtureMode -ceq 'leaf-change' -and -not $Directory) { $metadata.fileId = 'CHANGED' }
            if ($script:fixtureMode -ceq 'parent-change' -and $Directory) { $metadata.fileId = 'CHANGED' }
        }
        return $metadata
    }
    $session = Open-XRayArtifactSession $start.input.filePath ([long]$start.input.maxBytes)
    $observation = Get-XRayArtifactObservation $session -CapturePeHeader $true
    if ($script:fixtureMode -ceq 'repeat-read') { $null = Get-XRayArtifactObservation $session -CapturePeHeader $true }
    Send-XRayFrame @{
        protocolVersion = 1; type = 'ready'; runId = $start.runId; token = $start.token
        payload = @{ observation = $observation; processId = $PID; psVersion = $PSVersionTable.PSVersion.ToString()
            pointerBytes = [IntPtr]::Size }
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
    if ($code -cnotin @('CONTROL_TIMEOUT', 'CONTROL_EOF', 'CONTROL_INVALID', 'OPEN_REJECTED', 'PATH_REJECTED', 'VOLUME_REJECTED',
        'REPARSE_REJECTED', 'TYPE_REJECTED', 'SIZE_LIMIT', 'FILE_CHANGED', 'SIZE_OR_LENGTH_CHANGED', 'SHORT_READ',
        'READ_FAILED', 'RUNTIME_UNSUPPORTED', 'IDENTITY_UNAVAILABLE', 'METADATA_UNAVAILABLE', 'NOT_DISK',
        'HANDLE_CLOSE_UNCONFIRMED', 'SESSION_INVALID')) { $code = 'PROBE_FAILED' }
    [Console]::Error.WriteLine($code)
} finally {
    try {
        if ($null -ne $session -and -not $session.released) { Close-XRayArtifactSession $session }
    } catch { [Console]::Error.WriteLine('HANDLE_CLOSE_UNCONFIRMED'); $exitCode = 4 }
}
exit $exitCode
