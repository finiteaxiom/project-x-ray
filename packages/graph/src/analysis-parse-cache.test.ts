import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore, type AnalysisParseCacheRecord } from "./index.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const stores: GraphStore[] = [], raws: Database.Database[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const r of raws.splice(0)) if (r.open) r.close(); });
function setup(count = 1) {
  const file = join(mkdtempSync(join(tmpdir(), "xray-cache-store-")), "project.sqlite"); const s = new GraphStore(file); stores.push(s); const db = new Database(file); raws.push(db);
  const sources = Array.from({ length: count }, (_, i) => ({ filePath: `f${i}.py`, content: "def x():\n    return 1\n", contentHash: hash("def x():\n    return 1\n"), language: "Python" }));
  const snapshot: ProjectSnapshot = { repositoryId: "repo", snapshotId: "snap", name: "sample", rootPath: "C:/sample", sourceType: "local", createdAt: new Date().toISOString(), analysisIdentity: { graphIrVersion: "1", analyzerVersions: { test: "1" }, configurationHash: "config", sourceFingerprint: "f" }, sourceFiles: sources.map(x => ({ filePath: x.filePath, contentHash: x.contentHash, language: x.language, bytes: Buffer.byteLength(x.content) })), nodes: [], edges: [], evidence: [], health: { status: "ready", totalFiles: count, indexedFiles: count, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { Python: count }, limitations: [] } };
  const saved = s.saveSnapshot(snapshot, sources, true, 0); const activation = s.getSnapshotPublicationActivation(saved)!;
  const records = sources.map(x => ({ filePath: x.filePath, contentHash: x.contentHash, identity: "{}", payload: "{}", digest: hash("{}") }));
  const publication = { repositoryId: "repo", snapshotId: "snap", activation, configurationHash: "config", ignoreRevision: 0, records };
  const query = { repositoryId: "repo", rootPath: "C:/sample", configurationHash: "config", sources };
  return { s, db, file, snapshot, sources, publication, query };
}
describe("project parse cache transactions", () => {
  it("registers migration12 only for project and rejects same-ID activation replay", () => {
    const f = setup(); expect(f.db.prepare("SELECT version FROM schema_migrations WHERE version=12").get()).toEqual({ version: 12 }); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(true);
    const second = new GraphStore(f.file); stores.push(second); second.saveSnapshot(f.snapshot, f.sources, true, 0); expect(second.getCurrentActivation()).not.toBe(f.publication.activation); expect(f.s.publishAnalysisParseCache({ ...f.publication, records: [] })).toBe(false); expect(f.s.loadAnalysisParseCache(f.query)).toHaveLength(1);
    const global = new GraphStore(":memory:", "global"); stores.push(global); expect(global.loadAnalysisParseCache(f.query)).toEqual([]); expect(global.publishAnalysisParseCache(f.publication)).toBe(false);
    const globalDb = (global as unknown as { database: Database.Database }).database; expect(globalDb.prepare("SELECT name FROM sqlite_master WHERE name='analysis_parse_cache'").get()).toBeUndefined(); expect(globalDb.prepare("SELECT version FROM schema_migrations WHERE version=12").get()).toBeUndefined();
  });
  it("rejects new config revision, damaged settings, source hash and producer identity", () => {
    const f = setup(); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(true);
    f.db.prepare("INSERT INTO project_ignore_settings VALUES(?,?)").run("repo", JSON.stringify({ version: "1.0.0", revision: 1, rules: [] })); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(false);
    f.db.prepare("UPDATE project_ignore_settings SET payload='{}'").run(); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(false);
    f.db.prepare("DELETE FROM project_ignore_settings").run(); expect(f.s.publishAnalysisParseCache({ ...f.publication, snapshotId: "wrong" })).toBe(false);
    const bad = { ...f.publication.records[0]!, contentHash: hash("wrong") }; expect(f.s.publishAnalysisParseCache({ ...f.publication, records: [bad] })).toBe(true); expect(f.s.loadAnalysisParseCache(f.query)).toEqual([]);
  });
  it("enforces row/byte budgets in SQL and atomically abandons BUSY or duplicate batch", () => {
    const f = setup(2100); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(true); expect(f.db.prepare("SELECT count(*) n FROM analysis_parse_cache").get()).toEqual({ n: 2048 }); expect(f.s.loadAnalysisParseCache(f.query)).toHaveLength(2048);
    const payload = "x".repeat(1024 * 1024); const rows: AnalysisParseCacheRecord[] = f.publication.records.slice(0, 40).map(r => ({ ...r, payload, digest: hash(payload) })); expect(f.s.publishAnalysisParseCache({ ...f.publication, records: rows })).toBe(true); expect(f.db.prepare("SELECT count(*) n,sum(length(CAST(payload AS BLOB))) bytes FROM analysis_parse_cache").get()).toEqual({ n: 32, bytes: 32 * 1024 * 1024 });
    f.db.prepare("UPDATE analysis_parse_cache SET payload=? WHERE file_path='f0.py'").run(payload + "x"); expect(f.s.loadAnalysisParseCache(f.query)).toHaveLength(31);
    const before = f.db.prepare("SELECT count(*) n FROM analysis_parse_cache").get(); expect(f.s.publishAnalysisParseCache({ ...f.publication, records: [rows[0]!, rows[0]!] })).toBe(false); expect(f.db.prepare("SELECT count(*) n FROM analysis_parse_cache").get()).toEqual(before);
    f.db.exec("BEGIN IMMEDIATE"); expect(f.s.publishAnalysisParseCache(f.publication)).toBe(false); f.db.exec("ROLLBACK"); expect(f.s.loadSnapshot("snap")?.snapshotId).toBe("snap");
  });
  it("never installs successful rows from a partial producer", () => {
    const f = setup(); const partial = { ...f.snapshot, snapshotId: "partial", health: { ...f.snapshot.health, status: "partial" as const } }; const saved = f.s.saveSnapshot(partial, f.sources, true, 0); expect(f.s.publishAnalysisParseCache({ ...f.publication, snapshotId: saved.snapshotId, activation: f.s.getSnapshotPublicationActivation(saved)! })).toBe(true); expect(f.s.loadAnalysisParseCache(f.query)).toEqual([]);
  });
});
