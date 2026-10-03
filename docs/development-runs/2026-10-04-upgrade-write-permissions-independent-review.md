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
