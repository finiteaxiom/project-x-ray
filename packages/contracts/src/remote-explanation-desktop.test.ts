import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXPLANATION_TASK_PROTOCOL_VERSION, type RemoteContext, type RemoteTaskRecord, type RemoteResult } from "./remote-explanation.js";
import { acceptRemoteDesktopTaskEvent, parseRemoteWorkerCommand, parseRemoteWorkerReply, remoteDesktopTaskEventSchema, remoteExplanationWorkerCommandSchema, remoteExplanationWorkerConfigurationSchema, remoteExplanationWorkerReplySchema, remoteRendererReplySchema, remoteRendererRequestSchema, type RemoteDesktopTaskHandle } from "./remote-explanation-desktop.js";
const protocolVersion = EXPLANATION_TASK_PROTOCOL_VERSION; const hash = "a".repeat(64); const time = "2026-10-02T00:00:00.000Z";
function fixture() {
  const context: RemoteContext = { ownerSessionId: randomUUID(), contextHandle: randomUUID(), epoch: 2, active: true, reference: { repositoryId: "r", snapshotId: "s", activation: time, analysisResultFingerprint: hash, configurationHash: hash, ignorePolicyHash: null, sourceManifestHash: hash } };
  const handle: RemoteDesktopTaskHandle = { protocolVersion, taskId: randomUUID(), contextHandle: context.contextHandle, ref: { repositoryId: "r", snapshotId: "s" } };
  const task: RemoteTaskRecord = { identity: { protocolVersion, taskId: handle.taskId, repositoryId: "r", snapshotId: "s", analysisResultFingerprint: hash, ignoreRevision: 0, authorizationRevision: 1, providerRevision: 1, contextEpoch: 2, ownerSessionId: context.ownerSessionId, packageId: hash, limitsVersion: "1.0.0", contextHandle: context.contextHandle, activation: time, configurationHash: hash, ignorePolicyHash: null, sourceManifestHash: hash, credentialRevision: 1, bodyDigest: hash }, phase: "preparing", createdAt: time, completedAt: null, code: null };
  const command = { protocolVersion, requestId: randomUUID(), ownerSessionId: context.ownerSessionId, operation: "start" as const, context, input: { request: { contextHandle: context.contextHandle, taskId: handle.taskId, previewId: randomUUID(), packageId: hash }, handle } };
  const span = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 };
  const result: RemoteResult = { version: "1.0.0", identity: task.identity, narrative: { version: "1.0.0", repositoryId: "r", snapshotId: "s", packageId: hash, claims: [{ text: "inferred", evidenceIds: ["p"], confidence: "inferred" }], unknowns: [] }, checkedAt: time, completedAt: time, localUnknowns: [], localLimitations: [], localTruncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 }, citations: [{ id: "p", kind: "call-expression", span, sliceSpan: span, analyzer: "ts", analyzerVersion: "1", confidence: "verified", contentHash: hash }], unknownEvidenceIds: [] };
  return { context, handle, task, command, result };
}
describe("strict remote desktop protocol; no IPC is wired", () => {
  it("renderer start contains references only while main's command owns the UUID/context", () => {
    const f = fixture(); const { taskId: _taskId, ...input } = f.command.input.request;
    expect(remoteRendererRequestSchema.parse({ protocolVersion, operation: "start", input }).input).toEqual(input);
    for (const field of ["taskId", "ownerSessionId", "contextEpoch", "epoch", "target", "path", "endpoint", "body", "credential"]) expect(remoteRendererRequestSchema.safeParse({ protocolVersion, operation: "start", input: { ...input, [field]: "untrusted" } }).success).toBe(false);
    expect(parseRemoteWorkerCommand(f.command, f.context).operation).toBe("start");
    expect(remoteRendererRequestSchema.safeParse(f.command).success).toBe(false);
    expect(remoteRendererReplySchema.parse({ protocolVersion, operation: "start", value: f.handle }).value).toEqual(f.handle);
    expect(remoteRendererReplySchema.safeParse({ protocolVersion, operation: "start", value: f.task }).success).toBe(false);
  });
  it.each(["version", "unknown", "nested", "owner", "epoch", "handle", "ref", "context", "task"])("rejects %s command and cross-window authority", kind => {
    const f = fixture(); const raw = structuredClone(f.command);
    if (kind === "version") raw.protocolVersion = "invalid";
    if (kind === "unknown") Object.assign(raw, { operation: "shell" });
    if (kind === "nested") Object.assign(raw.input, { key: "untrusted" });
    if (kind === "owner") raw.ownerSessionId = randomUUID();
    if (kind === "epoch") raw.context.epoch++;
    if (kind === "handle") raw.input.request.contextHandle = randomUUID();
    if (kind === "ref") raw.input.handle.ref.snapshotId = "other";
    if (kind === "context") raw.context.contextHandle = randomUUID();
    if (kind === "task") raw.input.request.taskId = randomUUID();
    expect(() => parseRemoteWorkerCommand(raw, f.context)).toThrow(expect.objectContaining({ code: "CONTEXT_CHANGED", message: "远程解释未完成" }));
  });
  it("permits only a bounded transient secret write, never a target or read command", () => {
    const write = (credential: string) => ({ protocolVersion, operation: "write-credential", input: { expectedRevision: 0, credential } });
    expect(remoteRendererRequestSchema.safeParse(write("k".repeat(2048))).success).toBe(true);
    for (const credential of ["", "中".repeat(683), "k".repeat(2049), "key\n", "key\0", "two words", "key\u0085"]) expect(remoteRendererRequestSchema.safeParse(write(credential)).success).toBe(false);
    expect(remoteRendererRequestSchema.safeParse({ ...write("fixture-only"), input: { ...write("fixture-only").input, target: "other" } }).success).toBe(false);
    expect(remoteRendererRequestSchema.safeParse({ protocolVersion, operation: "read-credential", input: {} }).success).toBe(false);
    const f = fixture(); expect(remoteExplanationWorkerCommandSchema.safeParse({ ...write("fixture-only"), requestId: randomUUID(), ownerSessionId: f.context.ownerSessionId }).success).toBe(true);
  });
  it("strictly bounds internal worker configuration with no secret/provider/renderer paths", () => {
    const config = { protocolVersion, databasePath: "D:\\data\\global.sqlite", projectDatabaseRoot: "D:\\data\\projects", cacheRoot: "D:\\data\\cache" };
    expect(remoteExplanationWorkerConfigurationSchema.safeParse(config).success).toBe(true);
    for (const key of ["credential", "target", "endpoint", "provider", "workerPath"]) expect(remoteExplanationWorkerConfigurationSchema.safeParse({ ...config, [key]: "extra" }).success).toBe(false);
    for (const path of ["", "relative.sqlite", "D:\\bad\0", "D:\\" + "x".repeat(32767)]) expect(remoteExplanationWorkerConfigurationSchema.safeParse({ ...config, databasePath: path }).success).toBe(false);
    expect(remoteExplanationWorkerConfigurationSchema.safeParse({ ...config, databasePath: "D:\\" + "中".repeat(22000) }).success).toBe(false);
  });
  it("correlates task replies and refuses secret fields, wrong request IDs and refs", () => {
    const f = fixture(); const response = { protocolVersion, type: "reply", operation: "start", requestId: f.command.requestId, value: f.task };
    const command = remoteExplanationWorkerCommandSchema.parse(f.command);
    expect(parseRemoteWorkerReply(response, command)).toEqual(response);
    for (const raw of [{ ...response, requestId: randomUUID() }, { ...response, operation: "cancel" }, { ...response, value: { ...f.task, identity: { ...f.task.identity, snapshotId: "other" } } }, { ...response, value: { ...f.task, credential: "extra" } }, { ...response, credential: "extra" }]) expect(() => parseRemoteWorkerReply(raw, command)).toThrow();
    expect(remoteExplanationWorkerReplySchema.safeParse({ protocolVersion, requestId: f.command.requestId, type: "error", operation: "start", code: "TIMEOUT", message: "private" }).success).toBe(false);
  });
  it("accepts events only after an issued matching handle and allows exactly one terminal", () => {
    const f = fixture(); const preparing = { protocolVersion, task: f.task, result: null };
    const sending = { ...preparing, task: { ...f.task, phase: "dispatched" as const } };
    const terminal = { protocolVersion, task: { ...f.task, phase: "completed" as const, completedAt: time }, result: f.result };
    const first = acceptRemoteDesktopTaskEvent(preparing, f.handle, f.context, null); const second = acceptRemoteDesktopTaskEvent(sending, f.handle, f.context, first);
    const third = acceptRemoteDesktopTaskEvent(terminal, f.handle, f.context, second); expect(third.task.phase).toBe("completed");
    expect(() => acceptRemoteDesktopTaskEvent(terminal, f.handle, f.context, third)).toThrow(); expect(() => acceptRemoteDesktopTaskEvent(preparing, f.handle, f.context, second)).toThrow();
    expect(() => acceptRemoteDesktopTaskEvent(terminal, f.handle, f.context, null)).toThrow();
    expect(() => acceptRemoteDesktopTaskEvent(preparing, { ...f.handle, taskId: randomUUID() }, f.context, null)).toThrow();
    expect(() => acceptRemoteDesktopTaskEvent(preparing, f.handle, { ...f.context, ownerSessionId: randomUUID() }, null)).toThrow();
    expect(() => acceptRemoteDesktopTaskEvent(preparing, f.handle, { ...f.context, epoch: 3 }, null)).toThrow();
  });
  it("accepts the distinct result publication and authoritative task completion timestamps", () => {
    const f = fixture(); const sending = remoteDesktopTaskEventSchema.parse({ protocolVersion, task: { ...f.task, phase: "dispatched" }, result: null });
    const raw = { protocolVersion, task: { ...f.task, phase: "completed", completedAt: "2026-10-02T00:00:00.001Z" }, result: f.result };
    expect(acceptRemoteDesktopTaskEvent(raw, f.handle, f.context, sending).result).toEqual(f.result);
  });
  it("allows a cancelled preflight terminal, but rejects unclosed results and success without dispatch", () => {
    const f = fixture(); const first = remoteDesktopTaskEventSchema.parse({ protocolVersion, task: f.task, result: null });
    const cancelled = { ...first, task: { ...f.task, phase: "cancelled" as const, completedAt: time, code: "CANCELLED" as const } };
    expect(acceptRemoteDesktopTaskEvent(cancelled, f.handle, f.context, first).task.phase).toBe("cancelled");
    for (const result of [null, { ...f.result, identity: { ...f.result.identity, taskId: randomUUID() } }, { ...f.result, narrative: { ...f.result.narrative, claims: [{ text: "x", evidenceIds: ["missing"], confidence: "inferred" }] } }]) expect(remoteDesktopTaskEventSchema.safeParse({ protocolVersion, task: { ...f.task, phase: "completed", completedAt: time }, result }).success).toBe(false);
    expect(remoteDesktopTaskEventSchema.safeParse({ ...cancelled, result: f.result }).success).toBe(false);
    expect(remoteDesktopTaskEventSchema.safeParse({ ...cancelled, task: { ...cancelled.task, code: "TIMEOUT" } }).success).toBe(false);
    expect(() => acceptRemoteDesktopTaskEvent({ ...first, task: { ...f.task, identity: { ...f.task.identity, analysisResultFingerprint: "b".repeat(64) } } }, f.handle, f.context, null)).toThrow();
  });
  it("rejects oversized result envelopes without removing local limitations", () => {
    const f = fixture(); f.result.localLimitations = Array(1200).fill("中".repeat(1200));
    expect(remoteExplanationWorkerReplySchema.safeParse({ protocolVersion, type: "reply", requestId: f.command.requestId, operation: "result", value: f.result }).success).toBe(false);
    expect(remoteRendererReplySchema.safeParse({ protocolVersion, operation: "result", value: f.result }).success).toBe(false);
    expect(f.result.localLimitations).toHaveLength(1200);
  });
  it("rejects unclosed preview proofs, endpoints, path references and absent local unknowns", () => {
    const f = fixture(); const proof = { ...f.result.citations[0]!, snippet: "run" };
    const pack = { version: "1.0.0", repositoryId: "r", snapshotId: "s", packageId: hash, purpose: "feature-explanation", query: "run", analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { ts: "1" }, configurationHash: hash, sourceFingerprint: hash, ignorePolicy: null, analysisResult: { version: "1.0.0", fingerprint: hash } },
      nodes: [{ id: "n", name: "run", kind: "function", filePath: "a.ts", evidenceIds: ["p"] }], edges: [], proofs: [proof], pathEdgeIds: [], unknowns: ["dynamic"], limitations: ["static"], health: { status: "ready", failedCount: 0, failures: [] }, truncation: f.result.localTruncation };
    const preview = { protocolVersion, previewId: randomUUID(), contextHandle: f.context.contextHandle, createdAt: time, expiresAt: "2026-10-02T00:05:00.000Z", packageId: hash, bodyDigest: hash, evidencePackage: pack,
      provider: { provider: "openai", model: "fixture-model", revision: 1, credentialRevision: 1, credentialStatus: "configured", outputTokens: 100 }, authorization: { version: "1.0.0", repositoryId: "r", provider: "openai", scope: ["feature-explanation"], disclosureVersion: "1.0.0", revision: 1, status: "granted", categories: [], grantedAt: time, revokedAt: null },
      categories: ["query", "relative-paths-and-symbols", "relationships", "source-snippets", "evidence-identities", "analysis-limitations"], localUnknowns: ["dynamic"], localLimitations: ["static"], sourceBytes: 3, maxRequestBytes: 65536, maxOutputTokens: 100 };
    const reply = (value: unknown) => ({ protocolVersion, operation: "prepare", value }); expect(remoteRendererReplySchema.safeParse(reply(preview)).success).toBe(true);
    for (const evidencePackage of [{ ...pack, nodes: [{ ...pack.nodes[0], evidenceIds: ["absent"] }] }, { ...pack, proofs: [proof, { ...proof, id: "unused" }] }, { ...pack, pathEdgeIds: ["absent"] }, { ...pack, edges: [{ id: "e", source: "n", target: "absent", kind: "CALLS", evidenceId: "p", confidence: "verified", reason: "syntax" }] }]) expect(remoteRendererReplySchema.safeParse(reply({ ...preview, evidencePackage })).success).toBe(false);
    expect(remoteRendererReplySchema.safeParse(reply({ ...preview, localUnknowns: [] })).success).toBe(false);
    expect(remoteRendererReplySchema.safeParse(reply({ ...preview, maxOutputTokens: 101 })).success).toBe(false);
    expect(remoteRendererReplySchema.safeParse(reply({ ...preview, sourceBytes: 2 })).success).toBe(false);
  });
});
