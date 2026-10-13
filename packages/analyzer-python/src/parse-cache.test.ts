import { describe, expect, it } from "vitest";
import { PythonParseReuseSession, parseHash } from "./parse-cache.js";
const scope = { repositoryId: "repo", rootPath: "root", configurationHash: "config", ignoreRevision: 0, analyzerVersion: "v" };
const sources = ["a", "b", "c"].map(absolutePath => ({ absolutePath, content: absolutePath }));
const tool = { workerDigest: "d".repeat(64), runtimeFingerprint: "e".repeat(64) };
const decode = (s: string) => JSON.parse(s) as typeof tool;
describe("bounded Python reuse sessions", () => {
  it("copies caller state, probes misses first and preserves fresh payload objects", async () => {
    const first = new PythonParseReuseSession(scope, []); await first.prepare(sources, p => p, async () => ({ ...tool }), decode, () => tool.workerDigest, () => {});
    const records = first.records(), next = new PythonParseReuseSession(scope, records); records[1]!.payload = "{}"; const calls: string[] = [];
    const result = await next.prepare(sources, p => p, async p => { calls.push(p); return { ...tool }; }, decode, () => tool.workerDigest, () => {}); expect(calls).toEqual(["a"]); expect(next.stats.hits).toBe(2); expect(result.get("b")).not.toBe(result.get("c"));
    const changed = new PythonParseReuseSession(scope, first.records()); const misses: string[] = []; await changed.prepare(sources.map(s => s.absolutePath === "c" ? { ...s, content: "changed" } : s), p => p, async p => { misses.push(p); return { ...tool }; }, decode, () => tool.workerDigest, () => {}); expect(misses).toEqual(["c"]);
  });
  it("runtime change discards hits and has at most one cold retry; continuous change fails closed", async () => {
    const first = new PythonParseReuseSession(scope, []); await first.prepare(sources, p => p, async () => ({ ...tool }), decode, () => tool.workerDigest, () => {});
    const next = new PythonParseReuseSession(scope, first.records()); let call = 0;
    await next.prepare(sources.map(s => s.absolutePath !== "a" ? { ...s, content: "edited" } : s), p => p, async () => ({ ...tool, runtimeFingerprint: ++call === 1 ? tool.runtimeFingerprint : "f".repeat(64) }), decode, () => tool.workerDigest, () => {});
    expect(next.stats).toMatchObject({ hits: 0, fallbackPasses: 1, workerRequests: 5 });
    const unstable = new PythonParseReuseSession(scope, []); let changes = 0; await expect(unstable.prepare(sources, p => p, async () => ({ ...tool, runtimeFingerprint: String(++changes) }), decode, () => tool.workerDigest, () => {})).rejects.toThrow("identity changed"); expect(unstable.stats.fallbackPasses).toBe(1); expect(unstable.records()).toEqual([]);
  });
  it("probe failure never consumes previous successes; invalid codec/digest cannot hit", async () => {
    const first = new PythonParseReuseSession(scope, []); await first.prepare(sources, p => p, async () => ({ ...tool }), decode, () => tool.workerDigest, () => {});
    const next = new PythonParseReuseSession(scope, first.records()); let calls = 0; await next.prepare(sources, p => p, async () => { if (++calls === 1) throw new Error("unavailable"); return { ...tool }; }, decode, () => tool.workerDigest, () => {}); expect(calls).toBe(3); expect(next.stats.hits).toBe(0); expect(next.records()).toEqual([]);
    const records = first.records(); records[1]!.digest = parseHash("wrong"); const bad = new PythonParseReuseSession(scope, records); await bad.prepare(sources, p => p, async () => ({ ...tool }), () => undefined, () => tool.workerDigest, () => {}); expect(bad.stats.workerRequests).toBe(3); expect(bad.stats.hits).toBe(0);
  });
});
