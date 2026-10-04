# 第四批：Windows只读HANDLE桥接实现（4B-M4）

2026-10-05；root。依据已接受4B-M2逐组件reader设计和M3真实子进程端口。现有源码reader的share模式/整文件Buffer不满足artifact设计；M3只有生命周期而没有真正持有读取对象的系统端口。本轮实施必要桥接，非第五批，也不以实验工具代替完整发布reader。

## 决定与冻结边界

保持manifest v1及签名not-evaluated/incomplete，不调用任何签名、网络或artifact程序。接受Windows PowerShell 5.1进程内Reflection.Emit P/Invoke作为本轮实现路线；不使用Add-Type编译器、外部编译、native addon/二进制或后代进程。API布局/句柄语义须目标运行时实测，不能以文档保证代替测试。

原Sol仅5170 worktree新增四文件：apps/desktop/scripts/windows-artifact-handle-bridge.ps1（内部库）、apps/desktop/scripts/test-fixtures/windows-artifact-handle-probe.ps1（自有材料入口）、apps/desktop/src/windows-artifact-handle-bridge.test.ts、docs/development-runs/2026-10-05-artifact-handle-bridge.md。root将已验M3 process.cjs精确复制到该worktree作为只读依赖；不得修改它。已接受M2设计可直接只读主checkout。其余broker/cache/loan/probe/core/UI/contract/package/lock/native/build保持冻结，不Git。不注册或运行生产扫描CLI，不读旧候选/用户数据，不写sidecar/scratch，不删材料。

## 实现目标

内部库提供有显式释放的只读会话：只接纳显式绝对本地固定盘路径，拒绝UNC/device/ADS/点段/尾空格点/模糊路径；从受限卷根句柄逐单组件NtCreateFile FILE_OPEN + RootDirectory + FILE_OPEN_REPARSE_POINT打开，不以路径前缀/realpath/resolve判断安全。每级核disk/目录或普通文件/reparse/完整volume+128bit file identity；整个父链持有到会话结束。权限最小只读，share仅FILE_SHARE_READ，不因拒绝放宽或重试。内部不导出创建、写入或删除操作。

对一份显式普通文件从同一handle按固定缓冲顺序SHA256，核开读前后identity、类型、属性、EOF长度及相关时间；短读/变化/超限拒绝，不返回原始字节。支持零字节、Unicode组件与有界较大fixture，计数溢出检查。关闭失败须固定码并明确未确认释放，不能写terminal released；库导入不打开目录/文件、不执行外部命令。内部固定错误不包含路径/源码/异常原文，公共DTO只有有限identity、计数、hash与状态。

probe接M3 start/ready/release/terminal协议：输入只本轮自有文件路径，ready之前持完整链/文件handles，ready有限DTO不含路径/内容；Node consumer期间仍持活；明确release才关闭全部handles后发terminal。EOF、非法控制、超时或异常finally有限释放；未确认关闭不伪造released。目标只是一份文件/父链，目录成员完整枚举、全scanner/签名/ASAR/输出写入另保留未验。

## 必需验证及限制

先核实际API官方primary资料和目标PS5.1布局。所有真实实验只自有临时fixture，Windows隐藏child，无GUI/网络/权限设置修改。使用已验M3端口运行实际PowerShell，覆盖同handle hash/identity/固定缓冲、父/叶junction拒绝、ready后改写/重命名/删除、既有writer与可写mapping、释放后重开及多个同会话失败后的句柄回收。不能创建file symlink时保留正确EPERM断言/环境限制，junction单列，不提升安全保证。

前后共享检查不能证明目录成员不变，现有可写mapping或目录创建若仍能改变必须如实记录，不能改断言或输出complete。与M3配合验证真实取消/deadline/释放terminal/close及句柄释放后文件可再开；不按进程名查杀，不递归清理，不运行导入代码。用可审查限定实验确认bridge不启动编译/后代进程，不把未观测称为禁止。测试harness缺陷与产品/环境缺陷分列。

只有源码审查、真实PS5.1端口回归、desktop适用类型及M3原回归通过后冻结hash交root。实现缺口应修到上述窄目标，确有API/系统阻碍给最小复现；不擅自换更宽共享、native或路径检查。本轮允许0条AGENTS规则，记录依据和未验门；真实artifact、完整目录快照、生产读取/材料保护/重开恢复、GUI、签名与干净机器全部不由本轮完成。
