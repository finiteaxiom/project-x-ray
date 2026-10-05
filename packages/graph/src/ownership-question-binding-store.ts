import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  canonicalJson, IGNORE_POLICY_VERSION, ownershipQuestionSchema, ownershipAttemptSchema, ownershipAttemptPreimage, ownershipQuestionPreimage, ownershipQuestionRequestSchema,
  ownershipQuestionBindingBasisSchema, ownershipQuestionBindingRecordSchema, OWNERSHIP_QUESTION_BINDING_LIMITS,
  type OwnershipAttempt, type OwnershipQuestion, type OwnershipQuestionRequest, type OwnershipCapsule, type ProjectSnapshot,
  type OwnershipQuestionBindingBasis, type OwnershipQuestionBindingRecord, type OwnershipQuestionBindingRead,
  ownershipCapsuleSchema, ownershipCapsulePreimage, type OwnershipQuestionGeneratorPort,
} from "@project-xray/contracts";
import type { OwnershipSettingsAuthority, OwnershipSourceCapture } from "./ownership-capsule-store.js";

// This internal error is normalized by capsule/application boundaries; it never carries SQL text.
export class OwnershipQuestionBindingStoreError extends Error {
  constructor() { super("所有权原题绑定失败"); this.name = "OwnershipQuestionBindingStoreError"; }
}
function fail(): never { throw new OwnershipQuestionBindingStoreError(); }
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
interface Material { snapshot: ProjectSnapshot; activation: string; current: boolean; manifestHash: string }
type Row = Record<string, unknown>;
type Reason = Extract<OwnershipQuestionBindingRecord, { status: "unavailable" }>["reason"];
interface Issued { preimage: string; basis: OwnershipQuestionBindingBasis | null; reason: Reason | null; source: OwnershipSourceCapture; settings: OwnershipSettingsAuthority }
export type OwnershipQuestionIssuance = Readonly<object>;
const tableSql = `CREATE TABLE ownership_question_bindings(
  attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES ownership_attempts(attempt_id) ON DELETE CASCADE,repository_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,
  question_id TEXT NOT NULL,question_version TEXT NOT NULL,version TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('verified-generator','unavailable')),
  question_fingerprint TEXT NOT NULL,attempt_hash TEXT NOT NULL,capsule_hash TEXT NOT NULL,
  question_preimage TEXT CHECK(question_preimage IS NULL OR length(CAST(question_preimage AS BLOB))<=131072),
  basis_payload TEXT CHECK(basis_payload IS NULL OR length(CAST(basis_payload AS BLOB))<=8192),reason TEXT)`;

/** Source-only local authenticity material. Never a remote policy/task/permission port. */
export class OwnershipQuestionBindingStore {
  #issued = new WeakMap<object, Issued>();
  #closed = false;
  private readonly generator: OwnershipQuestionGeneratorPort | undefined;
  constructor(private readonly db: Database.Database, generator: OwnershipQuestionGeneratorPort | undefined,
    private readonly material: (repositoryId: string, snapshotId: string, capsule?: OwnershipCapsule) => Material,
    private readonly actualHistory: (repositoryId: string) => OwnershipAttempt[]) {
    this.generator = generator ? Object.freeze({ version: generator.version, orderingEngine: generator.orderingEngine ? structuredClone(generator.orderingEngine) : null,
      generate: generator.generate.bind(generator) }) : undefined;
  }
  private open(): void { if (this.#closed || !this.db.open) fail(); }
  private schema(): void {
    if (!this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=15").get()) fail();
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ownership_question_bindings'").get() as { sql: string } | undefined;
    if (!row || row.sql.trim() !== tableSql.trim()) fail();
  }
  migrate(): void {
    try { this.open(); this.db.transaction(() => {
      const migrated = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=15").get();
      if (!migrated) {
        if (this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='ownership_question_bindings'").get()) fail();
        this.db.exec(tableSql); this.db.prepare("INSERT INTO schema_migrations VALUES(15,?)").run(new Date().toISOString());
      }
      this.schema();
      for (const row of this.db.prepare("SELECT attempt_id FROM ownership_question_bindings").all() as { attempt_id: string }[]) this.load(row.attempt_id);
    }).immediate(); } catch { fail(); }
  }
  close(): void { this.#closed = true; this.#issued = new WeakMap(); }
  revoke(issuance: OwnershipQuestionIssuance): void { this.#issued.delete(issuance); }
  private source(material: Material, ignoreRevision: number): OwnershipSourceCapture {
    return { activation: material.activation, analysisIdentity: material.snapshot.analysisIdentity, sourceManifestHash: material.manifestHash, ignoreRevision };
  }
  private publication(source: OwnershipSourceCapture) {
    return { activation: source.activation, analysisResultFingerprint: source.analysisIdentity.analysisResult?.fingerprint ?? null,
      configurationHash: source.analysisIdentity.configurationHash, ignorePolicyHash: source.analysisIdentity.ignorePolicy?.hash ?? null,
      sourceManifestHash: source.sourceManifestHash, ignoreRevision: source.ignoreRevision };
  }
  private generatorHash(snapshot: ProjectSnapshot, request: OwnershipQuestionRequest): string {
    return hash(canonicalJson({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, nodes: snapshot.nodes, edges: snapshot.edges, evidence: snapshot.evidence, request }));
  }
  private cut(): number {
    const row = this.db.prepare("SELECT coalesce(max(rowid),0) n FROM ownership_attempts").get() as { n: number };
    if (!Number.isSafeInteger(row.n) || row.n < 0) fail(); return row.n;
  }
  private history(repositoryId: string, cut: number): OwnershipAttempt[] {
    const rows = this.db.prepare("SELECT * FROM ownership_attempts WHERE repository_id=? AND rowid<=?").all(repositoryId, cut) as Row[];
    return rows.map(row => {
      const attempt = ownershipAttemptSchema.parse(JSON.parse(String(row.payload)));
      if (row.attempt_id !== attempt.attemptId || row.repository_id !== attempt.repositoryId || row.snapshot_id !== attempt.snapshotId
        || row.question_id !== undefined && row.question_id !== attempt.questionId || row.concept_id !== attempt.concept.id || row.completed_at !== attempt.completedAt) fail();
      return attempt;
    }).sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.attemptId.localeCompare(b.attemptId));
  }
  private matching(history: OwnershipAttempt[], question: OwnershipQuestion) {
    const matches = history.filter(item => item.concept.id === question.concept.id && item.variantKey === question.variantKey);
    if (matches.some(item => item.legacy)) fail();
    const projection = matches.map(item => ({ attemptId: item.attemptId, completedAt: item.completedAt, conceptId: item.concept.id,
      variantKey: item.variantKey, questionId: item.questionId, attemptHash: hash(ownershipAttemptPreimage(item)) }));
    const first = projection[0];
    return { matchingHistoryProjectionHash: hash(canonicalJson(projection)), retryWitness: first ? { attemptId: first.attemptId, attemptHash: first.attemptHash, questionId: first.questionId } : null };
  }
  issue(raw: OwnershipQuestionRequest, settings: OwnershipSettingsAuthority): { question: OwnershipQuestion; issuance: OwnershipQuestionIssuance }[] {
    try { this.open(); if (!this.generator) fail();
    // Parse the common request/defaults, retaining the actual legacy internal count.
    // The IPC contract keeps its original limit; this source-only path must not alter generation.
    const request = structuredClone({ ...ownershipQuestionRequestSchema.parse({ ...raw, count: 1 }), count: raw.count ?? 5 });
    const configuration = settings.loadIgnoreSettings(request.repositoryId), revision = configuration.revision;
    return settings.withIgnoreRevision(request.repositoryId, revision, () => this.db.transaction(() => {
      this.schema(); const material = this.material(request.repositoryId, request.snapshotId); if (!material.current) fail();
      const policy = material.snapshot.analysisIdentity.ignorePolicy;
      const actualConfiguration = settings.loadIgnoreSettings(request.repositoryId);
      if (actualConfiguration.revision !== revision || (policy ? policy.hash !== hash(JSON.stringify([IGNORE_POLICY_VERSION, actualConfiguration.rules])) : actualConfiguration.rules.length > 0)) fail();
      const source = this.source(material, revision), cut = this.cut();
      const history = this.actualHistory(request.repositoryId), generated = this.generator!.generate(material.snapshot, request, history);
      return generated.questions.map((question, candidateIndex) => {
        const preimage = ownershipQuestionPreimage(question); let reason: Reason | null = null, basis: OwnershipQuestionBindingBasis | null = null;
        const candidates = generated.candidates.filter(item => item.id === question.id);
        if (new Set(candidates.map(ownershipQuestionPreimage)).size > 1) reason = "ambiguous-generator";
        else if (Buffer.byteLength(preimage) > OWNERSHIP_QUESTION_BINDING_LIMITS.questionBytes) reason = "question-budget-exceeded";
        else if (this.generator!.version !== "1.0.0") reason = "unsupported-generator";
        else if (!this.generator!.orderingEngine) reason = "unsupported-ordering-engine";
        else {
          try {
            const strictHistory = this.history(request.repositoryId, cut), matching = this.matching(strictHistory, question);
            if (!equal(this.matching(history, question), matching)) reason = "history-unverifiable";
            else {
              const value = { generatorVersion: "1.0.0", orderingVersion: "completedAt-attemptId-locale/1.0.0", orderingEngine: this.generator!.orderingEngine,
                request, candidateIndex, generatorInputHash: this.generatorHash(material.snapshot, request), historyCut: { maxAttemptRowid: cut }, ...matching,
                publicationSource: this.publication(source), createdAt: new Date().toISOString() };
              const parsed = ownershipQuestionBindingBasisSchema.safeParse(value);
              if (parsed.success) basis = parsed.data; else reason = "basis-budget-exceeded";
            }
          } catch { reason = "history-unverifiable"; }
        }
        const issuance = Object.freeze(Object.create(null)) as OwnershipQuestionIssuance;
        this.#issued.set(issuance, { preimage, basis, reason, source: structuredClone(source), settings });
        return { question: structuredClone(question), issuance };
      });
    }).immediate()); } catch { return fail(); }
  }
  prepare(issuance: OwnershipQuestionIssuance | undefined, question: OwnershipQuestion, attempt: OwnershipAttempt, capsule: OwnershipCapsule,
    source: OwnershipSourceCapture, settings: OwnershipSettingsAuthority): OwnershipQuestionBindingRecord {
    this.open(); const common = { version: "1.0.0" as const, attemptId: attempt.attemptId, repositoryId: attempt.repositoryId, snapshotId: attempt.snapshotId,
      questionId: attempt.questionId, questionVersion: attempt.questionVersion, questionFingerprint: capsule.questionFingerprint, attemptHash: capsule.attemptHash, capsuleHash: capsule.capsuleHash };
    if (issuance === undefined) return ownershipQuestionBindingRecordSchema.parse({ ...common, status: "unavailable", reason: "untrusted-issuance" });
    const issued = this.#issued.get(issuance);
    if (!issued || issued.settings !== settings || issued.preimage !== ownershipQuestionPreimage(question) || !equal(issued.source, source)) fail();
    const record: OwnershipQuestionBindingRecord = issued.reason ? { ...common, status: "unavailable", reason: issued.reason }
      : { ...common, status: "verified-generator", questionPreimage: issued.preimage, basis: issued.basis! };
    const parsed = ownershipQuestionBindingRecordSchema.parse(record);
    if (parsed.status === "verified-generator" && this.verify(parsed, this.material(attempt.repositoryId, attempt.snapshotId)) !== "verified-generator") fail();
    return parsed;
  }
  private verify(record: Extract<OwnershipQuestionBindingRecord, { status: "verified-generator" }>, material: Material): "verified-generator" | "unsupported-ordering-engine" | "unsupported-generator" {
    const raw = JSON.parse(record.questionPreimage) as { domain: string; question: OwnershipQuestion };
    ownershipQuestionSchema.parse(raw.question);
    if (raw.domain !== "ownership-question/1.0.0" || ownershipQuestionPreimage(raw.question) !== record.questionPreimage
      || hash(record.questionPreimage) !== record.questionFingerprint) fail();
    const question = raw.question, basis = record.basis;
    if (question.id !== record.questionId || question.repositoryId !== record.repositoryId || question.snapshotId !== record.snapshotId || question.version !== record.questionVersion
      || basis.request.repositoryId !== record.repositoryId || basis.request.snapshotId !== record.snapshotId
      || basis.generatorInputHash !== this.generatorHash(material.snapshot, basis.request)) fail();
    const publication = this.publication(this.source(material, basis.publicationSource.ignoreRevision));
    // Historical activation may differ after a legitimate re-promotion; immutable material must agree.
    if (!equal({ ...publication, activation: basis.publicationSource.activation }, basis.publicationSource)) fail();
    if (!this.generator || this.generator.version !== basis.generatorVersion) return "unsupported-generator";
    if (!equal(this.generator.orderingEngine, basis.orderingEngine)) return "unsupported-ordering-engine";
    const history = this.history(record.repositoryId, basis.historyCut.maxAttemptRowid);
    if (!equal(this.matching(history, question), { matchingHistoryProjectionHash: basis.matchingHistoryProjectionHash, retryWitness: basis.retryWitness })) fail();
    const generated = this.generator.generate(material.snapshot, basis.request, history);
    if (new Set(generated.candidates.filter(item => item.id === question.id).map(ownershipQuestionPreimage)).size !== 1
      || !generated.questions[basis.candidateIndex] || ownershipQuestionPreimage(generated.questions[basis.candidateIndex]!) !== record.questionPreimage) fail();
    return "verified-generator";
  }
  private assertCutBeforeSavedAttempt(record: Extract<OwnershipQuestionBindingRecord, { status: "verified-generator" }>): void {
    const row = this.db.prepare("SELECT rowid attemptRowid FROM ownership_attempts WHERE attempt_id=? AND repository_id=? AND snapshot_id=?")
      .get(record.attemptId, record.repositoryId, record.snapshotId) as { attemptRowid: number } | undefined;
    // A question cannot depend on this submission or any observable later insertion.
    // This ordering check is not a tamper-proof history log against whole-database rewrites.
    if (!row || !Number.isSafeInteger(row.attemptRowid) || row.attemptRowid <= record.basis.historyCut.maxAttemptRowid) fail();
  }
  save(record: OwnershipQuestionBindingRecord, issuance: OwnershipQuestionIssuance | undefined, settings: OwnershipSettingsAuthority): void {
    this.open(); if (!this.db.inTransaction) fail();
    const row = ownershipQuestionBindingRecordSchema.parse(record);
    if (row.status === "verified-generator") this.assertCutBeforeSavedAttempt(row);
    if (issuance !== undefined) {
      const issued = this.#issued.get(issuance); if (!issued || issued.settings !== settings) fail();
      const actualSource = this.source(this.material(row.repositoryId, row.snapshotId), issued.source.ignoreRevision);
      if (!equal(actualSource, issued.source) || settings.loadIgnoreSettings(row.repositoryId).revision !== issued.source.ignoreRevision) fail();
    }
    if (row.status === "verified-generator" && this.verify(row, this.material(row.repositoryId, row.snapshotId)) !== "verified-generator") fail();
    this.db.prepare("INSERT INTO ownership_question_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(row.attemptId, row.repositoryId, row.snapshotId,
      row.questionId, row.questionVersion, row.version, row.status, row.questionFingerprint, row.attemptHash, row.capsuleHash,
      row.status === "verified-generator" ? row.questionPreimage : null, row.status === "verified-generator" ? canonicalJson(row.basis) : null, row.status === "unavailable" ? row.reason : null);
    const saved = this.readRecord(row.attemptId); if (!saved || !equal(row, saved)) fail();
  }
  private readRecord(attemptId: string): OwnershipQuestionBindingRecord | null {
    const row = this.db.prepare("SELECT * FROM ownership_question_bindings WHERE attempt_id=?").get(attemptId) as Row | undefined;
    if (!row) return null;
    const common = { version: row.version, attemptId: row.attempt_id, repositoryId: row.repository_id, snapshotId: row.snapshot_id,
      questionId: row.question_id, questionVersion: row.question_version, questionFingerprint: row.question_fingerprint, attemptHash: row.attempt_hash, capsuleHash: row.capsule_hash };
    if (row.status === "unavailable" && (row.question_preimage !== null || row.basis_payload !== null) || row.status === "verified-generator" && row.reason !== null) fail();
    const record = ownershipQuestionBindingRecordSchema.parse(row.status === "verified-generator"
      ? { ...common, status: row.status, questionPreimage: row.question_preimage, basis: JSON.parse(String(row.basis_payload)) }
      : { ...common, status: row.status, reason: row.reason });
    if (record.status === "verified-generator" && row.basis_payload !== canonicalJson(record.basis)) fail();
    if (record.status === "verified-generator") this.assertCutBeforeSavedAttempt(record);
    const attemptRow = this.db.prepare("SELECT * FROM ownership_attempts WHERE attempt_id=?").get(attemptId) as Row | undefined;
    const capsuleRow = this.db.prepare("SELECT * FROM ownership_semantic_capsules WHERE attempt_id=?").get(attemptId) as Row | undefined;
    if (!attemptRow || !capsuleRow) fail();
    const attempt = ownershipAttemptSchema.parse(JSON.parse(String(attemptRow.payload))), capsule = ownershipCapsuleSchema.parse(JSON.parse(String(capsuleRow.payload)));
    if (attempt.attemptId !== record.attemptId || attempt.repositoryId !== record.repositoryId || attempt.snapshotId !== record.snapshotId
      || attempt.questionId !== record.questionId || attempt.questionVersion !== record.questionVersion || hash(ownershipAttemptPreimage(attempt)) !== record.attemptHash
      || capsule.attemptHash !== record.attemptHash || capsule.capsuleHash !== record.capsuleHash || capsule.questionFingerprint !== record.questionFingerprint
      || hash(ownershipCapsulePreimage(capsule)) !== capsule.capsuleHash || capsuleRow.repository_id !== record.repositoryId || capsuleRow.snapshot_id !== record.snapshotId
      || capsuleRow.attempt_hash !== capsule.attemptHash || capsuleRow.capsule_hash !== capsule.capsuleHash || capsuleRow.status !== capsule.status || capsuleRow.version !== capsule.version
      || attemptRow.repository_id !== attempt.repositoryId || attemptRow.snapshot_id !== attempt.snapshotId || attemptRow.concept_id !== attempt.concept.id || attemptRow.completed_at !== attempt.completedAt) fail();
    // Reuse the capsule source contract rather than accepting a self-consistent rehashed identity.
    this.material(record.repositoryId, record.snapshotId, capsule);
    if (record.status === "verified-generator") {
      const question = (JSON.parse(record.questionPreimage) as { question: OwnershipQuestion }).question;
      if (!equal(record.basis.publicationSource, capsule.sourceIdentity) || question.kind !== attempt.questionKind
        || question.variantKey !== attempt.variantKey || !equal(question.concept, attempt.concept)) fail();
      if (capsule.status === "ready" && (capsule.questionId !== question.id || capsule.questionVersion !== question.version || capsule.questionKind !== question.kind
        || capsule.variantKey !== question.variantKey || capsule.prompt !== question.prompt || capsule.learningObjective !== question.learningObjective)) fail();
    }
    return record;
  }
  load(attemptId: string): OwnershipQuestionBindingRead {
    try {
      this.open();
      // One consistent historical SQL view; this read does not check current workspace/configuration.
      return this.db.transaction((): OwnershipQuestionBindingRead => {
        this.schema(); const record = this.readRecord(attemptId); if (!record) return { status: "legacy-unbound" };
        if (record.status === "unavailable") return { status: "unavailable", currentness: "not-checked", record };
        const status = this.verify(record, this.material(record.repositoryId, record.snapshotId));
        return status === "verified-generator" ? { status, currentness: "not-checked", record: structuredClone(record) } : { status, currentness: "not-checked" };
      }).deferred();
    } catch { return fail(); }
  }
}
