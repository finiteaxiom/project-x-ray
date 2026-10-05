import { captureSemanticPrepareRequest, OwnershipSemanticPreparationError, SEMANTIC_PREPARATION_TIMEOUT_MS, semanticPreparationFailure,
  type GraphStore, type PreparedSemanticBinding, type SemanticRevisionReceipt } from "@project-xray/graph";
import type { OwnershipSemanticPrepareRequest } from "@project-xray/contracts";

interface Slot { controller: AbortController; timer: ReturnType<typeof setTimeout>; detach: () => void; source: GraphStore; prepared?: PreparedSemanticBinding }
/** Trusted factory-only local preparation; the constructor receives no adapter or success callback. */
export class OwnershipSemanticPreparationApplication {
  #closed = false;
  #slot: Slot | null = null;
  constructor(private readonly authority: GraphStore, private readonly stores: (request: OwnershipSemanticPrepareRequest) => { source: GraphStore; settings: GraphStore }) {}
  private release(slot: Slot): void {
    clearTimeout(slot.timer); slot.detach();
    if (slot.prepared) slot.source.revokeOwnershipSemanticBinding(slot.prepared);
    slot.controller.abort(); if (this.#slot === slot) this.#slot = null;
  }
  close(): void { this.#closed = true; if (this.#slot) this.release(this.#slot); }
  async prepare(raw: OwnershipSemanticPrepareRequest, options: { signal?: AbortSignal } = {}): Promise<PreparedSemanticBinding> {
    if (this.#closed) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    const request = captureSemanticPrepareRequest(raw), { source, settings } = this.stores(request);
    if (this.#slot) this.release(this.#slot);
    const controller = new AbortController(), signal = options.signal;
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    const slot: Slot = { controller, source, timer: setTimeout(() => controller.abort(new OwnershipSemanticPreparationError("TIMEOUT")), SEMANTIC_PREPARATION_TIMEOUT_MS), detach: () => signal?.removeEventListener("abort", cancel) };
    this.#slot = slot;
    try {
      const prepared = await source.prepareOwnershipSemanticBinding(request, this.authority, settings, controller.signal);
      if (this.#closed || this.#slot !== slot || controller.signal.aborted) { source.revokeOwnershipSemanticBinding(prepared); throw new OwnershipSemanticPreparationError("CANCELLED"); }
      slot.prepared = prepared; clearTimeout(slot.timer); return prepared;
    } catch (error) { this.release(slot); throw semanticPreparationFailure(error); }
  }
  withRevisions<T>(token: PreparedSemanticBinding, work: (receipt: SemanticRevisionReceipt) => T): T {
    const slot = this.#slot;
    if (this.#closed || !slot || slot.prepared !== token) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    try { return slot.source.withOwnershipSemanticRevisions(token, work); } finally { this.release(slot); }
  }
  consume(receipt: SemanticRevisionReceipt) {
    if (this.#closed || !this.#slot?.prepared) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    return this.#slot.source.consumeOwnershipSemanticRevision(receipt);
  }
}
