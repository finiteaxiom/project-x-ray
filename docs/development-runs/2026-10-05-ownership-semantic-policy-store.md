# 2D-S2 独立语义授权持久化

2026-10-05，开发-Sol，仅5170 checkout，原第二批。依据[批准计划](../plans/2026-10-05-ownership-semantic-policy-store.md)。基线 `codex/llm-explanations` / `455d4ad50830ee2495b70927e51caf830a4efbb8`；四批后暂停规划，不新增第五批。

## 基线、范围与精确交付

实施前核对批准计划及协调方复制的冻结2D-L1契约；不修改contracts。为两个已有文件保存原字节副本：

|文件（packages/graph/src/）|原SHA256|
|---|---|
|index.ts|2A2519F20653A140324707A86B3A78C077C7C73EF89366DD948A6474970AF512|
|index.test.ts|3CA2248832CA336EA4C138C6FC7020744CF3EFE5B20050822C64D65FC75F3F61|

本轮仅新增ownership-semantic-policy-store.ts、对应test和本记录，窄改index.ts生命周期/类型导入/三个委派方法及index.test.ts角色隔离测试，共五文件。index.ts相对原副本9插入/1删除，保留既有cache及2D-S1差异；旧测试断言保持。新角色测试核project没有13，不把Sol的12作为main集成前提。保留所有旧modified/untracked文件，不改remote store、contracts、application、desktop/UI、LLM、native、cache、loan、包/锁文件或AGENTS。

四个代码文件精确patch从原副本生成，不使用相对HEAD的旧WIP总diff；SHA256 `1D567155DA6700F5AD82FD916CC9F1A43D892520B1DCA71602E760BA02920F39`。`git apply --reverse --check <本轮patch>` exit0，仅校验，未apply。原字节副本与patch保存在自有临时交付目录；本文不记录私人绝对路径。没有Git写操作、重型build、native/Electron/PowerShell桥实验、网络、凭据扫描或生产隐私设置操作。

## 实现与边界

GraphStore新增同步内部load/grant/revoke语义授权方法，由私有store使用同一个真实global SQLite连接。新表按repository/provider/purpose/disclosure完整复合键读写，当前固定openai、ownership-semantic-assessment、ownership-semantics/1.0.0。global迁移13在IMMEDIATE事务内创建表及迁移记录；project不创建表、不标记13。既有Sol project缓存12和main project11边界不移动，稀疏角色迁移合法。

缺记录返回denied/revision0/空类别/null时间，不写数据库，不从旧feature授权推导grant。现有行严格schema验证并核全部可查询列与payload一致；损坏固定失败，不改成默认denied。命令先有界防御捕获再走冻结strict schema：不执行getter，拒绝Proxy、accessor、循环、未知字段与无效形状。捕获限制128节点、深度8及字符串总量4KiB；持久policy/provider JSON读取限制4KiB，涵盖当前合法契约，属于本地政策元数据限制，不修改语义材料或LLM请求预算。

grant在同步IMMEDIATE事务内检查实际旧授权revision、同连接实际provider设置revision及精确六类披露，递增独立revision，写入可信本地时间并严格读回。调用方不能提供provider DTO或授权record。revoke核独立revision、清空披露类别；从未grant保持两个null，真实撤销保留原grantedAt。时间必须不早于上一授权事件；时钟回退失败关闭，不能重写历史grant时间修复。安全整数上限拒绝。SQL冲突、BUSY、触发器失败或读回不一致完整回滚，可安全重试。错误使用既有固定安全错误/枚举，不回显SQL、输入、源码或路径。

这些方法是可信本地编排未来可用的存储执行能力，测试写入只发生在自有数据库，不代表真实用户点击或生产发送许可。没有接dispatch、共享lease、task、result、评分、IPC、UI或网络；历史语义材料仍prepare-only/not-checked。旧feature/task/provider/历史源码不因独立授权写入而变化。

## 反馈闭环与实际验证

首轮28项新增测试27通过、1失败：provider更新夹具把旧revision传给严格saveProvider命令，而该输入明确不接受revision字段。根因确认为测试夹具缺陷；移除夹具多余字段，冻结remote store无需修改。后续补齐迁移回滚、同连接provider锁与元数据边界，最终新增32项全部通过。没有确认新的生产缺陷，不更新金标快照，不编造环境失败。

最终实际命令：

1. `node node_modules/vitest/vitest.mjs run packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：4文件146/146，含新增32项；最终4.26秒。
2. `node_modules/.bin/tsc.CMD -p packages/graph/tsconfig.json --noEmit`：exit0。
3. 原副本精确diff及patch反向check：通过，仅检查。

验证覆盖：

- 初始denied在query_only=ON下读成功；所有表schema/行值及total_changes一致。返回和输入类别副本修改不污染持久行。
- grant/revoke/regrant、关闭重开、never-granted重复revoke及项目隔离；不同provider/purpose/disclosure键不混读，精确当前键严格验证。
- 旧feature grant不推导语义grant；SQL任务哨兵及实际GraphStore保存的历史快照/源码字节在授权操作前后不变。哨兵不代表执行任务流程。
- 严格命令缺类别、重复类别、旧feature命令、未知字段、错误版本/revision、Proxy/getter及超预算拒绝且零写；column/payload错配、坏JSON、坏类别或超预算记录使load/grant/revoke固定失败且原字节不变。
- 两连接陈旧授权revision、provider revision更新；grant核真实provider revision，provider损坏拒绝grant而不阻止合法revoke。
- 自有第二连接BEGIN IMMEDIATE造成真实BUSY；自有SQL触发器插入/更新失败后完整回滚、移除故障重试成功。错误不含夹具私有SQL文本。
- 自有provider表改名及视图/SQL函数夹具观察grant查询时db.inTransaction=true；函数中第二连接写provider得到SQLITE_BUSY，证明查询在同连接IMMEDIATE锁内。仅自有夹具变形，不改生产provider实现。
- Date模拟时钟回退/非法时间，grant/revoke/regrant拒绝且历史时间不变；恢复时间后重试通过。未修改真实系统时间。MAX_SAFE revision拒绝溢出。
- global13幂等重开，project无表/无13且操作拒绝零写；关闭后拒绝。自有迁移13触发器故障使DDL/迁移回滚，旧迁移时间及feature行不变，移除故障重试升级；无派生授权。

## 冻结与待审

|文件（packages/graph/src/）|最终SHA256|
|---|---|
|ownership-semantic-policy-store.ts|48EC3FFB3D747475A3FBBE7DCB0DC4E6CF096D15770F035B008498D26B0763A2|
|ownership-semantic-policy-store.test.ts|AB5D4CE0443369C76597B89862EB84CF0D8626F2BE88CB3A7A8ABBED3CA66F83|
|index.ts|09AE9625F7AE5562224705CAC28157DD4FD00B7578B8C52D60A105A4E0216E74|
|index.test.ts|C636BB216C01063C0E4796A96B2864494154C0B17B533CBA5D9538E3D8DD41D8|

开发验证完成，交协调方独立审查及精确主集成。未验生产编排、真实用户授权交互、撤销取消任务、跨用途共享占用、provider更新跨用途失效、IPC、GUI或远程质量；不称第二批整链完成。没有提交、推送或合并。

本轮AGENTS新增/修订0：批准五文件边界禁止修改AGENTS；已有事务、证据、安全和工作区保留规则覆盖实现，单次夹具输入错误不满足新增工程规则门槛。过程记录不替代独立验收。
