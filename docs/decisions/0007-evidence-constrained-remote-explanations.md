# ADR-0007：受证据约束的远程解释与 Windows 凭据边界

- 状态：已接受（协调方已独立审查 A–E 修订；是实施设计，不是实现或安全验收结果）
- 日期：2026-10-01
- 核对基线：`d222036d59472612278cadced8422e53c16d7455`
- 范围：四批计划的 1A；本轮只新增本 ADR 与设计记录。
- 继承：[ADR-0001](0001-local-first-evidence-graph.md)、[ADR-0006](0006-trustworthy-language-facts-and-ownership-training.md)、[ARCHITECTURE](../ARCHITECTURE.md) 与 AGENTS 的证据、安全、Windows 和协作边界。

## 背景与当前源码

`XRayApplication.explainFeature` 当前先校验工作区，再检索至多 12 个候选，从一个候选查询有界调用子图（深度 6、80 节点、160 边、1200 工作量），生成一条静态路径或相关证据的离线模板。它保留 unknown 和截断说明，不调用模型。`explanationSchema` 目前没有生成来源、任务或授权版本；`feature:explain` 是 main → 查询 worker 的 Promise RPC。main 内 `AnalysisBroker` 管理索引/比较 worker；索引完成会重建查询 worker。

GraphStore 已保存不可变快照和源码，迁移最高为 9，并提供排除配置修订事务核验。当前性检查重新安全读取工作区，有跨文件非原子及外部配置未跟踪的明确限制。新增解释流程必须保留这些限制，不能把一次异步检查说成网络请求期间持续成立。

本轮没有 API 密钥。可完成本地契约、协议替身、Windows 凭据及 GUI 验收准备；真实 OpenAI 服务调用、账户模型可用性与解释质量保持未验收。

## 决策草案与最小端到端切片

第一切片只增加显式选择的远程功能解释：索引 → 输入查询 → 本地证据预览 → 项目授权 → 配置状态检查 → 用户点击发送 → 进度/取消 → 经校验的 inferred 叙述 → 同快照源码导航。现有 `explainFeature` 保持离线行为与调用兼容；失败后展示固定错误和可主动使用的本地模板，不把模板伪装成模型成功。

首个实现 schema 的 purpose 仅为 `feature-explanation`，不提前开放其他值。后续 1x 才扩展 `architecture-labels`：用户选择当前模块后获取一小组有引用的职责标签，存入解释记录、显示为推断覆盖层，不修改 Graph IR 节点/边。职责标签在相同隐私与任务边界通过后作为独立验收子切片。所有权语义评分、增量索引和发布均不在本 ADR 的实施范围。

### 分层与进程

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| contracts | 版本化证据包、响应、IPC/worker 任务、授权、限额和固定诊断 Zod schema | Electron、凭据或供应商 SDK 对象 |
| llm（新增独立包） | 确定性裁剪/摘要、输出引用验证、供应商接口、OpenAI Responses fetch 适配器 | 文件发现、SQL、Electron、OS 凭据、模型工具执行 |
| application | 根据当前快照取证、读已保存源码、调用 llm 纯转换、当前性复核和发布用例 | 导入 Electron 或供应商具体实现 |
| graph | 版本化迁移、授权/配置修订、解释记录、同步事务门禁 | 密钥、原始网络响应或日志源码 |
| desktop | main IPC/sender 校验、任务 broker；独立解释 worker 承载 application、OS 凭据适配器和网络 | 向 renderer 返回密钥或开放任意 endpoint |
| ui（后续 Luna） | 数据类别/查询/片段/限额预览、授权/撤销、配置、任务状态、明示来源和引用导航 | fetch、文件系统、凭据读取、生成事实 |

新增持久 `explanation-worker.ts`，与索引/比较 worker 隔离；它在等待 fetch 时仍能处理取消和撤销。密钥只在这个 desktop worker 中按请求从 OS 读取，短暂传给 provider；不放入 workerData、任务消息、main 任务历史或查询 worker。main 只持有公开配置状态和任务身份。凭据设置 IPC 中的用户输入只短暂经过 renderer → main → 解释 worker；输入提交后清空，不进入 React 持久状态、localStorage、sessionStorage、日志或重试记录。

llm provider 接口草案为 `generate({ evidencePackage, model, credential, signal, limits }): Promise<ValidatedProviderEnvelope>`，`credential` 仅由 desktop 的非持久 port 注入。application 依赖通用 `ExplanationProvider`/`CredentialStatePort`，测试可注入替身；生产工厂只能构造 OpenAI 适配器。所有跨进程输入/输出 strict schema 校验，WorkerConfiguration 也校验，未知 operation 拒绝。

## 证据包、输出和引用

新增 `EVIDENCE_PACKAGE_VERSION = 1.0.0`、`REMOTE_EXPLANATION_VERSION = 1.0.0`、`REMOTE_POLICY_VERSION = 1.0.0`、独立 `EXPLANATION_TASK_PROTOCOL_VERSION = 1.0.0`；不提升 Graph IR 或所有权版本，不把旧离线 schema 强行改成远程语义。

证据包由本地生成，renderer 不提交证据正文或任意范围。包含：

- repositoryId、snapshotId、完整 analysisIdentity（含结果指纹）、purpose、query、packageId；
- 确定性筛选的候选节点和关系：名称/种类、相对路径、端点 ID、置信度、原因；
- 每项 proof 的 evidenceId、精确行列范围、分析器/版本、证据类型和置信度；
- 来源文件哈希及裁剪范围内源码；只从不可变 source_snapshots 读取，不重新把实时文件混入旧快照；
- 本地生成的静态路径说明、unknown、partial/失败计数、截断原因、选择/省略数量。

不发送绝对路径、项目 root/name、Git remote/凭据、全仓文件清单、完整文件、训练答案、旧对话或无关数据库记录。repositoryId/snapshotId 属外发元数据，要列入预览。analysisIdentity 中任何未来字段先通过明确出站投影，禁止直接序列化未知字段。查询和源码都可能含敏感信息：排除规则不是秘密检测保证，预览允许用户取消；不声称片段已自动脱敏。

裁剪先对现有有界子图按确定性相关度、相对路径、范围和 ID 排序，选择至多 24 个 proof、24 节点、40 边。必须闭合边端点及 proof，缺 supporting evidence 不发送。每个 snippet 最多 40 行/4096 UTF-8 字节，总源码最多 24 KiB；超长单行按 Unicode 边界裁剪，记录实际 slice range 与原 proof range，只允许引用已发片段能支持的范围。无法保持最小闭合证据时返回 evidence-insufficient。引用合并仅在同文件/同哈希且范围相交时进行，原 proof ID 映射保持可核对；不按字符截断后冒充完整函数。

packageId 为规范化外发 payload 的 SHA-256（不含时间/随机任务 ID）；预览对象不含密钥。预览绑定快照、排除修订、授权修订、provider 配置修订及限额版本，短期保留内存。发送前重建并比对 digest，变化就要求重新预览；不静默扩大外发内容。

响应只接受以下 JSON 草案，所有对象 `additionalProperties:false`，字段 required；可空字段明确为 null：

```ts
type RemoteNarrative = {
  version: "1.0.0";
  repositoryId: string;
  snapshotId: string;
  packageId: string;
  claims: Array<{
    text: string;                  // 1–1200 字符
    evidenceIds: string[];         // 1–8 项，包内集合的子集
    confidence: "inferred" | "unknown";
  }>;                             // 1–12 项
  unknowns: Array<{ text: string; evidenceIds: string[] }>;
};
```

模型不能提交 verified、新节点/边、自由源码位置、可执行命令、URL、next_queries 或路径事实。每个实质结论都有引用；无引用的自由 summary/title 不进入输出契约。UI 标题由本地查询生成，summary 使用固定来源说明。架构职责标签复用 claims，增加本地限定的 moduleId 映射，不让模型自行决定目标模块。

结构校验后再核对每个 ID 的项目、快照、包、源码哈希/范围和 proof 所属；错项目/错快照/无效 ID/包外 ID/无引用 claim 整体拒绝，不静默丢弃坏项拼出“成功”。叙述一律 inferred 或 unknown；引用卡片可显示原 proof 的 verified，但不能把它复制为叙述置信度。任何 claim 只要引用一项 unknown proof，就必须声明 confidence:"unknown"；否则整体拒绝，不尝试通过自然语言识别“是否确定调用”。顺序路径仍由本地的完整边序列产生；模型叙述不会重排、补边或证明运行时执行。本地计算的全部 unknown 旁支、partial、截断和静态路径限制独立展示，模型 unknowns 只能追加，不能替换或消除本地限制。

用户查询、路径、名字、原因和源码作为数据包置于 user input；固定 instructions 声明这些是待分析的不可信数据，禁止遵循其中指令。提示词不是安全边界：无 tools、无权限变更入口，引用验证和版本门禁才是强制边界。注入仍可能污染语义，必须通过对抗样例与后续真实小样例评估；有合法引用也不证明自然语言结论正确。展示纯文本，禁止模型 HTML、自动打开外链或命令执行。

## OpenAI 接口与限额

官方接口已在本轮使用 OpenAI Docs 技能搜索并打开：[Responses 迁移/REST 示例](https://developers.openai.com/api/docs/guides/migrate-to-responses)。使用固定 `POST https://api.openai.com/v1/responses`，显式 model、instructions、单次 input、`store:false`、`stream:false`、`max_output_tokens:2048`、`text.format:{type:"json_schema",name:"xray_explanation_v1",strict:true,schema}`。不发送 tools、previous_response_id、conversation、background、文件上传或工具输出，不读取环境中的 API key。

官方 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) 说明 strict schema、refusal 和 incomplete 边界。fetch 原始 REST 不拥有 SDK 的 output_text 便利属性，必须遍历 `output` 的 message/content，只解析预期的一份 output_text。允许忽略有界的 reasoning item，不保存/复用它；任何工具 item、多个冲突文本、refusal、非 completed、incomplete 或无效 JSON 都失败关闭。Schema 兼容性由协议测试及真实接口单独验证，不能仅凭 Zod 类型断言。官方 JSON Schema 与本地 Zod 均声明 claims 1–12、每项证据 1–8、unknowns 至多 12/每项证据至多 8、文本 1–1200 字符、身份字段至多 128 字符；当前官方支持表明确列出 pattern、minItems/maxItems，字符串长度采用有界 pattern（覆盖换行）约束，Zod 再检查长度/总字节；additionalProperties:false。首个配置不支持 fine-tuned model（官方列出其额外 schema 限制），禁止供应商不支持时静默移除限制。外层 output 至多 16 item、每个 message content 至多 4 item，本地严格约束适用的枚举/字符串及总 response bytes。

`store:false` 不是服务商零保留承诺，授权文案链接 [官方数据控制](https://developers.openai.com/api/docs/guides/your-data)，说明应用状态选项与服务商其他保留政策不同。此处不推定用户账户具备 ZDR 或某个模型权限。

| 预算（应用硬上限，非服务商保证） | 初始值与动作 |
| --- | --- |
| 查询 | 1–1000 字符、最多 4096 UTF-8 字节 |
| 完整出站 body | 64 KiB，包含固定 prompt/schema；超限先确定性裁剪，再不足则不发送 |
| output token | 2048（含模型适用的 reasoning 消耗）；incomplete 不补请求 |
| 网络响应 body | 256 KiB；逐块计数，越界取消，不直接无界 response.json |
| 网络耗时 | 60 秒，一个绝对 deadline 覆盖 fetch/header、读取 body、解析及 schema 校验，分阶段不重置 |
| 任务总耗时 | 90 秒，包含取证/前后当前性校验；不因分阶段重置无限延长 |
| 并发/排队 | 全应用 1 个远程请求；不自动队列，第二次明确 busy |
| 预览 | 最多 1 个/窗口，5 分钟过期；任务 terminal/切换即清理 |
| 任务历史 | 至多 20 条不含正文的元数据/窗口；重启不恢复付费请求 |

字段预算同样进入本地 strict Zod 和适用的出站/响应 JSON Schema（字符串有界 pattern，数组 minItems/maxItems）；整个请求/响应/IPC envelope 还受上述总字节上限。不允许只约束 claims、漏掉 unknowns 或嵌套身份。以下为首切片全部字段类别，新增字段必须先分配预算，未知字段拒绝：

| 字段类别 | 数值/集合上限及越界处理 |
| --- | --- |
| repositoryId/snapshotId/nodeId/edgeId/evidenceId/provider response ID、analyzer 名称 | 1–128 Unicode 字符；每项最多512 UTF-8字节；ID不裁剪，越界拒绝 |
| packageId/contentHash/sourceFingerprint/configurationHash/result fingerprint/policy hash | 64位小写十六进制；分析结果身份按既有契约核对，不改写历史身份 |
| taskId/previewId/context owner session ID | main 创建 UUID；固定36字符；renderer不创建authority |
| contextHandle | main 创建的UUID引用，不暴露可写epoch；按窗口归属查权威row |
| model | 1–128 ASCII字符，`[A-Za-z0-9._-]`，不支持ft:；不裁剪，不替换模型 |
| provider/purpose/confidence/type/phase/code/数据类别/截断原因 | 版本化有限枚举；provider仅openai，purpose仅feature-explanation；不接受自由字符串 |
| version/分析器版本 | version固定literal；分析器版本1–64字符、最多256 UTF-8字节；analyzerVersions最多8项且名称受上述上限 |
| 路径/名称/边reason/静态说明 | 路径1–1024字符/最多4096字节，必须受限相对路径；名称1–256字符/最多1024字节；reason/说明1–1200字符/最多4800字节；不能裁剪ID或篡改真实路径，无法表示时排除并注明原因 |
| 源码snippet | 至多24项，每项40行/4096字节，总24 KiB；按前述真实slice范围裁剪，不按Zod transform隐式截断 |
| 包 nodes/edges/proofs/path引用/unknown说明/limitations/failed摘要 | 24/40/24/24/24/24/24项；unknown和limitations每项1–1200字符/4800字节，出站省略须计数/枚举说明；本地完整限制另行显示，不因包截断删除 |
| analysisIdentity | 只投影已知版本、最多8项分析器、固定hash及ignorePolicy摘要（version/hash，不外发完整rules数组）；unknown字段不递归外发 |
| 输出claims/unknowns | claims1–12项；unknowns0–12项；两者text均1–1200字符/4800字节；claim引用1–8项，unknown引用0–8项（零项只能表达包整体限制）；所有非空引用仍验证归属 |
| 输出外层output/content/text | output最多16项、message content最多4项；待JSON解析output_text最多64 KiB，其余允许item仅保留受限kind，整个body最多256 KiB；不存reasoning/refusal内容 |
| 预览数据类别/scope/truncationReasons | 类别最多6项、scope仅1项、截断原因最多12项；未知枚举拒绝 |
| 时间/数量/源码行列 | 时间为ISO日期、最多32 ASCII字符；计数0–2147483647；行1–2147483647，列0–2147483647；修订/epoch为非负安全整数≤9007199254740991，溢出失败关闭 |
| credential与worker配置 | key1–2048 UTF-8字节，固定自有target；desktop内部数据库/缓存路径每项1–32767字符，不进入模型schema/preview；IPC预算64 KiB，预览/事件预算256 KiB |

本地完整unknown展示若需要分页，只显示本地完整集合/遗漏计数；不向模型发送无限数组。固定prompt/schema自身也计入64 KiB，供应商error字段不纳入可展示字符串。首个purpose单值使 scope/purpose不可能被自由文本扩展。

Byte 限额不是精确 token/费用估计；不宣称 64 KiB 等于固定输入 token。初始 model 未配置，不自动选模型或调用 models 列表；允许符合长度/字符校验的明确模型 ID，账户不支持返回固定错误，不 fallback 到另一付费模型。输出限额仅允许调低，模型兼容与费用仍待真实验证。

平台 fetch、AbortController、crypto 和现有 Zod 能满足单次 HTTPS/计时/哈希/schema；无需 OpenAI SDK、HTTP 客户端、tokenizer 或凭据第三方包。bounded JSON.parse 前后核对同一绝对 deadline；同步解析不能由 AbortController 抢占，main 的总 deadline watchdog 可终止解释 worker，重启后不得自动重发。`redirect:"error"`，拒绝所有 3xx，不跟随同域跳转；endpoint 不在 UI/IPC/配置中出现，TLS 证书校验不关闭，不采用环境代理/自定义 dispatcher。401/403/429/5xx/超时只返回固定诊断与是否可手动重试，不转发服务商 body、header、异常 message 或密钥；非2xx立即取消 body，refusal/incomplete 内容及任何失败 body 都不写日志或数据库。一次用户点击最多一次 HTTP 请求，禁止 SDK/应用自动付费重试。取消不保证服务商停止计算或退款，明确区分本地任务停止与账单状态未知。

## 项目授权与 Windows OS 凭据

逐项目授权默认 denied，键为真实 repositoryId；数据库中只保存版本化非秘密授权记录：provider、允许 purpose、数据类别、disclosureVersion、revision、grantedAt/revokedAt。1C 仅能授予 feature-explanation；architecture-labels 需明确增加 scope 并重新选择。未来 ownership-grade 也需独立 scope，不继承解释授权。全局配置 key/model 不授予任何项目外发权限。

授予前预览固定类别（查询、相对路径/符号/关系、源码片段、证据身份/范围/分析器/不确定性）、实际片段/字节/省略信息、provider/模型、上限和保留说明。用户按项目明确选择，再按任务点击发送；授权记录带 expectedRevision 乐观校验。授予本身也改变 revision，因此自动重新准备零网络预览，用户检查新预览后才点击发送；不复用 denied 时的旧 previewId，也不因 grant 自动发送。撤销增加 revision，清空预览，立即 abort 项目活动任务，拒绝旧结果；撤销不删除本地索引，也不能收回已外发数据。披露/purpose/provider 变化要求重新授权。损坏授权 fail closed，不能沿用内存 approved。

用 desktop 独立 N-API 模块包装 Windows Credential Manager：固定应用自有 target `com.projectxray.desktop/openai/api-key/v1`，`CRED_TYPE_GENERIC`、`CRED_PERSIST_LOCAL_MACHINE`；限定当前用户本机持久化，不用 enterprise roaming。采用 [CredWriteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credwritew)、[CredReadW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw)、[CredDeleteW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-creddeletew) 与 CredFree；[CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw) 规定对应类型和持久化含义。只操作这一固定 target，不枚举 OS 凭据，不接收任意 target，不扫描环境或 Codex 登录信息。

原生接口为状态/写入/删除/内部读取四项。renderer API 只有 keyConfigured 布尔及 error 状态，绝无 getter；原生内部读取只给解释 worker。[CREDENTIALW CredentialBlobSize](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw) 官方上限是 `CRED_MAX_CREDENTIAL_BLOB_SIZE (5*512)`，即2560字节。TS/IPC入口采用更小的1–2048 UTF-8字节上限（按bytes，非字符数），拒绝控制字符；原生层再次用wincred.h实际常量核验blob字节数，并核验应用2048上限不超过该常量；任何超限拒绝，绝不截断key。GENERIC blob存应用定义的UTF-8原始字节，不转UTF-16后绕过预算。读取自有target同样验证大小/编码，不接受不可用旧值。原生 buffer 生命周期清零、CredFree 后不保留副本，JS 字符串无法保证抹除，必须减少引用并如实记录此限制。Windows Credential Manager 是 OS 凭据存储，不宣称能防同用户恶意进程。原生权限/缺模块/策略失败时 unavailable，禁止回退 SQLite、safeStorage 文件、普通加密文件或明文。

现有 analyzer-core N-API 是文件安全读取器，不应加入凭据职责。复用已有node-gyp版本和 NAPI_VERSION=8，新增 desktop native 的 `windows_credentials` target（Advapi32.lib），保持 analyzer 无 Electron/凭据依赖。当前 `node-gyp:12.4.0` 只在analyzer-core devDependencies；desktop必须显式新增同版本devDependency `node-gyp:12.4.0`，编译脚本从desktop自己声明的依赖解析，不能跨包读取私有node_modules。理由是平台fetch/Zod不提供Win32凭据调用，需要NAPI编译而现有工具已满足，无需新的runtime凭据/FFI包。desktop 编译/复制脚本明确输出到 dist/native，已有 asarUnpack 模式可涵盖；必须在实际 Node/Electron/portable 运行时验证，不以编译成功代替凭据验收。新增 internal workspace llm/graph引用及desktop node-gyp显式dev声明需更新lock对应importer；不引入新第三方runtime依赖，不假定lock无需变化。该变化仅在后续审查批准实施。

非秘密 provider 配置/credentialRevision 位于应用全局数据库。写 key、删 key或改 model 前先在事务中增加 revision 并标记 unavailable/changing、取消所有远程任务；完成 OS 操作后才进入 configured/unconfigured。OS 与 SQLite 不能原子提交：失败/崩溃保留不可调用，重启检查自有 target 状态并要求用户完成配置，不从旧 metadata 推断可调用；不启动网络健康检查。测试凭据使用编译期/测试构造固定的独立 target，绝不覆盖用户生产凭据。

## 异步竞态与事务门禁

任务身份由 main 创建 UUID（任务不是内容身份），捕获 `{taskId, repositoryId, snapshotId, analysisResultFingerprint, ignoreRevision, authorizationRevision, providerRevision, contextEpoch, packageId, limitsVersion}`。renderer 不能自行决定 epoch/修订，所有事件包含 taskId 与 ref；只允许匹配当前窗口/context/任务接收结果。

新增解释context操作由main拥有的窄global-policy连接执行：收到项目/快照切换、离开解释上下文、开始索引/修改排除设置或窗口关闭时，main先阻止该owner的新解释操作及旧事件转发，再在global-policy DB的IMMEDIATE事务中提交新epoch/active=false（或经核对的新ref）。**权威context事务提交是上下文变更的线性化点**；只有提交成功才返回context handle、开始索引/配置操作或开放下一操作。随后向解释worker通知取消是资源回收，不能担当授权屏障。busy超时（最多250ms）/提交失败则返回固定失败、保持main门禁关闭并终止解释worker；不能宣称已成功切换，也不能在写row前放行后续操作。重启先用main新session UUID失效旧owner row，再启动provider worker。

main控制sender、窗口owner、session/epoch和context handle映射；renderer只能提出ref请求，不能指定owner/epoch或写authority row。ref归属核对成功后，main提交context，worker按同一数据库锁核验这个已提交ref/epoch；不依赖main临时缓存作为worker许可。A→B→A每次增加epoch；成功索引后重新激活也需新提交，失败不复活旧任务。持久解释worker每次prepare/dispatch/publish都从DB读当前snapshot、activation和context，不依赖XRayApplication内存current。

流程如下：

1. prepare：捕获所有修订和 context；安全检查当前性；读取不可变证据/源码、生成包；再次核验版本，返回 previewId/packageId。
2. start：严格匹配预览/包，检查配置、授权和目的；重读 OS key；重新检查工作区/排除配置；不满足 current 就零请求。
3. dispatch：在同 worker 的同步临界段，以固定锁序 global-policy DB → project-settings DB → legacy snapshot DB（需要时）取得 IMMEDIATE事务锁；从DB重读授权/provider/context/ignore修订、当前激活snapshot及analysisResult指纹；登记task并同步调用注入的dispatch函数启动fetch。**同锁核验后的dispatch调用是该次请求的许可线性化点**，context/revoke与dispatch通过同一global-policy写锁排序；context变更先提交则旧task不得调用dispatch，dispatch先获许可则属于变更前请求。禁止事务内await，禁止校验释放锁后再由另一消息dispatch。同步启动失败回滚；fetch可能返回已拒绝Promise，异步失败只形成失败任务，不自动重发。许可日志事务失败时立即abort并固定失败，不声称已发数据可回滚。
4. await：网络期间不持有数据库锁；撤销/取消令AbortController生效；外部连接修改政策仍由后置检查兜底。fetch调用不等于网络字节已经发送，事务定义的是许可dispatch顺序而非物理传输时间。先前获许可请求可能在撤销/context提交后继续送出字节或产生服务端计算；本地尽力取消，无法保证收回数据、停止计算或退款。提交后新的旧context dispatch被拒绝，与这条先前请求边界分别报告。
5. validate：先限制响应体、状态/schema，再纯验证引用；重新安全校验工作区。若源文件变化、校验不可用、快照重建、配置或上下文改变，丢弃结果，不写成功记录。
6. publish：同一固定锁序事务中再次核对所有修订、context、当前快照/激活标识和 source manifest；task 非 terminal/未取消才追加一次 normalized explanation，随后标 terminal。唯一 taskId 防重复发布；authoritative policy DB 锁持有到 legacy/result DB 写入完成。事件只在提交后发送，main 再核对 epoch，UI 再核对 ref/task。

global provider/authorization/context 同库有利于原子核验；项目排除配置仍留在项目数据库，不复制成第二事实来源。新 GraphStore 同步 port 提供 `withExplanationRevisions`，复用 `withIgnoreRevision` 的兼容写入原则；必须检查锁序及 busy 固定错误，不做无界锁等待。快照 published/current 切换要读数据库，不依赖长期 explanation worker 内存的 `current`。捕获 activation 标识，使相同 snapshotId 重新晋升也能使旧上下文失效。

普通文件系统不支持“读取期间所有文件永不变化”的原子保证：后置 current 只在读取完成时证明，事务锁阻止 DB/策略竞态，不能阻止外部文件编辑。持久化记录带 checkedAt 和既有 validationLimitations；显示/再次使用前重新检查状态，迟到结果不会被描述为实时事实。测试必须覆盖校验结束、事务开始前的第二连接变更，不以 mock 单函数调用替代跨连接竞争。

迁移10（若集成前无人使用）明确按连接角色分支：仅实际应用authoritative global数据库创建 `remote_provider_settings`、`project_remote_authorizations`、`explanation_contexts`、`explanation_tasks`；project数据库只创建 `remote_explanations`，不创建任何global policy表；legacy/global库因兼容旧快照也创建其结果表。GraphStore新增显式storeRole/global policy factory，由desktop/application按真实配置注入，不按renderer输入或路径字符串猜角色；main authority连接只开放context控制方法，application连接读policy/写授权需经main验证的命令。各库按自身角色记录迁移10，不能每次GraphStore构造就无条件创建全部新表。只存修订、状态、受限ID、时间/计数、经过验证的引用叙述及必要身份，不存key、原始body、完整证据包/模型响应/异常文本。旧快照、题目、评分、创建时间及已保存源码保持原样；旧数据库无授权/配置默认为denied/unconfigured。任务记录不能恢复或自动重发，重启将unfinished标为interrupted。

## UI/IPC 冻结前接口草案

以下是评审草案，不是现有可调用 API；最终 strict Zod schema 在 1C 先冻结交给 Luna。

| API | 输入/输出与安全语义 |
| --- | --- |
| getRemoteProviderState() | `{provider:"openai", model:string|null, revision, configured:boolean, availability:"available"|"unavailable"}`；无 key，configured 仅表本地 OS 存在/配置完成，不表真实服务成功 |
| configureRemoteProvider(input) | expectedRevision、明确 model、可选 transient key；返回状态，不执行网络 |
| deleteRemoteCredential(input) | expectedRevision；删除仅自有 OS target、advance revision、cancel all |
| getRemoteAuthorization(ref) | purpose scope、disclosureVersion、revision、denied/granted；无自动授予 |
| saveRemoteAuthorization(input) | repositoryId、expectedRevision、scope、明确 grant/revoke；校验项目身份 |
| activateExplanationContext(ref或null) | main 产生 epoch，清理旧任务；返回 contextHandle |
| prepareRemoteExplanation(input) | ref、query、purpose:"feature-explanation"、contextHandle；返回 previewId、packageId、可审查片段、类别/限额/遗漏、provider 状态；零网络；moduleId 留到后续1x |
| startRemoteExplanation(input) | previewId、packageId、contextHandle；main 返回 task handle 后才开始事件；不存在预览不可发送 |
| cancelRemoteExplanation(taskId) | 幂等取消；按 owning window 校验，不能取消其他窗口任务 |
| onExplanationEvent(listener) | progress/complete/cancelled/failed/invalidation；每项有协议版本、taskId、ref、epoch |

progress phases 为 preparing/checking/sending/waiting/validating/publishing，不伪造百分比或 token 进度。completed 带 validated narrative、generationSource:"remote"、provider/model、引用映射、checkedAt/限制；failed 只带枚举 code 和 retryable。明确错误族：NOT_CONFIGURED、CREDENTIAL_UNAVAILABLE、CONSENT_REQUIRED/REVOKED、CONTEXT_CHANGED、SNAPSHOT_NOT_CURRENT、EVIDENCE_INSUFFICIENT、LIMIT_EXCEEDED、BUSY、TIMEOUT、AUTH_REJECTED、RATE_LIMITED、PROVIDER_FAILED、REFUSED、INCOMPLETE、INVALID_RESPONSE、INTERRUPTED。文案本地固定。手动重试重新 prepare/start、新 taskId 和重新校验/预览；不保存 key/body，不盲目重放旧付费请求。旧离线 API 独立显示 `generationSource: local-template`，可通过新 UI 的本地包装表达而不破坏旧 schema。

main 对新增敏感 IPC 校验 senderFrame 是拥有窗口的本地顶层页面（生产打包文件、开发明确允许的 dev origin），拒绝子 frame/外部页面；不在 renderer 暴露 generic invoke、native addon、fs 或 provider port。跨窗口 context/任务按 owner 隔离，全应用网络限额共享。

## 实施文件范围（须另行派发）

1C Sol 的精确建议范围如下；不代表本轮可修改产品文件。仅扩展解释相关字段/操作，不重构既有索引/比较 broker：

- 新增 `packages/llm/package.json`、`tsconfig.json`、`src/index.ts`、`src/evidence-package.ts`、`src/output-validation.ts`、`src/openai-responses.ts`，及同名 `*.test.ts`。
- 新增 `packages/contracts/src/remote-explanation.ts` 与 `remote-explanation.test.ts`；修改 `packages/contracts/src/index.ts` 导出、safe diagnostics、XRayApi、IPC_CHANNELS 和 worker envelope（必要时独立 explanation worker schemas 导出）；已有非解释契约保持兼容。
- 新增 `packages/application/src/remote-explanation.ts`、`remote-explanation.test.ts`；修改 `src/index.ts` 的用例委托与 `package.json` 增加 llm workspace 依赖。
- 新增 `packages/graph/src/remote-explanation-store.ts`、`remote-explanation-store.test.ts`；修改 `src/index.ts` 迁移和 policy/transaction ports。结果表只保存解释，不写 nodes/edges/evidence。
- 新增 `apps/desktop/src/explanation-worker.ts`、`explanation-broker.ts`、`windows-credentials.ts`、对应三个 `*.test.ts`；新增 `src/remote-explanation.worker.test.ts`（协议/竞态集成）。修改 `main.ts`、`preload.ts` 注册窄 API；`analysis-worker.ts` 仅在需要发布索引/context 失效事件时最小接线，业务分析逻辑不改。
- 新增 `apps/desktop/native/windows_credentials.cc`、`binding.gyp`、`scripts/build-credentials.cjs`、`copy-credentials.cjs`、`credentials-smoke.cjs`；修改 desktop `package.json` 和 `tsup.config.ts` 增加worker entry/复制步骤，显式声明node-gyp devDependency 12.4.0及main所需graph workspace引用。`pnpm-lock.yaml`范围为新增llm/graph workspace引用及desktop同版本node-gyp importer声明，不增加第三方runtime依赖；其他新增依赖需重新论证。
- 新增后端实施 development-run；AGENTS 只有获得已确认可复用工程证据后才可能小幅修改。

1D Luna 后续范围建议为实际存在的 `apps/ui/src/App.tsx`、`App.test.tsx`、`components/FeatureExplanationWorkspace.tsx`、`FeatureExplanationWorkspace.test.tsx`、`state/ownership-sessions.ts`、`ownership-sessions.test.ts`（现有页面请求/session 设施），新增 `components/RemoteExplanationControls.tsx`、`RemoteExplanationControls.test.tsx`。UI 目前直接使用 window.xray，没有 api.ts 或 pages/FeaturePage.tsx，不按猜测路径派发。架构子切片后续单独派发 `components/ArchitectureWorkspace.tsx`/对应测试与标签覆盖层，不扩大到全局样式重构。本轮不占用这些文件。GUI/portable 测试脚本与集成计划由协调方维护；build/native/真实 Electron 仅一个协调窗口。

## 验收矩阵与依赖

| 门槛 | 最小证据 | 当前状态 |
| --- | --- | --- |
| 纯证据/输出 | 定向金标、裁剪与 ID 闭合、字节边界、unknown/无引用/错快照/注入 | 设计，未实现 |
| 协议替身 | 固定 HTTPS body/schema、store:false、3xx 零后续请求、401/429/5xx、超大/慢 body、refusal/incomplete/tool item、取消、1 click/1 request | 设计，未实现；不能替代服务 |
| 事务/竞态 | 第二SQLite连接在前/后校验与发布前改授权/配置/current；暂停worker于dispatch前，main context提交后旧请求dispatch计数=0；反向顺序记录先前许可请求及取消边界；busy失败不开放下一操作；legacy跨库锁；A→B→A/重启；取消只一次terminal/无重复写入；project库无global表 | 设计，未实现 |
| 未配置生产 | 没有 key/model 时发送禁用/后端拒绝；授权前零 fetch；不能启用 mock provider；离线模板可用 | 设计，未实现 |
| OS 凭据（可自动） | 用非秘密自建值通过正常 native API 检验自有测试 target 写/读/删、重启、失败关闭、Node/Electron/portable；不操作密码管理器/认证 UI，不读取用户生产 key | 设计，未实现 |
| Electron 非安全路径（可自动） | 预览/未配置状态、离线查询→引用导航、取消/恢复、项目切换迟到结果；使用自建样例；1x 再验架构标签 | 设计，未实现 |
| 项目授权 UI（须用户操作） | 用户在可审查生产 UI 手动 grant/revoke，协调方观察状态；后台定向测试另验拒绝/撤销竞态，不用自动点击安全/隐私设置替代 | 待本地 UI；用户步骤未执行 |
| 真实凭据/远程（须用户操作） | 用户手动配置自己的 key 与明确模型、应用内样例外发选择后单次最小调用；协调方观察兼容/引用/质量限制 | 外部阻碍：无 key，未验收 |

替身只通过测试入口依赖注入，测试工厂/fixture 不进入 production exports/bundle；没有环境变量、IPC provider:"mock"、任意 endpoint、预授权数据或 production hidden switch。实际 GUI 的离线/未配置状态可独立验收；成功远程 UI 使用测试专用构建/隔离数据时必须显著标“测试替身”，正常授权流程仍存在，不能以替身绕过用户操作或成为 production 成功的证明。网络测试不得真正请求 api.openai.com，配置测试不得扫描现有凭据。协调方明确的 computer-use 限制禁止自动修改安全/隐私设置：项目 grant/revoke、真实 key 录入与此类权限响应都需用户手动，不能通过测试授权后门改变生产安全 UX；该限制不妨碍纯后台测试使用正常 application/graph policy API 创建隔离测试状态并验证门禁。

四批依赖：第二批在本包/授权/任务稳定后另订评分 ADR，保留 ADR-0006 离线自由文本未评估，答案/rubric 只在提交后进入远程证据包，独立 scope 与追加尝试/评分版本，绝不用本批 claims 冒充评分。第三批可在无 key 时独立测量全量基线；以后缓存身份必须继承结果指纹/配置/分析器及 completeness，不能让增量复用扩大外发证据。第四批等待功能集成，需包含凭据 addon/迁移10、隔离安装升级与自有凭据删除政策；签名证书和干净机器边界沿计划保持开放/用户跳过。后三批本轮均不实施。

## 已接受的设计取舍与实现门槛

协调方已独立核对原源码、完整ADR及A–E修订，接受上述限额、独立 explanation worker、权威 context 提交/dispatch许可线性化、按角色持久化、desktop 原生 Credential Manager 模块，以及功能解释先行/职责标签后续子切片。实施按精确子批派发，契约/llm先行，然后application/graph/desktop及UI；底层交付不代表E2E里程碑完成。不存在可用 key 时不阻止本地实施，但不可关闭真实调用门槛。记录迁移号需在实施前重新核对。未配置生产与替身隔离、外部编辑的非原子当前性、撤销不可收回已发送内容和 JS 密钥内存不能保证抹除均是公开限制，不能用成功测试措辞消除。独立审查依据见[协调记录](../development-runs/2026-10-01-v1-long-development-review.md)。
