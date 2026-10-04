# 2D-L2：语义评价捕获任务身份合约

日期：2026-10-05。范围仅为新 contracts DTO/test、本包 barrel 的一条 export，以及本记录。此批只交付内部身份结构，不包含第二批整体、SQL/currentness、真实授权、任务登记/发布、provider 调用或 GUI。

## 基线与源码依据

- checkout：`main`；实现前 `HEAD=9edaea93128b06da60411096f91fd5d349313ff3`。
- 实现前工作区已有改动：四份协调/开发文档已修改，`ownership-semantic-policy-store.md` 与本批计划为未跟踪文件；均保留，未写 Git。
- 依据 `docs/decisions/0008-evidence-constrained-ownership-semantics.md` 的“捕获身份、当前性与任务协议”字段清单（第 61–67 行）；该清单将问题指纹、attempt/rubric hash、语义版本、配置、上下文和 task 身份都纳入捕获。
- `packages/contracts/src/remote-explanation.ts` 的旧 `remoteCapturedIdentitySchema` 只扩展解释任务身份，缺少 questionFingerprint、attemptHash、rubricHash 与语义用途绑定；旧 prepare/start 仍是独立的 feature-explanation 契约。
- `ownership-semantics.ts` 提供已验证的语义 purpose/version；已冻结的 `ownership-semantic-policy.ts` 提供 disclosure/provider 常量。该策略模块未导出 purpose 常量，因此新 schema 复用语义模块中被策略使用的同一 purpose 常量，不改写冻结模块。
- 批准计划：`docs/plans/2026-10-05-ownership-semantic-task-identity.md`。实现前确认目标源、测试和本记录均不存在。

## 实现

- 新增 `ownershipSemanticCapturedIdentitySchema` 与推断类型，包含计划规定的且仅有的 33 个必填字段；对象 strict，无默认值、答案/评分正文或未知扩展字段。
- ID、hash、时间、UUID、revision、model 复用现有 bounded primitives。`ignorePolicyHash` 唯一允许 null 的 hash；questionVersion 与 deterministicScoringVersion 复用题目/语义包的非空 64 字符上限。
- 导出独立 task protocol、semantic scoring、rubric、limits 版本常量；semantic protocol 由现有 purpose/version 常量构成。purpose、disclosure、provider 复用现有契约常量，不扩展旧 feature literal。
- 只在 contracts barrel 新增一条 export。公开 prepare/start 未改变，且 schema 不接受内部身份作为 renderer 请求。
- 测试覆盖精确字段集合、逐字段缺失与类型错误、边界/版本、旧新身份互拒、公开请求隔离，以及两组各自合法但摘要绑定不同的身份均通过结构校验。

## 反馈闭环与验证

- 初始检索命令将 `docs/decisions/0008*` 作为 PowerShell 参数传给 `rg`，返回路径语法错误（OS error 123）；这是命令调用问题，不是产品、测试或环境缺陷。改用 `rg --files docs/decisions` 定位，再按实际文件名检索，确认了 ADR 字段清单。
- 定向测试：`pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-task.test.ts` — 1 文件、9 项通过。
- 类型检查：`pnpm --filter @project-xray/contracts typecheck` — `tsc -p tsconfig.json --noEmit` 通过。
- 适用回归：`pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-task.test.ts src/ownership-semantic-policy.test.ts src/ownership-semantics.test.ts src/remote-explanation.test.ts src/remote-explanation-desktop.test.ts src/index.test.ts` — 6 文件、145 项通过。
- 本轮无产品或测试失败；没有执行 build、provider、SQL、GUI、网络或凭据操作。

## 冻结 SHA-256

- `packages/contracts/src/ownership-semantic-task.ts` — `284D416F39922D79DB097203E73B6E9068BCF366D6FB63036F1F6A47A0CF08FE`
- `packages/contracts/src/ownership-semantic-task.test.ts` — `21ACA9E5B424E2A9AEEB088C7E98EC351D5F61477356C194BAF195D8062C564F`
- `packages/contracts/src/index.ts` — `468826BB544391E0092608E64089FD11F7CB4303A5367D3F00EC5A4FF2E0D629`

## 限制与规则评估

Schema 成功只说明字段、字面版本和边界合法，不证明值由可信 main 捕获，不验证用户动作、hash 与实际 question/attempt/rubric/body 的内容关系、授权/currentness/签名，也不登记或启动任务。不同但格式合法的 hash/context 组合可通过，后续可信层必须独立核验。旧 feature schema 和所有现有 2D-L1、2C-L、M3 文件均保持冻结。

本轮没有已确认且未被现有规则覆盖的通用工程经验；不更新 `AGENTS.md`。本批交由协调方独立审查，之后再交付未来 SQL/共享调度工作；四批结束后按暂停门停止派发。
