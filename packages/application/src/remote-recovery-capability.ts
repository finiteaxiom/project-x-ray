import { Worker } from "node:worker_threads";
import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { remoteUuidSchema, remoteKeySchema, REMOTE_LIMITS, RemoteExplanationError } from "@project-xray/contracts";
const nativeThreadId = Object.getOwnPropertyDescriptor(Worker.prototype, "threadId")!.get!;
const nativeTerminate = Worker.prototype.terminate;
export type RemotePurpose = "feature-explanation" | "ownership-semantic-assessment";
declare const participantBrand: unique symbol, stopBrand: unique symbol;
export interface RemoteParticipant { readonly [participantBrand]: true }
export interface NativeRemoteStop { readonly [stopBrand]: true }
interface Participant { producer?: RemoteProducerPort; executionAttempted?: boolean; owner: string; purposes: readonly RemotePurpose[]; generation: number; worker?: Worker; unknown: boolean; retired: boolean; active: number; preparing: number; stopping?: Promise<number> }
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
    const p: Participant = { owner, purposes: Object.freeze([...purposes]), generation: ++this.#generation, unknown: true, retired: false, active: 0, preparing: 0 };
    this.#participants.set(ticket, p); this.#revision++;
    let worker: Worker;
    try { worker = factory(); } catch { throw new RemoteExplanationError("INTERRUPTED"); }
    if (types.isPromise(worker)) void Promise.prototype.then.call(worker, undefined, () => undefined);
    if (types.isProxy(worker) || !(worker instanceof Worker)) invalid();
    worker.on("error", () => { /* Native exit state remains the resource authority. */ });
    p.worker = worker; p.unknown = false; return ticket;
  }
  /** Internal execution port: native resource and admission are captured here,
   * never provided by a caller stop callback or a renderer DTO. */
  producer(ticket: RemoteParticipant, contextVeto: () => void, admit: <T>(work: () => T) => T): RemoteProducerPort {
    const p = this.usable(ticket); if (!p.worker || p.producer) invalid();
    const port = Object.freeze({}) as RemoteProducerPort;
    const data: Producer = { domain: this, ticket, worker: p.worker, contextVeto, admit, poisoned: false };
    producers.set(port, data); p.producer = port;
    p.worker.on("message", raw => {
      try {
        if (!data.requestId || !raw || typeof raw !== "object" || types.isProxy(raw)
          || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, "raw")
          || Object.getOwnPropertyDescriptor(raw, "requestId")?.value !== data.requestId
          || Buffer.byteLength(JSON.stringify(raw), "utf8") > REMOTE_LIMITS.responseBytes || data.received) invalid();
        data.received = true; data.resolve?.(Object.getOwnPropertyDescriptor(raw, "raw")!.value);
      } catch { data.poisoned = true; data.reject?.(new RemoteExplanationError("INVALID_RESPONSE")); }
    });
    p.worker.on("error", () => data.reject?.(new RemoteExplanationError("PROVIDER_FAILED")));
    p.worker.on("exit", () => data.reject?.(new RemoteExplanationError("INTERRUPTED")));
    return port;
  }
  executeProducer(ticket: RemoteParticipant): void {
    const p = this.usable(ticket);
    if (!p.worker || !p.active || p.executionAttempted || nativeThreadId.call(p.worker) === -1) invalid();
    p.executionAttempted = true;
  }
  /** Exact resource stop only: does not seal an inventory, erase retirement,
   * wait for the caller's own operation, or issue a global recovery proof. */
  async stopParticipant(ticket: RemoteParticipant): Promise<void> {
    const p = this.#participants.get(ticket); if (!p || !p.worker || p.unknown) invalid();
    await this.stop(p); if (nativeThreadId.call(p.worker) !== -1) invalid();
  }
  retire(ticket: RemoteParticipant): void { const p = this.#participants.get(ticket); if (!p || this.#closed) invalid(); p.retired = true; this.#revision++; }
  private usable(ticket: RemoteParticipant): Participant {
    const p = this.#participants.get(ticket);
    if (!p || this.#closed || this.#frozen || p.retired || p.unknown) invalid(); return p;
  }
  async operation<T>(ticket: RemoteParticipant, kind: "prepare" | "work", work: () => Promise<T>): Promise<T> {
    return this.runOperation(ticket, kind, work, false);
  }
  /** Register before invoking raw work; cancellation of its caller never settles it. */
  track<T>(ticket: RemoteParticipant, work: () => Promise<T>): Promise<T> {
    const p = this.usable(ticket); if (!p.active) invalid();
    return this.runOperation(ticket, p.preparing ? "prepare" : "work", work, true);
  }
  private async runOperation<T>(ticket: RemoteParticipant, kind: "prepare" | "work", work: () => Promise<T>, child: boolean): Promise<T> {
    const p = this.usable(ticket); if (this.#pending >= 20) throw new RemoteExplanationError("LIMIT_EXCEEDED");
    if (kind === "prepare" && this.#preparing.has(p.owner) && !child) throw new RemoteExplanationError("BUSY");
    if (kind === "prepare") { this.#preparing.add(p.owner); p.preparing++; }
    p.active++; this.#pending++;
    try { const value = await work(); this.usable(ticket); return value; }
    finally {
      p.active--; this.#pending--; if (kind === "prepare") { p.preparing--; if (![...this.#participants.values()].some(value => value.owner === p.owner && value.preparing)) this.#preparing.delete(p.owner); }
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


declare const producerBrand: unique symbol;
export interface RemoteProducerPort { readonly [producerBrand]: true }
interface Producer {
  domain: NativeRemoteRecoveryDomain; ticket: RemoteParticipant; worker: Worker;
  contextVeto: () => void; admit: <T>(work: () => T) => T; poisoned: boolean;
  requestId?: string; received?: boolean; resolve?: (raw: unknown) => void; reject?: (error: Error) => void;
}
const producers = new WeakMap<RemoteProducerPort, Producer>();
function producer(port: RemoteProducerPort): Producer { const value = producers.get(port); if (!value) invalid(); return value; }
export function assertRemoteProducerContext(port: RemoteProducerPort): void {
  const value = producer(port);
  if (value.poisoned || typeof value.contextVeto !== "function" || value.contextVeto() !== undefined) invalid();
  value.domain.identity(value.ticket);
}
export function admitRemoteProducer<T>(port: RemoteProducerPort, work: () => T): T {
  assertRemoteProducerContext(port);
  return producer(port).admit(() => { assertRemoteProducerContext(port); return work(); });
}
export function trackRemoteProducer<T>(port: RemoteProducerPort, work: () => Promise<T>): Promise<T> {
  assertRemoteProducerContext(port); const value = producer(port);
  return value.domain.track(value.ticket, () => { assertRemoteProducerContext(port); return work(); });
}
export function stopRemoteProducer(port: RemoteProducerPort): Promise<void> { const value = producer(port); return value.domain.stopParticipant(value.ticket); }
export function remoteProducerWorker(port: RemoteProducerPort): Worker { assertRemoteProducerContext(port); return producer(port).worker; }
/** Internal wire command carries actual validated bytes to the registered executor.
 * No transport callback, new Worker, SQL identity or stop receipt crosses it. */
export function executeRemoteProducer(port: RemoteProducerPort, input: { purpose: RemotePurpose; body: string; bodyDigest: string; credential?: string; taskDeadline?: number }): Promise<unknown> {
  assertRemoteProducerContext(port); const value = producer(port), identity = value.domain.identity(value.ticket);
  if (!input || typeof input !== "object" || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) invalid();
  const keys = Reflect.ownKeys(input), allowed = ["purpose", "body", "bodyDigest", "credential", "taskDeadline"];
  if (keys.some(key => typeof key !== "string" || !allowed.includes(key) || !Object.getOwnPropertyDescriptor(input, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(input, key)!))) invalid();
  if (!["purpose", "body", "bodyDigest"].every(key => Object.hasOwn(input, key))) invalid();
  if (!identity.purposes.includes(input.purpose) || typeof input.body !== "string" || Buffer.byteLength(input.body, "utf8") > REMOTE_LIMITS.requestBytes
    || createHash("sha256").update(input.body).digest("hex") !== input.bodyDigest
    || input.credential !== undefined && !remoteKeySchema.safeParse(input.credential).success
    || input.taskDeadline !== undefined && !Number.isFinite(input.taskDeadline)) invalid();
  value.domain.executeProducer(value.ticket); value.requestId = randomUUID();
  const response = new Promise<unknown>((resolve, reject) => { value.resolve = resolve; value.reject = reject; });
  void response.catch(() => undefined);
  try { value.worker.postMessage(Object.freeze({ version: "1.0.0", requestId: value.requestId, ...input })); }
  catch { value.reject!(new RemoteExplanationError("PROVIDER_FAILED")); }
  return response;
}
