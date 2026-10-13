import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, unlinkSync, realpathSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { canonicalSnapshotResult, canonicalSnapshotContent, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "@project-xray/graph";
import { PythonAnalyzer } from "@project-xray/analyzer-python";
import { XRayApplication, type IndexOptions } from "./index.js";

type Work = Parameters<NonNullable<IndexOptions["onIndexWork"]>>[0];
interface RawDatabase { open: boolean; prepare(sql: string): { get(...args: unknown[]): unknown; run(...args: unknown[]): unknown }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new (file: string) => RawDatabase;
const apps: XRayApplication[] = [], dbs: RawDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const a of apps.splice(0)) a.close(); for (const d of dbs.splice(0)) if (d.open) d.close(); });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "xray-python-reuse-"))), root = join(base, "source"); mkdirSync(root);
  writeFileSync(join(root, "a.py"), "from b import target as alias\ndef caller(x):\n    return alias(x)\n");
  writeFileSync(join(root, "b.py"), "def target(x):\n    return x\n");
  writeFileSync(join(root, "c.py"), "def third():\n    return 3\n");
  const open = (name = "hot") => { const app = new XRayApplication({ databasePath: join(base, `${name}.sqlite`), projectDatabaseRoot: join(base, name), cacheRoot: join(base, "cache") }); apps.push(app); return app; };
  const close = (app: XRayApplication) => { apps.splice(apps.indexOf(app), 1); app.close(); };
  return { base, root, open, close };
}
async function indexed(app: XRayApplication, root: string, extra: IndexOptions = {}) { let work!: Work; const snapshot = await app.indexProject(root, "local", { ...extra, onIndexWork: w => { work = w; extra.onIndexWork?.(w); } }); return { snapshot, work }; }
function equivalent(a: ProjectSnapshot, b: ProjectSnapshot) { expect(a.snapshotId).toBe(b.snapshotId); expect(canonicalSnapshotResult(a)).toBe(canonicalSnapshotResult(b)); expect(canonicalSnapshotContent(a)).toBe(canonicalSnapshotContent(b)); }

describe("ordinary index persistent Python parse reuse", () => {
  it("Git working comparison keeps both complete Python sides cold despite a primed ordinary bank", async () => {
    const f = fixture(); for (const args of [["init"], ["config", "user.name", "fixture"], ["config", "user.email", "fixture@example.invalid"], ["add", "."], ["commit", "-m", "owned fixture"]]) execFileSync("git", args, { cwd: f.root, stdio: "pipe" }); const a = f.open(), initial = await indexed(a, f.root); expect((await indexed(a, f.root)).work.hits).toBe(2);
    const project = vi.spyOn(PythonAnalyzer.prototype, "analyzeProject"), single = vi.spyOn(PythonAnalyzer.prototype, "analyze"); await a.createChangeReport({ repositoryId: initial.snapshot.repositoryId, snapshotId: initial.snapshot.snapshotId, mode: "working", maxDepth: 2, maxPaths: 10, maxWork: 500 }); expect(project.mock.calls).toHaveLength(2); expect(project.mock.calls.every(call => call[0].length === 3 && call[2] === undefined)).toBe(true); expect(single.mock.calls).toHaveLength(6);
  });
  it("warm material does not bypass a junction swapped between discovery and opening", async () => {
    const f = fixture(), nested = join(f.root, "nested"), saved = join(f.root, "saved"), outside = join(f.base, "outside"); mkdirSync(nested); mkdirSync(outside); const target = join(nested, "entry.py"); writeFileSync(target, "def inside():\n    return 1\n"); writeFileSync(join(outside, "entry.py"), "def outside_secret():\n    return 2\n"); let a = f.open(); const before = await indexed(a, f.root); f.close(a); a = f.open(); const analyzed = vi.spyOn(PythonAnalyzer.prototype, "analyzeProject"); let swapped = false, externalBytes = 0;
    await expect(a.indexProject(f.root, "local", { testOnlySecureReadHooks: { beforeOpen: p => { if (p === target && !swapped) { renameSync(nested, saved); symlinkSync(outside, nested, "junction"); swapped = true; } }, onReadChunk: (p, bytes) => { if (p === target) externalBytes += bytes; } } })).rejects.toMatchObject({ code: "ERR_PROJECT_PATH_SECURITY" }); expect(swapped).toBe(true); expect(externalBytes).toBe(0); expect(analyzed).not.toHaveBeenCalled(); expect(a.getCurrentProject()?.snapshotId).toBe(before.snapshot.snapshotId);
    const db = new Database(join(f.base, "hot", `${before.snapshot.repositoryId}.sqlite`)); dbs.push(db); expect(db.prepare("SELECT count(*) n FROM snapshots").get()).toEqual({ n: 1 }); expect(db.prepare("SELECT count(*) n FROM analysis_parse_cache").get()).toEqual({ n: 4 });
  });
  it("cancels an actual probe before publication with no cache mutation", async () => {
    const f = fixture(), a = f.open(); const before = await indexed(a, f.root); const controller = new AbortController(), original = PythonAnalyzer.prototype.analyzeProject;
    vi.spyOn(PythonAnalyzer.prototype, "analyzeProject").mockImplementation(function(this: PythonAnalyzer, ...args) { queueMicrotask(() => controller.abort()); return original.apply(this, args); });
    await expect(a.indexProject(f.root, "local", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" }); expect(a.getCurrentProject()?.snapshotId).toBe(before.snapshot.snapshotId); const db = new Database(join(f.base, "hot", `${before.snapshot.repositoryId}.sqlite`)); dbs.push(db); expect(db.prepare("SELECT count(*) n FROM snapshots").get()).toEqual({ n: 1 }); expect(db.prepare("SELECT count(*) n FROM analysis_parse_cache").get()).toEqual({ n: 3 });
  });
  it("cache BUSY after a real graph commit keeps the committed result and old bank intact", async () => {
    const f = fixture(), a = f.open(); const before = await indexed(a, f.root); const db = new Database(join(f.base, "hot", `${before.snapshot.repositoryId}.sqlite`)); dbs.push(db); writeFileSync(join(f.root, "c.py"), "def third():\n    return 9\n"); const original = GraphStore.prototype.saveSnapshot;
    vi.spyOn(GraphStore.prototype, "saveSnapshot").mockImplementation(function(this: GraphStore, ...args) { const saved = original.apply(this, args); db.exec("BEGIN IMMEDIATE"); return saved; });
    try { const after = await indexed(a, f.root); expect(after.snapshot.snapshotId).not.toBe(before.snapshot.snapshotId); expect(after.work.cachePublished).toBe(false); expect(a.getCurrentProject()?.snapshotId).toBe(after.snapshot.snapshotId); expect(db.prepare("SELECT count(*) n FROM analysis_parse_cache WHERE producer_snapshot_id=?").get(before.snapshot.snapshotId)).toEqual({ n: 3 }); } finally { db.exec("ROLLBACK"); }
  });
  it("actual missing interpreter/worker failure and recovery cannot reuse an old success", async () => {
    const f = fixture(); let a = f.open(); const good = await indexed(a, f.root); f.close(a); const originalPath = process.env.PATH!;
    vi.stubEnv("PATH", f.base); a = f.open(); const missing = await indexed(a, f.root); expect(missing.snapshot.health.status).toBe("partial"); expect(missing.work).toMatchObject({ hits: 0, workerRequests: 3 }); f.close(a); vi.stubEnv("PATH", originalPath);
    a = f.open(); const recovered = await indexed(a, f.root); equivalent(good.snapshot, recovered.snapshot); expect(recovered.work.workerRequests).toBe(3); f.close(a);
    const badWorker = join(f.base, "bad-worker.py"); writeFileSync(badWorker, "raise RuntimeError('fixed test failure')\n"); vi.stubEnv("XRAY_PYTHON_ANALYZER", badWorker); a = f.open(); const failed = await indexed(a, f.root); expect(failed.work.hits).toBe(0); expect(failed.snapshot.health.status).toBe("partial"); f.close(a); vi.unstubAllEnvs();
    const changedWorker = join(f.base, "worker-copy.py"); writeFileSync(changedWorker, readFileSync(resolve("packages/analyzer-python/python/analyze.py"), "utf8") + "\n# trusted test worker version change\n"); vi.stubEnv("XRAY_PYTHON_ANALYZER", changedWorker); a = f.open(); const changed = await indexed(a, f.root); expect(changed.work.workerRequests).toBe(3); equivalent(good.snapshot, changed.snapshot); f.close(a); a = f.open(); expect((await indexed(a, f.root)).work.hits).toBe(2);
  });
  it("configuration and same-size source changes miss; concurrent config/source drift cannot publish", async () => {
    const f = fixture(); let a = f.open(); const old = await indexed(a, f.root); f.close(a); writeFileSync(join(f.root, "tsconfig.json"), '{"compilerOptions":{"strict":true}}'); a = f.open(); const config = await indexed(a, f.root); expect(config.work.hits).toBe(0); f.close(a);
    writeFileSync(join(f.root, "c.py"), "def third():\n    return 4\n"); a = f.open(); const changed = await indexed(a, f.root); expect(changed.work).toMatchObject({ hits: 2, workerRequests: 1 }); expect(changed.snapshot.snapshotId).not.toBe(config.snapshot.snapshotId);
    const second = new GraphStore(join(f.base, "hot", `${old.snapshot.repositoryId}.sqlite`));
    try { await expect(a.indexProject(f.root, "local", { onProgress: p => { if (p.phase === "persisting") second.saveIgnoreSettings(old.snapshot.repositoryId, 0, ["c.py"]); } })).rejects.toMatchObject({ diagnosticCode: "IGNORE_SETTINGS_CONFLICT" }); } finally { second.close(); }
    expect(a.getCurrentProject()?.snapshotId).toBe(changed.snapshot.snapshotId); f.close(a); a = f.open(); const ignored = await indexed(a, f.root); expect(ignored.snapshot.sourceFiles.some(s => s.filePath === "c.py")).toBe(false); expect(ignored.work.hits).toBe(0);
    const controller = new AbortController(); await expect(a.indexProject(f.root, "local", { signal: controller.signal, onProgress: p => { if (p.phase === "analyzing") controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    await expect(a.indexProject(f.root, "local", { onProgress: p => { if (p.phase === "verifying") writeFileSync(join(f.root, "b.py"), "def target(x):\n    return 2\n"); } })).rejects.toMatchObject({ diagnosticCode: "INDEX_SOURCE_CHANGED" }); expect(a.getCurrentProject()?.snapshotId).toBe(ignored.snapshot.snapshotId);
  });
  it("keeps cached lexical and cyclic bindings equal to full analysis after target changes", async () => {
    const f = fixture(); writeFileSync(join(f.root, "c.py"), "from a import caller as cycle\ndef third(xs):\n    def inner(x):\n        return x\n    for x in xs:\n        inner(x)\n    try:\n        return [inner(x) for x in xs]\n    except Exception as e:\n        return e\n"); writeFileSync(join(f.root, "d.py"), "def managed(manager):\n    with manager as value:\n        return value\n");
    let a = f.open(); await indexed(a, f.root); f.close(a); writeFileSync(join(f.root, "b.py"), "from c import third\ndef target(x):\n    return third(x)\n"); a = f.open(); const hot = await indexed(a, f.root); expect(hot.work).toMatchObject({ workerRequests: 1, hits: 3 }); equivalent(hot.snapshot, (await indexed(f.open("oracle"), f.root, { testOnlyDisablePythonParseCache: true })).snapshot);
  });
  it("does not share sessions between attempts or projects and restores A-B-A after restart", async () => {
    const f = fixture(), a = f.open(); const first = await indexed(a, f.root); const rootB = join(f.base, "source-b"); mkdirSync(rootB); writeFileSync(join(rootB, "only.py"), "def other():\n    return 2\n"); const other = await indexed(a, rootB); expect(other.work).toMatchObject({ workerRequests: 1, hits: 0 }); f.close(a);
    let reopened = f.open(); const back = await indexed(reopened, f.root); equivalent(first.snapshot, back.snapshot); expect(back.work.hits).toBe(2); f.close(reopened); reopened = f.open(); expect(reopened.getCurrentProject()?.snapshotId).toBe(first.snapshot.snapshotId);
    const parallel = await Promise.all([indexed(reopened, f.root), indexed(reopened, f.root)]); for (const r of parallel) { equivalent(first.snapshot, r.snapshot); expect(r.work.workerRequests).toBe(1); }
    const closed = f.open("closing"); await expect(closed.indexProject(f.root, "local", { onProgress: p => { if (p.phase === "verifying") f.close(closed); } })).rejects.toThrow("Application closed"); expect(f.open("closing").getCurrentProject()).toBeNull();
  });
  it("reopens a new application, probes one real file and preserves immutable snapshot/source", async () => {
    const f = fixture(); let a = f.open(); const cold = await indexed(a, f.root); expect(cold.work.workerRequests).toBe(3); expect(cold.work.cachePublished).toBe(true); f.close(a);
    a = f.open(); const warm = await indexed(a, f.root); equivalent(cold.snapshot, warm.snapshot); expect(warm.work).toMatchObject({ workerRequests: 1, hits: 2, normalizedFiles: 3, semanticPasses: 1, capturedFiles: 3, verifiedFiles: 3 }); expect(warm.snapshot.createdAt).toBe(cold.snapshot.createdAt);
    const oracle = await indexed(f.open("oracle"), f.root, { testOnlyDisablePythonParseCache: true }); equivalent(warm.snapshot, oracle.snapshot);
    const db = new Database(join(f.base, "hot", `${cold.snapshot.repositoryId}.sqlite`)); dbs.push(db); expect(db.prepare("SELECT content FROM source_snapshots WHERE snapshot_id=? AND file_path='a.py'").get(cold.snapshot.snapshotId)).toEqual({ content: readFileSync(join(f.root, "a.py"), "utf8") });
  });
  it("matches cold facts after edit/add/delete/rename and re-resolves an unchanged caller", async () => {
    const f = fixture(); let a = f.open(); const old = await indexed(a, f.root); f.close(a);
    const states = [() => writeFileSync(join(f.root, "b.py"), "@wrap\ndef target(x):\n    return x\n"), () => writeFileSync(join(f.root, "d.py"), "from a import caller\ndef more(x):\n    return caller(x)\n"), () => unlinkSync(join(f.root, "c.py")), () => renameSync(join(f.root, "b.py"), join(f.root, "renamed.py"))];
    for (const [i, mutate] of states.entries()) { mutate(); a = f.open(); const hot = await indexed(a, f.root); const full = await indexed(f.open(`oracle-${i}`), f.root, { testOnlyDisablePythonParseCache: true }); equivalent(hot.snapshot, full.snapshot); expect(hot.work.hits).toBeGreaterThan(0); if (i === 0) expect(hot.snapshot.edges.some(e => e.kind === "CALLS" && e.confidence === "unknown" && e.reason.includes("装饰器"))).toBe(true); f.close(a); }
    const db = new Database(join(f.base, "hot", `${old.snapshot.repositoryId}.sqlite`)); dbs.push(db); expect(db.prepare("SELECT content FROM source_snapshots WHERE snapshot_id=? AND file_path='b.py'").get(old.snapshot.snapshotId)).toEqual({ content: "def target(x):\n    return x\n" });
  });
  it("syntax failure clears the bank and recovery never masks partial facts", async () => {
    const f = fixture(); let a = f.open(); await indexed(a, f.root); f.close(a); writeFileSync(join(f.root, "b.py"), "def broken(:\n");
    a = f.open(); const failed = await indexed(a, f.root); expect(failed.snapshot.health.status).toBe("partial"); expect(failed.work.hits).toBe(0); f.close(a);
    writeFileSync(join(f.root, "b.py"), "def target(x):\n    return x\n"); a = f.open(); const recovered = await indexed(a, f.root); expect(recovered.work.workerRequests).toBe(3); equivalent(recovered.snapshot, (await indexed(f.open("oracle"), f.root, { testOnlyDisablePythonParseCache: true })).snapshot);
  });
  it("corrupt cache digest/schema/origin and oversized payload fail to cold facts", async () => {
    const f = fixture(); let a = f.open(); const first = await indexed(a, f.root); f.close(a); const db = new Database(join(f.base, "hot", `${first.snapshot.repositoryId}.sqlite`)); dbs.push(db);
    db.prepare("UPDATE analysis_parse_cache SET payload='{}',digest='bad' WHERE file_path='a.py'").run(); db.prepare("UPDATE analysis_parse_cache SET producer_snapshot_id='absent' WHERE file_path='b.py'").run(); db.prepare("UPDATE analysis_parse_cache SET payload=? WHERE file_path='c.py'").run("x".repeat(1024 * 1024 + 1));
    a = f.open(); const result = await indexed(a, f.root); expect(result.work).toMatchObject({ workerRequests: 3, hits: 0 }); equivalent(first.snapshot, result.snapshot);
  });
  it("rejects persisting callback abort before the commit and returns committed late abort/observer failure", async () => {
    const f = fixture(), a = f.open(); const old = await indexed(a, f.root); writeFileSync(join(f.root, "b.py"), "def target(x):\n    return 77\n"); const controller = new AbortController();
    await expect(a.indexProject(f.root, "local", { signal: controller.signal, onProgress: p => { if (p.phase === "persisting") controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" }); expect(a.getCurrentProject()?.snapshotId).toBe(old.snapshot.snapshotId); f.close(a); const reopened = f.open(); expect(reopened.getCurrentProject()?.snapshotId).toBe(old.snapshot.snapshotId);
    const late = new AbortController(), original = GraphStore.prototype.saveSnapshot; vi.spyOn(GraphStore.prototype, "saveSnapshot").mockImplementation(function(this: GraphStore, ...args) { const result = original.apply(this, args); late.abort(); return result; }); vi.spyOn(GraphStore.prototype, "publishAnalysisParseCache").mockImplementation(() => { throw new Error("cache failed"); });
    const committed = await reopened.indexProject(f.root, "local", { signal: late.signal, onIndexWork: () => { throw new Error("observer failed"); } }); expect(committed.snapshotId).not.toBe(old.snapshot.snapshotId); expect(reopened.getCurrentProject()?.snapshotId).toBe(committed.snapshotId); f.close(reopened); expect(f.open().getCurrentProject()?.snapshotId).toBe(committed.snapshotId);
  });
  it("keeps TS full and single Python worker count unchanged, and legacy/global bypasses storage", async () => {
    const f = fixture(); unlinkSync(join(f.root, "a.py")); unlinkSync(join(f.root, "b.py")); writeFileSync(join(f.root, "module.ts"), "export function x() { return 1; }\n"); let a = f.open(); await indexed(a, f.root); f.close(a); a = f.open(); const mixed = await indexed(a, f.root); expect(mixed.work).toMatchObject({ workerRequests: 1, hits: 0, typeScriptProgramCalls: 1, typeScriptInputFiles: 1 });
    unlinkSync(join(f.root, "c.py")); const ts = await indexed(a, f.root); expect(ts.work).toMatchObject({ workerRequests: 0, hits: 0, typeScriptProgramCalls: 1 });
    const legacy = new XRayApplication({ databasePath: join(f.base, "legacy.sqlite"), cacheRoot: join(f.base, "cache") }); apps.push(legacy); await indexed(legacy, f.root); const db = new Database(join(f.base, "legacy.sqlite")); dbs.push(db); expect(db.prepare("SELECT name FROM sqlite_master WHERE name='analysis_parse_cache'").get()).toBeUndefined();
  });
});
