# 4B-M6 目录观测独立审查

2026-10-12，协调方仅原第四批。切换开发-Sol模型后继续实际审查；不GUI、API、签名、安装或Git。原始交付与失败日志在ignored desktop-main-integration保存。

核真实5170 HEAD455d4ad50830ee2495b70927e51caf830a4efbb8及416 raw原像、421实际文件和manifest SHA256 A47DFEB14E156C3895861CB803830B6B9E6A1534C2896A7396B9E9A9D0B91021；patch SHA256 F6A35F1203C59EFF8091159836D1457EF543DDB28155E75BAFC958308759482F。逐hunk独立重建六路径相同，仅一旧五新/415旧保持；main512前像未变。审目录模块/fixture/真实Windows测试，核立即错误缓存、严格终点、完整ID/no-follow、第二向量和释放归属、不完整语义及自有材料边界。

协调方实际运行node node_modules/vitest/vitest.mjs run apps/desktop/src/windows-artifact-directory-observation.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**：静态14通过；node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json通过。均cwd5170，完整源像稳定；静态测试不证明native来源。

单root Windows技术窗口执行同参数windows-artifact-directory-handle.test.ts：41项40过1失败，41.17秒exit1；隐藏/Unicode/子目录组合在ready前CHILD_EXIT。再选择preserves hidden and Unicode：同例失败、40未选择、0.89秒exit1。没有删除断言或把失败改为成功。

根自有临时目录诊断m6-root-names-probe.cjs使用原trusted模块与fixture，材料保留且无递归清理。hidden和Unicode单独可成功；含子目录场景成功/失败交替。只在ignored根探针包裹原Assert-XRayDirectoryMember并仍执行原比较，实际失败定位为目录条目write/change与打开的真实HANDLE metadata不同；示例两值差约1ms。无正式源码变动。已证明具体字段差异；尚未证明是活跃变化、目录条目缓存、fixture时序还是产品契约缺陷，必须继续诊断，不能直接放宽安全判断或删除时间一致性门。

M6本地独立门不接受，未精确main集成；Windows40通过不能代替完整41或旧默认行为门。技术窗口已关闭；后续开发只在明确三旧窄边界诊断/提出修复，不并发真实Windows/build/native/dist/Electron。完整树/ASAR私有副本/sidecar/manifest/签名/安装/运行/GUI/API/干净Windows仍未验。AGENTS工程经验0，未确认根因仅在过程记录。


M6诊断实际派发：同一开发-Sol以gpt-6-luna / max启动turn 01a12d6c-3f85-7b01-be8a-a2996a6de09d，实际cursor f884d126-4b7c-4788-82d6-8fae95636925:4为active/inProgress/error null。仅源码/现有收据/官方契约诊断及自有M6记录追加，其他420正式文件冻结；源码/测试修复尚未授权，真实Windows/进程/build/native/dist/Electron窗口关闭。稳定具体方案由root先核，再派确定窄修；不冒称已修复或接受。原定时任务继续ACTIVE，四批范围/收尾暂停门保持。


## 2026-10-12 M6 同源稳定性独立诊断与窄修边界

原开发-Sol的纯诊断已交付，root核421正式文件，仅自有M6记录变化，其余420与原交付逐字节一致。root在其他成员冻结、单技术窗口内用自有且已关闭写入的目录执行独立同源配对探针12例；全部两次完整枚举向量、两次同一子HANDLE完整metadata、两次父HANDLE完整metadata相同且实际关闭。第9例仍由原断言拒绝，只有子目录枚举与子HANDLE的write/change不同（相差10026个100ns tick）。这证明本次跨来源差异与各来源前后稳定可以同时出现；不证明缓存的底层根因或原子快照。Windows原41项40通过1失败仍未改写，M6仍未接受、未main集成。

独立原始收据和固定字段日志为ignored m6-diagnosis-independent-v3.json、m6-root-source-pairs-v3.log；root探针第1版受宿主脚本执行策略拒绝，改用原trusted-reader一致的内存ScriptBlock入口，第3版通过，未更改系统策略。两个失败收据保留，不称为产品失败。技术窗口已关闭。

据上述实际复现批准原开发-Sol（同聊天、5170、gpt-6-luna / max）仅M6目录模块、新fixture、两个新M6测试及自有记录五个已存在文件窄修，其他416文件冻结，包括原bridge/M3/M4/M5/AGENTS/共享记录。将未输出的子目录write/change跨来源相等假设替换为同一已持有成员HANDLE的前后完整metadata稳定门；跨来源volume/完整ID/type/attributes/creation和普通文件write/change/length/allocation严格门保留，两个完整枚举向量逐字段比较保留。不得只跳过时间比较、加sleep/重试、放宽sharing或删正确断言。开发只纯测试/类型/AST解析，实际Windows与进程门仍由root冻结后独立单窗口复验。细节和验收矩阵见M6计划。

本轮只接受诊断依据和修复范围，不接受实现。源码根因、完整reader/全树/ASAR副本/sidecar/manifest/GUI/API/签名/安装/运行/干净Windows及Git仍未验。工程经验新增0；保留长期员工和四批收尾暂停门，不第五批。


要求初次子HANDLE查询后保存私有字段捕获，末尾从相同仍持有的HANDLE重新查询，逐字段核volume、完整fileId、directory、attributes、creation、write、change、length、allocation、links；捕获不得被后续查询或fixture共享对象的修改污染。第二向量精确比较仍在最终ready之前，祖先/观察目录稳定、句柄唯一关闭和固定诊断保持。目录未输出的write/change不再跨API相等，但creation/身份/类型/属性仍严格。普通文件原跨API时间/长度/分配量检查保留；不借此声称递归子目录内容一致或完整manifest。

必要测试矩阵：确定性夹具产生两向量相同、两次子HANDLEmetadata相同而目录跨来源write/change不同，应成功；两向量任意已有字段变化拒绝；同HANDLE最终metadata字段任一改变拒绝；错volume/ID/type/attributes/creation拒绝；普通文件write/change/length/allocation不一致拒绝；缺少新前像或后查询失败拒绝；所有失败零ready且原唯一释放归属保持。注入只新fixture，不改真实SDK/native函数为宽松实现。保留原41项实际Windows断言并添加上述回归，真实Windows门开发只编写不执行；静态源码正则仅佐证结构，不能称为行为验收。

修复基线是独立诊断完成后的421路径完整raw/hash，备份和SHA由ignored m6-diagnosis-independent-v3.json给出；交付从该基线的五旧增量patch、完整前后raw/hash以及其余416不变证据。root实际逐hunk核差异与测试后，在唯一Windows技术窗口运行新M6及适用M3/M4/M5原回归，达到门槛后再精确main集成，不自行Git。自有记录中手抄manifest SHA漏字符须按真实manifest/收据纠正，不能改原收据。

资料只用于不同信息源的字段语义：[FILE_ID_EXTD_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)、[FILE_BASIC_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info)。[FindFirstFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstfilew)明确其NTFS枚举属性可能不及时，但它不是本模块的FileIdExtdDirectoryInfo接口；不得将该说明外推为本次已确认缓存原因。批准替换比较来源的直接依据是上述目标PS5.1实际配对探针，未知机制仍记录未知。


M6窄修已实际派发：原开发-Sol gpt-6-luna / max，turn 01a12d81-8e13-78e0-bcc5-312e022beddb，cursor f884d126-4b7c-4788-82d6-8fae95636925:7；compact snapshot为active/inProgress/error null。以诊断后421完整raw/hash为起点，仅既存五个M6文件可改，其他416冻结；开发真实Windows/进程/重型验证窗口关闭。待稳定交付后root独立复验，不预设修复通过；M6未接受、未集成，原定时任务继续，工程经验0。


## 2026-10-12 M6修复独立复验：时间戳门通过，故障夹具仍缺有效注入

root已核421完整修复前后raw/hash、五旧patch逐hunk重建与完整字节一致、其余416不变和main514稳定，静态16/desktop noEmit通过。唯一技术窗口执行新Windows66项：65通过、1失败，57.13秒exit1，完整源像稳定。原隐藏/Unicode/子目录场景、本次私有metadata前像/十字段同HANDLE稳定、空/多页/EOF/identity/释放及跨来源时间矩阵已在本次命令实际通过；M6整体仍未接受，不main集成，不以65项替代66项。

剩余失败是新post-vector-field夹具：它修改第二枚举首条raw记录的write，实际首条名字为精确“.”，产品按既定契约过滤点项，因此两个解析后的完整向量完全相同，ready/released成功。root自有忽略探针保留并调用原parser/比较，实际记录两次首项均“.”、解析成员为member、向量相同、ready与真实terminal/exit0，确认这是夹具没有产生预期的直接成员变化，不是已证明的产品漏检。不得删除该正确拒绝断言或修改产品比较来让它过。

技术窗口关闭。仅派同一开发-Sol Luna/max修复既存新fixture、Windows测试和自有M6记录三个文件；基线本次冻结421全像，其他418包括目录产品模块/纯测试/bridge/M3/M4/M5/AGENTS/共同记录冻结，零新增。第二向量故障须定位一个真实非“.”/“..”成员后准确改变其字段，明确验证注入实际发生；不可依赖raw偏移0、不sleep或放宽正确断言。开发仍仅纯定向检查、类型和AST，实际Windows/进程窗口由root冻结后再开。完整收据m6-repair-initial-independent.json、m6-repair-root-windows-new.log、m6-root-fixture-offset-probe.log保留。

本次只接受局部源码/类型和已执行的适用行为事实，整体M6未接受、未集成；完整reader/GUI/API/Git与所有外部门保持未验。AGENTS新增0，夹具首项假设已经有具体诊断，暂不为此增加重复通用规则。四批继续，长期成员保留，不第五批。


上述夹具三旧窄修实际派发turn 01a12d9c-5057-7d73-be4f-8725c59330a2、cursor f884d126-4b7c-4788-82d6-8fae95636925:10；同一开发-Sol Luna/max，compact snapshot active/inProgress/error null。基线421、其他418冻结、技术窗口关闭；原65/66独立结果保留，稳定交付后再复验，不将开发自测改写为接受。


## 2026-10-12 M6 本地及Windows技术门接受、精确main集成

三旧夹具修复已冻结，root重新核421前后完整raw/hash、原始四收据副本与三旧patch逐hunk重建，其他418不变；patch SHA256 688ADE68A5B1CA6A05C21CE2A2EDEF33E20E8564C41A52DA17EC53C745CDFFC7。产品模块未在夹具修复中变化。root串行纯来源16/16及desktop noEmit通过，新Windows66/66通过（53.96秒）；旧M4/M5实际59/59通过（92.32秒）。这条旧回归命令虽列M3文件，5170没有该测试文件，实际只选择M4/M5两文件，不能称为Sol M3通过；M3实际门由主目录集成命令完成。完整源码两像稳定。

独立自有PS5.1探针保持原向量比较器：真实member已注入，第二向量write仅差1，两个解析向量不同，原比较器明确DIRECTORY_CHANGED拒绝，exit9、零stdout且文件实际可重新写打开。探针未用fixture的防ready兜底代替产品拒绝，材料保留。原41项40通过1失败、修复66项65通过1失败和两次探针诊断均保留，不改写历史失败。

main514→519只精确集成一个旧bridge的已审directory opt-in三hunk与五个M6新文件，其余513完整字节不变；M5及默认文件九字段API保持。root单技术窗口在主目录执行五文件：windows-artifact-directory-observation.test.ts、windows-artifact-directory-handle.test.ts、windows-artifact-reader-process.test.ts、windows-artifact-handle-bridge.test.ts、windows-artifact-pe-handle-capture.test.ts，均用node node_modules/vitest/vitest.mjs run及--maxWorkers=1 --no-file-parallelism --no-cache --exclude **/.benchmarks/**，169/169通过（151.19秒）；node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json通过。主目录M3为实际选中的28项，主目录完整519及5170完整421在检查后稳定。

原始收据m6-fixture-fixed-independent.json、m6-main-exact-integration.json与各原日志在ignored desktop-main-integration保留，main一旧五新完整来源/原像/raw备份及hash可核。仅M6有界直接成员本地/Windows技术门接受；完整树、ASAR安全副本、sidecar、完整manifest、签名、安装、运行、GUI/API/干净Windows和Git收尾仍未验或未做。真实GUI0，Git0，AGENTS新增0：本次错误注入定位及实测闭环已有规则覆盖。重型窗口关闭，四批继续、员工保留，不第五批。
