# Windows artifact reader 设计记录（4B-M2）

日期：2026-10-04
目标：按四批恢复队列，仅形成 Windows artifact reader 的设计方案和本开发记录，供 root 独立复审。设计基于已冻结 manifest Stage B；不实现 reader，不修改既有协议或实现。

## 边界与实际材料

- 依据仓库 `AGENTS.md` 与 `docs/plans/2026-10-04-four-batch-resume.md`：root 独占 source-loan 技术窗口；Luna 仅负责 4B-M2 两份文档；四批结束后暂停并与用户讨论后续计划。
- 读取 `docs/plans/2026-10-04-windows-artifact-manifest.md`、冻结 protocol 及其独立复核记录，确认 root/路径边界、schema、原始 Authenticode `Status`、ASAR 副本、资源上限、child 事件/超时、stdout/stderr/report 限制和 cleanup 门。
- 读取 `packages/analyzer-core/src/secure-read.ts` 与 `packages/analyzer-core/native/secure_reader.cc`。源码 reader 限制 2 MB、64 KiB 分块后合并为 Buffer；Windows root/file handle share 含 read/write/delete，relative open 一次传入多组件路径，post-open 检查最终 handle identity/containment。没有递归目录身份快照、no-follow component walk、streaming hash 或签名持锁。设计据此拒绝复用。
- 查询 Microsoft Learn 的 `NtCreateFile`、`CreateFileW`、`FILE_ID_EXTD_DIR_INFO`、`Get-AuthenticodeSignature`、`WINTRUST_FILE_INFO`、`WINTRUST_DATA` 和 `SetFileInformationByHandle` 文档。文档支持 API 级设计参考，但没有任何目标机器运行时或实际 artifact 证据。

## 分析结果与闭环

没有实现、探针或运行时测试，因此没有产品/测试/环境失败，也不编造“实现→测试→修复”的闭环。只读分析确认两个需要协调方决策的 API/协议缺口：

1. v1 要求原样保存 `Get-AuthenticodeSignature.Status`，而文档参数集只有 path 或整份 byte array；没有 handle 参数或显式 offline flag。`WinVerifyTrust` 可接收带 `hFile` 的 `WINTRUST_FILE_INFO`，`WTD_CACHE_ONLY_URL_RETRIEVAL` 可禁用网络检索，但返回 provider/HRESULT 语义，不能静默冒充 cmdlet 的原始 Status。方案因此默认建议先令 Authenticode `not-evaluated`/scan `incomplete`，由 root 决定保持协议或另行审查 schema 变更。
2. 冻结 child stdout 上限为 64 KiB，而 5,000 个文件的完整 DTO 无法保证在此限额内；方案提出 output 私有目录内有界 sidecar，并要求 parent 依 handle identity 核验。这是 reader 内部传输提案，尚待 root 接受。

方案还把 PowerShell 5.1 无新增 binary 的 P/Invoke bridge、逐组件 `RootDirectory` + `FILE_OPEN_REPARSE_POINT`、受限 share、目录成员集重核、ASAR 私有副本、child 生命周期和按完整 identity 清理列为目标 Windows 实测门。没有把 Microsoft 文档当作本地运行时保证。设计接受后，才需要实现与安全 fixtures。

## 文档变更及验证

- 新增 `docs/plans/2026-10-04-windows-artifact-reader.md`：Windows API、句柄遍历、散列、签名冲突、ASAR、副进程、sidecar 和 cleanup 方案，以及 review 问题和未来接受清单。
- 新增本记录。
- 写入后使用 PowerShell `Get-Content -LiteralPath` 回读两份文档，并以 `Select-String` 检查 API、Authenticode 冲突、sidecar、未执行/未实测和规则评估段落；两份文件均有最终换行。逐行尾随空白扫描最初发现日期行的 Markdown 双空格，已移除并复查为 0。
- 没有运行测试、typecheck、build、reader、真实 artifact、ASAR parser、Authenticode、PowerShell helper、Electron、GUI、安装器或凭据流程。也未做 Git 操作。

## 规则沉淀评估

本轮不改 `AGENTS.md`。尽管已发现 cmdlet 接口与同对象/离线要求的设计冲突，但尚无本地目标运行时实验或实现证据；现有 Stage B 与 Windows 安全经验已要求遇到不能证明的路径即停止复审，不足以新增一条已验证工程经验。规则沉淀依据是证据门槛，不是新增规则数量。

## 未完成/未验证

- root 尚未接受 reader 设计；签名协议取舍、sidecar 与 P/Invoke bridge 方案等待 review。
- 所有 HANDLE/reparse/share/mapping、流式 hash、WinVerifyTrust/Get-AuthenticodeSignature、ASAR parser、副本 ACL、child close、精确清理行为均未在目标 Windows 运行时实测。
- 没有实现或真实 artifact 清单；本批交付只是一项可复审设计，不能宣称 manifest reader 或阶段 B 已完成。
