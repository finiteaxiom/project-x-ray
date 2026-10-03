# 3F-C2：应用导航单槽缓存与可选观察端口

状态：2026-10-03 18:07 后台独立接受，主目录精确集成/适用回归及真实SQLite探针通过，三文件提交 db0630edcf82dfab25478b1b156ca2f98c232717；未验GUI/正式性能。原方案保留为实施依据，下一批按独立T2计划推进。

2026-10-03；协调方可审查的后续实施计划。只涉及 Windows/V1 已有 getEvidence/readSource 导航，先验收 C1 及 O/T 修订，再向原 Sol 聊天派发。真实 GUI 暂缓，不将源码回归当界面或性能收益验收。

## 依据、目标和优先级

已接受的 3F 性能方案基于 medium128 两轮 4,708 次完整 loadSnapshot；这仍是历史合成样例，不能推断真实项目收益。实际 main 85a68e1 的 application requireSnapshot 每次全量加载；getEvidence 随后 fresh-read evidence 行，readSource 随后 fresh-read source/settings 并验证范围和 workspace hash。S5 已集成且对应源码与 Sol 保留版本对齐。C1 同连接取样三文件经 root 实际 98 项、真实双连接探针及两包 noEmit 复验后精确复制 main；C1 不安装缓存。O/T 四文档修订允许失败 candidate 的真实 after observation 与 race discard 分离，并保持原计量门。

本批优先消除两个导航 API 的重复快照解析，同时保留损坏、外部提交、身份、配置及源码校验。单槽和观察接口一起形成稳定可测的后台切片；之后才让 Luna 实施 v2 工具，最后由 root 同调用三配对实测。没有 UI、IPC、远程调用或新产品功能。

## 文件与依赖边界

Sol 只在其原 worktree 修改三文件：

- packages/application/src/index.ts：导航专用 resolver、单槽私有投影、窄内部观察 API/类型及关闭清理。
- packages/application/src/navigation-cache.test.ts：新增定向真实 SQLite/Application 回归，复用现有公开行为并保留原测试。
- docs/development-runs/2026-10-03-navigation-cache-application.md：实际反馈闭环、失败分类、命令、冻结 hash、未验收边界和规则候选。

开工核对 application/index.ts 与 main 已接受 S5 版本逐字一致；C1 两 graph 源与 main 已集成版本一致。不得 reset/整体合并、重做 S5/C1 或同步整份 AGENTS。无第三方依赖、迁移、GraphStore 修改、contracts/shared/ownership、desktop/UI/native、benchmark 或旧记录改动。若主测试新增必要断言可以在新测试中表达，无需改原 index.test.ts。AGENTS 冻结，经验由 root 判断。确需越界先报告具体源码依据。

## 产品行为

其他用例仍走原 requireSnapshot；只替换 getEvidence/readSource 所需导航上下文。保留原 store 选择、懒打开与 legacy fallback 语义，不顺带修正或重构其他查询。缓存仅含同一 GraphStore 实例、repository/snapshot 身份、rootPath、私有 evidence 索引和 C1 样本，不含全图 nodes/edges、源码、配置、current 或工作区状态。缓存仅由完整 loadSnapshot 校验后的现代快照构造；legacy 绕行不安装、不回写。单槽以实例及完整身份共同匹配；换身份/实例清旧槽，A→B→A 不借旧项。

只在同步、事务外取样段命中/构建。C1 非 valid 样本清槽并按原完整读取/失败语义继续；关闭不能返回缓存成功。每个 candidate 以同一连接 before/load/projection/admission/after 完成；所有 candidate 在共同 finally 尝试 after 样本，observer enabled/disabled 完全相同。仅完整成功、身份正确、前后 valid 且相等、准入成功时一次安装；race/异常/坏样本不得留半槽。fallback 使用本次完整读取已得到的有效结果，不为诊断再全量加载；原读取错误保持。token 不是跨表/文件系统原子屏障，下一请求再检查。

采用单一实际投影字节 estimator，固定 4 MiB，逐项累积并超限停止，不为 observer 再 stringify/复制全图；预算不是实际 heap。invalid estimator 失败关闭，不造 bytes，不保留半投影。API 返回 Evidence 必须独立捕获/克隆，不泄露私有索引；readSource 在 await 前捕获本请求上下文，迟到 continuation 不重取当前槽。

getEvidence 仍读取 GraphStore 当前 evidence 行；readSource 仍读取保存源码、当前 settings、路径分类、准确行列范围、空文件精确证据和 workspace hash。其返回结果、置信度及 current/stale/missing/unavailable 语义均保持。所有权评分、current 检查与历史激活不走导航缓存。close 先清槽/失效观察 scope，再保持原关闭顺序。

## 观察契约

严格实现已接受 O/T 文档的 openNavigationCacheObservationV1(): scope|null；每 application 一个显式、pull-only scope，只有 coldNavigation/warmNavigation。无 observer 时不产生 marker probe 或聚合开销；enabled 只有 begin/end 两个额外窄 token probe，位于导航 wall/API 计时外，零 snapshot/source/config 读取。marker 不懒创建 store。scope/phase 在 API 入口捕获，API settle 只发布一次已封存的 resolver disposition；后续 fresh read/API 错误另计，不能改写 disposition。

lookup/build/after/admission 使用缓存原有实际动作；聚合 schema、精确 enum、版本、计数和 4 MiB 字段按 O/T，不输出 token、源码/身份/路径/错误或事件列表。getSummary 返回独立深冻结 plain-data；dispose 幂等且旧 scope 摘要可读，不能污染新 scope。阶段错序、未决调用、close、溢出或内部故障标真实 coverage 不足，不改产品结果。完整事件的关系矛盾是失败，不能称 inconclusive。同步 candidate 不新增取消/await 点，cancelled 保留为 0，不偷映射其他 decision。

## 完成门与协调窗口

先定向新回归，再原 application 整包、graph 及两包 noEmit；原门、断言和时限保持。覆盖两 API 返回/错误等价、完整加载真实次数（导航重复现代样例可复用）、旧 current/source 不变；外部连接更新/删除/损坏 payload、回滚、同连接 save/reuse、首建/重建 before-after race；事务/坏 token/关闭、legacy、错身份、missing、超限/invalid admission。用实际公开 application 与真实临时 SQLite，不用测试替身冒充生产调用。

覆盖 alias 变异、store 身份、A→B→A、重叠 readSource 捕获、配置和 workspace freshness；enabled/disabled 结果错误等价；resolver installed/hit/bypass 后 fresh API 失败 disposition 不变；load/admission 失败且真实 after 变化、不可比 after、私有 candidate 配对、唯一终态和 O/R/estimator 关系。marker 两额外 probe 零其他 SQL；scope phase 归属、错序/未决/close、摘要隔离与溢出失败关闭。仅 fixture 项目静态索引/读取，禁止执行其代码。

本批普通 Node/SQLite 定向测试由 Sol 可执行；重型 build/native/dist/Electron/benchmark 不启动。冻结三文件后 root 独立源码/回归/探针复验并精确集成，不由开发方 Git 收尾。v2 三文件工具必须等本批端口稳定进入 main 才派 Luna；当前不以旧 v1 的完整加载次数断言判新缓存失败，也不改旧工具迁就。正式性能门仍为同调用三配对、两轮全部 1,177 证据/每 API 满额、11 语义门、完整可比观察下加载 ≤2，收益未测不称通过。GUI、远程质量、签名与干净 Windows 门仍开放。
