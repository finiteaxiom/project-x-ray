# S3-C/R 共享恢复完整性窄修（原 Sol 已恢复实施）

仅原四批内第一/第二批共享恢复 core；不是第五批。协调方已确认两个真实 SQLite 反例。2026-10-07 用户恢复完整访问后，任务已成功送达原 Sol 聊天并进入实施；下文权限失败是历史记录，不代表当前阻碍。

## 开发边界

仍使用原开发-Sol（GPT-6.1 Sol / medium），仅 5170 worktree。允许修改 `packages/graph/src/remote-task-recovery-store.ts`、对应测试及自己的 core 开发记录。其余冻结源、已有迁移定义、旧正确断言、生产 broker、desktop/UI/HTTP 保持。需要超出边界时先给具体源码/契约依据，由协调方处理。开发不进行 Git 收尾或电脑操作。

## 原始复现

协调方脚本 `.benchmarks/b1-independent/c-core-recovery-probe.ts` 复制此前自建且真实索引的数据库，只对副本运行当前 Sol GraphStore/global19/SharedRemoteTaskStore。没有执行被索引的代码，没有模型调用；普通 split completed 对照保留目标结果、原源码及占用释放行为。

1. split completed feature 的来源库真实 COMMIT 后、再次 BEGIN IMMEDIATE 前，以另一真实 GraphStore 连接删除当前 task 的 `remote_explanations`。故障注入只在实际 `db.exec` 的确定切点插入第二连接写入；COMMIT、恢复 SQL 和结果校验均运行原实现。恢复仍成功并释放 lease，权威 task 仍 completed，实际 result 已不存在。
2. legacy 同库，绑定材料后安装实际 `AFTER UPDATE ON explanation_contexts` 触发器，对 `source_snapshots.content` 追加空格。恢复关闭旧 context 时触发，最终仍成功并释放 lease，历史源码发生改变。正常对照没有此变化。

## 修复和验收门

- 已完成 feature 的完整原目标结果须在来源库提交并重新取得锁后再次核验；不能只检查其他 task 历史或 semantic candidate。缺失、身份/时间/合法 payload 改变均失败关闭，completed/T1 不重写，lease 保留。第二连接已提交的破坏不能冒称被回滚修复。
- 在最终关闭 context、精确 release 之后，当前事务提交前核验源码、已保存答题/成绩、成功结果及其他受保护历史与预期。副作用必须固定拒绝，回滚本事务并保留占用；补偿仅允许精确本次未发布结果行。覆盖真实有数据的历史，不用空表证明保持。
- 先复现失败测试，再最小修正，再原适用回归/四包严格类型和原协调探针。不得移除正确断言、放宽 schema、安全 reader 或降低类型检查来变绿。
- 保留实际 source commit/global commit 分离语义、一次 permit、全部 native generation/异步操作结算、未知执行/来源保守占用、原 feature-only recovery 拒绝 semantic 等边界。
- 更新自有记录，交付 before/after manifest、准确 patch/hash、精确变化/保持范围、实际命令和未验项。协调方重新独立验收后才决定集成/Git。

## 本轮环境限制

协调方 fresh 索引在主目录和 Sol 均失败于实际 native reader 的 `ERR_SECURE_READ` / 固定错误 `Unable to resolve project root handle path`。故障探针采用历史真实索引副本，只证明本轮当前恢复事务的反例，不能替代 fresh 索引端到端通过。

本轮原 19 文件回归 788 项：386 通过、402 失败，8 文件失败、11 通过；原生资源域单文件另跑 15/15。类型检查四包原命令均失败，解析日志显示 Vitest 声明的依赖未解析，主目录已有测试同类失败。环境完整根因未确认，不能按开发历史报告写为本轮通过。

当前派发工具和定时更新工具均被 `approval policy is never` 拒绝；Sol 空闲，定时文件仍 ACTIVE。后续先确认实际权限可用再将本具体任务送达；没有授权缺口，不需要再次规划准备任务或新聊天。

## 用户要求继续后的候选成果

协调方在main自有ignored目录完成单文件候选，两用途/两布局及真实故障41事务场景、15故障后人工重试、单文件strict类型与原Sol apply --check通过。详见[候选记录](../development-runs/2026-10-07-shared-recovery-integrity-candidate.md)。原Sol冻结源和main生产源均未更改、未正式集成；完整回归/原四包类型和GUI未验收边界保持。派发再次实际被策略拒绝，不能称开发聊天已开始；后续应直接审查该具体候选及必要回归，不再从零造准备任务。

## 2026-10-07：完整访问恢复、原 Sol 窄修实际派发

用户明确已给最高权限后，send_message_to_thread成功送达原开发-Sol/gpt-6.1-sol/medium/5170，仅共享恢复source/test及自有core记录。初次回合01a1162f-85ae-7152-af94-b1cc8c817be7已实际运行；后续当前回合01a11632-a2d4-7752-bc7f-0911f18940ba为active/inProgress、error null，最近实际cursor3e8b4e0b-700b-4971-8c8b-5a686d4d43df:4。Sol已重算原373/373冻结字节一致，保留455d4ad基线与原WIP；正在将COMMIT窗口和context/release反例接入fresh索引、真实答题和明确保存的非空兼容成绩回归。Luna原切片仍冻结，不制造并发冲突任务。

root当前在main运行原tsx的c-core-native-check，两目录createSecureReadScope/readSecureProjectFile均read-ok；原tsc --noEmit -p packages/{contracts,graph,application,llm}/tsconfig.json四命令分别exit0。历史restricted环境HANDLE/声明解析失败保持为真实旧结果，当前窄环境门已恢复。main baseline类型通过不等于Sol修复已通过正式19文件回归，亦非新的GUI、HTTP或全链验收；root不并发运行Sol正在修改的graph文件，未开重型build/native窗口。

原候选41事务门及15故障人工重试是审查依据，仍须正式fresh回归和root稳定交付独立复验。没有main生产集成/提交/推送、没有电脑操作或真实远程；定时保持ACTIVE，四批仍有可推进本地缺陷，不暂停或启动第五批。本轮AGENTS无新增，已有SQL写后完整预期和触发器回滚规则覆盖。