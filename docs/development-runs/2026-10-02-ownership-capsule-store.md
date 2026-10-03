# 2B-S4：本地胶囊事务端口

2026-10-02启动，2026-10-03恢复并完成限定实现/回归，等待协调方独立验收。以下保留开工依赖报告；最新状态、失败闭环及限制见最后“最终交付”节。

## 基线与授权范围

worktree HEAD实际为`455d4ad50830ee2495b70927e51caf830a4efbb8`，保留全部旧未提交改动；协调方报告S3已接受并精确集成main `1da4d8191265e741096278b37b2eeb1f8577f323`，该main Git动作不是本worktree执行结果。本批只允许新增graph ownership-capsule-store源码/测试与本记录，修改graph/index.ts必要迁移/prepare/receipt/save/read接缝；迁移号11。contracts、ownership/builder、application/S5、其他barrel、性能、桌面/IPC/provider/依赖/旧接线冻结。

Get-FileHash实际核对本worktree与main graph/index.ts相同，SHA256 `B27AD24878AE1EC086D05D5228D0D1A16F3DCA0C443C17B9DD0427C06F660631`。读源码确认本地迁移1–9与remote10，没有修改既有7/10。隔离`:memory:` GraphStore使用当前Node/native运行时打开成功，直接查询schema_migrations得到1–10，`PRAGMA foreign_keys`为1；exit0。这只证明现有运行时可跑定向真实SQL，不是新迁移/端口验证。未运行索引、build/native/dist/Electron/HTTP/凭据/GUI/Git收尾。

## 具体读取材料缺口

已接受计划给出的重开端口为`loadOwnershipCapsule(attemptId)`；S3公开`validateOwnershipCapsule(raw, question, attempt)`要求完整原题，先核对question—attempt关联，再用完整question计算questionFingerprint。现有ownership_attempts只保存attempt；ready胶囊保存题目基础字段及选中rubric/必要证据，但没有完整choices、evidenceIds、expectedNodeIds、deterministicChecks/合法备选和concept；not-evaluated连基础题目字段也没有，只持完整questionFingerprint/attemptHash/固定sourceIdentity。GraphStore没有持久question表。Passed题目还会在application内存中删除，重启不能取得原题。

因此单参数重开读取无法直接调用已接受validator核验完整原题摘要；从snapshot重新createQuestions或从ready rubric捏造原题会更换当次完整preimage，尤其无法恢复所有备选、retry和原数组顺序；not-evaluated更无法重建。不能悄悄持久化完整question/源码，不能把“重新计算capsule摘要与列值相同”当作完整原题/真实证明核验。

四文件内可选的窄接缝：

1. 推荐保留单参数受限历史读取：严格schema、Node重算实际attempt/capsule完整摘要与关联列；依据已存同snapshot事实及不可变source记录核对ready的node/edge/proof/role、并在事务外用现有公开async函数核验rubric/limitation/answer/projection闭合。明确读取不独立重算完整questionFingerprint；该值是prepare阶段验证后持久绑定的摘要，历史read不升级为“原题独立验证”。需要协调方接受这个明确的读取保证边界，之后不伪造question调用S3validator。
2. 若要求读取时再次全量复用S3validator，则窄端口必须增加调用者提供完整原题`loadOwnershipCapsule(attemptId, question)`；先捕获原题并核对其完整指纹，再核对持久来源事实。该端口仍可在四文件内，但无原题时只能返回明确受限状态，不能宣称重启后全量读取已可用。原题取得/保存属于后续需要单独界定的材料问题，本批不修改application或存整题。

prepare本身可合法接收完整question/submission/attempt/capsule/source与settings身份，在首次await前私有捕获，异步完整验证后封存WeakMap receipt；同步settings→source锁内读权威快照/配置及两INSERT也有现有接缝。阻点仅是读取的保证与材料契约尚未明确，不是native环境或四文件实现能力。本次先依派发“必要读取材料缺口先报告”要求呈报，没有静默选较弱读取语义或扩持久化字段。

## 初始依赖报告时的实际动作与未执行

只读Git/源码/计划/哈希，加一个隔离内存SQLite探针和本记录新增。graph/index.ts尚未修改，新源码/测试尚未创建，11未施加。没有产品红测、原子保存、receipt、损坏读取或迁移回归结果。本轮当前无AGENTS候选；边界确定后继续真实红绿与最小充分SQL/类型验证。

## 协调方读取设计决定（实施依据）

协调方明确采用方案1继续限定四文件：`loadOwnershipCapsule(attemptId)`为Promise的受限历史材料读取。短同步读事务内捕获同源attempt/capsule/snapshot及必要持久事实/源码，释放事务后执行公开async校验，不在锁内await、不复制私有normalize、不捏造question。返回ready/not-evaluated均有`questionBinding: "prepare-only"`固定保证标签；旧attempt无胶囊为`legacy-capsule-absent`，attempt不存在为`not-found`，存在胶囊但损坏固定拒绝。

prepare仍验证完整原题、原attempt与胶囊的关联及全部摘要。历史read只核验该历史snapshot的事实、源码manifest、必要关系、精确span/contentHash及role/projection/临时DTO闭合，当前activation/配置可合法变化而不改历史；完整questionFingerprint仅绑定prepare阶段，不在read时重算。摘要/标签都不是认证或当前授权，不保证抵御任意全部重写并重算摘要的数据库，也不证明模型文本正确。未来外发与工作区当前性另行验证；不新增该能力。本决定不扩大四文件、不改冻结S3契约，不存整题/重复源码。

## 最终交付（2026-10-03）

### 实现范围与结果

仅新增本记录、`packages/graph/src/ownership-capsule-store.ts`及`.test.ts`；修改`packages/graph/src/index.ts`的私有store初始化、迁移挂接、capture/prepare/save/load四个内部窄方法和close清理。旧saveOwnershipAttempt函数体、7/10迁移、其他GraphStore查询/缓存及全部冻结模块未修改，没有新barrel导出或依赖。已接受S3三处关键文件hash本次实际再次核对未变：contracts/capsule为5D1759AB...4B0E44F、ownership/builder为BD96CC66...9C59165、contracts/index为5EA6DFEC...696557A。worktree HEAD保持455d4ad，没有ff/reset/提交/推送/合并，没有触碰其他checkout。

迁移11在事务中仅创建source-owned ownership_semantic_capsules并记录版本，以attempt_id外键指向同库ownership_attempts，ON DELETE CASCADE；实际开启外键后验证，global role仅source兼容，不增加policy/provider端口。两INSERT均为普通INSERT；旧attempt不能补挂胶囊，重复ID即失败，旧payload字节不重写、不回填。

prepare首await前descriptor检查并完整私有捕获纯输入，不执行getter或遗漏symbol/不可枚举字段，不把schema剥离后的副本当完整摘要原文。短读事务核对真实快照、物化nodes/edges/evidence的ID/列/完整payload、源码原文hash/bytes和manifest、analysisResult（可用时），并绑定完整analysisIdentity与source capture及settings修订。事务结束后调用已接受公开validator，核验完整原题/attempt/capsule与其关联；ready另由实际持久来源重建完整临时DTO，用现有公开async函数校验rubric/limitation/answer/projection闭合，不复制私有normalize。

私有WeakMap一次receipt持有已验canonical字符串及共享question/attempt/capsule/projection preimage，向外仅返回无字段冻结opaque对象。save尝试即消费receipt，未知、其他store、重复、关闭后receipt拒绝。同步settings IMMEDIATE→source IMMEDIATE顺序，重读完整源快照/manifest/analysis/activation/config/ignoreRevision、检查同ID冲突；Node createHash只消费已接受preimage。失败不复用旧材料，重新prepare后可安全保存。锁内无await或文件系统访问；未引入调用者work回调，双INSERT位于同一同步source事务，任一失败回滚两行。

晚期not-evaluated可能保留非空submissionProjectionHash。此时新增prepare输入的可选原`submission`在该分支实际为必需材料：捕获完整原文/原引用/原角色，按完整citation key核对去重与S2a规范结构，依据同快照真实关系核对role bindings，调用共享projection hash，再将完整submission字符串与projection preimage封入receipt，保存重算其摘要。不能用完整question/attempt/capsule摘要替代该独立投影验证。ready可从胶囊已保留citationOrder/roleBindings完整重建投影；传入原submission时也核验。not-evaluated投影为null时不捏造部分投影。未在SQL存submission/整题/新增源码，仅在准备阶段私有内存持有这些材料。后续S5须为非空降级投影提供原submission，本批不提前修改application。

load在短同步事务捕获同源attempt/capsule和该历史快照/物化事实/原文；重算实际持久对象的完整摘要并核对列/跨记录绑定。释放事务后才做async闭合验证，ready所有必要node/edge/proof、精确范围/contentHash、角色映射与DTO均回查捕获的真实持久来源；读取期间后写不会混拼两版。ready/not-evaluated都返回questionBinding:prepare-only；old缺胶囊返回legacy-capsule-absent，不存在为not-found。胶囊存在而列/payload/hash/关联/来源损坏固定失败，不伪装缺胶囊。历史读取不查当前settings修订或要求当下激活，不改历史、不增加外发门。

### 实际反馈闭环及失败分类

1. 初始内存native/迁移探针exit0，只证明现有Node/native可用及版本1–10/FK=1。提出读取材料缺口后由协调方选择prepare-only受限读取，未擅自保存或重造原题。
2. 首版生产类型检查exit0。初版新测试22项中21通过、1失败；同时测试类型检查发现未定义占位名awaitReceipt。测试失败栈在fixture的hashOwnershipAnswer：样例原答案重复2000次为18KiB，却在转为降级测试前调用了16KiB受限hash。改为1500次13.5KiB、另单独设置完整孤立代理并使用nullable answerHash；删除无实际断言的占位行。属于测试构造/准备问题，不是产品缺陷，不降schema/预算或断言。
3. 修正后22项与graph noEmit通过；进一步补nullable/两库竞态/一致历史/认证边界/孤立关联后28项通过，再补三类关系的保存读取与错原题拒绝，完整graph 5文件61项通过。未运行真实索引或GUI。生产源码曾按02DBA99E...D9BCF9及index7376BF35...82DAA7F冻结供协调方只读审阅；对方报告无已确认产品缺陷，不等于SQL独立验收。
4. usage limit中断导致记录停留在准备状态，2026-10-03明确恢复后从实际文件/哈希继续。中断是执行限制，不能记作产品失败或把旧报告当本次验收。补实际四型generator/grader/builder结果消费，定向35项和限定13文件226项通过；测试只通过运行时模块加载组合已接受模块，交换公开contracts数据，不改变graph生产依赖/rootDir/barrel、不执行分析器或导入仓库代码。
5. **本次自检确认产品缺陷**：实际builder的5275-byte合法variant在晚期rubric预算降级中返回非空projection hash；原prepare输入只有question/attempt/capsule/source，缺原submission，也没有重算该辅助投影。实际定向红测`node node_modules/vitest/vitest.mjs run packages/graph/src/ownership-capsule-store.test.ts -t 'builder晚期'` exit1：预期缺材料拒绝，旧实现却成功发出receipt。没有伪造产品失败，不能把胶囊自身hash匹配当该投影已核验。
6. 明确撤销旧store稳定hash，仅在原四文件范围修正prepare原submission接缝与完整投影核验/私有封存/同步摘要，不改S3/builder/contracts或SQL字段，index仍原稳定hash。红测改绿；额外确认任意非空projection重算胶囊自身hash仍拒绝，控制首个摘要暂停后修改原submission不污染捕获，原大attempt完整保存并可受限历史读取。最后限定回归与类型全通过，结果见下。

### 最终实际命令与结果

- `node node_modules/vitest/vitest.mjs run packages/graph/src packages/contracts/src packages/ownership/src`：exit0，13文件、227项通过。本worktree graph为5文件66项，其中新SQL文件36项；其余contracts/ownership回归161项。没有声称主checkout已复验。
- `node node_modules/typescript/bin/tsc -p packages/graph/tsconfig.json --noEmit`：exit0。
- `git diff --check -- packages/graph/src/index.ts`：exit0；HEAD仍455d4ad。
- 本次补测前后原S3源/两行contracts导出哈希保持一致；生产源hash撤销/更新已报告。最终四文件hash由交付回合直接Get-FileHash取得，本记录不自嵌自身hash。

覆盖证据：实际四型createQuestions→gradeAnswer→buildOwnershipRubricCapsule→prepare/save→SQL重开，原分/结构/完整payload保持；ready/not-evaluated/旧缺胶囊/not-found分支；Unicode合法代理对与完整孤立代理JSON转义的WebCrypto↔Node一致；5275-byte variant、>19KiB原attempt及100引用不缩小，小降级胶囊≤2KiB；首await前捕获和prepare后对象变化、getter不执行、未知/跨store/复用/close receipt；两个INSERT故障切点零写并重prepare；重复/不同payload/存量ID不覆盖；旧库重开迁移11，7/10时间、旧payload与源码字节不变，FK只删除同attempt胶囊。

并发/损坏覆盖：真实第二SQLite连接在保存前改变activation/源码/settings/完整analysis config均两行零写；跨source/global与project/settings两库的写前配置变化拒绝，source INSERT触发器用第二settings连接实写确认外层settings锁仍持有；nullable不可评来源仍以完整capture核验实际配置；历史current/settings合法变化后只读旧材料，首async摘要处inTransaction=false；短读捕获后第二连接损坏源码，当前读取只用原捕获，下次拒绝；列/attempt/hash/JSON/role/proof/source/物化edge列/evidence payload损坏固定拒绝，孤立胶囊不能伪装not-found。

认证边界亦有明确测试：连同rubric/capsule摘要完整重写questionFingerprint时，受限历史read仍只能返回prepare-only，不能宣称独立原题认证；原question送prepare会拒绝该改写。摘要不是签名，任意全面重写并重算数据库不在此认证保证内。晚期降级投影的非空摘要仅准备阶段全量核验；not-evaluated未保存其映射，历史read不重新构造/升级投影保证，也不作外发材料。

### 限制与规则候选

未执行main独立SQL验收、真实仓库索引/分析器、application/S5集成/答题取消/工作区重新检查、Electron/GUI/IPC/provider/模型/HTTP、凭据、性能cache或Git收尾。本批没有build/native/dist安装/重建或外发；现有native运行未修改。SQL样例事实是隔离合成数据，generator/grader/builder为实际模块，但不代表真实分析器正确性或自然语言语义质量验收。历史capture只保证捕获时一致，返回值不是当前工作区或远程授权。

AGENTS未修改。提出 **1条候选** 供协调方查重：接入预算降级结果的持久化前，应按每个非空辅助摘要逆向核对prepare所需材料并独立重算；完整主记录/容器摘要不替代内部投影验证。回归必须包含“投影已算出、随后预算超限”的真实构造器分支，以及缺原材料拒绝/补足材料成功/全量重算容器不能掩盖坏投影。依据为第5–6项已确认产品缺陷；现有捕获/配置事务/评分引用规则没有明确覆盖晚期降级丢弃映射而保留非空摘要的材料接缝。候选不改变授权/V1/预算，不写入冻结AGENTS；其他类型/样例/额度中断不提出经验。

## 2026-10-03 10:39–10:44 root独立复验及集成

root核对Sol四文件最终hash与实际差异，完整读取生产源、SQL回归和红绿记录；graph/index对main仅本批初始化/迁移/窄方法/close差异，未混入旧接线。原S3契约与builder hash仍分别5D1759AB...4B0E44F、BD96CC66...9C59165。Sol限定13文件227项及graph noEmit由root重新执行通过。

root自建ignored CLI `ownership-store-independent.ts`，独立合成六条源码事实，实际createQuestions→gradeAnswer→S3 builder→S4 prepare/save；四题型分别关闭重开SQLite，attempt/capsule精确相等、prepare-only标签存在。真实长variant/答案触发晚期rubric-budget-exceeded且projection非空：缺原submission拒绝，补足后完整保存；另改projection并重算完整capsuleHash仍拒绝，最后五attempt完整读取。Sol/main各exit0，源hash前后不变、独占临时库清理；合成事实不是分析器或GUI验收。

只复制四文件并逐个hash相等，main限定13文件225项通过（两个checkout原有分母不同，不统一数字），graph/application noEmit exit0；main全部application五文件111项在原门内通过，未改超时/断言或重建native。纯SQL后台端口独立接受；本轮无模型/工作区完整S5提交/GUI或Electron构建。候选经验经独立分支复验并查重后新增1条，限非空辅助摘要及预算降级材料核验，未改变预算/授权。
