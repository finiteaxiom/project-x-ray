import { describe, expect, it } from "vitest";
import { IGNORE_POLICY_VERSION, TASK_PROTOCOL_VERSION, ignoreRulesSchema, projectIgnoreSettingsSchema, saveIgnoreSettingsRequestSchema, workerRequestSchema } from "./index.js";

describe("排除配置进程和持久化边界", () => {
  const input = { repositoryId: "repository", snapshotId: "snapshot", expectedRevision: 0, rules: ["GENERATED/"] };
  it("worker接收规范化配置，协议显式升级", () => {
    expect(TASK_PROTOCOL_VERSION).toBe("1.2.0");
    expect(workerRequestSchema.parse({ requestId: "request", operation: "save-ignore-settings", input })).toMatchObject({ input: { rules: ["generated/**"] } });
  });
  it("拒绝任意数据库路径、关闭安全规则开关和无界输入", () => {
    expect(saveIgnoreSettingsRequestSchema.safeParse({ ...input, repositoryId: "../external" }).success).toBe(false);
    expect(saveIgnoreSettingsRequestSchema.safeParse({ ...input, disableDefaults: true }).success).toBe(false);
    expect(ignoreRulesSchema.safeParse(Array.from({ length: 101 }, () => "a")).success).toBe(false);
    expect(ignoreRulesSchema.safeParse(["a".repeat(257)]).success).toBe(false);
    expect(saveIgnoreSettingsRequestSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
  });
  it("不支持版本和损坏设置不得静默回落默认", () => {
    expect(projectIgnoreSettingsSchema.safeParse({ version: "future", revision: 0, rules: [] }).success).toBe(false);
    expect(projectIgnoreSettingsSchema.safeParse({ version: IGNORE_POLICY_VERSION, revision: 0, rules: ["!**/.env"] }).success).toBe(false);
  });
});
