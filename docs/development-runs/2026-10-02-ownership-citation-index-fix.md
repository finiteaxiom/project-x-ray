# S2a：新attempt角色引用索引持久化一致性

2026-10-02；worktree基线`455d4ad50830ee2495b70927e51caf830a4efbb8`，不ff/reset。协调方核对本批涉及application/ownership/graph源文件与main7a9f81b相同，其余主差异未同步。

## 实现前边界

只修改`packages/application/src/index.ts` grade后构造新attempt的variable-flow引用映射，新增`packages/application/src/ownership-citation-index.test.ts`与本记录。所有已有其他文件（含两设计、契约/barrel、GraphStore/SQL/迁移、ownership评分、UI/模型/接线、依赖/AGENTS）保持冻结。允许用现有native在自建隔离样例运行应用索引回归；不触发pretest/native构建，不build/dist/Electron/HTTP/凭据/GUI/Git。

目标：grade仍读原submission、validatedCitations，成绩/passed/scoringVersion不变；仅新attempt内有效role索引按完整citationKey映射到同payload规范citations，保持role/引用顺序与重复role。无效引用沿用拒绝；原越界role保持越界及失败分；内部合法映射丢失固定安全失败、零写。普通INSERT事务和passed后删题位置不变，保存失败题仍可重答，旧历史payload不改。

## 实际反馈与验证

根因确认：validateCitations按完整范围/证据key去重，gradeAnswer用原submission.citations解读role；旧attempt直接保存原structuredAnswer却保存去重引用。这两个数组索引空间不同。修正只在grade之后克隆variable-flow结构，用完整JSON tuple（文件/行列/evidenceId）映射有效role索引；原越界值仍保留。原grade、普通INSERT/配置锁、题目成功后删除时点和其他题型不改。映射缺失抛现有SafeDiagnosticError(TASK_FAILED)，不持久化。

实际反馈闭环：

1. 新回归最初用函数内let初始化样例，实际索引没有生成variable-flow题，5项在fixture建立处失败；这是测试数据不满足生成条件，不是目标产品红测。只读协调方已复现脚本，改用模块变量与函数内显式赋值，未改生成器或断言。
2. 再运行定向命令，5项全部在保存role索引处失败；原grade相等断言已经通过。主例实际保存[0,2,3]，期待[0,1,2]；首/中/尾重复与非默认引用顺序也复现。这是本轮真实产品红测。
3. 应用13行映射修正后，同一5项通过。扩展为17项，定向全部通过，包括真实索引与重开、引用和role顺序/重复、同proof不同range、原越界失败分、5种无效引用拒绝后可重答、真实SQL INSERT trigger失败零写/题可重试、旧错误payload字节不变、第二连接配置写前竞争以及测试注入内部grade丢引用时固定安全错误零写。
4. 首次application类型检查发现新增测试的bad引用对象evidenceId被推断为必填，delete报TS2790；显式标为已有SourceCitation后类型通过。未改变产品schema。
5. application默认并行全量回归：108通过、3失败；snapshot-result.test.ts三个Git比较用例均超过原5秒，随后cleanup报EBUSY。保持所有断言与5秒门不变，以`--maxWorkers 1 --no-file-parallelism`单独重跑该文件，4项全通过（13.62秒总时长）。证据支持并行资源竞争/超时引发清理占用，未确认新的产品语义错误；未改测试超时、原文件或排除用例。继续串行完整回归结果在下节记录。

命令与当前结果：

- packages/application目录：`node ../../node_modules/vitest/vitest.mjs run src/ownership-citation-index.test.ts`：最终17通过，5.23秒。
- packages/application目录：`node ../../node_modules/vitest/vitest.mjs run --exclude 'dist/**'`：108通过/3超时失败及上述EBUSY，退出1，不能记作全包通过。
- packages/application目录：`node ../../node_modules/vitest/vitest.mjs run src/snapshot-result.test.ts --maxWorkers 1 --no-file-parallelism`：4通过，退出0。
- packages/application目录：`node ../../node_modules/vitest/vitest.mjs run --exclude 'dist/**' --maxWorkers 1 --no-file-parallelism`：最终5文件、111项全部通过，59.01秒，退出0；保留默认5秒单测门及原全部测试，未出现symlink EPERM。串行全包结果与首次并行失败分别记录，不改写原失败。
- packages/ownership目录：`node ../../node_modules/vitest/vitest.mjs run --exclude 'dist/**'`：6通过，退出0；未改确定性2.1.0。
- 仓库根：`node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit`及`node node_modules/typescript/bin/tsc -p packages/ownership/tsconfig.json --noEmit`：均退出0。
- 直接Vitest入口绕过application package pretest，不运行native构建。`git diff --check`退出0，仅已有冻结文件CRLF提示。

最终冻结：只有获准application/index.ts新增grade后映射、17项新增测试及本记录；没有修改GraphStore/SQL/迁移、ownership评分、旧grade/版本、契约/barrel、UI、模型/接线、两设计或AGENTS。没有ff/reset/提交/推送/合并、构建/native/dist/Electron、HTTP、凭据或电脑操作。代码/SQL行为与测试通过由本批验证；root独立复验/Git集成与GUI不在本批完成范围。

## 经验判断与限制

本轮不改冻结AGENTS。提出1条供root逐条审查的候选：当持久化去重/规范化引用数组时，同时映射所有依赖数组索引的答题结构；评分继续读原输入，新保存结构引用同payload规范数组。回归包括首/中/尾重复、同proof不同range、原越界、角色重复、重开及旧payload保护，不回填缺原顺序历史。依据是上述真实红测→修正→重开及17项回归；现有准确范围/路径完整性规则未明确这一索引持久化边界。最终是否纳入由root核对公共规则，未把候选写入AGENTS。

GUI及模型语义、胶囊迁移/实现不在本批，历史记录缺原引用顺序不能推断修复。协调方新增S3预算设计事项：合法variable question的variantKey可达5275 UTF8字节（root在main的纯合成生成器probe报告，不是本轮执行）；未来not-evaluated≤2KiB需仅有限固定身份/摘要，不复制无界variantKey/题面/映射数组，ready超预算应转有限元数据而不拒绝合法本地attempt。本事项留给后续设计审查，未改冻结两设计、产品或契约，亦不影响本S2a。

## 2026-10-02协调方独立验收补记

root读取冻结三文件，独立两个checkout实际应用/SQL/重开正向脚本、失败重试/输入不变/原分与历史保护通过；main严格application/ownership类型与独立ownership6项通过，新17项回归已在两checkout独立运行。原整包Git staged/last-commit超时及cleanup EBUSY曾真实失败，主旧基线也复现，具体证据保留在独立审查，不将开发全绿替代root结果。

阶段诊断后原snapshot-result.test.ts四例4/4通过；随后 `node node_modules/vitest/vitest.mjs run packages/application/src --maxWorkers 1 --no-file-parallelism` **5文件/111测试全通过，exit0，56.19s（tests53.13s）**。未改原5秒超时、测试断言、产品Git捕获或安全设置。没有宣布此前失败根因已确认为资源问题，当前一次整包绿不保证未来时延稳定。

接受新attempt引用布局的后台持久化修正；无UI改动/真实GUI/模型验收。root按证据、适用、具体动作、去重及记录链接门槛在主AGENTS收录1条引用去重与索引一致性规则，不覆盖其他worktree规则；实际提交SHA由审查记录登记。旧attempt不回填。
