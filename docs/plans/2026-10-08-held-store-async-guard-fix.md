# S3-C/H 窄修：跨真实等待的应用store身份门

仅原四批既有桥接缺陷修复，不扩大产品或启用生产发送。原交付377文件、旧2/新3/372保持已经root全hash核对、patch反向check通过；桥接独立验收退回，不能用开发887/887替代新反例。

## 独立复现与根因

root自有probe直接导入实际Sol application/graph/contracts源码；真实应用索引、原题/引用/评分、非空mastery和当前semantic候选。三布局legacy/split/hybrid各两切点：

1. 持有一项真实operation，恢复已停止真实Worker但等待operation结算；
2. 等待实际R1 readCandidate首个crypto.subtle.digest，真实摘要先算完再挂起。

在等待中仅改变应用snapshotStores：保留旧source及其有效源码/SQL，复制已checkpoint的自有SQLite，以正确role的另一真实GraphStore持有同repo/snapshot，替换显式映射。旧source仍被authority/project映射持有，因此两不同实例真实声称同ref。释放等待后六例均成功补偿并release：lease0、候选消失；期望歧义拒绝及停止后的零补偿/零释放。没有假stop/SQL/HTTP，没有修改冻结source或运行被索引代码。

根因：locator只在调用lifecycle.recover之前resolveHeld。实际native等待和R1摘要等待之后只校验既有SQL/source前像，没有复核application当时持有映射；有效旧source材料不证明最新source定位唯一。

root probe为 `.benchmarks/held-store-review/async-map-probe.test.ts`（SHA256 `6C84C3CFEF29409DCAF9736791C73910CD143D936E1F7E3437F472A4C4238335`）。最后真实六例6失败/52原跳过，3.16秒/exit1。早期附加historyStable打印误用了本次自身规范化比较，不能作为历史保持证据；已改为与实际等待前捕获的原history比较，最新六例均true。缺陷在初次3例与补充6例均一致，不以诊断打印代正确失败断言。

## 允许的最小源码范围

原五文件继续；如必要，明确允许新增修改以下五个既有文件，仅传播应用上下文的同步拒绝门：application/src/remote-task-lifecycle.ts / test；graph/src/remote-task-recovery-store.ts / test；graph/src/index.ts窄委派。共最多十文件加原自有开发记录，不改其他source、AGENTS、公开contracts、renderer/preload、broker/B2生产入口。不得借此重写core或纳入缓存/native/迁移旧WIP。实现前在自有记录说明实际选择、各新hunk必要性；没有必要的文件不得为填范围而修改。

必须将实际注册application的持有关系/关闭状态捕获在可信内部闭包中；切点后重新resolve并核对原绑定的实际source/settings、去重及歧义。可复用core新增窄内部context veto，但它只能增加同步拒绝，不能授权停止、补偿或发布。不得以调用者Boolean/普通Promise、自报全部停止/空inventory替代已接受native证明；不得让context回调创建binding、清slot、访问文件系统或绕过任何原SQL/full-preimage/current/source guard。异步或未受约束的回调结果不能默认视为通过。graph不得依赖Electron/Worker或application实现，保持内部端口方向。

至少在实际native停止/operation结算后且terminal写前复核；在每个实际异步来源验证后且source补偿前复核，保持已有before/after SQL完整前像门。app.close、source/settings映射变化、追加歧义、损坏/closed、旧能力均固定拒绝。native切点变化须整个SQL零写；R1切点此前terminal已真实提交可以保留真实进度，但候选/source不得补偿、lease不得释放。不要伪称可回滚先前已提交阶段。

## 验收与冻结

先将上述两切点/三布局真实失败加入正式回归，保留旧52/887正确断言与5000ms/60000ms。补两purpose/native切点及closed/settings切点适用回归，验证拒绝后移除自有歧义、显式再绑/新session人工安全恢复，零重新执行/重发。

仍需定向与原20组合、四包原noEmit，类型/完整组合串行，单worker/no-file-parallelism/no-cache。新数量据实际记录，不预设通过。root收到冻结准确交付后重跑独立六例及适用完整组合；测试副本用.review后缀保留，不改全局发现配置。

本轮before必须为原377交付实际字节，核对所有其他文件保持；给完整before/after/hash、窄patch和反馈闭环。开发不得Git或main写入，无heavy build/native/dist/Electron窗口/GUI/HTTP/凭据/隐私操作。原已验core standalone结论保持；新桥接及其guard未独立通过前不main集成，不以缺GUI为提交豁免。仍是原四批，不第五批。
