# S3-C/P 两用途内部生产者接线实施记录

2026-10-08。按root已接受方案和明确实施计划，原四批内接线；仅5170，无Git/desktop/HTTP/凭据默认适配器或重型构建。

## 基线与必要hunk

开始前以方案交付manifest515D7E1730A26C2A51C8AA275DF418BC7A68B0728D7AEB30CDB21CCDAAFBBBBE核379/379并复制原字节。HEAD455d4ad50830ee2495b70927e51caf830a4efbb8、codex/llm-explanations保持。仅允许7组source/test及本新记录；application/index、graph恢复、desktop/contracts/UI/native/cache/migration/AGENTS和旧方案冻结。

必要修改：native capability在已登记实际participant上铸造内部opaque producer端口，复用原生停止，并只向同一Worker发送有大小/摘要/序列约束的完整body；不提供任意停止回调或另建Worker。lifecycle委派且所有同步admission观察原authority真实占用。held locator从真实注册application构造两流程与outer operation scope/close门，不public导出。feature所有同步mutation（含异常/finally）及正常stop受producer门；semantic同一真正Worker提前登记，begin才发body、其prepare/start/cancel/read受scope；ledger的原事务及await后事务入口受内部同步拒绝/admission门，graph/index仅窄传递。graph不获得native停止许可或反向application依赖，原token/完整material/SQL/单任务原生release门保留。必要source共7，测试按实际缺陷和端到端风险补充，不为填范围修改。

此新factory没有父线程provider.dispatch注入，实际执行必须在登记Worker；真实私有prepared对象仍留编排端作验证。旧非统一构造保持，不能将旧测试当新接线覆盖。实际验证及失败反馈如下；不把旧测试或设计视为本次通过。

## 实际反馈闭环（10-08 实施，10-09 完成交付）

- 编译问题：新增 saved 结构显式保存 producer:undefined 不符合 exactOptionalPropertyTypes；改为条件属性。公开内部 factory 的推断返回类型无法命名私有 reservationPreparationBrand；改用显式 HeldSemanticProducer 接口引用已有 opaque 类型。补充测试的 generic mock 和 union metadata 引用各有一处类型错误，改为泛型委派及明确可空属性；没有放宽 tsconfig。
- 测试缺陷：首次27条故障矩阵中3条 semantic promotion 预期失败却成功。确认真实 promote 用 INSERT 创建 dispatched 行，原故障触发器错误监听 UPDATE；将故障安装在实际 INSERT，原预期保持，27/27通过。
- 确认的实现缺陷：补充实际第二连接锁竞争时，semantic producer 同步门的原始 SQLITE_BUSY 在原 ledger catch 之外逸出，上层误标 INVALID_RESPONSE。将新门的异常统一经过既有 semanticPreparationFailure；复验 BUSY、已完成行及结果保留、lease继续占用，回滚第二连接后显式 root recovery 成功，Worker只收到一次正文，旧历史不变。没有更改 graph recovery 算法。
- 其他新测试缺陷：feature 结果表实际是 remote_explanations；semantic read 应引用真实 metadata.reservation；app.close 后核历史必须用预先打开的独立实际SQLite读连接。原先错误导致不存在表、未进入等待点而5000ms超时、关闭连接读失败；据实际实现修正测试，不改5000ms或60000ms。
- 执行端口在发送前校验实际普通数据对象、own data 属性、精确允许字段、目的、正文大小、SHA256、凭据/期限形状；Proxy/getter/额外字段/错误摘要及 scope 外调用均拒绝，getter未执行、正文未发出。native stop仍复用捕获的原getter/terminate/private stop，不接受调用方停止函数、Boolean或Promise证明。

## 当前验证证据

定向串行，均使用 --maxWorkers=1 --no-file-parallelism --no-cache：

1. remote-recovery-source-locator.test.ts，筛选 real held producer integration：6通过、79跳过，3.61s。真实两用途 × legacy/split/hybrid，当前真实索引、题目、提交、capsule、完整body、非空attempt/mastery；prepare前创建真正执行Worker，prepare不读凭据、不发送，start发一次，原生退出、lease释放，历史保持。
2. 同文件筛选 real producer failure：修正注入点后27通过、85跳过，16.62s。prepare真实await冻结、reserved未start、调用后COMMIT失败、publication真实await冻结、正常取消和人工新实例重试；同一Worker及原T1/identity保持，无自动重发。
3. capability、semantic reservation store、locator三文件筛选 opaque actual producer|semantic synchronous producer|real producer domain boundaries：修正后50通过、133跳过，21.63s。严格undefined veto与原receipt返回、端口clone、精确stop不自等/不签全域proof、提前创建throw/Proxy/Promise blocked、共享prepare/lease、跨库completion失败及补偿、实际SQLite BUSY、迟到read source/settings/close拒绝。正确断言全部保留。

四包原命令 tsc.CMD -p packages/{contracts,graph,application,llm}/tsconfig.json --noEmit 串行，全部exit0。首次完整20组合运行在会话中断后失去最终结果；不算通过。10-09重跑原20完整组合：20文件、1005测试全部通过，284.40s，exit0；输出保存在临时交付材料。没有并行测试、删断言、改门槛或更改配置。

## 限制及规则判断

仅内部真实两用途编排切片；没有接 desktop/broker/runtime/main 或public barrel，没有默认HTTP/真实凭据/远程模型调用。未运行heavy build/native/dist/Electron、Windows物理重开、GUI或远程质量验收，不称四批全部完成。旧非统一构造仍保持原语义；原20回归不能替代新路径覆盖。

本轮AGENTS新增/修订0：明确冻结规则文件；BUSY归一化问题已记实际反馈，其预防属于既有异常边界固定码规则，不据单一测试另增重复规则。没有Git提交/推送/合并或主checkout修改；保留所有不相关WIP，交付后由root独立审查和集成。

## 最终完整组合与交付核对

实际完整命令（在当前worktree运行）：

```powershell
.\node_modules\.bin\vitest.CMD run packages/application/src/remote-task-lifecycle.test.ts packages/application/src/remote-recovery-capability.test.ts packages/graph/src/remote-task-recovery-store.test.ts packages/application/src/ownership-semantic-application.test.ts packages/graph/src/ownership-semantic-invalidation-store.test.ts packages/graph/src/ownership-semantic-reservation-store.test.ts packages/application/src/ownership-semantic-reservation.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-semantic-result-store.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts packages/application/src/index.test.ts packages/application/src/remote-recovery-source-locator.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

379前像 → 380后像；旧改10（7 source、3 test）、新1（本记录）、369字节保持。只修改实际需要的同名测试，不为最多15文件范围填数。新增83条定向测试，旧3个test全部原字节保留为前缀。其余同名test及所有冻结文件保持。

临时交付包含所有before/after/unchanged SHA256、changed/new文件全字节、increment.patch和manifest；独立hunk解析从保存的379原字节逐行应用patch并核重建结果完全相同。测试副本用 .test.ts.review，不当作待运行新测试。manifest/patch自身hash在交付报告中给出，避免自引用。Git HEAD及分支重新核455d4ad50830ee2495b70927e51caf830a4efbb8 / codex/llm-explanations；本轮仍无Git写入。

## 10-09 独立审查反例与原始异步结算修复

此前1005条通过的交付没有被独立审查接受。root独立六反例证明：feature bounded 的 Promise.race 和 semantic awaitSemanticStep 在取消后结束外层用户Promise，但原 workspace Promise 仍pending；真实Worker已退出且零正文不能证明底层纯异步工作结束。root报告六条均失败；本次只读其独立记录及原探针，核对保存探针SHA256 8D1D83AAA7738DB24EC63ED75A3C36A8975D8BE7EBF58B67F5CDB02B6B0497FD，没有修改main探针或断言。没有证据称历史丢失或发生HTTP。

以先前交付manifest AA67EA7F3C2C5300EE31C417793F37109092B6903F592C037FFDB0A7BA52CCE5 的380后像为本次前像，380/380原字节复制并核hash；仅5170。额外允许的 semantic preparation store 确有必要：三个真实 awaitSemanticStep 调用分别启动 workspace、validator、adapter，并且takeReservation保留的后续checkWorkspace继续采用该取消竞赛；只有外层计数无法保留它们的实际结算。

必要hunk：

- 原native domain新增内部track，在调用原底层函数之前登记participant active和共享pending，原Promise真正finally后才回收；保持原20预算、真实原生stop/proof和60000ms恢复期限。实际prepare子工作也持有同owner preparing引用；外层取消、退休及原生exit不清除其预算。冻结/关闭/退休后不能启动新底层调用。
- feature workspace、credential及固定provider调用通过原opaque端口计数，bounded仍可及时返回取消/超时，原始Promise继续在同domain登记，不等待自身全域recover。
- graph preparation接收内部纯 SemanticAsyncTracker，先检查abort再登记/调用实际workspace、validator、adapter；保存tracker供原prepared材料后续checkWorkspace使用。graph/index只窄传递这一纯异步接口，不公开barrel，不获取Worker、Electron、SQL签名或停止权限。原token/material/revision/同步SQL门保持。
- semantic application把实际tracker传给真实prepare，并给原私有prepared响应validator登记；其他原普通await和完整outer scope仍保持。没有全局替换application方法或生产猴子补丁，没有默认HTTP或凭据适配器。

失败反馈：新增测试的union对象用in检查被TypeScript推断unknown；以明确可空started引用修正，未放宽类型检查。最初六条feature超时测试误用60000ms及Date时钟，实际workspace期限是90000ms且使用performance.now；因此仍pending直到默认5000ms测试失败。改为模拟原performance时钟并推进原90000ms任务期限，未更改生产期限、5000ms测试或60000ms恢复门。一次临时命令引号SyntaxError是工具问题，未改变源码；正式修改用UTF8脚本完成。

把原六反例原正确断言追加到正式同名测试，6/6通过（3.47s）。补取消/超时、实际读取前/后等待、credential、真实validator/adapter，以及共享prepare/pending预算、退休generation、原恢复期限。最终定向：root pending|raw producer asynchronous|raw work retains，36通过/173跳过（17.89s）；raw semantic validator，6通过/181跳过（3.05s），共新增42条。验证取消/超时外层及时返回而原始Promise仍pending、恢复仍pending、冻结零新回调/零发送/零迟到提交；真实结算后原root人工恢复成功，源码/attempt/capsule/非空mastery保持。

contracts/graph/application/llm原tsc noEmit串行全部exit0。原20完整组合串行重跑：20文件、1047/1047通过，310.78s，exit0；原命令和所有风险断言/5000ms/60000ms保持，未修改配置或测试发现范围。

本次AGENTS0：实际原始异步结算已属现有恢复门要求，规则文件继续冻结。Git/main/desktop/public contracts/barrel/GUI/native/cache/migration/依赖配置不改。仍待root独立复验，不称desktop生产统一、GUI或原四批全部验收。


本次修复最终交付核对：380前像→380后像，旧改8、新0、372字节保持；5 source、2同名test及原记录。两份变更test完整原字节保留为前缀，原其他test保持；只新增42条实际风险回归，不填允许范围。逐文件全hash及独立patch重建核对在临时manifest保存，.review副本不参与自动发现。root自有探针及其review仍同时匹配8D1D83AAA7738DB24EC63ED75A3C36A8975D8BE7EBF58B67F5CDB02B6B0497FD。HEAD/分支保持，Git动作0，AGENTS0；此为修复自测与交付，独立接收/集成待root执行。
