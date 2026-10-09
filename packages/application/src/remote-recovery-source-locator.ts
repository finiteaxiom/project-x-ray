import { types } from "node:util";
import { canonicalJson, remotePrepareRequestSchema, type RemotePrepareRequest, type RemoteStartRequest, type OwnershipSemanticPrepareRequest } from "@project-xray/contracts";
import { prepareOpenAIResponsesRequest } from "@project-xray/llm";
import type { XRayApplication } from "./index.js";
import { RemoteExplanationApplication, type RemoteCredentialPort } from "./remote-explanation.js";
import { OwnershipSemanticApplication } from "./ownership-semantic-application.js";
import { assertRemoteProducerContext, executeRemoteProducer, stopRemoteProducer } from "./remote-recovery-capability.js";
import { RemoteExplanationError, snapshotRefSchema, type SnapshotRef } from "@project-xray/contracts";
import type { GraphStore } from "@project-xray/graph";
import type { Worker } from "node:worker_threads";
import { RemoteTaskLifecycle } from "./remote-task-lifecycle.js";
import type { RemoteParticipant, RemotePurpose } from "./remote-recovery-capability.js";

export interface HeldStoreRemoteRecovery {
  bind(ref: unknown): void;
  create(owner: string, purposes: readonly RemotePurpose[], factory: () => Worker): RemoteParticipant;
  retire(ticket: RemoteParticipant): void;
  operation<T>(ticket: RemoteParticipant, kind: "prepare" | "work", work: () => Promise<T>): Promise<T>;
  admit<T>(ticket: RemoteParticipant, work: () => T): T;
  recover(): Promise<{ terminalCommitted: boolean; sourceCommitted: boolean; released: boolean }>;
}
interface BoundSource { ref: SnapshotRef; source: GraphStore; settings: GraphStore }
interface HeldContext {
  authority: GraphStore; stores: ReadonlyMap<string, GraphStore>; snapshots: ReadonlyMap<string, GraphStore>;
  closers: Set<() => void>; closed: boolean; lifecycle?: RemoteTaskLifecycle; coordinator?: HeldStoreRemoteRecovery; bindings: Map<string, BoundSource>;
}
const applications = new WeakMap<object, HeldContext>();
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
function open(context: HeldContext): void { if (context.closed) invalid(); }
function captureRef(raw: unknown): SnapshotRef {
  try {
    if (!raw || typeof raw !== "object" || types.isProxy(raw)) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 2 || !keys.includes("repositoryId") || !keys.includes("snapshotId")) invalid();
    if (!Object.values(descriptors).every(value => "value" in value)) invalid();
    return Object.freeze(snapshotRefSchema.strict().parse({ repositoryId: descriptors.repositoryId!.value, snapshotId: descriptors.snapshotId!.value }));
  } catch { invalid(); }
}
function resolveHeld(context: HeldContext, ref: SnapshotRef): BoundSource {
  open(context);
  try {
    const explicit = context.snapshots.get(ref.snapshotId), project = context.stores.get(ref.repositoryId);
    if (explicit && explicit.loadSnapshot(ref.snapshotId)?.repositoryId !== ref.repositoryId) invalid();
    // Never suppress a broken/closed candidate and guess a fallback. Inspect only
    // already-held instances; no filesystem, enumeration or lazy-opening ports.
    const candidates = new Set<GraphStore>();
    for (const store of new Set([context.authority, ...context.stores.values(), ...context.snapshots.values()])) {
      const overview = store.loadSnapshot(ref.snapshotId);
      if (overview) {
        if (overview.repositoryId !== ref.repositoryId) invalid();
        store.remoteSnapshotMetadata(ref.repositoryId, ref.snapshotId); candidates.add(store);
      }
    }
    if (candidates.size !== 1) invalid(); const source = [...candidates][0]!;
    if (explicit && explicit !== source || source !== context.authority && !project) invalid();
    const settings = project ?? context.authority;
    const settingsOverview = settings.getLatestSnapshot();
    if (project && settingsOverview && settingsOverview.repositoryId !== ref.repositoryId) invalid();
    settings.loadIgnoreSettings(ref.repositoryId);
    return { ref, source, settings };
  } catch { invalid(); }
}
/** Privileged constructor delegation only, called by XRayApplication with its
 * actual authority and live private maps. Not exported from application/index. */
export function registerHeldStoreRecovery(application: object, authority: GraphStore, stores: ReadonlyMap<string, GraphStore>, snapshots: ReadonlyMap<string, GraphStore>): () => void {
  if (applications.has(application)) invalid();
  const context: HeldContext = { authority, stores, snapshots, closers: new Set(), closed: false, bindings: new Map() };
  applications.set(application, context);
  return () => { if (context.closed) return; context.closed = true; context.lifecycle?.close(); for (const close of context.closers) close(); context.closers.clear(); };
}
/** Trusted internal acquisition. Takes only an actually registered application,
 * never a caller-provided store/SQL handle/path/stop Boolean. */
export function heldStoreRemoteRecovery(application: object): HeldStoreRemoteRecovery {
  const context = applications.get(application); if (!context) invalid(); open(context);
  if (context.coordinator) return context.coordinator;
  const lifecycle = context.lifecycle = new RemoteTaskLifecycle(context.authority);
  const coordinator: HeldStoreRemoteRecovery = {
    bind: raw => {
      open(context); const bound = resolveHeld(context, captureRef(raw));
      lifecycle.bind(bound.ref, bound.settings, bound.source);
      context.bindings.set(JSON.stringify([bound.ref.repositoryId, bound.ref.snapshotId]), bound);
    },
    create: (owner, purposes, factory) => { open(context); return lifecycle.create(owner, purposes, factory); },
    retire: ticket => { open(context); lifecycle.retire(ticket); },
    operation: (ticket, kind, work) => { open(context); return lifecycle.operation(ticket, kind, work); },
    admit: (ticket, work) => { open(context); return lifecycle.admit(ticket, work); },
    recover: () => {
      open(context);
      const bindings = [...context.bindings.values()];
      const contextVeto = () => {
        open(context);
        for (const bound of bindings) {
          const current = resolveHeld(context, bound.ref);
          if (current.source !== bound.source || current.settings !== bound.settings) invalid();
        }
      };
      contextVeto();
      return lifecycle.recover(contextVeto).catch((error: unknown) => {
        if (error instanceof RemoteExplanationError) throw error;
        const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
        throw new RemoteExplanationError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" ? "BUSY" : "POLICY_INVALID");
      });
    },
  };
  context.coordinator = Object.freeze(coordinator); return context.coordinator;
}


/** Trusted internal composition only: fixed native executor factory, no provider
 * dispatch callback and no public store/SQL/stop capability. */
function heldProducer(application: XRayApplication, refInput: unknown, contextHandle: string, purpose: RemotePurpose, createWorker: () => Worker) {
  const context = applications.get(application); if (!context) invalid(); open(context);
  const ref = captureRef(refInput), bound = resolveHeld(context, ref), initial = context.authority.remote.context(contextHandle);
  if (!initial.active || initial.reference?.repositoryId !== ref.repositoryId || initial.reference.snapshotId !== ref.snapshotId) invalid();
  const root = heldStoreRemoteRecovery(application); root.bind(ref);
  const ticket = root.create(initial.ownerSessionId, [purpose], createWorker);
  let closed = false;
  const veto = () => {
    open(context); if (closed) invalid();
    const latest = resolveHeld(context, ref);
    if (latest.source !== bound.source || latest.settings !== bound.settings || canonicalJson(context.authority.remote.context(contextHandle)) !== canonicalJson(initial)) invalid();
  };
  const port = context.lifecycle!.producer(ticket, veto);
  const scope = <T>(kind: "prepare" | "work", work: () => Promise<T>) => root.operation(ticket, kind, async () => { veto(); const value = await work(); veto(); return value; });
  const checkRequest = (raw: { repositoryId: string; snapshotId: string; contextHandle: string }) => {
    if (raw.repositoryId !== ref.repositoryId || raw.snapshotId !== ref.snapshotId || raw.contextHandle !== contextHandle) invalid();
  };
  const close = (cleanup: () => void) => {
    if (closed) return; closed = true; cleanup();
    if (!context.closed) root.retire(ticket);
    void stopRemoteProducer(port).catch(() => undefined);
  };
  return { context, ref, bound, port, scope, checkRequest, close };
}
export function createHeldFeatureProducer(application: XRayApplication, input: { ref: SnapshotRef; contextHandle: string; createWorker: () => Worker; credentials: RemoteCredentialPort; onTask?: (task: import("@project-xray/contracts").RemoteTaskRecord) => void }) {
  const p = heldProducer(application, input.ref, input.contextHandle, "feature-explanation", input.createWorker);
  const wire = (prepared: import("@project-xray/llm").PreparedEvidencePackage, settings: import("@project-xray/contracts").RemoteProviderSettings) => {
    if (!settings.model) throw new RemoteExplanationError("NOT_CONFIGURED");
    return prepareOpenAIResponsesRequest({ prepared, model: settings.model, maxOutputTokens: settings.outputTokens });
  };
  const flow = new RemoteExplanationApplication({ authority: p.context.authority, stores: ref => {
    const current = resolveHeld(p.context, captureRef({ repositoryId: ref.repositoryId, snapshotId: ref.snapshotId }));
    return { settings: current.settings, source: current.source };
  }, currentReference: () => {
    const refs = [...new Set([p.context.authority, ...p.context.stores.values(), ...p.context.snapshots.values()])].map(store => store.getActiveReference()).filter(value => value !== null);
    return refs.sort((a, b) => b.activation.localeCompare(a.activation))[0] ?? null;
  }, checkWorkspace: async (ref, signal) => { if (signal.aborted) invalid(); const value = await application.getSnapshotState(ref); if (signal.aborted) invalid(); return value; }, credentials: input.credentials,
    provider: { bodyDigest: (prepared, settings) => wire(prepared, settings).bodyDigest, dispatch: data => {
      const body = wire(data.prepared, data.settings); if (body.bodyDigest !== data.bodyDigest) invalid();
      return executeRemoteProducer(p.port, { purpose: "feature-explanation", body: body.body, bodyDigest: body.bodyDigest, credential: data.credential, taskDeadline: data.taskDeadline });
    } }, ...(input.onTask ? { onTask: input.onTask } : {}) }, p.port);
  let attempted = false, preparing = false;
  const close = () => p.close(() => flow.closeProducer()); p.context.closers.add(close);
  return Object.freeze({
    prepare: (raw: RemotePrepareRequest) => { if (preparing) return Promise.reject(new RemoteExplanationError("BUSY")); preparing = true; return p.scope("prepare", async () => { if (attempted) invalid(); try { const request = remotePrepareRequestSchema.parse(raw); p.checkRequest(request); return await flow.prepare(request); } catch (error) { attempted = true; await stopRemoteProducer(p.port); throw error; } }).catch(async error => { attempted = true; await stopRemoteProducer(p.port); throw error; }).finally(() => { preparing = false; }); },
    start: (raw: RemoteStartRequest) => p.scope("work", async () => { if (attempted) invalid(); attempted = true; if (raw.contextHandle !== input.contextHandle) invalid(); return flow.start(raw); }),
    cancel: (raw: { contextHandle: string; taskId: string }) => p.scope("work", async () => { if (raw.contextHandle !== input.contextHandle) invalid(); const value = flow.cancel(raw); await stopRemoteProducer(p.port); return value; }),
    status: (taskId: string) => p.scope("work", async () => flow.status(taskId, input.contextHandle)),
    result: (taskId: string) => p.scope("work", () => flow.result(taskId, input.contextHandle)), close,
  });
}
export interface HeldSemanticProducer {
  prepare(raw: OwnershipSemanticPrepareRequest, options?: { signal?: AbortSignal }): Promise<import("@project-xray/graph").PreparedSemanticReservation>;
  reserve(token: import("@project-xray/graph").PreparedSemanticReservation): import("@project-xray/graph").SemanticReservedMetadata;
  start(ticket: import("@project-xray/graph").SemanticReservation): Promise<import("@project-xray/contracts").OwnershipSemanticResultEnvelope>;
  cancel(ticket?: import("@project-xray/graph").SemanticReservation): Promise<void>;
  read(ticket: import("@project-xray/graph").SemanticReservation): Promise<import("@project-xray/contracts").OwnershipSemanticResultEnvelope>;
  close(): void;
}
export function createHeldSemanticProducer(application: XRayApplication, input: { ref: SnapshotRef; contextHandle: string; createWorker: () => Worker }): HeldSemanticProducer {
  const p = heldProducer(application, input.ref, input.contextHandle, "ownership-semantic-assessment", input.createWorker);
  const flow = new OwnershipSemanticApplication(p.context.authority, request => {
    p.checkRequest(request); assertRemoteProducerContext(p.port); const current = resolveHeld(p.context, p.ref);
    return { source: current.source, settings: current.settings };
  }, undefined, p.port);
  let attempted = false, preparing = false;
  const close = () => p.close(() => flow.close()); p.context.closers.add(close);
  return Object.freeze({
    prepare: (raw: OwnershipSemanticPrepareRequest, options?: { signal?: AbortSignal }) => { if (preparing) return Promise.reject(new RemoteExplanationError("BUSY")); preparing = true; return p.scope("prepare", async () => { if (attempted) invalid(); try { return await flow.prepare(raw, options); } catch (error) { attempted = true; await stopRemoteProducer(p.port); throw error; } }).catch(async error => { attempted = true; await stopRemoteProducer(p.port); throw error; }).finally(() => { preparing = false; }); },
    reserve: (token: import("@project-xray/graph").PreparedSemanticReservation) => { try { assertRemoteProducerContext(p.port); return flow.reserve(token); } catch (error) { attempted = true; void stopRemoteProducer(p.port).catch(() => undefined); throw error; } },
    start: (ticket: import("@project-xray/graph").SemanticReservation) => p.scope("work", async () => { if (attempted) invalid(); attempted = true; return flow.start(ticket); }),
    cancel: (ticket?: import("@project-xray/graph").SemanticReservation) => p.scope("work", async () => { await flow.cancel(ticket); await stopRemoteProducer(p.port); }),
    read: (ticket: import("@project-xray/graph").SemanticReservation) => p.scope("work", () => flow.read(ticket)), close,
  });
}
