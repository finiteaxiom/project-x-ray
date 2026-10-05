# 2D-L4 实际语义 Responses 正文：独立验收

2026-10-05，root，仅原第二批纯正文模块。本轮main基线502820ad4e040eb4b1effa9845c2c2fe46e1274b。Luna交付后明确冻结；Sol另在5170实施六个不重叠graph/application文件的S3-B，本轮不读测其活动源。

## 独立源码与实际差异

root核两新增LLM文件、index仅追加单export、自有开发记录；实际hash与交付相同：source DBEA69E0C3CF944075C1C513E29543001E9003916B2ECD0A6F816A842DCAEA13，test745EE5E3D898DF5EDC34719099D58AB776087DD7AFFC8A1E934CBF36D0759474，indexDCC5571D3C1F8D06EDFCD9268F0E621A87E8AAC75C51A84B6E000D53C31CB02C。旧prompt/contracts/ownership/graph/application/desktop/UI/native/依赖及锁均无本切片改动，Git真实差异单独核对。

入口精确plain-data键/描述符验证，拒proxy/getter/隐藏/符号/额外字段；同步捕获model/token并在首await前调用真实adapter，由其完整捕获包与答案。固定schema逐结构明确投影，oneOf→互斥verdict anyOf、const→enum；原schema和本地严格validator不改。未知原schema结构失败关闭，不能caller注入schema。canonical正文完整包含实际instructions、协议/包/答案、model/budget、store=false/stream=false/text.format；65536预算按最终UTF8计算，摘要为全body SHA256。返回真实prepared引用，private WeakMap本地校验仍拒clone、跨包/标准/证据及非法答案范围。该引用及digest均不授予当前性、SQL占用或发送许可。

官方格式依据已在实施计划核对：[Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。离线形状不证明账户模型支持或实际服务接受；store=false不声明零服务端保留。

## root 实际命令和结果

```powershell
pnpm --filter @project-xray/llm exec vitest run src/ownership-semantic-responses.test.ts src/ownership-semantic-prompt.test.ts src/openai-responses.test.ts
pnpm --filter @project-xray/llm typecheck
pnpm --filter @project-xray/contracts exec vitest run src/ownership-semantics.test.ts src/ownership-semantic-task.test.ts src/ownership-semantic-policy.test.ts src/ownership-question-binding.test.ts src/ownership-capsule.test.ts
pnpm --filter @project-xray/ownership exec vitest run src/semantic-rubric.test.ts
./node_modules/.bin/tsx.CMD .benchmarks/l4-independent/probe.ts
git diff --check
```

root分别60/60、114/114、27/27，合计201项通过，LLM noEmit及各命令exit0。覆盖四题型、全body变更摘要、首真实摘要等待后输入替换、恶意对象零trap/getter/hash、精确prepared与原validator负例、内层合法而再次JSON转义后外层超过64KiB拒绝。原生产文件/正确断言未改；Luna先前测试夹具spy顺序失败及类型错误准确保留其自有记录，不改写成产品失败。

额外root自有探针真实创建TS样例→index→可信call-direction问题/引用→实际grade→SQL材料读取→新public builder→exact prepared本地不足响应校验，两布局legacy=false/true均exit0，body各8466UTF8字节、全body摘要匹配；克隆prepared固定NOT_PREPARED拒绝。原package/attempt/source字节语义不变，确定性grade.passed保持；授权始终denied、task/registry/lease全0、零HTTP/OS凭据/用户授权操作。读材料仍prepare-only/not-checked，没有借此宣称Q2与body整链认证。自有探针材料保留、句柄通过app.close释放，无递归删除。

独立审查中只读错误路径packages/llm/vitest.config.ts不存在；是查找命令问题，不影响测试，实际测试按包入口执行。没有产品缺陷或修改需求；无需重跑已通过回归或重型构建。

## 接受与剩余门

接受2D-L4纯离线实现及上述独立源码/回归。已实现=真实完整Responses正文/摘要/预算/原prepared；独立代码与回归已验证=本记录；真实GUI已验证=0。实际服务兼容/质量、账户/密钥、当前性绑定全body、semantic task/transport/跨库发布/统一停止恢复、GUI仍未验，不能标端到端可用。无API/fetch/provider调用、秘密扫描、重型/native/dist/Electron或导入项目代码执行。

root评估Luna候选规则，AGENTS原规则未明确最终wire正文预算，现有通用证据/身份捕获规则不能替代此边界；新增一条“最终UTF8正文预算与摘要”具体验证动作并链接本记录，其他经验0。与S3-B缺陷及计划无源文件冲突；其修正未交付，不能夹带未验实现Git。已验范围的实际提交/远端SHA按收尾回执另记。
