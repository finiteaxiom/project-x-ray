# 4B-A：自有升级保留与恢复夹具

2026-10-04。开发冻结交付，待 root 独立复验；这是隔离测试切片，不是产品 backup、自动升级保护或 GUI 验收。

## 授权、目录与基线

在既有 5170 worktree 按 [精准复制的实施计划](../plans/2026-10-04-upgrade-preservation-fixtures-plan.md) 执行。计划 SHA256 `62DD9C524613EDEA337258746EC7AAC4F284306DAE1285A02572C498206BF9A3`，与派发值相同。HEAD 始终为 `455d4ad50830ee2495b70927e51caf830a4efbb8`；未对齐 main 或整体同步。开始核对三个目标均不存在，保留全部原修改和未跟踪成果。复核本 checkout AGENTS 的 Git、测试、反馈与协作门；沿用已接受设计并核对冻结 hash。

本轮仅新增两个 upgrade-preservation.test.ts 和本记录。没有改核心源码、原测试、AGENTS、desktop/UI/native、依赖、锁文件、原设计、共同记录或其他 checkout；没有 Git 收尾，没有新 API/helper/barrel。tests 内辅助函数没有成为产品能力。所有 SQLite 文件由本测试生成，固定路径布局、生成标记、目录/叶联接检查；没有读取环境、userData 或真实应用数据来选择输入。

## 实现与实际验证内容

graph 18 项：

- 手写 raw legacy/pre-ignore/pre-activation/schema9 结构，没有先用当前 GraphStore 迁移这些旧结构。按主键比对原字段值和 raw payload，旧 migration 时间保持；允许新增列/default 和物理 evidence.end_line 的兼容填充，不改原 evidence payload。旧载荷读取为 legacy/partial，旧 mastery 不是通过的当前答题，未补造保存源码。
- 当前11 的 global/project 两角色，自有 ready、not-evaluated 和无胶囊 attempt；胶囊经公开 prepare/save 发布。配置变化放在合法发布之后，历史 capsule 的 raw/hash/read 状态仍保留。源码包含非 ASCII 字节，核对完整内容/hash/language、身份、源码范围、creation/activation、mastery/attempts、设置、legacy report 的 raw 值。历史 report 读取明确 partial，不回写。
- global 自有 provider/authorization revision、context、schema 校验的 completed task 与引用闭合 result；public task/result 可重开读取，迁移前后 raw 值保持。没有真实 provider/key、OS 凭据操作或网络 dispatch。
- 重建 schema10：初始化自有有效数据后移除 capsule 表及11标记，再建立保护边界；这是结构兼容夹具，不是旧发行产物。迁移后旧 attempt 为 legacy-capsule-absent，不造 ready 记录。
- 基础 UPDATE trigger 与 version10/11 trigger 的真实 SQLite 失败；构造关闭后第二连接可以取得事务锁，早期已提交 marker/结构仍存在。原包独立还原保持原结构和触发器；安全 retry 只在操作副本去掉故障，不称原包已无故障升级。
- 真实第二连接 BEGIN IMMEDIATE busy，释放后重试；future12/角色误开只观察当前缺口：这个自有 future/project 副本被 global 打开并出现 global 控制表，原包仍不动，没有保护成功标记。这不是生产 future/role guard 通过。
- 活动 writer、重复输出、非法叶路径、单库容量超限和实际 Windows 目录联接拒绝。联接只在本轮根内创建，移除本轮已知联接后确认目标目录仍在；不是原生路径竞态证明。
- integrity_check、foreign_key_check、capsule FK/CASCADE、状态 CHECK 和 global inflight 唯一部分索引的实际结构核对；不以 max 或1..11列表独自证明兼容。

application 5 项：

- 一组 global raw 旧共享库、A 重建 schema10、B raw schema9，另外 B 有 inactive 的较新历史。创建时间与 activation 顺序不同，真实 Application 选择 A；global/A/B 的身份、证据、源码、旧 mastery/attempt、配置、已有 current/activation 与 raw 值保留，操作和独立还原各关闭重开两次。
- B 的 version10 故障被 Application 吞掉，global/A 已迁移，B 留下早期 marker、不可导航，而 A 仍可见。单组测试没有 COMPLETED 标记；明确复现现状，未实现整组失败关闭。
- global 缺 overview 时，真实启动在副本补写一条 partial overview，原 snapshots payload/source 与原始包保持；声明这一允许的应用恢复差异，没有把启动当纯读取。
- global 的 version11 故障使构造失败，项目库尚未打开；它们及整组独立 raw 还原保持原值，锁释放，零完成标记。
- 整组保全拒绝 writer、不完整源集和重复包；没有启动 Application，也没有部分包完成标记。

两个文件独立生成所需 fixture，不互相导入私有测试实现。graph 最多一库、application 恰三库，每库 main/sidecar 总量上限16MiB、整组48MiB；这是测试预算，不是生产库限制。

## 原始包、WAL 与生命周期

源 writer 关闭后记录实际 main/-wal/-shm/-journal 文件集合、大小和 hash，独占复制到 package，再复制 operation；任何 GraphStore 升级只在 operation 或独立 restored 中。源和 package 的完整文件集 hash 在迁移、失败、恢复和再次重开后保持。验证 raw/公开读取门后才写本轮 COMPLETED；预期故障和不完整尝试没有它。副本完整数据门失败也不会生成完成标记。没有原位还原/覆盖用户库。

真实 WAL 正例使用 graph 新测试内固定 Node inline child，只有本轮生成叶路径与固定解析的现有 better-sqlite3 模块路径，Windows hidden、无 shell、忽略 stdout/stderr、固定 IPC。child 不派生进程；关闭自动 checkpoint、同步事务提交固定 marker，发送 committed 后停车。父进程仅对记录的本轮 child PID 用 taskkill /T /F，验证该命令成功、exit 状态和实际 close 后才复制；没有正常 db.close/exit 冒充 crash。

实际非零 WAL 捕获后：main-only 隔离负对照没有 marker 表；完整 operation/restored 文件集各重开两次均能读到精确 committed 行。另在 operation raw 连接执行现有 SQLite backup，完成后关闭 source，logical 副本实际重开也读到该行；这个补充不是原始物理保全或跨库原子 backup。原始源和 package 不做 SQLite open/checkpoint。

ready 上限5秒、阶段上限15秒；taskkill 与等待close各2.5秒合计最多额外5秒，新 WAL 资源测试自身25秒。超时/IPC/取消状态即使在 committed 后也撤销成功资格。负例故意给 parked child 更短350ms阶段预算，实际验证 IPC 前等待和 ready 后未 committed 等待的树终止/close；没有放宽上限或跳过测试。另有 AbortSignal 预取消（不 spawn）及真实 active cancellation（终止本轮 child、等待close）。所有这些负例无包/完成标记。

实际运行的 child 均确认 close，无保留的活进程或未完成清理根。timers、Abort/IPC listeners 和 raw/GraphStore 句柄正常释放；受控根通过标记/实际路径/非联接检查后清理。实现对无法确认 close 的异常保留根，不删除可能持有文件，保留必要 error/close listener 到退出；taskkill 失败/持续无法退出等故障没有人为触发，不能声称这些极端环境已经实验通过。

## 真实反馈闭环

| 失败与复现 | 分类、已确认原因 | 修正与再验证 |
|---|---|---|
| 首轮 graph 定向14项中2项胶囊发布失败 | 测试夹具缺陷。先修改 ignore rules，使没有相应 policy 的旧 snapshot 失去当前发布资格；core 正确失败关闭，不是迁移破坏历史。 | 在合法当前配置下发布，再改变配置以测历史保留；第二轮只剩下面 provider 输入错误。 |
| 第二轮 graph 剩1项 saveProvider 失败 | 测试夹具缺陷。将 provider 读取结果 spread 到严格写入输入，误带只读 revision。 | 用契约规定写入字段；14项通过，后续扩到18项通过。 |
| 首轮 application 定向5项中1项 undefined 迭代错误 | 测试缺陷。getOwnershipProgress 是 Promise，漏 await 后访问 attempts。 | 正确等待 API；5项全部通过，原数据断言保留。 |
| graph 首次 noEmit 的 TS2345 | 测试类型错误。OwnershipAttempt.structuredAnswer 为 unknown，不能直接作为 submission projection 的已校验结构。 | 用 ownershipSubmissionSchema 的结构解析后传入，不作无验证强转；graph/app 两包 noEmit 通过。 |

没有因测试失败修改核心或降低正确断言；没有盲目更新 golden/snapshot。预期 trigger/busy/future/role/多库案例是计划内现状或故障输入，不与以上意外测试失败混记。一次 Windows rg 文件通配写法不匹配属于读查命令问题，随后使用现有文件源码定位；不是产品/环境迁移失败。后续检查补充：真实 FK/index 结构、目录联接拒绝、committed 后成功资格、按显式 PK 排序；相关定向与整包重新验证。

## 实际最终验证

直接运行现有 Node/Vitest/TypeScript，绕开 pretest rebuild，没有构建、native/Electron、GUI、环境修改或用户数据操作。

| 命令 | 最终结果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run packages/graph/src/upgrade-preservation.test.ts --fileParallelism=false` | 1文件18项，exit0 |
| `node node_modules/vitest/vitest.mjs run packages/application/src/upgrade-preservation.test.ts --fileParallelism=false` | 1文件5项，exit0 |
| `node node_modules/vitest/vitest.mjs run packages/graph --fileParallelism=false` | 8文件129项，exit0 |
| `node node_modules/vitest/vitest.mjs run packages/application --fileParallelism=false` | 10文件230项，exit0 |
| `node node_modules/typescript/bin/tsc -p packages/graph/tsconfig.json --noEmit` | exit0 |
| `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit` | exit0 |

最后两包类型检查发生在最终主键排序修订之后；整包也按同一最终两测试文件再运行。测试数量不是产品验收替代，历史 C2/S5/GUI 结果没有混作本轮证据。

## 冻结和后续门

最终测试 SHA256：

- graph/src/upgrade-preservation.test.ts：`6B92986E9E2D9E27606117CF5B8639984401C27CA8D55AE1472C05A37AACF658`
- application/src/upgrade-preservation.test.ts：`A2B9E9368B34B6254C8356068EC9608E5D48F35C1FF3B08CB638D62ECAB6A70C`

冻结基线保持：graph/index.ts `853DA33765953DC5803EFDB692583C37CDED7F13E7266545F1724395DCE4B4AB`；application/index.ts `855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18`；remote store `7923E08945ECE2B38F070F1000916E755CB42B07EC36DDAF8B3622A8BD04EE1A`；capsule store `D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE`。已接受设计 `92EEE06846BB54D64F6D191E3D82CCF2D27425B63CA447273C7F8503F860974B`、原设计记录 `20EF15C94A89C3D3D4493583FAA6E1DF91127C7510F486A65454588109B5C583` 均未改。

root 需独立读取这三文件、运行适用回归与自有 WAL/多库还原探针，再判断接受和精确集成；开发方没有 Git 收尾。B 的生产写前门、future/role 拒绝、跨库失败关闭与路径竞态安全均尚未实现；自有结构样例不证明某真实旧发行版本升级兼容。没有触碰真实库、凭据、远程质量、打包/安装/升级/卸载、签名、干净 Windows、GUI 或发布。

本轮 AGENTS 无新增/修订。保护早于构造、分段/多库非原子、WAL 必须实际恢复的经验已在接受设计和现有数据完整性/真实验证规则中要求；本轮先留下可复现证据供 root 去重判断，不把测试辅助当生产规则或为数量新增条目。
