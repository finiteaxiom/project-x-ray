# 4B-M11 原 owned 副本 HANDLE 的再次核验

## 当前源码依据

M10 已接受并精确进入主目录，但只在创建时执行一次目标读回。`New-XRayPrivateArtifactCopy` 完成后目标指针停在 EOF；没有可供 parser 前后重复执行的完整身份/length/hash 核验端口。原 M2 reader 的 ASAR 控制副本第3/4条明确要求 parse 前后从副本原 HANDLE 复核。当前结构模块只消费传入的条目列表，不能替代该能力。本切片直接实现可运行、可重复的内部核验，不启动 ASAR parser，不改冻结 reader/manifest/签名协议。

## 责任与五新文件

work tree 2，同 ID、5170、gpt-6-luna/max。完整442/raw基线和主目录 M4/M8/M9/M10 依赖一致后实施，仅五新：

- apps/desktop/scripts/windows-artifact-copy-reverification.ps1
- apps/desktop/scripts/test-fixtures/windows-artifact-copy-reverification-probe.ps1
- apps/desktop/src/windows-artifact-copy-reverification.test.ts
- apps/desktop/src/windows-artifact-copy-reverification-handle.test.ts
- docs/development-runs/2026-10-13-artifact-copy-reverification.md

原442全部冻结，尤其 M10 生产/夹具/测试/记录、M4/M8/M9、native、UI、DB、协议、package/lock、AGENTS和公共记录。缺少固定端口时反馈，不擅改原模块。此 plan 位于主 checkout，可直接读，不复制到自身目录突破五新边界。

## 内部端口行为

只接受本进程 M10 登记且未释放、ready、created 的原 session；通过 ReferenceEquals 核完整 M10 owner entry、M9 session/entry/state、目标 HANDLE 与既有 ledger，拒绝克隆/伪造/已失败/已关闭/未确认释放会话。不接受 path、handle、stream、caller hash、callback、脚本或可替换 reader 参数。仅可信内部 helper 间操作；不得宣称内部可写 state 是跨信任域不可伪造授权。

捕获本次私有核验用的原 owner 引用、目标 HANDLE、完整身份、长度和 M10 原 source/copy digest/计数；有效长度0..2GiB、安全整数与有限计数相等，digest 严格有限值且原 source/copy 相等。使用已有固定 M4/M9端口。首次核实际目标完整 metadata、非 reparse/普通磁盘文件、volume/128bit ID/length/links/creation/相关属性和既有身份匹配。借用 M8目录及已消费 M4source按原 stable helper 继续验证，不能重新读取或 seek source。

仅将本次 owned target HANDLE 回到0，以最大1MiB常数缓冲顺序读回并增量 SHA-256，exact count/长度/EOF、短读/0/超界/API失败均拒绝。读完 hash 与原 M10 copy/source digest 精确相等；重新核完整目标 metadata、owner引用/ledger/借用源和目录身份。只 seek 已登记目标，不重开任何路径。可连续核验同一 ready 会话，两次均完整读回；不以缓存 digest 或前次成功代替本次读取。返回固定有限DTO（verified/rejected、固定failureCode、字节计数、hash/identity proof、snapshot incomplete/signature not-evaluated），不返回path/SID/raw exception/源码/handle。

任何实际 owner 内核验失败永久撤销 M10/M9 ready，保留既有精确 owned ledger/会话以供原 Close 安全释放/失败重试，不能凭 caller 字段恢复 ready，不关闭借用 M4/M8、不删除对象。无 owner 的伪造/克隆会话失败不得撤销或关闭真正 owner。原 M10 Close 与摘要保持固定安全语义；本次新失败DTO固定码不需扩展旧协议。成功核验只证明本次读回一致，不证明 ASAR语法/完整reader/build来源/签名/运行或真实不可变快照。

## 验证门

开发只串行纯定向测试、desktop noEmit、PS5.1 AST；纯stub须明确不能代表 HANDLE。开发不得跑真实Windows fixture/HANDLE/native/build/dist/Electron。自有记录反馈闭环，规则本轮可零条但原AGENTS冻结，不Git。

冻结447与原442完整raw/hash。root单技术窗口独立源审和原套件：空/Unicode/多块/超过32MiB自有材料、同会话连续两次核验与真实计数hash/EOF、源消费标记和借用保持、克隆/释放/失败拒绝不影响正确owner、故障发生在copy已ready后（明确marker）才篡改观察：身份/长度/owner/目录变化、读取/短读/EOF/hash错误、seek失败，核失败永久撤销ready且原Close释放或unconfirmed重试。实际受控target字节变化若无安全写端口，不扩大权限，以固定调用故障验证hash mismatch并明确不是真实并发写；原持有期rename/delete拒绝保持。未知材料零删除，保留自有现场。2GiB实际极限未测单列。root独立接受后精确main集成并按风险复验，不重复原M10已接受门。

ASAR路径消费者、parse前后编排、parser资源/缓存/条目验证、sidecar父进程重开、完整manifest、签名安装运行、GUI/API仍未验。本切片是原第四批必要本地能力，四批停止门保持，不第五批。
