import { createHash } from "node:crypto";
import { ANALYSIS_RESULT_IDENTITY_VERSION, SafeDiagnosticError, canonicalJson, canonicalSnapshotResult, type ProjectSnapshot } from "@project-xray/contracts";

export function finalizeAnalysisSnapshot(draft: ProjectSnapshot): ProjectSnapshot {
  const fingerprint = createHash("sha256").update(canonicalSnapshotResult(draft)).digest("hex");
  const { analysisResult: _result, ...input } = draft.analysisIdentity;
  const snapshotId = createHash("sha256").update(canonicalJson(["analysis-result-snapshot", ANALYSIS_RESULT_IDENTITY_VERSION, draft.repositoryId, input, fingerprint])).digest("hex").slice(0, 24);
  const scopedId = (kind: string, id: string): string => createHash("sha256").update(canonicalJson([snapshotId, kind, id])).digest("hex").slice(0, 24);
  const proofs = new Map(draft.evidence.map(({ id, snapshotId: _snapshotId, ...proof }) => [id,
    ["project-indexer", "git-side-capture"].includes(proof.analyzer) && proof.kind === "file"
      ? createHash("sha256").update([snapshotId, proof.span.filePath, "file"].join("\u0000")).digest("hex").slice(0, 24)
      : scopedId("evidence", canonicalJson(proof))]));
  const proofId = (id: string): string => { const result = proofs.get(id); if (!result) throw new SafeDiagnosticError("SNAPSHOT_CONTENT_CONFLICT"); return result; };
  const edgeOccurrences = new Map<string, number>();
  return {
    ...draft, snapshotId, analysisIdentity: { ...input, analysisResult: { version: ANALYSIS_RESULT_IDENTITY_VERSION, fingerprint } },
    nodes: draft.nodes.map(node => ({ ...node, snapshotId, ...(node.evidenceId ? { evidenceId: proofId(node.evidenceId) } : {}) })),
    edges: draft.edges.map(({ id: _id, snapshotId: _snapshotId, ...edge }) => {
      const normalized = { ...edge, evidenceId: proofId(edge.evidenceId) }; const key = canonicalJson(normalized); const ordinal = edgeOccurrences.get(key) ?? 0; edgeOccurrences.set(key, ordinal + 1);
      return { ...normalized, id: scopedId("edge", canonicalJson([key, ordinal])), snapshotId };
    }),
    evidence: [...new Map(draft.evidence.map(item => { const proof = { ...item, id: proofId(item.id), snapshotId }; return [proof.id, proof]; })).values()],
  };
}
