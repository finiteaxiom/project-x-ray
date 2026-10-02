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

## 1C-2B-2B-C：活跃所有者与启动恢复边界（P1，排队）

依据：协调方新隔离实验用两条ExplanationPolicy数据库连接、不同owner的两个broker；首任务dispatched且提供商Promise仍等待，第二session调用startSession→stop→recoverInterrupted后，首SQL任务变interrupted而首worker仍alive。remote-explanation-store.ts的恢复全局清除任务inflight/context；main.ts未设置single-instance启动门。此为核心状态失败，真实两个Electron进程/重复网络派发尚未验证。实验与命令见本计划独立审查记录最新节。

目标：同一userData只允许一个拥有数据库/worker的活跃应用实例，第二实例不能触发首实例恢复或清占用；真正退出后重启仍可恢复遗留任务且不能自动重发。不同隔离userData的验收进程不得互相阻止。不新增产品能力、后台服务、依赖或安全设置。

负责人Sol，先完成并冻结2B-S1，协调方再明确派发本批。候选最小边界仅desktop main启动顺序、独立启动所有权策略/测试与本批记录；现有broker/graph恢复算法只有证据证明必要时再明确扩范围。所有权门必须先于数据库打开及worker创建；不靠发布文档要求用户手动串行作为实现保证。不改其他worktree、全局协议、UI控件或生产凭据。

验收：纯启动排序/失败关闭/错误退出回归；协调窗口内以两个真实Electron技术进程、同一全新userData确认第二拒绝且无DB/worker初始化，用不同自建userData确认独立运行；关闭首实例后重开确认恢复且零自动派发。回归保留取消、补偿、completed历史及旧源码保护。当前不使用电脑操作，GUI前台/窗口行为另列未验收；未通过前不提交接线实现。
