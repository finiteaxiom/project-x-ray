# 共享恢复完整性候选补丁：协调方本地修正与事务验证

仅原四批 S3-C/R。用户要求继续开发后，协调方重新核原两聊天和队列；Sol/Luna均idle。向原Sol派发具体窄修再次实际返回 `MCP tool call requires approval, but approval policy is never`，timeout0确认无新回合。没有更换聊天或写只读worktree，也没有重新尝试已拒绝的定时管理。

## 候选实现与保持范围

协调方在main自有ignored目录制作单文件候选，未改main生产模块、Sol冻结源、迁移或已有正确断言。只以冻结 `remote-task-recovery-store.ts` 为基线：原SHA256 `FB83C79802C69859073CA0813AD21251C68DEC199A87644805B3DD04E79B22DC`，重新核实保持。

- 在精确补偿之前，从实际完整结果表计算唯一允许的预期变化：只移除本次非成功任务、对应用途的结果，其余行逐字保持；completed目标完整payload也在预期内。
- 来源库实际COMMIT并重新取锁后再次核验结果预期；关闭context和release后、最终事务提交前再次核验。不能仅靠其他task历史相等、semantic候选或共享六表自洽释放。
- 绑定的已知source增加完整快照、源码、图事实、答题/胶囊/原题绑定/兼容成绩历史前像，已知settings增加现存排除配置历史前像。只读取已绑定实际数据库的固定表，不扫描未知数据库或打开新项目。
- 保持原跨库提交阶段、固定错误、一次permit、task/T1/身份、非成功补偿和人工重试。原native/application资源域和生产接线保持冻结。

候选 [源码](../../.benchmarks/c-core-integrity-candidate/candidate.ts) SHA256 `2556FF3547FBC8B2176809121995D3259B366043B2935C7A68D160CDB1AA667A`；[可审查patch](../../.benchmarks/c-core-integrity-candidate/recovery-integrity.patch) SHA256 `33C4924ED6CDB215D4C65E8C452D796951D69E5CB8A03E899F647802D7A888C4`。原Sol目录 `git apply --check <该patch>` exit0，只检查，没有apply或Git写入。

## 实际反馈闭环与验证

命令在main运行，仅本进程TEMP/TMP使用自有ignored目录。`.benchmarks/b1-independent/c-core-candidate.mjs` 每次先核原冻结文件hash，生成候选与仅供探针加载的import映射副本。

1. 原始四场景探针复制旧自建真实索引SQLite，候选将原completed来源提交窗口删除结果、legacy context触发源码改写两反例改为POLICY_INVALID/lease1。正常对照保持结果和源码。原mastery空表场景不计成绩保护结论。
2. 初次探针加载发生Windows绝对import URL错误（测试入口缺陷）；仅运行副本改用file URL，源码候选行为未改，原探针再次执行成功。
3. 为验证非空历史，读取自建fixture的实际1快照/1文件/1原答题/1原题绑定；mastery_records原本0。初次寻找同时具有mastery的旧fixture在50个上限内未找到，停止扫描。确认新答题不写旧兼容表后，矩阵在每个副本中通过真实 `GraphStore.saveMastery` 保存基于该实际答题的兼容成绩1行；这不是旧历史本来有成绩的证明，也不冒称fresh索引。
4. `tsx.CMD .benchmarks/b1-independent/c-core-integrity-matrix.ts original` exit0，收集29场景；其中正常12通过、故障11拒绝/6错误成功。该退出只代表反例收据生成，未将旧实现验收为通过。收据 `matrix-rGLT67/receipt.json`，SHA256 `57CD257E2324A4863DCECB43006343180E81AC8700F126D9EBAA79764C91DD90`。
5. 相同矩阵 `... candidate` exit0，29场景断言全部通过：两布局×六feature阶段正常12门；17故障均拒绝并保留lease，其中15个可回滚故障移除故障后人工新permit成功重试。覆盖completed目标删除/合法payload改写、context改源码/答题/兼容成绩/成功结果、context RAISE(IGNORE)、release副作用、真实deferred global COMMIT失败，以及两布局补偿触发器副作用/IGNORE。外部已提交的目标删除/改变仅保守保留占用，不声称回滚外部修改。收据 `matrix-eyPYLp/receipt.json`，SHA256 `DFC58BFC2BEF209D4B52300ACAC7A4E003EC0D07C6F4A7CDBEDC527251D5F962`。
6. `tsx.CMD .benchmarks/b1-independent/c-core-semantic-candidate-probe.ts` exit0，使用同一真实旧索引、原答题、当前ready胶囊/真实R1/A2端口和真实SQL，两布局×六semantic阶段12门通过，原attempt/capsule/源码保持、completed结果保留、非成功精确补偿、lease正确释放/T1保持。收据 `semantic-candidate-mo4f7d/receipt.json`。
7. `tsc.CMD --noEmit -p .benchmarks/c-core-integrity-candidate/tsconfig.review.json` exit0。该配置继承原strict等规则，只有候选源的检查，映射到现有真实contracts源和graph的better-sqlite3类型声明，未添加假类型/any或改原项目配置。初次因候选目录没有graph依赖入口失败；仅该review配置指定既有依赖位置后通过。不能代替原四包完整noEmit。

合计候选事务矩阵41场景通过；15次故障后人工重试包含于矩阵断言，不另重复计作新场景。旧19文件788回归/四包完整类型受环境阻碍的失败记录保持，没有复跑同一失败组合或改断言。没有运行导入项目代码、真实provider、授权控件或GUI。

## 未验收与后续

此为实际源码候选及事务验证成果，尚未写入原Sol交付或main生产源，尚未正式集成、提交/推送。需要原Sol审查/接入对应回归，协调方再验证其准确交付及完整适用检查。覆盖全历史增加恢复时读取量，大型数据库成本本轮未测，不外推性能收益；不以单文件类型或41事务门替代native/application整链门、fresh索引或真实GUI。

派发工具依然被当前策略拒绝，Sol仍idle；用户已有授权，无需重新规划或批准同一任务。定时此前真实ACTIVE保持，不宣称已暂停或已重启。原四批未完成，没有第五批。本轮AGENTS新增/修订0：现有SQL写后核完整实际预期、触发器反例和事务回滚规则已覆盖；候选未正式集成，不追加重复经验。

### 完整访问后的 fresh 独立材料

root在main自有审查driver运行 `tsx .benchmarks/b1-independent/c-core-fresh-material.ts 'D:/Projects/Project X-Ray'`，exit0。样例本轮实际索引、实际call-direction答题通过、实际semantic package ready；兼容mastery通过saveMastery显式保存，SQL非空1行，question binding非空。无执行样例代码、无网络/真实凭据；自有SQL夹具中的provider配置仅元数据。收据 `.benchmarks/c-core-integrity-candidate/fresh-owned-fixture.json` SHA256 `63B14EF75F05A34108F194F3F77EF5202ED3FF7F08D4E008457DB2EDD4D95D2E`。

已据原独立matrix/semantic探针准备current版本，改为本轮fresh材料与Sol实际recovery source导入，并在current模式保留全部结果/历史/失败占用/重试断言。尚未运行，须待Sol稳定冻结后执行；不与其正在修改的源并发。此为独立材料门，非core整体验收。原候选/历史收据保持，不覆盖用户文件或AGENTS。