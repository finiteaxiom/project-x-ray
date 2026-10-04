# 2D-S3-A1：共享SQL占用与既有feature兼容实施

2026-10-05，原第二批，原Sol/medium仅5170；依赖修订后已接受的[具体设计](2026-10-05-ownership-shared-task-design.md)。main起点2ff849300c8720c3a4ded32de914155521a6ce76，Sol实际455d4ad与冻结WIP保留，不整体同步/重置。四批结束后暂停，不第五批。

## 目标、依据与实现限度

旧explanation_single_dispatch仅旧feature表，未来另一用途无法受它约束；现registerDispatch/finish/release/recover及policy变化只有feature记录。先实施一个global持久registry/lease及原feature兼容路径，让所有已存在可信feature入口使用同一数据库占用门。它是后台内部SQL切片，不开放语义发送、不创造用户动作或当前性证明；人工semantic元数据/slot只用于检验跨用途SQL约束。

选择修订设计中的共享表/旧占用保留与失败关闭规则。本轮正式分配迁移14：仅global remote_task_registry及remote_provider_lease、必要桥接约束/触发器和迁移标识。不创建semantic任务或结果表，不改10/11/12/13，project不标14/不创建global新表，main原11/Sol原12断言保持。角色迁移稀疏合法。

## 精确文件与冻结边界

- 新packages/graph/src/shared-remote-task-store.ts及对应.test.ts。
- packages/graph/src/remote-explanation-store.ts与.test.ts：仅私有共享store接入、迁移14、feature登记/终态/释放/恢复一致性及必要政策匹配委派/错误映射；原公共方法签名和feature identity/返回shape不扩。
- packages/graph/src/index.ts只在实际需要时追加私有同连接实例生命周期/窄注入，不导出共享class/通用身份/语义许可；若Remote内部持有已足够，不为形式修改index。
- packages/graph/src/index.test.ts只必要global14及project隔离回归，原正确角色断言不删改。
- packages/graph/src/ownership-semantic-policy-store.test.ts仅在新桥接守卫使原old-task-sentinel不再是合法task夹具时，允许将该哨兵设置换成严格合法的自有历史task。原所有零写、旧feature/provider/task/历史源码不变断言全部保留；必须解释为何变更及验证，不为过测试放宽生产校验。无需调整则不改。
- 新docs/development-runs/2026-10-05-shared-task-core.md，反馈闭环/原副本/patch/hash/命令/边界与规则评估。
- 其他contracts、S2源码、application、LLM、desktop/UI/broker、native/cache/loan、AGENTS、包/锁及其他记录全部冻结。本轮无新依赖、Git写/重型build/native/Electron/GUI/网络/凭据扫描或导入项目执行。

先核实际目录/Git、全依赖与WIP；为会改的旧文件保存原字节副本，交付精确原副本→当前patch，不以HEAD整批差异替代。不覆盖主目录、不复制整index/AGENTS。分配原设计其余S3-A2/B/C为后续未派范围，本轮不顺手实施。

## 必须保持的实现行为

1. 一个openai主键slot，不按purpose各建一席；跨purpose全历史UUID登记且完整严格identity、purpose、owner/repo/context、digest、createdAt列/payload闭合。身份使用原feature schema及已验L2纯schema，不扩旧literal。16KiB新元数据上限须以合法最大值证明；无正文/凭据/任意异常写库日志。原旧feature读限额不缩小。
2. 迁移14单同步IMMEDIATE：严格验证旧feature行与phase/inflight/owner及创建时间；登记全部历史UUID，将唯一合法inflight1（包括terminal未释放）带原身份/时间复制registered slot；保留原行/时间/inflight及completed结果/源码。dispatched0、多占用、损坏/半升级/UUID错配拒绝，全14 DDL/标识回滚。重开校验真实表/约束及跨表一致性，不靠有14跳过损坏；无旧worker停止、自动恢复/释放或重发。
3. 所有原feature可信注册/取消首次记录在同global同步锁段使用共享UUID/占用门；现assertPermission/context检查保持。登记冲突UUID→REVISION_CONFLICT，占用或真实锁BUSY→BUSY，损坏/任意SQL固定POLICY_INVALID，不把任意constraint误分类。合法插入/更新不会绕开共享约束；不能以仅检查两个表union替代单slot唯一约束。触发器/私有SQL辅助若必要须可在实际各SQLite连接下运行，不引入未登记UDF导致其他连接无法合法重开。
4. feature finish保留slot/inflight，原terminal幂等且不改成功；release只释放自己匹配完整身份且已terminal的slot，重复零写、不删后来新slot、dispatched拒绝。UUID跨用途碰撞不猜修。首次feature登记的权威createdAt一路保持，迁移不重造，phase/completed时间严格核；不新增durable reserved发送路径或调用provider。后者尚未实现，SQL注册互斥不能证明同步dispatch后COMMIT失败时外部请求仍互斥。
5. A1 feature-only recover在同IMMEDIATE、任何终态/context/占用写之前先严格核共享状态；非feature slot或无法验证的记录固定失败关闭，所有表/时间/context零写。feature-only原合法恢复仍需既有可信调用方已停止旧worker前置，保持旧interrupted/零重发/成功历史与未发布补偿边界。不得清非feature占用、造opaque stopReceipt或声称全用途worker已停；真正统一参与者恢复留后续。
6. S2本轮不加任务回调/组合授权，provider/context/feature政策路径只维护实际feature语义；不能通过原方法清未来非feature slot。人工semantic registry与slot的一致性读验证可以由内部模块支持，但不得新增GraphStore或Remote public semantic reserve/register/dispatch或返回发送许可。

## 最小充分验收

自有真实SQLite覆盖：global14/project零表零14及关闭重开；旧dispatched1与terminal1升级保持、空库、损坏/multiple/半升级、schema/触发器写失败全回滚和移除故障重试；跨用途人工slot→feature及feature→人工slot两个方向至多一席、UUID碰撞；两真实连接IMMEDIATE竞争/提交后BUSY；finish保持、dispatched释放拒绝、terminal释放/重复/新slot后迟到旧release；createdAt稳定与错误时间拒绝；非feature/损坏占用下feature恢复全表/context零写；旧feature授权/provider/恢复正确回归及不可变source/history保持。人工slot不创建真实semantic任务，不网络。

运行新core、原remote-explanation-store/index/capsule-store/S2 store及application/remote-explanation原回归（单worker/no-file-parallelism/no-cache），graph与application noEmit。不要删除原COMMIT失败“一次已许可dispatch、零task/result、无重试”断言或伪造durable slot已经实现；如新表同事务回滚，必须如实保持该事实并列为后续接线门。只运行适用稳定源，重型窗口空闲但本任务不占用。

冻结报告源码与测试hash、必要旧夹具变化/原正确断言、原备份/精确patch、实际命令结果、未验项；AGENTS允许0，既有规则覆盖时不强加经验。root独立审查并精确main集成前不称完成/提交。该内部切片可独立验证，完整semantic currentness/题目认证/结果/transport/真实GUI均留未验；四批本地工作收尾或剩余全外部后按停止门暂停。
