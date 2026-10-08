import { Worker } from "node:worker_threads";
import { types } from "node:util";
import { remoteUuidSchema, RemoteExplanationError } from "@project-xray/contracts";
const nativeThreadId = Object.getOwnPropertyDescriptor(Worker.prototype, "threadId")!.get!;
const nativeTerminate = Worker.prototype.terminate;
export type RemotePurpose = "feature-explanation" | "ownership-semantic-assessment";
declare const participantBrand: unique symbol, stopBrand: unique symbol;
export interface RemoteParticipant { readonly [participantBrand]: true }
export interface NativeRemoteStop { readonly [stopBrand]: true }
interface Participant { owner: string; purposes: readonly RemotePurpose[]; generation: number; worker?: Worker; unknown: boolean; retired: boolean; active: number; stopping?: Promise<number> }
function invalid(): never { throw new RemoteExplanationError("POLICY_INVALID"); }
/** Trusted construction ONLY: owned factory and operation closures are application
 * code, never renderer ports. Exit events and ordinary Promise settlement do not
 * issue stop capabilities; every registered native resource is checked again. */
export class NativeRemoteRecoveryDomain {
  #closed = false; #frozen = false; #revision = 0; #generation = 0;
  #participants = new Map<RemoteParticipant, Participant>();
  #proofs = new WeakMap<object, { revision: number }>();
  #waiters = new Set<() => void>();
  #pending = 0; #preparing = new Set<string>();
  create(owner: string, purposes: readonly RemotePurpose[], factory: () => Worker): RemoteParticipant {
    if (this.#closed || this.#frozen || !remoteUuidSchema.safeParse(owner).success || !purposes.length || new Set(purposes).size !== purposes.length || purposes.some(p => p !== "feature-explanation" && p !== "ownership-semantic-assessment")) invalid();
    if ([...this.#participants.values()].filter(p => p.unknown || p.active || p.worker && nativeThreadId.call(p.worker) !== -1).length >= 20) throw new RemoteExplanationError("LIMIT_EXCEEDED");
    const ticket = Object.freeze({}) as RemoteParticipant;
    const p: Participant = { owner, purposes: Object.freeze([...purposes]), generation: ++this.#generation, unknown: true, retired: false, active: 0 };
    this.#participants.set(ticket, p); this.#revision++;
    let worker: Worker;
    try { worker = factory(); } catch { throw new RemoteExplanationError("INTERRUPTED"); }
    if (types.isPromise(worker)) void Promise.prototype.then.call(worker, undefined, () => undefined);
    if (types.isProxy(worker) || !(worker instanceof Worker)) invalid();
    worker.on("error", () => { /* Native exit state remains the resource authority. */ });
    p.worker = worker; p.unknown = false; return ticket;
  }
  retire(ticket: RemoteParticipant): void { const p = this.#participants.get(ticket); if (!p || this.#closed) invalid(); p.retired = true; this.#revision++; }
  private usable(ticket: RemoteParticipant): Participant {
    const p = this.#participants.get(ticket);
    if (!p || this.#closed || this.#frozen || p.retired || p.unknown) invalid(); return p;
  }
  async operation<T>(ticket: RemoteParticipant, kind: "prepare" | "work", work: () => Promise<T>): Promise<T> {
    const p = this.usable(ticket); if (this.#pending >= 20) throw new RemoteExplanationError("LIMIT_EXCEEDED");
    if (kind === "prepare" && this.#preparing.has(p.owner)) throw new RemoteExplanationError("BUSY");
    if (kind === "prepare") this.#preparing.add(p.owner);
    p.active++; this.#pending++;
    try { const value = await work(); this.usable(ticket); return value; }
    finally {
      p.active--; this.#pending--; if (kind === "prepare") this.#preparing.delete(p.owner);
      for (const waiter of this.#waiters) waiter();
    }
  }
  /** All trusted producer writes/events use this synchronous gate. Delayed work
   * cannot write just because its Promise was started before recovery froze. */
  identity(ticket: RemoteParticipant): { owner: string; purposes: readonly RemotePurpose[] } { const p = this.usable(ticket); return { owner: p.owner, purposes: p.purposes }; }
  admit<T>(ticket: RemoteParticipant, work: () => T): T {
    const p = this.usable(ticket), result = work();
    if (types.isPromise(result) || types.isProxy(result)) { p.unknown = true; if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => undefined); invalid(); }
    return result;
  }
  close(): void { this.#closed = true; this.#frozen = true; this.#revision++; this.#proofs = new WeakMap(); for (const p of this.#participants.values()) if (p.worker) void this.stop(p).catch(() => undefined); }
  private stop(p: Participant): Promise<number> {
    if (!p.worker || p.unknown) return Promise.reject(new RemoteExplanationError("INTERRUPTED"));
    return p.stopping ??= nativeTerminate.call(p.worker);
  }
  async freezeAndStop(): Promise<NativeRemoteStop> {
    if (this.#closed || !this.#participants.size) invalid();
    this.#frozen = true; const revision = ++this.#revision;
    const participants = [...this.#participants.values()];
    if (participants.some(p => p.unknown || !p.worker)) throw new RemoteExplanationError("INTERRUPTED");
    let waiter: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = (async () => {
      try { await Promise.all(participants.map(p => this.stop(p))); } catch { throw new RemoteExplanationError("INTERRUPTED"); }
      if (participants.some(p => nativeThreadId.call(p.worker!) !== -1)) throw new RemoteExplanationError("INTERRUPTED");
      if (participants.some(p => p.active)) await new Promise<void>(resolve => {
        waiter = () => { if (!participants.some(p => p.active)) resolve(); };
        this.#waiters.add(waiter); waiter();
      });
    })();
    try {
      await Promise.race([settled, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RemoteExplanationError("INTERRUPTED")), 60_000); })]);
    } finally { if (timer) clearTimeout(timer); if (waiter) this.#waiters.delete(waiter); }
    if (this.#closed || revision !== this.#revision || participants.length !== this.#participants.size || participants.some(p => p.unknown || p.active || nativeThreadId.call(p.worker!) !== -1)) invalid();
    const proof = Object.freeze({}) as NativeRemoteStop; this.#proofs.set(proof, { revision }); return proof;
  }
  consume(proof: NativeRemoteStop): readonly { owner: string; purposes: readonly RemotePurpose[]; generation: number }[] {
    const value = this.#proofs.get(proof); if (!value) invalid(); this.#proofs.delete(proof);
    if (this.#closed || !this.#frozen || value.revision !== this.#revision || [...this.#participants.values()].some(p => p.unknown || p.active || !p.worker || nativeThreadId.call(p.worker) !== -1)) invalid();
    return Object.freeze([...this.#participants.values()].map(p => Object.freeze({ owner: p.owner, purposes: p.purposes, generation: p.generation })));
  }
}
