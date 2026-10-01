import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson, type EvidencePackage } from "@project-xray/contracts";
import { validateRemoteNarrative } from "./output-validation.js";

function fixture() {
  const span = { filePath: "a.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 3 };
  const payload = { version: "1.0.0", repositoryId: "r", snapshotId: "s", purpose: "feature-explanation", query: "run", analysisIdentity: { graphIrVersion: "1.3.0", analyzerVersions: {}, configurationHash: "a".repeat(64), sourceFingerprint: "b".repeat(64), ignorePolicy: null, analysisResult: { version: "1.0.0", fingerprint: "c".repeat(64) } }, nodes: [{ id: "n", name: "run", kind: "function", filePath: "a.ts", evidenceIds: ["p"] }], edges: [], proofs: [{ id: "p", kind: "call-expression", span, sliceSpan: span, analyzer: "ts", analyzerVersion: "1", confidence: "verified", contentHash: "a".repeat(64), snippet: "run" }], pathEdgeIds: [], unknowns: ["unknown branch"], limitations: ["static only"], health: { status: "partial", failedCount: 1, failures: [] }, truncation: { reasons: ["query-truncated"], omittedNodes: 1, omittedEdges: 0, omittedProofs: 0, omittedUnknowns: 0, omittedLimitations: 0, omittedFailures: 0 } };
  const pack = { ...payload, packageId: createHash("sha256").update(canonicalJson(payload)).digest("hex") } as EvidencePackage;
  const narrative = { version: "1.0.0", repositoryId: "r", snapshotId: "s", packageId: pack.packageId, claims: [{ text: "Interpretation", evidenceIds: ["p"], confidence: "inferred" }], unknowns: [] };
  return { pack, narrative };
}
describe("whole-result validation", () => {
  it("preserves verified source proof separately from inferred narrative and local unknowns", () => {
    const { pack, narrative } = fixture(); const result = validateRemoteNarrative(narrative, pack);
    expect(result.narrative.claims[0]!.confidence).toBe("inferred"); expect(pack.proofs[0]!.confidence).toBe("verified"); expect(result.localUnknowns).toEqual(["unknown branch"]); expect(result.localTruncation.reasons).toEqual(["query-truncated"]);
  });
  it.each(["repositoryId", "snapshotId", "packageId"])("rejects wrong %s", field => {
    const { pack, narrative } = fixture(); expect(() => validateRemoteNarrative({ ...narrative, [field]: "x" }, pack)).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
  it.each([{ evidenceIds: [] }, { evidenceIds: ["absent"] }, { evidenceIds: ["p", "absent"] }, { evidenceIds: ["p", "p"] }])("rejects invalid citation list %j as an entire result", ({ evidenceIds }) => {
    const { pack, narrative } = fixture(); expect(() => validateRemoteNarrative({ ...narrative, claims: [...narrative.claims, { text: "bad", evidenceIds, confidence: "inferred" }] }, pack)).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
  it("requires unknown confidence for any unknown source proof without classifying prose", () => {
    const { pack, narrative } = fixture(); pack.proofs[0]!.confidence = "unknown"; const { packageId: _id, ...payload } = pack; pack.packageId = createHash("sha256").update(canonicalJson(payload)).digest("hex"); narrative.packageId = pack.packageId;
    expect(() => validateRemoteNarrative(narrative, pack)).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" })); narrative.claims[0]!.confidence = "unknown"; expect(validateRemoteNarrative(narrative, pack).narrative.claims[0]!.confidence).toBe("unknown");
  });
  it.each(["verified", "newEdges", "tool"])("rejects elevated or unexpected %s fields", mutation => {
    const { pack, narrative } = fixture(); const raw = mutation === "verified" ? { ...narrative, claims: [{ ...narrative.claims[0], confidence: "verified" }] } : { ...narrative, [mutation]: "execute something" };
    expect(() => validateRemoteNarrative(raw, pack)).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
  it("retains full locally omitted restrictions and fails if a caller tries to erase them", () => {
    const { pack, narrative } = fixture(); const local = { localUnknowns: [...pack.unknowns, "other"], localLimitations: pack.limitations };
    expect(validateRemoteNarrative(narrative, pack, local).localUnknowns).toEqual(["unknown branch", "other"]);
    expect(() => validateRemoteNarrative(narrative, pack, { ...local, localUnknowns: [] })).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
  });
});
