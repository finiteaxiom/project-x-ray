# S3-C 共享停止与恢复：当次方案反馈

2026-10-06，仅新增自身两份文档。B2已由协调方独立接受内部后台并报告main集成9d9f19aafbdeed5a185ac04bee9af62bf4f1f2e4；不等于本轮执行、GUI或统一恢复接受。

## 实际检查与基线

实际本地HEAD455d4ad50830ee2495b70927e51caf830a4efbb8，保留原WIP；rg inventory为364文件，保存完整before及SHA256 `AF620EDC37248C664B8A278BFD55842D622CE2D259E95AA10930F9F1DAE153E6`。只读源码与已接受共享任务设计、ADR0008，不操作main、不改任何源码或现设计。轻量memory搜索只命中其他项目旧恢复资料，未作为本项目设计依据。

实际源码证据：broker.stopConfirmed只有feature worker/issued，旧recover先assertFeatureRecovery，semantic或reserved占用会拒绝；A2完整共享状态/T1/lease严格门已经存在；B2 close不清持久占用，activeOperations只涵盖当前任务；R1 readCandidate会重开后完整验证并签发真实候选，compensate要求本issuer/权威精确非成功终态；policy.refresh和application启动loader均会枚举库，不能直接当定向恢复locator；main真实Node Worker及singleInstanceLock构造是后续可信启动证明的代码基础，仍需真实Windows证据。

## 设计反馈与选定修正

未复现新运行失败，未编造实现闭环。对原设计的具体落地评估发现两个接口依赖：全purpose/退休generation及异步结算的证明不能由现feature broker集合产生；重开source必须以真实既存store/根身份定向绑定，不能用任意回调或目录枚举假装已知源。方案按原已接受原则落实：先内部core可信native域和private vault、实际A2/R1恢复；后desktop精确locator/启动资源归属/既有生产者统一登记。内核第一切片不接生产、不放宽旧feature-only门；无locator或旧资源域未知时只证明blocked。

文档列出拟新增/旧文件、私有API、scope/revision/once能力门、两purpose和两布局各状态、真实候选补偿/成功历史、跨库非原子步骤与故障人工重试、窗口共享预算，以及单独desktop/真实GUI门。方案不重做已验A1/A2/B2，不更改原评分/package/body，不新增migration/依赖，必要封装扩展先报最小hunk由root批准。

## 实际验证与未运行

实际执行：git rev-parse HEAD（只读）；rg --files --hidden -g !.git（before364）；读取上述源码/设计；文档后完整SHA256比对及限定新增文件审计。冻结结果以交付manifest为准。未执行vitest/noEmit/build/native/dist/Electron/HTTP/凭据/模型实验；方案中的矩阵均待实施，不声称通过。未commit/push/merge/reset/rebase，未修改main或旧冻结。

## 规则评估

AGENTS新增/修订0。没有本轮新运行复现支持公共工程经验；具体预防与验收动作保留在本方案，等待实施实验及协调方逐条审查。已有跨库completed门、精确补偿、原错误保留和异步当前性规则不变。

## C-core派发后的设计纠错（2026-10-06）

协调方审查要求修正两项：原生Worker持有、模块捕获、终止/退出核验和异步操作结算均放application私有生命周期/能力模块；graph仅存authority/session/完整状态前像和一次opaque权限，不访问Worker/Electron，不反向依赖application。此前表中graph/remote-recovery-capability的原生职责被撤回，实际改为application/remote-recovery-capability；其他原则不变。

协调方真实SQLite反例确认：reserved feature直接promoteFeature(interrupted,1)会被migration17的remote_lease_no_update拒绝，整事务零写；此前“可直接复用”假设错误。此次正式分配global19：保留旧14/16/17/18定义，19先严格验证旧17及全状态，窄允许同identity/T1/inflight1的reserved feature非成功终态提升并保留lease，禁止completed或重新激活。项目角色不安装19；真实SQL两连接及DDL/marker/COMMIT回滚回归随实现交付。本轮先保留before366全部原字节，实施只在明确派发范围，实际结果进入shared-remote-recovery-core记录。
