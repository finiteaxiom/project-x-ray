# 第四批 4B-M7：有界递归树与同 HANDLE 文件观测

2026-10-12，协调方原四批内必要实现切片。须在M6独立接受及精确main集成复验通过后才派发；不是第五批，也不注册生产扫描CLI。

## 源码依据与冻结边界

M2已接受设计要求递归目录与文件hash；当前M6只返回direct-members且不读成员字节，M5只支持一个文件。当前Get-XRayDirectoryVector默认128成员、132调用，Convert-XRayDirectoryPage默认130记录，不能把直接层观察拼成完整树或支持5,000文件。当前M3 stdout上限64KiB不变，完整清单sidecar、ASAR安全副本和manifest编排仍另有本地缺口。

原开发-Sol（同聊天01a0f53c-353f-70e3-98c3-96ed65c085d6，host local，gpt-6-luna/max，仅5170）实施。协调方先核M6冻结421与main精确收据，仅向5170增加本计划为422正式raw基线；开发再次核自身AGENTS、M2、M3、M4、M5、M6及本计划。不得覆盖其他checkout或Git收尾。其他三成员冻结保留。

仅允许一个既存文件：apps/desktop/scripts/windows-artifact-directory-observation.ps1，只为低层page/parser/vector函数增加显式内部有界容量选择，默认128/130/132及M6公开直接观察行为保持。新范围至多5,000成员/目录、按64KiB页计算的有限记录与调用上限，参数严格校验且不得超过上限；错误缓存/实际EOF、UTF16/偏移、identity/碰撞/no-follow、全部旧安全断言保持。禁止改M6原fixture/测试/记录、M4bridge/API、M5consumer/原fixture测试、M3端口、manifest/PE/结构纯模块、native/UI/DB/broker/loan/cache/package/lock/AGENTS/共同记录。

仅五新文件：apps/desktop/scripts/windows-artifact-tree-observation.ps1；apps/desktop/scripts/test-fixtures/windows-artifact-tree-probe.ps1；apps/desktop/src/windows-artifact-tree-observation.test.ts；apps/desktop/src/windows-artifact-tree-handle.test.ts；docs/development-runs/2026-10-12-artifact-tree-observation.md。不增依赖/native/API/DLL/compiler/孙进程，不复制或执行候选代码。

## 可运行实现与保证

新内部模块仅函数定义、lazy绑定。由M6既有逐组件打开取得显式目录根，按原parent HANDLE单组件no-follow只读share-read打开后代；普通文件与目录都在一个会话的唯一owner账本立即登记并持有至真实release。完整volume/128bitID/type/reparse与精确名称绑定；全树同物理ID重复/硬链接/祖先循环失败关闭，不靠路径字符串前缀或规范化。捕获私有完整metadata，不能用可变对象作前像。

每个目录在本次递归工作前取完整排序向量，所有内容读取后从同一仍持有HANDLE重枚举并严格比较完整字段；复核所有成员同HANDLE十字段、各目录及路径祖先的适用身份/属性/时间。目录跨来源write/change按已验M6同来源稳定性契约处理，普通文件跨来源元数据严格门保留。最终复核覆盖根与全树，不能读完一个子树就释放它，不能把前后离散一致说成原子不可变快照。

每个文件只从相同已登记HANDLE流式SHA-256、计数、前后metadata和有限M5 DOS/COFF捕获，不seek/第二路径打开/整文件Buffer。优先复用M5原Get-XRayArtifactObservation；若使用借用文件view，view只有已登记HANDLE，绝不关闭/转移owner、不新增打开、不重读旧流；完整父链与全树最终稳定门由树层独立核实。原M5默认DTO/API及消费上限保持，不能拿全树owner数量伪装成单文件view数量；明确这些计数的对象范围。M4对普通tag的旧行为不能成为tree跟随reparse或删正确断言的理由；必要的局部metadata适配只能在新树函数内部复用已验M6严格查询，不改全局函数。

按冻结协议设置最多5,000普通文件、根相对深度64、每文件2GiB、总8GiB、相对路径UTF8 512字节、总15分钟；在打开/读取/递归前检查限额，用减法检查累计字节溢出，超限固定失败而非截断成功。另设内部5,000目录/10,000总对象有限账本上限，明确其是额外incomplete边界，不改变manifest v1。原固定1MiB文件缓冲与64KiB目录页不变；总记录/向量及最终内部DTO也受32MiB预算，不能先无限收集再检查。根及已持有祖先占用计入账本；时间/取消由本轮严格M3进程deadline和新函数检查保证，不增加sleep/重试/share fallback。

树层返回内部精确root-relative文件记录、完整identity/hash/bytes及有限PE材料与计数，scope明确tree-files，snapshotStatus仍incomplete、signatureStatus not-evaluated。没有sidecar前不得把5,000记录写M3 stdout；新fixture正常路径仅输出有界本轮观测摘要/严格有限小样本，大树用计数与canonical记录摘要核验，不冒充生产manifest或来源认证。API的内部全量返回与fixture摘要通道分列，最终stdout UTF8连同frame仍在64KiB内。ASAR/scratch/write/sidecar/签名/双root去重/完整manifest/安装/GUI/运行仍未实现或未验，不能把本切片称作完整reader。

## 验证与交付

新纯检查核默认M6保持与有界容量/所有权/预算/不完整语义，不使用它们代替Windows行为。开发只串行单worker纯定向回归、desktop noEmit、JS/PS解析，不执行Windows/HANDLE/reader进程/build/native/dist/Electron。新Windows测试编写但由root冻结后单窗口运行：递归空/隐藏/Unicode/混合树，真实每文件SHA/完整ID，宽目录超过128仍可有界读取，原128直接观察仍拒绝；目录前后新增/删除/metadata改变、子树读后变化、错ID/重解析/写占用、重复ID/硬链接与取消/deadline/close失败；计数/深度/字节/路径/页/报告限额，零部分ready且原唯一释放、实际可重开。较大边界只用自有材料且明确实际读量与验证范围，不能以配置常数或假DTO称为真实5,000文件/8GiB运行验收。

交付422完整before/after raw/hash、一旧五新精确patch、自有真实反馈闭环与未执行门；其他421原文件保持。开发Git零，AGENTS本轮0，工程经验可记自有记录供root审。root独立逐hunk/来源/必要回归、M6默认旧门与M3/M4/M5适用回归及目标Windows单窗口后再精确main集成。发现契约冲突先具体复现停在冻结边界，不能自行增文件或放宽。四批收尾与外部门暂停规则保持，员工不归档。


4B-M7实际派发：同一开发-Sol gpt-6-luna/max、5170，turn 01a12db3-1d6a-7c83-ab12-b3cc8e6d8160，实际cursor f884d126-4b7c-4788-82d6-8fae95636925:12，compact snapshot active/inProgress/error null。422完整raw/hash基线已核，仅一旧五新/其他421冻结，开发只纯回归/类型/解析；真实Windows/进程/重型单窗口仍关闭。M6已接受且精确main集成不重做，M7未实现/未验收，不预记通过；完整reader与外部门保持，原四批继续、其他员工冻结保留、不第五批。


## 2026-10-12 M7首次独立复验未接受：全树最终复核漏检

422/raw→427冻结及一旧五新精确 patch 核通过、其他421不变、main520稳定；root两个纯文件25/25及 desktop noEmit通过。唯一技术窗口新Windows13项11通过2失败（正常嵌套和owner持有用例），原失败保留。真实自有 late-subtree 探针在第二文件读取前向已结束的 a/b 新建文件，实际3文件却ready报告2，原release/exit0/可重开；确认各子树局部第二向量不能代替全部内容读取后的全树最终复核。普通失败的时间/来源根因仍未确认，不删正确断言或加sleep/重试。M7未接受、未main集成；M6已验门保持。

从427当前全像仅派原开发-Sol Luna/max修既存M7树模块/probe/两个新测试/自有记录五旧，零新、其余422冻结（含M6容量模块及M3–M6/AGENTS/共同计划记录）。需预算内保留目录前像、最终全部向量/同HANDLE成员十字段核验、明确borrowed view与旧65上限、补实际有效故障和安全释放；开发仅纯/类型/解析，root技术窗口关闭，冻结后独立复验。详见 docs/development-runs/2026-10-12-artifact-tree-independent-review.md。GUI/API/Git及完整reader/发布外部门保持未验，工程经验0，四批继续不第五批，员工不归档。


M7五旧窄修已实际派发：原开发-Sol gpt-6-luna/max、仅5170，turn 01a12dcd-6e0d-7453-a264-308956f3cb81、cursor f884d126-4b7c-4788-82d6-8fae95636925:19；compact snapshot active/inProgress/error null。427完整冻结基线与root raw已保存，仅五个既存M7文件可改、其他422冻结，零新增；Windows/HANDLE/reader及重型窗口关闭。初交付25纯/类型与11/13实际Windows及漏检反例保留，M7未接受、未main集成，修复交付后root再独立复验，不以开发自测升级。原四批继续，员工保留，零Git/新增规则。


2026-10-12 M7最新独立复验：冻结427五旧/raw/精确patch与其余422不变、main521不变；25纯/类型通过，原真实late-subtree漏检现DIRECTORY_CHANGED/零ready且可重开。但新Windows21项18通过3失败，M7未接受、未main集成。字段诊断测得深度64完整向量write/change前后不同；独立自有fixture准备查询3/65/3目录并真实释放后，两个正向通过，原metadata故障实际注入且被原同HANDLE门拒绝。只支持测试准备窄修，OS底层原因未证、原失败日志保留。下一步原开发-Sol Luna/max、5170只改tree-probe/tree-handle.test/自有M7记录三旧、零新，其余424冻结（含产品树与纯模块）；仅纯/类型/解析，真实技术/重型窗口关闭，稳定后root单窗口复验再集成。详细来源、限制、命令/日志和门见 docs/development-runs/2026-10-12-artifact-tree-independent-review.md 与 ignored m7-repair-independent.json。GUI/API/Git及完整reader/发布外部门未验，规则新增0；四批继续、不第五批、员工保留。


2026-10-12 M7最新独立结果：owner夹具两旧修复427/raw/精确patch、其他425保持；25纯/类型、真实Windows21/21及旧M6/M4/M5 125/125通过。精确main522→527一旧五新、其他521保持；main类型/七文件199/199（含M3 28）通过、两目录源像稳定。只接受有界树观测本地/Windows技术门，incomplete/not-evaluated保持；5,000/8GiB实际负载未验，sidecar/ASAR安全副本/完整manifest/安装/签名/运行/干净Windows/GUI/API/Git仍未完成。实际收据m7-owner-fixed-independent.json、m7-main-exact-integration.json与docs/development-runs/2026-10-12-artifact-tree-independent-review.md末节。员工冻结保留，技术窗口closed、无新增工程规则/无Git，四批继续不第五批。
