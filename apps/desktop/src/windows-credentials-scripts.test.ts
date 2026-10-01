import { createRequire } from "node:module";
import { join, resolve, relative, sep } from "node:path";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as nodePath from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const requireScript = createRequire(join(process.cwd(), "package.json"));
const { buildCredentials } = requireScript("./scripts/build-credentials.cjs");
const { copyCredentials } = requireScript("./scripts/copy-credentials.cjs");
const { credentialSmoke } = requireScript("./scripts/credentials-smoke.cjs");
const { electronSmoke, runElectronSmoke, isElectronSmokeEntry } = requireScript("./scripts/credentials-electron-smoke.cjs");
const root = resolve(process.cwd());
function ports() {
  const calls: string[] = [];
  const fs = { realpathSync: vi.fn((path: string) => path), existsSync: vi.fn(() => true), mkdirSync: vi.fn(), readdirSync: vi.fn(() => [] as string[]), copyFileSync: vi.fn(), openSync: vi.fn(() => 7), closeSync: vi.fn(), unlinkSync: vi.fn() };
  const spawnSync = vi.fn((_file: string, _args: string[], _options: unknown) => ({ status: 0 })); let stored: Buffer | null = null;
  const addon = { variant: "test", status: vi.fn(() => ({ code: stored ? "ok" : "missing" })), write: vi.fn((bytes: Buffer) => {
    calls.push("write"); let valid = bytes.length > 0 && bytes.length <= 2048; let value = "";
    try { value = new TextDecoder("utf8", { fatal: true }).decode(bytes); } catch { valid = false; }
    if (/[\u0000-\u0020\u007f-\u009f]/u.test(value)) valid = false;
    if (!valid) return { code: "invalid" }; stored?.fill(0); stored = Buffer.from(bytes); return { code: "ok" };
  }), read: vi.fn(() => stored ? { code: "ok", value: Buffer.from(stored) } : { code: "missing" }), remove: vi.fn(() => { calls.push("remove"); stored?.fill(0); stored = null; return { code: "ok" }; }) };
  const load = vi.fn((_modulePath: string) => addon);
  return { fs, spawnSync, addon, load, calls, runtime: { fs, spawnSync, load, platform: "win32", args: [] }, set(value: string) { stored?.fill(0); stored = Buffer.from(value); } };
}
function electronPorts() {
  const p = ports();
  const metadataPath = join(root, "node_modules", "electron", "package.json");
  const fs = { ...p.fs, readFileSync: vi.fn((path: string) => path.endsWith("package.json") ? JSON.stringify({ name: "electron", version: "44.4.3" }) : "44.4.3\n"), statSync: vi.fn(() => ({ isFile: (): boolean => true })) };
  const resolveModule = vi.fn(() => metadataPath);
  return { ...p, fs, resolveModule, runtime: { ...p.runtime, fs, resolveModule, electronVersion: "44.4.3" } };
}
afterEach(() => vi.useRealTimers());
describe("credential tools, filesystem/child/native ports are all explicit fakes", () => {
  it("build uses declared node-gyp and only the new owned native directory without automatic packaging", () => {
    const p = ports(); const resolveModule = vi.fn(() => "desktop-declared-node-gyp.cjs"); buildCredentials({ ...p.runtime, resolveModule });
    expect(resolveModule).toHaveBeenCalledWith("node-gyp/bin/node-gyp.js"); expect(p.spawnSync).toHaveBeenCalledOnce(); const args = p.spawnSync.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(args[1]).toEqual(["desktop-declared-node-gyp.cjs", "rebuild", "--directory", join(root, "native")]); expect(p.fs.unlinkSync).not.toHaveBeenCalled(); expect(p.load).not.toHaveBeenCalled();
  });
  it("rejects build arguments and a build junction escape before launching a compiler", () => {
    const p = ports(); expect(() => buildCredentials({ ...p.runtime, args: ["--target=other"] })).toThrow();
    p.fs.realpathSync.mockImplementation(path => path.endsWith(`${sep}build`) ? resolve(root, "..", "outside") : path);
    expect(() => buildCredentials({ ...p.runtime, resolveModule: () => "never" })).toThrow(); expect(p.spawnSync).not.toHaveBeenCalled();
  });
  it("copies only production and does not build or invoke any credential operation", () => {
    const p = ports(); p.load.mockReturnValue({ ...p.addon, variant: "production" }); copyCredentials(p.runtime);
    expect(p.fs.copyFileSync).toHaveBeenCalledWith(join(root, "native", "build", "Release", "windows_credentials.node"), join(root, "dist", "native", "windows_credentials.node"));
    expect(p.spawnSync).not.toHaveBeenCalled(); expect(p.addon.status).not.toHaveBeenCalled(); expect(p.addon.read).not.toHaveBeenCalled();
  });
  it.each(["variant", "packaged-test", "source-escape", "destination-escape"])("rejects %s without copying or deleting anything", kind => {
    const p = ports(); if (kind !== "variant") p.load.mockReturnValue({ ...p.addon, variant: "production" });
    if (kind === "packaged-test") p.fs.readdirSync.mockReturnValue(["windows_credentials_test.node"]);
    if (kind.endsWith("escape")) p.fs.realpathSync.mockImplementation(path => (kind === "source-escape" ? path.endsWith("windows_credentials.node") : path.endsWith(`${sep}dist`)) ? resolve(root, "..", "outside") : path);
    expect(() => copyCredentials(p.runtime)).toThrow(); expect(p.fs.copyFileSync).not.toHaveBeenCalled(); expect(p.fs.unlinkSync).not.toHaveBeenCalled(); expect(p.addon.read).not.toHaveBeenCalled();
  });
  it("smokes only the test variant, verifies restarted children and removes only its own value", () => {
    const p = ports(); credentialSmoke(p.runtime); expect(p.spawnSync).toHaveBeenCalledTimes(3); expect(p.addon.remove).toHaveBeenCalledTimes(2); expect(p.fs.unlinkSync).toHaveBeenCalledWith(join(root, "native", ".credentials-smoke.lock"));
    for (const call of p.load.mock.calls) expect(String(call[0])).toContain("windows_credentials_test.node");
    for (const call of p.addon.write.mock.calls) expect(call[0].every(byte => byte === 0)).toBe(true);
    for (const result of p.addon.read.mock.results) if (Buffer.isBuffer(result.value?.value)) expect(result.value.value.every((byte: number) => byte === 0)).toBe(true);
  });
  it("verification child reads only the expected fixed fixture, zeros bytes and never writes/deletes", () => {
    const p = ports(); p.set("xray-non-secret-smoke-v1"); let returned: Buffer | undefined;
    p.addon.read.mockImplementation(() => { const value = Buffer.from("xray-non-secret-smoke-v1"); returned = value; return { code: "ok", value }; });
    credentialSmoke({ ...p.runtime, args: ["--verify-ascii"] }); expect(returned!.every(byte => byte === 0)).toBe(true); expect(p.addon.write).not.toHaveBeenCalled(); expect(p.addon.remove).not.toHaveBeenCalled(); expect(p.fs.openSync).not.toHaveBeenCalled();
    p.addon.read.mockImplementation(() => ({ code: "ok", value: Buffer.from("other-run") })); expect(() => credentialSmoke({ ...p.runtime, args: ["--verify-ascii"] })).toThrow(); expect(p.addon.remove).not.toHaveBeenCalled();
  });
  it("rejects production variant or pre-existing test value without altering/removing it", () => {
    const p = ports(); p.addon.variant = "production"; expect(() => credentialSmoke(p.runtime)).toThrow(); expect(p.addon.status).not.toHaveBeenCalled();
    p.addon.variant = "test"; p.set("other-run"); expect(() => credentialSmoke(p.runtime)).toThrow(); expect(p.addon.write).not.toHaveBeenCalled(); expect(p.addon.remove).not.toHaveBeenCalled();
  });
  it("child failure cleans its own value; a changed value is left intact", () => {
    const p = ports(); p.spawnSync.mockImplementation(() => ({ status: 1 })); expect(() => credentialSmoke(p.runtime)).toThrow(); expect(p.addon.remove).toHaveBeenCalledOnce();
    const q = ports(); q.spawnSync.mockImplementation(() => { q.set("other-run"); return { status: 1 }; }); expect(() => credentialSmoke(q.runtime)).toThrow(); expect(q.addon.remove).not.toHaveBeenCalled(); expect(q.fs.closeSync).toHaveBeenCalledOnce();
  });
  it("cleans a matching own value when write succeeds internally but creating its reply throws", () => {
    const p = ports(); const write = p.addon.write.getMockImplementation()!;
    p.addon.write.mockImplementation(bytes => { write(bytes); throw new Error("fixed injected reply failure"); });
    expect(() => credentialSmoke(p.runtime)).toThrow(); expect(p.addon.remove).toHaveBeenCalledOnce(); expect(p.fs.closeSync).toHaveBeenCalledOnce();
  });
  it("a pre-existing lock is not deleted and arbitrary smoke args never load a module", () => {
    const p = ports(); p.fs.openSync.mockImplementation(() => { throw new Error("lock exists"); }); expect(() => credentialSmoke(p.runtime)).toThrow(); expect(p.fs.unlinkSync).not.toHaveBeenCalled(); expect(p.addon.write).not.toHaveBeenCalled();
    const q = ports(); expect(() => credentialSmoke({ ...q.runtime, args: ["--target=production"] })).toThrow(); expect(q.load).not.toHaveBeenCalled();
  });
  it("Electron launcher resolves installed package metadata without importing its installer", async () => {
    const p = electronPorts(); await electronSmoke({ ...p.runtime, inElectron: false });
    expect(p.resolveModule).toHaveBeenCalledWith(join(root, "node_modules", "electron", "package.json")); expect(p.load).not.toHaveBeenCalled();
    expect(p.spawnSync.mock.calls[0]?.[0]).toBe(join(root, "node_modules", "electron", "dist", "electron.exe")); expect(p.spawnSync.mock.calls[0]?.[2]).toMatchObject({ timeout: 120000 }); expect(p.addon.read).not.toHaveBeenCalled();
    await expect(electronSmoke({ ...p.runtime, inElectron: false, args: ["--run"] })).rejects.toThrow();
  });
  it.each(["missing", "exe-escape", "dist-escape", "version-escape", "wrong-version", "not-file"])("fails %s installation before any process or package entry point", async kind => {
    const p = electronPorts();
    if (kind === "missing") p.fs.existsSync.mockReturnValue(false);
    if (kind.endsWith("escape")) p.fs.realpathSync.mockImplementation(path => (kind === "exe-escape" ? path.endsWith("electron.exe") : kind === "dist-escape" ? path.endsWith(`${sep}dist`) : path.endsWith(`${sep}version`)) ? resolve(root, "..", "outside") : path);
    if (kind === "wrong-version") p.fs.readFileSync.mockImplementation(path => path.endsWith("package.json") ? JSON.stringify({ name: "electron", version: "44.4.3" }) : "44.4.2");
    if (kind === "not-file") p.fs.statSync.mockReturnValue({ isFile: () => false });
    await expect(electronSmoke({ ...p.runtime, inElectron: false })).rejects.toThrow(); expect(p.spawnSync).not.toHaveBeenCalled(); expect(p.load).not.toHaveBeenCalled();
  });
  it.each(["--run", "--verify-ascii", "--verify-unicode", "--verify-boundary"])("waits for actual ready in the %s branch before touching the test target", async stage => {
    const p = electronPorts(); let ready: (() => void) | undefined; const pendingReady = new Promise<void>(resolve => { ready = resolve; });
    const credential = vi.fn(); const app = { whenReady: vi.fn(() => pendingReady) };
    const completion = electronSmoke({ ...p.runtime, inElectron: true, args: [stage], app, credentialSmoke: credential });
    expect(app.whenReady).toHaveBeenCalledOnce(); expect(credential).not.toHaveBeenCalled(); ready!(); await completion;
    expect(credential.mock.calls[0]?.[0].args).toEqual(stage === "--run" ? [] : [stage]);
    await expect(electronSmoke({ ...p.runtime, inElectron: true, args: ["--run", "--verify-ascii"], app, credentialSmoke: credential })).rejects.toThrow();
  });
  it("ready timeout exits through the process fallback and emits one fixed failure without native work", async () => {
    vi.useFakeTimers(); const p = electronPorts(); const app = { whenReady: vi.fn(() => new Promise<void>(() => undefined)), isReady: () => false, exit: vi.fn() };
    const exit = vi.fn(); const stderr = { write: vi.fn() }; const stdout = { write: vi.fn() }; const credential = vi.fn();
    const completion = runElectronSmoke({ ...p.runtime, inElectron: true, args: ["--run"], app, exit, stderr, stdout, credentialSmoke: credential });
    await vi.advanceTimersByTimeAsync(10000); await completion;
    expect(exit).toHaveBeenCalledWith(1); expect(app.exit).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled(); expect(stderr.write).toHaveBeenCalledExactlyOnceWith("CREDENTIAL_SMOKE_FAILED\n"); expect(stdout.write).not.toHaveBeenCalled();
  });
  it("rejects a different runtime version before ready/native work", async () => {
    const p = electronPorts(); const app = { whenReady: vi.fn(() => Promise.resolve()) }; const credential = vi.fn();
    await expect(electronSmoke({ ...p.runtime, inElectron: true, electronVersion: "44.4.2", args: ["--run"], app, credentialSmoke: credential })).rejects.toThrow();
    expect(app.whenReady).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled();
  });
  it("still exits after fixed output writing fails", async () => {
    const p = electronPorts(); const app = { whenReady: () => Promise.resolve(), isReady: () => true, exit: vi.fn() };
    await runElectronSmoke({ ...p.runtime, inElectron: true, args: ["--run"], app, credentialSmoke: () => undefined, stdout: { write() { throw new Error("private stream failure"); } } });
    expect(app.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("ready rejection and callback failure exit safely; successful ready exits once", async () => {
    for (const kind of ["ready", "callback", "success"]) {
      const p = electronPorts(); const app = { whenReady: vi.fn(() => kind === "ready" ? Promise.reject(new Error("private failure")) : Promise.resolve()), isReady: () => kind !== "ready", exit: vi.fn() };
      const exit = vi.fn(); const stderr = { write: vi.fn() }; const stdout = { write: vi.fn() }; const credential = vi.fn(() => { if (kind === "callback") throw new Error("private callback"); });
      await runElectronSmoke({ ...p.runtime, inElectron: true, args: ["--run"], app, exit, stderr, stdout, credentialSmoke: credential });
      if (kind === "ready") { expect(exit).toHaveBeenCalledWith(1); expect(credential).not.toHaveBeenCalled(); }
      else expect(app.exit).toHaveBeenCalledExactlyOnceWith(kind === "success" ? 0 : 1);
      expect(kind === "success" ? stdout.write : stderr.write).toHaveBeenCalledExactlyOnceWith(kind === "success" ? "CREDENTIAL_ELECTRON_SMOKE_OK\n" : "CREDENTIAL_SMOKE_FAILED\n");
    }
  });
  it("normalizes only the actual Electron entry path and keeps Node imports inert", () => {
    const p = ports(); const script = join(root, "scripts", "credentials-electron-smoke.cjs");
    expect(isElectronSmokeEntry({ ...p.runtime, inElectron: true, isMain: false, argv: ["electron", join(root, "scripts", "nested", "..", "credentials-electron-smoke.cjs")] })).toBe(true);
    expect(isElectronSmokeEntry({ ...p.runtime, inElectron: true, isMain: true, argv: ["electron", join(root, "other", "credentials-electron-smoke.cjs")] })).toBe(false);
    for (const entry of [undefined, "", "bad\0", join(root, "other-app.cjs")]) expect(isElectronSmokeEntry({ ...p.runtime, inElectron: true, argv: ["electron", entry] })).toBe(false);
    expect(isElectronSmokeEntry({ ...p.runtime, inElectron: false, isMain: false, argv: ["node", script] })).toBe(false);
    expect(isElectronSmokeEntry({ ...p.runtime, inElectron: false, isMain: true })).toBe(true);
    p.fs.realpathSync.mockImplementation(() => { throw new Error("inaccessible path"); }); expect(isElectronSmokeEntry({ ...p.runtime, inElectron: true, argv: ["electron", script] })).toBe(false);
  });
  it.each(["--run", "--verify-ascii", "--verify-unicode", "--verify-boundary", "electron-import", "node-import", "node-cli"])("executes the real top-level %s entry guard with a DefaultApp-shaped loader and no OS ports", async kind => {
    const p = electronPorts(); const script = join(root, "scripts", "credentials-electron-smoke.cjs");
    const source = readFileSync(script, "utf8"); const electron = !kind.startsWith("node-"); const direct = kind !== "electron-import" && kind !== "node-import";
    const moduleObject = { exports: {} }; let ready: (() => void) | undefined; let isReady = false;
    const app = { whenReady: vi.fn(() => new Promise<void>(resolve => { ready = () => { isReady = true; resolve(); }; })), isReady: () => isReady, exit: vi.fn() };
    const credential = vi.fn(); const output = { write: vi.fn() }; const errors = { write: vi.fn() };
    const processPort = { platform: "win32", versions: electron ? { electron: "44.4.3" } : {}, argv: ["runtime", direct ? script : join(root, "other-app.cjs"), ...(kind.startsWith("--") ? [kind] : [])], execPath: "runtime", stdout: output, stderr: errors, exit: vi.fn(), exitCode: undefined };
    const loader = Object.assign((name: string) => {
      if (name === "node:child_process") return { spawnSync: p.spawnSync };
      if (name === "node:fs") return p.fs;
      if (name === "node:path") return nodePath;
      if (name === "electron") return { app };
      if (name === "./credentials-smoke.cjs") return { credentialSmoke: credential };
      throw new Error("Unexpected test dependency");
    }, { main: !electron && kind === "node-cli" ? moduleObject : {}, resolve: p.resolveModule });
    runInNewContext(source, { require: loader, module: moduleObject, process: processPort, __filename: script, __dirname: join(root, "scripts"), setTimeout, clearTimeout });
    if (!direct) {
      expect(app.whenReady).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled(); expect(p.spawnSync).not.toHaveBeenCalled(); expect(output.write).not.toHaveBeenCalled(); expect(p.resolveModule).not.toHaveBeenCalled(); return;
    }
    if (!electron) { await vi.waitFor(() => expect(output.write).toHaveBeenCalledOnce()); expect(p.spawnSync).toHaveBeenCalledOnce(); expect(credential).not.toHaveBeenCalled(); expect(processPort.exitCode).toBe(0); return; }
    expect(loader.main).not.toBe(moduleObject); expect(app.whenReady).toHaveBeenCalledOnce(); expect(credential).not.toHaveBeenCalled();
    ready!(); await vi.waitFor(() => expect(app.exit).toHaveBeenCalledExactlyOnceWith(0)); expect(credential).toHaveBeenCalledOnce();
    expect(credential.mock.calls[0]?.[0].args).toEqual(kind === "--run" ? [] : [kind]); expect(errors.write).not.toHaveBeenCalled();
  });
  it("declares isolated NAPI8 targets and never adds build/copy/smoke to ordinary lifecycle scripts", () => {
    const gyp = JSON.parse(readFileSync(join(root, "native", "binding.gyp"), "utf8")); const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(gyp.targets.map((target: { target_name: string }) => target.target_name)).toEqual(["windows_credentials", "windows_credentials_test"]); expect(gyp.target_defaults.defines).toContain("NAPI_VERSION=8"); expect(pkg.devDependencies["node-gyp"]).toBe("12.4.0");
    expect(pkg.scripts.build).not.toContain("credentials"); expect(pkg.scripts.dev).not.toContain("credentials"); expect(pkg.scripts.pretest).toBeUndefined();
    expect(relative(root, join(root, "native", "build"))).not.toContain("..");
  });
});
