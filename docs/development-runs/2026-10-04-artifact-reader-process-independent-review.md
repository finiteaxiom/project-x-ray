# 4B-M3 子进程会话独立审查

2026-10-04；root；原四批第四批。只审实际冻结的内部Node进程端口，未使用GUI，不读取artifact/sidecar，不启动PowerShell或签名API。

## 20:11首稿复验与退回

主checkout实际c479ac4dfc25da752e47af5ed8a4937dfd79c73a。原Luna完成冻结cursor e11b2027-fd4e-4bb8-a314-36a1858b89be:14；root读查完整模块、固定fixture、测试和开发记录。源码hash与交付相同：process `1822EE66BB225EF0A4FCBE5743C130B9CAC28AE65E3DA9D767EF9B0466B579A0`，test `2FD6F25A78449D0B8C2994A564E44662BECCAE975BB55A4F5418D278D491B131`，fixture `23B6C7208386635EF7C620952B72FF2A2901BBC7DF86D4F25230928962ECB27D`。

独立 `pnpm --filter @project-xray/desktop exec vitest run src/windows-artifact-reader-process.test.ts src/windows-artifact-manifest-protocol.test.ts`：2文件49项通过，exit0。此结果未覆盖下面反例，首稿不接受、不提交。尚未执行root类型检查，修正后连同适用回归核验。

root补充真实Node24.17.0子进程：临时固定自有child只解析本次start帧，然后单次 `process.stdout.write(Buffer.from(readyLine+readyLine))` 发出两条相同ready，保持stdin直到本轮parent终止。caller用已冻结模块和该固定child，记录consumer调用次数及其signal状态；exit0，实际 `consumerCalledAfterAbort=true`、`PROTOCOL_INVALID`、`calls=1`、`cleanupSafe=true`、`closeConfirmed=true`。自有临时脚本已精确移除，无物理材料清理或其他项目代码执行。先用原fixture两次write时consumer先于第二chunk合法启动，不能以该结果证明本缺陷；改为单次合并write后确认失败在consumer启动前已发生。

产品根因已确认：processReady先排consumer微任务，随后同一stdout chunk的重复/非法帧可调用fail并abort，但微任务执行时不再检查state/failure/settled/abort。原duplicate-ready测试只核错误与close，未核已失败时零consumer启动。尚未开始的consumer可能访问依赖会话的材料，因此不能把总Promise拒绝当成零consumer执行。

已向原Luna明确退回同四文件修正：先真实child单write红测，核重复ready、ready后乱序terminal/非法tail；预期失败/取消/关闭后尚未启动consumer为零调用，正常仍一次。consumer入口须重核当前会话状态。保持正在运行consumer的合作取消边界，不宣称能够强制停止任意JS异步工作；固定错误、总字节/close限额及未确认保留门不变。无production reader/caller/GUI/native或Git授权扩张。

已实现：首稿有限进程端口。独立回归已验证：49项及真实缺陷反例，整切片未接受。真实GUI已验证：0。HANDLE/no-follow/同对象hash、sidecar/ASAR、Authenticode/真实manifest与发布全部开放；不是Windows reader完成。现有异步取消/失败门已覆盖本类要求，本轮不新增AGENTS规则，待修正冻结复验。

## 修正冻结后独立通过

原Luna修正回合01a106d4-46d5-7f20-97c6-366ad7fe8a4e于20:17冻结，旧cursor17。root核首次consumer微任务内的state/failure/settled/consumerAbort门，正常消费者仍一次，已经开始的消费者仍只合作取消。修正后hash：process `56E8E7FF5EEBF4E398234233DB79AE9C8E6283AB6283445B85B9F36E5F2BC5E3`；test `39CBCACD31D6B7267A01DCD24C9F0D01993977181373B3F312CA6E930811EC58`；fixture `4578160E4926D66F36B0CEC9C1E1A26EB0ACF3E5843F7A22D2E6734FD27BE802`。23:17中断恢复后复核hash仍相同，临时复现文件不存在。

root实际20:18运行reader/manifest两文件50项全部通过（3.56秒）、desktop noEmit及两个CJS语法检查各exit0。另以root固定自有child一次write合并ready与第二帧，独立覆盖重复ready、提前terminal、非法JSON尾帧：三型均PROTOCOL_INVALID、consumer calls=0、closeConfirmed=true、cleanupSafe=true，原命令exit0；不以开发报告替代这个独立反例复验。自有临时脚本精确移除，未启动其他程序或清理物理材料。

接受仅为四文件内部Node生命周期端口及记录，属于已实现/独立源码和回归已验证。它没有GUI入口，不注册生产reader，不提供HANDLE安全证明或公共manifest完成状态；真实GUI仍0，整个Windows发布未验。CHILD_SIGNAL和OS无法结束child仍未实测，测试close seam仍明确模型；任意已开始JS consumer不能强制停止，future caller必须另处理其资源。这一限制不被cleanupSafe对本次child的确认扩大。AGENTS新增0，现有取消/失败门覆盖，避免重复规则。当前协调方Git元数据只读，未stage/commit/push，四文件仍在main工作区保留。
