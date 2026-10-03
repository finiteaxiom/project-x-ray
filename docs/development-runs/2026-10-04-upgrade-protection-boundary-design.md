# 4B-B0：Windows 升级保护边界设计记录

2026-10-04，开发-Sol；仅当前5170 worktree 两个新文档。对应 [设计](../plans/2026-10-04-windows-upgrade-protection-boundary.md) 与 [派发计划](../plans/2026-10-04-upgrade-protection-boundary-plan.md)。不是生产保护实现或界面验收。

## 目标与冻结边界

将已接受的4B-A自有闭库夹具能力转化为可派发的生产文件边界设计：确定整组原始保全内部端口、Windows实际HANDLE/分享范围、原包/副本/原库打开三道门、后续最小切片。原4B设计、4B-A三文件、所有核心/desktop/依赖/AGENTS 与已有未提交工作冻结；不对齐HEAD，不整体同步，不执行Git收尾。

本轮派发计划 SHA-256 为 `C4A9F2DC106F34A53C580AD471AE2D0161145E79C305C4808D638CBD383CA7C3`；本 worktree HEAD 是 `455d4ad50830ee2495b70927e51caf830a4efbb8`。主目录只读检查实际main入口，不声称主目录当前HEAD与worktree相同。

## 实际读查与设计修正

1. `rg -n 'NtCreateFile|CreateFileW|FILE_SHARE|RootDirectory' packages/analyzer-core/native/secure_reader.cc`，并读取对应CreateScope/OpenRelativeFile实现：源reader持有实际HANDLE，但根和文件均共享写/删除。读取secure-read.ts确认2MB源码限制。结论：不改变reader契约；拟新增graph专用raw文件端口。最初路径检索的扩展名范围没有覆盖实际`.cc`，纠正为精确文件后读取；这是检索问题，不是产品失败。
2. `rg -n 'whenReady|new AnalysisBroker|startOwnedApplication|new ExplanationPolicy'` 分别核对两个checkout的main：main真实入口直接broker；Sol入口有待集成startup ownership/policy。设计明确分列，不能以未集成入口为main前提。
3. `rg -n 'new Database|journal_mode|migrate\(|busy_timeout' packages/graph/src/index.ts`、`rg -n 'new GraphStore|storeForRepository|requireSnapshot|requireNavigation' packages/application/src/index.ts`：确认constructor可写打开/WAL/migrate和global、项目扫描及懒打开的门前风险。只读package.json确认当前graph测试与工具链；拟议新脚本标为尚未存在。
4. 本轮web只读官方Microsoft和SQLite API文档，具体链接列于设计末节。确认RootDirectory/ShareAccess/FileIdInfo基本语义；LockFileEx不约束mapped view。没有运行Windows实验。一次GetFileInformationByHandleEx网页请求返回工具Internal Error，未把它当作API不可用证据；身份依据改用已成功读取的FILE_ID_INFO与现有native实现。
5. 设计评审中的关键修正：整组share=0只有普通文件访问范围；目录HANDLE不禁止任意子项增删；hash不能证明停写；包marker不是任意断电下的持久化保证；SQLite filename不能消费闭库HANDLE。因此raw receipt、staging材料和未来production capability严格分开，S1可推进，S3必须先解决同SQLite实例受限文件I/O交接。

文本复核另修正两处边界：root 的非数据库 Electron 文件不应被当作额外项目库拒绝；既有 upgrade-preservation 公共父目录应核验后打开，只有本次 operationId 目录/新文件要求排他创建，避免合法 retry 被已有父目录阻断。以上是“读查→发现设计缺口→修订→文本核对”，没有实现/运行失败，不编造产品测试闭环。4B-A root报告的独立验收仅作为派发前提，不重写成本轮已运行测试。

## 实际验证与未执行

协调方复审后，本轮仍仅修订原两份文档。只读 `rg -n 'loadProjectStores|endsWith|slice\(0, -7\)|stableId\("repository"|legacyStore'`，同时核对主目录和本worktree的application：当前项目扫描只有`.sqlite`后缀与主干截取，新索引ID由safeRoot生成；未发现原库零SQLite阶段可读的独立受信项目登记。原设计“按application真实规则校验/注册身份”表述过强，已改为S1布局槽位、安全候选名及物理集合，S2才检查语义/内部一致性；pre10无可信来源拒绝晋升。明确legacy-only/global历史项目数据是兼容情形，不因多repositoryId误判角色，也不新建注册/搬库组件。

第二处修订用有限表区分四类完整但结构未知的raw-only材料，与super-journal/明确外部依赖等无法穷尽集合的拒绝。S1成功只为`raw-material`，marker改名`raw-material.complete`，恢复/生产批准固定false；S2依赖不明必须在SQLite副本open之前拒绝，不自动执行文件内SQL或访问外部引用。后续验证报告独立，不改raw marker。恢复依赖预检解析器和legacy身份门均尚未实现/实验；这是“实际读查→修订→文本核对”，没有新运行失败或测试。

实际执行仅只读Get-Content、rg、git status/rev-parse、Get-FileHash，新增两文件后只做文本/存在性/冻结hash核对；官方API网页只读。没有SQLite打开、数据库复制/恢复、native构建、child、进程枚举、用户文件/凭据扫描、GUI、依赖安装或安全设置修改。本轮测试数：无；不沿用旧测试数量冒充本轮结果。

待实测：逐级目录no-follow组合与身份/分享、root/联接替换、已占用main/sidecar、映射例外、全组集合变化、大文件/空间与I/O失败、chunk取消/GC/pending close、marker退出切点、Node/Electron双运行时、staging已知/未来/profile角色拒绝、completed/current/源码保留、同实例SQLite VFS及交接竞争。具体下一文件和命令见设计S1/S2/S3；本轮不授权实施这些文件。

失败后原包不覆写原件；partial仅按本操作持有身份清理，新retry用新ID。未来生产首开也可能触发恢复，必须完整原包和副本验证先通过；同SQLite实例的受限VFS尚不存在，生产开库能力保持不可用。签名、干净机器、GUI与发布门均未完成。

## 工程经验判断

AGENTS新增/修订0条。现有规则已覆盖实际HANDLE、napi_ref与保留工作区；本轮新结论是静态源码/API和设计判断，没有新的运行复现，不能转写为已验证工程经验。只维护本checkout的两份过程/计划文档；交付冻结hash另由最终报告给出，以免文档自包含hash循环。
