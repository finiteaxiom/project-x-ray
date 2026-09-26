// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SourceFileResult } from "@project-xray/contracts";

const editorSpies = vi.hoisted(() => ({ layout: vi.fn(), updateOptions: vi.fn() }));
vi.mock("@monaco-editor/react", () => ({
  default: ({ onMount }: { onMount?: (editor: unknown, monaco: unknown) => void }) => { useEffect(() => { onMount?.({ onDidChangeCursorSelection: () => ({ dispose: () => undefined }), onDidScrollChange: () => ({ dispose: () => undefined }), getScrollTop: () => 0, getScrollLeft: () => 0, setScrollTop: vi.fn(), setScrollLeft: vi.fn(), revealRangeInCenter: vi.fn(), setSelection: vi.fn(), createDecorationsCollection: () => ({ clear: vi.fn() }), layout: editorSpies.layout, updateOptions: editorSpies.updateOptions }, { Range: class Range {}, editor: { defineTheme: vi.fn(), setTheme: vi.fn() } }); }, []); return <div data-testid="real-editor-host" />; },
}));

import { EvidenceWorkspace } from "./EvidenceWorkspace";

const source: SourceFileResult = { repositoryId: "repo", snapshotId: "snap", filePath: "src/very/long/path/example.ts", language: "TypeScript", content: "const longLine = 'abcdefghijklmnopqrstuvwxyz';", contentHash: "hash", workspaceStatus: "current", targetSpan: { filePath: "src/very/long/path/example.ts", startLine: 1, startColumn: 6, endLine: 1, endColumn: 14 } };

describe("证据工作区布局", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(() => { window.localStorage.clear(); editorSpies.layout.mockClear(); editorSpies.updateOptions.mockClear(); });

  it("支持键盘与指针调整、导航收起、源码最大化和换行", async () => {
    const user = userEvent.setup(); render(<EvidenceWorkspace project={{ repositoryId: "repo", snapshotId: "snap" }} source={source} navigation={<div>架构导航内容</div>} navigationLabel="架构地图" />);
    const separator = screen.getByRole("separator", { name: "调整源码面板宽度" }); expect(separator.getAttribute("aria-valuenow")).toBe("44");
    fireEvent.keyDown(separator, { key: "ArrowLeft" }); expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("48");
    const workspace = screen.getByTestId("evidence-workspace"); Object.defineProperty(workspace, "getBoundingClientRect", { value: () => ({ left: 0, right: 1000, top: 0, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}) }) });
    fireEvent.pointerDown(screen.getByRole("separator"), { pointerId: 1, clientX: 520 }); fireEvent.pointerMove(screen.getByRole("separator"), { pointerId: 1, clientX: 300 }); fireEvent.pointerUp(screen.getByRole("separator"), { pointerId: 1 }); expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("70");
    await user.click(screen.getByRole("button", { name: "收起架构地图" })); expect(screen.queryByRole("separator")).toBeNull(); await user.click(screen.getByRole("button", { name: "显示架构地图" }));
    await user.click(screen.getByRole("button", { name: "最大化" })); expect(workspace.className).toContain("source-maximized"); await user.click(screen.getByRole("button", { name: "还原" })); expect(workspace.className).not.toContain("source-maximized");
    await user.click(screen.getByRole("button", { name: "关闭源码" })); expect(screen.queryByTestId("source-viewer")).toBeNull(); expect(workspace.className).toContain("without-source"); await user.click(screen.getByRole("button", { name: "显示源码" })); expect(screen.getByTestId("source-viewer")).toBeTruthy();
    const wrap = screen.getByRole("button", { name: "自动换行" }); expect(wrap.getAttribute("aria-pressed")).toBe("false"); await user.click(wrap); expect(wrap.getAttribute("aria-pressed")).toBe("true"); await waitFor(() => expect(editorSpies.updateOptions).toHaveBeenCalledWith({ wordWrap: "on" })); expect(editorSpies.layout).toHaveBeenCalled();
  });

  it("没有当前快照源码时把全部空间交给导航，且不显示旧项目源码", () => {
    const { rerender } = render(<EvidenceWorkspace project={{ repositoryId: "repo", snapshotId: "snap" }} source={null} navigation={<div>完整架构图</div>} />); expect(screen.getByTestId("evidence-workspace").className).toContain("without-source"); expect(screen.queryByTestId("source-viewer")).toBeNull();
    rerender(<EvidenceWorkspace project={{ repositoryId: "repo-new", snapshotId: "snap-new" }} source={source} navigation={<div>新项目架构图</div>} />); expect(screen.queryByTestId("source-viewer")).toBeNull(); expect(screen.getByText("新项目架构图")).toBeTruthy();
  });
  it("仍按仓库与快照分别过滤父级传入的旧源码", () => {
    const { rerender } = render(<EvidenceWorkspace project={{ repositoryId: "repo", snapshotId: "snap" }} source={source} navigation={<div>导航</div>} />);
    expect(screen.getByTestId("evidence-workspace").className).toContain("with-source");
    rerender(<EvidenceWorkspace project={{ repositoryId: "repo", snapshotId: "snap-next" }} source={source} navigation={<div>新快照导航</div>} />);
    expect(screen.getByTestId("evidence-workspace").className).toContain("without-source"); expect(screen.queryByTestId("source-viewer")).toBeNull();
    rerender(<EvidenceWorkspace project={{ repositoryId: "repo-next", snapshotId: "snap" }} source={source} navigation={<div>新仓库导航</div>} />);
    expect(screen.getByTestId("evidence-workspace").className).toContain("without-source"); expect(screen.queryByTestId("source-viewer")).toBeNull();
  });

  it("按工作区实际宽度切换单栏面板，隐藏面板不保留可聚焦内容且不覆盖分栏偏好", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class { constructor(private readonly callback: ResizeObserverCallback) {} observe(target: Element) { if (target.getAttribute("data-testid") === "evidence-workspace") callbacks.push(this.callback); } disconnect() {} unobserve() {} });
    const user = userEvent.setup(); render(<EvidenceWorkspace project={{ repositoryId: "repo", snapshotId: "snap" }} source={source} navigation={<button>架构导航操作</button>} navigationLabel="架构地图" />);
    const workspace = screen.getByTestId("evidence-workspace");
    act(() => callbacks[0]?.([{ target: workspace, contentRect: { width: 720 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(workspace.className).toContain("compact-layout");
    await user.click(screen.getByRole("button", { name: "源码" }));
    expect(workspace.getAttribute("data-active-pane")).toBe("source");
    expect(workspace.querySelector(".workspace-navigation")?.hasAttribute("hidden")).toBe(true);
    expect(workspace.querySelector(".workspace-source")?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByText("架构导航操作").closest(".workspace-navigation")?.hasAttribute("hidden")).toBe(true);
    expect(window.localStorage.getItem("project-xray:evidence-workspace:source-width")).toBe("44");
    act(() => callbacks[0]?.([{ target: workspace, contentRect: { width: 1200 } } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(workspace.className).not.toContain("compact-layout");
    expect(screen.getByRole("separator", { name: "调整源码面板宽度" })).toBeTruthy();
    expect(screen.getByText("查看完整路径")).toBeTruthy();
  });
});
