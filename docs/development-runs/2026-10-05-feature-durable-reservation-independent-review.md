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
