# 2D-L2：语义评价内部任务身份纯契约

日期：2026-10-05；原第二批必要实现，main 原 Luna/Max。依赖已验 2D-L1、语义 package/rubric 与 2C-L adapter；不依赖正在修改的 Sol SQL 代码。四批后暂停，不第五批。

## 源码依据与目标

ADR0008 第“任务身份、当前性与取消”节列出最小捕获字段。实际 `remoteCapturedIdentitySchema` 仅解释用 packageId 和通用快照/上下文身份，没有 questionFingerprint、attemptHash、rubricHash，且旧持久任务用途由 feature 链约束。2D-L1 公开 start 只接受 preview/package 引用，禁止 renderer 选择 taskId；2D-S1 历史包是 prepare-only/not-checked。未来同步登记/共享占用/发布必须能区分语义任务，不能借旧 schema 放宽或丢掉这些绑定。

目标是一个完整、有限、严格的内部元数据身份 DTO，供后续可信捕获使用；schema 通过仅证明结构，不验证实际数据库/currentness、原题/答案真实性、用户动作、许可或签名。

## 文件边界

仅新 `packages/contracts/src/ownership-semantic-task.ts`、对应 test、自有 `docs/development-runs/2026-10-05-ownership-semantic-task-identity.md`；contracts index 仅追加一个 export。原 feature、policy、semantics、capsule、LLM、graph/application/desktop/UI 不改；无网络/SQL/任务调度/评分/凭据/Git/重型验证。原冻结成果保留。

## 严格字段与版本

导出 `ownershipSemanticCapturedIdentitySchema` 与推断类型，至少且仅以下字段，全部 required、无默认/未知字段，无原文数组或正文：

`protocolVersion, repositoryId, snapshotId, activation, analysisResultFingerprint, sourceManifestHash, configurationHash, ignorePolicyHash, ignoreRevision, questionId, questionVersion, questionFingerprint, attemptId, attemptHash, deterministicScoringVersion, rubricVersion, rubricHash, semanticProtocolVersion, semanticScoringVersion, purpose, disclosureVersion, authorizationRevision, provider, model, providerRevision, credentialRevision, contextHandle, contextEpoch, ownerSessionId, taskId, assessmentPackageId, bodyDigest, limitsVersion`。

- `protocolVersion` 为独立内部任务协议 1.0.0，导出命名常量，不能借 schema 推断已派发。semanticProtocolVersion 精确等于已验 adapter 实际 `ownership-semantic-assessment/1.0.0`，从现有 purpose/version 常量构成，不导入 llm 实现；semanticScoringVersion、rubricVersion 为现行独立 1.0.0，limitsVersion 独立命名 1.0.0。
- purpose/disclosure/provider 使用已验 policy 的现有常量；provider openai 是第一适配器边界，不能凭合法 model 字符串宣称服务支持。
- 使用现有 bounded hash/id/time/uuid/revision/model primitive。ignorePolicyHash 可 null，与原 activation 兼容；所有其他绑定 hash 不可 null。model required 非空且受旧安全字符/长度约束；questionVersion/deterministicScoringVersion 跟原包一样有界非空字符串，不硬编码旧历史版本为当前授权。
- 不扩旧解释 literal、不新增联合身份/结果/事件/任务记录/预览/phase 状态机。本轮仅捕获身份 schema/type；public start 仍不可指定 taskId，这个内部对象不能成为 public request。

## 完成门槛

新测试使用有效有限合成身份并逐字段缺失/错误类型/长度或上限拒绝，purpose/provider/disclosure/protocol/scoring/rubric/limits 固定版本边界；hash、UUID、nullable ignore、MAX_SAFE_INTEGER revision 和溢出/负值、model/版本字符串界限。完整旧 captured identity 与新身份双向拒绝，合法内部对象不能通过新 public prepare/start，答案/rubric正文/凭据/endpoint/未知额外字段拒绝。

测试明确两份合法但不同的 question/attempt/rubric/config/context/body 身份都可通过结构校验：schema 不是关联验证器，不应写“不同摘要均被结构拒绝”的伪真实性断言。没有任务生命周期、副作用、fetch/timer 或授权。barrel 导出检查，旧 policy/semantics/remote desktop/index 回归及 contracts noEmit；开发记录实际命令/失败分类，经验可 0 条。冻结 hash 后协调方审查，再交未来 SQL/共享调度，不能标第二批/GUI/真实模型完成。
