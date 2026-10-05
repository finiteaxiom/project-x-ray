# 2D-B1 可信语义持久预占用实施

这是原第二批S3-B的必要后台接线，非第五批。R1已独立接受并提交推送f095bfc7a6e1b28e2a7dfc39571fe5966885ee06；当次发送、公开发布及统一停止恢复尚未实现，不能以内部SQL或完整DTO代替。

## 真实源码依据与交付目标

ownership-semantic-preparation-store.ts的Prepared私有材料含实际原题/成绩/胶囊、authority context/provider/semantic authorization、settings revision、main generation及真实Q3完整Responses body。现consume仅返回正文摘要/大小和preparedReference，withRevisions一次消费且应用finally撤销并abort。A2 reserve仍为内部SQL，接受结构identity但不证明其来自当次Q3。缺少将这些真实私有材料签发为持久reservation的可信路径，不能由application拼caller DTO或照抄R1测试raw database反射。

本次实施可运行本地路径：真实索引→原题发行→确定性答题保存→实际Q3 adapter及可信当前性prepare→仅可信内部材料生成完整A2 identity→实际global独立事务commit reserved registry/lease。只返回本实例不可伪造opaque reservation及有限reserved元数据，taskId由可信流程创建，createdAt实际首次持久T1。无dispatched事件或任务行、无provider/credential/网络调用、无结果写。先完成该持久边界，后续另接当次dispatch/publish，不能用本票据宣称发送许可。

已有Q3一次门、prepare-only应用返回值/错误及新旧正确回归保持；为新生命周期新增独立private capture/receipt路径，不把既有一次token开放反复使用。来源字段取实际原题/胶囊/成绩，完整body摘要取实际已验adapter，authority及main元数据取当次私有捕获；完整schema只是最后形状校验。实际保存ignoreRevision与当前settings revision须明确分别核验，任一不闭合不得登记。第一await前捕获不可信五字段请求，getter/proxy/隐藏字段拒绝。不能增加接受caller identity/body/authorization/currentness-success callback的生产入口。

reserve在实际global外层IMMEDIATE事务成功COMMIT后才返回opaque票据；进入时已在外层事务则拒绝，不把savepoint释放称commit。事务内按global→settings→source顺序重核真实来源与auth/provider/model/credential/context/activation/ignore/main generation及完整正文，在锁内调用原A2 reserve，写后完整状态核验保持。整个阶段零外部调用，reserve COMMIT故障全回滚、零票据/任务/结果，安全手动新prepare重试。票据绑定实际authority/source/settings实例及当前生命周期，不允许跨实例/关闭/普通对象伪造。关闭不得当全worker停止证明或自动清既存占用。

明确取消路径：持久commit前取消零登记；已committed reserved且本阶段能够由封闭实现证明零dispatch，取消可按同完整身份terminalReserved及精确release，实际外层提交失败保留阻塞占用。close仅撤销内存票据并保留已commit占用；不调用feature-only/global recovery，不自动重发。以后dispatch不可沿用本阶段未发送证明。

## 精确文件边界

仅原Sol在5170实施，main由root保持稳定。允许新graph内部ownership-semantic-reservation-store.ts与.test.ts，新application/ownership-semantic-reservation.ts与.test.ts；graph ownership-semantic-preparation-store.ts及.test.ts仅新增私有可信捕获/同步重核路径，保留旧Q3行为；graph index.ts仅私有生命周期/严格有限可信委派及必要类型export，index.test.ts只新增无public IPC/结果/dispatch和生命周期回归。自身新docs/development-runs/2026-10-05-ownership-semantic-reservation.md及本checkout有证据规则。

不改contracts/L5、llm实际adapter、原A2/shared/remote/R1/capsule/question核心与测试、旧application prepare/remote/index、desktop/UI/native/包锁/重型构建/旧记录或其他WIP。不新增迁移；复用global17/shared14/source18，main11/Sol12保留。必要额外文件先说明源码理由与具体行，等待root窄定边界。不能直接跨包import内部A2或用private database反射生产接线；graph持有实际内部端口并给application最小类型接口。

root已核main与5170的Q3 store/test、旧应用prepare/test、L5结果契约及实际prompt/Responses adapter七文件hash一致。实施前核实际cwd/HEAD/status及全部原文件hash，保留R1旧349及所有既有WIP，新增本任务独立before基线/允许旧文件副本；不reset/rebase/commit/push/cherry-pick。

## 最小充分验收

真实索引原题答题/Q3/真实SQL完成上述reserved闭环，双布局及四题型、空/非空排除规则；五字段恶意输入/异步替换、错误来源和完整正文、无grant与仅feature grant拒绝；prepare后及reserve锁前第二连接改变auth/provider/model/credential/context/ignore/activation、A→B→A/main generation/source同长篡改拒绝零写，原成绩/题目/源码保持。

实际两连接feature→semantic及反向竞争、任一terminal仍占用BUSY、稳定T1、两个库锁失败、BEGIN/INSERT/RAISE(IGNORE)/合法错payload/global COMMIT触发器故障、外层事务拒绝、跨实例/重复/close票据拒绝；成功reserved零semantic任务/结果/HTTP。取消后全状态正确，取消terminal/release分别失败保留原占用且不吞primary错误，重开不自动清/重发。正确旧Q3一次同步门回归原样通过。不得用stub schema/caller材料代替实际准备；测试替身只模拟可信main状态，不宣称真实GUI授权或生产provider调用。

运行新两层、原Q3/准备应用/A2/shared/remote/index/R1/原题/胶囊/政策的适用Vitest单worker/no-file-parallelism/no-cache及graph/application/contracts/llm noEmit，记录完整命令/失败分类/根因/修正再验。冻结交付精确patch/全部hash/未变清单与未验边界，root独立复验后Git。GUI0，零真实API/密钥/环境扫描/隐私控件/导入代码执行/购买/公开二进制；统一生命周期、dispatch/publish仍待后续原四批内接线。
