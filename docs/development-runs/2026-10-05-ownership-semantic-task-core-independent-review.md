# S3-A2 内部语义任务核心独立验收

2026-10-05；协调审查方。仅原第二批内部 SQL 切片，四批收尾暂停，不第五批。开发源码冻结后独立审查并精确集成 main；无电脑操作、真实 HTTP、凭据或导入项目代码执行。

## 冻结范围与实际差异

计划 SHA256 F4791DB4B6B8DBD38B4CC80C54E8DE12469A5DCA6AEE2FBFD8BE0D9CA07C42E8。Sol HEAD 保持455d4ad50830ee2495b70927e51caf830a4efbb8及全部旧WIP；root逐项核343原文件，仅shared核心/测试及index.test三项变化，340项原字节不变、零缺失；三个新文件hash全部匹配。patch B17641FD35CC26012A6DB20DD54D620F118E4D6D2039796BDFD8DE26A4EFBB76，manifest 1220117365B6469AA027846AA0C2C08ECB6EF1B99D178561C270E36C9DE8B23F。

生产shared源545556DEC30CC1CFF1A1D465E86626C59A750949A9BE501A06FA158AE5303FAA；新semantic核心9CDE2B35A1F757A1332BB7F4C2A5BA21C780BCF6AA5707F043E11C46B570250B，新测试C637EBFFD352F35B8BE6CA35F8C3EFE868CD2AD1007968D2526422972CD93862。shared测试F71170D3FC7D78F7C37228966CB80FADE7B59E254EC01B22498F92A8E90DD8FC。自有开发记录02CDFA92A64400442641C1D99FF60658D6BB98E1B111780B4A05758F16C63508。

main原389文件及三个旧目标已另存本轮字节基线。shared两旧源与Sol实施前完全相同，root复制这两项、新核心/测试及开发记录；index.test仅将无semantic任务断言替换成global17/project无17、无结果/公共写API的窄断言，保留main11与Sol12等原差异。未复制Sol index.ts、AGENTS、whole HEAD或其他生产WIP。

## 源码结论

global17的任务元数据表、固定守卫及三个共享guard升级在同一IMMEDIATE事务；14/16原定义及升级路径保持，17重开核实际schema/全历史，缺对象不修复。project无17或任务表。旧16合法reserved可保留而零补任务，registered无任务及orphan拒绝。新核心不从barrel/GraphStore/RemoteExplanationStore导出生产semantic写端口，无结果表或application调用。

identity严格捕获，拒绝proxy/getter/未知字段；canonical L3 record、列、binding独立重算、registry/lease的全身份/T1和阶段逐项核验。binding只排除四个临时字段，保留实际bodyDigest。UTC完整小数秒比较保持。reserve要求实际global事务，跨purpose单槽和历史UUID冲突失败关闭；promote保持首次T1。finish保留占用，精确terminal release及迟到旧release不会清新槽。SQL方法返回不证明外层COMMIT、请求已发或worker已停。

旧测试的raw semantic夹具改为真实内部reserve/promote/terminal/release，保持原BUSY与feature-only recovery零写预期；新增registered无任务拒绝。安装14/16夹具需卸下17对象是明确迁移语义变化，未降低原断言/超时。开发记录确认过三个写后产品缺陷；修正后同时核预期完整record及inflight，而非仅状态自洽。root实际RAISE(IGNORE)及原三个故障回归均验证拒绝/回滚。

## 本轮实际独立验证

两个目录顺序运行以下同一10文件组合，均357/357、exit0；Sol49.87秒，main49.62秒。两目录graph/application/contracts三个noEmit全部exit0。

```text
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/contracts/src/ownership-semantic-task.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/contracts/src/ownership-semantic-policy.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json
```

root自己的`.benchmarks/a2-independent`探针不复用开发测试作为实验结果：

- 实施前保存实际旧16源字节E549BAFE1260F888FE97EC6D07528116E427B8A755BF34D533238432B0354DBB；使用当时main真实静态索引、题目、提交、评分及持久源码建立两布局×四feature占用状态的8份旧16库，17不存在。任务为自有SQL元数据夹具，未实际调用模型。冻结后逐库复制新实验库，两个目录当前核心各升级/关闭/重开；所有原表全部行、旧标识、历史任务/T1/grade/capsule和未替换原对象全等，新任务零行，独立source文件及原库hash不变。只替换17定义的三个共享trigger。
- 对这些实际旧库另注入坏16、半17、标识插入失败、延迟外键COMMIT失败；实际公共RemoteExplanationStore迁移固定POLICY_INVALID，原schema/全部行精确回滚，无17标识，不以新版本修好坏旧库。
- 原实际14源模块生成库，两个目录各核合法14→16→17保留历史/旧标识与slot；坏14 trigger失败关闭，schema/行不变。没有用当前17构造器倒造这组旧14。
- 自有双连接核semantic占用令feature BUSY；promotion外层COMMIT失败后仍原reserved、任务null、完整库不变；另连接不能删除活跃lease/任务或把dispatched释放；亚毫秒回退拒绝；release的RAISE(IGNORE)拒绝且全回滚；释放后新feature占用不被迟到旧semantic release清掉。原源码、确定性成绩及材料表全等。

实际探针命令：tsx .benchmarks/a2-independent/review.ts带明确Sol/main根目录；genuine14-sol.ts及genuine14-main.ts。成功收据分别10040a93-9d9c-4bd2-87fe-532e64f110f5与abe239e4-6e08-486b-bea1-ac74d2ecbdf0（位于runs自有目录）；材料原库及失败途中目录保留，未字符串递归清理。首独立故障探针错误要求内部Shared.migrate把SQLite异常包装为公共固定码；源码确认固定转换位于RemoteExplanationStore.immediate。修正探针为真实公共入口后四故障通过；分类为审查夹具边界错误，不是产品失败，也未通过去掉公共固定错误断言放行。

## 接受范围与未验边界

已实现及独立代码/回归已验证：内部语义任务SQL状态、共享占用和global17升级/失败关闭，main集成范围如上。真实GUI验证0。实际语义Q3两段持久编排、完整响应transport、结果发布/读取/补偿、全参与者停止恢复、政策同步失效与真实API兼容/质量仍未验；不能把本层reserve/promote/release当发送或停止许可。原其它三批GUI/native/EPERM/Windows发布/签名/干净机器未验清单不变。

本轮AGENTS新增1条：SQLite写后同时核预期完整状态与占用；依据开发真实三个失败及root实际故障复验，现有规则只覆盖提交/绑定/停止，未覆盖合法但错误目标/零写返回。未将测试数量、临时夹具失败或性能值写成规则。Git仅已验窄范围，由root另记真实SHA；未验生产链与旧WIP不纳入。四批仍有本地可推进工作，继续原工作流，本地收尾或全剩外部门后暂停定时与派发讨论，不第五批。
