# 2D-Q2 本地语义准备与同步当前性屏障

2026-10-05，开发-Sol，5170 独立 checkout。仅实施 [Q2 派发](../plans/2026-10-05-ownership-semantic-currentness-implementation.md)，属于原第二批；不进入第五批。Git HEAD 为 `455d4ad50830ee2495b70927e51caf830a4efbb8`，没有提交、推送或合并。既有未提交工作保持原状。

## 行为和证据边界

- XRayApplication 无参内部工厂固定接入真实 store 映射、getSnapshotState、主活跃代数和已接受 compiled LLM adapter。请求只接受既有五字段，首次等待前私有捕获；proxy、getter、隐藏字段及额外 DTO 不成为权限。
- 两次真实工作区检查之间，在单个同步 SQLite 视图中捕获完整原题 binding、截点历史、attempt、ready capsule、query 表、snapshot/source/manifest 和恢复的原 submissionProjection；既有 generator、摘要及异步 package validator 实际执行。返回准备对象前重新读取完整 canonical preimages。历史 load 仍是 prepare-only/not-checked，不升级旧评分或回填缺失材料。
- source 私有 WeakMap 保存 PreparedSemanticBinding，精确绑定三个角色的实际实例、主 generation、activation、配置修订、完整 context owner/handle/epoch/reference、独立 semantic policy 和 provider/model/output/credential 状态代数。默认拒绝未授权及未配置；feature grant 不适用，不读 OS 凭据。
- adapterRequestDigest 对真实完整 serializedRequest 的 UTF-8 字节计算，包含 systemInstructions、responseSchema 和 data。保留原 65,536 字节门，不裁剪答案、角色或相对路径；没有 semantic HTTP transport，不构造 taskId 或 HTTP bodyDigest。
- 最终锁序为 authority IMMEDIATE → settings.withIgnoreRevision → source IMMEDIATE。锁内重读完整材料及所有状态；临时 revision receipt 与 prepared 对象不同，只能在该 callback 内消费一次，finally 撤销。拒绝 Promise/thenable、未消费、异常、重放、跨实例和 close；拒绝原生 rejected Promise 时实际挂接拒绝处理，不执行返回对象的 then/getter。legacy 同连接为嵌套 savepoint，不声称跨库原子性。
- App 单准备槽支持替换、AbortSignal、有限超时和 close 清理。任何路径均不创建 semantic task、占用、result、registerDispatch 或网络许可。

## 实现 → 失败诊断 → 修正 → 再验证

1. 初次新测试 20 项，19 通过，默认未授权一项失败：返回 INVALID_MATERIAL 而非 NOT_AUTHORIZED。已确认产品接缝缺陷：旧 feature remote.immediate 将新的 semantic 错误归一为 POLICY_INVALID。未改旧 remote 模块；在授权 graph/index 接缝使用实际 global SQLite IMMEDIATE，保留 semantic 固定诊断。相同 20 项随后通过。
2. 扩展 58 项中两项配置竞争失败，56 项通过。已确认测试缺陷：保存相同 ignore 规则是合法 no-op，没有产生修订。改为第二真实连接修改再恢复原规则，断言 revision 增加 2；原行为及断言的拒旧准备要求不变，针对性两项通过。
3. application noEmit 暴露测试中重复 language 属性，属于测试代码缺陷；删除重复属性后类型检查通过，没有产品行为变化。
4. 原 oversized-answer 测试停在 capsule 答案预算，不能证明 adapter 边界，已更名明确其作用。新预算夹具最初超出 node 名称/证据列表限制，又误要求未覆盖全部返回读取证据的原 location 分数通过；均为测试构造缺陷。改用八个真实合法引用、受限名称及 Unicode 相对元数据，保留原部分 location 分数，先确认实际 SQL package 为 ready，再以合法字符/字节范围内的完整答卷使 adapter 正文越界。实际 compiled adapter 和整条准备路径均返回 REQUEST_TOO_LARGE，原答案及 SQL 行不变。没有降低产品预算或评分要求。
5. 真实 adapter 完成后仅延迟其返回的两项测试，确认 provider/context 变更再恢复仍拒绝旧准备；故障注入只控制真实返回时点，不伪造成功 validator 或 adapter 结果。

## 实际验证

最终以下命令退出 0：13 文件、443 项通过，其中新增准备测试 65 项。单 worker，无文件并行、无 cache；不是全仓测试。

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/ownership/src/index.test.ts packages/application/src/ownership-capsule.test.ts packages/application/src/index.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/remote-explanation.test.ts packages/llm/src/ownership-semantic-prompt.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/ownership/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/llm/tsconfig.json
```

五条 noEmit 各退出 0。完整回归后仅补全本记录和生成交付清单；实现未再改变，不重复无变化全量测试。

新测试覆盖四题型 × legacy/project × 空/非空 ignore 的 16 个真实索引、可信发题、保存、adapter 和一次消费流程；全表行前后相同。另含请求迟到修改、配置/授权/provider/context 回退、同 ID 再晋升、主 A→B→A、同长源码及 query/binding/完整重算答案摘要篡改、跨实例/clone/重开、缺 binding/unavailable/not-evaluated、receipt 重放/逃逸、then/getter/proxy、异常/未消费、取消/超时/替换/关闭及预算失败。第二 SQLite 连接在三个实际锁段挑战 BEGIN IMMEDIATE，确认 BUSY 和 global/settings/source 顺序；结束后连接可重新取锁。

## 冻结及未验证项

正式基线在 accepted adapter 三文件同步并核对 hash 后保存，含 331 个既有文件及九个允许旧文件原字节；此前预依赖备份和 Q1 两次冻结证据均保留。相对正式基线只改 application/index、graph/index、capsule store、binding store 四个既有文件；新增两个准备模块及对应测试和本记录。其余 327 个原文件逐一 hash 不变，包含 frozen LLM/contracts/ownership、旧 remote/S2/共享任务、AGENTS、cache/broker/desktop/UI、包锁及旧记录。交付 patch 基于实际原字节，不基于 HEAD 或整份 WIP 差异。

本地验证不等于 root 独立验收；未操作真实 Electron、GUI、隐私控件或用户政策，没有网络、导入项目执行、build/native/dist 或跨 checkout 操作。文件系统不受 SQL 锁冻结，两次工作区检查也不保证未来 HTTP 期间源码不变。semantic transport、实际 bodyDigest、发送/发布复核、durable reserve、恢复及 UI 门仍未实施或验收。

AGENTS 新增/修订 0：本批明确冻结规则文件；完整材料、固定诊断、事务内重核及私有凭据边界已有规则覆盖。测试夹具构造问题仅记录于本文件，没有证据支持新增一般规则。过程记录与测试不能替代独立审查或实际界面验收。

## Root 首冻结审查反馈与修正

首冻结 patch SHA `3CA29B8B8FBFD76D28573B637C14C3B65A73F83E6899C00F3B9097BF759F1B02`、manifest SHA `4302EDF68F09FE2B96AF10B199D7138A73509937FE7C231AEC49232A3BCAA59A` 保留为 v1。root 独立 443 项、五包类型和双布局请求/TTL/取消探针通过，但额外真实探针确认下述产品缺陷，首冻结未接受、未提交；之前通过的测试不构成该入口验收。

复现条件：watcher 应用先启动，projectDatabaseRoot 尚为空；另一 builder 应用在自有夹具目录真实索引、可信保存 call-direction 答卷并关闭。watcher 通过 getSnapshotState 懒载晚出现的数据库，再 indexProject 激活；真实配置、独立政策和 context 合法时准备仍返回 NOT_CONFIGURED。根因确认：四处旧惰性 GraphStore 构造只带 ownershipGenerator，遗漏固定 semanticPorts。它们分别位于 requireNavigation、旧 remote 的 currentReference 枚举闭包、requireSnapshot 和 requireStore；普通启动扫描及新建项目构造已经接线，所以原矩阵未覆盖缺陷。

本轮只改原 application/index 四处构造参数、新 preparation 测试及本记录。所有应用实际创建的 GraphStore 现在均接同一构造期固定端口；不在每请求注入回调，不更换已经懒载的实例，不修改导航缓存、迁移或旧 remote 实现。

新增四项实际晚出现数据库测试：分别走 getSnapshotState、getEvidence、原 currentReference 枚举闭包和 findEvidence，激活前后断言同一实际 source 实例，真实 prepare/consume 成功且全表行不变。修正前针对性命令四项失败、63 项跳过，修正后四项通过、63 项跳过。另新增默认未授权/未配置、close 和主 A→B→A 拒绝三项回归；没有放宽原门。

```powershell
./node_modules/.bin/vitest.CMD run packages/application/src/ownership-semantic-preparation.test.ts -t 'late database' --maxWorkers=1 --no-file-parallelism --no-cache
```

修正版按上方同一 13 文件完整回归命令再验证：450 项通过、退出 0，其中新准备测试共 72 项；五包同一 noEmit 命令各退出 0。另因触及惰性导航入口，实际执行下列专项：43 项通过、退出 0。合计 14 文件、493 项，不包含此前针对性重复执行。

```powershell
./node_modules/.bin/vitest.CMD run packages/application/src/navigation-cache.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

验证后实现不再改变，仅完善记录并重冻。继续以同一原 331 文件字节基线生成完整补丁，非允许文件零变化；相对首冻结只改上述三个文件。没有 Git 写操作、GUI、重型命令、外发或跨目录写入。AGENTS 仍新增/修订 0，待 root 独立复验后决定接受与集成。
