const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
function localElectron(runtime = {}) {
  const io = runtime.fs ?? fs;
  // Resolving package metadata never executes electron/index.js (which may run its installer).
  const declaredMetadata = path.join(__dirname, "..", "node_modules", "electron", "package.json");
  const metadataPath = io.realpathSync((runtime.resolveModule ?? require.resolve)(declaredMetadata));
  const metadata = JSON.parse(io.readFileSync(metadataPath, "utf8"));
  if (metadata.name !== "electron" || !/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error("CREDENTIAL_SMOKE_FAILED");
  const root = path.dirname(metadataPath); const dist = path.join(root, "dist");
  const executable = path.join(dist, "electron.exe"); const versionFile = path.join(dist, "version");
  if (!io.existsSync(executable) || !io.existsSync(versionFile) || io.realpathSync(dist) !== dist || path.relative(dist, io.realpathSync(executable)).toLowerCase() !== "electron.exe" || path.relative(dist, io.realpathSync(versionFile)).toLowerCase() !== "version" || !io.statSync(executable).isFile() || io.readFileSync(versionFile, "utf8").trim() !== metadata.version) throw new Error("CREDENTIAL_SMOKE_FAILED");
  return { executable, version: metadata.version };
}
async function electronSmoke(runtime = {}) {
  const args = runtime.args ?? process.argv.slice(2);
  if ((runtime.platform ?? process.platform) !== "win32") throw new Error("CREDENTIAL_SMOKE_FAILED");
  if (runtime.inElectron ?? Boolean(process.versions.electron)) {
    if (args.length !== 1 || (args[0] !== "--run" && !/^--verify-(ascii|unicode|boundary)$/.test(args[0] ?? ""))) throw new Error("CREDENTIAL_SMOKE_FAILED");
    const installed = localElectron(runtime);
    if ((runtime.electronVersion ?? process.versions.electron) !== installed.version) throw new Error("CREDENTIAL_SMOKE_FAILED");
    const app = runtime.app ?? require("electron").app; // In an Electron process this is its built-in module, not npm's installer.
    let timer;
    try {
      await Promise.race([app.whenReady(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("CREDENTIAL_SMOKE_FAILED")), 10000); })]);
    } finally { clearTimeout(timer); }
    (runtime.credentialSmoke ?? require("./credentials-smoke.cjs").credentialSmoke)({ args: args[0] === "--run" ? args.slice(1) : args, execPath: process.execPath, childScript: __filename });
    return;
  }
  if (args.length !== 0) throw new Error("CREDENTIAL_SMOKE_FAILED");
  const { executable } = localElectron(runtime);
  const result = (runtime.spawnSync ?? spawnSync)(executable, [__filename, "--run"], { windowsHide: true, stdio: "pipe", timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error("CREDENTIAL_SMOKE_FAILED");
}
async function runElectronSmoke(runtime = {}) {
  let code = 0;
  try { await electronSmoke(runtime); } catch { code = 1; }
  try { (code === 0 ? runtime.stdout ?? process.stdout : runtime.stderr ?? process.stderr).write(code === 0 ? "CREDENTIAL_ELECTRON_SMOKE_OK\n" : "CREDENTIAL_SMOKE_FAILED\n"); } catch { code = 1; }
  if (runtime.inElectron ?? Boolean(process.versions.electron)) {
    try {
      const app = runtime.app ?? require("electron").app;
      if (app.isReady()) app.exit(code); else (runtime.exit ?? process.exit)(code);
    } catch { (runtime.exit ?? process.exit)(1); }
  } else process.exitCode = code;
}
function isElectronSmokeEntry(runtime = {}) {
  if (!(runtime.inElectron ?? Boolean(process.versions.electron))) return runtime.isMain ?? require.main === module;
  // DefaultApp need not make this CommonJS module require.main. Imports by other apps still must be inert.
  const entry = (runtime.argv ?? process.argv)[1];
  if (typeof entry !== "string" || entry.length === 0 || /[\u0000-\u001f\u007f]/.test(entry)) return false;
  try {
    const io = runtime.fs ?? fs;
    const canonical = value => {
      const resolved = path.normalize(io.realpathSync(path.resolve(value)));
      return (runtime.platform ?? process.platform) === "win32" ? resolved.toLowerCase() : resolved;
    };
    return canonical(entry) === canonical(__filename);
  } catch { return false; }
}
module.exports = { electronSmoke, runElectronSmoke, isElectronSmokeEntry };
if (isElectronSmokeEntry()) void runElectronSmoke();
