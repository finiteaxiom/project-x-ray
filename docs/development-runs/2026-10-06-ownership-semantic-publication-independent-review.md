# 2D-B2 当次语义执行与可信发布独立审查

原第二批内的后台切片，主 checkout HEAD `66965f4308dfe8a254fb718a5ec2ba2e0b7362b6`，Sol HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`。当前未独立接受、未集成或 Git 收尾；生产 semantic/HTTP 与真实 GUI 均未启用或验收。

## 2026-10-06 20:10 冻结范围与独立检查

root 核原 Sol/Luna 实际游标：Sol B2 completed/idle，Luna 旧 L5 completed/notLoaded，未重派已验工作。冻结清单 SHA256 `FD9A99918E1392F1F82E1294152DF6608A178B9F6DCEF26D6BF2708841BB56DA`；patch SHA256 `B81D112FB8756736A77CB703E7CCD726C16DD4DE9DC205EA5B391D3201025218`。

root 逐项重算 after364，全匹配；before359 的授权旧文件9、开发新增5、协调计划1，349旧文件保持。反向 `git apply --reverse --check` exit0。未用完整 worktree 的 Git diff 替代本次窄范围差异，其他旧 WIP 保留。

四包独立命令 `node_modules/.bin/tsc.CMD --noEmit -p packages/{graph,application,contracts,llm}/tsconfig.json` 均 exit0。root 在冻结 worktree 运行 `vitest.CMD run`：application 的 ownership-semantic-application、ownership-semantic-reservation、ownership-semantic-preparation、remote-explanation、index 五测试文件，以及 graph 的 ownership-semantic-invalidation-store、ownership-semantic-reservation-store、ownership-semantic-preparation-store、ownership-semantic-task-store、shared-remote-task-store、remote-explanation-store、index、ownership-semantic-result-store、ownership-question-binding-store、ownership-capsule-store、ownership-semantic-policy-store 十一测试文件（均 src 下的 .test.ts），参数 `--maxWorkers=1 --no-file-parallelism --no-cache`。实际16/16、686/686、exit0，154.56秒；没有未处理错误或 listener 警告。下述额外4门缺陷不在原686断言中，通过组合不能替代恢复路径独立复现。

## 已确认产品缺陷：安全终结后同实例无法重新准备

root 自有 `.benchmarks/b1-independent/b2-retry-probe.ts`，复用真实索引→原题发行→答题→实际 Q3/Responses/SQL 的既有独立 fixture，仅执行自编本地 Worker 消息脚本，未执行被索引代码、未调用模型或网络。命令：

`node_modules/.bin/tsx.CMD .benchmarks/b1-independent/b2-retry-probe.ts "D:/Projects/CodexWorktrees/5170/Project X-Ray"`

exit0，原始收据 `.benchmarks/b1-independent/runs/2920e154-7ebc-41d9-bcab-7725b689406a/receipt.json`。双库及兼容同库布局各验证取消、无效响应，共4门：等待 start 已结算，实际 native worker threadId=-1，权威 task 分别 cancelled/CANCELLED 或 failed/INVALID_RESPONSE，inflight=0，provider lease0，结果0，原答题与源码不变。此后同一个 flow.prepare 原请求全部返回 BUSY，且数据库无新增写入。

根因确认于 `packages/application/src/ownership-semantic-application.ts`：prepare:59 仅允许 completed 替换；start catch:121–136 与执行后 cancel:145–148 成功终结/补偿/实际停止/释放后，仍保留 starting/reserved 且 completed=false 的 slot。此为当前应用恢复路径缺陷，不能用销毁重建实例或将失败标为 completed 隐藏，也不能通过放宽持久占用绕过。

修正边界：仅新 application/source/test 与自身开发记录；确实需要 graph 私有精确终结证明时先给出具体最小委派，不从应用反射数据库。安全清理和旧 start 异步工作全部结算后，允许用户显式新 prepare→新 task；旧 ticket 仍不能再执行。promotion COMMIT、factory 无可信 worker、finish/compensation/release 失败或停止不明仍 BUSY/保留占用；取消与旧 catch 的竞态不得清掉新 slot 或撤销新任务。

整体未验收；真实 GUI0、真实远程兼容/质量、统一参与者停止恢复、签名及干净 Windows 外部门仍保留。当前四批还有本地修正，保持定时，禁止第五批。AGENTS 本轮0；已有用户可见任务安全重试及实际停止/SQL写后核验规则覆盖，未把尚未复验的修正变成新规则。

## 20:33 修正后的独立接受与精确 main 集成

原 Sol 窄修 completed/idle，实际 cursor `4ec5deb2-4b44-492c-86f0-dfe5a9c1aa25:8`。新 manifest SHA256 `F6495D651FEA657E6BBDD37C7D2AFB825BBC3CAC1F23598071E2EA31DE814DE0`，patch SHA256 `6CF3FA3451AB98752B17940B0F5D80416A90225E357DCFD4A5F5B918E72E8FA7`；root 再算364文件全匹配，相对旧冻结仅新 application 实现/测试/开发记录3文件变、其余361保持，before359中349保持。旧冻结保留。原始 patch 反向检查通过；正向检查发现新增文件缺 `new file mode` 元数据，不能把反向检查当正向可应用证明。root 仅补5条新增文件 mode 并统一 patch 行结束生成自有集成 patch，SHA256 `DE5389766EBCAF31832F0E28C51617170EC3AECD49DF7C46DD4B8BEEC1F321D7`；main 正向 `git apply --check` exit0，实际 `git apply` exit0。

源码独立核 released 仅成功 graph release 后设置，失败未标 completed；activeOperations 在 start/cancel 的 finally 结算，旧异步响应验证和停止未结算时 prepare 仍 BUSY。promotion COMMIT 失败、无可信 Worker、finish/补偿/release 失败继续占用。原 GUI/HTTP/main 启用门没有因本地 Worker 替身放开。

Sol 独立原16文件697/697、exit0、163.36秒，四包noEmit均exit0。root 原4门复现重跑收据 `.benchmarks/b1-independent/runs/9a90ff9f-40d8-44ae-a40c-4584d8fc5254/receipt.json`：四次全部从 BUSY 改为 prepared，真实 task/lease/worker 停止条件及源码/原答题保持。

root 新自有 `.benchmarks/b1-independent/b2-publication-probe.ts`，双布局×四题型×空/非空规则16条完整实际索引答题→Q3→当次 Worker→真实 validator→source结果→权威 completed→可信 read，再加双布局取消/无效响应后的4条显式新预览/新task成功；原票据拒绝，旧完整task/T1/源码/答题/mastery不变，prepare不自动调用，worker全真实退出，成功每task调用一次。Sol收据 `.benchmarks/b1-independent/runs/1b52299d-29c9-4cd7-8489-cd18a3caebe0/receipt.json`，main收据 `.benchmarks/b1-independent/runs/656d979d-3f5b-4a76-ac3f-b4b55c7bf660/receipt.json`，两目录各20/20、exit0；自编 Worker 消息不是模型质量或生产调用。

集成前 root 存 main412文件清单与9原件；source集成后恰9授权旧源/测试变化，403原文件字节保持，新增5开发文件。main与Sol旧差异：index含尚未集成的parse-cache/activation，index.test仅行结束差异，R1.test保留main11/Sol12角色断言；只应用B2 hunks，没有复制Sol整个index或R1测试。main独立相同16文件697/697、exit0、159.94秒，四包noEmitexit0，20条真实独立门通过。随后只去掉两个新增测试的EOF多余空行以通过Git whitespace检查，未改断言/源码行为，实际测试在此纯空白规范前完成，明确不声称之后重新跑整组。

独立接受仅本内部后台，已实现/独立代码与回归/真实GUI0/真实HTTP0分列。统一全参与者停止与重开恢复、main/desktop/UI接线、真实模型和Windows发布外部门仍未验；整体四批未完成。AGENTS0，已存在安全重试、实际停止及SQL事务规则覆盖，本次可操作的异步结算门保留在代码和回归。精确待提交范围20文件：14开发source/test/记录、6协调计划/队列/审查/交接与前B1实际Git回执，Git动作与完整SHA执行后另记，不把独立通过当已推送。

## 20:17 窄修派发回执

上述独立回归全部结束后，root `send_message_to_thread` 原 Sol/gpt-6.1-sol/medium/5170 成功，仅允许新应用两文件及自身记录；需要 graph 最小委派时先说明必要范围。要求先失败回归、保留占用故障断言、并发旧 catch/取消结算隔离、重新冻结及原16文件/四包复验。`wait_threads timeoutMs:0` 实际确认 turn `01a11125-943b-75e0-8b0e-9540072f3ff8` active/inProgress、error null，cursor `4ec5deb2-4b44-492c-86f0-dfe5a9c1aa25:7`。Luna cursor `6e45830c-d1c1-4a24-b5d2-00ea15bea007:1` 保持冻结，不派同文件并发或填槽任务。本轮无集成、提交、合并、推送。
