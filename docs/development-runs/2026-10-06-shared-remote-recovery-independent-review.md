# 共享停止与恢复：协调方独立审查

2026-10-06，原第一/第二批 S3-C/R 必要接线。未启动第五批；当前不进行电脑操作、真实 GUI、HTTP、凭据或重型构建。

## 方案冻结与实际核对

原 Sol 回合 `01a11136-d37c-7190-850b-2dc54273f1d0` completed/idle。root 核 `xray-shared-recovery-design-delivery-aa3a7ae71d3a46b5839e19484c56a55e/manifest.json` SHA256 `1ACEE4B1C78935BA430239AAC7F6F28B7504F24CE394327B77D47D0A0BB34492`，全部旧364与两新文件逐项重算，366/366匹配，旧源/测试/AGENTS保持。两文档交付不等于实现接受，尚未复制进main。

实际 source 审查确认 broker 只跟踪自己的 feature worker/issued；旧 recoverInterrupted 先 assertFeatureRecovery，semantic/reserved占用拒绝；B2 close不清持久lease，重开补偿须实际R1 readCandidate重新签发本实例私有候选及精确权威终态。没有扩大旧feature-only恢复门。

## 两处方案问题及实际复现

1. 新方案把原生Worker校验放graph，与已接受shared-task-design第6节“graph只接可信opaque receipt，不访问Worker/Electron”冲突。派发要求原生资源与操作结算留在application可信构造闭包，graph只持会话/authority/数据库前像和一次权限，禁止反向依赖与caller布尔停止证明。现有B2不因本问题另做重构。
2. 方案称reserved feature可直接 `promoteFeature(interrupted,1)`，实际migration17 lease提升守卫要求feature dispatched。root执行 `tsx .benchmarks/b1-independent/recovery-plan-probe.ts` exit0（此退出表示反例断言通过），真实SQLite reserve独立提交后promotion抛 `XRAY_SHARED_INVALID`，registry/lease/task零写，lease仍reserved。没有模型替身或执行导入项目。不能为恢复插入假dispatched，不能用inflight0提前释放。正式分配global19作为必要窄桥接；全库rg未发现已有19。旧14/16/17/18定义保持，若开发以现有合法路径实现则须真实SQLite证明无需19。

## 实际实施派发及未验收边界

原Sol `gpt-6.1-sol` / medium，唯一目录5170，send_message_to_thread成功；timeout0确认回合 `01a1113f-1728-7ac3-a93b-6b998bbb6398` active/inProgress、error null，cursor `4ec5deb2-4b44-492c-86f0-dfe5a9c1aa25:12`。明确允许新application生命周期/能力与graph恢复模块、graph index/shared最小capture/19桥接及测试；旧R1 test只允许global迁移列表增加19，不混main11/Sol12。两设计文档仅纠错，自有core开发记录。其余源/测试/desktop/UI/公开契约冻结。Luna保持冻结，不派冲突或填槽任务。

交付须覆盖两purpose、全部退休generation、实际native退出与异步操作结算、私有一次能力、真实索引/原题/成绩/Q3/B2材料、已知实际source/R1补偿、两布局与两连接故障、completed历史保留/旧cap不能释放新slot、跨库实际提交阶段及人工安全重试。旧feature-only恢复零写保护保留。未知source/坏材料/停止不明继续保留lease；无旧执行域退出证明的重开不得靠空inventory清理。当前生产B2/旧broker尚未统一，内部core通过也不能称生产或GUI完成。

本轮仅方案源码审查与上述真实SQLite反例，未跑实现回归/类型/构建/GUI/HTTP；未集成方案或提交推送。AGENTS新增/修订0：方案错误纠正不作为新通用经验，现有停止、数据库终态及真实介质规则已经覆盖。main HEAD仍 `9d9f19aafbdeed5a185ac04bee9af62bf4f1f2e4`，保留全部已有协调记录；后续root按冻结实现独立复验再Git收尾。

## 2026-10-07：冻结实现独立检查、两项数据完整性缺陷及权限阻碍

原 Sol core 回合 completed/idle；重启后实际 cursor 为 `3e8b4e0b-700b-4971-8c8b-5a686d4d43df:1`，Luna 为 `a39853cf-b92f-4006-b69c-77245be3dc0a:1`，均 idle。本轮已核 core 冻结 373 文件全部 hash 匹配；before366 中7变化/7新增/359保持。manifest SHA256 `F3DB6658DFFF554AA5BD3305F8CE7F37289C8741FC0FEB38611ACA76D13C5AFB`，patch SHA256 `030A5131DE8748A01781153049A25F46B17F24D9CF24D5741785AC99D4562269`。没有将 Sol 全部 WIP 复制到 main。

实际独立检查：

- 原 Vitest 19文件命令在模块导入前因临时缓存 rename EPERM 全部失败，零测试执行；没有称其通过。仅为该进程将 TEMP/TMP 指向 main 自有 ignored `.benchmarks/c-core-review-tmp` 后，原生能力测试15/15通过。未改变 Windows 安全设置、source fixture 或产品 reader。
- 同目录原19文件命令完整退出1：788项中386通过/402失败，8文件失败/11通过，34.49秒。fresh indexing 在 `createSecureReadScope` 失败。额外 root `tsx .benchmarks/b1-independent/c-core-native-check.ts` 对自建普通目录/文件，在main和Sol均 `ERR_SECURE_READ`，固定错误 `Unable to resolve project root handle path`。证明共有安全读取阻碍，未宣称每一失败都已完整归因或改写通过。
- 四包原 `tsc --noEmit -p packages/<包>/tsconfig.json` 均 exit2：graph含旧测试错误，application178诊断、contracts18、llm17；main graph旧测试亦出现72诊断。`--traceResolution` 实际把 Vitest声明路径 realpath 留在junction入口，`@vitest/runner` 未解析；关闭skipLibCheck的诊断也显示既有依赖声明缺失。完整环境根因未确认，没有改配置/加any/安装依赖来消除错误。日志仅留自有 ignored 目录。

root 当前实际恢复探针 `tsx .benchmarks/b1-independent/c-core-recovery-probe.ts` exit0，表示四个场景运行并收集收据，不表示全部验收成功。材料来自此前自建真实索引 SQLite 的副本，当前真实 GraphStore/global19/SharedRemoteTaskStore、严格feature identity/result均执行，不运行导入源码、不替换生产SQL或发送HTTP。收据留自有 `recovery-CladTN/receipt.json`。普通 split completed 对照返回 released=true、lease0，完整result/source保持。确认两项产品缺陷：

1. source实际COMMIT与重新BEGIN之间，另一真实GraphStore连接删除本completed feature结果。恢复仍成功/released=true/lease0，task仍completed，result已null。源码重新锁定后仅复验semantic candidate，未复验completed feature完整目标。应拒绝并保留lease及原completed/T1；外部已提交删除不能伪称被本事务回滚。
2. legacy同global/source库关闭context时，实际AFTER UPDATE触发器向source_snapshots.content追加空格。恢复仍成功/released=true/lease0，历史源码改变。material复验发生在context更新之前，最后shared capture不覆盖源码，缺少最终提交门。应在最终context/release动作后复验受保护材料，失败回滚当前事务及占用。另一个删除mastery探针因样例该表为空，不能证明成绩保护缺陷，也没有据此新增结论。

已形成具体窄修 [任务范围](../plans/2026-10-07-shared-recovery-integrity-fix.md)。原Sol派发调用实际返回 `MCP tool call requires approval, but approval policy is never`；紧接timeout0核Sol仍idle、无新回合，任务未送达。用户已有派发授权，此为当前会话权限阻碍。未尝试绕过、替换聊天或改Sol只读目录。当前main源未集成core、Git元数据只读，未提交/推送。

由于派发及验收受当前权限/环境阻碍，按不无限等待要求尝试工具暂停project-x-ray，保留原prompt/name/15分钟/target；同一权限错误拒绝。文件回读仍ACTIVE，不能报告已暂停。后续不重复相同失败派发/暂停或整组失败测试；需实际环境变化后继续本窄修，定时状态须如实核对。

四批未完成。该core已实现但独立验收未通过；生产旧broker/B2统一、重开实际退出证明、main/desktop/UI接线仍未验。真实GUI0、真实HTTP0，第三批冻结缓存/性能收益与第四批reader/发布、签名/干净环境等原门保持。没有重型build/native/dist/Electron或新产品扩展。本轮AGENTS新增0：当前SQL写后完整预期/事务回滚规则已经覆盖这类缺陷，未修复闭环前不新增重复经验。

本轮执行的原组合命令（工作目录Sol；第二次仅本进程TEMP/TMP指向main自有目录）：

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts packages/application/src/remote-recovery-capability.test.ts packages/graph/src/remote-task-recovery-store.test.ts packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

单文件原生域使用同一Vitest参数，仅保留 `packages/application/src/remote-recovery-capability.test.ts`。四包类型命令如上逐包noEmit；主目录两root探针实际通过tsx.CMD启动，未运行build产物替代当前源码。Git diff --check exit0，现有协调记录与用户WIP保持，当前新增只有独立记录/待派发范围以及ignored探针材料。
