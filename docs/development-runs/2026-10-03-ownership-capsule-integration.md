# 2B-S5：所有权胶囊本地应用集成

2026-10-03。只在分配worktree实施，HEAD保持455d4ad50830ee2495b70927e51caf830a4efbb8；保留旧未提交内容，不ff/reset/Git收尾。

## 开工核对与范围

已实际读取main最新AGENTS、rubric-capsule计划S5节与当前队列。逐文件Get-FileHash核对本worktree与main的contracts/capsule、contracts/semantics、ownership/builder、graph/capsule-store、graph/index、application/index、ownership/index全部相同；不整体同步barrel、旧桌面接线或规则。application初始hash6A2D4627914F60C223420CBED2BB5044B92E547168324B49D8DF80EE555DDF83，ownership/index初始hash73315AA463EC0E5158420931F70ADACF1A360E6D84B138D0FAD3D307E9DA5F2F。

只修改application/index的本地答题编排与必要问答内存生命周期；ownership/index只追加semantic-rubric单行export；新增本批测试与记录。S3/S4/contracts/SQL/remote/IPC/UI/provider/依赖/cache/旧接线/AGENTS冻结。测试仅隔离自建TS真实索引与本地SQL，不执行样例代码，不重建native/build/dist/Electron或外发。

## 实现与验证反馈

真实四型应用红测首先实际运行，4/4失败：即时grade一致且attempt=1，但capsule=0。这是原应用缺少新保存接线的产品行为，无环境失败。

接入后的应用在首个await前检查完整plain-data描述符并私有复制submission和选中question；拒绝getter、symbol、隐藏字段、非普通原型、循环和非有限数，不能通过schema剥离字段代替捕获。生成题目存入独立内存副本，不与返回对象共享。每题占用在首个await前取得，并在finally释放；异题独立。对已失效/不存在的题目维持原快照状态诊断顺序。

真实source capture、当前快照、持久源码字符串进入S3；原submission同时交给S4 prepare。原grade及S2a规范引用索引转换保持不变。prepare后再次核验真实工作区与同一活动题目、应用关闭状态；同步S4保存完成双INSERT后才删除通过的题目。settings→source事务身份门仍由S4执行；应用保留配置修订冲突诊断。没有FS/SQL原子性承诺，最终文件检查之后的外部文件变化仍是限制。

首次21项接缝回归：S2a 16/17通过；新增四型全部完成双行保存但变成not-evaluated，见下述冻结阻碍。保留原S2a17的全部断言，没有改/删测试。

扩展回归发现两项本批产品回归，均已修正：提前schema校验使失效题目的空引用得到schema错误，恢复旧快照/题目优先诊断；引用读取期间第二连接改变配置后，prepare提前返回固定存储错误，加入prepare前及prepare失败后的配置修订核验。`node node_modules/vitest/vitest.mjs run packages/application/src/ignore-settings.test.ts packages/application/src/snapshot-result.test.ts --fileParallelism=false` 实际15/15通过。

新测试自身曾有三处缺陷：expected引用数组与调用方共享而随突变变化、UTF8预算样例先超过本地10000字符上限、错误源码表名。分别改用独立原始副本、6000个三字节字符、实际source_snapshots表。长variant真实生成样例只覆盖部分引用，原本地grade合法为失败，修正为与原grade完整相等，不改评分门槛。这些属于测试缺陷，不记录为产品修复。

第一次扩展并行回归11文件283项：269通过、14失败。其中8项S3身份阻碍、1项旧SQL消息接缝、3项上述应用诊断顺序、2项Git样例5000ms超时并伴随临时目录EBUSY。后续串行运行15项及全套均未复现Git超时/EBUSY；只确认与运行安排相关的观察，未确认资源根因，不将其定性为已解决环境问题，不修改超时门槛。

## 首版冻结阻碍（11:12授权续批前）

1. **已实际复现的S3产品接缝**：正常indexProject生成analysisIdentity.ignorePolicy={version,rules,hash}。S3 semantic-rubric.ts:63把完整ignorePolicy交给remoteAnalysisIdentitySchema，后者只接受严格的{version,hash}。因此全部真实四型都得到analysis-identity-unavailable，引用精确/空答案/晚期源码与variant预算路径在此前被遮蔽。原S3金标快照不带完整ignorePolicy，无法覆盖此输入。不能在application删掉snapshot.rules绕过：本地schema要求完整rules，分析结果fingerprint也覆盖完整identity。
2. **S4尚需核对的同一投影接缝（源码推断，未绕过S3做实验）**：ownership-capsule-store.ts:184将ready capsule.analysisIdentity与完整本地analysisIdentity比较。S3改成有限DTO投影后，此处仍需采用同一明确投影进行绑定；source capture/完整快照及事务校验必须保留完整本地身份。当前未修改或声称验证该修复。
3. **旧回归的错误语义冲突**：ownership-citation-index.test.ts:137要求实际触发器的原始“fixture insert denied”消息；已接受S4固定返回OwnershipCapsuleStoreError/所有权胶囊存储失败，不携带原SQL文本。应用无原错误材料，也不能为一个fixture硬编码/重发SQL/读取触发器文字。新测试用实际attempt INSERT与capsule INSERT故障均证明两行回滚、题目可重答；旧断言仍原样失败。需要协调方明确处理该已有测试与S4安全契约的接缝，不靠改断言报成功。

S3/S4/contracts与旧测试在本批冻结范围外，本批未修改。当前不满足ready与晚期nonnull projection端到端接受门，不能报告S5完成。

## 首版实际验证

- `node node_modules/vitest/vitest.mjs run packages/application/src packages/ownership/src packages/contracts/src/ownership-capsule.test.ts packages/contracts/src/ownership-semantics.test.ts packages/graph/src/ownership-capsule-store.test.ts --fileParallelism=false`：11文件，9通过/2失败；283项，274通过/9失败。新增32项24通过/8失败；S2a17项16通过/1失败。其他应用与所列纯builder/contracts/SQL回归文件通过。9项失败全部对应以上冻结阻碍，没有隐去失败。
- 全套后新增legacy重开capsule及掌握度断言；`node node_modules/vitest/vitest.mjs run packages/application/src/ownership-capsule.test.ts -t 'legacy source and separate settings can'`：1通过/31跳过。真实legacy source库、单项目settings库，第二settings连接BEGIN IMMEDIATE被持锁拒绝，capsule INSERT故障两行回滚，重试双行保存；重开attempt/capsule/掌握度/原源码与payload保持一致。此为not-evaluated路径，不声称ready。
- `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit`：exit0。
- `node node_modules/typescript/bin/tsc -p packages/ownership/tsconfig.json --noEmit`：exit0。

新测试覆盖首await输入/返回question突变、完整描述符拒绝、首中尾重复引用与原submission交给builder、相交引用、错误结构/越界失败attempt、空答案/孤立代理/UTF8预算、实际大源码/长variant、两INSERT故障及重试、同题占用/异题并行、prepare后close/题目替换/工作区/第二连接配置/activation变化与零写、legacy双库设置锁及保存/重开。ready/精确相交reason/晚期projection断言仍保留红态，不当作已验证成功。S2a历史payload保留、缺规范引用映射TASK_FAILED与配置切点诊断已通过。

## 首版冻结与未执行项

只修改批准四文件。生产源稳定SHA256：application/index.ts=A2ABD80A9350B42B0AA91FABA3B400E4E17684880C23A0F7A908DB245C3FCCCE；ownership/index.ts=9B4CF19572CA2C07A7F1C648F278660B2B2167C055FD923768AA3703037CD91D。新测试SHA256=3C6837CBDFAD67846C9AFD6FBE157E15DEAB8314C3182AA254D5E42B851A588F。记录自身hash由最终工具报告，避免自引用。

S3 builder仍BD96CC66FAEF1F0373F213B112BA6CC45CA140255EB76DD85F4A898F19C59165；S4仍8642D6CD55FA8417EBD11CF61C887FC873938F344682CE74DB18A4447311725B；capsule contracts仍5D1759AB29E78048A96448AD3294503F9170EA9500709B2470C3988BA4B0E44F。HEAD仍455d4ad50830ee2495b70927e51caf830a4efbb8。

没有运行native重建、build/dist、Electron/GUI、远程模型、网络、凭据操作、依赖安装或benchmark；没有提交/推送/合并、改其他checkout或覆盖旧未提交工作。开发验证不是协调方独立验收。

本轮无新增AGENTS规则：完整捕获与事务身份门已有规则；新增DTO投影接缝尚待范围外修复及验证，本批AGENTS冻结，先保留本记录证据供协调方处理，不用规则记录替代未通过的实现门。

## 11:12授权续批：两处明确身份投影

协调方已独立复现首版四型和旧SQL故障，并在主计划11:12节明确把范围从原四文件扩大为九文件。实际只读该节后继续本worktree，不reset/ff/同步其他代码。追加权限仅semantic-rubric.ts/其测试、ownership-capsule-store.ts/其测试、ownership-citation-index.test.ts；AGENTS/其他契约/迁移/graph/index/provider/IPC/UI/缓存/依赖仍冻结。

先在S4增加空规则、非空合法规则的真实SQLite保存/重开红测。测试初建有it.each数组展开与未规范化目录规则导致指纹不一致两处测试缺陷；修正为对象参数、用实际settings规范化规则计算原完整快照指纹。最终修复前实际命令 `node node_modules/vitest/vitest.mjs run packages/graph/src/ownership-capsule-store.test.ts -t '完整policy' --fileParallelism=false`：2失败/36跳过，两个完整policy与有限DTO均在prepare被OwnershipCapsuleStoreError拒绝。因此S4接缝从源码推断升级为实际SQLite失败证据。

S3只把生成的remoteAnalysisIdentity改为明确六字段：graphIrVersion、analyzerVersions、configurationHash、sourceFingerprint、ignorePolicy、analysisResult；ignorePolicy仅真实version/hash或无policy时null。S4 ready来源比较改为同一六字段投影。完整snapshot.analysisIdentity、rules、capture、analysisResult fingerprint、materialIdentity、source/current/config事务门未改。没有改schema、hash domain、版本、rubric模板、评分或分析器版本，不给投影追加本地字段。

旧S2a第137行错误期待迁移为单次实际grade失败捕获；断言OwnershipCapsuleStoreError、固定消息、有限code=INVALID_MATERIAL并明确不含fixture原SQL文本。实际触发器、零attempt、移除触发器后同题重试、规范角色索引和成功后题目不存在断言全部保留，其他16项不改。没有为适配测试外泄SQL文字或取消故障。

新增验证覆盖：S3空/非空完整policy精确DTO投影、原数据不变、policy version/hash错配拒绝；S4空/非空policy保存及重开、完整快照/源码不改写；policy version/hash、source/result/configuration摘要或captured完整rules错配，重算capsuleHash仍拒绝且两表零写；有非空policy时第二连接配置变化仍被事务门拒绝。应用增加真实索引非空排除规则的四型builder→prepare→双INSERT→重开，对原完整快照/源码逐行确认没有改写。

首次接入修正后应用新32项、旧S2a17项、SQL38项实际87/87通过；继续补充投影攻击和真实非空规则后，原首版ready、相交范围、空答案、实际晚期source/variant的非空projection红断言全部通过。ready仍只表示本地材料准备，不升级自然语言语义分或原passed。

## 续批最终验证与稳定边界

- `node node_modules/vitest/vitest.mjs run packages/application/src packages/ownership/src packages/contracts/src/ownership-capsule.test.ts packages/contracts/src/ownership-semantics.test.ts packages/graph/src/ownership-capsule-store.test.ts --fileParallelism=false`：11文件、298/298通过，exit0。新应用36项、旧S2a17项、builder27项、胶囊SQL45项全部包含。没有改测试超时门槛。
- application与graph `node node_modules/typescript/bin/tsc -p packages/<包>/tsconfig.json --noEmit` 各exit0。ownership首次noEmit发现新测试policy对象版本被推宽string（TS2322），是测试类型缺陷；给对象添加已有契约类型后ownership同命令exit0，`node node_modules/vitest/vitest.mjs run packages/ownership/src/semantic-rubric.test.ts --fileParallelism=false` 实际27/27再次通过。最后变更仅此测试类型注解和本记录，无生产行为变化。
- 相对主已接受S3/S4实际diff核对：S3一处明确投影（两行替换一行）；S4一处来源比较投影；旧S2a仅错误期待块变化。application/ownership两个index生产hash与首版冻结一致；graph/index及两契约源hash未变。

九文件即本批最终稳定边界，后续没有继续修改生产源或测试的计划；协调方独立验收前不宣称已接受。前面的失败和首版hash是历史切片，不代表本次最终结果。

| 文件（仓库相对路径） | 最终SHA256 |
| --- | --- |
| packages/application/src/index.ts | A2ABD80A9350B42B0AA91FABA3B400E4E17684880C23A0F7A908DB245C3FCCCE |
| packages/ownership/src/index.ts | 9B4CF19572CA2C07A7F1C648F278660B2B2167C055FD923768AA3703037CD91D |
| packages/application/src/ownership-capsule.test.ts | 541177795877635F1F5E61968F3406E5057CC4ABD90C3D7EDA8974BD1914D8BA |
| packages/ownership/src/semantic-rubric.ts | 3D44AF48E50E0E86246E143CFA4F7730549559AB3152CC7C25B12FA6DE35A47D |
| packages/ownership/src/semantic-rubric.test.ts | 6179A568E312C674A30EC9E876B9BFCDD7DFC9E65458BE336B5EABEA1E9A1767 |
| packages/graph/src/ownership-capsule-store.ts | D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE |
| packages/graph/src/ownership-capsule-store.test.ts | 5F594D27144E09FE609A1D7C891416771D9D3ABEAC4D37075AA144B120E8AF10 |
| packages/application/src/ownership-citation-index.test.ts | DC896281424BC945AD0E3F1F72BA6213514EAD5F222F3218C827396AF0CA3ECA |

记录自身最终hash见最终工具/交付报告；记录不存自身hash。HEAD仍455d4ad50830ee2495b70927e51caf830a4efbb8，未执行Git收尾，保留旧未提交内容。未运行native/build/dist/Electron/GUI/benchmark/网络、未外发或接模型，未修改其他checkout。

本轮未新增AGENTS规则；供协调方评估的候选：本地完整身份转换为strict有限DTO时，上下游必须采用同一明确字段投影；用真实索引快照（含空/非空配置）覆盖生成、持久化与重开，并检查完整规则/指纹不变及重算摘要后的错配仍被拒绝。该候选已有本轮S3实际索引与S4 SQLite红→绿证据，本批不自行写AGENTS。
