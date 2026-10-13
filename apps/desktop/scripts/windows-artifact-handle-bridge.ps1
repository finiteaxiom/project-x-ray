# Internal, Windows PowerShell 5.1 x64, read-only single-file observation.
# Import only defines functions. Native binding and object opens are lazy.
function Initialize-XRayHandleApi {
    if ($script:XRayHandleApi) { return }
    if ([IntPtr]::Size -ne 8 -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
        [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'RUNTIME_UNSUPPORTED' }
    try {
    $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
        [Reflection.AssemblyName]::new('XRayReadOnlyHandles'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $builder = $assembly.DefineDynamicModule('MemoryOnly').DefineType('XRayReadOnlyNative', 'Public, Abstract, Sealed')
    $signatures = @(
        @('CreateFileW', 'kernel32.dll', [IntPtr], [Type[]]@([string], [uint32], [uint32], [IntPtr], [uint32], [uint32], [IntPtr])),
        @('GetDriveTypeW', 'kernel32.dll', [uint32], [Type[]]@([string])),
        @('NtCreateFile', 'ntdll.dll', [int], [Type[]]@([IntPtr].MakeByRefType(), [uint32], [IntPtr], [IntPtr], [IntPtr], [uint32], [uint32], [uint32], [uint32], [IntPtr], [uint32])),
        @('GetFileType', 'kernel32.dll', [uint32], [Type[]]@([IntPtr])),
        @('GetFileInformationByHandleEx', 'kernel32.dll', [int], [Type[]]@([IntPtr], [int], [IntPtr], [uint32])),
        @('ReadFile', 'kernel32.dll', [int], [Type[]]@([IntPtr], [IntPtr], [uint32], [uint32].MakeByRefType(), [IntPtr])),
        @('CloseHandle', 'kernel32.dll', [int], [Type[]]@([IntPtr]))
    )
    foreach ($signature in $signatures) {
        $method = $builder.DefinePInvokeMethod($signature[0], $signature[1],
            [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard,
            $signature[2], $signature[3], [Runtime.InteropServices.CallingConvention]::Winapi,
            [Runtime.InteropServices.CharSet]::Unicode)
        $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
    }
    $script:XRayHandleApi = $builder.CreateType()
    } catch { throw 'NATIVE_BINDING_FAILED' }
}

function Invoke-XRayNative([string]$Name, [object[]]$Arguments) {
    # The internal open adapter cannot be repurposed into create/write/share fallback.
    if ($Name -ceq 'CreateFileW') {
        if ($Arguments.Count -ne 7 -or $Arguments[0] -cnotmatch '^\\\\\?\\[A-Za-z]:\\$' -or
            $Arguments[1] -ne 0x100081 -or $Arguments[2] -ne 1 -or $Arguments[3] -ne [IntPtr]::Zero -or
            $Arguments[4] -ne 3 -or $Arguments[5] -ne 0x02200000 -or $Arguments[6] -ne [IntPtr]::Zero) { throw 'NATIVE_CALL_REJECTED' }
    } elseif ($Name -ceq 'NtCreateFile') {
        if ($Arguments.Count -ne 11 -or $Arguments[1] -ne 0x100081 -or $Arguments[4] -ne [IntPtr]::Zero -or
            $Arguments[5] -ne 0 -or $Arguments[6] -ne 1 -or $Arguments[7] -ne 1 -or
            $Arguments[8] -notin @(0x200021, 0x200060) -or $Arguments[9] -ne [IntPtr]::Zero -or $Arguments[10] -ne 0) { throw 'NATIVE_CALL_REJECTED' }
    } elseif ($Name -cnotin @('GetDriveTypeW', 'GetFileType', 'GetFileInformationByHandleEx', 'ReadFile', 'CloseHandle')) { throw 'NATIVE_CALL_REJECTED' }
    try { return $script:XRayHandleApi.GetMethod($Name).Invoke($null, $Arguments) }
    catch { throw 'NATIVE_CALL_FAILED' }
}

function New-XRayZeroBuffer([int]$Size) {
    $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($Size)
    try { [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($Size), 0, $pointer, $Size); return $pointer }
    catch { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer); throw 'BUFFER_FAILED' }
}

function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) {
    if ((Invoke-XRayNative GetFileType @($Handle)) -ne 1) { throw 'NOT_DISK' }
    $buffer = New-XRayZeroBuffer 40
    try {
        $marshal = [Runtime.InteropServices.Marshal]
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 9, $buffer, [uint32]8)) -eq 0) { throw 'METADATA_UNAVAILABLE' }
        $attributes = $marshal::ReadInt32($buffer, 0)
        if (($attributes -band 0x400) -ne 0 -or $marshal::ReadInt32($buffer, 4) -ne 0) { throw 'REPARSE_REJECTED' }
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 1, $buffer, [uint32]24)) -eq 0) { throw 'METADATA_UNAVAILABLE' }
        $allocation = $marshal::ReadInt64($buffer, 0)
        $length = $marshal::ReadInt64($buffer, 8)
        $links = $marshal::ReadInt32($buffer, 16)
        $deleting = $marshal::ReadByte($buffer, 20)
        $isDirectory = $marshal::ReadByte($buffer, 21) -ne 0
        if ($deleting -ne 0 -or $isDirectory -ne $Directory -or $length -lt 0) { throw 'TYPE_REJECTED' }
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 0, $buffer, [uint32]40)) -eq 0) { throw 'METADATA_UNAVAILABLE' }
        $creation = $marshal::ReadInt64($buffer, 0)
        $write = $marshal::ReadInt64($buffer, 16)
        $change = $marshal::ReadInt64($buffer, 24)
        if ($marshal::ReadInt32($buffer, 32) -ne $attributes) { throw 'FILE_CHANGED' }
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 18, $buffer, [uint32]24)) -eq 0) { throw 'IDENTITY_UNAVAILABLE' }
        $id = [byte[]]::new(16)
        $marshal::Copy([IntPtr]::Add($buffer, 8), $id, 0, 16)
        $volumeBits = [BitConverter]::GetBytes($marshal::ReadInt64($buffer, 0))
        return [pscustomobject]@{
            volume = [BitConverter]::ToUInt64($volumeBits, 0).ToString('X16')
            fileId = ([BitConverter]::ToString($id)).Replace('-', '')
            directory = $isDirectory; attributes = $attributes; length = $length
            allocation = $allocation; links = $links; creation = $creation; write = $write; change = $change
        }
    } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
}

function Open-XRayRelativeHandle([IntPtr]$Parent, [string]$Component, [bool]$Directory) {
    # x64 UNICODE_STRING(16), OBJECT_ATTRIBUTES(48), IO_STATUS_BLOCK(16).
    $name = [IntPtr]::Zero; $unicode = [IntPtr]::Zero; $attributes = [IntPtr]::Zero; $status = [IntPtr]::Zero
    try {
        $marshal = [Runtime.InteropServices.Marshal]
        $name = $marshal::StringToHGlobalUni($Component)
        $unicode = New-XRayZeroBuffer 16
        $marshal::WriteInt16($unicode, 0, [int16]($Component.Length * 2))
        $marshal::WriteInt16($unicode, 2, [int16]($Component.Length * 2 + 2))
        $marshal::WriteIntPtr($unicode, 8, $name)
        $attributes = New-XRayZeroBuffer 48
        $marshal::WriteInt32($attributes, 0, 48)
        $marshal::WriteIntPtr($attributes, 8, $Parent)
        $marshal::WriteIntPtr($attributes, 16, $unicode)
        $marshal::WriteInt32($attributes, 24, 0x40)
        $status = New-XRayZeroBuffer 16
        $options = [uint32](0x200000 -bor 0x20 -bor $(if ($Directory) { 1 } else { 0x40 }))
        $arguments = [object[]]@([IntPtr]::Zero, [uint32]0x100081, $attributes, $status, [IntPtr]::Zero,
            [uint32]0, [uint32]1, [uint32]1, $options, [IntPtr]::Zero, [uint32]0)
        $result = Invoke-XRayNative NtCreateFile $arguments
        $handle = [IntPtr]$arguments[0]
        if ($result -lt 0 -or $handle -eq [IntPtr]::Zero -or $handle -eq [IntPtr](-1)) {
            if ($handle -ne [IntPtr]::Zero -and $handle -ne [IntPtr](-1)) {
                if ((Invoke-XRayNative CloseHandle @($handle)) -eq 0) { throw 'HANDLE_CLOSE_UNCONFIRMED' }
            }
            throw 'OPEN_REJECTED'
        }
        return $handle
    } finally {
        foreach ($pointer in @($status, $attributes, $unicode, $name)) {
            if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer) }
        }
    }
}

function Close-XRayArtifactSession($Session) {
    $failed = $false
    for ($index = $Session.handles.Count - 1; $index -ge 0; $index--) {
        try {
            if ((Invoke-XRayNative CloseHandle @($Session.handles[$index])) -eq 0) { $failed = $true }
            else { $Session.handles.RemoveAt($index) }
        } catch { $failed = $true }
    }
    $Session.released = $Session.handles.Count -eq 0
    if ($failed -or -not $Session.released) { throw 'HANDLE_CLOSE_UNCONFIRMED' }
}

function Open-XRayArtifactSession([string]$Path, [long]$MaxBytes = 2147483648, [bool]$DirectoryLeaf = $false) {
    # No path normalization, prefix comparison, link following, or share fallback.
    if ($Path -notmatch '^[A-Za-z]:\\[^\\]' -or $Path.Contains('/') -or $Path.Length -gt 32760 -or
        $MaxBytes -lt 0 -or $MaxBytes -gt 2147483648) { throw 'PATH_REJECTED' }
    $components = $Path.Substring(3).Split('\')
    if ($components.Count -gt 64) { throw 'PATH_REJECTED' }
    foreach ($component in $components) {
        if ($component.Length -eq 0 -or $component.Length -gt 255 -or $component -match '[\x00-\x1f:<>"|?*]' -or
            $component.EndsWith('.') -or $component.EndsWith(' ') -or $component -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') { throw 'PATH_REJECTED' }
    }
    Initialize-XRayHandleApi
    $root = $Path.Substring(0, 3)
    if ((Invoke-XRayNative GetDriveTypeW @($root)) -ne 3) { throw 'VOLUME_REJECTED' }
    $session = [pscustomobject]@{ handles = [Collections.Generic.List[IntPtr]]::new(); chain = [Collections.Generic.List[object]]::new()
        released = $false; readStarted = $false; maxBytes = $MaxBytes; before = $null; leaf = [IntPtr]::Zero }
    try {
        $parent = Invoke-XRayNative CreateFileW @(('\\?\' + $root), [uint32]0x100081, [uint32]1,
            [IntPtr]::Zero, [uint32]3, [uint32]0x02200000, [IntPtr]::Zero)
        if ($parent -eq [IntPtr]::Zero -or $parent -eq [IntPtr](-1)) { throw 'OPEN_REJECTED' }
        $session.handles.Add($parent)
        $rootMetadata = Get-XRayHandleMetadata $parent $true
        $session.chain.Add($rootMetadata)
        for ($index = 0; $index -lt $components.Count; $index++) {
            $directory = $DirectoryLeaf -or $index -lt $components.Count - 1
            $parent = Open-XRayRelativeHandle $parent $components[$index] $directory
            $session.handles.Add($parent)
            $metadata = Get-XRayHandleMetadata $parent $directory
            $session.chain.Add($metadata)
            if ($metadata.volume -ne $rootMetadata.volume) { throw 'VOLUME_REJECTED' }
        }
        if ($metadata.length -gt $MaxBytes) { throw 'SIZE_LIMIT' }
        $session.leaf = $parent; $session.before = $metadata
        return $session
    } catch {
        $code = $_.Exception.Message
        Close-XRayArtifactSession $session
        if ($code -notin @('OPEN_REJECTED', 'NOT_DISK', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'REPARSE_REJECTED', 'TYPE_REJECTED', 'VOLUME_REJECTED', 'SIZE_LIMIT', 'FILE_CHANGED', 'HANDLE_CLOSE_UNCONFIRMED', 'NATIVE_CALL_FAILED')) { $code = 'OPEN_FAILED' }
        throw $code
    }
}

function Get-XRayArtifactObservation($Session, [bool]$CapturePeHeader = $false) {
    if ($Session.released -or $Session.readStarted -or $Session.before.directory -or $Session.leaf -eq [IntPtr]::Zero) { throw 'SESSION_INVALID' }
    $Session.readStarted = $true
    $bufferSize = 1048576
    $buffer = [IntPtr]::Zero; $bytes = $null; $hash = $null
    $total = [long]0; $reads = [long]0
    # Internal opt-in capture; no second open, seek, or whole-file buffer.
    $dos = $null; $pe = $null; $dosCopied = 0; $peCopied = 0; $peOffset = $null
    try {
        $buffer = New-XRayZeroBuffer $bufferSize
        $bytes = [byte[]]::new($bufferSize)
        if ($CapturePeHeader) { $dos = [byte[]]::new(64); $pe = [byte[]]::new(24) }
        $hash = [Security.Cryptography.SHA256]::Create()
        $before = Get-XRayHandleMetadata $Session.leaf $false
        if (($before | ConvertTo-Json -Compress) -cne ($Session.before | ConvertTo-Json -Compress)) { throw 'FILE_CHANGED' }
        while ($true) {
            $arguments = [object[]]@($Session.leaf, $buffer, [uint32]$bufferSize, [uint32]0, [IntPtr]::Zero)
            if ((Invoke-XRayNative ReadFile $arguments) -eq 0) { throw 'READ_FAILED' }
            $count = [long]$arguments[3]
            $reads++
            if ($count -lt 0 -or $count -gt $bufferSize -or $total -gt $Session.maxBytes - $count -or $total -gt $before.length - $count) { throw 'SIZE_OR_LENGTH_CHANGED' }
            if ($count -eq 0) { break }
            [Runtime.InteropServices.Marshal]::Copy($buffer, $bytes, 0, [int]$count)
            if ($CapturePeHeader) {
                if ($dosCopied -lt 64) {
                    $copyCount = [int][Math]::Min(64 - $dosCopied, $count)
                    [Array]::Copy($bytes, 0, $dos, $dosCopied, $copyCount)
                    $dosCopied += $copyCount
                    if ($dosCopied -eq 64 -and $dos[0] -eq 0x4d -and $dos[1] -eq 0x5a) {
                        $candidate = [long][BitConverter]::ToUInt32($dos, 60)
                        # Subtraction avoids overflow and binds the range to the held leaf length.
                        if ($candidate -ge 64 -and $before.length -ge 24 -and $candidate -le $before.length - 24) { $peOffset = $candidate }
                    }
                }
                if ($null -ne $peOffset) {
                    $copyStart = [long][Math]::Max($total, $peOffset)
                    $copyEnd = [long][Math]::Min($total + $count, $peOffset + 24)
                    if ($copyEnd -gt $copyStart) {
                        if ($peCopied -ne $copyStart - $peOffset) { throw 'READ_FAILED' }
                        $copyCount = [int]($copyEnd - $copyStart)
                        [Array]::Copy($bytes, [int]($copyStart - $total), $pe, $peCopied, $copyCount)
                        $peCopied += $copyCount
                    }
                }
            }
            [void]$hash.TransformBlock($bytes, 0, [int]$count, $null, 0)
            $total += $count
        }
        if ($total -ne $before.length) { throw 'SHORT_READ' }
        [void]$hash.TransformFinalBlock([byte[]]::new(0), 0, 0)
        $after = Get-XRayHandleMetadata $Session.leaf $false
        if (($before | ConvertTo-Json -Compress) -cne ($after | ConvertTo-Json -Compress)) { throw 'FILE_CHANGED' }
        for ($index = 0; $index -lt $Session.chain.Count - 1; $index++) {
            $parentAfter = Get-XRayHandleMetadata $Session.handles[$index] $true
            $parentBefore = $Session.chain[$index]
            if ($parentAfter.volume -cne $parentBefore.volume -or $parentAfter.fileId -cne $parentBefore.fileId -or
                $parentAfter.attributes -ne $parentBefore.attributes) { throw 'FILE_CHANGED' }
            # Directory times/length may change from member creation: no directory snapshot claim.
        }
        $observation = [pscustomobject]@{
            status = 'observed'; snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'
            identity = [pscustomobject]@{ volume = $before.volume; fileId = $before.fileId }
            bytesRead = $total; bufferBytes = $bufferSize; readCalls = $reads
            sha256 = ([BitConverter]::ToString($hash.Hash)).Replace('-', '').ToLowerInvariant()
            heldHandles = $Session.handles.Count
        }
        if ($CapturePeHeader) {
            if ($dosCopied -ne [Math]::Min(64, $total) -or
                ($null -ne $peOffset -and $peCopied -ne 24) -or ($null -eq $peOffset -and $peCopied -ne 0)) { throw 'READ_FAILED' }
            # Only publish after all original held-object/hash/length/parent checks.
            $capture = [pscustomobject]@{ version = 1; fileBytes = $total
                dosHex = ([BitConverter]::ToString($dos, 0, $dosCopied)).Replace('-', '').ToLowerInvariant()
                peOffset = $peOffset
                peHex = ([BitConverter]::ToString($pe, 0, $peCopied)).Replace('-', '').ToLowerInvariant() }
            $observation | Add-Member -NotePropertyName peCapture -NotePropertyValue $capture
        }
        return $observation
    } catch {
        if ($_.Exception.Message -in @('FILE_CHANGED', 'READ_FAILED', 'SIZE_OR_LENGTH_CHANGED', 'SHORT_READ', 'NOT_DISK', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'REPARSE_REJECTED', 'TYPE_REJECTED')) { throw $_.Exception.Message }
        throw 'READ_FAILED'
    } finally {
        if ($null -ne $hash) { $hash.Dispose() }
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
        if ($null -ne $dos) { [Array]::Clear($dos, 0, $dos.Length) }
        if ($null -ne $pe) { [Array]::Clear($pe, 0, $pe.Length) }
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
    }
}
