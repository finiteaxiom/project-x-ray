# S3-A2：语义持久任务内部核心

2026-10-05，root明确派发原第二批；原Sol GPT-6.1 Sol/medium仅5170，开发不Git。四批收尾暂停，不第五批。Q3已独立接受并main提交8627e05c1782c7feefd0df228e157a7c3e154c9c；真实API/GUI和统一停止恢复未验收。

## 源码依据与本次目标

当前SharedRemoteTaskStore已有global14 registry/lease与global16 feature durable reserve，但assertState只核feature任务；semantic registry/lease只有结构夹具，没有独立任务表或实际状态核心。migration16的lease promotion明确仅feature。已接受L3提供strict五phase record及完整小数秒顺序，Q3提供实际bodyDigest/currentness接缝。本次实现先前共享任务设计S3-A2的真实SQL元数据核心，供后续可信编排接入；不把DTO、SQL方法或Q3引用称为发送许可。

root先同步已验L3 task.ts/test两文件到冻结5170，保持既有barrel的同export、原L2身份与版本。同步后跑实际契约回归/类型，再建立本次实际字节基线。保留全部既有WIP，不能用main HEAD覆盖Sol目录。

## 精确边界

允许packages/graph/src/shared-remote-task-store.ts及.test.ts、remote-explanation-store.ts及.test.ts（仅共享核心schema验证/生命周期委托及必须兼容的窄接线）、graph/index.test.ts（角色/迁移回归）；必要时graph/index.ts仅构造/迁移生命周期，不导出生产semantic reserve/register/finish/release入口。可新增graph/ownership-semantic-task-store.ts及.test.ts作为同连接内部组件，先在自身记录说明分离理由。自有docs/development-runs/2026-10-05-ownership-semantic-task-core.md。

禁止application、contracts、LLM、ownership、analyzers、desktop/broker/UI/native、包锁/脚本、AGENTS和公共计划/交接改动。L3/Q3、S3-B原行为、main11/Sol12/source15/global13/14/16及旧迁移定义保持。允许global新增迁移**17**，只用于本次semantic任务表/必要共享guard升级；不分配项目结果迁移，不建结果表。禁止真实网络、凭据、用户授权操作、电脑操作/GUI、重型build/native/Electron或执行导入项目代码。

## SQL与迁移门

1. global的ownership_semantic_tasks保存task_id、owner_session_id、repository_id、phase、inflight、binding_hash、created_at、completed_at及canonical strict record payload（≤16KiB），UUID引用registry。无正文、答案、rubric、源码或key。project无此表/迁移17，保持原项目库。
2. 17用单IMMEDIATE事务：先验证原14/16实际objects/rows，再建立表与固定guards/新版schema验证，最后标识；任何失败回滚DDL、旧trigger更换及标识。**原14/16定义和升级到16的路径必须保留**；重开17核实际objects及全表一致，不用IF NOT EXISTS修复损坏17。坏16不能因17升级而被修好。
3. 迁移不补造旧semantic dispatched任务或停止证据：合法reserved的无任务登记可保留；registered却无合法任务、orphan registry、错身份/时间/phase/lease等拒绝并保持所有旧行。全历史feature行、来源、成功结果及createdAt不改，不通过删除历史放行升级。
4. 同连接核心维护两purpose一个provider slot；SQL guards防另一个真实SQLite连接只改任务/lease绕过一致性。semantic task/registry完整identity、canonical payload、摘要、列、phase/inflight、时间逐项核；终态不会自动释放。reserved→registered promotion仅同UUID/身份/首次T1；原feature16路径保持。针对semantic的新guard以17明确更新，不改旧迁移14/16定义来冒充既有schema。

## 内部操作语义

内部方法只在graph模块内部/测试直接使用，不能从GraphStore/RemoteExplanationStore公共入口或barrel导出semantic写许可，不挂application生产调用。SQL形状校验不是原题/政策/当前性/停止证明。后续可信编排仍须真实Q3全门、durable两次锁段及全参与者恢复接受后才启用semantic发送。

- 读取严格purpose/task key，先核registry，再读对应任务；错purpose拒绝，合法缺项返回null。损坏固定POLICY_INVALID，不回显输入或猜修历史。
- reserve内部调用持有实际global事务：严格identity，跨用途UUID全历史冲突REVISION_CONFLICT；已占slot BUSY，败方零写。创建registry+reserved lease同事务并固定首次T1，无dispatched任务。
- promotion内部同identity/T1注册dispatched/inflight1并提升slot，不能接受caller替换身份或T2。未发送取消/失败可形成合法终态元数据；是否零dispatch由未来编排证明，本层不得自报成功。任何提交失败保持此前已提交reserved占用。
- binding_hash独立SHA256(canonical identity仅去掉taskId、ownerSessionId、contextHandle、contextEpoch)，保留其余全部字段包括actual bodyDigest。相等hash不授予许可/去重结果；不建result/completed复用接口。
- finish仅dispatched到一次合法终态，原terminal及code不可覆盖；重复精确操作返回原值，错identity拒绝。终态时间使用既有strict record完整小数秒比较，T1保持。
- release仅精确terminal自身占用，dispatched拒绝；重复释放无写，旧task不能清另一purpose/新task slot。此方法是内部SQL动作，**不得用它证明worker已停**，不增加caller boolean、stopReceipt或统一recover捷径。
- feature-only recover仍先检查reserved/semantic占用并全事务零写失败关闭，不自动清semantic。正常feature的注册/取消/终态/release和旧返回形状保持。

## 最小充分交付与独立门

真实SQL及两连接测试：两purpose互斥双向；reserve/promotion/terminal/release及稳定T1；跨purpose UUID碰撞；T1到T2 promotion、完整小数秒回退拒绝；重复finish/release/迟到旧release；任一registry/task/lease写入或COMMIT失败/BEGIN BUSY保留占用且零第二任务；关闭重开坏列/payload/identity/预算/phase/trigger/table/迁移标识拒绝；project无17；实际旧14/16库升级17保留历史/源码/结果，损坏原库及半升级全回滚；feature-only recover遇semantic/reserved零写。

原正确assertions不能删除或降低时限。若旧A1自有raw semantic夹具在新17必须补真实任务行，只修改夹具到新版合法状态，保留原互斥/恢复预期，另覆盖无任务registered现在拒绝的负例并说明语义，不暗示旧生产已发送过semantic。

至少单worker/no-file-parallelism/no-cache运行shared core/remote store/index、semantic task contracts、Q3 graph/application准备、application remote-explanation及S2独立政策；graph/application/contracts noEmit。按实际风险补最小回归，不无依据全仓重测。交付原→后patch、允许文件hash、全原文件不变清单、实际命令与反馈闭环；源码冻结后root独立两连接/迁移/故障复验再精确集成，开发不Git。无新产品失败时写明，AGENTS候选可0，只放自身记录。接受内部SQL不等于semantic发送、发布、统一恢复、模型或GUI完成。
