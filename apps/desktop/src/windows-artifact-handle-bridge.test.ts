import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Observation = { status: string; snapshotStatus: string; signatureStatus: string; identity: { volume: string; fileId: string };
  bytesRead: number; bufferBytes: number; readCalls: number; sha256: string; heldHandles: number };
type Ready = { observation: Observation; processId: number; psVersion: string; pointerBytes: number; existingMappingChangedAfterRead: boolean };
type Options = { signal?: AbortSignal; timeoutMs?: number; readyTimeoutMs?: number; closeTimeoutMs?: number };
type Launch = { executable: string; fixedArgs: string[]; helperPath: string; cwd: string };
type Result = { status: string; ready: Ready; closeConfirmed: boolean; cleanupSafe: boolean; exitCode: number };
type Api = { withOwnedReaderProcess(launch: Launch, input: Record<string, unknown>, consumer: (ready: Ready) => unknown, options?: Options): Promise<Result> };
const cwd = resolve(process.cwd());
const desktop = basename(cwd).toLowerCase() === "desktop" && basename(dirname(cwd)).toLowerCase() === "apps" ? cwd : join(cwd, "apps", "desktop");
const library = join(desktop, "scripts/windows-artifact-handle-bridge.ps1");
const helper = join(desktop, "scripts/test-fixtures/windows-artifact-handle-probe.ps1");
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const api = createRequire(join(desktop, "package.json"))("./scripts/windows-artifact-reader-process.cjs") as Api;
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const importLibrary = `. ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(library)})));`;
// ExecutionPolicy stays unchanged. Only our two literal, trusted script paths are evaluated.
// M3 appends helperPath; the comment consumes that trailing CLI text, including spaces.
const command = `${importLibrary} & ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(helper)}))) #`;
const launch: Launch = { executable: powershell, helperPath: helper, cwd: desktop, fixedArgs: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms));

function fixture(bytes: Uint8Array = Buffer.from("owned fixture"), name = "sample.bin") {
  const directory = mkdtempSync(join(tmpdir(), "xray-m4-owned-"));
  writeFileSync(join(directory, ".xray-owned-material"), "4B-M4 test-owned; retain, no cleanup");
  const file = join(directory, name); writeFileSync(file, bytes);
  return { directory, file, bytes };
}
function run(file: string, consumer: (ready: Ready) => unknown = () => undefined, options: Options = {}, mode = "ordinary", maxBytes = 2147483648) {
  return api.withOwnedReaderProcess(launch, { filePath: file, maxBytes, fixtureMode: mode }, consumer,
    { timeoutMs: 15000, readyTimeoutMs: 10000, ...options });
}
function direct(script: string) {
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `${importLibrary} ${script}`],
    { windowsHide: true, encoding: "utf8", timeout: 15000, env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } });
  expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}
function reopen(file: string) { const fd = openSync(file, "r+"); closeSync(fd); }
function denied(operation: () => void) {
  let error: unknown; try { operation(); } catch (caught) { error = caught; }
  expect(error).toBeDefined(); expect(["EPERM", "EACCES", "EBUSY"]).toContain((error as NodeJS.ErrnoException).code);
}
function descendants(pid: number): string[] {
  const result = direct(`[Console]::WriteLine((@{ names = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty Name) } | ConvertTo-Json -Compress))`);
  return result.names as string[];
}
async function emptyHostDescendants() {
  const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "[Console]::Out.WriteLine($PID); [Console]::Out.Flush(); [void][Console]::In.ReadLine()"],
  { windowsHide: true, env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }, stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<number | null>((resolveClose, rejectClose) => { child.once("close", resolveClose); child.once("error", rejectClose); });
  const watchdog = setTimeout(() => child.kill(), 10000);
  try {
    const pid = await new Promise<number>((resolvePid, rejectPid) => {
      child.stdout.once("data", data => resolvePid(Number(String(data).trim()))); child.once("error", rejectPid);
    });
    expect(Number.isInteger(pid)).toBe(true); const names = descendants(pid);
    child.stdin.end("\n"); expect(await closed).toBe(0); return names;
  } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; } }
}

describe.skipIf(process.platform !== "win32")("Windows PS5.1 owned single-file HANDLE bridge", () => {
  it("imports without opening objects or emitting a native type; audits no compiler/process launch or write/delete binding", () => {
    const audit = direct("[Console]::WriteLine((@{ initialized = $null -ne $script:XRayHandleApi; nativeTypes = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -eq 'XRayReadOnlyHandles' }).Count; policy = (Get-ExecutionPolicy).ToString() } | ConvertTo-Json -Compress))");
    expect(audit.initialized).toBe(false); expect(audit.nativeTypes).toBe(0);
    for (const file of [library, helper]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\bAdd-Type\b|\bStart-Process\b|\[Diagnostics\.Process\]|\.DefineDynamicAssembly\([^)]*Save/s);
    }
    expect(readFileSync(library, "utf8")).not.toMatch(/'WriteFile'|'DeleteFileW'|'CreateFileMappingW'|'MoveFileW'/);
  });

  it.each([0, 13, 3 * 1048576 + 17])("hashes %i bytes from one held file with bounded buffers and stable full identity", async size => {
    const bytes = Buffer.alloc(size, 0xa7); const f = fixture(bytes, "Unicode-源码-'证据.bin");
    let identity: Observation["identity"] | undefined;
    const first = await run(f.file, ready => {
      expect(ready.psVersion).toMatch(/^5\.1\./); expect(ready.pointerBytes).toBe(8);
      const o = ready.observation;
      expect(o).toMatchObject({ status: "observed", snapshotStatus: "incomplete", signatureStatus: "not-evaluated", bytesRead: statSync(f.file).size,
        bufferBytes: 1048576, sha256: sha256(bytes), readCalls: Math.ceil(size / 1048576) + 1 });
      expect(o.identity.volume).toMatch(/^[0-9A-F]{16}$/); expect(o.identity.fileId).toMatch(/^[0-9A-F]{32}$/);
      // Independent Node stat uses the low 64 bits; retain all 128 bits in the DTO.
      expect(Buffer.from(o.identity.fileId, "hex").readBigUInt64LE()).toBe(statSync(f.file, { bigint: true }).ino);
      expect(o.heldHandles).toBe(f.file.slice(3).split("\\").length + 1); identity = o.identity;
      const dto = JSON.stringify(ready); expect(dto).not.toContain(f.file); expect(dto).not.toContain("owned fixture");
      denied(() => { const fd = openSync(f.file, "r+"); closeSync(fd); });
    });
    expect(first).toMatchObject({ status: "released", exitCode: 0, cleanupSafe: true, closeConfirmed: true }); reopen(f.file);
    await run(f.file, ready => expect(ready.observation.identity).toEqual(identity));
    const other = fixture(bytes); await run(other.file, ready => expect(ready.observation.identity.fileId).not.toBe(identity?.fileId));
  }, 30000);

  it("holds the leaf and parent chain across consumer work, blocks write/rename/delete, permits directory member creation, then releases", async () => {
    const f = fixture(); const moved = `${f.file}.moved`;
    const baselineChildren = await emptyHostDescendants();
    expect(baselineChildren.every(name => name.toLowerCase() === "conhost.exe")).toBe(true);
    await run(f.file, async ready => {
      denied(() => writeFileSync(f.file, "changed")); denied(() => renameSync(f.file, moved)); denied(() => unlinkSync(f.file));
      denied(() => renameSync(f.directory, `${f.directory}-moved`));
      // Deliberate negative: sharing a directory does not freeze its members.
      const added = join(f.directory, "new-owned-member.bin"); writeFileSync(added, "new owned member"); expect(existsSync(added)).toBe(true);
      expect(readFileSync(f.file)).toEqual(f.bytes);
      // Windows PS5.1 owns a console-host process even in the empty baseline.
      // Census is finite evidence, not an OS guarantee against spawning descendants.
      expect(descendants(ready.processId).sort()).toEqual(baselineChildren.sort()); await delay(50);
    });
    reopen(f.file); renameSync(f.file, moved); renameSync(moved, f.file); expect(readFileSync(f.file)).toEqual(f.bytes);
  }, 20000);

  it("refuses an existing writer without widening sharing and releases all preceding handles", async () => {
    const f = fixture(); const writer = openSync(f.file, "r+");
    try { await expect(run(f.file)).rejects.toMatchObject({ code: "CHILD_EXIT", cleanupSafe: true, closeConfirmed: true }); }
    finally { closeSync(writer); }
    reopen(f.file); renameSync(f.directory, `${f.directory}-moved`); renameSync(`${f.directory}-moved`, f.directory);
    await run(f.file);
  });

  it("records the existing writable mapping negative after its original writer is closed", async () => {
    const f = fixture(Buffer.from([0x31, 0x32, 0x33]));
    // Isolate the negative, and assert the writer OS handle really closed.
    // On this target the live writable section still prevents the read-only open.
    const observed = direct(`$text = [IO.File]::ReadAllText(${psQuote(helper)}); . ([scriptblock]::Create($text.Substring(0, $text.IndexOf('# Begin protocol')))); ` +
      `New-XRayOwnedMapping ${psQuote(f.file)}; $old = [Runtime.InteropServices.Marshal]::ReadByte($view); [Runtime.InteropServices.Marshal]::WriteByte($view, [byte]($old -bxor 0xff)); ` +
      `$changed = [Runtime.InteropServices.Marshal]::ReadByte($view) -ne $old; $code = 'UNEXPECTED_OPEN'; ` +
      `try { $s = Open-XRayArtifactSession ${psQuote(f.file)}; Close-XRayArtifactSession $s } catch { $code = $_.Exception.Message }; ` +
      `$unmapped = $mappingApi.GetMethod('UnmapViewOfFile').Invoke($null, [object[]]@($view)); $closed = $mappingApi.GetMethod('CloseHandle').Invoke($null, [object[]]@($mapping)); ` +
      `[Console]::WriteLine((@{ writerClosed = $mappingWriterClosed; changed = $changed; code = $code; unmapped = $unmapped; closed = $closed } | ConvertTo-Json -Compress))`);
    expect(observed).toMatchObject({ writerClosed: true, changed: true, code: "OPEN_REJECTED", unmapped: 1, closed: 1 });
    reopen(f.file); expect(readFileSync(f.file)[0]).toBe(0xce);
    await expect(run(f.file, () => { throw new Error("must not become ready with this existing writable section"); }, {}, "existing-mapping"))
      .rejects.toMatchObject({ code: "CHILD_EXIT", cleanupSafe: true, closeConfirmed: true });
    reopen(f.file);
  });

  it("rejects parent and leaf junctions, missing/type/size/path failures, with zero retained handles in the same session process", () => {
    const f = fixture(); const target = fixture();
    const parentJunction = join(f.directory, "parent-junction"); const leafJunction = join(f.directory, "leaf-junction");
    symlinkSync(target.directory, parentJunction, "junction"); symlinkSync(target.directory, leafJunction, "junction");
    const cases = [join(parentJunction, basename(target.file)), leafJunction, join(f.directory, "missing.bin"), f.directory,
      "\\\\server\\share\\file", "\\\\?\\C:\\file", "C:relative", `${f.file}:stream`, `${f.directory}\\.\\sample.bin`,
      `${f.file}.`, `${f.file} `, `${f.directory}\\..\\file`, `${f.directory}\\\\sample.bin`];
    const track = "$savedNative = (Get-Item Function:Invoke-XRayNative).ScriptBlock; $script:tracked = [Collections.Generic.HashSet[long]]::new(); " +
      "function Invoke-XRayNative([string]$Name, [object[]]$Arguments) { $r = & $savedNative $Name $Arguments; " +
      "if ($Name -eq 'CreateFileW' -and $r -ne [IntPtr]::Zero -and $r -ne [IntPtr](-1)) { [void]$script:tracked.Add($r.ToInt64()) }; " +
      "if ($Name -eq 'NtCreateFile' -and $Arguments[0] -ne [IntPtr]::Zero -and $Arguments[0] -ne [IntPtr](-1)) { [void]$script:tracked.Add($Arguments[0].ToInt64()) }; " +
      "if ($Name -eq 'CloseHandle' -and $r -ne 0) { [void]$script:tracked.Remove($Arguments[0].ToInt64()) }; return $r }; ";
    const script = track + `$codes = @(); $leaks = @(); foreach ($p in @(${cases.map(psQuote).join(",")})) { try { $s = Open-XRayArtifactSession $p; Close-XRayArtifactSession $s; $codes += 'UNEXPECTED_OPEN' } catch { $codes += $_.Exception.Message }; $leaks += $tracked.Count }; ` +
      `try { $s = Open-XRayArtifactSession ${psQuote(f.file)} 0; Close-XRayArtifactSession $s; $codes += 'UNEXPECTED_OPEN' } catch { $codes += $_.Exception.Message }; ` +
      `$s = Open-XRayArtifactSession ${psQuote(f.file)}; $o = Get-XRayArtifactObservation $s; Close-XRayArtifactSession $s; ` +
      `[Console]::WriteLine((@{ codes = $codes; leaks = $leaks; trackedRemaining = $tracked.Count; remaining = $s.handles.Count; released = $s.released; hash = $o.sha256 } | ConvertTo-Json -Compress))`;
    const result = direct(script); expect(result.remaining).toBe(0); expect(result.released).toBe(true); expect(result.hash).toBe(sha256(f.bytes));
    const codes = result.codes as string[]; expect(codes).not.toContain("UNEXPECTED_OPEN");
    expect(result.leaks).toEqual(cases.map(() => 0)); expect(result.trackedRemaining).toBe(0);
    expect(codes[0]).toBe("REPARSE_REJECTED"); expect(codes[1]).toBe("OPEN_REJECTED"); expect(codes.at(-1)).toBe("SIZE_LIMIT");
    reopen(f.file); reopen(target.file);
  });

  it("keeps file-symlink EPERM as an environment fact, or verifies no-follow if that capability is present", async () => {
    const f = fixture(); const link = join(f.directory, "file-symlink.bin");
    try { symlinkSync(f.file, link, "file"); }
    catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("EPERM"); expect(existsSync(link)).toBe(false); return; }
    await expect(run(link)).rejects.toMatchObject({ code: "CHILD_EXIT", cleanupSafe: true });
    expect(readFileSync(f.file)).toEqual(f.bytes);
  });

  it.each(["short-read", "read-failure", "metadata-change", "close-failure"])("fails closed on controlled %s without losing the real held handle", mode => {
    const f = fixture(Buffer.alloc(1048576 + 17, 0x63));
    const setup = `$s = Open-XRayArtifactSession ${psQuote(f.file)}; $savedNative = (Get-Item Function:Invoke-XRayNative).ScriptBlock; $savedMetadata = (Get-Item Function:Get-XRayHandleMetadata).ScriptBlock; $script:readCalls = 0; $script:metadataCalls = 0; $script:closeCalls = 0; `;
    const fault = mode === "metadata-change"
      ? "function Get-XRayHandleMetadata([IntPtr]$h, [bool]$d) { $m = & $savedMetadata $h $d; if (-not $d) { $script:metadataCalls++; if ($script:metadataCalls -eq 2) { $m.change++ } }; return $m }; "
      : `function Invoke-XRayNative([string]$Name, [object[]]$Arguments) { if ($Name -eq 'ReadFile') { $script:readCalls++; ${mode === "read-failure" ? "return 0" : mode === "short-read" ? "if ($script:readCalls -eq 2) { $Arguments[3] = [uint32]0; return 1 }" : ""} }; ${mode === "close-failure" ? "if ($Name -eq 'CloseHandle') { $script:closeCalls++; if ($script:closeCalls -eq 1) { return 0 } };" : ""} return (& $savedNative $Name $Arguments) }; `;
    const operation = mode === "close-failure" ? "Close-XRayArtifactSession $s" : "Get-XRayArtifactObservation $s";
    const script = setup + fault + `$code = 'UNEXPECTED_SUCCESS'; try { $o = ${operation}; } catch { $code = $_.Exception.Message }; ` +
      "$beforeRelease = $s.released; $remainingBefore = $s.handles.Count; $writerBlocked = $false; " +
      `try { $writer = [IO.FileStream]::new(${psQuote(f.file)}, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite); $writer.Dispose() } catch { $writerBlocked = $true }; ` +
      "Set-Item Function:Invoke-XRayNative $savedNative; Set-Item Function:Get-XRayHandleMetadata $savedMetadata; Close-XRayArtifactSession $s; " +
      "[Console]::WriteLine((@{ code = $code; beforeRelease = $beforeRelease; remainingBefore = $remainingBefore; writerBlocked = $writerBlocked; remainingAfter = $s.handles.Count; afterRelease = $s.released } | ConvertTo-Json -Compress))";
    const result = direct(script);
    expect(result.code).toBe({ "short-read": "SHORT_READ", "read-failure": "READ_FAILED", "metadata-change": "FILE_CHANGED", "close-failure": "HANDLE_CLOSE_UNCONFIRMED" }[mode]);
    expect(result).toMatchObject({ beforeRelease: false, writerBlocked: true, remainingAfter: 0, afterRelease: true });
    expect(result.remainingBefore).toBe(mode === "close-failure" ? 1 : f.file.slice(3).split("\\").length + 1); reopen(f.file);
  });

  it("records the real last-write-time setter sharing rejection between native reads and permits it after release", () => {
    const f = fixture(Buffer.alloc(1048576 + 17, 0x72));
    const result = direct(`$s = Open-XRayArtifactSession ${psQuote(f.file)}; $savedNative = (Get-Item Function:Invoke-XRayNative).ScriptBlock; $script:attempted = $false; $script:blocked = $false; $script:mutationError = 0; ` +
      `function Invoke-XRayNative([string]$Name, [object[]]$Arguments) { $r = & $savedNative $Name $Arguments; if ($Name -eq 'ReadFile' -and -not $script:attempted) { $script:attempted = $true; try { [IO.File]::SetLastWriteTimeUtc(${psQuote(f.file)}, [DateTime]::UtcNow.AddHours(1)) } catch { $script:blocked = $true; $e = $_.Exception; while ($null -ne $e.InnerException) { $e = $e.InnerException }; $script:mutationError = $e.HResult } }; return $r }; ` +
      "$code = 'OBSERVED'; try { $o = Get-XRayArtifactObservation $s } catch { $code = $_.Exception.Message }; " +
      `Set-Item Function:Invoke-XRayNative $savedNative; Close-XRayArtifactSession $s; [IO.File]::SetLastWriteTimeUtc(${psQuote(f.file)}, [DateTime]::UtcNow.AddHours(1)); ` +
      "[Console]::WriteLine((@{ code = $code; attempted = $attempted; blocked = $blocked; mutationError = $mutationError; released = $s.released; hash = $o.sha256 } | ConvertTo-Json -Compress))");
    expect(result).toEqual({ code: "OBSERVED", attempted: true, blocked: true, mutationError: -2147024864, released: true, hash: sha256(f.bytes) }); reopen(f.file);
  });

  it("does not emit released terminal when an injected CloseHandle failure occurs before finally releases it", async () => {
    const f = fixture();
    const injected = `${importLibrary} $savedNative = (Get-Item Function:Invoke-XRayNative).ScriptBlock; $script:closeCalls = 0; ` +
      "function Invoke-XRayNative([string]$Name, [object[]]$Arguments) { if ($Name -eq 'CloseHandle') { $script:closeCalls++; if ($script:closeCalls -eq 1) { return 0 } }; return (& $savedNative $Name $Arguments) }; " +
      `& ([scriptblock]::Create([IO.File]::ReadAllText(${psQuote(helper)}))) #`;
    await expect(api.withOwnedReaderProcess({ ...launch, fixedArgs: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", injected] },
      { filePath: f.file, maxBytes: 100, fixtureMode: "ordinary" }, () => undefined, { timeoutMs: 15000, readyTimeoutMs: 10000 }))
      .rejects.toMatchObject({ code: "CHILD_EXIT", cleanupSafe: true, closeConfirmed: true });
    reopen(f.file);
  });

  it.each(["cancel", "deadline", "consumer-failure"])("confirms actual process close and handle release after %s", async mode => {
    const f = fixture(); const abort = new AbortController();
    const options: Options = mode === "cancel" ? { signal: abort.signal } : mode === "deadline" ? { timeoutMs: 3500, readyTimeoutMs: 3000 } : {};
    const code = mode === "cancel" ? "CANCELLED" : mode === "deadline" ? "DEADLINE_EXCEEDED" : "CONSUMER_FAILED";
    await expect(run(f.file, () => {
      denied(() => { const fd = openSync(f.file, "r+"); closeSync(fd); });
      if (mode === "consumer-failure") throw new Error("owned-consumer-failure");
      if (mode === "cancel") abort.abort();
      return new Promise(() => undefined);
    }, options)).rejects.toMatchObject({ code, cleanupSafe: true, closeConfirmed: true });
    reopen(f.file); renameSync(f.directory, `${f.directory}-moved`); renameSync(`${f.directory}-moved`, f.directory);
  }, 20000);

  it.each(["eof", "wrong-token", "duplicate-key", "escaped-duplicate-key", "trailing-comma", "wrong-version-type", "oversized-control", "control-timeout"])("rejects %s control without released terminal and closes held handles", async mode => {
    const f = fixture(); const child = spawn(launch.executable, [...launch.fixedArgs, helper], { cwd: desktop, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let stderr = ""; let readySeen = false;
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (data: string) => { stderr += data; });
    const closed = new Promise<number | null>((resolveClose, rejectClose) => { child.once("error", rejectClose); child.once("close", code => resolveClose(code)); });
    const runId = "00000000-0000-4000-8000-000000000000"; const token = "A".repeat(32);
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (data: string) => {
      output += data;
      if (!readySeen && output.includes("\n")) {
        readySeen = true;
        if (mode === "eof") child.stdin.end();
        else if (mode === "wrong-token") child.stdin.end(JSON.stringify({ protocolVersion: 1, type: "release", runId, token: "B".repeat(32) }) + "\n");
        else if (mode === "duplicate-key") child.stdin.end(`{"protocolVersion":1,"type":"release","runId":"${runId}","token":"${token}","token":"${token}"}\n`);
        else if (mode === "escaped-duplicate-key") child.stdin.end(`{"protocolVersion":1,"type":"release","runId":"${runId}","token":"${token}","to\\u006ben":"${token}"}\n`);
        else if (mode === "trailing-comma") child.stdin.end(`{"protocolVersion":1,"type":"release","runId":"${runId}","token":"${token}",}\n`);
        else if (mode === "wrong-version-type") child.stdin.end(JSON.stringify({ protocolVersion: "1", type: "release", runId, token }) + "\n");
        else if (mode === "oversized-control") child.stdin.end(" ".repeat(17000) + "\n");
        // For timeout leave the owned stdin open; helper must end by itself.
      }
    });
    const watchdog = setTimeout(() => child.kill(), mode === "control-timeout" ? 38000 : 10000);
    try {
      child.stdin.write(JSON.stringify({ protocolVersion: 1, type: "start", runId, token, input: { filePath: f.file, maxBytes: 100, fixtureMode: "ordinary" } }) + "\n");
      expect(await closed).toBe(3); expect(readySeen).toBe(true); expect(output).not.toContain('"terminal"');
      expect(stderr.trim()).toBe(mode === "eof" ? "CONTROL_EOF" : mode === "control-timeout" ? "CONTROL_TIMEOUT" : "CONTROL_INVALID"); reopen(f.file);
    } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill(); }
  }, 40000);
});
