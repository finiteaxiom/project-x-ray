# 2D-S3-D 共享任务实施设计过程记录

2026-10-05，开发-Sol，原第二批，只在5170 checkout新增两份文档。依据[本轮批准边界](../plans/2026-10-05-ownership-shared-task-design-plan.md)，交付[详细实施设计](../plans/2026-10-05-ownership-shared-task-design.md)。原四批结束后暂停，不第五批。

## 基线与实际操作

实际branch codex/llm-explanations，HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8。git status列出旧modified/untracked；全部保留，不与main同步。协调方报告S2 main/origin提交2ff849300c8720c3a4ded32de914155521a6ce76，本轮没有自行核main/远程或执行Git写操作。

已读取AGENTS、本轮边界、ADR0008、实际L2/policy契约、S2/store/S1材料源码、graph锁与补偿、remote application及测试断言、冻结broker恢复/事件/预算逻辑。轻量memory registry检索没有与共享任务设计直接相关的既往依据，设计不依赖旧memory事实。没有开启新agent/新线程。

已验输入SHA256：

|文件|SHA256|
|---|---|
|docs/plans/2026-10-05-ownership-shared-task-design-plan.md|76DB8B21992D5D70A69D638010B63C90CCCD22ACF61AEE2096142BF7E2FA9864|
|packages/contracts/src/ownership-semantic-task.ts|284D416F39922D79DB097203E73B6E9068BCF366D6FB63036F1F6A47A0CF08FE|
|packages/contracts/src/ownership-semantic-task.test.ts|21ACA9E5B424E2A9AEEB088C7E98EC351D5F61477356C194BAF195D8062C564F|
|packages/graph/src/remote-explanation-store.ts（本地原字节）|7923E08945ECE2B38F070F1000916E755CB42B07EC36DDAF8B3622A8BD04EE1A|
|packages/application/src/remote-explanation.ts（本地原字节）|41C4EBF1287CEE8E5D71312E41C02ECB988AF305D80087623A330E3CC3D5E53C|

主/Sol原remote因换行不同的normalized相等由协调方提供，本轮保留本地原字节，未覆盖。开始写文档前，对git列出的tracked及nonignored untracked共313个现存文件保存SHA256清单到自有临时目录，用于交付时逐一复核；不保存原始源码或私人路径到本文。两份新交付此前不存在。

实际命令类型：Get-Content AGENTS/计划/以上源码；rg -n定位migration/register/finish/release/recover及测试断言；rg --files packages/llm/src确认5170没有semantic adapter；git status --short、branch --show-current、rev-parse HEAD、diff --numstat（只读）；Get-FileHash核依赖与前后清单。一次rg路径通配符在Windows报路径不存在，改用rg --files确认真实文件清单；只是读取定位问题，非产品/测试失败或需沉淀的稳定环境约束。没有执行Vitest/noEmit、SQL实验、native/build/Electron/桥实验、GUI、网络、凭据扫描或导入代码。

## 设计结论及反馈

源码证实旧唯一索引仅覆盖feature、terminal保持占用、release拒dispatched，broker只确认自身旧worker退出后调用全局旧恢复。本轮据此选定一个provider主键的global共享lease、跨purpose UUID registry、独立semantic元数据及source结果。旧inflight包含terminal原样复制，异常多占用/损坏升级失败关闭；迁移号由root后续分配，project不建global表。保留原feature literal/旧历史，不把S2授权/schema/S1包提升为发送许可。

设计补齐了API/strict DTO/role/迁移/旧inflight策略、可信barrier、独立政策与共享provider/context失效、逐状态矩阵、跨库成功门及补偿、单provider生命周期参与者与确认全部退出的receipt、两用途窗口合计20、最小后台三段顺序门及两连接/SQL故障待验矩阵。

特别区分：现有application在事务内同步调用dispatch后commit，外部发起不可回滚。仅在该事务放lease会回滚占用，本轮没有运行并发网络复现，不称新已确认产品缺陷。设计要求在两用途transport启用前先单独提交durable reserved slot，再在第二同步全门注册/发起；后者commit失败仍占用并abort/观察Promise/绝不重发。许可前失败零dispatch与已获许可后失败不能混称零出站。该变更属后续明确接线，不改冻结旧代码。

S1历史材料不认证原题、5170缺实际主adapter，明确列为当前性/发送接线依赖：题目binding必须通过可信生成规则或另行批准的提交材料契约解决，不能用自洽重hash或prepare-only降级。SQL核心可独立在自有夹具验证，但不导出半校验语义发送接口。后续语义授权写与task终态须同一global事务组合；不把任务回调混进已验S2。

没有运行失败诊断→产品修正闭环；只有源码约束→具体设计→静态复核。所有A/B/C矩阵是未来实验，不是本轮结果。旧S2的146与协调方main182/16门仅来自先前记录/报告，未作为本轮已执行验收。未宣称政策任务整链、真实用户授权、GUI、远程或第二批完成。

## 协调方设计审查后的文档修订

首稿两文档hash由协调方核对匹配，但设计尚未接受；不是实现失败或产品缺陷。本次仅依明确审查意见修订原两文档：

- 首稿去重preimage排除了bodyDigest，且未给完整体变化的精确复用门。现选保留真实完整bodyDigest，复用再要求历史identity.bodyDigest与当前私有adapter完整serializedRequest摘要精确一致。补systemInstructions/schema/其他body字节变化而同package/版本的零复用与新preview手动请求矩阵。main adapter约230–235行含systemInstructions/responseSchema/data的证据由协调方提供，本地没有该实现，本轮没有自行读取或执行它；此处是待接线的精确要求，不称已验结果。
- 首稿未明确reserve与promotion之间稳定创建时间。现规定首次权威createdAt分配一次，registry/lease/task/undispatched终态/恢复与阶段事件全程复用；promotion不得now()重造，completedAt另核不早于首次时间。direct feature第一次真实登记及旧迁移原时间保留；补T1→T2、重复/恢复/迟到阶段控制时钟矩阵。均待运行。
- 按协调方拟议收窄为S3-A1仅global registry/lease与feature兼容，14仅记录为root拟分配，本文不占用或运行迁移。最小文件清单不再为A1修改contracts task schema/record，不建semantic表、不导出semantic reserve/dispatch/stopReceipt。semantic槽仅自有SQL夹具；feature-only恢复在任何写入前遇非feature占用固定失败关闭，保留全部行。真正semantic任务record/G_SEMANTIC、当前性、durable传输与全参与者恢复后续另派。

修订过程只执行Get-Content/rg静态读取、apply_patch改上述两文档和Get-FileHash前后核验。没有启动源码、迁移、测试或新agent；本轮不以修稿代替独立设计接受。

## 冻结、待审与规则

交付仅两份新Markdown，产品源码、contracts冻结输入、S2、broker、cache、loan/native/UI/AGENTS/包锁及其他旧WIP保持原字节。交付hash在最终报告外部列出，避免文档自引用hash。协调方需独立审查设计并分配迁移/后续精确实施范围；本轮不派发或执行源码段。

最终SHA256逐文件复核：原313个文件changed=0、missing=0；git清单新增路径精确为上述两份Markdown，branch/HEAD不变。这是实际前后字节核验，不只根据git status推断旧WIP未改。两份新文档是untracked，git diff --check限定路径exit0不检查其正文；正文由本轮直接静态审读，不把该空diff当编译/测试证据。

AGENTS新增/修订0：批准范围只允许两文档；无新复现实验可沉淀，已有短事务、停止前置、跨库补偿和证据规则覆盖原则。设计风险不转写为已验证工程经验。未提交、推送或合并。
