# 4B Windows 产物清单候选协议设计记录

2026-10-04；主 checkout；只读源码核对后新增两份设计文档。本记录对应 [候选协议](../plans/2026-10-04-windows-artifact-manifest.md)，不代表工具实现或产物验收。

## 目标、基线与范围

目标是依据当前 portable 结构、静态接受脚本、打包配置、native/worker 与凭据复制源码，给下一批独立只读候选 manifest CLI 提出 schema、路径和文件安全规则、签名状态语义、来源声明边界、具体实现文件与验收门。

开始时 `git status --short` 为空，分支为 `main`，`HEAD` 与 `origin/main` 都为 `95ebbd3b0dc88107b5b54e172138cb8685bd1bcb`。逐读根 `AGENTS.md` 与 `docs/plans/2026-10-04-windows-release-preparation.md` 后，只授权新增该计划指定的两份文档；没有改 T2、源码、package/lock、旧接受脚本、AGENTS、共同协调文件或其他目录。

## 实际只读证据

- 根 `package.json`：`dist:win` 是 `pnpm build && electron-builder --win portable --x64`；`verify:win-portable` 指向现有接受脚本。ASAR 开启、所有 `*.node` 解包，Python worker 作为 `extraResources`。
- `apps/desktop/package.json`：普通 build 是 `tsup`、`copy-python-worker.cjs`、`copy-secure-reader.cjs`；凭据 build/copy 只是单独脚本入口，没有接入普通 build。
- `apps/desktop/scripts/windows-portable-acceptance.cjs`：旧检查会解析 ASAR 路径、核 app/worker/UI 项、检查 Python worker 物理复制及其源文件哈希，并检查 `secure_reader.node` 和一个 Windows x64 SQLite addon。它只把 portable EXE、app EXE、ASAR、worker 的部分哈希写入旧 JSON；没有逐 PE Authenticode 状态、完整文件清单或来源绑定。其 `--preflight` 会创建和删除临时 ASAR，本轮未运行。
- `apps/desktop/scripts/build-credentials.cjs`、`copy-credentials.cjs`、`apps/desktop/native/binding.gyp` 与 `windows_credentials.cc`：native binding 分别构建 production/test target；copy 脚本只复制 production addon，并显式拒绝测试 variant。未运行 build/copy 脚本，也未加载 addon。
- `apps/desktop/src/windows-credentials.ts` 与 `apps/desktop/src/main.ts`：适配器会拒绝 test variant，但当前 `main.ts` 没有导入或构造 production adapter；因此源码存在不等于应用已接线。
- `dist/win-unpacked` 的只读目录枚举：153 个文件、合计 450,204,221 字节；包括 `resources/app.asar`、外置 Python worker、`secure_reader.node` 和 better-sqlite3 的八个平台/架构预构建 `.node`。未发现 `windows_credentials.node` 或 `windows_credentials_test.node`。这是当前磁盘上既存目录的观察，不是本轮重打包或功能验收。
- `dist` 有两个同版本 portable EXE、portable acceptance JSON、旧 ZIP、smoke/userData 和诊断目录。既有 acceptance JSON 写有 2026-10-01 时间戳；它不是本轮证据。第一轮未执行候选 EXE/addon/ASAR 代码或安装器；本次复审只把 unpacked better-sqlite3 的 package.json 与 lib/binding.js 当文本读取以核 selector，不 require/load addon。
- 对照 `docs/plans/windows-release-acceptance.md` 的签名规则：只把 `NotSigned` 记作未签名；其他原始 `Status` 不合并，`Valid` 不能单独证明发布者可信。新设计将每 PE 的原始签名状态、签名者摘要和独立 publisher policy 分开。

## 反馈、失败与修正

只读检索中有三次命令定位错误：一次搜索了不存在的 `docs/windows-release-acceptance.md`，一次把 PowerShell 风格通配符目录 `packages/*/native` 直接交给 `rg`，本轮另一次查询了不存在的 `packages/desktop`。分别改读实际 `docs/plans/windows-release-acceptance.md`、`apps/desktop/native` 和 `packages/graph`/候选 unpacked package 路径。均为本轮检索命令路径错误，不是产品、测试或环境缺陷；未运行产品命令，不编造红绿验证闭环。

## 设计结论与剩余未知

- 现存 `dist` 混有多个候选与 smoke/userData 内容，CLI 必须取两个显式 root，而不是扫描目录或推断版本文件。
- SHA-256 只固定读到的文件字节；命令行里的 commit SHA 是操作者声明，不能绑定二进制。第一版将 `buildAssociation` 明确输出为 `not-established`。未来同进程 build capture 只能称本地构建关联，未签名 JSON 不是密码学来源证明。
- 文件完整性清单必须包含暂存 root 内每个物理文件。PE 的 raw `Status`、证书安全摘要与 publisher-policy 匹配分别记录。ASAR/native/worker 只核逻辑路径和物理对应，不加载候选代码。
- 测试 credential addon 缺席是当前磁盘观察；不能由此宣称 production credential 功能可用。当前常规 build/copy 与 `main.ts` 接线缺口要求清单仅报告文件 presence，`runtimeWiring` 保持 `not-assessed`。
- 当前目录是否来自本轮 `HEAD`、两个 portable EXE 谁对应旁边的 `win-unpacked`、现存 `.node` 集合是否为当前可发布的精确集合、当前 Authenticode 状态均未验证。必须由下一批显式只读扫描或后续受控构建证据回答。

## 实际操作与验证

- 只读检查：`git status --short`、`git status -sb`、`git rev-parse HEAD`、`git rev-parse origin/main`、`git log -1 --oneline`；开始基线干净且 HEAD 与 origin/main 一致。
- 只读读取：根 `AGENTS.md`、第四批计划、根/desktop package、portable 接受脚本、worker/native copy/build、凭据 adapter/native source 与 tests、既有 Windows release 设计。
- 只读枚举既存 `dist` 与 `dist/win-unpacked` 文件名/大小，并读取旧 acceptance JSON。未对输出产物执行 SHA 命令或 Authenticode 检查。
- 没有运行测试、typecheck、build、package、acceptance CLI、Electron、GUI、安装器、ASAR writer/reader 回归、远程操作或凭据流程；没有创建或修改候选产物。
- 两份文档写入后实际回读；PowerShell 尾随空白检查均为 0，`git diff --check` exit 0。它对两份新未跟踪文档不提供覆盖；检查新文档内容与格式时依靠实际回读和空白扫描。diff-check 另提示两份旧开发记录存在 CRLF 工作区行尾提示。
- 初始状态干净；第一次复核时 `docs/development-runs/2026-10-01-overnight-handoff.md` 与 `docs/development-runs/2026-10-01-v1-long-development-review.md` 出现 tracked 末尾增补，diff 为协调方收尾/审查记录；本轮保持原样。第一次交付时 `HEAD/origin/main` 为 `95ebbd3b0dc88107b5b54e172138cb8685bd1bcb`。复审期间协调方另提交 `60abf56318bc95966cf2c1f307cb3ded8e553f2d`（upgrade-preservation 设计与 fixture 派发），不是本轮改动；当前 `HEAD/origin/main` 均为该 SHA。两份协调记录仍有相对当前 HEAD 的 tracked 改动；本轮未覆盖、暂存、提交或收尾。

## 工程经验判断

本轮无新增或修订 `AGENTS.md` 规则：本次是源码/目录设计核对，没有代码或复现实验足以新增通用工程经验；来源/签名与路径边界已有仓库规则覆盖。候选协议通过后，下一批应按文档所列测试门验证实际工具，不把本设计或旧报告当作实现验收。

## 2026-10-04 复审修订

协调方复审要求收敛 reader 能力、时限/子进程生命周期和输入 root 三类缺口。只修改原两份设计文档，没有实现 CLI、package 接线或 native。

- `packages/analyzer-core/src/secure-read.ts` 实际限制 `MAX_SOURCE_BYTES = 2_000_000`、读取块 64 KiB 并返回完整 Buffer；`packages/analyzer-core/native/secure_reader.cc` 用 root handle 与 `NtCreateFile` `RootDirectory` 打开相对文件，但 root/file handle 的共享标志均含 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`。因此现有源码 reader 不能证明数百 MB artifact 与签名路径在散列期间稳定，设计明确拒绝复用它。
- `packages/graph/src/index.ts` 的 `GraphStore` 直接 `new Database(databasePath)`，没有 `nativeBinding` 参数。只读了 unpacked candidate 的 better-sqlite3 13.0.3 package metadata 与 `lib/binding.js` 文本：默认先按平台/架构选 prebuild，Windows x64 路径为 `prebuilds/win32-x64.node`；该文件存在时优先于 `build/Debug`/`build/Release`，缺少时才按此顺序回退。目录内另七种预构建仍需完整入清单。此结论是静态 loader prediction，不是实际 require/runtime 结果。
- 第一实现切片收敛为纯 observation DTO 协议和自有内存 fixture；不读文件系统、不启进程、不注册真实 CLI。真实扫描被明确拆到另一个安全 reader 设计/接受门，现阶段不授权新增 native addon。后续安全 reader 必须证明 root-relative no-reparse、同一文件身份上的 stream hash 与 Authenticode 对应、ASAR 只解析精确 hash 的隔离副本；不能满足就停止。
- 明确只允许两个 artifact roots；操作者 SHA 是 inline 声明，publisher policy 是有大小/模式限制的 control input，可信结构 profile 随工具版本固定。没有 source root、cwd、当前 package/git/lockfile 读取；Python worker 对比源码延后至 build-time association。
- 新增总扫描/每 PE 签名 deadline、取消、child spawn/error/exit/close 状态、单 child/stdout/stderr/JSON/signer 上限、结构/扫描/Authenticode/publisher trust 独立状态及 exit map。未确认 child close 时不得产出 complete manifest 或清理暂存。

本轮读了上述源码和 candidate loader 文本；没有执行测试、build、reader、artifact、ASAR parser、Authenticode、PowerShell helper、Electron、GUI、远程或凭据流程，也没有读取签名/敏感环境。真实 file handle race、PowerShell/.NET same-object 签名语义、子进程退出树和离线 Authenticode 状态均未实测，留作安全 reader 阶段硬门。无足以新增通用规则的代码实验，`AGENTS.md` 无变更。
