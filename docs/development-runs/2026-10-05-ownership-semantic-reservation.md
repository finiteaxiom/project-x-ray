# 2D-B1 可信语义持久预留

## 目标与边界

依据本轮 reservation implementation plan，实现真实索引、原题发行、确定性成绩与胶囊、实际编译 Q3 Responses adapter 到 global17 registry/reserved lease 的本地端到端链路。复用 project12/global17/source18，不新增迁移。HEAD 基线 `455d4ad50830ee2495b70927e51caf830a4efbb8`；开始前保存全部 353 个现有文件的 SHA256 和四个允许修改旧文件的完整原始字节。已有 WIP、R1 及其他批次均保留。

本轮只有 backend reservation；不接 IPC/UI、dispatched、provider、credential reader、HTTP、结果写入/发布、统一停止恢复或自动重发。测试执行真实索引/题目/评分/准备与 SQL；只操纵测试应用实际 main 状态以模拟变更，不声称真实 Electron 授权。没有构建、安装、native/Electron、凭据/敏感环境扫描、导入代码执行、主 checkout 操作或 Git 写入。

## 实现

- Preparation store 复用实际 Q3 完整正文校验，将内部临时 Q3 token 移入独立 WeakMap 并立即撤销旧 token；新 opaque preparation 无法进入旧 withRevisions/consume。新路径同步复核实际原题、成绩、胶囊和来源前像、main generation、实例映射、完整正文及 authority 元数据。保存的 capsule ignoreRevision 必须等于捕获的当前 settings revision，不能用相同规则 hash 或当前修订覆盖保存修订。
- 完整 A2 identity 只由 source 私有材料生成，task UUID 在锁内生成。GraphStore 以真正私有的 authority/settings/source database 连接委派；application 不组装 identity、不反射数据库、不跨包导入内部 A2。公开委派只接受严格五字段输入或本实例 opaque preparation/ticket，不接受正文、身份或成功校验回调。
- Ledger 在 global 外层 IMMEDIATE 中按 global → settings → source 加锁；拒绝任何预存外层事务，兼容同连接布局去重。不同库的只读事务保持到 global COMMIT/ROLLBACK 结束才用 ROLLBACK 释放，避免嵌套事务提前释放新鲜度锁。锁内调用既有 A2 reserve，前后复核实际材料，并检查全 registry/lease 身份、reserved stage、稳定 T1 与零 task。只有权威外层提交和附属锁释放都成功后才签发 opaque ticket 与 taskId/createdAt/reserved 元数据。
- 一次预留尝试无论在哪一步失败均撤销 preparation，需要手动新 prepare。全局 COMMIT 失败零注册/占用/任务/结果。若全局已提交但附属只读事务释放失败，则不返回票据，保留 durable 占用并报告固定错误；不能把该异常宣称回滚成功，也不能自动清除或重发。
- 仅封闭零 dispatch 的 reserved ticket 可执行 terminalReserved(CANCELLED) + 精确 release，二者与 global COMMIT 共处实际外层事务；任一失败保留原 ticket 和 durable reserved 占用。关闭只撤销内存能力，保留持久占用。普通、重复、克隆、跨应用/连接实例和关闭后的票据均不可消费。

## 失败、诊断与修正

1. 首次 graph/application noEmit 暴露 `never` 控制流推导与 exactOptionalPropertyTypes：明确失败函数返回 `never`，已消费字段用 delete。后续 graph declaration 检查发现 public 方法推导携带内部 unique symbol；明确导出的 opaque 返回类型修正。属于本轮实现类型缺陷。
2. 初次应用套件 65/66：feature 竞争夹具遗漏 A2/shared 的必需 T1，导致 POLICY_INVALID；补实际时间参数。测试缺陷，未改生产契约或阈值。
3. 新 graph 套件首次 4/6：默认未配置端口实际先返回 NOT_CONFIGURED，且 project-role 本来没有 global registry 表；修正夹具预期，仍要求拒绝且零写。测试缺陷，未放宽安全门。
4. 新路径早期使用嵌套 transaction callback，代码复核确认 settings/source 会在权威 COMMIT 前释放；这是本轮实现锁生命周期缺陷，非已发布产品故障。改成显式持有不同库的只读事务，加入实际 global 提交已对第二连接可见而 source/settings 仍 inTransaction、第二连接 BEGIN IMMEDIATE 仍 BUSY 的断言。附属 ROLLBACK 故障回归分别验证 global COMMIT 失败时保留原错误、已提交时保留占用且不返回票据。无环境故障归因。

早期新增套件 89/89，早期 14 文件综合回归 579/579；这两次均先于最终锁生命周期和补充故障断言，不能代替最终验收。

## 实际最终验证

最终综合回归：14 文件、582/582 通过，exit 0，153.31 秒；其中新 reservation 应用 82、内部 ledger 6，原 Q3 store 增量边界 1，graph index 增量生命周期 1。四包最终 noEmit 均 exit 0。最终源码已包含持锁至 global COMMIT 及附属释放故障断言，不以早期结果替代。

```powershell
.\node_modules\.bin\vitest.CMD run packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\tsc.CMD --noEmit -p packages/graph/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/application/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/contracts/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

四包最终 noEmit 已通过。回归覆盖双布局 × 四题型 × 空/非空规则、五字段恶意输入与异步替换、完整正文改动、拒绝权限、真实第二连接变更/锁竞争、同长源码变化、main A→B→A、写后复核、INSERT/IGNORE/合法错误 identity、global COMMIT、外层事务、取消 abort/ignore/commit、跨实例/重复/close、旧 Q3 一次同步门与 R1 历史。测试假设/原始数据库反射及内部 A2 构造只存在测试夹具，不进入生产委派。

## 冻结、未验与规则判断

最终 patch 使用本任务 before 原始字节生成，不对 Git HEAD 差异作整体交付；独立重构每个 hunk 的结果并核对精确字节。manifest 包含 before/after、旧允许文件 before/after hash、新文件 hash、全部未变清单及结果。旧 353 文件只有明确允许的四文件修改，其余 349 字节 hash 不变；新增五文件，after 共 358。AGENTS 和 R1 交付三个新文件均不变。不得把旧 349 文件基线或 R1 旧 freeze 覆盖为本轮基线。

未执行真实 Electron/worker/provider/HTTP、dispatch/结果 publish、统一 stop/recovery、主 checkout 集成、commit/push/merge 或公开发布。关闭/重开保持 reserved 占用的行为是已验证边界，不能宣称完整恢复可用。root 仍需独立复验实际待集成差异与适用回归，随后协调 Git。

本轮无新增 AGENTS 规则：跨库配置锁须持到发布结束已被现有配置修订经验覆盖；实际 COMMIT、opaque 能力及异常保留占用要求在当前任务/既有事务与安全规则内。锁生命周期修正的具体复现断言保存在本记录和本轮测试，避免重复增加公共规则。
