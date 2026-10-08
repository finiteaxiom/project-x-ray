# 共享恢复完整性修复独立复验与 B2 超时回归阻碍

仅原四批。审查起点main HEAD `9d9f19aafbdeed5a185ac04bee9af62bf4f1f2e4`、Sol HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`。以下保留各阶段失败与复验；最新结论为内部core及精确main集成独立接受：两目录原19组合各834/834、四包类型及实际source41事务门通过。真实GUI与HTTP均0，生产接线与整批仍未接受，Git实际版本另记。

## 原 Sol 冻结范围

开发回合 `01a11632-a2d4-7752-bc7f-0911f18940ba` 已completed/idle，实际cursor `3e8b4e0b-700b-4971-8c8b-5a686d4d43df:14`。root重算交付373个after文件均匹配；与before实际比较仅recovery source、recovery test和自有core记录三文件变化，其余370字节保持，无新文件。完整增量patch反向check exit0，不写Git。

- manifest SHA256 `1D01420022F76A8EABD89CA905BD24F997EBFEEEBAE268F32EDE2AC6969589FC`
- patch SHA256 `9E2580ED6871E64CAC3BB2EB5DDBEC32DF3CFCFC8F2C53F769F0F3BC7E88A4C0`
- recovery source SHA256 `38FEE2199FB97CC9B6992AA82A3C045170CE2CC1150E15569FBA8E641090D0D9`
- recovery test SHA256 `0FA65E31079E33D7CDF1E19EE63078F61AFAA19A01C4F74D2DA5564FF45406C7`
- core记录 SHA256 `85A3833D63758B960B9E1331C31C6CE71C1A8BA96C0E8BC0520C0FFB14EAD8EB`

source内容与root候选一致，仅保留原LF。补偿前固定完整结果预期，来源重新锁定及context/release后核完整结果/已知源码、题目绑定、原答题、胶囊、兼容成绩与配置历史；不扫描未知库，不宣称可回滚第二连接已提交破坏。旧迁移/生产接线/native源码冻结。

## 当前 root 实际检查

- main本轮fresh索引、真实答题、ready语义材料和实际saveMastery非空材料，随后对Sol实际source运行current matrix29门及semantic12门，合计41全部通过；17故障拒绝、15可回滚故障移除触发器后新permit人工重试成功。非native生命周期证明，未将直接graph issuer当实际停止凭据。
- matrix收据 `.benchmarks/c-core-review-tmp/matrix-AsOXe9/receipt.json` SHA256 `DFC58BFC2BEF209D4B52300ACAC7A4E003EC0D07C6F4A7CDBEDC527251D5F962`；semantic收据 `semantic-current-z9g6i8/receipt.json` SHA256 `A37681B56488F67186FF0DDD8152AC2AC0C6FF1E146F36A88230659C0552DDDD`。fixture详情见root候选记录末节；历史探针没有冒充fresh材料。
- Sol四包原 `tsc.CMD --noEmit -p packages/{contracts,graph,application,llm}/tsconfig.json` 分别exit0。
- 原19文件及原参数完整运行：18文件过/1失败，831过/3失败（834），452.29秒/exit1。恢复88项、原native15项和其余回归通过，三个旧B2 timeout测试均默认5000ms超时。组合命令沿用2026-10-06-shared-remote-recovery-independent-review的原19文件列表，`--maxWorkers=1 --no-file-parallelism --no-cache`。不是全通过或完整core接受。

## 失败诊断与下一窄修

root在main原B2单文件 `-t timeout` 独立复现三失败/78跳过（17.19秒）。自有ignored副本首次跨目录缺contracts入口，零测试执行；仅将所有包导入指向实际main源码后运行，没有改产品或正式文件。观察native工厂通知时watch0/timer0，等待实际watch安装后1/2；但原异步时钟仍三失败，因此安装门不足以解释全部。

真实SQL轮询观察显示模拟60001ms逐次执行2400次25ms轮询；改同步推进仍三失败，不提高默认5000ms。该插桩最后轮耗时5833/5937/5555ms与并行冻结组合同窗，只作为时钟推进开销证据，不称性能基线。仅模拟deadline目标Date/timeout、保留真实interval并等待安装的副本，三个原完整断言3/3通过（5.61秒、默认5000ms保持）。这是测试时钟协调候选，不把副本通过写成正式修复。

进一步main原生产应用实际未缩短60000ms计时：60078ms后TIMEOUT、failed/inflight0/lease0、原T1保持；真实Worker threadId=-1，同实例显式重试completed、第二真实Worker也-1、旧task/答题/源码保持。收据 `.benchmarks/c-core-integrity-candidate/real-timeout-receipt.json` SHA256 `D3582A888ADCCAED528E993EA2EE9977813C96779DB148743D82C8415B564B01`。仅split布局和自编Worker，不外推真实HTTP、GUI或两布局完整接受。

原冻结组合已结束，下一仅允许原Sol B2 test和自有新记录修时钟观察/范围，原source与全部正确断言保持；详见[具体窄修](../plans/2026-10-07-semantic-timeout-regression-fix.md)。须正式三个timeout、B2全81项、原19组合与四包类型重新验证，再root独立复验。没有放宽超时、缩短生产时限、取消代TIMEOUT或重写安全门；有新的产品源证据才讨论范围。

本轮AGENTS新增/修订0：已有真实终态、实际资源停止与完整SQL预期规则覆盖；单一夹具时钟诊断不加入公共规则。队列/审查/交接同步未接受边界，四批仍有可推进本地回归闭环，定时继续，不第五批。

## 正式超时窄修运行中的只读集成核对

root实际比对main与Sol：共享任务store及其test的main字节等于原core before；graph/index仍有Sol解析缓存/发布activation旧WIP，不能整份覆盖main。index.test的当前内容差异仅增加global19存在、project19不存在两断言。result-store.test除本轮19外还存在旧11/12角色迁移差异；后续只追加19，保留main原11断言。七个新core文件及两份Sol设计记录在main尚不存在。上述仅集成风险核对，没有复制、应用patch、运行同批测试或Git。

Sol当前正式B2 81/81及四包类型为开发方报告，未升为root本轮验收。原19组合命令曾误加不存在的shared-none测试路径、exit1且无测试结果；已向原Sol要求核对并严格重跑原19，不将该命令记录冒充产品缺陷或完整通过。root仍等待精确冻结交付后独立复验；生产60000ms、测试5000ms及原正确断言保持。

Sol明确测试文件冻结后，root独立重新核before373：仅B2 test变、新增一份自有记录、其余372保持；恢复source/test仍为上列两个hash。当前B2 test SHA256 `06893AE32E67431BD88EE95932B7AF06A7CE0F6667AE06CEC2C4CB78D639658D`。root对该正式文件运行原 `vitest run packages/application/src/ownership-semantic-application.test.ts -t timeout --maxWorkers=1 --no-file-parallelism --no-cache`，三个timeout全通过、78跳过，5.92秒/exit0。只改有界call-through观察门和目标模拟时钟范围，原native退出/T1/lease/同实例重试断言保留，并给重试补TIMEOUT码断言；此结果只接受三个定向回归，完整834、main集成及整体core仍待验。该次与Sol冻结完整组合并行，不用其耗时作性能结论。

正式交付manifest SHA256 `A3B1977D25627DDC2B4F538D8AF328BE1E168AF632805C474004510D0788D934`，patch `35F9EC5A691A225D7B77A1B72006AE3FFCC55062B8A0B8FEC95093BD4216715B`；root重算after374零错配，精确patch反向check exit0。Sol已idle/frozen，完整组合19文件834/834、440.36秒为其实际交付结果。main原B2 test与Sol本次before内容仅多一个末尾空行的差异，主目录集成应保留原行尾并只纳入实质时钟修正，不整文件引入旧格式变化。

root新一轮原19独立组合尚未结束时，已出现旧application/index.test的“持久化双侧Git报告”默认5000ms超时（5222ms）；期间root确实并行执行四包noEmit，四包最终均exit0。这次调度增加资源争用可能性，尚未以实际串行复验确认根因；保留失败，不归为已证实环境问题，不改5000ms、正确断言或产品源。完整失败结果及无其他检查并行的复验待补；整体core继续未接受。

该组合实际结束：18文件通过/1失败、833/834通过，436.61秒/exit1；同一个Git报告用例还在清理其自有SQLite shm时EBUSY，不强删材料、不修改断言。此时原B2全81、恢复88及其余文件均通过。全部检查进程结束后，root原正式Git报告用例单独运行1通过/23跳过、5.71秒（tests3.94秒）/exit0；没有改测试、生产源或门限。这仅证明单独运行未复现，不能归纳为环境根因确认。随后原19全组合再次按相同参数串行复验，不并行类型/build/其他测试；完整终态待补，当前仍不集成或Git。

## 冻结内部核心接受与精确main集成

root无其他检查并行的原19完整复验实际通过：19文件834/834，425.53秒/exit0。原失败不删除，根因仍只记录可能调度争用，不声称已证明；没有改Git报告用例、5000ms或产品。连同本轮三个正式timeout独立通过、四包原noEmit、冻结完整哈希及既有实际source41门，接受这次内部core与时钟窄修；不接受生产desktop/B2/broker接线、HTTP、GUI或整批完成。

按实际main构造16文件候选，再在写入前逐文件核main前像及候选hash、限定路径。main422→432：6旧文件变化、10新增、其余416原字节保持。只为GraphStore加入恢复实例/窄接口/关闭接缝；未引入Sol解析缓存、publication activation、原生loan或旧broker/UI WIP。result-store.test仍保留main11，仅global追加19；B2保留main原行尾，未引入Sol原多出的末尾空行。原始main字节和完整before清单另存自有ignored材料，不reset或删除未知材料。

集成收据 `main-integration-applied-12864422167249bfaa8fecc52c2e90c5/receipt.json` SHA256 `01B2DF5B15398D6826985DBA5C1227AB5D415F7755D2A5BB43581D5511085733`。main四包原noEmit先单独全部exit0；随后实际main重新索引/真实原题及答题、ready材料和非空兼容mastery。新fixture收据SHA256 `CD8AFCDD1E864FED7283C963E9CC5D976F9BF399CAAF35A1E7F6DE850ABB5B74`，旧fixture收据保留。

对实际main source重跑29 matrix及12 semantic，41全部exit0，17故障拒绝、15移除自有可回滚故障后新permit人工重试成功。新收据目录 `matrix-V05nhH` / `semantic-current-T66wyB`；两者SHA256分别仍为 `DFC58BFC2BEF209D4B52300ACAC7A4E003EC0D07C6F4A7CDBEDC527251D5F962` / `A37681B56488F67186FF0DDD8152AC2AC0C6FF1E146F36A88230659C0552DDDD`，因收据仅固定场景与布尔进度，不以相同摘要冒充同次运行；本轮新fixture、实际main导入、执行命令及新目录分别记录。

自有候选脚本首次默认GBK读取中文test失败，明确UTF-8后生成16文件候选；新fixture命令曾误占helper已有的源码根argv，模块导入失败且零索引，改为源码根argv2/收据argv3后实际索引成功。两者只为协调工具调用/编码缺陷，不是生产缺陷；没有改正确断言或引用历史产物冒充本次成功。AGENTS仍0。

所有前置进程结束后，main原19完整回归已单独启动，最终退出待补。未Git，实际GUI/HTTP0；旧raw graph issuer探针仍只证事务，native停止证明由正式application生命周期用例核验。主目录完整集成尚不宣称最终通过。

main首次组合发现自有ignored候选/备份的同名`.test.ts`也匹配Vitest路径filter，至少四副本0 test入口失败；协调方通过该自有session的Ctrl+C停止，exit1，无完整测试终态，不计产品失败或通过。只对两个已登记自有artifact目录的11个单独test副本核完整hash、解析绝对路径归属后改名`.test.ts.review`；字节/hash保持，零删除，production test不动，备份映射存retained-test-artifacts.json。生成/备份工具同步使用review后缀；没有改全局Vitest配置、过滤真实用例或提高阈值。原19清单 `vitest list --filesOnly --json`实际仅19个production test，exit0；然后原组合无并行检查重新启动。此次是验收材料布局缺陷，记录其真实反馈闭环，AGENTS仍0。

## 2026-10-08 续接核对：主目录完整集成接受

上一连续验收窗口的main原19完整回归最终19文件834/834、422.46秒、exit0（session17139）；没有与类型或其他检查并行。本次续接先核原两聊天idle/冻结、main真实差异与16文件交付收据；没有重做已通过检查。结合此前独立四包noEmit及fresh main source41门/15人工重试，正式接受纯内部核心和测试时钟窄修的主目录集成。

未触及旧Sol缓存/native/broker/UI WIP，无新heavy build/native/dist/Electron窗口。生产B2与feature统一资源域、精确source定位及启动退出证明仍待实施/验收；GUI/HTTP/签名/干净Windows门分别保持未验。仅内部已验范围可Git收尾，不提交GUI成果。AGENTS新增/修订0：既有SQL完整预期、真实停止和失败闭环规则覆盖。
