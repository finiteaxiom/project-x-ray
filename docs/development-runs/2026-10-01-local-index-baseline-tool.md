# 普通本地索引基线工具记录（3B-L）

## 目标与边界

实现一个只测普通本地索引的小型隔离工具，使用 `XRayApplication.indexProject()`。每组配对在同一个固定样例根、应用实例和数据库上先运行冷索引，再运行无变化 warm reindex；规范化事实、保存内容、快照身份/原始 `createdAt`、源码哈希和节点/证据导航必须通过后，该组才计为有效样本。

实现开始时主 checkout HEAD 为 `e3b870337dfe28b2730d92ab1cd7bc26ddedf2cf`，`git status --short` 为空。已读取该 HEAD 的 `AGENTS.md`、四批计划和 3A-L 基线设计；不读取 Sol worktree。

只新增本记录及以下三个工具文件：

- `benchmarks/local-index-baseline.ts`
- `benchmarks/local-index-baseline-child.ts`
- `benchmarks/local-index-baseline.test.ts`

未修改旧 benchmark、根 `package.json`/锁文件、产品源码、共享契约或 `AGENTS.md`；未新增依赖。

## 实现

- CLI 只接受 `--runs`（1–5）及总 `--timeout-ms`（5000–180000），默认各为 1 和 60000；不接收仓库、样例路径、命令、脚本、输出路径或可选规模参数。样例固定为 `test-fixtures/e2e-project` 的两个 TypeScript 文件和一个 Python 文件，复制前校验三个文件的 SHA-256，另有限制单文件 4096 字节和总计 16384 字节。
- 每次调用在系统临时目录下取得 UUID 根，每次 repetition 有单独目录、样例根、数据库/项目库/cache 和一份唯一 `run-NN/report.json`；调用级汇总另有根目录 `report.json`。目录通过绝对真实路径边界校验；两级报告均以 `wx` 独占创建，已存在时拒绝覆盖。工具不递归删除目录，测试和运行报告均保留。
- 父进程只启动固定的 Node + `tsx` 子进程和仓库内固定 child 文件。取消先发送受限 JSON 控制消息，等待子进程协作退出；超时后 Windows 使用 `taskkill /T /F`，其他平台终止其进程组，再强制终止兜底并等待 `close`。父进程记录子进程退出码/信号、终态与是否已关闭。stderr 不读取或写入报告。
- child 只记录公开的 `IndexProgress` 事件（阶段、相对事件时间、完成数/总数，不含 `currentFile`）。RSS 标为 `process.memoryUsage().rss` 的 Node 索引子进程采样，间隔 20 ms，并明确不包含 Python 子进程。报告只保留相对文件名、哈希、版本、计数、时间及有界状态码；规范化内容只在内存中比较，再保存其哈希，不写源码、绝对根路径、完整异常或凭据。
- 冷/暖门禁比较 `canonicalSnapshotResult`、`canonicalSnapshotContent`、源码身份、repository/snapshot ID、原始创建时间、节点/证据导航标识和范围，以及每条证据经 `getEvidence()` / `readSource()` 实际解析出的源码哈希与当前状态。样例健康必须为 `ready`，且三个预期文件/语言/哈希全部匹配；门禁失败时该组状态为 failed，不计入 `validPairCount`。

## 实现—验证—诊断—修正—再验证

1. 第一次运行定向测试命令 `pnpm exec vitest run benchmarks/local-index-baseline.test.ts` 失败，Vitest 报 `Cannot find package '@project-xray/contracts' imported from .../benchmarks/local-index-baseline.ts`，未发现测试（0 tests）。根因是 `benchmarks/` 不是 workspace package 入口，Vitest 从该目录不能解析 workspace 包名；这是工具测试入口的模块解析缺陷，不是应用索引失败。改为从 benchmark 文件用显式相对路径导入仓库 contracts 源文件后，复跑同命令：1 个文件、6 项测试通过。
2. 第一次小样例 smoke 命令 `pnpm exec tsx benchmarks/local-index-baseline.ts --runs 1 --timeout-ms 60000` 返回 failed，`validPairCount: 0`。保存的报告显示索引 `ready`，冷/暖规范化事实、保存内容、身份、创建时间、节点/证据和源码导航均相同；仅 `expectedSourceFilesEqual` 为 false。对照 `packages/analyzer-core/src/index.ts:148-153` 后确认工具把语言标签预期写成小写，而实际合同值为 `TypeScript`/`Python`。将固定样例标签改为实际 API 值；失败报告保留，不视作性能样本。
3. 修正后重跑定向测试命令：6/6 通过；再运行相同一次 smoke 命令，退出码 0、`status=completed`、`validPairCount=1`。其后补强临时目录对 OS temp 真实路径的约束，再次运行定向测试和一次 smoke，结果仍分别为 6/6 通过、退出码 0、`status=completed`、`validPairCount=1`。当时 smoke run ID 为 `b255e02a-c23d-4ae8-9e91-991bba393439`；其报告检查未发现工作区绝对路径、`rootPath` 字段或样例源码文本。
4. 加入 repetition 独立报告后，再跑定向测试 6/6 通过；smoke run `dd2d3b3f-7fbe-432f-b3da-0a4291e32086` 的调用级及 `run-01` 报告均为 completed。随后增加 spawn 本身失败的子进程回归。首次 7 项测试中有 1 项失败：Windows 对 spawn 失败进程给出整数 close 状态码 `-4058`，测试错误地只接受 `null`；根因是测试断言没有允许 Windows spawn-failure 的实际退出状态，不是工具未识别 spawn 失败。将断言改为验证 `spawn_failed` 和已关闭，同时允许 close 状态为 null 或整数，再跑测试 7/7 通过。最后 smoke run `02eab760-c81c-49c3-9dea-045fd1c374d2` 退出码 0，汇总和 per-run 报告均完成，所有门禁通过；两个报告都没有工作区/临时绝对路径、`rootPath` 字段或样例源码文本。

纯工具测试还覆盖 CLI 参数边界、规范化事实/历史时间/导航差异拒绝、唯一目录及两级报告防覆盖、越界目录拒绝、子进程非零退出及 spawn 失败、协作取消、超时强制终止并等待关闭。

## 首轮实现 smoke 结果（交接前）

该次报告记录 Node `v24.17.0`、`win32`/`x64`、Graph IR `1.3.0`、TypeScript analyzer `5.9.3+xray.3` 和 Python analyzer `2.1.1`。样例 3 个文件的索引健康为 `ready`，事实计数为 15 节点、33 条边、28 条证据、0 条 `unknown` 边；冷/暖源码清单一致，规范化事实、保存负载、同一快照 ID、原始 `createdAt`、节点/证据与源码导航各项门禁全部为 true。子进程以退出码 0 关闭。该次配对报告 run ID 为 `02eab760-c81c-49c3-9dea-045fd1c374d2`，包括调用级和 `run-01` 独立报告。

这一次配对的冷索引为 389.952 ms，无变化 warm reindex 为 250.845 ms；Node 子进程 20 ms RSS 采样得到峰值 244285440 字节。它是一个三文件、单次配对的 smoke 数据。warm reindex 当前仍调用完整索引流程，不能据此宣称增量加速，也不能外推查询、其他规模或其他项目。查询性能、硬件型号/负载、Windows build、物理内存、存储介质、Python runtime、Git、pnpm 和 Electron 版本均未采集，报告相应标明未采集或不适用。

## 未执行项与规则评估

- 未运行旧 `pnpm benchmark`、200/800 文件规模测量、全仓测试、typecheck、build/native/dist、Electron 或任何被索引项目的代码/命令。未测查询性能、Python 子进程内存、并发发布或真实 GUI 操作。
- 各次隔离运行目录和报告位于系统临时目录并全部保留：一次初始语言标签门禁失败，其后成功多次；本记录以最后一次通过的配对作为最终结果。没有删除用户或共享目录。
- `AGENTS.md` 新增/修订数：0。首轮发现的 benchmark 入口模块解析、固定样例语言标签和 Windows spawn-failure 退出状态断言问题均已由测试/源码对照发现并修正，没有证据支持新增一条超出现有测试、证据和安全规则的通用工程要求。

## 协调复核修复（2026-10-02）

本轮复核从主 checkout 实际 HEAD `bf2ed806dadf395bb594cd269f4bba8995220864` 开始；交接记录所列 `32dbae85...` 已被后续协调记录提交推进。核对该推进仅包含协调文档改动，应用源码、图契约和本工具基线未变化。本轮仍只修改三份 benchmark 文件和本记录。

1. 按真实 child 新增取消回归后，首次运行 `pnpm exec vitest run benchmarks/local-index-baseline.test.ts` 得到 8 项中 1 项失败：child 已发出 `cancelled/CANCELLED` 并关闭，但 `forcedTermination` 为 true，父进程等候宽限期后仍必须强制杀进程。根因确认在 `measureIndex()`：RSS `setInterval` 只在 `indexProject()` 成功后通过 `finish()` 清理，取消/失败 reject 路径未清除定时器。将 `finish()` 改为幂等，并在 `try/finally` 中始终调用；真实 child 回归检查取消终态、已关闭且 `forcedTermination=false`。
2. 协调审查报告的协议缺陷复现是：child 返回 `canonicalFactsEqual=false`，同时伪报 `gates.passed=true` 并发送 `completed/OK`，父进程此前只检查 `passed`，因而会接受该配对。这是协议校验产品缺陷。增加真实进程边界回归，覆盖上述矛盾、可接受的成功终态、失败门禁缺少对应 failure code、缺少必需门禁、门禁值类型错误，以及失败门禁与终态码矛盾。父进程现在要求固定 11 项门禁全部恰好出现且为布尔值，校验 `passed`、failure codes、终态状态与终态码一致；只有正常退出、`completed/OK`、全部门禁通过且未被强制终止的 child 才能计入有效配对。
3. 修正后再次运行 `pnpm exec vitest run benchmarks/local-index-baseline.test.ts`：1 个文件、9/9 测试通过。随后运行 `pnpm exec tsx benchmarks/local-index-baseline.ts --runs 1 --timeout-ms 60000`：退出码 0，调用级 `completed`，`validPairCount=1`；`run-01` 也为 completed，child 已关闭且未强制终止，11 项门禁全为 true、failure codes 为空。该次 run ID 为 `8544d06d-9e9f-476a-bb60-6c27fef2d07a`；冷/暖 RSS 样本数分别为 9/8。

这些缺陷属于本工具的取消资源清理与父子协议校验问题，已由针对性回归覆盖并修正。`AGENTS.md` 新增/修订数仍为 0：没有发现适用于仓库其他实现、且未被现有规则覆盖的新经验。未运行全仓测试、typecheck、build/native/dist 或 Electron。
