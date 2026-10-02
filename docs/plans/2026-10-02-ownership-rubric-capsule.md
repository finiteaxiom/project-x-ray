# 2B-S2：本地有限rubric与提交胶囊设计

状态：修订设计已接受；2026-10-02 23:25 S3纯builder独立复验并集成1da4d81，S2a已接受0eef658。现派S4窄SQL端口，S5应用集成尚未派。本文件的后续设计不代表实现验收。

## 范围与基线

worktree HEAD为`455d4ad50830ee2495b70927e51caf830a4efbb8`，保留全部未提交接线及startup改动；未ff/reset。读取主checkout的`docs/plans/2026-10-02-non-gui-continuation.md`最新14:53派发节核对范围，但未读取、运行主独有116项语料，不声称基线对齐。此轮只新增本计划及`docs/development-runs/2026-10-02-ownership-rubric-capsule-design.md`。

实施目标仅为本地提交后内部学习标准与持久胶囊，沿用已接受ADR0008及纯契约`ownership-semantics.ts`。不改确定性question 2.0.0、scoring 2.1.0、grade、passed、mastery，不增加评分API、purpose授权、provider、IPC、UI或模型结果。没有钥匙/网络仍可构造和保存。迁移编号仅实施前协调分配，本设计不占11。

## 实际源码与缺口

- 实际函数名为`createQuestions`，不是generateQuestions（ownership/index.ts:4–24）。四型依次从verified CALLS、配对legalNodePaths/legalEdgePaths、变量WRITES/READS/RETURNS、DEFINES生成；题目只包含有限静态事实，没有任意职责、运行时顺序或完整数据流保证。
- `gradeAnswer`（:26–60）分别核验选中定义、调用方向、完整合法调用路径和引用角色；路径评分检验任一完整配对边序列，部分路径按最佳覆盖记录位置分，不能拿其best路径充作语义完整路径。变量位置分当前汇总全部候选边证据，结构分只要求每个角色有一个匹配引用，本设计不改变这个差异。
- application/index.ts:325–339：捕获settingsRevision→await getSnapshotState→核对policy→获取内存题目→验证引用→grade→创建attempt→持锁保存→passed删题。失败attempt保留可重答。构造胶囊必须发生在题目仍存在、成绩已产生而事务尚未开始时；题目只能在两者写入成功后按旧条件删除。
- `validateCitations`（:453–462）要求当前proof与所选范围相交并去重；它不要求用户范围精确等于proof。`submission.structuredAnswer.roles[].citationIndex`指向原submission.citations，attempt.citations则为去重后的grade.validatedCitations。禁止把两个索引空间视为同一数组。
- 协调方在main `7a9f81b`以真实XRayApplication索引自建TypeScript样例复现：四引用`[write,write,read,return]`、role索引`[0,2,3]`本地passed；保存三引用后read索引2指向return，return索引3越界，重开仍存在。脚本`.benchmarks/remote-desktop-review-20261002/ownership-citation-index.ts`断言确认缺陷exit0。这是当前持久化记录的角色错位，不只是新DTO兼容缺口；原评分此例正确。本设计未运行该脚本，以下修正仍待具体授权。
- graph/index.ts:540普通INSERT保存attempt；重复主键当前失败，没有INSERT IGNORE。attempt不存题目/规则，passed后无法还原当次标准。`:223`的withIgnoreRevision用IMMEDIATE持有配置锁；legacy source与settings可在不同库。
- 已接受纯包要求strict字段、1–8criteria、每criterion必需/允许证据1–8、完整selectedPath、精确citation/proof span、UTF16答案范围和稳定hash（contracts/ownership-semantics.ts:7–34、85以后）。它只检查给定DTO闭包，不证明权威question/attempt或真实源码。本切片补这些本地绑定，不能调用现有feature evidence builder的预算裁剪来绕过必要性。

## 纯构造器输入与结果

拟议`buildOwnershipRubricCapsule(input)`是异步纯函数（平台SHA-256），只接收已验证question、submission、grade、attempt、immutable snapshot、实际validatedCitations，以及调用方捕获的source activation/analysis identity/settings revision及受限源码材料。不得自行打开文件、SQLite、执行仓库或访问模型。源码材料由application从同快照存储读取，仅限必要proof的文件，不跨snapshot。不足、预算或不支持结构返回有界不可评估结果；身份矛盾、伪造range/hash、内部损坏属于固定失败，不伪装成可评。

结果为严格union：`ready`携带下文精确白名单内的内部rubric、证明清单、路径/role映射及绑定hash；`not-evaluated`只携带下文固定hash/标量身份/枚举白名单，不继承ready的可变字段、不携带半个rubric。两种均不是已经评估语义，ready仅表示可为未来prepare提供材料。builder不计算语义分、不调用response verifier产生模型结论、不用关键词、长度、自信度或相似度评语义正确性。

本地合法引用但不满足语义契约属于not-evaluated：每个保存的validatedCitation必须具有proof并精确等于proof.span；相交、子范围、扩张范围不得被擅自替换成proof全范围。重复原引用可以存在，validated数组仍保持原去重顺序；逐role以完整citationKey把原索引映射到validated索引，不能按位置猜测。先按下文独立修正切片使**新attempt**的structuredAnswer角色索引引用其实际持久化citations；原submission和既有历史不改。胶囊另存受限`roleBindings`（originalCitationIndex、validatedCitationIndex、role、edgeId、evidenceId），未来语义包采用已规范的新attempt结构，并以projectionHash绑定映射。另存完整`citationOrder`整数数组：原提交每一个引用位置映射到attempt.validated引用索引，包括重复和未被role使用的位置；重开时从attempt.citations重建原顺序并重算projectionHash，不保存重复源码范围对象。ready的原引用数及validated引用数均≤24，超过则package-budget-exceeded，不截断；无效/不能重构映射为invalid-role-binding。若原role索引不存在、找不到精确唯一映射、角色矛盾或提交kind不匹配，则语义不可评估，不改本地原成绩。

## 四题型有限标准

每题必须恰有与kind对应的一个deterministicCheck；不是生成器当前形状的多个/不一致check不可评估，不能只取第一个。所有所需node/edge/proof须属于同snapshot、真实存在，edge端点与题目一致；本批受支持关系及其直接证明均要求verified和匹配证据kind。unsupported proof、不完整analysis identity不借LLM补全。

| 题型 | 标准及充分证据 | criterion、权重与资格 |
| --- | --- | --- |
| entry / definition | 所选node等于check.nodeId；check.edgeId为verified DEFINES、target为该node，proof为symbol-definition，同文件/精确范围。只检验名称、种类与声明位置的解释，不凭定义位置推断业务职责、入口或执行行为 | 一个`definition` criterion，100；必要证据为该定义proof。符号命名只作为不可信标签，不作为职责结论 |
| call-direction | check边为verified CALLS，source/target对应check和提交caller/callee；proof为call-expression，解释该处谁调用谁，不推断调用一定执行 | 一个`direction` criterion，100；必需该调用proof。结构化反向选择不可评估；结构正确但自然语言说反仍可交由未来模型输出contradicted |
| call-path | 与提交nodeIds完全相同的某一合法配对edgeIds序列，全部verified CALLS/call-expression并被用户验证引用完整覆盖；每步证明静态相邻关系 | 每条所选边一个criterion，1–8步；权重`floor(100/n)`，前`100%n`个步骤加1，合计100。超过8步整个不可评估，不截断。没有完整路径、混拼、缺边/证明整个不可评估；不评零散步骤 |
| variable-flow | requirements至少write/read，可有return；目标variable一致。每个提交role都通过原索引映射到完整精确引用，并匹配该role requirements中真实verified WRITES/READS/RETURNS边及对应variable-write/variable-read/return-flow证明；同一role允许多个位置 | 每个required role一个criterion，固定顺序write/read/return，2或3项，50/50或34/33/33。该role所有提交且匹配的位置证据均必需，单项最多8。每个required role至少一个引用；多出的错误/不属于题目的role不静默忽略。只解释读写/返回位置，不命名跨函数生产者/消费者或全局数据流 |

现有question.evidenceIds可含所有合法备选，不要求它们全部进入rubric。entry/direction只含确定检查的proof；path只含一条完整选中路径；variable只含用户为每个必要角色选中且合法的proof，不混合未引用的所有候选。当本地location因其他候选未引而失败、但这些角色标准仍满足时可ready；辅助语义不改变原失败。该区别在golden与设计审查中明确核验。

完整path选择：按legalNodePaths[i]和legalEdgePaths[i]逐对核验，长度、端点、证据kind/verified、snapshot和真实来源均正确且引用覆盖全序列者成为候选。按完整edgeId序列的canonicalJson进行ordinal排序，取最小者；不能localeCompare、不能按单边逐步挑选，也不能拿评分best覆盖率候选。所有同等完整候选的存在不改变“只保存一条”原则；选择和hash对数组重排稳定，边位置变更则hash变化。不得添加题目规则没有列出的组合。选中序列按用户node顺序保存。

所有validated引用保留，不截断或悄悄删除。额外引用若不属于所选必要criterion证据、未选备选路径、相关proof类型不支持，返回`citation-outside-rubric`。这比本地评分资格窄，是辅助通道的显式限制；本地attempt始终保留且失败原因可读。不能为通过包闭包而向node人为挂载无关proof。

## 命题、答案范围与有限限制

criterionId以固定模板版本、questionFingerprint、检查类型及所选edge/node/role规范化身份生成稳定SHA256；路径步骤ID还包含顺序和该实际边，变量按role和sorted evidenceIds。proposition使用固定中文模板加受限源码符号标签/角色，不把用户自然语言当指令，不从注释生成标准。必需证据集等于allowedEvidenceIds，不把限制的relatedEvidenceIds当评分证据；未来回应supported/contradicted仍按已接受契约核验，并不表示自然语言正确性已由本地证明。

所有criterion的answerScope为完整实际答案`[0,answer.length)`；空答案用[]，允许未来insufficient且空answerRanges。UTF16范围不切代理对；不按句子、关键词或语义猜分段。原文与顺序不归一化，答案hash按已接受hashOwnershipAnswer；孤立代理项/超16KiB只使语义不可评估，旧本地10000字符限额不缩小。

每个criterion预定义两项限制：`static-only`（该criterion的实际证据不能证明一定运行时行为，relatedEvidenceIds为其证据集）与`answer-information-insufficient`（答案未表达足够信息是未来辅助判断条件，relatedEvidenceIds为空）；允许集严格双向闭合。不用空泛“证据不足”来代替缺必要标准。`unresolved-dynamic-behavior`仅当将来特定题型规则显式纳入相关真实unknown证明时允许，本批四种verified标准不添加；不能把snapshot任意unknown捎入。`evidence-scope-insufficient`用于已具备必要标准但命题外的额外语义不可证明的未来明确模板，本批不用它掩盖不完整证据。限制总数最多16，符合现有24上限，每criterion2项；输出限制无confidence、不是一级证据。

limitationId、rubricHash、answerHash沿用已接受纯契约函数及其domain版本，不自造第二套规则。ADR早期文字提到含rubricVersion的限制ID，当前接受实现通过固定`ownership-limitation/1.0.0`domain绑定版本；消费当前规范，不修改冻结契约。同一限制description/template变化须升级builder规范版本及新rubric/hash，不复用旧ID。

not-evaluated在答案编码或字节超限时允许answerHash=null，因为当前hashOwnershipAnswer会拒绝这类答案；精确绑定仍由完整attemptHash承担，不能先裁剪/替换字符后生成一个看似合法的answerHash。其他原因且答案符合现有函数限制时保存真实answerHash；ready永不允许null。

## 胶囊内容、hash与预算

胶囊独立version与builderVersion均为1.0.0；契约rubric/semantic版本1.0.0，旧question/scoring版本不变。严格union两个分支分别列白名单，不能用ready对象spread后附reason生成not-evaluated。

公共有界标量`sourceIdentity`恰含`activation,analysisResultFingerprint,configurationHash,ignorePolicyHash,sourceManifestHash,ignoreRevision`：activation为≤32字符ISO时间或null；四种hash为64位小写hex或null；ignoreRevision为非负安全整数或null。不含repository路径、analysis数组、proof/node/edge清单或说明文字。ready不允许activation、analysisResultFingerprint、configurationHash、sourceManifestHash、ignoreRevision为null，ignorePolicyHash允许真实null。not-evaluated不能取得有效标量时保存null，不能截字符串或伪造hash；真实输入仍由完整question/attempt hash绑定。

**ready payload精确字段**：`version,builderVersion,status:"ready",repositoryId,snapshotId,attemptId,questionId,questionVersion,questionKind,variantKey,prompt,learningObjective,questionFingerprint,attemptHash,answerHash,submissionProjectionHash,deterministicScoringVersion,sourceIdentity,analysisIdentity,rubric,citationOrder,roleBindings,necessaryNodeIds,necessaryEdgeIds,necessaryProofs,createdAt,capsuleHash`。没有reason字段。repositoryId/snapshotId/attemptId/questionId及node/edge/proof ID沿用现有remoteId≤128字符/512字节约束；questionVersion≤64字符，questionKind固定四型enum，deterministicScoringVersion为本批2.1.0；variantKey≤1200字符/4800字节，prompt和learningObjective各≤1200字符/4800字节，analysisIdentity/rubric按已接受strict语义schema。所有重复身份/目标字段必须与原question/attempt/rubric一致，不能用截短文字替代。

ready的citationOrder≤24项，roleBindings≤20项且每项恰含`originalCitationIndex,validatedCitationIndex,role,edgeId,evidenceId`；必要node IDs≤24、edge IDs≤40、proofs≤24。necessaryProofs每项恰含`evidenceId,kind,analyzer,analyzerVersion,confidence,filePath,span,contentHash`并用现有proof/path/span对应字段边界；filePath必须等于span.filePath。路径只保存rubric.selectedPath，不另建相互分歧的顶层selectedPath。createdAt必须等于attempt.completedAt且为≤32字符ISO时间。不得保存snippet、答案原文、自信度、完整Graph IR、其他attempt或凭据。

**not-evaluated payload精确字段**：`version,builderVersion,status:"not-evaluated",reason,questionFingerprint,attemptHash,answerHash,submissionProjectionHash,sourceIdentity,capsuleHash`。version/builderVersion固定1.0.0，reason仅下文有限enum，questionFingerprint/attemptHash/capsuleHash恰为64位hex；answerHash/submissionProjectionHash为64位hex或null。仅原答案符合已接受函数边界时有answerHash，仅完整合法投影可构造时有submissionProjectionHash；null不能表示已核验。**不含原repositoryId/snapshotId/attemptId/questionId/version/kind/variantKey、题面/目标/createdAt、rubric、citationOrder、roleBindings、analysisIdentity或任何来源清单**。数据库关联列从原attempt及封闭准备句柄取得，不从not-evaluated payload复制原不受限字段；完整attemptHash含这些原始字段，questionFingerprint含完整variantKey/题面/checks。读取时必须与同库实际attempt重算绑定，而不是缺原ID就放宽身份。

capsuleHash统一覆盖去掉capsuleHash后的**分支完整对象**，原来domain`ownership-capsule/1.0.0`保持，编码规则下文定义。不增加随机值或生成新时间。ready的createdAt沿用原attempt时间；not-evaluated通过attemptHash绑定原时间，不复制它。不用ready字段上限收紧旧question/attempt schema；任何ready字段或完整64KiB预算不满足，直接构造≤2KiB not-evaluated新对象。

全部新hash只使用一种规范：SHA-256(UTF8(canonicalJson(preimage)))，输出64位小写hex；canonicalJson使用现有contracts/snapshot-content.ts，不引入平台JSON.stringify、locale排序或第二套规范。新增ownership-capsule.ts计划只定义这些纯preimage函数及async digest入口，供builder、准备验证和将来graph同步执行共同消费：question preimage为`{domain:"ownership-question/1.0.0",question}`；attempt为`{domain:"ownership-attempt/1.0.0",attempt}`；capsule为`{domain:"ownership-capsule/1.0.0",capsule:omitCapsuleHash(capsule)}`；projection为`{domain:"ownership-submission-projection/1.0.0",originalCitations,originalStructuredAnswer,citationOrder,roleBindings,normalizedStructuredAnswer,validatedCitations}`。投影不能完整合法构造时不hash部分数组，保存null。此处精确定义原计划尚未冻结的capsule/projection包装对象，后续golden必须固定，不能实现时自行换形状。

questionFingerprint覆盖当次完整内部question，包括checks/合法备选、choices、prompt、目标、版本/variant/retry。数组按实际question保存顺序保留，不在questionHash里自行洗掉其变化；选路算法对候选顺序稳定不等于当次questionHash忽略排序。attemptHash覆盖全部实际持久字段（S2a规范结构/去重引用、原成绩/semanticText/时间/legacy），数据库重算完整attempt，不能仅比较答案hash。submissionProjectionHash覆盖原citation顺序及原→规范映射，防止换索引解释旧role；ready可从citationOrder与attempt重建原引用及角色后验证，not-evaluated没有重建材料，其非null摘要只由准备阶段完整验证且capsuleHash绑定，不作为可外发/可恢复投影。

ready预算取现有契约的更窄上界：criteria≤8、limitations≤24、每引用≤8、proof≤24/node≤24/edge≤40、单snippet≤4KiB/40行、总必要source≤24KiB、答案≤16KiB、完整assessment DTO JSON≤64KiB。读必要源码核验manifest hash和精确span后按同range提取，不截断。ready胶囊payload≤64KiB（含全部字段与hash）；not-evaluated payload≤2KiB（含全部固定字段与hash），由独立strict schema和UTF8大小断言双重核验。该分支没有可变长数组/原始字符串；S3先以全部最大固定值/最长reason构造worst-case golden证明上界，若固定schema自己超过2KiB属设计/实现缺陷，不能因此拒绝一个已合法本地attempt。整个question/attemptHash始终覆盖完整合法本地输入，包括超限variantKey/题面/引用原文，不能截取后算hash。预算不足只选固定reason并保存有限辅助元数据；原attempt和分数按旧规则保存，不回退为只存半个ready，也不改变旧schema上限。

本次纯设计大小计算：最长reason为analysis-identity-unavailable，9个非null hash均64 ASCII字符，activation取32字符ISO时间，ignoreRevision取Number.MAX_SAFE_INTEGER，其余固定版本/status/键按上述白名单；紧凑JSON总992 ASCII字节（键序不改变长度），小于2048。nullable字段改null只会变小。此计算未加载新schema/SQL/builder，不能替代S3 golden或实际编码验证；未来字段改变必须重新推导上界并测试，不依赖992这个历史数字免检。

反例依据（协调方报告，本修订未运行）：main用81条合法合成数据流边调用真实createQuestions，生成schema合法variable-flow题，variantKey单字段5275 UTF8字节；脚本`.benchmarks/remote-desktop-review-20261002/ownership-capsule-budget.ts`以node --import tsx退出0。这是纯生成器设计预算反例，不是SQL/索引/GUI验收。旧计划通用字段复制variantKey进not-evaluated将违反2KiB，本次以两个不继承字段的分支修正。

若未来transport把assessment序列化嵌入请求，其实际整HTTP body预算另测，不能拿64KiB DTO证明最终body≤64KiB；本切片不构造body。必要proof或边数超预算、声明范围太大等整个not-evaluated，不调用feature builder的skip/truncation，不以只保存部分criteria成功。

有限reason暂定：`unsupported-question-shape`、`structured-answer-mismatch`、`incomplete-selected-path`、`missing-required-proof`、`unsupported-proof-kind`、`citation-not-exact`、`citation-outside-rubric`、`invalid-role-binding`、`analysis-identity-unavailable`、`answer-encoding-unavailable`、`answer-budget-exceeded`、`rubric-budget-exceeded`、`source-budget-exceeded`、`package-budget-exceeded`。reason按固定检测顺序选一，不保存exception/动态detail或原源码。未来读取旧attempt无胶囊返回`legacy-capsule-absent`读取状态，不回填该理由到旧库。身份造假/写入冲突/配置损坏/SQL失败是固定本地失败，不能转成reason来提交半个结果。构造器未知异常须失败，不吞为not-evaluated。

## 同attempt事务、冲突与角色

拟议source-owned `ownership_semantic_capsules`以attempt_id为主键，repository_id/snapshot_id/status/version/attempt_hash/capsule_hash/payload列；不存网络task、provider或授权。外键指向同库ownership_attempts；SQLite外键开关与适用迁移测试必须核对，不单靠DDL声称已强制。project role与存在legacy attempts的global role可存该source表，只有兼容source意义，不因此获得global policy端口；project不建授权/dispatch表。新空global若迁移统一创建此source兼容表也不得混入policy数据。未来明确删除attempt时同事务精确删除对应capsule；不增加后台过期清理，retention跟随attempt。数据库销毁/explicit删除跨库仅定位已知source，禁止扫描路径。

窄端口改为两阶段：`prepareOwnershipAttemptWithCapsule(input):Promise<PreparedOwnershipWrite>`在事务外验证并封存材料；`savePreparedOwnershipAttempt(prepared):void`是唯一同步双INSERT端口；内部读取`loadOwnershipCapsule(attemptId)`。不保留未经验证的raw(attempt,capsule,hash)写入捷径。保持旧saveOwnershipAttempt接口/普通INSERT行为，不改为IGNORE。新准备句柄不进入IPC、不序列化、不存库，不能由renderer/其他store构造；实现候选为store私有WeakMap按opaque对象键登记验证后的字符串材料（无新依赖），同步保存拒绝未知/其他store/已消费句柄。

明确async接缝：contracts/ownership-semantics.ts:55–73的SHA函数均返回Promise并调用WebCrypto；不能在SQLite事务调用它们后假定已验证。所有async hash/strict语义包、rubric、限制/答案验证以及新question/attempt/capsule/projection hash验证**在准备阶段事务外完成**。prepare入口先将纯data输入schema解析为自己拥有的深拷贝，序列化并保留完整canonical question/submission/attempt/capsule、captured source/settings身份与必要preimage字符串；不得保存调用方可变对象或getter，也不得await后再重新读取原输入。ready完整组装暂存DTO调用已接受validate入口，not-evaluated按独立schema核验固定分支及完整question/attempt摘要；不因缺少ready来源清单而把部分ready当已验证。

prepare把校验通过的完整canonical attempt/capsule字符串及已核验preimage和captured身份保存在私有receipt里，冻结自身metadata，不向外暴露可变引用。同步保存先消费并取得receipt，再进入settings→source事务：从同库同步重读snapshot/activation、配置revision、分析/manifest身份及现有attempt主键；必须与receipt捕获值一致，冲突即失败。实际INSERT的payload只采用receipt字符串，列值只从该字符串schema解析得到的attempt取，不采用调用方再次提供的attempt或ID。必要source范围/contentHash依据同快照不可变记录同步核对，不在锁内读文件系统。not-evaluated即使未具备可外发分析身份仍核对完整真实snapshot与captured配置，不放宽本地提交currentness。

事务内需要重算attemptHash/capsuleHash时，使用graph**已有**Node createHash("sha256")同步digest，输入是新capsule契约纯preimage函数产出的**同一canonical UTF8字节**；与WebCrypto只是执行后端不同，不产生新domain/排序/编码规则，不复制rubric私有normalize代码。question/rubric/projection的async验证结果由私有receipt绑定其精确不可变字符串；同步capsuleHash覆盖rubric及投影摘要和全部payload，若材料与异步已验字符串有任何差异就拒绝。同步重算完整attempt和capsule还要与receipt预期hash及capsule绑定字段一致；这些hash不是仅相信raw caller声明。跨平台JSON键/Unicode/代理项转义的WebCrypto↔Node等价golden是SQL切片前门，未通过不接SQL。读取时同样以该纯preimage同步重算实际持久attempt/capsule与列/payload，角色与ready投影继续核对；不新增重解释历史。

先普通INSERT attempt、再普通INSERT capsule，任一失败回滚两者；保存返回成功后才按旧passed条件删题。receipt尝试保存即失效，失败不复用旧currentness材料；用户可重答、重新prepare同仍保有question，不引入持久重试幂等。准备结束到保存期间修改调用方对象、掉换capsule/hash、跨store/复用receipt、改source activation/config以及同ID已存在，都必须拒绝或只保存原已验字符串（原对象修改不影响receipt），不能生成错配行。

同ID策略保持保守：重复attempt无论相同还是不同payload都冲突失败；特别测试同ID不同答案/原分、同ID不同capsule/rubric或把capsule附到预存旧attempt均拒绝，旧内容不改写。不添加数据库隐式upsert/回填。application当前attemptId依时间生成，本切片不引入新重试幂等协议；本地失败保留question便于用户重提，但毫秒碰撞应报冲突，不能悄悄覆盖。缺capsule旧attempt/mastery只可历史读取、显示未评估；不重新出题猜旧标准。

builder和prepare验证均为async，须完成所有await后再进入同步事务；禁止在withIgnoreRevision/source事务await，保存端口拒绝任何Promise工作结果。流程：捕获source activation/manifest/config与settingsRevision→现有getSnapshotState→grade与S2a规范attempt→从同快照读必要材料→await纯builder→await prepare验证并封存receipt→重新执行现有工作区检查/policy，任何currentness无法证明不保存→settingsStore.withIgnoreRevision(revision, ()=>source.savePreparedOwnershipAttempt(receipt))。外层settings IMMEDIATE锁保持到source提交完毕，source事务重新核对captured activation、analysis/manifest/config及同库ignoreRevision；两个库保持settings→source顺序，不为本地胶囊引入global policy锁。legacy写到global source时仍是settings(project)→source(global)，不要套远程dispatch的policy→settings锁序或同时触发远程操作。

若配置修订在异步检查之后/写前改变则整次拒绝且两行都不存在；同snapshot被重新晋升导致activation变化也拒绝旧captured。文件系统检查不是跨文件原子屏障，不能声称阻止检查后所有文件修改；未来prepare/start仍须独立重新校验实际工作区/权限，本批只保证持久快照/配置事务身份。配置损坏不沿用旧current。无远程条件时ready仍仅本地材料。

## 精确后续切片候选与门槛

以下只是待派发文件，不授权现在修改：

0. 优先S2a（已另批实现冻结，root独立回归仍按实际记录判定；本设计修订不改/跑该三文件）：新attempt引用索引持久化一致性小批。范围只修改`packages/application/src/index.ts`，新增`packages/application/src/ownership-citation-index.test.ts`与独立development-run；不改ownership评分、contracts/barrel、GraphStore/SQL/迁移、provider或UI。在原gradeAnswer之后、构造attempt之前，用原submission.citations和grade.validatedCitations按完整citationKey（filePath/行列/evidenceId）建立原索引→规范索引映射；仅variable-flow的有效role索引替换为该引用在持久化数组的索引。按原role顺序保留每个role与重复role，不排序、不合并角色，不改变citation去重顺序；其他题型结构原样。grade仍使用原submission和原验证结果，原locationScore/structureScore/passed/scoringVersion以及返回grade全部不变，不重新评分规范结构。不得修改submission对象。

   无效引用沿用现有validateCitations抛错路径：缺proof、范围非法、外文件/快照、不相交等在grade/保存前拒绝，零新attempt。原role索引在原数组内但找不到唯一合法规范引用属于内部一致性错误，固定失败、零写入，不能把未验证引用附到另一个proof。原role索引已经越界时，原grader目前产生结构失败并允许保存失败attempt；为保持此行为，该无效索引保持越界值，不猜引用、丢role或改分。因规范数组长度不大于原数组，原越界值仍越界，不能“规范化”为有效引用。后续胶囊该状态为invalid-role-binding/not-evaluated；它不阻止已有本地失败attempt行为。负数/非整数沿用输入schema拒绝。

   已有saveOwnershipAttempt普通INSERT事务直接保存同一payload中的规范structuredAnswer与规范citations，无独立写入或第二事务；既有settings锁不变。持久化失败不删question，重提依原行为形成新attempt。旧attempt没有原citation顺序，无法可靠修复，绝不迁移/回填/读取时重解释；历史payload原样保留，未来缺capsule的语义状态未评估，不能用新算法声明旧role已经正确。

   完成门：真实XRayApplication索引自建样例，`[write,write,read,return]`/`[0,2,3]`提交后新attempt角色`[0,1,2]`与三引用对应；关闭重开仍相同，原grade/passed/scoringVersion相等。覆盖重复位置在首/中/尾、不同排序、角色重复引用与重复role保留、同proof不同范围不误合并、越界保留失败语义、无效引用抛错且零写、不可变submission、旧payload字节不变、保存失败后题可重试及配置写前变更零写。跑适用application/ownership回归与类型，由root独立核对后接受，不能以更改旧记录或弱化断言把缺陷改写成成功。该小批无需等待胶囊迁移，建议先于S3/S4/S5派发。

1. S3纯builder：新增`packages/ownership/src/semantic-rubric.ts`、`semantic-rubric.test.ts`、`packages/contracts/src/ownership-capsule.ts`及测试、独立development-run。contracts新文件只定义两个严格分支/投影/有限reason、唯一canonical preimage与async hash，不改现有ownership-semantics；测试直接文件导入，本worktree冻结index不新增导出。跨包内部消费已接受semantic公共导出的环境由root安排，若无法解析不得静默扩barrel/package。先建golden四型/完整重复路径/角色索引映射/严格预算与无裁剪正负例；必须额外覆盖旧question schema合法的5275字节variantKey/长题面、多于24原引用或去重引用、超20/无效role映射、不完整分析身份、空答案、孤立代理项、16KiB UTF8临界、64KiB ready临界、2KiB not-evaluated固定最大shape。所有超ready预算仍生成有界分支并保持完整未裁剪question/attempt hash，不能仅用短mock绕开旧schema合法大输入。源码材料端口是输入，不接GraphStore；owner package只有现有contracts/analyzer-core依赖，无新第三方。
2. S4 SQL原子端口：新增`packages/graph/src/ownership-capsule-store.ts`和测试，修改graph/index.ts仅迁移挂接、prepare/private receipt/同步原子端口及source身份核验；迁移号先核对主实际状态再派，不改7/10。新增development-run。先测WebCrypto与现有Node同步digest消费同一纯preimage的golden、键序、非ASCII/合法代理对、JSON转义孤立代理项在完整本地attempt hash里的字节等价（答案hash仍拒绝非法编码），再测receipt不可伪造/跨store/复用、await期间原输入突变、prepare后修改caller对象、保存只用已验字符串、source/config第二连接变化、两个INSERT故障切点/重复ID/存量attempt不能挂接胶囊/列payload与hash损坏/打开旧库及role布局/精确删除。not-evaluated大型合法attempt在同事务完整保存而payload≤2KiB，不改旧save行为或schema。
3. S5 application本地集成：新增`packages/application/src/ownership-capsule.test.ts`，修改application/index.ts仅提交调用窄纯builder与新保存端口、必要内存问答捕获和后置工作区校验；保留S2a已接受的新attempt结构/引用映射。ownership/index.ts仅在独立批准后追加builder导出，contracts/index.ts仅在root核对冻结差异后独立最小导出。新增development-run。真实两个SQLite连接在await后改ignore/activation、legacy跨库写入锁、builder async竞态、passed删题仅成功后、SQL失败题目可重答、失败attempt有not-evaluated胶囊、旧mastery/进度/分/源码不变。

验收语料须在实施前由root选择/同步实际主语料并冻结，而非声称本worktree已覆盖116项。必要矩阵：正确结构错误文本不被本地判正确；文本正确无合法引用沿用原拒绝；同节点多调用位置任一完整配对可选、混拼失败；变量重复引用导致索引偏移须映射，错role/多余role不可评；本地相交引用仍可成绩但语义不发送；空答案可ready后未来insufficient；孤立代理、UTF8临界、>8criterion、每proof行/字节与整个DTO超限不裁剪；old attempt不回填；injected comments/answer不改模板/权重/文件范围；配置/activation写前变更两行零写；所有评分/历史回归。实际测试命令、失败类型与未验证项由实施批记录，本设计没有测试结果。

接受门：协调方确认上述更窄语义资格和role映射、有限模板充分性及胶囊字段/预算，然后只派纯builder。模型对自然语言是否判对、远程隐私授权与最终body、主SQL集成、真实GUI均仍开放。本设计不把ready、保存胶囊或pure schema通过当作语义能力端到端完成。

## 2026-10-02 23:32 S4历史读取保证的明确边界

协调方读取Sol材料缺口记录并复核S3 validateOwnershipCapsule原题依赖、ownership_attempts/capsule字段及application passed删题行为：库中未持完整choices/合法备选/deterministicChecks/concept，单参数loadOwnershipCapsule(attemptId)不能重算完整questionFingerprint。明确采用受限历史read，不重造question或新增整题/源码持久化；这不是新完整原题验证实现。

prepare仍以完整原题/尝试强校验，私有一次receipt和同步权威保存强门不变。read为Promise，在短同步读事务捕获同源attempt/capsule/必要历史快照与节点/边/proof/源码私有一致材料，退出事务再用现有公开async rubric/limitation/answer/projection函数验证，不在SQL锁内await或复制私有normalize。重算实际持久attempt/capsule摘要、核列/关联/必要事实与精确来源，损坏固定拒绝；旧attempt缺胶囊返回legacy-capsule-absent，不回填。

read内部返回明确questionBinding:'prepare-only'固定保证标签：完整原题指纹只在prepare时核验，历史读取不独立验证原题，也不提供对全部重写并重算摘要的数据库的认证保证。历史snapshot/analysis/manifest核验不代表当前activation/config/工作区仍有效；合法当前晋升或配置变化不能改写旧历史，未来外发必须重新核验当前性和授权。此标签仅内部graph端口，不改公共contracts/评分/UI/外发。没有原题时不能伪造原题复用S3validator；四文件实现范围不变。附加重开ready/not-evaluated/缺胶囊、当前状态变化下历史边界、损坏拒绝和零外发回归。这个源码依据的设计决定允许继续实施，不代表S4验收通过或新的AGENTS经验。
