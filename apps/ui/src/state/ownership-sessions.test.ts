// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import { TASK_PROTOCOL_VERSION, type ChangeReport, type ComparisonMode, type ComparisonTaskEvent, type ComparisonTaskHandle, type ProjectOverview } from "@project-xray/contracts";
import { createOwnershipSessionController } from "./ownership-sessions";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const project = (repositoryId = "repo", snapshotId = "snapshot-one"): ProjectOverview => ({
  repositoryId, snapshotId, name: repositoryId, rootPath: "fixture", sourceType: "local", createdAt: "2026-09-26T00:00:00.000Z",
  analysisIdentity: { graphIrVersion: "1.2.0", analyzerVersions: {}, configurationHash: "cfg", sourceFingerprint: snapshotId },
  health: { status: "ready", totalFiles: 1, indexedFiles: 1, skippedFiles: 0, unsupportedFiles: 0, ignoredByRule: [], failedFiles: [], languageCounts: {}, limitations: [] },
  counts: { nodes: 0, edges: 0, evidence: 0, modules: 0, files: 1, calls: 0, unknown: 0 },
});

const report = (repositoryId: string, mode: ComparisonMode, id = "report-one"): ChangeReport => ({
  repositoryId, mode, id,
  left: { snapshot: { repositoryId, snapshotId: "left-snapshot" } },
  right: { snapshot: { repositoryId, snapshotId: "right-snapshot" } },
} as unknown as ChangeReport);

const completed = (taskId: string, repositoryId = "repo", mode: ComparisonMode = "working", id = "report-one"): ComparisonTaskEvent => ({
  protocolVersion: TASK_PROTOCOL_VERSION, type: "completed", taskId, repositoryId, report: report(repositoryId, mode, id),
} as ComparisonTaskEvent);
const failed = (taskId: string, repositoryId = "repo"): ComparisonTaskEvent => ({
  protocolVersion: TASK_PROTOCOL_VERSION, type: "failed", taskId, repositoryId, code: "GIT_COMPARISON_FAILED", retryable: true,
} as ComparisonTaskEvent);
const handle = (taskId: string, repositoryId = "repo", mode: ComparisonMode = "working"): ComparisonTaskHandle => ({
  protocolVersion: TASK_PROTOCOL_VERSION, taskId, repositoryId, mode,
});
const request = (repositoryId = "repo", snapshotId = "snapshot-one", mode: ComparisonMode = "working") => ({
  repositoryId, snapshotId, mode, maxDepth: 4, maxPaths: 30, maxWork: 5000,
});

describe("会话级 Git 比较任务", () => {
  it("启动响应前的终态优先于重复终态；启动窗口内取消仍按后端实际结果收口", async () => {
    const sessions = createOwnershipSessionController();
    const starting = deferred<ComparisonTaskHandle>();
    const cancel = vi.fn(async () => undefined);
    sessions.startComparison(project(), request(), () => starting.promise, cancel);
    const taskResult = completed("task-fast");
    sessions.receiveComparisonEvent(taskResult);
    sessions.receiveComparisonEvent(failed("task-fast"));
    sessions.requestComparisonCancel("repo");
    expect(sessions.getComparisonJob("repo")?.status).toBe("cancelling");

    starting.resolve(handle("task-fast"));
    await waitFor(() => expect(sessions.getComparisonJob("repo")?.status).toBe("completed"));
    expect(sessions.getComparisonJob("repo")?.report?.id).toBe("report-one");
    expect(cancel).not.toHaveBeenCalled();
    sessions.receiveComparisonEvent(failed("task-fast"));
    expect(sessions.getComparisonJob("repo")?.status).toBe("completed");
  });

  it("取消请求保持 cancelling 直到收到后端终态，随后允许安全重试并忽略旧 taskId", async () => {
    const sessions = createOwnershipSessionController();
    const cancel = vi.fn(async () => undefined);
    sessions.startComparison(project(), request(), async () => handle("task-old"), cancel);
    await waitFor(() => expect(sessions.getComparisonJob("repo")?.status).toBe("running"));
    sessions.requestComparisonCancel("repo");
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("task-old"));
    expect(sessions.getComparisonJob("repo")?.status).toBe("cancelling");
    sessions.receiveComparisonEvent({ protocolVersion: TASK_PROTOCOL_VERSION, type: "cancelled", taskId: "task-old", repositoryId: "repo", message: "cancelled" });
    expect(sessions.getComparisonJob("repo")?.status).toBe("cancelled");

    const retry = deferred<ComparisonTaskHandle>();
    sessions.startComparison(project(), request(), () => retry.promise, cancel);
    sessions.receiveComparisonEvent(completed("task-old", "repo", "working", "old-report"));
    retry.resolve(handle("task-new"));
    await waitFor(() => expect(sessions.getComparisonJob("repo")?.taskId).toBe("task-new"));
    expect(sessions.getComparisonJob("repo")?.status).toBe("running");
    expect(sessions.getComparisonJob("repo")?.report).toBeNull();
  });

  it("每个仓库至多一个活动任务，仓库事件互相隔离", async () => {
    const sessions = createOwnershipSessionController();
    const repoA = deferred<ComparisonTaskHandle>();
    const repoB = deferred<ComparisonTaskHandle>();
    const start = vi.fn((repositoryId: string) => repositoryId === "repo-a" ? repoA.promise : repoB.promise);
    sessions.startComparison(project("repo-a"), request("repo-a"), () => start("repo-a"), async () => undefined);
    expect(sessions.startComparison(project("repo-a"), request("repo-a"), async () => handle("duplicate"), async () => undefined)).toBeNull();
    sessions.startComparison(project("repo-b"), request("repo-b"), () => start("repo-b"), async () => undefined);
    repoA.resolve(handle("task-a", "repo-a"));
    repoB.resolve(handle("task-b", "repo-b"));
    await waitFor(() => {
      expect(sessions.getComparisonJob("repo-a")?.status).toBe("running");
      expect(sessions.getComparisonJob("repo-b")?.status).toBe("running");
    });
    sessions.receiveComparisonEvent(completed("task-a", "repo-a", "working", "report-a"));
    expect(sessions.getComparisonJob("repo-a")?.report?.id).toBe("report-a");
    expect(sessions.getComparisonJob("repo-b")?.status).toBe("running");
    expect(sessions.getComparisonJob("repo-b")?.report).toBeNull();
  });

  it("限制页面快照缓存但保留训练草稿与仍运行的比较任务", () => {
    const sessions = createOwnershipSessionController();
    const first = project("repo", "snapshot-0");
    const firstSession = sessions.activate(first);
    sessions.updateSession(firstSession, (current) => ({ ...current, answer: "尚未提交的训练草稿" }));
    sessions.ensurePageValue(first, "diff", "report", null);
    const pendingStart = deferred<ComparisonTaskHandle>();
    sessions.startComparison(first, request("repo", "snapshot-0"), () => pendingStart.promise, async () => undefined);

    for (let index = 0; index < 8; index += 1) {
      const current = project("repo", "snapshot-" + index);
      const training = sessions.sessionId(current) ?? sessions.activate(current);
      if (index > 0) sessions.updateSession(training, (session) => ({ ...session, answer: "draft-" + index }));
      sessions.activateWorkspaceSnapshot(current);
      for (const page of ["architecture", "flow", "explain", "diff"] as const) sessions.ensurePageValue(current, page, "cached", index);
    }

    expect(sessions.listArchived("repo")).toHaveLength(7);
    expect(sessions.getSession(firstSession)?.answer).toBe("尚未提交的训练草稿");
    expect(sessions.getComparisonJob("repo")?.status).toBe("starting");
    for (const page of ["architecture", "flow", "explain", "diff"] as const) {
      const retained = Array.from({ length: 8 }, (_, index) => sessions.getPageRecord(project("repo", "snapshot-" + index), page)).filter(Boolean);
      expect(retained.length).toBeLessThanOrEqual(page === "diff" ? 6 : 5);
    }
    expect(sessions.getPageRecord(first, "diff")).not.toBeNull();
  });
});

describe("工作区快照重新激活", () => {
  it("A → B → A 恢复同内容页面状态，但旧请求不能跨激活代次回写", async () => {
    const sessions = createOwnershipSessionController();
    const a = { repositoryId: "repo", snapshotId: "snapshot-a" };
    const b = { repositoryId: "repo", snapshotId: "snapshot-b" };
    sessions.ensurePageValue(a, "flow", "search", "login");
    sessions.ensurePageValue(a, "flow", "symbols", [{ id: "login", snapshotId: "snapshot-a" }]);
    sessions.ensurePageValue(a, "flow", "result", { repositoryId: "repo", snapshotId: "snapshot-a", nodes: ["cached-a"] });
    sessions.ensurePageValue(a, "flow", "searching", false);
    sessions.ensurePageValue(a, "flow", "querying", false);
    sessions.ensurePageValue(a, "flow", "error", "");
    const oldRequest = deferred<string>();
    const oldAccept = vi.fn((value: string) => sessions.updateCurrentPageValue(a, "flow", "result", { repositoryId: "repo", snapshotId: "snapshot-a", nodes: [value] }));
    const oldReject = vi.fn();
    sessions.updateCurrentPageValue(a, "flow", "searching", true);
    expect(sessions.runWorkspaceRequest(a, "flow", "search", "old-login", () => oldRequest.promise, oldAccept, oldReject)).toBe(true);

    sessions.markWorkspaceStale(a);
    expect(sessions.getPageRecord(a, "flow")?.lifecycle).toBe("stale");
    sessions.activateWorkspaceSnapshot(b, 1);
    sessions.ensurePageValue(b, "flow", "result", { repositoryId: "repo", snapshotId: "snapshot-b", nodes: ["only-b"] });
    expect(sessions.getPageRecord(a, "flow")?.lifecycle).toBe("archived");
    sessions.activateWorkspaceSnapshot(a, 2);
    const activeA = sessions.getPageRecord(a, "flow");
    expect(activeA?.lifecycle).toBe("active");
    expect(activeA?.state.search).toBe("login");
    expect(activeA?.state.result).toEqual({ repositoryId: "repo", snapshotId: "snapshot-a", nodes: ["cached-a"] });
    expect(activeA?.state.searching).toBe(false);
    const activationGeneration = activeA?.generation;

    const newRequest = deferred<string>();
    const newAccept = vi.fn((value: string) => sessions.updateCurrentPageValue(a, "flow", "result", { repositoryId: "repo", snapshotId: "snapshot-a", nodes: [value] }));
    sessions.updateCurrentPageValue(a, "flow", "searching", true);
    expect(sessions.runWorkspaceRequest(a, "flow", "search", "new-login", () => newRequest.promise, newAccept, vi.fn())).toBe(true);
    sessions.activateWorkspaceSnapshot(a, 2);
    sessions.activateWorkspaceSnapshot(b, 1);
    expect(sessions.getPageRecord(a, "flow")?.generation).toBe(activationGeneration);
    expect(sessions.getPageRecord(a, "flow")?.lifecycle).toBe("active");

    await act(async () => { oldRequest.resolve("late-old-a"); });
    expect(oldAccept).not.toHaveBeenCalled(); expect(oldReject).not.toHaveBeenCalled();
    expect(sessions.getPageRecord(a, "flow")?.state.searching).toBe(true);
    await act(async () => { newRequest.resolve("new-a"); });
    expect(newAccept).toHaveBeenCalledWith("new-a");
    expect(sessions.getPageRecord(a, "flow")?.state.result).toEqual({ repositoryId: "repo", snapshotId: "snapshot-a", nodes: ["new-a"] });
    expect(sessions.getPageRecord(b, "flow")?.state.result).toEqual({ repositoryId: "repo", snapshotId: "snapshot-b", nodes: ["only-b"] });
  });

  it("同一仓库较旧的状态检查/激活事件不能重新解锁新代次，新确认的过期事件仍生效", () => {
    const sessions = createOwnershipSessionController();
    const a = { repositoryId: "repo", snapshotId: "snapshot-a" };
    const other = { repositoryId: "other-repo", snapshotId: "snapshot-a" };
    sessions.ensurePageValue(a, "flow", "searching", false);
    sessions.ensurePageValue(a, "flow", "querying", false);
    sessions.ensurePageValue(other, "flow", "searching", false);
    sessions.markWorkspaceStale(a);
    sessions.activateWorkspaceSnapshot(a, 4);
    const activeGeneration = sessions.getPageRecord(a, "flow")?.generation;
    sessions.markWorkspaceStale(a);
    expect(sessions.getPageRecord(a, "flow")?.lifecycle).toBe("stale");

    sessions.activateWorkspaceSnapshot(a, 3); // A late older activation cannot undo the newer stale observation.
    expect(sessions.getPageRecord(a, "flow")?.lifecycle).toBe("stale");
    expect(sessions.getPageRecord(a, "flow")?.generation).toBe((activeGeneration ?? 0) + 1);

    sessions.markWorkspaceStale(other);
    sessions.activateWorkspaceSnapshot({ repositoryId: "third-repo", snapshotId: "snapshot-a" }, 5);
    expect(sessions.getPageRecord(other, "flow")?.lifecycle).toBe("stale");
  });

  it("重新激活仅清理旧请求锁和错误，不恢复无效解释 loading 或不匹配结果", () => {
    const sessions = createOwnershipSessionController();
    const ref = { repositoryId: "repo", snapshotId: "snapshot-a" };
    sessions.ensurePageValue(ref, "flow", "searching", true);
    sessions.ensurePageValue(ref, "flow", "querying", true);
    sessions.ensurePageValue(ref, "flow", "error", "旧请求错误");
    sessions.ensurePageValue(ref, "flow", "result", { repositoryId: "foreign", snapshotId: "snapshot-a", nodes: [] });
    sessions.ensurePageValue(ref, "explain", "state", "loading");
    sessions.ensurePageValue(ref, "explain", "error", "");
    sessions.ensurePageValue(ref, "explain", "result", { repositoryId: "repo", snapshotId: "snapshot-a", steps: [] });
    sessions.ensurePageValue(ref, "explain", "openingEvidence", "ev-old");
    sessions.markWorkspaceStale(ref);
    sessions.activateWorkspaceSnapshot(ref, 1);
    const flow = sessions.getPageRecord(ref, "flow")?.state;
    const explain = sessions.getPageRecord(ref, "explain")?.state;
    expect(flow?.searching).toBe(false); expect(flow?.querying).toBe(false); expect(flow?.error).toBe("");
    expect(flow?.result).toBeNull(); expect(flow?.resultKey).toBe("");
    expect(explain?.state).toBe("idle"); expect(explain?.openingEvidence).toBe("");
    expect(explain?.result).toEqual({ repositoryId: "repo", snapshotId: "snapshot-a", steps: [] });
  });

  it("过期确认早于页面首次打开时，新建的页面记录仍保持锁定", () => {
    const sessions = createOwnershipSessionController();
    const ref = { repositoryId: "repo", snapshotId: "snapshot-a" };
    sessions.markWorkspaceStale(ref);
    expect(sessions.getPageRecord(ref, "flow")?.lifecycle).toBe("stale");
    expect(sessions.ensurePageValue(ref, "flow", "search", "login").lifecycle).toBe("stale");
    expect(sessions.runWorkspaceRequest(ref, "flow", "search", "login", async () => "should-not-run", vi.fn(), vi.fn())).toBe(false);
    sessions.activateWorkspaceSnapshot(ref, 1);
    expect(sessions.ensurePageValue(ref, "flow", "search", "").lifecycle).toBe("active");
  });

  it("页面快照重新激活不会恢复 stale 训练成绩或重建训练会话", () => {
    const sessions = createOwnershipSessionController();
    const ref = project("repo", "snapshot-a");
    const sessionId = sessions.activate(ref);
    sessions.updateSession(sessionId, (session) => ({ ...session, answer: "未提交的旧训练草稿" }));
    sessions.markStale(ref);
    sessions.markWorkspaceStale(ref);
    sessions.activateWorkspaceSnapshot(ref, 1);
    expect(sessions.sessionId(ref)).toBe(sessionId);
    expect(sessions.getSession(sessionId)?.lifecycle).toBe("stale");
    expect(sessions.getSession(sessionId)?.answer).toBe("未提交的旧训练草稿");
  });
});
