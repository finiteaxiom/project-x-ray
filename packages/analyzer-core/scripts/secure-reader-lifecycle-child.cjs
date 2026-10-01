const assert = require("node:assert/strict");
const { pbkdf2 } = require("node:crypto");
const { mkdtemp, mkdir, readFile, rename, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const addon = require(join(__dirname, "..", "native", "build", "Release", "secure_reader.node"));
const source = "export const queued_lifecycle_marker = 'kept';\n";

function occupyWorkerPool() {
  return Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    pbkdf2("a", "b", 1_500_000, 32, "sha256", (error) => error ? reject(error) : resolve());
  }));
}

async function collectWhileQueued() {
  if (typeof global.gc !== "function") throw new Error("child process must run with --expose-gc");
  global.gc();
  await new Promise((resolve) => setImmediate(resolve));
  global.gc();
  await new Promise((resolve) => setImmediate(resolve));
  global.gc();
}

function expectCloseConflict(operation) {
  assert.throws(operation, (error) => error && error.code === "ERR_SECURE_READ");
}

async function main() {
  const base = await mkdtemp(join(tmpdir(), "xray-native-lifecycle-"));
  const root = join(base, "repo");
  const outside = join(base, "outside.ts");
  const target = join(root, "entry.ts");
  const moved = join(base, "entry.moved.ts");
  await mkdir(root);
  await writeFile(target, source, "utf8");
  await writeFile(outside, "outside", "utf8");

  try {
    const openBlockers = occupyWorkerPool();
    let openScope = addon.createScope(root).nativeScope;
    const openPromise = addon.openFile(openScope, "entry.ts");
    openPromise.catch(() => {});
    expectCloseConflict(() => addon.closeScope(openScope));
    openScope = null;
    await collectWhileQueued();
    await Promise.all(openBlockers);
    const openedFile = await openPromise;
    const readScope = addon.createScope(root).nativeScope;
    const openedBytes = await addon.readFileChunk(readScope, openedFile, 4096);
    assert.equal(openedBytes.toString("utf8"), source);
    addon.closeFile(openedFile);
    addon.closeScope(readScope);

    let readScopeForGc = addon.createScope(root).nativeScope;
    let fileForGc = await addon.openFile(readScopeForGc, "entry.ts");
    const readBlockers = occupyWorkerPool();
    const readPromise = addon.readFileChunk(readScopeForGc, fileForGc, 4096);
    readPromise.catch(() => {});
    expectCloseConflict(() => addon.closeScope(readScopeForGc));
    expectCloseConflict(() => addon.closeFile(fileForGc));
    readScopeForGc = null;
    fileForGc = null;
    await collectWhileQueued();
    await Promise.all(readBlockers);
    assert.equal((await readPromise).toString("utf8"), source);

    const failedOpenScope = addon.createScope(root).nativeScope;
    const failedOpenBlockers = occupyWorkerPool();
    const failedOpen = addon.openFile(failedOpenScope, "missing.ts");
    failedOpen.catch(() => {});
    expectCloseConflict(() => addon.closeScope(failedOpenScope));
    await collectWhileQueued();
    await Promise.all(failedOpenBlockers);
    await assert.rejects(failedOpen, (error) => error && error.code === "ERR_SECURE_READ");
    addon.closeScope(failedOpenScope);

    const failedReadScope = addon.createScope(root).nativeScope;
    const failedReadFile = await addon.openFile(failedReadScope, "entry.ts");
    await rename(target, moved);
    const failedRead = addon.readFileChunk(failedReadScope, failedReadFile, 4096);
    failedRead.catch(() => {});
    await assert.rejects(failedRead, (error) => error && error.code === "ERR_PROJECT_PATH_SECURITY");
    await rename(moved, target);
    addon.closeFile(failedReadFile);
    addon.closeScope(failedReadScope);

    assert.equal(await readFile(target, "utf8"), source);
    process.stdout.write("secure-reader-lifecycle-ok\n");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
