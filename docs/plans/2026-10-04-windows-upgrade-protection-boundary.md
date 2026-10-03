# 4B-B0：Windows 升级保护文件边界

2026-10-04，开发-Sol。设计交付；没有实施生产保护，没有打开或复制数据库，没有执行 native、child 或 Electron 实验。依据本目录冻结的 [B0 派发计划](2026-10-04-upgrade-protection-boundary-plan.md)。4B-A 是已接受的自有夹具证据，本轮没有重跑；迁移清单沿用 [原升级设计](2026-10-04-windows-upgrade-preservation.md)，不以 migration marker 最大值代替兼容矩阵。

## 结论与边界

第一个可实施切片是 graph 包内部的 Windows **闭库原始文件保全端口**，不调用 SQLite。它在整组文件同时取得拒绝共享读/写/删除的实际 HANDLE 后复制原始字节，输出本机私有包及仍持有源句柄的租约。S1 唯一成功终态为 `raw-material`：只证明指定集合的保全，不认证项目语义身份，不批准恢复或生产打开，也不是逐库在线 backup 的共同事务快照。

闭库的可证明范围是：本应用所有数据库连接尚未创建；源集合每个已存在 main/sidecar 的普通文件读写删除访问均受到 Windows 共享检查；在同一持有区间内完成集合复核和保全。必须拒绝已有 SQLite 连接、普通读者、写者及删除访问占用，而不是等待并绕过占用。不枚举其他进程。只要求这组应用文件受控，不要求证明全系统没有 writer。

共享检查不等于对任意内存映射、驱动、卷级写入或恶意同用户进程的停写证明。LockFileEx 也不阻止映射写入。首切片把威胁范围写入 receipt 为 `ordinary-win32-handles`，不能命名为“全局已静止”；持续映射写入的自有反例必须实测，不能因双 hash 偶然一致扩大承诺。若验收要求覆盖关闭文件 HANDLE 后仍存活的可写映射，应另行评审文件系统级快照/映射约束；不是本轮加入权限扫描或修改安全设置的理由。目录 HANDLE 也不锁住所有子项的增删，集合变化须另设门禁。

## 已读实现与入口依赖

- [secure_reader.cc](../../packages/analyzer-core/native/secure_reader.cc) 中 CreateScope 与 OpenRelativeFile 保留实际 Windows HANDLE，但都允许 `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`；相对打开可借鉴，分享策略不能复用为停写证据。[secure-read.ts](../../packages/analyzer-core/src/secure-read.ts) 的 2,000,000 字节限制是源码读取契约，不用于数据库包，也不放宽它。
- [GraphStore](../../packages/graph/src/index.ts) 构造函数先 `new Database(path)`，再 busy timeout、WAL、base/remote/capsule migration。把 profile 校验加在 constructor 返回之后已经太迟；只加 readonly 构造也不能作为“原库未经 SQLite 打开”。
- [application](../../packages/application/src/index.ts) 先开 global，再扫描项目；项目失败会被局部处理；requireSnapshot、requireNavigation、storeForRepository 等还有懒打开。保护必须覆盖整组并统一路由所有后续打开，不能只保护首个 global。
- **主 checkout 实际入口**：`apps/desktop/src/main.ts` 的 `app.whenReady()` 直接 new AnalysisBroker，broker 建 worker，worker 创建 application；没有本 worktree 的 startup ownership、远程 policy 接线。后续门须置于实际 broker/worker 创建之前。
- **本 worktree 待集成入口**：main 中 startOwnedApplication 后先创建 ExplanationPolicy，再远程 broker、AnalysisBroker。若后续集成这些改动，保护门必须在 policy 的首个数据库打开之前。不能把待集成模块当作 main 当前前提，也不能用单实例锁代替文件占用检查。

## 内部端口与身份

拟新增 `packages/graph/src/windows-upgrade-preservation.ts`，仅供受信 desktop/application 内部调用，不新增 renderer 可输入任意路径的 IPC，不从 graph 公共 index 导出通用 backup API。拟议接口如下，当前没有实现：

```ts
captureClosedGroup(input: {
  operationId: string; // 内部随机 ID，单次操作唯一
  dataRoot: TrustedAppDataRoot; // main 获得的 app userData，不是导入项目根
  layoutVersion: 1;
  expected: Array<{ databaseId: string; // 本次布局成员 ID，不是已认证 repositoryId
    layoutSlot: "global-container" | "project-file";
    candidateStem?: string; relativeMain: string }>;
  limits: { maxFiles: number; maxBytes: bigint; deadlineMs: number };
}, control: { signal: AbortSignal; onProgress: ProgressSink }): Promise<{
  receipt: RawPackageReceipt;
  lease: ClosedGroupLease; // 不可序列化，不能持久化后复用
}>;
```

**第一层：原件零 SQLite 的候选/物理身份。** expected 由受信应用布局与句柄枚举生成：global-container 固定 `project-xray.sqlite`；project-file 为 `projects/<candidateStem>.sqlite`，candidateStem 只是安全文件名主干。主目录 loadProjectStores 当前只用 `endsWith(".sqlite")` 与 `slice(0,-7)`，索引新项目用 `stableId("repository", safeRoot.toLocaleLowerCase())`；不存在独立的、首开原库前可读的受信项目注册清单。S1 不声称沿用一个现有 repositoryId 校验器，也不从文件名认证项目身份，不为重算 stableId 扫描源项目路径。expected 只能约束允许的布局槽位、安全名字及完整物理集合；role 的语义判定留给第二层。

预期清单与实际数据库候选直接子项一致后才允许捕获。没有 root/global、孤儿 sidecar、未知数据库布局、projects 内额外目录或名称/物理别名一律拒绝；userData 的 Electron cache/preferences/logs 等非数据库内容不读不复制，既有升级包也不递归扫描，但 root 直接子项中额外数据库候选不能忽略。repositories/cache 不是 DB 成员。projects 缺失或为空、只有 global 的 legacy-only 布局可作为显式空项目集合保全；不能因此遗漏 global。全新空数据目录仍为单独 fresh-create 分支，不能伪装成成功旧库保护。

**第二层：只在 staging 判定语义身份。** 对副本读取内部 repositoryId/快照与角色相关结构，比较候选名字、布局和整组内部引用；这些只能证明一致或矛盾，库内自称与文件名互相吻合不产生外部信任。当前没有受信登记来源时，pre10/身份不明材料保持 `identity-unresolved` 并拒绝晋升；未来若另有经批准的受信登记，才在副本中交叉核验，不能虚构现有注册组件或读取原库取得它。legacy-only/global 中保存历史项目快照、源码或多个 repositoryId 是现有 legacyStore 的兼容情形，不能当作 project-file 或仅凭多 ID 判 ROLE_MISMATCH，也不能要求其 ID 等于 global 文件名。其已知结构和数据保留可在副本评估；无可信语义身份依据时仍不承诺自动生产晋升，不新增搬库、拆库或数据丢弃策略。

root、每个必要目录、每库 main 与 sidecar 都记录 `(VolumeSerialNumber, 128-bit FileId)`；size 用 64 位整数。禁止同物理 main 重复 databaseId/角色，禁止 main/sidecar 物理 ID 互别名。对大小写、短文件名、硬链接及尾点/尾空格拒绝歧义。简单文件名不得有 slash、冒号/ADS、NUL、`.`/`..`、设备名；不要只做字符串 startsWith。source identity 和 payload SHA-256 是两种字段；hash 不能代替身份或锁。

receipt 版本化记录 operationId、捕获序列、布局版本、root/成员物理身份、layoutSlot/candidateStem、全部四类文件的 present/absent、字节数、各 payload hash、manifest hash、保护范围与边界；固定 `status: "raw-material"`、`semanticIdentity: "unchecked"`、`recoveryDependencies: "unchecked"`、`restoreApproved: false`、`productionApproved: false`。不得把 layoutSlot 命名为已验证 role。完整路径和 payload 只留本机私有包；日志只含 operationId、阶段、数量、字节累计、固定错误码。无源码、表内容、异常原文、用户绝对路径。receipt 不进入分析图、SQLite 或 renderer storage；租约绑定 operationId/root/manifest，禁止复制 token 字符串获得权限。

固定失败码：`UNSUPPORTED_VOLUME`、`INVALID_LAYOUT`、`REPARSE_REJECTED`、`IDENTITY_CONFLICT`、`INCOMPLETE_RECOVERY_SET`、`SOURCE_BUSY`、`SOURCE_SET_CHANGED`、`SOURCE_CHANGED`、`LIMIT_EXCEEDED`、`DISK_SPACE`、`IO_FAILED`、`CANCELLED`、`DEADLINE`、`PACKAGE_INVALID`、`CLEANUP_FAILED`；下一验证层再增加 `UNKNOWN_PROFILE`、`FUTURE_PROFILE`、`ROLE_MISMATCH`、`IDENTITY_UNRESOLVED`、`RECOVERY_DEPENDENCY_UNRESOLVED`、`STAGING_FAILED`、`RESTORE_FAILED`、`OPEN_BOUNDARY_UNAVAILABLE`。错误只带经校验的成员相对名和固定文案，不转发 Windows/SQLite 原始消息。

## Windows 句柄取得与释放

首实现限定本机 NTFS 普通目录/文件；不支持 UNC、网络盘、reparse/cloud/offline 路径。该限制是第一保护实现的失败关闭条件，不删除现有兼容代码，也不扩大其他 OS 验收。卷信息须从持有卷/根句柄取得；磁盘余量查询是提示，不是空间预留保证。不提权、不启用 backup privilege、不改变现有 ACL。

1. 受信 userData 路径仅用于 bootstrap。取得实际卷根并保留，随后每一级目录用 `NtCreateFile` 的 `RootDirectory` 和**单组件名称**打开；不传多组件路径指望最后的 no-follow 标志保护中间联接。目录请求 `FILE_TRAVERSE | FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | SYNCHRONIZE`，`FILE_OPEN`，目录类型，非继承；共享读/写但不共享删除。实际属性/类型和 FileIdInfo 核验每级，遇 reparse、非本卷、打开失败即关闭已得资源并拒绝。目录 no-follow 的具体 CreateOptions 组合须按目标运行时实验确认，不能照抄文档中不兼容的 flag 组合；不可用则拒绝，绝不回退到普通路径 open。
2. 从这些目录句柄枚举 main 与 sidecars，再逐个相对打开。源文件请求 `FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE`，`FILE_OPEN`、非目录、同步 I/O、no-follow，**ShareAccess=0**。不创建缺失的 sidecar，不写入/checkpoint/删 journal。只把确定的“不存在”记为 absent；access denied/忙/读失败不得当 missing。
3. 按固定身份排序持有整组：某库成功而后一库忙，释放全部并失败。取得所有成员后重新枚举集合并按句柄核对实际名字、身份、大小；此时才进入复制。还可单独保留只请求属性、不共享删除的叶子 pin 作后续研究，但不把未实测的 pin 交接当本切片成功前提。
4. source HANDLE 从第 3 步直至包完成和 staging 判定结束保持持有。root/ancestor HANDLE 同期保持；final path 用于一致性诊断，绝不是授权边界。关闭必须待所有 native pending work 结束；GC 不能提前释放。async work 对每个 external 都持强 napi_ref，排队失败/取消/完成路径配对回收；显式 close 在 pending 时拒绝或延迟。直接由同一 native 层拥有 HANDLE，不借 Node fd 做 CRT `_get_osfhandle` 转换。

这些访问/分享组合依据官方 API，但目标 Node 与 Electron 的行为尚未实测。所需新原生层有明确理由：fs.copyFile/JS 路径检查无法把源和目标文件打开绑定到已持有根句柄，现有源码 reader 的分享模式和容量契约也不适用。首切片只新增 graph 专用 N-API target，不修改 analyzer reader，不新增 npm 运行依赖；构建工具优先复用现有 native 工具链，若缺少能力另列依赖理由后再审批范围。

## 整组原始包

四类成员为 main、`-wal`、`-shm`、`-journal`，全部记录存在性并逐字节保存，包括空文件。使用以下有限判定表，先检查失败行，再决定 raw-only；不能把“结构未知”和“恢复成员无法穷尽”混为一类：

| 原件零 SQLite 阶段观察 | S1 终态/marker | 后续门 |
| --- | --- | --- |
| main 与四类成员存在性可完整枚举并绑定，未观察到额外恢复依赖；schema/角色/版本尚未知，包括四类内部的未知组合 | `raw-material` receipt + `raw-material.complete`；语义与恢复依赖仍 unchecked | 仅完整字节材料；S2 须证明已知自包含恢复范围、profile与语义身份，任何未知均不得恢复/生产晋升。 |
| 已观察到 `-mj*` super-journal、非四类的未知恢复文件/布局，或明确需要集合外的 ATTACH/恢复成员 | `INCOMPLETE_RECOVERY_SET`；不发成功 receipt，不写任何 complete marker | 当前端口无法穷尽集合，拒绝整组；不得“先复制四类”冒充完整材料。 |
| 遗漏/孤儿 sidecar、读权限/占用使存在性不明、集合变化、别名或路径边界失败 | 对应固定失败；无成功 marker，已写内容只能是 partial 残留 | 不当 missing，不自动补齐/重试打开原库。 |
| S1 后，副本静态检查发现 journal 外部依赖、profile所需集合外成员，或无法判定必需恢复依赖 | 原有 marker 仍只证明 raw-material；另出 `RECOVERY_DEPENDENCY_UNRESOLVED`/`INCOMPLETE_RECOVERY_SET` 的验证拒绝记录 | 不生成 validated/restore 材料，不通过 SQLite 打开该副本去试探外部文件；原件和包保留。 |

“未观察到”不等于证明无外部依赖；S1 不解析原件 SQL/schema 来做语义认证。S2 在任何 SQLite 副本 open 前，对已复制的 SQLite/WAL/journal 固定格式做受限、带大小边界的恢复依赖预检；缺少已验证解析器或发现需要集合外文件即失败关闭。只处理经验证的支持组合，不扫描引用指向的用户文件，不执行文件内 SQL/ATTACH。判定对象是本次恢复所需依赖，不要求证明历史上从未使用过 ATTACH；普通文本数据中的该词也不能自动当依赖。

在持有根下创建独立 `upgrade-preservation/<operationId>/`：公共父目录不存在时相对 `FILE_CREATE`，存在时相对 `FILE_OPEN` 并核验真实目录/身份、持有不共享删除的句柄；竞争创建只允许重新核验后打开该父目录。operationId 目录与每个新文件只能 `FILE_CREATE`（已有即失败），拒绝 reparse/身份别名；不覆盖历史包。目标创建请求读/写/属性，ShareAccess=0；manifest、payload 与最后 marker 均如此。新目录继承本机 app data 的正常权限，不把“私有”解释成对同用户恶意进程不可读，也不更改系统安全设置。payload 包含私人源码与数据，只本机，禁止提交/外发。

复制前按 source size 计算总预算（溢出拒绝）。初始默认建议：10,000 成员、总原始字节 20 GiB、单操作 15 分钟、128 KiB I/O chunk；它们是拟议产品限额，不是已测性能。原包所需空间至少 B，staging/restore 最坏同时再需 2B，加 10%/256 MiB 中较大余量和显式 staging 膨胀上限；若缺空间提前拒绝。余量检查后仍可能耗尽，所有 write/flush/close 错误失败关闭，不能依靠预检。

native 只读持有的 source HANDLE、写持有的 target HANDLE；不重新按绝对路径打开。最多单个 chunk 在途，Node crypto 增量 SHA-256，无整库 Buffer。传递 chunk 仅内部可信任务，禁止 IPC 广播。复制后核对 source identity/size，二次 hash、集合及 absent 状态；目标重读 hash 校验。双读用来发现变化/读写错误，不能证明任意映射 writer 不存在。新增、遗漏、替换、别名、额外 DB、sidecar 出现/消失任何变化均拒绝整组。

阶段为 discover→acquire→copy→verify→commit-package→staging；有界计数/累计字节，不声称未知总工作百分比。可取消发现循环、文件之间、每 chunk 边界与 manifest 前；锁请求 fail immediately。单次同步 OS I/O 不能承诺 deadline 强制中断，取消是请求、等 pending 完成后才终态；不提前释放或返回“已取消”仍继续写。进度节流且不得倒退；取消 commit 后保留完整包但不启动 staging/open，不发生产成功。

所有 payload flush 成功、重读完整一致后写规范 manifest 并 flush，最后创建包含 manifest hash/版本及 `status: "raw-material"` 的 `raw-material.complete` marker 并 flush。无 marker 或重新核验失败一律不是完成的 raw-material；marker 不表示可恢复/可升级，也不因后续验证失败而改写成别的成功状态。S2 验证材料是独立报告，绑定这个 hash，不能覆盖 marker。FlushFileBuffers 不是任意硬件断电下的目录原子提交承诺；重启必须重新验证 marker+manifest+全部 payload，不能仅看文件存在。成功材料包不可由 migration/restore 打开写入，内部 API 不提供覆盖/修改功能。partial 的清理仅按本次持有目录/身份删除本次新建文件，不对字符串目录递归删除；失败保留隔离残留及 cleanup 状态，原固定失败不被清理错误掩盖，retry 使用新 ID。不扫描/清理其他包。

## 包完成后的隔离验证

原件仍由 closed lease 持有；先创建全组操作副本 staging，另留独立 restore 副本。只有上述 SQLite-open 前恢复依赖预检通过，操作副本才可以由 SQLite 打开恢复 WAL/journal、创建 SHM；禁用 ATTACH/扩展不能替代这项 open 前检查。原始包绝不可通过 SQLite readonly 打开，它也可能受恢复/辅助文件行为影响。副本仅位于自建隔离目录，身份与原源/包均不同；显式禁用 ATTACH 外部文件和扩展加载，不执行 payload 中 SQL 文本、脚本或应用导入项目代码。

profile 用最底层 SQLite connection 打开副本，**不调用自动迁移 GraphStore**，先读取 schema、列/约束/index、全部版本记录、user_version/application_id 等作为联合特征。识别器维护经夹具验证的已知结构组合与可选旧字段；零标记、混合结构、重复/未知记录不自动补成当前。未来版本/未知结构先拒绝，随后按第二层身份规则检查角色；candidateStem 仅用于一致性核对，pre10/身份不明且无可信登记来源时报 `IDENTITY_UNRESOLVED`，不能仅凭互相吻合晋升。global-container 的历史项目数据保持原位置和引用，不能强制单 repositoryId 或自动转移到 projects。profile 不把旧 marker 数组当白名单。

通过后在 staging 尝试当前原有 migration，检查每库已完成/失败状态与整组成功门。将迁移前逻辑数据清单与迁移后逐项核对：历史快照/源码/证据、current 选择、ownership attempts/capsules、remote completed 结果及任务身份等，精确 payload 比较只在隔离验证内部做，不写日志；允许变化必须逐项列为已知结构转换，不能只看行数。remote 启动恢复与补 overview 属于另一阶段，禁止混入迁移试验误改 completed 历史。任何库失败，整组不晋升；已迁移 staging 可丢弃，包与原件保留。

再从不可变包独立创建 restore 副本并打开，检查恢复后逻辑数据与迁移前 baseline 一致及完整性可读；原样 sidecar 的 byte hash 与逻辑恢复检查分开。不得只做 main-only、不得对原件自动还原覆盖。验证通过的材料包含 raw manifest hash、识别器/迁移版本、角色、逻辑 baseline 摘要、restore 结果及仍活着的 lease；persistent 报告不包含 raw rows。进程重开必须重核包、重新取得源集合 lease并匹配当前源，不能沿用旧成功 token；合法 retry 留旧包、建新副本/新 operationId。

## 正式原库打开：当前单一前置阻碍

`better-sqlite3` 当前入口接收 filename，没有已实现的受限根句柄/已有 HANDLE 接口。释放 exclusive source HANDLE 再 `new Database(path)` 存在新 writer、根/叶子替换及 sidecar 打开窗口；持着源的 exclusive HANDLE 则 SQLite 自己也打不开。即使 metadata pin 能固定原件名字，也没有自动约束新 sidecar 的创建/删除/重解析。**本方案不把 raw receipt 或路径字符串升级成原库打开 capability。**

S1/S2 可独立推进；生产接线的单一前置能力是 **SQLite 首次及后续文件 I/O 使用同一受限 Windows 根/成员能力的交接**。候选最小修正是 graph 的 Windows 专用 VFS 适配边界，接入实际 better-sqlite3 所使用的同一 SQLite 实例：xOpen/xAccess/xDelete/xFullPathname 与 WAL SHM 路径必须受根/角色/成员约束，临时文件限定隔离域；SQLite 锁、同步、WAL/mmap 行为保持真实语义，禁止注册到另一套 SQLite DLL 后假称有效。它仍是待验证提案，不在 S1 授权内，不新增公共数据库框架。

交接候选：保留 ancestor/root 与叶子身份 pin，绑定 VFS 上下文及单次 operationId；取得互斥的本应用开库门，按许可角色消费 capability；在原源独占保护释放前确认交接可用。释放与 SQLite 独占锁取得之间的竞争不能伪称原子：随后在首次迁移前取得整组 SQLite 写锁、核验源身份/完整成员集合和副本 baseline，任一 busy/变化关闭整组并重新捕获；首次 open 已可能恢复 WAL/journal，因此只能在完整原包+staging/restore 通过之后执行。拒绝的恢复变化由已有原包保全，不自动覆盖原件。应用还必须将 GraphStore 的 WAL/migrate/补overview/remote 恢复全部延迟到组门通过，不能在校验前 constructor 写库。外部不遵守 SQLite 锁的裸写者不在该生产锁协议承诺内。

VFS 各 callback、身份 pin/共享组合及“before migration 首次恢复”行为都须自有实验；若同一 SQLite 接入无法做到，则生产 open 仍返回 `OPEN_BOUNDARY_UNAVAILABLE`，提交单独最小替代方案给审查方，不以纯路径校验降级。不要现在重构全部 graph，或因该后续阻碍停止无 SQLite 的 S1。

## 后续最小切片与验收

以下文件与命令是**建议下一批授权清单，未创建、未执行**。主目录与本 worktree 的旧未集成源必须在派发时逐文件核对，不整体同步。

| 切片 | 最小文件边界 | 自有正反例与独立门 |
| --- | --- | --- |
| S1 原始包 | 新增 graph/native/windows_upgrade.cc、graph/native/binding.gyp、graph/scripts/build-windows-upgrade.cjs、graph/src/windows-upgrade-preservation.ts 及同名 test；仅 graph/package.json 加内部构建/测试入口 | 自建 NTFS 临时根：三库完整 WAL/SHM/journal、大于2MB、空 sidecar、拒绝已有读/写/删除句柄与真实 SQLite 活连接；取得/复制间 root/目录联接替换、硬链接双角色、sidecar新增/遗漏、集合变化、已有目标、容量/磁盘写失败；取消、异常退出 marker 切点、GC/pending close、源与目标外部内容未读取/未写；持续可写映射反例报告范围。Node 与实际 Electron 均验 HANDLE/分享，不用历史测试代替。 |
| S2 副本验证 | 新增 graph/src/upgrade-profile.ts/.test.ts、upgrade-staging.ts/.test.ts；只有这里经审批暴露无自动迁移的内部 connection 工厂，迁移逻辑保持对应冻结基线 | 已知旧结构/未来/未知混合/角色错配/pre10证据不足、迁移中途失败、完整WAL恢复/main-only负例、completed历史/current/旧源码逐项一致；staging/restore写失败不碰原件/包；重开篡改 marker/hash 拒绝，retry新ID；包payload hash前后一致。 |
| S3 打开边界与接线 | 先批准同实例 VFS/身份交接最小实现和 graph打开门，再改 application统一store factory、desktop main/broker/worker；只有实际集成了policy才将它纳入该批 | SQLite首开/SHM/临时文件/懒打开均走能力；竞争writer、root/sidecar替换、能力错角色/过期/跨operation、项目失败全组不迁移；启动旧数据完成后再恢复inflight、completed不变；真实Electron关闭→升级保护→启动→项目切换/懒打开→重启，失败有固定报告与安全重试。 |

S1 下一批拟议命令：`pnpm --filter @project-xray/graph build:windows-upgrade-native`（新增脚本后）；`pnpm --filter @project-xray/graph exec vitest run src/windows-upgrade-preservation.test.ts --reporter=verbose`；`pnpm --filter @project-xray/graph typecheck`；实际 Electron native 自检通过拟新增 desktop 自检入口执行，命令名和入口先随实现评审，不能拿 Node 测试冒充 Electron 验证。S2 targeted vitest 针对上述两测试文件并补 graph/application 适用回归与 typecheck。S3 由协调审查方独立操作真实 Electron；本轮不执行 `pnpm build`、全测试或数据库 fixture。

## API 依据与未验证项

官方资料核查于本轮：

- [NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)：目录 HANDLE 相对名称、访问/分享及 create disposition。RootDirectory 必须是真正持有的句柄，不能是路径变量。
- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)：分享检查、属性访问与读写访问的区别、no-follow 与目录打开标志。目录 pin 不阻止所有子项变化。
- [FILE_ID_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_info)：volume serial 与 128-bit ID 联合比较文件身份。
- [LockFileEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-lockfileex)：普通字节锁不阻止 mapped view 写入。
- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 与 [GetDiskFreeSpaceExW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespaceexw)：flush/可用空间查询；不承诺硬件断电原子性或保留空间。
- [SQLite WAL](https://www.sqlite.org/wal.html) 与 [原子提交/VFS](https://www.sqlite.org/atomiccommit.html)：WAL/SHM、恢复和文件系统适配背景；不是本项目已具备句柄 VFS 的证据。

源码读查已验证现有入口和共享模式。其余 root 全链 pin、no-follow 标志组合、映射/分享边界、侧文件集合竞态、目标 marker 中断恢复、实际 Electron addon ABI、同 SQLite VFS 接入及交接全部**未做运行验证**。第一切片不自动继承生产/GUI/签名/干净机器/发布验收。AGENTS 本轮新增 0：这是 API 与设计推断，尚无新的复现实验支持工程经验。
