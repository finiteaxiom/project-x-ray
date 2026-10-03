# S1b-P：未知子项清理修正

2026-10-04 07:23，协调方，P1安全。依据 [独立复验](../development-runs/2026-10-04-upgrade-write-permissions-independent-review.md)；原 [probe计划](2026-10-04-upgrade-write-permissions-probe-plan.md)范围保持，只修正已复现harness清理，不启动产品writer。

原Sol仅5170目录，五新文件及唯一新ignore行内修正；优先改windows-upgrade-write-probe.cjs及开发记录，若为normal/junction固定测试子目录隔离需要，可修改本批windows_upgrade_write_probe.cc。本批binding/build无需要则冻结；全部既有S1a/native/adapter/fixture/test/smoke/build、core/UI/AGENTS/package/lock/两设计不动、不Git、不同步旧HEAD。根独立审查记录/本计划已精确复制你目录，只读，不改。

## 已确认复现与预期

root独立重构建和原CLI Node24.17.0/Electron44.4.3确认read-only parent仍可FILE_CREATE，原否定断言false/exit1如实保留。**不要删断言、skip或改成绿色通过**；API假设失败是有用实验结果，不能当ACL通过或S1a整体接受。

清理反例：原checkOwned确认rootID/路径/无reparse后，首次fs.rmSync(targetParent,{recursive:true})前加入本轮root自有ordinary unknown child，真实rm删除它而harness仍报告已验证fixture删除。无reparse或根ID不能证明全部子项本轮归属，预期unknown名字/ID一律保留且不删除其他对象，固定cleanup状态表达未清理；不访问/删除外部sentinel。

首选最小安全修正：normal与junction使用同一mkdtemp内不同固定子目录，消除为设置junction必须先递归删normal tree的需求；不提供字符串递归清理回退，正常也可默认保留fixture并明确closed/released与文件保留分开。如果做清理，只针对native本次创建、仍由实际HANDLE和完整ID确认对象逐项处置，遇未知/异常/关闭不明保留，不能单靠清理前枚举然后recursive rm制造竞态窗口。不要引入ACL变更或通用删除接口，不为清理扩大源权限。最多8MiB数据/单root/现有总deadline与child门保持。

顺带核验终态：原CLI的矩阵须识别native意外失败outcome，不得仅因已填多数positive rows/closed=true把最后IDENTITY_CHANGED等失败归成成功子结论；保留已知READ_ONLY_CREATE_ASSUMPTION_FAILED与完整正常实验的区别，partial/unknown不发完成结论。child transport、runtime、版本、当前阶段与固定错误需一致。只增加针对真实缺口的有限断言，不制造完整backup框架。

## 交付门

真实原CLI两个runtime重跑，固定read-only假设仍唯一预期红门、所有可实测API结果及close/立即重占用准确；新增unknown普通子项注入后内容/身份存在、cleanup明确保留，正常/junction setup无recursive未知删除。分开harness注入与真实OS结果，不用模拟关闭失败冒充实测。普通Node/Electron应用import无创建/child副作用，入口实际argv门保持。取消/timeout若仅静态检查则明确未验，不伪称通过。

停止所有技术进程后冻结5文件/ignore当前hash及准确命令、原始失败→修正→再验证记录，交协调方独立复验；没必要不重建未变native。原S1a/file symlink EPERM、ACL拒绝、生产source-loan/raw材料/恢复/SQLite、真实GUI与发布外部门继续未验。AGENTS不改，仅保留候选供root最终证据评估。
