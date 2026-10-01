// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IGNORE_POLICY_VERSION, type IgnoreSettingsResponse, type ProjectOverview, type XRayApi } from "@project-xray/contracts";
import { IgnoreSettingsEditor } from "./IgnoreSettingsEditor";

afterEach(cleanup);
const project = { repositoryId: "repo", snapshotId: "snap" } as ProjectOverview;
const response = (revision = 0, rules: string[] = []): IgnoreSettingsResponse => ({ ...project, settings: { version: IGNORE_POLICY_VERSION, revision, rules }, policy: { version: IGNORE_POLICY_VERSION, rules, hash: String(revision) }, defaultRules: ["**/.env*"], snapshotPolicy: { version: IGNORE_POLICY_VERSION, rules: [], hash: "0" } });
function api() {
  const getIgnoreSettings = vi.fn<XRayApi["getIgnoreSettings"]>(async ref => { expect(Object.keys(ref).sort()).toEqual(["repositoryId", "snapshotId"]); return response(); });
  const saveIgnoreSettings = vi.fn(async (input) => response(1, input.rules));
  window.xray = { getIgnoreSettings, saveIgnoreSettings } as unknown as XRayApi;
  return { getIgnoreSettings, saveIgnoreSettings };
}
describe("项目规则编辑", () => {
  it("拒绝越界并保存规范化规则，刷新失效后才重新索引", async () => {
    const mocks = api(); const calls: string[] = []; const onSaved = vi.fn(async () => { calls.push("refresh"); }); const reindex = vi.fn(() => { calls.push("index"); });
    render(<IgnoreSettingsEditor project={project} indexing={false} onSaved={onSaved} reindex={reindex} />);
    const editor = await screen.findByLabelText("自定义排除规则（每行一条）");
    fireEvent.change(editor, { target: { value: "../outside" } }); fireEvent.click(screen.getByText("保存规则"));
    expect(await screen.findByRole("alert")).toBeTruthy(); expect(mocks.saveIgnoreSettings).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: " GENERATED/ \ngenerated/**" } }); fireEvent.click(screen.getByText("保存并重新索引"));
    await waitFor(() => expect(reindex).toHaveBeenCalledOnce()); expect(calls).toEqual(["refresh", "index"]);
    expect(mocks.saveIgnoreSettings).toHaveBeenCalledWith({ ...project, expectedRevision: 0, rules: ["generated/**"] });
    expect(screen.getByText("当前快照使用：默认排除规则")).toBeTruthy();
  });
  it("保存失败保持草稿并可刷新重试，活动索引禁止保存", async () => {
    const mocks = api(); mocks.saveIgnoreSettings.mockRejectedValueOnce(new Error("比较任务进行中，请重试"));
    const props = { project, onSaved: vi.fn(async () => undefined), reindex: vi.fn() };
    const view = render(<IgnoreSettingsEditor {...props} indexing={false} />);
    const editor = await screen.findByLabelText("自定义排除规则（每行一条）"); fireEvent.change(editor, { target: { value: "generated/" } }); fireEvent.click(screen.getByText("保存规则"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "比较任务进行中，请重试"); expect(editor).toHaveProperty("value", "generated/");
    fireEvent.click(screen.getByText("刷新规则")); await waitFor(() => expect(mocks.getIgnoreSettings).toHaveBeenCalledTimes(2));
    view.rerender(<IgnoreSettingsEditor {...props} indexing={true} />); expect(screen.getByText("保存规则")).toHaveProperty("disabled", true);
    expect(props.reindex).not.toHaveBeenCalled();
  });
  it("跨项目迟到配置响应不覆盖当前草稿", async () => {
    const mocks = api(); let resolve!: (value: IgnoreSettingsResponse) => void;
    mocks.getIgnoreSettings.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const props = { indexing: false, onSaved: vi.fn(async () => undefined), reindex: vi.fn() };
    const view = render(<IgnoreSettingsEditor {...props} project={project} />);
    const other = { ...project, repositoryId: "other", snapshotId: "other-snap" }; mocks.getIgnoreSettings.mockResolvedValueOnce({ ...response(), ...other });
    view.rerender(<IgnoreSettingsEditor {...props} project={other} />);
    const editor = await screen.findByLabelText("自定义排除规则（每行一条）"); fireEvent.change(editor, { target: { value: "keep-draft/" } });
    resolve(response(1, ["wrong/**"])); await waitFor(() => expect(editor).toHaveProperty("value", "keep-draft/"));
  });
  it("已加载配置随后被判定损坏时停止编辑", async () => {
    const mocks = api(); const props = { project, indexing: false, onSaved: vi.fn(async () => undefined), reindex: vi.fn() };
    const view = render(<IgnoreSettingsEditor {...props} />); const editor = await screen.findByLabelText("自定义排除规则（每行一条）");
    view.rerender(<IgnoreSettingsEditor {...props} configurationUnavailable />);
    expect(editor).toHaveProperty("disabled", true); expect(screen.getByText("保存规则")).toHaveProperty("disabled", true);
    expect(mocks.saveIgnoreSettings).not.toHaveBeenCalled();
  });
  it("完整Overview对象不会跨过严格IPC边界", async () => {
    const mocks = api(); render(<IgnoreSettingsEditor project={{ ...project, name: "full-project", rootPath: "C:/fixture" }} indexing={false} onSaved={vi.fn(async () => undefined)} reindex={vi.fn()} />);
    await screen.findByLabelText("自定义排除规则（每行一条）");
    expect(mocks.getIgnoreSettings).toHaveBeenCalledWith({ repositoryId: project.repositoryId, snapshotId: project.snapshotId });
  });
});
