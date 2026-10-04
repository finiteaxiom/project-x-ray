# 4B-M4 单文件 HANDLE 桥接独立审查

2026-10-05；root；主 checkout 起点 `44810ceaf7c7c7b296d0b699813b04e8ca25cb6e`。原 Sol 在5170交付四文件后已冻结；本轮接受仅内部单文件读取支持及自有 fixture 回归。完整 Windows artifact reader、发布、签名与 GUI 未完成，不把本轮通过改写为原 M2 全部门通过。

## 实际范围与来源

审查完整库、probe、测试及[开发反馈](2026-10-05-artifact-handle-bridge.md)，对照[批准计划](../plans/2026-10-05-artifact-handle-bridge.md)及已接受 M3 生命周期端口。逐文件确认 main 目标原先不存在，按精确 SHA 复制四文件；未复制 Sol 分支、index、broker、缓存、loan、native、二进制或任何其他未验实现。复制后主 checkout 再验。既有用户内容未覆盖。

| 文件 | 冻结 SHA256 |
| --- | --- |
| windows-artifact-handle-bridge.ps1 | F0E133F88AA89B1EF7B97CAF9C14D8B93FE1BD33715621DBBBBDC72984142B47 |
| test-fixtures/windows-artifact-handle-probe.ps1 | 21DDF723B827939AA89883B354DDBA657C6129CDF45C2338ECDD1A3650927F5D |
| windows-artifact-handle-bridge.test.ts | D76B7085A59564CBD0E6958503EA3481D331426FA337E0CEA9C69282309ACAF6 |
| 开发记录 | 1E20DA63B64BC1C5B7F4A28E973A924D4516460F4197A3F01C0BE07A486C18D1 |

已验 M3 dependency `windows-artifact-reader-process.cjs` 在两目录相同且未变：56E8E7FF5EEBF4E398234233DB79AE9C8E6283AB6283445B85B9F36E5F2BC5E3。main M3 测试未变：39CBCACD31D6B7267A01DCD24C9F0D01993977181373B3F312CA6E930811EC58。Sol 原 broker、test、support 冻结 hash 复核不变；没有测试其后续活动图存储实现。

## 源码结论及实际系统边界

库导入仅定义函数；首次打开才以进程内 Reflection.Emit / PreserveSig 建立 P/Invoke，无 Add-Type、compiler、native addon、磁盘程序集或工作子进程启动。目标 PS5.1 x64 实际5.1.26100.9444、IntPtr8；其他运行时不由本次覆盖。

卷根是受限固定本地盘 bootstrap，随后逐单组件 NtCreateFile：持有父 HANDLE、RootDirectory、FILE_OPEN 和 OPEN_REPARSE_POINT，固定目录/普通文件类型选项、只读访问及 share-read；异常不放宽或重试。拒绝 UNC/device/ADS/点或空组件、模糊尾部和保留名，不以 resolve/realpath/字符串前缀授予归属。完整父链到释放前保持；每级核 disk、类型、reparse、完整64位 volume serial及128位file ID。API布局参考 [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)和[FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)，布局文档不是运行证明。

同一叶 HANDLE 使用固定1MiB native及managed缓冲顺序 SHA256，EOF/计数与开读长度核对，2GiB代码上限不等于实测2GiB。实际较大 fixture 为3MiB+17；读前后身份、类型、属性、长度、allocation、links及creation/write/change核对，last-access合理排除；父目录仅复核身份/类型/属性。实际 held parent 仍可新增成员，不能称目录快照不可变或 complete。

逆序关闭仅在所有 HANDLE 确认后 released；CloseHandle失败保留未释放会话并固定错误，不用finally成功伪造原terminal。控制协议限制大小/深度/token/字段/重复key/类型，ReadAsync 支持真正stdin保持打开时的30秒超时。M3取消/deadline/consumer异常只在实际child close后cleanupSafe；强制终止不声称PS finally执行。固定错误/DTO不含原始路径、源码或异常文本。测试只执行明确受信桥接/probe内存ScriptBlock，没有修改Restricted执行策略，没有运行输入文件内容。

字面“零 OS 后代”门仍未满足：空PS5.1及桥接均出现一个conhost.exe；源码不自行启动compiler或工作后代，仅有限 census 未见额外进程。主审补验观察到的精确conhost退出，仍不是全过程审计、OS禁止后代或Job Object隔离。接受窄内部支持，保留完整reader此门；本轮没有修订原零后代门或宣称 full scanner 已可用。

## 独立实际命令及结果

| 目录/检查 | 命令或实际路径 | 结果 |
| --- | --- | --- |
| Sol桥接 | `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-handle-bridge.test.ts --maxWorkers=1 --no-file-parallelism --no-cache` | 26/26，77.80秒 |
| Sol类型 | `node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit` | exit0 |
| main原M3 | `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-reader-process.test.ts --maxWorkers=1 --no-file-parallelism --no-cache` | 28/28，4.05秒 |
| main精确集成桥接 | 同桥接命令 | 26/26，77.28秒 |
| main类型 | 同desktop noEmit命令 | exit0 |
| root三条实际生命周期补测 | `node .benchmarks/artifact-handle-review-0bfad57da7d24f43a992fda04e39a635/probe.cjs`，明确Sol可信源码参数 | exit0；release/cancel/consumer-failure均确认实际close与文件重开 |

旧M3独立50项是reader28加manifest22；本轮28只执行适用reader原回归，manifest未改，不能改写旧记录或把当前28称全50重验。没有本轮重型 build/native/dist/Electron/GUI 或生产artifact操作。

26项覆盖同handle hash/完整身份、零字节/Unicode/固定缓冲、多个失败前后handle账目、parent/leaf junction、ready持有、显式release、cancel/deadline/consumer失败、EOF/非法控制及保持stdin的超时。fixture开写/rename/delete被共享拒绝，释放后可重开。原writer确已关闭但mapping仍能修改字节；本机构造下桥接拒绝，unmap后可读。此一mapping构造不外推全部文件系统与映射。真实LastWriteTime setter在持有时sharing violation，释放后成功；读期间元数据变化、短读/read失败/CloseHandle失败是受控native端口模型，不能提升为已复现OS故障。file symlink EPERM原正确断言保持，junction实测不替代未执行file-symlink分支。

root额外使用唯一自有1MiB+19文件，真实M3控制三条PS路径，核ready hash和r+拒绝；按PID、名称、CreationDate绑定有限观察。每条observedConsoleHosts=1、exactObservedSurvivors=0、fileReopened=true，重新读取hash不变。所有owned材料保留，无递归删除或按进程名查杀。补测输出明确fullProcessAudit=false、jobObjectIsolation=false、zeroDescendantGate=false；没有从零存活取样推断全过程无后代。

## 接受、未验与反馈闭环

已实现并独立代码/回归验证：上述单文件内部读取及生命周期支持；精确main集成后26项与类型再通过。真实GUI已验证=0。原开发对环境/参数/join/mapping/零后代及metadata hook假设的失败已分列并修正；root本轮未确认新的生产缺陷，没有降低share、删除正确断言或修改安全策略。

未验：literal零OS后代、完整目录枚举/成员一致性、production reader/CLI、真实候选产物、材料保护写入/重开恢复、sidecar/ASAR、签名、真实OS关闭失败、其他mapping/32位/其他Windows版本、GUI安装升级卸载及干净机器。`snapshotStatus=incomplete`和`signatureStatus=not-evaluated`保持。没有API/key、网络外发或生产凭据操作。

公共AGENTS新增0：现有目标运行时原生桥接、HANDLE约束、安全材料及反馈门已覆盖；宿主/单次harness失败不升级成通用保证。当前支持可独立提交，不包含未验生产接线。后续继续原第二批2D-S1必要材料端口，独立文件边界见[实施计划](../plans/2026-10-05-ownership-semantic-material-port.md)；四批本地收尾或仅剩外部条件后停止派发并暂停automation，不第五批。
