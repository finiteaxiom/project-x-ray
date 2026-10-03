# 3F-C2：Application 导航缓存与观察端口

日期：2026-10-03。开发交付，等待协调方独立复验与集成；不是界面或性能验收。

## 目标、基线与范围

按协调方已接受的 C2、O/T 计划，仅为既有 `getEvidence`、`readSource` 减少重复完整快照解析，保留每次请求的证据行、保存源码、配置、范围及工作区校验。只静态索引临时 TypeScript 样例，没有执行样例代码。

原 worktree HEAD 保持 `455d4ad50830ee2495b70927e51caf830a4efbb8`，分支 `codex/llm-explanations`。开始时已有大量未提交和未跟踪文件；没有 reset、同步、提交、推送或合并。实现前 application/index.ts 与主 checkout 已接受 S5 文件逐字一致，SHA256 为 `A2ABD80A9350B42B0AA91FABA3B400E4E17684880C23A0F7A908DB245C3FCCCE`；C1 graph 两文件也逐字一致。

本轮仅修改 application/index.ts，新增 navigation-cache.test.ts 和本记录。其他用例仍走原 requireSnapshot；GraphStore/C1、ownership/S5、contracts、desktop/UI/native、依赖、工具与 AGENTS 均冻结。没有迁移或第三方依赖。

## 实现

- 一个私有槽保存同一 GraphStore 实例、repository/snapshot 身份、rootPath、独立 evidence Map 和 C1 样本。没有 nodes/edges、源码、配置、current 或工作区状态。切换身份或连接清槽，A→B→A 重新构建。
- 现代候选在同连接上同步执行 before、完整加载、投影/准入及共同 finally 的 after。只有身份正确、投影成功、两个有效样本相等时安装。读取、投影和准入失败后仍执行实际 after；失败与 race discard 分开记录。原加载错误对象保持；fallback 使用本次已加载结果，不为观察追加完整加载。
- 保留原 known/project/legacy 选择与空值回退顺序。实际载荷来自其他连接或载荷 snapshotId 不匹配时禁止安装，但保持原选中连接及原 API 路径。legacy 归一化载荷绕行，不造现代 candidate、安装或回写。
- 唯一 estimator 计算身份、rootPath 与去重证据投影的 UTF-8 JSON 字节，逐项累加，超过 4,194,304 字节立即停止。边界包含等于上限；该预算不是实际 heap。Map 保留原 Array.find 的首次匹配语义。
- getEvidence 仍 fresh-read 当前证据行。readSource 在 await 前捕获输入、导航上下文和独立证据，仍 fresh-read 保存源码与配置，并检查精确范围、空文件证据、路径分类及工作区内容 hash。迟到 continuation 不重取当前槽。返回 Evidence 不泄漏缓存引用。
- `openNavigationCacheObservationV1()` 是单 scope、pull-only 的四方法冻结 facade。只有 begin/end marker 追加两次窄样本；不懒打开 store，不读取快照、证据、源码或配置。产品 candidate probes 与 observer enabled/disabled 无关。
- API 入口捕获 phase，resolver 封存 disposition，settle 恰好发布一次。后续证据、源码、范围或配置错误不改写 installed/hit/bypass。固定摘要包含 O/T 规定的计数、枚举和 coverage；没有原 token、标识、路径、源码、SQL、错误或逐请求事件表。
- 摘要是独立深冻结固定形状；溢出或损坏计数停止有效聚合，并保持输出数字为有限非负安全整数。提前 end、错序、未决、dispose、close 和 probe 异常显式使 coverage 不完整。旧 scope 的迟到请求不污染新 scope。同步 candidate 不新增取消点，cancelled 保持 0。
- close 先清槽和失效 scope，再保持原所有权与 store 关闭顺序。

## 实际反馈与验证

本轮没有出现测试失败。首轮定向 22 项通过，补齐边界后 35 项通过，最后 43 项通过。中间 application 整包 217 项通过；增加最终故障回归后再次执行整包，结果如下。以下均是本轮实际命令，直接运行现有运行时，没有 pretest/native rebuild，没有修改原测试断言或时限。

| 命令 | 本轮最终结果 |
|---|---|
| `node node_modules/vitest/vitest.mjs run packages/application/src/navigation-cache.test.ts --fileParallelism=false` | 1 文件、43 测试通过，exit 0 |
| `node node_modules/vitest/vitest.mjs run packages/application --fileParallelism=false` | 9 文件、225 测试通过，exit 0 |
| `node node_modules/vitest/vitest.mjs run packages/graph --fileParallelism=false` | 7 文件、111 测试通过，exit 0 |
| `node node_modules/typescript/bin/tsc -p packages/application/tsconfig.json --noEmit` | exit 0 |
| `node node_modules/typescript/bin/tsc -p packages/graph/tsconfig.json --noEmit` | exit 0 |

实际 SQLite/application 回归包括：

- project/global 两种实际数据库布局的现代快照；重复两个 API 只完整加载一次，而证据、源码和配置保持逐次读取；返回别名变异不影响后续读取。
- 第二连接提交、回滚、删除与损坏载荷；同连接 save/reuse；首建和重建 external/local/both race；失败 candidate 的真实变化及不可比 after，失败终态不改写为 discard。
- 真实活动事务，固定不可比 token 状态，抛错 probe，legacy 归一化载荷，错 repository、missing ID、载荷 ID 不符、原跨连接回退；旧快照/source 行未被重写。
- 实际持久化超过 4 MiB 的证据、精确 inclusive 字节边界、无效 estimator、唯一 estimator 次数；admission 拒绝仍保留实际 after 变化。
- 同样数字 token 的不同连接、A→B→A、异步 readSource 输入变异与跨项目换槽、当前配置和工作区变化、精确空文件范围。
- enabled/disabled 结果与错误等价、candidate 原探测次数一致、marker 恰两次且零其他读取；installed/hit/bypass 后的 API 失败 disposition 保持。
- scope 单实例、phase 归属、提前 end 的缺失 marker、dispose 未决旧请求、新旧 scope 隔离、错序、close、计数溢出、NaN 和额外字段损坏、独立深冻结摘要。
- 每个完整样例交叉核对唯一 decision/终态、attempted 分解、installed/discarded 对应、admission 等式、checkpoint 次数，以及 build-after O/R/Delta 不等式。未采集 probe 不补造覆盖。

开发中根据源码检查补充两项防护，未声称出现过红测：数据库键正确但载荷 snapshotId 不符时不安装；内部损坏计数时用固定摘要形状复制安全值并失效 coverage。对应受控实验现已通过。测试中的故意读取异常和 race 是预期样例，不是本轮产品回归失败；未出现环境故障，也没有降低门槛来消除失败。

## 冻结与复验入口

最终源码 SHA256：

| 文件 | SHA256 |
|---|---|
| packages/application/src/index.ts | `855105B4A86B39524EF7E46A1665B5C058DDD6A334021BB6929337B78E56CF18` |
| packages/application/src/navigation-cache.test.ts | `6B2226B377373D92BD8987FA72CD2A6A39E57F738C4D660F6A007C9DBFC5B2BA` |

冻结的 C1/S5 文件本轮再次核对：graph/index.ts `853DA33765953DC5803EFDB692583C37CDED7F13E7266545F1724395DCE4B4AB`；graph/index.test.ts `3CA2248832CA336EA4C138C6FC7020744CF3EFE5B20050822C64D65FC75F3F61`；ownership/index.ts `9B4CF19572CA2C07A7F1C648F278660B2B2167C055FD923768AA3703037CD91D`；ownership/semantic-rubric.ts `3D44AF48E50E0E86246E143CFA4F7730549559AB3152CC7C25B12FA6DE35A47D`；graph/ownership-capsule-store.ts `D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE`，均保持原值。

协调方需以已接受 S5/C1 主 checkout 为对照审查本轮三文件，而不能把 worktree 相对旧 HEAD 的全部未提交内容当本轮差异。S5 评分和其他业务方法未变。只复制对应验收差异，不同步整份 AGENTS 或其他历史文件。

## 限制与规则判断

本轮后台实现与 Node/SQLite 自测已完成，独立复验、精确集成及 Git 收尾由协调方负责。未运行 build/native/dist/Electron、GUI、benchmark、网络/远程模型；没有实现 v2 计量工具。测试中重复现代导航完整加载一次，仅证明缓存复用行为，不能声称实际产品性能收益或正式 3F-T 门通过。

正式门仍要求同调用三配对、两轮每 API 全部 1,177 证据、11 语义门及完整可比观察下完整加载不超过 2；真实 GUI、远程质量、签名与干净 Windows 门保持开放。SQLite token 不提供跨表或文件系统原子性，每次请求仍执行规定校验。

本轮不新增或修订 AGENTS 规则：身份校验、失效、新鲜证据、异步上下文和独立验收已有规则覆盖；observer 的 O/R/coverage 要求已经在接受的专项契约中明确。AGENTS 按本批约定冻结，没有为了条目数量制造经验；两项防护及验证留在本记录供协调方判断。

## 协调方独立复验（2026-10-03 18:07）

root核对实际Sol目录/HEAD、三文件冻结hash、相对main已接受S5/C1的完整差异、当前规则与开发记录。旧worktree其他修改保留，不整体集成。源/新测试分别855105B4…与6B2226B3…，记录冻结E5200B4F…；只精确复制三文件进入main，源码hash再次相等。差异仅导航私有槽/聚合、两API接线与close，不改变所有权等其他方法或GraphStore。共同finally、before复用lookup样本、私有候选关联、fallback连接选择、准入/别名/异步捕获及observer阶段/coverage逻辑已独立审查。

root实际Sol命令：定向43/43（9.80s），application全包9文件225/225（95.43s），graph全包7文件111/111（5.09s），两包noEmit exit0。精确集成后main application全包10文件229/229（108.79s），graph全包8文件114/114（5.36s），两包noEmit exit0；主目录额外既有测试也参与此实际整包调用，数量不沿用此前部分切片记录。git diff --check通过。

root两份自有ignored探针在Sol/main各执行真实索引与两SQLite布局，均exit0：navigation-cache-independent.ts输出layouts=2/navigationResponses=48，覆盖两轮全部小样例、逐次行/源码/设置、窄marker、隔离摘要/返回值、损坏/删除/回滚/close；navigation-cache-race-independent.ts输出checked=12，覆盖两API/两布局的有效load后提交、失败load后提交和安装后fresh错误，核对单次完整读取、after分类、原异常与唯一候选终态。原持久payload/source不变，源码hash运行前后保持。此不是medium1177正式测量或GUI。

竞态探针首轮exit1是测试复现缺陷：向SQLite写回相同payload没有使data_version改变，故预期external discard没有发生。root隔离真实WAL双连接实验确认sameValueUpdateChangesToken=false、actualMutationChangesToken=true，改为自有fixture root_path实际元数据变更，保留全部原断言后12场景通过。没有修改产品或降低门。修正后探针SHA256 1D40B7EC3456AE33A8B2AC2EF90B5055A4654BAE83DC12A9C7CC4EC3D293EF8D；一般探针33A28CED…保持。该错误与修正仅过程记录，不新增AGENTS经验。

C2后台切片独立接受、主目录复验通过；Git版本由公共审查记录实测补记。未运行GUI、Electron、native/build/dist、提供商或正式benchmark，不将后台接受升级为产品性能/界面通过。新v2工具待按独立实施计划派原Luna，原全部计量与语义门保持。
