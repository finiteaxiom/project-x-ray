import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import { canonicalJson, IGNORE_POLICY_VERSION, ownershipSemanticPrepareRequestSchema, type OwnershipSemanticPackage,
  type OwnershipSemanticPrepareRequest, type RemoteActivation, type RemoteContext, type RemoteProviderSettings, type OwnershipSemanticAuthorization } from "@project-xray/contracts";
import type { GraphStore } from "./index.js";
import type { OwnershipCapsuleStore } from "./ownership-capsule-store.js";
import type { OwnershipQuestionBindingStore } from "./ownership-question-binding-store.js";

export const SEMANTIC_PREPARATION_TIMEOUT_MS = 30_000;
export type SemanticPreparationCode = "INVALID_INPUT" | "INVALID_MATERIAL" | "NOT_CURRENT" | "NOT_AUTHORIZED" | "NOT_CONFIGURED" | "CONTEXT_CHANGED" | "INVALID_RECEIPT" | "CANCELLED" | "TIMEOUT" | "REQUEST_TOO_LARGE" | "BUSY";
export class OwnershipSemanticPreparationError extends Error {
  constructor(readonly code: SemanticPreparationCode) { super("所有权语义准备失败"); this.name = "OwnershipSemanticPreparationError"; }
}
function fail(code: SemanticPreparationCode = "INVALID_MATERIAL"): never { throw new OwnershipSemanticPreparationError(code); }
export function semanticPreparationFailure(error: unknown): OwnershipSemanticPreparationError {
  if (error instanceof OwnershipSemanticPreparationError) return new OwnershipSemanticPreparationError(error.code);
  const code = error && typeof error === "object" && !nodeTypes.isProxy(error)
    ? Object.getOwnPropertyDescriptor(error, "code")?.value ?? Object.getOwnPropertyDescriptor(error, "diagnosticCode")?.value : null;
  return new OwnershipSemanticPreparationError(code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || code === "BUSY" ? "BUSY"
    : code === "REQUEST_TOO_LARGE" || code === "LIMIT_EXCEEDED" ? "REQUEST_TOO_LARGE"
      : code === "IGNORE_SETTINGS_CONFLICT" || code === "SNAPSHOT_NOT_CURRENT" || code === "NOT_CURRENT" ? "NOT_CURRENT"
        : code === "CONTEXT_CHANGED" ? "CONTEXT_CHANGED" : "INVALID_MATERIAL");
}
export function captureSemanticPrepareRequest(raw: unknown): OwnershipSemanticPrepareRequest {
  try {
    if (!raw || typeof raw !== "object" || nodeTypes.isProxy(raw) || Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) fail("INVALID_INPUT");
    const keys = Reflect.ownKeys(raw); if (keys.length !== 5 || keys.some(key => typeof key !== "string")) fail("INVALID_INPUT");
    const copy: Record<string, string> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") fail("INVALID_INPUT");
      copy[key] = descriptor.value;
    }
    return ownershipSemanticPrepareRequestSchema.parse(copy);
  } catch { return fail("INVALID_INPUT"); }
}
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export function checkSemanticAbort(signal: AbortSignal): void {
  if (signal.aborted) fail(signal.reason instanceof OwnershipSemanticPreparationError && signal.reason.code === "TIMEOUT" ? "TIMEOUT" : "CANCELLED");
}
export function awaitSemanticStep<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); try { checkSemanticAbort(signal); } catch (error) { reject(error); } };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { cleanup(); try { checkSemanticAbort(signal); resolve(value); } catch (error) { reject(error); } }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
export interface SemanticMainCapture { readonly generation: number; readonly reference: { repositoryId: string; snapshotId: string; activation: string } }
/** Constructed only by XRayApplication from its actual state/mapping and compiled adapter. */
export interface OwnershipSemanticTrustedPorts {
  readonly adapter: (input: { semanticPackage: OwnershipSemanticPackage; submittedAnswer: string }) => Promise<{ readonly serializedRequest: string; readonly requestBytes: number; readonly responseSchema: unknown }>;
  readonly main: {
    capture(request: OwnershipSemanticPrepareRequest, authority: GraphStore, settings: GraphStore, source: GraphStore): SemanticMainCapture;
    assert(captured: SemanticMainCapture, request: OwnershipSemanticPrepareRequest, authority: GraphStore, settings: GraphStore, source: GraphStore): void;
    checkWorkspace(request: OwnershipSemanticPrepareRequest, signal: AbortSignal): Promise<{ status: string }>;
  };
}
type CapsuleCapture = ReturnType<OwnershipCapsuleStore["captureForSemanticPreparation"]>;
type BindingCapture = ReturnType<OwnershipQuestionBindingStore["captureForSemanticPreparation"]>;
interface Capture { capsule: CapsuleCapture; binding: BindingCapture; preimage: string }
interface GlobalIdentity { context: RemoteContext; provider: RemoteProviderSettings; authorization: OwnershipSemanticAuthorization; activation: RemoteActivation; ignoreRevision: number }
declare const preparedBrand: unique symbol;
declare const receiptBrand: unique symbol;
export type PreparedSemanticBinding = Readonly<{ [preparedBrand]: true }>;
export type SemanticRevisionReceipt = Readonly<{ [receiptBrand]: true }>;
export interface ConsumedSemanticPreparation {
  readonly assessmentPackageId: string; readonly adapterRequestDigest: string; readonly requestBytes: number;
  readonly provider: "openai"; readonly model: string; readonly outputTokens: number; readonly preparedReference: PreparedSemanticBinding;
}
interface Prepared {
  request: OwnershipSemanticPrepareRequest; authority: GraphStore; settings: GraphStore; main: SemanticMainCapture; identity: GlobalIdentity;
  capture: Capture; adapter: { serializedRequest: string; requestBytes: number; responseSchema: unknown }; adapterRequestDigest: string;
  assessmentPackageId: string; signal: AbortSignal; expiresAt: number;
}
interface Revision { prepared: Prepared; token: PreparedSemanticBinding; consumed: boolean }
function assertSynchronous(value: unknown): void {
  if (!value || typeof value !== "object" && typeof value !== "function") return;
  if (nodeTypes.isProxy(value)) fail("INVALID_RECEIPT");
  if (nodeTypes.isPromise(value)) { void Promise.prototype.then.call(value, undefined, () => undefined); fail("INVALID_RECEIPT"); }
  let object: object | null = value;
  for (let depth = 0; object && depth < 32; depth++, object = Object.getPrototypeOf(object)) {
    if (nodeTypes.isProxy(object) || Object.getOwnPropertyDescriptor(object, "then")) fail("INVALID_RECEIPT");
  }
  if (object) fail("INVALID_RECEIPT");
}

/** No migration, task/slot/result writes, credentials, transport or caller-provided validation. */
export class OwnershipSemanticPreparationStore {
  #closed = false;
  #prepared = new WeakMap<object, Prepared>();
  #revisions = new WeakMap<object, Revision>();
  private readonly ports: OwnershipSemanticTrustedPorts | undefined;
  constructor(private readonly db: Database.Database, private readonly owner: GraphStore,
    private readonly capture: (attemptId: string) => Capture,
    private readonly validate: (capture: CapsuleCapture) => Promise<OwnershipSemanticPackage>, ports?: OwnershipSemanticTrustedPorts) {
    this.ports = ports ? Object.freeze({ adapter: ports.adapter, main: Object.freeze({ ...ports.main }) }) : undefined;
  }
  close(): void { this.#closed = true; this.#prepared = new WeakMap(); this.#revisions = new WeakMap(); }
  revoke(token: PreparedSemanticBinding): void { this.#prepared.delete(token); }
  private open(): void { if (this.#closed || !this.db.open) fail("INVALID_RECEIPT"); if (!this.ports) fail("NOT_CONFIGURED"); }
  private identity(request: OwnershipSemanticPrepareRequest, authority: GraphStore, settings: GraphStore): GlobalIdentity {
    if (authority.remote.role !== "global") fail("NOT_AUTHORIZED");
    const context = authority.remote.context(request.contextHandle), provider = authority.remote.provider(), authorization = authority.loadOwnershipSemanticAuthorization(request.repositoryId);
    if (context.reference?.repositoryId !== request.repositoryId || context.reference.snapshotId !== request.snapshotId) fail("CONTEXT_CHANGED");
    if (authorization.status !== "granted" || authorization.purpose !== request.purpose || authorization.provider !== provider.provider) fail("NOT_AUTHORIZED");
    if (!provider.model || provider.credentialStatus !== "configured") fail("NOT_CONFIGURED");
    const activation = this.owner.remote.activation(request.repositoryId, request.snapshotId), ignore = settings.loadIgnoreSettings(request.repositoryId);
    if (!equal(activation, context.reference)) fail("NOT_CURRENT");
    if (activation.ignorePolicyHash ? digest(JSON.stringify([IGNORE_POLICY_VERSION, ignore.rules])) !== activation.ignorePolicyHash : ignore.rules.length > 0) fail("NOT_CURRENT");
    return structuredClone({ context, provider, authorization, activation, ignoreRevision: ignore.revision });
  }
  private current(prepared: Prepared): void {
    this.open(); checkSemanticAbort(prepared.signal); if (Date.now() > prepared.expiresAt) fail("TIMEOUT");
    this.ports!.main.assert(prepared.main, prepared.request, prepared.authority, prepared.settings, this.owner);
    if (!equal(this.identity(prepared.request, prepared.authority, prepared.settings), prepared.identity)) fail("CONTEXT_CHANGED");
    const actual = this.capture(prepared.request.attemptId);
    if (actual.preimage !== prepared.capture.preimage || !actual.capsule.material.current || actual.capsule.material.activation !== prepared.identity.activation.activation) fail("INVALID_MATERIAL");
    if (digest(prepared.adapter.serializedRequest) !== prepared.adapterRequestDigest || Buffer.byteLength(prepared.adapter.serializedRequest, "utf8") !== prepared.adapter.requestBytes) fail();
  }
  async prepare(raw: OwnershipSemanticPrepareRequest, authority: GraphStore, settings: GraphStore, signal: AbortSignal): Promise<PreparedSemanticBinding> {
    try {
      this.open(); const request = captureSemanticPrepareRequest(raw); checkSemanticAbort(signal);
      const main = structuredClone(this.ports!.main.capture(request, authority, settings, this.owner));
      const identity = authority.withOwnershipSemanticAuthorityLock(() => this.identity(request, authority, settings));
      if (!equal(main.reference, { repositoryId: request.repositoryId, snapshotId: request.snapshotId, activation: identity.activation.activation })) fail("CONTEXT_CHANGED");
      const checkWorkspace = async () => {
        const state = await awaitSemanticStep(this.ports!.main.checkWorkspace(request, signal), signal);
        if (state.status !== "current") fail("NOT_CURRENT"); this.open();
        this.ports!.main.assert(main, request, authority, settings, this.owner);
      };
      await checkWorkspace();
      const captured = this.db.transaction(() => this.capture(request.attemptId)).deferred();
      if (captured.capsule.attempt.repositoryId !== request.repositoryId || captured.capsule.attempt.snapshotId !== request.snapshotId || !captured.capsule.material.current
        || captured.capsule.material.activation !== identity.activation.activation) fail("NOT_CURRENT");
      const semanticPackage = await awaitSemanticStep(this.validate(captured.capsule), signal);
      const adapter = await awaitSemanticStep(this.ports!.adapter({ semanticPackage, submittedAnswer: captured.capsule.attempt.semanticText }), signal);
      const bytes = Buffer.byteLength(adapter.serializedRequest, "utf8");
      if (bytes > 65536 || adapter.requestBytes !== bytes) fail("REQUEST_TOO_LARGE");
      const body = JSON.parse(adapter.serializedRequest);
      if (body.protocolVersion !== "ownership-semantic-assessment/1.0.0" || Object.keys(body).sort().join() !== "data,protocolVersion,responseSchema,systemInstructions"
        || !equal(body.data?.semanticPackage, semanticPackage) || !equal(body.responseSchema, adapter.responseSchema) || typeof body.systemInstructions !== "string") fail();
      await checkWorkspace();
      const prepared: Prepared = { request, authority, settings, main, identity, capture: captured, adapter: structuredClone(adapter),
        adapterRequestDigest: digest(adapter.serializedRequest), assessmentPackageId: semanticPackage.assessmentPackageId, signal, expiresAt: Date.now() + SEMANTIC_PREPARATION_TIMEOUT_MS };
      this.db.transaction(() => this.current(prepared)).deferred();
      const token = Object.freeze(Object.create(null)) as PreparedSemanticBinding; this.#prepared.set(token, prepared); return token;
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  withRevisions<T>(token: PreparedSemanticBinding, work: (receipt: SemanticRevisionReceipt) => T): T {
    try {
      this.open(); const prepared = this.#prepared.get(token); if (!prepared) fail("INVALID_RECEIPT");
      this.#prepared.delete(token);
      return prepared.authority.withOwnershipSemanticAuthorityLock(() => prepared.settings.withIgnoreRevision(prepared.request.repositoryId, prepared.identity.ignoreRevision, () => this.db.transaction(() => {
        this.current(prepared);
        const receipt = Object.freeze(Object.create(null)) as SemanticRevisionReceipt;
        const revision: Revision = { prepared, token, consumed: false }; this.#revisions.set(receipt, revision);
        try {
          const result = work(receipt); assertSynchronous(result);
          if (!revision.consumed) fail("INVALID_RECEIPT"); this.current(prepared); return result;
        } finally { this.#revisions.delete(receipt); }
      }).immediate()));
    } catch (error) { throw semanticPreparationFailure(error); }
  }
  consume(receipt: SemanticRevisionReceipt): ConsumedSemanticPreparation {
    try {
      this.open(); const revision = this.#revisions.get(receipt); if (!revision || revision.consumed || !this.db.inTransaction) fail("INVALID_RECEIPT");
      revision.consumed = true; this.current(revision.prepared);
      const { prepared, token } = revision;
      return Object.freeze({ assessmentPackageId: prepared.assessmentPackageId, adapterRequestDigest: prepared.adapterRequestDigest, requestBytes: prepared.adapter.requestBytes,
        provider: prepared.identity.provider.provider, model: prepared.identity.provider.model!, outputTokens: prepared.identity.provider.outputTokens, preparedReference: token });
    } catch (error) { throw semanticPreparationFailure(error); }
  }
}
