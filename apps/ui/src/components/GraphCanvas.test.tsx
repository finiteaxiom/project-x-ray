// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { GraphNode } from "@project-xray/contracts";

const graphMock = vi.hoisted(() => {
  const collection = { addClass: vi.fn().mockReturnThis(), removeClass: vi.fn().mockReturnThis(), remove: vi.fn(), unselect: vi.fn(), map: vi.fn(() => []), renderedBoundingBox: vi.fn(() => ({ x1: 30, y1: 30, x2: 770, y2: 470 })), length: 1 };
  const scratches = new Map<string, unknown>(); let pan = { x: 0, y: 0 };
  const core = { on: vi.fn(), destroy: vi.fn(), destroyed: vi.fn(() => false), elements: vi.fn(() => collection), nodes: vi.fn(() => collection), $: vi.fn(() => collection), batch: vi.fn((callback: () => void) => callback()), add: vi.fn(), layout: vi.fn(() => ({ run: vi.fn() })), getElementById: vi.fn(() => ({ data: vi.fn(), select: vi.fn() })), resize: vi.fn(), fit: vi.fn(), minZoom: vi.fn(() => .08), maxZoom: vi.fn(() => 2.4), zoom: vi.fn((value?: unknown) => value === undefined ? 1 : core), pan: vi.fn((value?: { x: number; y: number }) => { if (value) { pan = value; return core; } return pan; }), width: vi.fn(() => 800), height: vi.fn(() => 500), animate: vi.fn(), scratch: vi.fn((...args: [string, unknown?]) => { const [key, value] = args; if (args.length > 1) scratches.set(key, value); return scratches.get(key); }) };
  return { factory: vi.fn(() => core), core };
});
vi.mock("cytoscape", () => ({ default: graphMock.factory }));

import { GraphCanvas } from "./GraphCanvas";

const node: GraphNode = { id: "file", snapshotId: "snap", kind: "file", name: "long-file-name.ts", qualifiedName: "src/long-file-name.ts", filePath: "src/long-file-name.ts", metadata: {} };

describe("GraphCanvas 生命周期", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("无关 React 更新复用实例，同一上下文保留视口，新上下文重新布局", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 500));
    const view = render(<GraphCanvas contextKey="file:a" nodes={[node]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />); expect(graphMock.factory).toHaveBeenCalledTimes(1); expect(graphMock.core.layout).toHaveBeenCalledTimes(1); await waitFor(() => expect(graphMock.core.fit).toHaveBeenCalled());
    view.rerender(<GraphCanvas contextKey="file:a" nodes={[{ ...node }]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />); expect(graphMock.factory).toHaveBeenCalledTimes(1); expect(graphMock.core.layout).toHaveBeenCalledTimes(1); expect(graphMock.core.destroy).not.toHaveBeenCalled();
    view.rerender(<GraphCanvas contextKey="file:b" nodes={[{ ...node, id: "file-b" }]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />); expect(graphMock.core.layout).toHaveBeenCalledTimes(2);
    view.unmount(); rect.mockRestore(); expect(graphMock.core.destroy).toHaveBeenCalledTimes(1);
  });
  it("异步节点首次抵达同一上下文时适应画布", async () => {
    vi.clearAllMocks(); const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 500));
    const view = render(<GraphCanvas contextKey="async" nodes={[]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />);
    await waitFor(() => expect(graphMock.core.fit).toHaveBeenCalledTimes(1));
    graphMock.core.nodes.mockReturnValueOnce({ length: 0 } as ReturnType<typeof graphMock.core.nodes>);
    view.rerender(<GraphCanvas contextKey="async" nodes={[node]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />);
    await waitFor(() => expect(graphMock.core.fit).toHaveBeenCalledTimes(2));
    view.unmount(); rect.mockRestore();
  });

  it("关系图首次挂载时容器尚不可见，会在取得实际尺寸后完成初始适配", async () => {
    vi.clearAllMocks(); let width = 0; let height = 0; const frames: FrameRequestCallback[] = [];
    const observers: Array<{ notify: () => void }> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("ResizeObserver", class {
      private target: Element | null = null;
      constructor(private readonly callback: ResizeObserverCallback) { observers.push({ notify: () => callback([{ target: this.target!, contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver) }); }
      observe(target: Element): void { this.target = target; }
      disconnect(): void {}
      unobserve(): void {}
    });
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "graph-canvas" ? new DOMRect(0, 0, width, height) : new DOMRect();
    });
    const view = render(<GraphCanvas contextKey="deferred-size" nodes={[node]} edges={[]} onNode={() => undefined} onEdge={() => undefined} />);
    try {
      await waitFor(() => expect(observers).toHaveLength(1));
      const flushFrames = (): void => { let count = 0; while (frames.length && count++ < 4) for (const callback of frames.splice(0)) callback(0); };
      flushFrames();
      expect(graphMock.core.fit).not.toHaveBeenCalled();
      width = 480; height = 320; observers[0]!.notify();
      flushFrames();
      await waitFor(() => expect(graphMock.core.fit).toHaveBeenCalledTimes(1));
      fireEvent.pointerDown(view.getByTestId("graph-canvas")); width = 340; observers[0]!.notify(); flushFrames();
      expect(graphMock.core.fit).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); rect.mockRestore(); vi.unstubAllGlobals(); }
  });

  it("节点列表可搜索完整路径，并导航到真实节点", () => {
    vi.clearAllMocks(); const onNode = vi.fn();
    const view = render(<GraphCanvas nodes={[node]} edges={[]} onNode={onNode} onEdge={() => undefined} />);
    fireEvent.click(view.getByRole("button", { name: "节点列表" }));
    fireEvent.change(view.getByLabelText("筛选图谱节点"), { target: { value: "missing" } });
    expect(view.getByRole("status").textContent).toContain("匹配 0 个");
    fireEvent.change(view.getByLabelText("筛选图谱节点"), { target: { value: "long-file" } });
    fireEvent.click(view.getByRole("button", { name: /long-file-name.ts.*src/ }));
    expect(onNode).toHaveBeenCalledWith(node);
    fireEvent.click(view.getByRole("button", { name: /^画布$/ }));
    expect(view.getByTestId("graph-canvas").hidden).toBe(false);
    view.unmount();
  });

});
