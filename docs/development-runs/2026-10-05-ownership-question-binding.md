# 2D-Q1 新提交可信原题绑定

2026-10-05。仅分配的 5170 checkout；基线 `codex/llm-explanations` / `455d4ad50830ee2495b70927e51caf830a4efbb8`。依据已接受 S4-D（设计 SHA `7AD175097FD8BD31B4B56CA602B6CE843C69AA0A86A076E689ACFE7EDDF34216`）及 Q1 实施计划（SHA `725A003371DB4F77EA6DFBFDAAD8332017361C00E6522C53B7599431F7B2933B`）。本记录只代表开发方实测，待 root 独立审查；不代表 GUI 或发送验收。

## 目标与实现

- 迁移 15 仅创建本地 `ownership_question_bindings`：global legacy source 与 project source 均有该表，project 不获得 global 13/14 政策、注册或占用表。旧迁移及时间不重写，旧 attempt/capsule/source/mastery 不回填。表损坏、缺 marker/表或坏行固定失败，不自动修复。绑定外键随对应 attempt 精确级联删除，保持原删除语义。
- ownership 从原实现抽取同一候选函数，固定 compiled generator 端口；保留 concept 过滤、Map 最后值/首次插入位置、count、对象 join 的 call-path variant、成对路径及角色数组全部原顺序。question `2.0.0`、scoring `2.1.0`、原评分器不改。Map 前同 ID 不同完整题只使新增认证 `ambiguous-generator`，不改变本地选择或评分。
- application 构造时给全部 GraphStore 创建路径注入同一端口。真实 SQL 发题在 settings revision 锁及 source IMMEDIATE 事务内捕获材料、实际请求、rowid 截点及排序身份；发题不写业务行。私有 WeakMap 发行 token 只与私有题目关联，公开返回 clone。提交第一次 await 前捕获 token/题目/答卷。失败题可用原发行来源再答；通过、替换、配置失效、close 注销，原 prepared receipt 仍一次消费。
- 新契约保存完整 canonical 原题（128 KiB）、显式有限 basis（8 KiB）和小型 unavailable（2 KiB）。basis 记录真实 generator 输入摘要、候选位置、historyCut、完整有序匹配历史摘要/首 witness、发布身份及 locale/collator/Node/V8/ICU/Unicode/CLDR/Electron 身份；不复制完整快照、源码或答案。认证预算、歧义及排序环境不支持只影响认证，不阻断原离线题目、attempt 或评分。
- prepare 与同步 save 均重核私有发行来源和实际完整 generator 输出；save 沿原 settings→source 事务写 attempt、capsule、binding 并精确读回。第三行故障或读回篡改使三行一起回滚。旧无 token 内部保存只能新增 `unavailable/untrusted-issuance`。缺历史绑定为 `legacy-unbound`。
- 历史 binding 读取使用同一个 SQL 读取视图，并复用原胶囊的图/源码/分析身份校验；自洽重算摘要不能替代材料或完整 generator 重建。不同 generator/排序环境拒绝认证，但原 S1 历史胶囊仍保持 `prepare-only/not-checked`。所有新 binding 历史读取也为 `not-checked`，不是当前性结论、发行能力或发送许可。

## 反馈闭环与失败分类

1. 首轮 capsule/application 101 项有两项失败：新增 15 使旧 `1..12` 列表断言过时（测试适配）；新 FK 未声明级联，阻止原有 attempt 删除（本批产品回归，已确认）。保留原 1..12 检查并追加 15，给新 FK 增加 CASCADE；随后同组合及新增真实矩阵 113 项通过。旧 7/10 时间、源码字节及精确删除断言保留。
2. 新对抗测试初次出现五项夹具失败：空 roles 不满足原 submission 至少两项的校验；向严格 rubric content hash 函数传入包含 rubricHash 的对象。属于测试缺陷；改成有效但错误的角色答案，并只传 rubric content，未改生产校验或评分断言。随后应用 64 项通过；后续新增针对请求/witness/来源、跨 store token 的测试也通过。
3. 扩展至既有 application/index 回归时，236 项有一项发题失败。原内部方法直接支持 `count: 100`，新发行错误套用公开 IPC 的 20 题校验（本批产品兼容回归，已确认）。保留原实际 count 的生成行为；公开 `ownershipQuestionRequestSchema` 不改，内部 binding basis 记录安全整数实际 count 和相应候选位置，不截断题目。未修改冻结的 application/index 测试。修正后 242 项通过；增加同时间 locale 首 witness 后 243 项通过。
4. 历史读取复用 S1 的胶囊来源一致性检查，并增加 rehashed capsule analysis/source identity 两项拒绝测试。此为审阅后的防护与回归，不声称执行过修正前复现。最终相关组合见下。未出现环境失败，未编造失败循环。

## 首次冻结实际验证

首次冻结使用本 checkout 现有运行时，不安装依赖；单 worker、无文件并行、无 cache：

```powershell
./node_modules/.bin/vitest.CMD run packages/contracts/src/ownership-question-binding.test.ts packages/contracts/src/ownership-capsule.test.ts packages/ownership/src/index.test.ts packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/index.test.ts packages/graph/src/remote-explanation-store.test.ts packages/application/src/ownership-capsule.test.ts packages/application/src/index.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

结果：9 文件，245 项通过，退出 0。末次仅去掉 unavailable 历史读的重复材料读取后，重验实际相关组合：

```powershell
./node_modules/.bin/vitest.CMD run packages/graph/src/ownership-question-binding-store.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/application/src/ownership-capsule.test.ts --maxWorkers=1 --no-file-parallelism --no-cache
```

结果：3 文件，148 项通过，退出 0。最终依次运行下列四条，均退出 0：

```powershell
./node_modules/.bin/tsc.CMD --noEmit -p packages/contracts/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/ownership/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/graph/tsconfig.json
./node_modules/.bin/tsc.CMD --noEmit -p packages/application/tsconfig.json
```

真实矩阵包括四题型 × legacy/project × 空/非空 ignore 的 16 条索引→原评分→三行保存→关重开完整 generator 认证；同时保留原路径替代/混拼、重复变量 citation projection、长 variant、调用位置和 mastery 回归。新增验证覆盖实际对象 variant 碰撞、原题字段及 basis 篡改、重算摘要仍拒、后追加倒序时间历史不进入旧 cut、匹配历史变化拒绝、同 completedAt 下 `é`/`z` 的实际 locale 首 witness、预算/engine/version 离线兼容、普通/跨 store/注销 token、旧无绑定不回填、第三行 INSERT/readback 故障原子回滚后重试、迁移角色与损坏失败关闭。原 App 并发、首次 await 后 caller 变化、替换、配置、activation、close 及分离 settings/global source 回归通过。

## 冻结、限制及工程规则判断

编辑前保存原字节和 323 文件 SHA 清单；仅 8 个授权既有文件改变，另外新增 4 个契约/存储源码及测试和本记录；其余 315 个原文件逐一 hash 不变，包括 AGENTS、A1/S2、旧 application/index 测试、broker/cache/native/desktop/UI/LLM、包锁及其他文档。graph/index.test 无需适配，本轮未修改；新增角色/升级测试在本批新文件。交付 patch 以这些实际原字节为基线，不以 HEAD 或整份工作区 diff 替代。

首次冻结由 root 复验 13 文件 hash、323 文件差异边界、patch reverse check、245 项与四包 noEmit 后发现下述额外产品缺陷，暂未接受或集成。此前通过的测试不是这两项行为的验收。

## Root 审查反馈修正

原字节备份及 323 文件清单保持不变；首次 patch SHA `C0E58B4332CD9477F8A32DCACF3ACB75626ACA6F3044184ED44AF4C5C6753DAE` 与逐文件清单已另存 v1，重冻仍以原始实际字节计算，不改成首次冻结源码基线。root 提供的探针只读检查；未运行、修改其保留数据库，实际回归全部使用本轮新建、受限临时路径内的隔离夹具。

### 已确认产品缺陷

1. 发题方法在首次 await 前未捕获调用方 request。root 的实际索引探针在当前性校验后暂停，把 count 20 改为 1，得到 1 题而非原 6 题。本轮新夹具进一步确认 count（含 100）、嵌套 scope、concept、repositoryId 和 snapshotId 均可能在暂停期间影响发题或身份校验；原方法也未在工作区查询前拒绝 getter/隐藏/symbol/非普通原型/循环/非有限数。根因为 requireCurrentSnapshot、requireStore、issue 反复读取原可变对象，已有完整数据捕获只用于答案提交。
2. binding 历史重建虽然核验完整 generator 与 history projection，但缺少截点严格早于目标 attempt 的 SQL 顺序条件。root 用真实 entry attempt rowid 1，把 cut 从 0 改为 1、加入自身 retry、重算所有 witness/projection/question/rubric/capsule 摘要及列后，仍得到 verified-generator。本轮新夹具确认自身及包含实际后来 attempt 的 cut 均有此缺陷；原排序/摘要重建只证明输入自洽，未证明题目不依赖其后来自己的答卷。

修正前执行下列针对性命令：14 项失败、73 项跳过，退出 1；失败对应上述真实行为，并未修改断言使其接受旧结果。

```powershell
./node_modules/.bin/vitest.CMD run packages/application/src/ownership-capsule.test.ts -t Q1-review --maxWorkers=1 --no-file-parallelism --no-cache
```

### 修正与针对性再验证

- application 先复用 captureOwnershipData 拒绝不完整数据并深克隆，首次 await 前解析 request，随后 current 检查、store 选择及 issue 都只使用该私有值。内部正安全整数 count 100 保持支持，公开 IPC 20 题契约不改。没有引入新的当前性 barrier。
- binding save 在原事务内查询实际 source 数据库的目标 attempt rowid（同时约束 attempt/repository/snapshot），verified cut 必须严格小于它；历史 readRecord 使用相同检查，排序 engine 不支持也不能跳过。prepare 时尚无待保存的真实 attempt，因此最终保存门检查实际已插入行，失败由原三行事务回滚；历史读取及迁移重开则固定拒绝，不改行。
- 新测试真实完整重算 self/later 原题、witness、history projection、rubric 和 capsule 摘要，分别检查 read、内部同步 save、重开拒绝，并核对回滚后三张表精确不变。正常 retry、自身 questionId 可等于旧 questionId 的合法重答以及发行后回退 completedAt 仍沿原规则处理。

修正后原针对性命令：14 项通过、73 项跳过，退出 0。请求完整性测试确认 getter 零执行且工作区查询零调用；请求迟到修改测试包含 count100，不靠减少原题数量通过。

最终冻结源码按“首次冻结实际验证”列出的同一九文件命令复验：9 文件、259 项通过，退出 0（包含新增 14 项；其余 245 项保持通过）。同节列出的 contracts、ownership、graph、application 四条 noEmit 命令均再次退出 0。源码自该次完整回归起未再修改，只完善本记录及生成冻结交付文件；不再扩实验或重复全量检查。

未提交、推送、合并；HEAD 未变。未访问其他 checkout，未运行导入项目的代码或仓库命令、网络请求、build/native/dist/Electron 或 GUI；只读核对本开发 checkout 的 Git 清单及 HEAD。未修改 Q2 当前性 barrier、semantic policy/task/result、durable reserve、worker recovery 或远程发送；未验证这些门，也不自动进入第五批。SQL rowid/hash 不提供针对人工整体重写的防篡改日志保证。

AGENTS 新增/修订 0：本批明确冻结规则文件；本次证据完整性、原子保存及授权边界已有规则覆盖。内部 count 差异仅记录为本批兼容修复，不提升为无充分泛化依据的通用规则。过程记录、单元/集成回归均不替代 root 独立验收或真实 Electron 操作。
