# 4B-M8 私有输出目录 HANDLE 能力

本切片属于原第四批 Windows 发布 reader，不是第五批。M7有界树观测已独立接受并主目录集成；完整reader仍缺安全输出目录。依据实际M4桥接仅允许FILE_OPEN、禁止create/write fallback，以及M2/manifest计划对ASAR副本和sidecar要求，先实现可验证的排他私有目录端口。不是重做M3–M7、纯PE/结构模块或生成准备文档。

## 工作树与边界

责任work tree 2，同threadId 01a0f53c-353f-70e3-98c3-96ed65c085d6、5170、gpt-6-luna/max。当前427完整正式文件raw/hash与M7独立冻结源像一致，相关M4/M5/M6/M7已验模块须与主目录逐字节对齐后实施。只准五新：

- apps/desktop/scripts/windows-artifact-output-directory.ps1
- apps/desktop/scripts/test-fixtures/windows-artifact-output-directory-probe.ps1
- apps/desktop/src/windows-artifact-output-directory.test.ts
- apps/desktop/src/windows-artifact-output-directory-handle.test.ts
- docs/development-runs/2026-10-12-artifact-private-output-directory.md

原427全部冻结，含M3协议/端口、M4只读桥接及native入口、M5–M7模块/fixture/tests、PE/structure/manifest、原生addon、package/lock、UI/DB/core、AGENTS和共同记录。不增加依赖、编译器、addon或持久二进制；新模块import只定义函数，PS5.1 x64内存P/Invoke绑定懒初始化并与原只读API类型/端口隔离。不覆盖或扩展原Invoke-XRayNative，不以通用可选disposition/access/share端口暴露写能力。

## 实际行为与安全门

输入显式绝对本地盘符out-dir，目标必须不存在。父目录沿已验只读M4逐组件no-follow walker打开持有；禁止cwd/env候选、字符串前缀/realpath替代身份、设备/UNC/ADS/点组件/重解析/错类型等降级。新basename仅单组件相对持有parent HANDLE，以NtCreateFile FILE_CREATE/目录语义排他创建，明确核IO_STATUS_BLOCK.Information=FILE_CREATED；已有普通目录/文件/link不得打开、覆盖或修权限，失败关闭。M4只读父HANDLE不能作为创建必被拒绝的权限假定。

创建时传明确protected DACL，仅捕获的当前Windows用户SID与SYSTEM；不读取凭据、调整系统策略/用户权限或既有目录ACL。SID只用于本次ACL不出日志/DTO。创建后从该实际HANDLE读取安全描述符，核owner、DACL_PRESENT/PROTECTED、完整有界ACE集合、SID/允许权限与继承标记；不能以调用成功、路径Get-Acl或建前SD字符串替代真实回读。未知/额外/缺失ACE、NULL DACL、无保护、回读失败均拒绝。若当前SID=SYSTEM，按精确唯一SID规范化，不制造重复ACE。在创建瞬间施加权限，不先宽权限创建再收紧。不声明防同用户/管理员改ACL或进程被接管。

既有两个输入root由实际仍持有的已验session借用。核实际HANDLE/完整volume+128bit ID/类型及链结构，输出parent完整链内出现app输入目录root ID即拒绝；portable文件与app目录根分开处理，不把共同盘符祖先当重叠。不能依据caller路径/自报identity进行根外证明。输入借用HANDLE不归本模块关闭；输出owner只负责自身parent链和本次新目录，所有真实成功open立即登记，失败也保留账本和created identity，释放失败不能伪造released。新目录持有期间原share约束保护改名/删除，真实目标runtime验证而非从mask外推。

本切片不提供WriteFile、ASAR复制、sidecar、签名或删除能力；没有任意读写后门或递归清理。释放仅关闭自己明确登记的HANDLE，失败材料保留；测试仅创建本次自有fixture，未知对象不删除。输出只固定状态/有限计数/opaque identity证明摘要（不含绝对路径、SID、源码）；仍incomplete/not-evaluated。创建目录不代表ASAR安全副本、parent重开或完整reader接受。

## 验证与冻结

开发串行纯定向单worker、desktop noEmit、PS AST解析，不执行Windows/HANDLE/reader子进程/build/native/dist/Electron。新Windows测试由root冻结后单协调窗口运行：正常自有目录真实exclusive-create/ACL实际回读/owner持有/释放后可重开；已有目标含未知普通文件其字节/ID/ACL保持；existing文件/目录/junction、父链reparse、路径非法、输入root内重叠及错身份拒绝；API失败/额外ACE/null-DACL/close失败固定拒绝、零ready和实际释放证据。故障注入只fixture适配器，有真实到达标记；不能把提前失败当成功验证。原M3/M4适用门独立回归，其余已验门按集成风险选择，不反复全跑。

保持427 before/after完整raw/hash，五新精确patch、其他427不变、HEAD/branch不变。自有记录写实际失败/根因/修复/命令/未执行门，AGENTS本轮0，Git由root协调。未证明ACL/native布局/重叠/真实释放时给窄复现，不自行扩范围、改安全设置或使用path fallback。全部四批仅余外部门时暂停自动与派发；员工工作树保留、不第五批。

## 依据

[NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)定义RootDirectory相对名、FILE_CREATE、创建时SecurityDescriptor及IO_STATUS_BLOCK结果；[GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)提供实际HANDLE安全描述符回读。官方契约不证明目标PS5.1发射布局/权限/释放已通过。原M2计划、原manifest计划和M7独立收据仍适用，签名接口及其他未验边界保持。
