# 4B Windows 产物清单候选协议

2026-10-04；复审修订提案，待协调方独立接受。基线为 `95ebbd3b0dc88107b5b54e172138cb8685bd1bcb`。本文仅修订原设计，不表示工具实现、产物验收或发布批准；不替代 [Windows 发布与安装验收设计](windows-release-acceptance.md)。

## 目标与已观察结构

目标是为 Windows x64 portable 产物定义有限、可复核的清单协议，并按文件读取安全边界拆成两个阶段。第一阶段只实现纯协议和自有内存 fixture；它没有真实 artifact CLI，不读磁盘、不启动进程、不输出真实候选的 `complete` manifest。真实检查必须等独立的安全 reader 切片满足本文门槛后再设计和派发。

只读目录观察显示，现有 `dist/win-unpacked` 有 153 个文件、合计 450,204,221 字节。`dist` 根同时存在两个同版本 portable EXE，以及验收 ZIP、旧报告、smoke/userData 和诊断目录。因此真实扫描只允许两个显式 artifact 输入：一个 portable EXE 和一个 `win-unpacked` 树；不得扫描整个 `dist`、按版本名挑文件或把 staging tree 说成第二个发布文件。现有验收 JSON 时间为 2026-10-01，只是历史证据。

当前暂存树中观察到 `resources/app.asar`、物理 `resources/python-analyze.py`、`secure_reader.node` 和 better-sqlite3 的八种平台/架构 `.node` 预构建文件。清单须保留每个实际物理文件；平台不匹配项可以标成非目标项，但不得从清单删除。

## 阶段 A：纯协议与自有 fixture

首个可派发实现切片限定为：

1. 新增 `apps/desktop/scripts/windows-artifact-manifest-protocol.cjs`，只接受已经捕获的 plain-data observation DTO；负责严格字段验证、固定状态枚举、稳定排序和 canonical JSON 序列化。
2. 新增 `apps/desktop/src/windows-artifact-manifest-protocol.test.ts`，使用内存中的自有 fixture 与伪 Authenticode 结果验证 schema、排序、完整性状态组合、签名原值保留和退出状态映射。

本阶段不得导入 `node:fs`、`node:path`、`node:child_process`、ASAR reader 或 PowerShell；不得注册真实扫描 CLI，不改根 `package.json`，不打开 `dist` 或候选文件。它只冻结和验证协议，不是可对外宣称通过的 Windows 发布检查。

## 阶段 B：真实安全 reader 前置门

现有 `packages/analyzer-core/src/secure-read.ts` 把源码读取限制为 2,000,000 字节，分 64 KiB 块返回完整 Buffer。`packages/analyzer-core/native/secure_reader.cc` 用 Windows root handle 与 `NtCreateFile` 的 `RootDirectory` 打开相对路径，但 root/file handle 使用 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`；它是源码读取端口，大小与共享语义均不绑定 artifact 的稳定字节。它不能用来读取数百 MB 的 portable/ASAR，不能保证 hash 与 Authenticode 重开路径读的是同一对象，也不能替代 ASAR path reader 的路径安全。禁止复用它或用 `realpath` 前后比较冒充根句柄竞态保护。

阶段 B 在进入实现前必须有单独的 Windows reader 设计复审。候选文件只可使用 Windows 自带 PowerShell/.NET 与受审的系统 handle API，不加 npm 依赖、不新增 `.node` 或其他 native 二进制；若无法在这些范围内证明下列契约，则停止并提交 reader 方案复审，不降级成路径字符串校验：

- 两个 artifact root 分别持有稳定目录/文件 handle；逐层相对 root handle 打开，拒绝每一级 reparse point，不跟随 symlink/junction。每个文件有来自实际 handle 的 volume/file identity、普通文件类型、长度和相对路径。
- 在同一受限只读 handle 上流式计数与散列实际字节，并在读取前后检查 identity、长度和目录成员集；需证明既有写句柄、写入、删除、替换或链接替换不能让 hash 仍被报为完整。无法取得满足约束的 handle 即 `incomplete`。
- Authenticode 检查必须对应已散列的那个文件对象：reader child 持有阻止写入/删除/替换的该对象 handle，向 parent 返回 run-local opaque token、规范路径和 file identity；独立签名 child 只接受这个 token 映射出的路径。reader 在签名前后用原 handle 核对 identity、长度和散列，签名 child 返回值须按该完整 identity 关联，不能按文件名关联。若系统 cmdlet 无法在这些约束下读取同一对象，或检查会造成未授权远程请求，则签名捕获为 `not-evaluated`/`incomplete`；不能仅按文件名把原始状态挂到另一份字节上。
- ASAR 不从候选路径直接交给 `@electron/asar`。reader 从受保护 handle 将精确 ASAR 字节复制到本轮新建、排他、受限的临时文件，在复制时散列；ASAR parser 只读取这份受控副本。parse 前后核对副本 identity、长度和 SHA-256，任何变化都使扫描不完整。只解析目录元数据，不提取/运行 JS 或 require addon。
- 私有临时目录必须由本次 run 独占创建，拒绝 reparse，报告输出在两个输入 root 外。文件和目录的失败清理只允许在所有相关进程/handle 已关闭后按本轮确切身份完成。

以上是实现和实测门，不是声称已有 PowerShell/.NET helper 已满足的事实。新设计必须列出它实际使用的 API/handle sharing 模式，并以目标 Windows PowerShell/Node 运行时证明；当前只读阶段不探测这些行为。

## 允许读取的输入

真实扫描接口只有两个 artifact root：`--portable-exe` 单文件与 `--app-dir`。其他输入明确标为 control data，而不是第三个 artifact root：

- `--source-commit` 如提供，仅接受一个操作者传入的 SHA 字符串并标记 `operator-declared`。CLI 不读当前 checkout、Git 状态、lockfile 或 cwd；SHA 声明永不等同来源绑定。
- `--publisher-policy` 如提供，是一个显式、受限的 JSON control file，最大 64 KiB、严格 schema、无嵌套文件引用/路径/远程 URI；读取其策略 ID 与证书 SHA-256 allowlist，并在报告写策略摘要。它不是 artifact root，不得从环境变量或证书库自动发现发布者。
- inspector 自身的允许结构/组件 profile 随工具版本编译并留在代码中；不能由 artifact 注释、文件名或 ASAR 内容改变规则。
- 产品版本和可读身份字段只从候选包自身可解析的元数据及明确 target 参数记录。不存在的字段写 `not-observable`，不能用当前 checkout 的 `package.json` 补齐。

第一版没有 `--source-root`，也不比较 `packages/analyzer-python/python/analyze.py`。worker 只记录 candidate 中 ASAR 条目缺席、物理资源存在和该物理文件 SHA-256；与源码的精确字节比较留到受控 build-time 输入/输出记录阶段，避免隐含第三个源码 root。包内版本与操作者 SHA 都不证明二进制来源；`buildAssociation` 初版为 `not-established`。

## Manifest v1 候选状态

首阶段纯协议先冻结这些相互独立的状态；不得用一个 `passed` boolean 把它们合并：

| 字段 | 候选值与含义 |
| --- | --- |
| `scan.status` | `complete` / `incomplete` / `failed`；只描述输入枚举、物理字节读取和本轮 child/handle 收尾是否完整。 |
| `structure.status` | `passed` / `failed` / `not-evaluated`；只描述 target 结构规则，不等于签名或发布结论。 |
| `authenticode.status` | `complete` / `incomplete` / `not-evaluated`；逐 PE 记录 capture 状态及 `rawStatus` 原值/null，未知、不可用或不支持的状态不能伪装为已检查。 |
| `publisherTrust.status` | `matched` / `mismatch` / `not-evaluated`；只有显式策略可评估，且必须与 raw Authenticode 分列。 |
| `releaseDecision` | 本工具始终输出 `not-evaluated`；产品发布批准在其范围之外。 |
| `buildAssociation.status` | 初版为 `not-established`，不由 SHA、同目录或版本相同推断。 |

每个物理文件恰有一条 root-relative 记录，包含 `rootId`、`path`、`bytes`、`sha256`、分类和可识别 PE machine。所有 EXE、DLL、`.node` 与 PE 头识别文件都记录 Windows `Get-AuthenticodeSignature` 实际返回的 `Status` 字符串，不重命名、不归并；cmdlet 未返回状态时 raw 为 null 并单独说明 capture failure。非 PE 文件显式 `not-applicable`。Signer 摘要限制为证书 DER SHA-256、Subject/Issuer、有效期和 code-signing EKU；不写证书原文、私钥、异常原文或绝对路径。

状态解释沿用 [既有 Windows 发布验收规则](windows-release-acceptance.md)：`NotSigned` 原样表示未签名；`Valid` 只表示 cmdlet 返回有效状态，不能单独证明 publisher trust；`HashMismatch`、`NotTrusted`、`UnknownError` 等原值保留为签名评估失败；`NotSupportedFileFormat`、`Incompatible`、未知状态或 cmdlet 不可用为未验证/不完整，不降格成 `NotSigned`。

退出码候选映射：`0` 表示 scan complete、structure passed，且没有已判失败的签名结果/已配置 publisher policy mismatch；它仍不表示 `releaseDecision` 通过。`2` 表示 scan complete 但结构、签名评估或显式 publisher policy 失败。`3` 表示扫描或签名覆盖不完整、取消、超时、文件变化、限制超限或退出未确认。`64` 表示参数/小型 policy control data 无效，尚未扫描 artifact。`70` 表示固定码记录的意外内部错误。`Valid` 与 `NotSigned` 均保持原始语义；无 publisher policy 时 trust 状态仍为 `not-evaluated`。

## 实际结构与 SQLite addon 选择

ASAR 解析只读候选副本中的目录元数据。结构 profile 至少要求 `apps/desktop/dist/main.js`、`apps/desktop/dist/analysis-worker.js`、`apps/ui/dist/index.html`；要求 Python worker 不在 ASAR、`resources/python-analyze.py` 是物理文件；ASAR 中标记 unpacked 的 native 条目逐一映射到 `resources/app.asar.unpacked/<same-relative-path>`，反向列出所有未映射物理 `.node`。测试 credential addon `windows_credentials_test.node` 与经 profile 确认的其他 test/smoke/fixture native 必须拒绝；未知 `.node` 标为 `unclassified` 并阻止 structure passed。所有依赖平台预构建文件仍哈希并标注目标匹配与否。

SQLite native 路径已按当前实际源码收敛，不以旧接受脚本的存在检测猜加载器：`packages/graph/src/index.ts` 导入 `better-sqlite3`，`GraphStore` 调用 `new Database(databasePath)` 且不传 `nativeBinding`。候选暂存包内 `better-sqlite3/package.json` 是 13.0.3；其 `lib/binding.js` 默认先调用 `getPrebuildPath()`，对 Windows x64 选择 `prebuilds/win32-x64.node`，仅当该预构建不存在时才回退 `build/Debug/better_sqlite3.node`，再回退 `build/Release/better_sqlite3.node`。当前候选目录包含 `win32-x64.node`，所以静态预测首选该路径；其余七个平台/架构文件虽然不加载，仍在分发树内且必须入清单。

这个结果只能报告 `loaderPrediction`，不能报告 runtime 已加载。后续扫描须从候选 ASAR 副本读取其 package version 和 `lib/binding.js`，确认代码形状符合经审查的 13.0.3 selector，再按 `win32/x64` 规则检查首选路径和 PE machine。版本或 loader 形状不同、首选缺失且 fallback/结构不能准确预测时标记 `not-evaluated` 或结构失败；不得加载该 addon 来消除未知。外层 portable stub machine 与内层 app EXE/native machine 分列。

当前 Credential Manager 生产/test build 与 production-only copy 是独立脚本，常规 desktop build 不调用 copy，`main.ts` 也未导入/构造 production adapter；实际旧暂存树未观察到两种 credential addon。Manifest 只报文件 presence/absence，`runtimeWiring` 固定 `not-assessed`；test variant 缺席不能证明 production feature 接线。

## 扫描资源与 child 生命周期门

这些是阶段 B 的硬上限建议：最多 5,000 个物理文件、深度 64、单文件 2 GiB、两个 artifact root 合计 8 GiB；超限立即 `incomplete`，不得截断后报告 complete。全扫描 deadline 15 分钟；每个 PE 的 signature child 最多 15 秒。用户 Ctrl+C/AbortSignal 传播到当前操作。实际 scan 不做源码内容日志。

Node orchestrator 只启动本轮明确创建的 PowerShell reader/signature child，不经 shell，不按进程名查杀；helper 不启动子进程，因此受管 PID 集就是本轮全部 child tree。若实现需要孙进程，阶段 B 不通过，必须先另行审查仅限本轮 Job Object 的树级生命周期方案。逐个记录 child 的 `spawn`、`error`、`exit`、`close`；没有成功 `spawn`、合法有界 JSON 回复、exit code 0 且观察到 `close`，不得接纳结果。每次签名调用单独 child，以便独立施加 deadline。

取消/超时后只对已记录的本轮 child PID 发终止，再等最多 5 秒确认 `close`。已确认所有 child/handle 关闭时，可写 `scan.status=incomplete` 的有限报告并以退出码 3 结束。任一 child 未确认退出时不得发布 manifest，不得清理它可能正在使用的临时目录；返回固定失败码并保留 run-owned现场。不得调用 taskkill 按名称、系统级 PID 搜索或清理不属于本次 run 的路径。

单个 child stdout 上限 64 KiB、stderr 4 KiB；stderr 内容不回显，只映射固定错误码。console stdout 上限 1 KiB。签名 Subject/Issuer 单字段最多 2,048 字符、EKU 最多 16 项且每项最多 256 字符；超限标记 incomplete，不静默截断。最终 JSON 上限 32 MiB；所有状态和报告字段受严格 schema 检查。`--out-dir` 必须为输入根外新建的独占目录，已存在即拒绝。

## 后续文件切片与接受门

协调方接受阶段 A 后才派纯协议两文件；它没有实际 artifact 扫描命令，也不碰 root `package.json`。真实 reader CLI 必须是另一个经复审切片，建议文件为：

1. `apps/desktop/scripts/windows-artifact-manifest.cjs`：参数/DTO、manifest 编排与 exit mapping；通过注入的 reader/signature ports 连接子进程。
2. `apps/desktop/scripts/windows-artifact-reader.ps1`：受审 Windows handle-relative root/file 枚举、属性和身份、固定限额、stream hash、受控 ASAR private copy；不加载 artifact。
3. `apps/desktop/scripts/windows-artifact-signature.ps1`：每 PE 一个独立 bounded 调用，仅对 reader 锁定并映射的候选对象执行系统 Authenticode 查询，返回 raw 状态和有限 signer DTO。
4. `apps/desktop/src/windows-artifact-manifest.test.ts` 与 Windows-owned fixture helper：纯协议、伪签名与真实 OS reader 的自有临时 fixtures；安全 reader 完成前不得注册或运行公开 CLI。
5. 只有真实 reader、signature 和 CLI 所有门经独立复审后，才改根 `package.json` 注册 `verify:win-artifact`；不增依赖、不改 lockfile、native、build 规则或冻结的 `windows-portable-acceptance.cjs`。

阶段 B 的接受门包括：

- fixture 验证每种 reparse/root/后代 junction、逐层替换、文件改写/删除、目录成员集变化都失败关闭；控制并证明 handle sharing 实际阻止替换；读取使用稳定 file identity，hash 与签名结果按完整 identity 配对。
- ASAR reader 只接触本轮副本；验证复制前后 SHA、parser 打开期间副本身份/字节稳定和 parse 后 hash 相同。证明未 require addon、未运行任何候选 JS/EXE/worker。
- better-sqlite3 选择测试使用候选 `package.json` 与静态 `lib/binding.js` 形状，覆盖预构建优先、缺少时 Debug/Release 回退、目标 arch 与未知 loader 拒绝；不导入/require `.node`。报告是 selector 预测，不是 runtime 证据。
- Authenticode fixture 保留 `Valid`、`NotSigned`、`HashMismatch`、`NotTrusted`、`UnknownError`、`NotSupportedFileFormat`、`Incompatible` 原值；分别测试证书摘要和 publisher policy matched/mismatch/not-evaluated。验证离线约束，不能保证无远程状态检索时报告 not-evaluated。
- 超时、取消、spawn error、exit 非零、截断/非法 JSON、stdout/stderr 超限、exit 后未 close、close 未确认、总时限与每签名时限都不生成 complete；只终止本轮可追踪的 PID，确认关闭前不清理 scratch。
- 资源上限、exclusive output、路径隔离、严格 JSON、脱敏码、退出码矩阵逐项回归。只有阶段 B 全通过并由协调方复审后，才用明确选择的旧候选目录做一次只读真实检查；旧目录报告永远不证明当前 HEAD 来源、runtime 加载或安装交互。

源绑定、Python worker 源文件逐字节比较、新 runtime 最终打包、安装/升级/卸载、真实 GUI、签名证书购买与公开发布仍是后续门。本轮不改旧结构脚本，不运行测试/reader/artifact/build/GUI/远程/凭据流程。
