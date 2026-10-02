# 暂缓电脑操作期间的后续切片

状态：协调方依据实际源码规划并派发；2026-10-02。主代码基线 3f58ddc（近期提交仅文档）。沿用双聊天及 Windows/V1 边界，不恢复 GUI 操作，不把技术检查当 GUI 或真实远程验收。

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

## 协调与下一步

Sol 仅写两份新设计，原24文件保持冻结；Luna仅写基准工具及本批记录，无共享文件/契约竞争。根协调方结束接线普通build窗口后才调度索引测量，开发不得自行占用native/dist/Electron。两批交付后独立审查，再选择基于实测的优化或最小语义实施；没有设计接受前不开发新评分或改purpose。
