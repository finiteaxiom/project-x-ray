# 2B-S2设计记录：所有权rubric与提交胶囊

2026-10-02；本worktree HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`，未ff/reset，与主未对齐。只新增本记录与`docs/plans/2026-10-02-ownership-rubric-capsule.md`；全部实现、契约/barrel、startup/接线、AGENTS及迁移冻结不写。

## 目标与实际核对

按协调方派发及主`docs/plans/2026-10-02-non-gui-continuation.md`14:53节，只设计四实际题型有限标准和attempt同事务胶囊，纯builder→SQL端口→本地application集成分批，不引入provider/授权/IPC/UI，不占迁移11。

只读命令使用`rg -n`和`Get-Content`核对：ownership/index.ts createQuestions、gradeAnswer及verifiedPathEvidence；application/index.ts:325–339评分/持锁保存/passed删题及:453–462引用校验；graph/index.ts:540普通INSERT、:223配置IMMEDIATE与:251快照存储；contracts/index.ts题目2.0.0、scoring2.1.0及submission/attempt、ownership-semantics.ts已接受包/validator；ADR0008；ownership/index.test.ts:22以后重复调用路径以及application/index.test.ts:512以后的实际索引回归。未执行这些测试，未读/跑主独有116项语料。主startup真实验收是协调方消息与计划的报告，不是本轮自测。

确认缺口：passed后删内存题，attempt只存答案/成绩无内部check；不能用重新出题恢复当次标准。gradeAnswer的best覆盖率只用于位置分，不等于完整用户所选路径；rubric资格只允许同一配对序列全部引用覆盖，稳定ordinal候选排序，不能逐边拼装。

确认两个接缝：本地validateCitations仅相交且去重，纯语义包要求精确范围；variable角色index仍指原提交引用，attempt引用则是去重后数组。最初仅描述为契约接缝；协调方随后给出实际持久化重开复现，现已确认第二项属于当前答题记录角色错位，不能继续仅称新DTO兼容问题。原评分此例正确，不把记录缺陷夸大为评分缺陷。本批无实现修复。

协调方复现证据：main `7a9f81b`，脚本`.benchmarks/remote-desktop-review-20261002/ownership-citation-index.ts`以真实XRayApplication索引自建flow.ts，四引用`[write,write,read,return]`、角色索引`[0,2,3]`评分passed=true。validateCitations保存三引用而结构原索引不变，重开后read指向return、return越界。协调方报告`node --import tsx`退出0，含确认缺陷存在的断言；这是成功复现缺陷，不是修复通过。本轮未运行脚本，无GUI/生产HTTP/用户项目证据。

当时据此修订计划，建议优先独立S2a，仅application/index.ts的新attempt规范索引映射、定向真实应用回归和过程记录；当时尚未获实施授权。原submission及grade保持不变，持久化有效role按完整citationKey映射到同payload规范citations。无效引用沿用原拒绝零写；原越界role保持越界及原失败分，内部映射缺失固定失败，不猜/丢引用。旧历史无法可靠重构原顺序，原样保留、不回填；未来胶囊另记录完整citationOrder和roleBindings以支持投影hash重算。回归明确重复/角色重复/顺序/范围/越界/重开/SQL保存失败后重试/旧payload保护。该次更新只改两文档，不改实现、SQL、契约或barrel。S2a随后另获授权并冻结，实际红测/修正/回归见独立`2026-10-02-ownership-citation-index-fix.md`；下面最新设计批不改或重跑该实现。

## 设计决策与反馈

四型只描述定义、静态调用方向/相邻步骤、实际读写返回位置，不从名字/关键词构建职责或运行时结论。path每步criterion、variable每required role一项并覆盖用户为该role选择的全部合法位置；必需规则超预算整题不可评，不裁剪。每criterion固定static-only与answer-information-insufficient，其他两种限制不从全仓unknown或泛化原因自动生成。

胶囊含完整question/attempt/hash身份、模板版本、rubric、选择与角色投影、最小来源元数据，不复制答案或源码；旧attempt不回填。ready仅本地准备资格，not-evaluated有限reason，不生成模型结论。SQL新端口同source事务普通INSERT两行，任一步失败全回滚；配置锁跨legacy source提交维持，builder所有await在锁外并后置重校验，source事务核验activation/manifest。保留重复ID冲突行为，不引入upsert/幂等重试扩展。

本轮未执行实现/测试，无产品红测或修复闭环。一次主计划路径查询误放development-runs目录，随后rg --files定位plans下真实文件；该查询问题不作为工程经验。设计从源码核对后收窄了entry“职责”目标、明确local相交与semantic精确范围差异以及role映射，不修改接受的纯契约。详细规则、候选精确文件与未来正负/事务矩阵见计划，均是未来门槛，不是本轮验证成功。

## 未验证与交付

两文档冻结待root审查；未来builder模板充分性、capsule schema/hashes/预算实际实现、SQL两个INSERT原子性/角色/迁移编号、配置与activation竞态、旧数据/分保护都未执行验证。模型自然语言质量、远程body/权限/成本、GUI始终开放。没有build/native/dist/Electron/runtime、凭据/HTTP、迁移或Git动作，没有写其他checkout。

本轮无新增AGENTS规则：契约接缝是源码支持的设计输入，尚无新增实现/复现实验；现有完整路径、准确范围、配置锁、历史不改写和独立验收规则已覆盖预防要求。文档设计不能替代测试或真实验收。

## S3前补充设计：有限失败胶囊与async/sync提交接缝

2026-10-02协调方再次限定只修订本记录及原计划，两文档以外（尤其S2a三文件）保持冻结，不执行测试/build/runtime/Git。本次通过Get-Content/rg只读核对计划、contracts/ownership-semantics.ts:55–73的WebCrypto Promise hash与graph/index.ts现有Node createHash/canonicalJson/withIgnoreRevision。未运行协调方probe、主独有语料或S2a回归。

原设计失败依据：协调方在main纯生成器probe用81条合法合成数据流边生成variable题，通过旧question schema，variantKey单字段5275 UTF8字节。脚本`.benchmarks/remote-desktop-review-20261002/ownership-capsule-budget.ts`据报告node --import tsx退出0，证明旧设计通用字段不能装入≤2KiB not-evaluated。属于设计预算反例，不是实际索引/SQL/GUI证据。本次不改旧schema或产品生成器，不通过降低旧合法输入上限逃避反例。

修订：两个strict union分支独立白名单。ready包括受限ID/variant/prompt/rubric/映射/来源元数据并受完整64KiB限制；not-evaluated只有version/builderVersion/status/reason、完整questionFingerprint/attemptHash、可空answer/projection hash、有界sourceIdentity标量、capsuleHash。不含variantKey、题面、原ID字符串、完整citationOrder/roleBindings、analysis/proof清单或时间字符串createdAt。原大字段仍由完整未裁剪question/attempt preimage绑定，关联列从原attempt及封闭准备receipt取；ready超限只生成新有界分支，保留合法本地attempt/旧分。编码不适合答案hash时用null而非替换字符，完整本地attempt hash使用canonical JSON转义后字节。

仅使用functions隔离JavaScript计算拟议最大固定对象（未加载/执行仓库）：最长enum原因、9个64字符hash、32字符ISO activation、Number.MAX_SAFE_INTEGER revision及所有固定键，紧凑JSON为992 ASCII字节，小于2048。这是设计上界计算，不是schema/builder/SQL测试。S3 golden仍须验证最大shape、旧schema合法5275字节variant/长题面、多引用、编码及所有预算临界，固定分支新增字段后重算。

async接缝原文“事务内重算”不够具体，现修订为两阶段端口：事务外prepare先解析自己的深拷贝，在所有await之前截取完整纯数据；使用现有async契约验证和唯一新canonical preimage完成hash/闭包验证后，以store私有WeakMap封存canonical attempt/capsule、preimage字符串和capture身份，只返回opaque receipt。不把raw caller hash当许可，不在await后重读caller可变对象。

同步保存消费该store的receipt，仅以封存字符串生成payload/列值；settings→source锁内同步重读实际snapshot/activation/config/manifest/主键，Node已有同步SHA-256后端使用contracts新胶囊纯preimage的同一UTF8 canonical字节重算attemptHash/capsuleHash。question/rubric/projection的async验证结果绑定已验字符串，capsule hash覆盖其完整内容和摘要；不复制私有rubric normalize、另造domain或在SQL事务await。跨后端等价golden与原输入突变/伪造或跨store复用receipt、DBcapture竞争、两INSERT失败回滚测试是实施门，尚未运行。

本次没有新增产品红测/实现修复，不伪造设计→实现闭环；修订是“协调方设计反例→源码核对→明确两分支及两阶段方案→静态审阅与固定shape大小计算”。S2a root独立全包的旧Git超时及其单文件复验属于另批，由root按实际结果报告，本记录不升级为全包接受。

两文档再次冻结待root审查，S3/S4/S5均未实施、不占迁移号、不改barrel/依赖/AGENTS。原基线455d4ad及旧改动保留。本补充无新增工程规则：预算与async事务方案尚待实现验证，已有不裁剪/身份核验/同步事务规则仍适用；不把设计计算作为工程实测保证。
