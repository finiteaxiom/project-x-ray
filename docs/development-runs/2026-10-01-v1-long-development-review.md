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
