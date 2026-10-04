# 2D-S2：独立语义授权持久化

日期：2026-10-05。仅原第二批，复杂数据库任务交原 Sol，5170 checkout；四批后暂停，不第五批。

## 目标、源码依据与依赖

ADR0008 要求独立 repository/provider/purpose/disclosure 授权。当前 `remote-explanation-store.ts` 只维护按 repository 的 feature 表；已接受 2D-L1 严格 DTO 只检验结构，不保存选择。2D-S1 的历史材料不提供发送许可。本切片实现可信 application/main 未来使用的同步内部 SQL 端口，不接生产 UI、IPC 或网络。

优先级：第二批政策前置。依赖已验 2D-L1 契约（main 9edaea93128b06da60411096f91fd5d349313ff3）；协调方精确复制新 policy/test 与单 export 到 Sol，不整体覆盖 contracts index。既有 provider revision 取实际 global 同连接设置；不接受调用方提供的 provider 状态。

## 文件与迁移边界

- 新 `packages/graph/src/ownership-semantic-policy-store.ts` 与对应 test。
- `packages/graph/src/index.ts` 仅新内部 store 生命周期及 load/grant/revoke 三个窄方法，类型导入；保存其原 cache 等差异。
- 必要 `packages/graph/src/index.test.ts` 只增加 global 专属迁移的明确预期/隔离回归，不改 project 既有 12 或 main 后续集成的 11 断言。
- 自己新 `docs/development-runs/2026-10-05-ownership-semantic-policy-store.md`。
- 迁移号 13 分配本切片的 global 专属表；实际已有 10 remote、11 capsule、Sol 12 parse-cache。project 不创建政策表或冒记 13，稀疏角色迁移合法。升级幂等，不改历史行/源码，不占用或移动 12。
- 不改 remote store、contracts 原契约、application、LLM、desktop/UI、native/cache/loan/包/锁文件或 AGENTS；不 Git、重型 build/native/Electron、网络/凭据扫描。

## 必须保持的行为

表 `ownership_semantic_authorizations` 用完整 repository/provider/purpose/disclosure 复合键，payload 与可查询列一致且严格验证。限额、角色、关闭/损坏、SQL失败使用固定安全错误，不能把坏记录改成默认拒绝。记录不存在返回初始 denied revision0/null时间、零写；旧 feature grant 绝不推导或复制语义 grant。

内部 load/grant/revoke 方法只操作新表。grant 输入为已验新 strict command：同一个同步 IMMEDIATE 事务核实际旧 revision、实际 provider revision及六类披露，递增自己的 revision 后写入；revokedAt null，grantedAt 可信本地时间。revoke 核自己的 expectedRevision，拒绝后清空类别；从未 grant 的 denied 保留两个 null，不制造不合法撤销时间。真实曾 grant 的撤销保持原 grant 时间并单调有效 revokedAt；不能靠改变历史 grant 时间修正时钟，时钟回退须失败关闭。安全整数上限拒绝，冲突/失败全回滚。不能默认补字段、接受旧 feature command 或 persist 任意调用方 record。

合法写入是内部存储执行能力，不证明用户真实点击；公开应用仍未连接，协调方不代用户改实际隐私设置。本切片测试只用独立自有数据库，不生产授权。不得新增 dispatch/lease/task许可或认为 grant 可以立刻发送；共享占用、任务取消/撤销反应、provider更新跨用途失效由后续有边界切片实施。

## 完成门槛

真实 SQLite 测试覆盖 initial denied 零写、grant/revoke/regrant 与持久重开、旧 feature 授权/任务/provider/历史源码完全不变、各项目隔离、不同用途版本键不混读、严格输入/数据库列payload错配/损坏拒绝、两连接 stale revision/provider revision、BUSY/回滚/安全重试、时钟回退及 revision overflow、project角色零表/零写、关闭拒绝。拒绝路径无敏感值回显；无网络/导入项目代码执行。

运行适用新测试、remote-explanation-store/index/capsule-store 原回归与 graph noEmit。先核真实基线、保留旧 WIP、为会改的旧文件做原字节副本；冻结后报告精确差异/hash/命令、测试失败分类及 AGENTS 0 条判断。协调方独立复验并精确集成前，不称政策任务整链/模型/GUI或第二批完成。
