# 2D-S1 已提交语义材料只读端口

2026-10-05，开发-Sol，仅5170 checkout；原第二批。基线 `codex/llm-explanations` / `455d4ad50830ee2495b70927e51caf830a4efbb8`。依据[批准计划](../plans/2026-10-05-ownership-semantic-material-port.md)，未规划第五批。

## 基线与精确范围

实现前核对三文件原SHA256并在自有临时目录保存原字节副本，全部匹配计划：

|文件（packages/graph/src/）|原SHA256|
|---|---|
|ownership-capsule-store.ts|D5DFCC7A17A4A1A50A5C5EDDACAD6A790B4EFAF6340931132C8689C9F29836FE|
|ownership-capsule-store.test.ts|8617AB8E468DBDB012F60DD063DE320138F17E610C26F817A67DEA4A8A535DD9|
|index.ts|0786ACAB39A2028E7189692768065510442FF531378A979A445475E1E92A06AF|

本轮仅修改上述三文件并新增本记录；其他既有 modified/untracked保留。index原677行CRLF及旧冻结功能保持，只修改一条类型import、新增一条类型export及一个委派方法（3插入/1删除）。两个capsule文件保持原LF。测试原迁移列表11→12差异保留；没有修改迁移实现、contracts/application/ownership/llm/cache/desktop/UI/loan/native/AGENTS/package/lock或协调记录。M4四文件冻结不变。没有Git写操作、native/build/Electron/PowerShell实验、网络或凭据操作。

交付的是与原字节副本比较生成的三文件精确patch，不是相对HEAD的旧工作总diff。patch SHA256 `6784FE4D3D573D74FFA9D41365C6542EE7A31BCEED01C7E51EE337B735E7F580`；`git apply --reverse --check <本轮patch>` exit0，仅校验，未apply。

## 实现结果及语义边界

`GraphStore.loadOwnershipSemanticPackage(attemptId)`只接受已持久attemptId，返回内部端口类型`OwnershipSemanticPackageRead`。ready携完整现有`OwnershipSemanticPackage`、attempt/capsule及`questionBinding=prepare-only`、`currentness=not-checked`。not-found/legacy-capsule-absent不构造包；not-evaluated保留历史材料及显式标记，没有package。非法ID、来源损坏与关闭失败使用原固定错误类和文案，不回显SQL、路径或源码。

提取共用私有read，原load与新端口均在首次await前同一个deferred只读事务捕获attempt、capsule、snapshot、规范图表、source_snapshots等材料。事务内不await；后续只用私有解析结果。复用原material/来源身份/双hash/manifest/精确范围/角色与路径校验；ready保留原包构造，直接返回同一严格validator的结果，没有复制宽松校验。新端口返回防御副本，并在await后再核store未关闭。

原load返回shape、错误与历史语义保持，不增加currentness或package。prepare/save仍使用原当前性、配置、事务与receipt门；新读取不创建receipt、任务或授权，不调用LLM/provider，不改变包预算。没有SQL写、迁移、当前晋升、评分或mastery变化。

返回包表示读取时捕获的持久历史材料，经存储来源一致性校验；不证明工作区、活动窗口、配置当前性、授权、外发许可或原题在读取时重新认证。仅重写questionFingerprint并一致重算rubric/capsule hash仍保持原历史读取行为，显式prepare-only/not-checked，而原prepare仍拒绝与原题不符的重写。未把未加密摘要升级成来源认证或许可。

## 反馈闭环与实际验证

首轮新增矩阵有一个右括号遗漏，Vitest transform失败、0测试执行。根因已确认是新增测试语法缺陷，不是产品缺陷或环境问题；修正后57项capsule回归与graph noEmit通过。补齐并发/防御副本/关闭/非ready等后65项通过。没有确认新的生产行为缺陷，也没有编造失败修复或更新金标快照。

最终实际命令及结果：

1. `node node_modules/vitest/vitest.mjs run packages/graph/src/ownership-capsule-store.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：65/65。
2. `node node_modules/vitest/vitest.mjs run packages/graph/src/index.test.ts packages/graph/src/ownership-capsule-store.test.ts packages/graph/src/snapshot-immutability.test.ts packages/graph/src/ignore-settings.test.ts packages/graph/src/analysis-parse-cache.test.ts packages/graph/src/remote-explanation-store.test.ts --maxWorkers=1 --no-file-parallelism --no-cache`：6文件122/122；最终6.22秒。未运行windows-upgrade/native相关测试或构建。
3. `node_modules/.bin/tsc.CMD -p packages/graph/tsconfig.json --noEmit`：exit0。
4. 与原副本精确diff审查及patch反向check：通过。旧index内parse-cache等变更、迁移12测试差异保留。

本轮覆盖：

- 已有真实generator/grader/builder→真实SQL保存→关闭重开→新端口；四题型×project/global旧布局×空/非空排除规则共16组合。完整包与严格validator结果相等；六字段分析身份、结构化答案、引用、rubric、边和proof顺序及独立按源码范围截取的片段一致，无裁剪/重排。
- 每个矩阵读取在query_only=ON下成功；读取前后所有表schema/行值及历史payload字节、total_changes一致，无新表/迁移/写入。旧load shape保持。
- 缺attempt、旧无capsule、预算/结构证据不足的not-evaluated均无package；非法ID与关闭后固定失败，不猜补旧题或证据。
- 原持久column/attempt/hash/payload/role/proof/source/edge/evidence损坏回归同时检查新端口固定拒绝。
- 首摘要await时事务已结束；第二连接分别改源码、边列、重算capsule hash后的角色顺序/分析投影、重算rubric与capsule hash后的路径顺序。本次完整包精确等于改动前捕获，仍not-checked；下次读取按实际新材料拒绝，未混拼两版。
- 修改返回片段/角色或植入访问器不影响SQL/再读，getter未执行。当前activation/is_current及排除配置改变后只读历史仍not-checked，不授予当前性。
- 首await后关闭store，新端口固定RECEIPT_INVALID；原prepare/save失败回滚、冲突、retry、跨库配置锁和重开回归继续通过。

## 冻结与待审

|文件（packages/graph/src/）|最终SHA256|
|---|---|
|ownership-capsule-store.ts|731892E16E24461CE02B4BC27BB48234244841D4B11188C72ABDB59F8D952B17|
|ownership-capsule-store.test.ts|617A1233D5024E97575FF21B7BECC01992D3125351B566D3E8200846342FF535|
|index.ts|2A2519F20653A140324707A86B3A78C077C7C73EF89366DD948A6474970AF512|

开发验证完成，交root独立审查/主集成。未复制或读取LLM实现来做接线，不宣称已通过2C-L实际生产编排或远程请求；跨purpose lease/授权、当前性门、provider、GUI与远程质量仍未验。没有提交、推送或合并。

本轮AGENTS新增/修订0：批准四文件边界及已有证据、短事务和保留工作区规则已覆盖；新增测试语法错误不是工程规则沉淀依据。没有用记录替代独立验收，原四批完成后的规划暂停边界不变。
