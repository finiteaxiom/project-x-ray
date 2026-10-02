# 2026-10-02 导航性能诊断设计记录

## 目标

依照 3D-L 仅设计授权，基于当前 application、GraphStore、安全源码读取实现及 3C-L 已接受的 medium128 报告，形成一个后续可实现的有界导航耗时诊断提案。不得复跑已接受的 3C/2B-S1，不改产品实现、契约、依赖、缓存、AGENTS.md、冻结基准文件或协调记录。

## 基线与检查

- 当前主 checkout HEAD 为 1d7d66c7e4d8accd6f3c23c840256b41dcb87271。按继续任务要求只读核对版本和未提交状态；状态为空。未执行提交、切换或其他 Git 收尾。
- 两个授权目标文件开始时均不存在；仅新增 docs/plans/2026-10-02-navigation-performance-diagnostic.md 与本记录。
- 既有 3C 报告中，small 成功样例为 3 文件、15 节点、33 边、28 证据；medium 报告为固定 generator v1、13,518 字节、128 文件（96 TypeScript、32 Python）、387 节点、1,275 边、1,177 证据。单对和双对三轮 child wall 为 48.870、42.259、47.585 秒；cold/warm index 为 2.618/2.530、2.004/2.143、2.457/2.324 秒。三轮全通过原 11 门且导航完整。样例 run id：small fd9ba26c-b173-40c3-be4f-332bf4b41a7d；medium 单对 cd152778-cfd0-4b1e-80ae-e13f8331bc61；medium 双对 2c6a4c5d-9d26-41ed-b641-40cdf07ccd1c。
- 3C 报告当前已有 schema 包含 schemaVersion、status、requestedRuns、timeoutMs、validPairCount、sample、environment、runs、limitations；run 包含 status/code/exitCode/signal/childClosed/forcedTermination/durationMs/progress/summary；summary 有 runtime、snapshot、measurements、navigation、pairEvidence、gates。没有 navigation 分段时长、逐类存储计时或调用分布。本记录沿用既有已接受运行，不新启 child 或重新抽取样例。
- 取消样例 fd52c807-2702-48d7-b850-ca477ddebf6b 的 cooperative close、exit 0、childClosed=true、forcedTermination=false、protocolError 为空，来自委派方的 3C-L 验收说明。既有运行目录没有可读 report.json，因此没有把这些字段表述为本轮重新核实的本地报告内容。

## 源码核对

- packages/application/src/index.ts：requireSnapshot 约第 218–228 行每次恢复完整快照；getEvidence 约第 260 行随后查单条证据；readSource 约第 347–360 行随后读存档源码、在线性 evidence 数组中按 ID 查找、校验范围和排除策略、读取忽略设置，并在路径允许时调用 readProjectFile 和内容指纹。
- packages/graph/src/index.ts：私有 parseStoredSnapshot 约第 22 行执行 JSON 与 schema 解析；GraphStore.loadSnapshot 约第 320–322 行在单个公开操作中包含 SQL 查询和该解析；getEvidence 约第 419–421 行含 SQL 与 JSON 解析；loadIgnoreSettings 约第 212–217 行含 SQL 与 JSON/schema；readSnapshotSource 约第 527–529 行读取保存源码。没有产品代码测量私有解析的 hook，因此设计只允许给公开操作加 inclusive 包装。
- packages/analyzer-core/src/index.ts：readProjectFile 约第 135–142 行建立安全读 scope、检查 containment、执行 secured read 并在 finally 关闭。当前 readSource 不向它传入 signal，故无法用应用级 AbortSignal 立即中断正在运行的一次读。
- benchmarks/local-index-baseline-child.ts：resolveNavigation 约第 154–184 行检查节点引用后逐条证据串行调用 getEvidence/readSource；child 约第 264–266 行冷暖阶段各执行一次完整导航；报告当前仅输出导航计数与哈希，不输出耗时分项。

## 结果与限制

已新增诊断设计及本过程记录，说明了证据/推测边界、计时嵌套与不可相加口径、固定 1177 证据门、单独安全读取回放的限制、边界与取消策略、未来最小三个 benchmark 文件及其验证门。38–44 秒仅是 child wall 减去两个现有 index 测量后的未分配算术余量，未标记为导航时间；快照重复解析等仅作为需要实测的候选。

验证为只读文档检查：只使用 rg、PowerShell 内容读取及上述所需的 Git 只读状态查询。未运行任何 benchmark、产品测试、build、native、dist、Electron 或用户源码读取；本轮无实现闭环或性能结论。代码行号是设计记录时核对的当前源码位置，后续实现前需再次核对。无测试失败；是否接受设计、wrapper 开销及真实分项耗时仍未知。

## AGENTS.md 评估

本轮不新增或修订工程规则。诊断提案和一次已接受的 fixture 测量不构成新的可复用实现经验；既有规则已要求性能结论有证据，当前记录已经保留边界和验证步骤。
