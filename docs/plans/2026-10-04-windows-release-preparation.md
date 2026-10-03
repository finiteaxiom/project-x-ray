# 4B 第一阶段：当前 Windows 发布证据与升级保护

2026-10-04；协调方。T2独立接受后开始本轮，沿用Windows/V1范围及原双聊天，不以旧4A设计或旧TODO替代当前源码依据。真实GUI按用户要求暂缓，安装/升级/卸载交互仍未验；本阶段不打包或发布未验功能。

## 依据、目标与优先级

当前根package.json仅portable/x64，apps/desktop/scripts/windows-portable-acceptance.cjs的verifyAppDirectory只记录portable/application/ASAR/worker部分hash、native的machine；没有完整来源绑定、逐EXE/DLL原始Authenticode状态或凭据test变体排除。desktop已存在windows-credentials.ts、production/test编译与copyCredentials，但主checkout的build未接copy-credentials，main也未接旧worktree远程UI。因此不能假定旧产物已含新凭据或具有完整功能。

GraphStore构造时依序执行migrate→remote.migrate→ownershipCapsules.migrate，当前最高schema_migrations标记为11；基础序列先写9再写8，远程10和胶囊11分别事务。XRayApplication构造打开global库并扫描project库，若在打开GraphStore后再备份可能已发生迁移。当前无backup端口；max版本或schema9记录不能替代真实表/列/数据与多库打开顺序核验。4A仍包含schema9/尚无凭据实现的历史描述，须保留历史并明确当前差异。

目标是把下一实现切片收敛为可独立验证的本地产物检查工具和升级保护边界，而不是直接扩NSIS或重构数据库。P1：升级失败现场/不可变源码及ownership数据保护；P2：候选产物的真实来源、结构、签名与未验项分列。都不依赖用户key或GUI，属于已批准Windows发布质量范围。

## 原双线程本轮边界

Luna在主checkout仅新增：

- docs/plans/2026-10-04-windows-artifact-manifest.md
- docs/development-runs/2026-10-04-windows-artifact-manifest-design.md

对照当前源码形成独立候选manifest CLI的具体协议和下一实施文件清单。需明确：所查artifact集合/target/身份/架构；ASAR与物理native/worker对应；test credential/native变体排除；每实际分发文件hash；用户声明SHA与构建时绑定的来源证据区别；原始Authenticode Status、签名者安全摘要与发布者信任分别记录；旧产物/不完整接线不得冒充当前功能。未知/缺材料失败或未验，不以一枚声明SHA证明二进制来源。核查产物只读取，不执行ASAR或require所查addon，不搜索凭据/签名环境，不启动app/installer，不改变build。使用现有依赖，确需新依赖先给具体理由；独占输出、路径/联接/容量/失败脱敏边界也须可实施。保持原v1结构脚本冻结，不为兼容新报告改写历史。

Sol仅在既有worktree新增：

- docs/plans/2026-10-04-windows-upgrade-preservation.md
- docs/development-runs/2026-10-04-windows-upgrade-preservation-design.md

复核实际GraphStore/两个辅助store与应用全局/项目库打开边界，形成当前schema11、代表旧schema和partial历史夹具的最小技术验证/保护切片。明确是否存在实际已确认缺陷、仅保护缺口或未复现风险，不把推测写成缺陷。给出真实迁移步骤与可识别保留数据、备份在任何写前的层级、WAL/SHM一致性、跨多个库的打开失败、busy/事务/失败关闭/重开还原门、未来版本及角色错配策略依据。SQL测试只用未来自有fixture，禁止扫描/备份/打开用户真实应用库；初始本轮只读设计，不运行迁移探针或实现backup，不新增GraphStore公开API或重构。基于源码选择必要测试，不用所有版本号排列制造任务。

两方不改AGENTS、共同队列/审查/交接、package/lock/build/native、应用/契约/graph源码或彼此目录。保留既有未提交成果，开发方不Git收尾。Sol历史HEAD455d4ad与main不一致；GraphStore及capsule store字节hash分别同853DA337…/D5DFCC7A…，remote store原始hashmain763E700F…/Sol7923E089…不同，实际git diff --no-index exit0无内容差异（换行差别），不能把不同字节hash写成相等。设计基线用这些实际文件，不能reset/整体合并；root另将本计划精准复制进Sol目录供阅读，不覆盖其规则或现有源码。

## 完成门及依赖

每份设计引用当前实际函数/表/配置，区分已实现与拟实现；列具体文件清单、调用/数据/资源契约、正反例及独立验收命令。过程记录真实读查/失败/修正，没有运行就写未运行，经验允许0条。root独立源码复审设计后，只派获接受的最小实施切片，单重型窗口，不能直接按本文件实施产品或安装器。

artifact工具可先独立于GUI实现/检查；可信来源绑定和新runtime最终打包依赖当前功能稳定。自动升级保护依赖Sol设计审查与确切打开边界，不能从本阶段推导生产库修改许可。NSIS测试身份、per-user/默认保留、真实安装/升级/卸载、远程质量、签名证书、干净机器以及公开发布继续保留原门。

本计划为授权范围内协调决策，不是已验证工程经验；本轮无新增AGENTS条目。
