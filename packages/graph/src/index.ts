import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { RemoteExplanationStore, type GraphStoreRole } from "./remote-explanation-store.js";
import { OwnershipCapsuleStore, OwnershipCapsuleStoreError, type OwnershipCapsuleWriteInput, type OwnershipSourceCapture, type PreparedOwnershipWrite, type OwnershipCapsuleRead, type OwnershipSemanticPackageRead } from "./ownership-capsule-store.js";
export type { OwnershipSemanticPackageRead } from "./ownership-capsule-store.js";
export { RemoteExplanationStore, remoteStoreFailure, type GraphStoreRole } from "./remote-explanation-store.js";
import {
  canonicalJson, canonicalSnapshotContent, canonicalSnapshotResult, IGNORE_POLICY_VERSION, projectIgnoreSettingsSchema, ignoreRulesSchema, SafeDiagnosticError, type ProjectIgnoreSettings,
  analysisIdentitySchema, indexHealthSchema, sourceFileIdentitySchema, graphNodeSchema, RemoteExplanationError,
  GRAPH_QUERY_VERSION, MODULE_OVERVIEW_VERSION, parseChangeReport, graphQueryRequestSchema, projectOverviewSchema, projectSnapshotSchema,
  type ChangeReport, type EvidenceRangeResponse,
  type Evidence, type FlowResult, type GraphEdge, type GraphNode, type GraphQueryRequest, type GraphQueryResponse, type MasteryRecord, type OwnershipAttempt,
  type ModuleExpansionRequest, type ModuleExpansionResponse, type ModuleListRequest, type ModuleListResponse, type ModuleOverviewRequest, type ModuleOverviewResponse, type ModuleRelationEdgesRequest, type ModuleRelationEdgesResponse,
  type ProjectOverview, type ProjectSnapshot, type SearchRequest, type SearchResponse,
} from "@project-xray/contracts";

interface StoredSnapshotRow { payload: string }
interface StoredSourceRow { content: string; content_hash: string; language: string }
interface CountRow { count: number }
interface PayloadRow { payload: string }
interface CursorQueueItem { nodeId: string; depth: number; afterEdgeId?: string }
interface CursorState { version: 2; repositoryId: string; snapshotId: string; queryKey: string; queue: CursorQueueItem[]; seenNodes: string[] }

/** Compare only while retaining the same GraphStore instance; never an IPC or persistent identity. */
export type NavigationValiditySample = { status: "valid"; dataVersion: number; localSnapshotGeneration: number }
  | { status: "unavailable" | "invalid_type" | "in_transaction" | "closed" };

function parseStoredSnapshot(payload: string): ProjectSnapshot {
  const raw: unknown = JSON.parse(payload);
  const parsed = projectSnapshotSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!raw || typeof raw !== "object") throw new Error("快照数据无效");
  const legacy = raw as Record<string, unknown>;
  if (legacy.analysisIdentity && typeof legacy.analysisIdentity === "object" && "ignorePolicy" in legacy.analysisIdentity) throw new SafeDiagnosticError("IGNORE_SETTINGS_INVALID");
  const health = legacy.health && typeof legacy.health === "object" ? legacy.health as Record<string, unknown> : {};
  return projectSnapshotSchema.parse({
    ...legacy,
    analysisIdentity: { graphIrVersion: "legacy-1.0", analyzerVersions: {}, configurationHash: "unknown", sourceFingerprint: String(legacy.snapshotId ?? "unknown") },
    sourceFiles: [],
    health: { ...health, status: "partial", unsupportedFiles: Number(health.unsupportedFiles ?? 0), ignoredByRule: Array.isArray(health.ignoredByRule) ? health.ignoredByRule : [], limitations: [...(Array.isArray(health.limitations) ? health.limitations : []), "旧版快照未保存不可变源码；请更新索引后使用证据导航"] },
  });
}

export class GraphStore {
  private readonly database: Database.Database;
  readonly remote: RemoteExplanationStore;
  private readonly ownershipCapsules: OwnershipCapsuleStore;
  private navigationGeneration: number | null = null;

  constructor(databasePath = ":memory:", role: GraphStoreRole = "project") {
    if (role !== "global" && role !== "project") throw new RemoteExplanationError("POLICY_INVALID");
    this.database = new Database(databasePath);
    this.remote = new RemoteExplanationStore(this.database, role);
    this.ownershipCapsules = new OwnershipCapsuleStore(this.database, this);
    try {
      this.database.pragma("busy_timeout = 250");
      this.database.pragma("journal_mode = WAL");
      this.migrate(); this.remote.migrate(); this.ownershipCapsules.migrate();
      this.navigationGeneration = 0;
    } catch (error) { this.database.close(); throw error; }
  }

  /** A same-connection observation, not an atomic source/configuration freshness barrier. */
  sampleNavigationValidity(): NavigationValiditySample {
    try {
      if (!this.database.open) return { status: "closed" };
      if (this.database.inTransaction) return { status: "in_transaction" };
      const generation = this.navigationGeneration;
      if (generation === null || !Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER) return { status: "unavailable" };
      const dataVersion: unknown = this.database.pragma("data_version", { simple: true });
      if (typeof dataVersion !== "number" || !Number.isSafeInteger(dataVersion) || dataVersion < 0) return { status: "invalid_type" };
      return { status: "valid", dataVersion, localSnapshotGeneration: generation };
    } catch { return { status: "unavailable" }; }
  }

  getActiveReference(): { repositoryId: string; snapshotId: string; activation: string } | null {
    return this.database.prepare("SELECT repository_id repositoryId,snapshot_id snapshotId,activated_at activation FROM snapshot_overviews WHERE is_current=1 ORDER BY activated_at DESC,snapshot_id LIMIT 1").get() as { repositoryId: string; snapshotId: string; activation: string } | undefined ?? null;
  }

  remoteSnapshotMetadata(repositoryId: string, snapshotId: string): { analysisIdentity: ProjectSnapshot["analysisIdentity"]; health: ProjectSnapshot["health"] } {
    const row = this.database.prepare("SELECT repository_id repositoryId,json_extract(payload,'$.analysisIdentity') identity,json_extract(payload,'$.health') health FROM snapshots WHERE snapshot_id=?").get(snapshotId) as { repositoryId: string; identity: string; health: string } | undefined;
    if (!row || row.repositoryId !== repositoryId) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
    return { analysisIdentity: analysisIdentitySchema.parse(JSON.parse(row.identity)), health: indexHealthSchema.parse(JSON.parse(row.health)) };
  }

  remoteSourceManifest(snapshotId: string, filePaths: readonly string[]): ProjectSnapshot["sourceFiles"] {
    if (filePaths.length > 80) throw new RemoteExplanationError("LIMIT_EXCEEDED");
    return filePaths.map(filePath => {
      const row = this.database.prepare("SELECT file_path filePath,content_hash contentHash,length(CAST(content AS BLOB)) bytes,language FROM source_snapshots WHERE snapshot_id=? AND file_path=?").get(snapshotId, filePath);
      if (!row) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT"); return sourceFileIdentitySchema.parse(row);
    });
  }

  remoteNodeEvidence(snapshotId: string, node: GraphNode): Evidence[] {
    const parsed = graphNodeSchema.parse(node);
    if (parsed.evidenceId) { const proof = this.getEvidence(snapshotId, parsed.evidenceId); return proof ? [proof] : []; }
    if (!parsed.span) return [];
    const range = parsed.span;
    const rows = this.database.prepare("SELECT payload FROM evidence WHERE snapshot_id=? AND file_path=? AND start_line=? AND start_column=? AND end_line=? AND end_column=? ORDER BY evidence_id LIMIT 8").all(snapshotId, range.filePath, range.startLine, range.startColumn, range.endLine, range.endColumn) as PayloadRow[];
    return rows.map(row => JSON.parse(row.payload) as Evidence);
  }

  withExplanationRevisions<T>(identity: import("@project-xray/contracts").RemoteCapturedIdentity, settings: GraphStore, source: GraphStore, work: () => T): T {
    if (this.remote.role !== "global") throw new RemoteExplanationError("POLICY_INVALID");
    // Fixed order: authority -> project settings -> legacy/source/result. No async work here.
    return this.remote.immediate(() => settings.withIgnoreRevision(identity.repositoryId, identity.ignoreRevision, () => source.remote.immediate(() => {
      this.remote.assertIdentity(identity, settings, source.remote); return work();
    })));
  }

  discardFailedExplanation(identity: import("@project-xray/contracts").RemoteCapturedIdentity, settings: GraphStore, source: GraphStore): void {
    if (this.remote.role !== "global") throw new RemoteExplanationError("POLICY_INVALID");
    this.remote.immediate(() => {
      const task = this.remote.task(identity.taskId);
      if (!task || task.phase === "dispatched" || canonicalJson(task.identity) !== canonicalJson(identity)) throw new RemoteExplanationError("POLICY_INVALID");
      if (task.phase === "completed") return; // Successful append-only history is never compensated.
      settings.remote.immediate(() => source.remote.immediate(() => source.remote.discardUnpublishedResult(identity)));
    });
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        snapshot_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_repository ON snapshots(repository_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS nodes (
        snapshot_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        file_path TEXT,
        payload TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_snapshot_kind ON nodes(snapshot_id, kind);
      CREATE INDEX IF NOT EXISTS idx_nodes_snapshot_name ON nodes(snapshot_id, name);
      CREATE TABLE IF NOT EXISTS edges (
        snapshot_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        confidence TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, edge_id)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(snapshot_id, source_id, kind);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(snapshot_id, target_id, kind);
      CREATE TABLE IF NOT EXISTS evidence (
        snapshot_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        start_column INTEGER NOT NULL DEFAULT 0,
        end_line INTEGER NOT NULL DEFAULT 0,
        end_column INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, evidence_id)
      );
      CREATE TABLE IF NOT EXISTS source_snapshots (
        snapshot_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        language TEXT NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, file_path)
      );
      CREATE TABLE IF NOT EXISTS mastery_records (
        snapshot_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        concept TEXT NOT NULL,
        score INTEGER NOT NULL,
        completed_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS ownership_attempts (
        attempt_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ownership_attempts_repository ON ownership_attempts(repository_id, completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ownership_attempts_snapshot_concept ON ownership_attempts(snapshot_id, concept_id, completed_at DESC);
      CREATE TABLE IF NOT EXISTS snapshot_overviews (
        snapshot_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_overviews_repository ON snapshot_overviews(repository_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_evidence_file_range ON evidence(snapshot_id, file_path, start_line);
      CREATE INDEX IF NOT EXISTS idx_nodes_snapshot_file ON nodes(snapshot_id, file_path, kind);
      CREATE TABLE IF NOT EXISTS change_reports (
        report_id TEXT PRIMARY KEY,
        repository_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        capture_fingerprint TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_change_reports_repository ON change_reports(repository_id, created_at DESC);
    `);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(3, ?)").run(new Date().toISOString());
    this.ensureEvidenceColumns();
    this.ensureSnapshotOverviewColumns();
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_evidence_overlap ON evidence(snapshot_id, file_path, end_line, start_line, start_column, end_column)");
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(4, ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(5, ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(6, ?)").run(new Date().toISOString());
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(7, ?)").run(new Date().toISOString());
    this.database.transaction(() => {
      const columns = new Set((this.database.prepare("PRAGMA table_info(snapshot_overviews)").all() as Array<{ name: string }>).map(item => item.name));
      if (!columns.has("activated_at")) this.database.exec("ALTER TABLE snapshot_overviews ADD COLUMN activated_at TEXT NOT NULL DEFAULT ''");
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(9, ?)").run(new Date().toISOString());
      this.database.exec("CREATE TABLE IF NOT EXISTS project_ignore_settings(repository_id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(8, ?)").run(new Date().toISOString());
    })();
  }

  loadIgnoreSettings(repositoryId: string): ProjectIgnoreSettings {
    const row = this.database.prepare("SELECT payload FROM project_ignore_settings WHERE repository_id=?").get(repositoryId) as PayloadRow | undefined;
    if (!row) return { version: IGNORE_POLICY_VERSION, revision: 0, rules: [] };
    try { return projectIgnoreSettingsSchema.parse(JSON.parse(row.payload)); }
    catch { throw new SafeDiagnosticError("IGNORE_SETTINGS_INVALID"); }
  }

  assertIgnoreRevision(repositoryId: string, revision: number): void {
    if (this.loadIgnoreSettings(repositoryId).revision !== revision) throw new SafeDiagnosticError("IGNORE_SETTINGS_CONFLICT");
  }

  withIgnoreRevision<T>(repositoryId: string, revision: number, work: () => T): T {
    // Reserve the settings database for the complete synchronous publication,
    // including compatibility writes to a legacy source database.
    return this.database.transaction(() => { this.assertIgnoreRevision(repositoryId, revision); return work(); }).immediate();
  }

  saveIgnoreSettings(repositoryId: string, expectedRevision: number, rules: string[]): ProjectIgnoreSettings {
    const parsed = ignoreRulesSchema.safeParse(rules); if (!parsed.success) throw new SafeDiagnosticError("IGNORE_SETTINGS_INVALID");
    return this.database.transaction(() => {
      const prior = this.loadIgnoreSettings(repositoryId); this.assertIgnoreRevision(repositoryId, expectedRevision);
      if (JSON.stringify(prior.rules) === JSON.stringify(parsed.data)) return prior;
      const next: ProjectIgnoreSettings = { version: IGNORE_POLICY_VERSION, revision: prior.revision + 1, rules: parsed.data };
      this.database.prepare("INSERT OR REPLACE INTO project_ignore_settings(repository_id,payload) VALUES(?,?)").run(repositoryId, JSON.stringify(next));
      return next;
    })();
  }

  private ensureEvidenceColumns(): void {
    const columns = new Set((this.database.prepare("PRAGMA table_info(evidence)").all() as Array<{ name: string }>).map((item) => item.name));
    for (const [name, sql] of [["start_column", "INTEGER NOT NULL DEFAULT 0"], ["end_line", "INTEGER NOT NULL DEFAULT 0"], ["end_column", "INTEGER NOT NULL DEFAULT 0"]] as const) if (!columns.has(name)) this.database.exec(`ALTER TABLE evidence ADD COLUMN ${name} ${sql}`);
    this.database.exec("UPDATE evidence SET end_line=start_line WHERE end_line=0");
  }

  private ensureSnapshotOverviewColumns(): void {
    const columns = new Set((this.database.prepare("PRAGMA table_info(snapshot_overviews)").all() as Array<{ name: string }>).map((item) => item.name));
    if (!columns.has("is_current")) this.database.exec("ALTER TABLE snapshot_overviews ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1");
  }

  saveSnapshot(snapshot: ProjectSnapshot, sources: Array<{ filePath: string; contentHash: string; language: string; content: string }> = [], makeCurrent = true, ignoreRevision?: number, activationAfter?: string): ProjectSnapshot {
    snapshot = projectSnapshotSchema.parse(snapshot);
    const save = this.database.transaction(() => {
      if (ignoreRevision !== undefined) this.assertIgnoreRevision(snapshot.repositoryId, ignoreRevision);
      if (snapshot.analysisIdentity.analysisResult && createHash("sha256").update(canonicalSnapshotResult(snapshot)).digest("hex") !== snapshot.analysisIdentity.analysisResult.fingerprint) throw new SafeDiagnosticError("SNAPSHOT_CONTENT_CONFLICT");
      if (snapshot.analysisIdentity.analysisResult) {
        const sortFiles = <T extends { filePath: string }>(items: T[]): T[] => [...items].sort((a, b) => a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0);
        const actualFiles = sources.map(source => ({ filePath: source.filePath, contentHash: createHash("sha256").update(source.content).digest("hex"), bytes: Buffer.byteLength(source.content), language: source.language }));
        if (sources.some((source, index) => source.contentHash !== actualFiles[index]!.contentHash) || canonicalJson(sortFiles(actualFiles)) !== canonicalJson(sortFiles(snapshot.sourceFiles))) throw new SafeDiagnosticError("SNAPSHOT_CONTENT_CONFLICT");
      }
      if ([...snapshot.nodes, ...snapshot.edges, ...snapshot.evidence].some(item => item.snapshotId !== snapshot.snapshotId)) throw new SafeDiagnosticError("SNAPSHOT_CONTENT_CONFLICT");
      const existing = this.database.prepare("SELECT payload FROM snapshots WHERE snapshot_id=?").get(snapshot.snapshotId) as PayloadRow | undefined;
      if (existing) {
        const saved = parseStoredSnapshot(existing.payload);
        const savedSources = this.database.prepare("SELECT file_path AS filePath, content_hash AS contentHash, language, content FROM source_snapshots WHERE snapshot_id=? ORDER BY file_path").all(snapshot.snapshotId);
        const sortSources = (items: unknown[]): unknown[] => [...items].sort((x, y) => canonicalJson(x) < canonicalJson(y) ? -1 : canonicalJson(x) > canonicalJson(y) ? 1 : 0);
        if (canonicalSnapshotContent(saved) !== canonicalSnapshotContent(snapshot) || canonicalJson(sortSources(savedSources)) !== canonicalJson(sortSources(sources))) throw new SafeDiagnosticError("SNAPSHOT_CONTENT_CONFLICT");
        if (makeCurrent) this.activateSnapshot(saved, activationAfter);
        return saved;
      }
      this.database.prepare(`
        INSERT INTO snapshots(snapshot_id, repository_id, root_path, created_at, payload)
        VALUES(@snapshotId, @repositoryId, @rootPath, @createdAt, @payload)
      `).run({ snapshotId: snapshot.snapshotId, repositoryId: snapshot.repositoryId, rootPath: snapshot.rootPath, createdAt: snapshot.createdAt, payload: JSON.stringify(snapshot) });

      const insertNode = this.database.prepare(`
        INSERT INTO nodes(snapshot_id, node_id, kind, name, qualified_name, file_path, payload)
        VALUES(@snapshotId, @id, @kind, @name, @qualifiedName, @filePath, @payload)
      `);
      for (const node of snapshot.nodes) insertNode.run({ snapshotId: snapshot.snapshotId, id: node.id, kind: node.kind, name: node.name, qualifiedName: node.qualifiedName, filePath: node.filePath ?? null, payload: JSON.stringify(node) });

      const insertEdge = this.database.prepare(`
        INSERT INTO edges(snapshot_id, edge_id, source_id, target_id, kind, confidence, payload)
        VALUES(@snapshotId, @id, @source, @target, @kind, @confidence, @payload)
      `);
      for (const edge of snapshot.edges) insertEdge.run({ snapshotId: snapshot.snapshotId, id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, confidence: edge.confidence, payload: JSON.stringify(edge) });

      const insertEvidence = this.database.prepare(`
        INSERT INTO evidence(snapshot_id, evidence_id, file_path, start_line, start_column, end_line, end_column, payload)
        VALUES(@snapshotId, @id, @filePath, @startLine, @startColumn, @endLine, @endColumn, @payload)
      `);
      for (const item of snapshot.evidence) insertEvidence.run({ snapshotId: snapshot.snapshotId, id: item.id, filePath: item.span.filePath, startLine: item.span.startLine, startColumn: item.span.startColumn, endLine: item.span.endLine, endColumn: item.span.endColumn, payload: JSON.stringify(item) });

      const insertSource = this.database.prepare(`
        INSERT INTO source_snapshots(snapshot_id, file_path, content_hash, language, content)
        VALUES(@snapshotId, @filePath, @contentHash, @language, @content)
      `);
      for (const source of sources) insertSource.run({ snapshotId: snapshot.snapshotId, ...source });
      const overview = overviewFromSnapshot(snapshot);
      this.database.prepare("INSERT INTO snapshot_overviews(snapshot_id, repository_id, created_at, is_current, payload) VALUES(?, ?, ?, ?, ?)").run(snapshot.snapshotId, snapshot.repositoryId, snapshot.createdAt, 0, JSON.stringify(overview));
      if (makeCurrent) this.activateSnapshot(snapshot, activationAfter);
      return snapshot;
    });
    const nested = this.database.inTransaction;
    const saved = save.immediate();
    // A nested savepoint does not establish the outer commit; permanently stop comparing.
    const generation = this.navigationGeneration;
    this.navigationGeneration = nested || generation === null || !Number.isSafeInteger(generation) || generation < 0 || generation >= Number.MAX_SAFE_INTEGER - 1 ? null : generation + 1;
    return saved;
  }

  private activateSnapshot(snapshot: ProjectSnapshot, activationAfter = ""): void {
    const row = this.database.prepare("SELECT snapshot_id FROM snapshot_overviews WHERE snapshot_id=?").get(snapshot.snapshotId);
    if (!row) this.database.prepare("INSERT INTO snapshot_overviews(snapshot_id,repository_id,created_at,is_current,payload) VALUES(?,?,?,0,?)").run(snapshot.snapshotId, snapshot.repositoryId, snapshot.createdAt, JSON.stringify(overviewFromSnapshot(snapshot)));
    this.database.prepare("UPDATE snapshot_overviews SET is_current=0 WHERE repository_id=? AND snapshot_id<>?").run(snapshot.repositoryId, snapshot.snapshotId);
    const prior = Math.max(Date.parse(this.getCurrentActivation()) || 0, Date.parse(activationAfter) || 0);
    this.database.prepare("UPDATE snapshot_overviews SET is_current=1,activated_at=? WHERE snapshot_id=?").run(new Date(Math.max(Date.now(), prior + 1)).toISOString(), snapshot.snapshotId);
  }

  getCurrentActivation(): string {
    const row = this.database.prepare("SELECT CASE WHEN activated_at='' THEN created_at ELSE activated_at END AS activatedAt FROM snapshot_overviews WHERE is_current=1 ORDER BY activatedAt DESC,created_at DESC LIMIT 1").get() as { activatedAt: string } | undefined;
    return row?.activatedAt ?? this.getLatestSnapshot()?.createdAt ?? "";
  }

  loadSnapshot(snapshotId: string): ProjectSnapshot | null {
    const row = this.database.prepare("SELECT payload FROM snapshots WHERE snapshot_id = ?").get(snapshotId) as StoredSnapshotRow | undefined;
    return row ? parseStoredSnapshot(row.payload) : null;
  }

  getLatestSnapshot(): ProjectSnapshot | null {
    const row = this.database.prepare("SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 1").get() as StoredSnapshotRow | undefined;
    return row ? parseStoredSnapshot(row.payload) : null;
  }

  getOverview(snapshotId: string): ProjectOverview | null {
    const row = this.database.prepare("SELECT payload FROM snapshot_overviews WHERE snapshot_id = ?").get(snapshotId) as PayloadRow | undefined;
    if (row) return projectOverviewSchema.parse(JSON.parse(row.payload));
    const snapshot = this.loadSnapshot(snapshotId); if (!snapshot) return null;
    const overview = overviewFromSnapshot(snapshot);
    this.database.prepare("INSERT OR REPLACE INTO snapshot_overviews(snapshot_id, repository_id, created_at, is_current, payload) VALUES(?, ?, ?, 1, ?)").run(snapshotId, snapshot.repositoryId, snapshot.createdAt, JSON.stringify(overview));
    return overview;
  }

  getLatestOverview(): ProjectOverview | null {
    const row = this.database.prepare("SELECT payload FROM snapshot_overviews WHERE is_current=1 ORDER BY CASE WHEN activated_at='' THEN created_at ELSE activated_at END DESC,created_at DESC LIMIT 1").get() as PayloadRow | undefined;
    if (row) return projectOverviewSchema.parse(JSON.parse(row.payload));
    const snapshot = this.getLatestSnapshot(); return snapshot ? this.getOverview(snapshot.snapshotId) : null;
  }

  listModules(input: ModuleListRequest): ModuleListResponse {
    const offset = decodeScopedPageCursor(input.cursor, input.snapshotId, `modules:${input.query}`);
    const query = `%${escapeLike(input.query.toLocaleLowerCase())}%`;
    const where = input.query ? "AND lower(m.name) LIKE ? ESCAPE '\\'" : "";
    const args = input.query ? [input.snapshotId, query] : [input.snapshotId];
    const directoryModule = "AND EXISTS (SELECT 1 FROM edges c JOIN nodes f ON f.snapshot_id=c.snapshot_id AND f.node_id=c.target_id AND f.kind='file' WHERE c.snapshot_id=m.snapshot_id AND c.source_id=m.node_id AND c.kind='CONTAINS')";
    const total = (this.database.prepare(`SELECT count(*) count FROM nodes m WHERE m.snapshot_id = ? AND m.kind = 'module' ${directoryModule} ${where}`).get(...args) as CountRow).count;
    const rows = this.database.prepare(`
      SELECT m.node_id, m.name, m.qualified_name,
        (SELECT count(*) FROM edges e JOIN nodes f ON f.snapshot_id=e.snapshot_id AND f.node_id=e.target_id WHERE e.snapshot_id=m.snapshot_id AND e.source_id=m.node_id AND e.kind='CONTAINS' AND f.kind='file') file_count,
        (SELECT count(*) FROM edges c JOIN edges d ON d.snapshot_id=c.snapshot_id AND d.source_id=c.target_id AND d.kind='DEFINES' WHERE c.snapshot_id=m.snapshot_id AND c.source_id=m.node_id AND c.kind='CONTAINS') symbol_count,
        (SELECT count(*) FROM edges e WHERE e.snapshot_id=m.snapshot_id AND (e.source_id=m.node_id OR e.target_id=m.node_id)) relation_count
      FROM nodes m WHERE m.snapshot_id = ? AND m.kind='module' ${directoryModule} ${where}
      ORDER BY lower(m.qualified_name), m.node_id LIMIT ? OFFSET ?
    `).all(...args, input.limit, offset) as Array<Record<string, unknown>>;
    return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: rows.map(moduleSummaryFromRow), ...(offset + rows.length < total ? { nextCursor: encodeScopedPageCursor(input.snapshotId, `modules:${input.query}`, offset + rows.length) } : {}), total };
  }

  getModuleOverview(input: ModuleOverviewRequest): ModuleOverviewResponse {
    const moduleScope = `module-overview:${input.query}:${input.limit}`;
    const moduleOffset = decodeScopedPageCursor(input.cursor, input.snapshotId, moduleScope);
    const query = `%${escapeLike(input.query.toLocaleLowerCase())}%`;
    const nameWhere = input.query ? "AND (lower(m.name) LIKE ? ESCAPE '\\' OR lower(m.qualified_name) LIKE ? ESCAPE '\\')" : "";
    const nameArgs: unknown[] = input.query ? [query, query] : [];
    const directoryModule = "EXISTS (SELECT 1 FROM edges c JOIN nodes f ON f.snapshot_id=c.snapshot_id AND f.node_id=c.target_id AND f.kind='file' WHERE c.snapshot_id=m.snapshot_id AND c.source_id=m.node_id AND c.kind='CONTAINS')";
    const moduleTotal = (this.database.prepare(`SELECT count(*) count FROM nodes m WHERE m.snapshot_id=? AND m.kind='module' AND ${directoryModule} ${nameWhere}`).get(input.snapshotId, ...nameArgs) as CountRow).count;
    const rows = this.database.prepare(`
      SELECT m.node_id,m.name,m.qualified_name,
        (SELECT count(*) FROM edges e JOIN nodes f ON f.snapshot_id=e.snapshot_id AND f.node_id=e.target_id WHERE e.snapshot_id=m.snapshot_id AND e.source_id=m.node_id AND e.kind='CONTAINS' AND f.kind='file') file_count,
        (SELECT count(*) FROM edges c JOIN edges d ON d.snapshot_id=c.snapshot_id AND d.source_id=c.target_id AND d.kind='DEFINES' WHERE c.snapshot_id=m.snapshot_id AND c.source_id=m.node_id AND c.kind='CONTAINS') symbol_count,
        (SELECT count(*) FROM edges e WHERE e.snapshot_id=m.snapshot_id AND (e.source_id=m.node_id OR e.target_id=m.node_id)) relation_count
      FROM nodes m WHERE m.snapshot_id=? AND m.kind='module' AND ${directoryModule} ${nameWhere}
      ORDER BY lower(m.qualified_name),m.node_id LIMIT ? OFFSET ?
    `).all(input.snapshotId, ...nameArgs, input.limit, moduleOffset) as Array<Record<string, unknown>>;
    const modules = rows.map(moduleSummaryFromRow); const moduleIds = modules.map((module) => module.id);
    const relationScope = `module-overview-relations:${input.query}:${moduleOffset}:${moduleIds.join(",")}`;
    const relationOffset = decodeScopedPageCursor(input.relationCursor, input.snapshotId, relationScope);
    const relations = moduleIds.length ? this.aggregateOverviewRelations(input.snapshotId, moduleIds) : [];
    const relationPage = relations.slice(relationOffset, relationOffset + input.relationLimit);
    const references = moduleIds.length ? this.aggregateModuleReferences(input.snapshotId, moduleIds) : [];
    return {
      repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: MODULE_OVERVIEW_VERSION, query: input.query,
      modules, moduleTotal, ...(moduleOffset + modules.length < moduleTotal ? { nextCursor: encodeScopedPageCursor(input.snapshotId, moduleScope, moduleOffset + modules.length) } : {}),
      relations: relationPage, relationTotal: relations.length, ...(relationOffset + relationPage.length < relations.length ? { relationNextCursor: encodeScopedPageCursor(input.snapshotId, relationScope, relationOffset + relationPage.length) } : {}),
      references: references.slice(0, input.referenceLimit), referenceTotal: references.length, referencesTruncated: references.length > input.referenceLimit, scope: "visible-module-page",
    };
  }

  expandModule(input: ModuleExpansionRequest): ModuleExpansionResponse {
    const moduleNode = this.getNode(input.snapshotId, input.moduleId); if (!moduleNode || moduleNode.kind !== "module") throw new Error("模块不存在于指定快照");
    const offset = decodeScopedPageCursor(input.cursor, input.snapshotId, `module-files:${input.moduleId}`);
    const rows = this.database.prepare(`
      WITH module_files AS (SELECT target_id id FROM edges WHERE snapshot_id=? AND source_id=? AND kind='CONTAINS')
      SELECT n.payload FROM module_files x JOIN nodes n ON n.snapshot_id=? AND n.node_id=x.id AND n.kind='file' ORDER BY lower(n.qualified_name), n.node_id LIMIT ? OFFSET ?
    `).all(input.snapshotId, input.moduleId, input.snapshotId, input.limit + 1, offset) as PayloadRow[];
    const hasMore = rows.length > input.limit; const nodes = rows.slice(0, input.limit).map((row) => JSON.parse(row.payload) as GraphNode);
    const summary = this.listModules({ ...input, query: "", cursor: undefined, limit: 200 }).items.find((item) => item.id === input.moduleId)
      ?? { id: moduleNode.id, name: moduleNode.name, qualifiedName: moduleNode.qualifiedName, fileCount: 0, symbolCount: 0, relationCount: 0 };
    const relations = this.aggregateModuleRelations(input.snapshotId, input.moduleId);
    return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, module: summary, nodes, relations, ...(hasMore ? { nextCursor: encodeScopedPageCursor(input.snapshotId, `module-files:${input.moduleId}`, offset + input.limit) } : {}), truncated: hasMore };
  }

  search(input: SearchRequest): SearchResponse {
    const searchScope = `search:${input.query}:${(input.kinds ?? []).join(",")}:${input.filePath ?? ""}`;
    const offset = decodeScopedPageCursor(input.cursor, input.snapshotId, searchScope); const terms = input.query.toLocaleLowerCase().trim();
    const clauses = ["snapshot_id = ?"]; const args: unknown[] = [input.snapshotId];
    if (terms) { clauses.push("(lower(name) LIKE ? ESCAPE '\\' OR lower(qualified_name) LIKE ? ESCAPE '\\' OR lower(coalesce(file_path,'')) LIKE ? ESCAPE '\\')"); const value = `%${escapeLike(terms)}%`; args.push(value, value, value); }
    if (input.kinds?.length) { clauses.push(`kind IN (${input.kinds.map(() => "?").join(",")})`); args.push(...input.kinds); }
    if (input.filePath) { clauses.push("file_path = ?"); args.push(input.filePath); }
    const where = clauses.join(" AND "); const total = (this.database.prepare(`SELECT count(*) count FROM nodes WHERE ${where}`).get(...args) as CountRow).count;
    const rows = this.database.prepare(`SELECT payload FROM nodes WHERE ${where} ORDER BY CASE kind WHEN 'function' THEN 0 WHEN 'method' THEN 1 WHEN 'class' THEN 2 WHEN 'endpoint' THEN 3 WHEN 'file' THEN 4 ELSE 5 END, lower(qualified_name), node_id LIMIT ? OFFSET ?`).all(...args, input.limit, offset) as PayloadRow[];
    return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: rows.map((row) => JSON.parse(row.payload) as GraphNode), ...(offset + rows.length < total ? { nextCursor: encodeScopedPageCursor(input.snapshotId, searchScope, offset + rows.length) } : {}), total };
  }

  getEvidence(snapshotId: string, evidenceId: string): Evidence | null {
    const row = this.database.prepare("SELECT payload FROM evidence WHERE snapshot_id=? AND evidence_id=?").get(snapshotId, evidenceId) as PayloadRow | undefined;
    return row ? JSON.parse(row.payload) as Evidence : null;
  }

  findEvidence(repositoryId: string, snapshotId: string, span: Evidence["span"], limit: number, cursor?: string): EvidenceRangeResponse {
    const offset = decodePageCursor(cursor, snapshotId); const overlap = "end_line > ? OR (end_line = ? AND end_column > ?)";
    const beforeEnd = "start_line < ? OR (start_line = ? AND start_column < ?)";
    const args = [snapshotId, span.filePath, span.startLine, span.startLine, span.startColumn, span.endLine, span.endLine, span.endColumn];
    const total = (this.database.prepare(`SELECT count(*) count FROM evidence WHERE snapshot_id=? AND file_path=? AND (${overlap}) AND (${beforeEnd})`).get(...args) as CountRow).count;
    const rows = this.database.prepare(`SELECT payload FROM evidence WHERE snapshot_id=? AND file_path=? AND (${overlap}) AND (${beforeEnd}) ORDER BY start_line,start_column,end_line,end_column,evidence_id LIMIT ? OFFSET ?`).all(...args, limit, offset) as PayloadRow[];
    return { repositoryId, snapshotId, items: rows.map((row) => JSON.parse(row.payload) as Evidence), total, ...(offset + rows.length < total ? { nextCursor: encodePageCursor(snapshotId, offset + rows.length) } : {}), truncated: offset + rows.length < total };
  }

  listModuleRelationEdges(input: ModuleRelationEdgesRequest): ModuleRelationEdgesResponse {
    const relationScope = `module-relation:${input.sourceModuleId}:${input.targetModuleId}`;
    const offset = decodeScopedPageCursor(input.cursor, input.snapshotId, relationScope); const cte = `WITH module_files AS (SELECT source_id module_id,target_id file_id FROM edges WHERE snapshot_id=? AND kind='CONTAINS' AND source_id IN (SELECT node_id FROM nodes WHERE snapshot_id=? AND kind='module')), owner AS (SELECT file_id node_id,module_id FROM module_files UNION ALL SELECT d.target_id node_id,m.module_id FROM edges d JOIN module_files m ON m.file_id=d.source_id WHERE d.snapshot_id=? AND d.kind='DEFINES')`;
    const baseArgs = [input.snapshotId, input.snapshotId, input.snapshotId, input.snapshotId, input.sourceModuleId, input.targetModuleId];
    const total = (this.database.prepare(`${cte} SELECT count(*) count FROM edges e JOIN owner a ON a.node_id=e.source_id JOIN owner b ON b.node_id=e.target_id WHERE e.snapshot_id=? AND a.module_id=? AND b.module_id=?`).get(...baseArgs) as CountRow).count;
    const rows = this.database.prepare(`${cte} SELECT e.payload FROM edges e JOIN owner a ON a.node_id=e.source_id JOIN owner b ON b.node_id=e.target_id WHERE e.snapshot_id=? AND a.module_id=? AND b.module_id=? ORDER BY e.kind,e.source_id,e.target_id,e.edge_id LIMIT ? OFFSET ?`).all(...baseArgs, input.limit, offset) as PayloadRow[];
    return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, sourceModuleId: input.sourceModuleId, targetModuleId: input.targetModuleId, items: rows.map((row) => JSON.parse(row.payload) as GraphEdge), total, ...(offset + rows.length < total ? { nextCursor: encodeScopedPageCursor(input.snapshotId, relationScope, offset + rows.length) } : {}) };
  }

  queryGraph(raw: GraphQueryRequest): GraphQueryResponse {
    const input = graphQueryRequestSchema.parse(raw); const allowedKinds = allowedKindsFor(input); const { continuationCursor: _cursor, ...query } = input;
    const queryKey = createHash("sha256").update(JSON.stringify(query)).digest("hex").slice(0, 24);
    const prior = input.continuationCursor ? decodeGraphCursor(input.continuationCursor, input.repositoryId, input.snapshotId, queryKey) : undefined;
    const queue: CursorQueueItem[] = prior?.queue.map((item) => ({ ...item })) ?? input.rootNodeIds.map((nodeId) => ({ nodeId, depth: 0 }));
    const seenNodes = new Set(prior?.seenNodes ?? []);
    const pageNodes = new Map<string, GraphNode>(); const pageEdges = new Map<string, GraphEdge>();
    const evidenceIds = new Set<string>(); const unresolved: GraphQueryResponse["unresolved"] = []; const reasons = new Set<"depth" | "nodes" | "edges" | "work">();
    let scannedEdges = 0; let expandedNodes = 0; let depthReached = 0;
    for (const root of input.rootNodeIds) { const node = this.getNode(input.snapshotId, root); if (!node) throw new Error(`查询根节点不存在：${root}`); if (!seenNodes.has(root)) { seenNodes.add(root); pageNodes.set(root, node); } }
    outer: while (queue.length) {
      const item = queue.shift()!; const { nodeId, depth } = item; let afterEdgeId = item.afterEdgeId; depthReached = Math.max(depthReached, depth);
      if (depth >= input.maxDepth) { if (this.hasRelatedEdge(input.snapshotId, nodeId, allowedKinds, input.confidences, input.direction, afterEdgeId)) reasons.add("depth"); continue; }
      if (scannedEdges >= input.maxWork) { queue.unshift(item); reasons.add("work"); break; }
      if (pageEdges.size >= input.maxEdges) { queue.unshift(item); reasons.add("edges"); break; }
      expandedNodes += 1;
      while (true) {
        if (scannedEdges >= input.maxWork) { if (this.hasRelatedEdge(input.snapshotId, nodeId, allowedKinds, input.confidences, input.direction, afterEdgeId)) { queue.unshift({ nodeId, depth, ...(afterEdgeId ? { afterEdgeId } : {}) }); reasons.add("work"); break outer; } break; }
        if (pageEdges.size >= input.maxEdges) { if (this.hasRelatedEdge(input.snapshotId, nodeId, allowedKinds, input.confidences, input.direction, afterEdgeId)) { queue.unshift({ nodeId, depth, ...(afterEdgeId ? { afterEdgeId } : {}) }); reasons.add("edges"); break outer; } break; }
        const edge = this.relatedEdges(input.snapshotId, nodeId, allowedKinds, input.confidences, input.direction, 1, afterEdgeId)[0]; if (!edge) break;
        scannedEdges += 1;
        const neighborId = edge.source === nodeId ? edge.target : edge.source; const neighbor = this.getNode(input.snapshotId, neighborId);
        if (neighbor && !seenNodes.has(neighborId) && pageNodes.size >= input.maxNodes) { reasons.add("nodes"); queue.unshift({ nodeId, depth, ...(afterEdgeId ? { afterEdgeId } : {}) }); break outer; }
        afterEdgeId = edge.id; pageEdges.set(edge.id, edge); evidenceIds.add(edge.evidenceId);
        if (edge.confidence === "unknown" || edge.unresolvedTarget) unresolved.push({ edgeId: edge.id, ...(edge.unresolvedTarget ? { target: edge.unresolvedTarget } : {}), reason: edge.reason, confidence: edge.confidence });
        if (neighbor && !seenNodes.has(neighborId)) { seenNodes.add(neighborId); pageNodes.set(neighborId, neighbor); queue.push({ nodeId: neighborId, depth: depth + 1 }); }
      }
    }
    const truncated = reasons.size > 0 || queue.length > 0;
    const continuationCursor = queue.length ? encodeGraphCursor({ version: 2, repositoryId: input.repositoryId, snapshotId: input.snapshotId, queryKey, queue, seenNodes: [...seenNodes] }) : undefined;
    const evidence = [...evidenceIds].sort().map((id) => this.getEvidence(input.snapshotId, id)).filter((item): item is Evidence => Boolean(item));
    return { repositoryId: input.repositoryId, snapshotId: input.snapshotId, version: GRAPH_QUERY_VERSION, query: graphQueryRequestSchema.omit({ continuationCursor: true }).parse(query), nodes: [...pageNodes.values()].sort(nodeOrder), edges: [...pageEdges.values()].sort(edgeOrder), evidence, unresolved: uniqueBy(unresolved, (item) => item.edgeId), truncated, truncationReasons: [...reasons].sort(), ...(continuationCursor ? { continuationCursor } : {}), stats: { expandedNodes, scannedEdges, returnedNodes: pageNodes.size, returnedEdges: pageEdges.size, depthReached } };
  }

  private getNode(snapshotId: string, nodeId: string): GraphNode | null { const row = this.database.prepare("SELECT payload FROM nodes WHERE snapshot_id=? AND node_id=?").get(snapshotId, nodeId) as PayloadRow | undefined; return row ? JSON.parse(row.payload) as GraphNode : null; }
  private relatedEdges(snapshotId: string, nodeId: string, kinds: string[], confidences: string[], direction: GraphQueryRequest["direction"], limit: number, afterEdgeId?: string): GraphEdge[] {
    if (!kinds.length) return [];
    const side = direction === "outgoing" ? "source_id=?" : direction === "incoming" ? "target_id=?" : "(source_id=? OR target_id=?)";
    const after = afterEdgeId ? "AND edge_id>?" : "";
    const args: unknown[] = [snapshotId, ...(direction === "both" ? [nodeId, nodeId] : [nodeId]), ...kinds, ...confidences, ...(afterEdgeId ? [afterEdgeId] : []), limit];
    const rows = this.database.prepare(`SELECT payload FROM edges WHERE snapshot_id=? AND ${side} AND kind IN (${kinds.map(() => "?").join(",")}) AND confidence IN (${confidences.map(() => "?").join(",")}) ${after} ORDER BY edge_id LIMIT ?`).all(...args) as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as GraphEdge);
  }
  private hasRelatedEdge(snapshotId: string, nodeId: string, kinds: string[], confidences: string[], direction: GraphQueryRequest["direction"], afterEdgeId?: string): boolean { return this.relatedEdges(snapshotId, nodeId, kinds, confidences, direction, 1, afterEdgeId).length > 0; }
  private aggregateOverviewRelations(snapshotId: string, moduleIds: string[]): ModuleOverviewResponse["relations"] {
    const slots = moduleIds.map(() => "?").join(",");
    const cte = `WITH module_files AS (SELECT source_id module_id,target_id file_id FROM edges WHERE snapshot_id=? AND kind='CONTAINS'), owner AS (SELECT file_id node_id,module_id FROM module_files UNION ALL SELECT d.target_id node_id,m.module_id FROM edges d JOIN module_files m ON m.file_id=d.source_id WHERE d.snapshot_id=? AND d.kind='DEFINES')`;
    const rows = this.database.prepare(`${cte} SELECT a.module_id source_module,b.module_id target_module,e.kind,e.confidence,count(*) count FROM edges e JOIN owner a ON a.node_id=e.source_id JOIN owner b ON b.node_id=e.target_id WHERE e.snapshot_id=? AND a.module_id IN (${slots}) AND b.module_id IN (${slots}) AND a.module_id<>b.module_id GROUP BY a.module_id,b.module_id,e.kind,e.confidence ORDER BY a.module_id,b.module_id,e.kind,e.confidence`).all(snapshotId, snapshotId, snapshotId, ...moduleIds, ...moduleIds) as Array<{ source_module: string; target_module: string; kind: string; confidence: string; count: number }>;
    const groups = new Map<string, ModuleOverviewResponse["relations"][number]>();
    for (const row of rows) {
      const key = `${row.source_module}:${row.target_module}`;
      const group = groups.get(key) ?? { sourceModuleId: row.source_module, targetModuleId: row.target_module, kinds: {}, confidences: {}, edgeCount: 0, evidenceIds: [], edges: [], sampledEdgeCount: 0, evidenceTruncated: true };
      group.kinds[row.kind] = (group.kinds[row.kind] ?? 0) + row.count; group.confidences[row.confidence] = (group.confidences[row.confidence] ?? 0) + row.count; group.edgeCount += row.count; groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.sourceModuleId.localeCompare(b.sourceModuleId) || a.targetModuleId.localeCompare(b.targetModuleId));
  }

  private aggregateModuleReferences(snapshotId: string, moduleIds: string[]): ModuleOverviewResponse["references"] {
    const slots = moduleIds.map(() => "?").join(",");
    const cte = `WITH module_files AS (SELECT source_id module_id,target_id file_id FROM edges WHERE snapshot_id=? AND kind='CONTAINS'), owner AS (SELECT file_id node_id,module_id FROM module_files UNION ALL SELECT d.target_id node_id,m.module_id FROM edges d JOIN module_files m ON m.file_id=d.source_id WHERE d.snapshot_id=? AND d.kind='DEFINES')`;
    const rows = this.database.prepare(`${cte} SELECT r.node_id,r.name,r.qualified_name,r.kind,e.kind edge_kind,e.confidence,count(*) count FROM edges e JOIN owner a ON a.node_id=e.source_id JOIN nodes r ON r.snapshot_id=e.snapshot_id AND r.node_id=e.target_id WHERE e.snapshot_id=? AND a.module_id IN (${slots}) AND (r.kind IN ('external-dependency','unresolved-call','unsupported-semantic') OR (r.kind='module' AND NOT EXISTS (SELECT 1 FROM edges c JOIN nodes f ON f.snapshot_id=c.snapshot_id AND f.node_id=c.target_id AND f.kind='file' WHERE c.snapshot_id=r.snapshot_id AND c.source_id=r.node_id AND c.kind='CONTAINS'))) GROUP BY r.node_id,r.name,r.qualified_name,r.kind,e.kind,e.confidence ORDER BY lower(r.qualified_name),r.node_id,e.kind,e.confidence`).all(snapshotId, snapshotId, snapshotId, ...moduleIds) as Array<{ node_id: string; name: string; qualified_name: string; kind: string; edge_kind: string; confidence: string; count: number }>;
    const groups = new Map<string, ModuleOverviewResponse["references"][number]>();
    for (const row of rows) {
      const category = row.kind === "module" ? "unresolved-module" : row.kind === "unresolved-call" ? "unresolved-call" : row.kind === "unsupported-semantic" ? "unsupported-semantic" : "external-dependency";
      const group = groups.get(row.node_id) ?? { id: row.node_id, name: row.name, qualifiedName: row.qualified_name, category, relationCount: 0, kinds: {}, confidences: {} };
      group.relationCount += row.count; group.kinds[row.edge_kind] = (group.kinds[row.edge_kind] ?? 0) + row.count; group.confidences[row.confidence] = (group.confidences[row.confidence] ?? 0) + row.count; groups.set(row.node_id, group);
    }
    return [...groups.values()];
  }

  private aggregateModuleRelations(snapshotId: string, moduleId: string): ModuleExpansionResponse["relations"] {
    const cte = `
      WITH module_files AS (SELECT source_id module_id,target_id file_id FROM edges WHERE snapshot_id=? AND kind='CONTAINS' AND source_id IN (SELECT node_id FROM nodes WHERE snapshot_id=? AND kind='module')),
      owner AS (SELECT file_id node_id,module_id FROM module_files UNION ALL SELECT d.target_id node_id,m.module_id FROM edges d JOIN module_files m ON m.file_id=d.source_id WHERE d.snapshot_id=? AND d.kind='DEFINES')
    `;
    const stats = this.database.prepare(`${cte} SELECT a.module_id source_module,b.module_id target_module,e.kind,e.confidence,count(*) count FROM edges e JOIN owner a ON a.node_id=e.source_id JOIN owner b ON b.node_id=e.target_id WHERE e.snapshot_id=? AND a.module_id=? AND a.module_id<>b.module_id GROUP BY a.module_id,b.module_id,e.kind,e.confidence ORDER BY b.module_id,e.kind,e.confidence`).all(snapshotId, snapshotId, snapshotId, snapshotId, moduleId) as Array<{ source_module: string; target_module: string; kind: string; confidence: string; count: number }>;
    const groups = new Map<string, ModuleExpansionResponse["relations"][number]>();
    for (const row of stats) { const key = `${row.source_module}:${row.target_module}`; const group = groups.get(key) ?? { sourceModuleId: row.source_module, targetModuleId: row.target_module, kinds: {}, confidences: {}, edgeCount: 0, evidenceIds: [], edges: [], sampledEdgeCount: 0, evidenceTruncated: false }; group.kinds[row.kind] = (group.kinds[row.kind] ?? 0) + row.count; group.confidences[row.confidence] = (group.confidences[row.confidence] ?? 0) + row.count; group.edgeCount += row.count; groups.set(key, group); }
    for (const group of groups.values()) { const page = this.listModuleRelationEdges({ repositoryId: "internal", snapshotId, sourceModuleId: group.sourceModuleId, targetModuleId: group.targetModuleId, limit: 20 }); group.edges = page.items; group.evidenceIds = [...new Set(page.items.map((edge) => edge.evidenceId))]; group.sampledEdgeCount = page.items.length; group.evidenceTruncated = Boolean(page.nextCursor); }
    return [...groups.values()].sort((a, b) => a.targetModuleId.localeCompare(b.targetModuleId));
  }

  saveChangeReport(report: ChangeReport, ignoreRevision?: number): void { this.database.transaction(() => { if (ignoreRevision !== undefined) this.assertIgnoreRevision(report.repositoryId, ignoreRevision); report = parseChangeReport(report); this.database.prepare("INSERT OR REPLACE INTO change_reports(report_id,repository_id,created_at,capture_fingerprint,payload) VALUES(?,?,?,?,?)").run(report.id, report.repositoryId, report.createdAt, report.captureFingerprint, JSON.stringify(report)); })(); }
  loadChangeReport(reportId: string): ChangeReport | null { const row = this.database.prepare("SELECT payload FROM change_reports WHERE report_id=?").get(reportId) as PayloadRow | undefined; return row ? parseChangeReport(JSON.parse(row.payload)) : null; }

  readSnapshotSource(snapshotId: string, filePath: string): { content: string; contentHash: string; language: string } | null {
    const row = this.database.prepare("SELECT content, content_hash, language FROM source_snapshots WHERE snapshot_id = ? AND file_path = ?").get(snapshotId, filePath) as StoredSourceRow | undefined;
    return row ? { content: row.content, contentHash: row.content_hash, language: row.language } : null;
  }

  saveMastery(record: MasteryRecord): void {
    this.database.prepare(`INSERT OR REPLACE INTO mastery_records(snapshot_id, question_id, concept, score, completed_at, payload) VALUES(@snapshotId, @questionId, @concept, @score, @completedAt, @payload)`).run({ ...record, payload: JSON.stringify(record) });
  }

  listMastery(snapshotId: string): MasteryRecord[] {
    return (this.database.prepare("SELECT payload FROM mastery_records WHERE snapshot_id = ? ORDER BY completed_at").all(snapshotId) as StoredSnapshotRow[]).map((row) => JSON.parse(row.payload) as MasteryRecord);
  }

  captureOwnershipSource(repositoryId: string, snapshotId: string, ignoreRevision: number): OwnershipSourceCapture { return this.ownershipCapsules.captureSource(repositoryId, snapshotId, ignoreRevision); }
  prepareOwnershipAttemptWithCapsule(input: OwnershipCapsuleWriteInput, settings: GraphStore = this): Promise<PreparedOwnershipWrite> {
    if (!(settings instanceof GraphStore)) return Promise.reject(new OwnershipCapsuleStoreError());
    return this.ownershipCapsules.prepare(input, settings);
  }
  savePreparedOwnershipAttempt(prepared: PreparedOwnershipWrite): void { this.ownershipCapsules.save(prepared); }
  loadOwnershipCapsule(attemptId: string): Promise<OwnershipCapsuleRead> { return this.ownershipCapsules.load(attemptId); }
  loadOwnershipSemanticPackage(attemptId: string): Promise<OwnershipSemanticPackageRead> { return this.ownershipCapsules.loadSemanticPackage(attemptId); }

  saveOwnershipAttempt(attempt: OwnershipAttempt, ignoreRevision?: number): void {
    this.database.transaction(() => {
      if (ignoreRevision !== undefined) this.assertIgnoreRevision(attempt.repositoryId, ignoreRevision);
      this.database.prepare("INSERT INTO ownership_attempts(attempt_id,repository_id,snapshot_id,concept_id,completed_at,payload) VALUES(@attemptId,@repositoryId,@snapshotId,@conceptId,@completedAt,@payload)").run({ ...attempt, conceptId: attempt.concept.id, payload: JSON.stringify(attempt) });
    })();
  }

  listOwnershipAttempts(repositoryId: string): OwnershipAttempt[] {
    const attempts = (this.database.prepare("SELECT payload FROM ownership_attempts WHERE repository_id=? ORDER BY completed_at ASC,attempt_id ASC").all(repositoryId) as StoredSnapshotRow[]).map((row) => JSON.parse(row.payload) as OwnershipAttempt);
    const known = new Set(attempts.map((item) => `${item.snapshotId}:${item.questionId}`));
    const legacy = (this.database.prepare("SELECT payload FROM mastery_records ORDER BY completed_at ASC").all() as StoredSnapshotRow[]).map((row) => JSON.parse(row.payload) as MasteryRecord).filter((item) => item.repositoryId === repositoryId && !known.has(`${item.snapshotId}:${item.questionId}`)).map((item): OwnershipAttempt => ({ ...item, attemptId: `legacy:${item.snapshotId}:${item.questionId}`, questionVersion: "legacy", concept: { id: `legacy:${item.concept}`, label: item.concept }, questionKind: "legacy", variantKey: "legacy", structuredAnswer: null, citations: [], locationScore: item.score, structureScore: 0, passed: false, scoringVersion: "legacy", semanticText: "", legacy: true }));
    return [...legacy, ...attempts].sort((a,b) => a.completedAt.localeCompare(b.completedAt) || a.attemptId.localeCompare(b.attemptId));
  }

  close(): void {
    this.ownershipCapsules.close();
    this.database.close();
  }
}

export function overviewFromSnapshot(snapshot: ProjectSnapshot): ProjectOverview {
  const fileIds = new Set(snapshot.nodes.filter((node) => node.kind === "file").map((node) => node.id));
  const directoryModuleIds = new Set(snapshot.edges.filter((edge) => edge.kind === "CONTAINS" && fileIds.has(edge.target)).map((edge) => edge.source));
  return { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, name: snapshot.name, rootPath: snapshot.rootPath, sourceType: snapshot.sourceType, ...(snapshot.gitHead ? { gitHead: snapshot.gitHead } : {}), createdAt: snapshot.createdAt, analysisIdentity: snapshot.analysisIdentity, health: snapshot.health, counts: { nodes: snapshot.nodes.length, edges: snapshot.edges.length, evidence: snapshot.evidence.length, modules: directoryModuleIds.size, files: snapshot.sourceFiles.length, calls: snapshot.edges.filter((edge) => edge.kind === "CALLS").length, unknown: snapshot.edges.filter((edge) => edge.confidence === "unknown").length } };
}

function allowedKindsFor(input: GraphQueryRequest): string[] { const defaults = input.view === "call" ? ["HANDLES", "CALLS"] : input.view === "data" ? ["READS", "WRITES", "RETURNS", "PASSES_TO"] : ["IMPORTS", "DEPENDS_ON"]; return input.edgeKinds ? defaults.filter((kind) => input.edgeKinds!.includes(kind as never)) : defaults; }
function nodeOrder(a: GraphNode, b: GraphNode): number { return a.qualifiedName.localeCompare(b.qualifiedName) || a.id.localeCompare(b.id); }
function edgeOrder(a: GraphEdge, b: GraphEdge): number { return a.kind.localeCompare(b.kind) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.id.localeCompare(b.id); }
function moduleSummaryFromRow(row: Record<string, unknown>): ModuleOverviewResponse["modules"][number] { return { id: String(row.node_id), name: String(row.name), qualifiedName: String(row.qualified_name), fileCount: Number(row.file_count), symbolCount: Number(row.symbol_count), relationCount: Number(row.relation_count) }; }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
function encodePageCursor(snapshotId: string, offset: number): string { return Buffer.from(JSON.stringify({ snapshotId, offset }), "utf8").toString("base64url"); }
function decodePageCursor(cursor: string | undefined, snapshotId: string): number { if (!cursor) return 0; try { const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { snapshotId?: string; offset?: number }; if (value.snapshotId !== snapshotId || !Number.isInteger(value.offset) || value.offset! < 0) throw new Error(); return value.offset!; } catch { throw new Error("分页游标无效或属于其他快照"); } }
function encodeScopedPageCursor(snapshotId: string, scope: string, offset: number): string { return Buffer.from(JSON.stringify({ snapshotId, scope: createHash("sha256").update(scope).digest("hex").slice(0, 20), offset }), "utf8").toString("base64url"); }
function decodeScopedPageCursor(cursor: string | undefined, snapshotId: string, scope: string): number { if (!cursor) return 0; try { if (cursor.length > 4096) throw new Error(); const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { snapshotId?: string; scope?: string; offset?: number }; const expected = createHash("sha256").update(scope).digest("hex").slice(0, 20); if (value.snapshotId !== snapshotId || value.scope !== expected || !Number.isInteger(value.offset) || value.offset! < 0) throw new Error(); return value.offset!; } catch { throw new Error("分页游标无效或属于其他项目、快照或筛选条件"); } }
function encodeGraphCursor(value: CursorState): string { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function decodeGraphCursor(cursor: string, repositoryId: string, snapshotId: string, queryKey: string): CursorState { try { if (cursor.length > 65_536) throw new Error(); const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorState; if (value.version !== 2 || value.repositoryId !== repositoryId || value.snapshotId !== snapshotId || value.queryKey !== queryKey || !Array.isArray(value.queue) || value.queue.length > 5_000 || !value.queue.every((item) => item && typeof item.nodeId === "string" && item.nodeId.length > 0 && Number.isInteger(item.depth) && item.depth >= 0 && item.depth <= 8 && (item.afterEdgeId === undefined || typeof item.afterEdgeId === "string")) || !Array.isArray(value.seenNodes) || value.seenNodes.length > 5_000 || !value.seenNodes.every((item) => typeof item === "string" && item.length > 0)) throw new Error(); return value; } catch { throw new Error("继续探索游标无效、已损坏或属于其他项目、快照或查询"); } }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { return [...new Map(items.map((item) => [key(item), item])).values()]; }
function rangesOverlap(a: Evidence["span"], b: Evidence["span"]): boolean { const compare = (al: number, ac: number, bl: number, bc: number) => al - bl || ac - bc; return a.filePath === b.filePath && compare(a.startLine, a.startColumn, b.endLine, b.endColumn) < 0 && compare(b.startLine, b.startColumn, a.endLine, a.endColumn) < 0; }

export function queryFlow(snapshot: ProjectSnapshot, rootNodeId: string, depth = 3): FlowResult {
  const boundedDepth = Math.max(1, Math.min(depth, 6));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const selectedNodeIds = new Set<string>([rootNodeId]);
  const selectedEdges = new Map<string, GraphEdge>();
  let frontier = new Set<string>([rootNodeId]);

  for (let level = 0; level < boundedDepth && frontier.size > 0; level += 1) {
    const next = new Set<string>();
    for (const edge of snapshot.edges) {
      if (frontier.has(edge.source) || frontier.has(edge.target)) {
        selectedEdges.set(edge.id, edge);
        for (const id of [edge.source, edge.target]) {
          if (nodeById.has(id) && !selectedNodeIds.has(id)) next.add(id);
          selectedNodeIds.add(id);
        }
      }
    }
    frontier = next;
  }

  const unknowns = [...selectedEdges.values()]
    .filter((edge) => edge.confidence === "unknown")
    .map((edge) => edge.unresolvedTarget ? `无法静态解析调用目标：${edge.unresolvedTarget}` : `关系 ${edge.id} 无法确认`);
  return {
    repositoryId: snapshot.repositoryId,
    snapshotId: snapshot.snapshotId,
    rootNodeId,
    nodes: [...selectedNodeIds].map((id) => nodeById.get(id)).filter((node): node is GraphNode => Boolean(node)),
    edges: [...selectedEdges.values()],
    unknowns: [...new Set(unknowns)],
  };
}

export function searchNodes(snapshot: ProjectSnapshot, query: string, limit = 20): GraphNode[] {
  const terms = query.toLocaleLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((term) => term.length > 1);
  return snapshot.nodes
    .map((node) => {
      const haystack = `${node.name} ${node.qualifiedName} ${node.filePath ?? ""}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { node, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name))
    .slice(0, limit)
    .map((item) => item.node);
}

export function evidenceForEdges(snapshot: ProjectSnapshot, edges: GraphEdge[]): Evidence[] {
  const ids = new Set(edges.map((edge) => edge.evidenceId));
  return snapshot.evidence.filter((item) => ids.has(item.id));
}
