# 3G-S1：普通索引 Python 解析缓存

2026-10-04。原四批第三批，Sol5170。状态：产品普通入口已实施并完成本地定向/适用回归，冻结待协调方独立验收；不等于 Electron 或集成完成。

## 基线、授权与本批差异

分支 `codex/llm-explanations`，HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8` 未变。按 `docs/plans/2026-10-04-python-parse-cache-implementation.md` 实施。没有 reset、整体复制旧差异、提交、推送或合并；全部旧 modified/untracked 内容保留。

本批开始时保存批准文件的精确只读副本供前后 diff；交付 patch 由这些副本与当前内容生成，不使用 HEAD 到工作区的总差异充当本批差异。已有文件保持其换行惯例。

| 文件 | 本批变化 |
| --- | --- |
| analyzer-python/src/index.ts | worker 脚本执行前后摘要与响应身份核验；PythonResult 增 runtime/worker 指纹，协议/分析器版本 2.2.0；分离纯 normalize；可选单轮 reuse session；原全量跨文件解析不省略。 |
| analyzer-python/python/analyze.py | 标准库生成解释器版本/实现/cache tag、实际解释器与 ast 文件 hash 的 runtime 指纹及本 worker 字节摘要；不执行目标项目代码。 |
| 新 analyzer-python/src/parse-cache.ts/test.ts | 格式 1，复制调用者材料、每轮至少一个真实文件探测，优先 miss；最多四路后续 miss；runtime/script 变化弃 hits、一次有界冷回退，持续变化失败关闭。只缓存成功无快照 DTO。 |
| graph/src/index.ts | 接入 project-only 缓存端口；图提交事务内捕获 activation，按返回 snapshot 对象保存私有 commit receipt；nested save 无发布凭据。既有图事务/历史不可变语义保持。 |
| 新 graph/src/analysis-parse-cache.ts/test.ts | 项目库迁移12；有界 SQL 候选读取、origin/source/hash/digest/预算门；精确 current activation/config/revision/producer/source 的事务发布；失败放弃优化。 |
| application/src/index.ts | 仅普通 indexProject 加载/使用/发布 session；完整安全捕获/再验证保持；persisting 回调后检查取消，图提交后不再以迟到 abort 逆转完成；close 后提交前拒绝写入。观察关闭/异常不改结果。 |
| 新 application/src/incremental-index.test.ts | 真实安全读取、Python worker、项目 SQLite、新应用重开、冷 oracle、取消、并发、配置/源码漂移、warm junction、BUSY、Git 双侧冷路径。 |
| application/src/index.test.ts | 协调方追加批准：仅当前 Python 版本断言 2.1.1→2.2.0、previousPythonVersion 2.1.0→真实上一版2.1.1；其余 TS/身份/源码范围/语义断言保留。 |
| graph/src/ownership-capsule-store.test.ts | 协调方追加批准：仅项目库精确迁移列表 length11→12；foreign_key_check、历史、源码与全部所有权断言保留。 |
| 新 benchmarks/python-parse-cache.ts | 有限20/80 Python文件及TS-only对照；新进程/新应用、独立冷库/预热热库、三组成对样本；保留自有材料，不递归清理、不跑网络/通用benchmark。 |
| AGENTS.md | 追加一条有真实双连接回归支持的附属缓存 activation 发布规则，未替换既有公共规则。 |

表中路径除 benchmark/AGENTS 外均相对于 packages。TypeScript、Git 比较生产实现、desktop/UI/contracts/analyzer-core、remote/ownership 生产端口、native/loan/build/package/lock/旧设计未改。原 Python index.test.ts 未改；沿用其16项语义回归。

## 缓存资格、预算与实际发布

身份含 repo/root namespace、规范相对路径、本轮安全捕获内容 hash、configurationHash/ignoreRevision、analyzerVersion、cache format、worker digest、runtime fingerprint。mtime/长度不是命中资格。checksum 只检测普通损坏，不是签名或同用户恶意改库防御；一次探测也不锁定外部解释器环境。

每轮至少一个真实文件 worker 探测；失败则全轮禁用 hits，其他文件冷分析，partial 图提交后清除该项目成功 bank。语法/环境/协议失败不缓存。工具执行边界再次核脚本摘要；不同 miss 的 runtime 不一致时弃所有 hits、最多一次冷重跑。无 Python 不启动 Python。每个文件均重新 normalize，模块、导入、调用、置信度、证据和未知边全量重建，最后走原 finalizer/saveSnapshot；不复用 Graph IR 或旧 ID。

project 私有表每批最多2048 rows/32 MiB UTF-8 payload/1 MiB row。SQL 在返回 payload 前核行字节上限，累计读预算及查询数也有界；未知/损坏/超额材料只 miss，不截断冷分析事实。采用单最新成功 bank、稳定路径预算截取；发布在同一短事务替换 bank，属于整代淘汰，未实现历史代或 LRU。超过预算的项目不会满足 N→1 全命中计数预期。预算不代表整个 Node/Python RSS 上限。

saveSnapshot 后按其提交事务内的精确 activation receipt 发布；事务内复核 current、repo/snapshot/config、经既有 schema 校验的 ignoreRevision 及 producer source hash。第二连接同 ID 再晋升后，迟到旧 batch 仍拒绝。无 receipt/nested、已关闭、配置变更、错 producer 均不发布。缓存事务 BUSY/损坏/重复 batch 整批回滚，不改图终态。partial 清 bank 也必须符合精确当前资格。legacy/global 无表、无迁移12、无持久缓存；Git 两侧仍使用无 session 全量路径。

观察仅内部回调，不进入 IPC/Graph IR/快照身份。计数为实际 worker 请求（含 probe/失败/冷回退）、hits/misses、normalize/语义 pass、payload 字节，安全捕获/验证文件数、解码 UTF-8 字节、TS Program 入口/输入数、准备图行及 finalizer/图提交/cache提交时间。准备图行不是实际数据库写行；未插桩 TS AST 次数、raw OS 读取字节和各 SQLite 实际写行，不制造这些数据。

## 实际反馈闭环

| 原失败/观察 | 分类、诊断与修正 | 再验证 |
| --- | --- | --- |
| 协调方旧源码复现 persisting 同步 abort：抛 AbortError、resident 旧 current、重开新 current；旧 e35f98a26fca58d62a3bbfa0，重开 9fa7bf220ef7111c8c7a392e | 已确认产品取消边界缺陷。回调后/save前检查；提交后返回已提交结果并维护 resident，不做 post-commit abort 检查。 | 本轮真实 SQLite：提交前零新 current；提交后 signal 已 abort 仍成功，关闭重开一致；实际 probe 取消无图/cache写入。 |
| runtime变化测试预期冷回退，却只实际调用一次 worker | 测试缺陷：只制造一个miss且它充当probe，未产生第二个runtime观察。改成两个miss，不改产品断言。 | 一次回退、5次请求、0 hits；持续变化失败且无 staged rows。 |
| 配置冲突断言读 code 而不是 diagnosticCode | 测试缺陷，同步为真实错误字段。 | 第二连接改 ignoreRevision，旧图/cache零发布。 |
| 旧应用版本断言期待2.1.1，实际新2.2.0 | 必要测试契约一致性问题；协调方明确追加批准精确两值同步。未改范围/语义或降低身份门。 | 应用整包通过。 |
| 旧ownership项目库迁移列表精确1–11，实际增加12 | 必要测试契约一致性问题；协调方追加批准仅length同步。保持精确列表及历史/源码/外键断言。 | ownership/remote/cache 63项通过；global明确无表及migration12。 |
| 首次扩大并发回归的两个Git用例5秒超时，后续清理EBUSY | 未确认产品根因；资源并发干扰是候选原因，不写为已证实。孤立重跑4项通过；最终单worker整组通过。没有加大timeout或降低断言。 | 最终适用17文件/330项通过。 |
| 测量脚本首次根目录包别名无法解析，其次未创建数据库父目录 | 测量工具缺陷；改直接源码相对入口，在自有data目录创建父目录。不安装依赖、不改产品。 | 完整有限测量 exit0，所有实际计数与冷/热等价门通过。 |

编辑时默认 Python GBK 读取失败发生在写原文件之前，随后明确UTF-8；这是操作环境问题，不是工程经验。一次apply_patch上下文拼写不符未应用，按实际行重试；未以此生成规则。

## 实际验证命令与结果

- `pnpm exec vitest run packages/analyzer-python/src packages/application/src packages/graph/src packages/analyzer-typescript/src/index.test.ts --exclude '**/upgrade-preservation.test.ts' --exclude '**/windows-upgrade-*.test.ts' --reporter=dot --maxWorkers=1`：17文件、330项全部通过，86.76秒。排除的是本批明确冻结的升级/native/loan验收，不是失败缓存回归。
- `pnpm exec vitest run packages/application/src/incremental-index.test.ts packages/graph/src/snapshot-immutability.test.ts packages/graph/src/ignore-settings.test.ts --reporter=dot --maxWorkers=1`：3文件、19项通过。
- `pnpm exec vitest run packages/graph/src/remote-explanation-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/analysis-parse-cache.test.ts --reporter=dot --maxWorkers=1`：3文件、63项通过。
- `pnpm exec tsc --noEmit -p packages/application/tsconfig.json`、graph、analyzer-python 对应命令各 exit0。
- `git diff --check` 及本批受限文件检查无空白错误；前后 `git diff --no-index --ignore-space-at-eol` 的 exit1 表示确有本批差异，不是验证失败。
- `pnpm exec tsx benchmarks/python-parse-cache.ts`：最终冻结版本测量结果见下节。

回归包含新应用重开命中/完整冷 oracle、同内容稳定 ID/createdAt、改增删改名、未变调用方目标/装饰器变化、词法/with/推导式/别名/循环、TS全量/单Python无收益、缺解释器/失败worker/换脚本→恢复、JSON/digest/origin/超额、ignore修订与源码漂移、真实probe及提交前后取消、observer/cache异常、真实SQLite BUSY、双连接同ID晋升、并发attempt、跨项目A→B→A重启、close拒绝写、warm junction零外部字节/零分析/零发布及Git双侧各3文件/6次单文件冷分析。没有执行这些自有源码的函数、构建或依赖脚本。

## 有限测量

最终冻结版本命令exit0。Node24.17.0/Windows，每个样本独立Node进程与XRayApplication；20/80文件各三组成对冷/热，另三组TS-only，交替先后顺序。自有材料与report保留，不清理未知目录。最终report文件所属自有目录名 `xray-python-cache-measure-Eea4g0`，SHA256 `31570a18028b31a74f41d4c93ad325e1369c6e324c67ef59850a56863922e8d9`；不把前轮并发测量当作最终数字。

| 样例/模式 | worker请求 / hits | 捕获/验证文件 | wall中位数ms（范围） | Node CPU user+system中位数ms | Node采样RSS最大值范围MiB |
| --- | --- | --- | --- | --- | --- |
| 20 Python / cold | 20 / 0 | 20 / 20 | 651.267（649.119–669.894） | 47 | 168.74–207.79 |
| 20 Python / warm | 1 / 19 | 20 / 20 | 250.325（241.548–254.632） | 63 | 166.92–206.54 |
| 80 Python / cold | 80 / 0 | 80 / 80 | 2181.028（2177.448–2233.120） | 156 | 214.73–219.46 |
| 80 Python / warm | 1 / 79 | 80 / 80 | 638.148（611.546–661.785） | 140 | 217.71–229.95 |
| TS-only / cold | 0 / 0 | 1 / 1 | 312.742（312.143–341.057） | 124 | 224.97–235.18 |
| TS-only / warm | 0 / 0 | 1 / 1 | 318.455（296.688–391.581） | 171 | 237.77–259.08 |

CPU来自process.cpuUsage，仅当前Node进程，不含Python子进程/Electron，有Windows计时粒度影响；RSS是10ms间隔及前后采样的Node观测最大值，不是完整进程组真实峰值。未测Python/Electron总CPU/RSS。不据这些代理数值宣称CPU/内存改善。

cold为新独立数据库、禁用复用的同版本全量oracle；warm为预热库的无变化重索引。wall包含安全读取、完整normalize/语义、身份和数据库工作，且warm复用既有不可变图行，因此时间差不能全部归因于本批解析缓存；旧版本索引性能未测。实际Python请求下降和完整两遍安全读取是独立计数结论。TS-only不获解析收益；真实单Python回归仍一次worker、零hits。

20文件manifest摘要 `901cbc214d6168e0a418b9b19eb8d2eb68fda824751e05da90bd9da3c3973658`，最终snapshot `b8a9c35c2da49c6912354fb0`，canonical content摘要 `20aadb1b5becb6d18337f89509aea6b1c9bc8f103b5558ba5f700e3754897f9a`；80文件manifest `e7df305351f2d4c74285ad8cb76c333cbbefdeec6faedf3f03491091d7a0272a`，snapshot `6bd6b6a2d9d015c44ff10f18`，content `aa84a8ff521d2257957a4e077fc050e7364109fef1c38df560ed38029398be99`；TS manifest `335546c5069c28ba236da4250280f4358955c76cfa56ffc8793daad68b3398cc`。每组所有冷/热sample最终ID和canonical content摘要完全相等；不扩大到真实大项目或Electron。

## 冻结源码 SHA256

| 文件 | SHA256 |
| --- | --- |
| packages/analyzer-python/src/index.ts | B73CE9C697BDDD8C3D91A93318670B767180D9AF0462962E5DECC2C2D982FEAC |
| packages/analyzer-python/src/parse-cache.ts | 78F48D344CCC91268A1DB2EFBA169B9876672B277EE37293DDEC80988E2FEFC0 |
| packages/analyzer-python/src/parse-cache.test.ts | B8963721065D7C5549994C1BBC4D530B0B37F195E0B112421A4CDABC3582712C |
| packages/analyzer-python/python/analyze.py | 72E8B97D79D06D01B29D7E88CF51249F013F18EA2790AE21C520B8B554A6109E |
| packages/application/src/index.ts | 0C7A92181810ABAACA3A6CBB0E7C63D8FD28F0B334DC5DFEA48F8D305C8118C0 |
| packages/application/src/index.test.ts | 15EB2273C5B610F76CBFA4450617EB2E4D1E6C2940D3FECAED3A645053A0CD0E |
| packages/application/src/incremental-index.test.ts | 25C40AD06252D4D148172146C00FBD8BC8E6ECAF410D53735935AAB901B3719A |
| packages/graph/src/index.ts | 0786ACAB39A2028E7189692768065510442FF531378A979A445475E1E92A06AF |
| packages/graph/src/analysis-parse-cache.ts | C03A0A1177A0D5136941FF883BE9E1FFAAD5CA54A5BB9A1C7D787BA45642FD56 |
| packages/graph/src/analysis-parse-cache.test.ts | 0600DCE5B7138894D6AAD26BADE9F54926C4416CFEC66CAB8B720D7BD4974E78 |
| packages/graph/src/ownership-capsule-store.test.ts | 8617AB8E468DBDB012F60DD063DE320138F17E610C26F817A67DEA4A8A535DD9 |
| benchmarks/python-parse-cache.ts | 67AACBCA44BB200DEAB9865E41975EF009BBA70F98A7ABD8609364BF3256F903 |
| AGENTS.md | CF0A12EB9BD222651A0B83C40168CF6F1412AA42AC92CA60293F1259B22436E7 |

本批前 application/index 为855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18；Python/index为E1D7F315D022C4AFB68737AAEC9BB60D6F97AE3B0C9A5B503E78CC11A6689E6B。analyzer-core/index 96FF1BBAECD7447C821765E55FCDEB036D8D0029AA526CF3DFB0E1445D152AD7、secure-read 85606DD9EEF1D93ABFF543C5779A835A44AD4D543476CDB218D190218F97398D、TS/index AE99B6100E77E7E0158E9877791A95FCDCE90B2FB782FD48E2C67EDEEE450FD5 保持不变。旧增量设计两文档及writer设计、loan/native/files/source-loan的已冻结hash重新核对一致；未将旧工作区总diff纳入本批。

## 规则判断与未验边界

新增一条“图提交后附属缓存发布核精确activation”经验。依据是实际实现、同ID再晋升双连接拒绝回归和缓存BUSY不逆转图终态回归；区别于已有配置修订及历史snapshot规则，去重后只追加本条。没有改变授权、证据/安全/V1范围或测试阈值。

未运行重型build/native重编译/dist/Electron/GUI、真实项目、API或远程发送；普通测试使用已有可用安全读取addon。未执行旧loan/native测试及Git收尾。真实Electron连续索引/取消/导航、安装资源中的worker指纹、集成后的实际待提交diff和跨worktree公共规则合并仍由协调方独立验收；开发自测不能替代。TypeScript没有增量语义重用，Git双侧没有缓存；没有旧版本全项目性能基线、完整Python/Electron CPU/RSS或任意环境不可变证明。

本批冻结待独立复审；原四批结束后暂停讨论规划，不启动第五批。
