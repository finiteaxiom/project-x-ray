const { spawnSync } = require("node:child_process");
const { existsSync, statSync } = require("node:fs");
const { join } = require("node:path");

const packageRoot = join(__dirname, "..");
const nativeRoot = join(packageRoot, "native");
const output = join(nativeRoot, "build", "Release", "secure_reader.node");
const inputs = [join(nativeRoot, "binding.gyp"), join(nativeRoot, "secure_reader.cc")];
const current = existsSync(output) && inputs.every((input) => existsSync(input) && statSync(output).mtimeMs >= statSync(input).mtimeMs);

if (!current) {
  const nodeGyp = require.resolve("node-gyp/bin/node-gyp.js");
  const result = spawnSync(process.execPath, [nodeGyp, "rebuild", `--directory=${nativeRoot}`], { cwd: packageRoot, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync(output)) throw new Error("node-gyp completed without producing secure_reader.node");
