# 4B-M9 私有 sidecar 文件能力

此为原第四批剩余 reader 本地实现。源码依据：原 reader 计划52–62行要求私有scratch/sidecar；M8只允许目录FILE_CREATE，没有普通文件写入，M4只读端口不得扩为写入。先交付真实可运行的32 MiB以内sidecar字节写入/同HANDLE读回能力；不是仅准备接口，不声称完整manifest、ASAR复制或解析已完成。M8已独立接受并精确集成，已验门不重复。

## 文件与责任

work tree 2，原ID/5170，gpt-6-luna/max。核实际432完整raw/hash与M8独立源像、相关M4/M8主目录依赖字节一致后实施。只五新：

- apps/desktop/scripts/windows-artifact-output-file.ps1
- apps/desktop/scripts/test-fixtures/windows-artifact-output-file-probe.ps1
- apps/desktop/src/windows-artifact-output-file.test.ts
- apps/desktop/src/windows-artifact-output-file-handle.test.ts
- docs/development-runs/2026-10-12-artifact-private-output-file.md

原432全部冻结，包括M8/module/fixture/tests、M4只读桥接、原reader/协议、PE/结构、native/UI/DB/core、AGENTS、公共记录、package/lock。主目录记录仅root更新。不依赖新增compiler/addon/包、无持久二进制；import只定义函数。真实侧门不能放进纯测试绕过验证门。

## 行为与证据

输入为真实仍ready且注册的M8私有目录session及本次有界byte[]，上限32 MiB含空文件。仅固定意义的sidecar端口，捕获私有字节后再执行native；拒绝任意流/回调/路径/handle、不从环境或cwd寻找材料。文件名由模块生成有限opaque token，单组件；fixture可用明确固定测试名验证已有目标拒绝，生产不能提供任意disposition/access/share或系统路径端口。

借用M8目录：核注册owner、ready/未释放、created HANDLE及完整volume/128bitID/普通目录no-reparse与原createdIdentity相符；不把自报摘要、路径前缀或caller字段自洽当真实所有权。创建与发布前后重新核实际目录身份及ready状态；输入M8借用HANDLE不归文件模块关闭。模块只登记自己成功创建的普通文件HANDLE，完整身份/长度/状态；不能关闭任意caller HANDLE。内部调用者必须持有目录直到所有文件消费者结束，本切片不证明跨线程/进程同步。

独立内存P/Invoke API固定相对RootDirectory NtCreateFile/FILE_CREATE/普通非目录/no-follow/同步语义、share仅read，核IO_STATUS_BLOCK FILE_CREATED。已有file/dir/junction绝不打开/覆盖/改ACL。创建时显式protected DACL仅捕获当前用户与SYSTEM，SYSTEM去重；普通文件ACE标记按明确文件权限规范化，不直接沿用M8目录OICI断言。实际文件HANDLE读回owner、保护与完整准确ACE集合；缺失/额外/NULL/未知ACL拒绝。不改已有ACL/系统策略，不外推抵御同用户或管理员。

最多1 MiB固定块同步WriteFile，每次核成功及实际bytesWritten等于请求；零/短写/超界/异常/累计溢出拒绝，不把部分写入发布。完成后同文件HANDLE以固定安全SetFilePointerEx回到0，顺序ReadFile计数/增量SHA-256，核真实EOF及写前后完整身份/长度/相关元数据（写入时间可能在写HANDLE关闭前尚未更新，不能声称持久化或稳定来源）。读回长度/hash须与私有捕获输入独立计算一致；安全EOF、空文件、限额与错误缓存须有回归。无path-based读写/reopen替代、无候选包执行、无全文件读回Buffer。若复用M4只读函数，只允许已固定的读取/元数据端口，不修改M4。

返回固定状态/有界计数、opaque token、身份证明摘要及内容hash；不输出绝对路径/SID/原字节/原始异常。仍incomplete/not-evaluated，hash只是本次字节读回，不证明source/build、签名、报告语义或完整sidecar协议。失败保留本次created身份和owner账本；ready必须撤销、固定错误。释放只按自身登记HANDLE，实际CloseHandle成功才移除；失败不报告released，不清借用目录，未知对象零删除。不提供DeleteFile/递归清理/一般文件写入后门/公开CLI。断电持久性、父进程安全重开、真实sidecar JSON/schema及ASAR安全复制均不在本切片接受范围。

## 验证和交付

开发只能串行有界纯回归、desktop noEmit、PS5.1 AST/纯descriptor解析（不得初始化native或打开HANDLE）。严禁执行HANDLE suite/fixture/reader/native/build/dist/Electron，不能代root进入技术窗口。交付后冻结437完整raw/hash、五新精确差异、原432保持；开发自测不等独立接受，无Git/清理/共同规则修改，经验允许0。

root冻结后唯一Windows窗口验证：非空/Unicode token/空内容真实创建、ACL回读、同HANDLE读回计数hash、持有防rename/delete并释放；已有未知file/dir/link字节/ID/ACL保持；无效/已关闭/伪造owner或身份/重解析借用拒绝；原借用M8状态/句柄保持；超过32 MiB与边界；WriteFile失败/短写、read失败/EOF差异/identity错配、额外/NULL ACL、CloseHandle失败均到达明确故障marker并失败关闭，不把提前错误当通过。仅自有fixture且材料保留、不执行输入代码。M8原门在接线风险需要时再跑，不反复全部历史门。

## API依据及未验门

[WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile)提供同步实际写入字节数，文档指出写时间在写HANDLE关闭前可能未更新；[NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)提供相对HANDLE排他创建。契约不证明PS5.1布局/目标运行时已通过。ASAR scratch来源复制/解析、父进程sidecar安全重开/完整manifest、签名协议冲突、安装运行/GUI/API/干净Windows继续未验。只四批，收尾停止门不变，不第五批。
