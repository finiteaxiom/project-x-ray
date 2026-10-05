# 2D-R1 内部语义结果 SQL 核心

## 授权和实际基线

仅原 R1、仅本 checkout；不推进应用编排或第五批。原计划 SHA256 `F55F0846C496C664BE25BA83C548EB4BCB88B85C6B3B42B8E7297CC7F0D4BD2C`。上轮额度中断属于账户/环境限制，未产生结果核心源、测试或记录，不编造产品失败。

恢复时核对 AGENTS、计划、只读 Git HEAD/status 与同步后的实际字节：HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，已有 155 项 Git status 输出保持；349 原文件逐项全等、无缺失。协调方 baseline.json SHA256 `7971E382B63321E02691A41A666A9F39E740695F11F119DA457F495C0B9E510B`；另保存自身原清单及授权旧文件字节。使用同步后 L5 和已有 A2/Q3，不重做已验切片，不按 HEAD 覆盖 WIP。

协调方后续明确追加 shared 测试角色断言窄授权；当时计划 SHA256 `FB26FAC624C024D7BBBE3C5A2D33EEA7F412BF49851722EE3DAD80CBD63792D8`。计划变动由 root 同步，不纳入开发 patch；原 349 基线不重置。

最终又获得capsule第216行单追加18窄授权，已核原文件及副本hash `9359C1E2001C7F9941437934CB1FCA0B21EC7348F6A6306673B08C2A69FA6F8C`；最新协调计划hash `9CDDF3BE429BD7AC3F2BEFE79CAC39AB862CBF14405EA5695CB0B13572EB75CE`。仅该数组追加18，保留Sol1–12/15及main原11差异，不改变其它断言。

## 实现及边界

新增内部 ownership-semantic-result-store.ts/test，GraphStore 仅私有 constructor/migrate/close 接线，无结果公共 API/barrel export。source migration18 安装于 project 和 global legacy-source；global17/main11/Sol12及旧 cache/loan 生产定义未改。

结果表只有 task/repository/snapshot/attempt、binding/response 摘要、T1/完成时间和 canonical L5 envelope，预算272KiB、真实 attempt FK；update不可变，无原题、原答案、完整包、源码、key或路径副本。迁移18同 IMMEDIATE事务建固定对象、写标识并核对象/所有行；部分对象、缺/错/额外对象及坏历史行拒绝，不修复。旧数据、旧 applied_at 和旧生产触发器不变。

prepare直接使用L5首次await前私有捕获的DTO，compiled GraphStore ready材料端口及完整 validateOwnershipSemanticResponse。按真实 attempt/capsule 严格核题目、attempt/rubric版本和hash、source分析/config/manifest身份与实际包ID；验证全部criteria、允许证据/limitation和UTF-16答案范围。grant/provider/body来源及当次exact prepared批准仍不可由本层证明，不接受caller成功回调。

私有一次receipt绑定以下精确实际行：目标attempt、capsule、question binding；目标snapshot、snapshot_overviews、source_snapshots、nodes、edges、evidence。此范围覆盖ready材料端口读取和原题binding，不扫描任意库；完整private preimage在异步校验后和同步append事务内重核。源码仅参与内存中的比较，不写入候选或receipt外部对象。activation在prepare与实际overview相配；历史读取不要求旧activation仍是当前activation，避免把同快照再晋升当作历史损坏。

append要求可信GraphStore实际global及source事务；由A2实际SQL read/assertState核同用途、完整identity/T1、dispatched、inflight及精确registered占用。内部source savepoint同步核材料、写行、核完整列/payload/摘要/精确目标、再核材料及权威状态。直接changes和total_changes增量都必须为1，防已有精确旧行上的RAISE(IGNORE)或附加写被当成新写成功；这不是单靠计数认证。返回仅stored-candidate凭据，不标published，不证明外层COMMIT。

readCandidate完整私有捕获实际行，重走L5两摘要及实际ready包/全部response校验，异步后重核行与材料。内部候选对象不会声明current/published/mastery。compensate只接受本实例实际存储/读取的私有候选凭据，在global事务读取同identity/T1的failed/cancelled/interrupted任务并核完整共享占用状态；source内精确删除目标并核删除效果。completed/dispatched/reserved/缺失/错用途/错身份拒绝。缺候选仅在权威非成功同身份已确认后幂等零写；不释放task/lease，不吞外层错误。

跨库预条件是未来可信编排按global→source建立实际IMMEDIATE屏障；本层检查实际inTransaction并读真实权威SQL，不把该检查或嵌套savepoint称为跨库原子提交。source外层COMMIT可能在方法返回后失败，global占用仍保留。生产当次exact prepared response批准、全当前性、发布、worker停止和全参与者恢复继续由未来编排负责。

## 实际反馈

1. 首轮测试未装载：graph未配置application依赖，package-name导入失败。分类：测试装载配置缺陷。改为测试内加载现有实际application索引/评分模块；不新增依赖或生产分层边。graph noEmit通过。
2. 新核心36项35通过、1失败：隔离source append→补偿后全库精确恢复原状态，测试误断言应不同。分类：测试断言缺陷；改为隔离source必须完全等于原状态，legacy保留成绩/胶囊/源码同时允许真实task终态变化。未放宽产品校验。
3. shared/index83项81通过、2失败：旧“没有结果表”期望与R1两角色source18相冲突。index在既有授权内更新；shared先报告具体行/原hash，获root精确窄授权后只改一项标题/角色表期望，并增加18、空表、无公共结果入口，保留原14/17隔离、重开不变和无dispatch API。
4. 第一次完整12文件456项454通过、2失败：当时shared窄改尚未执行，以及capsule旧迁移清单仍为1–12、15。capsule其余hash、双写重开、prepare-only和外键断言通过；报告具体216行后等待协调窄授权，未擅改冻结文件。获明确窄授权后仅数组追加18。两项属于新增迁移语义后的旧期望，不是盲更快照或失败豁免。
5. 已验证新核心/index84/84，补异步准备/既存行忽略写及带真实材料升级后88/88；shared窄改后新核心/shared/index138/138。追加持久坏hash/payload/预算重开拒绝回归后继续最终组合复跑。

6. 第一版冻结前新核心/shared/index141/141；全部窄修正后的原12文件完整组合462/462、三个包noEmit均exit0。数量增加来自本轮新增针对损坏、purpose和角色的回归，没有删除旧测试或降低阈值。这是该版开发自测，不能代替独立验收；后续root实际反例揭示下节产品缺陷，原版未接受或集成。

## 实际覆盖与验证状态

新回归使用真实本地TS索引→原生成器题目→真实确定性评分→已保存ready材料，再构造L5候选并经真实A2 reserve/promote进入锁内append。覆盖独立source及同库legacy；同binding不同task、成功历史保留、旧失败cleanup不动新候选/slot；错purpose/global角色/身份/T1、重算外层摘要但坏criteria/evidence/limitation/UTF-16；getter不执行、caller异步变动、跨实例/重复receipt/closed；准备期间及写前第二连接变更全部捕获行；实际BEGIN BUSY、RAISE(IGNORE)、合法错payload/目标、append/补偿外层COMMIT及迁移标识/COMMIT故障。坏18对象/行不修复，实际旧双布局成绩、胶囊、binding、源码和全部旧表行保持。

## 最终实际命令与冻结

```text
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/contracts/src/ownership-semantic-result.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

第一版冻结的12文件462/462，exit0，73.40秒。以下第一版检查均exit0；退回后最新结果见下节：

```text
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json
```

349旧文件中开发仅改4个授权旧文件：index.ts的私有生命周期、index.test.ts角色期望、shared单测试窄角色期望、capsule单行迁移列表；新增核心、测试及本记录3文件。另1个计划文件变化由root明确同步，单列协调来源并排除开发patch；其余344旧文件原字节不变。AGENTS、生产shared/task/capsule、其余旧图/契约/application/LLM/desktop/UI/native/包锁/脚本及旧记录冻结不变。

精确patch从实际原副本到交付字节生成，完整before/after/unchanged和协调来源清单及所有交付hash另交root，避免文档自引用hash。未运行Git apply/check或Git写命令；实际Git反向检查及跨目录适配由root处理。原版freeze/patch/manifest保留；root退回后仅重开核心、其测试及本记录，旧349基线不重置，其余文件不动。

## root独立退回：保存来源ignoreRevision漏核

root独立原12文件462/462（76.30秒）及三个noEmit通过，但真实pre18旧库反例16/16错误接受；未接受、未集成、无Git写。授权只读的root probe及receipt已经核对：四题型×双布局×空/非空规则，正确候选prepare/append/read/failed补偿通过；把保存修订0改为候选1或保存1改为候选2，同时换taskId并重算完整L5摘要后，prepare、真实A2 reserve/promote与锁内append/read、关闭重开均错误接受。receipt确认16例均wrongRevisionRejected=false，原旧库字节保持。未在main运行或改写该probe。

分类：本轮新结果核心产品缺陷，根因已确认。relations核了ignorePolicyHash，但漏了identity.ignoreRevision与实际ready capsule.sourceIdentity.ignoreRevision等值。哈希自洽只能证明候选内容自洽，不能证明该修订来自已保存材料；旧462自测没有覆盖这个反例，不消除缺陷。

窄修仅在relations追加该保存来源修订等值检查，覆盖prepare、stored读取和migration18重开路径。不以当前workspace设置修订替代保存来源修订，不增加当前性、stop或发布许可；不改身份、源码、成绩、任务或占用。其余原授权index/shared/capsule修改保持第一版字节，contracts/application及其它生产模块冻结。

实际修复反馈：

1. 新双布局×空/非空规则回归首次在准备夹具时4项失败：给saveIgnoreSettings传相同规则不会增加revision。分类测试夹具缺陷；改为真实不同规则，使当前修订增加，保存胶囊修订保持0/1，不改生产设置语义。
2. 修正夹具后，窄修前4项均复现promise错误resolve。wrongRevision恰好等于当前workspace修订，仍应因不等于保存来源修订而拒绝。追加等值核验后4/4通过，包含正确历史读取、错候选零写及真实SQL旧错行读取/重开拒绝。
3. 扩成四题型16项后12通过、variable-flow四项在真实评分前置失败；同版完整组合474/478，失败均为该夹具。源码确认位置评分要求全部角色的证据覆盖，而夹具只选了每角色首条边。分类测试夹具缺陷；选择所有实际requirement边并保留grade.passed必须为true，没有降低评分或改题目。16/16随后通过（58项未选运行），10.79秒。
4. 每例均用真实索引/原生成器/确定评分/ready材料，正例保存ignoreRevision为0或1；实际工作区修订另增加并对同snapshot再晋升，旧正确candidate仍可读，正确保存修订的新candidate可prepare。错误candidate新taskId、完整L5重算摘要后prepare固定INVALID_RESULT且两个库不变；真实A2任务与直接SQL模拟旧错行后，read固定拒绝、重开18固定拒绝，不改成功历史、原成绩/胶囊/源码或任务/占用。测试没有把当前修订或静态DTO当作来源许可。

修正版仍运行上文同一12文件完整命令，478/478，exit0，83.39秒；新核心74项。最终graph/application/contracts三条noEmit均exit0。未删除旧测试、缩减完整组合或降低阈值。

重新冻结仍以原349文件实际备份为基线。相对上一版352冻结文件仅核心、其测试及本记录3文件变化；相对原349基线仍为4个原授权旧文件变化、1个root协调计划变化（排除开发patch）、其余344旧文件字节不变及3个新文件。旧版patch/manifest保留，重新生成完整精确patch及全部hash/清单。当前修正版明确冻结，等待root再跑原16反例；旧版开发通过或root反例不冒充修正版独立验收。

## 工程经验与未验证门

本轮无AGENTS新增规则：AGENTS冻结；跨SQLite提交边界、精确权威终态和写后目标状态核验已由既有规则及A2记录覆盖，不重复堆入新规则。过程中的测试装载/旧迁移期望只记本记录。

仅Git只读HEAD/status核对，无Git写、main访问/写入、GUI/Electron/native/build、真实HTTP、凭据/环境秘密扫描、用户授权/隐私控件操作、外部购买/发布或执行导入代码。本切片不证明发送、exact prepared许可、公开发布、当前掌握度、worker停止或统一恢复完成。交付后冻结，root独立复验和Git收尾。
