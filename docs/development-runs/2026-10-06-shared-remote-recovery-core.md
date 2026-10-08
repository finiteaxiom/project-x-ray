# S3-C C-core：统一原生参与者停止与精确恢复

2026-10-06。原四批 S3-C 的内部核心实施；不启用 main/broker/B2 生产接线，不代表完整桌面恢复或GUI接受。

## 基线、范围与设计纠错

实际本地 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`；before366 全部文件原字节已保留，清单 SHA256 `56D906CDAA322F465C9B703419CFAF53436B5F474389A2F6257381F89AA0B158`。协调方报告 B2 main 集成为 `9d9f19aafbdeed5a185ac04bee9af62bf4f1f2e4`，未在本轮访问主 checkout 验证或复制它；旧WIP不重置。

协调方退回方案两项：graph 不得持有/校验 Worker；reserved feature 的 promoteFeature(interrupted,1) 被旧17 trigger拒绝。本轮先在自己的两设计文档末节明确纠错，再实施，保留原已接受设计及所有旧14/16/17/18定义。原生能力放 application/remote-recovery-capability，graph仅接可信构造闭包的一次opaque权限。global19正式窄修reserved feature非成功终态提升并保持lease，project不安装19。

修改仅 graph/index及test、shared-remote-task-store及test、result-store.test中一条global角色迁移列表新增19，自己的两设计文档纠错。新增 application生命周期/私有原生能力两模块与test、graph恢复模块与test、本记录。A2/R1/Q3/L5/B2/旧remote-store/政策/desktop/UI/共享协议/依赖/AGENTS原字节保持。

## 可运行内部路径与信任边界

- 单个实际authority实例仅有一个私有 RemoteTaskLifecycle；原生资源创建在可冻结的登记之后，保存真实Worker、owner、purpose和所有退休generation。Boolean/Promise/Proxy/抛错工厂留下unknown域，不转为零资源证明。实际模块捕获原生terminate/getter，公开terminate/伪exit/可变属性不签退出证明。
- 可信生产者在prepare/work开始前登记操作，在finally结算；恢复关创建、prepare/start、写入/事件门，原生全退出之后还等待全部旧操作结束。迟到操作返回被拒绝；同步admit拒Promise而不是漏记异步写。60秒停止/结算期限失败保持关闭，不生成证明。两用途共享prepare/pending/实际活资源预算，生产TaggedIssued窗口仍留给desktop整合。
- 任务归属必须是这个域在同步admit内观察到新持久登记的精确taskId/owner/purpose；创建一个同owner新Worker不能认领旧占用。重开、未知旧进程域或非本域创建的任务blocked，不提供空inventory/启动锁即已停的捷径。当前B2/旧broker不自动纳入此域。
- 原生证明在 application私有WeakMap一次消费，包含被冻结的inventory revision；graph issuer只交可信构造闭包，捕获实际authority、纯会话对象、完整共享状态前像，一次capture/permit。不同issuer、authority、clone、旧状态/已消费/close均拒绝；graph新核心不导入或访问Worker/Electron。生命周期close同时撤销纯graph会话，正在await R1的恢复也无法迟到release。
- known source只从已持有的实际GraphStore实例绑定：重核历史snapshot/root元数据、全部source的实际hash/bytes/language、原题/胶囊/graph/成绩材料、当前实际settings及原source/settings实例。空外部settings的默认值不是仓库归属证据。不同实例冲突保留歧义；同一真实实例显式重新绑定可替换旧捕获，不能据此猜一个新库。无renderer路径/成功callback、库枚举/创建或SQLite反射的application生产代码。
- 原有feature-only recover保护保持。恢复先strict全共享状态，reserved写interrupted/inflight1、dispatched精确INTERRUPTED，原非成功terminal/code/T1不覆写；completed不降级。源库实际R1 readCandidate重开可重新签真实issuer候选，完整历史验证后才精确compensate；feature复用原严格结果/非成功删除门。候选缺失只能来自已验证真实源，未知不能冒充无结果。
- 终态global先提交；source补偿在global→settings→source锁序下实际提交，重新持source锁及全门后才context关闭/精确release。二库非原子；同库则同一次最终事务。任何其他历史结果、源/原题/成绩/mastery或global无关行的副作用导致回滚/保留占用。完整completed闭合才释放且所有成功历史保留。
- 固定错误附只含布尔提交进度的progress，指出terminal/source独立提交与release是否完成；不返回或日志原source、任意异常正文/路径。原primary不被secondary锁释放错误覆盖。失败permit消费，下一次明确恢复重新捕获/验证已经真实提交的阶段，精确幂等清理，零重发。

## 实现 → 验证 → 失败诊断 → 修正 → 再验证

1. 在新迁移实施前新增真实reserved feature非成功转换回归：实际抛XRAY_SHARED_INVALID，原17不允许phase!=dispatched的lease提升；不是mock/环境问题。新增独立19定义，仅改安装时的feature非成功条件；旧定义不改，先核旧完整schema/state，DDL与marker都受事务。再验共享48/48；补真实17降级反例、第二连接锁/转换、错误identity/T1/completed/重新激活、坏旧schema、marker/COMMIT回滚后57/57。
2. graph恢复33/33、application原生能力13/13的初步结果仅局部证据。扩充跨库提交切点、第二连接真实R1 crypto等待变化、context IGNORE、会话close及foreign issuer、unknown/purpose/任务域后继续完整验证，未把初步结果宣称整体验收。
3. 实际Q3/B2双布局切点首次有1项夹具失败：错误预期同库也保留source结果。真实同库completed COMMIT回滚连结果一起撤销；修正该布局断言为零结果，并增加release故障保留lease，以覆盖实际同库失败恢复。未改B2或弱化正确跨库孤儿结果断言；属于测试缺陷。
4. 代码收尾审查发现会话close应撤销正在await的恢复；新增纯graph会话门与实际R1等待关闭回归。属于代码依据的预防性修正，没有伪称修前已运行失败。
5. 第一完整19文件785/785通过（179.37秒）后，source/settings归属审查新增回归确认空外部项目store会因默认配置被接受。属于本轮绑定门缺陷；新增实际仓库元数据核验，拒绝未知设置库，同时真实legacy source+独立已记录项目配置验证可恢复。两项针对性用例通过，接着完整19文件787/787（181.79秒）。
6. 新增人工重新绑定回归确认：原bind只push，配置改变后同实例新捕获叠成歧义，安全恢复仍失败。属于本轮人工重试实现缺陷；同source/settings实例的显式重核只替换自己的旧捕获，其他不同实例不合并。该回归实际先失败，修正后通过；因此再次完整验证，最终结果见下方，不将787作为最后版本结果。
7. 字节审计发现编辑工具把旧LF转成CRLF；恢复旧文件原有行尾（归一化内容逐项一致），避免旧定义及冻结差异中的无关改写。不是产品运行缺陷，也不提高任何测试阈值。

## 实际最终验证

最终完整组合19个文件788/788通过，exit0，186.14秒（其中graph恢复42、application生命周期24、原生能力15、共享任务57）；graph/application/contracts/llm四包最终noEmit均exit0。所有测试使用实际SQLite、自有临时索引项目/原题/答题/胶囊/Q3/B2材料、自编Node native Worker，未执行索引项目代码或HTTP。

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts packages/application/src/remote-recovery-capability.test.ts packages/graph/src/remote-task-recovery-store.test.ts packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\tsc.CMD --noEmit -p packages/graph/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/application/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/contracts/tsconfig.json
.\node_modules\.bin\tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

覆盖两purpose/两布局的reserved/dispatched/非成功terminal/completed；source已commit/global未complete及精确候选重验、native多退休generation/伪停止、异步结算/close、未知旧资源及新cap/旧cap、source/settings变化与显式人工再绑、两连接BEGIN BUSY/等待竞争、终态/DELETE/sourceCOMMIT/contextIGNORE/release/globalCOMMIT故障及已提交进度；T1、原题/确定性成绩/mastery/原source及成功历史保持。SQL反射只在自有测试夹具用于切点/故障，production application不反射数据库。

## 冻结、限制与经验判断

最终patch从before366原字节生成并逐hunk重构；完整before/after/未变清单及两文档纠错独立列出，旧freeze不覆盖。不把整份含旧WIP的Git HEAD diff交付。最终实核before366：授权旧文件变更7、新文件7、其余359原字节不变，after373；14个文件的patch逐hunk精确重构当前字节通过。没有执行git apply或任何Git写操作。

未build/native/dist/Electron/GUI/HTTP/OS凭据/模型质量/成本实验；未main/IPC/preload/worker-runtime/broker生产集成、源文件受限SQLite打开桥接、旧进程/全生产域启动停止证明或公开发布。当前scope只可信自有native域；unknown重开仍blocked，没有用假locator/停机port补齐。未Git写操作或访问主checkout，等待协调方独立审查后决定后续集成。

AGENTS新增/修订0（本批无修改许可）。保留一个供协调方评估的证据候选：默认配置不是项目store归属证据；在恢复/发布绑定可能选择独立settings store时，先核真实仓库元数据，并回归“空外部store默认值拒绝”与“同实例显式重核可人工重试”。这条已有实际失败/修正支持，但公共规则是否已覆盖、如何去重由集成方判断；不会用过程记录替代实现或独立验收。

## 2026-10-07 S3-C/R 完整性窄修

仅原四批内恢复core的独立审查返修；仍未生产桌面接线或GUI验收。本轮先核当前AGENTS、实际HEAD与WIP，原373冻结manifest逐文件SHA256全部匹配；HEAD仍为`455d4ad50830ee2495b70927e51caf830a4efbb8`。完整373原字节另存before，未reset、Git写入或覆写旧交付。仅修改graph恢复source、对应test和本记录。协调方主目录仅按授权读取任务、反例、候选及其自有探针材料，未写入主目录。

### 原始失败、根因与修正

- 审查协调方候选patch（SHA256 `33C4924ED6CDB215D4C65E8C452D796951D69E5CB8A03E899F647802D7A888C4`），确认其针对两类缺口：source COMMIT后重锁只重验其他task结果/semantic candidate，未重验完整completed feature目标；最后material核验早于context/release，未拒绝其触发器历史副作用。此次接入该具体候选，没有另造生命周期/数据库契约或修改迁移。
- 新增fresh index→实际题目→真实引用答题的夹具，并通过实际`saveMastery`保存来自该答题的兼容成绩；明确原新答题不意味着旧mastery自动非空。新增断言保证原答题绑定和兼容成绩存在，不以空表证明保护。
- 第一轮86项：55通过/31失败（40.68秒）。其中27项被新夹具将Evidence的额外snapshotId/reason展开到strict citation所阻；属于新测试夹具缺陷，改为仅选择实际引用契约字段。另4项真实semantic context/release历史副作用仍错误成功；产品缺陷未掩盖。
- 修正夹具后旧source再次运行86项：71通过/15失败（49.24秒）。两个completed第二连接删除/结构合法payload改写错误释放；九个legacy两用途context/source/成绩/结果及release副作用错误成功；四个split feature cleanup故障在保护检查前已经sourceCommitted，进度及原历史不符合预期。未改正确拒绝/保持断言。额外两个实际其他快照源码/兼容成绩、其他仓库配置的回归，旧source均错误成功（2失败/86跳过，2.62秒）。以上均产品完整性缺陷，不归为旧restricted环境问题。
- 应用候选前从原文件精确核对每个hunk。第一次交付脚本将候选CRLF与原LF按字节比对导致脚本断言失败，source零写；误启动的旧source测试已中止，未算作复验。改为内容行相等并保留原LF后应用，source SHA256 `38FEE2199FB97CC9B6992AA82A3C045170CE2CC1150E15569FBA8E641090D0D9`，与候选仅行尾不同；没有Git apply。
- 修正从完整结果表在补偿前确定唯一允许预期，仅移除本task/本purpose的非成功目标；completed完整目标及其他结果均保留。真实source COMMIT后重新BEGIN，以及context/release之后最终提交前，核完整实际预期与已绑定source/settings历史。history包含固定已知表的所有快照、源码、graph、原题绑定、答题/胶囊和兼容成绩及配置；不打开未知项目、扫描数据库或猜locator。真实外部已提交的completed目标删除/改写仍存在，只保守拒绝并保留lease，不声称回滚外部破坏。
- 修正后恢复模块88/88通过（50.99秒）。新增46项包含12个fresh feature两布局六阶段、2个外部completed结果切点、14个两用途legacy context/release/COMMIT故障、16个两用途两布局cleanup副作用/IGNORE及2个非目标历史保护。32个可回滚故障移除触发器后以新permit人工重试通过；不重发任务。原42项断言保持。

### 本轮实际验证与环境

先前协调方restricted环境的reader/声明失败记录保留，不改写历史。本轮实际fresh indexing、原Vitest及四包noEmit可运行；未改安全reader、Windows设置、类型规则、依赖或测试阈值。

- 原19文件完整Vitest命令与参数沿用上方：18文件通过/1失败，831项通过/3失败（834项），exit1，426.58秒。新增恢复88项及native15项均通过；失败只在冻结B2 application测试的三个timeout用例。完整验收未通过，不把局部通过换算成整体验收。
- 原`tsc.CMD --noEmit -p packages/{graph,application,contracts,llm}/tsconfig.json`分别exit0；检查新source/test及原范围，不用单源review配置替代。
- 将协调方三个probe仅复制为自己ignored目录内运行副本；只更改候选模块导入为本轮实际source、明确自有fixture读取位置、收据输出目录。原SQL/断言/41场景保持。`tsx.CMD .benchmarks/integrity-review/c-core-integrity-matrix.ts candidate` exit0，29场景（12正常、17故障拒绝、15故障后重试）；`.../c-core-semantic-candidate-probe.ts` exit0，12个两布局六阶段。该41门使用历史实际索引副本，不冒充fresh E2E；fresh证据来自上述正式测试。运行副本中的candidate标签沿用原脚本，加载的是本轮实际graph source。
- `tsx.CMD .benchmarks/integrity-review/c-core-recovery-probe.ts` exit0只表示四个收据生成：正常split保留并释放；completed COMMIT窗口删除、legacy context源码副作用拒绝且lease1；原成绩为空的删除场景正常释放/原空历史保持，不计非空成绩保护验收。

增加完整历史读取是本轮正确性门；小夹具时间不能外推大型数据库性能。本轮未测大型库成本或提出优化收益，没有为性能删门。未build/native/dist/Electron/GUI/HTTP/凭据或Git收尾，未修改application/native/shared迁移或broker/B2/desktop/公开契约。

### 冻结与规则判断

本轮冻结以原373为before，仅三文件改变，其余370须逐字核验；准确patch/完整before-after/保持hash及逐hunk重构另附。最终逐文件核验：before373/after373，三文件改变，其余370原字节保持；三文件patch逐hunk精确重构通过。补丁是相对于原373的增量，原基线已有两个source/test文件，本轮新文件0；不把其Git-untracked状态误写成new file。不覆盖旧manifest或patch。

本轮AGENTS新增/修订0：按当前规则先评估去重；完整实际预期、事务副作用与失败回滚要求已有覆盖，且本轮明确只允许三个文件。保持已通过native能力、一次permit、全部generation/异步结算、unknown占用和旧feature-only保护；正式接受仍由协调方独立验收。

### 冻结B2超时的独立对照及未验项

完整运行之后，未编辑B2/application源或测试。当前source下原B2单文件`-t timeout`运行3失败/78跳过，17.50秒，均为原默认5000ms超时。为了检验与本轮source变化的关联，将已核原SHA256 `FB83C79802C69859073CA0813AD21251C68DEC199A87644805B3DD04E79B22DC`的冻结恢复source复制到自己ignored目录，仅重写import位置并由独立Vitest配置alias加载；actual graph/application/测试文件保持。第一次控制配置漏了该ignored入口的真实contracts位置，零测试执行，属于probe入口缺陷；补充实际contracts源位置后，原冻结恢复source同样3失败/78跳过，17.31秒。两个控制均没有提高5000ms、过滤断言或改安全设置。

实际对照命令：

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/ownership-semantic-application.test.ts -t 'timeout' --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/ownership-semantic-application.test.ts -t 'timeout' --config .benchmarks/integrity-review/baseline-control.config.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

源码依据：测试在工厂通知`c.created`之后立即推进模拟时钟；真正deadline在`await beginOwnershipSemanticExecution`之后安装。这是后续定位的时序候选，本轮未通过运行时插桩确认具体等待点，不能将其写为已确认根因或环境问题。已确认本轮新source和原冻结source均复现三项失败；未授权修改这些冻结B2源/test，保留该未验收清单供协调方另行核实范围。19文件组合其余831项、完整四包类型、本轮fresh恢复88项和历史事务41门是当前实际证据；完整组合仍失败，无GUI、生产恢复或项目整体完成结论。
