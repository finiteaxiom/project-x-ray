// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { GraphNode } from "@project-xray/contracts";
import { GraphNodeBrowser } from "./GraphNodeBrowser";

const nodes: GraphNode[] = Array.from({ length: 45 }, (_, index) => ({ id: `node-${index}`, snapshotId: "snapshot", kind: index === 44 ? "function" : "file", name: `node-${String(index).padStart(2, "0")}`, qualifiedName: `src/node-${index}`, filePath: `src/${String(44 - index).padStart(2, "0")}.ts`, metadata: {} }));

describe("图谱列表探索", () => {
  it("分页、类型筛选与重置保持真实节点导航，按路径排序", () => {
    const onSelect = vi.fn(); const view = render(<GraphNodeBrowser nodes={nodes} onSelect={onSelect} />);
    expect(view.container.querySelectorAll('.graph-node-rows button')).toHaveLength(40);
    fireEvent.click(view.getByRole('button', {name:'下一页'}));
    expect(view.container.querySelectorAll('.graph-node-rows button')).toHaveLength(5);
    fireEvent.change(view.getByLabelText('筛选节点类型'), {target:{value:'function'}});
    fireEvent.click(view.getByRole('button', {name:/node-44/}));
    expect(onSelect).toHaveBeenCalledWith(nodes[44]);
    fireEvent.change(view.getByLabelText('筛选图谱节点'), {target:{value:'missing'}});
    expect(view.getByText('没有匹配的节点')).toBeTruthy();
    fireEvent.click(view.getByRole('button', {name:'显示全部节点'}));
    fireEvent.change(view.getByLabelText('节点排序'), {target:{value:'path'}});
    expect(view.container.querySelector('.graph-node-rows button')?.textContent).toContain('node-44');
    view.unmount();
  });
  it("结果缩减后不会停留在空白页", () => {
    const view = render(<GraphNodeBrowser nodes={nodes} onSelect={() => undefined} />);
    fireEvent.click(view.getByRole('button', {name:'下一页'}));
    view.rerender(<GraphNodeBrowser nodes={nodes.slice(0,2)} onSelect={() => undefined} />);
    expect(view.container.querySelectorAll('.graph-node-rows button')).toHaveLength(2);
    view.unmount();
  });
});
