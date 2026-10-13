import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export interface AnalysisParseCacheRecord { filePath: string; contentHash: string; identity: string; payload: string; digest: string }
export interface AnalysisParseCacheQuery { repositoryId: string; rootPath: string; configurationHash: string; sources: Array<{ filePath: string; contentHash: string }> }
export interface AnalysisParseCachePublication { repositoryId: string; snapshotId: string; activation: string; configurationHash: string; ignoreRevision: number; records: AnalysisParseCacheRecord[] }
const ROWS = 2048, BYTES = 32 * 1024 * 1024, ROW_BYTES = 1024 * 1024;
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const valid = (r: AnalysisParseCacheRecord): boolean => typeof r.filePath === "string" && r.filePath.length <= 4096 && !r.filePath.startsWith("/") && !r.filePath.includes("\\") && !r.filePath.split("/").some(p => p === ".." || p === "") && typeof r.identity === "string" && r.identity.length <= 4096 && typeof r.payload === "string" && Buffer.byteLength(r.payload) <= ROW_BYTES && /^[a-f0-9]{64}$/.test(r.contentHash) && r.digest === hash(r.payload);

/** Disposable project-local syntax material. Never graph facts or a publication authority. */
export class AnalysisParseCache {
  constructor(private db: Database.Database, private enabled: boolean, private checkRevision: (repositoryId: string, revision: number) => void) {}
  migrate(): void {
    if (!this.enabled) return;
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS analysis_parse_cache (
        repository_id TEXT NOT NULL, file_path TEXT NOT NULL, content_hash TEXT NOT NULL,
        identity TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
        producer_snapshot_id TEXT NOT NULL, last_used_at TEXT NOT NULL,
        PRIMARY KEY(repository_id,file_path));`);
      this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(12,?)").run(new Date().toISOString());
    }).immediate();
  }
  load(q: AnalysisParseCacheQuery): AnalysisParseCacheRecord[] {
    if (!this.enabled || !this.db.open) return [];
    try {
      const read = this.db.prepare(`SELECT c.file_path filePath,c.content_hash contentHash,c.identity,c.payload,c.digest
        FROM analysis_parse_cache c JOIN snapshots p ON p.snapshot_id=c.producer_snapshot_id
        JOIN source_snapshots s ON s.snapshot_id=p.snapshot_id AND s.file_path=c.file_path
        WHERE c.repository_id=? AND c.file_path=? AND c.content_hash=? AND s.content_hash=c.content_hash
        AND p.repository_id=c.repository_id AND p.root_path=?
        AND json_extract(p.payload,'$.health.status')='ready'
        AND json_extract(p.payload,'$.analysisIdentity.configurationHash')=?
        AND length(CAST(c.payload AS BLOB))<=? AND length(c.identity)<=4096 AND length(c.digest)=64 LIMIT 1`);
      const result: AnalysisParseCacheRecord[] = []; let bytes = 0;
      for (const s of q.sources.slice(0, ROWS)) {
        const row = read.get(q.repositoryId, s.filePath, s.contentHash, q.rootPath, q.configurationHash, Math.min(ROW_BYTES, BYTES - bytes)) as AnalysisParseCacheRecord | undefined;
        if (row && valid(row)) { bytes += Buffer.byteLength(row.payload); result.push(row); }
        if (bytes >= BYTES) break;
      }
      return result;
    } catch { return []; }
  }
  publish(p: AnalysisParseCachePublication): boolean {
    if (!this.enabled || !this.db.open || this.db.inTransaction) return false;
    try {
      return this.db.transaction(() => {
        const active = this.db.prepare(`SELECT o.snapshot_id id,o.activated_at activation,json_extract(s.payload,'$.health.status') status,
          json_extract(s.payload,'$.analysisIdentity.configurationHash') config FROM snapshot_overviews o JOIN snapshots s USING(snapshot_id)
          WHERE o.repository_id=? AND o.is_current=1 LIMIT 1`).get(p.repositoryId) as { id: string; activation: string; status: string; config: string } | undefined;
        this.checkRevision(p.repositoryId, p.ignoreRevision);
        if (!active || active.id !== p.snapshotId || active.activation !== p.activation || active.config !== p.configurationHash) return false;
        // Partial producer cannot install a success bank, including a failed tool probe.
        this.db.prepare("DELETE FROM analysis_parse_cache WHERE repository_id=?").run(p.repositoryId);
        if (active.status !== "ready") return true;
        const source = this.db.prepare("SELECT content_hash hash FROM source_snapshots WHERE snapshot_id=? AND file_path=?");
        const insert = this.db.prepare("INSERT INTO analysis_parse_cache VALUES(?,?,?,?,?,?,?,?)");
        let bytes = 0, rows = 0;
        for (const r of p.records.slice(0, ROWS)) {
          if (!valid(r) || (source.get(p.snapshotId, r.filePath) as { hash: string } | undefined)?.hash !== r.contentHash) continue;
          const size = Buffer.byteLength(r.payload); if (bytes + size > BYTES || rows >= ROWS) break;
          insert.run(p.repositoryId, r.filePath, r.contentHash, r.identity, r.payload, r.digest, p.snapshotId, p.activation); bytes += size; rows++;
        }
        return true;
      }).immediate();
    } catch { return false; }
  }
}
