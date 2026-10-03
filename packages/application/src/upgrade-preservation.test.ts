import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalSnapshotResult, type OwnershipAttempt, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore, overviewFromSnapshot } from "@project-xray/graph";
import { XRayApplication } from "./index.js";

interface Database { open: boolean; prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }; exec(sql: string): void; close(): void }
const Raw = createRequire(import.meta.url)("better-sqlite3") as new (file: string) => Database;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const leaves = ["global.sqlite", "projects/a.sqlite", "projects/b.sqlite"] as const;
interface Fixture { root: string; marker: string; raws: Database[]; apps: XRayApplication[] }
const fixtures: Fixture[] = [];
function fixture(): Fixture { const root = realpathSync(mkdtempSync(join(tmpdir(), "xray-upgrade-app-"))), marker = randomUUID(); writeFileSync(join(root, ".fixture"), marker, { flag: "wx" }); mkdirSync(join(root, "source")); mkdirSync(join(root, "source", "projects")); const f = { root, marker, raws: [], apps: [] }; fixtures.push(f); return f; }
function path(f: Fixture, name: string): string {
  if (!fixtures.includes(f) || realpathSync(f.root) !== f.root || readFileSync(join(f.root, ".fixture"), "utf8") !== f.marker) throw new Error("Fixture boundary rejected");
  if (!/^(source|package|operation|restored)(?:\/(?:projects(?:\/(?:a|b)\.sqlite(?:-wal|-shm|-journal)?)?|global\.sqlite(?:-wal|-shm|-journal)?|cache))?$/.test(name) && name !== "COMPLETED") throw new Error("Fixture leaf rejected");
  const result = resolve(f.root, name); if (relative(f.root, result).startsWith("..") || !result.startsWith(f.root + sep)) throw new Error("Fixture boundary rejected");
  let value = result; while (value !== f.root) { if (existsSync(value) && lstatSync(value).isSymbolicLink()) throw new Error("Fixture link rejected"); value = dirname(value); } return result;
}
function raw(f: Fixture, name: string): Database { const db = new Raw(path(f, name)); f.raws.push(db); return db; }
function close(f: Fixture): void { for (const app of f.apps.splice(0)) app.close(); for (const db of f.raws.splice(0)) if (db.open) db.close(); }
afterEach(() => { for (const f of fixtures) { close(f); path(f, "source"); if (!f.root.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Fixture cleanup rejected"); rmSync(f.root, { recursive: true, force: true }); } fixtures.length = 0; });
interface Entry { name: string; bytes: number; hash: string }
function inventory(f: Fixture, folder: string): Entry[] {
  const entries: Entry[] = []; let group = 0;
  for (const leaf of leaves) { let databaseBytes = 0;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const name = leaf + suffix, file = path(f, `${folder}/${name}`); if (!existsSync(file)) continue;
      if (!lstatSync(file).isFile()) throw new Error("Fixture file rejected"); const size = lstatSync(file).size; databaseBytes += size; group += size;
      if (databaseBytes > 16 * 1024 * 1024 || group > 48 * 1024 * 1024) throw new Error("Fixture budget rejected"); const bytes = readFileSync(file); if (bytes.length !== size) throw new Error("Fixture changed"); entries.push({ name, bytes: size, hash: hash(bytes) });
    }
    if (!entries.some(entry => entry.name === leaf)) throw new Error("Fixture main missing");
  }
  return entries;
}
function copy(f: Fixture, from: string, to: string, entries: Entry[]): void { mkdirSync(path(f, to)); mkdirSync(path(f, `${to}/projects`)); for (const entry of entries) copyFileSync(path(f, `${from}/${entry.name}`), path(f, `${to}/${entry.name}`), constants.COPYFILE_EXCL); expect(inventory(f, to)).toEqual(entries); }
function preserve(f: Fixture) {
  if (f.raws.some(db => db.open) || f.apps.length) throw new Error("Fixture writer active");
  const entries = inventory(f, "source"); copy(f, "source", "package", entries); expect(inventory(f, "source")).toEqual(entries); copy(f, "package", "operation", entries);
  return { restore: () => copy(f, "package", "restored", entries), unchanged: () => { expect(inventory(f, "source")).toEqual(entries); expect(inventory(f, "package")).toEqual(entries); }, complete: () => { expect(inventory(f, "source")).toEqual(entries); expect(inventory(f, "package")).toEqual(entries); writeFileSync(path(f, "COMPLETED"), "fixture-verified", { flag: "wx" }); } };
}
function open(f: Fixture, folder: "operation" | "restored"): XRayApplication { const app = new XRayApplication({ databasePath: path(f, `${folder}/global.sqlite`), projectDatabaseRoot: path(f, `${folder}/projects`), cacheRoot: path(f, `${folder}/cache`) }); f.apps.push(app); return app; }
const content = "export function entry(){ return 1; } // 自有🙂\n";
function snapshot(id: string, createdAt: string): ProjectSnapshot {
  const span = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 35 };
  const value: ProjectSnapshot = { repositoryId: id === "shared" ? "global-repo" : id.split("-")[0]!, snapshotId: id, name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt,
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { fixture: "1" }, configurationHash: hash("config"), sourceFingerprint: hash(content) }, sourceFiles: [{ filePath: "a.ts", contentHash: hash(content), language: "TypeScript", bytes: Buffer.byteLength(content) }],
    nodes: [{ id: `${id}-entry`, snapshotId: id, kind: "function", name: "entry", qualifiedName: "entry", filePath: "a.ts", evidenceId: `${id}-proof`, metadata: {} }], edges: [], evidence: [{ id: `${id}-proof`, snapshotId: id, analyzer: "fixture", analyzerVersion: "1", kind: "symbol-definition", confidence: "verified", reason: "fixture syntax", span }],
    health: { status: "partial", totalFiles: 2, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 1, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: ["fixture partial"] } };
  value.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: hash(canonicalSnapshotResult(value)) }; return value;
}
function attempt(value: ProjectSnapshot): OwnershipAttempt {
  return { attemptId: `${value.snapshotId}-attempt`, repositoryId: value.repositoryId, snapshotId: value.snapshotId, questionId: "q", questionVersion: "2.0.0", concept: { id: "entry", label: "入口定位" }, questionKind: "entry", variantKey: "entry", structuredAnswer: { kind: "entry", nodeId: value.nodes[0]!.id }, citations: [{ ...value.evidence[0]!.span, evidenceId: value.evidence[0]!.id }], locationScore: 100, structureScore: 100, passed: true, scoringVersion: "2.1.0", semanticText: "自有入口证据", completedAt: "2026-02-03T00:00:00.000Z", legacy: false };
}
function seed(f: Fixture, failedB = false, emptyOverview = false) {
  const values = [snapshot("shared", "2026-03-01T00:00:00.000Z"), snapshot("a", "2026-01-01T00:00:00.000Z"), snapshot("b", "2026-06-01T00:00:00.000Z")];
  for (const [i, leaf] of leaves.entries()) {
    const db = raw(f, `source/${leaf}`), activeColumn = i !== 0 ? ",activated_at TEXT NOT NULL DEFAULT ''" : "";
    db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'frozen-1');
      CREATE TABLE snapshots(snapshot_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,root_path TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE snapshot_overviews(snapshot_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,created_at TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1${activeColumn},payload TEXT NOT NULL);
      CREATE TABLE source_snapshots(snapshot_id TEXT NOT NULL,file_path TEXT NOT NULL,content_hash TEXT NOT NULL,language TEXT NOT NULL,content TEXT NOT NULL,PRIMARY KEY(snapshot_id,file_path));
      CREATE TABLE evidence(snapshot_id TEXT NOT NULL,evidence_id TEXT NOT NULL,file_path TEXT NOT NULL,start_line INTEGER NOT NULL,start_column INTEGER NOT NULL,end_line INTEGER NOT NULL,end_column INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,evidence_id));
      CREATE TABLE mastery_records(snapshot_id TEXT NOT NULL,question_id TEXT NOT NULL,concept TEXT NOT NULL,score INTEGER NOT NULL,completed_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,question_id));
      CREATE TABLE ownership_attempts(attempt_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,concept_id TEXT NOT NULL,completed_at TEXT NOT NULL,payload TEXT NOT NULL);`);
    const value = values[i]!, master = { repositoryId: value.repositoryId, snapshotId: value.snapshotId, questionId: "old-q", concept: "old", score: 61, completedAt: "2026-01-02T00:00:00.000Z" };
    const put = (item: ProjectSnapshot, current: number, activation: string) => {
      const payload = i === 0 ? { ...item, analysisIdentity: undefined, sourceFiles: undefined } : item;
      db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run(item.snapshotId, item.repositoryId, item.rootPath, item.createdAt, JSON.stringify(payload));
      if (!(emptyOverview && i === 0)) db.prepare(`INSERT INTO snapshot_overviews(snapshot_id,repository_id,created_at,is_current,${i !== 0 ? "activated_at," : ""}payload) VALUES(?,?,?,?,${i !== 0 ? "?," : ""}?)`).run(item.snapshotId, item.repositoryId, item.createdAt, current, ...(i !== 0 ? [activation] : []), JSON.stringify(overviewFromSnapshot(item)));
      db.prepare("INSERT INTO source_snapshots VALUES(?,?,?,?,?)").run(item.snapshotId, "a.ts", hash(content), "TypeScript", content);
      const proof = item.evidence[0]!; db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?)").run(item.snapshotId, proof.id, "a.ts", 1, 0, 1, 35, JSON.stringify(proof));
    };
    put(value, 1, i === 1 ? "2026-05-01T00:00:00.000Z" : "2026-04-01T00:00:00.000Z");
    if (i === 2) put(snapshot("b-old", "2026-07-01T00:00:00.000Z"), 0, "2026-07-01T00:00:00.000Z");
    db.prepare("INSERT INTO mastery_records VALUES(?,?,?,?,?,?)").run(value.snapshotId, "old-q", "old", 61, master.completedAt, JSON.stringify(master));
    const record = attempt(value); db.prepare("INSERT INTO ownership_attempts VALUES(?,?,?,?,?,?)").run(record.attemptId, record.repositoryId, record.snapshotId, record.concept.id, record.completedAt, JSON.stringify(record));
    if (i !== 0) { db.exec("CREATE TABLE project_ignore_settings(repository_id TEXT PRIMARY KEY,payload TEXT NOT NULL); INSERT INTO schema_migrations VALUES(8,'frozen-8'),(9,'frozen-9')"); db.prepare("INSERT INTO project_ignore_settings VALUES(?,?)").run(value.repositoryId, JSON.stringify({ version: "1.0.0", revision: 3, rules: ["generated/**"] })); }
    if (failedB && i === 2) db.exec("CREATE TRIGGER reject_upgrade BEFORE INSERT ON schema_migrations WHEN NEW.version=10 BEGIN SELECT RAISE(ABORT,'fixture migration cut'); END");
    db.close();
  }
  // A is a reconstructed schema10 compatibility fixture; only during setup, before preservation.
  const a = new GraphStore(path(f, "source/projects/a.sqlite")); a.close(); const old = raw(f, "source/projects/a.sqlite"); old.exec("DROP TABLE ownership_semantic_capsules; DELETE FROM schema_migrations WHERE version=11"); old.close();
  close(f); return values;
}
function dump(db: Database): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("Fixture table rejected");
    const keys = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; pk: number }[]).filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error("Fixture column rejected");
    const rows = db.prepare(`SELECT * FROM ${name}${keys.length ? ` ORDER BY ${keys.join(",")}` : ""}`).all(); result[name] = keys.length ? rows : rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}
function inspect(f: Fixture, folder: string): Record<string, Record<string, unknown[]>> { const result: Record<string, Record<string, unknown[]>> = {}; for (const leaf of leaves) { const db = raw(f, `${folder}/${leaf}`); expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]); result[leaf] = dump(db); db.close(); } return result; }
function preserved(before: Record<string, unknown[]>, after: Record<string, unknown[]>, overviewAdded = false): void { for (const [table, rows] of Object.entries(before)) { if (table === "schema_migrations") { for (const row of rows) expect(after[table]).toContainEqual(row); continue; } if (table === "snapshot_overviews" && overviewAdded) { expect(rows).toEqual([]); expect(after[table]).toHaveLength(1); continue; } expect(after[table]?.length).toBe(rows.length); for (const [i, row] of rows.entries()) for (const [key, value] of Object.entries(row as object)) expect((after[table]![i] as Record<string, unknown>)[key]).toEqual(value); } }

describe("application upgrade fixtures: isolated copies, existing behavior only", () => {
  it("mixed global/pre9, schema10 A, schema9 B preserve precise source/history and activation ordering across restoration/reopen", async () => {
    const f = fixture(), values = seed(f), before = inspect(f, "source"), pack = preserve(f); pack.restore();
    for (const folder of ["operation", "restored"] as const) for (let restart = 0; restart < 2; restart++) {
      const app = open(f, folder); expect(app.getCurrentProject()?.snapshotId).toBe("a");
      for (const value of values) { const ref = { repositoryId: value.repositoryId, snapshotId: value.snapshotId }; expect(app.getEvidence({ ...ref, evidenceId: value.evidence[0]!.id })).toEqual({ ...value.evidence[0], repositoryId: value.repositoryId }); const ownership = await app.getOwnershipProgress(ref); expect(ownership.attempts).toContainEqual(attempt(value)); expect(ownership.attempts).toContainEqual(expect.objectContaining({ snapshotId: value.snapshotId, legacy: true, passed: false, score: 61 })); }
      close(f); const after = inspect(f, folder); for (const leaf of leaves) preserved(before[leaf]!, after[leaf]!);
      const rawA = raw(f, `${folder}/projects/a.sqlite`); expect(rawA.prepare("SELECT content,content_hash FROM source_snapshots WHERE snapshot_id='a'").get()).toEqual({ content, content_hash: hash(content) }); rawA.close();
      const b = new GraphStore(path(f, `${folder}/projects/b.sqlite`)); try { expect(b.getLatestOverview()?.snapshotId).toBe("b"); expect(b.loadSnapshot("b")?.health.status).toBe("partial"); expect(await b.loadOwnershipCapsule("b-attempt")).toEqual({ status: "legacy-capsule-absent" }); } finally { b.close(); }
      pack.unchanged();
    }
    pack.complete();
  });
  it("B migration failure is swallowed after global/A commits: visible A remains, B unavailable, whole-group success absent", () => {
    const f = fixture(); seed(f, true); const before = inspect(f, "source"), pack = preserve(f), app = open(f, "operation"); expect(app.getCurrentProject()?.snapshotId).toBe("a");
    expect(() => app.getEvidence({ repositoryId: "b", snapshotId: "b", evidenceId: "b-proof" })).toThrow(); close(f);
    const after = inspect(f, "operation"); for (const leaf of leaves) preserved(before[leaf]!, after[leaf]!);
    for (const leaf of ["global.sqlite", "projects/a.sqlite"]) expect(after[leaf]!.schema_migrations).toContainEqual(expect.objectContaining({ version: 11 }));
    expect(after["projects/b.sqlite"]!.schema_migrations).not.toContainEqual(expect.objectContaining({ version: 10 })); expect(after["projects/b.sqlite"]!.schema_migrations).toContainEqual(expect.objectContaining({ version: 7 }));
    const probe = raw(f, "operation/projects/b.sqlite"); probe.exec("BEGIN IMMEDIATE; ROLLBACK"); probe.close(); pack.restore(); expect(inspect(f, "restored")).toEqual(before); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("missing global overview is materialized on copied startup, while original package and historical payload stay immutable", () => {
    const f = fixture(); seed(f, false, true); const before = inspect(f, "source"), pack = preserve(f); pack.restore();
    for (const folder of ["operation", "restored"] as const) { const app = open(f, folder); expect(app.getCurrentProject()?.snapshotId).toBe("a"); close(f); const after = inspect(f, folder); for (const leaf of leaves) preserved(before[leaf]!, after[leaf]!, leaf === "global.sqlite"); expect((after["global.sqlite"]!.snapshot_overviews![0] as { payload: string }).payload).toContain('"status":"partial"'); pack.unchanged(); }
    pack.complete();
  });
  it("pre-open global migration failure throws; all project originals/package remain untouched and independent restore opens only raw", () => {
    const f = fixture(); seed(f); const db = raw(f, "source/global.sqlite"); db.exec("CREATE TRIGGER reject_upgrade BEFORE INSERT ON schema_migrations WHEN NEW.version=11 BEGIN SELECT RAISE(ABORT,'fixture migration cut'); END"); db.close();
    const before = inspect(f, "source"), pack = preserve(f); expect(() => open(f, "operation")).toThrow(); const after = inspect(f, "operation"); expect(after["projects/a.sqlite"]).toEqual(before["projects/a.sqlite"]); expect(after["projects/b.sqlite"]).toEqual(before["projects/b.sqlite"]);
    const global = raw(f, "operation/global.sqlite"); global.exec("BEGIN IMMEDIATE; ROLLBACK"); global.close(); pack.restore(); expect(inspect(f, "restored")).toEqual(before); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("whole-group preservation refuses writer, incomplete source and duplicate package before app construction", () => {
    const f = fixture(); seed(f); const held = raw(f, "source/projects/a.sqlite"); held.exec("BEGIN IMMEDIATE"); expect(() => preserve(f)).toThrow("writer active"); held.exec("ROLLBACK"); held.close();
    const pack = preserve(f); expect(() => preserve(f)).toThrow(); expect(f.apps).toHaveLength(0); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
    const missing = fixture(); writeFileSync(path(missing, "source/global.sqlite"), "fixture-only"); expect(() => preserve(missing)).toThrow("main missing"); expect(existsSync(path(missing, "package"))).toBe(false); expect(existsSync(path(missing, "COMPLETED"))).toBe(false);
  });
});
