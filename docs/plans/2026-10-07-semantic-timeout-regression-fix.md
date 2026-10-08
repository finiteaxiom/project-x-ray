# B2 超时回归时钟协调窄修

仅原四批第一/第二批后台可信发布与共享恢复的必要回归闭环，不扩产品或第五批。原共享恢复三文件交付保持冻结；此任务须在协调方当前冻结组合运行结束后再向原 Sol 派发，不能并发改其正在被验收的文件。

## 当前实际证据

- Sol 原19文件831/834通过、三个B2 timeout用例默认5000ms超时；原冻结recovery source对照亦失败。root main独立原 `vitest run packages/application/src/ownership-semantic-application.test.ts -t timeout --maxWorkers=1 --no-file-parallelism --no-cache` 三失败/78跳过，17.19秒。
- root只在自有ignored测试副本插桩，原生产source/test未写。第一用例的factory created gate观察watch调用0、计时器0；等待真实watch安装后为1/2。等待安装后原异步时钟仍三失败，不以单一安装时序解释全部失败。
- 观察真实 `ownershipSemanticExecutionState` 调用，不替换SQL结果。同步模拟推进仍逐次执行2400个25ms轮询；插桩三次末轮分别5833/5937/5555ms，已越默认5000ms，三失败。该次并行存在另一冻结回归进程，不作独立性能基线或产品优化依据；原无并发首次三个超时仍真实。
- 仅模拟Date/setTimeout/clearTimeout、保留真正setInterval/clearInterval，并先等待实际deadline安装的副本，原三个完整终态/native退出/占用/T1/重试断言均通过（3过/78跳过、5.61秒、默认5000ms不变）。副本仅改实际源码导入、观察点和时钟范围，不改schema/SQL/产品时限或过滤断言。此为候选验证，不替代正式文件修复和完整验收。
- root另运行真实、未缩短60000ms的main后台split布局探针：60078ms后TIMEOUT，failed/inflight0、lease0、T1保持、两个实际Worker最终threadId均-1；同实例人工prepare/reserve/start重试completed、旧task/原答题/源码保持。没有HTTP、GUI或执行被索引样例源码。真实计时不替代正式回归。

## 允许范围与门槛

仅原Sol `packages/application/src/ownership-semantic-application.test.ts` 与自有本次独立开发记录。原B2/application生产source、graph及共享恢复source/test、迁移、contracts、broker/desktop/UI和AGENTS冻结；不安装依赖、改Vitest全局配置、提高默认5000ms、缩短生产60000ms、伪造SQL返回/worker退出或删正确断言。

先复现三失败并核协调方插桩证据；使用明确且有界的实际deadline安装观察门，避免把factory通知等同异步执行提交和watch就绪。测试只模拟目标deadline所需时钟，保留真实政策轮询和原native资源行为；需解释该调整为何仍测试真实TIMEOUT、T1、精确占用、退出及同实例人工重试。不得把取消替代TIMEOUT。先定向三个timeout，再原B2完整81项、原19文件834项和四包noEmit；失败分类与未验项如实记录。交付完整before/after/hash/精确差异，原373冻结三文件修复字节保持。

若运行发现必须改产品源，先提供实际复现/根因和必要文件，不能因测试超时自行扩大实现范围。协调方独立复验后才决定集成/Git；GUI、实际远程和整批接线门仍开放。
