import { describe, expect, it } from "vitest";
import { OWNERSHIP_QUESTION_VERSION, OWNERSHIP_SCORING_VERSION, type GraphEdge, type GraphNode, type OwnershipQuestion, type ProjectSnapshot, type SourceCitation } from "@project-xray/contracts";
import { createOwnershipQuestionGeneratorPort, createQuestions, gradeAnswer } from "./index.js";

const span = (line: number) => ({ filePath: "a.ts", startLine: line, startColumn: 0, endLine: line, endColumn: 3 });
const snapshot: ProjectSnapshot = {
  repositoryId: "r", snapshotId: "s", name: "demo", rootPath: "C:/demo", sourceType: "local", createdAt: "2026-01-01T00:00:00.000Z", analysisIdentity: { graphIrVersion: "1.2.0", analyzerVersions: { test: "1" }, configurationHash: "c", sourceFingerprint: "f" }, sourceFiles: [{ filePath: "a.ts", contentHash: "h", bytes: 50, language: "TypeScript" }], health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: { TypeScript: 1 }, limitations: [] },
  nodes: [...["a","b","c","d"].map((id): GraphNode => ({ id, snapshotId: "s", kind: "function", name: id, qualifiedName: id, filePath: "a.ts", span: span(1), metadata: {} })), { id: "v", snapshotId: "s", kind: "variable", name: "token", qualifiedName: "token", filePath: "a.ts", span: span(6), metadata: {} }],
  evidence: ["ab","bc","ac","cd","write","read","return"].map((id, index) => ({ id: `e-${id}`, snapshotId: "s", analyzer: "test", analyzerVersion: "1", kind: id, confidence: "verified" as const, reason: id, span: span(index + 1) })),
  edges: [
    ["ab","a","b","CALLS"],["bc","b","c","CALLS"],["ac","a","c","CALLS"],["cd","c","d","CALLS"],
    ["write","a","v","WRITES"],["read","b","v","READS"],["return","c","v","RETURNS"],
  ].map(([id,source,target,kind]): GraphEdge => ({ id: id!, snapshotId: "s", source: source!, target: target!, kind: kind as "CALLS"|"WRITES"|"READS"|"RETURNS", confidence: "verified", evidenceId: `e-${id}`, reason: id! })),
};
const citation = (evidenceId: string): SourceCitation => { const item = snapshot.evidence.find((value) => value.id === evidenceId)!; return { ...item.span, evidenceId }; };
const citationFrom = (source: ProjectSnapshot, evidenceId: string): SourceCitation => { const item = source.evidence.find((value) => value.id === evidenceId)!; return { ...item.span, evidenceId }; };

describe("structured ownership grading", () => {
  it("trusted generator shares exact original candidates, Map order/count and object-join variant", () => {
    const port = createOwnershipQuestionGeneratorPort();
    expect(port.orderingEngine).toMatchObject({ implementationVersion: "js-localeCompare/1.0.0", sensitivity: "variant" });
    for (const count of [1, 5, 20]) for (const conceptId of [undefined, "call-path:a:c"]) {
      const request = { repositoryId: "r", snapshotId: "s", count, scope: { kind: "project" as const }, ...(conceptId ? { conceptId } : {}) };
      const generated = port.generate(snapshot, request, []);
      expect(generated.questions).toEqual(createQuestions(snapshot, request, []));
      expect(generated.questions).toEqual([...new Map(generated.candidates.map(q => [q.id, q])).values()].slice(0, count));
      expect(generated.candidates.filter(q => q.kind === "call-path").every(q => q.variantKey.includes("[object Object]"))).toBe(true);
    }
    const request = { repositoryId: "r", snapshotId: "s", count: 20, scope: { kind: "project" as const } };
    const candidates = port.generate(snapshot, request, []).candidates;
    expect(candidates.some(q => candidates.some(other => other.id === q.id && other.concept.id !== q.concept.id))).toBe(true);
    expect(OWNERSHIP_QUESTION_VERSION).toBe("2.0.0"); expect(OWNERSHIP_SCORING_VERSION).toBe("2.1.0");
  });
  it("接受同节点序列的任一完整边路径，拒绝不完整、混拼及缺失路径证据", () => {
    const alternateEvidence = ["ab-alt", "bc-alt"].map((id, index) => ({ id: `e-${id}`, snapshotId: "s", analyzer: "test", analyzerVersion: "1", kind: "call", confidence: "verified" as const, reason: id, span: span(8 + index) }));
    const alternateEdges: GraphEdge[] = [
      { id: "ab-alt", snapshotId: "s", source: "a", target: "b", kind: "CALLS", confidence: "verified", evidenceId: "e-ab-alt", reason: "second a-b site" },
      { id: "bc-alt", snapshotId: "s", source: "b", target: "c", kind: "CALLS", confidence: "verified", evidenceId: "e-bc-alt", reason: "second b-c site" },
    ];
    const duplicateSnapshot: ProjectSnapshot = { ...snapshot, evidence: [...snapshot.evidence, ...alternateEvidence], edges: [...snapshot.edges, ...alternateEdges] };
    const generated = createQuestions(duplicateSnapshot, { repositoryId: "r", snapshotId: "s", count: 20, scope: { kind: "project" } }).find((item) => item.kind === "call-path" && item.concept.id === "call-path:a:c")!;
    const generatedCheck = generated.deterministicChecks.find((item) => item.kind === "ordered-path");
    expect(generatedCheck?.kind).toBe("ordered-path");
    if (!generatedCheck || generatedCheck.kind !== "ordered-path") throw new Error("generated ordered-path check missing");
    const duplicatePathIndexes = generatedCheck.legalNodePaths.map((path, index) => ({ path, edgeIds: generatedCheck.legalEdgePaths[index] })).filter(({ path }) => path.join("/") === "a/b/c");
    const firstGeneratedPath = duplicatePathIndexes.find(({ edgeIds }) => edgeIds?.[0] === "ab")!.edgeIds!;
    const secondGeneratedPath = duplicatePathIndexes.find(({ edgeIds }) => edgeIds?.[0] === "ab-alt")!.edgeIds!;

    const makeQuestion = (legalNodePaths: string[][], legalEdgePaths: string[][]): OwnershipQuestion => ({
      version: OWNERSHIP_QUESTION_VERSION, repositoryId: "r", snapshotId: "s", id: "duplicate-call-path", kind: "call-path", prompt: "path", concept: { id: "path:a:c", label: "a-c" }, learningObjective: "path", difficulty: "hard", choices: [], evidenceIds: ["e-ab", "e-bc", "e-ab-alt", "e-bc-alt"], expectedNodeIds: ["a", "b", "c"], variantKey: "duplicate-sites",
      deterministicChecks: [{ kind: "ordered-path", legalNodePaths, legalEdgePaths }],
    });
    const gradePath = (question: OwnershipQuestion, nodeIds: string[], source: ProjectSnapshot, evidenceIds: string[]) => {
      const citations = evidenceIds.map((id) => citationFrom(source, id));
      return gradeAnswer(question, { repositoryId: "r", snapshotId: "s", questionId: question.id, questionVersion: question.version, answer: "", citations, selfConfidence: .5, structuredAnswer: { kind: "call-path", nodeIds } }, source, citations);
    };

    const firstComplete = gradePath(generated, ["a", "b", "c"], duplicateSnapshot, firstGeneratedPath.map((id) => duplicateSnapshot.edges.find((edge) => edge.id === id)!.evidenceId));
    const secondComplete = gradePath(generated, ["a", "b", "c"], duplicateSnapshot, secondGeneratedPath.map((id) => duplicateSnapshot.edges.find((edge) => edge.id === id)!.evidenceId));
    const incomplete = gradePath(generated, ["a", "b", "c"], duplicateSnapshot, ["e-ab", "e-ab-alt"]);
    const pairedAlternatives = makeQuestion([["a", "b", "c"], ["a", "b", "c"]], [["ab", "bc"], ["ab-alt", "bc-alt"]]);
    const mixed = gradePath(pairedAlternatives, ["a", "b", "c"], duplicateSnapshot, ["e-ab", "e-bc-alt"]);
    const missingEdge = gradePath(makeQuestion([["a", "b"]], [["missing-edge"]]), ["a", "b"], duplicateSnapshot, ["e-ab"]);
    const missingProofSnapshot: ProjectSnapshot = { ...snapshot, edges: [...snapshot.edges, { id: "ab-no-proof", snapshotId: "s", source: "a", target: "b", kind: "CALLS", confidence: "verified", evidenceId: "missing-proof", reason: "no evidence" }] };
    const missingProof = gradePath(makeQuestion([["a", "b"]], [["ab-no-proof"]]), ["a", "b"], missingProofSnapshot, ["e-ab"]);

    expect(firstGeneratedPath).toHaveLength(2); expect(secondGeneratedPath).toHaveLength(2);
    expect(firstComplete).toMatchObject({ structure: { score: 100 }, location: { score: 100 }, passed: true, scoringVersion: OWNERSHIP_SCORING_VERSION });
    expect(secondComplete).toMatchObject({ structure: { score: 100 }, location: { score: 100 }, passed: true, scoringVersion: OWNERSHIP_SCORING_VERSION });
    expect(incomplete).toMatchObject({ structure: { score: 100 }, location: { score: 50 }, passed: false });
    expect(mixed).toMatchObject({ structure: { score: 100 }, location: { score: 50 }, passed: false });
    expect(missingEdge).toMatchObject({ structure: { score: 0 }, location: { score: 0 }, passed: false });
    expect(missingProof).toMatchObject({ structure: { score: 0 }, location: { score: 0 }, passed: false });
  });
  it("引用正确但调用方向颠倒不能通过", () => { const q = createQuestions(snapshot, { repositoryId:"r",snapshotId:"s",count:20,scope:{kind:"project"} }).find((item) => item.kind === "call-direction" && item.deterministicChecks.some((check) => check.kind === "call-direction" && check.edgeId === "ab"))!; const c = citation("e-ab"); const grade = gradeAnswer(q, { repositoryId:"r",snapshotId:"s",questionId:q.id,questionVersion:OWNERSHIP_QUESTION_VERSION,answer:"很多关键词",citations:[c,c],selfConfidence:.8,structuredAnswer:{kind:"call-direction",callerNodeId:"b",calleeNodeId:"a"} }, snapshot, [c]); expect(grade.location.score).toBe(100); expect(grade.structure.score).toBe(0); expect(grade.passed).toBe(false); });
  it("证据齐全但路径顺序错误失败，合法替代路径通过", () => { const base = { version:OWNERSHIP_QUESTION_VERSION,repositoryId:"r",snapshotId:"s",id:"path",kind:"call-path" as const,prompt:"p",concept:{id:"path:a:c",label:"a-c"},learningObjective:"path",difficulty:"hard" as const,choices:[],evidenceIds:["e-ab","e-bc","e-ac"],expectedNodeIds:["a","b","c"],variantKey:"v",deterministicChecks:[{kind:"ordered-path" as const,legalNodePaths:[["a","b","c"],["a","c"]],legalEdgePaths:[["ab","bc"],["ac"]]}] } satisfies OwnershipQuestion; const citations=[citation("e-ab"),citation("e-bc"),citation("e-ac")]; const wrong=gradeAnswer(base,{repositoryId:"r",snapshotId:"s",questionId:"path",questionVersion:OWNERSHIP_QUESTION_VERSION,answer:"",citations,selfConfidence:.5,structuredAnswer:{kind:"call-path",nodeIds:["b","a","c"]}},snapshot,citations); expect(wrong.passed).toBe(false); const alternative=gradeAnswer(base,{repositoryId:"r",snapshotId:"s",questionId:"path",questionVersion:OWNERSHIP_QUESTION_VERSION,answer:"",citations:[citation("e-ac")],selfConfidence:.5,structuredAnswer:{kind:"call-path",nodeIds:["a","c"]}},snapshot,[citation("e-ac")]); expect(alternative.passed).toBe(true); });
  it("读写引用交换角色不能通过", () => { const q=createQuestions(snapshot,{repositoryId:"r",snapshotId:"s",count:20,scope:{kind:"project"}}).find((item)=>item.kind==="variable-flow")!; const citations=[citation("e-write"),citation("e-read"),citation("e-return")]; const grade=gradeAnswer(q,{repositoryId:"r",snapshotId:"s",questionId:q.id,questionVersion:OWNERSHIP_QUESTION_VERSION,answer:"",citations,selfConfidence:.5,structuredAnswer:{kind:"variable-flow",roles:[{citationIndex:0,role:"read"},{citationIndex:1,role:"write"},{citationIndex:2,role:"return"}]}},snapshot,citations); expect(grade.structure.score).toBe(0); expect(grade.semantic.status).toBe("not-evaluated"); });
  it("无 verified 事实时不生成牵强结构题", () => { const empty={...snapshot,edges:snapshot.edges.map((edge)=>({...edge,confidence:"unknown" as const}))}; expect(createQuestions(empty,{repositoryId:"r",snapshotId:"s",count:20,scope:{kind:"project"}})).toEqual([]); });
  it("同概念同变式明确标记原题重试", () => { const first=createQuestions(snapshot,{repositoryId:"r",snapshotId:"s",count:1,scope:{kind:"project"}})[0]!; const attempts=[{attemptId:"x",repositoryId:"r",snapshotId:"s",questionId:first.id,questionVersion:OWNERSHIP_QUESTION_VERSION,concept:first.concept,questionKind:first.kind,variantKey:first.variantKey,structuredAnswer:{},citations:[],locationScore:0,structureScore:0,passed:false,scoringVersion:"2.0.0",semanticText:"",completedAt:"2026-01-01",legacy:false}]; const retry=createQuestions(snapshot,{repositoryId:"r",snapshotId:"s",count:20,scope:{kind:"project"},conceptId:first.concept.id},attempts)[0]!; expect(retry.retryOfQuestionId).toBe(first.id); });
});
