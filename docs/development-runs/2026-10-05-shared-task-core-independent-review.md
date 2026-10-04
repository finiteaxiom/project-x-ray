# 2D-S3-A1 共享SQL与feature兼容独立审查

2026-10-05，协调方；原第二批，四批收尾后暂停。主起点4c3b30b133418bd97f9eb31dc3105891856fa75d，Sol仍455d4ad50830ee2495b70927e51caf830a4efbb8，保留旧WIP。依据[实施边界](../plans/2026-10-05-shared-task-core-implementation.md)及[开发反馈](2026-10-05-shared-task-core.md)。

## 独立核验与集成

原Sol明确六代码文件冻结后，root读取新core全部源码、适用测试、四个旧文件原字节差异和开发记录；随后完成原316文件manifest独立复核：仅remote-store/test、index.test及S2 test四个授权旧文件变化，其余312原字节不变，无丢失。原index.ts、S2源码、broker/cache/loan/native/UI与包锁均未集成。精确六文件patch SHA256 2F275D3E9FED8EE7D82CA1BB9874DFFCA2A806FB3F1D0100D99E58A098C5AD80，Sol reverse check与main apply check通过，目标新文件原不存在；只apply此patch及复制该批记录。

S2 test原old-task/old-session/非JSON哨兵不符合新桥接；实际差异仅改为可信context下严格合法的undispatched cancelled历史task。原全表、total_changes、历史source、旧feature/provider/task及默认denied断言保持，S2生产源未改。原main project11/Sol project12角色断言保持，只新增global14/project无表无14断言。没有删除正确测试或宽松生产校验。

main六代码与Sol原字节hash不同，root实际逐文件CRLF→LF规范化全文比较均相同，是git apply本机行尾处理；未覆盖主index或复制旧生产源。main index.ts SHA仍45D35B2A4F503E1E1D22FAD6F45A518FFC6CDF095EE7370294DB7874343747E3，开发记录复制后SHA 8ACD6642E13CDC141EB9681635234B0EBE3FC86565E8868DBF62E3C19585B7EA。Sol冻结六代码hash见开发记录；本结论覆盖实际规范化相等的main源码。

## 实际独立检查

两目录分别执行同一命令，未并发修改冻结代码：

`node node_modules/vitest/vitest.mjs run packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/application/src/remote-explanation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`

- Sol：236/236，9.94秒；main集成：236/236，9.92秒。
- 两目录分别执行 `node node_modules/typescript/bin/tsc --noEmit -p packages/graph/tsconfig.json` 和application相应tsconfig：各exit0。
- 精确patch范围/原副本、316文件manifest、main目标差异、规范化六文件全文比较、diff --check通过。没有新独立探针、重型build/native/Electron或真实GUI；不把开发自测冒充上述root执行。

源码与本轮真实SQLite回归共同核验：单openai主键slot而非每purpose一席；所有旧历史严格迁移/原创建时间/终态未释放占用保持；global14与project隔离；dispatched0/坏payload/owner/phase/time/多占用/半升级失败全DDL回滚、故障移除重试；已14缺表/触发器/旧索引/marker重开拒绝且不自动修复。实际两连接IMMEDIATE竞争及提交后BUSY、跨用途人工slot互斥/历史UUID碰撞、登记三个插入故障回滚、额外AFTER INSERT合法改phase也被精确读回拒绝通过。

finish保留占用，terminal不覆盖原code/时间，精确释放与迟到旧release不删新slot；稳定createdAt/clock rollback拒绝保持。feature-only recover在任何终态/context/占用写前核全共享状态，人工非feature/坏registry或lease/缺slot全部固定拒绝、全表及total_changes零变化。真实第二连接执行桥接无UDF依赖；授权/context错配零写，closed固定拒绝。原capsule/S2与application两库发布/失败补偿/COMMIT失败回归保持。

新core每次读取/写入重核全registry/task与schema，没有本轮规模性能测量；不宣称高历史量性能或其他用途生产许可。SQL人工semantic元数据是共享约束夹具，不是真实已认证语义任务。

## 接受范围与未验收门

接受六代码及准确开发记录组成的内部SQL切片：global14共享登记/占用，既有可信feature公共签名与实际政策门兼容。未接语义task/result/currentness/原题认证/provider/IPC/UI、durable reserve或全用途停止恢复。旧应用仍同步dispatch后commit；该事务回滚可清registry/lease/task，不能回滚已发请求。原“一次已许可dispatch、零task/result、无重试”断言完整保留，不称外部HTTP窗口已解决。

已实现=上述内部SQL；独立代码/回归已验证=两目录236及类型/精确集成；真实GUI已验证=0；其余上述整链及真实API/签名/Windows安装等未验边界保持。四批未全部完成，仍按原停止门推进范围内必需工作，不启动第五批。Git收尾仅本接受范围，实际SHA另核。

本轮无独立确认的新产品缺陷；开发反馈中的测试夹具与类型修复已核源码/结果，额度中断属环境。AGENTS新增/修订0：现有事务、身份、停止前置及跨库补偿规则覆盖，不为单次夹具/类型/额度波动新增经验。
