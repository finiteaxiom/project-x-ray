# 2026-10-03 3F-O 导航缓存 observer 设计记录

## 目标与范围

为未来的只读导航缓存诊断设计一个有版本号的 observer seam，供 3F-T 使用。最初授权只新增本记录和 [`3F-O 设计计划`](../plans/2026-10-03-navigation-cache-observer.md)；协调方后续明确批准把最小修订扩为 O/T 两份计划和各自 development-run 共四份文档。不实现缓存、token、observer 或工具，不修改 AGENTS、协调文档、依赖或 fixture，也不读取/改动 S5 活跃源码。

## 基线与只读检查

- 开始只读核对时的 `HEAD`：`d6fb625af97826c7238d78f075e361b5dad30946`。
- 源码设计基线：`133686217903e854e24dbdc76af9203cf3e1fd23`，使用 `git show <sha>:<path>` 检查，没有将活动 S5 源码当作基线。
- 开始检查时工作区有一项既有未提交修改：`docs/development-runs/2026-10-01-v1-long-development-review.md`。保留原样。
- 核对了 `AGENTS.md` Git、工程经验、完成定义相关段落（134-204 行）。规则要求保留用户变更、记 development-run、区分已验证与未验证，并只沉淀有代码或复现实验依据的一般经验。
- 基线源码只读检查：`packages/application/src/index.ts` 中 `requireSnapshot`（218-229）、`getEvidence`（260-263）、`readSource`（360-375）及 `close`（378）；`packages/graph/src/index.ts` 中构造（39-53）、`saveSnapshot`（254-308）、`loadSnapshot`（323-325）和 close。检查了基线 Git tree 中 Application/GraphStore 的测试文件名，没有打开或运行测试。
- 读取已接受且冻结的 `docs/plans/2026-10-02-snapshot-navigation-measurement-protocol.md` 与 `docs/plans/2026-10-02-snapshot-navigation-performance.md`，只用于对齐 observer 的聚合字段、token 语义和等待顺序；没有修改它们。
- 工作期间的历史状态先后经过 `06396e7a35947303965f862f46be8be77180080e`；本次四文档同步修订终态核对的主 checkout `HEAD` 为 `85a68e16b8b194677ae8d7bc28ff73f68ef5d5d1`。`06396e7...` 仅作为中间历史状态，不是当前基线。本轮没有执行 Git 写操作。
- 本次最终状态核对时，两项既有 tracked 文档修改仍为 `docs/development-runs/2026-10-01-overnight-handoff.md` 与 `docs/development-runs/2026-10-01-v1-long-development-review.md`；本轮未触碰。四个目标文档包含两项 O 新文件和两项 T 文档修订，目标集合之外的既有改动予以保留。

## 观察与设计判断

**基线事实：** 指定提交中的 `requireSnapshot` 每次完整调用 `GraphStore.loadSnapshot`；该基线 GraphStore 没有 navigation cache validity token、local generation 或 observer API。`saveSnapshot` 使用立即事务；当前缓存候选是规划，不是实现。

**方案：** 为每个 Application 提供显式启用的 v1 pull-only scope。scope 只输出固定 enum 与有界聚合数字；拒绝 callback，避免 throw、重入和产品对象别名。Application 复用 cache 产品本身的 lookup/build token 样本来统计决策；只在 `phase_start` 和 `after_last_lookup` 做显式边界 token probe，两次 probe 均进入 checkpoint 计数、在导航 API/wall 计时之外，且不触发快照/配置 SQL。原始 token 仅在 GraphStore 与 Application 内部比较，永不进入摘要。

**初稿协议核对：** 初始 O 稿沿用了 3F-T 当时的最终 decision、race、token outcome、checkpoint、admission 和 count 交叉核验；报告无 observer/版本不符/coverage 丢失/无法分类时拒绝可比性，不从 full-load 次数推命中。candidate 中途取消与当时 final decision union 不匹配，因此当前设计不添加 candidate 内取消点；若未来需要，先修订并重新接受协议。

**协作边界：** S5 将更改 Application 源码和 ownership export；observer/cache 实施须等 S5 集成稳定后重读源码和 Git 基线。本设计没有打开活动 S5 文件。3F-T 工具继续等待 observer 实现并冻结。

## 协调方审查修订

协调方首次复核提出三处需要明确的协议接缝，O 初稿随后作相应澄清：

1. final lookup decision 定义为 cache resolver 的 disposition，不是 API 成功状态。resolver 私下封存，并在 API settle 时只发布一次；candidate installed 后 fresh evidence row 读取失败仍记 installed，hit 后 `readSource` 范围/配置检查失败仍记 hit，bypass 后原 `loadSnapshot` 失败仍记 bypass。真实 API 错误由工具现有 errors/语义门另计，原返回或异常不变；resolver 在封存 disposition 前失败且没有 candidate 才记 `lookup_error`，store 在 resolver 入口已关闭则记 `store_closed_error`。
2. 每个开始的 candidate 都由产品缓存路径在共同 `finally` 收尾点尝试 `build_after`，observer disabled 时也走相同产品路径。保留失败 candidate 的 `failed` / `build_error_fallback`，不覆盖主错误；若 finally token 真正观察到 external/local/both 变化，如实保留 outcome，不改造成 race discard。冻结 T 同时要求这类 build_after 变化数与 discard/race reason 相等，因此此失败分支不能满足该等式：checkpoint 有实际样本，但跨字段 coverage 标记为不完整；不能声称优化通过。语义门失败仍按 T 报告 failed；语义门通过但跨字段不一致时建议走 `inconclusive_external_observation`。如果 T 规定外部写入与 observer 一致性失败同时发生时的 inconclusive 子类优先级，留协调方裁定。严格 validator 若不接受已采集事件但跨字段 coverage 不完整的报告，最小待决项是协调方是否另行修订 T 的 failed-candidate build_after 等式。T 未修改。
3. estimator invalid 是 candidate failed 的子集；`invalidCount <= failed`。完整 load 在 estimator 前失败会有 failed candidate，但无 admission evaluation。约束写为 `evaluatedCount = acceptedCount + overLimitCount + invalidCount`；不把所有 failed 都算成 invalid。

以上首轮仅修订 O 两稿，没有新增运行证据。协调方之后确认 failed candidate 的 finally `build_after` 与 race discard 等式是 O/T 的真实计数域冲突，并批准四文档范围做最小同步修订，见下节。

## 2026-10-03 协调方批准的 O/T 同步修订

协调方批准同时修改 O/T 计划及各自 development-run。O observer decision 定义为 cache resolver disposition；API settle 时只发布已封存决定。后续 fresh row/source/config/workspace 错误由工具的 API error 与 11 项语义门记录，不重写 hit/installed/bypass。candidate 失败时产品路径共同 `finally` 仍采集真实 `build_after`，observer 开关不改变采样；失败终态、主 API 错误和 token outcome 均按事实保留。

本次按 T 新增的 O/R reconciliation 逐项核算：

- failed-before-estimator + external：`failed=1`、`evaluatedCount=0`、`O_external=1`、`R_external=0`，`Delta=1<=failed`；保留失败和 external outcome。
- rejected + external：`rejectedByAdmission=1`、`overLimitCount=1`、`O_external=1`、`R_external=0`，`Delta=1<=rejectedByAdmission`；保留拒绝和 external outcome，优化门失败。
- installed 后 fresh row 失败：`installed=1`、`O_unchanged=1`，lookup decision 保持 installed；API error 另计，语义门失败。
- 正常 unchanged install：`installed=1`、`O_unchanged=1`、`R=0`、`Delta=0`；关系成立。
- unclassified discard：`R_unclassified=1`，对应 `O_unavailable/invalid_type/in_transaction/closed` 总量至少 1；`Delta=0`，计数关系成立，但 token 不可比较。failed candidate 的 unclassified after 则 `R_unclassified=0`、`V=1`、`failed=1`、`Delta=1<=failed`，由 nonzero failed 优先级直接判失败。

五类例子均满足修订后的关系；没有发现需放宽不等式或伪造分类的反例。T 文档另明确关系违例为协议失败，candidate failed/rejected/cancelled 非零即使 fallback API 语义正确也使优化门失败；只有采集/分类不足且其余协议与 11 门完整通过时才为 observation-inconclusive；覆盖不足优先于 external-write inconclusive。3F-T 保持 schema 字段、4,708 分母、每 API 1,177、`≤2` 门、11 项 gates、3 个同调用配对及限额不变。

## 修改

初稿阶段新增、经本次批准后四文档修订范围为：

- `docs/plans/2026-10-03-navigation-cache-observer.md`
- `docs/development-runs/2026-10-03-navigation-cache-observer-design.md`
- `docs/plans/2026-10-02-snapshot-navigation-measurement-protocol.md`
- `docs/development-runs/2026-10-02-snapshot-navigation-measurement-protocol-design.md`

O 两份文件按初稿新增；T 两份文件在明确授权后同步修订。本轮没有改写、删除或移动其他既有文件，没有改 `AGENTS.md`。

## 验证与未验证项

- 只读核验：开始与结束时的 `git rev-parse HEAD`、`git status --short`、指定提交的 `git show` 片段、基线 `git ls-tree` 文件名、AGENTS 相关段落及既有设计文档。初稿阶段中间核对时 HEAD 曾为 `06396e7a35947303965f862f46be8be77180080e`；四文档同步修订后的终态另见下一条。本轮没有提交、推送或改写 Git 历史。
- 初稿阶段只复核 O 两份文档；经后续授权后复核四份文档的关系式及边界例子，并计算四文件 SHA-256、只读核对 Git 状态。终态主 checkout `HEAD` 为 `85a68e16b8b194677ae8d7bc28ff73f68ef5d5d1`；协调方报告 S5 已在 `18b6cbb` 接受，C1 GraphStore 三文件仍冻结在 Sol worktree 等待验收，本轮未查看这些活动源码。没有运行测试、构建、索引、native/dist、Electron 或 benchmark。
- 尚未验证：S5 集成后的实际源码/接口；任何 observer/cache/token 实现；token 类型和事务行为的运行结果；phase coverage/聚合等式；实际缓存收益。
- 没有发生实现失败、测试失败或环境故障；本轮是设计与只读源码核查，不编造失败闭环。

## 工程经验判断

本轮无新增或修订 AGENTS 规则。原因：只有设计判断，没有新增代码或复现实验可证明一条可泛化的工程经验；现有证据契约、只读边界与过程记录规则已覆盖本轮约束。本记录不代表 observer 或性能验收完成。

协调方2026-10-03 17:20补记：四文件最终hash与交付一致，复审当前S5源码、已集成C1及原3F依据后接受O/T修订设计，详细关系/边界见独立审查最新节。设计本身新增经验0，不能当作observer或收益通过；C2另形成三文件实施计划，工具仍等待稳定端口。
