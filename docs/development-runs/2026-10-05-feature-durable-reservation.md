# S3-B feature durable reserve 与提交失败隔离

2026-10-05，开发-Sol，5170 checkout，仅原四批内 [S3-B 派发](../plans/2026-10-05-feature-durable-reservation-implementation.md)。计划 SHA256 为 `8F425EE22C3FD6EEE41825FD993D57AE4A67BF7D9A9A1BD15C2912DDEAFF73AC`。root 提供的实际 336 文件基线开始时逐一 hash 相同；没有用 HEAD 替代已有 WIP。未操作 Git、其他 checkout、GUI、网络或 OS 凭据。

## 原缺陷与实现

root 已用真实应用和 deferred FK 复现：注册事务内 dispatch 已启动，随后 COMMIT 失败，首 Promise pending 且 abort=true，但 slot 回滚消失，第二任务可完成，峰值 pending dispatch 为 2。该复现为本地受控 provider，不是实际 HTTP。

本轮保留原 feature 身份、权限和全锁序，在实际凭据及工作区/body 准备后做两次同步 gate：

1. global→settings→source 全门中重核许可/provider/context/reference/config 和实际完整 body 绑定，提交 registry + reserved slot；此时才分配唯一 T1，无 dispatch。
2. 第二全门再次重核原设置、body、材料、取消和时限，使用同实例私有 reservation 与 SQL 中同身份/T1 提升 registered，调用前设置私有 attempt latch，再一次 dispatch。事务回滚不回退内存 latch。

第二次 COMMIT 失败、同步抛错或非 Promise 返回时，保留第一提交的 reserved slot，abort 不当作已停止，不生成 dispatched/result 事件，不重试。完全零 dispatch 的二次门拒绝或取消才由私有 receipt 清理同身份 slot；清理提交/删除失败保留 slot 和原固定错误。reserve 前的 preparing 取消保持原语义，reserve 后取消使用 SQL T1。

普通 registered 的完成、失败、精确 release、跨库发布/补偿和历史读取保持原门。旧 feature recovery 在任何写入前核状态，遇 reserved 或非 feature slot 失败关闭；重开、Promise 晚到不自动清占用。没有实现统一停止参与者 receipt 或不确定占用的停止后恢复。

## 迁移边界

仅 global16：保留原14对象定义，先严格核实际安装14的 schema 和全部共享 registry/task/lease 行，再在同事务升级四个精确触发器、写16。已经安装16仍严格核实际对象及行。坏旧 schema/摘要/时间不修复，deferred COMMIT 失败恢复旧14对象、marker 和历史行。project 不安装16或共享表，原其他迁移未修改。有限 metadata 仍为16KiB，不保存 body、key、答案或源码。

## 反馈闭环

- 首次实现后原三组回归 103 项通过；这些旧测试没有检验回滚后的 durable slot，不能作为原缺陷的接受证据。本轮保留原 COMMIT 故障用例的一次调用、abort、无 task/result/event 和无重试断言，仅增加 reserved 占用断言。
- 新增十项专项初次五过五失败。根因确认为测试时点错误：gate spy 包含 prepare 阶段，所谓第二门注入实际发生在 reserve 前。先完成真实 preview 再计 start gate，五项针对性全部通过；没有放宽拒绝或占用断言。
- 旧14迁移专项初次六过一失败。错误摘要夹具使用非64字符，SQLite CHECK 在目标核验前拦截，属于测试缺陷。改用64字符但内容错误的摘要，真正安装旧14核验固定拒绝、零升级。
- 三修改测试组扩展至124项通过；增加 body 改变、零dispatch cleanup失败保留原错误及真实索引应用两布局探针后，最终六文件221项全部通过。测试仅在自有目录/SQL夹具及受控 provider 注入，不执行导入项目代码。
- 中途额度中断时只有四个授权文件的部分实现；继续时重新核336基线，仅四文件变化，保留当前实现而非重置。中断不算交付。最终补齐另两graph测试、记录和冻结。

## 实际最终验证

以下命令各退出0：六文件221项，graph/application noEmit。实现此后未改变。

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/index.test.ts packages/contracts/src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
```

覆盖两个真实连接互斥；reserve COMMIT 失败零 dispatch；promotion COMMIT 失败首 Promise pending 时第二 BUSY、峰值1；晚到和重开仍保留slot；抛错/非Promise不重试；第二门许可/provider/context/ignore/body改变；零dispatch取消的T1；cleanup删除/提交失败保留原错误；私有receipt跨实例/clone/重放拒绝；T1晚promotion及时间回退；旧registered终态/错身份/迟到release；原跨库结果、补偿失败；reserved/semantic恢复零写拒绝；安装14正常/坏库升级和16 COMMIT回滚；project无16、旧结果及源码保持。另两项直接用真实 XRayApplication、真实 TS 索引和工作区检查，实际SQL注入 promotion COMMIT失败，两布局均第二BUSY且峰值1；零HTTP。

## 冻结和限制

相对同一336字节基线仅六个授权源码/测试改变，其他330原文件 hash 不变；新增本记录。精确 patch 从六个实际原字节副本生成，完整前后manifest独立交付；旧WIP、Q1/Q2、LLM/contracts/barrel、cache/desktop/broker/IPC/UI/native、包锁、AGENTS和其他记录不变。没有新依赖、Git动作、重型构建或第五批。

本次只修正 feature durable reserve 前置。未验证真实 API/GUI/质量、semantic HTTP/task/发布、统一参与者停止receipt、故障 reserved 停止后恢复或可用性；占用保持直到后续受授权生命周期切片，不伪造恢复成功。自测和此记录不替代 root 独立原始探针、差异检查及接受/Git。

AGENTS新增/修订0，规则文件冻结。候选经验仅供root去重：可能发起外部副作用前，先独立提交精确 durable reservation；随后提交失败或 abort 不能充当副作用停止证明。该候选有两布局真实SQL/受控provider证据，尚未写入公共规则。
