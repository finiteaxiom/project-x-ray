import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { assertContainedPath, discoverProject, stableId } from "./index.js";

describe("analyzer-core", () => {
  it("生成稳定标识", () => {
    expect(stableId("a", "b")).toBe(stableId("a", "b"));
    expect(stableId("a", "b")).not.toBe(stableId("a", "c"));
  });

  it("阻止路径逃逸", () => {
    expect(() => assertContainedPath("C:\\project", "C:\\project\\src\\a.ts")).not.toThrow();
    expect(() => assertContainedPath("C:\\project", "C:\\secret.txt")).toThrow(/超出/);
  });

  it("不跟随逃出项目根目录的目录联接", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-junction-")); const root = join(base, "root"); const outside = join(base, "outside");
    await mkdir(root); await mkdir(outside); await writeFile(join(outside, "secret.ts"), "export const secret = 1", "utf8");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    try { const result = await discoverProject(root); expect(result.files).toHaveLength(0); }
    finally { await rm(base, { recursive: true, force: true }); }
  });
});
