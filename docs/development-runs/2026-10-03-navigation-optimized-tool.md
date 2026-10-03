# 3F-T2 导航优化测量工具实施记录

日期：2026-10-03

## 目标和边界

在 Windows 主 checkout 增加 v2 导航测量 CLI、受控 child 和契约/生命周期测试。仅新增本记录与以下三个源码文件：

- `benchmarks/local-index-navigation-optimized.ts`
- `benchmarks/local-index-navigation-optimized-child.ts`
- `benchmarks/local-index-navigation-optimized.test.ts`

不修改应用、图、契约、旧 v1 工具/测试、固定样例、依赖、native 或 UI；未启动正式 benchmark、native/build/dist、Electron 或 GUI。child 仅支持固定 synthetic medium128 fixture，索引时不执行样例代码。

## 基线与实施

开工时 checkout 为 `7a2e2b830bec85d3e8051acd18fd27ba768b3ae9`，工作区干净；C2 commit `db0630edcf82dfab25478b1b156ca2f98c232717` 与派发基线均为当前历史祖先。开工检查确认计划列出的 C2 接口、v1 parent/child/test、baseline 和 samples 六项冻结 SHA-256 一致。

严格类型检查随后发现冻结 baseline helper 中显式传入 `signal: undefined` 与 `exactOptionalPropertyTypes` 冲突。协调方另行审查并只修改该 helper 调用：未提供 signal 时省略属性。该修正不属于 T2 四文件；完成后的提交为 `ce1b9b547ebd29a5eab8c98110a2412aea12eb58`，`origin/main` 已核实精确指向同一 SHA。T2 复核确认新的 helper SHA-256 为 `5F437278E5148EFFA662BC736B1704C8EB1BC1652D703F060C60F04B69BB9FE7`，其他五项冻结依赖仍与计划一致。

v2 使用独立 `XRAY_NAVIGATION_OPTIMIZED_V2:` 协议、summary/report schema 2 和 exact-key 校验；公开 C2 observer scope 提供决策、candidate、race、外部观察及准入数据。完整加载计数在实际 `GraphStore.loadSnapshot` 边界记录，并与 storage 指标及每种 API 的调用机会交叉验证。报告保留语义门、候选终态、observer coverage、资源限制和受控 child close 信息，不输出源码、路径、ID、hash 或 token 原值。完整严格类型检查还核对 child runtime 与 root 环境一致，并拒绝与终态门状态矛盾的协议码。

## 失败诊断与修正

1. 首次运行优化工具测试未进入收集阶段：一个非 `async` 测试回调包含 `await`。将回调声明为 `async` 后，测试正常收集。
2. 首次严格 `tsc` 检查发现新文件的泛型 map 索引和 `unknown` 嵌套属性没有充分窄化；同时复现了上述 baseline 的 `TS2379`。修复 T2 自有文件的窄化，并在协调方完成单独 helper 修正后，用完整严格选项重新检查。未关闭 `exactOptionalPropertyTypes` 作为通过。
3. 契约复核发现完整加载的分项上界应受每个 API 的 1,177 次机会约束，且 pair 可比较性要求 child 环境与 root 环境一致；增加对应校验和 synthetic 负例。新增终态码/summary 关系检查及矛盾消息负例。

没有发现需要修改 C2 或 v1 的产品缺陷。共享 checkout 另有两份既有协调开发记录出现并行修改；它们不是 T2 范围，本轮未改写或覆盖。

## 实际验证

- `pnpm exec vitest run benchmarks/local-index-navigation-optimized.test.ts benchmarks/local-index-navigation-diagnostic.test.ts`：通过，2 个文件、22 项测试。包含 synthetic v2 计数/协议/报告校验、资源边界和受控 child 取消/超时生命周期，以及冻结 v1 测试；没有运行实际 medium child。
- `pnpm exec tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --forceConsistentCasingInFileNames --skipLibCheck --resolveJsonModule --allowImportingTsExtensions --types node benchmarks/local-index-navigation-optimized.ts benchmarks/local-index-navigation-optimized-child.ts benchmarks/local-index-navigation-optimized.test.ts`：通过。
- 使用 PowerShell `Get-FileHash -Algorithm SHA256` 复核 C2/v1/helper 六项冻结依赖：与计划及协调方批准的 helper 修正 hash 一致。
- 新增三个 T2 源文件的尾随空格检查通过；`git diff --check` 对跟踪差异未报告空白错误。

T2 源文件交付 SHA-256：

- parent：`27F91337E3AE9A65356CFE00F04B3240D16F9A7D9B501A70D78879C97710BB0F`
- child：`D997304140AB0A784EC538B803997470E0F8463D4E1BD43338CE113779E62FE7`
- test：`FEF9923F1B5A97E4E91AEB33F92819AB8B2E0CC79446A5358290DE2FBD04227A`

初次测试语法失败与初次严格类型错误均已修复并在最终命令下复验；未把关闭精确可选属性的诊断运行计作验收。

## 未验证项与规则判断

实际 CLI、真实 child 端到端运行、受控第二连接安全 challenge、cancel/timeout 的整工具流程及单次 `--pairs 3` 正式测量均留给协调方窗口。尚无任何正式性能结论；median/min/max 及每对原始性能值须基于该单次三配对报告复核。没有运行 Electron、GUI、native/build/dist 或安装脚本。

本轮不新增或修订 `AGENTS.md` 经验：协议关系和测试门已经由本轮任务计划及现有仓库规则覆盖；baseline 精确可选属性问题由协调方单独修复并记录，不归入 T2 工具经验。T2 未执行 Git 提交、推送、重置或清理。

## 独立真实 child 复审后的修正

协调方随后用真实 medium fixture、真实索引/observer/GraphStore 和真实导航响应进行单窗口 adversarial 检查。协调方报告三类返回值篡改都曾被工具错误记为完成、11 项语义门通过且优化门通过：`readSource.content` 被替换但沿用原 `contentHash`、`targetSpan` 行号被改、返回 `evidence.span` 行号被改。本轮只读了协调方提供的复现探针，没有再次运行真实 child 或正式三配对。

根因确认在原导航核验：只比较声明的 `contentHash`、少量 ID 和 `filePath`，未对实际返回内容重算 SHA-256，也未核对完整 `IdentifiedEvidence`、目标范围及返回证据范围。因此两轮返回相同的伪响应仍可绕过跨轮比较。

在父工具中新增纯 `navigationEvidenceResponseFailures` 核验函数，child 的 cold/warm 真实 API 循环调用同一函数。核验完整 evidence 身份、当前 snapshot 与 medium fixture 文件身份、返回源码及 workspace hash、字节数、内容字节、完整 targetSpan 和完整 source evidence。失败使用现有 lookup/source 语义错误码，进入现有 `navigationResolved` 语义门；schema、11 个门名、请求数、顺序、observer 和加载门均未改变。测试通过同一共享核验函数接受完整正常响应，并拒绝错误 evidence identity、篡改内容、篡改 targetSpan 和篡改 evidence span。

由于源码重算 hash 与完整响应校验运行在 navigation evidence loop，报告 limitation 明确标注这部分开销计入 navigation wall/evidenceLoop、但不计入 application API/store 内部计时；没有扣除该开销或据此宣称性能提升。

修正后复验：`pnpm exec vitest run benchmarks/local-index-navigation-optimized.test.ts benchmarks/local-index-navigation-diagnostic.test.ts` 通过，2 个文件、23 项测试；前述完整严格 TypeScript 命令（含 `exactOptionalPropertyTypes`）通过。真实 child 对抗复现、CLI、challenge、`--pairs 3` 和性能结论仍由协调方复验；本记录不把 synthetic 单元负例冒充真实 child 复验。
