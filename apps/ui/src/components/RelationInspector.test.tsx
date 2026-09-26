// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IdentifiedEvidence, GraphEdge, XRayApi } from "@project-xray/contracts";
import { RelationInspector } from "./RelationInspector";

const project = { repositoryId: "repo", snapshotId: "snap" };
const edge: GraphEdge = { id: "a", snapshotId: "snap", source: "from", target: "to", kind: "CALLS", confidence: "inferred", evidenceId: "a", reason: "启发式调用目标" };
const evidence = (id: string): IdentifiedEvidence => ({ id, repositoryId: "repo", snapshotId: "snap", analyzer: "parser", analyzerVersion: "2", kind: "call", confidence: "inferred", reason: "heuristic", span: { filePath: `${id}.ts`, startLine: 3, startColumn: 0, endLine: 3, endColumn: 12 } });
afterEach(cleanup);
describe("关系证据检查", () => {
  it("切换关系时忽略迟到证据，只有用户确认后导航", async () => {
    let finish!: (value: IdentifiedEvidence) => void;
    const getEvidence = vi.fn().mockImplementationOnce(() => new Promise<IdentifiedEvidence>((resolve) => { finish = resolve; })).mockResolvedValueOnce(evidence("b"));
    window.xray = { getEvidence } as unknown as XRayApi;
    const onOpen = vi.fn(); const props = { project, onOpen, onClose: vi.fn() };
    const view = render(<RelationInspector {...props} edge={edge} />);
    view.rerender(<RelationInspector {...props} edge={{ ...edge, id: "b", evidenceId: "b" }} />);
    await screen.findByText(/b.ts/); finish(evidence("a"));
    await waitFor(() => expect(screen.queryByText(/a.ts/)).toBeNull());
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "定位源码证据 →" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });
  it("失败可重试，错误快照不能打开源码", async () => {
    window.xray = { getEvidence: vi.fn().mockRejectedValueOnce(new Error("failed")).mockResolvedValueOnce({ ...evidence("a"), snapshotId: "old" }) } as unknown as XRayApi;
    render(<RelationInspector project={project} edge={edge} onOpen={vi.fn()} onClose={vi.fn()} />);
    await screen.findByRole("alert"); await userEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByText(/证据与当前项目快照不匹配/);
    expect(screen.queryByRole("button", { name: "定位源码证据 →" })).toBeNull();
  });
  it("拒绝显示其他仓库的同快照证据", async () => {
    window.xray = { getEvidence: vi.fn(async () => ({ ...evidence("a"), repositoryId: "other-repository" })) } as unknown as XRayApi;
    render(<RelationInspector project={project} edge={edge} onOpen={vi.fn()} onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("当前项目快照不匹配");
    expect(screen.queryByText(/a\.ts/)).toBeNull(); expect(screen.queryByRole("button", { name: "定位源码证据 →" })).toBeNull();
  });
});
