# 2D-S3-A1 共享SQL占用与feature兼容

2026-10-05，开发-Sol，仅5170、原第二批。依据[批准实施计划](../plans/2026-10-05-shared-task-core-implementation.md)与[已接受设计](../plans/2026-10-05-ownership-shared-task-design.md)。branch codex/llm-explanations、HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8保持不变。原四批结束后暂停，不第五批。

## 基线、精确范围与保存

实施前核对AGENTS、实际Git/计划与冻结依赖；计划SHA256 C07F68F5211CEBF4487B2B5C884082ADCC95C2A1C0F4C79907318B91544093EC。在自有临时目录保存四个会改旧文件原字节副本及git列出tracked/nonignored untracked共316文件SHA256清单；中断续作沿用原副本，不覆盖。原hash见交付补丁对应原副本，可逐项和清单核对。本记录不保存源码、凭据或私人绝对路径。

|原文件（packages/graph/src/）|原SHA256|
|---|---|
|remote-explanation-store.ts|7923E08945ECE2B38F070F1000916E755CB42B07EC36DDAF8B3622A8BD04EE1A|
|remote-explanation-store.test.ts|8F821DDA777CCE9FA698860C6ADF9B6B931A0FE87ED33769E8176E8813171C9B|
|index.test.ts|C636BB216C01063C0E4796A96B2864494154C0B17B533CBA5D9538E3D8DD41D8|
|ownership-semantic-policy-store.test.ts|AB5D4CE0443369C76597B89862EB84CF0D8626F2BE88CB3A7A8ABBED3CA66F83|

只新增shared-remote-task-store.ts及.test.ts、本记录；窄改remote-explanation-store.ts及.test.ts、index.test.ts，另按计划必要调整ownership-semantic-policy-store.test.ts非法哨兵夹具。共七文件。index.ts无需新增生命周期：RemoteExplanationStore私有同连接持有shared core，因此保持index.ts原字节。S2源码、contracts/application/LLM/desktop/broker/UI/native/cache/loan/AGENTS/包锁、其他记录保持冻结。

交付六代码文件精确patch从原字节副本到当前生成，不采用HEAD总WIP diff；SHA256 `2F275D3E9FED8EE7D82CA1BB9874DFFCA2A806FB3F1D0100D99E58A098C5AD80`。`git apply --reverse --check <本轮patch>` exit0，只检查未apply。没有Git写操作或main目录修改。原316文件逐项复核，仅上述四个授权旧文件变化，其他312原字节不变；包括原index与S2源码。新文件是两个core代码文件及本记录。

## 实现与实际边界

global迁移14只创建remote_task_registry与remote_provider_lease、桥接守卫及标识；project无两表/14，旧10/11/12/13不移动、不改断言。registry跨purpose历史UUID唯一，保存完整strict feature/L2 identity、canonical payload SHA256、owner/repo/context/epoch及首次createdAt。lease provider主键仅openai，合计一席；purpose不是锁主键。新身份元数据16KiB预算，旧feature原262144字节读取界限保留。没有semantic任务/结果表、语义reserve/dispatch public接口、stopReceipt或发送许可。

迁移同连接同步IMMEDIATE逐行严格核旧feature identity/phase/inflight/owner/时间，再复制所有历史UUID与唯一合法inflight，包括terminal未释放。旧payload、创建时间、终态及源历史不更新。dispatched0、多占用、损坏/半升级失败，14 DDL/标识全回滚，不恢复或释放。已14重开先核schema/桥接/旧唯一索引及跨表一致性，拒绝缺表/触发器/索引或坏行，防旧IF NOT EXISTS静默修复已损坏结构。

feature原公共签名、身份、permission/context门及返回shape保留。私有core在同事务登记registry及task；数据库桥接从task acquire/release单席，拒绝无registry插入、身份/首次时间改写、terminal复活或历史删除。触发器只使用SQLite内建JSON/SQL，无连接局部UDF，真实第二连接可运行。UUID冲突明确REVISION_CONFLICT，占用/真实锁BUSY；其他SQL及损坏固定POLICY_INVALID，不回显私有异常。写后严格核实际task等于拟返回记录，防额外触发器合法改写phase后误返回原phase。

finish只更新一次终态、保持inflight/lease；terminal重复返回原code/时间；release仅精确本task已terminal占用，重复或迟到释放零写、不删后来feature或人工semantic席。首次权威createdAt由原feature登记分配一次，registry/lease/终态/恢复复用；completedAt必须合法且不早于createdAt，时钟回退失败关闭。

feature-only recover先在IMMEDIATE核完整共享状态；遇非feature占用或坏/无法核验行，在终态/context/占用写之前固定拒绝，全表与total_changes不变。合法feature恢复仍由既有可信调用方先停旧worker，标interrupted并精确释放，不重发、不删成功历史。没有证明全用途worker退出；真正参与者恢复留后续。原provider/context/feature授权仅维护feature语义，不给S2加任务回调，不清人工semantic席。

此切片只证明SQL注册互斥。原application仍在事务内同步dispatch后commit；提交失败时同事务registry/lease/task会回滚，外部已发请求不可回滚。原应用“一次已许可dispatch、零task/result、无重试”断言完整保留。durable reserve、完整body去重、语义当前性/题目认证、发布及全参与者停止门均未接线。

## 反馈闭环与失败分类

1. 部分实现后原remote14项回归通过；随后执行因额度中断，协调方报告原回合failed并恢复额度可用。分类为环境问题，未改代码回避限制，续作核源码hash与原副本后继续。中断时shared源码D88C54AE...及remote36445CA9...与协调方报告相符；此前自测不作为独立验收。
2. 首轮新增core31+S2共63项，61通过、2失败。新增digest损坏夹具用短字符串，在故障注入阶段被CHECK(length=64)拒绝；改成长度合法但hash错误，临时移除并复装原守卫以真正验证持久损坏而非只缺触发器。分类测试夹具缺陷。
3. 原S2测试把old-task/old-session/old-task-sentinel原始字节插入tasks，非合法strict task，被新桥接拒绝；计划明确允许修此夹具。替换为真实trusted context及strict undispatched cancelled历史task，原state/total_changes/旧feature/provider/task/历史source不变断言全部保留，S2源码零改。分类旧夹具与新约束不兼容，不是放宽生产校验。
4. 六文件234回归通过，graph/application首次noEmit均因新invalid箭头函数的控制流收窄未识别报unknown/possibly undefined。根因确认新实现类型写法；改为显式never函数声明，未用断言或降低strict，两包noEmit通过。
5. 静态审查补齐lease插入与真实feature task关系、写后精确读回、已14在旧DDL前验证缺索引；增加合法但不同phase的AFTER INSERT触发器、缺旧索引重开及permission/context零写回归。没有将这些未先运行的风险改写为已确认旧产品缺陷。最终重新运行适用回归和两包类型检查通过。

没有盲改金标快照、删除原正确断言或修改应用源码。环境额度问题不沉淀工程规则。

## 实际验证

最终命令：

1. `node node_modules/vitest/vitest.mjs run packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：6文件236/236，最终10.59秒；含core33、remote15及完整原应用回归。
2. `node_modules/.bin/tsc.CMD -p packages/graph/tsconfig.json --noEmit`：exit0。
3. `node_modules/.bin/tsc.CMD -p packages/application/tsconfig.json --noEmit`：exit0。
4. 精确补丁反向check、全WIP SHA256比较与Git branch/HEAD复核：通过，检查未写Git。

自有真实SQLite验证：

- global14幂等关闭重开，project零表/零14；无semantic任务/结果/public语义注册；旧正确migration13与project12断言保持。
- 旧dispatched1及completed1升级原identity/createdAt/inflight/payload不变，旧source哨兵与迁移10原时间保持；合法terminal0无slot。dispatched0/坏JSON/owner/phase/非法创建时间/终态早于创建时间、多占用、半升级全失败；14标识故障回滚全部DDL，移除故障重试成功。
- 两个实际连接IMMEDIATE交错与提交后竞争BUSY。人工严格semantic registry/lease阻止feature，feature阻止另一人工slot；第二方事务整体回滚，至多一席；跨purpose历史UUID碰撞REVISION_CONFLICT。人工slot不创建语义任务、不证明语义许可。
- finish不释放，dispatched release拒绝，terminal幂等；重复/迟到release total_changes零增加，不清后来任务或人工semantic席。trusted undispatched cancellation首次登记但无slot。
- 控制Date进退，终态时间回退拒绝且全表不变；之后恢复保持原createdAt。没有修改真实系统时间或执行真实阶段事件验收。
- 合法非feature、坏registry digest/time/context、lease错配/缺失时recover全表与total_changes零写；缺table/bridge/旧索引/迁移标识重开拒绝，未自动修复。
- registry/task/lease插入故障触发器全回滚、移除重试成功；lease删除故障保持terminal席。AFTER INSERT合法改phase也被精确读回拒绝。第二连接无UDF执行bridge，拒绝无登记插入、身份时间改写、复活/删除。
- 合法最大revision、UTF-16文本及JSON转义最坏字段长度组合仍小于16KiB；strict契约未改。真实permission/context拒绝零写；closed固定拒绝。
- 原remote政策、capsule/S2持久化与应用发布/补偿/COMMIT失败回归均通过；未把人工夹具或旧报告当真实Electron/用户授权证据。

## 源码冻结

|文件（packages/graph/src/）|最终SHA256|
|---|---|
|shared-remote-task-store.ts|D8EB87D50CAACDF2E97C2015146BCEF6C04966941568212C34BD8655BE6EBFEB|
|shared-remote-task-store.test.ts|29864096A65388507F7467EFD3BAED11FF4066B996AFECACE9ECC5D5DB07C18F|
|remote-explanation-store.ts|9D23F7B7B70697C7D13B1CB903A4D2005B71F4D1066CB98386764CCCB2303E67|
|remote-explanation-store.test.ts|0C970708BCA3A0DBF56CBC1461A72707C71D145E4DED663776D94FE66F40F73C|
|index.test.ts|40A3CD1F2E87F7E378A33D9A6727A1F316FD33410ABFCBB4DC5BBD0448D4C2C1|
|ownership-semantic-policy-store.test.ts|FE152ED9C08D38072DD06DF685F0A04C9226CD2D81038EB5C3333FC61D21D022|

源码已冻结，交root独立复验/精确集成，不称已独立接受。未执行Git提交/推送/合并、重型build/native/Electron/GUI、网络/凭据扫描或导入项目代码。未验durable传输、semantic task/结果/当前性/原题认证/完整body复用、真实用户授权、共享参与者恢复或远程质量；本后台SQL切片不代表第二批整链完成。

AGENTS新增/修订0：批准范围禁止修改；已有短事务、跨库成功门、停止前置和精确身份规则覆盖。夹具/类型修复及额度中断不构成需新增规则的复现实验。开发记录不替代独立验收。
