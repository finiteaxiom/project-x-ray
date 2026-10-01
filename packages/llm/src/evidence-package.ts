import { createHash } from "node:crypto";
import {
  canonicalJson, evidencePackageSchema, remoteAnalysisIdentitySchema, remoteEdgeSchema, remoteIdSchema, remoteNodeSchema, remoteProofSchema, remoteQuerySchema, remoteSpanSchema, remoteTextSchema,
  REMOTE_LIMITS, EVIDENCE_PACKAGE_VERSION, RemoteExplanationError, remoteUtf8Bytes,
  type AnalysisIdentity, type Evidence, type GraphNode, type GraphEdge, type EvidencePackage, type RemoteNode, type RemoteEdge, type RemoteProof, type RemoteTruncation,
} from "@project-xray/contracts";

export interface ImmutableSourcePort {
  readSource(filePath: string): { repositoryId: string; snapshotId: string; filePath: string; contentHash: string; content: string } | undefined;
}
export interface EvidencePackageInput {
  repositoryId: string; snapshotId: string; query: string; analysisIdentity: AnalysisIdentity;
  nodes: readonly GraphNode[]; edges: readonly GraphEdge[]; evidence: readonly Evidence[];
  sourceManifest: readonly { filePath: string; contentHash: string }[];
  unknowns: readonly string[]; limitations: readonly string[];
  health: { status: "ready" | "partial"; failedCount: number; failures: readonly { filePath: string; code: "analysis-failed" | "unavailable" | "unsupported" }[] };
  pathEdgeIds?: readonly string[];
}
export interface PreparedEvidencePackage { evidencePackage: EvidencePackage; localUnknowns: string[]; localLimitations: string[] }
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
// Responses embeds the canonical package as input_text, introducing a second JSON escaping layer.
const inputTextBytes = (pack: EvidencePackage): number => remoteUtf8Bytes(JSON.stringify(canonicalJson(pack)));
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort(compare);
function indexed<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) { const id = key(item); if (result.has(id)) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT"); result.set(id, item); }
  return result;
}
function exactSnippet(source: string, proof: Evidence): string | undefined {
  const { startLine, endLine, startColumn, endColumn } = proof.span;
  if (endLine - startLine + 1 > REMOTE_LIMITS.snippetLines) return undefined;
  const lines = source.split(/\r\n|\n|\r/);
  const first = lines[startLine - 1]; const last = lines[endLine - 1];
  if (first === undefined || last === undefined || startColumn > first.length || endColumn > last.length) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
  const splitSurrogate = (line: string, column: number): boolean => column > 0 && column < line.length && /[\uD800-\uDBFF]/u.test(line[column - 1]!) && /[\uDC00-\uDFFF]/u.test(line[column]!);
  if (splitSurrogate(first, startColumn) || splitSurrogate(last, endColumn)) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
  const selected = lines.slice(startLine - 1, endLine);
  selected[0] = selected[0]!.slice(startColumn);
  selected[selected.length - 1] = selected[selected.length - 1]!.slice(0, startLine === endLine ? endColumn - startColumn : endColumn);
  const snippet = selected.join("\n");
  return remoteUtf8Bytes(snippet) <= REMOTE_LIMITS.snippetBytes ? snippet : undefined;
}

/** Caller supplies an already bounded, immutable snapshot query, never a filesystem path. */
export function buildEvidencePackage(input: EvidencePackageInput, sourcePort: ImmutableSourcePort): PreparedEvidencePackage {
  try { return build(input, sourcePort); }
  catch (error) { if (error instanceof RemoteExplanationError) throw error; throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT"); }
}
function build(input: EvidencePackageInput, sourcePort: ImmutableSourcePort): PreparedEvidencePackage {
  // Bound work before iterating caller-owned arrays; the preceding local graph query remains authoritative.
  if (input.nodes.length > 80 || input.edges.length > 160 || input.evidence.length > 320 || input.sourceManifest.length > 80 || input.unknowns.length > 1200 || input.limitations.length > 1200 || input.health.failures.length > 1200 || (input.pathEdgeIds?.length ?? 0) > 160) throw new RemoteExplanationError("LIMIT_EXCEEDED");
  const repositoryId = remoteIdSchema.parse(input.repositoryId); const snapshotId = remoteIdSchema.parse(input.snapshotId); const query = remoteQuerySchema.parse(input.query);
  const identity = input.analysisIdentity;
  const analysisIdentity = remoteAnalysisIdentitySchema.parse({ graphIrVersion: identity.graphIrVersion, analyzerVersions: identity.analyzerVersions, configurationHash: identity.configurationHash, sourceFingerprint: identity.sourceFingerprint, ignorePolicy: identity.ignorePolicy ? { version: identity.ignorePolicy.version, hash: identity.ignorePolicy.hash } : null, analysisResult: identity.analysisResult });
  const localUnknowns = uniqueSorted(input.unknowns.map(value => remoteTextSchema.parse(value)));
  const localLimitations = uniqueSorted(input.limitations.map(value => remoteTextSchema.parse(value)));
  const rawNodes = indexed(input.nodes, item => item.id); const rawEdges = indexed(input.edges, item => item.id);
  const rawProofs = indexed(input.evidence, item => item.id); const manifests = indexed(input.sourceManifest, item => item.filePath);
  for (const item of [...rawNodes.values(), ...rawEdges.values(), ...rawProofs.values()]) if (item.snapshotId !== snapshotId) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
  const reasons = new Set<RemoteTruncation>(); const proofs = new Map<string, RemoteProof>(); const sourceCache = new Map<string, string>();
  for (const item of [...rawProofs.values()].sort((a, b) => compare(canonicalJson([a.span, a.id]), canonicalJson([b.span, b.id])))) {
    remoteSpanSchema.parse(item.span); // never call a source port with an unchecked relative path/range
    const manifest = manifests.get(item.span.filePath); if (!manifest) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
    let content = sourceCache.get(item.span.filePath);
    if (content === undefined) {
      const stored = sourcePort.readSource(item.span.filePath);
      if (!stored || stored.repositoryId !== repositoryId || stored.snapshotId !== snapshotId || stored.filePath !== item.span.filePath || stored.contentHash !== manifest.contentHash || remoteUtf8Bytes(stored.content) > 1048576 || hash(stored.content) !== manifest.contentHash) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
      content = stored.content; sourceCache.set(item.span.filePath, content);
    }
    const snippet = exactSnippet(content, item);
    if (snippet === undefined) { reasons.add("snippet-limit"); continue; }
    const projected = remoteProofSchema.safeParse({ id: item.id, kind: item.kind, span: item.span, analyzer: item.analyzer, analyzerVersion: item.analyzerVersion, confidence: item.confidence, contentHash: manifest.contentHash, snippet, sliceSpan: item.span });
    if (!projected.success) { reasons.add("unsupported-field"); continue; }
    proofs.set(item.id, projected.data);
  }
  const nodes = new Map<string, RemoteNode>(); const edges = new Map<string, RemoteEdge>(); const chosenProofs = new Map<string, RemoteProof>();
  function addGroup(nodeItems: GraphNode[], edgeItem?: GraphEdge): void {
    const projectedNodes: RemoteNode[] = [];
    for (const node of nodeItems) {
      const own = node.evidenceId ? [node.evidenceId] : [...proofs.values()].filter(proof => node.span && canonicalJson(proof.span) === canonicalJson(node.span)).map(proof => proof.id);
      const supporting = uniqueSorted([...own, ...(edgeItem ? [edgeItem.evidenceId] : [])]).filter(id => proofs.has(id)).slice(0, 8);
      const parsed = remoteNodeSchema.safeParse({ id: node.id, name: node.name, kind: node.kind, filePath: node.filePath ?? null, evidenceIds: supporting });
      if (!parsed.success) { reasons.add("unsupported-field"); return; } projectedNodes.push(parsed.data);
    }
    const edge = edgeItem ? remoteEdgeSchema.safeParse({ id: edgeItem.id, source: edgeItem.source, target: edgeItem.target, kind: edgeItem.kind, evidenceId: edgeItem.evidenceId, confidence: edgeItem.confidence, reason: edgeItem.reason }) : undefined;
    if (edge && (!edge.success || !proofs.has(edge.data.evidenceId))) { reasons.add("unsupported-field"); return; }
    const proposedNodes = new Map(nodes); for (const node of projectedNodes) { const prior = proposedNodes.get(node.id); proposedNodes.set(node.id, prior ? { ...node, evidenceIds: uniqueSorted([...prior.evidenceIds, ...node.evidenceIds]).slice(0, 8) } : node); }
    const proposedProofs = new Map<string, RemoteProof>(); for (const node of proposedNodes.values()) for (const id of node.evidenceIds) proposedProofs.set(id, proofs.get(id)!);
    for (const prior of edges.values()) proposedProofs.set(prior.evidenceId, proofs.get(prior.evidenceId)!);
    if (edge?.success) proposedProofs.set(edge.data.evidenceId, proofs.get(edge.data.evidenceId)!);
    if (proposedNodes.size > 24) { reasons.add("node-limit"); return; }
    if (edge?.success && edges.size >= 40) { reasons.add("edge-limit"); return; }
    if (proposedProofs.size > 24) { reasons.add("proof-limit"); return; }
    if ([...proposedProofs.values()].reduce((sum, proof) => sum + remoteUtf8Bytes(proof.snippet), 0) > REMOTE_LIMITS.sourceBytes) { reasons.add("source-byte-limit"); return; }
    nodes.clear(); for (const pair of proposedNodes) nodes.set(...pair); chosenProofs.clear(); for (const pair of proposedProofs) chosenProofs.set(...pair);
    if (edge?.success) edges.set(edge.data.id, edge.data);
  }
  const relevance = (node: GraphNode): number => Number(node.name.toLowerCase().includes(query.toLowerCase()));
  const orderedNodes = [...rawNodes.values()].sort((a, b) => relevance(b) - relevance(a) || compare(canonicalJson([a.filePath ?? "", a.span ?? null, a.id]), canonicalJson([b.filePath ?? "", b.span ?? null, b.id])));
  for (const node of orderedNodes) addGroup([node]);
  for (const edge of [...rawEdges.values()].sort((a, b) => compare(a.id, b.id))) {
    const source = rawNodes.get(edge.source); const target = rawNodes.get(edge.target);
    if (!source || !target || !rawProofs.has(edge.evidenceId)) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
    addGroup(source.id === target.id ? [source] : [source, target], edge);
  }
  if (localUnknowns.length > 24) reasons.add("unknown-limit"); if (localLimitations.length > 24) reasons.add("limitation-limit"); if (input.health.failures.length > 24) reasons.add("failure-limit");
  const requestedPath = input.pathEdgeIds ?? [];
  // A path is an all-or-nothing verified, connected edge sequence; no spliced or partial path.
  const pathEdgeIds = requestedPath.length <= 24 && new Set(requestedPath).size === requestedPath.length && requestedPath.every((id, i) => { const edge = edges.get(id); return edge?.confidence === "verified" && chosenProofs.get(edge.evidenceId)?.confidence === "verified" && (i === 0 || edges.get(requestedPath[i - 1]!)?.target === edge.source); }) ? [...requestedPath] : [];
  if (requestedPath.length && !pathEdgeIds.length) reasons.add("query-truncated");
  function finalize(): EvidencePackage {
    const payload = {
      version: EVIDENCE_PACKAGE_VERSION as typeof EVIDENCE_PACKAGE_VERSION, repositoryId, snapshotId, purpose: "feature-explanation" as const, query, analysisIdentity,
      nodes: [...nodes.values()].sort((a,b) => compare(a.id,b.id)), edges: [...edges.values()].sort((a,b) => compare(a.id,b.id)), proofs: [...chosenProofs.values()].sort((a,b) => compare(a.id,b.id)), pathEdgeIds,
      unknowns: localUnknowns.slice(0,24), limitations: localLimitations.slice(0,24), health: { ...input.health, failures: [...input.health.failures].sort((a,b) => compare(canonicalJson(a), canonicalJson(b))).slice(0,24) },
      truncation: { reasons: [...reasons].sort(compare), omittedNodes: rawNodes.size - nodes.size, omittedEdges: rawEdges.size - edges.size, omittedProofs: rawProofs.size - chosenProofs.size, omittedUnknowns: Math.max(0,localUnknowns.length-24), omittedLimitations: Math.max(0,localLimitations.length-24), omittedFailures: Math.max(0,input.health.failures.length-24) },
    };
    return { ...payload, packageId: hash(canonicalJson(payload)) };
  }
  let result = finalize();
  // Reserve 16 KiB for prompt/schema/model so a preview always fits the provider's full body budget.
  while (inputTextBytes(result) > REMOTE_LIMITS.requestBytes - 16384 && nodes.size > 1) {
    reasons.add("package-byte-limit"); const id = [...nodes.keys()].sort(compare).at(-1)!; nodes.delete(id);
    for (const [edgeId, edge] of edges) if (edge.source === id || edge.target === id) edges.delete(edgeId);
    const used = new Set([...nodes.values()].flatMap(node => node.evidenceIds).concat([...edges.values()].map(edge => edge.evidenceId)));
    for (const proofId of chosenProofs.keys()) if (!used.has(proofId)) chosenProofs.delete(proofId);
    if (pathEdgeIds.some(edgeId => !edges.has(edgeId))) { pathEdgeIds.length = 0; reasons.add("query-truncated"); }
    result = finalize();
  }
  if (!nodes.size || !chosenProofs.size || inputTextBytes(result) > REMOTE_LIMITS.requestBytes - 16384) throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT");
  return { evidencePackage: verifyEvidencePackage(result), localUnknowns, localLimitations };
}

export function verifyEvidencePackage(raw: unknown): EvidencePackage {
  try {
    const pack = evidencePackageSchema.parse(raw); const { packageId, ...payload } = pack;
    if (hash(canonicalJson(payload)) !== packageId) throw new Error();
    const nodes = indexed(pack.nodes, item => item.id); const proofs = indexed(pack.proofs, item => item.id); const edges = indexed(pack.edges, item => item.id);
    for (const proof of proofs.values()) if (canonicalJson(proof.span) !== canonicalJson(proof.sliceSpan) || proof.snippet.split("\n").length > 40) throw new Error();
    const used = new Set<string>();
    for (const node of nodes.values()) for (const id of node.evidenceIds) { if (!proofs.has(id)) throw new Error(); used.add(id); }
    const confidenceRank = { verified: 0, inferred: 1, unknown: 2 };
    for (const edge of edges.values()) { const proof = proofs.get(edge.evidenceId); if (!nodes.has(edge.source) || !nodes.has(edge.target) || !proof || confidenceRank[edge.confidence] < confidenceRank[proof.confidence]) throw new Error(); used.add(edge.evidenceId); }
    if (used.size !== proofs.size || new Set(pack.pathEdgeIds).size !== pack.pathEdgeIds.length) throw new Error();
    for (const [i,id] of pack.pathEdgeIds.entries()) { const edge = edges.get(id); if (!edge || edge.confidence !== "verified" || proofs.get(edge.evidenceId)?.confidence !== "verified" || (i > 0 && edges.get(pack.pathEdgeIds[i-1]!)?.target !== edge.source)) throw new Error(); }
    return pack;
  } catch { throw new RemoteExplanationError("EVIDENCE_INSUFFICIENT"); }
}
