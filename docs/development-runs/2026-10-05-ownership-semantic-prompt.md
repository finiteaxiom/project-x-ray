# 所有权语义请求与响应适配记录（2C-L）

日期：2026-10-05
目标：在已接受所有权语义契约上增加 provider-neutral 纯请求封装和响应适配，不接入授权、任务、存储或真实 provider。

## 范围依据与源码核对

- 按本轮授权读取 `AGENTS.md`、四批停止门、`docs/plans/2026-10-05-ownership-semantic-prompt.md` 和 ADR-0008。任务提供的基线标识为 `6d76a16427cbbc603c4f0f1f7db14655b960cc48`；按要求未运行 Git，因此本记录不把该值描述为本轮重新核实的 HEAD。
- 实际核对 `packages/contracts/src/ownership-semantics.ts`：`validateOwnershipSemanticPackage` 使用严格 DTO schema，检查 package 总 JSON 字节、答案/hash、rubric、proof/node/edge 闭包、criterion/limitation 归属和完整 call-path；它不核对 SQL 当前性、真实源码权威或语义散文真伪。`validateOwnershipSemanticResponse` 绑定 package ID，要求 criterion 集合唯一完整，并按 criterion 核对 evidence/limitation ID 和 UTF-16 答案范围；它不计算确定性分数或提升 confidence。
- 核对 ADR-0008 与现有 LLM 适配惯例后，保持解释 purpose、授权、provider、credential、endpoint、存储和任务生命周期均在本切片之外。package ID/hash 只作 DTO 内容绑定，不声称授权、当前性或来源证明。

## 实现

- 新增 `packages/llm/src/ownership-semantic-prompt.ts`。`prepareOwnershipSemanticRequest` 在首次 `await` 前将输入封闭成有界 plain JSON 私有快照；拒绝 proxy、访问器、`toJSON`、符号键、非枚举属性、循环、稀疏数组、undefined、非有限数字和超限结构，再用既有 package validator 校验独立提交答案与 package。
- 请求是 provider-neutral 完整 JSON：固定 `systemInstructions` 与不可信 `data.semanticPackage` 分字段保存，附固定响应 JSON Schema。序列化保留答案、rubric、证据、引用及完整 selectedPath；使用 UTF-8 实测总字节，超过 `OWNERSHIP_SEMANTIC_LIMITS.requestBytes`（65536）即固定失败，不裁剪或自动重试。错误不包含 package、答案、源码、validator 原始错误或响应文本。
- prepared 返回对象及 schema 冻结；内部 `WeakMap` 以精确 prepared 对象保存私有 package/答案。`validatePreparedOwnershipSemanticResponse` 先私有捕获原始响应，再调用现有 response validator，仅返回深冻结的完整 advisory DTO；复制/伪造 prepared 对象、跨 package 响应、访问器响应均拒绝。它不接收或返回 score、passed、mastery、confidence 或 verified 图事实。
- `packages/llm/src/index.ts` 仅追加新 adapter 的常量、类型、错误和两个函数导出。
- 只改本批授权的四个文件；未修改 contracts、ADR、主队列/交接记录、M3 或其他主源码。无依赖与 lockfile 变更。

## 验证与反馈闭环

最终验证：

- `pnpm --filter @project-xray/llm exec vitest run src/ownership-semantic-prompt.test.ts`：14 passed。
- `pnpm --filter @project-xray/llm test`：4 files，90 passed，包含完整既有 LLM 回归。
- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantics.test.ts`：61 passed。
- `pnpm --filter @project-xray/llm typecheck`：exit 0。

新测试使用契约哈希函数构造 entry、call-direction、call-path、variable-flow 四类本地样例；覆盖完整路径及引用保留、supported/contradicted/insufficient 三种 verdict、跨 criterion 引用/限制、额外评分字段、坏答案/package/hash、注入答案与源码注释作为 data、Unicode、精确 65536 字节成功与多 1 字节拒绝、首次 hash 等待期间修改调用者输入/响应、prepared 伪造或重用、getter/`toJSON`/proxy/符号/循环/undefined/缺字段以及导入时无 provider/timer 调用。测试只验证请求形状与本地 validator，不证明模型语义质量或掌握。

反馈及失败分类：

1. 第一轮新 adapter 测试 13 项通过；随后 typecheck 报测试错误变量为 `Error | DTO` union 时未收窄便读取 `.message`。这是测试类型缺陷；改为显式 `Error` 窄化后 typecheck 通过。
2. 对照 contract schema 的人工复核发现，首版响应 JSON Schema 对 supported/contradicted 的 `limitationIds` 只要求最小值为 0，却没有禁止非空数组；既有 validator 会拒绝此类输出，但给 provider 的 schema 仍过宽。将两种 verdict 的 `maxItems` 设为 0、保留 insufficient 的 1–8，并新增 schema 回归。
3. 添加该 schema 回归时，测试的嵌套 TypeScript 类型注解括号不匹配，导致 Vitest transform 在执行用例前报 parse error。修正测试类型注解后，定向 14 项、LLM 90 项、contracts 61 项及 typecheck 全部通过。此为测试源码缺陷，不是产品运行失败。

## 限制与规则判断

- 纯 adapter 不验证授权、SQL currentness、活动 snapshot、API credential、provider 兼容性或模型输出质量；本轮没有网络/API/数据库/文件访问，也没有真实模型响应。JSON Schema 无法单独表达 criterion 与 package 的跨字段引用、答案范围边界及 UTF-8 字节预算；既有 contract validator 是最终拒绝门。
- 未修改 `AGENTS.md`。已有“公开异步摘要验证器首次 await 前捕获调用者输入、拒绝访问器与静默遗漏字段”的工程经验已覆盖本切片采用的捕获动作；本轮 schema/contract 对齐通过新回归固定，无需再重复公共规则。公共差异仍由 root 独立审查。
- 未运行 build、native、Electron、GUI 或 Git；本交付只表示本地纯语义请求/响应适配代码通过所列检查，不表示授权、发送、持久化、模型语义反馈或 ownership 流程已端到端验收。

## 交付文件 SHA-256

- `packages/llm/src/ownership-semantic-prompt.ts` — `E8A0C95788FA4332BBC61A87DD97A960B3E0166E5EE7D20011C911F0E92768C1`
- `packages/llm/src/ownership-semantic-prompt.test.ts` — `DDFE1AEF6AFE88DC1A74B43C8F77D75E4BA1B23B810E86150E2B78B8E5F2D6A7`
- `packages/llm/src/index.ts` — `9BC8EA3C7E5B1431B6BAD71B133C6C683A7FBC635BC9489315A49AD9AFEB490E`
- 本记录：`docs/development-runs/2026-10-05-ownership-semantic-prompt.md`
