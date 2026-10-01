import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertContainedPath, createSecureReadScope, discoverProject, readSecureProjectFile, stableId } from "./index.js";

describe("analyzer-core", () => {
  it("生成稳定标识", () => {
    expect(stableId("a", "b")).toBe(stableId("a", "b"));
    expect(stableId("a", "b")).not.toBe(stableId("a", "c"));
  });

  it("阻止路径逃逸", () => {
    expect(() => assertContainedPath("C:\\project", "C:\\project\\src\\a.ts")).not.toThrow();
    expect(() => assertContainedPath("C:\\project", "C:\\secret.txt")).toThrow(/超出/);
  });

  it("发现文件失败时保留相对位置与安全错误码，不保留异常路径或源码片段", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-discovery-diagnostic-")); const root = join(base, "root"); await mkdir(root); await writeFile(join(root, "entry.ts"), "export const value = 1;", "utf8");
    try {
      const result = await discoverProject(root, undefined, { beforeEntry: () => { throw Object.assign(new Error("C:\\Users\\Felix\\private.ts /home/felix/private.ts PRIVATE_SOURCE_SNIPPET"), { code: "EACCES" }); } });
      expect(result.failures).toEqual([expect.objectContaining({ filePath: "entry.ts", code: "FILE_ACCESS_FAILED", detailCode: "EACCES" })]);
      expect(JSON.stringify(result.failures)).not.toMatch(/Felix|private\.ts|PRIVATE_SOURCE_SNIPPET/);
    } finally { await rm(base, { recursive: true, force: true }); }
  });

  it("不跟随逃出项目根目录的目录联接", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-junction-")); const root = join(base, "root"); const outside = join(base, "outside");
    await mkdir(root); await mkdir(outside); await writeFile(join(outside, "secret.ts"), "export const secret = 1", "utf8");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    try { const result = await discoverProject(root); expect(result.files).toHaveLength(0); }
    finally { await rm(base, { recursive: true, force: true }); }
  });

  it("发现后换成指向根外文件的最终文件符号链接时，在读取任何字节前拒绝句柄", async (context) => {
    const base = await mkdtemp(join(tmpdir(), "xray-file-link-race-")); const root = join(base, "root"); const target = join(root, "entry.ts"); const saved = join(root, "entry.saved.ts"); const outside = join(base, "outside.ts");
    await mkdir(root); await writeFile(target, "export const inside = true;\n", "utf8"); await writeFile(outside, "export const external_marker = true;\n", "utf8");
    const discovery = await discoverProject(root); const scope = await createSecureReadScope(root); let replaced = false; let readBytes = 0;
    const hooks = {
      beforeOpen: async (filePath: string) => {
        if (resolve(filePath) !== resolve(target) || replaced) return;
        await rename(target, saved);
        try { await symlink(outside, target, "file"); replaced = true; }
        catch (error) { await rename(saved, target); throw error; }
      },
      afterOpen: async (filePath: string) => {
        if (resolve(filePath) !== resolve(target) || !replaced) return;
        await unlink(target); await rename(saved, target); replaced = false;
      },
      onReadChunk: (_filePath: string, bytesRead: number) => { readBytes += bytesRead; },
    };
    try {
      let failure: unknown;
      try { await readSecureProjectFile(scope, discovery.files[0]!, { testHooks: hooks }); } catch (error) { failure = error; }
      if (process.platform === "win32" && typeof failure === "object" && failure !== null && "code" in failure && failure.code === "EPERM") {
        context.skip("Node could not create the final-file symlink fixture on this Windows host: fs.symlink returned EPERM");
      }
      expect(failure).toMatchObject({ code: "ERR_PROJECT_PATH_SECURITY" });
      expect(readBytes).toBe(0);
      expect(await readFile(target, "utf8")).toContain("inside");
    } finally {
      if (replaced) { await unlink(target); await rename(saved, target); }
      scope.close(); await rm(base, { recursive: true, force: true });
    }
  });

  it("在已打开句柄上短暂替换文件路径时只返回原句柄的字节", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-open-handle-race-")); const root = join(base, "root"); const nested = join(root, "nested"); const target = join(nested, "entry.ts"); const saved = join(nested, "entry.saved.ts"); const outside = join(base, "outside"); const outsideFile = join(outside, "entry.ts");
    await mkdir(nested, { recursive: true }); await mkdir(outside); const original = "export const inside_marker = 1;\n"; await writeFile(target, original, "utf8"); await writeFile(outsideFile, "export const external_marker = 2;\n", "utf8");
    const scope = await createSecureReadScope(root); let swapped = false; let swappedOnce = false;
    const restore = async (): Promise<void> => { await rename(target, outsideFile); await rename(saved, target); swapped = false; };
    const hooks = {
      afterOpen: async (filePath: string) => { if (resolve(filePath) !== resolve(target) || swappedOnce) return; await rename(target, saved); try { await rename(outsideFile, target); swapped = true; swappedOnce = true; } catch (error) { await rename(saved, target); throw error; } },
      afterRead: async (filePath: string) => { if (resolve(filePath) === resolve(target) && swapped) await restore(); },
    };
    try { expect(await readSecureProjectFile(scope, target, { testHooks: hooks })).toBe(original); }
    finally { if (swapped) await restore(); scope.close(); await rm(base, { recursive: true, force: true }); }
  });

  it("隔离子进程覆盖 GC 排队打开/读取、关闭冲突及失败清理", () => {
    const child = fileURLToPath(new URL("../scripts/secure-reader-lifecycle-child.cjs", import.meta.url));
    const result = spawnSync(process.execPath, ["--expose-gc", child], {
      cwd: resolve(child, "..", ".."),
      env: { ...process.env, UV_THREADPOOL_SIZE: "4" },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("secure-reader-lifecycle-ok");
  });

  it("发现隐藏目录中的支持源码，同时保留秘密和构建目录排除", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-hidden-source-"));
    await mkdir(join(root, ".hidden")); await mkdir(join(root, ".git")); await mkdir(join(root, "dist")); await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, ".hidden", "entry.ts"), "export const visible = true;", "utf8");
    await writeFile(join(root, ".hidden", ".env.local"), "SECRET=value", "utf8");
    await writeFile(join(root, ".git", "ignored.ts"), "export const git = true;", "utf8");
    await writeFile(join(root, "dist", "ignored.ts"), "export const build = true;", "utf8");
    await writeFile(join(root, "node_modules", "pkg", "ignored.ts"), "export const dependency = true;", "utf8");
    try {
      const result = await discoverProject(root);
      expect(result.files.map((file) => file.replaceAll("\\", "/"))).toContain(join(root, ".hidden", "entry.ts").replaceAll("\\", "/"));
      expect(result.secretPaths).toContain(".hidden/.env.local");
      expect(result.files.some((file) => /(?:^|[\\/])(?:\.git|dist|node_modules)(?:[\\/]|$)/.test(file))).toBe(false);
      expect(result.ignoredByRule).toEqual(expect.arrayContaining(["**/.git/**", "**/dist/**", "**/node_modules/**"]));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
