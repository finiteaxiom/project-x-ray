import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GraphStore } from "./index.js";
import { captureSemanticPrepareRequest, semanticPreparationFailure } from "./ownership-semantic-preparation-store.js";
const request = () => ({ repositoryId: "repo", snapshotId: "snap", attemptId: "attempt", contextHandle: randomUUID(), purpose: "ownership-semantic-assessment" });
describe("semantic preparation internal boundary", () => {
  it("inner and outer fixed byte-limit errors both retain REQUEST_TOO_LARGE without text", () => {
    for (const code of ["PROMPT_REQUEST_TOO_LARGE", "REQUEST_TOO_LARGE", "LIMIT_EXCEEDED"]) {
      const error = semanticPreparationFailure(Object.assign(Error("private body and answer"), { code }));
      expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE", message: "所有权语义准备失败" });
    }
    expect(semanticPreparationFailure(Object.assign(Error("private"), { code: "INVALID_PREPARED_REQUEST" })).code).toBe("INVALID_MATERIAL");
  });
  it("strict five-field capture rejects proxy without running traps, accessors, hidden and extras", () => {
    let reads = 0;
    const proxy = new Proxy(request(), { ownKeys: () => { reads++; return []; } });
    const getter = request(); Object.defineProperty(getter, "attemptId", { enumerable: true, get: () => { reads++; return "attempt"; } });
    const hidden = request(); Object.defineProperty(hidden, "private", { value: 1 });
    for (const value of [proxy, getter, hidden, { ...request(), extra: true }, { ...request(), attemptId: NaN }, { ...request(), purpose: "feature-explanation" }]) expect(() => captureSemanticPrepareRequest(value)).toThrow("所有权语义准备失败");
    expect(reads).toBe(0);
  });
  it("unconfigured compiled ports and ordinary/escaped receipt objects have no authority", async () => {
    const store = new GraphStore();
    try {
      await expect(store.prepareOwnershipSemanticBinding(captureSemanticPrepareRequest(request()), store, store, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
      expect(() => store.withOwnershipSemanticRevisions({} as never, () => undefined)).toThrow("所有权语义准备失败");
      expect(() => store.consumeOwnershipSemanticRevision({} as never)).toThrow("所有权语义准备失败");
    } finally { store.close(); }
  });
});
