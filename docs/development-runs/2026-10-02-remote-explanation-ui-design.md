# 2026-10-02：远程解释 UI 接入设计记录

协调方 2026-10-02 10:18–10:27 复审后接受修订后的两文档设计：真实 RemotePreview 字段与上限、候选 API、queued 无 SQL 取消、复用同步 revoke、技术检查与延期 GUI 边界符合源码/ADR。仅设计接受，正式 UI、IPC 与 GUI 未验收。以下开发记录保留其写作时的候选状态，不改写为实现通过。

## 目标与范围

基于 Project X-Ray 当前源码和已接受的 ADR-0007，形成 1D-0 远程功能解释 UI 接入计划。本轮只新增本文件与 docs/plans/2026-10-02-remote-explanation-ui.md；不实现 UI，不修改 XRayApi、IPC、desktop、application、graph、AGENTS.md 或其他文档。

## 基线

- Checkout：D:\Projects\Project X-Ray。
- 开始时 HEAD：792602e4c35e67a3c5d2e5a30cae02628495a838；源码核对基于此代码基线。
- 开始时 git status --short 为空；两份目标文档开始时均不存在。
- 未运行 Git 写操作。
- 起草后复核发现 main/origin/main 已前进到 6c18c20a3f2270609c59d5e6fc33cf81ddac13fd；只读 git show --stat 显示该提交仅新增/修改三份其他 development-run/plan 文档，没有源码变化。本轮没有改动这些文件；最终工作区只显示本轮两份指定文档为未跟踪文件。
- 定向修订期间 main/origin/main 又前进到 3f58ddc24a395f1d8bc2b585ac942ed41d24cfc2；只读 git show --stat 同样显示该提交仅改动其他 development-run/plan 文档，没有源码变化。本轮源码判断仍基于 792602e 代码状态，6c18c20 与 3f58ddc 为后续文档提交。

## 查阅证据

- apps/ui/src/components/FeatureExplanationWorkspace.tsx 及同名测试：本地 Explain 请求、page state、当前快照证据导航和切页存续行为。
- apps/ui/src/state/ownership-sessions.ts 及同名测试：page generation、stale/archived 状态、重新激活、迟到回写失效。
- apps/ui/src/App.tsx 与 App.test.tsx：同步 navigateTo、项目/快照转换、当前本地 Explain 跨页测试。
- packages/contracts/src/remote-explanation.ts、remote-explanation-desktop.ts 与 packages/contracts/src/index.ts：远程数据、task/result/schema，以及尚未接入现有 XRayApi 的 renderer wire protocol。
- packages/application/src/remote-explanation.ts、packages/graph/src/remote-explanation-store.ts、apps/desktop/src/remote-provider.ts：现有 application service、migration 10 role store、provider adapter。
- apps/desktop/src/main.ts、preload.ts：当前 main/preload 仍只暴露旧 XRayApi 与 AnalysisBroker，没有远程解释 broker/IPC。协调审查收到的 Sol 候选 XRayApi 是 remoteExplanation(RemoteRendererRequest): Promise<RemoteRendererReply> 与 onRemoteExplanationEvent(RemoteDesktopNotification)，但有序迟到 task event 可能无法呈现 completed，已退回修正；候选尚未集成 main 或冻结。
- docs/decisions/0007-evidence-constrained-remote-explanations.md：已接受的隐私、授权、preview、task/context 与分批文件边界。

## 发现与设计修正

1. 本地 explainFeature 有意跨页继续，并由 OwnershipSessionController 保存轻量结果；远程 service 的 commitTrustedContext 会封锁 owner、删除 preview、abort 准备和运行任务并提交新的权威 context。计划因此明确分开两种生命周期，不把远程任务存入本地页面 session。
2. contracts 已有严格 renderer wire request/reply schema，但模块明确说明它们不会自动成为 XRayApi 或 IPC channel；当前 main/preload 也没有 broker 接线。ADR 中 UI method 表仍标为冻结前草案。计划将 Sol 的 XRayApi/事件/IPC 冻结列为前置门槛，不猜 method shape、不加 production mock。
3. 当前 TaskRecord phase schema没有百分比及 ADR 草案中所有网络子阶段。计划要求 UI 只呈现已冻结 schema 能证明的状态，不自行发明进度或任务状态。
4. status/result 有 context 身份约束，renderer operation union 没有独立 list-history operation；离页重新激活会更换 context。计划把新 context 下的只读历史恢复列为 Sol 冻结时需明确的接口语义；UI 不能用旧 handle、preview 或 start 来模拟恢复。
5. preview 的完整字段范围按 RemotePreview 实际提供的数据收敛；不宣称拥有 HTTP 正文长度/正文摘要计算能力，也不展示未提供的付费额度。未提供字段若成为验收要求，须作为后端合同前置，而不是 UI 自行计算。
6. queued cancellation 候选 { protocolVersion, handle, code: CANCELLED } 没有 SQL identity；计划将它保留为独立终态分支，不伪造成 preparing/RemoteTaskRecord。
7. 当前 checkout 的 App.navigateTo 是同步路由路径且未集成 revoke。协调审查提供的 Sol 候选有同步 transition/revoke 入口但未集成主 checkout；计划要求 UI 在该候选经接受后复用它，仅补 Explain enter 与 confirmed gate，不重复实现撤销。
8. 本轮用户明确暂不电脑操作。实施验收顺序是先代码/组件回归，再技术 IPC artifact；真实 GUI 操作独立延期，CLI/截图不能替代。

上述均为源码/审查合同边界导致的设计处理，不是运行期失败；没有新增复现或代码更改。

## 验证与未验证

- 已只读核对指定 HEAD、开始时 Git 状态、目标文件不存在、源文件/API 的现状及 ADR 对应章节。
- 没有运行测试、构建、安装、模型、网络或 GUI；没有读写任何其他 worktree。
- 本轮没有验证 UI、desktop IPC、真实 Electron 操作、外部模型兼容或远程解释质量。Sol 候选仍待修正并独立接受，main/broker 尚未在主 checkout 集成；用户本轮暂不电脑操作。真实服务仍须另行手动配置与授权。

## 规则沉淀判断

本轮无新增 AGENTS.md 规则。理由：设计只把已有的证据契约、安全边界和职责分层应用到 UI 生命周期；没有经实现或复现实验确认的新通用工程经验。计划和本记录不能替代后续回归、IPC build artifact 或真实 Electron 验收。
