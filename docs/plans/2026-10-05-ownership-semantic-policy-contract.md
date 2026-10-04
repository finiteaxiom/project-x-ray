# 第二批：独立语义授权与入口契约（2D-L1）

2026-10-05；root。仅原第二批，依据已接受ADR0008及实际源码：remote-explanation.ts 的 purpose/scope/disclosure/categories 只支持 feature-explanation，GraphStore对应授权表按repository存解释授权；OwnershipSemanticPackage和2C-L只描述出站材料，不是授权/公开入口。2D-S1正在独立worktree实施材料只读端口，两者均不能借解释授权发送答题内容。先实现独立纯契约，后续global策略/共享lease/任务/IPC须另按具体边界实施；不扩大六项能力，不增加准备工具或联网。

## 分工与四文件边界

原Luna仅main新增 packages/contracts/src/ownership-semantic-policy.ts、ownership-semantic-policy.test.ts、docs/development-runs/2026-10-05-ownership-semantic-policy-contract.md；只在packages/contracts/src/index.ts追加一行必要公开导出。新文件先核不存在，已有index只加导出，不重排/改旧实现。不修改remote-explanation、ownership-semantics/capsule、graph/application/llm/评分/数据库/迁移/desktop/UI/AGENTS/package/lock、其他协调记录；不Git/native/build/Electron/PS/网络/凭据。Sol仅自己的graph四文件，双方不复制活动实现；此契约不改变Sol当前依赖。

## 具体实现

纯Zod strict schema和对应类型/常量，无读取授权、生成许可、数据库、provider或UI副作用。新policy version=1.0.0，purpose复用已有ownership-semantic-assessment常量，disclosureVersion固定ownership-semantics/1.0.0；原feature literal/disclosure/所有版本不改。

固定六类披露：answer-text、structured-answer-and-citations、question-learning-objective-and-rubric、source-snippets、relative-paths-symbols-and-relationships、analysis-snapshot-identities-and-limitations。具体命名可按现有约定统一但内容不可遗漏；其含义须记录，可反映实际完整semantic包。grant必须完整六类且唯一，不将旧query类别映射为答案授权，不隐含秘密识别承诺。不把schema有效当成用户已选择或OS/数据库权威。

独立authorization record至少version/repositoryId/provider（沿当前首适配器openai literal）/purpose/disclosureVersion/revision/status/categories/grantedAt/revokedAt；按现有有界ID、revision、time primitives复用，所有字段必需且strict。granted要求全六类、grantedAt有效、revokedAt=null；denied要求categories为空，初始never-granted两时间null，撤销记录可保留grantedAt且revokedAt>=grantedAt，不能保留可发送scope。此record只是有限DTO，不创建默认grant，不升级旧解释授权，不能携credential/endpoint/源内容。

公开prepare request仅repositoryId/snapshotId/contextHandle/attemptId/purpose固定；没有答案、rubric、source、ownerSessionId、epoch、taskId或模型endpoint。公开start request仅contextHandle/previewId/assessmentPackageId；main未来登记task，renderer不能指定taskId。cancel可直接复用现有只含contextHandle/taskId的有限请求，不扩权。

独立grant command仅repositoryId/expectedRevision/expectedProviderRevision/purpose/disclosureVersion/categories（完整六类），revoke command仅repositoryId/expectedRevision/purpose/disclosureVersion。它们只是命令输入校验，不执行授权；future trusted main必须独立验证实际窗口、用户动作与权威provider/auth revisions。grant/revoke不能包含owner、credential、任务或正文。不新增通用purpose union、不扩展原feature schema、不把新grant塞旧解释表。

reuse primitives可从remote-explanation.js定向import，不从index.js循环引入。错误用schema有限自定义文案，不把原输入/答案/路径拼接到错误或日志。所有数组和字符串必须在Zod基本边界先限制，再集合/状态关联检查；无任意unknown透传，不能strip后静默接纳额外字段。无授权receipt、captured任务identity、task/result schema或SQL迁移；这些属于后续复杂Sol策略切片，不在本次猜造。

## 最小充分完成门

合法granted/initial denied/revoked DTO及命令通过；遗漏/重复/额外类别、feature purpose/旧scope/旧disclosure、错provider/revision/时间关系、注入credential/endpoint/source/owner/taskId、超界字符串/数组均拒绝。新prepare/start不接受调用者指定答案/题面/任务身份。旧feature契约原合法样例保持，旧feature不能通过新契约，新契约不能通过旧feature，两个方向不被转换或放宽。

测试本模块与原ownership语义/remote-explanation contracts适用回归及contracts noEmit；导入无副作用、barrel仅一行增量。只证明运行时结构与关联检查，不证明真实用户授权、隐私安全执行、共享lease、网络或模型效果。记录反馈/失败分类/最终精确diff/hash后冻结交root；本轮AGENTS允许0。授权/provider两purpose修订、全局合计一个inflight、取消/发布/恢复、真实GUI及模型质量门全部保持。
