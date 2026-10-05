import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { OwnershipQuestionBindingStore, OwnershipQuestionIssuance } from "./ownership-question-binding-store.js";
import {
  analysisIdentitySchema, canonicalJson, canonicalSnapshotResult, computeOwnershipPackageId, computeOwnershipSubmissionProjectionHash,
  hashOwnershipAnswer, IGNORE_POLICY_VERSION, ownershipAttemptPreimage, ownershipAttemptSchema, ownershipCapsulePreimage, ownershipCapsuleSchema,
  ownershipQuestionPreimage, ownershipQuestionSchema, ownershipSubmissionProjectionPreimage, ownershipSubmissionSchema, projectIgnoreSettingsSchema, projectSnapshotSchema, remoteHashSchema, remoteTimeSchema,
  validateOwnershipCapsule, validateOwnershipSemanticPackage,
  type OwnershipAttempt, type OwnershipCapsule, type OwnershipQuestion, type OwnershipReadyCapsule, type OwnershipSemanticPackage,
  type OwnershipSubmission, type OwnershipSubmissionProjection, type ProjectIgnoreSettings, type ProjectSnapshot,
} from "@project-xray/contracts";

export class OwnershipCapsuleStoreError extends Error {
  constructor(readonly code: "INVALID_MATERIAL" | "NOT_CURRENT" | "CONFLICT" | "RECEIPT_INVALID" | "BUSY" = "INVALID_MATERIAL") { super("所有权胶囊存储失败"); this.name = "OwnershipCapsuleStoreError"; }
}
function fail(code: OwnershipCapsuleStoreError["code"] = "INVALID_MATERIAL"): never { throw new OwnershipCapsuleStoreError(code); }
function safe(error: unknown): OwnershipCapsuleStoreError {
  if (error instanceof OwnershipCapsuleStoreError) return new OwnershipCapsuleStoreError(error.code);
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return new OwnershipCapsuleStoreError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "BUSY" : code === "IGNORE_SETTINGS_CONFLICT" ? "NOT_CURRENT" : "INVALID_MATERIAL");
}
const digest = (preimage: string): string => createHash("sha256").update(preimage, "utf8").digest("hex");
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const ordered = <T extends { filePath: string }>(items: T[]): T[] => [...items].sort((a, b) => a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0);
const ids = (values: string[]): string[] => [...new Set(values)].sort();
function wellFormed(value: string): boolean { for (let index = 0; index < value.length; index++) { const unit = value.charCodeAt(index); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; } else if (unit >= 0xdc00 && unit <= 0xdfff) return false; } return true; }
function capture<T>(input: T): T {
  const visiting = new Set<object>();
  const check = (value: unknown): void => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") { if (!Number.isFinite(value)) fail(); return; }
    if (typeof value !== "object" || visiting.has(value) || Object.getOwnPropertySymbols(value).length || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail();
    visiting.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get || descriptor.set || !descriptor.enumerable && !(Array.isArray(value) && key === "length")) fail();
      check(descriptor.value);
    }
    visiting.delete(value);
  };
  check(input); return structuredClone(input);
}
export interface OwnershipSourceCapture { activation: string; analysisIdentity: ProjectSnapshot["analysisIdentity"]; sourceManifestHash: string; ignoreRevision: number }
export interface OwnershipCapsuleWriteInput { question: OwnershipQuestion; attempt: OwnershipAttempt; capsule: OwnershipCapsule; source: OwnershipSourceCapture; submission?: OwnershipSubmission; issuance?: OwnershipQuestionIssuance }
export interface OwnershipSettingsAuthority { loadIgnoreSettings(repositoryId: string): ProjectIgnoreSettings; withIgnoreRevision<T>(repositoryId: string, revision: number, work: () => T): T }
declare const receiptBrand: unique symbol;
export type PreparedOwnershipWrite = Readonly<{ [receiptBrand]: true }>;
export type OwnershipCapsuleRead = { status: "not-found" | "legacy-capsule-absent" } | { status: "ready" | "not-evaluated"; questionBinding: "prepare-only"; attempt: OwnershipAttempt; capsule: OwnershipCapsule };
export type OwnershipSemanticPackageRead =
  | { status: "not-found" | "legacy-capsule-absent" }
  | { status: "not-evaluated"; questionBinding: "prepare-only"; currentness: "not-checked"; attempt: OwnershipAttempt; capsule: OwnershipCapsule }
  | { status: "ready"; questionBinding: "prepare-only"; currentness: "not-checked"; attempt: OwnershipAttempt; capsule: OwnershipReadyCapsule; package: OwnershipSemanticPackage };
interface Material { snapshot: ProjectSnapshot; activation: string; current: boolean; sources: { filePath: string; contentHash: string; language: string; content: string }[]; manifestHash: string }
interface Receipt { attempt: string; capsule: string; submission: string | null; projectionPreimage: string | null; questionPreimage: string; attemptPreimage: string; capsulePreimage: string; source: string; material: string; settings: OwnershipSettingsAuthority; bindingRecord: string | null; issuance: OwnershipQuestionIssuance | undefined }
interface AttemptRow { attempt_id: string; repository_id: string; snapshot_id: string; concept_id: string; completed_at: string; payload: string }
interface CapsuleRow { attempt_id: string; repository_id: string; snapshot_id: string; status: string; version: string; attempt_hash: string; capsule_hash: string; payload: string }

/** Source-only internal port. Receipts never cross IPC or survive process lifetime. */
export class OwnershipCapsuleStore {
  #receipts = new WeakMap<object, Receipt>();
  #closed = false;
  constructor(private readonly db: Database.Database, private readonly owner: OwnershipSettingsAuthority, private readonly bindings?: () => OwnershipQuestionBindingStore) {}
  migrate(): void {
    try {
      if (this.db.pragma("foreign_keys", { simple: true }) !== 1) fail();
      this.db.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS ownership_semantic_capsules (
          attempt_id TEXT PRIMARY KEY REFERENCES ownership_attempts(attempt_id) ON DELETE CASCADE,
          repository_id TEXT NOT NULL, snapshot_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ready','not-evaluated')), version TEXT NOT NULL,
          attempt_hash TEXT NOT NULL, capsule_hash TEXT NOT NULL, payload TEXT NOT NULL
        )`);
        this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(11,?)").run(new Date().toISOString());
      }).immediate();
    } catch (error) { throw safe(error); }
  }
  close(): void { this.#closed = true; this.#receipts = new WeakMap(); }
  private open(): void { if (this.#closed) fail("RECEIPT_INVALID"); }
  captureQuestionBindingMaterial(repositoryId: string, snapshotId: string, capsule?: OwnershipCapsule): Material {
    this.open(); const material = this.material(repositoryId, snapshotId);
    if (capsule) this.assertCapsuleSource(capsule, material);
    return material;
  }
  captureSource(repositoryId: string, snapshotId: string, ignoreRevision: number): OwnershipSourceCapture {
    try {
      this.open(); const material = this.db.transaction(() => this.material(repositoryId, snapshotId)).deferred();
      if (!material.current) fail("NOT_CURRENT");
      this.revision(ignoreRevision);
      return { activation: material.activation, analysisIdentity: material.snapshot.analysisIdentity, sourceManifestHash: material.manifestHash, ignoreRevision };
    } catch (error) { throw safe(error); }
  }
  async prepare(raw: OwnershipCapsuleWriteInput, settings: OwnershipSettingsAuthority = this.owner): Promise<PreparedOwnershipWrite> {
    try {
      this.open(); const input = capture(raw);
      const issuance = Object.getOwnPropertyDescriptor(raw, "issuance")?.value as OwnershipQuestionIssuance | undefined;
      if (issuance !== undefined) input.issuance = issuance;
      ownershipQuestionSchema.parse(input.question); ownershipAttemptSchema.parse(input.attempt); ownershipCapsuleSchema.parse(input.capsule);
      analysisIdentitySchema.parse(input.source.analysisIdentity); remoteTimeSchema.parse(input.source.activation); remoteHashSchema.parse(input.source.sourceManifestHash); this.revision(input.source.ignoreRevision);
      if (Object.keys(input).filter(key => key !== "submission" && key !== "issuance").sort().join() !== "attempt,capsule,question,source" || Object.keys(input.source).sort().join() !== "activation,analysisIdentity,ignoreRevision,sourceManifestHash") fail();
      const material = this.db.transaction(() => this.material(input.attempt.repositoryId, input.attempt.snapshotId)).deferred();
      this.assertCurrent(input.source, material, settings);
      this.assertPublication(input.capsule, input.source);
      const binding = this.bindings?.().prepare(input.issuance, input.question, input.attempt, input.capsule, input.source, settings);
      await validateOwnershipCapsule(input.capsule, input.question, input.attempt);
      const projection = this.submissionProjection(input, material);
      if (projection && await computeOwnershipSubmissionProjectionHash(projection) !== input.capsule.submissionProjectionHash) fail();
      this.assertCapsuleSource(input.capsule, material);
      if (input.capsule.status === "ready") {
        this.assertQuestion(input.question, input.attempt, input.capsule, material.snapshot);
        await this.ready(input.attempt, input.capsule, material);
      } else if (input.capsule.answerHash !== null && input.capsule.answerHash !== await hashOwnershipAnswer(input.attempt.semanticText)) fail();
      this.open();
      const receipt = Object.freeze(Object.create(null)) as PreparedOwnershipWrite;
      this.#receipts.set(receipt, { attempt: canonicalJson(input.attempt), capsule: canonicalJson(input.capsule), submission: input.submission === undefined ? null : canonicalJson(input.submission), projectionPreimage: projection ? ownershipSubmissionProjectionPreimage(projection) : null, questionPreimage: ownershipQuestionPreimage(input.question), attemptPreimage: ownershipAttemptPreimage(input.attempt), capsulePreimage: ownershipCapsulePreimage(input.capsule), source: canonicalJson(input.source), material: this.materialIdentity(material), settings, bindingRecord: binding ? canonicalJson(binding) : null, issuance: input.issuance });
      return receipt;
    } catch (error) { throw safe(error); }
  }
  save(prepared: PreparedOwnershipWrite): void {
    try {
      this.open(); const receipt = prepared && typeof prepared === "object" ? this.#receipts.get(prepared) : undefined;
      if (!receipt) fail("RECEIPT_INVALID"); this.#receipts.delete(prepared);
      const attempt = JSON.parse(receipt.attempt) as OwnershipAttempt, capsule = ownershipCapsuleSchema.parse(JSON.parse(receipt.capsule)), source = JSON.parse(receipt.source) as OwnershipSourceCapture;
      if (receipt.attempt !== canonicalJson(attempt) || receipt.capsule !== canonicalJson(capsule) || receipt.attemptPreimage !== ownershipAttemptPreimage(attempt) || receipt.capsulePreimage !== ownershipCapsulePreimage(capsule) || digest(receipt.attemptPreimage) !== capsule.attemptHash || digest(receipt.capsulePreimage) !== capsule.capsuleHash || digest(receipt.questionPreimage) !== capsule.questionFingerprint) fail();
      if (receipt.submission !== null) { const submission = JSON.parse(receipt.submission) as OwnershipSubmission; ownershipSubmissionSchema.parse(submission); if (canonicalJson(submission) !== receipt.submission || submission.answer !== attempt.semanticText || submission.repositoryId !== attempt.repositoryId || submission.snapshotId !== attempt.snapshotId || submission.questionId !== attempt.questionId || submission.questionVersion !== attempt.questionVersion) fail(); }
      if (capsule.submissionProjectionHash !== null && (receipt.projectionPreimage === null || digest(receipt.projectionPreimage) !== capsule.submissionProjectionHash)) fail();
      receipt.settings.withIgnoreRevision(attempt.repositoryId, source.ignoreRevision, () => this.db.transaction(() => {
        if (this.db.pragma("foreign_keys", { simple: true }) !== 1) fail();
        const material = this.material(attempt.repositoryId, attempt.snapshotId);
        this.assertCurrent(source, material, receipt.settings);
        this.assertPublication(capsule, source);
        if (this.materialIdentity(material) !== receipt.material) fail("NOT_CURRENT");
        this.assertCapsuleSource(capsule, material);
        if (this.db.prepare("SELECT 1 FROM ownership_attempts WHERE attempt_id=?").get(attempt.attemptId) || this.db.prepare("SELECT 1 FROM ownership_semantic_capsules WHERE attempt_id=?").get(attempt.attemptId)) fail("CONFLICT");
        this.db.prepare("INSERT INTO ownership_attempts(attempt_id,repository_id,snapshot_id,concept_id,completed_at,payload) VALUES(?,?,?,?,?,?)").run(attempt.attemptId, attempt.repositoryId, attempt.snapshotId, attempt.concept.id, attempt.completedAt, receipt.attempt);
        this.db.prepare("INSERT INTO ownership_semantic_capsules(attempt_id,repository_id,snapshot_id,status,version,attempt_hash,capsule_hash,payload) VALUES(?,?,?,?,?,?,?,?)").run(attempt.attemptId, attempt.repositoryId, attempt.snapshotId, capsule.status, capsule.version, capsule.attemptHash, capsule.capsuleHash, receipt.capsule);
        if (receipt.bindingRecord !== null) this.bindings!().save(JSON.parse(receipt.bindingRecord), receipt.issuance, receipt.settings);
      }).immediate());
    } catch (error) { throw safe(error); }
  }
  async load(attemptId: string): Promise<OwnershipCapsuleRead> {
    return (await this.read(attemptId)).result;
  }
  async loadSemanticPackage(attemptId: string): Promise<OwnershipSemanticPackageRead> {
    try {
      this.open(); if (typeof attemptId !== "string" || !attemptId.length) fail();
      const { result, package: semanticPackage } = await this.read(attemptId);
      this.open();
      if (result.status === "not-found" || result.status === "legacy-capsule-absent") return result;
      if (result.status === "ready" && result.capsule.status === "ready" && semanticPackage) {
        return capture({ status: "ready", questionBinding: "prepare-only", currentness: "not-checked", attempt: result.attempt, capsule: result.capsule, package: semanticPackage });
      }
      if (result.status !== "not-evaluated" || semanticPackage !== null) fail();
      return capture({ status: "not-evaluated", questionBinding: "prepare-only", currentness: "not-checked", attempt: result.attempt, capsule: result.capsule });
    } catch (error) { throw safe(error); }
  }
  private async read(attemptId: string): Promise<{ result: OwnershipCapsuleRead; package: OwnershipSemanticPackage | null }> {
    try {
      this.open();
      const captured = this.db.transaction(() => {
        const row = this.db.prepare("SELECT * FROM ownership_attempts WHERE attempt_id=?").get(attemptId) as AttemptRow | undefined;
        const capsuleRow = this.db.prepare("SELECT * FROM ownership_semantic_capsules WHERE attempt_id=?").get(attemptId) as CapsuleRow | undefined;
        if (!row) { if (capsuleRow) fail(); return { status: "not-found" as const }; }
        const raw = JSON.parse(row.payload) as OwnershipAttempt; ownershipAttemptSchema.parse(raw);
        if (row.attempt_id !== raw.attemptId || row.repository_id !== raw.repositoryId || row.snapshot_id !== raw.snapshotId || row.concept_id !== raw.concept.id || row.completed_at !== raw.completedAt) fail();
        if (!capsuleRow) return { status: "legacy-capsule-absent" as const };
        const capsule = ownershipCapsuleSchema.parse(JSON.parse(capsuleRow.payload));
        if (capsuleRow.attempt_id !== row.attempt_id || capsuleRow.repository_id !== row.repository_id || capsuleRow.snapshot_id !== row.snapshot_id || capsuleRow.status !== capsule.status || capsuleRow.version !== capsule.version || capsuleRow.attempt_hash !== capsule.attemptHash || capsuleRow.capsule_hash !== capsule.capsuleHash || digest(ownershipAttemptPreimage(raw)) !== capsule.attemptHash || digest(ownershipCapsulePreimage(capsule)) !== capsule.capsuleHash) fail();
        const material = this.material(raw.repositoryId, raw.snapshotId); this.assertCapsuleSource(capsule, material);
        return { status: "found" as const, attempt: raw, capsule, material };
      }).deferred();
      if (captured.status !== "found") return { result: captured, package: null };
      let semanticPackage: OwnershipSemanticPackage | null = null;
      if (captured.capsule.status === "ready") semanticPackage = await this.ready(captured.attempt, captured.capsule, captured.material);
      else if (captured.capsule.answerHash !== null && captured.capsule.answerHash !== await hashOwnershipAnswer(captured.attempt.semanticText)) fail();
      return { result: { status: captured.capsule.status, questionBinding: "prepare-only", attempt: captured.attempt, capsule: captured.capsule }, package: semanticPackage };
    } catch (error) { throw safe(error); }
  }
  private revision(value: number): void { if (!Number.isSafeInteger(value) || value < 0) fail(); }
  private materialIdentity(material: Material): string { return canonicalJson({ snapshot: material.snapshot, manifestHash: material.manifestHash, sourceHashes: material.sources.map(source => ({ filePath: source.filePath, hash: digest(source.content), contentHash: source.contentHash, language: source.language })) }); }
  private material(repositoryId: string, snapshotId: string): Material {
    const row = this.db.prepare("SELECT * FROM snapshots WHERE snapshot_id=?").get(snapshotId) as { snapshot_id: string; repository_id: string; root_path: string; created_at: string; payload: string } | undefined;
    if (!row || row.repository_id !== repositoryId) fail();
    const raw = JSON.parse(row.payload) as ProjectSnapshot; projectSnapshotSchema.parse(raw);
    if (raw.repositoryId !== row.repository_id || raw.snapshotId !== row.snapshot_id || raw.rootPath !== row.root_path || raw.createdAt !== row.created_at || [...raw.nodes, ...raw.edges, ...raw.evidence].some(item => item.snapshotId !== snapshotId)) fail();
    if (raw.analysisIdentity.analysisResult && digest(canonicalSnapshotResult(raw)) !== raw.analysisIdentity.analysisResult.fingerprint) fail();
    // Bind payload facts to the actual query tables, including IDs/columns ignored by result fingerprints.
    for (const table of ["nodes", "edges", "evidence"] as const) {
      const rows = this.db.prepare(`SELECT * FROM ${table} WHERE snapshot_id=?`).all(snapshotId) as Record<string, unknown>[];
      const expected = table === "nodes" ? raw.nodes : table === "edges" ? raw.edges : raw.evidence;
      if (rows.length !== expected.length || new Set(expected.map(item => item.id)).size !== expected.length) fail();
      for (const fact of expected) {
        const stored = rows.find(item => item[table === "nodes" ? "node_id" : table === "edges" ? "edge_id" : "evidence_id"] === fact.id);
        if (!stored || !same(JSON.parse(String(stored.payload)), fact)) fail();
        if (table === "nodes" && (stored.kind !== (fact as ProjectSnapshot["nodes"][number]).kind || stored.name !== (fact as ProjectSnapshot["nodes"][number]).name || stored.qualified_name !== (fact as ProjectSnapshot["nodes"][number]).qualifiedName || stored.file_path !== ((fact as ProjectSnapshot["nodes"][number]).filePath ?? null))) fail();
        if (table === "edges") { const edge = fact as ProjectSnapshot["edges"][number]; if (stored.source_id !== edge.source || stored.target_id !== edge.target || stored.kind !== edge.kind || stored.confidence !== edge.confidence) fail(); }
        if (table === "evidence") { const proof = fact as ProjectSnapshot["evidence"][number]; if (stored.file_path !== proof.span.filePath || stored.start_line !== proof.span.startLine || stored.start_column !== proof.span.startColumn || stored.end_line !== proof.span.endLine || stored.end_column !== proof.span.endColumn) fail(); }
      }
    }
    const sources = ordered(this.db.prepare("SELECT file_path filePath,content_hash contentHash,language,content FROM source_snapshots WHERE snapshot_id=?").all(snapshotId) as Material["sources"]);
    const actualManifest = sources.map(source => ({ filePath: source.filePath, contentHash: digest(source.content), bytes: Buffer.byteLength(source.content, "utf8"), language: source.language }));
    if (sources.some((source, index) => !wellFormed(source.content) || source.contentHash !== actualManifest[index]!.contentHash) || !same(actualManifest, ordered(raw.sourceFiles))) fail();
    const overview = this.db.prepare("SELECT repository_id,activated_at,is_current FROM snapshot_overviews WHERE snapshot_id=?").get(snapshotId) as { repository_id: string; activated_at: string; is_current: number } | undefined;
    if (!overview || overview.repository_id !== repositoryId) fail();
    return { snapshot: raw, sources, manifestHash: digest(canonicalJson(actualManifest)), activation: overview.activated_at, current: overview.is_current === 1 };
  }
  private assertCurrent(source: OwnershipSourceCapture, material: Material, settings: OwnershipSettingsAuthority): void {
    if (!material.current || source.activation !== material.activation || !same(source.analysisIdentity, material.snapshot.analysisIdentity) || source.sourceManifestHash !== material.manifestHash) fail("NOT_CURRENT");
    const ignore = projectIgnoreSettingsSchema.parse(settings.loadIgnoreSettings(material.snapshot.repositoryId));
    if (ignore.revision !== source.ignoreRevision || (source.analysisIdentity.ignorePolicy ? digest(JSON.stringify([IGNORE_POLICY_VERSION, ignore.rules])) !== source.analysisIdentity.ignorePolicy.hash : ignore.rules.length > 0)) fail("NOT_CURRENT");
    if (settings === this.owner && projectIgnoreSettingsSchema.parse(this.owner.loadIgnoreSettings(material.snapshot.repositoryId)).revision !== source.ignoreRevision) fail("NOT_CURRENT");
  }
  private assertCapsuleSource(capsule: OwnershipCapsule, material: Material): void {
    const identity = capsule.sourceIdentity, analysis = material.snapshot.analysisIdentity;
    // Activation/revision are publication-time bindings, not historical currentness requirements.
    if (identity.analysisResultFingerprint !== null && identity.analysisResultFingerprint !== (analysis.analysisResult?.fingerprint ?? null) || identity.configurationHash !== null && identity.configurationHash !== analysis.configurationHash || identity.sourceManifestHash !== null && identity.sourceManifestHash !== material.manifestHash || identity.ignorePolicyHash !== (analysis.ignorePolicy?.hash ?? null)) fail();
    if (capsule.status === "ready" && !same(capsule.analysisIdentity, { graphIrVersion: analysis.graphIrVersion, analyzerVersions: analysis.analyzerVersions, configurationHash: analysis.configurationHash, sourceFingerprint: analysis.sourceFingerprint, ignorePolicy: analysis.ignorePolicy ? { version: analysis.ignorePolicy.version, hash: analysis.ignorePolicy.hash } : null, analysisResult: analysis.analysisResult })) fail();
  }
  private assertPublication(capsule: OwnershipCapsule, source: OwnershipSourceCapture): void {
    if (capsule.sourceIdentity.activation !== null && capsule.sourceIdentity.activation !== source.activation || capsule.sourceIdentity.ignoreRevision !== null && capsule.sourceIdentity.ignoreRevision !== source.ignoreRevision) fail("NOT_CURRENT");
  }
  private submissionProjection(input: OwnershipCapsuleWriteInput, material: Material): OwnershipSubmissionProjection | null {
    const { attempt, capsule, submission, question } = input;
    if (submission === undefined) {
      if (capsule.status === "not-evaluated") { if (capsule.submissionProjectionHash !== null) fail(); return null; }
      const normalized = attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"];
      const original = normalized.kind === "variable-flow" ? { kind: "variable-flow" as const, roles: capsule.roleBindings.map(binding => ({ role: binding.role, citationIndex: binding.originalCitationIndex })) } : normalized;
      return { originalCitations: capsule.citationOrder.map(index => attempt.citations[index]!), originalStructuredAnswer: original, citationOrder: capsule.citationOrder, roleBindings: capsule.roleBindings, normalizedStructuredAnswer: normalized, validatedCitations: attempt.citations };
    }
    ownershipSubmissionSchema.parse(submission);
    if (submission.repositoryId !== attempt.repositoryId || submission.snapshotId !== attempt.snapshotId || submission.questionId !== attempt.questionId || submission.questionVersion !== attempt.questionVersion || submission.answer !== attempt.semanticText) fail();
    const index = new Map(attempt.citations.map((citation, position) => [canonicalJson(citation), position]));
    if (index.size !== attempt.citations.length) fail();
    const citationOrder = submission.citations.map(citation => { const position = index.get(canonicalJson(citation)); if (position === undefined) fail(); return position; });
    if (new Set(citationOrder).size !== attempt.citations.length) fail();
    const original = submission.structuredAnswer;
    const normalized = original.kind === "variable-flow" ? { ...original, roles: original.roles.map(role => ({ ...role, citationIndex: citationOrder[role.citationIndex] ?? role.citationIndex })) } : original;
    if (!same(normalized, attempt.structuredAnswer)) fail();
    if (capsule.submissionProjectionHash === null) return null;
    if (submission.citations.length > 24 || attempt.citations.length > 24) fail();
    const roleBindings: OwnershipSubmissionProjection["roleBindings"] = [];
    for (const citation of attempt.citations) { const proof = material.snapshot.evidence.find(item => item.id === citation.evidenceId); const { evidenceId: _id, ...range } = citation; if (!proof || !same(range, proof.span)) fail(); }
    if (original.kind === "variable-flow") {
      const check = question.deterministicChecks[0];
      if (question.deterministicChecks.length !== 1 || check?.kind !== "variable-roles" || question.expectedNodeIds.length !== 1) fail();
      for (const role of original.roles) {
        const citation = submission.citations[role.citationIndex], requirement = check.requirements.find(item => item.role === role.role);
        if (!citation || !requirement) fail();
        const candidates = material.snapshot.edges.filter(edge => requirement.edgeIds.includes(edge.id) && edge.target === question.expectedNodeIds[0] && edge.evidenceId === citation.evidenceId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        const edge = candidates[0], proof = edge ? material.snapshot.evidence.find(item => item.id === edge.evidenceId) : undefined;
        if (!edge || edge.confidence !== "verified" || !proof || proof.confidence !== "verified" || edge.kind !== { write: "WRITES", read: "READS", return: "RETURNS" }[role.role] || proof.kind !== { write: "variable-write", read: "variable-read", return: "return-flow" }[role.role]) fail();
        roleBindings.push({ role: role.role, originalCitationIndex: role.citationIndex, validatedCitationIndex: citationOrder[role.citationIndex]!, edgeId: edge.id, evidenceId: edge.evidenceId });
      }
      if (check.requirements.some(item => !roleBindings.some(binding => binding.role === item.role))) fail();
    }
    return { originalCitations: submission.citations, originalStructuredAnswer: original, citationOrder, roleBindings, normalizedStructuredAnswer: normalized, validatedCitations: attempt.citations };
  }
  private assertQuestion(question: OwnershipQuestion, attempt: OwnershipAttempt, capsule: OwnershipReadyCapsule, snapshot: ProjectSnapshot): void {
    if (question.deterministicChecks.length !== 1) fail();
    const check = question.deterministicChecks[0]!, edges = snapshot.edges.filter(edge => capsule.necessaryEdgeIds.includes(edge.id));
    const structured = attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"];
    if (check.kind === "definition" && structured.kind === "entry") { if (edges.length !== 1 || edges[0]!.id !== check.edgeId || edges[0]!.target !== check.nodeId || structured.nodeId !== check.nodeId) fail(); }
    else if (check.kind === "call-direction" && structured.kind === "call-direction") { if (edges.length !== 1 || edges[0]!.id !== check.edgeId || structured.callerNodeId !== check.sourceNodeId || structured.calleeNodeId !== check.targetNodeId) fail(); }
    else if (check.kind === "ordered-path" && structured.kind === "call-path") { if (!check.legalNodePaths.some((path, index) => same(path, capsule.rubric.selectedPath?.nodeIds) && same(check.legalEdgePaths[index], capsule.rubric.selectedPath?.edgeIds))) fail(); }
    else if (check.kind === "variable-roles" && structured.kind === "variable-flow") { if (question.expectedNodeIds.length !== 1 || capsule.roleBindings.some(binding => !check.requirements.find(item => item.role === binding.role)?.edgeIds.includes(binding.edgeId) || edges.find(edge => edge.id === binding.edgeId)?.target !== question.expectedNodeIds[0]) || check.requirements.some(item => !capsule.roleBindings.some(binding => binding.role === item.role))) fail(); }
    else fail();
  }
  private async ready(attempt: OwnershipAttempt, capsule: OwnershipReadyCapsule, material: Material): Promise<OwnershipSemanticPackage> {
    if (capsule.repositoryId !== attempt.repositoryId || capsule.snapshotId !== attempt.snapshotId || capsule.attemptId !== attempt.attemptId || capsule.questionId !== attempt.questionId || capsule.questionVersion !== attempt.questionVersion || capsule.questionKind !== attempt.questionKind || capsule.variantKey !== attempt.variantKey || capsule.createdAt !== attempt.completedAt || capsule.deterministicScoringVersion !== attempt.scoringVersion || attempt.legacy) fail();
    const edges = capsule.necessaryEdgeIds.map(id => material.snapshot.edges.find(edge => edge.id === id));
    if (edges.some(edge => !edge || edge.confidence !== "verified") || !same(ids(edges.flatMap(edge => edge ? [edge.source, edge.target] : [])), ids(capsule.necessaryNodeIds))) fail();
    const selected = edges as ProjectSnapshot["edges"];
    const proofs: OwnershipSemanticPackage["proofs"] = capsule.necessaryProofs.map(proof => {
      const fact = material.snapshot.evidence.find(item => item.id === proof.evidenceId), source = material.sources.find(item => item.filePath === proof.filePath);
      if (!fact || !source || !same(fact.span, proof.span) || fact.kind !== proof.kind || fact.analyzer !== proof.analyzer || fact.analyzerVersion !== proof.analyzerVersion || fact.confidence !== "verified" || proof.confidence !== "verified" || proof.contentHash !== source.contentHash) fail();
      const lines = source.content.split(/\r\n|\r|\n/u), { startLine, startColumn, endLine, endColumn } = proof.span, first = lines[startLine - 1], last = lines[endLine - 1];
      if (first === undefined || last === undefined || startColumn > first.length || endColumn > last.length || endLine - startLine + 1 > 40 || startLine === endLine && endColumn <= startColumn) fail();
      const split = (line: string, offset: number) => offset > 0 && offset < line.length && /[\uD800-\uDBFF]/u.test(line[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(line[offset]!);
      if (split(first, startColumn) || split(last, endColumn)) fail();
      const slice = lines.slice(startLine - 1, endLine); slice[0] = slice[0]!.slice(startColumn); slice[slice.length - 1] = slice[slice.length - 1]!.slice(0, startLine === endLine ? endColumn - startColumn : endColumn);
      return { id: fact.id, kind: proof.kind, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: proof.confidence, span: proof.span, sliceSpan: proof.span, contentHash: proof.contentHash, snippet: slice.join("\n") };
    });
    if (!same(ids(selected.map(edge => edge.evidenceId)), ids(proofs.map(proof => proof.id)))) fail();
    const structured = attempt.structuredAnswer as OwnershipSubmission["structuredAnswer"];
    if (!structured || structured.kind !== capsule.questionKind || capsule.citationOrder.some(index => index >= attempt.citations.length) || new Set(capsule.citationOrder).size !== attempt.citations.length) fail();
    const kind = capsule.questionKind;
    for (const edge of selected) {
      const proof = proofs.find(item => item.id === edge.evidenceId)!;
      if (kind === "entry" && (edge.kind !== "DEFINES" || proof.kind !== "symbol-definition") || (kind === "call-path" || kind === "call-direction") && (edge.kind !== "CALLS" || proof.kind !== "call-expression") || kind === "variable-flow" && (!(["WRITES", "READS", "RETURNS"] as string[]).includes(edge.kind) || proof.kind !== ({ WRITES: "variable-write", READS: "variable-read", RETURNS: "return-flow" } as Record<string, string>)[edge.kind])) fail();
    }
    let original = structured;
    if (structured.kind === "variable-flow") {
      if (structured.roles.length !== capsule.roleBindings.length || !same(ids(capsule.roleBindings.map(binding => binding.edgeId)), capsule.necessaryEdgeIds) || new Set(selected.map(edge => edge.target)).size !== 1) fail();
      for (const [index, binding] of capsule.roleBindings.entries()) {
        const edge = selected.find(item => item.id === binding.edgeId), variable = edge ? material.snapshot.nodes.find(node => node.id === edge.target) : undefined;
        if (!edge || variable?.kind !== "variable" || edge.evidenceId !== binding.evidenceId || edge.kind !== { write: "WRITES", read: "READS", return: "RETURNS" }[binding.role] || capsule.citationOrder[binding.originalCitationIndex] !== binding.validatedCitationIndex || attempt.citations[binding.validatedCitationIndex]?.evidenceId !== binding.evidenceId || structured.roles[index]?.role !== binding.role || structured.roles[index]?.citationIndex !== binding.validatedCitationIndex) fail();
      }
      original = { kind: "variable-flow", roles: capsule.roleBindings.map(binding => ({ citationIndex: binding.originalCitationIndex, role: binding.role })) };
    } else if (capsule.roleBindings.length) fail();
    if (structured.kind === "entry" && (selected.length !== 1 || selected[0]!.target !== structured.nodeId || !["function", "method", "class"].includes(material.snapshot.nodes.find(node => node.id === structured.nodeId)?.kind ?? "") || material.snapshot.nodes.find(node => node.id === structured.nodeId)?.filePath !== proofs[0]!.span.filePath)) fail();
    if (structured.kind === "call-direction" && (selected.length !== 1 || selected[0]!.source !== structured.callerNodeId || selected[0]!.target !== structured.calleeNodeId)) fail();
    if (structured.kind === "call-path" && !same(ids(capsule.rubric.selectedPath?.edgeIds ?? []), capsule.necessaryEdgeIds)) fail();
    const projection = { originalCitations: capsule.citationOrder.map(index => attempt.citations[index]!), originalStructuredAnswer: original, citationOrder: capsule.citationOrder, roleBindings: capsule.roleBindings, normalizedStructuredAnswer: structured, validatedCitations: attempt.citations };
    if (await computeOwnershipSubmissionProjectionHash(projection) !== capsule.submissionProjectionHash) fail();
    if (capsule.rubric.criteria.some(item => !same(item.requiredEvidenceIds, item.allowedEvidenceIds) || !same(item.answerScope, attempt.semanticText.length ? [{ start: 0, end: attempt.semanticText.length }] : []) || item.allowedLimitationIds.length !== 2) || capsule.rubric.limitations.length !== capsule.rubric.criteria.length * 2) fail();
    for (const criterion of capsule.rubric.criteria) {
      const limitations = criterion.allowedLimitationIds.map(id => capsule.rubric.limitations.find(item => item.limitationId === id));
      if (new Set(limitations.map(item => item?.code)).size !== 2 || limitations.some(item => !item || !same(item.criterionIds, [criterion.criterionId]) || !same(item.relatedEvidenceIds, item.code === "static-only" ? criterion.requiredEvidenceIds : []) || item.code !== "static-only" && item.code !== "answer-information-insufficient")) fail();
    }
    const content: Omit<OwnershipSemanticPackage, "assessmentPackageId"> = {
      version: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", repositoryId: attempt.repositoryId, snapshotId: attempt.snapshotId, attemptId: attempt.attemptId, attemptHash: capsule.attemptHash,
      deterministicScoringVersion: capsule.deterministicScoringVersion, semanticScoringVersion: "1.0.0", analysisIdentity: capsule.analysisIdentity, answer: attempt.semanticText, answerHash: capsule.answerHash, structuredAnswer: structured,
      validatedCitations: attempt.citations as OwnershipSemanticPackage["validatedCitations"], rubric: capsule.rubric,
      nodes: capsule.necessaryNodeIds.map(id => { const node = material.snapshot.nodes.find(item => item.id === id); if (!node) fail(); return { id, name: node.name, kind: node.kind, filePath: node.filePath ?? null, evidenceIds: ids(selected.filter(edge => edge.source === id || edge.target === id).map(edge => edge.evidenceId)) }; }),
      edges: selected.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, evidenceId: edge.evidenceId, confidence: edge.confidence, reason: "当前题目所选的静态关系" })), proofs,
    };
    const semanticPackage = { ...content, assessmentPackageId: await computeOwnershipPackageId(content) };
    return validateOwnershipSemanticPackage(semanticPackage, attempt.semanticText);
  }
}
