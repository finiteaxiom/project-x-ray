// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OWNERSHIP_SCORING_VERSION, type GraphNode, type OwnershipGrade, type OwnershipPrompt, type ProjectOverview, type SourceCitation, type XRayApi } from "@project-xray/contracts";
import { OwnershipWorkspace } from "./OwnershipWorkspace";
import { createOwnershipSessionController } from "../state/ownership-sessions";

vi.mock("./EvidenceWorkspace", () => ({
  EvidenceWorkspace: ({ navigation, onCite }: { navigation: React.ReactNode; onCite?: (items: SourceCitation[]) => void }) => <div>
    <div>{navigation}</div>
    {onCite && <button onClick={() => onCite([
      { filePath: "src/values.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 8, evidenceId: "write" },
      { filePath: "src/values.ts", startLine: 2, startColumn: 2, endLine: 2, endColumn: 10, evidenceId: "read" },
      { filePath: "src/values.ts", startLine: 3, startColumn: 4, endLine: 3, endColumn: 13, evidenceId: "return" },
    ])}>添加三条测试引用</button>}
  </div>,
}));

const project = (snapshotId = "snap-a", repositoryId = "repo"): ProjectOverview => ({ repositoryId, snapshotId, name: "demo", rootPath: "C:\\demo", sourceType: "local", createdAt: "2026-09-25T00:00:00.000Z", analysisIdentity: { graphIrVersion: "1.2.0", analyzerVersions: {}, configurationHash: "cfg", sourceFingerprint: snapshotId }, health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: {}, limitations: [] }, counts: { nodes: 0, edges: 0, evidence: 0, modules: 0, files: 0, calls: 0, unknown: 0 } });
const question = (snapshotId = "snap-a"): OwnershipPrompt => ({ repositoryId: "repo", snapshotId, version: "2.0.0", id: "q-flow", kind: "variable-flow", prompt: "为 value 的三处源码引用标记角色", concept: { id: "variable:value", label: "value 读写" }, learningObjective: "区分写入、读取与返回", difficulty: "medium", choices: [], variantKey: "flow-v1" });
const gradeFor = (submission: { repositoryId: string; snapshotId: string; questionId: string; citations: SourceCitation[] }): OwnershipGrade => ({ repositoryId: submission.repositoryId, snapshotId: submission.snapshotId, questionId: submission.questionId, passed: true, location: { score: 100, status: "passed" }, structure: { score: 100, status: "passed" }, semantic: { status: "not-evaluated", message: "自由文本未评估" }, feedback: [], revealedEvidenceIds: ["write", "read", "return"], validatedCitations: submission.citations, scoringVersion: OWNERSHIP_SCORING_VERSION });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const cited = (): SourceCitation[] => [
  { filePath: "src/values.ts", startLine: 1, startColumn: 0, endLine: 1, endColumn: 8, evidenceId: "write" },
  { filePath: "src/values.ts", startLine: 2, startColumn: 2, endLine: 2, endColumn: 10, evidenceId: "read" },
  { filePath: "src/values.ts", startLine: 3, startColumn: 4, endLine: 3, endColumn: 13, evidenceId: "return" },
];
const moduleScope: GraphNode = { id: "module-a", snapshotId: "snap-a", kind: "module", name: "service", qualifiedName: "src/service", metadata: {} };

afterEach(() => cleanup());

async function openNotes(user: ReturnType<typeof userEvent.setup>): Promise<HTMLTextAreaElement> {
  const details = screen.getByText(/学习笔记（不参与评分）/).closest("details");
  if (details && !details.open) await user.click(details.querySelector("summary")!);
  return screen.getByRole("textbox", { name: "自由文本学习记录" }) as HTMLTextAreaElement;
}

function setup(
  createOwnershipQuestions: XRayApi["createOwnershipQuestions"] = vi.fn(async (input) => [question(input.snapshotId)]),
  gradeOwnershipAnswer: XRayApi["gradeOwnershipAnswer"] = vi.fn(async (submission) => gradeFor(submission)),
  search: XRayApi["search"] = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [] as GraphNode[], total: 0 })),
  projectValue = project(),
) {
  window.xray = {
    getOwnershipProgress: vi.fn(async (ref) => ({ ...ref, attempts: [], concepts: [] })),
    search,
    createOwnershipQuestions,
    gradeOwnershipAnswer,
    getEvidence: vi.fn(async (input) => ({ id: input.evidenceId, repositoryId: input.repositoryId, snapshotId: input.snapshotId, analyzer: "test", analyzerVersion: "1", kind: "write", confidence: "verified", reason: "fixture", span: cited()[0] })),
  } as unknown as XRayApi;
  const sessions = createOwnershipSessionController();
  const sessionId = sessions.activate({ repositoryId: projectValue.repositoryId, snapshotId: projectValue.snapshotId });
  const props = { project: projectValue, sessionId, sessions, source: null, openLocation: () => undefined, restoreSource: () => undefined, closeSource: () => undefined };
  const view = render(<OwnershipWorkspace {...props} />);
  return { view, sessions, props, createOwnershipQuestions, gradeOwnershipAnswer };
}

describe("所有权训练交互", () => {
  it("生成期间锁定范围控件，并用请求时捕获的范围显示本轮题面", async () => {
    const generation = deferred<OwnershipPrompt[]>();
    const createOwnershipQuestions = vi.fn(() => generation.promise);
    const search = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: input.kinds?.includes("module") ? [moduleScope] : [], total: input.kinds?.includes("module") ? 1 : 0 }));
    const { view } = setup(createOwnershipQuestions, undefined, search); const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "训练范围" }), "module");
    await user.type(screen.getByRole("textbox", { name: "搜索训练范围" }), "service");
    await user.click(screen.getAllByRole("button", { name: "搜索" })[0]!);
    const selectedOption = await screen.findByRole("button", { name: /src\/service/ }); await user.click(selectedOption);
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    expect(createOwnershipQuestions).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo", snapshotId: "snap-a", scope: { kind: "module", nodeId: "module-a" } }));
    expect((screen.getByRole("combobox", { name: "训练范围" }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "搜索训练范围" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "搜索" })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /src\/service/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => generation.resolve([question()]));
    expect(await screen.findByText("1. 范围：src/service")).toBeTruthy();
    view.unmount();
  });

  it("生成失败后保留所选范围、解除控件锁并按重试时捕获的范围重新请求", async () => {
    const failed = deferred<OwnershipPrompt[]>(); const retry = deferred<OwnershipPrompt[]>();
    const createOwnershipQuestions = vi.fn().mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    const search = vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: input.kinds?.includes("module") ? [moduleScope] : [], total: input.kinds?.includes("module") ? 1 : 0 }));
    const { view } = setup(createOwnershipQuestions, undefined, search); const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "训练范围" }), "module");
    await user.type(screen.getByRole("textbox", { name: "搜索训练范围" }), "service");
    await user.click(screen.getAllByRole("button", { name: "搜索" })[0]!);
    await user.click(await screen.findByRole("button", { name: /src\/service/ }));
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    await act(async () => failed.reject(new Error("Worker 暂不可用")));
    expect((await screen.findByRole("alert")).textContent).toContain("Worker 暂不可用");
    expect((screen.getByRole("combobox", { name: "训练范围" }) as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByRole("textbox", { name: "搜索训练范围" }) as HTMLInputElement).value).toBe("service");
    expect((screen.getByRole("button", { name: /src\/service/ }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "重试生成题目" }));
    expect(createOwnershipQuestions).toHaveBeenCalledTimes(2);
    expect(createOwnershipQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ scope: { kind: "module", nodeId: "module-a" } }));
    await act(async () => retry.resolve([question()]));
    expect(await screen.findByText("1. 范围：src/service")).toBeTruthy();
    view.unmount();
  });

  it("空题结果显示真实空状态、解除 loading 并可重新生成", async () => {
    const createOwnershipQuestions = vi.fn().mockResolvedValueOnce([]).mockImplementationOnce(async (input) => [question(input.snapshotId)]);
    const { view } = setup(createOwnershipQuestions); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    expect(await screen.findByText("当前范围没有足够的 verified 事实，未生成牵强题目。")).toBeTruthy();
    expect(screen.queryByText("正在读取当前快照的已验证事实。")).toBeNull();
    expect((screen.getByRole("button", { name: "生成结构化题目" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    expect(await screen.findByText(/三处源码引用/)).toBeTruthy();
    view.unmount();
  });

  it("完整显示引用范围；删除中间引用后同步移动变量角色索引", async () => {
    const user = userEvent.setup(); const { view, gradeOwnershipAnswer } = setup();
    await user.click(screen.getByRole("button", { name: "生成结构化题目" })); await screen.findByText(/三处源码引用/);
    await user.click(screen.getByRole("button", { name: "添加三条测试引用" }));
    const citationList = screen.getByRole("region", { name: "已添加源码引用" });
    expect(citationList.textContent).toContain("src/values.ts:1:0–1:8");
    expect(citationList.textContent).toContain("src/values.ts:2:2–2:10");
    await user.selectOptions(screen.getByRole("combobox", { name: "引用 1 的角色" }), "write");
    await user.selectOptions(screen.getByRole("combobox", { name: "引用 2 的角色" }), "read");
    await user.selectOptions(screen.getByRole("combobox", { name: "引用 3 的角色" }), "return");
    await user.click(screen.getByRole("button", { name: "移除引用 1" }));
    expect(citationList.textContent).not.toContain("src/values.ts:1:0–1:8");
    expect((screen.getByRole("combobox", { name: "引用 1 的角色" }) as HTMLSelectElement).value).toBe("read");
    expect((screen.getByRole("combobox", { name: "引用 2 的角色" }) as HTMLSelectElement).value).toBe("return");
    await user.click(screen.getByRole("button", { name: "提交并核验结构" }));
    await waitFor(() => expect(gradeOwnershipAnswer).toHaveBeenCalledTimes(1));
    const submission = vi.mocked(gradeOwnershipAnswer).mock.calls[0]?.[0];
    expect(submission?.citations).toEqual(cited().slice(1));
    expect(submission?.structuredAnswer).toEqual({ kind: "variable-flow", roles: [{ citationIndex: 0, role: "read" }, { citationIndex: 1, role: "return" }] });
    expect(screen.getByText("未评估", { exact: true })).toBeTruthy(); view.unmount();
  });

  it("generation and grading are single-flight and expose their pending state", async () => {
    const generation = deferred<OwnershipPrompt[]>(); const scoring = deferred<OwnershipGrade>();
    const createOwnershipQuestions = vi.fn(() => generation.promise); const gradeOwnershipAnswer = vi.fn((_submission: Parameters<XRayApi["gradeOwnershipAnswer"]>[0]) => scoring.promise);
    const { view } = setup(createOwnershipQuestions, gradeOwnershipAnswer); const user = userEvent.setup();
    const generate = screen.getByRole("button", { name: "生成结构化题目" }); await user.click(generate);
    const pendingGenerate = screen.getByRole("button", { name: "正在生成题目…" }); expect(pendingGenerate).toHaveProperty("disabled", true);
    expect(createOwnershipQuestions).toHaveBeenCalledTimes(1);
    await act(async () => generation.resolve([question()])); await screen.findByText(/三处源码引用/);
    expect((screen.getByRole("button", { name: "提交并核验结构" }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByTestId("submission-hint").textContent).toContain("至少添加一条源码引用");
    await user.click(screen.getByRole("button", { name: "添加三条测试引用" }));
    expect(screen.getByTestId("submission-hint").textContent).toContain("先完成上方的结构化答案");
    const selectors = [1, 2, 3].map(index => screen.getByRole("combobox", { name: `引用 ${index} 的角色` }));
    await user.selectOptions(selectors[0]!, "write"); await user.selectOptions(selectors[1]!, "read"); await user.selectOptions(selectors[2]!, "return");
    await user.click(screen.getByRole("button", { name: "提交并核验结构" }));
    const pendingGrade = screen.getByRole("button", { name: "正在核验…" }); expect(pendingGrade).toHaveProperty("disabled", true); expect(gradeOwnershipAnswer).toHaveBeenCalledTimes(1);
    await act(async () => scoring.resolve(gradeFor(vi.mocked(gradeOwnershipAnswer).mock.calls[0]![0])));
    await screen.findByText("定位表现"); expect(screen.getByText("结构理解")).toBeTruthy(); view.unmount();
  });

  it("提交失败后保留答案和引用并允许重试", async () => {
    const gradeOwnershipAnswer = vi.fn().mockRejectedValueOnce(new Error("本地 Worker 暂不可用")).mockImplementation(async (submission) => gradeFor(submission));
    const { view } = setup(undefined, gradeOwnershipAnswer); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成结构化题目" })); await screen.findByText(/三处源码引用/);
    await user.click(screen.getByRole("button", { name: "添加三条测试引用" }));
    const selectors = [1, 2, 3].map(index => screen.getByRole("combobox", { name: `引用 ${index} 的角色` }));
    await user.selectOptions(selectors[0]!, "write"); await user.selectOptions(selectors[1]!, "read"); await user.selectOptions(selectors[2]!, "return");
    await user.type(await openNotes(user), "输入值被写入后读取");
    const notes = screen.getByText(/学习笔记（不参与评分）/).closest("details")!; await user.click(notes.querySelector("summary")!);
    expect(notes.open).toBe(false); expect(screen.getByText(/已填写 · 内容已保留/)).toBeTruthy();
    await user.click(notes.querySelector("summary")!); expect((await openNotes(user)).value).toBe("输入值被写入后读取");
    await user.click(screen.getByRole("button", { name: "提交并核验结构" })); expect((await screen.findByRole("alert")).textContent).toContain("本地 Worker 暂不可用");
    expect(screen.getByRole("region", { name: "已添加源码引用" }).textContent).toContain("src/values.ts:1:0–1:8"); expect((await openNotes(user)).value).toBe("输入值被写入后读取");
    await user.click(screen.getByRole("button", { name: "重试提交" })); await screen.findByText("定位表现"); expect(gradeOwnershipAnswer).toHaveBeenCalledTimes(2); view.unmount();
  });

  it("快照变化后安装新范围题目，并忽略旧请求迟到的成功", async () => {
    const old = deferred<OwnershipPrompt[]>(); const current = deferred<OwnershipPrompt[]>(); const createOwnershipQuestions = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    window.xray = { getOwnershipProgress: vi.fn(async (ref) => ({ ...ref, attempts: [], concepts: [] })), search: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [], total: 0 })), createOwnershipQuestions } as unknown as XRayApi;
    const sessions = createOwnershipSessionController(); const firstId = sessions.activate({ repositoryId: "repo", snapshotId: "snap-a" });
    const view = render(<OwnershipWorkspace project={project("snap-a")} sessionId={firstId} sessions={sessions} source={null} openLocation={() => undefined} restoreSource={() => undefined} closeSource={() => undefined} />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    const secondId = sessions.activate({ repositoryId: "repo", snapshotId: "snap-b" });
    view.rerender(<OwnershipWorkspace project={project("snap-b")} sessionId={secondId} sessions={sessions} source={null} openLocation={() => undefined} restoreSource={() => undefined} closeSource={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "生成结构化题目" }));
    await act(async () => current.resolve([question("snap-b")]));
    expect(await screen.findByText("1. 范围：整个项目")).toBeTruthy();
    await act(async () => old.resolve([question("snap-a")]));
    expect(screen.getByText("1. 范围：整个项目")).toBeTruthy(); expect(screen.queryByRole("alert")).toBeNull(); view.unmount();
  });

  it("仓库切换后忽略旧请求错误和 finally，不覆盖新训练状态", async () => {
    const old = deferred<OwnershipPrompt[]>(); const current = deferred<OwnershipPrompt[]>(); const createOwnershipQuestions = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    window.xray = { getOwnershipProgress: vi.fn(async (ref) => ({ ...ref, attempts: [], concepts: [] })), search: vi.fn(async (input) => ({ repositoryId: input.repositoryId, snapshotId: input.snapshotId, items: [], total: 0 })), createOwnershipQuestions } as unknown as XRayApi;
    const sessions = createOwnershipSessionController(); const firstId = sessions.activate({ repositoryId: "repo-a", snapshotId: "snap-a" });
    const view = render(<OwnershipWorkspace project={project("snap-a", "repo-a")} sessionId={firstId} sessions={sessions} source={null} openLocation={() => undefined} restoreSource={() => undefined} closeSource={() => undefined} />); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "生成结构化题目" }));
    const secondId = sessions.activate({ repositoryId: "repo-b", snapshotId: "snap-a" });
    view.rerender(<OwnershipWorkspace project={project("snap-a", "repo-b")} sessionId={secondId} sessions={sessions} source={null} openLocation={() => undefined} restoreSource={() => undefined} closeSource={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "生成结构化题目" }));
    await act(async () => current.resolve([{ ...question("snap-a"), repositoryId: "repo-b" }]));
    expect(await screen.findByText("1. 范围：整个项目")).toBeTruthy();
    await act(async () => old.reject(new Error("旧仓库生成失败")));
    expect(screen.queryByText("旧仓库生成失败")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull(); view.unmount();
  });
});
