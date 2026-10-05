import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";
import {
  OWNERSHIP_SEMANTIC_LIMITS,
  OWNERSHIP_SEMANTIC_PURPOSE,
  OWNERSHIP_SEMANTIC_VERSION,
  REMOTE_LIMITS,
  canonicalJson,
  remoteModelSchema,
  remoteUtf8Bytes,
  type OwnershipSemanticPackage,
} from "@project-xray/contracts";
import {
  OWNERSHIP_SEMANTIC_RESPONSE_JSON_SCHEMA,
  OwnershipSemanticPromptError,
  prepareOwnershipSemanticRequest,
  type PreparedOwnershipSemanticRequest,
} from "./ownership-semantic-prompt.js";

const RESPONSES_SCHEMA_NAME = "xray_ownership_semantic_assessment_v1";
const HASH_PATTERN = "^[0-9a-f]{64}$";
const ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "Ownership semantic Responses input is invalid",
  INVALID_PACKAGE: "Ownership semantic package is invalid",
  INVALID_PREPARED_REQUEST: "Ownership semantic prepared request is invalid",
  PROMPT_REQUEST_TOO_LARGE: "Ownership semantic prompt exceeds its byte limit",
  REQUEST_TOO_LARGE: "Ownership semantic Responses body exceeds its byte limit",
});

export type OwnershipSemanticResponsesErrorCode = keyof typeof ERROR_MESSAGES;

export class OwnershipSemanticResponsesError extends Error {
  constructor(readonly code: OwnershipSemanticResponsesErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "OwnershipSemanticResponsesError";
  }
}

export interface OwnershipSemanticResponsesInput {
  readonly semanticPackage: OwnershipSemanticPackage;
  readonly submittedAnswer: string;
  readonly model: string;
  readonly maxOutputTokens?: number;
}

export interface PreparedOwnershipSemanticResponsesRequest {
  readonly body: string;
  readonly bodyDigest: string;
  readonly requestBytes: number;
  /** This exact reference is bound to the existing prompt validator's private WeakMap. */
  readonly prepared: PreparedOwnershipSemanticRequest;
}

type PlainRecord = Record<string, unknown>;
type ProviderSchema = Record<string, unknown>;

function fail(code: OwnershipSemanticResponsesErrorCode): never {
  throw new OwnershipSemanticResponsesError(code);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) || nodeTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(key => typeof key === "string" && expected.includes(key));
}

function ownEnumerableDataValue(value: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("INVALID_INPUT");
  return descriptor.value;
}

interface CapturedInput {
  readonly semanticPackage: OwnershipSemanticPackage;
  readonly submittedAnswer: string;
  readonly model: string;
  readonly maxOutputTokens: number;
}

function captureInput(input: unknown): CapturedInput {
  if (!isPlainRecord(input)) fail("INVALID_INPUT");
  const keys = Reflect.ownKeys(input);
  const hasOutputLimit = keys.some(key => key === "maxOutputTokens");
  const expected = hasOutputLimit
    ? ["semanticPackage", "submittedAnswer", "model", "maxOutputTokens"]
    : ["semanticPackage", "submittedAnswer", "model"];
  if (!hasExactKeys(input, expected)) fail("INVALID_INPUT");

  const semanticPackage = ownEnumerableDataValue(input, "semanticPackage");
  const submittedAnswer = ownEnumerableDataValue(input, "submittedAnswer");
  const model = ownEnumerableDataValue(input, "model");
  const maxOutputTokens = hasOutputLimit
    ? ownEnumerableDataValue(input, "maxOutputTokens")
    : REMOTE_LIMITS.outputTokens;

  if (semanticPackage === null || typeof semanticPackage !== "object" || Array.isArray(semanticPackage) || nodeTypes.isProxy(semanticPackage)) fail("INVALID_INPUT");
  if (typeof submittedAnswer !== "string") fail("INVALID_INPUT");
  const parsedModel = remoteModelSchema.safeParse(model);
  if (!parsedModel.success) fail("INVALID_INPUT");
  if (typeof maxOutputTokens !== "number" || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > REMOTE_LIMITS.outputTokens) fail("INVALID_INPUT");

  return {
    semanticPackage: semanticPackage as OwnershipSemanticPackage,
    submittedAnswer,
    model: parsedModel.data,
    maxOutputTokens,
  };
}

function schemaRecord(value: unknown, keys: readonly string[]): PlainRecord {
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail("INVALID_PREPARED_REQUEST");
  return value;
}

function expectEqual(value: unknown, expected: unknown): void {
  if (value !== expected) fail("INVALID_PREPARED_REQUEST");
}

function expectStringArray(value: unknown, expected: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== expected.length) fail("INVALID_PREPARED_REQUEST");
  if (value.some((item, index) => item !== expected[index])) fail("INVALID_PREPARED_REQUEST");
}

function expectStringField(schema: unknown, keys: readonly string[], minimum: number, maximum: number, pattern?: string): void {
  const stringSchema = schemaRecord(schema, keys);
  expectEqual(stringSchema.type, "string");
  expectEqual(stringSchema.minLength, minimum);
  expectEqual(stringSchema.maxLength, maximum);
  if (pattern !== undefined) expectEqual(stringSchema.pattern, pattern);
}

function expectArrayField(
  schema: unknown,
  keys: readonly string[],
  minimum: number,
  maximum: number,
  uniqueItems: boolean | null,
): PlainRecord {
  const arraySchema = schemaRecord(schema, keys);
  expectEqual(arraySchema.type, "array");
  expectEqual(arraySchema.minItems, minimum);
  expectEqual(arraySchema.maxItems, maximum);
  if (uniqueItems !== null) expectEqual(arraySchema.uniqueItems, uniqueItems);
  return arraySchema;
}

function projectAnswerRanges(schema: unknown, minimum: number): ProviderSchema {
  const ranges = expectArrayField(schema, ["type", "minItems", "maxItems", "items"], minimum, 8, null);
  const item = schemaRecord(ranges.items, ["type", "additionalProperties", "required", "properties"]);
  expectEqual(item.type, "object");
  expectEqual(item.additionalProperties, false);
  expectStringArray(item.required, ["start", "end"]);
  const properties = schemaRecord(item.properties, ["start", "end"]);
  const start = schemaRecord(properties.start, ["type", "minimum", "maximum"]);
  expectEqual(start.type, "integer"); expectEqual(start.minimum, 0); expectEqual(start.maximum, 16384);
  const end = schemaRecord(properties.end, ["type", "minimum", "maximum"]);
  expectEqual(end.type, "integer"); expectEqual(end.minimum, 1); expectEqual(end.maximum, 16384);
  return {
    type: "array", minItems: minimum, maxItems: 8,
    items: {
      type: "object", additionalProperties: false, required: ["start", "end"],
      properties: { start: { type: "integer", minimum: 0, maximum: 16384 }, end: { type: "integer", minimum: 1, maximum: 16384 } },
    },
  };
}

function projectCriterionVariant(
  schema: unknown,
  verdict: "supported" | "contradicted" | "insufficient",
  evidenceMinimum: number,
  limitationMinimum: number,
  limitationMaximum: number,
  rangeMinimum: number,
): ProviderSchema {
  const branch = schemaRecord(schema, ["type", "additionalProperties", "required", "properties"]);
  expectEqual(branch.type, "object");
  expectEqual(branch.additionalProperties, false);
  expectStringArray(branch.required, ["criterionId", "verdict", "explanation", "evidenceIds", "limitationIds", "answerRanges"]);
  const properties = schemaRecord(branch.properties, ["criterionId", "verdict", "explanation", "evidenceIds", "limitationIds", "answerRanges"]);

  expectStringField(properties.criterionId, ["type", "minLength", "maxLength"], 1, 128);
  const verdictSchema = schemaRecord(properties.verdict, ["const"]);
  expectEqual(verdictSchema.const, verdict);
  expectStringField(properties.explanation, ["type", "minLength", "maxLength"], 1, 1200);

  const evidenceIds = expectArrayField(properties.evidenceIds, ["type", "minItems", "maxItems", "uniqueItems", "items"], evidenceMinimum, 8, true);
  expectStringField(evidenceIds.items, ["type", "minLength", "maxLength"], 1, 128);

  const limitationIds = expectArrayField(properties.limitationIds, ["type", "minItems", "maxItems", "uniqueItems", "items"], limitationMinimum, limitationMaximum, true);
  expectStringField(limitationIds.items, ["type", "minLength", "maxLength", "pattern"], 64, 64, HASH_PATTERN);

  return {
    type: "object", additionalProperties: false,
    required: ["criterionId", "verdict", "explanation", "evidenceIds", "limitationIds", "answerRanges"],
    properties: {
      criterionId: { type: "string" },
      verdict: { type: "string", enum: [verdict] },
      explanation: { type: "string" },
      evidenceIds: { type: "array", minItems: evidenceMinimum, maxItems: 8, items: { type: "string" } },
      limitationIds: { type: "array", minItems: limitationMinimum, maxItems: limitationMaximum, items: { type: "string", pattern: HASH_PATTERN } },
      answerRanges: projectAnswerRanges(properties.answerRanges, rangeMinimum),
    },
  };
}

/** Explicit projection of the one frozen internal response schema, not a generic JSON Schema converter. */
function projectSemanticResponseSchema(source: unknown): ProviderSchema {
  const root = schemaRecord(source, ["type", "additionalProperties", "required", "properties"]);
  expectEqual(root.type, "object");
  expectEqual(root.additionalProperties, false);
  expectStringArray(root.required, ["version", "assessmentPackageId", "criteria"]);
  const properties = schemaRecord(root.properties, ["version", "assessmentPackageId", "criteria"]);

  const version = schemaRecord(properties.version, ["const"]);
  expectEqual(version.const, OWNERSHIP_SEMANTIC_VERSION);
  const packageId = schemaRecord(properties.assessmentPackageId, ["type", "minLength", "maxLength", "pattern"]);
  expectEqual(packageId.type, "string"); expectEqual(packageId.minLength, 64); expectEqual(packageId.maxLength, 64); expectEqual(packageId.pattern, HASH_PATTERN);

  const criteria = expectArrayField(properties.criteria, ["type", "minItems", "maxItems", "items"], 1, 8, null);
  const items = schemaRecord(criteria.items, ["oneOf"]);
  if (!Array.isArray(items.oneOf) || items.oneOf.length !== 3) fail("INVALID_PREPARED_REQUEST");
  const projectedAlternatives = [
    projectCriterionVariant(items.oneOf[0], "supported", 1, 0, 0, 1),
    projectCriterionVariant(items.oneOf[1], "contradicted", 1, 0, 0, 1),
    projectCriterionVariant(items.oneOf[2], "insufficient", 0, 1, 8, 0),
  ];

  return {
    type: "object", additionalProperties: false,
    required: ["version", "assessmentPackageId", "criteria"],
    properties: {
      version: { type: "string", enum: [OWNERSHIP_SEMANTIC_VERSION] },
      assessmentPackageId: { type: "string", pattern: HASH_PATTERN },
      criteria: { type: "array", minItems: 1, maxItems: 8, items: { anyOf: projectedAlternatives } },
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

interface PreparedPromptContent {
  readonly instructions: string;
  readonly inputText: string;
}

function readPreparedPrompt(prepared: PreparedOwnershipSemanticRequest): PreparedPromptContent {
  if (!Object.isFrozen(prepared) || prepared.responseSchema !== OWNERSHIP_SEMANTIC_RESPONSE_JSON_SCHEMA) fail("INVALID_PREPARED_REQUEST");
  if (typeof prepared.serializedRequest !== "string" || prepared.requestBytes !== remoteUtf8Bytes(prepared.serializedRequest) || prepared.requestBytes > OWNERSHIP_SEMANTIC_LIMITS.requestBytes) fail("INVALID_PREPARED_REQUEST");

  let parsed: unknown;
  try { parsed = JSON.parse(prepared.serializedRequest); }
  catch { return fail("INVALID_PREPARED_REQUEST"); }
  const request = schemaRecord(parsed, ["protocolVersion", "systemInstructions", "data", "responseSchema"]);
  expectEqual(request.protocolVersion, `${OWNERSHIP_SEMANTIC_PURPOSE}/${OWNERSHIP_SEMANTIC_VERSION}`);
  if (typeof request.systemInstructions !== "string") fail("INVALID_PREPARED_REQUEST");
  const data = schemaRecord(request.data, ["semanticPackage"]);
  if (!isPlainRecord(data.semanticPackage)) fail("INVALID_PREPARED_REQUEST");
  if (canonicalJson(request) !== prepared.serializedRequest) fail("INVALID_PREPARED_REQUEST");
  if (canonicalJson(request.responseSchema) !== canonicalJson(prepared.responseSchema)) fail("INVALID_PREPARED_REQUEST");

  return {
    instructions: request.systemInstructions,
    inputText: canonicalJson({ protocolVersion: request.protocolVersion, data }),
  };
}

function mapPromptError(error: unknown): never {
  if (error instanceof OwnershipSemanticPromptError) {
    if (error.code === "REQUEST_TOO_LARGE") fail("PROMPT_REQUEST_TOO_LARGE");
    if (error.code === "INVALID_INPUT") fail("INVALID_INPUT");
  }
  fail("INVALID_PACKAGE");
}

/** Constructs a full offline Responses body; it performs no policy, transport, or provider operation. */
export async function prepareOwnershipSemanticResponsesRequest(
  input: OwnershipSemanticResponsesInput,
): Promise<PreparedOwnershipSemanticResponsesRequest> {
  const captured = captureInput(input);

  // The real prompt adapter captures the package and submitted answer synchronously before its first await.
  const preparation = prepareOwnershipSemanticRequest({
    semanticPackage: captured.semanticPackage,
    submittedAnswer: captured.submittedAnswer,
  });
  let prepared: PreparedOwnershipSemanticRequest;
  try { prepared = await preparation; }
  catch (error) { return mapPromptError(error); }

  let prompt: PreparedPromptContent;
  let schema: ProviderSchema;
  try {
    prompt = readPreparedPrompt(prepared);
    schema = deepFreeze(projectSemanticResponseSchema(prepared.responseSchema));
  } catch (error) {
    if (error instanceof OwnershipSemanticResponsesError) throw error;
    fail("INVALID_PREPARED_REQUEST");
  }

  const body = canonicalJson({
    model: captured.model,
    instructions: prompt.instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt.inputText }] }],
    store: false,
    stream: false,
    max_output_tokens: captured.maxOutputTokens,
    text: { format: { type: "json_schema", name: RESPONSES_SCHEMA_NAME, strict: true, schema } },
  });
  const requestBytes = remoteUtf8Bytes(body);
  if (requestBytes > REMOTE_LIMITS.requestBytes) fail("REQUEST_TOO_LARGE");
  const bodyDigest = createHash("sha256").update(body, "utf8").digest("hex");

  return Object.freeze({ body, bodyDigest, requestBytes, prepared });
}
