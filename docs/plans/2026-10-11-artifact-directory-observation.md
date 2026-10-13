# 第四批 4B-M6：同 HANDLE 的有界直接目录成员观测

2026-10-11，协调方批准原第四批内实施；不是第五批或完整 scanner。

## 来源、基线及文件边界

M5已独立接受单文件hash/PE捕获，但原Open-XRayArtifactSession强制末项文件、Get-XRayArtifactObservation仅核文件。M2已接受设计要求同目录HANDLE成员向量、精确128bit身份、逐成员相对no-follow打开及前后完整向量。因此只实现这个实际缺失端口，不重复PE/ASAR已验纯模块。

仅原开发-Sol，gpt-6.1-sol/medium，5170；协调方核冻结415与M5独立收据，再仅新增本计划形成416正式/raw起点。开发核实际Git、AGENTS、M2/M4/M5及本计划再实现，保留WIP，无Git或其他checkout写入。

一个旧文件apps/desktop/scripts/windows-artifact-handle-bridge.ps1，仅最小增加显式directory末项选择与文件观测拒绝目录；默认文件API、九字段DTO、M5捕获、原native/sharing权限与正确断言保持。仅五新：

- apps/desktop/scripts/windows-artifact-directory-observation.ps1
- apps/desktop/scripts/test-fixtures/windows-artifact-directory-probe.ps1
- apps/desktop/src/windows-artifact-directory-observation.test.ts
- apps/desktop/src/windows-artifact-directory-handle.test.ts
- docs/development-runs/2026-10-11-artifact-directory-observation.md

其余415起点文件冻结，包括M3端口/fixture/tests、M4/M5旧fixture/tests/consumer、PE/ASAR/manifest、native/core/loan/cache/DB/UI/broker、package/lock/build、AGENTS/共同记录。其他三员工冻结长期保留。新模块import仅定义函数，不绑定/打开/枚举/启动进程。

## 可运行目标

同目录HANDLE枚举完整直接成员，最多128实际成员、64KiB固定页、有限页/调用数及严格最终UTF8输出预算；超限固定失败，不截断成成功。全树5000/depth64/8GiB与32MiB sidecar仍未来门，内部低上限不修改生产契约。scope direct-members、snapshot incomplete、signature not-evaluated；不递归/不读成员内容/不complete manifest。两向量一致不证明持续不可变或完整树。

GetFileInformationByHandleEx(FileIdExtdDirectoryRestartInfo/Info)在同一HANDLE读取所有页，仅可靠本次原生错误码证实枚举终点时结束，其他错误失败关闭。现绑定缺SetLastError，不能false当EOF/猜读旧error；新目录模块可为同一API建有限内部绑定，确保错误缓存、立即捕获本次状态，不添加DLL/nativeaddon/依赖/Add-Type/compiler/孙进程。runtime/布局/API未知即拒绝。

检查NextEntryOffset前进/对齐/页界、FileNameLength字节界、完整UTF16、128bitID及适用元数据；零offset仅页末，不等于枚举终点。只精确过滤.与..，隐藏/Unicode其他项保留。单组件严格原路径语法校验、不normalize或拼绝对路径打开；reparse、未知类型/ID、重复/大小写冲突、循环/越界/坏编码固定拒绝。非reparse时ReparsePointTag未定义，不能强制原值0或纳入变化证据；reparse标志出现即拒绝。不回显路径/任意异常。

逐成员由原parent HANDLE以单组件NtCreateFile FILE_OPEN/nofollow/read-only/share-read打开，对枚举128bitID、parent卷、类型和适用元数据。替换/缺失/写占用/错ID固定拒绝，不放宽sharing/fallback。所有父/子HANDLE唯一释放归属、partial-open失败仍可关闭重试，不由DTO声明证明身份。普通子目录仅直接成员持有不递归。

全部成员打开后，同目录HANDLE重新完整枚举、按精确名称排序核完整向量，复核实际子HANDLE和祖先身份/属性，变化不得ready。ready后持有全部父/子到M3严格release，真实close/终态才算释放；重复/迟到控制、单消费、取消/deadline/关闭失败零部分成功。M3 strict token/重复JSON/stdout64KiB/stderr4KiB/deadline不改，预算按最终UTF8。原目录锁不能推断禁止创建成员，新增变化必须检测而不是绕过检查。

fixture只自有临时材料，不扫candidate/用户项目、不执行其代码、不安装/修改安全设置、不递归删除未知对象；保留现场。fault injection仅新fixture，不能替代实际Windows来源/EOF门。

## 验证与冻结交付

开发仅纯定向测试、desktop noEmit、静态JS/PS解析，禁止真实HANDLE/进程/native/build/dist/Electron技术测试；普通单worker/nofileparallel/nocache/exclude benchmarks。新Windows测试写成真实可运行入口，覆盖空/隐藏/Unicode/文件+子目录、多页/页界/限额、错误EOF/坏页/未知ID/元数据错配、两向量间增删、junction/写占用、重复、取消/deadline/close失败及释放后重开。未运行/不可可靠模拟单列，不预报通过/删正确断言。

交付416完整before/after/hash/raw、一旧五新精确patch及自有反馈闭环/0–3工程经验评估，不改AGENTS。冻结后root源码/回归/noEmit，再唯一协调Windows窗口执行新实际测试与M4/M5/M3适用原回归后精确集成。自测不是接受。完整树/ASAR副本/sidecar/manifest/签名/安装/运行/GUI/API/干净Windows/literal零OS后代仍未验，不因长期成员启动第五批。

## 主要资料

[GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)定义返回值/错误及0x13/0x14类；[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)定义字段/页内下一项及仅reparse时有效tag；[DllImport SetLastError](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.dllimportattribute.setlasterror)定义CLR错误缓存。仅候选契约，不证明PS5.1发射布局/EOF已通过；开发核该runtime与Microsoft样例，root目标Windows实测后判断，不靠文档豁免。



## 2026-10-12 M6 同源稳定性独立诊断与窄修边界

原开发-Sol的纯诊断已交付，root核421正式文件，仅自有M6记录变化，其余420与原交付逐字节一致。root在其他成员冻结、单技术窗口内用自有且已关闭写入的目录执行独立同源配对探针12例；全部两次完整枚举向量、两次同一子HANDLE完整metadata、两次父HANDLE完整metadata相同且实际关闭。第9例仍由原断言拒绝，只有子目录枚举与子HANDLE的write/change不同（相差10026个100ns tick）。这证明本次跨来源差异与各来源前后稳定可以同时出现；不证明缓存的底层根因或原子快照。Windows原41项40通过1失败仍未改写，M6仍未接受、未main集成。

独立原始收据和固定字段日志为ignored m6-diagnosis-independent-v3.json、m6-root-source-pairs-v3.log；root探针第1版受宿主脚本执行策略拒绝，改用原trusted-reader一致的内存ScriptBlock入口，第3版通过，未更改系统策略。两个失败收据保留，不称为产品失败。技术窗口已关闭。

据上述实际复现批准原开发-Sol（同聊天、5170、gpt-6-luna / max）仅M6目录模块、新fixture、两个新M6测试及自有记录五个已存在文件窄修，其他416文件冻结，包括原bridge/M3/M4/M5/AGENTS/共享记录。将未输出的子目录write/change跨来源相等假设替换为同一已持有成员HANDLE的前后完整metadata稳定门；跨来源volume/完整ID/type/attributes/creation和普通文件write/change/length/allocation严格门保留，两个完整枚举向量逐字段比较保留。不得只跳过时间比较、加sleep/重试、放宽sharing或删正确断言。开发只纯测试/类型/AST解析，实际Windows与进程门仍由root冻结后独立单窗口复验。细节和验收矩阵见M6计划。

本轮只接受诊断依据和修复范围，不接受实现。源码根因、完整reader/全树/ASAR副本/sidecar/manifest/GUI/API/签名/安装/运行/干净Windows及Git仍未验。工程经验新增0；保留长期员工和四批收尾暂停门，不第五批。


要求初次子HANDLE查询后保存私有字段捕获，末尾从相同仍持有的HANDLE重新查询，逐字段核volume、完整fileId、directory、attributes、creation、write、change、length、allocation、links；捕获不得被后续查询或fixture共享对象的修改污染。第二向量精确比较仍在最终ready之前，祖先/观察目录稳定、句柄唯一关闭和固定诊断保持。目录未输出的write/change不再跨API相等，但creation/身份/类型/属性仍严格。普通文件原跨API时间/长度/分配量检查保留；不借此声称递归子目录内容一致或完整manifest。

必要测试矩阵：确定性夹具产生两向量相同、两次子HANDLEmetadata相同而目录跨来源write/change不同，应成功；两向量任意已有字段变化拒绝；同HANDLE最终metadata字段任一改变拒绝；错volume/ID/type/attributes/creation拒绝；普通文件write/change/length/allocation不一致拒绝；缺少新前像或后查询失败拒绝；所有失败零ready且原唯一释放归属保持。注入只新fixture，不改真实SDK/native函数为宽松实现。保留原41项实际Windows断言并添加上述回归，真实Windows门开发只编写不执行；静态源码正则仅佐证结构，不能称为行为验收。

修复基线是独立诊断完成后的421路径完整raw/hash，备份和SHA由ignored m6-diagnosis-independent-v3.json给出；交付从该基线的五旧增量patch、完整前后raw/hash以及其余416不变证据。root实际逐hunk核差异与测试后，在唯一Windows技术窗口运行新M6及适用M3/M4/M5原回归，达到门槛后再精确main集成，不自行Git。自有记录中手抄manifest SHA漏字符须按真实manifest/收据纠正，不能改原收据。

资料只用于不同信息源的字段语义：[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)、[FILE_BASIC_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info)。[FindFirstFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstfilew)明确其NTFS枚举属性可能不及时，但它不是本模块的FileIdExtdDirectoryInfo接口；不得将该说明外推为本次已确认缓存原因。批准替换比较来源的直接依据是上述目标PS5.1实际配对探针，未知机制仍记录未知。


## 2026-10-12 M6独立接受与有界树缺口

M6夹具三旧修复经过root完整421/raw/精确patch核验、16纯/类型及66Windows通过，产品模块保持、其他418不变；旧M4/M5实际59通过，5170缺M3测试不宣称该门通过。root原比较器探针证明真实member write差1、DIRECTORY_CHANGED、exit9/零stdout及可重开。main514→519精确一旧五新、其他513不变，主目录五文件实际169/169（含M3 28）与类型通过，两源像稳定。只接受直接目录成员本地/Windows技术门，原失败与诊断均保留；完整reader/全树/ASAR安全副本/sidecar/manifest/签名/安装/运行/GUI/API/干净Windows和Git未完成。详见[目录独立审查](../development-runs/2026-10-12-artifact-directory-independent-review.md)。工程经验0、重型关闭，不第五批。

当前代码仍只有direct-members与单文件hash，M2递归树/全量文件记录要求尚缺。依据实际M6容量及M5/M3接口形成4B-M7有界递归树/同HANDLE文件观测，原开发-Sol Luna/max、5170，拟一旧五新；主目录接口已稳定才派发，无并行共同文件修改。计划见[树观测](2026-10-12-artifact-tree-observation.md)。只内部树端口，不公开CLI或complete manifest；其他三个长期成员冻结保留。
