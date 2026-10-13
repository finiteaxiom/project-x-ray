# Internal direct-member observation. Import defines functions only; M4 owns all HANDLE release.
function Initialize-XRayDirectoryApi {
    if ($script:XRayDirectoryApi) { return }
    if ([IntPtr]::Size -ne 8 -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'RUNTIME_UNSUPPORTED' }
    try {
        $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('XRayDirectoryReadOnly'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
        $builder = $assembly.DefineDynamicModule('MemoryOnly').DefineType('XRayDirectoryNative', 'Public, Abstract, Sealed')
        $arguments = [Type[]]@([IntPtr], [int], [IntPtr], [uint32])
        $native = $builder.DefineMethod('NativeInfo', [Reflection.MethodAttributes]'Private, Static, PinvokeImpl', [int], $arguments)
        $attribute = [Runtime.InteropServices.DllImportAttribute]
        $fields = [Reflection.FieldInfo[]]@($attribute.GetField('EntryPoint'), $attribute.GetField('SetLastError'), $attribute.GetField('ExactSpelling'), $attribute.GetField('CallingConvention'), $attribute.GetField('CharSet'))
        $values = [object[]]@('GetFileInformationByHandleEx', $true, $true, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode)
        $native.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($attribute.GetConstructor([Type[]]@([string])), [object[]]@('kernel32.dll'), $fields, $values))
        $native.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
        $query = $builder.DefineMethod('Query', [Reflection.MethodAttributes]'Public, Static', [int], [Type[]]@([IntPtr], [int], [IntPtr], [uint32], [int].MakeByRefType()))
        $il = $query.GetILGenerator(); $result = $il.DeclareLocal([int]); $op = [Reflection.Emit.OpCodes]
        $il.Emit($op::Ldarg_0); $il.Emit($op::Ldarg_1); $il.Emit($op::Ldarg_2); $il.Emit($op::Ldarg_3)
        $il.Emit($op::Call, $native); $il.Emit($op::Stloc, $result)
        # Capture inside the emitted wrapper, before reflection or another native call can intervene.
        $il.Emit($op::Ldarg_S, [byte]4)
        $il.Emit($op::Call, [Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error', [Type[]]@()))
        $il.Emit($op::Stind_I4); $il.Emit($op::Ldloc, $result); $il.Emit($op::Ret)
        $type = $builder.CreateType()
        $bound = $type.GetMethod('NativeInfo', [Reflection.BindingFlags]'NonPublic, Static').GetCustomAttributes($attribute, $false)
        if ($bound.Count -ne 1 -or -not $bound[0].SetLastError -or $bound[0].EntryPoint -cne 'GetFileInformationByHandleEx') { throw 'DIRECTORY_BINDING_FAILED' }
        $script:XRayDirectoryApi = $type
    } catch { throw 'DIRECTORY_BINDING_FAILED' }
}

function Get-XRayDirectoryMetadata([IntPtr]$Handle, [bool]$Directory) {
    if ((Invoke-XRayNative GetFileType @($Handle)) -ne 1) { throw 'NOT_DISK' }
    $buffer = New-XRayZeroBuffer 40
    try {
        $marshal = [Runtime.InteropServices.Marshal]
        if ((Invoke-XRayNative GetFileInformationByHandleEx @($Handle, 9, $buffer, [uint32]8)) -eq 0) { throw 'METADATA_UNAVAILABLE' }
        $attributes = $marshal::ReadInt32($buffer, 0)
        if (($attributes -band 0x400) -ne 0) { throw 'REPARSE_REJECTED' }
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

function Copy-XRayDirectoryMetadata($Metadata) {
    if ($null -eq $Metadata -or $Metadata -isnot [pscustomobject]) { throw 'DIRECTORY_CHANGED' }
    foreach ($field in @('volume', 'fileId', 'directory', 'attributes', 'creation', 'write', 'change', 'length', 'allocation', 'links')) {
        if ($null -eq $Metadata.PSObject.Properties[$field]) { throw 'DIRECTORY_CHANGED' }
    }
    if ($Metadata.volume -isnot [string] -or $Metadata.fileId -isnot [string] -or $Metadata.directory -isnot [bool] -or
        $Metadata.attributes -isnot [int] -or $Metadata.creation -isnot [long] -or $Metadata.write -isnot [long] -or
        $Metadata.change -isnot [long] -or $Metadata.length -isnot [long] -or $Metadata.allocation -isnot [long] -or $Metadata.links -isnot [int]) { throw 'DIRECTORY_CHANGED' }
    return [pscustomobject]@{
        volume = [string]$Metadata.volume; fileId = [string]$Metadata.fileId; directory = [bool]$Metadata.directory
        attributes = [int]$Metadata.attributes; creation = [long]$Metadata.creation; write = [long]$Metadata.write
        change = [long]$Metadata.change; length = [long]$Metadata.length; allocation = [long]$Metadata.allocation; links = [int]$Metadata.links
    }
}

function Assert-XRayDirectoryMetadataStable($Before, $After) {
    $expected = Copy-XRayDirectoryMetadata $Before; $actual = Copy-XRayDirectoryMetadata $After
    if ($expected.volume -cne $actual.volume -or $expected.fileId -cne $actual.fileId -or $expected.directory -ne $actual.directory -or
        $expected.attributes -ne $actual.attributes -or $expected.creation -ne $actual.creation -or $expected.write -ne $actual.write -or
        $expected.change -ne $actual.change -or $expected.length -ne $actual.length -or $expected.allocation -ne $actual.allocation -or
        $expected.links -ne $actual.links) { throw 'DIRECTORY_CHANGED' }
}

# Local dynamic-scope override only for this explicit directory session; the default file API is untouched.
function Open-XRayArtifactDirectorySession([string]$Path) {
    function Get-XRayHandleMetadata([IntPtr]$Handle, [bool]$Directory) { return (Get-XRayDirectoryMetadata $Handle $Directory) }
    return (Open-XRayArtifactSession $Path -DirectoryLeaf $true)
}

function Invoke-XRayDirectoryPage([IntPtr]$Handle, [int]$Class, [IntPtr]$Buffer, [uint32]$Bytes) {
    if ($Handle -eq [IntPtr]::Zero -or $Class -notin @(19, 20) -or $Bytes -ne 65536) { throw 'DIRECTORY_QUERY_FAILED' }
    $arguments = [object[]]@($Handle, $Class, $Buffer, $Bytes, [int]0)
    try {
        $success = $script:XRayDirectoryApi.GetMethod('Query').Invoke($null, $arguments)
        return [pscustomobject]@{ success = $success -ne 0; error = [int]$arguments[4] }
    } catch { throw 'DIRECTORY_QUERY_FAILED' }
}

function Assert-XRayDirectoryName([string]$Name) {
    if ($Name.Length -lt 1 -or $Name.Length -gt 255 -or $Name -in @('.', '..') -or
        $Name -match '[\x00-\x1f\\/:<>"|?*]' -or $Name.EndsWith('.') -or $Name.EndsWith(' ') -or
        $Name -match '^(?i:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)') { throw 'DIRECTORY_PAGE_INVALID' }
}

function Convert-XRayDirectoryPage([byte[]]$Page, [int]$MaxRecords = 130, [long]$MaxAccountedBytes = 33554432) {
    if ($null -eq $Page -or $Page.Length -ne 65536 -or $MaxRecords -lt 1 -or $MaxRecords -gt 682 -or
        $MaxAccountedBytes -lt 1 -or $MaxAccountedBytes -gt 33554432) { throw 'DIRECTORY_PAGE_INVALID' }
    $entries = [Collections.Generic.List[object]]::new(); $position = 0; $records = 0; $accountedBytes = [long]0
    $unicode = [Text.UnicodeEncoding]::new($false, $false, $true)
    try {
        while ($true) {
            if ($position -lt 0 -or $position -gt 65536 - 90 -or ($position % 8) -ne 0) { throw 'DIRECTORY_PAGE_INVALID' }
            if ($MaxRecords -eq 130) { if (++$records -gt 130) { throw 'DIRECTORY_PAGE_INVALID' } }
            elseif (++$records -gt $MaxRecords) { throw 'DIRECTORY_PAGE_INVALID' }
            $next = [long][BitConverter]::ToUInt32($Page, $position)
            $nameBytes = [long][BitConverter]::ToUInt32($Page, $position + 60)
            if ($nameBytes -lt 2 -or $nameBytes -gt 510 -or ($nameBytes % 2) -ne 0 -or $nameBytes -gt 65536 - $position - 88) { throw 'DIRECTORY_PAGE_INVALID' }
            $end = 88 + $nameBytes
            if ($next -ne 0 -and (($next % 8) -ne 0 -or $next -lt $end -or $next -gt 65536 - $position - 90)) { throw 'DIRECTORY_PAGE_INVALID' }
            $name = $unicode.GetString($Page, $position + 88, [int]$nameBytes)
            if ($name -cnotin @('.', '..')) {
                Assert-XRayDirectoryName $name
                $attributes = [BitConverter]::ToUInt32($Page, $position + 56)
                # Unknown/reserved type bits are unsupported; no tag value is consulted for ordinary entries.
                if ($attributes -eq 0 -or ($attributes -band 0x400) -ne 0 -or ($attributes -band 0x40) -ne 0 -or ($attributes -band 0xffff0000L) -ne 0) { throw 'DIRECTORY_TYPE_REJECTED' }
                $id = ([BitConverter]::ToString($Page, $position + 72, 16)).Replace('-', '')
                if ($id -ceq ('0' * 32) -or $id -ceq ('F' * 32)) { throw 'DIRECTORY_ID_REJECTED' }
                $length = [BitConverter]::ToInt64($Page, $position + 40); $allocation = [BitConverter]::ToInt64($Page, $position + 48)
                if ($length -lt 0 -or $allocation -lt 0) { throw 'DIRECTORY_PAGE_INVALID' }
                $entry = [pscustomobject]@{ name = $name; fileId = $id; directory = ($attributes -band 16) -ne 0
                    attributes = [long]$attributes; length = $length; allocation = $allocation
                    creation = [BitConverter]::ToInt64($Page, $position + 8)
                    write = [BitConverter]::ToInt64($Page, $position + 24); change = [BitConverter]::ToInt64($Page, $position + 32) }
                $entryBytes = [Text.Encoding]::UTF8.GetByteCount(($entry | ConvertTo-Json -Compress -Depth 3)) + 256
                if ($accountedBytes -gt $MaxAccountedBytes - $entryBytes) { throw 'DIRECTORY_LIMIT' }
                $accountedBytes += $entryBytes; $entries.Add($entry)
            }
            if ($next -eq 0) { break }
            $position += [int]$next
        }
        return ,$entries
    } catch {
        if ($_.Exception.Message -cin @('DIRECTORY_PAGE_INVALID', 'DIRECTORY_TYPE_REJECTED', 'DIRECTORY_ID_REJECTED', 'DIRECTORY_LIMIT')) { throw $_.Exception.Message }
        throw 'DIRECTORY_PAGE_INVALID'
    }
}

function Get-XRayDirectoryVector([IntPtr]$Handle, [IntPtr]$Buffer, [byte[]]$Page,
    [int]$MaxMembers = 128, [int]$MaxCalls = 132, [int]$MaxRecords = 130, [long]$MaxAccountedBytes = 33554432) {
    if ($MaxMembers -lt 0 -or $MaxMembers -gt 5000 -or $MaxCalls -lt 1 -or $MaxCalls -gt 5003 -or
        $MaxRecords -lt 1 -or $MaxRecords -gt 682 -or $MaxAccountedBytes -lt 1 -or $MaxAccountedBytes -gt 33554432) { throw 'DIRECTORY_LIMIT' }
    $entries = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $calls = 0; $class = 20; $accountedBytes = [long]0
    while ($true) {
        if ($MaxCalls -eq 132) { if (++$calls -gt 132) { throw 'DIRECTORY_LIMIT' } }
        elseif (++$calls -gt $MaxCalls) { throw 'DIRECTORY_LIMIT' }
        [Array]::Clear($Page, 0, $Page.Length); [Runtime.InteropServices.Marshal]::Copy($Page, 0, $Buffer, $Page.Length)
        $result = Invoke-XRayDirectoryPage $Handle $class $Buffer ([uint32]65536)
        if (-not $result.success) {
            if ($result.error -eq 18) { break } # ERROR_NO_MORE_FILES from THIS SetLastError call only.
            throw 'DIRECTORY_QUERY_FAILED'
        }
        $class = 19
        [Runtime.InteropServices.Marshal]::Copy($Buffer, $Page, 0, $Page.Length)
        $remaining = $MaxAccountedBytes - $accountedBytes
        if ($remaining -lt 1) { throw 'DIRECTORY_LIMIT' }
        $parsed = Convert-XRayDirectoryPage $Page $MaxRecords $remaining
        foreach ($entry in $parsed) {
            if (-not $names.Add($entry.name) -or -not $ids.Add($entry.fileId)) { throw 'DIRECTORY_COLLISION' }
            if ($MaxMembers -eq 128) { if ($entries.Count -ge 128) { throw 'DIRECTORY_LIMIT' } }
            elseif ($entries.Count -ge $MaxMembers) { throw 'DIRECTORY_LIMIT' }
            $entryBytes = [Text.Encoding]::UTF8.GetByteCount(($entry | ConvertTo-Json -Compress -Depth 3)) + 1024
            if ($accountedBytes -gt $MaxAccountedBytes - $entryBytes) { throw 'DIRECTORY_LIMIT' }
            $accountedBytes += $entryBytes
            $entries.Add($entry.name, $entry)
        }
    }
    $ordered = [string[]]@($entries.Keys); [Array]::Sort($ordered, [StringComparer]::Ordinal)
    return [pscustomobject]@{ entries = @($ordered | ForEach-Object { $entries[$_] }); calls = $calls; accountedBytes = $accountedBytes }
}

function Assert-XRayDirectoryVectorsStable($Before, $After) {
    if ($null -eq $Before -or $Before -isnot [pscustomobject] -or $null -eq $After -or $After -isnot [pscustomobject] -or
        $null -eq $Before.PSObject.Properties['entries'] -or $null -eq $After.PSObject.Properties['entries'] -or
        ($Before.PSObject.Properties['entries'].Value -isnot [array]) -or ($After.PSObject.Properties['entries'].Value -isnot [array])) { throw 'DIRECTORY_CHANGED' }
    if (($Before.entries | ConvertTo-Json -Compress -Depth 5) -cne ($After.entries | ConvertTo-Json -Compress -Depth 5)) { throw 'DIRECTORY_CHANGED' }
}

function Assert-XRayDirectoryMember($Entry, $Metadata, [string]$Volume) {
    if ($Metadata.volume -cne $Volume -or $Metadata.fileId -cne $Entry.fileId -or $Metadata.directory -ne $Entry.directory -or
        $Metadata.attributes -ne $Entry.attributes -or $Metadata.creation -ne $Entry.creation -or
        (-not $Entry.directory -and ($Metadata.write -ne $Entry.write -or $Metadata.change -ne $Entry.change -or
            $Metadata.length -ne $Entry.length -or $Metadata.allocation -ne $Entry.allocation))) { throw 'DIRECTORY_CHANGED' }
}

function Get-XRayArtifactDirectoryObservation($Session) {
    if ($Session.released -or $Session.readStarted -or -not $Session.before.directory -or $Session.leaf -eq [IntPtr]::Zero) { throw 'SESSION_INVALID' }
    $Session.readStarted = $true
    $buffer = [IntPtr]::Zero; $page = $null
    $ancestors = $Session.handles.Count
    try {
        Initialize-XRayDirectoryApi
        $page = [byte[]]::new(65536); $buffer = New-XRayZeroBuffer 65536
        $before = Get-XRayDirectoryMetadata $Session.leaf $true
        if ($before.volume -cne $Session.before.volume -or $before.fileId -cne $Session.before.fileId -or $before.attributes -ne $Session.before.attributes) { throw 'DIRECTORY_CHANGED' }
        $first = Get-XRayDirectoryVector $Session.leaf $buffer $page
        $members = [Collections.Generic.List[object]]::new()
        foreach ($entry in $first.entries) {
            foreach ($ancestor in $Session.chain) { if ($entry.fileId -ceq $ancestor.fileId -and $before.volume -ceq $ancestor.volume) { throw 'DIRECTORY_COLLISION' } }
            $handle = Open-XRayRelativeHandle $Session.leaf $entry.name $entry.directory
            # Single release owner. Register immediately, even if subsequent metadata validation fails.
            if ($Session.handles.Contains($handle)) { throw 'DIRECTORY_CHANGED' }
            $Session.handles.Add($handle)
            $metadata = Get-XRayDirectoryMetadata $handle $entry.directory
            $metadataBefore = Copy-XRayDirectoryMetadata $metadata
            Assert-XRayDirectoryMember $entry $metadata $before.volume
            $members.Add([pscustomobject]@{ entry = $entry; handle = $handle; metadataBefore = $metadataBefore })
        }
        $second = Get-XRayDirectoryVector $Session.leaf $buffer $page
        Assert-XRayDirectoryVectorsStable $first $second
        foreach ($member in $members) {
            $actual = Get-XRayDirectoryMetadata $member.handle $member.entry.directory
            Assert-XRayDirectoryMetadataStable $member.metadataBefore $actual
            Assert-XRayDirectoryMember $member.entry $actual $before.volume
        }
        for ($index = 0; $index -lt $ancestors; $index++) {
            $actual = Get-XRayDirectoryMetadata $Session.handles[$index] $true; $expected = $Session.chain[$index]
            if ($actual.volume -cne $expected.volume -or $actual.fileId -cne $expected.fileId -or $actual.attributes -ne $expected.attributes) { throw 'DIRECTORY_CHANGED' }
            if ($index -eq $ancestors - 1 -and ($actual.creation -ne $before.creation -or $actual.write -ne $before.write -or $actual.change -ne $before.change)) { throw 'DIRECTORY_CHANGED' }
        }
        $output = [pscustomobject]@{ version = 1; status = 'observed'; scope = 'direct-members'; snapshotStatus = 'incomplete'; signatureStatus = 'not-evaluated'
            identity = [pscustomobject]@{ volume = $before.volume; fileId = $before.fileId }; pageBytes = 65536
            enumerationCalls = $first.calls + $second.calls; memberCount = $members.Count; heldHandles = $Session.handles.Count
            members = @($first.entries | ForEach-Object { [pscustomobject]@{ name = $_.name; fileId = $_.fileId
                kind = $(if ($_.directory) { 'directory' } else { 'file' }); attributes = $_.attributes
                length = $(if ($_.directory) { $null } else { $_.length.ToString([Globalization.CultureInfo]::InvariantCulture) }) } }) }
        if ([Text.Encoding]::UTF8.GetByteCount(($output | ConvertTo-Json -Compress -Depth 8)) -gt 49152) { throw 'DIRECTORY_LIMIT' }
        return $output
    } catch {
        if ($_.Exception.Message -cin @('RUNTIME_UNSUPPORTED', 'DIRECTORY_BINDING_FAILED', 'DIRECTORY_QUERY_FAILED', 'DIRECTORY_PAGE_INVALID', 'DIRECTORY_TYPE_REJECTED', 'DIRECTORY_ID_REJECTED', 'DIRECTORY_COLLISION', 'DIRECTORY_LIMIT', 'DIRECTORY_CHANGED', 'OPEN_REJECTED', 'REPARSE_REJECTED', 'TYPE_REJECTED', 'METADATA_UNAVAILABLE', 'IDENTITY_UNAVAILABLE', 'NOT_DISK', 'HANDLE_CLOSE_UNCONFIRMED')) { throw $_.Exception.Message }
        throw 'DIRECTORY_OBSERVATION_FAILED'
    } finally {
        if ($null -ne $page) { [Array]::Clear($page, 0, $page.Length) }
        if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer) }
    }
}
