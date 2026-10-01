const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const desktopRoot = path.resolve(__dirname, "..");
function inside(root, target) { const relative = path.relative(root, target); return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function buildCredentials(runtime = {}) {
  const io = runtime.fs ?? fs; const spawn = runtime.spawnSync ?? spawnSync; const resolveModule = runtime.resolveModule ?? require.resolve;
  if ((runtime.platform ?? process.platform) !== "win32" || (runtime.args ?? process.argv.slice(2)).length !== 0) throw new Error("CREDENTIAL_TOOL_FAILED");
  const root = io.realpathSync(desktopRoot); const native = path.join(desktopRoot, "native"); const build = path.join(native, "build");
  if (!inside(root, io.realpathSync(native)) || (io.existsSync(build) && !inside(io.realpathSync(native), io.realpathSync(build)))) throw new Error("CREDENTIAL_TOOL_FAILED");
  // Resolve only desktop's explicitly declared tool, not another workspace's private node_modules.
  const tool = resolveModule("node-gyp/bin/node-gyp.js");
  const result = spawn(process.execPath, [tool, "rebuild", "--directory", native], { cwd: desktopRoot, windowsHide: true, stdio: "pipe", timeout: 300000 });
  if (result.error || result.status !== 0) throw new Error("CREDENTIAL_TOOL_FAILED");
  for (const name of ["windows_credentials.node", "windows_credentials_test.node"]) if (!io.existsSync(path.join(build, "Release", name))) throw new Error("CREDENTIAL_TOOL_FAILED");
}
module.exports = { buildCredentials };
if (require.main === module) { try { buildCredentials(); process.stdout.write("CREDENTIAL_BUILD_OK\n"); } catch { process.stderr.write("CREDENTIAL_TOOL_FAILED\n"); process.exitCode = 1; } }
