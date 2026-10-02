# Git比较快照时限诊断（协调方）

2026-10-02，主HEAD `7a9f81b`，S2a三文件已复制但未提交。针对此前原5秒Git staged/last-commit超时与cleanup EBUSY，不改测试超时、断言或产品代码。

## 方法与实际结果

ignored审查脚本 `.benchmarks/remote-desktop-review-20261002/git-snapshot-timing.ts` 自建两源码文件与Git提交；执行的Git init/config/add/commit仅属于该人工样例，不执行其源码。实际XRayApplication运行base索引、partial→complete→partial三次比较，保留新身份/稳定复用、两快照历史、Python事实、已保存比较、当前base不变及旧源码可读断言。Python不可用分支与原测试相同，其complete分支调用真实解析器。

临时包装公开TypeScript/Python分析方法及Node execFile，使用performance.now计时；只记录操作类别、次数与耗时，不打印Git参数、源码或路径。包装在finally恢复，实际异步任务全部await后close数据库再删除精确自有目录；不清理其他失败测试目录。方法是inclusive观测，不把嵌套分析或Git回调时长再次加到wall，也不声称CLI通过等于原Vitest5秒门通过。

实际命令均为 `node --import tsx .benchmarks/remote-desktop-review-20261002/git-snapshot-timing.ts <mode>`：

| 观测 | 总wall | 三次比较wall | 结果与清理 |
| --- | --- | --- | --- |
| staged首轮，仅分析包装 | 4.325s | 1.268/1.300/1.164s | 全身份/历史/源码断言通过，cleanup7.61ms |
| staged加公开进度观测 | 4.221s | 1.219/1.259/1.159s | 同断言通过，cleanup8.97ms |
| last-commit加公开进度 | 3.511s | 0.895/0.962/0.924s | 同断言通过，cleanup6.80ms |
| staged加真实Git子进程包装 | 4.595s | 1.346/1.310/1.202s | 同断言通过，cleanup9.38ms |

最后一次staged每次比较19个Git execFile，inclusive回调总1.063/0.906/0.926s；真实TypeScript两侧分析合计0.265/0.247/0.265s，中间complete真实Python两侧0.143s。capturing到analyzing-left首次进度分别0.926/0.812/0.832s，包含Git和源码捕获，不能单称Git启动时间。Git execFile包括等待/调度/子进程执行，不是纯CPU或单独启动成本。当前证据表明该小样例主要成本不是S2a评分逻辑；它没有调用gradeOwnershipAnswer。尚未诊断出正确性产品缺陷，也未把环境资源推测当根因。

源码 `snapshot-result.test.ts` 的超时用例仍有进行中的异步比较，afterEach直接删除目录；此前EBUSY可能来自超时后仍运行的句柄。本脚本await后清理成功支持生命周期区别，但尚未在原runner精确插桩证明时序，不把此推测升级为已确认测试缺陷，不豁免失败。

原文件在该诊断后重新执行 `node node_modules/vitest/vitest.mjs run packages/application/src/snapshot-result.test.ts --maxWorkers 1 --no-file-parallelism`：**4/4通过，exit0，14.19s，测试13.39s**；原5秒门/断言未改，未出现EBUSY。该结果不抹去此前整包失败；S2a仍等待一次集成整包结果。

一次尝试误用 `--project application`，本仓库没有该命名project，启动过滤失败且未运行测试；改用实际目录范围后运行。命令错误不是产品缺陷或工程经验。

## 后续与边界

后续若需要Git捕获优化，先核对19次实际查询及前后状态保护，再形成窄计划；不得删身份/冲突/路径/前后指纹检查、缓存不稳定工作区或以更改时限获得绿灯。本轮没有实施Git优化，不能承诺5秒广回归稳定。GUI、模型及旧接线仍未验收。

本轮无新增AGENTS规则：测量与时限结果只进入过程记录，清理竞态尚未确认；既有保留失败/不降门槛规则适用。

后续独立main集成整包命令 `node node_modules/vitest/vitest.mjs run packages/application/src --maxWorkers 1 --no-file-parallelism`：5文件111/111通过，exit0，56.19s，tests53.13s，无EBUSY。据此S2a广门本次收敛，不修改上述历史失败/推测边界；Git性能后续候选须另行设计。引用持久化经验1条属S2a完整证据而非本诊断时长规则。
