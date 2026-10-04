# 第二批纯语义请求适配独立验收（2C-L）

2026-10-05；root；main 起点 `50d7609f87e253d32b52bba53e61e87045dba8ce`。

## 结论与范围

接受 Luna 冻结的纯请求/响应适配器及公开导出、开发记录。源码与计划、现有 ownership-semantics validator、真实本地胶囊材料一致；没有修改确定性分数、passed、掌握度、授权、任务、存储或 confidence。完整系统指令、数据、schema 的序列化 UTF-8 总预算为 65536 字节，超限固定失败，答案、rubric 与完整所选路径不裁剪。

已实现：纯 adapter。独立代码/回归已验证：本记录所列检查。真实 GUI 已验证：0。SQL 当前性、项目独立授权、provider 接线、模型兼容/语义质量、生产发送/取消/结果持久化与所有权端到端流程仍未验；不能将 prepared/hash/历史 capsule 的 `prepare-only` 当作这些授权或来源证明。只有四批内仍可推进任务继续；四批本地收尾或全剩外部依赖后暂停讨论，不启动第五批。

## 源码与真实差异

核实际 main Git 只有本批三个 llm 源码和自有开发记录、原协调记录回执，未纳入 Sol 未验接线/缓存/loan/桥接或二进制。index 只追加导出，无依赖变更。首次 await 前以 descriptor 捕获全部 plain JSON，Node proxy 检查先于反射操作，访问器/toJSON/非枚举/符号/循环/稀疏及额外数组属性拒绝；后续只用私有捕获。WeakMap 绑定精确 prepared 身份，公开请求、schema 和返回 DTO 冻结。响应仅委托原 validator，固定错误不回显材料；JSON schema 的跨字段/范围/引用关联由 validator 执行，不声称 schema 能自行证明语义真伪。导入无网络/计时器副作用。

前后源码 SHA256 与开发冻结交付一致：

- ownership-semantic-prompt.ts：`E8A0C95788FA4332BBC61A87DD97A960B3E0166E5EE7D20011C911F0E92768C1`
- ownership-semantic-prompt.test.ts：`DDFE1AEF6AFE88DC1A74B43C8F77D75E4BA1B23B810E86150E2B78B8E5F2D6A7`
- index.ts：`9BC8EA3C7E5B1431B6BAD71B133C6C683A7FBC635BC9489315A49AD9AFEB490E`

## 本轮独立验证

- `pnpm --filter @project-xray/llm test`：4 文件、90 项通过（包含新 adapter 14 项与全部旧 llm 测试）。
- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantics.test.ts`：61 项通过。
- `pnpm --filter @project-xray/llm typecheck`：exit 0。
- `pnpm exec tsx .benchmarks/ownership-prompt-review-a98aaf662c3a483191ca94dac9ae3b7c/probe.ts`：exit 0，16 次真实材料接入通过。该自有 probe 的原材料保留，无递归清理。

probe 以唯一自有样例目录/库，真实应用索引 TS 源码但不执行它，生成并提交四类题；project/legacy × 空/非空排除配置 × entry/call-direction/call-path/variable-flow 各一次。真实 SQL 保存并以 GraphStore 重开 ready capsule，保持 `questionBinding: prepare-only`；从其精确引用、原源码范围及实际分析节点/边形成协议测试材料，重算 package ID 后送 adapter。检查 rubric/完整路径不变、Buffer UTF-8 实测预算、原合法引用/限制响应接纳、代理对半 UTF-16 范围及复制 prepared 拒绝。每次适配前后 attempt/capsule 行一致，整轮 snapshots/source_snapshots 行一致。固定 insufficient DTO 只验证协议闭包，不是实际模型评价。没有配置授权、凭据或发起网络。

root probe 首轮 `deepStrictEqual` 将 null-prototype 私有捕获 DTO 与普通对象作原型等同而失败；这是 harness 期待缺陷，未改产品。改为显式验证 null prototype/冻结及 JSON 完整内容后，原 16 次接入全部通过。既有开发反馈闭环中的 schema 收紧及测试类型修正已核，未发现本轮需要继续修正的产品缺陷。

## 规则与交付

本轮公共 AGENTS 新增 0：现有首次 await 前完整私有捕获及 strict DTO 投影规则已覆盖，测试数/样例收益/准备状态不写为工程规则。原 Luna 收到独立接受回执，保持四文件冻结、不 Git、不为填槽扩展任务。原 Sol M4 仍活动，不测试其活动源码。只对本批已验纯实现与准确协调文档执行 Git 收尾；实际 SHA 另记，不把计划动作写成成功。
