# S3-A2：语义持久任务内部核心

## 授权、输入与交付边界

2026-10-05，按已批准的 `docs/plans/2026-10-05-ownership-semantic-task-core-implementation.md` 实施原第二批。仅本 checkout，开发不执行 Git，也不修改 main。原四批收尾暂停，不推进第五批。

计划 SHA256 `F4791DB4B6B8DBD38B4CC80C54E8DE12469A5DCA6AEE2FBFD8BE0D9CA07C42E8`；L3 task 契约 `EA1D7F5ADB5758AD729FB7CF9C09CA884ADEDB8B25DD77093020C9EBF305D22C`、测试 `2A4D48A7621C79E596A8CE30E91220F81CB2389C5432CCF5AEDE569B8C29682D`。实施前实际 343 文件与原字节基线逐项一致；保留全部旧 WIP。

修改旧文件仅 shared-remote-task-store.ts、其测试和 index.test.ts；新增 ownership-semantic-task-store.ts、其测试及本记录。remote-explanation-store.ts/test、index.ts无需接线修改：既有同连接共享核心迁移生命周期已覆盖17。contracts/application/LLM/ownership/analyzers/desktop/broker/UI/native/包锁/脚本/AGENTS/公共计划及其余旧文件保持原字节。

分离理由：独立内部组件负责 semantic record、binding hash 和状态动作；共享组件统一迁移、全状态校验及跨 purpose 占用。没有 GraphStore/RemoteExplanationStore 语义生产写入口或 barrel export，未把元数据方法接到发送编排。

## 实现与证据

- global 新增 migration17，只有严格任务元数据表和必要守卫；project 无17、任务或语义结果表。原14/16定义及其升级路径保持。17建表、替换三个共享守卫、写标识同一 IMMEDIATE 事务；升级前验证旧实际 schema/rows，重开验证17实际对象与所有历史行，不自动修复。
- semantic 任务记录包含 canonical strict L3 record、首次 T1、精确身份和 binding hash，预算16KiB；无答案、rubric、源码、正文、key或结果表。binding仅排除taskId、ownerSessionId、contextHandle、contextEpoch，保留 actual bodyDigest 和其余字段。
- 内部 reserve 要求实际 global 事务；registry和reserved lease一起写入，跨用途 UUID 历史冲突和 provider 忙碌拒绝。promotion只接受原身份/T1并注册任务；预发送失败/取消只有终态元数据，不构成零发送或停止证明。finish保持占用，release仅精确自身终态；重复操作、迟到旧release不改新占用。
- JavaScript L3校验及SQLite守卫均按完整 UTC 小数秒比较，不使用毫秒截断。共享守卫使用固定SQL，无连接局部UDF；两个真实连接验证任务/lease篡改和跨用途互斥。读、写后及重开均核完整共享状态；失败只返回固定错误，不回显SQL、输入或源码。
- 写后不仅验证数据是否自洽，还核对预期完整record与inflight。防止合法但不同终态、提前释放、RAISE(IGNORE)零写被当成成功。内部动作仍由调用方实际事务负责COMMIT；测试确认COMMIT失败还原此前提交状态，不能把方法返回当成已提交或已发送。
- feature-only recover遇reserved/semantic占用仍零写失败关闭；原feature政策、上下文、发布、补偿和恢复回归保持。

## 实际反馈闭环

1. 首轮 shared/remote 59项中47通过、12失败。根因是旧测试恢复14的夹具仍带17对象/标识，以及旧人工semantic登记只有registered lease、没有合法任务。分类：测试夹具与明确新增17约束不兼容。改夹具恢复实际16再14；人工登记改为真实内部reserve/promote/terminal/release元数据。保留原互斥、恢复拒绝、历史与角色断言，补无任务registered/orphan升级拒绝测试；59/59通过。原“没有任务表”断言按新增17目标改为仅global有任务表，仍断言没有结果和公共写API。
2. graph首次noEmit失败，根因为返回never的const箭头未提供控制流缩窄。分类：本轮实现类型缺陷。改为明确never函数声明，无非空断言堆叠或放宽类型；graph noEmit通过。
3. 新核心28项首轮2失败：测试使用不存在的HTTP_FAILED错误码。分类：测试夹具缺陷；使用现有PROVIDER_FAILED，契约不改。随后核心/shared/remote/index共131/131通过。
4. 故障注入新增三个复现：reserved终态插入后触发器合法释放占用、finish后合法释放占用、release触发器RAISE(IGNORE)。35项中32通过、3失败（预期抛错却返回成功）。分类：本轮新核心产品缺陷，根因确认是只验证完整状态自洽，未验证实际inflight符合本次动作。补完整record/inflight写后核验；三例均固定拒绝并整事务回滚，核心组合137/137通过。另覆盖合法终态替换promotion、每个写入阶段失败及reserve/promote/finish/release的实际延迟外键COMMIT失败。
5. 最终完整组合357/357和三个noEmit通过。没有通过删除断言、放宽超时或盲目更新快照改写失败。

## 最终实际验证

```text
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-semantic-task-store.test.ts packages/graph/src/shared-remote-task-store.test.ts packages/graph/src/remote-explanation-store.test.ts packages/graph/src/index.test.ts packages/contracts/src/ownership-semantic-task.test.ts packages/graph/src/ownership-semantic-preparation-store.test.ts packages/application/src/ownership-semantic-preparation.test.ts packages/application/src/remote-explanation.test.ts packages/graph/src/ownership-semantic-policy-store.test.ts packages/contracts/src/ownership-semantic-policy.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

最终10文件357/357，exit0，50.66秒；包含新增核心35项、Q3两层准备、L3、S2和application远程解释。最终以下检查均exit0：

```text
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json
```

真实SQL验证覆盖：两连接双向purpose BUSY、跨purpose UUID冲突、实际BEGIN BUSY、稳定T1/换身份拒绝、完整小数秒回退、一次终态与重复/迟到release、全部写入阶段故障、四阶段COMMIT故障、损坏17的列/identity/hash/payload/预算/phase/trigger/table/标识重开拒绝且无修复。实际16 reserved升级不补任务；registered无任务/orphan/坏16/半17拒绝；17标识插入与COMMIT失败完整恢复旧schema/rows。原14/16 feature历史与旧源码、旧发布/补偿相关回归通过。

## 冻结与限制

最终基线343个旧文件，仅3个授权旧文件变化，其余340个原字节不变；新增3文件。精确patch以实际备份原字节为起点，完整before/after/unchanged清单及允许文件SHA256另交协调方，避免文档自引用hash。未执行Git检查/提交/推送/合并、跨checkout写入、GUI/Electron/native/build、真实网络、凭据/环境秘密扫描或导入项目命令。

本轮无AGENTS新增规则：AGENTS冻结；确认的写后目标状态经验作为候选保留于此，协调方集成时核对已有共享核心规则并去重。本记录不替代独立验收。

交付仅内部SQL元数据核心，不证明Q3实际编排已接线、模型发送、用户授权、worker停止、统一全参与者恢复、结果发布或界面完成。开发测试不替代root独立两连接/迁移/故障复验，Git收尾由协调方负责。
