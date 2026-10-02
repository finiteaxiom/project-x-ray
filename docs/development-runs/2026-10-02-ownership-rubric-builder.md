# 2B-S3：纯rubric builder准备与边界

2026-10-02；本worktree HEAD仍为`455d4ad50830ee2495b70927e51caf830a4efbb8`，保留旧未提交改动，不ff/reset/Git收尾。

## 实现前精确文件边界

本批授权新增`packages/contracts/src/ownership-capsule.ts`、`ownership-capsule.test.ts`、`packages/ownership/src/semantic-rubric.ts`、`semantic-rubric.test.ts`与本记录。唯一区分于新增清单的同步例外是contracts/index.ts前三行后追加已接受`export * from "./ownership-semantics.js"`；禁止导出新capsule/builder，其他barrel、application、GraphStore/迁移、provider/IPC/UI、S2a三文件与旧接线全部冻结。不新增依赖，不读FS/SQL/模型构造材料，不运行真实索引/build/native/dist/Electron/HTTP/凭据/电脑操作，仅拟跑纯contracts/ownership回归与类型。

## 已核对与实际动作

Get-FileHash逐文件核对本worktree与主实际ownership-semantics源模块/测试，SourceEqual=true、TestsEqual=true。源SHA256为`9DC3393ECE07473926E3934EA2690615F1DEE824F6A44F3FC9053B675210C7FA`；测试为`741F2D1F0306BC9AA8E589A2D96E380DE835716E75682186591300C66D7B9D62`。没有复制整文件或同步主语料。已按唯一例外在既有第三行export后追加ownership-semantics导出，不覆盖旧桌面barrel内容。

只读核对两包package.json：contracts的exports只有`./src/index.ts`；ownership通过既有`@project-xray/contracts`依赖消费它，tsconfig.rootDir为src。设计要求新capsule模块负责唯一preimage/schema/hash供builder复用；目前禁止导出capsule，因此正常包接口没有该新端口，package exports也没有capsule子路径。源目录相对导入将绕过包公开边界，且未核验其rootDir类型行为；不拿这种绕行或第二份schema/hash实现当作正常交付。

## 需协调方先确认的窄依赖缺口

建议仅追加`export * from "./ownership-capsule.js"`这一行作为新契约公开端口（root可单独集成/审查），供ownership新builder正常导入；不需要导出builder、不更改package.json/依赖/其他生产代码。该行当前被明确禁止，尚未写入。若协调方要求保持所有barrel冻结，需要指定另一个已授权公共消费端口或明确允许并验收跨包直接文件导入；不能静默扩大范围。

截至本次依赖报告，尚未创建四个实现/测试文件或运行新回归；没有产品红测，不声称builder实现/验收完成。hash相等与导出同步只证明已接受语义基线可用，不等于新胶囊端口已可调用。本轮暂不提出AGENTS经验；边界解决后继续原纯builder/golden与反馈闭环。

## 最终交付状态：取代以上准备状态

以上是开工依赖报告的历史状态。协调方随后明确授权 contracts/index.ts 只追加两精确 exports：ownership-semantics 与必要 ownership-capsule。实际采用公共包端口，没有绕行私有源路径、复制 schema/hash 或更改 package/dependencies。四新源码/测试已完成；连同本记录与两行 export 共六个交付文件。旧 barrel 的桌面接口改动属于此前冻结接线，不纳入本批新增差异。application/S2a、graph/SQL/迁移/provider/IPC/UI、旧接线、AGENTS、两份已接受设计文档均未由本批修改。仍无 Git 收尾，HEAD 保持 455d4ad50830ee2495b70927e51caf830a4efbb8。

### 实现

契约提供严格 ready/not-evaluated 两分支、固定版本、有限失败原因、nullable sourceIdentity，以及唯一 canonical UTF-8 preimage：完整 question、完整 attempt、完整引用/role projection、去掉自身 capsuleHash 的完整 capsule 分别使用固定域。WebCrypto SHA256 与 Node 同步摘要消费相同字符串；Node crypto 仅用于测试。摘要是完整性绑定，不是密码学签名，也不能证明构造者拥有权威事实。

builder 首个 await 前检查并深拷贝调用者供给的纯数据；不读文件系统、SQL 或模型。核对原 gradeAnswer 实际结果与 attempt、题目和快照身份、分析结果摘要、manifest、源码 contentHash/bytes、精确范围及代理对边界。getter/symbol/不支持对象、伪造来源或未知异常固定失败，不输出原异常或源码。ready 只返回必要证据元数据，不保存片段或原答案；临时 assessment DTO 用所选片段验证闭合与预算。

定义题只解释定义位置/种类；方向题固定 caller→callee；路径题选择完整且全部精确引用的合法配对边序列，canonical ordinal 排序，不取最佳部分覆盖或混拼；变量题逐一验证所有提交 role，原引用索引→validated 索引映射与所选位置完整绑定。准则权重总和 100；每条准则仅有静态限制及答案信息不足两个互相闭合的限制条目。不抓无关 unknown/dynamic 事实。答题范围采用完整 UTF-16 答案，空答案用空范围，不做关键词评分/分句。本地位置分、结构分、passed、历史数据不由 builder 改写。

超限不裁剪题目/答案/引用，返回独立 not-evaluated 对象，没有大字段 spread。完整 question/attempt hash 保留；nullable 身份不填造。最宽合法固定字段组合实测 992 ASCII bytes，低于 2KiB。ready 与临时 assessment DTO 分别限制 64KiB；答案 16KiB UTF-8，单 proof 4KiB/40行，总片段 24KiB，准则 8 项。

validator 只校验供给记录：首 await 前完整私有捕获 raw capsule/question/attempt；不执行 getter，拒绝 symbol/不可枚举字段以避免静默遗漏。两分支统一关联 repository/snapshot/questionId/version/kind/variant/concept；所有摘要及后续字段比较只消费该捕获。ready 另核验答案、准则/限制字典 hash、必要证据/精确引用及角色投影闭合。不声称 SQL 当前性、真实分析器正确性或自然语言语义正确。

### 实际反馈闭环与失败分类

1. 首轮 contracts noEmit 通过；ownership 有两处实现类型错误：非分配式 Omit 联合使降级 reason 不可用，optional-chain 条件未收窄随后 edge 访问。修正为显式分支内容联合与 undefined 判断，后续类型通过。只读发现严格 pick 接收整份 question 会被多余字段拒绝，在第一次 builder 回归前改为显式有限 metadata；没有声称对应运行时红测。
2. 初始 builder 18 项实际通过。新契约 golden 初始化用了明显占位期望值，首次失败是未完成测试而非产品哈希漂移；先独立比对 Node/WebCrypto 同一 preimage，再固定 Node 摘要为版本向量。最大时间样例误写 34 字符而契约 max32；修正样例为 32 字符，原 schema/预算不变，实测 992 bytes。两者属于测试准备/构造问题，未盲改金标或阈值。
3. 81 边样例首轮返回 unsupported-proof-kind，原预期 rubric-budget-exceeded。根因确认：把补齐 variant 长度全堆到单个 ID，超出既有远程 ID 上限。将同样长度分摊到 81 个合法 ID，createQuestions 实际产生恰 5275 bytes variant，预期降级通过。属于测试样例问题，未改变产品 schema。
4. 恢复批次前 usage limit 执行中断，额度恢复后从实际文件继续，没有重初始化或改变基线。属于执行中断，不记录为产品失败。
5. builder 扩展后限定 8 文件/153 项通过，两包 noEmit 通过；稳定生产源码供协调方只读审查。**此状态并非最终验收**。协调方独立纯探针确认公开 validator 两个产品缺陷：not-evaluated 未关联题目与尝试；首 await 后引用 caller-owned attempt，迟到替换可改验证目标。外部探针 exit0 是缺陷复现成功，不是验收通过；本 worktree 未运行该外部脚本。
6. 针对独立发现先补本地红测，`node node_modules/vitest/vitest.mjs run packages/contracts/src/ownership-capsule.test.ts` 实际 exit1：12 项中 8 失败/4 通过。跨 repo/snapshot/questionId/version/kind/variant 六例把完整摘要全部重新计算后仍错误 resolve；明确以 Promise gate 暂停首个 WebCrypto 摘要，再替换 attemptId 的一例错误 resolve；accessor 捕获一例执行读取且错误 resolve。产品缺陷已确认，不是预算或环境问题。
7. 只修 ownership-capsule.ts：新增首 await 前 descriptor 检查与完整深捕获，统一两分支题目—尝试关联；full preimage 仍使用未经裁剪的捕获记录，ready 的既有 hash/projection/预算保持不变。builder 与两行 barrel 保持冻结。原匹配/后改不污染、迟到替换拒绝、getter 不执行、symbol/不可枚举拒绝及全部旧回归通过，见最终命令。没有新增依赖或降低阈值。

### 最终实际验证

- `node node_modules/vitest/vitest.mjs run packages/contracts/src packages/ownership/src`：exit0，8 文件、161 测试通过。其中新 capsule 12 项、新 builder 25 项；其余为本 worktree 原有 contracts/ownership 回归，不冒充主 checkout 当前验收结果。
- `node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit`：exit0。
- `node node_modules/typescript/bin/tsc -p packages/ownership/tsconfig.json --noEmit`：exit0。

golden/对抗覆盖：四题型使用实际 createQuestions/gradeAnswer；同节点序列任一完整调用位置可用，成对备选混拼/缺步拒绝；额外引用不删除；本地合法重叠不扩展；原引用重复/重排与所有 role 完整映射，错历史索引固定拒绝；变量仅选部分候选位置可 ready，但原 location=75/structure=100/passed=false 保持；改写摘要不能掩盖 ready 的答案/rubric/role/citation/limitation 错配；输入 await 后变化不污染捕获；源替换、越界和代理对切分拒绝；注释/答案提示词不改变模板、权重、字典或范围。

预算边界：UTF-8 答案 16384 bytes 可 ready，16385 降级；空答案 ready，孤立代理降级，合法代理对保持完整；proof 4096 bytes/40行可用，4097/41行降级；总选中片段 24576 bytes 可用，第七个 4096 bytes 片段超限降级。consumer 纯投影重算临时 DTO 恰 65536 bytes 时 ready，增加 1 byte 后 package-budget-exceeded，原本地 passed 不变；这不是未来 SQL/网络端口的集成验收。8 准则权重为 [13,13,13,13,12,12,12,12]，9 步旧合法题降级；当前 generator 最多四步，8/9 步是既有契约允许的持久题样例，不声称当前 generator 自动生成。

81 条变量关系经实际 createQuestions 得到 5275 bytes 合法 variant，旧 question schema 接受；长 prompt 与 >24 原引用/不同当前引用降级并保持完整摘要。**21 roles 原 submission schema 的 max20 已拒绝，不是旧合法答题**；回归确认固定失败，没有为制造降级放宽旧契约。

最终生产源码 SHA256：capsule `5D1759AB29E78048A96448AD3294503F9170EA9500709B2470C3988BA4B0E44F`（审查修复前为 `123EB525463E982110D7E2E5711218F74BA67C0F23418B0F68F50526154AFE85`）；builder `BD96CC66FAEF1F0373F213B112BA6CC45CA140255EB76DD85F4A898F19C59165`；contracts index（含冻结旧接线）`5EA6DFECE7256D7DA52FBB36472B7D517F8CAC46E9751B37A1256BCE0696557A`。

### 未执行与规则判断

未实现/验证 SQL 同事务双写、opaque receipt、事务内权威 activation/config 重读、application 集成/取消、worker/IPC/UI、隐私授权或网络、模型文本判断、真实索引、Electron/GUI、凭据、Git 集成。本批没有运行 build/native/dist、真实仓库索引、Electron、HTTP、模型或电脑操作。纯合成材料不是分析器正确性或真实工作区当前性证明；ready 也不是语义评分通过。未提前 S4/S5；冻结六文件供协调方独立复验。

AGENTS 本批未修改。经最终独立审查发现与红绿回归，提出 **1 条候选** 供协调方查重/入库：公开异步摘要验证器须在首次 await 前完整捕获参与摘要与关联检查的调用者数据，不执行 getter 或静默遗漏字段；bounded/not-evaluated 只能放宽可评估性，不能放宽跨记录身份。验证动作是重算全部摘要后跨记录错配，以及控制首个摘要等待时替换输入，分别确认拒绝与原匹配不受后改污染。依据为本记录第5–7项确认的身份完整性缺陷；现有完整路径、配置事务或安全错误规则没有覆盖公开验证器的可变别名与降级关联。其余类型/样例失败不提出规则。该候选不是本 worktree 已写入规则，也不改变授权/产品范围/验收门禁。

## 协调方 2026-10-02 23:20–23:25 独立复验

实际读取冻结六文件与完整契约/builder、开发反馈记录，检查两精确公共导出及旧接线差异。capsule SHA256 5D1759AB29E78048A96448AD3294503F9170EA9500709B2470C3988BA4B0E44F，builder BD96CC66FAEF1F0373F213B112BA6CC45CA140255EB76DD85F4A898F19C59165；源前后相同。原未修正探针保留原缺陷断言，未改成绿灯。

root 在 Sol 执行原限定纯回归：8 文件/161 项通过、contracts/ownership noEmit exit0。另建 ownership-capsule-binding-fixed.ts 独立正向探针，7组完整重算摘要的跨记录关联全部拒绝；正常控制通过；明确暂停首个摘要时迟到 attempt 替换拒绝，原匹配的 capsule/question/attempt 捕获不被后改污染；getterCalls=0。exit0，未运行 SQL/索引/GUI。

将四源码/测试与本记录逐字节复制到此前无这些文件的 main，只追加 capsule 公共导出，未复制整 Sol barrel 或旧 UI/IPC 接线。main 原限定纯回归 8 文件/159 项通过；两个 checkout 原已有测试不同，分别报告实际分母。main contracts/ownership/graph noEmit 均 exit0；同独立正向探针指定 main 再次 exit0。纯准备切片独立接受，可纳入精确 Git 收尾；没有 SQL 双写、应用接线、模型判断或 GUI 验收。

公共经验候选逐条对照当前 AGENTS：既有配置事务/路径与来源规则没有覆盖公开摘要验证器 caller alias 或降级跨记录绑定；有前轮复现和本轮独立控制门。协调方新增 1 条具体预防/回归规则，非进度或授权条目，其余样例/类型准备失误不入库。后续 S4/S5 仍须精确派发与独立复验。
