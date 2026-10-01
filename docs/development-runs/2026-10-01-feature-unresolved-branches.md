# 功能解释保留有界查询中的未知分支

日期：2026-10-01
任务：让功能解释展示所选代表路径之外、但仍在有界图查询结果中的未知调用边。

## 目标与边界

- 只修复 `explainFeature` 对本次有界查询未知边的展示；代表路径、步骤证据、置信度、快照校验、查询预算和通用动态路径提示保持原有职责。
- 同一 edge ID 只出现一次；相同目标在不同源码位置产生的不同边分别展示，并附带对应证据的文件、行和列。
- 使用真实临时 TypeScript 项目执行静态索引，不执行项目代码。不构建或启动 Electron/native，不提交。
- 本轮开始时工作区包含多项其他未提交修改。本轮只在本记录列出的 application 实现/回归和 UI 测试文件中编辑，保留其余状态。

## 根因与修正

`explainFeature` 原先从 `firstCallPath` 生成未知项，只遍历了挑选出的单条代表路径。`GraphStore.queryGraph` 已返回该有界结果内的全部 `unresolved` 边，但应用层没有将侧向分支并入解释，因此代表路径之外的未知调用被静默遗漏。

现在应用层先按 edge ID 合并代表路径上的未知边和 `queryGraph.unresolved`，再显示目标、证据源码位置及边的解析原因。目标与原因相同时不重复原因。这样路径上的未知项仍保留，相同 edge ID 不重复，同目标的不同调用位置不会合并。返回的 steps、置信度、查询边界、快照校验、截断提示和动态路径提示没有改变。UI 已逐项渲染 `unknowns`，因此本轮仅补充 UI 可见性回归，不需修改展示实现或公共契约。

## 回归覆盖

- application 回归在真实临时 TypeScript 文件中索引 `branchFeature → middle → leaf`，并在入口放置两个同目标 `missing_handler` 调用。真实 TypeScript 边的目标与原因不同，测试确认两个侧向未知项各呈现目标、对应源码位置和边原因；queryGraph 测试替身额外重复一条同 edge ID 的 unresolved 记录，结果仍只呈现两条真实边。
- 同一集成回归覆盖代表路径上的 `unresolved_main` 仍带有不同于目标的边原因且只出现一次，并在有界响应标记截断时保留截断提示。
- 回归断言深度、节点数、边数和工作量限制仍为 6、80、160、1200。
- UI 组件回归确认同一未知目标的两个源码位置在不确定性列表中分别显示。

## 执行与结果

第一轮 application 类型检查发现测试替身的 `this` 隐式为 `any`（TS2683）。这是测试代码类型标注问题，不是产品运行缺陷；为 spy 的实现显式标注 `this: GraphStore` 后重新检查通过。

以下验证通过：

```text
pnpm --filter @project-xray/application exec vitest run --exclude "dist/**" src/index.test.ts
  Test Files  1 passed (1)
  Tests       24 passed (24)

pnpm --filter @project-xray/application typecheck
  tsc -p tsconfig.json --noEmit; exit 0 (修正测试替身类型后)

pnpm --filter @project-xray/ui exec vitest run --exclude "dist/**" src/components/FeatureExplanationWorkspace.test.tsx
  Test Files  1 passed (1)
  Tests       8 passed (8)

pnpm --filter @project-xray/ui typecheck
  tsc -p tsconfig.json --noEmit; exit 0

git diff --check -- packages/application/src/index.ts packages/application/src/index.test.ts apps/ui/src/components/FeatureExplanationWorkspace.test.tsx
  exit 0（Git 提示这些工作区文件下次触及时会将 LF 转为 CRLF）
```

## 独立源码复核补齐

后续源码复核发现未知项原先只将 target 与源码位置组合；当 target 存在时，边的解析原因没有输出。现改为同时显示 `target（位置；reason）`；reason 与 target 完全相同时省略重复部分。真实临时 TypeScript 集成用 `missing_handler` 与分析器生成的不同解析原因验证原因可见，并对主路径 `unresolved_main` 做相同检查。测试重新覆盖 edge ID 去重、不同调用位置、代表路径、截断提示和查询预算。

补齐后的验证重新通过：

```text
pnpm --filter @project-xray/application exec vitest run --exclude "dist/**" src/index.test.ts
  Test Files  1 passed (1)
  Tests       24 passed (24)

pnpm --filter @project-xray/application typecheck
  tsc -p tsconfig.json --noEmit; exit 0

git diff --check -- packages/application/src/index.ts packages/application/src/index.test.ts
  exit 0（仅报告既有 LF/CRLF 转换提示）
```

## 未验证项与规则判断

- 未构建或启动 Electron/native，也未进行桌面端真实交互验收；本轮证据限于静态索引集成、application/UI 源码测试及类型检查。
- `AGENTS.md` 已要求无法解析的边必须保留。本次是落实现有规则的实现遗漏，没有新增或修订通用规则的依据；按现有规则避免重复条目。
- 没有覆盖或清理工作区中的其他未提交或未跟踪内容。
