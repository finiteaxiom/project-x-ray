import { types } from "node:util";
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
  closed: boolean; lifecycle?: RemoteTaskLifecycle; coordinator?: HeldStoreRemoteRecovery; bindings: Map<string, BoundSource>;
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
  const context: HeldContext = { authority, stores, snapshots, closed: false, bindings: new Map() };
  applications.set(application, context);
  return () => { if (context.closed) return; context.closed = true; context.lifecycle?.close(); };
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
