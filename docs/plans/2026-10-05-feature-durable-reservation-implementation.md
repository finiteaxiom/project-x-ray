# S3-B：feature 持久预占用与提交失败隔离

2026-10-05，协调方明确实施切片，限原第一/第二批共享传输前置，Windows。四批收尾暂停，不启动第五批。依据已接受的 [共享任务设计](2026-10-05-ownership-shared-task-design.md) 第3节 durable reserve；不是新产品能力。

## 目标与实际缺陷

实际 application/remote-explanation.ts 在同步 gate 中 registerDispatch → provider.dispatch → SQL COMMIT。协调方在冻结的5170真实应用及 SQLite 植入 deferred FK COMMIT 故障，首受控 provider Promise 保持 pending；首 start 返回 POLICY_INVALID、signal aborted、lease 行数0。撤掉故障并重新 prepare/start 后，第二任务 completed，峰值未结束 dispatch=2。仅本地受控端口，零真实 HTTP/凭据/用户项目外发；不宣称生产网络复现。

原始探针及准确边界见 [独立复现](../development-runs/2026-10-05-feature-durable-reservation-independent-review.md)。三相关生产源 main/5170 规范文本一致。main HEAD502820ad4e040eb4b1effa9845c2c2fe46e1274b；5170 HEAD455d4ad50830ee2495b70927e51caf830a4efbb8，全部旧WIP保留，以本轮实际字节副本为基线，不能按HEAD整份复制。

完成门：一次发送可能已发生时，即使注册事务 COMMIT 失败，另一 task 仍 BUSY，零第二 dispatch；abort 不是停止证明。正常 feature 链、精确身份/createdAt、旧成功历史/源码、跨库发布补偿保持。semantic 发送及统一参与者恢复仍未实现，不把本切片说成端到端远程完成。

## 路由与文件边界

派原开发-Sol GPT-6.1 Sol/medium，仅 D:\Projects\CodexWorktrees\5170\Project X-Ray。允许改：

- packages/graph/src/shared-remote-task-store.ts 及对应 .test.ts；
- packages/graph/src/remote-explanation-store.ts 及对应 .test.ts；
- packages/application/src/remote-explanation.ts 及对应 .test.ts；
- 自有 docs/development-runs/2026-10-05-feature-durable-reservation.md。

本轮实际核两目录没有 graph migration16，若需要版本化升级，**仅分配 global16** 用于 feature reserved 支持及精确触发器升级。保留原14迁移定义/已安装旧对象可验证性；先严格核旧schema与全部旧行，再原子升级至16。project不创建16或共享表；旧main11/Sol12/source15及其他迁移不动。不能仅重写14定义让旧库失配，也不能先 IF NOT EXISTS 修复坏库。

禁止 LLM/contracts/index/ownership/Q1/Q2/cache/analyzer/desktop/broker/IPC/UI/native/package/lock/AGENTS 改动。Luna仅main独立LLM正文，文件无冲突。若需扩大文件/契约、实际停止receipt/broker接线，先报告具体原因与已冻结边界给协调方，不能自行扩大。开发不Git，不读/改main。

## 选定行为

1. 真实凭据/工作区/实际body准备完成后，第一同步全门持原global→settings→source锁序，再核实际许可/provider/context/reference/配置及真实body绑定，并**独立提交**精确 registry + reserved lease。权限失败或reserve COMMIT失败，零dispatch。T1只在首次权威持久登记分配一次。
2. 第二同步 gate 再核所有原门/取消/时限/实际body与固定provider设置，使用同一个私有捕获身份、同一个reserved slot，原子提升registered/写dispatched；createdAt从registry读取T1，不能重造T2。dispatch latch在调用端口前置位，一次preview只消费一次。不能把caller DTO、hash、callback自报成功当当前性或发送许可。
3. 第二注册 COMMIT失败、同步dispatch抛出或返回异常时，端口可能已发起。保留第一提交的reserved lease及原始固定错误；不重发、不因abort释放、不把网络Promise尚未结束当已停止，不生成虚假dispatched事件/结果。即使Promise晚到、调用实例关闭或重开，也不能凭旧feature恢复入口清除该不确定slot。
4. 完全未调用dispatch的二次门拒绝/取消可在私有一次性零dispatch证明下写同身份terminal并精确释放。terminal提交/清理失败则保持slot；不能由外部布尔值清slot。无reserve的原preparing取消语义保留；reserve后的cancel时间必须T1。
5. 正常registered后的现有成功/失败、跨库append/finish/补偿及终态保留占用直至可信清理的规则保持。迟到/重复/错身份release不得删除新任务slot，completed历史不可改。现有direct内部SQL register兼容可保留，但没有外部通用reservation/semantic发送端口。
6. **本窄切片不实现统一停止参与者receipt。** 原feature-only recover遇任何feature reserved/不确定slot或非feature slot，在任何任务/context/lease写入前失败关闭，零写、保持slot。普通严格可验证registered feature恢复保留旧门。故障reserved的实际停止后恢复/可用性是后续具体生命周期切片未验边界，不能模拟已停止、后台自动清占用或以迁移替代停止证明。
7. 严格schema/identity/digest/时间/16KiB有限元数据核验，坏库固定脱敏错误，不存body/key/原始答案/源码；registry全历史UUID唯一，reserved promotion只能同task、同完整identity、同T1。global16迁移故障必须事务回滚且旧库字节语义/旧标识不被修复。

## 最小必要验证与冻结交付

用实际SQLite与真实应用受控provider端口（明确零HTTP）覆盖：两个连接互斥、reserve COMMIT失败零发送、注册COMMIT失败首Promise pending时第二BUSY且峰值1、抛错/非Promise不重试不提前放行、第二门授权/provider/context/config变更、reserve后零dispatch取消、T1晚promotion/时间回退、普通终态/迟到精确release、跨库发布/补偿失败原门、重开及旧recover拒reserved零写、14→16好坏库/迁移COMMIT失败/project无16/旧完成结果源码保持。

原提交故障回归保留首发一次/无task结果事件/不自动重试断言，增加durable slot断言；这是已接受设计明确变化，不能盲改金标或移除正确断言。运行六文件定向回归、graph/application noEmit及必要已有remote相关回归；不要并发重型或扩大测试到活动LLM切片。

交付须先冻结，给六源/测试与自有记录的实际hash、相对本轮字节副本的最小patch、全原文件不变清单、实际命令/失败诊断/修正/复跑及各未验门。root独立复跑原始缺陷、查真实差异再决定接受/集成/Git。AGENTS允许0，候选经验只写自有记录由root去重。GUI、真实API质量、统一停止恢复、semantic任务/HTTP、其他三批未验门保持。
