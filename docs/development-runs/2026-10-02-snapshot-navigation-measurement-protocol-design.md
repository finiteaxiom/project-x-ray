# 快照导航优化测量协议设计记录

日期：2026-10-02（2026-10-03 复审修订）
任务：3F-T，只读审阅冻结的 3E 测量合约，并设计独立 post-change v2 协议。
状态：2026-10-03 17:20 协调方独立接受 O/T 四文档同步修订。未派发协议工具实现，等待 C2 应用端口稳定；设计/计量门接受不是性能通过。

## 目标与授权边界

最初 3F-T 任务限于以下两份文档（2026-10-02 创建，本次复审曾修订这两份原文件）：

- `docs/plans/2026-10-02-snapshot-navigation-measurement-protocol.md`
- `docs/development-runs/2026-10-02-snapshot-navigation-measurement-protocol-design.md`

之后协调方明确批准 O/T 两份计划和各自 development-run 共四份文档的最小同步修订。新增范围及最终状态记录见文末“第二次协调方批准的 O/T 同步复核”。

没有改动 application、GraphStore、SQLite、3E parent/child/test、fixture、依赖、AGENTS 或其他文件；没有运行测量、测试、索引、构建、native、dist、Electron 或 GUI。2026-10-02 起草时没有运行 Git；2026-10-03 恢复时按 root 要求只读核对 Git 状态，未做 Git 写操作或收尾。冻结的 v1 工具和原 medium128 报告继续作为原始基线。

## 只读合约核对

审阅了：

- `benchmarks/local-index-navigation-diagnostic.ts` 的导入、类型、gate 列表、summary validator、child protocol parser、总时限/取消/关闭控制、report validator/writer。
- `benchmarks/local-index-navigation-diagnostic-child.ts` 的 phase/source/store-method 维度、GraphStore 与 application API 计时 wrapper、冷/热导航、回放和 11 项门的计算顺序。
- `benchmarks/local-index-navigation-diagnostic.test.ts` 的 `validSummary()`、1,177 计数 fixture、exact-key/report-size 和 cooperative/forced cancellation 断言。
- `benchmarks/local-index-baseline.ts` 的 `compareSnapshotPair` 与工具拥有的运行目录/独占写入帮助函数。
- 已接受的 `docs/plans/2026-10-02-snapshot-navigation-performance.md` 和对应设计记录中的 3F 版本、容量和 token 约束。

冻结的 v1 协议前缀是 `XRAY_NAVIGATION_DIAGNOSTIC:`，child frame 严格区分 `progress`/`terminal` 并拒绝未知字段。summary 与 root report 都是 `schemaVersion: 1`。metric 精确字段是 `count,totalMs,minMs,maxMs,buckets`，bucket 上限为 `[1,2,5,10,25,50,100,250,500,1000]` ms；进度为六个固定阶段。父 runner 保持 1–3 对、全程 5,000–180,000ms、受限协议行/总量与报告、cooperative stop、必要时强制终止并等待 close、后续 pair 记录为 not-started。

原 11 项门按 v1 顺序为：`sourceFilesEqual`、`canonicalFactsEqual`、`persistedPayloadEqual`、`sameSnapshotIdentity`、`originalCreatedAtPreserved`、`stableNodeNavigation`、`stableEvidenceNavigation`、`stableResolvedSourceNavigation`、`expectedSourceFilesEqual`、`bothSnapshotsHealthy`、`navigationResolved`。每个 cold/warm 导航阶段必须遍历 1,177 条 evidence，分别得到 1,177 个 `getEvidence` 与 1,177 个 `readSource` 响应。原 validator 还要求各阶段 `getEvidence` 与 `readSource` 下的 `loadSnapshot`、evidence/source 行读取及 ignore-settings 读取都达到 1,177；该加载断言属于 v1 旧契约，不能沿用为 v2 的优化门。

## 设计决策及证据边界

1. **新版本，不改旧工具**：提出三个全新 `local-index-navigation-optimized*` 文件和独立 v2 prefix/schema，但只有 future Sol 缓存任务经协调方另行批准并稳定只读 observer 后才可派发协议工具。只读复用 baseline helper，未来实现者仍须复核导出行为。未来若触碰 3E 三个诊断源码文件或 fixture，需要另行明确授权。本轮未改 helper。
2. **精确定义加载分子/分母**：每 pair 两个 navigation phase、每 phase 两类 API、每类 1,177 次，故完整加载机会总数为 `2 × 2 × 1,177 = 4,708`。只计真正进入持久化完整 snapshot 读取/校验路径的次数；cache hits 不计。分开报告 cold/warm、`getEvidence`/`readSource`，并同现有 storage metrics 互相校验。索引、current/state、gate evaluation 与 secure-read replay 排除在优化分母外。
3. **完整语义先于性能**：新 summary 保留全部 11 项原 gate 和每轮 1,177 条 evidence 响应。`≤2` 是 observer coverage 完整且观测窗内没有 external/both change 的配对附加优化门，基于 cold/warm index 各使 local generation 变化、因此至多两次导航构建的已接受设计；这是有界观测结论，不声明绝对无外部提交，也不是折算后的平均数。
4. **observer 证实决定，不反推决定**：cache hit、实际准入 estimator bytes、build race 原因和 token change 分类只读自单独批准的产品 observer。每 API lookup 只记一个互斥最终决定；build race reason 和实际完整加载、admission 结果独立计数，并以明确等式核对。full-load 计数不得推导 hit；benchmark 不读私有 cache 状态/raw token。接受设计要求 token 类型/可比性严格有效，不能以 `undefined`/NaN 的相等性推断命中。
5. **外部 commit 覆盖完整且性能门失败关闭**：有界观察覆盖首建/重建 before/after、每次 lookup validity、phase start 和最后请求后的 checkpoint。build race 原因保留 external/local/both/unclassified；没有 external-miss 决定不代表无 external change。任一 coverage 不完整、observer 缺失或 race 未分类时不计入性能可比较数。受控第二连接 commit 仍要求安全 reload 且原 11 门通过，不把挑战加载混进正常性能分母。
6. **内存和 wall 限定**：报告每导航阶段前后整个 child 的 `heapUsed` 和同一 cache admission estimator 产生的累计字节/准入上限。准入估算不是 heap 限制，进程 heap 也不是缓存净内存。沿用嵌套 inclusive 计时，不把 API/store 子计时相加成导航 wall；secure-read replay 单列。
7. **结论须有多对同环境证据**：单次样例不能支持性能验收或一般化结论；要求一次 `--pairs 3` 中有 3 对同一 Windows/Node/依赖环境的 medium fixture，逐对展示和汇总 median/min/max。外部变化、observer coverage 不足、timeout、cancel、协议错误及门失败均不计为有效性能对，不得放宽 11 门或响应数。
8. **保留资源和安全边界**：沿用 v1 child 终止与 close 语义、协议限额和独占临时报告；三对 v2 summary 必须仍通过 256 KiB 总报告门。投影 4 MiB 是另一准入限制。敏感 token 及源码相关值不落报告。

工具时长上限、marker 的官方语义、三对 summary 的实际序列化尺寸及后续 callback 可观测形状尚未在本轮实施/测量；协议设计以已接受的 v1 上限和 3F 候选边界为依据，不将其描述为已验证实现。协调方先前提供的双 SQLite 连接机制实验仅是 3F 设计输入，不是本轮重跑的证据，更不是 GraphStore cache 验收。

## 2026-10-03 root 复审修订

复审确认两项**协议设计缺口**，不是已经复现的产品 bug：

1. 当前缓存产品没有诊断 observer；v2 三个 benchmark 文件无法证明实际 cache hit、产品准入估算 bytes 或外部变化覆盖。修订为显式依赖 future Sol 缓存产品任务经协调方单独批准、实现且稳定的只读可选 observer；协议工具任务须等该契约稳定后再开始。benchmark 不从 full-load 次数推断 hit，不访问私有 cache 状态或 raw token；observer 不可用/版本不兼容时拒绝性能可比性。
2. 首建或重建期间 before/load/build/after marker 变化可能只留下 `build_discard_*`；仅检查没有 external-invalidation-miss 不能证明无外部提交。修订为每 API lookup 只有一个互斥最终决定；build-race 原因另以固定枚举计数；phase start、每个 lookup、每次 build 前后和最后 API 之后都有有界外部观察检查点。缺少任一覆盖、原因不能分类或 observer 信息缺失时均不允许性能可比。明确了 final decision、build outcome、race reason、admission estimator 和 full-load 的交叉核验，避免把 miss+discard 双计。
3. 对照用户修订反馈，把每个 cold/warm 导航阶段写成两个 API 各 1,177 次、每配对四个 phase/API 分项合计 4,708；保留 `count=0` 时 `minMs=maxMs=null` 的 v1 MetricSummary 语义。

## 逐项核对 root 反馈

| 反馈要求 | 计划中的落点 | 核对 |
|---|---|---|
| observer 必须另行批准并先稳定 | 文件范围后明确 future Sol 缓存任务和协调方单独批准；协议工具等待 observer 契约稳定 | 不含 observer 产品实现/API 命名 |
| 不得用 full-load 差推 hit、不得读私有状态/raw token | observer 依赖段及 Cache 观测段 | lookup decision 与 full-load 分别计数 |
| 每个 API lookup 恰有一个最终决定 | `lookupDecisions` 按阶段/API 分布，互斥 enum | 每 API 1,177、每阶段 2,354、每 pair 4,708；race discard 不双计 miss |
| build race external/local/both 原因独立记录 | `BuildRaceReason` / `buildRaceReasons` | 4 项固定 enum；reason sum、discard sum、最终决定逐类核对 |
| 覆盖首建、重建及最后请求的外部变化 | `ObservationCheckpoint` 与 `externalObservations` | phase start、每 lookup、每次 build 前后、after-last 各有明确事件数 |
| 覆盖缺失或原因未知不得作性能比较 | `externalObservationCoverage` 与 gate/status 规则 | observer 不可用、版本错、coverage 缺项/原因不明均为 inconclusive |
| build/admission/external/full-load 统计各自独立可交叉核验 | candidate build、race reason、admission 与实际 full-load 等式 | 已写明 disjoint terminal outcomes 和 estimator 计数等式 |
| 正确描述每轮/每配对计数 | 固定负载与验收清单 | 每个 cold/warm 两 API；pair 四个 stage/API 分项 |
| 保留空 Metric null 规则 | MetricSummary 段和测试验收清单 | `count=0` 时 min/max 都为 null |
| 继续保留原 11 门、4,708 baseline、有界无外部变化观察下 `≤2` 及非原子限制 | 基线、分母、语义 gate 和 token 边界章节 | 仍明确 3E 冻结，观察窗结束后不声称捕获后续提交 |

该次复核前 `git status --short` 仅显示 T 两份目标文档为 untracked；这两文件未纳入 tracked diff，未对其或其他路径执行任何 Git 写操作。该历史状态不等同于提交或冻结接受。

## 反馈闭环与验证状态

起草期已发现并修正 v1 成功 validator 固定要求导航 `loadSnapshot` 每源 1,177 次这一协议冲突；本次 root 复审另发现 observer seam 与 build-race external coverage 缺口，并已在原两文档内修订。根因均为协议设计范围没有定义可证明的观测能力/分类，不是产品或测试缺陷。修订后按 root 反馈逐项对照：observer 单独批准/稳定后依赖、唯一 lookup 最终决定、race external/local/both/unclassified 固定原因、首建/重建/最后 lookup coverage、缺失覆盖拒绝可比、build/admission/external/full-load 等式、每阶段/每配对计数、empty Metric 的 null min/max 均写入计划与记录。按 v1 行为重算空计时规则，没有把空分布改成 0 或省略。

只读核对了当前 `AGENTS.md`、两份目标文档和 Git 状态。status 当时仅有本次这两份 untracked 目标文件；没有写入 Git，也没有执行 Git 收尾。没有运行测量、测试、索引、构建、native、dist、Electron 或 GUI。文档逐项核对及目标文件 SHA-256 在本次交付报告提供；新 observer 实现、协议工具、外部 writer 回归和三对测量均未验证。现为供 root 独立复审的冻结文档版本，不代表 root 接受设计。

## 工程规则沉淀

本轮无新增或修订 `AGENTS.md` 规则（0 条）。独立 v2 诊断器与明确分母是有代码契约支持的本轮设计选择，但工具尚未实现、测试或测量，暂不提升为已验证的通用工程经验。

## 2026-10-03 root 独立复审（同步修订前）

冻结计划hash EB9DCCEE...F05FCE23E、记录3F560C46...BF14803D实际相符。root完整读取两文档，对照已接受3F与原3E计数/11门/Metric空分布：observer先稳定依赖、最终决定与独立build/race/admission计数交叉核对、首建/重建/末请求覆盖及未知拒绝可比已补齐，当时接受设计。其后复审发现 `build_after` 对所有 candidate attempt 均在 finally 采样，而旧关系要求所有变化 outcome 必须对应 race discard，故该接受版需要最小同步修订；本节结论为历史状态，不代表当前四文档修订已复核。

## 2026-10-03 第二次协调方批准的 O/T 同步复核

### 缺口与修订

旧规则要求 `build_after` 中每种 external/local/both/unclassified outcome 的数量与 race discard 数完全相等。但产品设计要求所有已开始的 candidate attempt（包括 load/admission 失败、准入拒绝和取消终态）都在共同 `finally` 点采集真实 after sample。失败或拒绝的 candidate 可因此观察到变化，却仍须保留 `failed`/`rejectedByAdmission` 终态，不能伪造为 race discard。协议把真实 outcome 强行改为 discard、隐去已采样变化，或将完整且合法的数据判成采集缺失，都会混淆独立计数域。因此本轮改为有界的 O/R reconciliation，不改 summary/schema 字段。

令 `O` 为仅来自 `build_after` checkpoint 的 outcome 计数，`R` 为 candidate race reason 计数，`V = O_unavailable + O_invalid_type + O_in_transaction + O_closed`：

```text
R_external_only <= O_external_only
R_local_only    <= O_local_only
R_both_changed  <= O_both_changed
R_unclassified  <= V

Delta = (O_external_only - R_external_only)
      + (O_local_only - R_local_only)
      + (O_both_changed - R_both_changed)
      + (V - R_unclassified)
0 <= Delta <= failed + rejectedByAdmission + cancelled
installed <= O_unchanged
```

当 `failed = rejectedByAdmission = cancelled = 0` 时，`Delta=0` 迫使各非负差项为零，从而恢复原有精确关系：各 `R_x=O_x`、`R_unclassified=V`，并且 `installed=O_unchanged`。若完整覆盖数据违反这些关系，则为协议失败；实际未采到 checkpoint 必须报告 coverage false/complete false，不填零、不伪造 outcome。聚合关系不能证明 before/after 是同一个 candidate，故同 candidate 配对留在产品私有回归中验证，不添加事件矩阵或原 token 到报告。

每个 candidate 最多运行一次 admission estimator：`evaluatedCount <= attempted`、`evaluatedCount = acceptedCount + overLimitCount + invalidCount`、`rejectedByAdmission = overLimitCount`、`invalidCount <= failed`。load 在 estimator 前失败时只计 failed，不生成 admission evaluation。接受估算 bytes 由产品实际 estimator 给出。

cache final decision 是 resolver disposition。决定在 API settle 时只发布一次；之后 fresh evidence row、source/config/workspace 检查等 API error 另计并使语义门失败，不重写已封存的 hit/installed/bypass。`lookup_error` 只用于没有 candidate 且 resolver 尚未封存决定前的错误；入口已关闭单独记 `store_closed_error`。

状态优先级同步为：语义门失败、完整数据的协议关系违例，或 failed/rejected/cancelled 任一非零，均令 pair/optimization 为 `failed`；只有语义门通过且协议关系无违例时，实际 coverage 缺失或 token 分类不足才可为 observation-inconclusive；coverage 不足优先于外部写入 inconclusive；数据完整且可比并检测到 external/both 才为 external-write inconclusive；所有门通过、无 external/both、无候选失败/拒绝/取消且 full-load `<=2` 才可通过。真实缺采集与“声称完整但计数不一致”因此分别走 inconclusive 与 protocol failure。

### 固定边界组合核算

| 情形 | 计数关系与结论 |
|---|---|
| load 在 estimator 前失败，after 观察 external | `failed=1`、`evaluatedCount=0`、`O_external=1`、`R_external=0`、`Delta=1<=failed`；保留 build failure 和 observation，pair failed。 |
| admission rejection 后，after 观察 external | `rejectedByAdmission=1`、`overLimitCount=1`、`O_external=1`、`R_external=0`、`Delta=1<=rejectedByAdmission`；fallback 语义成功也不能通过优化门。 |
| installed 后 fresh evidence row 读取失败 | `installed=1`、`O_unchanged=1`，decision 仍为 installed；API error 单独计，语义门失败。 |
| 正常 unchanged install | `installed=1`、`O_unchanged=1`、`R=0`、`Delta=0`；其余门通过后才可能 pass。 |
| 完成 build 但 after 不可比较并 discard | `R_unclassified=1`、`V=1`、`Delta=0`；覆盖可完整但 token 不可比较，语义门通过时 observation-inconclusive。 |
| failed candidate 的 after 不可比较 | `failed=1`、`R_unclassified=0`、`V=1`、`Delta=1<=failed`；仍由 failed 优先判失败。 |
| 完整数据中 `R_external=1, O_external=0` 或 `Delta` 超上界 | 协议 failed，不得以 inconclusive 覆盖；真实缺采集另由 coverage 标志表示。 |

以上固定组合均满足修订后的关系；未发现需要放宽边界、改变 schema 或伪造 outcome 的反例。既有 4,708 分母、每 API 1,177、导航 full-load `<=2`、11 个语义门、三个同调用配对、summary/report 字段、fixture 与资源限制均未改变。

### 本次范围、证据与状态

本次批准范围是以下四份文档，不包含实现文件：

- `docs/plans/2026-10-03-navigation-cache-observer.md`
- `docs/development-runs/2026-10-03-navigation-cache-observer-design.md`
- `docs/plans/2026-10-02-snapshot-navigation-measurement-protocol.md`
- `docs/development-runs/2026-10-02-snapshot-navigation-measurement-protocol-design.md`

最终主 checkout 基线核对为 `85a68e16b8b194677ae8d7bc28ff73f68ef5d5d1`。协调方报告 S5 已由 `18b6cbb` 接受；C1 GraphStore 三文件冻结在 Sol worktree 等待验收。本轮不读 S5/C1 活动源码，源码设计依据仍固定在 `133686217903e854e24dbdc76af9203cf3e1fd23`。只修改上述四份文档；没有更改 `AGENTS.md`、代码、测试、fixture、工具或依赖，没有执行 Git 写操作或提交，也没有运行测试、构建、索引、benchmark、Electron 或 GUI。文件 SHA-256 和最终只读 `git status` 在交付核对中记录。

本轮无新增或修订 `AGENTS.md` 工程规则：修订属于协议设计推理，没有新增代码或复现实验可证明通用工程经验；既有证据、失败关闭及 development-run 规则已覆盖。
