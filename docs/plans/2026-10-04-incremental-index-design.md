# 3G-S：普通索引的最小增量实施设计

2026-10-04。状态：设计待独立审查，未实施、未实测。范围来自 `2026-10-04-incremental-index-implementation-design.md`；仍属原四批第三批，不授权第五批。

## 建议与真实产品入口

建议第一切片仅复用 Python 单文件的无快照 worker 解析结果。每轮仍完整安全发现、读取、计算内容 hash、重建全部 Python 文件事实与跨文件关系，再验证源码并发布。TypeScript 每轮完整创建 Program/checker。Git 比较双侧不启用此缓存。

本 checkout 的 `apps/desktop/src/main.ts:65` 起为每个索引任务创建 worker，终态后终止；`analysis-worker.ts:15` 创建应用实例。因此只有实例内缓存不能改善用户连续索引。最小产品实现需要在已有项目 SQLite 内增加一个私有、可丢弃、版本化解析缓存表；不新增数据库框架或数据库文件，不改桌面 worker 生命周期。协调方实施前须核对集成后的桌面生命周期；本轮 main/Sol 一致性核对只涵盖计划指定的五份分析源码，不包含 desktop。

若不批准这一个持久缓存表，本切片应退回计数与等价验证准备，明确没有连续产品索引收益；不能把同实例 benchmark 命中作为产品交付。第一版不尝试 TS 局部语义闭包，也不复用已有 Graph IR。

## 当前源码支持的边界

| 位置 | 当前行为与实施约束 |
| --- | --- |
| `packages/application/src/index.ts:420–452` | 普通 indexProject 捕获安全 scope、排除配置、完整源码 hash 与分析身份；全部保留。 |
| 同文件 `474–479` | TS/Python 项目分析入口；仅普通 Python 入口传入私有缓存会话。比较侧 `743–744` 保持冷分析。 |
| 同文件 `500–511` | 同安全 scope 再发现/读取、拒绝源码漂移，saveSnapshot 核配置修订；缓存不替代这些门禁。 |
| `packages/analyzer-core/src/secure-read.ts:37–113` | scope 绑定原生根目录及文件检查；没有公开完整根句柄身份。缓存 namespace 不能冒充句柄授权。 |
| `packages/analyzer-typescript/src/index.ts:140–180` | 当前完整 Program/checker；项目源码取自本轮内存，配置与安装的 TS lib 参与分析。SourceFile/checker 对象不跨包、不持久化。 |
| `packages/analyzer-python/src/index.ts:15,47,100` | JSON schema、每文件 Python 子进程、最多四路分析后完整模块/符号解析。当前 PythonResult 不含仓库、图节点、证据或快照 ID，可作为复用边界。 |
| `packages/analyzer-python/python/analyze.py:198` | ast.parse 处理捕获源码；不执行导入项目代码。 |
| `packages/analyzer-core/src/snapshot-identity.ts:4` | 根据规范化分析结果最终确定快照并重绑定证据/边；继续走原路径。 |
| `packages/graph/src/index.ts:273` | 事务核 ignoreRevision、同 ID 不同事实/源码拒绝覆盖、current 晋升独立于历史 createdAt；不放宽。 |

以上为本轮静态源码观察，不是运行验收。当前真实小样例是 `test-fixtures/e2e-project/src/auth.ts`、`src/validation.ts` 与 `worker.py`。历史资料中的 semantic-reliability 目录在本 checkout 不存在，不据此派发不存在的文件。

## 可直接派发的文件与接口

下列均为未来实施清单，本轮没有修改。实现前只允许协调方批准的这组文件及对应新测试/有限测量文件；不得整体带入旧 worktree 差异。

| 文件 | 最小变化 |
| --- | --- |
| `packages/analyzer-python/src/index.ts` | 分离 run/validate、无快照结果、normalize；保留 analyze 单文件冷路径。analyzeProject 增加可选末尾 PythonParseReuseSession 参数，缺省全量。缓存 DTO 类型与 schema 留在本包；提供 session 工厂接收有界 opaque record，向 application 返回有界 staged records/统计。 |
| `packages/analyzer-python/python/analyze.py` | 成功响应增加受校验的 Python/runtime 与 worker 协议身份。保留 `python -I`、ast.parse 和不执行目标代码。更新 worker 协议及分析器版本，缓存格式另行版本化。 |
| `packages/graph/src/index.ts`；可拆 `src/analysis-parse-cache.ts` | 新增项目角色缓存表迁移、有限读/写/淘汰 API；graph 只存格式/身份/JSON，不导入 PythonResult 或 Python 分析器。 |
| `packages/application/src/index.ts` | 普通索引加载 session、把安全捕获 hash/配置传入、发布后提交 staged cache；close 清 resident 状态。收紧下面列出的普通索引取消边界。 |
| `packages/analyzer-python/src/index.test.ts` | raw DTO 冷/热归一化、工具变化、词法/跨文件语义等价。 |
| 新 `packages/application/src/incremental-index.test.ts` | 真实 indexProject、新应用/新 worker 等效重开、配置/源码漂移/取消/历史证据回归。 |
| 新 `packages/graph/src/analysis-parse-cache.test.ts` | 真实 SQLite 迁移、损坏/限额/并发发布/失败后的私有缓存行为。 |
| 新有限测量脚本，路径由实施批次固定 | 仅自有生成样例，区分新应用与同实例，不调用现有通用 benchmark 的网络或共享清理流程。 |

建议内部签名：

```ts
PythonAnalyzer.analyzeProject(sources, context, reuse?: PythonParseReuseSession)
GraphStore.loadAnalysisParseCache(query): AnalysisParseCacheRecord[]
GraphStore.publishAnalysisParseCache(batch, producerSnapshotId, expectedIgnoreRevision): boolean
```

会话由 Python 包创建；application 仅编排，graph record 为受预算限制的 JSON 字符串与标量元数据。source 内容/hash 只来自已有捕获流程。该接口不进入 shared/IPC，不增加用户设置、public Graph IR 字段或导航缓存。没有新增依赖；现有 Zod、hash 与 SQLite 足够。以上名字是设计提案，实施时签名须与既有类型核对。

## 命中身份与重建证明

持久 row 的唯一定位为项目 repositoryId + 规范相对路径；资格包含：项目角色/根 namespace、当前安全读取的 contentHash、完整 configurationHash 与 ignoreRevision、Python analyzer/version、worker protocol/cache format、选中的 worker 脚本内容 digest、运行时 fingerprint。payload digest 仅检验普通损坏，不是生产者认证。rootPath/mtime/长度不能授权命中；搬迁或配置变化保守 miss。不得缓存绝对私人路径到日志。

Python runtime fingerprint 必须由实际 worker 返回，包含解释器版本、实现/cache tag 与当前可校验工具身份；Node 对选中 worker 脚本实际内容 hash。指纹不能仅使用 `python` 命令名或文件存在。解释器可被外部替换的风险仍存在，不能声称单次观察证明整个进程环境永远不变。

每轮至少分析一个当前 Python 文件作为工具探测：优先取身份/内容候选 miss，否则按稳定路径顺序取第一文件。探测也是本轮真实文件解析结果，不启动虚构文件或复制图。成功且指纹吻合才允许其余命中。无 Python 文件不探测。

探测失败时本轮不使用任何缓存，其余文件走现有冷路径，保持安全诊断/partial；成功 bank 清除只涉及该项目私有表。后续缺工具→恢复必须重新探测，不用历史成功掩盖失败。语法失败不缓存。探测成功后其他 miss 的 worker 指纹若不一致，弃用命中并最多重跑一次全 Python 冷分析；持续环境变化明确失败关闭，不无限重试。冷 oracle 与热路径使用相同新协议/版本及环境一致性规则。

命中结果不含 FileAnalysis、节点/边/证据/snapshotId；校验后为本轮单独持有不可变 DTO。每文件 normalize 重新生成当前 repository/context 的事实；随后重新建立完整 moduleFiles、symbolsByModule、导入/调用解析、confidence/reason、未知目标和去重。新增/删除/改名、包结构、目标文件绑定变化均在这一步生效，不需要证明局部语义闭包。行列范围只能来自与当前 hash 对应的 DTO。最后仍执行 finalizeAnalysisSnapshot 与 saveSnapshot，不复用历史最终 ID 或历史事实对象。

完整冷/热结果相等的证明义务包括 sourceFiles、nodes、edges、evidence、health、analysisIdentity，canonicalSnapshotResult 与 canonicalSnapshotContent 相等；同根/配置/源码/版本最终 snapshotId 必须一致。createdAt 只按既有 canonical 规则排除，不新增忽略字段。旧快照源码、事实、题目和创建时间不得变化。

## 私有表、限额与发布

仅 project 角色启用；legacy/global 单库路径第一版冷回退，不让项目解析材料进入全局策略库。使用既有项目 DB，表如 analysis_parse_cache，含 repo/path、上述身份、producer_snapshot_id、payload_json/digest/byte_count、last_used_at。迁移在事务注册；当前 GraphStore 主迁移有 1–9，实施前检查 remote/ownership 所有迁移命名空间再确定下一版本，不能直接假定 10 空闲。升级失败维持原失败关闭，不修改既有数据；回退版本忽略未知私有表。

只接受来源于已提交 ready 快照的成功结果；origin/source/hash 缺失、origin 不匹配、损坏 JSON/schema、未知版本、超预算一律 miss。首次冷 partial 不安装任何新 bank；新一轮工具失败清除旧 bank。ready 来源的单文件解析材料可以在之后源集合变化时候选复用，但必须经过本轮工具探测、内容/config 身份核对和全量语义重建，不能把来源快照的 ready 当作当前 ready。

上限提案：每项目 2048 rows、32 MiB payload，总行上限与字节上限均强制；单 row 1 MiB，超出仅不缓存，仍正常冷分析，不截断图事实。按有限 manifest/元数据查询再读候选 payload，不能先无界 SELECT 全表再 JS 截断；读坏库也遵守扫描/返回限额。schema 校验有界数组/字符串，达到缓存预算就停止填充。命中只读，last_used 更新随批次事务；淘汰按 last_used/稳定路径次序。当前源码及既有冷 worker 内存不因缓存预算自动变成有界，不能宣称限制了全索引 RSS。

indexProject 每次有独立 session 与 staged batch，不共享可变 DTO；同实例重叠任务不得共享 bank 状态。cache batch 在 saveSnapshot 成功且 ready 后单独短事务提交：事务核 producer 精确身份仍为 current、ignoreRevision 未变化、每行 source/hash 属于该 producer，再整批写入/淘汰。较迟旧尝试不能覆盖更新 producer；内容 hash 本身仍是未来命中最终门禁。异常/取消/源码漂移/配置变化无 staged 写入；缓存损坏或写 BUSY 仅放弃优化，不把已经提交的有效 snapshot 改报 failed。不得假装两个事务原子。缓存事务可能改变 SQLite data_version，从而保守失效现有导航缓存，不能绕过导航正确性检查。

当前索引存在静态可达的取消边界缺口：persisting 回调之后直接 saveSnapshot，提交后再 throwIfAborted（application:504–508）。建议本切片只修普通索引：在 persisting 回调后、同步 saveSnapshot 前检查 signal；成功提交后以已提交结果返回，不因迟到 signal 将完成改报取消。配置修订事务核验不变。此缺口本轮没有运行复现，不能标为已确认产品失败；须定向回归和独立桌面终态验收，不自动扩展到比较/桌面 broker 重构。

应用关闭清 resident session；项目私有表随新 worker/应用重开保留。A→B→A 重启须核库隔离、current 晋升及历史源码；单最新 row 允许回到 A 时 miss，不要求跨源码历史缓存。表的丢弃或淘汰不能影响 Graph IR、mastery、历史快照或解释可读性。

## 必须通过的等价与安全回归

每种状态以同绝对根、同配置、新版本冷 oracle 对照缓存路径；两边数据库独立，实际 indexProject 使用真实安全读取和 SQLite。不运行样例代码/安装/测试脚本。测试先关闭重用得到 oracle，再预热并重开应用索引，避免把同实例结果当作跨 worker 证据。

| 场景 | 最低断言 |
| --- | --- |
| 冷、无变化、单文件修改、新增、删除、改名 | 全事实与最终 ID 等价；命中/miss 与实际 Python 子进程次数一致；不存在已删除事实。 |
| Python import 别名、相对包、循环、同名嵌套、循环/异常/with/推导式/装饰器绑定 | 重用未变调用方时改变目标/绑定，仍得到冷 oracle 的路径、范围、unknown/verified；不拼接旧解析后的关系。复用现有 analyzer 测试中的自有语义模式。 |
| TS config、路径别名、循环及依赖目标变化；混合语言 | TS 全量入口每轮执行，Python 配置身份保守 miss；未解析边、诊断与冷 oracle 等价。 |
| Python 缺工具/脚本、损坏响应、语法失败→修复 | 首探测失败无命中、partial 不发布 bank；恢复再探测，analysisIdentity/最终 ID 与冷结果一致；不同事实不借用旧成功。 |
| ignore 修改/损坏；捕获与发布之间第二连接改修订 | 当前证据失效；saveSnapshot 拒绝旧配置且无图写入，私有 batch 也不得发布。 |
| 根/路径变化，发现与读取间符号链接或 junction 替换，验证阶段源码变化 | 仍走已有 scope 与前后读取门禁，外部源码不进入 analyzer/cache/图；mtime/长度相同而内容不同必须 miss。 |
| 取消：探测、并行 miss、verify、persisting 回调；提交后迟到 signal | 不安装未提交 bank；提交前取消保持旧 current；成功提交不被迟到信号改报取消；关闭/重试无挂起 child。 |
| 两实例/连接并发，A→B→A 后重启 | 旧 batch 不覆盖更新 current/config；跨项目无命中，旧源码/证据和 createdAt 不变。 |
| cache 损坏、伪造 origin、超预算、版本变化、淘汰、cache 写失败 | 全部保守 miss 或放弃缓存；snapshot 结果不受缓存故障改变。普通 checksum 不证明抵抗同用户恶意篡改数据库。 |

先由开发做以上定向测试与适用回归，再由协调方核实际 diff、回归并操作真实 Electron 的连续索引/取消/源码导航。设计文档和开发自测均不能替代独立 GUI 验收。

## 工作量与有限收益门槛

内部可选 observation callback 收集计数，关闭时无行为差异；不加入 canonical snapshot、IPC 或产品遥测。记录：捕获/验证安全读取尝试及成功数、解码内容 UTF-8 字节（不能叫实际 OS 读取字节）；Python 实际 worker 请求/成功/失败、命中/miss/探测原因、payload 读写字节；全文件 normalize 数、全语言解析次数；TS Program 入口次数及输入文件数（未插桩 AST 时 AST 次数为未知）；图行写入、cache row 读写、hash/finalize/持久化耗时、wall 与实际测得 RSS。

有限自有样例采用多文件 Python 导入/绑定结构，至少 20 与 80 文件两个级别；另有当前固定 2TS+1Python 样例用于正确性，以及 TS-only 对照。不得跑真实项目、网络或旧通用 benchmark 清理。比较旧冷基线、新冷、新热重开应用；同实例热另列。固定根/内容/环境，记录样例 hash、版本、次数与中位数/分布，预热和测量分离，数据库隔离且不删除未知目录。

工具稳定且所有结果成功时，无变化 N>0 个 Python 文件应为一次实际解析、N-1 命中；一次变更优先用变更文件探测，worker 次数为 max(1, 本轮 miss 数)。工具/缓存失败的额外冷回退单独计数。N=1 不减少 worker/AST 数；当前固定小样例不能证明解析量收益。TS-only 预期无增量收益。安全读取、完整 Python 语义重建和图发布工作量都不减少。

第一验收门槛是新应用/新 worker 仍命中、上述计数下降、全部等价与安全回归通过；性能结论另需成对重复 wall/CPU/RSS 数据。若少进程收益被 cache I/O/探测/规范化抵消，报告具体成本，不宣称全项目加速。没有本轮性能数据，TS 大项目收益仍缺安全语义失效方案，属于未解决限制。

## 审查决策与冻结

请求协调方审查的具体提案是：允许上述单项目私有表、Python 无快照 DTO/运行时探测、普通入口编排及窄取消边界修正；TS、Git 双侧、desktop/UI/native/loan/contracts/package/lock 冻结。审查后才能形成实施批次。本轮只新增本设计和配套过程记录，无新增 AGENTS 规则：方案尚未代码/实验验证，现有证据与发布规则已经覆盖应遵守的原则。
