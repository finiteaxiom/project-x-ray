# 2D-L3：语义任务持久元数据纯契约

日期：2026-10-05。此批仅在既有任务身份契约文件中增加持久记录 schema/type 与测试，并新增本记录；无 barrel、SQL、application、LLM、desktop、UI 或公开请求改动。

## 基线与范围

- checkout `main`，实施前 `HEAD=d27f1a1f56d2010b595480e42fd6307035722923`。
- 实施前工作区仅有既存的协调/开发记录修改与两份未跟踪计划；全部保留。本轮只读 Git 状态，没有 Git 写操作。
- 已读 `AGENTS.md` 与批准计划 `docs/plans/2026-10-05-ownership-semantic-task-record.md`。目标记录文件实施前不存在。
- 在编辑前将 `ownership-semantic-task.ts`、`ownership-semantic-task.test.ts` 原始字节分别作 base64 内存副本，并记录 SHA-256；未在仓库或临时目录写备份。

## 源码依据与实现

- 计划要求 record 与完整 semantic captured identity 分开，且旧 feature record 不可扩成语义任务。现有 `remoteFailureCodeSchema` 是有限错误码枚举；旧解释记录允许 `preparing`，不适合作为语义持久任务 phase。
- 新增 strict `ownershipSemanticTaskRecordSchema` 与 `OwnershipSemanticTaskRecord`。嵌套 identity 继续使用原 L2 schema，原 33 个字段、版本和断言未改；原测试内容在移除本轮新增 import 后与编辑前字节内容一致。
- record phase 仅为 `dispatched/completed/failed/cancelled/interrupted`。`dispatched` 要求 `completedAt/code` 都为 null；completed 无 code；failed 必须使用有限非空 code 且排除 `CANCELLED`、`INTERRUPTED`；cancelled/interrupted 分别要求对应专属 code。无 `preparing` 或 `reserved` 持久 phase。
- terminal 时间不得早于创建时间。比较器按固定宽度 UTC 整秒前缀及右补零后的完整小数秒比较，不使用毫秒精度 `Date.parse` 判断先后。
- 使用 `canonicalJson` 与既有 UTF-8 计数验证整个合法记录不超过 16 KiB。最大值测试组合最坏 JSON 控制字符转义、最大 ID/version/model、最大 revision、最长合法时间和最长有限 code，并验证 canonical JSON 往返。
- barrel 已有 `export *`，故未改 `index.ts`。schema parse 仅表示字段、phase/code/time 顺序及存储上限合法；不表示 SQL 来源/授权/currentness、真实 dispatch、结果发布或取消/中断实际完成。

## 验证与失败分类

- 定向 task 测试：`pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-task.test.ts --no-file-parallelism --maxWorkers=1 --no-cache` — 1 文件、15 项通过。随后加强最大负载样例，最终整组回归再次覆盖该文件。
- 首次尝试加入 `--minWorkers=1`，Vitest 4.1.11 在启动测试前报 unknown option，没有执行测试。查询本地 CLI 参数后改用支持的 `--maxWorkers=1`；这是命令参数错误，不是测试或产品失败。
- 最终适用回归（串行、单 worker、禁文件并行、禁缓存）：`pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-task.test.ts src/ownership-semantic-policy.test.ts src/ownership-semantics.test.ts src/remote-explanation.test.ts src/remote-explanation-desktop.test.ts src/ownership-capsule.test.ts src/index.test.ts --no-file-parallelism --maxWorkers=1 --no-cache` — 7 文件、163 项通过。
- `pnpm --filter @project-xray/contracts typecheck` — `tsc -p tsconfig.json --noEmit` 通过。
- 辅助原字节核对脚本起初假定 exec isolate 有 `atob`/`TextDecoder` 全局，分别触发 `ReferenceError`；用本地小型 Base64/UTF-8 解码器重试成功。已核实去掉新增 import 后 L2 源文件原内容完整保留为追加 record contract 前缀，L2 测试文件原内容完整保留为追加 record tests 前缀。属辅助脚本与工具 API 假设不匹配，不是仓库产品/测试缺陷。
- 本轮没有确认的产品缺陷或测试缺陷；没有运行 build、数据库、provider、网络、native、Electron、GUI 或导入仓库代码。

## 编辑前原始哈希

- `packages/contracts/src/ownership-semantic-task.ts` — `284D416F39922D79DB097203E73B6E9068BCF366D6FB63036F1F6A47A0CF08FE`
- `packages/contracts/src/ownership-semantic-task.test.ts` — `21ACA9E5B424E2A9AEEB088C7E98EC351D5F61477356C194BAF195D8062C564F`

## 冻结 SHA-256

- `packages/contracts/src/ownership-semantic-task.ts` — `EA1D7F5ADB5758AD729FB7CF9C09CA884ADEDB8B25DD77093020C9EBF305D22C`
- `packages/contracts/src/ownership-semantic-task.test.ts` — `2A4D48A7621C79E596A8CE30E91220F81CB2389C5432CCF5AEDE569B8C29682D`
- 未修改的 `packages/contracts/src/index.ts` — `468826BB544391E0092608E64089FD11F7CB4303A5367D3F00EC5A4FF2E0D629`

## 未验证项与规则评估

没有验证任何 SQL 持久化/currentness 或任务生命周期；未来可信层仍须独立核实身份来源、授权、dispatch、结果发布和实际停止。不能把这个纯结构 contract 当作发送许可。

本轮没有适合新增到 `AGENTS.md` 的通用经验；既有 strict DTO 与证据/授权边界已覆盖。本记录只对应 2D-L3，其他活动计划/协调记录及 Sol 的工作均未触碰。协调方审查后按四批收尾与暂停门处理，不派发第五批。
