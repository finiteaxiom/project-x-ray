# 第四批副本恢复格式预检

B0/S2 在任何 SQLite 副本打开前要求解析恢复依赖；main 当前只有升级保留测试，没有生产预检。以 M27 627 文件 raw/hash 为基线，仅新增 graph 内部纯字节观察器、对应测试、本计划及开发记录。无公共 index、原库/SQLite打开、HANDLE集成、启动接线、备份写入或恢复授权。

严格捕获四类有限 Buffer/null，拒绝 Proxy、访问器、共享内存、额外字段，累计 64 MiB 上限；返回材料 hash/存在性、有限格式观察与固定拒绝码。支持已知 main 头、完整校验的 WAL，以及有限正记录数的单/多段 rollback journal；未知、截断、混合 WAL/journal、额外恢复依赖失败关闭。所有非空 journal 的尾部 super-journal 标记先拒绝，不读取其名字或所指路径；旧/未知格式不能凭 SQLite 试打开来探测。SHM 保留 hash但不作为持久恢复权威。

依据 [SQLite 文件格式](https://www.sqlite.org/fileformat.html) 与已安装 better-sqlite3 13.0.3 自带 sqlite3.c 的 readSuperJournal/readJournalHdr/pager_cksum。真实自有 SQLite 数据库与 WAL/PERSIST 字节、checksum/salt/截断/多段/外部依赖/共享内存对抗回归；源自有字节不变。纯观察不证明捕获身份、schema/角色、业务数据完整或允许打开：caller-bytes-unverified，restore/production/SQLite open始终不授权，未来须与实际 raw 包/租约、已接受安全门和 profile 接线。
