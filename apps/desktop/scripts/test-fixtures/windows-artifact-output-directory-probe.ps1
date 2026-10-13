param(
    [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'existing-directory', 'existing-file', 'existing-link', 'parent-link', 'overlap', 'wrong-input', 'wrong-identity', 'native-create-failure', 'acl-query-failure', 'extra-ace', 'null-dacl', 'close-failure')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$PortablePath,
    [Parameter(Mandatory = $true)][string]$ApplicationDirectoryPath,
    [string]$WrongInputDirectoryPath
)

$ErrorActionPreference = 'Stop'
$script:xrayOutputFixtureMode = $Mode
$script:xrayOutputFaultReached = $false
$script:xrayOutputCloseFaultUsed = $false

function Get-XRayOutputFixtureAclHash([string]$Path) {
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $sddl = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
    $bytes = [Text.Encoding]::UTF8.GetBytes($sddl)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function New-XRayOutputFixtureDescriptor([IntPtr]$Handle, [string]$Fault) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = [string]$identity.User.Value
        if ($Fault -ceq 'null-dacl') {
            $flags = [Security.AccessControl.ControlFlags]0x1004
            $owner = [Security.Principal.SecurityIdentifier]::new($sid)
            $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($flags, $owner, $null, $null, $null)
        } else {
            $sddl = 'O:' + $sid + 'D:P(A;OICI;0x001301BF;;;' + $sid + ')'
            if ($sid -cne 'S-1-5-18') { $sddl += '(A;OICI;0x001301BF;;;S-1-5-18)' }
            if ($Fault -ceq 'extra-ace') { $sddl += '(A;OICI;0x001301BF;;;S-1-5-32-545)' }
            $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($sddl)
        }
        $bytes = [byte[]]::new($descriptor.BinaryLength)
        $descriptor.GetBinaryForm($bytes, 0)
        return ,$bytes
    } finally { $identity.Dispose() }
}

. (Join-Path $PSScriptRoot '..\windows-artifact-handle-bridge.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-directory-observation.ps1')
. (Join-Path $PSScriptRoot '..\windows-artifact-output-directory.ps1')

# These two fixture adapters are the only injection points. They are never used by production callers.
function Invoke-XRayOutputNative([string]$Name, [object[]]$Arguments) {
    if ($script:xrayOutputFixtureMode -ceq 'native-create-failure' -and $Name -ceq 'NtCreateFile') {
        $script:xrayOutputFaultReached = $true
        return [int]-1073741823
    }
    if ($script:xrayOutputFixtureMode -ceq 'close-failure' -and $Name -ceq 'CloseHandle' -and -not $script:xrayOutputCloseFaultUsed) {
        $script:xrayOutputCloseFaultUsed = $true
        $null = Invoke-XRayOutputNativeCore $Name $Arguments
        $script:xrayOutputFaultReached = $true
        return [int]0
    }
    return (Invoke-XRayOutputNativeCore $Name $Arguments)
}

function Get-XRayOutputSecurityDescriptor([IntPtr]$Handle) {
    if ($script:xrayOutputFixtureMode -ceq 'acl-query-failure') {
        $script:xrayOutputFaultReached = $true
        throw 'ACL_QUERY_FAILED'
    }
    if ($script:xrayOutputFixtureMode -cin @('extra-ace', 'null-dacl')) {
        $script:xrayOutputFaultReached = $true
        return (New-XRayOutputFixtureDescriptor $Handle $script:xrayOutputFixtureMode)
    }
    return (Get-XRayOutputSecurityDescriptorCore $Handle)
}

$portableSession = $null
$applicationSession = $null
$outputSession = $null
$beforeAcl = $null
$afterAcl = $null
$renameBlocked = $null
$deleteBlocked = $null
$reopened = $false
$inputSessionsStillHeld = $false
$fixtureFailure = $null
$fixtureFailureStage = $null
$fixtureStage = 'setup'
$closeAttempted = $false
try {
    $fixtureStage = 'acl-before'
    if ($Mode -cin @('existing-directory', 'existing-file')) { $beforeAcl = Get-XRayOutputFixtureAclHash $OutputPath }
    $fixtureStage = 'open-portable'
    $portableSession = if ($Mode -ceq 'wrong-input') {
        Open-XRayArtifactDirectorySession $WrongInputDirectoryPath
    } else {
        Open-XRayArtifactSession $PortablePath
    }
    if ($Mode -ceq 'wrong-identity') {
        $fixtureStage = 'mutate-input-identity'
        $lastIndex = $portableSession.chain.Count - 1
        $portableSession.chain[$lastIndex] = [pscustomobject]@{
            volume = [string]$portableSession.chain[$lastIndex].volume
            fileId = '00000000000000000000000000000000'
            directory = $false
        }
    }
    $fixtureStage = 'open-application'
    $applicationSession = Open-XRayArtifactDirectorySession $ApplicationDirectoryPath
    $fixtureStage = 'new-output'
    $outputSession = New-XRayPrivateArtifactOutputDirectory $OutputPath $portableSession $applicationSession
    $fixtureStage = 'summary'
    $opened = Get-XRayPrivateArtifactOutputSummary $outputSession
    $inputSessionsStillHeld = (-not $portableSession.released -and -not $applicationSession.released)
    if ($opened.ready) {
        $fixtureStage = 'rename-check'
        try {
            [IO.Directory]::Move($OutputPath, ($OutputPath + '.xray-held-rename'))
            $renameBlocked = $false
        } catch { $renameBlocked = $true }
        if ($renameBlocked) {
            $fixtureStage = 'delete-check'
            try { [IO.Directory]::Delete($OutputPath); $deleteBlocked = $false }
            catch { $deleteBlocked = $true }
        }
    }
    $fixtureStage = 'close-output'
    $closeAttempted = $true
    $closed = Close-XRayPrivateArtifactOutputDirectory $outputSession
    if ($Mode -ceq 'ordinary' -and $closed.releaseStatus -ceq 'released') {
        $fixtureStage = 'reopen-after-release'
        try {
            $reopenedSession = Open-XRayArtifactDirectorySession $OutputPath
            Close-XRayArtifactSession $reopenedSession
            $reopened = $true
        } catch { $reopened = $false }
    }
    if ($Mode -cin @('existing-directory', 'existing-file')) {
        $fixtureStage = 'acl-after'
        $afterAcl = Get-XRayOutputFixtureAclHash $OutputPath
    }
} catch {
    $fixtureFailure = 'FIXTURE_FAILED'
    $fixtureFailureStage = $fixtureStage
} finally {
    if ($null -ne $outputSession -and $outputSession.handles.Count -gt 0 -and -not $closeAttempted) {
        $fixtureStage = 'release-output'
        try { $null = Close-XRayPrivateArtifactOutputDirectory $outputSession }
        catch { $fixtureFailure = 'FIXTURE_RELEASE_UNCONFIRMED'; $fixtureFailureStage = $fixtureStage }
    }
    if ($null -ne $applicationSession -and -not $applicationSession.released) {
        $fixtureStage = 'release-application'
        try { Close-XRayArtifactSession $applicationSession } catch { $fixtureFailure = 'FIXTURE_RELEASE_UNCONFIRMED'; $fixtureFailureStage = $fixtureStage }
    }
    if ($null -ne $portableSession -and -not $portableSession.released) {
        $fixtureStage = 'release-portable'
        try { Close-XRayArtifactSession $portableSession } catch { $fixtureFailure = 'FIXTURE_RELEASE_UNCONFIRMED'; $fixtureFailureStage = $fixtureStage }
    }
}

$closedSummary = if ($null -ne $outputSession) { Get-XRayPrivateArtifactOutputSummary $outputSession } else { $null }
$aclUnchanged = $null
if ($null -ne $beforeAcl -and $null -ne $afterAcl) { $aclUnchanged = ($beforeAcl -ceq $afterAcl) }
$result = [pscustomobject]@{
    fixtureStatus = $(if ($null -eq $fixtureFailure) { 'completed' } else { $fixtureFailure })
    fixtureFailureStage = $fixtureFailureStage
    opened = $(if ($null -ne $outputSession) { $opened } else { $null })
    closed = $closedSummary
    faultReached = [bool]$script:xrayOutputFaultReached
    renameBlockedWhileHeld = $renameBlocked
    deleteBlockedWhileHeld = $deleteBlocked
    reopenedAfterRelease = [bool]$reopened
    inputSessionsStillHeld = [bool]$inputSessionsStillHeld
    existingAclUnchanged = $aclUnchanged
}
$result | ConvertTo-Json -Compress -Depth 8
