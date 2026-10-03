# 3F-T：快照导航优化测量协议 v2

状态：2026-10-03协调方独立接受修订设计；本文件只定义后续诊断工具，不授权实现产品缓存或运行测量。

## 目标与版本边界

为已接受的快照导航缓存候选定义一个可审计的 post-change 测量协议。现有 3E 诊断仍是不可变的 v1 基线：其协议前缀为 `XRAY_NAVIGATION_DIAGNOSTIC:`，summary/report 的 `schemaVersion` 为 1，报告中的导航完整加载基线是每个 medium128 配对 4,708 次。v2 必须有独立的消息前缀、严格解析器和 `schemaVersion: 2`，不得改写、覆盖或以新 schema 重新解释 v1 报告。

v2 报告只引用基线协议版本、固定 medium 样例身份及基线聚合数，不复制旧报告、不记录旧临时目录或临时报告路径，也不声称新旧运行来自同一轮。v1 是比较基准，v2 是另一份 post-change 观测。

本协议依照已接受的 [快照导航性能候选设计](2026-10-02-snapshot-navigation-performance.md)：缓存和性能收益尚未实现或验收；有效性 token 是每个 GraphStore 连接局部的 `{ dataVersion, localSnapshotGeneration }`。报告及子进程消息绝不包含这两个原始值、SQLite pragma 文本、快照/证据 ID、源码、路径、内容哈希或导航哈希。只输出下文的固定枚举和计数。SQLite 标记不是跨表原子视图；协议不把检查后的外部提交描述成一次导航所有读取的线性化点。

## 后续实现的文件范围

收到单独实现派发后，首选新增以下三个文件：

- `benchmarks/local-index-navigation-optimized.ts`：v2 参数、受控 child、严格解析、报告生成和有界取消。
- `benchmarks/local-index-navigation-optimized-child.ts`：固定 medium fixture、两轮完整导航、缓存观测、旧语义门和聚合计时。
- `benchmarks/local-index-navigation-optimized.test.ts`：v2 report/child 协议、分母及门禁、隐私拒绝、边界和 child 生命周期测试。

可只读复用 `local-index-baseline.ts` 中现有的唯一临时目录、独占报告写入、固定样例和 `compareSnapshotPair` 帮助函数；实现时再次核对其实际签名和行为。3E 的 `local-index-navigation-diagnostic.ts`、`local-index-navigation-diagnostic-child.ts`、`local-index-navigation-diagnostic.test.ts`、fixture 和原始报告全部冻结。不得为迁就旧的 `loadSnapshot === 1,177` 汇总断言而修改 v1。实现新增诊断钩子、增加依赖或修改任何既有文件都必须另行说明范围。

**v2 工具依赖一个当前尚不存在的产品观测 seam。** `lookupDecisions` 和投影 admission bytes 必须来自 future Sol 缓存产品任务中经协调方单独批准、实现并稳定的范围狭窄、只读、可选 diagnostic observer。该 observer 在未启用时不得改变产品行为；启用时只能交付固定枚举、边界覆盖计数和准入 estimator 实际采用的字节计数，不得暴露私有 cache 状态、token 原值、源码或记录对象。协议工具不得通过减少的 `loadSnapshot` 次数推导 cache hit，也不得以 monkey-patch 私有状态或自行估算另一份 projection 代替 observer。**协议工具任务必须等待该 observer 契约稳定后再开始**；observer 不可用或版本不匹配时，只能拒绝性能可比性，不能生成“无外部写入/命中”的结论。observer 本身不属于本轮或 v2 工具三文件范围。

## 固定工作负载及分母

使用同一 medium128 fixture：`e2e-project-medium-v1`、generator version `1`、128 个文件、1,177 条预期 evidence；冷、热两轮各完整处理 1,177 条 evidence。每轮必须各调用应用 API `getEvidence` 1,177 次和 `readSource` 1,177 次，尝试及成功解析 1,177 条，错误为 0。不得抽样、跳过、去重或因缓存命中而省略 API 响应。`readSource` 仍须 fresh-read snapshot source、当前 ignore settings，并执行当前路径/workspace 检查。

唯一优化分母是 cold/warm **导航阶段**的完整 snapshot 持久化读取机会：

| 阶段 | `getEvidence` API | `readSource` API | 满额完整加载数 |
|---|---:|---:|---:|
| coldNavigation | 1,177 | 1,177 | 2,354 |
| warmNavigation | 1,177 | 1,177 | 2,354 |
| 配对合计 | 2,354 | 2,354 | 4,708 |

每个导航阶段的完整加载数由 `getEvidence` 来源下的 `loadSnapshot` 加 `readSource` 来源下的 `loadSnapshot` 构成；v2 必须让这两个分项与总数相符。完整加载指实际执行现有完整 snapshot 读取及校验/legacy 兼容路径；若实现移动了该路径，计数必须加在实际完整读取边界，不能只数 application 方法调用或把 cache hit 算成加载。索引阶段的读、current/state 检查、gate evaluation 与独立 secure-read replay 均不进入 4,708 分母，仍按独立阶段报告。

每个 cold/warm 两阶段的 observer coverage 都完整、且完整观察窗口没有 external/both change 的配对，`coldNavigation + warmNavigation` 完整 snapshot 加载总数必须 `≤ 2`。这只表示有界观测区间内未观察到外部变化，不表示绝对没有外部提交。接受的设计预期 cold 与 warm index 各使本地代数变化，最多各有一次导航重建；不得把门改成“平均每 API ≤ 1”或把索引阶段加载混进分子。每配对同时必须满足全部 11 项原语义门和完整响应数。优化门是附加门，不能替代语义门。

## v2 summary/report 合约

child summary 保留 v1 的完整度量维度并使用 `schemaVersion: 2`：

- `sample: { id, generatorVersion, fileCount, totalBytes, evidenceExpected }`；`runtime: { nodeVersion, platform, architecture }`；`snapshot: { healthStatus, files, nodes, edges, evidence, unknownEdges }`；
- `stages`：`setup`、`coldIndex`、`warmIndex`、`secureReadReplay`、`gateEvaluation`、`appClose`；
- `navigation.cold` 和 `navigation.warm` 均含 `wall`、`nodeEvidenceCheck`、`evidenceLoop`、`canonicalizeAndHash`、`counts: { nodesChecked, evidenceExpected, evidenceAttempted, getEvidenceCalls, readSourceCalls, resolvedEvidence, errors }`、`api: { getEvidence, readSource }`；
- `storage`：阶段仍为 `setup`、`coldIndex`、`coldNavigation`、`warmIndex`、`warmNavigation`、`secureReadReplay`、`gateEvaluation`、`appClose`；来源为 `indexProject`、`getEvidence`、`readSource`；方法为 `loadSnapshot`、`getEvidence`、`readSnapshotSource`、`loadIgnoreSettings`；
- `secureReadReplay: { calls, bytesRead }`；`progress` 按 `cold`/`warm` 和六个固定 phase 提供 `{ events, firstElapsedMs, lastElapsedMs, lastCompleted, total }`；
- `semanticGates`：v1 原样的 11 个 checks、`passed` 和固定 failure code 列表；
- v2 专属的 `navigationFullLoads`、observer 合约版本/状态、observer 提供的 `lookupDecisions` / build race / 外部变化观测、同一 estimator 的 `projectionAdmission`、`heapUsed` 和 `optimizationGate`。`navigationFullLoads` 在完整持久化读取边界直接计数；绝不由该次数反推 lookup decision。

原 checks 名称及顺序固定为：`sourceFilesEqual`、`canonicalFactsEqual`、`persistedPayloadEqual`、`sameSnapshotIdentity`、`originalCreatedAtPreserved`、`stableNodeNavigation`、`stableEvidenceNavigation`、`stableResolvedSourceNavigation`、`expectedSourceFilesEqual`、`bothSnapshotsHealthy`、`navigationResolved`。v2 只将 v1 中的 `gates` 字段重命名/包入 `semanticGates`，不能更改任一 check 的定义、required 状态或失败解释。

每个 `MetricSummary` 维持精确形状 `{ count, totalMs, minMs, maxMs, buckets }` 及 v1 的 `[1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]` ms buckets；`count === 0` 时 `minMs` 与 `maxMs` 必须都为 `null`，`count > 0` 时按 v1 精确 validator 校验有限范围。Application API、store 方法与完整 `loadSnapshot` 时长是相互嵌套的 inclusive 计时，不得相加为 wall；导航 wall、index wall、child wall、secure-read replay 各自独立解释。保留 progress 为观测点而非 phase 时长的限制。

v2 root report 用 `schemaVersion: 2`、`measurementProtocolVersion: 2`，明确记录 `baselineProtocolVersion: 1` 及冻结状态。记录 `environment: { nodeVersion, platform, architecture, betterSqlite3Version }`；平台须为 `win32`，其他值从本次实际 runtime/依赖读取。记录 requested pair count、总 timeout 和前述可重算的配对计数，不能继续用一个含义模糊的 `validPairCount` 混合这些集合。每配对保留有界 `code`/`protocolError`、退出码/信号、终止原因、`childClosed`、是否强杀、duration、受限 progress 和可选 summary。汇总计数必须能从各配对状态重算。

以下为字段形状摘录：`baseline` 属于 root report；导航、cache、容量、heap 和 gate 字段属于 child summary。精确 gate 名称、版本和数值不可变：

```text
baseline: {
  protocolVersion: 1,
  state: "frozen",
  sampleId: "e2e-project-medium-v1",
  generatorVersion: 1,
  navigationFullSnapshotLoadsPerPair: 4_708,
}
type LookupDecision =
  | "hit" | "empty_build_installed" | "external_rebuild_installed"
  | "local_rebuild_installed" | "combined_rebuild_installed"
  | "build_discard_external" | "build_discard_local" | "build_discard_combined"
  | "build_discard_unclassified" | "projection_limit_fallback"
  | "transaction_bypass" | "token_unavailable_bypass" | "invalid_token_bypass"
  | "store_closed_error" | "legacy_bypass" | "build_error_fallback" | "lookup_error";
type BuildRaceReason = "external_only" | "local_only" | "both_changed" | "unclassified";
type TokenObservation = "unchanged" | "external_only" | "local_only" | "both_changed"
  | "unavailable" | "invalid_type" | "in_transaction" | "closed";
type ObservationCheckpoint = "phase_start" | "lookup_validity" | "build_before"
  | "build_after" | "after_last_lookup";
navigationFullLoads: {
  coldNavigation: { getEvidence: number; readSource: number; total: number };
  warmNavigation: { getEvidence: number; readSource: number; total: number };
  navigationTotal: number;
  fullLoadOpportunityCount: 4_708;
  maximumWithCompleteNoExternalChangeObservation: 2;
}
observer: { status: "enabled" | "disabled" | "unavailable" | "version_mismatch"; contractVersion: string | null };
lookupDecisions: {
  coldNavigation: { getEvidence: Record<LookupDecision, number>; readSource: Record<LookupDecision, number> };
  warmNavigation: { getEvidence: Record<LookupDecision, number>; readSource: Record<LookupDecision, number> };
} | null;
candidateBuilds: {
  coldNavigation: { attempted: number; installed: number; discarded: number; rejectedByAdmission: number; failed: number; cancelled: number };
  warmNavigation: { attempted: number; installed: number; discarded: number; rejectedByAdmission: number; failed: number; cancelled: number };
} | null;
buildRaceReasons: {
  coldNavigation: Record<BuildRaceReason, number>;
  warmNavigation: Record<BuildRaceReason, number>;
} | null;
externalObservations: {
  coldNavigation: Record<ObservationCheckpoint, Record<TokenObservation, number>>;
  warmNavigation: Record<ObservationCheckpoint, Record<TokenObservation, number>>;
} | null;
externalObservationCoverage: {
  coldNavigation: { complete: boolean; checkpoints: Record<ObservationCheckpoint, boolean> };
  warmNavigation: { complete: boolean; checkpoints: Record<ObservationCheckpoint, boolean> };
}
projectionAdmission: {
  coldNavigation: { evaluatedCount: number; acceptedCount: number; acceptedBytesTotal: number; maxAcceptedBytes: number; overLimitCount: number; invalidCount: number; limitBytes: 4_194_304 };
  warmNavigation: { evaluatedCount: number; acceptedCount: number; acceptedBytesTotal: number; maxAcceptedBytes: number; overLimitCount: number; invalidCount: number; limitBytes: 4_194_304 };
} | null;
heapUsed: {
  coldNavigation: { beforeBytes: number; afterBytes: number };
  warmNavigation: { beforeBytes: number; afterBytes: number };
}
optimizationGate: {
  status: "passed" | "failed" | "inconclusive_external_write" | "inconclusive_external_observation";
  navigationFullSnapshotLoads: number;
  maximumWithCompleteNoExternalChangeObservation: 2;
  failureCodes: string[];
}
```

实际 v2 JSON 必须通过 exact-key 验证；数值必须是有限、非负、安全整数或按 v1 规则校验的有限时长。每个 cold/warm 阶段的每个 API 调用必须且只能取得一个 observer 最终决定：`lookupDecisions` 按阶段和 API 分开计数，其分布总和必须各为 1,177；每阶段为 2,354、每个配对为 4,708。最终决定不能先计 `miss`、随后又把同一次请求的 `build_discard_*` 当作第二个 lookup 决定。

`observer.status === "enabled"` 时必须有非空 `contractVersion`，且所有 observer 计数可用；其他状态的 `contractVersion`、lookup/build/race/admission/external outcome 数据必须为 `null`，coverage 各 checkpoint 均为 `false` 且 `complete=false`，不能用零值伪装“没有事件”。任何非 enabled 状态均不可性能比较。

build、admission 和 token-change observations 是独立计数域，并执行以下交叉核验：`candidateBuilds.attempted = installed + discarded + rejectedByAdmission + failed + cancelled`；`installed` 等于最终决定 `empty_build_installed` 与三类 `*_rebuild_installed` 之和；`discarded` 等于四类 `buildRaceReasons` 之和，并与最终决定中的 `build_discard_*` 次数一致；`rejectedByAdmission` 等于 `projection_limit_fallback` 决定数。`failed` 等于 `build_error_fallback` 决定数，`lookup_error` 仅计不属于 candidate build 的 API 失败。每阶段 `projectionAdmission.evaluatedCount = acceptedCount + overLimitCount + invalidCount`，`rejectedByAdmission = overLimitCount`，`invalidCount` 只能对应 candidate `failed` 终态；acceptedCount 至少覆盖 installed 与 race-discarded 候选数，因已准入候选之后再失败/取消时仍计入 admission accepted bytes。`acceptedBytesTotal`/`maxAcceptedBytes` 使用产品 observer 实际准入 estimator 的 accepted 结果，不另行重算。完整加载数由真实 full-load 边界直接计数，并与阶段化 `storage.*.*.loadSnapshot.count` 交叉核对，不能由 `lookupDecisions` 反推，反之亦然。

`externalObservations` 是固定检查点与 token comparison outcome 的有界聚合，不输出原始 token。每阶段须覆盖 `phase_start`、每个 API 的 `lookup_validity`、每次建槽/重建的 `build_before` 和 `build_after`，以及全部响应完成后的 `after_last_lookup`；对应事件计数必须分别为 1、2,354、`candidateBuilds.attempted`、`candidateBuilds.attempted`、1。每个 `build_after` outcome 必须相对同一次 candidate 的 `build_before` 分类；`external_only`、`local_only`、`both_changed` 分别与 `buildRaceReasons` 同类 discard 计数相等，unavailable/invalid/transaction/closed 等不可分类 outcome 与 `unclassified` reason 相等。phase-start/lookup/end 的外部变化计数另行保留；同一提交可能在多个 checkpoint 被观察到，这些是观察次数而非唯一提交次数，不能相加成“提交数”。observer 版本/覆盖状态缺失、任一检查点不全、token 无效/不可用、事务/关闭状态无法排除、或 build race 原因 `unclassified` 时，性能比较必须拒绝，不能由“没有 external enum”推断无外部提交。无外部变化只可在完整覆盖且所有边界 outcome 均无 external/both change 时成立。比较窗口在 `after_last_lookup` 结束；之后发生的提交不声称能被本次观察捕获，且多表读取仍非原子视图。

优化门仅在语义门通过、observer 覆盖完整、token 可比较、未观察到 external/both change、且 `navigationTotal ≤ 2` 时为 `passed`。完整观察且无外部变化但加载数大于 2 为 `failed`；语义门失败始终使配对失败；观测到外部变化时为 `inconclusive_external_write`；observer 覆盖/分类不足时为 `inconclusive_external_observation`。失败或部分 child summary 不可被修补成通过。

root report 使用分开的可重算计数：`terminalSummaryPairCount`、`semanticValidPairCount`、`performanceComparablePairCount`、`optimizationPassPairCount`、`externalWriteInconclusivePairCount`、`externalObservationInconclusivePairCount` 与 `notStartedPairCount`。pair status 固定为 `completed`、`failed`、`cancelled`、`timed_out`、`inconclusive_external_write`、`inconclusive_external_observation` 或 `not_started`：`completed` 代表 child summary、11 门、响应数、observer 覆盖和优化门全部通过；`failed` 代表已运行但语义/优化/协议门失败；两个 inconclusive 状态仅表示语义完整通过但分别存在外部变化或观测覆盖不足。性能可比较要求完整执行、11 门通过、响应数正确、observer 覆盖完整、所有 token observation 可分类且没有 external/both change，并在同一调用的环境记录下；优化通过是性能可比较的子集，另要求 `navigationTotal ≤ 2`。计数只从逐对状态及对应summary重算。

## Cache 观测、容量及外部写入

v2 不由 child 自行观察 cache 私有状态。future 产品 observer 必须提供有限、只读、可选的每 lookup 最终决定、build 生命周期、admission estimator 结果和外部变化观察；报告只保留固定枚举的聚合计数，不发逐请求事件列表、不保存 raw token。单次 API lookup 的最终决定 union 固定为：

`hit`、`empty_build_installed`、`external_rebuild_installed`、`local_rebuild_installed`、`combined_rebuild_installed`、`build_discard_external`、`build_discard_local`、`build_discard_combined`、`build_discard_unclassified`、`projection_limit_fallback`、`transaction_bypass`、`token_unavailable_bypass`、`invalid_token_bypass`、`store_closed_error`、`legacy_bypass`、`build_error_fallback`、`lookup_error`。

这些值是互斥的 lookup **最终结果**：例如 before/load/build/after 检查发现 external commit，且因此丢弃候选时，该 API 请求只记 `build_discard_external`；不得先加 `empty_miss` 或 `external_invalidation_miss` 再加 discard。每阶段按 `getEvidence` 和 `readSource` 分表，决策数各自总和必须是 1,177；阶段总和 2,354、每配对总和 4,708。完整加载仍由真实持久化 full-load 边界单独计数；不能用 `API calls - full loads` 计算 hits。事务中、token 无效/不可用、store 关闭、legacy、超限和请求失败都不能归作 `hit`。

build race 原因使用独立固定 union `external_only`、`local_only`、`both_changed`、`unclassified`。独立的 `candidateBuilds` 结果必须是互斥终态 `installed`、`discarded`、`rejectedByAdmission`、`failed`、`cancelled`，`attempted` 等于其总和；race reason 各计数总和等于 `discarded`，并须和 `build_discard_*` 最终 lookup 决策计数逐类相等。此独立计数不会为同一个 API lookup 增加第二个 final decision。

外部变化观察在产品 observer 内以 `{ checkpoint, outcome }` 有界计数；checkpoint 固定为 `phase_start`、每个 API lookup 的 `lookup_validity`、每次首建/重建的 `build_before`、`build_after`、该阶段最后一个 API 返回后的 `after_last_lookup`；outcome 固定为 `unchanged`、`external_only`、`local_only`、`both_changed`、`unavailable`、`invalid_type`、`in_transaction`、`closed`。每阶段这些 checkpoint 的期望次数分别为 1、2,354、`candidateBuilds.attempted`、`candidateBuilds.attempted`、1。v2 summary 报实际各 outcome count 和各 checkpoint coverage bool；所有期望次数匹配且 observer 明确报告完整 coverage 才能记 `complete`。外部变更原因另行计数，不能以 build race `unclassified` 或没有外部 lookup-miss 决策表示“无外部写入”。

`projectionAdmission` 报 `evaluatedCount`、`acceptedCount`、`overLimitCount`、`invalidCount`、accepted 字节总量/最大值与 `limitBytes: 4_194_304`；必须由 observer 透传**产品实际使用的同一 estimator**。交叉核验 `evaluatedCount = acceptedCount + overLimitCount + invalidCount`，且 `candidateBuilds.rejectedByAdmission = overLimitCount`；准入 bytes 统计所有 estimator 判定 accepted 的候选，即使该候选随后因 token race 被丢弃。无效 estimator 结果失败关闭，不准入、不报 guessed bytes。不得为诊断临时 stringify/复制整个图，也不得访问私有 cache 对象、token 或原始数据。准入估算不是 V8 heap 限制。另记录 cold/warm navigation 前后 `process.memoryUsage().heapUsed` 字节读数；说明这是整个 child 的 heap、未经强制 GC、受导航结果和索引等对象影响，不能称为 cache 净占用。

常规性能配对期间应无其他连接的提交。观察到外部变化时，允许安全额外 full-load 并仍须运行全部 11 项语义门；11 门通过但确有 external/both change 的配对标为 `inconclusive_external_write`，不计入性能可比较数。若覆盖不完整、observer 缺失/不兼容或变化原因无法分类，标为 `inconclusive_external_observation`，同样不计入性能可比较数，不能当作无外部写入。任何 11 门失败仍是语义失败，不能由外部变化状态豁免。

此外，v2 回归套件必须有受控的第二 SQLite 连接 commit 场景：在临时、工具拥有的 store 内提交一个不改 graph payload、current、createdAt 或 ignore configuration 的安全 fixture 写入；验证下一次事务外 lookup 观察 external invalidation、触发至少一次安全完整 reload，随后重新计算且通过全部 11 项原语义门。此 challenge 与无写入计时配对分开，不纳入 4,708 分母或 wall/performance aggregation。具体安全 fixture 写入点必须由实现任务按实际 schema 选定，不在本设计中猜表名。

## 配对接受与结论边界

正式比较至少需要 **3 个有效配对**，必须由单次调用 `--pairs 3` 完成；不能把不同报告中的 pair 拼成三对。这样三对共享同一 Windows 进程环境、Node 版本、架构、SQLite 驱动版本和 child 代码。v2 沿用 v1 的 medium fixture 和配对顺序：setup、cold index、cold navigation、warm index、warm navigation、secure-read replay、gate evaluation、app close。报告各 pair 的 cold/warm wall、navigation API/store 分布、导航 full-load 分项、observer 最终 lookup decisions/build/admission/external observations 和 heap 读数，并提供这 3 对的 median/min/max；保留每对原始聚合值。少于 3 个性能可比较配对、环境字段不一致、有界观察到外部变化、observer 覆盖不足、timeout、取消、协议错误或语义门失败，都不能形成“优化验收通过”的性能结论。单对结果只能作为单一合成样例的观察，不推广到真实仓库、用户机器或一般性能。若计数达标而 wall/heap 无改善，原样报告，不降低门槛。

v2 report 的 `limitations` 明确说明：仅 medium synthetic fixture；sample/generator 固定；计时包装开销未扣除；inclusive 子计时不可加和；heap 读数不是缓存净内存；外部写入配对仅验证安全失效，不作性能比较；合成结果不代表实际仓库或跨机器性能。

## 资源、协议和进程安全边界

沿用 V1 的上限，只有经独立审查的必要理由才能调整：1–3 对；单次总时限 5,000–180,000 ms，默认 180,000 ms；单次 stop grace 默认 1,000 ms、上限 2,000 ms；每个 child timeout 先扣除 4,000 ms shutdown reserve；超时或取消后必要时强制终止进程树并等待 child `close`；最大 evidence 2,000；单行消息 64 KiB、协议总量 256 KiB、最多 2,048 行、最终 JSON 报告最多 256 KiB。v2 新增枚举只输出有界聚合数字，三对 summary 必须由测试确认低于报告上限。4 MiB projection admission cap 是产品候选约束，与 IPC/report cap 分别校验。

保留 v1 child frame 的精确字段形状但使用 v2 独立 prefix（建议 `XRAY_NAVIGATION_OPTIMIZED_V2:`）：progress 为 `{ type: "progress", stage: "cold" | "warm", phase, elapsedMs, completed, total }`；terminal 为 `{ type: "terminal", status, code, summary? }`；parent cancel 行为 `{ type: "cancel" }`。summary/root report 使用 v2 schema；prefix 标明 child frame 协议版本。progress 六阶段固定为 `queued`、`discovering`、`reading`、`analyzing`、`verifying`、`persisting`。所有 frame 使用严格 exact-key parser；safe code、有限字符串、协议行/总量和完成前禁止未知字段都要有 v2 自己的验证。runner 使用唯一受管 temp root、每 pair 子目录及独占写报告；不把原始输入或第三方 stdout 当指令。child instrumentation 必须在所有正常/异常/取消/超时路径 `finally` 恢复 wrapper。spawn 后始终等待进程树停止且收到 child `close`，不得只因收到 terminal 就认定已经关闭。

## 验收清单

observer 由 future Sol cache task 单独批准并稳定后，后续协议工具实现应最少验证：

1. exact v2 schema、unknown-key 拒绝、错误计数/错分母/不安全数字拒绝、报告字节上限；v1 parser/report 的现有测试和文件保持原样。
2. 每轮（cold 或 warm）有两个 API 计数：`getEvidence=1,177`、`readSource=1,177`；每配对有四个 phase/API 分项、最终 lookup decisions 总数 4,708；evidence 全部 attempted/resolved、errors=0；原 11 项 gates 名称和语义未变。
3. 两个阶段 observer 覆盖完整且没有观察到 external/both change 时，四分项求和等于导航总数且 `≤2`；3E 对应 baseline 则为 4,708；index/current/replay 加载不能影响该算式。此门不表述为观测窗外没有外部提交。
4. 在受控第二连接 commit 场景中分别覆盖首建 race、缓存重建 race 和最后 API 返回前的变化；确认最终 lookup decision 各恰一条，build race external reason 单独计数，external checkpoint 观察到变化。即使总加载 `≤2` 且 11 门通过，仍标为外部写入不可比较；无任何外部 miss 决策不能覆盖或冲掉 build race reason。
5. observer 对每阶段固定边界完整覆盖：phase start、每一 API lookup、每次 build before/after、最后 API 后；注入缺项、unavailable、invalid type、unclassified race，均拒绝性能可比。逐项交叉核对 final decisions、build outcomes、race reasons、admission outcomes 与真实 full-load 计数，不能双计一次 miss/discard。
6. 在 observer 缺失/版本不兼容时不访问私有状态，不用 full-load 差推 hit，也不输出性能可比结果；token 原值、源码/路径/evidence ID/hash 均不可能进入报告。
7. admission limit 边界和实际同一 estimator bytes、heap 字段边界、超过限额的 fallback；不得把 estimate 当实际 heap；`count=0` metrics 的 min/max 均为 `null`。
8. 取消、timeout、协议错、child close、强杀升级、剩余配对 `not_started`、唯一目录及独占写入保留 V1 生命周期门。
9. 三对同环境摘要可核算；单对或不同环境明确为 exploratory/inconclusive，不给出泛化结论。

本轮只提交本计划与配套设计记录，未运行任何测量/回归。产品 cache、诊断工具、测试与性能收益均未实现或验收。
