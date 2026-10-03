# 4B-S1b 原始材料写入：设计派发

2026-10-04 06:26，协调方。优先级P1，沿用Windows/V1发布质量边界。现有S1a读取能力仍有真实file symlink EPERM安全门未验，不能提交或称完整接受。其两项已复现输入/清理缺陷修正已由协调方复验；这只允许在冻结接口基础上推进不执行文件操作的下一设计，不豁免S1a门禁、不授权S1b实现或生产运行。

## 实际依据与目标

- 当前main `22be424fa8eae7780e3c481b7ccc724a2329d43b` 没有S1a实现；原Sol目录保留旧HEAD。S1a adapter冻结hash `03B7A8F4C8BACF39F34E4A81F20EB9D8DB7713F5B1BFC6457035AD8FFF2FB1F9`，native `8A0809C2584DC2C2607F16E8AC9052B1948B62256BA807A9D53C45D2D171A91C`。
- 真实adapter只提供acquire/read/verify/close，metadata固定rawPackageCreated/restoreApproved/productionApproved=false；native只读源HANDLE。没有目标创建、写入、flush、材料重读、包重开验证或complete marker接口。这是实际缺口，不把夹具helper当产品备份。
- 已接受B0文件边界与4B-A迁移失败/WAL材料实验证明先保留字节的必要性；本轮只细化原始材料写入的最小安全契约，不能重写B0，不能提前增加SQLite profile/VFS/恢复或启动接线。

## 文件与依赖边界

原开发-Sol，仅5170目录，新增两文档：

1. `docs/plans/2026-10-04-upgrade-raw-material-writer-design.md`
2. `docs/development-runs/2026-10-04-upgrade-raw-material-writer-design.md`

既有S1a四修正文件及native/build/fixture/ignore/core/B0/4B-A/UI/AGENTS/package/lock全部冻结。不写代码、不安装依赖、不操作自有或生产数据库、不运行native/Electron/build/dist、无GUI。缺少工具证据的API行为明确列待实验，不以文档推定本机运行成功。Luna无新任务，不为填并行槽另造工作。

## 可审查的设计交付

- 给出最小私有writer接口、源lease保活/operation绑定、目标根与操作子目录句柄、单组件相对FILE_CREATE独占创建、payload名字映射及重复/替换/硬链接/reparse拒绝门。不能从任意路径字符串生成写权限，不能把nonce或hash当身份认证。
- 区分源文件身份/字节hash/manifest关联及目标归属。保持128KiB、10,000成员、20GiB及15分钟现有上限，输出空间查询只提示，实际失败关闭；未知root/子项不递归删，重试用新操作ID。说明源集合verify时机、absent变化、取消/挂起I/O关闭顺序。
- 明确写入→逐成员flush→同目标HANDLE重读/摘要→manifest写入/关联验证→`raw-material.complete`最后创建的次序与每个失败/退出切点。只承诺可验证的材料完成，不声称断电原子性；需要额外平台保证的点单列。
- 明确重开包验证不能打开SQLite，任何SQLite之前S2仍须恢复依赖解析/profile/身份门。receipt保持raw-material/ordinary-win32-handles、semanticIdentity/recoveryDependencies unchecked、restoreApproved=false、productionApproved=false；历史不完整/篡改/额外成员拒绝，raw marker不能批准恢复。
- 分开本机同用户恶意篡改威胁与普通句柄分享范围，普通ACL继承不是新私密保证；不提权、修改ACL或安全设置、不扫描用户目录/进程/凭据。
- 按最小实现切片列将来准确文件/依赖候选及测试门，给出三库四类/空文件/>2MB、目标busy/空间不足/短写/flush失败、源变化、取消、进程退出、未知child关闭/清理失败及原字节不变的自有实验矩阵。file symlink未验门和S1a未接受列前置限制；不通过重复旧报告补门。

完成门是两文档基于上述实际代码形成一致且有限的方案，诊断与权限边界明确、无假接口/假运行结果，root独立审查通过后才另派具体实现。允许AGENTS候选0，不把本轮设计写入已验证工程经验。
