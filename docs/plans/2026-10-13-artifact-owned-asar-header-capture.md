# 4B-M13 原 owned 副本 HANDLE 有界 ASAR header 捕获

## 实际缺口与责任

M12纯字节预检已独立接受并精确main集成；它仍只接caller bytes。M10创建原owned副本，M11有前后完整读回门，但没有从该副本原HANDLE获取精确size/header pickle的有限端口。这是原M2受控ASAR parser前门的下一必要实现，不启动新批次或重做M10/M11/M12。

work tree 2 原ID/5170/gpt-6-luna/max，派发基线450完整raw/hash等于M12接受来源。仅五新：

- apps/desktop/scripts/windows-artifact-asar-header-capture.ps1
- apps/desktop/scripts/test-fixtures/windows-artifact-asar-header-capture-probe.ps1
- apps/desktop/src/windows-artifact-asar-header-capture.test.ts
- apps/desktop/src/windows-artifact-asar-header-capture-handle.test.ts
- docs/development-runs/2026-10-13-artifact-asar-header-capture.md

原450全部冻结：M4/M8/M9/M10/M11/M12、native、UI、数据库、协议、package/lock、AGENTS与公共记录；五依赖需与main精确对齐后派发。直接读主目录本plan，不复制。缺必要端口反馈，不擅改已验模块；开发不Git。

## 可运行内部端口

只接受本进程原登记的M10 session，返回可信内部消费的有限捕获结果，导入仅定义函数。不接受path/HANDLE/stream/callback/调用者长度hash或脚本。拒绝伪造/clone/failed/released/unconfirmed；真实M10与M9完整entry/state/session及目标HANDLE引用须核对，参照M11已修复的先捕获saved tuple、后精确live pairing，再确认M9可撤销范围，不能在失败时处置尚未确认配对的foreign状态。

捕获本次owner、target HANDLE、完整长度/摘要/identity、borrowed source/目录引用；前置调用原M11实际完整重读成功，并核其返回和捕获的完整owner/原状态一致，随后仅seek原owned目标到0。读取精确8字节size pickle，先核payload=4及header长度最低合法值、4字节对齐、最大8MiB、8+header不超原文件length和2GiB安全算术；全部成立之后才分配有限header目标。使用既有M9固定native读端口和不超过1MiB常数native缓冲分块读精确header，错误、短读/0/超界均固定拒绝；不重开路径、不read/seek借用source，不读取packed内容作为header。

读取中及前后核完整owner绑定、目标完整metadata及borrowed source/目录稳定。捕获后调用原M11再次完整重读/EOF/hash，核与前置同原完整身份/length/digest；失败丢弃并清零本次字节，不返回部分捕获。两次M11都必须本次执行，缓存或原digest不替代；最终目标指针可停原M11 EOF，不能声称range终点是archive EOF。读后确认未被替换的已捕获owner；caller在后续持有可写内部session不成为跨信任域授权。

成功返回精确size/header byte[]、archive长度、各range实际计数、固定proof以及incomplete/signature not-evaluated。这是内部私有字节传递，不得记录字节/base64/原JSON；未来Node消费端必须应用M12再形成公开DTO。固定诊断结果仅计数与proof，无路径/SID/raw exception/HANDLE或partial bytes。任何实际已捕获owner内失败永久撤销其ready；M9只在精确配对确认后撤销已捕获对象，不follow late state，不关闭borrowed source/目录，不删除材料。原Close安全释放与unconfirmed重试仍可用，失败不可恢复ready。

捕获字节不能证明完整ASAR语义、packed内容/unpacked成员、build来源、签名或运行；尚不提供私有路径parser消费者/缓存隔离、sidecar、完整manifest。

## 开发与独立门

开发只串行本次pure定向、desktop noEmit与PS5.1 AST；禁止真实Windows HANDLE/fixture/native/build/dist/Electron。pure需清楚与实际HANDLE区分：仿session/mismatch/foreign/late state、size0/负/超限/错alignment/越界、read/seek/短读/count/前后M11失败、零partial、借用保持与已有Close释放可用。内部byte[]返回须避免PowerShell自动枚举或空数组丢失；用实际PS5.1纯stub回归确认类型/长度、固定DTO和无额外stdout。

root冻结455/raw、原450保持/恰五新后独立源码与单Windows技术窗口执行原套件。真实自有有效pickle材料覆盖空树、Unicode、跨1MiBheader、header上限及档案尾packed bytes；只用自有材料、不调用候选代码。确认原M10目标HANDLE真实捕获字节与trusted producer一致，可直接交M12预检；range exact及前后两次M11实际hash/EOF、借用source消费一次保持、held rename/delete拒绝及Close释放门。畸形前缀在分配header前拒绝，实际读取/metadata/owner/borrowed/mismatch故障marker核已到本次捕获；失败无字节/永久撤销ready且foreign保持。不得扩大权限制造并发写或清理未知材料；实际2GiB极限不跑则单列未测。

独立接受后root精确集成五新，main原文件raw/hash保持并跑适用M13/M12消费回归与type；不重跑旧里程碑整套。每次失败/修复反馈自有记录，公共规则root逐条审查，允许0；GUI/API/签名运行/完整reader不因此完成，四批停止门不变。
