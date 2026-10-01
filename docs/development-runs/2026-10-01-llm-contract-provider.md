# 1C-1：远程解释契约、证据包与协议适配器

日期：2026-10-01。状态：定向验证完成，冻结待独立审查；不是第一批端到端完成。

## 授权与基线

实际独立worktree目录已核对，分支 `codex/llm-explanations`，HEAD `fde7b95184fc3425b95a75c1f730d13084cc762c`，开始时干净。已重读当前AGENTS、四批长期计划及已接受ADR-0007；协调方后续main的样例提交不作为本批基线，未跨checkout读取或复制样例。样例都在本批test文件构造。

只新增独立contracts文件、llm包及本记录；contracts/index仅一行重导出，lock仅新llm内部workspace importer。不改application/graph/desktop/ui/原生/其他package/现有XRayApi或IPC方法，不执行Git写操作，不给其他聊天发消息。没有APIkey，不读环境/凭据/Codex登录信息，不发送项目内容或进行真实服务请求。

## 实现与冻结契约

- 独立证据/解释/policy/task协议版本均为1.0.0。strict Zod字段、数量、Unicode/UTF-8、范围、ID、hash、model/key上限；独立JSON Schema声明全部required、additionalProperties:false、有界pattern/数组。key1–2048 UTF-8字节，只作为未来desktop port的临时输入，当前没有OS存储实现。
- `buildEvidencePackage`只接收调用方提供的有界不可变图查询及明确同步source port；无FS/SQL。显式投影analysisIdentity、节点、关系、proof及来源；从port读已保存源码，核对project/snapshot/path/manifest SHA-256，先校验路径/范围再调用port。当前要求具备analysisResult指纹，旧无该字段的快照失败关闭，未来集成应提示重新索引。
- 候选工作上限80节点/160边/320 proof/80项manifest；本地unknown/limitations/failures各最多1200项；单source port正文最多1 MiB。出站按24节点/40边/24 proof、4096字节/40行片段与24 KiB源码总预算选择，闭合节点/边/proof引用。完整proof范围超限时明确省略或不足失败，不把截断源码冒充完整proof；UTF-16行列与已有TS/Python契约一致，拒绝拆开surrogate pair。多行snippet按行文本统一LF，保留原文件正文hash及精确范围。
- 包内容SHA-256稳定，集合排序与时间无关；包含analysisResult、health/unknown/truncation。CALLS原始置信度不被模型改变；验证拒绝比supporting proof更强的edge；ordered path要求完整、连接、无重复且edge/proof均verified，截断不拼接路径。
- `validateRemoteNarrative`整包拒绝错项目/快照/包、包外/重复/缺引用、verified叙述或额外字段。任何unknown proof/edge引用要求unknown claim，模型不产新图事实。有合法引用不证明模型自然语言为真。包内限制及本地完整限制单独保留，模型unknowns不能抹除它们。
- `OpenAIResponsesProvider`固定官方HTTPS、POST、redirect:error、store:false、stream:false、strict text.format；单请求无自动重试。检查完整body含schema/嵌套转义的64 KiB预算、output token≤2048、response body256 KiB/output_text64 KiB、绝对60秒network deadline及可注入task剩余deadline。header/read/parse/schema同deadline，同步parse前后check；跨进程watchdog留1C-2。非2xx不读取body；refusal/incomplete/tool item/多文本/无效JSON/UTF-8/引用整体固定错误，丢弃provider reasoning，不保存响应原文/异常文本。
- 可注入窄transport与monotonic clock进行协议测试；production入口只导出真实provider/纯函数/接口，没有fixture/mock factory/endpoint或环境开关。默认transport使用平台fetch；本轮每个协议测试显式注入本地Response，零真实网络请求。并发槽是本进程模块内1个逻辑请求；全应用跨worker/broker限额及取消后服务端计算边界留1C-2，不把此单元限额当全应用完成。

依赖：平台fetch/AbortController/crypto/TextEncoder、现有contracts/Zod满足本切片，无新HTTP/SDK/runtime第三方包。llm仅新增 `@project-xray/contracts:workspace:*`。实际执行：

```text
pnpm install --filter @project-xray/llm --ignore-scripts --lockfile-only --offline
pnpm install --filter @project-xray/llm --ignore-scripts --offline --frozen-lockfile
```

均成功，关闭生命周期，未下载新依赖或触发native；lock差异仅新importer的6行。

## 实现 → 失败诊断 → 修正 → 复验

1. 初次llm tsc失败：返回payload的version被对象字面量拓宽为string（TS2322）；修正为明确literal类型。随后一次清理response body的赋值位置错误造成TS2448/2454；移到response声明之后。这是实现类型/声明错误，没有降低strict配置。
2. 首轮llm Vitest为56通过/1失败，contracts新增17通过。失败fixture把proof改unknown却保留verified edge/path；verify拒绝该不一致输入。修正fixture同时改变实际edge置信度，保留“身份随置信度变化”断言；新增明确拒绝更强edge的回归，并使path选择同时核对proof的verified。分类：fixture语义不一致，同时完善产品置信度/路径门禁；不是模型服务故障。
3. 同轮llm tsc发现Vitest `it.each`引用数组被当参数元组展开，原case并未传入意图的整个数组。改为对象表项，保留空/不存在/混合/重复引用整包失败断言；后续类型与运行回归通过。分类：测试缺陷。
4. 增加总源码、proof数量、Unicode范围、source-port前路径校验、invalid UTF-8、deadline和完整本地unknown保留用例。source port之前的path/span校验在实现中明确前移；错误decoder固定为INVALID_RESPONSE。64项llm测试与tsc通过。
5. 字节预算复核确认嵌套转义问题：初稿只量证据包canonical JSON，没有量它嵌入Responses input_text后的第二层JSON转义。新增实际转义预算回归，临时将两个预算谓词回放为旧算法（finally按原始字节恢复源码），运行 `pnpm --filter @project-xray/llm exec vitest run src/evidence-package.test.ts -t 'second JSON escaping'`：测试exit1，实际60136 > 预留49152字节。包装PowerShell命令本身exit0，不把它当回归通过；其余25项是该定向过滤跳过，不是权限跳过。确认是实现预算缺陷。
6. 修正为量 `JSON.stringify(canonicalJson(package))` 的UTF-8字节，裁剪时预留16 KiB给固定prompt/schema/model。provider仍独立核验最终HTTP body，超限零transport。新增full-body测试曾因漏import canonicalJson报ReferenceError/TS2304，补回测试import，断言未改。最终全部复验通过，没有盲改快照、降低assertion/超时或测试门槛。

## 最终实际命令与结果

```text
pnpm --filter @project-xray/llm exec vitest run src/evidence-package.test.ts src/output-validation.test.ts src/openai-responses.test.ts --maxWorkers=1 --no-file-parallelism
```

3文件，66 passed，exit0。

```text
pnpm --filter @project-xray/contracts exec vitest run src/index.test.ts src/ignore-settings.test.ts src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism
```

3文件，30 passed，exit0（包含13项既有contracts回归、17项新增）。合计96项定向测试，非全仓验证。

```text
pnpm exec tsc -p packages/llm/tsconfig.json --noEmit
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
```

两包均exit0。只运行这两个包的轻量检查；没有native/fullTurbo/build/dist/Electron。最终范围/空白检查在交付前完成，不以historical验收替代本轮。

## 完整文件清单

- 修改 `packages/contracts/src/index.ts`（仅重导出）、`pnpm-lock.yaml`（仅llm importer）。
- 新增 `packages/contracts/src/remote-explanation.ts`、`remote-explanation.test.ts`。
- 新增 `packages/llm/package.json`、`tsconfig.json`。
- 新增 `packages/llm/src/index.ts`、`evidence-package.ts`、`evidence-package.test.ts`、`output-validation.ts`、`output-validation.test.ts`、`openai-responses.ts`、`openai-responses.test.ts`。
- 新增本记录。

## 未验收与规则判断

本切片仅纯契约/证据处理/单请求协议。application取证与真实数据port、授权/撤销/context线性化、current/配置/provider版本事务、追加持久化、worker生命周期、全应用并发、Windows OS凭据、IPC/sender、生产未配置UI、真实Electron导航及真实OpenAI兼容/质量均未接入或未验收。此provider方法本身不持有授权数据库；1C-2必须在权威事务门禁内调用，不能直接当生产UI能力开放。没有key，真实服务仍为外部阻碍，不会索取、扫描或替用户配置。

本轮无新增AGENTS规则。第二层转义有可复现证据，但预防动作已包含于已接受ADR的“完整出站body预算”，并已固化回归；既有证据置信度及失败关闭规则覆盖其余检查，不将本批调试明细重复写入公共规则。

交付范围核对：实际2个修改文件、12个新增文件，共14个，符合上述清单；index只有重导出1行，lock只有importer6行。`git diff --check`通过，12个新文件逐一执行 `git diff --no-index --check -- NUL <file>`，核对输出无空白诊断，仅Git LF/CRLF提示。首次包装脚本误将no-index新增文件差异的exit1视为失败；修正为接受exit0/1并拒绝其他退出码或非换行提示后，12文件检查exit0。此为检查脚本判定问题，无产品代码变更。application/graph/desktop/ui/analyzer-core/AGENTS/ADR/协调计划差异为空。生产源码无FS/SQL/环境读取或日志调用，index不导出测试文件/fixture；协议替身仅存在于test文件，production只有窄transport port可注入。业务与测试至此冻结。
