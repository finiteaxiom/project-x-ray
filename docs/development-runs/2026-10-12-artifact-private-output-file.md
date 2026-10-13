# M9 私有 sidecar 文件能力

## 目标与边界

为已就绪并登记的 M8 私有输出目录增加内部普通文件能力：接收一个有上限的 `byte[]`，用固定 opaque token 创建单个 sidecar 文件，写入后从同一文件 HANDLE 回读并验证长度、EOF 与 SHA-256。M4 保持只读；本轮不完成完整 reader、manifest、签名、ASAR 副本或 Electron/UI 接线。

实现前，5170 worktree 的 432 项 raw 与 M9 派发清单及接受的 M8 冻结备份逐项一致；M4 handle bridge 与 M8 output directory 的依赖 hash 也与主 checkout 对齐。主 checkout 与该冻结 worktree 存在其他历史差异，本轮只读取 hash 已核对的依赖，没有同步或覆盖这些差异。

## 实现

只增加以下五个派发文件：

- `apps/desktop/scripts/windows-artifact-output-file.ps1`
- `apps/desktop/scripts/test-fixtures/windows-artifact-output-file-probe.ps1`
- `apps/desktop/src/windows-artifact-output-file.test.ts`
- `apps/desktop/src/windows-artifact-output-file-handle.test.ts`
- `docs/development-runs/2026-10-12-artifact-private-output-file.md`

生产模块导入只定义函数；首次操作才以内存 Reflection.Emit 绑定固定 native API。输入必须是 `byte[]`，调用开始时复制并先计算独立输入 hash，大小为 0 到 32 MiB。文件名只由 32 位小写十六进制 token 构成的单一组件生成。创建使用 M8 已登记会话的 created HANDLE 作为 `RootDirectory`，固定 `FILE_CREATE`、no-follow、非目录、同步和只读共享参数；创建时 DACL 仅允许当前用户与 SYSTEM（重复 SID 去重），并从实际文件 HANDLE 读回核验保护状态、owner 和完整 ACE 集。

模块分别登记自己创建的文件 HANDLE，不持有或关闭 M8 借用句柄。写入与回读都限制在 1 MiB 块内，核对每次 API 返回的实际字节数；写后用同一 HANDLE 将位置复位到零，回读精确请求长度并额外确认 EOF，再比较独立 SHA-256。发布前重查 M8 目录的真实 HANDLE、保存身份与就绪状态，并重查文件身份、长度、类型、创建时间、链接数及稳定属性。句柄关闭前不要求写时间更新，也不据此声称持久化或源码来源。任何失败都保持 `ready=false`，不自动删除文件或丢弃已创建 HANDLE 账本；只有精确登记的文件会话可以关闭该 HANDLE。DTO 只暴露固定状态、计数、token、hash 与 identity proof，快照保持 `incomplete`，签名保持 `not-evaluated`。

Windows 集成夹具只使用本轮新建的输入文件、目录和 sidecar 根，提供存在目标、错误 M8 会话、native 创建、短写、短读、EOF、ACL、身份和 close 故障注入。每个注入点提供 reached marker 与阶段字段。集成测试已写成 Windows 专用入口，但按本轮门禁不在开发线程执行。

## 验证与诊断

开发侧只运行纯测试、类型检查和 AST 解析：

- `node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-output-file.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：通过，1 个文件、9 项测试。包含静态契约、纯 PowerShell ACL 构造/拒绝回归，以及直接调用目录借用 validator 的 M8 身份投影契约回归；borrower 测试中的 owner 与 M4 metadata 是纯 stub，没有绑定或调用 native HANDLE API。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc --noEmit`。
- PowerShell 5.1 `System.Management.Automation.Language.Parser.ParseFile` 检查两个新增 `.ps1`：通过，无 AST 错误。

首次纯测试发现静态测试把模块内部的 `[IntPtr]` helper 参数误当成公开入口，造成测试缺陷而非产品缺陷。断言已收窄为检查公开创建函数签名，并在随后同一纯测试命令中通过；没有放宽生产约束。第一次显式调用 Windows PowerShell 5.1 AST 的外层命令因嵌套引号丢失变量名，尽管错误后仍打印 marker；此结果作废。改用字面 here-string 传入 `powershell.exe` 并检查子进程退出码后，两个脚本的 AST 检查通过。

第一次最终 raw 审计脚本把备份根误当成文件根，报告了备份路径缺失；检查目录结构后确认文件实际位于备份的 `files/` 子目录。修正后，派发基线 432 项、raw 432 项、当前允许 inventory 437 项（原 432 + 新 5）逐项一致：缺项 0、额外项 0、hash 差异 0。该问题是审计脚本路径假设，不是源码差异。

四个新增代码/测试文件的 SHA-256：

- `apps/desktop/scripts/windows-artifact-output-file.ps1`：`AAC18AA47BE25168277AB70D10EE7CA03631BE4C098C91D79BF60702FFA51D10`
- `apps/desktop/scripts/test-fixtures/windows-artifact-output-file-probe.ps1`：`D658A850265C945D619D433099102C96005557BE62E252CE77A45DBDF4E0F0E3`
- `apps/desktop/src/windows-artifact-output-file.test.ts`：`1988453B63664CA86672AB3DF040289A62E18EB35CB9156E0DC92084FBCFB663`
- `apps/desktop/src/windows-artifact-output-file-handle.test.ts`：`B7DF7E29CCDF6D6BD0A36C820D8FA9E70E635378F6FEA0C5E2223F44EAA8C87D`

## 独立审查与窄修复

协调方随后在稳定冻结上运行正式两文件 Windows 套件，报告 30 项中 13 项通过、17 项失败。普通原 fixture 的失败发生在 native 创建前：结果为 `OUTPUT_FILE_METADATA_REJECTED`、native call count 0、文件未创建、M8 会话仍 held 且最终释放成功。该结果不能作为写入、hash、ACL 或注入故障到达的证据。协调方审查确认，M8 的 `Assert-XRayOutputMetadata` 与 `createdIdentity` 只包含 `volume`、`fileId`、`directory`；M9 先前错误地把该投影送入要求完整 metadata 字段的 validator，因而必然早拒绝。

本次窄修仅修改 M9 模块、M9 纯测试和本记录。模块新增严格三字段身份投影 validator，只用于已登记 M8 会话保存的 `createdIdentity`；实际 created HANDLE 仍通过 M4 返回的完整 metadata 做原样严格校验，并将卷、完整 128 位 FileId 和目录类型与投影逐项比对。M8 owner 注册、ready/created/not-released、created HANDLE 与末尾账本位置检查保持不变。纯回归直接调用借用校验函数，以已知 M8 投影 stub 验证有效身份、错 ID、错误类型、额外字段、owner 不匹配、已关闭 session、实际 HANDLE 类型错误、reparse 拒绝路径及 HANDLE/账本错配。reparse stub 按既有 M4 metadata 契约拒绝 reparse 属性；该回归确认 borrower 仍通过当前真实 HANDLE 的 metadata 提供方。没有修改 M8、fixture、HANDLE 测试、旧 432 项或共同规则。

协调方另指出 `identity-mismatch` fixture 报告 `FIXTURE_OPERATION_FAILED`，原因尚未定位。本次没有更改该 fixture，也没有猜测修复；修复后原 HANDLE 套件与该 fixture 路径仍须由协调方在后续获准的唯一 Windows 验收窗口验证。当前开发侧 9 项纯测试、desktop noEmit 与 PowerShell 5.1 AST 均通过，但这些结果不替代真实 HANDLE 验收；没有运行 HANDLE suite、fixture、native 调用、reader/build/dist、Electron、GUI 或 API，也不证明持久化、源码来源或签名。

窄修复后的冻结比对使用协调方首次独立审查保存的完整 437 项快照及其 raw backup：432 个旧项分别仍与 M9 派发 before/raw 一致；437 项 inventory/raw 数量一致；恰好上面三项允许文件与审查前快照不同，其余 434 项 hash 全同，缺项、额外项和意外 hash 差异均为 0。模块和纯测试的当前 SHA-256 列于上方；本记录自身按最终内容另行 hash。

## Fixture-only 跟进

协调方随后在稳定冻结上复跑原有两文件 Windows 回归：31 项中 30 项通过、1 项失败，desktop noEmit 通过。独立 identity probe 复现失败发生在 M9 新建文件之前：`attempted=false`、native call count 为 0、`M8 INPUT_SESSION_INVALID`。根因是 fixture 把所有非目录 metadata 查询都计入同一计数；portable 输入和 M8 初始化也经过该包装器，因此错误 ID 在 M9 创建文件前已被注入。该 reached marker 不能证明 M9 文件身份复核已到达。

本轮仅修复 fixture、HANDLE 测试和本记录。身份故障适配器现在捕获 M9 `NtCreateFile` 成功返回的文件 HANDLE，只累计同一 HANDLE 上成功 `WriteFile` 的实际字节，并且仅在累计值等于非零 payload 长度、该 HANDLE 的 metadata length 也匹配时注入不同的合法 128 位 FileId。结果 DTO 分别报告 HANDLE 已捕获、期望长度、成功写入字节和身份复核 reached marker。目录身份故障对象现在精确符合 M8 的 `volume`、`fileId`、`directory` 三字段投影，并保证注入 ID 与原 ID 不同。

close 故障保留首次关闭 DTO，并在重试前断言首次状态为 `ready=false`、`released=false`、`releaseStatus=unconfirmed`、仍有一个文件 HANDLE；随后精确重试并断言文件 owner 账本归零、M8 借用会话仍 held。fixture 对所有已创建的 M9 文件会话都调用 close，包括创建前拒绝且没有文件 HANDLE 的会话，以便结果明确报告释放状态。

存在文件和目录目标现在在操作前后经 M4 `Open-XRayRelativeHandle` 采样 volume serial 与完整 128 位 FileId；junction 使用 no-follow HANDLE，先要求 M4 metadata 将该 HANDLE 判为 `REPARSE_REJECTED`，再从同一个 HANDLE 查询 FileIdInfo。自建且已知的外部目录和 marker 也各自采样前后身份。DTO 只返回身份 SHA-256 proof 与相等标记；junction 的身份核对不打开其 target。

本轮验证限于：desktop `pnpm typecheck`（`tsc --noEmit`，通过）、Windows PowerShell 5.1 `Parser.ParseFile`（通过）和独立 Node 源码契约断言（18 项，通过）。没有运行 HANDLE 测试文件、fixture、native 调用或其他 Windows 行为。协调方的前次 30/31 结果仍是修复前的独立验收；本轮是否真实到达 M9 post-write identity check、现存目标是否保持不变以及 close retry 行为，仍须在后续重开的 Windows 验收窗口确认。生产模块、纯 M9 测试、M8/M4 和原 432 项均未修改。

修改后再次按协调方独立 receipt 保存的 437 项 `afterSol` SHA-256 map 核对：缺项 0，实际差异恰为本轮获准的 fixture、HANDLE 测试和本记录；原 432 项差异 0，其余 434 项差异 0。fixture 当前 SHA-256 为 `E901BE5585667B6F0654685FB66A6940567C952A4C7819B07C3E98E38568A8EE`，HANDLE 测试为 `45254570A0B6E0DEC37701E9319673A4FC0862BA9C2EC7C78D62AF090FEFDE29`。

## 工程规则评估

本轮无新增或修订 `AGENTS.md` 规则。M9 identity fixture 的误注入和目标身份观察缺口是本次夹具问题；通过限定故障适配器的 HANDLE/字节门槛并使用既有 M4 HANDLE 契约修正，未形成现有规则之外可推广的新经验。
