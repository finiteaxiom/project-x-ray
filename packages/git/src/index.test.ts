import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeGitPath, captureComparison, comparisonStateFingerprint, parseNameStatus, parsePatch } from "./index.js";

describe("Git 双侧不可变比较", () => {
  it("拒绝绝对路径、父目录逃逸和空路径", () => {
    expect(() => assertSafeGitPath("../outside.ts")).toThrow(/越界/);
    expect(() => assertSafeGitPath("C:/outside.ts")).toThrow(/越界/);
    expect(() => assertSafeGitPath("")).toThrow(/越界/);
  });
  it("纯解析支持当前平台无法创建的 pathspec magic 风格名称", () => {
    expect(parseNameStatus("M\0:(glob)literal.ts\0", assertSafeGitPath)[0]).toEqual(expect.objectContaining({ oldPath: ":(glob)literal.ts", newPath: ":(glob)literal.ts" }));
  });

  it("只把文件头当元数据，并统计 hunk 中以 ++ 或 -- 开头的源码", () => {
    const patch = [
      "diff --git a/counter.ts b/counter.ts", "--- a/counter.ts", "+++ b/counter.ts",
      "@@ -1,2 +1,2 @@", "---counter", "+++counter", " context",
      "@@ -5,2 +5,3 @@", "-value", "+next", "+++other", "\\ No newline at end of file",
    ].join("\n");
    expect(parsePatch(patch)).toMatchObject({ additions: 3, deletions: 2, binary: false, hunks: [expect.objectContaining({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 }), expect.objectContaining({ oldStart: 5, oldLines: 2, newStart: 5, newLines: 3 })] });
  });

  it("工作区身份包含未跟踪受支持文件内容，并拒绝捕获期间的混合内容", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-untracked-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); await writeFile(join(root, "base.ts"), "export const base = 1\n"); run("add", "."); run("commit", "-m", "base"); await writeFile(join(root, "new.ts"), "export const value = 1\n"); const before = await comparisonStateFingerprint(root, "working"); const first = await captureComparison(root, "working"); await writeFile(join(root, "new.ts"), "export const value = 2\n"); expect(await comparisonStateFingerprint(root, "working")).not.toBe(before); expect(first.captureFingerprint).toBe(before); const supportedIdentity = await comparisonStateFingerprint(root, "working"); await writeFile(join(root, ".env"), "SECRET=first\n"); await writeFile(join(root, "notes.md"), "excluded first\n"); const excludedIdentity = await comparisonStateFingerprint(root, "working"); await writeFile(join(root, ".env"), "SECRET=second\n"); await writeFile(join(root, "notes.md"), "excluded second\n"); expect(await comparisonStateFingerprint(root, "working")).toBe(excludedIdentity); expect(excludedIdentity).toBe(supportedIdentity);
      await expect(captureComparison(root, "working", 1, undefined, { afterSidesCaptured: async (attempt) => { await writeFile(join(root, "new.ts"), `export const value = ${attempt + 3}\n`); } })).rejects.toThrow(/有界重试|发生变化/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("从 HEAD、index 和工作区各自真实内容捕获三种比较", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-sides-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); await writeFile(join(root, "app.ts"), "export const value = 'head';\n", "utf8"); await writeFile(join(root, "tsconfig.json"), "{\"compilerOptions\":{\"strict\":true}}\n", "utf8"); run("add", "--", "app.ts", "tsconfig.json"); run("commit", "-m", "initial");
      await writeFile(join(root, "app.ts"), "export const value = 'index';\n", "utf8"); run("add", "--", "app.ts"); await writeFile(join(root, "app.ts"), "export const value = 'working';\n", "utf8"); await writeFile(join(root, "未跟踪 文件.ts"), "export const 新值 = 1;\n", "utf8");
      const staged = await captureComparison(root, "staged"); expect(staged.left.sources.find((item) => item.projectPath === "app.ts")?.content).toContain("head"); expect(staged.right.sources.find((item) => item.projectPath === "app.ts")?.content).toContain("index"); expect(staged.changes.map((item) => item.status)).toContain("modified");
      const working = await captureComparison(root, "working"); expect(working.left.sources.find((item) => item.projectPath === "app.ts")?.content).toContain("index"); expect(working.right.sources.find((item) => item.projectPath === "app.ts")?.content).toContain("working"); expect(working.changes).toEqual(expect.arrayContaining([expect.objectContaining({ status: "untracked", newPath: "未跟踪 文件.ts" })]));
      const initial = await captureComparison(root, "last-commit"); expect(initial.left.kind).toBe("empty-tree"); expect(initial.right.revision).toBe(initial.head); expect(initial.changes[0]?.status).toBe("added");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("纯重命名、重命名局部修改和重命名删除内容使用一致范围", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-rename-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); const pure = "export const pureMarker = 1\nexport const pureTail = 2\n"; const modify = "export function modifyMarker() {\n  const first = 1\n  const changed = 2\n  return first + changed\n}\n"; const shrink = "export function shrinkMarker() {\n  const keep = 1\n  const removeA = 2\n  const removeB = 3\n  return keep\n}\n"; await writeFile(join(root, "pure-old.ts"), pure); await writeFile(join(root, "similar.ts"), pure.replace("pureMarker", "similarMarker")); await writeFile(join(root, "modify-old.ts"), modify); await writeFile(join(root, "shrink-old.ts"), shrink); run("add", "."); run("commit", "-m", "base"); run("mv", "pure-old.ts", "pure-new.ts"); run("mv", "modify-old.ts", "modify-new.ts"); run("mv", "shrink-old.ts", "shrink-new.ts"); await writeFile(join(root, "modify-new.ts"), modify.replace("changed = 2", "changed = 9")); await writeFile(join(root, "shrink-new.ts"), "export function shrinkMarker() {\n  const keep = 1\n  return keep\n}\n"); run("add", "-A"); const result = await captureComparison(root, "staged"); const pureChange = result.changes.find((item) => item.oldPath === "pure-old.ts"); expect(pureChange).toEqual(expect.objectContaining({ status: "renamed", newPath: "pure-new.ts", additions: 0, deletions: 0, hunks: [] })); expect(result.changes.some((item) => item.oldPath === "similar.ts" || item.newPath === "similar.ts")).toBe(false); const modified = result.changes.find((item) => item.oldPath === "modify-old.ts"); expect(modified).toEqual(expect.objectContaining({ status: "renamed", newPath: "modify-new.ts", additions: 1, deletions: 1 })); expect(modified?.hunks).toEqual([expect.objectContaining({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 })]); const shrunk = result.changes.find((item) => item.oldPath === "shrink-old.ts"); expect(shrunk).toEqual(expect.objectContaining({ status: "renamed", newPath: "shrink-new.ts", additions: 0, deletions: 2 })); expect(shrunk?.hunks[0]).toEqual(expect.objectContaining({ oldStart: 3, oldLines: 2, newLines: 0 })); expect(parsePatch("@@ -2,0 +3,2 @@\n+a\n+b\n\\ No newline at end of file").hunks[0]).toEqual(expect.objectContaining({ oldLines: 0, newLines: 2 })); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it("字面 pathspec 字符不会串到相似文件", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-literal-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); await writeFile(join(root, "[one].ts"), "export const literal = 1\n"); await writeFile(join(root, "o.ts"), "export const other = 1\n"); run("add", "."); run("commit", "-m", "base"); await writeFile(join(root, "[one].ts"), "export const literal = 2\n"); await writeFile(join(root, "o.ts"), "export const other = 3\n"); run("add", "-A"); const result = await captureComparison(root, "staged"); expect(result.changes).toHaveLength(2); expect(result.changes.find((item) => item.newPath === "[one].ts")).toEqual(expect.objectContaining({ additions: 1, deletions: 1 })); expect(result.changes.find((item) => item.newPath === "o.ts")).toEqual(expect.objectContaining({ additions: 1, deletions: 1 })); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it("20% 重命名阈值两侧行为可见且不会强行配对", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-threshold-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" }); const lines = (prefix: string, unchanged: number) => Array.from({ length: 40 }, (_, index) => index < unchanged ? `export const stable${index} = ${index}` : `export const ${prefix}${index} = ${index + 100}`).join("\n") + "\n";
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); await writeFile(join(root, "above-old.ts"), lines("oldAbove", 40)); await writeFile(join(root, "below-old.ts"), lines("oldBelow", 40)); run("add", "."); run("commit", "-m", "base"); run("mv", "above-old.ts", "above-new.ts"); run("mv", "below-old.ts", "below-new.ts"); await writeFile(join(root, "above-new.ts"), lines("newAbove", 12)); await writeFile(join(root, "below-new.ts"), lines("newBelow", 2)); run("add", "-A"); const result = await captureComparison(root, "staged"); expect(result.changes.find((item) => item.oldPath === "above-old.ts")).toEqual(expect.objectContaining({ status: "renamed", newPath: "above-new.ts" })); expect(result.changes.some((item) => item.status === "renamed" && item.oldPath === "below-old.ts")).toBe(false); expect(result.changes).toEqual(expect.arrayContaining([expect.objectContaining({ status: "deleted", oldPath: "below-old.ts" }), expect.objectContaining({ status: "added", newPath: "below-new.ts" })])); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it("无提交仓库给出清晰错误；初始提交按仓库对象格式计算空树", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-git-object-format-")); const empty = join(base, "empty"); const sha256 = join(base, "sha256"); await mkdir(empty); const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
    try { run(empty, "init"); await expect(captureComparison(empty, "working")).rejects.toThrow(/尚无任何提交/); await mkdir(sha256); try { run(sha256, "init", "--object-format=sha256"); } catch { return; } run(sha256, "config", "user.email", "xray@example.test"); run(sha256, "config", "user.name", "X-Ray Test"); await writeFile(join(sha256, "a.ts"), "export const a = 1\n"); run(sha256, "add", "."); run(sha256, "commit", "-m", "initial"); const comparison = await captureComparison(sha256, "last-commit"); expect(comparison.left.kind).toBe("empty-tree"); expect(comparison.left.revision).toMatch(/^[0-9a-f]{64}$/); }
    finally { await rm(base, { recursive: true, force: true }); }
  });

  it("未合并 index 明确失败", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-git-conflict-")); const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    try { run("init"); run("config", "user.email", "xray@example.test"); run("config", "user.name", "X-Ray Test"); await writeFile(join(root, "a.ts"), "export const x = 'base';\n"); run("add", "."); run("commit", "-m", "base"); run("checkout", "-b", "other"); await writeFile(join(root, "a.ts"), "export const x = 'other';\n"); run("commit", "-am", "other"); run("checkout", "master"); await writeFile(join(root, "a.ts"), "export const x = 'main';\n"); run("commit", "-am", "main"); try { run("merge", "other"); } catch { /* 预期冲突 */ } await expect(captureComparison(root, "staged")).rejects.toThrow(/未合并/); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it("合并提交显式选择父提交，浅克隆缺失父对象不回退空树", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-git-parents-")); const root = join(base, "origin"); const shallow = join(base, "shallow"); await mkdir(root); const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
    try { run(root, "init"); run(root, "config", "user.email", "xray@example.test"); run(root, "config", "user.name", "X-Ray Test"); await writeFile(join(root, "base.ts"), "export const base = 1\n"); run(root, "add", "."); run(root, "commit", "-m", "base"); const mainBranch = run(root, "rev-parse", "--abbrev-ref", "HEAD").toString().trim(); run(root, "checkout", "-b", "feature"); await writeFile(join(root, "feature.ts"), "export const feature = 1\n"); run(root, "add", "."); run(root, "commit", "-m", "feature"); const feature = run(root, "rev-parse", "HEAD").toString().trim(); run(root, "checkout", mainBranch); await writeFile(join(root, "main.ts"), "export const main = 1\n"); run(root, "add", "."); run(root, "commit", "-m", "main"); run(root, "merge", "--no-ff", "feature", "-m", "merge"); const secondParent = await captureComparison(root, "last-commit", 2); expect(secondParent.left.revision).toBe(feature); expect(secondParent.left.parentNumber).toBe(2);
      const url = `file:///${root.replaceAll("\\", "/")}`; execFileSync("git", ["clone", "--depth", "1", url, shallow], { stdio: "pipe" }); await expect(captureComparison(shallow, "last-commit")).rejects.toThrow(/浅克隆|缺少/);
    } finally { await rm(base, { recursive: true, force: true }); }
  });
});
