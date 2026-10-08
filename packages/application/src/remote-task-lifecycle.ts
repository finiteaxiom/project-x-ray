import { RemoteExplanationError, type SnapshotRef } from "@project-xray/contracts";
import { type GraphStore, type RemoteRecoveryIssuer, type RemoteRecoverySource } from "@project-xray/graph";
import { NativeRemoteRecoveryDomain, type RemoteParticipant, type RemotePurpose } from "./remote-recovery-capability.js";
import type { Worker } from "node:worker_threads";
const lifecycleOwners = new WeakSet<GraphStore>();
/** Internal native execution domain. Not an XRayApplication factory or IPC API;
 * existing broker/B2 production paths are NOT enrolled by this core slice. */
export class RemoteTaskLifecycle {
  #domain = new NativeRemoteRecoveryDomain();
  #issuer: RemoteRecoveryIssuer;
  #ownedTasks = new Set<string>();
  #sources: { ref: SnapshotRef; settings: GraphStore; source: GraphStore; binding: RemoteRecoverySource }[] = [];
  #flight: Promise<{ terminalCommitted: boolean; sourceCommitted: boolean; released: boolean }> | null = null;
  constructor(private readonly authority: GraphStore) {
    if (lifecycleOwners.has(authority)) throw new RemoteExplanationError("POLICY_INVALID");
    this.#issuer = authority.openRemoteRecoveryIssuer(); lifecycleOwners.add(authority);
  }
  create(owner: string, purposes: readonly RemotePurpose[], factory: () => Worker): RemoteParticipant { return this.#domain.create(owner, purposes, factory); }
  retire(ticket: RemoteParticipant): void { this.#domain.retire(ticket); }
  operation<T>(ticket: RemoteParticipant, kind: "prepare" | "work", work: () => Promise<T>): Promise<T> { return this.#domain.operation(ticket, kind, work); }
  admit<T>(ticket: RemoteParticipant, work: () => T): T {
    const identity = this.#domain.identity(ticket), before = this.#issuer.capture().occupied;
    try { return this.#domain.admit(ticket, work); }
    finally {
      const after = this.#issuer.capture().occupied;
      if (after && after.taskId !== before?.taskId && after.owner === identity.owner && identity.purposes.includes(after.purpose)) this.#ownedTasks.add(after.taskId);
    }
  }
  bind(ref: SnapshotRef, settings: GraphStore, source: GraphStore): void {
    const binding = this.authority.bindRemoteRecoverySource(ref, settings, source);
    const next = { ref: { ...ref }, settings, source, binding };
    // Explicit same-instance revalidation replaces its old capture. Different
    // sources claiming one identity stay ambiguous; never guess which is correct.
    const index = this.#sources.findIndex(value => value.ref.repositoryId === ref.repositoryId && value.ref.snapshotId === ref.snapshotId && value.settings === settings && value.source === source);
    if (index === -1) this.#sources.push(next); else this.#sources[index] = next;
  }
  recover(): Promise<{ terminalCommitted: boolean; sourceCommitted: boolean; released: boolean }> {
    if (this.#flight) return this.#flight;
    const operation = this.recoverOwned(); this.#flight = operation;
    void operation.finally(() => { if (this.#flight === operation) this.#flight = null; }).catch(() => undefined);
    return operation;
  }
  private async recoverOwned() {
    const proof = await this.#domain.freezeAndStop();
    const inventory = this.#domain.consume(proof), capture = this.#issuer.capture();
    if (capture.owners.some(owner => !inventory.some(p => p.owner === owner))) throw new RemoteExplanationError("POLICY_INVALID");
    if (capture.occupied && !this.#ownedTasks.has(capture.occupied.taskId)) throw new RemoteExplanationError("POLICY_INVALID");
    if (capture.occupied && !inventory.some(p => p.owner === capture.occupied!.owner && p.purposes.includes(capture.occupied!.purpose))) throw new RemoteExplanationError("POLICY_INVALID");
    return this.#issuer.recover(this.#issuer.authorize(capture), this.#sources.map(value => value.binding));
  }
  close(): void { this.#domain.close(); this.#issuer.close(); }
}
