# 2B-S1：所有权语义纯契约与响应校验

日期：2026-10-02；基线 `455d4ad50830ee2495b70927e51caf830a4efbb8`。

## 实现前边界与依赖

新增完整清单：`packages/contracts/src/ownership-semantics.ts`、`ownership-semantics.test.ts`、本记录。协调方额外明确允许最小同步原ADR0008及设计记录的接受状态、普通INSERT事实与确认政策；其余所有文件（含冻结index.ts、AGENTS、desktop/UI接线）不写入。不新增导出、不改feature purpose/旧grade/attempt/passed/mastery、SQL、transport、分析器或依赖。测试直接导入同包新模块。

只使用现有zod、同包证据schemas/canonicalJson、平台TextEncoder与Web Crypto SHA-256；hash为异步纯计算，不涉及网络、凭据或存储。稳定hash规范化对象键与无顺序意义的ID集合/字典，保持路径及答案范围的语义顺序；不裁剪输入。实现strict/versioned rubric/有限限制字典/package/response及纯校验入口，检验完整criterion/引用归属、实际提交文本hash与UTF16范围/代理对、必须证据/完整所选路径和硬预算。

验证顺序：新增模块定向单测→contracts既有回归与tsc --noEmit→检查范围/空白，冻结交付。没有build/native/dist/Electron、Git收尾、凭据/HTTP或数据外发。纯校验不证明SQL当前性、真实源码真伪、rubric学习目标充分性或模型自然语言正确。

## 实际反馈与验证

实现了strict/versioned rubric、有限限制字典、独立purpose的package与三类verdict响应；异步纯校验检查唯一criterion全集、双向限制归属、允许/必需证据闭包、实际答案绑定、UTF16代理对边界、完整所选调用边序列、规范化hash与硬预算。supported/contradicted必须带证据与答案范围且限制为空；insufficient必须带有限限制，非空证据及范围仍完整校验。schema解析只证明结构；调用异步validate入口才执行闭包与hash校验。返回辅助DTO，不评分、不晋升置信度、不修改旧评分。

实际反馈：

- 初次类型检查发现新增模块中selectedPath及criterion的控制流收窄失败，根因是拒绝函数使用推断的变量声明；改为显式返回never的函数声明后，新增模块及测试严格类型检查通过。
- 初次定向测试为49通过、1失败：请求预算用例的构造数据实际未超过64KiB，因此预期拒绝不成立。这是测试数据缺陷。增加真实超限数据并先断言UTF8大小后通过；未放宽预算、删断言或裁剪输入。
- 最终定向测试：`node ../../node_modules/vitest/vitest.mjs run src/ownership-semantics.test.ts`，在packages/contracts运行，61项通过。覆盖合法三类verdict、无序集合hash稳定性、重复/缺失/交叉引用、附加字段、答案/hash/UTF16代理对、硬预算，以及同节点不同调用位置的完整路径与缺边/混拼/缺证明失败关闭。
- contracts回归：`node ../../node_modules/vitest/vitest.mjs run --exclude 'dist/**'`，在packages/contracts运行，5个文件、118项通过。
- 新模块及测试严格类型检查：在仓库根运行`node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --esModuleInterop --skipLibCheck packages/contracts/src/ownership-semantics.ts packages/contracts/src/ownership-semantics.test.ts`，退出0。
- 整包类型检查：在仓库根运行`node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit`，退出1。冻结文件`packages/contracts/src/remote-explanation-desktop.test.ts:28:42`和`:29:108`均为TS2345：activation command的protocolVersion被推断为string，无法赋给契约字面量`"1.0.0"`。本批明确禁止改该文件，因此保留并报告；定向类型通过不能替代整包门禁。
- `git diff --check`退出0，仅已有文件的LF/CRLF提示；新增代码空白检查另行完成。本批仅新增清单中三个文件，并对既有ADR与设计记录作获准的最小同步；未写index、AGENTS或冻结接线文件。未执行build/native/dist/Electron、凭据、HTTP、Git提交/推送/合并。

验证限制：测试使用纯DTO样例，不证明SQL当前性、真实源码/文件contentHash、原始questionFingerprint或attemptHash的权威真实性、学习目标充分性以及模型自然语言正确性。提供的这些元数据只检查格式并绑定package身份。未导出index、未持久化、未接入模型或GUI，本批不构成第二批端到端验收。整包类型检查仍有上述阻塞。

## 工程经验判断

协调方11:07–11:08独立复审：读取全部模块、关键正反样例及ADR0008；在冻结Sol目录执行61项定向、118项contracts回归及新增两文件严格类型，均exit0。整包旧两行类型问题由另一接线小批修复，不混同此纯模块结果。main先确认目标不存在后只复制本模块/测试/记录三文件，独立在main index.ts追加一条公开导出，没有复制Sol冻结index.ts或desktop/UI实现。main contracts116项回归、contracts/desktop/ui类型及真实公共barrel导入probe均exit0。118与116差异来自Sol尚未集成的旧桌面协议两项测试，不报成同一基线或丢失本模块测试。没有实现语义评分、数据库、模型或GUI，无AGENTS新增，满足本纯模块门而非第二批端到端门。

本轮无新增规则，也不修改AGENTS：现有证据闭包、失败关闭、精确源码范围、反馈记录与最小充分回归规则已经覆盖本轮动作。预算用例数据不足与类型收窄修正不构成需要独立沉淀的安全或产品经验；不为数量增加规则。
