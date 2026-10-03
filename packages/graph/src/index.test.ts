import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { GRAPH_QUERY_VERSION, MODULE_OVERVIEW_VERSION, type GraphQueryRequest, type OwnershipAttempt, type ProjectSnapshot } from "@project-xray/contracts";
import { GraphStore } from "./index.js";

const snapshot: ProjectSnapshot = {
  repositoryId: "repo", snapshotId: "snap", name: "sample", rootPath: "C:/sample", sourceType: "local", createdAt: "2026-01-01T00:00:00.000Z",
  analysisIdentity: { graphIrVersion: "1", analyzerVersions: { test: "1" }, configurationHash: "c", sourceFingerprint: "f" }, sourceFiles: [],
  health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] },
  evidence: ["ev", "ev2", "ev3", "ev4"].map((id, index) => ({ id, snapshotId: "snap", analyzer: "test", analyzerVersion: "1", kind: "call", confidence: id === "ev4" ? "unknown" as const : "verified" as const, reason: "test", span: { filePath: "a.ts", startLine: 1, startColumn: index, endLine: 1, endColumn: index + 1 } })),
  nodes: [
    { id: "module", snapshotId: "snap", kind: "module", name: "src", qualifiedName: "src", metadata: {} },
    { id: "file", snapshotId: "snap", kind: "file", name: "a.ts", qualifiedName: "a.ts", filePath: "a.ts", metadata: {} },
    { id: "a", snapshotId: "snap", kind: "function", name: "a", qualifiedName: "a", metadata: {} },
    { id: "b", snapshotId: "snap", kind: "function", name: "b", qualifiedName: "b", metadata: {} },
    { id: "c", snapshotId: "snap", kind: "function", name: "c", qualifiedName: "c", metadata: {} },
    { id: "unknown", snapshotId: "snap", kind: "unresolved-call", name: "dynamic", qualifiedName: "dynamic", metadata: { unresolved: true } },
  ],
  edges: [
    { id: "contains", snapshotId: "snap", source: "module", target: "file", kind: "CONTAINS", confidence: "verified", evidenceId: "ev", reason: "group" },
    { id: "defines", snapshotId: "snap", source: "file", target: "a", kind: "DEFINES", confidence: "verified", evidenceId: "ev", reason: "define" },
    { id: "defines-c", snapshotId: "snap", source: "file", target: "c", kind: "DEFINES", confidence: "verified", evidenceId: "ev", reason: "define" },
    { id: "edge", snapshotId: "snap", source: "a", target: "b", kind: "CALLS", confidence: "verified", evidenceId: "ev", reason: "test" },
    { id: "cycle", snapshotId: "snap", source: "b", target: "a", kind: "CALLS", confidence: "verified", evidenceId: "ev2", reason: "recursive" },
    { id: "branch", snapshotId: "snap", source: "a", target: "c", kind: "CALLS", confidence: "verified", evidenceId: "ev3", reason: "branch" },
    { id: "unresolved", snapshotId: "snap", source: "c", target: "unknown", kind: "CALLS", confidence: "unknown", evidenceId: "ev4", reason: "dynamic", unresolvedTarget: "factory()" },
    { id: "read", snapshotId: "snap", source: "a", target: "c", kind: "READS", confidence: "verified", evidenceId: "ev3", reason: "read" },
  ],
};

describe("navigation validity samples", () => {
  const stores: GraphStore[] = [], connections: Database.Database[] = [], directories: string[] = [];
  const open = (path?: string) => { const store = new GraphStore(path); stores.push(store); return store; };
  const db = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
  const valid = (store: GraphStore) => { const value = store.sampleNavigationValidity(); expect(value.status).toBe("valid"); if (value.status !== "valid") throw new Error("Expected valid sample"); return value; };
  afterEach(async () => {
    vi.restoreAllMocks(); for (const store of stores.splice(0)) if (db(store).open) store.close();
    for (const connection of connections.splice(0)) if (connection.open) connection.close();
    for (const directory of directories.splice(0)) { if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe fixture cleanup"); await rm(directory, { recursive: true, force: true }); }
  });
  async function pair() {
    const directory = await mkdtemp(join(tmpdir(), "xray-navigation-token-")); directories.push(directory);
    const path = join(directory, "graph.sqlite"), store = open(path), second = new Database(path); connections.push(second); second.pragma("busy_timeout=10");
    return { store, second };
  }
  it("initial and same-connection successful save/reuse/activation/noncurrent generations are stable", () => {
    const store = open(), initial = valid(store); expect(valid(store)).toEqual(initial);
    store.saveSnapshot(snapshot); const first = valid(store); expect(first.localSnapshotGeneration).toBe(initial.localSnapshotGeneration + 1); expect(first.dataVersion).toBe(initial.dataVersion);
    const activation = store.getCurrentActivation(); store.saveSnapshot(snapshot); const reused = valid(store);
    expect(reused.localSnapshotGeneration).toBe(first.localSnapshotGeneration + 1); expect(store.getCurrentActivation()).not.toBe(activation);
    store.saveSnapshot(snapshot, [], false); expect(valid(store).localSnapshotGeneration).toBe(reused.localSnapshotGeneration + 1);
    const side = structuredClone(snapshot); side.snapshotId = "side"; for (const item of [...side.nodes, ...side.edges, ...side.evidence]) item.snapshotId = "side";
    const beforeSide = valid(store); store.saveSnapshot(side, [], false);
    expect(valid(store).localSnapshotGeneration).toBe(beforeSide.localSnapshotGeneration + 1); expect(store.getActiveReference()?.snapshotId).toBe("snap");
  });
  it("failed actual SQLite INSERT rolls back without announcing a successful generation", () => {
    const store = open(), before = valid(store);
    db(store).exec("CREATE TRIGGER deny_navigation_snapshot BEFORE INSERT ON snapshots BEGIN SELECT RAISE(ABORT,'private fixture SQL'); END");
    expect(() => store.saveSnapshot(snapshot)).toThrow(); expect(store.loadSnapshot("snap")).toBeNull(); expect(valid(store).localSnapshotGeneration).toBe(before.localSnapshotGeneration);
    db(store).exec("DROP TRIGGER deny_navigation_snapshot"); store.saveSnapshot(snapshot); const saved = valid(store);
    expect(() => store.saveSnapshot({ ...snapshot, name: "conflict" })).toThrow(); expect(valid(store)).toEqual(saved); expect(store.loadSnapshot("snap")?.name).toBe(snapshot.name);
  });
  it("another SQLite connection commit/delete changes dataVersion; rollback does not", async () => {
    const { store, second } = await pair(); store.saveSnapshot(snapshot); const before = valid(store);
    second.exec("BEGIN IMMEDIATE"); second.prepare("UPDATE snapshots SET root_path=? WHERE snapshot_id=?").run("changed", "snap"); second.exec("ROLLBACK"); expect(valid(store)).toEqual(before);
    second.prepare("UPDATE snapshots SET root_path=? WHERE snapshot_id=?").run("changed", "snap"); const committed = valid(store);
    expect(committed.dataVersion).not.toBe(before.dataVersion); expect(committed.localSnapshotGeneration).toBe(before.localSnapshotGeneration);
    second.prepare("DELETE FROM snapshots WHERE snapshot_id=?").run("snap"); expect(valid(store).dataVersion).not.toBe(committed.dataVersion);
  });
  it("read transaction has zero PRAGMA; after ending it observes external commit", async () => {
    const { store, second } = await pair(); store.saveSnapshot(snapshot); const before = valid(store);
    db(store).exec("BEGIN"); db(store).prepare("SELECT count(*) FROM snapshots").get();
    const pragma = vi.spyOn(db(store), "pragma"); second.prepare("UPDATE snapshots SET root_path=? WHERE snapshot_id=?").run("changed", "snap");
    expect(store.sampleNavigationValidity()).toEqual({ status: "in_transaction" }); expect(pragma).not.toHaveBeenCalled();
    db(store).exec("COMMIT"); expect(valid(store).dataVersion).not.toBe(before.dataVersion); expect(pragma).toHaveBeenCalledTimes(1);
  });
  it("samples only one pragma with no snapshot/source/config reads or SQL writes", () => {
    const store = open(), prepare = vi.spyOn(db(store), "prepare"), exec = vi.spyOn(db(store), "exec"), pragma = vi.spyOn(db(store), "pragma");
    valid(store); expect(pragma).toHaveBeenCalledExactlyOnceWith("data_version", { simple: true }); expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it.each([undefined, NaN, Infinity, -Infinity, "1", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, 1n, true, {}, []])("invalid pragma type/value (%#) fails closed", value => {
    const store = open(); vi.spyOn(db(store), "pragma").mockReturnValueOnce(value as never); expect(store.sampleNavigationValidity()).toEqual({ status: "invalid_type" });
  });
  it("safe dataVersion endpoints remain valid; exceptions reveal no SQLite error", () => {
    const store = open(), pragma = vi.spyOn(db(store), "pragma");
    for (const value of [0, Number.MAX_SAFE_INTEGER]) { pragma.mockReturnValueOnce(value as never); expect(valid(store).dataVersion).toBe(value); }
    pragma.mockImplementationOnce(() => { throw new Error("private SQL text"); }); expect(store.sampleNavigationValidity()).toEqual({ status: "unavailable" }); expect(valid(store).status).toBe("valid");
  });
  it("closed store samples without pragma; new instance may have identical numbers", () => {
    const a = open(), b = open(), first = valid(a); expect(valid(b)).toEqual(first); expect(a).not.toBe(b);
    first.localSnapshotGeneration = 999; first.dataVersion = 999; expect(valid(a)).toEqual(valid(b));
    a.close(); const pragma = vi.spyOn(db(a), "pragma"); expect(a.sampleNavigationValidity()).toEqual({ status: "closed" }); expect(pragma).not.toHaveBeenCalled();
  });
  it("generation upper bound never wraps or resumes comparability", () => {
    const store = open(); Reflect.set(store, "navigationGeneration", Number.MAX_SAFE_INTEGER - 2);
    store.saveSnapshot(snapshot); expect(valid(store).localSnapshotGeneration).toBe(Number.MAX_SAFE_INTEGER - 1);
    store.saveSnapshot(snapshot); expect(store.sampleNavigationValidity()).toEqual({ status: "unavailable" });
    store.saveSnapshot(snapshot, [], false); expect(store.sampleNavigationValidity()).toEqual({ status: "unavailable" });
  });
  it.each(["COMMIT", "ROLLBACK"] as const)("nested savepoint cannot announce outer %s; only a new store can compare again", async terminal => {
    const { store } = await pair(), path = db(store).name, source = { filePath: "a.ts", contentHash: "hash", language: "TypeScript", content: "abc" };
    db(store).exec("BEGIN IMMEDIATE"); expect(store.saveSnapshot(snapshot, [source])).toEqual(snapshot);
    expect(store.sampleNavigationValidity()).toEqual({ status: "in_transaction" }); db(store).exec(terminal);
    expect(store.sampleNavigationValidity()).toEqual({ status: "unavailable" });
    if (terminal === "ROLLBACK") { expect(store.loadSnapshot("snap")).toBeNull(); expect(store.readSnapshotSource("snap", "a.ts")).toBeNull(); }
    else { expect(store.loadSnapshot("snap")).toEqual(snapshot); expect(store.readSnapshotSource("snap", "a.ts")?.content).toBe(source.content); }
    store.saveSnapshot(snapshot, [source]); expect(store.sampleNavigationValidity()).toEqual({ status: "unavailable" });
    store.close(); const reopened = open(path); expect(reopened).not.toBe(store); expect(valid(reopened).localSnapshotGeneration).toBe(0);
    expect(reopened.loadSnapshot("snap")).toEqual(snapshot); expect(reopened.readSnapshotSource("snap", "a.ts")?.content).toBe(source.content);
  });
});

describe("graph", () => {
  it("事务化保存并读取快照", () => {
    const store = new GraphStore();
    store.saveSnapshot(snapshot, [{ filePath: "a.ts", contentHash: "hash", language: "TypeScript", content: "a()" }]);
    expect(store.loadSnapshot("snap")?.nodes).toHaveLength(6);
    expect(store.readSnapshotSource("snap", "a.ts")?.content).toBe("a()");
    store.close();
  });

  it("按方向、关系视图、置信度和预算稳定查询，并保留未知目标", () => {
    const store = new GraphStore(); store.saveSnapshot(snapshot);
    const base: GraphQueryRequest = { version: GRAPH_QUERY_VERSION, repositoryId: "repo", snapshotId: "snap", rootNodeIds: ["a"], view: "call", direction: "outgoing", maxDepth: 3, maxNodes: 10, maxEdges: 10, maxWork: 20, confidences: ["verified", "inferred", "unknown"] };
    const result = store.queryGraph(base);
    expect(result.edges.map((edge) => edge.id)).toEqual(["edge", "branch", "cycle", "unresolved"]);
    expect(result.edges.some((edge) => edge.kind === "CONTAINS" || edge.kind === "READS")).toBe(false);
    expect(result.unresolved).toContainEqual(expect.objectContaining({ edgeId: "unresolved", target: "factory()" }));
    const incoming = store.queryGraph({ ...base, rootNodeIds: ["b"], direction: "incoming", maxDepth: 1 });
    expect(incoming.edges.map((edge) => edge.id)).toEqual(["edge"]);
    const filtered = store.queryGraph({ ...base, confidences: ["verified"] }); expect(filtered.edges.map((edge) => edge.id)).not.toContain("unresolved");
    const limited = store.queryGraph({ ...base, maxNodes: 2, maxEdges: 1 }); expect(limited.truncated).toBe(true); expect(limited.truncationReasons.length).toBeGreaterThan(0); expect(limited.continuationCursor).toBeTruthy();
    expect(() => store.queryGraph({ ...base, snapshotId: "other", continuationCursor: limited.continuationCursor })).toThrow();
    store.close();
  });

  it("重开数据库后按需搜索、模块和证据查询仍可用", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-query-db-")); const databasePath = join(directory, "graph.sqlite");
    let store = new GraphStore(databasePath); store.saveSnapshot(snapshot, [{ filePath: "a.ts", contentHash: "hash", language: "TypeScript", content: "abc" }]); store.close();
    store = new GraphStore(databasePath); const search = store.search({ repositoryId: "repo", snapshotId: "snap", query: "a", kinds: ["function"], limit: 10 });
    expect(search.items.map((node) => node.id)).toContain("a"); expect(store.listModules({ repositoryId: "repo", snapshotId: "snap", query: "", limit: 10 }).items[0]?.fileCount).toBe(1); expect(store.getEvidence("snap", "ev")?.id).toBe("ev");
    store.close(); await rm(directory, { recursive: true, force: true });
  });

  it("保留并兼容读取旧版共享数据库快照", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-legacy-db-")); const databasePath = join(directory, "legacy.sqlite");
    const database = new Database(databasePath); database.exec("CREATE TABLE snapshots(snapshot_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL, root_path TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)");
    const legacy = { ...snapshot, analysisIdentity: undefined, sourceFiles: undefined, health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, failedFiles: [], languageCounts: { TypeScript: 1 } } };
    database.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run("snap", "repo", "C:/sample", snapshot.createdAt, JSON.stringify(legacy)); database.close();
    const store = new GraphStore(databasePath); const loaded = store.getLatestSnapshot();
    expect(loaded?.analysisIdentity.graphIrVersion).toBe("legacy-1.0"); expect(loaded?.health.status).toBe("partial"); expect(loaded?.sourceFiles).toEqual([]);
    store.close(); await rm(directory, { recursive: true, force: true });
  });

  it("迁移后追加保存所有权尝试并在重开后保留历史", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-ownership-db-")); const databasePath = join(directory, "ownership.sqlite");
    const attempt: OwnershipAttempt = { repositoryId: "repo", snapshotId: "snap", attemptId: "attempt-1", questionId: "question", questionVersion: "2.0.0", concept: { id: "call:a:b", label: "a → b" }, questionKind: "call-direction", variantKey: "edge:a-b", structuredAnswer: { kind: "call-direction", callerNodeId: "b", calleeNodeId: "a" }, citations: [], locationScore: 100, structureScore: 0, passed: false, scoringVersion: "2.0.0", semanticText: "本地学习记录", completedAt: "2026-09-21T00:00:00.000Z", legacy: false };
    let store = new GraphStore(databasePath); store.saveOwnershipAttempt(attempt); store.saveOwnershipAttempt({ ...attempt, attemptId: "attempt-2", structuredAnswer: { kind: "call-direction", callerNodeId: "a", calleeNodeId: "b" }, structureScore: 100, passed: true, completedAt: "2026-09-21T00:01:00.000Z" }); store.close();
    store = new GraphStore(databasePath); const attempts = store.listOwnershipAttempts("repo"); expect(attempts.map((item) => item.attemptId)).toEqual(["attempt-1", "attempt-2"]); expect(attempts.map((item) => item.passed)).toEqual([false, true]); store.close(); await rm(directory, { recursive: true, force: true });
  });

  it("重开数据库时把旧版变更报告明确降级为 partial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "xray-legacy-report-db-")); const databasePath = join(directory, "legacy-report.sqlite");
    let store = new GraphStore(databasePath); store.close();
    const side = { label: "HEAD", kind: "commit", revision: "a".repeat(40), contentFingerprint: "content", manifestFingerprint: "config", capturedAt: "2026-01-01T00:00:00.000Z", snapshot: { repositoryId: "repo", snapshotId: "snap" }, analysisIdentity: { graphIrVersion: "1", analyzerVersions: {}, configurationHash: "config", sourceFingerprint: "content" } };
    const legacy = { version: "1.0.0", id: "old-report", repositoryId: "repo", mode: "staged", createdAt: "2026-01-01T00:00:00.000Z", left: side, right: { ...side, kind: "index", revision: undefined }, captureFingerprint: "capture", status: "current", files: [], impactPaths: [], truncated: false, truncationReasons: [], failures: [], limitations: [] };
    const database = new Database(databasePath); database.prepare("INSERT INTO change_reports(report_id,repository_id,created_at,capture_fingerprint,payload) VALUES(?,?,?,?,?)").run(legacy.id, legacy.repositoryId, legacy.createdAt, legacy.captureFingerprint, JSON.stringify(legacy)); database.close();
    store = new GraphStore(databasePath); const loaded = store.loadChangeReport(legacy.id);
    expect(loaded?.version).toBe("1.1.0"); expect(loaded?.completeness.status).toBe("partial"); expect(loaded?.left.completeness.limitations).toContain("旧版 1.0.0 报告未保存分析完整性，不能认定为完整");
    store.close(); await rm(directory, { recursive: true, force: true });
  });

  it("在数据库二维范围内查询文件后部证据，并显式分页", () => {
    const many = Array.from({ length: 620 }, (_, index) => ({ id: `bulk-${index}`, snapshotId: "snap", analyzer: "test", analyzerVersion: "1", kind: "definition", confidence: "verified" as const, reason: "bulk", span: { filePath: "long.ts", startLine: index + 1, startColumn: index % 4, endLine: index + 1, endColumn: index % 4 + 1 } }));
    const store = new GraphStore(); store.saveSnapshot({ ...snapshot, evidence: [...snapshot.evidence, ...many] });
    const result = store.findEvidence("repo", "snap", { filePath: "long.ts", startLine: 610, startColumn: 0, endLine: 621, endColumn: 0 }, 5);
    expect(result.total).toBe(11); expect(result.items[0]?.id).toBe("bulk-609"); expect(result.truncated).toBe(true); expect(result.nextCursor).toBeTruthy();
    const second = store.findEvidence("repo", "snap", { filePath: "long.ts", startLine: 610, startColumn: 0, endLine: 621, endColumn: 0 }, 10, result.nextCursor);
    expect(new Set([...result.items, ...second.items].map((item) => item.id)).size).toBe(11); store.close();
  });

  it("模块聚合统计不受 500 边限制，样本与完整数量分开", () => {
    const nodes = [...snapshot.nodes, { id: "module-b", snapshotId: "snap", kind: "module" as const, name: "b", qualifiedName: "b", metadata: {} }, { id: "file-b", snapshotId: "snap", kind: "file" as const, name: "b.ts", qualifiedName: "b.ts", filePath: "b.ts", metadata: {} }];
    const edges = [...snapshot.edges, { id: "contains-b", snapshotId: "snap", source: "module-b", target: "file-b", kind: "CONTAINS" as const, confidence: "verified" as const, evidenceId: "ev", reason: "group" }]; const evidence = [...snapshot.evidence];
    for (let index = 0; index < 620; index += 1) { const source = `source-${index}`; const target = `target-${index}`; nodes.push({ id: source, snapshotId: "snap", kind: "function", name: source, qualifiedName: source, filePath: "a.ts", metadata: {} }, { id: target, snapshotId: "snap", kind: "function", name: target, qualifiedName: target, filePath: "b.ts", metadata: {} }); edges.push({ id: `define-a-${index}`, snapshotId: "snap", source: "file", target: source, kind: "DEFINES", confidence: "verified", evidenceId: "ev", reason: "define" }, { id: `define-b-${index}`, snapshotId: "snap", source: "file-b", target, kind: "DEFINES", confidence: "verified", evidenceId: "ev", reason: "define" }, { id: `cross-${String(index).padStart(4, "0")}`, snapshotId: "snap", source, target, kind: "CALLS", confidence: index % 2 ? "inferred" : "verified", evidenceId: "ev", reason: "cross" }); }
    const store = new GraphStore(); store.saveSnapshot({ ...snapshot, nodes, edges, evidence }); const expanded = store.expandModule({ repositoryId: "repo", snapshotId: "snap", moduleId: "module", limit: 5 }); const relation = expanded.relations.find((item) => item.targetModuleId === "module-b")!;
    expect(expanded.nodes.every((node) => node.kind === "file")).toBe(true);
    expect(relation.edgeCount).toBe(620); expect(relation.confidences).toEqual({ inferred: 310, verified: 310 }); expect(relation.sampledEdgeCount).toBe(20); expect(relation.evidenceTruncated).toBe(true);
    const overview = store.getModuleOverview({ version: MODULE_OVERVIEW_VERSION, repositoryId: "repo", snapshotId: "snap", query: "", limit: 40, relationLimit: 20, referenceLimit: 20 }); const aggregate = overview.relations.find((item) => item.sourceModuleId === "module" && item.targetModuleId === "module-b");
    expect(overview.modules.map((item) => item.id)).toEqual(["module-b", "module"]); expect(aggregate?.edgeCount).toBe(620); expect(aggregate?.confidences).toEqual({ inferred: 310, verified: 310 }); expect(aggregate?.edges).toEqual([]);
    const page = store.listModuleRelationEdges({ repositoryId: "repo", snapshotId: "snap", sourceModuleId: "module", targetModuleId: "module-b", limit: 50 }); expect(page.total).toBe(620); expect(page.nextCursor).toBeTruthy(); store.close();
  });

  it("目录模块、未解析模块引用和外部依赖保持分类，并只聚合真实方向", () => {
    const unresolved = { id: "style-ref", snapshotId: "snap", kind: "module" as const, name: "./styles.css", qualifiedName: "./styles.css", metadata: { unresolved: true } };
    const edge = { id: "style-import", snapshotId: "snap", source: "a", target: "style-ref", kind: "IMPORTS" as const, confidence: "unknown" as const, evidenceId: "ev4", reason: "未解析相对引用", unresolvedTarget: "./styles.css" };
    const external = { id: "external-package", snapshotId: "snap", kind: "external-dependency" as const, name: "zod", qualifiedName: "zod", metadata: { unresolved: true } };
    const externalEdge = { id: "external-import", snapshotId: "snap", source: "a", target: "external-package", kind: "IMPORTS" as const, confidence: "unknown" as const, evidenceId: "ev4", reason: "外部依赖" };
    const store = new GraphStore(); store.saveSnapshot({ ...snapshot, nodes: [...snapshot.nodes, unresolved, external], edges: [...snapshot.edges, edge, externalEdge] });
    const overview = store.getModuleOverview({ version: MODULE_OVERVIEW_VERSION, repositoryId: "repo", snapshotId: "snap", query: "", limit: 40, relationLimit: 20, referenceLimit: 20 });
    expect(store.getOverview("snap")?.counts.modules).toBe(1); expect(overview.modules.map((item) => item.id)).toEqual(["module"]); expect(overview.references).toContainEqual(expect.objectContaining({ id: "style-ref", category: "unresolved-module", relationCount: 1 })); expect(overview.references).toContainEqual(expect.objectContaining({ id: "external-package", category: "external-dependency" })); expect(overview.references).toContainEqual(expect.objectContaining({ id: "unknown", category: "unresolved-call" })); expect(overview.relations).toEqual([]); store.close();
  });

  it("按精确文件分页搜索超过 80 个符号且不串入相似路径", () => {
    const targetNodes = Array.from({ length: 125 }, (_, index) => ({ id: `target-symbol-${index}`, snapshotId: "snap", kind: "function" as const, name: `symbol-${String(index).padStart(3, "0")}`, qualifiedName: `src/a.ts:symbol-${String(index).padStart(3, "0")}`, filePath: "src/a.ts", metadata: {} }));
    const similarNodes = Array.from({ length: 20 }, (_, index) => ({ id: `similar-symbol-${index}`, snapshotId: "snap", kind: "function" as const, name: `symbol-${String(index).padStart(3, "0")}`, qualifiedName: `src/a.tsx:symbol-${String(index).padStart(3, "0")}`, filePath: "src/a.tsx", metadata: {} }));
    const store = new GraphStore(); store.saveSnapshot({ ...snapshot, nodes: [...snapshot.nodes, ...targetNodes, ...similarNodes] }); const found: string[] = []; let cursor: string | undefined;
    do { const page = store.search({ repositoryId: "repo", snapshotId: "snap", query: "", kinds: ["function"], filePath: "src/a.ts", limit: 50, ...(cursor ? { cursor } : {}) }); found.push(...page.items.map((item) => item.id)); cursor = page.nextCursor; } while (cursor);
    expect(found).toHaveLength(125); expect(found).toContain("target-symbol-124"); expect(found.some((id) => id.startsWith("similar"))).toBe(false);
    const located = store.search({ repositoryId: "repo", snapshotId: "snap", query: "symbol-119", kinds: ["function"], filePath: "src/a.ts", limit: 10 }); expect(located.items.map((item) => item.id)).toEqual(["target-symbol-119"]);
    const first = store.search({ repositoryId: "repo", snapshotId: "snap", query: "", kinds: ["function"], filePath: "src/a.ts", limit: 10 }); expect(() => store.search({ repositoryId: "repo", snapshotId: "snap", query: "", kinds: ["function"], filePath: "src/a.tsx", limit: 10, cursor: first.nextCursor })).toThrow(/筛选条件/); store.close();
  });

  it("连续游标页不漏边、不重复，并严格绑定完整查询", () => {
    const nodes = [...snapshot.nodes]; const edges = [...snapshot.edges]; for (let index = 0; index < 25; index += 1) { nodes.push({ id: `fan-${index}`, snapshotId: "snap", kind: "function", name: `fan${index}`, qualifiedName: `fan${index}`, metadata: {} }); edges.push({ id: `fan-edge-${String(index).padStart(2, "0")}`, snapshotId: "snap", source: "a", target: `fan-${index}`, kind: "CALLS", confidence: "verified", evidenceId: "ev", reason: "fan" }); }
    const store = new GraphStore(); store.saveSnapshot({ ...snapshot, nodes, edges }); const base: GraphQueryRequest = { version: GRAPH_QUERY_VERSION, repositoryId: "repo", snapshotId: "snap", rootNodeIds: ["a"], view: "call", direction: "outgoing", maxDepth: 2, maxNodes: 5, maxEdges: 4, maxWork: 4, confidences: ["verified", "inferred", "unknown"] }; const ids: string[] = []; let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) { const result = store.queryGraph({ ...base, ...(cursor ? { continuationCursor: cursor } : {}) }); ids.push(...result.edges.map((edge) => edge.id)); cursor = result.continuationCursor; if (!cursor) break; }
    expect(new Set(ids).size).toBe(ids.length); expect(ids).toContain("fan-edge-24"); expect(() => store.queryGraph({ ...base, repositoryId: "other", continuationCursor: cursor ?? "invalid" })).toThrow();
    const exact = store.queryGraph({ ...base, rootNodeIds: ["b"], direction: "incoming", maxDepth: 1, maxNodes: 2, maxEdges: 1, maxWork: 1 }); expect(exact.truncationReasons).not.toContain("work"); expect(exact.truncationReasons).toContain("depth"); store.close();
  });
});
