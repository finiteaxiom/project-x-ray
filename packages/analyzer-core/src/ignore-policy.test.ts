import { describe, expect, it } from "vitest";
import { ignoreRulesSchema } from "@project-xray/contracts";
import { classifyProjectPath, createIgnorePolicy, matchesIgnoreRule } from "./index.js";

describe("受限项目排除", () => {
  it("规范化目录、大小写、空白、顺序和重复规则", () => {
    expect(createIgnorePolicy([" Generated/ ", "**/*.test.ts", "generated/**"])).toEqual(createIgnorePolicy(["generated/**", "**/*.test.ts"]));
  });
  it("匹配根路径、单段通配与任意层级，并保留隐藏源码", () => {
    expect(matchesIgnoreRule("src/a.ts", "src/?.ts")).toBe(true);
    expect(matchesIgnoreRule("src/deep/a.ts", "src/*.ts")).toBe(false);
    expect(matchesIgnoreRule("a.ts", "**/*.ts")).toBe(true);
    expect(matchesIgnoreRule("deep/a.ts", "a.ts")).toBe(false);
    expect(matchesIgnoreRule("src/generated/deep/a.ts", "src/generated/**")).toBe(true);
    expect(matchesIgnoreRule("a+b.ts", "a+b.ts")).toBe(true);
    expect(matchesIgnoreRule("aaab.ts", "a+b.ts")).toBe(false);
    expect(classifyProjectPath(".hidden/a.ts", createIgnorePolicy())).toBe("source");
  });
  it.each(["../a", "/a", "C:/a", "\\\\server\\share", "a\\b", "a/../b", "a//b", "!**/.env", "[ab].ts", "{a,b}.ts", "@(a).ts", "a**b", "a\0b", "./a"])("拒绝 %s", rule => {
    expect(ignoreRulesSchema.safeParse([rule]).success).toBe(false);
  });
  it("固定安全分类无法被自定义规则关闭", () => {
    const policy = createIgnorePolicy(["**/*.ts"]);
    expect(classifyProjectPath(".env", policy)).toBe("secret");
    expect(classifyProjectPath("src/private.key", policy)).toBe("secret");
    expect(classifyProjectPath("node_modules/a.js", policy)).toBe("ignored");
    expect(classifyProjectPath("src/a.ts", policy)).toBe("ignored");
  });
});
