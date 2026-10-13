# Internal Windows PowerShell 5.1 x64 private output-directory capability.
# Import defines functions only. The separate native API is bound lazily in memory.

function Initialize-XRayOutputDirectoryApi {
    if ($script:XRayOutputDirectoryApi) { return }
    if ([IntPtr]::Size -ne 8 -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
        [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'RUNTIME_UNSUPPORTED' }
    try {
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
            [Reflection.AssemblyName]::new('XRayPrivateOutputDirectory'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
        $builder = $assembly.DefineDynamicModule('MemoryOnly').DefineType('XRayPrivateOutputNative', 'Public, Abstract, Sealed')
        $pointerRef = [IntPtr].MakeByRefType()
        $signatures = @(
            @('NtCreateFile', 'ntdll.dll', [int], [Type[]]@($pointerRef, [uint32], [IntPtr], [IntPtr], [IntPtr], [uint32], [uint32], [uint32], [uint32], [IntPtr], [uint32])),
            @('CloseHandle', 'kernel32.dll', [int], [Type[]]@([IntPtr])),
            @('GetSecurityInfo', 'advapi32.dll', [uint32], [Type[]]@([IntPtr], [int], [uint32], $pointerRef, $pointerRef, $pointerRef, $pointerRef, $pointerRef)),
            @('GetSecurityDescriptorLength', 'advapi32.dll', [uint32], [Type[]]@([IntPtr])),
            @('LocalFree', 'kernel32.dll', [IntPtr], [Type[]]@([IntPtr]))
        )
        foreach ($signature in $signatures) {
            $method = $builder.DefinePInvokeMethod($signature[0], $signature[1],
                [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard,
                $signature[2], $signature[3], [Runtime.InteropServices.CallingConvention]::Winapi,
                [Runtime.InteropServices.CharSet]::Unicode)
            $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
        }
        $script:XRayOutputDirectoryApi = $builder.CreateType()
    } catch { throw 'OUTPUT_NATIVE_BINDING_FAILED' }
}

function Invoke-XRayOutputNativeCore([string]$Name, [object[]]$Arguments) {
    # This API fixes the create, share, disposition, and security-query parameters.
    # It is not a general access/share/disposition adapter and does not extend M4.
    if ($Name -ceq 'NtCreateFile') {
        if ($Arguments.Count -ne 11 -or $Arguments[1] -ne [uint32]0x120083 -or
            $Arguments[4] -ne [IntPtr]::Zero -or $Arguments[5] -ne [uint32]0x10 -or
            $Arguments[6] -ne [uint32]1 -or $Arguments[7] -ne [uint32]2 -or
            $Arguments[8] -ne [uint32]0x200021 -or $Arguments[9] -ne [IntPtr]::Zero -or
            $Arguments[10] -ne [uint32]0 -or $Arguments[2] -eq [IntPtr]::Zero -or
            $Arguments[3] -eq [IntPtr]::Zero) { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
        $attributes = [IntPtr]$Arguments[2]
        $marshal = [Runtime.InteropServices.Marshal]
        if ($marshal::ReadInt32($attributes, 0) -ne 48 -or $marshal::ReadIntPtr($attributes, 8) -eq [IntPtr]::Zero -or
            $marshal::ReadIntPtr($attributes, 16) -eq [IntPtr]::Zero -or $marshal::ReadInt32($attributes, 24) -ne 0x40 -or
            $marshal::ReadIntPtr($attributes, 32) -eq [IntPtr]::Zero) { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
    } elseif ($Name -ceq 'CloseHandle') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[0] -eq [IntPtr](-1)) { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
    } elseif ($Name -ceq 'GetSecurityInfo') {
        if ($Arguments.Count -ne 8 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[1] -ne 1 -or $Arguments[2] -ne [uint32]5) {
            throw 'OUTPUT_NATIVE_CALL_REJECTED'
        }
    } elseif ($Name -ceq 'GetSecurityDescriptorLength') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero) { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
    } elseif ($Name -ceq 'LocalFree') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero) { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
    } else { throw 'OUTPUT_NATIVE_CALL_REJECTED' }
    try { return $script:XRayOutputDirectoryApi.GetMethod($Name).Invoke($null, $Arguments) }
    catch { throw 'OUTPUT_NATIVE_CALL_FAILED' }
}

function Invoke-XRayOutputNative([string]$Name, [object[]]$Arguments) {
    return (Invoke-XRayOutputNativeCore $Name $Arguments)
}

function New-XRayOutputZeroBuffer([int]$Size) {
    if ($Size -lt 1 -or $Size -gt 4096) { throw 'OUTPUT_BUFFER_REJECTED' }
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($Size)
    try {
        [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($Size), 0, $pointer, $Size)
        return $pointer
    } catch {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
        throw 'OUTPUT_BUFFER_FAILED'
    }
}

function Get-XRayOutputPathParts([string]$Path) {
    if ($null -eq $Path -or $Path -isnot [string] -or $Path.Length -lt 4 -or $Path.Length -gt 32760 -or
        $Path -notmatch '^[A-Za-z]:\\' -or $Path.Contains('/') -or $Path.EndsWith('\')) { throw 'OUTPUT_PATH_REJECTED' }
    $driveRoot = $Path.Substring(0, 3)
    $all = $Path.Substring(3).Split([char[]]@([char]92))
    if ($all.Count -lt 1 -or $all.Count -gt 64) { throw 'OUTPUT_PATH_REJECTED' }
    foreach ($component in $all) {
        if ($component.Length -lt 1 -or $component.Length -gt 255 -or $component -in @('.', '..') -or
            $component -match '[\x00-\x1f\\/:<>"|?*]' -or $component.EndsWith('.') -or $component.EndsWith(' ') -or
            $component -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') {
            throw 'OUTPUT_PATH_REJECTED'
        }
    }
    $leaf = [string]$all[$all.Count - 1]
    $parentComponents = [string[]]@()
    if ($all.Count -gt 1) { $parentComponents = [string[]]$all[0..($all.Count - 2)] }
    return [pscustomobject]@{ driveRoot = $driveRoot; parentComponents = $parentComponents; leaf = $leaf }
}

function Assert-XRayOutputMetadata($Metadata, [bool]$Directory) {
    if ($null -eq $Metadata -or $null -eq $Metadata.PSObject.Properties['volume'] -or
        $null -eq $Metadata.PSObject.Properties['fileId'] -or $null -eq $Metadata.PSObject.Properties['directory'] -or
        $Metadata.volume -isnot [string] -or $Metadata.fileId -isnot [string] -or $Metadata.directory -isnot [bool] -or
        $Metadata.volume -cnotmatch '^[0-9A-F]{16}$' -or $Metadata.fileId -cnotmatch '^[0-9A-F]{32}$' -or
        $Metadata.volume -ceq ('0' * 16) -or $Metadata.fileId -ceq ('0' * 32) -or $Metadata.fileId -ceq ('F' * 32) -or
        $Metadata.directory -ne $Directory) { throw 'OUTPUT_IDENTITY_REJECTED' }
    return [pscustomobject]@{ volume = [string]$Metadata.volume; fileId = [string]$Metadata.fileId; directory = [bool]$Metadata.directory }
}

function Assert-XRayOutputInputSession($Session, [bool]$Directory) {
    if ($null -eq $Session -or $Session.released -ne $false -or $null -eq $Session.handles -or
        $null -eq $Session.chain -or $Session.handles.Count -lt 1 -or $Session.handles.Count -ne $Session.chain.Count -or
        $Session.leaf -eq [IntPtr]::Zero -or $null -eq $Session.before) { throw 'INPUT_SESSION_INVALID' }
    $handles = [Collections.Generic.HashSet[Int64]]::new()
    $identities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $rootVolume = $null
    $leafMetadata = $null
    for ($index = 0; $index -lt $Session.handles.Count; $index++) {
        $handle = [IntPtr]$Session.handles[$index]
        if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1) -or -not $handles.Add($handle.ToInt64())) { throw 'INPUT_SESSION_INVALID' }
        $expectedType = $Directory -or $index -lt ($Session.handles.Count - 1)
        $actual = Assert-XRayOutputMetadata (Get-XRayHandleMetadata $handle $expectedType) $expectedType
        $saved = Assert-XRayOutputMetadata $Session.chain[$index] $expectedType
        if ($actual.volume -cne $saved.volume -or $actual.fileId -cne $saved.fileId -or $actual.directory -ne $saved.directory) {
            throw 'INPUT_SESSION_INVALID'
        }
        if ($null -eq $rootVolume) { $rootVolume = $actual.volume }
        if ($actual.volume -cne $rootVolume -or -not $identities.Add($actual.volume + ':' + $actual.fileId)) { throw 'INPUT_SESSION_INVALID' }
        $leafMetadata = $actual
    }
    if ([IntPtr]$Session.handles[$Session.handles.Count - 1] -ne [IntPtr]$Session.leaf) { throw 'INPUT_SESSION_INVALID' }
    $before = Assert-XRayOutputMetadata $Session.before $Directory
    if ($null -eq $leafMetadata -or $before.volume -cne $leafMetadata.volume -or
        $before.fileId -cne $leafMetadata.fileId -or $before.directory -ne $leafMetadata.directory) { throw 'INPUT_SESSION_INVALID' }
    return [pscustomobject]@{ root = $leafMetadata; handleCount = [int]$Session.handles.Count; handles = $handles }
}

function Register-XRayOutputOwnedSession($Session) {
    if (-not $script:XRayOutputOwnedSessions) { $script:XRayOutputOwnedSessions = [Collections.Generic.List[object]]::new() }
    $script:XRayOutputOwnedSessions.Add($Session)
    $Session.ownerRegistered = $true
}

function Add-XRayOutputOwnedHandle($Session, [IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'OUTPUT_HANDLE_INVALID' }
    foreach ($existing in $Session.handles) { if ([IntPtr]$existing -eq $Handle) { throw 'OUTPUT_HANDLE_INVALID' } }
    $Session.handles.Add($Handle)
    $Session.registeredHandleCount++
    $Session.releaseStatus = 'held'
}

function Open-XRayOutputParentChain($Session, $Parts) {
    foreach ($required in @('Initialize-XRayHandleApi', 'Invoke-XRayNative', 'Open-XRayRelativeHandle', 'Get-XRayHandleMetadata')) {
        if (-not (Get-Command $required -CommandType Function -ErrorAction SilentlyContinue)) { throw 'PARENT_WALKER_UNAVAILABLE' }
    }
    $null = Initialize-XRayHandleApi
    if ((Invoke-XRayNative GetDriveTypeW @($Parts.driveRoot)) -ne 3) { throw 'OUTPUT_VOLUME_REJECTED' }
    $root = Invoke-XRayNative CreateFileW @(('\\?\' + $Parts.driveRoot), [uint32]0x100081, [uint32]1,
        [IntPtr]::Zero, [uint32]3, [uint32]0x02200000, [IntPtr]::Zero)
    if ($root -eq [IntPtr]::Zero -or $root -eq [IntPtr](-1)) { throw 'PARENT_OPEN_REJECTED' }
    Add-XRayOutputOwnedHandle $Session $root
    $Session.parentHandleCount = $Session.handles.Count
    $rootMetadata = Assert-XRayOutputMetadata (Get-XRayHandleMetadata $root $true) $true
    $Session.parentChain.Add($rootMetadata)
    $parent = $root
    foreach ($component in $Parts.parentComponents) {
        $next = Open-XRayRelativeHandle $parent ([string]$component) $true
        Add-XRayOutputOwnedHandle $Session $next
        $Session.parentHandleCount = $Session.handles.Count
        $metadata = Assert-XRayOutputMetadata (Get-XRayHandleMetadata $next $true) $true
        if ($metadata.volume -cne $rootMetadata.volume) { throw 'OUTPUT_VOLUME_REJECTED' }
        $Session.parentChain.Add($metadata)
        $parent = $next
    }
    $identities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($metadata in $Session.parentChain) {
        if (-not $identities.Add($metadata.volume + ':' + $metadata.fileId)) { throw 'PARENT_CHAIN_INVALID' }
    }
    return $parent
}

function Test-XRayOutputOwnedSession($Session) {
    if (-not $Session.ownerRegistered -or -not $script:XRayOutputOwnedSessions) { return $false }
    foreach ($owned in $script:XRayOutputOwnedSessions) {
        if ([object]::ReferenceEquals($owned, $Session)) { return $true }
    }
    return $false
}

function Remove-XRayOutputOwnedSession($Session) {
    if (-not $script:XRayOutputOwnedSessions) { return }
    for ($index = $script:XRayOutputOwnedSessions.Count - 1; $index -ge 0; $index--) {
        if ([object]::ReferenceEquals($script:XRayOutputOwnedSessions[$index], $Session)) {
            $script:XRayOutputOwnedSessions.RemoveAt($index)
            $Session.ownerRegistered = $false
            return
        }
    }
}

function Get-XRayOutputCurrentUserSid {
    $identity = $null
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        if ($null -eq $identity -or $null -eq $identity.User) { throw 'OUTPUT_IDENTITY_UNAVAILABLE' }
        return [string]$identity.User.Value
    } catch { throw 'OUTPUT_IDENTITY_UNAVAILABLE' }
    finally { if ($null -ne $identity) { $identity.Dispose() } }
}

function New-XRayOutputSecurityDescriptor([string]$UserSid) {
    if ($UserSid -cnotmatch '^S-\d-\d+(-\d+)+$') { throw 'OUTPUT_IDENTITY_UNAVAILABLE' }
    $systemSid = 'S-1-5-18'
    $rights = '0x001301BF'
    $aces = [Collections.Generic.List[string]]::new()
    $aces.Add('(A;OICI;' + $rights + ';;;' + $UserSid + ')')
    if ($UserSid -cne $systemSid) { $aces.Add('(A;OICI;' + $rights + ';;;S-1-5-18)') }
    $sddl = 'O:' + $UserSid + 'D:P' + ($aces -join '')
    try {
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($sddl)
        $bytes = [byte[]]::new($descriptor.BinaryLength)
        $descriptor.GetBinaryForm($bytes, 0)
        return [pscustomobject]@{ bytes = $bytes; userSid = $UserSid }
    } catch { throw 'OUTPUT_ACL_DESCRIPTOR_INVALID' }
}

function Get-XRayOutputSecurityDescriptorCore([IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'ACL_QUERY_FAILED' }
    $descriptorPointer = [IntPtr]::Zero
    $bytes = $null
    $failure = $null
    try {
        $owner = [IntPtr]::Zero; $group = [IntPtr]::Zero; $dacl = [IntPtr]::Zero; $sacl = [IntPtr]::Zero
        $arguments = [object[]]@($Handle, [int]1, [uint32]5, $owner, $group, $dacl, $sacl, $descriptorPointer)
        $securityResult = Invoke-XRayOutputNative GetSecurityInfo $arguments
        $descriptorPointer = [IntPtr]$arguments[7]
        if ($securityResult -ne 0) { throw 'ACL_QUERY_FAILED' }
        if ($descriptorPointer -eq [IntPtr]::Zero) { throw 'ACL_QUERY_FAILED' }
        $length = [uint32](Invoke-XRayOutputNative GetSecurityDescriptorLength @($descriptorPointer))
        if ($length -lt 20 -or $length -gt 4096) { throw 'OUTPUT_ACL_DESCRIPTOR_INVALID' }
        $bytes = [byte[]]::new([int]$length)
        [Runtime.InteropServices.Marshal]::Copy($descriptorPointer, $bytes, 0, [int]$length)
    } catch {
        $failure = $_.Exception.Message
        if ($failure -cnotin @('ACL_QUERY_FAILED', 'OUTPUT_ACL_DESCRIPTOR_INVALID', 'OUTPUT_NATIVE_CALL_REJECTED',
            'OUTPUT_NATIVE_CALL_FAILED')) { $failure = 'ACL_QUERY_FAILED' }
    } finally {
        if ($descriptorPointer -ne [IntPtr]::Zero) {
            try {
                if ((Invoke-XRayOutputNative LocalFree @($descriptorPointer)) -ne [IntPtr]::Zero) { $failure = 'ACL_RELEASE_UNCONFIRMED' }
            } catch { $failure = 'ACL_RELEASE_UNCONFIRMED' }
        }
    }
    if ($failure) {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        throw $failure
    }
    return $bytes
}

function Get-XRayOutputSecurityDescriptor([IntPtr]$Handle) {
    return (Get-XRayOutputSecurityDescriptorCore $Handle)
}

function Assert-XRayOutputSecurityDescriptor([byte[]]$Bytes, [string]$UserSid) {
    if ($null -eq $Bytes -or $Bytes.Length -lt 20 -or $Bytes.Length -gt 4096) { throw 'OUTPUT_ACL_DESCRIPTOR_INVALID' }
    try {
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($Bytes, 0)
        $control = [int]$descriptor.ControlFlags
        if (($control -band 0x4) -eq 0 -or ($control -band 0x1000) -eq 0) { throw 'OUTPUT_ACL_CONTROL_REJECTED' }
        if ($null -eq $descriptor.DiscretionaryAcl) { throw 'OUTPUT_ACL_DACL_REJECTED' }
        if ($null -eq $descriptor.Owner -or $descriptor.Owner.Value -cne $UserSid) { throw 'OUTPUT_ACL_OWNER_REJECTED' }
        $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $null = $expected.Add($UserSid)
        $null = $expected.Add('S-1-5-18')
        $acl = $descriptor.DiscretionaryAcl
        if ($acl.Count -ne $expected.Count) { throw 'OUTPUT_ACL_ACE_COUNT_REJECTED' }
        for ($index = 0; $index -lt $acl.Count; $index++) {
            $ace = $acl[$index]
            if ($ace -isnot [Security.AccessControl.CommonAce] -or
                $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or
                [int]$ace.AceFlags -ne 3 -or $ace.AccessMask -ne 0x001301BF -or
                $ace.IsCallback -or $ace.OpaqueLength -ne 0 -or $null -eq $ace.SecurityIdentifier -or
                -not $expected.Remove($ace.SecurityIdentifier.Value)) { throw 'OUTPUT_ACL_ACE_REJECTED' }
        }
        if ($expected.Count -ne 0) { throw 'OUTPUT_ACL_ACE_REJECTED' }
        return [pscustomobject]@{ verified = $true; ownerVerified = $true; daclPresent = $true; daclProtected = $true; aceCount = [int]$acl.Count }
    } catch {
        if ($_.Exception.Message -cin @('OUTPUT_ACL_CONTROL_REJECTED', 'OUTPUT_ACL_DACL_REJECTED', 'OUTPUT_ACL_OWNER_REJECTED',
            'OUTPUT_ACL_ACE_COUNT_REJECTED', 'OUTPUT_ACL_ACE_REJECTED')) { throw $_.Exception.Message }
        throw 'OUTPUT_ACL_REJECTED'
    }
}

function Get-XRayOutputIdentityProof($Metadata) {
    $sha = [Security.Cryptography.SHA256]::Create()
    $bytes = $null
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$Metadata.volume + ':' + [string]$Metadata.fileId)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        $sha.Dispose()
    }
}

function Get-XRayPrivateArtifactOutputSummary($Session) {
    if ($null -eq $Session -or $null -eq $Session.handles) { throw 'OUTPUT_SESSION_INVALID' }
    $proof = $null
    if ($null -ne $Session.createdIdentity) { $proof = Get-XRayOutputIdentityProof $Session.createdIdentity }
    return [pscustomobject]@{
        version = 1; status = [string]$Session.status; ready = [bool]$Session.ready; created = [bool]$Session.created
        snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'; failureCode = $Session.failureCode
        releaseStatus = [string]$Session.releaseStatus; releaseFailureCode = $Session.releaseFailureCode; released = [bool]$Session.released
        identityProof = $proof; parentHandleCount = [int]$Session.parentHandleCount
        registeredHandleCount = [int]$Session.registeredHandleCount; remainingHandleCount = [int]$Session.handles.Count
        borrowedInputHandleCount = [int]$Session.borrowedInputHandleCount
        applicationRootExcluded = [bool]$Session.applicationRootExcluded
        aclVerified = [bool]$Session.aclVerified; ownerVerified = [bool]$Session.ownerVerified
        daclPresent = [bool]$Session.daclPresent; daclProtected = [bool]$Session.daclProtected
        aclAceCount = [int]$Session.aclAceCount
    }
}

function Get-XRayOutputFixedFailure([string]$Message) {
    $allowed = @('RUNTIME_UNSUPPORTED', 'OUTPUT_NATIVE_BINDING_FAILED', 'OUTPUT_NATIVE_CALL_REJECTED', 'OUTPUT_NATIVE_CALL_FAILED',
        'OUTPUT_PATH_REJECTED', 'OUTPUT_VOLUME_REJECTED', 'OUTPUT_HANDLE_INVALID', 'OUTPUT_IDENTITY_REJECTED',
        'OUTPUT_IDENTITY_UNAVAILABLE', 'OUTPUT_ACL_DESCRIPTOR_INVALID', 'OUTPUT_ACL_REJECTED', 'OUTPUT_ACL_CONTROL_REJECTED',
        'OUTPUT_ACL_DACL_REJECTED', 'OUTPUT_ACL_OWNER_REJECTED', 'OUTPUT_ACL_ACE_COUNT_REJECTED', 'OUTPUT_ACL_ACE_REJECTED', 'ACL_QUERY_FAILED',
        'ACL_RELEASE_UNCONFIRMED', 'PARENT_WALKER_UNAVAILABLE', 'PARENT_OPEN_REJECTED', 'PARENT_CHAIN_INVALID',
        'INPUT_SESSION_INVALID', 'OUTPUT_OVERLAP', 'TARGET_CREATE_REJECTED', 'CREATE_RESULT_INVALID',
        'HANDLE_CLOSE_UNCONFIRMED', 'SESSION_INVALID', 'REPARSE_REJECTED', 'TYPE_REJECTED', 'NOT_DISK',
        'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'VOLUME_REJECTED')
    if ($Message -cin $allowed) { return $Message }
    if ($Message -ceq 'OUTPUT_ACL_QUERY_FAILED') { return 'ACL_QUERY_FAILED' }
    if ($Message -ceq 'OUTPUT_ACL_DESCRIPTOR_INVALID') { return 'OUTPUT_ACL_DESCRIPTOR_INVALID' }
    if ($Message -ceq 'OUTPUT_ACL_REJECTED') { return 'OUTPUT_ACL_REJECTED' }
    if ($Message -ceq 'PARENT_TYPE_REJECTED') { return 'TYPE_REJECTED' }
    return 'OUTPUT_DIRECTORY_FAILED'
}

function Close-XRayPrivateArtifactOutputDirectory($Session) {
    if ($null -eq $Session -or $null -eq $Session.handles -or $null -eq $Session.registeredHandleCount) { throw 'OUTPUT_SESSION_INVALID' }
    if ($Session.handles.Count -eq 0) {
        if ($Session.registeredHandleCount -gt 0 -and -not $Session.released -and (Test-XRayOutputOwnedSession $Session)) {
            $Session.released = $true; $Session.ready = $false; $Session.releaseStatus = 'released'
            Remove-XRayOutputOwnedSession $Session
        }
        return (Get-XRayPrivateArtifactOutputSummary $Session)
    }
    if (-not (Test-XRayOutputOwnedSession $Session)) { throw 'OUTPUT_SESSION_INVALID' }
    $failed = $false
    for ($index = $Session.handles.Count - 1; $index -ge 0; $index--) {
        $handle = [IntPtr]$Session.handles[$index]
        try {
            if ((Invoke-XRayOutputNative CloseHandle @($handle)) -eq 0) { $failed = $true }
            else {
                $Session.handles.RemoveAt($index)
                if ($Session.createdHandle -eq $handle) { $Session.createdHandle = [IntPtr]::Zero }
            }
        } catch { $failed = $true }
    }
    if ($failed -or $Session.handles.Count -ne 0) {
        $Session.ready = $false; $Session.status = 'rejected'; $Session.releaseStatus = 'unconfirmed'; $Session.released = $false
        $Session.releaseFailureCode = 'HANDLE_CLOSE_UNCONFIRMED'
        if ($null -eq $Session.failureCode) { $Session.failureCode = 'HANDLE_CLOSE_UNCONFIRMED' }
    } else {
        $Session.ready = $false; $Session.releaseStatus = 'released'; $Session.released = $true
        if ($Session.status -ceq 'ready') { $Session.status = 'released' }
        Remove-XRayOutputOwnedSession $Session
    }
    return (Get-XRayPrivateArtifactOutputSummary $Session)
}

function New-XRayPrivateArtifactOutputDirectory([string]$OutputPath, $PortableInputSession, $ApplicationInputDirectorySession) {
    $session = [pscustomobject]@{
        version = 1; status = 'rejected'; ready = $false; created = $false; failureCode = $null
        releaseStatus = 'none'; releaseFailureCode = $null; released = $false; handles = [Collections.Generic.List[IntPtr]]::new()
        parentChain = [Collections.Generic.List[object]]::new(); parentHandleCount = 0; registeredHandleCount = 0
        borrowedInputHandleCount = 0; createdHandle = [IntPtr]::Zero; createdIdentity = $null
        ownerRegistered = $false; applicationRootExcluded = $false
        aclVerified = $false; ownerVerified = $false; daclPresent = $false; daclProtected = $false; aclAceCount = 0
    }
    Register-XRayOutputOwnedSession $session
    $namePointer = [IntPtr]::Zero; $unicode = [IntPtr]::Zero; $attributes = [IntPtr]::Zero
    $ioStatus = [IntPtr]::Zero; $securityPointer = [IntPtr]::Zero; $securityBytes = $null
    $security = $null
    try {
        $parts = Get-XRayOutputPathParts $OutputPath
        $portable = Assert-XRayOutputInputSession $PortableInputSession $false
        $application = Assert-XRayOutputInputSession $ApplicationInputDirectorySession $true
        foreach ($handleValue in $portable.handles) {
            if ($application.handles.Contains([Int64]$handleValue)) { throw 'INPUT_SESSION_INVALID' }
        }
        $session.borrowedInputHandleCount = [int]($portable.handleCount + $application.handleCount)
        Initialize-XRayOutputDirectoryApi
        $parent = Open-XRayOutputParentChain $session $parts
        $applicationRootKey = $application.root.volume + ':' + $application.root.fileId
        foreach ($metadata in $session.parentChain) {
            if (($metadata.volume + ':' + $metadata.fileId) -ceq $applicationRootKey) { throw 'OUTPUT_OVERLAP' }
        }
        $session.applicationRootExcluded = $true
        $userSid = Get-XRayOutputCurrentUserSid
        $security = New-XRayOutputSecurityDescriptor $userSid
        $securityBytes = [byte[]]$security.bytes
        $namePointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni([string]$parts.leaf)
        $unicode = New-XRayOutputZeroBuffer 16
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 0, [int16]($parts.leaf.Length * 2))
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 2, [int16]($parts.leaf.Length * 2 + 2))
        [Runtime.InteropServices.Marshal]::WriteIntPtr($unicode, 8, $namePointer)
        $attributes = New-XRayOutputZeroBuffer 48
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 0, 48)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 8, $parent)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 16, $unicode)
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 24, 0x40)
        $securityPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($securityBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy($securityBytes, 0, $securityPointer, $securityBytes.Length)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 32, $securityPointer)
        $ioStatus = New-XRayOutputZeroBuffer 16
        $arguments = [object[]]@([IntPtr]::Zero, [uint32]0x120083, $attributes, $ioStatus, [IntPtr]::Zero,
            [uint32]0x10, [uint32]1, [uint32]2, [uint32]0x200021, [IntPtr]::Zero, [uint32]0)
        $nativeStatus = [int](Invoke-XRayOutputNative NtCreateFile $arguments)
        $createdHandle = [IntPtr]$arguments[0]
        if ($createdHandle -ne [IntPtr]::Zero -and $createdHandle -ne [IntPtr](-1)) {
            Add-XRayOutputOwnedHandle $session $createdHandle
            $session.createdHandle = $createdHandle
        }
        if ($nativeStatus -lt 0 -or $createdHandle -eq [IntPtr]::Zero -or $createdHandle -eq [IntPtr](-1)) {
            throw 'TARGET_CREATE_REJECTED'
        }
        $session.created = $true
        $metadata = Assert-XRayOutputMetadata (Get-XRayHandleMetadata $createdHandle $true) $true
        $parentMetadata = $session.parentChain[$session.parentChain.Count - 1]
        if ($metadata.volume -cne $parentMetadata.volume) { throw 'OUTPUT_VOLUME_REJECTED' }
        $session.createdIdentity = $metadata
        if ([Runtime.InteropServices.Marshal]::ReadInt64($ioStatus, 8) -ne 2) { throw 'CREATE_RESULT_INVALID' }
        $aclBytes = $null
        try {
            $aclBytes = Get-XRayOutputSecurityDescriptor $createdHandle
            $acl = Assert-XRayOutputSecurityDescriptor $aclBytes $userSid
        } finally {
            if ($null -ne $aclBytes) { [Array]::Clear($aclBytes, 0, $aclBytes.Length) }
        }
        $session.aclVerified = $acl.verified; $session.ownerVerified = $acl.ownerVerified
        $session.daclPresent = $acl.daclPresent; $session.daclProtected = $acl.daclProtected
        $session.aclAceCount = [int]$acl.aceCount
        $session.status = 'ready'; $session.ready = $true
    } catch {
        $session.failureCode = Get-XRayOutputFixedFailure $_.Exception.Message
        $session.status = 'rejected'; $session.ready = $false
        if ($session.handles.Count -gt 0) { $null = Close-XRayPrivateArtifactOutputDirectory $session }
    } finally {
        if ($session.handles.Count -eq 0 -and $session.ownerRegistered) { Remove-XRayOutputOwnedSession $session }
        if ($null -ne $securityBytes) { [Array]::Clear($securityBytes, 0, $securityBytes.Length) }
        if ($securityPointer -ne [IntPtr]::Zero) {
            try {
                if ($null -ne $securityBytes) {
                    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($securityBytes.Length), 0, $securityPointer, $securityBytes.Length)
                }
            } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($securityPointer) }
        }
        foreach ($pointer in @($ioStatus, $attributes, $unicode, $namePointer)) {
            if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
        }
        $security = $null
        $userSid = $null
    }
    return $session
}
