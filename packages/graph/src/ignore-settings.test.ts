import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IGNORE_POLICY_VERSION } from "@project-xray/contracts";
import { GraphStore } from "./index.js";

describe("项目设置事务与迁移", () => {
  it("旧共享数据库添加版本8设置表且不改旧源码/快照payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-ignore-migrate-")); const path = join(directory, "old.sqlite");
    const raw = new Database(path); raw.exec("CREATE TABLE snapshots(snapshot_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,root_path TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)");
    raw.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run("old", "repo", "C:/project", "2026-01-01", "historical payload"); raw.close();
    const store = new GraphStore(path); const inspector = new Database(path);
    try {
      expect(store.loadIgnoreSettings("repo")).toEqual({ version: IGNORE_POLICY_VERSION, revision: 0, rules: [] });
      expect(inspector.prepare("SELECT version FROM schema_migrations WHERE version=8").get()).toEqual({ version: 8 });
      store.saveIgnoreSettings("repo", 0, ["generated/"]);
      expect(inspector.prepare("SELECT payload FROM snapshots WHERE snapshot_id='old'").get()).toEqual({ payload: "historical payload" });
    } finally { inspector.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it("两连接保存冲突、等价保存不递增、发布事务内改动回滚", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-ignore-cas-")); const path = join(directory, "project.sqlite"); const first = new GraphStore(path); const second = new GraphStore(path);
    try {
      expect(first.saveIgnoreSettings("repo", 0, ["GENERATED/"]).revision).toBe(1);
      expect(() => second.saveIgnoreSettings("repo", 0, [])).toThrow(/已变化/);
      expect(second.saveIgnoreSettings("repo", 1, ["generated/**", "generated/"]).revision).toBe(1);
      expect(() => first.withIgnoreRevision("repo", 0, () => undefined)).toThrow(/已变化/);
      expect(() => first.withIgnoreRevision("repo", 1, () => { first.saveIgnoreSettings("repo", 1, []); throw new Error("publication failed"); })).toThrow(/publication failed/);
      expect(second.loadIgnoreSettings("repo")).toMatchObject({ revision: 1, rules: ["generated/**"] });
    } finally { second.close(); first.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
