# 3F-C1：导航缓存有效性取样端口

2026-10-03；开发方三文件冻结材料，协调方尚未独立验收。本切片只建立同连接取样端口与保存代数，不实现Application缓存、observer或测量工具，不承诺性能收益。

## 基线与范围

先只读主计划2026-10-03-navigation-cache-token.md与当前规则；主AGENTS相对本worktree新增的已接受经验也逐条读到，不复制或修改规则。目标两文件开工SHA256与主对应文件完全相同：graph/index.ts=7376BF3594FBE9B91907D699297C51CB7B7235D0B3D7B539CEE43C2B382DAA7F，graph/index.test.ts=860487ED9AD9DB4E6FA8BA0AFB934BB39540712836FB0F6E4DAFDEB47048BAE3。

主HEAD在只读核对时已到85a68e16b8b194677ae8d7bc28ff73f68ef5d5d1；另用git rev-parse明确核对18b6cbb9ac6ba31afe96e54b53beb7bb94283b59与主HEAD的两目标文件blob完全一致（index=0636c16ad2cd0e00deddd068ac394d8c24241034，test=cd6271894a83cb15ed732b7821d9da185a1e97d6）。本worktree HEAD保留455d4ad50830ee2495b70927e51caf830a4efbb8，不reset/ff/整体同步；S5不重做，旧未提交内容保留。

本批只修改packages/graph/src/index.ts、index.test.ts与本记录。未改contracts/迁移/配置/ownership/remote/Application/observer/工具/缓存/依赖/AGENTS或其他checkout。

## 实现

新增GraphStore内部sampleNavigationValidity及同文件导出的NavigationValiditySample联合类型。先检查实际连接open，再检查inTransaction；事务中零PRAGMA。可比较时只读同一连接一次PRAGMA data_version(simple)，严格接受有限、非负、安全整数；坏类型/值仅invalid_type，SQLite异常仅unavailable，关闭仅closed。返回独立plain-data，无store/数据库/产品对象引用，不进入IPC、日志或报告数据协议。

navigationGeneration只在全部GraphStore/remote/ownership迁移成功后初始化为0。原saveSnapshot事务与返回值保留，在save.immediate成功返回、确认非嵌套事务后递增；新快照、同内容复用、重新激活及makeCurrent=false均走这一提交后出口。失败不推进已提交代数，原行/源码/当前激活规则不改。

代数达到安全整数上界前最后有效值为MAX_SAFE_INTEGER-1；下一成功保存永久设为不可比较，不回绕、不重置。嵌套saveSnapshot成功只表示savepoint release，不能证明外层commit，因此保守永久停止该实例comparability。外层COMMIT与ROLLBACK结束后均不会恢复，后续普通保存也不恢复；关闭重开是新实例，重新初始化，但调用者不能把新旧或不同实例的数字相等当作身份相同。此行为不取消原嵌套保存、改变返回值或外层提交/回滚的数据结果。

有效样本只是同连接观察，不是线性化、多表或文件系统屏障，不能替代未来fresh source/配置/工作区校验。其他连接改变可由该连接data_version观察；本连接saveSnapshot改变由本地代数观察。调用方必须另外保留同一GraphStore实例身份。

## 实现→验证反馈

先加入18项接口生命周期回归，实际运行`node node_modules/vitest/vitest.mjs run packages/graph/src/index.test.ts -t 'navigation validity' --fileParallelism=false`：18失败/11跳过，统一为接口不存在。这是待实现能力的预期红测，无环境或测试故障。

加入端口与提交后代数后同命令18通过/11跳过。首次完整graph回归5文件93项通过，graph noEmit通过。之后扩充四类坏值与新makeCurrent=false快照断言，完整97项通过；按协调方只读审查提醒，再补嵌套外层COMMIT/ROLLBACK各终态、旧源码与返回值、永久不可比较及关闭重开新实例，形成最终23项取样回归。过程中没有新的产品、测试或环境失败，不编造失败诊断闭环。

## 最终实际验证

- `node node_modules/vitest/vitest.mjs run packages/graph/src --fileParallelism=false`：5文件、98/98通过，exit0。包含index.test.ts的23项新回归及11项原回归、快照不可变、ignore设置、remote和ownership capsule存储回归。
- `node node_modules/typescript/bin/tsc -p packages/graph/tsconfig.json --noEmit`：exit0。
- `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit`：exit0。
- 与主原目标源码实际diff只包含联合类型、构造后初代数、只读采样方法和原保存成功出口的本地代数；git diff --check两源码通过。

真实SQLite双连接验证commit/delete改变data_version、rollback不改变；建立读事务后外部提交，事务中返回in_transaction且PRAGMA调用数为0，事务结束后观察新值。实际触发器拒绝快照INSERT后零保存与不推进代数，移除后可保存；同ID内容冲突不覆盖旧内容。采样spy确认只读一次指定PRAGMA，零prepare/exec及零完整snapshot/source/config读取。测试还覆盖undefined/NaN/正负Infinity/字符串/负数/小数/不安全整数/null/bigint/布尔/对象/数组、dataVersion的0与MAX_SAFE_INTEGER、固定故障状态、closed零PRAGMA、样本改写不影响内部代数、上界永久不可比较。

两个独立store在真实初次样本中数字完全相等，测试明确它们是不同实例；端口数字本身不防跨实例比较。上界测试仅在测试通过Reflect修改既有私有字段，没有生产setter、测试开关或新增注入接口。

## 冻结、限制与规则判断

三文件为最终稳定边界，后续无生产源或测试修改计划；待协调方独立审查，不自行Git收尾。源码SHA256：index.ts=853DA33765953DC5803EFDB692583C37CDED7F13E7266545F1724395DCE4B4AB；index.test.ts=3CA2248832CA336EA4C138C6FC7020744CF3EFE5B20050822C64D65FC75F3F61。记录自身hash由最终工具报告，不自引用。

未运行native/build/dist/Electron/GUI/benchmark/网络/模型或其他项目代码；未实现缓存、observer、新测量工具、未测真实性能收益。原medium合成加载次数只属方案历史依据，本批未重新测量。未提交、推送、合并或改其他checkout。

本轮无新增AGENTS规则。供协调方评估的候选：SQLite嵌套事务成功释放savepoint不证明外层提交；以本地成功提交驱动缓存代数时，覆盖外层COMMIT与ROLLBACK，并保守停止无法确认终态实例的比较能力。该候选由真实双终态与重开回归支持；本批AGENTS冻结，是否收录由协调方核对既有规则后决定。

## 协调方独立复验（2026-10-03 17:14–17:18）

root 核对最终三文件 SHA256 与冻结交付相同，main 两源码仍为原批准 hash，逐文件差异只涉及 token 类型/取样/保存出口及定向测试。Sol 为 idle，已确认不再修改；保留该 worktree 旧桌面/UI 等未验收内容，不整体集成。

root 在 Sol 实际串行运行上述 graph 全包 5 文件 98/98（3.91 秒）及 graph/application noEmit，全 exit0；另运行 root ignored navigation-token-independent.ts，实际 SQLite 双连接提交/回滚/删除、读事务零 PRAGMA、同内容重用/激活、真实持久 payload/source 不变、同 ID 冲突失败、外层 COMMIT/ROLLBACK 和源文件 hash 不变均通过，exit0。探针的 assertions=8 为自定义主门计数，另有独立 assert，不冒充单元测试数量。

三文件精确复制 main 并核对 hash 后，root main 相同 graph 命令 5 文件 98/98（3.94 秒）、相同真实探针及两包 noEmit 均 exit0；风险扩展的原 application 全包 6 文件 147/147（58.87 秒）通过。未提高时限或删除断言。前次用户打断的执行没有完整返回，明确不作为此轮证据；本轮重新取得完整结果。没有产品或环境失败；一次只读查找误用不存在的非 GUI 计划文件名，属协调命令定位问题，不形成工程经验。

root 接受 C1 后在 main 查重并新增 1 条工程经验：区分嵌套 savepoint 与外层提交，无法观察终态时停止代数比较，真实两终态/重开覆盖。原开发记录“无新增”保留为开发方判断，公共规则收录为协调方本轮决定。仅该窄后台端口独立接受；真实 GUI、缓存/observer、性能收益与远程质量未验收。实际提交 SHA 由协调审查记录补记。
