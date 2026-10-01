import { z } from "zod";
import {
  EXPLANATION_TASK_PROTOCOL_VERSION, RemoteExplanationError, remoteAuthorizationSchema,
  remoteCancelRequestSchema, remoteContextSchema, remoteFailureCodeSchema, remoteKeySchema,
  remoteModelSchema, remotePrepareRequestSchema, remotePreviewSchema, remoteProviderSettingsSchema,
  remoteRefSchema, remoteResultSchema, remoteRevisionSchema, remoteStartRequestSchema, remoteTaskRecordSchema,
  remoteUtf8Bytes, remoteUuidSchema,
} from "./remote-explanation.js";
import { canonicalJson } from "./snapshot-content.js";

// Independent protocol definitions only. No existing XRayApi or channel becomes available by exporting these.
const version = z.literal(EXPLANATION_TASK_PROTOCOL_VERSION);
const revision = z.object({ expectedRevision: remoteRevisionSchema }).strict();
const configure = revision.extend({ model: remoteModelSchema, outputTokens: z.number().int().min(1).max(2048) }).strict();
const writeCredential = revision.extend({ credential: remoteKeySchema }).strict();
const authorize = revision.extend({ repositoryId: remoteRefSchema.shape.repositoryId, granted: z.boolean() }).strict();
const activate = z.object({ ref: remoteRefSchema.nullable() }).strict();
const rendererStart = remoteStartRequestSchema.omit({ taskId: true }).strict();
const empty = z.object({}).strict();
const protocolTask = remoteTaskRecordSchema.refine(task => task.phase === "cancelled" ? task.code === "CANCELLED" : task.phase === "interrupted" ? task.code === "INTERRUPTED" : task.phase !== "failed" || (task.code !== "CANCELLED" && task.code !== "INTERRUPTED"), "任务终态码不一致");
function command<O extends string, T extends z.ZodType>(operation: O, input: T) { return z.object({ protocolVersion: version, operation: z.literal(operation), input }).strict(); }
const rendererUnion = z.discriminatedUnion("operation", [
  command("provider-state", empty), command("configure-provider", configure), command("write-credential", writeCredential),
  command("delete-credential", revision), command("authorization", z.object({ ref: remoteRefSchema }).strict()),
  command("save-authorization", authorize), command("activate-context", activate),
  command("prepare", remotePrepareRequestSchema), command("start", rendererStart),
  command("cancel", remoteCancelRequestSchema), command("status", remoteCancelRequestSchema), command("result", remoteCancelRequestSchema),
]);
function bounded<T extends z.ZodType>(schema: T, bytes: number) {
  return schema.superRefine((value, context) => {
    if (remoteUtf8Bytes(JSON.stringify(value)) > bytes) context.addIssue({ code: "custom", message: "协议字节超限" });
  });
}
const closedPreview = remotePreviewSchema.superRefine((value, context) => {
  const pack = value.evidencePackage; const nodes = new Map(pack.nodes.map(node => [node.id, node])); const proofs = new Map(pack.proofs.map(proof => [proof.id, proof])); const edges = new Map(pack.edges.map(edge => [edge.id, edge])); const used = new Set<string>();
  const rank = { verified: 0, inferred: 1, unknown: 2 };
  const invalid = () => context.addIssue({ code: "custom", message: "预览引用不闭合" });
  if (nodes.size !== pack.nodes.length || proofs.size !== pack.proofs.length || edges.size !== pack.edges.length || new Set(pack.pathEdgeIds).size !== pack.pathEdgeIds.length) invalid();
  for (const node of nodes.values()) for (const id of node.evidenceIds) { if (!proofs.has(id)) invalid(); used.add(id); }
  for (const edge of edges.values()) { const proof = proofs.get(edge.evidenceId); if (!nodes.has(edge.source) || !nodes.has(edge.target) || !proof || rank[edge.confidence] < rank[proof.confidence]) invalid(); used.add(edge.evidenceId); }
  if (used.size !== proofs.size || pack.proofs.some(proof => canonicalJson(proof.span) !== canonicalJson(proof.sliceSpan))) invalid();
  for (const [i, id] of pack.pathEdgeIds.entries()) { const edge = edges.get(id); if (!edge || edge.confidence !== "verified" || proofs.get(edge.evidenceId)?.confidence !== "verified" || (i > 0 && edges.get(pack.pathEdgeIds[i - 1]!)?.target !== edge.source)) invalid(); }
  if (pack.unknowns.some(text => !value.localUnknowns.includes(text)) || pack.limitations.some(text => !value.localLimitations.includes(text))) invalid();
  if (value.maxOutputTokens !== value.provider.outputTokens || value.sourceBytes !== pack.proofs.reduce((bytes, proof) => bytes + remoteUtf8Bytes(proof.snippet), 0)) invalid();
});
export const remoteRendererRequestSchema = bounded(rendererUnion, 65536);
export type RemoteRendererRequest = z.infer<typeof remoteRendererRequestSchema>;

// Main issues this handle immediately, before forwarding start to the worker or accepting events.
// The handle is a reference, not permission to dispatch; main must register its owning window/context.
export const remoteDesktopTaskHandleSchema = z.object({ protocolVersion: version, taskId: remoteUuidSchema, contextHandle: remoteUuidSchema, ref: remoteRefSchema }).strict();
export type RemoteDesktopTaskHandle = z.infer<typeof remoteDesktopTaskHandleSchema>;
function rendererReply<O extends string, T extends z.ZodType>(operation: O, value: T) { return z.object({ protocolVersion: version, operation: z.literal(operation), value }).strict(); }
export const remoteRendererReplySchema = bounded(z.union([
  rendererReply("provider-state", remoteProviderSettingsSchema), rendererReply("configure-provider", remoteProviderSettingsSchema), rendererReply("write-credential", remoteProviderSettingsSchema), rendererReply("delete-credential", remoteProviderSettingsSchema),
  rendererReply("authorization", remoteAuthorizationSchema), rendererReply("save-authorization", remoteAuthorizationSchema),
  rendererReply("activate-context", z.object({ contextHandle: remoteUuidSchema, ref: remoteRefSchema.nullable() }).strict()),
  rendererReply("prepare", closedPreview), rendererReply("start", remoteDesktopTaskHandleSchema), rendererReply("cancel", protocolTask), rendererReply("status", protocolTask.nullable()), rendererReply("result", remoteResultSchema.nullable()),
]), 262144);
export type RemoteRendererReply = z.infer<typeof remoteRendererReplySchema>;
export const remoteExplanationWorkerConfigurationSchema = bounded(z.object({
  protocolVersion: version,
  databasePath: z.string().min(1).max(32767).refine(value => /^[A-Za-z]:[\\/]/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value)),
  projectDatabaseRoot: z.string().min(1).max(32767).refine(value => /^[A-Za-z]:[\\/]/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value)),
  cacheRoot: z.string().min(1).max(32767).refine(value => /^[A-Za-z]:[\\/]/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict(), 65536);
export type RemoteExplanationWorkerConfiguration = z.infer<typeof remoteExplanationWorkerConfigurationSchema>;

const envelope = { protocolVersion: version, requestId: remoteUuidSchema, ownerSessionId: remoteUuidSchema };
function internal<O extends string, T extends z.ZodType>(operation: O, input: T) { return z.object({ ...envelope, operation: z.literal(operation), input }).strict(); }
function contextual<O extends string, T extends z.ZodType>(operation: O, input: T) { return z.object({ ...envelope, operation: z.literal(operation), context: remoteContextSchema, input }).strict(); }
const workerUnion = z.discriminatedUnion("operation", [
  internal("provider-state", empty), internal("configure-provider", configure), internal("write-credential", writeCredential), internal("delete-credential", revision),
  internal("authorization", z.object({ ref: remoteRefSchema }).strict()), internal("save-authorization", authorize), internal("activate-context", activate),
  contextual("prepare", remotePrepareRequestSchema),
  contextual("start", z.object({ request: remoteStartRequestSchema, handle: remoteDesktopTaskHandleSchema }).strict()),
  contextual("cancel", remoteCancelRequestSchema), contextual("status", remoteCancelRequestSchema), contextual("result", remoteCancelRequestSchema),
]);
export const remoteExplanationWorkerCommandSchema = bounded(workerUnion.superRefine((value, context) => {
  if (!("context" in value)) return;
  const authority = value.context; const input = value.operation === "start" ? value.input.request : value.input;
  if (!authority.active || authority.ownerSessionId !== value.ownerSessionId || authority.contextHandle !== input.contextHandle || !authority.reference) context.addIssue({ code: "custom", message: "命令上下文不一致" });
  if (value.operation === "prepare" && (value.input.repositoryId !== authority.reference?.repositoryId || value.input.snapshotId !== authority.reference?.snapshotId)) context.addIssue({ code: "custom", message: "准备引用不一致" });
  if (value.operation === "start" && (value.input.handle.taskId !== value.input.request.taskId || value.input.handle.contextHandle !== value.input.request.contextHandle || value.input.handle.ref.repositoryId !== authority.reference?.repositoryId || value.input.handle.ref.snapshotId !== authority.reference?.snapshotId)) context.addIssue({ code: "custom", message: "启动句柄不一致" });
}), 65536);
export type RemoteExplanationWorkerCommand = z.infer<typeof remoteExplanationWorkerCommandSchema>;

const responseBase = { protocolVersion: version, requestId: remoteUuidSchema };
function reply<O extends string, T extends z.ZodType>(operation: O, value: T) { return z.object({ ...responseBase, type: z.literal("reply"), operation: z.literal(operation), value }).strict(); }
export const remoteExplanationWorkerReplySchema = bounded(z.union([
  reply("provider-state", remoteProviderSettingsSchema), reply("configure-provider", remoteProviderSettingsSchema), reply("write-credential", remoteProviderSettingsSchema), reply("delete-credential", remoteProviderSettingsSchema),
  reply("authorization", remoteAuthorizationSchema), reply("save-authorization", remoteAuthorizationSchema), reply("activate-context", remoteContextSchema),
  reply("prepare", closedPreview), reply("start", protocolTask), reply("cancel", protocolTask), reply("status", protocolTask.nullable()), reply("result", remoteResultSchema.nullable()),
  z.object({ ...responseBase, type: z.literal("error"), operation: z.enum(["provider-state", "configure-provider", "write-credential", "delete-credential", "authorization", "save-authorization", "activate-context", "prepare", "start", "cancel", "status", "result"]), code: remoteFailureCodeSchema }).strict(),
]), 262144);
export const remoteDesktopTaskEventSchema = bounded(z.object({
  protocolVersion: version, task: protocolTask, result: remoteResultSchema.nullable(),
}).strict().superRefine((value, context) => {
  // Result publication and authority completion are distinct writes; their timestamps are not identity.
  if (value.task.phase === "completed" ? !value.result || canonicalJson(value.result.identity) !== canonicalJson(value.task.identity) : value.result !== null) context.addIssue({ code: "custom", message: "事件结果不闭合" });
}), 262144);
export type RemoteDesktopTaskEvent = z.infer<typeof remoteDesktopTaskEventSchema>;
export type RemoteExplanationWorkerReply = z.infer<typeof remoteExplanationWorkerReplySchema>;
function identityMatchesContext(identity: z.infer<typeof remoteTaskRecordSchema>["identity"], context: z.infer<typeof remoteContextSchema>): boolean {
  const reference = context.reference;
  return context.active && reference !== null && identity.ownerSessionId === context.ownerSessionId && identity.contextHandle === context.contextHandle && identity.contextEpoch === context.epoch && identity.repositoryId === reference.repositoryId && identity.snapshotId === reference.snapshotId && identity.activation === reference.activation && identity.analysisResultFingerprint === reference.analysisResultFingerprint && identity.configurationHash === reference.configurationHash && identity.ignorePolicyHash === reference.ignorePolicyHash && identity.sourceManifestHash === reference.sourceManifestHash;
}

/** Correlate a reply to the validated command; a valid DTO alone is not an owning-window match. */
export function parseRemoteWorkerReply(raw: unknown, issuedCommand: RemoteExplanationWorkerCommand): RemoteExplanationWorkerReply {
  try {
    const response = remoteExplanationWorkerReplySchema.parse(raw); const command = remoteExplanationWorkerCommandSchema.parse(issuedCommand);
    if (response.requestId !== command.requestId || response.operation !== command.operation) throw new Error();
    if (response.type === "error") return response;
    if (response.operation === "activate-context" && command.operation === "activate-context" && (response.value.ownerSessionId !== command.ownerSessionId || response.value.reference?.repositoryId !== command.input.ref?.repositoryId || response.value.reference?.snapshotId !== command.input.ref?.snapshotId)) throw new Error();
    if ((response.operation === "authorization" && command.operation === "authorization" && response.value.repositoryId !== command.input.ref.repositoryId) || (response.operation === "save-authorization" && command.operation === "save-authorization" && response.value.repositoryId !== command.input.repositoryId)) throw new Error();
    if (response.operation === "prepare" && command.operation === "prepare" && (response.value.contextHandle !== command.context.contextHandle || response.value.evidencePackage.repositoryId !== command.input.repositoryId || response.value.evidencePackage.snapshotId !== command.input.snapshotId || response.value.evidencePackage.query !== command.input.query || response.value.evidencePackage.purpose !== command.input.purpose)) throw new Error();
    if ("context" in command && ["start", "cancel", "status", "result"].includes(response.operation) && response.value) {
      if (!("identity" in response.value)) throw new Error(); const identity = response.value.identity;
      const taskId = command.operation === "start" ? command.input.request.taskId : "taskId" in command.input ? command.input.taskId : null;
      if (identity.taskId !== taskId || !identityMatchesContext(identity, command.context) || (command.operation === "start" && identity.packageId !== command.input.request.packageId)) throw new Error();
    }
    return response;
  } catch { throw new RemoteExplanationError("CONTEXT_CHANGED"); }
}

/** Caller supplies the actual main-owned context, not a context copied from the message. */
export function parseRemoteWorkerCommand(raw: unknown, trustedContext: z.infer<typeof remoteContextSchema>): RemoteExplanationWorkerCommand {
  try {
    const value = remoteExplanationWorkerCommandSchema.parse(raw); const authority = remoteContextSchema.parse(trustedContext);
    if (value.ownerSessionId !== authority.ownerSessionId || ("context" in value && canonicalJson(value.context) !== canonicalJson(authority))) throw new Error();
    return value;
  } catch { throw new RemoteExplanationError("CONTEXT_CHANGED"); }
}
/** Pure sequence guard; the future broker must pass an already-issued handle and its last accepted event. */
export function acceptRemoteDesktopTaskEvent(raw: unknown, issuedHandle: RemoteDesktopTaskHandle, trustedContext: z.infer<typeof remoteContextSchema>, previous: RemoteDesktopTaskEvent | null): RemoteDesktopTaskEvent {
  try {
    const event = remoteDesktopTaskEventSchema.parse(raw); const handle = remoteDesktopTaskHandleSchema.parse(issuedHandle); const context = remoteContextSchema.parse(trustedContext);
    const matches = (task: z.infer<typeof remoteTaskRecordSchema>) => identityMatchesContext(task.identity, context) && task.identity.contextHandle === handle.contextHandle && task.identity.taskId === handle.taskId && task.identity.repositoryId === handle.ref.repositoryId && task.identity.snapshotId === handle.ref.snapshotId;
    if (!matches(event.task)) throw new Error();
    if (previous) {
      const old = remoteDesktopTaskEventSchema.parse(previous);
      if (!matches(old.task) || canonicalJson(old.task.identity) !== canonicalJson(event.task.identity) || !["preparing", "dispatched"].includes(old.task.phase) || old.task.phase === event.task.phase || (old.task.phase === "dispatched" && event.task.phase === "preparing")) throw new Error();
    }
    if (event.task.phase === "completed" && previous?.task.phase !== "dispatched") throw new Error();
    return event;
  } catch { throw new RemoteExplanationError("CONTEXT_CHANGED"); }
}
