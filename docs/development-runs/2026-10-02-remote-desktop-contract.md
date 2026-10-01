# 1C-2B-1：生产 Responses 桥接与 strict desktop/worker 协议

## 授权与基线

固定 Sol worktree，分支 `codex/llm-explanations`，实施前 HEAD `32dbae85f926faa302ff74186120d253cc0a4890`，工作区干净。已读取 AGENTS 与接受的 ADR0007。1C-2A 已接受，不将磁盘旧计划状态当作退回，不合并协调方后续纯文档提交。

原授权只涉及 llm 的 Responses 文件及导出、独立 desktop 契约、desktop provider、对应测试和本记录；不修改旧 XRayApi/IPC、application/graph/analyzers 或 main/preload/tsup/UI/native。协调方随后确认补充两处：desktop 的 llm workspace 依赖与 lock 对应 importer。理由是生产桥接直接导入共享 builder/provider，desktop 原本未声明 llm，不能借 transitive 或私有 node_modules 绕过依赖声明。无第三方新增依赖、SDK或HTTP客户端。

## 实现与边界

- llm 导出唯一 `prepareOpenAIResponsesRequest`。严格接收 prepared、model、可调低 token 上限；复用真实 evidence package 的哈希/引用验证，保留完整本地 unknown/limitations。完整规范化 Responses 正文含固定 instructions、user evidence input、store:false、stream:false、text.format/schema 和 token 上限，UTF-8 上限64 KiB；摘要直接对实际正文 UTF-8 计算 SHA256。纯准备无 credential、无网络、无 endpoint/schema 配置入口。
- `generate`复用该 builder，在 fetch 前核对获批准的 expectedBodyDigest。完整正文预算、固定 HTTPS endpoint、redirect:error、一次请求、逐块响应预算、原输出验证、全进程 BUSY、网络60秒/总任务绝对deadline与取消保持。对已被修改 message/code/getter 的 typed 异常也重新构造枚举固定错误，不转发异常文本。
- desktop `RemoteResponsesBridge`实现既有 RemoteProviderPort。摘要和 dispatch 均使用同一 builder；dispatch直接调用generate，直到 fetch 启动没有 await、异步 preflight 或计时器跳转。返回原验证器产生的 narrative，不把 ValidatedExplanation envelope 当 raw narrative。生产 factory 无参数，固定平台fetch；构造带明确 transport 的 llm provider 仅作为可信内部测试端口，未增加 renderer/配置端点或隐藏开关。
- 新协议版本复用 EXPLANATION_TASK_PROTOCOL_VERSION。renderer只提出 ref、查询、preview/package/context/task引用及受限配置/授权请求，不提交 owner/epoch、创建 task authority、正文或任意 path/target/endpoint。内部 worker 命令独立包含 main owner/context/handle，辅助校验以调用者传入的实际可信 context 为基准。
- main 的 renderer start 响应是立即返回的引用句柄，worker start命令才包含 main 生成 taskId与完整context。事件仍使用核心 RemoteTaskRecord/RemoteResult；preparing仅瞬态，不新增SQL状态。纯事件守卫校验完整context身份、已发句柄、先后顺序及一次terminal；completed需要此前dispatched和同身份结果。未来broker必须先登记/返回句柄，再转发worker事件，并提供真正已接受的前一事件，不能把这些纯检查当作已实现的窗口注册表。
- 回包与已发命令按requestId/operation/ref/task/context/epoch及完整激活身份绑定。preview闭合节点/边/proof/path、本地unknown与预算；结果沿用核心精确引用与unknown置信约束。严格拒绝未知字段、版本、命令及大小。凭据写入只允许既有remoteKeySchema的1–2048 UTF-8字节和控制字符规则，无读取秘密命令；WorkerConfiguration仅含内部声明的Windows绝对数据库/缓存路径及协议版本，无key。所有状态、结果、失败和事件不返回key。
- 配置默认状态、实际项目授权、权威事务与网络占用仍由已接受application负责；bridge或schema本身不授予权限。凭据只作为一次内部参数进入Authorization header，不进入builder、body、digest、preview或持久结果。JS字符串不能保证擦除。

协议导出不等于IPC接线：本轮没有新增channel、renderer API、解释worker/broker/main生命周期或OS凭据实现。

## 实际反馈闭环

### 测试数据与类型：测试缺陷

第一次执行新desktop契约文件：15项中14 passed、1 failed，exit1。测试以21800个三字节字符构造配置路径，但整个JSON实际仍低于64 KiB，错误地期待超限。根因确认；改为22000个字符，真正超过UTF-8 envelope上限，不改变生产阈值。随后15项通过。

同轮contracts类型检查报告TS2345：未标注的测试对象把协议literal推宽为string。将交给类型化守卫的测试对象先通过schema.parse，不削弱生产类型。首次两条tsc放在同一shell，末条成功导致shell exit0，但前条错误输出真实存在，不能报告当时两包全通过；后续均逐条独立运行且exit0。后续引用闭合/终态回归将该文件扩展到18项。

### 直接内部依赖：配置缺失

desktop首次tsc exit1：两个新文件TS2307无法解析llm，继而出现推断any；实际package未声明直接依赖。按范围边界提出具体理由，协调方批准后仅追加workspace依赖及对应三行lock importer。

```text
pnpm install --offline --ignore-scripts --frozen-lockfile
```

exit0，lock已同步、跳过resolution，无生命周期脚本；只链接已有workspace和本地依赖。随后desktop类型及17项provider测试通过。没有为了通过检查改用私有路径、安装SDK或触发native/build。

### 结果与任务时间相等：新协议产品缺陷

审查新事件schema对核心写入语义的兼容性，确认结果publication与权威task completion为先后两个写入，completedAt不属于任务身份，不保证相等。增加显式1毫秒差异回归：

```text
pnpm --filter @project-xray/contracts exec vitest run src/remote-explanation-desktop.test.ts -t 'distinct result publication' --maxWorkers=1 --no-file-parallelism
```

exit1：1 failed、17 skipped（仅过滤器），事件错误返回CONTEXT_CHANGED。根因确认是新增schema错误添加的时间等同约束，不是核心发布失败。修正仅移除不成立的时间相等要求；同身份、completed结果必需、引用闭合与terminal一次规则保持。再运行完整contracts55项及desktop17项，均exit0；真实最小索引→核心→生产bridge→结果重读→终态事件也通过。没有修改核心时间、历史结果或正确身份断言。

## 当前源码的最终定向验证

```text
pnpm --filter @project-xray/llm exec vitest run src/evidence-package.test.ts src/output-validation.test.ts src/openai-responses.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @project-xray/contracts exec vitest run src/index.test.ts src/ignore-settings.test.ts src/remote-explanation.test.ts src/remote-explanation-desktop.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @project-xray/desktop exec vitest run src/remote-provider.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @project-xray/application exec vitest run src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism
```

llm：3文件76 passed（Responses37项）；contracts：4文件55 passed（新协议18项）；desktop：1文件17 passed；application：1文件55 passed。合计9文件203 passed，无最终skip，均exit0。最后修正只影响契约及desktop验证，已重新运行相应完整文件组合。不是旧161项，也不是全仓/GUI验收。

测试明确替换transport或平台fetch，使用自建非秘密TS样例和临时SQLite；真实网络调用0、OS凭据读取/写入0、用户项目数据外发0。实际索引测试确认prepare无调用、预览digest与真实fetch参数body的SHA256相等、一次dispatch、结果可重读；另覆盖model/token/schema改变digest、摘要不一致、完整转义正文超限、未知/权限字段、无配置、deadline、取消/BUSY、失败脱敏及原llm预算/输出/注入样例不回退。没有付费重试。

```text
pnpm exec tsc -p packages/llm/tsconfig.json --noEmit
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec tsc -p packages/application/tsconfig.json --noEmit
pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit
pnpm exec tsc -p apps/ui/tsconfig.json --noEmit
```

五包独立exit0；最终契约修正后contracts/desktop再次独立exit0。没有运行pretest、Turbo全测试、native、build、dist、Electron或OS凭据模块。

## 文件清单与冻结

修改6文件：

1. packages/llm/src/openai-responses.ts
2. packages/llm/src/openai-responses.test.ts
3. packages/llm/src/index.ts
4. packages/contracts/src/index.ts（仅追加独立协议导出）
5. apps/desktop/package.json（后补授权：一个内部workspace依赖）
6. pnpm-lock.yaml（后补授权：desktop importer三行）

新增5文件：

7. packages/contracts/src/remote-explanation-desktop.ts
8. packages/contracts/src/remote-explanation-desktop.test.ts
9. apps/desktop/src/remote-provider.ts
10. apps/desktop/src/remote-provider.test.ts
11. 本记录。

最终范围已核对：上述11文件，无越界差异；contracts index仅一行导出，lock仅desktop importer三行。tracked及5个新增文件的独立no-index空白检查通过，新增差异exit1不当作检查失败。无Git提交、推送、合并，HEAD保持实施基线。源码、测试和本记录冻结，Git收尾由协调方独立接受后进行。

## 规则判断与未验证

本轮AGENTS无新增规则。固定异常、边界strict校验、依赖依据及真实闭环已有规则；publication/task时间差异的具体兼容约束已进入协议回归和本记录，不将单项协议字段细节堆入通用规则。

真实服务、账户模型/schema兼容、自然语言质量、OS凭据、worker隔离/全局broker、主进程watchdog/异常退出、senderFrame/窗口注册、20项窗口历史及GUI均未验收。固定端点与schema的请求结构核对依据[官方Responses迁移文档](https://developers.openai.com/api/docs/guides/migrate-to-responses)，沿用已接受ADR的store:false与text.format约定；这不证明服务商零保留或账户可调用。2B-2仍需完成生产接线和实际Windows/Electron验收，本切片不能作为第一批E2E完成。
