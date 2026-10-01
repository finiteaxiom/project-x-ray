# 分析结果身份与不可变快照保护

## 授权、基线与边界

本批由审查方在 Windows portable 缺 Python 的真实 GUI 验收中确认缺陷后派发。原始观察：源码和规则不变，缺 Python 与恢复 Python 的索引拥有同一 snapshotId，失败清单与 Python 函数事实却改变，旧部分快照被覆盖。上述 GUI/SQLite 观察由审查方提供，本线程没有重复操作 GUI。

实际基线为 `c7c271a1e279a91506599566f6f96d953588c3ed`，`codex/project-ignore-config` 工作区在实施前干净。仅修改 contracts、analyzer-core、application、graph、相关测试、本记录与本 worktree AGENTS；Git 捕获、UI、desktop、包装、锁文件不变。未运行 build/native/dist、全量 Turbo 或 Git 写入。

## 根因与最小设计

原普通索引在分析前仅用源码、分析器版本和配置生成 snapshotId。Git 比较侧还按该输入 ID 提前读取旧快照，可能直接复用失败结果。GraphStore 随后删除同 ID 的节点、边、证据、源码和 overview，用 INSERT OR REPLACE 重写快照。运行环境变化带来的图事实或完整性变化不在身份内。

修正分为三个相互依赖的部分：

1. **分析结果身份。** 添加可选的版本化 `analysisIdentity.analysisResult`（版本 1.0.0、SHA-256 指纹）。contracts 中的纯规范化逻辑同时供 core 生成指纹和 graph 保存验证使用。对象键顺序、集合顺序、异步失败顺序和 createdAt 不构成结果差异；保留文件清单、节点归属、边方向、范围、置信度、分析器/版本、支撑证据、来源与完整性差异。等价证据归一化，重复边的数量仍保留。
2. **统一最终化。** 普通和 Git 比较侧都先完成分析，再生成最终 ID；Git 不再提前按输入身份复用。输入草稿只在本轮分析内使用，不发布。节点 ID 保持稳定；边与证据重新绑定最终 snapshotId。文件证据保持已有 `stableId(finalSnapshotId, filePath, 'file')` 约定，其余证据和边依赖规范化语义生成 ID，不依赖输入草稿的随机排列或临时 ID。新快照最终化幂等。
3. **不可变保存和独立 current。** saveSnapshot 仅插入新 ID；已有 ID 的完整逻辑 payload（仅忽略 createdAt）、源码正文、语言与内容哈希必须一致，否则返回固定安全诊断 `SNAPSHOT_CONTENT_CONFLICT`，不改变旧数据或 current。新结果身份还验证实际源码正文与声明清单/哈希一致。相同结果返回原始快照，不改创建时间。迁移 9 在 overview 添加 `activated_at` 元数据，晋升 current 时只改指针和晋升时间；同项目其他指针降为历史。application 对单项目、跨项目及 legacy 数据库均按晋升时间选择 current，时间单调晚于已知当前晋升，避免 A→B→A 复用旧快照后重启选回 B。

旧快照缺少新结果身份仍可读，同 ID 冲突保护也适用于旧 ID。没有迁移或回写旧快照 payload、来源和证据；此修正不重建此前已经被旧实现覆盖掉的历史内容。既有配置修订事务、根句柄读取、静态置信语义和取消边界保留。

## 实际反馈闭环

### 原缺陷确定性复现：产品缺陷，根因确认

新回归在确定源码上控制 Python 适配器的不可用结果，成功分支仍使用实际 Python AST 分析，不执行导入样例代码。临时从 `c7c271a` 读取 application/graph 原始实现重放；当前文件由 finally 原样恢复。

`pnpm --filter @project-xray/application exec vitest run src/snapshot-result.test.ts -t '同源码'`

原基线退出 1，断言发现 partial 与 complete snapshotId 相同。较早一次同样的原基线重放先暴露重复相同结果会改写 createdAt；将该断言顺序移至结果差异检查之后，保留断言，直接确认同 ID 不同分析结果。没有用更新时间或随机 ID 避开缺陷。

修正后普通索引及三种 Git 模式的 partial→complete→partial 均通过：不同结果 ID 不同，恢复相同 partial 复用其原 ID 与 createdAt，旧完整/部分证据与源码可分别打开。普通 current、重启、A→B→A 同结果复用和旧题目提交隔离均有回归。

### 最终化初版导航不兼容：本轮产品缺陷，已修正

扩展既有 application 回归后，“普通索引和 Git 比较侧都用可导航的完整文件范围”返回“证据不存在于指定快照”。根因是初版统一语义证据 ID 改变了既有文件证据公式，测试和源码导航仍用最终快照 ID 加文件路径计算文件证据。

保留文件证据公式，并分别识别实际 `project-indexer` 与 `git-side-capture` 来源；首次修正仅覆盖普通来源，复验仍失败，核对实际 Git 来源后修正。

`pnpm --filter @project-xray/application exec vitest run src/index.test.ts -t '完整文件范围'`

最终通过，随后完整定向 application 39 项通过。没有删改原精确范围和引用断言。

### 多文件并行超时：验证调度/资源问题

首次将新三轮 Git 回归与旧索引/配置文件并行运行时，working/staged 新用例触发 Vitest 默认 5 秒超时；超时后尚在运行的 Git 读取又使临时夹具清理出现 EBUSY。新文件单独运行已通过；改为串行文件复验后相同断言全部通过。未修改任何 timeout 或性能阈值；这不是已经证明的产品性能结论，也不沉淀为永久工程规则。

## 最终实际验证

- `pnpm --filter @project-xray/application exec vitest run src/snapshot-result.test.ts src/index.test.ts src/ignore-settings.test.ts --maxWorkers=1 --no-file-parallelism`：3 文件、39 通过。
- `pnpm --filter @project-xray/graph exec vitest run src/snapshot-immutability.test.ts src/index.test.ts src/ignore-settings.test.ts`：3 文件、16 通过。
- `pnpm --filter @project-xray/analyzer-core exec vitest run src/snapshot-identity.test.ts src/ignore-policy.test.ts`：2 文件、19 通过；没有运行 native build 或此前涉及权限的 native 全套。
- `pnpm --filter @project-xray/contracts exec vitest run src/index.test.ts src/ignore-settings.test.ts`：2 文件、13 通过。
- `pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit`、`packages/analyzer-core/tsconfig.json`、`packages/application/tsconfig.json`、`packages/graph/tsconfig.json`：均通过。
- `git diff --check`：通过。

最终定向合计 87 项通过。Graph 回归覆盖旧/新 ID 的节点或置信度冲突、同哈希不同正文、缺少正文、新结果指纹校验、原始 payload 不变、冲突不晋升 current、晋升旧 ID 后重开。Core 覆盖顺序、临时 ID、时间、范围、置信度、完整性、来源、最终引用绑定与幂等。

## 稳定交付与未验证项

业务源码与测试按本轮最后定向检查冻结。未修改或重建已有 dist/native，审查方集成和构建后再做真实 Electron/portable 缺 Python→恢复→再次失败验收。本线程没有全量回归、GUI、portable 或其他操作系统验收结论。未提交、推送或合并。

建议真实验收使用同一源码和同一规则，在隔离 userData 下限制 Python 可发现性后索引，再恢复并更新索引，再限制并更新。每次保留实际 snapshotId、analysisResult 指纹、诊断、Python 事实与证据引用；旧快照原始 payload/源码应不变，相同 partial ID 应复用，重启仍选择刚晋升的 partial。另做 A→B→A 后重启的当前项目检查。不要把旧 dist/native 当成本轮已构建产物。

## 工程经验判断

新增 1 条快照身份/不可变存储与 current 晋升经验：依据为原基线确定性失败、新旧同 ID 冲突保护回归、partial→complete→partial 和跨项目重开回归。它将既有不可变快照要求转化为具体身份构成、存储拒绝动作与验证路径。并行资源超时、当前数量和未验收状态只记录在此，不写入 AGENTS。
