const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

async function main() {
  const base = await mkdtemp(join(tmpdir(), "xray-file-source-e2e-"));
  const fixture = join(base, "fixture"); const sourceDir = join(fixture, "src"); const userData = join(base, "user-data");
  await mkdir(join(sourceDir, ".hidden"), { recursive: true }); await mkdir(join(fixture, "dist")); await mkdir(join(fixture, "node_modules", "sample"), { recursive: true }); await mkdir(userData);
  const files = new Map([
    ["src/single.ts", "export const value = '😀';"],
    ["src/multi.ts", "export const first = 1;\nexport const last = '😀';"],
    ["src/empty.ts", ""],
    ["src/.hidden/entry.ts", "export const hiddenEntry = true;"],
    ["src/.hidden/.env.local", "SECRET=not-indexed"],
    ["dist/generated.ts", "export const generated = true;"],
    ["node_modules/sample/dependency.ts", "export const dependency = true;"],
  ]);
  for (const [filePath, content] of files) { const fullPath = join(fixture, ...filePath.split("/")); await mkdir(resolve(fullPath, ".."), { recursive: true }); await writeFile(fullPath, content, "utf8"); }

  let app;
  try {
    app = await electron.launch({ executablePath: electronPath, args: [resolve(__dirname, "..")], env: { ...process.env, XRAY_E2E: "1", XRAY_E2E_USER_DATA: userData } });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => process.stderr.write(`[renderer-error] ${error.message}\n`));
    await page.getByRole("textbox", { name: "测试项目路径" }).fill(fixture);
    await page.getByRole("button", { name: "导入测试项目" }).click();
    await page.getByText("不可变证据快照").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: /架构地图/ }).click();
    await page.getByRole("button", { name: "列表", exact: true }).click();

    const fileCounts = await page.evaluate(async () => {
      const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing indexed snapshot");
      const paths = ["src/.hidden/entry.ts", "src/.hidden/.env.local", "dist/generated.ts", "node_modules/sample/dependency.ts"];
      const counts = {};
      for (const filePath of paths) {
        const result = await window.xray.search({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, query: "", kinds: ["file"], filePath, limit: 5 });
        counts[filePath] = result.items.filter((item) => item.kind === "file" && item.filePath === filePath).length;
      }
      return counts;
    });
    assert.equal(fileCounts["src/.hidden/entry.ts"], 1, "the hidden source file must be indexed and queryable");
    for (const excluded of ["src/.hidden/.env.local", "dist/generated.ts", "node_modules/sample/dependency.ts"]) assert.equal(fileCounts[excluded], 0, `excluded file must not be indexed: ${excluded}`);

    const moduleCard = page.locator(".module-card").filter({ has: page.locator('.module-card-main[title="src"]') });
    await moduleCard.locator(".module-open").click(); await page.getByTestId("architecture-module").waitFor();
    const results = [];
    for (const filePath of ["src/single.ts", "src/multi.ts", "src/empty.ts"]) {
      const content = files.get(filePath); assert.notEqual(content, undefined);
      const lines = content.split(/\r?\n/); const expectedRange = `1:0-${lines.length}:${lines.at(-1).length}`;
      const fileCard = page.locator(".file-card-list article").filter({ has: page.locator(`.file-select[title="${filePath}"]`) });
      await fileCard.locator(".file-open").click(); await page.getByTestId("architecture-file").waitFor();
      await page.getByRole("button", { name: "打开文件源码" }).click();
      const viewer = page.getByTestId("source-viewer");
      await page.waitForFunction(({ filePath: expectedFile, range }) => { const element = document.querySelector('[data-testid="source-viewer"]'); return element?.getAttribute("data-source-file") === expectedFile && element.getAttribute("data-monaco-selection") === range; }, { filePath, range: expectedRange }, { timeout: 30_000 });
      await page.locator(".monaco-editor").waitFor({ timeout: 30_000 });
      assert.equal(await viewer.getAttribute("data-source-file"), filePath);
      assert.equal(await viewer.getAttribute("data-monaco-selection"), expectedRange);
      const evidenceId = await viewer.getAttribute("data-evidence-id"); assert.ok(evidenceId, "file navigation must retain its file evidence");
      const read = await page.evaluate(async ({ filePath, evidenceId }) => {
        const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing indexed snapshot");
        const found = await window.xray.search({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, query: "", kinds: ["file"], filePath, limit: 5 });
        const node = found.items.find((item) => item.kind === "file" && item.filePath === filePath); if (!node?.span) throw new Error(`missing file node: ${filePath}`);
        const source = await window.xray.readSource({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, ...node.span, evidenceId });
        return { span: node.span, source: source.content, sourceEvidence: source.evidence?.id };
      }, { filePath, evidenceId });
      assert.equal(read.source, content, `source navigation must display the indexed content for ${filePath}`);
      assert.equal(read.sourceEvidence, evidenceId);
      assert.equal(`${read.span.startLine}:${read.span.startColumn}-${read.span.endLine}:${read.span.endColumn}`, expectedRange);
      results.push({ filePath, range: expectedRange, bytes: Buffer.byteLength(read.source) });
      if (filePath !== "src/empty.ts") await page.locator(".architecture-breadcrumbs").getByRole("button", { name: "src", exact: true }).click();
    }
    process.stdout.write(`file-source-e2e: passed ${JSON.stringify({ files: results, indexedHiddenSource: true, excludedFiles: ["src/.hidden/.env.local", "dist/generated.ts", "node_modules/sample/dependency.ts"], snapshotId: await page.getByTestId("source-viewer").getAttribute("data-snapshot-id") })}\n`);
  } finally {
    if (app) await app.close();
    await rm(base, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
