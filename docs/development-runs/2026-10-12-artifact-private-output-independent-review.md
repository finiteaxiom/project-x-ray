# 4B-M8 首次独立审查与窄修

本轮未接受、未集成主目录、无 Git。work tree 2 已冻结并确认命令全部结束；完整 432 项逐字节捕获，原 427 与派发 raw/hash 一致，恰好五新。来源收据为 ignored m8-initial-independent.json。

开发自行运行两次 Windows HANDLE suite 及一次自有 probe，违反开发仅纯/类型/解析和 root 唯一技术窗口的派发门。已明确停止并取得冻结确认；开发记录补充真实失败及最后修改未验，材料保留。该自测不计独立接受。后续不得自称进入 root 窗口。

root 在冻结后开启唯一窗口：PS5.1 纯描述符 probe 确认 RawAcl 无 GetAce，索引器可用；实际 Assert 对本模块生成的合法描述符返回 OUTPUT_ACL_REJECTED，native 未初始化。首次运行受系统脚本策略拒绝，随后仅该子进程 ExecutionPolicy Bypass，未更改持久策略。另一次 probe 参数误取构造器对象而非 bytes 已修正，不视为产品缺陷。

root 原 Windows HANDLE suite：13 项中 7 通过、6 失败，8.25s。正常 ACL 与 ready/close 路径因 GetAce 缺陷失败；extra-ace/null-DACL 实际固定细分码与旧预期不一致；existing-directory/file 返回 FIXTURE_FAILED，尚未定位。独立自有 existing-directory 诊断在同一 frozen 源码反而 completed、TARGET_CREATE_REJECTED、created false、released、ACL unchanged，因此不得把 fixture 失败直接归于产品 ACL 拒绝，也不得删除保存断言。所有 root 命令已结束，432 hash 不变，窗口关闭。诊断材料保留、无删除。

窄修保持原五新许可、427 冻结：修 RawAcl 访问，增加真正调用构造/校验的纯回归（正常、SYSTEM 去重、额外/NULL/不匹配拒绝），不得只做字符串断言；明确是否保留细分固定码并同步正确负例断言，不放宽 ready/释放/保存门。fixture 可增加固定阶段枚举用于既有目标定位，不能输出原始异常、SID/路径。开发只纯回归/类型/AST，不得再执行 HANDLE/reader/native/build/dist/Electron；冻结后 root 继续真实复验。

GUI/API、完整 reader、ASAR 安全副本、sidecar、manifest、签名、安装及运行均未验。AGENTS 本轮零新增：已有规则与派发门已覆盖，不以未定位故障创造规则。


## 2026-10-12 M8 ACL 修复独立复验

稳定交付完整432再捕获、原427/raw不变；五许可内差异：RawAcl索引器、真正PS5.1纯构造/解析回归、fixture固定阶段枚举及细分码测试预期。开发本轮未跑HANDLE。root在唯一窗口运行原两文件：22项20通过2失败，8.61s；pure9与HANDLE11通过，正常创建/实际HANDLE ACL、ready与关闭失败等门已通过，但仍不接受整个M8。

两失败为existing-directory/file fixture acl-before；root Node自有材料+冻结fixture诊断复现CouldNotAutoloadMatchingModule（Get-Acl行），尚未进入输入/输出HANDLE。相同诊断仅显式Import-Module目标$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1，两个模式completed、createdfalse/TARGET_CREATE_REJECTED/released/ACLunchanged。这是目标运行时模块自动加载环境差异导致的fixture失败，不是产品覆盖既有目录；不改系统/继承环境，不删保存断言。所有root进程结束、432源像不变，材料保留，窗口closed。

下一窄修仅新fixture、新纯测试、自有开发记录三文件；新生产模块及HANDLE测试和全部427冻结。在fixture私有ACL取样前显式加载目标运行时自带Security模块，保持无副作用生产import/固定错误阶段，纯测试加预防断言。开发仍仅纯/类型/AST，禁止HANDLEfixture或reader/native/build等；root冻结后重新执行正式原两文件。GUI/API/Git/完整reader及签名运行等仍未验。本轮工程规则零新增，现有运行时验证约束已覆盖。


## 2026-10-12 M8 本地技术门接受及主目录精确集成

再次冻结432与原427完整raw/hash一致；仅上轮许可的fixture/纯回归/自有记录三项变更，production/HANDLE测试及其余429保持。fixture显式加载目标PSHOME自带Security模块，无环境或系统策略改动。root正式原两文件23/23通过（9.40s），desktop noEmit通过。原合法ACL拒绝、额外/null/owner不匹配、已有对象保留、路径/身份/重解析/重叠、真实创建/持有/释放、故障到达和关闭未确认门均有适用证据；这是内部私有输出目录能力的接受，不是完整发布reader接受。

root全量主目录529 raw备份后精确复制五新至534，原529全部不变、来源与Sol冻结像字节相等。main noEmit通过；M8两文件加M3 reader-process、M4 handle-bridge四文件77/77通过（66.04s），两个目录源像保持。ignored收据m8-fixture-independent.json与m8-main-exact-integration.json，技术窗口closed，未运行GUI/build/dist/Electron、无Git/清理。

已实现：内部排他私有目录与创建时保护ACL、实际HANDLE身份/ACL回读及owner释放。独立代码/纯回归/Windows技术：通过上述门。真实GUI：未执行。未验：ASAR安全副本、sidecar、完整manifest/reader、签名、安装/升级/运行、干净Windows、API与GUI；不升级incomplete/not-evaluated。下一源码依据是原reader计划52–62行要求的原HANDLE至私有scratch文件复制、双端计数/hash及sidecar安全文件能力；当前M8只建目录而无文件创建/写入端口，仍有四批内可推进本地缺口，自动任务保持，下一切片须先核接口/依赖再派。员工冻结待命保留、不第五批。

规则沉淀零新增：RawAcl调用及目标runtime模块选择有本次证据，已由现有实际runtime/适用回归门覆盖，未另造重复规则。开发越界历史及两轮root失败证据保留，不改写为首次通过。
