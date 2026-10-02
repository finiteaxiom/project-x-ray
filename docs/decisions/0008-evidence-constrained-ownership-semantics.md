# ADR-0008：受证据约束的所有权语义评估

状态：**2026-10-02 协调方修订后接受设计；实施仅限另行派发的精确切片，非运行质量证明**

日期：2026-10-02

源码核对基线：`455d4ad50830ee2495b70927e51caf830a4efbb8`，含未集成的桌面接线；本批不改这些文件。
范围：Windows、V1 所有权模式的提交后语义反馈；不新增代码生成、运行时追踪或自动修复能力。

## 现状与具体缺口

本 checkout 的事实依据：

- `packages/ownership/src/index.ts` 的 `gradeAnswer` 以验证后的引用及服务端确定性规则计算 location、structure、passed；自由文本仅为学习记录，semantic 固定 `not-evaluated`。调用路径把完整合法节点路径与同位置边路径配对，任一完整证据路径可通过，不接受混拼。
- `packages/contracts/src/index.ts` 的 `ownershipPromptSchema` 隐藏 evidenceIds、expectedNodeIds、deterministicChecks；`ownershipGradeSchema` 只允许 `semantic.status:"not-evaluated"`。Attempt保存semanticText及确定性成绩，没有完整question/rubric。当前题目版本2.0.0、确定性评分版本2.1.0。
- `packages/application/src/index.ts` 的 `gradeOwnershipAnswer` 校验当前工作区、排除配置和源码引用，追加attempt；passed后删除内存question。`getOwnershipProgress`依据本快照attempt.passed得出概念状态，不评自由文本。
- `packages/graph/src/index.ts` 的attempt写入与legacy mastery兼容读取，以及[ADR-0006](0006-trustworthy-language-facts-and-ownership-training.md)，要求旧记录保持原样。[ADR-0007](0007-evidence-constrained-remote-explanations.md)只先支持功能解释；当前 `remotePurposeSchema` 是字面量 `feature-explanation`，六类披露不包含用户答案。

因此不能把解释claims当评分，不能把feature授权视为评分授权，也不能在passed删除question后靠重新出题复原当次内部标准。需要单独、版本化、追加式语义评估通道和提交时的受限rubric胶囊。主近期接受的semantic语料不在本checkout，本草案不宣称读取或执行过该语料。

## 拟议决策：原评分不变，附加评估独立

1. 现有grade API和Attempt语义保持：离线、无模型、未授权、失败/取消或无可评分证据时，自由文本始终 `not-evaluated`。旧grade响应的semantic字段不改成成功；远程结果通过新sidecar接口显示“模型辅助语义反馈”。
2. 不改写locationScore、structureScore、passed或mastery；模型不能给这些字段赋值，不能使解释正确但缺引用的答案通过。确定性passed也只证明定位/结构，不能显示为已经证明自由文本正确。
3. sidecar可记录独立 `evaluationStatus:"evaluated"` 和逐criterion `supported | contradicted | insufficient`。结论一律为辅助推断，不产生verified节点/边/题目事实；源码证明的confidence保持原值，unknown不升级。
4. rubric为本地规则生成，明确学习目标、待检验命题、合法证据集与未知边界，不能由模型修改。条件全部可评时，本地按预先冻结整数权重求辅助分；有任一insufficient则辅助总分null，不把未知当0分。此分只存在sidecar，必须标“辅助语义分”，不进入现有passed/mastery统计，不提供一个模糊总通过状态。
5. 未提交前不生成或暴露内部rubric预览、参考命题和补救证据。提交后的远程预览不额外揭示全部其他题的答案；现有确定性评分提交后揭示机制不变。

## 独立授权、披露与数据最小化

拟议purpose固定为 `ownership-semantic-assessment`，disclosure版本独立从 `ownership-semantics/1.0.0` 起。全局库新增独立授权记录，键为repositoryId/provider/purpose/disclosureVersion，默认denied；既有解释授权表及scope不升级、不推导、不自动复制grant。题目生成、提交本地评分、配置模型、看到某个attempt都不构成发送授权。

逐项目授权前展示固定类别及实际请求预览：**用户答案文本**、该attempt结构化答案和验证后的引用、题面/学习目标、受限内部rubric、最小源码片段、相对路径/符号及分析器/快照/置信度/遗漏身份。答案可能包含用户另写的秘密或第三方资料，必须明确披露；没有自动扫描并保证“已脱敏”的承诺。请求构造器不从应用凭据来源加入API key或Git凭据到正文，不加入绝对项目根路径、自信度、其他尝试/其他用户资料、整文件、全仓图、旧会话。此结构隔离不等于能识别并剔除用户答案或源码中的任意秘密；实际最小正文仍须用户审阅。

授权和每次发送是两个动作：prepare零网络；grant改变独立revision，使旧preview无效，需要重新prepare；用户检查完整出站体后手动start。撤销只影响该purpose及其任务，解释授权保持独立；共享provider/credential修订变化则同时使两类任务失效。provider或披露/purpose版本变更需重新选择，model变更使预览失效并重新审阅，不自动发送。撤销不能收回已发字节或服务端计算。

拟议预算采用不高于ADR0007的边界：完整请求≤64KiB、响应≤256KiB、最小源码≤24KiB，proof≤24、node≤24、edge≤40、limitations≤24，片段≤40行/4KiB；criteria≤8、claims≤12、每项证据/限制引用分别≤8、输出文本≤1200字符/4800字节。答案额外≤16KiB UTF-8；本地现有10000字符允许上限不缩小，超远程预算仅拒绝语义发送，保留本地attempt。**答案、必要rubric与完整所选路径证据不得静默裁剪**；任一不足则EVIDENCE_INSUFFICIENT/LIMIT_EXCEEDED，保留not-evaluated。网络60秒、任务总90秒、同一provider两purpose合计最多1个inflight，窗口两类任务合计20条无正文元数据；无自动重试。数值为草案，实施前需核对最终契约与实际请求预算。

## Rubric胶囊与证据包

本地提交验证成功、即将追加attempt时，同一source事务追加 `ownership_semantic_capsules`：attemptId、questionId/version、题面/学习目标/variantKey及questionFingerprint、deterministicScoringVersion、rubricVersion/hash、答案hash与结构/引用hash、最小criterion描述、绑定的证据ID/完整边序列、analysis/config/ignore身份。答案原文继续只在已有attempt；胶囊不复制整文件或完整Graph IR，证据原文从同快照不可变源码按准确半开范围读取。胶囊是内部、提交后材料，不回传到出题Prompt。attempt与胶囊写入失败全部回滚，不让本地成绩因远程不可用而消失；若旧attempt没有胶囊则只显示未评估，不事后重构参考答案或回填旧attempt。

远程未配置/未授权不阻止上述纯本地保存；必要rubric超预算时保存本地attempt及有界“不具备语义评估条件”元数据，不尝试生成外发包。数据库提交失败是本地固定失败，安全重试不能产生半个attempt。现有attemptId由snapshot/question/时间形成；新胶囊写入必须核对实际保存attempt的完整hash，同ID不同答案/成绩应拒绝冲突。当前GraphStore使用普通INSERT，保持其同ID冲突拒绝语义，不能在后续改成INSERT OR IGNORE后把新答案胶囊附到旧attempt。

最小rubric按现有题型生成：definition核验定义及其静态职责说明；call-direction核验谁调用谁及对应表达式；call-path核验用户提交的一条完整合法节点/边路径及每一步静态解释；variable-flow核验引用处读/写/返回角色及其解释。不能只收集同名符号或把全部alternatives混成一条路径。重复节点序列不同调用位置须按完整边序列配对；选择一条由用户引用完整支持的合法路径，用稳定顺序消除同等候选歧义。无法代表必要标准/合法所选路径时不发送，不以首条路径否定另一完整合法路径。其它合法路径可作为不冲突说明；未入包或静态unknown的行为只能标insufficient，不推断必然运行时效果。

criterion必须包含有限ID、局部命题与expectedEvidenceIds、可用答案字符范围（由本地答案编码确定，不靠模型制造索引）、权重、允许的结论及限制；rubricHash覆盖全部criteria、边序列、权重与版本。给模型的是已提交答案对应的最小评分依据，不是无限扩展检索工具。评估只回应这些criterion，不提出任意文件读取/命令执行。

**call-path评估资格先于模型。** 必须找到与提交nodeIds一致、且用户验证引用完整覆盖同一合法edgeIds序列的路径；没有完整序列（包括缺步骤、混拼、缺必要边证据）时，整题语义为“不具备评估条件”、not-evaluated、零发送，保留本地失败attempt。不能拆出零散“包内可支持命题”来绕过该资格门；另建独立criterion评估失败路径不在当前草案范围。

**限制字典。** rubric及assessment package携带同一个本地生成的有限 `limitations[]`，每项为 `{limitationId, code, criterionIds[], relatedEvidenceIds[], description}`。code仅限 `static-only`、`unresolved-dynamic-behavior`、`evidence-scope-insufficient`、`answer-information-insufficient`；前三种根据本地已索引限制与本题证据范围生成，最后一种为每个criterion预定义的“答案未提供足够明确解释”评估条件，不声称已由静态检查证明答案语义不足。动态限制只能在相关实际unknown存在时加入；不得为无合法路径添加限制以允许发送。limitationId是规范化 `{rubricVersion,code,排序后criterionIds,排序后relatedEvidenceIds,description}` 的SHA-256；稳定内容得到稳定ID，内容变化改变rubricHash/packageId。rubric每个criterion显式保存 `allowedLimitationIds[]`（最多8），它们必须存在字典且列出该criterion；包与rubric字典及允许集不一致即拒绝prepare。description受同一1200字符/4800字节预算，字典最多24项，不裁剪必需项。限制是本地条件/不确定性元数据，**不是源码proof，不拥有verified置信度**；relatedEvidenceIds也不能替代输出evidenceIds。模型只能引用既有ID，不能新增限制或从explanation文字中解析出ID。

## 输出结构与本地拒绝门

拟议strict输出仅含 `version, assessmentPackageId, criteria[]`，每个criterion的全部必需字段是：`criterionId, verdict, explanation, evidenceIds[], limitationIds[], answerRanges[]`。limitationIds只能引用上述字典，禁止从自然语言explanation推断字段。绑定的其余身份由本地captured identity封装，模型不能写provider/attempt/权威task状态、分数、passed、mastery、节点或confidence。所有对象拒绝未知字段；exact criteria集合必须恰好出现一次，不可遗漏/重复/增项；总字节、文本、引用及答案范围均受限。

supported/contradicted的evidenceIds为1–8个**本criterion允许**的包内证据，answerRanges为1–8个实际非空范围，limitationIds必须为空。insufficient的limitationIds为1–8个本criterion allowedLimitationIds中的ID，evidenceIds和answerRanges各允许0–8项；非空项仍全部核对各自归属与范围。空答案范围可用于未表达相关命题的情况，不能制造答案位置。所有ID数组要求唯一，重复或未知/跨criterion ID拒绝整个输出，不把限制ID当证据ID。除此之外本地核对快照、源码hash/range及答案UTF-16字符范围（不得切开代理对），不接受出站范围以外的行号。contradicted只能说明包内证据支持的矛盾；“静态无法证明”不是反证。模型选择 `answer-information-insufficient` 是辅助语义判断；成员/范围校验不能证明其判断正确。有效模型结果仍是inferred辅助反馈。

纯验证器在任何持久化/显示前执行；invalid JSON/schema、未知ID、跨criterion借证/限制、伪造源码、答案范围非法、企图写分数/verified、工具调用、拒绝/不完整/多段冲突输出或旧绑定均失败关闭。可证明的凭据边界是构造器只使用规定数据来源、请求/输出结构不允许credential/apiKey/gitCredential等额外字段、应用API key只交给固定传输的认证header而不加入评分正文，header、出站body、原始响应和任意异常文本不保存到DB或日志。自由文本中的任意秘密不能由strict schema识别；不承诺通用“凭据泄露检测”，不因验证输出而额外读取/扫描OS、Git或Codex凭据。既有传输若有当前请求已持有key的精确字符串检查，其覆盖也仅是该已知字符串，不作为任意秘密不泄露的证明。本草案不新增启发式秘密扫描器。首个传输可复用经审查的固定Responses网络/大小/取消机制，但语义schema与prompt是独立适配器；当前远程解释schema不能直接接受评分结果。官方接口兼容性、模型质量及真实服务尚未核对，不能从本草案或原解释测试推出。

## 捕获身份、当前性与任务协议

每个main注册task/context/preview UUID绑定owning window/session/epoch；renderer只传ref、已提交attemptId、previewId/packageId，不可指定owner、rubric、endpoint或任务UUID。capture至少含：

`repositoryId, snapshotId, activation, analysisResultFingerprint, sourceManifestHash, configurationHash, ignorePolicyHash, ignoreRevision, questionId, questionVersion, questionFingerprint, attemptId, attemptHash, deterministicScoringVersion, rubricVersion, rubricHash, semanticProtocolVersion, semanticScoringVersion, purpose, disclosureVersion, authorizationRevision, provider/model/revision, credentialRevision, contextHandle/epoch/ownerSessionId, taskId, assessmentPackageId, bodyDigest, limitsVersion`。

attemptHash覆盖原始semanticText、结构化答案、验证引用和原确定性成绩；问题/题目版本/同snapshot新activation/配置修订变更均不能沿用旧结果。prepare、start前后工作区校验、同步dispatch与publish分别重读数据库，不依赖worker缓存current。引用旧快照可供历史阅读但不再次发送或认定当前掌握；重新索引或A→B→A需新context及新attempt。旧completed语义记录保留，展示当前状态前重新验证；历史显示必须明确checkedAt、snapshot与当前性。

锁序保持 global policy→project settings→source/legacy（需时），不在SQL事务内await。main先关入口/旧事件gate，再同步IMMEDIATE提交上下文或独立授权变更，busy≤250ms；失败保持关闭并终止对应worker，不能放行评分或索引。同步dispatch许可核验与单inflight登记处于同锁段，传输只同步发起一次；取消只能尽力停止先前已获许可请求。

task元数据与语义结果分离。终态/幂等：同task最多一次结果与terminal；同attempt+rubric+captured版本已有completed时本地返回现有记录、不再dispatch；进行中重复start BUSY/返回既有句柄（实施冻结时择一，不可双发），preview一次消耗。手动重试需要新preview、新task和明确再次发送，不能对已completed同绑定自动重复收费。终态未发布/补偿异常仍占用，错误不能掩盖cleanup失败。

跨库发布按ADR0007已验证原则：source先append验证结果，global权威task completed是可读成功门；权威提交失败只按精确已知identity/已知库补偿非成功结果，completed历史不删。退出恢复先终止旧worker，unfinished标interrupted；未知遗留publication在权威未成功时不可读，不扫描任意库“修复”。取消/撤销/新generation/错误窗口/错身份/迟到回复不可写新成功或复活旧任务。收到实际有序的dispatched→terminal，即使DB已到terminal也按稳定identity与sequence核对；terminal/current row及已发布result必须一致，不补造阶段。这继承冻结接线的已复现时序边界，不代表该接线已集成。

## 持久化、版本与兼容

建议新增独立文件/表而非扩展旧解释授权和claims：global `ownership_semantic_authorizations`、任务策略元数据；source/project或legacy `ownership_semantic_capsules`、`ownership_semantic_results`。任务可共用受purpose区分的统一lease，但不得创建各purpose各1个独立lease从而翻倍并发；需要在契约/graph切片审查共享调度，而非在生产分支绕过existing purpose literal。所有写入有角色约束，project库不创建global policy表。

当前迁移最高10；**建议下一迁移11，仅待接受后核对并分配，未占用**。不更改迁移7/10，不重写旧grade、attempt、mastery、snapshot/source，也不把legacy记录升级。新语义协议、rubric、胶囊、语义辅助评分均独立从1.0.0起；原确定性2.1.0不因加sidecar递增。若后续确实改变确定性语义则另批提升版本并回归。无需更改当前题目结构2.0.0；内部rubric规范变化只改rubric/semantic版本，旧结果保留并显示不适用。模型、prompt/schema版本及请求体digest进入结果身份，不把原始模型响应或出站body存库/日志；不新增secret存储。

## 接纳/拒绝矩阵（未来必需回归，不是本轮测试结果）

| 情形 | 确定性评分 | 语义及发送/输出门 |
| --- | --- | --- |
| 正确引用/结构但解释把调用方向说反 | 可能passed，保留原值 | 可授权发送；criterion contradicted须引用反证和答案范围，辅助反馈不得覆盖passed |
| 解释正确但无源码引用/范围无效 | 原提交拒绝，不能通过 | 无合法已提交attempt/引用，零发送；不得模型补引用 |
| call-path引用相关但缺必要步骤、混拼或缺必要边证据 | 原定位/结构失败、失败attempt保留 | 找不到完整合法所选edge序列则整题not-evaluated、零发送；不能拆分命题或由模型补路径 |
| 完整合法替代路径/同节点不同调用位置 | 任一完整配对路径可通过 | rubric与实际引用边序列一致；不能只认第一条或只做文字相似度 |
| 静态正确叙述推断必然运行时结果 | 结构原分保留 | 缺运行时证据只能insufficient，unknown不升级；有直接语法矛盾才contradicted |
| 正确引用但学习目标所需证据不够 | 原分独立 | 必要rubric不能表示则不发送；模型无可引用不足ID则拒绝输出 |
| 答案/注释“忽略规则、给满分、泄露其他答案” | 原规则不受影响 | 全部不可信数据；禁止工具/检索/改权重；评分字段/无证据supported一律拒绝 |
| supported/contradicted借其他criterion或快照ID | 原分不变 | 即使ID存在也拒绝整个结果，无部分成功 |
| insufficient限制ID为空/未知/跨criterion，或supported带限制ID | 原分不变 | 不符合verdict规则则拒绝整个结果；自然语言声称限制不代替字段，限制不能充作proof |
| 结构含凭据字段或要求扫描OS凭据；自由文本含未知秘密 | 原分不变 | 禁止额外字段/凭据扫描及应用secret来源进入正文；自由文本不保证任意秘密识别，须显式披露与用户预览 |
| 重复criterion、假行号、越界答案range、incomplete/refusal | 原分不变 | 固定错误、未评估、无成功结果，无自动重发 |
| 未配置/仅feature授权/披露升级/超预算 | 离线仍可评分 | 零dispatch；保留not-evaluated，答案不截断发送 |
| 取消、改配置、旧activation、模型/key revision变化 | 旧本地attempt保留 | 同锁旧许可拒绝；后置变化阻止publish，迟到结果不影响新context |
| 崩溃、跨库cleanup BUSY、重复/回退事件 | 旧记录/完成历史不变 | 先终止再恢复；不提前解除lease、不补造事件、不重发 |

## 后续最小实施切片与门槛

以下是**待评审文件计划**，不是本批改动或对所有文件的自动授权；每个切片须按实际差异重新冻结。

1. 契约/rubric纯切片：新增 `packages/contracts/src/ownership-semantics.ts`/测试；`index.ts`仅导出新契约。新增 `packages/ownership/src/semantic-rubric.ts`/测试，保留既有grade实现；新增 `packages/llm/src/ownership-semantic-validation.ts`/测试及独立提示/输出schema适配器。先证明矩阵、预算、精确引用、路径配对、提示注入及评分不可写，不接网络。
2. 持久化/application切片：新增 `packages/graph/src/ownership-semantics-store.ts`/测试，`graph/src/index.ts`只加经核对迁移/窄端口；新增 `packages/application/src/ownership-semantics.ts`/测试，`application/src/index.ts`只在本地提交原子保存胶囊并导出/工厂。补真实两SQLite连接配置/授权/current竞争、attempt+capsule原子性、重复start、跨库发布/cleanup失败、legacy/历史不改写；确定性grade/进度全回归。
3. desktop窄接线：接受前重新核对 explanation worker/broker集成及单lease端口；预计修改 `explanation-worker-runtime.ts`、`explanation-broker.ts`、`main.ts`、`preload.ts`与测试，仅为新purpose独立入口/授权和同provider共享调度，不增任意invoke；必要contracts desktop文件另列并冻结。原生凭据adapter不变、无需新增第三方runtime依赖。正常构建/真实artifact测试由协调方单窗口，不复用无连接的fixture计数证明OS/HTTP。
4. UI切片：`components/OwnershipWorkspace.tsx`/测试、`state/ownership-sessions.ts`/测试及必要`App.tsx`/测试；显示原确定性成绩与独立not-evaluated/辅助反馈，提交后预览与独立项目授权，不提前泄露，A→B→A/重新索引隔离。用户隐私选择/key录入须按当前授权边界处理。真实Electron IPC/GUI、未配置生产、真实服务schema/质量与成本验收分别保留，不以替身通过关闭真实门。

基础依赖仅现有contracts/ownership/graph/application/llm，provider无关的核心端口；无需新第三方包。契约/rubric必须先冻结，持久化实现须等ADR接受与迁移号确认，desktop须等现有安全接线集成，UI须等真实可调用接口，真实服务须有明确项目外发与费用/凭据授权。主已接受语料未来先带入并核对实际文件/金标，不宣称本轮跑过；静态golden与人工审阅的语义标注分开记录，真实模型结果与可重复注入协议测试也分开记录。

## 未验证与实施前复核

本轮只做源码/契约一致性设计核对，未新增评分实现、迁移或模型测试。跨purpose共享lease与任务调度、持久胶囊接口、实际rubric最小性/语义标注质量、模型支持/成本及真实服务稳定性均未验证。协调方接受辅助分仅sidecar且不进入passed/mastery的展示政策；本地胶囊遵循对应attempt的既有数据保留与显式删除边界，不新增自动清理或隐私外发。迁移11仍为候选，持久化实施前重新核对分配；每项目独立授权文案及完整预览须在对应UI切片独立审查，不预先替用户选择。后续每切片精确文件边界另外派发。上述安排不放宽确定性或隐私门禁。
