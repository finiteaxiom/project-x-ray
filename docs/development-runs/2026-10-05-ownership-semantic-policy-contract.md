# 所有权语义独立策略契约记录（2D-L1）

日期：2026-10-05
目标：新增严格的所有权语义授权 DTO、grant/revoke 命令和 prepare/start 入口契约；仅定义形状与状态关联，不执行授权或任务。

## 基线与范围

- 阅读当前 `AGENTS.md`、本批批准计划、ADR-0008，以及 `remote-explanation.ts`、`ownership-semantics.ts` 的实际 schema/validator。
- 只读 Git 检查得到 HEAD `999ff4e3bb1c166c8f959ace03b56f5a1db67036`。状态同时显示已有协调文档改动及本批批准计划未跟踪；均未改动。此后未做 Git 写操作。
- 计划指定的两个新源码文件和本记录在实施前均不存在。`contracts/index.ts` 原有内容保留，仅追加一行导出。
- 仅修改 `packages/contracts/src/ownership-semantic-policy.ts`、对应测试、本记录和 `packages/contracts/src/index.ts`。未改 remote/semantic/capsule schema、graph、application、LLM、权限/UI、package/lock、AGENTS 或协调记录；未触碰 Sol 的活动文件。

## 实际契约依据与实现

- 现有 `remotePurposeSchema` 固定为 `feature-explanation`，旧授权携带解释 scope 和旧披露类别；所有权 semantic package 则固定 purpose `ownership-semantic-assessment`、disclosure `ownership-semantics/1.0.0`。旧授权不能成为答案发送许可。
- 新策略版本固定 `1.0.0`，provider 固定为当前首适配器 `openai`，purpose 复用现有所有权常量。披露类别固定为 `answer-text`、`structured-answer-and-citations`、`question-learning-objective-and-rubric`、`source-snippets`、`relative-paths-symbols-and-relationships`、`analysis-snapshot-identities-and-limitations`。
- 新授权记录为 strict DTO：使用有限 ID、revision、时间 primitive；granted 必须包含完整唯一六类、有效 `grantedAt` 且 `revokedAt=null`；初始 denied 必须没有类别且两个时间均为 null；撤销 denied 必须清空类别、保留两时间并满足 `revokedAt >= grantedAt`。Schema 不创建默认 grant，也不观察数据库或用户动作。
- grant 命令只含 repository/revision/provider-revision/purpose/disclosure/categories，并要求完整唯一六类；revoke 命令只含 repository/revision/purpose/disclosure。两者只做输入验证。
- 新 prepare request 只含 repositoryId、snapshotId、contextHandle、attemptId、固定 purpose；start request 只含 contextHandle、previewId、assessmentPackageId。严格对象拒绝调用方附加 answer、rubric、source、owner、task、endpoint、credential 等字段。taskId 由未来 trusted main 注册；现有 cancel schema 保持复用且未改。
- 这些 schema 不扩展旧 feature-purpose/category literals，不建立授权状态，不接收凭据/endpoint/正文，也不声称 schema success 即用户授权或 SQL 权威。

## 验证与反馈闭环

最终通过：

- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-policy.test.ts`：23 passed。
- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantic-policy.test.ts src/ownership-semantics.test.ts src/remote-explanation.test.ts src/remote-explanation-desktop.test.ts src/index.test.ts`：5 files，136 passed。
- `pnpm --filter @project-xray/contracts typecheck`：`tsc -p tsconfig.json --noEmit`，exit 0。

测试覆盖 granted/初始 denied/revoked 状态、缺类/重复/额外类、provider/purpose/disclosure/revision/time 边界、grant/revoke 字段限制、prepare/start 的输入最小化、错误不回显 answer value、barrel 导出和无 provider/timer 导入副作用；另验证完整旧 feature authorization/prepare/start 可继续通过旧 schema、完整语义对象仅通过新 schema，两个方向不互相转换。`source-snippets` 是计划规定的共同类别名；答案类别不进入旧类别 enum，grant 仍要求独立完整六类。

一次联合回归失败于新增测试错误假设“所有语义类别都必须被旧 category enum 拒绝”。计划明文复用共同类别 `source-snippets`，因此该断言过严；修正为验证 `answer-text` 不被旧 enum 接受，并保留完整 authorization/request 结构的双向拒绝断言。此为测试假设缺陷，不是产品失败；修正后 136 项联合回归与 typecheck 通过。

## 限制与规则判断

- Schema 只验证结构、固定 purpose/provider/category 及时间关系，不提供用户动作证明、SQL currentness、revision 冲突处理、授权读写、共享 lease、task identity/result、网络/provider 或 GUI。
- 本轮无依赖、数据库、网络、凭据、build/native/Electron/PowerShell 或 Git 写操作。
- 未修改 `AGENTS.md`。本批纯 DTO 与入口边界没有发现需扩展的通用工程规则；授权执行和跨库发布仍留给后续明确切片。

## 冻结文件 SHA-256

- `packages/contracts/src/ownership-semantic-policy.ts` — `1250DBFEF5BC3C9E35F32F3A824648FBEA45C55FA5BA7BD44F2BCE69FEEE2215`
- `packages/contracts/src/ownership-semantic-policy.test.ts` — `3C141AF2EF49D3DDD76EA41983533091FA42185BD0053563C56D8896F645E8C0`
- `packages/contracts/src/index.ts` — `E010BBFBF4D5C040D42A16E80E658AC33E25E7AD930AAC82774A86EF57E2A2F3`
- 本记录：`docs/development-runs/2026-10-05-ownership-semantic-policy-contract.md`
