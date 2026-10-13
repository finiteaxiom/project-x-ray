param(
    [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'empty', 'maximum', 'over-limit', 'existing-file', 'existing-directory', 'existing-link',
        'wrong-directory', 'closed-directory', 'forged-directory', 'directory-identity-mismatch', 'directory-not-ready',
        'native-create-failure', 'write-failure', 'short-write', 'read-failure', 'short-read', 'eof-mismatch',
        'acl-query-failure', 'extra-ace', 'null-dacl', 'identity-mismatch', 'close-failure')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$RootPath
)

$ErrorActionPreference = 'Stop'
$script:xrayOutputFileFixtureMode = $Mode
$script:xrayOutputFileFaultReached = $false
$script:xrayOutputFileFaultStage = $null
$script:xrayOutputFileCloseFaultUsed = $false
$script:xrayOutputFileReadCalls = 0
$script:xrayOutputFileNativeCalls = 0
$script:xrayOutputFileCreatedHandle = [IntPtr]::Zero
$script:xrayOutputFileExpectedBytes = [long]0
$script:xrayOutputFileReportedWriteBytes = [long]0
$script:xrayOutputFileIdentityRecheckReached = $false
$script:xrayOutputFileOriginalMetadata = $null

function Get-XRayOutputFileFixtureAclHash([string]$Path) {
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    $sddl = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All)
    $bytes = [Text.Encoding]::UTF8.GetBytes($sddl)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function Get-XRayOutputFileFixtureFileHash([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function Get-XRayOutputFileFixtureIdentity([IntPtr]$Handle, [bool]$Directory, [bool]$ReparsePoint) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'FIXTURE_TARGET_IDENTITY_FAILED' }
    if (-not $ReparsePoint) {
        $metadata = Get-XRayHandleMetadata $Handle $Directory
        return [pscustomobject]@{ volume = [string]$metadata.volume; fileId = [string]$metadata.fileId; directory = [bool]$metadata.directory; reparsePoint = $false }
    }
    try { $null = Get-XRayHandleMetadata $Handle $Directory; throw 'FIXTURE_REPARSE_NOT_REJECTED' }
    catch { if ($_.Exception.Message -cne 'REPARSE_REJECTED') { throw 'FIXTURE_TARGET_IDENTITY_FAILED' } }
    $standard = [IntPtr]::Zero; $identity = [IntPtr]::Zero; $idBytes = $null
    try {
        $standard = New-XRayZeroBuffer 24
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 1, $standard, [uint32]24)) -eq 0) { throw 'FIXTURE_TARGET_IDENTITY_FAILED' }
        $isDirectory = [Runtime.InteropServices.Marshal]::ReadByte($standard, 21) -ne 0
        if ([Runtime.InteropServices.Marshal]::ReadByte($standard, 20) -ne 0 -or $isDirectory -ne $Directory) { throw 'FIXTURE_TARGET_IDENTITY_FAILED' }
        $identity = New-XRayZeroBuffer 24
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 18, $identity, [uint32]24)) -eq 0) { throw 'FIXTURE_TARGET_IDENTITY_FAILED' }
        $volumeBits = [BitConverter]::GetBytes([Runtime.InteropServices.Marshal]::ReadInt64($identity, 0))
        $volume = [BitConverter]::ToUInt64($volumeBits, 0).ToString('X16')
        $idBytes = [byte[]]::new(16)
        [Runtime.InteropServices.Marshal]::Copy([IntPtr]::Add($identity, 8), $idBytes, 0, 16)
        $fileId = ([BitConverter]::ToString($idBytes)).Replace('-', '')
        if ($volume -cnotmatch '^[0-9A-F]{16}$' -or $volume -ceq ('0' * 16) -or
            $fileId -cnotmatch '^[0-9A-F]{32}$' -or $fileId -ceq ('0' * 32) -or $fileId -ceq ('F' * 32)) {
            throw 'FIXTURE_TARGET_IDENTITY_FAILED'
        }
        return [pscustomobject]@{ volume = $volume; fileId = $fileId; directory = $isDirectory; reparsePoint = $true }
    } finally {
        if ($null -ne $idBytes) { [Array]::Clear($idBytes, 0, $idBytes.Length) }
        foreach ($pointer in @($identity, $standard)) { if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) } }
    }
}

function Get-XRayOutputFileFixtureRelativeIdentity([IntPtr]$Parent, [string]$Component, [bool]$Directory, [bool]$ReparsePoint) {
    $handle = [IntPtr]::Zero
    try {
        $handle = Open-XRayRelativeHandle $Parent $Component $Directory
        return (Get-XRayOutputFileFixtureIdentity $handle $Directory $ReparsePoint)
    } catch { throw 'FIXTURE_TARGET_IDENTITY_FAILED' }
    finally {
        if ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
            if ((Invoke-XRayNative CloseHandle @($handle)) -eq 0) { throw 'FIXTURE_TARGET_IDENTITY_CLOSE_FAILED' }
        }
    }
}

function Get-XRayOutputFileFixtureTargetSnapshot([string]$TargetMode, [IntPtr]$ParentHandle, [string]$TargetPath, [IntPtr]$ExternalTargetHandle) {
    if ($TargetMode -ceq 'existing-file') {
        $identity = Get-XRayOutputFileFixtureRelativeIdentity $ParentHandle $script:xrayOutputFileComponent $false $false
        return [pscustomobject]@{ kind = 'file'; identity = $identity; contentHash = Get-XRayOutputFileFixtureFileHash $TargetPath; aclHash = Get-XRayOutputFileFixtureAclHash $TargetPath; length = ([IO.FileInfo]$TargetPath).Length }
    }
    if ($TargetMode -ceq 'existing-directory') {
        $identity = Get-XRayOutputFileFixtureRelativeIdentity $ParentHandle $script:xrayOutputFileComponent $true $false
        $marker = Join-Path $TargetPath 'keep.bin'
        return [pscustomobject]@{ kind = 'directory'; identity = $identity; contentHash = Get-XRayOutputFileFixtureFileHash $marker; aclHash = Get-XRayOutputFileFixtureAclHash $TargetPath; markerLength = ([IO.FileInfo]$marker).Length }
    }
    if ($TargetMode -ceq 'existing-link') {
        $identity = Get-XRayOutputFileFixtureRelativeIdentity $ParentHandle $script:xrayOutputFileComponent $true $true
        $externalDirectory = Get-XRayOutputFileFixtureIdentity $ExternalTargetHandle $true $false
        $markerIdentity = Get-XRayOutputFileFixtureRelativeIdentity $ExternalTargetHandle 'keep.bin' $false $false
        $marker = Join-Path $script:xrayOutputFileExternalTarget 'keep.bin'
        return [pscustomobject]@{
            kind = 'link'; identity = $identity; externalDirectoryIdentity = $externalDirectory; markerIdentity = $markerIdentity
            contentHash = Get-XRayOutputFileFixtureFileHash $marker; aclHash = Get-XRayOutputFileFixtureAclHash $script:xrayOutputFileExternalTarget
            markerAclHash = Get-XRayOutputFileFixtureAclHash $marker; markerLength = ([IO.FileInfo]$marker).Length
        }
    }
    throw 'FIXTURE_TARGET_IDENTITY_FAILED'
}

function Get-XRayOutputFileFixtureIdentityProof($Identity) {
    if ($null -eq $Identity -or $Identity.volume -cnotmatch '^[0-9A-F]{16}$' -or $Identity.fileId -cnotmatch '^[0-9A-F]{32}$') {
        throw 'FIXTURE_TARGET_IDENTITY_FAILED'
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Identity.volume + ':' + [string]$Identity.fileId)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '') }
    finally { [Array]::Clear($bytes, 0, $bytes.Length); $sha.Dispose() }
}

function New-XRayOutputFileFixtureDescriptor([string]$Fault) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $sid = [string]$identity.User.Value
        if ($Fault -ceq 'null-dacl') {
            $flags = [Security.AccessControl.ControlFlags]0x1004
            $owner = [Security.Principal.SecurityIdentifier]::new($sid)
            $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($flags, $owner, $null, $null, $null)
        } else {
            $sddl = 'O:' + $sid + 'D:P(A;;0x00120083;;;' + $sid + ')'
            if ($sid -cne 'S-1-5-18') { $sddl += '(A;;0x00120083;;;S-1-5-18)' }
            if ($Fault -ceq 'extra-ace') { $sddl += '(A;;0x00120083;;;S-1-5-32-545)' }
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
. (Join-Path $PSScriptRoot '..\windows-artifact-output-file.ps1')
$script:xrayOutputFileOriginalMetadata = (Get-Command Get-XRayHandleMetadata -CommandType Function).ScriptBlock

# Fixture-only deterministic token and fault adapters. Production exports no token or native-call parameters.
function New-XRayOutputFileToken { return '0123456789abcdef0123456789abcdef' }

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    $metadata = & $script:xrayOutputFileOriginalMetadata $Handle $Directory
    if (-not $Directory -and $script:xrayOutputFileFixtureMode -ceq 'identity-mismatch' -and
        $script:xrayOutputFileCreatedHandle -ne [IntPtr]::Zero -and $Handle -eq $script:xrayOutputFileCreatedHandle -and
        $script:xrayOutputFileExpectedBytes -gt 0 -and
        $script:xrayOutputFileReportedWriteBytes -eq $script:xrayOutputFileExpectedBytes -and
        [long]$metadata.length -eq $script:xrayOutputFileExpectedBytes -and -not $script:xrayOutputFileIdentityRecheckReached) {
        $id = [string]$metadata.fileId
        $replacement = '1' * 32
        if ($id -ceq $replacement) { $replacement = '2' * 32 }
        $metadata.fileId = $replacement
        $script:xrayOutputFileFaultReached = $true
        $script:xrayOutputFileFaultStage = 'file-identity-recheck'
        $script:xrayOutputFileIdentityRecheckReached = $true
    }
    return $metadata
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    $script:xrayOutputFileNativeCalls++
    if ($script:xrayOutputFileFixtureMode -ceq 'identity-mismatch' -and $Name -ceq 'NtCreateFile') {
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        $handle = [IntPtr]$Arguments[0]
        if ($result -ge 0 -and $handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
            $script:xrayOutputFileCreatedHandle = $handle
        }
        return $result
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'identity-mismatch' -and $Name -ceq 'WriteFile') {
        $result = Invoke-XRayOutputFileNativeCore $Name $Arguments
        if ($result -ne 0 -and [IntPtr]$Arguments[0] -eq $script:xrayOutputFileCreatedHandle) {
            $script:xrayOutputFileReportedWriteBytes += [long][uint32]$Arguments[3]
        }
        return $result
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'native-create-failure' -and $Name -ceq 'NtCreateFile') {
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'native-create'
        return [int]-1073741823
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'write-failure' -and $Name -ceq 'WriteFile') {
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'write'
        return [int]0
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'short-write' -and $Name -ceq 'WriteFile') {
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'short-write'
        $requested = [uint32]$Arguments[2]
        if ($requested -le 1) { return [int]0 }
        $Arguments[2] = [uint32]($requested - 1)
        try { return (Invoke-XRayOutputFileNativeCore $Name $Arguments) }
        finally { $Arguments[2] = $requested }
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'read-failure' -and $Name -ceq 'ReadFile') {
        $script:xrayOutputFileReadCalls++
        if ($script:xrayOutputFileReadCalls -eq 1) {
            $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'read'
            $Arguments[3] = [uint32]0
            return [int]0
        }
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'short-read' -and $Name -ceq 'ReadFile') {
        $script:xrayOutputFileReadCalls++
        if ($script:xrayOutputFileReadCalls -eq 1) {
            $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'short-read'
            $requested = [uint32]$Arguments[2]
            if ($requested -le 1) { return [int]0 }
            $Arguments[2] = [uint32]($requested - 1)
            try { return (Invoke-XRayOutputFileNativeCore $Name $Arguments) }
            finally { $Arguments[2] = $requested }
        }
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'eof-mismatch' -and $Name -ceq 'ReadFile') {
        $script:xrayOutputFileReadCalls++
        if ($script:xrayOutputFileReadCalls -eq 2) {
            $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'eof-probe'
            $Arguments[3] = [uint32]1
            return [int]1
        }
    }
    if ($script:xrayOutputFileFixtureMode -ceq 'close-failure' -and $Name -ceq 'CloseHandle' -and -not $script:xrayOutputFileCloseFaultUsed) {
        $script:xrayOutputFileCloseFaultUsed = $true
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'close'
        return [int]0
    }
    return (Invoke-XRayOutputFileNativeCore $Name $Arguments)
}

function Get-XRayOutputFileSecurityDescriptor([IntPtr]$Handle) {
    if ($script:xrayOutputFileFixtureMode -ceq 'acl-query-failure') {
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'acl-query'
        throw 'OUTPUT_FILE_ACL_QUERY_FAILED'
    }
    if ($script:xrayOutputFileFixtureMode -cin @('extra-ace', 'null-dacl')) {
        $script:xrayOutputFileFaultReached = $true; $script:xrayOutputFileFaultStage = 'acl-verify'
        return (New-XRayOutputFileFixtureDescriptor $script:xrayOutputFileFixtureMode)
    }
    return (Get-XRayOutputFileSecurityDescriptorCore $Handle)
}

$portableSession = $null
$applicationSession = $null
$directorySession = $null
$fileSession = $null
$directoryRelease = $null
$fileRelease = $null
$fileFirstRelease = $null
$fileSummary = $null
$externalTargetSession = $null
$fixtureFailureStage = $null
$fixtureStage = 'setup'
$fixtureFailureCode = $null
$targetBefore = $null
$targetAfter = $null
$targetUnchanged = $null
$targetIdentityBeforeProof = $null
$targetIdentityAfterProof = $null
$targetIdentityUnchanged = $null
$externalDirectoryIdentityBeforeProof = $null
$externalDirectoryIdentityAfterProof = $null
$externalDirectoryIdentityUnchanged = $null
$markerIdentityBeforeProof = $null
$markerIdentityAfterProof = $null
$markerIdentityUnchanged = $null
$m8BorrowedSessionStillHeld = $false
$fileAttempted = $false
$fileCloseAttempted = $false
$directoryWasClosedEarly = $false
$root = [IO.Path]::GetFullPath($RootPath)
$portablePath = Join-Path $root 'portable.bin'
$applicationPath = Join-Path $root 'application'
$outputParent = Join-Path $root 'output-parent'
$outputPath = Join-Path $outputParent 'private'
$component = 'xray-0123456789abcdef0123456789abcdef.sidecar'
$targetPath = Join-Path $outputPath $component
$externalTarget = Join-Path $root 'link-target'
$script:xrayOutputFileComponent = $component
$script:xrayOutputFileExternalTarget = $externalTarget

try {
    $fixtureStage = 'setup'
    [IO.Directory]::CreateDirectory($root) | Out-Null
    [IO.Directory]::CreateDirectory($applicationPath) | Out-Null
    [IO.Directory]::CreateDirectory($outputParent) | Out-Null
    $portableBytes = [byte[]]@(0x58, 0x52, 0x41, 0x59, 0x01)
    [IO.File]::WriteAllBytes($portablePath, $portableBytes)
    $payload = $null
    if ($Mode -ceq 'empty') { $payload = [byte[]]::new(0) }
    elseif ($Mode -ceq 'maximum') { $payload = [byte[]]::new(33554432) }
    elseif ($Mode -ceq 'over-limit') { $payload = [byte[]]::new(33554433) }
    else {
        $unicodeText = ([char]0x79C1).ToString() + ([char]0x6709).ToString() + ' sidecar ' + [char]::ConvertFromUtf32(0x1F642) + "`r`n"
        $payload = [Text.Encoding]::UTF8.GetBytes($unicodeText)
    }

    $fixtureStage = 'open-portable'
    $portableSession = Open-XRayArtifactSession $portablePath
    $fixtureStage = 'open-application'
    $applicationSession = Open-XRayArtifactDirectorySession $applicationPath
    $fixtureStage = 'new-output-directory'
    $directorySession = New-XRayPrivateArtifactOutputDirectory $outputPath $portableSession $applicationSession
    if (-not $directorySession.ready) { throw 'FIXTURE_OUTPUT_DIRECTORY_NOT_READY' }

    if ($Mode -cin @('existing-file', 'existing-directory', 'existing-link')) {
        $fixtureStage = 'prepare-existing-target'
        if ($Mode -ceq 'existing-file') {
            $known = [byte[]]@(0x4B, 0x45, 0x45, 0x50, 0x2D, 0x46, 0x49, 0x4C, 0x45)
            [IO.File]::WriteAllBytes($targetPath, $known)
            $targetBefore = Get-XRayOutputFileFixtureTargetSnapshot 'existing-file' $directorySession.createdHandle $targetPath ([IntPtr]::Zero)
        } elseif ($Mode -ceq 'existing-directory') {
            [IO.Directory]::CreateDirectory($targetPath) | Out-Null
            $marker = Join-Path $targetPath 'keep.bin'
            [IO.File]::WriteAllBytes($marker, [byte[]]@(0x4B, 0x45, 0x45, 0x50, 0x2D, 0x44, 0x49, 0x52))
            $targetBefore = Get-XRayOutputFileFixtureTargetSnapshot 'existing-directory' $directorySession.createdHandle $targetPath ([IntPtr]::Zero)
        } else {
            [IO.Directory]::CreateDirectory($externalTarget) | Out-Null
            $marker = Join-Path $externalTarget 'keep.bin'
            [IO.File]::WriteAllBytes($marker, [byte[]]@(0x4B, 0x45, 0x45, 0x50, 0x2D, 0x4C, 0x49, 0x4E, 0x4B))
            New-Item -ItemType Junction -Path $targetPath -Target $externalTarget -ErrorAction Stop | Out-Null
            $externalTargetSession = Open-XRayArtifactSession $externalTarget 2147483648 $true
            $targetBefore = Get-XRayOutputFileFixtureTargetSnapshot 'existing-link' $directorySession.createdHandle $targetPath $externalTargetSession.leaf
        }
    }

    if ($Mode -ceq 'closed-directory') {
        $fixtureStage = 'close-directory-early'
        $directoryRelease = Close-XRayPrivateArtifactOutputDirectory $directorySession
        $directoryWasClosedEarly = $true
    }
    $inputDirectory = $directorySession
    $savedStatus = $null; $savedReady = $null; $savedOwner = $null; $savedIdentity = $null
    if ($Mode -ceq 'wrong-directory') {
        $fixtureStage = 'invalidate-directory-state'
        $savedStatus = $directorySession.status; $savedReady = $directorySession.ready
        $directorySession.status = 'rejected'; $directorySession.ready = $false
    } elseif ($Mode -ceq 'directory-not-ready') {
        $fixtureStage = 'invalidate-directory-ready'
        $savedReady = $directorySession.ready; $directorySession.ready = $false
    } elseif ($Mode -ceq 'directory-identity-mismatch') {
        $fixtureStage = 'invalidate-directory-identity'
        $savedIdentity = $directorySession.createdIdentity
        $wrongFileId = '1' * 32
        if ([string]$savedIdentity.fileId -ceq $wrongFileId) { $wrongFileId = '2' * 32 }
        $directorySession.createdIdentity = [pscustomobject]@{
            volume = [string]$savedIdentity.volume; fileId = $wrongFileId; directory = $true
        }
    } elseif ($Mode -ceq 'forged-directory') {
        $fixtureStage = 'create-forged-directory'
        $inputDirectory = [pscustomobject]@{
            version = $directorySession.version; status = $directorySession.status; ready = $directorySession.ready
            created = $directorySession.created; released = $directorySession.released; ownerRegistered = $true
            handles = $directorySession.handles; registeredHandleCount = $directorySession.registeredHandleCount
            createdHandle = $directorySession.createdHandle; createdIdentity = $directorySession.createdIdentity
        }
    }

    $fixtureStage = 'new-output-file'
    $fileAttempted = $true
    $script:xrayOutputFileExpectedBytes = [long]$payload.LongLength
    $fileSession = New-XRayPrivateArtifactOutputFile $inputDirectory $payload
    if ($Mode -ceq 'wrong-directory') { $directorySession.status = $savedStatus; $directorySession.ready = $savedReady }
    if ($Mode -ceq 'directory-not-ready') { $directorySession.ready = $savedReady }
    if ($Mode -ceq 'directory-identity-mismatch') { $directorySession.createdIdentity = $savedIdentity }
    $fixtureStage = 'file-summary'
    $fileSummary = Get-XRayPrivateArtifactOutputFileSummary $fileSession
    $m8BorrowedSessionStillHeld = (-not $directoryWasClosedEarly -and $directorySession.ready -and -not $directorySession.released -and
        $directorySession.handles.Count -eq $directorySession.registeredHandleCount -and $directorySession.createdHandle -ne [IntPtr]::Zero)

    if ($null -ne $fileSession) {
        $fixtureStage = 'close-output-file'
        $fileCloseAttempted = $true
        $fileRelease = Close-XRayPrivateArtifactOutputFile $fileSession
        if ($Mode -ceq 'close-failure' -and $fileRelease.releaseStatus -ceq 'unconfirmed') {
            $fileFirstRelease = $fileRelease
            $fixtureStage = 'retry-close-output-file'
            $fileRelease = Close-XRayPrivateArtifactOutputFile $fileSession
        }
    }
    $fixtureStage = 'verify-existing-target'
    if ($null -ne $targetBefore) {
        $externalHandle = if ($null -ne $externalTargetSession) { [IntPtr]$externalTargetSession.leaf } else { [IntPtr]::Zero }
        $targetAfter = Get-XRayOutputFileFixtureTargetSnapshot $Mode $directorySession.createdHandle $targetPath $externalHandle
        $targetIdentityBeforeProof = Get-XRayOutputFileFixtureIdentityProof $targetBefore.identity
        $targetIdentityAfterProof = Get-XRayOutputFileFixtureIdentityProof $targetAfter.identity
        $targetIdentityUnchanged = (ConvertTo-Json -InputObject $targetBefore.identity -Compress -Depth 4) -ceq (ConvertTo-Json -InputObject $targetAfter.identity -Compress -Depth 4)
        if ($Mode -ceq 'existing-link') {
            $externalDirectoryIdentityBeforeProof = Get-XRayOutputFileFixtureIdentityProof $targetBefore.externalDirectoryIdentity
            $externalDirectoryIdentityAfterProof = Get-XRayOutputFileFixtureIdentityProof $targetAfter.externalDirectoryIdentity
            $externalDirectoryIdentityUnchanged = (ConvertTo-Json -InputObject $targetBefore.externalDirectoryIdentity -Compress -Depth 4) -ceq (ConvertTo-Json -InputObject $targetAfter.externalDirectoryIdentity -Compress -Depth 4)
            $markerIdentityBeforeProof = Get-XRayOutputFileFixtureIdentityProof $targetBefore.markerIdentity
            $markerIdentityAfterProof = Get-XRayOutputFileFixtureIdentityProof $targetAfter.markerIdentity
            $markerIdentityUnchanged = (ConvertTo-Json -InputObject $targetBefore.markerIdentity -Compress -Depth 4) -ceq (ConvertTo-Json -InputObject $targetAfter.markerIdentity -Compress -Depth 4)
        }
    }
    if ($null -ne $targetBefore) {
        $beforeJson = ConvertTo-Json -InputObject $targetBefore -Compress -Depth 4
        $afterJson = ConvertTo-Json -InputObject $targetAfter -Compress -Depth 4
        $targetUnchanged = $beforeJson -ceq $afterJson
    }
} catch {
    $fixtureFailureStage = $fixtureStage
    $fixtureFailureCode = 'FIXTURE_OPERATION_FAILED'
} finally {
    if ($null -ne $fileSession -and -not $fileRelease) {
        try { $fileRelease = Close-XRayPrivateArtifactOutputFile $fileSession } catch { }
    }
    if ($null -ne $externalTargetSession) { try { Close-XRayArtifactSession $externalTargetSession } catch { } }
    if ($null -ne $directorySession -and -not $directoryWasClosedEarly) {
        try { $directoryRelease = Close-XRayPrivateArtifactOutputDirectory $directorySession } catch { }
    }
    if ($null -ne $applicationSession) { try { $null = Close-XRayArtifactSession $applicationSession } catch { } }
    if ($null -ne $portableSession) { try { $null = Close-XRayArtifactSession $portableSession } catch { } }
}

$result = [pscustomobject]@{
    version = 1; mode = $Mode; fixtureFailureStage = $fixtureFailureStage; fixtureFailureCode = $fixtureFailureCode
    attempted = [bool]$fileAttempted; faultReached = [bool]$script:xrayOutputFileFaultReached; faultStage = $script:xrayOutputFileFaultStage
    outputFileNativeCallCount = [int]$script:xrayOutputFileNativeCalls; m8BorrowedSessionStillHeld = [bool]$m8BorrowedSessionStillHeld
    outputFileHandleCaptured = ($script:xrayOutputFileCreatedHandle -ne [IntPtr]::Zero)
    outputFileExpectedBytes = [long]$script:xrayOutputFileExpectedBytes
    outputFileSuccessfulWriteBytes = [long]$script:xrayOutputFileReportedWriteBytes
    identityRecheckReached = [bool]$script:xrayOutputFileIdentityRecheckReached
    fileSummary = $fileSummary; fileFirstRelease = $fileFirstRelease; fileRelease = $fileRelease; directoryRelease = $directoryRelease
    targetUnchanged = $targetUnchanged; targetKind = if ($null -ne $targetBefore) { [string]$targetBefore.kind } else { $null }
    targetIdentityBeforeProof = $targetIdentityBeforeProof; targetIdentityAfterProof = $targetIdentityAfterProof; targetIdentityUnchanged = $targetIdentityUnchanged
    externalDirectoryIdentityBeforeProof = $externalDirectoryIdentityBeforeProof; externalDirectoryIdentityAfterProof = $externalDirectoryIdentityAfterProof
    externalDirectoryIdentityUnchanged = $externalDirectoryIdentityUnchanged
    markerIdentityBeforeProof = $markerIdentityBeforeProof; markerIdentityAfterProof = $markerIdentityAfterProof; markerIdentityUnchanged = $markerIdentityUnchanged
}
ConvertTo-Json -InputObject $result -Compress -Depth 8
