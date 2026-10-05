# 第二批：所有权语义 Responses 正文离线构造

2026-10-05。仅在主 checkout 按批准计划实现原四批第二批；不启动第五批。开工 HEAD 为 `502820ad4e040eb4b1effa9845c2c2fe46e1274b`。保留协调方已有文档差异与计划，不执行 Git 写入。

## 目标与边界

在现有 `ownership-semantic-prompt` 真实构造器和原本地严格响应校验器之上，新增离线、确定性的完整 Responses JSON 正文准备。只新增 `packages/llm/src/ownership-semantic-responses.ts`、对应测试及本记录，并在 `packages/llm/src/index.ts` 追加一个 export。prompt、contracts、所有权、graph、application、desktop、UI、native、依赖、锁文件及 AGENTS 保持冻结；无 HTTP、fetch、provider、凭据、SQL、IPC 或用户项目执行。

## 实现与验证反馈

新入口在首个 await 前捕获精确 plain-data 输入、模型与输出预算，并立即调用实际 prompt 构造器；其私有包/答案捕获仍由该构造器完成。仅从其固定 schema 明确投影受选定的结构化输出子集，任何未处理结构都会失败关闭；原 prompt 和本地 contracts 响应验证未改。正文包含固定说明、完整协议数据、模型、预算、`store=false`、`stream=false` 和严格 JSON schema。先对最终 canonical JSON 正文计算 UTF-8 大小，再计算完整正文 SHA256；返回原 prepared 对象的精确引用，不复制或重建它。

首次 `pnpm --filter @project-xray/llm typecheck` 发现三个新测试的 TypeScript 问题：schema 可选访问未收窄，以及只读 fixture 被直接改写。均为测试代码缺陷，调整访问和可变 fixture 类型后检查通过。

第一轮新增定向测试为 8/9 通过。唯一失败是“拒绝输入不触发摘要”测试：两份非法嵌套 fixture 在 `crypto.subtle.digest` spy 启用后才构造，fixture 的合法包摘要计入调用次数（共 12 次）。根因确认是测试监视器安装顺序，不是被测入口副作用；将 fixture 构造移到 spy 之前后，新增定向测试 9/9 通过。审查计划门槛时又补充了另一套真实合法 rubric 的跨标准响应拒绝用例；最终整组回归重新包含该用例。

超限边界用真实 prompt 构造器接受的包验证：24 个含 512 个反斜杠的证据片段，原片段总量为 12 KiB；内层协议 JSON 可接受，但将其作为 `input_text` 再编码进完整正文后超过 65536 字节。Responses 构造器返回固定超限错误，原包和答案不变。测试同时覆盖四题型、完整 schema 投影、模型/预算参与摘要、首个摘要 await 期间修改调用者输入、恶意对象零 getter/trap、exact prepared 引用、本地拒绝未知/重复证据、跨包/跨标准响应和拆分代理对的答案范围。

检查时一次 PowerShell 文件 glob 被解释为无效路径并退出 123；改用 `rg --files` 后完成同一只读检查。此为命令行用法问题，与产品和测试无关。

## 最终验证

- `pnpm --filter @project-xray/llm typecheck`：通过，exit 0。
- `pnpm --filter @project-xray/llm exec vitest run src/ownership-semantic-responses.test.ts src/ownership-semantic-prompt.test.ts src/openai-responses.test.ts`：3 个文件、60/60 项通过，exit 0。
- `pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantics.test.ts src/ownership-semantic-task.test.ts src/ownership-semantic-policy.test.ts src/ownership-question-binding.test.ts src/ownership-capsule.test.ts`：5 个文件、114/114 项通过，exit 0。
- `git diff --check -- packages/llm/src/index.ts`：通过；当前 HEAD 仍为开工提交。未执行提交、推送、合并或其他 Git 写入。

| 文件（仓库相对路径） | 最终 SHA256 |
| --- | --- |
| `packages/llm/src/ownership-semantic-responses.ts` | `DBEA69E0C3CF944075C1C513E29543001E9003916B2ECD0A6F816A842DCAEA13` |
| `packages/llm/src/ownership-semantic-responses.test.ts` | `745EE5E3D898DF5EDC34719099D58AB776087DD7AFFC8A1E934CBF36D0759474` |
| `packages/llm/src/index.ts` | `DCC5571D3C1F8D06EDFCD9268F0E621A87E8AAC75C51A84B6E000D53C31CB02C` |

## 未验证项与规则评估

这只是离线正文准备模块。真实服务 schema 兼容、模型输出质量、实际发送与账户/密钥、正文摘要和快照当前性的整链绑定、durable reserve/dispatch、持久化与桌面交互均未验；本轮不据此宣称端到端语义评价可用。没有运行 Electron/GUI、构建/native/dist、网络或导入项目代码。

本轮未修改 AGENTS，因本批明确冻结该文件。候选工程经验供协调方评估：远程请求预算和身份摘要应针对最终 canonical wire body 的 UTF-8 字节计算，在加入模型、schema、指令以及对内层 JSON 的再次转义后校验；用“内层包合法、外层完整正文超限”的反斜杠边界回归证明拒绝行为。该动作由本轮实现和真实构造器边界测试支持，适用于其他远程请求适配器；现有规则尚未明确覆盖这一点。
