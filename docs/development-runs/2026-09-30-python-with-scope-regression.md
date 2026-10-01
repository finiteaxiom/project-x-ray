# Python 上下文管理器作用域回归修复

日期：2026-09-30
任务：独立审查发现的 analyzer 2.1.0 产品回归修正
基线工作区：第一批修复仍在 `main` 工作区，未提交；保留既有改动。

## 复现与根因

- 审查提供的合法最小样例在 `caller(resource)` 中使用 `with resource as value` 并返回 `value`。调用 `PythonAnalyzer.analyze` 时，worker 以退出码 1 结束，上层返回 `PythonAnalysisError: Python 分析器异常退出（1）`。
- 先添加同步与异步上下文管理器回归，再运行 `pnpm --filter @project-xray/analyzer-python exec vitest run src/index.test.ts -t "同步 with|异步 with"`；修复前两项均复现同一失败。
- 根因已确认：`scope_statements` 将 `With`/`AsyncWith` 和 `If`/`For`/`While` 放在同一分支，并无条件读取 `statement.orelse`。`ast.With` 与 `ast.AsyncWith` 没有此字段。

## 修复与语义

- 保持绑定扫描：将 `if`、同步/异步 `for` 和 `while` 作为带 `orelse` 的控制流扫描；`with`/`async with` 只扫描 `body`。现有 `collect` 仍从 `optional_vars` 收集绑定。
- 回归覆盖嵌套 `if → with → for`、`async with → if → async for`；验证 `optional_vars` 写入其局部变量事实，遮蔽后的同名调用为 `unknown`，独立安全调用仍为 `verified`。application 集成另验证索引无失败文件且置信度正确。
- 审查 `analyze.py` 中所有 AST 字段访问：`orelse` 仅用于 `If`、`For`、`AsyncFor`、`While`、`Try`/`TryStar`；`Try` 家族的 `handlers`/`finalbody`、`Match.cases`、`With.items`/`optional_vars`、赋值/循环 target 以及推导式字段均与节点定义匹配。没有发现其他同类错误访问；本次不扩展模式匹配等无关语义。
- 将 analyzer 身份从 `2.1.0` 升至 `2.1.1`。修复使此前作为失败文件跳过的有效 Python 源码重新提供图事实，若复用相同版本会导致快照身份不变，因此需要版本递增并重索引。worker JSON schema 未改变，协议版本保留 `2.1.0`。

## 复验

- `pnpm --filter @project-xray/analyzer-python test`：1 个测试文件、16/16 通过。
- `pnpm --filter @project-xray/application exec vitest run src/index.test.ts -t "索引同步和异步上下文"`：目标集成 1/1 通过。
- `pnpm --filter @project-xray/application test`：1 个测试文件、15/15 通过。
- `pnpm typecheck`：10/10 workspace 包通过。
- `pnpm build`：10/10 workspace 包通过，并复制修复后的 Python worker；在构建输出 `apps/desktop/dist/python-analyze.py` 中确认了分离后的 AST 遍历分支。
- `git diff --check`：通过。修复前失败的两条 analyzer 回归在修复后均通过。

## 状态

产品回归已确认并修正。Python with/async with 遮蔽关系、unknown 置信度及源码定位按当前任务范围独立验收通过（见[独立验收记录](2026-09-30-independent-review.md)）。本记录中的测试数量与范围保持为历史结果；没有运行安装包验收，也没有提交或推送。
