# 3D-L 导航耗时分解诊断设计

日期：2026-10-02
状态：2026-10-02 14:53 协调方源码复审接受设计；未实施、未测量，性能结论仍开放

## 目标与边界

在固定的 medium128 自建样例上，设计一次有界冷/暖配对诊断，分别观察索引阶段、完整证据导航、应用 API、GraphStore 操作和独立安全源码读取。当前证据只足以指出候选测量点，不足以判断哪个操作主导耗时；诊断先建立可归属数据，再决定是否需要实现优化。

本提案只涉及未来 benchmarks 专用工具。不得改应用或 GraphStore、缓存、契约、依赖、AGENTS.md、既有冻结基准文件或协调记录；不得换用用户项目、执行导入项目代码或输出源码、凭据、证据 ID、私人路径。未来实现和采样均不属于本设计交付。

## 已有证据与解释边界

3C-L 接受的样例为固定 medium128，Node 24.17.0 / win32；包含 128 个文件（96 TypeScript、32 Python）、13,518 字节、387 个节点、1,275 条边及 1,177 条证据。既有报告中，small 默认样例有一次成功记录；medium 有一个单对报告和一个双对报告。三对均通过全部 11 个既有门禁，并在每个完整导航阶段读取 1,177 条证据。

| 已接受的 medium 对 | Child 总时长 | 冷索引 | 暖无变化重索引 |
| --- | ---: | ---: | ---: |
| 单对报告 | 48.870 秒 | 2.618 秒 | 2.530 秒 |
| 双对第 1 轮 | 42.259 秒 | 2.004 秒 | 2.143 秒 |
| 双对第 2 轮 | 47.585 秒 | 2.457 秒 | 2.324 秒 |

总时长减去两个已计时的索引区间后，算术余量约为 43.722、38.113、42.804 秒。它只表示尚未分别计时的 child 区间，其中还包括启动、样例/数据库准备、两次完整导航、报告和关闭；不能称作导航耗时，也不应用来推断任何单一阶段。暖索引在一对中反而更慢，这些数据不支持“暖缓存已经提速”或缓存优化结论。

代码给出一个值得测量的候选：application 的 getEvidence 与 readSource 都进入 requireSnapshot，而后者调用 GraphStore.loadSnapshot；loadSnapshot 查询完整 payload 并调用 parseStoredSnapshot（JSON 解析及 schema 校验）。基准 child 对每条证据先调用 getEvidence，再调用 readSource；因此当前样例每个导航阶段预期各 1,177 次 API 调用及约 2,354 次快照加载。这是按调用路径推导的预期数，尚非运行时计数，必须由诊断计数器确认。

readSource 还会读取保存的源码行、查找证据及校验范围、读取忽略配置、分类路径，并对允许读取的文件调用安全 readProjectFile 和内容指纹计算。它们都可能贡献成本；不得预先指定主因。现有 3C 报告提供总体时长、索引测量、导航计数/哈希、门禁、样例和运行环境等字段，但没有导航分阶段耗时或每种 GraphStore 操作计时。

## 源码边界

- packages/application/src/index.ts：requireSnapshot（约第 218 行）选择快照 store 并调用 loadSnapshot；getEvidence（约第 260 行）在其后读取单条证据；readSource（约第 347 行）先恢复快照，再读存档源码、查找证据和范围、加载忽略配置，并在路径允许时安全读取当前工作区文件、计算指纹。
- packages/graph/src/index.ts：parseStoredSnapshot（约第 22 行）是私有函数；GraphStore.loadSnapshot（约第 320 行）的计时只能覆盖 SQL 查询加完整 JSON/schema 解析，不能分成 SQL 专属耗时与 parse 专属耗时。getEvidence（约第 419 行）含 SQL 与 payload JSON 解析；readSnapshotSource（约第 527 行）读取存档源码行；loadIgnoreSettings（约第 212 行）含 SQL、JSON 解析和 schema 校验。
- packages/analyzer-core/src/index.ts：readProjectFile（约第 135 行）为一次读取建立安全 scope、检查根目录约束、调用安全读取器，并在 finally 中关闭 scope。readSource 当前没有向该调用传 AbortSignal，也没有给基准提供内部计时 hook。
- benchmarks/local-index-baseline-child.ts：resolveNavigation（约第 154 行）先检查节点证据引用，再逐条证据顺序调用两个应用 API，最后排序并计算摘要；cold 与 warm 导航分别发生在冷、暖索引之后。

因此，未来只对公开 GraphStore 方法做基准进程内计时包装：loadSnapshot 的数值标为“SQL + 快照解析 inclusive”；不导出或改写私有 parseStoredSnapshot。readSource 内部的安全读不能从应用 API 总时间中准确单独计出。诊断可另外回放完全相同的 1,177 条证据文件路径序列，通过 readProjectFile 做一次独立安全读取阶段，记录每次调用分布和读取字节数。该阶段在导航后单独运行；缓存是否命中未知，必须按实际回放环境说明。它不是 readSource 内部安全读时间，不能从导航总时间中扣除，也不能冒充冷盘测量。

## 未来报告及计时口径

全部单调时间使用 performance.now，聚合器只保留 count、total、min、max 和固定桶计数；桶边界为小于 1、1–2、2–5、5–10、10–25、25–50、50–100、100–250、250–500、500–1,000、至少 1,000 毫秒。禁止保留逐证据耗时数组或路径、证据 ID、源码文本/哈希。记录 child RSS 时标注为 Node child RSS，不解释为整机或 Electron 内存。

建议报告以下完整阶段和嵌套操作：

| 指标 | 范围 | 解释 |
| --- | --- | --- |
| Child wall | 父进程启动 child 到收到 child close | 包括进程启动、测量及关闭；与 child 内部阶段不完全同界，不用差值分摊各项 |
| Setup | child 启动后至冷索引开始 | 固定样例复制、临时数据库和应用初始化等；阶段边界须在 child 中明确 |
| 冷索引、暖索引 | 沿用现有 indexProject 计时与 IndexProgress 阶段 | 两个完整索引操作；独立报告数量和时长 |
| 冷/暖导航 wall | 每次完整 resolveNavigation | 分成不重叠的节点引用检查、证据循环和规范化/哈希阶段 |
| API inclusive | 每次 getEvidence / readSource 调用的入口至返回 | 含其内部全部同步/异步工作；分冷暖阶段计数和聚合 |
| GraphStore inclusive | loadSnapshot、getEvidence、readSnapshotSource、loadIgnoreSettings 各自调用入口至返回 | 按当前 API 调用来源及阶段归组；嵌套于应用 API，不与 API 总时间相加 |
| 安全读取回放 | 独立的 1,177 次 readProjectFile 序列 | 回放每次调用耗时及字节数；不进入导航门禁，也不声称是应用内部读文件的直接分项 |
| Report/write/close | child 报告序列化写入；父进程另记最终 close | 单独显示。报告和关闭未形成完整互斥阶段时保留为未分配区间 |

嵌套关系如下；API 与其内部 GraphStore 时间均为 inclusive：

    冷/暖导航 wall
      ├─ 节点证据引用检查
      ├─ 逐条证据循环（含匹配、API 调用、结果校验）
      │    ├─ getEvidence inclusive
      │    │    ├─ loadSnapshot inclusive（SQL + parseStoredSnapshot）
      │    │    └─ GraphStore.getEvidence inclusive
      │    └─ readSource inclusive
      │         ├─ loadSnapshot inclusive（SQL + parseStoredSnapshot）
      │         ├─ readSnapshotSource inclusive
      │         ├─ loadIgnoreSettings inclusive
      │         └─ 应用逻辑、安全文件读取与指纹
      └─ 结果排序与规范化摘要
    独立安全读取回放（导航完成后的单独阶段）

只有导航内部明确首尾相接且互斥的三个 child 子阶段才可相加解释导航 wall。API 与 GraphStore 计时是嵌套诊断，不得加到 wall 上。可以用 API inclusive 减去其内可确认互斥的直接存储调用，报出“应用层未归属余量”；余量仍包含证据线性查找、范围和路径校验、策略、指纹以及调度开销，不能标成 secure-read-only。独立安全读取回放也不能作为该余量的精确替代或扣减项。所有分项说明计时包装本身的开销未被扣除；不要将诊断 wall 与 3C 无包装报告直接作性能回归判断。

每种包装在 finally 中恢复原方法 descriptor，即使运行、取消或报告写入失败也必须恢复。调用保持串行并以 phase 和当前 API 标签归因，不采样或省略任何证据；所有固定聚合器与输出字段设硬上限。

## 采样、安全与有效性门

- 只选注册的 medium128 样例 ID、固定生成器版本及固定清单。禁止任意路径、用户仓库、网络或项目代码执行；临时运行目录须在既有工具拥有的根目录内、每轮唯一且独占创建，不覆盖历史报告或做递归清理。
- 每个诊断仅运行一个冷/暖配对，每个快照逐一导航完整 evidence 列表。要求样例清单严格匹配、快照健康、冷暖身份与内容一致、节点证据引用正确、每条证据都由 getEvidence 和 readSource 成功读取且 workspaceStatus/current、导航摘要一致，并复用当前 11 个既有门禁的精确语义与键；不得放宽或以抽样替代。medium 仍须精确读取 1,177 条证据。
- 运行硬边界：最多 2,000 条证据、1 个配对、1 个样例；固定总时限 180 秒；报告/child 单行协议最多 256 KiB。任一上限超出均失败关闭并给出有限的安全错误码，不截断后报成功。门禁失败、协议异常、取消、child 失败或超时均记为无效诊断，不进入有效配对统计。
- 取消在样例复制、索引及逐证据导航间检查；每个异步 API 完成后再检查一次。当前 readSource 的单次安全文件读取不接受本诊断的 AbortSignal，所以取消不能保证中断正在执行的这一次读取；父进程保留既有关闭宽限、必要时终止整个 child 进程树并等待 close。报告记录 childClosed、forcedTermination、exitCode/signal 及固定取消码。有效结果要求无取消、成功 close、协议无误、全部 11 门通过。3C-L 已接受的一次协作取消（冷索引读到 16/128 后关闭，未强杀）只作为旧门禁证据，不替代未来导航取消测试。
- 报告限于固定 envelope、环境版本、注册样例 ID/生成器版本、阶段聚合、调用计数、11 个门禁和失败码。门禁比较所需的哈希仅在 child 内存中使用，不写进报告。不得包含源码、源哈希、证据/导航哈希、文件路径、证据 ID、用户项目路径、任意异常文本或凭据。运行时公开的 reportFile 只能是拥有目录内相对位置。

## 未来最小实现边界与验证

设计接受后的最小新增文件候选，仅限 benchmarks：

1. benchmarks/local-index-navigation-diagnostic.ts：CLI/父进程、固定配置、唯一运行目录、单行大小和总时限、取消/child close、严格报告协议。
2. benchmarks/local-index-navigation-diagnostic-child.ts：固定样例、冷暖 index 与全证据导航、局部计时包装/计数、独立安全读取回放、门禁和有限报告。
3. benchmarks/local-index-navigation-diagnostic.test.ts：仅纯协议与聚合器测试，不启动 medium 全量测量。

不得改现有 3C 基准工具或六个冻结基准文件；复用时只导入现有可见且稳定的样例定义和协议，不依赖其未导出的局部 helper。若无法在这三个新增文件内满足边界，先回到设计评审，不扩展通用协调/交接工具。

未来实现的最小测试门应覆盖：计时桶边界与固定空间上限；包含关系不被错误相加；冷暖/API来源分组和精确计数；所有 method wrapper 在正常、异常、取消及协议失败路径恢复；中途取消后等待 close 并正确记录强制终止状态；超上限、超时、错误单行和 malformed 报告失败关闭；全部 11 门和所有证据在冷/暖两轮通过；报告无源码、路径、ID 或任意错误文本。实现代码及这些单元测试通过后，才运行一次 medium128 配对诊断并审阅实际报告。其数值仅是单次诊断，不自动构成普遍性能结论；复杂性能优化须待证据审查后由 Sol 负责。

## 暂不推断

当前没有单独计得快照解析、每个 API、保存源码查找、安全文件读取或数据库各自的真实耗时；没有跨机器、重复诊断或真实项目数据。诊断结果到手前，不引入缓存或算法重构，也不把现有 38–44 秒算术余量归因于导航或任何函数。

协调接受边界：复审实际 requireSnapshot、readSource、loadSnapshot 与 canonicalSnapshotResult；接受公开方法 inclusive 分组及独立安全读回放口径。后续新增三份 benchmark 源码/测试和一份本批开发记录，报告只含固定样例清单身份、聚合计数/时长和门禁，不含逐文件/证据/源码内容。只运行纯测试/类型，实际索引与取消采样由协调窗口执行。接受设计不代表已找到瓶颈。
