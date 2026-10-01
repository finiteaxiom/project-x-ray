import type { ProjectSnapshot } from "./index.js";

/** Deterministic JSON: object key order is irrelevant, array order is preserved. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function sorted(values: unknown[]): unknown[] { return values.map(value => ({ value, key: canonicalJson(value) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.value); }
function healthContent(snapshot: ProjectSnapshot): unknown {
  return { ...snapshot.health, failedFiles: sorted(snapshot.health.failedFiles), ignoredByRule: sorted(snapshot.health.ignoredByRule), limitations: sorted(snapshot.health.limitations) };
}

/** Hashable facts, with snapshot-dependent IDs replaced by the actual supporting evidence. */
export function canonicalSnapshotResult(snapshot: ProjectSnapshot): string {
  const proofs = new Map(snapshot.evidence.map(({ id, snapshotId: _snapshotId, ...proof }) => [id, proof]));
  const { analysisResult: _result, ...inputIdentity } = snapshot.analysisIdentity;
  return canonicalJson({
    repositoryId: snapshot.repositoryId, name: snapshot.name, rootPath: snapshot.rootPath, sourceType: snapshot.sourceType, gitHead: snapshot.gitHead,
    analysisIdentity: inputIdentity, sourceFiles: sorted(snapshot.sourceFiles), health: healthContent(snapshot),
    nodes: sorted(snapshot.nodes.map(({ snapshotId: _snapshotId, evidenceId, ...node }) => ({ ...node, ...(evidenceId ? { proof: proofs.get(evidenceId) ?? { missingEvidence: evidenceId } } : {}) }))),
    edges: sorted(snapshot.edges.map(({ id: _id, snapshotId: _snapshotId, evidenceId, ...edge }) => ({ ...edge, proof: proofs.get(evidenceId) ?? { missingEvidence: evidenceId } }))),
    evidence: sorted([...new Map([...proofs.values()].map(proof => [canonicalJson(proof), proof])).values()]),
  });
}

/** Complete immutable payload, excluding only its original publication timestamp. */
export function canonicalSnapshotContent(snapshot: ProjectSnapshot): string {
  const { createdAt: _createdAt, ...content } = snapshot;
  return canonicalJson({ ...content, sourceFiles: sorted(snapshot.sourceFiles), nodes: sorted(snapshot.nodes), edges: sorted(snapshot.edges), evidence: sorted(snapshot.evidence), health: healthContent(snapshot) });
}
