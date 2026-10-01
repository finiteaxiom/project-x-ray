import { describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { TASK_PROTOCOL_VERSION, workerRequestSchema, workerResponseSchema, type IndexTaskEvent } from "@project-xray/contracts";

describe("构建后worker排除配置协议", () => {
  it("真实后台保存→过期→重新索引，非法worker输入不改变设置", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-ignore-worker-")); const project = join(base, "project");
    await mkdir(project); await writeFile(join(project, "a.ts"), "export const a = 1\n"); await writeFile(join(project, "excluded.ts"), "export const excluded = 1\n");
    const worker = new Worker(join(process.cwd(), "dist", "analysis-worker.js"), { workerData: { databasePath: join(base, "legacy.sqlite"), projectDatabaseRoot: join(base, "db"), cacheRoot: join(base, "cache") } });
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const events = new Map<string, (event: IndexTaskEvent) => void>();
    worker.on("message", raw => {
      const message = workerResponseSchema.parse(raw);
      if (message.type === "response") { const waiter = pending.get(message.requestId); pending.delete(message.requestId); if (message.ok) waiter?.resolve(message.payload); else waiter?.reject(new Error(message.code)); }
      if (message.type === "event") events.get(message.event.taskId)?.(message.event);
    });
    worker.on("error", error => { for (const waiter of pending.values()) waiter.reject(error); });
    const rpc = (input: Record<string, unknown>, validate = true): Promise<unknown> => {
      const requestId = randomUUID(); const request = { ...input, requestId }; if (validate) workerRequestSchema.parse(request);
      return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); worker.postMessage(request); });
    };
    const index = async (): Promise<Extract<IndexTaskEvent, { type: "completed" }>> => {
      const taskId = randomUUID(); const completion = new Promise<Extract<IndexTaskEvent, { type: "completed" }>>((resolve, reject) => {
        events.set(taskId, event => { if (event.type === "completed") resolve(event); else if (event.type === "failed") reject(new Error(event.code)); });
      });
      await rpc({ operation: "start-index", taskId, rootPath: project, sourceType: "local" }); return completion;
    };
    try {
      const first = await index(); expect(first.protocolVersion).toBe(TASK_PROTOCOL_VERSION); expect(first.overview.health.indexedFiles).toBe(2);
      const ref = { repositoryId: first.repositoryId, snapshotId: first.overview.snapshotId };
      expect(await rpc({ operation: "get-ignore-settings", ref })).toMatchObject({ settings: { revision: 0, rules: [] } });
      await expect(rpc({ operation: "save-ignore-settings", input: { ...ref, expectedRevision: 0, rules: ["../escape"] } }, false)).rejects.toThrow("TASK_FAILED");
      expect(await rpc({ operation: "save-ignore-settings", input: { ...ref, expectedRevision: 0, rules: ["excluded.ts"] } })).toMatchObject({ settings: { revision: 1, rules: ["excluded.ts"] } });
      expect(await rpc({ operation: "get-state", ref })).toMatchObject({ status: "stale", configurationChanged: true });
      const next = await index(); expect(next.overview.health.indexedFiles).toBe(1); expect(next.overview.snapshotId).not.toBe(ref.snapshotId);
      expect(await rpc({ operation: "get-state", ref: { ...ref, snapshotId: next.overview.snapshotId } })).toMatchObject({ status: "current" });
    } finally { await worker.terminate(); await rm(base, { recursive: true, force: true }); }
  }, 20000);
});
