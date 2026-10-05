# feature 持久预占用：协调方独立复现

2026-10-05，本轮限原四批，未完成修复验收。main HEAD502820ad4e040eb4b1effa9845c2c2fe46e1274b，5170 HEAD455d4ad50830ee2495b70927e51caf830a4efbb8。

## 实际执行与确认根因

root独立从未改的 remote-explanation.test.ts 构造自有严格fixture，运行5170冻结的实际 RemoteExplanationApplication/GraphStore，两SQLite库及固定受控provider/credential端口；没有真实网络或OS凭据访问。探针自有目录留存、不递归删除。命令：

```powershell
./node_modules/.bin/tsx.CMD .benchmarks/remote-reserve-review-4781e5545dc84d16ae7d3dcaa82947f2/probe.ts
```

首尝试根目录workspace别名解析ERR_MODULE_NOT_FOUND为探针配置问题；仅改为实际5170文件入口及graph package的createRequire，不改产品。修正后原CLI exit0：deferred FK trigger使 explanation_tasks INSERT后的COMMIT失败；provider首次dispatch同步已调用、Promise保留pending。首start固定POLICY_INVALID、signal aborted、lease0。撤故障并新prepare/start，第二completed，calls2、peakUnsettledDispatches2，首仍pending。日志仅有限标识/数量/状态，不保存源码/凭据。

这证明本地真实应用/SQL在受控端口下的提交失败占用缺陷；不证明生产HTTP同时在途或abort已停止生产请求。确认根因：registry/lease在同一发起事务内写入，注册提交失败回滚占用，而外部端口调用不能随SQL回滚。现有assertAvailable及正常registered互斥回归不足以覆盖该窗口。

独立核三生产源两目录规范文本全等；main SHA256分别 remote-explanation.ts=C3EBABE6436A2F9F019963B8538E4DC8E856D01B2313A8B11A04B62E447A3D97，shared-remote-task-store.ts=16B91B8B9E851287C90327288D4F1C1BA33DA5E8AB83503ABDF7398EBDF68EAE，remote-explanation-store.ts=DF95CFB69A452356DFBC824ACCB4EC2EBA9E62675C10CE45F034F4B4AB65FFC2。实际运行目录仅5170，不把文本相等改写成main本轮运行通过。

Luna完成并冻结后，root另存同原始探针的main入口副本，实际执行 `./node_modules/.bin/tsx.CMD .benchmarks/remote-reserve-review-4781e5545dc84d16ae7d3dcaa82947f2/probe-main.ts` exit0，原相同全部失败窗口状态再次复现，包括peak2/second completed/首pending/lease0。因此现在两目录均有实际本轮复现；未触碰正在实施的Sol源。

## 修正派发与门禁

依据已接受共享任务设计第3节，形成 [具体实施计划](../plans/2026-10-05-feature-durable-reservation-implementation.md)，仅feature durable reserve和故障保留；原Sol六源/测试及自有记录范围。global16仅本轮明确分配，原14与project布局保留。开发冻结交付后root再独立复验，不把计划/自测当完成。

计划精确复制到5170，SHA8F425EE22C3FD6EEE41825FD993D57AE4A67BF7D9A9A1BD15C2912DDEAFF73AC。派发前336实际原文件完整hash清单和六源/测试副本保存于root自有临时备份；已成功send_message_to_thread派原Sol/medium，实际回合01a10aac-9730-75c0-855b-07f8b539613e active/inProgress、cursor0f838fed-d42b-49b3-a29b-9a399c012637:23。最新游标后续按实际续查；不冻结整个聊天而是待交付稳定切片。Luna已成功确认L4全源冻结/idle :8，root独立验收该纯模块，两目录文件边界无重叠。

已实现=原功能有确认缺陷；独立代码/复现已验证=上述实际SQL/受控端口失败窗口；真实GUI已验证=0；修正实现/回归/集成、生产HTTP、semantic任务及统一停止恢复均未验。AGENTS0：修复尚未闭环，不提前沉淀。无Git/重型/电脑操作/外发/用户隐私授权或导入代码执行。

## 2026-10-05 17:27：冻结修正独立接受并精确main集成

root实际核Sol冻结patch SHA891061CA3889E66ED10EA5ED8D7F865E4058C9554EF6E874C699FF942360AA1C、manifest6439E41B4D3099B84FB87A8E8F2739C9E5F462E6D156802EAECC1AE955E6084D。336原文件仅六允许源/测试变化、330不变/零缺失；七交付hash全匹配，反向patch检查通过。开发记录新增一份；所有旧WIP及AGENTS保持。新global16先验证原14精确schema/全部旧行，再原子只替换四触发器；project无16，旧14定义、main11/Sol12及source15不动。

实际源码核两次完整global→settings→source同步门：第一次单独提交registry/reserved slot及T1；第二次重新核政策/provider/context/配置/实际body，same private receipt提升并在端口调用前设置不可回滚attempt latch。第二COMMIT/同步端口异常保留持久reserved，不补事件/结果、不重发。仅私有确认零dispatch可以同身份terminal/释放；cleanup失败保留主固定错误及slot。普通registered发布/补偿门保持。旧feature-only recover在任何任务/context/lease写入前拒绝reserved及非feature占用；不伪造统一停止receipt。

root独立运行两目录同命令，每次6文件221/221，Sol10.29秒/main10.43秒，均exit0；两个目录graph/application noEmit均exit0。命令：

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/graph/src/index.test.ts packages/contracts/src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
```

root保留原探针/故障机制，仅另存修正预期副本，先运行probe-fixed.ts，再probe-fixed-lifecycle.ts（Sol实际文件入口），main精确集成后probe-fixed-lifecycle-main.ts。同deferred FK AFTER INSERT故障，首POLICY_INVALID、signal aborted且原Promise pending；lease1、second BUSY、calls1/peak1。随后旧recover POLICY_INVALID且registry/lease/context/task全部不变；真实晚resolve、关闭重开均不变，重开recover仍POLICY_INVALID且零写。自有SQL与受控provider/credential端口、零HTTP/OS凭据，不能称生产网络停止证明。原probe保留旧缺陷期望，未覆盖或删断言。

另运行probe-genuine14.ts：以root原字节副本的实际旧SharedRemoteTaskStore（仅探针import路径适配，不从新触发器反推旧schema）创建旧14真实SQL，包含旧dispatched及completed；新源码升级16且旧task/registry/lease/10与14标识完整不变。另用同旧模块创建损坏触发器库，新代码POLICY_INVALID，旧schema/全部行不变、零16。每个命令exit0；材料保留，不递归删除。

两目录六源原规范文本全等，root先备份main实际384原文件与六源字节，再精确复制六源/测试和开发记录七文件；不是整个Sol分支/HEAD/AGENTS/index覆盖。main原activation/cache/observer及迁移区别保持。git diff --check通过。新规则1条：外部端口效果不能随SQL rollback撤销；持久reserve提交后才调用、尝试latch先置、abort非停止证明。依据原失败及两目录修正闭环，区别于既有跨库结果发布规则。

已实现并独立代码/回归验证=feature持久预占用与提交失败隔离；真实GUI已验证=0；未验=故障reserved实际全参与者停止后恢复/可用性、semantic任务/fullbody当前性接线/transport/发布、实际API兼容/质量、GUI及其他批次原门。本切片不扩大四批，Git仅root已验范围收尾，不含旧WIP/GUI/二进制。

实际Git回执：bc608aaa291c1bd0a8747646791ef740bd97c53d 普通commit/push，独立远端main同SHA；仅上述12文件已验范围。四批未全部完成，后续Q3按明确计划独立派发。
