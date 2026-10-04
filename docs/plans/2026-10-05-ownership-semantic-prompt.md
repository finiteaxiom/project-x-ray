# 第二批：纯所有权语义请求与响应适配

2026-10-05；root。实际依据：已接受ADR0008、主checkout已集成ownership-semantics/capsule契约与本地保存；packages/llm/src/index.ts仅有feature解释证据/响应/OpenAI适配，没有所有权语义请求或响应适配。不能把feature claims当评分。此为原四批第二批必要实现，不是第五批或真实模型质量证明。

## 目标与边界

原Luna/main仅新增packages/llm/src/ownership-semantic-prompt.ts及对应test，index.ts仅追加导出，新docs/development-runs/2026-10-05-ownership-semantic-prompt.md。不改contracts/ownership/graph/application/desktop/UI/package/lock或Sol文件。现有依赖足够，无网络/FS/SQL/凭据/任务、权限修改、build/native/Electron、Git收尾；不生成新胶囊/复原旧题或授予来源权威。

实现provider中立的纯请求封装：输入既有OwnershipSemanticPackage与独立已提交答案，调用当前validateOwnershipSemanticPackage核身份/摘要/引用/rubric/答案，不从任意字段补造标准。完整包作为不可信JSON数据，与固定系统指令分离；答案、源码、注释不能成为工具/权限指令。固定系统约束只有逐criterion supported/contradicted/insufficient及证据/限制ID/答案范围，不得改权重、passed、mastery、图事实或调用工具。

返回有限且可审阅的完整序列化请求、固定响应schema和准确UTF-8字节数；总请求（含系统指令/数据/schema）≤65536字节。原答案/rubric/完整所选路径不可裁剪，超预算固定失败，不自动重试；包哈希不等于授权或来源证明。不得使用feature授权、暗含API调用或选择模型/费用。

响应适配调用既有validateOwnershipSemanticResponse，只返回完整辅助DTO，不计算或改写确定性评分。包/答案绑定必须来自本次实际准备的私有捕获；拒绝伪造prepare对象、跨包响应和未准备调用。首次await前捕获全部相关调用者数据：只接纳有界plain JSON，拒绝访问器/循环/符号及会静默遗漏的字段，不执行toJSON；后续只使用捕获，调用者改包或公开返回对象不能改变真实输入/验证上下文。固定错误不回显答案/源码。包合法也不代表允许外发，生产接线仍待独立授权与任务通道。

## 完成门

原四题型真实本地构造材料优先复用既有纯测试样例，不跑导入项目；检查题型/路径配对/精确引用与有限DTO。含正确请求、错摘要/答案/包身份、跨criterion引用、恶意额外评分字段、三种verdict、错/不足限制ID、注入答案及注释、Unicode与总请求边界、答案/路径不裁剪、首次摘要等待时输入/返回对象修改、getter/toJSON零执行、导入无副作用。测试只证明协议，不用固定响应当模型质量或掌握证明。

交付本批最小回归、llm类型及原适用llm/contracts语义回归，记录实际失败/根因/修正/命令/限制，规则去重允许0；冻结差异与hash后root独立审查。接口选择可按当前包惯例确定，但不得放宽已有契约以让用例通过。
