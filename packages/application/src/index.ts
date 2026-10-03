import { basename, dirname, extname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import {
  GRAPH_IR_VERSION, ignoreSettingsRequestSchema, saveIgnoreSettingsRequestSchema, type SaveIgnoreSettingsRequest, type IgnoreSettingsResponse, type IgnorePolicy, SafeDiagnosticError, diagnosticForError, safeDiagnostic, safeDiagnosticCodeSchema,
  CHANGESET_VERSION, GRAPH_QUERY_VERSION, type ChangeFile, type ChangeReport, type ComparisonRequest, type ComparisonSide, type DirectChange, type Evidence, type EvidenceLocation, type FeatureExplanation, type FlowResult, type GraphEdge, type GraphNode, type GraphQueryRequest, type GraphQueryResponse, type ImpactPath,
  OWNERSHIP_SCORING_VERSION, type IndexProgress, type OwnershipAttempt, type OwnershipGrade, type OwnershipProgress, type OwnershipQuestion, type OwnershipQuestionRequest, type OwnershipSubmission, type ProjectSnapshot, type SafeDiagnosticCode, type SafeDiagnosticDetailCode,
  type ProjectOverview, type ModuleExpansionRequest, type ModuleExpansionResponse, type ModuleListRequest, type ModuleListResponse, type ModuleOverviewRequest, type ModuleOverviewResponse, type ModuleRelationEdgesRequest, type ModuleRelationEdgesResponse, type SearchRequest, type SearchResponse, type EvidenceRangeResponse,
  type SnapshotRef, type SnapshotState, type SourceCitation, type SourceFileResult, type IdentifiedEvidence,
} from "@project-xray/contracts";
import {
  finalizeAnalysisSnapshot, DEFAULT_IGNORE, classifyProjectPath, createIgnorePolicy, configurationFingerprint, assertContainedPath, contentFingerprint, createSecureReadScope, discoverProject, isAnalysisConfig, isProjectPathSecurityError, languageFromPath, moduleNameForPath, normalizeProjectPath,
  readProjectFile, readSecureProjectFile, sourceFingerprint, stableId, throwIfAborted, type LanguageAnalyzer, type SecureReadScope, type SecureReadTestHooks,
} from "@project-xray/analyzer-core";
import { TypeScriptAnalyzer } from "@project-xray/analyzer-typescript";
import { PythonAnalyzer } from "@project-xray/analyzer-python";
import { captureComparison, cloneRepository, comparisonStateFingerprint, getGitHead, type CapturedSide } from "@project-xray/git";
import { GraphStore, overviewFromSnapshot, queryFlow, searchNodes, type NavigationValiditySample } from "@project-xray/graph";
import { buildOwnershipRubricCapsule, createQuestions, gradeAnswer, type OwnershipRubricSource } from "@project-xray/ownership";
import { canonicalJson, ownershipQuestionSchema, ownershipSubmissionSchema } from "@project-xray/contracts";
import { RemoteExplanationApplication, type RemoteProviderPort, type RemoteCredentialPort } from "./remote-explanation.js";
export { RemoteExplanationApplication, type RemoteApplicationPorts, type RemoteProviderPort, type RemoteCredentialPort } from "./remote-explanation.js";

export interface XRayApplicationOptions {
  databasePath?: string;
  projectDatabaseRoot?: string;
  cacheRoot: string;
  onProgress?: (progress: IndexProgress) => void;
}
export interface IndexOptions { signal?: AbortSignal; onProgress?: (progress: IndexProgress) => void; testOnlySecureReadHooks?: SecureReadTestHooks }
export interface ComparisonOptions { signal?: AbortSignal; onProgress?: (progress: { phase: "capturing" | "analyzing-left" | "analyzing-right" | "diffing" | "propagating" | "persisting"; completed: number; total: number; currentFile?: string }) => void; testOnlySecureReadHooks?: SecureReadTestHooks }

interface IndexedSource { absolutePath: string; projectPath: string; content: string; contentHash: string; language: string }

const navigationLimit = 4_194_304 as const;
const navigationPhases = ["coldNavigation", "warmNavigation"] as const;
const navigationDecisions = ["hit", "empty_build_installed", "external_rebuild_installed", "local_rebuild_installed", "combined_rebuild_installed", "build_discard_external", "build_discard_local", "build_discard_combined", "build_discard_unclassified", "projection_limit_fallback", "transaction_bypass", "token_unavailable_bypass", "invalid_token_bypass", "store_closed_error", "legacy_bypass", "build_error_fallback", "lookup_error"] as const;
const navigationOutcomes = ["unchanged", "external_only", "local_only", "both_changed", "unavailable", "invalid_type", "in_transaction", "closed"] as const;
const navigationCheckpoints = ["phase_start", "lookup_validity", "build_before", "build_after", "after_last_lookup"] as const;
type NavigationPhase = typeof navigationPhases[number];
type NavigationApi = "getEvidence" | "readSource";
type NavigationDecision = typeof navigationDecisions[number];
type NavigationOutcome = typeof navigationOutcomes[number];
type NavigationCheckpoint = typeof navigationCheckpoints[number];
type NavigationRace = "external_only" | "local_only" | "both_changed" | "unclassified";
type ValidNavigationSample = Extract<NavigationValiditySample, { status: "valid" }>;
export interface NavigationCachePhaseSummaryV1 {
  lookupDecisions: Record<NavigationApi, Record<NavigationDecision, number>>;
  candidateBuilds: { attempted: number; installed: number; discarded: number; rejectedByAdmission: number; failed: number; cancelled: number };
  buildRaceReasons: Record<NavigationRace, number>;
  externalObservations: Record<NavigationCheckpoint, Record<NavigationOutcome, number>>;
  externalObservationCoverage: { complete: boolean; checkpoints: Record<NavigationCheckpoint, boolean> };
  projectionAdmission: { evaluatedCount: number; acceptedCount: number; acceptedBytesTotal: number; maxAcceptedBytes: number; overLimitCount: number; invalidCount: number; limitBytes: typeof navigationLimit };
}
export interface NavigationCacheObserverSummaryV1 { contractVersion: "xray.navigation-cache-observer.v1"; phases: Record<NavigationPhase, NavigationCachePhaseSummaryV1> }
export interface NavigationCacheObservationScopeV1 {
  beginPhase(phase: NavigationPhase, ref: SnapshotRef): void;
  endPhase(phase: NavigationPhase): void;
  getSummary(): NavigationCacheObserverSummaryV1;
  dispose(): void;
}
interface NavigationContext extends SnapshotRef { store: GraphStore; rootPath: string; evidenceIndex?: Map<string, Evidence>; evidenceList?: Evidence[] }
interface NavigationSlot extends NavigationContext { sample: ValidNavigationSample; evidenceIndex: Map<string, Evidence> }
type NavigationProjection = { status: "accepted"; bytes: number; evidenceIndex: Map<string, Evidence> } | { status: "over_limit" | "invalid" };
interface NavigationProbe { sample: NavigationValiditySample; covered: boolean }
interface NavigationTrace {
  decision: NavigationDecision;
  lookup?: { outcome: NavigationOutcome; covered: boolean };
  candidate?: { before: NavigationOutcome; beforeCovered: boolean; after: NavigationOutcome; afterCovered: boolean; terminal: "installed" | "discarded" | "rejectedByAdmission" | "failed"; admission?: { status: "accepted"; bytes: number } | { status: "over_limit" | "invalid" }; race?: NavigationRace };
}
interface NavigationPhaseState { name: NavigationPhase; ref: SnapshotRef; calls: Record<NavigationApi, number>; pending: number; started: boolean; ended: boolean; invalid: boolean; missing: Set<NavigationCheckpoint> }
interface NavigationObservationRequest { phase: NavigationPhaseState; api: NavigationApi; settled: boolean; trace: NavigationTrace }
const zeroNavigation = <T extends string>(keys: readonly T[]): Record<T, number> => Object.fromEntries(keys.map(key => [key, 0])) as Record<T, number>;
function navigationPhaseSummary(): NavigationCachePhaseSummaryV1 {
  return { lookupDecisions: { getEvidence: zeroNavigation(navigationDecisions), readSource: zeroNavigation(navigationDecisions) }, candidateBuilds: { attempted: 0, installed: 0, discarded: 0, rejectedByAdmission: 0, failed: 0, cancelled: 0 }, buildRaceReasons: zeroNavigation(["external_only", "local_only", "both_changed", "unclassified"]), externalObservations: Object.fromEntries(navigationCheckpoints.map(key => [key, zeroNavigation(navigationOutcomes)])) as NavigationCachePhaseSummaryV1["externalObservations"], externalObservationCoverage: { complete: false, checkpoints: Object.fromEntries(navigationCheckpoints.map(key => [key, false])) as Record<NavigationCheckpoint, boolean> }, projectionAdmission: { evaluatedCount: 0, acceptedCount: 0, acceptedBytesTotal: 0, maxAcceptedBytes: 0, overLimitCount: 0, invalidCount: 0, limitBytes: navigationLimit } };
}
function freezeNavigation<T>(value: T): T { if (value && typeof value === "object") { for (const item of Object.values(value)) freezeNavigation(item); Object.freeze(value); } return value; }
function compareNavigation(before: ValidNavigationSample, after: NavigationValiditySample): NavigationOutcome {
  if (after.status !== "valid") return after.status;
  const external = before.dataVersion !== after.dataVersion, local = before.localSnapshotGeneration !== after.localSnapshotGeneration;
  return external ? local ? "both_changed" : "external_only" : local ? "local_only" : "unchanged";
}

/** Pull-only aggregation. Requests retain their phase; no product references enter summaries. */
class NavigationObservation implements NavigationCacheObservationScopeV1 {
  private readonly summary: NavigationCacheObserverSummaryV1 = { contractVersion: "xray.navigation-cache-observer.v1", phases: { coldNavigation: navigationPhaseSummary(), warmNavigation: navigationPhaseSummary() } };
  private readonly phases = new Map<NavigationPhase, NavigationPhaseState>();
  private readonly recent = new WeakMap<GraphStore, ValidNavigationSample>();
  private active: NavigationPhaseState | null = null;
  private next = 0;
  private disposed = false;
  private broken = false;
  constructor(private readonly markerStore: (ref: SnapshotRef) => GraphStore | undefined, private readonly probe: (store: GraphStore) => NavigationProbe, private readonly detach: () => void) {}
  private fault(): void { this.broken = true; for (const state of this.phases.values()) state.invalid = true; }
  private add(target: Record<string, number>, key: string, amount = 1): void {
    if (this.broken) return;
    const value = target[key]; if (!Number.isSafeInteger(value) || value! < 0 || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(value! + amount)) { this.fault(); return; }
    target[key] = value! + amount;
  }
  private observe(state: NavigationPhaseState, checkpoint: NavigationCheckpoint, outcome: NavigationOutcome, covered: boolean): void {
    if (!covered) state.missing.add(checkpoint);
    this.add(this.summary.phases[state.name].externalObservations[checkpoint], outcome);
  }
  comparison(store: GraphStore, probe: NavigationProbe, establish = false): NavigationOutcome {
    const before = this.recent.get(store);
    const outcome = probe.sample.status !== "valid" ? probe.sample.status : before ? compareNavigation(before, probe.sample) : establish ? "unchanged" : "unavailable";
    if (probe.sample.status === "valid") this.recent.set(store, probe.sample);
    return outcome;
  }
  beginPhase(name: NavigationPhase, rawRef: SnapshotRef): void {
    if (this.disposed) return;
    try {
      if (name !== navigationPhases[this.next] || this.active) { this.fault(); return; }
      const ref = { repositoryId: rawRef.repositoryId, snapshotId: rawRef.snapshotId };
      if (typeof ref.repositoryId !== "string" || typeof ref.snapshotId !== "string") { this.fault(); return; }
      const state: NavigationPhaseState = { name, ref, calls: { getEvidence: 0, readSource: 0 }, pending: 0, started: true, ended: false, invalid: false, missing: new Set() };
      this.phases.set(name, state); this.active = state;
      const store = this.markerStore(ref);
      if (store) { const probe = this.probe(store); this.observe(state, "phase_start", this.comparison(store, probe, true), probe.covered); }
      else this.observe(state, "phase_start", "unavailable", true);
    } catch { this.fault(); }
  }
  endPhase(name: NavigationPhase): void {
    if (this.disposed) return;
    try {
      const state = this.active;
      if (!state || state.name !== name || state.ended) { this.fault(); return; }
      state.ended = true;
      if (state.pending) { state.invalid = true; state.missing.add("after_last_lookup"); return; }
      const store = this.markerStore(state.ref);
      if (store) { const probe = this.probe(store); this.observe(state, "after_last_lookup", this.comparison(store, probe), probe.covered); }
      else this.observe(state, "after_last_lookup", "unavailable", true);
      this.active = null; this.next++;
    } catch { this.fault(); }
  }
  capture(api: NavigationApi, ref: SnapshotRef): NavigationObservationRequest | undefined {
    if (this.disposed || this.broken) return;
    try {
      const phase = this.active;
      if (!phase || phase.ended) { this.fault(); return; }
      if (phase.ref.repositoryId !== ref.repositoryId || phase.ref.snapshotId !== ref.snapshotId) phase.invalid = true;
      if (!Number.isSafeInteger(phase.pending + 1) || !Number.isSafeInteger(phase.calls[api] + 1)) { this.fault(); return; }
      phase.pending++; phase.calls[api]++;
      return { phase, api, settled: false, trace: { decision: "lookup_error" } };
    } catch { this.fault(); return; }
  }
  settle(request: NavigationObservationRequest): void {
    if (this.disposed) return;
    try {
      if (request.settled) { this.fault(); return; } request.settled = true;
      const { phase, api, trace } = request, target = this.summary.phases[phase.name];
      this.add(target.lookupDecisions[api], trace.decision);
      if (trace.lookup) this.observe(phase, "lookup_validity", trace.lookup.outcome, trace.lookup.covered); else phase.missing.add("lookup_validity");
      if (trace.candidate) {
        const c = trace.candidate; this.add(target.candidateBuilds, "attempted"); this.add(target.candidateBuilds, c.terminal);
        this.observe(phase, "build_before", c.before, c.beforeCovered); this.observe(phase, "build_after", c.after, c.afterCovered);
        if (c.race) this.add(target.buildRaceReasons, c.race);
        if (c.admission) {
          this.add(target.projectionAdmission, "evaluatedCount");
          if (c.admission.status === "accepted") { this.add(target.projectionAdmission, "acceptedCount"); this.add(target.projectionAdmission, "acceptedBytesTotal", c.admission.bytes); target.projectionAdmission.maxAcceptedBytes = Math.max(target.projectionAdmission.maxAcceptedBytes, c.admission.bytes); }
          else this.add(target.projectionAdmission, c.admission.status === "over_limit" ? "overLimitCount" : "invalidCount");
        }
      }
      phase.pending--;
      if (phase.ended && phase.pending === 0 && this.active === phase) { this.active = null; this.next++; }
    } catch { this.fault(); }
  }
  getSummary(): NavigationCacheObserverSummaryV1 {
    // Keep even a faulted observer's pull result within the fixed, safe numeric contract.
    const result: NavigationCacheObserverSummaryV1 = { contractVersion: "xray.navigation-cache-observer.v1", phases: { coldNavigation: navigationPhaseSummary(), warmNavigation: navigationPhaseSummary() } };
    const copy = (target: object, source: object): void => {
      for (const key of Object.keys(target)) {
        const output = target as Record<string, unknown>, input = source as Record<string, unknown>, value = input[key];
        if (typeof output[key] === "number") {
          if (Number.isSafeInteger(value) && (value as number) >= 0) output[key] = value;
          else this.fault();
        } else if (output[key] && typeof output[key] === "object") {
          if (value && typeof value === "object") copy(output[key] as object, value); else this.fault();
        }
      }
    };
    try { copy(result.phases, this.summary.phases); } catch { this.fault(); }
    for (const name of navigationPhases) {
      const state = this.phases.get(name), target = result.phases[name], coverage = target.externalObservationCoverage;
      if (!state) continue;
      const expected: Record<NavigationCheckpoint, number> = { phase_start: 1, lookup_validity: state.calls.getEvidence + state.calls.readSource, build_before: target.candidateBuilds.attempted, build_after: target.candidateBuilds.attempted, after_last_lookup: 1 };
      for (const checkpoint of navigationCheckpoints) coverage.checkpoints[checkpoint] = !state.missing.has(checkpoint) && Object.values(target.externalObservations[checkpoint]).reduce((a, b) => a + b, 0) === expected[checkpoint];
      coverage.complete = state.started && state.ended && state.pending === 0 && !state.invalid && !this.broken && Object.values(coverage.checkpoints).every(Boolean);
    }
    return freezeNavigation(result);
  }
  dispose(): void {
    if (this.disposed) return;
    if (this.active) this.active.invalid = true;
    this.disposed = true; this.detach();
  }
}

// Inspect complete data without executing accessors before yielding to asynchronous work.
function captureOwnershipData<T>(input: T): T {
  const visiting = new Set<object>();
  const fail = (): never => { throw new SafeDiagnosticError("TASK_FAILED"); };
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
  check(input);
  try { return structuredClone(input); } catch { return fail(); }
}

export class XRayApplication {
  private readonly legacyStore: GraphStore;
  private readonly stores = new Map<string, GraphStore>();
  private readonly snapshotStores = new Map<string, GraphStore>();
  private readonly analyzers: LanguageAnalyzer[] = [new TypeScriptAnalyzer(), new PythonAnalyzer()];
  private readonly cacheRoot: string;
  private readonly projectDatabaseRoot: string | undefined;
  private readonly onProgress: ((progress: IndexProgress) => void) | undefined;
  private current: ProjectOverview | null;
  private currentActivation: string;
  private readonly questions = new Map<string, OwnershipQuestion>();
  private readonly gradingQuestions = new Set<string>();
  private ownershipClosed = false;
  private navigationSlot: NavigationSlot | null = null;
  private navigationObservation: NavigationObservation | null = null;

  constructor(options: XRayApplicationOptions) {
    this.legacyStore = new GraphStore(options.databasePath, "global");
    this.cacheRoot = options.cacheRoot;
    this.projectDatabaseRoot = options.projectDatabaseRoot;
    this.onProgress = options.onProgress;
    this.current = this.legacyStore.getLatestOverview();
    this.currentActivation = this.legacyStore.getCurrentActivation();
    if (this.current) this.snapshotStores.set(this.current.snapshotId, this.legacyStore);
    if (this.projectDatabaseRoot) this.loadProjectStores(this.projectDatabaseRoot);
  }

  private loadProjectStores(root: string): void {
    mkdirSync(root, { recursive: true });
    for (const name of readdirSync(root).filter((item) => item.endsWith(".sqlite"))) {
      try {
        const repositoryId = name.slice(0, -7); const store = new GraphStore(join(root, name), "project"); const latest = store.getLatestOverview();
        this.stores.set(repositoryId, store);
        if (latest) {
          this.snapshotStores.set(latest.snapshotId, store);
          const activation = store.getCurrentActivation();
          if (!this.current || activation > this.currentActivation) { this.current = latest; this.currentActivation = activation; }
        }
      } catch { /* 损坏的单项目数据库不能阻止其他项目启动。 */ }
    }
  }

  getCurrentProject(): ProjectOverview | null { return this.current; }

  openNavigationCacheObservationV1(): NavigationCacheObservationScopeV1 | null {
    if (this.ownershipClosed || this.navigationObservation) return null;
    const observation = new NavigationObservation(ref => this.snapshotStores.get(ref.snapshotId) ?? this.stores.get(ref.repositoryId), store => this.navigationProbe(store), () => { if (this.navigationObservation === observation) this.navigationObservation = null; });
    this.navigationObservation = observation;
    // A facade exposes no internal counters, tokens, request contexts, or product references.
    return Object.freeze({ beginPhase: (phase: NavigationPhase, ref: SnapshotRef) => observation.beginPhase(phase, ref), endPhase: (phase: NavigationPhase) => observation.endPhase(phase), getSummary: () => observation.getSummary(), dispose: () => observation.dispose() });
  }

  private navigationProbe(store: GraphStore): NavigationProbe {
    try {
      const sample = store.sampleNavigationValidity();
      if (!sample || typeof sample !== "object" || !["valid", "unavailable", "invalid_type", "in_transaction", "closed"].includes(sample.status)) return { sample: { status: "invalid_type" }, covered: true };
      if (sample.status === "valid") {
        if (!Number.isSafeInteger(sample.dataVersion) || sample.dataVersion < 0 || !Number.isSafeInteger(sample.localSnapshotGeneration) || sample.localSnapshotGeneration < 0) return { sample: { status: "invalid_type" }, covered: true };
        return { sample: { status: "valid", dataVersion: sample.dataVersion, localSnapshotGeneration: sample.localSnapshotGeneration }, covered: true };
      }
      return { sample: { status: sample.status }, covered: true };
    } catch { return { sample: { status: "unavailable" }, covered: false }; }
  }

  /** One estimator for the serialized identity/evidence projection, never the full graph. */
  private projectNavigationSnapshot(snapshot: ProjectSnapshot): NavigationProjection {
    let bytes: number;
    try { bytes = Buffer.byteLength(JSON.stringify({ repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, rootPath: snapshot.rootPath, evidence: [] }), "utf8"); }
    catch { return { status: "invalid" }; }
    if (!Number.isSafeInteger(bytes) || bytes < 0) return { status: "invalid" };
    if (bytes > navigationLimit) return { status: "over_limit" };
    const evidenceIndex = new Map<string, Evidence>();
    for (const item of snapshot.evidence) {
      if (evidenceIndex.has(item.id)) continue; // Preserve Array.find's first occurrence semantics.
      try { bytes += Buffer.byteLength(JSON.stringify(item), "utf8") + (evidenceIndex.size ? 1 : 0); }
      catch { return { status: "invalid" }; }
      if (!Number.isSafeInteger(bytes) || bytes < 0) return { status: "invalid" };
      if (bytes > navigationLimit) return { status: "over_limit" };
      evidenceIndex.set(item.id, structuredClone(item));
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0) return { status: "invalid" };
    if (bytes > navigationLimit) return { status: "over_limit" };
    return { status: "accepted", bytes, evidenceIndex };
  }

  private requireNavigation(ref: SnapshotRef, observation?: NavigationObservation, request?: NavigationObservationRequest): NavigationContext {
    const trace = request?.trace;
    const decide = (decision: NavigationDecision): void => { if (trace) trace.decision = decision; };
    // Preserve requireSnapshot's original selection, lazy opening, and fallback order.
    const known = this.snapshotStores.get(ref.snapshotId);
    if (!known && this.projectDatabaseRoot && !this.stores.has(ref.repositoryId)) {
      const databasePath = join(this.projectDatabaseRoot, `${ref.repositoryId}.sqlite`);
      if (existsSync(databasePath)) this.stores.set(ref.repositoryId, new GraphStore(databasePath, "project"));
    }
    const project = this.stores.get(ref.repositoryId), store = known ?? project ?? this.legacyStore;
    const before = this.navigationProbe(store);
    if (trace && observation) trace.lookup = { outcome: observation.comparison(store, before), covered: before.covered };
    const old = this.navigationSlot;
    const matches = old?.store === store && old.repositoryId === ref.repositoryId && old.snapshotId === ref.snapshotId;
    const change = matches && before.sample.status === "valid" ? compareNavigation(old.sample, before.sample) : "unchanged";
    if (matches && before.sample.status === "valid" && change === "unchanged" && !this.ownershipClosed) { decide("hit"); return old; }
    this.navigationSlot = null;
    const load = (): { snapshot: ProjectSnapshot; sameStore: boolean } => {
      let loadedFrom: GraphStore | undefined;
      const read = (candidate: GraphStore | undefined): ProjectSnapshot | null | undefined => { const value = candidate?.loadSnapshot(ref.snapshotId); if (value) loadedFrom = candidate; return value; };
      const snapshot = read(known) ?? read(project) ?? read(this.legacyStore);
      if (!snapshot || snapshot.repositoryId !== ref.repositoryId) throw new Error("项目或快照不存在");
      this.snapshotStores.set(ref.snapshotId, store);
      return { snapshot, sameStore: loadedFrom === store };
    };
    const context = (snapshot: ProjectSnapshot): NavigationContext => ({ store, repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, rootPath: snapshot.rootPath, evidenceList: snapshot.evidence });
    if (before.sample.status !== "valid" || this.ownershipClosed) {
      decide(this.ownershipClosed || before.sample.status === "closed" ? "store_closed_error" : before.sample.status === "in_transaction" ? "transaction_bypass" : before.sample.status === "invalid_type" ? "invalid_token_bypass" : "token_unavailable_bypass");
      return context(load().snapshot);
    }
    let snapshot: ProjectSnapshot | undefined, projection: NavigationProjection | undefined, sameStore = false, legacy = false;
    let failed = false, loadError: unknown;
    let after: NavigationProbe = { sample: { status: "unavailable" }, covered: false };
    const candidate: NonNullable<NavigationTrace["candidate"]> = { before: "unchanged", beforeCovered: before.covered, after: "unavailable", afterCovered: false, terminal: "failed" };
    try {
      const loaded = load(); snapshot = loaded.snapshot; sameStore = loaded.sameStore;
      legacy = snapshot.analysisIdentity.graphIrVersion.startsWith("legacy-");
      if (!legacy && sameStore && snapshot.snapshotId === ref.snapshotId) {
        try {
          projection = this.projectNavigationSnapshot(snapshot);
          if (projection.status === "accepted" && (!Number.isSafeInteger(projection.bytes) || projection.bytes < 0 || projection.bytes > navigationLimit || !(projection.evidenceIndex instanceof Map))) projection = { status: "invalid" };
          candidate.admission = projection.status === "accepted" ? { status: "accepted", bytes: projection.bytes } : { status: projection.status };
          if (projection.status === "invalid") failed = true;
        } catch { failed = true; }
      } else if (!legacy) failed = true;
    } catch (error) { failed = true; loadError = error; }
    finally {
      // Every attempted candidate samples after, even when load/admission fails, with or without observation.
      if (!legacy) after = this.navigationProbe(store);
    }
    if (legacy && snapshot) { decide("legacy_bypass"); return context(snapshot); }
    if (observation && request) observation.comparison(store, after);
    candidate.after = compareNavigation(before.sample, after.sample); candidate.afterCovered = after.covered;
    if (trace) trace.candidate = candidate;
    if (failed || !snapshot || !projection) {
      decide("build_error_fallback");
      if (!snapshot) throw loadError;
      return context(snapshot);
    }
    if (projection.status === "over_limit") { candidate.terminal = "rejectedByAdmission"; decide("projection_limit_fallback"); return context(snapshot); }
    if (projection.status !== "accepted") { decide("build_error_fallback"); return context(snapshot); }
    if (candidate.after !== "unchanged" || after.sample.status !== "valid" || this.ownershipClosed) {
      candidate.terminal = "discarded";
      candidate.race = candidate.after === "external_only" || candidate.after === "local_only" || candidate.after === "both_changed" ? candidate.after : "unclassified";
      decide(candidate.race === "external_only" ? "build_discard_external" : candidate.race === "local_only" ? "build_discard_local" : candidate.race === "both_changed" ? "build_discard_combined" : "build_discard_unclassified");
      return context(snapshot);
    }
    const installed: NavigationSlot = { store, repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, rootPath: snapshot.rootPath, evidenceIndex: projection.evidenceIndex, sample: after.sample };
    this.navigationSlot = installed; candidate.terminal = "installed";
    decide(!matches ? "empty_build_installed" : change === "external_only" ? "external_rebuild_installed" : change === "local_only" ? "local_rebuild_installed" : "combined_rebuild_installed");
    return installed;
  }

  /** Trusted worker wiring only. No provider or credential reader is configured by default. */
  createRemoteExplanations(ports: { provider?: RemoteProviderPort; credentials?: RemoteCredentialPort; onTask?: (task: import("@project-xray/contracts").RemoteTaskRecord) => void } = {}): RemoteExplanationApplication {
    return new RemoteExplanationApplication({
      authority: this.legacyStore,
      ...(ports.provider ? { provider: ports.provider } : {}), ...(ports.credentials ? { credentials: ports.credentials } : {}), ...(ports.onTask ? { onTask: ports.onTask } : {}),
      stores: ref => {
        // Use fresh DB identities, including legacy snapshots with per-project settings.
        const settings = this.stores.get(ref.repositoryId) ?? this.legacyStore;
        let source = settings;
        try { source.remoteSnapshotMetadata(ref.repositoryId, ref.snapshotId); }
        catch { source = this.legacyStore; source.remoteSnapshotMetadata(ref.repositoryId, ref.snapshotId); }
        return { settings, source };
      },
      currentReference: () => {
        if (this.projectDatabaseRoot) for (const name of readdirSync(this.projectDatabaseRoot).filter(item => item.endsWith(".sqlite"))) {
          const id = name.slice(0, -7); if (!this.stores.has(id)) this.stores.set(id, new GraphStore(join(this.projectDatabaseRoot, name), "project"));
        }
        return [this.legacyStore, ...this.stores.values()].map(store => store.getActiveReference()).filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.activation.localeCompare(a.activation))[0] ?? null;
      },
      checkWorkspace: async (ref, signal) => { throwIfAborted(signal); const state = await this.getSnapshotState(ref); throwIfAborted(signal); return state; },
    });
  }

  getIgnoreSettings(ref: SnapshotRef): IgnoreSettingsResponse {
    if (!ignoreSettingsRequestSchema.safeParse({ repositoryId: ref.repositoryId, snapshotId: ref.snapshotId }).success) throw new SafeDiagnosticError("IGNORE_SETTINGS_INVALID");
    const { snapshot } = this.requireSnapshot(ref);
    const settings = this.storeForRepository(snapshot.repositoryId).loadIgnoreSettings(snapshot.repositoryId);
    return { repositoryId: ref.repositoryId, snapshotId: ref.snapshotId, settings, policy: createIgnorePolicy(settings.rules), defaultRules: DEFAULT_IGNORE, ...(snapshot.analysisIdentity.ignorePolicy ? { snapshotPolicy: snapshot.analysisIdentity.ignorePolicy } : {}) };
  }

  saveIgnoreSettings(raw: SaveIgnoreSettingsRequest): IgnoreSettingsResponse {
    const parsed = saveIgnoreSettingsRequestSchema.safeParse(raw); if (!parsed.success) throw new SafeDiagnosticError("IGNORE_SETTINGS_INVALID");
    const input = parsed.data; this.requireSnapshot(input);
    const settings = this.storeForRepository(input.repositoryId).saveIgnoreSettings(input.repositoryId, input.expectedRevision, input.rules);
    if (settings.revision !== input.expectedRevision) this.questions.clear();
    return this.getIgnoreSettings(input);
  }

  async importGit(input: { url: string; branch?: string | undefined }, options: IndexOptions = {}): Promise<ProjectSnapshot> {
    await mkdir(this.cacheRoot, { recursive: true }); throwIfAborted(options.signal);
    const rootPath = await cloneRepository(this.cacheRoot, input.url, input.branch);
    return this.indexProject(rootPath, "git", options);
  }

  async indexProject(rootPath: string, sourceType: "local" | "git" = "local", options: IndexOptions = {}): Promise<ProjectSnapshot> {
    const progress = options.onProgress ?? this.onProgress;
    throwIfAborted(options.signal);
    let secureScope: SecureReadScope;
    try { secureScope = await createSecureReadScope(rootPath); }
    catch (error) { if (isAbort(error)) throw error; throw new SafeDiagnosticError(diagnosticForError(error, "FILE_ACCESS_FAILED").code); }
    const safeRoot = secureScope.rootPath;
    const repositoryId = stableId("repository", safeRoot.toLocaleLowerCase());
    try {
    const settingsStore = this.storeForRepository(repositoryId);
    const settings = settingsStore.loadIgnoreSettings(repositoryId);
    const policy = createIgnorePolicy(settings.rules);
    progress?.({ phase: "discovering", completed: 0, total: 0 });
    let discovery: Awaited<ReturnType<typeof discoverProject>>;
    try { discovery = await discoverProject(safeRoot, options.signal, undefined, policy); }
    catch (error) { if (isAbort(error)) throw error; throw new SafeDiagnosticError(diagnosticForError(error, "FILE_DISCOVERY_FAILED").code); }
    const sources: IndexedSource[] = [];
    const failures: ProjectSnapshot["health"]["failedFiles"] = discovery.failures.map((failure) => failureWithCode(safeRoot, failure.filePath, failure.code, failure.detailCode, "FILE_DISCOVERY_FAILED"));
    for (const [index, absolutePath] of discovery.files.entries()) {
      throwIfAborted(options.signal);
      const projectPath = normalizeProjectPath(safeRoot, absolutePath);
      progress?.({ phase: "reading", completed: index, total: discovery.files.length, currentFile: projectPath });
      try {
        const content = await readSecureProjectFile(secureScope, absolutePath, { ...(options.signal ? { signal: options.signal } : {}), ...(options.testOnlySecureReadHooks ? { testHooks: options.testOnlySecureReadHooks } : {}) });
        sources.push({ absolutePath, projectPath, content, contentHash: contentFingerprint(content), language: languageFromPath(projectPath) });
      } catch (error) { if (isProjectPathSecurityError(error)) throw error; failures.push(failureFromError(safeRoot, projectPath, error, "FILE_READ_FAILED")); }
    }

    const sourceIdentity = sourceFingerprint(sources.map((item) => ({ path: item.projectPath, content: item.content })));
    const analyzerVersions = Object.fromEntries(this.analyzers.map((item) => [item.id, item.version]));
    const configurationHash = configurationFingerprint(sourceFingerprint(sources.filter((item) => isAnalysisConfig(item.projectPath)).map((item) => ({ path: item.projectPath, content: item.content }))), policy);
    const analysisIdentity = { graphIrVersion: GRAPH_IR_VERSION, analyzerVersions, configurationHash, sourceFingerprint: sourceIdentity, ignorePolicy: policy };
    const snapshotId = stableId(repositoryId, sourceIdentity, GRAPH_IR_VERSION, JSON.stringify(analyzerVersions), configurationHash);
    const rootNodeId = stableId(repositoryId, "repository-root");
    const nodes: GraphNode[] = [{ id: rootNodeId, snapshotId, kind: "repository", name: basename(safeRoot), qualifiedName: safeRoot, metadata: { sourceType } }];
    const edges: GraphEdge[] = []; const evidence: Evidence[] = []; const moduleIds = new Map<string, string>();
    const typeScriptSources: Array<{ absolutePath: string; content: string }> = []; const pythonSources: Array<{ absolutePath: string; content: string }> = [];

    for (const [index, item] of sources.entries()) {
      throwIfAborted(options.signal);
      progress?.({ phase: "analyzing", completed: index, total: sources.length, currentFile: item.projectPath });
      const fileNodeId = stableId(repositoryId, "file", item.projectPath); const fileEvidenceId = stableId(snapshotId, item.projectPath, "file"); const fileSpan = wholeFileSpan(item.projectPath, item.content);
      nodes.push({ id: fileNodeId, snapshotId, kind: "file", name: basename(item.projectPath), qualifiedName: item.projectPath, language: item.language, filePath: item.projectPath, span: fileSpan, evidenceId: fileEvidenceId, metadata: { bytes: Buffer.byteLength(item.content), contentHash: item.contentHash } });
      evidence.push({ id: fileEvidenceId, snapshotId, analyzer: "project-indexer", analyzerVersion: GRAPH_IR_VERSION, kind: "file", confidence: "verified", reason: "文件内容已进入不可变索引快照", span: fileSpan });
      const moduleName = moduleNameForPath(item.projectPath); let moduleId = moduleIds.get(moduleName);
      if (!moduleId) { moduleId = stableId(repositoryId, "module", moduleName); moduleIds.set(moduleName, moduleId); nodes.push({ id: moduleId, snapshotId, kind: "module", name: moduleName, qualifiedName: moduleName, metadata: {} }); edges.push({ id: stableId(snapshotId, rootNodeId, moduleId, "CONTAINS"), snapshotId, source: rootNodeId, target: moduleId, kind: "CONTAINS", confidence: "verified", evidenceId: fileEvidenceId, reason: "目录结构定义模块分组" }); }
      edges.push({ id: stableId(snapshotId, moduleId, fileNodeId, "CONTAINS"), snapshotId, source: moduleId, target: fileNodeId, kind: "CONTAINS", confidence: "verified", evidenceId: fileEvidenceId, reason: "文件位于该目录模块中" });
      const analyzer = this.analyzers.find((candidate) => candidate.supports(item.absolutePath));
      if (analyzer instanceof TypeScriptAnalyzer) typeScriptSources.push({ absolutePath: item.absolutePath, content: item.content });
      else if (analyzer instanceof PythonAnalyzer) pythonSources.push({ absolutePath: item.absolutePath, content: item.content });
    }

    const context = { rootPath: safeRoot, repositoryId, snapshotId, ...(options.signal ? { abortSignal: options.signal } : {}) };
    if (typeScriptSources.length > 0) {
      try { const result = await (this.analyzers.find((item): item is TypeScriptAnalyzer => item instanceof TypeScriptAnalyzer)!).analyzeProject(typeScriptSources, context, sources.filter((item) => isAnalysisConfig(item.projectPath)).map((item) => ({ absolutePath: item.absolutePath, content: item.content }))); nodes.push(...result.nodes); edges.push(...result.edges); evidence.push(...result.evidence); failures.push(...(result.failures ?? []).map((failure) => failureFromAnalyzerResult(safeRoot, failure, "ANALYSIS_FAILED"))); }
      catch (error) { if (isAbort(error)) throw error; failures.push(failureFromError(safeRoot, "<TypeScript Program>", error, "ANALYSIS_FAILED")); }
    }
    throwIfAborted(options.signal);
    if (pythonSources.length > 0) {
      try { const result = await (this.analyzers.find((item): item is PythonAnalyzer => item instanceof PythonAnalyzer)!).analyzeProject(pythonSources, context); nodes.push(...result.nodes); edges.push(...result.edges); evidence.push(...result.evidence); failures.push(...(result.failures ?? []).map((failure) => failureFromAnalyzerResult(safeRoot, failure, "PYTHON_ANALYSIS_FAILED"))); }
      catch (error) { if (isAbort(error)) throw error; failures.push(failureFromError(safeRoot, "<Python Project>", error, "PYTHON_ANALYSIS_FAILED")); }
    }

    const knownNodeIds = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      if (knownNodeIds.has(edge.target) || !edge.unresolvedTarget) continue;
      const kind = edge.kind === "CALLS" ? "unresolved-call" as const : edge.kind === "IMPORTS" && edge.unresolvedTarget.startsWith(".") ? "module" as const : "external-dependency" as const;
      nodes.push({ id: edge.target, snapshotId, kind, name: edge.unresolvedTarget, qualifiedName: edge.unresolvedTarget, metadata: { unresolved: true, referenceKind: kind === "module" ? "unresolved-module" : kind } }); knownNodeIds.add(edge.target);
    }
    const dedupedNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
    const gitHead = await getGitHead(safeRoot); throwIfAborted(options.signal);
    const languageCounts = sources.reduce<Record<string, number>>((counts, item) => { counts[item.language] = (counts[item.language] ?? 0) + 1; return counts; }, {});
    const snapshot: ProjectSnapshot = {
      repositoryId, snapshotId, name: basename(safeRoot), rootPath: safeRoot, sourceType, ...(gitHead ? { gitHead } : {}), createdAt: new Date().toISOString(), analysisIdentity,
      sourceFiles: sources.map(({ projectPath: filePath, contentHash, content, language }) => ({ filePath, contentHash, bytes: Buffer.byteLength(content), language })),
      nodes: dedupedNodes, edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()], evidence: [...new Map(evidence.map((item) => [item.id, item])).values()],
      health: { status: failures.length > 0 ? "partial" : "ready", totalFiles: discovery.files.length + discovery.unsupportedFiles + discovery.ignoredFiles, indexedFiles: sources.length, skippedFiles: discovery.ignoredFiles, unsupportedFiles: discovery.unsupportedFiles, ignoredByRule: discovery.ignoredByRule, failedFiles: failures, languageCounts, limitations: ["静态分析不等同于运行时追踪", "按规则排除的目录只报告规则，不枚举目录内文件数量", "配置身份包含项目排除策略及 package.json、pyproject.toml、requirements.txt、tsconfig.json 与 jsconfig.json；extends 指向的外部配置不解析"] },
    };

    progress?.({ phase: "verifying", completed: 0, total: sources.length });
    const verified = await discoverAndRead(safeRoot, options.signal, (completed, total, currentFile) => progress?.({ phase: "verifying", completed, total, currentFile }), secureScope, options.testOnlySecureReadHooks, policy);
    const initialMap = new Map(sources.map((item) => [item.projectPath, item.contentHash])); const verifiedMap = new Map(verified.sources.map((item) => [item.projectPath, item.contentHash]));
    const drift = compareSourceMaps(initialMap, verifiedMap);
    if (drift.added.length || drift.removed.length || drift.changed.length || verified.discovery.failures.length) throw new SafeDiagnosticError("INDEX_SOURCE_CHANGED");
    throwIfAborted(options.signal);
    progress?.({ phase: "persisting", completed: sources.length, total: sources.length });
    const store = this.storeForRepository(repositoryId);
    const published = store.saveSnapshot(finalizeAnalysisSnapshot(snapshot), sources.map((item) => ({ filePath: item.projectPath, contentHash: item.contentHash, language: item.language, content: item.content })), true, settings.revision, this.currentActivation);
    throwIfAborted(options.signal);
    this.snapshotStores.set(published.snapshotId, store); this.current = overviewFromSnapshot(published); this.currentActivation = store.getCurrentActivation(); this.questions.clear();
    return published;
    } finally { secureScope.close(); }
  }

  private storeForRepository(repositoryId: string): GraphStore {
    if (!this.projectDatabaseRoot) return this.legacyStore;
    const existing = this.stores.get(repositoryId); if (existing) return existing;
    const store = new GraphStore(join(this.projectDatabaseRoot, `${repositoryId}.sqlite`), "project"); this.stores.set(repositoryId, store); return store;
  }

  private requireSnapshot(ref: SnapshotRef): { snapshot: ProjectSnapshot; store: GraphStore } {
    const known = this.snapshotStores.get(ref.snapshotId);
    if (!known && this.projectDatabaseRoot && !this.stores.has(ref.repositoryId)) {
      const databasePath = join(this.projectDatabaseRoot, `${ref.repositoryId}.sqlite`);
      if (existsSync(databasePath)) this.stores.set(ref.repositoryId, new GraphStore(databasePath, "project"));
    }
    const snapshot = known?.loadSnapshot(ref.snapshotId)
      ?? this.stores.get(ref.repositoryId)?.loadSnapshot(ref.snapshotId)
      ?? this.legacyStore.loadSnapshot(ref.snapshotId);
    if (!snapshot || snapshot.repositoryId !== ref.repositoryId) throw new Error("项目或快照不存在");
    const store = known ?? this.stores.get(ref.repositoryId) ?? this.legacyStore; this.snapshotStores.set(ref.snapshotId, store);
    return { snapshot, store };
  }

  async getSnapshotState(ref: SnapshotRef): Promise<SnapshotState> {
    const { snapshot } = this.requireSnapshot(ref); const checkedAt = new Date().toISOString();
    const validationLimitations = ["在重新发现与逐文件读取完成时校验；普通文件系统不提供跨文件原子快照", "验证本地项目排除配置及五类源码配置文件；不跟踪外部 extends 或解释器/编译器的隐式配置"];
    if (snapshot.analysisIdentity.graphIrVersion.startsWith("legacy-")) return { ...ref, status: "missing", snapshotAvailability: "legacy-missing-source", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: ["<旧版快照未保存源码>"], configurationChanged: true, validationLimitations, checkedAt };
    const settingsStore = this.storeForRepository(snapshot.repositoryId);
    let settings: ReturnType<GraphStore["loadIgnoreSettings"]>;
    try { settings = settingsStore.loadIgnoreSettings(snapshot.repositoryId); }
    catch { return { ...ref, status: "unavailable", snapshotAvailability: "available", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations: [...validationLimitations, safeDiagnostic("IGNORE_SETTINGS_INVALID").reason], checkedAt }; }
    const policy = createIgnorePolicy(settings.rules);
    const policyChanged = snapshot.analysisIdentity.ignorePolicy ? snapshot.analysisIdentity.ignorePolicy.hash !== policy.hash : policy.rules.length > 0;
    if (policyChanged) return { ...ref, status: "stale", snapshotAvailability: "available", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: true, validationLimitations, checkedAt };
    let current: Awaited<ReturnType<typeof discoverAndRead>>;
    try { current = await discoverAndRead(snapshot.rootPath, undefined, undefined, undefined, undefined, policy); settingsStore.assertIgnoreRevision(snapshot.repositoryId, settings.revision); }
    catch { return { ...ref, status: "unavailable", snapshotAvailability: "available", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations, checkedAt }; }
    const expected = new Map(snapshot.sourceFiles.map((item) => [item.filePath, item.contentHash])); const actual = new Map(current.sources.map((item) => [item.projectPath, item.contentHash]));
    const drift = compareSourceMaps(expected, actual); const configPaths = new Set([...drift.added, ...drift.removed, ...drift.changed].filter(isAnalysisConfig));
    const missingFiles = [...new Set([...drift.removed, ...current.discovery.failures.map((item) => item.filePath)])].sort();
    if (current.discovery.failures.length > 0) return { ...ref, status: "unavailable", snapshotAvailability: "available", changedFiles: [], addedFiles: [], removedFiles: [], missingFiles: [], configurationChanged: false, validationLimitations, checkedAt };
    const stale = drift.added.length > 0 || drift.removed.length > 0 || drift.changed.length > 0;
    return { ...ref, status: stale ? "stale" : "current", snapshotAvailability: "available", changedFiles: drift.changed, addedFiles: drift.added, removedFiles: drift.removed, missingFiles, configurationChanged: configPaths.size > 0, validationLimitations, checkedAt };
  }

  listModules(input: ModuleListRequest): ModuleListResponse { return this.requireStore(input).listModules(input); }
  getModuleOverview(input: ModuleOverviewRequest): ModuleOverviewResponse { return this.requireStore(input).getModuleOverview(input); }
  expandModule(input: ModuleExpansionRequest): ModuleExpansionResponse { return this.requireStore(input).expandModule(input); }
  getModuleRelationEdges(input: ModuleRelationEdgesRequest): ModuleRelationEdgesResponse { return this.requireStore(input).listModuleRelationEdges(input); }
  search(input: SearchRequest): SearchResponse { return this.requireStore(input).search(input); }
  queryGraph(input: GraphQueryRequest): GraphQueryResponse { return this.requireStore(input).queryGraph(input); }
  getEvidence(rawInput: SnapshotRef & { evidenceId: string }): IdentifiedEvidence {
    const observation = this.navigationObservation, input = { ...rawInput }, request = observation?.capture("getEvidence", input);
    try { const navigation = this.requireNavigation(input, observation ?? undefined, request); const item = navigation.store.getEvidence(input.snapshotId, input.evidenceId); if (!item) throw new Error("证据不存在于指定快照"); return { ...structuredClone(item), repositoryId: navigation.repositoryId }; }
    finally { if (request) observation?.settle(request); }
  }
  findEvidence(input: SnapshotRef & { span: Evidence["span"]; limit: number; cursor?: string | undefined }): EvidenceRangeResponse { return this.requireStore(input).findEvidence(input.repositoryId, input.snapshotId, input.span, input.limit, input.cursor); }

  getFlow(ref: SnapshotRef, nodeId: string, depth = 3): FlowResult { return queryFlow(this.requireSnapshot(ref).snapshot, nodeId, depth); }

  async explainFeature(ref: SnapshotRef, query: string): Promise<FeatureExplanation> {
    const snapshot = await this.requireCurrentSnapshot(ref); this.assertSnapshotPolicyCurrent(snapshot); const seeds = searchNodes(snapshot, expandFeatureQuery(query), 12).sort((a, b) => Number(b.kind === "endpoint") - Number(a.kind === "endpoint"));
    if (seeds.length === 0) return { ...ref, title: `解释：${query}`, summary: "索引中没有找到足够的相关符号。", structure: "related-evidence", steps: [], unknowns: ["请尝试使用路由、函数名、类名或文件名中的关键词。"] };
    const root = seeds[0]!; const bounded = this.requireStore(ref).queryGraph({ version: GRAPH_QUERY_VERSION, ...ref, rootNodeIds: [root.id], view: "call", direction: "outgoing", maxDepth: 6, maxNodes: 80, maxEdges: 160, maxWork: 1200, confidences: ["verified", "inferred", "unknown"] });
    const path = firstCallPath(root, bounded.nodes, bounded.edges);
    const steps = path.map(({ node, edge }, index) => ({
      order: index + 1, title: node.name,
      description: edge ? `${flowEdgeLabel(edge.kind)}：${edge.reason}` : `检索命中的候选入口，位于 ${node.filePath ?? "外部依赖"}。`,
      nodeIds: [node.id], evidenceIds: edge ? [edge.evidenceId] : evidenceForNode(snapshot, node.id).slice(0, 2), confidence: edge?.confidence ?? "inferred" as const,
    }));
    const ordered = path.length > 1;
    const edgesById = new Map(bounded.edges.map((edge) => [edge.id, edge]));
    const evidenceById = new Map(bounded.evidence.map((item) => [item.id, item]));
    const unresolvedByEdgeId = new Map<string, { edge?: GraphEdge; target?: string; reason: string }>();
    for (const { edge } of path) if (edge?.confidence === "unknown") unresolvedByEdgeId.set(edge.id, { edge, ...(edge.unresolvedTarget ? { target: edge.unresolvedTarget } : {}), reason: edge.reason });
    for (const item of bounded.unresolved) if (!unresolvedByEdgeId.has(item.edgeId)) {
      const edge = edgesById.get(item.edgeId); const target = edge?.unresolvedTarget ?? item.target;
      unresolvedByEdgeId.set(item.edgeId, { ...(edge ? { edge } : {}), ...(target ? { target } : {}), reason: edge?.reason ?? item.reason });
    }
    return { ...ref, title: `解释：${query}`, summary: ordered ? `展示从候选 ${root.name} 出发的一条有界静态调用路径；检索相关性不证明它是业务入口，也不是运行时轨迹。` : `只找到与查询相关的候选证据，未证明后续执行顺序。`, structure: ordered ? "ordered-path" : "related-evidence", steps, unknowns: [
      ...[...unresolvedByEdgeId.values()].map(({ edge, target, reason }) => {
        const span = edge ? evidenceById.get(edge.evidenceId)?.span : undefined;
        const label = target ?? edge?.reason ?? reason;
        const details = [
          ...(span ? [`${span.filePath}:${span.startLine}:${span.startColumn + 1}`] : []),
          ...(reason && reason !== label ? [reason] : []),
        ];
        return `无法确认：${label}${details.length ? `（${details.join("；")}）` : ""}`;
      }),
      ...(bounded.truncated ? [`查询已按 ${bounded.truncationReasons.join("、")} 截断；范围外可能仍有路径。`] : []),
      "分支、动态调用、依赖注入和运行时配置可能形成其他路径。",
    ] };
  }

  async createChangeReport(input: ComparisonRequest, options: ComparisonOptions = {}): Promise<ChangeReport> {
    const base = this.requireSnapshot(input).snapshot; const settings = this.storeForRepository(base.repositoryId).loadIgnoreSettings(base.repositoryId); const policy = createIgnorePolicy(settings.rules); const progress = options.onProgress; throwIfAborted(options.signal);
    progress?.({ phase: "capturing", completed: 0, total: 1 });
    const captured = await captureComparison(base.rootPath, input.mode, input.parentNumber ?? 1, options.signal, options.testOnlySecureReadHooks ? { secureReadHooks: options.testOnlySecureReadHooks } : {}, policy); throwIfAborted(options.signal);
    progress?.({ phase: "analyzing-left", completed: 0, total: captured.left.sources.length });
    const leftSnapshot = await this.analyzeComparisonSide(base, captured.left, policy, settings.revision, options.signal, (completed, total, currentFile) => progress?.({ phase: "analyzing-left", completed, total, currentFile }));
    progress?.({ phase: "analyzing-right", completed: 0, total: captured.right.sources.length });
    const rightSnapshot = await this.analyzeComparisonSide(base, captured.right, policy, settings.revision, options.signal, (completed, total, currentFile) => progress?.({ phase: "analyzing-right", completed, total, currentFile }));
    progress?.({ phase: "diffing", completed: 0, total: captured.changes.length });
    const files = captured.changes.map((change, index) => { const id = stableId(base.repositoryId, captured.captureFingerprint, String(index), change.oldPath ?? "", change.newPath ?? ""); const hunks = change.hunks.map((hunk, hunkIndex) => ({ id: stableId(id, "hunk", String(hunkIndex)), ...hunk })); const directChanges = mapDirectChanges(id, change.status, hunks, change.oldPath, change.newPath, leftSnapshot, rightSnapshot); const classified = classifyChangePath(change.newPath ?? change.oldPath ?? "", change.binary); return { id, ...change, ...classified, hunks, directChanges, analyzable: !change.binary && directChanges.some((item) => item.nodeId), ...(!change.binary && directChanges.some((item) => item.nodeId) ? {} : { unsupportedReason: change.binary ? "二进制内容不进行源码分析" : "两侧受支持源码图中没有可映射符号" }) } satisfies ChangeFile; });
    progress?.({ phase: "propagating", completed: 0, total: files.length });
    const impactPaths: ImpactPath[] = []; let usedWork = 0; let truncated = false; const truncationReasons = new Set<string>(); const store = this.storeForRepository(base.repositoryId);
    for (const [index, file] of files.entries()) { throwIfAborted(options.signal); const currentFile = file.newPath ?? file.oldPath; progress?.({ phase: "propagating", completed: index, total: files.length, ...(currentFile ? { currentFile } : {}) }); for (const direct of file.directChanges) { if (!direct.nodeId || impactPaths.length >= input.maxPaths || usedWork >= input.maxWork) { if (direct.nodeId) { truncated = true; truncationReasons.add(impactPaths.length >= input.maxPaths ? "路径数量预算" : "工作量预算"); } continue; } const snapshot = direct.side === "left" ? leftSnapshot : rightSnapshot; const remainingWork = Math.max(1, input.maxWork - usedWork); const paths = impactPathsForDirect(file.id, direct, snapshot, store, input.maxDepth, input.maxPaths - impactPaths.length, remainingWork); for (const path of paths.items) impactPaths.push(path); usedWork += paths.usedWork; if (paths.truncated) { truncated = true; truncationReasons.add(paths.reason); } } }
    const left = comparisonSide(captured.left, leftSnapshot); const right = comparisonSide(captured.right, rightSnapshot); const createdAt = new Date().toISOString(); const queryBudget = { maxDepth: input.maxDepth, maxPaths: input.maxPaths, maxWork: input.maxWork }; const unmappedChanges = files.flatMap((file) => file.directChanges.filter((item) => !item.nodeId).map((item) => ({ changeId: file.id, side: item.side, reason: item.reason }))); const failures = [...left.completeness.failures.map((item) => ({ scope: `left:${item.filePath}`, code: item.code, ...(item.detailCode ? { detailCode: item.detailCode } : {}), reason: item.reason })), ...right.completeness.failures.map((item) => ({ scope: `right:${item.filePath}`, code: item.code, ...(item.detailCode ? { detailCode: item.detailCode } : {}), reason: item.reason }))]; const unknownEdgeCount = impactPaths.flatMap((path) => path.edges).filter((edge) => edge.confidence === "unknown" || Boolean(edge.unresolvedTarget)).length; const impactReasons = [...truncationReasons, ...(unknownEdgeCount ? [`${unknownEdgeCount} 条影响边目标未知`] : []), ...(failures.length ? ["一侧或两侧分析不完整"] : [])]; const completenessStatus = left.completeness.status === "partial" || right.completeness.status === "partial" || unmappedChanges.length > 0 || impactReasons.length > 0 ? "partial" : "complete"; let publicationStatus: ChangeReport["status"] = "current"; try { if (await comparisonStateFingerprint(base.rootPath, input.mode, options.signal, undefined, undefined, policy) !== captured.captureFingerprint) publicationStatus = "stale"; } catch { publicationStatus = "missing"; }
    const report: ChangeReport = { version: CHANGESET_VERSION, id: stableId(base.repositoryId, captured.captureFingerprint, input.mode, leftSnapshot.snapshotId, rightSnapshot.snapshotId, JSON.stringify(queryBudget)), repositoryId: base.repositoryId, mode: input.mode, createdAt, left, right, captureFingerprint: captured.captureFingerprint, status: publicationStatus, files, impactPaths, queryBudget, completeness: { status: completenessStatus, unmappedChanges, impact: { status: impactReasons.length ? "partial" : "complete", reasons: impactReasons, unknownEdgeCount } }, truncated, truncationReasons: [...truncationReasons], failures, limitations: [...captured.limitations, "报告发布前再次核验当前 Git 身份；之后的变化由状态轮询识别，历史快照仍可读", "影响路径按稳定的广度优先顺序选择有限代表路径；不是全部可能路径", "影响路径来自对应侧静态 CALLS/HANDLES 或文件级 IMPORTS 反向可达，只表示可能影响，不证明运行时执行或必然损坏", "配置或分析器身份不同造成的图事实差异不会自动归因于某一行代码"] };
    throwIfAborted(options.signal); progress?.({ phase: "persisting", completed: 0, total: 1 }); store.saveChangeReport(report, settings.revision); return report;
  }

  loadChangeReport(input: { repositoryId: string; reportId: string }): ChangeReport { const report = this.storeForRepository(input.repositoryId).loadChangeReport(input.reportId); if (!report || report.repositoryId !== input.repositoryId) throw new Error("变更报告不存在"); return report; }
  async getChangeReportState(input: { repositoryId: string; reportId: string }): Promise<{ repositoryId: string; reportId: string; status: "current" | "stale" | "missing"; checkedAt: string; reason?: string }> { const report = this.loadChangeReport(input); const checkedAt = new Date().toISOString(); const leftSnapshot = this.requireSnapshot(report.left.snapshot).snapshot; try { const settingsStore = this.storeForRepository(input.repositoryId); const settings = settingsStore.loadIgnoreSettings(input.repositoryId); const policy = createIgnorePolicy(settings.rules); const oldPolicy = leftSnapshot.analysisIdentity.ignorePolicy; if (oldPolicy ? oldPolicy.hash !== policy.hash : policy.rules.length > 0) return { ...input, status: "stale", checkedAt, reason: "项目排除配置已变化" }; const current = await comparisonStateFingerprint(leftSnapshot.rootPath, report.mode, undefined, undefined, undefined, oldPolicy ? policy : undefined); settingsStore.assertIgnoreRevision(input.repositoryId, settings.revision); return { ...input, status: current === report.captureFingerprint ? "current" : "stale", checkedAt, ...(current === report.captureFingerprint ? {} : { reason: "HEAD、index 或工作区已偏离报告捕获身份" }) }; } catch { return { ...input, status: "missing", checkedAt, reason: "Git 仓库或所需对象已不可访问" }; } }

  async createOwnershipQuestions(input: OwnershipQuestionRequest): Promise<OwnershipQuestion[]> {
    if (this.ownershipClosed) throw new SafeDiagnosticError("TASK_FAILED");
    const snapshot = await this.requireCurrentSnapshot(input); this.assertSnapshotPolicyCurrent(snapshot); const store = this.requireStore(input); const generated = createQuestions(snapshot, input, store.listOwnershipAttempts(snapshot.repositoryId));
    if (this.ownershipClosed) throw new SafeDiagnosticError("TASK_FAILED");
    for (const question of generated) this.questions.set(questionKey(question), captureOwnershipData(question)); return generated;
  }

  async gradeOwnershipAnswer(rawSubmission: OwnershipSubmission): Promise<OwnershipGrade> {
    if (this.ownershipClosed) throw new SafeDiagnosticError("TASK_FAILED");
    const submission = captureOwnershipData(rawSubmission);
    const key = questionKey(submission), selected = this.questions.get(key);
    if (!selected) {
      // Preserve stale-snapshot precedence for an invalidated question, without reading caller data again.
      const state = await this.getSnapshotState(submission);
      if (this.ownershipClosed) throw new SafeDiagnosticError("TASK_FAILED");
      if (state.status !== "current") throw new SafeDiagnosticError("SNAPSHOT_NOT_CURRENT");
      throw new Error("题目不存在、已经完成或属于其他快照");
    }
    const question = captureOwnershipData(selected); ownershipQuestionSchema.parse(question);
    if (this.gradingQuestions.has(key)) throw new SafeDiagnosticError("TASK_FAILED");
    this.gradingQuestions.add(key);
    const assertActive = (): void => {
      if (this.ownershipClosed || this.questions.get(key) !== selected || canonicalJson(captureOwnershipData(selected)) !== canonicalJson(question)) throw new SafeDiagnosticError("TASK_FAILED");
    };
    try {
      const { snapshot, store } = this.requireSnapshot(submission);
      const settingsStore = this.storeForRepository(snapshot.repositoryId); const settingsRevision = settingsStore.loadIgnoreSettings(snapshot.repositoryId).revision;
      const source = store.captureOwnershipSource(snapshot.repositoryId, snapshot.snapshotId, settingsRevision);
      const state = await this.getSnapshotState(submission);
      assertActive();
      if (state.status !== "current") throw new SafeDiagnosticError("SNAPSHOT_NOT_CURRENT");
      this.assertSnapshotPolicyCurrent(snapshot);
      ownershipSubmissionSchema.parse(submission);
      const sources = new Map<string, OwnershipRubricSource>();
      const citations = validateCitations(snapshot, submission.citations, (filePath) => {
        const stored = store.readSnapshotSource(snapshot.snapshotId, filePath);
        if (stored) sources.set(filePath, { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, filePath, contentHash: stored.contentHash, content: stored.content });
        return stored?.content;
      });
      const grade = gradeAnswer(question, submission, snapshot, citations);
      let structuredAnswer = submission.structuredAnswer;
      if (structuredAnswer.kind === "variable-flow") {
        const citationKey = (citation: SourceCitation): string => JSON.stringify([citation.filePath, citation.startLine, citation.startColumn, citation.endLine, citation.endColumn, citation.evidenceId]);
        const indices = new Map(grade.validatedCitations.map((citation, index) => [citationKey(citation), index]));
        // Grade against the original input; only the new persisted structure uses deduplicated indices.
        structuredAnswer = { ...structuredAnswer, roles: structuredAnswer.roles.map(role => {
          const original = submission.citations[role.citationIndex];
          if (!original) return { ...role }; // An already invalid index stays invalid after deduplication.
          const citationIndex = indices.get(citationKey(original));
          if (citationIndex === undefined) throw new SafeDiagnosticError("TASK_FAILED");
          return { ...role, citationIndex };
        }) };
      }
      const completedAt = new Date().toISOString(); const attempt: OwnershipAttempt = { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, attemptId: stableId(snapshot.snapshotId, question.id, completedAt), questionId: question.id, questionVersion: question.version, concept: question.concept, questionKind: question.kind, variantKey: question.variantKey, structuredAnswer, citations: grade.validatedCitations, locationScore: grade.location.score, structureScore: grade.structure.score, passed: grade.passed, scoringVersion: OWNERSHIP_SCORING_VERSION, semanticText: submission.answer, completedAt, legacy: false };
      const capsule = await buildOwnershipRubricCapsule({ question, submission, grade, attempt, snapshot, validatedCitations: citations, sources: [...sources.values()], sourceIdentity: {
        activation: source.activation, analysisResultFingerprint: source.analysisIdentity.analysisResult?.fingerprint ?? null,
        configurationHash: source.analysisIdentity.configurationHash, ignorePolicyHash: source.analysisIdentity.ignorePolicy?.hash ?? null,
        sourceManifestHash: source.sourceManifestHash, ignoreRevision: source.ignoreRevision,
      } });
      assertActive();
      settingsStore.assertIgnoreRevision(snapshot.repositoryId, settingsRevision);
      let prepared: Awaited<ReturnType<GraphStore["prepareOwnershipAttemptWithCapsule"]>>;
      try { prepared = await store.prepareOwnershipAttemptWithCapsule({ question, submission, attempt, capsule, source }, settingsStore); }
      catch (error) { assertActive(); settingsStore.assertIgnoreRevision(snapshot.repositoryId, settingsRevision); throw error; }
      assertActive();
      const finalState = await this.getSnapshotState(submission);
      assertActive();
      if (finalState.status !== "current") throw new SafeDiagnosticError("SNAPSHOT_NOT_CURRENT");
      this.assertSnapshotPolicyCurrent(snapshot);
      try { store.savePreparedOwnershipAttempt(prepared); }
      catch (error) {
        // Keep the application configuration diagnostic; never expose native SQL error text.
        if (settingsStore.loadIgnoreSettings(snapshot.repositoryId).revision !== settingsRevision) throw new SafeDiagnosticError("IGNORE_SETTINGS_CONFLICT");
        throw error;
      }
      // Failed attempts remain retryable, while every attempt is still persisted.
      // The server-owned question keeps the deterministic rules out of the renderer.
      if (grade.passed) this.questions.delete(questionKey(question));
      return grade;
    } finally { this.gradingQuestions.delete(key); }
  }

  async getOwnershipProgress(ref: SnapshotRef): Promise<OwnershipProgress> {
    const { snapshot, store } = this.requireSnapshot(ref); const attempts = store.listOwnershipAttempts(snapshot.repositoryId); const candidates = createQuestions(snapshot, { ...ref, count: 20, scope: { kind: "project" } }, attempts); const concepts = new Map(candidates.map((item) => [item.concept.id, item.concept])); for (const item of attempts) concepts.set(item.concept.id, item.concept);
    return { ...ref, attempts, concepts: [...concepts.values()].sort((a,b) => a.label.localeCompare(b.label)).map((concept) => { const all = attempts.filter((item) => item.concept.id === concept.id); const current = all.filter((item) => item.snapshotId === snapshot.snapshotId && item.questionVersion !== "legacy"); const latest = current.at(-1) ?? all.at(-1); const status = current.some((item) => item.passed) ? "passed" as const : current.length ? "review" as const : all.length ? "needs-revalidation" as const : "unpracticed" as const; const variants = new Set(all.filter((item) => item.snapshotId === snapshot.snapshotId).map((item) => item.variantKey)); const variantAvailable = candidates.some((item) => item.concept.id === concept.id && !variants.has(item.variantKey)); return { concept, status, attempts: all.length, ...(latest ? { lastAttemptAt: latest.completedAt, lastQuestionId: latest.questionId } : {}), variantAvailable }; }) };
  }

  async readSource(rawLocation: EvidenceLocation): Promise<SourceFileResult> {
    const observation = this.navigationObservation, location = { ...rawLocation }, request = observation?.capture("readSource", location);
    try {
    const navigation = this.requireNavigation(location, observation ?? undefined, request), store = navigation.store;
    const stored = store.readSnapshotSource(navigation.snapshotId, location.filePath);
    if (!stored) throw new Error("该快照没有保存此源码文件");
    const targetSpan = { filePath: location.filePath, startLine: location.startLine, startColumn: location.startColumn, endLine: location.endLine, endColumn: location.endColumn };
    const selected = location.evidenceId ? navigation.evidenceIndex?.get(location.evidenceId) ?? navigation.evidenceList?.find(candidate => candidate.id === location.evidenceId) : undefined;
    const item = selected ? structuredClone(selected) : undefined;
    if (location.evidenceId && (!item || item.span.filePath !== location.filePath)) throw new Error("证据不属于指定快照或文件");
    const opensEmptyFile = stored.content.length === 0 && item?.kind === "file" && sameSpan(targetSpan, item.span) && targetSpan.startLine === 1 && targetSpan.startColumn === 0 && targetSpan.endLine === 1 && targetSpan.endColumn === 0;
    if (!opensEmptyFile) assertSpanWithinContent(targetSpan, stored.content);
    let workspaceStatus: "current" | "stale" | "missing" | "unavailable" = "current"; let currentHash: string | undefined;
    try {
      const policy = createIgnorePolicy(this.storeForRepository(navigation.repositoryId).loadIgnoreSettings(navigation.repositoryId).rules);
      if (["secret", "ignored"].includes(classifyProjectPath(location.filePath, policy))) workspaceStatus = "unavailable";
      else { currentHash = contentFingerprint(await readProjectFile(navigation.rootPath, location.filePath)); if (currentHash !== stored.contentHash) workspaceStatus = "stale"; }
    }
    catch (error) { workspaceStatus = error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable"; }
    return { repositoryId: navigation.repositoryId, snapshotId: navigation.snapshotId, filePath: location.filePath, language: stored.language, content: stored.content, contentHash: stored.contentHash, workspaceStatus, ...(currentHash ? { currentHash } : {}), targetSpan, ...(item ? { evidence: item } : {}) };
    } finally { if (request) observation?.settle(request); }
  }

  close(): void { this.navigationSlot = null; this.navigationObservation?.dispose(); this.ownershipClosed = true; this.questions.clear(); for (const store of new Set([this.legacyStore, ...this.stores.values()])) store.close(); }

  private async analyzeComparisonSide(base: ProjectSnapshot, side: CapturedSide, policy: IgnorePolicy, ignoreRevision: number, signal?: AbortSignal, progress?: (completed: number, total: number, currentFile: string) => void): Promise<ProjectSnapshot> {
    const sources: IndexedSource[] = side.sources.map((item) => ({ absolutePath: resolve(base.rootPath, item.projectPath), projectPath: item.projectPath, content: item.content, contentHash: item.contentHash, language: item.language }));
    const analyzerVersions = Object.fromEntries(this.analyzers.map((item) => [item.id, item.version])); const analysisIdentity = { graphIrVersion: GRAPH_IR_VERSION, analyzerVersions, configurationHash: configurationFingerprint(side.manifestFingerprint, policy), sourceFingerprint: side.contentFingerprint, ignorePolicy: policy }; const snapshotId = stableId(base.repositoryId, side.contentFingerprint, GRAPH_IR_VERSION, JSON.stringify(analyzerVersions), analysisIdentity.configurationHash);
    const rootNodeId = stableId(base.repositoryId, "repository-root"); const nodes: GraphNode[] = [{ id: rootNodeId, snapshotId, kind: "repository", name: base.name, qualifiedName: base.rootPath, metadata: { sourceType: "git-comparison", comparisonSide: side.kind } }]; const edges: GraphEdge[] = []; const evidence: Evidence[] = []; const failures: ProjectSnapshot["health"]["failedFiles"] = []; const moduleIds = new Map<string, string>(); const typeScriptSources: Array<{ absolutePath: string; content: string }> = []; const pythonSources: Array<{ absolutePath: string; content: string }> = [];
    for (const [index, item] of sources.entries()) { throwIfAborted(signal); progress?.(index, sources.length, item.projectPath); const fileNodeId = stableId(base.repositoryId, "file", item.projectPath); const fileEvidenceId = stableId(snapshotId, item.projectPath, "file"); const span = wholeFileSpan(item.projectPath, item.content); nodes.push({ id: fileNodeId, snapshotId, kind: "file", name: basename(item.projectPath), qualifiedName: item.projectPath, language: item.language, filePath: item.projectPath, span, evidenceId: fileEvidenceId, metadata: { bytes: Buffer.byteLength(item.content), contentHash: item.contentHash, comparisonSide: side.kind } }); evidence.push({ id: fileEvidenceId, snapshotId, analyzer: "git-side-capture", analyzerVersion: CHANGESET_VERSION, kind: "file", confidence: "verified", reason: `源码来自不可变 ${side.kind} 捕获`, span }); const moduleName = moduleNameForPath(item.projectPath); let moduleId = moduleIds.get(moduleName); if (!moduleId) { moduleId = stableId(base.repositoryId, "module", moduleName); moduleIds.set(moduleName, moduleId); nodes.push({ id: moduleId, snapshotId, kind: "module", name: moduleName, qualifiedName: moduleName, metadata: {} }); edges.push({ id: stableId(snapshotId, rootNodeId, moduleId, "CONTAINS"), snapshotId, source: rootNodeId, target: moduleId, kind: "CONTAINS", confidence: "verified", evidenceId: fileEvidenceId, reason: "目录结构定义模块分组" }); } edges.push({ id: stableId(snapshotId, moduleId, fileNodeId, "CONTAINS"), snapshotId, source: moduleId, target: fileNodeId, kind: "CONTAINS", confidence: "verified", evidenceId: fileEvidenceId, reason: "文件位于该目录模块中" }); const analyzer = this.analyzers.find((candidate) => candidate.supports(item.absolutePath)); if (analyzer instanceof TypeScriptAnalyzer) typeScriptSources.push({ absolutePath: item.absolutePath, content: item.content }); else if (analyzer instanceof PythonAnalyzer) pythonSources.push({ absolutePath: item.absolutePath, content: item.content }); }
    const context = { rootPath: base.rootPath, repositoryId: base.repositoryId, snapshotId, ...(signal ? { abortSignal: signal } : {}) }; if (typeScriptSources.length) try { const analyzer = this.analyzers.find((item): item is TypeScriptAnalyzer => item instanceof TypeScriptAnalyzer)!; const result = await analyzer.analyzeProject(typeScriptSources, context, sources.filter((item) => isAnalysisConfig(item.projectPath)).map((item) => ({ absolutePath: item.absolutePath, content: item.content }))); nodes.push(...result.nodes); edges.push(...result.edges); evidence.push(...result.evidence); failures.push(...(result.failures ?? []).map((failure) => failureFromAnalyzerResult(base.rootPath, failure, "ANALYSIS_FAILED"))); } catch (error) { if (isAbort(error)) throw error; failures.push(failureFromError(base.rootPath, "<TypeScript Program>", error, "ANALYSIS_FAILED")); }
    if (pythonSources.length) try { const analyzer = this.analyzers.find((item): item is PythonAnalyzer => item instanceof PythonAnalyzer)!; const result = await analyzer.analyzeProject(pythonSources, context); nodes.push(...result.nodes); edges.push(...result.edges); evidence.push(...result.evidence); failures.push(...(result.failures ?? []).map((failure) => failureFromAnalyzerResult(base.rootPath, failure, "PYTHON_ANALYSIS_FAILED"))); } catch (error) { if (isAbort(error)) throw error; failures.push(failureFromError(base.rootPath, "<Python Project>", error, "PYTHON_ANALYSIS_FAILED")); }
    const known = new Set(nodes.map((node) => node.id)); for (const edge of edges) if (!known.has(edge.target) && edge.unresolvedTarget) { const kind = edge.kind === "CALLS" ? "unresolved-call" as const : edge.kind === "IMPORTS" && edge.unresolvedTarget.startsWith(".") ? "module" as const : "external-dependency" as const; nodes.push({ id: edge.target, snapshotId, kind, name: edge.unresolvedTarget, qualifiedName: edge.unresolvedTarget, metadata: { unresolved: true, referenceKind: kind === "module" ? "unresolved-module" : kind } }); known.add(edge.target); }
    const languageCounts = sources.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.language]: (counts[item.language] ?? 0) + 1 }), {}); const excludedCount = side.unsupported.length + side.ignored.length + side.secrets.length + side.binary.length + side.oversized.length + side.submodules.length; const snapshot: ProjectSnapshot = { repositoryId: base.repositoryId, snapshotId, name: base.name, rootPath: base.rootPath, sourceType: "git", ...(side.revision ? { gitHead: side.revision } : {}), createdAt: new Date().toISOString(), analysisIdentity, sourceFiles: sources.map((item) => ({ filePath: item.projectPath, contentHash: item.contentHash, bytes: Buffer.byteLength(item.content), language: item.language })), nodes: [...new Map(nodes.map((node) => [node.id, node])).values()], edges: [...new Map(edges.map((edge) => [edge.id, edge])).values()], evidence: [...new Map(evidence.map((item) => [item.id, item])).values()], health: { status: failures.length || excludedCount ? "partial" : "ready", totalFiles: sources.length + excludedCount, indexedFiles: sources.length, skippedFiles: side.ignored.length + side.secrets.length + side.oversized.length, unsupportedFiles: side.unsupported.length + side.binary.length + side.submodules.length, ignoredByRule: [...DEFAULT_IGNORE, ...policy.rules], failedFiles: failures, languageCounts, limitations: ["比较侧完整分析全部允许的受支持源码，不执行仓库代码", ...side.submodules.map((path) => `子模块只保留元数据：${path}`)] } }; const store = this.storeForRepository(base.repositoryId); const published = store.saveSnapshot(finalizeAnalysisSnapshot(snapshot), sources.map((item) => ({ filePath: item.projectPath, contentHash: item.contentHash, language: item.language, content: item.content })), false, ignoreRevision); this.snapshotStores.set(published.snapshotId, store); return published;
  }

  private async requireCurrentSnapshot(ref: SnapshotRef): Promise<ProjectSnapshot> {
    const snapshot = this.requireSnapshot(ref).snapshot; const state = await this.getSnapshotState(ref);
    if (state.status !== "current") throw new SafeDiagnosticError("SNAPSHOT_NOT_CURRENT"); this.assertSnapshotPolicyCurrent(snapshot); return snapshot;
  }

  private assertSnapshotPolicyCurrent(snapshot: ProjectSnapshot): void {
    const policy = createIgnorePolicy(this.storeForRepository(snapshot.repositoryId).loadIgnoreSettings(snapshot.repositoryId).rules);
    if (snapshot.analysisIdentity.ignorePolicy ? snapshot.analysisIdentity.ignorePolicy.hash !== policy.hash : policy.rules.length > 0) throw new SafeDiagnosticError("SNAPSHOT_NOT_CURRENT");
  }

  private requireStore(ref: SnapshotRef): GraphStore {
    const known = this.snapshotStores.get(ref.snapshotId); if (known?.getOverview(ref.snapshotId)?.repositoryId === ref.repositoryId) return known;
    if (this.projectDatabaseRoot && !this.stores.has(ref.repositoryId)) { const databasePath = join(this.projectDatabaseRoot, `${ref.repositoryId}.sqlite`); if (existsSync(databasePath)) this.stores.set(ref.repositoryId, new GraphStore(databasePath, "project")); }
    for (const store of [this.stores.get(ref.repositoryId), this.legacyStore]) { if (store?.getOverview(ref.snapshotId)?.repositoryId === ref.repositoryId) { this.snapshotStores.set(ref.snapshotId, store); return store; } }
    throw new Error("项目或快照不存在");
  }
}

function comparisonSide(side: CapturedSide, snapshot: ProjectSnapshot): ComparisonSide { const exclusions = { ignored: exclusion(side.ignored), secrets: exclusion(side.secrets), unsupported: exclusion(side.unsupported), binary: exclusion(side.binary), oversized: exclusion(side.oversized), submodules: exclusion(side.submodules) }; const exclusionCount = Object.values(exclusions).reduce((sum, item) => sum + item.count, 0); const failures = snapshot.health.failedFiles.map((item) => ({ filePath: safeProjectRelativeFile(snapshot.rootPath, item.filePath), ...safeDiagnostic(item.code, item.detailCode) })); return { label: side.label, kind: side.kind, ...(side.revision ? { revision: side.revision } : {}), ...(side.parentNumber ? { parentNumber: side.parentNumber } : {}), contentFingerprint: side.contentFingerprint, manifestFingerprint: side.manifestFingerprint, capturedAt: side.capturedAt, snapshot: { repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId }, analysisIdentity: snapshot.analysisIdentity, completeness: { status: failures.length || exclusionCount ? "partial" : "complete", indexedFiles: snapshot.health.indexedFiles, failures, exclusions, limitations: [...snapshot.health.limitations, ...(exclusionCount ? ["排除项不参与语义分析；其内容变化不会被描述为已分析"] : [])] } }; }
function exclusion(paths: string[]): { count: number; paths: string[] } { return { count: paths.length, paths: [...paths].sort() }; }
export function classifyChangePath(path: string, binary: boolean): Pick<ChangeFile, "classification" | "classificationReason" | "classificationConfidence"> {
  const lower = path.toLocaleLowerCase(); if (binary) return { classification: "binary", classificationReason: "内容含 NUL 或 Git 报告二进制补丁", classificationConfidence: "verified" };
  if (/(^|\/)(node_modules|vendor|third_party)(\/|$)/.test(lower)) return { classification: "third-party", classificationReason: "路径位于常见供应商目录；不等于已证明来源", classificationConfidence: "inferred" };
  if (/(^|\/)(dist|build|generated)(\/|$)|\.generated\./.test(lower)) return { classification: "generated", classificationReason: "路径符合常见生成物规则；未执行生成器核验", classificationConfidence: "inferred" };
  if (/(^|\/)(migrations?|alembic)(\/|$)|\d+[_-].*\.(sql|py|ts)$/.test(lower)) return { classification: "migration", classificationReason: "路径符合数据库迁移约定", classificationConfidence: "inferred" };
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|uv\.lock)$/.test(lower)) return { classification: "lockfile", classificationReason: "已知锁文件名称", classificationConfidence: "verified" };
  if (isAnalysisConfig(path)) return { classification: "config", classificationReason: "属于当前支持的分析配置/清单", classificationConfidence: "verified" };
  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py"].includes(extname(lower))) return { classification: "source", classificationReason: "属于 V1 一等支持的源码扩展名", classificationConfidence: "verified" };
  return { classification: "unsupported", classificationReason: "当前语言适配器不支持该内容", classificationConfidence: "verified" };
}
function mapDirectChanges(changeId: string, status: ChangeFile["status"], hunks: ChangeFile["hunks"], oldPath: string | undefined, newPath: string | undefined, left: ProjectSnapshot, right: ProjectSnapshot): DirectChange[] {
  const results: DirectChange[] = []; const seen = new Set<string>(); const add = (side: "left" | "right", snapshot: ProjectSnapshot, filePath: string | undefined, start: number, lines: number, hunkId: string): void => { if (!filePath || lines <= 0) return; const span = { filePath, startLine: Math.max(1, start), startColumn: 0, endLine: Math.max(1, start + lines), endColumn: 0 }; const candidates = snapshot.nodes.filter((node) => node.filePath === filePath && node.span && spansOverlap(span, node.span)).sort((a, b) => spanSize(a.span!) - spanSize(b.span!) || a.id.localeCompare(b.id)); if (!candidates.length) { const file = snapshot.nodes.find((node) => node.kind === "file" && node.filePath === filePath); const key = `${side}:${file?.id ?? filePath}:file`; if (!seen.has(key)) { seen.add(key); results.push({ id: stableId(changeId, hunkId, side, file?.id ?? filePath), side, match: file ? "file" : "unmatched", ...(file ? { nodeId: file.id, span: file.span } : {}), reason: file ? "变化范围未命中更小符号，保留文件级变化" : "该侧没有可分析源码节点" }); } return; } candidates.forEach((node, index) => { const key = `${side}:${node.id}`; if (seen.has(key)) return; seen.add(key); results.push({ id: stableId(changeId, hunkId, side, node.id), side, match: index === 0 ? "minimal" : "containing", nodeId: node.id, ...(node.span ? { span: node.span } : {}), reason: index === 0 ? "最小直接包含变化范围的符号" : "包含直接变化的外围符号" }); }); };
  for (const hunk of hunks) { add("left", left, oldPath, hunk.oldStart, hunk.oldLines, hunk.id); add("right", right, newPath, hunk.newStart, hunk.newLines, hunk.id); }
  if (!hunks.length) { const fileOnly = (side: "left" | "right", snapshot: ProjectSnapshot, filePath: string | undefined): void => { if (!filePath) return; const file = snapshot.nodes.find((node) => node.kind === "file" && node.filePath === filePath); results.push({ id: stableId(changeId, "file", side, file?.id ?? filePath), side, match: file ? "file" : "unmatched", ...(file ? { nodeId: file.id, span: file.span } : {}), reason: status === "renamed" || status === "copied" ? "仅路径发生变化；未把内容标记为语义变化" : file ? "文件级变化没有文本 hunk" : "该侧没有可分析源码节点" }); }; fileOnly("left", left, oldPath); fileOnly("right", right, newPath); }
  return results;
}
function spanSize(span: Evidence["span"]): number { return (span.endLine - span.startLine) * 1_000_000 + span.endColumn - span.startColumn; }
function impactPathsForDirect(changeId: string, direct: DirectChange, snapshot: ProjectSnapshot, store: GraphStore, maxDepth: number, maxPaths: number, maxWork: number): { items: ImpactPath[]; usedWork: number; truncated: boolean; reason: string } {
  const start = snapshot.nodes.find((node) => node.id === direct.nodeId); if (!start) return { items: [], usedWork: 0, truncated: false, reason: "" }; const view = start.kind === "file" ? "dependency" as const : "call" as const;
  const result = store.queryGraph({ version: GRAPH_QUERY_VERSION, repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId, rootNodeIds: [start.id], view, direction: "incoming", maxDepth, maxNodes: Math.min(1000, Math.max(20, maxPaths * maxDepth + 1)), maxEdges: Math.min(2000, Math.max(40, maxPaths * maxDepth * 2)), maxWork, confidences: ["verified", "inferred", "unknown"] }); const nodes = new Map(result.nodes.map((node) => [node.id, node])); const incoming = new Map<string, GraphEdge[]>(); for (const edge of result.edges) { const list = incoming.get(edge.target) ?? []; list.push(edge); incoming.set(edge.target, list); } for (const list of incoming.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  type PendingPath = { id: string; nodeIds: string[]; edges: GraphEdge[] };
  const toImpactPath = (current: PendingPath, cycleBoundary = false): ImpactPath => { const pathNodes = current.nodeIds.map((id) => nodes.get(id)).filter((item): item is GraphNode => Boolean(item)); const evidence = [...new Set(current.edges.map((edge) => edge.evidenceId))].map((id) => store.getEvidence(snapshot.snapshotId, id)).filter((item): item is Evidence => Boolean(item)); const confidence = current.edges.some((edge) => edge.confidence === "unknown") ? "unknown" : current.edges.some((edge) => edge.confidence === "inferred") ? "inferred" : "verified"; return { id: stableId(changeId, direct.side, start.id, current.id, current.edges.map((edge) => edge.id).join("/")), changeId, side: direct.side, startNodeId: start.id, endpointNodeId: current.id, nodes: pathNodes, edges: current.edges, evidence, confidence, limitations: ["边保持源码中的实际方向；列表从变化点向潜在调用者/入口展示", "静态反向可达只表示可能影响", ...(cycleBoundary ? ["路径在已访问循环边界终止；没有伪造循环外入口"] : [])], truncated: result.truncated || current.edges.length >= maxDepth || cycleBoundary, budget: { maxDepth, maxPaths, maxWork, usedWork: result.stats.scannedEdges } }; };
  const queue: PendingPath[] = [{ id: start.id, nodeIds: [start.id], edges: [] }]; const items: ImpactPath[] = []; const visited = new Set<string>([start.id]); let cursor = 0; for (; cursor < queue.length && items.length < maxPaths; cursor += 1) { const current = queue[cursor]!; const nextEdges = incoming.get(current.id) ?? []; const node = nodes.get(current.id); const terminal = current.id !== start.id && (node?.kind === "endpoint" || nextEdges.length === 0 || current.edges.length >= maxDepth); if (terminal) items.push(toImpactPath(current));
    if (current.edges.length >= maxDepth) continue; for (const edge of nextEdges) { const caller = edge.source; if (visited.has(caller)) continue; visited.add(caller); queue.push({ id: caller, nodeIds: [...current.nodeIds, caller], edges: [...current.edges, edge] }); } }
  if (!items.length && queue.length > 1) items.push(toImpactPath(queue[queue.length - 1]!, true));
  const cycleBoundary = items.some((item) => item.limitations.some((value) => value.includes("循环边界"))); const pathLimitReached = items.length >= maxPaths && cursor < queue.length;
  return { items, usedWork: result.stats.scannedEdges, truncated: result.truncated || pathLimitReached || cycleBoundary, reason: result.truncated ? `图查询截断：${result.truncationReasons.join("/")}` : pathLimitReached ? "路径数量预算" : cycleBoundary ? "循环边界" : "" };
}

function questionKey(value: { repositoryId: string; snapshotId: string; id?: string; questionId?: string }): string { return `${value.repositoryId}:${value.snapshotId}:${value.id ?? value.questionId ?? ""}`; }
function failureFromError(rootPath: string, filePath: string, error: unknown, fallback: SafeDiagnosticCode): ProjectSnapshot["health"]["failedFiles"][number] {
  return { filePath: safeProjectRelativeFile(rootPath, filePath), ...diagnosticForError(error, fallback) };
}
function failureWithCode(rootPath: string, filePath: string, code: unknown, detailCode: unknown, fallback: SafeDiagnosticCode): ProjectSnapshot["health"]["failedFiles"][number] {
  const parsedCode = safeDiagnosticCodeSchema.safeParse(code);
  return { filePath: safeProjectRelativeFile(rootPath, filePath), ...safeDiagnostic(parsedCode.success ? parsedCode.data : fallback, detailCode) };
}
function failureFromAnalyzerResult(rootPath: string, failure: { filePath: string; code?: unknown; detailCode?: unknown }, fallback: SafeDiagnosticCode): ProjectSnapshot["health"]["failedFiles"][number] {
  return failureWithCode(rootPath, failure.filePath, failure.code, failure.detailCode, fallback);
}
function safeProjectRelativeFile(rootPath: string, filePath: unknown): string {
  if (typeof filePath !== "string") return "<分析器>";
  if (["<TypeScript Program>", "<Python Project>", "<分析器>", "<项目>"].includes(filePath)) return filePath;
  const normalized = filePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("\0") || normalized.split("/").some((part) => part === ".." || part === "")) return "<分析器>";
  const relativePath = normalizeProjectPath(rootPath, resolve(rootPath, normalized));
  if (!relativePath || relativePath === "." || relativePath === ".." || relativePath.startsWith("../") || /^[A-Za-z]:/.test(relativePath)) return "<分析器>";
  return relativePath;
}
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function comparePosition(aLine: number, aColumn: number, bLine: number, bColumn: number): number { return aLine - bLine || aColumn - bColumn; }
function sameSpan(left: SourceCitation, right: SourceCitation): boolean { return left.filePath === right.filePath && left.startLine === right.startLine && left.startColumn === right.startColumn && left.endLine === right.endLine && left.endColumn === right.endColumn; }
function wholeFileSpan(filePath: string, content: string): SourceCitation { const lines = content.split(/\r?\n/); return { filePath, startLine: 1, startColumn: 0, endLine: lines.length, endColumn: lines.at(-1)?.length ?? 0 }; }
function spansOverlap(a: SourceCitation, b: SourceCitation): boolean { if (a.filePath !== b.filePath) return false; return comparePosition(a.startLine, a.startColumn, b.endLine, b.endColumn) < 0 && comparePosition(b.startLine, b.startColumn, a.endLine, a.endColumn) < 0; }
function assertSpanWithinContent(span: SourceCitation, content: string): void { const lines = content.split(/\r?\n/); if (span.startLine > lines.length || span.endLine > lines.length || comparePosition(span.startLine, span.startColumn, span.endLine, span.endColumn) >= 0) throw new Error("源码引用范围无效或超出文件边界"); const startLength = lines[span.startLine - 1]?.length ?? 0; const endLength = lines[span.endLine - 1]?.length ?? 0; if (span.startColumn > startLength || span.endColumn > endLength) throw new Error("源码引用列超出文件边界"); }
function validateCitations(snapshot: ProjectSnapshot, citations: SourceCitation[], readContent: (filePath: string) => string | undefined): SourceCitation[] {
  const sourcePaths = new Set(snapshot.sourceFiles.map((item) => item.filePath)); const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item])); const unique = new Map<string, SourceCitation>();
  for (const citation of citations) {
    if (!sourcePaths.has(citation.filePath)) throw new Error("引用文件不属于题目快照");
    const content = readContent(citation.filePath); if (content === undefined) throw new Error("题目快照缺少引用源码"); assertSpanWithinContent(citation, content);
    if (!citation.evidenceId) throw new Error("引用必须关联当前快照中的证据");
    const evidence = evidenceById.get(citation.evidenceId); if (!evidence || evidence.snapshotId !== snapshot.snapshotId || !spansOverlap(citation, evidence.span)) throw new Error("引用证据伪造、过期或与选择范围不相交");
    const key = `${citation.filePath}:${citation.startLine}:${citation.startColumn}:${citation.endLine}:${citation.endColumn}:${citation.evidenceId}`; unique.set(key, citation);
  }
  return [...unique.values()];
}

async function discoverAndRead(rootPath: string, signal?: AbortSignal, onRead?: (completed: number, total: number, currentFile: string) => void, existingScope?: SecureReadScope, testHooks?: SecureReadTestHooks, policy?: IgnorePolicy): Promise<{ discovery: Awaited<ReturnType<typeof discoverProject>>; sources: IndexedSource[] }> {
  const scope = existingScope ?? await createSecureReadScope(rootPath);
  const effectiveRoot = scope.rootPath;
  try {
    let discovery: Awaited<ReturnType<typeof discoverProject>>;
    try { discovery = await discoverProject(effectiveRoot, signal, undefined, policy); }
    catch (error) { if (isAbort(error)) throw error; throw new SafeDiagnosticError(diagnosticForError(error, "FILE_DISCOVERY_FAILED").code); }
    const sources: IndexedSource[] = [];
    for (const [index, absolutePath] of discovery.files.entries()) { throwIfAborted(signal); const projectPath = normalizeProjectPath(effectiveRoot, absolutePath); try { const content = await readSecureProjectFile(scope, absolutePath, { ...(signal ? { signal } : {}), ...(testHooks ? { testHooks } : {}) }); sources.push({ absolutePath, projectPath, content, contentHash: contentFingerprint(content), language: languageFromPath(projectPath) }); } catch (error) { if (isProjectPathSecurityError(error)) throw error; discovery.failures.push({ filePath: projectPath, ...diagnosticForError(error, "FILE_READ_FAILED") }); } onRead?.(index + 1, discovery.files.length, projectPath); }
    return { discovery, sources };
  } finally { if (!existingScope) scope.close(); }
}
function compareSourceMaps(expected: Map<string, string>, actual: Map<string, string>): { added: string[]; removed: string[]; changed: string[] } { const added = [...actual.keys()].filter((path) => !expected.has(path)).sort(); const removed = [...expected.keys()].filter((path) => !actual.has(path)).sort(); const changed = [...expected.keys()].filter((path) => actual.has(path) && actual.get(path) !== expected.get(path)).sort(); return { added, removed, changed }; }
function evidenceForNode(snapshot: ProjectSnapshot, nodeId: string): string[] { return [...new Set(snapshot.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.evidenceId))]; }
function firstCallPath(root: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): Array<{ node: GraphNode; edge?: GraphEdge }> { const nodeById = new Map(nodes.map((node) => [node.id, node])); const parent = new Map<string, { from: string; edge: GraphEdge }>(); const queue = [root.id]; let furthest = root.id; for (let cursor = 0; cursor < queue.length; cursor += 1) { const id = queue[cursor]!; const outgoing = edges.filter((edge) => edge.source === id && (edge.kind === "HANDLES" || edge.kind === "CALLS")).sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence) || flowEdgePriority(a.kind) - flowEdgePriority(b.kind) || a.id.localeCompare(b.id)); for (const edge of outgoing) { if (parent.has(edge.target) || edge.target === root.id || !nodeById.has(edge.target)) continue; parent.set(edge.target, { from: id, edge }); queue.push(edge.target); furthest = edge.target; } } const reversed: Array<{ node: GraphNode; edge?: GraphEdge }> = []; let current = furthest; while (current !== root.id) { const link = parent.get(current); const node = nodeById.get(current); if (!link || !node) break; reversed.push({ node, edge: link.edge }); current = link.from; } return [{ node: root }, ...reversed.reverse()]; }
function confidenceRank(value: GraphEdge["confidence"]): number { return value === "verified" ? 0 : value === "inferred" ? 1 : 2; }
function expandFeatureQuery(query: string): string { const vocabulary: Array<[RegExp, string]> = [[/登录|登陆/giu, " login signin auth authenticate"], [/注册/giu, " register signup account"], [/用户/giu, " user profile account"], [/保存|写入/giu, " save write persist update"], [/删除/giu, " delete remove destroy"], [/上传/giu, " upload file attachment"], [/支付/giu, " pay payment checkout order"]]; return vocabulary.reduce((expanded, [pattern, terms]) => pattern.test(query) ? `${expanded}${terms}` : expanded, query); }
function flowEdgePriority(kind: GraphEdge["kind"]): number { return ({ HANDLES: 0, CALLS: 1, PASSES_TO: 2, READS: 3, WRITES: 3, RETURNS: 4 } as Partial<Record<GraphEdge["kind"], number>>)[kind] ?? 9; }
function flowEdgeLabel(kind: GraphEdge["kind"]): string { return ({ HANDLES: "进入处理函数", CALLS: "继续调用", PASSES_TO: "传递参数", READS: "读取数据", WRITES: "修改数据", RETURNS: "返回数据" } as Partial<Record<GraphEdge["kind"], string>>)[kind] ?? kind; }
