# 2D-S3-D：共享任务调度的具体实施设计边界

2026-10-05，原第二批，原Sol/medium仅5170。2D-S2内部政策已独立接受并精确main提交推送2ff849300c8720c3a4ded32de914155521a6ce76；2D-L2身份纯契约d31dcba已验。四批后暂停，不第五批。

## 目标与实际源码依据

ADR0008要求openai两purpose合计最多一个inflight、独立授权、共用provider修订失效及严格终态/恢复。当前remote-explanation-store.ts的explanation_single_dispatch唯一索引仅覆盖explanation_tasks；registerDispatch查询旧表后inflight=1。finish只改终态，不释放inflight；releaseDispatch拒绝仍dispatched任务；recoverInterrupted在可信broker先停止旧worker前置下标interrupted、清占用并关闭上下文。application/remote-explanation.ts依赖这一先完成/补偿/停止再释放顺序。新语义任务若在独立表再放一把锁，会允许并发两请求。2D-S1历史材料prepare-only/not-checked，2D-S2grant与2D-L2schema均不能充当当前性/dispatch权威。

此设计须把已接受ADR变成可直接实施和独立验证的共享SQL/状态边界，选定接口与最小实现切片；不能重复宽泛ADR或仅列TODO。详细跨用途状态与旧inflight升级策略是实际尚未解决的集成决策。本轮只两份自有设计/开发记录，root独立接受后才派具体源码实施。

## 本轮文件与依赖

仅新增docs/plans/2026-10-05-ownership-shared-task-design.md与docs/development-runs/2026-10-05-ownership-shared-task-design.md。读实际contracts identity/policy、graph remote/policy/material、application/remote-explanation、desktop冻结broker恢复顺序及对应测试；不改产品源码、AGENTS/包/锁，不重型构建、网络/GUI/凭据或Git。

协调方精确同步已验L2两个新contracts文件与barrel一行到5170；保留其原index差异，主/Solpolicy与oldremote依赖核hash。不是重新实现纯契约。S2与原broker/cache/loan/UI等保持冻结。各worktree只维护自己目录，本计划相同副本由root提供。

## 必须作出的具体决定

1. 选共享global占用的实际表/复合身份及内外端口；注册/检查/占用在同连接同步IMMEDIATE，不事务内await。新语义task元数据与辅助结果分离；给出状态/strict持久DTO及role/schema迁移清单。当前global13、Solproject12/mainproject11，后续号码须root分配；本设计不运行或占迁移。
2. 明确旧feature注册如何进入同一占用门，迁移时旧inflight=1和terminal但尚未释放的任务如何完整保留；不得把升级当worker停止证明、自动释放遗留占用、重写旧identity/历史完成结果。重复task/跨purpose UUID碰撞、多个旧非法占用、损坏记录必须失败关闭。保留原正确回归及原角色断言，不放宽feature literal。
3. 明确内部语义注册需要哪些实际DB核验/可信应用当前性屏障：独立授权revision、provider/model/credential revision、同owner/context/epoch、activation/config/source、question/attempt/rubric/package/body。结构校验、旧prepare-only材料、caller声称当前均不代权威。说明哪些在SQL同锁核、哪些在未来application捕获且持锁重核；不实现半套能被误作真实发送许可的接口。
4. 给出逐状态表：undispatched取消零占用/零网络；dispatched终态后继续保留占用直到停止/发布或补偿门；重复finish/release/取消幂等且不释放另一个purpose的占用；共享provider修订影响两用途，独立revoke只对应用途/项目，上下文变动影响对应owner。同步政策提交失败关入口/终止worker的既有边界保持，不隐式发请求。
5. 跨库结果只在权威completed且精确身份时可读；补偿/释放失败保留占用，成功历史不删。恢复须调用方已停止全部旧worker，说明统一恢复入口怎样避免旧feature恢复清语义活任务或新schema恢复漏旧任务；零自动重试/重发。仅设计，不修改旧已验发布或冻结broker。
6. 切分最小可运行后台实施范围，逐文件/API/依赖/验收门精确列出，优先共享占用与任务核心，再当前性/结果编排，最后provider/desktop/UI。记录单provider并发、窗口跨用途合计元数据上限与实际旧契约如何兼容；任何未能安全切开的依赖明确指出，不能伪造可独立接入。

## 设计接受门

对照实际源码而非旧迁移建议，列真实两连接交错与SQL故障实验矩阵：feature→semantic及反向抢占、terminal未释放、撤销/模型修订/上下文变更、重复start/preview一次消费、BUSY/触发器回滚/安全重试、跨库completed失败/cleanup失败、崩溃停止前后恢复/关闭重开、legacy/project分库及旧历史字节保持。每条标实际执行层、预期零写/零dispatch/占用保持条件；本轮模型矩阵不是已运行测试或GUI验收。

交付精确方案/hash和原WIP不变确认，反馈记录须区分设计推断与实际执行，AGENTS可0且本轮不改。若发现现有产品缺陷，给复现/证据/最小边界并先报root，不自行修其他文件。root独立设计审查后继续原四批源码实施；其他三批未验门及外部阻碍保留。
