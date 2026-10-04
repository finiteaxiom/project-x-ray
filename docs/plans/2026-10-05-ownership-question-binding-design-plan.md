# 2D-S4-D：原题绑定与当前性接线的具体设计

2026-10-05，原第二批，原Sol/medium仅5170；A1已独立接受main d27f1a1f56d2010b595480e42fd6307035722923。你的HEAD仍455d4ad与全部已核冻结WIP保留，不整体同步/重置。四批结束暂停，不第五批。

真实依据：ownership/index.ts createQuestions/question由快照/题型/variant确定id、prompt、checks，retryOfQuestionId又受历史attempt影响；application gradeOwnershipAnswer只从私有questions map取题、首次await前捕获，提交后删除题；graph capsule.prepare/save仅私有receipt暂存questionPreimage，SQL长期只保存attempt/capsule及projection，并不保存完整原题认证材料。S1历史读取仍prepare-only/not-checked，不能由自洽questionFingerprint/rubric/capsule重hash恢复原题授权。已接受共享任务设计第4节明确此门必须先解决，不能以当前纯DTO或历史包跳过。

本任务不是再次写宽泛ADR或实现整个application。只新增你自己的docs/plans/2026-10-05-ownership-question-binding-design.md与docs/development-runs/2026-10-05-ownership-question-binding-design.md；其他源/已冻结A1、contracts、S2、旧生产WIP及AGENTS全部不改。root同期派Luna仅main纯task record；你不依赖其活动源，不读main或复制覆盖。

逐项阅读实际ownership generator、question schema/preimage、gradeAnswer/rubric、application issue/submit/questions invalidation、graph receipt/save/read/current activation/配置锁及现有真实回归。选择可实现的原题绑定方案并说明适用及拒绝历史的精确边界。必须回答：

1. 四题型、完整备选call-path边序列/排序、variable角色重复索引、retry历史和variant选择如何重建或验证完整canonical question；id/variant同名、重hash所有材料仍不能掩盖假的prompt/objective/checks/证据范围。不能用模型判断，也不能复活已删map题或让renderer提供所谓可信question。
2. 如需提交时补存完整可信preimage/生成依据，给唯一选定的版本化字段/表/最大字节预算、适用role、新提交原子写入与旧历史读取行为。仅建议未分配迁移号，root实际接受后再分配；不重写原attempt/确定性分/mastery/capsule/source，不伪回填旧认证。preimage或hash本身不能证明出处，说明如何由真实源码generator/私有提交receipt及SQL内核验建立保证。
3. 后续同步revision barrier怎样核实际已保存材料、source/settings/global实例和完整preimage；首次await前捕获，global→settings→source锁序、真实activation/config/ignore/provider/独立permission/ownercontext/attempt与rubric全部重核，WeakMap一次性私有receipt及close/async拒绝。历史read不能产生发送许可；设计分清原题合法性与当前性，不仅列字段。
4. 给依赖已验S1/S2/L2/A1及main实际adapter的接缝，完整bodyDigest来源、预算、auth/context撤销与跨库发布门。此设计不实施transport、durable reserve或worker恢复；明确它们仍是启用两用途发送前的门。
5. 形成最小实际实施切片和精确文件清单/契约/迁移建议，最小真实索引→发题→提交→重开→绑定校验、legacy/project双布局、A→B→A/配置变化、重hash伪造、异步替换及SQL故障零写矩阵；标待执行，不把旧自测/报告当本轮验证。

优先复用现有generator和明确投影，避免另写一套评分器/图算法或无限保存全快照/答案副本。若现资料不能唯一证明旧题，则明确旧语义材料不可发送但本地历史可读，不猜修或要求用户重新授权整个开发流程。设计反馈记录实际源码依据、确认/推测区别，冻结后root审查再派代码。AGENTS0允许，无Git/重型/native/Electron/GUI/网络/凭据扫描/导入项目执行。A1保持冻结，等待后续收到独立接受回执。
