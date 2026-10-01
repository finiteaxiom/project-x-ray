const fs = require("node:fs");
const path = require("node:path");
const desktopRoot = path.resolve(__dirname, "..");
function inside(root, target) { const relative = path.relative(root, target); return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function copyCredentials(runtime = {}) {
  const io = runtime.fs ?? fs; const load = runtime.load ?? require;
  if ((runtime.platform ?? process.platform) !== "win32" || (runtime.args ?? process.argv.slice(2)).length !== 0) throw new Error("CREDENTIAL_TOOL_FAILED");
  const root = io.realpathSync(desktopRoot); const source = path.join(desktopRoot, "native", "build", "Release", "windows_credentials.node");
  const destination = path.join(desktopRoot, "dist", "native"); const target = path.join(destination, "windows_credentials.node");
  if (!inside(root, io.realpathSync(source))) throw new Error("CREDENTIAL_TOOL_FAILED");
  // Module initialization exports methods only; it performs no credential operation.
  if (load(source)?.variant !== "production") throw new Error("CREDENTIAL_TOOL_FAILED");
  const dist = path.dirname(destination);
  if (io.existsSync(dist) && !inside(root, io.realpathSync(dist))) throw new Error("CREDENTIAL_TOOL_FAILED");
  if (io.existsSync(destination) && !inside(root, io.realpathSync(destination))) throw new Error("CREDENTIAL_TOOL_FAILED");
  io.mkdirSync(destination, { recursive: true });
  if (!inside(root, io.realpathSync(destination)) || io.readdirSync(destination).some(name => /^windows_credentials.*test.*\.node$/i.test(name)) || (io.existsSync(target) && !inside(root, io.realpathSync(target)))) throw new Error("CREDENTIAL_TOOL_FAILED");
  io.copyFileSync(source, target);
}
module.exports = { copyCredentials };
if (require.main === module) { try { copyCredentials(); process.stdout.write("CREDENTIAL_COPY_OK\n"); } catch { process.stderr.write("CREDENTIAL_TOOL_FAILED\n"); process.exitCode = 1; } }
