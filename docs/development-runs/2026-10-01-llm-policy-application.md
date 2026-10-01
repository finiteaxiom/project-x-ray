# 1C-2A：远程解释策略与应用任务核心

## 目标、基线和范围

基线为 `00651a5f933f47f03000c0f579b75c73609304f1`，分支 `codex/llm-explanations`。开始及恢复时核对目录、分支、HEAD和工作区；保留中断时的改动。协调方之后的main文档提交未合并到正在编辑的工作区。只实现已接受ADR0007的graph/application核心；1C-1已经接受，但第一批端到端远程功能尚未完成。

本批没有修改desktop、ui、native、llm、分析器、普通WorkerRequest、XRayApi、IPC、ADR或计划；没有API账户/key、环境或OS凭据扫描、真实OpenAI请求、导入项目执行、重型构建、Electron操作、提交、推送或合并。测试中的凭据和provider均为明确注入的协议数据，无生产默认替身、隐藏开关或替身导出。

新增依赖仅application→既有内部 `@project-xray/llm` workspace连线，用于复用已验收的证据裁剪和叙述引用校验；平台和已有包满足实现，无新增runtime第三方依赖。实际执行：

```text
pnpm install --filter @project-xray/application --ignore-scripts --lockfile-only --offline
pnpm install --filter @project-xray/application --ignore-scripts --offline --frozen-lockfile
```

两条命令exit0，未下载依赖、未运行生命周期脚本；lock仅新增application importer的llm三行。

## 实现

- 实施前确认原迁移最高9。迁移10按显式 `global/project` 角色创建表：global含provider、项目授权、context、task及兼容结果；project仅增加结果表，不创建global策略表。旧快照payload、源码和创建时间不改写。旧调用者默认project；application明确指定实际global及project角色，不根据renderer输入或路径推断角色。
- provider只保存model、token上限、非秘密凭据状态及两类修订；默认unconfigured。授权默认denied，授予需要完整六类披露和当前唯一purpose，修订冲突/损坏失败关闭。配置、授权、context、task和结果均经strict契约及关联检查；错误重新转换成固定文案/枚举，不保留异常文本。
- `commitTrustedContext`供可信main适配器调用，不是sender校验或IPC。每次提交生成新handle并递增epoch。提交失败关闭本实例旧预览/准备/任务；另一进程的main仍必须维持门禁关闭并终止worker，不能把本地阻止当作权威DB成功提交。
- prepare、dispatch、publish每次读取SQLite实际激活时间、快照结果指纹、source manifest、配置/ignore、provider/credential、授权、owner/context；不使用application构造时的current缓存作为许可。same-snapshot重新晋升也失效。没有analysisResult的旧快照保持离线读取，但远程必须重新索引。
- 按global→project-settings→legacy/source/result固定锁序使用同步IMMEDIATE事务。许可调用发生在同锁复核后、日志登记后；不在同步事务中返回Promise或await。网络等待不持DB锁。250ms busy失败关闭；调用不证明物理字节已发送，先前许可不能收回或保证退款。
- 有界SQL检索12候选、深度6/80节点/160边/1200工作量；保留file/unresolved端点，拒绝悬空关系。边proof至多160、每节点取至多2个Supporting proof，总候选不超过320；同范围证据最多读取8项，选取/省略说明进入完整本地limitations。manifest只读取相关路径且上限80，snippet只读取同不可变快照的SQL source，复用llm真实哈希/范围/闭合验证。所有本地unknown、partial、截断及文件系统非原子限制独立保留；超出本地envelope预算拒绝，不偷偷删除限制。
- 每owner最多一个内存预览，5分钟过期；包和完整body摘要在start前重建一致才许可。无provider端口时bodyDigest为null，start拒绝。真实HTTP body摘要及最后一次digest核对须由后续生产provider适配器实现；当前验证的是明确注入的协议body，未证明真实OpenAI wire digest。dispatch端口接收获批准digest，不接任意endpoint。
- 凭据只通过窄内部port临时读取；未配置/不可用/读取失败零网络。总任务绝对deadline90秒；取消、context切换和重启中断不会付费重发。SQL全局唯一inflight占用跨owner/连接；政策撤销形成terminal仍保留占用直到本地请求清理。重复taskId、重复响应至多一次terminal/结果。
- 发布锁内再次重建选中证据并核对，捕获同长度source篡改；结果只存经校验叙述、身份、无snippet的精确引用及本地限制，不写图事实，不保存包/key/body/原始响应。拒绝输出值精确包含本次配置凭据；这不等于源码秘密检测或JS字符串可可靠擦除。结果读取需成功权威task+同身份、当前context/DB版本及再次文件系统检查。

## 真实反馈闭环

### 初次类型检查：实现错误

初次application/graph `tsc --noEmit` exit1：当前Zod对象没有 `innerType()`；health还包含idle/indexing/failed，不能当ready/partial。根因确认。改用现有Zod `.shape`，远程入口显式拒绝非ready/partial；两包类型检查随后exit0，旧graph11测试通过。没有降低断言或改历史金标。

### 跨库权威terminal COMMIT失败：产品缺陷

新增两个真实SQLite库的延迟外键约束，在完成状态UPDATE的权威事务COMMIT处失败。原始复现命令：

```text
pnpm --filter @project-xray/application exec vitest run src/remote-explanation.test.ts -t 'COMMIT|insertion failure' --maxWorkers=1 --no-file-parallelism
```

exit1：3 passed、1 failed、33 skipped（过滤器导致skip，不是豁免）。失败断言为结果行应0，实际1。根因：项目库内层事务已经提交，权威库外层COMMIT失败；持有全局锁不意味着两个库原子提交。读取门禁已拒绝返回，但未发布结果清理不完整。

修正：先记录非成功terminal，再按固定锁序、权威task精确身份，只补偿这个task的未发布行；completed历史一律保留。发布/读取持有此前锁定的具体source端口，避免重新解析store产生另一个连接。相同回归变为0行；source snapshot/payload/创建时间不变。普通插入失败、许可日志插入失败及许可日志COMMIT失败也通过：日志插入失败dispatch=0；许可COMMIT失败时先前许可dispatch=1、signal已abort、无日志/结果/成功事件，不宣称网络可回滚。再验证当时application37项及两包tsc通过。

### 输入proof预算：产品缺陷

构造80节点、79调用边，每节点8条同范围proof的实际持久图及源码；原有直接合并产生719候选，超过已验收llm输入320上限，预览失败。原始命令：

```text
pnpm --filter @project-xray/application exec vitest run src/remote-explanation.test.ts -t 'bounded 80-node' --maxWorkers=1 --no-file-parallelism
```

exit1：1 failed、38 skipped。根因确认，不能把输出24-proof上限当作输入裁剪。修正为每节点选择至多2项、保留全部有界边proof、说明已读/选择/省略数量；没有删file/unresolved节点或制造悬空边。保持SQL检索的函数优先次序，endpoint仍优先。对应case及当时全部application39项、tsc通过。

### 协调方中途风险检查：异常退出与cleanup失败

中途反馈为风险检查，不作为审查方已复現/已验收。新增最小故障注入和重新打开真实临时SQLite库：手工建立“项目结果已提交、权威task仍dispatched”的崩溃切点，模拟恢复；没有强杀真实桌面worker。恢复只中断任务、关闭旧context、解除已结束worker的占用，不重发。未发布物理行安全保留但应用不能返回，旧taskId不能重用；新context、新预览、新taskId的第二次明确start才产生另一次调用。之后按已知task身份清理旧行，新的completed结果和旧源码保留。

用实例方法故障注入覆盖finish BUSY、补偿BUSY、release BUSY，无生产测试开关。修正finally控制：finish/补偿失败不调用release，保持inflight；release失败不掩盖此前固定terminal错误；terminal事件在清理成功后发送，没有成功事件。补偿失败的遗留不能被描述为“已清到0”：应用读它为null，新dispatch为BUSY；可信恢复后仍是非成功私有行，需按精确身份显式清理。

异常退出/持续IO失败下，不保证跨库原子提交或物理零遗留。恢复责任：下一批可信broker必须先终止旧worker，再中断任务、使context失效；只对已知非成功terminal同身份调用清理端口，不能扫描所有目录、删除completed结果或自动重新发送。应用读取以权威completed+精确身份为门禁。故障注入的断电切点验证与真实worker生命周期/桌面异常退出验收有区别，后者未执行。

### 环境与检查工具

恢复授权期间协调方提到服务端模型容量错误，按环境通知保留现场，未将其归为产品测试失败或擅换模型；本轮本地测试没有该错误。两次补丁上下文顺序错误被apply_patch原子拒绝，核对未部分修改后按文件顺序重试；不是产品缺陷，不沉淀规则。没有ABI重编译需求，使用现有Windows测试运行时；不以pretest/native/build来补环境。

## 首次冻结验证（独立审查已退回）

下列为取消缺陷修正前的首次冻结历史，不能作为修正后的验证结果。仅运行本批相关contracts/graph/application测试，无全Turbo、native、build、dist或Electron。使用 `exec vitest` 避免application的pretest生命周期。

```text
pnpm --filter @project-xray/contracts exec vitest run src/index.test.ts src/ignore-settings.test.ts src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @project-xray/graph exec vitest run src/index.test.ts src/snapshot-immutability.test.ts src/ignore-settings.test.ts src/remote-explanation-store.test.ts --maxWorkers=1 --no-file-parallelism
pnpm --filter @project-xray/application exec vitest run src/index.test.ts src/ignore-settings.test.ts src/snapshot-result.test.ts src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism
```

contracts：3文件36 passed，exit0；graph：4文件30 passed，exit0；application：4文件83 passed，exit0（含44项新remote核心测试）。合计11文件149 passed，无最终skip；不是全仓测试。application最后运行44.28秒；性能数值只描述本轮测试过程，不是产品性能结论。

```text
pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit
pnpm exec tsc -p packages/graph/tsconfig.json --noEmit
pnpm exec tsc -p packages/application/tsconfig.json --noEmit
```

三包均exit0。真实最小TS索引→SQL不可变source→preview→明确注入协议→追加结果及外部源码变化拒绝的应用测试通过；这不是实际提供商网络或桌面worker验收。

首次冻结清单：7个修改、5个新增，共12文件，符合下面清单。tracked `git diff --check` exit0；新增文件独立no-index空白诊断检查（新文件差异exit1不当作失败）核对后冻结。desktop/ui/llm/analyzers/contracts index/ADR/plan差异为空；生产核心无fetch、环境读取、日志、OS凭据读取、测试导入或隐藏开关。只用内部窄端口；lock只有workspace importer三行。此次冻结随后因下面取消缺陷退回，开发记录与规则不替代审查方独立验收。

## 独立审查退回与取消修正（2026-10-02）

协调方通过真实 `indexProject` 发现：start等待凭据时，合法cancel返回CONTEXT_CHANGED，释放等待后仍dispatch并completed。生产网络调用为0，仅使用明确注入端口。在本worktree新增真实索引、策略配置、factory和SQLite路径，分别阻塞凭据读取与源码当前性检查，实际复现两种等待点。

```text
pnpm --filter @project-xray/application exec vitest run src/remote-explanation.test.ts -t 'real indexed start can be cancelled' --maxWorkers=1 --no-file-parallelism
```

修正前exit1：2 failed、44 skipped（过滤器）。期望cancelled，实际CONTEXT_CHANGED，属于已确认产品缺陷。根因是start已进入内存running，但尚未登记SQL许可；cancel只查SQL，找不到任务便拒绝且未中断本地controller。

修正：按当前context/owner/epoch及完整task身份验证内存任务或持久任务。合法预派发取消先abort本地等待，再事务记录一次cancelled/CANCELLED、inflight=0；不登记dispatched，不取得网络占用，不伪造许可。start取回这个同身份terminal并只发送一次终态事件。preparing是strict、非秘密的瞬态status，持久任务契约明确拒绝它。未知UUID、其他owner、失效handle失败关闭；重复取消返回同一terminal。

迟到Promise在checkpoint之前接入拒绝观察，避免凭据端口同步取消后返回拒绝Promise产生未处理拒绝。晚到成功、拒绝或带getter的畸形响应不再解析、派发或写结果；原owner的取消不影响另一owner的新任务。取消日志插入失败时保留固定失败报告，但已验证的本地controller仍中断，start失败为CANCELLED，SQL无假终态、无事件、无网络。该失败边界用实例数据库触发器注入，无生产测试开关。

原复现命令修正后exit0：2 passed、44 skipped。增加凭据/源码检查各三种迟到响应、重复取消、跨owner/失效handle/未知UUID、同步重入取消以及取消日志失败回归；remote完整文件55 passed，无skip。contracts另覆盖preparing不可持久化、终态字段及额外秘密字段拒绝。

### 修正后重新冻结验证

重新运行上面三个完整定向vitest命令及三包tsc，而非引用首次149项。contracts：3文件37 passed，exit0；graph：4文件30 passed，exit0；application：4文件94 passed，exit0（remote55项）。合计11文件161 passed，无skip。三包tsc均exit0。仍不执行真实提供商网络、native/build或Electron。

本次取消修正未新增AGENTS规则：任务取消已有工程要求，新的回归与根因进入本过程记录；首次已证实的跨库发布经验保留。本轮文件范围仍为原12文件。修正后tracked及5个新增文件的独立空白检查通过；desktop/ui/llm/analyzers/contracts index/ADR/plan差异为空；两份新生产核心无fetch、环境读取、console、vitest导入或隐藏测试开关。分支仍为codex/llm-explanations，HEAD仍为00651a5f933f47f03000c0f579b75c73609304f1，未执行提交、推送或合并。业务、测试及本记录重新冻结，Git收尾及独立交互验收由协调审查方负责。

## 完整文件清单

修改：

1. `packages/application/package.json`（llm内部依赖）
2. `packages/application/src/index.ts`（显式角色、新鲜端口、最小factory）
3. `packages/contracts/src/remote-explanation.ts`（追加strict策略/preview/task/result契约，既有模型语义不削弱）
4. `packages/contracts/src/remote-explanation.test.ts`
5. `packages/graph/src/index.ts`（角色、迁移接线、受锁端口及有界取证）
6. `pnpm-lock.yaml`（application importer三行）
7. `AGENTS.md`（一条通过门槛的跨库发布经验）

新增：

8. `packages/application/src/remote-explanation.ts`
9. `packages/application/src/remote-explanation.test.ts`
10. `packages/graph/src/remote-explanation-store.ts`
11. `packages/graph/src/remote-explanation-store.test.ts`
12. 本记录。

## 规则判断及未验收

新增1条AGENTS经验：跨库结果先提交而权威terminal失败的实际0→1残留回归、有身份保护的补偿及cleanup失败/恢复门禁。现有跨库锁规则不能推出原子COMMIT，故新条目有独立预防动作；重复配置当前性/证据预算/不存凭据规则不另添。经验不改变授权、V1边界或验收门槛。

本批可交审查的graph/application核心，不是第一批E2E关闭。未接desktop解释worker/broker、sender/owner验证、Windows OS凭据写删读、IPC/UI；真实生产完整body摘要适配器、进程级全局broker、worker watchdog/终止/恢复和20项窗口历史仍由下一批接线/验收。无真实提供商服务、模型账户兼容、自然语言质量、Windows凭据或Electron交互证明。普通文件系统当前性是读取完成时判断，不能抵抗DB锁之外的持续外部编辑。没有API key，不索取/扫描/配置；没有Git收尾或main合并。
