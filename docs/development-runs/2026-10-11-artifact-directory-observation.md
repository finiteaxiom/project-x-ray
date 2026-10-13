# 4B-M6 有界直接目录成员观测

日期：2026-10-11。开发-Sol，仅本 checkout。原第四批 Windows 内部 reader 缺口，不是第五批，不是完整 scanner。

## 原始基线及范围

实施前实际 HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations`，完整 416 文件 raw/current 与基线一致。baseline SHA-256 `58CE7C441402398B71864D5C79BC48AEBD1389220EB2303D400EE7259A3FF1DF`。原用户 WIP 作为前像保留，不 reset 或按 Git 总差异覆盖。

只在旧 `windows-artifact-handle-bridge.ps1` 改三处：显式默认 false DirectoryLeaf 参数、最后组件类型选择及文件观测拒绝目录。新增计划指定目录模块、自己的严格 PS fixture、纯源契约测试、Windows 测试和本记录五文件。原 M3/M4/M5 fixture/tests/consumer、PE/manifest/ASAR、S3 UI、native/core/DB/依赖/AGENTS 等其余 415 旧文件冻结。不 Git，不改其他聊天记录或 checkout。

## 实现与来源

新模块导入只有函数定义。显式目录入口复用原卷根/相对单组件 NtCreateFile、只读权限/nofollow/share-read、父链持有和关闭归属；默认文件 API/原九字段 DTO/M5 PE 捕获不改。

原 GetFileInformationByHandleEx 绑定没有 SetLastError，不用于枚举终点。新模块为同一 API 建立有限内部绑定，DllImport SetLastError=true；发射的 Query 包装在 native return 后立即调用 Marshal.GetLastWin32Error 并写入 out 参数，先于反射返回。核反射属性后才保存绑定。FileIdExtdDirectoryRestartInfo=20、continuation=19 在同目录 HANDLE 分页，仅本次 false+18(ERROR_NO_MORE_FILES) 终止；其他 false 固定失败。64KiB 页和最多每向量 132 调用；零 NextEntryOffset 只结束当前页，继续 native 查询终点。

页解析核 88 字节固定头、名字字节/页界/8 字节对齐、next 前进、最多 130 页内记录、严格 UTF16、完整 128bit ID。只过滤精确 . 和 ..，隐藏/Unicode 保留；成员名字走原单组件限制，不 normalize 或拼绝对路径打开。未知/reserved 高属性、device、reparse、零/全 F ID、大小写名称冲突/重复 ID/祖先循环拒绝。当前只支持低 16 位已识别属性，其他属性失败关闭，不能称为所有文件系统支持。

微软明确普通项 ReparsePointTag 未定义，因此目录专用 metadata 函数不读取该值。显式 Open-XRayArtifactDirectorySession 使用局部函数作用域覆盖 metadata 调用，复用原 Open-XRayArtifactSession；没有修改原文件 reader 的 metadata 规则或持久改写共享函数。该动态作用域及目标 PS5.1 发射行为必须由真实测试核验，未从静态检查推断通过。

第一完整向量最多 128 成员，按 Ordinal 精确名字排序。每个成员从当前目录 HANDLE 相对打开后立即加入原 session 唯一关闭账目，再核卷、完整 ID、类型、属性、creation/write/change 和普通文件 length/allocation；子目录不递归、不读内容。第二完整向量精确比较；随后复核实际子 HANDLE、祖先 identity/attributes，以及所观察目录 creation/write/change，拒绝可观察到的窗口变化。失败不输出部分 ready，partial opens 留在原 session 供 finally/显式关闭回收。

输出 scope=direct-members、snapshot=incomplete、signature=not-evaluated；有限成员单组件名称/身份/类型/属性/十进制长度、计数及父链身份，不含原始页/绝对路径/源码内容。最终 UTF8 DTO <=49152 字节，为 M3 64KiB 整帧上限留余量，超过预算失败而非截断。ready 后完整父/子链持有，只有真实 close/release 后发 terminal。两向量及有限 metadata 相同仍不能证明持续不可变、原子目录快照或全树完整。

资料核对：[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)、[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[DllImport SetLastError](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.dllimportattribute.setlasterror)。仅用于字段/错误缓存契约，不是目标运行时验证。

## 实际反馈闭环

第一轮新纯测试 14 项中 13 通过、1 失败：import 首行正则只接受 LF，新文件已按 Windows 写为 CRLF；仅修测试支持 CRLF，未改变安全断言。首次 desktop noEmit 发现新 Windows 测试用 typeof launch 形成循环类型声明，改为明确 launch DTO。两者是新夹具缺陷，不是已复现的产品/HANDLE 问题。

最终实际命令：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts --maxWorkers 1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：1 文件、14 项通过，0.183 秒。仅静态源契约：native API/错误捕获位置、固定预算、页界/编码 guards、单组件打开、碰撞、单释放归属、完整第二向量及实际成员/祖先复核、incomplete/固定诊断/严格 fixture。未把源码正则称为实际 parser 或来源正确性。
- `pnpm --filter @project-xray/desktop exec tsc --noEmit`：通过，包括尚未执行的 Windows 测试类型检查。
- 宿主 `System.Management.Automation.Language.Parser.ParseFile` 解析旧 bridge、新 directory module 和新 fixture：零语法错误；目录 module top-level AST 全部为函数定义。只 AST 解析，未 dot-source/执行模块或函数、绑定 native、打开 HANDLE、启动 PS5.1。

未运行旧 M4/M5/M3 实际回归，不重复它们已验门。M5 独立接受由协调方收据给出，仅作为前置来源，不改 M5 记录，不冒称本轮结果。

## 已写、未执行的实际 Windows 门

`pnpm exec vitest run apps/desktop/src/windows-artifact-directory-handle.test.ts --maxWorkers 1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'` 必须由协调方单窗口运行。

覆盖目标 PS5.1 lazy import/真实 SetLastError 属性、empty/hidden/Unicode/file+directory、实际 128bit ID 对照、真实终点 [18,18]、同 HANDLE 小页强制多页、普通未定义 tag、持有期间写/rename/delete 拒绝及允许新增成员、异常 EOF/坏偏移/坏 name length/UTF16/未知 ID/错 ID/重复 ID、两向量间新增和第二向量结束后新增、>128及最终 UTF8预算、junction/已有 writer、单消费/取消/deadline/consumer failure、关闭失败、重复/escaped duplicate/wrong token/start 控制及释放后重开。另写 target PS5.1 synthetic page cases，仍全部未执行。

fault injection 仅自己新 fixture，不能替代实际系统来源/EOF。remove-member 用显式自有 marker 文件尝试两向量间删除；原 share-read 可能阻止删除，因此该分支验证拒绝/释放，不据此声称实际成功删除并由第二向量检测。单次 fake identity/坏页/close 故障是模型端口测试，不是 OS 自然故障复现。junction 权限错误保留正确失败，不删断言/改安全设置。

fixture 只本套件 mkdtemp 创建并标记的自有材料，现场保留，无递归删除/候选扫描/被分析代码。directory ready 的新增成员测试明确证明持有目录不意味着禁止创建，不升级成不可变保证。

## 冻结和限制

交付完整 416→421 before/after raw/hash，仅一旧五新；其余 415 旧文件逐字节保持。精确 patch 从不可变前像独立逐 hunk 重建并匹配当前字节。AGENTS 新增 0 条：任务冻结，现有同对象/目标运行时/有限证据/固定错误规则已覆盖；本轮只有静态/夹具反馈，不将未知 runtime 推测沉淀为规则。

全部实际 Windows 目标测试、HANDLE/SetLastError 缓存/native布局/动态作用域/EOF/二进制 parser/跨页/close 仍未验证，等待协调方独立源码审查及单窗口实际验收。未执行 build/native/dist/Electron/GUI/API/凭据/签名/材料扫描/用户项目或 Git。完整树/ASAR 私有副本/sidecar/完整 manifest/签名/安装/运行/干净 Windows/literal 零 OS 后代仍未验；不进入第五批。

## 2026-10-12 root 单窗口失败反馈：诊断与待核窄修方案

本节只记录源码/收据诊断；此轮未改产品源码、测试、fixture 或 AGENTS，也未执行目标 Windows、HANDLE、PS5.1、子进程、构建、Electron、GUI、API 或 Git。root 的两个 2026-10-12 收据和原始日志/探针已逐字节复制到本 checkout 被 `.gitignore` 排除的 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-root-feedback/raw/`。`checkout-before.json` 保存原 421 项路径、字节数和 SHA-256；421/421 均匹配交付 `manifest.json`，baseline SHA 为 `58CE7C441402398B71864D5C79BC48AEBD1389220EB2303D400EE7259A3FF1DF`，manifest SHA 为 `A47DFEB14E156C3895861CB803830B6B9E6A1534C2896A7396B9E9A9D0B91021`，patch SHA 为 `F6A35F1203C59EFF8091159836D1457EF543DDB28155E75BAFC958308759482F`。写入本节后复核 421 项，`checkout-after.json` 保存后像；只有本记录与原 manifest 不同，其余 420 项仍逐字节相同。原始收据副本各自的 hash 记录在同一 JSON 中；原交付像在写入本节前未偏离 manifest。原文抄录的 manifest SHA 少了 `9D` 两位；本次按交付 `manifest.json` 实际 SHA-256 更正。

root 实际运行 41 项 Windows 集成测试为 40 通过、1 失败；失败项 `preserves hidden and Unicode names, directories and ordinal sorting without recursive content` 在 `ready` 前以 `CHILD_EXIT` 退出。再次单选该例仍失败。root 的自有诊断保留并执行原 `Assert-XRayDirectoryMember`；hidden/Unicode 单独可过，含子目录场景成功与失败交替。失败诊断只列出 `write` 和 `change`：原始示例目录枚举值 `134362370264664768`、同对象打开句柄值 `134362370264674774`，相差 10006 个 100ns tick；其余比较字段没有报告差异。这确认拒绝发生在跨来源时间戳相等断言，不证明发生了实际内容/目录变化，也不证明缓存或夹具时序是根因。当前分类是“已观察的 fail-closed 拒绝；原因未定”。

源码位置是 `Assert-XRayDirectoryMember` 将目录枚举项与打开句柄的 creation/write/change 全部逐值比较（本模块约第 147–151 行），随后第二向量与第一向量完整比较（约第 176–178 行）。微软文档分别定义 `FILE_ID_EXTD_DIR_INFO` 和 `FILE_BASIC_INFO` 的同名时间字段；`LastWriteTime` 表示最后写入时间，`ChangeTime` 表示最后变更时间。`GetFileInformationByHandleEx` 文档说明信息按指定句柄和信息类返回，并提示底层驱动及 OS 版本可能影响信息行为；这些文档没有承诺目录枚举记录与稍后单独句柄查询构成原子读取或必须逐 tick 相等。因此，“差值代表真实变化”与“差值只是缓存”都不能从现有证据推出。[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info) · [FILE_BASIC_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info) · [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)。

建议 root 先核对后再授权窄修：目录成员的 `write/change` 不用于“枚举项时间 == 打开目录句柄时间”这一跨来源门；它们也不在 M6 输出中，目录子项内容明确不递归。目录成员仍必须匹配 volume、完整 file ID、类型、attributes 和 creation；普通文件保留现有枚举项与打开句柄的 write/change/length/allocation 严格比较。保存每个已打开成员的第一份句柄 metadata，末尾从同一仍持有的句柄取得第二份并逐字段比较；目录句柄自身需比较 identity/type/attributes/creation/write/change。现有两个完整目录向量保持原样精确比较全部字段，因此观察期间可见的名称、身份、属性或时间变化仍失败；任一同源句柄复核失败继续固定为 `DIRECTORY_CHANGED`，不输出 `ready`。这样只放弃未输出的子目录时间戳跨 API 逐值相等假设，同时保留成员身份、可见目录变化和同一打开对象稳定性检查，不承诺子目录内容稳定或原子快照。

root 后续单窗口复验应至少覆盖：稳定的直接子目录在“枚举时间戳与句柄时间戳不同、两个枚举向量相同、两次同句柄 metadata 相同”时可观测；两向量之间改变子目录的可见枚举事实仍失败；两次同句柄 metadata 之间改变目录时间戳仍失败；volume/ID/type/attributes/creation 不同仍失败；普通文件时间戳与长度断言保持严格；原 41 项集成门和适用 M3/M4/M5 回归通过。用确定的 fixture/注入点复现，不加 sleep/盲目重试、不删安全断言。该方案尚未实现或验证，M6 仍未接受、未精确 main 集成。此次无已确认根因或新的可复用工程规则；AGENTS 新增 0 条。

## 2026-10-12 Sol 授权窄修：实现、静态验证与冻结

本轮仅修改已授权的五个既有文件：`apps/desktop/scripts/windows-artifact-directory-observation.ps1`、`apps/desktop/scripts/test-fixtures/windows-artifact-directory-probe.ps1`、`apps/desktop/src/windows-artifact-directory-observation.test.ts`、`apps/desktop/src/windows-artifact-directory-handle.test.ts` 和本记录。修正目录枚举时间与同一子目录句柄时间之间的跨来源逐值比较：直接目录子项仍匹配 volume、完整 file ID、类型、attributes、creation；普通文件仍严格匹配 write/change/length/allocation。每个已打开成员的十项句柄 metadata 先复制为独立 preimage，再从仍持有的句柄复查并逐项严格比较。第一、第二完整枚举向量继续精确相等；缺失或 null 向量输入固定失败。失败仍在 ready 前关闭，句柄只有单一释放所有者。

夹具新增目录时间戳跨来源稳定差异、枚举向量字段变化、同句柄十项字段各自变化、metadata 查询失败，以及目录身份/类型/属性/creation和普通文件时间/长度/分配大小的跨来源拒绝。保留原集成断言，并补充私有 preimage、完整向量字段和缺失输入的目标 PowerShell 检查。目录/文件 ID 夹具改为翻转首个十六进制字符，保证与实际标识不同。

验证：`pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts --maxWorkers 1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'` 通过，16/16；`pnpm --filter @project-xray/desktop exec tsc --noEmit` 通过；PowerShell AST 解析器对模块与 fixture 均报告 0 个语法错误，且未执行脚本。实际 Windows 集成测试、HANDLE、PS5.1、reader 子进程、构建、dist 和 Electron 均未运行，等待协调方独立审查及真实单窗口验收；所以这是已实现、静态检查通过的本地修复，Windows 行为仍未验证，M6 未接受。

修复前像和后像各保留完整 421 项文件字节与 SHA-256，精确五旧文件 patch 及其 SHA 记录在忽略的 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-pair-repair/afterSol.json`；其余 416 项逐字节不变。HEAD、分支和 241 行 Git 状态摘要与 beforeSol 相同；没有新增正式文件或 Git 写操作，既有工作区内容保留。工程规则新增 0 条：当前有限证据、同对象复核、固定错误和目标运行时验证要求已覆盖；本轮未获得可提升为通用规则的新 Windows 运行时证据。

## 2026-10-12 M6 第二向量 fixture 定向修复

root 对完整 Windows 新测试集的独立复验为 66 项中 65 通过、1 失败（57.13 秒，exit 1）。失败仅在“rejects a changed field in the complete second enumeration before ready”；新 metadata 矩阵及先前隐藏/Unicode 子目录场景已通过。独立 PS5.1 探针保留原比较器并观察到两次枚举的首记录都是精确 `.`，解析后的直接成员为 `member`，两个向量相同，reader 正常 ready/released 且 exit 0。根因已确认是测试 fixture 把 raw offset 0 当作直接成员，注入只改了随后被 parser 过滤的点记录；这是测试夹具缺陷，不是产品比较逻辑缺陷。失败日志、原始 offset 探针和独立检查收据均按原内容保留。

fixture 现在在第二向量中沿真实 FILE_ID 扩展目录记录遍历，校验 UTF-16 名称长度，跳过 `.` 与 `..`，仅对本次自有 `member` 项修改一个 `write` 字段，并保存目标名与注入标记。若产品比较器未拒绝而 observation 返回，fixture 会阻止 ready。测试专用 exit 9 只在目标为真实 `member`、已写入变化且原比较器抛出 `DIRECTORY_CHANGED` 时返回；其他 fixture 路径使用 exit 10。原 66 项集成断言保留，目标测试现断言 `CHILD_EXIT`、exit 9、未 ready 和文件可重开。

本 checkout 仅运行允许的纯验证：纯来源契约 Vitest 16/16 通过；desktop `tsc --noEmit` 通过；目录观察模块与 fixture 的 PowerShell AST 解析均为 0 错误，未执行脚本。此线程未运行 Windows/HANDLE/PS5.1、reader 子进程、build/native/dist/Electron；exit 9 的实际 Windows 路径待 root 重新执行完整 66 项及适用 M3/M4/M5。

421 项 beforeSol 来自这次 dispatch 指定的 raw backup；原像与当前 checkout 起始内容逐项匹配。后续交付在忽略的 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-post-vector-fixture-fix/` 保存完整前后像及 SHA-256、仅三旧 patch 和 root 原始收据副本；验收要求的其余 418 项保持不变。HEAD/分支与 241 行 Git 状态摘要保持原值；未新增正式文件、未改其他 checkout，也没有 Git 写操作。`AGENTS.md` 新增 0 条：已确认问题局限于单个 fixture 的记录定位假设，使用实测根因修正与 exit-code 断言即可防复发，没有新的通用产品工程规则。
