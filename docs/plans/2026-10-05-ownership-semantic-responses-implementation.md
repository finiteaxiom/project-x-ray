# 第二批：实际 Responses 正文的离线构造

2026-10-05，协调方。只推进原四批中的所有权语义评价，不启动第五批。Q2 后台已独立接受并精确提交推送 `502820ad4e040eb4b1effa9845c2c2fe46e1274b`；GUI、真实模型兼容/质量及整链发送仍未验。

## 目标、依据和依赖

实际 `packages/llm/src/ownership-semantic-prompt.ts` 只构造 provider-neutral 的 protocolVersion/systemInstructions/data/responseSchema；`packages/graph/src/ownership-semantic-preparation-store.ts` 只绑定 adapterRequestDigest，明确不是 HTTP bodyDigest。现有 `packages/llm/src/openai-responses.ts` 已有功能解释的完整正文构造，但不能把它的 explanation 输出协议复用于 ownership。共享任务设计要求未来去重和传输核对完整 HTTP bodyDigest，因此这一纯模块是第二批必要实现，不是重复准备文档。

现有语义 schema 使用 oneOf/const、字符串长度和 uniqueItems 等通用 JSON Schema 关键字。不能把通用 schema 原封不动当作已证明的提供商子集。当前真实 adapter 的私有 WeakMap 将 response 验证绑定到原 prepared 对象，克隆或重造对象会丢失该保证。本切片保持原 adapter/严格 contracts validator 完整，并返回实际 prepared 引用；不改 Q2 或宣称它已持有完整传输请求。

官方格式依据（本轮已打开正文）：[Responses 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) 与 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。正文使用 text.format 的 json_schema/strict，所有对象字段 required 且 additionalProperties=false；使用明确文档支持的嵌套 anyOf/enum 等子集。store=false 关闭响应状态存储，不宣称消除所有服务端数据保留。无账户/密钥，本轮只能验证离线形状和本地严格拒绝，真实服务兼容仍未验。

## 实现与文件边界

原“开发” Luna / Max，仅主 checkout，基线先核实际 HEAD、Git 和规则。root 负责队列及公共交接，Sol Q2 冻结；不同时写同批文件。

- 新增 `packages/llm/src/ownership-semantic-responses.ts` 和对应 `.test.ts`。
- `packages/llm/src/index.ts` 只追加本模块明确 export，不改已有 export。
- 自有过程记录 `docs/development-runs/2026-10-05-ownership-semantic-responses.md`。
- 现有 ownership-semantic-prompt、openai-responses、contracts、ownership、graph、application、desktop、UI、native、包/锁及 AGENTS 均冻结。无第三方依赖。

提供实际异步纯构造入口，输入只接受 semanticPackage、submittedAnswer、model、可选 maxOutputTokens。在首次 await 前验证顶层 plain 数据属性/精确键，拒绝代理、访问器、符号、隐藏或多余字段；同步捕获模型/预算，并立即调用固定真实 prepareOwnershipSemanticRequest（其自身在首次 await 前完整捕获包与答案）。不接受 caller prepared、字符串正文、摘要、schema、endpoint、credential、回调或 provider。拒绝输入不执行 getter/then/代理 trap，不暴露错误中的原源码。

使用现有 remoteModelSchema 和 provider 输出上限，不改变配置模型，不推测密钥/模型可用性。构造 canonical JSON 全量正文：model、实际固定 system instructions、唯一 user/input_text（完整私有包数据及协议标识）、store=false、stream=false、max_output_tokens、固定 text.format（json_schema、版本化固定 name、strict=true、固定 schema）。不加入 tools、previous_response_id、conversation、background、可配置 retention 或其他数据。包/答案完整，不截断。

提供商 schema 只能由固定原 schema 明确投影：oneOf→anyOf（verdict 分支值互斥），const 字符串→type:string/enum 单值；保留对象 required/additionalProperties、类型/属性/items、pattern、计数和数值范围等明确选定子集。字符串 minLength/maxLength 与 uniqueItems 不作为未证实的 wire keyword；它们继续由原本地严格 validator 强制。投影只作用于固定内部 schema，不接受任意 caller schema，不修改通用 schema 或弱化 contracts 验证。遇到原 schema 新增未处理关键字须拒绝或显式修订映射，不能递归静默过滤未知规则。无需导出通用 schema 转换框架。

完整 body 按 UTF-8 计算 bytes，与所有转义、固定说明、模型、输出预算及 schema 一起受现有 65536 上限约束；超限固定错误、零截断。bodyDigest 为全部实际正文 UTF-8 的 SHA256，不使用 packageId 或 adapterRequestDigest 冒充。返回冻结的 body/bodyDigest/requestBytes 及真实 prepared 引用；保持原 validatePreparedOwnershipSemanticResponse 可用，不能复制 prepared 后调用它或绕过它。此返回值不代表来源认证、项目授权、当前性、SQL 占用或发送许可。

## 完成门槛与最小回归

1. 四题型合法包调用实际 builder，完整正文深解析核固定字段/私有数据及官方子集；同材料/模型/预算确定性、实际 UTF-8 摘要一致；模型或输出预算变化改变完整摘要。
2. 控制真实 adapter 首摘要 await，在其等待时替换 caller 包、答案、模型、预算；原捕获不能受后改影响。非法顶层、访问器、代理、隐藏/符号键、坏模型/预算零副作用拒绝。
3. 原包匹配响应使用返回的 exact prepared 对象通过原真实 validator；未知/重复证据、跨包/跨标准、非法 UTF-16 范围或 verdict 缺字段仍拒绝，wire 投影不解除本地约束；普通克隆 prepared 不可通过认证。
4. 真实包及说明含中文、emoji、引号/反斜杠，检查 JSON 转义后的完整 UTF-8 bytes；构造“adapter 可接受、完整 HTTP 正文超限”的实测边界并拒绝，原包/提交字节不变。不用替身 adapter 或盲改 golden 来满足预算。
5. 执行新增定向、已有 llm/ownership-semantic-prompt/openai-responses 适用回归和 llm noEmit，按源码风险补 contracts 语义/ownership rubric 回归；不用与实现镜像的堆叠测试。反馈闭环区分产品/测试/环境问题，合格规则可报告 0。

开发方明确冻结源码/hash、准确原命令/结果及未验门后交付，root 独立源码/回归再决定接受和 Git。不得自行 Git。无 HTTP/fetch/transport/真实 provider、OS 凭据、用户项目外发或隐私控件、SQL/task/slot/result 写入、评分改变、IPC/UI、重型 build/native/dist/Electron 或导入代码执行。真实模型兼容/质量、当前性+完整 body 结合、durable reserve/同步 dispatch、跨库发布与全参与者恢复另属原四批后续门，当前均未验；不能把本纯模块标为可用的端到端语义评价。
