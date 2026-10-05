# 2D-R1 内部语义结果SQL核心实施

2026-10-05，原第二批共享任务设计第6/7节的必要source append依赖，不第五批。root派原开发-Sol GPT-6.1 Sol/medium，仅5170 checkout。L5已独立接受并提交推送52db0c98dcd6e09590f32473597ceba5cb1d0f10；Q1/Q2/Q3、A2与S3-B已验源保持，不重做原题设计或预先扩公开生产语义API。

## 实际缺口及冻结范围

当前global17有真实semantic task/registry/lease，但source只有attempt/capsule/question binding，没有结果持久表。L5仅候选DTO自洽。下一跨库source append→global completed发布必须先有真实SQL结果核心，本切片完成内部存储、精确补偿支持，不做application发送、发布/复用、恢复或主进程接线。

仅新增packages/graph/src/ownership-semantic-result-store.ts及.test.ts、自身docs/development-runs/2026-10-05-ownership-semantic-result-store.md。graph/index.ts只允许私有实例constructor/migrate/close接线，无公开结果读写API或barrel export；graph/index.test.ts只新增source迁移18期望与保留回归。不得覆盖main11/Sol12及旧cache/loan差异，旧正确断言保持。AGENTS只自身有复现的0–3条候选，允许0；不改公共协调记录。其它graph、contracts、application、LLM、desktop/UI/native、package/lock等冻结。

root先将L5两个文件及index单export精确同步5170，核依赖回归/类型及旧文件字节，保存基线；开发以同步后的实际文件为基线，不reset、rebase、合并或任何Git收尾。模块需使用现有完整L5 validator，不把schema.parse或caller重算hash当认证。

## 内部端口和权威边界

新核心直接操作可信source Database与其GraphStore owner；必要权威global Database由未来可信编排内部提供，不接受任意路径/renderer payload。这是内部存储端口，构造/DTO/SQL记录不证明用户授权、workspace当前性、exact WeakMap prepared批准、真实发送或停止。禁止以可注入成功callback认证题目、许可或provider；既有实际ready材料端口及原完整validateOwnershipSemanticResponse可用于持久材料闭合，生产当次exact prepared validator仍是未来application必需门。

prepare(rawEnvelope)使用L5在首次await前捕获的私有DTO；从实际已保存attempt/capsule/package读取，严格匹配repository/snapshot/attempt/question版本与fingerprint、attemptHash、rubric版本/hash、semantic/deterministic版本、assessmentPackageId、analysis/config/source身份等可由source材料证明的字段。沿用真实包/答案校验器检查全部criteria、允许证据/limitation与UTF-16 answer范围，不只response shape或关键词。无法由本层证明的grant/provider/body发送来源不冒充已证明。无需重写Q1生成器认证或Q2当前性；两者整应用门保持。

prepare返回实例私有一次receipt，无正文/答案外传、不持久完整包或原答案。完整private材料与真正source行捕获、摘要重核不得被异步caller改动污染。将准备期间实际读到的source行/身份绑定到receipt，写入事务内逐项重核；不是仅data_version或捕获后无校验。旧材料/来源变动、其它instance receipt、重复消费、closed均固定拒绝且零写。记录具体捕获行范围与为什么覆盖本层关系，不扫描任意库。

append(receipt, trustedAuthority)在global与source实际事务屏障内同步完成，只接受global核心真实read/assertState得到的同用途、同完整identity/T1且dispatched并仍占用的任务。不能仅用外部传入task DTO或摘要充当权威。本层不reserve/promote/finish/release任务，不访问worker或调用provider，不把savepoint/方法返回当外层COMMIT成功。真实SQL精确持久candidate；完成时间使用原envelope而非重新造T1。写后同时核实际完整payload、列、摘要及目标行，RAISE(IGNORE)/合法但错误触发器终态不得返回成功；失败回滚本次source写入且原占用保持。返回仅存储candidate凭据，不能标为published。

readCandidate(taskId)只限内部，完整捕获实际行并经L5重新校验两摘要，列/payload一致、完整预算及来源关联失败关闭；不能返回“当前/已发布/已掌握”。application未来仍须同task completed、全部identity/T1/结果completedAt/binding/body/response精确闭合和当前性后才公开读。此处不建public成功捷径或按binding任取一行复用。

compensate精确同task/identity/T1候选，必须在global事务内读取实际权威任务且是failed/cancelled/interrupted，source事务内核目标行再删除；completed/dispatched/reserved/缺失/错用途或错身份均拒绝。成功历史绝不删，迟到旧cleanup不能动新任务/新结果。没有本候选时仅在权威非成功同身份已确认后幂等零写；write/COMMIT/BUSY失败保持任务占用和其它行不变，不吞主错误。该支持不证明统一全参与者停止，恢复入口仍不得开放。

## 迁移和数据保持

root分配source结果结构版本18；不是重复使用global17。GraphStore两角色原本都有source/attempt/capsule结构，project及global legacy-source均安装18，普通global结果表可为空；global任务17仍仅global。source FK绑定真实attempt，完整payload有明确272KiB UTF-8上限，metadata列严格匹配L5，不存原题/答案/源码/key/任意路径。用同一事务核既有18标识和对象精确定义；无标识但部分对象、标识但缺/坏对象、migration标识写失败均拒绝并回滚DDL。不改任何旧migration applied_at、旧表/trigger定义、旧source/attempt/capsule/成绩，追加结果不覆盖历史。新结果表保持payload不可变；必要删除仅由上述内部补偿门执行，不能用public任意SQL接口替代。

本切片允许constructor自动安装空结果结构，属于可验后台支持；不把它当应用发布全链完成。main/Sol旧11/12分别保持，其它14/16/17不重定义。真实旧库双布局升级及重开，新增表零行，所有旧材料/来源/标识保持；坏升级全回滚。

## 最小充分验收与交付

覆盖真实索引答题ready材料→strict response候选prepare→实际A2 reserved/promote→锁内append→读取重核→非成功同身份补偿；同库legacy及独立source布局。完成历史保留，同binding不同task、旧cleanup/新slot、错purpose/identity/T1、重算外层摘要但坏内部response、恶意字段/getter、准备期间caller/source变化、重复/跨实例receipt与关闭拒绝。实际两SQLite连接BUSY/写前变材料；真实SQL RAISE(IGNORE)、错列/合法错payload触发器、append/补偿/迁移及外层COMMIT故障，原task/lease与旧成绩/source保持。外层失败不宣称方法返回证明提交，也不自行释放slot。

新store、A2任务/shared/旧remote/index/capsule/question/preparation适用graph回归与graph/application/contracts noEmit单worker/no-file-parallelism/no-cache；无native/build/Electron重型并行。不删旧正确断言/盲更新快照/改安全设置。首次核实际cwd/HEAD/基线/来源，实施前保存所有旧文件hash及允许旧文件原副本；交付明确冻结、精确patch/新hash/其余原字节保持清单、实际失败诊断/修正复跑及未验证门，root独立验收后收尾。

无真实HTTP/密钥扫描/用户授权或隐私控件操作、GUI、执行导入项目代码、外部购买/公开二进制。复杂跨库应用编排及参与者恢复另按实际本切片交付派窄任务；当前只R1，不主动扩大范围或第五批。

## 2026-10-05 R1必要角色断言窄补充

root核实际shared-remote-task-store.test.ts:164–173原GraphStore角色回归，源SHA F71170D3FC7D78F7C37228966CB80FADE7B59E254EC01B22498F92A8E90DD8FC，与main及349原基线一致。该测试原global仅semantic_tasks/no result的断言早于R1 source18；本计划明确两角色安装空source结果表，原断言因此须按已授权语义改变，不是移除正确安全检查。允许只窄改该一个测试标题与该表清单断言，并增加两角色source18/结果零行与无公开result读写API断言。保留project无global14/registry/lease、global17 semantic task隔离、重开全表字节一致和原无公开semantic dispatch断言，其它shared测试及生产shared核心冻结。记录原失败及迁移语义依据，不盲更新快照或改弱角色隔离。原349基线保持作为字节来源，此文件新增明确允许变化；本计划变动及副本同步属于root协调来源，开发patch不纳入计划文件。

## 2026-10-05 R1胶囊旧迁移清单窄补充

root核实际ownership-capsule-store.test.ts:216，Sol原SHA 9359C1E2001C7F9941437934CB1FCA0B21EC7348F6A6306673B08C2A69FA6F8C；该真实GraphStore双INSERT/重开测试列出原1–12及15，与本切片自动安装source18不再一致。允许仅在该一处迁移数组末尾追加{ version: 18 }。Sol原12与main原11分别保留；不改任何题目、胶囊、评分、prepare-only、原题绑定、外键、源码及重开断言，不改该文件其它测试或生产胶囊核心。原文件已另存root原R1基线目录；349基线不重置，此文件新增明确允许变化。记录原完整组合454/456中此迁移期望失败及新18语义依据，复跑原完整组合和三个包类型检查后提交精确冻结交付；本补充不是失败豁免或独立验收结果。
