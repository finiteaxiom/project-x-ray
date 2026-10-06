# 2D-B2 当次语义执行与可信发布后台

## 目标、基线与恢复

这是原第二批 S3-B 的后台接线，依据本任务 publication implementation plan 及末节“恢复与政策事务窄范围补充”。补充计划 SHA256 为 `814A56880960461CD83D419380538652945FE096EB0A3E6B498D9312B4116A58`。B1 已由 root 独立接受并在主 checkout 集成 `66965f4308dfe8a254fb718a5ec2ba2e0b7362b6`；本开发 checkout HEAD 仍为 `455d4ad50830ee2495b70927e51caf830a4efbb8`，不重置或复制主 checkout。

before359 基线 SHA256 为 `79A30BF4E1C0CDFFF897BEEC900ECAD3761EEE686B3317221D06E426C982A8E5`。此前回合因 usage limit 中断，只留下 Q3 preparation 与 R1 result 两个授权源的 WIP，未冻结、交付或验收。恢复沿用该基线及八个授权旧文件原始字节，不把中断改写成成功。额外政策四文件另存原字节并核原359 hash；未覆盖旧 R1/B1 基线和 freeze。root 同步的新计划是明确记录的协调变更，排除在开发 patch 外。

## 实现和可信边界

- Q3 私有准备保存实际已验证 semantic package。takeReservation 只向内部 ledger 交付独立 continuation，保留实际完整 Responses/body/prepared 对象、原答题、workspace 异步检查和同步全材料重核；调用方不能提供 identity/body/capsule/授权或当前性成功回调。旧 Q3 once-only consume、旧 B1 未执行路径保留。
- 新 application 模块不进入 XRayApplication/barrel/IPC，没有默认 executor。可信构造端口只能同步返回真实 Node Worker；测试只执行自有语料脚本，索引项目源码从不执行。普通 Boolean、Promise、Proxy、同步工厂抛错都不能签发资源能力。异常返回的拒绝 Promise 被观察，不能造成未处理 rejection。
- B1 reserved 独立外层 COMMIT 保持。二次门先异步复验工作区，再按 global → settings → source 加锁并重核原私有材料、授权/provider/model/credential/context/ignore/activation/main。A2 promote 后、任何执行端口调用前设置不可回滚 attempted；源码、时间、SQL 回滚、同步抛错、promotion COMMIT 失败均不能恢复发送资格。首次 T1 来自 durable registry，不在 promotion 重造。
- 执行回复与资源结束分开。实际 LLM validatePreparedOwnershipSemanticResponse 使用同一个 WeakMap-bound prepared 对象，完整响应在第一 await 前捕获；graph 再以私有 package/原答题校验并用真实 L5 生成/核验 envelope。不能用 caller schema 或自洽 hash 代替真实语义校验。
- 发布在全门复核后调用 R1。不同库 source 先 COMMIT，再立即重新持有 source 锁、重核实际候选和原材料，最后 global completed COMMIT；同库布局共处一次权威提交。跨库非原子性仍存在，不宣称锁形成原子提交。成功返回/读都核权威同 purpose/task/完整 identity/T1/completedAt、两摘要及实际 envelope 前像，并经过原题/成绩/胶囊/源码/正文与当前权限门。裸 readCandidate 没有公开成功权限。
- 失败先实际提交精确非成功 terminal，再只补偿该次 opaque candidate。finish、补偿或释放任一步失败保留 lease 与原固定错误；completed 历史不删除。无法持有实际 worker 的工厂失败保留占用并返回固定失败，等待既定统一生命周期，不自动清理/重发。
- 释放需要同一私有 ticket/Worker、模块捕获的原生 threadId getter 确认 `-1`、实际 terminal，以及成功发布或已完成补偿。普通 exit 事件、可变公开 threadId、后来覆盖的 prototype getter、abort、timeout、响应完成或普通 Promise 都不能代替原生状态。并发 cancel/超时/策略轮询共享一次原生 terminate 请求。这里仅证明本批内部单个真实 Node Worker 退出，不证明 main/broker 参与者 inventory 或所有旧 generation 已停。
- close 只撤销内存能力并请求拥有 worker 结束，不 terminalize、补偿或 release；重开保留 durable 占用，不自动重发。迟到/取消/过期/关闭回复不能发布或重写原确定性成绩/mastery。

## 政策事务缺口与批准的补齐

实际 remote terminateMatching 只遍历 feature，S2 grant/revoke 原只写 policy。root 已核并批准窄范围：saveProvider 全 semantic dispatched、commitTrustedContext 同 owner dispatched、semantic grant/revoke 同 repository dispatched，同政策/context 写事务失效。saveAuthorization 仍只 feature；feature-only recover 的非 feature 保护不改。

新内部 invalidation helper 只使用旧 A2 strict read/finish，核实际全共享状态，保留 identity、T1、inflight 和 lease；reserved/completed/其他 terminal 与别 owner/repository 不变。不导出 barrel，不 release/compensate/恢复或创建执行许可。合法无17旧布局不假造 semantic；装17但缺表/坏状态失败关闭。

轮询只观察本次 opaque ticket 的持久终态并请求同 worker 停止，不能替代 future main/event gate。生产 semantic/provider/HTTP/OS 凭据、desktop/UI、统一启动与全参与者退出恢复仍未启用。

## 实现、失败诊断、修正与再验证

1. 类型检查发现 graph 故意不依赖 LLM 的 responseSchema 为 unknown，与 LLM 精确 schema 常量类型不同。application 保留同一个实际对象，只做类型收窄，运行时仍由真实 private WeakMap validator 认证；另修正 readonly 错误对象的代码选择。没有引入 graph→LLM 或跨包内部 SQL 生产依赖。属于本轮实现类型问题。
2. 第一条完整真实索引矩阵 16/16；旧政策/B1 三文件 133/133；新增政策故障用例初次 30/30。不能用这些早期局部结果代替最终综合验收。
3. 扩充新测试时多余括号导致 transform 失败，修正夹具语法后再跑；测试缺陷。
4. 首次 88 项扩充运行有 14 项失败及一个未处理 native 异常，根因有两类已确认夹具问题：把 task payload 中的 code 当成物理列，以及长期覆盖真实 worker.threadId 后仍让 Node 原生 exit/messaging 清理运行。改为 JSON 提取列；负向可变 getter 断言保持，但只在同步断言段覆盖并 finally 恢复，原生退出前恢复真实 runtime 状态。未提高 test/hook timeout 或删除拒绝断言。
5. 同一失败运行还实际出现 MaxListenersExceededWarning：轮询多次调用 terminate 叠加 exit listeners。属于本轮生命周期实现缺陷；改为每 slot 私有一次 stopping Promise。回归真实并发三次 cancel 与响应拒绝只请求一次 native terminate；不把该 Promise 单独作为 SQL 释放证明。
6. 修正后两个新套件 88/88；扩充等待点/当前性与故障后16文件680/680，再补异常工厂/timeout/BEGIN BUSY/并发停止与第二连接政策抢占后16文件686/686。最后将 native getter 在模块构造时捕获并增加后改 prototype 的负向断言，随后再执行完整组合；最终结果以以下记录为准。

## 实际验证

原冻结完整组合：16 个测试文件、686/686 通过，exit 0，耗时 174.51 秒；其中新 application 套件 70 项、新 invalidation 套件 31 项。该轮包含模块捕获原生 getter 后对 prototype 覆盖的负向断言，未出现未处理异常或 listener 警告。graph/application/contracts/llm 四包最终 noEmit 均 exit 0。

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\tsc.CMD --noEmit -p packages/graph/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/application/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/contracts/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

覆盖双布局×四题型×空/非空规则完整闭环；原题/成绩/mastery/源码不变；请求/票据实例边界，default executor 关闭；异步 workspace/执行/响应 validator 等待点；真实第二连接配置、provider/model/credential/context/S2 修订；同长 source、main A→B→A、迟到响应；promotion COMMIT 时真实 worker 未结束、第二用途 BUSY/零第二调用；source INSERT/IGNORE/合法改后重签候选/COMMIT，global completed COMMIT；finish/compensate/release 故障保留占用和不可读；Native worker end 负向验证；原生超时停止、并发取消与稳定 T1；close/reopen 零重发；成功历史在失效后保留。所有 SQL/DB 反射和内部 A2/shared 人工任务材料只用于测试故障与竞争，生产 application 不反射数据库或跨包导入内部 SQL。

## 冻结、限制与规则判断

交付从原 before359 和授权旧文件原始字节生成精确 patch，并逐 hunk 重构校验最终字节；manifest 保留 before/after、所有授权 changed/new hash、完整未变清单，以及 root 计划协调改动单列排除。旧 freeze 不覆盖，不依据混有旧 WIP 的 Git HEAD 整体 diff 交付。实际核对 before 359 文件：开发修改旧文件 9 个、新增 5 个，另有 1 个批准的 root 计划协调修改排除在 patch 外，349 个旧文件字节未变；after 364。全部 12 份授权原字节备份与 baseline hash 一致，patch 逐 hunk 重构与最终字节一致；未执行 git apply。

未运行 build/native/dist/Electron、真实 provider/HTTP、OS 凭据、生产模型质量、desktop/UI、main 入口/event gate、全 worker inventory/统一 stop/recovery 或公开发布。未操作主 checkout，未 commit/push/merge/reset/rebase；Git 收尾仍由 root 独立验收后协调。此后台与自有 worker 证明不代表完整产品 GUI/模型/恢复已验收。

本轮无新增 AGENTS 公共规则：跨库 completed 门、精确非成功补偿及 primary 错误保留已有规则覆盖；新单任务 Native Worker 约束已落实为接口注释和实际回归，其范围不足以替代尚未实施/验收的统一停止规则，保留在本记录。

## 独立复验退回：同实例安全失败后的人工重试

协调方独立检查原冻结 364 文件、349 旧文件保持、reverse patch、686 项测试和四包 noEmit 后，仍未接受整体交付。其真实索引、答题、Q3 与自有 native Worker 复现确认：双库与兼容同库中，取消或无效响应结束后 task 为精确非成功终态、inflight 0、lease/result 0、原源码/成绩不变，同 flow.prepare 却始终 BUSY。旧 686 项通过只证明既有断言，不证明该恢复行为正确。

根因确认：prepare 只允许 completed 的执行 slot 被替换；start catch/cancel 即使成功 terminalize、补偿、停止和 release，也保留 starting/reserved 且 completed=false。该问题属于产品生命周期缺陷。

先新增两布局×取消/无效响应/超时/政策失效八项同实例重试回归；修复前六项实际在新 prepare 报 BUSY，两个超时夹具因假计时器安装在既有 watch 定时器之后而超时。将超时夹具计时器安装移到 start 前，不提高阈值。修复后八项已执行到新任务成功，但新夹具误将 envelope.identity.taskId 写成顶层 taskId；按实际契约修正断言。新增停止夹具 TypeScript this 缺少注解，补 this: Worker 后四包类型检查通过。这些后两类属于测试缺陷，不混写为产品问题。

仅修改本批 application 模块、其测试及本开发记录；graph/A2/Q3/L5/R1/政策及其他工作冻结。slot 新增 released 和 activeOperations，失败不标 completed。released 只能由实际 graph release 调用返回成功后设置，而且仅允许 promotion 已正常 COMMIT 的执行；graph 原有精确 terminal、候选补偿和模块捕获原生 worker getter 的释放校验保持。start 与每次 cancel 均捕获自己的旧 slot，在 finally 结算活动计数。prepare 必须旧操作全结算，且成功 completed 或非成功已释放，才丢弃旧能力、生成新预览；从不自动创建/执行新任务。promotion COMMIT 失败即使显式停止与释放也不经本局部门恢复；无可信 worker、停止不明、finish/补偿/release 失败继续 BUSY。

新增 11 项：两布局各四条人工重试（新 task 身份/新预览、旧 task 完整行与 T1 不变，源码/原成绩/mastery 不变，旧票据最多一次）；两布局各一条取消已释放但旧异步语义验证仍等待时拒绝新 prepare，等待旧 catch 与并发 cancel 结算后才启新 slot，旧 start/cancel 不能破坏新任务；一条真实原生停止延迟时拒绝新 prepare。既有 promotion COMMIT、工厂异常、finish/补偿/release 故障增加新 prepare BUSY 断言，未移除旧正确断言。新增全 application 套件 81/81 通过后，按上方原 16 文件命令重新执行完整组合；修复后最终完整组合：16 个文件、697/697 通过，exit 0，耗时 158.82 秒（新 application 81 项，invalidation 保持 31 项）；graph/application/contracts/llm 四包最终 noEmit 均 exit 0。未出现未处理异常或 listener 警告。

原冻结 manifest/patch 及 before359 保留；新冻结将单列相对于原 after364 只改三个授权文件，并复核其余 361 文件字节一致、before359 中 349 未变。此次没有授权 Git、GUI、HTTP、凭据、desktop、公开 API 或统一恢复；未执行这些操作。本轮无新增 AGENTS 规则：活动异步操作需结算的同实例约束已在私有代码及竞争回归体现，公共规则仍由协调方在集成时评估。
