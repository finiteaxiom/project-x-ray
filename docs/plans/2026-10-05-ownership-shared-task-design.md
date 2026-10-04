# 2D-S3-D 共享任务与语义后台实施设计

2026-10-05，待协调方独立审查，尚非源码实施授权。范围为原第二批、Windows、原四批结束后暂停。依据[本轮边界](2026-10-05-ownership-shared-task-design-plan.md)及[ADR0008](../decisions/0008-evidence-constrained-ownership-semantics.md)。本设计只新增自身两份文档，不修改产品源码。

## 1. 实际基线与选定方案

5170仍为codex/llm-explanations、HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8，含既有WIP。协调方报告S2已集成main 2ff849300c8720c3a4ded32de914155521a6ce76；本轮不访问main或把该报告当本地HEAD。已核批准计划、L2两文件SHA及本地源：

- remote-explanation-store.ts的migrate/registerDispatch/finish/releaseDispatch/recoverInterrupted（约36、177、200、214、221行）：唯一索引只约束旧表；finish不改inflight；release拒dispatched；recover直接清旧表占用及关context。
- graph/index.ts的withExplanationRevisions与discardFailedExplanation（约116、124行）：global→settings→source同步锁序；completed禁止补偿。
- application/remote-explanation.ts的gate/start/cancel/政策变更/recover：preview一次消耗，dispatch同步发起后等待不持SQL锁；项目结果先提交，global成功为发布门；cleanup失败不提前release。
- desktop/explanation-broker.ts的stopConfirmed/start/event：确认旧worker退出后才补偿与recover；pending20、issued20目前都是feature内部集合，不能再建一个semantic20集合翻倍。现有schema不提供semantic任务状态/结果。
- S1仍prepare-only/not-checked；S2仅存独立政策。L2 identity只证明形状。5170 llm目录没有语义adapter实现，不能在本设计假定其实际函数签名或已运行主目录adapter。

选定新增global共享占用表与UUID登记表，旧feature表保留，新semantic任务独立表。只一行openai占用；purpose不是占用主键。任务元数据与项目语义结果分离，旧feature literal、payload、历史创建时间和成功结果均不扩写。

不采用两张独立锁、不把旧表union查询当唯一并发约束、不把迁移作为停止证明。SQL提供并发互斥；发送许可还必须通过应用当前性、政策、凭据、真实body及可信main窗口门。

## 2. 表、严格DTO与迁移

下列新迁移编号写作G_SHARED和P_RESULT，须root实际分配。协调方拟将14仅分配给A1的global registry/lease；此处记录拟议分配，不运行、不占用迁移。semantic任务迁移G_SEMANTIC及结果迁移P_RESULT后续另派编号，不包含在14内。不得占用12或修改原迁移10/11/12/13。global现在13，Sol project12、main project11；角色迁移允许稀疏。

|表/位置|列与约束|用途|
|---|---|---|
|remote_task_registry / global|task_id UUID PK；purpose两值；owner_session_id、repository_id、context_handle、context_epoch、identity_digest、identity_payload、created_at；payload≤16KiB|跨purpose全历史UUID唯一，保存无正文完整身份；固定canonical digest与列一致性|
|remote_provider_lease / global|provider PK且当前仅openai；task_id UNIQUE引用registry；purpose、identity_digest、stage(reserved/registered)、created_at；严格列匹配|单provider一个占用，terminal也不自动释放；reserved不证明网络发生|
|ownership_semantic_tasks / global|task_id PK引用registry；owner_session_id、repository_id、phase、inflight 0/1、binding_hash、created_at、completed_at、payload≤16KiB|strict语义任务元数据；preparing不落库；身份用冻结L2 schema|
|ownership_semantic_results / source(project或legacy global)|task_id PK、repository_id、snapshot_id、identity_digest、binding_hash、payload≤256KiB|严格已验证辅助结果及无snippet引用；没有原始body/key、完整答案或完整rubric|

future contracts/ownership-semantic-task.ts新增严格record schema（identity=L2原schema；phase仅dispatched/completed/failed/cancelled/interrupted；createdAt/completedAt/code沿用旧有限枚举），不改L2 identity字段/版本、不扩旧remotePurposeSchema。新result schema放独立ownership-semantic-result.ts：version1.0.0、identity、validatedAssessment（现有semantic协议输出的已验证类型，接线前核实际主契约）、checkedAt/completedAt、无snippet精确引用和本地限制。语义结果不持有passed/location/structure/mastery。所有列、canonical payload、digest、状态时间组合逐次严格核验，损坏固定POLICY_INVALID，永不返回默认task、补造许可或修复历史。新task/registry预算16KiB须用全部字段合法最大值测试证实；超过只拒绝新记录，不缩小旧feature原262144读取限额。legacy feature registry迁移payload采用现有合法身份，预算须同样证明。

G_SHARED单IMMEDIATE事务：只创建registry/lease两表→验证并逐行登记所有旧任务UUID→复制每条inflight=1到共享lease→安装feature桥接触发器→写迁移标识。复制identity与原createdAt，不更新旧行/inflight，不创建语义任务，不恢复worker。旧terminal且inflight=1也复制为registered，继续阻塞。旧dispatched且inflight=0、inflight非法、phase/owner/payload错配、重复UUID、超过一条旧inflight（即使旧索引被破坏）、共享新表半升级不一致，全部失败关闭并回滚DDL/标识；不挑一条、不释放、不改completed。空旧库可正常升级。重开需验证新schema及registry/lease/任务一致，不能仅因迁移号存在跳过坏占用。project不创建global registry/lease、不标记G_SHARED；G_SEMANTIC及P_RESULT只在后续实际任务/结果切片创建合角色表，project始终不创建global任务表。

保留explanation_single_dispatch冗余约束。feature INSERT/UPDATE用数据库触发器把原inflight与共享表绑定，防止只更新旧表的写路径绕过全局约束：新旧任务INSERT登记同UUID，inflight=1原子抢lease；从0→1禁止terminal重新激活；从1→0只能在terminal且identity完全匹配时删本任务lease；phase变化不删lease。reserved同任务同identity可在注册时原子提升registered，任何其他task/purpose抢占BUSY。feature release 0→0不删除别人的lease。新semantic写通过核心同事务维护，另设一致性触发器约束。所有触发器有限固定错误，不回显SQL；SQLite UNIQUE碰撞区分UUID冲突REVISION_CONFLICT和占用BUSY，不能把任意constraint都映为BUSY。预先SQL核查和唯一约束同时保留。

桥接触发器是当前进程路径的防误写保护，不承诺旧二进制持续共存。原旧recover的UPDATE可释放旧feature slot，安装新程序必须先停止所有旧worker/旧版本进程；多版本同时运行不在批准兼容范围。新recover入口统一两用途；单纯CREATE trigger不能证明停止，也不能覆盖旧进程安全边界。

## 3. 核心API与可信边界

新内部SharedRemoteTaskStore由GraphStore同connection私有持有，role=global；不通过IPC暴露通用SQL/identity/finish/release。对外仅可信application端口，new schemas是数据不是capability。

|内部端口（拟定）|锁/前置|行为|
|---|---|---|
|readTask(key:{purpose,taskId})|strict key/role/open|查registry再分表，身份列全核；错purpose拒绝，缺返回null|
|reserveVerified(capture, barrier)|自建同步IMMEDIATE；barrier为store绑定不可伪造对象|核实际授权/provider/context及绑定；登记身份并提交reserved lease；无网络、无dispatched任务|
|registerVerifiedDispatch(key, barrier)|持global→settings→source IMMEDIATE，barrier单次消费|核reserved精确身份或现有feature兼容路径；插入dispatched/inflight1、lease提升；本方法自身不发送|
|recordUndispatchedCancellation(capture, createdAt)|同身份注册/真实context；无permission要求|只写cancelled/inflight0；预备保留的本task slot须在已确认零dispatch路径后释放；无slot时不改别人|
|finishTask(key, code)|IMMEDIATE，实际task identity匹配|仅dispatched→一次终态；重复返回原terminal/code，不覆写成功；保持slot|
|releaseAfterCleanup(key, identityDigest)|可信编排已完成停止与发布/补偿前置；IMMEDIATE|只匹配自身terminal slot；重复已释放无写，别的slot不删；dispatched拒绝|
|recoverAfterWorkersStopped(stopReceipt, knownPublications)|可信broker私有生命周期receipt；无renderer boolean|统一标unfinished interrupted、known库补偿、关闭context、完成后释放；任一步失败不释放剩余slot、不重发|

barrier不是caller提供callback“校验成功”、普通L2 DTO或S1包。后续GraphStore.withOwnershipSemanticRevisions(identity,settings,source,work)私有构造一次性WeakMap receipt，绑定精确source/settings实例、owner/context及材料canonical preimage；只在同步锁段内有效，拒绝Promise，结束/close即撤销。read historical package不能创建该receipt。stopReceipt由可信生命周期协调器在实际所有旧generation退出后生成，store内仅接受绑定当前恢复session的一次性对象；不是序列化DTO或worker自报退出。graph不依赖Electron，凭据与停止由注入的可信application/main端口证明。首次核心切片不导出semantic reserve/register许可；测试只能使用包内夹具，不能让应用生产调用一个半校验路径。

现有feature registerDispatch调用保持RemoteCapturedIdentity原schema和返回shape，SQL共享占用由触发器和核心实现；其release/recover须委派核心，不能留第二套清锁代码。A1仍仅feature可发送，不创建semantic任务、不导出semantic reserve/register/dispatch API。自有SQL夹具可植入与registry一致的semantic lease，仅证明共享约束，不能称真实语义任务可用。A1 feature-only recover在同一IMMEDIATE事务、任何终态/context/占用修改之前检查共享持久占用：遇非feature purpose（或无法验证的行）固定POLICY_INVALID、全事务零写且保留占用；不尝试清它或伪造stopReceipt。只有实际全用途任务及生命周期参与者门完成后才切换统一recover。启用semantic之前必须完成下面的durable reserve和统一恢复接线。

权威createdAt只在首次真实持久登记分配一次。未来reserveVerified将可信本地时间T1同时写registry.created_at与lease.created_at；稍后的promotion即使本地已到T2，也必须从严格核验后的registry读取T1写dispatched task.createdAt及阶段事件，不再now()。同identity的undispatched终态、finish、恢复interrupted及事件均复用T1，completedAt是独立可信终态时间且不得早于T1。重复登记/finish/release不更新T1，读出列与payload时间不等则失败关闭。direct feature无reserve兼容路径由第一次task登记分配一次可信createdAt，触发器复制该值到registry/lease；未持久化的preparing起始时间可单独保留，但首次持久化后所有事件必须统一权威createdAt。取消首次登记沿原可信application已捕获的createdAt核验并固定；renderer不能指定。迁移旧任务直接复用旧createdAt，不因升级或恢复重造。reserve存在时取消参数时间必须等于其T1，否则拒绝，不能覆盖。

### 持久预占用与commit失败窗口

实际feature start在gate事务内调用provider.dispatch，然后事务commit；原测试已有“commit失败后同步发起过一次、零task/result、无重试”场景。仅在同事务新增共享lease会随rollback消失，不能据此声称失败后的两个purpose仍互斥。此处是待证明的集成风险，本轮未执行双连接网络交错，不定性为新已复现产品缺陷。

选定启用两purpose transport前增加durable reserve阶段：async凭据/工作区/完整body准备完成→同步全门核验，单独提交reserved lease→第二个同步全门重核、注册并发起一次→await无锁。第二事务commit失败时第一个已提交reserved slot仍在；入口关闭/abort/可信worker退出后统一recover才能释放。reserve提交失败必须零dispatch。final gate或body失效且尚未发起则记录cancelled/failed并确认零dispatch后release；若SQL terminal失败保留reserved，由停止后恢复处理。reserved行的registry保存完整identity和createdAt，恢复可追加interrupted任务而不假装发生dispatched。没有权限时不得预占用。仅reserve成功也不能当真实发送许可。

两次锁段之间政策变化允许发生，第二段必须全核；不能为了避免变化跨await持锁。SQL不能与外部HTTP原子commit。若同步dispatch返回非Promise/抛错，也按“可能已经发起”处理，保留durable slot至停止确认，不再次发请求。每个task内存dispatch latch调用前置位；重复start选择固定BUSY，不返回第二份可发送promise。一个preview消费一次，reserve BUSY也消耗，重试须重新prepare。完成同绑定命中返回已有权威completed结果且零网络。

## 4. 当前性、绑定与去重

prepare只读历史材料并异步重算，不发送、不登记slot。主可信端生成owner/context/task/preview，renderer未来仅传ref/attemptId及preview/package标识。prepare完成后重新持锁核据，生成展示完整出站体的preview，TTL沿feature五分钟；grant改变revision后旧preview不可复用。使用当前provider生成完整body digest，不允许caller supplied endpoint/body/hash替代。

|字段/依据|异步步骤|同步重核位置|
|---|---|---|
|repository/snapshot/activation、analysisResultFingerprint、manifest/config/ignoreHash/revision|checkWorkspace真实目录与排除策略，检查后捕获修订|source activation/manifest及settings真实revision；global→settings→source，legacy同连接只嵌套savepoint|
|owner/contextHandle/epoch及main active ref/generation|可信main窗口映射；不接受renderer owner|实际global context与当前可信active reference；closed/old generation拒绝|
|独立semantic authorizationRevision/provider/disclosure/categories|可在prepare展示denied，但不能start|S2实际global严格记录且granted/六类完整；精确purpose版本；feature授权不替代|
|provider/model/providerRevision/credentialRevision|凭据OS port只读，key仅内存；未来actual adapter全body|global actual settings的model及全部修订/配置状态精确相等；credential读取修订匹配，输出token设置由providerRevision绑定|
|question/attempt/rubric/scoring/semantic versions、全部hash|S1历史package验证，异步hash及未来可信确定性题目重建核对|读取相同attempt/capsule/规范graph/source的canonical preimage并与捕获相等；合法题目与学习目标来自可信生成器，不认可自洽重hash历史作为认证|
|assessmentPackageId/bodyDigest/limitsVersion|实际完整必要路径、答案、rubric构建，不裁剪；hash验证|锁内重构或核私有receipt全材料preimage，再同步hash完整body相等；不能只核两caller hash相等|

S1已明确无法证明原题认证。实现前须新增受当前源码/题型generator约束的question binding验证：使用已保存题型/variant/结构化答案定位合法当次题目，验证question preimage，不用模型判断也不复活被删除的内存question；若不能唯一证明原题，拒绝semantic prepare并保留本地attempt。实现该门可能需要提交时补存可信题目preimage的独立版本化材料；必须由root另行明确字段/兼容迁移，不能本切片猜补或把历史hash升级为认证。当前性门没有这一步不得启用发送。这是阻塞transport接线的准确依赖，不阻塞SQL占用核心自有夹具测试。

binding_hash定义SHA256(canonical完整captured identity仅去掉taskId、ownerSessionId、contextHandle、contextEpoch)，保留真实完整bodyDigest以及repository/snapshot/activation/config/manifest/ignoreRevision、全部question/attempt/rubric/协议版本、授权/provider/model/credential修订、assessmentPackageId/limitsVersion。bodyDigest必须来自当前私有adapter对实际serializedRequest完整UTF-8字节的摘要，覆盖systemInstructions、responseSchema、data及实际模型/传输body字段；不是caller hash、packageId或protocol版本的替代。协调方提供main ownership-semantic-prompt.ts约230–235行serializedRequest含上述三部分的源码依据；5170未复制该adapter，本轮未自行读取或运行，接线时必须按实际已验adapter字节算法核验，不另造相似body。

去掉窗口/session只为完全相同请求及捕获版本的completed跨新preview本地去重；当前owner/context仍需独立全门验证。复用需全去重preimage精确相等（拒hash冲突），历史identity.bodyDigest精确等于当前私有完整bodyDigest，并校验权威completed/result闭合；不dispatch。任意systemInstructions、responseSchema或其余完整body字节变化，即使同packageId/版本字符串/其他identity，也产生不同binding，不返回旧completed作为新结果；保留旧历史，重新prepare展示实际新body，新preview手动start才可请求。若当前body无法精确重建，拒绝复用/发送，不猜补。不得把相同bindingHash当当前许可。进行中重复start统一BUSY；failed/cancelled/interrupted可经新preview/新task手动重试。全provider共享slot已保证不存在并发绑定请求。成功记录不可删除或修改；semantic文本反馈永远不更新原确定性成绩/mastery。

## 5. 状态与失效矩阵

|当前状态|事件|权威任务/slot|网络与结果|
|---|---|---|---|
|preparing（只内存）|取消/preview失效|记录cancelled可选受真实owner核；无slot|零dispatch，零result|
|reserved（已commit，无dispatched）|取消/二次门拒绝|精确terminal记录，确认未调用dispatch才release；SQL失败保留slot|零网络；不补造dispatched事件|
|dispatched|cancel、独立revoke、provider修订、context变化|一次非成功terminal，inflight与slot保持|abort尽力；迟到结果拒绝，停止/补偿后才释放|
|dispatched|成功验证及publish|project append→global completed；slot保持到可信编排完结|精确completed/result可读；无自动重试|
|terminal但占用|其他purpose start|BUSY，其他task零写|无第二请求|
|terminal但占用|重复finish/cancel|原terminal不变|不能复活或覆盖completed|
|terminal已释放|重复release/迟到响应|零写；不能删新task slot|迟到无结果写|
|reserved/dispatched/terminal占用|close/crash|仅关闭不清lease；保持持久占用|确认旧worker全停后recover；无重发|

|变更|受影响preview/task|SQL与本地gate顺序|
|---|---|---|
|semantic grant/revoke/regrant|同repository semantic；feature政策/任务不改|main先关对应入口/事件→S2写与核心terminateMatching同一global事务→abort对应运行；失败保持关入口并停止对应worker|
|feature授权revision变化|同repository feature；semantic授权不改|原saveAuthorization事务委派核心只匹配feature；不得把原application广泛repository abort沿用到semantic|
|provider/model/credential revision|两用途全部preview/preparing/reserved/dispatched|global实际saveProvider+核心两用途terminate同事务，预览全部清；入口先关，提交失败worker停止；不能只旧表terminate|
|owner context/epoch/window关闭或新generation|同owner两用途|原commitTrustedContext委派两用途；其他owner的授权不改；需要全provider恢复时先停所有generation|
|activation/config/source变化|对应repository/snapshot的旧capture|工作区检查后及dispatch/publish锁内全门拒绝；旧completed保留，展示需currentness重验|

S2源码保持冻结。未来semantic政策组合事务由GraphStore窄用例包裹原S2 grant/revoke再调用核心terminate，不能单独commit授权再试图取消任务。低层S2函数仍内部存储端口，不作为main用户动作。所有策略同步commit失败时main关闭gate与终止worker是安全补偿，不把rollback后的旧grant当继续发送许可。

## 6. 发布、补偿与恢复

成功：await返回后严格输出验证、credential回显检查、工作区重验→global/settings/source锁内核同身份和dispatched、当前材料、独立permission→source append新semantic结果→global finish completed。结果仅通过可信application门读取：权威同purpose/task completed、完整identity/digest/binding相等、source结果闭合；裸source低层read不属于发布API。source先commit与global commit非原子，保留这一事实。

global completed失败：设置精确非成功terminal→只在已知source/settings库按identity补偿未发布semantic结果→停止/本地请求结束确认→release。本地primary固定错误保留；cleanup错误另以固定码记录，不能finally吞错或成功返回。finish失败不得补偿/释放；补偿失败保留slot；release失败保持slot，不把失败改成功。completed历史从不删除，即使后续授权撤销/工作区变化。

恢复统一入口替代旧feature-only恢复。可信broker先关全部事件gate、停止持有该provider任务的所有旧worker generation并确认退出，再调用统一恢复：核registry/slot一致→将reserved/dispatched标interrupted（已terminal不改）→对可信已知publication locator执行非成功精确补偿→关闭所有旧context→release。未知source locator不扫描私人项目目录/任意数据库，保留slot或blocked恢复状态，结果不可读，等待可信项目打开后定向cleanup；不是靠迁移号猜库。locator由main已有issued handle/stores(ref)与项目注册表产生，数据库不存任意文件路径。任何BUSY/损坏/cleanup失败回滚该步骤且保持blocked占用；下次恢复只清同identity，不重发。

统一可信恢复参与者选定为main进程唯一RemoteTaskLifecycleCoordinator，而不是feature broker自有stop方法：内部registerParticipant(provider,purpose,owner,generation,port)在worker可接收start之前登记；close/startup恢复先冻结该provider所有入口并递增恢复generation，截取全部participants，逐一关事件gate、abort并await真实exit。未退出的任意参与者使恢复失败，所有lease保留。inventory revision发生变化则不生成receipt，停止过程中不允许新participant启动；receipt绑定provider、恢复generation、停止清单及当前inventory revision，一次消费。正常单任务清理只release精确自身slot，不执行全局recover/关闭其他owner context。feature普通重启只停feature可确认自身任务，不清semantic占用；需要统一全局恢复必须由此coordinator连同semantic参与者一起停止。即便当前仅一worker，也使用同一登记与停止路径，不能另设“已停feature=true”的shortcut。graph只接可信端口给的opaque receipt，不访问worker或Electron；启动时无旧进程存活的证明仍由可信main单实例/进程生命周期边界提供，不能由DB自行证明。

恢复各库分阶段非原子：global先将非成功终态持久化并保留slot，已知source补偿后再global关闭旧context并精确release；source已清但最后global提交失败仍保留slot，重试补偿是幂等零写。成功历史保留。禁止把先前已完成的source补偿宣称随global rollback恢复；恢复记录要列实际每步提交。未知source blocked路径可以关闭旧context但不能释放对应slot，后续可信定向cleanup完成才能release。

旧recoverInterrupted方法未来委派统一核心，并由可信broker同一停止前置调用；不得让feature worker启动时自动清仍运行的semantic lease。第一核心切片不启动第二worker、不修改冻结broker；生产semantic启用前统一broker lifecycle接线是必需接受门。正常成功后provider promise已完成、传输资源已结束才释放；timeout/abort返回不能等同网络已终止，需可信worker停止证明。不宣称收回已发送字节/服务商计算或退款。

## 7. 可派发切片与文件清单

这三段是原第二批内的顺序实施门，不是新增第五批。root审查后另派精确范围，每段依据自己的基线交付patch；本轮不开始任何源码段。

|段|具体文件/API|可运行验收与禁止|
|---|---|---|
|S3-A1共享SQL/feature兼容（拟先派）|新packages/graph/src/shared-remote-task-store.ts及.test.ts；packages/graph/src/remote-explanation-store.ts与.test.ts窄改feature共享注册/释放/恢复保护；packages/graph/src/index.ts仅私有生命周期；index.test.ts仅角色迁移回归；自身新development-run|global仅registry/lease，编号14待root正式分配；保留旧feature identity/返回/正确回归，不改contracts或application。semantic slot只用自有SQL夹具证明冲突；feature-only恢复遇非feature占用全事务失败关闭。不建semantic表、不导出semantic reserve/dispatch、stopReceipt或发送许可，不接durable transport/结果/provider/desktop/UI|
|S3-A2实际semantic任务核心（后续另派）|graph内部任务核心增量及test；contracts/ownership-semantic-task.ts加strict record及test、index单export；graph窄内部任务生命周期与角色回归；自身记录|独立G_SEMANTIC编号由root后分配；真实任务状态/身份/稳定createdAt，不把schema当许可。当前性barrier及参与者门未齐不得导出生产semantic注册接口；具体文件须依A1冻结结果重核|
|S3-B当前性及发布后台|新application/ownership-semantic-application.ts与test；graph/ownership-semantic-result-store.ts与test；独立contracts semantic-result及test；graph窄revision barrier与真实题目binding port；原remote application仅durable reserve/统一生命周期核心接线及对应test；自有记录|真实索引→提交attempt→严格题目绑定→零网络prepare→自有fake provider start→两库completed门→read；两用途reserve/commit故障窗口；不启用真实网络。必需实际main adapter依赖、题目认证设计和迁移分配齐备，不能用S1降级替代|
|S3-C可信main/desktop到UI|root另派provider/worker/broker/contracts desktop/UI精确文件清单；复用一个共享生命周期/窗口登记，不两个独立broker锁|真实Electron授权/preview/start/cancel/currentness与事件门，OS凭据/真实网络需各自授权。未独立GUI验收不能宣称整链完成|

S3-A的feature旧正确回归原样保留（legacy12/main11角色区别维持），新增共享冲突测试；若改变旧断言语义，必须解释而非删断言。S3-B durable reserve将给旧commit失败场景增加“旧task仍零写但共享reserved持久存在”断言，保留原一次dispatch、零结果、无重试断言。在该门完成前S3-A仅证明SQL注册互斥，不能声称外部HTTPcommit失败窗口已关。

窗口预算选ADR0008两用途合计20个无正文issued元数据：共享TaggedIssued map、purpose判别且内部identity不同；满额只淘汰最旧已terminal且已释放项，20项全部活跃/blocked则LIMIT_EXCEEDED不淘汰占用。pending RPC沿现有20上限但与issued不是两用途各20；preview每owner两用途合计1、prepare controller合计1，新prepare使旧preview失效。SQL历史任务不限制20，不删历史来满足窗口预算。固定远程request64KiB、response256KiB、source24KiB、network60s/task90s；真正semantic adapter最终预算仍需实际strict协议核验，不改本地10000字符答案上限，超远程预算not-evaluated且无dispatch。

## 8. 独立验收实验矩阵（全部为待执行）

每条用自有DB、fake provider计数、必要两个真实SQLite连接和SQL触发器/延迟约束；不执行导入项目代码。日期/模型实验不当作生产GUI证据。

|编号/层|交错或故障|必须观察|
|---|---|---|
|A1 graph/两连接|feature注册持锁→semantic竞争及反向|锁内BUSY/提交后BUSY；至多一slot；败方无task/result；占用任务identity精确|
|A2 graph|feature/semantic terminal未release、重复finish/release、新task后旧release|terminal占用阻止另一purpose；原code不变；旧release不能删新slot|
|A3 migration/global/project/legacy|旧dispatched1、terminal1、零占用、多个非法1、损坏payload、DDL/标识触发器故障、关闭重开|合法原inflight与时间不改；坏升级全rollback；project无global表；旧11/12、13及历史源字节不变|
|A4 graph|UUID跨purpose碰撞、wrongpurpose key、列payload错配、metadata预算、closed/Promise callback|固定拒绝且零写，不回显私有值；不丢旧任务|
|A5 graph/两连接|registry/task/lease任一步INSERT触发器失败、BEGIN IMMEDIATE BUSY、release失败|全事务回滚或既有slot保持；移除故障可安全手动重试；不双占用|
|A6 A1 graph/恢复|自有SQL植入严格匹配的非feature registry/lease，调用feature-only recover；含旧feature terminal/context|任何写入之前POLICY_INVALID，所有表及context/时间零变化，非feature slot保留；不创建semantic任务或stopReceipt。缺表/坏行同样失败关闭|
|A7 A2/B app/受控时钟|reserve T1→时钟前进T2再promotion→重复finish/release→停止后recover及迟到dispatched/terminal事件；另测direct feature与迁移|registry/lease/task/所有实际阶段事件createdAt均T1；promotion/recovery不得重造。completedAt独立不早于T1；重复零时间写；旧迁移字节不变；事件按稳定identity/T1与真实sequence接纳，错时间/重复/回退拒绝，不补造阶段|
|B1 app/provider计数|重复start、preview消费两次、同binding completed重用、failed新preview重试|BUSY选择稳定；同preview最多1调用；completed零网络；手动新task唯一|
|B1-body app/实际adapter私有body|同package及其他identity/版本字符串，仅systemInstructions变化、仅responseSchema变化、或完整body其他字节变化；caller伪造旧hash|真实bodyDigest及binding变化；旧completed零复用为新结果；prepare/复用检查本身零dispatch，需新preview明确手动start才请求一次。caller hash不得开门；完整体无法重建时失败关闭；旧成功历史不变。该矩阵待执行，不称现有产品缺陷|
|B2 app/两连接|异步workspace后、reserve后、dispatch前改auth/provider/model/credential/context/ignore/activation；A→B→A同snapshot|同用途独立失效/共享provider两用途失效；陈旧全零dispatch；当前性失败不发布|
|B3 app/真实材料|重写questionFingerprint并重hashrubric/capsule、同长source篡改、路径证据混拼、当前auth仅feature|题目认证/完整路径失败关闭；S1/schema不能开门，零网络，旧attempt/grade/mastery不变|
|B4 app/SQL commit故障|reserve commit失败；durable reserve成功后注册commit失败且同步dispatch已启动；第二连接竞争|前者零网络；后者slot仍占、另一purpose BUSY；abort/stop后recover无重发|
|B5 app/两个库|source append提交后global completed延迟约束失败；finish/cleanup/release分别BUSY；完成后旧错误迟到|权威非成功不可读，精确补偿；任何cleanup未完slot保持；completed历史不删，固定primary错误不掩盖|
|B6 app/恢复|reserved/dispatched/terminal崩溃重开，停止失败/延迟退出，known/unknown source locator|stop前零release/零recover；全退出后统一两用途interrupted/cleanup；未知库不扫描不开放；零重发|
|C1 desktop fake生命周期及真实Electron|错window/generation、terminal先入DB后dispatched事件迟到、撤销commit失败、两purpose窗口20项|完整identity/实际sequence判别，不补造阶段；gate关闭旧响应拒绝；预算合计；真实GUI单独验收|

实现回归命令由派发实际文件决定：vitest单worker/no-file-parallelism/no-cache运行shared-task、旧remote-store/index/capsule/S2；B再加remote-application、semantic应用及严格contracts；相应包noEmit。本轮仅源码阅读和文档校验，没有运行这些实验或复用旧146作为本轮设计验收。

## 9. 交付结论与规则

设计冻结后交root逐条审查：迁移号、S3-A精确文件、题目binding依赖、durable reserve与恢复receipt必须确定后才实施。当前已确定SQL共用占用/升级保持/逐状态规则；实际语义发送与真实授权交互仍未实现或验收。S2及所有旧WIP保持冻结。本轮AGENTS新增/修订0：无新运行复现实验，既有事务/停止/跨库补偿规则覆盖原则；设计风险不是已确认工程经验。
