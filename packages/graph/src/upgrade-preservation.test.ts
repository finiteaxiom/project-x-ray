import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalSnapshotResult, computeOwnershipAttemptHash, computeOwnershipCapsuleHash, computeOwnershipLimitationId, computeOwnershipQuestionFingerprint, computeOwnershipRubricHash, computeOwnershipSubmissionProjectionHash, hashOwnershipAnswer, ownershipSubmissionSchema, remotePersistentTaskRecordSchema, remoteResultSchema, type OwnershipAttempt, type OwnershipCapsule, type OwnershipQuestion, type OwnershipReadyCapsule, type ProjectSnapshot, type RemoteCapturedIdentity } from "@project-xray/contracts";
import { GraphStore, overviewFromSnapshot } from "./index.js";

// These capabilities are minted by this test only; no caller-supplied database roots.
interface Fixture { root: string; marker: string; handles: Array<Database.Database | GraphStore>; retain: boolean }
interface Entry { name: string; bytes: number; hash: string }
const fixtures: Fixture[] = [];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const database = (store: GraphStore) => (store as unknown as { database: Database.Database }).database;
function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xray-upgrade-"))), marker = randomUUID();
  writeFileSync(join(root, ".fixture"), marker, { flag: "wx" });
  const value = { root, marker, handles: [], retain: false }; fixtures.push(value); return value;
}
function path(f: Fixture, name: string): string {
  if (!fixtures.includes(f) || readFileSync(join(f.root, ".fixture"), "utf8") !== f.marker || realpathSync(f.root) !== f.root) throw new Error("Fixture boundary rejected");
  if (!/^(source|package|operation|restored|main-only|logical|held)(\.sqlite(?:-wal|-shm|-journal)?|(?:\/(?:source\.sqlite(?:-wal|-shm|-journal)?))?)$/.test(name) && name !== "COMPLETED") throw new Error("Fixture leaf rejected");
  const result = resolve(f.root, name); if (relative(f.root, result).startsWith("..") || !result.startsWith(f.root + sep)) throw new Error("Fixture boundary rejected");
  let item = result; while (item !== f.root) { if (existsSync(item) && lstatSync(item).isSymbolicLink()) throw new Error("Fixture link rejected"); item = dirname(item); }
  return result;
}
function raw(f: Fixture, name: string): Database.Database { const value = new Database(path(f, name)); f.handles.push(value); return value; }
function open(f: Fixture, name: string, role: "global" | "project" = "project"): GraphStore { const value = new GraphStore(path(f, name), role); f.handles.push(value); return value; }
function close(f: Fixture): void { for (const handle of f.handles.splice(0).reverse()) { if (handle instanceof GraphStore) { if (database(handle).open) handle.close(); } else if (handle.open) handle.close(); } }
afterEach(() => { for (const f of fixtures) { close(f); if (!f.retain) { path(f, "source.sqlite"); if (!f.root.startsWith(realpathSync(tmpdir()) + sep)) throw new Error("Fixture cleanup rejected"); rmSync(f.root, { recursive: true, force: true }); } } fixtures.length = 0; });
function inventory(f: Fixture, folder = ""): Entry[] {
  const entries: Entry[] = []; let total = 0;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const name = `source.sqlite${suffix}`, file = path(f, folder ? `${folder}/${name}` : name);
    if (!existsSync(file)) continue;
    if (!lstatSync(file).isFile()) throw new Error("Fixture file rejected");
    const size = lstatSync(file).size; total += size; if (total > 16 * 1024 * 1024) throw new Error("Fixture budget rejected");
    const bytes = readFileSync(file); if (bytes.length !== size) throw new Error("Fixture changed"); entries.push({ name, bytes: size, hash: hash(bytes) });
  }
  if (!entries.some(item => item.name === "source.sqlite")) throw new Error("Fixture main missing"); return entries;
}
function copySet(f: Fixture, from: string, to: string, entries: Entry[]): void {
  mkdirSync(path(f, to));
  for (const item of entries) copyFileSync(path(f, from ? `${from}/${item.name}` : item.name), path(f, `${to}/${item.name}`), constants.COPYFILE_EXCL);
  expect(inventory(f, to)).toEqual(entries);
}
function preserve(f: Fixture) {
  if (f.handles.some(handle => handle instanceof GraphStore ? database(handle).open : handle.open)) throw new Error("Fixture writer active");
  const entries = inventory(f); copySet(f, "", "package", entries); expect(inventory(f)).toEqual(entries);
  copySet(f, "package", "operation", entries);
  return { entries, restore: () => copySet(f, "package", "restored", entries), unchanged: () => { expect(inventory(f)).toEqual(entries); expect(inventory(f, "package")).toEqual(entries); }, complete: () => { expect(inventory(f)).toEqual(entries); expect(inventory(f, "package")).toEqual(entries); writeFileSync(path(f, "COMPLETED"), "fixture-verified", { flag: "wx" }); } };
}
const content = "caller(callee); // 自有🙂\n";
const span = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 14 };
function snapshot(): ProjectSnapshot {
  const value: ProjectSnapshot = { repositoryId: "repo", snapshotId: "snap", name: "fixture", rootPath: "C:/fixture", sourceType: "local", createdAt: "2026-01-02T00:00:00.000Z",
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { fixture: "1" }, configurationHash: hash("config"), sourceFingerprint: hash(content) }, sourceFiles: [{ filePath: "a.ts", bytes: Buffer.byteLength(content), contentHash: hash(content), language: "TypeScript" }],
    nodes: ["caller", "callee"].map(id => ({ id, snapshotId: "snap", kind: "function", name: id, qualifiedName: id, filePath: "a.ts", metadata: {} })),
    edges: [{ id: "call", snapshotId: "snap", source: "caller", target: "callee", kind: "CALLS", confidence: "verified", evidenceId: "proof", reason: "fixture syntax" }],
    evidence: [{ id: "proof", snapshotId: "snap", analyzer: "fixture", analyzerVersion: "1", kind: "call-expression", confidence: "verified", reason: "fixture syntax", span }],
    health: { status: "partial", totalFiles: 2, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 1, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: ["fixture unsupported language"] } };
  value.analysisIdentity.analysisResult = { version: "1.0.0", fingerprint: hash(canonicalSnapshotResult(value)) }; return value;
}
function attempt(id: string): OwnershipAttempt {
  return { attemptId: id, repositoryId: "repo", snapshotId: "snap", questionId: "q", questionVersion: "2.0.0", concept: { id: "call:caller:callee", label: "静态调用方向" }, questionKind: "call-direction", variantKey: "call:caller:callee", structuredAnswer: { kind: "call-direction", callerNodeId: "caller", calleeNodeId: "callee" }, citations: [{ ...span, evidenceId: "proof" }], locationScore: 100, structureScore: 100, passed: true, scoringVersion: "2.1.0", semanticText: "caller在此静态调用callee。", completedAt: "2026-02-03T04:05:06.000Z", legacy: false };
}
function seedRaw(f: Fixture, profile: "legacy" | "pre" | "nine"): void {
  const db = raw(f, "source.sqlite");
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES(1,'frozen-1');
    CREATE TABLE snapshots(snapshot_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,root_path TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE evidence(snapshot_id TEXT NOT NULL,evidence_id TEXT NOT NULL,file_path TEXT NOT NULL,start_line INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,evidence_id));
    CREATE TABLE snapshot_overviews(snapshot_id TEXT PRIMARY KEY,repository_id TEXT NOT NULL,created_at TEXT NOT NULL,${profile !== "legacy" ? "is_current INTEGER NOT NULL DEFAULT 1," : ""}${profile === "nine" ? "activated_at TEXT NOT NULL DEFAULT ''," : ""}payload TEXT NOT NULL);
    CREATE TABLE mastery_records(snapshot_id TEXT NOT NULL,question_id TEXT NOT NULL,concept TEXT NOT NULL,score INTEGER NOT NULL,completed_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,question_id));`);
  const value = snapshot(), old = profile === "legacy" ? { ...value, analysisIdentity: undefined, sourceFiles: undefined } : value;
  db.prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)").run("snap", "repo", value.rootPath, value.createdAt, JSON.stringify(old));
  db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?)").run("snap", "proof", "a.ts", 1, JSON.stringify(value.evidence[0]));
  // A valid overview derived without invoking a migration or an application on the source.
  const overview = overviewFromSnapshot(value);
  db.prepare(`INSERT INTO snapshot_overviews(snapshot_id,repository_id,created_at,${profile !== "legacy" ? "is_current," : ""}${profile === "nine" ? "activated_at," : ""}payload) VALUES(?,?,?,${profile !== "legacy" ? "1," : ""}${profile === "nine" ? "'2026-03-04T00:00:00.000Z'," : ""}?)`).run("snap", "repo", value.createdAt, JSON.stringify(overview));
  const mastery = { repositoryId: "repo", snapshotId: "snap", questionId: "old-q", concept: "old-concept", score: 57, completedAt: "2026-01-03T00:00:00.000Z" };
  db.prepare("INSERT INTO mastery_records VALUES(?,?,?,?,?,?)").run("snap", "old-q", "old-concept", 57, mastery.completedAt, JSON.stringify(mastery));
  if (profile === "nine") db.exec(`CREATE TABLE project_ignore_settings(repository_id TEXT PRIMARY KEY,payload TEXT NOT NULL); INSERT INTO project_ignore_settings VALUES('repo','{"version":"1.0.0","revision":4,"rules":["generated/**"]}'); INSERT INTO schema_migrations VALUES(8,'frozen-8'),(9,'frozen-9');`);
  close(f);
}
function dump(db: Database.Database): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]) {
    if (!/^[a-z_]+$/.test(name)) throw new Error("Fixture table rejected");
    const keys = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; pk: number }[]).filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error("Fixture column rejected");
    const rows = db.prepare(`SELECT * FROM ${name}${keys.length ? ` ORDER BY ${keys.join(",")}` : ""}`).all(); result[name] = keys.length ? rows : rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}
function oldRowsPreserved(before: Record<string, unknown[]>, after: Record<string, unknown[]>): void {
  for (const [table, rows] of Object.entries(before)) {
    if (table === "schema_migrations") { for (const row of rows) expect(after[table]).toContainEqual(row); continue; }
    expect(after[table]?.length).toBe(rows.length);
    for (const [i, row] of rows.entries()) for (const [column, value] of Object.entries(row as object)) expect((after[table]![i] as Record<string, unknown>)[column]).toEqual(value);
  }
}
function inspect(f: Fixture, name: string) { const db = raw(f, name); const rows = dump(db); expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]); expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  if (rows.ownership_semantic_capsules) { expect(db.prepare("PRAGMA foreign_key_list(ownership_semantic_capsules)").all()).toContainEqual(expect.objectContaining({ table: "ownership_attempts", from: "attempt_id", to: "attempt_id", on_delete: "CASCADE" })); expect((db.prepare("SELECT sql FROM sqlite_master WHERE name='ownership_semantic_capsules'").get() as { sql: string }).sql).toContain("CHECK(status IN ('ready','not-evaluated'))"); }
  if (rows.explanation_tasks) expect(db.prepare("PRAGMA index_list(explanation_tasks)").all()).toContainEqual(expect.objectContaining({ name: "explanation_single_dispatch", unique: 1, partial: 1 }));
  db.close(); return rows; }
async function seedCurrent(f: Fixture, role: "global" | "project", capsules = false): Promise<ProjectSnapshot> {
  const store = open(f, "source.sqlite", role), value = snapshot();
  store.saveSnapshot(value, [{ filePath: "a.ts", contentHash: hash(content), language: "TypeScript", content }]); store.saveOwnershipAttempt(attempt("absent"));
  store.saveMastery({ repositoryId: "repo", snapshotId: "snap", questionId: "old-q", concept: "old", score: 57, completedAt: "2026-01-03T00:00:00.000Z" });
  const side = { label: "HEAD", kind: "commit", revision: "a".repeat(40), contentFingerprint: hash(content), manifestFingerprint: hash("manifest"), capturedAt: "2026-01-01T00:00:00.000Z", snapshot: { repositoryId: "repo", snapshotId: "snap" }, analysisIdentity: value.analysisIdentity };
  const report = { version: "1.0.0", id: "old-report", repositoryId: "repo", mode: "staged", createdAt: "2026-01-01T00:00:00.000Z", left: side, right: { ...side, kind: "index", revision: undefined }, captureFingerprint: hash("capture"), status: "current", files: [], impactPaths: [], truncated: false, truncationReasons: [], failures: [], limitations: [] };
  database(store).prepare("INSERT INTO change_reports VALUES(?,?,?,?,?)").run(report.id, report.repositoryId, report.createdAt, report.captureFingerprint, JSON.stringify(report));
  if (capsules) {
    const question: OwnershipQuestion = { repositoryId: "repo", snapshotId: "snap", id: "q", version: "2.0.0", kind: "call-direction", prompt: "解释静态调用方向", concept: attempt("ready").concept, learningObjective: "定位证据", difficulty: "easy", choices: [], evidenceIds: ["proof"], expectedNodeIds: ["caller", "callee"], deterministicChecks: [{ kind: "call-direction", sourceNodeId: "caller", targetNodeId: "callee", edgeId: "call" }], variantKey: "call:caller:callee" };
    const source = store.captureOwnershipSource("repo", "snap", 0), sourceIdentity = { activation: source.activation, analysisResultFingerprint: value.analysisIdentity.analysisResult!.fingerprint, configurationHash: value.analysisIdentity.configurationHash, ignorePolicyHash: null, sourceManifestHash: source.sourceManifestHash, ignoreRevision: 0 };
    for (const ready of [true, false]) {
      const record = attempt(ready ? "ready" : "not-evaluated"), questionFingerprint = await computeOwnershipQuestionFingerprint(question), attemptHash = await computeOwnershipAttemptHash(record), answerHash = await hashOwnershipAnswer(record.semanticText);
      let capsule: OwnershipCapsule;
      if (!ready) capsule = { version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason: "rubric-budget-exceeded", questionFingerprint, attemptHash, answerHash, submissionProjectionHash: null, sourceIdentity, capsuleHash: "0".repeat(64) };
      else {
        const limitations: OwnershipReadyCapsule["rubric"]["limitations"] = [];
        for (const code of ["static-only", "answer-information-insufficient"] as const) { const item = { code, criterionIds: ["direction"], relatedEvidenceIds: code === "static-only" ? ["proof"] : [], description: "仅静态证据" }; limitations.push({ ...item, limitationId: await computeOwnershipLimitationId(item) }); }
        const rubric = { version: "1.0.0" as const, questionId: "q", questionVersion: "2.0.0", questionFingerprint, questionKind: "call-direction" as const, learningObjective: question.learningObjective, criteria: [{ criterionId: "direction", proposition: "caller静态调用callee", weight: 100, requiredEvidenceIds: ["proof"], allowedEvidenceIds: ["proof"], allowedLimitationIds: limitations.map(item => item.limitationId), answerScope: [{ start: 0, end: record.semanticText.length }] }], limitations, selectedPath: null };
        const structured = ownershipSubmissionSchema.shape.structuredAnswer.parse(record.structuredAnswer);
        const projection = { originalCitations: record.citations, originalStructuredAnswer: structured, citationOrder: [0], roleBindings: [], normalizedStructuredAnswer: structured, validatedCitations: record.citations };
        capsule = { version: "1.0.0", builderVersion: "1.0.0", status: "ready", repositoryId: "repo", snapshotId: "snap", attemptId: record.attemptId, questionId: "q", questionVersion: "2.0.0", questionKind: "call-direction", variantKey: question.variantKey, prompt: question.prompt, learningObjective: question.learningObjective, questionFingerprint, attemptHash, answerHash, submissionProjectionHash: await computeOwnershipSubmissionProjectionHash(projection), deterministicScoringVersion: "2.1.0", sourceIdentity,
          analysisIdentity: { ...value.analysisIdentity, ignorePolicy: null, analysisResult: value.analysisIdentity.analysisResult! }, rubric: { ...rubric, rubricHash: await computeOwnershipRubricHash(rubric) }, citationOrder: [0], roleBindings: [], necessaryNodeIds: ["callee", "caller"], necessaryEdgeIds: ["call"], necessaryProofs: [{ evidenceId: "proof", kind: "call-expression", filePath: "a.ts", span, analyzer: "fixture", analyzerVersion: "1", confidence: "verified", contentHash: hash(content) }], createdAt: record.completedAt, capsuleHash: "0".repeat(64) };
      }
      capsule.capsuleHash = await computeOwnershipCapsuleHash(capsule); store.savePreparedOwnershipAttempt(await store.prepareOwnershipAttemptWithCapsule({ question, attempt: record, capsule, source }));
    }
  }
  // Configuration changes after publication must not rewrite historical capsules.
  store.saveIgnoreSettings("repo", 0, ["generated/**"]);
  if (role === "global") {
    store.remote.saveProvider(0, { provider: "openai", model: "fixture-model", outputTokens: 32, credentialStatus: "configured", credentialRevision: 1 }); store.remote.saveAuthorization("repo", 0, true);
    const context = store.remote.commitTrustedContext(randomUUID(), store.remote.activation("repo", "snap"));
    const identity: RemoteCapturedIdentity = { protocolVersion: "1.0.0", taskId: randomUUID(), repositoryId: "repo", snapshotId: "snap", analysisResultFingerprint: value.analysisIdentity.analysisResult!.fingerprint, configurationHash: value.analysisIdentity.configurationHash, ignorePolicyHash: null, sourceManifestHash: sourceManifest(store), activation: context.reference!.activation, ignoreRevision: 1, authorizationRevision: 1, providerRevision: 1, credentialRevision: 1, contextEpoch: context.epoch, ownerSessionId: context.ownerSessionId, contextHandle: context.contextHandle, packageId: hash("package"), bodyDigest: hash("body"), limitsVersion: "1.0.0" };
    // Schema-validated self-owned historical data, no provider/network dispatch.
    const task = remotePersistentTaskRecordSchema.parse({ identity, phase: "completed", createdAt: "2026-02-03T00:00:00.000Z", completedAt: "2026-02-03T00:00:01.000Z", code: null });
    const result = remoteResultSchema.parse({ version: "1.0.0", identity, narrative: { version: "1.0.0", repositoryId: "repo", snapshotId: "snap", packageId: identity.packageId, claims: [{ text: "自有静态解释历史", evidenceIds: ["proof"], confidence: "inferred" }], unknowns: [] }, checkedAt: task.createdAt, completedAt: task.completedAt,
      localUnknowns: [], localLimitations: ["fixture partial"], localTruncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 }, citations: [{ id: "proof", kind: "call-expression", span, sliceSpan: span, analyzer: "fixture", analyzerVersion: "1", confidence: "verified", contentHash: hash(content) }], unknownEvidenceIds: [] });
    store.remote.immediate(() => { database(store).prepare("INSERT INTO explanation_tasks VALUES(?,?,?,?,0)").run(identity.taskId, context.ownerSessionId, "completed", JSON.stringify(task)); store.remote.appendResult(result); });
  }
  close(f); return value;
}
function sourceManifest(store: GraphStore) { return store.remote.activation("repo", "snap").sourceManifestHash; }

describe("upgrade preservation: self-owned structural fixtures, not product backup", () => {
  it.each(["legacy", "pre", "nine"] as const)("raw %s migration preserves old bytes/times and declares only compatibility additions", profile => {
    const f = fixture(); seedRaw(f, profile); const before = inspect(f, "source.sqlite"), pack = preserve(f);
    for (const folder of ["operation", "restored"]) {
      if (folder === "restored") pack.restore(); const store = open(f, `${folder}/source.sqlite`), loaded = store.loadSnapshot("snap")!;
      expect(loaded.repositoryId).toBe("repo"); expect(loaded.health.status).toBe("partial"); if (profile === "legacy") { expect(loaded.analysisIdentity.graphIrVersion).toBe("legacy-1.0"); expect(loaded.sourceFiles).toEqual([]); }
      expect(store.getLatestOverview()?.snapshotId).toBe("snap"); expect(store.getEvidence("snap", "proof")).toEqual(snapshot().evidence[0]); expect(store.readSnapshotSource("snap", "a.ts")).toBeNull(); expect(store.listOwnershipAttempts("repo")[0]).toMatchObject({ legacy: true, score: 57, passed: false });
      expect(store.getCurrentActivation()).toBe(profile === "nine" ? "2026-03-04T00:00:00.000Z" : snapshot().createdAt); close(f);
      const after = inspect(f, `${folder}/source.sqlite`); oldRowsPreserved(before, after); expect(after.schema_migrations).toHaveLength(11);
      const check = raw(f, `${folder}/source.sqlite`); expect(check.prepare("SELECT start_column,end_line,end_column FROM evidence").get()).toEqual({ start_column: 0, end_line: 1, end_column: 0 }); check.close();
      const reopened = open(f, `${folder}/source.sqlite`); expect(reopened.loadSnapshot("snap")).toEqual(loaded); close(f); pack.unchanged();
    }
    pack.complete();
  });
  it.each(["global", "project"] as const)("current11 %s preserves source, complete raw data, roles and ready/not-evaluated/absent history", async role => {
    const f = fixture(), value = await seedCurrent(f, role, true), before = inspect(f, "source.sqlite"), pack = preserve(f);
    for (const folder of ["operation", "restored"]) {
      if (folder === "restored") pack.restore();
      for (let i = 0; i < 2; i++) {
        const store = open(f, `${folder}/source.sqlite`, role); expect(store.loadSnapshot("snap")).toEqual(value); expect(store.readSnapshotSource("snap", "a.ts")).toEqual({ content, contentHash: hash(content), language: "TypeScript" });
        expect(await store.loadOwnershipCapsule("ready")).toMatchObject({ status: "ready", capsule: { status: "ready" } }); expect(await store.loadOwnershipCapsule("not-evaluated")).toMatchObject({ status: "not-evaluated" }); expect(await store.loadOwnershipCapsule("absent")).toEqual({ status: "legacy-capsule-absent" });
        expect(store.loadChangeReport("old-report")?.completeness.status).toBe("partial");
        if (role === "global") { expect(store.remote.provider()).toMatchObject({ model: "fixture-model", revision: 1, credentialRevision: 1 }); expect(store.remote.authorization("repo")).toMatchObject({ status: "granted", revision: 1 });
          const task = (before.explanation_tasks![0] as { task_id: string }).task_id; expect(store.remote.task(task)).toMatchObject({ phase: "completed", code: null }); expect(store.remote.result(task)?.identity.taskId).toBe(task);
        } else expect(() => store.remote.provider()).toThrow();
        close(f); expect(inspect(f, `${folder}/source.sqlite`)).toEqual(before); pack.unchanged();
      }
    }
    pack.complete();
  });
  it("reconstructed schema10 adds capsule table without inventing capsules or rewriting historical attempts", async () => {
    const f = fixture(); await seedCurrent(f, "project"); const db = raw(f, "source.sqlite"); db.exec("DROP TABLE ownership_semantic_capsules; DELETE FROM schema_migrations WHERE version=11"); db.close();
    const before = inspect(f, "source.sqlite"), pack = preserve(f); pack.restore();
    for (const folder of ["operation", "restored"]) { const store = open(f, `${folder}/source.sqlite`); expect(await store.loadOwnershipCapsule("absent")).toEqual({ status: "legacy-capsule-absent" }); close(f); const after = inspect(f, `${folder}/source.sqlite`); oldRowsPreserved(before, after); expect(after.ownership_semantic_capsules).toEqual([]); pack.unchanged(); }
    pack.complete();
  });
  it.each([10, 11])("real version%s trigger failure retains earlier commits; raw restoration and isolated retry preserve source", async version => {
    const f = fixture(); seedRaw(f, "nine"); const db = raw(f, "source.sqlite"); db.exec(`CREATE TRIGGER reject_upgrade BEFORE INSERT ON schema_migrations WHEN NEW.version=${version} BEGIN SELECT RAISE(ABORT,'fixture migration cut'); END`); db.close();
    const before = inspect(f, "source.sqlite"), pack = preserve(f);
    expect(() => open(f, "operation/source.sqlite", "global")).toThrow(); const after = inspect(f, "operation/source.sqlite"); oldRowsPreserved(before, after);
    expect((after.schema_migrations as { version: number }[]).some(row => row.version === version)).toBe(false); expect((after.schema_migrations as { version: number }[]).some(row => row.version === 7)).toBe(true); if (version === 11) expect(after.remote_provider_settings).toEqual([]);
    const retry = raw(f, "operation/source.sqlite"); retry.exec("BEGIN IMMEDIATE; ROLLBACK; DROP TRIGGER reject_upgrade"); retry.close(); const store = open(f, "operation/source.sqlite", "global"); expect(store.loadSnapshot("snap")?.snapshotId).toBe("snap"); close(f);
    pack.restore(); expect(inspect(f, "restored/source.sqlite")).toEqual(before); expect(() => open(f, "restored/source.sqlite", "global")).toThrow(); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("busy real second connection releases locks after constructor failure and retries without source change", () => {
    const f = fixture(); seedRaw(f, "nine"); const pack = preserve(f), held = raw(f, "operation/source.sqlite"); held.exec("BEGIN IMMEDIATE");
    expect(() => open(f, "operation/source.sqlite")).toThrow(); held.exec("ROLLBACK"); held.close(); const store = open(f, "operation/source.sqlite"); expect(store.loadSnapshot("snap")?.health.status).toBe("partial"); close(f); pack.restore(); const restored = open(f, "restored/source.sqlite"); expect(restored.loadSnapshot("snap")?.snapshotId).toBe("snap"); close(f); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("base normalization trigger fails after real early commits, retaining original evidence payload and recoverable package", () => {
    const f = fixture(); seedRaw(f, "pre"); const setup = raw(f, "source.sqlite"); setup.exec("CREATE TRIGGER reject_normalization BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT,'fixture base cut'); END"); setup.close();
    const before = inspect(f, "source.sqlite"), pack = preserve(f); expect(() => open(f, "operation/source.sqlite")).toThrow();
    const after = inspect(f, "operation/source.sqlite"); oldRowsPreserved(before, after); expect(after.schema_migrations).toContainEqual(expect.objectContaining({ version: 3 })); expect(after.schema_migrations).not.toContainEqual(expect.objectContaining({ version: 4 }));
    const retry = raw(f, "operation/source.sqlite"); retry.exec("BEGIN IMMEDIATE; ROLLBACK; DROP TRIGGER reject_normalization"); retry.close(); const store = open(f, "operation/source.sqlite"); expect(store.getEvidence("snap", "proof")).toEqual(snapshot().evidence[0]); close(f);
    pack.restore(); expect(inspect(f, "restored/source.sqlite")).toEqual(before); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("known future/role gaps are observations on copies, never protection acceptance", async () => {
    const f = fixture(); await seedCurrent(f, "project"); const db = raw(f, "source.sqlite"); db.exec("INSERT INTO schema_migrations VALUES(12,'future-frozen'); CREATE TABLE future_notes(payload TEXT); INSERT INTO future_notes VALUES('fixture future')"); db.close();
    const before = inspect(f, "source.sqlite"), pack = preserve(f), wrong = open(f, "operation/source.sqlite", "global"); expect(wrong.remote.provider().credentialStatus).toBe("unconfigured"); close(f);
    const after = inspect(f, "operation/source.sqlite"); oldRowsPreserved(before, after); expect(after.remote_provider_settings).toEqual([]); expect(after.future_notes).toEqual(before.future_notes); pack.restore(); expect(inspect(f, "restored/source.sqlite")).toEqual(before); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
  });
  it("fixture guards reject active writers, duplicate output, invalid leaf and capacity without completion", () => {
    const f = fixture(); seedRaw(f, "nine"); const held = raw(f, "source.sqlite"); held.exec("BEGIN IMMEDIATE"); expect(() => preserve(f)).toThrow("writer active"); held.exec("ROLLBACK"); held.close();
    expect(() => path(f, "../escape.sqlite")).toThrow(); const pack = preserve(f); expect(() => preserve(f)).toThrow(); pack.unchanged(); expect(existsSync(path(f, "COMPLETED"))).toBe(false);
    const over = fixture(); writeFileSync(path(over, "source.sqlite"), Buffer.alloc(16 * 1024 * 1024 + 1)); expect(() => preserve(over)).toThrow("budget rejected"); expect(existsSync(path(over, "package"))).toBe(false); expect(existsSync(path(over, "COMPLETED"))).toBe(false);
  });
  it("actual fixture directory junction is rejected before copying, without traversing or deleting its target", () => {
    const f = fixture(); seedRaw(f, "nine"); mkdirSync(path(f, "held")); symlinkSync(path(f, "held"), join(f.root, "package"), "junction");
    try { expect(() => preserve(f)).toThrow("link rejected"); expect(existsSync(path(f, "COMPLETED"))).toBe(false); expect(inventory(f)).toHaveLength(1); }
    finally { rmSync(join(f.root, "package")); } // Delete only this known junction, never recursively follow it.
    expect(lstatSync(path(f, "held")).isDirectory()).toBe(true);
  });
});

// Fixed inline child. It parks after IPC; only its parent's taskkill defines the crash cut.
const childCode = String.raw`if (process.argv[3] === 'silent') { setInterval(() => {}, 1000); }
else { const Database = require(process.argv[1]);
const db = new Database(process.argv[2]);
db.pragma('journal_mode=WAL'); db.pragma('wal_autocheckpoint=0');
process.send({kind:'ready',fixtureId:'wal',rows:0});
if (process.argv[3] === 'wait') { setInterval(() => {}, 1000); }
else { db.exec("CREATE TABLE marker(id TEXT PRIMARY KEY,payload TEXT)");
db.transaction(() => db.prepare('INSERT INTO marker VALUES(?,?)').run('committed','fixture-only'))();
if (db.prepare("SELECT id FROM marker WHERE id='committed'").get()?.id !== 'committed') throw Error('fixture cut');
process.send({kind:'committed',fixtureId:'wal',rows:1}); setInterval(() => {}, 1000); } }`;
async function walChild(f: Fixture, options: { signal?: AbortSignal; wait?: boolean; silent?: boolean } = {}): Promise<void> {
  if (options.signal?.aborted) throw new Error("Fixture cancelled");
  const module = createRequire(import.meta.url).resolve("better-sqlite3"), file = path(f, "source.sqlite");
  let child: ChildProcess | undefined, closed = false, terminated = false, expired = false, ipcFault = false, stop: Promise<void> | undefined, onAbort: (() => void) | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const timer = (work: () => void, ms: number) => { const value = setTimeout(work, ms); timers.add(value); return value; };
  try {
    child = spawn(process.execPath, ["-e", childCode, module, file, options.silent ? "silent" : options.wait ? "wait" : "commit"], { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const handle = child;
    const done = new Promise<void>(resolve => handle.once("close", () => { closed = true; resolve(); }));
    // No propagation of raw spawn/SQLite errors or child output.
    let fail!: (error: Error) => void, ready = false, committed = false;
    const phase = new Promise<void>((resolve, reject) => {
      fail = reject;
      onAbort = () => reject(new Error("Fixture cancelled")); options.signal?.addEventListener("abort", onAbort, { once: true }); if (options.signal?.aborted) onAbort();
      handle.once("error", () => reject(new Error("Fixture startup failed")));
      handle.once("exit", () => { if (!committed) reject(new Error("Fixture early exit")); });
      handle.on("message", message => {
        if (!message || typeof message !== "object" || Object.keys(message).sort().join() !== "fixtureId,kind,rows") { ipcFault = true; return reject(new Error("Fixture IPC rejected")); }
        const value = message as { fixtureId: string; kind: string; rows: number };
        if (value.fixtureId !== "wal") { ipcFault = true; return reject(new Error("Fixture IPC rejected")); }
        if (value.kind === "ready" && value.rows === 0 && !ready && !committed) { ready = true; return; }
        if (value.kind === "committed" && value.rows === 1 && ready && !committed) { committed = true; resolve(); return; }
        ipcFault = true; reject(new Error("Fixture IPC rejected"));
      });
      timer(() => { if (!ready) { expired = true; reject(new Error("Fixture startup timeout")); } }, 5_000);
      timer(() => { expired = true; reject(new Error("Fixture stage timeout")); }, options.wait || options.silent ? 350 : 15_000);
    });
    const terminate = (): Promise<void> => stop ??= (async () => {
      if (closed || !handle.pid) return;
      if (handle.exitCode !== null || handle.signalCode !== null) { await Promise.race([done, new Promise<never>((_, reject) => timer(() => reject(new Error("Fixture close timeout")), 2_500))]); return; }
      await new Promise<void>((resolve, reject) => {
        const kill = spawn("taskkill.exe", ["/PID", String(handle.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        kill.once("error", () => reject(new Error("Fixture termination failed"))); kill.once("close", code => { if (code === 0) { terminated = true; resolve(); } else reject(new Error("Fixture termination failed")); });
        timer(() => { kill.kill(); reject(new Error("Fixture termination timeout")); }, 2_500);
      });
      await Promise.race([done, new Promise<never>((_, reject) => timer(() => reject(new Error("Fixture close timeout")), 2_500))]);
    })();
    try { await phase; await terminate(); if (options.signal?.aborted) throw new Error("Fixture cancelled"); if (expired) throw new Error("Fixture stage timeout"); if (ipcFault) throw new Error("Fixture IPC rejected"); if (!committed || !closed || !terminated || handle.exitCode === null && handle.signalCode === null) throw new Error("Fixture cut incomplete"); }
    catch (error) { fail(new Error("Fixture failed")); await terminate(); throw error; }
  } finally {
    for (const value of timers) clearTimeout(value);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    if (child) { if (closed) child.removeAllListeners(); else { f.retain = true; const pending = child; pending.once("close", () => pending.removeAllListeners()); } }
  }
}
describe("WAL fixture lifecycle (Windows, fixed owned child)", () => {
  it("actual committed WAL survives full-set restoration; main-only cannot stand in for backup", async () => {
    const f = fixture(); await walChild(f); const pack = preserve(f); expect(pack.entries.find(entry => entry.name === "source.sqlite-wal")?.bytes).toBeGreaterThan(0);
    mkdirSync(path(f, "main-only")); copyFileSync(path(f, "package/source.sqlite"), path(f, "main-only/source.sqlite"), constants.COPYFILE_EXCL);
    const missing = raw(f, "main-only/source.sqlite"); expect(missing.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='marker'").get()).toBeUndefined(); missing.close();
    for (const folder of ["operation", "restored"]) { if (folder === "restored") pack.restore(); const db = raw(f, `${folder}/source.sqlite`); expect(db.prepare("SELECT * FROM marker").all()).toEqual([{ id: "committed", payload: "fixture-only" }]); db.close(); const reopened = raw(f, `${folder}/source.sqlite`); expect(reopened.prepare("SELECT id FROM marker").get()).toEqual({ id: "committed" }); reopened.close(); pack.unchanged(); }
    const logicalSource = raw(f, "operation/source.sqlite"); mkdirSync(path(f, "logical")); await logicalSource.backup(path(f, "logical/source.sqlite")); logicalSource.close(); const logical = raw(f, "logical/source.sqlite"); expect(logical.prepare("SELECT id FROM marker").get()).toEqual({ id: "committed" }); logical.close(); pack.unchanged(); pack.complete();
  }, 25_000);
  it("pre-cancelled starts no child and creates no source or completion", async () => { const f = fixture(), abort = new AbortController(); abort.abort(); await expect(walChild(f, { signal: abort.signal })).rejects.toThrow("cancelled"); expect(existsSync(path(f, "source.sqlite"))).toBe(false); expect(existsSync(path(f, "COMPLETED"))).toBe(false); });
  it("real child waiting before committed times out, tree exits, and never publishes protection completion", async () => { const f = fixture(); await expect(walChild(f, { wait: true })).rejects.toThrow("timeout"); expect(f.retain).toBe(false); expect(existsSync(path(f, "package"))).toBe(false); expect(existsSync(path(f, "COMPLETED"))).toBe(false); }, 25_000);
  it("real child waiting before any IPC times out and is closed before fixture cleanup", async () => { const f = fixture(); await expect(walChild(f, { silent: true })).rejects.toThrow("timeout"); expect(f.retain).toBe(false); expect(existsSync(path(f, "source.sqlite"))).toBe(false); expect(existsSync(path(f, "COMPLETED"))).toBe(false); }, 25_000);
  it("active cancellation terminates only the owned child, waits close and has no completion", async () => { const f = fixture(), abort = new AbortController(), timer = setTimeout(() => abort.abort(), 50); try { await expect(walChild(f, { signal: abort.signal, silent: true })).rejects.toThrow("cancelled"); } finally { clearTimeout(timer); } expect(f.retain).toBe(false); expect(existsSync(path(f, "COMPLETED"))).toBe(false); }, 25_000);
});
