const { spawnSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const source = join(repoRoot, "packages", "analyzer-core", "native", "build", "Release", "secure_reader.node");
const targetDirectory = join(desktopRoot, "dist", "native");
const target = join(targetDirectory, "secure_reader.node");

const build = spawnSync(process.execPath, [join(repoRoot, "packages", "analyzer-core", "scripts", "build-native.cjs")], { cwd: repoRoot, stdio: "inherit", windowsHide: true });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(source)) throw new Error("analyzer-core build completed without producing secure_reader.node");

mkdirSync(targetDirectory, { recursive: true });
copyFileSync(source, target);
