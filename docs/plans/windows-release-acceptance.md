# Windows 发布与安装验收设计

## 目标与范围

本文件为 V1 的 Windows x64 发布链补充可审查的实施与验收设计。它记录当前构建状态、建议的安装器和隔离验收路径、数据与凭据的生命周期，以及每项结果所需的证据。本文是设计，不表示安装器、迁移保护、测试身份或凭据接线已经实现。

遵守 [V1 长期开发计划](2026-10-01-v1-long-development.md) 的第四批范围：本地 portable 与安装包、默认保留用户数据、显式删除确认、受控的本机安装/升级/重启/卸载验收。Python 与 Git 继续作为可选外部运行时；本轮不捆绑或下载它们。干净 Windows 环境由用户决定跳过，持续标记为未验收。

不在本设计中的工作：构建或安装软件、运行样例项目代码、修改 Windows 安全设置、购买证书、公开上传二进制、实现自动更新，或执行任何 Git 写操作。正式公开发布和可信签名须另行授权。

## 当前状态（代码检查，未运行构建）

| 项目 | 当前实现 | 验收含义 |
| --- | --- | --- |
| Windows 目标 | 根 `package.json` 仅配置 `portable` / `x64`；`dist:win` 调用 `electron-builder --win portable --x64`。 | 当前没有 NSIS 安装包或卸载流程可供验收。 |
| 应用身份 | `appId` 为 `com.projectxray.desktop`，`productName` 为 `Project X-Ray`，根版本为 `0.1.0`。 | 正式应用升级需保持身份与现有用户数据位置兼容；测试安装不得复用生产身份。 |
| 结构验收 | `verify:win-portable` 检查构建配置、ASAR、物理 Python worker、应用与 native addon 架构，并输出文件大小与 SHA-256 清单。 | 这是构建产物的结构证据；脚本不启动应用、不验证安装/卸载、SQLite 迁移或 Authenticode。`--preflight` 也会创建并删除临时微型 ASAR，不在本设计阶段运行。 |
| 数据位置 | `main.ts` 从 `app.getPath("userData")` 派生 `project-xray.sqlite`、`projects/` 和 `repositories/`。E2E 可通过 `XRAY_E2E_USER_DATA` 覆盖此路径。 | 不得以 portable EXE 所在目录作为数据保存约定。E2E 环境变量不是测试安装器隔离身份的替代品。 |
| 数据库 | `GraphStore` 使用 WAL；已检查的主 checkout 迁移最高为 9。历史快照在缺少不可变源码时会保留为 partial。 | 用隔离数据验证迁移；不要 reset、删除、覆盖或在用户目录上做升级试验。1C-2A 的独立 worktree 实施正在进行，计划引入迁移版本 10；该迁移不在本 checkout。集成前后重新核对源码中的迁移号和顺序，不把计划当成已实现。 |
| 签名 | 根构建配置中没有显式签名者/证书配置。electron-builder 也可能读取构建环境的签名材料，因此配置缺失不等于已检查产物未签名。 | 逐个实际交付产物原样记录 Authenticode `Status`。仅 `NotSigned` 记为未签名；`HashMismatch`、`NotTrusted`、`UnknownError` 等保留为实际状态并判失败；`NotSupportedFileFormat`、`Incompatible`、未知状态或无法执行检查标记未验收。`Valid` 只记录 cmdlet 的签名状态，不单独证明发布者可信。 |
| OS 凭据 | ADR-0007 设计 Windows Credential Manager 接线，但本次检查的 desktop/native 源码还没有 `CredWriteW`、`CredReadW` 或 `CredDeleteW` 实现；1C-2B 尚待实施。 | 本设计只规定后续验收要求，不声称生产凭据已可保存或删除。 |

当前 portable 检查的文件清单和限制见 [`windows-portable.md`](../windows-portable.md) 及其开发记录 [`2026-10-01-windows-portable-packaging.md`](../development-runs/2026-10-01-windows-portable-packaging.md)。

## 发布目标与身份

### 产物

功能与版本冻结后，同一源码提交和 x64 运行时依赖应生成：

1. x64 portable EXE，供免安装使用；
2. x64 per-user Windows 安装包，安装、升级和卸载路径由 NSIS 提供；
3. 对应结构验收与来源清单，覆盖每个实际分发文件。

`electron-builder@26.15.3` 已在锁文件中，能够配置 NSIS target。后续实现可在不增加运行时依赖的情况下，评估将 target 扩为 `portable` 与 `nsis`。NSIS 选择应显式设置 `oneClick: true`、`perMachine: false`，并在真实安装中验证目标为当前用户、无管理员权限提升且不要求全机写入。不要使用会提供机器范围安装选项的 assisted 安装流程来冒充强制 per-user 安装。

建议显式 artifact name，例如 `Project-X-Ray-${version}-setup.${ext}`，同时保留当前 portable 命名；精确名称由实现批次核对构建器产物后确定。不要只凭配置宣称安装包已生成。

### 正式身份和测试身份

- 正式包保持 `appId: com.projectxray.desktop`、`productName: Project X-Ray` 和既有 package name，作为正式路径兼容的源码/配置约束。portable 与安装器预期解析到同一正式用户数据目录，但本轮没有对正式数据路径或数据库做运行验证。
- 测试安装必须同时使用清晰可见、独立的 `appId`、package `name` 与 `productName`，并在 Electron `ready` 前通过受控测试构建明确设置专用 `userData` 路径。建议位于当前用户 `%APPDATA%` 下具有醒目 `Acceptance` 标识的独立目录。测试数据库、项目数据库、缓存、配置和 session 均须落在该目录树内。
- `appId` 不会替代 `userData` 路径隔离。现有 `XRAY_E2E_USER_DATA` 仅为运行时覆盖；测试包还须断言 `app.getPath("userData")` 与正式路径不同，并把解析出的路径写入本地验收记录。
- portable 和 NSIS 测试产物使用同一套隔离验收身份及同一个显式测试 `userData`。让两种产物同时留在测试机上，交替启动并串行访问同一测试数据库，覆盖共存、交叉升级、重启与卸载后的数据保留；任一时刻只运行一个会写该数据库的进程。
- 正式路径兼容只通过只读源码/配置核对，或专用验收构建在打开主数据库/`AnalysisBroker` 前报告并退出的路径检查来验证。若使用显式隔离 `userData` 覆盖，只能证明隔离接线，不能作为正式默认路径或正式数据库兼容证据。不得读取、写入、迁移、复制或比较生产数据库来证明兼容。
- 安装/卸载验收只能读写测试身份的数据。测试完成后的清理仅允许针对这条已核对的测试路径；不得依赖模糊名称搜索或通配符清理。

Electron 将 `userData` 默认放在 `%APPDATA%` 下，并支持在 `ready` 前用 `app.setPath("userData", ...)` 覆盖。`productName` 优先于 package `name` 参与应用名称解析，故测试隔离需要一并设置并记录这些身份字段。参考 [Electron `app` API](https://www.electronjs.org/docs/latest/api/app)。

## 安装、升级、数据与卸载约定

### 用户数据和 SQLite

1. 安装、应用升级、portable 可执行文件替换、重启和卸载默认都保留 `%APPDATA%` 中的用户数据。
2. 卸载器不删除项目数据库、主 SQLite、源码快照、仓库缓存、配置或 OS 凭据。卸载确认页必须清楚说明保留的数据位置；若未来加入应用内清理功能，必须单独列出数据类别并要求明确的删除确认。
3. 不得以迁移失败为由自动清空数据库、重建空库覆盖旧库、删除用户数据或跳过失败迁移后继续运行。出现不兼容或迁移错误时，固定诊断应说明如何保留现场并恢复备份，不能把异常或源码写入日志。
4. SQLite 升级夹具必须是自有、可丢弃且不含个人项目数据的副本。至少覆盖当前 schema 9、迁移所涉及的代表性旧 schema、含旧 `partial` 快照的库，以及功能合入后的最高 schema。按真实迁移历史决定夹具组合，不能假定版本号连续等同于执行顺序。
5. 每次升级前，在应用关闭且数据库处于一致状态后创建可恢复副本；使用 SQLite backup API，或确认 checkpoint 与 WAL/SHM sidecar 一致后复制。验收应记录还原到隔离目录并再次打开成功。不得对真实用户数据库进行安装回归。
6. 升级后核对快照、源码证据、项目配置、掌握度、ownership attempts 和 current 指针；关闭重启后再次核对。没有迁移涉及的字段也不得被悄然重置。

### 凭据

- 依据 [ADR-0007](../decisions/0007-evidence-constrained-remote-explanations.md)，生产 key 的目标只能是应用自有、固定的 Windows Credential Manager target。应用不得扫描 OS 凭据、环境变量、其他 target 或密码管理器内容。
- 安装与卸载默认不删除生产凭据；只有用户主动使用应用内“忘记密钥”并确认后，才删除应用自有 target。确认文案应说明具体 provider 和影响。不得在卸载时静默清除凭据。
- 1C-2B 集成后，凭据自动验收仅对自生成、非秘密的测试值和编译期固定的独立测试 target 执行写入/读取/删除/重启检查。测试 target 不得与生产 target 相同；验收不得枚举或读取现有用户 key。
- 真实用户 key 的录入、授权和删除由用户在可审查 UI 手动操作。不要把 key 写入命令行、环境变量、数据库、日志、manifest、测试结果或聊天。没有 key 时真实远程调用保持未验收。
- 目前 native Credential Manager 能力尚未接线；本节是后续约束，不是本轮已通过的 OS 凭据测试。

## 可复核的本机验收矩阵

除构建结构检查外，交互项须操作实际 Windows 应用/安装器；进程启动码、开发人员自述、协议替身、旧截图不能替代 GUI 结果。验收只使用隔离测试身份和自有样例，不执行导入项目中的代码。每项记录构建版本、提交 SHA、产物 SHA-256、OS/架构、应用身份、实际 `userData` 路径、输入夹具标识、步骤、观察结果、恢复结果和未覆盖项。

| 阶段 | 测试路径和检查 | 通过所需证据 |
| --- | --- | --- |
| 构建结构 | portable 与 NSIS 均为 x64 应用；ASAR、外置 Python worker、secure reader 和 SQLite native addon 布局正确；目标/版本/文件名匹配。 | 每个目标的结构检查结果；安装包、portable、app EXE、ASAR 和 worker 的 SHA-256。 |
| 签名状态 | 对每个可执行交付物运行 `Get-AuthenticodeSignature`，逐字记录它实际返回的 `Status`，以及可用的安全摘要；不保存证书私钥或无关证书信息。 | 只有返回 `NotSigned` 才标记未签名；`HashMismatch`、`NotTrusted`、`UnknownError` 等按原值记录并判验收失败。`NotSupportedFileFormat`、`Incompatible`、未知状态或检查不可用标记未验收。`Valid` 不等于发布者已获信任，须另按预先确定的发布者策略检查签名者身份和信任链。参见 [Microsoft 状态枚举](https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.signaturestatus) 与 [cmdlet 文档](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature)。文件哈希和签名存在本身都不能证明发布者可信。 |
| 隔离首次安装 | 在测试 appId/userData 下安装并启动实际 NSIS 包，观察是否为 per-user 安装、是否意外请求管理员权限；导入安全的自有样例，完成本地索引与图查询，退出再启动。 | 安装路径、进程身份、实际 `userData`、日志中无源码/凭据、数据重开后仍在。 |
| 旧版本升级 | 用旧测试安装与旧 schema 夹具生成可识别记录，再原位升级新版本；不触碰生产身份。 | 自动迁移成功、记录与 current 指针保持、旧快照 partial 语义正确、重启后仍一致；升级前隔离备份可还原。 |
| 失败恢复 | 只在隔离夹具上触发已知迁移失败或不兼容输入。 | 应用失败关闭，不清库、不覆盖备份；依照记录步骤还原夹具并确认可再次打开。不要为此修改系统设置或破坏真实数据。 |
| portable/安装器共存、升级与重启 | portable 与 NSIS 测试产物都使用相同的隔离验收 appId/package 名/productName 及同一显式测试 `userData`。两种产物同时保留，交替启动、读写同一自有夹具，覆盖 NSIS 升级、portable 替换、切换产物后重启。一次只运行一个会写库的实例。 | 记录隔离身份和实际测试 `userData`；两个入口都能看到同一测试数据，升级与重启后状态一致。此项不能访问生产数据库。 |
| 卸载 | 对测试安装器执行实际卸载；随后检查测试 DB、项目 DB、缓存和测试凭据 target 的默认保留结果；重装后再次打开。 | 卸载器没有隐式数据删除；测试数据可用。显式应用内清理功能（若实现）另由用户在测试数据上手动确认后验证精确清理范围。 |
| 外部运行时 | 在当前 Windows 上分别让 Python 或 Git 不可用，再按产品路径查看诊断与恢复；不改系统级设置，可使用受控子进程 PATH。 | 缺 Python 只限制 Python 分析，缺 Git 只限制 Git 操作；TS/JS 本地路径仍可用，固定诊断不泄漏源码，恢复后需新进程并按产品要求重试。此测试不是干净 Windows 验收。 |
| 干净机器 | 不执行。本计划明确记录用户已跳过。 | 状态保持“未验收”，不得以当前机器 PATH 模拟或静态检查改写状态。 |

NSIS per-user 参数含义和默认行为见 [electron-builder NSIS 文档](https://www.electron.build/v26/docs/nsis/)；实施时仍须核对实际生成包的安装行为，不能把文档配置当作本机交互证据。

### 已有验收证据与正式路径边界

既有 [Windows 独立验收记录](../development-runs/2026-10-01-windows-independent-review.md) 记载了 portable x64 实际交互范围：使用隔离 `userData` 和自有受控样例，操作索引、Python/Git 降级与恢复、源码导航、快照持久化及重启等路径；对应产物版本、哈希和边界以该记录为准。这是 portable 的历史验收证据，不是本轮重跑结果，也没有安装器覆盖。

正式 app identity 与数据路径兼容目前仅有源码/配置层面的只读核对。没有通过读取、写入或迁移正式数据库来做兼容证明；portable 与安装器共用同一隔离身份及测试数据库的实际验收仍待安装器实现后执行。

## 清单与发布判定

每个候选版本生成一个本地验收 JSON，至少包含：产品版本、源码提交 SHA、构建工具版本、Electron 版本、target、目标架构、appId/productName、文件名、字节数和 SHA-256、每个 EXE/DLL 的 Authenticode 原始 `Status`（不归并错误值）、可用的签名者安全摘要及独立的发布者信任结论、结构检查结果、测试身份、已验证的实际测试 `userData` 路径、SQLite 夹具/迁移结果、交互矩阵状态、环境和未验收项。不要写入绝对源码路径、样例源码、项目名称、密钥、凭据目标的秘密内容或私钥。

发布判定应分别标记：

- **构建结构通过**：产物布局与架构检查通过；
- **本机交互通过**：所列 Windows 安装/升级/启动/重启/卸载步骤已操作并记录；
- **签名状态**：逐字记录实际 Authenticode `Status`。仅 `NotSigned` 表示未签名；`HashMismatch`、`NotTrusted`、`UnknownError` 等表示签名验收失败；不支持、不可用或未识别状态保持未验收。`Valid` 表示 cmdlet 报告签名有效性，不等于发布者信任已验证；只有签名者身份与信任链符合预先确定的发布者策略后，才单列“发布者已验证”；
- **干净 Windows 未验收**：用户跳过，始终单列；
- **公开发布未授权/未执行**：不能由本地产物验收自动推导。

哈希固定的是被检查文件的字节；签名检查应保留 Windows/PowerShell 实际状态，并另行评估发布者身份与信任。Microsoft 将 `Valid` 定义为签名在语法上有效，但明确不蕴含信任；状态定义见 [SignatureStatus 枚举](https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.signaturestatus)。electron-builder 的签名行为可受外部构建配置影响，参考 [Windows code signing 文档](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)。本轮没有构建产物、安装运行或 Authenticode 检查结果。

## 本轮状态

本文件仅为 Windows 发布验收设计。当前 portable 配置和静态结构脚本是已检查到的实现；NSIS/per-user target、测试应用身份和数据路径、安装与升级矩阵、SQLite 备份验证、扩展 manifest、卸载行为和 Credential Manager 接线均为待实现或待运行验收。独立验收记录中的 portable 结果属于已完成的历史测试范围；正式路径兼容仍未做运行操作。实现批次开始时须重新读取代码、锁文件和 Git 基线，确认并行任务合入状态后再据此派发。
