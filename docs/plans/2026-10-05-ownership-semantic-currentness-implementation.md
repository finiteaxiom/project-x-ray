# 2D-Q2 本地语义准备与同步当前性屏障

2026-10-05，协调方实施派发，仅原第二批、Windows、原Sol/medium的5170目录。Q1修正版已独立接受、精确主目录集成提交推送 `9d9b3b238038cd675ee52054f84e48be05374e63`；两目录各259项、四包类型和两原始探针通过。四批本地收尾或全剩外部门后暂停，不第五批。Luna保持冻结，不同时编辑这些文件。开发不得Git。

## 依据与目标

依据已接受[原题绑定/当前性设计](2026-10-05-ownership-question-binding-design.md)第6节与[Q1独立复验](../development-runs/2026-10-05-ownership-question-binding-independent-review.md)。当前 `loadOwnershipSemanticPackage` 只返回prepare-only/not-checked；`loadOwnershipQuestionBinding` 只认证生成合法性。二者各自捕获后有异步等待，不能直接作为当前性许可。现有 `withExplanationRevisions`/remote.assertIdentity只接受feature授权与旧身份，不能给semantic复用feature grant。实际adapter只有provider-neutral serializedRequest，没有semantic HTTP transport。

实现一条可独立检查的零网络路径：真实索引和可信本地答题保存 → 当前工作区检查 → 实际SQL完整原题/尝试/胶囊/来源捕获 → 固定已编译LLM adapter → 再次工作区/当前上下文检查 → global→settings→source同步屏障完整重核 → 锁内一次性消费内部receipt。默认未授权/未配置可明确拒绝；仅自有测试库可配置实际政策记录验证成功路径。这个内部准备/消费不创建任务、占用、结果、发送许可或HTTP，不操作用户授权/隐私控件，不读取凭据。

## 文件与依赖边界

允许新增 `packages/graph/src/ownership-semantic-preparation-store.ts` 及 `.test.ts`，新增 `packages/application/src/ownership-semantic-preparation.ts` 及 `.test.ts`，自身记录 `docs/development-runs/2026-10-05-ownership-semantic-currentness.md`。

允许窄改 graph/index.ts 构造期私有端口/关闭/内部prepare与屏障接线；ownership-capsule-store.ts仅复用已有实际SQL capture、严格材料/原projection核验，必要对应test；ownership-question-binding-store.ts仅复用完整原题/history/generator验证的同步捕获/重核端口，必要对应test。application/index.ts只新增可信工厂、实际store映射/工作区检查/当前活跃代数/close失效接缝，必要index.test.ts与ownership-capsule.test.ts回归。内部类型放新模块，不新增公共IPC契约或扩张contracts barrel。

其余冻结：所有已验contracts/ownership/LLM源码、旧remote应用/store/共享任务store/S2政策store、旧broker/cache/desktop/UI、包锁、AGENTS、其他记录。不要复制另一目录index/AGENTS。若实际依赖必须突破清单，先发root精确理由、字段及最小差异，不以半校验callback补洞。开始前保存所有允许旧文件实际字节、hash和完整既存Git文件manifest；基线含旧WIP，不用HEAD取代。保留Q1首/修订冻结证据。

## 实现契约

1. 输入沿现有strict五字段ownershipSemanticPrepareRequest（repo/snapshot/contextHandle/attemptId/purpose）；首次await前完整数据捕获，拒访问器、隐藏字段、symbol、proxy、循环和非有限值，后续只读私有捕获。store实例、实际context与main generation在等待前绑定，等待后不悄悄改用另一个实例或同A→B→A的新代数。工厂固定调用真正getSnapshotState/实际映射/compiled adapter，不让请求传成功值、来源DTO、generator或adapter callback。若测试需要控制等待，控制真实方法返回时点而不是替换生产结果。

2. 实际SQL捕获完整attempt/capsule/binding及真实snapshot/query-table/source材料，用原capsule source/hash/manifest/analysis核验、原submissionProjection恢复和Q1同compiled generator/history重建。只verified-generator且ready/可评估才进入准备；legacy-unbound/unavailable/not-evaluated/不支持engine/歧义不猜修、不回填、不生成许可。原评分/mastery/source和历史读契约不变。完整捕获在一次同步SQL视图中建立，保存私有canonical preimages；不得多个异步load后把从未共同存在的版本拼为成功。既有异步摘要/包validator仍实际执行；返回前与最终屏障重核完整原材料，而非只存hash列比较。

3. PreparedSemanticBinding由source私有WeakMap产生，绑定精确source/settings/authority实例、完整preimages/版本、原题历史依据、当前activation/config/ignoreRevision、actual owner/context/epoch/reference、独立semantic授权revision/完整六披露/purpose/version、provider/model/providerRevision/credentialRevision。source实例关闭后无效；普通DTO、历史read对象、相同数据库的另一个GraphStore和结构相同clone不能造此对象。未配置默认拒绝，不能用feature授权绕过；实际政策及provider元数据从权威global读取，不接caller声称的记录。只绑定凭据状态/代数，**不调用OS凭据read**。

4. 固定真实 `prepareOwnershipSemanticRequest({semanticPackage, submittedAnswer: actualAttempt.semanticText})`，完整serializedRequest包含systemInstructions/responseSchema/data，保留真实UTF-8 65536字节预算，不裁路径/roles/原始答案。digest精确绑定这一完整字节串，不能只用packageId。当前没有semantic HTTP serializer，内部明确命名adapterRequestDigest并同时绑定实际provider/model/output设置；不伪造L2 taskId或将其塞入33字段task identity的bodyDigest。后续真实transport必须对实际HTTP完整body独立算bodyDigest并在同屏障绑定/去重；本切片不声称已验证HTTP正文。包/adapter/version/设置改变均拒旧准备。

5. 异步准备至少检查真实工作区，在async材料/adapter后再次检查，并核closed、可信main活跃generation与exact实例；取消/失败固定诊断、清理有限in-flight状态，无悬挂Promise/未处理reject。适用现有有限超时/AbortSignal和单owner后一次准备替换前一次门；不新增无界缓存。主generation按实际活跃上下文改变/应用close失效，不能只比较最后repo/snapshot字符串。source实际activation及global context epoch仍各自独立核验。

6. 最终同步屏障锁序固定authority global IMMEDIATE → settings.withIgnoreRevision → source IMMEDIATE。legacy同连接嵌套savepoint，不声称跨库原子。锁内实际SQL再次核attempt/capsule/binding、全源码/query表/manifest、同generator全原题和cut、private preimages、actual current activation/config/ignore；global重读独立semantic政策、provider及owner/context epoch/reference，全字段精确相等。可信main活跃generation由构造期固定接缝检查。策略撤销/重新grant回同状态、provider改变又恢复、context A→B→A、snapshot再次晋升同ID均不得偷换原捕获。

7. 锁内临时revision receipt与PreparedSemanticBinding是不同私有对象。只有当前屏障callback内能一次消费receipt，source/settings/authority/main generation精确绑定；作用域结束finally撤销，成功、异常、未消费均失效。拒Promise/thenable返回值（不执行then或getter）、跨实例/close/二次消费/作用域后重放及普通对象。不得在事务内await。消费只返回有限内部已核元数据/私有准备引用供后续真实注册接缝；本切片禁止任何task/slot/result SQL写或registerDispatch，不能把内部回调称为网络许可。可信callback的外部副作用不能靠SQL回滚撤销，本任务所有实际callback零网络。

文件系统不能被SQL冻结：两次工作区检查及即时SQL屏障仍不保证整个未来HTTP期间源码不变。保留后续dispatch前后/发布前检查、实际provider/cancel/revoke/统一参与者恢复、durable reserve与UI门，不在报告中提升完成范围。

## 独立交付门

真实自有TS索引四题型 × legacy/project × 空/非空ignore；真实可信发题和保存后，固定adapter实际构造与屏障一次消费成功，原分/引用roles/备选完整路径/源码/历史全保持。另覆盖普通老记录、unavailable、降级胶囊和feature-only grant明确拒绝，生产默认未配置不被测试grant改动。

控制真实异步等待时更改caller请求/close/配置修订/实际source同长篡改/query表/preimages/full binding self-cut/原matching历史/context/provider/独立授权，充分重算摘要也不通过旧准备；包括grant-revoke-grant、snapshot A→B→A与main generation改变回相同ref。重开新实例拒原私有对象，正常重开重新准备可成功。缺本地材料固定失败，不漏源码到诊断。

用第二真实SQLite连接挑战global、settings、source锁段，确认合法锁序期间外部改写BUSY/冲突而不是假装回调成功；异步后、锁前的已提交修订须被观察拒绝。legacy一连接与project三角色布局、同库不同实例均验。反复消费、逃逸receipt、Promise/thenable、异常、未消费、取消/超时清理全部零task/slot/result、原attempt/capsule/binding/source不改。真正adapter字节摘要检查包含system/schema/data差异，预算仍原门。测试故障注入仅测试文件，生产不导出可切adapter/成功flag。

冻结后交精确原→后patch、所有允许源/test/记录hash、完整manifest变化（非允许文件零变化）、实际命令/闭环/限制。单worker/no-file-parallelism/no-cache运行新prepare tests、Q1 binding/capsule/ownership/application旧门、S2/共享SQL与旧remote必要兼容；graph/application/contracts/ownership/llm noEmit。不重复无变化全库测试，不运行重型/native/dist/Electron/GUI或网络。root独立审查、真实probe和精确main集成后才接受。经验按证据/适用/去重门评估，可0条，只自己记录；本计划不是实现或验收结果。
