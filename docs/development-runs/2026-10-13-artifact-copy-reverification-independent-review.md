# M11 首次独立复验：夹具与非本次状态撤销缺陷

2026-10-13 root核真实447完整raw/hash，原442保持、仅五新，HEAD保持，主目录M4/M8/M9/M10依赖逐字相同。稳定交付后root单窗口运行原纯/HANDLE两文件，40项39通过1失败（49.85秒），desktop noEmit通过；M11不接受、不main集成、不Git。

夹具缺陷：owner-reference-change 原探针 firstVerification=READ_FAILED、faultReached=false。源码 `$script:xrayM11CopySession` 仅读取从未赋值，因此故障注入拿不到真实owner。仅临时脚本绑定原copySession后，实际到达owner-reference-recheck并返回LEDGER_REJECTED。临时诊断不能替代修复后原套件验收。

产品缺陷：使用原纯测试的syntheticOwnerSetup、原M11函数和真实registry查找逻辑，新增一个独立合成M9 entry/state；仅把真实M10 state.outputFileSession指向这个foreign session，保留原M10的outputFileEntry/outputFileState。预期零读/seek、固定ledger拒绝、foreign状态保持。实际零读/seek和ledger拒绝，但foreign ready变false/status变rejected，原M9 ready仍true。根因未确认配对时先用查找结果覆盖fileState，catch又撤销该未确认foreign状态；Revoke helper还追随entry当前state，可能脱离已捕获、确认绑定的state。此实验不执行native/HANDLE、不能外推跨信任域授权漏洞；它证明内部所有权失配的错误补偿违反本次owner边界。

独立收据：忽略目录 `.benchmarks/desktop-main-integration/m11-initial-independent.json`、`m11-root-initial-tests.log`、`m11-foreign-ledger-probe.json`、`m11-owner-fixture-diagnostic.json`。自有pure探针首次因进程脚本执行策略未能启动，改用仓库测试既有进程级Bypass参数后成功，不改系统安全设置；该启动问题不是产品缺陷。原447在诊断后全保持，现场保留，技术窗口closed。

只派work tree 2四旧：M11生产模块、fixture、纯test、自有记录；原HANDLEtest及其他443全部冻结。失败仅撤销本次已经确认且捕获的owned state，不追随失配或后来替换的entry.state，不影响其他M9/M10；无法证明配对仍固定拒绝、撤销可确认的本M10 ready，并保留原ledger/Close的真实unconfirmed边界，不重造绑定或宣称释放。加入实际纯foreign绑定反例及捕获后引用错配回归，原HANDLE测试正确预期保持；夹具只修绑定后到达marker。开发仅pure/type/PS5.1AST，稳定后root独立复验。

原M10接受保持，不重复旧门。GUI/API/完整reader/ASAR/签名运行等未验，四批停止门保持，不第五批。本轮不新增AGENTS规则；修复和再次独立证据后再评估已有规则覆盖程度。


## 2026-10-13 M11 修复独立接受与主目录精确集成

root447/raw精确四旧修复、其他443保持，原两文件42/42通过（50.37秒）与desktop noEmit通过。独立原foreign绑定反例复验：固定ledger拒绝、零读/seek、foreign M9 ready/status及原M9 ready保持，只撤销已确认本M10状态；捕获后M9 entry.state替换回归保持替换对象而撤销已捕获owner。原HANDLE suite故障marker/重复同HANDLE读回/借用/关闭重试门通过。主目录550→555只五新/旧550完整raw/hash保持，主目录同两文件42/42及desktop noEmit通过，两源像稳定。只接受本地Windows重复owned副本核验，不证明ASAR/parser来源或完整reader，实际2GiB边界未测。无GUI/API/Git，技术窗口closed、员工保留冻结，四批停止门不变。详情 [独立审查](../development-runs/2026-10-13-artifact-copy-reverification-independent-review.md)，完整收据m11-repair-independent.json/m11-main-exact-integration.json。

本轮未新增AGENTS经验：此次owner补偿只改已确认捕获对象的要求已由既有身份绑定、未知归属不得处置规则及本切片契约约束；具体反例与修复留审查记录。下一真实缺口仍为M2 ASAR受控私有路径消费者/元数据解析与M11前后编排：当前已安装asar3.4.1 disk.readArchiveHeaderSync按不可信headerSize直接Buffer.alloc且JSON.parse，并有按路径filesystemCache，不能未审查直接接候选包。该源码检查没有执行parser/候选代码，不安装依赖；下一实现边界未派。完整reader/sidecar父进程核验/manifest/签名运行GUIAPI仍未验，继续四批内可本地推进工作，不第五批。
