# 第二批：已提交语义材料只读端口（2D-S1）

2026-10-05；root。依据已接受 ADR0008、S3/S4/S5 及2C-L：真实应用已经原子保存 attempt/capsule，纯请求适配器已接受，但 `OwnershipCapsuleStore.ready()` 在真实持久材料核验后构造并验证完整 OwnershipSemanticPackage，随后丢弃该包；GraphStore 只公开历史 capsule，尚无经相同存储来源核验的请求材料端口。root2C-L的16次 probe 只能在测试中手工投影，不能成为生产请求来源。此为原第二批必要后台实现，不是新批次或授权/远程质量证明。

## 精确文件和基线

原Sol仅5170 checkout修改 `packages/graph/src/ownership-capsule-store.ts`、`packages/graph/src/ownership-capsule-store.test.ts`、`packages/graph/src/index.ts`（只新增窄方法/必要类型导出），新增 `docs/development-runs/2026-10-05-ownership-semantic-material-port.md`。不改contracts/application/ownership/llm/迁移/desktop/UI/缓存/loan/native/AGENTS/package/lock或其他协调记录，不Git，不build/native/Electron/PowerShell/网络/凭据。保留刚交付M4和既有所有未验源；不要同步整份index或重置分支。

main/Sol capsule-store.ts相同SHA `D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE`，ownership-capsule契约同SHA `5D1759AB29E78048A96448AD3294503F9170EA9500709B2470C3988BA4B0E44F`。主测试SHA `5F594D27144E09FE609A1D7C891416771D9D3ABEAC4D37075AA144B120E8AF10`；Sol测试SHA `8617AB8E468DBDB012F60DD063DE320138F17E610C26F817A67DEA4A8A535DD9`，已有3G-S1迁移列表11→12差异保留，不回退。Sol graph/index.ts SHA `0786ACAB39A2028E7189692768065510442FF531378A979A445475E1E92A06AF`，含其他已冻结工作；本轮只允许窄新增方法，交付须与该原字节副本做精确差异，不以HEAD整diff冒充本轮。

## 目标与契约

提供一个只接受已保存 attemptId 的只读 `loadOwnershipSemanticPackage`（或按现有命名统一的同义窄端口）。唯一来源为该store真实SQL attempt/capsule/snapshot/规范图表/source_snapshots；不得接客户端答案、rubric、快照或文件内容来构造材料。复用现有严格来源/双hash/manifest/完整分析身份投影/图表一致/源码精确范围/角色顺序和完整合法边路径检查，不复制一套宽松校验。

ready分支返回完整现有OwnershipSemanticPackage及显式 `questionBinding: prepare-only`、`currentness: not-checked`；这是读取时捕获的持久快照材料，不证明当前工作区、活动窗口、配置、授权或传输许可。原 loadOwnershipCapsule 行为、shape和历史语义保持。缺attempt、legacy无capsule、not-evaluated等原非ready状态不生成包，不猜补旧题/投影/证据，不把准备状态升级。类型可在graph内部端口文件定义并通过既有导出惯例公开，不修改共享schema来容纳任意对象。

允许将ready的已有包构造/validator结果返回并提取共用私有SQL捕获逻辑；捕获在首次await前于一个短只读事务完成，事务内不await，后续使用该私有捕获。所有关联仍完整核验，错误固定不回显源码/SQL/路径。输出是完整有限DTO和私有来源的防御副本，可深冻结；调用者改其返回对象不能改变SQL/后续读取。不能创建许可receipt或暗含当前性，不能仅凭包摘要授予来源权威。

零写入、零迁移、零当前晋升；原attempt/成绩/mastery/capsule/snapshot/source/配置与旧payload字节不改。不接llm/provider（依赖仍内部领域契约），不把adapter总请求预算误作graph包预算；既有包预算保持，实际完整请求仍由2C-L在未来可信编排中检查。无新依赖。

## 最小充分完成门

真实已有builder→SQL保存→重开→新端口，四题型、project/legacy与空/非空排除配置；与现有严格validator比较完整包，证明路径和引用角色不裁剪/重排、精确片段及六字段分析身份正确、原load形状保持。四型生成的本轮包能被已接受2C-L适配（必要时root主集成复验，不复制llm实现到Sol）。

测试not-found、legacy absent、not-evaluated预算/证据失败均无包；重算capsule/hash后篡改图表/源码/配置投影/路径/角色仍固定拒绝，不能提升历史保证。第二连接在首个摘要await后改SQL：本次结果只用原完整捕获，明确not-checked；下一读取核验实际改变并拒绝损坏，不能混拼前后材料。返回对象修改或访问器不能污染再读/存储；关闭后端口失败固定。每次新端口读前后相关表与历史payload字节一致、没有新增表/迁移；原save失败/rollback/retry/重开门保持。

实际运行graph capsule原适用回归、必要新增用例及graph noEmit；对明确新错误加最小回归，不能删正确断言或重跑全native。反馈闭环/根因分类/本轮精确差异/最终hash冻结交root；现有规则覆盖允许AGENTS0。该切片仅本地材料端口，跨purpose共享lease/授权、任务编排、provider与GUI须后续独立安全切片，缺key不阻止本地实现也不升级真实远程验收。
