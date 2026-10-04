# 4B-M4 Windows只读HANDLE桥接

2026-10-05，开发-Sol；仅5170 worktree。基线 `codex/llm-explanations` / `455d4ad50830ee2495b70927e51caf830a4efbb8`，保留全部既有 modified/untracked。遵循 [批准计划](../plans/2026-10-05-artifact-handle-bridge.md) 和主checkout已接受M2设计。

## 交付状态与边界

新增且仅新增批准四文件：内部 `apps/desktop/scripts/windows-artifact-handle-bridge.ps1`、自有材料入口 `apps/desktop/scripts/test-fixtures/windows-artifact-handle-probe.ps1`、`apps/desktop/src/windows-artifact-handle-bridge.test.ts`、本记录。只读M3依赖保持 SHA256 `56E8E7FF5EEBF4E398234233DB79AE9C8E6283AB6283445B85B9F36E5F2BC5E3`，主checkout同字节。未改broker/cache/loan/native/UI/contracts/package/lock/build/AGENTS，没有Git写操作。

单文件/完整父链的窄实现与开发回归已通过；独立验收待协调方。没有完整reader或Windows发布完成结论。`snapshotStatus=incomplete`、`signatureStatus=not-evaluated`，未改manifest v1；没有生产CLI注册、真实artifact读取、签名/网络/凭据/ASAR、候选代码执行、sidecar/scratch、材料清理或重型构建。

字面“零OS后代”门未满足：空PS5.1与桥接PS5.1都实际具有一个 `conhost.exe`。桥接源码不启动编译器或工作后代；有限观测未见额外进程。此结果不能转写成OS禁止产生后代或完整进程树隔离证明，须由协调方独立核定宿主基线与原设计门的关系。

## 实现与官方依据

只在首次打开会话时使用进程内 `Reflection.Emit`，`AssemblyBuilderAccess.Run` / `DefinePInvokeMethod` / `PreserveSig`；没有Add-Type、编译器、写出动态程序集、addon或二进制。[.NET Framework API](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.typebuilder.definepinvokemethod?view=netframework-4.8.1)。库导入只定义函数，不打开被读对象或初始化native类型；实际验证初始化状态和程序集计数均为0。

接纳标准绝对本地固定盘路径；拒绝UNC/device/ADS、相对与空/点组件、尾空格点、保留设备名和超界组件/深度。卷根用 `CreateFileW(OPEN_EXISTING)` bootstrap并核fixed drive；其后每一级只用一个UTF16组件，`NtCreateFile(FILE_OPEN, RootDirectory=已持父HANDLE, FILE_OPEN_REPARSE_POINT)`。目录或普通文件选项、同步标志及最小读访问固定，share只为 `FILE_SHARE_READ`，内部适配器也拒绝改变访问、share或创建处置；没有放宽或重试。[NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[OBJECT_ATTRIBUTES](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes)。没有用前缀、realpath或Resolve-Path代替组件打开。

每级核disk、类型、reparse tag、完整64位volume serial与128位file ID；父链持有到显式释放。叶文件同一同步HANDLE顺序ReadFile，固定1MiB native缓冲及1MiB managed缓冲，逐块SHA256，不整文件装入内存，不输出字节。2GiB硬上限，实际大fixture为3MiB+17字节，未实测2GiB上限文件。64位计数先核余量再累加；EOF须与开读长度精确相等。核读前/后身份、类型、属性、长度、allocation/link count及creation/write/change时间；last-access不作稳定断言，因为读取本身可能影响它。父目录复核身份/类型/属性，不以目录时间断言成员不变。

目标仅Windows PS5.1 x64（实际 `5.1.26100.9444`、IntPtr=8）。手工布局及实测关系如下；不外推32位或其他平台：

|布局|x64尺寸/关键偏移|本轮实际验证|
|---|---|---|
|UNICODE_STRING|16；Length0、MaximumLength2、Buffer8|Unicode及引号组件逐组件打开|
|OBJECT_ATTRIBUTES|48；RootDirectory8、ObjectName16、Attributes24|真实目录链、parent junction拒绝|
|IO_STATUS_BLOCK|16，Information8|真实NtCreateFile成功/拒绝及out HANDLE回收|
|FILE_ATTRIBUTE_TAG_INFO|8；attrs0、tag4|真实parent junction的reparse诊断|
|FILE_STANDARD_INFO|24；allocation0、EOF8、links16、Boolean20/21|目录/普通文件与独立Node stat长度一致|
|FILE_BASIC_INFO|40；creation0、write16、change24、attrs32|实际读取、固定信息复核及变化注入|
|FILE_ID_INFO|24；volume0、128bit ID8|保留完整ID、重复重开稳定、不同文件不同；低64位与Node bigint inode独立一致|

结构依据：[standard](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_standard_info)、[basic](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info)、[attribute tag](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_attribute_tag_info)、[file ID](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)。布局是本轮目标运行时的手工实现及实测，文档本身不是验收。

## 承载与释放

probe用M3原start/ready/release/terminal协议。ready携有限身份、hash、计数、状态和目标运行时信息，不含路径/内容；Node consumer期间完整链仍活。明确release后逆序CloseHandle，只有全部关闭确认才发terminal released。库保留关闭失败的会话handles及 `released=false`；固定 `HANDLE_CLOSE_UNCONFIRMED`。Open异常也尝试有限回收；如回收仍失败则拒绝会话，不发成功状态，本轮helper以失败退出，由M3等待真实close确认OS资源已释放。

控制输入限制16384字符、深度4、30秒；只有当前协议需要的对象/标量，严格词法/状态校验拒绝重复及转义重复key、尾逗号、错误类型、额外数据。采用标准输入StreamReader.ReadAsync而非Console.In的同步包装，实际保持stdin打开的30秒timeout能自行结束并回收。EOF/非法控制/异常finally有限关闭；未正常release不伪造terminal。取消、Node deadline和consumer失败会由原M3终止精确owned child，结果只在实际close后cleanupSafe；不声称强制终止会执行PowerShell finally。

本机执行策略Restricted未改变。测试没有 `-ExecutionPolicy Bypass`、Set-ExecutionPolicy或权限调整；用 `-Command` 对两份显式受信本轮源码的内存ScriptBlock执行。绝不把输入文件内容作为代码执行。M3追加的helper路径由固定命令末尾注释消费，不解析成用户代码；两个源码路径由测试launcher固定，不来自start输入。入口仅是自有fixture harness，没有注册生产扫描器或提供读取任意artifact的产品能力。

## 原始失败、诊断与修正

首轮15项：10通过、5失败。确认均为测试/fixture假设，尚未据此宣称桥接正确：

- direct harness继承PS7模块环境，PS5.1 Security/CIM自动加载与M3不同；改为与M3一致的SystemRoot最小环境，不修改安全策略。
- 测试用join提前消除点段，误把合法文件加入拒绝样例；改为保留原始点段字符串。
- deadline低于readyTimeout，原M3合法拒绝INVALID_INPUT；修正测试参数满足原端口契约，随后真实deadline关闭通过。
- 最初假定既有mapping必然允许read-only open；真实结果为OPEN_REJECTED。保留独立负例，确认原writer SafeFileHandle.IsClosed=true、mapping仍可改字节，再实际尝试桥接并核拒绝和释放。没有把share模式升级成跨系统mapping保证。
- 最初零后代计数断言混淆了OS控制台宿主与bridge工作后代。最小空PS5.1实验也观测conhost.exe；记录原失败，改为有限census与空宿主基线比较，保留字面零后代未满足，不移除compiler/额外工作后代检查。

第二轮15项：14通过，剩余零后代假设失败。加入短读/读失败/元数据变化/关闭失败模型后，20项真实端口与受控失败组合通过。随后严格控制校验与30秒超时扩展，25项通过。

补测真实LastWriteTime修改：最初期待它可在读期间改变，实际setter发生sharing violation，被测试hook误映射成READ_FAILED（26项中该项失败）。分开捕获fixture修改异常，确认HRESULT `0x80070020`、修改未发生，正常hash仍一致；释放后同setter成功。最终26项全部通过。没有真实复现读期间元数据变化；该拒绝路径由受控native metadata注入验证，不能当成真实OS变化实验。

没有确认生产实现缺陷；修正的是harness与额外fixture的假设、环境和观测，以及实现过程中的明确边界收紧。没有更改share、过滤或正确安全断言来掩盖真实可修改结果。

## 实际回归与负例结果

- 本worktree：`node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-handle-bridge.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：最终26/26，75.86秒。真实PS5.1文件hash/identity、零字节/Unicode/3MiB+17、多个同进程失败前后native handle账目归零、parent/leaf junction拒绝、ready保持、显式release/terminal/exit/close、真实取消/deadline/consumer失败、EOF/错token/重复及转义key/尾逗号/错类型/超限/控制timeout均覆盖。
- 原M3测试所在主checkout，只读执行并禁cache：`node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-reader-process.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：28/28。未复制或改M3测试/fixture，M3实现hash与本worktree只读依赖相同；没有修改主checkout源码。
- 本worktree：`node_modules/.bin/tsc.CMD -p apps/desktop/tsconfig.json --noEmit`：exit0。未运行Electron/native/build。
- 所有文件都是测试本轮创建的临时自有fixture；只在这些材料上尝试写入/重命名/删除，不递归清理，测试材料保留。ready叶文件write/open(r+)/rename/unlink、父目录rename均得到EBUSY；release后文件可r+重开、文件及父目录可重新命名。
- 既有writer未关闭时桥接拒绝，关闭后能正常观察。可写mapping原writer确已关闭、view仍能改字节；mapping活着时本机桥接OPEN_REJECTED，无ready；unmap/close后可重开。此为一个具体映射构造与文件系统的实测，不是所有mapping组合的结论。
- held父目录仍可新增成员，已实际创建并保留自有新成员；没有目录成员不可变或complete结论。
- file symlink创建实际EPERM，保留精确断言，没有提升权限；parent junction真实REPARSE_REJECTED，leaf directory junction真实OPEN_REJECTED，不能用它们替代未执行的file-symlink分支。
- 短读、native read失败、metadata change、CloseHandle失败通过受控native端口注入，是真实文件/句柄加模型故障，不是已经复现OS CloseHandle失败。关闭失败后仍held且写入被阻挡，显式恢复端口并释放后handles为0；probe关闭失败即使finally后成功回收也不发released terminal。
- 源码审查无compiler/后代启动API；ready有限census同空PS5.1只见conhost.exe，无额外compiler/工作进程。不是覆盖全过程的进程审计，也不是禁止后代的OS机制。

## 冻结与未验

开发交付三源码SHA256：

|文件|SHA256|
|---|---|
|windows-artifact-handle-bridge.ps1|F0E133F88AA89B1EF7B97CAF9C14D8B93FE1BD33715621DBBBBDC72984142B47|
|test-fixtures/windows-artifact-handle-probe.ps1|21DDF723B827939AA89883B354DDBA657C6129CDF45C2338ECDD1A3650927F5D|
|windows-artifact-handle-bridge.test.ts|D76B7085A59564CBD0E6958503EA3481D331426FA337E0CEA9C69282309ACAF6|

仅技术开发结果交协调方，未提交、推送、合并。对先前冻结broker/cache/loan/native/AGENTS及M3共20个关键文件核SHA256，没有本轮改动；本轮新增规则0：四文件边界禁止修改AGENTS，现有目标运行时/安全读取/证据门已涵盖相关要求，宿主或harness问题不升级成产品保证。

仍未验：协调方独立验收、字面零OS后代门、生产reader与完整目录枚举/成员复核、真正artifact/材料保护/重开恢复、sidecar、签名、ASAR、真实OS关闭失败及其他mapping构造、32位/其他Windows版本、GUI、干净机器与发布。只推进原第四批，没有第五批。
