# S1b-P 权限实验独立审查与清理拒绝

2026-10-04 07:23，协调方。main `acf076b70fbd046537f9e465b29e47f2855fd4de`，清洁；此版本七份接受设计/计划/协调材料已普通push exit0、独立远端同SHA，未纳入S1a或本实验实现。读取当前规则/队列/review/handoff后双目标只返回Luna，单Sol取得冻结完成回合01a10401-1b32-7843-a1de-ca166aef5f9f、cursor cfe7da2a-d1e4-4a1f-9168-182cb9c80d36:33；Luna原任务completed/notLoaded、cursor5f905603-9e05-4a70-bae4-5e6a5162a670:20。

## 冻结稿与实际检查

Sol五新文件与新ignore行在5170，旧HEAD455d4ad保持。root完整读查native/CLI/build/binding/记录，actual hash与交付一致：native8BD7B2116811CCD6892421DACDD57578AB9B7F9A8CCF7DA8B69F2A98EE756204，binding6AA1A2762428C731A16BDCE835B1D0EE8B226729396E36B7FACC29FB381342D3，build08BD8A617B55CC5419395B31C991C327AE53880671B2718205A8E66DDC60CA61，CLI B9DCA43F8AEBBA3BFFD9D11F3F2C8DCC70E4164B4F527A357D0E470DE75010AE，开发记录BFDC9DA677C5A1E6F24C3E960CCD2EB2EDD4B9AB1BDEBED3122878BFDBDFBD39。S1a adapter/native/test/smoke及graph/application/两设计hash保持，不整体合并旧worktree。

root接管冻结后的单技术窗口，执行两个cjs `node --check`（exit0）及原 `node packages/graph/scripts/build-windows-upgrade-write-probe.cjs`（exit0、WRITE_PROBE_BUILD_OK、约7.26秒），只隔离新target。再运行主目录ignored独立review.cjs：它以spawnSync调用**原CLI** --node与--electron，各65秒外层上限/隐藏窗口，对完整JSON另行重算固定字节hash、逐块请求/实际数、全部分享/碰撞/ID/close/失败矩阵；自身exit0，两个原CLI均exit1/stderr空，不把它们称实验整体通过。

实际Node24.17.0与Electron44.4.3均复现：父目录read mask0x1000a1没有FILE_ADD_FILE/FILE_ADD_SUBDIRECTORY，但单组件RootDirectory子目录FILE_CREATE返回Nt=0、Info=2（真实创建）。原正确失败断言readOnlyCreateDenied=false保留、outcome READ_ONLY_CREATE_ASSUMPTION_FAILED；不是产品S1a源码新增权限漏洞，当前产品并未导出这种创建端口。该本机反例否定“只读目录HANDLE因此不能创建子项”的设计推定；不能将它外推为ACL绕过或所有Windows环境保证。

独立脚本hash：ignored review.cjs为CEBB7A3173D31F02E64F64436BF051D2BAA6A918A74E99E286A2697F0D7642F1，cleanup-challenge.cjs为EDD37F2C44C8820DC7DCCC5E7ECC447FDF9D11B578E6B11607DB2A8FA7D39D4A；命令分别`node .benchmarks/s1b-permissions-review-20261004/review.cjs`（exit0）与`node .benchmarks/s1b-permissions-review-20261004/cleanup-challenge.cjs`（exit1继承原CLI实验红门，挑战断言实际成立）。原JSON只保存在ignored自有目录，不纳入提交或把历史报告代替本轮运行。

同轮其余实际结果：root/write-root完整ID一致；specific0x110083与generic0xc0110000各空/3145745字节同HANDLE写/flush/定位/读回/EOF/重算hash均通过，块<=128KiB；每runtime12次分享拒绝、6次创建碰撞、4次rename Win32=32拒绝、4次关闭后立即重占用成功，24次CNG close无失败，普通HANDLE全部checked close，正常/junction各child关闭确认。每CLI6291490字节、sentinel前后不变，junction属性拒绝。ACL拒绝、file symlink EPERM、硬件断电、生产借用/材料/恢复/GUI仍未验。

## 新确认工具缺陷：递归清理删除未登记普通子项

实际CLI checkOwned只验证fixture根ID/路径与全树无reparse，随后对target parent及整个fixture执行fs.rmSync(recursive:true)。无reparse不证明每个普通child是本次创建/登记对象，违反本批“未知对象不递归删”的门。

root ignored cleanup-challenge.cjs导入该CLI的run进行专门反例（不是替代原CLI验收）：只在它已验证根、即将首次递归删除自己target时，通过本轮受控fs.rmSync拦截器在该自有parent添加固定无敏感内容的root-review-unknown-child.bin；文件由协调方生成、不属于开发harness创建记录，没有用户文件或外部root。然后允许真实原rm执行。实际 injected=true、unknownRemoved=true，原harness仍报告REMOVED_VERIFIED_OWN_FIXTURE/exit1。这是实验工具清理缺陷，不是测试方法失败或用户数据损失。

本轮不接受、不复制/提交五实验文件/ignore。权限负例和其余局部API结果是真实独立证据，但不豁免清理门。整改保持原五文件与一ignore行范围：停止字符串递归删未知对象，优先分离normal/junction固定子目录并默认保留自有fixture；若实现清理须使用本次已记录身份的实际HANDLE逐项处置，未知名字/ID或关闭不明留根，无ACL改变/路径fallback。父目录read-only失败断言及原exit1不改写。源码/目标外部sentinel不变，新的unknown-child反例须改为保留。

root本轮没有重复旧S1a suite/native、没有SQLite/产品GUI/生产库，经验候选暂不纳入AGENTS（0）；当前先完成工具纠正。后续独立复验原CLI、普通Node/Electron应用import、unknown child及取消/超时处置，再决定仅诊断工具范围接受。完整writer/source借用/预算、manifest/marker/重开、S2/S3仍需具体下一计划。

## 2026-10-04 08:03：修正独立通过，仅接受隔离诊断工具

main实际0941fb94deae3d3c0f0d96d44ab356d24ef855a7且清洁；上一六份拒绝审查/修正计划/设计更正文档已普通push exit0并独立核远端相同。实际双目标wait仍只返回Luna completed/notLoaded20，单Sol确认原修正回合01a1041b-a3e6-7f23-83af-ee28c693b0f2 completed/idle，cursor cfe7da2a-d1e4-4a1f-9168-182cb9c80d36:38。root接管冻结后的唯一技术窗口，无开发并发修改。

核实际源码：native只改junction-data固定负例目录选择；CLI删除全部清理调用，normal/junction分开且一律RETAINED_NO_DELETE，experimentFinished/资源状态分列；意外native outcome先拒绝，transport/phase/runtime/version/容器完整ID核验保持。五交付hash分别native3AA35588D1075D49CE69AD3FC225471E2A92F7328EEE844A83E5CD24C5F5553D、binding6AA1A2762428C731A16BDCE835B1D0EE8B226729396E36B7FACC29FB381342D3、build08BD8A617B55CC5419395B31C991C327AE53880671B2718205A8E66DDC60CA61、CLI223388BD7CB3FA0ADBCA7EC68EEF91601F2661AF17DD1C4944EF4536185252D1、开发记录42CD463DA6CA2A4621A9DEE592F5B747D87DA044D63CDDCE45633B0AC2ACDD1C。旧S1a native/adapter/test与graph/application/capsule-store冻结hash保持。

实际命令与结果：

- Sol原隔离build `node packages/graph/scripts/build-windows-upgrade-write-probe.cjs` exit0/7.39秒。root ignored `review.cjs` 调原CLI Node/Electron，自身exit0；两个CLI仍exit1，只有readOnlyCreateDenied=false。真实固定字节写/flush/读回/EOF/hash、12分享拒绝/6碰撞/4rename/4立即重占用、24 CNG关闭及普通HANDLE关闭保持；normal/junction资源全true、experimentFinished=true、材料保留。不是权限实验全绿。
- `retention-challenge.cjs` 与 `retention-challenge.cjs --electron`：在本次mkdtemp后、native操作前加入root自己创建而未被harness登记的普通文件，并拦截rmSync/rmdirSync/unlinkSync。各0删除，内容SHA/Node dev+ino+size前后相同，normal/junction真实child和native关闭标记true。两命令exit1来自原CLI正确权限红门，挑战断言成立；Node stat身份不替代完整FileId128。
- `outcome-challenge.cjs --node/--electron` 各exit0：实际native正常结果传输中只把outcome改为IDENTITY_CHANGED，保留positive rows及closed=true。原run exit2、固定NATIVE_NORMAL_OUTCOME_REJECTED、experimentFinished=false、只启动1个normal child、junction未启动/资源null。此为边界注入，非真实身份变更OS实验。
- 另一应用入口 `import-app.cjs` 用真实Node24.17.0与Electron44.4.3分别require两个模块，拦截文件创建/删除/rename、spawn和.node加载，effects=0/exit0。真实Electron无BrowserWindow，没有GUI操作。
- `transport-challenge.cjs cancel/ready-timeout` 各exit0：原supervise启动root受控且不发READY的真实Node子进程；内部SIGINT事件注入约228ms得到CHILD_CANCELLED，真实5秒就绪超时约5026ms得到CHILD_DEADLINE；确认close后原run exit2、未完成、无junction、保留材料、native关闭null。不是native I/O取消、真实终端按键或60秒总deadline通过。

新增transport探针首版错误要求exitCode非null，被信号终止的真实child可为exitCode=null、signalCode非null。这是root测试缺陷：改为检查两种真实退出状态之一后再验证，未改产品或放宽关闭门。CloseHandle失败、UNKNOWN_CHILD_CLOSE、原生I/O中途取消/截止仍未实测，保留限制。

独立ignored脚本当前hash：review84D2993BD11A43432823B5FB4402A5C2C58CD1CF534DCEEAB7D589AF991F6490；retention E832CFA411C95DA611E3442FB7844F4524E6B1D3A51B7888D2C3DB6319D27815；outcome7265BEC5CED1C4E87E2D38180EAC754D00EE2C1AC143AB2CEE776A049437D9F9；import AED6D7051FBB6D1788ADC32A409735FD7EA9C5715D9E6972FC6E7749944B9956；transport5449FC09EA15EB12CCD1D82D738337265D6E81C52F96D55EBC57E1D9F47686A4。自有材料/JSON仅ignored本机目录保留，不提交二进制、绝对fixture路径或替身生产结果。

按修正计划允许的默认保留方案，接受五文件为隔离诊断工具，不接受被证伪的权限假设。精确复制main并核SHA相同，仅追加新probe build ignore行；没有复制Sol旧native/build ignore、S1a/core/UI/AGENTS旧差异。main两个原CLI语法exit0、原隔离build exit0/7.32秒；独立review调用main原CLI两个runtime结果再次一致。工具不接入应用/生产，没有类型契约变更，旧suite未重复。

AGENTS去重后新增2条：只读父HANDLE不推断子创建拒绝；未知普通子项不能靠根ID/无reparse授权递归删。依据是原本机真实反例及本轮修正复验；已有根句柄路径约束规则不包含这两个操作/归属结论。本轮初次大patch因旧文案尾行差异拒绝，检查确认没有部分应用，改按真实上下文再写；未覆盖任何用户变更。

已实现/独立验证：上述隔离工具与局部API/边界；真实GUI本轮0。S1a file symlink EPERM整体未接受，ACL拒绝/生产source-loan/原始材料writer/manifest/marker/重开/恢复/SQLite/实际artifact/安装升级卸载/签名/干净Windows/远程质量仍未验。下一切片见upgrade-source-loan-plan，不能以工具提交豁免旧门。
