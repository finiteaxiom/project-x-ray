import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { PythonAnalyzer } from "@project-xray/analyzer-python";
import { GraphStore } from "@project-xray/graph";
import { XRayApplication } from "./index.js";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "xray-result-")); directories.push(base); const root = join(base, "A"); await mkdir(root);
  await writeFile(join(root, "a.ts"), "export function entry() { return 1 }\n");
  await writeFile(join(root, "analysis.py"), "def target():\n    return 1\n\ndef entry():\n    return target()\n");
  const options = { databasePath: join(base, "legacy.sqlite"), projectDatabaseRoot: join(base, "db"), cacheRoot: join(base, "cache") };
  let unavailable = true; const analyze = PythonAnalyzer.prototype.analyzeProject;
  vi.spyOn(PythonAnalyzer.prototype, "analyzeProject").mockImplementation(async function(this: PythonAnalyzer, sources, context) {
    if (!unavailable) return analyze.call(this, sources, context);
    return { nodes: [], edges: [], evidence: [], unresolvedCalls: [], failures: [{ filePath: "analysis.py", code: "PYTHON_ENVIRONMENT_UNAVAILABLE", reason: "安全固定失败" }] };
  });
  return { base, root, options, setUnavailable(value: boolean) { unavailable = value; }, run(...args: string[]) { execFileSync("git", args, { cwd: root, stdio: "pipe" }); } };
}
const refOf = (value: { repositoryId: string; snapshotId: string }) => ({ repositoryId: value.repositoryId, snapshotId: value.snapshotId });

describe("分析结果不可变身份", () => {
  it("同源码 partial→complete→partial，旧证据/源码保留，同结果复用且跨项目重开选择正确", async () => {
    const f = await fixture(); let app = new XRayApplication(f.options);
    try {
      const partial = await app.indexProject(f.root); expect(partial.health.failedFiles[0]?.code).toBe("PYTHON_ENVIRONMENT_UNAVAILABLE");
      expect(partial.nodes.filter(node => node.language === "Python" && node.kind === "function")).toHaveLength(0);
      const repeated = await app.indexProject(f.root); expect(repeated.snapshotId).toBe(partial.snapshotId);
      f.setUnavailable(false); const complete = await app.indexProject(f.root); expect(complete.snapshotId).not.toBe(partial.snapshotId); expect(complete.health.failedFiles).toEqual([]); expect(repeated.createdAt).toBe(partial.createdAt);
      expect(complete.nodes.filter(node => node.language === "Python" && node.kind === "function")).toHaveLength(2);
      const question = (await app.createOwnershipQuestions({ ...refOf(complete), count: 1, scope: { kind: "project" } }))[0]!;
      f.setUnavailable(true); const restoredPartial = await app.indexProject(f.root);
      expect(restoredPartial).toEqual(partial); expect(app.getCurrentProject()?.snapshotId).toBe(partial.snapshotId);
      await expect(app.gradeOwnershipAnswer({ ...refOf(complete), questionId: question.id, questionVersion: question.version, selfConfidence: .5, answer: "old", citations: [], structuredAnswer: { kind: "entry", nodeId: question.expectedNodeIds[0]! } })).rejects.toThrow(/题目不存在/);
      const store = new GraphStore(join(f.options.projectDatabaseRoot, `${partial.repositoryId}.sqlite`));
      expect(store.loadSnapshot(partial.snapshotId)).toEqual(partial); expect(store.loadSnapshot(complete.snapshotId)).toEqual(complete); store.close();
      for (const snapshot of [partial, complete]) {
        expect([...snapshot.nodes, ...snapshot.edges, ...snapshot.evidence].every(item => item.snapshotId === snapshot.snapshotId)).toBe(true);
        const proofIds = new Set(snapshot.evidence.map(item => item.id)); expect(snapshot.edges.every(edge => proofIds.has(edge.evidenceId))).toBe(true);
        const proof = snapshot.evidence.find(item => item.span.filePath === "analysis.py" && item.kind === "file")!;
        expect(app.getEvidence({ ...refOf(snapshot), evidenceId: proof.id }).snapshotId).toBe(snapshot.snapshotId);
        expect((await app.readSource({ ...refOf(snapshot), ...proof.span, evidenceId: proof.id })).content).toContain("def target");
      }
      app.close(); app = new XRayApplication(f.options); expect(app.getCurrentProject()?.snapshotId).toBe(partial.snapshotId);
      const bRoot = join(f.base, "B"); await mkdir(bRoot); await writeFile(join(bRoot, "b.ts"), "export const b = 2\n"); const b = await app.indexProject(bRoot);
      expect(b.createdAt >= partial.createdAt).toBe(true); expect((await app.indexProject(f.root)).snapshotId).toBe(partial.snapshotId);
      app.close(); app = new XRayApplication(f.options); expect(app.getCurrentProject()?.repositoryId).toBe(partial.repositoryId); expect(app.getCurrentProject()?.snapshotId).toBe(partial.snapshotId);
    } finally { app.close(); }
  });
  it.each(["working", "staged", "last-commit"] as const)("Git %s 不提前复用旧partial，两侧结果变化产生新身份且旧侧完整保留", async mode => {
    const f = await fixture(); f.run("init"); f.run("config", "user.name", "Fixture"); f.run("config", "user.email", "fixture@example.test"); f.run("add", "."); f.run("commit", "-m", "base");
    const app = new XRayApplication(f.options);
    try {
      const base = await app.indexProject(f.root); const input = { ...refOf(base), mode, maxDepth: 2, maxPaths: 10, maxWork: 500 };
      const partial = await app.createChangeReport(input);
      f.setUnavailable(false); const complete = await app.createChangeReport(input); expect(complete.right.snapshot.snapshotId).not.toBe(partial.right.snapshot.snapshotId); expect(complete.id).not.toBe(partial.id);
      f.setUnavailable(true); const again = await app.createChangeReport(input); expect(again.right.snapshot.snapshotId).toBe(partial.right.snapshot.snapshotId); expect(again.id).toBe(partial.id);
      const store = new GraphStore(join(f.options.projectDatabaseRoot, `${base.repositoryId}.sqlite`));
      const oldPartial = store.loadSnapshot(partial.right.snapshot.snapshotId)!; const oldComplete = store.loadSnapshot(complete.right.snapshot.snapshotId)!;
      expect(oldPartial.health.failedFiles[0]?.code).toBe("PYTHON_ENVIRONMENT_UNAVAILABLE"); expect(oldComplete.health.failedFiles).toEqual([]);
      expect(oldComplete.nodes.filter(node => node.language === "Python" && node.kind === "function")).toHaveLength(2);
      expect(store.loadChangeReport(complete.id)?.right.snapshot.snapshotId).toBe(complete.right.snapshot.snapshotId);
      store.close(); expect(app.getCurrentProject()?.snapshotId).toBe(base.snapshotId);
      const proof = oldComplete.evidence.find(item => item.span.filePath === "analysis.py")!;
      expect((await app.readSource({ ...refOf(oldComplete), ...proof.span, evidenceId: proof.id })).content).toContain("def target");
    } finally { app.close(); }
  });
});
