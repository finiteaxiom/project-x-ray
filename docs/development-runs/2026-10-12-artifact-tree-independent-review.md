# M7 初次独立审查：全树终验缺口

2026-10-12，协调方；仅原四批第四批，未接受、未 main 集成。开发-Sol 同聊天、5170、gpt-6-luna/max；初交付 turn 01a12db3-1d6a-7c83-ab12-b3cc8e6d8160 已 completed/error null，真实 cursor f884d126-4b7c-4788-82d6-8fae95636925:18。没有 GUI、API 或 Git 操作。

## 来源与实际验证

核调度 422 完整 raw/hash、开发 before/after 与 427 当前正式文件、两份 raw 副本及六文件 patch 逐 hunk 重建的完整字节；只有获准 M6 容量模块一旧变化与五新，其余 421 原文件保持，main 520 未改。冻结 patch SHA-256 为 65F217654D1948C601DD2857721BDD13F0EBA328EAEDCD114239C162500504F9；root 原始收据 m7-initial-independent.json 和独立 raw 副本在忽略协调目录保留。

root 单 worker/no-file-parallelism/no-cache/排除所有 .benchmarks，实际运行目录与树两个纯测试文件，25/25；desktop tsc --noEmit 通过。冻结后 root 唯一 Windows 技术窗口执行新 tree-handle 文件，13 项 11 通过、2 失败，15.20 秒；失败为正常混合嵌套文件和 owner 持有/释放用例，原日志 m7-initial-root-windows-new.log 保留。没有把开发报告的 9 文件/128 或先前 7/103 当本次独立证据。旧 M3–M6 技术回归未因本次失败继续跑；这些保持未验，M6 已接受主目录成果不回退。

## 已确认产品缺陷

源码 Visit-XRayArtifactTreeDirectory 在每个子树递归返回前完成该目录第二向量/metadata 比较，然后丢弃前像；顶层最后只再查初始祖先和根。它没有在所有内容读取结束后重新核所有已完成的子目录及成员。

root 自有 Windows 材料 observed/a/b/first 与 observed/z-last；原真实 M7/M6/M5 入口、原 guards 和释放不替换。只在调用原第二个文件观测前，真实创建 a/b/added-after-subtree。此时 a/b 和 a 的局部第二向量已经结束；文件创建成功，原读取仍返回 ready，报告 fileCount=2，实际文件=3，随后原 release/terminal/exit0，两个原文件均可写重开。结果见 m7-initial-root-late-subtree-result.json、探针 m7-root-late-subtree-probe.cjs。这是实际遗漏终验，不能以全部 HANDLE 仍持有或 snapshotStatus=incomplete 豁免当前切片的全树稳定门；探针不提供生产 source 认证。

## 仍未确认的失败及覆盖缺口

两个原新 Windows 用例首次失败为 CHILD_EXIT；追加自有材料普通嵌套诊断出现 mixed 成功、held 固定 DIRECTORY_CHANGED；保留原比较器的后续字段诊断两者均成功。运行次序/缓存原因未确认，不称为已证 NTFS 缓存，也不能删正确断言、sleep/重试、改 share 或放宽时间/完整向量比较。保留原失败并在新 fixture 中增加固定安全诊断及针对性来源比较，修复/夹具调整须有新证据。

当前新测试尚缺计划中的子树结束后新增/字段变化、最终全部成员十字段、硬链接/重解析、deadline/close failure 及合法深度 64 的正向覆盖。文件 borrowed view 目前复制绝对祖先+全部递归链，可能超过旧 M5 consumer 65 HANDLE 上限；应在本切片内明确借用范围并保持旧 M5 契约，无权放宽冻结旧 consumer。静态源码字符串通过不证明上述 Windows 门。

## 窄修边界与交付门

从 root 保存的当前 427 完整冻结基线继续，仅允许四个既存新 M7 文件：tree module、tree probe、tree-observation.test、tree-handle.test，另加自己的既存 M7 开发记录，合计五旧、零新；其他 422 文件冻结，含本次 M6 容量模块、全部 M3/M4/M5/M6 原测试/fixture/规则/计划/共同记录。基线 raw/hash/HEAD/模型核对后才改；开发不 Git，不操作其他 checkout。

所有内容读取后独立最终复核根和全树：每个目录原私有完整第一向量须在 32 MiB 预算内保留至最终第二枚举及严格比较；每个已登记成员同 HANDLE 私有十字段在最终门完整复核；保留 no-follow、volume/ID、目录同来源和普通文件跨来源严格门、单一 owner 持有与真实释放。不能在子树完成时视其为最终稳定；额外账本、向量和 DTO 预算同时计算，不能早减账户隐藏持有材料。不要把离散核验宣传为原子快照。补真实有界 late-subtree 及元数据故障回归，确保注入实际成功、零 ready、原固定拒绝和真实可重开。borrowed view 范围与 65 上限及合法深度边界需保持一致。

开发仅串行有界纯测试、类型与 AST/JS 解析；Windows/HANDLE/reader/重型窗口关闭，稳定冻结后 root 独立单窗口再验，保持失败闭环和完整 427 前后 raw/hash、五旧精确 patch 与其余 422 不变。开发只追加更新自己的记录，不覆盖旧失败收据。root 不提前接受或集成。

## 状态与规则判断

已实现：M7 内部树原型与新测试。独立代码/回归：来源、25 纯与类型已核；Windows 11/13 和实际漏检反例；M7 整体未验收。真实 GUI 未执行；API、完整 reader/ASAR 安全副本/sidecar/manifest、安装、签名、运行与干净 Windows 保持未验。M6 已接受本地技术门保持。工程经验 0，现行完整快照/证据/测试规则已有要求，此轮先完成实际修复闭环，不增加重复条目。继续原四批，其他三员工冻结保留，零 Git，不第五批。


M7五旧窄修已实际派发：原开发-Sol gpt-6-luna/max、仅5170，turn 01a12dcd-6e0d-7453-a264-308956f3cb81、cursor f884d126-4b7c-4788-82d6-8fae95636925:19；compact snapshot active/inProgress/error null。427完整冻结基线与root raw已保存，仅五个既存M7文件可改、其他422冻结，零新增；Windows/HANDLE/reader及重型窗口关闭。初交付25纯/类型与11/13实际Windows及漏检反例保留，M7未接受、未main集成，修复交付后root再独立复验，不以开发自测升级。原四批继续，员工保留，零Git/新增规则。


## 2026-10-12 五旧修复独立复验：原漏检被拒绝，测试准备仍需修正

本节为最新实际状态，替代上方“修复尚在开发”的描述。原开发-Sol 同聊天、5170、gpt-6-luna/max 已冻结交付，turn 01a12dcd-6e0d-7453-a264-308956f3cb81，真实 cursor f884d126-4b7c-4788-82d6-8fae95636925:21。root 核 427 前后完整 raw/hash、五旧精确 patch 逐 hunk 重建（含完整字节/EOL）、其余422不变及 main521不变；patch SHA-256 4F387AF9E61DFC31F3107E49C42BDC9449FC0145E6AA7BAF6D34F1620D2DD2F4。双方 HEAD 不变。来源收据为 ignored m7-repair-independent.json，冻结 raw 路径保存在其 frozenBackup 字段。首次 root patch 解析器对绝对 quoted 路径格式不兼容，在测试前失败；改为识别 patch-after 路径后精确重建通过，这是协调工具修正，不是产品缺陷。

root 实际两纯文件25/25、desktop noEmit通过。保持原始 late-subtree 探针、原入口/guards/释放：真实插入发生，ready=false，exit3/DIRECTORY_CHANGED，实际3文件且可重开；上轮“实际3却报告2”的漏检反例本次正确拒绝。不能从某个反例拒绝推断完整树已接受。

新 Windows 文件实际21项18通过、3失败，24.27秒；失败是正常混合嵌套、late-subtree-metadata 故障以及合法深度64正向。原 owner-held 用例本次通过。原日志 m7-repair-root-windows-new.log 保留；旧 M6/M4/M5 因新文件失败未继续跑，5170缺M3的事实保持，不能把历史通过充当本次门。M7整体仍未接受、未main集成、无Git。

root 自有有界材料字段诊断保留并调用原比较器、捕获后重抛：mixed通过；深度64被原完整向量门拒绝，同一成员d的 write/change 从134362449039283267变为134362449039293263（9996个100ns tick），成员数均1；metadata在实际armed/injected后以change+1被原同HANDLE门拒绝。日志 m7-repair-root-stage-diagnostic.log。已证明前后字段不同，不宣称底层NTFS/缓存根因或目录原子不变。

另三个新自有材料在产品session启动前，使用独立fixture session，仅从持有父HANDLE相对打开明确由本次fixture创建的目录，逐个真实查询metadata，登记owner，finally真实释放；没有写时间戳、sleep/重试、改变sharing或替换比较器。准备阶段查询3/65/3个目录、释放均True，然后运行原产品/fixture：mixed和深度64 ready/exit0，故障case armed/injected=true、change+1、DIRECTORY_CHANGED/exit9、零ready。日志 m7-repair-root-own-setup-metadata-diagnostic.log，root脚本当前hash及逐条结果/命令见同一修复收据。本探针只为已知自有测试目录提供准备流程依据，不能成为生产预热、任意目录扫描或将原失败改写成功。原未准备失败材料及所有日志保留。

据上述复现仅批准下一步测试准备窄修：当前冻结427为基线，只改既存M7 tree-probe、tree-handle.test与自有M7开发记录三旧，零新增；其余424包括产品树模块、纯模块/测试、M6容量、M3–M6、AGENTS及共同记录全部冻结。准备只处理明确本次创建且有owner标记/已登记路径的有界目录（当前正向最多65个目录、深度64），相对父HANDLE/no-follow、完整身份登记、真实释放且失败关闭；实际产品session和原故障注入在准备结束后才开始。保留所有正确断言/原错误语义、原故障实际触发标记及零ready/reopen门，不能把任何提前拒绝都当故障测试成功，禁止生产fallback、metadata字段豁免、时间戳改写、sleep/重试、分享权限放宽。开发仅串行纯/类型/解析，无真实Windows/进程/build/native/dist/Electron、无Git；冻结后root单窗口复验全部适用新旧门再决定集成。

本地代码/纯回归和原漏检窄反例有本轮证据；整体Windows门仍失败，M7、完整reader/ASAR安全副本/sidecar/manifest/安装/签名/运行/干净Windows、GUI/API/Git均未验。技术窗口已关闭，其他三员工冻结保留，原四批继续、不第五批。工程经验0，现行完整证据与正确断言规则已覆盖，不增重复规则。


## 2026-10-12 重命名后测试准备交付独立复验：PS5.1夹具参数失败

work tree 2（原开发-Sol，同ID/5170/Luna-max）turn 01a12e9c-8188-7192-9325-0c102dba441e completed/error null，实际cursor a5e82ed2-3977-4599-83c1-5556a23795b2:3。root核完整427前后raw/hash、三旧patch逐hunk含EOL重建、其余424不变，main522不变，原HEAD无变化。patch SHA-256 A2218BEE8D1B1369F2DE3D0A0D085D7081635AF8851B81972EC984EB501D7A3A；独立收据 ignored m7-fixture-fixed-independent.json与其frozenBackup原像。root解析器最初假定manifest有count，实际本交付字段fileCount，测试前修正适配后来源核通过；不是产品缺陷。

独立两纯文件25/25、desktop noEmit通过。单协调Windows技术窗口新文件21项实际17通过4失败，23.94秒；混合嵌套、late-subtree-metadata、late-file-metadata、深度64正向失败，原日志 m7-fixture-fixed-root-windows-new.log 保留。新文件失败后不继续旧M6/M4/M5，不宣称本轮旧门通过。产品树模块和纯模块保持；整体M7仍未接受、未main集成，原18/21和先前失败也不覆盖。

源码显示fixture marker函数使用Split-Path -LiteralPath $DirectoryPath -Parent。真实目标powershell.exe单句诊断返回AmbiguousParameterSet,Microsoft.PowerShell.Commands.SplitPathCommand，日志m7-fixture-fixed-root-ps51-parameter.log；原fixture三个新自有有界case均exit3/零ready/PROBE_FAILED，尚未输出准备查询/释放标记，见m7-fixture-fixed-root-stage-diagnostic.log。它与上述参数集冲突相符，须修正测试准备兼容写法，不能改变产品比较器/错误/安全门；普通catch保持固定脱敏文案。root最初双shell命令发生变量展开，改用Python subprocess原参数后得到上述实际诊断；错误尝试不作为产品证据。

late-file-metadata用例未传明示准备路径。它本轮实际exit10而非要求9，不能以提前拒绝称注入验证成功。同一个自有a/b与后续兄弟文件布局已有上轮目录元数据/完整向量变化诊断依据；仅补它的明确本次创建目录a、a/b准备，并保留实际armed/injected标记、原完整metadata比较拒绝、零ready与可重开断言。底层目录时间变化原因仍未证，不添加sleep/重试或生产预热。

下一步仅同线程三旧继续：M7 tree-probe、tree-handle.test、自有M7记录；当前427冻结全像作新基线，其他424（含产品树、纯模块/测试、M3–M6、AGENTS及共同记录）冻结、零新增。修正PS5.1父路径提取兼容性和该故障用例准备，保留有界明示目录/no-follow/volume-ID/单owner/完整metadata/真实释放与原21项正确断言；其他有源码或复现支持的同一fixture内部直接问题可一并说明修正，不能扩展产品。只纯/类型/AST/JS解析，Windows/进程/重型窗口关闭；冻结后root复验实际Windows和适用集成门。GUI/API/完整reader/ASAR副本/sidecar/manifest/安装/签名/运行/干净Windows/Git未验，工程经验0，当前先完成修复闭环，四批继续、不第五批、员工保留。


上述PS5.1测试准备三旧修复已实际派发work tree 2（同ID/5170/gpt-6-luna-max），turn 01a12eb8-bbc9-79a2-aa93-03ed9fe0e64a，cursor a5e82ed2-3977-4599-83c1-5556a23795b2:4，snapshot active/inProgress/error null。427冻结原像/其余424不变边界保持，技术窗口closed；此为派发证据，不是修复或验收完成。


## 2026-10-12 PS5.1修复独立复验：20/21，owner正向夹具仍缺明示准备

work tree 2冻结交付turn 01a12eb8-bbc9-79a2-aa93-03ed9fe0e64a/cursor a5e82ed2-3977-4599-83c1-5556a23795b2:5。root核427完整before/after raw/hash、三旧精确patch含EOL重建、其他424不变；main522与双方HEAD不变。修复仅PS5.1父路径提取和late-file-metadata明示a、a/b。独立25纯/desktop noEmit通过；实际powershell.exe Windows新文件21项20通过1失败（25.573秒），原四个失败case本次通过，但owner-held正常嵌套在ready前拒绝。M7未接受、未main集成。原失败日志m7-fixture-ps51-root-windows-new.log保留，旧M6/M4/M5因新门失败未执行，不以历史替代。本轮协调工具在测试前修正shell引用及当前四个已知协调追加记录的基线字段，没有改产品。

root保留原比较器，诊断仅包装捕获后重抛，以新的自有材料运行：首两个owner样本到ready；另外三个有界新样本两成功、一失败，完整向量中nested的write/change从134362603984194915变为134362603984209954（15039个100ns tick），成员数1/1，armed/injected=false，DIRECTORY_CHANGED、exit3、零ready。另一个明确setupPaths=['nested']的自有样本准备查询2、ownerReleased=True，ready/exit0。日志m7-ps51-owner-stage-diagnostic.log和m7-ps51-owner-stage-samples.log及摘要见ignored m7-fixture-ps51-independent.json。它证明该fixture正常准备尚不一致，未证明OS/NTFS原因；不绕过完整字段比较、不加sleep/重试、不将独立样本成功覆盖原21项失败。

下一步仅work tree 2两个既存文件：tree-handle.test和自有M7记录，给本次创建nested/held.bin的owner-held正向用例显式声明nested，并核fixturePreparation查询2/实际释放；所有写入/删除/文件与目录重命名拒绝、ready持有、最终release和可重开/原内容断言保持。当前427raw冻结为基线，其他425含probe/全部产品/纯模块/M3–M6/规则/共同记录冻结，零新增。开发只纯/类型/解析，真实Windows与重型窗口关闭；稳定后root独立新旧门，不把自测当接受。其他1/3/4已按真实cursor紧凑核无新交付、冻结待命保留。

GUI/API、完整reader/安全ASAR副本/sidecar/manifest、安装/签名/运行/干净Windows及Git未验。工程经验0，现有规则已覆盖完整证据及目标运行时门；只四批、不第五批，技术窗口closed。


上述owner夹具两旧修复已实际派发work tree 2（同ID/5170/gpt-6-luna-max），turn 01a12ed2-05c6-7980-8c39-3348b07dd077，cursor a5e82ed2-3977-4599-83c1-5556a23795b2:6，compact snapshot active/inProgress/error null。427当前冻结原像、两旧/其余425冻结、零新增；Windows技术窗口closed。仅派发，修复和独立接受尚未完成；其他1/3/4冻结保留，四批继续、无Git/新增工程规则。


## 2026-10-12 M7 owner夹具窄修独立通过，精确主目录集成通过

work tree 2 turn 01a12ed2-05c6-7980-8c39-3348b07dd077实际完成、error null、cursor a5e82ed2-3977-4599-83c1-5556a23795b2:7。root从最新派发427/raw前像核两个既存文件精确patch逐hunk及EOL重建、其余425保持，main522保持。新增断言核test-owned准备marker/session/release=true、目录查询2；原四类写/删/文件及目录改名拒绝、ready持有、最终release/closeConfirmed/cleanupSafe、重开/内容断言完整。probe和产品零改。

独立两纯文件25/25、desktop noEmit通过；目标Windows powershell.exe新M7文件21/21通过（25.79秒），继而原M6/M4/M5三个文件125/125（152.57秒）通过。原漏检修复、先前失败及有界诊断证据保留；本次没有重复原独立late-subtree单独探针，不将历史探针算成本轮执行。源像前后稳定；独立收据ignored m7-owner-fixed-independent.json，实际命令/日志/摘要及raw路径在收据中。

随后仅精确集成M7一旧五新到main：522→527，唯一旧修改为M6 directory容量端口，源与初始M7一旧hash吻合；五新为tree module、probe、两个测试、自有开发记录。其他521逐字节相同；来自当前独立冻结raw副本而非整个worktree覆盖，双方HEAD/branch不变。main desktop noEmit与七文件集成回归199/199通过（包含原M3 reader-process 28），主目录及5170前后完整hash稳定。收据ignored m7-main-exact-integration.json记录实际路径、before/after/raw、来源及命令；不是Git合并或提交。

只接受M7有界递归树观测的本地代码/回归与Windows技术门：真实混合/隐藏/Unicode/空文件、129成员、深度64正向及65拒绝、晚到子树实际插入/目录与文件完整metadata故障拒绝、身份/重解析/持有及释放等适用用例通过。5,000文件/8GiB完整实际负载未验，计数限额常数/纯断言不能冒充负载测量。结果仍scope=tree-files、snapshotStatus=incomplete、signatureStatus=not-evaluated；固定64KiB fixture摘要和三样本不等于完整生产清单。未验/未实现边界仍为全量清单sidecar、受控ASAR副本及捕获、完整manifest/双root编排、安装、签名、运行/干净Windows、GUI/API/Git；前四批没有整体完成。

当前技术窗口closed，四个员工冻结保留、不归档。后续只依据现有M2/manifest计划与真实reader缺口继续第四批，不能把M7当完整reader或启动第五批；全部本地门收尾/仅剩外部门才暂停自动与派发。本轮工程经验0，现行完整证据、正确断言和目标runtime规则已覆盖；夹具诊断不能转成生产预热规则。保留全部无关WIP，零Git。
