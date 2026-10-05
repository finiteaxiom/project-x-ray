import { captureSemanticPrepareRequest, OwnershipSemanticPreparationError, SEMANTIC_PREPARATION_TIMEOUT_MS, semanticPreparationFailure,
  type GraphStore, type PreparedSemanticReservation, type SemanticReservation, type SemanticReservedMetadata } from "@project-xray/graph";
import type { OwnershipSemanticPrepareRequest } from "@project-xray/contracts";

interface Slot {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  detach: () => void;
  source: GraphStore;
  prepared?: PreparedSemanticReservation;
  reserved?: SemanticReservedMetadata;
}
/** Local reservation orchestration. No identity/body/adapter/currentness callback
 * is accepted; GraphStore retains all trusted material and owns the durable commit. */
export class OwnershipSemanticReservationApplication {
  #closed = false;
  #slot: Slot | null = null;
  constructor(private readonly authority: GraphStore,
    private readonly stores: (request: OwnershipSemanticPrepareRequest) => { source: GraphStore; settings: GraphStore }) {}
  private release(slot: Slot): void {
    clearTimeout(slot.timer); slot.detach();
    if (slot.prepared) slot.source.revokeOwnershipSemanticReservationPreparation(slot.prepared);
    if (slot.reserved) slot.source.revokeOwnershipSemanticReservation(slot.reserved.reservation);
    slot.controller.abort(); if (this.#slot === slot) this.#slot = null;
  }
  close(): void { this.#closed = true; if (this.#slot) this.release(this.#slot); }
  async prepare(raw: OwnershipSemanticPrepareRequest, options: { signal?: AbortSignal } = {}): Promise<PreparedSemanticReservation> {
    if (this.#closed) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    const request = captureSemanticPrepareRequest(raw), { source, settings } = this.stores(request);
    if (this.#slot?.reserved) throw new OwnershipSemanticPreparationError("BUSY");
    if (this.#slot) this.release(this.#slot);
    const controller = new AbortController(), signal = options.signal;
    const cancel = () => controller.abort(); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    const slot: Slot = { controller, source, timer: setTimeout(() => controller.abort(new OwnershipSemanticPreparationError("TIMEOUT")), SEMANTIC_PREPARATION_TIMEOUT_MS), detach: () => signal?.removeEventListener("abort", cancel) };
    this.#slot = slot;
    try {
      const prepared = await source.prepareOwnershipSemanticReservation(request, this.authority, settings, controller.signal);
      if (this.#closed || this.#slot !== slot || controller.signal.aborted) { source.revokeOwnershipSemanticReservationPreparation(prepared); throw new OwnershipSemanticPreparationError("CANCELLED"); }
      slot.prepared = prepared; clearTimeout(slot.timer); return prepared;
    } catch (error) { this.release(slot); throw semanticPreparationFailure(error); }
  }
  reserve(prepared: PreparedSemanticReservation): SemanticReservedMetadata {
    const slot = this.#slot;
    if (this.#closed || !slot || slot.prepared !== prepared || slot.reserved) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    try {
      const reserved = slot.source.reserveOwnershipSemantic(prepared);
      delete slot.prepared; slot.reserved = reserved; return reserved;
    } catch (error) { this.release(slot); throw semanticPreparationFailure(error); }
  }
  cancel(ticket?: SemanticReservation): void {
    const slot = this.#slot;
    if (this.#closed || !slot || (slot.reserved ? slot.reserved.reservation !== ticket : ticket !== undefined)) throw new OwnershipSemanticPreparationError("INVALID_RECEIPT");
    if (slot.reserved) slot.source.cancelOwnershipSemanticReservation(slot.reserved.reservation);
    // A terminal/release/COMMIT failure leaves both the ticket and occupation intact.
    this.release(slot);
  }
}
