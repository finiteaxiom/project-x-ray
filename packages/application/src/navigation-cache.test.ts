import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalSnapshotResult, type Evidence, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "@project-xray/graph";
import * as core from "@project-xray/analyzer-core";
import { XRayApplication, type NavigationCacheObserverSummaryV1, type NavigationCachePhaseSummaryV1 } from "./index.js";

interface RawDatabase { open: boolean; prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }; exec(sql: string): void; close(): void }
const Database = createRequire(import.meta.url)("better-sqlite3") as new (path: string) => RawDatabase;
const apps: XRayApplication[] = [], raws: RawDatabase[] = [], extraStores: GraphStore[] = [], directories: string[] = [];
interface PrivateApplication { snapshotStores: Map<string, GraphStore>; stores: Map<string, GraphStore>; legacyStore: GraphStore; navigationSlot: unknown; projectNavigationSnapshot(snapshot: ProjectSnapshot): unknown; navigationObservation: { summary: NavigationCacheObserverSummaryV1 } | null }
const inside = (app: XRayApplication) => app as unknown as PrivateApplication;
const db = (store: GraphStore) => (store as unknown as { database: RawDatabase }).database;
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) {
    const owned = new Set([inside(app).legacyStore, ...inside(app).stores.values(), ...inside(app).snapshotStores.values()]);
    try { app.close(); } catch (error) { if ([...owned].some(store => db(store).open)) throw error; }
  }
  for (const store of extraStores.splice(0)) if (db(store).open) store.close();
  for (const raw of raws.splice(0)) if (raw.open) raw.close();
  for (const directory of directories.splice(0)) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture cleanup"); await rm(directory, { recursive: true, force: true }); }
});
const code = "export function main() { return 1; }\n";
async function fixture(legacyLayout = false) {
  const base = await mkdtemp(join(tmpdir(), "xray-navigation-cache-")); directories.push(base);
  const root = join(base, "A"); await mkdir(root); await writeFile(join(root, "main.ts"), code); await writeFile(join(root, "empty.ts"), "");
  const options = { databasePath: join(base, "legacy.sqlite"), ...(!legacyLayout ? { projectDatabaseRoot: join(base, "stores") } : {}), cacheRoot: join(base, "cache") };
  const app = new XRayApplication(options); apps.push(app); const snapshot = await app.indexProject(root), ref = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId };
  expect(snapshot.health.status).toBe("ready");
  const store = inside(app).snapshotStores.get(snapshot.snapshotId)!, path = options.projectDatabaseRoot ? join(options.projectDatabaseRoot, `${ref.repositoryId}.sqlite`) : options.databasePath;
  const raw = new Database(path); raws.push(raw);
  const proof = snapshot.evidence.find(item => item.kind === "symbol-definition")!, location = { ...ref, ...proof.span, evidenceId: proof.id };
  const external = () => raw.prepare("UPDATE snapshots SET root_path=root_path || 'x' WHERE snapshot_id=?").run(ref.snapshotId);
  const sources = () => snapshot.sourceFiles.map(file => { const item = store.readSnapshotSource(snapshot.snapshotId, file.filePath)!; return { filePath: file.filePath, ...item }; });
  const save = () => store.saveSnapshot(snapshot, sources());
  return { app, options, base, root, snapshot, ref, proof, location, store, raw, path, external, sources, save };
}
function gate() { let release!: () => void, enter!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; }); return { release, enter, held, entered }; }
const sum = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + b, 0);
function relations(p: NavigationCachePhaseSummaryV1) {
  const b = p.candidateBuilds, a = p.projectionAdmission, d = { ...p.lookupDecisions.getEvidence };
  for (const key of Object.keys(d) as Array<keyof typeof d>) d[key] += p.lookupDecisions.readSource[key];
  expect(b.attempted).toBe(b.installed + b.discarded + b.rejectedByAdmission + b.failed + b.cancelled);
  expect(b.installed).toBe(d.empty_build_installed + d.external_rebuild_installed + d.local_rebuild_installed + d.combined_rebuild_installed);
  expect(b.discarded).toBe(sum(p.buildRaceReasons)); expect(b.discarded).toBe(d.build_discard_external + d.build_discard_local + d.build_discard_combined + d.build_discard_unclassified);
  expect(b.failed).toBe(d.build_error_fallback); expect(b.rejectedByAdmission).toBe(d.projection_limit_fallback);
  expect(sum(p.externalObservations.build_before)).toBe(b.attempted); expect(sum(p.externalObservations.build_after)).toBe(b.attempted);
  expect(sum(p.externalObservations.lookup_validity)).toBe(sum(d));
  expect(a.evaluatedCount).toBe(a.acceptedCount + a.overLimitCount + a.invalidCount); expect(a.overLimitCount).toBe(b.rejectedByAdmission); expect(a.invalidCount).toBeLessThanOrEqual(b.failed); expect(a.acceptedCount).toBeGreaterThanOrEqual(b.installed + b.discarded);
  let delta = 0; for (const key of ["external_only", "local_only", "both_changed"] as const) { expect(p.buildRaceReasons[key]).toBeLessThanOrEqual(p.externalObservations.build_after[key]); delta += p.externalObservations.build_after[key] - p.buildRaceReasons[key]; }
  const unavailable = ["unavailable", "invalid_type", "in_transaction", "closed"] as const;
  const v = unavailable.reduce((n, key) => n + p.externalObservations.build_after[key], 0); expect(p.buildRaceReasons.unclassified).toBeLessThanOrEqual(v);
  delta += v - p.buildRaceReasons.unclassified; expect(delta).toBeLessThanOrEqual(b.failed + b.rejectedByAdmission + b.cancelled); expect(b.installed).toBeLessThanOrEqual(p.externalObservations.build_after.unchanged);
}
async function derived(f: Awaited<ReturnType<typeof fixture>>, id: string, mutate: (snapshot: ProjectSnapshot) => void) {
  const snapshot = structuredClone(f.snapshot); snapshot.snapshotId = id; for (const item of [...snapshot.nodes, ...snapshot.edges, ...snapshot.evidence]) item.snapshotId = id;
  mutate(snapshot); snapshot.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: createHash("sha256").update(canonicalSnapshotResult(snapshot)).digest("hex") };
  f.store.saveSnapshot(snapshot, f.sources()); return { ref: { repositoryId: snapshot.repositoryId, snapshotId: id }, snapshot };
}
describe("navigation cache", () => {
  it.each([false, true])("modern actual SQLite layout legacy=%s reuses only full projection while all fresh reads remain", async legacy => {
    const f = await fixture(legacy), load = vi.spyOn(f.store, "loadSnapshot"), evidence = vi.spyOn(f.store, "getEvidence"), source = vi.spyOn(f.store, "readSnapshotSource"), settings = vi.spyOn(f.store, "loadIgnoreSettings");
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const one = f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); const first = await f.app.readSource(f.location);
    one.span.startColumn = 999; first.evidence!.span.startColumn = 999;
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).span).toEqual(f.proof.span); expect((await f.app.readSource(f.location)).evidence?.span).toEqual(f.proof.span);
    scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(load).toHaveBeenCalledTimes(1); expect(evidence).toHaveBeenCalledTimes(2); expect(source).toHaveBeenCalledTimes(2); expect(settings).toHaveBeenCalledTimes(2);
    expect(p.lookupDecisions.getEvidence.empty_build_installed).toBe(1); expect(p.lookupDecisions.readSource.hit).toBe(2); expect(p.externalObservationCoverage.complete).toBe(true); relations(p);
  });
  it("observer enabled/disabled outputs/errors match and markers are exactly two narrow probes", async () => {
    const f = await fixture(), original = f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }), source = await f.app.readSource(f.location);
    const scope = f.app.openNavigationCacheObservationV1()!; expect(f.app.openNavigationCacheObservationV1()).toBeNull();
    const sample = vi.spyOn(f.store, "sampleNavigationValidity"), load = vi.spyOn(f.store, "loadSnapshot"), read = vi.spyOn(f.store, "getEvidence"), settings = vi.spyOn(f.store, "loadIgnoreSettings"), savedSource = vi.spyOn(f.store, "readSnapshotSource");
    scope.beginPhase("coldNavigation", f.ref); scope.endPhase("coldNavigation"); expect(sample).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(settings).not.toHaveBeenCalled(); expect(savedSource).not.toHaveBeenCalled();
    scope.beginPhase("warmNavigation", f.ref); expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toEqual(original); expect(await f.app.readSource(f.location)).toEqual(source);
    expect(() => f.app.getEvidence({ ...f.ref, evidenceId: "missing" })).toThrow("证据不存在"); scope.endPhase("warmNavigation");
    expect(scope.getSummary().phases.warmNavigation.lookupDecisions.getEvidence.hit).toBe(2); expect(scope.getSummary().phases.warmNavigation.externalObservationCoverage.complete).toBe(true);
    scope.dispose(); const before = sample.mock.calls.length; expect(() => f.app.getEvidence({ ...f.ref, evidenceId: "missing" })).toThrow("证据不存在"); expect(sample.mock.calls.length - before).toBe(1);
  });
  it("external commit invalidates; rollback does not; deletion/corrupt payload cannot use old context", async () => {
    const f = await fixture(), load = vi.spyOn(f.store, "loadSnapshot"); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id });
    f.raw.exec("BEGIN IMMEDIATE"); f.external(); f.raw.exec("ROLLBACK"); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(load).toHaveBeenCalledTimes(1);
    f.external(); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(load).toHaveBeenCalledTimes(2);
    f.raw.prepare("UPDATE snapshots SET payload=? WHERE snapshot_id=?").run("broken", f.ref.snapshotId);
    expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow(); expect(inside(f.app).navigationSlot).toBeNull();
    f.raw.prepare("DELETE FROM snapshots WHERE snapshot_id=?").run(f.ref.snapshotId); expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow("项目或快照不存在");
  });
  it("local reuse invalidates and observer warm start detects it without rewriting old source/current", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation");
    const before = f.raw.prepare("SELECT * FROM snapshots").all(), sources = f.raw.prepare("SELECT * FROM source_snapshots").all(); f.save();
    scope.beginPhase("warmNavigation", f.ref); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("warmNavigation"); const p = scope.getSummary().phases.warmNavigation;
    expect(p.externalObservations.phase_start.local_only).toBe(1); expect(p.lookupDecisions.getEvidence.local_rebuild_installed).toBe(1); relations(p);
    expect(f.raw.prepare("SELECT * FROM snapshots").all()).toEqual(before); expect(f.raw.prepare("SELECT * FROM source_snapshots").all()).toEqual(sources);
  });
  it.each(["external", "local", "both"] as const)("first build real %s race discards once and next request independently installs", async kind => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const original = f.store.loadSnapshot.bind(f.store), sources = f.sources();
    vi.spyOn(f.store, "loadSnapshot").mockImplementationOnce(id => { const value = original(id); if (kind !== "local") f.external(); if (kind !== "external") f.store.saveSnapshot(f.snapshot, sources); return value; });
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id); expect(inside(f.app).navigationSlot).toBeNull();
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    const reason = kind === "external" ? "external_only" : kind === "local" ? "local_only" : "both_changed";
    expect(p.buildRaceReasons[reason]).toBe(1); expect(p.candidateBuilds).toMatchObject({ attempted: 2, discarded: 1, installed: 1 }); expect(p.externalObservations.build_after[reason]).toBe(1); relations(p);
  });
  it("failed load records real external after, preserves original error, and never becomes discard", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); const error = new Error("original fixture failure");
    vi.spyOn(f.store, "loadSnapshot").mockImplementationOnce(() => { f.external(); throw error; });
    try { f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); throw new Error("Expected failure"); } catch (caught) { expect(caught).toBe(error); }
    scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation; expect(p.candidateBuilds).toMatchObject({ failed: 1, discarded: 0 }); expect(p.projectionAdmission.evaluatedCount).toBe(0); expect(p.externalObservations.build_after.external_only).toBe(1); relations(p);
  });
  it.each(["unavailable", "invalid_type", "in_transaction", "closed"] as const)("after %s discards complete candidate as unclassified without fake outcome", async status => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const original = f.store.sampleNavigationValidity.bind(f.store); vi.spyOn(f.store, "sampleNavigationValidity").mockImplementationOnce(original).mockReturnValueOnce({ status });
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(p.candidateBuilds.discarded).toBe(1); expect(p.buildRaceReasons.unclassified).toBe(1); expect(p.externalObservations.build_after[status]).toBe(1); expect(p.externalObservationCoverage.complete).toBe(true); relations(p);
  });
  it("actual read transaction bypass and ending it restore uncached rebuild", async () => {
    const f = await fixture(); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    db(f.store).exec("BEGIN"); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(inside(f.app).navigationSlot).toBeNull(); db(f.store).exec("COMMIT");
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation; expect(p.lookupDecisions.getEvidence.transaction_bypass).toBe(1); expect(p.lookupDecisions.getEvidence.empty_build_installed).toBe(1); relations(p);
  });
  it("over-limit real persisted projection falls back once per request, with real changed after", async () => {
    const f = await fixture(), big = await derived(f, "big", value => { value.evidence[0]!.reason = "x".repeat(4_194_304); });
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", big.ref); const project = inside(f.app).projectNavigationSnapshot.bind(f.app), load = vi.spyOn(f.store, "loadSnapshot");
    vi.spyOn(inside(f.app), "projectNavigationSnapshot").mockImplementationOnce(value => { const result = project(value); f.external(); return result; });
    f.app.getEvidence({ ...big.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(load).toHaveBeenCalledTimes(1); expect(p.candidateBuilds.rejectedByAdmission).toBe(1); expect(p.externalObservations.build_after.external_only).toBe(1); expect(p.projectionAdmission).toMatchObject({ evaluatedCount: 1, overLimitCount: 1, acceptedCount: 0 }); expect(inside(f.app).navigationSlot).toBeNull(); relations(p);
  });
  it("invalid estimator fails closed, retains valid loaded result, and samples real after", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); const load = vi.spyOn(f.store, "loadSnapshot");
    vi.spyOn(inside(f.app), "projectNavigationSnapshot").mockImplementationOnce(() => { f.external(); return { status: "accepted", bytes: NaN, evidenceIndex: new Map() }; });
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(load).toHaveBeenCalledTimes(1); expect(p.candidateBuilds.failed).toBe(1); expect(p.projectionAdmission.invalidCount).toBe(1); expect(p.externalObservations.build_after.external_only).toBe(1); expect(p.buildRaceReasons.external_only).toBe(0); relations(p);
  });
  it("installed/hit disposition survives fresh evidence or range API failure", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    vi.spyOn(f.store, "getEvidence").mockReturnValueOnce(null); expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow("证据不存在");
    await expect(f.app.readSource({ ...f.location, startColumn: 999 })).rejects.toThrow(); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(p.lookupDecisions.getEvidence.empty_build_installed).toBe(1); expect(p.lookupDecisions.readSource.hit).toBe(1); expect(p.candidateBuilds.failed).toBe(0); relations(p);
  });
  it("config and workspace remain fresh on hits; empty-file exact evidence remains supported", async () => {
    const f = await fixture(); await f.app.readSource(f.location); await writeFile(join(f.root, "main.ts"), code + "// drift\n"); expect((await f.app.readSource(f.location)).workspaceStatus).toBe("stale");
    f.store.saveIgnoreSettings(f.ref.repositoryId, 0, ["main.ts"]); expect((await f.app.readSource(f.location)).workspaceStatus).toBe("unavailable");
    const empty = f.snapshot.evidence.find(item => item.kind === "file" && item.span.filePath === "empty.ts")!;
    const result = await f.app.readSource({ ...f.ref, ...empty.span, evidenceId: empty.id }); expect(result.content).toBe(""); expect(result.targetSpan).toMatchObject({ startLine: 1, startColumn: 0, endLine: 1, endColumn: 0 });
  });
  it("A→B→A and equal-number different store instances cannot borrow slots", async () => {
    const f = await fixture(), other = await derived(f, "B", () => {}), load = vi.spyOn(f.store, "loadSnapshot");
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); f.app.getEvidence({ ...other.ref, evidenceId: f.proof.id }); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(load).toHaveBeenCalledTimes(3);
    const replacement = new GraphStore(f.path, "project"); extraStores.push(replacement); inside(f.app).snapshotStores.set(f.ref.snapshotId, replacement);
    const previous = inside(f.app).navigationSlot as { sample: ReturnType<GraphStore["sampleNavigationValidity"]> }; vi.spyOn(replacement, "sampleNavigationValidity").mockReturnValue(previous.sample);
    const reload = vi.spyOn(replacement, "loadSnapshot"); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(reload).toHaveBeenCalledTimes(1);
  });
  it("overlapping readSource captures original project and returns independent evidence after slot switch", async () => {
    const f = await fixture(), rootB = join(f.base, "B"); await mkdir(rootB); await writeFile(join(rootB, "main.ts"), "export function other() { return 2; }\n"); const b = await f.app.indexProject(rootB), proofB = b.evidence.find(item => item.kind === "symbol-definition")!;
    const g = gate(), original = core.readProjectFile; vi.spyOn(core, "readProjectFile").mockImplementationOnce(async (...args) => { g.enter(); await g.held; return original(...args); });
    const location = { ...f.location }, pending = f.app.readSource(location); await g.entered;
    location.filePath = "late.ts"; f.app.getEvidence({ repositoryId: b.repositoryId, snapshotId: b.snapshotId, evidenceId: proofB.id }); g.release();
    const result = await pending; expect(result.repositoryId).toBe(f.ref.repositoryId); expect(result.filePath).toBe("main.ts"); expect(result.content).toBe(code); expect(result.evidence?.id).toBe(f.proof.id);
  });
  it("scope request phase capture, pending-end gap, old disposal and new summary isolation", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const g = gate(), original = core.readProjectFile; vi.spyOn(core, "readProjectFile").mockImplementationOnce(async (...args) => { g.enter(); await g.held; return original(...args); });
    const pending = f.app.readSource(f.location); await g.entered; scope.endPhase("coldNavigation"); g.release(); await pending;
    scope.beginPhase("warmNavigation", f.ref); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("warmNavigation");
    const summary = scope.getSummary(); expect(summary.phases.coldNavigation.lookupDecisions.readSource.empty_build_installed).toBe(1); expect(summary.phases.coldNavigation.externalObservationCoverage.complete).toBe(false); expect(summary.phases.warmNavigation.lookupDecisions.readSource.hit).toBe(0);
    expect(Object.isFrozen(summary.phases.warmNavigation.lookupDecisions.getEvidence)).toBe(true); scope.dispose(); scope.dispose(); const next = f.app.openNavigationCacheObservationV1()!; next.beginPhase("coldNavigation", f.ref); next.endPhase("coldNavigation"); expect(scope.getSummary()).toEqual(summary); expect(next.getSummary().phases.coldNavigation.lookupDecisions.getEvidence.hit).toBe(0);
  });
  it("legacy normalized payload bypasses without projection or candidate probes", async () => {
    const f = await fixture(true), payload = structuredClone(f.snapshot) as Partial<ProjectSnapshot>; delete payload.analysisIdentity; delete payload.sourceFiles;
    f.raw.prepare("UPDATE snapshots SET payload=? WHERE snapshot_id=?").run(JSON.stringify(payload), f.ref.snapshotId);
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const load = vi.spyOn(f.store, "loadSnapshot"), sample = vi.spyOn(f.store, "sampleNavigationValidity"), project = vi.spyOn(inside(f.app), "projectNavigationSnapshot");
    for (let i = 0; i < 2; i++) expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id);
    expect(load).toHaveBeenCalledTimes(2); expect(sample).toHaveBeenCalledTimes(2); expect(project).not.toHaveBeenCalled(); expect(inside(f.app).navigationSlot).toBeNull();
    scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation; expect(p.lookupDecisions.getEvidence.legacy_bypass).toBe(2); expect(p.candidateBuilds.attempted).toBe(0); relations(p);
  });
  it.each(["external", "local", "both"] as const)("rebuild %s race uses its own before/after and drops former slot", async kind => {
    const f = await fixture(); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); f.external();
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); const original = f.store.loadSnapshot.bind(f.store), sources = f.sources();
    vi.spyOn(f.store, "loadSnapshot").mockImplementationOnce(id => { const result = original(id); if (kind !== "local") f.external(); if (kind !== "external") f.store.saveSnapshot(f.snapshot, sources); return result; });
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(inside(f.app).navigationSlot).toBeNull(); scope.endPhase("coldNavigation");
    const p = scope.getSummary().phases.coldNavigation, reason = kind === "external" ? "external_only" : kind === "local" ? "local_only" : "both_changed";
    expect(p.buildRaceReasons[reason]).toBe(1); expect(p.candidateBuilds).toMatchObject({ attempted: 1, discarded: 1, installed: 0 }); relations(p);
  });
  it.each(["unavailable", "invalid_type", "in_transaction", "closed"] as const)("lookup %s bypass preserves full load error without a candidate", async status => {
    const f = await fixture(); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    vi.spyOn(f.store, "sampleNavigationValidity").mockReturnValueOnce({ status }); const error = new Error("original bypass error"); vi.spyOn(f.store, "loadSnapshot").mockImplementationOnce(() => { throw error; });
    try { f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); throw new Error("Expected failure"); } catch (caught) { expect(caught).toBe(error); }
    expect(inside(f.app).navigationSlot).toBeNull(); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    const decision = status === "unavailable" ? "token_unavailable_bypass" : status === "invalid_type" ? "invalid_token_bypass" : status === "in_transaction" ? "transaction_bypass" : "store_closed_error";
    expect(p.lookupDecisions.getEvidence[decision]).toBe(1); expect(p.candidateBuilds.attempted).toBe(0); relations(p);
  });
  it("throwing actual probe marks missing coverage while successful original fallback survives", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    vi.spyOn(f.store, "sampleNavigationValidity").mockImplementationOnce(() => { throw new Error("probe fault"); });
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(p.lookupDecisions.getEvidence.token_unavailable_bypass).toBe(1); expect(p.externalObservationCoverage.checkpoints.lookup_validity).toBe(false); expect(p.externalObservationCoverage.complete).toBe(false); relations(p);
  });
  it("wrong repository and missing ID fail without caching; wrong payload ID retains fallback but cannot install", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    expect(() => f.app.getEvidence({ ...f.ref, repositoryId: "wrong", evidenceId: f.proof.id })).toThrow("项目或快照不存在");
    expect(() => f.app.getEvidence({ ...f.ref, snapshotId: "missing", evidenceId: f.proof.id })).toThrow("项目或快照不存在"); expect(inside(f.app).navigationSlot).toBeNull();
    const wrong = await derived(f, "different", () => {}); f.raw.prepare("UPDATE snapshots SET payload=? WHERE snapshot_id=?").run(JSON.stringify(wrong.snapshot), f.ref.snapshotId);
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id); expect(inside(f.app).navigationSlot).toBeNull(); scope.endPhase("coldNavigation");
    const p = scope.getSummary().phases.coldNavigation; expect(p.candidateBuilds.failed).toBe(3); expect(p.projectionAdmission.evaluatedCount).toBe(0); expect(p.externalObservationCoverage.complete).toBe(false); relations(p);
  });
  it("single estimator reports exact serialized projection bytes, including inclusive limit", async () => {
    const f = await fixture(), project = inside(f.app).projectNavigationSnapshot.bind(f.app), snapshot = structuredClone(f.snapshot); snapshot.evidence = [snapshot.evidence[0]!];
    const bytes = () => Buffer.byteLength(JSON.stringify({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, rootPath: snapshot.rootPath, evidence: snapshot.evidence }), "utf8");
    expect(project(snapshot)).toMatchObject({ status: "accepted", bytes: bytes() }); snapshot.evidence[0]!.reason = "";
    snapshot.evidence[0]!.reason = "x".repeat(4_194_304 - bytes()); expect(bytes()).toBe(4_194_304); expect(project(snapshot)).toMatchObject({ status: "accepted", bytes: 4_194_304 });
    snapshot.evidence[0]!.reason += "x"; expect(project(snapshot)).toEqual({ status: "over_limit" });
  });
  it("dispose with pending request isolates later settlement from new scope", async () => {
    const f = await fixture(), old = f.app.openNavigationCacheObservationV1()!; old.beginPhase("coldNavigation", f.ref);
    const g = gate(), original = core.readProjectFile; vi.spyOn(core, "readProjectFile").mockImplementationOnce(async (...args) => { g.enter(); await g.held; return original(...args); });
    const pending = f.app.readSource(f.location); await g.entered; old.dispose(); const frozen = old.getSummary(), next = f.app.openNavigationCacheObservationV1()!;
    next.beginPhase("coldNavigation", f.ref); f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); next.endPhase("coldNavigation"); g.release(); await pending;
    expect(old.getSummary()).toEqual(frozen); expect(frozen.phases.coldNavigation.externalObservationCoverage.complete).toBe(false); expect(next.getSummary().phases.coldNavigation.lookupDecisions.readSource.hit).toBe(0); expect(next.getSummary().phases.coldNavigation.externalObservationCoverage.complete).toBe(true);
  });
  it("wrong phase sequence and counter overflow keep summaries finite and do not alter product", async () => {
    const f = await fixture(), invalid = f.app.openNavigationCacheObservationV1()!; invalid.beginPhase("warmNavigation", f.ref);
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id); expect(invalid.getSummary().phases.warmNavigation.externalObservationCoverage.complete).toBe(false); invalid.dispose();
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); inside(f.app).navigationObservation!.summary.phases.coldNavigation.lookupDecisions.getEvidence.hit = Number.MAX_SAFE_INTEGER;
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }).id).toBe(f.proof.id); scope.endPhase("coldNavigation"); const summary = scope.getSummary(); expect(summary.phases.coldNavigation.externalObservationCoverage.complete).toBe(false);
    const visit = (value: unknown): void => { if (typeof value === "number") expect(Number.isSafeInteger(value) && value >= 0).toBe(true); else if (value && typeof value === "object") for (const item of Object.values(value)) visit(item); }; visit(summary);
    expect(Object.keys(scope).sort()).toEqual(["beginPhase", "dispose", "endPhase", "getSummary"]);
  });
  it("faulted counters cannot emit NaN, additional fields or product data", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    const admission = inside(f.app).navigationObservation!.summary.phases.coldNavigation.projectionAdmission;
    admission.acceptedBytesTotal = NaN; (admission as unknown as Record<string, unknown>).privatePath = f.root;
    const result = scope.getSummary(); expect(result.phases.coldNavigation.projectionAdmission.acceptedBytesTotal).toBe(0); expect(JSON.stringify(result)).not.toContain(f.root);
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); scope.endPhase("coldNavigation"); expect(scope.getSummary().phases.coldNavigation.externalObservationCoverage.complete).toBe(false);
  });
  it("enabled and disabled candidates use identical real probes and single estimator", async () => {
    const f = await fixture(), sample = vi.spyOn(f.store, "sampleNavigationValidity"), project = vi.spyOn(inside(f.app), "projectNavigationSnapshot"), load = vi.spyOn(f.store, "loadSnapshot");
    const disabled = f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); expect(sample).toHaveBeenCalledTimes(2); expect(project).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledTimes(1);
    inside(f.app).navigationSlot = null; const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    expect(f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toEqual(disabled); scope.endPhase("coldNavigation");
    expect(sample).toHaveBeenCalledTimes(6); expect(project).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledTimes(2); relations(scope.getSummary().phases.coldNavigation);
  });
  it("source failure after installation and settings failure after hit preserve resolver disposition", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref);
    vi.spyOn(f.store, "readSnapshotSource").mockReturnValueOnce(null); await expect(f.app.readSource(f.location)).rejects.toThrow("该快照没有保存此源码文件");
    vi.spyOn(f.store, "loadIgnoreSettings").mockImplementationOnce(() => { throw new Error("settings unavailable"); }); expect((await f.app.readSource(f.location)).workspaceStatus).toBe("unavailable");
    scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation; expect(p.lookupDecisions.readSource).toMatchObject({ empty_build_installed: 1, hit: 1 }); expect(p.candidateBuilds.failed).toBe(0); relations(p);
  });
  it("original known/project/legacy fallback keeps selected connection and never admits another connection's payload", async () => {
    const f = await fixture(), empty = new GraphStore(); extraStores.push(empty); inside(f.app).snapshotStores.set(f.ref.snapshotId, empty);
    const scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); const selected = vi.spyOn(empty, "loadSnapshot"), fallback = vi.spyOn(f.store, "loadSnapshot");
    expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow("证据不存在"); expect(selected).toHaveBeenCalledTimes(1); expect(fallback).toHaveBeenCalledTimes(1); expect(inside(f.app).navigationSlot).toBeNull();
    scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation; expect(p.candidateBuilds.failed).toBe(1); expect(p.projectionAdmission.evaluatedCount).toBe(0); relations(p);
  });
  it.each(["unavailable", "invalid_type", "in_transaction", "closed"] as const)("failed candidate retains %s actual after without race discard", async status => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; scope.beginPhase("coldNavigation", f.ref); const real = f.store.sampleNavigationValidity.bind(f.store);
    vi.spyOn(f.store, "sampleNavigationValidity").mockImplementationOnce(real).mockReturnValueOnce({ status }); vi.spyOn(f.store, "loadSnapshot").mockImplementationOnce(() => { throw new Error("candidate failure"); });
    expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow("candidate failure"); scope.endPhase("coldNavigation"); const p = scope.getSummary().phases.coldNavigation;
    expect(p.candidateBuilds).toMatchObject({ failed: 1, discarded: 0 }); expect(p.externalObservations.build_after[status]).toBe(1); expect(p.externalObservationCoverage.complete).toBe(true); relations(p);
  });
  it("marker never lazily opens stores; close invalidates scope and never serves cached success", async () => {
    const f = await fixture(), scope = f.app.openNavigationCacheObservationV1()!; const count = inside(f.app).stores.size, load = vi.spyOn(GraphStore.prototype, "loadSnapshot");
    scope.beginPhase("coldNavigation", { repositoryId: "unknown", snapshotId: "unknown" }); scope.endPhase("coldNavigation"); expect(inside(f.app).stores.size).toBe(count); expect(load).not.toHaveBeenCalled(); scope.dispose();
    f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id }); const closing = f.app.openNavigationCacheObservationV1()!; closing.beginPhase("coldNavigation", f.ref); f.app.close();
    expect(inside(f.app).navigationSlot).toBeNull(); expect(f.app.openNavigationCacheObservationV1()).toBeNull(); expect(() => f.app.getEvidence({ ...f.ref, evidenceId: f.proof.id })).toThrow(); expect(closing.getSummary().phases.coldNavigation.externalObservationCoverage.complete).toBe(false);
  });
});
