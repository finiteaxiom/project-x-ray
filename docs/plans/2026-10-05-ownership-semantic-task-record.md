# 2D-L3：语义任务持久元数据纯契约

2026-10-05，原第二批，原Luna/Max仅main。依赖已验L2 identity及S3-A1共享SQL；main当前d27f1a1f56d2010b595480e42fd6307035722923。四批收尾暂停，不第五批。

实际依据：shared-task设计第2节规定独立semantic task record，当前ownership-semantic-task.ts只有33字段identity，不能表示严格持久phase/终态。旧remote record绑定feature identity，不能扩其literal作为semantic记录。后续global semantic SQL必须使用独立已冻结record。

仅修改packages/contracts/src/ownership-semantic-task.ts与其.test.ts，新增自己的docs/development-runs/2026-10-05-ownership-semantic-task-record.md。现barrel已export *，无需改index；其他文件/AGENTS/包锁/SQL/application/LLM/desktop/UI冻结。保留L2所有identity字段/版本/正确断言，先保存旧字节与hash。

新增ownershipSemanticTaskRecordSchema及OwnershipSemanticTaskRecord：严格identity使用原schema，phase仅dispatched/completed/failed/cancelled/interrupted；createdAt、completedAt和有限RemoteFailureCode。没有preparing/reserved持久任务phase（reserved仍是独立lease stage），无正文/答案/rubric/secret或新授权字段。dispatched仅null completedAt/code；completed必须合法completedAt且code=null；cancelled code=CANCELLED，interrupted code=INTERRUPTED；failed非空有限code且排除上述两个专属终态code。terminal completedAt不得早于createdAt，遵守remoteTimeSchema原合法UTC/有限长度，不偷偷缩小identity字段值域。需完整比较契约允许的小数秒顺序，不能只依赖Date.parse毫秒截断而接受更早终态；使用小型纯确定性校验，无依赖/真实系统时钟修改。首次时间来自未来可信SQL，这个schema不分配时间或证明时间来源。

合法最大长度identity+record canonical JSON小于16KiB，以既有字段合法最大/UTF-16转义最坏组合验证；不限制旧feature262144字节读预算。parse只证明形状/值域与状态时间组合，不是许可、实际dispatch、原题认证/当前性、结果发布或停止证明。不得新增reserve/register/finish/release服务、数据库、任务事件或公开IPC。

最小回归：保留原identity测试；5合法phase、所有非法时间/code组合、preparing/reserved拒绝、嵌套额外字段/旧feature identity拒绝、同秒小数更早终态与有效等值/跨秒情况、最大预算/JSON往返。单worker/no-file-parallelism/no-cache运行ownership-semantic-task、policy、semantics、remote-explanation、ownership-capsule、index适用contracts文件及contracts noEmit，不运行活动或无关重型检查。

冻结交付原副本→当前精确patch/hash、实际命令结果/失败分类/未验边界；其他源不改，不Git，不网络/native/Electron/GUI或导入项目执行。AGENTS允许0。root独立验收后再让后续SQL使用，不能以本契约宣称任务可发送。
