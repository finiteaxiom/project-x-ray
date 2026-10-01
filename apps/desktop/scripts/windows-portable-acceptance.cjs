const { createHash } = require("node:crypto");
const { createReadStream, existsSync, mkdtempSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { basename, dirname, join, relative, resolve, sep } = require("node:path");
const { finished } = require("node:stream/promises");
const { tmpdir } = require("node:os");

const repoRoot = resolve(__dirname, "../../..");
const rootPackagePath = join(repoRoot, "package.json");
const desktopPackagePath = join(repoRoot, "apps", "desktop", "package.json");
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), result: "running", checks: [] };

function record(name, detail = {}) {
  report.checks.push({ name, status: "passed", ...detail });
}

function requireCheck(condition, name, detail = {}) {
  if (!condition) {
    const error = new Error(name);
    error.code = "PORTABLE_ACCEPTANCE_FAILED";
    error.checkName = name;
    throw error;
  }
  record(name, detail);
}

function parseArgs(argv) {
  const options = { preflight: false, appDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    else if (value === "--preflight") options.preflight = true;
    else if (value === "--app-dir" && argv[index + 1]) options.appDir = resolve(argv[++index]);
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error("Use --preflight or --app-dir <win-unpacked-directory>.");
  }
  if (options.preflight && options.appDir) throw new Error("Choose --preflight or --app-dir.");
  return options;
}

function validateConfiguration() {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const desktopPackage = JSON.parse(readFileSync(desktopPackagePath, "utf8"));
  const builder = rootPackage.build ?? {};
  const workerSource = "apps/desktop/dist/python-analyze.py";
  requireCheck(builder.asar === true, "asar-enabled");
  requireCheck(Array.isArray(builder.files) && builder.files.includes(`!${workerSource}`), "python-worker-excluded-from-asar");
  requireCheck(Array.isArray(builder.extraResources) && builder.extraResources.some((item) => item.from === workerSource && item.to === "python-analyze.py"), "python-worker-copied-to-resources");
  requireCheck(Array.isArray(builder.asarUnpack) && builder.asarUnpack.includes("**/*.node"), "native-addons-unpacked");
  requireCheck(typeof desktopPackage.scripts?.build === "string" && desktopPackage.scripts.build.includes("copy-python-worker.cjs") && desktopPackage.scripts.build.includes("copy-secure-reader.cjs"), "desktop-build-produces-workers-and-native-reader");
  requireCheck(typeof rootPackage.scripts?.["verify:win-portable"] === "string", "acceptance-script-is-registered");
  return { rootPackage, builder };
}

function asarLibrary() {
  const builderRequire = createRequire(require.resolve("electron-builder", { paths: [repoRoot] }));
  const appBuilderEntry = builderRequire.resolve("app-builder-lib");
  const appBuilderRequire = createRequire(appBuilderEntry);
  const asar = appBuilderRequire("@electron/asar");
  requireCheck(typeof asar.listPackage === "function", "asar-inspection-api-available");
  return asar;
}

function normalizedArchiveEntries(rawEntries) {
  return rawEntries.map((entry) => {
    const value = typeof entry === "string" ? entry : entry?.path ?? entry?.name;
    return String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  }).filter(Boolean);
}

function listArchiveEntries(asar, archivePath) {
  return normalizedArchiveEntries(asar.listPackage(archivePath));
}

async function verifyAsarListPackagePaths(asar) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "xray-asar-path-regression-"));
  const temporaryRootPath = resolve(temporaryRoot);
  const temporaryBasePath = resolve(tmpdir());
  const relativeToTemporaryBase = relative(temporaryBasePath, temporaryRootPath);
  if (!relativeToTemporaryBase || relativeToTemporaryBase === ".." || relativeToTemporaryBase.startsWith(`..${sep}`)) throw new Error("Temporary ASAR regression directory escaped the temporary root.");
  try {
    const sourceRoot = join(temporaryRootPath, "source");
    const mainRelativePath = join("apps", "desktop", "dist", "main.js");
    mkdirSync(join(sourceRoot, dirname(mainRelativePath)), { recursive: true });
    writeFileSync(join(sourceRoot, mainRelativePath), "module.exports = 'packaged-entry';\n", "utf8");
    const archivePath = join(temporaryRootPath, "fixture.asar");
    await finished(await asar.createPackage(sourceRoot, archivePath));

    const entries = listArchiveEntries(asar, archivePath);
    const entrySet = new Set(entries);
    requireCheck(entrySet.has("apps/desktop/dist/main.js"), "asar-micro-regression-normalizes-and-finds-entry");
    requireCheck(!entrySet.has("apps/desktop/dist/python-analyze.py"), "asar-micro-regression-confirms-worker-absent");
  } finally {
    const finalTargetPath = resolve(temporaryRootPath);
    const relativeToTemporaryBaseAfterResolve = relative(temporaryBasePath, finalTargetPath);
    if (!relativeToTemporaryBaseAfterResolve || relativeToTemporaryBaseAfterResolve === ".." || relativeToTemporaryBaseAfterResolve.startsWith(`..${sep}`)) throw new Error("Refusing to remove a directory outside the temporary root.");
    asar.uncacheAll?.();
    rmSync(finalTargetPath, { recursive: true, force: true });
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function peMachine(filePath) {
  const fd = openSync(filePath, "r");
  try {
    const dos = Buffer.alloc(64);
    if (readSync(fd, dos, 0, dos.length, 0) < dos.length || dos.toString("ascii", 0, 2) !== "MZ") return null;
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    if (readSync(fd, header, 0, header.length, peOffset) < header.length || header.toString("ascii", 0, 4) !== "PE\0\0") return null;
    const machine = header.readUInt16LE(4);
    return machine === 0x8664 ? "x64" : machine === 0x014c ? "x86" : `0x${machine.toString(16)}`;
  } finally {
    closeSync(fd);
  }
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function writeManifest(reportPath) {
  report.result = report.failure ? "failed" : "passed";
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function verifyAppDirectory(appDir, rootPackage, asar) {
  const resourcesDir = join(appDir, "resources");
  const archivePath = join(resourcesDir, "app.asar");
  const unpackedDir = join(resourcesDir, "app.asar.unpacked");
  const workerPath = join(resourcesDir, "python-analyze.py");
  const appExePath = join(appDir, "Project X-Ray.exe");
  const portableExePath = join(dirname(appDir), `Project-X-Ray-${rootPackage.version}-portable.exe`);
  const manifestPath = join(dirname(appDir), `Project-X-Ray-${rootPackage.version}-portable.acceptance.json`);

  try {
    requireCheck(statSync(appDir).isDirectory(), "win-unpacked-directory-present", { directoryName: basename(appDir) });
    requireCheck(existsSync(appExePath), "windows-application-executable-present", { fileName: basename(appExePath) });
    const appMachine = peMachine(appExePath);
    requireCheck(appMachine === "x64", "windows-application-executable-is-x64", { machine: appMachine });
    requireCheck(existsSync(portableExePath), "portable-executable-present", { fileName: basename(portableExePath) });
    const portableMachine = peMachine(portableExePath);
    requireCheck(portableMachine !== null, "portable-executable-is-valid-pe", { machine: portableMachine });
    requireCheck(existsSync(archivePath), "app-asar-present", { archiveName: "resources/app.asar" });

    const entries = listArchiveEntries(asar, archivePath);
    const entrySet = new Set(entries);
    requireCheck(entrySet.has("apps/desktop/dist/main.js"), "packaged-main-entry-present");
    requireCheck(entrySet.has("apps/desktop/dist/analysis-worker.js"), "packaged-analysis-worker-present");
    requireCheck(entrySet.has("apps/ui/dist/index.html"), "packaged-ui-present");
    requireCheck(!entrySet.has("apps/desktop/dist/python-analyze.py"), "python-worker-absent-from-asar");
    requireCheck(existsSync(workerPath) && statSync(workerPath).isFile(), "python-worker-is-a-physical-resource", { resourcePath: "resources/python-analyze.py" });
    const sourceWorkerPath = join(repoRoot, "packages", "analyzer-python", "python", "analyze.py");
    const [sourceWorkerHash, resourceWorkerHash] = await Promise.all([hashFile(sourceWorkerPath), hashFile(workerPath)]);
    requireCheck(sourceWorkerHash === resourceWorkerHash, "python-resource-matches-source", { sha256: resourceWorkerHash });

    const secureReaderArchivePath = "apps/desktop/dist/native/secure_reader.node";
    const secureReaderUnpackedPath = join(unpackedDir, ...secureReaderArchivePath.split("/"));
    requireCheck(existsSync(secureReaderUnpackedPath), "secure-reader-is-unpacked", { archivePath: secureReaderArchivePath });
    const secureReaderMachine = peMachine(secureReaderUnpackedPath);
    requireCheck(secureReaderMachine === "x64", "secure-reader-is-x64", { machine: secureReaderMachine });

    const sqlitePhysicalPaths = walkFiles(unpackedDir)
      .filter((filePath) => {
        const unpackedPath = relative(unpackedDir, filePath).split(sep).join("/");
        return /(^|\/)better-sqlite3\/prebuilds\/win32-x64\.node$/i.test(unpackedPath)
          || /(^|\/)better-sqlite3\/build\/release\/better_sqlite3\.node$/i.test(unpackedPath);
      })
      .map((filePath) => ({ unpackedPath: relative(unpackedDir, filePath).split(sep).join("/"), filePath }));
    requireCheck(sqlitePhysicalPaths.length > 0, "sqlite-addon-is-unpacked", { unpackedPath: sqlitePhysicalPaths[0]?.unpackedPath });
    const sqliteMachine = peMachine(sqlitePhysicalPaths[0].filePath);
    requireCheck(sqliteMachine === "x64", "sqlite-addon-is-x64", { machine: sqliteMachine });

    report.application = {
      version: rootPackage.version,
      electronVersion: rootPackage.build?.electronVersion,
      directoryName: basename(appDir),
      portableExecutable: { fileName: basename(portableExePath), machine: portableMachine, bytes: statSync(portableExePath).size, sha256: await hashFile(portableExePath) },
      executable: { fileName: basename(appExePath), machine: appMachine, bytes: statSync(appExePath).size, sha256: await hashFile(appExePath) },
      archive: { fileName: "resources/app.asar", bytes: statSync(archivePath).size, sha256: await hashFile(archivePath) },
      pythonWorker: { path: "resources/python-analyze.py", bytes: statSync(workerPath).size, sha256: resourceWorkerHash },
      secureReader: { archivePath: secureReaderArchivePath, machine: secureReaderMachine },
      sqliteAddon: { unpackedPath: sqlitePhysicalPaths[0].unpackedPath, machine: sqliteMachine },
    };
    writeManifest(manifestPath);
    process.stdout.write(`windows-portable-acceptance: ${report.checks.length} structural checks passed; manifest ${basename(manifestPath)}\n`);
  } catch (error) {
    report.failure = { checkName: error.checkName ?? "unexpected-error", code: error.code ?? "PORTABLE_ACCEPTANCE_FAILED" };
    writeManifest(manifestPath);
    process.stderr.write(`windows-portable-acceptance: failed at ${report.failure.checkName} (${report.failure.code})\n`);
    process.exitCode = 1;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node apps/desktop/scripts/windows-portable-acceptance.cjs [--preflight | --app-dir <win-unpacked-directory>]\n");
    return;
  }
  const { rootPackage } = validateConfiguration();
  const asar = asarLibrary();
  await verifyAsarListPackagePaths(asar);
  if (options.preflight) {
    process.stdout.write(`windows-portable-acceptance: ${report.checks.length} preflight checks passed\n`);
    return;
  }
  const appDir = options.appDir ?? join(repoRoot, "dist", "win-unpacked");
  await verifyAppDirectory(appDir, rootPackage, asar);
}

main().catch((error) => {
  const checkName = error.checkName ?? "preflight";
  const code = error.code ?? "PORTABLE_ACCEPTANCE_FAILED";
  process.stderr.write(`windows-portable-acceptance: failed at ${checkName} (${code})\n`);
  process.exitCode = 1;
});
