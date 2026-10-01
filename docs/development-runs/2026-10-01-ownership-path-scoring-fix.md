# 所有权重复节点路径的证据评分修复

日期：2026-10-01
任务：修复同一符号节点路径由不同源码调用位置组成时，只按首条边序列评分的问题。

## 目标与边界

- 本批仅修复 ownership 调用路径评分候选 2。功能解释遗漏旁支 unknown 的候选 1 保留给后续派发，没有改动相关实现。
- 用户授权修改评分实现、回归、必要的版本标记、开发记录和有依据的 `AGENTS.md` 经验；不扩大功能，不提交。
- 不运行 Electron、GUI 构建或 native 构建，不改 native 产物。临时 TypeScript 项目只交给静态索引器分析，没有执行项目代码。
- 开工前工作区已经有大量其他未提交修改及未跟踪文件。本批保留这些状态；只对本记录列出的评分代码、测试、版本、经验规则作相应修改。

## 根因与修正

`createQuestions` 将 `legalNodePaths` 与同下标 `legalEdgePaths` 配对。同一个节点序列可以因重复源码调用产生多条合法边序列。旧 `gradeAnswer` 用 `findIndex` 只取第一个节点序列匹配项，因此有效引用第二个调用位置时，会被按首个位置评分。

现在评分会检查所有与答案节点序列完全相同的候选路径，并逐条验证：边序列长度恰为节点跳数、边存在于当前快照、每条边都是方向相邻且 `verified` 的 `CALLS`，且其证据存在于同一快照并为 `verified`。评分只选取单条路径中引用覆盖率最高的完整证据要求，不把不同候选的引用合并。没有任何完整边/证据路径时结构与位置均不能通过；部分或跨候选混合引用不会达到 100% 位置分。

### 版本判断

- `OWNERSHIP_SCORING_VERSION` 从 `2.0.0` 提升至 `2.1.0`，因为同一答案的评分结果和通过条件发生变化，保存的答题尝试必须能区分新旧评分语义。
- `OWNERSHIP_QUESTION_VERSION` 保持 `2.0.0`。题目形状、学习目标和 deterministic check 契约没有变化，只改变了对等价完整边路径的评分方式。
- 历史 attempts 的 `scoringVersion` 保持原值；没有改写历史记录，也没有数据库迁移。

## 回归覆盖

- Ownership 单元回归通过真实 `createQuestions` 生成同一节点序列的两个调用位置候选，并验证两条完整路径均通过；缺少末边证据和两条候选间混拼分别失败。额外的损坏题目 fixture 验证缺失边或缺失证据不能产生空要求并通过。
- Application 集成回归写入真实临时 `flow.ts`，调用 `indexProject → createOwnershipQuestions → gradeOwnershipAnswer`。TypeScript analyzer 产生两个不同的 `entry → middle` 源码调用边和共同的 `middle → leaf` 边；测试从索引快照取得每个证据的实际 span，经 `readSource` 校验同快照源码、`targetSpan` 和所选调用文本，再分别提交两条完整路径。两次评分均为 `structure=100, location=100, passed=true`。
- 集成回归还断言揭示证据只由评分响应返回，语义评分仍为 `not-evaluated`。application 全套回归同时覆盖伪造/越界引用和失效快照拒绝。
- Contracts 回归断言评分版本升为 `2.1.0`，题目版本保持 `2.0.0`。

## 执行与结果

所有测试均用 `pnpm ... exec vitest run` 直接调用 Vitest，避开 application 包的 native 构建 `pretest`。以下命令均通过：

```text
pnpm --filter @project-xray/ownership exec vitest run --reporter=dot
pnpm --filter @project-xray/application exec vitest run src/index.test.ts --reporter=verbose -t "真实索引的重复调用位置"
pnpm --filter @project-xray/application exec vitest run --reporter=dot
pnpm --filter @project-xray/contracts exec vitest run --reporter=dot
pnpm --filter @project-xray/ownership typecheck
pnpm --filter @project-xray/application typecheck
pnpm --filter @project-xray/contracts typecheck
```

第一轮不带排除项的直接 Vitest 命令分别报告 ownership 2 个文件/11 项、application 2 个文件/45 项、contracts 2 个文件/19 项；这些结果同时收集了源码与生成的 `dist` 测试副本，不能当作独立覆盖累加。按 package scripts 的源码范围重跑后，准确计数为 ownership 1 个文件/6 项、application 1 个文件/23 项、contracts 1 个文件/10 项。针对真实索引的独立目标用例另为 1 项通过、同文件其他 22 项按过滤器跳过。源码范围的命令与结果见下方 UI 跟进。三个包的 `tsc --noEmit` 均退出码 0。集成测试使用当前工作区已有的 Node native reader；没有编译、替换或清理 native 产物。

本批没有实现失败或尚未解释的测试失败。没有运行仓库全量测试、root build、Electron 或 GUI 验收；真实电脑验收由用户在其进程关闭并自行构建后完成。

## 规则沉淀判断

检查 `AGENTS.md` 未找到调用路径评分、`legalEdgePaths` 或重复调用位置的既有规则。本问题已由最小语义回归和真实 TypeScript 索引→快照评分集成共同复现，且影响 ownership 证据评分正确性，因此新增了一条经验：评分必须按单条完整边路径匹配，不得只取首个重复节点序列或混拼备选证据；评分语义变化应递增评分版本。规则见 `AGENTS.md`“已验证工程经验”末尾，并链接至本记录。

## 修改范围与限制

- 评分实现：`packages/ownership/src/index.ts`。
- 回归：`packages/ownership/src/index.test.ts`、`packages/application/src/index.test.ts`、`packages/contracts/src/index.test.ts`。
- 评分契约版本：`packages/contracts/src/index.ts`。
- 经查重新增的工程经验：`AGENTS.md`。
- 评分修复主批没有修改 Electron、Git/Graph、功能解释候选、题目结构或原有审查/计划文档；后续兼容跟进只修改了 UI 测试中的当前评分 mock。本批未提交。

## UI 评分版本兼容跟进

### 失败与修正

- 用户转述的独立审查结果为 `pnpm --filter @project-xray/ui build` 因三个 UI 测试评分 mock 仍提供旧 `scoringVersion: "2.0.0"` 而以 TS2322 失败：`apps/ui/src/App.test.tsx:74,158` 与 `apps/ui/src/components/OwnershipWorkspace.test.tsx:22`。本批将这些当前 `OwnershipGrade` mock 改为导入 `OWNERSHIP_SCORING_VERSION`。题目的 `version: "2.0.0"` 保持不变；ownership/graph 测试中描述历史 attempt 的 `scoringVersion: "2.0.0"` 也保留。
- 首次 UI typecheck 在 `App.test.tsx:74` 仍报告 TS2322，因为 `vi.fn` 把常量属性推宽为 `string`。临时改用 `as const` 又触发 TS1355（const assertion 不能用于变量引用）；改成 `OWNERSHIP_SCORING_VERSION as typeof OWNERSHIP_SCORING_VERSION` 后类型检查通过。该失败来自测试 mock 类型表达，不是产品 UI 逻辑。
- `rg -n "scoringVersion|OWNERSHIP_SCORING_VERSION" apps/desktop/scripts` 没有匹配项；desktop scripts 没有旧评分版本断言需要修改。
- `rg -n "scoringVersion.{0,40}2\\.0\\.0" apps/ui/src apps/desktop/scripts` 没有匹配项；当前 UI grade mock 不再留有旧版本。仓库中保留的同样字面量仅用于 ownership/graph 测试构造历史 attempts，没有修改。

### 复验

package 的 `vitest run` 直接命令明确排除生成的 `dist` 副本，最终源码范围结果如下：

```text
pnpm --filter @project-xray/ownership exec vitest run --exclude "dist/**" --reporter=dot
  1 个测试文件，6 项通过
pnpm --filter @project-xray/application exec vitest run --exclude "dist/**" --reporter=dot
  1 个测试文件，23 项通过
pnpm --filter @project-xray/contracts exec vitest run --exclude "dist/**" --reporter=dot
  1 个测试文件，10 项通过
pnpm --filter @project-xray/ui exec vitest run --exclude "dist/**" --reporter=dot
  11 个测试文件，84 项通过
pnpm --filter @project-xray/ui exec vitest run --exclude "dist/**" src/App.test.tsx src/components/OwnershipWorkspace.test.tsx --reporter=dot
  2 个测试文件，38 项通过
pnpm --filter @project-xray/ui typecheck
  tsc --noEmit 退出码 0
pnpm --filter @project-xray/ui build
  tsc --noEmit 与 Vite production build 均成功
```

UI build 仍输出 Vite 的大 chunk 提示（最大 Monaco chunk 约 2.64 MB）；构建成功，本次没有调整拆包或 native/desktop 构建。38 项目标回归是 UI 84 项全套的一部分，不另行累加。评分 mock 修复后的 UI 目标回归、源码范围全套与构建均通过。独立电脑/GUI 验收尚未进行，由用户在其关闭应用并自行审查构建后完成。
