# 增量索引基线准备记录（3A-L）

## 目标

只读检查普通本地索引路径、已存在的测试和基准脚本，新增增量索引基线及正确性验收设计。授权输出仅为：

- `docs/plans/incremental-indexing-baseline.md`
- `docs/development-runs/2026-10-01-incremental-baseline-preparation.md`

未获授权的产品实现、基准测量、测试/构建执行、Git 比较实现和其他共享文档均不属于本批次。

## 开始状态与边界

- 开始核对时主 checkout 为 `D:\Projects\Project X-Ray`，HEAD 为 `64840ba9dbcf72fc71e3b1a1b27e65f2e7789662`。
- 首次状态检查中已有 `docs/development-runs/2026-10-01-v1-long-development-review.md` 和 `docs/plans/2026-10-01-v1-long-development.md` 未提交修改；它们由协调审查工作流维护，本轮未触碰。
- 编写前再次检查时，除上述文件外还见 `AGENTS.md` 未提交修改和 `docs/development-runs/2026-10-01-overnight-handoff.md` 未跟踪文件。它们属于共享工作区新状态，本轮不读取、覆盖或清理；两个目标文件当时均不存在。
- 用户提供并检查了仓库规则及第三批计划范围。本轮没有查看 Sol 的独立 worktree。

## 检查方法与来源

只用只读文件搜索/读取核对应用入口、IPC/preload、桌面和分析 worker、analyzer-core 发现策略、TypeScript/Python 分析器、快照身份/内容规范化、SQLite 发布/查询及相关测试。主要代码定位见计划文档“现有普通索引路径”和“现有测试和脚本证据”。

静态追踪确认 `indexProject()` 每次都会执行全项目发现和安全读取，传入 TS 项目的完整源码创建一个 TypeScript Program，批量运行 Python AST 子进程，并在持久化前重新发现和读取文件以检查变化。持久化层会校验同 ID 结果和源码冲突；完全相同的已有快照可被重新激活，但这不代表解析已增量跳过。

读取了根 `package.json`、`benchmarks/run.ts` 和现有 smoke/Electron 脚本定义。`benchmarks/run.ts` 有 `.benchmarks` 递归清理、外部仓库克隆、Git 变更影响测量和 `docs/benchmarks/latest.json` 覆盖副作用，且不等于 Electron 端到端路径，故不适合作为本轮安全的普通索引测量入口。判断来自静态读取，不是运行失败。

## 执行与结果

- 新增 `docs/plans/incremental-indexing-baseline.md`，定义样本、环境记录、冷/暖测量、分层计时、规范化全量/增量等价判定、正确性矩阵及之后单独的 Git 双侧门。
- 新增本过程记录。
- 未修改产品源码、现有计划/审查文档、AGENTS.md 或其他共享文件；未创建脚本、fixture、依赖或功能。
- 没有运行 `pnpm benchmark`、测试、构建、native 构建、dist、worker smoke、Electron 或导入仓库代码。性能、内存、查询和索引规模均未测量。
- 没有观察到本轮执行失败或可复现问题：未运行会改写/清理数据的脚本。静态发现的 benchmark 不适合作为当前隔离基线入口，记录为后续工具准备事项，而非产品/测试失败。
- AGENTS 工程经验新增数：0。依据：本轮只有只读路径分析与计划文档；未有新的实现或复现实验结果达到工程规则沉淀门槛，现有规则已经要求可靠基线、快照正确性和不外推单样本结论。

## 验证与限制

本记录的终态复核包括：确认两个目标文件此前不存在、复查其内容与源代码行号引用、复查 Git HEAD 和工作区状态。性能/正确性实现尚未执行，也未对 Sol worktree 中正在进行的图、应用层或契约修改做兼容性判断；后续开发应先在实际执行 checkout 重新核对 HEAD、源码和并行改动。
