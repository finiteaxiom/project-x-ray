# V1 剩余流程只读证据审查

日期：2026-10-01
任务：只读检查功能解释、Git 比较、所有权题目证据与快照绑定、未知边、迟到响应、引用评分和证据揭示时机。

## 目标与边界

- 依据已接受的 `docs/decisions/0001` 至 `0006`、当前实现和已有测试，寻找具体的流程遗漏或缺陷候选。
- 不修改产品源码、契约、测试、计划文档或独立评审文档；本记录是本轮唯一新增文件。
- 不运行测试、构建、安装、导入项目代码或 Electron。用户报告的 Electron PID 16800 与 native 产物均未触碰；此运行状态没有在本轮独立检查。
- 开始审查前，工作区已有多处修改和未跟踪文件。本轮保留这些状态，不覆盖或清理。

## 审查结果

### 候选 1：功能解释遗漏选中路径以外的具体未知边

**源码依据：** `packages/graph/src/index.ts:326-356` 在图查询时把遍历到的 unknown 或带 `unresolvedTarget` 的边收进 `unresolved`，并在响应中返回该列表。`packages/application/src/index.ts:212-224` 请求包括 unknown 在内的有界调用图，却仅从 `firstCallPath` 选出的单一路径构造 `unknowns`。`firstCallPath`（同文件第 398 行）会选出一个最远可达节点的父路径。解释面板只展示该路径的步骤及 `result.unknowns`（`apps/ui/src/components/FeatureExplanationWorkspace.tsx:134-155`）。

**最小复现条件：** 查询根有一条 verified 链 `root → knownA → knownB`，同时有一条已进入本次有界图查询结果的 unknown 调用 `root → unresolvedTarget`。代表路径可以落在 verified 链上。此时图查询响应含有旁支的 `unresolved` 条目，但应用层只扫描代表路径边；`unknowns` 不会列出该旁支的具体目标/原因，界面只显示一般性的“分支、动态调用……”提示。

**判断：** 源码确认应用层没有消费图查询已有的 `unresolved` 列表；用户可见遗漏是由代码路径推导的，尚未用运行测试复现。应作为功能解释的缺陷候选，而不是声称图存储丢弃了该边。现有 UI 测试以 mock 结果检查未知项展示，未覆盖应用层对离开代表路径的 unresolved 边如何组装说明。

### 候选 2：同一节点路径上的不同调用位置无法正确评分

**源码依据：** `packages/ownership/src/index.ts:10-14,42` 按调用边枚举路径；合法路径同时保存节点序列和边序列。若 `root` 在两个源码位置各调用一次 `middle`，而 `middle` 再调用 `leaf`，两种路径拥有相同的节点序列 `[root, middle, leaf]`，但第一条边的证据 ID 不同。评分器第 32 行用 `legalNodePaths.findIndex` 仅按节点序列找到第一个匹配项，随后只要求对应的那条 `legalEdgePaths[index]` 的证据。

**最小复现条件：** 对上述两个不同调用位置生成的题目，提交节点序列 `[root, middle, leaf]`，并引用第二个 `root → middle` 调用位置以及共同的 `middle → leaf` 位置。节点顺序与第二条边路径都合法，但 `findIndex` 会选中第一组边；按照后续命中数计算，第二处 `root → middle` 证据不会满足第一组所需证据，导致位置分数不足并使答题失败。

**判断：** 生成器与评分器对题目身份采用的信息粒度不一致，缺陷机制可由源码确认；具体分数尚未执行验证。现有 `packages/ownership/src/index.test.ts:19` 覆盖了不同节点序列的替代路径，但没有覆盖同一节点序列对应多个调用位置的情况。可以允许任一与该节点序列匹配的合法边路径，或按提交证据选择匹配路径；本轮不实施修改。

## 其余指定流程

- **Git 比较：** 检查了两侧捕获快照、变更行到符号映射、按各侧快照进行影响路径查询和来源定位。未发现足以列为新缺陷的具体遗漏。现有 `ChangeExplorer` 测试覆盖左右侧迟到源码响应、精确侧快照来源定位及旧报告状态响应。
- **仓库、快照和引用绑定：** 检查了题目按仓库/快照生成与筛选，以及答题时对当前快照、来源文件、证据 ID 和引用范围交叠的校验。未发现额外候选；候选 2 是合法证据路径的评分歧义。
- **迟到响应：** 检查了所有权会话的请求代次/生命周期保护、功能解释的快照与请求身份校验、Git 比较文件及报告状态的响应身份校验。现有测试覆盖过期任务、快照切换、快速换文件和旧报告检查；未发现新候选。
- **所有权证据揭示：** 界面仅在存在 `session.grade` 时渲染评分反馈和 `revealedEvidenceIds`，符合提交后揭示时机；未发现新候选。
- **范围外话题：** 远程 LLM、增量索引、安装和可配置忽略规则按本轮要求不作为缺陷审查范围。

## 确定性诊断

为验证上述两个候选，临时新增 `packages/application/src/v1-remaining-flow-diagnostic.test.ts`，执行后删除，未保留会断言旧缺陷行为的测试文件。唯一执行的测试命令为：

```text
pnpm --filter @project-xray/application exec vitest run src/v1-remaining-flow-diagnostic.test.ts --reporter=verbose --silent=false
```

第一次运行中，所有权诊断通过；功能解释用例因测试夹具对象没有继承 `XRayApplication` 原型而失败，错误为 `app.explainFeature is not a function`。这是测试夹具缺陷，不是产品失败。将夹具改为从 `XRayApplication.prototype` 创建后，同一命令退出码为 0：1 个测试文件、2 个诊断用例通过。没有调用 `pretest`、构建 native、Electron 或其他测试。

### 未知旁支

- 临时 fixture 将 typed 快照存入真实 `GraphStore`，并通过 `GraphStore.queryGraph` 和实际 `XRayApplication.explainFeature` 方法运行；仅将当前快照取得方法替换为返回 fixture 的函数，避免索引工作区。
- 同一 bounded graph 中，`unresolved` 有 `{ edgeId: "root-unresolved", target: "missing_handler()", reason: "fixture root-unresolved", confidence: "unknown"}`，未知边也仍在 `edges` 中。`explainFeature` 输出步骤 `root → middle → leaf`，`unknowns` 只有一般性分支提示，没有 `missing_handler()`。
- **结果：候选 1 确定复现。** 图查询保留了未知边；遗漏发生于应用层组装功能解释时未使用 `bounded.unresolved`，不是 Graph IR 或存储丢边。
- **限制：** 快照与图为语义 fixture，不经过真实 TypeScript analyzer 或 `indexProject`；应用层当前快照校验替换为 stub；未做 Electron/UI 操作。结果验证了查询与解释方法之间的数据遗漏，不能证明所有实际仓库调用形态都产生同一图结构。

### 重复节点路径的调用证据

- 临时 fixture 使用真实 `createQuestions` 和 `gradeAnswer`，节点、调用边和证据位置为手工 typed 语义样例；该用例没有走 `XRayApplication.gradeOwnershipAnswer` 的来源范围校验与持久化边界。
- 生成的题目含两份相同的节点序列 `[root, middle, leaf]`，配对调用边分别为 `[root-middle-1, middle-leaf]` 和 `[root-middle-2, middle-leaf]`。
- 合法调用证据范围及 fixture 源码所选文本为：`src/flow.ts:2:2–2:10` `middle()`；`src/flow.ts:3:2–3:10` `middle()`；`src/flow.ts:7:2–7:8` `leaf()`。旁支未知调用范围为 `src/flow.ts:4:2–4:19` `missing_handler()`。
- 第一处合法调用链评分为 `structure=100, location=100, passed=true`。使用第二处 `root → middle` 调用范围和共同的 `middle → leaf` 范围，节点顺序仍合法，但评分为 `structure=100, location=50, passed=false`。
- 负例：错序 `[middle, root, leaf]` 且附上全部正确边证据，评分为 `structure=0, location=0, passed=false`；缺一步 `[root, middle]` 且引用第一步与末边证据，评分同为 `structure=0, location=0, passed=false`。
- **结果：候选 2 确定复现。** 按节点序列 `findIndex` 总是匹配首个合法边序列，因此没有按第二条有效边路径评估引用。
- **限制：** 评分器与题目生成逻辑为实际包函数；节点、边与引用坐标来自最小语义 fixture，不是 analyzer 从磁盘索引生成，也未通过 application 的真实来源文本校验。因此确认了 ownership 评分函数中的机制与返回分数，但未验证生产 analyzer 会以该形态生成重复节点路径。

## 验证、限制与规则判断

- 只执行了上述单个临时诊断测试文件。没有运行其他测试、类型检查、构建、Electron 或导入项目代码；未触碰 PID 16800 与 native 产物。
- 临时测试文件已删除；未修改产品实现、契约、已有测试、`AGENTS.md` 或用户维护的计划/评审文档。没有新增工程规则，符合用户要求；两个可复现机制留在本过程记录中供独立复核与后续派发。
- **建议的最小修复边界（本轮未实施）：** 功能解释从当前 bounded query 的 `unresolved` 集合生成带目标/原因的未知说明，同时保持查询有界与静态置信语义；所有权评分在相同 `legalNodePaths` 存在多组合法边序列时，让提交证据命中任一完整对应边序列即可满足位置分，仍要求结构路径合法、引用为当前快照证据。
- 开始审查前已存在的工作区修改与未跟踪文件均保留。本轮没有提交。
