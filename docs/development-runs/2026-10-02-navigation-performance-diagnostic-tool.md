# 本地索引导航性能诊断工具

日期：2026-10-02  
任务：实现固定 medium128 样例的冷/热导航诊断 CLI，为后续独立执行提供有界、可审计的阶段与存储计时。

## 目标与边界

- 本轮只新增 `benchmarks/local-index-navigation-diagnostic.ts`、`benchmarks/local-index-navigation-diagnostic-child.ts`、`benchmarks/local-index-navigation-diagnostic.test.ts` 和本记录。
- 样例固定为 medium128：128 个生成文件、每轮冷/热导航各处理完整 1,177 条证据；保留快照等价门禁，并检查样例清单、健康状态和导航完整性。
- 限制为 1–3 对、总时间最多 180 秒、协议/报告有界；报告写入独占的本地运行目录。CLI 不接受样例路径或任意项目路径。
- 不改产品行为、冻结的基准实现、包配置、3D 设计记录或 `AGENTS.md`。生成样例只供本地应用索引；本轮没有运行它或任何导入仓库代码。
- 按协调安排，本轮不运行真实索引、原生构建、仓库构建、dist 或 Electron；实际 medium CLI 与门禁结果留给协调方在 S2a 检查结束后执行。

## 实现

父进程 CLI 固定 Windows 运行，校验参数并在现有基准工具提供的唯一运行根目录下创建 UUID 子目录，以 `wx` 独占写入有大小上限的报告。子进程协议使用固定前缀、严格消息键、行数和字节上限，以及枚举化终态码；报告只保留聚合计时、固定诊断码和有限运行元数据，不包含源码、文件路径、证据 ID、快照哈希或任意异常文本。

子进程生成既有 medium 样例并通过公开 application / GraphStore API 执行冷索引、完整冷导航、热 no-op 索引及完整热导航。它复用现有快照比较门禁语义，并要求预期源码清单、两份快照健康且 1,177 条证据均可导航。公开 GraphStore 方法按阶段和 API 来源统计包含下游工作的总耗时；它们与外层 API/导航计时是嵌套口径，报告不把这些数值相加。安全读取重放单列为 `secureReadReplay`，只报告调用聚合和字节数，不冒充 `readSource` 的内部耗时。

每个子进程只在自身生命周期内暂时包装应用及公开 GraphStore 方法，并在正常、错误、取消和关闭路径恢复原属性描述符。取消先通知子进程协作退出，等待有界宽限；超时则终止其 Windows 进程树，并始终等待 `close` 后才返回。宽限参数限制在 1–2,000 毫秒内。纯测试用 Node toy child 覆盖协议错误、协作退出及强制终止；不加载索引器或 native reader。

## 实现反馈与验证

- 首轮严格类型检查发现新代码的未知值收窄和类型表达问题，修正后目标检查通过。
- 首轮门禁结构测试有两项失败：新增 `gateEvaluation` 阶段后，父进程固定阶段校验列表遗漏该字段。将该阶段纳入严格报告契约后，相关测试通过。这是诊断器校验结构不完整，已在本轮修复。
- 最终纯回归：

  ```text
  pnpm exec vitest run benchmarks/local-index-navigation-diagnostic.test.ts
  1 个测试文件，10 项通过
  ```

- 最终目标严格类型检查（启用 `strict` 与 `noUncheckedIndexedAccess`）：

  ```text
  pnpm exec tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2023 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --types node --esModuleInterop --skipLibCheck benchmarks/local-index-navigation-diagnostic.ts benchmarks/local-index-navigation-diagnostic-child.ts benchmarks/local-index-navigation-diagnostic.test.ts
  退出码 0
  ```

- 另一次开启 `exactOptionalPropertyTypes` 的探索性检查被未修改的 `benchmarks/local-index-baseline.ts:759` 阻断：该既有代码将 `AbortSignal | undefined` 传给可选 `signal` 属性。本轮未改基准文件；这不影响上述目标检查结果。
- 没有实际启动本诊断 CLI，因此 medium 样例的索引耗时、11 项门禁通过情况、报告写入及整轮 180 秒上限尚未在本轮实测。也没有运行仓库全量回归、构建、原生构建、dist 或 Electron。

## 规则沉淀判断

没有更新 `AGENTS.md`，本轮无新增工程规则。已确认的测试失败来自本次新增报告阶段未同步校验，修复后纯回归覆盖充分；没有发现尚未被现有规则涵盖、且值得推广的产品或安全缺陷。实际性能数据与独立验收仍待协调方运行 CLI 后判断。

## 修改范围

- `benchmarks/local-index-navigation-diagnostic.ts`
- `benchmarks/local-index-navigation-diagnostic-child.ts`
- `benchmarks/local-index-navigation-diagnostic.test.ts`
- `docs/development-runs/2026-10-02-navigation-performance-diagnostic-tool.md`

没有提交或运行真实索引。工作区内原有计划、3D 设计产物及其他并行修改均保持原状。

## 2026-10-02协调方独立验收

上述开发记录不等于验收。root对冻结四文件完整源码及原10项测试核对；已独立运行10/10纯测试与三ts目标strict/noUncheckedIndexedAccess类型检查exit0（未启用额外exactOptionalPropertyTypes，旧baseline约束详见审查记录）。临时wrapper只在独立child内，finally恢复原descriptor；安全读取回放与产品内I/O明确分离，GraphStore计时为inclusive SQL/解析整体，报告不含原始源码、路径、证据/内容hash或任意错误。

原CLI `node --import tsx benchmarks/local-index-navigation-diagnostic.ts --pairs 1 --timeout-ms 180000` exit0，run `073ece06-40d5-43e7-8fc5-e27433c1323e`。固定medium128文件/13518字节，387节点/1275边/1177证据/unknown0；原11门全true，cold/warm各1177 getEvidence/readSource成功且全部解析，错误0。独立读取唯一自有report.json，60323字节、status completed、有效对1、child close且无强杀。

child wall26.661s；setup0.099s、cold/warm index1.453/1.202s，cold/warm navigation10.937/11.020s，独立secure replay0.791s/1177次/127175累计读取字节，gate0.303s、close0.015s。cold getEvidence API4.460s其中loadSnapshot1177次4.363s；readSource API6.326s其中loadSnapshot1177次4.360s。warm对应loadSnapshot4.400/4.368s。每次API与其内部store都嵌套，不能相加到navigation wall；loadSnapshot包含SQL读与规范化解析，未拆私人parse。独立回放不等于readSource内部I/O。单次自建样例、不代表真实项目/跨机器性能，未实施缓存或增量加速。

ignored独立 `.benchmarks/remote-desktop-review-20261002/navigation-diagnostic-cancel.ts` 实际调用新父入口与真实索引child，2.5秒取消：exit0断言通过，run `920c77c4-d8de-4a76-b462-518427e4132c`，首轮cold阅读128/分析128/验证129/持久化1后取消，child2.547s closed、无强杀、有效对0；第二轮not_started/CANCELLED_BEFORE_START，磁盘report与返回对象完全相等。属于技术API/child取消，不是GUI点击取消。

原CLI最小时限 `--pairs 1 --timeout-ms 5000` exit1为预期失败关闭：run `625100da-d23d-4cca-9733-b785c865f588`，status timed_out/TOTAL_TIMEOUT、有效对0、child close且无强杀，实际分析128之后受剩余child预算取消，1.303s退出。未把失败结果列为有效采样。纯测试另覆盖不合作child的Windows强制终止及close。

独立接受该本地工具切片；真实GUI、性能优化和模型不属本工具结果。已派3F-L两文档性能候选设计；AGENTS新增0，时长只在过程记录，不沉淀为通用规则。实际Git版本另由协调记录登记。
