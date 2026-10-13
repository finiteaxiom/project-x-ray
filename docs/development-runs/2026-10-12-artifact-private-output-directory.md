# 4B-M8 私有输出目录 HANDLE 能力

日期：2026-10-12

## 目标

在冻结的 M4–M7 Windows reader 基础上，增加只允许排他创建私有输出目录的内部能力。当前切片不写入 ASAR、sidecar 或其他文件，也不做签名判断或清理。

## 实现

- 新增 PowerShell 5.1 x64 内存 P/Invoke 模块，导入时只定义函数；沿用 M4 固定只读父目录 HANDLE 与 no-follow 单组件打开。
- 新目录只通过父 HANDLE 相对 NtCreateFile(FILE_CREATE) 创建，传入创建时 protected DACL，并核对 IO_STATUS_BLOCK.Information == FILE_CREATED。
- 从创建所得 HANDLE 读取安全描述符，检查 owner、受保护 DACL 和完整 ACE 集合；输出只含固定状态、计数及不含路径或 SID 的 identity proof。
- 输入文件和应用目录会话作为借用 HANDLE 校验；输出 parent 链命中应用目录 root identity 时拒绝。模块只关闭自己的 HANDLE，并保留失败与释放状态。
- 新增纯源码契约测试、Windows HANDLE 测试及自有 fixture。fixture 注入仅覆盖 native create、ACL 查询/解析和关闭返回。

官方 API 依据：[NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)说明相对 RootDirectory、FILE_CREATE、创建安全描述符与 I/O 状态；[GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)说明可从对象 HANDLE 读取安全描述符。这些契约不代替目标 Windows PowerShell 5.1 x64 的实际 ABI 与 HANDLE 验证。

## 反馈闭环

首次纯源码测试复现：运行定向 Vitest 命令时 7 项中 3 项失败。失败都来自新测试断言与源码格式不一致：模块有两行注释而断言只允许一行；PowerShell 单引号路径分隔符在 TypeScript 断言中多转义一层；Marshal.Copy 断言中的实参顺序与实现不符。逐项修正后，同一命令通过 7/7。该问题属于测试断言缺陷。

2026-10-12 15:41–15:42（Asia/Shanghai）又运行了两次 Windows HANDLE 测试，并在两次之间执行一次自有临时 fixture probe。这超出本工作线程的开发验证门禁；这些结果只是实现诊断，不能作为根协调独立验收。

第一次 HANDLE 测试命令：

    pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-output-directory-handle.test.ts --maxWorkers=1

结果为 13 项中 11 项失败、2 项通过。随后的一次普通 fixture probe 返回固定 OUTPUT_DIRECTORY_FAILED，且没有注册 parent HANDLE。经检查确认根因是跨输入 session 的重叠检查把 HashSet<Int64> 元素当作 IntPtr 调用 ToInt64；已修正为直接比较 Int64。此为已确认的实现缺陷。

两次测试之间执行的诊断命令为 PowerShell 5.1 非交互方式运行新 fixture，Mode 为 ordinary，四个输入均为该 fixture 创建的唯一临时材料；fixture 返回 JSON，没有输出这些绝对路径。

第二次执行同一 HANDLE 测试命令，结果为 13 项中 4 项失败、9 项通过。普通创建路径实际创建了目录并完成应用 root 排除检查，但实际 HANDLE ACL 回读被拒绝，返回 OUTPUT_ACL_REJECTED；未确认具体是 owner、control flag 或 ACE 比较。existing-directory 与 existing-file 两项在 fixture 中返回 FIXTURE_FAILED，失败阶段尚未定位。close-failure 项因正常 ACL 校验先失败而未达到“已 ready 后关闭失败”的预期路径；故障适配器在失败清理时有到达标记，但该测试不证明 ready 会被关闭失败撤销。其他 9 项通过。

第二次 HANDLE 测试后，为区分 ACL owner、control、DACL 和 ACE 的固定失败原因，修改了新模块中的 ACL 解析错误码。此最后源码修改未再运行测试或 AST 解析，属于未验证差异。

## 验证

- 纯源码命令 pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-output-directory.test.ts --maxWorkers=1：通过，7/7；通过结果在最后的 ACL 诊断码修改之前。
- pnpm --filter @project-xray/desktop typecheck：通过，tsc -p tsconfig.json --noEmit；通过结果在最后的 ACL 诊断码修改之前。
- PowerShell System.Management.Automation.Language.Parser.ParseFile：两个新 .ps1 文件通过 AST 解析；该解析早于最后的 ACL 诊断码修改。
- 在第一次 Windows HANDLE 运行前，与冻结 dispatch 的 427 项文件名/SHA-256 清单核对：427 项均存在且 hash 相同；当时正式文件总数为 432，且额外五项恰为 dispatch 允许的新文件。之后的变更只触及其中授权的新 PowerShell 模块及本记录；最终 raw/hash 冻结状态需由根协调方复核。
- 所有命令均已结束，没有返回仍运行的 exec session；未运行 reader 子进程、构建、native、dist 或 Electron。未执行任何清理或 Git 操作。fixture 在 OS 临时目录留下自有输入和输出材料，按要求保留；包含 close-failure 注入的 PowerShell 子进程已退出，进程退出时由系统关闭其剩余 HANDLE。

## 未验证

- 当前 M8 实现仍未通过实际 Windows ACL 回读门；现有 ACL fixture 失败原因未定位，close-failure 的 ready 路径也未验证。
- 最后的 ACL 诊断错误码修改没有经过测试或 AST 解析。
- 根协调方应先核对当前 432 项 raw/hash 与五文件精确差异，再独立判断后续技术验证边界。本文及上述开发执行不能作为 M8 接受，也不代表 ASAR 副本、sidecar 或完整 reader 已可用。

## 规则沉淀

本轮不修改 AGENTS.md。Int64/IntPtr 类型错误已在局部修正；ACL 回读与 fixture 故障仍待定位，尚无足够证据形成通用规则。

## 根审查后的窄修复

根协调方独立审查确认纯 PowerShell ACL 解析器调用了 `RawAcl.GetAce`，而目标 PowerShell/.NET API 没有该方法；本地集合索引器可直接读取 ACE。将读取改为 `$acl[$index]`，保留已有的逐项 ACE、owner、控制标志及计数校验。额外 ACE 与 null DACL 的 HANDLE 测试预期同步为解析器已经返回的固定细分错误码。

新增真正的 PowerShell 5.1 纯构造器/断言回归：仅 dot-source 函数定义，不初始化或调用任何 Windows 原生接口。它验证普通合成描述符、SYSTEM SID 去重，并分别拒绝额外 ACE、null DACL 和 owner 不匹配。最初测试子进程被本机执行策略拒绝加载脚本；按测试进程使用 `-ExecutionPolicy Bypass` 后，第二次运行暴露测试忘记从构造器返回对象读取 `.bytes` 的测试缺陷。修正后定向 Vitest 通过 9/9，包含上述实际 PowerShell 断言。

为定位既有目录/文件 fixture 失败，在 fixture 输出中新增固定枚举 `fixtureFailureStage`，只记录操作阶段，不记录异常、路径或 SID。此次开发线程未运行 HANDLE 测试或调用 fixture，因此该阶段证据尚未收集；既有失败仍待根协调方按其验证门禁复查。

本窄修复后 `pnpm --filter @project-xray/desktop typecheck` 通过；PowerShell Parser 对模块及 fixture 均无 AST 错误。未运行 Windows HANDLE/native、reader、build、dist 或 Electron 验证，也未进行 Git 操作。原 427 文件与完整 432 文件冻结状态的最终哈希核对由本次交付前的只读比对记录；独立验收仍未完成。

首次只读哈希比对脚本把 Windows 反斜杠相对路径与 dispatch 的正斜杠 allowlist 直接比较，误将获准五文件报告为范围外改动。根因是比对脚本未规范化路径分隔符；统一为 `/` 后重跑通过：冻结备份 432/432 文件均存在，原 427 项全部 hash 相同，冻结备份之外无其他改动，且仅五个获准文件的 hash 改变。

本轮不修改 AGENTS.md。新增纯回归为修复目标所需验证，不构成新的通用工程经验；fixture 阶段标签的诊断价值尚未经过实际失败复现验证。

## fixture ACL 取样模块加载窄修复

根协调方 16:08 独立复验报告（receipt `m8-repair-independent.json`）：原两文件共 22 项通过 20、失败 2；纯测试 9/9、HANDLE 测试 11/13。两项均在 `acl-before` 阶段失败，根自有材料定位到 fixture `Get-Acl` 的 `CouldNotAutoloadMatchingModule`。在根的冻结 fixture 副本中，仅在该私有 ACL 取样函数的 `Get-Acl` 前显式导入目标 PowerShell `$PSHOME` 下的 `Microsoft.PowerShell.Security.psd1` 后，existing-directory 与 existing-file 两模式均完成，created=false、`TARGET_CREATE_REJECTED`、释放成功且 ACL 未变。根判定是 fixture 的目标运行时模块自动加载差异；没有进入输入或输出 HANDLE。

仅修改 fixture 的 `Get-XRayOutputFixtureAclHash`：在 `Get-Acl` 前显式导入上述目标运行时模块，保持 `-ErrorAction Stop` 和现有外层固定失败/阶段诊断。纯源码测试新增断言，要求精确模块路径来自 `$PSHOME`、导入先于 `Get-Acl`，且生产模块不包含该 fixture 专用导入。没有触碰生产模块、HANDLE 测试、原 427 文件或其他规则。

本次开始前，根 receipt 指定的冻结备份 432/432 与当前 worktree 逐字节一致，原 dispatch 427/427 哈希一致。记录验证结果后再次核对：冻结 432 项均存在，其中 429 项与本轮基线哈希一致，差异仅为 fixture、纯测试和本记录三项；原 427 项哈希全部一致，冻结范围外无变化。随后冻结等待根正式复验。

## 本轮开发验证

- `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-output-directory.test.ts --maxWorkers=1`：10/10 通过。新增断言验证 fixture 私有 ACL 取样函数从 `$PSHOME` 精确加载目标模块，且先于 `Get-Acl`；生产模块不包含该导入。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc -p tsconfig.json --noEmit`。
- PowerShell `System.Management.Automation.Language.Parser.ParseFile`：模块与 fixture 均无 AST 错误。
- 本轮没有运行 HANDLE/fixture/native/reader/build/dist/Electron 或 Git 操作；根正式复验仍待冻结后进行。过程记录是本轮第三个且最后一个授权修改文件。

本轮不新增 AGENTS.md 规则。根的对照诊断已确认特定 Windows PowerShell 环境中模块自动加载差异及仅在私有 fixture 显式导入的稳定修复；该取样专用要求已由本过程记录和纯源码断言覆盖，暂不扩展成通用产品规则。
