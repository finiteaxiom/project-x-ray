# 3F-T2：导航优化测量工具实施

2026-10-03；协调方实施计划。依赖 C2 后台缓存/observer 独立接受并稳定进入主 checkout 后才派原 Luna；本计划不授权扩大产品能力或修改旧基线。

依赖已达：C2三文件已接受并精确提交db0630edcf82dfab25478b1b156ca2f98c232717，源码hash保持下述值。协调方回归窗口已结束，T2待本计划进入Git后派原Luna；正式medium测量窗口尚未开启。

## 目标、依据与优先级

既有 v1 child 在 getEvidence/readSource 内包装真实 GraphStore.loadSnapshot，makeDiagnosticSummary 的计量门要求原两轮 4,708 次完整加载。C2 引入导航单槽，原 v1 汇总不能被静默改成新门。已接受 O/T 设计规定独立 v2 前缀、schema、完整语义门与真实 observer，现 C2 openNavigationCacheObservationV1 提供固定聚合和阶段边界；T2 接上这一端口形成用户可运行的本地诊断 CLI，随后由协调方正式三配对实测。优先级为收敛已测重复解析瓶颈的验证缺口，不增加产品接口。

依据源码：benchmarks/local-index-navigation-diagnostic.ts 的严格解析/受控进程与资源界限；对应 child 的实际 store 包装、完整导航和 compareSnapshotPair；local-index-baseline.ts 的公开帮助函数；application/index.ts 的可选观察 facade。遵循 2026-10-02-snapshot-navigation-measurement-protocol.md 与 2026-10-03-navigation-cache-observer.md 的已接受全文，不能以本实施摘要替代细节。

## 文件与依赖边界

原“开发”聊天只在主 checkout 新增三工具文件及一过程记录：

- benchmarks/local-index-navigation-optimized.ts
- benchmarks/local-index-navigation-optimized-child.ts
- benchmarks/local-index-navigation-optimized.test.ts
- docs/development-runs/2026-10-03-navigation-optimized-tool.md

只读复用固定样例、公开 baseline 帮助函数及应用 observer 类型/方法。不得改 application、graph、contracts、desktop/UI、native、依赖、AGENTS、既有工具、旧测试、fixture、报告或公共协调文件；协调方维护公共状态。确需越界报告具体依据。无新的诊断私有状态钩子，不访问 cache/token 私有字段，不从 load 次数推导 hit 或另造投影 estimator。

开工核对实际 Git 与已有 root 记录补记，保留全部未提交改动。C2 接口源 hash 应为 855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18。v1 冻结：parent BBBF0DF0A13BE491F14415857CA8EFAFF60BDC33A735D3BDB1DC5363652BB62C；child E2DA20D6CF5637D09F72881F685CCAB8DD2DA0CF56D635710B329F51CAC09EFC；test EDBEB473016EDF5C55BD274F69640418349EAD3029A6AE21EAF0BFEE8046429D；baseline C650BC41FCFB02772CB402AC139821A164483338DA901F083B14165725941449；samples 51FB7E794D4C80AFF50A7307629C05ADA2FD8EBF8FC3524FA531F0CE70ADEEB0。哈希是本轮实际读取的边界证据，不是未来漂移豁免。

## 完成门与运行窗口

### 2026-10-03 严格类型门修正边界

协调方独立对既有 `benchmarks/local-index-baseline.ts` 运行严格 TypeScript 检查，确认第759行调用中 `signal: AbortSignal | undefined` 显式赋给 `signal?: AbortSignal`，违反 `exactOptionalPropertyTypes`，TS2379。这是一处既有帮助函数的类型缺陷，T2只读复用将其带入完整检查；关闭该选项只作为诊断，不能作为通过。

批准协调方单独仅修改这一调用：缺省signal时省略该属性，有signal时原样传递。不改变受控进程、取消、协议、样例或计量语义，不放宽类型或断言。Luna仍仅写上述四新文件；旧v1三文件、fixture、报告继续冻结。完成门为同一严格命令通过、baseline及samples与原v1工具回归通过、实际差异仅这一处行为等价修正。修正后的帮助函数hash由协调方复验记录并通知Luna，不以旧hash阻止已审查修正。记录见 `docs/development-runs/2026-10-03-baseline-signal-type-fix.md`；无新增工程经验规则。

### 2026-10-03 首版独立验收反馈

root确认首版冻结hash、22项回归、完整严格类型与正常实际CLI通过，但真实medium child的三项受控错响应仍被误报为11门true/optimization passed：错误源码内容但保留声明hash、相同filePath但错误targetSpan行号、相同ID但错误source.evidence范围。child.resolveNavigation只比声明hash和部分ID/filePath，未核实际完整结果，冷/暖一致错误不能证明正确。复现见 `docs/development-runs/2026-10-03-navigation-optimized-independent-review.md`。

原Luna继续同四文件修正完整响应核验，允许在现有新文件内提取共用纯核验函数并加入定向反例回归，不变更v1/application/contracts/fixture。核验固定样例和当前snapshot真实期望的归属/文件/语言/完整证据、精确行列/目标范围及实际content重算hash；保持原11门与全部1177/4708、顺序、计量域和隐私限制，错响应必须semantic failure且不可比较。修正重新冻结后由root独立重跑真实反例，再安排challenge及正式三配对。首版计数≤2不作为性能接受证据，原正常单对不替代三对。

使用 schemaVersion 2 与 XRAY_NAVIGATION_OPTIMIZED_V2:，严格 exact-key 校验 child/summary/report。固定 medium128，每阶段两 API 各完整 1,177 次，单配对两阶段共 4,708 次调用；保留全部响应/source/span/hash/归属/顺序和原 11 语义门。只计实际导航 full-load，索引/current/replay/gate 另计。完整可比且无 external/both 的两轮 full-load 合计 ≤2；不通过平均数、抽样、漏调用或更改 v1 达门。

begin/end 在导航 wall/API 计时外，使用真实 scope 聚合。保留候选唯一终态、封存 resolver 决定、O/R/Delta 与 admission 全关系，以及 failure 优先级：完整关系违例、语义失败或 failed/rejected/cancelled 非零均 failed；只有其余门成立且确实缺覆盖/可比较分类才观测不足；完整 external/both 为外部变化不可比较，不能抹去。真实聚合不证明逐 candidate 绑定，产品 C2 回归负责该门。

受控第二连接 commit challenge 在工具自有临时库操作，不改 graph payload、current、createdAt 或 ignore 配置；按实际 schema 选择写点并说明，确认下一 lookup 安全 reload 和原 11 门。首建/重建/末次返回前变化要有针对性覆盖。challenge 单独于计时配对，零计入 4,708 分母/性能汇总。不得执行导入样例代码、安装或仓库命令。

保留 1–3 pairs、5,000–180,000ms、1,000ms stop grace（上限2,000）、4,000ms shutdown reserve、2,000 evidence、64KiB 行/256KiB 协议/2,048行/256KiB报告；所有出口恢复 wrapper，取消/超时升级终止后等待 child close，剩余 pair not_started。唯一受管目录和独占报告写入；报告仅安全枚举/计数/有界指标，绝无 token、源码/路径/ID/hash。heap 不称缓存净内存，inclusive 子时长不加和。

Luna 可运行三新文件的普通 Node 协议/计数/边界/受控 child 生命周期回归及原 v1 工具测试，不启动正式 medium benchmark、native/build/dist/Electron 或 GUI。若真实 child 运行是开发验证所必需，先报告具体命令，由协调方安排单窗口；不可用假帧替代真实端到端验收。冻结四文件、实际命令/失败诊断/修正和 hash 后，协调方独立审查，运行实际 CLI、cancel/timeout、安全 challenge，并在单次 --pairs 3 中核对正式门、每对原始值及 median/min/max。未取得三个有效配对不称优化验收通过；即使计数达标但 wall/heap无改善，也原样报告。无 Git 自行收尾，无签名/发布/远程或GUI授权。经验候选留过程记录，公共 AGENTS 由协调方证据查重决定，允许0条。
