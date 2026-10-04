# 4B-M3：artifact reader 自有子进程边界

2026-10-04；root 审查后派发原 Luna/main，原四批第四批。依据 reader 两文档和冻结 manifest v1；实现必要的 Node 生命周期端口，为复杂 Windows HANDLE reader 提供已验证的进程承载边界，不注册真实 artifact CLI。

## reader 设计审查决定

root 独立核现有源码与 Microsoft 官方参数文档，接受 reader 的逐组件 HANDLE/no-follow/受限 share/同句柄流式 hash/前后成员复核要求作为设计门。它们尚未目标运行时证明，不属于实现验收。

- 保持 manifest v1。Get-AuthenticodeSignature 尚无已证明的离线、同对象采集路线；逐 PE 必须 not-evaluated/rawStatus=null/signer=null，整体 incomplete，不能调用 cmdlet 或 WinVerifyTrust 后映射成其 Status。本批不修改签名协议、不调用任何签名 API。
- 有界 sidecar 可作为后续内部通道，但只有绑定实际 parent/child 完整身份的安全读取接受后才能接纳其内容。Node 普通路径 open、helper 回传 checksum 或 token 不能替代安全读取；本批不读取 sidecar、不生成真实 manifest。
- PowerShell 5.1 进程内 P/Invoke 是候选路线，不代表无编译子进程、layout、mapping/share、关闭或清理门通过。复杂 HANDLE/bridge 实现由 Sol 后续在本四批内承担；本批 Luna 不做 native/bridge/helper。

实际设计缺口：冻结每 child stdout 64 KiB，而完整 5000 项报告可超过它；reader 必须持续持有 handles 到 consumer/ASAR 结束，普通 execFile 一次退出取 stdout 无法表达该生命周期。当前仓库没有这个已验证的 reader 会话端口。本批只实现其有界进程承载、回调和 close 门，不能对 artifact 安全性作结论。

## 文件与职责

仅新增：

- `apps/desktop/scripts/windows-artifact-reader-process.cjs`
- `apps/desktop/src/windows-artifact-reader-process.test.ts`
- `apps/desktop/scripts/test-fixtures/windows-artifact-reader-child.cjs`
- `docs/development-runs/2026-10-04-artifact-reader-process.md`

不修改 existing protocol/main/preload/UI/core/native/SQL/package/lock/旧CLI，不碰 Sol 正在修改的分析文件，不读取 dist、用户项目或凭据。模块 import 零 spawn/文件读取/输出副作用，不设置生产 CLI/虚假生产 reader。无新依赖。

实现内部受信调用端口（最终签名可在已有 Node 类型范围选择）：caller 提供受信 executable+固定 helper argv 和有界 plain JSON 控制输入；用户 artifact 参数只能放 JSON，不能进入命令文本、shell、可执行文件或 helper 选择。生产 caller 后续只能固定系统 PowerShell/仓库 helper；当前没有生产 caller。测试 caller 使用 process.execPath 和本批固定自有 fixture。端口不得接受 shell:true、通过候选包寻找 helper 或运行任意候选程序。

建议 `withOwnedReaderProcess(trustedLaunch, input, consumeReady, options)`：ready 之后 consumer 执行期间保持 child 活跃；consumer 收到 run-local ready token/有界 plain DTO，不能据此认定 artifact 内容已验证。consumer 完成后发固定 release，接收合法终态并等待 close；结果只有所有门成功才返回内部 completed。协议固定版本/有限 ready-terminal 状态、完整 runId 关联，拒绝重复、错身份、先 terminal 后 ready 等顺序。不把该 completed 写入公共 manifest.scan.complete。

输入/帧均严格有限字段和预算，拒绝访问器/非 plain object/未知字段。stdio pipe、shell:false、windowsHide:true，不使用 shell 命令拼接。stdout 累计不超过 64 KiB（按字节）、stderr 不超过 4 KiB；超限立即终止本轮 child，不回显 stderr。每帧/残帧解析同样有限，未知消息失败关闭。消费者完成/失败/抛错均应释放或终止已持有的 child，不吞掉原始固定错误。

总任务上限默认 15 分钟、内部阶段可用更短 deadline；取消/超时后只杀本次 ChildProcess，最多 5 秒确认 close。spawn error、信号退出、非零 exit、协议失败、consumer 失败、close 未确认分别有限固定码；exit 不等于 close。未确认 close 时返回/抛出明确 cleanupSafe=false，caller 必须保留材料。即使未确认 close 也不能永久等待。先 abort 不 spawn；结束后清 timers/listeners 并拒绝任何新消息。helper 不允许孙进程，不能按名字/全系统 PID 扫杀；未来需要树级隔离另审 Job Object。

本批无物理材料清理端口，不按路径 rm/temp cleanup；stdout 元数据不得含原始源码、用户私有路径、凭据，测试报告只写标识/数量/固定错误。测试 fixture 输入只含预定义模式/runId，绝不 eval/执行传入字符串或启动后代。

## 实际验证门

用固定自有 Node child 实际验证正常 ready→consumer→release→terminal→exit0→close；consumer 活跃时 child 仍持有会话。覆盖先取消零 spawn、ready 后取消、consumer 抛错、就绪/总截止、非零/信号退出、损坏/错身份/重复/乱序帧、分块残帧、stdout/stderr 字节边界以及 timer/listener 回收。不能只 mock ChildProcess。

close 延迟/未确认分支可以用明确测试接缝建模，另列为模型验证，不声称真实 OS 无法杀死的进程已复现。取消/超时真实 child 需要确认 close；记录实际 Windows Node 版本、exit/close、固定诊断。模块 import 零副作用独立子进程验证。开发普通严格类型/定向回归可运行；本批不运行 native/build/dist/Electron/PowerShell/GUI，重型窗口不占用。

交付冻结四文件，给实际 diff/验证/失败修正/源 hash、未验边界。原协议测试可做一次适用回归。后续复杂 reader 不得绕过未完成 HANDLE、sidecar、ASAR、mapping、签名门；本切片不会使阶段 B 或 Windows 发布完成。四批后暂停讨论，无第五批；开发方不 Git 收尾。
