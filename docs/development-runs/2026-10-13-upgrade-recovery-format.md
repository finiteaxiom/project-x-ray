# 第四批恢复格式预检实现与本地验证

M27 627 文件 raw/hash 基线；新增内部纯字节观察器、44 项测试、本计划与本记录，其他文件冻结。B0 要求 SQLite 副本打开前判断恢复依赖，源码原先没有该能力；本轮没有原库打开/写入、HANDLE source 集成、target writer、启动保护或备份恢复实现。

观察器严格捕获 main/wal/shm/journal Buffer/null；Proxy/accessor 零访问，typed-array intrinsic 私有复制不调用 caller iterator，共享内存拒绝，先核累计 64 MiB 再复制。检查 main 格式头、WAL 双字节序累积 checksum/salt/完整 frame、有限正记录数的单/多段 journal checksum/扇区 padding/重复页和 lock-byte 特殊页；未知、截断、混合模式与孤儿 SHM 拒绝。super-journal 尾部标记（含损坏长度）直接 INCOMPLETE_RECOVERY_SET，零路径解码/查找/读取。SHM 完整 hash 保留但不充当持久数据来源。格式观察不授权 SQLite open/restore/production，语义身份与 schema profile 仍 unchecked，来源仍 caller-bytes-unverified。

来源核查：[SQLite 文件格式](https://www.sqlite.org/fileformat.html) 与本机 better-sqlite3 13.0.3 自带 sqlite3.c，实际阅读 readSuperJournal/readJournalHdr/pager_cksum。官方页不含 super-journal 尾部布局，后者依据已安装原实现；不保存或提交第三方原源码。checksum 是格式检验，不是认证或完整数据校验。

首次 43 项 41 通过/2 失败。真实新建 WAL main 头仍是 schema/encoding=0，初始化页只在 WAL 的已提交 page-one 中：这是首稿预检错误拒绝合法自有 WAL 的产品缺陷。修正先检查完整 WAL checksum，只接受已提交 page-one 的合法初始化头；未提交 page-one 不能补齐 main。另一失败是测试翻转 count 高位实际触发 LIMIT_EXCEEDED，固定码预期错误；保留拒绝门并修正精确预期。补空 base/未提交 page-one 与孤儿 SHM 回归，最终 44/44，275ms；graph typecheck exit0，2.95 秒。

真实已安装 SQLite 生成 main、WAL/SHM、PERSIST journal；另在自有独立 operation 副本中确认 WAL 提交行可恢复、有限 journal 回放旧值。只用本测试创建的固定材料，原字节 hash 保持；测试副本由测试自身 SQLite 打开，不是生产观察器获得打开权限。夹具保留，不递归删除。手工 journal 与 checksum 大小端对抗材料明确为测试材料，不伪称完整生产捕获。无 GUI/API/Electron/候选代码运行。

命令：`pnpm exec vitest run packages/graph/src/upgrade-recovery-format.test.ts --exclude '.benchmarks/**' --maxWorkers=1 --no-file-parallelism`；`pnpm --filter @project-xray/graph typecheck`。

独立接受 false，本地实现/自测通过；无限/零记录计数、旧 journal 页大小 0、未知/破损/残留 WAL tail、加密/扩展与超过本切片限额的材料保持拒绝，不升级为支持。完整 raw 包 writer、checked close、重开、schema/角色/语义身份、恢复/生产启动仍未实现/未验，S1a 的正确 file-symlink 门仍不能由本纯模块替代。本轮再次用自有叶文件建立真正 file symlink，实际 EPERM，材料保留；没有改安全设置或用 junction 替代。四批未完成，无 Git 或第五批。AGENTS 新增 0：既有事实/授权分层和失败关闭规则已覆盖。
