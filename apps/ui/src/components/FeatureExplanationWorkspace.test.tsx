// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Evidence, FeatureExplanation, ProjectOverview, XRayApi } from "@project-xray/contracts";
import { createOwnershipSessionController, emptyWorkspaceSourceView } from "../state/ownership-sessions";

vi.mock("./EvidenceWorkspace", () => ({
  EvidenceWorkspace: ({ navigation, source }: { navigation: ReactNode; source: { filePath: string } | null }) => <div><div>{navigation}</div><div data-testid="opened-source">{source?.filePath ?? ""}</div></div>,
}));

import { FeatureExplanationWorkspace } from "./FeatureExplanationWorkspace";

const project = (snapshotId = "snap-a"): ProjectOverview => ({ repositoryId: "repo", snapshotId, name: "demo", rootPath: "C:\\demo", sourceType: "local", createdAt: "2026-09-25T00:00:00.000Z", analysisIdentity: { graphIrVersion: "1.2.0", analyzerVersions: {}, configurationHash: "cfg", sourceFingerprint: snapshotId }, health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: {}, limitations: [] }, counts: { nodes: 0, edges: 0, evidence: 0, modules: 0, files: 0, calls: 0, unknown: 0 } });
const evidence: Evidence = { id: "ev-login", snapshotId: "snap-a", analyzer: "test", analyzerVersion: "1", kind: "call", confidence: "verified", reason: "静态调用证据", span: { filePath: "src/login.ts", startLine: 4, startColumn: 2, endLine: 4, endColumn: 12 } };
const explanation = (snapshotId = "snap-a", title = "登录处理", steps: FeatureExplanation["steps"] = [{ order: 1, title: "login", description: "处理登录请求", nodeIds: ["login"], evidenceIds: ["ev-login"], confidence: "verified" }]): FeatureExplanation => ({ repositoryId: "repo", snapshotId, title: `解释：${title}`, summary: "只显示当前快照中的静态证据。", structure: "ordered-path", steps, unknowns: ["动态分派可能形成其他路径。"] });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

afterEach(() => cleanup());

function setup(explainFeature = vi.fn(async () => explanation()), getEvidence = vi.fn(async () => ({ ...evidence, repositoryId: "repo" }))) {
  window.xray = { explainFeature, getEvidence } as unknown as XRayApi;
  const openLocation = vi.fn();
  const onSourceViewChange = vi.fn();
  const sessions = createOwnershipSessionController();
  const view = render(<FeatureExplanationWorkspace project={project()} source={null} openLocation={openLocation} sessions={sessions} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={onSourceViewChange} onCloseSource={() => undefined} />);
  return { view, explainFeature, getEvidence, openLocation, sessions, onSourceViewChange };
}

describe("功能解释交互", () => {
  it("保护输入法 Enter、锁定重复提交并标明结果对应的已提交问题", async () => {
    const first = deferred<FeatureExplanation>(); const second = deferred<FeatureExplanation>();
    const explainFeature = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { view } = setup(explainFeature); const user = userEvent.setup(); const input = screen.getByRole("textbox", { name: "需要解释的功能" });
    await user.type(input, "login"); fireEvent.keyDown(input, { key: "Enter", isComposing: true }); expect(explainFeature).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "开始追踪" }));
    expect(screen.getByRole("button", { name: "正在追踪…" })).toHaveProperty("disabled", true);
    await user.clear(input); await user.type(input, "文件导入"); await user.click(screen.getByRole("button", { name: "正在追踪…" }));
    expect(explainFeature).toHaveBeenCalledTimes(1); expect(explainFeature).toHaveBeenCalledWith({ repositoryId: "repo", snapshotId: "snap-a" }, "login");
    await act(async () => first.resolve(explanation("snap-a", "登录处理")));
    expect(await screen.findByText("login", { selector: ".submitted-question span" })).toBeTruthy();
    expect(screen.getByText(/当前输入尚未追踪/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "开始追踪" })); expect(explainFeature).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(explanation("snap-a", "文件导入")));
    expect(await screen.findByText("文件导入", { selector: ".submitted-question span" })).toBeTruthy();
    view.unmount();
  });

  it("显示失败与安全重试，并把零步骤响应显示为无结果", async () => {
    const explainFeature = vi.fn().mockRejectedValueOnce(new Error("快照已过期")).mockResolvedValueOnce(explanation("snap-a", "未知功能", []));
    const { view } = setup(explainFeature); const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "unknown"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    const error = await screen.findByRole("alert"); expect(error.textContent).toContain("快照已过期");
    await user.click(screen.getByRole("button", { name: "重试“unknown”" }));
    expect(await screen.findByText(/没有找到可解释的源码步骤/)).toBeTruthy();
    expect(screen.getByText("解释步骤").textContent).toContain("0 步");
    expect(explainFeature).toHaveBeenCalledTimes(2); view.unmount();
  });

  it("忽略快照切换后返回的旧解释", async () => {
    const old = deferred<FeatureExplanation>(); const explainFeature = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(explanation("snap-b", "新快照结果"));
    window.xray = { explainFeature } as unknown as XRayApi; const openLocation = vi.fn(); const sessions = createOwnershipSessionController();
    const view = render(<FeatureExplanationWorkspace project={project("snap-a")} source={null} openLocation={openLocation} sessions={sessions} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={() => undefined} onCloseSource={() => undefined} />); const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "old"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    view.rerender(<FeatureExplanationWorkspace project={project("snap-b")} source={null} openLocation={openLocation} sessions={sessions} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={() => undefined} onCloseSource={() => undefined} />);
    expect((screen.getByRole("textbox", { name: "需要解释的功能" }) as HTMLInputElement).value).toBe("");
    await act(async () => old.resolve(explanation("snap-a", "旧快照结果")));
    expect(screen.queryByText("解释：旧快照结果")).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "new"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    expect(await screen.findByText("解释：新快照结果")).toBeTruthy(); view.unmount();
  });

  it("只从当前快照证据打开精确源码范围", async () => {
    const user = userEvent.setup(); const { getEvidence, openLocation, view } = setup();
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "login"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    await user.click(await screen.findByRole("button", { name: "定位源码范围" }));
    await waitFor(() => expect(openLocation).toHaveBeenCalledWith({ ...evidence.span, evidenceId: evidence.id }));
    expect(getEvidence).toHaveBeenCalledWith({ repositoryId: "repo", snapshotId: "snap-a", evidenceId: "ev-login" }); view.unmount();
  });

  it("证据读取挂起时保持原生禁用且不会因重复点击增加请求，成功后恢复", async () => {
    const pending = deferred<Awaited<ReturnType<XRayApi["getEvidence"]>>>();
    const getEvidence = vi.fn(() => pending.promise);
    const { view, getEvidence: readEvidence, openLocation } = setup(vi.fn(async () => explanation()), getEvidence);
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "login");
    await user.click(screen.getByRole("button", { name: "开始追踪" }));
    const evidenceButton = await screen.findByRole("button", { name: "定位源码范围" });
    await user.hover(evidenceButton);
    await user.click(evidenceButton);
    expect(evidenceButton).toHaveProperty("disabled", true);
    expect(evidenceButton.textContent).toContain("读取证据");
    expect(readEvidence).toHaveBeenCalledTimes(1);

    // user-event models a real click on a native disabled button and returns without
    // waiting for it to become enabled; assert before resolving the held IPC promise.
    await user.click(evidenceButton);
    expect(evidenceButton).toHaveProperty("disabled", true);
    expect(readEvidence).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ ...evidence, repositoryId: "repo" }));
    await waitFor(() => expect(openLocation).toHaveBeenCalledWith({ ...evidence.span, evidenceId: evidence.id }));
    expect(evidenceButton).toHaveProperty("disabled", false);
    expect(readEvidence).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("每步就近选择自己的证据；失败只影响该步并可重试", async () => {
    const user = userEvent.setup();
    const steps = [{ order: 1, title: "login", description: "处理登录请求", nodeIds: ["login"], evidenceIds: ["ev-login", "ev-login-two"], confidence: "verified" as const }];
    const getEvidence = vi.fn().mockRejectedValueOnce(new Error("读取证据暂不可用")).mockResolvedValueOnce({ ...evidence, id: "ev-login-two", repositoryId: "repo", span: { ...evidence.span, startLine: 8, endLine: 8 } });
    const { view, openLocation, onSourceViewChange } = setup(vi.fn(async () => explanation("snap-a", "登录处理", steps)), getEvidence);
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "login"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    const localPicker = await screen.findByText("选择此步的源码证据（2）"); await user.click(localPicker);
    const verify = screen.getByRole("button", { name: "核验第 1 步证据 2" }); await user.click(verify);
    const localError = await screen.findByText(/这一步的源码读取失败：读取证据暂不可用/); expect(localError.closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("article", { name: "功能解释结果" })).toBeTruthy();
    const retry = screen.getByRole("button", { name: "重试核验" }); expect(retry).toHaveProperty("disabled", false); await user.click(retry);
    await waitFor(() => expect(openLocation).toHaveBeenCalledWith({ ...evidence.span, startLine: 8, endLine: 8, evidenceId: "ev-login-two" }));
    expect(getEvidence).toHaveBeenCalledTimes(2); expect(screen.getByRole("button", { name: "返回第 1 步说明" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回第 1 步说明" }));
    const presentationUpdate = onSourceViewChange.mock.calls.at(-1)?.[0]; expect(presentationUpdate?.(emptyWorkspaceSourceView()).presentation.activePane).toBe("navigation");
    view.unmount();
  });

  it("证据为空的步骤没有核验入口；跨页重挂载恢复结果和原阅读滚动位置且不重复查询", async () => {
    const user = userEvent.setup(); const emptyStep = [{ order: 1, title: "dynamic", description: "无法定位", nodeIds: [], evidenceIds: [], confidence: "unknown" as const }];
    const { view, sessions, explainFeature } = setup(vi.fn(async () => explanation("snap-a", "动态入口", emptyStep)));
    await user.type(screen.getByRole("textbox", { name: "需要解释的功能" }), "dynamic"); await user.click(screen.getByRole("button", { name: "开始追踪" }));
    expect(await screen.findByText("此步骤没有可定位的源码证据，不能作为已验证结论。")).toBeTruthy(); expect(screen.queryByRole("button", { name: /核验第 1 步/ })).toBeNull();
    const panel = document.querySelector<HTMLElement>(".explanation-panel")!; panel.scrollTop = 173; fireEvent.scroll(panel); view.unmount();
    render(<FeatureExplanationWorkspace project={project()} source={null} openLocation={() => undefined} sessions={sessions} sourceView={emptyWorkspaceSourceView()} onSourceViewChange={() => undefined} onCloseSource={() => undefined} />);
    await screen.findByText("此步骤没有可定位的源码证据，不能作为已验证结论。"); expect(document.querySelector<HTMLElement>(".explanation-panel")?.scrollTop).toBe(173); expect(explainFeature).toHaveBeenCalledTimes(1);
  });
});
