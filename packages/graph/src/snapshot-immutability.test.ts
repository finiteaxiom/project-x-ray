import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ANALYSIS_RESULT_IDENTITY_VERSION, canonicalSnapshotResult, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "./index.js";

const content = "export const x = 1\n";
const hash = createHash("sha256").update(content).digest("hex");
const source = { filePath: "a.ts", contentHash: hash, language: "TypeScript", content };
function snapshot(id = "old-id", resultIdentity = false): ProjectSnapshot {
  const value: ProjectSnapshot = { repositoryId: "repo", snapshotId: id, name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-01-01T00:00:00.000Z", analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { test: "1" }, configurationHash: "config", sourceFingerprint: hash }, sourceFiles: [{ filePath: source.filePath, contentHash: hash, language: source.language, bytes: Buffer.byteLength(content) }], nodes: [{ id: "file", snapshotId: id, kind: "file", name: "a.ts", qualifiedName: "a.ts", filePath: "a.ts", evidenceId: "proof", metadata: {} }], edges: [], evidence: [{ id: "proof", snapshotId: id, analyzer: "test", analyzerVersion: "1", kind: "file", confidence: "verified", reason: "file", span: { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 18 } }], health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] } };
  if (resultIdentity) value.analysisIdentity.analysisResult = { version: ANALYSIS_RESULT_IDENTITY_VERSION, fingerprint: createHash("sha256").update(canonicalSnapshotResult(value)).digest("hex") };
  return value;
}
describe("不可变快照存储", () => {
  it.each([false, true])("旧/新身份(%s)同ID冲突拒绝，事实与原始payload/源码不变", async newIdentity => {
    const base = await mkdtemp(join(tmpdir(), "xray-immutable-")); const path = join(base, "db.sqlite"); const store = new GraphStore(path); const inspect = new Database(path);
    try {
      const original = snapshot("same", newIdentity); store.saveSnapshot(original, [source]);
      const raw = (inspect.prepare("SELECT payload FROM snapshots WHERE snapshot_id='same'").get() as { payload: string }).payload;
      expect(() => store.saveSnapshot({ ...original, nodes: original.nodes.map(node => ({ ...node, name: "wrong" })) }, [source])).toThrow(/拒绝覆盖/);
      expect(() => store.saveSnapshot({ ...original, evidence: original.evidence.map(proof => ({ ...proof, confidence: "unknown" })) }, [source])).toThrow(/拒绝覆盖/);
      expect(() => store.saveSnapshot(original, [{ ...source, content: "different body with same claimed hash" }])).toThrow(/拒绝覆盖/);
      expect(() => store.saveSnapshot(original, [])).toThrow(/拒绝覆盖/);
      const later = { ...original, createdAt: "2026-02-01T00:00:00.000Z" }; expect(store.saveSnapshot(later, [source])).toEqual(original);
      expect((inspect.prepare("SELECT payload FROM snapshots WHERE snapshot_id='same'").get() as { payload: string }).payload).toBe(raw);
      expect(store.getEvidence("same", "proof")?.confidence).toBe("verified"); expect(store.readSnapshotSource("same", "a.ts")?.content).toBe(content);
    } finally { inspect.close(); store.close(); await rm(base, { recursive: true, force: true }); }
  });
  it("冲突不晋升current；复用旧快照只改current元数据，迁移后重开仍选择旧ID", async () => {
    const base = await mkdtemp(join(tmpdir(), "xray-current-")); const path = join(base, "db.sqlite"); let store = new GraphStore(path);
    try {
      const old = snapshot("older"); const newer = { ...snapshot("newer"), createdAt: "2026-02-01T00:00:00.000Z" }; store.saveSnapshot(old, [source]); store.saveSnapshot(newer, [source]);
      expect(() => store.saveSnapshot({ ...old, health: { ...old.health, status: "partial" } }, [source])).toThrow(/拒绝覆盖/); expect(store.getLatestOverview()?.snapshotId).toBe("newer");
      store.saveSnapshot(old, [source]); store.close(); store = new GraphStore(path); expect(store.getLatestOverview()?.snapshotId).toBe("older"); expect(store.loadSnapshot("older")?.createdAt).toBe(old.createdAt);
    } finally { store.close(); await rm(base, { recursive: true, force: true }); }
  });
});
