const { _electron: electron } = require("playwright-core");
const electronPath = require("electron");
const { appendFile, cp, mkdir, mkdtemp, rm } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

async function launch(userData) {
  const app = await electron.launch({ executablePath: electronPath, args: [resolve(__dirname, "..")], env: { ...process.env, XRAY_E2E: "1", XRAY_E2E_USER_DATA: userData } });
  return { app, page: await app.firstWindow() };
}
async function importFixture(page, fixture) {
  await page.getByRole("textbox", { name: "测试项目路径" }).fill(fixture);
  await page.getByRole("button", { name: "导入测试项目" }).click();
  await page.getByText("不可变证据快照").waitFor({ timeout: 180_000 });
}
async function openOwnership(page) {
  await page.getByRole("button", { name: /所有权模式/ }).click();
  await page.getByRole("heading", { name: "选择学习范围", exact: true }).waitFor({ timeout: 30_000 });
}

async function main() {
  const base = await mkdtemp(join(tmpdir(), "xray-ownership-e2e-"));
  const fixture = join(base, "fixture"); const userData = join(base, "user-data"); const screenshots = resolve(__dirname, "../../../docs/screenshots");
  await cp(resolve(__dirname, "../../../test-fixtures/ownership-training"), fixture, { recursive: true }); await mkdir(userData); await mkdir(screenshots, { recursive: true });
  let firstSnapshot; let conceptLabel; let conceptName; let sourceFile; let selectedEvidence;
  let launched = await launch(userData);
  try {
    const { app, page } = launched; await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, width: 1600, height: 1000 }));
    await importFixture(page, fixture); firstSnapshot = await page.locator(".snapshot code").textContent();
    await page.getByRole("button", { name: /调用 \/ 数据流/ }).click(); await page.getByRole("textbox", { name: "搜索符号" }).fill("login"); await page.locator(".flow-controls").getByRole("button", { name: "搜索" }).click();
    const symbolSelect = page.getByRole("combobox", { name: "选择符号" }); const loginOption = symbolSelect.locator("option", { hasText: "pkg/api.py::login" }); await loginOption.waitFor({ state: "attached" }); const loginId = await loginOption.getAttribute("value"); assert.ok(loginId); await symbolSelect.selectOption(loginId); await page.getByRole("button", { name: "查询关系" }).click(); await page.locator(".relation-list button", { hasText: "CALLS" }).first().waitFor();
    const aliasEvidence = await page.evaluate(async (rootNodeId) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const graph = await window.xray.queryGraph({ version: "1.0.0", repositoryId: project.repositoryId, snapshotId: project.snapshotId, rootNodeIds: [rootNodeId], view: "call", direction: "outgoing", maxDepth: 3, maxNodes: 120, maxEdges: 240, maxWork: 3600, confidences: ["verified", "inferred", "unknown"] }); const edge = graph.edges.find((item) => item.source === rootNodeId && item.kind === "CALLS" && item.confidence === "verified" && item.reason.includes("import 本地绑定")); if (!edge) throw new Error("missing verified alias call"); const evidence = await window.xray.getEvidence({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, evidenceId: edge.evidenceId }); return { evidenceId: evidence.id, snapshotId: project.snapshotId, filePath: evidence.span.filePath, range: `${evidence.span.startLine}:${evidence.span.startColumn}-${evidence.span.endLine}:${evidence.span.endColumn}` }; }, loginId);
    await page.locator(".relation-list button", { hasText: "Python import 本地绑定" }).click(); const aliasViewer = page.getByTestId("source-viewer"); await page.waitForFunction((expected) => { const viewer = document.querySelector('[data-testid="source-viewer"]'); return viewer?.getAttribute("data-evidence-id") === expected.evidenceId && viewer.getAttribute("data-monaco-selection") === expected.range; }, aliasEvidence); assert.equal(await aliasViewer.getAttribute("data-source-file"), aliasEvidence.filePath); assert.equal(await aliasViewer.getAttribute("data-snapshot-id"), aliasEvidence.snapshotId);
    await openOwnership(page);
    await page.getByRole("button", { name: "生成结构化题目" }).click(); await page.locator(".quiz-progress b", { hasText: "调用方向" }).waitFor();
    conceptLabel = await page.locator(".difficulty").textContent(); conceptName = conceptLabel?.split(" · ").slice(1).join(" · ");
    const caller = page.getByRole("combobox", { name: "选择调用者" }); const callee = page.getByRole("combobox", { name: "选择被调用者" });
    const values = await caller.locator("option").evaluateAll((options) => options.slice(1).map((option) => ({ value: option.value, text: option.textContent ?? "" })));
    assert.equal(values.length, 2, "call direction must expose exactly the two structural choices");
    const nodes = await page.evaluate(async (ids) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const result = await window.xray.search({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, query: "", kinds: ["function", "method"], limit: 100 }); return result.items.filter((item) => ids.includes(item.id)); }, values.map((item) => item.value));
    sourceFile = nodes.find((node) => node.id === values[0].value)?.filePath; assert.ok(sourceFile, "caller source file missing");
    await page.getByRole("button", { name: sourceFile, exact: true }).click(); await page.locator(".monaco-editor").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "引用选中范围" }).click(); await page.getByText(/源码引用 [1-9]/).waitFor();
    await caller.selectOption(values[1].value); await callee.selectOption(values[0].value); await page.getByRole("button", { name: "提交并核验结构" }).click();
    await page.getByText("调用方向错误：调用者和被调用者不能互换。").waitFor(); assert.equal(await page.getByText("未评估", { exact: true }).count(), 1); await page.locator(".structured-grade").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshots, "ownership-structured-feedback.png") });
    await page.getByRole("button", { name: "修正后重试" }).click(); await caller.selectOption(values[0].value); await callee.selectOption(values[1].value); await page.getByRole("button", { name: "提交并核验结构" }).click(); await page.locator(".structured-grade").waitFor();
    assert.deepEqual(await page.locator(".structured-grade strong").allTextContents(), ["通过", "通过", "未评估"]);
    const evidenceButton = page.locator(".revealed button").first(); selectedEvidence = await evidenceButton.textContent(); assert.ok(selectedEvidence); await evidenceButton.click();
    const expected = await page.evaluate(async (evidenceId) => { const project = await window.xray.getCurrentProject(); if (!project) throw new Error("missing project"); const evidence = await window.xray.getEvidence({ repositoryId: project.repositoryId, snapshotId: project.snapshotId, evidenceId }); return { snapshotId: project.snapshotId, filePath: evidence.span.filePath, range: `${evidence.span.startLine}:${evidence.span.startColumn}-${evidence.span.endLine}:${evidence.span.endColumn}` }; }, selectedEvidence);
    const viewer = page.getByTestId("source-viewer"); await page.waitForFunction((range) => document.querySelector('[data-testid="source-viewer"]')?.getAttribute("data-monaco-selection") === range, expected.range);
    assert.equal(await viewer.getAttribute("data-snapshot-id"), expected.snapshotId); assert.equal(await viewer.getAttribute("data-source-file"), expected.filePath); assert.equal(await viewer.getAttribute("data-monaco-selection"), expected.range);
    await app.close();

    launched = await launch(userData); await openOwnership(launched.page); assert.ok(conceptName); const mastered = launched.page.locator(".mastery-panel div", { hasText: conceptName }); await mastered.waitFor({ timeout: 30_000 }); assert.match(await mastered.innerText(), /本快照已通过/);
    await appendFile(join(fixture, sourceFile), "\n# source changed after mastery\n", "utf8"); await launched.page.evaluate(() => window.dispatchEvent(new Event("focus"))); await launched.page.getByTestId("stale-banner").waitFor({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "更新索引" }).click(); await launched.page.getByText("不可变证据快照").waitFor({ timeout: 180_000 }); await openOwnership(launched.page);
    await launched.page.getByText("需要重新验证").waitFor({ timeout: 30_000 }); await launched.page.screenshot({ path: join(screenshots, "ownership-needs-revalidation.png") });
    const secondSnapshot = await launched.page.locator(".snapshot code").textContent(); assert.notEqual(secondSnapshot, firstSnapshot); assert.ok(conceptLabel?.includes("调用方向"));
    process.stdout.write(`ownership-training-e2e: passed ${JSON.stringify({ firstSnapshot, secondSnapshot, sourceFile, evidenceId: selectedEvidence, screenshots })}\n`);
  } finally {
    await launched.app.close().catch(() => undefined); await rm(base, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
