import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson, type Evidence, type GraphEdge, type GraphNode } from "@project-xray/contracts";
import { buildEvidencePackage, verifyEvidencePackage, type EvidencePackageInput, type ImmutableSourcePort } from "./evidence-package.js";

function fixture(content = "function run(){ return next(); }\nfunction next(){return 1;}\n") {
  const contentHash = createHash("sha256").update(content).digest("hex");
  const span = { filePath: "entry.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: content.split("\n")[0]!.length };
  const proof: Evidence = { id: "proof", snapshotId: "snap", kind: "call-expression", confidence: "verified", analyzer: "typescript", analyzerVersion: "1.0.0", reason: "source observation", span };
  const nodes: GraphNode[] = ["run", "next"].map(id => ({ id, snapshotId: "snap", kind: "function", name: id, qualifiedName: id, filePath: "entry.ts", evidenceId: "proof", span, metadata: { private: "MUST_NOT_LEAVE" } }));
  const edges: GraphEdge[] = [{ id: "call", snapshotId: "snap", source: "run", target: "next", kind: "CALLS", confidence: "verified", evidenceId: "proof", reason: "static binding" }];
  const input: EvidencePackageInput = { repositoryId: "repo", snapshotId: "snap", query: "run", analysisIdentity: { graphIrVersion: "1.3.0", configurationHash: "a".repeat(64), sourceFingerprint: "b".repeat(64), analyzerVersions: { typescript: "1.0.0" }, analysisResult: { version: "1.0.0", fingerprint: "c".repeat(64) } }, nodes, edges, evidence: [proof], sourceManifest: [{ filePath: "entry.ts", contentHash }], unknowns: ["dynamic behavior unknown"], limitations: ["static path is not runtime"], health: { status: "ready", failedCount: 0, failures: [] }, pathEdgeIds: ["call"] };
  const sourcePort: ImmutableSourcePort = { readSource: filePath => ({ repositoryId: "repo", snapshotId: "snap", filePath, contentHash, content }) };
  return { input, sourcePort, proof, contentHash };
}
describe("immutable evidence projection", () => {
  it("projects real ranges, hashes source, closes references and drops private metadata", () => {
    const f = fixture(); const result = buildEvidencePackage(f.input, f.sourcePort); const pack = result.evidencePackage;
    expect(pack.proofs[0]).toMatchObject({ contentHash: f.contentHash, span: f.proof.span, sliceSpan: f.proof.span });
    expect(pack.proofs[0]!.snippet).toBe("function run(){ return next(); }");
    expect(pack.pathEdgeIds).toEqual(["call"]); expect(canonicalJson(pack)).not.toContain("MUST_NOT_LEAVE"); expect(verifyEvidencePackage(pack)).toEqual(pack);
  });
  it("is deterministic over node/proof/input order and analyzer key order", () => {
    const f = fixture(); const first = buildEvidencePackage(f.input, f.sourcePort);
    const second = buildEvidencePackage({ ...f.input, nodes: [...f.input.nodes].reverse(), unknowns: [...f.input.unknowns, ...f.input.unknowns] }, f.sourcePort);
    expect(second).toEqual(first);
  });
  it.each(["source", "confidence", "range", "query", "analysis-result"])("identity changes for %s", mutation => {
    const f = fixture(); const first = buildEvidencePackage(f.input, f.sourcePort).evidencePackage.packageId;
    if (mutation === "source") { const changed = fixture("function run(){ return next(2); }\nfunction next(){return 1;}\n"); expect(buildEvidencePackage(changed.input, changed.sourcePort).evidencePackage.packageId).not.toBe(first); return; }
    if (mutation === "confidence") { f.proof.confidence = "unknown"; f.input.edges[0]!.confidence = "unknown"; }
    if (mutation === "range") f.proof.span.endColumn--;
    if (mutation === "query") f.input.query = "next";
    if (mutation === "analysis-result") f.input.analysisIdentity.analysisResult!.fingerprint = "d".repeat(64);
    expect(buildEvidencePackage(f.input, f.sourcePort).evidencePackage.packageId).not.toBe(first);
  });
  it.each(["hash", "repository", "snapshot", "missing"])("rejects source port %s mismatch", mismatch => {
    const f = fixture(); const port: ImmutableSourcePort = { readSource: path => mismatch === "missing" ? undefined : { repositoryId: mismatch === "repository" ? "other" : "repo", snapshotId: mismatch === "snapshot" ? "old" : "snap", filePath: path, contentHash: f.contentHash, content: mismatch === "hash" ? "tampered" : f.sourcePort.readSource(path)!.content } };
    expect(() => buildEvidencePackage(f.input, port)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
  });
  it.each(["node", "edge", "proof"])("rejects wrong snapshot on %s", kind => {
    const f = fixture(); const item = kind === "node" ? f.input.nodes[0]! : kind === "edge" ? f.input.edges[0]! : f.proof; item.snapshotId = "old";
    expect(() => buildEvidencePackage(f.input, f.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
  });
  it("rejects missing edge target, supporting proof and duplicate identity", () => {
    for (const mutation of ["target", "proof", "duplicate"]) { const f = fixture(); if (mutation === "target") f.input.edges[0]!.target = "absent"; if (mutation === "proof") f.input.edges[0]!.evidenceId = "absent"; if (mutation === "duplicate") f.input.nodes = [...f.input.nodes, f.input.nodes[0]!]; expect(() => buildEvidencePackage(f.input, f.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" })); }
  });
  it("keeps all local unknowns while bounding outflow and preserves omitted counts", () => {
    const f = fixture(); f.input.unknowns = Array.from({ length: 30 }, (_, i) => `unknown ${i}`); f.input.limitations = Array.from({ length: 28 }, (_, i) => `limit ${i}`);
    const result = buildEvidencePackage(f.input, f.sourcePort); expect(result.localUnknowns).toHaveLength(30); expect(result.localLimitations).toHaveLength(28); expect(result.evidencePackage.unknowns).toHaveLength(24); expect(result.evidencePackage.truncation).toMatchObject({ omittedUnknowns: 6, omittedLimitations: 4 });
  });
  it("clips by complete proof selection, never splits a Unicode source range", () => {
    const f = fixture("😀run()\n"); f.proof.span.startColumn = 1;
    expect(() => buildEvidencePackage(f.input, f.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
    f.proof.span.startColumn = 0; expect(buildEvidencePackage(f.input, f.sourcePort).evidencePackage.proofs[0]!.snippet).toBe("😀run()");
  });
  it("fails when no full proof fits line/byte budgets instead of falsifying evidence", () => {
    const f = fixture("a".repeat(4097) + "\n"); expect(() => buildEvidencePackage(f.input, f.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
    const lines = fixture(Array.from({ length: 41 }, () => "x").join("\n")); lines.proof.span.endLine = 41; lines.proof.span.endColumn = 1; expect(() => buildEvidencePackage(lines.input, lines.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
  });
  it("bounds a large graph, never leaves dangling references", () => {
    const f = fixture(); f.input.nodes = Array.from({ length: 50 }, (_, i) => ({ ...f.input.nodes[0]!, id: `node${i}`, name: `node${i}` })); f.input.edges = []; f.input.pathEdgeIds = [];
    const result = buildEvidencePackage(f.input, f.sourcePort).evidencePackage; expect(result.nodes).toHaveLength(24); expect(result.truncation.omittedNodes).toBe(26); expect(result.truncation.reasons).toContain("node-limit"); expect(verifyEvidencePackage(result)).toEqual(result);
  });
  it("drops an incomplete/unknown ordered path rather than emitting a partial chain", () => {
    const f = fixture(); f.input.edges[0]!.confidence = "unknown";
    const pack = buildEvidencePackage(f.input, f.sourcePort).evidencePackage; expect(pack.pathEdgeIds).toEqual([]); expect(pack.truncation.reasons).toContain("query-truncated");
  });
  it("rejects an edge with stronger confidence than its supporting proof", () => {
    const f = fixture(); f.proof.confidence = "unknown";
    expect(() => buildEvidencePackage(f.input, f.sourcePort)).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
  });
  it("rejects unsafe proof paths before consulting the source port", () => {
    const f = fixture(); f.proof.span.filePath = "../secret.ts"; const readSource = vi.fn(f.sourcePort.readSource);
    expect(() => buildEvidencePackage(f.input, { readSource })).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" })); expect(readSource).not.toHaveBeenCalled();
  });
  it("bounds total source bytes and explicitly reports omitted proofs", () => {
    const f = fixture("x".repeat(4000) + "\n"); f.input.edges = []; f.input.pathEdgeIds = [];
    const nodes = Array.from({ length: 10 }, (_, i) => ({ ...f.input.nodes[0]!, id: `n${i}`, evidenceId: `p${i}` }));
    f.input.nodes = nodes; f.input.evidence = nodes.map((_node, i) => ({ ...f.proof, id: `p${i}` }));
    const pack = buildEvidencePackage(f.input, f.sourcePort).evidencePackage;
    expect(pack.proofs).toHaveLength(6); expect(pack.truncation.omittedProofs).toBe(4); expect(pack.truncation.reasons).toContain("source-byte-limit"); expect(pack.nodes).toHaveLength(6);
  });
  it("bounds proof count with a closed two-node multi-call graph", () => {
    const f = fixture(); f.input.evidence = Array.from({ length: 30 }, (_, i) => ({ ...f.proof, id: `p${String(i).padStart(2,"0")}` }));
    f.input.nodes = f.input.nodes.map(node => ({ ...node, evidenceId: "p00" }));
    f.input.edges = f.input.evidence.map((proof, i) => ({ ...f.input.edges[0]!, id: `e${String(i).padStart(2,"0")}`, evidenceId: proof.id })); f.input.pathEdgeIds = [];
    const pack = buildEvidencePackage(f.input, f.sourcePort).evidencePackage; expect(pack.proofs).toHaveLength(24); expect(pack.truncation.omittedProofs).toBe(6); expect(pack.truncation.reasons).toContain("proof-limit"); expect(verifyEvidencePackage(pack)).toEqual(pack);
  });
  it("budgets the second JSON escaping layer used by Responses input_text", () => {
    const f = fixture(); f.input.edges = []; f.input.pathEdgeIds = [];
    f.input.nodes = Array.from({ length: 24 }, (_, i) => ({ ...f.input.nodes[0]!, id: `n${i}`, name: "\\".repeat(256) }));
    f.input.unknowns = Array.from({ length: 24 }, (_, i) => `${i}:${"plain".repeat(130)}`); f.input.limitations = Array.from({ length: 24 }, (_, i) => `${i}:${"plain".repeat(130)}`);
    const pack = buildEvidencePackage(f.input, f.sourcePort).evidencePackage;
    expect(new TextEncoder().encode(JSON.stringify(canonicalJson(pack))).length).toBeLessThanOrEqual(49152);
    expect(pack.truncation.reasons).toContain("package-byte-limit"); expect(pack.nodes.length).toBeLessThan(24);
  });
  it("detects altered body without a new package digest and redacts source port errors", () => {
    const f = fixture(); const pack = buildEvidencePackage(f.input, f.sourcePort).evidencePackage;
    expect(() => verifyEvidencePackage({ ...pack, query: "tamper" })).toThrowError(expect.objectContaining({ code: "EVIDENCE_INSUFFICIENT" }));
    try { buildEvidencePackage(f.input, { readSource: () => { throw new Error("SECRET SOURCE PATH"); } }); } catch (error) { expect(String(error)).not.toContain("SECRET"); expect(error).toMatchObject({ code: "EVIDENCE_INSUFFICIENT" }); }
  });
});
