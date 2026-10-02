# 2A-S：所有权语义评估设计

协调方 2026-10-02 复审修订后接受设计并复制原两文档到主 checkout；补充辅助分/数据保留政策与实施前复核门。对照当前GraphStore.saveOwnershipAttempt普通INSERT，纠正原文的“现有INSERT OR IGNORE”事实表述，保持同ID冲突拒绝规则。以下保留开发时草案状态及设计检查记录，不改写成实现/GUI或模型质量验证。仅下一批精确纯契约模块获实施派发，持久化/传输/UI仍依赖各自审查。

日期：2026-10-02；基线 `455d4ad50830ee2495b70927e51caf830a4efbb8`。

## 授权与冻结边界

仅新增本记录与 `docs/decisions/0008-evidence-constrained-ownership-semantics.md`。ADR明确草案未接受。保留上一接线批次24文件及原AGENTS改动冻结，不改任何实现、现有ADR/协议/AGENTS，不reset/ff、不读其他checkout，不做Git收尾、构建/native/dist/Electron/电脑操作、凭据或网络访问。协调方独立接受的接线技术复验不等于实际IPC/App GUI或真实远程接受。

## 实际设计依据

只读核对 `packages/ownership/src/index.ts`/现有测试、contracts的Question/Prompt/Submission/Grade/Attempt/Progress及版本、application的createQuestions/gradeOwnershipAnswer/getOwnershipProgress、graph的attempt保存/legacy读取，以及已接受ADR0006/0007。实际发现：grade.semantic固定not-evaluated、passed仅定位/结构；question内存保存且passed后删除；attempt保留semanticText但缺内部rubric；当前remote purpose只有feature-explanation，授权不能覆盖答案外发。因此草案提出独立purpose/披露及提交时的内部胶囊、追加sidecar，不更改旧确定性成绩和掌握度。

主已接受的新ownership semantic语料不在本checkout，未读取或运行；这里看到的是既有ownership-training样例与ownership单测源码，不能称已验证新的语义golden。未利用历史测试数量证明设计已实现。

## 设计反馈与一致性检查

无本轮运行失败，不编造实现→红测闭环。根据实际源码消除三个设计不一致：①不能在passed后从内存question恢复rubric，故拟议本地提交同事务保存受限胶囊；②旧grade schema仅允许not-evaluated，故远程反馈独立sidecar而非静默扩既有grade；③合法同节点多调用位置不能凭首条路径评分，故rubric绑定完整所选合法边序列，不能混拼或预算截断必要证据。

草案覆盖：离线/无模型未评估；独立逐项目默认拒绝与答案披露；固定criterion及纯引用验证；question/attempt/rubric/provider/快照/配置修订全绑定；候选迁移与独立版本；追加结果/旧记录不改写；共享单lease、取消/幂等、退出及迟到阶段；引用正确但文本错误/无引用/合法备选/矛盾不足unknown/注入/提前泄露/invalid输出矩阵；后续精确最小文件与依赖、实际GUI/服务分层验收门。

验证仅静态文档核对：检查源码符号、路径、版本/迁移现状、覆盖矩阵与草案状态；检查两文件及Git差异边界和空白。本批不运行产品测试/types（没有代码变更），更不把前批或主checkout的测试晋升为本设计成功。具体验证结果在交付前补记。

交付前实际核对：`git rev-parse HEAD`仍为上述基线，`git status --short`仅较本批起点多出指定两文档，冻结实现文件仍保持原未提交状态；本批工具写入仅这两文件。`rg`核对当前Question 2.0.0/Scoring 2.1.0、purpose字面量以及迁移最高10，未发现已占用11。PowerShell静态检查两文档均有“未接受”、围栏平衡及关键授权/版本/未知/绑定/恢复/迁移/未验证覆盖词：通过（只是文档完整性检查，不验证语义算法）。`git diff --check`通过，仅已有Windows换行提示。没有执行产品测试、类型检查或构建；没有真实模型/OS测试证据。

## 未验证

所有新schema、rubric生成/验证、授权、迁移、胶囊及sidecar、共享跨purpose调度/单lease、UI、真实服务和语义质量均是设计，未实施。迁移11只是候选，版本与预算须接受/实施前重新核对。真实生产凭据/HTTP/项目外发为零实际操作，但本轮没有运行任何测量器据此证明未来传输安全。用户暂缓电脑操作不等于GUI验收完成。

## 工程经验判断

本设计轮无新增AGENTS规则：发现是对既有实现约束的设计推导，没有新产品复现/实施证据；相关证据/配置/跨库/迟到边界已有规则。前批已验证经验保持冻结，不改公共规则或其他checkout。

## 独立设计审查修订（2026-10-02）

审查确认方向成立，但指出三处规范不一致；本轮只修订原两文档，其他文件0写入：

1. 输出缺少承载限制ID的字段。新增必需 `limitationIds[]`；定义本地有限limitations字典、内容hash稳定ID、rubric内criterion允许集合与package一致性，限制与proof分离。supported/contradicted限制集必须空、证据/答案范围各1–8；insufficient限制ID必须1–8、证据/答案范围各0–8且仍校验归属。未知/重复/跨criterion或仅自然语言声称限制均拒绝。预定义answer-information-insufficient只是可选择的辅助评估条件，不声称本地已证明文本不足。
2. 缺步骤/混拼path的矩阵与完整合法所选序列资格门冲突。统一为call-path无法找到用户完整引用支持的合法edge序列则整题not-evaluated、零发送，保留本地失败attempt；不拆分“包内可支持命题”，不另建独立失败路径rubric。
3. “凭据泄露一律检出”的承诺不可证明。删除该泛化输出门，改为有限字段/来源白名单、应用API key仅认证header、header/body/原始响应不入DB/日志、不额外读取或扫描OS/Git/Codex凭据。自由文本中的任意秘密不保证识别，依靠明确答案披露及用户审阅；既有已知key精确字符串检查也不能证明任意秘密安全，不新增扫描器。

这些是设计审查发现，不是运行时缺陷或质量测试结果。协调方另报告Electron44.4.3/Node24.21.0真实worker产物三条bootstrap/state命令通过，仅作为协调方技术窗口证据，不属于本设计验证，也不证明main/preload IPC、App GUI或真实远程成功。本轮仍无运行质量证明，ADR状态保持未接受，接线冻结不变。静态核对verdict规则、限制字典/矩阵及path资格条件的一致性，结果交付前补记。

修订后实际验证：PowerShell静态检查草案状态、limitationIds/allowedLimitationIds/字典及稳定hash、两类verdict集合规则、整题资格/零发送、限制与proof分离及不扫描凭据条款存在，且原两处矛盾句已删除：通过。`git diff --check`通过，仅原有换行提示。只修改指定两文档；未运行实现、schema验证器、模型质量测试或其他技术窗口，本轮无新增工程经验。

静态检查首轮因断言的短语“不额外读取/扫描OS”与文档实际完整句“不因验证输出而额外读取/扫描OS”不同而失败；属于检查词串缺陷。对齐实际完整句后复跑通过，未为通过检查删除或弱化文档门禁。
