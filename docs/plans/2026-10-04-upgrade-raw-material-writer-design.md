# 4B-S1b：Windows 原始材料 writer 设计

2026-10-04，开发-Sol。依据 [派发计划](2026-10-04-upgrade-raw-material-design-plan.md)，SHA-256 `E45480A1664DDA74188EDFA2EF526DEDC4124FFEDB9C0F05672AEA7B021E7389`。只新增本设计和对应过程记录；没有实现、原件/副本操作或平台实验。既有 [B0](2026-10-04-windows-upgrade-protection-boundary.md) 不改写。S1a 整体尚未接受，真实 file symlink 因 EPERM 未验的门仍在；新设计不补门、不批准生产运行。

## 当前真实缺口与首切片

当前 [source adapter](../../packages/graph/src/windows-upgrade-files.ts) 只有 acquire/read/verify/cancel/close，source metadata 的 rawPackageCreated/restoreApproved/productionApproved 全为 false。[native](../../packages/graph/native/windows_upgrade.cc) 只持有源 HANDLE，没有 target create/write/flush/readback、manifest、marker 或重开材料入口。source 根 HANDLE 没有申请目录写权限，private WeakMap/external 也没有借给另一个模块的接口；不能从 metadata.relativePath/rootIdentity/operationId 推导出写 capability。

首 writer 应为 graph 内部编排，新增受限 source 借用与同一 native 层的 target 操作。写入位置只允许所借 source 的实际 data root 下 `upgrade-preservation/op-<operationId>/`，不收任意目标路径，不导出通用 backup 框架、不接 IPC/GraphStore/启动。FILE_CREATE 的创建成功和仍持有的实际 HANDLE 才建立当前操作归属；nonce、UUID、hash 是关联材料，不能认证一个现有目录属于本操作。

## 拟议私有接口（均未实现）

```ts
// 只由 windows-upgrade-files 内部 WeakMap 验证并借出，不可由 metadata 重建。
borrowClosedSource(source: UpgradeFileLease): Promise<SourceWriterLoan>;
// loan 不可序列化，只能消费一次；内部已固定 root、operation、成员与截止时间。
writeRawMaterial(loan: SourceWriterLoan, control?: SafeControl): Promise<{
  receipt: RawMaterialReceipt;
  material: ReadonlyMaterialLease;
}>;
// 单独可信 bootstrap 的只读根能力；不会为了验证材料打开原 SQLite。
reopenRawMaterial(scope: TrustedMaterialReadScope, operationId: string,
  expected?: LiveMaterialReceipt): Promise<ReadonlyMaterialLease>;
```

这些名字是下一批候选契约，不是当前可调用 API。输入必须在反射前拒绝 Proxy、拒绝 getter/隐藏/未知字段并捕获 plain data。沿用 S1a 对 signal 的严格支持形态、捕获 intrinsic 与 close 优先，不引入动态 signal 方法清理；progress 异常仍为固定错误。

loan 验证真实 wrapper/native type tag，源处于 ready、未 pending、未释放、未被借用，且 operation/root/实际成员一致；不接受 caller 传入成员数组或路径来扩权。借用后 public source read/verify/close 拒绝占用，cancel 只请求共享取消标志。native borrow count 与强 napi_ref 保活整个 source，直到 target 最后 pending I/O 结束、target 关闭或被明确转交只读 material lease后才解除借用；不能在某个 chunk 间隙关闭 source。实现内部应复用同 HANDLE 读取/复核逻辑，不能从 JS 字符串重新打开源，不做 fd/CRT 桥接。

writer 串行执行：最多一个 native I/O 和一个128KiB数据 chunk在途；借用者负责最终 close source，失败也必须等待 work drain后关闭。借用期间 owner/source wrapper GC 不能释放其资源。成功只有原始材料 receipt，不返回生产开库 token。ReadonlyMaterialLease 独立保留目标根/目录/文件 read HANDLE；只读转交必须明示，所有句柄未安全转交/关闭时不得宣布“资源已释放”。

RawMaterialReceipt最小字段：formatVersion=1、status=raw-material、scope=ordinary-win32-handles、operationId、捕获的source根ID、target parent/operation目录ID、manifest实际ID/长度/SHA-256、marker实际ID/长度、source-target逐成员映射及absent清单；semanticIdentity/recoveryDependencies均unchecked，rawPackageCreated=true，restoreApproved=false，productionApproved=false。source原metadata仍false，不改写它。manifest包含来源相对名/布局槽位/源ID/字节数、目标ordinal名/实际ID/字节hash、目录ID、版本和边界；不把布局槽位叫已认证role，不生成Graph IR或项目快照事实。manifest不包含自己的hash，marker只关联该manifest的精确digest，避免自引用循环。

另一个真实端口限制是旧native Handle.reset调用CloseHandle后不返回检查结果，public source.close为void。未来writer必须增加同层checked target/borrow-release结果，才可区分转交、关闭成功与关闭不明；不能从调用旧void接口就推断所有OS关闭失败都已检测。若该最小接口未实现，遇未知释放不能发“安全释放完成”的receipt或自动删除目录。

## 根权限与目标归属

source 上限仍是本机固定 NTFS、逐级相对 no-follow 与 identity 检查；不提权、不改变 ACL/安全设置。目标使用同卷同根，候选方案是从 source **已持有的父目录 HANDLE** 单组件 FILE_OPEN 重开同一个 root，额外请求 FILE_ADD_FILE/FILE_ADD_SUBDIRECTORY、LIST_DIRECTORY/TRAVERSE/READ_ATTRIBUTES/SYNCHRONIZE，共享读写但不共享删除；取得后属性、卷和完整 FileId 必须等于 source 根。已有 ancestor/root pin 在此期间继续持有。不能使用 absolute-path CreateFile 回退，也不能用 DuplicateHandle 把 read 权限声称变成 write 权限。

该相对重开/创建所需权限与共享组合尚未在本机实验：失败返回 TARGET_PERMISSION/TARGET_BUSY/BOUNDARY_UNAVAILABLE，不创建包。ReOpenFile 官方要求原对象由 CreateFile 创建，而现有 source 子目录由 NtCreateFile 打开；不把它当已验证捷径。最小下一实验先核验同父 HANDLE 相对打开、identity相等、正确ACL拒绝和根替换不逃逸，再实现写入。

公共父目录 `upgrade-preservation`：不存在时相对 FILE_CREATE，存在时相对 FILE_OPEN并验证真实目录/身份/同卷；并发创建仅允许重新验证这个固定父目录，不枚举或清理其他操作。需请求创建子项/列举/属性等实际权限，仍不共享删除。operation目录只能 FILE_CREATE，已存在无论有无marker都 TARGET_EXISTS，不能覆盖/“恢复继续写”。目录 name 加 `op-` 前缀，避免 source 允许的 operationId 恰为Windows设备名；总长度、ASCII合法集合仍有界。

operation directory及所有目标成员记录由创建返回的 `(VolumeSerialNumber, FileId128)`；排除与 source/祖先/其他目标身份别名，创建后核实际类型/no-reparse。payload names 固定 `00000000.bin` 至 `00009999.bin`，按冻结的存在成员顺序映射；原源码/数据库相对名只存 manifest，不用于目标文件创建。缺失的 sidecar 只记 absent，不制造空 sidecar；真实空文件也创建/flush/读回0字节。

新文件请求 READ_DATA/WRITE_DATA/READ_ATTRIBUTES/SYNCHRONIZE以及仅用于本次失败清理的DELETE权限，ShareAccess=0、FILE_CREATE、非目录、no-follow、同步I/O；已有文件/普通占用/重解析/未知子项全部失败。目录HANDLE并不能阻止任意子项增删，所以创建后、manifest前、marker前后和交付前都核验精确名字集合与目标身份。权限/分享实验须证实；无法申请DELETE时拒绝或报告保留partial，不能以偷偷修改ACL解决。

当前 writer 的可写 HANDLE 不转给SQLite。成功后可以保持原 exclusive HANDLE 的受限只读封装，或全部关闭后由独立只读材料scope重开；不能假称原有 RW HANDLE 已降权。内部 API 不提供成功包改写/覆盖。ordinary ACL 继承不新增保密或抗同用户恶意修改保证，持有窗口外的文件不能称为OS级不可变。

## 预算与必须显式解决的读取限制

最大128KiB chunk、10,000 source成员、source尺寸/累计读20GiB、同一操作15分钟上限都不提高。writer继承source native的单调截止时间，不能为copy、回读或marker分别重新给15分钟。空间查询只提示；预算预检后 disk full、短写、flush/close失败仍失败关闭。metadata另建议16MiB manifest、4KiB marker上限，序列化大小必须在创建target前计算并拒绝超限，不构造20GiB Buffer。

**实际预算冲突：** B0要求source第二遍hash复核，但当前native把累计source.read也限于maxBytes（最高20GiB）；已有public metadata不暴露剩余预算。因此最小loan必须由内部native读取/预留真实未用budget，不能信任caller数字。保留B0第二遍source复核的首实现要求 `2B <= source剩余read预算`，B为整组现存字节总和；要求未曾public读取的lease，通常default20GiB对应writer最多10GiB材料。大于可行预算在任何target创建之前 SOURCE_READ_BUDGET拒绝。

这是实际端口约束产生的首切片限制：S1a读取仍可20GiB，不能宣称当前writer能对20GiB材料完成两遍source复核。若下一批需要全20GiB writer，须先另派准确的read预算/内部digest接口修正并取得范围授权；本设计不暗增累计读至40GiB，也不默删B0复核门。target写与读回分别有总量上限，payload加manifest/marker必须各不超过20GiB；本首切片B<=10GiB留出明确metadata余量。扩展磁盘空间约需B+metadata+保守余量，不在本切片创建staging/restore的2B副本，但显示之后所需空间不能视作已预留。

## 写入、核验与提交状态机

1. **borrow/preflight**：验证source当前性、精确present/absent集合及身份；预留2B读取budget，捕获同一deadline与member映射；计算manifest上界/空间提示。任一失败零target创建。
2. **create-owned**：绑定写根→固定parent→新operation目录与目标文件，记录创建身份/状态。不打开SQLite，不写source或checkpoint；不能复用有旧部分内容的operation。
3. **copy**：每个source顺序同HANDLE读取<=128KiB，增量SHA-256；向对应target同HANDLE写相同chunk。WriteFile返回false或成功但实际字节数不等于本chunk长度即 WRITE_FAILED/SHORT_WRITE，禁止以请求字节数冒充完成。目标offset严格单调、不越界、不并发；空文件无数据写调用。
4. **payload-flush/readback**：每成员写足后核target identity/size，FlushFileBuffers必须成功；定位0，仍从**同target HANDLE**按chunk读到精确EOF，hash与首次source流hash一致。短读、额外字节、改变identity/size均失败。只读回target不消耗source read额度。此时还不能出marker。
5. **source-final**：用loan的剩余source预算同HANDLE第二遍hash，与首次source流逐成员一致；source.verify再核根/成员/present/absent/集合。发现变化整组失败；hash相同也不扩大ordinary-win32-handles威胁范围。
6. **manifest**：构造规范UTF-8 JSON，内容来自loan/实际目标HANDLE而不是caller；FILE_CREATE manifest.json，同HANDLE写、flush、定位0、完整读回/严格解析、规范重序列化逐字节相等，并核manifest与目标列表/每个source-target映射对应。manifest SHA-256与物理identity分别记录，不混用。
7. **marker前门**：复核source/目标完整集合、身份、size及source租约未过期/取消，target有且仅有payload+manifest。没有外部新名字、没有重复物理ID，所有flush/readback已通过。然后才相对FILE_CREATE `raw-material.complete`；写入版本、operation、manifest digest与 `status=raw-material`，flush并同HANDLE读回比对。
8. **commit/交付**：marker后再检查精确目标集合、持有身份和取消/deadline，形成绑定当前native能力的receipt；target read lease转交/关闭、pending清零后解除source borrow并关闭source。成功是可核验原始材料，不是跨DB迁移原子性或断电原子提交。

source.verify未做全字节比较，不能替代第5步hash。任何phase只能记录operationId、阶段/计数/固定错误码，不能日志原始源码、DB内容、私人路径或任意异常原文。进度给有界计数/累计已完成字节和明确phase；总工作按source两读+target写/读回区分，不能把payload字节复制完称整组成功。

pending OS I/O不能硬中断，cancel/deadline在排队、chunk和完成回调检查；先drain，关闭/转交target所有HANDLE，再解除loan并关闭source，最后报终态。progress/解绑失败不能跳过close，保留原固定错误；若原生关闭/清理状态不明，保留租约/partial身份和固定cleanup状态，不递归删除、不假称释放。

## 故障与退出切点

| 切点 | 正常API失败/取消 | 异常退出后材料门 |
| --- | --- | --- |
| 预检/根权限之前 | 无写入，解除loan/关闭source | 无operation可接受。 |
| parent或operation创建后、payload中途 | marker不存在；仅按本次创建身份清理，失败保留partial | 只读识别为incomplete，不接着写，不复用ID。 |
| 某payload写完但flush失败/未回读，或任一库后库失败 | 全组失败，不能逐库成功 | 即便文件大小正确也无material完成。 |
| source第二遍hash/集合复核失败 | 包失败，source字节未被写入 | 无marker；不能删除原sidecar或覆写原件。 |
| manifest部分写、flush/关联/规范读回失败 | 无marker，保留原固定失败 | 拒绝，不以存在manifest判断完成。 |
| marker已创建但未写足/flush/读回 | 不发成功receipt；partial或unknown保留 | 严格重开验证，不完整marker/关联/hash失败即拒绝。 |
| marker完成后发生取消、progress通知、目标新子项或close失败 | 返回固定失败/取消，不发成功receipt；已完整字节材料可以保留，未知close不强删 | marker只是材料状态，不是任务terminal。需全包重开；额外子项、身份/hash矛盾或忙均拒绝。 |
| 成功返回后异常退出/断电 | 不承诺已调用flush就能覆盖任意硬件/目录持久化 | 零SQLite重开、逐项完整核验；失败保留，不自动还原。 |

marker不会回填更早缺失阶段，既有目录不会被重试覆盖。合法retry使用新operationId与新source捕获/loan；旧包只读保留。cleanup只对native本次创建、仍以身份确认的对象采用句柄删除/处置，先drain并按文件→本次目录逆序；不得按字符串recursive rm删除未知root/子项。若所需句柄删除处置API/DELETE权限不能证明安全，首实现默认保留partial并固定报告CLEANUP_FAILED，不能为“清理干净”增加路径删除回退。child试验仅自有PID且ready/close有界，未知close保留owned根。

## 重开验证：零SQLite与非认证结果

重开是另一个只读操作：从内部可信配置bootstrap实际材料根并逐级no-follow/pin；只选择安全operationId固定目录，不接受任意文件路径或nonce作为authority，不列举其他操作。以受限相对HANDLE打开manifest/marker/payload并拒绝busy/alias/reparse；保留全部HANDLE至核验结束。source原库无需打开，原root/member身份只作为当时捕获记录，不暗示源今天仍current。

严格限制manifest/marker大小、UTF-8/版本/键/字段/安全整数、present/absent布局、唯一映射/物理ID和精确目标集合；JSON只解析数据，不eval、不执行文件内SQL。规范字节round-trip拒绝重复/未知键等歧义；manifest digest与marker匹配，所有payload逐chunk hash/size/identity匹配。缺marker、不完整/未来格式、额外成员、目标替换或hash改变、busy/未知存在性均拒绝，不自动repair或迁移任何东西。

成功重开只发 raw-material 的只读lease，semanticIdentity/recoveryDependencies仍unchecked，restoreApproved/productionApproved=false。现场LiveMaterialReceipt可绑定当前创建身份与expected digest；重启后从同一可写目录读到的digest、FileId字段只是关联记录，不是独立信任锚。普通篡改导致不一致会被拒绝；同用户恶意者若同时改payload/manifest/marker并伪造一致记录，单靠hash/nonce不能认证生产者或阻止它。没有计划加入签名密钥、ACL修改、凭据或外部服务。此类包最多“字节/结构自一致且生产者未认证”，不能借raw marker通过S2语义身份门。

S2在任何SQLite副本open之前仍要恢复依赖固定格式预检、已知profile/未来版本拒绝、candidate与语义身份检查和可信来源门；没有可信登记不晋升pre10。未知super-journal/外部ATTACH恢复成员不能通过本writer扩展集合或自动访问外部文件；file symlink未验和S1a未接受仍是后续产品验收前置限制。writer不提供restore覆写原件或生产启动批准。

## 下一批候选最小文件与验收（不是本轮授权）

第一步只派source-loan/target权限实验，再派writer+重开；每批须准确界定原冻结文件修改。候选：

- 修改 `packages/graph/src/windows-upgrade-files.ts` 的内部borrow与busy计数，新增 `packages/graph/src/windows-upgrade-material.ts` 和 `.test.ts`；不改graph公共index/GraphStore。
- 在同一 `packages/graph/native/windows_upgrade.cc` 中增加opaque writer/material类型、相对target目录/文件、同HANDLE读写flush、source借用/剩余budget/截止时间；不能在另一个CRT/addon转换source指针。
- 单独新增 `packages/graph/native/windows_upgrade_writer_fixture.cc`、binding.gyp的新测试target：目标故障只在独立fixture编译，复用产品算法/私有I/O错误分支；产品target无failure injection出口。实现时若需要共享小型native I/O helper文件，先逐文件论证，不现在创建。纯编排可使用内部fake backend测短写/flush/close错误，但不能冒充真实Windows实验。
- 只在已有build脚本加入新fixture输出核验，已有smoke增加显式material modes，新增当批过程记录。无package/lock依赖变化；现有N-API/Win32、Node crypto与现有node-gyp足够候选需求，不能因此改reader、UI、main启动或其他OS。

| 自有测试类别 | 必须核验的结果 |
| --- | --- |
| 三库四类/空sidecar/>2MB/legacy-only | 原包逐字节/hash/identity映射，absent准确，原所有字节前后不变；Node与实际Electron两个target运行，普通import不创建/写入。 |
| 预算/权限/target busy/已存在 | 128KiB边界、10k/20GiB/source剩余2B预检、总deadline；权限不足无提权、FILE_CREATE不覆盖；不足预算无target写入。 |
| root/parent/operation/leaf替换、hardlink、额外成员 | 相对句柄no-follow/卷/ID门，source-target不别名，不读/写外部内容；真实file symlink须独立补验，EPERM不skip。 |
| disk full/short write/flush/readback/close失败 | 固定失败与无成功receipt；前库成功后库失败仍全组失败；原source不改，unknown关闭保留根。真实OS错误与fixture注入分别标注，不把磁盘余量预检当disk-full实测。 |
| 源集合/absent/字节变化 | copy前/后/manifest前门及第二遍hash拒绝；mapped反例保持ordinary范围，不以稳定hash证明所有writer静止。 |
| 各chunk/manifest/marker前后cancel及callback失败 | pending drain→目标close→source解除借用/close→固定终态；同根立即可重占用，无GC兜底冒充确定清理。 |
| 表中每个退出切点 | 本次owned child/PID、有限ready/close；重开零SQLite拒绝partial/额外/篡改，完整原始材料仅raw标记，原字节不变。 |
| GC/双关闭/借用冲突/cleanup失败 | 强refs、borrow/pending close拒绝、目标和source正确关闭顺序；不递归删未知对象，不用nonce认证已有目录。 |

未来命令建议：现有graph build脚本（审批对应变更后）→针对新material test的vitest→graph noEmit→既有smoke明确material模式→实际既有Electron同模式。命令参数/目标由具体实现批次冻结后给出；本轮这些命令全部未执行，也没有当前可运行的material入口。

## 官方API与未实验项

本轮只读核查：[NtCreateFile](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile) 的RootDirectory/访问与FILE_CREATE，[WriteFile](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-writefile) 的实际字节结果，[FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 的flush接口，以及 [ReOpenFile](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-reopenfile) 的原句柄前提。官方说明不是本机writer运行证据；未实验同根写权限、各target共享/no-follow组合、flush/处置/close失败、所有marker退出切点或包重开。AGENTS新增0，本设计没有新已验证工程经验。
