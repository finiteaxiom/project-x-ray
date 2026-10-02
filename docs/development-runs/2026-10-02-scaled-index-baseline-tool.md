# 有界合成规模索引基准工具（3C-L）

## 目标与边界

保留原三文件 `small` 样例，增加显式 `--sample medium` 的确定性 128 文件样例：96 个 TypeScript、32 个 Python 文件，每个文件一个函数，按语言各自形成静态导入与调用链。生成器固定版本、路径、内容摘要和总清单摘要。所有权仍限于这轮批准的基准工具；没有修改产品代码、契约、依赖、旧基准、界面或 GUI。

本轮改动限于五个基准源/测试文件与本记录。未读取或修改 Sol worktree。

## 基线与并行变更

开发开始时主 checkout 的 HEAD 为 `3f58ddc24a395f1d8bc2b585ac942ed41d24cfc2`。执行期间 `main`/`origin/main` 前进至 `38bfecb32696bb6c427fe33e6760dd13fc7eb519`，新增的 `c36d67a` 与 `38bfecb` 涉及 `AGENTS.md`、决策、计划和开发记录。通过对比起始提交与新 HEAD 的五个目标基准路径，确认并行提交没有改动这些路径；使用的是当前更新后的 `AGENTS.md`。

## 实现

- 新共享 registry 同时服务父进程和 child；未知样例 ID 不接受。`small` 保留原 ID、三个文件、原内容 SHA-256 与原 manifest SHA-256（`349b98cad20599c35920c5cc3c37aa7d703e4c5410bd49ce1eab86dd634b33c9`）。
- `medium` 使用 generator version `1`、ID `e2e-project-medium-v1` 和固定 manifest SHA-256 `0c250b857248c59e5aaa9d40341857f10770049d128e70010f10a9a3dc2ed9aa`。当前固定内容共 13,518 字节，最大单文件 115 字节；硬限制仍是单文件 4,096 字节、总源码 512 KiB。
- 父进程将选定样例 ID 传给 child，并把同一选择绑定到协议解析。两侧都与 registry 的完整有序清单逐项核对，覆盖路径、语言、字节数、文件摘要、数量和 manifest 摘要；child 还将索引返回的冷/暖 `sourceFiles` 与 registry 比较。
- medium child 报告冷/暖 source manifest、快照身份、健康计数、规范化结果/持久化摘要、节点/证据导航摘要及源码解析结果。父进程从这些值重算原有 11 项门禁，并检查汇总计数与配对证据一致；small 仍使用原终端摘要形状。
- 固定 128 文件下，索引进度最多按 discovering 1、reading 128、analyzing 128、verifying 129、persisting 1 计为每轮 387 条；冷/暖摘要合计 774 条。合成最大摘要行实测 85,679 字符，因此把原 32 KiB 限制提高到固定 128 KiB（131,072 字符），并由测试锁定测量值与上限，没有启用无限缓冲。
- 保留原 11 项门禁、完整证据源码导航、独占报告写入、最多五轮、5,000–180,000 ms 总时限、取消后强制终止路径，以及仅统计 Node child 的 RSS 口径。medium 根报告标记样例版本、摘要、文件数、语言数与源码字节数。

## 反馈闭环与验证

首次 `vitest` 定向运行有一项负向协议测试未失败：测试把排序后第 0 项改为 `Python`，但该项本来就是 Python。这是测试夹具错误，不是协议校验缺陷。核对 registry 排序后将错误输入改为第 32 项 TypeScript 文件，再运行时该恶意语言声明被拒绝；完整定向回归通过。

首次严格 TypeScript 检查也发现 registry 文件语言类型被推宽为 `string`，且对 `unknown` 计数字段的运行时数组检查未自动产生属性级类型收窄。将 manifest helper 接受的边界字段类型明确化，并在完整校验后显式使用数值局部变量；再次检查通过。

最终实际执行：

- `pnpm exec vitest run benchmarks/local-index-baseline.test.ts benchmarks/local-index-baseline-samples.test.ts --reporter=verbose`：2 个测试文件、14 项测试通过。覆盖固定 manifest/生成链与限额、small 兼容、CLI 枚举、协议摘要重复/错语言/错摘要/错版本/数量及门禁矛盾、child 未注册样例拒绝、独占报告、取消/强制终止和最大协议摘要行。
- `pnpm exec tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --allowImportingTsExtensions benchmarks/local-index-baseline.ts benchmarks/local-index-baseline-child.ts benchmarks/local-index-baseline-samples.ts benchmarks/local-index-baseline.test.ts benchmarks/local-index-baseline-samples.test.ts`：通过。
- `pnpm exec tsx benchmarks/local-index-baseline.ts --help`：输出包含 `--sample small|medium` 的用法说明。
- `git diff --check`：通过。

## 未验证项

没有运行 medium 索引、完整 small 基准、build/native/dist、Electron 或 GUI；没有据此得出规模性能或增量加速结论。现有取消回归只启动 small child 并在首次进度时取消，用于验证取消生命周期，不构成完整 small 基准测量。生成样例的实际索引结果、全部 11 项实测门禁及取消验收留给协调方的独立单窗口验收。RSS 仍只代表 Node child，不代表 Python worker 或 Electron 总内存。

## 规则沉淀判断

协调方11:01–11:08独立验收：14项定向测试、原五目标严格类型均exit0。默认small实际CLI一对run fd9ba26c-b173-40c3-be4f-332bf4b41a7d exit0，原三文件清单摘要不变、11门通过、28/28证据源码API可读。medium实际CLI一次run cd152778-cfd0-4b1e-80ae-e13f8331bc61与两次配对run 2c6a4c5d-9d26-41ed-b641-40cdf07ccd1c均exit0，共三对11门通过、128文件/387节点/1275边/1177证据/0 unknown、每对1177证据全部可读。Node24.17.0/win32/x64、graph1.3.0、typescript-program5.9.3+xray.3、python-ast2.1.1；硬限额/清单/所有证据门未减少。root额外medium-cancel ignored probe在cold reading16/128时取消，run fd52c807-2702-48d7-b850-ca477ddebf6b、exit0、closed=true、forced=false、terminal=CANCELLED、protocolError空；没有执行样例代码。

以上是本地API/工具验证，仍非GUI、真实项目性能或产品增量加速。表格、原始run报告摘要和后续分解依据见独立审查记录11:01后新增节。首次额外取消probe相对import路径在运行前核对并纠正，无运行产品错误。未新增AGENTS规则，只有既有门的独立证据。

本轮未新增或修改 `AGENTS.md` 规则。新约束只针对此固定 registry 与基准协议；本轮没有发现一条超出现有安全、证据和测试规则且有充分证据支持的通用工程经验。

## Git 收尾

未执行提交、推送或合并。本轮自身改动仅为三份既有基准文件修改、两份 registry 源/测试新增及本记录新增。最终状态另有四份范围外文档显示为修改：`docs/development-runs/2026-10-01-overnight-handoff.md`、`docs/development-runs/2026-10-01-v1-long-development-review.md`、`docs/plans/2026-10-01-v1-long-development.md`、`docs/plans/2026-10-02-non-gui-continuation.md`；本轮未编辑它们并予以保留。期间推进到 `38bfecb` 的主分支提交也保持原样。
