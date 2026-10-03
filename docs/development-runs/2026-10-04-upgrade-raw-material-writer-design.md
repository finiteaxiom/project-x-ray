# 4B-S1b：原始材料 writer 设计记录

2026-10-04，开发-Sol。对应 [设计](../plans/2026-10-04-upgrade-raw-material-writer-design.md) 与 [派发计划](../plans/2026-10-04-upgrade-raw-material-design-plan.md)。仅新增这两份文档，不是writer实现或生产/恢复验收。

## 基线与实际读查

派发计划hash `E45480A1664DDA74188EDFA2EF526DEDC4124FFEDB9C0F05672AEA7B021E7389`，worktree HEAD仍 `455d4ad50830ee2495b70927e51caf830a4efbb8`。没有同步main。S1a native/adapter/test/smoke、既有B0/A/AGENTS/core/UI/ignore/package/lock冻结。S1a两项输入/清理缺陷的独立复验是协调方报告；本轮没有重复自测，不把它升级为S1a整体接受。

实际命令：Get-Content读取新计划；Get-FileHash核计划与冻结文件；rg定点读取source adapter的private Native API、read/verify/close、fixed false flags及native Lease/maxBytes/bytesRead/until/Queue；git rev-parse HEAD及仅新文档的status。确认没有target FILE_CREATE、WriteFile、FlushFileBuffers、material marker或重开入口。旧native以source HANDLE只读工作，source WeakMap无borrow API；metadata字段不能构造target写权限。

本轮web只读官方NtCreateFile、WriteFile、FlushFileBuffers、ReOpenFile，链接列于设计末节。ReOpenFile明确要求原对象由CreateFile创建；现有source子目录实际由NtCreateFile打开，所以不能无实验假定可直接用它增加root写权限。选择提出从已持有父目录单组件相对重开同root并比较完整ID的候选；所有访问/分享/权限仍待下一批自有实验。

## 读查→设计修订

1. 根写能力不从caller路径/nonce生成：必须从真实source借用capability进入同一native层，原root/ancestors保活，以同父HANDLE相对重开核身份申请权限。目标operation FILE_CREATE才建立当前归属，已有目录一律拒绝，payload使用内部ordinal名字而不是source路径。
2. 实际source累计读取上限20GiB，与B0第二遍source hash复核存在预算冲突。文档明确首writer需预留2B、通常最多10GiB材料；B>剩余额度一半在target创建前拒绝。没有暗增40GiB或删掉B0门；若需完整20GiB writer，应另派准确接口/预算修正。这是现有代码推导的可行性限制，不是实测20GiB性能数据。
3. 逐成员写/flush/同target HANDLE重读，source第二遍hash及集合门，再manifest canonical/关联读回，再最后raw-material.complete并复核。每个失败/退出切点区分partial、unknown与可重开字节材料，marker不当任务成功或恢复/生产授权。
4. 重开零SQLite，只验证有限名字/版本/身份/bytes/hash/规范JSON。文件内一致的hash不是生产者认证；同用户同时重写payload+manifest+marker不被“普通ACL继承+nonce”神奇阻止。不引入签名、ACL修改、secret、VFS或恢复。

文本核对另补明确receipt/manifest字段与避免manifest自hash循环；从实际Handle.reset只调用CloseHandle且无结果回传，指出checked target/borrow-release是未来最小接口前提，不把旧source.close的void返回写成已证明检测所有关闭错误。

以上仅“实际读查→推导缺口→写设计→文本核对”，没有运行失败，不编造实现测试闭环。所有平台新行为标待实验。设计首切片的SOURCE_READ_BUDGET拒绝与target权限候选供root具体审查，不授权当前改动冻结代码。

## 实际验证与未执行

只新增两文档并做文本/链接意图/文件存在性/冻结hash核对。没有native/build/Electron/dist/GUI、DB打开、复制、target写入/flush/marker、source读取实验、child、安装依赖、生产数据或安全设置操作。没有代码测试；历史41/42及EPERM仅是协调方报告的前置状态，不是本轮运行结果。最终两hash在交付中给出，避免文档自引用。

未验证：source内部loan/pending borrow生命周期、root写权限相对重开、目标独占创建及故障处置、short write/flush/disk full、manifest marker全部切点、完整包重开、防篡改范围、Node/Electron writer能力。真实file symlink仍EPERM未验、S1a整体未接受；原包、S2/profile/身份/恢复、VFS、启动/GUI、签名/干净机器/发布门均未完成。

## 经验判断

AGENTS新增/修订0。本轮只给出基于实际源码与官方API的设计，没有新复现实验；既有实际HANDLE、强引用、严格输入和固定清理错误规则继续适用，不把未实验方案写成已验证经验。只在自己checkout维护这两份新文档；没有Git写操作，也没有公共记录或核心修改。
