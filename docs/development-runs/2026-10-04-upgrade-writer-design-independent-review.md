# S1b writer设计独立审查

2026-10-04 06:53，协调方。仅设计接受及下一隔离实验计划；本轮无native/SQLite/build/Electron/GUI实验。

先核当前AGENTS、执行队列、review/handoff及实际Git。main清洁，HEAD `8c3b95dc7a324fd4e20626945990b02858a9ddfe`，上一五协调文档普通push exit0、独立远端同SHA已真实核实。Sol本批冻结完成，回合 `01a103e1-dbe8-7023-a230-b2231b3d0415`、实际cursor `cfe7da2a-d1e4-4a1f-9168-182cb9c80d36:29`。双目标工具本轮只返回Sol，随后单Luna timeout0确认原P交接completed/notLoaded、cursor `5f905603-9e05-4a70-bae4-5e6a5162a670:20`，无待派具体任务。

## 当前材料与判断

完整读查Sol设计及开发记录，实际SHA-256分别：

- writer设计 `81B4DC55B2910E0765B99F3CC1BEF3A0FF26F62D9A2C0D92F277ABA49DCF75AE`。
- 开发记录 `331E8E62AB172EEB76FF62E233BDCA53C258FA6E5FF38D735AF69179B80296DF`。

实际读查冻结adapter/native访问掩码、RootDirectory逐组件打开、目录向量/rootIndex、read累计预算与旧void close；核adapter `03B7A8F4…`、native `8A0809C2…`、原test/smoke/fixture/binding/build以及graph/application/capsule核心hash保持。Sol旧HEAD `455d4ad50830ee2495b70927e51caf830a4efbb8`不对齐、旧大量未验实现不合并。

设计满足本批有限门：真实source能力与metadata分开；相对同根增权限/单组件FILE_CREATE、归属及共享窗口、只读转交/RW HANDLE区别明确；source两遍hash与累计20GiB冲突如实收敛为2B预留/通常10GiB材料，而非暗增40GiB；同HANDLE写/flush/读回→manifest关联→最后marker、失败切点、取消drain/关闭顺序和checked release缺口明确。重开零SQLite，hash只是材料关联，同用户一致伪造没有独立认证锚；raw marker不批准任务终态/恢复/生产。未知close不清理、未知恢复集合不扩大访问，S1a安全门与后续S2/S3前置保留。

只读Microsoft原始文档复核 [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)、[WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile)、[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)、[ReOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile)。确认相对根和create disposition方向，reparse打开成功仍须检查属性、实际写字节须核验，ReOpenFile的CreateFile前提不能当当前NtCreateFile句柄已验证捷径。FlushFileBuffers文档列GENERIC_WRITE，而设计较窄掩码可行性明确待实验；接受候选设计不等于这一组合通过。当前没有新运行结果或权限提升。

接受**设计文档**，不称writer实现或生产/恢复验证。目标主目录原不存在，精确复制这两份冻结文档并核完整hash；不复制任何S1a实现或旧AGENTS。本轮经验新增0，仅源码推导/官方API读查，既有HANDLE、强引用、输入/固定错误规则继续适用。

## 下一范围

形成 `docs/plans/2026-10-04-upgrade-write-permissions-probe-plan.md`，目标为单独addon/原CLI在自有确定字节上验证同父相对写根、FILE_CREATE归属、分享拒绝、不同访问掩码的flush及确定关闭。仅五新文件与一ignore行例外，现有S1a产品代码/native/测试、core、UI、依赖、两设计冻结。不实施source-loan/full writer或SQLite。原Sol一个技术窗口，Luna无新任务。平台组合失败如实保留，read-only HANDLE拒绝不冒充ACL测试；symlink EPERM继续未验，不改安全设置。

交付后root独立验收原CLI及实际Node/Electron技术入口；本轮还未运行这些命令。源借用/预算与所有产品材料、重开/恢复、GUI/发布外部门仍开放，未验实现不得Git提交。
