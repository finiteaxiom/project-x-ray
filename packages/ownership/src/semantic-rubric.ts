import {
  canonicalJson, canonicalSnapshotResult, ownershipAttemptSchema, ownershipGradeSchema, ownershipQuestionSchema, ownershipSubmissionSchema, projectSnapshotSchema,
  computeOwnershipAttemptHash, computeOwnershipCapsuleHash, computeOwnershipQuestionFingerprint, computeOwnershipSubmissionProjectionHash, digestOwnershipPreimage,
  computeOwnershipLimitationId, computeOwnershipPackageId, computeOwnershipRubricHash, hashOwnershipAnswer, validateOwnershipSemanticPackage,
  OwnershipCapsuleError, ownershipCapsuleSchema, ownershipCapsuleSourceIdentitySchema, ownershipReadyCapsuleSchema, ownershipSemanticPackageSchema, remoteAnalysisIdentitySchema, remoteProofSchema, remoteUtf8Bytes,
  type OwnershipAttempt, type OwnershipCapsule, type OwnershipCapsuleContent, type OwnershipCapsuleReason, type OwnershipCapsuleSourceIdentity, type OwnershipGrade, type OwnershipQuestion, type OwnershipRoleBinding, type OwnershipSemanticPackage, type OwnershipSubmission, type ProjectSnapshot, type SourceCitation, type GraphEdge,
} from "@project-xray/contracts";
import { gradeAnswer } from "./index.js";

export interface OwnershipRubricSource { repositoryId: string; snapshotId: string; filePath: string; contentHash: string; content: string }
export interface OwnershipRubricInput { question: OwnershipQuestion; submission: OwnershipSubmission; grade: OwnershipGrade; attempt: OwnershipAttempt; snapshot: ProjectSnapshot; validatedCitations: SourceCitation[]; sourceIdentity: OwnershipCapsuleSourceIdentity; sources: OwnershipRubricSource[] }
class NotEvaluated { constructor(readonly reason: OwnershipCapsuleReason) {} }
function unavailable(reason: OwnershipCapsuleReason): never { throw new NotEvaluated(reason); }
function fail(): never { throw new OwnershipCapsuleError(); }
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const citationKey = (value: SourceCitation): string => canonicalJson(value);
function wellFormed(value: string): boolean { for (let i = 0; i < value.length; i++) { const unit = value.charCodeAt(i); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; } else if (unit >= 0xdc00 && unit <= 0xdfff) return false; } return true; }
function copyData<T>(value: T): T {
  function check(item: unknown): void {
    if (item === null || typeof item === "string" || typeof item === "boolean" || item === undefined) return;
    if (typeof item === "number") { if (!Number.isFinite(item)) fail(); return; }
    if (typeof item !== "object" || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) fail();
    if (Object.getOwnPropertySymbols(item).length) fail();
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) { if (descriptor.get || descriptor.set) fail(); check(descriptor.value); }
  }
  check(value); return structuredClone(value);
}

/** Pure, caller-provided indexed facts and immutable source data; no filesystem, DB or model. */
export async function buildOwnershipRubricCapsule(raw: OwnershipRubricInput): Promise<OwnershipCapsule> {
  try { return await build(copyData(raw)); } catch (error) { if (error instanceof OwnershipCapsuleError) throw error; fail(); }
}
async function build(input: OwnershipRubricInput): Promise<OwnershipCapsule> {
  const { question: q, submission: submission, grade, attempt, snapshot, validatedCitations: citations, sourceIdentity } = input;
  ownershipQuestionSchema.parse(q); ownershipSubmissionSchema.parse(submission); ownershipGradeSchema.parse(grade); ownershipAttemptSchema.parse(attempt); projectSnapshotSchema.parse(snapshot); ownershipCapsuleSourceIdentitySchema.parse(sourceIdentity);
  if ([q, submission, attempt, grade].some(item => item.repositoryId !== snapshot.repositoryId || item.snapshotId !== snapshot.snapshotId) || submission.questionId !== q.id || attempt.questionId !== q.id || grade.questionId !== q.id || submission.questionVersion !== q.version || attempt.questionVersion !== q.version || attempt.questionKind !== q.kind || attempt.variantKey !== q.variantKey || !same(attempt.concept, q.concept) || attempt.semanticText !== submission.answer || attempt.legacy || attempt.scoringVersion !== grade.scoringVersion || attempt.locationScore !== grade.location.score || attempt.structureScore !== grade.structure.score || attempt.passed !== grade.passed || !same(citations, grade.validatedCitations) || !same(citations, attempt.citations) || !same(grade, gradeAnswer(q, submission, snapshot, citations))) fail();
  const indices = new Map(citations.map((item, index) => [citationKey(item), index])); if (indices.size !== citations.length) fail();
  const citationOrder = submission.citations.map(item => { const index = indices.get(citationKey(item)); if (index === undefined) fail(); return index; });
  if (sorted(citationOrder.map(String)).length !== citations.length) fail();
  const normalized = submission.structuredAnswer.kind === "variable-flow" ? { ...submission.structuredAnswer, roles: submission.structuredAnswer.roles.map(role => ({ ...role, citationIndex: citationOrder[role.citationIndex] ?? role.citationIndex })) } : submission.structuredAnswer;
  if (!same(normalized, attempt.structuredAnswer)) fail();
  const questionFingerprint = await computeOwnershipQuestionFingerprint(q), attemptHash = await computeOwnershipAttemptHash(attempt);
  const answerHash = wellFormed(submission.answer) && remoteUtf8Bytes(submission.answer) <= 16384 ? await hashOwnershipAnswer(submission.answer) : null;
  let submissionProjectionHash: string | null = null;
  const roleBindings: OwnershipRoleBinding[] = [];
  const finish = async (content: OwnershipCapsuleContent): Promise<OwnershipCapsule> => ownershipCapsuleSchema.parse({ ...content, capsuleHash: await computeOwnershipCapsuleHash(content) });
  const fallback = (reason: OwnershipCapsuleReason) => finish({ version: "1.0.0", builderVersion: "1.0.0", status: "not-evaluated", reason, questionFingerprint, attemptHash, answerHash, submissionProjectionHash, sourceIdentity });
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node])), edges = new Map(snapshot.edges.map(edge => [edge.id, edge])), evidence = new Map(snapshot.evidence.map(proof => [proof.id, proof]));
  if (nodes.size !== snapshot.nodes.length || edges.size !== snapshot.edges.length || evidence.size !== snapshot.evidence.length) fail();
  if ([...snapshot.nodes, ...snapshot.edges, ...snapshot.evidence].some(item => item.snapshotId !== snapshot.snapshotId)) fail();
  // Captured identity is data, not authority: independently bind it to the supplied snapshot.
  const manifest = [...snapshot.sourceFiles].sort((a, b) => a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0);
  if (new Set(manifest.map(file => file.filePath)).size !== manifest.length) fail();
  const manifestHash = await digestOwnershipPreimage(canonicalJson(manifest));
  if (sourceIdentity.sourceManifestHash !== null && sourceIdentity.sourceManifestHash !== manifestHash || sourceIdentity.configurationHash !== null && sourceIdentity.configurationHash !== snapshot.analysisIdentity.configurationHash || sourceIdentity.ignorePolicyHash !== (snapshot.analysisIdentity.ignorePolicy?.hash ?? null) || sourceIdentity.analysisResultFingerprint !== null && sourceIdentity.analysisResultFingerprint !== snapshot.analysisIdentity.analysisResult?.fingerprint) fail();
  if (snapshot.analysisIdentity.analysisResult && snapshot.analysisIdentity.analysisResult.fingerprint !== await digestOwnershipPreimage(canonicalSnapshotResult(snapshot))) fail();
  try {
    if (q.deterministicChecks.length !== 1 || submission.structuredAnswer.kind !== q.kind) unavailable("unsupported-question-shape");
    if (!wellFormed(submission.answer)) unavailable("answer-encoding-unavailable");
    if (answerHash === null) unavailable("answer-budget-exceeded");
    if (submission.citations.length > 24 || citations.length > 24) unavailable("package-budget-exceeded");
    const analysis = remoteAnalysisIdentitySchema.safeParse({ ...snapshot.analysisIdentity, ignorePolicy: snapshot.analysisIdentity.ignorePolicy ?? null });
    if (!analysis.success || Object.entries(sourceIdentity).some(([key, value]) => key !== "ignorePolicyHash" && value === null)) unavailable("analysis-identity-unavailable");
    const cited = new Set<string>();
    for (const citation of citations) {
      const proof = citation.evidenceId ? evidence.get(citation.evidenceId) : undefined;
      if (!proof || proof.snapshotId !== snapshot.snapshotId || !manifest.some(file => file.filePath === citation.filePath)) fail();
      const { evidenceId: _id, ...span } = citation;
      // Overlap is legal locally, but a semantic proof cannot silently expand the user's range.
      if (!same(span, proof.span)) unavailable("citation-not-exact");
      cited.add(proof.id);
    }
    const selected: GraphEdge[] = []; const groups: { key: string; proposition: string; proofIds: string[] }[] = [];
    let selectedPath: { nodeIds: string[]; edgeIds: string[] } | null = null;
    const checked = (id: string, kind: GraphEdge["kind"], proofKind: string): GraphEdge => {
      const edge = edges.get(id), proof = edge ? evidence.get(edge.evidenceId) : undefined;
      if (!edge || edge.snapshotId !== snapshot.snapshotId || edge.kind !== kind || edge.confidence !== "verified" || !nodes.has(edge.source) || !nodes.has(edge.target) || !proof || proof.snapshotId !== snapshot.snapshotId || proof.confidence !== "verified") unavailable("missing-required-proof");
      if (proof.kind !== proofKind) unavailable("unsupported-proof-kind");
      return edge;
    };
    const check = q.deterministicChecks[0]!;
    if (check.kind === "definition" && q.kind === "entry" && submission.structuredAnswer.kind === "entry") {
      if (submission.structuredAnswer.nodeId !== check.nodeId) unavailable("structured-answer-mismatch");
      const edge = checked(check.edgeId, "DEFINES", "symbol-definition"), node = nodes.get(check.nodeId);
      if (edge.target !== check.nodeId || !node || !["function", "method", "class"].includes(node.kind) || node.filePath !== evidence.get(edge.evidenceId)!.span.filePath) unavailable("missing-required-proof");
      selected.push(edge); groups.push({ key: `definition:${edge.id}`, proposition: `在引用的定义处，${node.name} 是声明的 ${node.kind}；只解释定义位置和种类。`, proofIds: [edge.evidenceId] });
    } else if (check.kind === "call-direction" && q.kind === "call-direction" && submission.structuredAnswer.kind === "call-direction") {
      if (submission.structuredAnswer.callerNodeId !== check.sourceNodeId || submission.structuredAnswer.calleeNodeId !== check.targetNodeId) unavailable("structured-answer-mismatch");
      const edge = checked(check.edgeId, "CALLS", "call-expression");
      if (edge.source !== check.sourceNodeId || edge.target !== check.targetNodeId) unavailable("missing-required-proof");
      selected.push(edge); groups.push({ key: `direction:${edge.id}`, proposition: `该静态调用表达式中，${nodes.get(edge.source)!.name} 调用 ${nodes.get(edge.target)!.name}；不能反转调用方向。`, proofIds: [edge.evidenceId] });
    } else if (check.kind === "ordered-path" && q.kind === "call-path" && submission.structuredAnswer.kind === "call-path") {
      if (check.legalNodePaths.length !== check.legalEdgePaths.length) unavailable("incomplete-selected-path");
      const answerNodes = submission.structuredAnswer.nodeIds;
      const candidates = check.legalNodePaths.flatMap((path, index) => {
        const edgeIds = check.legalEdgePaths[index]; if (!same(path, answerNodes) || !edgeIds || edgeIds.length !== path.length - 1 || new Set(path).size !== path.length || new Set(edgeIds).size !== edgeIds.length) return [];
        const sequence = edgeIds.map(id => edges.get(id));
        if (sequence.some((edge, step) => !edge || edge.kind !== "CALLS" || edge.snapshotId !== snapshot.snapshotId || edge.confidence !== "verified" || edge.source !== path[step] || edge.target !== path[step + 1] || !nodes.has(edge.source) || !nodes.has(edge.target) || !cited.has(edge.evidenceId) || evidence.get(edge.evidenceId)?.snapshotId !== snapshot.snapshotId || evidence.get(edge.evidenceId)?.confidence !== "verified" || evidence.get(edge.evidenceId)?.kind !== "call-expression")) return [];
        return [{ edgeIds, sequence: sequence as GraphEdge[] }];
      }).sort((a, b) => canonicalJson(a.edgeIds) < canonicalJson(b.edgeIds) ? -1 : canonicalJson(a.edgeIds) > canonicalJson(b.edgeIds) ? 1 : 0);
      const chosen = candidates[0]; if (!chosen) unavailable("incomplete-selected-path");
      if (chosen.sequence.length > 8) unavailable("rubric-budget-exceeded");
      selectedPath = { nodeIds: [...answerNodes], edgeIds: [...chosen.edgeIds] }; selected.push(...chosen.sequence);
      chosen.sequence.forEach((edge, index) => groups.push({ key: `path:${index}:${edge.id}`, proposition: `所选静态路径第${index + 1}步由 ${nodes.get(edge.source)!.name} 调用 ${nodes.get(edge.target)!.name}；每一步需该位置的调用证据。`, proofIds: [edge.evidenceId] }));
    } else if (check.kind === "variable-roles" && q.kind === "variable-flow" && submission.structuredAnswer.kind === "variable-flow") {
      const order = ["write", "read", "return"] as const;
      if (new Set(check.requirements.map(item => item.role)).size !== check.requirements.length || !order.slice(0, 2).every(role => check.requirements.some(item => item.role === role)) || q.expectedNodeIds.length !== 1 || nodes.get(q.expectedNodeIds[0]!)?.kind !== "variable") unavailable("unsupported-question-shape");
      for (const role of submission.structuredAnswer.roles) {
        const citation = submission.citations[role.citationIndex], requirement = check.requirements.find(item => item.role === role.role);
        if (!citation || !requirement) unavailable("invalid-role-binding");
        const matches = requirement.edgeIds.filter(id => { const edge = edges.get(id); return edge !== undefined && edge.target === q.expectedNodeIds[0] && edge.evidenceId === citation.evidenceId; }).sort();
        const match = matches[0]; if (!match) unavailable("invalid-role-binding");
        const edge = checked(match, { write: "WRITES", read: "READS", return: "RETURNS" }[role.role] as GraphEdge["kind"], { write: "variable-write", read: "variable-read", return: "return-flow" }[role.role]);
        selected.push(edge); roleBindings.push({ originalCitationIndex: role.citationIndex, validatedCitationIndex: citationOrder[role.citationIndex]!, role: role.role, edgeId: edge.id, evidenceId: edge.evidenceId });
      }
      for (const role of order.filter(value => check.requirements.some(item => item.role === value))) {
        const proofIds = sorted(roleBindings.filter(binding => binding.role === role).map(binding => binding.evidenceId));
        if (!proofIds.length) unavailable("invalid-role-binding"); if (proofIds.length > 8) unavailable("rubric-budget-exceeded");
        groups.push({ key: `variable:${role}:${canonicalJson(proofIds)}`, proposition: `变量 ${nodes.get(q.expectedNodeIds[0]!)!.name} 在这些引用位置承担${{ write: "写入", read: "读取", return: "返回" }[role]}角色；只解释所选源码位置。`, proofIds });
      }
    } else unavailable("unsupported-question-shape");
    const selectedEdges = [...new Map(selected.map(edge => [edge.id, edge])).values()];
    const necessaryIds = new Set(groups.flatMap(group => group.proofIds));
    if ([...necessaryIds].some(id => !cited.has(id))) unavailable("missing-required-proof");
    if ([...cited].some(id => !necessaryIds.has(id))) unavailable("citation-outside-rubric");
    submissionProjectionHash = await computeOwnershipSubmissionProjectionHash({ originalCitations: submission.citations, originalStructuredAnswer: submission.structuredAnswer, citationOrder, roleBindings, normalizedStructuredAnswer: normalized, validatedCitations: citations });
    const materials = new Map(input.sources.map(source => [source.filePath, source])); if (materials.size !== input.sources.length) fail();
    const proofs: OwnershipSemanticPackage["proofs"] = [];
    for (const id of sorted(necessaryIds)) {
      const proof = evidence.get(id)!; const file = manifest.find(item => item.filePath === proof.span.filePath), source = materials.get(proof.span.filePath);
      if (!file || !source) unavailable("missing-required-proof");
      if (source.repositoryId !== snapshot.repositoryId || source.snapshotId !== snapshot.snapshotId || source.contentHash !== file.contentHash || remoteUtf8Bytes(source.content) !== file.bytes || !wellFormed(source.content) || await digestOwnershipPreimage(source.content) !== file.contentHash) fail();
      const { startLine, startColumn, endLine, endColumn } = proof.span; const lines = source.content.split(/\r\n|\r|\n/u); const first = lines[startLine - 1], last = lines[endLine - 1];
      if (first === undefined || last === undefined || startColumn > first.length || endColumn > last.length || endLine < startLine || endLine === startLine && endColumn <= startColumn) fail();
      const split = (line: string, offset: number) => offset > 0 && offset < line.length && /[\uD800-\uDBFF]/u.test(line[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(line[offset]!);
      if (split(first, startColumn) || split(last, endColumn)) fail();
      if (endLine - startLine + 1 > 40) unavailable("source-budget-exceeded");
      const slice = lines.slice(startLine - 1, endLine); slice[0] = slice[0]!.slice(startColumn); slice[slice.length - 1] = slice[slice.length - 1]!.slice(0, startLine === endLine ? endColumn - startColumn : endColumn);
      const snippet = slice.join("\n"); if (remoteUtf8Bytes(snippet) > 4096) unavailable("source-budget-exceeded");
      const projected = remoteProofSchema.safeParse({ id, kind: proof.kind, span: proof.span, sliceSpan: proof.span, analyzer: proof.analyzer, analyzerVersion: proof.analyzerVersion, confidence: proof.confidence, contentHash: file.contentHash, snippet });
      if (!projected.success) unavailable("unsupported-proof-kind"); proofs.push(projected.data);
    }
    if (proofs.reduce((sum, proof) => sum + remoteUtf8Bytes(proof.snippet), 0) > 24576) unavailable("source-budget-exceeded");
    const criteria: OwnershipSemanticPackage["rubric"]["criteria"] = [], limitations: OwnershipSemanticPackage["rubric"]["limitations"] = [];
    for (const [index, group] of groups.entries()) {
      const criterionId = await digestOwnershipPreimage(canonicalJson({ domain: "ownership-criterion/1.0.0", questionFingerprint, key: group.key }));
      const allowedLimitationIds: string[] = [];
      for (const code of ["static-only", "answer-information-insufficient"] as const) {
        const content = { code, criterionIds: [criterionId], relatedEvidenceIds: code === "static-only" ? group.proofIds : [], description: code === "static-only" ? "静态证据不能证明该行为一定在运行时发生。" : "答案未表达足够明确的信息时，仅可给出辅助不足判断。" };
        const limitationId = await computeOwnershipLimitationId(content); limitations.push({ ...content, limitationId }); allowedLimitationIds.push(limitationId);
      }
      criteria.push({ criterionId, proposition: group.proposition, weight: Math.floor(100 / groups.length) + (index < 100 % groups.length ? 1 : 0), requiredEvidenceIds: group.proofIds, allowedEvidenceIds: group.proofIds, allowedLimitationIds, answerScope: submission.answer.length ? [{ start: 0, end: submission.answer.length }] : [] });
    }
    const rubricContent = { version: "1.0.0" as const, questionId: q.id, questionVersion: q.version, questionFingerprint, questionKind: q.kind, learningObjective: q.learningObjective, criteria, limitations, selectedPath };
    // Bound metadata before calling existing hash/schema helpers, without clipping any field.
    const meta = ownershipReadyCapsuleSchema.pick({ repositoryId: true, snapshotId: true, attemptId: true, questionId: true, questionVersion: true, questionKind: true, variantKey: true, prompt: true, learningObjective: true, createdAt: true }).safeParse({ repositoryId: q.repositoryId, snapshotId: q.snapshotId, questionId: q.id, questionVersion: q.version, questionKind: q.kind, variantKey: q.variantKey, prompt: q.prompt, learningObjective: q.learningObjective, attemptId: attempt.attemptId, createdAt: attempt.completedAt });
    if (!meta.success || criteria.some(item => item.proposition.length > 1200 || remoteUtf8Bytes(item.proposition) > 4800)) unavailable("rubric-budget-exceeded");
    const rubric = { ...rubricContent, rubricHash: await computeOwnershipRubricHash(rubricContent) };
    const necessaryNodeIds = sorted(selectedEdges.flatMap(edge => [edge.source, edge.target]));
    if (necessaryNodeIds.length > 24 || selectedEdges.length > 40 || proofs.length > 24) unavailable("package-budget-exceeded");
    const packContent: Omit<OwnershipSemanticPackage, "assessmentPackageId"> = {
      version: "1.0.0", purpose: "ownership-semantic-assessment", disclosureVersion: "ownership-semantics/1.0.0", repositoryId: snapshot.repositoryId, snapshotId: snapshot.snapshotId,
      attemptId: attempt.attemptId, attemptHash, deterministicScoringVersion: "2.1.0", semanticScoringVersion: "1.0.0", analysisIdentity: analysis.data, answer: submission.answer, answerHash,
      structuredAnswer: normalized, validatedCitations: citations as OwnershipSemanticPackage["validatedCitations"], rubric,
      nodes: necessaryNodeIds.map(id => { const node = nodes.get(id)!; return { id, name: node.name, kind: node.kind, filePath: node.filePath ?? null, evidenceIds: sorted(selectedEdges.filter(edge => edge.source === id || edge.target === id).map(edge => edge.evidenceId)) }; }),
      edges: selectedEdges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, evidenceId: edge.evidenceId, confidence: edge.confidence, reason: "当前题目所选的静态关系" })), proofs,
    };
    if (remoteUtf8Bytes(canonicalJson({ ...packContent, assessmentPackageId: "0".repeat(64) })) > 65536) unavailable("package-budget-exceeded");
    // Old indexed labels and identifiers can be legal locally but exceed this bounded DTO.
    if (!ownershipSemanticPackageSchema.safeParse({ ...packContent, assessmentPackageId: "0".repeat(64) }).success) unavailable("package-budget-exceeded");
    const pack = { ...packContent, assessmentPackageId: await computeOwnershipPackageId(packContent) }; await validateOwnershipSemanticPackage(pack, submission.answer);
    const ready = { ...meta.data, version: "1.0.0" as const, builderVersion: "1.0.0" as const, status: "ready" as const, questionFingerprint, attemptHash, answerHash, submissionProjectionHash, deterministicScoringVersion: "2.1.0" as const, sourceIdentity: sourceIdentity as Extract<OwnershipCapsule, { status: "ready" }>["sourceIdentity"], analysisIdentity: analysis.data, rubric, citationOrder, roleBindings, necessaryNodeIds, necessaryEdgeIds: sorted(selectedEdges.map(edge => edge.id)), necessaryProofs: proofs.map(({ id, snippet: _snippet, sliceSpan: _slice, ...proof }) => ({ ...proof, evidenceId: id, filePath: proof.span.filePath })) };
    if (remoteUtf8Bytes(canonicalJson({ ...ready, capsuleHash: "0".repeat(64) })) > 65536) unavailable("package-budget-exceeded");
    return finish(ready);
  } catch (error) { if (error instanceof NotEvaluated) return fallback(error.reason); throw error; }
}
