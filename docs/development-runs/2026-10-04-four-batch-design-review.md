# 原四批两项设计独立审查与取消复现

2026-10-04；root；主 checkout。起点 main `e88e03b0989b68ee16924b14ff78327306d9d513`。本轮仅接受设计、独立复现与明确实施计划，不接受新产品实现，不使用 GUI。

## 实际冻结交付与源码核对

Sol 3G-S 实际 completed，cursor `f54a15ad-5729-4a82-bfce-634472780e76:5`；两文档为 incremental-index-design 的 plan/run。Luna 4B-M2 实际 completed，cursor `e11b2027-fd4e-4bb8-a314-36a1858b89be:7`；两文档为 windows-artifact-reader 的 plan/run。root 逐文档读完整内容，核对 main 实际 application/Python worker/analyzer/GraphStore、desktop 每任务新 worker/terminal terminate；不将历史报告当本轮测试。五分析源码保持上轮一致；追加 Python worker、GraphStore、remote/ownership store 的 main/Sol 比较，规范换行后四文件内容相等。旧 worktree 全部 modified/untracked 保留，没有 reset/整体同步。

## 3G-S 审查结论与具体缺陷

接受 Python raw、无快照材料缓存的最小范围。每轮当前文件工具探测、完整安全读/hash/再验证、全部 Python 跨文件关系重建、TS/Git 冷路径与最终身份不变。持久 project 私有表是跨新 worker 产品收益的必要条件，实例 benchmark 不足。追加 current activation 的事务门，不能只凭相等 snapshotId 接纳迟到 batch；脚本实际内容摘要须核执行边界，runtime/protocol mismatch 最多一次全冷回退。现有迁移10/11占用，不放宽预算、origin或既有图发布事务。

root 使用临时自有复现脚本，真实 XRayApplication、Python worker 和项目 SQLite：一个 Python 源文件先索引、改内容、在 `persisting` callback 同步 abort。命令 `pnpm exec tsx .index-cancel-review.mts` exit0；实际输出 `outcome=AbortError`、`signalAborted=true`、`residentUnchanged=true`、`reopenedChanged=true`。原 ID `e35f98a26fca58d62a3bbfa0`、重开 ID `9fa7bf220ef7111c8c7a392e`。fixture 只由 AST 读取，没有执行其中代码；脚本精确移除，生成材料保留、不递归清理，不记录私人路径。

已确认产品缺陷根因：persisting callback 后无取消检查，save 成功后再 abort 检查，造成已提交但调用取消、resident 与重开不一致。本轮未直接改实现。已派原 Sol 3G-S1，窄修普通索引回调后提交前检查/提交后成功结果，真实 SQL 回归并核跨实例持久缓存。批准计划 `2026-10-04-python-parse-cache-implementation.md` 两 checkout SHA256 相同 `F647675B1A711346CB4050EBE74EC70DE6914A6695D713A0FC5FB220C23A27CC`。不是发现取消缺陷就扩大至 Git/desktop。

## 4B-M2 审查结论与有限实施

root 核 Microsoft 官方 [Get-AuthenticodeSignature 参数](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-5.1)、[WINTRUST_FILE_INFO](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_file_info)、[WINTRUST_DATA](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data)：cmdlet 文档 path/content 参数不能证明同 HANDLE/禁网，WinVerifyTrust hFile/cache-only 契约也不允许把其返回值写成 cmdlet 原 Status。此为协议/证据缺口，不是已复现联网。

接受 reader 所列逐组件 no-follow、受限 share、同 HANDLE hash、目录成员前后复核等作为设计门，所有目标运行时保证仍未验。选择保持 manifest v1，签名 not-evaluated/incomplete，不调用签名 API、不改协议。接受有界 sidecar 候选，但 parent 必须真实安全句柄核验，helper checksum/token 和 Node 普通路径 read 不作安全证明。进程内 P/Invoke 只是候选，复杂实现留 Sol；无副进程、mapping/share、layout、关闭、清理未验，不授权 full scanner complete。

已派原 Luna 4B-M3，日常四文件 Node reader 进程承载实现：ready/consumer 持活/release/terminal/close、字节限额、cancel/deadline/固定失败/cleanupSafe，必须真实自有 child 验证，模型负例单列；不读 sidecar/artifacts、不做 native/PowerShell、不注册生产 reader/CLI。计划 `2026-10-04-artifact-reader-process-boundary.md` 明确独立文件，无分析/SQL冲突。它是 reader 必要的生命周期部件，不代表 reader/Windows发布已完成。

## 分列状态与未验门

已实现：本轮两份具体设计与实施计划，产品源代码零新增。独立代码/回归已验证：上述源码边界、真实取消缺陷复现；设计接受不代表缓存/reader通过。真实 GUI 已验证：0。未验：3G-S1实际实现、冷/热事实等价及子进程减少/性能、Luna lifecycle端口、全部复杂 HANDLE/sidecar/ASAR/签名、S1a正确symlink EPERM、生产写入/材料重开/恢复、旧worker接线、GUI、模型质量、签名与干净Windows门。

两新任务只属原四批，禁止第五批。本輪无新增 AGENTS 工程经验：取消问题由既有证据/发布终态规则涵盖，修复尚未完成；两个设计也无新运行实证。原停止门不变。未覆盖既有用户/开发改动，不以本轮技术复现替代产品或 GUI 验收。
