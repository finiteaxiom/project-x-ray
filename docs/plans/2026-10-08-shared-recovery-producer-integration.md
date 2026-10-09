# S3-C：真实生产者登记与统一恢复接缝实施方案

2026-10-08。仅原四批下一必要内部接线方案，当前不实施源码。沿用共享任务设计第6节、共享恢复实施方案及已接受 S3-C/H；不重设计 SQL、许可、native 全域停止或 source 恢复算法。

## 结论与选定顺序

选定“一个实际 XRayApplication/authority 内编排两用途、真正执行 Worker 在 prepare/reserve 前登记、start 才发送实际已验证请求”的内部切片。先交付两用途真实本地端到端，不先替换 broker.stopConfirmed，也不把 RPC Promise 包进 root.admit。当原内部切片通过后，再将同一编排根放到 desktop 的协调 Worker 中，main broker 仅路由和监督该真实宿主 Worker。禁止 main 和 child 各按同一路径建立恢复根并称为同一根。

B2 必须把现有单阶段 createWorker(prepared) 改为两阶段：注册真正承担这一次执行的 Worker（可信程序启动、尚无请求正文/密钥/网络），随后在已有 begin 的精确当前性/身份门内向同一个 Worker 发送执行请求。它不是用来填 inventory 的空闲替身，不创建第二个未登记执行 Worker，也不靠“从未执行=true”签全域停止证明。prepare 失败、reserve 前取消都必须终止并保留该真实资源登记到原生退出；全域恢复仍走既有 proof，零 participant/unknown owner 仍 blocked。

跨线程最小修订不是增加一条“已停止”消息，而是改变任务权威写入所在的宿主：编排/准备/校验/SQL放在同一后台协调 Worker，执行子 Worker 仅接实际请求并返回响应，不打开 global/project DB。main不能借自己的 policy 连接收养 child 的 reserve。这样 root.admit 内部确实观察同一实际 authority 上的同步 reserve 前后，原 #ownedTasks 算法无需跨连接收养新入口。

## 当前源码与连接证据

以下行号均指本 checkout 实际源码，实施前须按集成后的目标重新核对。

|实际符号/位置|当前行为与约束|
|---|---|
|apps/desktop/src/main.ts:152–161 startOwnedApplication|main创建 ExplanationPolicy，另创建 explanation Worker 和 analysis/query Worker；不是创建一个可直接取得 held root 的 XRayApplication。单实例锁不证明旧执行域全退出。|
|apps/desktop/src/explanation-policy.ts:10、11–26|每个 policy 都 new global GraphStore；refresh枚举/打开项目库，stores有 fallback。不能把它作为 held locator 或同实例身份。|
|apps/desktop/src/explanation-worker.ts:13–21|同一线程也分别构造 policy 和 application，至少两个不同 global GraphStore/连接；runtime用policy，application只供workspace检查；close分别关闭。|
|apps/desktop/src/explanation-worker-runtime.ts:23–53、55–71|RemoteExplanationApplication从policy的authority/stores建；receive异步并发，reset换application、controllers/events；不能以丢弃旧events Promise证明其结算。|
|apps/desktop/src/explanation-broker.ts:7–12、53–78、110–122|结构 WorkerPort/terminate Promise/exited标志；最后旧 feature-only recoverInterrupted。真实 main factory 是Worker，并不使结构端口的任意Promise成为原生证明。|
|同文件:189–223、225–232|prepare经RPC；start返回handle后25ms转发，handle不是完整持久identity；cancel/status/result也经RPC；queued cancel可以没有实际持久task。|
|packages/application/src/remote-explanation.ts:83–88、171–223|gate核真实revision/activation；实际credential read、workspace与完整body重建后，在207–210 reserve，213–221 promotion/dispatch。prepared preview与FeatureReservation是本实例能力，不能通过structuredClone搬给main。|
|同文件:243–274|异常finish、补偿、未dispatch终态和finally release中有gate之外的同步写入；只给主gate加scope不足以挡住冻结后的清理。|
|packages/application/src/ownership-semantic-application.ts:35–37、55–74、94–110|内部执行工厂默认没有生产HTTP/凭据；prepare和reserve在Worker生成之前，Worker到start/begin回调才创建。单纯包createWorker不会登记reserved生产者。|
|同文件:39–53、118–161|本地stopWorker、activeOperations、start/cancel/read和release独立；read是实际异步来源验证，prepare尚未纳入该计数。不能把局部计数当两用途全部结算。|
|packages/graph/src/ownership-semantic-reservation-store.ts:48–83、132–171、177–204|真实opaque token产生identity/T1；begin的workspace await后promote并执行；publish有多个真实await后append/source commit/global completed；fail/cancel/release有独立事务。需同步写入门接缝，不能把整个Promise返回给admit。|
|packages/application/src/index.ts:394–428|当前只有semantic preparation工厂；createRemoteExplanations可用同application的authority，但currentReference会枚举。正常准备与恢复定位分开；新内部工厂不能给恢复调用这个枚举端口。|
|packages/application/src/remote-recovery-source-locator.ts:60–101|注册实际application及私有held maps，close撤销，恢复闭包捕获原绑定并跨等待复核。唯一实际实例根应继续从这里取得。|
|packages/application/src/remote-task-lifecycle.ts:14–26、43–53|唯一根以GraphStore对象为key；admit同步读取原占用/实际新占用，只记录准确owner/purpose的新task；native等待前捕获sources。不能包postMessage就声称child reserve已被登记。|
|packages/application/src/remote-recovery-capability.ts:21–32、39–56、63–87|登记立即调用factory并持真实Worker；prepare/work计数/同步admission；全部实际原生退出和操作结算才发proof，空participant/unknown拒绝。保留算法。|
|packages/graph/src/shared-remote-task-store.ts:260–269|占用来源是严格registry/lease及分purpose task和全部context前像。owners来自实存context/occupied，不来自broker issued数组；旧owner无真实登记仍拒绝。|

main集成/推送 a8194ef4 与0dfa0317及两目录922回归是协调方记录已核结果。本开发目录HEAD仍455d4ad50830ee2495b70927e51caf830a4efbb8，分支codex/llm-explanations；本轮仅只读核对该Git状态，未重新执行这些测试或远程Git验证。

## 下一内部切片的实际调用顺序

内部工厂置于 held 注册模块内，从实际注册application捕获authority/source/settings及close状态，构造两个流程并给每个流程绑定不可克隆的producer端口。只返回用例方法和实际原有preview/reservation，不返回GraphStore、SQL、native proof或任意路径。端口不入application公共barrel/preload/renderer。构造者提供固定可信native执行factory，不允许调用者提交inventory、Boolean stop、结构WorkerPort、任意“已停止”回调。现有公共结构端口不得作为生产统一模式的安装入口。

1. 每个owner/generation接受第一个prepare之前，在已有root.create的factory闭包里创建这个用途真正的执行Worker，捕获准确Worker和participant。跨两用途的prepare/pending预算由同一个root计数，数据库仍只有原provider lease。owner来自实际context，非调用者字符串摘要；注册后才打开用例门。
2. prepare包在root.operation(participant, prepare)中；先绑定当前实际ref/source/settings，再执行真实workspace、L5/body准备。一次准备只属于该owner/generation和实际prepared对象；freeze期间拒绝新prepare和迟到preview。cancel/read/start采用work scope，失败仍finally结算；不能把start范围缩为等到第一条Worker消息。
3. feature reserve及promotion/dispatch的原同步gate、所有异常finish/补偿/未dispatch终态/finally release/cancel，均通过producer同步admission再执行原真实SQL门。root.admit回调必须返回同步task/receipt/void，而非network Promise。完整body/prepared对象、真实credential revision、实际permission/authorization检查全部保留；身份来自真实准备，不能由RPC handle或DTO bodyDigest重造。
4. semantic reserve通过同步admission包住实际opaque token消费和原跨库事务；root捕获真正提交的新occupied identity/T1。begin/workspace、publish的L5/R1/workspace等待之后，在原同步事务入口调用绑定producer的写入门，再保留全部原material/current/SQL核验。不能只在flow.start入口检查一次。cancel/fail/release对应事务也走同门。graph只接同步拒绝/写入包裹端口，不接Worker停止证明或application实现；其已有原生单任务release门不降低。
5. graph begin回调先安装响应监听，再向prepare前登记的同一Worker发一次精确执行请求并返回它。发送的body来自真实私有prepared.body，父编排端保留原WeakMap准备对象用于响应验证，不传其能力token。不存在追加第二个执行Worker。promotion COMMIT失败已可能发送，latch、真实资源与持久lease仍保留；不能偷偷再次start。
6. 正常success/failure/cancel：停止当前真正执行Worker，核模块捕获的原生状态，再在原精确published/非成功补偿门内release自身task。全域freeze已开始时，普通producer禁止finish/补偿/release，错误保留lease，由原root.recover在所有操作退出后完成。避免在尚未结算的start/work内部await全域recover而自等死锁。普通取消不关闭其他owner context，也不调用全局恢复。
7. retire只关闭该producer新入口，原native域继续保留其实际Worker及未结算操作；所有退休generation都留下，不用broker单项retiring覆盖。成功读取也在work scope内追踪；新generation出现前旧scope结算，旧返回/事件不能跨context再发布。close只撤销并请求终止，不借同步close返回释放lease。
8. 全域recover仍原样：停止所有实际已登记Worker→真实操作结算→held异步context veto→strict capture/ownedTask/一次permit→terminal→精确source→context/release。新unknown/旧context无参加者、无held source/歧义、closed/settings变化保持blocked；不补造登记。

单任务停止需在原native模块增加一个窄内部“停止此实际participant资源并核原生退出”的方法，复用已捕获getter/terminate和private stop；不签全域proof、不删participant、不声称其他scope已结算。lifecycle仅委派给内部producer端口。B2现有graph release仍核同一实际Worker；feature也必须等该精确资源门后才release，不能因provider响应/abort Promise结束先释放。此为新增窄端口，原freeze/consume/recovery算法不改。

## 文件切片与不能三文件假完成的原因

下一实施须root批准下列准确范围；本轮不修改它们。选用必要source及各自回归，未需要的index hunk不预先改。

|拟改source（及同名.test.ts）|必要hunk/端到端作用|
|---|---|
|application/remote-recovery-source-locator.ts|实际注册application内可信工厂、两用途producer闭包、same authority绑定；不public导出，不返回store。|
|application/remote-recovery-capability.ts、remote-task-lifecycle.ts|上述精确单participant停止的窄内部委派；复用原native实现，不改变proof/ownedTasks/source算法。|
|application/remote-explanation.ts|实际async scope和全部同步mutation门；原body、credential、permission及异常主错误保持。|
|application/ownership-semantic-application.ts|真正execution Worker提前创建/登记、start只发送、prepare/start/cancel/read scope及退休；用同一root，不第二套全局恢复。|
|graph/ownership-semantic-reservation-store.ts|reserve/begin/publish/cancel/fail/release的内部同步write gate，尤其实际await后的提交；原身份、token、native单task release与跨库门不变。|
|graph/index.ts|仅将producer绑定的内部同步门传到实际ledger；不新增公开renderer API、不新增migration。|

至多7个source及对应7个测试（14文件）和实施记录；具体最小hunk需root派发，不是当前许可。同步门必须由可信factory闭包安装，不允许renderer/普通调用者用自己回调授予权限；返回Promise/Boolean仍拒绝。当前graph/index上既有类型方向只传播同步拒绝/包裹函数，不能反向依赖application。

原核心三文件（native capability、lifecycle、graph recovery）能支持内部真Worker登记/计数/停止/全域恢复；只需前两者加精确资源停止端口，graph recovery本次保持。它们不能独自接入生产者写入。若“原三文件”指producer层 locator/remote application/semantic application，能落地可信构造、Worker提前登记与operation scope，但graph publish内部await后的append无法仅靠三处外层包装阻止，故ledger/index的窄同步门为源码证据支持的必要扩展。不能先交只有未连接接口的三文件并称已统一。

上述内部完整切片可用两用途真实流程和实际Node Worker/SQLite离线证明，feature provider以自编Worker处理实际准备的fixture请求、semantic以同一两阶段Worker处理真实Q3/B2材料；不启用HTTP/默认凭据，也不因内部通过改变desktop入口。保留现有非生产测试构造，但生产统一factory不得回退旧未登记路径。

## broker跨worker许可：后续实际接线而非回执收养

后续精确拟改desktop文件：explanation-worker.ts/runtime.ts、explanation-policy.ts、explanation-broker.ts、main.ts及对应测试；新增私有control schema/runtime文件仅在root批准确切路径后落地，不塞unknown到共享renderer协议、不改preload/UI。若生产feature transport拆出，另批准固定内部执行worker入口；当前semantic没有生产transport，不在此提前启用。

- 现explanation Worker成为后台协调宿主：只构造一个实际XRayApplication和一个held producer factory；runtime两用途编排的authority/store实例均来自它。worker内policy改为绑定这个真实authority的窄策略视图，不再new第二global store。main policy保留独立连接只作policy/context授权提交与查询，不负责task恢复，也不拥有第二held root。
- main的实际new Worker被其可信宿主监督端口持有，按原生getter/terminate检查退出；broker结构端口可继续用于普通RPC测试，但没有任何恢复许可。main收到私有ready/control只核channel归属、owner/window/context/generation/request序列与预算，再路由已有用户请求；这个消息不是NativeRemoteStop。
- reserve、promotion、append、completed和release在协调宿主的同authority连接执行，凭已有root同步admission得到实际owned task。子执行Worker不建数据库、不把opaque preview/ledger/R1票据发给main。main看到handle/terminal通知，仅重读严格持久完整identity/T1并走现事件门，不能把handle、summary或预备attestation提升成许可。
- 恢复请求来自main关两用途入口/事件gate之后；协调宿主用原root实际停止/结算/恢复，返回固定progress/错误供展示。main的普通RPC Promise完成不授权再清库。宿主崩溃/被杀时，main不能依据其exit或单实例锁对未知子Worker清lease；完整父内子资源退出绑定须后续Windows真实实验，无法证明时blocked。不得为了监督便利给main新的外部task adoption API。
- context/authorization/provider/credential更新仍经现真实策略和OS凭据端口。private控制只路由操作与失效epoch；不凭DTO声明“授权=true/credentialRevision=N”替代真实policy/credential检查。凭据不入消息日志、DTO持久化、SQLite或renderer；实际钥匙仍仅受控后台OS凭据适配器的短期内存。prepare和提前创建Worker均不得读key/发请求。

这修订了旧“同coordinator接broker”未明确的对象/连接假设，并明确保留后台执行边界。旧worker内HTTP资源不能仅登记宿主自身就宣称全域停止；需要真正执行子Worker及退休资源被宿主root创建，或另有Windows已验父子退出绑定。在前者未接完之前，旧broker的recoverInterrupted保护不放宽，semantic生产入口仍关闭。

## 最小真实验收矩阵（本轮均未运行）

|门/组合|具体失败切点|必须观察|
|---|---|---|
|两用途×legacy/split/hybrid|prepare前Worker创建异常/Proxy/Promise；prepare await时freeze|native unknown保持blocked；创建前预算拒绝；无slot/正文发送；真实旧scope必须结算，迟到preview拒绝。|
|两用途reserve|同步SQL触发器/COMMIT失败、第二连接BEGIN IMMEDIATE竞争|root确实观察准确occupied identity/T1；失败零task/结果，不能另一用途双占；不可由worker消息收养。|
|B2 reserve-before-start|真实登记Worker仍等待execute，reserved后freeze/cancel|全域recover实际退出后interrupt原T1并精确release；正常cancel用原opaque ticket；不发prepared/body，不模拟“从未执行”证明。|
|两用途dispatch/promotion|真实执行请求已发而promotion COMMIT失败|真实Worker必须停止；slot保留直到原source检查/补偿；执行计数1、人工恢复0重发；精确原主错误。|
|prepare/start/cancel/read与事件|各真实await后freeze；旧generation late响应/事件|所有实际SQL提交门拒绝，全部旧operation结算；result read虽只读也不得返回旧context数据；无自等recover死锁。|
|两用途发布/两连接|source append提交/global terminal失败；cleanup/release BUSY|原候选/R1真实材料验证、真实阶段progress、非成功精确补偿；成功/旧attempt/mastery源码保持。|
|退休资源|同owner多个实际generation、两用途并发操作、一项仍原生活着或pending|原native清单全部覆盖；零全域permit/补偿/释放；精确单资源stop不能签全部停止。|
|held异步身份|沿已验两切点换source/settings/closed，追加真实别实例歧义|native切点SQL零写；R1保留已terminal进度但候选/lease保持；恢复映射显式新bind安全重试。|
|预算/identity/授权|两purpose合计pending/prepare上限、错owner/task/T1/完整body/credential revision|严格拒绝且固定码；DTO摘要、假exit/普通Promise/Boolean皆不能开门；旧unknown owner占用保持。|
|desktop后续私有channel|错main Worker/generation/window、假ready/exit、超预算、断线|不能出现第二root/清占用；完整身份实际DB门；Windows父子退出/单实例/真实Electron另验，不用本地fixture替代。|

内部切片最小回归为上述生产者工厂/两流程/ledger及原20完整组合，加四包原noEmit，串行单worker/no-file-parallelism/no-cache；新增严格私有协议需对应真实Worker交互回归。desktop接线再加broker/runtime/policy/startup及desktop类型，heavy build/实际Electron由root单窗口另开。真实HTTP/费用、OS凭据、用户隐私授权、Windows安全物理重开均不由本方案实验代验。

## 本轮交付与门禁

本轮仅新增本方案与同名development-run，before377旧文件/AGENTS/旧WIP全部原字节保持；没有运行测试、typecheck、build、native、dist、Electron、HTTP、凭据或主目录写入，没有Git写操作。矩阵和端口是具体待实施方案，不报告为已实现。AGENTS新增/修订0：仅源码阅读，没有新复现实验可沉淀公共规则。冻结后等待root审查、批准必要具体源码范围再实施；非第五批，不另造准备轮。
