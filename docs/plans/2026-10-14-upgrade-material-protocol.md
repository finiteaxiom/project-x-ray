# 数据保护链优先：原始材料 manifest/marker 与重开前校验

用户优先要求数据保护链与真正 file-symlink EPERM。本轮635完整源像冻结，四员工待命。原生 flags0/2实际均1314，正确断言不删/不skip、不变更安全设置；整套S1a不得凭此升为通过。权限处理已请求用户手动准备环境。

不空等权限：S1b设计要求的raw manifest、最后marker与重开严格字节校验当前没有实现，本切片仅新增graph内部protocol、test、本计划及记录四文件，不接公共index/SQLite/原生源/启动/IPC。规范字节固定版本/键序，严格捕获无getter/Proxy，保持既有source最多10k present/40k四类存在性向量、16MiB manifest/4KiB marker上限；四类完整集合、source/target全ID/同卷、唯一ordinal映射、root/目录/文件别名拒绝、安全相对名、预算以及marker精确绑定逐项校验。

同模块接入S2副本预检：选择声明的main，逐一匹配其present payload固定ordinal/完整byte count/SHA后才交M28恢复格式观察器；缺失/重复/foreign/篡改拒绝，64MiB有限副本预算继承，不扩权、不开文件/SQLite。source projects目录presence/identity必须显式声明，空文件必须精确empty digest。真正文件来源、目录向量与HANDLE门仍由后续物理writer/reopen承担。

输入身份/hash仍是声明，JSON不能铸造source loan或文件权限。校验成功只为documents-consistent，rawPackageOpened=false、producerAuthentication not-established、SQLite open/restore/production false，语义/恢复依赖unchecked；未来writer和只读重开器必须以实际HANDLE/完整向量/两遍source与target回读补齐，不能直接接入生产成功门。

确定性gold与篡改、缺成员/孤儿sidecar、错卷/alias/ordinal、超限、坏UTF8/重复键/未来版本/未知字段/改flags、访问器/Proxy/共享内存，以及真实自有SQLite字节hash和M28预检配对回归。零源码/凭据日志、未知材料不递归删除，无依赖安装或候选执行。此模块不是完整备份writer/恢复/独立接受；四批范围保持。
