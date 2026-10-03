# 3F-O：导航缓存只读观察 seam 设计

状态：2026-10-03 17:18 协调方独立接受 O/T 四文档同步修订。仅定义后续实现接口和门槛；产品缓存/observer 实施另按 C2 计划派发，3F-T 工具仍等待稳定产品端口。

## 范围与基线

目标是在未来的导航缓存实现中提供一个可选、只读、有版本号的诊断 seam，供后续 3F-T 工具读取固定聚合数据。seam 观察 `getEvidence`、`readSource` 内部 cache lookup 的决策、候选构建、容量准入和有效性检查；它不返回缓存对象，也不改变产品查询结果、授权判断或既有错误语义。observer 的 lookup decision 表示缓存层的处理结果，不代表后续 API 查询或源码检查成功；API 错误由工具现有的响应错误计数和语义门独立记录。

源码设计基准固定为集成提交 `133686217903e854e24dbdc76af9203cf3e1fd23`。该提交的 `packages/application/src/index.ts:218-229` 中，`requireSnapshot` 每次都从对应 `GraphStore` 调用 `loadSnapshot`，随后检查 repository 归属；`:260-263` 的 `getEvidence`、`:360-375` 的 `readSource` 都经过此路径。`packages/graph/src/index.ts:39-53,254-308,323-325` 显示 GraphStore 在构造时完成迁移，`saveSnapshot` 用 `transaction.immediate()` 提交，`loadSnapshot` 读取并解析完整 payload。此基线没有导航缓存、有效性 token 或 observer。以上是提交源码事实；缓存的行为和收益仍属未来设计，不是当前产品事实。

本轮开始只读检查时 `HEAD` 为 `d6fb625af97826c7238d78f075e361b5dad30946`，当时已有一项对 `docs/development-runs/2026-10-01-v1-long-development-review.md` 的未提交修改。工作期间协调方另行提交并推送 `06396e7a35947303965f862f46be8be77180080e`；该提交不包含本轮文档。当前主 checkout 经最终只读核对的 `HEAD` 为 `85a68e16b8b194677ae8d7bc28ff73f68ef5d5d1`。协调方确认 S5 已由 `18b6cbb` 单独接受；C1 的 GraphStore 三文件在 Sol worktree 冻结等待协调方验收。本设计未读 S5/C1 活动源码；源码论证仍固定在 `133686217903e854e24dbdc76af9203cf3e1fd23`，不把后续实现状态当作已复核事实。未来实现必须等 S5/C1 集成稳定、O/T 设计接受后重新核对实际 Git 基线、`AGENTS.md`、`requireSnapshot`、两个导航 API、关闭生命周期及 GraphStore 写路径，再确认本方案仍适用。

3F-T 原有 4,708 分母、`≤2` 导航 full-load 门、11 项语义门、每 API 1,177 次、三个同调用配对、schema 字段及资源上限保持不变。协调方发现 O/T 的失败 candidate `build_after` 等式不兼容，并明确批准在本批四份设计文档中最小修订 O/T 的计数关系和结果优先级；本设计与 T 计划/记录同步更新，3E 基线和工具仍冻结。3F-T 的三份新工具文件要等 observer 已实现并冻结后再开始。此授权不包括实现产品缓存、observer 或诊断工具。

## 内部 API 与生命周期

建议在 `XRayApplication` 实例上提供一个内部、显式启用的能力；旧版本没有该方法时，future consumer 通过可选方法探测处理，不要求应用默认安装 observer：

```ts
const observation = app.openNavigationCacheObservationV1();
if (observation) {
  observation.beginPhase("coldNavigation", snapshotRef);
  // 完整执行并等待本阶段所有 getEvidence/readSource 调用
  observation.endPhase("coldNavigation");
  const summary = observation.getSummary();
  observation.dispose();
} else {
  // 报告 observer unavailable；不尝试访问私有缓存或 GraphStore token。
}
```

API 形状固定为 `openNavigationCacheObservationV1(): NavigationCacheObservationScopeV1 | null`；实现不存在时 consumer 识别为 unavailable，重复安装失败返回 `null`。scope 方法为 `beginPhase(phase, ref): void`、`endPhase(phase): void`、`getSummary(): NavigationCacheObserverSummaryV1`、`dispose(): void`。阶段参数使用固定 enum；序列/身份不匹配记录 coverage 失败，不把错误对象或自由文案写入摘要。`dispose()` 后 `getSummary()` 仍可读已冻结的终态摘要；scope 不提供事件订阅、缓存读取或 token 读取方法。

固定版本为 `xray.navigation-cache-observer.v1`。未来工具先以可选能力和该版本进行协商：方法不存在时报告 `unavailable`，版本不匹配时报告 `version_mismatch`；两种情况下都不得 monkey-patch、读取私有字段、推导缓存命中或写入伪造零计数。`snapshotRef` 只用于 Application 从现有映射中选择已有 `GraphStore`，不会出现在摘要中；marker API 不调用 `requireSnapshot`，也不创建懒加载 store。若没有现成 store，边界检查记为不可用、coverage 不完整。

每个 Application 最多一个活动观察 scope。scope 只接受固定阶段 `coldNavigation`、`warmNavigation`；不能嵌套或并行阶段。每个阶段必须先 `beginPhase`，等全部导航调用成功或失败并结束，再 `endPhase`。若结束时仍有未决调用、阶段顺序错误、scope 被提前 dispose，或 Application/store 已关闭，相关 coverage 标记为不完整。`dispose` 幂等，移除 observer；Application `close()` 先使 scope 失效并移除，再关闭 stores。scope 不改变产品的缓存槽生命周期。

每个 API 调用在入口捕获所属 scope/phase 的内部 request context；`readSource` 的 await 后 continuation 仍记回开始它的 phase，不读取届时的“当前活动 phase”。context 不含可输出的 repository/snapshot/file/evidence 身份。`endPhase` 只有在该 phase 的调用均 settle、各有一个 final decision 时才可置完整；有未决调用时将该 phase 标为不完整，并阻止开始下一 phase，直至旧调用结束。这样异步交错不会把一次调用计入错误阶段或重复终结。

观察采用 pull-only 聚合器，不暴露事件回调。内部事件仅为固定字段的短暂记录，立即折入固定计数器，不保留逐请求事件列表。`getSummary()` 返回与内部状态分离的 plain-data 快照；深冻结副本，且其中没有任何可变产品对象。调用者改写返回对象不能影响内部计数或产品缓存。没有回调入口，就不存在 callback throw 或 callback 重入；若未来确实要加入回调，须另行评审并提升契约版本，不能把回调塞入 v1。

scope 的摘要只含 `contractVersion`、两个固定 phase 的聚合结果、coverage 和以下固定词表，不含应用对象或身份信息：

```ts
interface NavigationCacheObserverSummaryV1 {
  contractVersion: "xray.navigation-cache-observer.v1";
  phases: Record<"coldNavigation" | "warmNavigation", {
    lookupDecisions: Record<"getEvidence" | "readSource", Record<LookupDecision, number>>;
    candidateBuilds: {
      attempted: number; installed: number; discarded: number;
      rejectedByAdmission: number; failed: number; cancelled: number;
    };
    buildRaceReasons: Record<BuildRaceReason, number>;
    externalObservations: Record<ObservationCheckpoint, Record<TokenObservation, number>>;
    externalObservationCoverage: {
      complete: boolean;
      checkpoints: Record<ObservationCheckpoint, boolean>;
    };
    projectionAdmission: {
      evaluatedCount: number; acceptedCount: number; acceptedBytesTotal: number;
      maxAcceptedBytes: number; overLimitCount: number; invalidCount: number;
      limitBytes: 4_194_304;
    };
  }>;
}
```

此结果是 observer 专属聚合片段；工具另行读取自身的 API/full-load 计时和语义门，并组成冻结的 3F-T summary。它不包含 `observer.status`、heap、wall、API 响应或存储计数，避免 observer 冒充这些独立来源。

- API：`getEvidence`、`readSource`。
- 最终 lookup decision：`hit`、`empty_build_installed`、`external_rebuild_installed`、`local_rebuild_installed`、`combined_rebuild_installed`、`build_discard_external`、`build_discard_local`、`build_discard_combined`、`build_discard_unclassified`、`projection_limit_fallback`、`transaction_bypass`、`token_unavailable_bypass`、`invalid_token_bypass`、`store_closed_error`、`legacy_bypass`、`build_error_fallback`、`lookup_error`。
- build race reason：`external_only`、`local_only`、`both_changed`、`unclassified`。
- token outcome：`unchanged`、`external_only`、`local_only`、`both_changed`、`unavailable`、`invalid_type`、`in_transaction`、`closed`。
- checkpoint：`phase_start`、`lookup_validity`、`build_before`、`build_after`、`after_last_lookup`。
- 每阶段候选终态：`installed`、`discarded`、`rejectedByAdmission`、`failed`、`cancelled`；admission 结果为 `accepted`、`over_limit`、`invalid`。

摘要中的决策、reason、outcome 使用精确 enum；所有计数和容量值均须为有限非负安全整数。计数溢出、scope 内部状态损坏或事件丢失时，停止该 scope 的有效聚合并将 coverage 标为不完整；不得抛错、回调或改变正在进行的产品请求。摘要不含时间戳、错误文案、SQLite 文本、绝对路径或其他自由字符串。

## token 所有权与边界探测

有效性标记属于发出它的单个 `GraphStore` 实例及其单个 SQLite 连接。建议 GraphStore 内部 API 返回辨别联合：

```ts
type NavigationValiditySample =
  | { status: "valid"; dataVersion: number; localSnapshotGeneration: number }
  | { status: "unavailable" | "invalid_type" | "in_transaction" | "closed" };
```

原始 `dataVersion` 和 `localSnapshotGeneration` 只在 GraphStore 与 Application 的内部缓存实现之间流动，用于同连接内比较。observer 只接收比较后的固定 `TokenObservation`，摘要绝不含原始 token 或 SQLite pragma 返回值。`data_version` 必须先验证为有限可比较整数；不把 undefined、NaN、异常对象或相等的无效值当作有效 token。连接在事务中时先报告 `in_transaction`，不运行 pragma；store 关闭或读取失败也返回显式状态。

本连接的 generation 在 GraphStore 构造期间的迁移完成后建立，并在每次 `saveSnapshot` 成功事务提交后推进；包括同内容保存/重新激活时的保守失效。提交失败时不宣称成功；实现可选择额外失效，但不得回退或复用已用过的 generation。达到安全整数上界时停止提供可比较 token。关闭使 token 变为 `closed`。这些规则是待实现的窄 GraphStore seam，不是基线已有能力。

每次 lookup 的有效性检查和每个 candidate build 的前后检查，直接复用缓存安全逻辑本来需要的同一连接 token 样本。observer 只归集结果，不再发额外 PRAGMA。`build_before` 是候选构建开始处对该 lookup 已取得样本的逻辑 checkpoint；不重复读取。`build_after` 是候选安装前缓存安全逻辑要求的第二次样本，并与同一候选的 `build_before` 比较。这使 token 无效、正在事务中、连接关闭或候选失败仍可产生对应枚举，不会被静默漏掉。

每个已经计入 `candidateBuilds.attempted` 的候选，无论完整加载、投影或 admission 成功与否，产品缓存路径都在共同的 `finally` 收尾点尝试 `build_after` 样本；该行为与 observer 是否启用无关。GraphStore token API 将读取故障归一成状态，finally 不抛错覆盖主结果；若实现层仍收到异常，也须保留原始主错误并把 observer coverage 标为不完整。candidate 在第二样本前失败时仍如实计 `failed`，不伪造 `unchanged`，也不把它改成 race discard。若 `build_after` 真实观察到 external/local/both 变化，该 token outcome 照实记录。

`phase_start` 和 `after_last_lookup` 不对应现有导航查询内的检查，因此 scope 明确执行两次额外、只读的 boundary token probe。它们只调用 GraphStore 的窄 token API，不调用 `loadSnapshot`、`getEvidence`、`readSnapshotSource`、配置读取或其他 SQL。每次 probe 恰好作为对应 checkpoint 的一次观测，直接出现在该阶段 `externalObservations` 聚合中；不隐藏或另造额外探测。工具须在导航 wall/API 计时开始前调用 `beginPhase`，并在最后一个 API Promise 已 settle、导航 wall/API 计时停止后调用 `endPhase`。这两次显式 probe 不进入导航完整加载分母，也不混入任一 API 或 `loadSnapshot` 时长；其检查点计数对审阅者可见。

首个 `phase_start` 在成功取得有效样本时以 `unchanged` 表示“已建立本阶段基线”，不声称阶段开始前无外部提交。后续阶段的 `phase_start` 与本 observer 上该同一 GraphStore 最近的有效样本比较，因此 warm-index 造成的本地 generation 前进可分为 `local_only`，并可识别它期间同时发生的外部提交。`lookup_validity` 相对本阶段上一有效 checkpoint 分类；cache 实际命中或失效仍以 cache entry 的 token 比较决定，两者分别记录。每个 `build_after` 必须与该候选自己的 `build_before` 比较，并据此给出 race reason。`after_last_lookup` 比较最近的有效 checkpoint。多次 checkpoint 观察到同一次变化时按多次观察计数，不推算唯一提交数。

因此 T 的有效观察窗口从 `phase_start` 样本开始，到 `after_last_lookup` 样本结束。marker 之后发生的提交不声称被本次观察捕获；SQLite token 不是多表原子快照，也不使 API 读取线性化。未观察到 external/both 只表示该有界窗口中所有规定 checkpoint 都完整且没有检测到这两类变化。

## 记录规则与产品行为隔离

1. 每次进入导航 cache resolver 的 `getEvidence`、`readSource` 调用恰有一个 final lookup decision，表示 cache resolver 的最终 disposition；它不是整个 API 的成功/失败状态。resolver 私下封存该决定，并在 API 调用 settle 时向聚合器发布一次；后续 fresh store read、范围/配置检查或 workspace 检查的错误只能进入工具自己的 API error/语义门，不能重写 cache decision。resolver 启动前失败且没有 candidate 时记 `lookup_error`；store 在 resolver 入口已关闭时记 `store_closed_error`。不得先记 miss 再为同一调用补记 discard。
2. 每个 candidate attempt 恰有一个终态；同一 admission estimator 只调用一次。accepted 字节数取该 estimator 实际用于准入的结果，observer 不 stringify 图、不复制全图、不另算 projection。accepted 统计也包括后来因 build race 丢弃的候选；over-limit 对应 `projection_limit_fallback`；invalid estimator 失败关闭并计 `invalid`，不猜字节数。
3. 空槽或没有目标身份匹配项的成功初建记 `empty_build_installed`；已有匹配项因外部/local/合并 token 变化后重建成功，分别记对应 rebuild。`hit` 只用于可缓存现代快照的 token 全匹配路径。不同 snapshot 身份只表示当前单槽对本次目标为空，不将另一身份的对象当成 hit。
4. 成功构建且 `build_after` 与 `build_before` 可比时，只有 token 未变化才能安装；候选前后观察到变化时不安装，记录相应 race discard decision、candidate `discarded` 和 race reason。after token 不可比较时记 `build_discard_unclassified` / `unclassified`。candidate 已开始但完整加载、投影或 admission 出错时，candidate 保持 `failed`，cache disposition 为 `build_error_fallback`；原路径的成功结果或原错误结果仍照常返回。即使该 candidate 后续 API 部分成功后，`getEvidence` fresh row 读取失败、或 `readSource` 的范围/配置读取失败，已封存的安装决定也不改写。例：成功安装后 fresh evidence row 不存在，decision 保持 `empty_build_installed`、API error 由工具计数；缓存 `hit` 后范围检查失败，decision 保持 `hit`；`transaction_bypass` 后原 `loadSnapshot` 因损坏 payload 失败，decision 保持 `transaction_bypass` 并保留原异常。resolver 前无 candidate 的错误才是 `lookup_error`。GraphStore 在 resolver 入口已关闭时记 `store_closed_error`。
5. `transaction_bypass`、`token_unavailable_bypass`、`invalid_token_bypass`、`legacy_bypass` 不得伪记 hit 或候选安装；均沿既有完整读取/legacy 路径执行。若完整路径失败，原失败返回。legacy 快照永不进入现代缓存。
6. 当前候选构建是同步的，不在 candidate 内引入新的 cancel/await 点；工具取消导致 child 没有终态摘要时，由 3F-T 标为 cancelled/incomplete，不能补造候选终态。API 启动前的请求失败无 candidate；若未来实现想增加 candidate 中途取消点，当前固定 decision union 没有与 `candidateBuilds.cancelled` 一一对应的 final decision，必须先修改并重新接受协议，不能把 cancellation 偷映射为 discard/lookup error。

必须保持已接受缓存候选的语义边界：`getEvidence` 仍 fresh-read GraphStore 证据行；`readSource` 仍 fresh-read snapshot source、当前 ignore settings，并执行路径分类、范围检查和 workspace hash 检查。不得缓存 current 状态、配置或源码，也不得让诊断摘要代替产品校验。任何向调用者返回的 Evidence 都不能是可变缓存引用。

## 3F-T 聚合交叉核验

observer 每阶段向工具提供按 API 划分的 final decision map、候选终态计数、race reason map、每 checkpoint 的 token outcome 计数、coverage 以及 projection admission 汇总；不提供逐调用记录。

工具独立复核以下等式，并在任一项失败时拒绝可比性：

- 每阶段每个 API 的 final decision 计数之和等于该 API 实际调用数；本测量固定为各 1,177。
- `candidateBuilds.attempted = installed + discarded + rejectedByAdmission + failed + cancelled`。
- `installed` 等于 `empty_build_installed` 与三类 rebuild installed 决策数；`discarded` 等于 race reason 四类之和，并等于四类 build-discard 决策数。
- `rejectedByAdmission` 等于 `projection_limit_fallback`；`failed` 等于 `build_error_fallback`。`lookup_error` 只计 resolver 尚未封存任何 cache disposition、且没有启动 candidate 时的错误；已封存 hit/installed/bypass 后发生的 API error 不改写 final lookup decision。
- 每个 candidate 恰有 `build_before`、`build_after`；两阶段 marker 各有一次 `phase_start` 与 `after_last_lookup`；每个 API 恰有一次 `lookup_validity`。所有计数都由对应 checkpoint 的 token outcome map 求和。`build_after` 不再要求 token change 次数与 discard 一律相等：只有因该 token outcome 被丢弃的候选进入 race reason，failed、admission-rejected、cancelled 候选的真实 after outcome 单独保留。
- `evaluatedCount = acceptedCount + overLimitCount + invalidCount`；`invalidCount <= candidateBuilds.failed`，且每个 invalid estimator outcome 都对应一个 failed candidate，不能把全部 failed candidate 算成 invalid。若完整 load 在 estimator 前失败，该候选没有 admission evaluation。over-limit 对应 rejection，accepted byte 汇总直接采用产品 admission estimator 的结果，并满足 `acceptedCount >= installed + discarded`。
- 完整持久化加载数由实际完整 `loadSnapshot` 边界独立计数，不由 observer 决策相减推导；observer 不读取计时 wrapper，不替代该计数。

失败 candidate 与 race after 的 reconciliation 以 `build_after` 检查点单独计算，不能混入 phase start、lookup 或 phase end 的 token 观察。令 `O_x` 为 build_after outcome `x` 的数量，`R_x` 为对应 discarded candidates 的 race reason 数，`V = O_unavailable + O_invalid_type + O_in_transaction + O_closed`；所有式子仅在 build_before/after 事件覆盖完整时求值：

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

完整观察时每个 candidate 恰有一个 before 和一个 after，故 `sum(O) = attempted`。`discarded = sum(R) =` 所有 `build_discard_*` 决策数；安装只允许出现在 after outcome `unchanged`。`Delta` 是没有进入 race discard 的失败、准入拒绝或取消候选中，after 真实变化/不可比较的观测数。缺失事件时覆盖不完整、不能代填；已完整采集但任一上式违例则是协议失败。

边界例子用于核对这些约束：

| 情形 | candidate / build-after 计数 | 结果 |
|---|---|---|
| load 在 admission 前失败，finally 观察到 external | `attempted=failed=1`；`evaluatedCount=0`；`O_external_only=1`、`R_external_only=0`；`Delta=1 <= failed` | 保留 `build_error_fallback` 和 external observation；candidate 不伪装成 discard。优化失败，因为 `failed>0`。 |
| admission 拒绝，同时 finally 观察到 external | `attempted=rejectedByAdmission=1`；`overLimitCount=1`；`O_external_only=1`、`R_external_only=0`；`Delta=1 <= rejectedByAdmission` | 保留 `projection_limit_fallback` 与真实观测；优化失败，因为 `rejectedByAdmission>0`。 |
| candidate installed，随后 fresh evidence row 读取失败 | `attempted=installed=1`；`O_unchanged=1`；lookup decision 保持 `empty_build_installed` | API error 单独计入语义门；observer 不改写为 `lookup_error`，配对按语义/优化失败处理。 |
| 正常 unchanged 安装 | `attempted=installed=1`；`O_unchanged=1`；各 `R=0`、`Delta=0` | 各关系成立；其余门通过、无外部变化且导航 loads `<=2` 时才可能通过优化门。 |
| 可完成 candidate，但 after token 不可比较而拒绝安装 | `attempted=discarded=1`；`R_unclassified=1`、相应 `O_x=1`（`x` 属于四种不可比较状态）；`Delta=0` | 计数关系成立；token 可比较性不足，按 observation-inconclusive 处理。若 candidate 自身 build 失败且 after 不可比较，则 `R_unclassified=0`、`V=1`、`failed=1`、`Delta=1<=failed`，优化仍直接失败。 |

coverage checkpoint 布尔值描述事件是否实际采集；`complete` 描述所需事件均已采集且格式/计数完整，不把 token outcome 本身可比较与否混入 coverage。`unavailable`、`invalid_type`、`in_transaction`、`closed` 或合法的 unclassified race 即使 coverage complete，仍不能通过 token 可比较性门。任何未采集事件标记 coverage 不完整，不补造 outcome。完整采集后若下述计数关系违例，属于协议 `failed`，不能降格为 inconclusive；若计数关系成立但 token classification 不足，才允许按 T 的 observation-inconclusive 路径拒绝性能比较。failed、rejected、cancelled candidate 非零也直接使优化失败，即使 fallback API 返回语义正确。

所有 checkpoint 覆盖不足、非 enabled/不匹配版本、存在 external/both change，或无法分类状态时，性能结论分别按同步修订后的 T 协议拒绝；没有 external miss 或完整加载数较少不能覆盖这些情况。

## 后续实现文件、风险与完成门

待单独派发且 S5 集成后，预计最小产品/回归范围为：

- `packages/application/src/index.ts`：单槽导航上下文、final decision/candidate 归集、pull-only scope、显式 phase marker 与关闭清理。
- `packages/graph/src/index.ts`：同连接 token 状态、本地 generation、closed/transaction/error 判定。
- `packages/application/src/index.test.ts`、`packages/graph/src/index.test.ts`：决策、coverage、marker 与 token 生命周期回归；如 alias/不可变性覆盖更适合放在 `packages/graph/src/snapshot-immutability.test.ts`，实现任务按实际现状确认。

不改 contracts/shared、IPC/preload、UI、ownership、数据库 schema/migration、依赖、native 层或 3E/3F-T 工具文件。未来实现若发现必须超出此清单，应先停下提交新范围供协调方判断，不以 observer 设计自动授权扩展。

必要风险门包括：同连接与同 store 身份约束；`data_version` 只表示外部已提交变化；活动事务、坏类型、读错误和 close 明确不可比较；本地 generation 不溢出复用；首次 build 和重建 race 不安装半槽；A→B→A、不同 store 实例及重叠 `readSource` 不跨身份污染；candidate 计数在 API 成功、失败、close 和 admission 失败下仍可核算；observer 不持有/泄露缓存对象；phase probe 不加载快照或触碰配置；所有 `getEvidence` 与 `readSource` 的原失败/新鲜读取语义保持。

完成 observer 实现前至少要通过：disabled 与 enabled 的结果/错误等价检查；GraphStore token 类型、事务、close、外部提交/local save 及 generation 溢出单测；两个 API 的全 decision 与 candidate/admission 矩阵；受控第二连接在 build 前后提交的 discard/分类回归；legacy、损坏 payload、missing snapshot、错误 evidence、超限/invalid estimator 和 store close 的失败关闭回归；`readSource` 当前配置及 workspace 检查仍 fresh 的回归；并发异步 API 的 phase attribution；精确聚合等式与摘要副本隔离；phase markers 仅产生两次明确 token probe、零 `loadSnapshot`/其他 SQL，并严格位于 API 计时之外。实际命令和结果须写入该实现轮次的 development-run。后续 3F-T 工具仍需独立实现与验收。

## 限制

本稿只基于指定提交中的只读源码、当前可见 AGENTS 规则、3F-T 本批修订稿和已接受的缓存候选文档。未实现 GraphStore token、Application cache 或 observer；未运行回归、构建、索引、Electron 或 benchmark。S5 后源码、最终接口可用性、事件 coverage、实际 token 行为及性能效果都尚未验证。本稿不是产品性能结论，也不是后续实现授权。
