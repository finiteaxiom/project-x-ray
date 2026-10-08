# S3-C/H：已持有数据库的内部恢复桥接

## 目标、基线与范围

按协调方同名计划实现原四批共享恢复的后续切片。开发基线 HEAD 为 `455d4ad50830ee2495b70927e51caf830a4efbb8`，分支 `codex/llm-explanations`，原有大量未提交内容完整保留。协调方报告 main 已集成 `8b256d60807fca1992f37e8f14235488251fc754`，本轮没有独立核验主目录 Git 或修改主目录。开始前逐文件核对上一 B2 交付全部374文件，复制原始字节并冻结清单。

本轮仅新增内部 locator、其测试和本记录；仅修改 application/index 的构造注册及关闭委派、其测试的末尾追加。既有恢复 core、B2测试、graph、迁移、native、broker、UI、公共导出和 AGENTS 均冻结。

## 实现与实际端到端证据

- 每个实际注册的 XRayApplication 用 WeakMap 持有唯一内部协调器；惰性复用既有 RemoteTaskLifecycle。外部未注册对象、访问器/proxy/额外字段、错误 repo/snapshot 拒绝；捕获不可变严格 SnapshotRef。没有公共 barrel、IPC 或渲染接口。
- 只从应用实际 authority、项目 store 与 snapshot store 映射逐实例去重查找。纯读取 loadSnapshot/getLatestSnapshot 后交给既有严格 binding 检查实际元数据、配置和材料；不同实例同时声称同 ref、错误映射、关闭/损坏/缺失配置或证据均拒绝，不猜测回退。恢复前重新核对实例和映射，配置或材料变动要求显式重新绑定。
- application.close 首先撤销协调器并关闭原生命周期，再执行原 store 关闭。旧协调器和迟到调用不能重新获根或借关闭提交/释放；native 退出与 operation 结算仍由既有 core 证明。
- 新52项回归使用真实 XRayApplication 索引自编源码、原题、精确引用、真实提交评分及准备材料；保留非空历史答题/mastery前像。覆盖 legacy、split、legacy source配项目 settings，两个 purpose 的 reserved/dispatched/failed/completed，真实自编 Node Worker 注册/admission、精确 task/lease/result补偿和 completed 保持。没有执行被索引源码。
- 覆盖 A→B→A、别实例歧义、未知历史 owner/task 不被收养、两连接 BUSY、安全重试、source已提交/global失败窗口的真实进度与精确补偿、关闭期间 operation/真实摘要 await 的迟到拒绝。
- 应用构造之后安装禁止枚举/打开观察门，locator 不调用 requireSnapshot、storeForRepository 或创建远程解释器/currentReference 路由。构造后复制到项目目录的真实但未持有数据库仍拒绝且不加载。该保证仅指桥接：原 constructor 的加载/枚举策略没有修改，不声称整个应用无文件打开。

## 实现—验证—诊断—修正闭环

1. 首次48项运行33通过15失败，29.21秒。hybrid夹具保存默认空配置是 no-op，缺少真实 settings 元数据，生产 binding 正确拒绝；改为实际保存非空规则。缺失/替换映射后测试未关闭孤立 source，导致三个 EBUSY 清理失败；夹具独立跟踪实际句柄并关闭。损坏配置夹具也因空配置未写入而 UPDATE 零行；改为先真实保存再损坏。这些是测试缺陷，没有放宽生产检查。
2. node:fs ESM 命名空间不可直接 spy，测试观察门报 TypeError。改为 default fs 导出加 syncBuiltinESMExports，并在恢复时同步；仍禁止实际打开/枚举。源漂移夹具最初修改和恢复取了不同的未排序首行，材料前像不一致；改为按同一 node_id/snapshotId 修改与恢复原始 payload 字节。没有据此推断 SQLite 优化器原因。一次临时 Python 诊断缺 UTF-8 产生 GBK 解码错误，未修改源文件，是诊断命令缺陷。
3. 真实第二连接锁暴露新桥接缺陷：生命周期 issuer.capture 的原始 SQLITE_BUSY 异常未转换为固定契约错误。仅在新 locator 恢复边界归一化为 BUSY，保留既有 RemoteExplanationError 及真实提交进度；其他非契约异常固定 POLICY_INVALID。没有改 core 或掩盖已提交进度。
4. 修后48项47通过1失败，26.00秒；剩余是上述源漂移恢复夹具。定向旧绑定验证曾1失败1通过/46跳过，3.04秒，追加精确历史前像诊断再次失败，2.97秒；修正精确主键后2通过/46跳过，3.15秒。诊断原始材料和长日志没有写入本记录。
5. 扩充52项后51通过1失败，26.18秒。缺失 overview 回归发现新桥接使用 getOverview/getLatestOverview 会修复并写回缓存，违反恢复定位零写要求；根因由真实 getter 实现及数据库断言确认。改为纯读取 loadSnapshot/getLatestSnapshot，缺失 overview 交由严格 binding 拒绝，未改 graph/迁移。相关缺失/漂移/枚举6项通过、46跳过，4.85秒。
6. 最终新 locator/index/lifecycle 三文件组合101/101通过，exit0，70.36秒（52+25+24）；此后源和测试未修改。四包严格类型检查串行通过后启动原19加新 locator 的完整20文件组合。类型与完整测试未并发，未改变超时或正确断言。

## 实际验证命令与结果

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-recovery-source-locator.test.ts packages/application/src/index.test.ts packages/application/src/remote-task-lifecycle.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\tsc.CMD -p packages/contracts/tsconfig.json --noEmit
.\node_modules\.bin\tsc.CMD -p packages/graph/tsconfig.json --noEmit
.\node_modules\.bin\tsc.CMD -p packages/application/tsconfig.json --noEmit
.\node_modules\.bin\tsc.CMD -p packages/llm/tsconfig.json --noEmit
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts packages/application/src/remote-recovery-capability.test.ts packages/graph/src/remote-task-recovery-store.test.ts packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts packages/application/src/remote-recovery-source-locator.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

四包原 noEmit 全部 exit0，没有安装依赖、修改类型配置或运行构建。完整20文件组合887/887通过、20/20文件通过，exit0，308.23秒（tests293.74秒）；没有测试过滤、放宽断言或扩大超时。

## 冻结、未验边界与规则判断

交付逐文件核对 before374→after377：旧2改变、新3、其余372原字节保持；独立解析输出补丁并逐 hunk 重构原始字节、核对实际最终文件 hash，index.test 原始完整字节前缀保留。冻结目录及准确 before/after/unchanged 清单以最终交付为准，不覆盖旧交付。

AGENTS 本轮新增/修订0：按现有证据、安全诊断及生命周期规则评估，且本切片明确冻结规则文件。两个已确认桥接问题的复现与预防动作记录于此，不以记录替代回归或独立验收。

没有 Git 提交/推送/合并、主目录写入、build/native/dist/Electron、GUI、HTTP、凭据或隐私外发。生产 broker/B2尚未统一；未知数据库的物理安全重开、旧 native 执行域停止证明未实现。内部实际端到端通过不代表生产接线、界面验收或原四批整体完成。交付后由协调方独立验收。

## 独立退回后的窄修：跨真实等待的持有关系门

原桥接未被独立接受。协调方六个真实反例显示：native已退出但operation未结算，或R1实际摘要已计算但await未返回时，应用持有映射新增同ref别实例歧义，原一次定位仍允许补偿和release。这是桥接产品缺陷；原887开发回归没有覆盖它。

修正before采用原377完整交付，开始前377/377哈希核对并复制原始字节。先将两切点×三布局正式加入新locator测试，原断言和时限保留：6失败/52跳过，exit1，3.15秒（tests2.15秒）。失败均为错误成功而不是异常环境；前像在等待时实际捕获。

拟选必要窄hunk：locator在每次recover入口捕获原绑定的ref/source/settings数组，并生成实际注册application同步拒绝闭包；application/remote-task-lifecycle.ts在真实native停止及operation结算后、任何terminal写前执行该门，并将同门传入实际issuer恢复；graph/remote-task-recovery-store.ts在原current SQL前像门并列执行该门，覆盖R1实际await之后及每次source补偿/释放事务。两内部层只接受同步undefined返回，Boolean/Promise拒绝；原native证明、许可、事务、完整前像和source证据校验不变。graph不导入application/Worker/Electron。必要测试分别落在三文件已有测试内；graph/index不需要新委派，application/index及其测试本次也无需修改。

这只是追加拒绝条件；门不得改绑定、清slot或打开文件，不能将应用自报inventory作为native证明。native切点必须SQL零写，R1切点保留已真实提交terminal进度而不删除候选/lease。原章节中的887及初次冻结是上轮开发结果，不能作为本次验收。

窄修补充：生命周期在每次recover开始即捕获原 source capability 数组，不能在native等待后再采集新binding。否则等待中新增binding可能扩大本次来源集合而绕过桥接捕获的原绑定闭包。增加真实operation等待下晚加binding的零写拒绝及新recover安全重试回归；不改native证明或许可。原六例修后6通过/52跳过，2.91秒；两用途/配置实例/close及内部拒绝返回门扩充定向34通过/164跳过，16.51秒，此后加入来源集合冻结回归须再验证。

最终定向四文件（locator/index/lifecycle/graph recovery）224/224通过，4/4文件、exit0，103.76秒（tests101.11秒）。随后将新增晚binding回归的固定10ms观察改为实际Worker threadId=-1门，避免计时猜测；该项再次1通过/27跳过，1.54秒。生产源未再修改。两组补充同时验证原候选/lease/非空历史保持，移除自有歧义或恢复settings映射、显式再bind和新recover可安全恢复；close后只验证实际peer前像保持及旧能力撤销，不假称旧关闭application可重开。

实际四包原noEmit按contracts→graph→application→llm串行全部exit0，再启动前文同一原20文件完整命令，参数仍为单worker/no-file-parallelism/no-cache；无并发类型/测试、无安装/构建。最终完整结果完成后补记。

本次选用7个旧文件：locator source/test、lifecycle source/test、graph recovery source/test、本记录。没有修改graph/index、application/index及index.test或其他370文件。原三个测试文件逐字节前缀保持，既有正确断言、5000ms/60000ms时限不变。AGENTS仍新增/修订0，现有异步身份、前像和安全诊断门规则覆盖；本次失败根因和预防验证保存在本节。没有Git、主目录写入、GUI/HTTP/凭据/隐私操作或重型构建；开发通过仍须root重跑独立六例和适用完整回归，未独立通过前不集成。

本次最终完整回归：20/20文件、922/922测试通过，exit0，256.40秒（tests248.05秒），未改原20清单及运行参数。四包严格noEmit全部exit0，完整组合在类型全部结束后运行。此次增加locator27项（现79）、lifecycle4项（现28）、graph recovery4项（现92），相对原887增加35；原断言全部保留。

本次补充实际命令：
```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-recovery-source-locator.test.ts -t 'held-map async gate regression' --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-recovery-source-locator.test.ts packages/application/src/remote-task-lifecycle.test.ts packages/graph/src/remote-task-recovery-store.test.ts -t 'held-map async|context veto' --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-recovery-source-locator.test.ts packages/application/src/index.test.ts packages/application/src/remote-task-lifecycle.test.ts packages/graph/src/remote-task-recovery-store.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts -t 'binding added during native settlement' --maxWorkers=1 --no-file-parallelism --no-cache
```
四包noEmit和完整20文件命令与上文完全相同，均已在本次窄修后重新执行，不引用上轮结果替代本轮。

本次冻结从原377准确前像出发：before377→after377，旧7改变、新0、其余370原始字节保持。patch从本轮before生成；独立解析输出逐hunk重构并比对实际最终字节及hash，三个测试文件原字节前缀完整保留。完整before/after/unchanged、7个增量文件和对应hash在新manifest，旧manifest/patch不覆盖。HEAD仍455d4ad50830ee2495b70927e51caf830a4efbb8，分支codex/llm-explanations，没有Git写入。AGENTS0及未验生产/安全重开/界面边界保持；本次开发成功不宣称root独立接受。
