import { z } from "zod";
import {
  OWNERSHIP_SEMANTIC_VERSION,
  ownershipSemanticResponseSchema,
  type OwnershipSemanticResponse,
} from "./ownership-semantics.js";
import { remoteHashSchema, remoteTimeSchema, remoteUtf8Bytes } from "./remote-explanation.js";
import {
  ownershipSemanticCapturedIdentitySchema,
  ownershipSemanticTaskRecordSchema,
  type OwnershipSemanticCapturedIdentity,
} from "./ownership-semantic-task.js";
import { canonicalJson } from "./snapshot-content.js";

export const OWNERSHIP_SEMANTIC_RESULT_VERSION = "1.0.0";
export const OWNERSHIP_SEMANTIC_RESULT_LIMITS = Object.freeze({
  responseBytes: 256 * 1024,
  envelopeBytes: 272 * 1024,
});

const resultInputSchema = z.object({
  identity: ownershipSemanticCapturedIdentitySchema,
  createdAt: remoteTimeSchema,
  completedAt: remoteTimeSchema,
  response: ownershipSemanticResponseSchema,
}).strict();

export const ownershipSemanticResultEnvelopeSchema = z.object({
  version: z.literal(OWNERSHIP_SEMANTIC_RESULT_VERSION),
  identity: ownershipSemanticCapturedIdentitySchema,
  createdAt: remoteTimeSchema,
  completedAt: remoteTimeSchema,
  bindingHash: remoteHashSchema,
  responseDigest: remoteHashSchema,
  response: ownershipSemanticResponseSchema,
}).strict();

export type OwnershipSemanticResultInput = z.input<typeof resultInputSchema>;
export type OwnershipSemanticResultEnvelope = z.infer<typeof ownershipSemanticResultEnvelopeSchema>;

const ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "Ownership semantic result input is invalid",
  INVALID_RESULT: "Ownership semantic result is invalid",
  LIMIT_EXCEEDED: "Ownership semantic result exceeds its byte limit",
  DIGEST_MISMATCH: "Ownership semantic result digest does not match",
  HASH_FAILURE: "Ownership semantic result digest could not be computed",
});

export type OwnershipSemanticResultErrorCode = keyof typeof ERROR_MESSAGES;

export class OwnershipSemanticResultError extends Error {
  constructor(readonly code: OwnershipSemanticResultErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "OwnershipSemanticResultError";
  }
}

type CapturedJson = null | boolean | number | string | CapturedJson[] | { [key: string]: CapturedJson };

function fail(code: OwnershipSemanticResultErrorCode): never {
  throw new OwnershipSemanticResultError(code);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function captureJsonValue(value: unknown, active: WeakSet<object>, code: OwnershipSemanticResultErrorCode): CapturedJson {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) fail(code);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(code);
    return value;
  }
  if (typeof value !== "object") fail(code);

  const object = value as object;
  if (active.has(object)) fail(code);
  active.add(object);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) fail(code);
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0 || keys.length !== lengthDescriptor.value + 1 || !keys.includes("length")) fail(code);

      const copy: CapturedJson[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(code);
        copy.push(captureJsonValue(descriptor.value, active, code));
      }
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= lengthDescriptor.value) fail(code);
      }
      return copy;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(code);
    const keys = Reflect.ownKeys(value);
    const copy = Object.create(null) as Record<string, CapturedJson>;
    for (const key of keys) {
      if (typeof key !== "string" || !isWellFormedUnicode(key)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(code);
      Object.defineProperty(copy, key, {
        value: captureJsonValue(descriptor.value, active, code),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return copy;
  } finally {
    active.delete(object);
  }
}

/** Copies plain JSON data without evaluating getters or toJSON methods. */
function capturePrivateJson(value: unknown, code: OwnershipSemanticResultErrorCode): CapturedJson {
  try {
    return captureJsonValue(value, new WeakSet<object>(), code);
  } catch (error) {
    if (error instanceof OwnershipSemanticResultError) throw error;
    return fail(code);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}

function parseInput(raw: unknown): OwnershipSemanticResultInput {
  const captured = capturePrivateJson(raw, "INVALID_INPUT");
  const parsed = resultInputSchema.safeParse(captured);
  if (!parsed.success) fail("INVALID_INPUT");
  return deepFreeze(parsed.data);
}

function parseEnvelope(raw: unknown): OwnershipSemanticResultEnvelope {
  const captured = capturePrivateJson(raw, "INVALID_RESULT");
  const parsed = ownershipSemanticResultEnvelopeSchema.safeParse(captured);
  if (!parsed.success) fail("INVALID_RESULT");
  return deepFreeze(parsed.data);
}

function assertResponseRelations(
  identity: OwnershipSemanticCapturedIdentity,
  createdAt: string,
  completedAt: string,
  response: OwnershipSemanticResponse,
  errorCode: "INVALID_INPUT" | "INVALID_RESULT",
): string {
  const completedTask = ownershipSemanticTaskRecordSchema.safeParse({
    identity,
    phase: "completed",
    createdAt,
    completedAt,
    code: null,
  });
  if (!completedTask.success || response.assessmentPackageId !== identity.assessmentPackageId
    || response.version !== OWNERSHIP_SEMANTIC_VERSION) fail(errorCode);

  const criterionIds = new Set<string>();
  for (const criterion of response.criteria) {
    if (criterionIds.has(criterion.criterionId)
      || new Set(criterion.evidenceIds).size !== criterion.evidenceIds.length
      || new Set(criterion.limitationIds).size !== criterion.limitationIds.length
      || new Set(criterion.answerRanges.map(range => `${range.start}:${range.end}`)).size !== criterion.answerRanges.length) {
      fail(errorCode);
    }
    criterionIds.add(criterion.criterionId);
  }

  const canonicalResponse = canonicalJson(response);
  if (remoteUtf8Bytes(canonicalResponse) > OWNERSHIP_SEMANTIC_RESULT_LIMITS.responseBytes) fail("LIMIT_EXCEEDED");
  return canonicalResponse;
}

function bindingProjection(identity: OwnershipSemanticCapturedIdentity): Record<string, unknown> {
  const { taskId: _taskId, ownerSessionId: _ownerSessionId, contextHandle: _contextHandle, contextEpoch: _contextEpoch, ...binding } = identity;
  return binding;
}

async function digestUtf8(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return fail("HASH_FAILURE");
  }
}

async function digestCanonical(value: unknown): Promise<string> {
  return digestUtf8(canonicalJson(value));
}

function assertEnvelopeByteLimit(value: OwnershipSemanticResultEnvelope): void {
  if (remoteUtf8Bytes(canonicalJson(value)) > OWNERSHIP_SEMANTIC_RESULT_LIMITS.envelopeBytes) fail("LIMIT_EXCEEDED");
}

/**
 * Builds a structurally valid result candidate and computes both internal digests.
 * This does not validate an exact prepared response or grant publication authority.
 */
export async function buildOwnershipSemanticResultEnvelope(raw: OwnershipSemanticResultInput): Promise<OwnershipSemanticResultEnvelope> {
  const input = parseInput(raw);
  const canonicalResponse = assertResponseRelations(input.identity, input.createdAt, input.completedAt, input.response, "INVALID_INPUT");

  const bindingHash = await digestCanonical(bindingProjection(input.identity));
  const responseDigest = await digestUtf8(canonicalResponse);
  const parsed = ownershipSemanticResultEnvelopeSchema.safeParse({
    version: OWNERSHIP_SEMANTIC_RESULT_VERSION,
    identity: input.identity,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    bindingHash,
    responseDigest,
    response: input.response,
  });
  if (!parsed.success) fail("INVALID_INPUT");
  assertEnvelopeByteLimit(parsed.data);
  return deepFreeze(parsed.data);
}

/**
 * Validates shape, completion time, internal response binding, byte budgets, and both digests.
 * It does not establish provenance, exact prepared-response approval, currentness, or publication.
 */
export async function validateOwnershipSemanticResultEnvelope(raw: unknown): Promise<OwnershipSemanticResultEnvelope> {
  const envelope = parseEnvelope(raw);
  const canonicalResponse = assertResponseRelations(envelope.identity, envelope.createdAt, envelope.completedAt, envelope.response, "INVALID_RESULT");
  assertEnvelopeByteLimit(envelope);

  const expectedBindingHash = await digestCanonical(bindingProjection(envelope.identity));
  const expectedResponseDigest = await digestUtf8(canonicalResponse);
  if (envelope.bindingHash !== expectedBindingHash || envelope.responseDigest !== expectedResponseDigest) fail("DIGEST_MISMATCH");
  return deepFreeze(envelope);
}
