# Windows Artifact Reader 设计（4B-M2）

日期：2026-10-04
状态：仅设计，等待协调审查方复核；本文不授权实现或运行 reader。

## 范围与依据

本方案只覆盖 `docs/plans/2026-10-04-windows-artifact-manifest.md` 的阶段 B 安全 reader 前置门。manifest schema、退出码、资源上限、签名原值和清理边界保持冻结。本轮只新增本方案和对应开发记录；不改协议、队列、AGENTS、源码、native、build、UI、package 或 lock 文件。

只允许 Windows 自带 PowerShell/.NET 及经审查的系统句柄 API，不增加 npm 依赖、`.node` 或其他 native 二进制。读取对象只限两个显式 artifact roots：`--portable-exe` 指向一个 PE 文件，`--app-dir` 指向需递归枚举的应用目录。不得从 cwd、环境变量、Git、当前 package 或源码目录补充 artifact 内容。

当前源码 reader 不满足此任务：[`secure-read.ts`](../../packages/analyzer-core/src/secure-read.ts) 限制 2,000,000 字节、按 64 KiB 读取并拼为完整 Buffer，且调用 `resolve`；[`secure_reader.cc`](../../packages/analyzer-core/native/secure_reader.cc) 的根句柄用 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`，`NtCreateFile` 收到完整相对路径而非单个组件，没有 `FILE_OPEN_REPARSE_POINT`，之后才检查最终 handle 的路径包含关系、类型、身份和长度。它没有 artifact 目录成员快照、受保护流式散列或文件锁定期间的签名流程，不能复用，也不能用 `realpath` 替代。

## 句柄树与输入路径

1. 两个根参数必须是显式、绝对的本地盘符路径。拒绝相对路径、UNC/设备路径、正斜杠、空组件、`.` / `..`、ADS 冒号、尾随点或空格及无法按受支持语法无歧义解析的输入；不调用 `resolve`、读取 cwd 或拼接候选路径作安全判断。首版只接受固定本地卷；其他卷类型、路径格式或 API 不支持时返回 `incomplete`，不降级到路径前缀校验。
2. 从盘符卷根建立初始目录 handle，再沿用户路径逐个组件向下打开。卷根用内部构造的 `\\?\X:\` 与 `CreateFileW` 目录语义取得并持有；用 handle 元数据核实它是磁盘目录、读取其 volume/file identity，之后的安全边界完全由持有的 parent handle 和子项 identity 建立。盘符别名只作为卷根的引导输入，不把盘符路径当作后续 containment 证明。
3. 每次子项打开均使用 `NtCreateFile`：`OBJECT_ATTRIBUTES.RootDirectory` 指向已验证且仍持有的 parent handle；`ObjectName` 只含一个 UTF-16 组件；`CreateDisposition=FILE_OPEN`；`CreateOptions` 含 `FILE_OPEN_REPARSE_POINT` 和按预期类型选择的 `FILE_DIRECTORY_FILE` 或 `FILE_NON_DIRECTORY_FILE`，同步读取时再含 `FILE_SYNCHRONOUS_IO_NONALERT` 并申请 `SYNCHRONIZE`。请求最少的 `FILE_READ_ATTRIBUTES`、目录的 `FILE_LIST_DIRECTORY` 或文件的 `FILE_READ_DATA`。任何组件不能打开或句柄元数据不可用都失败关闭。
4. 每个打开后的 handle 用 `GetFileInformationByHandleEx` 读取 `FileAttributeTagInfo`、`FileStandardInfo`、`FileBasicInfo` 和 `FileIdInfo`。`FILE_OPEN_REPARSE_POINT` 的作用是打开 link 本身、绕过正常 reparse 处理；随后若属性含 `FILE_ATTRIBUTE_REPARSE_POINT`、类型/目录属性不符合预期、不是磁盘对象、file ID 或长度不可读取，即停止并标记不完整。完整 identity 至少包含卷 serial 与 128-bit file ID。不得用最终路径、字符串前缀或 `realpath` 作身份替代。
5. `--portable-exe` 的父目录逐级打开并持有，最终文件以单个 basename 相对其 parent handle 打开；manifest 路径仍是该根下的相对文件名。`--app-dir` 本身也从卷根逐级打开，保留最终目录 handle 后再枚举其内容。若 portable 文件的完整 identity 同时出现在递归 app-dir 清单中，首版拒绝以避免同一物理对象落入两个 rootId；不能完成该 identity 比对时标记不完整。

`NtCreateFile` 文档定义了 `RootDirectory` 相对打开、`FILE_OPEN_REPARSE_POINT`、类型选项、同步选项和 share-access 兼容规则；`FILE_ID_EXTD_DIR_INFO` 提供成员名、attributes、reparse tag、size/change time 和扩展 file ID。对应资料见[官方 NtCreateFile 文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandleex)、[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)和[CreateFileW 共享规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)。这些文档说明可用 API 的契约，不证明本 helper 在目标 PowerShell/文件系统上的竞态保证；该保证仍须用自有 fixture 在目标 Windows 运行时验证。

## 目录成员集与文件散列

- 目录 handle 只申请列举/属性权限，share mode 固定为 `FILE_SHARE_READ`，不含 `FILE_SHARE_WRITE`、`FILE_SHARE_DELETE`。文件 handle 只申请读数据/属性权限，share mode 同样只含 `FILE_SHARE_READ`。不因 sharing violation 放宽权限或重试。Windows 的共享检查双向约束现有和后续 open；省略 write/delete share 用于拒绝不兼容写入、删除和重命名，但不视作未经目标运行时验证的通用“不可变快照”。
- 在每个目录的同一个持有 handle 上用 `GetFileInformationByHandleEx(FileIdExtdDirectoryRestartInfo)` 开始枚举，并用 `FileIdExtdDirectoryInfo` 读完所有缓冲页。包含隐藏文件；记录每个直接成员的精确 UTF-16 名、identity、attributes、reparse tag、size 和 change time。禁止跟随任何 reparse point；出现任意 reparse、不可识别类型或同一目录存在 Windows 不区分大小写的名称碰撞时，该 root 不完整。
- 依据枚举项的精确名称，通过 parent handle 逐项以 no-follow 方式重开，并核对枚举 file ID 与已开 handle 的完整 identity；发生替换、缺失、权限/锁冲突或身份不匹配时停止。持有目录和文件 handles，直至签名/ASAR 读取和最终核验完成。
- 对每个普通文件，在同一个只读 handle 上以固定缓冲（建议 1 MiB）顺序读数据，并增量计算 SHA-256；不用整文件 Buffer。记录开读前及读完后的 volume/file ID、disk/regular 类型、attributes、EOF length、last-write/change time。读字节数须等于前后 EOF length，且前后 identity、长度、相关时间/属性都相同；任一读错、短读、超限或差异都丢弃该文件 observation 并令扫描不完整。散列只证明本次从该 handle 读到的字节，不证明 build/source 来源。
- 对每个目录，在递归工作前后各取一份完整、排序后的成员向量；需逐项相等（名称、identity、类型/reparse、长度及用于检测变化的元数据），否则不发布 complete。根目录层级和全局文件计数同时受冻结限制：最多 5,000 个文件、目录深度 64、单文件 2 GiB、两个 roots 合计 8 GiB、总时间 15 分钟；超限立即 incomplete，不截断后报告 complete。实现按上限前置检查并用溢出检查累计字节。

共享模式可以拒绝与持有 handle 不兼容的并发访问，但设计不能据此宣称已阻止全部既有映射写入、文件系统过滤器或特权原始写入。阶段 B fixture 必须分别验证已存在的写 handle、可写 mapping、扫描中写入、删除/重命名、目录成员增删及 reparse 替换；如果任一情形能在最终仍返回 complete 的同时改动被散列字节或成员集，方案不通过。打不开或无法证明时返回 incomplete，不使用较宽共享标志补救。

## PowerShell/.NET 到系统句柄 API 的桥接

受支持的功能边界需要 `NtCreateFile` 逐组件打开及 `GetFileInformationByHandleEx`、`ReadFile`、`SetFileInformationByHandle` 等句柄 API；纯 `System.IO` 的 path-based open 无法表达 `RootDirectory`。建议 reader PowerShell child 通过进程内、无编译子进程的 P/Invoke bridge 调系统 API，再以 `SafeFileHandle`/同一 handle 的 `FileStream` 读取；SHA-256 使用 .NET 增量哈希 API（或经审查的 CNG `BCrypt` 增量哈希），所有 native layout、状态码和 handle 生命周期需在目标 Windows PowerShell 5.1 实测。

本轮不决定具体 bridge 代码。若采用 `Add-Type`，先证明编译/执行不会产生未受控后代进程；若做不到，应验证进程内 Reflection.Emit P/Invoke 或停止并提交复审。不得以新增 `.node`、外部 compiler/native binary、路径字符串检查或现有源码 addon 替代。本方案不执行任何此类探针。

## Authenticode：冻结协议与系统句柄 API 的冲突

冻结的 protocol v1 要保存 `Get-AuthenticodeSignature` 返回的精确 `Status` 字符串。PowerShell 5.1 文档只给出 `-FilePath`/`-LiteralPath` 字符串路径参数或 `-Content` byte-array 参数；没有 documented handle 参数或 offline 开关。`-Content` 会要求提供整份 byte array，也不解决远程检索约束。静态文档因此不能证明 cmdlet 读取 reader 已散列的同一对象，也不能证明调用绝不产生网络请求。这里不推断 cmdlet 一定联网；结论只是当前证据无法证明不联网。

同对象且可显式禁网的系统候选是 `WinVerifyTrust`：`WINTRUST_FILE_INFO` 可同时提供非空 `pcwszFilePath` 与指向已打开文件的 `hFile`；`WINTRUST_DATA` 的 `WTD_CACHE_ONLY_URL_RETRIEVAL` 明确阻止签名检查网络检索，状态句柄按 `WTD_STATEACTION_VERIFY`/`WTD_STATEACTION_CLOSE` 成对处理。它返回 trust-provider/HRESULT 语义，不保证等于 PowerShell cmdlet 的 `Status` 字符串；其 signer 摘要也须独立核实。

官方资料：[Get-AuthenticodeSignature 参数集](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticode-signature?view=powershell-5.1)、[WINTRUST_FILE_INFO](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_file_info)、[WINTRUST_DATA 的 cache-only 标志](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data)。

**本方案建议保持协议不变并关闭 Authenticode 完成门**：在协调审查方确认 exact `Status` 与离线/同对象读取都已证明之前，逐 PE 设置 `captureStatus=not-evaluated`、`rawStatus=null`、`signer=null`，总 `authenticode.status=incomplete`，scan 不得为 complete，退出码走既有 incomplete=3；不得先跑候选文件再把结果映射进去。若 root 要采用 WinVerifyTrust，先单独审查 protocol 变更，例如增加保留 provider 原始 HRESULT 的字段并定义有限 signer DTO/映射；不能把 HRESULT 静默改名为 `Get-AuthenticodeSignature.Status`。签名 child 仍须逐 PE 有 15 秒 deadline、传入 only token-mapped root-relative path 与预期完整 identity/hash，并用受限 handle 在调用前后复核 identity、length、SHA-256；关联只能按 rootId + 完整 identity/hash，不按 basename。

这项协议冲突意味着即使遍历、hash 和 ASAR 技术方案接受，也不能把签名标作已捕获或进入 complete manifest，直到 root 明确选择合规的解决路径。

## ASAR 控制副本

1. 从候选 `app.asar` 已验证且 share-locked 的原始 handle 顺序复制到本轮新建的私有 scratch file。目标通过已持有的输出 parent handle，以 `NtCreateFile(FILE_CREATE)` 排他创建，禁止覆盖或沿用已有名字；目标 handle 同样只允许 read share。
2. 复制时对 source 与 destination 同时计数/散列；计数、长度、source SHA-256、destination SHA-256 和原 observation 必须完全一致。副本建立后保存其完整 file identity 与长度。
3. 现有 `@electron/asar` parser 只接触此 scratch 副本路径，不接触候选路径。parse 前后重新从副本原 handle 核 identity、length、hash。只列 ASAR 元数据；不提取条目、不 `require`/加载 addon、不运行 JS/EXE/worker。parser 返回的条目数、JSON 元数据和路径长度仍受 5,000 项、32 MiB report 及冻结 schema 上限约束；parser exception 只变成固定错误码。
4. 副本及其目录在 parser 全部退出并关闭 handle 前不得清理。若 parser 必须重新打开副本路径，私有 ACL、目录句柄锁、独占创建和副本 handle share 需一起验证；任何身份/哈希变化导致 incomplete。

## 子进程、控制 DTO 与取消

- Node coordinator 以 `spawn` 参数数组启动系统 PowerShell 完整路径及仓库内固定 helper 脚本，`shell:false`、`windowsHide:true`、`-NoLogo -NoProfile -NonInteractive`；不从 PATH、cwd、环境变量寻找 helper，也不把用户路径拼入 PowerShell 命令文本。输入走有界、严格 schema 的 stdin JSON；代码只来自仓库可信脚本，不来自候选包。
- 一个长驻 reader child 持有树和文件 handles，直至当前所有签名子项、ASAR parse 和复核结束。清单 DTO 最多 5,000 条且单条/路径符合 protocol v1 上限；不要把全量清单写 stdout（每 child stdout 仅 64 KiB）。建议写入 output 私有目录内独占 sidecar，sidecar 的 handle identity、长度和 SHA 由 parent 按同一安全句柄规则重开核对；stdout 仅返回固定状态和 sidecar opaque token。sidecar 超过 32 MiB 或无法验证即 incomplete。最终报告仍遵守 32 MiB 限制。
- 签名结果每个 PE 一个 child，单条合法 JSON、stdout ≤64 KiB、stderr ≤4 KiB；console stdout ≤1 KiB。stderr 内容不回显，只映射固定诊断码。全扫描 15 分钟、每签名 child 15 秒；无有效 spawn、完整有界回复、exit 0 和 `close` 事件不得接纳结果。
- reader/helper 不启动子进程、job、外部命令或 compiler。Node 仅管理本轮持有的 `ChildProcess` 对象/PID；取消只终止本轮已成功 spawn 的精确 child，并最多等待 5 秒确认 `close`。任何 child 未 close，不发布 manifest，不清理 reader 可能占用的 scratch。若实现需要孙进程，阶段 B 停止并另行审查 Job Object 树级隔离，不能扩大普通 PID 管理范围。

## 输出目录与精确清理

`--out-dir` 必须不存在，并由本轮在受验证 parent directory handle 下独占创建；用同一逐组件 walker 验证 parent、拒绝 reparse，并通过 ancestor handle identity 与两个输入 root 比较是否在其树内或形成重叠。拒绝已经存在的目标；禁止仅靠字符串前缀判断“在 roots 外”。目录 ACL 仅给当前用户与 SYSTEM（如系统 API 可证明应用成功），输出目录和所有 scratch handle 保持受限打开。

清理只在所有子进程已观察到 close、ASAR parser 已返回且相关 handles 都已关闭后发生。对每个本轮真实创建并记录了 parent identity + child full file identity 的文件，cleanup 时从仍绑定的 parent handle no-follow 重开，比较完整 identity，再通过以 `DELETE` 权限打开的同一 handle 调用 `SetFileInformationByHandle(FileDispositionInfo)` 标记删除；目录只对本轮创建且确认空的精确目录 handle 自底向上处置。该 API 要求打开 handle 时具备 DELETE 权限，不能拿只读 reader handle 直接删。禁止递归 `Remove-Item`、按文件名清空、按路径猜删或删除未知对象。若 child/handle close、身份比对、ACL、delete disposition 任一无法确认，保留 run-owned 材料并返回固定 incomplete/error；不要用“清理成功”掩盖旧文件或未知身份。

Microsoft 对 [`SetFileInformationByHandle`](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle) 的文档明确要求 disposition 删除句柄在打开时具有 DELETE access。具体 Windows filesystem 对 NtCreateFile 所开 handle 使用 disposition 的兼容性仍需 fixture 验证；无法原子绑定确切对象时，不清理并提交复审。

## 阶段 B 实测接受清单（本轮未执行）

未来实现审查须在自有临时 fixtures 和目标 Windows PowerShell/Node/Electron 运行时证明：

1. 输入 root 与其每一级父/子 reparse、symlink、junction、卷类型拒绝；逐层替换和大小写碰撞均不会逃逸或选错 ID。
2. handle share 兼容性对既有/后建 writer、可写 mapping、删除、重命名和链接替换按预期拒绝；发生不可证明的变动时 observation 不会 complete。目录成员新增/删除/重排、同长度改写、读取中变化、损坏/缺失 file ID 都失败关闭。
3. stream hash 正好是同一 handle 完整字节，边界覆盖 2 GiB/file、8 GiB total、5,000 files、depth64 及整数溢出；内存随固定缓冲而非文件大小增长。
4. Authenticode 两种路线分别验证：现协议 Get-AuthenticodeSignature 的 same-object 与零网络保证是否能被真实 Windows API 证据证明；WinVerifyTrust 路线则核对 `hFile`、cache-only/no-UI、状态关闭、provider raw 值和 signer 提取。没有批准的协议/证据时只允许 incomplete，不准真实候选扫描。
5. ASAR parser 输入只有精确 scratch copy；parse 前后 identity/hash 相同；无候选 JS/addon 执行；副本写入/替换/解析错误都失败关闭。
6. child spawn/error/exit/close、超时、取消、stdout/stderr/sidecar/report 上限、未确认 close 时保留现场、精确身份删除、未知文件零删除。没有 helper grandchildren；若确有需求先独立评估 Job Object。

## 供协调审查方决定

1. 是否接受“签名接口冲突时保持 v1 并将 Authenticode 固定为 not-evaluated/incomplete”，或授权启动一个独立协议修订，把 WinVerifyTrust 原值与 signer 结构明确纳入新 schema。未作决定前不进入能生成 complete 的实现。
2. 是否接受 reader sidecar 作为不超过 32 MiB 的内部 DTO 通道，并按完整 handle identity 校验，解决“≤64 KiB stdout 无法承载 5,000 条记录”的冲突。
3. 是否接受 PowerShell 5.1 进程内 P/Invoke bridge 作为系统 API 实现路径；以实测无未管后代、精确 handle 语义和 API 布局为接受门。未证明时停止，不增 native addon。

只有 review 接受 reader 设计和这些门槛后，才另行派发 reader/signature helper 与 Windows-owned fixture 实现。当前不运行真实候选目录，不修改 manifest protocol，也不触发任何 build、安装、GUI、凭据或网络扫描。
