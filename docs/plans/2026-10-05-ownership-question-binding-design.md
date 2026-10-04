# 2D-S4-D 原题绑定与当前性具体设计

2026-10-05，待协调方独立审查，非源码实施授权。仅原第二批、Windows、5170；原四批收尾后暂停。依据[本轮计划](2026-10-05-ownership-question-binding-design-plan.md)及[已接受共享任务设计](2026-10-05-ownership-shared-task-design.md)。本轮只新增本设计和自己的开发记录。

## 1. 实际缺口与选定方案

本地codex/llm-explanations / HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8，A1/S2及旧WIP冻结。协调方报告A1集成main d27f1a1f56d2010b595480e42fd6307035722923；本轮不访问main、不依赖Luna正在修改的task record。

实际源码：ownership/index.ts createQuestions/question按真实snapshot、request和attempts生成完整题目；application/index.ts createOwnershipQuestions及gradeOwnershipAnswer约638–715行从私有map捕获题目，首次await前复制，过程中assertActive防替换，passed才删除（失败仍可重答）；graph/ownership-capsule-store.ts prepare/save约85–127行将questionPreimage放WeakMap短期receipt，但SQL仅保存attempt/capsule；contracts/ownership-capsule.ts约58行定义完整question canonical preimage。S1历史ready只是prepare-only/not-checked，现有assertQuestion验证已选结构，不等于重建完整原题。

选定方案：新提交保存独立、版本化的question binding行，包含**完整questionPreimage、实际生成请求、发行时历史截点及生成器版本/排序依据**。来源保证由可信纯generator端口、真实SQL材料、私有发行capability和原提交receipt共同建立；后来从实际SQL重建完整generator输出并逐字节核对。没有使用模型、第二套评分器、renderer supplied question或“重hash一致即认证”。不保存整快照/答案副本；使用原source_snapshots与原attempt/capsule。

完整原题合法性、题目曾由可信流程选入私有map、新提交与此题绑定、当前工作区可用、发送授权是五个不同检查。数据库preimage/hash不是签名；合法性通过同一编译内generator重新推导，发行/提交的出处由受控写路径保证，不声称哈希可证明任意人为整体重写数据库的历史。针对同源码图的假prompt/objective/checks/范围，即使重算所有question/rubric/capsule摘要，也必须因generator完整输出不等而拒绝。

## 2. 完整canonical生成与四题型

ownershipQuestionPreimage原定义保持：canonicalJson({domain:'ownership-question/1.0.0',question})；对象键规范化、数组顺序保留。不得仅比id/kind/variant、排序数组后再比、把缺字段补默认值后冒充原题。新binding DTO解析strict，完整question对象亦逐层strict；复用现有字段，不修改原公开question version2.0.0或评分2.1.0。新增OWNERSHIP_GENERATOR_BINDING_VERSION='1.0.0'标识本次算法/输入投影；未来生成语义改变单独升此版本，不能用新算法猜验证旧版本。

复用createQuestions(snapshot, actualRequest, actualHistory)。保存解析后实际request，包括repository/snapshot、count、scope.kind、scope.nodeId是否存在、conceptId是否存在；记录选题在返回list中的candidateIndex。createQuestions当前顺序是CALLS方向→各root路径→变量角色→定义，concept filter后按id的Map去重，再slice count≤20；attempt history目前**只影响retryOfQuestionId，不跳过旧variant或重排候选**。scope会改变allowedNodes和合法路径集合，不得用project scope替代原scope；未知scope node或nodeId省略的现有行为沿用原函数，不私改为新规则。

|题型|完整生成依据与必须相等的内容|
|---|---|
|entry|原节点遍历顺序、function/method/class过滤、第一条verified DEFINES且证据存在；node/definition边、choices名称/detail、prompt、objective、difficulty、concept、全部证据及check|
|call-direction|原verified CALLS数组次序及allowed source/target、真实节点名；source/target方向、同位置edgeId、concept、variant、全部文本/choices/check，不能靠相同端点替换另一调用位置|
|call-path|复用原callPaths：depth4、内部最多maxPaths*8=32条、work500；按edge.id.localeCompare排序扩展、禁止节点循环；>=2边后按末节点分组。legalNodePaths[i]与legalEdgePaths[i]必须配对且所有备选完整保留。实际variant是legal.map(item=>item.edges.join(',')).sort().join('|')：item.edges为GraphEdge对象数组，join使用隐式对象字符串（普通对象为[object Object]），不是edge ID串；外层sort是原无比较器的字符串sort。按实际算法原样重建，不改variant，不据此重排check数组。pathNodes/choices/evidenceIds/expectedNodeIds按原去重与遍历顺序保留|
|variable-flow|原variable遍历、WRITES/READS/RETURNS verified且证据存在的完整边序列，必须至少write/read；requirements按write/read/return及各edge原顺序，variant包含完整集合。题目绑定覆盖所有合法角色，而rubric可能只选用户引用的对应边；不能用rubric必要子集重建题目|

id仍由stableId(snapshotId,'ownership-v2',kind,variantKey)产生，id碰撞或同名符号不能代全preimage。认证器只读检查原Map去重之前、concept filter之后的候选层：同id对应多个不同完整preimage时，该题新增认证unavailable/ambiguous-generator，不能从去重后一个值猜证明唯一。此检查不能改变createQuestions当前Map选值、返回顺序/count、发行到私有map的本地题目、grade或题目删除/重答行为；原Map同key保留最后赋值题目及首次插入位置，再slice count，必须原样保持。提交仍保存原attempt/capsule，加小型unavailable绑定行。没有歧义时才要求重建题目精确匹配返回list的candidateIndex及id。通过小幅抽取现有候选构建函数供只读歧义观察复用，不复制图算法、不顺便修对象variant、question版本或scoring版本。该观察产生认证状态，不抛错使原离线发题失败。

图材料来自SQL持有的snapshot payload原数组顺序，并核nodes/edges/evidence实际行与源码hash/manifest一致（复用原capsule material检查）。额外保存generatorInputHash，覆盖规范完整生成输入的节点/边/证据顺序及实际request，不以canonicalSnapshotResult的无序集合摘要替代顺序绑定。只保存hash，实际图仍读原库，不存第二份全snapshot。运行时不能重排后声称原题相同。

## 3. retry历史截点与重复引用

发行题目时，SQL同步读ownership_attempts当前最大rowid作为historyCut.maxAttemptRowid（空为0，安全非负整数），同时捕获实际历史。后续重建只使用同source库、同repository、rowid≤cut的持久attempt；在其后追加的提交即使completedAt回退也不进入旧题依据。发行不会写attempt或复活旧题；截点只是此批生成输入的固定界限。

原listOwnershipAttempts最后按completedAt.localeCompare再attemptId.localeCompare排序；将此比较提取为同一个纯函数供原列表与绑定使用。保存实际发行时resolved locale（bounded≤64字符）、完整resolved collator选项（usage/sensitivity/ignorePunctuation/collation/numeric/caseFirst）及orderingVersion='completedAt-attemptId-locale/1.0.0'。callPaths的edge.id比较同属此依据；原默认调用保持现有默认locale行为，认证比较复用同语义，不能替换原variant的无比较器sort或改成本地SQL二进制排序。

明确采用严格orderingEngine兼容策略：basis记录{implementationVersion:'js-localeCompare/1.0.0',nodeVersion,v8Version,icuVersion,unicodeVersion,cldrVersion,hostRuntime:'node'|'electron',electronVersion:null|string}，文本每项≤64字符。仅实际版本/选项均可取得且与当前可信比较实现匹配时认证；缺失版本、不同Node/V8/ICU/Unicode/CLDR/Electron身份或不支持的locale/选项，认证返回unavailable/unsupported-ordering-engine，不尝试排序猜题、不重写旧行。旧本地题目/attempt/历史照读，新本地发题仍按当前原generator，新的认证可记录当前engine。

保存locale本身不保证不同Node/ICU版本结果一致。engine兼容亦不免除完整generator重建与preimage比较：即使已记录版本/选项相等，任何实际输出不同仍拒绝认证；不声称有限版本字段能证明所有外部collation数据或人为环境重写一致。认证不兼容不能改原离线候选/grade或把旧历史读取变成错误。

只需保存同concept.id+variantKey匹配历史的projectionHash及retryWitness：null或{attemptId,attemptHash,questionId}。实际重建从截点前SQL严格读这些匹配行，验证列/payload与ownershipAttemptSchema、按原比较排序，投影每项{attemptId,completedAt,conceptId,variantKey,questionId,attemptHash}并重算完整有序hash；不得limit1忽略先前行。retryWitness必须为排序后第一匹配行；没有匹配时必须null且题目不能带retryOfQuestionId。存在时retryOfQuestionId必须等该行questionId，不能根据当前新history或caller witness重造。

原mastery兼容映射concept以legacy:起始；四题型generator的concept前缀分别definition:/call-direction:/call-path:/variable-flow:，所以正常legacy映射不会参与这些retry匹配，保留其本地progress行为。遇无法严格解释的旧ownership_attempts行、人工legacy行恰好匹配本concept/variant，新增认证为unavailable/history-unverifiable，不猜补来源，原离线行为保持。正常应用追加使后写行不进入旧cut；验证实际截点内匹配历史projection/hash/first witness及source实例/repository，匹配输入变化或错实例则拒绝认证。rowid复用只有在这些检查可观察到变化时才会被拒绝；相同投影不可据rowid声称识别了所有复用、删除重插或SQLite人为整体重写。SQL rowid及存储hash不是防篡改日志，绝不声称能检测其全部历史。

新发题取新的historyCut；失败后同map题再次提交仍使用原发行cut（原题retryOf不因刚写失败attempt偷偷变化）。重新createOwnershipQuestions替换map才捕获新cut；passed删除题，新进程不从binding行把它恢复进map。

变量重复引用按现有提交投影处理：首次await前捕获原submission，原grade使用原citations/roles；持久attempt按validatedCitations去重并重映citationIndex。绑定保存完整question，但不额外复制答案或citation数组；校验沿capsule.citationOrder、roleBindings、submissionProjectionHash恢复原roles与原顺序，重用同一submissionProjection检查。重复角色数量/原citationIndex/规范validatedCitationIndex分别校验，禁止按集合比对丢掉重复项；调用路径评分继续接受任一完整备选路径，不把不同路径证据混拼。

## 4. 新表、严格字段及字节预算

建议新独立表ownership_question_bindings，source project及legacy global两布局都可创建，外键attempt_id→ownership_attempts。迁移暂名M_QUESTION_BINDING，编号只建议由root接受后实际分配；不得擅占15或改已有10/11/12/13/14。global表在此处是source材料，不是global provider策略。

|列/字段|规则|
|---|---|
|attempt_id PK、repository_id、snapshot_id、question_id、question_version、version|精确绑定原attempt；version='1.0.0'；不可覆盖同attempt历史|
|status|verified-generator或unavailable；此verified仅指合法生成题，不表示当前或发送许可|
|question_fingerprint、attempt_hash、capsule_hash|verified时精确等原canonical preimage/既有capsule与attempt；不修改旧hash。unavailable仍绑定实际attempt/capsule摘要|
|question_preimage TEXT nullable|verified保存完整原canonical question preimage≤128KiB UTF-8，不再保存重复question对象；nullable只用于unavailable|
|basis_payload TEXT|strict版本化basis≤8KiB：generatorVersion、orderingVersion/locale/resolvedCollatorOptions/orderingEngine、actualRequest、candidateIndex、generatorInputHash、historyCut、matchingHistoryProjectionHash、retryWitness、publicationSource（原activation/analysisIdentity/hash/ignoreRevision）、createdAt；无答案/源码/凭据|
|reason nullable|unavailable有限枚举：question-budget-exceeded、basis-budget-exceeded、history-unverifiable、unsupported-generator、unsupported-ordering-engine、ambiguous-generator、untrusted-issuance；verified必须null。来源损坏不是unavailable，固定错误失败关闭|

128KiB与8KiB是新本地认证材料上限，独立于capsule ready64KiB/not-evaluated2KiB、远程body64KiB或答案16KiB，不互相替代。完整原question可能含超过远程variant1200长度的合法本地题，必须保留本地grade/attempt行为，不截断题目/合法路径以挤入认证预算。超新预算则原本地提交与capsule按原规则保存，再同事务写小型unavailable行（≤2KiB且只有限reason/基本绑定hash）；basis无法完整保存时也不伪造“verified”。旧API没有可信发行capability的提交可继续原离线行为，新增绑定只能unavailable/untrusted-issuance，不由普通DTO创建verified。小型unavailable不是发送资格。

所有行按strict schema、列/payload、canonical UTF-8字节及实际旧材料核验；不得读到坏行后降级为missing/unavailable或自动改写。新verified/unavailable行随attempt+capsule原事务原子提交；任何新表写失败三者都回滚，原题按当前失败可重试规则保留。对旧attempt绝不INSERT补绑定，也不修改其成绩/mastery/capsule/source；原S1 read shape保持。新独立历史binding read返回legacy-unbound/unavailable/verified-generator且currentness=not-checked，不产生receipt。

## 5. 可信发行与提交的出处接缝

graph不得导入ownership内部生成器。新增内部只构造时注入的OwnershipQuestionGeneratorPort（纯函数、版本常量及明确排序），由application硬接已编译ownership模块；不是每次请求可换的callback，不接受renderer provider/所谓校验成功值。该端口在图层接收的snapshot/history都由实际SQL捕获并校验，而非caller snapshot。

拟定内部接口：

1. source.issueOwnershipQuestions(request,settings)在settings→source同步锁段核真实revision/current activation及source材料、捕获cut/locale，调用固定纯generator产生实际list并保存WeakMap私有发行capability。返回私有{question,issuance}到application；公开createOwnershipQuestions仍返回题目clone，私有map保存question+issuance和entry identity。发行不写SQL，capability不序列化、不跨IPC、不保存可重放token。
2. grade首次await前从私有map同时捕获question、issuance、submission，assertActive校验同entry和完整preimage；gradingQuestions并发门保持。issue capability可以服务同未通过题的多次新提交，但不能替换question/source/basis；每次PreparedOwnershipWrite仍一次消费，成功passed/替换map/配置失效/close则注销发行capability。
3. prepareOwnershipAttemptWithCapsule受内部issuance参数支持。图层WeakMap核capability属于该source、该生成器端口及发行entry，读取实际材料后用同generator完整重建、精确核questionPreimage/issue basis；复用原validateOwnershipCapsule、projection及ready检查。首次await前复制全部普通数据并保留source/settings实例；异步digest仅用私有捕获，之后再open/entry有效性核验。
4. savePreparedOwnershipAttempt在原settings.withIgnoreRevision→source IMMEDIATE内重新读实际material及发行historyCut，运行同步纯generator比较完整preimage，核当前source identity及prepared canonical attempt/capsule/projection；在原attempt与capsule INSERT旁同事务INSERT binding。新行与实际hash读回一致才成功。失败不开新权限、不自动发请求。

发行capability只证明可信活流程绑定此题；持久行再打开后的合法性由同generator和实际SQL核验。历史preimage/hash不能重建一个发行capability，因此不能复活map题或绕过提交。新题认证与旧兼容写入必须分清：旧内部prepare无capability不能被升级为verified，旧测试不能靠注入普通question object假认证。

## 6. 后续SQL当前性一次性barrier

本设计提供具体接缝，但不实施semantic transport/durable reserve/恢复。拟定authority.withOwnershipSemanticRevisions(capturedIdentity,settings,source,preparedBinding,work)仅可信application内部调用，global角色且实例必须属于该repository的真实stores映射，不接caller callback声称来源。

异步准备先对snapshot做真实工作区/排除规则验证并加载已保存binding+S1材料、重建generator/包和actual adapter完整body。首次await前捕获完整preimage、矩阵身份及实例；异步后复查closed/owner entry/generation。返回的PreparedSemanticBinding为source私有WeakMap对象，绑定精确authority/settings/source实例、版本、attempt/capsule/binding/question/body preimages，不序列化，不由history read或parse DTO产生。

进入barrier锁序固定global policy→settings.withIgnoreRevision→source IMMEDIATE；同连接legacy布局用嵌套savepoint，不伪称多库原子。锁内：

- source原material检查实际snapshot/规范表/源码hash/manifest和当前activated_at/is_current，比较完整analysis/config/ignore身份；同snapshot A→B→A新activation拒绝，配置revision改变拒绝。
- 重读精确attempt/capsule/binding与截点前retry依据；旧unbound/unavailable、generator不支持、material损坏拒绝。同步同generator再推完整question并核全preimage及private prepared preimages，不能只比stored hash。
- attemptHash覆盖原答案、结构、引用及原确定性成绩；rubric/selected合法路径/roles与完整question、projection闭合，原成绩保持不变。来源与原题合法性成立不表示workspace当前，二者均须通过。
- global实际ownerSessionId/contextHandle/epoch/reference及可信main active ref/generation，独立S2 granted revision/六披露/purpose/version，actual provider/model/providerRevision/credentialRevision核精确相等。凭据来自OS port内存，revision匹配，不存key。
- 当前私有adapter完整serializedRequest摘要核bodyDigest，包含实际systemInstructions/responseSchema/data等完整体；与S3已接受dedup preimage保留bodyDigest规则一致。包/版本同但body变不复用completed，必须新preview手动请求。

work只接受本锁段临时一次性revision receipt；从WeakMap核并消费，不能存到事务外稍后注册。拒Promise/thenable、receipt跨source/settings/authority、close后、二次用、旧generation；finally撤销未消费receipt。PreparedSemanticBinding（异步计算证据）与临时revision receipt（锁内当前性检查）分为两种内部类型，前者从来不是发送许可；原题认证history read不创建任一种许可。

文件系统无法像SQLite一样冻结任意外部编辑：保留dispatch前后工作区检查、可信main先关入口与状态失效门，以及锁内SQL当前性校验；不把一次hash检查宣称整个请求期间工作区不可变。revoke/provider/context变更需S3后续同锁任务终态及abort接线，S2低层存储不自行回调。跨库成功仍source append→global同身份completed才可读；失败精确补偿、保持占用，completed历史不删。A1只注册互斥；未接durable reserve和全参与者停止门时不可启用两用途真实发送。

## 7. 最小实际实施切片与精确清单

|顺序切片|文件/API|可独立验收及限度|
|---|---|---|
|Q1 新提交绑定与只读验证（拟先派）|新contracts/src/ownership-question-binding.ts及.test.ts、contracts index单export；ownership/src/index.ts仅抽取复用候选生成/排序并加纯verify helper与generator binding版本、对应index.test.ts；新graph/src/ownership-question-binding-store.ts及.test.ts；graph/ownership-capsule-store.ts及.test.ts原receipt/save窄接绑定；graph/index.ts同连接私有端口/固定generator注入及必要index.test；application/index.ts私有题目entry发行capability与提交参数、ownership-capsule.test.ts；自身记录|真实索引→四题型发题→提交原成绩→原子三行→关闭重开→generator完整核验；无global政策/语义task/网络/IPC/UI。新迁移由root后分配；超预算不变本地评分，旧history不可补认证|
|Q2 内部当前性准备及同步barrier（后派精确范围）|graph窄material/binding capture及revision barrier、application独立semantic preparation模块/test，依实际main adapter固定port；contracts only内部必要类型由root核当时L2/record版本；自身记录|真实全身份和工作区/配置异步交错、两库SQL锁及WeakMap一次性测试；只零网络prepare，不导出半校验registerDispatch。需root审核实际Q1冻结源/主adapter，不读Luna活动源|
|后续S3任务/传输/发布/desktop|沿共享任务已接受设计再派|durable reserve、独立政策组合终态、provider/事件/全参与者退出以及真实Electron仍未验，不纳入Q1/Q2隐式授权|

不新增依赖、不复制generator算法或grader。若Q1文件范围因实际依赖需调整，先交root明确而非擅改其他旧WIP。原attempt/grade/mastery、question2.0.0/scoring2.1.0、capsule1.0.0和S1 read返回契约不变；新binding version独立。

## 8. 待执行真实回归矩阵

本轮没有运行以下实验，均为接受后自有夹具与真实索引验收门。

|层/场景|必须验证|
|---|---|
|Q1真实TS索引四题型×project/legacy×空/非空ignore|发题来自actual SQL generator，三行原子保存重开，完整preimage等实际发行题；原grade/attempt/source/mastery字节行为不改；binding仍not-checked|
|四题型对抗|同id/variant改prompt/objective/difficulty/choices/checks/evidence范围，重算question/rubric/capsule/binding全部摘要：generator完整比较失败；真多调用位置备选路径各完整合法，混拼拒绝；变量所有角色与重复引用原索引/规范索引精确对应|
|请求与数组顺序/对象variant歧义|project/module/symbol scope、conceptId/count/candidateIndex不同；图payload数组顺序变化；真实GraphEdge对象join造成同路径数/长度但不同root或edge集合的同variant/id异preimage：原Map选择/返回/count/本地grade逐项等原generator，原variant字符串原样不改，仅新增绑定unavailable/ambiguous-generator且不能语义发送。完整备选path配对/顺序不丢，不挑边ID重造variant|
|retry真实SQL历史与ordering engine|失败同map重答不偷偷改retry；重新发题取新cut；发行后插入回退completedAt历史不影响旧cut；匹配projection/hash或witness变化、两个时间相同attemptId排序严格核。保存locale相同但Node/ICU/V8/CLDR身份不同、版本缺失/locale不支持：仅认证unsupported-ordering-engine，旧历史与本地grade保持；相同engine仍完整重建输出，不同即拒绝。rowid人工复用仅断言实际匹配投影变化/错source可被发现，不宣称能检测所有重写|
|旧记录与预算|无capsule、S1 ready无binding、旧attempt同id自洽重hash均本地可读而remote legacy-unbound；不回填；长variant及超128KiB question/8KiB basis仍保留本地grade+unavailable，无路径裁剪；无可信capability写不能verified|
|提交异步/SQL故障|首次await后改caller字段、替换map题、关闭app/store、配置变更/第二连接commit；binding INSERT/读回触发器故障：三行全回滚、原题按失败重试，无孤儿binding、不增mastery，移故障重试正确|
|Q2当前性真实两连接|workspace校验后变ignore revision/config、source同长篡改、重晋升同snapshot A→B→A、wrong source/settings/authority实例，dispatch前/发布前barrier拒绝；两连接锁住actual配置/source/global，不事务await|
|Q2 private receipt|普通DTO/历史read伪token、cross-store、close、二次用、Promise/thenable回调、prepared preimage/body变均失败关闭，零task/slot/result/网络；作用域结束即失效|
|完整body/政策|同package仅system/schema/body变不复用；只feature grant不能语义prepare发送；actual provider/model/credential/auth/context revision变化拒旧capture；独立revoke不会改本地确定性成绩|
|后续发布/停止门|沿S3矩阵执行；本设计不声称已补跨库原子性、durable HTTP窗口、真实用户授权/GUI或全worker退出|

派发后适用tests包括ownership generator、contracts binding、graph binding/capsule/S1及application ownership-capsule与原remote回归，相关包noEmit；实际命令按冻结文件核对。本轮只读源码与文档/全WIP hash验证，不运行Vitest/编译或迁移。

## 9. 冻结与规则

交root独立审查后才派源码。Q1提供新提交原题合法性/出处及历史拒绝，Q2补实时barrier；二者不提供隐含网络许可。迁移只是建议，不占用编号；全部已冻结源/AGENTS/包锁不变。AGENTS新增/修订0：没有新代码或复现实验可沉淀，已有证据/原子保存/停止/当前性规则适用；设计不是已验证工程经验。
