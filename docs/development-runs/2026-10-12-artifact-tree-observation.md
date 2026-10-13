# M7 递归 artifact tree 同句柄观测

日期：2026-10-12。开发-Sol，仅本 checkout。目标是把已验收的 M6 直接目录成员观测扩为有界递归文件观测；不接入 UI、数据库、公开 API 或完整 scanner。

## 基线与范围

实施前 HEAD 为 `455d4ad50830ee2495b70927e51caf830a4efbb8`，分支 `codex/llm-explanations`。M6 精确 main 集成收据已在调度基线中确认为 accepted。开始前保存 422 个当前文件的原始副本、字节数及 SHA-256，并核对调度清单与 M6 收据。没有 Git 写操作，也没有改其他 checkout。

仅修改一个既存文件 `apps/desktop/scripts/windows-artifact-directory-observation.ps1`，增加 parser/vector 的显式容量参数；M6 默认 128 成员、130 页记录、132 次查询保持。仅新增计划允许的五个文件：递归观测模块、自己的 PS probe、纯契约测试、Windows 同句柄测试和本记录。M4 bridge、M5 reader、M3 process、既有 fixture/test、AGENTS 及其余 421 个原始文件均保持原字节。

## 实现

M7 从 M6 已打开的根目录 session 开始。每个子对象只用当前父 HANDLE 和一个已验证名称组件相对打开；HANDLE 在 metadata 查询之前加入 M4 session 唯一释放账目。全树按卷与 128-bit file ID 去重，拒绝重复身份、跨卷对象、reparse、超限路径或对象数。

每个目录在递归前后通过同一 HANDLE 取得完整、排序向量，并逐项比较；该目录及其成员也通过同一 HANDLE 复核完整 metadata。普通文件直接把已注册的文件 HANDLE 借给 M5 `Get-XRayArtifactObservation`，复用其 1 MiB 顺序读取、SHA-256、有限 PE 头捕获及前后 metadata 检查。借用视图按 M5 原 metadata JSON 字段顺序建立独立副本，不持有释放权。输出分别统计 owner HANDLE 和每文件 borrowed view 数量，快照仍为 `incomplete`、签名仍为 `not-evaluated`。

实现限制为 5,000 个文件、5,000 个目录、64 层、单文件 2 GiB、累计读取 8 GiB、根相对 UTF-8 路径 512 字节、10,000 个 owner HANDLE、50,000 次目录查询及 32 MiB 记录/向量/DTO 预算，并在 15 分钟内失败关闭。固定 64 KiB 枚举页和 1 MiB 文件缓冲区保持。PS probe 仅输出计数摘要、规范记录 digest 和至多三个样例，不输出完整树 DTO。

Windows 测试已写但本轮未执行：递归含空目录、隐藏名、Unicode、空文件和普通文件；真实文件 SHA 与 identity 对照；超过 M6 的 128 成员；实际稀疏 >2 GiB 自有文件的早期拒绝；两向量成员/字段变化、metadata 失败、UTF-8 路径/预算、深度、owner 释放和取消。它们不构成 Windows/HANDLE 行为已通过的证据。

## 反馈闭环与本地验证

两次中间纯测试失败都来自新静态测试断言写法与实际源码形式不一致：一次把对象初始化字段误写成后续赋值语法，另一次期待不区分大小写的 `-notmatch`，实现已改用更严格的 `-cnotmatch`。另一次源码审查发现 M5 会按 JSON 字段顺序比较文件 metadata，而 M6 私有 preimage 的字段顺序不同；在未运行 HANDLE 测试前，新增 M5 顺序和类型一致的独立副本并加静态契约断言。该修正来自接口源码证据，仍等待真实 Windows 测试确认。修正两项静态断言后重复同一目标门并通过。

最终本地命令与结果：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts apps/desktop/src/windows-artifact-tree-observation.test.ts`：9 个 test files、128 项通过。覆盖 M6 默认契约和 M7 静态边界；不执行 PowerShell 函数或 Windows HANDLE 测试。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc -p tsconfig.json --noEmit`。
- PowerShell `System.Management.Automation.Language.Parser.ParseFile` 对 M6 directory module、M7 tree module 和 M7 probe 作 AST 解析：零语法错误；未 dot-source 或执行脚本。
- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：通过，仅检查既有 M3 reader 的 JavaScript 语法。

没有执行 Windows/HANDLE、PS5.1 native binding、reader 子进程测试、M3/M4/M5/M6 回归、build、native、dist、Electron、GUI 或 API。按本批门禁，这些实际 Windows 检查由协调方在冻结后单窗口执行；特别是本地结果不能证明目录枚举、动态作用域、句柄时序或实际释放行为正确。

## 差异与规则判断

最终核对以实施前 422 项 raw manifest 为基准：421 项逐字节 SHA-256 相同，唯一变化的既存文件是获准调整容量参数的 M6 directory module；五个获准新文件均已列入前后收据。完整 422 项 before/after raw/hash manifest 与一旧五新 unified patch 保存在忽略目录 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-m7-tree-observation/`。HEAD 和分支保持基线值；没有执行 Git 写操作。

AGENTS 本轮新增规则 0 条。现行规则已覆盖 no-follow、单一 HANDLE 释放所有者、完整证据、有限输出、目标 Windows 验证和反馈闭环；当前只有静态验证与尚未运行的 Windows 测试，没有新运行时证据支持可复用规则。

## 独立审查后的 M7 窄修复

协调审查记录见 [M7 独立审查](2026-10-12-artifact-tree-independent-review.md)。首次 Windows 测试 13 项中有 2 项失败；后续普通混合树和 owner-held 诊断均成功，但这两项失败的根因仍未确认，不能归因于缓存或其他环境因素。另一个 test-owned late-subtree 诊断已确认产品缺陷：在 `a/b` 子树完成局部二次枚举后、读取根目录后续兄弟文件前插入新文件，旧实现仍报告 ready、退出码 0，实际文件数为 3 而结果为 2。此次修复直接针对这一已复现遗漏，不改变两项失败测试的断言。

递归遍历现在把每个目录的第一完整向量、目录 metadata、所有成员 metadata 和成员注册记录保留到整棵树读取结束；随后才对每个仍持有 HANDLE 的目录复取完整向量，并以同一 HANDLE 对所有文件及目录成员检查完整十字段 metadata。最后继续复核完整会话祖先链及根目录。第一向量、成员和注册信息在全局最终校验完成前持续计入 32 MiB 预算，第二向量只在单次比较期间临时计入。M5 文件借用视图保留至多 64 个父 HANDLE 加文件 HANDLE，共不超过 65 个；树的唯一 owner 账本仍负责完整句柄集合和祖先验证，M5 原模块及 M6 默认容量未改。

现有 Windows fixture 增加真实自有目录内的晚到子树文件插入，以及在所有文件读取完成后分别扰动目录和文件 metadata 返回值的受控注入。测试要求注入标记成立、没有 ready、收到固定 `DIRECTORY_CHANGED` 拒绝并在进程关闭后重新打开文件。metadata 注入只改变测试适配器返回的单个字段，用于验证全局同句柄最终比较路径；它不声称模拟操作系统真实时间戳更新。Windows 测试还补齐 hard link 身份碰撞、目录 junction/reparse、64 层正边界、deadline 和首个 CloseHandle 失败后的释放恢复；原有 65 层拒绝、mixed-tree 和 owner-held 测试保留。

本轮实际本地验证：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts apps/desktop/src/windows-artifact-tree-observation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：2 个 test files、25 项通过。该门只执行纯 TypeScript 静态契约测试，不运行 PowerShell/native 行为。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc -p tsconfig.json --noEmit`。
- `System.Management.Automation.Language.Parser.ParseFile`：两个修改后的 PowerShell 文件零 AST 语法错误；只解析，不 dot-source 或执行。
- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：通过，仅检查既有 reader JavaScript 语法。

本轮没有执行 Windows/HANDLE、PowerShell 5.1 native binding、reader 子进程、M3–M6 回归、build/native/dist、Electron 或 GUI。根因修复和新增 Windows 测试仍待协调方在其 Windows 技术窗口复验；本地验证不构成 M7 验收。首次独立审查的两项 Windows 失败也仍待复现诊断。

修复前快照取自协调方已核对的 427 项原始 baseline 副本。本轮新建且未覆盖首次交付收据的 `m7-repair-beforeSol.json`、`m7-repair-afterSol.json`、`before/files`、`after/files` 和 `m7-repair-exact.patch` 均保存在 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-m7-tree-observation/m7-repair/`。原始 SHA-256 对照为 427 项：恰好五个获准既存文件变化，其余 422 项逐字节相同；patch 含五个文件头。HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations` 未改，无 Git 写操作。

AGENTS 本轮新增规则仍为 0 条。此轮已有源码复现及边界回归，但规则门槛要求将可复用经验纳入时不能扩大“当前只做局部复验、Windows 仍待协调验收”的证据结论；现有全局证据、HANDLE 释放、Windows 目标运行时和过程记录规则已覆盖所需动作。

## M7 Windows fixture setup 可重复性窄修复

协调方的 21 项 Windows 运行有 18 项通过、3 项失败：mixed nested hashing、`late-subtree-metadata`（期望 exit 9，实际 exit 10）和 depth-64 正边界。单独的 root-owned 诊断显示，对测试明确创建的目录先用独立 M4 owner session 查询实际完整 metadata 后，mixed 与 depth-64 都能到达 ready；metadata 注入标记已 armed/injected，原全局同 HANDLE 检查以 `DIRECTORY_CHANGED`、exit 9、无 ready 拒绝。环境或缓存原因仍未确认，这些根诊断不等于本开发窗口的 Windows 验收。

本次只修复 test-owned fixture 准备顺序：probe 接受有界 `setupPaths`，验证每个名称组件、显式祖先、路径/数量上限和 fixture owner marker；之后在 fault adapter 定义前，通过独立 M4 目录 owner session 查询 observed root 的既有祖先链，再用父 HANDLE 相对打开并查询每个显式列出的 tree 目录完整 metadata，校验目录类型、卷与唯一身份，并确认所有准备 HANDLE 已释放。tree-relative 准备不枚举、写入或清理目录，也不改生产模块。mixed-tree、metadata 注入和 depth-64 Windows 用例显式列出需要准备的路径；metadata 用例仍要求实际注入标记、固定 exit 9、无 ready 及文件可重开。

本开发窗口验证：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts apps/desktop/src/windows-artifact-tree-observation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：2 个 test files、25 项通过；只运行纯 TypeScript 契约测试。
- `pnpm --filter @project-xray/desktop typecheck`：通过。
- PowerShell `System.Management.Automation.Language.Parser.ParseFile`：修改后的 fixture probe 零 AST 语法错误；只解析，没有 dot-source 或执行。
- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：通过；只检查既有 reader 的 JavaScript 语法。

本窗口没有运行 Windows HANDLE/PowerShell 5.1/reader 测试、M3–M6 回归、build/native/dist、Electron 或 GUI。21 项 Windows 用例需由协调方在其 Windows 窗口重跑；本修复仍不是 M7 验收。HEAD 与分支保持调度基线，无 Git 写操作。前后原始内容收据及三文件精确 patch 保存在新的忽略诊断目录 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-m7-fixture-setup-fix/`；427 项逐字节核对中恰好三个获准既存文件变化，其余 424 项完全相同，新增和删除的正式文件均为 0。AGENTS 本轮新增规则 0 条：这是当前 fixture 诊断下的局部准备顺序，现行测试隔离和目标 Windows 验收规则已覆盖必要动作，root-owned 诊断也尚未构成本窗口的复验。

## M7 fixture setup 的 PS5.1 修复

协调方最新 Windows 运行在 21 项中通过 17 项、失败 4 项：mixed nested、`late-subtree-metadata`、`late-file-metadata` 和合法 depth-64。目标 PowerShell 5.1 对 marker 检查里的 `Split-Path -LiteralPath $DirectoryPath -Parent` 实际报 `AmbiguousParameterSet`；stage 诊断确认三个需要 setup 的 case 都在准备前以 exit 3 / `PROBE_FAILED` 退出，没有准备标记。`late-file-metadata` 还未传 `a`、`a/b`，实际 exit 10；其原故障注入没有通过现有 exit-9 门。本轮根据协调方保存的 427 项 raw/hash 新基线继续，HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8` 与分支 `codex/llm-explanations` 不变。

修复仅替换 marker 父目录提取为 `[IO.Path]::GetDirectoryName`，并先去掉受约束路径末尾的目录分隔符；绝对 drive path、`observed` 叶目录、`xray-m7-owned-` 父目录、固定 marker 内容及后续相对 HANDLE/no-follow/身份/释放检查保持。`late-file-metadata` 现在和同布局的目录 metadata 用例一样显式声明 `a`、`a/b`。原 probe 仅在 `lateMetadataArmed` 后完成实际字段注入，且只有注入标记为真、错误码正好是 `DIRECTORY_CHANGED` 才返回预期 exit 9；Windows 断言仍要求 exit 9、无 ready 和原文件可重开。产品树模块和比较器没有改动。本开发窗口只做源代码核对，尚未把新路径提取方式宣称为目标 PS5.1 实际通过。

本轮只完成串行纯/静态验证：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts apps/desktop/src/windows-artifact-tree-observation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：2 个 test files、25 项通过；只执行纯 TypeScript 契约测试。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc -p tsconfig.json --noEmit`。
- PowerShell `System.Management.Automation.Language.Parser.ParseFile`：fixture probe AST 零语法错误；解析器运行时为 PowerShell 7.6.5，只解析，没有 dot-source 或执行。
- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：通过；只检查既有 reader 的 JavaScript 语法。

没有运行 Windows/HANDLE/reader 进程、M3–M6 回归、build/native/dist、Electron 或 GUI；协调方仍须冻结后在唯一 Windows 窗口重跑 21 项和适用旧门，M7 未接受。新的 ignored raw/hash 收据及三文件精确 patch 放在 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-m7-fixture-ps51-repair/`；427 项逐字节核对中恰好三个获准既存文件变化，其余 424 项完全相同，新增和删除的正式文件均为 0；HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations` 未变。AGENTS 本轮新增规则 0 条：根因是一个 fixture helper 参数集冲突和同一 Windows case 漏传准备路径，目标版本兼容仍待 root 复验；现有目标 Windows 验证要求覆盖该动作，AGENTS 在本轮范围内冻结。

## M7 owner-held 正向 fixture 窄修

协调方最新 PS5.1 Windows 运行 21 项中通过 20 项、失败 1 项：owner-held 正常嵌套 `nested/held.bin` 用例在 ready 前被拒绝。旧 M6/M4/M5 因该新门失败没有运行，M7 仍未接受或 main 集成。协调方保留原完整向量比较器，对三个新的自有样本做只捕获后重抛诊断：两个 ready，一个因 `nested` 的完整向量 `write/change` 前后不同（15039 个 100ns tick，成员数 1/1）而以 `DIRECTORY_CHANGED`、exit 3、零 ready 结束，`armed/injected=false`；另一个显式设置 `setupPaths=['nested']` 后实际查询 2 个目录、owner 释放为 true 并 ready。底层 OS 原因未证，失败不证明产品 guard 错误，也不能以单个诊断样本替代原 Windows 用例。

本次仅在 owner-held 正向用例明示 `setupPaths:['nested']`，并断言准备 marker、独立 owner session 与释放标记均为 true、请求及查询目录数均为 2。ready 持有期间对文件写入、删除、文件重命名和目录重命名的拒绝断言，以及 owner HANDLE 统计、release/closeConfirmed/cleanupSafe、文件重开和原内容断言全部保留。probe 和产品代码不变。

本窗口串行验证：

- `pnpm exec vitest run apps/desktop/src/windows-artifact-directory-observation.test.ts apps/desktop/src/windows-artifact-tree-observation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude '**/.benchmarks/**'`：2 个 test files、25 项通过；只执行纯 TypeScript 契约测试。
- `pnpm --filter @project-xray/desktop typecheck`：通过，`tsc -p tsconfig.json --noEmit`。
- PowerShell `System.Management.Automation.Language.Parser.ParseFile`：fixture probe AST 零语法错误；解析器运行时为 PowerShell 7.6.5，只解析，没有 dot-source 或执行。
- `node --check apps/desktop/scripts/windows-artifact-reader-process.cjs`：通过；只检查既有 reader 的 JavaScript 语法。

本窗口没有运行 Windows/HANDLE/reader 进程、M3–M6 回归、build/native/dist、Electron 或 GUI；owner-held 用例和旧门仍待协调方单窗口复验。新的 ignored raw/hash 收据及两文件精确 patch 放在 `.benchmarks/artifact-directory-observation-diagnostics/2026-10-12-m7-owner-held-fixture-repair/`；427 项逐字节核对中恰好两个获准文件变化，其余 425 项完全相同，新增和删除的正式文件均为 0；HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`、分支 `codex/llm-explanations` 未变。AGENTS 本轮新增规则 0 条：这是已知 owner-held fixture 的有界准备声明，既有目标 Windows 测试规则已要求实际运行和句柄释放验证，AGENTS 按调度范围冻结。
