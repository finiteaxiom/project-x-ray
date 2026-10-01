# 1A：受证据约束的远程解释设计记录

日期：2026-10-01。状态：设计交付待审，产品实现冻结。

## 目标、授权与基线

本轮仅设计四批计划的第一批 1A。允许新增 ADR-0007（proposed）与本记录；不修改协调计划、主 checkout、产品源码、依赖或 AGENTS，不提交/推送/合并，不发其他聊天消息。用户当前无 API 密钥；不扫描凭据/环境内容、不读取 Codex 令牌、不向模型发送任何项目数据。官方文档访问仅发送接口主题查询。

实际目录与派发 worktree 一致；`git rev-parse HEAD` 为 `d222036d59472612278cadced8422e53c16d7455`，开始时 `git status --short` 空。已读当前 AGENTS、四批计划、ARCHITECTURE、已接受 ADR-0001/0006，以及 application explainFeature/current/ignore 逻辑、contracts schema/API/worker、desktop main broker/preload/analysis worker、graph 迁移/修订事务、原生构建与 portable 配置。计划中的初始历史基线不作为当前 Git 基线。

## 设计与核对反馈

已确认源码事实：功能解释为离线 Promise RPC，没有远程 provider/凭据/任务协议；索引完成重建查询 worker；数据库最高迁移9；快照源码不可变，排除配置有事务修订核验；当前性为安全逐文件检查，非原子工作区快照。上述不是产品缺陷，新增远程行为须在其限制内设计。

设计选择独立 llm 包和 desktop explanation worker，OS key 只在解释 worker 临时使用。已有 fetch/Zod/crypto 能承担协议/验证，无需 SDK/第三方运行依赖；现有文件读取 NAPI 不承担凭据，独立 desktop NAPI 复用 node-gyp。全局非秘密 provider/授权/context 状态与项目配置事务锁配合，发送同步起点和发布各自核验版本，网络等待不持有 DB 锁。源码检查、不可变来源、包摘要、当前激活及 main/worker/UI 多重任务身份各有明确责任。

协调方后续审查提示已纳入：首个 purpose 只功能解释，架构标签后续1x；本地 unknown 旁支/截断独立保留；JSON Schema/Zod/外层 body 都限制数量与长度；header/body/parse 共用绝对 deadline；key 状态只返回 configured 布尔与可用性。自动验收和用户操作分列：computer-use 不自动改安全/隐私设置，grant/revoke/真实 key 录入须用户手动；OS API 仅以非秘密自建测试值验证，后台门禁测试不成为生产授权后门。

一次设计复核修正：不能采用“worker 校验授权 → RPC 返回 main → main 另行 fetch”的间隙作为强发送门禁，也不能只核对最终 snapshotId 处理 A→B→A。草案改为同 worker 在同步政策/项目事务锁内调用 fetch dispatch 起点，加入 contextEpoch/activation 身份；发布后 main 仍拒绝旧 epoch。这里是设计推演，不是已复现运行时缺陷或已验证修复，不能沉淀为 AGENTS 经验。

OpenAI Docs 技能：先搜索 Responses/structured output/refusal/incomplete，再打开官方网页，并定位 `text.format`、`store:false`、refusal content、incomplete 与 max_output_tokens 的实际正文。权威链接写在 ADR。官方 REST 参考的两种猜测 URL 返回 Internal Error、markdown 页面内容类型不受 web 工具支持；已有成功打开的官方迁移页 REST 示例和 Structured Outputs 正文足够支持接口草案，没有把失败链接或搜索摘要当已读正文。属于文档获取工具限制，不是产品失败。Windows Credential Manager 已打开微软 CredWriteW/CredReadW/CredDeleteW/CREDENTIALW 正文，核对类型、持久化、Advapi32 与内存释放；未执行这些 API。

## 实际验证与交付

- 只执行只读目录/Git/schema/源码/文档检查、官方网页读取及两个新 Markdown 的写入与轻量范围/文本检查。
- ADR 包含 E2E 顺序、精确后续实施文件、strict 输出/引用语义、项目授权/撤销、OS 凭据、task/progress/retry/限额、异步事务竞态、离线兼容、生产未配置/测试替身隔离、四批依赖及分层验收矩阵。
- 没有执行单元/集成测试、tsc、native/build/dist/重型检查、真实 Electron、OS 凭据、模型服务或 Git 写操作；没有新的通过数量、性能数据或端到端产品验收结论。
- 轻量检查：`git diff --check`；新增文件使用无索引 diff 检查空白；最终 `git status --short` 核对只有本 ADR/本记录，Markdown 本地链接检查。结果在本记录末尾追加。

## 限制与后续

这是 proposed 设计，不是安全实现证明。限额、锁序和 schema 需协调方设计审查后冻结；migration10 在实施前再次查占用。真实服务/账户模型/schema 兼容/语义质量、OS native 运行时、UI 路径、事务与文件竞态全部未验收。允许先完成不依赖 API key 的后端/凭据/GUI准备，仍分别报告远程外部阻碍。后续产品代码须由协调方另行派发；本轮交付后冻结。

本轮无新增/修订 AGENTS 工程规则：仅源码核对、官方 API 查阅和设计推演，无已复现实现缺陷或验证实验，不满足已验证工程经验门槛。

## 交付范围检查结果

`git diff --check` 通过；两个新文件各以 `git diff --no-index --check -- NUL <file>` 检查通过，仅提示工作区 LF 将按 Git 设置转为 CRLF，无空白错误。`git status --short` 只有 ADR-0007 与本记录两个未跟踪文件；产品/AGENTS/计划均无差异。已核对 ADR 引用的本地已接受决策和 ARCHITECTURE 存在；实际 UI 路径核对后把猜测的 FeaturePage/api 路径改为 FeatureExplanationWorkspace 和现有 session 设施。官方 schema 支持表复查后采用 pattern 表达字符串长度及 minItems/maxItems，明确 fine-tuned 模型不在首切片范围，未把未确认支持的关键词当保证。

## 协调审查修订 A–E

本轮仍只修订ADR和本记录，不实施产品。

- A：初稿4096字节key上限错误，已改为TS/IPC 2048 UTF-8字节且不截断。再次打开微软CREDENTIALW正文，CredentialBlobSize明确上限CRED_MAX_CREDENTIAL_BLOB_SIZE(5*512)=2560；原生必须用wincred.h常量二次核验。此项是官方文档确认的设计缺陷，尚无原生运行验证。
- B：初稿“main只先改内存epoch，然后异步通知worker写row”仍有继续dispatch窗口，已删除。main受控context在authoritative global-policy连接的IMMEDIATE事务提交后才返回/开放下一操作，worker dispatch同锁读权威row排序；通知cancel仅回收资源。设计定义许可dispatch线性化点，不把fetch调用当网络已送字节；先前许可请求可能在撤销后送字节/计算。增加可测的双顺序及busy失败场景；这是并发设计推演，尚未以第二连接/worker实验验证。
- C：新增全字段预算表，unknowns/嵌套数组/字符串、ID/model/path/版本/计数/时间/envelope都有限额；unknown proof参与claim时confidence必须unknown，否则整体拒绝，避免自然语言分类假设。原CALLS/proof置信度独立展示，包省略不消除本地限制。尚无schema/协议运行验证。
- D：此前已读package.json显示node-gyp12.4.0仅analyzer-core声明；desktop需显式同版本devDependency，自身require.resolve，不跨私有node_modules。依赖论证及lock范围补上该dev声明和main graph workspace引用；没有新runtime依赖。本轮未安装/修改manifest或lock。
- E：sender/owner/session/epoch由main控制；持久worker每次从DB读current/activation/context。migration10按明确storeRole只在实际global库建policy表，project仅结果表；兼容legacy/global结果单独说明。属于迁移设计，未运行迁移/重启验证。

设计缺陷已修订不等于实现安全门槛通过；没有因此新增AGENTS规则。后续实施可按协调方拆为纯contracts/llm先行，再application/graph/desktop；UI仍待契约冻结后由Luna负责。
