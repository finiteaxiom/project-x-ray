# 所有权语义验收语料准备（2A-L）

## 目标与边界

为后续语义评分设计准备可逐条对照源码的静态正反例。仅新增 `test-fixtures/ownership-semantic/README.md`、`golden-cases.json` 和本记录；复用既有 `test-fixtures/ownership-training`，不实现评分、模型调用或产品契约，不改变离线 `not-evaluated` 语义。未改 fixture 源码、packages、contracts、UI、共享规则、计划或其他协调记录。

## 基线与代码依据

工作目录为指定的主 checkout，开始时 HEAD 为计划指定的 `7b3f917d57a03541c3fa5578185466a195d536fe`，`git status --short` 为空。已读取 `AGENTS.md`、`docs/plans/2026-10-01-v1-long-development.md` 中的 2A-L 目标、ADR-0006、`packages/ownership/src/index.ts`、ownership contracts 与 `test-fixtures/ownership-training` 源码；未读取 Sol worktree。

只读准备期间，协调方将已验收的凭据切片合入主 checkout。收到基线更新后重新读取 HEAD/status：先推进到 `455d4ad50830ee2495b70927e51caf830a4efbb8`，随后又推进到当前 `0b72c7a477b8f5a0dfd2e474aeb852d2aaeda8ed`。`git diff --name-only 7b3f917d57a03541c3fa5578185466a195d536fe 455d4ad50830ee2495b70927e51caf830a4efbb8` 显示首段推进为凭据实现文件、lock/.gitignore 与三份协调文档；`455d4ad..0b72c7a` 只增加了 `AGENTS.md` 中 Electron CLI 入口经验和三份协调文档。只读 `git diff --exit-code` 针对 ADR-0006、ownership、contracts、ownership-training 和本批三份目标文件确认这些路径在两段基线推进中均未改变。新 AGENTS 条目与本静态语料任务无关；当前工作区只显示本批三份新文件，之前的协调文档修改已随主 checkout 前进，不再有未提交的协调文档改动。未触碰这些文件。

- ADR-0006 将结构化调用方向、有序路径和变量角色交给确定性规则，同时明确静态调用不证明运行时执行或业务理解；自由文本保持“未评估”。
- contracts 的提交 schema 要求至少一个源码引用；`gradeAnswer()` 先检查问题/提交的项目与快照身份，再评定方向、路径、变量角色与所需证据，最后固定返回 `semantic.status = "not-evaluated"`。
- 既有源码提供 TypeScript 的 `handleLogin → submitLogin`，以及 Python `route_login → login → validate → normalize`、`validate as check_token` 相对别名、`accepted` 写入/返回和 `cleaned` 值流。语料只记录路径、符号、行列和摘录，不存放导入后身份。

## 反馈闭环与验证

本轮未改实现或 fixture 源码；开发方没有执行 fixture、依赖、网络、build/native、Electron 或既有测试。首轮只读核对包括：

- `golden-cases.json` 可解析，case ID 唯一，所有范围文件均位于既有 fixture；
- 每个 source range 的文件、符号、行列、半开摘录与当前 fixture 文本相符；所有 case 的来源引用 ID 均能在语料 source range 清单中找到；
- source/evidence、repository、snapshot、question 和 node 的实际身份必须由未来导入器从当前快照解析。当前静态语料没有写入这些值；未能唯一解析的引用不得伪造或猜测。

实际首轮验证使用只读 PowerShell inline 检查：`Get-Content -Raw | ConvertFrom-Json` 解析 JSON；逐条以 `Get-Content` 和 `String.Substring(startColumn, endColumn-startColumn)` 比对摘录；检查唯一 case/source-range ID、范围引用、路径/符号存在及无运行时身份值。首轮结果：JSON 可解析，11 个 case ID 唯一，14/14 个范围和摘录匹配，未保存运行时 identity；另列 3 个 `not-evaluated` 操作场景。未执行 fixture 或产品代码。

当前确定性表现与未来语义设计要求在 JSON 每个 case 中分开记录。没有引用的答案按现有 `citations.min(1)` 契约在评分前拒绝，不作为正常 grade 输入。取消、无模型和 evaluator 无效输出单列为 `not-evaluated` 预期，不宣称当前已有语义评估执行路径。

## 独立审查诊断与修订

协调方随后在隔离目录实际 `indexProject()` 既有 ownership-training，并用真实 application 评分；该执行由审查方完成，本开发方没有复跑。审查确认 10 个有效答题变体（包含两个同义表述）符合预期；无引用样例按 contract schema 拒绝；真实第二快照引用被 `gradeAnswer()` 拒绝；已评分答案的 semantic 均为 `not-evaluated`。这次逐例审查发现以下语料问题，属于静态 fixture 的物化/证据范围错误，不是产品缺陷：

1. 仅按文件/范围挑唯一 evidence 会混淆重叠的 `DEFINES` 与 `WRITES`，并把同一 return 行的 `READS` 和 `RETURNS` 合并。JSON 新增静态 `evidenceBindingPolicy` 与逐例 `scoringEvidenceBindings`：先以 path/range 建候选，再按 edge kind、端点/变量 target、角色和 confidence 过滤；重叠范围只能在关系过滤后使用。变量角色逐项生成 citation，READS 与 RETURNS 即使共享范围也各用当前 snapshot 的独立 evidence ID 和 `citationIndex`。没有唯一关系匹配则 unresolved，不猜测 ID。
2. 两条变量题把 `check_token` 调用和 import alias 错列为 location 必需证据。修订后 current score 只绑定目标变量的 `WRITES`、`READS`、`RETURNS` 三类证据；调用和 alias 放到 `contextRangeIds`。审查方以真实 application 评分确认三条角色引用即可使 structure 与 location 均为 100。
3. 错位置控制例原来只有名字范围，没有标明可用的当前证据。现在指定同快照中 target 为 `handleLogin` 的 verified `DEFINES`；其较大 evidence span 与精确名字锚点重叠。这个 citation 合法，但不满足题目要求的 `CALLS(handleLogin, submitLogin)`，真实 location score 为 0。仅凭任意范围重叠仍不选 evidence。
4. `token.strip()` 的源码调用表达式对应 `CALLS` confidence `unknown`。范围现标为 context-only，不参与变量流必需评分。未来建议仅指出调用表达式结果被赋给 `cleaned` 并返回；不得断言参数类型、`strip` 的解析目标，或结果恒等/必异于输入。语料将“恒不改变”的文本列为 unsupported absolute claim，同时保留 `unknown`，不把某种具体 `strip` 运行行为说成已证明事实。
5. 同一行的 READS/RETURNS citation selector 现在重复静态 source range，但通过不同 edge kind 绑定到两个真实 evidence ID；与普通完全重复引用区分，后者仍由 application 去重为一个 citation。Python import/定义等纯背景锚点只供上下文阅读，不要求物化为评分 citation。

协调方还报告普通重复 citation 在 application 层去重为 1。修订后开发方只对静态文件做 PowerShell inline 只读再验证，使用 `Get-Content -Raw | ConvertFrom-Json`、source excerpt 的 `String.Substring` 比对和结构断言。结果：JSON 可解析，11/11 case ID 唯一，14/14 source range 路径/符号/半开摘录匹配，所有 case/context/citation/role/scoring binding 引用与 citationIndex 均闭合，两个 variable-flow case 的 WRITES/READS/RETURNS 顺序及三个索引吻合；`token.strip()` 保持 unknown/context-only，未写入运行时身份值。未再次运行项目评分或任何测试。

## 未验证项与规则评估

协调方最终复验补充（2026-10-02）：按本次JSON的实际`scoringEvidenceBindings`逐条从隔离真实索引动态绑定，共17个评分选择器唯一命中相关边/证据；角色引用、索引和去重结果符合预期。独立复验还发现unknown背景选择器的`targetLabel`与实际未解析节点完整名称不符；协调方仅纠正这一静态标签并在全新隔离子目录再次验证完整标签一致，未改变unknown置信度、图事实或fixture源码。10个有效答题变体、无引用拒绝、实际第二快照grader拒绝均通过；源码/模型/GUI未执行边界不变。该补充是协调方验证，不改写上文开发方只读检查为执行产品测试。

- 开发方未导入项目来物化真实 `repositoryId`、`snapshotId`、节点或 evidence；由协调方提供的真实 application 评分结果已在上节注明，但开发方没有独立复现。未运行语义评分，也没有模型质量结论。后续 materializer 应按修订后的关系 selector 在实际 snapshot 中重新解析；任何不唯一/不匹配结果继续标 unresolved。
- 本语料不是被接受的 rubric、评分等级、模型质量验收或远程/UI 验收；更换措辞的例子不代表已建立语义系统，也不使用词语重合或篇幅打分。
- 本轮 `AGENTS.md` 新增/修订数：0。审查问题是此语料的具体 evidence 绑定歧义和对 unknown 调用的过度陈述；修订静态 selector 即可，现有证据契约、置信度和源码范围规则已经覆盖预防动作，没有新的通用规则。
