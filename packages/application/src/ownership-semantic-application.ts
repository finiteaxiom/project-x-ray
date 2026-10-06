import { Worker } from "node:worker_threads";
import { types } from "node:util";
import { remoteFailureCodeSchema, type OwnershipSemanticPrepareRequest, type OwnershipSemanticResultEnvelope, type RemoteFailureCode } from "@project-xray/contracts";
import { captureSemanticPrepareRequest, OwnershipSemanticPreparationError, SEMANTIC_PREPARATION_TIMEOUT_MS,
  type GraphStore, type PreparedSemanticReservation, type SemanticReservation, type SemanticReservedMetadata, type SemanticExecutionPreparation } from "@project-xray/graph";
import { validatePreparedOwnershipSemanticResponse, type PreparedOwnershipSemanticRequest } from "@project-xray/llm";

export class OwnershipSemanticExecutionError extends Error {
  constructor(readonly code: RemoteFailureCode) { super("所有权语义执行失败"); this.name = "OwnershipSemanticExecutionError"; }
}
function failure(error: unknown, fallback: RemoteFailureCode = "PROVIDER_FAILED"): OwnershipSemanticExecutionError {
  const code = error && typeof error === "object" && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
  const parsed = remoteFailureCodeSchema.safeParse(code);
  return new OwnershipSemanticExecutionError(parsed.success ? parsed.data : code === "NOT_CURRENT" ? "SNAPSHOT_NOT_CURRENT" : code === "NOT_AUTHORIZED" ? "CONSENT_REVOKED" : code === "INVALID_MATERIAL" || code === "INVALID_RECEIPT" || code === "INVALID_RESULT" ? "POLICY_INVALID" : fallback);
}
/** Internal backend factory ONLY. No default HTTP/provider/credential adapter.
 * The returned native worker owns this execution's resources; fixture workers run
 * only self-authored messages. Arbitrary callback settlement never proves exit. */
export interface OwnershipSemanticExecutionPorts { createWorker(prepared: SemanticExecutionPreparation): Worker }
interface Slot {
  source: GraphStore; controller: AbortController; detach: () => void; timer: ReturnType<typeof setTimeout>;
  token?: PreparedSemanticReservation; reserved?: SemanticReservedMetadata;
  starting: boolean; attempted: boolean; committed: boolean; completed: boolean;
  // Reuse is separate from success: actual graph release plus all old async work settled.
  released: boolean; activeOperations: number;
  worker?: Worker; prepared?: SemanticExecutionPreparation;
  response?: Promise<{ raw: unknown } | { error: OwnershipSemanticExecutionError }>;
  poll?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout>;
  cancelCode?: RemoteFailureCode;
  executionFailure?: OwnershipSemanticExecutionError;
  stopping?: Promise<number>;
}
export class OwnershipSemanticApplication {
  #closed = false; #slot: Slot | null = null;
  constructor(private readonly authority: GraphStore,
    private readonly stores: (request: OwnershipSemanticPrepareRequest) => { source: GraphStore; settings: GraphStore },
    private readonly execution?: OwnershipSemanticExecutionPorts) {}
  private clearWaits(slot: Slot): void { clearTimeout(slot.timer); if (slot.poll) clearInterval(slot.poll); if (slot.deadline) clearTimeout(slot.deadline); }
  private stopWorker(slot: Slot): Promise<number> {
    if (!slot.worker) return Promise.reject(new OwnershipSemanticExecutionError("POLICY_INVALID"));
    return slot.stopping ??= Worker.prototype.terminate.call(slot.worker);
  }
  private discard(slot: Slot): void {
    this.clearWaits(slot); slot.detach(); slot.controller.abort();
    if (slot.token) slot.source.revokeOwnershipSemanticReservationPreparation(slot.token);
    if (slot.reserved) slot.source.revokeOwnershipSemanticReservation(slot.reserved.reservation);
    if (this.#slot === slot) this.#slot = null;
  }
  close(): void {
    this.#closed = true; const slot = this.#slot; if (!slot) return;
    this.discard(slot);
    if (slot.worker) void this.stopWorker(slot).catch(() => undefined);
    // Closing does not terminalize/compensate/release or manufacture a stop receipt.
  }
  async prepare(raw: OwnershipSemanticPrepareRequest, options: { signal?: AbortSignal } = {}): Promise<PreparedSemanticReservation> {
    if (this.#closed) throw new OwnershipSemanticExecutionError("POLICY_INVALID");
    const request = captureSemanticPrepareRequest(raw), { source, settings } = this.stores(request);
    if (this.#slot && (this.#slot.activeOperations > 0 || (!this.#slot.completed && !this.#slot.released && (this.#slot.reserved || this.#slot.starting)))) throw new OwnershipSemanticExecutionError("BUSY");
    if (this.#slot) this.discard(this.#slot);
    const controller = new AbortController(), signal = options.signal;
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const slot: Slot = { source, controller, detach: () => signal?.removeEventListener("abort", abort), timer: setTimeout(() => controller.abort(new OwnershipSemanticPreparationError("TIMEOUT")), SEMANTIC_PREPARATION_TIMEOUT_MS), starting: false, attempted: false, committed: false, completed: false, released: false, activeOperations: 0 };
    this.#slot = slot;
    try {
      const token = await source.prepareOwnershipSemanticReservation(request, this.authority, settings, controller.signal);
      if (this.#closed || this.#slot !== slot || controller.signal.aborted) { source.revokeOwnershipSemanticReservationPreparation(token); throw new OwnershipSemanticExecutionError("CANCELLED"); }
      slot.token = token; clearTimeout(slot.timer); return token;
    } catch (error) { this.discard(slot); throw failure(error, "POLICY_INVALID"); }
  }
  reserve(token: PreparedSemanticReservation): SemanticReservedMetadata {
    const slot = this.#slot;
    if (this.#closed || !slot || slot.token !== token || slot.reserved) throw new OwnershipSemanticExecutionError("POLICY_INVALID");
    try { const result = slot.source.reserveOwnershipSemantic(token); delete slot.token; slot.reserved = result; return result; }
    catch (error) { this.discard(slot); throw failure(error, "POLICY_INVALID"); }
  }
  private owned(ticket: SemanticReservation): Slot {
    const slot = this.#slot;
    if (this.#closed || !slot || slot.reserved?.reservation !== ticket) throw new OwnershipSemanticExecutionError("POLICY_INVALID"); return slot;
  }
  private watch(slot: Slot, ticket: SemanticReservation): void {
    const stop = (code: RemoteFailureCode) => {
      slot.cancelCode ??= code; slot.controller.abort();
      if (slot.worker) void this.stopWorker(slot).catch(() => undefined);
    };
    slot.poll = setInterval(() => {
      try {
        const task = slot.source.ownershipSemanticExecutionState(ticket);
        if (task && task.phase !== "dispatched" && task.phase !== "completed") stop(task.code ?? "PROVIDER_FAILED");
        else if (slot.controller.signal.aborted) stop("CANCELLED");
      } catch { stop("CONTEXT_CHANGED"); }
    }, 25);
    slot.deadline = setTimeout(() => stop("TIMEOUT"), 60_000);
  }
  async start(ticket: SemanticReservation): Promise<OwnershipSemanticResultEnvelope> {
    const slot = this.owned(ticket);
    if (!this.execution) throw new OwnershipSemanticExecutionError("NOT_CONFIGURED");
    if (slot.starting || slot.attempted) throw new OwnershipSemanticExecutionError("BUSY"); slot.starting = true; slot.activeOperations++;
    try {
      await slot.source.beginOwnershipSemanticExecution(ticket, prepared => {
        slot.attempted = true; slot.prepared = prepared;
        let worker: Worker;
        try { worker = this.execution!.createWorker(prepared); }
        catch (error) { slot.executionFailure = failure(error); throw slot.executionFailure; }
        if (types.isPromise(worker)) void Promise.prototype.then.call(worker, undefined, () => undefined);
        if (types.isProxy(worker) || !(worker instanceof Worker)) { slot.executionFailure = new OwnershipSemanticExecutionError("PROVIDER_FAILED"); throw slot.executionFailure; } slot.worker = worker;
        slot.response = new Promise<unknown>((resolve, reject) => {
          worker.once("message", resolve); worker.once("error", () => reject(new OwnershipSemanticExecutionError("PROVIDER_FAILED")));
          worker.once("exit", () => reject(new OwnershipSemanticExecutionError("PROVIDER_FAILED")));
        }).then(raw => ({ raw }), error => ({ error: failure(error) }));
        return worker;
      });
      slot.committed = true; this.watch(slot, ticket);
      const outcome = await slot.response!;
      if ("error" in outcome) throw outcome.error;
      if (this.#closed || slot.controller.signal.aborted) throw new OwnershipSemanticExecutionError(slot.cancelCode ?? "CANCELLED");
      // Actual LLM validator uses the exact private WeakMap-bound prepared object,
      // captures raw message before await, and returns deeply frozen response data.
      const response = await validatePreparedOwnershipSemanticResponse(slot.prepared!.prepared as PreparedOwnershipSemanticRequest, outcome.raw);
      if (this.#closed || slot.controller.signal.aborted) throw new OwnershipSemanticExecutionError(slot.cancelCode ?? "CANCELLED");
      await slot.source.publishOwnershipSemanticExecution(ticket, response);
      await this.stopWorker(slot);
      slot.source.releaseOwnershipSemanticExecution(ticket, slot.worker!);
      const published = await slot.source.readPublishedOwnershipSemanticExecution(ticket);
      slot.completed = true; this.clearWaits(slot); return published;
    } catch (error) {
      this.clearWaits(slot);
      const primary = slot.cancelCode ? new OwnershipSemanticExecutionError(slot.cancelCode) : slot.executionFailure ?? failure(error, slot.committed ? "INVALID_RESPONSE" : "PROVIDER_FAILED");
      if (!this.#closed) {
        let cleaned = false;
        try { slot.source.failOwnershipSemanticExecution(ticket, primary.code); cleaned = true; } catch { /* Preserve primary and occupation. */ }
        // A promotion COMMIT failure may leave an actual execution pending. Do
        // not infer stop or auto-repeat; explicit cancel can terminate this worker.
        if (slot.committed && slot.worker) {
          try { await this.stopWorker(slot); if (cleaned) { slot.source.releaseOwnershipSemanticExecution(ticket, slot.worker); slot.released = true; } } catch { /* Keep lease. */ }
        }
      }
      throw primary;
    } finally { slot.activeOperations--; }
  }
  async cancel(ticket?: SemanticReservation): Promise<void> {
    const slot = this.#slot;
    if (this.#closed || !slot || slot.completed || (slot.reserved ? slot.reserved.reservation !== ticket : ticket !== undefined)) throw new OwnershipSemanticExecutionError("POLICY_INVALID");
    slot.activeOperations++;
    try {
      slot.cancelCode = "CANCELLED"; slot.controller.abort();
      if (!slot.reserved) { this.discard(slot); return; }
      if (!slot.starting) { slot.source.cancelOwnershipSemanticReservation(slot.reserved.reservation); this.discard(slot); return; }
      slot.source.failOwnershipSemanticExecution(slot.reserved.reservation, "CANCELLED");
      if (slot.attempted && !slot.worker) throw new OwnershipSemanticExecutionError("POLICY_INVALID");
      if (slot.worker) {
        await this.stopWorker(slot);
        slot.source.releaseOwnershipSemanticExecution(slot.reserved.reservation, slot.worker);
        // Promotion COMMIT failures never become reusable through this local gate.
        if (slot.committed) slot.released = true;
      }
      this.clearWaits(slot);
    } catch (error) { throw failure(error, "POLICY_INVALID"); }
    finally { slot.activeOperations--; }
  }

  read(ticket: SemanticReservation): Promise<OwnershipSemanticResultEnvelope> { const slot = this.owned(ticket); return slot.source.readPublishedOwnershipSemanticExecution(ticket); }
}
