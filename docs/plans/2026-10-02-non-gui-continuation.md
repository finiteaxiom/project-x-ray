# 暂缓电脑操作期间的后续切片

状态：协调方依据实际源码规划并派发；2026-10-02。主代码基线 3f58ddc（近期提交仅文档）。10:46 Sol设计修订复审后接受，转2B-S1独立契约；Luna工具实施中。沿用双聊天及 Windows/V1 边界，不恢复 GUI 操作，不把技术检查当 GUI 或真实远程验收。

## 已核对的前置与开放项

Sol 的迟到 dispatched 被最新 SQL terminal 拒绝缺陷经原失败实验及负向回归独立复验修正；最新普通 desktop build 与产物 worker bootstrap/state 测试通过。整批实际 Electron IPC、App GUI、真实服务仍未验收，24文件保留在 Sol worktree 未提交。不为了进入 UI 阶段绕过这些门禁。Luna 1D-0 两文档设计接受，正式 UI 仍等待后端合同安全集成。

## 2A-S：所有权语义评价设计（优先级 P1）

代码依据：ownership/src/index.ts 评分始终返回 semantic.not-evaluated；contracts 的 OwnershipGrade 固定该状态、OwnershipAttempt 只有 semanticText；application.gradeOwnershipAnswer 在当前快照/配置校验后追加确定性尝试。ADR0006 保留离线未评估。remote-explanation 合同目前只允许 feature-explanation purpose，不能把该授权直接用于答案评价。新设计属于已批准第二批，但不提前改这些代码。

目标：形成可审查的 ADR-0008 草案，定义真实证据约束的解释正确性、独立的用户选择和任务/评分版本、结果持久化与过期边界；模型不能改变确定性定位/结构分或把未知关系提升为 verified。提供精确后续最小实施文件/依赖和验收矩阵。

负责人：Sol，仅 D:\Projects\CodexWorktrees\5170\Project X-Ray。保留所有接线未提交改动，不 reset/ff；基线455d4ad与主近期文档/语料差异须注明，不声称已对齐或运行主checkout独有语料。

文件边界：只新增 docs/decisions/0008-evidence-constrained-ownership-semantics.md（状态草案，非已接受）与 docs/development-runs/2026-10-02-ownership-semantic-design.md；不修改现有 ADR、协议/实现、接线、AGENTS 或其他 worktree，不执行重型构建/模型/凭据/Git动作。

门槛：区分正确引用错误解释、正确解释无引用、备选合法路径、矛盾/不足/unknown证据、答案提示词注入；提交前不泄露答案；独立 purpose/disclosure/逐项目拒绝默认值与最低外发类别（含用户答案）；原feature授权不隐式扩大；强绑定question/attempt/rubric/provider/快照/配置修订；取消/重试/异常退出追加与幂等/事务边界；旧grade、attempt、mastery不改写，缺模型仍未评估，远程语义与确定性passed分别展示；输出结构验证与引用校验，拒绝无依据评级；迁移/版本/恢复/迟到及适用测试明确。该切片只有设计审查，实际语义模型与GUI质量仍开放。

## 3C-L：有界合成规模基准工具（优先级 P2）

代码依据：benchmarks/local-index-baseline.ts 的 SAMPLE_ID/SAMPLE_FILES、parseChildSummary，以及 child 的 FIXTURE_FILES/MAX_TOTAL_SAMPLE_BYTES 固定三文件。现有成功报告只证明三文件冷库/无变化重索引等价；无法作为规模或增量优化依据。已接受 baseline 设计要求普通索引的冷暖测量、规范化事实/证据/源码与旧快照稳定门禁。

目标：保持原 small 样例兼容，增加显式 --sample medium 的确定性自建128文件混合样例（96 TypeScript、32 Python；每文件单个函数、同语言静态导入/调用链；固定生成版本、路径、内容和清单摘要）。默认仍 small；不接受任意文件夹、URL、外部样例或用户路径。规模收益判断留给实测后复杂优化设计，不实现产品增量缓存。

负责人：Luna，仅主 checkout。精确范围：benchmarks/local-index-baseline.ts、local-index-baseline-child.ts、local-index-baseline.test.ts，新增 local-index-baseline-samples.ts、对应 samples.test.ts，以及 docs/development-runs/2026-10-02-scaled-index-baseline-tool.md。其他产品、契约、package/lock、旧benchmark、已接受语料、协调文档不改。

约束：父/子显式校验同一个受版本约束的样例枚举；生成清单须独立比对实际发现的源码，拒绝重复/缺失/多余/错语言/摘要、计数和矛盾报告。medium单文件≤4096字节、总源码≤512KiB；仅限明确的新运行目录、独占报告写入，无共享目录清理或覆盖。若128文件摘要报告超过原32768单行限制，先量化其来源再按固定最大文件数推导有限上限，不设无限缓存。保留原11门禁、健康失败关闭和精确全部证据导航检查，不用抽样替代现有断言。最多5次、5000–180000ms总时限、取消后强制终止child及失败状态不降级。Node采样RSS继续只代表Node进程，不代表Python或Electron总内存。

开发验证：生成器确定性与硬限额/安全路径、CLI枚举和parent/child不匹配、恶意/矛盾/重复清单、原small兼容、取消测试；不调用导入样例代码、不联网安装或重型build/native/dist/Electron。可运行纯工具测试；真实索引采样由协调方验收单窗口执行。实现→验证→诊断→修正→再验证记录真实，AGENTS经验只提出证据支持且未覆盖条目（本轮可为0），不改变门槛。

独立验收：差异/类型/必要回归及默认small实际CLI；随后medium单次门禁、取消、再最多3次冷库与无变化重索引配对采样；失败先诊断，不输出成功均值。记录环境/规模/原始样本、阶段进度时刻和测量限制，不从粗阶段推断TS/Python分项耗时。测量仅在本地自建隔离样例，不是GUI、真实项目性能或已实现增量加速。

## 2B-S1：独立契约与纯响应校验（2A-S接受后实施）

依据：已接受ADR0008采用独立purpose、rubric/限制字典、独立sidecar；现有解释response/purpose schema不能容纳这些语义。先以纯版本化模块落实字段/预算/引用与答案范围校验，供后续rubric/数据发布消费，不提前接评分API、SQL或真实provider。

文件只新增 packages/contracts/src/ownership-semantics.ts、ownership-semantics.test.ts、docs/development-runs/2026-10-02-ownership-semantic-contract.md。Sol原index.ts有未验收桌面API差异，保持冻结、不追加导出；此轮在新测试直接加载同包新模块，公开barrel/跨包消费由后续单独集成安排。可复用同包既有证据schema，但不改变feature-explanation purpose literal或旧grade/attempt。只Sol自己的worktree，保留旧实现。

实现目标：strict、显式版本的有限rubric/limitations/assessment package/response及可纯调用的响应校验入口。稳定规范化ID/hash、unique完整criteria和criterion允许集合一致；每个verdict的evidenceIds/limitationIds/answerRanges符合ADR，拒绝错包/跨criterion/重复/未知/漏项/多项/多余字段，答案范围在实际提交文本UTF-16边界内且不切代理对。答案/必需rubric/路径证据不得截断；检测相关字节/数量/集合边界，仅声明能在已提供package/答案材料上验证的规则。外部SQL当前性、实际源码读取及模型自然语言正确性不由schema证明。

不计算或改写passed/mastery/旧分、不引入运行时transport、秘密读取、全局配置/迁移、新依赖或生产mock。必要tests覆盖受限正例、三类verdict及坏范围/ID/字典/身份/预算/字段，并保留当前契约回归及类型检查。记录真实反馈闭环，经验合格可为0。完成定义为该纯模块行为独立验证，不称第二批端到端或真实语义质量完成。

## 协调与下一步

Sol 当前只新增2B-S1纯契约/测试/记录，自己的两设计文档仅同步接受与INSERT事实；原24文件保持冻结。Luna仅写基准工具及本批记录，无共享文件竞争。真实规模索引待六文件冻结并由协调方单窗口执行，开发不得自行占用native/dist/Electron。契约交付后独立审查，再按依赖选择最小后续实施，不以设计接受替代运行验收。

11:08更新：两批冻结后均已推进独立检查，3C-L的14项/类型/small及medium三对/取消通过；2B-S1纯模块复制三文件到main并由root独立追加公开导出，116项回归和contracts/desktop/ui类型及公共导入通过。只有这些纯模块/工具可Git收尾，旧接线仍冻结且GUI未验。Sol已正式接下述启动门及旧协议测试两处字面量类型修正，不在其进行中并发构建。

## 3D-L：导航耗时分解诊断设计（P2，仅设计）

实测依据：固定medium128文件三对全部门禁通过，每轮1177证据全部读取；child整体48.870、42.259、47.585秒，cold/warm index分别2.618/2.530、2.004/2.143、2.457/2.324秒。总耗时还有进程启动、两轮完整导航、汇总/关闭等成本，不能把差值直接命名为某个函数耗时。源码candidate是application.requireSnapshot在getEvidence/readSource中调用GraphStore.loadSnapshot，后者对完整payload调用parseStoredSnapshot；还有安全文件打开/每条证据源码读取成本，尚未证明哪项主导。

目标：设计一个只在自建隔离样例上进行的有界诊断，对index、完整导航、SQL快照load/parse、证据查询及安全源码读取划出可归属计时/计数；说明计时嵌套与统计差值，不编造分项。区分测量工具与未来产品优化，先测再判断，不因warm无明显加速直接引入缓存。固定当前medium生成器/清单、全部证据门禁、冷暖同身份与历史保护，取消/失败关闭、报告不含源码/凭据/私人路径。

Luna仅新增docs/plans/2026-10-02-navigation-performance-diagnostic.md及docs/development-runs/2026-10-02-navigation-performance-diagnostic-design.md；读取当前实际API/源码/样例报告字段，定义未来最小benchmarks专用实现候选与验证门。此批不改产品/GraphStore、缓存、六个已冻结基准文件、契约/依赖/AGENTS，不运行新测量、build/native/dist/Electron/Git；无依据重构及软件指标推断禁止。设计接受后才派最小诊断实现，复杂优化仍由Sol后续按实测负责，当前优先启动安全修复。

## 1C-2B-2B-C：活跃所有者与启动恢复边界（P1，排队）

依据：协调方新隔离实验用两条ExplanationPolicy数据库连接、不同owner的两个broker；首任务dispatched且提供商Promise仍等待，第二session调用startSession→stop→recoverInterrupted后，首SQL任务变interrupted而首worker仍alive。remote-explanation-store.ts的恢复全局清除任务inflight/context；main.ts未设置single-instance启动门。此为核心状态失败，真实两个Electron进程/重复网络派发尚未验证。实验与命令见本计划独立审查记录最新节。

目标：同一userData只允许一个拥有数据库/worker的活跃应用实例，第二实例不能触发首实例恢复或清占用；真正退出后重启仍可恢复遗留任务且不能自动重发。不同隔离userData的验收进程不得互相阻止。不新增产品能力、后台服务、依赖或安全设置。

负责人Sol，先完成并冻结2B-S1，协调方再明确派发本批。候选最小边界仅desktop main启动顺序、独立启动所有权策略/测试与本批记录；现有broker/graph恢复算法只有证据证明必要时再明确扩范围。所有权门必须先于数据库打开及worker创建；不靠发布文档要求用户手动串行作为实现保证。不改其他worktree、全局协议、UI控件或生产凭据。

验收：纯启动排序/失败关闭/错误退出回归；协调窗口内以两个真实Electron技术进程、同一全新userData确认第二拒绝且无DB/worker初始化，用不同自建userData确认独立运行；关闭首实例后重开确认恢复且零自动派发。回归保留取消、补偿、completed历史及旧源码保护。当前不使用电脑操作，GUI前台/窗口行为另列未验收；未通过前不提交接线实现。

## 2026-10-02 14:53 恢复后的当前派发

startup 批已通过 root 最新普通 desktop build、4个真实 Electron 技术进程与47项定向回归。同 userData 第二进程 exit0、DB/worker/window 初始化计数为0；首实例保持alive。首session之后按公开存储方法在全新隔离SQL建立人工 dispatched/inflight/context 和 completed/result 历史；第二实例拒绝时状态不变。直接终止自有首进程再启动，遗留任务 interrupted/INTERRUPTED、lease=0、旧context拒绝、completed结果/时间及旧源码不变；重启后实际worker start命令0。不同自建userData独立启动。不是实际provider正在请求、真实HTTP或GUI证明，旧接线和main仍不提交。核心双broker绕过入口失败probe保留原断言。

3D-L两文档设计已冻结并经源码复审接受。下一批3E-L（P2）由Luna仅新增 benchmarks/local-index-navigation-diagnostic.ts、local-index-navigation-diagnostic-child.ts、local-index-navigation-diagnostic.test.ts 与 docs/development-runs/2026-10-02-navigation-performance-diagnostic-tool.md。按已接受3D设计，固定medium128、原11门/两轮1177证据全部导航；公开store方法计时按cold/warm及调用来源分组，inclusive嵌套不能叠加，单独安全读回放不称产品内部计时。固定空间聚合、受限协议/计数/字节/时间、唯一自有目录、取消等待close并失败关闭；所有wrapper正常/异常/取消均恢复。默认1对、最多3对、总时限最多180秒；不改3C工具/产品/缓存/SQL/依赖/AGENTS。可纯测试/类型，真实索引采样仅由协调窗口执行。若三份源码无法满足范围先报告具体依赖，不静默扩大文件。完成门是工具行为与真实门禁独立验证，非性能优化或GUI。

2B-S2（P1）由Sol先设计实际本地rubric/提交胶囊最小切片，依据 ownership.generateQuestions/gradeAnswer、application.gradeOwnershipAnswer passed后删题及GraphStore.saveOwnershipAttempt普通INSERT，以及已经接受的ownership-semantics纯契约缺少question/attempt权威绑定。只新增 docs/plans/2026-10-02-ownership-rubric-capsule.md 与 docs/development-runs/2026-10-02-ownership-rubric-capsule-design.md。明确entry/call-direction/call-path/variable-flow从实际题目/快照/合法引用生成有限criteria/limitations，完整用户所选合法edge路径、无语义关键词评分、预算不裁剪；先纯构造器，再同本地attempt事务保存/冲突/旧attempt不回填。须定义题型规则充分性、胶囊版本/hash/有限不可评估原因、迁移/角色/配置事务与精确未来文件/回归门。不得提前实现SQL、purpose授权、provider/IPC/UI或修改冻结接线/契约/barrel/AGENTS，不占迁移11。计划接受后再派精确实现；缺密钥不妨碍本地准备，不伪称远程质量已验收。

两线程继续各自目录；Sol只读准备已完成，旧所有改动保留，不ff/reset。定时任务复用project-x-ray，PAUSED经工具恢复ACTIVE/原15分钟与静默规则。无新增GUI或生产凭据操作。
