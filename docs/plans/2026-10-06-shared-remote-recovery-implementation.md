# S3-C 共享远程任务停止与恢复：具体实施方案

2026-10-06。原四批内 S3-C 的必需前置，当前仅方案交付；实施须协调方审查并派发精确文件。沿用已接受的 [共享任务设计](2026-10-05-ownership-shared-task-design.md) 第6节，不重做 A1/A2/B1/B2，不增加产品能力或其他操作系统。

## 现状与本轮边界

本地 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，保留旧 WIP；协调方报告 main 已集成 B2 为 `9d9f19aafbdeed5a185ac04bee9af62bf4f1f2e4`，此报告不是本地 HEAD 或本轮验证。before364 清单 SHA256 `AF620EDC37248C664B8A278BFD55842D622CE2D259E95AA10930F9F1DAE153E6`。本轮只新增本方案和自身开发记录，全部源码、测试、AGENTS、已有设计、迁移及契约保持。

实际源码锚点：

- `apps/desktop/src/explanation-broker.ts`：stopConfirmed（53–79）只跟踪一个 feature worker 与自己的 issued；session/startSession 登记 workerGeneration，retiring 只有单项；退出事件或 structural terminate Promise 目前被当成该私有端口的退出确认，最后调用旧 recoverInterrupted。不能把这个集合或普通 Promise 扩称为全用途证明。
- `packages/graph/src/remote-explanation-store.ts`：recoverInterrupted（268）先 assertFeatureRecovery 再 finish/release/关闭 context；shared-remote-task-store.ts 的 assertFeatureRecovery 同时拒 semantic 和 reserved 占用。该保护保留原样。
- `ownership-semantic-task-store.ts`：read/state 校验全共享状态；terminalReserved、finish、release 分工，首次 registry T1 进入 task，不重造身份。
- `ownership-semantic-result-store.ts`：readCandidate（176）重开后可经完整 L5、原题/胶囊/源码及实际语义验证重新签发本实例候选；compensate（201）仅接受本实例 WeakMap 候选，要求实际全身份/T1非成功权威终态，并重核精确行。close 撤销旧 issuer。不能靠数据库自洽摘要直接删行。
- B2 application 的 close 仅撤销内存能力和请求实际 Worker 终止；start/cancel 的 activeOperations/released 仅证明本任务人工重试安全。ledger.close 丢票据不清 lease，故不能使用旧票据恢复重开任务。
- `explanation-policy.ts` refresh/stores 会枚举 projectRoot；`XRayApplication.loadProjectStores/requireSnapshot` 已有真实 source/settings 实例与仓库/快照身份，但也有启动枚举及按路径新建 store 分支。恢复不得把这两个泛化函数直接当已批准的精确 locator。
- `main.ts` 由 startOwnedApplication 持有 effective userData 的单实例锁，创建实际 Node Worker；`startup-ownership.ts` 锁保留到退出。它提供互斥，不独自证明全部退休资源/异步写入已结束；空 inventory 不能据此自动清旧 lease。

## 选定最小下一切片 C-core（内部核心）

交付一个内部、离线可验证的路径：显式可信构造统一生命周期 → 登记两个 purpose 的真实 Node Worker、所有退休 generation 和写入操作 → 冻结全部入口 → 实际停止与结算 → 获得一次私有恢复能力 → 对已知真实 source 按精确任务恢复/补偿/释放。无 HTTP、凭据、Electron、renderer 或生产 factory 激活；不接既有 broker 以免半完成路径自动清占用。对重开且无法证明旧执行域已结束的情况，只验证 blocked，不发假启动证明。

以下是待批准实施范围，不是当前修改许可：

|文件|拟定最小修改/接口|
|---|---|
|新增 `packages/application/src/remote-task-lifecycle.ts` / `.test.ts`|唯一 provider 生命周期编排；拥有实际 Worker 创建、generation、活动操作及统一窗口预算，停止期间全门关闭；仅内部可信 factory，未入 XRayApplication/public barrel/IPC|
|新增 `packages/graph/src/remote-recovery-capability.ts` / `.test.ts`|私有 issuer/vault：authority 实例、session、冻结 inventory revision、实际 native Worker 引用、操作票据及被恢复任务前像；核原生状态和操作结算后签发一次 opaque permit。没有 issue(true)、stop callback 或普通 Promise 转证明端口|
|新增 `packages/graph/src/remote-task-recovery-store.ts` / `.test.ts`|实际同库 SQL/跨库编排：strict recovery capture → terminal → R1候选/feature结果精确补偿 → context 关闭及 release。区分 blocked 与精确已提交阶段，不持锁跨 await|
|`packages/graph/src/index.ts` / `.test.ts`|最少私有 delegation：持真实 shared/A2/R1 store；绑定 authority/lifecycle/source 能力、转交 R1 readCandidate/compensate；不允许 application 反射 database。GraphStore close 撤销恢复能力，保留持久占用|
|`packages/graph/src/shared-remote-task-store.ts` / `.test.ts`|strict recovery capture 返回真实 registry/lease/分用途 task 与完整 T1前像，必须 assertState；非缺省、损坏零写。必要 feature reserved 终态复用 promoteFeature(...,1)，保持 lease 到后续 release|
|本切片自身新 development-run|记录实际失败、修正、命令和冻结；其他文件未授权|

共6个新增源/测试、4个旧源/测试，加一份当次记录。不改 remote-explanation-store 的旧 recover、A2/R1/Q3/L5、原评分、package/body、共享契约、migration 14/16/17/18 或角色 project11/12。新 recovery store 在 graph 内部使用旧 feature finish/release/discard 与 A2 terminalReserved/finish/release、R1真实能力；不会新造 SQL 删除绕过它们。若严格封装检查证明必须扩窄 R1/A2/remote-store，先提交具体必要 hunk 给 root，不先实现。无新依赖或新迁移。

## 能力、inventory 与异步结算

统一 coordinator 为唯一可信构造根，不是第二个 broker 锁。数据库单 provider lease 仍是互斥权威。每个生产者记录 producerId、owner、generation、purposes（一个 worker 可覆盖两个）、实际 Worker、活动操作票据、gate epoch、退休状态；所有尚未确认结束的退休项保留，不能只保留最新 retiring。创建必须先获得关闭可控的 registration slot，再调用 owned factory；工厂抛错/异常返回或隐藏子资源无法证明时，把该 producer 标为 unknown，不能因为没有 Worker 引用就认为零资源。

C-core 的 native 验证由 vault 保存模块初始化捕获的真实 Worker getter/原生 terminate，而非公有 threadId 或 worker.emit('exit')。application 负责编排，graph 不依赖 Electron；vault 只校验绑定资源和一次权限，不调度 UI/provider。issuer/活动票据只交给可信 coordinator 闭包，不能从 renderer、普通 DTO、GraphStore读历史或公开API获得。注册必须在生产者可接受 start 前完成；普通 caller 不可提交“完整 inventory”数组供 seal 认可。测试的可信构造权限与生产入口隔离。

操作票据在 prepare、dispatch、响应验证、发布、补偿及取消/关闭异步工作启动前登记，finally 实际结算；迟到写入口还必须检查捕获 gate epoch。caller 返回普通 Promise 或 cancel/abort 完成不结算隐藏工作。停止过程：冻结新建/prepare/preview/start/事件/写门 → 固定 inventory revision 与 session UUID → 请求所有 native 资源停止 → 原生状态全部退出 → 同一清单全部操作票据结算 → 再次检查 revision 和 gate → seal。任何插入参与者、退休 generation遗漏、资源unknown、关闭失败或挂起操作都不能签发 permit。

permit 在私有 WeakMap 中绑定精确 authority、provider、session、inventory revision、完整旧 owner/context 和 registry/lease/task 前像；不可序列化、不可 clone/Proxy/换 authority。第一次 recover 即消费该 permit（失败也消费），活动恢复中的私有工作状态可继续同一精确阶段；再次人工恢复须重新冻结/核停止并签发新 permit。旧 session/close 后无效，不能清新 slot。初始化阶段禁止“空 participants = 旧进程已停”的快捷分支。

当前 B2 工厂不经该统一根，C-core 不宣称已覆盖它的生产执行。C-desktop 之前不启用混合用途生产发送；后续 B2 与 feature 生产构造必须由该根拥有并接入实际操作票据，移除各自启动时的全局恢复动作。保留 B2 正确单任务清理与 activeOperations 回归。

## 可信 source locator：明确两阶段来源

C-core 只接受可信应用持有的实际 `GraphStore` 实例绑定，不能接受 `(id)=>true`、任意成功回调或 renderer 文件路径。生命周期创建时由可信构造端注册已打开 settings/source，graph 校验 actual snapshot repositoryId/snapshotId、保存源码身份、角色以及 authority 关系，签发 SourceBinding。保存完整 source/settings 实例与原身份，重核不靠 activeReference 选最新库；legacy source 与独立 project settings 是不同实例，不能合并假设。恢复只按其捕获 task 寻对应 SourceBinding；缺失/两库同身份冲突/closed 则 blocked。

重开定位留给 C-desktop 的明确小增量，而非假恢复端口：新增 application 内部 `remote-recovery-source-locator.ts` / 测试，加 `application/index.ts` 最小只读 delegation，把 requireSnapshot 已验证的映射转换为绑定；constructor 接 main 已知 effective userData/固定 projectDatabaseRoot/legacy authority。只对 strict registry 的一个 repositoryId/snapshotId 检查两个候选：既有 global，及固定 app 项目根下该严格 ID 对应的既存 `.sqlite`。不得枚举未知数据库、创建缺失库或根据 snapshot.rootPath 打开新DB；不自动修改现有启动加载策略。

main 文件根身份由实际 app 配置及已打开 store持有，打开前/后检查目标仍为已知根内同一文件（junction/symlink或文件替换拒绝；既有安全文件句柄能力是否可用于 SQLite 路径须 root先核）。读 metadata 与角色、实际 repository/snapshot/source身份相符后才注册；两个候选歧义、缺原snapshot、设置库缺失、文件无法绑定或损坏一律 blocked。不把文件名或快照中的 rootPath 字符串当权威来源。此精确 locator 的Windows受限打开细节是 C-desktop 实施前需审查的必要依赖，尚无可复用的SQLite句柄桥接证明，不能写一个常量“locator verified”接口掩盖。

未知 locator 可关闭旧 context，但 lease不释放；在明确可信项目打开后仅绑定该源并人工重试 cleanup。只有每个必须检查的已知候选库均确认精确结果不存在，才能以“无结果”继续；缺 locator 不等同无结果。

## 精确持久状态与恢复顺序

|重开状态|权威处理|结果/占用|
|---|---|---|
|reserved、无 task|从 strict registry 保持 identity/T1；原子写 interrupted/inflight1，不补造 dispatched|可能已在 promotion COMMIT失败时执行，仍要全停止与定向结果检查；保留 lease|
|dispatched/inflight1|实际全身份/T1写 INTERRUPTED，completedAt不早于T1|迟到不能发布；lease保留至补偿完成|
|failed/cancelled/interrupted 且占用|不覆写原 phase/code/completedAt/T1|只清精确非成功结果，之后精确release|
|completed 且占用|不改成功 task/结果；核同身份/T1/completedAt完整发布闭合|成功历史永远保留；闭合不证明时不释放，不降级/删结果|
|terminal/inflight0，无 lease|恢复不重新创建占用或修改历史|旧 permit不能删新任务lease；不重发|
|损坏/registered无task/identity错配|strict state失败，零写|保留占用，固定POLICY_INVALID，不自动补齐|

每次先读完整共享状态，而非只挑合法一行。global terminal事务先提交，再处理精确已知source：semantic 用该真实R1实例 readCandidate异步验证，锁内重核capture/R1候选及authority非成功终态后 compensate；候选null须来自真实已验证源。feature用现有 discardFailedExplanation 的非成功权威/身份门。无需旧 ledger ticket，禁止绕过R1 issuer或重造模型输出。

R1当前readCandidate不依赖当前授权或 activation（历史语义与source材料仍需全验证）；配置/源码变化导致历史材料无法验证、旧题绑定缺失或候选损坏，则保留 lease，不用“已失败”作为删除授权。completed需完整验证同一published候选，失效不可读不等于可删。两库 source提交/global未完成窗口仍非原子；每一步记录实际提交，不声称 global rollback恢复已删除的source行。

source补偿提交后在global末事务再次核 session、全 inventory、原registry/task/T1、已核结果状态，关闭恢复捕获的全部旧context并 release精确当前lease；context若被非法更新/新owner出现，拒绝末事务。无 lease时仍须停止会写入的旧操作才能关闭旧contexts，不能因无 slot提前开放门。完成后默认 gate仍关闭；新窗口/context/预览由显式正常流程建立，恢复绝不 dispatch。

finish失败不补偿；source校验/DELETE/COMMIT失败不release；最后context/release/COMMIT失败保留尚未提交的lease。重试时使用新session重读实际阶段，原terminal及T1不变，已删候选读取null幂等，不删completed或他人结果。固定 primary错误保持，cleanup失败另报固定码/计数，不日志源码/路径/凭据。未知停止/SQL BUSY允许明确安全人工再试；不循环偷偷重发，也不凭重试次数清slot。

## C-desktop：后续精确集成门（本次不实施）

待 C-core 独立接受后，root批准下列文件：新 locator 源/测试；`application/index.ts` / `.test.ts` 的真实 stores桥接；`ownership-semantic-application.ts` / `.test.ts` 和 `remote-explanation.ts` / `.test.ts` 仅生命周期注册/操作scope；`explanation-broker.ts` / `.test.ts` 用同一coordinator替代局部recover；`explanation-worker-runtime.ts` / `.test.ts` 报受限generation/操作序列与关闭门；`explanation-policy.ts` / `.test.ts` 精确已知store绑定；`main.ts` 持同一个生命周期和真实Worker资源、startup-ownership.ts / `.test.ts` 若实际需要绑定启动证明。生产worker入口 `explanation-worker.ts` 仅可信构造接入，自己的receive仍校验现有协议。

不改preload/UI/共享公开契约/凭据/transport。如跨线程需新增控制消息，则先列新增私有control schema文件和预算、由root批准；不能塞宽松unknown进既有共享协议。这一依赖需在desktop派发前确定，C-core不创建未连接的假跨进程port。

资源清单必须覆盖当前实际feature Worker、semantic实际Worker及退休generation/父内子worker；跨线程main看不见的子worker须可信父生产者保证退出绑定，或改为统一根拥有的实际Worker，未经证明不启用。主进程单实例锁+Node内进程Worker归属的启动证明需Windows实际进程退出/重开实验验证；旧版本或未知子进程无法纳入时 blocked，无进程/凭据扫描。仅singleInstanceLock或worker自报“全部停了”不得签证明。

统一窗口只有一份 TaggedIssued<=20、pending<=20、每owner两用途合计1 preview/prepare；blocked/未释放项不得淘汰。退役资源inventory独立保存全部未结束generation，不能为预算抹掉；预算满在创建之前拒绝。purpose只路由身份与策略，不增第二provider lease或broker锁。owner/context/generation变更先关两用途入口与事件门，真实gate序列仍按权威identity/T1，不能补造dispatched。局部正常取消仅清自己任务，不运行全局恢复。

## 待执行验收矩阵

|门|必须独立观察|
|---|---|
|C1 native inventory|两个purpose/多个owner/连续退休generation；一个仍存活或一个未结算操作→零permit/零DB写，遗漏清单、伪exit、Boolean/Promise/可变getter拒绝；全真实退出且结算才可seal|
|C2 closed gates|停止过程中创建、prepare/start、迟到验证/发布/取消/事件；新generation插入使旧session拒绝，无新Worker/lease/结果，不能以重试替换session开门|
|C3 capability|clone/Proxy/换authority/错inventory/旧session/重复消费、close后；零写；SQL故障后新session只从实存状态安全再试|
|C4 state两布局|两purpose各reserved/dispatched/三非成功terminal/completed、占用/释放重开；全identity/T1/旧terminal不变；reserved不补dispatched；feature-only旧恢复遇semantic/reserved保持全事务零写|
|C5 real材料|真实索引/原题/原成绩/Q3/B2生成候选，在source已commit/global未complete切点重开；真实R1重新签发能力、精确删除；旧源码/成绩/mastery/题绑定不变，零执行/重发|
|C6 source定位|实际store绑定、legacy source/project settings、缺locator/歧义/坏库/closed/换文件/路径越界；未知源不枚举、不创建、不释放；trusted定向打开后仅补偿该identity|
|C7 faults两连接|BEGIN BUSY、terminal INSERT/UPDATE IGNORE或合法错前像、source DELETE/COMMIT、context/release/globalCOMMIT失败；主错误固定、各步真实提交明确、lease保持且可新session人工再试|
|C8 completed/旧能力|completed候选完整闭合才能release，历史source/result/task原字节保持；新slot后旧recover/候选/cancel不删新slot，不修改成功历史|
|C9 desktop后续|真实Windows single-instance启动/杀进程/Worker退出/旧generation重开；两用途窗口总20、事件owner/context门及源locator；真实Electron操作单独接受，不以core自编Worker冒充|

C-core命令：新三套文件加实际既有 shared/task/reservation/result/remote-store/index 与两 application/旧remote正确回归，vitest 单worker/no-file-parallelism/no-cache；graph/application/contracts/llm四包noEmit。确切文件列表和fixture矩阵在实施派发时冻结，不盲更快照。C-desktop还需broker/runtime/policy/startup测试与desktop noEmit，root单窗口构建及实际Electron操作。以上全部待执行，本轮不运行测试或构建，也不复用B2 697为本方案实验通过。

## 审查与规则结论

建议root先派 C-core 的上述明确10个源/测试文件加当次记录，审查其能力边界后再派精确locator与desktop；这均为原S3-C内前置。内部核心可证明自己可信构造的实际资源域安全恢复，不能证明当前main/旧broker已统一。生产发送须等C-desktop实际inventory、启动归属和locator证据齐备。无API key不阻碍内部核心实现，但真实HTTP/成本/隐私外发仍按独立授权门。

本轮AGENTS新增/修订0：设计审查不是新复现实验；现有精确终态、跨库失败保留占用及异步结算规则覆盖基本要求，能力/定位实施后再按代码与实验评估。

## C-core派发后的设计纠错（2026-10-06）

协调方审查要求修正两项：原生Worker持有、模块捕获、终止/退出核验和异步操作结算均放application私有生命周期/能力模块；graph仅存authority/session/完整状态前像和一次opaque权限，不访问Worker/Electron，不反向依赖application。此前表中graph/remote-recovery-capability的原生职责被撤回，实际改为application/remote-recovery-capability；其他原则不变。

协调方真实SQLite反例确认：reserved feature直接promoteFeature(interrupted,1)会被migration17的remote_lease_no_update拒绝，整事务零写；此前“可直接复用”假设错误。此次正式分配global19：保留旧14/16/17/18定义，19先严格验证旧17及全状态，窄允许同identity/T1/inflight1的reserved feature非成功终态提升并保留lease，禁止completed或重新激活。项目角色不安装19；真实SQL两连接及DDL/marker/COMMIT回滚回归随实现交付。本轮先保留before366全部原字节，实施只在明确派发范围，实际结果进入shared-remote-recovery-core记录。
