import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, remoteDesktopTaskEventSchema, RemoteExplanationError, type RemoteProviderSettings } from "@project-xray/contracts";
import { OpenAIResponsesProvider, prepareOpenAIResponsesRequest, type PreparedEvidencePackage } from "@project-xray/llm";
import { createProductionRemoteProvider, RemoteResponsesBridge } from "./remote-provider.js";
import { XRayApplication } from "@project-xray/application";

const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function fixture() {
  const span = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 };
  const payload = { version: "1.0.0" as const, repositoryId: "r", snapshotId: "s", purpose: "feature-explanation" as const, query: "explain run",
    analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: { ts: "1" }, configurationHash: hash("config"), sourceFingerprint: hash("source"), ignorePolicy: null, analysisResult: { version: "1.0.0" as const, fingerprint: hash("result") } },
    nodes: [{ id: "n", name: "run", kind: "function" as const, filePath: "a.ts", evidenceIds: ["p"] }], edges: [],
    proofs: [{ id: "p", kind: "call-expression" as const, span, sliceSpan: span, analyzer: "ts", analyzerVersion: "1", confidence: "verified" as const, contentHash: hash("run"), snippet: "run" }],
    pathEdgeIds: [], unknowns: ["dynamic side"], limitations: ["static only"], health: { status: "ready" as const, failedCount: 0, failures: [] },
    truncation: { reasons: [], omittedNodes: 0, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 } };
  const prepared: PreparedEvidencePackage = { evidencePackage: { ...payload, packageId: hash(canonicalJson(payload)) }, localUnknowns: [...payload.unknowns], localLimitations: [...payload.limitations] };
  const settings: RemoteProviderSettings = { provider: "openai", model: "fixture-model", revision: 1, credentialRevision: 1, credentialStatus: "configured", outputTokens: 100 };
  const narrative = { version: "1.0.0", repositoryId: "r", snapshotId: "s", packageId: prepared.evidencePackage.packageId, claims: [{ text: "static inference", evidenceIds: ["p"], confidence: "inferred" }], unknowns: [] };
  const response = () => new Response(JSON.stringify({ id: "resp_test", status: "completed", output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(narrative), annotations: [] }] }] }));
  const dispatch = (bridge: RemoteResponsesBridge) => ({ prepared, settings, bodyDigest: bridge.bodyDigest(prepared, settings), credential: "fixture-only", signal: new AbortController().signal, taskDeadline: performance.now() + 90000 });
  return { prepared, settings, narrative, response, dispatch };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("desktop Responses bridge, explicit transport fixtures only", () => {
  it("real indexing and application preview approve exactly the full body sent by the production bridge", async () => {
    const root = mkdtempSync(join(tmpdir(), "xray-wire-")); const code = join(root, "code"); mkdirSync(code); writeFileSync(join(code, "a.ts"), "export function login(){ return 1 }\n");
    const app = new XRayApplication({ databasePath: join(root, "global.sqlite"), projectDatabaseRoot: join(root, "projects"), cacheRoot: join(root, "cache") }); let approved: string | null = null;
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body); expect(hash(body)).toBe(approved); const request = JSON.parse(body); const pack = JSON.parse(request.input[0].content[0].text);
      expect(request.max_output_tokens).toBe(100); expect(body).not.toContain("fixture-only");
      const narrative = { version: "1.0.0", repositoryId: pack.repositoryId, snapshotId: pack.snapshotId, packageId: pack.packageId, claims: [{ text: "static interpretation", evidenceIds: [pack.proofs[0].id], confidence: pack.proofs[0].confidence === "unknown" ? "unknown" : "inferred" }], unknowns: [] };
      return new Response(JSON.stringify({ id: "resp_test", status: "completed", output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(narrative), annotations: [] }] }] }));
    });
    vi.stubGlobal("fetch", transport);
    try {
      const snap = await app.indexProject(code); const ref = { repositoryId: snap.repositoryId, snapshotId: snap.snapshotId };
      const remote = app.createRemoteExplanations({ provider: createProductionRemoteProvider(), credentials: { read: async () => ({ credential: "fixture-only", revision: 1 }) } });
      remote.saveProvider(0, { provider: "openai", model: "fixture-model", credentialStatus: "configured", credentialRevision: 1, outputTokens: 100 }); remote.saveAuthorization(ref.repositoryId, 0, true);
      const context = remote.commitTrustedContext(randomUUID(), ref); const preview = await remote.prepare({ ...ref, query: "login", purpose: "feature-explanation", contextHandle: context.contextHandle });
      approved = preview.bodyDigest; expect(approved).not.toBeNull(); expect(transport).not.toHaveBeenCalled();
      const taskId = randomUUID(); const terminal = await remote.start({ taskId, previewId: preview.previewId, packageId: preview.packageId, contextHandle: context.contextHandle });
      expect(terminal.phase).toBe("completed"); expect(transport).toHaveBeenCalledTimes(1); const result = await remote.result(taskId, context.contextHandle);
      expect(result?.identity.bodyDigest).toBe(approved); expect(result?.narrative.claims[0]?.text).toBe("static interpretation");
      expect(remoteDesktopTaskEventSchema.parse({ protocolVersion: "1.0.0", task: terminal, result }).task.phase).toBe("completed");
    } finally {
      app.close(); if (resolve(dirname(root)) !== resolve(tmpdir()) || !basename(root).startsWith("xray-wire-")) throw new Error("Unexpected fixture directory"); rmSync(root, { recursive: true, force: true });
    }
  });
  it("prepares zero-network digest and synchronously sends the exact full body, returning raw validated narrative", async () => {
    const f = fixture(); const order: string[] = []; const wire = prepareOpenAIResponsesRequest({ prepared: f.prepared, model: f.settings.model!, maxOutputTokens: f.settings.outputTokens });
    const transport = vi.fn(async (url: string, init: RequestInit) => {
      order.push("fetch"); expect(url).toBe("https://api.openai.com/v1/responses"); expect(init.redirect).toBe("error"); expect(init.body).toBe(wire.body); expect(hash(String(init.body))).toBe(wire.bodyDigest);
      expect(JSON.parse(String(init.body))).toMatchObject({ store: false, stream: false, max_output_tokens: 100, text: { format: { strict: true, type: "json_schema" } } });
      expect(String(init.body)).not.toContain("fixture-only"); return f.response();
    });
    const bridge = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport }));
    expect(bridge.bodyDigest(f.prepared, f.settings)).toBe(wire.bodyDigest); expect(transport).not.toHaveBeenCalled();
    const input = f.dispatch(bridge); order.push("permit"); const completion = bridge.dispatch(input); order.push("return"); expect(order).toEqual(["permit", "fetch", "return"]);
    const result = await completion; expect(result).toEqual(f.narrative); expect(result).not.toHaveProperty("narrative"); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("production factory exposes no configuration and uses platform fetch at the fixed host", async () => {
    const f = fixture(); const transport = vi.fn(async (url: string, init: RequestInit) => { expect(url).toBe("https://api.openai.com/v1/responses"); expect(init.redirect).toBe("error"); return f.response(); });
    vi.stubGlobal("fetch", transport); const provider = createProductionRemoteProvider(); expect(transport).not.toHaveBeenCalled();
    const bodyDigest = provider.bodyDigest(f.prepared, f.settings); expect(transport).not.toHaveBeenCalled();
    await expect(provider.dispatch({ prepared: f.prepared, settings: f.settings, bodyDigest, credential: "fixture-only", signal: new AbortController().signal, taskDeadline: performance.now() + 90000 })).resolves.toEqual(f.narrative);
    expect(() => Reflect.apply(createProductionRemoteProvider, undefined, [{ endpoint: "https://invalid.test", transport }])).toThrow(expect.objectContaining({ code: "POLICY_INVALID" })); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["digest", "model", "tokens", "unknown", "authority", "unconfigured", "unavailable", "extra-settings", "key", "deadline", "cancel"])("fails %s without any transport call", async kind => {
    const f = fixture(); const transport = vi.fn(async () => f.response()); const bridge = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport })); const input = f.dispatch(bridge);
    if (kind === "digest") input.bodyDigest = "0".repeat(64);
    if (kind === "model") input.settings = { ...input.settings, model: "other-model" };
    if (kind === "tokens") input.settings = { ...input.settings, outputTokens: 101 };
    if (kind === "unknown") Object.assign(input, { endpoint: "https://invalid.test" });
    if (kind === "authority") Object.assign(input, { authorizationRevision: 100, ownerSessionId: "cannot-grant-permission-here" });
    if (kind === "unconfigured") input.settings = { ...input.settings, credentialStatus: "unconfigured" };
    if (kind === "unavailable") input.settings = { ...input.settings, credentialStatus: "unavailable" };
    if (kind === "extra-settings") Object.assign(input.settings, { credential: "extra" });
    if (kind === "key") input.credential = "bad\n";
    if (kind === "deadline") input.taskDeadline = performance.now() - 1;
    if (kind === "cancel") input.signal = AbortSignal.abort();
    let pending: Promise<unknown>; try { pending = bridge.dispatch(input); } catch (error) { pending = Promise.reject(error); }
    await expect(pending).rejects.toMatchObject({ name: "RemoteExplanationError", message: "远程解释未完成" }); expect(transport).not.toHaveBeenCalled();
  });
  it("checks full body bytes before dispatch and rejects unclosed or unknown prepared fields", () => {
    const f = fixture(); const transport = vi.fn(async () => f.response()); const bridge = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport }));
    Object.assign(f.prepared, { body: "unknown" }); expect(() => bridge.bodyDigest(f.prepared, f.settings)).toThrow(); delete (f.prepared as unknown as Record<string, unknown>).body;
    const pack = f.prepared.evidencePackage; pack.unknowns = Array.from({ length: 24 }, (_, i) => `${i}${"\\".repeat(500)}`); pack.limitations = [...pack.unknowns]; f.prepared.localUnknowns = [...pack.unknowns]; f.prepared.localLimitations = [...pack.limitations];
    const { packageId: _id, ...payload } = pack; pack.packageId = hash(canonicalJson(payload));
    expect(() => bridge.bodyDigest(f.prepared, f.settings)).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" })); expect(transport).not.toHaveBeenCalled();
  });
  it("keeps cancellation and global BUSY while discarding a late transport response", async () => {
    const f = fixture(); let release: ((response: Response) => void) | undefined; const transport = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const bridge = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport })); const controller = new AbortController(); const pending = bridge.dispatch({ ...f.dispatch(bridge), signal: controller.signal });
    await expect(bridge.dispatch(f.dispatch(bridge))).rejects.toMatchObject({ code: "BUSY" }); controller.abort(); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    release!(f.response()); await Promise.resolve(); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("redacts unsafe exceptions and rejects invalid output without retry", async () => {
    const f = fixture(); const error = new RemoteExplanationError("RATE_LIMITED"); error.message = "private secret + source";
    const transport = vi.fn(async () => { throw error; }); const bridge = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport }));
    await expect(bridge.dispatch(f.dispatch(bridge))).rejects.toMatchObject({ code: "RATE_LIMITED", message: "远程解释未完成" }); expect(transport).toHaveBeenCalledTimes(1);
    const invalid = vi.fn(async () => new Response(JSON.stringify({ id: "r", status: "completed", output: [] }))); const other = new RemoteResponsesBridge(new OpenAIResponsesProvider({ transport: invalid }));
    await expect(other.dispatch(f.dispatch(other))).rejects.toMatchObject({ code: "INVALID_RESPONSE" }); expect(invalid).toHaveBeenCalledTimes(1);
  });
});
