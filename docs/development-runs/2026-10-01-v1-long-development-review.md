# 四批长期开发：协调审查与独立验收

## 当前授权与计划

依据 [长期计划](../plans/2026-10-01-v1-long-development.md)，用户授权协调方规划及推进四批，并明确当前没有API账户/密钥，先做本地实现和验收准备。远程调用未验收，未读取/索取密钥或发送项目数据。干净Windows用户跳过保持未验收。

## 启动与实际结果

- 主checkout实际HEAD `53160a8`、工作区干净；Sol worktree HEAD `1be77c5`、干净、两聊天idle。协调方先ff到main，再提交计划为`d222036d59472612278cadced8422e53c16d7455`；Sol再次ff到此相同基线。没有重跑历史产品测试或GUI。
- 计划与DEVELOPMENT指向独立审阅，`git diff --check`通过；已普通推送origin/main，`git ls-remote`确认一致。没有新产品实现或新验收通过声明。
- 使用OpenAI Docs技能搜索并打开官方Responses/Structured Outputs/数据控制页面；实现约束记录在计划中，不能把`store:false`解释为零保留。
- 已派发Sol 1A设计、Luna 1B样例；精确范围不交叉，不开放全量构建。Sol实际确认目录与HEAD、开始设计。
- Luna首次把旧批次冻结理解为新授权仍需用户重复确认，没有开始修改；协调方提供本审查聊天可独立读取的最新人类userMessage（四批授权与无密钥先本地实施），要求先核对可信来源再执行。此为任务路由恢复，不绕过用户权限，也不增加向其他聊天消息发送权限。
- 已复用并更新`project-x-ray`为ACTIVE heartbeat，15分钟检查本计划双线程与真实验收队列；无变化静默，全部完成或仅外部等待且无有用动作时暂停。旧夜间范围/截止/Git禁令被最新授权取代。

## 待审与未验收

Luna已独立读取协调聊天最新userMessage确认最新直接人类授权，未发现新停止指令，开始1B准备。此障碍已解除，不要求用户重复授权。

computer-use 已完整读取 SKILL、guidance/api/confirmations；初始化及窗口清单成功，当前无Project X-Ray窗口，未启动旧产物或声称新GUI通过。[技能文件](C:/Users/Felix/.codex/plugins/cache/openai-bundled/computer-use/26.928.31416/skills/computer-use/SKILL.md) 要求阅读 guidance，其中明确："Do not change Windows security settings, Windows privacy settings, or any in-app security or privacy settings. Do not act on security or privacy permission requests." 因此项目外发授权/撤销等敏感UI动作需要用户操作，协调方不自动点击、不用改库/测试开关替代真实授权流程；仍可独立验证后台契约及其他GUI路径。真实凭据录入留给用户。此限制不阻止当前设计和本地实现。

1A首版ADR已独立阅读全文并对照契约、应用、持久化、原生工具链与官方资料；分层/最小切片方向接受，但未批准产品实现。要求Sol修订：

- Windows CredentialBlob官方上限2560bytes，草案4096bytes不适用；入口使用不超原生常量的UTF-8字节限制，不截断凭据。[微软CREDENTIALW正文](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)。
- main先局部epoch失效、稍后worker更新权威row的设计有dispatch读取旧row的窗口；定义权威policy提交与dispatch的同步线性化点，并明确fetch调用并不证明网络字节已发送、撤销不能收回先前dispatch。此为设计推演，非已复现产品缺陷。
- unknowns、ID/model/path等所有字段数值上限；引用unknown证据的claim强制unknown或拒绝，不能靠自然语言分类假装确定性检查。
- node-gyp只在analyzer-core声明，desktop独立原生模块应显式声明同版本编译devDependency，避免跨包私有依赖解析；无新runtime依赖。
- 主进程控制sender/context，worker每请求重读权威DB，global策略迁移不要无意义重复到每个project DB。

已发送具体设计反馈，1A仍修订中；1B样例待审。建议1C拆为契约/llm先行，再application/graph/desktop，最终仍要求完整E2E交付，不能将底层单测当里程碑完成。新产品代码、OS凭据、Electron UI、语义、增量、安装均未本轮验收；真实远程调用外部阻碍。

启动审查监控游标：Luna `6b95ab3f-37a6-4ff7-8a6f-d52b190d59ef:8`，Sol `dfa67683-bad0-4c3b-90f0-e3c97f2262ab:6`。后续以新wait_threads结果覆盖，不能反复审查旧冻结/旧报告。

## 1A 复审与1C-1启动

已独立重读Sol A–E修订全文相关段落：2048UTF-8 byte应用上限/原生常量验证、不截断；main在权威policy事务提交context后才放行，worker同锁dispatch核验；全字段预算和unknown引用强制unknown；desktop显式node-gyp同版本dev声明；按global/project角色迁移。方向接受，运行证明仍须实际回归，未把设计推演变成AGENTS经验。

Sol idle/只有两份文档未跟踪时，协调方将ADR状态标已接受，切独立任务分支`codex/llm-explanations`、ff最新main文档，再仅提交该ADR与设计记录为`fde7b95184fc3425b95a75c1f730d13084cc762c`，主checkout ff集成；Luna未跟踪样例保持。随后派发1C-1：只contracts新独立remote schema/re-export、新llm包/定向测试/内部workspace lock及其记录；不接现有XRayApi、不改app/graph/desktop/ui或native，不真实联网模型。1C-2后端/凭据与1D UI等待契约交付审查。

## 1B 独立静态验证

已独立读4源码、README、gold和Electron矩阵。以`node --import tsx --input-type=module`从stdin运行审查脚本，只调用已有TypeScriptAnalyzer.analyzeProject/analyze和PythonAnalyzer.analyze解析样例，不执行/导入样例。使用node:assert核验7处调用范围、置信度、词法目标与跨项目ID；全部通过，退出0：

- Alpha TS四条verified CALLS分别11:11–11:31、16:9–16:30、20:16–20:36、21:21–21:59；两describeState节点及绑定独立。
- 动态selected调用15:17–15:27保持unknown；JS调用6:9–6:28为verified。
- Beta调用6:9–6:29，项目ID不同不复用Alpha符号；Python仅format_summary函数，注释不产生CALLS/权限。
- 来源SHA256：alpha/dashboard.ts `113be8fa70444c6a0362f191321426cf065521c3f9c1786983ccfc993a060585`，alpha/legacy.js `0a8d42f3a4481dffb51bffb44e325cc493e82a0ee5abead4748a51cec8da8ecf`，alpha/summary.py `9e789b6e4c6986252789eea9150821fceb0c7a61390b3cc333ce9eb46d71907d`，beta/dashboard.ts `2183439bd57a60960cb6017f0ad5e2c84a1f6d23d5fa54ac096defcbeeb22de5`。

没有native/full build/SQLite导入/GUI/remote新验收，矩阵仍是准备程序；静态金标通过只接纳准备切片，不代表功能解释产品切片完成。原beta金标列终点差异由Luna修正并按样例预期问题记记录，非产品缺陷。Luna已完成并冻结8文件，协调方已复核最终记录/范围，接纳准备切片。只有上述静态分析是本轮新验证，历史产品GUI结果不外推本批。

Sol当前独立branch为codex/llm-explanations，1C-1已获具体实现派发；Luna待契约稳定后UI任务，非持续空跑。当前监控游标更新：Luna `6b95ab3f-37a6-4ff7-8a6f-d52b190d59ef:15`，Sol在新1C-1回合启动，后续wait_threads取得新cursor。自动任务保持ACTIVE，按实际计划继续。

## 本轮规则判断

本轮为协调设计启动；记录实际任务派发恢复，不编造产品失败或测试闭环。当前无新增AGENTS工程规则：权限协作和验收已有规则覆盖，设计尚无产品复现证据。

## 1C-2 源码对照与验收准备（2026-10-01 18:30）

主checkout HEAD `cfac10dd80dba858fec50e4f43bbd0141fc6acb6`，检查前工作区干净。Sol 1C-1仍在实现，最新游标`dfa67683-bad0-4c3b-90f0-e3c97f2262ab:11`；尚未冻结，不执行其定向测试或并发构建。以下是后续切片准备，不是1C-1代码审查通过或产品缺陷复现。

已对照当前application、graph、desktop源码，确定下一切片的接线与检查点：

- `XRayApplication`构造时加载各库并缓存`current/currentActivation`；现有`getSnapshotState`校验该快照源码与排除策略，不能单独证明另一连接或另一项目未更新激活。新的持久解释worker不得以这两个缓存或单次源码检查作为dispatch/publish许可，须按ADR0007重读权威context及实际数据库激活身份。
- `GraphStore`当前无连接角色参数，迁移到9；`withIgnoreRevision`已用IMMEDIATE事务覆盖兼容库同步写入。后续迁移10须显式区分global/project，复用受锁保护的同步发布思路，不能把await放在事务内或只核对一个库后释放锁再写另一个库。
- desktop当前只有分析queryworker及独立索引/比较worker，构建入口为main/preload/analysis-worker。新增解释worker必须进入实际tsup入口和产物；凭据addon另行声明desktop编译依赖与拷贝路径，不能只在开发Node下验证却遗漏Electron/portable部署。
- 新敏感IPC应校验拥有窗口的顶层sender及本地页面；不能照抄现有只校验payload的普通查询handler。主进程提交context失败时须保持远程关闭，不把旧本地epoch视为权威提交成功。

后续定向验收将使用独立临时数据库和最小自建证据，明确区分注入的网络计数器与真实提供商。必须覆盖：默认denied/unconfigured时fetch计数0；在dispatch前暂停worker后提交context/授权/配置/provider修订，旧请求dispatch计数0；反向顺序的已许可请求报告取消边界；网络等待不持锁；响应后、发布前第二连接改修订或快照激活导致无结果写入；legacy跨库发布锁；A→B→A同源码重激活及worker重启；取消/重复响应至多一次terminal和结果；busy或损坏设置失败关闭；project库无global策略表且旧历史源码不改写；unfinished任务重启只中断不重发。

这组条件等待1C-1契约审查后才派发1C-2，不提前开放跨层修改。当前没有运行产品回归、原生编译或Electron新交互；远程调用、OS凭据和GUI授权仍未验收。此次准备只修改本审查记录与计划的前置说明，不新增AGENTS规则：现有规则及已接受ADR已覆盖，尚无新复现实验支持经验沉淀。

## 1C-1 独立验收（2026-10-01 19:00）

Sol游标`dfa67683-bad0-4c3b-90f0-e3c97f2262ab:13`、idle并明确冻结14文件，HEAD仍fde7b95。独立读取契约、3个实现模块、导出/依赖/锁文件和反馈记录；实际范围与授权一致，index仅重导出、lock仅workspace importer；AGENTS未改动。工作区中主checkout的两份协调文档是审查方上一轮准备，不混入开发成果。

在Sol实际worktree独立运行其最终4条定向验证命令：llm三个测试文件66项通过、contracts三个文件30项通过；两包tsc均exit0。使用单worker及禁止文件并行的Vitest参数，没有native/fullTurbo/build/dist/Electron或实际服务调用。

额外以stdin Node/tsx脚本只解析主checkout的自建Alpha TS样例，调用实际TypeScriptAnalyzer，再传入llm包。首次脚本缺少application通常补充的文件节点，引用闭合检查失败；补充文件节点后，全图54proof触发24proof预算，断言指定动态调用必留失败。独立检查确认省略数量/原因正确，这是审查输入及断言范围问题，不是产品回归失败；没有改变产品或降低其预算/断言。改为当前设计要求的有界CALLS查询，得到5节点/5边/5proof，四条verified调用和15:17–15:27的`selected()` unknown均保持。后续未知引用claim被提升为inferred时整包INVALID_RESPONSE；合法unknown叙述经显式注入Response的协议port校验成功。只有1次本地注入transport调用，实际网络0。身份和source port在内存显式构造，不冒充实际SQLite快照身份或应用端到端验收。

证据片段实际hash/范围、集合裁剪、完整HTTP body预算（含第二层JSON转义）、单请求取消/deadline、失败不读服务端错误body、引用闭合和unknown门禁检查方向符合ADR。接受纯契约/llm切片；OS凭据、项目授权/context及事务、IPC/GUI接线仍待1C-2/1D，真实API兼容性/质量仍外部阻碍，第一批不关闭。

本轮无新增AGENTS规则。开发反馈中第二层转义有复现证据及回归，但完整body预算预防已在ADR要求和测试中落地；其余经验已有规则覆盖。审查脚本失败仅进入本记录。

集成：协调方先提交已审协调记录为`5b87ba3`；Sol idle时ff main的文档/样例，无产品源码冲突；仅14个验收文件提交`5848fe57afd43f65a70264db08341f73503bd8cf`，main ff集成。新文件逐一no-index空白检查通过；没有合并覆盖AGENTS或其他任务目录。

主checkout离线ignore-scripts/frozen-lockfile连接llm workspace后，`pnpm --filter @project-xray/llm --filter @project-xray/contracts test -- --maxWorkers=1 --no-file-parallelism`退出0，两个包仍30+66项通过；此脚本形式将参数置于`--`之后，不额外声称该次运行应用了单worker限制。desktop及ui的`pnpm exec tsc -p <各自tsconfig> --noEmit`均exit0，检查共享导出对既有消费者的类型兼容。未启动Electron或调用真实服务，底层验收边界不变。

下一切片拆为1C-2A graph/application的角色迁移、策略事务、preview/dispatch/publish与定向测试，再审后派1C-2B desktop/原生/IPC接线；接口与sender安全接线前不派Luna功能UI。Luna可并行做第四批现有Windows发布链的只读设计，只有新文档，不构建/安装/改包或业务源码。该设计不解除功能稳定、真实安装操作、签名和用户跳过环境等验收门槛。

## 用户限额暂停后的恢复（2026-10-01）

用户明确此前因五小时限额暂停定时任务和Sol，现在要求重新启动、继续开发验收。实际检查`project-x-ray`为PAUSED，Sol上一回合interrupted/idle、仍HEAD00651a5且保留5个修改/3个新增业务文件；主checkout同HEAD，只有Luna两份新设计文档。没有删除、覆盖或重复实现未完成改动。

通过automation_update更新原任务为ACTIVE，保持15分钟间隔、目标审查聊天及原通知/范围约束；再次读取配置确认ACTIVE。给同一Sol聊天派发原1C-2A续接任务，模型/强度保持GPT-6.1 Sol/medium，要求补第二连接竞态回归、反馈记录并重新实际定向验证，不沿用中断前报告作为交付。wait_threads确认新回合active、已回应从保留改动继续；游标重置后为`b1ebc819-861b-4d28-af5d-5181e0e3533b:2`。

Luna 4A已完整交付且只新增两文档。独立对照package/main与文档，发现设计一致性问题并派回原两文件修订：共存验收写入正式用户数据与隔离约束冲突；所有非Valid签名不能都记为NotSigned，应保留真实枚举Status；后续角色迁移属于1C-2A，主checkout实际仍9，不能写成正在实施1C-2B。此为文档/设计问题，不是产品运行复现。设计尚未接受，未提交该两文件或执行安装/GUI。

此次恢复不扩大范围，不请求/扫描API密钥，不重跑旧GUI宣称新成功；第一批端到端、OS凭据、远程调用仍未验收。没有新增AGENTS规则：恢复是用户调度决定，设计问题按已有数据保护/证据规则修订，无新产品复现经验。

## 4A 修订后独立复审（2026-10-01 22:42）

Luna新交付游标`80fae291-fe1d-4343-9b03-73b87a2fd5a5:2`、idle/两文件冻结。独立读取修订方案与反馈记录并对照主checkout package/main/graph及AGENTS；确认portable与NSIS测试使用同一隔离身份/测试库，正式数据库不作为运行验收输入；签名保留实际Status和单独发布者策略，缺工具/不支持状态未验收；1C-2A计划迁移10与主checkout实际9及1C-2B凭据待接线已区分。

独立只读`[Enum]::GetNames([System.Management.Automation.SignatureStatus])`返回Valid、UnknownError、NotSigned、HashMismatch、NotTrusted、NotSupportedFileFormat、Incompatible；没有访问任何文件签名、证书或凭据。复核[electron-builder v26 NSIS官方参数](https://www.electron.build/v26/docs/nsis/)中oneClick/perMachine配置含义，方向与方案一致；Microsoft枚举网页本轮工具无法打开，枚举存在性使用本机PowerShell类型核对，不声称本轮已联网核验其全部信任语义。

接受4A设计，不执行产品测试、构建、安装、卸载、迁移、OS凭据或Electron操作，不把旧portable记录提升为本轮验收。当前实际范围为Luna两份新文档及协调方两份计划/审查记录；无AGENTS改动。本轮0条新经验，文档一致性问题按现有规则修正，不编造产品复现。

Sol仍active、游标`b1ebc819-861b-4d28-af5d-5181e0e3533b:3`，在补契约/持久化失败路径，尚未冻结。其自测不作为审查方验收，本轮不并发运行该批测试或重型构建。4B安装发布实现仍等待功能稳定，Luna待后端契约/安全接线后再派UI。

## 1C-2A 服务容量中断与重试（2026-10-01 22:57）

最新wait_threads游标`:4`显示Sol回合failed/systemError，错误为“Selected model is at capacity. Please try a different model.”，不是产品测试失败。保留现场：实际worktree现有6修改/4新增文件，尚无冻结交付或独立验收；没有Git写入、丢弃文件、运行该批测试或并发重型构建。

按用户持续开发/恢复授权给同一聊天以原GPT-6.1 Sol/medium重试一次，要求从剩余契约与持久化失败检查续接，不重做实现、不用旧自测代替交付、不擅换模型。随后wait_threads游标`b1ebc819-861b-4d28-af5d-5181e0e3533b:5`确认新回合active；当前尚无本轮冻结结果。容量原因归类环境问题，只进过程记录，不新增AGENTS规则或降低测试门槛。自动任务保持启用，有具体任务进行中，不标完成。

## 1C-2A 持久化失败边界中途审查（2026-10-01 23:12）

wait_threads最新游标`b1ebc819-861b-4d28-af5d-5181e0e3533b:7`仍active。Sol报告其回归复现项目结果提交后权威任务terminal提交失败的未发布记录遗留，正补精确身份清理；这是开发方复现，协调方尚未独立运行该回归或接受本批。

只读检查application start/result/recover与graph事务/补偿代码和故障注入测试：发布路径跨独立连接顺序提交；当前新增catch补偿只在异常能进入catch且finish成功时运行，不能作为异常退出下跨库原子性证明。已向原Sol聊天派发同批边界检查：提交间worker退出、finish/cleanup本身BUSY或失败、固定错误及terminal事件不被finally掩盖、重启不重发且未发布结果读取失败关闭；精确身份清理不得删除completed历史或旧源码。可采用有明确门禁与恢复责任的安全保留策略，不要求扫描其他项目目录，也不扩大桌面/IPC范围。

本轮未修改Sol源码、未并发运行测试/构建/Electron、未合并或提交未验收实现。主checkout只维护计划与审查记录。图事实、远程生产接线、真实GUI及服务调用均未新增验收证据。本轮0条AGENTS规则：已读现有门槛，当前新增异常退出风险仅为代码审查依据，等待复现与修正验证后再判断沉淀。

## 四批后的自主规划与开发授权（2026-10-01晚）

用户澄清四批结束后仍由协调方自行规划与开发，工作流不变。已修改原automation为ACTIVE、保留原15分钟间隔及目标，移除四批完成即暂停条件；后续须基于实际代码/验收/复现/实测形成范围内可审查计划，再派原双线程。主checkout的AGENTS协作约定、计划及晨间交接同步记录该用户授权，不视为产品范围或敏感动作的额外许可。

紧凑状态检查Sol仍在1C-2A修正、Luna正在3A-L只读准备，无冻结新交付；本轮只调整调度/文档，未运行产品测试、GUI或Git收尾。本轮新增工程经验0条；AGENTS增加的是有直接用户请求依据的工作流约定。

## 1C-2B 接线验收准备（2026-10-01 23:29）

Sol游标`:9`仍active，已回应提交间退出、finish/补偿失败检查；Luna游标`:6`仍在追踪索引并核对现有benchmark副作用。均未冻结。本轮读取主checkout实际desktop main/preload/package/tsup以及ADR0007，为下一切片准备验收入口；不修改两条开发聊天的源码、不并发运行其测试或重型检查。

主checkout当前main只创建analysis/query worker，preload只有既有窄API，tsup入口只有main/preload/analysis-worker，build复制Python worker和secure reader。新增解释worker/凭据生产接线尚不存在；不从ADR草案或Sol底层代码推断接线完成。首次文件搜索包含不存在的worker-client路径，已改用实际main中的broker定位；属于审查搜索输入问题，无产品失败结论。

冻结后1C-2B独立验收按以下顺序，最终命令须随实际交付文件确定：

| 边界 | 需要的具体检查 | 当前状态 |
| --- | --- | --- |
| worker/生产组装 | 独立解释worker启动/退出/重启，正常生产仅OS凭据port与固定官方provider；ordinary analysis envelope不增加可注入provider/任意endpoint；输出仅strict协议 | 准备，未实施/验证 |
| sender/owner | 实际顶层本地页面可用；子frame、相似URL/外部来源、其他窗口context/task被拒绝；事件只给owner，关闭窗口阻断迟到结果；不能只用可伪造的renderer字段判归属 | 准备，未实施/验证 |
| context事务顺序 | 既有select/import/retry/cancel/ignore/current路径中，需失效时先关闭main门禁并提交authority，再推进操作；busy/提交失败保持关闭并安全终止解释worker；A→B→A不复活 | 准备，未实施/验证 |
| 凭据双系统失败 | 固定自有测试target和非秘密值验证写/读/删及重启；revision先进入不可调用，OS失败/进程退出不沿用旧configured；不列举或读取生产target；不向renderer、worker消息或日志返回key | 准备，未实施/验证 |
| native/打包 | 同一协调窗口验证Node/Electron目标ABI、worker dist入口与native复制/asar解包，portable只使用本轮当前产物；重用历史路径/截图不算当前证明 | 准备，未实施/验证 |
| 非安全GUI | UI切片接线后真实操作未配置预览/本地解释/证据导航、取消与重试、项目切换和过期状态；授权/凭据敏感操作留用户，不能后台改DB伪造GUI选择 | 准备，未实施/验证 |

后续差异审查须核对main持有global-context控制连接的角色、application读写策略的实际配置、provider同步dispatch与事务边界及凭据只在解释worker短暂读取。跨库提交或OS存储均不能因串行调用就宣称原子；1C-2A当前异常恢复责任须带入接线。

本轮无产品回归、native、安装或真实Electron操作，不新增任何验收通过项。0条新增AGENTS经验，均是已接受设计/已有规则转成执行门槛。1C-2B仍等待1C-2A冻结并接受后另行精确派发。

## 1C-2A 冻结后独立审查退回（2026-10-01 23:44）

Sol游标`b1ebc819-861b-4d28-af5d-5181e0e3533b:11`idle/明确冻结12文件，实际HEAD00651a5；核对7修改/5新增，契约、角色、迁移、事务、应用核心、反馈记录及1条AGENTS经验在授权范围内，无desktop/ui/native/llm/分析器或普通IPC修改。主checkout已有4份协调变更未混入Sol交付。

在Sol实际worktree独立执行记录中的三条exec vitest定向命令（各maxWorkers=1/no-file-parallelism），contracts36、graph30、application83，合计149 passed，均exit0；三包tsc --noEmit也exit0。application本轮46.34秒不外推产品性能。未运行生命周期pretest、native、build、Electron或真实远程。

额外独立stdin Node/tsx脚本，以临时自建TS文件实际indexProject、正常global/project SQLite与策略端口生成context/preview；仅注入非秘密credentials.read挂起Promise和本地provider计数器。start已进入凭据读取但尚未dispatch时，用同owner/context/taskId调用cancel，再解除凭据等待。实际exit0输出：cancelDuringCredentialRead=CONTEXT_CHANGED、dispatchesAfterCancel=1、terminal=completed、productionNetworkCalls=0。根因有代码支持：start已登记running，但cancel只查尚未生成的SQLtask，提前拒绝，没有abort controller。这是后台产品取消缺陷，不是GUI或真实服务验收；脚本初次误用不存在的indexLocalProject导致TypeError，核对实际indexProject后重跑，该初次错误是审查脚本问题。

已向原Sol聊天派发明确修正：凭据与dispatch前workspace检查等待期间均可被合法owner取消，迟到解挂后dispatch0/无结果/无completed，返回与terminal语义一致且至多一次；跨owner/旧handle/未知task保持拒绝，不提前登记许可或伪造dispatched，不扩展desktop/UI。需要修正后新回归/类型/记录及冻结，不以149通过覆盖这个失败。本批不接受、不提交或集成，1C-2B仍待审。

交付的跨库经验有延迟约束/真实SQLite及故障注入依据，适用动作与既有锁规则不同；等待整个切片修正验收后逐条集成，不直接覆盖主checkout AGENTS。当前取消新缺陷尚未修正验证，暂不新增经验规则。真实Electron、OS凭据、生产body适配与实际服务仍未验收。

## 3A-L 只读设计独立复审（2026-10-01晚）

Luna游标`80fae291-fe1d-4343-9b03-73b87a2fd5a5:9`idle并交付两文件。完整读取设计/过程记录，对照主checkout实际indexProject、main/preload/worker/build、Python子进程、canonicalSnapshotResult/Content、Git HEAD读取及benchmarks/run.ts；确认当前每次全量分析与持久快照复用有区别，冷库不等于OS缓存清空，Git双方和真实GUI另列门槛。现有benchmark确有共享清理/外部克隆/报告覆盖，不运行它验证性能。规范化不忽略稳定节点身份、语义边原因/置信度/范围/健康配置；独立冷库对照需固定同根和样例内容。

逐一对新增两文件运行no-index空白诊断，无错误（exit1表示新文件差异，仅CRLF提示），tracked diff检查通过。工具记录中的部分rg非0不作为产品失败；未运行产品测试/基准/GUI或触碰Sol工作区。接受文档准备，性能收益及增量实现仍未验收；本批0条AGENTS工程经验。下一步可派Luna独立隔离基线工具，普通小样例仅验证工具行为，规模测量及优化仍需共享实现稳定和协调窗口。

Git收尾仅主checkout的6份已审文档/用户授权约定：commit `e3b870337dfe28b2730d92ab1cd7bc26ddedf2cf`，origin/main普通push成功，ls-remote确认同SHA；没有提交或合并Sol未验收实现。无业务源码变化，不运行GUI来替代文档复审。

按接受设计已派Luna 3B-L四个独立新增文件：local-index-baseline入口/child/test与记录；严格参数/唯一输出/owned目录边界、超时取消终止子进程、事实和源码等价门禁、有来源的阶段/NodeRSS数据，零网络/外部仓库执行/新增依赖，不修改共享产品或跑规模heavy。Sol已进入取消修正新回合，最新已检查cursor`:12`active；已告知main文档基线，暂不合并到其正在编辑的worktree。

## 第二批所有权评价只读验收准备（2026-10-02凌晨）

本轮Sol取消修正与Luna基线工具均active，最新紧凑游标分别`:14`与`:12`，无新冻结交付。未运行两批正在修改的回归、构建或Electron。只读核对主checkout现有ownership/contracts/application/graph、analysis-worker与OwnershipWorkspace及会话状态，未派发第二批实现，原接口稳定前置继续成立。

实际现状：Question版本2.0.0、Scoring版本2.1.0；grade契约只允许semantic.status=not-evaluated。gradeAnswer分别检查确定性定位与结构并明确不评自由文本；application核验当前快照、保存源码引用与排除配置修订，在事务门禁后追加ownership_attempts，通过后移除内存题，失败可重试。概念当前通过依赖当前快照非legacy尝试的passed；跨快照历史保留而需重新验证。worker下发题面时去掉evidenceIds/expectedNodeIds/deterministicChecks；现有UI在提交后才显示评分和揭示证据，并硬编码“自由文本语义未评估”。这些是本轮代码阅读结果，不是重新执行的回归或GUI验收。

后续ADR/切片需先明确独立语义状态、rubric/评分/任务/尝试身份和追加关系，不能仅给现有semantic字面量增值便将旧确定性passed升级为语义掌握。已落库的本地结构尝试与异步评价的取消、失败、重试、迟到结果必须有明确关联和幂等终态；模型不可用仍保持原离线答题路径。准备的验收矩阵：定位/结构分数在相同答案下不受模型改变；错误结构或缺有效引用不能被流畅解释补偿；历史与legacy不自动升级；新题提交前不泄漏内部答案；提交后证据可导航；A→B→A、源码/配置/授权/凭据修订变化拒绝旧任务结果；取消及重试不重复追加；无密钥时语义未评估且可继续本地训练。rubric金标、测试替身、真实Electron和真实远程分别登记，不能互相替代。

本轮仅补充代码依据与验收准备，无产品修改、测试/性能/GUI新结果，无新增AGENTS经验。首次查找不存在的OwnershipPage文件是审查检索路径错误，已用rg --files定位实际components/OwnershipWorkspace，不作为产品缺陷记录或派发。

## 电脑操作预检阻碍（2026-10-02凌晨）

本轮重新核对computer-use技能及guidance/api/confirmations，再按技能规定通过node_repl初始化@oai/sky。首次js调用返回failed to write kernel assets: 系统找不到指定的路径。(os error 3)。js_reset返回kernel reset，随后相同初始化仍返回同错误。未获得窗口状态、未操作真实Electron，不能据此判断锁屏或产品故障；这是当前操作工具初始化失败。没有改系统/安全配置、安装工具、执行自制helper或其他UI自动化替代。

新阻碍已通知一次，晨间交接保留GUI未验收。两开发批次继续；独立代码、回归及纯工具验收仍可推进，界面实现不以通过测试冒充完成。当前没有新的已冻结交付，无新增AGENTS规则；临时且尚无稳定解决方式的环境错误只保留过程记录。

## 1C-2A 取消修正独立复验与集成（2026-10-02 00:30–00:35）

Sol最新游标`:18`idle/原12文件重新冻结，实际00651a5基线。核对身份、角色迁移、preparing仅瞬态、取消事务与abort、迟到拒绝观察、补偿门禁及记录；取消时先校验同owner/context/epoch/完整身份，合法取消先中断本地controller再记无许可无占用的cancelled，重复调用返回同终态。未加入desktop/UI/网络默认端口或秘密持久化。

在该worktree重新运行前次三条完整exec vitest定向命令，contracts37、graph30、application94，11文件共161 passed/exit0/无skip；contracts/graph/application三包tsc均exit0。独立stdin Node/tsx脚本分别使用新的自建单文件项目、实际indexProject、真实全局/项目SQLite及正常策略端口，阻塞凭据或第二次getSnapshotState；在preparing时取消并在解除等待前等待start终态，解除等待后核对迟到效果。两点都cancelled/terminal cancelled、重复cancel稳定、dispatches0、结果null、真实网络0。临时目录仅在解析绝对路径并确认自己新建ostmp边界后清理；不操作用户项目或真实凭据。此脚本未复制开发断言文件，也不是GUI授权或OS存储验证。

仅对应12文件暂存核对后协调方在Sol提交`56652454f5216502bc0b0e4b4f6cbc1b35d73c06`，main以普通非快进合并为`32dbae85f926faa302ff74186120d253cc0a4890`。AGENTS三方合并逐条核对：新增1条已有真实双库延迟约束/补偿/恢复证据的经验，保留main已有用户自主规划约定与其余规则；取消问题已被现有任务取消要求覆盖，本次不另添规则。三个协调文档及Luna四个工具文件均保留，未混入实现提交。

main缺少新application→llm内部workspace链接，执行`pnpm install --offline --ignore-scripts --frozen-lockfile --filter @project-xray/application...`exit0，仅链接既有依赖，不联网、不运行生命周期/native。集成后remote定向contracts24、graph14、application55，共93 passed/exit0；contracts/graph/application/desktop/ui五包tsc均exit0。未运行build/native/dist/真实Electron/提供商调用。接受的是后台核心，第一批端到端仍开放。

Sol干净worktree由协调方ff对齐main 32dbae8后，已派1C-2B-1生产body桥接与strict desktop/worker协议，精确范围见计划与原聊天消息；1C-2B-2及Luna UI仍按接口稳定顺序。尚未推送时不把本节版本当远程版本；实际Git收尾另记。

## 3B-L 基线工具独立审查退回（2026-10-02 00:39–00:42）

Luna游标`:18`idle、原4新增文件冻结；完整核对runner/child/test与反馈记录。独立exec vitest该工具7 passed/exit0，实际一次小样例smoke completed/validPairCount1，runId`4e59a3a0-5592-4ba4-9ca4-31e1c6b4d4ae`，11门禁true，冷392.0603ms/warm284.9392ms。这只是集成后小样例普通索引API自检，不是增量收益或GUI。

额外真实child取消复现：正常新建owned invocation/run目录，spawn固定child，在首次cold progress之后发送限定stdin取消消息；runId`134c6777-5f14-49b0-aec6-2940c37597de`，收到cancelled/CANCELLED，但终态后800ms仍未close，需对本脚本创建的PID用taskkill /T /F才关闭。已确认根因：measureIndex启动RSS setInterval，仅成功返回时finish清理，indexProject抛错/取消路径遗漏；普通成功smoke与玩具进程取消测试未覆盖真实采样生命周期。只终止自建进程树，无目录删除。

另一独立协议复现：复制自己正常smoke的summary，仅将canonicalFactsEqual=false，保留passed=true；自建Node child仅打印该completed/OK协议消息。runControlledChild返回exit0/closed true、protocolError null、completed/passed true/check false。父边界接受矛盾门禁，runBaseline目前可把这样的报告计为有效。纯测试协议数据，不是生产远程替身或用户项目运行。

已向原Luna派原四文件内明确修正：成功/失败/取消均释放采样资源，真实child终态后可自行close；父边界校验固定必需11检查、passed/failureCodes/terminal逻辑一致，缺项/false/矛盾均拒绝并不计validPair。补实际child取消/失败及协议回归，旧7项不替代新复验；不扩展参数/依赖或修改产品，保持协调文档与原文件。工具未接受、未暂存/提交；候选经验等修正证据后评估，不因本次失败先增加规则。

实际Git收尾：三个已审协调文档以`bf2ed806dadf395bb594cd269f4bba8995220864`提交；再次核对origin为deeplearner-ui/project-x-ray，普通push main exit0，ls-remote确认origin/main同SHA。该版本包含已接受后台实现5665245/集成32dbae8及审查记录，Luna四文件未提交并保留。GUI与真实提供商未执行，不因Git成功关闭相关验收。

自动跟进维护：核对同一project-x-ray任务配置后，通过automation_update仅将过期阶段/固定cursor段改为读取当前计划、最新审查及实际聊天/Git；移除已接受1C-2A仍待修的旧说明。保持原任务、双线程、ACTIVE、15分钟间隔、目标审查聊天及静默通知边界，无新增定时器或授权扩展；已记录工具阻碍仅有恢复迹象才重试，不周期重复通知。工具返回update/ACTIVE，读取配置确认新队列指令生效、过期核心状态移除。这是协调维护，不是开发交付、GUI验证或AGENTS工程经验。

2B-1依赖范围补充：紧凑状态指出desktop缺llm声明；只读核对Sol实际remote-provider.ts直接导入llm、desktop/package.json仅有application/contracts等，确认不能依赖传递链接作为生产依赖。已向原Sol批准只追加desktop/package的既有llm workspace依赖及lock对应importer，自己的checkout可offline/ignore-scripts链接；不增加runtime/SDK，不提前加node-gyp/native或改其他接线。没有运行正在编辑批次的回归、合并或新增验收通过；原两批仍实现/修正中。该必要依赖声明及协作决定不作为AGENTS经验。

## 3B-L 修正独立复验（2026-10-02 01:09–01:11）

Luna最新游标`:22`idle/原四文件冻结；实际main基线bf2ed80，只有该四新增文件与协调方三文档变化。复核measureIndex无条件finally清理RSS interval、finish幂等；父边界严格核验固定11布尔门禁、failureCodes/总passed/terminal一致性，只有正常exit0且未强停、无协议错误的completed/OK计有效样本。修改未触及产品模块、package/lock或AGENTS。

独立运行`pnpm exec vitest run benchmarks/local-index-baseline.test.ts --maxWorkers=1 --no-file-parallelism`：9 passed、exit0，无skip。独立小样例`pnpm exec tsx benchmarks/local-index-baseline.ts --runs 1 --timeout-ms 60000`：runId`d813afc9-4376-46f5-ac48-6d92361d668f`，completed/validPairCount1，11门禁全true；15节点、28/28证据实际读取及cold/warm导航摘要一致。冷395.7006ms、无变化全量reindex262.4114ms仅一次三文件混合TS/Python工具smoke，不能外推性能或声称增量收益，Node RSS不含Python。

另用独立stdin脚本直接spawn真实索引child、首次cold progress发送限定cancel：runId`6291dd16-9b27-4d65-82a9-5f1f5eb76176`，cancelled/CANCELLED、exit0、终态后800ms内自行close，未使用强制清理。将本轮正常报告的canonicalFactsEqual单独改false、passed仍true，通过自建Node协议child送入父边界：CHILD_PROTOCOL_INVALID、terminal未保留、isCompletedChildRun=false，closed/exit0，不计有效样本。仅测试协议/自建样例，无网络、外部项目执行、目录删除或真实GUI。

接受3B-L工具切片，首个失败复现与修正门槛已关闭；规模样本/环境、重启查询、增量算法及GUI仍待后续。开发记录真实区分产品缺陷与测试/环境；本轮AGENTS 0条，资源清理、运行边界和充分回归已被既有规则覆盖，不重复新增。仅对应已验收文件可Git收尾，具体版本在实际动作后记录。

Sol最新游标`:23`idle，1C-2B-1冻结11文件，仍基线32dbae8；下一步核对实际差异、协议与同步dispatch/正文摘要，并独立运行回归。开发方203测试/类型结果尚未提升为协调验收；没有提前派2B-2或UI。

## 1C-2B-1 独立验收与集成（2026-10-02 03:31–03:36）

读取实际11文件清单、共享builder/provider与strict协议、对应回归及反馈记录，核对AGENTS/接受ADR0007。生产body含instructions、input、store:false、stream:false、text.format/schema和输出上限，摘要为完整UTF-8正文SHA256，prepare零凭据/零网络，dispatch到平台fetch前无await。factory不接配置、endpoint固定HTTPS且redirect:error；返回已验证narrative给application，异常重新构造固定枚举错误。独立内外协议不等于IPC接线；纯事件守卫必须由未来broker传入已登记句柄和实际前一事件，不能以有效DTO替代窗口授权。

在冻结worktree逐条运行记录内四个vitest命令：llm76、contracts55、desktop17、application55，共203 passed/exit0、无skip。五包llm/contracts/application/desktop/ui逐条tsc --noEmit均exit0。独立stdin脚本以新自建两函数TS项目、实际indexProject/SQLite和生产factory，明确替换平台fetch而非真实调用：prepare calls0，许可dispatch→fetch→return顺序同步，一次dispatch，完整正文摘要等于实际预览，预算/store:false/官方端点与redirect门槛通过；结果可读、claim inferred；实际事件dispatched→completed可接收，重复terminal/不同owner/错query回包均拒绝。真实网络/OS凭据0，临时自建目录保留，不执行用户项目代码。

11文件单独暂存/check后协调方提交`0cdc68355cd211ad0da932c7493eb48ea8051eb4`，main普通无冲突合并`8e99f82e9b9e5628a18f63b9287ff95afb4dd4f4`。仅已有desktop→llm workspace新增声明与lock三行；main offline/ignore-scripts/frozen-lockfile只链接既有依赖。集成后desktop17+contracts18+llm37共72项、contracts/desktop/ui三包类型全部通过。未构建native/Electron/UI，真实服务兼容与质量未验收。接受的是桥接/协议切片，不关闭第一批端到端门。

本轮AGENTS 0条：依赖、边界校验与安全异常已有规则；不同库写入时间不属于任务身份的具体协议兼容性已有精确回归和记录，不加重复通用条目。Luna工具及三份协调文档已提交`a4c688626c3cea76993e87dff0a2ce0e11d6cd2b`并普通推送，ls-remote同SHA；该Git事实独立于Sol本节尚待推送版本。

下一切片按接受ADR拆为2B-2A窄原生凭据模块/适配器，2B-2B随后安全接线，范围与门槛见计划；先将干净Sol worktree对齐实际集成基线，再派发。没有把未接线协议交给Luna做空控件，Luna待该门禁稳定；当前具体队列仍可推进，不暂停自动跟进。

实际Git/派发收尾：三个协调文档提交`a50d7ab2e13dd463ed9e1c0b8348dc1c9925b589`后普通push成功，ls-remote确认origin/main同SHA；main干净，Sol已从0cdc683干净ff对齐a50d7ab。已派原Sol聊天2B-2A精确12文件与门槛，纯TS/脚本先冻结，重型原生及真实运行由协调方统一安排；最新紧凑游标`b1ebc819-861b-4d28-af5d-5181e0e3533b:24`active，已确认开始核对/实现。Luna收到工具验收反馈，游标`80fae291-fe1d-4343-9b03-73b87a2fd5a5:23`idle，等待安全接线后的UI具体任务，不并行修改Sol共享范围。未因等待UI制造无依据任务；自动跟进继续处理真实队列。

## 2B-2A 独立验收运行时准备（2026-10-02 03:45）

先读当前队列/审查/交接和AGENTS相关安全、原生生命周期、经验门槛，再紧凑检查Sol`:25`active、Luna`:23`idle；尚无新冻结交付，不并发跑该批测试/native/build/Electron。main实际HEAD`2852b7d2e56eb3f4a51ae2a0937e04a7b8d15ea5`且本轮开始干净；旧接受结果未重复测试或通知。

只读核对既有analyzer-core构建/binding与desktop package/tsup：已有secure_reader保持独立文件职责和NAPI_VERSION=8；desktop现有build先tsup(clean)，再copy Python/secure reader，因此未来凭据产物copy也须在clean之后核验，不能用旧dist文件作成功证据。当前待实现2B-2A不改tsup/main，完整生产打包接线和portable仍归2B-2B/发布验收。

独立Node只读运行时检查：实际Node v24.17.0、modules ABI137、NAPI10、win32/x64；从desktop既有直接依赖读取Electron package44.4.3，从analyzer-core既有声明读取node-gyp12.4.0。固定header cache位置只检查node_api.h存在：Node头文件有缓存、该Electron版本头文件未见缓存；vswhere限定VC工具查询返回安装版本18.9.12120.119。没有编译、安装或下载，也未读取敏感环境/凭据；Electron package版本不是本轮运行中Electron版本，头文件缓存状态也不是兼容性/阻碍结论。

冻结后独立门：核对双编译target固定且测试variant不进入生产copy；TS/native UTF-8与控制字符双层拒绝，native buffer/CredFree全路径清理，缺模块固定unavailable；先纯回归再在单协调窗口编译，Node与实际Electron分别只对独立固定test target执行持久重开/读写删除与失败检查，产物记录摘要/版本而无秘密。不访问生产target、不用测试替身代替OS、不把运行时smoke当真实GUI或真实提供商验收。当前无产品变更、新测试/GUI结果或AGENTS新增；已记录computer-use初始化阻碍没有恢复迹象，本轮不重复尝试或通知。

## 1D UI 接线前独立验收准备（2026-10-02 04:00）

Sol`:26`仍active，未冻结；开发方自行指出误重跑上批provider/真实索引测试超出本批纯TS/脚本窗口，已停止扩跑并准备在本批记录单列。协调方不将此自测当凭据/native验收，也不并发运行该批检查。Luna`:23`仍idle，保持UI依赖门。只读主checkout的App、实际FeatureExplanationWorkspace/测试及ownership-sessions，无业务改动。

代码依据：现有FeatureExplanationWorkspace的离线generation通过runWorkspaceRequest存于App级页面会话，按设计跨页面保留；卸载只失效挂起的源码导航。App.navigateTo现在同步更改页面并清空活动source；installProject使用repository/snapshot和本地generation，workspace stale/重新激活也只管理离线页面数据。它们尚无远程context或task接线；这是现有离线行为，不作为当前产品缺陷。新增远程流程不能直接套用这种跨页持续生成语义，ADR0007要求离开解释context/切换/索引/配置操作经main权威提交失效旧远程任务。

后续1D需验证以下不同于现有离线测试的路径，精确文件清单待2B-2B安全API冻结后再派发：

| 路径 | 预期与验证边界 |
| --- | --- |
| 页面首次进入、输入/修改查询、prepare预览 | 不发模型请求；无current校验、未配置或未授权时状态明确。预览包含六类外发数据、实际片段/范围、摘要、遗漏/unknown、预算和供应商状态；修改问题不能误发送旧预览。 |
| 用户显式start、挂起期间重复start/cancel | 使用已返回main句柄及context，先登记再接事件；一个明确请求一次派发，不自动重试。取消preparing与dispatched分别展示真实状态，不保证退款/服务端停止。 |
| explain→其他页面、项目A→B→A、同snapshot重新激活 | 本地阅读/离线结果可按既有规则保留；远程新start与旧事件先封闭，main权威epoch提交结果决定能否重开。不能因为ref或旧页面会话相同而接收旧context结果。失效提交失败保持不可调用，不假报切换成功。 |
| 源码/排除配置/授权/provider/凭据修订变化，迟到结果 | 任务和预览身份失效，旧结果不能以current显示；校验不可用区别于stale。新增远程数据不复用旧generation channel或用页卸载作为权威取消屏障。 |
| 已完成叙述及引用源码 | 明示remote来源，叙述只inferred/unknown，引用证据本身的verified语义保留；准确repository/snapshot/evidence/span导航，迟到source读取不能覆盖当前选择。保留旧快照阅读限制，不假称真实运行路径。 |
| 无密钥、供应商失败及恢复 | 离线追踪保持可用，状态/错误固定且无响应正文/秘密；密钥不进入页面会话、存储或重试数据，提交后清空输入。真实安全/隐私授权和密钥录入由用户操作，协调方不能绕过控件伪造GUI验收。 |

现有八类组件测试覆盖离线重复提交、查询对应、失败重试、unknown位置、错快照、精确导航、禁用状态与跨页恢复，但不是以上远程矩阵的通过证据。本轮未跑它们、未建静态UI控件/测试替身生产入口，也没有电脑操作恢复迹象。第一次读取时猜错组件/类型文件名，随即按rg实际文件定位；这是检索错误，非产品缺陷或规则沉淀依据。准备记录与当前队列相符，本轮无新AGENTS规则，无重复通知。

## 2B-2A 原生独立审查与退回（2026-10-02 04:15–04:26）

Sol冻结于a50d7ab基线，紧凑游标`:27`idle；Luna`:23`idle。逐个核对12文件、AGENTS、native C++/binding、适配器、四工具与39个纯回归；main HEAD2852b7d，只有前两节协调记录未提交。production/test是两个编译期固定target，模块初始化不调用凭据，禁止枚举/任意target/环境秘密/SQLite回退；Win32分配与临时字节有清零/CredFree，状态仅configured。锁文件与已有test值保护、精确匹配清理已审。开发方报告的误跑旧provider范围偏差未计为本批原生验收。

协调方独立命令与实际结果（worktree执行，纯测试在apps/desktop）：

```text
node ../../node_modules/vitest/vitest.mjs run src/windows-credentials.test.ts src/windows-credentials-scripts.test.ts --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit
node apps/desktop/scripts/build-credentials.cjs
node apps/desktop/scripts/credentials-smoke.cjs
node apps/desktop/scripts/credentials-electron-smoke.cjs
node apps/desktop/scripts/copy-credentials.cjs
```

39项/2文件通过无skip，两包类型exit0；确认native目录非联接后实际编译exit0。Node v24.17.0的真实Windows固定test target：ASCII、中文/emoji、2048字节三种写读及各自重启子进程、非法编码/控制字符/超长拒绝、删除/重复删除全部exit0。额外直接native验证status/read/remove带额外参数、非Buffer和多参数write返回invalid，target最终missing、锁文件不存在。未调用production target任何凭据操作。

copy exit0，只加载production模块初始化元数据；production源/目标SHA256均96c8ee0afce3c7baa5e6aeeeee0b14e34bf843690566fc9ca4a185ad49488505，test为7d16d5a2d9cbd1056393304ca479a16287743d54ffa40b10e67eee05589cfe8e。dist/native含既有secure_reader与新production模块，无test模块。不是完整desktop/portable打包验证。

退回三项已确认工具问题：

- `git ls-files --others --exclude-standard apps/desktop/native`实际暴露build中的sln/config.gypi/vcxproj/filters生成文件。允许第13文件根.gitignore精准追加新native/build与必要自有lock条目，不删除构建目录、不提交生成文件。
- 原Electron launcher调用require("electron")，package index在缺binary时实际输出Downloading Electron binary并用无超时spawnSync运行install.js，120秒只覆盖后面的Electron。运行时随后下载就绪，未发送项目/凭据；工具应改为固定声明package安装目录的已存在版本/边界/exe校验，缺失固定失败，不隐式下载、不接受环境覆盖。
- 原Electron命令进入后120秒超时exit1；固定本地exe直接同脚本--run的独立20秒调用也ETIMEDOUT、stdout仅空行、stderr空。通用.cjs在app.whenReady后退出成功，实测Electron44.4.3/Node24.21.0/NAPI10。仅main分支等待ready的隔离包装仍失败，因为verify子分支仍提前执行/退出；main和全部verify均在ready后调用原credentialSmoke，实际3次重启/全部OS检查exit0（ALL_READY_TEST_TARGET_OK，<1秒）。因此当前根因是入口生命周期，非未确认的native ABI推测。独立包装只在ignored .benchmarks，未替换交付脚本；试验性.js探针因仓库ESM规则require不可用失败，属于诊断探针错误，不是产品缺陷，未作为通过证据。

已向原Sol派三项复现、预期、13文件边界与对照结果，开发方只修改/纯回归，不并发native/OS/Electron；根协调窗口已结束。最新Sol`:28`active修正，Luna`:23`idle；2B-2B与UI门仍未打开。不提交本批实现。Electron原工具修正版尚待冻结后原命令复验；本轮独立Electron技术smoke不是电脑操作/GUI，真实服务/生产凭据/IPC/UI仍未验收。现有电脑操作阻碍无恢复迹象，不重复通知。

AGENTS目前0条改动：编码、固定诊断、原生运行时验证已有规则；新生命周期问题已实际对照，可在修复与复验闭环后再评估适用/查重/具体动作，不能以退回状态提前写完成。队列与晨间交接同步保留通过和失败边界。

## 2B-2A 第二轮复验与入口诊断纠正（2026-10-02 04:45–04:49）

main为f72f58cdbe7bc90b5fa17f9251d5fd0fa279cf55、干净；上轮三个协调文档普通push成功且ls-remote同SHA，不含未验收实现。Sol`:33`idle、13文件统一冻结，HEAD仍a50d7ab；逐个核对新的.gitignore、localElectron固定安装元数据/版本/路径检查、异步ready与异常退出、测试及反馈记录，无AGENTS改动。没有改普通build/main/UI。

同两文件vitest独立53 passed、无skip，两包tsc均exit0；真实check-ignore四路径命中精准新规则，native未跟踪只剩binding.gyp和cc。原`node apps/desktop/scripts/credentials-electron-smoke.cjs`仍挂起且没有测试lock。copy原命令exit0。为避免继续等无效窗口，核对本轮launcher/子Electron的PID父子关系和命令归属后停止仅本轮Electron及其子进程，launcher固定失败exit1；未终止用户其他应用。

新的实际入口探针：在ignored .benchmarks自建.cjs打印布尔与运行时，不触碰凭据；Electron44.4.3返回`mainEqualsModule:false,hasMain:true`，whenReady后exit0。因此交付脚本末尾`if (require.main === module)`被DefaultApp加载方式跳过，main和verify都没有调用runElectronSmoke。不能将没有执行检查的120秒挂起当native或OS失败。

纠正上一节的因果判断：早先成功wrapper同时无条件调用入口和等待ready，失败的子分支仍沿用旧main guard，未独立隔离ready变量；“只包主ready仍失败故子ready是根因”过强。保留这个历史判断及本节更正，不把它当已证明的单一根因，也不新增相应AGENTS经验。当前已独立确认的是CLI guard不兼容实际Electron入口，共用whenReady仍是修正版的时序设计与纯回归。

进一步对照：独立.cjs无条件调用修正版导出runElectronSmoke，传入原credentialSmoke并仅将固定verify childScript指向同wrapper。实际44.4.3主流程和三个verify完整通过exit0、CREDENTIAL_ELECTRON_SMOKE_OK，约1秒；测试target最终missing、lock不存在。没有production target操作/真实网络。此验证证明导出流程与native可运行，不能替代最终原CLI命令，不能声称UI已验收。

已退回原Sol相同13文件：以可信process.argv[1]与脚本自身规范化身份明确识别Electron CLI，Node可保留main guard；不得仅凭process.versions.electron自动运行，因为其他Electron应用require时必须零OS操作。增加DefaultApp/main不等、显式main及verify入口、被其他app/Node导入不运行回归；保留固定本地exe、无下载/环境覆盖、ready/timeout/固定诊断。纯回归后重新冻结，实际运行继续只有根协调窗口。Luna仍待安全接线，不下发空UI。

本轮无AGENTS新增，具体入口兼容性先完成原命令复验再评估通用性/查重。队列与交接保留未验收；未提交或合并该实现，已有GUI工具阻碍无恢复迹象，不重复通知。

并行准备依据：只读核对ADR0006、现有ownership生成/评分、contracts的semantic not-evaluated与ownership-training真实TS/Python源码。第二批语义实现仍等接口/隐私稳定；其静态语料验收准备不依赖远程IPC，可由Luna只新增三个文件，范围/门槛写入计划2A-L。不改分析器、源码、评分或已接受ADR，不以词语相似度或未来建议等级改写当前离线行为。检索时一次Windows rg literal glob失败后改用确切ADR路径，是检索问题，不是产品缺陷/AGENTS依据。此安排有明确代码依据，不用空UI填充等待。

## 2B-2A 第三轮接受及集成复验（2026-10-02 04:54–04:56）

Sol`:37`idle、13文件重新冻结。核对真实Electron入口规范化argv[1]/realpath/Windows大小写判断，被其他应用require不触发；真实cjs顶层VM回归保留main不等、四子分支/Node import与无效路径，开发记录已纠正ready因果。独立61项两文件无skip、desktop/contracts类型exit0；最终原`node apps/desktop/scripts/credentials-electron-smoke.cjs`exit0，CREDENTIAL_ELECTRON_SMOKE_OK，约1秒，test target missing/锁不存在。此轮接受原CLI，不借wrapper/历史成功。

仅显式暂存13文件，staged diff/check/清单通过，协调方在Sol worktree提交556e9f214a7bcd163dd353471e0c0d8abb795802；main无冲突合并a09be86a5ee30f2a63fadc82eea411fb45b636b7。未将生成目录或其他文件提交，Luna新静态语料与共享范围分离且保留。无AGENTS改动，既有安全/运行时要求与当前具体回归已覆盖；不沉淀未隔离的ready归因。

main集成窗口执行pnpm install --offline --ignore-scripts --frozen-lockfile，仅链接既有声明；新native实际编译exit0。独立同61项/desktop与ui类型exit0；main原Node smoke、Electron smoke、production copy均exit0。test target missing/锁不存在，dist无test模块，production源/目标字节一致，main新构建SHA256 c1363945e0060aa7fbbbdf9ade1247e2e524639f1a1db325a6f9f2d099c112fe；不同checkout独立构建的hash不要求相同，不冒称可重复构建。全程没有production凭据操作/真实网络，没有GUI。普通desktop完整build/portable与1E仍开放。

2A-L已发原Luna，只新增计划三文件；下一步Sol在干净worktree对齐实际main后实施已接受ADR0007的2B-2B，先说明具体文件/验证顺序，不自行Git或运行未经协调的native/build/Electron。新增XRayApi必需字段需要保持实际apps/ui/src/main.tsx preview与App.test.tsx桩类型兼容，只能窄声明补齐，不能提前实现1D或创建生产mock；该兼容边界来自真实rg用例。全部生产接口稳定进入main后才能派远程UI。实际推送及对齐状态在完成后登记，不能提前写成功。

实际Git/调度收尾：协调文档455d4ad50830ee2495b70927e51caf830a4efbb8普通push成功，ls-remote同SHA；包含已验收native与上述记录，无公开二进制。Sol干净worktree从556e9f2 ff对齐455d4ad后已派2B-2B完整门槛与文件边界，`:38`active；Luna`:24`active仅语料准备，main在其只读期间进展到455d4ad，已明确告知差异不涉及其源码/目标并授权新基线继续。两开发任务无共享写文件，heavy窗口当前已结束。后续最近状态以实际队列/交付为准；当前仍无远程UI和GUI接受证据。

最终公共规则评估：开发方本轮0条提议保留为其交付判断；协调方在原CLI最终通过后新增1条Node/Electron验收CLI入口经验。依据是实际DefaultApp main不等、原命令被跳过、explicit argv匹配修复/真实顶层回归和最终原命令通过；适用于后续双运行时验收工具，动作是入口身份匹配、导入无副作用及原命令/verify验收。现有native运行时规则没有覆盖CLI自动执行身份，也不能由wrapper证明，因此不重复；只收录已确认guard，不把未隔离ready推断转成规则，附本批及独立记录链接。未改变用户授权/产品范围/门禁。

## 2A-L 首轮独立语料审查（2026-10-02 05:03–05:11）

main HEAD为0b72c7a477b8f5a0dfd2e474aeb852d2aaeda8ed，初始无tracked差异，未跟踪仅Luna的原三文件。Luna游标`:27`明确冻结交付；Sol`:41`继续2B-2B实现，已先在自己worktree记录精确文件与验证顺序，尚无稳定交付，不在其同批运行检查。首次跨目录读取Luna记录用错worktree，及检索猜错contracts/测试文件名，立即按真实路径更正；均为审查检索错误，不是产品缺陷或工程经验。

独立只读JSON/源码核对：11个case ID唯一、14个半开源码范围与摘录全部匹配，3个操作场景明确仅未来未评估要求。逐例核对ADR0006、当前contracts及ownership/application，不把未来rubric建议当已接受契约。随后在ignored `.benchmarks/ownership-semantic-review-20261002-0503`创建协调方独有项目副本、SQLite与probe，执行：

```text
node_modules/.bin/tsx.CMD .benchmarks/ownership-semantic-review-20261002-0503/probe.ts
```

exit0；真实indexProject为ready，持久化5个sourceFiles，未执行导入项目代码、未改既有fixture。按当前真实节点、角色相关边及证据动态物化，10个有效答题变体（含同义2个）经application完整评分与语料离线预期相符，所有semantic均not-evaluated；无引用经真实schema拒绝，没有伪造合法grade输入；duplicate经application去重为1。仅在协调方副本新增标记文件生成实际第二快照，将其真实snapshotId代入旧题提交，gradeAnswer在评分前拒绝快照不匹配。此项是直接grader身份门，不冒称跨快照GUI或完整worker流程。

发现并退回原三文件内的物化说明问题：写入锚点同时存在DEFINES/WRITES，返回锚点同时存在READS/RETURNS，按范围盲取唯一evidence不成立；需要按角色及相关边绑定，read/return同范围展开不同evidenceId/citationIndex。变量题必需证据是角色边，不能把背景调用/导入描述成确定性评分必需项；实际只用3项角色引用即可location/structure100。10个有精确证据的锚点中9个相关事实verified，方法调用锚点为unknown；未来解释不能把方法解析、参数字符串类型或总与原值不同当静态证明。4个定义名/函数体背景锚点没有精确同范围证据，应按用途区分背景/合法相交引用：错位置例用真实handleLogin的DEFINES证据关联合法相交范围，实际引用有效但call-direction location0/structure100；不能用任意相交证据替代CALLS。没有修改图事实或降级分析器。

已向Luna派明确定向修订、复现、预期及原三文件边界，完成只读再验证后重新冻结；本批尚未接受/提交。probe按题目角色筛选真实证据以验证离线行为，不是新增产品loader，其成功不能掩盖交付物绑定说明缺口。未调用模型、production凭据或GUI；3个取消/无模型/无效语义输出场景仍仅建议，模型质量门未打开。AGENTS本轮无新增：相关证据种类、静态unknown和语义未评估已在现有规则覆盖，语料修正记录由开发方维护。队列及交接同步为修正中。

## 2B-2B 最小页面撤销边界（2026-10-02 05:18）

紧凑状态Sol`:42`提出实际接线缺口：主进程无法观察React内部切页，原UI文件范围只能类型兼容。独立查看App现有navigateTo、installProject的transition/项目generation及卸载，确有必要传递页面离开通知。协调方明确允许在原worktree追加App.tsx最小撤销及已允许App.test.tsx定向回归，先记录清单；无需用户再次规划许可。无控件、授权、凭据或1D状态，不以通知替代权威数据库线性化。要求快速explain→other→explain不能被批处理/被动effect略过，项目A→B→A及同snapshot新激活关闭旧context，普通轮询无重复，失败关闭与迟到回复不得破坏新代际，卸载清理；新契约缺口须先说明最小边界。尚未运行其修改/测试/GUI，不宣称缺口已修复。Luna`:29`仅原三语料文件修订，文件并行边界不冲突。

## 2A-L 修订独立复验与接受（2026-10-02 05:20–05:24）

Luna`:30`idle，原三文件明确重新冻结。逐例比对README、JSON及真实contracts/ownership规则；开发记录明确将实际application执行归属协调方，没有伪造自测。新的绑定区分exact/受关系过滤的overlap、CALLS端点、变量WRITES/READS/RETURNS角色及背景范围，同位置不同证据保持独立citationIndex，unknown方法调用不参与确定性变量评分，未来建议仍proposal-only。

独立probe位于ignored `.benchmarks/ownership-semantic-recheck-20261002-0518/probe.ts`，重新复制自建既有fixture到新的隔离路径、使用唯一SQLite；按交付JSON本身的17个评分选择器（含variant内部绑定）动态选择当前真实边与证据，而非沿用手写期望映射。原命令`node_modules/.bin/tsx.CMD .benchmarks/ownership-semantic-recheck-20261002-0518/probe.ts`exit0：14范围摘录匹配，17选择器均唯一命中，10有效变体通过实际application完整评分预期，变量3项角色citation保留，普通duplicate去重为1，无引用schema拒绝、实际第二快照在直接grader身份门拒绝；所有有效grade的semantic仍not-evaluated。

附加诊断发现背景unknown选择器的短targetLabel不等于实际未解析节点完整name。协调方只修正JSON该静态字段，probe增真实完整name断言并改用新的final隔离子目录，以相同原命令再运行exit0，全部17绑定与评分/拒绝门再通过。首次patch按格式化JSON猜了行，因实际行内格式未匹配而无修改；随后读取真实行修正，属于编辑匹配错误，不是产品失败。源码/Graph IR未改，unknown未升级，没有方法运行行为证明。

本批准备切片接受，精确待提交仅原三文件及本轮三个协调文档；没有UI修改、模型/production凭据/网络/GUI验收，不把静态语料当已接受rubric或第二批实现。AGENTS新增0条，已有证据类型/置信度/相同快照与语义未评估门覆盖本次经验；具体选择器诊断保留开发/独立记录。Git真实动作及SHA在执行后补记，其他开发仍在自己worktree实现，不纳入提交。

实际Git收尾：核对main分支、六文件staged清单与diff/check、origin为既有用户仓库后，提交97191b4c2b5524f23032d91d563fded5a3581b61；普通push exit0，ls-remote确认origin/main同SHA，工作区干净。没有合并Sol未冻结实现、生成产物或公开二进制。已通知Luna本准备切片接受后保持idle等待1D安全接口；Sol保留455d4ad基线继续既定接线，不在active期间fast-forward。下一次以实际交付及游标为准。

## 晨间恢复与检验安排（2026-10-02 09:41–09:48）

用户要求核对两聊天/规划并继续任务，当前检验暂不使用电脑操作。先核对真实main HEAD792602e4c35e67a3c5d2e5a30cae02628495a838和干净状态、队列/交接/最新审查；Sol worktree仍为455d4ad，保存main/preload/worker/broker/credential-policy/App及协议的未提交改动。455d4ad至main在desktop、contracts、application、graph、ui范围无源码差异，main进展为已接受文档/语料，不在Sol修改期间强行对齐。

wait_threads timeoutMs0实际返回Sol最近回合failed且usage-limit错误，Lunacompleted/idle；额度工具当前ordinaryUsageAllowed=true，未购买或操作额度。核对Sol本批实际开发记录与测试源码，26项接线/18项协议属于上回合局部自测，没有冻结交付或本轮独立执行，不能晋升验收。

已向原Sol派发继续既定1C-2B-2B：保留全部改动，补齐快速切页/新generation/迟到回复及worker/broker丢失回复、退出、timeout与恢复门，重新纯回归/类型后冻结具体文件；重型native/build/产物/Electron技术验证另由协调窗口执行。原Luna派1D-0仅两新增设计文档，依据实际FeatureExplanationWorkspace与ownership-sessions/当前协议明确组件、状态、API前置、上下文撤销、用户逐项目选择及验证门，不提前改UI/契约或Sol目录。该准备有现有已实现离线会话与待接线协议依据，不为填充空闲制造功能。

派发后紧凑检查确认Sol新回合01a0fa47-aad6-7cb1-aa34-b98b6b08c83b和Luna新回合01a0fa47-b111-7f53-917f-cdef52981423均inProgress/active；最近游标分别582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:2、768020f8-a63c-4530-81b6-8232542daca8:2。两聊天实际已有新commentary与工具执行，不只发消息推测已启动。

原project-x-ray本轮实际核对为PAUSED；通过automation_update更新完整现行工作流为ACTIVE，保留原名称、review target、15分钟间隔与无变化静默，明确暂不computer-use、GUI仍未验收、不提交未验收界面实现。代码/适用回归与技术产物检查可继续，不把技术CLI替代GUI，不改变无密钥/项目外发/Windows发布安全边界。此次没有新实现验收/电脑操作/生产凭据/真实HTTP结果，没有重复已接受检查。本轮AGENTS新增0条：这是用户临时检验安排与额度恢复调度，属于协作状态，不是代码证实的新工程经验。协调文档Git动作仅实际执行后补记。

## 2B-2B及1D-0首轮独立审查（2026-10-02 10:03–10:09）

主checkout为6c18c20a3f2270609c59d5e6fc33cf81ddac13fd，仅Luna原两设计文档未跟踪。紧凑检查Sol游标:5、Luna游标:5均completed/idle，均明确冻结。对照Sol实际23文件边界、455d4ad基线、开发记录、main/preload/worker/broker/策略/App及协议源码，通知保持冻结后启动独立验证；没有同批并发开发或电脑操作。

独立执行各package cwd的 `node ../../node_modules/vitest/vitest.mjs run`：desktop六文件73项、contracts两文件44项、graph14项、application55项、llm Responses37项、UI App39项，全部exit0，共262项。desktop/UI的 `node node_modules/typescript/bin/tsc -p <对应tsconfig> --noEmit` 均通过。application与UI初次命令返回session，随后poll均exit0，不把打印passed而未退出当最终命令完成。没有依赖安装或导入项目代码执行。

协调方唯一重型窗口执行Sol checkout的 `pnpm --filter @project-xray/desktop build` exit0，真实tsup clean生成main/preload/analysis-worker/explanation-worker与sourcemap，Python/secure reader/production credentials正常复制；没有重新编译native或运行凭据smoke。再在desktop执行 `node ../../node_modules/vitest/vitest.mjs run src/remote-explanation.worker.test.ts`，产物worker1项通过。production addon源/目标SHA256均96C8EE0AFCE3C7BAA5E6AEEEEE0B14E34BF843690566FC9CA4A185AD49488505；dist/native只有secure_reader.node与windows_credentials.node，rg检索main/preload/explanation-worker的test-support、MemoryWorker、test addon及fixture-only标记无命中。该技术验证仅Node Worker的bootstrap/provider-state/denied-state，无GUI/真实Electron/portable/生产凭据操作/HTTP。产物测试的f.reads/f.calls属于父进程fixture注入端口，未关联实际production Worker，虽为0但不能证明其无OS读取/HTTP；已退回纠正这一测试证据缺陷，不以通过断言扩大证明范围。

额外独立复现确认产品缺陷：主checkout ignored `.benchmarks/remote-desktop-review-20261002/late-events.ts`使用同显式隔离fixture的真实SQLite与正常broker入口，仅延迟无requestId的task消息、保留RPC，待数据库completed后按顺序释放dispatched→completed。命令 `node_modules/.bin/tsx.CMD .benchmarks/remote-desktop-review-20261002/late-events.ts` exit1；heldPhases=[dispatched,completed]、observedPhases=[]、persistedPhase=completed、injectedDispatches=1，期望completed恰好一次。未发真实请求/操作生产凭据。首轮probe用Windows绝对ESM路径导致ERR_UNSUPPORTED_ESM_URL_SCHEME，改成file URL后进入上述断言；这是审查工具加载错误，不是产品失败。

根因：broker.message将当前最新persisted task与历史event.task整对象强制相等；端口消息迟到时SQL已completed，dispatched被拒绝；随后completed又因协议要求previous.dispatched而被拒绝。实际跨worker端口延迟或主进程繁忙能够触发，同步MemoryWorker原测试不能排除。已向原Sol派原冻结范围修正及延迟完成/取消/失败、重复/回退/错身份/伪造完成回归；必须保留权威身份/发布门与一次终态，不凭空补事件、重发请求或扩大API。重型窗口结束后仅定向tests/types，交付后独立复验，尚未接受或集成该实现。

Luna两文档独立对照main实际离线会话、候选协议与ADR0007：本地跨页保留和远程代际撤销分离、短期key/preview、main-owned context及history无API时不猜恢复的方向成立。定向退回不存在的“剩余额度”展示（当前preview只有确定上限等字段）、用户暂缓computer-use的顺序、尚未接受候选XRayApi及queued无SQL取消分支，后续复用Sol最小撤销入口而不是两套cleanup。仍只原两文档，不实施UI。本轮AGENTS新增0条，延迟事件经验待修正与独立复验后再评估/查重；测试计数不是经验，既有规则已要求区分技术/GUI及相关证据。队列/交接同步修正中，保留用户所有改动。

修正派发后紧凑检查确认Sol新回合01a0fa5f-2723-75a3-b2bf-481f4e058894和Luna新回合01a0fa5f-2950-71d1-b05a-90d11b3c38a1均active/inProgress；最近游标分别582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:6及768020f8-a63c-4530-81b6-8232542daca8:6。不在同批修改期间继续运行构建或重复已完成检查；下一次以实际重新冻结交付为准。本次仅三份协调文档进入Git范围，Luna两待修文档、Sol未验收实现与ignored probe均保留。

## 2026-10-02 10:18–10:27：延迟事件独立复验、设计接受与后续派发

读取当前队列、最新审查与交接，核对实际目录/Git/AGENTS/开发记录，紧凑检查确认两修订交付均冻结 idle，实际游标 Sol 582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:7、Luna 768020f8-a63c-4530-81b6-8232542daca8:7。main 3f58ddc24a395f1d8bc2b585ac942ed41d24cfc2，Sol455d4ad50830ee2495b70927e51caf830a4efbb8，保留未提交接线与新增AGENTS条目；没有重置/覆盖。此前262项是上一版本证据，本轮仅因修正运行必要定向组合，不写作新版262项通过。

### 已独立验证的修正

审查实际 broker.message 差异：历史 dispatched 仍核对已注册/current-context/完整identity/createdAt；其他阶段精确匹配权威SQL整行，completed额外精确匹配实际source库已发布result。未伪造事件、扩大API、放宽结果门禁或重复dispatch。负向回归实际覆盖先到completed无dispatched、错owner/epoch/context/ref/task/package/bodyDigest/createdAt、重复/回退、篡改完成时间和结果，以及隔离库publication移除→拒绝→恢复原fixture结果→接纳一次。此删除仅测试临时库。

独立重跑原 ignored probe（不是新改预期）：主 checkout 执行 node_modules/.bin/tsx.CMD .benchmarks/remote-desktop-review-20261002/late-events.ts，exit0；heldPhases=[dispatched,completed]、observedPhases=[dispatched,completed]、persistedPhase=completed、injectedDispatches=1。仍使用真实隔离SQLite/正常broker入口及显式注入测试端口，无真实请求/生产凭据。上一节同probe exit1与本节修正后exit0形成闭环。

独立命令均exit0：Sol apps/desktop cwd运行 node ../../node_modules/vitest/vitest.mjs run src/explanation-broker.test.ts src/explanation-worker-runtime.test.ts src/explanation-policy.test.ts src/remote-credential-policy.test.ts，4文件36项；contracts cwd同入口 src/remote-explanation-desktop.test.ts，20项。Sol根执行 node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit 及 UI 对应命令，通过；git diff --check无空白错误，仅Windows换行提醒。

取得冻结及单窗口后，根协调方执行 pnpm --filter @project-xray/desktop build，正常tsup四入口和Python/secure-reader/production credentials复制成功，无native重新编译；随后 desktop cwd vitest run src/remote-explanation.worker.test.ts，1文件1项通过。实际Node Worker从最新dist启动、关联RPC并返回null-context/provider-unconfigured/auth-denied；修订测试已删除与生产Worker无关的父fixture reads/calls计数，只证明bootstrap/state协议，不据此宣称OS或HTTP调用计数为零。本轮仅请求该三类无凭据/start命令，未操作生产凭据、真实网络、Electron GUI或portable。

因此接受该具体延迟事件修正的源码/回归结果；整批 main/preload/Electron IPC、App真实GUI及集成仍开放，Sol24文件不提交，不把用户暂缓电脑操作当GUI豁免。未经GUI验收的实现不进入本次Git范围。

### 设计接受、经验与下一批

Luna两文档对照实际RemotePreview、queued cancellation及当前main未接线状态复审：不再造账户余额/剩余额度/线上正文长度；queued取消不造SQL task；复用Sol同步revoke入口，仅候选接线接受后补enter/confirmed门；离线session不变，远程ephemeral，旧context不恢复或重发；先组件/技术产物、真实GUI延期。1D-0设计接受，文档标状态并保留写作时事实，非UI实现或实际远程质量。

公共AGENTS逐条集成1条消息时序经验：实际红测/根因/原probe独立红→绿及安全负向回归支持；现有跨SQLite发布规则管terminal发布，不覆盖迟到历史阶段的整行误拒绝，因此未重复。只取该条并链接本独立记录，不整体覆盖Sol的AGENTS或把未验收实现文档搬进main。Luna设计无新经验。检索时猜错baseline计划文件名及Windows rg glob失效后改实际路径；是审查检索错误，不是产品/工程经验。

新增可审查计划 docs/plans/2026-10-02-non-gui-continuation.md，依据ownership语义固定未评估/feature-only purpose与benchmark固定三文件实际限制，派Sol2A-S仅ADR0008草案+记录；Luna3C-L有界medium样例工具实施，精确六文件，无同文件/契约竞争。保留接线冻结，无GUI/模型/凭据/Git开发动作；规模采样只协调方单窗口。先计划后派发，不把旧TODO或没有性能数据的缓存想法当实现依据。

紧凑检查实际确认新回合Sol01a0fa70-0317-7d32-b220-d59bde758374与Luna01a0fa70-0541-7100-9232-5953c4958514均active/inProgress，最近实际游标分别582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:8、768020f8-a63c-4530-81b6-8232542daca8:8。当前进入Git范围只已接受两份设计、协调计划/审查/交接与合格规则；两个开发新批文件与Sol产品实现保持不纳入。

## 2026-10-02 10:33–10:44：目标 Electron 状态 IPC 技术验证与语义设计复审

读取当前AGENTS/队列/审查/交接，main基线c36d67a6ecb96f9408b1fe8b1a91f00d4133c10b（前轮已普通推送并ls-remote一致，设计/协调/规则7文件，无未验收实现）。紧凑检查Sol2A-S两文档冻结完成，Luna3C-L继续修改；不运行正在修改的基准工具，不读写开发同批文件。原接线继续冻结，重型窗口仅根协调方的以下技术运行，没有新增build/native/dist。

### 实际目标运行时检查

根自建ignored .benchmarks/remote-desktop-review-20261002/electron-bootstrap.ts及两个CJS入口。独立复用原隔离fixture的真实SQL和正常生产产物；fixture只提供自建数据，没有把测试provider/native端口注入Electron worker。每次唯一临时目录/SQL/元数据文件，用已校验作用域的fixture.close清理；仅固定本地Electron可执行文件，windowsHide，无下载/生产凭据或真实HTTP。CJS只在argv脚本身份匹配时执行，无导入副作用。

命令 node_modules/.bin/tsx.CMD .benchmarks/remote-desktop-review-20261002/electron-bootstrap.ts，exit0：Electron44.4.3、Node24.21.0，实际dist/explanation-worker.js由node:worker_threads启动，activate-context(null)、provider-state、authorization三类RPC得到inactive/unconfigured/denied。未创建BrowserWindow、未调用credential/status原生操作、prepare/start或传输。额外源码核对worker-runtime.execute中provider-state/authorization只读SQL元数据；这仍不是对任意未来调用的OS/HTTP计数证明。

命令同入口加 --ipc，exit0：直接require最新dist/main.js（未复制main处理器），实际dist/preload.js在contextIsolation=true、nodeIntegration=false、sandbox=true的隐藏窗口调用三个状态命令；main/broker/实际解释worker返回inactive/unconfigured/denied。另一隐藏窗口用同生产preload、正确provider-state形状请求被main拒绝；原窗口导航到自建空HTML后同请求被固定POLICY_INVALID拒绝。两条stderr固定RemoteExplanationError是预期拒绝证据，不是运行失败。输出realMainPreloadWorker=true、controlsOperated=false、wrongWindowRejected=true、wrongPageRejected=true。

隔离方式：在加载main前固定userData/sessionData为本次临时根，设置既有XRAY_SMOKE隐藏窗口模式和本次XRAY_E2E_USER_DATA；不读取生产用户数据。技术harness只延后smoke在did-finish-load时的app.quit，完成检查后恢复正常退出并经过main的worker清理。使用已有UI静态壳只承载contextBridge，不操作产品控件、不重建UI，也不声称验证新App撤销钩子。该时序拦截意味着不能把实验作为原smoke自动退出/真实GUI完成证据。没有电脑操作工具或产品GUI交互；source/task发送/取消全路径、窗口关闭竞态、真实远程与App GUI仍开放。

实际运行产物SHA256：main.js 8269D2B0AD3F7A01B9B02375BE6F07567F1BFF3208251926B4BBFE92D6E22C59；preload.js 791BC6D66A332F234968AFCBEB5E7D649F1860D8A87AFB6AB2CC26F3F563379E；explanation-worker.js EA93B8EB826F1B261B5CF44EDC4EE3EF68F63653BCB7970A1BBA9BA694BA81EF；production credentials addon 96C8EE0AFCE3C7BAA5E6AEEEEE0B14E34BF843690566FC9CA4A185AD49488505；已有UI index.html EE5315DBC1F94B6CBAEA695C60672993E7374754F016C08E9AA2F9563876D200。Sol源码/产物尚未提交或集成，只有这些技术门取得新证据。

### 2A-S实际设计审查

读取完整ADR0008草案与开发记录，对照application.gradeOwnershipAnswer、contracts.grade/attempt、GraphStore.saveOwnershipAttempt及ADR0006：passed后内存question确实删除，attempt无完整rubric；独立授权/答案披露、提交同事务胶囊、sidecar不改定位/结构/passed/mastery、预算与精确身份/跨库恢复方向合理，设计记录明确没有运行实现或模型验证。

三处明确退回原Sol、仅两文档修订：①strict criterion输出无limitationIds，却要求insufficient引用本地限制ID；须结构化有限字段与criterion允许集合，不解析自由文本、不把限制充作源码proof；②必要完整合法所选路径不可截断，但矩阵准许缺步骤/混拼发送部分命题，须明确不能绑定完整合法路径时零发送、保留本地失败attempt；③纯验证器不能保证识别任何凭据泄露，收敛至可检查的字段/正文/header/日志边界，启发式若保留必须说明有限，不额外扫描OS或Codex秘密。不是实现缺陷或运行红测，草案尚未接受，不占迁移11，不实施评分。

Sol最新修订回合01a0fa79-9359-7f41-8937-a4dded91ca3e active，最近实际cursor582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:11；Luna原工具回合仍active、cursor768020f8-a63c-4530-81b6-8232542daca8:10。本轮经验新增0条：既有入口/隔离与证据规则已覆盖技术验证，设计不一致尚无实现实验，不把补充状态/数量写成通用规则。检索两次误用worktree/Windows literal glob后按确切目录修正，仅为审查检索错误。提交范围仅本轮四份协调文档；保留ignored实验、Luna正在修改文件及Sol全部实现/草案，不以暂缓GUI豁免提交门。

### 10:46 修订复验与2B-S1派发

Sol修订两文档冻结idle（cursor582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:12）。独立读取修订全文相关段及记录：limitations字典明确code/稳定hash/允许集/最多24条、insufficient必须1–8结构化限制ID且不能作proof、supported/contradicted限制空；未提供相关解释时answer-information-insufficient明确只是可选择的辅助判断，不伪称本地已证明语义不足。call-path完整合法所选边序列不成立即整题not-evaluated零发送，正文/矩阵一致；结构安全边界不再保证任意秘密检测。设计修订接受，无运行质量结果。

另对照main GraphStore.saveOwnershipAttempt当前普通INSERT，纠正草案误写“现有INSERT OR IGNORE”。root只复制两份新设计文件到main（先确认目标不存在），标ADR设计接受，补充sidecar分数不进原passed/mastery、胶囊沿用attempt保留/显式删除、迁移/授权UI文案分阶段复核政策；不占迁移号、不提前实施SQL或隐私选择。复制文件保留开发时草案/基线/静态检查历史，新增协调接受说明。首次apply_patch用了错误记录标题，整个patch验证拒绝；核对无修改后以实际标题重试成功。此为文档编辑错误，不是产品缺陷/AGENTS经验。

派原Sol2B-S1仅新增contracts ownership-semantics模块/测试及开发记录；自己ADR/记录仅同步接受状态与INSERT事实。原index.ts含未验收桌面API改动继续冻结，不借barrel导出混合提交未验收实现。纯契约可复用同包既有schema、直接在同包tests加载新模块；不改旧purpose/grade/attempt、数据库/网络/GUI或生产入口。本批后续独立审查稳定ID/字典/criteria、预算、actual-answer UTF16/range/identity与三类verdict安全负向，再按明确切片导出/集成。不能把契约模块当第二批端到端、真实源码/SQL当前性或模型质量通过。队列/后续计划/交接同步，仅接受设计和本轮协调记录进入Git，Luna active工具与Sol原实现仍保留。

## 2026-10-02 10:50–10:58 非冲突独立恢复检查

先读当前队列/审查/交接并紧凑检查原双聊天，实际main HEAD38bfecb、Luna五个工具源码/测试仍修改，Sol当前只新增纯契约。没有并发执行其未冻结回归或重型索引。最新实际游标Luna768020f8-a63c-4530-81b6-8232542daca8:13；Sol582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:16。开发13项工具测试和49/50契约首轮自测只是进度，不代替独立验收；Sol报告旧冻结契约测试类型错误，已要求确切行/命令与单独门禁，不提前改冻结文件或宣称整包类型通过。

代码核对：ExplanationBroker.startSession先commit本owner再stop；stop在终止自身worker后调用全局recoverInterrupted。该函数终止所有dispatched任务、清除所有inflight并使全部owner context失效，无活跃进程所有权识别。main.ts的app.whenReady直接打开userData SQL/创建worker，检索没有requestSingleInstanceLock。发布设计要求同userData任一时刻一个写实例，但未见运行门，不能把文档串行要求当强制保护。

新ignored实验 .benchmarks/remote-desktop-review-20261002/concurrent-session.ts：两ExplanationPolicy连接同一新临时SQL、两个不同owner broker；首实际任务进入dispatched，注入provider的Promise挂起，第二session启动后检查首状态和worker生命。命令 node_modules/.bin/tsx.CMD .benchmarks/remote-desktop-review-20261002/concurrent-session.ts exit1，原预期dispatched未满足；JSON before=dispatched、after=interrupted、firstWorkerAlive=true、isolatedConnections=2、injectedDispatches=1、actualElectronProcesses=0。finally先解除注入等待再关闭两broker/SQL/自有临时目录，未读取生产用户数据/OS凭据或真实HTTP。此确认核心状态/恢复缺陷；没有实际两个Electron进程、GUI或重复网络派发结论。没有在日志保存源码、答案或凭据。

已告知Sol明确复现/预期/边界并排队P1 1C-2B-2B-C，在纯契约冻结后再派精确修复。计划目标是同userData活跃单写所有权门先于DB/worker初始化，保留真正崩溃重启恢复/零自动重发及隔离userData并行。候选main启动策略与定向测试，broker/graph只有证明必要才扩文件边界；不立即改active契约或用用户操作约束规避缺陷。真实双Electron技术验收待root协调窗口，GUI仍延期。队列/交接已同步，原接线不提交。

本轮AGENTS新增0条：问题有复现但修复/预防动作尚未独立验证，暂记录诊断与门槛；反馈闭环待交付后复验完成，不把当前失败写成成功。检索误用不存在文件及Windows路径glob失败后改确切路径，只是审查命令错误，不是产品或环境经验。

## 2026-10-02 11:01后 3C-L与2B-S1独立验收及集成

### 3C-L工具与实际样本

Luna六文件明确冻结idle，实际main差异仅原三工具/测试、新registry/测试/本记录。完整核对registry生成96TS/32Python、每文件单函数的语言内导入/调用链，固定13518字节、清单0c250b857248c59e5aaa9d40341857f10770049d128e70010f10a9a3dc2ed9aa。父/child共享有限枚举与逐项清单；medium配对摘要重算11门，原small形状兼容；128KiB有限协议行、2000行限、5轮/180秒上限、wx新目录/报告、全部证据解析仍存在。原取消RSS finally已保留，不引用当前测试作为OS/全应用RSS证明。

独立命令node_modules/.bin/vitest.CMD run benchmarks/local-index-baseline.test.ts benchmarks/local-index-baseline-samples.test.ts --reporter=verbose：14项/2文件exit0；原五目标严格tsc --noEmit（ES2023/NodeNext/strict/allowImportingTsExtensions）exit0。阅读负向测试本身确认未知样例、重复/错语言/错摘要/计数、矛盾门和forced timeout，不只接受开发报告。

单协调窗口真实CLI：默认--runs 1 --timeout-ms 60000，小样例run fd9ba26c-b173-40c3-be4f-332bf4b41a7d completed/exit0/一对，11门通过、28/28证据。随后--sample medium --runs 1 --timeout-ms 180000，run cd152778-cfd0-4b1e-80ae-e13f8331bc61 completed/exit0；再--sample medium --runs 2 --timeout-ms 180000，run 2c6a4c5d-9d26-41ed-b641-40cdf07ccd1c completed/exit0/两对。三对全部11门、128文件/387节点/1275边/1177证据/0 unknown，每对1177/1177源码API成功，cold/warm phase均387条。此为自建样例API导航/当前快照等价，不是GUI导航或真实项目性能。

| medium样本 | cold index ms | warm无变化index ms | 完整child ms | cold Node采样峰值bytes | warm Node采样峰值bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| cd152778 run1 | 2618.1669 | 2530.3913 | 48870.262 | 342319104 | 406626304 |
| 2c6a4c5d run1 | 2003.9272 | 2142.6221 | 42259.362 | 320393216 | 359378944 |
| 2c6a4c5d run2 | 2457.1493 | 2323.8526 | 47585.493 | 316174336 | 359514112 |

环境Node24.17.0/win32/x64、graph1.3.0、typescript-program5.9.3+xray.3、python-ast2.1.1；不收集OS build/硬件负载/存储/Python版本，RSS不含Python子进程。每个run都是新库/同根的冷暖配对；不能称OS磁盘冷缓存，样本数不支持广泛性能承诺。phase事件是公开阶段时刻，不是TS/Python分项计时。完整child另含启动/两次所有证据导航/汇总/关闭等，不能把差值直接归因某函数。

报告存于工具自有临时run目录、未覆盖旧报告；总report SHA256：small 2A1A427BC89D5F26633BB8CF10ACD220742C3AC0DEB450B9BC6AEC22CB8FBB25；medium单对835DCA09CC7A16E506C948CBC57B831D93F81BE224DAAB52E38D39B0AC3CC37B；两对099BC73BDE11315CF01C3B7FC806A17EBA04215186861AE6FB806044AA6DC46D。只记run ID/hash/指标，不记录私人临时根或源码。读取首次用了过低ConvertTo-Json深度/过宽输出，随后只选实际字段；报告hash首次PowerShell foreach直接管道语法失败后以局部数组修正，均为审查命令错误。

额外ignored medium-cancel.ts实际child cold reading16/128时取消：run fd52c807-2702-48d7-b850-ca477ddebf6b，command exit0，termination/terminal cancelled/CANCELLED、closed=true、forced=false、protocolError=null、duration1623.589ms；父收到cancel后等待child close，未遗留RSS interval。probe import路径在执行前核对纠正。原small取消/强制超时已有14测试，本额外实验补medium实际取消点。3C-L工具切片接受，不代表实现增量算法或UI/大型项目门。

### 2B-S1纯契约

Sol新增三文件冻结，独立读取完整模块/ADR与关键61样例：strict有限字段、domain hash规范化无序集合而保留路径/range顺序、actual answer/hash绑定/合法UTF16代理对、required证据闭包与criterion/limitation双向归属、全题合法所选verified CALLS序列及引用完整、未知动态限制必须有unknown proof、三类verdict安全结构与全criterion全集、硬预算/不裁剪、固定错误。只验证已提供DTO与实际答案，不证明SQL当前性、真实question/attempt权威性、源码真伪、学习目标充分性或模型语义。

在Sol冻结路径执行61项新增定向、118项全contracts回归及新增两文件strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes类型，均exit0。旧冻结协议测试两行protocolVersion的TS2345由新启动小批明确准许最小类型修正，不静默降门。main三目标先确认不存在后仅复制module/test/record，由root独立追加一条public export，没有复制Sol index.ts或24文件接线。集成main contracts116项/5文件exit0、contracts/desktop/ui tsc各无错误退出0；实际node --import tsx公共index import断言purpose及validator函数exit0。118与116来自Sol未集成桌面协议另两测试，不把数量差异当本模块丢测。纯模块接受并集成，旧purpose/grade/mastery/SQL/UI无实施，真实模型门仍开放。

### 后续与Git边界

原Sol正式接1C-2B-2B-C，仅main启动顺序、独立startup策略/定向测试/记录；另明确允许旧协议测试两处protocolVersion字面量类型修正。不改graph全局恢复或纯语义冻结模块、不重置worktree；真实Electron双进程技术门由root下个协调窗口补验，GUI仍延期。Luna接3D-L两新文档只读诊断设计，依据实际child/index时间差和requireSnapshot反复load/parseStoredSnapshot的候选路径，先定义分项计数/计时再决定实现或复杂优化，不先加缓存/制造重构。

本轮AGENTS新增0条：工具安全/证据门、纯契约失败关闭及范围/hash规则已覆盖；单次耗时不作通用规则，启动缺陷未修复不标闭环完成。只将已独立验收工具六文件、纯契约三文件+root导出和对应协调文档纳入Git；Sol旧接线、启动在写文件及未完成新设计不提交。无电脑操作、生产凭据、真实HTTP、公开二进制。

### 11:13–11:14 Git结果及启动门稳定复审

待提交14文件逐项及cached --check通过，main index仅追加ownership-semantics export，无Sol旧接线；实际commit1fa81b1ab7451abe0a97cde47c87e5e448421688。首次普通push exit1：远端main ref已在同1fa81b1而期望旧ab8bfc2，随后ls-remote与本HEAD精确一致；再普通push exit0 Everything up-to-date。不能从此确定谁先完成远端更新，不改写第一次为成功，不force或把偶发ref冲突沉淀规则。主提交后status无源代码待提交，Luna继续自己的两文档设计，不包含其未来未接受文档。

Sol启动批冻结idle后继续推进实际审查：读取startup-ownership.ts/test、main末段和record。有效userData选择后同步requestSingleInstanceLock，拒绝exit0、异常/缺所有权exit1且不调用ready/init，ready后复核；锁不提前release。main唯一初始化回调含Policy/Broker/Analysis/IPC/窗口，旧callbacks保留。旧协议测试只在command字段追加1.0.0字面量类型，未改使用点/断言；base总diff还含早先未接受接线两新增测试，不能全部作为新类型修正提交。

独立startup9项及Sol desktop/contracts类型exit0。纯port模型/实际入口AST能证明该源码排序与模型逻辑；**尚未运行新build/两个真实Electron进程/首SQL任务保持/退出重开/隔离userData并行**，不把启动批或整接线标完成。底层双连接probe绕过入口仍展示全局recover假设，新方案需实际入口门证明阻止第二owner才关门。此批继续冻结，root下一协调窗口执行技术验收；原GUI延期、无凭据/HTTP操作不变。实际游标Sol582f17aa-f30f-4365-a7b1-0dbecc3b2b9d:20 idle、Luna768020f8-a63c-4530-81b6-8232542daca8:20 active，本轮无新增AGENTS。

## 2026-10-02 14:45–14:56 恢复自动跟进与真实启动门技术复验

本轮用户再次明确恢复定时任务/双开发线程。读取当前AGENTS、执行队列/最新审查/交接、实际Git和原automation.toml；main HEAD1d7d66c7e4d8accd6f3c23c840256b41dcb87271、开始干净，Sol仍455d4ad并保留全部未验收接线/启动/纯契约改动。定时器实际PAUSED，通过automation_update原id完整字段恢复ACTIVE/原15分钟，不新建。紧凑状态显示Luna原3D设计因额度中断且两目标未创建，Sol冻结交付idle。分别恢复原设计和只读恢复fixture准备；没有重置、重新开发已接受切片或并行重型检查。CODEX_HOME本轮未设置，首次读取该变量路径失败后用已知本机自动任务路径核对，未扫描敏感环境/凭据。

root单窗口在Sol冻结目录执行 pnpm --filter @project-xray/desktop build，exit0，tsup四入口/现有安全读取与凭据模块复制成功；没有重新native编译、生产凭据配置或HTTP请求。新main.js SHA256=190A1487666855BC4B7DD57ED91951273E57A2CA1AADBF4B71A8E5B6297522DB，explanation-worker.js=EA93B8EB826F1B261B5CF44EDC4EE3EF68F63653BCB7970A1BBA9BA694BA81EF（worker未变）。在真实Electron44.4.3/Node24.21.0运行自有ignored owner-process.cjs/owners-runtime.cjs；实际require新dist/main.js，隐藏smoke窗口不操作控件，Module._load包装只计真实SQL/Worker构造与worker start命令，不替换provider或worker。四个独立进程分别为首owner、同目录第二owner、隔离目录owner、首异常退出后的重启owner。只写mkdtemp新自有目录，全部子进程退出后核对tmp根边界再清理。

命令 node --import tsx .benchmarks/remote-desktop-review-20261002/owners-runtime.cjs 最终exit0。同有效userData第二exit0，workers/databases/windows/starts均0、ready=false，首仍alive；另一独立userData正常创建DB/worker/隐藏窗口。首session初始化之后经公开GraphStore保存合法snapshot/source、activation/context与人工provider/authorization元数据，再registerDispatch/appendResult/finish/release构造人工completed历史，另注册dispatched/inflight=1。无真实apikey/网络派发，这些记录不代表首生产provider正在运行。第二拒绝后完整任务/结果/时间、lease=1和active context不变。终止自有首进程而不走before-quit，确认SQL仍dispatched，再实际重启：interrupted/INTERRUPTED、inflight=0、旧context拒绝、task数量2、completed task/result完整不变、旧源码不变。重启退出时真实worker start命令计数0，workers2/databases1/windows1；没有据此宣称实际全系统零HTTP或零凭据调用。GUI仍未操作，不能作为第一批可操作界面/发送取消/模型质量通过。

probe第一次失败是计数hook只接受node:worker_threads，而tsup产物规范化为worker_threads；检查产物后计数两种名称并重跑通过。扩充SQL实验时人为改fixture.rootPath但未重算analysisResult指纹，被正确SNAPSHOT_CONTENT_CONFLICT拒绝；改用原完整不可变snapshot后通过。两个是验证脚本缺陷，非产品缺陷；断言未移除或降低。公开合法结果按真实proof范围建立，finish(null)与已发布result分别比对。新增lease/结果断言后再次运行原入口exit0。apply_patch一次误猜计划文件标题整体校验拒绝，修正实际上下文后成功，仅编辑错误。

独立定向命令 node_modules/.bin/vitest.CMD run apps/desktop/src/startup-ownership.test.ts apps/desktop/src/explanation-broker.test.ts packages/graph/src/remote-explanation-store.test.ts --reporter=dot：47项/3文件exit0。覆盖启动9项和broker/store恢复、取消/时序/身份及历史保护。源码/产物/OS启动门技术切片接受；底层绕过main的双broker原失败断言不改，仍说明全局recover依赖单写入口。整旧接线和main GUI/正式发送取消门继续开放，未提交实现。

Luna两文档3D-L冻结后读全文/记录，对照requireSnapshot/readSource/GraphStore/安全读边界，接受inclusive分组及独立安全读取回放；不能把差值算导航瓶颈或把SQL+parse拆成私有实测。root补设计接受状态，派3E-L三新增benchmark文件+开发记录，仅纯测试/类型，由root随后实际执行CLI/取消/medium门。Sol恢复fixture只读准备完成，指出appendResult/finish/release及等待session/崩溃切点边界；root实验独立构造与执行，不以其报告代替验收。已派2B-S2两新文档设计实际rubric与本地attempt事务胶囊，先核对真实题型/路径/预算/角色/版本/冲突与精确后续文件，不占迁移、不实现SQL/模型/UI。具体可审查目标及门槛先写non-gui-continuation。

本轮公共AGENTS新增1条：全局恢复依赖共享userData单写时的入口持锁/零初始化/异常退出真实进程回归。已有规则涉及跨库发布、任务消息与状态门，未覆盖OS活跃写实例的排他入口；新条有核心原失败、启动修正及本轮真实产物实验支持，适用/动作/记录链接完整，不放当前数值或改变GUI/安全/授权门。开发各自记录0新增合理。只对已接受两设计与协调记录/公共规则做Git收尾，保留Luna新实施文件和Sol全部未验收实现。
