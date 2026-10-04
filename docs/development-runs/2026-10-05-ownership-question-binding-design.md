# 2D-S4-D 原题绑定与当前性设计记录

2026-10-05，开发-Sol，仅5170、原第二批。依据[本轮计划](../plans/2026-10-05-ownership-question-binding-design-plan.md)，交付[具体设计](../plans/2026-10-05-ownership-question-binding-design.md)。只两份新文档，源码实施待root独立接受后另派。四批收尾后暂停，不第五批。

## 真实基线与输入

branch codex/llm-explanations，HEAD 455d4ad50830ee2495b70927e51caf830a4efbb8不变，保留已冻结A1/S2及旧WIP。协调方报告A1 main提交d27f1a1f56d2010b595480e42fd6307035722923已独立接受；本轮不读main、不核远程、不读取Luna活动task-record文件或复制覆盖。

已读本地AGENTS、本轮计划、实际ownership generator/grade/schema/preimage、application issue/私有map/grade/配置与close、graph receipt/material/save/read/attempt历史顺序以及已有真实测试源码。不是运行这些测试。关键输入SHA256：

|文件|SHA256|
|---|---|
|docs/plans/2026-10-05-ownership-question-binding-design-plan.md|F867A614E6647F1099FB955AB2509856B13C99FBC3C49B041A02D6496A798B2A|
|packages/ownership/src/index.ts|9B4CF19572CA2C07A7F1C648F278660B2B2167C055FD923768AA3703037CD91D|
|packages/application/src/index.ts|0C7A92181810ABAACA3A6CBB0E7C63D8FD28F0B334DC5DFEA48F8D305C8118C0|
|packages/graph/src/ownership-capsule-store.ts|731892E16E24461CE02B4BC27BB48234244841D4B11188C72ABDB59F8D952B17|
|packages/contracts/src/ownership-capsule.ts|5D1759AB29E78048A96448AD3294503F9170EA9500709B2470C3988BA4B0E44F|
|packages/graph/src/shared-remote-task-store.ts|D8EB87D50CAACDF2E97C2015146BCEF6C04966941568212C34BD8655BE6EBFEB|

写文档前保存git所列tracked/nonignored untracked共320个现存文件SHA256清单到自有临时目录，仅hash，不保存源码或私人路径到本文。两交付此前不存在。memory registry quick pass没有与原题认证直接相关的依据，不使用旧memory事实。

## 已确认源码事实与设计选择

已确认：createQuestions的attempt history只决定retryOfQuestionId，不避免旧variant或改变候选选择；当前候选按类型/图原数组顺序生成，scope/concept/count及Map去重影响结果。call-path保存成对全部legalNodePaths/legalEdgePaths，但实际variant调用GraphEdge对象数组的join，再无比较器sort，并不是边ID串；必须原样复现，不顺手修variant/题目/评分版本。variable题目包含所有角色候选边，capsule只证明所选必要材料。application在首次await前捕获私有题目及submission，passed删除、failed仍可重答，替换题目/close有assertActive门。graph私有receipt暂存questionPreimage，长期材料不保存完整题目来源；现有assertQuestion不足以重建全题。listOwnershipAttempts按完成时间与attemptId的localeCompare排序，legacy mastery映射concept以legacy:开始。

选定新提交独立question binding行：完整canonical question preimage≤128KiB、生成basis≤8KiB，实际request/candidateIndex、版本/locale、SQL history截点、匹配history投影hash/first witness、生成输入顺序hash及出版身份。只存必要认证材料，不复制答案/全snapshot。预留迁移名，编号由root另分配，不占15或改原10/11/12/13/14。超认证预算原本地评分/attempt/capsule不缩小、不截路径，新行unavailable；旧记录绝不回填。

出处由构造时硬接真实纯generator的graph端口、SQL捕获与WeakMap私有发行capability、原提交一次性receipt建立，后续同generator完整推导再比preimage；不能用普通DTO/自洽重hash、renderer题目或旧S1 read生成verified绑定/发送许可。graph不依赖ownership内部实现，application注入编译模块纯端口，拒每请求caller callback。生成合法性、可信发行/提交、实时当前性与网络permission明确分开。

发行historyCut固定SQL最大attempt rowid，正常追加甚至回退时间不改变旧题retry；只对实际匹配concept+variant投影重验，first witness必须符合原排序。新发题重取cut，失败同map重答仍用原cut。原数组顺序/合法备选边序列/重复citation角色索引保留，复用原projection和grader。排序记录locale/完整collator选项及orderingEngine实际Node/V8/ICU/Unicode/CLDR/Node或Electron版本，版本不兼容只使认证unsupported，旧本地历史照读。版本匹配仍必须完整输出相等，不能仅凭locale保证跨运行时排序一致。rowid检查仅保证实际匹配projection/hash/witness变化与source实例错误可被拒绝，不保证识别所有人为复用/整体重写。

后续当前性设计具体到authority/settings/source实例、异步prepared材料与锁内一次性revision receipt两种类型、global→settings→source锁序及实际SQL/preimage/独立授权/provider/context/body重核。采用已接受完整bodyDigest去重规则；不把原题绑定当HTTP许可，不接durable reserve、全worker参与者恢复或跨库真实发送。Q1新提交与只读绑定、Q2零网络barrier两段具体清单和待验矩阵已列。

上述新接口/预算/表/历史cut/locale及canonical验证均为设计决定，尚未实现或运行验证。未宣称历史SQL抗任意整体人为重写的密码学认证，不把已存hash当出处。对同源码图的假prompt/objective/checks/范围要求同generator完整比较拒绝，假材料自洽不豁免。

## 实际操作与未执行

协调方首稿静态审查指出两个设计缺口：把对象join误述为边串，以及locale/rowid保证过宽。仅在原两文档修正，未改产品源或运行复现。认证器可只读观察Map前同id异preimage，但不得改变原Map/local grade；新增有限ambiguous-generator reason及未来真实回归。排序选择严格engine兼容门，新增unsupported-ordering-engine及同locale不同Node/ICU的待验矩阵；完整输出比对始终保留。此闭环分类为设计静态缺口→文档修订→静态复核，不是已复现产品修正，不新增第三文档或测试。

本轮执行Get-Content/rg -n/rg --files只读定位、git branch --show-current与rev-parse HEAD、Get-FileHash输入及前后清单、apply_patch只新增两Markdown。没有执行Vitest/noEmit、SQL迁移或插入、重型build/native/Electron/GUI、network/凭据扫描、导入项目代码、Git写操作、新agent或新聊天。

无产品/测试失败，本轮是源码事实→具体设计→静态复核，没有编造修复闭环。现有回归源码提供未来矩阵样式，不把先前A1的236项、root验收报告或旧截图当本轮验证。所有真实四题型/双布局/重hash/异步/SQL故障/receipt实验均待派发后执行；不声称原题认证或语义当前性已经通过。

## 冻结与规则

最终交付hash外列，避免自引用。核原320文件无变更；新增仅本设计及记录，实际branch/HEAD保持。全部冻结A1/S2/旧源码、contracts、其他记录、AGENTS/包锁不改。root审查后才实施Q1/Q2，不由设计自动启动后续源码或扩四批范围。

AGENTS新增/修订0：本轮无代码/复现实验可沉淀，批准范围仅两文档；已有原子提交、证据、当前性与安全规则适用。未提交、推送或合并。
