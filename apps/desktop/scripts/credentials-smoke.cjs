const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const desktopRoot = path.resolve(__dirname, "..");
const addonPath = path.join(desktopRoot, "native", "build", "Release", "windows_credentials_test.node");
const values = Object.freeze({ ascii: "xray-non-secret-smoke-v1", unicode: "xray-测试-🙂-v1", boundary: "x".repeat(2048) });
function fail() { throw new Error("CREDENTIAL_SMOKE_FAILED"); }
function readMatches(addon, expected) {
  let value; const expectedBytes = Buffer.from(expected, "utf8");
  try { const result = addon.read(); value = result?.value; return result?.code === "ok" && Buffer.isBuffer(value) && value.equals(expectedBytes); }
  finally { expectedBytes.fill(0); if (Buffer.isBuffer(value)) value.fill(0); }
}
function loadTest(runtime) {
  const io = runtime.fs ?? fs; const root = io.realpathSync(desktopRoot); const actual = io.realpathSync(addonPath); const relative = path.relative(root, actual);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail();
  const addon = (runtime.load ?? require)(addonPath);
  if (addon?.variant !== "test" || [addon.status, addon.read, addon.write, addon.remove].some(method => typeof method !== "function")) fail();
  return addon;
}
function credentialSmoke(runtime = {}) {
  const args = runtime.args ?? process.argv.slice(2); if ((runtime.platform ?? process.platform) !== "win32") fail();
  if (args.length > 1 || (args.length === 1 && !/^--verify-(ascii|unicode|boundary)$/.test(args[0]))) fail();
  const addon = loadTest(runtime);
  if (args.length === 1) { const kind = args[0].slice("--verify-".length); if (!readMatches(addon, values[kind])) fail(); return; }
  const io = runtime.fs ?? fs; const lock = path.join(desktopRoot, "native", ".credentials-smoke.lock"); let fd; let owned = null;
  try {
    // Both Node and Electron tools serialize their own fixed test target. Never remove a pre-existing lock.
    fd = io.openSync(lock, "wx"); if (addon.status()?.code !== "missing") fail();
    for (const [kind, expected] of Object.entries(values)) {
      const bytes = Buffer.from(expected, "utf8");
      // OS write may succeed before creating its JS reply fails. Cleanup still requires an exact read match.
      owned = expected;
      try { if (addon.write(bytes)?.code !== "ok") fail(); } finally { bytes.fill(0); }
      if (addon.status()?.code !== "ok" || !readMatches(addon, expected)) fail();
      const child = (runtime.spawnSync ?? spawnSync)(runtime.execPath ?? process.execPath, [runtime.childScript ?? __filename, `--verify-${kind}`], { cwd: desktopRoot, windowsHide: true, stdio: "pipe", timeout: 30000 });
      if (child.error || child.status !== 0) fail();
    }
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(2049, 120), Buffer.from("中".repeat(683)), Buffer.from("a\n"), Buffer.from("a\0"), Buffer.from("a b"), Buffer.from([0xff]), Buffer.from([0xed, 0xa0, 0x80])]) {
      try { if (addon.write(bytes)?.code !== "invalid") fail(); } finally { bytes.fill(0); }
    }
    if (!readMatches(addon, owned)) fail();
    if (addon.remove()?.code !== "ok") fail(); owned = null;
    if (addon.status()?.code !== "missing" || addon.read()?.code !== "missing" || !["missing", "ok"].includes(addon.remove()?.code)) fail();
  } finally {
    // A changed/unknown value is never deleted. Fail instead of cleaning another run's credential.
    try { if (owned !== null) { if (!readMatches(addon, owned) || addon.remove()?.code !== "ok") fail(); } }
    finally { if (fd !== undefined) { io.closeSync(fd); io.unlinkSync(lock); } }
  }
}
module.exports = { credentialSmoke };
if (require.main === module) { try { credentialSmoke(); process.stdout.write("CREDENTIAL_SMOKE_OK\n"); } catch { process.stderr.write("CREDENTIAL_SMOKE_FAILED\n"); process.exitCode = 1; } }
