# 第二批材料端口与独立授权契约：协调方独立验收

日期：2026-10-05。起点 main `999ff4e3bb1c166c8f959ace03b56f5a1db67036`。仅原第二批 2D-S1 与 2D-L1；不恢复 GUI，不启动第五批。

## 实现与精确集成

2D-S1 将已经严格验证但被丢弃的完整语义包通过 `GraphStore.loadOwnershipSemanticPackage(attemptId)` 返回。沿用历史读取的真实 SQL 材料及原严格校验，首次 await 前在短只读事务内捕获；之后只使用私有材料。ready 明示 `questionBinding: prepare-only`、`currentness: not-checked`；缺失、旧记录与不可评估分支不返回可评估包。返回副本可被调用方改变，但不影响数据库和后续读取；等待期间关闭仍拒绝。历史读取不证明原题权威、当前工作区有效或外发许可。

协调方核对 Sol 原字节副本、实际三文件补丁及最终 SHA，再在 main 正向检查和应用。补丁 SHA256 为 `6784FE4D3D573D74FFA9D41365C6542EE7A31BCEED01C7E51EE337B735E7F580`。未整体复制 Sol index 或旧生产工作；main 原迁移断言 11、Sol 原断言 12 各自保留。Git apply 引入的 CRLF 恢复原 LF 后才运行 main 检查，未改变语义或降低断言。开发自己的记录精确复制。

2D-L1 新增独立语义授权和 grant/revoke/prepare/start 的严格 DTO；完整六类披露、有限身份及版本、初始拒绝/撤销时间关系均受约束。公开入口不接受答案、rubric、源码或调用方任务身份。旧 feature 契约未扩展；完整旧、新对象相互拒绝。合法 DTO 不产生真实用户动作、数据库授权、当前性或调度许可。

两开发线程已稳定且 idle 后进行主 checkout 检查。没有依赖安装、重型构建、native、Electron、网络或真实模型调用，没有改用户不相关内容。

## 独立源码和回归证据

- Sol：graph index/capsule-store/snapshot-immutability/ignore-settings/analysis-parse-cache/remote-explanation-store 六文件，122/122；graph noEmit exit 0。
- main：上述图测试中的前四及 remote-explanation-store，加 contracts policy/semantics/remote-explanation/remote-explanation-desktop/index 五文件，10 文件 254/254（graph 118、contracts 136）；不含 Sol 独有缓存测试。graph、contracts、application 三包 noEmit 均 exit 0。
- main：application ownership-capsule 和 ownership-citation-index 两文件，53/53，13.86 秒。
- 以上 Vitest 均用实际本地 Node 入口、单 worker、不并行文件、无缓存运行；类型检查用各包 tsconfig 的实际 tsc --noEmit。
- 协调方新建自有隔离 probe，实际 TS 分析→application 四型答题→真实 SQLite 保存/重开→新材料端口→已接受纯 adapter，16/16：project/legacy 两布局 × 空/非空排除配置 × 四题型。独立重建预期 package，与端口返回的 attempt/capsule/package 完整比较；SQL query_only 下核全表定义/行及 total_changes 零变化。完整请求预算、rubric/合法路径/引用行列与 UTF-16 边界保持。该 probe 没有执行样例代码、发送数据或评价模型质量。
- 源码核对包括同事务私有捕获、材料篡改后下次读取拒绝、调用方副本污染隔离、ready 与不足分支、历史配置/激活变化仍明确 not-checked，以及纯契约旧新授权隔离。

probe 为本轮唯一自有目录 `.benchmarks/ownership-material-review-f5a55a38867340219b00e6b6023f216c/probe.ts`，通过实际 tsx 入口运行 exit 0；实验材料保留，不递归清理或提交。既有已验结果不冒充本轮检查。

## 冻结身份与反馈

main SHA256：

- graph store：`731892E16E24461CE02B4BC27BB48234244841D4B11188C72ABDB59F8D952B17`
- graph test：`DF6E5DC768AEBE19A6374DEDCFD6E65FD23C17DE446DB7D9EB953AE3C97CFF85`
- graph index：`FAEC0727D8B847202A9B66F8BC370FCA97CA3B5F16BB58C66FC7D90E15B21CED`
- policy：`1250DBFEF5BC3C9E35F32F3A824648FBEA45C55FA5BA7BD44F2BCE69FEEE2215`
- policy test：`3C141AF2EF49D3DDD76EA41983533091FA42185BD0053563C56D8896F645E8C0`
- contracts index：`E010BBFBF4D5C040D42A16E80E658AC33E25E7AD930AAC82774A86EF57E2A2F3`

Sol store 与 main 相同；Sol test `617A1233D5024E97575FF21B7BECC01992D3125351B566D3E8200846342FF535`、index `2A2519F20653A140324707A86B3A78C077C7C73EF89366DD948A6474970AF512` 的原独立差异保持。材料端口开发记录 SHA `9B924A65C1EB5A4A394A4E95FB09D691C7DB5D535DEFB847CF5C258738F39317`。

独立阶段未发现产品缺陷。开发记录分别保留新测试括号语法错误及“所有类别均与旧 enum 不同”的错误测试假设，修正没有删除正确断言；共同 source-snippets 类别不等于共用授权。公共 AGENTS 新增 0：现有私有捕获、有限 DTO、历史与权威区分规则已覆盖，本轮不重复沉淀。

## 接受与未验边界

接受这两个纯底层切片及精确 main 集成，允许协调方只提交相应源码/记录/准确计划。已实现与独立代码/回归已验证如上；本轮真实 GUI 已验证为 0。

全局语义政策持久化、跨用途共享占用、完整任务身份/currentness、dispatch/provider、跨库语义结果发布/恢复、desktop/IPC/UI 均不在本轮接受内。真实远程兼容与评分质量没有 API 账户/密钥，GUI 仍暂缓；不写入 passed/mastery 或改旧分数。原四批尚有本地工作，不将两个端口或契约标成第二批/四批完成；四批本地收尾或剩余均依赖外部条件时暂停 automation 与派发，等待讨论。
