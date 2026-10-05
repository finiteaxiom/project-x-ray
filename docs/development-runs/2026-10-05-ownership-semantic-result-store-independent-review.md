# 2D-R1 内部结果SQL核心独立审查

## 冻结来源与实际复验

2026-10-05 23:20后，root核原Sol R1完成并明确冻结，仍只5170，主HEAD52db0c98dcd6e09590f32473597ceba5cb1d0f10与Sol455d4ad50830ee2495b70927e51caf830a4efbb8不重置。冻结manifest SHA17842A878C29D7DDBBF1EFBC0304A86A90DB0DD9A74D856A1B0989C7C8A7401F，patch SHA6539C7992DF9FF454994B758F287398FFF3052D24C868446C32AB19A1094837F。root逐项复核352个after文件hash全部匹配：349旧文件中344原字节不变、4个授权旧源测试变化、1个root计划变化；新增核心/测试/开发记录3文件。新源SHA E90C1E6B385945F5F5F355C7EA98DD0746D401BF9E7F1DE1B826F46F2783623E，测试127C1505DC37FA3D733743EF032CF3F70919427EF7C0CA4D5BD94A1E3040D3C3。开发记录8A837A7278C6244F2909901F01C28C16B7129701E893C6148F9FAE9F8BF8EE96。原旧cache/loan/core WIP及AGENTS保持，不使用整Git差异替代本轮原副本patch。

root独立执行开发记录中的同12文件Vitest组合（单worker/no-file-parallelism/no-cache）：462/462，exit0，76.30秒；graph/application/contracts各noEmit均exit0。源码审查核私有生命周期、source18/global17角色、L5首次await捕获、实际ready包/完整response校验、材料重核、真实权威任务与写后精确状态、外层COMMIT边界。自动测试全过不代源码/真实SQL反例验收。

## 已确认缺陷：捕获身份的ignoreRevision未与保存来源闭合

root源码发现新store relations()匹配analysisResultFingerprint/configurationHash/sourceManifestHash/ignorePolicyHash，却遗漏同一capsule.sourceIdentity中的ignoreRevision。L5重算bindingHash和A2真实task身份自洽不能证明候选修订来自保存题目/答案材料。此处应认证保存来源修订，不是要求历史结果等于当前workspace配置，也不改变A→同快照再晋升的历史可读语义。

实际复现入口为root自有忽略目录 .benchmarks/r1-independent/probe-frozen.ts；实际命令 .\node_modules\.bin\tsx.CMD .benchmarks/r1-independent/probe-frozen.ts，exit0。对上一轮保存的16份真实main source18前库（四题型×project/legacy×空/非空规则）复制成独立新库，用冻结Sol实际GraphStore/core/A2运行。迁移后全部原表行、成绩/ready材料保持；Sol既有缓存迁移12也会追加，明确不将其当R1独立集成结果。原16库完整文件hash前后保持，零HTTP/密钥/GUI/导入代码执行。

每份库正常候选prepare→真实reserve/promote→双库锁内append→read→failed补偿通过。随后仅把identity.ignoreRevision由保存0改成1，或保存1改成2，给新taskId并重算全部L5摘要，其余真实包/来源/响应不变。16/16 prepare均错误接受；16/16可实际append、read，并关闭重开后仍read接受。prepare本身零写，但后续真实SQL可持久化错来源修订。复现完整收据在 .benchmarks/r1-independent/runs/48769e08-4da0-4a43-b5c9-c412e02f4666/receipt.json；不包含原源码，原试验材料保留。

分类为R1新核心产品缺陷，当前拒绝独立接受及集成/Git。预期：保存来源修订与候选不一致应在prepare/read/持久行重开校验固定INVALID_RESULT失败关闭；自己重算摘要不能跳过。正确匹配及历史current activation改变仍应可读，原SQL/题目/成绩/源码/占用不变。只修R1 store/test/自己的开发记录，补实际正反例，原公共契约/存储层冻结。下一交付保留旧冻结材料，重新精确hash/patch与349原基线核对，root独立再验。

## 未验边界和规则评估

已实现R1内部候选核心，独立12文件/类型通过，真实SQL反例未通过，整体未验收；真实GUI0，实际provider兼容/质量、exact prepared当次许可、跨库completed公开发布/补偿编排、全参与者停止及统一恢复均未验。无本轮Git写或main产品集成，无新增AGENTS规则：原有限DTO字段投影及来源/摘要规则已覆盖该遗漏，应补具体回归而不重复规则。

## 修正版独立复验与精确main集成

root核原Sol修正完成并冻结。最终manifest SHA 0004684CAB9D787A9AC9A503A37CF6674091A6F10159CF63136D5EAA257B2B25、patch SHA 8BA029BA03383B0E56B6E00C661DF28190E31C603D21A8A540E32D3B6E60BBD7，352个after文件逐项匹配，反向patch检查exit0。相比上版352文件仅核心、其测试和自身记录3文件改变，其余349字节相同，原349基线不重置。核心 SHA 0C9E9A49BF4274C7C628DA71366F415101E5930684C04A3950BDAB734A08F45A；产品窄修只在relations追加候选ignoreRevision与实际保存capsule.sourceIdentity.ignoreRevision等值，不替代为当前workspace修订。

root在5170独立原12文件478/478（86.22秒），graph/application/contracts noEmit均exit0；自有probe-fixed.ts对原16份真实旧库副本复验，正常prepare/实际A2及锁内append/read/失败补偿保持通过，重新算摘要的错保存修订prepare固定拒绝且零SQL写。直接SQL模拟原版已保存错行后，read及构造重开固定拒绝，不修改坏行、成绩、题目、源码、任务或占用。原材料hash保持；收据 .benchmarks/r1-independent/runs/57a906bb-ff11-4252-9979-0dc83b09ce40/receipt.json。不是重复使用开发报告。

main只手工加入index的import/私有字段/constructor实例/migrate/close五处；新核心、开发记录与单项shared角色测试精确复制冻结文件，index/capsule角色期望窄适配，保留main11与Sol12差异。集成前400原文件hash基线另存；集成后仅四个授权旧源测试变化，396原文件保持、零丢失，随后协调记录另单列。未整份覆盖index、AGENTS或Sol缓存/WIP。

main首轮原12文件477/478：新升级测试查询改12→11后，global期望漏加main既有11。实际main原remote迁移给两角色安装11，global另13/17；这是root集成测试期望错误，不是产品缺陷。仅改新测试global期望为11/13/17，project仍11，查询及全部行保持/零结果/重开断言不变。原完整12文件再跑478/478，exit0，81.29秒。集成后graph/application/contracts三包noEmit已独立exit0，没有再改产品源码。

root main probe-main.ts实际16/16通过，收据 .benchmarks/r1-independent/runs/a76c79ac-f376-43d9-8fa6-ada03e6d73d1/receipt.json：真实pre18升级仅追加18及空结果对象，全部旧表行与ready材料保持，没有Sol12；真实A2占用及结果append/read完成；completed候选补偿拒绝且成功历史保持。实际设置修订增加并同snapshot再次晋升后，正确历史仍可读，使用正确保存修订的新候选仍可prepare；新失败候选可精确补偿，旧completed不变。错保存修订恰好等于当前设置修订仍prepare拒绝、零写；直接SQL错行read/重开拒绝且内容保持。原16库hash保持。上述探针均调用实际模块/SQLite，无HTTP、密钥、GUI或导入代码执行；自有材料保留，零递归删除。

只独立接受R1内部SQL核心及其精确main支持，不接受整条语义发送/发布。构造重开执行同步schema/摘要/列与保存来源关系校验，完整异步L5/ready response重验在prepare/read执行；不得把constructor说成所有语义校验已完成。裸内部candidate不是published/current/mastery；真实外层COMMIT、当次exact prepared许可、全当前性、跨库completed门与补偿编排、统一参与者停止恢复仍属后续必需门。GUI0，真实模型质量/兼容、签名/干净Windows仍未验。AGENTS新增/修订0，已有来源投影与写后状态规则覆盖，本轮用缺陷和回归闭环补证据。仅验收范围由root核差异/远程后Git收尾，真实SHA执行后另记。

## 实际Git回执

root普通提交f095bfc7a6e1b28e2a7dfc39571fe5966885ee06，13文件仅已验R1产品/测试/自身与独立记录、实施计划及准确协调记录/上一L5回执。cached diff --check通过，无未暂存产品范围；已知origin为finiteaxiom/project-x-ray、main，推送前remote/main原52db0c9，push exit0，另ls-remote确认remote/main精确同f095bfc。提交后main清洁，无合并/重置或开发Git。此回执及后续B1派发是下一协调记录范围，不自称已包含在该SHA。
