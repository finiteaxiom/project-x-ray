# 1D-0：远程功能解释 UI 接入设计

- 状态：2026-10-02 协调方接受修订后的 1D-0 设计；不代表 XRayApi 接口冻结、实现或 GUI 验收。正式 UI 仍等安全接线进入主 checkout。
- 日期：2026-10-02
- 主 checkout 基线：792602e4c35e67a3c5d2e5a30cae02628495a838。
- 范围：为既有远程功能解释设计 UI 与页面生命周期接入；本轮只新增本计划和对应 development-run。

## 目标和边界

在功能解释页增加一个清楚分开的远程解释流程：读取 provider 和项目授权状态，在发送前生成本地证据预览，展示当前 RemotePreview 提供的全部证据包内容及明确的预算上限，要求用户对当前项目明确授权，再由用户单次点击启动远程任务，最终显示受证据约束的推断及其源码引用。预览不宣称包含完整序列化 HTTP 正文。现有本地解释继续独立工作，不依赖 provider、凭据、网络或项目外发授权。

本切片仅覆盖 feature-explanation，不增加架构职责标签、所有权评分、代码生成或其他平台支持。LLM 文字只能标记为 inferred 或 unknown；本地的未知项、截断和静态分析限制始终保留。引用里的原始证据置信度可以照实显示，但不能把它提升为 LLM 结论的置信度。

## Checkout 证据与当前缺口

| 位置 | 当前源码所示行为 | 对 UI 设计的影响 |
| --- | --- | --- |
| apps/ui/src/components/FeatureExplanationWorkspace.tsx | 本地解释调用 window.xray.explainFeature；查询、结果、错误和阅读位置通过 useWorkspacePageState 存在 OwnershipSessionController。组件注释和 App.test.tsx 明确覆盖了切页期间本地生成继续、返回后恢复。 | 本地请求生命周期保持原样；远程操作不能复用其跨页存续语义。 |
| apps/ui/src/state/ownership-sessions.ts | 页面请求以快照、页面和 generation 绑定；过期、归档或重新激活会使旧请求失去回写资格。该 controller 同时承载训练草稿和本地页面状态。 | 不把远程凭据、preview、context handle 或活动 task 放进它。远程控制状态采用 Explain 页组件内的短期状态。 |
| apps/ui/src/App.tsx | navigateTo 是同步路由状态更新；项目切换和 Explain 页面卸载目前没有远程 context 操作。 | App 必须成为页面 context 的唯一协调者。不能只在子组件 unmount cleanup 中做异步 revoke。 |
| packages/contracts/src/remote-explanation.ts 与 remote-explanation-desktop.ts | 远程证据包、授权、provider 配置、preview、task、result、失败码和 desktop renderer/worker 消息都有严格 schema。当前 checkout 的 renderer wire operation 包括 provider-state、configure-provider、凭据写删、authorization、save-authorization、activate-context、prepare、start、cancel、status、result。 | 使用已定义的契约概念和校验边界；不在 UI 中重造数据类型、任务 ID 或 context 身份。 |
| packages/application/src/remote-explanation.ts 与 packages/graph/src/remote-explanation-store.ts | prepare、start、cancel、context 提交、status、result 和迁移 10 的分角色存储已存在。commitTrustedContext 会先封锁 owner、清除 preview 并 abort 准备及活动任务，再提交权威 context；重新激活使用新的 epoch。旧数据默认 unconfigured/denied，未完成任务可恢复为 interrupted。 | UI 只调用服务入口，不重复实现授权、currentness、持久化、取消或迁移逻辑。 |
| apps/desktop/src/remote-provider.ts、main.ts、preload.ts 与 packages/contracts/src/index.ts | production provider adapter 已存在；但本 checkout 的 main/preload 只接 AnalysisBroker 及既有 XRayApi，尚无远程解释 worker/broker IPC 接线。remote-explanation-desktop.ts 说明导出 wire schema 不会自动成为现有 XRayApi 或 IPC channel。协调审查收到的 Sol 候选 XRayApi 为 remoteExplanation(RemoteRendererRequest): Promise<RemoteRendererReply> 与 onRemoteExplanationEvent(RemoteDesktopNotification)；审查发现有序迟到 task event 可能无法呈现 completed，已退回修正，尚不是已接受/可实施的冻结接口。 | 等候 Sol 修正并由协调方接受 main/preload 接线及合同；候选名称仅用于追踪审查，不视为当前 API。不得提前实现、猜签名或加入 production mock。 |
| docs/decisions/0007-evidence-constrained-remote-explanations.md | 已接受 feature-explanation 数据类别、逐项目默认拒绝授权、完整预览、显式发送、固定错误、短期 preview、context 线性化和撤销边界。ADR 中原 UI/IPC 方法表标为冻结前草案。 | 以已接受的安全语义为准；未冻结的 UI API 形状交 Sol 处理。 |

## 用户流程

1. 进入 Explain 页时，App 使用当前项目及快照开启新的远程 context。只有后端确认 ref 与当前激活快照一致后，远程 controls 才可操作。provider/auth 状态查询不做网络健康检查。
2. 本地 Explain 输入仍使用既有输入框和本地按钮。另设独立的“准备远程预览”操作，按当前 query 调用零网络的本地 prepare。query 在准备后发生变化、项目或快照变化、context 变化、授权或 provider revision 变化、preview 过期时，立即废弃 preview 并禁用发送。
3. 预览只使用当前 RemotePreview 能证明的字段：categories、evidencePackage（含节点/关系、proof 身份与范围、实际 snippet、health 和 truncation）、localUnknowns、localLimitations、provider、authorization、bodyDigest、sourceBytes、maxRequestBytes、maxOutputTokens，以及包内的 query 和 analysisIdentity。实际片段和省略情况应可逐项检查，不能只展示类别名称或摘要。maxRequestBytes 是上限，不是实际完整 HTTP body 长度；RemotePreview 不提供剩余付费额度/账户余额。bodyDigest 若展示，只能原样呈现后端返回值（可为空），不得由 UI 计算。不得将证据包预览称为完整序列化 HTTP 正文；若验收要求查看精确线上正文或其实际字节长度，须先由后端合同明确提供并经审查，UI 不得自行补造字段或估算。
4. provider 配置与逐项目授权分开管理。授权默认 denied，按真实 repositoryId、当前 disclosureVersion 和 feature-explanation purpose 明确授予或撤销。授权操作导致 revision 变化；授予后丢弃旧 preview，重新执行零网络 prepare 并要求用户重新检查。任何 grant、provider 配置、key 写入或返回 Explain 页都不能自动发送。key 输入只在提交期间短暂保留；成功、失败、用户取消及离页时都清空输入和临时引用。密钥不写入 OwnershipSessionController、localStorage、sessionStorage、日志、错误、任务历史或重试记录。按 ADR 如实承认 JavaScript 字符串不能保证内存抹除。
5. 只在用户检查完当前 preview 并点击唯一的远程开始按钮时提交一次 start。发送前必须校验 ref、contextHandle、previewId、packageId、query、provider/auth revision 和有效期。start 等待期间禁用重复点击。不会在挂载、授权、切页返回、重连、状态查询或失败后自动重发。
6. 只呈现最终冻结的 task/event schema 能证明的状态。当前 RemoteTaskRecord 只有 preparing、dispatched 和 terminal phases，没有百分比或完整网络子阶段；界面不伪造 token 进度、上传百分比或 validate/publish 阶段。Sol 候选另包含 queued cancellation { protocolVersion, handle, code: CANCELLED }，不含 SQL task identity；该候选必须先修正并冻结。收到该分支时 UI 应按取消终态处理，不把它伪造成 preparing 或 RemoteTaskRecord。其他取消请求显示“已请求取消”，直到后端返回终态；失败按固定 failure code 映射本地文案，不显示任意异常或 response body。用户主动重试必须重新准备并检查 preview，由 main/backend 分配新的 taskId。
7. 远程完成结果使用独立区块呈现。每条 claim 显示 inferred/unknown、引用 proof 和本地未知/限制；引用导航通过现有当前快照证据读取与源码导航路径，核对仓库、快照、evidence ID 及引用范围后打开。结果在再次展示或导航前需由后端按当前 workspace 验证；stale/unavailable 时标记过期并禁用旧引用。远程失败不覆盖本地 Explain 结果。

## 页面与任务生命周期

- App 是 renderer-side context lifecycle coordinator；权威 owner/session/epoch 仍由 main 创建并持有。Sol 尚未集成主 checkout 的候选已提供最小同步 transition/revoke 入口。后续 UI 应复用该入口，不另做一套离页 cleanup 或重新实现撤销；只补 Explain enter 与 main context 确认后的操作门禁。候选接入主 checkout 并独立接受前，不据此实现。
- 在已接受的 transition 入口上，切出 Explain、切项目/快照或重启索引时，先同步阻止当前 UI 继续发起远程操作，再等待 main 权威提交 context 变化后释放新页面中的远程操作。main 按 ADR 先关闭 owner gate，再提交新 epoch/active=false；提交失败时 fail closed 并终止 explanation worker。UI 不得显示“已撤销”或重新开放远程操作，除非收到有效 context 确认。窗口关闭和 main 进程重启由 desktop 按 ADR 处理。取消是资源回收；已经在撤销前获 dispatch 许可的请求可能仍已发送，best effort abort 不能收回外发数据或保证停止服务端计算。
- 每次重新进入 Explain 都取得新的 context 身份。旧 context、preview、task 启动回复及迟到事件均不能恢复活动 UI 状态；接受异步回复前同时比对页面代次、仓库/快照、context 身份及 preview/task 身份。main/worker 继续执行自己的 owner、epoch、window 及任务 identity 核对。
- 远程运行态仅由 RemoteExplanationControls 持有，随离页丢弃；不放入 OwnershipSessionController，不跨页保存 key、preview 或可启动的旧 handle。离页会撤销 context、尽力取消 active task 并废弃 preview。重新进入时不得借旧 handle 再次 start。
- 重新进入后可重新读取 provider/auth 等非秘密状态。是否能以新 context 只读回取已完成 history/result，必须由 Sol 在冻结 XRayApi 时明确给出与当前协议兼容的安全语义。现有 status/result 是 context 绑定的操作，不能猜测可用旧 contextHandle；当前 renderer operation union 也没有独立 list-history operation。若冻结合同不支持在新 context 下安全回取，则本切片不恢复旧远程结果。无论采用哪种方式，都不得自动重新 dispatch；旧结果必须重新检查 currentness。
- 本地 explainFeature 的 session 生命周期不改变：切页期间的本地请求可以完成，当前 repo/snapshot/generation 不匹配的响应不能回写。

## 组件职责和最小文件边界

| 文件 | 计划职责 | 边界 |
| --- | --- | --- |
| apps/ui/src/App.tsx | 在 Sol 候选同步 transition/revoke 入口接受并集成后复用它；补 Explain enter 与 main 已确认 context 后的操作门禁，处理 project/snapshot/index 生命周期并把已确认 context 身份传给 Explain。 | 不另写第二套离页 revoke/cleanup；不直接调用 provider/fetch，不构造 authority identity，不把远程任务存进 OwnershipSessionController。 |
| apps/ui/src/App.test.tsx | 验证复用既有 transition 入口、Explain enter 未确认前不可远程操作、leave/revoke 确认后才释放新页面、context commit 失败和迟到响应 fail closed。 | 只使用最终接受的 XRayApi 验证；不添加 production mock provider。 |
| apps/ui/src/components/FeatureExplanationWorkspace.tsx | 保留现有本地追踪和导航；嵌入远程控制组件，共享当前 query 和同一证据导航回调。 | 不将 RemoteResult 填入 FeatureExplanation 类型或本地 result/session 字段。 |
| apps/ui/src/components/RemoteExplanationControls.tsx（新增） | 管理当前挂载的 provider/auth 状态、key 输入、preview、单个 active task、cancel 请求、远程结果和安全诊断；展示 disclosure 与完整 preview。 | 所有调用必须来自 Sol 冻结的 XRayApi；无独立 API 命名或运行时模拟。 |
| apps/ui/src/components/RemoteExplanationControls.test.tsx（新增） | 验证预览、授权改版后重新 prepare、唯一 start、取消/错误、输入改变、stale/迟到响应、inferred/unknown 和 citation navigation。 | 不触发真实网络或凭据。 |
| apps/ui/src/components/FeatureExplanationWorkspace.test.tsx | 回归本地解释行为及本地、远程结果分离。 | 保持离页本地请求继续完成的既有测试契约。 |
| packages/contracts/src/index.ts、apps/desktop/src/preload.ts、apps/desktop/src/main.ts | 仅在 Sol 完成并冻结窄 XRayApi/IPC/event schema 后接入对应接口。 | 协调方先审查 Sol 交付；不得从远程协议 operation 推断未冻结的 renderer method。 |

本切片默认不修改 apps/ui/src/state/ownership-sessions.ts、GraphStore、数据库 migration、application remote service、remote protocol schema、remote provider、LLM adapter 或全局样式。若冻结接口与所需生命周期不一致，先交协调方与 Sol 修正 contract/实现，再继续 UI；不通过 UI 私造第二套协议。

## 实施顺序和兼容迁移

1. 前置审查：等待 Sol 修正有序迟到 task event 的 completed 呈现问题，并交付可从 main/preload 调用的候选 API/broker；协调方独立接受后才冻结 XRayApi、事件订阅、context enter/leave 及 task/status/result 语义。候选调用名不视为当前可用接口。queued cancellation 若保留，冻结 schema 必须保持无 SQL identity 的独立分支。先核对合同与 792602e 源码基线、6c18c20 及 3f58ddc 后续 doc-only 提交均一致。
2. App context shell：复用 Sol 候选中的同步 transition/revoke 入口，在候选接入主 checkout 并接受后只补 Explain enter 和 confirmed-context gate；覆盖 leave、项目/快照切换、重索引以及失败关闭。本地解释不改变。
3. controls 与 preview：接入 provider/auth state，key 输入短暂处理，按本地 snapshot 准备完整 preview；实现授权后 revision 变化需重新 preview 的交互。
4. task 与结果：加入单次 start、取消、后端终态、手动重试重新 preview、currentness 和精确 citation 导航。
5. 独立审查与技术验收顺序：实现后先运行适用代码/组件回归，再制作并检查可启动 IPC build artifact。真实 computer operation 是单独、后续的验收门槛；用户本轮明确暂不电脑操作，不得要求立即进行，也不得以 CLI、截图或静态检查代替真实 GUI 操作。此文档设计阶段不执行这些步骤。

UI 不增加 migration。GraphStore migration 10 是远程策略/任务/结果的已有持久化边界：旧库默认为未配置和 denied，重启不恢复或重发未完成网络任务，未完成任务可标记 interrupted。UI 不得从 React 缓存推导授权，不得把 preview 或模型原始 response 复制进旧解释表，也不得破坏现有 feature-explain API 的参数和返回 schema。数据库当前 role/migration 行为如有调整，由 Sol 后端交付和协调审查负责。

## 验收门槛与本阶段限制

| 门槛 | 必须取得的证据 | 本设计阶段 |
| --- | --- | --- |
| 代码/组件回归 | 本地 offline 查询仍可用；按 RemotePreview 字段展示实际 evidencePackage/snippets、unknowns/limitations 与静态预算上限；每项目 grant/revoke；grant 后重做 preview；显式 start 只一次；queued cancellation 独立分支；离页 revoke；迟到回复；新 context 不恢复旧 task/preview；结果 currentness 和引用导航；key 清空；无自动发送。 | 只列出设计要求；未运行或新增测试。 |
| 可运行 IPC 产物 | 最终接受的 XRayApi 经 contracts → preload → main/broker → worker → application → graph 闭合；启动的 Windows Electron 能进入未配置 UI 并使用本地路径；safe fixture 不访问真实 provider。仅展示后端 schema 实际提供的预算，不推断线上正文长度或账户额度。 | Sol 修正有序事件并完成 desktop bridge、合同独立接受前不可验证。 |
| 真实 computer operation | 协调审查方在真实 Electron 操作本地/offline、未配置、preview、取消、切页与返回路径。 | 独立后续门槛，本轮及当前阶段暂不电脑操作；不能用 CLI/截图/静态检查替代。 |
| 真实 provider 与质量 | 用户亲自录入自己的密钥、手动选择 provider/model 与每项目外发授权后，观察一次最小请求及 citation/质量边界。 | 当前没有本轮授权或凭据；本阶段不进行，真实远程兼容和质量仍未验证。 |

## 规则沉淀判断

本设计遵循现有证据、安全和协作规则，没有代码实验支持的新通用工程经验，因此建议本轮不修改 AGENTS.md。
