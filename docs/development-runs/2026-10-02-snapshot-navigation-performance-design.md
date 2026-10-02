# 快照导航性能候选设计记录

日期：2026-10-02
任务：基于协调方完成的 medium128 导航诊断，提出有界快照导航优化候选和后续验证边界；本轮仅作只读源码审阅并新增计划/设计记录。

## 范围与初始状态

- 本轮授权仅新增 `docs/plans/2026-10-02-snapshot-navigation-performance.md` 与本记录。没有修改 application、GraphStore、3E 工具、测试、配置、依赖或 `AGENTS.md`；没有运行索引、构建或测试。
- 当前主 HEAD 为 `23f6d7a`，S2a 已验收提交。首稿写的 `7a9f81b` 是较早的历史 checkout，并错误地把 S2a 描述为未提交；本次已纠正。修订只触碰这两个设计文档，保留主 checkout 其他既有状态。
- 按授权只读协调方 medium128 报告的聚合字段；未打印或保存临时报告路径、源码或敏感数据。

## 复核证据

协调报告的 1 对 medium128 运行完成，11 项门禁全部通过，计数为 128 文件、387 节点、1,275 边、1,177 证据。child wall 26.661 秒；cold/warm 索引 1.453/1.202 秒；cold/warm 全证据导航 10.937/11.020 秒。两个导航阶段的 application `getEvidence` 和 `readSource` 均分别调用 1,177 次。

每个导航阶段内，`getEvidence` 的 `GraphStore.loadSnapshot` 为 1,177 次、4.363/4.400 秒；`readSource` 的 `loadSnapshot` 同为 1,177 次、4.360/4.368 秒。其他 GraphStore 证据行读取、源码行读取，以及 `readSource` 排除配置读取仍各 1,177 次。Application/store 计时为嵌套 inclusive，不能累加成 wall；GraphStore `loadSnapshot` 是 SQL 读取加 JSON/schema 校验和 legacy 归一化的整段方法，未将时间归因到其中某个子步骤。

两轮每类 API/对应单条 store 调用合计为 2,354；原导航路径每个 API 调用都会 full-load，一共 4,708 次 `loadSnapshot`。后续命中门只计算导航阶段新增的完整 snapshot 加载，排除索引/current 查询阶段，防止门的分子分母混淆。

独立安全读回放为 1,177 次、0.788 秒，不作为 `readSource` 内部路径或优化收益。5,000 毫秒 timeout 样例没有有效配对；它低于本次单个 child 的 26.661 秒 wall，因此保留全部证据/门禁时不可能完成一对。协调方另报告取消子进程正常 closed、没有强杀、第二对未启动。没有把这些时限结果描述为产品失败，也没有放松门槛。

源码审阅确认：`XRayApplication.requireSnapshot` 每个请求都会从 `GraphStore.loadSnapshot` 载入完整对象；`parseStoredSnapshot` 会 JSON 解析、校验全量 snapshot，并为旧记录应用既有 partial/legacy 兼容转换。`getEvidence` 随后仍查询规范化 evidence 行；`readSource` 仍需从 snapshot 查 span proof，并额外读取源文件行、当前排除设置和当前工作区状态。GraphStore 对同 `snapshotId` 内容冲突失败关闭，current 激活保存在独立 overview 元数据；这些构成只读上下文候选的身份边界。

本地锁定依赖与声明确认 `better-sqlite3@13.0.3` 的 `.pragma`、`inTransaction` 属性及 `simple` 选项均可用；仓库 `remote-explanation-store.ts` 已使用 `inTransaction` 强制调用方处于指定事务。GraphStore 当前在构造时同步执行主/remote migration；GraphStore 主 snapshot payload、evidence 与源码行的持久化写入位于 `saveSnapshot` 事务。该类对同 ID 不同 payload/source 拒绝 `SNAPSHOT_CONTENT_CONFLICT`。

## 结论与限制

已观察到反复 `loadSnapshot` 是这个合成样例下每条导航 API 的主要可归属开销。首稿提出的无验证 app cache 会在另一连接提交 SQL UPDATE/DELETE 或 payload 损坏后继续复用旧上下文；这会削弱当前每请求全量读取的失败关闭行为，协调方拒绝该首稿方案。已把候选改为每次命中读取同一 GraphStore 连接的 validity marker，并为本连接写入补充单独代数。

协调方在隔离临时 WAL 数据库内用两个实际 SQLite 连接完成了纯机制实验，命令 `node --import tsx .benchmarks/remote-desktop-review-20261002/snapshot-navigation-data-version.ts` 退出码 0、断言全部通过，隔离目录随后清理。实验结果：首连接初始 `data_version=2`；本连接 UPDATE 提交后仍为 2；另一连接 UPDATE 回滚后仍为 2、提交后为 3。首连接随后 BEGIN 并 SELECT；另一连接在期间提交 UPDATE，但该读事务中 token 仍为 3且 SELECT 看到旧 payload；读事务结束后 token 为 4且新 payload 可见。另一连接 DELETE 后 token 为 5且新 SELECT 无行。关闭后再执行 PRAGMA 会抛错。该实验不访问项目数据库，也未运行 GraphStore/cache 产品代码。

SQLite 官方语义与实验一致：`data_version` 是连接局部标记，比较同一个连接的不同时点；其他连接提交会变，本连接提交不会变，其他连接的 token 不能互比。[SQLite `PRAGMA data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) better-sqlite3 `pragma(..., { simple: true })` 返回首行首列，并在 PRAGMA 出错时抛错；`Database.inTransaction` 能检测连接事务状态。[better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#pragmastring-options---results)

修订候选由 `{ dataVersion, localSnapshotGeneration }` 构成。cache hit 只在同一 GraphStore 实例/连接上、且 token 相同、`inTransaction=false` 时有效。新槽先后取两次 token；区间有其他连接提交就放弃安装。每次 `saveSnapshot` 成功事务后本地代数递增（必要时失败分支保守清槽）；schema migration 必须在缓存暴露前完成，未来在线 migration 明确清槽/换代；close 标记 token 不可用且 application 清 cache。匹配失败或 token 不可用时回到原 `requireSnapshot/loadSnapshot`，让外部删除、错 repository 和坏 payload 被现有路径观察并失败关闭。

读事务中 `data_version` 可能保持旧值且 SELECT 视图也旧，故 cache hit/build 不得在读事务里；不跨请求持有读事务。此次 root 机制实验验证了该限定，但没有验证 GraphStore token 封装、首构建竞态、cache lifecycle、caller mutation 或 application 状态。它是设计输入，不是实现验收。

按成功 `saveSnapshot` 每次更新本地代数的保守设计，cold 与 warm index 间会各触发一个导航 cache miss；因此在无外部提交的两轮 medium 配对里，导航引入的完整 `loadSnapshot` 目标为最多 2 次，而非首稿中的 ≤1 次。两轮 API/对应单条 store 调用仍各 2,354 次；总数从原 4,708 次完整加载降至不超过 2 次的目标尚未实现或测量。index/current 操作的 loadSnapshot 继续按独立阶段报告。

原 3E 报告与工具冻结作 baseline。其现门预期导航 store 每 API 调用有 1,177 次 `loadSnapshot`，会与未来 cache 目标不同；需另开明确协议/报告修改 scope，新增 stage load 数和固定 invalidation reason，不改旧报告，也不把旧次数门失败解释成语义门失败。

## 反馈闭环与验证范围

本轮为设计修订，没有运行 GraphStore/application 测试、索引、build、native、Electron 或 GUI，也没有 Git 写操作。协调方提供的纯 SQLite 双连接机制实验成功并按原证据记录；没有把它外推为产品缓存验收。

设计审阅反馈闭环：首稿漏掉跨连接 SQLite 更新、删除、损坏 payload 的可观察性，属于设计完整性缺口，不是产品或测试失败；协调方指出后，查阅当前 better-sqlite3 13.0.3 类型/API 与应用代码，并采用 SQLite 官方同连接 `data_version` 语义和 root 的双连接实测修正方案。额外修正了首稿错误的 S2a 未提交状态，按协调方给定的当前主 HEAD `23f6d7a` 与 S2a 已提交事实更新。

已确认的 SQLite 机制不等于 cache 实现成功：两次 token 取样安装、active transaction bypass、同连接 generation、外部提交后的坏 payload/删除、close、跨实例隔离和对象别名均待未来产品回归。候选方案仍待 root 复审，本轮不声称 root 已接受实施。

没有更新 `AGENTS.md`，本轮无新增规则。虽然 SQLite token 的连接局部行为已由隔离实验确认，但产品 cache 尚未实现或回归；避免把未完成的专项设计写成仓库通用经验。

## 修改范围

- `docs/plans/2026-10-02-snapshot-navigation-performance.md`
- `docs/development-runs/2026-10-02-snapshot-navigation-performance-design.md`

没有执行 Git 写操作、真实索引、产品测试或构建。只修订计划与本记录两文件。后续实现需由协调方复审/单独派发，保留 3E 原工具、报告和主 checkout 其他已有内容。

## 2026-10-02 23:25 协调复审

完整设计与main源码/官方SQLite及better-sqlite3 API已核对，接受修订设计与门禁。root在plan纠正多store关闭事实、作者历史基线，并补token类型/本地代数、请求私有上下文及多表非原子视图的边界。没有缓存实现或收益验证；原3E基线冻结，产品切片等待S4/S5共享文件窗口后精确派发。先派Luna独立3F-T协议设计两文档，不提前修改工具。计划/本记录仅设计接受，AGENTS新性能规则0条。
