# Internal Windows PowerShell 5.1 x64 private sidecar file capability.
# Import defines functions only. Native APIs are bound lazily in memory.

function Initialize-XRayOutputFileApi {
    if ($script:XRayOutputFileApi) { return }
    if ([IntPtr]::Size -ne 8 -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
        [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'OUTPUT_FILE_RUNTIME_UNSUPPORTED' }
    try {
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
            [Reflection.AssemblyName]::new('XRayPrivateOutputFile'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
        $builder = $assembly.DefineDynamicModule('MemoryOnly').DefineType('XRayPrivateOutputFileNative', 'Public, Abstract, Sealed')
        $pointerRef = [IntPtr].MakeByRefType()
        $uintRef = [uint32].MakeByRefType()
        $signatures = @(
            @('NtCreateFile', 'ntdll.dll', [int], [Type[]]@($pointerRef, [uint32], [IntPtr], [IntPtr], [IntPtr], [uint32], [uint32], [uint32], [uint32], [IntPtr], [uint32])),
            @('WriteFile', 'kernel32.dll', [int], [Type[]]@([IntPtr], [IntPtr], [uint32], $uintRef, [IntPtr])),
            @('ReadFile', 'kernel32.dll', [int], [Type[]]@([IntPtr], [IntPtr], [uint32], $uintRef, [IntPtr])),
            @('SetFilePointerEx', 'kernel32.dll', [int], [Type[]]@([IntPtr], [int64], [IntPtr], [uint32])),
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
        $script:XRayOutputFileApi = $builder.CreateType()
    } catch { throw 'OUTPUT_FILE_NATIVE_BINDING_FAILED' }
}

function Invoke-XRayOutputFileNativeCore([string]$Name, [object[]]$Arguments) {
    $bad = $false
    if ($Name -ceq 'NtCreateFile') {
        if ($Arguments.Count -ne 11 -or $Arguments[1] -ne [uint32]0x00120083 -or
            $Arguments[4] -ne [IntPtr]::Zero -or $Arguments[5] -ne [uint32]0x80 -or
            $Arguments[6] -ne [uint32]1 -or $Arguments[7] -ne [uint32]2 -or
            $Arguments[8] -ne [uint32]0x00200060 -or $Arguments[9] -ne [IntPtr]::Zero -or
            $Arguments[10] -ne [uint32]0 -or $Arguments[2] -eq [IntPtr]::Zero -or
            $Arguments[3] -eq [IntPtr]::Zero) { $bad = $true }
        if (-not $bad) {
            $attributes = [IntPtr]$Arguments[2]
            $marshal = [Runtime.InteropServices.Marshal]
            if ($marshal::ReadInt32($attributes, 0) -ne 48 -or $marshal::ReadIntPtr($attributes, 8) -eq [IntPtr]::Zero -or
                $marshal::ReadIntPtr($attributes, 16) -eq [IntPtr]::Zero -or $marshal::ReadInt32($attributes, 24) -ne 0x40 -or
                $marshal::ReadIntPtr($attributes, 32) -eq [IntPtr]::Zero) { $bad = $true }
        }
    } elseif ($Name -cin @('WriteFile', 'ReadFile')) {
        if ($Arguments.Count -ne 5 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[0] -eq [IntPtr](-1) -or
            $Arguments[1] -eq [IntPtr]::Zero -or [uint32]$Arguments[2] -lt 1 -or
            [uint32]$Arguments[2] -gt [uint32]1048576 -or $Arguments[4] -ne [IntPtr]::Zero) { $bad = $true }
    } elseif ($Name -ceq 'SetFilePointerEx') {
        if ($Arguments.Count -ne 4 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[0] -eq [IntPtr](-1) -or
            [int64]$Arguments[1] -ne 0 -or $Arguments[2] -ne [IntPtr]::Zero -or [uint32]$Arguments[3] -ne 0) { $bad = $true }
    } elseif ($Name -ceq 'CloseHandle') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[0] -eq [IntPtr](-1)) { $bad = $true }
    } elseif ($Name -ceq 'GetSecurityInfo') {
        if ($Arguments.Count -ne 8 -or $Arguments[0] -eq [IntPtr]::Zero -or $Arguments[1] -ne 1 -or $Arguments[2] -ne [uint32]5) { $bad = $true }
    } elseif ($Name -ceq 'GetSecurityDescriptorLength') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero) { $bad = $true }
    } elseif ($Name -ceq 'LocalFree') {
        if ($Arguments.Count -ne 1 -or $Arguments[0] -eq [IntPtr]::Zero) { $bad = $true }
    } else { $bad = $true }
    if ($bad) { throw 'OUTPUT_FILE_NATIVE_CALL_REJECTED' }
    try { return $script:XRayOutputFileApi.GetMethod($Name).Invoke($null, $Arguments) }
    catch { throw 'OUTPUT_FILE_NATIVE_CALL_FAILED' }
}

function Invoke-XRayOutputFileNative([string]$Name, [object[]]$Arguments) {
    return (Invoke-XRayOutputFileNativeCore $Name $Arguments)
}

function New-XRayOutputFileZeroBuffer([int]$Size) {
    if ($Size -lt 1 -or $Size -gt 1048576) { throw 'OUTPUT_FILE_BUFFER_REJECTED' }
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($Size)
    try {
        [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($Size), 0, $pointer, $Size)
        return $pointer
    } catch {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
        throw 'OUTPUT_FILE_BUFFER_FAILED'
    }
}

function Copy-XRayOutputFileInput([object]$InputBytes) {
    if ($null -eq $InputBytes -or $InputBytes -isnot [byte[]]) { throw 'OUTPUT_FILE_INPUT_REJECTED' }
    if ($InputBytes.LongLength -gt 33554432) { throw 'OUTPUT_FILE_LIMIT_REJECTED' }
    $copy = [byte[]]::new([int]$InputBytes.LongLength)
    if ($copy.Length -gt 0) { [Array]::Copy([byte[]]$InputBytes, 0, $copy, 0, $copy.Length) }
    return ,$copy
}

function Get-XRayOutputFileHash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function New-XRayOutputFileToken {
    return ([Guid]::NewGuid().ToString('N')).ToLowerInvariant()
}

function Get-XRayOutputFileCurrentUserSid {
    $identity = $null
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        if ($null -eq $identity -or $null -eq $identity.User) { throw 'OUTPUT_FILE_IDENTITY_UNAVAILABLE' }
        $sid = [string]$identity.User.Value
        if ($sid -cnotmatch '^S-\d-\d+(-\d+)+$') { throw 'OUTPUT_FILE_IDENTITY_UNAVAILABLE' }
        return $sid
    } catch { throw 'OUTPUT_FILE_IDENTITY_UNAVAILABLE' }
    finally { if ($null -ne $identity) { $identity.Dispose() } }
}

function New-XRayOutputFileSecurityDescriptor([string]$UserSid) {
    if ($UserSid -cnotmatch '^S-\d-\d+(-\d+)+$') { throw 'OUTPUT_FILE_IDENTITY_UNAVAILABLE' }
    $rights = '0x00120083'
    $aces = [Collections.Generic.List[string]]::new()
    $aces.Add('(A;;' + $rights + ';;;' + $UserSid + ')')
    if ($UserSid -cne 'S-1-5-18') { $aces.Add('(A;;' + $rights + ';;;S-1-5-18)') }
    try {
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new('O:' + $UserSid + 'D:P' + ($aces -join ''))
        $bytes = [byte[]]::new($descriptor.BinaryLength)
        $descriptor.GetBinaryForm($bytes, 0)
        return [pscustomobject]@{ bytes = $bytes }
    } catch { throw 'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID' }
}

function Get-XRayOutputFileSecurityDescriptorCore([IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'OUTPUT_FILE_ACL_QUERY_FAILED' }
    $descriptorPointer = [IntPtr]::Zero
    $bytes = $null
    $failure = $null
    try {
        $owner = [IntPtr]::Zero; $group = [IntPtr]::Zero; $dacl = [IntPtr]::Zero; $sacl = [IntPtr]::Zero
        $arguments = [object[]]@($Handle, [int]1, [uint32]5, $owner, $group, $dacl, $sacl, $descriptorPointer)
        $result = Invoke-XRayOutputFileNative GetSecurityInfo $arguments
        $descriptorPointer = [IntPtr]$arguments[7]
        if ($result -ne 0 -or $descriptorPointer -eq [IntPtr]::Zero) { throw 'OUTPUT_FILE_ACL_QUERY_FAILED' }
        $length = [uint32](Invoke-XRayOutputFileNative GetSecurityDescriptorLength @($descriptorPointer))
        if ($length -lt 20 -or $length -gt 4096) { throw 'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID' }
        $bytes = [byte[]]::new([int]$length)
        [Runtime.InteropServices.Marshal]::Copy($descriptorPointer, $bytes, 0, [int]$length)
    } catch {
        $failure = $_.Exception.Message
        if ($failure -cnotin @('OUTPUT_FILE_ACL_QUERY_FAILED', 'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID',
            'OUTPUT_FILE_NATIVE_CALL_REJECTED', 'OUTPUT_FILE_NATIVE_CALL_FAILED')) { $failure = 'OUTPUT_FILE_ACL_QUERY_FAILED' }
    } finally {
        if ($descriptorPointer -ne [IntPtr]::Zero) {
            try {
                if ((Invoke-XRayOutputFileNative LocalFree @($descriptorPointer)) -ne [IntPtr]::Zero) { $failure = 'OUTPUT_FILE_ACL_RELEASE_UNCONFIRMED' }
            } catch { $failure = 'OUTPUT_FILE_ACL_RELEASE_UNCONFIRMED' }
        }
    }
    if ($failure) {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        throw $failure
    }
    return ,$bytes
}

function Get-XRayOutputFileSecurityDescriptor([IntPtr]$Handle) {
    return (Get-XRayOutputFileSecurityDescriptorCore $Handle)
}

function Assert-XRayOutputFileSecurityDescriptor([byte[]]$Bytes, [string]$UserSid) {
    if ($null -eq $Bytes -or $Bytes.Length -lt 20 -or $Bytes.Length -gt 4096) { throw 'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID' }
    try {
        $descriptor = [Security.AccessControl.RawSecurityDescriptor]::new($Bytes, 0)
        $control = [int]$descriptor.ControlFlags
        if (($control -band 0x4) -eq 0 -or ($control -band 0x1000) -eq 0) { throw 'OUTPUT_FILE_ACL_CONTROL_REJECTED' }
        if ($null -eq $descriptor.DiscretionaryAcl) { throw 'OUTPUT_FILE_ACL_DACL_REJECTED' }
        if ($null -eq $descriptor.Owner -or $descriptor.Owner.Value -cne $UserSid) { throw 'OUTPUT_FILE_ACL_OWNER_REJECTED' }
        $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $null = $expected.Add($UserSid)
        $null = $expected.Add('S-1-5-18')
        $acl = $descriptor.DiscretionaryAcl
        if ($acl.Count -ne $expected.Count) { throw 'OUTPUT_FILE_ACL_ACE_COUNT_REJECTED' }
        for ($index = 0; $index -lt $acl.Count; $index++) {
            $ace = $acl[$index]
            if ($ace -isnot [Security.AccessControl.CommonAce] -or
                $ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed -or
                [int]$ace.AceFlags -ne 0 -or $ace.AccessMask -ne 0x00120083 -or
                $ace.IsCallback -or $ace.OpaqueLength -ne 0 -or $null -eq $ace.SecurityIdentifier -or
                -not $expected.Remove($ace.SecurityIdentifier.Value)) { throw 'OUTPUT_FILE_ACL_ACE_REJECTED' }
        }
        if ($expected.Count -ne 0) { throw 'OUTPUT_FILE_ACL_ACE_REJECTED' }
        return [pscustomobject]@{ verified = $true; ownerVerified = $true; daclPresent = $true; daclProtected = $true; aceCount = [int]$acl.Count }
    } catch {
        if ($_.Exception.Message -cin @('OUTPUT_FILE_ACL_CONTROL_REJECTED', 'OUTPUT_FILE_ACL_DACL_REJECTED',
            'OUTPUT_FILE_ACL_OWNER_REJECTED', 'OUTPUT_FILE_ACL_ACE_COUNT_REJECTED', 'OUTPUT_FILE_ACL_ACE_REJECTED')) {
            throw $_.Exception.Message
        }
        throw 'OUTPUT_FILE_ACL_REJECTED'
    }
}

function Assert-XRayOutputFileMetadata($Metadata, [bool]$Directory) {
    if ($null -eq $Metadata -or $null -eq $Metadata.PSObject.Properties['volume'] -or
        $null -eq $Metadata.PSObject.Properties['fileId'] -or $null -eq $Metadata.PSObject.Properties['directory'] -or
        $Metadata.volume -isnot [string] -or $Metadata.fileId -isnot [string] -or $Metadata.directory -isnot [bool] -or
        $Metadata.volume -cnotmatch '^[0-9A-F]{16}$' -or $Metadata.fileId -cnotmatch '^[0-9A-F]{32}$' -or
        $Metadata.volume -ceq ('0' * 16) -or $Metadata.fileId -ceq ('0' * 32) -or
        $Metadata.fileId -ceq ('F' * 32) -or $Metadata.directory -ne $Directory -or
        $Metadata.PSObject.Properties['attributes'] -eq $null -or $Metadata.PSObject.Properties['length'] -eq $null -or
        $Metadata.PSObject.Properties['links'] -eq $null -or $Metadata.PSObject.Properties['creation'] -eq $null) {
        throw 'OUTPUT_FILE_METADATA_REJECTED'
    }
    return $Metadata
}

function Assert-XRayOutputFileIdentityProjection($Identity, [bool]$Directory) {
    if ($null -eq $Identity -or @($Identity.PSObject.Properties).Count -ne 3 -or
        $null -eq $Identity.PSObject.Properties['volume'] -or $null -eq $Identity.PSObject.Properties['fileId'] -or
        $null -eq $Identity.PSObject.Properties['directory'] -or
        $Identity.volume -isnot [string] -or $Identity.fileId -isnot [string] -or $Identity.directory -isnot [bool] -or
        $Identity.volume -cnotmatch '^[0-9A-F]{16}$' -or $Identity.fileId -cnotmatch '^[0-9A-F]{32}$' -or
        $Identity.volume -ceq ('0' * 16) -or $Identity.fileId -ceq ('0' * 32) -or
        $Identity.fileId -ceq ('F' * 32) -or $Identity.directory -ne $Directory) {
        throw 'OUTPUT_FILE_DIRECTORY_REJECTED'
    }
    return [pscustomobject]@{ volume = [string]$Identity.volume; fileId = [string]$Identity.fileId; directory = [bool]$Identity.directory }
}

function Get-XRayOutputFileIdentityProof($Metadata) {
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

function Register-XRayOutputFileSession($Session, $State) {
    if (-not $script:XRayOutputFileOwnedSessions) { $script:XRayOutputFileOwnedSessions = [Collections.Generic.List[object]]::new() }
    $script:XRayOutputFileOwnedSessions.Add([pscustomobject]@{ session = $Session; state = $State })
}

function Find-XRayOutputFileSession($Session) {
    if ($null -eq $Session -or -not $script:XRayOutputFileOwnedSessions) { return $null }
    foreach ($entry in $script:XRayOutputFileOwnedSessions) {
        if ([object]::ReferenceEquals($entry.session, $Session)) { return $entry }
    }
    return $null
}

function Complete-XRayOutputFileSession($Entry) {
    if ($null -eq $Entry -or -not $script:XRayOutputFileOwnedSessions) { return }
    for ($index = $script:XRayOutputFileOwnedSessions.Count - 1; $index -ge 0; $index--) {
        if ([object]::ReferenceEquals($script:XRayOutputFileOwnedSessions[$index], $Entry)) {
            $script:XRayOutputFileOwnedSessions.RemoveAt($index)
            break
        }
    }
    if (-not $script:XRayOutputFileReleasedSessions) { $script:XRayOutputFileReleasedSessions = [Collections.Generic.List[object]]::new() }
    $script:XRayOutputFileReleasedSessions.Add($Entry)
}

function Find-XRayOutputFileAnySession($Session) {
    $entry = Find-XRayOutputFileSession $Session
    if ($null -ne $entry) { return $entry }
    if ($script:XRayOutputFileReleasedSessions) {
        foreach ($released in $script:XRayOutputFileReleasedSessions) {
            if ([object]::ReferenceEquals($released.session, $Session)) { return $released }
        }
    }
    return $null
}

function Assert-XRayOutputFileBorrowedDirectory($DirectorySession) {
    foreach ($required in @('Test-XRayOutputOwnedSession', 'Get-XRayHandleMetadata')) {
        if (-not (Get-Command $required -CommandType Function -ErrorAction SilentlyContinue)) { throw 'OUTPUT_FILE_DIRECTORY_REJECTED' }
    }
    if ($null -eq $DirectorySession -or -not (Test-XRayOutputOwnedSession $DirectorySession) -or
        $DirectorySession.status -cne 'ready' -or $DirectorySession.ready -ne $true -or
        $DirectorySession.created -ne $true -or $DirectorySession.released -ne $false -or
        $DirectorySession.ownerRegistered -ne $true -or $null -eq $DirectorySession.handles -or
        $DirectorySession.handles.Count -lt 1 -or $DirectorySession.registeredHandleCount -ne $DirectorySession.handles.Count -or
        $null -eq $DirectorySession.createdIdentity) { throw 'OUTPUT_FILE_DIRECTORY_REJECTED' }
    $handle = [IntPtr]$DirectorySession.createdHandle
    if ($handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1) -or
        [IntPtr]$DirectorySession.handles[$DirectorySession.handles.Count - 1] -ne $handle) { throw 'OUTPUT_FILE_DIRECTORY_REJECTED' }
    $actual = Assert-XRayOutputFileMetadata (Get-XRayHandleMetadata $handle $true) $true
    $saved = Assert-XRayOutputFileIdentityProjection $DirectorySession.createdIdentity $true
    if ($actual.volume -cne $saved.volume -or $actual.fileId -cne $saved.fileId -or
        $actual.directory -ne $saved.directory) { throw 'OUTPUT_FILE_DIRECTORY_REJECTED' }
    return [pscustomobject]@{ handle = $handle; volume = [string]$actual.volume; fileId = [string]$actual.fileId; directory = [bool]$actual.directory }
}

function Assert-XRayOutputFileDirectoryStable($DirectorySession, $SavedDirectory) {
    $actual = Assert-XRayOutputFileBorrowedDirectory $DirectorySession
    if ($actual.volume -cne $SavedDirectory.volume -or $actual.fileId -cne $SavedDirectory.fileId -or
        $actual.directory -ne $SavedDirectory.directory -or $actual.handle -ne $SavedDirectory.handle) {
        throw 'OUTPUT_FILE_DIRECTORY_CHANGED'
    }
    return $actual
}

function Assert-XRayOutputFileMetadataStable($Actual, $Saved, [long]$ExpectedLength) {
    $actual = Assert-XRayOutputFileMetadata $Actual $false
    $attributeMask = -161
    if ($actual.volume -cne $Saved.volume -or $actual.fileId -cne $Saved.fileId -or
        $actual.directory -or [long]$actual.length -ne $ExpectedLength -or
        ([int]$actual.attributes -band $attributeMask) -ne ([int]$Saved.attributes -band $attributeMask) -or
        [int]$actual.links -ne [int]$Saved.links -or
        [long]$actual.creation -ne [long]$Saved.creation -or [int]$actual.links -ne 1) {
        throw 'OUTPUT_FILE_METADATA_REJECTED'
    }
    return $actual
}

function Get-XRayOutputFileFixedFailure([string]$Message) {
    $allowed = @('OUTPUT_FILE_INPUT_REJECTED', 'OUTPUT_FILE_LIMIT_REJECTED', 'OUTPUT_FILE_DIRECTORY_REJECTED',
        'OUTPUT_FILE_DIRECTORY_CHANGED', 'OUTPUT_FILE_RUNTIME_UNSUPPORTED', 'OUTPUT_FILE_NATIVE_BINDING_FAILED',
        'OUTPUT_FILE_NATIVE_CALL_REJECTED', 'OUTPUT_FILE_NATIVE_CALL_FAILED', 'OUTPUT_FILE_BUFFER_REJECTED',
        'OUTPUT_FILE_BUFFER_FAILED', 'OUTPUT_FILE_TOKEN_REJECTED', 'OUTPUT_FILE_IDENTITY_UNAVAILABLE',
        'OUTPUT_FILE_ACL_DESCRIPTOR_INVALID', 'OUTPUT_FILE_ACL_CONTROL_REJECTED', 'OUTPUT_FILE_ACL_DACL_REJECTED',
        'OUTPUT_FILE_ACL_OWNER_REJECTED', 'OUTPUT_FILE_ACL_ACE_COUNT_REJECTED', 'OUTPUT_FILE_ACL_ACE_REJECTED',
        'OUTPUT_FILE_ACL_REJECTED', 'OUTPUT_FILE_ACL_QUERY_FAILED', 'OUTPUT_FILE_ACL_RELEASE_UNCONFIRMED',
        'OUTPUT_FILE_METADATA_REJECTED', 'OUTPUT_FILE_CREATE_REJECTED', 'OUTPUT_FILE_CREATE_RESULT_REJECTED',
        'OUTPUT_FILE_WRITE_FAILED', 'OUTPUT_FILE_WRITE_COUNT_REJECTED', 'OUTPUT_FILE_POINTER_RESET_FAILED',
        'OUTPUT_FILE_READ_FAILED', 'OUTPUT_FILE_READ_COUNT_REJECTED', 'OUTPUT_FILE_EOF_REJECTED',
        'OUTPUT_FILE_CONTENT_MISMATCH', 'OUTPUT_FILE_SESSION_INVALID', 'OUTPUT_FILE_CLOSE_UNCONFIRMED')
    if ($Message -cin $allowed) { return $Message }
    return 'OUTPUT_FILE_FAILED'
}

function Get-XRayPrivateArtifactOutputFileSummary($Session) {
    $entry = Find-XRayOutputFileAnySession $Session
    if ($null -eq $entry) { throw 'OUTPUT_FILE_SESSION_INVALID' }
    $state = $entry.state
    return [pscustomobject]@{
        version = 1; token = [string]$state.token; status = [string]$state.status; ready = [bool]$state.ready
        created = [bool]$state.created; failureCode = $state.failureCode; releaseStatus = [string]$state.releaseStatus
        releaseFailureCode = $state.releaseFailureCode; released = [bool]$state.released
        snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'; identityProof = $state.identityProof
        bytesRequested = [long]$state.bytesRequested; bytesWritten = [long]$state.bytesWritten; bytesRead = [long]$state.bytesRead
        inputSha256 = $state.inputSha256; readbackSha256 = $state.readbackSha256
        aclVerified = [bool]$state.aclVerified; ownerVerified = [bool]$state.ownerVerified
        daclPresent = [bool]$state.daclPresent; daclProtected = [bool]$state.daclProtected; aclAceCount = [int]$state.aclAceCount
        ownedHandleCount = [int]$state.handles.Count
    }
}

function Add-XRayOutputFileOwnedHandle($State, [IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or $Handle -eq [IntPtr](-1)) { throw 'OUTPUT_FILE_CREATE_REJECTED' }
    foreach ($existing in $State.handles) { if ([IntPtr]$existing -eq $Handle) { throw 'OUTPUT_FILE_CREATE_REJECTED' } }
    $State.handles.Add($Handle)
    $State.handle = $Handle
    $State.created = $true
    $State.releaseStatus = 'held'
}

function New-XRayPrivateArtifactOutputFile($DirectorySession, [object]$InputBytes) {
    if (-not $script:XRayOutputFileOwnedSessions) { $script:XRayOutputFileOwnedSessions = [Collections.Generic.List[object]]::new() }
    $public = [pscustomobject]@{ version = 1; token = $null }
    $state = [pscustomobject]@{
        token = ''; status = 'rejected'; ready = $false; created = $false; failureCode = $null
        releaseStatus = 'none'; releaseFailureCode = $null; released = $false
        bytesRequested = [long]0; bytesWritten = [long]0; bytesRead = [long]0
        inputSha256 = $null; readbackSha256 = $null; identityProof = $null; createdIdentity = $null; directoryIdentity = $null
        aclVerified = $false; ownerVerified = $false; daclPresent = $false; daclProtected = $false; aclAceCount = 0
        handle = [IntPtr]::Zero; handles = [Collections.Generic.List[IntPtr]]::new()
    }
    $entry = [pscustomobject]@{ session = $public; state = $state }
    $script:XRayOutputFileOwnedSessions.Add($entry)
    $captured = $null; $securityBytes = $null; $securityPointer = [IntPtr]::Zero
    $namePointer = [IntPtr]::Zero; $unicode = [IntPtr]::Zero; $attributes = [IntPtr]::Zero; $ioStatus = [IntPtr]::Zero
    $buffer = [IntPtr]::Zero; $sha = $null
    try {
        # Capture and hash the caller's byte array before the first native call.
        $captured = Copy-XRayOutputFileInput $InputBytes
        $state.bytesRequested = [long]$captured.LongLength
        $state.inputSha256 = Get-XRayOutputFileHash $captured
        $token = [string](New-XRayOutputFileToken)
        if ($token -cnotmatch '^[a-f0-9]{32}$') { throw 'OUTPUT_FILE_TOKEN_REJECTED' }
        $state.token = $token
        $public.token = $token
        $directory = Assert-XRayOutputFileBorrowedDirectory $DirectorySession
        $state.directoryIdentity = $directory
        Initialize-XRayOutputFileApi
        $userSid = Get-XRayOutputFileCurrentUserSid
        $security = New-XRayOutputFileSecurityDescriptor $userSid
        $securityBytes = [byte[]]$security.bytes
        $component = 'xray-' + $token + '.sidecar'
        $namePointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($component)
        $unicode = New-XRayOutputFileZeroBuffer 16
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 0, [int16]($component.Length * 2))
        [Runtime.InteropServices.Marshal]::WriteInt16($unicode, 2, [int16]($component.Length * 2 + 2))
        [Runtime.InteropServices.Marshal]::WriteIntPtr($unicode, 8, $namePointer)
        $attributes = New-XRayOutputFileZeroBuffer 48
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 0, 48)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 8, $directory.handle)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 16, $unicode)
        [Runtime.InteropServices.Marshal]::WriteInt32($attributes, 24, 0x40)
        $securityPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($securityBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy($securityBytes, 0, $securityPointer, $securityBytes.Length)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($attributes, 32, $securityPointer)
        $ioStatus = New-XRayOutputFileZeroBuffer 16
        $arguments = [object[]]@([IntPtr]::Zero, [uint32]0x00120083, $attributes, $ioStatus, [IntPtr]::Zero,
            [uint32]0x80, [uint32]1, [uint32]2, [uint32]0x00200060, [IntPtr]::Zero, [uint32]0)
        $nativeStatus = [int](Invoke-XRayOutputFileNative NtCreateFile $arguments)
        $createdHandle = [IntPtr]$arguments[0]
        if ($createdHandle -ne [IntPtr]::Zero -and $createdHandle -ne [IntPtr](-1)) { Add-XRayOutputFileOwnedHandle $state $createdHandle }
        if ($createdHandle -eq [IntPtr]::Zero -or $createdHandle -eq [IntPtr](-1)) { throw 'OUTPUT_FILE_CREATE_REJECTED' }
        $metadata = Assert-XRayOutputFileMetadata (Get-XRayHandleMetadata $createdHandle $false) $false
        if ($metadata.length -ne 0 -or $metadata.links -ne 1) { throw 'OUTPUT_FILE_METADATA_REJECTED' }
        $state.createdIdentity = $metadata
        $state.identityProof = Get-XRayOutputFileIdentityProof $metadata
        if ($nativeStatus -lt 0) { throw 'OUTPUT_FILE_CREATE_REJECTED' }
        if ([Runtime.InteropServices.Marshal]::ReadInt64($ioStatus, 8) -ne 2) { throw 'OUTPUT_FILE_CREATE_RESULT_REJECTED' }
        $aclBytes = $null
        try {
            $aclBytes = Get-XRayOutputFileSecurityDescriptor $createdHandle
            $acl = Assert-XRayOutputFileSecurityDescriptor $aclBytes $userSid
        } finally {
            if ($null -ne $aclBytes) { [Array]::Clear($aclBytes, 0, $aclBytes.Length) }
        }
        $state.aclVerified = $acl.verified; $state.ownerVerified = $acl.ownerVerified
        $state.daclPresent = $acl.daclPresent; $state.daclProtected = $acl.daclProtected; $state.aclAceCount = [int]$acl.aceCount
        $buffer = New-XRayOutputFileZeroBuffer 1048576
        $offset = [long]0
        while ($offset -lt $state.bytesRequested) {
            $remaining = $state.bytesRequested - $offset
            $count = [int][Math]::Min([long]1048576, $remaining)
            [Runtime.InteropServices.Marshal]::Copy($captured, [int]$offset, $buffer, $count)
            $writeArgs = [object[]]@($createdHandle, $buffer, [uint32]$count, [uint32]0, [IntPtr]::Zero)
            $writeResult = [int](Invoke-XRayOutputFileNative WriteFile $writeArgs)
            $actual = [uint32]$writeArgs[3]
            [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($count), 0, $buffer, $count)
            if ($actual -gt [uint32]$count) { throw 'OUTPUT_FILE_WRITE_COUNT_REJECTED' }
            $state.bytesWritten += [long]$actual
            if ($state.bytesWritten -gt $state.bytesRequested) { throw 'OUTPUT_FILE_WRITE_COUNT_REJECTED' }
            if ($writeResult -eq 0) { throw 'OUTPUT_FILE_WRITE_FAILED' }
            if ($actual -ne [uint32]$count -or $actual -eq 0) { throw 'OUTPUT_FILE_WRITE_COUNT_REJECTED' }
            $offset += [long]$actual
        }
        $null = Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity
        $afterWrite = Assert-XRayOutputFileMetadataStable (Get-XRayHandleMetadata $createdHandle $false) $state.createdIdentity $state.bytesRequested
        if ((Invoke-XRayOutputFileNative SetFilePointerEx @($createdHandle, [int64]0, [IntPtr]::Zero, [uint32]0)) -eq 0) {
            throw 'OUTPUT_FILE_POINTER_RESET_FAILED'
        }
        $sha = [Security.Cryptography.SHA256]::Create()
        $readOffset = [long]0
        while ($readOffset -lt $state.bytesRequested) {
            $remaining = $state.bytesRequested - $readOffset
            $count = [int][Math]::Min([long]1048576, $remaining)
            [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($count), 0, $buffer, $count)
            $readArgs = [object[]]@($createdHandle, $buffer, [uint32]$count, [uint32]0, [IntPtr]::Zero)
            $readResult = [int](Invoke-XRayOutputFileNative ReadFile $readArgs)
            $actual = [uint32]$readArgs[3]
            if ($actual -gt [uint32]$count) { throw 'OUTPUT_FILE_READ_COUNT_REJECTED' }
            $state.bytesRead += [long]$actual
            if ($state.bytesRead -gt $state.bytesRequested) { throw 'OUTPUT_FILE_READ_COUNT_REJECTED' }
            if ($readResult -eq 0) { throw 'OUTPUT_FILE_READ_FAILED' }
            if ($actual -ne [uint32]$count -or $actual -eq 0) { throw 'OUTPUT_FILE_READ_COUNT_REJECTED' }
            $chunk = [byte[]]::new([int]$actual)
            try {
                [Runtime.InteropServices.Marshal]::Copy($buffer, $chunk, 0, [int]$actual)
                $null = $sha.TransformBlock($chunk, 0, $chunk.Length, $chunk, 0)
            } finally { [Array]::Clear($chunk, 0, $chunk.Length) }
            $readOffset += [long]$actual
        }
        $eofArgs = [object[]]@($createdHandle, $buffer, [uint32]1, [uint32]0, [IntPtr]::Zero)
        $eofResult = [int](Invoke-XRayOutputFileNative ReadFile $eofArgs)
        $eofCount = [uint32]$eofArgs[3]
        if ($eofResult -eq 0) { throw 'OUTPUT_FILE_READ_FAILED' }
        if ($eofCount -ne 0) { throw 'OUTPUT_FILE_EOF_REJECTED' }
        $null = $sha.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $state.readbackSha256 = ([BitConverter]::ToString($sha.Hash)).Replace('-', '')
        if ($state.bytesRead -ne $state.bytesRequested -or $state.readbackSha256 -cne $state.inputSha256) {
            throw 'OUTPUT_FILE_CONTENT_MISMATCH'
        }
        $afterRead = Assert-XRayOutputFileMetadataStable (Get-XRayHandleMetadata $createdHandle $false) $state.createdIdentity $state.bytesRequested
        if ([long]$afterRead.creation -ne [long]$afterWrite.creation) { throw 'OUTPUT_FILE_METADATA_REJECTED' }
        $null = Assert-XRayOutputFileDirectoryStable $DirectorySession $state.directoryIdentity
        $state.status = 'ready'; $state.ready = $true
    } catch {
        $state.failureCode = Get-XRayOutputFileFixedFailure $_.Exception.Message
        $state.status = 'rejected'; $state.ready = $false
    } finally {
        if ($null -ne $sha) { $sha.Dispose() }
        if ($null -ne $captured) { [Array]::Clear($captured, 0, $captured.Length) }
        if ($null -ne $securityBytes) { [Array]::Clear($securityBytes, 0, $securityBytes.Length) }
        if ($securityPointer -ne [IntPtr]::Zero) {
            try {
                if ($null -ne $securityBytes) {
                    [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($securityBytes.Length), 0, $securityPointer, $securityBytes.Length)
                }
            } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($securityPointer) }
        }
        if ($buffer -ne [IntPtr]::Zero) {
            try { [Runtime.InteropServices.Marshal]::Copy([byte[]]::new(1048576), 0, $buffer, 1048576) } catch { }
        }
        foreach ($pointer in @($buffer, $ioStatus, $attributes, $unicode, $namePointer)) {
            if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
        }
    }
    return $public
}

function Close-XRayPrivateArtifactOutputFile($Session) {
    $entry = Find-XRayOutputFileSession $Session
    if ($null -eq $entry) {
        $released = Find-XRayOutputFileAnySession $Session
        if ($null -ne $released -and $released.state.released) { return (Get-XRayPrivateArtifactOutputFileSummary $Session) }
        throw 'OUTPUT_FILE_SESSION_INVALID'
    }
    $state = $entry.state
    $failed = $false
    for ($index = $state.handles.Count - 1; $index -ge 0; $index--) {
        $handle = [IntPtr]$state.handles[$index]
        try {
            if ((Invoke-XRayOutputFileNative CloseHandle @($handle)) -eq 0) { $failed = $true }
            else {
                $state.handles.RemoveAt($index)
                if ($state.handle -eq $handle) { $state.handle = [IntPtr]::Zero }
            }
        } catch { $failed = $true }
    }
    if ($failed -or $state.handles.Count -ne 0) {
        $state.ready = $false; $state.status = 'rejected'; $state.releaseStatus = 'unconfirmed'; $state.released = $false
        $state.releaseFailureCode = 'OUTPUT_FILE_CLOSE_UNCONFIRMED'
        if ($null -eq $state.failureCode) { $state.failureCode = 'OUTPUT_FILE_CLOSE_UNCONFIRMED' }
    } else {
        $state.ready = $false; $state.releaseStatus = 'released'; $state.released = $true
        if ($state.status -ceq 'ready') { $state.status = 'released' }
        Complete-XRayOutputFileSession $entry
    }
    return (Get-XRayPrivateArtifactOutputFileSummary $Session)
}
