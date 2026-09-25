// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { GraphNode, GraphQueryResponse, ProjectOverview } from "@project-xray/contracts";
vi.mock("./EvidenceWorkspace", () => ({ EvidenceWorkspace: ({ navigation }: { navigation: ReactNode }) => <>{navigation}</> }));
vi.mock("./GraphCanvas", () => ({ GraphCanvas: () => <div>graph</div> }));
import { FlowExplorer } from "./FlowExplorer";
const project = { repositoryId: "repo", snapshotId: "snap" } as ProjectOverview;
const node = (id: string): GraphNode => ({ id, snapshotId: "snap", kind: "function", name: id, qualifiedName: `src/${id}`, metadata: {} });
const result = { nodes: [node("a")], edges: [], unresolved: [], stats: { scannedEdges: 1, expandedNodes: 1 }, truncated: true, truncationReasons: [], continuationCursor: "cursor" } as unknown as GraphQueryResponse;
const run = async <T,>(_: string | null, operation: () => Promise<T>, done: (value: T) => void): Promise<void> => { done(await operation()); };
function setup(search = vi.fn().mockResolvedValue({ items: [node("a")] }), queryGraph = vi.fn().mockResolvedValue(result)) {
  Object.defineProperty(window, "xray", { configurable: true, value: { search, queryGraph } });
  return { view: render(<FlowExplorer project={project} source={null} onNode={() => undefined} onEdge={() => undefined} run={run} />), search, queryGraph };
}
describe("关系查询状态", () => {
  it("新搜索不保留已经消失的旧符号，无结果时禁止查询", async () => {
    const { view, search } = setup();
    fireEvent.click(view.getByRole("button", {name:/^搜索$/}));
    await waitFor(() => expect((view.getByLabelText("选择符号") as HTMLSelectElement).value).toBe("a"));
    search.mockResolvedValueOnce({items:[node("b")]});
    fireEvent.click(view.getByRole("button", {name:/^搜索$/}));
    await waitFor(() => expect((view.getByLabelText("选择符号") as HTMLSelectElement).value).toBe("b"));
    search.mockResolvedValueOnce({items:[]});
    fireEvent.click(view.getByRole("button", {name:/^搜索$/}));
    await waitFor(() => expect(view.getByText(/没有找到匹配的符号/)).toBeTruthy());
    expect((view.getByRole("button", {name:"查询关系"}) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });
  it("修改条件阻止旧游标续查，非法预算不会发送请求", async () => {
    const { view, queryGraph } = setup();
    fireEvent.click(view.getByRole("button", {name:/^搜索$/}));
    await waitFor(() => expect((view.getByLabelText("选择符号") as HTMLSelectElement).value).toBe("a"));
    fireEvent.click(view.getByRole("button", {name:"查询关系"}));
    await waitFor(() => expect(view.getByText("结果起点")).toBeTruthy());
    fireEvent.change(view.getByLabelText("关系视图"), {target:{value:"data"}});
    expect(view.getByText(/查询条件已修改/)).toBeTruthy();
    expect((view.getByRole("button", {name:"继续探索"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(view.getByLabelText("查询深度"), {target:{value:"0"}});
    fireEvent.click(view.getByRole("button", {name:"查询关系"}));
    expect(queryGraph).toHaveBeenCalledTimes(1);
    fireEvent.change(view.getByLabelText("查询深度"), {target:{value:"3"}});
    fireEvent.click(view.getByRole("button", {name:"查询关系"}));
    await waitFor(() => expect(queryGraph).toHaveBeenCalledTimes(2));
    expect(queryGraph.mock.calls[1]?.[0]).not.toHaveProperty("continuationCursor");
    await waitFor(() => expect(view.queryByText(/查询条件已修改/)).toBeNull());
    view.unmount();
  });
  it("待完成的搜索显示反馈且不能重复发送", async () => {
    let complete!: (value: unknown) => void;
    const search = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const { view } = setup(search);
    fireEvent.keyDown(view.getByLabelText("搜索符号"), {key:"Enter", isComposing:true});
    expect(search).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", {name:/^搜索$/}));
    expect((view.getByRole("button", {name:"搜索中…"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(view.getByLabelText("搜索符号"), {key:"Enter"});
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => complete({items:[node("a")]}));
    view.unmount();
  });
});
