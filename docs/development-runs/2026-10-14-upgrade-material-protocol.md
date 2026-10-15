# 数据保护链优先：EPERM 原生诊断与材料校验实现

用户最新要求优先完成数据保护链和 file-symlink EPERM。当前 main/HEAD455dfd3、635完整当前raw/hash冻结；旧M30全635 raw保持，仅五份已有自有记录追加，其他630当前字节不变。四员工实际wait timeout0均completed/unchanged，沿用保存cursor、冻结不派发。只在main新增本计划/记录及graph protocol/test四文件，未复制未接受S1a到main、未触碰原库或其他WIP。

## file symlink 真实原因与必要用户处理

使用Windows原生CreateSymbolicLinkW（Python内置ctypes、正确BOOLEAN/Unicode/last-error绑定）创建自有固定普通叶文件链接，flags0和ALLOW_UNPRIVILEGED_CREATE=2分别返回false/Win32 1314。只读取诊断进程自身SeCreateSymbolicLinkPrivilege的启用状态，实际false，OS token句柄确定关闭，不输出token/凭据。只查询公开developer-mode单一配置值，结果unavailable，不能写成已确认关闭。原自有target字节不变、临时材料保留，未提权、改ACL/注册表/全局安全设置或操作GUI。

与Node fs.symlink的EPERM合起来，原生API反例排除“只补Node调用flag即可解决”的假设。依据[Microsoft CreateSymbolicLinkW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createsymboliclinkw)，非提升创建flag依赖开发者模式；已知设计限制“不提权、不改变ACL/安全设置”。已通过文本异步问题请求用户手动准备开发者模式或有权限的验收环境，尚未收到完成确认，不能把问题默认选项或经过时间当授权/已开启。正确leaf symlink断言保持，不用junction/替身/skip替代，S1a整体门未通过，依赖它的物理source集成仍不晋升。

原生诊断收据仅固定布尔量/Win32 code：.benchmarks/desktop-main-integration/file-symlink-native-diagnostic.json。没有原始源码、token、凭据或私人路径入Git。

## 已实现的保护链构件

原设计要求但源码缺失的内部raw manifest/marker编码和重开前文档验证已实现：严格私有捕获、规范UTF8/固定version/key顺序、重复/未知/hidden字段拒绝、四类present/absent完整集合、同卷完整ID与root/目录/member别名拒绝、source projects目录存在性、精确ordinal与字节/hash、零字节空hash、16MiB manifest/4KiB marker上限。文档不铸造source loan、HANDLE、producer认证或成功包receipt。

同模块已接M28：所选main的present payload逐一核精确目标名、byte count/实际SHA，再做64MiB有限恢复格式预检；missing/duplicate/foreign/篡改拒绝、empty sidecar保持。真实自有内存SQLite序列化字节经过文档绑定与预检，原hash不变；测试身份是明确声明的gold元数据，不伪称物理HANDLE来源。成功仍caller-bytes-unverified/documents-consistent、rawPackageOpened=false、producerAuthentication not-established、SQLite open/restore/production false。

## 失败诊断、修正与实际验证

- 初稿两文件85/85通过；补零字节hash与副本入口后96项通过，类型TS2345失败：byteSize返回数字未给TypeScript收窄unknown。复制前已运行时严格确认Buffer，补相应类型断言后类型通过，未放宽运行时校验。
- 核冻结实际S1a source metadata契约，发现原source允许10k present与40k存在性向量，而首稿将present+absent一律限制10k，误拒合法大集合。新增3000 main/9000 absent（均声明gold）的原回归修前确实失败，保持源读取/成员限额，校正presence上限为原4×向量；既有manifest字节预算不变，不默加source读取预算。修后完整两文件97/97、554ms；graph typecheck exit0、2.88秒。
- marker滞后/错绑定、重算marker但坏manifest flags、duplicate JSON/noncanonical/future/UTF8、alias/跨卷/路径/device/孤儿/缺成员、超预算、getter/Proxy/SharedArrayBuffer、错payload/0字节/unknown recovery等回归通过。全重算后的自洽篡改明确仍只给producer-unverified，不伪造认证或恢复许可。

命令：`pnpm exec vitest run packages/graph/src/upgrade-material-protocol.test.ts packages/graph/src/upgrade-recovery-format.test.ts --exclude '.benchmarks/**' --maxWorkers=1 --no-file-parallelism`；`pnpm --filter @project-xray/graph typecheck`。只Node/自有SQLite内存，零导入项目执行/原库/SQLite文件打开、GUI/API/原生编译/未知递归删除。

已实现/本线程本地验证，独立接受false。完整物理raw writer、checked close、HANDLE重开、schema/角色/身份验证、恢复和生产打开边界仍未完成；不拿本文档/纯验证器替代整链。不Git或第五批。AGENTS新增0，现有完整性/授权/严格捕获/安全失败规则已覆盖。


## 用户环境答复

用户对本轮权限环境问题明确答复：“暂不调整，保留该安全验收门未通过”。替代此前pending状态；不继续等待或自动重试无变化环境，不提权、不改变ACL/开发者模式/安全设置。真正file symlink gatePassed=false，S1a整体及source/loan主目录集成仍未批准。M31本地实现与97项自测不变；没有新增代码、测试、Git或安全设置操作。数据保护链其他未完成范围保持原清单，答复不等于四批完成或降低安全门。
