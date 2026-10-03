# 4B-Sol：Windows 升级前保护与自有迁移夹具

2026-10-04。设计冻结稿，供协调方复审；当前仅新增设计和过程记录，不授权下述实现。依据 [第四批第一阶段范围](2026-10-04-windows-release-preparation.md)。GUI 暂缓；不打开、扫描或备份用户真实应用库。

## 结论与证据等级

升级保护必须位于任何 GraphStore 构造、WAL 设置、应用 overview 恢复和远程启动恢复之前，并覆盖整组 global/project 数据库。建议先实施两个隔离夹具测试文件，验证真实迁移和可恢复副本，再根据结果派发生产保护接线。不能在 GraphStore 构造后新增 backup 调用就宣称解决升级保护。

已确认的是源码行为及保护缺口：当前没有升级前备份入口，没有 future-schema 拒绝或持久化角色绑定；迁移不具有整库/多库原子性，项目打开失败可以被吞掉。没有运行迁移探针，未确认升级导致数据丢失、future 库被损坏、角色误开或句柄泄漏的实际故障。不以风险推断替代复现，不以最高版本 11 或版本号齐全证明兼容。

本设计的“已确认”指当前源码直接可见；运行行为、复制一致性和恢复成功均待实施后实际验证。现有测试只是覆盖依据，本轮没有重跑。

## 当前迁移与首次写入边界

| 位置 | 实际行为与升级影响 |
|---|---|
| [GraphStore.constructor](../../packages/graph/src/index.ts) | new Database 默认可写；创建共享连接的辅助 store 后，设置 busy_timeout=250、journal_mode=WAL，再依序 migrate→remote.migrate→ownershipCapsules.migrate。异常关闭自身连接并重抛；已完成的此前写入没有统一回滚。 |
| GraphStore.migrate | 大段 CREATE TABLE/INDEX 和版本 1–3 写入不是外层事务；补 evidence 三列，end_line=0 行改成 start_line；补 overview.is_current 默认 1、建 overlap index，再写版本 4–7。独立事务补 activated_at 默认空串，先写 9，再建 ignore 表并写 8。每次构造都会执行这些操作，不按 max(version) 跳过整个迁移。 |
| [RemoteExplanationStore.migrate](../../packages/graph/src/remote-explanation-store.ts) | 独立 immediate 事务，两个角色都建 remote_explanations、写 10；只有 global 建 provider_settings、authorizations、contexts、tasks 及单一 inflight 索引。角色来自构造参数，不是库中已验证的身份。 |
| [OwnershipCapsuleStore.migrate](../../packages/graph/src/ownership-capsule-store.ts) | 先要求该连接 foreign_keys=1；独立 immediate 事务建 ownership_semantic_capsules、写 11。胶囊 FK 指向 attempts，状态有 ready/not-evaluated 约束。不能以表存在证明约束或旧胶囊有效。 |
| GraphStore.getLatestOverview/getOverview | overview 缺失时从最新 snapshot 生成并 INSERT OR REPLACE；因此“只读最新项目”的应用启动也可能补写。activated_at 空串的当前性排序使用 created_at 回退，不应升级时重新激活所有历史记录。 |
| [XRayApplication.constructor/loadProjectStores](../../packages/application/src/index.ts) | global 先迁移、取 latest/currentActivation，再 mkdir 和逐个打开 project。单项目异常被 catch 后继续；可能已有其他库迁移成功，不是整体失败关闭。构造后再备份会漏掉原始状态。 |
| Application 的后续打开 | storeForRepository、requireSnapshot、requireNavigation，以及 remote currentReference 扫描均可创建 GraphStore；只保护构造时已有槽不能保护后来出现的库。 |
| 主 checkout 已集成的 [桌面 main](../../apps/desktop/src/main.ts) / [analysis-worker](../../apps/desktop/src/analysis-worker.ts) | 主 checkout main 当前是 app.whenReady→new AnalysisBroker→创建 analysis-worker；worker 顶层构造 XRayApplication，随后打开 global/project。升级门必须早于 AnalysisBroker。主 checkout 当前 main 没有 startOwnedApplication/ExplanationPolicy/explanation-worker 的整体启动接线。 |
| 本 worktree 保留的待集成桌面接线（仅文本标识，不链接到 main 中未集成模块） | worktree main 调用 startOwnedApplication，先构造 ExplanationPolicy 开 global，再 broker/worker；policy.refresh 开项目库；explanation-worker 同时构造 policy 和 Application。这些属于保留成果，不能因 core 三 store 同 main 就称桌面接线也已集成。若以后接受并集成，升级门须扩展至这些额外入口之前。 |
| 本 worktree 的 startup-ownership.ts（待集成依赖） | 该实现的单实例锁先于 initialize，直到退出保留；旧技术验收不证明主 checkout 已存在此能力。B 需先明确并审查启动所有权前置能力，不能假设 whenReady 自带该锁；即便接入，仍不能证明外部 SQLite writer、旧身份实例或其他工具已停止访问。 |
| core 远程恢复能力与待集成调用路径 | remote.recoverInterrupted 会终结未完成任务、清 inflight、使 context 失效。这是 core 能力；worktree 远程启动路径不是 main 当前已接线事实。未来接入时，迁移保留检查须先于合法启动恢复；completed 历史与启动终态变化分开核对。 |

这里的相对链接只指主 checkout 已存在的对应 core/桌面文件；表内另述 worktree 待集成接线，文档复制到 main 不表示那些模块或调用路径已经存在。不读取任何运行时 userData。GraphStore 三段迁移共享同一 SQLite 连接，分别提交，不代表三个独立数据库。global 与多个 project 则确为多库，不能用一个库的事务证明整组一致。

## 升级前保护方案与最小切片

### A：下一批拟授权的隔离验证，先不改产品

仅建议新增以下文件，另附该批实际过程记录：

- `packages/graph/src/upgrade-preservation.test.ts`：文件内生成 raw SQL/当前公开 GraphStore 自有夹具，保全原始文件集、制作可操作副本，在副本上运行真实 GraphStore 迁移、故障和还原门。
- `packages/application/src/upgrade-preservation.test.ts`：文件内生成一个 global 和两个 project 的自有小夹具，验证真实 Application 打开顺序、current/partial/ownership 数据语义及单项目失败的现状。原测试不改。
- `docs/development-runs/2026-10-04-upgrade-preservation-fixtures.md`：记录实际成功/失败、分类、版本和限制。

不要为这轮加入公共 backup API、CLI、barrel、迁移重构或依赖。测试内的复制/还原辅助函数仅服务自有 fixture，不是生产保护功能。应用测试不导入 graph 测试内部 TypeScript 实现；各自建立其必要最小数据，避免跨包私有实现依赖。ready/not-evaluated 胶囊材料按现有 capsule 测试的契约独立生成，不复制整套原测试或修改评分。

测试根由本测试 mkdtemp 创建；不接受命令行、环境、userData、任意项目路径或“用户确认已有库”作为输入。所有 setup、备份、迁移、child、清理只接收该根内部固定布局；验证实际规范路径、固定叶名和非联接/链接，输出使用 fixture ID。越界、已有输出、非本轮生成标记、活动写连接均拒绝，不靠字符串前缀独自证明生产路径安全。仅测试自身建立的 SQLite/应用代码，不执行被导入样例。

#### A 的 WAL child：固定内联代码，无新增 helper 文件

WAL child 只放在 graph 新测试文件内，使用固定字面量 Node child 代码，不新增第三个源码/helper 文件。application 新测试只使用已关闭的自有夹具，不再启动 WAL child。父进程通过 process.execPath 和分离参数 spawn，windowsHide=true，stdio 的 stdin/stdout/stderr 置 ignore，只启用专用 IPC；child 不派生其他进程。仅传入父进程新建根内的固定 wal.sqlite 叶路径，以及父进程固定解析出的已安装 better-sqlite3 模块路径，均不接收外部输入、不记录命令行或源码。

- 父进程立即登记 spawn/error/exit/close、IPC、AbortSignal 和 deadline，保留本轮唯一 child 对象及其 PID。固定 IPC 仅允许 ready 和 committed 两种消息及固定 fixture ID/计数，不能带路径、SQL、payload 或自由错误。收到重复/错序/无效消息即失败，不能作为静止或保护完成证明。
- child 打开自己生成的 fixture，设置 WAL、关闭自动 checkpoint，发送 ready；同步事务写固定可识别记录，事务调用成功返回后检查该记录并发送 committed，随后保持等待。不调用 db.close，也不正常 process.exit；父进程在 committed 后以 Windows `taskkill.exe /PID <本轮child PID> /T /F` 强制树终止。这是唯一正例异常退出切点，发生在提交之后、关闭/最后连接 checkpoint 之前，不使用 process.abort 产生 dump。
- 从 spawn 起 ready 最多等 5 秒，整个 child 生成/提交/强制退出过程最多 15 秒。启动、IPC、提交、取消或超时故障也走本轮 PID 的同一树终止；taskkill 本身及随后等待 close 共最多再用 5 秒，终止命令 hidden、无 shell 字符串拼接，不枚举或杀任何其他进程。新 WAL 测试自身给出最多 25 秒时限以包含清理；不修改原测试 timeout，不用放宽时限掩盖故障。
- 正例必须同时确认 committed、终止命令成功和 child close（exit 状态也记录）；只收到 exit、发出 kill 或等一段时间不够。若 child 在切点前自退出，或 taskkill/close 无法确认，判失败，绝不复制或打开其数据库。超时/取消即使后来拿到 committed 也不能恢复正例资格。超时树终止后仍必须等待实际 close；等待上限耗尽则保留受控根、报告清理未完成，不尝试删除仍可能被持有的文件。
- child 确认关闭之后才建立保护边界并复制原始文件集。实际 WAL 存在性、大小和 hash 要采集，但有 sidecar 不是通过证据；正例另做 main-only 隔离负对照及完整集合的操作/还原副本重开，验证固定已提交记录只在正确恢复路径中完整保留。若环境没有留下所需 WAL 条件或负对照也完整命中记录，该 WAL 样例失败/未完成，不能靠断言 sidecar 必有或运行中拷贝制造通过。
- 启动未完成、取消、超时、提交失败、非预期退出、终止失败、复制/恢复失败均返回失败/未完成状态，整个尝试不发布保护完成标记；保留已捕获原始包但不称本次门通过。最终成功标记只能在 child close、整组 hash 校验及独立还原数据门全部通过后生成。afterEach/finally 清除 timers/IPC/Abort listeners、关闭本轮 raw/GraphStore；只有所有 child/handle 已确认退出且实际路径仍在本轮 mkdtemp 根、固定标记/非联接检查通过时清理该根。没有清库、覆盖旧包或宽泛 tmp 清扫。

### B：待 A 的证据和新授权后再做生产接线

候选文件边界为 graph 内部新 `upgrade-preservation.ts` 和对应测试、application/index.ts 中每个 store 创建门及测试、desktop/main.ts 的启动前门及启动回归。GraphStore 公共 API、native、IPC/UI、contracts、依赖不自动进入范围；具体 API 和是否需要 graph 构造前统一检查，由协调方根据 A 的结果再定。这个清单不是当前实施许可。

现有 main 入口的 B 门：先审查/取得有效启动所有权（当前 main 没有本 worktree 的 startOwnedApplication 接线，前置能力不得省略）→ 在 app.whenReady 回调中创建 AnalysisBroker 之前捕获固定 global/project 清单 → 证明整组静止或拒绝 → 保全全部原始文件 → 在操作副本上识别结构/角色/未来版本并验证恢复 → 才允许创建 broker/analysis-worker 与已批准库首次打开。任一库保护失败，不能让别的库先迁移。之后新发现的项目库须先通过同一保护门，不能直接懒打开。

待集成入口的额外依赖：只有 worktree 的启动所有权/ExplanationPolicy/远程 broker/worker 接线单独审查并进入 main 后，才在对应启动点落实同一升级门早于 policy 构造及全部 worker；不能让未来远程降级 catch 绕过该门。这是未来接线依赖，不是当前 main 已有功能，也不由 A 的 Node/SQLite 夹具证明其 GUI/启动验收。

生产接线需明确另一个层面的安全约束：项目文件之外的应用数据路径如何绑定 Windows 根句柄、如何拒绝目录联接替换、如何证明 writer 已停止、如何保持多 worker 不抢跑。当前读取项目源码的 secure-reader 能力不能直接假定适用于数据库文件复制或 SQLite 打开。A 的临时目录能力不证明 B 已满足这些要求。

## 文件集、WAL/SHM 与资源契约

以“本轮 fixture 初始化完成、升级开始”作为保护边界。初始化原样例需要的写入不是升级写入；边界后，原始库不交给 GraphStore，也不在原始库上 checkpoint、设置 pragma 或运行应用查询。

1. 记录固定集合中每库 main、存在的 `-wal`、`-shm` 和异常 `-journal` 的存在性、字节数及 SHA256。使用独占新目录，绝不覆盖既有副本；父目录与所有叶路径在 fixture 根内。先保全整组，再处理任何一库。字节保全包包含数据库本体，属于私有本地恢复材料，不上传、不提交仓库、不把 payload 写进摘要。
2. 干净关闭正例：close 所有 fixture writer，再捕获和复制实际剩余文件集；不假定 close 后 sidecar 必不存在。重复核对源集/内容/目标 hash。文件读取无变化仅是辅助条件，不能替代静止证明。
3. WAL 正例严格使用 A 中固定内联 child、committed 后强制树终止及 close 确认方案；源再无 writer 后才复制整组。独立副本实际重开验证已提交记录，不能仅 main 复制或以 sidecar 存在声称恢复成功。SHM 不是单独的 durable 数据来源；原始失败现场仍连同其存在状态保留。只在操作/还原副本上允许 SQLite 重建 SHM 或恢复日志，不动保全包。
4. 不支持直接复制运行中数据库。busy、活动事务、未知外部 writer、不能证明停止、侧文件变化、容量不足、复制/校验失败均停止，不盲目 retry，不把不完整目录发布为可恢复。活动事务回滚/提交后须重新建立保护边界。
5. 现有 better-sqlite3 `lib/methods/backup.js` 有异步 backup API，结束/失败均关闭 backup handle；可在 fixture 的操作副本 raw 连接上补充逻辑 backup→独立重开比对。它不保存原始物理失败现场，不提供多库原子性，也不应在已迁移 GraphStore 上调用来冒充升级前备份。其完成前不能 close 相关 source handle。若未来选择对生产原库 readonly online backup，WAL/SHM 和原库写行为必须另行验证，当前不授权或假设。
6. 保全目录与迁移目录、还原目录三者分开；保全包只读使用，任何迁移失败保留迁移副本供诊断。关闭所有句柄/child 后复制到新的还原目录；不自动覆盖原始库，不附带删除它的新 WAL。日志只包含 fixture ID、数量、hash、固定阶段/错误分类，不保存 raw SQLite error 或源码。
7. 暂定自有夹具预算：最多 3 个库，每库 main+sidecar 总量不超过 16 MiB，整组不超过 48 MiB；这些是测试资源上限，不是生产库容量限制。任何超过预算、取消或复制故障都无已完成 marker，保留原始包；清理由本轮根范围检查后进行。生产容量/磁盘余量和进度策略另设计，不能沿用测试上限拒绝正常用户数据。

“写前”包括 SQLite 的 journaling/sidecar 修改，不只 SQL 数据行写入。因此初始识别和 schema 检查在已保全的操作副本执行；原库不先用 readonly SQLite 打开来假定零物理变化。整组静止成立才能建立跨库的共同边界；独立在线 backup 的各个时间点不能自动称共同快照。

## 必要夹具，不做版本号排列

| 夹具 | 选择依据及断言 |
|---|---|
| 旧共享结构与 legacy partial | 手写与现有 legacy 兼容入口匹配的 snapshots/evidence/overview 结构，不借当前 GraphStore 先迁移。含缺 analysisIdentity/sourceFiles 的旧载荷、已有旧 partial、旧 mastery。raw payload/times 保留；读取旧载荷只能归一化成 legacy/partial，不能补造不可变源码或 verified 完整分析。补列唯一允许差异是新增默认列及 end_line=0→start_line；payload 本身不改。 |
| pre-ignore/pre-activation 代表结构 | 缺 ignore 表、activated_at，可包含已有 is_current=0/1 两快照；验证 8/9 的实际补列和表、旧 migration 时间不改、空 activation 用 created_at 回退。缺 is_current 的更旧分支只断言当前默认 1 行为，不捏造原本不存在的唯一 current 指针。 |
| schema9 代表结构 | 独立定义已有 ignore/current/activation，缺 remote/capsule；global/project 两角色升 10/11 的真实表/列/index/FK 检查及历史数据保留。 |
| schema10 代表结构 | 当前公开 API 建自有有效数据后，受控移除 capsule 表和 11 标记，明确这是重建兼容夹具，不是某旧安装包产物。已有 attempts 留 `legacy-capsule-absent`，不得伪造评分或 ready 胶囊。 |
| 当前11 | valid ready、not-evaluated 胶囊各一条，另外保留无胶囊 attempt；重新打开检查精确原 payload/hash 与 load 状态。pre10 角色夹具的授权默认应 denied/unconfigured；当前 global 则保留 provider/authorization revision、context、任务和 completed 结果。只使用非秘密自有值。 |
| 混合三库组 | global 含共享历史，project A 较新、project B 较旧或故障；每库有独立 repo/snapshot ID，created_at 顺序与 activated_at 顺序不同。保护整组后 Application 的实际 current、旧 source、partial、mastery/attempts 要可识别，不能只数行。 |

夹具标记须称“结构兼容样例”，不是已确认支持某发行版本。现有迁移记录不保存连续逐版脚本；不将数组 1..11 重放当历史迁移，也不把 schema9 当本轮最高版本。

保留清单按主键排序比对 raw 值/字节：snapshots；nodes/edges/evidence（证据物理 end_line 兼容变化独立列）；source_snapshots content/hash/language；overview 的 payload、is_current、created_at 和已有 activated_at；ignore rules/revision；mastery、attempts、capsule payload/hash/status；change_reports；global provider/authorization/context/task；completed remote_explanations。旧 applied_at 逐条保持，新标记单列。不存在的历史 source 不补造。外部 OS 凭据不在数据库备份范围，测试不调用 Credential Manager。

## 故障、未来版本与角色门

- **迁移失败切点**：在操作副本给 schema_migrations 放置只阻止写 version=10 或 11 的固定触发器，产生真实 SQLite 事务失败；检查构造抛错、其连接关闭/锁释放，以及早期迁移已提交的实际差异。触发器在原始自有 fixture 内即存在，保全后才运行迁移；还原验证用 raw 连接读取原结构，不能移除故障触发器并称原包可正常升级。另做操作副本解除故障后的安全重试，原包始终不改。
- **基础阶段失败**：旧 evidence 结构缺必要列使后续 index/UPDATE 失败，标明“故意不支持/损坏结构”，观察是否已有 1–3 写入；不是一个产品缺陷结论或有效历史兼容失败。不得全库事务包装测试去遮住真实分段行为。
- **busy/事务**：自有第二连接持 BEGIN IMMEDIATE；失败窗口固定、不改生产 timeout 或原测试时限。保护层不接受活动 writer；另在迁移副本观察真正 busy 的错误和锁释放。无故障恢复后重开，确认 source/attempt 不被半写。
- **多库失败**：Application fixture 的 B 失败时核对 A/global 是否已迁移、B 是否被跳过、current 与错误可见性；这检验现状，不把“仍启动”算整组升级通过。B 生产门必须拒绝部分迁移继续，并保留所有包；跨库自动回滚/原位还原不在 A 范围。
- **未来 schema**：没有 >11 拒绝是源码确认的缺口；尚未证明损坏。A 构造一个标记 12 加未知结构的自有样例，仅在操作副本观察原 GraphStore 行为并记录。B 拟要求已知版本集合、实际支持的表/列/index/FK/角色 profile 一起核验，任何未来/非法/不可解释状态在原库可写打开前拒绝；不自动删表、降版本或写 11“修复”。max<=11 只是一项否定检查，不是通过证据。
- **角色错配**：两个库最高标记都可能为11，不能从此推断角色。B 角色由受信启动清单给出；project 出现 global 专属控制表须拒绝而不删表，pre10 无专属表依已知结构 profile 和清单判定，不强制所有旧 global 已有10表。空/缺 global、同一物理文件同时登记两角色、路径别名和未知库须显式区分。现阶段参数检查只拒绝非 global/project 字符串；误将 project 用 global 打开没有持久化角色校验，A 只在副本复现实际结果。
- **完整性检查**：在操作/还原副本检查 integrity_check、foreign_key_check、sqlite_master 与 table_info/index/FK 结构，并走公开 load/read/list 接口。检查通过不证明所有 payload 可用，payload/身份/哈希与 current 门仍必需。若旧材料本就不满足当前评分前提，保留历史且不得当当前掌握度通过。

## 下一实施与独立验收命令

协调方接受 A 后，开发方依次运行拟新增的两个测试；任何失败先分类再提出必要修正，不能从设计直接跨到核心迁移修复。仅正常 Node/SQLite、自有临时目录，无 Electron/native rebuild/打包/GUI/真实库。

```powershell
node node_modules/vitest/vitest.mjs run packages/graph/src/upgrade-preservation.test.ts --fileParallelism=false
node node_modules/vitest/vitest.mjs run packages/application/src/upgrade-preservation.test.ts --fileParallelism=false
node node_modules/vitest/vitest.mjs run packages/graph --fileParallelism=false
node node_modules/vitest/vitest.mjs run packages/application --fileParallelism=false
node node_modules/typescript/bin/tsc -p packages/graph/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit
```

门：原始包及源集 hash 在操作副本迁移/失败后不变；整组保全完成早于任意 GraphStore；实际 WAL 已提交行在独立还原重开后存在；备份操作失败无完成结果、原集不动；上列逻辑数据精确保留或仅出现已声明兼容变化；close 后第二次重开仍一致；资源均释放；摘要无源码/凭据/私人路径；unsupported/future/role 问题不冒充通过。

root 独立复查实际待交付差异、重复这些回归并运行自有双/多库探针后决定集成。生产写前门、运行中在线备份、真实旧安装版本、NSIS/portable 共存、GUI 升级/卸载、签名、干净 Windows 和公开发布均未验。本轮不新增 AGENTS 条目：只有静态调查和方案，尚无新的复现实验，既有数据完整性与过程规则已覆盖基本要求。
