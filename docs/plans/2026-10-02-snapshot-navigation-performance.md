# 快照导航重复加载优化候选

日期：2026-10-02
状态：首稿退回；2026-10-02 23:25 协调方接受修订设计与必需门，产品优化尚未派发或实现。
范围：Windows、本地快照导航；不增加 V1 产品能力。

## 目标

用已完成的 medium128 诊断结果定位同一 `snapshotId` 在多条证据导航请求中的重复工作，提出一个有界的后续实现候选及其回归门。该小样例用于确认代码路径和单次计时归属，不支持真实项目、跨机器或普遍提速结论。

## 已观察基线

协调方只读报告显示：1 对运行完成，11 项门禁全部通过；样例为 128 文件、387 个节点、1,275 条边、1,177 条证据。Child wall 为 26.661 秒，冷/热索引为 1.453/1.202 秒，冷/热完整导航为 10.937/11.020 秒。每轮分别调用 `getEvidence` 1,177 次、`readSource` 1,177 次；两轮合计每类 API 和相应单条 GraphStore 读取各 2,354 次。

冷导航中，`getEvidence` API 为 4.460 秒，其中公开 `GraphStore.loadSnapshot` 的 1,177 次调用计时为 4.363 秒；`readSource` API 为 6.326 秒，其中相同次数的 `loadSnapshot` 计时为 4.360 秒。热导航分别又执行 1,177 次 `loadSnapshot`，计时为 4.400/4.368 秒。因此两轮导航原计数为 4,708 次完整 `loadSnapshot`；计数不包含索引和 current 检查阶段的加载。相应 GraphStore 证据读取、源码读取和 `readSource` 的排除设置读取两轮各为 2,354 次。API 与 store 计时是包含下游工作的嵌套口径，不能相加；`loadSnapshot` 同时包括 SQLite 查询和 `parseStoredSnapshot` 的 JSON/模式解析与旧版归一化，不能把它单独称为“解析耗时”。

1,177 次独立安全源码回放耗时约 0.788 秒，和 application `readSource` 内部路径不是同一计时。另一次 5,000 毫秒总时限运行以 timeout 结束、有效配对数为 0；单次 child wall 已超过 26 秒，这表示该预算无法完成一个 medium 配对，不是产品缺陷，也不得降低完整导航门禁。协调方另确认取消子进程最终 closed、未强杀，且后续配对未启动。

以上只是一对固定合成样例的结果。导航 wall 冷热接近是该运行的观察值；不能据此推断实际项目的缓存收益、用户可见延迟或普遍性能。

## 可观察的跨连接变更标记

当前锁定依赖为 `better-sqlite3@13.0.3`。本地类型声明提供 `Database.pragma`、`Database.inTransaction` 与 `pragma` 的 `simple` 选项；仓库已有 `remote-explanation-store.ts` 用 `inTransaction` 检查事务前提。官方 SQLite 文档明确：`data_version` 只可比较同一连接在不同时点的值；其他连接提交变化会改变它，本连接提交不会改变它。better-sqlite3 的 `pragma(..., { simple: true })` 可取返回结果的首列首行。[SQLite `PRAGMA data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) · [better-sqlite3 `pragma` 与连接属性](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#pragmastring-options---results)

协调方已在隔离临时 WAL 数据库、使用两个实际 SQLite 连接完成纯机制实验，退出码 0、断言全通过且目录已清理：首连接初值 2；首连接自己的 `UPDATE` 提交后仍是 2；另一连接 `UPDATE` 回滚后仍是 2、提交后变为 3。首连接随后 `BEGIN` 并实际 `SELECT`，此时另一连接提交更新；读事务内首连接仍读到旧 payload 且 token 仍为 3，结束该事务后 token 变为 4、新 payload 可见。另一连接删除快照后，token 变为 5 且新查询无行；关闭连接后再读 pragma 会报错。

该实验确认了 `data_version` 是**同一连接的外部提交变化标记，不是全局 revision 或内容 hash**；打开读事务时不能用它发现另一个连接刚提交的更改，SQLite 仍向该读事务提供旧视图。因此缓存命中检查不得在读事务内运行或跨 API 持有读事务。实验验证的是 SQLite/WAL 机制，不是 GraphStore 产品缓存、首次构建竞态、application 行为或性能验收。

## 源码依据与推断

- `packages/application/src/index.ts:218-229` 的 `requireSnapshot` 每次按 store 映射查找并调用 `loadSnapshot`；它还负责 snapshot/repository 归属验证和找不到时的固定错误。
- `packages/application/src/index.ts:260` 的 `getEvidence` 先 `requireSnapshot`，随后独立从对应 GraphStore 读取证据行。
- `packages/application/src/index.ts:360-375` 的 `readSource` 也先 `requireSnapshot`，再读取快照源码并在快照证据中查找所选 `evidenceId`。其后每次都读取当前排除设置、分类路径，并在可用时核对工作区源码哈希。
- `packages/graph/src/index.ts:22-36,320-323` 显示 `loadSnapshot` 查询 payload 后运行 `parseStoredSnapshot`；该函数会 `JSON.parse`、校验完整 `projectSnapshotSchema`，旧版数据还会按既有规则归一化为 partial/legacy 视图。计时只覆盖完整方法。
- `packages/graph/src/index.ts:251-305` 在写入事务内拒绝相同 `snapshotId` 的不同 canonical 快照或源码，并只复用相同内容；`307-317` 将 `current` 激活单独记录在 `snapshot_overviews` 元数据中。
- `packages/graph/src/index.ts:212-226` 每次读取排除设置并提供修订断言/立即事务。`packages/application/src/index.ts:232-257,391-399` 的 current 校验仍重新检查快照状态、源码与策略。
- `packages/application/src/index.ts:378` 关闭时按集合去重关闭该 application 的 legacy 与各项目 GraphStore；缓存须在此之前清除，并区分各 store 实例。
- 决策记录 0002 第 12-14 行要求显式携带 snapshot 身份、打开历史证据时显示快照源码并重新核对工作区 current/stale/missing 状态。缓存不得改变这个区分。

测量与源码共同支持一个有限推断：证据导航每次重新加载和解析同一个不可变快照，是本样例中可归属的主要重复成本。测量没有单独分离 JSON 解析、schema 校验、SQL 或序列化占比。

## 最小候选

若协调方在复验后授权实现，候选仍是 `XRayApplication` 内的**单槽、导航专用只读快照上下文**，只供 `getEvidence` 和 `readSource`；其他 application 用例维持原 `requireSnapshot`。上下文仅保留 store 实例、`repositoryId`、`snapshotId`、`rootPath`、`evidenceId → Evidence` 索引及有效性标记。不缓存源码内容、nodes/edges、`current`、排除策略或工作区状态。只准缓存已通过完整 `loadSnapshot` schema 校验的现代快照；legacy 继续走原加载/诊断路径，不升级、不回写。

有效性标记建议由 GraphStore 暴露窄的只读方法，返回同一 store/SQLite 连接的 `{ dataVersion, localSnapshotGeneration }`；两部分都必须匹配才可命中。`dataVersion` 通过实际 SQLite `PRAGMA data_version` 读取，只与**创建该项的同一个 GraphStore 实例、同一个数据库连接**的上次取样比较。另一连接任何已提交写入都会保守失效（即使与该快照无关）；别的连接自身 token 值不可拿来比较。本连接代数用于覆盖 `data_version` 不会覆盖的 GraphStore 自身写入：每次 `saveSnapshot` 成功提交后递增；迁移在缓存可用前完成并建立新代数，任何未来在线迁移须在变更前清槽/变更代数；写入异常时也可保守失效。`close()` 使 token 不可用/代数失效，application 先清缓存再关闭 GraphStore。当前代码中 payload、evidence 与源码快照的写入集中在 `saveSnapshot`；GraphStore 与 remote store 的迁移在构造期间完成。

**缓存命中前**先确认连接已打开且 `inTransaction === false`，再从该连接取 token。token 不可用、连接关闭或正在读事务时，清除/跳过缓存并沿用原全量读取路径；不能把 cache 当作事务内视图。若读事务覆盖提交点，`data_version` 在事务期间可能仍旧而 SELECT 也看到旧视图；因此不在事务内使用缓存有效性标记，也不跨 API 保留读事务。事务结束后，下次无事务取样应观察到外部提交并触发重新读取。

**首次构建**必须在同一连接且事务外完成两次取样：读取前取 `before`，以现有 `loadSnapshot` 读取并完整校验，再构造局部投影，读取后取 `after`。只有 token 和 `localSnapshotGeneration` 均相等、数据归属正确、投影尺寸合规时才一次性安装完整槽；期间发生跨连接提交、标记读取失败、payload 缺失/损坏或模式验证失败，均不得安装半槽。该次请求可保持当前 `loadSnapshot` 在其 SELECT 时点的结果；随后请求必须重新按现有完整路径读取。提交发生在第二次取样之后时，下一次 cache hit 会先重新取样并因 token 不匹配清槽，因此不会把旧槽用于后续请求。

同槽只允许一个项；序列化投影准入上限建议 4 MiB，超限退回原路径。逐项估算并在超限时提前停止，不为计量临时复制整个图。该上限是准入预算，不等于 V8 heap 上限；未来实现还要记录 `heapUsed` 变化。私有索引不得把可变对象直接返回给调用方；`getEvidence` 仍从 `GraphStore.getEvidence` fresh-read 持久行，`readSource` 仍 fresh-read `readSnapshotSource` 和当前排除设置、路径分类及 workspace hash，私有 `Evidence` 返回前克隆。缓存不得服务关闭后的请求。

该设计以 token 变化观察**其他连接已经提交**的 SQL `UPDATE`、`DELETE` 或损坏 payload；失效后回到 `loadSnapshot`，由已有缺失、解析与归属校验失败关闭。未提交的另一连接写入不可见且不应当被当作已发布状态；rollback 不使 token 变化。GraphStore 本连接的 `saveSnapshot`/迁移由本地代数补足。该标记不是 payload hash，也不能证明多个表读取处于一个原子快照；不把当前导航 API 改造成跨调用事务。

其他 `snapshotId` 成功读取后替换唯一槽；A→B→A 再读取 A。cache miss/error 不得回退到另一个身份的槽。stamp API 自身失败时只能退回原 `requireSnapshot` 路径，且原读路径失败仍须拒绝，不能让缓存结果遮掩。错 repository、缺失 ID、损坏 JSON、legacy、超限和关闭语义均按原实现失败关闭。

## 替代方案与权衡

| 方案 | 收益与代价 | 本轮判断 |
| --- | --- | --- |
| 带 SQLite token 的 Application 单槽导航上下文 | 两个 navigation API 使用；首次 full parse 后可复用；每次命中可观察其他连接提交，并由本地代数覆盖自身写入。需处理读事务、两个 build-time 取样、内存与关闭生命周期。 | 本轮选为最小候选，须经复审后另行授权。 |
| 每请求 GraphStore 窄 SQL 读取 | 无跨请求缓存，也无需 data_version；但直接查询 evidence/source/列会改变完整 snapshot payload 的 JSON/schema 损坏检测和 legacy/error 语义。若每次仍校验完整 payload，可能不能消除主要成本；若只信规范表则同样会漏掉损坏的 snapshot payload。涉及 GraphStore 查询和边界契约更大。 | 可替代方案；若 token/cache 复杂性不接受，应设计足以保留错误语义的窄读后再决定。 |
| 全局 GraphStore 快照缓存 | 可让所有用例复用解析结果；GraphStore 的 `loadSnapshot` 是通用公开方法，调用方可变更返回对象，且不同 application/角色/close 生命周期容易交叉污染。 | 不作为第一切片。 |
| 批量导航 API | 可合并大量单条请求；要改变调用形状，并可能扩展 UI/IPC/契约。当前小样例证明重复调用，但没有证明现有用户路径实际批量请求。 | 暂不扩大到产品接口。 |

## 后续实现的必需门

1. **结果与现有失败语义**：每轮仍完整调用 `getEvidence` 1,177 次及 `readSource` 1,177 次，两轮每类 API/对应单条 store 读取合计 2,354 次；比较全部 1,177 条证据/源码的响应、span、hash、evidence 归属、顺序和错误，不能抽样或只比计数。错误证据、错 repository、快照缺失、错误 JSON、schema 失败都不能回退到旧上下文。
2. **加载次数分母**：原两轮 API 路径共触发 4,708 次完整 `loadSnapshot`。候选命中目标只计 cold/warm 导航阶段引入的完整加载；索引及 current 门禁查询按独立阶段计数、不得放入此分母。一次 medium child 使用同一个 application/store；cold index 的成功 `saveSnapshot` 在导航前完成，warm index 的再次成功 `saveSnapshot` 使本地代数失效。因此在无其他连接提交的诊断配对里，每轮导航首个 cache miss 允许一次完整加载，两轮导航合计 `loadSnapshot ≤ 2`；其余 API/证据/源码/设置读取保持全数执行。任何额外的外部提交会触发重载，必须记录固定 invalidation reason，不能隐去计数。
3. **SQLite marker**：应用/cache entry 只比较创建它的同一个 `GraphStore`/同一连接的 `data_version`；不得比较两个连接返回值，也不得将其称为 hash、全局 revision 或 snapshot identity。根隔离实验所见的另一连接 commit 应使后续无事务 token mismatch，并通过原 `loadSnapshot` 对 update/delete/corrupt payload 重新校验；rollback 不失效。`data_version` 不能在 active read transaction 中观察到提交，因此 cache getter 在 `inTransaction` 时必须不可缓存，原读取按既有事务语义执行；不跨请求持有事务。
4. **本连接写与构建竞态**：同连接 `saveSnapshot` 成功提交后本地代数必变（同 ID current 再激活也保守失效）；migration 完成前不允许建立/命中 cache，未来在线 migration 先清槽并更新代数；close 清槽、标记 token 不可用。用 before/load/build/after 两次取样注入另一连接 commit，确认不安装旧槽；单次读取、token 错误、失配和 exception 都不能留下半槽。更新在 cache hit 的 token 取样之后提交时，不声称本次多表读取具备原子视图；下一请求必须察觉并 reload。
5. **身份/current/历史**：A→B→A；两个 GraphStore 实例/角色即使 repository/snapshot 字面相同也不能共用 token 或对象；跨连接 current promotion 后显式旧 snapshot 仍只代表历史，`getSnapshotState`/`requireCurrentSnapshot` 必须 fresh-check 而不信 cache。相同 ID 不同 payload 经另一连接按原 save API 仍为 `SNAPSHOT_CONTENT_CONFLICT`；当前激活变化不得改 `createdAt` 或快照内容。
6. **配置与工作区**：`loadIgnoreSettings`、`assertIgnoreRevision`、路径分类、secure source read、workspace hash 都不得缓存或绕过。同连接和另一连接修改排除规则后，后续 read 采用当前配置；外部提交同时会令 data_version 保守失效。工作区内容改变后仍显示 stale/既有固定失败。缓存命中不可使旧 current、旧 configurationRevision 或旧源码通过门禁。
7. **别名、legacy 与容量**：改写 `getEvidence`/`readSource` 返回对象后再次读取，缓存对象不变；索引 API 返回值变异不污染缓存。legacy 继续 `partial` / `legacy-missing-source`，不写回归一化结果、不强行缓存。单槽、4 MiB 投影准入上限；超限仍正确读取且不声称命中。记录准入字节和前后 `heapUsed`，不把 JSON 字节预算说成实际 heap 上限。失败写入/解析不能留下半槽。
8. **close 与标记故障**：应用 close 先清缓存再关所有 store；GraphStore close 自身也使 token 不可用；关闭后请求不可从缓存成功返回。pragma 失败或 store 未打开时清缓存、沿原数据库路径读取/失败关闭，不能把 marker 报错解释为授权使用旧缓存。root 的隔离实验确认关闭连接后的 pragma 会抛错，此表现需有纯 GraphStore 回归。
9. **诊断协议另行立项**：冻结的 3E 原报告继续作为 4,708 次 full-load 基线，不修改、不覆盖。当前 3E 汇总校验预期每 API 有 1,177 次 `loadSnapshot`，优化后会变化；任何 post-change protocol/report 和门禁更新必须另列有明确文件清单的 scope。新报告不得泄露原始 `data_version` 值，只能报阶段计数、local/external invalidation 固定枚举、完整加载次数及 full-nav 语义门。保留原 11 项语义门和两轮全 1,177 证据导航。
10. **性能结论**：至少多对 medium 配对，在同一 Windows/Node 环境报告 cold/warm wall、分阶段计数、invalidations、内存和门禁；按 inclusive 嵌套语义解读，另列安全读回放。单次样例不支持实际项目或普遍提速结论；计数下降而 wall/heap 没改善时应保留结果并重新评估，不降低门槛。

## 文件和依赖边界

本设计候选如获授权，首切片的产品/回归边界为 `packages/graph/src/index.ts` 与 GraphStore 测试、`packages/application/src/index.ts` 与 application 测试；不新增依赖、数据库迁移、contract/barrel、UI/IPC/native 改动。`GraphStore` 只加内部导航 validity token 和必要本地代数；不加通用 SQL cache 或全图缓存。当前主 HEAD 已是 `23f6d7a`，S2a 已验收提交；3E 四文件与报告保持冻结，未来编辑者须先核对当时实际工作区，保护无关更改。

本轮仅接受设计，未派产品实现。将来如需验证 post-change 计时，须另列对 `benchmarks/local-index-navigation-diagnostic.ts`、`benchmarks/local-index-navigation-diagnostic-child.ts`、`benchmarks/local-index-navigation-diagnostic.test.ts` 及独立过程记录的协议/报告变更 scope；不得把该变更混入上述产品首切片或覆盖不可变基线。旧次数门不得静默放宽，也不能因有意次数变化称产品缺陷。

协调复审补充：23f6d7a 是作者修订时的基线；本次复审起点实际为 80dff409393680a47ca0ff998bcdaec525eaca88。token 必须校验实际返回值类型与可比较性，不以 undefined/NaN 相等推断有效；本地代数不得溢出后复用旧标记。命中与首建只在同步、事务外取样段使用私有投影，异步源码检查只使用本请求捕获的上下文，不在 await 后换取另一个槽。多表读取仍非原子视图，不将 token 检查后的外部提交描述为本次全部读取可线性化；本方案只要求下一请求观察提交并恢复原校验。后续实现与新协议仍需独立派发、回归及实际多对测量，缓存和收益均未验收。
