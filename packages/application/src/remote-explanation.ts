import { randomUUID } from "node:crypto";
import { admitRemoteProducer, assertRemoteProducerContext, stopRemoteProducer, trackRemoteProducer, type RemoteProducerPort } from "./remote-recovery-capability.js";
import {
  canonicalJson, EXPLANATION_TASK_PROTOCOL_VERSION, GRAPH_QUERY_VERSION, REMOTE_DATA_CATEGORIES, REMOTE_LIMITS,
  RemoteExplanationError, remoteCancelRequestSchema, remoteCapturedIdentitySchema, remoteHashSchema, remoteKeySchema,
  remoteFailureCodeSchema, remoteRevisionSchema,
  remotePrepareRequestSchema, remotePreviewSchema, remoteResultSchema, remoteStartRequestSchema, remoteUuidSchema, remoteTaskRecordSchema,
  type RemoteActivation, type RemoteCapturedIdentity, type RemoteContext, type RemoteFailureCode, type RemotePrepareRequest,
  type RemotePreview, type RemoteProviderSettings, type RemoteResult, type RemoteStartRequest, type RemoteTaskRecord, type SnapshotRef,
} from "@project-xray/contracts";
import { GraphStore, remoteStoreFailure } from "@project-xray/graph";
import { buildEvidencePackage, validateRemoteNarrative, type PreparedEvidencePackage } from "@project-xray/llm";

export interface RemoteCredentialPort {
  // The desktop worker supplies this OS-backed port. No environment or default credential reader.
  read(): Promise<{ credential: string; revision: number }>;
}
export interface RemoteProviderPort {
  /** Digest of the actual complete request body, computed without sending it. */
  bodyDigest(prepared: PreparedEvidencePackage, settings: RemoteProviderSettings): string;
  /** Synchronously initiates exactly one request, returning a Promise of raw narrative. */
  dispatch(input: { prepared: PreparedEvidencePackage; settings: RemoteProviderSettings; bodyDigest: string; credential: string; signal: AbortSignal; taskDeadline: number }): Promise<unknown>;
}
export interface RemoteApplicationPorts {
  authority: GraphStore;
  stores(ref: SnapshotRef): { settings: GraphStore; source: GraphStore };
  currentReference(): { repositoryId: string; snapshotId: string; activation: string } | null;
  checkWorkspace(ref: SnapshotRef, signal: AbortSignal): Promise<{ status: string; checkedAt: string; validationLimitations: string[] }>;
  provider?: RemoteProviderPort;
  credentials?: RemoteCredentialPort;
  onTask?: (task: RemoteTaskRecord) => void;
  now?: () => number;
}
interface CachedPreview { public: RemotePreview; identity: RemoteCapturedIdentity; prepared: PreparedEvidencePackage }
type FeatureReservation = ReturnType<GraphStore["remote"]["reserveDispatch"]>;
interface Running { identity: RemoteCapturedIdentity; controller: AbortController; createdAt: string; reservation?: FeatureReservation; dispatchAttempted?: boolean }
const clone = <T>(value: T): T => structuredClone(value);
function containsCredential(value: unknown, credential: string): boolean {
  if (typeof value === "string") return value.includes(credential);
  if (Array.isArray(value)) return value.some(item => containsCredential(item, credential));
  return value !== null && typeof value === "object" && Object.values(value).some(item => containsCredential(item, credential));
}
const safeFailure = (error: unknown): RemoteExplanationError => {
  try { if (error instanceof RemoteExplanationError && remoteFailureCodeSchema.safeParse(error.code).success) return new RemoteExplanationError(error.code); }
  catch { /* Hostile exceptions cannot escape as strings or logs. */ }
  return new RemoteExplanationError("PROVIDER_FAILED");
};

/** Not an IPC or sender authority. Main must own and validate the adapters calling trusted commands. */
export class RemoteExplanationApplication {
  private readonly previews = new Map<string, CachedPreview>();
  private readonly running = new Map<string, Running>();
  private readonly preparations = new Map<string, AbortController>();
  private readonly blockedOwners = new Set<string>();
  private readonly now: () => number;
  constructor(private readonly ports: RemoteApplicationPorts, private readonly producer?: RemoteProducerPort) {
    if (ports.authority.remote.role !== "global") throw new RemoteExplanationError("POLICY_INVALID");
    this.now = ports.now ?? (() => performance.now());
  }
  private write<T>(work: () => T): T { return this.producer ? admitRemoteProducer(this.producer, work) : work(); }
  closeProducer(): void { if (!this.producer) return; this.previews.clear(); for (const controller of this.preparations.values()) controller.abort(); this.abort(() => true); }
  private active(reference: RemoteActivation): void {
    const current = this.ports.currentReference();
    if (!current || current.repositoryId !== reference.repositoryId || current.snapshotId !== reference.snapshotId || current.activation !== reference.activation) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
  }
  private capture(request: RemotePrepareRequest, taskId: string): RemoteCapturedIdentity {
    const { authority } = this.ports; const context = authority.remote.context(request.contextHandle);
    if (this.blockedOwners.has(context.ownerSessionId)) throw new RemoteExplanationError("CONTEXT_CHANGED");
    const { settings, source } = this.ports.stores(request);
    return authority.remote.immediate(() => settings.remote.immediate(() => source.remote.immediate(() => {
      const fresh = authority.remote.context(request.contextHandle);
      const reference = source.remote.activation(request.repositoryId, request.snapshotId); this.active(reference);
      if (canonicalJson(reference) !== canonicalJson(fresh.reference)) throw new RemoteExplanationError("CONTEXT_CHANGED");
      const provider = authority.remote.provider(); const authorization = authority.remote.authorization(request.repositoryId);
      const identity = remoteCapturedIdentitySchema.parse({
        protocolVersion: EXPLANATION_TASK_PROTOCOL_VERSION, taskId, repositoryId: request.repositoryId, snapshotId: request.snapshotId,
        analysisResultFingerprint: reference.analysisResultFingerprint, configurationHash: reference.configurationHash, ignorePolicyHash: reference.ignorePolicyHash,
        sourceManifestHash: reference.sourceManifestHash, activation: reference.activation, ignoreRevision: settings.loadIgnoreSettings(request.repositoryId).revision,
        authorizationRevision: authorization.revision, providerRevision: provider.revision, credentialRevision: provider.credentialRevision,
        contextEpoch: fresh.epoch, ownerSessionId: context.ownerSessionId, contextHandle: fresh.contextHandle,
        packageId: "0".repeat(64), bodyDigest: "0".repeat(64), limitsVersion: "1.0.0",
      });
      return identity;
    })));
  }
  private gate<T>(identity: RemoteCapturedIdentity, work: (stores: { settings: GraphStore; source: GraphStore }) => T): T {
    if (this.blockedOwners.has(identity.ownerSessionId)) throw new RemoteExplanationError("CONTEXT_CHANGED");
    const { settings, source } = this.ports.stores(identity);
    return this.write(() => this.ports.authority.withExplanationRevisions(identity, settings, source, () => {
      this.active(source.remote.activation(identity.repositoryId, identity.snapshotId)); return work({ settings, source });
    }));
  }
  private build(request: RemotePrepareRequest, limitations: string[], lockedSource?: GraphStore): PreparedEvidencePackage {
    const source = lockedSource ?? this.ports.stores(request).source;
    const metadata = source.remoteSnapshotMetadata(request.repositoryId, request.snapshotId);
    if (metadata.health.status !== "ready" && metadata.health.status !== "partial") throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
    const seeds = source.search({ repositoryId: request.repositoryId, snapshotId: request.snapshotId, query: request.query, kinds: ["function", "method", "class", "endpoint", "file"], limit: 12 });
    if (!seeds.items.length) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
    // Keep the deterministic SQL search priority (functions before whole files), preferring endpoints.
    const root = [...seeds.items].sort((a, b) => Number(b.kind === "endpoint") - Number(a.kind === "endpoint"))[0]!;
    const bounded = source.queryGraph({ version: GRAPH_QUERY_VERSION, repositoryId: request.repositoryId, snapshotId: request.snapshotId, rootNodeIds: [root.id], view: "call", direction: "outgoing", maxDepth: 6, maxNodes: 80, maxEdges: 160, maxWork: 1200, confidences: ["verified", "inferred", "unknown"] });
    // Retain every endpoint in this bounded query, including file and unresolved nodes.
    const nodeIds = new Set(bounded.nodes.map(item => item.id));
    if (bounded.edges.some(edge => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
    // <=160 edge proofs + <=2 supporting proofs per <=80 nodes stays inside the 320 input cap.
    const nodeProofCandidates = bounded.nodes.map(node => ({ node, proofs: source.remoteNodeEvidence(request.snapshotId, node) }));
    const evidence = [...new Map([...bounded.evidence, ...nodeProofCandidates.flatMap(item => item.proofs.slice(0, 2))].map(item => [item.id, item])).values()];
    if (evidence.length > 320) throw new RemoteExplanationError("LIMIT_EXCEEDED");
    const paths = [...new Set(evidence.map(item => item.span.filePath))].sort();
    const manifest = source.remoteSourceManifest(request.snapshotId, paths);
    const unknowns = bounded.unresolved.map(item => `无法确认边 ${item.edgeId}：${item.reason}`);
    const localLimitations = [...metadata.health.limitations, ...limitations,
      ...nodeProofCandidates.filter(item => item.proofs.length > 2).map(item => `节点 ${item.node.id} 的同范围证据最多读取8项；已读 ${item.proofs.length} 项，选取前2项，其余未加入候选包。`),
      "检索候选及有界静态关系不证明真实运行时路径；范围外可能有其他分支。",
      "取消或撤销只能停止本地处理，不能保证收回已外发数据、停止服务商计算或退款。",
      ...(metadata.health.status === "partial" ? [`索引为 partial，失败文件数量：${metadata.health.failedFiles.length}。`] : []),
      ...(bounded.truncated ? [`查询截断：${bounded.truncationReasons.join("、")}；扫描 ${bounded.stats.scannedEdges} 条关系，返回 ${bounded.nodes.length} 节点、${bounded.edges.length} 边。`] : []),
      ...(seeds.total > seeds.items.length ? [`候选检索只读取 ${seeds.items.length}/${seeds.total} 项。`] : []),
    ];
    return buildEvidencePackage({ repositoryId: request.repositoryId, snapshotId: request.snapshotId, query: request.query,
      analysisIdentity: metadata.analysisIdentity, nodes: bounded.nodes, edges: bounded.edges, evidence, sourceManifest: manifest,
      unknowns, limitations: localLimitations, health: { status: metadata.health.status, failedCount: metadata.health.failedFiles.length,
        failures: metadata.health.failedFiles.map(item => ({ filePath: item.filePath, code: "analysis-failed" as const })) },
    }, { readSource: filePath => { const item = source.readSnapshotSource(request.snapshotId, filePath); return item ? { ...item, repositoryId: request.repositoryId, snapshotId: request.snapshotId, filePath } : undefined; } });
  }
  private asyncWork<T>(work: () => Promise<T>): Promise<T> { return this.producer ? trackRemoteProducer(this.producer, work) : work(); }
  private async workspace(ref: SnapshotRef, controller: AbortController, deadline: number): Promise<{ checkedAt: string; validationLimitations: string[] }> {
    this.checkpoint(controller, deadline);
    const result = await this.bounded(this.asyncWork(() => this.ports.checkWorkspace(ref, controller.signal)), controller, deadline);
    this.checkpoint(controller, deadline);
    if (result.status !== "current") throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
    return result;
  }
  private checkpoint(controller: AbortController, deadline: number): void {
    if (this.now() >= deadline) throw new RemoteExplanationError("TIMEOUT");
    if (controller.signal.aborted) throw new RemoteExplanationError("CANCELLED");
  }
  private async bounded<T>(promise: Promise<T>, controller: AbortController, deadline: number): Promise<T> {
    const observed = Promise.resolve(promise); void observed.catch(() => undefined);
    this.checkpoint(controller, deadline);
    let listener: (() => void) | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      listener = () => reject(new RemoteExplanationError(this.now() >= deadline ? "TIMEOUT" : "CANCELLED"));
      controller.signal.addEventListener("abort", listener, { once: true });
      timer = setTimeout(() => { controller.abort(); reject(new RemoteExplanationError("TIMEOUT")); }, Math.max(1, deadline - this.now()));
    });
    try { return await Promise.race([observed, stopped]); }
    finally { if (timer) clearTimeout(timer); if (listener) controller.signal.removeEventListener("abort", listener); }
  }
  async prepare(raw: RemotePrepareRequest): Promise<RemotePreview> {
    let owner: string | undefined; const controller = new AbortController();
    try {
      const request = remotePrepareRequestSchema.parse(raw); const deadline = this.now() + REMOTE_LIMITS.taskMs;
      const identity = this.capture(request, randomUUID()); owner = identity.ownerSessionId;
      this.preparations.get(owner)?.abort(); this.preparations.set(owner, controller); this.previews.delete(owner);
      const checked = await this.workspace(request, controller, deadline);
      const prepared = this.build(request, checked.validationLimitations); this.checkpoint(controller, deadline);
      identity.packageId = prepared.evidencePackage.packageId;
      const preview = this.gate(identity, () => {
        const provider = this.ports.authority.remote.provider(); const authorization = this.ports.authority.remote.authorization(request.repositoryId);
        const bodyDigest = this.ports.provider ? remoteHashSchema.parse(this.ports.provider.bodyDigest(clone(prepared), clone(provider))) : null;
        const createdAt = new Date().toISOString();
        return remotePreviewSchema.parse({ protocolVersion: EXPLANATION_TASK_PROTOCOL_VERSION, previewId: randomUUID(), contextHandle: request.contextHandle,
          createdAt, expiresAt: new Date(Date.parse(createdAt) + 300000).toISOString(), packageId: prepared.evidencePackage.packageId, bodyDigest,
          evidencePackage: prepared.evidencePackage, provider, authorization, categories: [...REMOTE_DATA_CATEGORIES],
          localUnknowns: prepared.localUnknowns, localLimitations: prepared.localLimitations,
          sourceBytes: prepared.evidencePackage.proofs.reduce((count, item) => count + Buffer.byteLength(item.snippet), 0), maxRequestBytes: 65536, maxOutputTokens: provider.outputTokens });
      });
      identity.bodyDigest = preview.bodyDigest ?? "0".repeat(64);
      this.previews.set(identity.ownerSessionId, { public: clone(preview), identity, prepared: clone(prepared) }); return clone(preview);
    } catch (error) { throw remoteStoreFailure(error); }
    finally { if (owner && this.preparations.get(owner) === controller) this.preparations.delete(owner); controller.abort(); }
  }

  async start(raw: RemoteStartRequest): Promise<RemoteTaskRecord> {
    let identity: RemoteCapturedIdentity | undefined; let registered = false;
    let reservation: FeatureReservation | undefined; let dispatchAttempted = false;
    let publicationStores: { settings: GraphStore; source: GraphStore } | undefined;
    let terminal: RemoteTaskRecord | undefined; let releaseAllowed = false; let primaryFailure: RemoteExplanationError | undefined;
    const controller = new AbortController(); const deadline = this.now() + REMOTE_LIMITS.taskMs;
    try {
      const request = remoteStartRequestSchema.parse(raw);
      if (this.running.has(request.taskId) || this.ports.authority.remote.task(request.taskId)) throw new RemoteExplanationError("REVISION_CONFLICT");
      const context = this.ports.authority.remote.context(request.contextHandle); const cached = this.previews.get(context.ownerSessionId);
      if (this.blockedOwners.has(context.ownerSessionId)) throw new RemoteExplanationError("CONTEXT_CHANGED");
      if (!cached || cached.public.previewId !== request.previewId || cached.public.contextHandle !== request.contextHandle || cached.public.packageId !== request.packageId) throw new RemoteExplanationError("PREVIEW_EXPIRED");
      this.previews.delete(context.ownerSessionId);
      if (Date.now() >= Date.parse(cached.public.expiresAt)) throw new RemoteExplanationError("PREVIEW_EXPIRED");
      identity = remoteCapturedIdentitySchema.parse({ ...cached.identity, taskId: request.taskId });
      const ownedIdentity = identity;
      this.running.set(identity.taskId, { identity, controller, createdAt: new Date().toISOString() });
      this.gate(identity, () => this.ports.authority.remote.assertPermission(ownedIdentity));
      if (!this.ports.provider || !this.ports.credentials || !cached.public.bodyDigest) throw new RemoteExplanationError("NOT_CONFIGURED");
      const provider = this.ports.provider; const settings = this.ports.authority.remote.provider();
      let credential: { credential: string; revision: number };
      try { credential = await this.bounded(this.asyncWork(() => this.ports.credentials!.read()), controller, deadline); }
      catch (error) { if (error instanceof RemoteExplanationError && (error.code === "TIMEOUT" || error.code === "CANCELLED")) throw error; throw new RemoteExplanationError("CREDENTIAL_UNAVAILABLE"); }
      if (!credential || !remoteKeySchema.safeParse(credential.credential).success || !remoteRevisionSchema.safeParse(credential.revision).success) throw new RemoteExplanationError("CREDENTIAL_UNAVAILABLE");
      if (credential.revision !== identity.credentialRevision) throw new RemoteExplanationError("REVISION_CONFLICT");
      const check = await this.workspace(identity, controller, deadline);
      const prepared = this.build({ repositoryId: identity.repositoryId, snapshotId: identity.snapshotId, contextHandle: identity.contextHandle, purpose: "feature-explanation", query: cached.public.evidencePackage.query }, check.validationLimitations);
      if (prepared.evidencePackage.packageId !== cached.public.packageId || remoteHashSchema.parse(provider.bodyDigest(clone(prepared), clone(settings))) !== cached.public.bodyDigest || canonicalJson(prepared) !== canonicalJson(cached.prepared)) throw new RemoteExplanationError("PREVIEW_EXPIRED");
      this.checkpoint(controller, deadline);
      let network: Promise<unknown> | undefined;
      const verifyBody = (stores: { source: GraphStore }) => {
        this.ports.authority.remote.assertPermission(ownedIdentity); this.checkpoint(controller, deadline);
        if (canonicalJson(this.ports.authority.remote.provider()) !== canonicalJson(settings)
          || remoteHashSchema.parse(provider.bodyDigest(clone(prepared), clone(settings))) !== ownedIdentity.bodyDigest
          || canonicalJson(this.build({ repositoryId: ownedIdentity.repositoryId, snapshotId: ownedIdentity.snapshotId, contextHandle: ownedIdentity.contextHandle, purpose: "feature-explanation", query: cached.public.evidencePackage.query }, check.validationLimitations, stores.source)) !== canonicalJson(prepared)) throw new RemoteExplanationError("PREVIEW_EXPIRED");
      };
      const reserved = this.gate(identity, stores => {
        verifyBody(stores); const receipt = this.ports.authority.remote.reserveDispatch(ownedIdentity);
        return { receipt, createdAt: this.ports.authority.remote.reservedDispatchCreatedAt(receipt) };
      });
      reservation = reserved.receipt;
      const running = this.running.get(identity.taskId)!; running.reservation = reservation; running.createdAt = reserved.createdAt;
      const dispatched = this.gate(identity, stores => {
        verifyBody(stores);
        this.ports.authority.remote.assertPermission(ownedIdentity); this.checkpoint(controller, deadline);
        const task = this.ports.authority.remote.registerReservedDispatch(reserved.receipt);
        this.ports.authority.remote.markReservedDispatchAttempt(reserved.receipt); dispatchAttempted = true; running.dispatchAttempted = true;
        network = this.asyncWork(() => provider.dispatch({ prepared: clone(prepared), settings: clone(settings), bodyDigest: ownedIdentity.bodyDigest, credential: credential.credential, signal: controller.signal, taskDeadline: deadline }));
        if (!network || typeof network.then !== "function") throw new RemoteExplanationError("PROVIDER_FAILED");
        // Observe immediately if the following synchronous commit fails; never retry.
        void network.catch(() => undefined); return task;
      });
      registered = true; this.emit(dispatched);
      const rawNarrative = await this.bounded(network!, controller, deadline); this.checkpoint(controller, deadline);
      const validated = validateRemoteNarrative(rawNarrative, prepared.evidencePackage, prepared);
      const checked = await this.workspace(identity, controller, deadline); this.checkpoint(controller, deadline);
      if (this.producer) await stopRemoteProducer(this.producer);
      const completed = this.gate(identity, stores => {
        this.checkpoint(controller, deadline); this.ports.authority.remote.assertPermission(ownedIdentity);
        const task = this.ports.authority.remote.task(ownedIdentity.taskId);
        if (!task || task.phase !== "dispatched") throw new RemoteExplanationError(task?.code ?? "CONTEXT_CHANGED");
        const lockedEvidence = this.build({ repositoryId: ownedIdentity.repositoryId, snapshotId: ownedIdentity.snapshotId, contextHandle: ownedIdentity.contextHandle, purpose: "feature-explanation", query: prepared.evidencePackage.query }, check.validationLimitations, stores.source);
        if (canonicalJson(lockedEvidence) !== canonicalJson(prepared)) throw new RemoteExplanationError("SNAPSHOT_NOT_CURRENT");
        this.checkpoint(controller, deadline);
        const result = remoteResultSchema.parse({ version: "1.0.0", identity: ownedIdentity, narrative: validated.narrative, checkedAt: checked.checkedAt, completedAt: new Date().toISOString(),
          localUnknowns: validated.localUnknowns, localLimitations: [...new Set([...validated.localLimitations, ...checked.validationLimitations])], localTruncation: validated.localTruncation,
          citations: prepared.evidencePackage.proofs.map(({ snippet: _snippet, ...proof }) => proof),
          unknownEvidenceIds: [...new Set([...prepared.evidencePackage.proofs.filter(proof => proof.confidence === "unknown").map(proof => proof.id), ...prepared.evidencePackage.edges.filter(edge => edge.confidence === "unknown").map(edge => edge.evidenceId)])] });
        if (containsCredential(result, credential.credential)) throw new RemoteExplanationError("INVALID_RESPONSE");
        publicationStores = stores; stores.source.remote.appendResult(result);
        return this.ports.authority.remote.finish(ownedIdentity.taskId, null);
      });
      terminal = completed; releaseAllowed = true;
    } catch (error) {
      controller.abort();
      if (this.producer) { try { await stopRemoteProducer(this.producer); } catch { throw safeFailure(error); } }
      if (registered && identity) {
        primaryFailure = safeFailure(error);
        try {
          const task = this.write(() => this.ports.authority.remote.finish(identity!.taskId, primaryFailure!.code));
          if (publicationStores) this.write(() => this.ports.authority.discardFailedExplanation(identity!, publicationStores!.settings, publicationStores!.source));
          terminal = task; releaseAllowed = true;
          if (task.code) primaryFailure = new RemoteExplanationError(task.code);
        } catch (cleanupError) {
          // Keep the lease closed for trusted recovery; do not mask this error in finally.
          primaryFailure = remoteStoreFailure(cleanupError); throw primaryFailure;
        }
      } else {
        if (reservation && !dispatchAttempted) {
          primaryFailure = remoteStoreFailure(error);
          try { this.write(() => this.ports.authority.remote.immediate(() => this.ports.authority.remote.finishUndispatchedReservation(reservation!, primaryFailure!.code))); }
          catch { throw primaryFailure; } // Cleanup failure keeps the durable slot and original error.
        }
        const cancelled = identity ? this.ports.authority.remote.task(identity.taskId) : null;
        if (cancelled?.phase === "cancelled" && cancelled.code === "CANCELLED" && canonicalJson(cancelled.identity) === canonicalJson(identity)) {
          terminal = cancelled; primaryFailure = new RemoteExplanationError("CANCELLED");
        } else { primaryFailure = remoteStoreFailure(error); throw primaryFailure; }
      }
    } finally {
      controller.abort();
      if (identity) {
        this.running.delete(identity.taskId);
        if (registered && releaseAllowed) {
          try { this.write(() => this.ports.authority.remote.releaseDispatch(identity!.taskId)); }
          catch (releaseError) { throw primaryFailure ?? remoteStoreFailure(releaseError); }
        }
      }
    }
    if (!terminal) throw new RemoteExplanationError("POLICY_INVALID");
    this.emit(terminal); return terminal;
  }
  private emit(task: RemoteTaskRecord): void { try { if (this.producer) assertRemoteProducerContext(this.producer); this.ports.onTask?.(clone(task)); } catch { /* A consumer failure cannot mutate or resend a committed task. */ } }
  cancel(raw: { contextHandle: string; taskId: string }): RemoteTaskRecord {
    try {
      const request = remoteCancelRequestSchema.parse(raw);
      let controller: AbortController | undefined;
      const terminal = this.write(() => this.ports.authority.remote.immediate(() => {
        const context = this.ports.authority.remote.context(request.contextHandle); const task = this.ports.authority.remote.task(request.taskId);
        const running = this.running.get(request.taskId); const identity = task?.identity ?? running?.identity;
        if (!identity || this.blockedOwners.has(context.ownerSessionId) || identity.ownerSessionId !== context.ownerSessionId || identity.contextHandle !== request.contextHandle || identity.contextEpoch !== context.epoch || (task && running && canonicalJson(task.identity) !== canonicalJson(running.identity))) throw new RemoteExplanationError("CONTEXT_CHANGED");
        controller = running?.controller;
        controller?.abort(); // A terminal log failure must not let a validated local cancellation dispatch later.
        if (!task && running?.reservation) return this.ports.authority.remote.finishUndispatchedReservation(running.reservation, "CANCELLED");
        return task ? this.ports.authority.remote.finish(request.taskId, "CANCELLED") : this.ports.authority.remote.recordUndispatchedCancellation(identity, running!.createdAt);
      }));
      controller?.abort(); return terminal;
    } catch (error) { throw remoteStoreFailure(error); }
  }
  commitTrustedContext(ownerSessionId: string, ref: SnapshotRef | null): RemoteContext {
    try {
      remoteUuidSchema.parse(ownerSessionId);
      // A failed authority commit must not leave this caller's old preview usable.
      // Main must also keep its gate closed and terminate a separate worker on failure.
      this.blockedOwners.add(ownerSessionId); this.previews.delete(ownerSessionId);
      this.preparations.get(ownerSessionId)?.abort();
      this.abort(task => task.identity.ownerSessionId === ownerSessionId);
      const context = this.write(() => this.ports.authority.remote.immediate(() => {
        if (!ref) return this.ports.authority.remote.commitTrustedContext(ownerSessionId, null);
        const { settings, source } = this.ports.stores(ref);
        return settings.remote.immediate(() => source.remote.immediate(() => {
          const reference = source.remote.activation(ref.repositoryId, ref.snapshotId); this.active(reference);
          return this.ports.authority.remote.commitTrustedContext(ownerSessionId, reference);
        }));
      }));
      if (context.active) this.blockedOwners.delete(ownerSessionId); return context;
    } catch (error) { throw remoteStoreFailure(error); }
  }
  saveAuthorization(repositoryId: string, expectedRevision: number, granted: boolean) {
    const result = this.write(() => this.ports.authority.remote.saveAuthorization(repositoryId, expectedRevision, granted));
    this.previews.clear(); this.abort(task => task.identity.repositoryId === repositoryId); return result;
  }
  saveProvider(expectedRevision: number, input: Omit<RemoteProviderSettings, "revision">) {
    const result = this.write(() => this.ports.authority.remote.saveProvider(expectedRevision, input));
    this.previews.clear(); this.abort(() => true); return result;
  }
  recoverInterruptedTasks(): void {
    if (this.producer) throw new RemoteExplanationError("POLICY_INVALID");
    this.ports.authority.remote.recoverInterrupted(); this.previews.clear();
    for (const controller of this.preparations.values()) controller.abort(); this.abort(() => true);
  }
  private abort(matches: (task: Running) => boolean): void { for (const task of this.running.values()) if (matches(task)) task.controller.abort(); }
  status(taskId: string, contextHandle: string): RemoteTaskRecord | null {
    const context = this.ports.authority.remote.context(contextHandle); const task = this.ports.authority.remote.task(taskId);
    if (task && task.identity.ownerSessionId !== context.ownerSessionId) throw new RemoteExplanationError("CONTEXT_CHANGED");
    if (task) return task;
    const running = this.running.get(taskId); if (!running) return null;
    if (this.blockedOwners.has(context.ownerSessionId) || running.identity.ownerSessionId !== context.ownerSessionId || running.identity.contextHandle !== contextHandle || running.identity.contextEpoch !== context.epoch) throw new RemoteExplanationError("CONTEXT_CHANGED");
    return remoteTaskRecordSchema.parse({ identity: running.identity, phase: "preparing", createdAt: running.createdAt, completedAt: null, code: null });
  }
  async result(taskId: string, contextHandle: string): Promise<RemoteResult | null> {
    const task = this.status(taskId, contextHandle); if (!task || task.phase !== "completed") return null;
    await this.workspace(task.identity, new AbortController(), this.now() + REMOTE_LIMITS.taskMs);
    return this.gate(task.identity, stores => {
      const result = stores.source.remote.result(taskId);
      if (!result || canonicalJson(result.identity) !== canonicalJson(task.identity)) throw new RemoteExplanationError("POLICY_INVALID"); return result;
    });
  }
}
