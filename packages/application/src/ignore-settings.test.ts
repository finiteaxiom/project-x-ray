import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const Database = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => { prepare(sql: string): { run(...values: unknown[]): unknown; get(...values: unknown[]): unknown }; close(): void };
import { XRayApplication } from "./index.js";
import { captureComparison } from "@project-xray/git";
import { createIgnorePolicy } from "@project-xray/analyzer-core";
import { GraphStore } from "@project-xray/graph";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(git = false) {
  const base = await mkdtemp(join(tmpdir(), "xray-ignore-")); roots.push(base); const root = join(base, "project");
  await mkdir(join(root, "generated"), { recursive: true }); await mkdir(join(root, ".hidden")); await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "a.ts"), "export function caller() { return target() }\nexport function target() { return 1 }\n");
  await writeFile(join(root, "generated", "b.ts"), "export const generated = 1\n");
  await writeFile(join(root, ".hidden", "c.ts"), "export const hidden = 1\n");
  await writeFile(join(root, "node_modules", "bad.ts"), "export const bad = 1\n"); await writeFile(join(root, ".env"), "DO_NOT_READ=private\n");
  const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  if (git) { run("init"); run("config", "user.name", "Fixture"); run("config", "user.email", "fixture@example.test"); run("add", "."); run("commit", "-m", "fixture"); }
  const options = { databasePath: join(base, "legacy.sqlite"), projectDatabaseRoot: join(base, "db"), cacheRoot: join(base, "cache") };
  const app = new XRayApplication(options); const snapshot = await app.indexProject(root); const ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  return { app, root, base, options, snapshot, ref, run };
}

describe("项目排除设置端到端", () => {
  it("无匹配规则使旧快照/题目失效，同义保存不失效，重启恢复且历史源码保留", async () => {
    const f = await fixture(); let app = f.app;
    try {
      const question = (await app.createOwnershipQuestions({ ...f.ref, count: 1, scope: { kind: "project" } }))[0]!;
      const saved = app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: [" Never/ "] });
      expect(saved.settings).toMatchObject({ revision: 1, rules: ["never/**"] });
      expect(await app.getSnapshotState(f.ref)).toMatchObject({ status: "stale", configurationChanged: true, addedFiles: [], removedFiles: [], changedFiles: [] });
      await expect(app.explainFeature(f.ref, "caller")).rejects.toThrow(/快照/);
      await expect(app.createOwnershipQuestions({ ...f.ref, count: 1, scope: { kind: "project" } })).rejects.toThrow(/快照/);
      await expect(app.gradeOwnershipAnswer({ ...f.ref, questionId: question.id, questionVersion: question.version, selfConfidence: 0.5, answer: "answer", citations: [], structuredAnswer: { kind: "entry", nodeId: "invalid" } })).rejects.toThrow(/快照/);
      const next = await app.indexProject(f.root); expect(next.snapshotId).not.toBe(f.ref.snapshotId); expect(next.sourceFiles).toEqual(f.snapshot.sourceFiles);
      const nextRef = { ...f.ref, snapshotId: next.snapshotId }; const questions = await app.createOwnershipQuestions({ ...nextRef, count: 1, scope: { kind: "project" } });
      expect(app.saveIgnoreSettings({ ...nextRef, expectedRevision: 1, rules: ["never/**", "NEVER/"] }).settings.revision).toBe(1);
      expect((await app.getSnapshotState(nextRef)).status).toBe("current"); expect(questions).toHaveLength(1);
      const evidence = f.snapshot.evidence.find(item => item.kind === "file")!;
      expect((await app.readSource({ ...f.ref, ...evidence.span, evidenceId: evidence.id })).content).toContain("export");
      app.close(); app = new XRayApplication(f.options); expect(app.getIgnoreSettings(nextRef).settings.rules).toEqual(["never/**"]);
      expect((await app.getSnapshotState(nextRef)).status).toBe("current");
    } finally { app.close(); }
  });
  it("规则实际排除与解除排除；固定安全范围保持，非法输入和旧修订拒绝", async () => {
    const f = await fixture(); try {
      expect(f.snapshot.sourceFiles.map(item => item.filePath)).toEqual([".hidden/c.ts", "a.ts", "generated/b.ts"]);
      expect(() => f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["../escape"] })).toThrow(/配置无效/);
      f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["generated/"] });
      expect(() => f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: [] })).toThrow(/已变化/);
      const next = await f.app.indexProject(f.root); expect(next.sourceFiles.map(item => item.filePath)).toEqual([".hidden/c.ts", "a.ts"]);
      expect(next.health.ignoredByRule).toContain("generated/**"); expect(next.health.ignoredByRule).toContain("**/.env*");
      f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 1, rules: [] }); const restored = await f.app.indexProject(f.root);
      expect(restored.sourceFiles).toEqual(f.snapshot.sourceFiles);
    } finally { f.app.close(); }
  });
  it("索引期间规则变化拒绝发布旧规则快照", async () => {
    const f = await fixture(); try {
      let changed = false;
      await expect(f.app.indexProject(f.root, "local", { onProgress(progress) { if (progress.phase === "verifying" && !changed) { changed = true; f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["never/"] }); } } })).rejects.toThrow(/配置已变化/);
      expect(f.app.getCurrentProject()?.snapshotId).toBe(f.ref.snapshotId);
    } finally { f.app.close(); }
  });
  it("损坏持久配置失败关闭，不能发布默认范围快照", async () => {
    const f = await fixture(); try {
      const db = new Database(join(f.options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`));
      db.prepare("INSERT INTO project_ignore_settings VALUES(?,?)").run(f.ref.repositoryId, '{"version":"future","revision":1,"rules":[]}'); db.close();
      expect(() => f.app.getIgnoreSettings(f.ref)).toThrow(/配置无效/);
      await expect(f.app.indexProject(f.root)).rejects.toThrow(/配置无效/);
      expect(await f.app.getSnapshotState(f.ref)).toMatchObject({ status: "unavailable", configurationChanged: false });
      const evidence = f.snapshot.evidence.find(item => item.kind === "file")!;
      expect((await f.app.readSource({ ...f.ref, ...evidence.span, evidenceId: evidence.id })).content).toContain("export");
    } finally { f.app.close(); }
  });
  it("旧快照缺少规则身份兼容读取，添加规则后过期且不回写历史", async () => {
    const f = await fixture(); try {
      const db = new Database(join(f.options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`));
      const old = structuredClone(f.snapshot); delete old.analysisIdentity.ignorePolicy;
      const payload = JSON.stringify(old); db.prepare("UPDATE snapshots SET payload=? WHERE snapshot_id=?").run(payload, f.ref.snapshotId);
      expect((await f.app.getSnapshotState(f.ref)).status).toBe("current");
      f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["never/"] }); expect((await f.app.getSnapshotState(f.ref)).status).toBe("stale");
      expect((db.prepare("SELECT payload FROM snapshots WHERE snapshot_id=?").get(f.ref.snapshotId) as { payload: string }).payload).toBe(payload); db.close();
    } finally { f.app.close(); }
  });
  it("校验后引用读取期间第二连接修改设置：拒绝旧评分且不写attempt", async () => {
    const f = await fixture(); const second = new GraphStore(join(f.options.projectDatabaseRoot, `${f.ref.repositoryId}.sqlite`));
    try {
      const question = (await f.app.createOwnershipQuestions({ ...f.ref, count: 1, scope: { kind: "project" } }))[0]!;
      const evidence = f.snapshot.evidence.find(item => item.id === question.evidenceIds[0])!;
      const original = GraphStore.prototype.readSnapshotSource;
      vi.spyOn(GraphStore.prototype, "readSnapshotSource").mockImplementationOnce(function(this: GraphStore, snapshotId, filePath) {
        second.saveIgnoreSettings(f.ref.repositoryId, 0, ["never/"]);
        return original.call(this, snapshotId, filePath);
      });
      await expect(f.app.gradeOwnershipAnswer({ ...f.ref, questionId: question.id, questionVersion: question.version, selfConfidence: 0.5, answer: "answer", citations: [{ ...evidence.span, evidenceId: evidence.id }], structuredAnswer: { kind: "entry", nodeId: question.expectedNodeIds[0]! } })).rejects.toThrow(/配置已变化/);
      expect(second.listOwnershipAttempts(f.ref.repositoryId)).toEqual([]);
    } finally { second.close(); f.app.close(); }
  });
  it("比较捕获期间配置修订变化拒绝发布报告", async () => {
    const f = await fixture(true); try {
      let changed = false;
      await expect(f.app.createChangeReport({ ...f.ref, mode: "staged", maxDepth: 2, maxPaths: 20, maxWork: 500 }, { onProgress(progress) { if (progress.phase === "analyzing-left" && !changed) { changed = true; f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["never/"] }); } } })).rejects.toThrow(/配置已变化/);
    } finally { f.app.close(); }
  });
  it.each(["working", "staged", "last-commit"] as const)("Git %s 两侧与普通索引规则一致，规则改变报告过期", async mode => {
    const f = await fixture(true); try {
      f.app.saveIgnoreSettings({ ...f.ref, expectedRevision: 0, rules: ["generated/"] });
      const next = await f.app.indexProject(f.root); const ref = { ...f.ref, snapshotId: next.snapshotId };
      await writeFile(join(f.root, "a.ts"), "export const changed = 2\n"); await writeFile(join(f.root, "generated", "b.ts"), "export const excluded = 2\n"); f.run("add", ".");
      if (mode === "last-commit") f.run("commit", "-m", "change");
      const report = await f.app.createChangeReport({ ...ref, mode, maxDepth: 2, maxPaths: 20, maxWork: 500 });
      expect(report.files.every(item => ![item.oldPath, item.newPath].some(path => path?.startsWith("generated/") || path === ".env"))).toBe(true);
      for (const side of [report.left, report.right]) { expect(side.analysisIdentity.ignorePolicy?.rules).toEqual(["generated/**"]); expect(side.completeness.exclusions.ignored.paths).toContain("generated/b.ts"); }
      expect((await f.app.getChangeReportState({ repositoryId: ref.repositoryId, reportId: report.id })).status).toBe("current");
      f.app.saveIgnoreSettings({ ...ref, expectedRevision: 1, rules: ["generated/", "never/"] });
      expect((await f.app.getChangeReportState({ repositoryId: ref.repositoryId, reportId: report.id })).status).toBe("stale");
    } finally { f.app.close(); }
  });
  it("重命名穿过排除边界不会捕获被排除侧 patch", async () => {
    const f = await fixture(true); try {
      f.run("mv", "generated/b.ts", "visible.ts");
      const captured = await captureComparison(f.root, "staged", 1, undefined, {}, createIgnorePolicy(["generated/"]));
      expect(captured.left.sources.some(item => item.projectPath === "generated/b.ts")).toBe(false);
      expect(captured.right.sources.some(item => item.projectPath === "visible.ts")).toBe(true);
      expect(captured.changes.some(item => item.oldPath === "generated/b.ts")).toBe(false);
    } finally { f.app.close(); }
  });
});
