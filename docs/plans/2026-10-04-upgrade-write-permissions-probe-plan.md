# 4B-S1b-P：Windows目标句柄权限隔离实验

2026-10-04 06:53，协调方。P1，Windows/V1升级质量范围；先实验新API组合的可行性，不开始完整writer。依据已独立审查的 [writer设计](2026-10-04-upgrade-raw-material-writer-design.md) 与 [审查记录](../development-runs/2026-10-04-upgrade-writer-design-independent-review.md)。S1a整体仍因真实file symlink EPERM未接受；此批既不补该门，也不授权将S1a或新实验接入产品。

## 实际代码依据与目标

冻结S1a native只读目录用 `FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE`，分享读写、不分享删除；从volume实际HANDLE逐组件NtCreateFile进入根，source只读整组能力没有borrow。目标写入设计需要从仍持有的父目录相对重开同一根并取得目录写权限，及FILE_CREATE独占文件、实际WriteFile/FlushFileBuffers/同HANDLE读回。这些组合尚未实验。官方FlushFileBuffers列GENERIC_WRITE前提，设计候选是较窄具体权限；必须实际对照具体访问掩码，不能从名称推定flush成功。

仅做自有确定字节、真实Node与既有Electron无窗口技术进程的权限/分享/创建/flush实验。独立probe可以复现相同打开算法和访问掩码，但不是生产source-loan，不能声称当前S1a能够借给writer或已生产备份。先得到可复验结果，再决定后续准确接口/实现范围。

## 目录、文件与依赖边界

原“开发-Sol”，仅 `D:\Projects\CodexWorktrees\5170\Project X-Ray`，基线HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`。新增且只新增：

1. `packages/graph/native/upgrade-write-probe/windows_upgrade_write_probe.cc`
2. `packages/graph/native/upgrade-write-probe/binding.gyp`
3. `packages/graph/scripts/build-windows-upgrade-write-probe.cjs`
4. `packages/graph/scripts/windows-upgrade-write-probe.cjs`
5. `docs/development-runs/2026-10-04-upgrade-write-permissions-probe.md`

唯一既有文件例外：.gitignore追加 `/packages/graph/native/upgrade-write-probe/build/`，不改变已有S1a ignore行。复用desktop已安装node-gyp与Windows/N-API，无新依赖。单独binding/输出隔离，不能重构或重建原S1a target、reader、凭据或整应用。S1a全部代码/测试/smoke/旧build、GraphStore/application/协议/core/UI/AGENTS/package/lock和两冻结设计均不得修改。若必须额外改文件先向协调方给真实原因，不自行扩大。

原Luna没有不冲突且已具体规划的工作，保持冻结，不为填并行槽分配任务。新native/build/Electron技术窗口仅Sol；协调方冻结交付后独立接管，不与开发同时运行同批。

## 隔离实验与结果要求

- harness只在本轮mkdtemp创建并记录身份的唯一自有根内生成固定测试数据；prefix/nonce用于限定测试目录，不是生产认证。路径及operation仅受限primitive参数，不接受任意文件名/任意删除接口。仅测试addon导出受控实验能力，不进入产品target或公共graph index。普通Node/Electron应用require入口无文件或child副作用；实际argv规范入口判断，直接运行原CLI才算通过。
- 使用S1a相同volume绑定/NTFS检查、逐级RootDirectory单组件no-follow/属性和完整FileId校验。持有祖先/父/原read root直到新write root及所有target安全关闭；相对重开身份必须等于原root。不得absolute-path重新获取写根、DuplicateHandle提权、ReOpenFile捷径或fd/CRT跨addon桥接。
- 记录并断言read-only目录HANDLE直接创建子项受拒绝，同父相对重开适当写权限后可创建；固定parent/新operation FILE_CREATE实际建立当前归属，重复创建明确碰撞且原字节/身份不变。所有生成对象只固定 `upgrade-preservation/op-<id>/` 和ordinal测试payload，源自有sentinel从不写入。
- 比较设计最小具体权限与满足文档GENERIC_WRITE的访问组合：逐项报告实际掩码、NT/Win32数值结果（固定类别，不保存任意错误原文）、属性/完整ID、WriteFile返回及实际字节、FlushFileBuffers返回、SetFilePointerEx定位、同HANDLE读回精确EOF/字节hash。若最小组合失败，保留失败及原因，不能自动扩大权限后将原组合称成功；建议精确修改留root评审。
- 空文件及超过2MB的固定生成材料，128KiB上限串行分块，测试总payload不超过8MiB；真实全量读回与sentinel前后hash不变。不是SQLite文件、不打开SQLite、不生成manifest或raw-material.complete、不返回rawPackageCreated/restoreApproved/productionApproved=true。
- 在普通target share=0期间，用另一普通HANDLE分别尝试读/写/删除并确认实际分享拒绝；关闭后立即用普通HANDLE重新占用确认释放。对根/parent/operation重命名或替换的受控尝试核实际拒绝或身份拒绝，不能只比较路径前缀。自有相邻外部sentinel不读入/不改写。
- 可用自有directory junction验证预置parent重解析拒绝、外部sentinel不变；不得修改系统安全配置。真实file symlink既有EPERM未验保持，不用junction替代、不加skip或删除正确断言。ACL拒绝若没有无需改ACL的可控条件，单列未实验；read-only HANDLE拒绝不是ACL政策通过。
- 最小probe可以同步运行在独立技术child中，不要求本批实现生产async loan。所有句柄有明确checked close及失败状态；不可用GC代替正常清理。未知close/child退出状态留自有partial根，不能递归删未知对象。清理仅本次创建目录，递归清理前核resolved绝对范围、无reparse、身份与child已close；不能动源或其他操作目录。
- child ready最长5秒，每个Node/Electron实际运行总限60秒，终止后close确认另限5秒；build最长300秒、仅隔离target。超时/取消仅终止本轮自有PID并等待close，结果固定失败无完成标记；无确认close不删根。窗口隐藏，无BrowserWindow/实际GUI、无导入用户项目代码。

交付准确运行命令、当前hash、完整结果矩阵及环境限制；真实API失败、test/harness失败、环境问题分开。能够实验的必要断言不得以skip改成完成。AGENTS本批默认0，若有新确认且可执行、去重的经验仅提出候选给root，不修改冻结AGENTS。

## 完成门与后续

五文件+唯一ignore行冻结交付；root独立查代码/真实目录/hash/入口与适用原CLI运行，在自有材料确认身份、分享、拒绝、flush读回及确定释放。接受范围最多隔离权限实验，不是生产writer/source-loan/材料重开或S1a整体；运行失败可形成有用结论，但对应能力仍未通过。不得自行Git收尾。

S1b完整writer、source借用/20GiB剩余读取预算、checked release、manifest/marker/退出重开、S2恢复依赖/身份/profile、S3同实例受限SQLite打开以及生产启动仍需下一具体计划。真实GUI、实际artifact/安装升级卸载、签名、干净Windows和远程质量原门不变。
